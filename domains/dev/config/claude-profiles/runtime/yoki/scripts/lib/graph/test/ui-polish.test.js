'use strict';

/**
 * The visual-polish layer over the three display surfaces (pi widget /
 * `top` / `list`): proportional segment bars, kubectl-style headers and
 * AGE, the color layer, and the rich widget layout.
 *
 * The structural invariant everything here defends: ANSI is applied ONLY
 * after sanitize/truncate/pad — stripping the escapes from any colored
 * output must yield BYTE-IDENTICAL plain output, and no colorless path
 * ever contains an escape byte.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const render = require('../top-render');
const { formatElapsed } = require('../progress');
const { widgetLines, widgetLinesRich, MAX_BODY_LINES } = require('../widget-lines');
const { createTopState, foldTopEvent } = require('../top-fold');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => text.replace(ANSI_RE, '');

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
    runId: 'run-1', state: createTopState(), liveness: 'running', meta: null, children: [], ...overrides,
  };
}

// ---------------------------------------------------------------------------
// segmentBar — largest-remainder cell allocation
// ---------------------------------------------------------------------------

test('segmentBar: floors first, leftover cells to the largest remainders', () => {
  // 2/3 and 1/3 of 10 cells: floors 6+3, the leftover cell goes to the
  // .667 remainder — 7/3, never 6/4.
  const segs = render.segmentBar([
    { role: 'success', count: 2 },
    { role: 'accent', count: 1 },
  ], 10);
  assert.deepEqual(segs.map((s) => [s.role, s.text.length]), [['success', 7], ['accent', 3]]);
});

test('segmentBar: always sums to exactly the requested width', () => {
  for (const counts of [[1, 1, 1], [5, 3, 1], [7, 2, 2], [1, 0, 99]]) {
    for (const width of [3, 10, 12, 31]) {
      const segs = render.segmentBar([
        { role: 'a', count: counts[0] },
        { role: 'b', count: counts[1] },
        { role: 'c', count: counts[2] },
      ], width);
      const total = segs.reduce((sum, s) => sum + s.text.length, 0);
      assert.equal(total, width, `${counts} @ ${width}`);
    }
  }
});

test('segmentBar: remainder ties break by part order, deterministically', () => {
  // 1/1 of 3 cells: both remainders are .5 — the FIRST part gets the extra.
  const segs = render.segmentBar([
    { role: 'a', count: 1 },
    { role: 'b', count: 1 },
  ], 3);
  assert.deepEqual(segs.map((s) => [s.role, s.text.length]), [['a', 2], ['b', 1]]);
});

test('segmentBar: zero counts and zero totals render no segments', () => {
  assert.deepEqual(render.segmentBar([{ role: 'a', count: 0 }], 10), []);
  assert.deepEqual(render.segmentBar([], 10), []);
  // A part squeezed to zero cells is dropped, not emitted empty.
  const segs = render.segmentBar([
    { role: 'big', count: 99 },
    { role: 'tiny', count: 1 },
  ], 4);
  assert.deepEqual(segs.map((s) => s.role), ['big']);
  assert.equal(segs[0].text, render.SEGMENT_CHAR.repeat(4));
});

// ---------------------------------------------------------------------------
// Segments: truncate before paint
// ---------------------------------------------------------------------------

test('truncateSegments cuts by display cells across segment boundaries', () => {
  const segs = [
    { role: 'a', text: 'abc' },
    { role: 'b', text: '日本語' },
  ];
  const cut = render.truncateSegments(segs, 6);
  // 3 (abc) + 2 (日) = 5 cells + ellipsis = 6.
  assert.deepEqual(cut, [
    { role: 'a', text: 'abc' },
    { role: 'b', text: '日' },
    { role: null, text: '…' },
  ]);
  // Fits untouched — same array content, no ellipsis.
  assert.deepEqual(render.truncateSegments(segs, 9), segs);
});

test('paintSegments: identity without paint; roles wrapped after the cut', () => {
  const segs = [{ role: 'accent', text: 'run' }, { role: null, text: ' rest' }];
  assert.equal(render.paintSegments(segs), 'run rest');
  const painted = render.paintSegments(segs, (role, text) => `<${role}>${text}</${role}>`);
  assert.equal(painted, '<accent>run</accent> rest');
});

test('createAnsiPaint: colors close with 39, attributes with 22, empty text passes through', () => {
  const paint = render.createAnsiPaint();
  assert.equal(paint('success', 'ok'), '\x1b[32mok\x1b[39m');
  assert.equal(paint('dim', 'x'), '\x1b[2mx\x1b[22m');
  assert.equal(paint('nonsense', 'x'), 'x');
  assert.equal(paint('accent', ''), '');
});

// ---------------------------------------------------------------------------
// formatTokens / formatElapsed (AGE)
// ---------------------------------------------------------------------------

test('formatTokens: compact k/M forms, empty for zero or absent', () => {
  assert.equal(render.formatTokens(842), '842');
  assert.equal(render.formatTokens(9640), '9.6k');
  assert.equal(render.formatTokens(12000), '12k');
  assert.equal(render.formatTokens(128400), '128k');
  assert.equal(render.formatTokens(1234567), '1.2M');
  assert.equal(render.formatTokens(0), '');
  assert.equal(render.formatTokens(undefined), '');
});

test('formatElapsed: kubectl AGE style past the hour, m/s below it unchanged', () => {
  assert.equal(formatElapsed(42_000), '42s');
  assert.equal(formatElapsed(133_000), '2m13s');
  assert.equal(formatElapsed(3_840_000), '1h04m'); // 64 minutes
  assert.equal(formatElapsed(2 * 3600_000 + 30 * 60_000), '2h30m');
});

// ---------------------------------------------------------------------------
// top: column header row and the paint layer
// ---------------------------------------------------------------------------

const RUN_EVENTS = [
  { type: 'run-start', name: 'review', backend: 'mock', phases: ['Scan', 'Judge'] },
  { type: 'phase', title: 'Scan' },
  { type: 'agent-start', index: 0, label: 'security', backend: 'mock', model: 'm-big', phase: 'Scan' },
  { type: 'agent-end', index: 0, label: 'security', status: 'ok', durationMs: 3000, tokens: 150 },
  { type: 'agent-start', index: 1, label: 'style', backend: 'mock', model: 'm-big', phase: 'Scan' },
];

test('renderScreen: kubectl-style header row labels the default run columns', () => {
  const { columns } = render.resolveColumns(null);
  const screen = render.renderScreen([runView({ state: foldedState(RUN_EVENTS) })], columns, 61000);
  const lines = screen.split('\n');
  // Title, blank, then the header row over the first run row.
  assert.match(lines[2], /NAME\s+BACKEND\s+PHASE\s+AGE\s+TOKENS\s+LANES/);
  // The labels sit exactly over their columns: NAME starts where the name
  // cell starts (status column is 2 cells + the 2-cell gap).
  assert.equal(lines[2].indexOf('NAME'), lines[3].indexOf('review'));
  assert.ok(lines[2].indexOf('AGE') >= 0);
});

test('renderScreen: header row follows a schema override; no header without runs', () => {
  const { columns } = render.resolveColumns({ v: 1, run: [{ key: 'id', width: 30 }, { key: 'elapsed' }] });
  const screen = render.renderScreen([runView({ state: foldedState(RUN_EVENTS) })], columns, 61000);
  const header = screen.split('\n')[2];
  assert.match(header, /^ID\s+AGE$/);
  assert.doesNotMatch(render.renderScreen([], columns, 0), /\bID\b/);
});

test('renderScreen with paint: stripping the ANSI yields the plain screen, byte for byte', () => {
  const parent = runView({ state: foldedState(RUN_EVENTS) });
  const { columns } = render.resolveColumns(null);
  const plain = render.renderScreen([parent], columns, 61000);
  const colored = render.renderScreen([parent], columns, 61000, { paint: render.createAnsiPaint() });
  assert.notEqual(colored, plain);
  assert.equal(stripAnsi(colored), plain);
});

test('renderScreen with paint: status icons carry state colors; data cells stay plain', () => {
  const { columns } = render.resolveColumns(null);
  const paint = render.createAnsiPaint();
  const running = render.renderRunRow(runView({ state: foldedState(RUN_EVENTS) }), columns.run, 61000, paint);
  assert.ok(running.startsWith('\x1b[36m▶'), JSON.stringify(running.slice(0, 12)));
  assert.ok(!stripAnsi(running).includes('\x1b'));
  // The name cell itself is not wrapped: after the icon cell's reset, the
  // next escape (if any) must not appear before the row's data.
  assert.match(stripAnsi(running), /^▶ {3}review/);
  const stale = render.renderRunRow(runView({ state: foldedState(RUN_EVENTS), liveness: 'stale' }), columns.run, 61000, paint);
  assert.ok(stale.startsWith('\x1b[33m⚠'));
  const state = foldedState(RUN_EVENTS);
  const okLane = render.renderLaneRow(state.lanes.get(0), runView({ state }), columns.lane, 61000, paint);
  assert.ok(okLane.startsWith('  \x1b[32m●'), JSON.stringify(okLane.slice(0, 12)));
});

test('run/lane rows without paint carry no escape byte and match the historical shape', () => {
  const state = foldedState(RUN_EVENTS);
  const { columns } = render.resolveColumns(null);
  const row = render.renderRunRow(runView({ state }), columns.run, 61000);
  assert.ok(!row.includes('\x1b'));
  assert.equal(row, row.replace(/\s+$/, ''), 'no trailing whitespace');
});

// ---------------------------------------------------------------------------
// widgetLinesRich — layout
// ---------------------------------------------------------------------------

/** review run: lane #0 finished (prior for the estimator), #1 running with
 *  ticks, #2 running but needs-human. */
