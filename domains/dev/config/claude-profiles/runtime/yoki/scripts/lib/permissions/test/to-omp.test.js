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

// ---------------------------------------------------------------------------
// Precedence. tools.approval is a single name-keyed map, and several distinct
// Claude patterns collapse onto one key (`Read`/`Read(**)` here; downstream
// omp-tool-names.js collapses LS onto `read` and TodoRead/TodoWrite onto
// `todo`). Deny must win — every sibling converter resolves it that way
// (to-codex.js emits "forbidden > prompt > allow", yoki-bridge.ts combines
// "first deny wins"), and an allow silently overwriting a deny would make omp
// the one target where a deny reads as enforced but is not.
// ---------------------------------------------------------------------------

test('convertMerged: deny wins over allow for the same tool key', () => {
  const merged = {
    allow: [{ pattern: 'WebSearch' }, { pattern: 'Read(**)' }, { pattern: 'Task(**)' }],
    deny: [{ pattern: 'WebSearch', reason: 'no net' }, { pattern: 'Read(**)' }],
  };
  const result = convertMerged(merged);
  assert.equal(result.tools.approval.WebSearch, 'deny');
  assert.equal(result.tools.approval.Read, 'deny');
  assert.equal(result.tools.approval.Task, 'allow');
});

test('convertMerged: a bare deny beats a Tool(**) allow and vice versa (both spellings collapse to one key)', () => {
  assert.equal(convertMerged({ allow: [{ pattern: 'WebFetch(**)' }], deny: [{ pattern: 'WebFetch' }] }).tools.approval.WebFetch, 'deny');
  assert.equal(convertMerged({ allow: [{ pattern: 'WebFetch' }], deny: [{ pattern: 'WebFetch(**)' }] }).tools.approval.WebFetch, 'deny');
});

test('convertMerged: an allow-only tool is still allow (deny-wins does not become deny-by-default)', () => {
  assert.deepEqual(convertMerged({ allow: [{ pattern: 'Grep(**)' }], deny: [] }).tools.approval, { Grep: 'allow' });
});
