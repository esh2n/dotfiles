import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_CONTINUATIONS,
  gateCommandFor,
  gateOnStop,
  resetGate,
  tail,
} from "../../../adapters/omp/src/gate";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import type { CommandResult, Runner } from "../../../adapters/omp/src/run";

const ctx: OmpContext = {
  cwd: "/repo",
  hasUI: true,
  sessionManager: { getSessionId: () => "s-1" },
};

const exists = (names: readonly string[]) => (path: string) =>
  names.some((name) => path === `/repo/${name}`);

function runner(result: Partial<CommandResult>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

beforeEach(() => {
  resetGate();
});

describe("which check a project answers to", () => {
  const label = (names: readonly string[]): string | undefined => {
    const table = gateCommandFor("/repo", exists(names));
    return table.kind === "run" ? table.commands[0]?.label : undefined;
  };

  test("is decided by what is in its root", () => {
    expect(label(["tsconfig.json"])).toBe("bunx tsc --noEmit");
    expect(label(["go.mod"])).toBe("go vet ./...");
    expect(label(["pyproject.toml"])).toBe("ruff check");
    expect(label(["Cargo.toml"])).toBe("cargo check");
    expect(gateCommandFor("/repo", exists(["README.md"]))).toEqual({
      kind: "nothing",
      reason: "no-check",
    });
  });

  test("the seven languages of the all-languages ruling, through the same wrapper", () => {
    expect(label(["CMakeLists.txt", "build"])).toBe("cmake --build build");
    expect(label(["pom.xml"])).toBe("mvn -q compile");
    expect(label(["build.gradle.kts", "gradlew", "src/main/kotlin"])).toBe(
      "./gradlew -q compileKotlin",
    );
    expect(label(["Package.swift"])).toBe("swift build");
    // File-scoped: the wrapper's default readDir and no list is "git could not say".
    expect(gateCommandFor("/repo", exists(["composer.json"]))).toEqual({
      kind: "nothing",
      reason: "no-git",
    });
    expect(gateCommandFor("/repo", exists(["cpanfile"]), ["lib/A.pm"])).toEqual({
      kind: "run",
      commands: [{ label: "perl -c lib/A.pm", bin: "perl", args: ["-c", "lib/A.pm"] }],
    });
    expect(
      gateCommandFor("/repo", exists([]), undefined, () => ["App.csproj"]).kind === "run",
    ).toBe(true);
  });
});

describe("gateOnStop", () => {
  test("a project with no check lets the session settle without running anything", async () => {
    const { run, calls } = runner({});
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["README.md"]),
    });
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("a passing check says nothing", async () => {
    const { run, calls } = runner({ code: 0 });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
    });
    expect(out).toBeUndefined();
    expect(calls).toEqual([["bunx", "tsc", "--noEmit"]]);
  });

  test("a failing check asks for one continuation, carrying the tail of the output", async () => {
    const { run } = runner({ code: 2, stdout: "src/a.ts(3,1): error TS2322: nope" });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
    });
    expect(out?.continue).toBe(true);
    expect(out?.decision).toBeUndefined(); // advisory, never a hard block
    expect(out?.additionalContext).toContain("bunx tsc --noEmit");
    expect(out?.additionalContext).toContain("error TS2322");
    expect(out?.additionalContext).toContain(`continuation 1 of ${MAX_CONTINUATIONS}`);
  });

  test("the cap is two per session, then the turn ends whatever the gate says", async () => {
    const { run, calls } = runner({ code: 1, stderr: "boom" });
    const deps = { run, exists: exists(["go.mod"]) };
    expect((await gateOnStop({ session_id: "s-1" }, ctx, deps))?.continue).toBe(true);
    expect((await gateOnStop({ session_id: "s-1" }, ctx, deps))?.continue).toBe(true);
    expect(await gateOnStop({ session_id: "s-1" }, ctx, deps)).toBeUndefined();
    // The third stop does not even run the check.
    expect(calls).toHaveLength(2);
    // Another session has its own budget.
    expect((await gateOnStop({ session_id: "s-2" }, ctx, deps))?.continue).toBe(true);
  });

  test("a toolchain that is not installed is not a failing check", async () => {
    const { run } = runner({ code: 127, missing: true, stderr: "not found" });
    expect(
      await gateOnStop({ session_id: "s-1" }, ctx, { run, exists: exists(["Cargo.toml"]) }),
    ).toBeUndefined();
  });

  test("a subagent stop is skipped entirely", async () => {
    const { run, calls } = runner({ code: 1 });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
      isSubagent: () => true,
    });
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("the session id falls back to the context when the event omits it", async () => {
    const { run } = runner({ code: 1, stderr: "x" });
    const deps = { run, exists: exists(["go.mod"]) };
    expect((await gateOnStop({}, ctx, deps))?.continue).toBe(true);
    expect((await gateOnStop({}, ctx, deps))?.continue).toBe(true);
    expect(await gateOnStop({ session_id: "s-1" }, ctx, deps)).toBeUndefined();
  });
});

