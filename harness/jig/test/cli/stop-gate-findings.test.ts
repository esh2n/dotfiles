import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FindingsDeps, stopGate } from "../../src/cli/hooks/stop-gate";
import type { FindingsRule, SkillRunEvent } from "../../src/domain/hooks/findings-check";
import type { Runner } from "../../src/domain/hooks/run";
import { appendSkillRun, readSkillRuns } from "../../src/infra/logs/skill-run-log";

const RULE: FindingsRule = { reporters: ["code-reviewer"], verifier: "review-verifier" };
const pass: Runner = async () => ({ code: 0, stdout: "", stderr: "", missing: false });
const fail: Runner = async () => ({ code: 2, stdout: "error TS1", stderr: "", missing: false });
const exists = (path: string) => path === "/repo/tsconfig.json";

const base = { session: "s1", harness: "claude" };
const used: SkillRunEvent = {
  ...base,
  at: "2026-10-23T10:00:00.000Z",
  kind: "skill",
  name: "change-review",
};
const reported = (findings?: number): SkillRunEvent => ({
  ...base,
  at: "2026-10-23T10:00:05.000Z",
  kind: "subagent",
  agentType: "code-reviewer",
  ...(findings === undefined ? {} : { findings }),
});

function store(initial: readonly SkillRunEvent[]): {
  deps: FindingsDeps;
  written: SkillRunEvent[];
} {
  const written: SkillRunEvent[] = [];
  return {
    written,
    deps: {
      read: async () => [...initial, ...written],
      rules: (skill) => (skill === "change-review" ? RULE : undefined),
      record: async (event) => {
        written.push(event);
      },
      now: () => new Date("2026-10-23T10:01:00.000Z"),
      harness: "claude",
    },
  };
}

const stop = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    cwd: "/repo",
    session_id: "s1",
    stop_hook_active: false,
    background_tasks: [],
    ...over,
  });

const out = (text: string): Record<string, string> =>
  text === "" ? {} : (JSON.parse(text) as Record<string, string>);

