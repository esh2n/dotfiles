'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGeneratedGroups, mergeHooksJson, collectHookStateEntries, translateMatcher } = require('../codex-hooks-merge');
const { buildManagedBlockContent, applyManagedBlock, hasConflictingTopLevelKey } = require('../codex-config-toml');
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
    { yokiRoot: '/opt/yoki', home: '/home/u' }
  );
  assert.equal(generated.PreToolUse.length, 1);
  assert.equal(
    generated.PreToolUse[0].hooks[0].command,
    '"${YOKI_NODE:-node}" "/opt/yoki/scripts/hooks/run-bash-hook.js" --harness codex "/home/u/.claude/hooks/git-guard.sh"'
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(skipped, []);
});

test('buildGeneratedGroups: a translated wrapper guard is recognized as ours (trust entry + regenerable group)', () => {
  const { generated } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }],
    { yokiRoot: '/opt/yoki', home: '/home/u' }
  );
  const merged = mergeHooksJson({}, generated);
  const entries = collectHookStateEntries(merged, '/home/u/.codex/hooks.json');
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
    { yokiRoot: '/opt/yoki', home: '/home/u' }
  );
  assert.match(generated.PreToolUse[0].hooks[0].command, /run-bash-hook\.js" --harness codex "\/home\/u\/\.claude\/hooks\/herdr-agent-state\.sh" "session"$/);
});

test('buildGeneratedGroups: an unrecognized command is reported as skipped with a reason, never silently dropped', () => {
  const { generated, warnings, skipped } = buildGeneratedGroups(
    [{ hooks: { PreToolUse: [UNRECOGNIZED_HOOK] } }],
    { yokiRoot: '/opt/yoki', home: '/home/u' }
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
  const { generated, skipped } = buildGeneratedGroups([{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }], { home: '/home/u' });
  assert.equal(generated.PreToolUse, undefined);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /YOKI_ROOT/);
});

test('buildGeneratedGroups: Workflow matcher has no Codex equivalent and is skipped with a warning', () => {
  const { generated, warnings } = buildGeneratedGroups([{ hooks: { PreToolUse: [{ matcher: 'Workflow', hooks: [RUNNER_HOOK.hooks[0]] }] } }]);
  assert.equal(generated.PreToolUse, undefined);
  assert.ok(warnings.some(w => /Workflow/.test(w)));
});

test('translateMatcher: Edit|Write|MultiEdit in any order maps to Write|Edit|apply_patch', () => {
  assert.equal(translateMatcher('Write|Edit|MultiEdit'), 'Write|Edit|apply_patch');
  assert.equal(translateMatcher('Edit|Write|MultiEdit'), 'Write|Edit|apply_patch');
  assert.equal(translateMatcher('Bash'), 'Bash');
  assert.equal(translateMatcher('mcp__.*'), 'mcp__.*');
  assert.equal(translateMatcher('WebFetch|WebSearch'), 'WebFetch|WebSearch'); // pass-through, no rule for it
});

test('mergeHooksJson: a foreign (herdr) group is preserved byte-for-byte and ours is appended after it', () => {
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: "bash '/Users/esh2n/.codex/herdr-agent-state.sh' session" }] };
  const existing = { SessionStart: [herdrGroup] };
  const generated = { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node run-with-flags.js x y z --harness codex' }] }] };

  const merged = mergeHooksJson(existing, generated);
  assert.equal(merged.SessionStart.length, 2);
  assert.deepEqual(merged.SessionStart[0], herdrGroup); // untouched, still first
  assert.match(merged.SessionStart[1].hooks[0].command, /--harness codex/);
});

test('mergeHooksJson: re-running drops our OWN previous group instead of duplicating it', () => {
  const ourOldGroup = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js old --harness codex' }] };
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: 'bash herdr.sh' }] };
  const existing = { PreToolUse: [herdrGroup, ourOldGroup] };
  const generated = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js new --harness codex' }] }] };

  const merged = mergeHooksJson(existing, generated);
  assert.equal(merged.PreToolUse.length, 2);
  assert.deepEqual(merged.PreToolUse[0], herdrGroup);
  assert.match(merged.PreToolUse[1].hooks[0].command, /new/);
});

test('collectHookStateEntries: indices are read off the FINAL merged hooks.json, so a foreign group ahead of ours shifts our index', () => {
  const herdrGroup = { matcher: '*', hooks: [{ type: 'command', command: 'bash herdr.sh' }] };
  const ours = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node run-with-flags.js x --harness codex' }] };
  const merged = { PreToolUse: [herdrGroup, ours] };

  const entries = collectHookStateEntries(merged, '/Users/esh2n/.codex/hooks.json');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, '/Users/esh2n/.codex/hooks.json:pre_tool_use:1:0'); // group index 1, not 0
  assert.match(entries[0].trustedHash, /^sha256:[0-9a-f]{64}$/);
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
    '[hooks.state."/Users/esh2n/.codex/hooks.json:pre_tool_use:0:0"]',
    'trusted_hash = "sha256:stale"',
    '',
    '[projects."/repo"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');
  const { content } = applyManagedBlock(existing, sampleBlock(), new Set(['/Users/esh2n/.codex/hooks.json:pre_tool_use:0:0']));
  assert.ok(!content.includes('sha256:stale'));
  assert.ok(content.includes('[projects."/repo"]'));
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

test('end-to-end: plan()+apply() writes every artifact and stays fully contained under --home', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);

    // Pre-seed a foreign (herdr-style) SessionStart hook the apply must preserve.
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'hooks.json'), JSON.stringify({
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: "bash '/Users/esh2n/.codex/herdr-agent-state.sh' session", timeout: 10 }] }],
    }));

    const planResult = codexTarget.plan({ sources: [core, personal], out, home, env: {} });
    assert.equal(planResult.target, 'codex');
    assert.equal(planResult.home, home);

    gen.apply(planResult);

    // (1) hooks.json: foreign group preserved, ours appended
    const hooksJson = JSON.parse(fs.readFileSync(path.join(out, 'hooks.json'), 'utf8'));
    assert.equal(hooksJson.SessionStart.length, 1); // herdr's group; the fixture shipped no SessionStart hook of our own
    assert.match(hooksJson.SessionStart[0].hooks[0].command, /herdr-agent-state\.sh/);
    assert.equal(hooksJson.PreToolUse.length, 1);
    assert.match(hooksJson.PreToolUse[0].hooks[0].command, /--harness codex/);

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
    assert.equal(hooksJsonAgain.PreToolUse.length, 1); // not duplicated
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
