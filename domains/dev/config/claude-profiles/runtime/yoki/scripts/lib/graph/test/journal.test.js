'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withTempStateHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-journal-'));
  const prev = process.env.YOKI_STATE_HOME;
  process.env.YOKI_STATE_HOME = dir;
  delete require.cache[require.resolve('../journal')];
  const journalLib = require('../journal');
  try {
    return fn(journalLib, dir);
  } finally {
    if (prev === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prev;
    delete require.cache[require.resolve('../journal')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('callKey is stable for the same prompt+opts+label, and a script-chosen label is part of identity', () => {
  withTempStateHome(({ callKey }) => {
    const a = callKey('do it', { model: 'sonnet', label: 'first-label' });
    assert.equal(a, callKey('do it', { model: 'sonnet', label: 'first-label' }));
    // Two lanes sending the same prompt under different labels are different
    // work — a label the script chose is identity, not decoration.
    assert.notEqual(a, callKey('do it', { model: 'sonnet', label: 'a-totally-different-label' }));
    const c = callKey('do it', { model: 'opus', label: 'first-label' });
    assert.notEqual(a, c);
    const d = callKey('a different prompt', { model: 'sonnet' });
    assert.notEqual(a, d);
  });
});

test('callKey ignores an auto-generated label — it embeds arrival order, which is not stable', () => {
  withTempStateHome(({ callKey }) => {
    const bare = callKey('do it', { model: 'sonnet' });
    assert.equal(callKey('do it', { model: 'sonnet', label: '(unlabeled)' }), bare);
    assert.equal(callKey('do it', { model: 'sonnet', label: 'agent-7' }), bare);
    assert.equal(callKey('do it', { model: 'sonnet', label: '   ' }), bare);
  });
});

test('journal.js contains no raw NUL byte — git must keep treating it as text', () => {
  // The hash separator is written as the `'\0'` escape, not a literal 0x00
  // byte. A raw NUL made git classify this whole module as binary, so its
  // diffs rendered as "Binary files ... differ" — the resume-cache-key logic
  // shipped invisible to review, and every future edit would have too.
  const source = fs.readFileSync(path.join(__dirname, '..', 'journal.js'));
  assert.equal(source.indexOf(0x00), -1, 'journal.js has a raw NUL byte again');
  assert.match(source.toString('utf8'), /h\.update\('\\0'\)/);
});

test('callKey still hashes with a real NUL separator (the escape is byte-identical)', () => {
  // Guards the fix from being "fixed" into '\\0' or ' ', either of which would
  // change every key and silently invalidate existing resume journals.
  withTempStateHome(({ callKey }) => {
    const crypto = require('crypto');
    const expected = crypto.createHash('sha256')
      .update('p')
      .update(String.fromCharCode(0))
      .update('{"model":"sonnet"}')
      .digest('hex');
    assert.equal(callKey('p', { model: 'sonnet' }), expected);
  });
});

test('stateRoot: YOKI_STATE_HOME wins, then XDG_STATE_HOME, then ~/.local/state', () => {
  const { stateRoot } = require('../journal');
  assert.equal(
    stateRoot({ YOKI_STATE_HOME: '/yoki', XDG_STATE_HOME: '/xdg', HOME: '/home/u' }),
    '/yoki'
  );
  // The XDG rung used to be missing entirely: relocating state with
  // XDG_STATE_HOME moved the loop log, the loop inbox cursor and the
  // pending-context queue, but left graph journals under the real home.
  assert.equal(stateRoot({ XDG_STATE_HOME: '/xdg', HOME: '/home/u' }), '/xdg');
  assert.equal(stateRoot({ HOME: '/home/u' }), path.join('/home/u', '.local', 'state'));
});

test('callKey is order-independent for opts keys', () => {
  withTempStateHome(({ callKey }) => {
    const a = callKey('p', { model: 'sonnet', effort: 'high', schema: { type: 'object' } });
    const b = callKey('p', { effort: 'high', schema: { type: 'object' }, model: 'sonnet' });
    assert.equal(a, b);
  });
});

test('Journal append/readAll round-trips entries in order', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-1');
    j.append({ key: 'k1', label: 'a', status: 'ok', result: { x: 1 } });
    j.append({ key: 'k2', label: 'b', status: 'error', error: 'boom' });
    const all = j.readAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].label, 'a');
    assert.equal(all[1].status, 'error');
  });
});

