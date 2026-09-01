'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const state = require('../state');

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-state-'));
  try {
    return fn({ HOME: home });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('runsPath: under $HOME/.local/state/yoki/loop/<name>/runs.jsonl by default', () => {
  withTempHome((env) => {
    assert.equal(state.runsPath('demo', env), path.join(env.HOME, '.local', 'state', 'yoki', 'loop', 'demo', 'runs.jsonl'));
  });
});

test('runsPath: honours XDG_STATE_HOME like yoki-artifact\'s inbox.mjs', () => {
  const env = { HOME: '/home/u', XDG_STATE_HOME: '/custom/state' };
  assert.equal(state.runsPath('demo', env), path.join('/custom/state', 'yoki', 'loop', 'demo', 'runs.jsonl'));
});

test('readRuns: [] when the file does not exist yet', () => {
  withTempHome((env) => {
    assert.deepEqual(state.readRuns('demo', env), []);
  });
});

test('appendRun + readRuns: round-trips one JSON row per line, in order', () => {
  withTempHome((env) => {
    const row1 = { ts: '2026-01-01T00:00:00.000Z', harness: 'claude', cmd: ['claude', '-p', 'a'], exit: 0, durationMs: 10, sessionId: 's1' };
    const row2 = { ts: '2026-01-01T00:01:00.000Z', harness: 'claude', cmd: ['claude', '-p', 'b'], exit: 1, durationMs: 20, sessionId: null };
    state.appendRun('demo', row1, env);
    state.appendRun('demo', row2, env);
    assert.deepEqual(state.readRuns('demo', env), [row1, row2]);
  });
});

test('readRuns: skips a truncated trailing line instead of throwing', () => {
  withTempHome((env) => {
    const file = state.runsPath('demo', env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', harness: 'codex', cmd: [], exit: 0, durationMs: 1, sessionId: null })}\n{"trun`);
    const rows = state.readRuns('demo', env);
    assert.equal(rows.length, 1);
  });
});

test('lastSessionId: most recent non-empty sessionId, newest first', () => {
  const runs = [
    { sessionId: 's1' },
    { sessionId: null },
    { sessionId: 's3' },
    {},
  ];
  assert.equal(state.lastSessionId(runs), 's3');
});

test('lastSessionId: null when no row has one', () => {
  assert.equal(state.lastSessionId([{ sessionId: null }, {}]), null);
});

test('lastSessionId: null on an empty history', () => {
  assert.equal(state.lastSessionId([]), null);
});

test('countRunsToday: counts only rows whose ts falls on the given day', () => {
  const runs = [
    { ts: '2026-08-31T01:00:00.000Z' },
    { ts: '2026-08-31T23:59:00.000Z' },
    { ts: '2026-09-01T00:00:00.000Z' },
  ];
  assert.equal(state.countRunsToday(runs, new Date('2026-08-31T12:00:00.000Z')), 2);
});

test('checkDailyCap: overCap is true once count reaches cap', () => {
  const runs = [{ ts: '2026-08-31T00:00:00.000Z' }, { ts: '2026-08-31T01:00:00.000Z' }];
  const now = new Date('2026-08-31T12:00:00.000Z');
  assert.deepEqual(state.checkDailyCap(runs, 2, now), { overCap: true, count: 2, cap: 2 });
  assert.deepEqual(state.checkDailyCap(runs, 3, now), { overCap: false, count: 2, cap: 3 });
});
