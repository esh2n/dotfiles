'use strict';

/**
 * top-fold.js: envelope event lines in, display state out — pure, so every
 * case here is a fixture list and an assertion, no files and no clocks.
 *
 * What matters most: the fold keeps FINISHED lanes (progress.js's own state
 * deletes them), it delegates the shared tallies to foldEvent unchanged,
 * and envelope bookkeeping (unknown `v` skipped, seq continuing across a
 * `gen` bump) matches events.js's written contract for readers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createTopState, foldTopEvent, laneList, completedSiblings } = require('../top-fold');

/** Envelope lines the way events.js writes them: v/seq/gen/ts + the event. */
function envelopes(events, { startTs = 1000, stepMs = 1000, gen = 1, startSeq = 1 } = {}) {
  return events.map((event, i) => ({
    v: 1, seq: startSeq + i, gen, ts: startTs + i * stepMs, runId: 'run-x', ...event,
  }));
}

function foldAll(state, lines) {
  for (const line of lines) foldTopEvent(state, line);
  return state;
}

test('a full run: phases advance, lanes survive their end, tokens accumulate', () => {
  const state = createTopState();
  foldAll(state, envelopes([
    { type: 'run-start', name: 'review', backend: 'mock', phases: ['Scan', 'Judge'] },
    { type: 'phase', title: 'Scan' },
    { type: 'agent-start', index: 0, label: 'security', backend: 'mock', model: 'm-1', phase: 'Scan' },
    { type: 'agent-progress', index: 0, label: 'security', toolCalls: 3 },
    { type: 'agent-end', index: 0, label: 'security', status: 'ok', durationMs: 2500, tokens: 120 },
    { type: 'phase', title: 'Judge' },
    { type: 'agent-start', index: 1, label: 'judge', backend: 'mock', model: 'm-1', phase: 'Judge' },
    { type: 'agent-end', index: 1, label: 'judge', status: 'ok', durationMs: 1200, tokens: 80 },
    { type: 'run-end', status: 'ok' },
  ]));

  assert.equal(state.progress.name, 'review');
  assert.equal(state.progress.phaseIndex, 2);
  assert.equal(state.progress.phases.length, 2);
  assert.equal(state.progress.done, 2);
  assert.equal(state.progress.finished, true);
  assert.equal(state.tokens, 200);
  assert.equal(state.startTs, 1000);
  assert.equal(state.endTs, 9000);

  // Both lanes are still there AFTER finishing — the whole reason this
  // module exists beside progress.js.
  const lanes = laneList(state);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].label, 'security');
  assert.equal(lanes[0].status, 'ok');
  assert.equal(lanes[0].durationMs, 2500);
  assert.equal(lanes[0].toolCalls, 3);
  assert.equal(lanes[1].tokens, 80);
});

test('lane transitions: retry marks and clears, cached and error are distinct states', () => {
  const state = createTopState();
  foldAll(state, envelopes([
    { type: 'agent-start', index: 0, label: 'a' },
    { type: 'agent-retry', index: 0, label: 'a', attempt: 1, retries: 2 },
  ]));
  assert.equal(laneList(state)[0].retrying, true);
  // A progress tick after the retry means the next attempt is live again.
  foldTopEvent(state, envelopes([{ type: 'agent-progress', index: 0, label: 'a', toolCalls: 1 }])[0]);
  assert.equal(laneList(state)[0].retrying, false);
  assert.equal(laneList(state)[0].retried, true);

  foldAll(state, envelopes([
    { type: 'agent-cached', index: 1, label: 'b' },
    { type: 'agent-start', index: 2, label: 'c' },
    { type: 'agent-end', index: 2, label: 'c', status: 'error', error: 'boom' },
  ], { startSeq: 4 }));
  const byLabel = Object.fromEntries(laneList(state).map((l) => [l.label, l]));
  assert.equal(byLabel.b.status, 'cached');
  assert.equal(byLabel.c.status, 'error');
  assert.equal(byLabel.c.error, 'boom');
  assert.equal(state.progress.replayed, 1);
  assert.equal(state.progress.failed, 1);
});