test('replayAt returns an entry only when index AND key both match, and only for status ok', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-2');
    j.append({ key: 'k0', index: 0, status: 'ok', result: 'zero' });
    j.append({ key: 'k1', index: 1, status: 'error', error: 'first try failed' });
    assert.equal(j.replayAt(0, 'k0').result, 'zero');
    // right key, wrong position: NOT the same work
    assert.equal(j.replayAt(1, 'k0'), undefined);
    // right position, wrong key: the call changed
    assert.equal(j.replayAt(0, 'k-other'), undefined);
    // failures are never replayed — a resumed run retries them
    assert.equal(j.replayAt(1, 'k1'), undefined);
  });
});

test('replayAt ignores retry lines: they share the index but never become replayable', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-retry');
    j.append({ key: 'k0', index: 0, status: 'ok', result: 'zero' });
    j.append({ key: 'k1', index: 1, status: 'retry', attempt: 1, error: '429' });
    j.append({ key: 'k1', index: 1, status: 'ok', result: 'one' });
    assert.equal(j.replayAt(1, 'k1').result, 'one');
    assert.equal(j.loadReplaySequence().size, 2);
  });
});

test('a later generation that stopped early invalidates the earlier one\'s stale tail', () => {
  withTempStateHome(({ Journal }) => {
    // Generation 0 recorded calls 0..3. Generation 1 resumed, replayed 0-1,
    // diverged at 2 and got no further than call 2. A third run must NOT
    // replay generation 0's call 3: it was computed from an upstream
    // generation 1 has already replaced.
    const first = new Journal('test-run-generations');
    first.append({ key: 'a', index: 0, status: 'ok', result: 0 });
    first.append({ key: 'b', index: 1, status: 'ok', result: 1 });
    first.append({ key: 'c', index: 2, status: 'ok', result: 2 });
    first.append({ key: 'd', index: 3, status: 'ok', result: 3 });

    const second = new Journal('test-run-generations');
    second.append({ key: 'c2', index: 2, status: 'ok', result: 'new-2' });
    assert.equal(second.generation(), 1, 'each run against a runId is its own generation');

    const third = new Journal('test-run-generations');
    assert.equal(third.replayAt(0, 'a').result, 0);
    assert.equal(third.replayAt(1, 'b').result, 1);
    assert.equal(third.replayAt(2, 'c2').result, 'new-2');
    assert.equal(third.replayAt(3, 'd'), undefined);
    assert.equal(third.loadReplaySequence().size, 3);
  });
});

test('within one generation, out-of-order completion does not break the replay sequence', () => {
  withTempStateHome(({ Journal }) => {
    // Concurrent agent() calls finish out of order, so the journal's LINE
    // order is completion order while `index` is arrival order. A sequence
    // read that trusted line order dropped whichever call finished first.
    const j = new Journal('test-run-concurrent');
    j.append({ key: 'b', index: 1, status: 'ok', result: 'one' });
    j.append({ key: 'a', index: 0, status: 'ok', result: 'zero' });
    j.append({ key: 'c', index: 2, status: 'ok', result: 'two' });

    const fresh = new Journal('test-run-concurrent');
    assert.equal(fresh.loadReplaySequence().size, 3);
    assert.equal(fresh.replayAt(0, 'a').result, 'zero');
    assert.equal(fresh.replayAt(1, 'b').result, 'one');
    assert.equal(fresh.replayAt(2, 'c').result, 'two');
  });
});

test('an older journal with no index at all replays by file order', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-legacy');
    j.append({ key: 'k0', status: 'ok', result: 'zero' });
    j.append({ key: 'k1', status: 'error', error: 'skipped' });
    j.append({ key: 'k2', status: 'ok', result: 'one' });
    const fresh = new Journal('test-run-legacy');
    assert.equal(fresh.replayAt(0, 'k0').result, 'zero');
    assert.equal(fresh.replayAt(1, 'k2').result, 'one');
  });
});

test('loadReplaySequence tolerates a truncated/corrupt trailing line', () => {
  withTempStateHome(({ Journal, journalPath }) => {
    const j = new Journal('test-run-3');
    j.append({ key: 'k1', index: 0, status: 'ok', result: 'fine' });
    fs.appendFileSync(journalPath('test-run-3'), '{"key":"k2","index":1,"status":"ok","result": incomplete-json\n');
    const fresh = new Journal('test-run-3');
    assert.equal(fresh.replayAt(0, 'k1').result, 'fine');
    assert.equal(fresh.replayAt(1, 'k2'), undefined);
  });
});

