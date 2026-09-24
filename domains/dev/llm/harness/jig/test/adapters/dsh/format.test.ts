import { describe, expect, test } from "bun:test";
import { formatAfterExecute, writtenPath } from "../../../adapters/dsh/src/format";
import type { RunResult, Runner } from "../../../src/domain/hooks/run";

function runner(result: Partial<RunResult> = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

/** A TypeScript project at /p with prettier in package.json. */
const files: Record<string, string> = {
  "/p/package.json": JSON.stringify({ devDependencies: { prettier: "^3" } }),
  "/p/src/a.ts": "",
};
const exists = (path: string) => path in files || path === "/p/.git";
const readText = (path: string) => files[path];
const readDir = () => [];

describe("writtenPath", () => {
  test("write and edit carry file_path", () => {
    expect(writtenPath("write", { file_path: "/p/a.ts", content: "" })).toBe("/p/a.ts");
    expect(writtenPath("edit", { file_path: "/p/a.ts" })).toBe("/p/a.ts");
  });

  test("str_replace_editor writes on create, str_replace and insert, not on view", () => {
    for (const command of ["create", "str_replace", "insert"]) {
      expect(writtenPath("str_replace_editor", { command, path: "/p/a.ts" })).toBe("/p/a.ts");
    }
    expect(writtenPath("str_replace_editor", { command: "view", path: "/p/a.ts" })).toBeUndefined();
  });

  test("any other tool, or a malformed input, writes nothing", () => {
    expect(writtenPath("read", { file_path: "/p/a.ts" })).toBeUndefined();
    expect(writtenPath("bash", { command: "echo > /p/a.ts" })).toBeUndefined();
    expect(writtenPath("write", "not an object")).toBeUndefined();
    expect(writtenPath("write", { file_path: "" })).toBeUndefined();
  });
});

describe("formatAfterExecute", () => {
  test("a successful write of a known file runs one formatter on that file", async () => {
    const { run, calls } = runner();
    const out = await formatAfterExecute("write", { file_path: "src/a.ts" }, false, "/p", {
      run,
      exists,
      readText,
      readDir,
    });
    expect(out).toBe("/p/src/a.ts");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.join(" ")).toContain("/p/src/a.ts");
  });

  test("a failed tool call is not formatted", async () => {
    const { run, calls } = runner();
    await formatAfterExecute("write", { file_path: "/p/src/a.ts" }, true, "/p", {
      run,
      exists,
      readText,
      readDir,
    });
    expect(calls).toHaveLength(0);
  });

  test("a formatter that is not installed is a silent skip", async () => {
    const { run } = runner({ missing: true, code: 127 });
    const out = await formatAfterExecute("edit", { file_path: "/p/src/a.ts" }, false, "/p", {
      run,
      exists,
      readText,
      readDir,
    });
    expect(out).toBeUndefined();
  });

  test("a file that is not on disk is left alone", async () => {
    const { run, calls } = runner();
    await formatAfterExecute("write", { file_path: "/p/src/gone.ts" }, false, "/p", {
      run,
      exists,
      readText,
      readDir,
    });
    expect(calls).toHaveLength(0);
  });
});
