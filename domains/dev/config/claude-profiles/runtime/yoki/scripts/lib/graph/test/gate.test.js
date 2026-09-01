'use strict';

/**
 * `agent(prompt, { gate: '<command>' })` — the mechanical half of a
 * verification: a command whose exit code, not a model's opinion, decides
 * whether the agent's result stands.
 *
 * The four properties that matter, and what pins each here:
 *  - pass / fail / timeout are three distinct outcomes (a SIGKILLed child
 *    reports no exit code, so `killed` — not the code — separates "ran out
 *    of time" from "chose to exit 0");
 *  - the gate runs in the tree the AGENT wrote, which for
 *    `isolation: 'worktree'` is the worktree and not the run's cwd — the
 *    reason it lives inside `agent()` at all rather than in the script;
 *  - a failed gate takes the same route as any other terminal failure, so
 *    the journal records an error and `--resume` re-runs the call instead of
 *    replaying an unverified result;
 *  - the gate is part of the call key, so a result recorded without one (or
 *    under a different one) is not reusable.
 *
 * Every test isolates YOKI_STATE_HOME and YOKI_GRAPH_GUARD_STATE_DIR — see
 * runner.test.js's header for why touching real shared state here is wrong.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const gate = require('../gate');
const retry = require('../retry');
const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { Journal, callKey } = require('../journal');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-gate-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-gate-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-gate-cwd-'));
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

/** Swap in a mock-backend run() for the duration of one test. */
async function withMockRun(impl, fn) {
  const real = mockBackend.run;
  mockBackend.run = impl;
  try {
    return await fn();
  } finally {
    mockBackend.run = real;
  }
}

function sh(cmd, args, cwd) { execFileSync(cmd, args, { cwd, stdio: 'pipe' }); }

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-gate-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  sh('git', ['add', 'README.md'], dir);
  sh('git', ['commit', '-q', '-m', 'init'], dir);
  return dir;
}

// ---------------------------------------------------------------------------
// argv split vs shell fallback
// ---------------------------------------------------------------------------

test('a plain command is split into an argv; only shell syntax falls back to sh -c', () => {
  assert.deepEqual(gate.splitArgv('npm test'), ['npm', 'test']);
  assert.deepEqual(gate.splitArgv('cargo build --locked'), ['cargo', 'build', '--locked']);
  assert.deepEqual(gate.splitArgv("echo 'a b' c"), ['echo', 'a b', 'c']);
  assert.deepEqual(gate.resolveCommand('npm test'), { cmd: 'npm', argv: ['test'], shell: false });

  // Shell operators, globs, substitution and expansions mean the author
  // wanted a shell — half-emulating one here would silently change meaning.
  for (const command of ['go build ./... && go vet ./...', 'a | b', 'a; b', 'echo $HOME', 'ls *.go', 'a > out']) {
    assert.equal(gate.splitArgv(command), null, command);
    assert.equal(gate.resolveCommand(command).shell, true, command);
    assert.equal(gate.resolveCommand(command).cmd, 'sh');
  }
  // An unbalanced quote is sh's error to report, not ours to guess at.
  assert.equal(gate.splitArgv('echo "unterminated'), null);
});

// ---------------------------------------------------------------------------
// gate.run: pass / fail / timeout / unrunnable
// ---------------------------------------------------------------------------

test('gate.run reports a passing command as ok with exit code 0', async () => {
  const outcome = await gate.run('true');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.killed, false);
  assert.equal(outcome.command, 'true');
  assert.ok(Number.isFinite(outcome.ms));
});

test('gate.run reports a non-zero exit as a failure and keeps the output', async () => {
  const outcome = await gate.run('sh -c "echo BUILD-BROKE >&2; exit 7"');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, 7);
  assert.equal(outcome.killed, false);
  assert.match(outcome.output, /BUILD-BROKE/);
  assert.match(gate.failureMessage(outcome), /gate failed \(exit 7\)/);
  assert.match(gate.failureMessage(outcome), /BUILD-BROKE/);
});