test('a fresh run with no journal file yet has nothing to replay and zero tokens spent', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('never-run-before');
    assert.equal(j.replayAt(0, 'anything'), undefined);
    assert.equal(j.tokensSpent(), 0);
    assert.deepEqual(j.readAll(), []);
    assert.equal(j.usageTotals().tokens, 0);
  });
});

test('usageTotals splits reported from estimated tokens and sums reported cost', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-usage');
    j.append({ key: 'a', index: 0, status: 'ok', result: 1, tokens: 100, tokensSource: 'reported', usage: { inputTokens: 60, outputTokens: 40, costUsd: 0.25 } });
    j.append({ key: 'b', index: 1, status: 'ok', result: 2, tokens: 25, tokensSource: 'estimated', usage: { estimatedTokens: 25 } });
    j.append({ key: 'c', index: 2, status: 'ok', result: 3, tokens: 70, tokensSource: 'mixed', usage: { reportedTokens: 50, estimatedTokens: 20 } });
    j.append({ key: 'd', index: 3, status: 'error', error: 'boom', tokens: 9, tokensSource: 'reported' });
    const totals = j.usageTotals();
    assert.equal(totals.calls, 3); // the failed call is not an "ok" call
    assert.equal(totals.tokens, 195);
    assert.equal(totals.reportedTokens, 150);
    assert.equal(totals.estimatedTokens, 45);
    assert.equal(totals.costUsd, 0.25);
    assert.equal(totals.hasCost, true);
    // ...but budget.spent() still counts what the failed call really burned.
    assert.equal(j.tokensSpent(), 204);
  });
});

test('tokensSpent sums only entries carrying a numeric tokens field', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-4');
    j.append({ key: 'k1', status: 'ok', result: 'a', tokens: 100 });
    j.append({ key: 'k2', status: 'ok', result: 'b' }); // no tokens field
    j.append({ key: 'k3', status: 'ok', result: 'c', tokens: 50 });
    assert.equal(j.tokensSpent(), 150);
  });
});

// ---------------------------------------------------------------------------
// JournalTail — the incremental reader `status --watch` polls with
// ---------------------------------------------------------------------------

test('JournalTail parses only the bytes appended since the last read', () => {
  withTempStateHome(({ Journal, JournalTail, journalPath }) => {
    const j = new Journal('tail-run');
    j.append({ index: 0, key: 'a', label: 'a', status: 'ok', result: 1 });

    const tail = new JournalTail('tail-run');
    assert.equal(tail.read().length, 1);
    const afterFirst = tail.offset;
    assert.ok(afterFirst > 0);

    // Nothing new: the file is not re-parsed, and the same entries come back.
    assert.equal(tail.read().length, 1);
    assert.equal(tail.offset, afterFirst);

    j.append({ index: 1, key: 'b', label: 'b', status: 'ok', result: 2 });
    const entries = tail.read();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].label, 'b');
    assert.ok(tail.offset > afterFirst, 'the offset did not advance past the appended line');
    assert.ok(fs.existsSync(journalPath('tail-run')));
  });
});

test('JournalTail holds back a partial trailing line instead of dropping it', () => {
  withTempStateHome(({ JournalTail, journalPath, runDir }) => {
    const file = journalPath('partial-run');
    fs.mkdirSync(runDir('partial-run'), { recursive: true });
    // A writer caught mid-append: the last line has no terminating newline.
    fs.writeFileSync(file, `${JSON.stringify({ index: 0, status: 'ok', label: 'a' })}\n{"index":1,"stat`);

    const tail = new JournalTail('partial-run');
    assert.equal(tail.read().length, 1, 'the half-written line was parsed as an entry');

    // The rest arrives; the entry is completed, not lost.
    fs.appendFileSync(file, 'us":"ok","label":"b"}\n');
    const entries = tail.read();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].label, 'b');
  });
});

