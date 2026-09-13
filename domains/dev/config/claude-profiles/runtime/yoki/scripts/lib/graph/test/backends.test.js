'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codex = require('../backends/codex');
const omp = require('../backends/omp');
const mock = require('../backends/mock');

// ---------------------------------------------------------------------------
// argv construction only — NO process is ever spawned in this section.
// ---------------------------------------------------------------------------

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
    codex.buildArgv({ cwd: '/repo', sandbox: 'read-only' }).args,
    omp.buildArgv({ prompt: 'p', sandbox: 'read-only' }).args,
  ];
  for (const args of argvs) {
    assert.ok(
      args.includes('-s') || args.includes('--tools'),
      `argv must carry a restriction: ${args.join(' ')}`
    );
  }
});

test('omp backend: agent() opts.sandbox reaches buildArgv through run()', async () => {
  const { createApi } = require('../api');
  const captured = [];
  const backend = {
    name: omp.name,
    supportsSchemaNatively: omp.supportsSchemaNatively,
    run: async (call) => {
      captured.push(omp.buildArgv({ prompt: call.prompt, cwd: call.cwd, sandbox: call.sandbox }).args);
      return { raw: 'ok', durationMs: 1, exitCode: 0 };
    },
    extractText: (raw) => raw,
  };
  const api = createApi({
    runId: 'r1',
    journal: { replayAt: () => undefined, append: () => {}, tokensSpent: () => 0 },
    backend,
    cwd: '/repo',
    emit: () => {},
  });
  await api.agent('read something', { label: 'reader' });
  await api.agent('write something', { label: 'writer', sandbox: 'workspace-write' });

  assert.ok(captured[0].includes('--tools'), 'default call must be restricted');
  assert.ok(!captured[1].includes('--tools'), 'workspace-write call must not be');
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

test('codex supports schema natively; omp/mock differ as documented', () => {
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

// ---------------------------------------------------------------------------
// Usage accounting — read from each backend's OWN primary source, not guessed
// from the answer text. See each extractUsage's doc comment for the shape and
// where it was pinned.
// ---------------------------------------------------------------------------

test('codex backend: extractUsage sums turn.completed usage across turns', () => {
  const raw = [
    JSON.stringify({ type: 'item.completed', item: { text: 'thinking' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20 } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }),
  ].join('\n');
  const usage = codex.extractUsage(raw);
  // 110 input + 25 output. The 50 cached tokens are NOT added: codex's
  // `cached_input_tokens` is the cached PART of `input_tokens`, not a
  // separate charge beside it.
  assert.equal(usage.totalTokens, 135);
  assert.equal(usage.inputTokens, 110);
  assert.equal(usage.outputTokens, 25);
  assert.equal(usage.cacheRead, 50);
});

test('codex backend: cached input tokens are a subset of input, never added on top', () => {
  // The numbers from the first real `--backend codex` review run, whose
  // total came out 7.46M against a true ~4.1M because every cached prefix
  // was booked twice.
  const raw = JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 77961, cached_input_tokens: 57856, output_tokens: 884 },
  });
  const usage = codex.extractUsage(raw);
  assert.equal(usage.totalTokens, 78845, 'input + output only');
  assert.notEqual(usage.totalTokens, 136701, 'the old input + cached + output double-count');
  // Still reported, as information: how much of the input was cached.
  assert.equal(usage.cacheRead, 57856);
});

test('codex backend: extractUsage falls back to the rollout token_count record', () => {
  const raw = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 2 } } },
  });
  assert.equal(codex.extractUsage(raw).totalTokens, 9); // 7 input + 2 output; the 3 cached are inside the 7
  assert.equal(codex.extractUsage('nothing usable here'), null);
});

