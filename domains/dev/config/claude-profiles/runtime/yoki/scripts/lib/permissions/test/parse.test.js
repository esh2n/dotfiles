'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseYamlPermissions, loadLayer, dedupeEntries, mergeLayers, loadAndMerge } = require('../parse');

test('parseYamlPermissions: allow/deny entries with reason and enforce', () => {
  const text = `
allow:
  - pattern: "Bash(git status *)"
  - pattern: "Read(**)"
    reason: "reads are safe"
deny:
  - pattern: "Bash(rm -rf /*)"
    reason: "wildcard rm"
    enforce: [hook]
defaultMode: auto
`;
  const result = parseYamlPermissions(text);
  assert.deepEqual(result.allow, [{ pattern: 'Bash(git status *)' }, { pattern: 'Read(**)', reason: 'reads are safe' }]);
  assert.deepEqual(result.deny, [{ pattern: 'Bash(rm -rf /*)', reason: 'wildcard rm', enforce: ['hook'] }]);
  assert.equal(result.defaultMode, 'auto');
});

test('parseYamlPermissions: comments and blank lines are ignored', () => {
  const text = `
# a leading comment
allow:
  # another comment
  - pattern: "Bash(ls *)"

deny: []
defaultMode: auto
`;
  const result = parseYamlPermissions(text);
  assert.deepEqual(result.allow, [{ pattern: 'Bash(ls *)' }]);
  assert.deepEqual(result.deny, []);
});

test('parseYamlPermissions: inline empty list closes the block', () => {
  const text = `
allow: []
deny:
  - pattern: "Bash(rm -rf /)"
defaultMode: auto
`;
  const result = parseYamlPermissions(text);
  assert.deepEqual(result.allow, []);
  assert.deepEqual(result.deny, [{ pattern: 'Bash(rm -rf /)' }]);
});

test('parseYamlPermissions: single and double quoted patterns both unquote', () => {
  const text = `
allow:
  - pattern: 'Bash(pwd)'
  - pattern: "Bash(whoami)"
deny: []
defaultMode: auto
`;
  const result = parseYamlPermissions(text);
  assert.deepEqual(result.allow, [{ pattern: 'Bash(pwd)' }, { pattern: 'Bash(whoami)' }]);
});

test('parseYamlPermissions: unrecognized line throws', () => {
  assert.throws(() => parseYamlPermissions('nonsense: {\n'), /unsupported top-level key|unrecognized line/);
});

test('parseYamlPermissions: pattern outside a block throws', () => {
  assert.throws(() => parseYamlPermissions('  - pattern: "Bash(ls)"\n'), /outside an allow\/deny block/);
});

test('loadLayer: missing file yields an empty layer', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-permissions.yaml');
  const result = loadLayer(missing);
  assert.deepEqual(result, { allow: [], deny: [], defaultMode: undefined });
});

test('loadLayer: reads and parses a real file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permissions-'));
  const file = path.join(dir, 'permissions.yaml');
  fs.writeFileSync(file, 'allow:\n  - pattern: "Bash(ls *)"\ndeny: []\ndefaultMode: auto\n', 'utf8');
  const result = loadLayer(file);
  assert.deepEqual(result.allow, [{ pattern: 'Bash(ls *)' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dedupeEntries: dedupes by pattern, keeps first occurrence order', () => {
  const entries = [{ pattern: 'A' }, { pattern: 'B' }, { pattern: 'A', reason: 'later reason' }];
  const result = dedupeEntries(entries);
  assert.deepEqual(result, [{ pattern: 'A', reason: 'later reason' }, { pattern: 'B' }]);
});

test('dedupeEntries: an earlier reason is never overwritten by a later one', () => {
  const entries = [{ pattern: 'A', reason: 'first' }, { pattern: 'A', reason: 'second' }];
  const result = dedupeEntries(entries);
  assert.deepEqual(result, [{ pattern: 'A', reason: 'first' }]);
});

test('dedupeEntries: enforce arrays union across duplicate patterns', () => {
  const entries = [{ pattern: 'A', enforce: ['hook'] }, { pattern: 'A', enforce: ['codex-only'] }];
  const result = dedupeEntries(entries);
  assert.equal(result.length, 1);
  assert.deepEqual(new Set(result[0].enforce), new Set(['hook', 'codex-only']));
});

test('mergeLayers: unions allow/deny across layers in priority order', () => {
  const core = { allow: [{ pattern: 'A' }], deny: [{ pattern: 'D1' }], defaultMode: 'auto' };
  const personal = { allow: [{ pattern: 'B' }], deny: [{ pattern: 'D2' }], defaultMode: 'auto' };
  const merged = mergeLayers([core, personal]);
  assert.deepEqual(merged.allow.map(e => e.pattern), ['A', 'B']);
  assert.deepEqual(merged.deny.map(e => e.pattern), ['D1', 'D2']);
  assert.equal(merged.defaultMode, 'auto');
});

test('mergeLayers: a later layer wins defaultMode', () => {
  const core = { allow: [], deny: [], defaultMode: 'auto' };
  const personal = { allow: [], deny: [], defaultMode: 'default' };
  const merged = mergeLayers([core, personal]);
  assert.equal(merged.defaultMode, 'default');
});

test('mergeLayers: defaults to "auto" when no layer sets defaultMode', () => {
  const merged = mergeLayers([{ allow: [], deny: [] }]);
  assert.equal(merged.defaultMode, 'auto');
});

test('loadAndMerge: a missing pack layer is treated as empty, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permissions-'));
  const core = path.join(dir, 'core.yaml');
  fs.writeFileSync(core, 'allow:\n  - pattern: "A"\ndeny: []\ndefaultMode: auto\n', 'utf8');
  const missingPack = path.join(dir, 'pack-that-does-not-exist.yaml');

  const merged = loadAndMerge([core, missingPack]);
  assert.deepEqual(merged.allow, [{ pattern: 'A' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
