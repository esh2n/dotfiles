'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildGeneratedGroups,
  mergeHooksJson,
  collectHookStateEntries,
  translateMatcher,
  isWrappedHooksJson,
  expandCommandPaths,
  UNEXPANDED_PATH_VAR_RE,
} = require('../codex-hooks-merge');
const {
  buildManagedBlockContent,
  applyManagedBlock,
  hasConflictingTopLevelKey,
  mergeOwnedTables,
  validateCodexConfigToml,
  assertValidCodexConfigToml,
} = require('../codex-config-toml');
const { readTables, splitSections, joinSections } = require('../codex-toml-lite');
const { agentMarkdownToToml } = require('../codex-agents');
const { hasPathsFrontmatter, buildAgentsMdBlockContent, applyAgentsMdBlock, substituteVocab } = require('../codex-agents-md');
const { decideSkillSymlink, commandToSkill, commandNameFromRelPath } = require('../codex-skills');
const codexTarget = require('../codex');
const gen = require('../gen');

// ---------------------------------------------------------------------------
// (1) hooks.json merge — foreign group preservation
// ---------------------------------------------------------------------------

const RUNNER_HOOK = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: '"${YOKI_NODE:-node}" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "pre:x" "hooks/x.js" "standard,strict"' }],
};

// The personal layer's real shape (see personal/settings.personal.json).
const WRAPPER_BASH_HOOK = {
  matcher: 'Bash',
  hooks: [{
    type: 'command',
    command: "bash -c 'h=~/.claude/hooks/git-guard.sh; if bash -n \"$h\" 2>/dev/null; then exec bash \"$h\"; fi; echo \"[hook] syntax check failed: git-guard.sh - failing open\" >&2'",
  }],
};

// Not a runner call and not the wrapper shape either — must be reported as
// skipped, never silently dropped.
const UNRECOGNIZED_HOOK = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: "osascript -e 'display notification \"hi\"'" }],
};

test('buildGeneratedGroups: a run-with-flags.js hook becomes a Codex group with --harness codex appended', () => {
  const { generated, warnings } = buildGeneratedGroups([{ hooks: { PreToolUse: [RUNNER_HOOK] } }]);
  assert.equal(generated.PreToolUse.length, 1);
  assert.match(generated.PreToolUse[0].hooks[0].command, / --harness codex$/);
  assert.equal(warnings.length, 0);
});

test('buildGeneratedGroups: a personal bash-wrapper guard is translated through run-bash-hook.js, not dropped', () => {
  const { generated, warnings, skipped } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }],
    { yokiRoot: '/opt/yoki', home: '/home/exampleperson' }
  );
  assert.equal(generated.PreToolUse.length, 1);
  assert.equal(
    generated.PreToolUse[0].hooks[0].command,
    '"${YOKI_NODE:-node}" "/opt/yoki/scripts/hooks/run-bash-hook.js" --harness codex "/home/exampleperson/.claude/hooks/git-guard.sh"'
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(skipped, []);
});

test('buildGeneratedGroups: a translated wrapper guard is recognized as ours (trust entry + regenerable group)', () => {
  const { generated } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }],
    { yokiRoot: '/opt/yoki', home: '/home/exampleperson' }
  );
  const merged = mergeHooksJson({}, generated);
  const entries = collectHookStateEntries(merged, '/home/exampleperson/.codex/hooks.json');
  assert.equal(entries.length, 1, 'a translated guard must get a [hooks.state] trust entry like any other yoki hook');
});

test('buildGeneratedGroups: wrapper args are carried through to run-bash-hook.js', () => {
  const withArgs = {
    matcher: 'Bash',
    hooks: [{
      type: 'command',
      command: "bash -c 'h=~/.claude/hooks/herdr-agent-state.sh; if bash -n \"$h\" 2>/dev/null; then exec bash \"$h\" session; fi; echo \"nope\" >&2'",
    }],
  };
  const { generated } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [withArgs] } }],
    { yokiRoot: '/opt/yoki', home: '/home/exampleperson' }
  );
  assert.match(generated.PreToolUse[0].hooks[0].command, /run-bash-hook\.js" --harness codex "\/home\/exampleperson\/\.claude\/hooks\/herdr-agent-state\.sh" "session"$/);
});

test('buildGeneratedGroups: an unrecognized command is reported as skipped with a reason, never silently dropped', () => {
  const { generated, warnings, skipped } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [UNRECOGNIZED_HOOK] } }],
    { yokiRoot: '/opt/yoki', home: '/home/exampleperson' }
  );
  assert.equal(generated.PreToolUse, undefined);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].target, 'codex');
  assert.equal(skipped[0].event, 'PreToolUse');
  assert.match(skipped[0].command, /osascript/);
  assert.match(skipped[0].reason, /not portable/);
  assert.equal(warnings.length, 1);
});

test('buildGeneratedGroups: a wrapper guard with no yokiRoot is skipped (reported), not shipped broken', () => {
  const { generated, skipped } = buildGeneratedGroups([{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }], { home: '/home/exampleperson' });
  assert.equal(generated.PreToolUse, undefined);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /YOKI_ROOT/);
});

test('buildGeneratedGroups: Workflow matcher has no Codex equivalent and is skipped with a warning', () => {
  const { generated, warnings } = buildGeneratedGroups([{ hooks: { PreToolUse: [{ matcher: 'Workflow', hooks: [RUNNER_HOOK.hooks[0]] }] } }]);
  assert.equal(generated.PreToolUse, undefined);
  assert.ok(warnings.some(w => /Workflow/.test(w)));
});

// ---------------------------------------------------------------------------
// (1b) path roots are baked in at generation time
// ---------------------------------------------------------------------------
//
// Codex does NOT give a hook process the `[shell_environment_policy.set]`
// environment — that block configures the shell tool. A command carrying
// `"${YOKI_ROOT}/scripts/hooks/run-with-flags.js"` therefore ran with
// YOKI_ROOT unset and died with
// `Cannot find module '/scripts/hooks/run-with-flags.js'`, on 18 of the
// generated hooks, invisibly. Only the bash guards worked, because their
// `~/` had already been resolved to an absolute path.

const GEN_OPTIONS = { yokiRoot: '/opt/yoki', pluginRoot: '/opt/plugins', home: '/home/exampleperson' };

test('buildGeneratedGroups: ${YOKI_ROOT} is expanded to an absolute path', () => {
  const { generated } = buildGeneratedGroups([{ hooks: { PreToolUse: [RUNNER_HOOK] } }], GEN_OPTIONS);
  const command = generated.PreToolUse[0].hooks[0].command;
  assert.ok(command.includes('"/opt/yoki/scripts/hooks/run-with-flags.js"'));
  assert.ok(!command.includes('${YOKI_ROOT}'));
});

test('buildGeneratedGroups: ${YOKI_NODE:-node} is left alone — it carries its own default', () => {
  const { generated } = buildGeneratedGroups([{ hooks: { PreToolUse: [RUNNER_HOOK] } }], GEN_OPTIONS);
  assert.ok(generated.PreToolUse[0].hooks[0].command.startsWith('"${YOKI_NODE:-node}"'));
});

