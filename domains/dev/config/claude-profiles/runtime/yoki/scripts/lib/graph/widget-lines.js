'use strict';

/**
 * Pure line builder for the pi bottom widget (`yoki-graph-widget.ts` in
 * domains/dev/config/pi/extensions/).
 *
 * Why this lives HERE and not inside the .ts extension: pi loads extensions
 * through jiti, which node --test cannot exercise without pulling pi's whole
 * runtime in. Keeping the string assembly in plain CommonJS next to
 * top-fold/top-render means the widget's entire visible output is asserted
 * by the same `node --test lib/graph/test/*.test.js` suite as the rest of
 * the viewer, and the .ts extension shrinks to IO glue (watchers, setWidget)
 * that is verified by the manual procedure in domains/dev/config/pi/README.md.
 *
 * Contract with the extension:
 *  - input is the view tree top.js's buildViews returns — the SAME shape
 *    `yoki-graph top` renders, so fold/nesting/liveness logic is never
 *    re-implemented on the widget side;
 *  - output is plain strings, each already truncated to `width` display
 *    cells (top-render's East Asian Wide arithmetic) — the widget hands
 *    them to pi verbatim and pi must never have to wrap or clip;
 *  - EVERY piece of external text (run names, lane labels, phase titles —
 *    workflow-authored, possibly attacker-influenced through a lane's
 *    payload) passes through top-render's sanitizeText before any width
 *    is measured, for exactly the reasons top-render documents: a raw ESC
 *    in a label must not retitle the user's terminal from a status widget.
 *
 * Layout (compact by design — this sits under the user's prompt, so every
 * line it occupies is a line of the user's editor room):
 *
 *   yoki-graph ▶ 2 runs                          <- header, always 1 line
 *   ▶ review  検証 2/5  3m12s  lanes 3/4         <- one line per active run
 *     ◉ sec-review  12t  1m02s                   <- ACTIVE lanes only
 *     🔸 judge  4t  2m40s                        <- needs-human: never cut
 *   … and 3 more                                 <- overflow past 8 body lines
 *
 * Only ACTIVE runs (liveness running or stale) appear at all — the widget's
 * caller removes the whole widget when this returns [], so a machine with
 * no live run pays zero lines. Done lanes are only visible through the run
 * row's `lanes d/t` tally; showing them individually would let one finished
 * fan-out crowd out the runs still moving.
 */

const { formatElapsed } = require('./progress');
const {
  sanitizeText, truncateToWidth, laneIcon, laneCounts, RUN_ICONS,
  displayWidth, padCell, renderBar, segmentBar, truncateSegments, paintSegments,
  runStatusRole, laneStatusRole, formatTokens,
} = require('./top-render');
const { laneList, completedSiblings } = require('./top-fold');
const { estimateProgress } = require('./top-estimate');

/** Body lines (everything under the header) are capped here. 8 keeps the
 *  widget at most 9 rows — roughly a quarter of an 80x24 terminal — and the
 *  cap is what the "… and N more" line exists to enforce. */
const MAX_BODY_LINES = 8;

/** Fallback width when the host passes nothing usable — wide enough that
 *  truncation only fires on genuinely long labels. */
const DEFAULT_WIDTH = 80;

function isActiveRun(view) {
  return view.liveness === 'running' || view.liveness === 'stale';
}

/** A lane earns a row only while someone might act on it: it is running
 *  (retrying included — `retrying` lanes keep status 'running'), or it is
 *  flagged needs-human. Everything settled is only a number in the run
 *  row's tally. */
function isActiveLane(lane) {
  return Boolean(lane.needsHuman || lane.retrying || lane.status === 'running');
}

function runElapsed(state, now) {
  if (!Number.isFinite(state.startTs)) return '';
  const end = Number.isFinite(state.endTs) ? state.endTs : now;
  return formatElapsed(Math.max(0, end - state.startTs));
}

