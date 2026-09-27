import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKTREES_DIR,
  type WorktreeDeps,
  changedFiles,
  createWorktree,
  removeMerged,
  repoRoot,
} from "../../../src/app/swarm/worktree";
import { runCommand } from "../../../src/infra/proc/exec-file";
import { nodeWorktreeFs } from "../../../src/infra/swarm/fs";

const deps: WorktreeDeps = { run: runCommand, fs: nodeWorktreeFs };
let root: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false'" },
  }).trim();
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "swarm-wt-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".env\n");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a worker's worktree", () => {
  test("lives at .claude/worktrees/<name> on a branch of the same name, from HEAD", async () => {
    expect(await repoRoot(deps, root)).toBe(root);
    const dir = await createWorktree(deps, root, "port-a");
    expect(dir).toBe(join(root, WORKTREES_DIR, "port-a"));
    expect(git(dir, "branch", "--show-current")).toBe("port-a");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("a\n");
  });

  test("stays out of git status through the local exclude file, not .gitignore", async () => {
    await createWorktree(deps, root, "port-a");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".env\n");
    expect(readFileSync(join(root, ".git/info/exclude"), "utf8")).toContain(".claude/worktrees/");
  });

  test("copies ignored files named in .worktreeinclude, and only those", async () => {
    writeFileSync(join(root, ".env"), "SECRET=x\n");
    writeFileSync(join(root, ".worktreeinclude"), ".env\n");
    const dir = await createWorktree(deps, root, "port-a");
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("SECRET=x\n");
  });

  test("a name already taken is an error, never reused", async () => {
    await createWorktree(deps, root, "port-a");
    expect(createWorktree(deps, root, "port-a")).rejects.toThrow("git worktree add");
  });

  test("the branch's changes are listed against where it started", async () => {
    const dir = await createWorktree(deps, root, "port-a");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "b");
    expect(await changedFiles(deps, root, "port-a")).toEqual(["b.txt"]);
  });
});

describe("cleanup", () => {
  test("removes a merged worktree of the swarm's and its branch", async () => {
    const dir = await createWorktree(deps, root, "port-a");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "b");
    git(root, "merge", "-q", "--no-ff", "-m", "merge", "port-a");
    expect(await removeMerged(deps, root, ["port-a"])).toEqual(["port-a"]);
    expect(existsSync(dir)).toBe(false);
    expect(git(root, "branch", "--list", "port-a")).toBe("");
  });

  test("keeps unmerged work", async () => {
    const dir = await createWorktree(deps, root, "port-a");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "b");
    expect(await removeMerged(deps, root, ["port-a"])).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  test("keeps a worktree with uncommitted changes even when its branch is merged", async () => {
    const dir = await createWorktree(deps, root, "port-a");
    writeFileSync(join(dir, "dirty.txt"), "x\n");
    expect(await removeMerged(deps, root, ["port-a"])).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  test("never touches a worktree the swarm did not create", async () => {
    const other = join(root, WORKTREES_DIR, "owners");
    git(root, "worktree", "add", "-q", "-b", "owners", other, "HEAD");
    expect(await removeMerged(deps, root, [])).toEqual([]);
    expect(existsSync(other)).toBe(true);
  });
});
