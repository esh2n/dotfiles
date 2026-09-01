'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const worktree = require('../worktree');

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe' });
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-wt-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  sh('git', ['add', 'README.md'], dir);
  sh('git', ['commit', '-q', '-m', 'init'], dir);
  return dir;
}

test('create() makes a worktree under .claude/worktrees/graph-<runId>-<n>', () => {
  const repo = makeTempRepo();
  try {
    const wt = worktree.create(repo, 'runXYZ', 1);
    // Compare against wt.repoRoot (git's own realpath'd view), not the raw
    // `repo` var — on macOS /tmp is a symlink to /private/tmp, and `git
    // rev-parse --show-toplevel` resolves it, so a literal `repo`-based
    // path would mismatch on that platform alone.
    assert.equal(wt.path, path.join(wt.repoRoot, '.claude', 'worktrees', 'graph-runXYZ-1'));
    assert.ok(fs.existsSync(wt.path));
    assert.ok(fs.existsSync(path.join(wt.path, 'README.md')));
    assert.equal(wt.branch, 'graph/runXYZ-1');
    worktree.cleanup(wt);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('cleanup() removes a clean worktree and its branch', () => {
  const repo = makeTempRepo();
  try {
    const wt = worktree.create(repo, 'runABC', 1);
    const outcome = worktree.cleanup(wt);
    assert.equal(outcome.removed, true);
    assert.equal(fs.existsSync(wt.path), false);
    const branches = execFileSync('git', ['branch', '--list', wt.branch], { cwd: repo, encoding: 'utf8' });
    assert.equal(branches.trim(), '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('cleanup() KEEPS a dirty worktree and reports its path instead of discarding work', () => {
  const repo = makeTempRepo();
  try {
    const wt = worktree.create(repo, 'runDIRTY', 1);
    fs.writeFileSync(path.join(wt.path, 'new-file.txt'), 'uncommitted work\n');
    const outcome = worktree.cleanup(wt);
    assert.equal(outcome.removed, false);
    assert.equal(outcome.path, wt.path);
    assert.ok(fs.existsSync(wt.path)); // still there — nothing was discarded
    assert.ok(fs.existsSync(path.join(wt.path, 'new-file.txt')));
    // manual cleanup for the test's own temp dir
    sh('git', ['worktree', 'remove', wt.path, '--force'], repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('create() throws a clear error outside a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-wt-notgit-'));
  try {
    assert.throws(() => worktree.create(dir, 'run1', 1), /requires a git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isClean reports true for an untouched worktree and false once modified', () => {
  const repo = makeTempRepo();
  try {
    const wt = worktree.create(repo, 'runCLEANCHECK', 1);
    assert.equal(worktree.isClean(wt.path), true);
    fs.writeFileSync(path.join(wt.path, 'README.md'), 'changed\n');
    assert.equal(worktree.isClean(wt.path), false);
    sh('git', ['checkout', '--', 'README.md'], wt.path);
    worktree.cleanup(wt);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
