'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
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
    const row1 = { ts: '2026-01-01T00:00:00.000Z', harness: 'omp', cmd: ['omp', '-p', 'a'], exit: 0, durationMs: 10, sessionId: 's1' };
    const row2 = { ts: '2026-01-01T00:01:00.000Z', harness: 'omp', cmd: ['omp', '-p', 'b'], exit: 1, durationMs: 20, sessionId: null };
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

// ---------------------------------------------------------------------------
// prompt redaction
// ---------------------------------------------------------------------------

test('promptPlaceholder: <prompt sha256:<12 hex> len:<n>>, and never the prompt', () => {
  const prompt = 'triage acme-corp/billing and ping @alice about the outage';
  const placeholder = state.promptPlaceholder(prompt);
  assert.match(placeholder, /^<prompt sha256:[0-9a-f]{12} len:\d+>$/);
  const digest = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 12);
  assert.equal(placeholder, `<prompt sha256:${digest} len:${prompt.length}>`);
  assert.ok(!placeholder.includes('acme-corp'));
  assert.ok(!placeholder.includes('alice'));
});

test('promptPlaceholder: stable for the same prompt, different for a different one', () => {
  assert.equal(state.promptPlaceholder('same'), state.promptPlaceholder('same'));
  assert.notEqual(state.promptPlaceholder('same'), state.promptPlaceholder('other'));
  // Same length, different text — the hash, not the length, separates them.
  assert.notEqual(state.promptPlaceholder('aaaa'), state.promptPlaceholder('bbbb'));
});

test('redactPromptArgv: swaps only the prompt token, keeps every other one verbatim', () => {
  const prompt = 'check CI for secret-project';
  const argv = ['omp', '-p', prompt, '--mode', 'json', '--model', 'sonnet'];
  const redacted = state.redactPromptArgv(argv, prompt);
  assert.deepEqual(redacted, [
    'omp',
    '-p',
    state.promptPlaceholder(prompt),
    '--mode',
    'json',
    '--model',
    'sonnet',
  ]);
  assert.ok(!redacted.join(' ').includes('secret-project'));
  // The input array is untouched — the caller still holds the real argv.
  assert.equal(argv[2], prompt);
});

test('redactPromptArgv: a flag that merely contains the prompt as a substring stays verbatim', () => {
  const redacted = state.redactPromptArgv(['omp', '--tools', 'read,grep', 'read the log'], 'read');
  assert.deepEqual(redacted, ['omp', '--tools', 'read,grep', 'read the log']);
});

test('redactPromptArgv: an empty prompt has nothing to redact', () => {
  assert.deepEqual(state.redactPromptArgv(['codex', 'exec', '-'], ''), ['codex', 'exec', '-']);
});
