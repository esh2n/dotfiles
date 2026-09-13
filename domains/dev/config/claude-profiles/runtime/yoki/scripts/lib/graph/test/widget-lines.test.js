'use strict';

/**
 * widget-lines.js: the pi bottom widget's whole visible output, asserted
 * from fold-state fixtures — no pi, no jiti, no terminal. The .ts extension
 * that feeds it (domains/dev/config/pi/extensions/yoki-graph-widget.ts) is
 * deliberately reduced to watchers + setWidget glue so that everything a
 * user can SEE is covered here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { widgetLines, MAX_BODY_LINES } = require('../widget-lines');
const { displayWidth } = require('../top-render');
const { createTopState, foldTopEvent } = require('../top-fold');

const NOW = 100_000;

function envelopes(events, { startTs = 1000, stepMs = 1000, gen = 1, startSeq = 1 } = {}) {
  return events.map((event, i) => ({
    v: 1, seq: startSeq + i, gen, ts: startTs + i * stepMs, runId: 'run-x', ...event,
  }));
}

function foldedState(events, opts) {
  const state = createTopState();
  for (const line of envelopes(events, opts)) foldTopEvent(state, line);
  return state;
}

function runView(overrides = {}) {
  return {
    runId: 'run-1',
    state: createTopState(),
    liveness: 'running',
    meta: null,
    children: [],
    ...overrides,
  };
}

/** A run named `review` in phase 2/3 with lanes: #0 done, #1 running with
 *  ticks, #2 still pending (never started — no row). */
function typicalView() {
  return runView({
    state: foldedState([
      { type: 'run-start', name: 'review', backend: 'codex', phases: ['prep', '検証', 'judge'] },
      { type: 'phase', title: 'prep' },
      { type: 'phase', title: '検証' },
      { type: 'agent-start', index: 0, label: 'lint' },
      { type: 'agent-end', index: 0, status: 'ok', durationMs: 5000, tokens: 100 },
      { type: 'agent-start', index: 1, label: 'sec-review' },
      { type: 'agent-progress', index: 1, toolCalls: 12 },
    ]),
  });
}

// ---------------------------------------------------------------------------
// Visibility contract
// ---------------------------------------------------------------------------

test('widgetLines: no active runs means [] — the remove-the-widget cue', () => {
  assert.deepEqual(widgetLines([], 80, NOW), []);
  const done = runView({ liveness: 'ok', state: foldedState([{ type: 'run-start', name: 'x' }]) });
  const failed = runView({ liveness: 'error' });
  assert.deepEqual(widgetLines([done, failed], 80, NOW), []);
});

test('widgetLines: header counts active runs only, singular/plural', () => {
  const active = typicalView();
  const done = runView({ runId: 'run-2', liveness: 'ok' });
  assert.equal(widgetLines([active, done], 80, NOW)[0], 'yoki-graph ▶ 1 run');
  const second = runView({ runId: 'run-3', liveness: 'stale' });
  assert.equal(widgetLines([active, done, second], 80, NOW)[0], 'yoki-graph ▶ 2 runs');
});

// ---------------------------------------------------------------------------
// Run and lane rows
// ---------------------------------------------------------------------------

test('widgetLines: run row carries name, phase counter, elapsed, lane tally', () => {
  const lines = widgetLines([typicalView()], 120, NOW);
  // ts of run-start is 1000, NOW 100000 -> 99s -> 1m39s
  assert.equal(lines[1], '▶ review  検証 2/3  1m39s  lanes 1/2');
});

test('widgetLines: only ACTIVE lanes get rows; done lanes are just the tally', () => {
  const lines = widgetLines([typicalView()], 120, NOW);
  assert.equal(lines.length, 3); // header + run + one running lane
  // agent-start at ts 6000 -> 94s elapsed -> 1m34s
  assert.equal(lines[2], '  ◉ sec-review  12t  1m34s');
  assert.ok(!lines.some((l) => l.includes('lint')), 'done lane must not have its own row');
});

test('widgetLines: stale run renders the ⚠ liveness icon', () => {
  const view = runView({ liveness: 'stale', state: foldedState([{ type: 'run-start', name: 'wedged' }]) });
  const lines = widgetLines([view], 80, NOW);
  assert.ok(lines[1].startsWith('⚠ wedged'));
});

test('widgetLines: retrying lane shows ↻, needs-human shows 🔸 and hoists', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: 'r' },
      { type: 'agent-start', index: 0, label: 'first' },
      { type: 'agent-start', index: 1, label: 'second' },
      { type: 'agent-retry', index: 0, label: 'first' },
      { type: 'needs-human', index: 1, label: 'second' },
    ]),
  });
  const lines = widgetLines([view], 80, NOW);
  // needs-human lane is hoisted above the retrying one (laneList order).
  assert.ok(lines[2].startsWith('  🔸 second'));
  assert.ok(lines[3].startsWith('  ↻ first'));
});

