'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  checkRace,
  runRaceTests,
  readTouchedPackages,
  markerPathFor,
  extractSessionId
} = require('../go-guard-race.js');

const ENABLED = { isHookEnabled: () => true };
const DISABLED = { isHookEnabled: () => false };

function tempMarker() {
  return path.join(os.tmpdir(), `go-guard-race-test-marker-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
}

test('no touched packages (no marker file): silent, no exec calls', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkRace('session-x', { execFn, hookFlags: ENABLED, markerPath: tempMarker() });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('hook disabled for the current profile: no exec calls even with a marker present', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n');
  try {
    let calls = 0;
    const execFn = () => {
      calls += 1;
      return '';
    };
    const lines = checkRace('session-x', { execFn, hookFlags: DISABLED, markerPath: marker });
    assert.deepEqual(lines, []);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('go test -race failure reports at most 10 stderr lines', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n');
  try {
    const execFn = () => {
      const err = new Error('race detected');
      const lines = [];
      for (let i = 0; i < 15; i++) lines.push(`DATA RACE line ${i}`);
      err.stdout = lines.join('\n');
      err.stderr = '';
      throw err;
    };
    const lines = checkRace('session-x', { execFn, hookFlags: ENABLED, markerPath: marker });
    assert.ok(lines.length > 0);
    assert.ok(lines.length <= 10, `expected <=10 lines, got ${lines.length}`);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('go missing on PATH: silent, no lines', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n');
  try {
    const execFn = () => {
      const err = new Error('go: command not found');
      err.code = 'ENOENT';
      throw err;
    };
    const lines = checkRace('session-x', { execFn, hookFlags: ENABLED, markerPath: marker });
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('marker file is cleared after a run', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n');
  const execFn = () => '';
  checkRace('session-x', { execFn, hookFlags: ENABLED, markerPath: marker });
  assert.equal(fs.existsSync(marker), false);
});

test('marker file is preserved when keepMarker is set (test-only escape hatch)', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n');
  try {
    const execFn = () => '';
    checkRace('session-x', { execFn, hookFlags: ENABLED, markerPath: marker, keepMarker: true });
    assert.equal(fs.existsSync(marker), true);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('readTouchedPackages dedupes and trims, missing file yields []', () => {
  const marker = tempMarker();
  fs.writeFileSync(marker, '/tmp/pkg\n/tmp/pkg\n/tmp/other\n\n');
  try {
    assert.deepEqual(readTouchedPackages(marker).sort(), ['/tmp/other', '/tmp/pkg']);
  } finally {
    fs.rmSync(marker, { force: true });
  }
  assert.deepEqual(readTouchedPackages(tempMarker()), []);
});

test('runRaceTests stops requesting more tests once 10 lines are collected', () => {
  let execCalls = 0;
  const execFn = () => {
    execCalls += 1;
    const err = new Error('race');
    err.stdout = 'DATA RACE a\nDATA RACE b\nDATA RACE c\nDATA RACE d\nDATA RACE e\nDATA RACE f';
    err.stderr = '';
    throw err;
  };
  const lines = runRaceTests(['/tmp/a', '/tmp/b', '/tmp/c'], { execFn });
  assert.ok(lines.length <= 10);
  // 6 lines per package means package 2 alone already exceeds 10, so a 3rd
  // package should never be invoked.
  assert.ok(execCalls <= 2, `expected early stop, got ${execCalls} exec calls`);
});

test('markerPathFor sanitizes the session id into a safe filename', () => {
  const p = markerPathFor('abc/123 ../../etc');
  assert.ok(!p.includes('/../'));
  assert.ok(path.basename(p).startsWith('yoki-go-guard-touched-'));
});

test('extractSessionId reads session_id from Stop hook JSON, fails safe on garbage', () => {
  assert.equal(extractSessionId(JSON.stringify({ session_id: 'abc' })), 'abc');
  assert.equal(extractSessionId('not json'), '');
});
