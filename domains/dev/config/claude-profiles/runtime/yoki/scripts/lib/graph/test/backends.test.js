'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const claude = require('../backends/claude');
const codex = require('../backends/codex');
const omp = require('../backends/omp');
const mock = require('../backends/mock');

// ---------------------------------------------------------------------------
// argv construction only — NO process is ever spawned in this section.
// ---------------------------------------------------------------------------

test('claude backend: base argv shape', () => {
  const { cmd, args } = claude.buildArgv({ prompt: 'hello there', model: 'sonnet', cwd: '/tmp' });
  assert.equal(cmd, 'claude');
  assert.deepEqual(args.slice(0, 4), ['-p', 'hello there', '--output-format', 'json']);
  assert.ok(args.includes('--model'));
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
});

test('claude backend: --json-schema is added natively when a schema is given', () => {
  const schema = { type: 'object', required: ['ok'] };
  const { args } = claude.buildArgv({ prompt: 'p', model: 'opus', schema });
  const i = args.indexOf('--json-schema');
  assert.ok(i !== -1);
  assert.deepEqual(JSON.parse(args[i + 1]), schema);
});

test('claude backend: --agent is used for agentType instead of a text preamble', () => {
  const { args } = claude.buildArgv({ prompt: 'p', agentType: 'code-reviewer' });
  const i = args.indexOf('--agent');
  assert.ok(i !== -1);
  assert.equal(args[i + 1], 'code-reviewer');
});

test('claude backend: --effort passed through when given', () => {
  const { args } = claude.buildArgv({ prompt: 'p', effort: 'high' });
  assert.equal(args[args.indexOf('--effort') + 1], 'high');
});

test('claude backend: extractText unwraps the --output-format json envelope', () => {
  assert.equal(claude.extractText('{"type":"result","result":"the answer"}'), 'the answer');
  assert.equal(claude.extractText('not json'), 'not json');
});

test('codex backend: base argv shape — --skip-git-repo-check, -C <cwd>, read-only, --json, stdin ("-")', () => {
  // a concrete model id (not a haiku/sonnet/opus tier) passes straight
  // through — tier resolution itself is asserted separately below.
  const { cmd, args } = codex.buildArgv({ model: 'gpt-5.1-codex', cwd: '/repo', schema: null, schemaFilePath: null });
  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '-C', '/repo', '-s', 'read-only', '--json', '-m', 'gpt-5.1-codex', '-']);
});

// --- sandbox ---------------------------------------------------------------
// The default used to be a hardcoded workspace-write for every call, which
// handed filesystem write authority to review/research/code-study/stocktake
// — whose prompts are built from untrusted material — in the user's own
// checkout. codex exec's own default is read-only; so is this backend's.

test('codex backend: sandbox defaults to codex exec\'s own read-only, not workspace-write', () => {
  const { args } = codex.buildArgv({ cwd: '/repo' });
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.equal(codex.DEFAULT_SANDBOX, 'read-only');
});

test('codex backend: a script that writes asks for it per call', () => {
  const { args } = codex.buildArgv({ cwd: '/repo', sandbox: 'workspace-write' });
  assert.equal(args[args.indexOf('-s') + 1], 'workspace-write');
});

test('codex backend: an unknown sandbox is a hard error, never a silent widening', () => {
  assert.throws(() => codex.buildArgv({ cwd: '/repo', sandbox: 'yolo' }), /unknown sandbox "yolo"/);
  // empty/absent means "use the default", not "pass an empty -s value"
  assert.equal(codex.resolveSandbox(''), 'read-only');
  assert.equal(codex.resolveSandbox(undefined), 'read-only');
});

test('codex backend: agent() opts.sandbox reaches buildArgv through run()', async () => {
  const { createApi } = require('../api');
  const captured = [];
  const backend = {
    name: 'codex',
    supportsSchemaNatively: true,
    run: async (call) => {
      captured.push(codex.buildArgv({ cwd: call.cwd, sandbox: call.sandbox }).args);
      return { raw: 'ok', durationMs: 1, exitCode: 0 };
    },
    extractText: (raw) => raw,
  };
  const api = createApi({
    runId: 'r1',
    journal: { getCached: () => undefined, append: () => {}, tokensSpent: () => 0 },
    backend,
    cwd: '/repo',
    emit: () => {},
  });
  await api.agent('read something', { label: 'reader' });
  await api.agent('write something', { label: 'writer', sandbox: 'workspace-write' });
  assert.equal(captured[0][captured[0].indexOf('-s') + 1], 'read-only');
  assert.equal(captured[1][captured[1].indexOf('-s') + 1], 'workspace-write');
});

