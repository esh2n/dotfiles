import { describe, expect, test } from "bun:test";
import { stopGate } from "../../src/cli/hooks/stop-gate";
import type { RunResult, Runner } from "../../src/domain/hooks/run";

const exists = (names: readonly string[]) => (path: string) =>
  names.some((name) => path === `/repo/${name}`);

function runner(result: Partial<RunResult> = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ cwd: "/repo", stop_hook_active: false, ...over });

const blocked = (out: string): { decision: string; reason: string } =>
  JSON.parse(out) as { decision: string; reason: string };

describe("the gate runs once", () => {
  test("stop_hook_active ends the turn without running anything", async () => {
    const { run, calls } = runner({ code: 1 });
    expect(await stopGate(payload({ stop_hook_active: true }), { run, exists: exists([]) })).toBe(
      "",
    );
    expect(calls).toEqual([]);
  });

  test("a failing check blocks once, naming the command and its exit code", async () => {
    const { run, calls } = runner({ code: 2, stdout: "src/a.ts(3,1): error TS2304" });
    const out = await stopGate(payload(), { run, exists: exists(["tsconfig.json"]) });

    expect(calls).toEqual([["bunx", "tsc", "--noEmit"]]);
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("bunx tsc --noEmit");
    expect(decision.reason).toContain("exit 2");
    expect(decision.reason).toContain("error TS2304");
    expect(decision.reason).toContain("once per turn");
  });

  test("the failure output is trimmed to its tail, not pasted whole", async () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const { run } = runner({ code: 1, stdout: long });
    const reason = blocked(
      await stopGate(payload(), { run, exists: exists(["tsconfig.json"]) }),
    ).reason;

    expect(reason).toContain("line 499");
    expect(reason).not.toContain("line 100");
  });
});

describe("what lets the turn end", () => {
  test("a passing check", async () => {
    const { run } = runner({ code: 0 });
    expect(await stopGate(payload(), { run, exists: exists(["tsconfig.json"]) })).toBe("");
  });

  test("a project with no recognized check", async () => {
    const { run, calls } = runner({ code: 1 });
    expect(await stopGate(payload(), { run, exists: exists(["README.md"]) })).toBe("");
    expect(calls).toEqual([]);
  });

  test("a toolchain that is not installed is not a failing check", async () => {
    const { run } = runner({ missing: true, code: 127 });
    expect(await stopGate(payload(), { run, exists: exists(["tsconfig.json"]) })).toBe("");
  });

  test("unparseable input, and a runner that throws", async () => {
    const { run } = runner({ code: 1 });
    expect(await stopGate("not json", { run, exists: exists(["tsconfig.json"]) })).toBe("");

    const throwing: Runner = async () => {
      throw new Error("spawn failed");
    };
    expect(await stopGate(payload(), { run: throwing, exists: exists(["tsconfig.json"]) })).toBe(
      "",
    );
  });
});

describe("which check a project answers to", () => {
  test("the project's own, one per project", async () => {
    const cases: [string, string[]][] = [
      ["go.mod", ["go", "vet", "./..."]],
      ["pyproject.toml", ["ruff", "check", "."]],
      ["Cargo.toml", ["cargo", "check", "--quiet"]],
    ];
    for (const [marker, expected] of cases) {
      const { run, calls } = runner({ code: 0 });
      await stopGate(payload(), { run, exists: exists([marker]) });
      expect(calls).toEqual([expected]);
    }
  });
});