test('buildGeneratedGroups: ${CLAUDE_PLUGIN_ROOT} and ~/.claude/ are expanded too', () => {
  const hook = {
    matcher: 'Bash',
    hooks: [{
      type: 'command',
      command: '"${YOKI_NODE:-node}" "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js" "pre:x" "~/.claude/hooks/x.js" "standard"',
    }],
  };
  const { generated } = buildGeneratedGroups([{ hooks: { PreToolUse: [hook] } }], GEN_OPTIONS);
  const command = generated.PreToolUse[0].hooks[0].command;
  assert.ok(command.includes('"/opt/plugins/scripts/hooks/run-with-flags.js"'));
  assert.ok(command.includes('"/home/exampleperson/.claude/hooks/x.js"'));
});

test('buildGeneratedGroups: no generated command carries an unexpanded path root', () => {
  const layers = [{
    hooks: {
      PreToolUse: [RUNNER_HOOK, WRAPPER_BASH_HOOK],
      SessionStart: [RUNNER_HOOK],
    },
  }];
  const { generated } = buildGeneratedGroups(layers, GEN_OPTIONS);
  const commands = Object.values(generated).flatMap(groups => groups.flatMap(g => g.hooks.map(h => h.command)));
  assert.ok(commands.length >= 3);
  for (const command of commands) {
    assert.equal(UNEXPANDED_PATH_VAR_RE.test(command), false, `unexpanded path root in: ${command}`);
  }
});

test('expandCommandPaths: leaves a command alone when no root is known', () => {
  assert.equal(expandCommandPaths('"${YOKI_ROOT}/x.js"', {}), '"${YOKI_ROOT}/x.js"');
});

test('translateMatcher: Edit|Write|MultiEdit in any order maps to Write|Edit|apply_patch', () => {
  assert.equal(translateMatcher('Write|Edit|MultiEdit'), 'Write|Edit|apply_patch');
  assert.equal(translateMatcher('Edit|Write|MultiEdit'), 'Write|Edit|apply_patch');
  assert.equal(translateMatcher('Bash'), 'Bash');
  assert.equal(translateMatcher('mcp__.*'), 'mcp__.*');
  assert.equal(translateMatcher('WebFetch|WebSearch'), 'WebFetch|WebSearch'); // pass-through, no rule for it
});

// --- hooks.json SHAPE ------------------------------------------------------
// Codex reads ONLY `{"hooks": {<Event>: [...]}}` — the real ~/.codex/hooks.json
// (whose herdr group Codex itself trusted, see codex-trust.test.js) has exactly
// that structure. A flat top-level event map parses but fires nothing, which is
// the silent-skip failure the whole trust-hash mechanism exists to prevent.

test('mergeHooksJson: output is the wrapped {"hooks": {...}} shape Codex actually reads', () => {
  const generated = { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node run-with-flags.js x --harness codex' }] }] };
  const merged = mergeHooksJson({}, generated);

  assert.equal(typeof merged.hooks, 'object');
  assert.equal(merged.SessionStart, undefined, 'events must NOT sit at the top level');
  assert.equal(merged.hooks.SessionStart.length, 1);
  assert.ok(isWrappedHooksJson(merged));
});

test('mergeHooksJson: an existing WRAPPED file is merged in place (foreign group kept, ours appended)', () => {
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: "bash '/Users/exampleperson/.codex/herdr-agent-state.sh' session" }] };
  const existing = { hooks: { SessionStart: [herdrGroup] } };
  const generated = { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node run-with-flags.js x y z --harness codex' }] }] };

  const merged = mergeHooksJson(existing, generated);
  assert.equal(merged.hooks.SessionStart.length, 2);
  assert.deepEqual(merged.hooks.SessionStart[0], herdrGroup); // untouched, still first
  assert.match(merged.hooks.SessionStart[1].hooks[0].command, /--harness codex/);
});

test('mergeHooksJson: a pre-wrap FLAT file on disk migrates to wrapped without duplicating anything', () => {
  // What yoki itself wrote before the shape was fixed: the first apply after
  // the fix must read it, keep the foreign group, replace our own, and write
  // the wrapped shape — not stack a second copy under `hooks`.
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: 'bash herdr.sh' }] };
  const ourOldGroup = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js old --harness codex' }] };
  const existingFlat = { PreToolUse: [herdrGroup, ourOldGroup] };
  const generated = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js new --harness codex' }] }] };

  const merged = mergeHooksJson(existingFlat, generated);
  assert.ok(isWrappedHooksJson(merged));
  assert.equal(merged.PreToolUse, undefined);
  assert.equal(merged.hooks.PreToolUse.length, 2);
  assert.deepEqual(merged.hooks.PreToolUse[0], herdrGroup);
  assert.match(merged.hooks.PreToolUse[1].hooks[0].command, /new/);
});

test('mergeHooksJson: re-running drops our OWN previous group instead of duplicating it', () => {
  const ourOldGroup = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js old --harness codex' }] };
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: 'bash herdr.sh' }] };
  const existing = { hooks: { PreToolUse: [herdrGroup, ourOldGroup] } };
  const generated = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js new --harness codex' }] }] };

  const merged = mergeHooksJson(existing, generated);
  assert.equal(merged.hooks.PreToolUse.length, 2);
  assert.deepEqual(merged.hooks.PreToolUse[0], herdrGroup);
  assert.match(merged.hooks.PreToolUse[1].hooks[0].command, /new/);
});

test('mergeHooksJson: a foreign TOP-LEVEL key of a wrapped file is preserved, like a foreign group', () => {
  const existing = { hooks: {}, someFutureCodexKey: { keep: 'me' } };
  const merged = mergeHooksJson(existing, {});
  assert.deepEqual(merged.someFutureCodexKey, { keep: 'me' });
});

test('collectHookStateEntries: indices are read off the FINAL merged (wrapped) hooks.json, so a foreign group ahead of ours shifts our index', () => {
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: 'bash herdr.sh' }] };
  const ours = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js x --harness codex' }] };
  const merged = mergeHooksJson({ hooks: { PreToolUse: [herdrGroup] } }, { PreToolUse: [ours] });

  const entries = collectHookStateEntries(merged, '/Users/exampleperson/.codex/hooks.json');
  assert.equal(entries.length, 1);
  // Key format is unchanged by the wrap: <abs hooks.json>:<snake_event>:<group>:<handler>
  assert.equal(entries[0].key, '/Users/exampleperson/.codex/hooks.json:pre_tool_use:1:0'); // group index 1, not 0
  assert.match(entries[0].trustedHash, /^sha256:[0-9a-f]{64}$/);
});

test('collectHookStateEntries: the wrapped and flat forms of the same content produce identical keys and hashes', () => {
  const ours = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js x --harness codex', timeout: 5 }] };
  const flat = { PreToolUse: [ours] };
  const wrapped = { hooks: flat };
  assert.deepEqual(
    collectHookStateEntries(wrapped, '/Users/exampleperson/.codex/hooks.json'),
    collectHookStateEntries(flat, '/Users/exampleperson/.codex/hooks.json')
  );
});

// ---------------------------------------------------------------------------
// (1b) codex --version gate (T32): Interrupt (Codex >= 0.150.0) is a known
// event, but only emitted when the installed CLI actually supports it.
// ---------------------------------------------------------------------------

