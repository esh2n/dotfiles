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

test('callKey is stable for the same prompt+opts and ignores label', () => {
  withTempStateHome(({ callKey }) => {
    const a = callKey('do it', { model: 'sonnet', label: 'first-label' });
    const b = callKey('do it', { model: 'sonnet', label: 'a-totally-different-label' });
    assert.equal(a, b);
    const c = callKey('do it', { model: 'opus', label: 'first-label' });
    assert.notEqual(a, c);
    const d = callKey('a different prompt', { model: 'sonnet' });
    assert.notEqual(a, d);
  });
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

test('Journal getCached returns only status=ok entries, and the LATEST one for a repeated key', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('test-run-2');
    j.append({ key: 'k1', label: 'a', status: 'error', error: 'first try failed' });
    assert.equal(j.getCached('k1'), undefined);
    j.append({ key: 'k1', label: 'a', status: 'ok', result: 'recovered' });
    assert.equal(j.getCached('k1').result, 'recovered');
  });
});

test('Journal.loadForResume tolerates a truncated/corrupt trailing line', () => {
  withTempStateHome(({ Journal, journalPath }) => {
    const j = new Journal('test-run-3');
    j.append({ key: 'k1', label: 'a', status: 'ok', result: 'fine' });
    fs.appendFileSync(journalPath('test-run-3'), '{"key":"k2","status":"ok","result": incomplete-json\n');
    const map = j.loadForResume();
    assert.equal(map.get('k1').result, 'fine');
    assert.equal(map.has('k2'), false);
  });
});

test('a fresh run with no journal file yet has no cached entries and zero tokens spent', () => {
  withTempStateHome(({ Journal }) => {
    const j = new Journal('never-run-before');
    assert.equal(j.getCached('anything'), undefined);
    assert.equal(j.tokensSpent(), 0);
    assert.deepEqual(j.readAll(), []);
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
