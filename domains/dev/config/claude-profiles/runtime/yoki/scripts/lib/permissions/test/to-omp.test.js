'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { convertMerged } = require('../to-omp');

test('convertMerged: Bash patterns become bash.patterns entries with action', () => {
  const merged = {
    allow: [{ pattern: 'Bash(git status *)' }],
    deny: [{ pattern: 'Bash(rm -rf /)', reason: 'catastrophic' }],
  };
  const result = convertMerged(merged);
  assert.deepEqual(result.bash.patterns, [
    { pattern: 'rm -rf /', action: 'deny', reason: 'catastrophic' },
    { pattern: 'git status *', action: 'allow', reason: '' },
  ]);
});

test('convertMerged: tool-only patterns (Read(**), bare WebSearch) become tools.approval entries', () => {
  const merged = {
    allow: [{ pattern: 'Read(**)' }, { pattern: 'WebSearch' }],
    deny: [],
  };
  const result = convertMerged(merged);
  assert.deepEqual(result.tools.approval, { Read: 'allow', WebSearch: 'allow' });
});

test('convertMerged: path-glob Edit/Read entries are neither bash.patterns nor tools.approval — they are unexpressible', () => {
  const merged = {
    allow: [],
    deny: [{ pattern: 'Edit(**/*.pem)', reason: 'secret' }, { pattern: 'Read(~/.ssh/id_*)' }],
  };
  const result = convertMerged(merged);
  assert.deepEqual(result.bash.patterns, []);
  assert.deepEqual(result.tools.approval, {});
  assert.equal(result.unexpressible.length, 2);
  assert.deepEqual(
    new Set(result.unexpressible.map(e => e.pattern)),
    new Set(['Edit(**/*.pem)', 'Read(~/.ssh/id_*)']),
  );
  for (const entry of result.unexpressible) {
    assert.equal(entry.action, 'deny');
    assert.match(entry.reason, /tool_call extension/);
  }
});

test('convertMerged: an entry with no pattern text at all (WebFetch(domain:*)) is unexpressible, not silently dropped', () => {
  const merged = { allow: [{ pattern: 'WebFetch(domain:*)' }], deny: [] };
  const result = convertMerged(merged);
  assert.equal(result.unexpressible.length, 1);
  assert.equal(result.unexpressible[0].pattern, 'WebFetch(domain:*)');
});
