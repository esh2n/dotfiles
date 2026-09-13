'use strict';

/**
 * Result separation: an ok journal entry whose `result` JSON exceeds
 * INLINE_RESULT_MAX_BYTES moves the result into `<runDir>/results/` and the
 * journal line carries `resultRef` instead (journal.js).
 *
 * The properties pinned here, in order of how expensive they'd be to lose:
 *
 *  - resume replays a resultRef entry byte-for-byte (the side file IS the
 *    recorded result, reached through the same replayAt path);
 *  - a missing side file demotes the entry to a replay MISS — the run goes
 *    live from that call, it does not error;
 *  - an old-format journal (inline results, no resultRef) replays unchanged;
 *  - small results stay inline, so a normal run's journal grows no files.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('../runner');
const mockBackend = require('../backends/mock');
const { Journal, runDir, INLINE_RESULT_MAX_BYTES } = require('../journal');

function withIsolatedState(fn) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-results-state-'));
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-results-guard-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-results-cwd-'));
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

function writeScript(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Rewrite the mock fixture; the mock backend caches by path, so the cache
 *  must be dropped for the new contents to be served. */
function rewriteFixture(fixture, value) {
  fs.writeFileSync(fixture, JSON.stringify(value));
  mockBackend.clearFixtureCache();
}

/** Raw journal lines, parsed, in file order. */
function journalLines(runId) {
  const file = path.join(runDir(runId), 'journal.jsonl');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const ONE_CALL = `export const meta = { name: 'one', description: 'd' }
const r = await agent('the prompt', { label: 'call' })
return { r }`;

// A result whose JSON is comfortably past the inline threshold.
const BIG = { findings: 'x'.repeat(INLINE_RESULT_MAX_BYTES * 3), tail: '終わり' };

// ---------------------------------------------------------------------------
// Journal-level: where the result lands
// ---------------------------------------------------------------------------

test('an oversized ok result moves to results/ and the line carries resultRef', () => withIsolatedState(async () => {
  const journal = new Journal('results-unit-big');
  journal.append({ key: 'a'.repeat(64), index: 0, label: 'l', status: 'ok', result: BIG });

  const [line] = journalLines('results-unit-big');
  assert.ok(!('result' in line), 'the oversized result stayed inline');
  assert.match(line.resultRef, /^results\/0-a{12}\.json$/);
  const onDisk = JSON.parse(fs.readFileSync(path.join(runDir('results-unit-big'), line.resultRef), 'utf8'));
  assert.deepEqual(onDisk, BIG);
  // And the round trip through loadResult hands the same object back.
  assert.deepEqual(journal.loadResult(line), { ok: true, result: BIG });
}));

test('a small ok result stays inline — no side file, no extra IO', () => withIsolatedState(async () => {
  const journal = new Journal('results-unit-small');
  journal.append({ key: 'b'.repeat(64), index: 0, label: 'l', status: 'ok', result: { tiny: true } });

  const [line] = journalLines('results-unit-small');
  assert.deepEqual(line.result, { tiny: true });
  assert.ok(!('resultRef' in line));
  assert.ok(!fs.existsSync(path.join(runDir('results-unit-small'), 'results')), 'a results/ dir was created for an inline result');
}));

test('loadResult refuses a ref that could point outside the runDir', () => withIsolatedState(async () => {
  const journal = new Journal('results-unit-ref');
  assert.deepEqual(journal.loadResult({ status: 'ok', resultRef: '../other-run/results/0-x.json' }), { ok: false });
  assert.deepEqual(journal.loadResult({ status: 'ok', resultRef: 'results/../../journal.jsonl' }), { ok: false });
  assert.deepEqual(journal.loadResult({ status: 'ok', resultRef: '/etc/passwd' }), { ok: false });
}));

// ---------------------------------------------------------------------------
// End to end: resume against a separated result
// ---------------------------------------------------------------------------

test('resume replays a resultRef entry from its side file', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', ONE_CALL);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ call: BIG }));

  const first = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
  });
  assert.equal(first.status, 'ok');
  const [line] = journalLines(first.runId).filter((l) => l.status === 'ok');
  assert.ok(line.resultRef, 'the oversized result should have been separated');

  const events = [];
  const resumed = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
    runId: first.runId, emit: (e) => events.push(e),
  });
  assert.equal(resumed.status, 'ok');
  // Compared against the FIRST run's live result (a schemaless agent() call
  // resolves to text, so the mock's object fixture arrives as its JSON
  // string) — whatever shape the run recorded is the shape replay must return.
  assert.deepEqual(resumed.result.r, first.result.r, 'the replayed result must be the recorded one, byte for byte');
  assert.ok(events.some((e) => e.type === 'agent-cached'), 'the call must be replayed, not re-run');
  assert.ok(!events.some((e) => e.type === 'agent-start'), 'nothing should have run live');
}));

test('a deleted side file demotes the entry to a live re-run, not an error', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', ONE_CALL);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ call: BIG }));

  const first = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
  });
  fs.rmSync(path.join(runDir(first.runId), 'results'), { recursive: true, force: true });
  // Change the fixture so a live re-run is observable in the result too.
  rewriteFixture(fixture, { call: 'fresh answer' });

  const events = [];
  const resumed = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
    runId: first.runId, emit: (e) => events.push(e),
  });
  assert.equal(resumed.status, 'ok', resumed.error);
  assert.equal(resumed.result.r, 'fresh answer');
  assert.ok(events.some((e) => e.type === 'resume-diverged'), 'the unrecoverable entry must surface as a divergence');
  assert.ok(events.some((e) => e.type === 'agent-start'), 'the call must have run live');
  assert.ok(!events.some((e) => e.type === 'agent-cached'));
}));

test('an old-format journal (inline results, pre-gen lines) replays unchanged', () => withIsolatedState(async (cwd) => {
  const scriptPath = writeScript(cwd, 'flow.js', ONE_CALL);
  const fixture = path.join(cwd, 'fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ call: 'recorded answer' }));

  const first = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
  });
  // Rewrite the journal the way a pre-resultRef, pre-generation yoki wrote
  // it: result inline, no gen field. The keys are real (produced by this
  // run), which is exactly an old journal's situation.
  const file = path.join(runDir(first.runId), 'journal.jsonl');
  const old = journalLines(first.runId).map((line) => {
    const { gen, ...rest } = line;
    return JSON.stringify(rest);
  });
  fs.writeFileSync(file, `${old.join('\n')}\n`);
  rewriteFixture(fixture, { call: 'would be wrong' });

  const events = [];
  const resumed = await runner.executeScript({
    scriptPath, args: {}, backendName: 'mock', cwd, mockFile: fixture,
    runId: first.runId, emit: (e) => events.push(e),
  });
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.result.r, 'recorded answer', 'the old-format entry must replay, not re-run');
  assert.ok(events.some((e) => e.type === 'agent-cached'));
}));
