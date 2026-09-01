'use strict';

/**
 * `opts.isolation: 'worktree'` support for agent(): create a fresh git
 * worktree at `<repoRoot>/.claude/worktrees/graph-<runId>-<n>`, run the
 * agent call's backend process with that directory as cwd, then remove the
 * worktree afterward — UNLESS the tree is dirty, in which case it is kept
 * and its path is returned so the caller can log it.
 *
 * Every git call here is ASYNC (`execFile`, not `execFileSync`). These run
 * inside api.js's `agent()`, which parallel()/pipeline() fire several of at
 * once — and a sync call blocks node's single JS thread for its whole
 * duration, which on a large repo means one call's `git worktree add` or
 * `git status` freezes every other in-flight agent call, including the
 * stdout/stderr drain of the backend child processes they are waiting on
 * (backends/common.js's spawnCollect is fully event-loop driven). Sync git
 * here was quietly serializing the concurrency the API is built around.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * @returns {Promise<string>} trimmed stdout; rejects on a non-zero exit.
 * stderr is captured onto the error (rather than inherited) so an EXPECTED
 * failure — probing whether `cwd` is a git repo at all — doesn't spam the
 * caller's terminal or the test output.
 */
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/** @returns {Promise<string|null>} */
async function findRepoRoot(startDir) {
  try {
    return await run('git', ['rev-parse', '--show-toplevel'], startDir);
  } catch {
    return null;
  }
}

/** @returns {Promise<boolean>} */
async function isClean(worktreePath) {
  try {
    const status = await run('git', ['status', '--porcelain'], worktreePath);
    return status.length === 0;
  } catch {
    return false; // can't tell -> treat as dirty, never silently discard work
  }
}

/**
 * Create a worktree for agent-call #`n` of run `runId`, branching from the
 * current HEAD of `cwd`'s repo.
 * @returns {Promise<{path: string, repoRoot: string, branch: string}>}
 * @throws if `cwd` is not inside a git repo (isolation:'worktree' requires one)
 */
async function create(cwd, runId, n) {
  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(`isolation:'worktree' requires a git repository (cwd=${cwd} is not inside one)`);
  }
  const relPath = path.join('.claude', 'worktrees', `graph-${runId}-${n}`);
  const worktreePath = path.join(repoRoot, relPath);
  const branch = `graph/${runId}-${n}`;
  fs.mkdirSync(path.join(repoRoot, '.claude', 'worktrees'), { recursive: true });
  await run('git', ['worktree', 'add', '-b', branch, worktreePath], repoRoot);
  return { path: worktreePath, repoRoot, branch };
}

/**
 * Remove a worktree created by `create()`. Clean -> removed + branch
 * deleted, resolves `{ removed: true }`. Dirty -> kept, resolves
 * `{ removed: false, path }` so the caller can print it for the operator.
 * @returns {Promise<{removed: boolean, path?: string}>}
 */
async function cleanup({ path: worktreePath, repoRoot, branch }) {
  if (!fs.existsSync(worktreePath)) return { removed: true };
  if (!(await isClean(worktreePath))) {
    return { removed: false, path: worktreePath };
  }
  try {
    await run('git', ['worktree', 'remove', worktreePath, '--force'], repoRoot);
    try { await run('git', ['branch', '-D', branch], repoRoot); } catch { /* best-effort */ }
    return { removed: true };
  } catch {
    return { removed: false, path: worktreePath };
  }
}

module.exports = { create, cleanup, isClean, findRepoRoot };
