'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildYokiHooksJson, parseRunnerCommand, timeoutMs } = require('../omp-hooks');
const { renderConfigYml } = require('../omp-config-yml');
const { buildRulesMdBlockContent, applyRulesMdBlock, POINTER_LINE } = require('../omp-rules-md');
const { agentMarkdownToOmp } = require('../omp-agents');
const { translateMatcher, translateToolsList } = require('../omp-tool-names');
const { buildMcpJson } = require('../omp-mcp');
const ompTarget = require('../omp');
const gen = require('../gen');

const RUNNER_HOOK = {
  matcher: 'Bash',
  hooks: [{
    type: 'command',
    command: '"${YOKI_NODE:-node}" "${YOKI_ROOT}/scripts/hooks/run-with-flags.js" "pre:x" "scripts/hooks/pre-x.js" "standard,strict"',
    timeout: 5,
  }],
};

// The personal layer's real shape (see personal/settings.personal.json).
const WRAPPER_BASH_HOOK = {
  matcher: 'Bash',
  hooks: [{
    type: 'command',
    command: "bash -c 'h=~/.claude/hooks/git-guard.sh; if bash -n \"$h\" 2>/dev/null; then exec bash \"$h\"; fi; echo \"[hook] syntax check failed: git-guard.sh - failing open\" >&2'",
  }],
};

const UNRECOGNIZED_HOOK = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: "osascript -e 'display notification \"hi\"'" }],
};

const UNRECOGNIZED_HOOK_GROUP = {
  matcher: 'permission_prompt',
  hooks: [{ type: 'command', command: "osascript -e 'display notification \"hi\"'" }],
};

// ---------------------------------------------------------------------------
// omp-hooks.js
// ---------------------------------------------------------------------------

test('parseRunnerCommand: run-with-flags.js -> {kind:js, id, script, profiles}', () => {
  const parsed = parseRunnerCommand(RUNNER_HOOK.hooks[0].command);
  assert.deepEqual(parsed, { kind: 'js', id: 'pre:x', script: 'scripts/hooks/pre-x.js', profiles: ['standard', 'strict'] });
});

test('parseRunnerCommand: the personal bash wrapper -> {kind:bash, id, script} (absolute)', () => {
  const parsed = parseRunnerCommand(WRAPPER_BASH_HOOK.hooks[0].command, { home: '/home/exampleperson' });
  assert.deepEqual(parsed, { kind: 'bash', id: 'git-guard', script: '/home/exampleperson/.claude/hooks/git-guard.sh' });
});

test('parseRunnerCommand: wrapper args are preserved', () => {
  const cmd = "bash -c 'h=~/.claude/hooks/herdr-agent-state.sh; if bash -n \"$h\" 2>/dev/null; then exec bash \"$h\" session; fi; echo x >&2'";
  assert.deepEqual(parseRunnerCommand(cmd, { home: '/home/exampleperson' }), {
    kind: 'bash',
    id: 'herdr-agent-state',
    script: '/home/exampleperson/.claude/hooks/herdr-agent-state.sh',
    args: ['session'],
  });
});

test('parseRunnerCommand: an unrecognized command is not portable (null)', () => {
  assert.equal(parseRunnerCommand(UNRECOGNIZED_HOOK.hooks[0].command, { home: '/home/exampleperson' }), null);
});

test('timeoutMs: seconds -> milliseconds, non-positive/non-numeric -> undefined', () => {
  assert.equal(timeoutMs(5), 5000);
  assert.equal(timeoutMs(0), undefined);
  assert.equal(timeoutMs(-1), undefined);
  assert.equal(timeoutMs('5'), undefined);
  assert.equal(timeoutMs(undefined), undefined);
});

test('buildYokiHooksJson: PreToolUse/Bash -> tool_call with matcher "bash", timeout in ms', () => {
  const { generated, warnings } = buildYokiHooksJson([{ hooks: { PreToolUse: [RUNNER_HOOK] } }]);
  assert.equal(warnings.length, 0);
  assert.deepEqual(generated.tool_call, [{ kind: 'js', id: 'pre:x', script: 'scripts/hooks/pre-x.js', profiles: ['standard', 'strict'], matcher: 'bash', timeout: 5000 }]);
});

