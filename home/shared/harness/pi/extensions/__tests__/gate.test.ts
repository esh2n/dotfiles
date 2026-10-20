import { describe, expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// typebox comes from pi at run time and is not installed in this repository;
// gate.ts only builds a schema object with it.
mock.module("typebox", () => ({ Type: { Object: (o: unknown) => o, String: (o: unknown) => o } }));
const { default: gate } = await import("../gate");

type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean };
type Handler = (args: string, ctx: unknown) => Promise<void>;
type Tool = {
  execute: (
    id: string,
    params: { evidence: string },
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ isError?: boolean; content: { text: string }[] }>;
};

// A pi stand-in that records the commands and the tool gate.ts registers and
// answers exec with whatever the gate command should return.
function load(gateResult: ExecResult) {
  const commands = new Map<string, Handler>();
  let tool: Tool | undefined;
  const pi = {
    registerCommand: (name: string, spec: { handler: Handler }) => commands.set(name, spec.handler),
    registerTool: (spec: Tool) => {
      tool = spec;
    },
    on: () => {},
    // not a git repo: the unchanged-workspace check is skipped
    exec: async (_cmd: string, args: string[]) =>
      args[1]?.startsWith("git ") ? { stdout: "", stderr: "", code: 128, killed: false } : gateResult,
  };
  gate(pi as unknown as ExtensionAPI);
  const ctx = { ui: { notify: () => {}, setStatus: () => {} } };
  return {
    run: (name: string, args: string) => commands.get(name)?.(args, ctx),
    complete: () => tool?.execute("1", { evidence: "done" }, undefined, undefined, ctx),
  };
}

describe("goal_complete runs the gates", () => {
  test("a gate pi killed on timeout fails the goal instead of passing it", async () => {
    const g = load({ stdout: "", stderr: "", code: 0, killed: true });
    await g.run("goal", "ship it");
    await g.run("gate", "make test");
    const result = await g.complete();
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("timed out");
  });

  test("a gate that exits 0 closes the goal", async () => {
    const g = load({ stdout: "ok", stderr: "", code: 0, killed: false });
    await g.run("goal", "ship it");
    await g.run("gate", "make test");
    const result = await g.complete();
    expect(result?.isError).toBeUndefined();
    expect(result?.content[0]?.text).toContain("Goal closed");
  });

  test("a gate that exits non-zero keeps the goal open", async () => {
    const g = load({ stdout: "", stderr: "1 failing", code: 1, killed: false });
    await g.run("goal", "ship it");
    await g.run("gate", "make test");
    const result = await g.complete();
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("GATE FAILED (exit 1)");
  });
});
