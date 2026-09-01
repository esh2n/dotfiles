'use strict';

/**
 * One live process per runId. The lock file is what stops two
 * `--resume <same id>` runs from interleaving their journal lines (each
 * one's prefix replay would then see the other's writes) and from racing to
 * own `run.json`.
 *
 * Isolated state per test — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lock = require('../lock');
const runner = require('../runner');
const journalLib = require('../journal');
const mockBackend = require('../backends/mock');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-lock-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-lock-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-lock-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  mockBackend.clearFixtureCache();
  return Promise.resolve(fn(cwd)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    mockBackend.clearFixtureCache();
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

test('acquire writes an owner record and release removes it', () => withIsolatedState(async () => {
  const held = lock.acquire('run-a');
  const info = lock.readLockFile(held.file);
  assert.equal(info.pid, process.pid);
  assert.equal(info.host, os.hostname());
  assert.equal(info.runId, 'run-a');
  assert.ok(Date.parse(info.startedAt) > 0);
  held.release();
  assert.equal(fs.existsSync(held.file), false);
}));

test('a second acquire on a live lock is refused with the holder in the message', () => withIsolatedState(async () => {
  const held = lock.acquire('run-b');
  try {
    assert.throws(() => lock.acquire('run-b'), (err) => {
      assert.equal(err.code, 'ERUNACTIVE');
      assert.match(err.message, new RegExp(`pid ${process.pid}`));
      assert.match(err.message, /already active/);
      return true;
    });
  } finally {
    held.release();
  }
  // released: the id is takeable again
  lock.acquire('run-b').release();
}));

test('a lock whose owning pid is gone is stale and gets taken over', () => withIsolatedState(async () => {
  const file = lock.lockPath('run-c');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // pid 2^22 - 1 is above every platform's default pid_max, so it cannot be
  // a live process; the record is otherwise fresh.
  fs.writeFileSync(file, JSON.stringify({
    runId: 'run-c', pid: 4194303, host: os.hostname(), startedAt: new Date().toISOString(), token: 'old',
  }));
  const held = lock.acquire('run-c');
  assert.equal(held.stolen, true);
  assert.equal(lock.readLockFile(file).pid, process.pid);
  held.release();
}));

test('a lock from another host is trusted until it ages out', () => {
  const fresh = { pid: 1, host: 'some-other-machine', startedAt: new Date(1000).toISOString() };
  assert.equal(lock.isStale(fresh, { staleMs: 3600000, now: 2000 }), false,
    'a foreign pid says nothing about liveness here — respect it while it is young');
  assert.equal(lock.isStale(fresh, { staleMs: 500, now: 2000 }), true,
    'but it must not hold the id forever');
});

test('a corrupt or unparseable lock file is treated as stale', () => withIsolatedState(async () => {
  const file = lock.lockPath('run-d');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json at all');
  const held = lock.acquire('run-d');
  assert.equal(held.stolen, true);
  held.release();
}));

test('release only removes the lock it wrote', () => withIsolatedState(async () => {
  const held = lock.acquire('run-e');
  // Someone else took over in the meantime (a stale takeover would look
  // exactly like this from the original holder's point of view).
  fs.writeFileSync(held.file, JSON.stringify({ runId: 'run-e', pid: 999, host: os.hostname(), startedAt: new Date().toISOString(), token: 'someone-else' }));
  held.release();
  assert.equal(fs.existsSync(held.file), true, 'evicted the current holder');
  assert.equal(lock.readLockFile(held.file).token, 'someone-else');
}));

test('executeScript refuses to start while another process holds the runId', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'x.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'x', description: 'd' }
return await agent('go', { label: 'one' })`);

  const first = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(first.status, 'ok', first.error);

  const held = lock.acquire(first.runId);
  try {
    const events = [];
    const blocked = await runner.executeScript({
      scriptPath, args: {}, backendName: 'mock', cwd, runId: first.runId, emit: (e) => events.push(e),
    });
    assert.equal(blocked.status, 'locked');
    assert.match(blocked.error, /already active/);
    assert.ok(events.some((e) => e.type === 'run-locked'));
    assert.ok(!events.some((e) => e.type === 'run-start'), 'the script must not run at all');
  } finally {
    held.release();
  }
}));

test('executeScript releases its lock even when the script throws', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'boom.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'boom', description: 'd' }
throw new Error('script blew up')`);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'error');
  assert.equal(fs.existsSync(path.join(journalLib.runDir(result.runId), 'lock')), false);
}));
