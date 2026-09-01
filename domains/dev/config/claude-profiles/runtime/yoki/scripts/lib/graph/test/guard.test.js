'use strict';

/**
 * IMPORTANT: every test here runs with YOKI_GRAPH_GUARD_STATE_DIR pointed at
 * a throwaway temp directory. guard.js shares its counter file path with
 * the real workflow-guard.sh PreToolUse hook ON PURPOSE (that sharing is
 * the whole point of this module) — a test that didn't override the state
 * dir would increment/reset the REAL daily launch counter used by actual
 * Claude Code sessions on this machine.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withIsolatedGuard(fn) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-guard-'));
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-guard-cwd-'));
  const prevStateDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  const prevCap = process.env.YOKI_WORKFLOW_DAILY_CAP;
  const prevDisabled = process.env.WORKFLOW_GUARD_DISABLED;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = stateDir;
  delete require.cache[require.resolve('../guard')];
  const guard = require('../guard');
  try {
    return fn(guard, cwdDir);
  } finally {
    if (prevStateDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevStateDir;
    if (prevCap === undefined) delete process.env.YOKI_WORKFLOW_DAILY_CAP; else process.env.YOKI_WORKFLOW_DAILY_CAP = prevCap;
    if (prevDisabled === undefined) delete process.env.WORKFLOW_GUARD_DISABLED; else process.env.WORKFLOW_GUARD_DISABLED = prevDisabled;
    delete require.cache[require.resolve('../guard')];
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
}

test('checkAndRecord allows launches under the default cap of 5 and denies the 6th', () => {
  withIsolatedGuard((guard, cwd) => {
    for (let i = 1; i <= 5; i += 1) {
      const r = guard.checkAndRecord(cwd);
      assert.equal(r.allowed, true, `launch ${i} should be allowed`);
      assert.equal(r.count, i);
      assert.equal(r.cap, 5);
    }
    const denied = guard.checkAndRecord(cwd);
    assert.equal(denied.allowed, false);
    assert.match(denied.message, /Workflow daily cap reached \(5\/5\)/);
  });
});

test('YOKI_WORKFLOW_DAILY_CAP overrides the default cap', () => {
  withIsolatedGuard((guard, cwd) => {
    process.env.YOKI_WORKFLOW_DAILY_CAP = '2';
    assert.equal(guard.checkAndRecord(cwd).allowed, true);
    assert.equal(guard.checkAndRecord(cwd).allowed, true);
    const denied = guard.checkAndRecord(cwd);
    assert.equal(denied.allowed, false);
    assert.equal(denied.cap, 2);
  });
});

test('.yoki.json workflowDailyCap takes precedence over the env var', () => {
  withIsolatedGuard((guard, cwd) => {
    process.env.YOKI_WORKFLOW_DAILY_CAP = '2';
    fs.writeFileSync(path.join(cwd, '.yoki.json'), JSON.stringify({ workflowDailyCap: 1 }));
    assert.equal(guard.checkAndRecord(cwd).allowed, true);
    const denied = guard.checkAndRecord(cwd);
    assert.equal(denied.allowed, false);
    assert.equal(denied.cap, 1); // project config wins, not the env's 2
  });
});

test('.yoki.json disabledHooks including "workflow-guard" disables the cap entirely', () => {
  withIsolatedGuard((guard, cwd) => {
    process.env.YOKI_WORKFLOW_DAILY_CAP = '1';
    fs.writeFileSync(path.join(cwd, '.yoki.json'), JSON.stringify({ disabledHooks: ['workflow-guard'] }));
    for (let i = 0; i < 10; i += 1) {
      assert.equal(guard.checkAndRecord(cwd).allowed, true);
    }
  });
});

test('WORKFLOW_GUARD_DISABLED=1 bypasses the guard entirely, same as the hook', () => {
  withIsolatedGuard((guard, cwd) => {
    process.env.YOKI_WORKFLOW_DAILY_CAP = '1';
    process.env.WORKFLOW_GUARD_DISABLED = '1';
    for (let i = 0; i < 5; i += 1) {
      assert.equal(guard.checkAndRecord(cwd).allowed, true);
    }
  });
});

test('a Claude Code launch and a CLI launch share the same daily count (same state dir/file)', () => {
  withIsolatedGuard((guard, cwd) => {
    process.env.YOKI_WORKFLOW_DAILY_CAP = '3';
    // Simulate: two launches "from Claude Code" (any caller of checkAndRecord
    // is indistinguishable from the hook's own increments — that IS the
    // sharing contract) then one from the CLI, then a denial on the 4th.
    assert.equal(guard.checkAndRecord(cwd).count, 1);
    assert.equal(guard.checkAndRecord(cwd).count, 2);
    assert.equal(guard.checkAndRecord(cwd).count, 3);
    assert.equal(guard.checkAndRecord(cwd).allowed, false);
  });
});

test('malformed .yoki.json fails open (falls back to env/default) rather than crashing', () => {
  withIsolatedGuard((guard, cwd) => {
    fs.writeFileSync(path.join(cwd, '.yoki.json'), '{ not valid json');
    const r = guard.checkAndRecord(cwd);
    assert.equal(r.allowed, true);
    assert.equal(r.cap, 5);
  });
});
