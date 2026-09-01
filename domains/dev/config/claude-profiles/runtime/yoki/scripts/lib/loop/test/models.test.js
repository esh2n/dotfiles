'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadHarnessModels, resolveModel } = require('../models');

function withTempDotfilesRoot(harnessModels, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-models-'));
  try {
    const dir = path.join(root, 'domains', 'dev', 'config', 'claude-profiles', 'core');
    fs.mkdirSync(dir, { recursive: true });
    if (harnessModels !== undefined) {
      fs.writeFileSync(path.join(dir, 'harness-models.json'), JSON.stringify(harnessModels));
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('loadHarnessModels: returns the parsed file when present', () => {
  withTempDotfilesRoot({ codex: { sonnet: 'gpt-5.1-codex' } }, (root) => {
    const models = loadHarnessModels(root);
    assert.deepEqual(models, { codex: { sonnet: 'gpt-5.1-codex' } });
  });
});

test('loadHarnessModels: null when the file is missing (pass-through, not an error)', () => {
  withTempDotfilesRoot(undefined, (root) => {
    assert.equal(loadHarnessModels(root), null);
  });
});

test('resolveModel: claude always passes the value through, map or not', () => {
  assert.equal(resolveModel('claude', 'sonnet', { codex: { sonnet: 'x' } }), 'sonnet');
  assert.equal(resolveModel('claude', 'claude-opus-4-1', null), 'claude-opus-4-1');
});

test('resolveModel: codex/omp resolve a known tier through the map', () => {
  const map = { codex: { sonnet: 'gpt-5.1-codex' }, omp: { haiku: 'anthropic/claude-haiku-5' } };
  assert.equal(resolveModel('codex', 'sonnet', map), 'gpt-5.1-codex');
  assert.equal(resolveModel('omp', 'haiku', map), 'anthropic/claude-haiku-5');
});

test('resolveModel: passes through an unrecognized tier or a concrete model id', () => {
  const map = { codex: { sonnet: 'gpt-5.1-codex' } };
  assert.equal(resolveModel('codex', 'gpt-5.1-codex-max-already', map), 'gpt-5.1-codex-max-already');
  assert.equal(resolveModel('omp', 'sonnet', null), 'sonnet');
});

test('resolveModel: tier lookup is case-insensitive', () => {
  const map = { codex: { sonnet: 'gpt-5.1-codex' } };
  assert.equal(resolveModel('codex', 'SONNET', map), 'gpt-5.1-codex');
});

test('resolveModel: empty tier returns empty string', () => {
  assert.equal(resolveModel('codex', '', {}), '');
  assert.equal(resolveModel('codex', undefined, {}), '');
});
