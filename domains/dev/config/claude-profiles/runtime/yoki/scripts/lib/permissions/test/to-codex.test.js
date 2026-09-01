'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toRules, toFilesystemDenyEntries, toFilesystemReadDeny, toPermissionsToml, toUnexpressibleDeny, convert } = require('../to-codex');

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

// ---------------------------------------------------------------------------
// toUnexpressibleDeny: the denies NEITHER yoki.rules NOR
// [permissions.yoki.filesystem] carries. Codex's filesystem table is built
// from Read(...) patterns only, so every Edit(...) row had no expression at
// all unless permissions.yaml happened to tag it `enforce: [hook]` — the four
// *.pem/*.key/.env rows did, the other seventeen did not. Those are what
// lib/targets/codex.js hands pre-permission-guard.js.
// ---------------------------------------------------------------------------

test('toUnexpressibleDeny: an Edit(...) deny has no Codex expression and is reported', () => {
  const merged = {
    deny: [
      { pattern: 'Edit(/etc/**)' },
      { pattern: 'Edit(~/.ssh/id_*)', reason: 'private keys' },
    ],
  };
  assert.deepEqual(toUnexpressibleDeny(merged), [
    { pattern: 'Edit(/etc/**)', reason: '' },
    { pattern: 'Edit(~/.ssh/id_*)', reason: 'private keys' },
  ]);
});

test('toUnexpressibleDeny: a Read deny already in the filesystem table is NOT repeated', () => {
  const merged = { deny: [{ pattern: 'Read(~/.aws/credentials)' }] };
  assert.deepEqual(toFilesystemDenyEntries(merged), ['~/.aws/credentials']);
  assert.deepEqual(toUnexpressibleDeny(merged), []);
});

test('toUnexpressibleDeny: a Read(**…) workspace glob IS reported (the fs table skips it)', () => {
  const merged = { deny: [{ pattern: 'Read(**/.env)' }] };
  assert.deepEqual(toFilesystemDenyEntries(merged), []);
  assert.deepEqual(toUnexpressibleDeny(merged), [{ pattern: 'Read(**/.env)', reason: '' }]);
});

test('toUnexpressibleDeny: Bash denies are left to toRules, which reports its own', () => {
  const merged = { deny: [{ pattern: 'Bash(rm -rf /)' }, { pattern: 'Bash(rm -rf /*)' }] };
  assert.deepEqual(toUnexpressibleDeny(merged), []);
});

// ---------------------------------------------------------------------------
// Secret-read denies are carried by BOTH Codex layers (defense in depth): the
// declarative [permissions.yoki.filesystem] table AND the guard deny list.
// The table is off under --dangerously-bypass-approvals-and-sandbox and never
// gated a shell `cat` (codex has no read tool — reads shell out as Bash),
// while hook denies still fire in bypass mode, so the hook must know them too.
// ---------------------------------------------------------------------------

test('toFilesystemReadDeny: returns the ~-rooted Read denies with their reasons', () => {
  const merged = {
    allow: [],
    deny: [
      { pattern: 'Read(~/.ssh/id_*)', reason: 'private keys' },
      { pattern: 'Read(~/.aws/credentials)', reason: 'cloud creds' },
    ],
  };
  assert.deepEqual(toFilesystemReadDeny(merged), [
    { pattern: 'Read(~/.ssh/id_*)', reason: 'private keys' },
    { pattern: 'Read(~/.aws/credentials)', reason: 'cloud creds' },
  ]);
});

test('toFilesystemReadDeny: a workspace **-glob Read is excluded (not a filesystem-table row)', () => {
  const merged = { allow: [], deny: [{ pattern: 'Read(**/.env)', reason: 'env' }] };
  assert.deepEqual(toFilesystemReadDeny(merged), []);
});

test('convert: a ~-rooted Read deny reaches guardDeny AND stays in the filesystem table', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-to-codex-'));
  const layer = path.join(dir, 'permissions.yaml');
  fs.writeFileSync(layer, [
    'allow: []',
    'deny:',
    '  - pattern: "Read(~/.ssh/id_*)"',
    '    reason: "private keys"',
    '  - pattern: "Read(**/.env)"',
    '    reason: "env files"',
    '',
  ].join('\n'), 'utf8');

  const out = convert([layer]);
  const patterns = out.guardDeny.map(e => e.pattern);

  // Layer 1: the hook now enforces it too (the layer that survives bypass).
  assert.ok(patterns.includes('Read(~/.ssh/id_*)'), `guardDeny=${JSON.stringify(patterns)}`);
  assert.equal(out.guardDeny.find(e => e.pattern === 'Read(~/.ssh/id_*)').reason, 'private keys');
  // The workspace glob is still there (it always was).
  assert.ok(patterns.includes('Read(**/.env)'));

  // Layer 2: NOT moved — the declarative filesystem table still carries it.
  assert.match(out.permissions, /"~\/\.ssh\/id_\*" = "deny"/);
  // ...and the workspace glob still is not a filesystem-table row.
  assert.ok(!out.permissions.includes('**/.env'));
});
