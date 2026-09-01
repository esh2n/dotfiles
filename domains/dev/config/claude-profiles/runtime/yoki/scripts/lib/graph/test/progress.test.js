'use strict';

/**
 * Live progress: the event fold, the rendered status line, the TTY vs
 * non-TTY split, per-backend tool-call counting, and `status --watch`.
 *
 * Nothing here waits or touches a terminal: the renderer takes an injected
 * stream and clock, and the watch loop takes an injected sleep and a poll
 * ceiling.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const progress = require('../progress');
const cli = require('../cli');
const runner = require('../runner');
const codex = require('../backends/codex');
const omp = require('../backends/omp');
const mockBackend = require('../backends/mock');
const { makeLineSplitter } = require('../backends/common');

/** A writable that just accumulates, standing in for stdout. */
function fakeStream(isTTY = false) {
  const chunks = [];
  return {
    isTTY,
    write: (text) => { chunks.push(text); return true; },
    get text() { return chunks.join(''); },
    chunks,
  };
}

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-progress-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-progress-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-graph-progress-cwd-'));
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

const FIXTURE_EVENTS = [
  { type: 'run-start', runId: 'r1', name: 'review', backend: 'codex', phases: ['Collect', 'Review', 'Verify', 'Judge', 'Report'] },
  { type: 'phase', title: 'Collect' },
  { type: 'agent-start', index: 0, label: 'collect-diff', backend: 'codex', model: 'gpt-5.4-mini', phase: 'Collect' },
  { type: 'agent-end', index: 0, label: 'collect-diff', status: 'ok' },
  { type: 'phase', title: 'Review' },
  { type: 'agent-start', index: 1, label: 'correctness', backend: 'codex', model: 'gpt-5.5', phase: 'Review' },
  { type: 'agent-start', index: 2, label: 'security', backend: 'codex', model: 'gpt-5.6-sol', phase: 'Review' },
  { type: 'agent-progress', index: 2, toolCalls: 3 },
];

// ---------------------------------------------------------------------------
// The fold + the rendered line
// ---------------------------------------------------------------------------

test('the status line names the phase, the counts, and each running agent with its RESOLVED model', () => {
  const state = progress.createState();
  let clock = 1_000_000;
  for (const event of FIXTURE_EVENTS) progress.foldEvent(state, event, clock);
  clock += 41_000; // 41 seconds into the two live lanes

  const line = progress.renderStatus(state, clock);
  assert.match(line, /^phase 2\/5 Review/);
  assert.match(line, /running 2 \/ done 1 \/ failed 0/);
  assert.match(line, /\[correctness gpt-5\.5 41s\]/);
  // Tool-call ticks show as activity on the lane that reported them.
  assert.match(line, /\[security gpt-5\.6-sol 41s \+3 tools\]/);
});

test('a failed agent counts as failed, a replayed one as replayed, and both leave the running set', () => {
  const state = progress.createState();
  progress.foldEvent(state, { type: 'run-start', phases: ['A'] });
  progress.foldEvent(state, { type: 'agent-start', index: 0, label: 'a' });
  progress.foldEvent(state, { type: 'agent-start', index: 1, label: 'b' });
  progress.foldEvent(state, { type: 'agent-end', index: 0, status: 'error' });
  progress.foldEvent(state, { type: 'agent-end', index: 1, status: 'ok' });
  progress.foldEvent(state, { type: 'agent-cached', index: 2, label: 'c' });
  assert.equal(state.running.size, 0);
  assert.equal(state.failed, 1);
  assert.equal(state.done, 1);
  assert.equal(state.replayed, 1);
  assert.match(progress.renderStatus(state), /running 0 \/ done 1 \/ failed 1 — replayed 1/);
});

test('a phase the script calls but meta never declared still advances the counter', () => {
  const state = progress.createState();
  progress.foldEvent(state, { type: 'run-start', phases: ['A', 'B'] });
  progress.foldEvent(state, { type: 'phase', title: 'A' });
  assert.equal(state.phaseIndex, 1);
  progress.foldEvent(state, { type: 'phase', title: 'Undeclared' });
  assert.equal(state.phaseIndex, 2, 'an undeclared phase must not reset the position to 0');
  assert.match(progress.renderStatus(state), /phase 2\/2 Undeclared/);
});

