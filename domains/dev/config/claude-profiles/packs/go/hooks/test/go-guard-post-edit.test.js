'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  checkGoFile,
  extractFilePath,
  markerPathForSession,
  filterRelevantLines
} = require('../go-guard-post-edit.js');

const ENABLED = { isHookEnabled: () => true };
const DISABLED = { isHookEnabled: () => false };

function tempMarker() {
  return path.join(os.tmpdir(), `go-guard-test-marker-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
}

test('non-.go file passes through silently (no exec calls at all)', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkGoFile('/tmp/notes.md', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('empty file path passes through silently', () => {
  const lines = checkGoFile('', { execFn: () => '', hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('.go file with a go vet finding reports at most 10 filtered stderr lines', () => {
  const execFn = (cmd, args) => {
    if (cmd === 'go' && args[0] === 'vet') {
      const err = new Error('vet failed');
      err.stdout = '';
      // 15 lines, only some mention main.go — the rest must be dropped and
      // the output capped at 10 total.
      const lines = [];
      for (let i = 0; i < 15; i++) {
        lines.push(`./main.go:${i}:2: lock value copy (SA${i})`);
      }
      err.stderr = lines.join('\n');
      throw err;
    }
    // staticcheck not installed in this scenario
    const enoent = new Error('not found');
    enoent.code = 'ENOENT';
    throw enoent;
  };

  const lines = checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: ENABLED });
  assert.ok(lines.length > 0, 'expected findings to be reported');
  assert.ok(lines.length <= 10, `expected <=10 lines, got ${lines.length}`);
  for (const line of lines) {
    assert.ok(line.includes('main.go'), `line should mention main.go: ${line}`);
  }
});

test('.go file with no findings from vet/staticcheck reports nothing', () => {
  const execFn = () => ''; // both calls succeed with empty stdout
  const lines = checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('go missing on PATH: silent (no lines), warnOnce called exactly once', () => {
  const execFn = () => {
    const err = new Error('go: command not found');
    err.code = 'ENOENT';
    throw err;
  };
  let warnCalls = 0;
  const lines = checkGoFile('/tmp/pkg/main.go', {
    execFn,
    hookFlags: ENABLED,
    warnOnce: () => {
      warnCalls += 1;
    }
  });
  assert.deepEqual(lines, []);
  assert.equal(warnCalls, 1);
});

test('staticcheck missing (ENOENT) is treated as "not installed", not a finding', () => {
  const execFn = (cmd) => {
    if (cmd === 'go') return ''; // vet clean
    const err = new Error('staticcheck: command not found');
    err.code = 'ENOENT';
    throw err;
  };
  const lines = checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('hook disabled for the current profile: no exec calls, no output', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: DISABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('appends the touched package dir to the marker file on success', () => {
  const marker = tempMarker();
  try {
    const execFn = () => '';
    checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: ENABLED, markerPath: marker });
    const content = fs.readFileSync(marker, 'utf8');
    assert.ok(content.includes(path.resolve('/tmp/pkg')));
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('does not touch the marker file when go is missing', () => {
  const marker = tempMarker();
  const execFn = () => {
    const err = new Error('go: command not found');
    err.code = 'ENOENT';
    throw err;
  };
  checkGoFile('/tmp/pkg/main.go', { execFn, hookFlags: ENABLED, markerPath: marker, warnOnce: () => {} });
  assert.equal(fs.existsSync(marker), false);
});

test('extractFilePath reads tool_input.file_path from PostToolUse JSON', () => {
  const raw = JSON.stringify({ tool_input: { file_path: '/repo/pkg/foo.go' } });
  assert.equal(extractFilePath(raw), '/repo/pkg/foo.go');
});

test('extractFilePath fails safe (empty string) on malformed JSON', () => {
  assert.equal(extractFilePath('{not json'), '');
});

test('markerPathForSession derives a stable, sanitized per-session path', () => {
  const raw = JSON.stringify({ session_id: 'abc-123_ÄÖ' });
  const p = markerPathForSession(raw);
  assert.ok(p.includes('abc-123_'));
  assert.equal(p, markerPathForSession(raw), 'must be deterministic for the same session_id');
});

test('markerPathForSession falls back to a shared marker without a session_id', () => {
  const p = markerPathForSession('{}');
  assert.ok(p.endsWith('yoki-go-guard-touched.txt'));
});

test('filterRelevantLines drops lines that do not mention the edited file', () => {
  const output = ['./main.go:1: issue A', './other.go:2: issue B', ''].join('\n');
  const lines = filterRelevantLines(output, '/tmp/pkg/main.go', '/tmp/pkg');
  assert.deepEqual(lines, ['./main.go:1: issue A']);
});
