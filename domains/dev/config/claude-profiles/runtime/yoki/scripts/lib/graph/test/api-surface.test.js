'use strict';

/**
 * API surface smoke test: one inline workflow that touches every global
 * documented in API.md (args, phase, log, agent() with every opts key,
 * parallel, pipeline, budget, workflow, and the restricted Date/Math), run
 * end to end through runner.executeScript against the mock backend.
 *
 * Uses isolated state dirs — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const runner = require('../runner');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-apisurf-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-apisurf-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-apisurf-cwd-'));
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

function sh(cmd, args, cwd) { execFileSync(cmd, args, { cwd, stdio: 'pipe' }); }

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-apisurf-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  sh('git', ['add', 'README.md'], dir);
  sh('git', ['commit', '-q', '-m', 'init'], dir);
  return dir;
}

const SMOKE_WORKFLOW = `export const meta = {
  name: 'smoke',
  description: 'exercises every documented global',
  phases: [{ title: 'Plan' }, { title: 'Work' }],
}
log('starting: ' + JSON.stringify(args))
phase('Plan')
const plan = await agent('plan something', {
  label: 'plan', phase: 'Plan', model: 'sonnet', effort: 'high',
  schema: { type: 'object', required: ['angles'], properties: { angles: { type: 'array', items: { type: 'string' } } } },
})
phase('Work')
const piped = await pipeline(
  plan.angles,
  (a) => agent('work on ' + a, { label: 'work:' + a }),
  (r, item) => agent('verify ' + item, { label: 'verify:' + item, schema: { type: 'object', required: ['holds'], properties: { holds: { type: 'boolean' } } } }),
)
const par = await parallel([
  () => agent('parallel A', { label: 'parA', agentType: 'general-purpose' }),
  () => agent('parallel B', { label: 'parB', isolation: 'worktree' }),
])
const child = await workflow({ scriptPath: args.childPath }, { n: 21 })
return {
  plan, piped, par, child,
  budgetTotal: budget.total,
  budgetRemainingIsInfinity: budget.remaining() === Infinity,
  dateMathStillWork: { max: Math.max(1, 2), fixedDate: new Date(2020, 0, 1).getFullYear() },
}`;

const CHILD_WORKFLOW = `export const meta = { name: 'child', description: 'nested one level' }
return args.n * 2`;

test('every documented global works together in one script (mock backend, no execution cost)', () => withIsolatedState(async (cwd) => {
  const repo = makeTempRepo();
  try {
    const scriptPath = path.join(cwd, 'smoke.js');
    fs.writeFileSync(scriptPath, SMOKE_WORKFLOW);
    const childPath = path.join(cwd, 'child.js');
    fs.writeFileSync(childPath, CHILD_WORKFLOW);

    const fixture = path.join(cwd, 'fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({
      plan: { angles: ['alpha', 'beta'] },
      'work:alpha': 'did alpha',
      'work:beta': 'did beta',
      'verify:alpha': { holds: true },
      'verify:beta': { holds: true },
      parA: 'A done',
      parB: 'B done',
    }));

    const events = [];
    const result = await runner.executeScript({
      scriptPath,
      args: { childPath },
      backendName: 'mock',
      cwd: repo,
      mockFile: fixture,
      emit: (e) => events.push(e),
    });

    assert.equal(result.status, 'ok', result.error);
    assert.deepEqual(result.result.plan, { angles: ['alpha', 'beta'] });
    assert.deepEqual(result.result.piped, [{ holds: true }, { holds: true }]);
    assert.deepEqual(result.result.par, ['A done', 'B done']);
    assert.equal(result.result.child, 42); // nested workflow() result
    assert.equal(result.result.budgetTotal, null);
    assert.equal(result.result.budgetRemainingIsInfinity, true);
    assert.equal(result.result.dateMathStillWork.max, 2);
    assert.equal(result.result.dateMathStillWork.fixedDate, 2020);

    // worktree isolation actually happened and was cleaned up (mock backend
    // never touches files, so the worktree stays clean and gets removed).
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'worktrees')) || fs.readdirSync(path.join(repo, '.claude', 'worktrees')).length === 0);
    assert.ok(events.some((e) => e.type === 'phase' && e.title === 'Plan'));
    assert.ok(events.some((e) => e.type === 'phase' && e.title === 'Work'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}));

test('workflow() nesting is one level only — a child calling workflow() throws', () => withIsolatedState(async (cwd) => {
  const parentPath = path.join(cwd, 'parent.js');
  fs.writeFileSync(parentPath, `export const meta = { name: 'parent', description: 'd' }
    return await workflow({ scriptPath: args.childPath }, {})`);
  const childPath = path.join(cwd, 'nested-child.js');
  fs.writeFileSync(childPath, `export const meta = { name: 'nested-child', description: 'd' }
    return await workflow({ scriptPath: 'anything' }, {})`);

  const result = await runner.executeScript({ scriptPath: parentPath, args: { childPath }, backendName: 'mock', cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /nesting is one level only/);
}));

test('Date.now() throws inside a script (would break --resume)', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'baddate.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'baddate', description: 'd' }
    return Date.now()`);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /Date\.now\(\) is unavailable/);
}));

test('new Date() with no arguments throws, but new Date(x) still works', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'baddate2.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'baddate2', description: 'd' }
    return new Date()`);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /new Date\(\) with no arguments is unavailable/);
}));

test('Math.random() throws, but other Math members still work', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'badmath.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'badmath', description: 'd' }
    return Math.random()`);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.status, 'error');
  assert.match(result.error, /Math\.random\(\) is unavailable/);
}));

test('args is delivered verbatim, including a stringified-JSON args value (named-workflow-invocation robustness)', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'argsflow.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'argsflow', description: 'd' }
    let A = args
    if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
    return A`);
  const result = await runner.executeScript({ scriptPath, args: '{"question":"x"}', backendName: 'mock', cwd });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.result, { question: 'x' });
}));
