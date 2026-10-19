import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult, Runner } from "../../../src/domain/hooks/run";
import { runCommand } from "../../../src/infra/proc/exec-file";
import { GIT_LOCAL_ENV, packHistoryWith } from "../../../src/infra/proc/pack-history";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "", missing: false });
const failed: RunResult = { code: 128, stdout: "", stderr: "fatal", missing: false };
const missing: RunResult = { code: 127, stdout: "", stderr: "", missing: true };
const SHA = "019a6a20592c10bf92869e5740368f578a9997fd";
const NEW = "1111111111111111111111111111111111111111";
const SAFE = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

function git(result: RunResult): {
  run: Runner;
  calls: { args: readonly string[]; cwd: string; unset: readonly string[] }[];
} {
  const calls: { args: readonly string[]; cwd: string; unset: readonly string[] }[] = [];
  const run: Runner = async (bin, args, options) => {
    calls.push({ args: [bin, ...args], cwd: options.cwd, unset: options.unsetEnv ?? [] });
    return result;
  };
  return { run, calls };
}

describe("packHistory.head", () => {
  test("the HEAD of a checkout whose top is the directory", async () => {
    const { run, calls } = git(ok(`\n${SHA}\n`));
    expect(await packHistoryWith(run).head("/p/pstack")).toBe(SHA);
    expect(calls[0]?.args).toEqual(["git", ...SAFE, "rev-parse", "--show-prefix", "HEAD"]);
    expect(calls[0]?.cwd).toBe("/p/pstack");
  });

  test("every git local environment variable is dropped", async () => {
    const { run, calls } = git(ok(`\n${SHA}\n`));
    await packHistoryWith(run).head("/p");
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_INDEX_FILE",
      "GIT_NAMESPACE",
      "GIT_CEILING_DIRECTORIES",
      "GIT_PREFIX",
      "GIT_CONFIG",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_COUNT",
      "GIT_GRAFT_FILE",
      "GIT_IMPLICIT_WORK_TREE",
      "GIT_NO_REPLACE_OBJECTS",
      "GIT_REPLACE_REF_BASE",
      "GIT_SHALLOW_FILE",
    ]) {
      expect(calls[0]?.unset).toContain(name);
    }
    expect(calls[0]?.unset).toEqual(GIT_LOCAL_ENV);
  });

  test("a directory inside some other repository is not a pack checkout", async () => {
    const { run } = git(ok(`share/jig/plugins/pstack/\n${SHA}\n`));
    expect(await packHistoryWith(run).head("/p/pstack")).toBeUndefined();
  });

  test("not a repository, or no git: undefined", async () => {
    expect(await packHistoryWith(git(failed).run).head("/p")).toBeUndefined();
    expect(await packHistoryWith(git(missing).run).head("/p")).toBeUndefined();
  });
});

describe("packHistory.changedFiles", () => {
  test("the NUL-separated paths that differ between the two commits", async () => {
    const { run, calls } = git(ok("pstack/a.md\0pstack/b c.md\0"));
    expect(await packHistoryWith(run).changedFiles("/p", SHA, NEW)).toEqual([
      "pstack/a.md",
      "pstack/b c.md",
    ]);
    expect(calls[0]?.args).toEqual([
      "git",
      ...SAFE,
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      SHA,
      NEW,
    ]);
  });

  test("a commit a shallow checkout does not hold: undefined", async () => {
    expect(await packHistoryWith(git(failed).run).changedFiles("/p", SHA, NEW)).toBeUndefined();
  });
});

describe("packHistory against real git", () => {
  const hasGit = (() => {
    try {
      execFileSync("git", ["--version"]);
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!hasGit)("only the top of a checkout answers; a subdirectory does not", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "jig-pack-history-")));
    try {
      const sh = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      sh("init", "-q");
      sh("config", "user.email", "t@example.invalid");
      sh("config", "user.name", "t");
      mkdirSync(join(root, "pstack"));
      writeFileSync(join(root, "pstack", "a.md"), "one\n");
      sh("add", ".");
      sh("commit", "-q", "-m", "one");
      const first = sh("rev-parse", "HEAD");
      writeFileSync(join(root, "pstack", "a.md"), "two\n");
      sh("commit", "-q", "-am", "two");
      const second = sh("rev-parse", "HEAD");

      const history = packHistoryWith(runCommand);
      expect(await history.head(root)).toBe(second);
      expect(await history.head(join(root, "pstack"))).toBeUndefined();
      expect(await history.changedFiles(root, first, second)).toEqual(["pstack/a.md"]);
      expect(await history.changedFiles(root, "f".repeat(40), second)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
