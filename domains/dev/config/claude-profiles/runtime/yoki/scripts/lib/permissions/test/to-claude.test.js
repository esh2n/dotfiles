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
// 82 entries; the regression below pins that against the pre-migration copy.
const INTENTIONAL_NEW_DENY_ENTRIES = ['Edit(**/.env)', 'Edit(**/.env.*)'];

/**
 * The pre-migration copy of a settings file: the NEWEST commit touching it
 * that still carries a `permissions` key.
 *
 * `git show HEAD:<path>` was the original implementation, which only worked
 * while HEAD was still the migration commit itself — once anything landed on
 * top, HEAD no longer had the moved lists and both regressions below failed
 * with "Cannot read properties of undefined". Walking the file's own history
 * for the last commit that still had the key keeps the regression pinned to
 * the content it was written to guard, at any HEAD.
 *
 * @returns {object|null} null when no such commit is reachable (a shallow
 *   clone, or the file's history was rewritten) — the caller skips rather
 *   than failing, since there is then nothing to compare against.
 */
function readJsonBeforeMigration(repoRelativePath) {
  let revisions;
  try {
    revisions = execFileSync('git', ['log', '--format=%H', '--', repoRelativePath], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }

  for (const revision of revisions) {
    let parsed;
    try {
      parsed = JSON.parse(execFileSync('git', ['show', `${revision}:${repoRelativePath}`], { cwd: REPO_ROOT, encoding: 'utf8' }));
    } catch {
      continue;
    }
    if (parsed && parsed.permissions) return parsed;
  }
  return null;
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
// content (the migration removed those keys from the JSON files, so git
// history is the only place the original lists still exist — see
// readJsonBeforeMigration) and checks nothing was lost or reworded in the
// move to permissions.yaml. The only allowed difference is the two
// intentional new deny entries documented above (T8): every pre-migration
// entry must survive, and every entry that is NOT pre-migration must be one
// of those two.
// -----------------------------------------------------------------------------
test('regression: core allow list is byte-identical to the pre-migration settings.layer.json', (t) => {
  const before = readJsonBeforeMigration('domains/dev/config/claude-profiles/core/settings.layer.json');
  if (!before) return t.skip('no reachable commit still carries settings.layer.json permissions (shallow clone?)');
  const originalAllow = before.permissions.allow;
  assert.ok(Array.isArray(originalAllow) && originalAllow.length > 0, 'the pre-migration settings.layer.json must still carry the allow list');

  const merged = loadAndMerge([CORE_YAML, PERSONAL_YAML]);
  const newAllow = toClaudeSettings(merged).allow;

  assert.deepEqual(new Set(newAllow), new Set(originalAllow), 'allow set changed during the move to permissions.yaml');
  assert.equal(newAllow.length, originalAllow.length, 'allow list must not gain or lose entries');
});

test('regression: personal deny list is a superset of the pre-migration settings.personal.json, plus exactly the 2 documented additions', (t) => {
  const before = readJsonBeforeMigration('domains/dev/config/claude-profiles/personal/settings.personal.json');
  if (!before) return t.skip('no reachable commit still carries settings.personal.json permissions (shallow clone?)');
  const originalDeny = before.permissions.deny;
  assert.ok(Array.isArray(originalDeny) && originalDeny.length > 0, 'the pre-migration settings.personal.json must still carry the deny list');

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
