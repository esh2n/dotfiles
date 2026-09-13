'use strict';

/**
 * top-render.js: fold state in, strings out — all pure, so the snapshot
 * format, the column-schema override path and the full-width arithmetic
 * are asserted directly, with no terminal and no files.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const render = require('../top-render');
const { createTopState, foldTopEvent } = require('../top-fold');

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

// ---------------------------------------------------------------------------
// Display width and truncation (full-width text)
// ---------------------------------------------------------------------------

test('displayWidth: ASCII is 1 cell, CJK is 2, mixed adds up', () => {
  assert.equal(render.displayWidth('abc'), 3);
  assert.equal(render.displayWidth('日本語'), 6);
  assert.equal(render.displayWidth('a日b'), 4);
  assert.equal(render.displayWidth(''), 0);
});

test('truncateToWidth counts cells, not characters', () => {
  // 6 chars but 12 cells: cutting at 7 cells must keep only 3 kanji (6
  // cells) plus the ellipsis — a length-based cut would keep 6 chars and
  // overflow the column by 5 cells.
  assert.equal(render.truncateToWidth('検証済判定行', 7), '検証済…');
  assert.equal(render.truncateToWidth('abcdef', 4), 'abc…');
  assert.equal(render.truncateToWidth('abc', 3), 'abc'); // fits untouched
  assert.equal(render.truncateToWidth('abcd', 1), '…');
});

test('padCell pads by display cells so mixed-width columns align', () => {
  const a = render.padCell('日本', 8, 'left');
  const b = render.padCell('abcd', 8, 'left');
  assert.equal(render.displayWidth(a), 8);
  assert.equal(render.displayWidth(b), 8);
  assert.equal(render.padCell('42', 5, 'right'), '   42');
});

// ---------------------------------------------------------------------------
// Control-character sanitation (labels/names are external text)
// ---------------------------------------------------------------------------

/** Any raw C0 (incl. ESC), DEL or C1 byte — what must never reach a cell. */
// eslint-disable-next-line no-control-regex
const RAW_CONTROL_RE = /[\x00-\x1F\x7F\x80-\x9F]/;

test('sanitizeText: C0/DEL/C1 become U+FFFD, tab becomes one space, ESC dies with its sequence', () => {
  assert.equal(render.sanitizeText('a\tb'), 'a b');
  assert.equal(render.sanitizeText('a\x00b\x1Fc\x7Fd\x9Be'), 'a�b�c�d�e');
  // OSC terminal-retitle and CSI clear-screen: the ESC (and BEL) are
  // replaced, so no terminal will ever interpret the remainder.
  const osc = render.sanitizeText('\x1b]0;pwned\x07x');
  const csi = render.sanitizeText('\x1b[2Jx');
  assert.ok(!RAW_CONTROL_RE.test(osc), JSON.stringify(osc));
  assert.ok(!RAW_CONTROL_RE.test(csi), JSON.stringify(csi));
  assert.ok(!osc.includes('\x1b') && !csi.includes('\x1b'));
});

test('a hostile label renders with no raw control characters and stays one line', () => {
  const state = foldedState([
    { type: 'run-start', name: 'evil\x1b[2Jrun', backend: 'mock', phases: [] },
    { type: 'agent-start', index: 0, label: '\x1b]0;pwned\x07lane\nsecond' },
  ]);
  const { columns } = render.resolveColumns(null);
  const view = runView({ state });
  const laneRow = render.renderLaneRow(state.lanes.get(0), view, columns.lane, 2000);
  const runRow = render.renderRunRow(view, columns.run, 2000);
  for (const row of [laneRow, runRow]) {
    assert.ok(!RAW_CONTROL_RE.test(row), JSON.stringify(row));
    assert.ok(!row.includes('\x1b'), JSON.stringify(row));
    assert.ok(!row.includes('\n'), 'an embedded newline must not split the row');
  }
});

test('width arithmetic runs on the SANITIZED string, not the raw one', () => {
  // Raw: ESC + "]0;pwned" + BEL + "abc" = 13 chars; sanitized:
  // "�]0;pwned�abc" = 13 cells. A 13-cell column must hold it
  // exactly (no truncation) and every cell after sanitation is printable.
  const label = '\x1b]0;pwned\x07abc';
  const cell = render.padCell(label, 13, 'left');
  assert.equal(cell, '�]0;pwned�abc');
  assert.equal(render.displayWidth(cell), 13);
  // And truncating a string that sanitizes to something wider still lands
  // exactly on budget, with no raw control byte surviving the cut.
  const cut = render.padCell(`${label}日本語`, 10, 'left');
  assert.ok(!RAW_CONTROL_RE.test(cut));
  assert.equal(render.displayWidth(cut), 10);
});

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

