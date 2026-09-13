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
} = require('./top-render');
const { laneList } = require('./top-fold');

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
 * @returns {string[]} [] when no run is active — the caller's cue to remove
 *   the widget entirely rather than render an empty frame
 */
function widgetLines(views, width, now) {
  const cols = Number.isFinite(width) && width >= 1 ? Math.floor(width) : DEFAULT_WIDTH;
  const active = (Array.isArray(views) ? views : []).filter(isActiveRun);
  if (!active.length) return [];

  const entries = [];
  for (const view of active) {
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

  const header = `yoki-graph ▶ ${active.length} run${active.length === 1 ? '' : 's'}`;
  return [header, ...body].map((line) => truncateToWidth(line, cols));
}

module.exports = { widgetLines, isActiveLane, isActiveRun, MAX_BODY_LINES, DEFAULT_WIDTH };
