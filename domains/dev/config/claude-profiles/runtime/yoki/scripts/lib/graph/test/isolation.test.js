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