test('buildYokiHooksJson: event mapping — PostToolUse/Stop/SessionStart/UserPromptSubmit/PreCompact/SessionEnd', () => {
  const layer = {
    hooks: {
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "post:a" "s/a.js"' }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "stop:a" "s/b.js"' }] }],
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "start:a" "s/c.js"' }] }],
      UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "prompt:a" "s/d.js"' }] }],
      PreCompact: [{ matcher: '*', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "compact:a" "s/e.js"' }] }],
      SessionEnd: [{ matcher: '*', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "end:a" "s/f.js"' }] }],
    },
  };
  const { generated } = buildYokiHooksJson([layer]);
  assert.equal(generated.tool_result[0].matcher, 'edit');
  assert.ok(generated.session_stop);
  assert.equal(generated.session_stop[0].matcher, undefined); // session-level event: no per-tool matcher
  assert.ok(generated.session_start);
  assert.ok(generated.before_agent_start);
  assert.ok(generated.session_before_compact);
  assert.ok(generated.session_shutdown);
});

test('buildYokiHooksJson: Notification only maps on matcher "permission_prompt" -> tool_approval_requested', () => {
  const layer = {
    hooks: {
      Notification: [
        { matcher: 'permission_prompt', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "notif:a" "s/g.js"' }] },
        { matcher: 'idle_prompt', hooks: [{ type: 'command', command: '"node" "run-with-flags.js" "notif:b" "s/h.js"' }] },
      ],
    },
  };
  const { generated, warnings } = buildYokiHooksJson([layer]);
  assert.equal(generated.tool_approval_requested.length, 1);
  assert.equal(generated.tool_approval_requested[0].id, 'notif:a');
  assert.ok(warnings.some(w => /idle_prompt/.test(w)));
});

test('buildYokiHooksJson: Workflow matcher has no omp tool equivalent and is skipped with a warning', () => {
  const { generated, warnings } = buildYokiHooksJson([{ hooks: { PreToolUse: [{ matcher: 'Workflow', hooks: [RUNNER_HOOK.hooks[0]] }] } }]);
  assert.equal(generated.tool_call, undefined);
  assert.ok(warnings.some(w => /Workflow/.test(w)));
});

test('buildYokiHooksJson: a personal bash-wrapper guard becomes a kind:bash tool_call spec, not a dropped guard', () => {
  const { generated, warnings, skipped } = buildYokiHooksJson([{ hooks: { PreToolUse: [WRAPPER_BASH_HOOK] } }], { home: '/home/exampleperson' });
  assert.deepEqual(generated.tool_call, [
    { kind: 'bash', id: 'git-guard', script: '/home/exampleperson/.claude/hooks/git-guard.sh', matcher: 'bash' },
  ]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(skipped, []);
});

test('buildYokiHooksJson: an unrecognized command is reported as skipped with a reason', () => {
  const { generated, skipped } = buildYokiHooksJson([{ hooks: { PreToolUse: [UNRECOGNIZED_HOOK] } }], { home: '/home/exampleperson' });
  assert.equal(generated.tool_call, undefined);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].target, 'omp');
  assert.match(skipped[0].command, /osascript/);
  assert.match(skipped[0].reason, /not portable/);
});

test('buildYokiHooksJson: a hook under an event omp has no equivalent for is listed as skipped, not just warned', () => {
  const { skipped } = buildYokiHooksJson([{ hooks: { SubagentStop: [WRAPPER_BASH_HOOK] } }], { home: '/home/exampleperson' });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].event, 'SubagentStop');
  assert.match(skipped[0].reason, /no known omp equivalent/);
});

test('translateMatcher: Write|Edit|MultiEdit -> write|edit (deduped, order-independent)', () => {
  assert.equal(translateMatcher('Write|Edit|MultiEdit'), 'write|edit');
  assert.equal(translateMatcher('Edit|Write|MultiEdit'), 'write|edit');
  assert.equal(translateMatcher('Bash'), 'bash');
  assert.equal(translateMatcher('WebFetch|WebSearch'), 'web_search'); // WebFetch has no omp tool
  assert.equal(translateMatcher('Workflow'), null);
});

