'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findYokiConfig, resolveDailyCap, DEFAULT_DAILY_CAP } = require('../config');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-config-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('findYokiConfig: reads .yoki.json in the given cwd', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, '.yoki.json'), JSON.stringify({ loopDailyCap: 3 }));
    assert.deepEqual(findYokiConfig(root), { loopDailyCap: 3 });
  });
});

test('findYokiConfig: searches upward from a nested cwd', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, '.yoki.json'), JSON.stringify({ loopDailyCap: 7 }));
    const nested = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    assert.deepEqual(findYokiConfig(nested), { loopDailyCap: 7 });
  });
});

test('findYokiConfig: {} when none is found', () => {
  withTempDir((root) => {
    assert.deepEqual(findYokiConfig(root), {});
  });
});

test('findYokiConfig: {} on malformed JSON, never throws', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, '.yoki.json'), '{ not json');
    assert.deepEqual(findYokiConfig(root), {});
  });
});

test('resolveDailyCap: falls back to the default with no config and no flag', () => {
  withTempDir((root) => {
    assert.equal(resolveDailyCap(root, undefined), DEFAULT_DAILY_CAP);
  });
});

test('resolveDailyCap: --max-runs wins over the default', () => {
  withTempDir((root) => {
    assert.equal(resolveDailyCap(root, 10), 10);
  });
});

test('resolveDailyCap: .yoki.json loopDailyCap wins over --max-runs (project config wins)', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, '.yoki.json'), JSON.stringify({ loopDailyCap: 5 }));
    assert.equal(resolveDailyCap(root, 100), 5);
  });
});

test('resolveDailyCap: ignores a non-positive-integer loopDailyCap and falls through', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, '.yoki.json'), JSON.stringify({ loopDailyCap: -1 }));
    assert.equal(resolveDailyCap(root, 9), 9);
  });
});