const INTERRUPT_HOOK = {
  matcher: '*',
  hooks: [{ type: 'command', command: '"${YOKI_NODE:-node}" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "pre:interrupt" "hooks/interrupt.js" "standard,strict"' }],
};

test('buildGeneratedGroups: Interrupt is a known hook event, translated like any other', () => {
  const { generated, warnings } = buildGeneratedGroups([{ hooks: { Interrupt: [INTERRUPT_HOOK] } }]);
  assert.equal(generated.Interrupt.length, 1);
  assert.match(generated.Interrupt[0].hooks[0].command, / --harness codex$/);
  assert.ok(!warnings.some(w => /no known Codex equivalent/.test(w)));
});

test('parseCodexVersion: extracts the first x.y.z triple from arbitrary output, null when absent', () => {
  assert.equal(codexTarget.parseCodexVersion('codex-cli 0.150.0'), '0.150.0');
  assert.equal(codexTarget.parseCodexVersion('nonsense'), null);
  assert.equal(codexTarget.parseCodexVersion(''), null);
});

test('compareVersions: -1/0/1, null on anything unparseable', () => {
  assert.equal(codexTarget.compareVersions('0.147.0', '0.150.0'), -1);
  assert.equal(codexTarget.compareVersions('0.150.0', '0.147.0'), 1);
  assert.equal(codexTarget.compareVersions('0.150.0', '0.150.0'), 0);
  assert.equal(codexTarget.compareVersions('not-a-version', '0.150.0'), null);
});

test('isEventSupportedByVersion: Interrupt requires >= 0.150.0; an unknown version is treated conservatively; ungated events are always supported', () => {
  assert.equal(codexTarget.isEventSupportedByVersion('Interrupt', '0.149.9'), false);
  assert.equal(codexTarget.isEventSupportedByVersion('Interrupt', '0.150.0'), true);
  assert.equal(codexTarget.isEventSupportedByVersion('Interrupt', '0.150.1'), true);
  assert.equal(codexTarget.isEventSupportedByVersion('Interrupt', null), false);
  assert.equal(codexTarget.isEventSupportedByVersion('Stop', null), true);
});

test('filterVersionGatedEvents: strips Interrupt below the floor with a warning naming the brew upgrade command, leaves other events and the input untouched', () => {
  const layers = [{ hooks: { Interrupt: [INTERRUPT_HOOK], PreToolUse: [RUNNER_HOOK] } }];
  const { settingsLayers, warnings } = codexTarget.filterVersionGatedEvents(layers, '0.147.0');

  assert.equal(settingsLayers[0].hooks.Interrupt, undefined);
  assert.deepEqual(settingsLayers[0].hooks.PreToolUse, [RUNNER_HOOK]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"Interrupt" hook requires codex >= 0\.150\.0 \(installed: 0\.147\.0\)/);
  assert.match(warnings[0], /brew upgrade --cask codex/);
  assert.ok(layers[0].hooks.Interrupt, 'input layer must not be mutated');
});

test('filterVersionGatedEvents: an unknown installed version reports "installed: unknown"', () => {
  const { warnings } = codexTarget.filterVersionGatedEvents([{ hooks: { Interrupt: [INTERRUPT_HOOK] } }], null);
  assert.match(warnings[0], /installed: unknown/);
});

test('filterVersionGatedEvents: keeps Interrupt at/above the floor, no warning', () => {
  const layers = [{ hooks: { Interrupt: [INTERRUPT_HOOK] } }];
  const { settingsLayers, warnings } = codexTarget.filterVersionGatedEvents(layers, '0.150.0');
  assert.deepEqual(settingsLayers[0].hooks.Interrupt, [INTERRUPT_HOOK]);
  assert.equal(warnings.length, 0);
});

