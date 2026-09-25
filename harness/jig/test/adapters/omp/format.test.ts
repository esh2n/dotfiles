import { describe, expect, test } from "bun:test";
import { formatOnResult, formatterFor, projectRoot } from "../../../adapters/omp/src/format";
import type { CommandResult, Runner } from "../../../adapters/omp/src/run";

const exists = (paths: readonly string[]) => (path: string) => paths.includes(path);

function runner(result: Partial<CommandResult> = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

describe("which formatter a file gets", () => {
  test("biome when the project configures it, the vendored binary when there is one", () => {
    expect(
      formatterFor(
        "/repo/src/a.ts",
        "/repo",
        exists(["/repo/biome.json", "/repo/node_modules/.bin/biome"]),
      ),
    ).toEqual({
      bin: "/repo/node_modules/.bin/biome",
      args: ["check", "--write", "/repo/src/a.ts"],
    });
    expect(formatterFor("/repo/src/a.ts", "/repo", exists(["/repo/biome.json"]))?.bin).toBe(
      "biome",
    );
  });

  test("prettier when biome is not configured", () => {
    expect(formatterFor("/repo/src/a.tsx", "/repo", exists([]))).toEqual({
      bin: "prettier",
      args: ["--write", "/repo/src/a.tsx"],
    });
  });

  test("each language brings its own", () => {
    expect(formatterFor("/repo/main.go", "/repo", exists([]))?.bin).toBe("gofmt");
    expect(formatterFor("/repo/main.py", "/repo", exists([]))?.bin).toBe("ruff");
    expect(formatterFor("/repo/main.rs", "/repo", exists([]))?.bin).toBe("rustfmt");
    expect(formatterFor("/repo/main.cpp", "/repo", exists([]))?.bin).toBe("clang-format");
    expect(formatterFor("/repo/Main.java", "/repo", exists([]))?.bin).toBe("google-java-format");
    expect(formatterFor("/repo/Main.kt", "/repo", exists([]))?.bin).toBe("ktfmt");
    expect(formatterFor("/repo/main.pl", "/repo", exists([]))?.bin).toBe("perltidy");
    expect(formatterFor("/repo/main.php", "/repo", exists([]))?.bin).toBe("pint");
    expect(formatterFor("/repo/main.swift", "/repo", exists([]))?.bin).toBe("swiftformat");
    // C# through the wrapper's readDir default: no project on disk, so a skip.
    expect(formatterFor("/repo/Program.cs", "/repo", exists([]))).toBeUndefined();
    expect(
      formatterFor("/repo/Program.cs", "/repo", exists([]), undefined, () => ["App.csproj"]),
    ).toEqual({
      bin: "dotnet",
      args: ["format", "/repo/App.csproj", "--include", "Program.cs"],
    });
  });

  test("a file nothing formats is a skip, not an error", () => {
    expect(formatterFor("/repo/notes.md", "/repo", exists([]))).toBeUndefined();
  });
});

describe("the project root", () => {
  test("is the nearest ancestor carrying a marker", () => {
    expect(projectRoot("/repo/src/deep", exists(["/repo/package.json"]))).toBe("/repo");
    expect(projectRoot("/nowhere/src", exists([]))).toBe("/nowhere/src");
  });
});

describe("formatOnResult", () => {
  const present = exists(["/repo/go.mod", "/repo/src/a.go", "/repo/src/b.go"]);

  test("formats each file a hashline edit touched, and nothing else", async () => {
    const { run, calls } = runner();
    const formatted = await formatOnResult(
      {
        toolName: "edit",
        input: { input: "[src/a.go#1A2B]\nPUT >$:\n+x\n[src/b.go#FFFF]\nPUT >$:\n+y" },
        isError: false,
      },
      "/repo",
      { run, exists: present },
    );
    expect(formatted).toEqual(["/repo/src/a.go", "/repo/src/b.go"]);
    expect(calls).toEqual([
      ["gofmt", "-w", "/repo/src/a.go"],
      ["gofmt", "-w", "/repo/src/b.go"],
    ]);
  });

  test("a failed edit is not formatted", async () => {
    const { run, calls } = runner();
    await formatOnResult(
      { toolName: "edit", input: { path: "src/a.go" }, isError: true },
      "/repo",
      { run, exists: present },
    );
    expect(calls).toHaveLength(0);
  });

  test("a tool that is not an edit or a write is left alone", async () => {
    const { run, calls } = runner();
    await formatOnResult({ toolName: "bash", input: { command: "ls" } }, "/repo", {
      run,
      exists: present,
    });
    expect(calls).toHaveLength(0);
  });

  test("a formatter that is not installed is a skip", async () => {
    const { run } = runner({ missing: true, code: 127 });
    const formatted = await formatOnResult(
      { toolName: "write", input: { path: "src/a.go" }, isError: false },
      "/repo",
      { run, exists: present },
    );
    expect(formatted).toEqual([]);
  });

  test("a project with lefthook.yml gets lefthook on each edited file, not the table", async () => {
    const { run, calls } = runner();
    const formatted = await formatOnResult(
      { toolName: "write", input: { path: "src/a.go" }, isError: false },
      "/repo",
      { run, exists: exists(["/repo/lefthook.yml", "/repo/go.mod", "/repo/src/a.go"]) },
    );
    expect(formatted).toEqual(["/repo/src/a.go"]);
    expect(calls).toEqual([["lefthook", "run", "pre-commit", "--file", "src/a.go"]]);
  });

  test("a project hook runner that is not installed is a skip, not a fall-through to the table", async () => {
    const { run, calls } = runner({ missing: true, code: 127 });
    const formatted = await formatOnResult(
      { toolName: "write", input: { path: "src/a.go" }, isError: false },
      "/repo",
      { run, exists: exists(["/repo/.pre-commit-config.yaml", "/repo/go.mod", "/repo/src/a.go"]) },
    );
    expect(formatted).toEqual([]);
    expect(calls).toEqual([["pre-commit", "run", "--files", "src/a.go"]]);
  });

  test("a write to an internal resource is not a file to format", async () => {
    const { run, calls } = runner();
    await formatOnResult(
      { toolName: "write", input: { path: "xd://device" }, isError: false },
      "/repo",
      { run, exists: present },
    );
    expect(calls).toHaveLength(0);
  });
});
