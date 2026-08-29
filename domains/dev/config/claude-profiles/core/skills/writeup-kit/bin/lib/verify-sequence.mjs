// Machine verification of a rendered sequence diagram (bin/lib/sequence.mjs)
// against the sequence contract. Rows carry a severity like
// verify-diagram.mjs's: the three budgets (participants / rows / label
// length, rows #1–#3 — SEQUENCE_LIMITS below) are `warn` — advisory,
// surfaced as `warnings` and `data-warn`, never a failure — and everything
// else is `fail`: every from/to/self/over reference resolving, arrows
// staying horizontal at the lifeline they touch, every drawn coordinate on
// the 4px grid, labels/notes clearing each other (#7) and any lifeline they
// don't belong to (#13) by 6px, the projected scale staying ≥ MIN_SCALE
// unless the scroll fallback is in effect (#14), and the same font-size/
// stroke/color/svg-shape/a11y rules every figure follows (imported from
// figures/_shared.mjs — the same functions the figure dispatcher appends
// after a plugin's own rows).
//
// Two callers: verifySequence() below runs all 14 rows for direct use
// (tests, hand-built adversarial geometry), while the `sequence` plugin
// (figures/sequence.mjs) returns only the type-specific rows
// (SEQUENCE_OWN_ROWS) and lets the dispatcher append the shared ones.
import { COLUMN } from './diagram.mjs'
import {
  budgetWarning, checkFontSizes, checkNoHexColors, checkSingleFiniteSvg, checkA11y, checkProjectedScale,
  runCheck, summarizeChecks,
} from './figures/_shared.mjs'

/** Budgets for `type: sequence` IR — guidance reported as warnings, never
 * a gate (see sequenceBudgetWarnings()). */
export const SEQUENCE_LIMITS = {
  maxParticipants: 6,
  maxMessages: 16,
  maxLabelLen: 16,
}

const LABEL_CLEARANCE = 6
const ALLOWED_STROKE_WIDTHS = new Set([1, 1.5])
const GRID = 4

// --- geometry helpers ----------------------------------------------------

/** Euclidean distance between two axis-aligned rects (0 if they overlap). */
function rectDistance(a, b) {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0)
  return Math.hypot(dx, dy)
}

/** Distance between a rect and a vertical line segment (a lifeline). */
function rectLineDistance(rect, line) {
  const dx = line.x < rect.x ? rect.x - line.x : line.x > rect.x + rect.width ? line.x - (rect.x + rect.width) : 0
  const lineLo = Math.min(line.yTop, line.yBottom)
  const lineHi = Math.max(line.yTop, line.yBottom)
  const rectLo = rect.y
  const rectHi = rect.y + rect.height
  const dy = lineHi < rectLo ? rectLo - lineHi : lineLo > rectHi ? lineLo - rectHi : 0
  return Math.hypot(dx, dy)
}

/** The lifelines a row's label/box is allowed to sit over — excluded from
 * that row's lifeline-clearance check (#13). A message label is centered
 * on its arrow, so it may lie over a lifeline the arrow crosses
 * (`row.crosses`, drawn with a mask by sequence.mjs) — but not over its own
 * from/to lifelines, which layoutColumns() widens the gap to keep clear. A
 * note deliberately spans every lifeline from the leftmost to the rightmost
 * of its `over` participants. A self label sits beside its loop and must
 * clear every lifeline, its own included. */
function coveredLifelines(row, lifelines) {
  if (row.type === 'message') return new Set(row.crosses ?? [])
  if (row.type === 'self') return new Set()
  const xs = row.over.map((id) => lifelines.find((ll) => ll.id === id)?.x).filter((x) => x !== undefined)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  return new Set(lifelines.filter((ll) => ll.x >= lo && ll.x <= hi).map((ll) => ll.id))
}

/** Every row's label-like rect (a message/self label, or a note's own box —
 * a note has no separate "label", the box itself is the text container). */
function labelRects(rows) {
  const out = []
  for (const row of rows) {
    if (row.type === 'note') out.push({ row, rect: { x: row.x, y: row.y, width: row.width, height: row.height } })
    else if (row.label) out.push({ row, rect: row.label })
  }
  return out
}

// --- checks --------------------------------------------------------------

