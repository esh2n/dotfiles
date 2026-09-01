'use strict';

/**
 * MP1: a per-call `agent(prompt, {backend})` override, so ONE run can mix
 * codex and omp lanes.
 *
 * The tests stub each real backend's `run()` (the only part that would spawn
 * a process) and assert what the shared machinery around it did: which
 * backend each call actually landed on, that the resolved model came from
 * THAT backend's tier map rather than the run's, that the journal and the
 * event stream report it per call, that the concurrency limiter stayed one
 * semaphore across backends, and that usage/budget accounting is per call.
 *
 * State isolation follows runner.test.js's helper: YOKI_STATE_HOME for the
 * journal, YOKI_GRAPH_GUARD_STATE_DIR for the daily-cap counter that the
 * real workflow-guard.sh hook shares.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const backends = require('../backends');
const codexBackend = require('../backends/codex');
const ompBackend = require('../backends/omp');
const { Journal } = require('../journal');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-mb-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-mb-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-mb-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  delete require.cache[require.resolve('../journal')];
  delete require.cache[require.resolve('../guard')];
  return Promise.resolve(fn(cwd)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    delete require.cache[require.resolve('../journal')];
    delete require.cache[require.resolve('../guard')];
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

function writeScript(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

/**
 * Replace `run()` on the two REAL backends with a recorder. Nothing is
 * spawned; each returns a canned envelope in that backend's own raw shape so
 * its own `extractText`/`extractUsage` still do the real work.
 */
function stubRealBackends(onCall = () => {}) {
  const calls = [];
  const originals = new Map();
  for (const backend of [codexBackend, ompBackend]) {
    originals.set(backend, backend.run);
    backend.run = async ({ prompt, model, opts = {} }) => {
      calls.push({ backend: backend.name, model, label: opts.label, prompt });
      await onCall({ backend: backend.name, label: opts.label });
      // Each backend's own envelope shape, so extractUsage is exercised for
      // real rather than bypassed.
      const raw = backend.name === 'codex'
        ? [
          JSON.stringify({ type: 'item.completed', item: { text: `answer from ${backend.name}` } }),
          JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 } }),
        ].join('\n')
        : JSON.stringify({
          text: `answer from ${backend.name}`,
          usage: { input: 5, output: 7, cacheRead: 3, cacheWrite: 0, totalTokens: 15 },
        });
      return { raw, stderr: '', durationMs: 1, exitCode: 0 };
    };
  }
  return {
    calls,
    restore() { for (const [backend, run] of originals) backend.run = run; },
  };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('the backend registry resolves the three real names and refuses claude by name', () => {
  assert.equal(backends.loadBackend('codex').name, 'codex');
  assert.equal(backends.loadBackend('omp').name, 'omp');
  assert.equal(backends.loadBackend('mock').name, 'mock');
  assert.throws(() => backends.loadBackend('claude'), /native Workflow tool/);
  assert.throws(() => backends.loadBackend('nope'), /unknown backend "nope"/);
  // runner.js re-exports the same function, so every existing caller and
  // test keeps reaching it there.
  assert.equal(runner.loadBackend, backends.loadBackend);
});

// ---------------------------------------------------------------------------
// Mixing backends in one run
// ---------------------------------------------------------------------------

const MIXED_SCRIPT = `export const meta = { name: 'mixed', description: 'one run, two backends', phases: [{ title: 'Fan' }] }
phase('Fan')
const out = await parallel([
  () => agent('run on the run default', { label: 'default-lane' }),
  () => agent('run on codex', { label: 'codex-lane', backend: 'codex', model: 'sonnet' }),
  () => agent('run on omp', { label: 'omp-lane', backend: 'omp', model: 'sonnet' }),
])
return out
`;

test('a per-call {backend} overrides the run backend, and both land in one run', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'mixed.js', MIXED_SCRIPT);
  const stub = stubRealBackends();
  const events = [];
  try {
    const result = await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd,
      emit: (e) => events.push(e),
    });
    assert.equal(result.status, 'ok', result.error);

    // The run default stayed mock (nothing spawned, no stub call for it);
    // the two overrides reached the real backends' run().
    assert.deepEqual(stub.calls.map((c) => c.backend).sort(), ['codex', 'omp']);

    const starts = events.filter((e) => e.type === 'agent-start');
    const byLabel = new Map(starts.map((e) => [e.label, e]));
    assert.equal(byLabel.get('default-lane').backend, 'mock');
    assert.equal(byLabel.get('codex-lane').backend, 'codex');
    assert.equal(byLabel.get('omp-lane').backend, 'omp');
  } finally {
    stub.restore();
  }
}));