test('only the first few running lanes are listed, with the rest counted', () => {
  const state = progress.createState();
  for (let i = 0; i < progress.MAX_RUNNING_SHOWN + 2; i += 1) {
    progress.foldEvent(state, { type: 'agent-start', index: i, label: `lane${i}` });
  }
  const line = progress.renderStatus(state);
  assert.match(line, /\+2 more/);
  assert.equal((line.match(/\[lane/g) || []).length, progress.MAX_RUNNING_SHOWN);
});

test('elapsed time is rendered in seconds, then minutes', () => {
  assert.equal(progress.formatElapsed(0), '0s');
  assert.equal(progress.formatElapsed(41_000), '41s');
  assert.equal(progress.formatElapsed(125_000), '2m05s');
});

// ---------------------------------------------------------------------------
// TTY vs pipe
// ---------------------------------------------------------------------------

test('on a TTY the status line is redrawn in place; permanent lines still scroll past it', () => {
  const stream = fakeStream(true);
  const renderer = progress.createRenderer({ stream, lineFor: cli.humanLine, now: () => 1000 });
  for (const event of FIXTURE_EVENTS) renderer.handle(event);
  const text = stream.text;
  assert.ok(text.includes('\r'), 'a TTY must get carriage-return repaints');
  assert.match(text, /── Review ──/, 'the phase header stays in the scrollback');
  assert.match(text, /running 2 \/ done 1/);
  renderer.finish();
  // finish() erases the transient line so the final report starts clean.
  assert.match(stream.chunks[stream.chunks.length - 1], /^\r +\r$/);
});

test('off a TTY there is no carriage return at all — a redraw in a log file is unreadable', () => {
  const stream = fakeStream(false);
  const renderer = progress.createRenderer({ stream, lineFor: cli.humanLine, now: () => 1000 });
  for (const event of FIXTURE_EVENTS) renderer.handle(event);
  renderer.finish();
  assert.equal(stream.text.includes('\r'), false);
  // One line per event instead, and the agent lines carry the resolved model.
  assert.match(stream.text, /→ collect-diff \(codex gpt-5\.4-mini\) \[Collect\]/);
  assert.equal(stream.text.includes('running 2 /'), false, 'no live status line off a TTY');
});

test('an agent-progress tick prints no permanent line — it is live-only', () => {
  assert.equal(cli.humanLine({ type: 'agent-progress', index: 1, toolCalls: 2 }), null);
});

test('--json bypasses the renderer entirely and writes the event stream verbatim', () => {
  const stream = fakeStream(true);
  const printer = cli.makeEmitter({ json: true, stream });
  printer.emit(FIXTURE_EVENTS[0]);
  printer.finish();
  assert.equal(stream.text.trim(), JSON.stringify(FIXTURE_EVENTS[0]));
});

// ---------------------------------------------------------------------------
// Per-backend tool-call counting
// ---------------------------------------------------------------------------

test('makeLineSplitter reassembles events split across chunk boundaries', () => {
  const lines = [];
  const push = makeLineSplitter((line) => lines.push(line));
  push('{"a":1}\n{"b":');
  push('2}\n');
  push('   \n{"c":3}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('codex counts tool-call STARTS from its --json item events, not ends', () => {
  const seen = [];
  const push = codex.makeProgressCounter(({ toolCalls }) => seen.push(toolCalls));
  const stream = [
    { msg: { type: 'agent_message', message: 'thinking' } },
    { msg: { type: 'exec_command_begin', command: 'ls' } },
    { msg: { type: 'exec_command_end', exit_code: 0 } },
    { type: 'item.started', item: { type: 'command_execution' } },
    { type: 'item.completed', item: { type: 'command_execution' } },
    { msg: { type: 'mcp_tool_call_begin' } },
  ].map((e) => `${JSON.stringify(e)}\n`).join('');
  push(stream);
  assert.deepEqual(seen, [1, 2, 3], 'each start ticks once; ends and messages do not');
  assert.equal(codex.makeProgressCounter(undefined), undefined);
});

test('omp counts tool calls from its json-mode stream, ignoring tool results', () => {
  const seen = [];
  const push = omp.makeProgressCounter(({ toolCalls }) => seen.push(toolCalls));
  const stream = [
    { type: 'session', sessionId: 's1' },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text' }, { type: 'tool_use' }] } },
    { type: 'message', message: { role: 'toolResult' } },
    { type: 'tool_call' },
  ].map((e) => `${JSON.stringify(e)}\n`).join('');
  push(stream);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(omp.countToolCalls({ type: 'message', message: { role: 'toolResult' } }), 0);
});

test('the mock backend reports synthetic progress, so the live path runs offline too', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'p.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'p', description: 'd' }
return await agent('go', { label: 'one' })`);
  const events = [];
  await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd, emit: (e) => events.push(e) });
  const ticks = events.filter((e) => e.type === 'agent-progress');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].toolCalls, 1);
  assert.equal(ticks[0].label, 'one');
}));

// ---------------------------------------------------------------------------
// status --watch
// ---------------------------------------------------------------------------

test('watchSnapshot rebuilds the same view from a journal it did not produce', () => {
  // Journal lines are in COMPLETION order; index 1 finished before index 0.
  const entries = [
    { index: 1, status: 'ok', label: 'b', phase: 'Review', model: 'gpt-5.5' },
    { index: 0, status: 'ok', label: 'a', phase: 'Collect', model: 'gpt-5.5' },
    { index: 3, status: 'error', label: 'd', phase: 'Review', model: 'gpt-5.5' },
    { index: 1, status: 'retry', attempt: 1, error: '429' },
  ];
  const state = cli.watchSnapshot('r1', { name: 'review', backend: 'codex', status: 'running' }, entries);
  assert.equal(state.done, 2);
  assert.equal(state.failed, 1);
  // index 2 has no entry but a higher index does: it is still in flight.
  assert.deepEqual([...state.running.keys()], [2]);
  assert.equal(state.finished, false);
  assert.match(progress.renderStatus(state), /running 1 \/ done 2 \/ failed 1/);
});

test('--watch polls until the run stops running, then prints the final report', () => withIsolatedState(async (cwd) => {
  const scriptPath = path.join(cwd, 'w.js');
  fs.writeFileSync(scriptPath, `export const meta = { name: 'w', description: 'd' }
return await agent('go', { label: 'one' })`);
  const finished = await runner.executeScript({ scriptPath, args: {}, backendName: 'mock', cwd });
  assert.equal(finished.status, 'ok', finished.error);

  const stream = fakeStream(false);
  let sleeps = 0;
  await cli.cmdWatch([finished.runId], {}, {
    stream, isTty: false, sleep: async () => { sleeps += 1; }, maxPolls: 5,
  });
  assert.equal(sleeps, 0, 'a finished run must not wait a single interval');
  assert.match(stream.text, /running 0 \/ done 1 \/ failed 0/);
  // ...and then the same report `status` prints.
  assert.match(stream.text + '', /running 0/);
}));

test('--watch keeps polling while the run is still running', () => withIsolatedState(async (cwd) => {
  const runId = 'watch-me';
  runner.writeRunMeta(runId, { name: 'w', backend: 'mock', status: 'running' });
  const stream = fakeStream(false);
  let sleeps = 0;
  await cli.cmdWatch([runId], {}, {
    stream, isTty: false, sleep: async () => { sleeps += 1; }, maxPolls: 3,
  });
  assert.equal(sleeps, 3, 'one wait per poll while the run is unfinished');
  assert.equal((stream.text.match(/running 0 \/ done 0/g) || []).length, 3);
}));

test('--watch on an unknown runId says so and exits non-zero', () => withIsolatedState(async () => {
  const stream = fakeStream(false);
  const previous = process.exitCode;
  try {
    await cli.cmdWatch(['no-such-run'], {}, { stream, isTty: false, sleep: async () => {}, maxPolls: 2 });
    assert.match(stream.text, /no run found with id no-such-run/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previous;
  }
}));
