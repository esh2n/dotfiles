'use strict';

/**
 * D4: the workflow body runs in a `node:worker_threads` Worker whose code sets
 * up a `node:vm` context, NOT in the host realm. These tests pin the three
 * properties the old in-process AsyncFunction could not provide
 * (comparison.md §2-7/§2-8):
 *
 *   1. Determinism is non-bypassable — a body that reassigns `globalThis.Date`
 *      or tries to restore `Math.random` cannot reach a live clock, and cannot
 *      touch the host's Date/Math (a separate thread).
 *   2. A runaway body is KILLABLE — a `while (true) {}` that never yields is
 *      terminated by the wall-time cap, and an idle body by the watchdog; both
 *      surface as an ordinary run error rather than a hung process.
 *   3. The vm has no host built-ins — no `require`, `process`, `module` or
 *      `Buffer`, and its `globalThis` is its own, not the host's.
 *
 * The 7 globals working ACROSS the RPC boundary (agent result, parallel
 * ordering, pipeline threading, phase/log/budget/workflow, schema, resume,
 * gate, caps) is already proven end to end by test/api-surface.test.js,
 * test/scripts.test.js, test/resume.test.js and test/budget.test.js — all of
 * which now execute through this worker path via runner.executeScript.
 *
 * Isolated state per test — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { runBodyInWorker } = require('../worker-host');
const { Journal } = require('../journal');

/** Run `fn` with the mock backend's run() delayed by `delayMs` per call, so a
 *  script that makes real agent() calls takes measurable wall time — the setup
 *  the idle-watchdog reset tests need (the vm has no setTimeout of its own). */
async function withSlowMock(delayMs, fn) {
  const real = mockBackend.run;
  mockBackend.run = async (params) => {
    await new Promise((r) => setTimeout(r, delayMs));
    return real(params);
  };
  try {
    return await fn();
  } finally {
    mockBackend.run = real;
  }
}

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-isolation-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-isolation-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-isolation-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  return Promise.resolve(fn(cwd)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
    fs.rmSync(stateHome, { recursive: true, force: true });
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
}

function writeScript(cwd, name, body) {
  const scriptPath = path.join(cwd, name);
  fs.writeFileSync(scriptPath, `export const meta = { name: '${name.replace(/\.js$/, '')}', description: 'd' }\n${body}`);
  return scriptPath;
}

// ---------------------------------------------------------------------------
// 1. Determinism is non-bypassable
// ---------------------------------------------------------------------------

test('a body cannot bypass the Date/Math determinism policy, and cannot reach the host clock', () => withIsolatedState(async (cwd) => {
  // A live host clock BEFORE the run, so we can prove the body did not disturb
  // the host realm's Date/Math (they are on a different thread entirely).
  const hostNowBefore = Date.now();
  const hostRandom = Math.random;

  const scriptPath = writeScript(cwd, 'determinism.js', `
    const out = {}
    try { out.now = Date.now() } catch (e) { out.now = 'threw' }
    try { out.argless = new Date().getTime() } catch (e) { out.argless = 'threw' }
    try { out.rand = Math.random() } catch (e) { out.rand = 'threw' }
    // Attempt 1: reassign the realm global out from under the lexical shadow.
    globalThis.Date = function () { return { getTime: () => 42 } }
    try { out.afterReassign = Date.now() } catch (e) { out.afterReassign = 'threw' }
    // Attempt 2: put Math.random back.
    try { Math.random = () => 0.5 } catch (e) { /* frozen: strict throw or silent no-op */ }
    try { out.mathRestored = Math.random() } catch (e) { out.mathRestored = 'threw' }
    // The allowed operations still work.
    out.fixedYear = new Date(2020, 0, 1).getFullYear()
    out.mathMax = Math.max(3, 7)
    return out
  `);

  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.now, 'threw', 'Date.now() must throw');
  assert.equal(result.result.argless, 'threw', 'argless new Date() must throw');
  assert.equal(result.result.rand, 'threw', 'Math.random() must throw');
  assert.equal(result.result.afterReassign, 'threw', 'reassigning globalThis.Date must not reach a live clock');
  assert.equal(result.result.mathRestored, 'threw', 'Math.random must not be restorable — Math is frozen');
  assert.equal(result.result.fixedYear, 2020, 'new Date(x) must still work');
  assert.equal(result.result.mathMax, 7, 'non-random Math must still work');

  // The host realm is untouched: its Date advanced normally and its Math.random
  // is still the real one.
  assert.ok(Date.now() >= hostNowBefore, 'the host clock kept working');
  assert.equal(Math.random, hostRandom, 'the host Math.random is unchanged');
  assert.equal(typeof Math.random(), 'number', 'the host Math.random still works');
}));