test('translateToolsList: unmappable-only list -> undefined (omit tools: key)', () => {
  assert.deepEqual(translateToolsList(['Read', 'Grep']), ['read', 'grep']);
  assert.equal(translateToolsList(['NotebookRead']), undefined);
  assert.equal(translateToolsList(undefined), undefined);
});

// ---------------------------------------------------------------------------
// omp-config-yml.js
// ---------------------------------------------------------------------------

const TEMPLATE = [
  'tools:',
  '  approvalMode: yolo',
  '  approval:',
  '    eval: prompt',
  '',
  'modelRoles:',
  '  default: anthropic/claude-fable-5',
  '',
  'symbolPreset: unicode',
  'composer:',
  '  shape: box',
  'theme:',
  '  light: light',
  'setupVersion: 2',
  '',
].join('\n');

test('renderConfigYml: bash.patterns and tools.approval come from converted permissions, merged with the template default', () => {
  const converted = {
    bash: { patterns: [{ pattern: 'git push --force *', action: 'deny' }] },
    tools: { approval: { WebSearch: 'allow' } },
    unexpressible: [],
  };
  const { content, warnings } = renderConfigYml({
    templateText: TEMPLATE,
    existingConfigText: null,
    isExistingRegularFile: false,
    convertedPermissions: converted,
    harnessModelsOmp: {},
  });
  assert.equal(warnings.length, 0);
  assert.match(content, /eval: prompt/); // template default preserved
  assert.match(content, /web_search: allow/); // T8-derived, translated
  assert.match(content, /- match: "git push --force \*"\n\s+approval: deny/);
  assert.match(content, /statusLine:\n\s+preset: custom/);
});

test('renderConfigYml: an unmappable tools.approval entry is dropped with a warning, not guessed at', () => {
  const converted = { bash: { patterns: [] }, tools: { approval: { NotebookRead: 'deny' } }, unexpressible: [] };
  const { content, warnings } = renderConfigYml({
    templateText: TEMPLATE, existingConfigText: null, isExistingRegularFile: false,
    convertedPermissions: converted, harnessModelsOmp: {},
  });
  assert.ok(!content.includes('NotebookRead'));
  assert.ok(warnings.some(w => /NotebookRead/.test(w)));
});

test('renderConfigYml: modelRoles gets review/scout from harness-models.json omp entries', () => {
  const converted = { bash: { patterns: [] }, tools: { approval: {} }, unexpressible: [] };
  const { content } = renderConfigYml({
    templateText: TEMPLATE, existingConfigText: null, isExistingRegularFile: false,
    convertedPermissions: converted, harnessModelsOmp: { review: 'anthropic/claude-sonnet-5', scout: 'anthropic/claude-haiku-5' },
  });
  assert.match(content, /modelRoles:\n\s+default: anthropic\/claude-fable-5\n\s+review: anthropic\/claude-sonnet-5\n\s+scout: anthropic\/claude-haiku-5/);
});

test('renderConfigYml: runtime-owned keys are carried over from an existing REGULAR config.yml, not the template', () => {
  const existing = [
    'tools:', '  approvalMode: yolo', '  approval:', '    eval: prompt', '',
    'modelRoles:', '  default: anthropic/claude-fable-5', '',
    'symbolPreset: nerd', 'composer:', '  shape: bubble', 'theme:', '  light: solarized', '  dark: dracula', 'setupVersion: 7', '',
  ].join('\n');
  const converted = { bash: { patterns: [] }, tools: { approval: {} }, unexpressible: [] };
  const { content } = renderConfigYml({
    templateText: TEMPLATE, existingConfigText: existing, isExistingRegularFile: true,
    convertedPermissions: converted, harnessModelsOmp: {},
  });
  assert.match(content, /symbolPreset: nerd/);
  assert.match(content, /shape: bubble/);
  assert.match(content, /light: solarized/);
  assert.match(content, /dark: dracula/);
  assert.match(content, /setupVersion: 7/);
});

