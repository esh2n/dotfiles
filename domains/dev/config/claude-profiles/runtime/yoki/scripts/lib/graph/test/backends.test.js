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

test('codex backend: base argv shape — --skip-git-repo-check, -C <cwd>, workspace-write, --json, stdin ("-")', () => {
  // a concrete model id (not a haiku/sonnet/opus tier) passes straight
  // through — tier resolution itself is asserted separately below.
  const { cmd, args } = codex.buildArgv({ model: 'gpt-5.1-codex', cwd: '/repo', schema: null, schemaFilePath: null });
  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '-C', '/repo', '-s', 'workspace-write', '--json', '-m', 'gpt-5.1-codex', '-']);
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