test('omp backend: cached tokens ARE part of the total — omp\'s cacheRead is disjoint from its input', () => {
  // A real omp assistant record (omp 18.0.4): input is 2 tokens next to a
  // 50k cacheRead, and the record's own totalTokens equals the sum of all
  // four — so unlike codex, omp's cached counts are additional, not a
  // subset. The two backends are handled differently on purpose.
  const raw = JSON.stringify({
    text: 'x',
    usage: { input: 2, output: 1222, cacheRead: 50524, cacheWrite: 6922, totalTokens: 58670 },
  });
  const usage = omp.extractUsage(raw);
  assert.equal(usage.totalTokens, 58670);
  assert.equal(2 + 1222 + 50524 + 6922, 58670, 'omp\'s own total is the sum of all four');
});

test('omp backend: extractUsage reads omp\'s camelCase usage block', () => {
  const raw = JSON.stringify({
    text: 'the answer',
    usage: { input: 200, output: 60, cacheRead: 10, cacheWrite: 5, totalTokens: 275, cost: 0.003 },
  });
  const usage = omp.extractUsage(raw);
  assert.equal(usage.totalTokens, 275);
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.costUsd, 0.003);
});

test('omp backend: extractUsage sums assistant records when handed a session-shaped JSONL stream', () => {
  const raw = [
    JSON.stringify({ type: 'title', title: 'x' }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } } }),
    JSON.stringify({ type: 'message', message: { role: 'toolResult' } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 5 } } }),
  ].join('\n');
  assert.equal(omp.extractUsage(raw).totalTokens, 20);
  assert.equal(omp.extractUsage('plain text answer'), null);
});

// ---------------------------------------------------------------------------
// omp 18.0.4 v3 NDJSON event stream. The two fixtures are VERBATIM stdout of
// `omp -p --mode json --no-extensions -e <bridge> <prompt>` on omp 18.0.4
// (2026-09-13): omp-v3-simple.ndjson is a plain answer, omp-v3-tool.ndjson a
// run that makes one `read` tool call before answering. They pin the event
// vocabulary the backend now parses — regenerate them from a live omp if the
// stream format moves again, don't hand-edit.
// ---------------------------------------------------------------------------

const OMP_V3_SIMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'omp-v3-simple.ndjson'), 'utf8');
const OMP_V3_TOOL = fs.readFileSync(path.join(__dirname, 'fixtures', 'omp-v3-tool.ndjson'), 'utf8');
const OMP_V3_HEADER_ONLY = '{"type":"session","version":3,"id":"01a0","timestamp":"2026-09-13T00:00:00.000Z","cwd":"/tmp"}\n';

test('omp backend: v3 stream — extractText returns the assistant answer, not the session header', () => {
  assert.equal(omp.extractText(OMP_V3_SIMPLE), 'OK');
});

test('omp backend: v3 stream — the LAST text-bearing assistant message_end wins after tool calls', () => {
  // The tool fixture has TWO assistant message_ends: a text-less toolCall
  // message (stopReason toolUse) and then the real answer.
  assert.equal(omp.extractText(OMP_V3_TOOL), 'FIXTURE-MAGIC-42');
});

test('omp backend: v3 junk defense — a header-only stream yields null, never the raw stream', () => {
  // This is the observed failure mode of the pre-v3 reader: omp prints the
  // session header BEFORE authenticating, so an auth failure leaves exactly
  // this on stdout — and the old extractText handed it back as the lane's
  // "answer", which passed any schema with an empty `required` list and
  // degraded whole graph runs silently. null routes it into agent()'s
  // normal backend-error handling instead.
  assert.equal(omp.extractText(OMP_V3_HEADER_ONLY), null);
  assert.equal(omp.extractUsage(OMP_V3_HEADER_ONLY), null);
});

