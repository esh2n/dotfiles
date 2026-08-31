'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseSemver,
  compareSemver,
  isAtLeast,
  parseHooksStateFromToml,
  parseFeaturesHooks,
  hasPermissionsConflict,
  detectTrustDrift,
  unwrapHooksJson,
  extractHookCommands,
  extractHookScriptRefs,
  checkClaudeTarget,
  checkCodexTarget,
} = require('../doctor');
const { computeHandlerHash } = require('../targets/codex-trust');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function findCheck(results, checkName) {
  return results.find(r => r.check === checkName);
}

// ---------------------------------------------------------------------------
// version parsing
// ---------------------------------------------------------------------------

test('parseSemver extracts x.y.z from real CLI --version output', () => {
  assert.deepEqual(parseSemver('codex-cli 0.147.0'), { major: 0, minor: 147, patch: 0 });
  assert.deepEqual(parseSemver('18.0.4\n'), { major: 18, minor: 0, patch: 4 });
});

test('parseSemver returns null when no version triple is present', () => {
  assert.equal(parseSemver('command not found'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver(undefined), null);
});

test('compareSemver orders by major, then minor, then patch', () => {
  assert.equal(compareSemver('0.147.0', '0.150.0'), -1);
  assert.equal(compareSemver('0.150.0', '0.147.0'), 1);
  assert.equal(compareSemver('0.150.0', '0.150.0'), 0);
  assert.equal(compareSemver('1.0.0', '0.999.999'), 1);
});

test('compareSemver returns null when either side fails to parse', () => {
  assert.equal(compareSemver('not-a-version', '0.150.0'), null);
  assert.equal(compareSemver('0.150.0', ''), null);
});

test('isAtLeast reproduces the codex doctor thresholds (T14 spec: warn < 0.150.0, error < 0.147.0)', () => {
  assert.equal(isAtLeast('0.146.9', '0.147.0'), false); // below the error floor
  assert.equal(isAtLeast('0.147.0', '0.147.0'), true); // exactly the error floor: not an error
  assert.equal(isAtLeast('0.147.0', '0.150.0'), false); // below the warn floor: a warning
  assert.equal(isAtLeast('0.150.0', '0.150.0'), true); // clean
  assert.equal(isAtLeast('unparseable', '0.150.0'), null);
});

test('isAtLeast reproduces the omp doctor threshold (T14 spec: warn < 18.0.4)', () => {
  assert.equal(isAtLeast('17.9.9', '18.0.4'), false);
  assert.equal(isAtLeast('18.0.4', '18.0.4'), true);
  assert.equal(isAtLeast('18.1.0', '18.0.4'), true);
});

// ---------------------------------------------------------------------------
// config.toml reading: features.hooks, permissions conflict, hooks.state
// ---------------------------------------------------------------------------

test('parseFeaturesHooks reads the top-level [features] table only', () => {
  assert.equal(parseFeaturesHooks('[features]\nhooks = true\n'), true);
  assert.equal(parseFeaturesHooks('[features]\nhooks = false\n'), false);
  assert.equal(parseFeaturesHooks('[some.other.table]\nhooks = true\n'), null); // wrong table
  assert.equal(parseFeaturesHooks(''), null);
});

test('hasPermissionsConflict flags default_permissions + sandbox_mode only when BOTH are top-level', () => {
  assert.equal(hasPermissionsConflict('default_permissions = "yoki"\nsandbox_mode = "workspace-write"\n'), true);
  assert.equal(hasPermissionsConflict('default_permissions = "yoki"\n'), false);
  // sandbox_mode declared inside a table (after the first [table] header) is not top-level.
  assert.equal(
    hasPermissionsConflict('default_permissions = "yoki"\n\n[some.table]\nsandbox_mode = "workspace-write"\n'),
    false
  );
});

test('parseHooksStateFromToml reads trusted_hash out of quoted [hooks.state."<key>"] headers', () => {
  const text = [
    '[projects."/repo"]',
    'trust_level = "trusted"',
    '',
    '[hooks.state."/Users/esh2n/.codex/hooks.json:session_start:0:0"]',
    'trusted_hash = "sha256:34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5"',
    'enabled = true',
    '',
    '[hooks.state."/Users/esh2n/.codex/hooks.json:pre_tool_use:1:0"]',
    'trusted_hash = "sha256:deadbeef"',
  ].join('\n');

  const states = parseHooksStateFromToml(text);
  assert.equal(states.size, 2);
  assert.equal(
    states.get('/Users/esh2n/.codex/hooks.json:session_start:0:0'),
    'sha256:34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5'
  );
  assert.equal(states.get('/Users/esh2n/.codex/hooks.json:pre_tool_use:1:0'), 'sha256:deadbeef');
});

test('parseHooksStateFromToml stops attributing hashes once a different table header appears', () => {
  const text = [
    '[hooks.state."k1"]',
    'trusted_hash = "sha256:aaa"',
    '[mcp_servers.foo]',
    'trusted_hash = "sha256:should-not-be-picked-up"', // not really valid there, but proves scoping
  ].join('\n');
  const states = parseHooksStateFromToml(text);
  assert.equal(states.size, 1);
  assert.equal(states.get('k1'), 'sha256:aaa');
});

// ---------------------------------------------------------------------------
// unwrapHooksJson: real Codex hooks.json wraps the event map under "hooks"
// ---------------------------------------------------------------------------

test('unwrapHooksJson unwraps a real on-disk {"hooks": {...}} shape', () => {
  const wrapped = { hooks: { SessionStart: [{ hooks: [{ command: 'x' }] }] } };
  assert.deepEqual(unwrapHooksJson(wrapped), wrapped.hooks);
});

test('unwrapHooksJson passes through a flat {EventName: [...]} shape unchanged', () => {
  const flat = { SessionStart: [{ hooks: [{ command: 'x' }] }] };
  assert.deepEqual(unwrapHooksJson(flat), flat);
});

test('unwrapHooksJson passes null/undefined through', () => {
  assert.equal(unwrapHooksJson(null), null);
  assert.equal(unwrapHooksJson(undefined), undefined);
});

// ---------------------------------------------------------------------------
// trust drift detection (pure)
// ---------------------------------------------------------------------------

function ourHandler(scriptRelPath) {
  return {
    command: `"node" "/yoki/scripts/hooks/run-with-flags.js" "hookId" "${scriptRelPath}" "standard,strict" --harness codex`,
  };
}

test('detectTrustDrift: matching stored hash for every owned entry -> no drift', () => {
  const handler = ourHandler('scripts/hooks/foo.js');
  const hooksJson = { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] };
  const hooksJsonPath = '/Users/esh2n/.codex/hooks.json';
  const expectedHash = computeHandlerHash({ eventLabel: 'pre_tool_use', matcher: 'Bash', handler });
  const storedStates = new Map([[`${hooksJsonPath}:pre_tool_use:0:0`, expectedHash]]);

  const { total, missing, drifted } = detectTrustDrift({ hooksJson, hooksJsonPath, storedStates });
  assert.equal(total, 1);
  assert.deepEqual(missing, []);
  assert.deepEqual(drifted, []);
});

