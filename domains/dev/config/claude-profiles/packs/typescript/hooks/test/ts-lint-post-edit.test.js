'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  checkTsFile,
  extractFilePath,
  filterRelevantLines,
  findConfigDir,
  resolveLocalBin,
  appendCapped
} = require('../ts-lint-post-edit.js');

const ENABLED = { isHookEnabled: () => true };
const DISABLED = { isHookEnabled: () => false };

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Writes an executable stub "tool" and returns an execFn that invokes it
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
  return (cmd, args, opts) => execFileSync('sh', [cmd, ...args], opts);
}

test('non-matching extension is a no-op (no exec calls at all)', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkTsFile('/tmp/notes.md', { execFn, hookFlags: ENABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('empty file path passes through silently', () => {
  const lines = checkTsFile('', { execFn: () => '', hookFlags: ENABLED });
  assert.deepEqual(lines, []);
});

test('hook disabled for the current profile: no exec calls, no output', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkTsFile('/tmp/pkg/index.ts', { execFn, hookFlags: DISABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('tier 1: biome config present, biome missing on PATH -> silent, no fallback', () => {
  const root = mkTmpDir('ts-guard-biome-missing-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const execFn = () => {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(lines, [], 'missing tool must exit clean with no findings');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 1: biome config present -> `biome check --write <file>` invoked with the config dir as cwd', () => {
  const root = mkTmpDir('ts-guard-biome-args-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    let calledCmd = null;
    let calledArgs = null;
    let calledCwd = null;
    const execFn = (cmd, args, opts) => {
      calledCmd = cmd;
      calledArgs = args;
      calledCwd = opts.cwd;
      return '';
    };

    checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.equal(calledCmd, 'biome');
    assert.deepEqual(calledArgs, ['check', '--write', file]);
    assert.equal(calledCwd, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 1: real biome stub actually rewrites the edited file (invoked via sh, not directly)', () => {
  const root = mkTmpDir('ts-guard-biome-real-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    // args received: check --write <file> -> $1 $2 $3
    const stub = stubTool(binDir, 'biome', 'printf "formatted-by-fake-biome\\n" > "$3"');

    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const lines = checkTsFile(file, { execFn: execViaSh(stub), hookFlags: ENABLED });
    assert.deepEqual(lines, []);
    assert.equal(fs.readFileSync(file, 'utf8'), 'formatted-by-fake-biome\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 1: local node_modules/.bin/biome is preferred over the bare PATH name', () => {
  const root = mkTmpDir('ts-guard-biome-localbin-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = path.join(binDir, 'biome');
    fs.writeFileSync(binPath, '#!/bin/sh\n');
    fs.chmodSync(binPath, 0o755);

    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    let calledCmd = null;
    const execFn = cmd => {
      calledCmd = cmd;
      return '';
    };

    checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.equal(calledCmd, binPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 2: prettier-only config -> prettier --write runs, eslint is never invoked', () => {
  const root = mkTmpDir('ts-guard-prettier-only-');
  try {
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const calls = [];
    const execFn = (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'prettier');
    assert.deepEqual(calls[0].args, ['--write', file]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 2: eslint-only config -> eslint --fix runs, prettier is never invoked', () => {
  const root = mkTmpDir('ts-guard-eslint-only-');
  try {
    fs.writeFileSync(path.join(root, '.eslintrc.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const calls = [];
    const execFn = (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'eslint');
    assert.deepEqual(calls[0].args, ['--fix', file]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 2: both eslint and prettier configured -> prettier runs before eslint', () => {
  const root = mkTmpDir('ts-guard-both-');
  try {
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    fs.writeFileSync(path.join(root, '.eslintrc.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const calls = [];
    const execFn = (cmd, args) => {
      calls.push(cmd);
      return '';
    };

    checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(calls, ['prettier', 'eslint']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 3: no config at all, biome resolves on PATH -> biome check --write runs', () => {
  const root = mkTmpDir('ts-guard-noconfig-biome-');
  try {
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const calls = [];
    const execFn = (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(lines, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'biome');
    assert.deepEqual(calls[0].args, ['check', '--write', file]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 4: no config, biome missing, oxlint resolves -> oxlint runs lint-only (no --write)', () => {
  const root = mkTmpDir('ts-guard-noconfig-oxlint-');
  try {
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const calls = [];
    const execFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'biome') {
        const err = new Error('not found');
        err.code = 'ENOENT';
        throw err;
      }
      return '';
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(lines, []);
    assert.deepEqual(calls.map(c => c.cmd), ['biome', 'oxlint']);
    assert.deepEqual(calls[1].args, [file]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tier 5: no config, no biome, no oxlint -> exits clean with no findings', () => {
  const root = mkTmpDir('ts-guard-nothing-');
  try {
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const execFn = () => {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out invocation is silent, same as a missing tool', () => {
  const root = mkTmpDir('ts-guard-timeout-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const execFn = () => {
      const err = new Error('timed out');
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('output is filtered to the edited file and capped at 10 lines', () => {
  const root = mkTmpDir('ts-guard-filter-');
  try {
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, 'const x=1');

    const execFn = () => {
      const err = new Error('lint failed');
      const lines = [];
      for (let i = 0; i < 15; i++) {
        lines.push(`index.ts:${i}:1: error ${i}`);
        lines.push(`other.ts:${i}:1: unrelated ${i}`);
      }
      err.stdout = lines.join('\n');
      err.stderr = '';
      throw err;
    };

    const lines = checkTsFile(file, { execFn, hookFlags: ENABLED });
    assert.ok(lines.length > 0);
    assert.ok(lines.length <= 10);
    for (const line of lines) {
      assert.ok(line.includes('index.ts') && !line.includes('other.ts'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findConfigDir stops at the nearest ancestor with a hit', () => {
  const root = mkTmpDir('ts-guard-walk-');
  try {
    const inner = path.join(root, 'pkg', 'src');
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(root, 'pkg', 'biome.json'), '{}');
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');

    const found = findConfigDir(inner, ['biome.json', 'biome.jsonc', '.biomerc'], null);
    assert.equal(found, path.join(root, 'pkg'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package.json "prettier" key counts as a config hit', () => {
  const root = mkTmpDir('ts-guard-pkgkey-');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ prettier: {} }));
    const dir = path.join(root, 'src');
    fs.mkdirSync(dir, { recursive: true });

    const found = findConfigDir(dir, ['.prettierrc'], 'prettier');
    assert.equal(found, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findConfigDir does not walk past the nearest .git boundary', () => {
  const root = mkTmpDir('ts-guard-gitstop-');
  try {
    // outer/  biome.json           <- an unrelated checkout's config
    // outer/repo/.git              <- the edited file's repo boundary
    // outer/repo/src/              <- walk starts here
    const repo = path.join(root, 'repo');
    const inner = path.join(repo, 'src');
    fs.mkdirSync(inner, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');

    assert.equal(findConfigDir(inner, ['biome.json', 'biome.jsonc', '.biomerc'], null), null);
    // But a config INSIDE the boundary dir itself is still found — the stop
    // happens after checking the repo root, not before.
    fs.writeFileSync(path.join(repo, 'biome.json'), '{}');
    assert.equal(findConfigDir(inner, ['biome.json', 'biome.jsonc', '.biomerc'], null), repo);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLocalBin does not resolve a binary from a checkout above the nearest .git', () => {
  const root = mkTmpDir('ts-guard-binstop-');
  try {
    const repo = path.join(root, 'repo');
    const inner = path.join(repo, 'src');
    fs.mkdirSync(inner, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    const outerBin = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(outerBin, { recursive: true });
    fs.writeFileSync(path.join(outerBin, 'biome'), '#!/bin/sh\n');

    assert.equal(resolveLocalBin(inner, 'biome'), null);
    // A binary inside the boundary repo is still preferred and found.
    const repoBin = path.join(repo, 'node_modules', '.bin');
    fs.mkdirSync(repoBin, { recursive: true });
    fs.writeFileSync(path.join(repoBin, 'biome'), '#!/bin/sh\n');
    assert.equal(resolveLocalBin(inner, 'biome'), path.join(repoBin, 'biome'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLocalBin returns null when nothing local exists', () => {
  const root = mkTmpDir('ts-guard-nolocalbin-');
  try {
    assert.equal(resolveLocalBin(root, 'biome'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractFilePath reads tool_input.file_path from PostToolUse JSON', () => {
  const raw = JSON.stringify({ tool_input: { file_path: '/repo/src/index.ts' } });
  assert.equal(extractFilePath(raw), '/repo/src/index.ts');
});

test('extractFilePath fails safe (empty string) on malformed JSON', () => {
  assert.equal(extractFilePath('{not json'), '');
});

test('filterRelevantLines drops lines that do not mention the edited file', () => {
  const output = ['index.ts:1: issue A', 'other.ts:2: issue B', ''].join('\n');
  const lines = filterRelevantLines(output, '/tmp/pkg/index.ts', '/tmp/pkg');
  assert.deepEqual(lines, ['index.ts:1: issue A']);
});

test('appendCapped never grows the buffer past the cap', () => {
  let data = '';
  data = appendCapped(data, 'a'.repeat(10), 15);
  data = appendCapped(data, 'b'.repeat(20), 15);
  assert.equal(data.length, 15);
  assert.equal(data, 'a'.repeat(10) + 'b'.repeat(5));
});