test('the model is resolved against the CALL\'s backend, not the run\'s', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'mixed.js', MIXED_SCRIPT);
  const stub = stubRealBackends();
  try {
    await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd,
      // Two different ids for the SAME tier, one per backend: if resolution
      // used the run backend (mock, which has no map), both calls would get
      // the literal string "sonnet" instead.
      harnessModelsOverride: undefined,
      modelMap: {},
      model: undefined,
    });
  } finally {
    stub.restore();
  }
  // The real core/harness-models.json maps `sonnet` per backend; whatever
  // the ids are, the two backends must not have been handed the bare tier.
  const codexCall = stub.calls.find((c) => c.backend === 'codex');
  const ompCall = stub.calls.find((c) => c.backend === 'omp');
  assert.notEqual(codexCall.model, 'sonnet', 'codex was handed the raw tier name');
  assert.notEqual(ompCall.model, 'sonnet', 'omp was handed the raw tier name');
  assert.notEqual(codexCall.model, ompCall.model, 'both backends resolved `sonnet` to the same id — the map was not per backend');
}));

test('the journal records the per-call backend, and usageByModel splits the run by backend', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'mixed.js', MIXED_SCRIPT);
  const stub = stubRealBackends();
  let runId;
  try {
    ({ runId } = await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd,
    }));
  } finally {
    stub.restore();
  }
  const entries = new Journal(runId).readAll();
  const backendsSeen = entries.filter((e) => e.status === 'ok').map((e) => e.backend).sort();
  assert.deepEqual(backendsSeen, ['codex', 'mock', 'omp']);

  const rows = new Journal(runId).usageByModel();
  assert.equal(rows.length, 3, 'one row per backend+model pair');
  const codexRow = rows.find((r) => r.backend === 'codex');
  // codex's stub reported input 100 + output 20; the 60 cached tokens are a
  // subset of the input and are reported separately, never added.
  assert.equal(codexRow.tokens, 120);
  assert.equal(codexRow.cached, 60);
  const ompRow = rows.find((r) => r.backend === 'omp');
  // omp's own totalTokens (15) includes its disjoint cacheRead.
  assert.equal(ompRow.tokens, 15);
  assert.equal(ompRow.cached, 3);
}));

test('mixed backends share ONE concurrency semaphore, not one each', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'mixed.js', `export const meta = { name: 'fan', description: 'six lanes over two backends', phases: [{ title: 'Fan' }] }
phase('Fan')
const lanes = []
for (let i = 0; i < 3; i += 1) {
  lanes.push(() => agent('c' + i, { label: 'codex-' + i, backend: 'codex', model: 'sonnet' }))
  lanes.push(() => agent('o' + i, { label: 'omp-' + i, backend: 'omp', model: 'sonnet' }))
}
return parallel(lanes)
`);
  let inFlight = 0;
  let peak = 0;
  const stub = stubRealBackends(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => { setTimeout(r, 5); });
    inFlight -= 1;
  });
  try {
    const result = await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd, concurrency: 2,
    });
    assert.equal(result.status, 'ok', result.error);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 6);
  assert.ok(peak <= 2, `concurrency 2 was exceeded across backends (peak ${peak}) — the limiter is per backend, not per run`);
}));

test('an unknown per-call backend is FATAL, not a lane that quietly returns null', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'bad.js', `export const meta = { name: 'bad', description: 'typo in a per-call backend', phases: [{ title: 'A' }] }
phase('A')
return parallel([() => agent('x', { label: 'typo', backend: 'codexx' })])
`);
  const result = await runner.executeScript({
    scriptPath: script, args: {}, backendName: 'mock', cwd,
  });
  // parallel() swallows a lane failure into null by contract — but a
  // misspelled backend is a script bug that would look identical to "that
  // provider found nothing" in every lane at once.
  assert.equal(result.status, 'error');
  assert.match(result.error, /unknown backend "codexx"/);
}));

// ---------------------------------------------------------------------------
// Budget accounting across backends
// ---------------------------------------------------------------------------