test('detectTrustDrift: stored hash does not match the recomputed one -> drifted', () => {
  const handler = ourHandler('scripts/hooks/foo.js');
  const hooksJson = { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] };
  const hooksJsonPath = '/Users/esh2n/.codex/hooks.json';
  const key = `${hooksJsonPath}:pre_tool_use:0:0`;
  const storedStates = new Map([[key, 'sha256:stale-hash-from-before-an-edit']]);

  const { total, missing, drifted } = detectTrustDrift({ hooksJson, hooksJsonPath, storedStates });
  assert.equal(total, 1);
  assert.deepEqual(missing, []);
  assert.deepEqual(drifted, [key]);
});

test('detectTrustDrift: no [hooks.state] entry at all for an owned handler -> missing', () => {
  const handler = ourHandler('scripts/hooks/foo.js');
  const hooksJson = { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] };
  const hooksJsonPath = '/Users/esh2n/.codex/hooks.json';
  const key = `${hooksJsonPath}:pre_tool_use:0:0`;

  const { total, missing, drifted } = detectTrustDrift({ hooksJson, hooksJsonPath, storedStates: new Map() });
  assert.equal(total, 1);
  assert.deepEqual(missing, [key]);
  assert.deepEqual(drifted, []);
});

test('detectTrustDrift: a foreign (non-yoki) handler is never counted', () => {
  const foreign = { command: "bash '/Users/esh2n/.codex/herdr-agent-state.sh' session", timeout: 10 };
  const hooksJson = { SessionStart: [{ hooks: [foreign] }] };
  const { total } = detectTrustDrift({ hooksJson, hooksJsonPath: '/x', storedStates: new Map() });
  assert.equal(total, 0);
});

// ---------------------------------------------------------------------------
// hook script command extraction (claude target)
// ---------------------------------------------------------------------------

