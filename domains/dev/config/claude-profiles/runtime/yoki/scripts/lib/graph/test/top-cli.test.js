'use strict';

/**
 * `yoki-graph top` end to end, on the snapshot path (`--once` / non-TTY):
 * a REAL run is produced by the real runner against the mock backend under
 * an isolated state home, and the assertions read the rendered screen —
 * the same seam scripts and CI would consume. The live loop's building
 * blocks (fold, estimate, render, FileTail) have their own pure tests; the
 * loop itself is watchers + a coalescer around exactly this snapshot.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const { runDir } = require('../journal');
const { createEventSink } = require('../events');
const top = require('../top');

/** Same isolation the events tests use: state home, guard state and cwd all
 *  in temp dirs, restored and removed afterwards. */
function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-top-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-top-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-top-cwd-'));
  const prevStateHome = process.env.YOKI_STATE_HOME;
  const prevGuardDir = process.env.YOKI_GRAPH_GUARD_STATE_DIR;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_GRAPH_GUARD_STATE_DIR = guardDir;
  return Promise.resolve(fn(cwd, stateHome)).finally(() => {
    if (prevStateHome === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevStateHome;
    if (prevGuardDir === undefined) delete process.env.YOKI_GRAPH_GUARD_STATE_DIR; else process.env.YOKI_GRAPH_GUARD_STATE_DIR = prevGuardDir;
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

const FLOW = `export const meta = { name: 'top-flow', description: 'd', phases: [{title: 'Scan'}, {title: 'Judge'}] }
phase('Scan')
const a = await agent('first', { label: 'security' })
const b = await agent('second', { label: 'style' })
phase('Judge')
const c = await agent('third', { label: 'judge' })
return { a, b, c }`;

/** One snapshot through the real cmdTop, captured off-stream. */
async function snapshot(flags = {}) {
  const chunks = [];
  const errChunks = [];
  const stream = { write: (c) => { chunks.push(String(c)); return true; }, isTTY: false };
  const stderr = { write: (c) => { errChunks.push(String(c)); return true; } };
  await top.cmdTop([], { once: true, ...flags }, { stream, stderr, isTty: false });
  return { out: chunks.join(''), err: errChunks.join('') };
}

test('top --once: a real mock run appears with its run row and lane rows', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', FLOW);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ security: 'ok1', style: 'ok2', judge: 'ok3' }));
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture, emit: () => {},
  });
  assert.equal(result.status, 'ok');

  const { out } = await snapshot();
  assert.match(out, /yoki-graph top — 0 active \/ 1 done/);
  assert.match(out, /● {3}top-flow/); // finished run, its declared name
  assert.match(out, /2\/2 Judge/);    // both phases consumed
  assert.match(out, /3\/3/);          // all three lanes done
  for (const label of ['security', 'style', 'judge']) {
    assert.ok(out.includes(label), `missing lane row for ${label}:\n${out}`);
  }
  // Snapshot mode: no ANSI escapes, no quit hint, token total present.
  assert.ok(!out.includes('\x1b'), 'snapshot must carry no ANSI');
  assert.ok(!out.includes('q quit'));
  assert.match(out, /tokens \d+/);
}));

test('top --once: a lane-derived runDir nests under its parent instead of listing top-level', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', FLOW);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ security: 'x', style: 'y', judge: 'z' }));
  const result = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture, emit: () => {},
  });

  // A lane run the way yoki-agent creates one: derived id, own runDir with
  // run.json and events.ndjson (agent-cli.js's observability contract).
  const laneId = `${result.runId}-lane-codex-security`;
  runner.writeRunMeta(laneId, {
    name: 'yoki-agent', backend: 'codex', status: 'ok',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  });
  const sink = createEventSink(runDir(laneId), { runId: laneId });
  sink.emit({ type: 'agent-start', index: 0, label: 'yoki-agent', backend: 'codex', model: 'g-5' });
  sink.emit({ type: 'agent-end', index: 0, label: 'yoki-agent', status: 'ok', durationMs: 1234, tokens: 77 });
  await sink.close();

  const { out } = await snapshot();
  // Exactly ONE top-level run block: the lane run must not count as a run.
  assert.match(out, /0 active \/ 1 done/);
  const lines = out.split('\n');
  const laneLine = lines.find((l) => l.includes('codex-security'));
  assert.ok(laneLine, `no nested lane row:\n${out}`);
  assert.ok(laneLine.startsWith('  '), `lane row not indented: ${JSON.stringify(laneLine)}`);
  assert.match(laneLine, /codex\/g-5/);
  assert.match(laneLine, /77/);
  // The child's tokens join the footer total alongside the parent's.
  const total = Number(/tokens (\d+)/.exec(out)[1]);
  assert.ok(total >= 77);
}));

test('top --once: status=running with a dead lock pid renders as stale (⚠)', () => withIsolatedState(async () => {
  const runId = 'run-stale-1';
  runner.writeRunMeta(runId, {
    name: 'wedged', backend: 'mock', status: 'running', startedAt: new Date().toISOString(),
  });
  const sink = createEventSink(runDir(runId), { runId });
  sink.emit({ type: 'run-start', name: 'wedged', backend: 'mock', phases: [] });
  sink.emit({ type: 'agent-start', index: 0, label: 'lane-a' });
  await sink.close();
  // A lock whose pid is certainly gone on this host: the run claims to be
  // running, nobody is behind the claim.
  fs.writeFileSync(path.join(runDir(runId), 'lock'), JSON.stringify({
    runId, pid: 999999999, host: os.hostname(), startedAt: new Date().toISOString(), token: 'x',
  }));

  const { out } = await snapshot();
  assert.match(out, /1 active \/ 0 done/); // stale still counts as needing attention
  assert.match(out, /⚠ {3}wedged/);

  // The same run with a LIVE pid (this process) is running, not stale.
  fs.writeFileSync(path.join(runDir(runId), 'lock'), JSON.stringify({
    runId, pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), token: 'x',
  }));
  const live = await snapshot();
  assert.match(live.out, /▶ {3}wedged/);
}));

