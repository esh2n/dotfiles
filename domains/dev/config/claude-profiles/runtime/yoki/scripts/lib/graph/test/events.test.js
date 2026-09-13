'use strict';

/**
 * The per-run event stream (events.js): observation, strictly separated from
 * recovery.
 *
 * Two properties carry everything else here:
 *
 *  1. The sink can NEVER fail the run. A sink whose directory cannot exist,
 *     whose stream has already errored, or whose event will not serialize
 *     swallows the failure and counts it — `emit` must not throw, ever.
 *
 *  2. Resume never reads events.ndjson. journal.js's prefix replay is the
 *     only recovery path, so a corrupt (or missing) events file must change
 *     nothing about what `--resume` replays. That is asserted end to end,
 *     against the real runner, in this file's tee section.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createEventSink, eventsPath } = require('../events');
const { JournalTail, Journal, runDir } = require('../journal');
const runner = require('../runner');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readEnvelopes(dir) {
  const text = fs.readFileSync(eventsPath(dir), 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Envelope shape and ordering
// ---------------------------------------------------------------------------

test('every line carries the v/seq/ts/runId/type envelope plus the event fields', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'run-abc' });
  sink.emit({ type: 'run-start', name: 'flow', backend: 'mock', ts: '2026-01-01T00:00:00Z' });
  sink.emit({ type: 'log', message: 'こんにちは' });
  await sink.close();

  const lines = readEnvelopes(dir);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.v, 1);
    assert.equal(line.runId, 'run-abc');
    assert.equal(typeof line.seq, 'number');
    // The envelope ts is the HOST clock in epoch ms — the event's own ISO
    // string ts must not survive into the envelope position.
    assert.equal(typeof line.ts, 'number');
  }
  assert.equal(lines[0].type, 'run-start');
  assert.equal(lines[0].name, 'flow');
  assert.equal(lines[0].backend, 'mock');
  assert.equal(lines[1].type, 'log');
  assert.equal(lines[1].message, 'こんにちは');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seq starts at 1 and increases by exactly 1 per line', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'r' });
  for (let i = 0; i < 25; i += 1) sink.emit({ type: 'log', message: `m${i}` });
  await sink.close();

  const seqs = readEnvelopes(dir).map((l) => l.seq);
  assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an event carrying its own runId (a child run relayed upward) keeps it', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'parent' });
  sink.emit({ type: 'log', runId: 'child-run', message: 'x' });
  await sink.close();
  assert.equal(readEnvelopes(dir)[0].runId, 'child-run');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Failure swallowing — the run must survive every sink failure
// ---------------------------------------------------------------------------

test('a sink whose directory cannot be created swallows every emit and counts it', () => {
  const dir = tmpDir('yoki-events-');
  const blocker = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocker, 'a plain file where the runDir should go');
  const sink = createEventSink(path.join(blocker, 'run-1'), { runId: 'r' });
  assert.doesNotThrow(() => sink.emit({ type: 'run-start' }));
  assert.doesNotThrow(() => sink.emit({ type: 'run-end' }));
  assert.equal(sink.dropped(), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unserializable event is dropped and counted, and later events still land', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'r' });
  const circular = { type: 'log' };
  circular.self = circular;
  assert.doesNotThrow(() => sink.emit(circular));
  sink.emit({ type: 'run-end', status: 'ok' });
  await sink.close();

  assert.equal(sink.dropped(), 1);
  const lines = readEnvelopes(dir);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'run-end');
  // The dropped event consumed no seq — no gap for a reader to misread as loss.
  assert.equal(lines[0].seq, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('emitting after close is a counted drop, not a crash', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'r' });
  sink.emit({ type: 'run-start' });
  await sink.close();
  assert.doesNotThrow(() => sink.emit({ type: 'late' }));
  assert.equal(sink.dropped(), 1);
  assert.equal(readEnvelopes(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('close() flushes everything already emitted', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'r' });
  const many = 500;
  for (let i = 0; i < many; i += 1) sink.emit({ type: 'log', message: 'x'.repeat(200) });
  await sink.close();
  assert.equal(readEnvelopes(dir).length, many);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('close() on a broken sink resolves instead of hanging', async () => {
  const sink = createEventSink(path.join(os.devNull, 'impossible'), { runId: 'r' });
  await sink.close(); // must resolve; the test times out if it does not
  assert.ok(sink.dropped() >= 0);
});

// ---------------------------------------------------------------------------
// Torn-line tolerance — JournalTail pointed at events.ndjson
// ---------------------------------------------------------------------------

test('JournalTail holds a torn events line back until its newline arrives', async () => {
  const dir = tmpDir('yoki-events-');
  const sink = createEventSink(dir, { runId: 'r' });
  sink.emit({ type: 'run-start', name: 'flow' });
  await sink.close();

  // Simulate the writer mid-append: a partial line with no terminating \n.
  const torn = '{"v":1,"seq":2,"ts":1,"runId":"r","type":"log","message":"日本語の途中';
  fs.appendFileSync(eventsPath(dir), torn);

  // JournalTail is journal.jsonl's incremental reader, reused verbatim: the
  // file format (JSONL, single writer, append-only) is the same, so the same
  // partial-line and truncation handling applies.
  const tail = new JournalTail('irrelevant');
  tail.file = eventsPath(dir);
  tail.reset();

  const first = tail.read();
  assert.equal(first.length, 1, 'the torn line must be held back, not parsed or dropped');
  assert.equal(first[0].type, 'run-start');

  // The writer finishes the line: it becomes visible on the next poll.
  fs.appendFileSync(eventsPath(dir), 'まだ続く"}\n');
  const second = tail.read();
  assert.equal(second.length, 2);
  assert.equal(second[1].type, 'log');
  assert.equal(second[1].message, '日本語の途中まだ続く');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The runner tee — end to end against the mock backend
// ---------------------------------------------------------------------------

/** Isolated state per test — see runner.test.js's header comment. */
function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-events-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-events-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-events-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  return Promise.resolve(fn(cwd)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

function writeScript(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

const TEE_SCRIPT = `export const meta = { name: 'tee-flow', description: 'd' }
phase('P1')
const r = await agent('hi', { label: 'greet' })
return { r }`;

test('a run tees its events into events.ndjson without changing the journal', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', TEE_SCRIPT);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ greet: 'hello!' }));

  const emitted = [];
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture, emit: (e) => emitted.push(e),
  });
  assert.equal(result.status, 'ok');

  const dir = runDir(result.runId);
  const lines = readEnvelopes(dir);
  const order = lines.map((l) => l.type);
  const expected = ['run-start', 'agent-start', 'agent-end', 'run-end'];
  const positions = expected.map((t) => order.indexOf(t));
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(positions[i] !== -1, `events.ndjson has no ${expected[i]} event (saw: ${order.join(', ')})`);
    if (i > 0) assert.ok(positions[i] > positions[i - 1], `${expected[i]} must come after ${expected[i - 1]}`);
  }
  // Everything the CLI emitter saw is in the file — the tee drops nothing.
  assert.equal(lines.length, emitted.length);
  for (const line of lines) {
    assert.equal(line.v, 1);
    assert.equal(line.runId, result.runId);
  }
  const seqs = lines.map((l) => l.seq);
  assert.deepEqual(seqs, Array.from({ length: lines.length }, (_, i) => i + 1));

  // The journal is untouched by the tee: one ok line for the one agent()
  // call, carrying no envelope fields — journal.jsonl stays exactly what
  // resume replays, nothing more.
  const entries = new Journal(result.runId).readAll();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'ok');
  assert.equal(entries[0].label, 'greet');
  assert.ok(!('v' in entries[0]) && !('seq' in entries[0]), 'envelope fields leaked into the journal');
}));