test('renderConfigYml: a SYMLINK\'s content is ignored — runtime-owned keys fall back to the template', () => {
  // Simulates the pre-T10 arrangement: the "existing" text is whatever the
  // symlink's target (the old tracked config.yml) happened to hold, but
  // isExistingRegularFile is false because lstat says symlink, not file.
  const existing = 'setupVersion: 999\nsymbolPreset: nerd\n';
  const converted = { bash: { patterns: [] }, tools: { approval: {} }, unexpressible: [] };
  const { content } = renderConfigYml({
    templateText: TEMPLATE, existingConfigText: existing, isExistingRegularFile: false,
    convertedPermissions: converted, harnessModelsOmp: {},
  });
  assert.match(content, /setupVersion: 2/); // template's value, not the symlink target's 999
  assert.match(content, /symbolPreset: unicode/);
});

// ---------------------------------------------------------------------------
// omp-rules-md.js
// ---------------------------------------------------------------------------

test('buildRulesMdBlockContent: only no-paths rules are included, plus the pointer line', () => {
  const ruleFiles = [
    { relPath: 'common/git-workflow.md', absPath: '/fake/git-workflow.md' },
    { relPath: 'go/coding-style.md', absPath: '/fake/coding-style.md' },
  ];
  const texts = {
    '/fake/git-workflow.md': '---\n---\n# Git Workflow\n\nCommit often.',
    '/fake/coding-style.md': '---\npaths:\n  - "**/*.go"\n---\n# Go Style\n\nHandle errors.',
  };
  const content = buildRulesMdBlockContent(ruleFiles, p => texts[p]);
  assert.match(content, /Commit often\./);
  assert.ok(!content.includes('Handle errors.'));
  assert.ok(content.includes(POINTER_LINE));
});

test('applyRulesMdBlock: replaces only the managed block, keeps trailing user content', () => {
  const existing = '<!-- yoki:begin -->\nold\n<!-- yoki:end -->\n\n## My notes\nkeep me';
  const out = applyRulesMdBlock(existing, 'new block');
  assert.match(out, /^<!-- yoki:begin -->\nnew block\n<!-- yoki:end -->/);
  assert.match(out, /## My notes\nkeep me/);
});

// ---------------------------------------------------------------------------
// omp-agents.js
// ---------------------------------------------------------------------------

const AGENT_MD = '---\nname: architect\ndescription: Architecture specialist\ntools: ["Read", "Grep", "NotebookRead"]\nmodel: sonnet\n---\n\nDesign things.';

test('agentMarkdownToOmp: frontmatter translated (model tier, tools list), body copied verbatim as the prompt', () => {
  const out = agentMarkdownToOmp('architect', AGENT_MD, { sonnet: 'anthropic/claude-sonnet-5' });
  assert.match(out, /^---\nname: architect\n/);
  assert.match(out, /description: "Architecture specialist"/);
  assert.match(out, /model: anthropic\/claude-sonnet-5/);
  assert.match(out, /tools: \[read, grep\]/); // NotebookRead dropped, not guessed at
  assert.match(out, /---\n\nDesign things\./);
});

test('agentMarkdownToOmp: an agent with no mappable tools and no model tier omits both keys', () => {
  const md = '---\nname: claude-worker\ndescription: external CLI worker\n---\n\nRun claude as a subprocess.';
  const out = agentMarkdownToOmp('claude-worker', md, { sonnet: 'x' });
  assert.ok(!out.includes('tools:'));
  assert.ok(!out.includes('model:'));
  assert.match(out, /Run claude as a subprocess\./);
});

// ---------------------------------------------------------------------------
// omp-mcp.js
// ---------------------------------------------------------------------------

const SAMPLE_MCP_SERVERS = [
  { name: 'codebase-memory-mcp', transport: 'stdio', command: '/Users/exampleperson/bin/codebase-memory-mcp-managed', args: [], env: {}, targets: { claude: false, codex: true, omp: true } },
  {
    name: 'serena',
    transport: 'stdio',
    command: 'uvx',
    args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'claude-code'],
    env: {},
    targets: { claude: false, codex: true, omp: true },
    targetOverrides: {
      omp: { args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'codex'] },
    },
  },
  { name: 'figma-remote', transport: 'http', url: 'https://mcp.figma.com/mcp', env: {}, targets: { claude: true, codex: false, omp: false } },
];

