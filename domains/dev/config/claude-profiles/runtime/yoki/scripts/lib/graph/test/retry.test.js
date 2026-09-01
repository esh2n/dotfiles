'use strict';

/**
 * Transient-failure retry: the classifier, the backoff schedule, and the
 * end-to-end behaviour through `agent()` — including that the retries land
 * in the journal (so `yoki-graph status` shows a lane was retried rather
 * than just that it eventually passed) and that a non-transient failure
 * still fails on the first attempt.
 *
 * Every test injects `sleep`, so nothing here actually waits.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const retry = require('../retry');
const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { Journal } = require('../journal');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-retry-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-retry-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-retry-cwd-'));
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

/** Swap in a mock-backend run() for the duration of one test. */
async function withMockRun(impl, fn) {
  const real = mockBackend.run;
  mockBackend.run = impl;
  try {
    return await fn();
  } finally {
    mockBackend.run = real;
  }
}

function transientError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('isTransient recognises rate limits, 5xx, timeouts and dead pipes', () => {
  for (const message of [
    'claude -p exited 1: API error 429 Too Many Requests',
    'codex exec exited 1: 503 Service Unavailable',
    'omp exited 1: upstream returned 502 bad gateway',
    'the model is currently Overloaded, try again',
    'codex exec timed out after 900000ms and was killed',
    'write EPIPE',
    'socket hang up',
  ]) {
    assert.equal(retry.isTransient(new Error(message)), true, message);
  }
  assert.equal(retry.isTransient(transientError('spawn failed', { code: 'EPIPE' })), true);
  assert.equal(retry.isTransient(transientError('reset', { code: 'ECONNRESET' })), true);
});

test('isTransient refuses to retry a mistake that will repeat identically', () => {
  for (const message of [
    'spawn codex ENOENT',
    'codex backend: unknown sandbox "yolo" (expected one of read-only, ...)',
    'claude -p exited 2: unknown flag --nope',
    'schema validation failed after retry: $.findings: expected array, got string',
  ]) {
    assert.equal(retry.isTransient(new Error(message)), false, message);
  }
  assert.equal(retry.isTransient(transientError('rate limited', { transient: false })), false,
    'an explicit transient:false wins over the message');
  assert.equal(retry.isTransient(null), false);
});

test('the backoff doubles and then flattens at the cap', () => {
  const opts = { baseDelayMs: 500, maxDelayMs: 5000 };
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => retry.delayFor(n, opts)), [500, 1000, 2000, 4000, 5000]);
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

test('withRetry makes up to 1 + retries attempts and waits between them', async () => {
  const waits = [];
  let attempts = 0;
  const value = await retry.withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('429 slow down');
    return 'done';
  }, { retries: 2, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(value, 'done');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test('withRetry gives up after the last retry and rethrows the final error', async () => {
  let attempts = 0;
  await assert.rejects(
    () => retry.withRetry(async () => { attempts += 1; throw new Error('503 again'); },
      { retries: 2, sleep: async () => {} }),
    /503 again/,
  );
  assert.equal(attempts, 3);
});

test('withRetry fails fast on a non-transient error — exactly one attempt', async () => {
  let attempts = 0;
  await assert.rejects(
    () => retry.withRetry(async () => { attempts += 1; throw new Error('spawn codex ENOENT'); },
      { retries: 5, sleep: async () => {} }),
    /ENOENT/,
  );
  assert.equal(attempts, 1);
});

// ---------------------------------------------------------------------------
// End to end through agent()
// ---------------------------------------------------------------------------

test('agent() retries a transient backend failure, journals each retry, and succeeds', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'r.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'r', description: 'd' }
return await agent('do the thing', { label: 'flaky' })`);

  let calls = 0;
  const events = [];
  const result = await withMockRun(async () => {
    calls += 1;
    if (calls < 3) throw new Error('claude -p exited 1: API error 429 rate limit');
    return { raw: 'recovered', durationMs: 1, exitCode: 0 };
  }, () => runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd,
    retries: 2, sleep: async () => {}, emit: (e) => events.push(e),
  }));

  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result, 'recovered');
  assert.equal(calls, 3);

  const retried = events.filter((e) => e.type === 'agent-retry');
  assert.deepEqual(retried.map((e) => e.attempt), [1, 2]);
  assert.deepEqual(retried.map((e) => e.delayMs), [500, 1000]);

  const entries = new Journal(result.runId).readAll();
  assert.deepEqual(entries.map((e) => e.status), ['retry', 'retry', 'ok']);
  assert.equal(entries[0].index, 0, 'a retry line carries the call index it belongs to');
  assert.match(entries[0].error, /429/);
}));

test('a retry line is invisible to resume: only the completed call replays', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'r.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'r', description: 'd' }
const a = await agent('first', { label: 'a' })
const b = await agent('second', { label: 'b' })
return [a, b]`);

  let firstCallAttempts = 0;
  const first = await withMockRun(async (params) => {
    if (params.opts.label === 'a') {
      firstCallAttempts += 1;
      if (firstCallAttempts === 1) throw new Error('503 service unavailable');
    }
    return { raw: `ok:${params.opts.label}`, durationMs: 1, exitCode: 0 };
  }, () => runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, retries: 2, sleep: async () => {},
  }));
  assert.equal(first.status, 'ok', first.error);

  const events = [];
  const second = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, runId: first.runId, emit: (e) => events.push(e),
  });
  assert.equal(second.status, 'ok');
  assert.deepEqual(events.filter((e) => e.type === 'agent-cached').map((e) => e.label), ['a', 'b']);
  assert.deepEqual(second.result, first.result);
}));

test('a non-transient backend failure still resolves the call to null on the first attempt', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'r.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'r', description: 'd' }
return await agent('do the thing', { label: 'doomed' })`);

  let calls = 0;
  const result = await withMockRun(async () => {
    calls += 1;
    throw new Error('spawn claude ENOENT');
  }, () => runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, retries: 3, sleep: async () => {},
  }));

  assert.equal(result.status, 'ok');
  assert.equal(result.result, null, 'a terminal backend failure resolves to null, per API.md');
  assert.equal(calls, 1, 'no retry was spent on an error that cannot get better');
}));

test('a timed-out child is retried and, if it keeps timing out, recorded as timedOut', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'r.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'r', description: 'd' }
return await agent('hang', { label: 'wedged' })`);

  const { timeoutError } = require('../backends/common');
  let calls = 0;
  const result = await withMockRun(async () => {
    calls += 1;
    throw timeoutError('mock backend', 1234);
  }, () => runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, retries: 1, sleep: async () => {},
  }));

  assert.equal(calls, 2, 'a timeout is transient — it gets its retry');
  assert.equal(result.result, null);
  const entries = new Journal(result.runId).readAll();
  const final = entries[entries.length - 1];
  assert.equal(final.status, 'error');
  assert.equal(final.timedOut, true);
  assert.match(final.error, /timed out after 1234ms/);
}));