/**
 * The three sequence budgets (SEQUENCE_LIMITS: participants ≤ 6, rows ≤ 16,
 * message/self label ≤ 16 chars) as advisory warnings — the `type:
 * sequence` counterpart of ir.mjs's budgetWarnings(), same record shape,
 * so verify-diagram.mjs / rerender-figures.mjs / self-check.mjs handle
 * every figure kind through one code path. Verified geometry (sequence.mjs
 * widens a column gap to fit the widest label between its lifelines; the
 * rows below check the result) decides whether a figure renders. Order is
 * stable (participants, messages, label) so the `data-warn` attribute
 * built from it (formatBudgetWarnings()) is byte-stable too. The plugin
 * re-exports this as its `budgetWarnings`.
 *
 * @param {object} ir normalized `type: sequence` IR
 * @returns {Array<{key:string, value:number, limit:number, detail:string, hint:string}>}
 */
export function sequenceBudgetWarnings(ir) {
  const out = []
  const L = SEQUENCE_LIMITS
  if (ir.participants.length > L.maxParticipants) {
    out.push(budgetWarning('budget:participants', ir.participants.length, L.maxParticipants,
      `${ir.participants.length} participant(s) (guidance ≤ ${L.maxParticipants})`,
      'consider splitting the sequence: draw one sequence diagram per participant subset'))
  }
  if (ir.messages.length > L.maxMessages) {
    out.push(budgetWarning('budget:messages', ir.messages.length, L.maxMessages,
      `${ir.messages.length} row(s) (guidance ≤ ${L.maxMessages})`,
      `consider splitting the sequence: split after message ${L.maxMessages}`))
  }
  const longLabels = []
  ir.messages.forEach((m, i) => {
    if (m.rowType !== 'message' && m.rowType !== 'self') return
    const len = m.label ? [...m.label].length : 0
    if (len > L.maxLabelLen) longLabels.push({ i, label: m.label, len })
  })
  if (longLabels.length) {
    const longest = longLabels.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, L.maxLabelLen,
      longLabels.map((e) => `messages[${e.i}].label "${e.label}" is ${e.len} chars (guidance ≤ ${L.maxLabelLen})`).join('; '),
      longLabels.map((e) => `shorten label of message ${e.i + 1} ("${e.label}", ${e.len} > ${L.maxLabelLen})`).join('; ') + ', or move the wording into a note'))
  }
  return out
}

// The three budget rows (#1–#3) are `warn` severity: they read
// sequenceBudgetWarnings() above — the same source validateIR() reports
// from — so a figure that is only over budget still renders and passes,
// carrying the overrun in `data-warn`. Geometry (every other row) decides
// pass/fail.
function budgetCheck(key, okDetail) {
  return (ctx) => {
    const w = ctx.budget.find((b) => b.key === key)
    if (!w) return { ok: true, detail: okDetail(ctx) }
    return { ok: false, detail: w.detail, hint: w.hint, key: w.key, value: w.value }
  }
}

const checkParticipantCount = budgetCheck('budget:participants', (ctx) => `${ctx.ir.participants.length} participant(s) (guidance ≤ 6)`)
const checkMessageCount = budgetCheck('budget:messages', (ctx) => `${ctx.ir.messages.length} row(s) (guidance ≤ 16)`)
const checkLabelLength = budgetCheck('budget:label', () => 'every message/self label is within the 16-char guidance')

function checkReferencesExist(ctx) {
  const ids = new Set(ctx.ir.participants.map((p) => p.id))
  const offenders = []
  ctx.ir.messages.forEach((m, i) => {
    if (m.rowType === 'message') {
      if (!ids.has(m.from)) offenders.push(`messages[${i}].from "${m.from}" is not a participant`)
      if (!ids.has(m.to)) offenders.push(`messages[${i}].to "${m.to}" is not a participant`)
    } else if (m.rowType === 'self') {
      if (!ids.has(m.participant)) offenders.push(`messages[${i}].self "${m.participant}" is not a participant`)
    } else {
      for (const p of m.over) if (!ids.has(p)) offenders.push(`messages[${i}].over "${p}" is not a participant`)
    }
  })
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every message/self/over reference resolves to a declared participant',
    hint: offenders.length ? offenders.join('; ') : undefined,
  }
}