test('gate.run kills a command that runs past its timeout, and killed — not the exit code — says so', async () => {
  const outcome = await gate.run('sleep 30', { timeoutMs: 150 });
  assert.equal(outcome.killed, true);
  assert.equal(outcome.ok, false);
  // The whole point of tracking `killed`: a SIGKILLed child reports no exit
  // code of its own, so a code-only check would have to guess.
  assert.equal(outcome.exitCode, null);
  assert.match(gate.failureMessage(outcome), /timed out/);
});

test('gate.run turns a command this machine does not have into a failing gate, not a crash', async () => {
  const outcome = await gate.run('yoki-no-such-command-exists-anywhere');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, null);
  assert.match(outcome.output, /could not be started/);
});

test('a gate failure is never classified transient — retrying a verdict costs time and changes nothing', () => {
  const outcome = { command: 'npm test', ok: false, exitCode: null, ms: 1, killed: true, output: '' };
  const err = new gate.GateFailureError(gate.failureMessage(outcome), gate.toRecord(outcome));
  // The message literally contains "timed out", which retry.js's own pattern
  // list matches — the explicit flag is what stops a ten-minute hung suite
  // from being re-run for another ten minutes.
  assert.match(err.message, /timed out/);
  assert.equal(retry.isTransient(err), false);
});

test('toRecord carries exactly the four journal fields, not the command output', async () => {
  const outcome = await gate.run('sh -c "echo noisy; exit 0"');
  assert.deepEqual(Object.keys(gate.toRecord(outcome)).sort(), ['command', 'exitCode', 'killed', 'ms']);
});

// ---------------------------------------------------------------------------
// End to end through agent()
// ---------------------------------------------------------------------------

test('a passing gate leaves the result alone and records itself in the journal', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'g.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
return await agent('do the thing', { label: 'work', gate: 'true' })`);

  const events = [];
  const result = await withMockRun(
    async () => ({ raw: 'the answer', durationMs: 1, exitCode: 0 }),
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e) }),
  );

  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result, 'the answer');

  const gateEvent = events.find((e) => e.type === 'agent-gate');
  assert.ok(gateEvent, 'a gate run is reported as its own event');
  assert.equal(gateEvent.status, 'pass');
  assert.equal(gateEvent.label, 'work');
  assert.equal(gateEvent.gate.command, 'true');
  assert.equal(gateEvent.gate.exitCode, 0);
  assert.equal(gateEvent.gate.killed, false);

  const end = events.find((e) => e.type === 'agent-end');
  assert.equal(end.status, 'ok');
  assert.equal(end.gate.command, 'true');

  const [entry] = new Journal(result.runId).readAll();
  assert.equal(entry.status, 'ok');
  assert.equal(entry.gate.command, 'true');
  assert.equal(entry.gate.exitCode, 0);
}));

test('a failing gate fails the agent: null result, error journal entry, gate recorded', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'g.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
const r = await agent('do the thing', { label: 'work', gate: 'sh -c "echo TESTS-FAILED >&2; exit 1"' })
return { r, wasNull: r === null }`);

  const events = [];
  const result = await withMockRun(
    async () => ({ raw: 'the answer the model was proud of', durationMs: 1, exitCode: 0 }),
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e) }),
  );

  assert.equal(result.status, 'ok', result.error);
  // agent()'s documented failure contract: null, not a rejection — a script's
  // own `if (!x)` early-exits keep working.
  assert.equal(result.result.wasNull, true);

  const gateEvent = events.find((e) => e.type === 'agent-gate');
  assert.equal(gateEvent.status, 'fail');
  assert.equal(gateEvent.gate.exitCode, 1);

  const end = events.find((e) => e.type === 'agent-end');
  assert.equal(end.status, 'error');
  assert.match(end.error, /TESTS-FAILED/);
  assert.equal(end.gate.exitCode, 1);

  const [entry] = new Journal(result.runId).readAll();
  assert.equal(entry.status, 'error');
  assert.equal(entry.gate.exitCode, 1);
  assert.match(entry.error, /gate failed/);
}));

