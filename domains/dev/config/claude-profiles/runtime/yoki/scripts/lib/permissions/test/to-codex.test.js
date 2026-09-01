'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toRules, toFilesystemDenyEntries, toPermissionsToml } = require('../to-codex');

test('toRules: a plain Bash prefix deny becomes a forbidden prefix_rule', () => {
  const merged = { allow: [], deny: [{ pattern: 'Bash(git reset --hard *)', reason: 'no hard reset' }] };
  const { rules, hookEnforced } = toRules(merged);
  assert.match(rules, /prefix_rule\(pattern=\["git", "reset", "--hard"\], decision="forbidden"/);
  assert.deepEqual(hookEnforced, []);
});

test('toRules: a Bash prefix allow becomes an allow prefix_rule', () => {
  const merged = { allow: [{ pattern: 'Bash(git status *)' }], deny: [] };
  const { rules } = toRules(merged);
  assert.match(rules, /prefix_rule\(pattern=\["git", "status"\], decision="allow"\)/);
});

test('toRules: a redirection pattern is not turned into a rule and is reported hook-enforced', () => {
  const merged = { allow: [], deny: [{ pattern: 'Bash(> /dev/*)', reason: 'redirection' }] };
  const { rules, hookEnforced } = toRules(merged);
  assert.ok(!rules.includes('/dev/'));
  assert.deepEqual(hookEnforced, [{ pattern: 'Bash(> /dev/*)', reason: 'redirection' }]);
});

test('toRules: a wildcard glob target (rm -rf /*) is hook-enforced, not a rule', () => {
  const merged = { allow: [], deny: [{ pattern: 'Bash(rm -rf /*)', reason: 'wildcard' }] };
  const { rules, hookEnforced } = toRules(merged);
  assert.ok(!rules.includes('prefix_rule(pattern=["rm", "-rf", "/*"]'));
  assert.equal(hookEnforced.length, 1);
  assert.equal(hookEnforced[0].pattern, 'Bash(rm -rf /*)');
});

test('toRules: a wildcard-first-token allow (* --version) has no execpolicy equivalent and is dropped, not hook-enforced', () => {
  const merged = { allow: [{ pattern: 'Bash(* --version)' }], deny: [] };
  const { rules, hookEnforced } = toRules(merged);
  assert.ok(!rules.includes('--version'));
  assert.deepEqual(hookEnforced, []);
});

test('toRules: non-Bash patterns (Read/Edit/tool-level) contribute no rule', () => {
  const merged = { allow: [{ pattern: 'Read(**)' }], deny: [{ pattern: 'Edit(**/*.pem)', reason: 'secret' }] };
  const { rules } = toRules(merged);
  assert.ok(!rules.includes('Read'));
  assert.ok(!rules.includes('pem'));
});

test('toFilesystemDenyEntries: absolute/~ Read denies become fs entries; workspace-root globs do not', () => {
  const merged = {
    deny: [
      { pattern: 'Read(~/.aws/credentials)' },
      { pattern: 'Read(~/.ssh/id_*)' },
      { pattern: 'Read(**/.env)' }, // workspace-root glob — excluded
      { pattern: 'Bash(rm -rf /)' }, // not a Read pattern — excluded
    ],
  };
  const entries = toFilesystemDenyEntries(merged);
  assert.deepEqual(new Set(entries), new Set(['~/.aws/credentials', '~/.ssh/id_*']));
});

test('toPermissionsToml: extends ":workspace" and lists the fs-deny entries', () => {
  const merged = { deny: [{ pattern: 'Read(~/.aws/credentials)' }] };
  const toml = toPermissionsToml(merged);
  assert.match(toml, /extends = ":workspace"/);
  assert.match(toml, /"~\/\.aws\/credentials" = "deny"/);
});

// ---------------------------------------------------------------------------
// pre-permission-guard.js now reads a trailing '*' as a prefix wildcard. That
// only matters because these patterns have NO execpolicy equivalent, so the
// hook is their only enforcement point on Codex and omp — pin that routing so
// a future execpolicy change cannot quietly move them without notice.
// ---------------------------------------------------------------------------

test('the trailing-glob deny patterns are routed to hookEnforced, never to yoki.rules', () => {
  const merged = {
    allow: [],
    deny: [
      { pattern: 'Bash(rm -rf /*)', enforce: ['hook'], reason: 'wildcard rm' },
      { pattern: 'Bash(rm -rf ~/*)', enforce: ['hook'], reason: 'home wipe' },
      { pattern: 'Bash(> /dev/*)', enforce: ['hook'], reason: 'redirection' },
      { pattern: 'Bash(>> /dev/*)', enforce: ['hook'], reason: 'redirection' },
    ],
  };
  const { rules, hookEnforced } = toRules(merged);
  assert.deepEqual(
    new Set(hookEnforced.map(e => e.pattern)),
    new Set(['Bash(rm -rf /*)', 'Bash(rm -rf ~/*)', 'Bash(> /dev/*)', 'Bash(>> /dev/*)'])
  );
  for (const pattern of ['rm -rf /*', 'rm -rf ~/*', '> /dev/*', '>> /dev/*']) {
    assert.ok(!rules.includes(pattern), `${pattern} must not reach yoki.rules — execpolicy cannot express it`);
  }
});