test('plan(): an installed codexVersion below 0.150.0 drops Interrupt from hooks.json and warns; codexVersion is cached on the plan', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const settingsPath = path.join(core, 'settings.layer.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, hooks: { ...settings.hooks, Interrupt: [INTERRUPT_HOOK] } }));

    const belowPlan = codexTarget.plan({ sources: [core, personal], out, home, env: {}, codexVersion: '0.147.0' });
    assert.equal(belowPlan.codexVersion, '0.147.0');
    assert.ok(belowPlan.warnings.some(w => /"Interrupt" hook requires codex >= 0\.150\.0/.test(w)));

    gen.apply(belowPlan);
    const hooksJsonBelow = JSON.parse(fs.readFileSync(path.join(out, 'hooks.json'), 'utf8'));
    assert.equal(hooksJsonBelow.hooks.Interrupt, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plan(): an installed codexVersion at/above 0.150.0 emits Interrupt into hooks.json', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const settingsPath = path.join(core, 'settings.layer.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, hooks: { ...settings.hooks, Interrupt: [INTERRUPT_HOOK] } }));

    const abovePlan = codexTarget.plan({ sources: [core, personal], out, home, env: {}, codexVersion: '0.150.0' });
    assert.equal(abovePlan.codexVersion, '0.150.0');
    assert.ok(!abovePlan.warnings.some(w => /"Interrupt" hook requires codex/.test(w)));

    gen.apply(abovePlan);
    const hooksJsonAbove = JSON.parse(fs.readFileSync(path.join(out, 'hooks.json'), 'utf8'));
    assert.equal(hooksJsonAbove.hooks.Interrupt.length, 1);
    assert.match(hooksJsonAbove.hooks.Interrupt[0].hooks[0].command, /--harness codex/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plan(): an unresolvable installed version (codexVersion: null) is treated conservatively and drops Interrupt', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const settingsPath = path.join(core, 'settings.layer.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, hooks: { ...settings.hooks, Interrupt: [INTERRUPT_HOOK] } }));

    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {}, codexVersion: null });
    assert.equal(planResult.codexVersion, null);
    assert.ok(planResult.warnings.some(w => /installed: unknown/.test(w)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (2) config.toml managed block
// ---------------------------------------------------------------------------

function samplePermissionsToml() {
  return [
    '# GENERATED comment',
    'default_permissions = "yoki"',
    '',
    '[permissions.yoki]',
    'extends = ":workspace"',
    '',
    '[permissions.yoki.filesystem]',
    '"~/.ssh" = "deny"',
    '',
  ].join('\n');
}

function sampleBlock(hookStateEntries = []) {
  return buildManagedBlockContent({
    permissionsToml: samplePermissionsToml(),
    yokiRoot: '/yoki-root',
    pluginRoot: '/yoki-root',
    hookProfile: 'standard',
    hookStateEntries,
  });
}

test('buildManagedBlockContent: default_permissions and notify come before any [table]', () => {
  const block = sampleBlock();
  const firstTableIdx = block.indexOf('\n[');
  const defaultPermIdx = block.indexOf('default_permissions');
  const notifyIdx = block.indexOf('notify =');
  assert.ok(defaultPermIdx < firstTableIdx);
  assert.ok(notifyIdx < firstTableIdx);
});

test('buildManagedBlockContent: includes one [hooks.state] section per entry', () => {
  const block = sampleBlock([{ key: 'K1', trustedHash: 'sha256:aaa' }, { key: 'K2', trustedHash: 'sha256:bbb' }]);
  assert.match(block, /\[hooks\.state\."K1"\]\ntrusted_hash = "sha256:aaa"\nenabled = true/);
  assert.match(block, /\[hooks\.state\."K2"\]\ntrusted_hash = "sha256:bbb"\nenabled = true/);
});

test('applyManagedBlock: inserted at the top on a fresh file, rest preserved', () => {
  const existing = '[projects."/repo"]\ntrust_level = "trusted"\n';
  const { content, warnings } = applyManagedBlock(existing, sampleBlock(), new Set());
  assert.equal(warnings.length, 0);
  assert.ok(content.startsWith('# yoki:begin\n'));
  assert.ok(content.includes('[projects."/repo"]'));
  assert.ok(content.indexOf('# yoki:end') < content.indexOf('[projects."/repo"]'));
});

test('applyManagedBlock: idempotent — re-applying replaces the old block instead of duplicating it', () => {
  const once = applyManagedBlock('', sampleBlock(), new Set()).content;
  const twice = applyManagedBlock(once, sampleBlock(), new Set()).content;
  assert.equal((twice.match(/# yoki:begin/g) || []).length, 1);
  assert.equal((twice.match(/# yoki:end/g) || []).length, 1);
});

test('applyManagedBlock: idempotent with trailing foreign content — no blank line accumulates on repeated re-apply', () => {
  // Regression: extractBlock used to strip only ONE of the two newlines
  // wrapBlock inserts before a non-empty `rest` (one line-end + one blank
  // separator), so the leftover separator survived into the next `rest`
  // and wrapBlock stacked a fresh one on top — one extra blank line per
  // apply, forever. Only visible with real trailing content (e.g. Codex's
  // own [projects.*] trust table), which the '' seed above never exercises.
  const seed = '[projects."/repo"]\ntrust_level = "trusted"\n';
  const once = applyManagedBlock(seed, sampleBlock(), new Set()).content;
  const twice = applyManagedBlock(once, sampleBlock(), new Set()).content;
  const thrice = applyManagedBlock(twice, sampleBlock(), new Set()).content;
  assert.equal(twice, once);
  assert.equal(thrice, once);
});

test('applyManagedBlock: a conflicting top-level default_permissions outside the block skips ours and warns', () => {
  const existing = 'default_permissions = "custom"\n\n[some.table]\nx = 1\n';
  const { content, warnings } = applyManagedBlock(existing, sampleBlock(), new Set());
  assert.equal(content, existing); // unchanged
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /default_permissions\/sandbox_mode/);
});

test('hasConflictingTopLevelKey: false once the key is inside a [table]', () => {
  assert.equal(hasConflictingTopLevelKey('[foo]\ndefault_permissions = "x"\n'), false);
  assert.equal(hasConflictingTopLevelKey('sandbox_mode = "workspace-write"\n'), true);
});

test('applyManagedBlock: removes older [hooks.state] entries for our keys living outside the block', () => {
  const existing = [
    '[hooks.state."/Users/exampleperson/.codex/hooks.json:pre_tool_use:0:0"]',
    'trusted_hash = "sha256:stale"',
    '',
    '[projects."/repo"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');
  const { content } = applyManagedBlock(existing, sampleBlock(), new Set(['/Users/exampleperson/.codex/hooks.json:pre_tool_use:0:0']));
  assert.ok(!content.includes('sha256:stale'));
  assert.ok(content.includes('[projects."/repo"]'));
});

// ---------------------------------------------------------------------------
// (2b) config.toml — never a duplicate table header
// ---------------------------------------------------------------------------
//
// The regression these pin cost a working Codex install: the block emitted
// `[features]` into a file that already declared `[features] hooks = true`
// outside it, and codex refused to start at all —
// `failed to load bootstrap configuration … config.toml:N: duplicate key`.
// "Inside the managed block" is not a separate TOML namespace.

/** The real ~/.codex/config.toml shape that broke: codex's own [projects]
 * trust table, a hand/other-tool `[features]`, an `[agents]` that disagrees
 * with ours, and a bare `[hooks.state]` header. */
function foreignConfigToml() {
  return [
    '[projects."/Users/exampleperson/go/src/repo"]',
    'trust_level = "trusted"',
    '',
    '[tui.model_availability_nux]',
    '"gpt-5.5" = 2',
    '',
    '[features]',
    'hooks = true',
    '',
    '[agents]',
    'enabled = false',
    '',
    '[shell_environment_policy.set]',
    'PATH_EXTRA = "/opt/homebrew/bin"',
    '',
    '[hooks.state]',
    '',
  ].join('\n');
}

/** Every plain `[table]` header in `text`, in file order. */
function headersOf(text) {
  return (text.match(/^\[[^[\]]+\]$/gm) || []);
}

function duplicateHeadersOf(text) {
  const seen = new Set();
  const dupes = [];
  for (const header of headersOf(text)) {
    if (seen.has(header)) dupes.push(header);
    seen.add(header);
  }
  return dupes;
}

test('applyManagedBlock: a table the foreign half already declares is merged, not re-emitted', () => {
  const { content, info } = applyManagedBlock(foreignConfigToml(), sampleBlock(), new Set());

  assert.deepEqual(duplicateHeadersOf(content), []);
  assert.deepEqual(validateCodexConfigToml(content), []);
  // The block itself no longer carries the shared headers…
  const block = content.slice(0, content.indexOf('# yoki:end'));
  assert.ok(!block.includes('[features]'));
  assert.ok(!block.includes('[agents]'));
  assert.ok(!block.includes('[shell_environment_policy.set]'));
  // …and every merge is reported, so the plan says where the keys went.
  assert.equal(info.filter(line => line.includes('merged into existing')).length, 3);
  assert.ok(info.some(line => line.includes('[features]')));
});

test('applyManagedBlock: our keys are upserted into the existing table and foreign keys survive', () => {
  const { content } = applyManagedBlock(foreignConfigToml(), sampleBlock(), new Set());
  const sections = new Map(splitSections(content).filter(s => s.display).map(s => [s.display, s.lines]));

  // features: ours replaces the foreign value in place, the missing one is appended
  assert.deepEqual(sections.get('[features]').filter(Boolean), ['hooks = true', 'multi_agent = true']);
  // agents: the foreign `enabled = false` becomes ours, in place
  assert.deepEqual(sections.get('[agents]').filter(Boolean), ['enabled = true', 'max_concurrent_threads_per_session = 4']);
  // shell_environment_policy.set: a key we don't own keeps its place, and
  // ours are appended after it rather than replacing the table

  assert.deepEqual(
    sections.get('[shell_environment_policy.set]').filter(Boolean),
    [
      'PATH_EXTRA = "/opt/homebrew/bin"',
      'YOKI_ROOT = "/yoki-root"',
      'CLAUDE_PLUGIN_ROOT = "/yoki-root"',
      'YOKI_HOOK_PROFILE = "standard"',
      'YOKI_HARNESS = "codex"',
    ]
  );
  // and nothing else in the foreign half moved
  assert.ok(content.includes('[projects."/Users/exampleperson/go/src/repo"]\ntrust_level = "trusted"'));
  assert.ok(content.includes('[tui.model_availability_nux]\n"gpt-5.5" = 2'));
  assert.ok(content.includes('[hooks.state]'));
});

test('applyManagedBlock: merging is idempotent — a second and third apply change nothing', () => {
  const once = applyManagedBlock(foreignConfigToml(), sampleBlock(), new Set()).content;
  const twice = applyManagedBlock(once, sampleBlock(), new Set()).content;
  const thrice = applyManagedBlock(twice, sampleBlock(), new Set()).content;
  assert.equal(twice, once);
  assert.equal(thrice, once);
  assert.deepEqual(duplicateHeadersOf(thrice), []);
});

test('applyManagedBlock: a bare [hooks.state] outside the block does not collide with our [hooks.state."key"] entries', () => {
  const entries = [{ key: '/h/.codex/hooks.json:pre_tool_use:0:0', trustedHash: 'sha256:aaa' }];
  const { content } = applyManagedBlock(foreignConfigToml(), sampleBlock(entries), new Set(entries.map(e => e.key)));
  assert.deepEqual(validateCodexConfigToml(content), []);
  assert.ok(content.includes('[hooks.state."/h/.codex/hooks.json:pre_tool_use:0:0"]'));
  assert.ok(content.includes('\n[hooks.state]\n'));
});

test('mergeOwnedTables: a table only WE declare is still emitted in the block', () => {
  const merged = mergeOwnedTables('[features]\nhooks = true\n', '[projects."/repo"]\ntrust_level = "trusted"\n');
  assert.ok(merged.blockContent.includes('[features]'));
  assert.deepEqual(merged.merged, []);
});

// ---------------------------------------------------------------------------
// (2c) the write guard: a config.toml codex cannot load must never be written
// ---------------------------------------------------------------------------

test('validateCodexConfigToml: reports a duplicate table header with both line numbers', () => {
  const errors = validateCodexConfigToml('[features]\nhooks = true\n\n[features]\nmulti_agent = true\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate table header \[features\] at line 4 .* line 1/);
});

test('validateCodexConfigToml: reports a duplicate key inside one table', () => {
  const errors = validateCodexConfigToml('[features]\nhooks = true\nhooks = false\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate key "hooks" in \[features\]/);
});

test('validateCodexConfigToml: a duplicated top-level key is caught too', () => {
  const errors = validateCodexConfigToml('default_permissions = "yoki"\ndefault_permissions = "x"\n');
  assert.match(errors[0], /duplicate key "default_permissions" at the top level/);
});

test('validateCodexConfigToml: [[array-of-tables]] may legally repeat', () => {
  assert.deepEqual(validateCodexConfigToml('[[profile]]\nname = "a"\n\n[[profile]]\nname = "b"\n'), []);
});

test('validateCodexConfigToml: a bracket inside a multi-line array is not read as a header', () => {
  const text = '[mcp_servers.x]\ncommand = "x"\nargs = [\n  "--flag",\n  "[not-a-table]",\n]\n';
  assert.deepEqual(validateCodexConfigToml(text), []);
});

test('validateCodexConfigToml: an mcp server declaring both url and command is refused', () => {
  const errors = validateCodexConfigToml('[mcp_servers.notion-mcp]\ncommand = ""\ntype = "http"\nurl = "https://mcp.notion.com/mcp"\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /both "url" and "command"/);
});

test('validateCodexConfigToml: an mcp server declaring neither url nor command is refused', () => {
  const errors = validateCodexConfigToml('[mcp_servers.n]\nenabled = true\n');
  assert.match(errors[0], /neither "url" nor "command"/);
});

test('assertValidCodexConfigToml: throws naming the destination and every problem', () => {
  assert.throws(
    () => assertValidCodexConfigToml('[features]\nhooks = true\n\n[features]\nhooks = false\n', '/h/.codex/config.toml'),
    err => {
      assert.match(err.message, /refusing to write \/h\/\.codex\/config\.toml/);
      assert.match(err.message, /duplicate table header \[features\]/);
      return true;
    }
  );
});

test('applyManagedBlock: refuses to produce a file whose FOREIGN half already duplicates a table', () => {
  // Nothing this generator can merge away: the duplicate is entirely outside
  // the block, so the honest outcome is a refusal that names it.
  const broken = '[features]\nhooks = true\n\n[projects."/repo"]\ntrust_level = "trusted"\n\n[features]\nmulti_agent = false\n';
  assert.throws(() => applyManagedBlock(broken, sampleBlock(), new Set()), /duplicate table header \[features\]/);
});

test('splitSections/joinSections round-trip config.toml byte-for-byte', () => {
  const text = foreignConfigToml();
  assert.equal(joinSections(splitSections(text)), text);
});

test('readTables: keys of an [mcp_servers.<name>] table are read for the shape check', () => {
  const tables = readTables('[mcp_servers.serena]\ncommand = "uvx"\nargs = []\n');
  const server = tables.find(t => t.display === '[mcp_servers.serena]');
  assert.deepEqual([...server.keys.keys()], ['command', 'args']);
});

// ---------------------------------------------------------------------------
// (4) agents/*.md -> *.toml
// ---------------------------------------------------------------------------

test('agentMarkdownToToml: name/description/model/tools all land in the TOML', () => {
  const md = [
    '---',
    'name: architect',
    'description: Software architecture specialist',
    'tools: ["Read", "Grep"]',
    'model: sonnet',
    '---',
    '',
    'You are a senior architect.',
  ].join('\n');

  const toml = agentMarkdownToToml('architect', md, { sonnet: 'gpt-5.1-codex' });
  assert.match(toml, /name = "architect"/);
  assert.match(toml, /description = "Software architecture specialist"/);
  assert.match(toml, /model = "gpt-5\.1-codex"/);
  assert.match(toml, /developer_instructions = /);
  assert.match(toml, /Tools available to you: Read, Grep\./);
  assert.match(toml, /You are a senior architect\./);
});

test('agentMarkdownToToml: an unknown model tier is omitted rather than guessed at', () => {
  const md = '---\nname: x\ndescription: d\nmodel: not-a-tier\n---\nbody';
  const toml = agentMarkdownToToml('x', md, { sonnet: 'gpt-5.1-codex' });
  assert.ok(!toml.includes('model ='));
});

// ---------------------------------------------------------------------------
// (5) AGENTS.md managed block
// ---------------------------------------------------------------------------

test('hasPathsFrontmatter: true only when the frontmatter has a paths: key', () => {
  assert.equal(hasPathsFrontmatter('---\npaths:\n  - "**/*.go"\n---\nbody'), true);
  assert.equal(hasPathsFrontmatter('---\n---\nbody'), false);
  assert.equal(hasPathsFrontmatter('no frontmatter at all'), false);
});

test('substituteVocab: applies every entry, longest key first', () => {
  const vocab = { 'Claude Code': 'Codex', '~/.claude/': '~/.codex/', '~/.claude': '~/.codex' };
  assert.equal(substituteVocab('Use Claude Code and edit ~/.claude/rules', vocab), 'Use Codex and edit ~/.codex/rules');
});

test('buildAgentsMdBlockContent + applyAgentsMdBlock: concatenates CLAUDE*.md and no-paths rules, substitutes vocab, preserves the rest', () => {
  const vocab = { 'Claude Code': 'Codex' };
  const block = buildAgentsMdBlockContent({
    claudeLayerMd: '# Core\n\nUse Claude Code daily.',
    claudePersonalMd: '# Personal\n\nMore rules.',
    noPathsRules: [{ path: 'common/git-workflow.md', content: '---\n---\n# Git Workflow\n\nCommit often.' }],
    vocab,
  });
  assert.match(block, /Use Codex daily\./);
  assert.match(block, /# Personal/);
  assert.match(block, /# Git Workflow/);
  assert.ok(!block.includes('Claude Code'));

  const applied = applyAgentsMdBlock('some hand-written note\n', block);
  assert.ok(applied.startsWith('<!-- yoki:begin -->'));
  assert.ok(applied.includes('some hand-written note'));
});

// ---------------------------------------------------------------------------
// (6) skill symlink decision
// ---------------------------------------------------------------------------

test('decideSkillSymlink: a skill with a codex/ port symlinks the port dir into <out>/skills/<name>', () => {
  const op = decideSkillSymlink({ skillDir: '/repo/core/skills/grilling', hasCodexPort: true, name: 'grilling', out: '/home/.codex', home: '/home', layer: '/repo/core' });
  assert.equal(op.kind, 'symlink');
  assert.equal(op.destinationPath, path.join('/home/.codex', 'skills', 'grilling'));
  assert.equal(op.sourcePath, path.join('/repo/core/skills/grilling', 'codex'));
});

test('decideSkillSymlink: a skill with no port symlinks the whole dir into ~/.agents/skills/<name>', () => {
  const op = decideSkillSymlink({ skillDir: '/repo/core/skills/writeup', hasCodexPort: false, name: 'writeup', out: '/home/.codex', home: '/home', layer: '/repo/core' });
  assert.equal(op.destinationPath, path.join('/home', '.agents', 'skills', 'writeup'));
  assert.equal(op.sourcePath, '/repo/core/skills/writeup');
});

// ---------------------------------------------------------------------------
// (7) commands -> skills
// ---------------------------------------------------------------------------

test('commandNameFromRelPath: nested commands join path segments with -', () => {
  assert.equal(commandNameFromRelPath('plan.md'), 'plan');
  assert.equal(commandNameFromRelPath(path.join('prompts', 'explain.md')), 'prompts-explain');
});

test('commandToSkill: frontmatter name is cmd-<name>, description/argument-hint carried, body verbatim', () => {
  const md = '---\ndescription: Generate a report\nargument-hint: [csv]\n---\n\n# Report\n\nDo the thing.';
  const { name, skillMarkdown } = commandToSkill('cost-report.md', md);
  assert.equal(name, 'cmd-cost-report');
  assert.match(skillMarkdown, /^---\nname: cmd-cost-report\ndescription: Generate a report\nargument-hint: \[csv\]\n---\n/);
  assert.match(skillMarkdown, /# Report\n\nDo the thing\./);
});

test('commandToSkill: falls back to the first heading when frontmatter has no description', () => {
  const md = '---\n---\n# Aside Command\n\nBody text.';
  const { skillMarkdown } = commandToSkill('aside.md', md);
  assert.match(skillMarkdown, /description: Aside Command/);
});

// ---------------------------------------------------------------------------
// End-to-end: plan() + gen.apply() over a synthetic two-layer fixture,
// entirely inside a tmp dir (never touches the real home).
// ---------------------------------------------------------------------------

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixtureRepo(root) {
  const core = path.join(root, 'core');
  const personal = path.join(root, 'personal');

  writeFile(path.join(core, 'settings.layer.json'), JSON.stringify({
    hooks: {
      PreToolUse: [RUNNER_HOOK],
    },
  }));
  writeFile(path.join(core, 'permissions.yaml'), 'allow:\n  - pattern: "Bash(git status *)"\ndeny: []\ndefaultMode: auto\n');
  writeFile(path.join(core, 'CLAUDE.layer.md'), '# Core\n\nUse Claude Code daily.');
  writeFile(path.join(core, 'harness-models.json'), JSON.stringify({ codex: { sonnet: 'gpt-5.1-codex' } }));
  writeFile(path.join(core, 'agents', 'architect.md'), '---\nname: architect\ndescription: Architecture specialist\nmodel: sonnet\n---\n\nDesign things.');
  writeFile(path.join(core, 'commands', 'plan.md'), '---\ndescription: Make a plan\n---\n\n# Plan\n\nDo planning.');
  writeFile(path.join(core, 'rules', 'common', 'git-workflow.md'), '---\n---\n# Git Workflow\n\nCommit often.');
  writeFile(path.join(core, 'rules', 'go', 'coding-style.md'), '---\npaths:\n  - "**/*.go"\n---\n# Go Style\n\nHandle errors.');
  writeFile(path.join(core, 'skills', 'ported', 'SKILL.md'), '---\nname: ported\ndescription: d\n---\nbody');
  writeFile(path.join(core, 'skills', 'ported', 'codex', 'SKILL.md'), '---\nname: ported\ndescription: d\n---\ncodex body');
  writeFile(path.join(core, 'skills', 'plain', 'SKILL.md'), '---\nname: plain\ndescription: d\n---\nbody');
  writeFile(path.join(core, 'mcp.json'), JSON.stringify({
    schemaVersion: 'ecc.mcp.v1',
    servers: [
      { name: 'context7', transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp@1.0.14'], env: {}, targets: { claude: false, codex: true, omp: false } },
      { name: 'figma-remote', transport: 'http', url: 'https://mcp.figma.com/mcp', env: {}, targets: { claude: true, codex: false, omp: false } },
    ],
  }));

  writeFile(path.join(personal, 'settings.personal.json'), JSON.stringify({ hooks: {} }));
  writeFile(path.join(personal, 'permissions.yaml'), 'allow: []\ndeny: []\ndefaultMode: auto\n');
  writeFile(path.join(personal, 'CLAUDE.personal.md'), '# Personal\n\nHighest precedence.');

  return { core, personal };
}

function makeTmpDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gen-fixture-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gen-home-'));
  return { root, home, out: path.join(home, '.codex') };
}

// ---------------------------------------------------------------------------
// <out>/.yoki/permissions.json. Codex's own two mechanisms cover the Bash
// denies (yoki.rules) and the READ side of the absolute secret paths
// ([permissions.yoki.filesystem]) — nothing else. Every Edit(...) row and
// every Read(**…) workspace glob was therefore declared and unenforced unless
// permissions.yaml happened to tag it `enforce: [hook]`.
// ---------------------------------------------------------------------------

test('plan(): the denies neither yoki.rules nor the filesystem table expresses go to .yoki/permissions.json', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    writeFile(
      path.join(personal, 'permissions.yaml'),
      [
        'allow: []',
        'deny:',
        '  - pattern: "Read(~/.ssh/id_*)"',       // fs table covers the read side
        '  - pattern: "Edit(~/.ssh/id_*)"',       // nothing covers the write side
        '  - pattern: "Read(**/.env)"',           // workspace glob, not in the fs table
        '  - pattern: "Bash(rm -rf /)"',          // a plain execpolicy prefix rule
        '  - pattern: "Bash(rm -rf /*)"',         // no execpolicy equivalent
        '    enforce: [hook]',
        'defaultMode: auto',
        '',
      ].join('\n')
    );

    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {}, codexVersion: null });
    gen.apply(planResult);

    const perms = JSON.parse(fs.readFileSync(path.join(out, '.yoki', 'permissions.json'), 'utf8'));
    assert.deepEqual(
      new Set(perms.deny.map(e => e.pattern)),
      new Set(['Bash(rm -rf /*)', 'Edit(~/.ssh/id_*)', 'Read(**/.env)']),
      'Read(~/.ssh/id_*) is in [permissions.yoki.filesystem] and Bash(rm -rf /) is a rule — neither needs the guard'
    );

    assert.deepEqual(planResult.warnings.filter(w => /native execpolicy\/filesystem equivalent/.test(w)), []);
    assert.ok(planResult.info.some(line => /enforced by pre-permission-guard on codex/.test(line)), planResult.info.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('end-to-end: plan()+apply() writes every artifact and stays fully contained under --home', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);

    // Pre-seed a foreign (herdr-style) SessionStart hook the apply must
    // preserve — in the WRAPPED shape Codex itself writes.
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: "bash '/Users/exampleperson/.codex/herdr-agent-state.sh' session", timeout: 10 }] }],
      },
    }));

    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {} });
    assert.equal(planResult.target, 'codex');
    assert.equal(planResult.home, home);

    gen.apply(planResult);

    // (1) hooks.json: wrapped shape, foreign group preserved, ours appended
    const hooksJson = JSON.parse(fs.readFileSync(path.join(out, 'hooks.json'), 'utf8'));
    assert.ok(isWrappedHooksJson(hooksJson), 'written hooks.json must be in the shape codex reads');
    assert.equal(hooksJson.hooks.SessionStart.length, 1); // herdr's group; the fixture shipped no SessionStart hook of our own
    assert.match(hooksJson.hooks.SessionStart[0].hooks[0].command, /herdr-agent-state\.sh/);
    assert.equal(hooksJson.hooks.PreToolUse.length, 1);
    assert.match(hooksJson.hooks.PreToolUse[0].hooks[0].command, /--harness codex/);

    // (2) config.toml
    const configToml = fs.readFileSync(path.join(out, 'config.toml'), 'utf8');
    assert.match(configToml, /^# yoki:begin/);
    assert.match(configToml, /default_permissions = "yoki"/);
    assert.match(configToml, /\[hooks\.state\./);

    // (2b) [mcp_servers.<name>] tables (T13): codex-targeted server present,
    // claude-only server (figma-remote) excluded.
    assert.match(configToml, /\[mcp_servers\.context7\]/);
    assert.ok(!configToml.includes('mcp_servers.figma-remote'));
    assert.ok(planResult.warnings.length === 0 || !planResult.warnings.some(w => w.includes('mcp_servers')));

    // (3) rules/yoki.rules
    const rules = fs.readFileSync(path.join(out, 'rules', 'yoki.rules'), 'utf8');
    assert.match(rules, /prefix_rule\(pattern=\["git", "status"\], decision="allow"\)/);

    // (4) agents/*.toml
    const agentToml = fs.readFileSync(path.join(out, 'agents', 'architect.toml'), 'utf8');
    assert.match(agentToml, /model = "gpt-5\.1-codex"/);

    // (5) AGENTS.md
    const agentsMd = fs.readFileSync(path.join(out, 'AGENTS.md'), 'utf8');
    assert.match(agentsMd, /Use Codex daily\./); // vocab-substituted
    assert.match(agentsMd, /Highest precedence\./);
    assert.match(agentsMd, /Commit often\./); // no-paths rule folded in
    assert.ok(!agentsMd.includes('Handle errors.')); // paths:-scoped rule stays OUT of AGENTS.md

    // (6) skills
    assert.equal(fs.readlinkSync(path.join(out, 'skills', 'ported')), path.join(core, 'skills', 'ported', 'codex'));
    assert.equal(fs.readlinkSync(path.join(home, '.agents', 'skills', 'plain')), path.join(core, 'skills', 'plain'));

    // (7) commands -> skills
    const cmdSkill = fs.readFileSync(path.join(out, 'skills', 'cmd-plan', 'SKILL.md'), 'utf8');
    assert.match(cmdSkill, /name: cmd-plan/);
    assert.match(cmdSkill, /Do planning\./);

    // Re-applying is idempotent and never escapes --home.
    const secondPlan = codexTarget.plan({ sources: [core, personal], out, home, env: {} });
    gen.apply(secondPlan);
    const hooksJsonAgain = JSON.parse(fs.readFileSync(path.join(out, 'hooks.json'), 'utf8'));
    assert.equal(hooksJsonAgain.hooks.PreToolUse.length, 1); // not duplicated
    const configTomlAgain = fs.readFileSync(path.join(out, 'config.toml'), 'utf8');
    assert.equal((configTomlAgain.match(/# yoki:begin/g) || []).length, 1);
    assert.equal((configTomlAgain.match(/\[mcp_servers\.context7\]/g) || []).length, 1); // not duplicated
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('end-to-end: a [mcp_servers.<name>] table already declared outside the managed block is left alone and reported', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);

    // Pre-seed config.toml with a hand-added (or pre-T13 `codex mcp add`)
    // context7 entry OUTSIDE where our managed block will land.
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'config.toml'), '[mcp_servers.context7]\ncommand = "hand-added"\n');

    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {} });
    assert.ok(planResult.warnings.some(w => w.includes('mcp_servers.context7') && w.includes('already declared outside the managed block')));

    gen.apply(planResult);
    const configToml = fs.readFileSync(path.join(out, 'config.toml'), 'utf8');
    assert.match(configToml, /command = "hand-added"/); // untouched
    assert.equal((configToml.match(/\[mcp_servers\.context7\]/g) || []).length, 1); // not duplicated inside our block
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// gen.js apply(): atomicity and ordering
//
// apply() cannot be a transaction (the destinations are the user's real
// ~/.codex), so what it owes is: no half-written file, a safe order for the
// two mutually-dependent ones, and an audible failure that says how far it
// got.
// ---------------------------------------------------------------------------

test('apply(): config.toml (trust hashes) is written BEFORE hooks.json, and the manifest last', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {} });

    const order = [];
    gen.apply(planResult, {
      applyOp: (op) => { order.push(path.basename(op.destinationPath)); },
    });

    const configIdx = order.indexOf('config.toml');
    const hooksIdx = order.indexOf('hooks.json');
    assert.ok(configIdx !== -1 && hooksIdx !== -1);
    assert.ok(
      configIdx < hooksIdx,
      'hashes before hooks: an interruption then leaves trust entries for hooks that do not exist yet, ' +
        'which codex ignores — the reverse leaves the new hooks untrusted and silently skipped'
    );
    // The manifest is written after the op loop, so it never appears in it.
    assert.ok(!order.includes('codex-manifest.json'));
    assert.ok(fs.existsSync(path.join(out, '.yoki', 'codex-manifest.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('apply(): sortOpsForApply keeps unrelated ops in their original relative order', () => {
  const ops = [
    { kind: 'merge-json', destinationPath: '/o/hooks.json' },
    { kind: 'write', destinationPath: '/o/agents/a.md' },
    { kind: 'toml-block', destinationPath: '/o/config.toml' },
    { kind: 'write', destinationPath: '/o/agents/b.md' },
  ];
  const sorted = gen.sortOpsForApply(ops).map(op => op.destinationPath);
  assert.deepEqual(sorted, ['/o/config.toml', '/o/hooks.json', '/o/agents/a.md', '/o/agents/b.md']);
  // The caller's array is not mutated.
  assert.equal(ops[0].destinationPath, '/o/hooks.json');
});

test('apply(): a failure mid-run names every file already updated and skips the manifest', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {} });

    // Fail exactly between config.toml and hooks.json — the pair whose drift
    // is the whole reason the ordering exists.
    const done = [];
    assert.throws(
      () => gen.apply(planResult, {
        applyOp: (op) => {
          if (path.basename(op.destinationPath) === 'hooks.json') throw new Error('ENOSPC: simulated disk failure');
          done.push(op.destinationPath);
        },
      }),
      (err) => {
        assert.match(err.message, /ENOSPC: simulated disk failure/);
        assert.match(err.message, /stopped at merge-json .*hooks\.json/);
        assert.match(err.message, /1 file\(s\) already updated/);
        assert.match(err.message, /config\.toml/);
        assert.match(err.message, /re-run `yoki-switch apply` to finish/);
        assert.deepEqual(err.appliedDestinations, done);
        return true;
      }
    );

    assert.ok(
      !fs.existsSync(path.join(out, '.yoki', 'codex-manifest.json')),
      'a manifest written after a failed apply would claim destinations that were never written'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('apply(): a failed write leaves the PREVIOUS file intact and no temp file behind', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    fs.mkdirSync(out, { recursive: true });
    const dest = path.join(out, 'config.toml');
    fs.writeFileSync(dest, 'previous content\n', 'utf8');

    // fs.renameSync fails after the temp file exists — the destination must
    // still hold the old bytes, not a truncated new write.
    const realRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('EXDEV: simulated rename failure'); };
    try {
      assert.throws(() => gen.writeFileAtomic(dest, 'new content\n'), /EXDEV/);
    } finally {
      fs.renameSync = realRename;
    }

    assert.equal(fs.readFileSync(dest, 'utf8'), 'previous content\n');
    assert.deepEqual(
      fs.readdirSync(out).filter(f => f.includes('yoki-tmp')),
      [],
      'a failed write must not leave a temp file behind'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('apply(): every write goes through a same-directory temp file + rename', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    fs.mkdirSync(out, { recursive: true });
    const dest = path.join(out, 'hooks.json');
    const tmpPaths = [];
    const realRename = fs.renameSync;
    fs.renameSync = (from, to) => { tmpPaths.push([from, to]); return realRename(from, to); };
    try {
      gen.applyOp(
        { kind: 'merge-json', destinationPath: dest, content: { hooks: {} } },
        { out, home }
      );
    } finally {
      fs.renameSync = realRename;
    }

    assert.equal(tmpPaths.length, 1);
    const [from, to] = tmpPaths[0];
    // `to` is the realpath'd destination (path-safety resolves symlinks such
    // as macOS's /var -> /private/var), so compare by basename, not literally.
    assert.equal(path.basename(to), 'hooks.json');
    // Same directory: a cross-filesystem rename is not atomic.
    assert.equal(path.dirname(from), path.dirname(to));
    assert.match(path.basename(from), /^hooks\.json\.yoki-tmp-\d+$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), { hooks: {} });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('gen.js CLI plan(): --dry-run --json shape has target/out/sources/operations/warnings', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const planResult = gen.plan({ target: 'codex', sources: [core, personal], out, home, env: {} });
    assert.equal(planResult.target, 'codex');
    assert.equal(planResult.out, out);
    assert.ok(Array.isArray(planResult.sources));
    assert.ok(Array.isArray(planResult.operations) && planResult.operations.length > 0);
    assert.ok(Array.isArray(planResult.warnings));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// guard floor (permissions.yaml `guardFloor:`)
//
// Codex has no `floor` field of its own — the floor hooks arrive as ordinary
// translated `run-bash-hook.js "<abs path>"` commands — so this target's job
// is to notice when a declared one did NOT survive translation, instead of
// shipping a hooks.json that quietly runs one guard fewer.
// ---------------------------------------------------------------------------

const { verifyGuardFloor } = codexTarget;

function floorEntry(hook, event = 'PreToolUse', matcher = 'Bash') {
  return { hook, event, matcher, scriptPath: `/home/u/.claude/hooks/${hook}` };
}

function mergedWith(event, ...scriptPaths) {
  return {
    hooks: {
      [event]: [
        {
          matcher: 'Bash',
          hooks: scriptPaths.map(p => ({
            type: 'command',
            command: `"\${YOKI_NODE:-node}" "/yoki/scripts/hooks/run-bash-hook.js" --harness codex "${p}"`,
          })),
        },
      ],
    },
  };
}

test('verifyGuardFloor: every declared hook present in hooks.json -> nothing reported', () => {
  const guardFloor = [floorEntry('git-guard.sh'), floorEntry('unattended-guard.sh')];
  const merged = mergedWith('PreToolUse', '/home/u/.claude/hooks/git-guard.sh', '/home/u/.claude/hooks/unattended-guard.sh');
  const { warnings, skipped } = verifyGuardFloor({ merged, guardFloor });
  assert.deepEqual(warnings, []);
  assert.deepEqual(skipped, []);
});

test('verifyGuardFloor: a floor hook missing from hooks.json is warned AND skipped-listed', () => {
  const guardFloor = [floorEntry('git-guard.sh'), floorEntry('unattended-guard.sh')];
  const merged = mergedWith('PreToolUse', '/home/u/.claude/hooks/git-guard.sh');
  const { warnings, skipped } = verifyGuardFloor({ merged, guardFloor });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unattended-guard\.sh/);
  assert.match(warnings[0], /guard floor/);
  assert.deepEqual(skipped, [
    {
      target: 'codex',
      event: 'PreToolUse',
      matcher: 'Bash',
      command: '/home/u/.claude/hooks/unattended-guard.sh',
      reason: 'declared in permissions.yaml guardFloor but absent from the generated hooks.json — codex would run below the guard floor',
    },
  ]);
});

test('verifyGuardFloor: the hook registered on a DIFFERENT event does not satisfy the floor', () => {
  const guardFloor = [floorEntry('git-guard.sh', 'PreToolUse')];
  const merged = mergedWith('PostToolUse', '/home/u/.claude/hooks/git-guard.sh');
  const { warnings } = verifyGuardFloor({ merged, guardFloor });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"git-guard\.sh" \(PreToolUse\)/);
});

test('verifyGuardFloor: an empty hooks.json fails every declared entry', () => {
  const guardFloor = [floorEntry('git-guard.sh'), floorEntry('unattended-guard.sh')];
  assert.equal(verifyGuardFloor({ merged: {}, guardFloor }).warnings.length, 2);
});

test('verifyGuardFloor: no floor declared -> nothing to check', () => {
  const merged = mergedWith('PreToolUse', '/home/u/.claude/hooks/git-guard.sh');
  assert.deepEqual(verifyGuardFloor({ merged, guardFloor: [] }), { warnings: [], skipped: [] });
});
