import { describe, expect, test } from "bun:test";
import type { RunResult, Runner } from "../../../src/domain/hooks/run";
import { changedFilesWith } from "../../../src/infra/proc/changed-files";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "", missing: false });
const failed = (stderr: string): RunResult => ({ code: 128, stdout: "", stderr, missing: false });
const missing: RunResult = { code: 127, stdout: "", stderr: "", missing: true };

function git(results: { diff: RunResult; others: RunResult }): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args, options) => {
    calls.push([bin, ...args, `@${options.cwd}`]);
    return args[0] === "diff" ? results.diff : results.others;
  };
  return { run, calls };
}

describe("changedFiles", () => {
  test("the modified-tracked set plus the untracked set, relative to the cwd, deduplicated", async () => {
    const { run, calls } = git({
      diff: ok("src/a.ts\nsrc/b.ts\n"),
      others: ok("new.md\nsrc/b.ts\n"),
    });
    expect(await changedFilesWith(run)("/repo")).toEqual(["src/a.ts", "src/b.ts", "new.md"]);
    expect(calls).toEqual([
      ["git", "diff", "--name-only", "--relative", "HEAD", "@/repo"],
      ["git", "ls-files", "--others", "--exclude-standard", "@/repo"],
    ]);
  });

  test("git not installed: undefined, which the gate reports as no-git", async () => {
    const { run } = git({ diff: missing, others: missing });
    expect(await changedFilesWith(run)("/repo")).toBeUndefined();
  });

  test("not a repository: both commands fail, so undefined", async () => {
    const { run } = git({ diff: failed("fatal: not a git repository"), others: failed("fatal") });
    expect(await changedFilesWith(run)("/repo")).toBeUndefined();
  });

  test("a repository with no commit yet: no HEAD to diff against, the untracked set still counts", async () => {
    const { run } = git({ diff: failed("fatal: bad revision 'HEAD'"), others: ok("a.ts\n") });
    expect(await changedFilesWith(run)("/repo")).toEqual(["a.ts"]);
  });

  test("nothing changed: an empty list, not undefined", async () => {
    const { run } = git({ diff: ok(""), others: ok("\n") });
    expect(await changedFilesWith(run)("/repo")).toEqual([]);
  });
});