test('gen bump: seq continues across a reopen and folds as one history', () => {
  const state = createTopState();
  // Writer 1 (gen 1): seq 1..2. Writer 2 (gen 2, a rerun of the same lane
  // command in the same runDir): seq continues at 3 — events.js's sequential
  // reopen contract.
  foldAll(state, envelopes([
    { type: 'run-start', name: 'lane', backend: 'mock', phases: [] },
    { type: 'agent-start', index: 0, label: 'work' },
  ], { gen: 1, startSeq: 1 }));
  foldAll(state, envelopes([
    { type: 'agent-end', index: 0, label: 'work', status: 'ok', durationMs: 10, tokens: 5 },
    { type: 'run-end', status: 'ok' },
  ], { gen: 2, startSeq: 3, startTs: 5000 }));

  assert.equal(state.lastSeq, 4);
  assert.equal(state.lastGen, 2);
  assert.equal(state.seqGaps, 0); // continuation, not loss
  assert.equal(laneList(state)[0].status, 'ok');
  assert.equal(state.tokens, 5);
});

test('a seq jump is counted as a gap, and an unknown envelope version is skipped whole', () => {
  const state = createTopState();
  foldAll(state, [
    { v: 1, seq: 1, gen: 1, ts: 1, type: 'agent-start', index: 0, label: 'a' },
    // seq 2 lost (dropped by a broken sink) — 3 arrives next.
    { v: 1, seq: 3, gen: 1, ts: 3, type: 'agent-end', index: 0, label: 'a', status: 'ok', tokens: 9, durationMs: 1 },
    // A future envelope version: the reader must skip it, not half-apply it.
    { v: 2, seq: 4, gen: 1, ts: 4, type: 'agent-end', index: 5, label: 'future', status: 'ok', tokens: 1000 },
  ]);
  assert.equal(state.seqGaps, 1);
  assert.equal(state.skipped, 1);
  assert.equal(state.tokens, 9); // the v:2 line's tokens never landed
  assert.equal(state.lanes.size, 1);
});

test('needs-human (reserved type): accepted, flags the lane, and hoists it first', () => {
  const state = createTopState();
  foldAll(state, envelopes([
    { type: 'agent-start', index: 0, label: 'first' },
    { type: 'agent-start', index: 1, label: 'blocked' },
    { type: 'needs-human', index: 1, label: 'blocked' },
  ]));
  assert.equal(state.needsHuman, true);
  const lanes = laneList(state);
  assert.equal(lanes[0].label, 'blocked'); // hoisted past first-seen order
  assert.equal(lanes[0].needsHuman, true);
  assert.equal(lanes[1].label, 'first');
});

test('completedSiblings: ok lanes with real durations only — errors and replays are no prior', () => {
  const state = createTopState();
  foldAll(state, envelopes([
    { type: 'agent-start', index: 0, label: 'me' },
    { type: 'agent-start', index: 1, label: 'ok-lane' },
    { type: 'agent-end', index: 1, label: 'ok-lane', status: 'ok', durationMs: 4000, tokens: 1 },
    { type: 'agent-start', index: 2, label: 'err-lane' },
    { type: 'agent-end', index: 2, label: 'err-lane', status: 'error', durationMs: 50 },
    { type: 'agent-cached', index: 3, label: 'replayed' },
  ]));
  const siblings = completedSiblings(state, 0);
  assert.equal(siblings.length, 1);
  assert.equal(siblings[0].durationMs, 4000);
  // The asking lane itself is excluded even once it finishes.
  foldTopEvent(state, envelopes([
    { type: 'agent-end', index: 0, label: 'me', status: 'ok', durationMs: 9999 },
  ], { startSeq: 9 })[0]);
  assert.equal(completedSiblings(state, 0).length, 1);
});

test('malformed lines change nothing: no index, not an object, missing type', () => {
  const state = createTopState();
  foldAll(state, [
    null,
    'not an object',
    { v: 1, seq: 1, gen: 1, ts: 1, type: 'agent-start', label: 'no-index' },
    { v: 1, seq: 2, gen: 1, ts: 2 },
  ]);
  assert.equal(state.lanes.size, 0);
});