test('run.json carries lastEventAt, and the final write stamps it beside the final status', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', TEE_SCRIPT);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ greet: 'hello!' }));

  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
  });
  const meta = runner.readRunMeta(result.runId);
  assert.equal(meta.status, 'ok');
  assert.equal(typeof meta.lastEventAt, 'number');
  assert.ok(meta.lastEventAt <= Date.now());
}));

test('resume NEVER reads events.ndjson: a corrupted event stream changes nothing about replay', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', TEE_SCRIPT);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ greet: 'first answer' }));

  const first = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
  });
  assert.equal(first.status, 'ok');

  // Vandalize the event stream — garbage bytes, then a plausible-looking but
  // lying line. If any resume path parsed this file, the replay below would
  // either fail or return the lie.
  fs.writeFileSync(path.join(runDir(first.runId), 'events.ndjson'),
    'not json at all\n{"v":1,"seq":1,"type":"agent-end","result":"a lie"}\n');
  // A rerun against a CHANGED fixture: only a journal replay can produce the
  // original answer, so getting it back proves events.ndjson was never read.
  // (The mock backend caches fixtures by path — drop it, or the rerun would
  // still serve the first answer even if it wrongly ran live.)
  fs.writeFileSync(fixture, JSON.stringify({ greet: 'second answer' }));
  require('../backends/mock').clearFixtureCache();

  const events = [];
  const resumed = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
    runId: first.runId, emit: (e) => events.push(e),
  });
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.result.r, 'first answer', 'replay must come from journal.jsonl alone');
  assert.ok(events.some((e) => e.type === 'agent-cached'), 'the call must be replayed, not re-run');
}));

test('a guard-denied run still lands its refusal in the event stream', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', TEE_SCRIPT);
  // A zero daily cap denies the very first top-level run.
  const prevCap = process.env.YOKI_WORKFLOW_DAILY_CAP;
  process.env.YOKI_WORKFLOW_DAILY_CAP = '0';
  let result;
  try {
    result = await runner.executeScript({
      scriptPath, args: {}, backendName: 'mock', cwd,
    });
  } finally {
    if (prevCap === undefined) delete process.env.YOKI_WORKFLOW_DAILY_CAP;
    else process.env.YOKI_WORKFLOW_DAILY_CAP = prevCap;
  }
  assert.equal(result.status, 'denied');
  const lines = readEnvelopes(runDir(result.runId));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'guard-denied');
  // No run.json for a denied run — exactly as before the tee existed.
  assert.equal(runner.readRunMeta(result.runId), null);
}));