test('every backend\'s calls count against the SAME agent-call cap', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'cap.js', `export const meta = { name: 'cap', description: 'four calls over three backends', phases: [{ title: 'A' }] }
phase('A')
await agent('1', { label: 'a', backend: 'codex', model: 'sonnet' })
await agent('2', { label: 'b', backend: 'omp', model: 'sonnet' })
await agent('3', { label: 'c' })
await agent('4', { label: 'd', backend: 'codex', model: 'sonnet' })
return 'done'
`);
  const stub = stubRealBackends();
  try {
    const result = await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd, maxAgentCalls: 3,
    });
    assert.equal(result.status, 'error');
    assert.match(result.error, /agent\(\) call cap reached \(3\/3\)/);
  } finally {
    stub.restore();
  }
  // The cap stopped the FOURTH call: two codex/omp calls plus the mock one
  // were already charged, so the counter is shared, not per backend.
  assert.equal(stub.calls.length, 2);
}));

test('tokens from every backend accumulate into one run total', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'tok.js', `export const meta = { name: 'tok', description: 'one codex + one omp call', phases: [{ title: 'A' }] }
phase('A')
await agent('1', { label: 'a', backend: 'codex', model: 'sonnet' })
await agent('2', { label: 'b', backend: 'omp', model: 'sonnet' })
return 'done'
`);
  const stub = stubRealBackends();
  let usage;
  try {
    ({ usage } = await runner.executeScript({
      scriptPath: script, args: {}, backendName: 'mock', cwd,
    }));
  } finally {
    stub.restore();
  }
  // codex 120 (100 input + 20 output, cached excluded) + omp 15.
  assert.equal(usage.reportedTokens, 135);
  assert.equal(usage.estimatedTokens, 0);
  assert.equal(usage.cachedTokens, 63); // 60 codex (subset) + 3 omp (disjoint)
}));

// ---------------------------------------------------------------------------
// The resume key
// ---------------------------------------------------------------------------

test('changing a call\'s backend or resolved model breaks the resume replay', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'r.js', `export const meta = { name: 'r', description: 'one call', phases: [{ title: 'A' }] }
phase('A')
return agent('same prompt', { label: 'only' })
`);
  const first = await runner.executeScript({
    scriptPath: script, args: {}, backendName: 'mock', cwd, model: 'model-a',
  });
  assert.equal(first.status, 'ok');

  // Control first: an unchanged rerun still replays, so any miss below is
  // the model change and not a key that simply became unstable.
  const same = [];
  await runner.executeScript({
    scriptPath: script, args: {}, backendName: 'mock', cwd,
    runId: first.runId, model: 'model-a', emit: (e) => same.push(e),
  });
  assert.equal(same.filter((e) => e.type === 'agent-cached').length, 1);
  assert.equal(same.filter((e) => e.type === 'agent-start').length, 0);

  // Same script, same prompt, same opts — but pointed at another model.
  const events = [];
  const changed = await runner.executeScript({
    scriptPath: script, args: {}, backendName: 'mock', cwd,
    runId: first.runId, model: 'model-b', emit: (e) => events.push(e),
  });
  assert.equal(changed.status, 'ok');
  assert.equal(events.filter((e) => e.type === 'agent-cached').length, 0,
    'a result produced by model-a was replayed for a run targeting model-b');
  assert.equal(events.filter((e) => e.type === 'agent-start').length, 1);
}));

test('a resumed call that switched backend re-runs instead of replaying', () => withIsolatedState(async (cwd) => {
  const script = writeScript(cwd, 'rb.js', `export const meta = { name: 'rb', description: 'one call whose backend the args pick', phases: [{ title: 'A' }] }
phase('A')
return agent('same prompt', { label: 'only', backend: (args && args.backend) || 'mock', model: 'sonnet' })
`);
  const stub = stubRealBackends();
  try {
    const first = await runner.executeScript({
      scriptPath: script, args: { backend: 'codex' }, backendName: 'mock', cwd,
    });
    assert.equal(first.status, 'ok', first.error);

    const events = [];
    await runner.executeScript({
      scriptPath: script, args: { backend: 'omp' }, backendName: 'mock', cwd,
      runId: first.runId, emit: (e) => events.push(e),
    });
    assert.equal(events.filter((e) => e.type === 'agent-cached').length, 0,
      'codex\'s answer was replayed for a call now routed to omp');
    assert.equal(events.filter((e) => e.type === 'agent-start')[0].backend, 'omp');
  } finally {
    stub.restore();
  }
}));
