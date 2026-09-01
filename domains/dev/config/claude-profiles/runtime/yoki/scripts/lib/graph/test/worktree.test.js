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

test('create() makes a worktree under .claude/worktrees/graph-<runId>-<n>', async () => {
  const repo = makeTempRepo();
  try {
    const wt = await worktree.create(repo, 'runXYZ', 1);
    // Compare against wt.repoRoot (git's own realpath'd view), not the raw
    // `repo` var — on macOS /tmp is a symlink to /private/tmp, and `git
    // rev-parse --show-toplevel` resolves it, so a literal `repo`-based
    // path would mismatch on that platform alone.
    assert.equal(wt.path, path.join(wt.repoRoot, '.claude', 'worktrees', 'graph-runXYZ-1'));
    assert.ok(fs.existsSync(wt.path));
    assert.ok(fs.existsSync(path.join(wt.path, 'README.md')));
    assert.equal(wt.branch, 'graph/runXYZ-1');
    await worktree.cleanup(wt);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('cleanup() removes a clean worktree and its branch', async () => {
  const repo = makeTempRepo();
  try {
    const wt = await worktree.create(repo, 'runABC', 1);
    const outcome = await worktree.cleanup(wt);
    assert.equal(outcome.removed, true);
    assert.equal(fs.existsSync(wt.path), false);
    const branches = execFileSync('git', ['branch', '--list', wt.branch], { cwd: repo, encoding: 'utf8' });
    assert.equal(branches.trim(), '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('cleanup() KEEPS a dirty worktree and reports its path instead of discarding work', async () => {
  const repo = makeTempRepo();
  try {
    const wt = await worktree.create(repo, 'runDIRTY', 1);
    fs.writeFileSync(path.join(wt.path, 'new-file.txt'), 'uncommitted work\n');
    const outcome = await worktree.cleanup(wt);
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

test('create() rejects with a clear error outside a git repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-wt-notgit-'));
  try {
    await assert.rejects(() => worktree.create(dir, 'run1', 1), /requires a git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isClean reports true for an untouched worktree and false once modified', async () => {
  const repo = makeTempRepo();
  try {
    const wt = await worktree.create(repo, 'runCLEANCHECK', 1);
    assert.equal(await worktree.isClean(wt.path), true);
    fs.writeFileSync(path.join(wt.path, 'README.md'), 'changed\n');
    assert.equal(await worktree.isClean(wt.path), false);
    sh('git', ['checkout', '--', 'README.md'], wt.path);
    await worktree.cleanup(wt);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('git calls do not block the event loop — timers keep firing during create/cleanup', async () => {
  // The point of the async rewrite: parallel()/pipeline() run several
  // agent() calls at once, and execFileSync inside one of them froze the
  // whole JS thread — including the stdout drain of every other in-flight
  // backend child process. A repeating timer is the cheapest proof that the
  // loop stayed alive across the git work.
  const repo = makeTempRepo();
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  try {
    const wt = await worktree.create(repo, 'runLOOP', 1);
    await worktree.isClean(wt.path);
    await worktree.cleanup(wt);
  } finally {
    clearInterval(timer);
    fs.rmSync(repo, { recursive: true, force: true });
  }
  assert.ok(ticks > 0, 'the event loop never ran during the git calls — they are still synchronous');
});

test('concurrent create() calls interleave instead of serializing', async () => {
  const repo = makeTempRepo();
  try {
    const wts = await Promise.all([1, 2, 3].map((n) => worktree.create(repo, 'runPAR', n)));
    assert.equal(new Set(wts.map((w) => w.path)).size, 3);
    for (const wt of wts) assert.ok(fs.existsSync(wt.path));
    const outcomes = await Promise.all(wts.map((wt) => worktree.cleanup(wt)));
    assert.deepEqual(outcomes.map((o) => o.removed), [true, true, true]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