// ---------------------------------------------------------------------------
// Overflow cap
// ---------------------------------------------------------------------------

/** One run whose lane fan-out alone exceeds the body cap; the needs-human
 *  lane is deliberately the LAST-started lane so a naive head-cut would
 *  drop exactly the line that must survive. */
function overflowView() {
  const events = [{ type: 'run-start', name: 'wide' }];
  for (let i = 0; i < 10; i += 1) events.push({ type: 'agent-start', index: i, label: `lane-${i}` });
  events.push({ type: 'needs-human', index: 9, label: 'lane-9' });
  return runView({ state: foldedState(events) });
}

test('widgetLines: body caps at MAX_BODY_LINES with an "… and N more" line', () => {
  const lines = widgetLines([overflowView()], 80, NOW);
  assert.equal(lines.length, 1 + MAX_BODY_LINES);
  // 11 entries (run row + 10 lanes), 7 kept -> 4 folded into the more-line.
  assert.equal(lines[lines.length - 1], '… and 4 more');
});

test('widgetLines: needs-human line survives the overflow cut', () => {
  const lines = widgetLines([overflowView()], 80, NOW);
  assert.ok(lines.some((l) => l.includes('🔸 lane-9')), '🔸 lane must not be cut');
});

test('widgetLines: surviving lines keep their original reading order', () => {
  const lines = widgetLines([overflowView()], 80, NOW);
  // laneList hoists the needs-human lane to the front of the lane block, so
  // reading order is: run row, 🔸 lane-9, then lane-0.. in start order.
  assert.ok(lines[1].startsWith('▶ wide'));
  assert.ok(lines[2].includes('lane-9'));
  assert.ok(lines[3].includes('lane-0'));
});

test('widgetLines: no more-line when the body fits exactly', () => {
  const events = [{ type: 'run-start', name: 'fit' }];
  for (let i = 0; i < MAX_BODY_LINES - 1; i += 1) {
    events.push({ type: 'agent-start', index: i, label: `l${i}` });
  }
  const lines = widgetLines([runView({ state: foldedState(events) })], 80, NOW);
  assert.equal(lines.length, 1 + MAX_BODY_LINES);
  assert.ok(!lines[lines.length - 1].includes('more'));
});

// ---------------------------------------------------------------------------
// Sanitation and width
// ---------------------------------------------------------------------------

test('widgetLines: control characters in labels never reach the output', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: 'evil\x1b]0;pwned\x07' },
      { type: 'agent-start', index: 0, label: 'a\tb\x1b[2Jc' },
    ]),
  });
  const joined = widgetLines([view], 200, NOW).join('\n');
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x08\x0B-\x1F\x7F\x80-\x9F]/.test(joined), 'raw control bytes leaked');
  assert.ok(joined.includes('evil�'), 'ESC replaced, remainder visibly marked');
});

test('widgetLines: every line fits the width in display cells (CJK-safe)', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: '多角レビューの長い名前がここにある' },
      { type: 'agent-start', index: 0, label: 'セキュリティレビューの長いラベル' },
    ]),
  });
  for (const width of [10, 24, 40]) {
    for (const line of widgetLines([view], width, NOW)) {
      assert.ok(displayWidth(line) <= width, `${JSON.stringify(line)} exceeds ${width} cells`);
    }
  }
});

// ---------------------------------------------------------------------------
// Nested lane runs (children)
// ---------------------------------------------------------------------------

test('widgetLines: child run rows use the lane suffix over the generic label', () => {
  const parent = typicalView();
  parent.children = [
    runView({
      runId: 'run-1-lane-security',
      laneLabel: 'security',
      state: foldedState([
        { type: 'agent-start', index: 0, label: 'yoki-agent' },
        { type: 'agent-progress', index: 0, toolCalls: 3 },
      ]),
    }),
  ];
  const lines = widgetLines([parent], 120, NOW);
  assert.ok(lines.some((l) => l.includes('◉ security  3t')), `missing child row in ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.includes('yoki-agent')));
});

test('widgetLines: an alive but silent child still gets a placeholder row', () => {
  const parent = typicalView();
  parent.children = [
    runView({ runId: 'run-1-lane-docs', laneLabel: 'docs', liveness: 'running' }),
  ];
  const lines = widgetLines([parent], 120, NOW);
  assert.ok(lines.some((l) => l.trim() === '◉ docs'), `missing placeholder in ${JSON.stringify(lines)}`);
});

test('widgetLines: a finished silent child adds no row', () => {
  const parent = typicalView();
  parent.children = [
    runView({ runId: 'run-1-lane-done', laneLabel: 'done', liveness: 'ok' }),
  ];
  assert.equal(widgetLines([parent], 120, NOW).length, 3);
});
