'use strict';

/**
 * `opts.isolation: 'worktree'` support for agent(): create a fresh git
 * worktree at `<repoRoot>/.claude/worktrees/graph-<runId>-<n>`, run the
 * agent call's backend process with that directory as cwd, then remove the
 * worktree afterward — UNLESS the tree is dirty, in which case it is kept
 * and its path is returned so the caller can log it.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function run(cmd, args, cwd) {
  // stderr is piped (captured on a thrown error's `.stderr`) rather than
  // inherited, so an EXPECTED failure (e.g. probing whether `cwd` is a git
  // repo at all) doesn't spam the caller's terminal/test output.
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function findRepoRoot(startDir) {
  try {
    return run('git', ['rev-parse', '--show-toplevel'], startDir);
  } catch {
    return null;
  }
}

function isClean(worktreePath) {
  try {
    const status = run('git', ['status', '--porcelain'], worktreePath);
    return status.length === 0;
  } catch {
    return false; // can't tell -> treat as dirty, never silently discard work
  }
}

/**
 * Create a worktree for agent-call #`n` of run `runId`, branching from the
 * current HEAD of `cwd`'s repo. Returns
 * `{ path, repoRoot, branch, create() didn't fail }` or throws if `cwd`
 * is not inside a git repo (isolation:'worktree' requires one).
 */
function create(cwd, runId, n) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(`isolation:'worktree' requires a git repository (cwd=${cwd} is not inside one)`);
  }
  const relPath = path.join('.claude', 'worktrees', `graph-${runId}-${n}`);
  const worktreePath = path.join(repoRoot, relPath);
  const branch = `graph/${runId}-${n}`;
  fs.mkdirSync(path.join(repoRoot, '.claude', 'worktrees'), { recursive: true });
  run('git', ['worktree', 'add', '-b', branch, worktreePath], repoRoot);
  return { path: worktreePath, repoRoot, branch };
}

/**
 * Remove a worktree created by `create()`. Clean -> removed + branch
 * deleted, returns `{ removed: true }`. Dirty -> kept, returns
 * `{ removed: false, path }` so the caller can print it for the operator.
 */
function cleanup({ path: worktreePath, repoRoot, branch }) {
  if (!fs.existsSync(worktreePath)) return { removed: true };
  if (!isClean(worktreePath)) {
    return { removed: false, path: worktreePath };
  }
  try {
    run('git', ['worktree', 'remove', worktreePath, '--force'], repoRoot);
    try { run('git', ['branch', '-D', branch], repoRoot); } catch { /* best-effort */ }
    return { removed: true };
  } catch {
    return { removed: false, path: worktreePath };
  }
}

module.exports = { create, cleanup, isClean, findRepoRoot };