// claude and omp used to take no sandbox argument at all: `opts.sandbox` was
// accepted by api.js, passed down, and dropped on the floor — so the
// least-privilege default was a property of the codex backend rather than of
// the graph API. Both now enforce read-only through their own CLI's
// tool-restriction flag.

test('claude backend: sandbox defaults to read-only and denies every write tool', () => {
  assert.equal(claude.DEFAULT_SANDBOX, 'read-only');
  const { args } = claude.buildArgv({ prompt: 'p' });
  const i = args.indexOf('--disallowedTools');
  assert.ok(i !== -1, 'the default must actually restrict the run');
  const denied = args[i + 1].split(',');
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    assert.ok(denied.includes(tool), `${tool} must be denied`);
  }
});

test('claude backend: a script that writes asks for it per call', () => {
  const { args } = claude.buildArgv({ prompt: 'p', sandbox: 'workspace-write' });
  assert.ok(!args.includes('--disallowedTools'));
});

test('claude backend: an unknown sandbox is a hard error, never a silent widening', () => {
  assert.throws(() => claude.buildArgv({ prompt: 'p', sandbox: 'yolo' }), /unknown sandbox "yolo"/);
  assert.equal(claude.resolveSandbox(''), 'read-only');
  assert.equal(claude.resolveSandbox(undefined), 'read-only');
});

test('omp backend: sandbox defaults to read-only via the --tools allow-list', () => {
  assert.equal(omp.DEFAULT_SANDBOX, 'read-only');
  const { args } = omp.buildArgv({ prompt: 'p' });
  const i = args.indexOf('--tools');
  assert.ok(i !== -1, 'the default must actually restrict the run');
  const enabled = args[i + 1].split(',');
  for (const writeTool of ['write', 'edit', 'bash', 'task']) {
    assert.ok(!enabled.includes(writeTool), `${writeTool} must not be enabled read-only`);
  }
  // The bridge extension and the prompt still come last.
  assert.ok(args.includes('--no-extensions'));
  assert.equal(args[args.length - 1], 'p');
});

test('omp backend: a script that writes asks for it per call', () => {
  const { args } = omp.buildArgv({ prompt: 'p', sandbox: 'workspace-write' });
  assert.ok(!args.includes('--tools'));
});

test('omp backend: an unknown sandbox is a hard error, never a silent widening', () => {
  assert.throws(() => omp.buildArgv({ prompt: 'p', sandbox: 'yolo' }), /unknown sandbox "yolo"/);
  assert.equal(omp.resolveSandbox(''), 'read-only');
});

test('every real backend expresses read-only in its argv — none accepts and discards it', () => {
  const argvs = [
    claude.buildArgv({ prompt: 'p', sandbox: 'read-only' }).args,
    codex.buildArgv({ cwd: '/repo', sandbox: 'read-only' }).args,
    omp.buildArgv({ prompt: 'p', sandbox: 'read-only' }).args,
  ];
  for (const args of argvs) {
    assert.ok(
      args.includes('-s') || args.includes('--disallowedTools') || args.includes('--tools'),
      `argv must carry a restriction: ${args.join(' ')}`
    );
  }
});

test('claude/omp backends: agent() opts.sandbox reaches buildArgv through run()', async () => {
  const { createApi } = require('../api');
  for (const backendModule of [claude, omp]) {
    const captured = [];
    const backend = {
      name: backendModule.name,
      supportsSchemaNatively: backendModule.supportsSchemaNatively,
      run: async (call) => {
        captured.push(backendModule.buildArgv({ prompt: call.prompt, cwd: call.cwd, sandbox: call.sandbox }).args);
        return { raw: 'ok', durationMs: 1, exitCode: 0 };
      },
      extractText: (raw) => raw,
    };
    const api = createApi({
      runId: 'r1',
      journal: { getCached: () => undefined, append: () => {}, tokensSpent: () => 0 },
      backend,
      cwd: '/repo',
      emit: () => {},
    });
    await api.agent('read something', { label: 'reader' });
    await api.agent('write something', { label: 'writer', sandbox: 'workspace-write' });

    const restrictionFlag = backendModule === claude ? '--disallowedTools' : '--tools';
    assert.ok(captured[0].includes(restrictionFlag), `${backendModule.name}: default call must be restricted`);
    assert.ok(!captured[1].includes(restrictionFlag), `${backendModule.name}: workspace-write call must not be`);
  }
});