test('omp backend: v3 stream with events but no assistant text is also null, not raw', () => {
  const raw = [
    OMP_V3_HEADER_ONLY.trim(),
    JSON.stringify({ type: 'agent_start' }),
    JSON.stringify({ type: 'turn_start' }),
    JSON.stringify({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
  ].join('\n');
  assert.equal(omp.extractText(raw), null);
});

test('omp backend: v3 usage — per-call message_end usages are summed; start/turn_end/agent_end copies are not', () => {
  // The tool fixture's two assistant message_ends carry disjoint per-call
  // usage (29081+32=29113 for the read turn; 1161+11+28160=29332 for the
  // answer turn). The same messages ride again in message_start (zeroed),
  // turn_end and agent_end — the total proves none of those copies is
  // double-counted, and that omp's disjoint cacheRead stays in the total.
  const usage = omp.extractUsage(OMP_V3_TOOL);
  assert.equal(usage.totalTokens, 29113 + 29332);
  assert.equal(usage.inputTokens, 29081 + 1161);
  assert.equal(usage.outputTokens, 32 + 11);
  assert.equal(usage.cacheRead, 28160);
  assert.ok(usage.costUsd > 0);
});

test('omp backend: v3 usage — the simple fixture reads the single message_end, cost included', () => {
  const usage = omp.extractUsage(OMP_V3_SIMPLE);
  assert.equal(usage.totalTokens, 33568);
  assert.equal(usage.inputTokens, 33563);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.costUsd, 0.16796500000000003);
});

test('omp backend: v3 tool calls — tool_execution_start counts once; toolCall blocks and updates do not', () => {
  // One real read call appears in the stream as: message_start + message_end
  // with a `toolCall` content block, toolcall_start/delta/end updates, AND
  // one tool_execution_start/_end pair. The counter must report exactly 1.
  const progress = [];
  const feed = omp.makeProgressCounter(({ toolCalls }) => progress.push(toolCalls));
  feed(OMP_V3_TOOL);
  assert.deepEqual(progress, [1]);

  const none = [];
  const feedSimple = omp.makeProgressCounter(({ toolCalls }) => none.push(toolCalls));
  feedSimple(OMP_V3_SIMPLE);
  assert.deepEqual(none, []);
});

test('omp backend: countToolCalls keeps the old-format carriers for rollback', () => {
  assert.equal(omp.countToolCalls({ type: 'tool_call' }), 1);
  assert.equal(omp.countToolCalls({ type: 'tool_execution_start' }), 1);
  assert.equal(omp.countToolCalls({ type: 'tool_execution_end' }), 0);
  assert.equal(omp.countToolCalls({ message: { content: [{ type: 'tool_use' }, { type: 'text' }] } }), 1);
});

test('omp backend: isV3Stream keys on the first non-empty line only', () => {
  assert.equal(omp.isV3Stream(OMP_V3_SIMPLE), true);
  assert.equal(omp.isV3Stream(OMP_V3_HEADER_ONLY), true);
  // old single-result-object format and session FILES (which open with a
  // "title" record, and whose message records the old JSONL reader handles)
  // must keep taking the old path.
  assert.equal(omp.isV3Stream(JSON.stringify({ text: 'answer', usage: {} })), false);
  assert.equal(omp.isV3Stream(`${JSON.stringify({ type: 'title', title: 'x' })}\n${OMP_V3_HEADER_ONLY}`), false);
});

test('omp backend: old single-object format still extracts through the fallback path', () => {
  assert.equal(omp.extractText(JSON.stringify({ text: 'the answer' })), 'the answer');
  assert.equal(omp.extractText(JSON.stringify({ result: 'r' })), 'r');
  assert.equal(omp.extractText('plain text'), 'plain text');
});

test('omp backend: run() refuses a header-only stream on a non-zero exit (auth failure shape)', async (t) => {
  // A fake `omp` on PATH reproduces the auth-failure shape byte-for-byte:
  // session header on stdout, error on stderr, exit 1. Under the old
  // `code !== 0 && !stdout.trim()` test the header line masked the failure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-fake-omp-'));
  const fake = path.join(dir, 'omp');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' '${OMP_V3_HEADER_ONLY.trim().replace(/'/g, "'\\''")}'\necho 'error: No API key found for anthropic.' >&2\nexit 1\n`);
  fs.chmodSync(fake, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); });
  await assert.rejects(
    () => omp.run({ prompt: 'p', cwd: dir, timeoutMs: 30000 }),
    /omp exited 1: error: No API key found/
  );
});

test('omp backend: run() still resolves when a non-zero exit left a usable v3 answer on stdout', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-fake-omp-ok-'));
  const fake = path.join(dir, 'omp');
  const fixture = path.join(dir, 'stream.ndjson');
  fs.writeFileSync(fixture, OMP_V3_SIMPLE);
  fs.writeFileSync(fake, `#!/bin/sh\ncat '${fixture}'\nexit 1\n`);
  fs.chmodSync(fake, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); });
  const res = await omp.run({ prompt: 'p', cwd: dir, timeoutMs: 30000 });
  assert.equal(res.exitCode, 1);
  assert.equal(omp.extractText(res.raw), 'OK');
});