// ---------------------------------------------------------------------------
// Session scoping — the widget shows only the runs THIS session launched.
//
// Every pi session stamps its runs with a scope (runner.js's runScope, fed by
// YOKI_RUN_SCOPE = `pi-<sessionId>` from the widget extension) and passes its
// own scope in as `selfScope`. Runs carrying a different scope, and every
// UNSCOPED run (an older run.json, a Claude Code lane, a `yoki-graph run` from
// a plain shell), belong to "elsewhere" — summarised in one line, not drawn
// row by row, because `yoki-graph top` is the global view by design. When
// selfScope is empty the widget is unscoped and behaves exactly as before:
// every active run is mine, nothing is elsewhere.
// ---------------------------------------------------------------------------

/** True when a run — or any of its nested lane runs — has a lane flagged
 *  needs-human. That is the one elsewhere signal worth interrupting for. */
function runNeedsHuman(view) {
  for (const lane of view.state.lanes.values()) if (lane.needsHuman) return true;
  for (const child of view.children || []) {
    if (!child.state) continue;
    for (const lane of child.state.lanes.values()) if (lane.needsHuman) return true;
  }
  return false;
}

/** Split active runs into this session's and everyone else's. */
function scopePartition(active, selfScope) {
  if (!selfScope) return { mine: active, elsewhere: [] };
  const mine = [];
  const elsewhere = [];
  for (const view of active) {
    if (view.scope === selfScope) mine.push(view);
    else elsewhere.push(view);
  }
  return { mine, elsewhere };
}

/**
 * The single trailing line summarising runs live in OTHER sessions, as a
 * {role, text} pair, or null when there are none. Warning + 🔸 when any of
 * them needs a human (it must catch the eye even though it is not this
 * session's run); a dim `…` line otherwise.
 */
function elsewhereLine(elsewhere) {
  if (!elsewhere.length) return null;
  const n = elsewhere.length;
  const tail = `+${n} run${n === 1 ? '' : 's'} elsewhere (yoki-graph top)`;
  return elsewhere.some(runNeedsHuman)
    ? { role: 'warning', text: `🔸 ${tail}` }
    : { role: 'dim', text: `… ${tail}` };
}

/** `▶ name  phase 2/5  3m12s  lanes 3/4` — fields that have nothing to say
 *  are dropped rather than rendered empty, so a run that has not announced
 *  phases yet is `▶ name  12s` and not a row of stray separators. */
function runLine(view, now) {
  const p = view.state.progress;
  const icon = RUN_ICONS[view.liveness] || RUN_ICONS.unknown;
  const name = sanitizeText(p.name || (view.meta && view.meta.name) || view.runId);
  // One space binds the icon to its name; two separate the fields — the
  // same visual grouping the header uses.
  const parts = [`${icon} ${name}`];
  if (p.phases.length || p.phaseTitle) {
    const counter = p.phases.length ? `${p.phaseIndex}/${p.phases.length}` : '';
    parts.push([sanitizeText(p.phaseTitle || ''), counter].filter(Boolean).join(' '));
  }
  const elapsed = runElapsed(view.state, now);
  if (elapsed) parts.push(elapsed);
  const { done, total } = laneCounts(view);
  if (total) parts.push(`lanes ${done}/${total}`);
  return parts.join('  ');
}

function laneElapsed(lane, now) {
  if (Number.isFinite(lane.durationMs)) return formatElapsed(lane.durationMs);
  if (!Number.isFinite(lane.startedTs)) return '';
  const end = Number.isFinite(lane.endedTs) ? lane.endedTs : now;
  return formatElapsed(Math.max(0, end - lane.startedTs));
}

/** `  ◉ label  12t  1m02s` — laneIcon supplies ◉/↻/🔸 by the same rules as
 *  the full viewer, so the two surfaces never disagree about a lane. */