test('codex backend: --output-schema <tmpfile> is added natively when a schema is given', () => {
  const { args } = codex.buildArgv({ model: 'sonnet', cwd: '/repo', schema: { type: 'object' }, schemaFilePath: '/tmp/schema-123.json' });
  const i = args.indexOf('--output-schema');
  assert.ok(i !== -1);
  assert.equal(args[i + 1], '/tmp/schema-123.json');
  assert.equal(args[args.length - 1], '-'); // prompt-on-stdin marker stays last
});

test('codex backend: model tier resolves through core/harness-models.json', () => {
  const { args } = codex.buildArgv({ model: 'opus', cwd: '/repo' });
  const resolved = args[args.indexOf('-m') + 1];
  // Whatever core/harness-models.json currently maps codex.opus to — assert
  // it resolved to something OTHER than the bare Claude-tier name 'opus',
  // proving the lookup happened rather than a pass-through.
  assert.notEqual(resolved, 'opus');
  assert.ok(resolved.length > 0);
});

test('codex backend: extractText picks the last agent_message-shaped JSONL event', () => {
  const raw = [
    JSON.stringify({ msg: { type: 'agent_message', message: 'first' } }),
    'not json, ignored',
    JSON.stringify({ msg: { type: 'agent_message', message: 'final answer' } }),
  ].join('\n');
  assert.equal(codex.extractText(raw), 'final answer');
});

test('omp backend: base argv shape — -p --mode json, --no-extensions, -e <bridge>, prompt last', () => {
  const { cmd, args } = omp.buildArgv({ prompt: 'do the thing', model: 'sonnet' });
  assert.equal(cmd, 'omp');
  assert.deepEqual(args.slice(0, 2), ['-p', '--mode']);
  assert.equal(args[2], 'json');
  assert.ok(args.includes('--no-extensions'));
  const eIdx = args.indexOf('-e');
  assert.ok(eIdx !== -1);
  assert.match(args[eIdx + 1], /yoki-bridge\.ts$/);
  assert.equal(args[args.length - 1], 'do the thing');
});

test('omp backend: supportsSchemaNatively is false — no schema/output-schema flag exists', () => {
  assert.equal(omp.supportsSchemaNatively, false);
  const { args } = omp.buildArgv({ prompt: 'p', model: 'sonnet' });
  assert.ok(!args.some((a) => /schema/i.test(a)));
});

test('omp backend: agentType folds into the prompt as a preamble (no --agent flag exists)', () => {
  const { args } = omp.buildArgv({ prompt: 'the task', agentType: 'general-purpose' });
  const finalPrompt = args[args.length - 1];
  assert.match(finalPrompt, /general-purpose agent/);
  assert.match(finalPrompt, /the task$/);
});

test('claude/codex both support schema natively; omp/mock differ as documented', () => {
  assert.equal(claude.supportsSchemaNatively, true);
  assert.equal(codex.supportsSchemaNatively, true);
  assert.equal(omp.supportsSchemaNatively, false);
  assert.equal(mock.supportsSchemaNatively, true);
});

// ---------------------------------------------------------------------------
// mock backend: full end-to-end, no process spawned, no network
// ---------------------------------------------------------------------------