function checkArrowsHorizontal(ctx) {
  const offenders = []
  for (const row of ctx.geo.rows) {
    if (row.type === 'note') continue
    const pts = row.path
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if (a.x !== b.x && a.y !== b.y) offenders.push(`${row.type}[${row.index}] segment ${i} is diagonal`)
    }
    const last = pts[pts.length - 1]
    const beforeLast = pts[pts.length - 2]
    if (last.y !== beforeLast.y) offenders.push(`${row.type}[${row.index}] arrowhead segment is not horizontal`)
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every arrow (and a self-message loop\'s in/out legs) is axis-aligned and horizontal at the lifeline',
    hint: offenders.length ? offenders.join('; ') : undefined,
  }
}

function checkGrid(ctx) {
  const offenders = []
  const check = (v, label) => { if (v % GRID !== 0) offenders.push(`${label}=${v}`) }
  for (const p of ctx.geo.participants) {
    check(p.x, `participant "${p.id}".x`); check(p.y, `participant "${p.id}".y`)
    check(p.width, `participant "${p.id}".width`); check(p.height, `participant "${p.id}".height`)
  }
  for (const row of ctx.geo.rows) {
    if (row.type === 'note') {
      check(row.x, `note[${row.index}].x`); check(row.y, `note[${row.index}].y`)
      check(row.width, `note[${row.index}].width`); check(row.height, `note[${row.index}].height`)
      continue
    }
    for (const pt of row.path) { check(pt.x, `${row.type}[${row.index}].x`); check(pt.y, `${row.type}[${row.index}].y`) }
    if (row.label) { check(row.label.x, `${row.type}[${row.index}].label.x`); check(row.label.y, `${row.type}[${row.index}].label.y`) }
  }
  const uniq = [...new Set(offenders)]
  return {
    ok: uniq.length === 0,
    detail: uniq.length ? `off-grid: ${uniq.slice(0, 6).join(', ')}${uniq.length > 6 ? ', …' : ''}` : 'every coordinate/size sits on the 4px grid',
    hint: uniq.length ? 'run every drawn coordinate through snap4()/snapUp4() before writing it to the svg' : undefined,
  }
}

function checkLabelClearance(ctx) {
  const labels = labelRects(ctx.geo.rows)
  const offenders = []
  for (let i = 0; i < labels.length; i++) {
    const { row, rect } = labels[i]
    let worst = Infinity
    let against = null
    for (let j = 0; j < labels.length; j++) {
      if (i === j) continue
      const d = rectDistance(rect, labels[j].rect)
      if (d < worst) { worst = d; against = `${labels[j].row.type}[${labels[j].row.index}]` }
    }
    if (worst < LABEL_CLEARANCE) offenders.push({ row, worst, against })
  }
  const ok = offenders.length === 0
  return {
    ok,
    detail: ok
      ? 'every label/note clears every other label/note by ≥6px'
      : offenders.map((o) => `${o.row.type}[${o.row.index}] is ${o.worst.toFixed(1)}px from ${o.against}`).join('; '),
    hint: ok ? undefined : offenders.map((o) => `shorten or reposition ${o.row.type}[${o.row.index}] (crowds ${o.against})`).join('; '),
  }
}

/** A label must not run into a lifeline it does not belong to — including
 * a message's own from/to lifelines, since layoutColumns() widens the gap
 * to hold the label; only the lifelines the arrow itself crosses, and the
 * ones a note spans, are exempt (see coveredLifelines()). This is the row
 * that fails when a long label would otherwise overlap a neighbouring
 * column. */
function checkLifelineClearance(ctx) {
  const offenders = []
  for (const { row, rect } of labelRects(ctx.geo.rows)) {
    const covered = coveredLifelines(row, ctx.geo.lifelines)
    for (const ll of ctx.geo.lifelines) {
      if (covered.has(ll.id)) continue
      const d = rectLineDistance(rect, ll)
      if (d < LABEL_CLEARANCE) offenders.push({ row, d, id: ll.id })
    }
  }
  const ok = offenders.length === 0
  return {
    ok,
    detail: ok
      ? 'every label/note clears every lifeline it does not belong to by ≥6px'
      : offenders.map((o) => `${o.row.type}[${o.row.index}] is ${o.d.toFixed(1)}px from lifeline "${o.id}"`).join('; '),
    hint: ok ? undefined : offenders.map((o) => `shorten ${o.row.type}[${o.row.index}] or widen the gap at lifeline "${o.id}" (the layout should have widened it — check layoutColumns())`).join('; '),
  }
}