function richView() {
  return runView({
    state: foldedState([
      { type: 'run-start', name: 'review', backend: 'codex', phases: ['prep', '検証', 'judge'] },
      { type: 'phase', title: 'prep' },
      { type: 'phase', title: '検証' },
      { type: 'agent-start', index: 0, label: 'lint' },
      { type: 'agent-end', index: 0, status: 'ok', durationMs: 60000, tokens: 4200, toolCalls: 20 },
      { type: 'agent-start', index: 1, label: 'sec-review' },
      { type: 'agent-progress', index: 1, toolCalls: 12 },
      { type: 'agent-start', index: 2, label: 'judge' },
      { type: 'needs-human', index: 2, label: 'judge' },
    ]),
  });
}

const NOW = 100_000;

test('widgetLinesRich: full plain layout — header with token total, segment bar, aligned lane columns', () => {
  const lines = widgetLinesRich([richView()], 64, NOW);
  assert.deepEqual(lines, [
    'yoki-graph ▶ 1 run                                    Σ 4.2k tok',
    '▶ review  検証 2/3  1m39s  ━━━━━━━━━━  1/3',
    '  🔸 judge                           1m32s',
    '  ◉  sec-review  ⣿⣿⣿⣿⣀ 85%    12t    1m34s',
  ]);
});

