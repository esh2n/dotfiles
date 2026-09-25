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

describe("a project with its own hooks", () => {
  const lefthook = exists(["lefthook.yml", "tsconfig.json", "src/a.ts", "b.md"]);
  const changedFiles = (files: readonly string[] | undefined) => {
    const asked: string[] = [];
    const collect = async (cwd: string) => {
      asked.push(cwd);
      return files;
    };
    return { collect, asked };
  };

  test("lefthook.yml: lefthook on the files this turn touched, not the table's tsc", async () => {
    const { run, calls } = runner({ code: 1, stderr: "lint: src/a.ts is not formatted" });
    const git = changedFiles(["src/a.ts", "b.md"]);
    const out = await stopGate(payload(), { run, exists: lefthook, changedFiles: git.collect });

    expect(git.asked).toEqual(["/repo"]);
    expect(calls).toEqual([
      ["lefthook", "run", "pre-commit", "--file", "src/a.ts", "--file", "b.md"],
    ]);
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("lefthook run pre-commit (2 files)");
    expect(decision.reason).toContain("is not formatted");
    expect(decision.reason).toContain("once per turn");
  });

  test(".pre-commit-config.yaml: pre-commit --files with every touched file", async () => {
    const { run, calls } = runner({ code: 0 });
    await stopGate(payload(), {
      run,
      exists: exists([".pre-commit-config.yaml", "x.py", "y.py"]),
      changedFiles: changedFiles(["x.py", "y.py"]).collect,
    });
    expect(calls).toEqual([["pre-commit", "run", "--files", "x.py", "y.py"]]);
  });

  test("nothing changed, or git absent: nothing runs and the turn ends — never the table", async () => {
    const { run, calls } = runner({ code: 1 });
    expect(
      await stopGate(payload(), { run, exists: lefthook, changedFiles: changedFiles([]).collect }),
    ).toBe("");
    expect(
      await stopGate(payload(), {
        run,
        exists: lefthook,
        changedFiles: changedFiles(undefined).collect,
      }),
    ).toBe("");
    expect(calls).toEqual([]);
  });

  test("the tool is not installed: one block telling the owner to install it, not the table", async () => {
    const { run, calls } = runner({ missing: true, code: 127 });
    const out = await stopGate(payload(), {
      run,
      exists: lefthook,
      changedFiles: changedFiles(["src/a.ts"]).collect,
    });

    expect(calls).toEqual([["lefthook", "run", "pre-commit", "--file", "src/a.ts"]]);
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).not.toContain("\n");
    expect(decision.reason).toContain("`lefthook` is not on PATH");
    expect(decision.reason).toContain("`lefthook.yml`");
    expect(decision.reason).toContain("does not substitute");
  });

  test("...and stop_hook_active is what makes that once", async () => {
    const { run, calls } = runner({ missing: true, code: 127 });
    expect(
      await stopGate(payload({ stop_hook_active: true }), {
        run,
        exists: lefthook,
        changedFiles: changedFiles(["src/a.ts"]).collect,
      }),
    ).toBe("");
    expect(calls).toEqual([]);
  });

  test("a project without a hook config never asks git", async () => {
    const { run } = runner({ code: 0 });
    const git = changedFiles(["src/a.ts"]);
    await stopGate(payload(), {
      run,
      exists: exists(["tsconfig.json"]),
      changedFiles: git.collect,
    });
    expect(git.asked).toEqual([]);
  });
});

describe("which check a project answers to", () => {
  test("the project's own, one per project", async () => {
    const cases: [string, string[]][] = [
      ["go.mod", ["go", "vet", "./..."]],
      ["pyproject.toml", ["ruff", "check", "."]],
      ["Cargo.toml", ["cargo", "check", "--quiet"]],
      ["pom.xml", ["mvn", "-q", "compile"]],
      ["Package.swift", ["swift", "build"]],
    ];
    for (const [marker, expected] of cases) {
      const { run, calls } = runner({ code: 0 });
      await stopGate(payload(), { run, exists: exists([marker]) });
      expect(calls).toEqual([expected]);
    }
  });

  test("a .csproj at the cwd is found by listing it, and named on the command line", async () => {
    const { run, calls } = runner({ code: 0 });
    await stopGate(payload(), {
      run,
      exists: exists([]),
      readDir: (dir) => (dir === "/repo" ? ["App.csproj", "Program.cs"] : []),
    });
    expect(calls).toEqual([
      ["dotnet", "build", "/repo/App.csproj", "--no-restore", "--nologo", "-clp:ErrorsOnly"],
    ]);
  });

  test("a file-scoped gate asks git at the cwd and runs one process per touched file, in order", async () => {
    const asked: string[] = [];
    const calls: string[][] = [];
    const run: Runner = async (bin, args) => {
      calls.push([bin, ...args]);
      return args.includes("lib/B.pm")
        ? {
            code: 255,
            stdout: "",
            stderr: 'syntax error at lib/B.pm line 3, near "}"',
            missing: false,
          }
        : { code: 0, stdout: "", stderr: "lib/A.pm syntax OK", missing: false };
    };
    const out = await stopGate(payload(), {
      run,
      exists: exists(["cpanfile", "lib/A.pm", "lib/B.pm", "lib/C.pm"]),
      changedFiles: async (cwd) => {
        asked.push(cwd);
        return ["lib/A.pm", "lib/B.pm", "lib/C.pm", "README.md"];
      },
    });

    expect(asked).toEqual(["/repo"]);
    // Stops at the first failure; C is not reached.
    expect(calls).toEqual([
      ["perl", "-c", "lib/A.pm"],
      ["perl", "-c", "lib/B.pm"],
    ]);
    const decision = blocked(out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("`perl -c lib/B.pm` failed (exit 255)");
    expect(decision.reason).toContain("syntax error at lib/B.pm");
  });

  test("a table tool that is not installed is skipped; the rest of the plan still decides", async () => {
    const calls: string[][] = [];
    const run: Runner = async (bin, args) => {
      calls.push([bin, ...args]);
      return bin === "php"
        ? { code: 0, stdout: "No syntax errors detected", stderr: "", missing: false }
        : { code: 127, stdout: "", stderr: "", missing: true };
    };
    const out = await stopGate(payload(), {
      run,
      exists: exists(["composer.json", "phpstan.neon", "src/A.php"]),
      changedFiles: async () => ["src/A.php"],
    });
    expect(out).toBe("");
    expect(calls).toEqual([
      ["php", "-l", "src/A.php"],
      ["phpstan", "analyse", "--no-progress", "src/A.php"],
    ]);
  });

  test("a CMake project with no build tree lets the turn end", async () => {
    const { run, calls } = runner({ code: 1 });
    expect(await stopGate(payload(), { run, exists: exists(["CMakeLists.txt"]) })).toBe("");
    expect(calls).toEqual([]);
  });
});