test('buildMcpJson: task T13 canonical servers (targets.omp === true), foreign entries preserved', () => {
  const existing = { mcpServers: { 'my-custom-server': { type: 'stdio', command: 'foo' } } };
  const result = buildMcpJson(existing, SAMPLE_MCP_SERVERS);
  assert.equal(result.mcpServers['my-custom-server'].command, 'foo'); // untouched
  assert.equal(result.mcpServers['codebase-memory-mcp'].command, '/Users/exampleperson/bin/codebase-memory-mcp-managed');
  assert.equal(result.mcpServers.serena.command, 'uvx');
  assert.ok(result.mcpServers.serena.args.includes('serena-agent==1.5.3'));
  assert.ok(result.mcpServers.serena.args.includes('codex')); // omp targetOverrides applied
  assert.ok(!('figma-remote' in result.mcpServers)); // targets.omp === false, excluded
  assert.ok(!('$schema' in result));
});

// ---------------------------------------------------------------------------
// End-to-end: plan() + gen.apply() over a synthetic fixture, entirely
// inside a tmp dir (never touches the real home or the real dotfiles repo).
// ---------------------------------------------------------------------------

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixtureRepo(root) {
  const core = path.join(root, 'core');
  const personal = path.join(root, 'personal');

  writeFile(path.join(core, 'settings.layer.json'), JSON.stringify({ hooks: { PreToolUse: [RUNNER_HOOK] } }));
  writeFile(path.join(core, 'permissions.yaml'), 'allow:\n  - pattern: "WebSearch"\ndeny:\n  - pattern: "Bash(git push --force *)"\ndefaultMode: auto\n');
  writeFile(path.join(core, 'harness-models.json'), JSON.stringify({ omp: { sonnet: 'anthropic/claude-sonnet-5', review: 'anthropic/claude-sonnet-5', scout: 'anthropic/claude-haiku-5' } }));
  writeFile(path.join(core, 'agents', 'go-reviewer.md'), '---\nname: go-reviewer\ndescription: Go reviewer\nmodel: sonnet\ntools: ["Read", "Grep"]\n---\n\nReview Go code.');
  writeFile(path.join(core, 'agents', 'python-reviewer.md'), '---\nname: python-reviewer\ndescription: Python reviewer\n---\n\nReview Python code.');
  writeFile(path.join(core, 'rules', 'common', 'git-workflow.md'), '---\n---\n# Git Workflow\n\nCommit often.');
  writeFile(path.join(core, 'rules', 'go', 'coding-style.md'), '---\npaths:\n  - "**/*.go"\n---\n# Go Style\n\nHandle errors.');
  writeFile(path.join(core, 'mcp.json'), JSON.stringify({
    schemaVersion: 'ecc.mcp.v1',
    servers: SAMPLE_MCP_SERVERS,
  }));

  writeFile(path.join(personal, 'settings.personal.json'), JSON.stringify({ hooks: {} }));
  writeFile(path.join(personal, 'permissions.yaml'), 'allow: []\ndeny: []\ndefaultMode: auto\n');

  // The repo-relative sources omp.js reads via dotfilesRoot rather than
  // --sources: config.yml.template and extensions/yoki-bridge.ts.
  writeFile(path.join(root, 'domains', 'dev', 'config', 'omp', 'config.yml.template'), TEMPLATE);
  writeFile(path.join(root, 'domains', 'dev', 'config', 'omp', 'extensions', 'yoki-bridge.ts'), '// yoki-bridge\n');

  return { core, personal };
}

function makeTmpDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-gen-fixture-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-gen-home-'));
  return { root, home, out: path.join(home, '.omp', 'agent') };
}

test('end-to-end: plan()+apply() writes every artifact and replaces a symlinked config.yml with a real file', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);

    // Pre-seed ~/.omp/agent/config.yml as a symlink into "the repo" — the
    // exact arrangement this generator must replace.
    const repoConfigYml = path.join(root, 'domains', 'dev', 'config', 'omp', 'config.yml');
    writeFile(repoConfigYml, TEMPLATE.replace('setupVersion: 2', 'setupVersion: 41'));
    fs.mkdirSync(out, { recursive: true });
    fs.symlinkSync(repoConfigYml, path.join(out, 'config.yml'));

    const planResult = ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} });
    assert.equal(planResult.target, 'omp');
    assert.equal(planResult.home, home);
    assert.ok(planResult.operations.some(op => op.kind === 'remove' && op.destinationPath === path.join(out, 'config.yml')));

    gen.apply(planResult);

    // (1) config.yml is now a real file (not a symlink), runtime-owned keys
    // were NOT carried from the symlink's target (it wasn't a regular file)
    // so setupVersion falls back to the template's own value.
    const configStat = fs.lstatSync(path.join(out, 'config.yml'));
    assert.equal(configStat.isSymbolicLink(), false);
    const configYml = fs.readFileSync(path.join(out, 'config.yml'), 'utf8');
    assert.match(configYml, /setupVersion: 2\b/);
    assert.match(configYml, /web_search: allow/); // WebSearch allow from permissions.yaml
    assert.match(configYml, /- match: "git push --force \*"\n\s+approval: deny/);
    assert.match(configYml, /review: anthropic\/claude-sonnet-5/);

    // Re-running now carries the just-written setupVersion forward.
    fs.writeFileSync(path.join(out, 'config.yml'), configYml.replace('setupVersion: 2', 'setupVersion: 3'));
    const secondPlan = ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} });
    assert.ok(!secondPlan.operations.some(op => op.kind === 'remove')); // no longer a symlink
    gen.apply(secondPlan);
    assert.match(fs.readFileSync(path.join(out, 'config.yml'), 'utf8'), /setupVersion: 3/);

    // (2) yoki-hooks.json
    const hooksJson = JSON.parse(fs.readFileSync(path.join(out, 'yoki-hooks.json'), 'utf8'));
    assert.equal(hooksJson.tool_call[0].matcher, 'bash');
    assert.equal(hooksJson.tool_call[0].timeout, 5000);

    // (3) RULES.md
    const rulesMd = fs.readFileSync(path.join(out, 'RULES.md'), 'utf8');
    assert.match(rulesMd, /Commit often\./);
    assert.ok(!rulesMd.includes('Handle errors.'));
    assert.ok(rulesMd.includes(POINTER_LINE));

    // (4) agents: claude-profiles agent is rendered.
    const goReviewer = fs.readFileSync(path.join(out, 'agents', 'go-reviewer.md'), 'utf8');
    assert.match(goReviewer, /Review Go code\./);

    // (5) extensions/yoki-bridge.ts symlink
    assert.equal(
      fs.readlinkSync(path.join(out, 'extensions', 'yoki-bridge.ts')),
      path.join(root, 'domains', 'dev', 'config', 'omp', 'extensions', 'yoki-bridge.ts'),
    );

    // (6) mcp.json (T13): canonical targets.omp === true servers, resolved
    // against `home`, claude-only server (figma-remote) excluded.
    const mcpJson = JSON.parse(fs.readFileSync(path.join(out, 'mcp.json'), 'utf8'));
    assert.equal(mcpJson.mcpServers['codebase-memory-mcp'].command, '/Users/exampleperson/bin/codebase-memory-mcp-managed');
    assert.ok(mcpJson.mcpServers.serena.args.includes('codex'));
    assert.ok(!('figma-remote' in mcpJson.mcpServers));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('gen.js CLI plan(): --target omp --dry-run --json shape has target/out/sources/operations/warnings/skipped', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const planResult = gen.plan({ target: 'omp', sources: [core, personal], out, home, dotfilesRoot: root, env: {} });
    assert.equal(planResult.target, 'omp');
    assert.equal(planResult.out, out);
    assert.ok(Array.isArray(planResult.sources));
    assert.ok(Array.isArray(planResult.operations) && planResult.operations.length > 0);
    assert.ok(Array.isArray(planResult.warnings));
    assert.ok(Array.isArray(planResult.skipped));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Manifest / --prune parity with codex.js (review finding: omp wrote no
// manifest at all, so a renamed or deleted agent left a stale
// ~/.omp/agent/agents/<old>.md behind forever and --prune was a silent no-op).
// ---------------------------------------------------------------------------

test('apply() writes .yoki/omp-manifest.json listing only the per-agent outputs', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    gen.apply(ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} }));

    const manifestPath = path.join(out, ompTarget.MANIFEST_RELATIVE_PATH);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(
      new Set(manifest),
      new Set([path.join(out, 'agents', 'go-reviewer.md'), path.join(out, 'agents', 'python-reviewer.md')]),
      'merged singletons (config.yml/RULES.md/yoki-hooks.json/mcp.json/extensions) are never prune candidates'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--prune removes an agent whose source layer no longer provides it, and nothing else', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    gen.apply(ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} }));
    assert.ok(fs.existsSync(path.join(out, 'agents', 'go-reviewer.md')));

    // The pack that shipped go-reviewer.md is disabled / the file renamed.
    fs.rmSync(path.join(core, 'agents', 'go-reviewer.md'));

    const pruned = ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {}, prune: true });
    assert.deepEqual(
      pruned.operations.filter(op => op.kind === 'remove').map(op => op.destinationPath),
      [path.join(out, 'agents', 'go-reviewer.md')]
    );
    gen.apply(pruned);

    assert.equal(fs.existsSync(path.join(out, 'agents', 'go-reviewer.md')), false);
    assert.ok(fs.existsSync(path.join(out, 'agents', 'python-reviewer.md')));
    assert.ok(fs.existsSync(path.join(out, 'config.yml')));
    assert.ok(fs.existsSync(path.join(out, 'RULES.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--prune with no manifest yet is a no-op, not an error', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    const planResult = ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {}, prune: true });
    assert.deepEqual(planResult.operations.filter(op => op.kind === 'remove'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--prune refuses a tampered manifest that points outside out, and deletes nothing', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    gen.apply(ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} }));

    const victim = path.join(home, 'Documents');
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, 'thesis.txt'), 'important', 'utf8');

    const manifestPath = path.join(out, ompTarget.MANIFEST_RELATIVE_PATH);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify([...manifest, victim]), 'utf8');

    assert.throws(
      () => ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {}, prune: true }),
      /Refusing to prune/
    );
    assert.ok(fs.existsSync(path.join(victim, 'thesis.txt')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the personal layer bash guards survive plan()+apply() into yoki-hooks.json', () => {
  const { root, home, out } = makeTmpDirs();
  try {
    const { core, personal } = buildFixtureRepo(root);
    writeFile(
      path.join(personal, 'settings.personal.json'),
      JSON.stringify({ hooks: { PreToolUse: [WRAPPER_BASH_HOOK], Notification: [UNRECOGNIZED_HOOK_GROUP] } })
    );

    const planResult = ompTarget.plan({ sources: [core, personal], out, home, dotfilesRoot: root, env: {} });
    gen.apply(planResult);

    const hooksJson = JSON.parse(fs.readFileSync(path.join(out, 'yoki-hooks.json'), 'utf8'));
    const guards = hooksJson.tool_call.filter(spec => spec.kind === 'bash');
    assert.equal(guards.length, 1, 'the personal git-guard must reach omp, not be dropped');
    assert.equal(guards[0].id, 'git-guard');
    assert.match(guards[0].script, /\.claude\/hooks\/git-guard\.sh$/);

    // and the untranslatable one is reported, not silently gone
    assert.ok(planResult.skipped.some(e => /osascript/.test(e.command)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