test('top --once --columns: an override reshapes rows; broken JSON warns and falls back', () => withIsolatedState(async (cwd) => {
  const runId = 'run-cols-1';
  runner.writeRunMeta(runId, { name: 'colrun', backend: 'mock', status: 'ok', startedAt: new Date().toISOString() });
  const sink = createEventSink(runDir(runId), { runId });
  sink.emit({ type: 'run-start', name: 'colrun', backend: 'mock', phases: [] });
  sink.emit({ type: 'run-end', status: 'ok' });
  await sink.close();

  // A run table reduced to the id column only.
  const columnsFile = path.join(cwd, 'cols.json');
  fs.writeFileSync(columnsFile, JSON.stringify({ v: 1, run: [{ key: 'id', width: 40 }] }));
  const custom = await snapshot({ columns: columnsFile });
  assert.ok(custom.out.includes(runId), custom.out);
  assert.ok(!custom.out.includes('colrun'), 'name column should be gone under the override');
  assert.equal(custom.err, '');

  // Broken JSON: one warning line on stderr, default columns, exit path unchanged.
  fs.writeFileSync(columnsFile, '{ not json');
  const broken = await snapshot({ columns: columnsFile });
  assert.match(broken.err, /not valid JSON.*using default columns/s);
  assert.ok(broken.out.includes('colrun'), broken.out);
}));

test('top --once with an empty state root prints a complete empty screen and returns', () => withIsolatedState(async () => {
  const { out } = await snapshot();
  assert.match(out, /0 active \/ 0 done/);
  assert.match(out, /\(no runs\)/);
}));

// ---------------------------------------------------------------------------
// Live loop exit paths and watcher recovery (injected proc/watch/stdin)
// ---------------------------------------------------------------------------

const { EventEmitter } = require('node:events');

function fakeTty() {
  const frames = [];
  const stream = { write: (c) => { frames.push(String(c)); return true; }, isTTY: true };
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => { proc.exits.push(code); };
  return { frames, stream, stdin, proc };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('live view: SIGTERM restores the terminal (alt-screen exit) before exiting', () => withIsolatedState(async () => {
  const runId = 'run-live-1';
  runner.writeRunMeta(runId, { name: 'live', backend: 'mock', status: 'ok', startedAt: new Date().toISOString() });
  const { frames, stream, stdin, proc } = fakeTty();
  const done = top.cmdTop([], {}, { stream, isTty: true, stdin, proc });
  await sleep(200);
  proc.emit('SIGTERM');
  await done;
  const joined = frames.join('');
  // The restore sequence is the LAST thing written — the shell gets its
  // screen back no matter how the viewer went down.
  assert.ok(joined.endsWith('\x1b[?25h\x1b[?1049l'), JSON.stringify(joined.slice(-40)));
  assert.deepEqual(proc.exits, [143]); // 128 + SIGTERM(15)
  // cleanup unhooked its handlers: nothing of ours is left on the process.
  assert.equal(proc.listenerCount('SIGTERM') + proc.listenerCount('SIGINT') + proc.listenerCount('exit'), 0);
}));

test('live view: an errored run watcher is dropped and re-attached; the root watcher via the safety tick', () => withIsolatedState(async () => {
  const runId = 'run-live-2';
  runner.writeRunMeta(runId, { name: 'live2', backend: 'mock', status: 'ok', startedAt: new Date().toISOString() });
  const runPath = runDir(runId);
  const graphRootDir = path.dirname(runPath);

  // fs.watch stub: records every attach, hands back inert emitters whose
  // 'error' we can fire on demand.
  const watchers = [];
  const watch = (dir, cb) => {
    const w = new EventEmitter();
    w.dir = dir;
    w.closed = false;
    w.close = () => { w.closed = true; };
    w.cb = cb;
    watchers.push(w);
    return w;
  };
  const { stream, stdin, proc } = fakeTty();
  const done = top.cmdTop([], {}, {
    stream, isTty: true, stdin, proc, watch, safetyIntervalMs: 60,
  });
  await sleep(150); // first paint: root + run watcher attached
  const rootW = watchers.find((w) => w.dir === graphRootDir);
  const runW = watchers.find((w) => w.dir === runPath);
  assert.ok(rootW && runW, watchers.map((w) => w.dir).join(', '));

  runW.emit('error', new Error('fsevents died'));
  rootW.emit('error', new Error('fsevents died'));
  // The error path closes the dead handles immediately…
  assert.ok(runW.closed && rootW.closed);
  // …and within one safety tick (+ paint) both are watching again through
  // FRESH handles: the run watcher via the paint's sync, the root via the
  // tick's `if (!rootWatcher) watchRoot()`.
  await sleep(300);
  const freshRun = watchers.filter((w) => w.dir === runPath && !w.closed);
  const freshRoot = watchers.filter((w) => w.dir === graphRootDir && !w.closed);
  assert.equal(freshRun.length, 1, 'run watcher not re-attached');
  assert.equal(freshRoot.length, 1, 'root watcher not re-attached');
  // The re-attached run watcher is live: an event through it still paints.
  stdin.emit('data', 'q');
  await done;
  assert.deepEqual(proc.exits, []); // a normal quit never calls exit()
}));
