import { describe, expect, test } from "bun:test";
import { sessionModel } from "../../../src/app/hooks/session-model";
import type { SessionRecord } from "../../../src/domain/hooks/session";

function log(...entries: readonly Partial<SessionRecord>[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

function reader(text: string | Error): { fs: { read: () => Promise<string> }; path: string } {
  return {
    fs: {
      read: async () => {
        if (text instanceof Error) throw text;
        return text;
      },
    },
    path: "/state/sessions.jsonl",
  };
}

describe("sessionModel", () => {
  test("returns the model recorded for the session", async () => {
    const text = log(
      { session_id: "other", model: "claude-haiku-5", harness: "claude" },
      { session_id: "s1", model: "claude-opus-5", harness: "claude" },
    );

    expect(await sessionModel("s1", reader(text))).toBe("claude-opus-5");
  });

  test("the latest line for a session wins", async () => {
    // SessionStart fires again on /clear, compaction and resume, so one id has
    // several lines; a compaction under a switched model is why the newest one
    // is the true one.
    const text = log(
      { session_id: "s1", model: "claude-opus-5", harness: "claude", source: "startup" },
      { session_id: "s1", model: "claude-sonnet-5", harness: "claude", source: "compact" },
    );

    expect(await sessionModel("s1", reader(text))).toBe("claude-sonnet-5");
  });

  test("a later line with no model does not erase an earlier one that had it", async () => {
    const text = log(
      { session_id: "s1", model: "claude-opus-5", harness: "claude", source: "startup" },
      { session_id: "s1", harness: "claude", source: "clear" },
    );

    expect(await sessionModel("s1", reader(text))).toBe("claude-opus-5");
  });

  test("an unknown session is undefined, not an error", async () => {
    const text = log({ session_id: "s1", model: "claude-opus-5", harness: "claude" });

    expect(await sessionModel("nope", reader(text))).toBeUndefined();
    expect(await sessionModel("", reader(text))).toBeUndefined();
  });

  test("an unreadable or missing log is undefined, not an error", async () => {
    expect(await sessionModel("s1", reader(new Error("ENOENT")))).toBeUndefined();
    expect(await sessionModel("s1", reader(""))).toBeUndefined();
  });

  test("a truncated final line does not hide the sessions before it", async () => {
    const text = `${log({ session_id: "s1", model: "claude-opus-5", harness: "claude" })}{"session_id":"s2","mod`;

    expect(await sessionModel("s1", reader(text))).toBe("claude-opus-5");
    expect(await sessionModel("s2", reader(text))).toBeUndefined();
  });

  test("only the tail of an oversized log is scanned", async () => {
    // The cap is 1 MiB from the end; anything older than that is out of reach
    // by design, and the documented consequence is an unknown model, never a
    // failure.
    const filler = log(
      ...Array.from({ length: 16_000 }, (_, i) => ({
        session_id: `filler-${i}`,
        model: "claude-haiku-5",
        harness: "claude" as const,
      })),
    );
    const old = log({ session_id: "ancient", model: "claude-opus-5", harness: "claude" });
    const text = old + filler;

    expect(text.length).toBeGreaterThan(1024 * 1024);
    expect(await sessionModel("ancient", reader(text))).toBeUndefined();
    expect(await sessionModel("filler-15999", reader(text))).toBe("claude-haiku-5");
  });
});
