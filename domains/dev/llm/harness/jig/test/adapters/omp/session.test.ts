import { describe, expect, test } from "bun:test";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import { recordSession, sessionRecordOf } from "../../../adapters/omp/src/session";
import { sessionStart } from "../../../src/cli/hooks/session-start";
import type { SessionRecord } from "../../../src/domain/hooks/session";
import { latestModel } from "../../../src/domain/hooks/session";

const now = new Date("2026-09-22T12:00:00.000Z");

function ctx(overrides: Partial<OmpContext> = {}): OmpContext {
  return {
    cwd: "/work",
    hasUI: true,
    sessionManager: { getSessionId: () => "omp-1" },
    model: { id: "anthropic/claude-opus-5" },
    ...overrides,
  };
}

describe("the session record", () => {
  test("has the same shape the CLI hook writes, field for field", async () => {
    const written: SessionRecord[] = [];
    await sessionStart(
      JSON.stringify({
        session_id: "omp-1",
        model: "anthropic/claude-opus-5",
        source: "startup",
        cwd: "/work",
      }),
      {
        record: async (entry) => {
          written.push(entry);
        },
        clock: { now: () => now },
        harness: "omp",
      },
    );
    expect(sessionRecordOf(ctx(), now)).toEqual(written[0] as SessionRecord);
  });

  test("a model the session declines to name is absent, not empty", () => {
    const entry = sessionRecordOf(ctx({ model: undefined }), now);
    expect(entry).toEqual({
      session_id: "omp-1",
      harness: "omp",
      recorded_at: now.toISOString(),
      source: "startup",
    });
    expect(entry !== undefined && "model" in entry).toBe(false);
  });

  test("a bare string model is unwrapped like the object form", () => {
    expect(sessionRecordOf(ctx({ model: "gpt-6-astra" }), now)?.model).toBe("gpt-6-astra");
  });

  test("a session that cannot name itself writes nothing", async () => {
    const written: SessionRecord[] = [];
    const out = await recordSession(ctx({ sessionManager: undefined }), {
      now: () => now,
      record: async (entry) => {
        written.push(entry);
      },
    });
    expect(out).toBeUndefined();
    expect(written).toHaveLength(0);
  });

  test("a log that cannot be written never fails the session start", async () => {
    const out = await recordSession(ctx(), {
      now: () => now,
      record: async () => {
        throw new Error("read-only filesystem");
      },
    });
    expect(out).toBeUndefined();
  });

  test("the line it writes is the line the model lookup reads back", async () => {
    const lines: string[] = [];
    const entry = await recordSession(ctx(), {
      now: () => now,
      record: async (written) => {
        lines.push(JSON.stringify(written));
      },
    });
    expect(entry?.harness).toBe("omp");
    expect(latestModel(lines.join("\n"), "omp-1")).toBe("anthropic/claude-opus-5");
  });
});
