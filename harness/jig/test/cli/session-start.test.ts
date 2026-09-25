import { describe, expect, test } from "bun:test";
import { sessionStart } from "../../src/cli/hooks/session-start";
import type { SessionRecord } from "../../src/domain/hooks/session";
import type { Logger } from "../../src/domain/ports";

const clock = { now: () => new Date("2026-09-22T09:00:00Z") };

function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function harness(): {
  entries: SessionRecord[];
  run: (stdin: string, harnessName?: string) => Promise<string>;
} {
  const entries: SessionRecord[] = [];
  return {
    entries,
    run: (stdin, harnessName) =>
      sessionStart(stdin, {
        record: async (entry) => void entries.push(entry),
        clock,
        logger: silentLogger(),
        env: {},
        ...(harnessName === undefined ? {} : { harness: harnessName }),
      }),
  };
}

describe("sessionStart", () => {
  test("records the session's model, source and harness", async () => {
    const { entries, run } = harness();

    const out = await run(
      JSON.stringify({
        session_id: "abc123",
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-opus-5",
        cwd: "/work",
      }),
    );

    // A SessionStart hook's stdout becomes context for the model; this one has
    // nothing to say to Claude.
    expect(out).toBe("");
    expect(entries).toEqual([
      {
        session_id: "abc123",
        model: "claude-opus-5",
        harness: "claude",
        recorded_at: "2026-09-22T09:00:00.000Z",
        source: "startup",
      },
    ]);
  });

  test("--harness names the caller; claude is the default", async () => {
    const { entries, run } = harness();
    const stdin = JSON.stringify({ session_id: "s1", model: "m", source: "startup" });

    await run(stdin);
    await run(stdin, "dsh");

    expect(entries.map((entry) => entry.harness)).toEqual(["claude", "dsh"]);
  });

  test("a session start without a model is recorded with model undefined", async () => {
    // The doc is explicit that `model` can be absent — "for example after
    // /clear or when a session is restored through conversation recovery".
    const { entries, run } = harness();

    await run(JSON.stringify({ session_id: "s2", source: "clear" }));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.model).toBeUndefined();
    expect(entries[0]?.source).toBe("clear");
    // Absent, not null: the key must not appear in the jsonl line either.
    expect(JSON.parse(JSON.stringify(entries[0]))).not.toHaveProperty("model");
  });

  test("malformed input exits quietly: nothing recorded, nothing printed", async () => {
    const { entries, run } = harness();

    expect(await run("not json at all {")).toBe("");
    expect(await run("")).toBe("");
    // Valid JSON, but no session id to key the record on.
    expect(await run(JSON.stringify({ model: "claude-opus-5" }))).toBe("");
    expect(entries).toEqual([]);
  });

  test("a log that cannot be written never fails the session", async () => {
    const out = await sessionStart(JSON.stringify({ session_id: "s3", model: "m" }), {
      record: async () => {
        throw new Error("disk full");
      },
      clock,
      logger: silentLogger(),
      env: {},
    });

    expect(out).toBe("");
  });

  test("JIG_HARNESS names the caller when no flag was passed", async () => {
    const entries: SessionRecord[] = [];

    await sessionStart(JSON.stringify({ session_id: "s4", model: "m" }), {
      record: async (entry) => void entries.push(entry),
      clock,
      env: { JIG_HARNESS: "codex" },
    });

    expect(entries[0]?.harness).toBe("codex");
  });
});