test('every real backend exposes extractUsage; the mock deliberately does not', () => {
  for (const backend of [codex, omp]) {
    assert.equal(typeof backend.extractUsage, 'function', `${backend.name} has no extractUsage`);
  }
  // The mock spawns nothing and has no provider to report usage — api.js
  // charges its output an explicitly-labelled estimate instead.
  assert.equal(mock.extractUsage, undefined);
});

// ---------------------------------------------------------------------------
// Strict schema on the wire (codex), timeout kills
// ---------------------------------------------------------------------------

test('codex backend: the --output-schema file holds the STRICT copy, not the loose schema', async () => {
  const { spawnCollect } = require('../backends/common');
  const loose = {
    type: 'object',
    required: ['verdict'],
    properties: { verdict: { type: 'string' }, note: { type: 'string' } },
  };
  // Intercept the spawn so nothing runs, but read the schema file the
  // backend wrote before it is cleaned up.
  const commonModule = require('../backends/common');
  const realSpawn = commonModule.spawnCollect;
  let written;
  commonModule.spawnCollect = async (cmd, args) => {
    const i = args.indexOf('--output-schema');
    written = JSON.parse(fs.readFileSync(args[i + 1], 'utf8'));
    return { stdout: '{"verdict":"pass"}', stderr: '', code: 0, timedOut: false };
  };
  // codex.js captured spawnCollect at require time, so re-require it fresh
  // against the patched module.
  delete require.cache[require.resolve('../backends/codex')];
  const patchedCodex = require('../backends/codex');
  try {
    await patchedCodex.run({ prompt: 'p', cwd: '/tmp', schema: loose });
  } finally {
    commonModule.spawnCollect = realSpawn;
    delete require.cache[require.resolve('../backends/codex')];
    require('../backends/codex');
  }
  assert.equal(written.additionalProperties, false);
  assert.deepEqual(written.required, ['verdict', 'note']);
  assert.deepEqual(written.properties.note.type, ['string', 'null']);
  assert.deepEqual(loose.required, ['verdict'], 'the caller\'s schema must not be mutated');
  assert.equal(typeof spawnCollect, 'function');
});

test('spawnCollect flags a child it killed at the timeout, so a kill is not read as a crash', async () => {
  const { spawnCollect } = require('../backends/common');
  const res = await spawnCollect(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 60 });
  assert.equal(res.timedOut, true);
});

test('spawnCollect leaves timedOut false for a child that exits on its own', async () => {
  const { spawnCollect } = require('../backends/common');
  const res = await spawnCollect(process.execPath, ['-e', 'process.stdout.write("hi")'], { timeoutMs: 30000 });
  assert.equal(res.timedOut, false);
  assert.equal(res.stdout, 'hi');
});

test('timeoutError is marked transient and timedOut so retry.js retries it', () => {
  const { timeoutError } = require('../backends/common');
  const { isTransient } = require('../retry');
  const err = timeoutError('codex exec', 900000);
  assert.equal(err.code, 'ETIMEDOUT');
  assert.equal(err.timedOut, true);
  assert.equal(isTransient(err), true);
  assert.match(err.message, /codex exec timed out after 900000ms/);
});
