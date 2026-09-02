'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { checkPyFile, extractFilePath, filterRelevantLines, appendCapped } = require('../py-lint-post-edit.js');

const ENABLED = { isHookEnabled: () => true };
const DISABLED = { isHookEnabled: () => false };

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Writes an executable stub "ruff" and returns an execFn that invokes it via
// `sh <script> <args...>` rather than exec-ing the file directly — see
// macos-first-exec-stall: a freshly created executable's first direct exec
// on this machine can intermittently hang for ~2 minutes, but going through
// the shell interpreter is immediate. This lets the test exercise a REAL
// subprocess (real argv, real stdout/stderr, real file writes) without that
// flake risk.
function stubTool(dir, name, scriptBody) {
  const scriptPath = path.join(dir, name);
  fs.writeFileSync(scriptPath, `#!/bin/sh\n${scriptBody}\n`);
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function execViaSh(scriptPath) {
  const { execFileSync } = require('node:child_process');
  return (cmd, args, opts) => execFileSync('sh', [scriptPath, ...args], opts);
}

test('non-.py/.pyi file is a no-op (no exec calls at all)', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkPyFile('/tmp/notes.md', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('.pyi stub files are matched too', () => {
  const calls = [];
  const execFn = (cmd, args) => {
    calls.push({ cmd, args });
    return '';
  };
  checkPyFile('/tmp/pkg/types.pyi', { execFn, hookFlags: ENABLED });
  assert.equal(calls.length, 2);
});

test('empty file path passes through silently', () => {
  const lines = checkPyFile('', { execFn: () => '', hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('hook disabled for the current profile: no exec calls, no output', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkPyFile('/tmp/pkg/main.py', { execFn, hookFlags: DISABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('ruff missing on PATH: exits clean, no findings, no second call attempted', () => {
  const calls = [];
  const execFn = (cmd, args) => {
    calls.push({ cmd, args });
    const err = new Error('ruff: command not found');
    err.code = 'ENOENT';
    throw err;
  };
  const lines = checkPyFile('/tmp/pkg/main.py', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls.length, 1, 'must not attempt `ruff check` once `ruff format` proved ruff is absent');
});

test('runs `ruff format <file>` then `ruff check <file>`, both scoped to the file dir', () => {
  const calls = [];
  const execFn = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return '';
  };
  const lines = checkPyFile('/tmp/pkg/main.py', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'ruff');
  assert.deepEqual(calls[0].args, ['format', '/tmp/pkg/main.py']);
  assert.equal(calls[1].cmd, 'ruff');
  assert.deepEqual(calls[1].args, ['check', '/tmp/pkg/main.py']);
  assert.equal(calls[0].cwd, '/tmp/pkg');
  assert.equal(calls[1].cwd, '/tmp/pkg');
});

test('real ruff stub actually rewrites the edited file (invoked via sh, not directly)', () => {
  const root = mkTmpDir('py-guard-real-');
  try {
    // args: format <file> -> $1 $2 ; check <file> -> $1 $2
    const stub = stubTool(
      root,
      'fake-ruff',
      [
        'if [ "$1" = "format" ]; then',
        '  printf "formatted-by-fake-ruff\\n" > "$2"',
        'fi',
        'exit 0'
      ].join('\n')
    );

    const file = path.join(root, 'main.py');
    fs.writeFileSync(file, 'x=1\n');

    const lines = checkPyFile(file, { execFn: execViaSh(stub), hookFlags: ENABLED });
    assert.deepEqual(lines, []);
    assert.equal(fs.readFileSync(file, 'utf8'), 'formatted-by-fake-ruff\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out `ruff format` call is silent, still attempts `ruff check`', () => {
  const calls = [];
  const execFn = (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'format') {
      const err = new Error('timed out');
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    }
    return '';
  };
  const lines = checkPyFile('/tmp/pkg/main.py', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.deepEqual(calls, ['format', 'check']);
});

test('output from `ruff check` is filtered to the edited file and capped at 10 lines', () => {
  const execFn = (cmd, args) => {
    if (args[0] === 'format') return '';
    const err = new Error('lint failed');
    const lines = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`main.py:${i}:1: F401 unused import ${i}`);
      lines.push(`other.py:${i}:1: unrelated ${i}`);
    }
    err.stdout = lines.join('\n');
    err.stderr = '';
    throw err;
  };
  const lines = checkPyFile('/tmp/pkg/main.py', { execFn, hookFlags: ENABLED });
  assert.ok(lines.length > 0);
  assert.ok(lines.length <= 10);
  for (const line of lines) {
    assert.ok(line.includes('main.py') && !line.includes('other.py'));
  }
});

test('extractFilePath reads tool_input.file_path from PostToolUse JSON', () => {
  const raw = JSON.stringify({ tool_input: { file_path: '/repo/pkg/main.py' } });
  assert.equal(extractFilePath(raw), '/repo/pkg/main.py');
});

test('extractFilePath fails safe (empty string) on malformed JSON', () => {
  assert.equal(extractFilePath('{not json'), '');
});

test('filterRelevantLines drops lines that do not mention the edited file', () => {
  const output = ['main.py:1: issue A', 'other.py:2: issue B', ''].join('\n');
  const lines = filterRelevantLines(output, '/tmp/pkg/main.py', '/tmp/pkg');
  assert.deepEqual(lines, ['main.py:1: issue A']);
});

test('appendCapped never grows the buffer past the cap', () => {
  let data = '';
  data = appendCapped(data, 'a'.repeat(10), 15);
  data = appendCapped(data, 'b'.repeat(20), 15);
  assert.equal(data.length, 15);
  assert.equal(data, 'a'.repeat(10) + 'b'.repeat(5));
});
