import { describe, expect, test } from "bun:test";
import { postToolUseFormat } from "../../src/cli/hooks/post-tool-use-format";
import type { RunResult, Runner } from "../../src/domain/hooks/run";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);

function runner(result: Partial<RunResult> = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: "/repo/src/a.ts" },
    cwd: "/repo",
    ...over,
  });

const PROJECT = ["/repo/src/a.ts", "/repo/package.json", "/repo/biome.json"];

describe("what gets formatted", () => {
  test("the one file the edit tool named, and nothing else", async () => {
    const { run, calls } = runner();
    const formatted = await postToolUseFormat(payload(), { run, exists: exists(PROJECT) });

    expect(formatted).toBe("/repo/src/a.ts");
    expect(calls).toEqual([["biome", "check", "--write", "/repo/src/a.ts"]]);
  });

  test("a relative path is resolved against the payload's cwd", async () => {
    const { run, calls } = runner();
    await postToolUseFormat(payload({ tool_input: { file_path: "src/a.ts" } }), {
      run,
      exists: exists(PROJECT),
    });
    expect(calls[0]?.at(-1)).toBe("/repo/src/a.ts");
  });

  test("NotebookEdit's notebook_path counts as an edited file", async () => {
    const { run, calls } = runner();
    await postToolUseFormat(
      payload({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/repo/src/a.ts" } }),
      { run, exists: exists(PROJECT) },
    );
    expect(calls).toHaveLength(1);
  });
});

describe("what is skipped, silently", () => {
  test("Bash — it names no file, so the formatter has nothing to do", async () => {
    const { run, calls } = runner();
    const formatted = await postToolUseFormat(
      payload({ tool_name: "Bash", tool_input: { command: "ls" } }),
      { run, exists: exists(PROJECT) },
    );
    expect(formatted).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("a tool that reported an error", async () => {
    const { run, calls } = runner();
    await postToolUseFormat(payload({ tool_response: { error: "denied" } }), {
      run,
      exists: exists(PROJECT),
    });
    expect(calls).toEqual([]);
  });

  test("a file that no longer exists on disk", async () => {
    const { run, calls } = runner();
    await postToolUseFormat(payload(), { run, exists: exists(["/repo/package.json"]) });
    expect(calls).toEqual([]);
  });

  test("an extension nothing formats", async () => {
    const { run, calls } = runner();
    await postToolUseFormat(payload({ tool_input: { file_path: "/repo/notes.txt" } }), {
      run,
      exists: exists(["/repo/notes.txt", "/repo/package.json"]),
    });
    expect(calls).toEqual([]);
  });

  test("unparseable input never throws", async () => {
    const { run } = runner();
    expect(await postToolUseFormat("not json", { run, exists: exists([]) })).toBeUndefined();
  });

  test("a formatter that is not installed, and one that fails, both leave the file alone", async () => {
    const missing = runner({ missing: true, code: 1 });
    expect(await postToolUseFormat(payload(), { run: missing.run, exists: exists(PROJECT) })).toBe(
      undefined,
    );

    const failed = runner({ code: 2, stderr: "parse error" });
    expect(await postToolUseFormat(payload(), { run: failed.run, exists: exists(PROJECT) })).toBe(
      undefined,
    );
  });

  test("a runner that throws is swallowed — a formatter never interrupts a session", async () => {
    const run: Runner = async () => {
      throw new Error("spawn failed");
    };
    expect(await postToolUseFormat(payload(), { run, exists: exists(PROJECT) })).toBeUndefined();
  });
});
