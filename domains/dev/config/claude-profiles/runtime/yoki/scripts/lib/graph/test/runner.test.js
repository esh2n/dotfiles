'use strict';

/**
 * Every test in this file sets YOKI_STATE_HOME and YOKI_GRAPH_GUARD_STATE_DIR
 * to throwaway temp directories before touching runner.executeScript — both
 * journal.js and guard.js otherwise read/write real shared state (the
 * journal under ~/.local/state, the daily-cap counter shared with the real
 * workflow-guard.sh hook). See guard.test.js's header comment for why.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { Journal } = require('../journal');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-guarddir-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-cwd-'));
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

// ---------------------------------------------------------------------------
// compileScript / meta extraction
// ---------------------------------------------------------------------------

test('extractMeta parses a pure-literal export const meta, tolerating nested braces/strings', () => {
  const source = `export const meta = {
    name: 'my-flow',
    description: 'does a { thing } with "quotes"',
    phases: [{ title: 'A', detail: 'first' }, { title: 'B' }],
  }
  return 1`;
  const { meta } = runner.extractMeta(source);
  assert.equal(meta.name, 'my-flow');
  assert.equal(meta.phases.length, 2);
});

test('compileScript supports a top-level `return` and top-level `await` (illegal in a real ESM/script)', async () => {
  const source = `export const meta = { name: 'x', description: 'y' }
  const v = await Promise.resolve(41)
  return v + 1`;
  const compiled = runner.compileScript(source);
  const result = await compiled.run({ args: undefined, phase: () => {}, log: () => {}, agent: async () => null, parallel: async (t) => Promise.all(t.map((x) => x())), pipeline: async (items) => items, budget: { total: null }, workflow: async () => {}, Date, Math });
  assert.equal(result, 42);
});

test('compileScript throws a clear error when there is no `export const meta`', () => {
  assert.throws(() => runner.compileScript('return 1'), /no `export const meta/);
});

// ---------------------------------------------------------------------------
// resolveScriptPath / listWorkflows
// ---------------------------------------------------------------------------

test('resolveScriptPath resolves an explicit path even when it is not named like a saved workflow', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-scripts-'));
  const file = writeScript(dir, 'my-thing.js', "export const meta = { name: 'x', description: 'y' }\nreturn 1");
  assert.equal(runner.resolveScriptPath(file, dir), file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveScriptPath throws with both candidate paths named, when nothing matches', () => {
  assert.throws(() => runner.resolveScriptPath('definitely-not-a-real-workflow-xyz', '/tmp'), /not found/);
});

// ---------------------------------------------------------------------------
// executeScript end-to-end (mock backend) + resume
// ---------------------------------------------------------------------------

test('executeScript runs a script end to end against the mock backend', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', `export const meta = { name: 'flow', description: 'd' }
    const r = await agent('hi', { label: 'greet' })
    return { r }`);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ greet: 'hello!' }));
  const events = [];
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture, emit: (e) => events.push(e),
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.result, { r: 'hello!' });
  assert.ok(events.some((e) => e.type === 'run-start'));
  assert.ok(events.some((e) => e.type === 'run-end' && e.status === 'ok'));

  // Regression: every agent() call's journal entry must carry a numeric
  // durationMs (every backend computes and returns it from run()).
  const entries = new Journal(result.runId).readAll();
  const greetEntry = entries.find((e) => e.label === 'greet');
  assert.ok(greetEntry, 'journal must contain the "greet" agent() call');
  assert.equal(greetEntry.status, 'ok');
  assert.equal(typeof greetEntry.durationMs, 'number');
  assert.ok(greetEntry.durationMs >= 0);
}));

test('--resume replays a cached agent() call instead of invoking the backend again', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow2.js', `export const meta = { name: 'flow2', description: 'd' }
    const r = await agent('expensive call', { label: 'once' })
    return { r }`);
  const fixture = path.join(cwd, 'fixture2.json');
  fs.writeFileSync(fixture, JSON.stringify({ once: 'result-A' }));

  let calls = 0;
  const originalRun = mockBackend.run;
  mockBackend.run = async (...a) => { calls += 1; return originalRun(...a); };
  try {
    const first = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture });
    assert.equal(calls, 1);
    assert.equal(first.result.r, 'result-A');

    // Change the fixture so a SECOND real call would return something else —
    // resume must never make that second call.
    fs.writeFileSync(fixture, JSON.stringify({ once: 'result-B-should-never-be-seen' }));
    const resumed = await runner.executeScript({
      scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture, runId: first.runId,
    });
    assert.equal(calls, 1, 'the backend must not be called again on resume');
    assert.equal(resumed.result.r, 'result-A', 'resume must return the ORIGINAL cached result');
    assert.equal(resumed.runId, first.runId);
  } finally {
    mockBackend.run = originalRun;
  }
}));

test('a schema hard-fail (validation never succeeds) fails the whole run with status "error"', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow3.js', `export const meta = { name: 'flow3', description: 'd' }
    const r = await agent('need structured data', { label: 'bad', schema: { type: 'object', required: ['neverProvided'] } })
    return r`);
  const fixture = path.join(cwd, 'fixture3.json');
  fs.writeFileSync(fixture, JSON.stringify({ bad: 'plain text, never valid JSON for the schema' }));
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture });
  assert.equal(result.status, 'error');
  assert.match(result.error, /schema validation failed/);
}));

test('a non-schema backend failure resolves agent() to null rather than failing the run', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow4.js', `export const meta = { name: 'flow4', description: 'd' }
    const r = await agent('no fixture, no schema', { label: 'missing' })
    return { r, wasNull: r === null || typeof r === 'string' }`);
  // No fixture file at all -> mock backend falls back to a placeholder string, not an error.
  // To actually exercise the null-on-failure path, point --mock at an unparseable file.
  const badFixture = path.join(cwd, 'unparseable.json');
  fs.writeFileSync(badFixture, '{ this is not json');
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, mockFile: badFixture });
  assert.equal(result.status, 'ok'); // the SCRIPT still completes...
  assert.equal(result.result.r, null); // ...because agent() resolved to null, not a thrown error
}));

test('--dry-run never invokes the backend and never touches the daily-cap guard', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow5.js', `export const meta = { name: 'flow5', description: 'd' }
    const r = await agent('would cost real money', { label: 'x', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } })
    return r`);
  let calls = 0;
  const originalRun = mockBackend.run;
  mockBackend.run = async (...a) => { calls += 1; return originalRun(...a); };
  const guard = require('../guard');
  const before = guard.readCount(guard.today());
  try {
    const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, dryRun: true });
    assert.equal(calls, 0);
    assert.deepEqual(result.result, { ok: false }); // schema placeholder
    assert.equal(guard.readCount(guard.today()), before, 'dry-run must not consume a guard launch');
  } finally {
    mockBackend.run = originalRun;
  }
}));

test('the daily-cap guard denies a run once the cap is reached', () => withIsolatedState(async (cwd) => {
  process.env.YOKI_WORKFLOW_DAILY_CAP = '1';
  const scriptPath = writeScript(cwd, 'flow6.js', `export const meta = { name: 'flow6', description: 'd' }
    return { r: await agent('p', { label: 'x' }) }`);
  try {
    const first = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
    assert.equal(first.status, 'ok');
    const second = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
    assert.equal(second.status, 'denied');
    assert.match(second.error, /Workflow daily cap reached/);
  } finally {
    delete process.env.YOKI_WORKFLOW_DAILY_CAP;
  }
}));

// ---------------------------------------------------------------------------
// The claude backend was removed: inside Claude Code the native Workflow tool
// is the supported path, so shelling out to `claude -p` was a second,
// unsupported one. The refusal names the alternative instead of reporting an
// unknown value, so a stale `--backend claude` invocation is told what to do.
// ---------------------------------------------------------------------------

test('--backend claude is refused by name, pointing at the native Workflow tool', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'x.js', `export const meta = { name: 'x', description: 'd' }
return 1`);
  await assert.rejects(
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'claude', cwd }),
    (err) => {
      assert.match(err.message, /claude backend was removed/);
      assert.match(err.message, /native Workflow tool/);
      assert.match(err.message, /codex, omp, mock/);
      return true;
    },
  );
  assert.throws(() => runner.loadBackend('claude'), /claude backend was removed/);
  assert.equal(runner.CLAUDE_BACKEND_REFUSAL.includes('native Workflow tool'), true);
}));

test('an unrecognised backend still gets the generic message, listing only what remains', () => {
  assert.throws(() => runner.loadBackend('gemini'), /unknown backend "gemini" \(expected codex\|omp\|mock\)/);
  assert.equal(typeof runner.loadBackend('codex').run, 'function');
  assert.equal(typeof runner.loadBackend('omp').run, 'function');
  assert.equal(typeof runner.loadBackend('mock').run, 'function');
});

test('backends/claude.js is gone from disk, not merely unreferenced', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'backends', 'claude.js')), false);
});
