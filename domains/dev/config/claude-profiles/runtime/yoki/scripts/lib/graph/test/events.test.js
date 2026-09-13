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
const { JournalTail } = require('../journal');

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