test('JournalTail re-reads from zero when the file shrinks (truncated or rotated)', () => {
  withTempStateHome(({ Journal, JournalTail, journalPath }) => {
    const j = new Journal('trunc-run');
    j.append({ index: 0, key: 'a', label: 'long-entry-aaaaaaaaaaaaaaaaaaaa', status: 'ok', result: 1 });
    j.append({ index: 1, key: 'b', label: 'long-entry-bbbbbbbbbbbbbbbbbbbb', status: 'ok', result: 2 });

    const tail = new JournalTail('trunc-run');
    assert.equal(tail.read().length, 2);

    // Something replaced the file with a shorter one. The offset now points
    // past the end, so nothing about the old position can be trusted.
    fs.writeFileSync(journalPath('trunc-run'), `${JSON.stringify({ index: 0, status: 'ok', label: 'fresh' })}\n`);
    const entries = tail.read();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'fresh');
  });
});

test('JournalTail returns nothing, not a throw, before the journal exists', () => {
  withTempStateHome(({ JournalTail }) => {
    assert.deepEqual(new JournalTail('never-written').read(), []);
  });
});

// ---------------------------------------------------------------------------
// callKey's execution identity: the resolved backend and model
// ---------------------------------------------------------------------------

test('callKey folds in the RESOLVED backend and model — a replay must not cross models', () => {
  withTempStateHome(({ callKey }) => {
    const base = callKey('p', { label: 'lane' });
    // No execution info: byte-identical to the old two-argument form, so an
    // existing caller and an existing journal are unaffected.
    assert.equal(callKey('p', { label: 'lane' }, {}), base);
    assert.equal(callKey('p', { label: 'lane' }, { backend: '', model: undefined }), base);

    const onCodex = callKey('p', { label: 'lane' }, { backend: 'codex', model: 'gpt-5.5' });
    assert.notEqual(onCodex, base);
    assert.equal(onCodex, callKey('p', { label: 'lane' }, { backend: 'codex', model: 'gpt-5.5' }));

    // Same prompt, same opts, different model: NOT the same work. This is
    // the bug the key used to have — `--model-map` could be repointed and a
    // resume would still hand back the old model's answer.
    assert.notEqual(onCodex, callKey('p', { label: 'lane' }, { backend: 'codex', model: 'gpt-5.6-sol' }));
    // Same model id, different backend: also not the same work.
    assert.notEqual(onCodex, callKey('p', { label: 'lane' }, { backend: 'omp', model: 'gpt-5.5' }));
  });
});

test('callKey\'s execution keys cannot be spoofed by a script option of the same name', () => {
  withTempStateHome(({ callKey }) => {
    // The script writing `agent(p, {backend: 'codex'})` and the runner
    // resolving backend 'omp' must not collide into one key.
    const a = callKey('p', { backend: 'codex' }, { backend: 'omp' });
    const b = callKey('p', { backend: 'omp' }, { backend: 'codex' });
    assert.notEqual(a, b);
  });
});

test('JournalTail keeps multi-byte characters intact across a chunk boundary', () => {
  withTempStateHome(({ Journal, JournalTail, journalPath, runDir }) => {
    const j = new Journal('utf8-run');
    j.append({ index: 0, key: 'a', label: 'レビュー', status: 'ok', result: '日本語の結果' });

    // Read the file in two pieces whose split point lands INSIDE a
    // multi-byte character, the way a poll landing mid-append would.
    // Decoding each piece with buffer.toString('utf8') turns the split
    // character into U+FFFD; the tail must not.
    const file = journalPath('utf8-run');
    const whole = fs.readFileSync(file);
    // Split one byte INTO the first multi-byte sequence, not at an
    // arbitrary midpoint that would land on an ASCII boundary and prove
    // nothing.
    let half = -1;
    for (let i = 0; i < whole.length; i += 1) {
      if (whole[i] >= 0xc0) { half = i + 1; break; }
    }
    assert.ok(half > 0, 'the fixture has no multi-byte character to split');
    fs.mkdirSync(runDir('split-run'), { recursive: true });
    const splitFile = journalPath('split-run');
    fs.writeFileSync(splitFile, whole.subarray(0, half));

    const tail = new JournalTail('split-run');
    tail.read(); // no complete line yet — the last line has no newline
    fs.appendFileSync(splitFile, whole.subarray(half));
    const entries = tail.read();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'レビュー');
    assert.equal(entries[0].result, '日本語の結果');
    assert.ok(!JSON.stringify(entries).includes('�'), 'a character was mangled at the chunk boundary');
  });
});