describe("a project with its own hooks", () => {
  const lefthook = exists(["lefthook.yml", "tsconfig.json", "src/a.ts"]);
  const changedFiles = (files: readonly string[] | undefined) => async () => files;

  test("lefthook on the files this turn touched, not the table's tsc", async () => {
    const { run, calls } = runner({ code: 1, stderr: "lint failed" });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: lefthook,
      changedFiles: changedFiles(["src/a.ts"]),
    });
    expect(calls).toEqual([["lefthook", "run", "pre-commit", "--file", "src/a.ts"]]);
    expect(out?.continue).toBe(true);
    expect(out?.additionalContext).toContain("lefthook run pre-commit (1 file)");
    expect(out?.additionalContext).toContain("lint failed");
  });

  test("nothing changed, or git absent: the session settles without the table", async () => {
    const { run, calls } = runner({ code: 1 });
    expect(
      await gateOnStop({ session_id: "s-1" }, ctx, {
        run,
        exists: lefthook,
        changedFiles: changedFiles([]),
      }),
    ).toBeUndefined();
    expect(
      await gateOnStop({ session_id: "s-1" }, ctx, {
        run,
        exists: lefthook,
        changedFiles: changedFiles(undefined),
      }),
    ).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("a file-scoped table gate asks git at the cwd and runs one process per touched file", async () => {
    const { run, calls } = runner({ code: 0 });
    const asked: string[] = [];
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["composer.json", "src/A.php", "src/B.php", "phpstan.neon"]),
      changedFiles: async (cwd) => {
        asked.push(cwd);
        return ["src/A.php", "src/B.php", "README.md"];
      },
    });
    expect(out).toBeUndefined();
    expect(asked).toEqual(["/repo"]);
    expect(calls).toEqual([
      ["php", "-l", "src/A.php"],
      ["php", "-l", "src/B.php"],
      ["phpstan", "analyse", "--no-progress", "src/A.php", "src/B.php"],
    ]);
  });

  test("a table tool that is not installed is skipped and the rest of the plan still runs", async () => {
    const calls: string[][] = [];
    const run: Runner = async (bin, args) => {
      calls.push([bin, ...args]);
      return bin === "php"
        ? { code: 0, stdout: "", stderr: "", missing: false }
        : { code: 127, stdout: "", stderr: "", missing: true };
    };
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["composer.json", "src/A.php", "phpstan.neon.dist"]),
      changedFiles: async () => ["src/A.php"],
    });
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  test("the first failing command of a plan is the one reported", async () => {
    const run: Runner = async (bin, args) =>
      args.includes("src/B.php")
        ? { code: 255, stdout: "PHP Parse error in src/B.php", stderr: "", missing: false }
        : { code: 0, stdout: "", stderr: "", missing: false };
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["composer.json", "src/A.php", "src/B.php"]),
      changedFiles: async () => ["src/A.php", "src/B.php"],
    });
    expect(out?.continue).toBe(true);
    expect(out?.additionalContext).toContain("`php -l src/B.php` failed (exit 255)");
    expect(out?.additionalContext).toContain("PHP Parse error");
  });

  test("a whole-project table gate never asks git", async () => {
    const { run } = runner({ code: 0 });
    const asked: string[] = [];
    await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["Cargo.toml"]),
      changedFiles: async (cwd) => {
        asked.push(cwd);
        return [];
      },
    });
    expect(asked).toEqual([]);
  });

  test("the tool is not installed: told once per session, never the table", async () => {
    const { run, calls } = runner({ missing: true, code: 127 });
    const deps = { run, exists: lefthook, changedFiles: changedFiles(["src/a.ts"]) };
    const first = await gateOnStop({ session_id: "s-1" }, ctx, deps);
    expect(first?.continue).toBe(true);
    expect(first?.additionalContext).toContain("`lefthook` is not on PATH");
    expect(first?.additionalContext).not.toContain("\n");
    expect(await gateOnStop({ session_id: "s-1" }, ctx, deps)).toBeUndefined();
    expect(calls).toEqual([
      ["lefthook", "run", "pre-commit", "--file", "src/a.ts"],
      ["lefthook", "run", "pre-commit", "--file", "src/a.ts"],
    ]);
    // Another session is told too.
    expect((await gateOnStop({ session_id: "s-2" }, ctx, deps))?.continue).toBe(true);
  });
});

describe("tail", () => {
  test("keeps the end, which is where the errors are", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const kept = tail(text, 3);
    expect(kept).toBe("line 97\nline 98\nline 99");
  });

  test("is bounded in characters as well as lines", () => {
    expect(tail("x".repeat(9_000), 40, 100)).toHaveLength(100);
  });
});
