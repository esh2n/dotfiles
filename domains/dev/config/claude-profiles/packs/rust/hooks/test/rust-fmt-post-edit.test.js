'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { checkRustFile, extractFilePath, filterRelevantLines, appendCapped } = require('../rust-fmt-post-edit.js');

const ENABLED = { isHookEnabled: () => true };
const DISABLED = { isHookEnabled: () => false };

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Writes an executable stub "rustfmt" and returns an execFn that invokes it
// via `sh <script> <args...>` rather than exec-ing the file directly — see
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

test('non-.rs file is a no-op (no exec calls at all)', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkRustFile('/tmp/notes.md', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('empty file path passes through silently', () => {
  const lines = checkRustFile('', { execFn: () => '', hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('hook disabled for the current profile: no exec calls, no output', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn, hookFlags: DISABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('rustfmt missing on PATH: exits clean with no findings', () => {
  const execFn = () => {
    const err = new Error('rustfmt: command not found');
    err.code = 'ENOENT';
    throw err;
  };
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('runs `rustfmt <file>` scoped to the file dir as cwd', () => {
  let calledCmd = null;
  let calledArgs = null;
  let calledCwd = null;
  const execFn = (cmd, args, opts) => {
    calledCmd = cmd;
    calledArgs = args;
    calledCwd = opts.cwd;
    return '';
  };
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calledCmd, 'rustfmt');
  assert.deepEqual(calledArgs, ['/tmp/pkg/main.rs']);
  assert.equal(calledCwd, '/tmp/pkg');
});

test('real rustfmt stub actually rewrites the edited file (invoked via sh, not directly)', () => {
  const root = mkTmpDir('rust-guard-real-');
  try {
    // args: <file> -> $1
    const stub = stubTool(root, 'fake-rustfmt', 'printf "formatted-by-fake-rustfmt\\n" > "$1"');

    const file = path.join(root, 'main.rs');
    fs.writeFileSync(file, 'fn main(){}\n');

    const lines = checkRustFile(file, { execFn: execViaSh(stub), hookFlags: ENABLED });
    assert.deepEqual(lines, []);
    assert.equal(fs.readFileSync(file, 'utf8'), 'formatted-by-fake-rustfmt\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out invocation is silent, same as a missing tool', () => {
  const execFn = () => {
    const err = new Error('timed out');
    err.killed = true;
    err.signal = 'SIGTERM';
    throw err;
  };
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('output is filtered to the edited file and capped at 10 lines', () => {
  const execFn = () => {
    const err = new Error('rustfmt failed');
    const lines = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`main.rs:${i}:1: error: syntax ${i}`);
      lines.push(`other.rs:${i}:1: unrelated ${i}`);
    }
    err.stdout = '';
    err.stderr = lines.join('\n');
    throw err;
  };
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn, hookFlags: ENABLED });
  assert.ok(lines.length > 0);
  assert.ok(lines.length <= 10);
  for (const line of lines) {
    assert.ok(line.includes('main.rs') && !line.includes('other.rs'));
  }
});

test('clean rustfmt run (no findings) reports nothing', () => {
  const lines = checkRustFile('/tmp/pkg/main.rs', { execFn: () => '', hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('extractFilePath reads tool_input.file_path from PostToolUse JSON', () => {
  const raw = JSON.stringify({ tool_input: { file_path: '/repo/src/main.rs' } });
  assert.equal(extractFilePath(raw), '/repo/src/main.rs');
});

test('extractFilePath fails safe (empty string) on malformed JSON', () => {
  assert.equal(extractFilePath('{not json'), '');
});

test('filterRelevantLines drops lines that do not mention the edited file', () => {
  const output = ['main.rs:1: issue A', 'other.rs:2: issue B', ''].join('\n');
  const lines = filterRelevantLines(output, '/tmp/pkg/main.rs', '/tmp/pkg');
  assert.deepEqual(lines, ['main.rs:1: issue A']);
});

test('appendCapped never grows the buffer past the cap', () => {
  let data = '';
  data = appendCapped(data, 'a'.repeat(10), 15);
  data = appendCapped(data, 'b'.repeat(20), 15);
  assert.equal(data.length, 15);
  assert.equal(data, 'a'.repeat(10) + 'b'.repeat(5));
});