test('widgetLinesRich: lane numeric columns align across rows', () => {
  const lines = widgetLinesRich([richView()], 64, NOW);
  const judge = lines[2];
  const sec = lines[3];
  // Same right edge for the elapsed column…
  assert.equal(render.displayWidth(judge), render.displayWidth(sec));
  // …and the label column starts at the same display offset (icon cell is
  // 2 cells + 1 gap regardless of the icon's own width).
  assert.equal(judge.indexOf('judge'), 5);
  assert.equal(render.displayWidth(sec.slice(0, sec.indexOf('sec-review'))), 5);
});

test('widgetLinesRich: no finished sibling means no bar and no % column', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: 'solo' },
      { type: 'agent-start', index: 0, label: 'only' },
      { type: 'agent-progress', index: 0, toolCalls: 3 },
    ]),
  });
  const joined = widgetLinesRich([view], 80, NOW).join('\n');
  assert.ok(![...joined].some((ch) => render.BAR_RAMP.includes(ch)), joined);
  assert.ok(!joined.includes('%'), joined);
});

test('widgetLinesRich: a needs-human lane never shows a progress bar', () => {
  const lines = widgetLinesRich([richView()], 64, NOW);
  const judge = lines.find((l) => l.includes('judge'));
  assert.ok(![...judge].some((ch) => render.BAR_RAMP.includes(ch)), judge);
});

test('widgetLinesRich: header token total includes nested lane runs and drops when it cannot fit', () => {
  const parent = richView();
  parent.children = [runView({
    runId: 'run-1-lane-security',
    laneLabel: 'security',
    state: foldedState([
      { type: 'agent-start', index: 0, label: 'yoki-agent' },
      { type: 'agent-end', index: 0, status: 'ok', durationMs: 1000, tokens: 800 },
    ]),
    liveness: 'running',
  })];
  const wide = widgetLinesRich([parent], 64, NOW);
  assert.match(wide[0], /Σ 5k tok$/); // 4200 + 800
  const narrow = widgetLinesRich([parent], 24, NOW);
  assert.equal(narrow[0], 'yoki-graph ▶ 1 run');
});