test('renderBar: null renders nothing (no gauge that reads as 0%)', () => {
  assert.equal(render.renderBar(null, 10), '');
  assert.equal(render.renderBar(undefined, 10), '');
});

test('renderBar: full cells are ⣿ and the boundary cell steps the ramp', () => {
  assert.equal(render.renderBar(1, 4), '⣿⣿⣿⣿');
  assert.equal(render.renderBar(0.5, 4), '⣿⣿');
  const half = render.renderBar(0.55, 4); // 2.2 cells: 2 full + a low step
  assert.ok(half.startsWith('⣿⣿'));
  assert.equal(half.length, 3);
  assert.ok(render.BAR_RAMP.includes(half[2]));
});

// ---------------------------------------------------------------------------
// Column schema
// ---------------------------------------------------------------------------

test('resolveColumns: null/undefined is silently the default layout', () => {
  const { columns, warnings } = render.resolveColumns(null);
  assert.deepEqual(warnings, []);
  assert.deepEqual(columns.run.map((c) => c.key), render.DEFAULT_RUN_COLUMNS);
  assert.deepEqual(columns.lane.map((c) => c.key), render.DEFAULT_LANE_COLUMNS);
});

test('resolveColumns: a valid override reorders, resizes and right-aligns', () => {
  const { columns, warnings } = render.resolveColumns({
    v: 1,
    run: [{ key: 'name', width: 10 }, { key: 'tokens', align: 'right' }],
    lane: [{ key: 'label', width: 30 }, { key: 'tokens', align: 'right' }],
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(columns.run, [
    { key: 'name', width: 10, align: 'left' },
    { key: 'tokens', width: render.RUN_COLUMN_DEFS.tokens.width, align: 'right' },
  ]);
  assert.equal(columns.lane[0].width, 30);
});

test('resolveColumns: unknown keys are dropped with a warning, never fatal', () => {
  const { columns, warnings } = render.resolveColumns({
    v: 1,
    run: [{ key: 'name' }, { key: 'cpu' }],
  });
  assert.deepEqual(columns.run.map((c) => c.key), ['name']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown column "cpu"/);
  // The untouched table keeps its defaults.
  assert.deepEqual(columns.lane.map((c) => c.key), render.DEFAULT_LANE_COLUMNS);
});

test('resolveColumns: wholesale-broken input falls back to defaults with a warning', () => {
  for (const bad of ['a string', [1], { v: 99 }, { v: 1, run: 'nope' }]) {
    const { columns, warnings } = render.resolveColumns(bad);
    assert.deepEqual(columns.run.map((c) => c.key), render.DEFAULT_RUN_COLUMNS, JSON.stringify(bad));
    assert.ok(warnings.length >= 1, JSON.stringify(bad));
  }
  // A table whose every entry was dropped also falls back.
  const emptied = render.resolveColumns({ v: 1, lane: [{ key: 'nope' }] });
  assert.deepEqual(emptied.columns.lane.map((c) => c.key), render.DEFAULT_LANE_COLUMNS);
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const RUN_EVENTS = [
  { type: 'run-start', name: 'review', backend: 'mock', phases: ['Scan', 'Judge'] },
  { type: 'phase', title: 'Scan' },
  { type: 'agent-start', index: 0, label: 'security', backend: 'mock', model: 'm-big', phase: 'Scan' },
  { type: 'agent-progress', index: 0, label: 'security', toolCalls: 4 },
  { type: 'agent-end', index: 0, label: 'security', status: 'ok', durationMs: 3000, tokens: 150 },
  { type: 'agent-start', index: 1, label: 'style', backend: 'mock', model: 'm-big', phase: 'Scan' },
];

test('run row: icon, name, backend, phase counter, elapsed, tokens, lane counts', () => {
  const state = foldedState(RUN_EVENTS);
  const view = runView({ state });
  const { columns } = render.resolveColumns(null);
  const row = render.renderRunRow(view, columns.run, 61000);
  assert.match(row, /^▶ {3}review/); // icon cell (width 2) + the 2-space gap
  assert.match(row, /mock/);
  assert.match(row, /1\/2 Scan/);
  assert.match(row, /1m00s/); // run-start ts 1000 -> now 61000
  assert.match(row, /150/);
  assert.match(row, /1\/2$/); // one lane done of two seen
});

test('run row liveness icons: stale runs show ⚠, finished ones ● / ✗', () => {
  const state = foldedState(RUN_EVENTS);
  const { columns } = render.resolveColumns(null);
  assert.match(render.renderRunRow(runView({ state, liveness: 'stale' }), columns.run, 61000), /^⚠/);
  assert.match(render.renderRunRow(runView({ state, liveness: 'ok' }), columns.run, 61000), /^●/);
  assert.match(render.renderRunRow(runView({ state, liveness: 'error' }), columns.run, 61000), /^✗/);
});

test('lane rows: finished lane shows its duration and tokens; running lane shows live elapsed and ticks', () => {
  const state = foldedState(RUN_EVENTS);
  const view = runView({ state });
  const { columns } = render.resolveColumns(null);
  const lanes = state.lanes;
  const doneRow = render.renderLaneRow(lanes.get(0), view, columns.lane, 61000);
  assert.match(doneRow, /^ {2}● {1}/);
  assert.match(doneRow, /security/);
  assert.match(doneRow, /mock\/m-big/);
  assert.match(doneRow, /3s/); // durationMs, not now - startedTs
  assert.match(doneRow, /150/);
  const liveRow = render.renderLaneRow(lanes.get(1), view, columns.lane, 61000);
  assert.match(liveRow, /^ {2}◉/);
  // agent-start at ts 6000 -> 55s elapsed at now 61000
  assert.match(liveRow, /55s/);
});

test('lane bar: running lane with a finished sibling gets a bar, without one it gets nothing', () => {
  const state = foldedState(RUN_EVENTS);
  const view = runView({ state });
  const { columns } = render.resolveColumns(null);
  const withSibling = render.renderLaneRow(state.lanes.get(1), view, columns.lane, 7000);
  assert.ok([...withSibling].some((ch) => render.BAR_RAMP.includes(ch)), withSibling);

  // Same lane, but in a run whose only other activity has not finished:
  // no prior, no bar — the row simply ends after the numeric columns.
  const lonely = foldedState(RUN_EVENTS.slice(0, 4)); // security still running
  const lonelyRow = render.renderLaneRow(lonely.lanes.get(0), runView({ state: lonely }), columns.lane, 7000);
  assert.ok(![...lonelyRow].some((ch) => render.BAR_RAMP.includes(ch)), lonelyRow);
});

test('a 全角 label longer than its column truncates by cells with an ellipsis', () => {
  const state = foldedState([
    { type: 'agent-start', index: 0, label: '長い日本語のレーンラベルをここに置く' },
  ]);
  const { columns } = render.resolveColumns({ v: 1, lane: [{ key: 'label', width: 10 }] });
  const row = render.renderLaneRow(state.lanes.get(0), runView({ state }), columns.lane, 2000);
  const cell = row.slice(2); // strip the lane indent
  assert.ok(cell.includes('…'), cell);
  assert.ok(render.displayWidth(cell) <= 10, `${cell} is ${render.displayWidth(cell)} cells`);
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

test('renderScreen: header counts, blocks per run, nested lane runs, token footer', () => {
  const parent = runView({
    runId: 'run-1',
    state: foldedState(RUN_EVENTS),
    children: [{
      runId: 'run-1-lane-codex-security',
      laneLabel: 'codex-security',
      liveness: 'ok',
      meta: null,
      state: foldedState([
        { type: 'agent-start', index: 0, label: 'yoki-agent', backend: 'codex', model: 'g-5' },
        { type: 'agent-end', index: 0, label: 'yoki-agent', status: 'ok', durationMs: 1000, tokens: 40 },
      ]),
    }],
  });
  const doneRun = runView({ runId: 'run-2', liveness: 'ok', state: foldedState([
    { type: 'run-start', name: 'research', backend: 'mock', phases: [] },
    { type: 'run-end', status: 'ok' },
  ]) });
  const { columns } = render.resolveColumns(null);
  const screen = render.renderScreen([parent, doneRun], columns, 61000);

  assert.match(screen, /yoki-graph top — 1 active \/ 1 done — \d\d:\d\d:\d\d\n/);
  assert.match(screen, /review/);
  assert.match(screen, /research/);
  // The nested lane run appears as a lane row named by its lane suffix,
  // not by the transport's generic 'yoki-agent' label.
  assert.match(screen, /codex-security/);
  assert.ok(!screen.includes('yoki-agent'));
  // Footer: parent 150 + child 40 tokens, and the quit hint by default.
  assert.match(screen, /tokens 190 — q quit\n$/);
  // Snapshot mode drops the hint.
  assert.match(render.renderScreen([parent], columns, 61000, { hint: null }), /tokens 190\n$/);
});

test('renderScreen: no runs at all still renders a complete screen', () => {
  const { columns } = render.resolveColumns(null);
  const screen = render.renderScreen([], columns, 0);
  assert.match(screen, /0 active \/ 0 done/);
  assert.match(screen, /\(no runs\)/);
});