test('no prototype/constructor walk from the exposed Date reaches a live clock', () => withIsolatedState(async (cwd) => {
  // The exact bypass strings from the review: `Date.prototype.constructor` and
  // an instance's `.constructor` both used to name the unrestricted real Date,
  // recovering a live clock while `Date.now()`/argless `new Date()` throw.
  const scriptPath = writeScript(cwd, 'ctor.js', `
    const out = {}
    try { out.protoCtor = new Date.prototype.constructor().getTime() } catch (e) { out.protoCtor = 'threw' }
    try { out.instCtor = new (new Date(2020, 0, 1)).constructor().getTime() } catch (e) { out.instCtor = 'threw' }
    // The prototype's constructor back-reference must be the restricted shadow,
    // not a second live clock, and an instance must resolve to the same.
    out.protoCtorIsDate = (Date.prototype.constructor === Date)
    out.instCtorIsDate = (new Date(2020, 0, 1).constructor === Date)
    // Object.getPrototypeOf walk from an instance lands on Date.prototype, whose
    // constructor is the shadow — one more argless construction attempt.
    try {
      const proto = Object.getPrototypeOf(new Date(2020, 0, 1))
      out.getProtoCtor = new proto.constructor().getTime()
    } catch (e) { out.getProtoCtor = 'threw' }
    // A legitimate parse still works after all the tampering above.
    out.parsed = new Date('2020-01-01T00:00:00Z').getUTCFullYear()
    out.fromMs = new Date(0).getUTCFullYear()
    return out
  `);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.protoCtor, 'threw', 'new Date.prototype.constructor() must not reach a live clock');
  assert.equal(result.result.instCtor, 'threw', 'new (new Date(x)).constructor() must not reach a live clock');
  assert.equal(result.result.getProtoCtor, 'threw', 'getPrototypeOf(...).constructor must not reach a live clock');
  assert.equal(result.result.protoCtorIsDate, true, 'Date.prototype.constructor must be the restricted Date');
  assert.equal(result.result.instCtorIsDate, true, 'an instance.constructor must be the restricted Date');
  assert.equal(result.result.parsed, 2020, 'new Date(string) must still parse');
  assert.equal(result.result.fromMs, 1970, 'new Date(ms) must still work');
}));

test('Math cannot be un-frozen or reached via constructor/getPrototypeOf to recover live randomness', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'mathwalk.js', `
    const out = {}
    // Math is a namespace object; its constructor chain leads only to Object,
    // never to a fresh live Math.random.
    try { out.ctorRandom = Math.constructor.random ? Math.constructor.random() : 'no-random' } catch (e) { out.ctorRandom = 'threw' }
    try { out.protoRandom = (Object.getPrototypeOf(Math).random ? Object.getPrototypeOf(Math).random() : 'no-random') } catch (e) { out.protoRandom = 'threw' }
    // Direct call still throws; frozen so it cannot be put back.
    try { out.direct = Math.random() } catch (e) { out.direct = 'threw' }
    out.ctorIsObject = (Math.constructor === Object)
    return out
  `);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.direct, 'threw', 'Math.random() must throw');
  assert.equal(result.result.ctorRandom, 'no-random', 'Math.constructor must not carry a live random');
  assert.equal(result.result.protoRandom, 'no-random', 'getPrototypeOf(Math) must not carry a live random');
  assert.equal(result.result.ctorIsObject, true, 'Math.constructor is Object, not a live-random source');
}));

// ---------------------------------------------------------------------------
// 2. Killability
// ---------------------------------------------------------------------------

test('an infinite while(true){} body is killed by the wall-time cap and reported as a run error', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'spin.js', 'while (true) {}\nreturn 1');
  const started = Date.now();
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd,
    // A tight loop makes no agent() call, so the in-agent cap never runs — only
    // the worker-level terminator can stop this. Small so CI never hangs.
    maxWallMs: 200,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'error');
  assert.match(result.error, /wall-clock cap reached/);
  assert.ok(elapsed < 5000, `the run should have been killed quickly, took ${elapsed}ms`);
}));

test('an idle body making no agent activity is killed by the run-level watchdog', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'idle.js', 'await new Promise(() => {})\nreturn 1');
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd,
    idleTimeoutMs: 200,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /idle watchdog/);
}));

test('an actively-progressing body is NOT killed by the idle watchdog: agent() traffic resets it', () => withIsolatedState(async (cwd) => {
  // Five agent() calls at 120ms each ≈ 600ms of wall time, well past the 350ms
  // idle window — but each call re-arms the watchdog (handleAgent's armIdle), so
  // no single gap between activity exceeds it and the run completes. If that
  // reset regressed (armIdle dropped from handleAgent), the spawn-time timer
  // would fire mid-run and this would fail.
  const scriptPath = writeScript(cwd, 'busy.js', `
    let n = 0
    for (let i = 0; i < 5; i++) { await agent('work ' + i, { label: 'w' + i }); n += 1 }
    return n
  `);
  const result = await withSlowMock(120, () => runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, idleTimeoutMs: 350,
  }));
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result, 5);
}));

