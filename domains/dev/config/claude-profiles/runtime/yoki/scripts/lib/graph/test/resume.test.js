'use strict';

/**
 * `--resume` is an index-ordered PREFIX replay, not a key-addressed cache.
 *
 * These tests drive the real `runner.executeScript` against the mock backend
 * (no process is ever spawned) and assert on the event stream: an
 * `agent-cached` event means "replayed from the journal", an `agent-start`
 * means "ran live". The property under test is the one a key-only lookup
 * cannot provide — that a change early in the run invalidates everything
 * after it, and that a recorded result is never handed to a call at a
 * different position.
 *
 * Isolated state per test — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const mockBackend = require('../backends/mock');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-resume-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-resume-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-resume-cwd-'));
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

/** A three-call script whose middle prompt is taken from args, so a rerun
 *  can change exactly one call in the middle of the sequence. */
const THREE_CALLS = `export const meta = { name: 'three', description: 'three sequential calls' }
const a = await agent('first prompt', { label: 'a' })
const b = await agent(args.middle, { label: 'b' })
const c = await agent('third prompt', { label: 'c' })
return [a, b, c]`;

function collect(events, type) {
  return events.filter((e) => e.type === type).map((e) => e.label);
}

async function run(scriptPath, { cwd, args, runId, fixture }) {
  const events = [];
  const result = await runner.executeScript({
    scriptPath, args, backendName: 'mock', cwd, runId, mockFile: fixture,
    emit: (e) => events.push(e),
  });
  return { result, events };
}

test('resume replays the matching prefix and runs everything from the first divergence live', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'three.js');
  fs.writeFileSync(scriptPath, THREE_CALLS);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ a: 'A', b: 'B', c: 'C' }));

  const first = await run(scriptPath, { cwd, fixture, args: { middle: 'original middle' } });
  assert.equal(first.result.status, 'ok');
  assert.deepEqual(collect(first.events, 'agent-start'), ['a', 'b', 'c']);
  assert.deepEqual(collect(first.events, 'agent-cached'), []);

  // Same script, same runId, one changed prompt at position 1.
  const second = await run(scriptPath, {
    cwd, fixture, runId: first.result.runId, args: { middle: 'CHANGED middle' },
  });
  assert.equal(second.result.status, 'ok');
  assert.deepEqual(collect(second.events, 'agent-cached'), ['a']);
  // 'c' is unchanged and its key still matches its recorded entry — but its
  // upstream moved, so it must NOT come from the cache.
  assert.deepEqual(collect(second.events, 'agent-start'), ['b', 'c']);
  const diverged = second.events.filter((e) => e.type === 'resume-diverged');
  assert.equal(diverged.length, 1);
  assert.equal(diverged[0].index, 1);
}));

test('an unchanged rerun replays every call and spawns nothing', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'three.js');
  fs.writeFileSync(scriptPath, THREE_CALLS);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ a: 'A', b: 'B', c: 'C' }));

  const first = await run(scriptPath, { cwd, fixture, args: { middle: 'same' } });
  const second = await run(scriptPath, { cwd, fixture, runId: first.result.runId, args: { middle: 'same' } });

  assert.deepEqual(collect(second.events, 'agent-cached'), ['a', 'b', 'c']);
  assert.deepEqual(collect(second.events, 'agent-start'), []);
  assert.deepEqual(second.result.result, first.result.result);
}));

test('a reordered run replays nothing — a recorded result is never reused out of order', () => withIsolatedState(async (cwd) => {
  // The exact failure a key-addressed cache has: both calls are byte-identical
  // to calls the journal already holds, so a key-only lookup would hand back
  // both results. Their POSITIONS swapped, so neither is the same work.
  const forward = path.join(cwd, 'forward.js');
  fs.writeFileSync(forward, `export const meta = { name: 'ab', description: 'a then b' }
const a = await agent('prompt A', { label: 'a' })
const b = await agent('prompt B', { label: 'b' })
return [a, b]`);
  const reversed = path.join(cwd, 'reversed.js');
  fs.writeFileSync(reversed, `export const meta = { name: 'ab', description: 'b then a' }
const b = await agent('prompt B', { label: 'b' })
const a = await agent('prompt A', { label: 'a' })
return [b, a]`);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ a: 'A', b: 'B' }));

  const first = await run(forward, { cwd, fixture, args: {} });
  const second = await run(reversed, { cwd, fixture, runId: first.result.runId, args: {} });

  assert.deepEqual(collect(second.events, 'agent-cached'), []);
  assert.deepEqual(collect(second.events, 'agent-start'), ['b', 'a']);
}));

test('a failed call is never replayed: the resumed run retries it and continues live', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'two.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'two', description: 'two calls' }
const a = await agent('first prompt', { label: 'a' })
const b = await agent('second prompt', { label: 'b' })
return [a, b]`);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ a: 'A', b: 'B' }));

  // Make the SECOND call fail on the first run by handing the mock backend a
  // run() that throws for that label only.
  const realRun = mockBackend.run;
  mockBackend.run = async (params) => {
    if (params.opts && params.opts.label === 'b') throw new Error('mock backend refused');
    return realRun(params);
  };
  let first;
  try {
    first = await run(scriptPath, { cwd, fixture, args: {} });
  } finally {
    mockBackend.run = realRun;
  }
  assert.deepEqual(first.result.result, ['A', null]);

  const second = await run(scriptPath, { cwd, fixture, runId: first.result.runId, args: {} });
  assert.deepEqual(collect(second.events, 'agent-cached'), ['a']);
  assert.deepEqual(collect(second.events, 'agent-start'), ['b']);
  assert.deepEqual(second.result.result, ['A', 'B']);
}));

test('renaming a script-chosen label invalidates that call and everything after it', () => withIsolatedState(async (cwd) => {
  const before = path.join(cwd, 'before.js');
  fs.writeFileSync(before, `export const meta = { name: 'lbl', description: 'd' }
const a = await agent('prompt A', { label: 'collect' })
const b = await agent('prompt B', { label: 'verify' })
return [a, b]`);
  const after = path.join(cwd, 'after.js');
  fs.writeFileSync(after, `export const meta = { name: 'lbl', description: 'd' }
const a = await agent('prompt A', { label: 'collect-diff' })
const b = await agent('prompt B', { label: 'verify' })
return [a, b]`);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({}));

  const first = await run(before, { cwd, fixture, args: {} });
  const second = await run(after, { cwd, fixture, runId: first.result.runId, args: {} });
  assert.deepEqual(collect(second.events, 'agent-cached'), []);
  assert.deepEqual(collect(second.events, 'agent-start'), ['collect-diff', 'verify']);
}));

test('a third run replays the second run\'s prefix, not the first run\'s stale tail', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'three.js');
  fs.writeFileSync(scriptPath, THREE_CALLS);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ a: 'A', b: 'B', c: 'C' }));

  const first = await run(scriptPath, { cwd, fixture, args: { middle: 'v1' } });
  await run(scriptPath, { cwd, fixture, runId: first.result.runId, args: { middle: 'v2' } });
  const third = await run(scriptPath, { cwd, fixture, runId: first.result.runId, args: { middle: 'v2' } });

  // v2's own three entries are the live generation; nothing from v1 survives
  // at an index v2 also wrote.
  assert.deepEqual(collect(third.events, 'agent-cached'), ['a', 'b', 'c']);
  assert.deepEqual(collect(third.events, 'agent-start'), []);
}));