test('a gate that outruns gateTimeoutMs kills the command and fails the agent', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'g.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
const r = await agent('do the thing', { label: 'slow-gate', gate: 'sleep 30', gateTimeoutMs: 150 })
return { wasNull: r === null }`);

  const events = [];
  const result = await withMockRun(
    async () => ({ raw: 'answer', durationMs: 1, exitCode: 0 }),
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e) }),
  );

  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result.wasNull, true);
  const gateEvent = events.find((e) => e.type === 'agent-gate');
  assert.equal(gateEvent.status, 'fail');
  assert.equal(gateEvent.gate.killed, true);
  assert.equal(gateEvent.gate.exitCode, null);
  const [entry] = new Journal(result.runId).readAll();
  assert.equal(entry.timedOut, true);
  assert.match(entry.error, /timed out/);
}));

// ---------------------------------------------------------------------------
// The gate runs in the tree the agent wrote
// ---------------------------------------------------------------------------

test("with isolation:'worktree' the gate runs in the agent's worktree, not the run cwd", () => withIsolatedState(async (cwd) => {
  const repo = makeTempRepo();
  try {
    const scriptPath = path.join(cwd, 'g.js');
    fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
return await agent('write the marker', {
  label: 'writer', isolation: 'worktree', gate: 'grep -q AGENT-WROTE-THIS marker.txt',
})`);

    const seenCwds = [];
    const result = await withMockRun(async ({ cwd: agentCwd }) => {
      // Stands in for a real agent editing files: it writes into whatever
      // directory it was given, which for isolation:'worktree' is the
      // worktree — the tree the gate must therefore verify.
      seenCwds.push(agentCwd);
      fs.writeFileSync(path.join(agentCwd, 'marker.txt'), 'AGENT-WROTE-THIS\n');
      return { raw: 'wrote it', durationMs: 1, exitCode: 0 };
    }, () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd: repo }));

    assert.equal(result.status, 'ok', result.error);
    assert.equal(result.result, 'wrote it', 'the gate found the file the agent wrote, so the call passed');

    const worktreePath = seenCwds[0];
    assert.notEqual(worktreePath, repo, 'the agent ran in a worktree, not the repo root');
    assert.match(worktreePath, /\.claude[/\\]worktrees[/\\]graph-/);
    // The marker only ever existed in the worktree: had the gate run in the
    // run's cwd it would have found nothing and failed the call.
    assert.equal(fs.existsSync(path.join(repo, 'marker.txt')), false);
    assert.equal(fs.existsSync(path.join(worktreePath, 'marker.txt')), true,
      'the worktree is left in place because the agent left it dirty');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}));

test('without isolation the gate runs in the run cwd', () => withIsolatedState(async (cwd) => {
  fs.writeFileSync(path.join(cwd, 'marker.txt'), 'IN-THE-RUN-CWD\n');
  const scriptPath = path.join(cwd, 'g.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
return await agent('look', { label: 'reader', gate: 'grep -q IN-THE-RUN-CWD marker.txt' })`);

  const result = await withMockRun(
    async () => ({ raw: 'looked', durationMs: 1, exitCode: 0 }),
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd }),
  );
  assert.equal(result.status, 'ok', result.error);
  assert.equal(result.result, 'looked');
}));

// ---------------------------------------------------------------------------
// The gate is part of the call key, and a failed gate re-runs on resume
// ---------------------------------------------------------------------------

test('the gate command is part of the call key: no gate, this gate and that gate are three different calls', () => {
  const bare = callKey('same prompt', { label: 'x' });
  const tested = callKey('same prompt', { label: 'x', gate: 'npm test' });
  const built = callKey('same prompt', { label: 'x', gate: 'npm run build' });
  assert.notEqual(bare, tested, 'a result nothing verified is not a result this gate accepted');
  assert.notEqual(tested, built, 'a different bar is different work');
  assert.equal(tested, callKey('same prompt', { label: 'x', gate: 'npm test' }));
});

test('--resume will not replay a result recorded under a different gate', () => withIsolatedState(async (cwd) => {
  const write = (command) => {
    const scriptPath = path.join(cwd, 'g.js');
    fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
return await agent('do the thing', { label: 'work', gate: '${command}' })`);
    return scriptPath;
  };

  let calls = 0;
  const run = (scriptPath, runId, emit) => withMockRun(
    async () => { calls += 1; return { raw: `answer-${calls}`, durationMs: 1, exitCode: 0 }; },
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, runId, emit }),
  );

  const first = await run(write('true'), undefined, () => {});
  assert.equal(first.status, 'ok', first.error);
  assert.equal(calls, 1);

  // Same prompt, same label, same everything — except the bar it must clear.
  const events = [];
  const second = await run(write('sh -c "exit 0"'), first.runId, (e) => events.push(e));
  assert.equal(second.status, 'ok', second.error);
  assert.equal(calls, 2, 'the changed gate forced the call to run again');
  assert.equal(events.some((e) => e.type === 'agent-cached'), false);
  assert.ok(events.some((e) => e.type === 'resume-diverged'));
}));

