'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  checkWebFile,
  extractFilePath,
  filterRelevantLines,
  findConfigDir,
  resolveLocalBin,
  appendCapped
} = require('../web-css-lint-post-edit.js');

const ENABLED_STANDARD = { isHookEnabled: () => true, getHookProfile: () => 'standard' };
const ENABLED_STRICT = { isHookEnabled: () => true, getHookProfile: () => 'strict' };
const DISABLED = { isHookEnabled: () => false, getHookProfile: () => 'standard' };

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tempMarker() {
  return path.join(os.tmpdir(), `web-guard-test-marker-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
}

test('non-matching extension is a no-op (no exec calls at all)', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkWebFile('/tmp/notes.md', { execFn, hookFlags: ENABLED_STANDARD });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('.vue/.svelte/.astro are not matched — pure stylesheet/markup extensions only', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  for (const f of ['/tmp/App.vue', '/tmp/App.svelte', '/tmp/App.astro']) {
    const lines = checkWebFile(f, { execFn, hookFlags: ENABLED_STANDARD });
    assert.deepEqual(lines, []);
  }
  assert.equal(calls, 0);
});

test('empty file path passes through silently', () => {
  const lines = checkWebFile('', { execFn: () => '', hookFlags: ENABLED_STANDARD });
  assert.deepEqual(lines, []);
});

test('hook disabled for the current profile: no exec calls, no output', () => {
  let calls = 0;
  const execFn = () => {
    calls += 1;
    return '';
  };
  const lines = checkWebFile('/tmp/site/style.css', { execFn, hookFlags: DISABLED });
  assert.deepEqual(lines, []);
  assert.equal(calls, 0);
});

test('findConfigDir walks up and stops at the first hit (nearest wins)', () => {
  const root = mkTmpDir('web-guard-walk-');
  try {
    const outer = root;
    const inner = path.join(root, 'pkg', 'src');
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(outer, '.stylelintrc'), '{}');
    fs.mkdirSync(path.join(root, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pkg', '.stylelintrc.json'), '{}');

    const tool = {
      configFiles: [
        '.stylelintrc',
        '.stylelintrc.json',
        '.stylelintrc.yaml',
        '.stylelintrc.yml',
        '.stylelintrc.js',
        '.stylelintrc.cjs',
        '.stylelintrc.mjs',
        'stylelint.config.js',
        'stylelint.config.cjs',
        'stylelint.config.mjs'
      ],
      pkgKey: 'stylelint'
    };

    const found = findConfigDir(inner, tool);
    assert.equal(found, path.join(root, 'pkg'), 'should stop at the nearest ancestor with a config');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package.json "stylelint" key counts as a config hit', () => {
  const root = mkTmpDir('web-guard-pkgkey-');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ stylelint: { extends: 'x' } }));
    const dir = path.join(root, 'src');
    fs.mkdirSync(dir, { recursive: true });

    const tool = { configFiles: ['.stylelintrc'], pkgKey: 'stylelint' };
    const found = findConfigDir(dir, tool);
    assert.equal(found, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package.json without the tool key is not a config hit', () => {
  const root = mkTmpDir('web-guard-nopkgkey-');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x' }));
    const dir = path.join(root, 'src');
    fs.mkdirSync(dir, { recursive: true });

    const tool = { configFiles: ['.stylelintrc'], pkgKey: 'stylelint' };
    const found = findConfigDir(dir, tool);
    assert.equal(found, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLocalBin prefers a local node_modules/.bin binary, walking up from the config dir', () => {
  const root = mkTmpDir('web-guard-localbin-');
  try {
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = path.join(binDir, 'stylelint');
    fs.writeFileSync(binPath, '#!/bin/sh\n');
    fs.chmodSync(binPath, 0o755);

    const configDir = path.join(root, 'packages', 'app');
    fs.mkdirSync(configDir, { recursive: true });

    const found = resolveLocalBin(configDir, 'stylelint');
    assert.equal(found, binPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local bin is preferred over PATH: checkWebFile invokes the resolved local path, not the bare name', () => {
  const root = mkTmpDir('web-guard-preferlocal-');
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binPath = path.join(binDir, 'stylelint');
    fs.writeFileSync(binPath, '#!/bin/sh\n');
    fs.chmodSync(binPath, 0o755);

    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    let calledCmd = null;
    const execFn = (cmd) => {
      calledCmd = cmd;
      return '';
    };

    checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
    assert.equal(calledCmd, binPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to the bare binary name on PATH when no local bin exists', () => {
  const root = mkTmpDir('web-guard-pathfallback-');
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    let calledCmd = null;
    const execFn = (cmd) => {
      calledCmd = cmd;
      return '';
    };

    checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
    assert.equal(calledCmd, 'stylelint');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no config found: silent at standard profile', () => {
  const root = mkTmpDir('web-guard-noconfig-standard-');
  try {
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    let calls = 0;
    const execFn = () => {
      calls += 1;
      return '';
    };
    const marker = tempMarker();
    const lines = checkWebFile(file, {
      execFn,
      hookFlags: ENABLED_STANDARD,
      noConfigMarkerPath: marker
    });
    assert.deepEqual(lines, []);
    assert.equal(calls, 0, 'must not invoke the linter without a project config');
    assert.equal(fs.existsSync(marker), false, 'must not even write the hint marker at standard');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no config found: one-line hint at strict, not repeated on a second edit', () => {
  const root = mkTmpDir('web-guard-noconfig-strict-');
  const originalWrite = process.stderr.write;
  const written = [];
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');
    const marker = tempMarker();

    checkWebFile(file, { execFn: () => '', hookFlags: ENABLED_STRICT, noConfigMarkerPath: marker });
    checkWebFile(file, { execFn: () => '', hookFlags: ENABLED_STRICT, noConfigMarkerPath: marker });

    const hintLines = written.filter(l => l.includes('[web-guard]'));
    assert.equal(hintLines.length, 1, 'hint must print exactly once across both calls');
    assert.ok(hintLines[0].split('\n').filter(Boolean).length <= 1, 'hint must be a single line');
  } finally {
    process.stderr.write = originalWrite;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('config found, binary missing everywhere: one hint, exit clean, no crash', () => {
  const root = mkTmpDir('web-guard-nobin-');
  const originalWrite = process.stderr.write;
  const written = [];
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');
    const marker = tempMarker();

    const execFn = () => {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    };

    const lines1 = checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD, noBinMarkerPath: marker });
    const lines2 = checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD, noBinMarkerPath: marker });

    assert.deepEqual(lines1, []);
    assert.deepEqual(lines2, []);
    const hintLines = written.filter(l => l.includes('[web-guard]'));
    assert.equal(hintLines.length, 1);
  } finally {
    process.stderr.write = originalWrite;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('output is filtered to the edited file and capped at 10 lines', () => {
  const root = mkTmpDir('web-guard-filter-');
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    const execFn = () => {
      const err = new Error('lint failed');
      const lines = [];
      for (let i = 0; i < 15; i++) {
        lines.push(`style.css:${i}:1: error ${i}`);
        lines.push(`other.css:${i}:1: unrelated ${i}`);
      }
      err.stdout = lines.join('\n');
      err.stderr = '';
      throw err;
    };

    const lines = checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
    assert.ok(lines.length > 0);
    assert.ok(lines.length <= 10);
    for (const line of lines) {
      assert.ok(line.includes('style.css') && !line.includes('other.css'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean lint run (no findings) reports nothing', () => {
  const root = mkTmpDir('web-guard-clean-');
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    const lines = checkWebFile(file, { execFn: () => '', hookFlags: ENABLED_STANDARD });
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exec throwing a plain error (no .code, no .stdout/.stderr) never crashes the hook', () => {
  const root = mkTmpDir('web-guard-crash-');
  try {
    fs.writeFileSync(path.join(root, '.stylelintrc'), '{}');
    const file = path.join(root, 'style.css');
    fs.writeFileSync(file, 'a{}');

    const execFn = () => {
      throw new Error('boom');
    };

    assert.doesNotThrow(() => {
      const lines = checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
      assert.deepEqual(lines, []);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('html files use html-validate config discovery and binary', () => {
  const root = mkTmpDir('web-guard-html-');
  try {
    fs.writeFileSync(path.join(root, '.htmlvalidate.json'), '{}');
    const file = path.join(root, 'index.html');
    fs.writeFileSync(file, '<html></html>');

    let calledCmd = null;
    let calledArgs = null;
    const execFn = (cmd, args) => {
      calledCmd = cmd;
      calledArgs = args;
      return '';
    };

    const lines = checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
    assert.deepEqual(lines, []);
    assert.equal(calledCmd, 'html-validate');
    assert.deepEqual(calledArgs, [file]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('.htm matches the same html-validate path as .html', () => {
  const root = mkTmpDir('web-guard-htm-');
  try {
    fs.writeFileSync(path.join(root, '.htmlvalidate.js'), 'module.exports = {};');
    const file = path.join(root, 'page.htm');
    fs.writeFileSync(file, '<html></html>');

    let calls = 0;
    const execFn = () => {
      calls += 1;
      return '';
    };
    checkWebFile(file, { execFn, hookFlags: ENABLED_STANDARD });
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractFilePath reads tool_input.file_path from PostToolUse JSON', () => {
  const raw = JSON.stringify({ tool_input: { file_path: '/repo/src/style.css' } });
  assert.equal(extractFilePath(raw), '/repo/src/style.css');
});

test('extractFilePath fails safe (empty string) on malformed JSON', () => {
  assert.equal(extractFilePath('{not json'), '');
});

test('filterRelevantLines drops lines that do not mention the edited file', () => {
  const output = ['style.css:1: issue A', 'other.css:2: issue B', ''].join('\n');
  const lines = filterRelevantLines(output, '/tmp/pkg/style.css', '/tmp/pkg');
  assert.deepEqual(lines, ['style.css:1: issue A']);
});

test('appendCapped never grows the buffer past the cap, truncating the overflowing chunk', () => {
  let data = '';
  data = appendCapped(data, 'a'.repeat(10), 15);
  assert.equal(data.length, 10);
  data = appendCapped(data, 'b'.repeat(20), 15);
  assert.equal(data.length, 15, 'must be capped, not 30');
  assert.equal(data, 'a'.repeat(10) + 'b'.repeat(5));
  // Further chunks past the cap are fully ignored.
  data = appendCapped(data, 'c'.repeat(5), 15);
  assert.equal(data.length, 15);
  assert.ok(!data.includes('c'), 'stdin content past the cap must be ignored');
});
