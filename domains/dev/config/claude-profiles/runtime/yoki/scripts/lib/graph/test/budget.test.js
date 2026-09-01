'use strict';

/**
 * Execution caps: cap resolution (run option > .yoki.json > env > default),
 * the real `budget.remaining()`, and the hard-fail behaviour that makes a cap
 * a cap — including the case the caps exist for, a script that loops on
 * `budget.remaining()`.
 *
 * Isolated state per test — see runner.test.js's header comment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const budgetLib = require('../budget');
const runner = require('../runner');
const mockBackend = require('../backends/mock');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-budget-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-budget-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-budget-cwd-'));
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
// resolveCaps
// ---------------------------------------------------------------------------

test('resolveCaps: defaults when nothing configures a cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-caps-'));
  try {
    const caps = budgetLib.resolveCaps(dir, {}, {});
    assert.equal(caps.maxAgentCalls, budgetLib.DEFAULT_MAX_AGENT_CALLS);
    assert.equal(caps.maxTokens, Infinity);
    assert.equal(caps.maxWallMs, Infinity);
    assert.equal(caps.sources.maxAgentCalls, 'default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveCaps: run option > .yoki.json > env, and 0 means "no cap"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-caps-'));
  try {
    fs.writeFileSync(path.join(dir, '.yoki.json'), JSON.stringify({
      graphMaxAgentCalls: 12, graphMaxTokens: 500000, graphMaxWallMs: 0,
    }));
    const env = { YOKI_GRAPH_MAX_AGENT_CALLS: '3', YOKI_GRAPH_MAX_TOKENS: '7' };

    const fromConfig = budgetLib.resolveCaps(dir, {}, env);
    assert.equal(fromConfig.maxAgentCalls, 12, '.yoki.json beats the env var');
    assert.equal(fromConfig.maxTokens, 500000);
    assert.equal(fromConfig.maxWallMs, Infinity, '0 in .yoki.json disables that cap');
    assert.equal(fromConfig.sources.maxTokens, '.yoki.json');

    const withOption = budgetLib.resolveCaps(dir, { maxAgentCalls: 4 }, env);
    assert.equal(withOption.maxAgentCalls, 4, 'the run option beats .yoki.json');
    assert.equal(withOption.sources.maxAgentCalls, 'option');

    // env is the last rung before the built-in default
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-caps-bare-'));
    try {
      const fromEnv = budgetLib.resolveCaps(bare, {}, env);
      assert.equal(fromEnv.maxAgentCalls, 3);
      assert.equal(fromEnv.sources.maxAgentCalls, 'env');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveCaps resolves the idle-watchdog cap through the same option>.yoki.json>env>default order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-idlecaps-'));
  try {
    assert.equal(budgetLib.resolveCaps(dir, {}, {}).idleTimeoutMs, Infinity, 'off by default');
    assert.equal(budgetLib.resolveCaps(dir, {}, {}).sources.idleTimeoutMs, 'default');

    fs.writeFileSync(path.join(dir, '.yoki.json'), JSON.stringify({ graphIdleTimeoutMs: 5000 }));
    const fromConfig = budgetLib.resolveCaps(dir, {}, { YOKI_GRAPH_IDLE_MS: '99' });
    assert.equal(fromConfig.idleTimeoutMs, 5000, '.yoki.json graphIdleTimeoutMs beats the env var');
    assert.equal(fromConfig.sources.idleTimeoutMs, '.yoki.json');

    const withOption = budgetLib.resolveCaps(dir, { idleTimeoutMs: 1234 }, {});
    assert.equal(withOption.idleTimeoutMs, 1234, 'the run option beats .yoki.json');
    assert.equal(withOption.sources.idleTimeoutMs, 'option');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertWithinCaps names which cap was hit and the numbers behind it', () => {
  const caps = { maxAgentCalls: 2, maxTokens: 100, maxWallMs: 1000 };
  assert.doesNotThrow(() => budgetLib.assertWithinCaps(caps, { callsMade: 1, tokensSpent: 99, elapsedMs: 999 }));
  assert.throws(
    () => budgetLib.assertWithinCaps(caps, { callsMade: 2 }),
    (err) => err instanceof budgetLib.BudgetExceededError && err.kind === 'agentCalls' && /2\/2/.test(err.message),
  );
  assert.throws(
    () => budgetLib.assertWithinCaps(caps, { tokensSpent: 100 }),
    (err) => err.kind === 'tokens' && /graphMaxTokens/.test(err.message),
  );
  assert.throws(
    () => budgetLib.assertWithinCaps(caps, { elapsedMs: 5000 }),
    (err) => err.kind === 'wallMs' && /graphMaxWallMs/.test(err.message),
  );
});

test('a budget breach is never retried', () => {
  const { isTransient } = require('../retry');
  assert.equal(isTransient(new budgetLib.BudgetExceededError('nope', { kind: 'tokens' })), false);
});

// ---------------------------------------------------------------------------
// End to end through executeScript
// ---------------------------------------------------------------------------

test('budget.total/remaining() report the real token cap, not a hardcoded Infinity', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'b.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'b', description: 'd' }
const before = { total: budget.total, remaining: budget.remaining(), spent: budget.spent() }
await agent('some work', { label: 'one' })
return { before, after: { total: budget.total, remaining: budget.remaining(), spent: budget.spent() } }`);

  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, maxTokens: 10000,
  });
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.before.total, 10000);
  assert.equal(result.result.before.remaining, 10000);
  // The mock backend reports no usage, so the call is charged an explicit
  // estimate rather than a silent zero — remaining() must have moved.
  assert.ok(result.result.after.spent > 0, 'spent() stayed at zero');
  assert.equal(result.result.after.remaining, 10000 - result.result.after.spent);
}));

test('with no token cap, total is null and remaining() is Infinity (the honest "no target set")', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'b.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'b', description: 'd' }
return { total: budget.total, remaining: budget.remaining() }`);
  const result = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(result.result.total, null);
  assert.equal(result.result.remaining, Infinity);
}));

test('the agent-call cap hard-fails the run — the loop budget.remaining() used to invite cannot outrun it', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'runaway.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'runaway', description: 'd' }
let n = 0
while (budget.remaining() > 0) {
  await agent('go again ' + n, { label: 'loop-' + n })
  n += 1
}
return n`);

  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, maxAgentCalls: 5,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /agent\(\) call cap reached \(5\/5\)/);
}));

test('a cap breach inside parallel() is re-raised, not swallowed into null', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'par.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'par', description: 'd' }
const out = await parallel([
  () => agent('one', { label: 'one' }),
  () => agent('two', { label: 'two' }),
  () => agent('three', { label: 'three' }),
])
return out`);

  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, maxAgentCalls: 2,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /agent\(\) call cap reached/);
}));

test('a cap breach inside pipeline() is re-raised too', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'pipe.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'pipe', description: 'd' }
return await pipeline([1, 2, 3], (n) => agent('item ' + n, { label: 'i' + n }))`);
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, maxAgentCalls: 1,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /agent\(\) call cap reached/);
}));

test('the wall-clock cap stops a run that is still making calls', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'slow.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'slow', description: 'd' }
let n = 0
while (n < 50) {
  await agent('call ' + n, { label: 'c' + n })
  n += 1
}
return n`);
  // 0ms of headroom: the very first call is already past the deadline.
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, maxWallMs: 0.0001,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /wall-clock cap reached/);
}));

test('caps also apply in --dry-run: a runaway loop still needs stopping', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'dry.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'dry', description: 'd' }
let n = 0
while (true) { await agent('x', { label: 'l' + n }); n += 1 }`);
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, dryRun: true, maxAgentCalls: 3,
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /agent\(\) call cap reached \(3\/3\)/);
}));

test('a replayed call is free: resume does not spend the agent-call cap', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'three.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'three', description: 'd' }
const a = await agent('one', { label: 'a' })
const b = await agent('two', { label: 'b' })
const c = await agent('three', { label: 'c' })
return [a, b, c]`);

  const first = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, maxAgentCalls: 3 });
  assert.equal(first.status, 'ok', first.error);
  // A cap of 1 would fail outright without resume; with all three replayed,
  // no live call happens at all.
  const second = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, runId: first.runId, maxAgentCalls: 1,
  });
  assert.equal(second.status, 'ok', second.error);
  assert.deepEqual(second.result, first.result);
}));

test('on --resume, budget.spent() is correct on the body FIRST read, before any agent() call', () => withIsolatedState(async (cwd) => {
  // The worker's spent mirror is seeded from the journal at spawn, so a resumed
  // run that reads budget.spent() before its first (replayed) agent() call sees
  // the prior spend — not 0, the full wrong budget the review flagged.
  const scriptPath = path.join(cwd, 'seed.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'seed', description: 'd' }
const firstCheck = budget.spent()
await agent('one', { label: 'a' })
await agent('two', { label: 'b' })
return { firstCheck }`);

  const first = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, maxTokens: 100000 });
  assert.equal(first.status, 'ok', first.error);
  assert.equal(first.result.firstCheck, 0, 'a fresh run has spent nothing at its first check');
  const priorSpend = new Journal(first.runId).tokensSpent();
  assert.ok(priorSpend > 0, 'the first run must have spent tokens');

  const second = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, runId: first.runId, maxTokens: 100000,
  });
  assert.equal(second.status, 'ok', second.error);
  assert.equal(second.result.firstCheck, priorSpend,
    'resumed run: budget.spent() reflects prior spend from the very first read, not 0');
}));

test('journal.spent() mirrors tokensSpent() incrementally, without double counting', () => withIsolatedState(async () => {
  const j = new Journal('run-spent-unit');
  assert.equal(j.spent(), 0, 'an empty journal has spent 0');
  j.append({ index: 0, key: 'k0', status: 'ok', tokens: 100 });
  j.append({ index: 1, key: 'k1', status: 'ok', tokens: 250 });
  j.append({ index: 1, key: 'k1', status: 'retry' }); // no tokens field — must not shift the total
  assert.equal(j.spent(), 350, 'spent() tracks appended tokens incrementally');
  assert.equal(j.spent(), j.tokensSpent(), 'the O(1) mirror equals the full-scan source of truth');
  // A fresh reader lazily seeds from one full scan and agrees — no drift.
  assert.equal(new Journal('run-spent-unit').spent(), 350);
}));

// ---------------------------------------------------------------------------
// Usage accounting — what makes the token cap and budget.spent() real.
// ---------------------------------------------------------------------------

const api = require('../api');
const { Journal } = require('../journal');
const cli = require('../cli');

async function withMockRun(impl, fn) {
  const real = mockBackend.run;
  mockBackend.run = impl;
  try {
    return await fn();
  } finally {
    mockBackend.run = real;
  }
}

test('a backend-reported usage block is recorded verbatim, not estimated', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'u.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'u', description: 'd' }
return await agent('go', { label: 'one' })`);

  const events = [];
  const result = await withMockRun(async () => ({
    raw: JSON.stringify({ type: 'result', result: 'answer', total_cost_usd: 0.5, usage: { input_tokens: 300, output_tokens: 200 } }),
    durationMs: 1, exitCode: 0,
  }), async () => {
    // A stand-in extractUsage: what is under test is api.js preferring a
    // backend's own numbers over an estimate, not any one backend's reader.
    const realExtract = mockBackend.extractUsage;
    mockBackend.extractUsage = (raw) => {
      const obj = JSON.parse(raw);
      return {
        inputTokens: obj.usage.input_tokens,
        outputTokens: obj.usage.output_tokens,
        totalTokens: obj.usage.input_tokens + obj.usage.output_tokens,
        costUsd: obj.total_cost_usd,
      };
    };
    try {
      return await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e) });
    } finally {
      if (realExtract === undefined) delete mockBackend.extractUsage; else mockBackend.extractUsage = realExtract;
    }
  });

  assert.equal(result.status, 'ok', result.error);
  const entry = new Journal(result.runId).readAll()[0];
  assert.equal(entry.tokens, 500);
  assert.equal(entry.tokensSource, 'reported');
  assert.equal(entry.usage.costUsd, 0.5);
  assert.equal(result.usage.reportedTokens, 500);
  assert.equal(result.usage.estimatedTokens, 0);
  assert.equal(result.usage.hasCost, true);
  const end = events.find((e) => e.type === 'agent-end');
  assert.equal(end.tokens, 500);
  assert.equal(end.tokensSource, 'reported');
}));

test('a backend that reports nothing is charged an explicit ESTIMATE, never a silent zero', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'u.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'u', description: 'd' }
return await agent('go', { label: 'one' })`);
  const result = await withMockRun(
    async () => ({ raw: 'x'.repeat(400), durationMs: 1, exitCode: 0 }),
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd }),
  );
  const entry = new Journal(result.runId).readAll()[0];
  assert.equal(entry.tokensSource, 'estimated');
  assert.equal(entry.tokens, 100); // 400 chars / 4
  assert.equal(result.usage.reportedTokens, 0);
  assert.equal(result.usage.estimatedTokens, 100);
  assert.equal(result.usage.hasCost, false);
}));

test('estimateTokens is the documented ~4-chars-per-token rule', () => {
  assert.equal(api.estimateTokens('abcd'), 1);
  assert.equal(api.estimateTokens('abcde'), 2);
  assert.equal(api.estimateTokens(''), 0);
});

test('the end-of-run line separates measured tokens from estimated ones', () => {
  const line = cli.formatUsage({ tokens: 150, reportedTokens: 120, estimatedTokens: 30, calls: 2, hasCost: true, costUsd: 0.125 });
  assert.match(line, /tokens: 150 \(120 reported, 30 estimated\)/);
  assert.match(line, /over 2 agent calls/);
  assert.match(line, /cost: \$0\.1250/);
  const noCost = cli.formatUsage({ tokens: 1, reportedTokens: 1, estimatedTokens: 0, calls: 1, hasCost: false, costUsd: 0 });
  assert.ok(!/cost/.test(noCost), 'no USD is invented for a backend that reports none');
});

// ---------------------------------------------------------------------------
// Per-agent timeout
// ---------------------------------------------------------------------------

test('timeoutFor: opts.timeoutMs > run --timeout > the 15-minute fallback; 0 disables', () => {
  assert.equal(api.timeoutFor({ timeoutMs: 5000 }, { timeoutMs: 60000 }), 5000);
  assert.equal(api.timeoutFor({}, { timeoutMs: 60000 }), 60000);
  assert.equal(api.timeoutFor({}, {}), api.DEFAULT_AGENT_TIMEOUT_MS);
  assert.equal(api.DEFAULT_AGENT_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(api.timeoutFor({ timeoutMs: 0 }, { timeoutMs: 60000 }), undefined);
});

test('the per-call timeout reaches the backend, overriding the run default', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 't.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 't', description: 'd' }
const a = await agent('short', { label: 'short', timeoutMs: 1500 })
const b = await agent('default', { label: 'default' })
return [a, b]`);

  const seen = {};
  await withMockRun(async (params) => {
    seen[params.opts.label] = params.timeoutMs;
    return { raw: 'ok', durationMs: 1, exitCode: 0 };
  }, () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, timeoutMs: 90000 }));

  assert.equal(seen.short, 1500);
  assert.equal(seen.default, 90000);
}));

test('with neither set, the backend still gets the 15-minute fallback rather than waiting forever', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 't.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 't', description: 'd' }
return await agent('go', { label: 'one' })`);
  let seen;
  await withMockRun(async (params) => {
    seen = params.timeoutMs;
    return { raw: 'ok', durationMs: 1, exitCode: 0 };
  }, () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd }));
  assert.equal(seen, api.DEFAULT_AGENT_TIMEOUT_MS);
}));