function checkStrokeWidths(ctx) {
  const widths = [...ctx.svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const bad = [...new Set(widths.filter((w) => !ALLOWED_STROKE_WIDTHS.has(w)))]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `stroke-width outside {1,1.5}: ${bad.join(', ')}` : 'every stroke-width is 1 or 1.5',
    hint: bad.length ? 'use the kit\'s border-width scale (1/1.5)' : undefined,
  }
}

// --- driver ----------------------------------------------------------------

// [id, name, fn, severity]: `fail` rows gate rendering; `warn` rows (the
// three budgets) are advisory — a failing warn row is reported in
// `warnings` and `data-warn`, never in `failures`.
const CHECK_DEFS = [
  [1, 'participant-count', checkParticipantCount, 'warn'],
  [2, 'message-count', checkMessageCount, 'warn'],
  [3, 'label-length', checkLabelLength, 'warn'],
  [4, 'references-exist', checkReferencesExist, 'fail'],
  [5, 'arrows-horizontal', checkArrowsHorizontal, 'fail'],
  [6, 'rows-grid', checkGrid, 'fail'],
  [7, 'label-clearance', checkLabelClearance, 'fail'],
  [8, 'font-size', checkFontSizes, 'fail'],
  [9, 'stroke-width', checkStrokeWidths, 'fail'],
  [10, 'no-hex-colors', checkNoHexColors, 'fail'],
  [11, 'single-finite-svg', checkSingleFiniteSvg, 'fail'],
  [12, 'a11y', checkA11y, 'fail'],
  [13, 'lifeline-clearance', checkLifelineClearance, 'fail'],
  [14, 'projected-scale', checkProjectedScale, 'fail'],
]

/** The rows that are specific to a sequence figure — what the `sequence`
 * plugin's verify() returns. The other six (#8–#12, #14) are the shared
 * rows figures/_shared.mjs defines and the dispatcher appends itself. */
export const SEQUENCE_OWN_ROWS = ['participant-count', 'message-count', 'label-length', 'references-exist', 'arrows-horizontal', 'rows-grid', 'label-clearance', 'lifeline-clearance']

/**
 * Verify a rendered sequence diagram (bin/lib/sequence.mjs's
 * renderSequenceDiagram() output) against the sequence contract. Same
 * result shape as verify-diagram.mjs's verifyDiagram(): every check has a
 * severity, `ok` is true when no `fail` row fails, and budget overruns
 * only populate `warnings`.
 *
 * @param {object} ir validated `type: sequence` IR from ir.mjs
 * @param {object} renderResult renderSequenceDiagram()'s return — must carry
 *   `layout.geo` (participants/lifelines/rows geometry)
 * @param {{column?: number}} [opts] the column width the scale/scroll
 *   decision was made against (row #14)
 * @returns {{ok: boolean, checks: Array<{id:number, name:string, severity:'fail'|'warn', ok:boolean, detail:string, hint?:string}>, failures: object[], warnings: Array<{id:number, name:string, key:string, value:number, detail:string, hint?:string}>}}
 */
export function verifySequence(ir, renderResult, { column = COLUMN } = {}) {
  if (!renderResult || !renderResult.layout || !renderResult.layout.geo) {
    throw new Error('verifySequence requires renderResult.layout.geo (render with sequence.mjs, or build one with the same shape)')
  }
  const ctx = { ir, renderResult, geo: renderResult.layout.geo, svg: renderResult.svg, column, budget: sequenceBudgetWarnings(ir) }
  const checks = CHECK_DEFS.map(([id, name, fn, severity]) => {
    const result = runCheck(fn, ctx)
    const check = { id, name, severity, ok: result.ok, detail: result.detail, hint: result.hint }
    if (severity === 'warn' && !result.ok) {
      check.key = result.key
      check.value = result.value
    }
    return check
  })
  return summarizeChecks(checks)
}