test('a workflow() call re-arms the idle watchdog so a nested child making progress is not killed', async () => {
  // Directly at the worker-host seam (no child-spawn timing variance): a stub
  // api whose agent() and workflow() each take ~200ms. With a 350ms idle window,
  // the warmup agent() consumes most of one window; the workflow() must open a
  // FRESH window (handleWorkflow's armIdle) or the timer from the warmup fires
  // into the still-progressing workflow and kills the run (warmup+workflow ≈
  // 400ms > 350ms, while each single leg stays under the window).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = {
    agent: async () => { await sleep(200); return 'agent-ok'; },
    workflow: async () => { await sleep(200); return 'child-done'; },
    phase: () => {},
    log: () => {},
  };
  const journal = { spent: () => 0, tokensSpent: () => 0, append() {} };
  const body = "await agent('warmup', { label: 'w' }); const r = await workflow('child'); return r";
  const result = await runBodyInWorker({
    body, api, args: {}, budgetTotal: null, journal, idleTimeoutMs: 350,
  });
  assert.equal(result, 'child-done');
});

test('phase()->agent() attribution survives the RPC boundary: each call carries its ambient phase', () => withIsolatedState(async (cwd) => {
  // phase() is a fire-and-forget emit and agent() is a separate call across the
  // MessagePort; the emit-before-call order must make agent() read the phase set
  // just before it. Assert it on both the agent-start events and the journal.
  const scriptPath = writeScript(cwd, 'phases.js', `
    phase('A')
    await agent('one', { label: 'a' })
    phase('B')
    await agent('two', { label: 'b' })
    return 1
  `);
  const events = [];
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e),
  });
  assert.equal(result.status, 'ok', result.error);

  const startA = events.find((e) => e.type === 'agent-start' && e.label === 'a');
  const startB = events.find((e) => e.type === 'agent-start' && e.label === 'b');
  assert.equal(startA.phase, 'A', "the first call's agent-start must be tagged phase A");
  assert.equal(startB.phase, 'B', "the second call's agent-start must be tagged phase B");

  const entries = new Journal(result.runId).readAll().filter((e) => e.status === 'ok');
  const entryA = entries.find((e) => e.label === 'a');
  const entryB = entries.find((e) => e.label === 'b');
  assert.equal(entryA.phase, 'A', "the first call's journal entry must record phase A");
  assert.equal(entryB.phase, 'B', "the second call's journal entry must record phase B");
}));

test('an explicit abort terminates the worker and ends the run as an error, not a crash', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'abortme.js', 'while (true) {}\nreturn 1');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, signal: controller.signal,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /aborted/);
}));

test('a signal already aborted at call time ends the run as an error, not a crash', () => withIsolatedState(async (cwd) => {
  // The worker's error/exit listeners are attached before the pre-aborted
  // early-return, so a startup 'error' in the terminate window cannot escape as
  // an unhandled event and crash the host.
  const scriptPath = writeScript(cwd, 'prealtorted.js', 'while (true) {}\nreturn 1');
  const controller = new AbortController();
  controller.abort();
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, signal: controller.signal,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /aborted/);
}));

// ---------------------------------------------------------------------------
// 3. No host built-ins reachable from the vm
// ---------------------------------------------------------------------------

test('the vm context exposes no require/process/module/Buffer, and its globalThis is not the host', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'sealed.js', `
    return {
      hasRequire: typeof require,
      hasProcess: typeof process,
      hasModule: typeof module,
      hasBuffer: typeof Buffer,
      hasGlobalThis: typeof globalThis,
      globalThisIsHost: (typeof globalThis === 'object' && globalThis && globalThis.process !== undefined),
      canCompile: (function () { try { return typeof (new Function('return 1'))() } catch (e) { return 'threw:' + e.name } })(),
    }
  `);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.hasRequire, 'undefined');
  assert.equal(result.result.hasProcess, 'undefined');
  assert.equal(result.result.hasModule, 'undefined');
  assert.equal(result.result.hasBuffer, 'undefined');
  assert.equal(result.result.hasGlobalThis, 'object', 'the vm has its own globalThis');
  assert.equal(result.result.globalThisIsHost, false, 'the vm globalThis must not be the host');
  // codeGeneration.strings:false makes eval/new Function throw EvalError, so a
  // captured host Function cannot compile anything.
  assert.equal(result.result.canCompile, 'threw:EvalError', 'new Function() must be blocked in the vm');
}));
