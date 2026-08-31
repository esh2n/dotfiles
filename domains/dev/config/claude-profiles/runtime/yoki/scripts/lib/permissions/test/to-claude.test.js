'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const { toClaudeSettings, hookEnforcedDeny, convert } = require('../to-claude');
const { loadAndMerge } = require('../parse');

const CORE_YAML = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'core', 'permissions.yaml');
const PERSONAL_YAML = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'personal', 'permissions.yaml');
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '..', '..');

// The two deny entries T8 deliberately added on top of the moved list (see
// personal/permissions.yaml's header comment) — the write side of the
// Read(**/.env*) denies, which the pre-migration settings.personal.json
// never had. Everything else in the new deny list must be exactly the old
// 82 entries; the regression below pins that against git HEAD.
const INTENTIONAL_NEW_DENY_ENTRIES = ['Edit(**/.env)', 'Edit(**/.env.*)'];

function readJsonAtHead(repoRelativePath) {
  const raw = execFileSync('git', ['show', `HEAD:${repoRelativePath}`], { cwd: REPO_ROOT, encoding: 'utf8' });
  return JSON.parse(raw);
}

test('toClaudeSettings: maps entries to their pattern strings only', () => {
  const merged = {
    allow: [{ pattern: 'Bash(git status *)' }],
    deny: [{ pattern: 'Bash(rm -rf /)' }],
    defaultMode: 'auto',
  };
  assert.deepEqual(toClaudeSettings(merged), {
    allow: ['Bash(git status *)'],
    deny: ['Bash(rm -rf /)'],
    defaultMode: 'auto',
  });
});

test('toClaudeSettings: defaults defaultMode to "auto" when unset', () => {
  const result = toClaudeSettings({ allow: [], deny: [] });
  assert.equal(result.defaultMode, 'auto');
});

test('hookEnforcedDeny: only entries with enforce including "hook" are returned', () => {
  const merged = {
    deny: [
      { pattern: 'A', enforce: ['hook'], reason: 'r1' },
      { pattern: 'B' },
      { pattern: 'C', enforce: ['codex-only'] },
    ],
  };
  assert.deepEqual(hookEnforcedDeny(merged), [{ pattern: 'A', reason: 'r1' }]);
});

test('hookEnforcedDeny: reason defaults to empty string when absent', () => {
  const merged = { deny: [{ pattern: 'A', enforce: ['hook'] }] };
  assert.deepEqual(hookEnforcedDeny(merged), [{ pattern: 'A', reason: '' }]);
});

test('convert: core+personal permissions.yaml produce 71 allow / 84 deny entries', () => {
  const result = convert([CORE_YAML, PERSONAL_YAML]);
  assert.equal(result.settings.allow.length, 71);
  assert.equal(result.settings.deny.length, 84);
  assert.equal(result.settings.defaultMode, 'auto');
});

test('convert: exactly 8 deny entries are hook-enforced', () => {
  const result = convert([CORE_YAML, PERSONAL_YAML]);
  assert.equal(result.hookEnforced.length, 8);
  const expected = [
    'Bash(rm -rf /*)',
    'Bash(rm -rf ~/*)',
    'Bash(> /dev/*)',
    'Bash(>> /dev/*)',
    'Edit(**/*.pem)',
    'Edit(**/*.key)',
    'Edit(**/.env)',
    'Edit(**/.env.*)',
  ];
  assert.deepEqual(new Set(result.hookEnforced.map(e => e.pattern)), new Set(expected));
});

// -----------------------------------------------------------------------------
// Regression: to-claude.js must reproduce the moved settings lists exactly.
// Reads core/settings.layer.json's permissions.allow and
// personal/settings.personal.json's permissions.deny at their pre-migration
// git HEAD content (this change removes those keys from the JSON files in
// the same commit range, so `git show HEAD:...` is the only place the
// original lists still exist) and checks nothing was lost or reworded in
// the move to permissions.yaml. The only allowed difference is the two
// intentional new deny entries documented above (T8): every entry from
// git HEAD must survive, and every entry that does NOT come from git HEAD
// must be one of those two.
// -----------------------------------------------------------------------------
test('regression: core allow list is byte-identical to git HEAD settings.layer.json', () => {
  const before = readJsonAtHead('domains/dev/config/claude-profiles/core/settings.layer.json');
  const originalAllow = before.permissions.allow;
  assert.ok(Array.isArray(originalAllow) && originalAllow.length > 0, 'git HEAD settings.layer.json must still carry the pre-migration allow list');

  const merged = loadAndMerge([CORE_YAML, PERSONAL_YAML]);
  const newAllow = toClaudeSettings(merged).allow;

  assert.deepEqual(new Set(newAllow), new Set(originalAllow), 'allow set changed during the move to permissions.yaml');
  assert.equal(newAllow.length, originalAllow.length, 'allow list must not gain or lose entries');
});

test('regression: personal deny list is a superset of git HEAD settings.personal.json, plus exactly the 2 documented additions', () => {
  const before = readJsonAtHead('domains/dev/config/claude-profiles/personal/settings.personal.json');
  const originalDeny = before.permissions.deny;
  assert.ok(Array.isArray(originalDeny) && originalDeny.length > 0, 'git HEAD settings.personal.json must still carry the pre-migration deny list');

  const merged = loadAndMerge([CORE_YAML, PERSONAL_YAML]);
  const newDeny = toClaudeSettings(merged).deny;

  const originalSet = new Set(originalDeny);
  const newSet = new Set(newDeny);

  for (const pattern of originalSet) {
    assert.ok(newSet.has(pattern), `deny entry lost during the move to permissions.yaml: ${pattern}`);
  }

  const added = newDeny.filter(p => !originalSet.has(p));
  assert.deepEqual(new Set(added), new Set(INTENTIONAL_NEW_DENY_ENTRIES), 'unexpected deny entries added or dropped beyond the two documented T8 additions');

  assert.equal(newDeny.length, originalDeny.length + INTENTIONAL_NEW_DENY_ENTRIES.length);
});
