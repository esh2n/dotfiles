import { afterEach, describe, expect, test } from "bun:test";
import {
  type DshStoppingAgent,
  type DshUserMessage,
  MAX_CONTINUATIONS,
  gateOnTurnStopping,
  resetGate,
} from "../../../adapters/dsh/src/gate";
import type { RunResult, Runner } from "../../../src/domain/hooks/run";

afterEach(() => resetGate());

function agent(
  id: string,
  extra: { cwd?: string; origin?: "subagent" } = { cwd: "/p" },
): { agent: DshStoppingAgent; steered: DshUserMessage[] } {
  const steered: DshUserMessage[] = [];
  return {
    agent: { session: { header: { id, ...extra } }, steer: (m) => steered.push(m) },
    steered,
  };
}

function runner(result: Partial<RunResult>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

/** A TypeScript project: tsconfig.json at /p. */
const exists = (path: string) => path === "/p/tsconfig.json" || path === "/p/.git";
const readDir = () => [];
const changedFiles = async () => ["src/a.ts"];

describe("gateOnTurnStopping", () => {
  test("a passing check lets the turn close and steers nothing", async () => {
    const { run, calls } = runner({ code: 0 });
    const { agent: a, steered } = agent("s1");
    expect(await gateOnTurnStopping(a, { run, exists, readDir, changedFiles })).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
    expect(steered).toHaveLength(0);
  });

  test("a failing check steers the failure back as a user message", async () => {
    const { run } = runner({ code: 2, stdout: "src/a.ts(1,1): error TS2322" });
    const { agent: a, steered } = agent("s2");
    const text = await gateOnTurnStopping(a, { run, exists, readDir, changedFiles });
    expect(text).toContain("continuation 1 of 2");
    expect(steered).toHaveLength(1);
    expect(steered[0]?.role).toBe("user");
    expect(steered[0]?.content[0]?.text).toContain("error TS2322");
    expect(steered[0]?.source).toEqual({ kind: "plugin", plugin: "jig-guard" });
  });

  test("the cap holds: after two continuations the turn closes whatever the check says", async () => {
    const { run } = runner({ code: 1 });
    const { agent: a, steered } = agent("s3");
    for (let i = 0; i < MAX_CONTINUATIONS + 2; i++) {
      await gateOnTurnStopping(a, { run, exists, readDir, changedFiles });
    }
    expect(steered).toHaveLength(MAX_CONTINUATIONS);
  });

  test("the cap is per session", async () => {
    const { run } = runner({ code: 1 });
    const first = agent("s4");
    const second = agent("s5");
    for (let i = 0; i < MAX_CONTINUATIONS; i++) {
      await gateOnTurnStopping(first.agent, { run, exists, readDir, changedFiles });
    }
    await gateOnTurnStopping(second.agent, { run, exists, readDir, changedFiles });
    expect(second.steered).toHaveLength(1);
  });

  test("a subagent's turn is not gated", async () => {
    const { run, calls } = runner({ code: 1 });
    const { agent: a, steered } = agent("s6", { cwd: "/p", origin: "subagent" });
    await gateOnTurnStopping(a, { run, exists, readDir, changedFiles });
    expect(calls).toHaveLength(0);
    expect(steered).toHaveLength(0);
  });

  test("a toolchain that is not installed is not a failure", async () => {
    const { run } = runner({ missing: true, code: 127 });
    const { agent: a, steered } = agent("s7");
    await gateOnTurnStopping(a, { run, exists, readDir, changedFiles });
    expect(steered).toHaveLength(0);
  });

  test("a directory with nothing to check runs nothing", async () => {
    const { run, calls } = runner({ code: 1 });
    const { agent: a } = agent("s8");
    await gateOnTurnStopping(a, { run, exists: () => false, readDir, changedFiles });
    expect(calls).toHaveLength(0);
  });
});