test('widgetLinesRich: same visibility contract as widgetLines — [] when idle, cap + needs-human survival', () => {
  assert.deepEqual(widgetLinesRich([], 80, NOW), []);
  assert.deepEqual(widgetLinesRich([runView({ liveness: 'ok' })], 80, NOW), []);

  const events = [{ type: 'run-start', name: 'wide' }];
  for (let i = 0; i < 10; i += 1) events.push({ type: 'agent-start', index: i, label: `lane-${i}` });
  events.push({ type: 'needs-human', index: 9, label: 'lane-9' });
  const lines = widgetLinesRich([runView({ state: foldedState(events) })], 80, NOW);
  assert.equal(lines.length, 1 + MAX_BODY_LINES);
  assert.match(lines[lines.length - 1], /^… and 4 more$/);
  assert.ok(lines.some((l) => l.includes('🔸 lane-9')), 'needs-human line must survive the cut');
});

test('widgetLinesRich: every line fits the width in display cells (CJK labels)', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: '多角レビューの長い名前' },
      { type: 'agent-start', index: 0, label: 'セキュリティレビューの長いラベル' },
      { type: 'agent-start', index: 1, label: '短い' },
    ]),
  });
  for (const width of [12, 30, 48]) {
    for (const line of widgetLinesRich([view], width, NOW)) {
      assert.ok(render.displayWidth(line) <= width, `${JSON.stringify(line)} exceeds ${width}`);
    }
  }
});

test('widgetLinesRich: control characters die before layout, exactly like widgetLines', () => {
  const view = runView({
    state: foldedState([
      { type: 'run-start', name: 'evil\x1b]0;pwned\x07' },
      { type: 'agent-start', index: 0, label: 'a\tb\x1b[2Jc' },
    ]),
  });
  const joined = widgetLinesRich([view], 200, NOW).join('\n');
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x08\x0B-\x1F\x7F\x80-\x9F]/.test(joined), 'raw control bytes leaked');
  assert.ok(joined.includes('evil�'));
});

// ---------------------------------------------------------------------------
// widgetLinesRich — color contract
// ---------------------------------------------------------------------------

test('widgetLinesRich: paint wraps state and chrome, labels stay plain; strip equals plain output', () => {
  const paint = (role, text) => `«${role}»${text}«»`;
  const colored = widgetLinesRich([richView()], 64, NOW, paint);
  const plain = widgetLinesRich([richView()], 64, NOW);
  assert.deepEqual(colored.map((l) => l.replace(/«[^»]*»/g, '')), plain);

  // Roles land where the design says: run icon accent, needs-human icon
  // warning, braille bar accent, numerals dim, labels unwrapped.
  const runLine = colored[1];
  assert.ok(runLine.includes('«accent»▶«»'), runLine);
  assert.ok(runLine.includes(' review'), 'run name stays plain');
  assert.ok(runLine.includes('«success»━'), 'segment bar done-part painted success');
  const judge = colored.find((l) => l.includes('judge'));
  assert.ok(judge.includes('«warning»🔸'), judge);
  const sec = colored.find((l) => l.includes('sec-review'));
  assert.ok(sec.includes('«accent»⣿'), sec);
  assert.ok(sec.includes('sec-review'), 'label present');
  assert.doesNotMatch(sec, /«[a-z]+»sec-review/, 'label not wrapped in a paint role');
});

test('widgetLinesRich: paint applies AFTER truncation — a colored narrow line still fits and closes', () => {
  const paint = render.createAnsiPaint();
  for (const width of [18, 26]) {
    for (const line of widgetLinesRich([richView()], width, NOW, paint)) {
      const plain = stripAnsi(line);
      assert.ok(render.displayWidth(plain) <= width, `${JSON.stringify(plain)} exceeds ${width}`);
      assert.ok(!/\x1b\[[^m]*$/.test(line), 'no half-sheared escape sequence');
    }
  }
});

test('widgetLines (plain compact form) is untouched by the rich layer', () => {
  const lines = widgetLines([richView()], 120, NOW);
  assert.equal(lines[0], 'yoki-graph ▶ 1 run');
  assert.equal(lines[1], '▶ review  検証 2/3  1m39s  lanes 1/3');
  assert.ok(!lines.join('\n').includes(render.SEGMENT_CHAR));
});