function laneLine(lane, now) {
  const parts = [`${laneIcon(lane)} ${sanitizeText(lane.label || `#${lane.index}`)}`];
  if (lane.toolCalls) parts.push(`${lane.toolCalls}t`);
  const elapsed = laneElapsed(lane, now);
  if (elapsed) parts.push(elapsed);
  return `  ${parts.join('  ')}`;
}

/**
 * A nested lane run's rows, mirroring top-render's renderChildRows: the
 * child's own active lanes, labelled by the lane suffix when the label is
 * missing or the transport's generic 'yoki-agent'; a child that is alive
 * but has emitted nothing yet still gets one row so a lane that locked its
 * runDir shows up instead of silently not existing.
 */
function childEntries(child, now) {
  const lanes = laneList(child.state).filter(isActiveLane);
  if (!lanes.length) {
    if (!isActiveRun(child)) return [];
    const placeholder = {
      index: 0, label: child.laneLabel || child.runId, status: 'running', toolCalls: 0,
    };
    return [{ text: laneLine(placeholder, now), must: false }];
  }
  return lanes.map((lane) => {
    const label = !lane.label || lane.label === 'yoki-agent' ? child.laneLabel : lane.label;
    return { text: laneLine({ ...lane, label }, now), must: Boolean(lane.needsHuman) };
  });
}

/**
 * The widget's full content: header plus at most MAX_BODY_LINES body lines,
 * every line cut to `width` display cells.
 *
 * Overflow rule: when the body would exceed the cap, needs-human lines are
 * selected FIRST (a lane waiting on the person reading this widget must
 * never be the line that got cut), then the rest fill the remaining slots
 * in reading order, and the final slot becomes `… and N more`. Original
 * order is preserved among whatever survives — the selection reorders
 * nothing, it only drops.
 *
 * @param {Array<object>} views buildViews output (top-level run views)
 * @param {number} width available display cells
 * @param {number} now epoch ms
 * @param {string} [selfScope] this session's YOKI_RUN_SCOPE; only runs
 *   carrying it are drawn, the rest fold into one "elsewhere" line. Empty or
 *   omitted disables scoping (every active run is drawn — the legacy shape).
 * @returns {string[]} [] when nothing to show — the caller's cue to remove
 *   the widget entirely rather than render an empty frame
 */
function widgetLines(views, width, now, selfScope) {
  const cols = Number.isFinite(width) && width >= 1 ? Math.floor(width) : DEFAULT_WIDTH;
  const active = (Array.isArray(views) ? views : []).filter(isActiveRun);
  const { mine, elsewhere } = scopePartition(active, selfScope);
  const elLine = elsewhereLine(elsewhere);

  // Nothing of this session's is running: stay hidden UNLESS another session
  // has a needs-human run, in which case that one line is the whole widget.
  if (!mine.length) {
    return elLine && elLine.role === 'warning' ? [truncateToWidth(elLine.text, cols)] : [];
  }

  const entries = [];
  for (const view of mine) {
    entries.push({ text: runLine(view, now), must: false });
    // laneList already hoists needs-human lanes to the front of the run's
    // block; the `must` flag additionally shields them from the overflow cut.
    for (const lane of laneList(view.state)) {
      if (isActiveLane(lane)) entries.push({ text: laneLine(lane, now), must: Boolean(lane.needsHuman) });
    }
    for (const child of view.children || []) entries.push(...childEntries(child, now));
  }

  let body;
  if (entries.length <= MAX_BODY_LINES) {
    body = entries.map((e) => e.text);
  } else {
    const cap = MAX_BODY_LINES - 1; // the last slot is the "… and N more" line
    const keep = new Set();
    entries.forEach((e, i) => { if (e.must && keep.size < cap) keep.add(i); });
    entries.forEach((e, i) => { if (!keep.has(i) && keep.size < cap) keep.add(i); });
    body = entries.filter((_, i) => keep.has(i)).map((e) => e.text);
    body.push(`… and ${entries.length - keep.size} more`);
  }

  // The elsewhere summary is a distinct always-visible tail, kept OUTSIDE the
  // mine body cap so a busy fan-out cannot bury it.
  if (elLine) body.push(elLine.text);

  const header = `yoki-graph ▶ ${mine.length} run${mine.length === 1 ? '' : 's'}`;
  return [header, ...body].map((line) => truncateToWidth(line, cols));
}

// ---------------------------------------------------------------------------
// Rich layout (widgetLinesRich) — the themed, aligned form the pi widget
// actually shows. Same visibility/overflow/sanitation contract as
// widgetLines above; what changes is presentation:
//
//   yoki-graph ▶ 1 run                                Σ 12.4k tok
//   ▶ review  検証 2/3  1m39s  ━━━━━━━━━━  1/3
//     ◉ sec-review   ⣿⣿⣤    45%   12t  1m34s
//     🔸 judge                       4t  2m40s
//
//  - every line is a list of {role, text} SEGMENTS; all width arithmetic
//    (padding, truncation) runs on the plain text, and `paint(role, text)`
//    wraps finished cells only afterwards — an ANSI byte can never be
//    counted as a display cell or sheared by the truncation;
//  - color marks STATE and CHROME only (icons by state, bars, dimmed
//    numerals); labels and names stay the terminal's normal text color;
//  - lane rows are columnar: label column sized to the widest active label,
//    numeric columns right-aligned, so ticks and elapsed line up vertically;
//  - a running lane shows a braille bar + estimated % ONLY when the run has
//    finished sibling lanes to base the estimate on (top-estimate's rule:
//    zero siblings means no bar, never an invented percentage);
//  - the run row carries a proportional segment bar of its lane states
//    (done / error / in flight, largest-remainder cell allocation);
//  - the header gains the active runs' token total, right-aligned — one
//    information line, not a list of fragments.
//
// The plain widgetLines above is unchanged and remains the no-theme
// fallback; identity paint on this function is the colorless rich layout.
// ---------------------------------------------------------------------------

/** Braille estimate bar width (cells) in a lane row. */
const RICH_BAR_WIDTH = 5;
/** Proportional lane-state bar width (cells) in a run row. */
const RICH_SEGMENT_BAR_WIDTH = 10;
/** Label column bounds — sized to content between these. */
const RICH_LABEL_MIN = 4;
const RICH_LABEL_MAX = 22;

function seg(role, text) { return { role, text }; }

/** Drop trailing blank segments and right-trim the last one, so alignment
 *  padding never leaves invisible spaces at the end of a widget line. */
function trimSegments(segments) {
  const kept = [...segments];
  while (kept.length && !kept[kept.length - 1].text.trim()) kept.pop();
  if (kept.length) {
    const last = kept.length - 1;
    kept[last] = { ...kept[last], text: kept[last].text.replace(/\s+$/, '') };
  }
  return kept;
}

/** Everything a rich lane row renders, gathered BEFORE layout so the label
 *  column can be sized to the widest label across the whole widget. */
function laneDescriptor(lane, state, now) {
  const elapsedMs = Number.isFinite(lane.durationMs)
    ? lane.durationMs
    : (Number.isFinite(lane.startedTs)
      ? Math.max(0, (Number.isFinite(lane.endedTs) ? lane.endedTs : now) - lane.startedTs)
      : null);
  // Same discipline as top-render's bar cell: only a RUNNING lane, and only
  // when finished siblings exist — estimateProgress answers null otherwise.
  // A needs-human lane additionally shows NO bar even while nominally
  // running: it is waiting on the person reading this widget, and a
  // percentage crawling forward under 🔸 would say the opposite.
  const fraction = lane.status === 'running' && !lane.needsHuman
    ? estimateProgress(
      { elapsedMs: elapsedMs === null ? 0 : elapsedMs, toolCalls: lane.toolCalls },
      completedSiblings(state, lane.index),
    )
    : null;
  return {
    icon: laneIcon(lane),
    role: laneStatusRole(lane),
    label: sanitizeText(lane.label || `#${lane.index}`),
    fraction,
    toolCalls: lane.toolCalls || 0,
    elapsed: laneElapsed(lane, now),
    must: Boolean(lane.needsHuman),
  };
}

/** Rich mirror of childEntries: a nested lane run's active lanes as
 *  descriptors, lane-suffix labelling and the alive-but-silent placeholder
 *  included. */
function childDescriptors(child, now) {
  const lanes = laneList(child.state).filter(isActiveLane);
  if (!lanes.length) {
    if (!isActiveRun(child)) return [];
    return [{
      icon: '◉', role: 'accent',
      label: sanitizeText(child.laneLabel || child.runId),
      fraction: null, toolCalls: 0, elapsed: '', must: false,
    }];
  }
  return lanes.map((lane) => {
    const label = !lane.label || lane.label === 'yoki-agent' ? child.laneLabel : lane.label;
    return laneDescriptor({ ...lane, label }, child.state, now);
  });
}

/** `done / error / in-flight` proportional bar over a run's lanes and
 *  nested lane runs — the at-a-glance composition of the fan-out. */
function runSegmentBar(view) {
  let ok = 0;
  let failed = 0;
  let moving = 0;
  for (const lane of view.state.lanes.values()) {
    if (lane.status === 'ok' || lane.status === 'cached') ok += 1;
    else if (lane.status === 'error') failed += 1;
    else moving += 1;
  }
  for (const child of view.children || []) {
    if (child.liveness === 'ok') ok += 1;
    else if (child.liveness === 'error') failed += 1;
    else moving += 1;
  }
  return segmentBar([
    { role: 'success', count: ok },
    { role: 'error', count: failed },
    { role: 'accent', count: moving },
  ], RICH_SEGMENT_BAR_WIDTH);
}

function runLineSegments(view, now) {
  const p = view.state.progress;
  const icon = RUN_ICONS[view.liveness] || RUN_ICONS.unknown;
  const name = sanitizeText(p.name || (view.meta && view.meta.name) || view.runId);
  const segs = [seg(runStatusRole(view.liveness), icon), seg(null, ` ${name}`)];
  if (p.phases.length || p.phaseTitle) {
    const counter = p.phases.length ? `${p.phaseIndex}/${p.phases.length}` : '';
    segs.push(seg(null, `  ${[sanitizeText(p.phaseTitle || ''), counter].filter(Boolean).join(' ')}`));
  }
  const elapsed = runElapsed(view.state, now);
  if (elapsed) segs.push(seg('dim', `  ${elapsed}`));
  const { done, total } = laneCounts(view);
  if (total) {
    const bar = runSegmentBar(view);
    if (bar.length) {
      segs.push(seg(null, '  '));
      segs.push(...bar);
    }
    segs.push(seg('dim', `  ${done}/${total}`));
  }
  return segs;
}

function laneLineSegments(d, labelWidth, hasBarColumn) {
  const segs = [
    seg(null, '  '),
    // Icon cell is 2 display cells (🔸 is double-width) plus a fixed
    // 1-space gap, so single- and double-width icons leave the label
    // column at the same offset.
    seg(d.role, padCell(d.icon, 2)),
    seg(null, ' '),
    seg(null, padCell(d.label, labelWidth)),
  ];
  if (hasBarColumn) {
    const has = Number.isFinite(d.fraction);
    segs.push(seg(null, '  '));
    segs.push(seg('accent', padCell(has ? renderBar(d.fraction, RICH_BAR_WIDTH) : '', RICH_BAR_WIDTH)));
    segs.push(seg('dim', padCell(has ? `${Math.round(d.fraction * 100)}%` : '', 4, 'right')));
  }
  segs.push(seg('dim', `  ${padCell(d.toolCalls ? `${d.toolCalls}t` : '', 5, 'right')}`));
  segs.push(seg('dim', `  ${padCell(d.elapsed || '', 7, 'right')}`));
  return trimSegments(segs);
}

/** One information line: brand + active-run count on the left, the active
 *  runs' token total on the right edge — dropped when it cannot fit. */
function headerSegments(count, totalTokens, cols) {
  const left = [
    seg('dim', 'yoki-graph '),
    seg('accent', '▶'),
    seg(null, ` ${count} run${count === 1 ? '' : 's'}`),
  ];
  const tok = formatTokens(totalTokens);
  if (!tok) return left;
  const right = `Σ ${tok} tok`;
  const gap = cols
    - left.reduce((sum, s) => sum + displayWidth(s.text), 0)
    - displayWidth(right);
  if (gap < 2) return left;
  return [...left, seg(null, ' '.repeat(gap)), seg('dim', right)];
}

/**
 * The themed widget content: same inputs and same visibility/overflow rules
 * as widgetLines, plus `paint(role, text) -> string` for color. Pass no
 * paint (or an identity) and the output is plain text with the rich layout.
 *
 * @param {Array<object>} views buildViews output (top-level run views)
 * @param {number} width available display cells
 * @param {number} now epoch ms
 * @param {(role: string, text: string) => string} [paint]
 * @param {string} [selfScope] this session's YOKI_RUN_SCOPE — see widgetLines
 * @returns {string[]} [] when nothing to show
 */
function widgetLinesRich(views, width, now, paint, selfScope) {
  const cols = Number.isFinite(width) && width >= 1 ? Math.floor(width) : DEFAULT_WIDTH;
  const active = (Array.isArray(views) ? views : []).filter(isActiveRun);
  const { mine, elsewhere } = scopePartition(active, selfScope);
  const elLine = elsewhereLine(elsewhere);

  // Same rule as widgetLines: hidden when nothing of this session's runs,
  // except a single warning line when another session needs a human.
  if (!mine.length) {
    if (elLine && elLine.role === 'warning') {
      return [paintSegments(truncateSegments([seg('warning', elLine.text)], cols), paint)];
    }
    return [];
  }

  let totalTokens = 0;
  const blocks = [];
  for (const view of mine) {
    totalTokens += view.state.tokens || 0;
    const laneDescs = [];
    for (const lane of laneList(view.state)) {
      if (isActiveLane(lane)) laneDescs.push(laneDescriptor(lane, view.state, now));
    }
    for (const child of view.children || []) {
      totalTokens += (child.state && child.state.tokens) || 0;
      laneDescs.push(...childDescriptors(child, now));
    }
    blocks.push({ view, laneDescs });
  }

  const allDescs = blocks.flatMap((b) => b.laneDescs);
  const labelWidth = Math.min(
    RICH_LABEL_MAX,
    Math.max(RICH_LABEL_MIN, ...allDescs.map((d) => displayWidth(d.label)), 0),
  );
  const hasBarColumn = allDescs.some((d) => Number.isFinite(d.fraction));

  const entries = [];
  for (const { view, laneDescs } of blocks) {
    entries.push({ segments: runLineSegments(view, now), must: false });
    for (const d of laneDescs) {
      entries.push({ segments: laneLineSegments(d, labelWidth, hasBarColumn), must: d.must });
    }
  }

  // Same overflow selection as widgetLines: needs-human lines first, the
  // rest in reading order, last slot becomes the more-line.
  let body;
  if (entries.length <= MAX_BODY_LINES) {
    body = entries.map((e) => e.segments);
  } else {
    const cap = MAX_BODY_LINES - 1;
    const keep = new Set();
    entries.forEach((e, i) => { if (e.must && keep.size < cap) keep.add(i); });
    entries.forEach((e, i) => { if (!keep.has(i) && keep.size < cap) keep.add(i); });
    body = entries.filter((_, i) => keep.has(i)).map((e) => e.segments);
    body.push([seg('dim', `… and ${entries.length - keep.size} more`)]);
  }

  // The elsewhere summary is a distinct always-visible tail, kept OUTSIDE the
  // mine body cap so a busy fan-out cannot bury it.
  if (elLine) body.push([seg(elLine.role, elLine.text)]);

  return [headerSegments(mine.length, totalTokens, cols), ...body]
    .map((segments) => paintSegments(truncateSegments(segments, cols), paint));
}

module.exports = {
  widgetLines, widgetLinesRich, isActiveLane, isActiveRun,
  scopePartition, elsewhereLine, runNeedsHuman,
  MAX_BODY_LINES, DEFAULT_WIDTH,
  RICH_BAR_WIDTH, RICH_SEGMENT_BAR_WIDTH, RICH_LABEL_MAX,
};