test('extractHookCommands flattens every event/group/handler command', () => {
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'cmd-a' }, { command: 'cmd-b' }] }],
      Stop: [{ matcher: '*', hooks: [{ command: 'cmd-c' }] }],
    },
  };
  assert.deepEqual(extractHookCommands(settings).sort(), ['cmd-a', 'cmd-b', 'cmd-c']);
});

test('extractHookCommands tolerates a missing/malformed hooks key', () => {
  assert.deepEqual(extractHookCommands({}), []);
  assert.deepEqual(extractHookCommands(null), []);
  assert.deepEqual(extractHookCommands({ hooks: 'not-an-object' }), []);
});

test('extractHookScriptRefs finds run-with-flags.js relative script paths and direct ~/.claude/hooks files', () => {
  const commands = [
    '"${YOKI_NODE:-node}" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "post:quality-gate" "scripts/hooks/quality-gate.js" "standard,strict"',
    'bash -c \'h=~/.claude/hooks/git-guard.sh; if bash -n "$h" 2>/dev/null; then exec bash "$h"; fi\'',
    '"${YOKI_NODE:-node}" ~/.claude/hooks/go-guard-post-edit.js',
  ];
  const refs = extractHookScriptRefs(commands);
  assert.equal(refs.usesRunner, true);
  assert.deepEqual(refs.runnerRelPaths, ['scripts/hooks/quality-gate.js']);
  assert.deepEqual(refs.directHookFiles.sort(), ['git-guard.sh', 'go-guard-post-edit.js']);
});

// ---------------------------------------------------------------------------
// integration: checkClaudeTarget against a fully fabricated temp home
// ---------------------------------------------------------------------------

test('checkClaudeTarget: happy-path temp home reports ok for every check', () => {
  const home = makeTmpDir('yoki-doctor-claude-ok-');
  const yokiRoot = makeTmpDir('yoki-doctor-yokiroot-');
  try {
    const claudeDir = path.join(home, '.claude');
    for (const dir of ['skills', 'hooks', 'scripts', 'commands', 'agents', 'rules', 'workflows']) {
      fs.mkdirSync(path.join(claudeDir, dir), { recursive: true });
    }

    writeFile(path.join(yokiRoot, 'scripts', 'hooks', 'run-with-flags.js'), '// runner\n');
    writeFile(path.join(yokiRoot, 'scripts', 'hooks', 'quality-gate.js'), '// hook\n');
    const bashHook = path.join(claudeDir, 'hooks', 'git-guard.sh');
    writeFile(bashHook, '#!/bin/bash\necho ok\n');
    fs.chmodSync(bashHook, 0o755);

    writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write',
              hooks: [
                { command: '"node" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "post:quality-gate" "scripts/hooks/quality-gate.js" "standard"' },
                { command: "bash -c 'h=~/.claude/hooks/git-guard.sh; exec bash \"$h\"'" },
              ],
            },
          ],
        },
      })
    );
    writeFile(path.join(claudeDir, '.yoki', 'permissions.json'), JSON.stringify({ deny: [] }));

    const results = checkClaudeTarget({ claudeDir, yokiRoot });

    assert.equal(findCheck(results, 'symlinks').status, 'ok');
    assert.equal(findCheck(results, 'settings-json').status, 'ok');
    assert.equal(findCheck(results, 'hooks-scripts').status, 'ok');
    assert.equal(findCheck(results, 'permissions-json').status, 'ok');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(yokiRoot, { recursive: true, force: true });
  }
});

test('checkClaudeTarget: missing hook script -> fail; broken merge symlink -> fail; missing permissions.json -> fail', () => {
  const home = makeTmpDir('yoki-doctor-claude-bad-');
  const yokiRoot = makeTmpDir('yoki-doctor-yokiroot-bad-');
  try {
    const claudeDir = path.join(home, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // A broken symlink for one merge dir, real dirs for the rest.
    for (const dir of ['hooks', 'scripts', 'commands', 'agents', 'rules', 'workflows']) {
      fs.mkdirSync(path.join(claudeDir, dir), { recursive: true });
    }
    fs.symlinkSync(path.join(claudeDir, '.skills-merged-does-not-exist'), path.join(claudeDir, 'skills'));

    writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write',
              hooks: [{ command: '"node" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "post:x" "scripts/hooks/missing.js" "standard"' }],
            },
          ],
        },
      })
    );
    // permissions.json intentionally not written.

    const results = checkClaudeTarget({ claudeDir, yokiRoot });

    assert.equal(findCheck(results, 'symlinks').status, 'fail');
    assert.equal(findCheck(results, 'hooks-scripts').status, 'fail');
    assert.equal(findCheck(results, 'permissions-json').status, 'fail');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(yokiRoot, { recursive: true, force: true });
  }
});