test('mock backend: returns the fixture entry keyed by label', async () => {
  const file = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-mock-')) + '/fixture.json';
  fs.writeFileSync(file, JSON.stringify({ 'my-label': { answer: 42 } }));
  mock.clearFixtureCache();
  const { raw } = await mock.run({ prompt: 'irrelevant', opts: { label: 'my-label' }, mockFile: file });
  assert.deepEqual(JSON.parse(raw), { answer: 42 });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('mock backend: falls back to a schema-satisfying placeholder for a missing label', async () => {
  mock.clearFixtureCache();
  const schema = { type: 'object', required: ['angles'], properties: { angles: { type: 'array' } } };
  const { raw, hit } = await mock.run({ prompt: 'p', opts: { label: 'not-in-fixture' }, schema, mockFile: undefined });
  assert.equal(hit, false);
  const parsed = JSON.parse(raw);
  assert.ok('angles' in parsed);
});

test('mock backend: falls back to a placeholder string when there is no schema either', async () => {
  mock.clearFixtureCache();
  const { raw } = await mock.run({ prompt: 'p', opts: { label: 'nope' }, mockFile: undefined });
  assert.match(raw, /nope/);
});

test('mock backend: a malformed --mock file raises a clear error', async () => {
  const file = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-mock-bad-'));
  const f = path.join(file, 'bad.json');
  fs.writeFileSync(f, '{ not valid json');
  mock.clearFixtureCache();
  await assert.rejects(() => mock.run({ prompt: 'p', opts: { label: 'x' }, mockFile: f }), /not valid JSON/);
  fs.rmSync(file, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveAgentPreamble: the file-based lookup branch
// ---------------------------------------------------------------------------
// Only the BUILTIN_PREAMBLES branch had ever been asserted. The other branch —
// the layered <dir>/<type>.md lookup that review.js's per-lane specialization
// actually depends on — was executed by the script tests but asserted by
// nothing, and a miss there degrades silently to '' rather than erroring.
// YOKI_AGENT_DIRS replaces the discovered layers so these are hermetic.

const common = require('../backends/common');

function withAgentDirs(dirsByName, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-agents-'));
  const dirs = [];
  for (const [layer, files] of Object.entries(dirsByName)) {
    const dir = path.join(root, layer);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    dirs.push(dir);
  }
  try {
    return fn({ YOKI_AGENT_DIRS: dirs.join(path.delimiter) }, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('resolveAgentPreamble: a built-in name never touches the filesystem', () => {
  withAgentDirs({ personal: { 'Explore.md': 'SHOULD NOT BE READ' } }, (env) => {
    assert.equal(common.resolveAgentPreamble('Explore', env), common.BUILTIN_PREAMBLES.Explore);
  });
  assert.equal(common.resolveAgentPreamble('', {}), '');
  assert.equal(common.resolveAgentPreamble(undefined, {}), '');
});

test('resolveAgentPreamble: finds <dir>/<type>.md and strips its YAML frontmatter', () => {
  withAgentDirs({
    core: {
      'code-reviewer.md': '---\nname: code-reviewer\ndescription: reviews code\ntools: Read, Grep\n---\n\nYou review code for correctness.\n',
    },
  }, (env) => {
    const preamble = common.resolveAgentPreamble('code-reviewer', env);
    assert.equal(preamble, 'You review code for correctness.');
    assert.doesNotMatch(preamble, /description:/); // frontmatter really gone
  });
});

test('resolveAgentPreamble: the earlier layer wins a name collision (personal over core)', () => {
  withAgentDirs({
    personal: { 'reviewer.md': '---\nname: reviewer\n---\nPERSONAL VERSION' },
    core: { 'reviewer.md': '---\nname: reviewer\n---\nCORE VERSION' },
  }, (env) => {
    assert.equal(common.resolveAgentPreamble('reviewer', env), 'PERSONAL VERSION');
  });
});

test('resolveAgentPreamble: falls through to a later layer when the earlier one lacks the file', () => {
  withAgentDirs({
    personal: { 'other.md': 'irrelevant' },
    core: { 'reviewer.md': 'CORE ONLY' },
  }, (env) => {
    assert.equal(common.resolveAgentPreamble('reviewer', env), 'CORE ONLY');
  });
});

test('resolveAgentPreamble: an unknown agent type degrades to "" rather than throwing', () => {
  withAgentDirs({ core: { 'reviewer.md': 'x' } }, (env) => {
    assert.equal(common.resolveAgentPreamble('no-such-agent-xyz', env), '');
  });
  // a nonexistent directory in the list is skipped, not fatal
  assert.equal(common.resolveAgentPreamble('anything', { YOKI_AGENT_DIRS: '/definitely/not/here' }), '');
});

test('stripFrontmatter: only a leading block is stripped, and a body without one is untouched', () => {
  assert.equal(common.stripFrontmatter('---\na: 1\n---\nbody'), 'body');
  assert.equal(common.stripFrontmatter('no frontmatter\n---\nnot a block\n'), 'no frontmatter\n---\nnot a block\n');
});

test('agentDirs: YOKI_AGENT_DIRS replaces the discovered layers, order preserved', () => {
  assert.deepEqual(common.agentDirs({ YOKI_AGENT_DIRS: `/a${path.delimiter}/b` }), ['/a', '/b']);
  // unset -> the real layered list, starting with ~/.claude/agents
  assert.equal(common.agentDirs({})[0], path.join(os.homedir(), '.claude', 'agents'));
});

test('omp backend: a file-defined agentType folds its stripped body into the prompt', () => {
  withAgentDirs({
    core: { 'my-agent.md': '---\nname: my-agent\n---\nYOU ARE A SPECIALIST.' },
  }, (env) => {
    const preamble = common.resolveAgentPreamble('my-agent', env);
    assert.equal(preamble, 'YOU ARE A SPECIALIST.');
    // omp.js composes exactly `${preamble}\n\n${prompt}` (asserted here
    // against the resolved preamble rather than re-running buildArgv with a
    // process-level env override).
    assert.equal(`${preamble}\n\nthe task`, 'YOU ARE A SPECIALIST.\n\nthe task');
  });
});
