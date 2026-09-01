'use strict';

/**
 * Model resolution: precedence (per-call > run default), tier lookup, the
 * misspelled-tier error, `--model-map`, and the fact that the RESOLVED id —
 * not the tier a script typed — is what every event and journal line
 * carries.
 *
 * Isolated state per test — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const models = require('../models');
const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { Journal } = require('../journal');

const MAP = {
  codex: { haiku: 'gpt-5.4-mini', sonnet: 'gpt-5.5', opus: 'gpt-5.6-sol' },
  omp: {
    _comment: 'documentation, not a tier',
    haiku: 'anthropic/claude-haiku-5',
    sonnet: 'anthropic/claude-sonnet-5',
    review: 'anthropic/claude-sonnet-5',
  },
};

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-models-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-models-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-models-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  mockBackend.clearFixtureCache();
  return Promise.resolve(fn(cwd)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    mockBackend.clearFixtureCache();
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

test('a tier resolves to the backend\'s own model id, and reports the tier it came from', () => {
  const resolved = models.resolve('codex', 'sonnet', { harnessModels: MAP });
  assert.deepEqual(resolved, { id: 'gpt-5.5', tier: 'sonnet', source: 'tier' });
  assert.equal(models.resolve('omp', 'haiku', { harnessModels: MAP }).id, 'anthropic/claude-haiku-5');
  // A harness-specific role key is a tier too — the map file is the list.
  assert.equal(models.resolve('omp', 'review', { harnessModels: MAP }).tier, 'review');
});

test('a concrete model id passes straight through', () => {
  for (const id of ['gpt-5.5', 'anthropic/claude-sonnet-5', 'gpt-5.4-mini', 'o3-pro']) {
    const resolved = models.resolve('codex', id, { harnessModels: MAP });
    assert.equal(resolved.id, id, id);
    assert.equal(resolved.tier, null);
    assert.equal(resolved.source, 'literal');
  }
});

test('a misspelled tier is an ERROR listing the valid ones, not a pass-through', () => {
  // The failure this prevents: `--model sonnett` reaching `codex -m sonnett`
  // and failing far from the typo.
  assert.throws(
    () => models.resolve('codex', 'sonnett', { harnessModels: MAP }),
    (err) => {
      assert.match(err.message, /unknown model tier "sonnett" for backend codex/);
      assert.match(err.message, /valid tiers: haiku, opus, sonnet/);
      assert.match(err.message, /--model-map/);
      return true;
    },
  );
  // A tier that exists for another backend is still unknown for this one.
  assert.throws(() => models.resolve('codex', 'review', { harnessModels: MAP }), /unknown model tier "review"/);
});

test('the tier list omits documentation keys from the map file', () => {
  assert.equal(models.tierList(models.mapFor('omp', {}, MAP)), 'haiku, review, sonnet');
  assert.equal(models.isTierKey('_comment'), false);
});

test('a backend with no map validates nothing — everything passes through', () => {
  const resolved = models.resolve('mock', 'sonnet', { harnessModels: MAP });
  assert.equal(resolved.id, 'sonnet');
  assert.equal(resolved.source, 'literal');
  assert.doesNotThrow(() => models.resolve('mock', 'whatever', { harnessModels: MAP }));
});

test('an absent model resolves to the empty default, not an error', () => {
  assert.deepEqual(models.resolve('codex', undefined, { harnessModels: MAP }), { id: '', tier: null, source: 'default' });
  assert.deepEqual(models.resolve('codex', '   ', { harnessModels: MAP }), { id: '', tier: null, source: 'default' });
});

test('looksLikeTier separates a bare word from every real model id', () => {
  for (const tier of ['haiku', 'sonnet', 'opus', 'review', 'scout']) {
    assert.equal(models.looksLikeTier(tier), true, tier);
  }
  for (const id of ['gpt-5.5', 'anthropic/claude-sonnet-5', 'o3', 'claude-3-5']) {
    assert.equal(models.looksLikeTier(id), false, id);
  }
});

// ---------------------------------------------------------------------------
// --model-map
// ---------------------------------------------------------------------------

test('parseModelMap reads <tier>=<id> pairs and rejects a malformed one', () => {
  assert.deepEqual(
    models.parseModelMap('haiku=gpt-5.4-mini, sonnet = gpt-5.5 '),
    { haiku: 'gpt-5.4-mini', sonnet: 'gpt-5.5' },
  );
  assert.deepEqual(models.parseModelMap(''), {});
  assert.throws(() => models.parseModelMap('haiku'), /not <tier>=<model-id>/);
  assert.throws(() => models.parseModelMap('=gpt-5.5'), /not <tier>=<model-id>/);
  assert.throws(() => models.parseModelMap('haiku='), /not <tier>=<model-id>/);
});

test('--model-map overrides the file map for one run, and can add a tier the file lacks', () => {
  const overrides = { sonnet: 'gpt-5.5-preview', turbo: 'gpt-6' };
  assert.equal(models.resolve('codex', 'sonnet', { overrides, harnessModels: MAP }).id, 'gpt-5.5-preview');
  assert.equal(models.resolve('codex', 'sonnet', { overrides, harnessModels: MAP }).source, 'model-map');
  assert.equal(models.resolve('codex', 'turbo', { overrides, harnessModels: MAP }).id, 'gpt-6');
  // Untouched tiers still come from the file.
  assert.equal(models.resolve('codex', 'opus', { overrides, harnessModels: MAP }).id, 'gpt-5.6-sol');
});

// ---------------------------------------------------------------------------
// End to end: precedence and visibility
// ---------------------------------------------------------------------------

const TWO_CALLS = `export const meta = { name: 'm', description: 'd', phases: [{ title: 'A' }, { title: 'B' }] }
phase('A')
const a = await agent('one', { label: 'a' })
phase('B')
const b = await agent('two', { label: 'b', model: 'opus' })
return [a, b]`;

test('a per-call model beats the run default, and both are reported as RESOLVED ids', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'm.js');
  fs.writeFileSync(scriptPath, TWO_CALLS);

  const events = [];
  const seen = [];
  const realRun = mockBackend.run;
  mockBackend.run = async (params) => { seen.push(params.model); return realRun(params); };
  let result;
  try {
    result = await runner.executeScript({
      scriptPath, args: {}, backendName: 'codex', cwd, dryRun: true,
      model: 'sonnet', emit: (e) => events.push(e),
    });
  } finally {
    mockBackend.run = realRun;
  }
  assert.equal(result.status, 'ok', result.error);

  const starts = events.filter((e) => e.type === 'agent-start');
  assert.deepEqual(starts.map((e) => e.label), ['a', 'b']);
  // The run default resolved through the map...
  assert.equal(starts[0].model, 'gpt-5.5');
  assert.equal(starts[0].modelTier, 'sonnet');
  assert.equal(starts[0].backend, 'codex');
  // ...and the per-call model won for the second.
  assert.equal(starts[1].model, 'gpt-5.6-sol');
  assert.equal(starts[1].modelTier, 'opus');
}));

test('the resolved model reaches the backend, the journal and the agent-end event', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'm.js');
  fs.writeFileSync(scriptPath, TWO_CALLS);

  const events = [];
  const seen = [];
  const realRun = mockBackend.run;
  mockBackend.run = async (params) => { seen.push(params.model); return realRun(params); };
  let result;
  try {
    result = await runner.executeScript({
      scriptPath, args: {}, backendName: 'mock', cwd, model: 'sonnet',
      modelMap: { sonnet: 'pinned-sonnet-id', opus: 'pinned-opus-id' },
      emit: (e) => events.push(e),
    });
  } finally {
    mockBackend.run = realRun;
  }
  assert.equal(result.status, 'ok', result.error);
  assert.deepEqual(seen, ['pinned-sonnet-id', 'pinned-opus-id'], 'the backend gets the id, not the tier');

  const entries = new Journal(result.runId).readAll();
  assert.deepEqual(entries.map((e) => e.model), ['pinned-sonnet-id', 'pinned-opus-id']);
  assert.deepEqual(entries.map((e) => e.backend), ['mock', 'mock']);
  assert.deepEqual(
    events.filter((e) => e.type === 'agent-end').map((e) => e.model),
    ['pinned-sonnet-id', 'pinned-opus-id'],
  );
}));

test('the run reports a per-model table of calls, tokens and wall time', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'm.js');
  fs.writeFileSync(scriptPath, TWO_CALLS);
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, model: 'sonnet',
  });
  assert.equal(result.status, 'ok', result.error);
  const byModel = result.byModel;
  assert.deepEqual(byModel.map((r) => r.model).sort(), ['opus', 'sonnet']);
  for (const row of byModel) {
    assert.equal(row.calls, 1);
    assert.ok(row.tokens > 0, 'a call with no reported usage still gets its estimate');
    assert.equal(typeof row.wallMs, 'number');
  }
  // run.json carries it too, so `status` can print the same table later.
  assert.deepEqual(runner.readRunMeta(result.runId).byModel, byModel);
}));

test('an unknown run-level tier fails the run before any agent is dispatched', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'bad.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'bad', description: 'd' }
return await agent('one', { label: 'a' })`);
  const events = [];
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'codex', cwd, model: 'sonnett', emit: (e) => events.push(e),
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /unknown model tier "sonnett"/);
  assert.equal(events.some((e) => e.type === 'agent-start'), false, 'nothing may be dispatched');
}));