describe("the findings check at Stop", () => {
  test("unverified findings stop the turn and the stop is recorded for the cap", async () => {
    const { deps, written } = store([used, reported(2)]);
    const result = out(await stopGate(stop(), { run: pass, exists, findings: deps }));
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("review-verifier");
    expect(result.reason).toContain("Stop 1 of 2");
    expect(written.map((e) => (e.kind === "gate" ? e.outcome : e.kind))).toEqual(["blocked"]);
  });

  test("it runs even on a hook-forced continuation; the typecheck does not", async () => {
    const { deps } = store([used, reported(1)]);
    const result = out(
      await stopGate(stop({ stop_hook_active: true }), { run: fail, exists, findings: deps }),
    );
    expect(result.reason).toContain("review-verifier");
    expect(result.reason).not.toContain("tsc");
  });

  test("both reasons reach the model when both fail", async () => {
    const { deps } = store([used, reported(1)]);
    const result = out(await stopGate(stop(), { run: fail, exists, findings: deps }));
    expect(result.reason).toContain("review-verifier");
    expect(result.reason).toContain("bunx tsc --noEmit");
  });

  test("a verifier in background_tasks lets the turn end", async () => {
    const { deps } = store([used, reported(1)]);
    const running = [
      { id: "t1", type: "subagent", status: "running", agent_type: "review-verifier" },
    ];
    expect(
      await stopGate(stop({ background_tasks: running }), { run: pass, exists, findings: deps }),
    ).toBe("");
  });

  test("after the cap the owner is told once, as a systemMessage, and the turn ends", async () => {
    const { deps } = store([used, reported(1)]);
    await stopGate(stop(), { run: pass, exists, findings: deps });
    await stopGate(stop(), { run: pass, exists, findings: deps });
    const third = out(await stopGate(stop(), { run: pass, exists, findings: deps }));
    expect(third.decision).toBeUndefined();
    expect(third.systemMessage).toContain("no review-verifier checked");
    expect(await stopGate(stop(), { run: pass, exists, findings: deps })).toBe("");
  });

  test("a report without the Findings line is said to the owner as not checked", async () => {
    const { deps } = store([used, reported()]);
    const result = out(await stopGate(stop(), { run: pass, exists, findings: deps }));
    expect(result.decision).toBeUndefined();
    expect(result.systemMessage).toContain("Not a pass");
  });

  test("a record that cannot be read is 'did not run', never silence", async () => {
    const { deps } = store([]);
    const broken = { ...deps, read: async () => Promise.reject(new Error("EACCES")) };
    const result = out(await stopGate(stop(), { run: pass, exists, findings: broken }));
    expect(result.systemMessage).toContain("did not run (EACCES)");
  });

  test("a record that cannot be written lets the turn end with 'did not run', so the stop stays bounded", async () => {
    const { deps } = store([used, reported(2)]);
    const broken = { ...deps, record: async () => Promise.reject(new Error("ENOSPC")) };
    const result = out(await stopGate(stop(), { run: pass, exists, findings: broken }));
    expect(result.decision).toBeUndefined();
    expect(result.systemMessage).toContain("did not run (ENOSPC)");
  });

  test("after a findings stop the typecheck still checks the continuation's edits, once", async () => {
    const { deps, written } = store([used, reported(1)]);
    await stopGate(stop(), { run: pass, exists, findings: deps });
    const second = out(
      await stopGate(stop({ stop_hook_active: true }), { run: fail, exists, findings: deps }),
    );
    expect(second.reason).toContain("bunx tsc --noEmit");
    expect(written.at(-1)?.kind).toBe("typecheck");
    // the typecheck's own block was the last: its next stop is the one it skips
    const verifier: SkillRunEvent = {
      ...base,
      at: "2026-10-23T10:00:30.000Z",
      kind: "subagent",
      agentType: "review-verifier",
    };
    written.push(verifier);
    expect(
      await stopGate(stop({ stop_hook_active: true }), { run: fail, exists, findings: deps }),
    ).toBe("");
  });

  test("a block and an owner notice in one stop both reach their reader", async () => {
    const other: FindingsRule = { reporters: ["test-reviewer"], verifier: "review-verifier" };
    const { deps } = store([
      used,
      reported(1),
      { ...base, at: "2026-10-23T10:00:01.000Z", kind: "skill", name: "tdd-check" },
      { ...base, at: "2026-10-23T10:00:06.000Z", kind: "subagent", agentType: "test-reviewer" },
    ]);
    const both = { ...deps, rules: (skill: string) => (skill === "tdd-check" ? other : RULE) };
    const result = out(await stopGate(stop(), { run: pass, exists, findings: both }));
    expect(result.decision).toBe("block");
    expect(result.systemMessage).toContain("Not a pass");
  });

  test("a running task that is not a subagent is not a running verifier", async () => {
    const { deps } = store([used, reported(1)]);
    const shell = [{ id: "t1", type: "shell", status: "running", agent_type: "review-verifier" }];
    const result = out(
      await stopGate(stop({ background_tasks: shell }), { run: pass, exists, findings: deps }),
    );
    expect(result.decision).toBe("block");
  });

  test("a stop with no session id skips the check", async () => {
    const { deps } = store([used, reported(1)]);
    expect(
      await stopGate(stop({ session_id: undefined }), { run: pass, exists, findings: deps }),
    ).toBe("");
  });
});

describe("the findings check over the real day files", () => {
  test("blocks twice, tells the owner once, then is silent: the cap survives the round trip", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "jig-gate-")), "skill-runs");
    await appendSkillRun(dir, used);
    await appendSkillRun(dir, {
      ...base,
      at: "2026-10-23T10:00:05.000Z",
      kind: "subagent",
      agentType: "code-reviewer",
      agentId: "a1",
      findings: 1,
    });
    const deps: FindingsDeps = {
      read: () => readSkillRuns(dir, new Date("2026-10-23T10:01:00.000Z")),
      rules: (skill) => (skill === "change-review" ? RULE : undefined),
      record: (event) => appendSkillRun(dir, event),
      now: () => new Date("2026-10-23T10:01:00.000Z"),
      harness: "claude",
    };
    const run = async () => out(await stopGate(stop(), { run: pass, exists, findings: deps }));
    expect((await run()).decision).toBe("block");
    expect((await run()).decision).toBe("block");
    expect((await run()).systemMessage).toContain("no review-verifier checked");
    expect(await stopGate(stop(), { run: pass, exists, findings: deps })).toBe("");
    await rm(dirname(dir), { recursive: true, force: true });
  });
});