test('a gate failure feeds the retry path: the journal holds an error, so --resume re-runs the call', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'g.js');
  // The gate is fixed; what changes between the two runs is the WORLD it
  // inspects — exactly the "fix it and rerun" loop a gate exists for.
  fs.writeFileSync(scriptPath, `export const meta = { name: 'g', description: 'd' }
const r = await agent('do the thing', { label: 'work', gate: 'grep -q FIXED state.txt' })
return { wasNull: r === null, r }`);

  let calls = 0;
  const run = (runId, emit) => withMockRun(
    async () => { calls += 1; return { raw: 'the answer', durationMs: 1, exitCode: 0 }; },
    () => runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, runId, emit }),
  );

  fs.writeFileSync(path.join(cwd, 'state.txt'), 'BROKEN\n');
  const first = await run(undefined, () => {});
  assert.equal(first.result.wasNull, true, 'the gate rejected it');
  assert.equal(calls, 1);
  assert.deepEqual(new Journal(first.runId).readAll().map((e) => e.status), ['error']);

  fs.writeFileSync(path.join(cwd, 'state.txt'), 'FIXED\n');
  const events = [];
  const second = await run(first.runId, (e) => events.push(e));
  assert.equal(second.status, 'ok', second.error);
  // A failed gate is journaled as an error, and only `ok` entries replay —
  // so the resumed run re-ran the call rather than handing back a result no
  // gate ever accepted.
  assert.equal(calls, 2);
  assert.equal(events.some((e) => e.type === 'agent-cached'), false);
  assert.equal(second.result.r, 'the answer');
  assert.equal(events.find((e) => e.type === 'agent-gate').status, 'pass');
}));

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

test('the human printer renders a gate run as [label] gate: <command> → pass/fail (Ns)', () => {
  const cli = require('../cli');
  const line = cli.humanLine({
    type: 'agent-gate', label: 'gate', status: 'pass', ts: '2026-01-01T10:20:30Z',
    gate: { command: 'npm test', exitCode: 0, ms: 12000, killed: false },
  });
  assert.match(line, /gate gate: npm test → pass \(12s\)/);

  const failed = cli.humanLine({
    type: 'agent-gate', label: 'gate', status: 'fail', ts: '2026-01-01T10:20:30Z',
    gate: { command: 'npm test', exitCode: 1, ms: 3000, killed: false },
  });
  assert.match(failed, /npm test → fail \(exit 1\) \(3s\)/);

  const killed = cli.humanLine({
    type: 'agent-gate', label: 'gate', status: 'fail', ts: '2026-01-01T10:20:30Z',
    gate: { command: 'npm test', exitCode: null, ms: 600000, killed: true },
  });
  assert.match(killed, /fail \(timed out\)/);
});

test('progress folds a failed gate into its own counter as well as the failure count', () => {
  const progress = require('../progress');
  const state = progress.createState();
  progress.foldEvent(state, { type: 'agent-start', index: 0, label: 'a' }, 1000);
  progress.foldEvent(state, { type: 'agent-gate', index: 0, label: 'a', status: 'fail', gate: { command: 'npm test' } }, 2000);
  assert.equal(state.gateFailed, 1);
  assert.match(progress.renderStatus(state, 3000), /gate-failed 1/);
  assert.match(progress.renderStatus(state, 3000), /gate:fail/);
  progress.foldEvent(state, { type: 'agent-end', index: 0, label: 'a', status: 'error' }, 3000);
  assert.equal(state.failed, 1);
});
