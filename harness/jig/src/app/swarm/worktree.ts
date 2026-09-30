/**
 * Isolation for a Swarm worker that must not share the checkout: a git
 * worktree at `.claude/worktrees/<name>` on a branch named `<name>` — the one
 * place and name every harness uses (the owner's ruling, 2026-09-27), and the
 * layout Claude Code's own worktrees already have in this repository.
 *
 * Merging back is the owner's call and plain git (`git merge --no-ff <name>`);
 * nothing here merges. Cleanup removes only worktrees the Swarm created
 * (recorded in its own list) whose branch is already merged — never an
 * owner's worktree, never unmerged work (`rules/decisions/2026-09-27-one-worktree-layout.md`:
 * 256 worktrees / 28 GB left behind when nobody cleans up;
 * cleanup that deletes unmerged work is worse).
 *
 * Files git ignores but a worker needs (`.env`) are copied when listed in
 * `.worktreeinclude` — the gitignore-syntax file Claude Code and Codex both
 * read for the same purpose — using git's own matcher, not a reimplementation.
 */

import type { Runner } from "../../domain/hooks/run";

export const WORKTREES_DIR = ".claude/worktrees";
const GIT_TIMEOUT_MS = 60_000;

/** The file operations this module needs; `infra/swarm/fs.ts` implements them. */
export interface WorktreeFs {
  readFile(path: string): Promise<string | undefined>;
  appendFile(path: string, text: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
}

export interface WorktreeDeps {
  readonly run: Runner;
  readonly fs: WorktreeFs;
}

async function git(deps: WorktreeDeps, cwd: string, args: readonly string[]) {
  return deps.run("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
}

async function gitOut(deps: WorktreeDeps, cwd: string, args: readonly string[]): Promise<string> {
  const r = await git(deps, cwd, args);
  if (r.missing) throw new Error("git is not installed");
  if (r.code !== 0)
    throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
  return r.stdout.trim();
}

/** The checkout's top directory, from any directory inside it. */
export function repoRoot(deps: WorktreeDeps, cwd: string): Promise<string> {
  return gitOut(deps, cwd, ["rev-parse", "--show-toplevel"]);
}

/**
 * Keep `.claude/worktrees/` out of `git status` without touching the
 * committed `.gitignore`: the repository's local exclude file is enough.
 */
async function ensureIgnored(deps: WorktreeDeps, root: string): Promise<void> {
  const probe = await git(deps, root, ["check-ignore", "-q", `${WORKTREES_DIR}/probe`]);
  if (probe.code === 0) return;
  const common = await gitOut(deps, root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const exclude = `${common}/info/exclude`;
  const current = (await deps.fs.readFile(exclude)) ?? "";
  const lead = current === "" || current.endsWith("\n") ? "" : "\n";
  await deps.fs.appendFile(exclude, `${lead}${WORKTREES_DIR}/\n`);
}

/** Ignored files `.worktreeinclude` names, as git itself matches them. */
async function includedFiles(deps: WorktreeDeps, root: string): Promise<readonly string[]> {
  if ((await deps.fs.readFile(`${root}/.worktreeinclude`)) === undefined) return [];
  const out = await gitOut(deps, root, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-from=.worktreeinclude",
  ]);
  return out === "" ? [] : out.split("\n");
}

/**
 * Creates the worktree from the current HEAD and returns its directory. A
 * branch or directory of the same name is an error, never reused: it could
 * hold someone's work.
 */
export async function createWorktree(
  deps: WorktreeDeps,
  root: string,
  name: string,
): Promise<string> {
  const dir = `${root}/${WORKTREES_DIR}/${name}`;
  await ensureIgnored(deps, root);
  await gitOut(deps, root, ["worktree", "add", "-b", name, dir, "HEAD"]);
  for (const file of await includedFiles(deps, root)) {
    await deps.fs.copyFile(`${root}/${file}`, `${dir}/${file}`);
  }
  return dir;
}

/** Files the worker's branch changed against where it started. */
export async function changedFiles(
  deps: WorktreeDeps,
  root: string,
  name: string,
): Promise<readonly string[]> {
  const base = await gitOut(deps, root, ["merge-base", "HEAD", name]);
  const out = await gitOut(deps, root, ["diff", "--name-only", base, name]);
  return out === "" ? [] : out.split("\n");
}

/**
 * Removes the Swarm's own worktrees whose branch the current HEAD already
 * contains, and their branches. A worktree with uncommitted changes stays
 * (`git worktree remove` refuses it), and so does its branch. Returns the
 * names that were removed.
 */
export async function removeMerged(
  deps: WorktreeDeps,
  root: string,
  ownNames: readonly string[],
): Promise<readonly string[]> {
  const removed: string[] = [];
  for (const name of ownNames) {
    const exists = await git(deps, root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${name}`,
    ]);
    if (exists.code !== 0) continue;
    const merged = await git(deps, root, ["merge-base", "--is-ancestor", name, "HEAD"]);
    if (merged.code !== 0) continue;
    const gone = await git(deps, root, ["worktree", "remove", `${root}/${WORKTREES_DIR}/${name}`]);
    if (gone.code !== 0) continue;
    const branch = await git(deps, root, ["branch", "-d", name]);
    if (branch.code === 0) removed.push(name);
  }
  return removed;
}