test('checkClaudeTarget: settings.json with invalid JSON reports a fail, not a throw', () => {
  const home = makeTmpDir('yoki-doctor-claude-badjson-');
  try {
    const claudeDir = path.join(home, '.claude');
    writeFile(path.join(claudeDir, 'settings.json'), '{ not valid json');
    const results = checkClaudeTarget({ claudeDir, yokiRoot: home });
    assert.equal(findCheck(results, 'settings-json').status, 'fail');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// integration: checkCodexTarget's non-spawning checks against a temp codexDir
// ---------------------------------------------------------------------------
//
// checkCodexVersion/checkCodexExecpolicy shell out to a real `codex` binary,
// so this only asserts on the checks that don't (trust-drift, features-hooks,
// permissions-conflict, hooks-groups) — those must hold regardless of
// whether `codex` is on the test machine's PATH.

test('checkCodexTarget: trust-drift/features-hooks/permissions-conflict against a fabricated ~/.codex', () => {
  const home = makeTmpDir('yoki-doctor-codex-home-');
  const codexDir = path.join(home, '.codex');
  const dotfilesRoot = makeTmpDir('yoki-doctor-codex-dotfiles-');
  try {
    fs.mkdirSync(codexDir, { recursive: true });

    const handler = ourHandler('scripts/hooks/foo.js');
    const hooksJsonPath = path.join(codexDir, 'hooks.json');
    // Real on-disk shape: wrapped under a top-level "hooks" key.
    writeFile(hooksJsonPath, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] } }));

    const goodHash = computeHandlerHash({ eventLabel: 'pre_tool_use', matcher: 'Bash', handler });
    const key = `${hooksJsonPath}:pre_tool_use:0:0`;

    writeFile(
      path.join(codexDir, 'config.toml'),
      [
        'default_permissions = "yoki"',
        'sandbox_mode = "workspace-write"', // deliberate conflict for this fixture
        '',
        '[features]',
        'hooks = true',
        '',
        `[hooks.state."${key}"]`,
        `trusted_hash = "${goodHash}"`,
      ].join('\n')
    );

    const results = checkCodexTarget({ codexDir, home, dotfilesRoot });

    assert.equal(findCheck(results, 'features-hooks').status, 'ok');
    assert.equal(findCheck(results, 'hooks-groups').status, 'ok');
    assert.equal(findCheck(results, 'trust-drift').status, 'ok');
    assert.equal(findCheck(results, 'permissions-conflict').status, 'fail');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dotfilesRoot, { recursive: true, force: true });
  }
});

test('checkCodexTarget: trust-drift fails when config.toml\'s stored hash is stale', () => {
  const home = makeTmpDir('yoki-doctor-codex-home2-');
  const codexDir = path.join(home, '.codex');
  const dotfilesRoot = makeTmpDir('yoki-doctor-codex-dotfiles2-');
  try {
    fs.mkdirSync(codexDir, { recursive: true });

    const handler = ourHandler('scripts/hooks/foo.js');
    const hooksJsonPath = path.join(codexDir, 'hooks.json');
    writeFile(hooksJsonPath, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [handler] }] } }));
    const key = `${hooksJsonPath}:pre_tool_use:0:0`;

    writeFile(
      path.join(codexDir, 'config.toml'),
      ['[features]', 'hooks = true', '', `[hooks.state."${key}"]`, 'trusted_hash = "sha256:stale-from-before-an-edit"'].join('\n')
    );

    const results = checkCodexTarget({ codexDir, home, dotfilesRoot });

    const drift = findCheck(results, 'trust-drift');
    assert.equal(drift.status, 'fail');
    assert.match(drift.hint, /silently skipped by codex exec/);
    assert.equal(findCheck(results, 'permissions-conflict').status, 'ok');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dotfilesRoot, { recursive: true, force: true });
  }
});

test('checkCodexTarget: ~/.codex missing entirely -> a single warn, no throw', () => {
  const home = makeTmpDir('yoki-doctor-codex-missing-');
  try {
    const results = checkCodexTarget({ codexDir: path.join(home, '.codex'), home, dotfilesRoot: home });
    assert.equal(findCheck(results, 'home').status, 'warn');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
