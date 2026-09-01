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

// --- concurrent enqueue during a drain -------------------------------------
// artifact-comments.js (enqueue) and prompt-pending-context.js (drain) are two
// separate matcher groups on the SAME UserPromptSubmit event, and the harness
// runs one event's hooks as concurrent processes — so an enqueue can land in
// the middle of a drain. It used to be lost forever: drain read the file, then
// unlinked it whole, taking any line appended in between, and the enqueuing
// hook had already advanced its inbox cursor past those comments. drain now
// claims the file with an atomic rename first, so a racing enqueue creates a
// fresh queue file that the claim cannot touch.

test('an enqueue racing a drain survives — the claimed file is not the one it appends to', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  const file = pendingContext.queuePath(session, env);

  pendingContext.enqueue(session, { source: 'a', text: 'already queued' }, env);

  // Fire the racing enqueue at the exact moment drain() has claimed and is
  // reading the file — the window that used to swallow it.
  const realRead = fs.readFileSync;
  let raced = false;
  fs.readFileSync = function patched(target, ...rest) {
    if (!raced && typeof target === 'string' && target.startsWith(`${file}.draining-`)) {
      raced = true;
      pendingContext.enqueue(session, { source: 'b', text: 'arrived mid-drain' }, env);
    }
    return realRead.call(this, target, ...rest);
  };
  let drained;
  try {
    drained = pendingContext.drain(session, env);
  } finally {
    fs.readFileSync = realRead;
  }

  assert.equal(raced, true, 'the patched read never saw a claimed file — drain is not claiming by rename');
  assert.deepEqual(drained, ['already queued']);
  // The racing item is still on disk and comes back on the next drain.
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(pendingContext.drain(session, env), ['arrived mid-drain']);
});

test('drain leaves no claimed temp file behind, even for an unreadable claim', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  const file = pendingContext.queuePath(session, env);
  pendingContext.enqueue(session, { text: 'one' }, env);

  const realRead = fs.readFileSync;
  fs.readFileSync = function patched(target, ...rest) {
    if (typeof target === 'string' && target.startsWith(`${file}.draining-`)) {
      throw Object.assign(new Error('EIO'), { code: 'EIO' });
    }
    return realRead.call(this, target, ...rest);
  };
  try {
    assert.throws(() => pendingContext.drain(session, env), /EIO/);
  } finally {
    fs.readFileSync = realRead;
  }

  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.draining-'));
  assert.deepEqual(leftovers, []);
});

test('two drains racing the same queue: one gets the items, the other gets [] — never a double delivery', () => {
  const env = freshEnv();
  const session = { harness: 'claude', sessionId: 's1' };
  pendingContext.enqueue(session, { text: 'only once' }, env);

  const first = pendingContext.drain(session, env);
  const second = pendingContext.drain(session, env);
  assert.deepEqual([first, second].sort((a, b) => b.length - a.length), [['only once'], []]);
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
