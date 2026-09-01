'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pendingContext = require('../pending-context');

function freshEnv() {
  return { XDG_STATE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-')) };
}

test('queuePath honours XDG_STATE_HOME and names the file <harness>-<sessionId>.jsonl', () => {
  const p = pendingContext.queuePath({ harness: 'codex', sessionId: 'abc123' }, { XDG_STATE_HOME: '/tmp/state' });
  assert.equal(p, path.join('/tmp/state', 'yoki', 'pending-context', 'codex-abc123.jsonl'));
});

test('queuePath falls back to ~/.local/state', () => {
  const p = pendingContext.queuePath({ harness: 'omp', sessionId: 's1' }, { HOME: '/home/nobody' });
  assert.equal(p, path.join('/home/nobody', '.local', 'state', 'yoki', 'pending-context', 'omp-s1.jsonl'));
});

test('queuePath sanitizes unsafe characters in harness/sessionId', () => {
  const p = pendingContext.queuePath(
    { harness: '../../etc', sessionId: 'a/b c' },
    { XDG_STATE_HOME: '/tmp/state' }
  );
  assert.equal(path.dirname(p), path.join('/tmp/state', 'yoki', 'pending-context'));
  assert.equal(path.basename(p), '.._.._etc-a_b_c.jsonl');
});

test('queuePath defaults missing harness/sessionId rather than throwing', () => {
  const p = pendingContext.queuePath({}, { XDG_STATE_HOME: '/tmp/state' });
  assert.equal(p, path.join('/tmp/state', 'yoki', 'pending-context', 'claude-unknown.jsonl'));
});

test('drain on a queue that was never written returns []', () => {
  const env = freshEnv();
  assert.deepEqual(pendingContext.drain({ harness: 'claude', sessionId: 's1' }, env), []);
});

test('enqueue then drain round-trips the text, oldest first', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { source: 'a', text: 'first' }, env);
  pendingContext.enqueue(session, { source: 'b', text: 'second' }, env);

  assert.deepEqual(pendingContext.drain(session, env), ['first', 'second']);
});

test('drain clears the queue — a second drain sees nothing', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { source: 'a', text: 'only once' }, env);

  assert.deepEqual(pendingContext.drain(session, env), ['only once']);
  assert.deepEqual(pendingContext.drain(session, env), []);
});

test('each session gets its own file — one session cannot drain another', () => {
  const env = freshEnv();
  pendingContext.enqueue({ harness: 'codex', sessionId: 's1' }, { text: 'for codex s1' }, env);
  pendingContext.enqueue({ harness: 'claude', sessionId: 's1' }, { text: 'for claude s1' }, env);
  pendingContext.enqueue({ harness: 'codex', sessionId: 's2' }, { text: 'for codex s2' }, env);

  assert.deepEqual(pendingContext.drain({ harness: 'codex', sessionId: 's1' }, env), ['for codex s1']);
  assert.deepEqual(pendingContext.drain({ harness: 'claude', sessionId: 's1' }, env), ['for claude s1']);
  assert.deepEqual(pendingContext.drain({ harness: 'codex', sessionId: 's2' }, env), ['for codex s2']);
});

test('an empty or whitespace-only text is never queued', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { source: 'a', text: '' }, env);
  pendingContext.enqueue(session, { source: 'a', text: '   ' }, env);
  pendingContext.enqueue(session, { text: undefined }, env);

  assert.deepEqual(pendingContext.drain(session, env), []);
  assert.ok(!fs.existsSync(pendingContext.queuePath(session, env)), 'nothing worth queuing means no file at all');
});

test('an expired item is dropped by drain, a live one survives', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  const file = pendingContext.queuePath(session, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const already = Date.now() / 1000 - 10;
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ source: 'compaction', text: 'stale summary', expires_at: already }),
      JSON.stringify({ source: 'compaction', text: 'fresh summary' }),
    ].join('\n') + '\n',
    'utf8'
  );

  assert.deepEqual(pendingContext.drain(session, env), ['fresh summary']);
});

test('enqueue with a positive ttlSec sets an expiry in the future', () => {
  const env = freshEnv();
  const session = { harness: 'codex', sessionId: 's1' };
  const before = Date.now() / 1000;
  pendingContext.enqueue(session, { source: 'compaction', text: 'summary', ttlSec: 7200 }, env);

  const raw = fs.readFileSync(pendingContext.queuePath(session, env), 'utf8').trim();
  const record = JSON.parse(raw);
  assert.equal(record.source, 'compaction');
  assert.equal(record.text, 'summary');
  assert.ok(record.expires_at > before + 7000 && record.expires_at < before + 7300, record.expires_at);
});

test('enqueue with no ttlSec never expires', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { text: 'lives forever' }, env);

  const raw = fs.readFileSync(pendingContext.queuePath(session, env), 'utf8').trim();
  const record = JSON.parse(raw);
  assert.equal(record.expires_at, undefined);
  assert.deepEqual(pendingContext.drain(session, env), ['lives forever']);
});

test('source defaults to "unknown" when omitted', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { text: 'no source given' }, env);

  const raw = fs.readFileSync(pendingContext.queuePath(session, env), 'utf8').trim();
  assert.equal(JSON.parse(raw).source, 'unknown');
});

test('a truncated final line does not cost the entries that parsed', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  const file = pendingContext.queuePath(session, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ source: 'a', text: 'good line' })}\n{"source":"a","tex\n`,
    'utf8'
  );

  assert.deepEqual(pendingContext.drain(session, env), ['good line']);
});

test('drain defaults to process.env when no env override is passed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-pending-context-'));
  const saved = Object.prototype.hasOwnProperty.call(process.env, 'XDG_STATE_HOME')
    ? process.env.XDG_STATE_HOME
    : undefined;
  process.env.XDG_STATE_HOME = dir;
  try {
    const session = { harness: 'claude', sessionId: 's1' };
    pendingContext.enqueue(session, { text: 'via process.env' });
    assert.deepEqual(pendingContext.drain(session), ['via process.env']);
  } finally {
    if (saved === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved;
  }
});
