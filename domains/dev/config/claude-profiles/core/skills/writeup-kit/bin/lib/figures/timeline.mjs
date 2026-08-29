// `type: timeline` — events on a single time axis (release history, an
// incident's minute-by-minute, a phased migration plan). One axis with an
// arrowhead, a tick and a marker per event, and each event's text block
// (date/ordinal, label, optional note) on alternating sides of the axis —
// above/below when the axis runs right, left/right when it runs down — so
// neighbouring labels never collide.
//
// IR shape: `{ id, type:'timeline', title, caption, events, scale, direction }`
//   events:    [{ id, label, at, note?, emphasis, tone }] in chronological
//              order; `at` is an ISO date (YYYY, YYYY-MM, YYYY-MM-DD) or a
//              free ordinal label ("Phase 1", "T+0")
//   scale:     'time' (positions proportional to the parsed dates) or
//              'ordinal' (uniform spacing); defaults to `time` when every
//              `at` parses as a date, otherwise `ordinal`
//   direction: 'right' (default) or 'down'
//
// The time scale is honest (design survey #7: unequal gaps stay unequal)
// until it would make labels overlap; then the layout falls back to ordinal
// spacing and reports it as the `scale:compressed` warning rather than
// nudging events off their true position silently.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN, MIN_SCALE } from '../diagram.mjs'

export const type = 'timeline'

export const limits = { maxEvents: 12, maxLabelLen: 14, maxEmphasis: 2 }

// --- layout constants (px; every position derived from them is a multiple of 4)

const PAD = 16            // canvas margin
const TICK = 8            // tick half-length across the axis
const BLOCK_GAP = 16      // axis ↔ text block clearance (tick + 8)
const SAME_SIDE_GAP = 12  // clearance between two blocks on the same side
const MIN_ADJ = 24        // minimum spacing between neighbouring markers
const MAX_STEP = 144      // ordinal spacing never stretches beyond this
const ARROW_ROOM = 24     // axis overhang past the last marker (arrowhead)
const AXIS_LEAD = 16      // axis overhang before the first marker
const DOWN_STEP = 80      // ordinal spacing (and the default time-axis length per gap) when the axis runs down
const DOWN_MAX_LEN = 640  // longest time axis a `down` figure may grow to
const DOT_R = 4
const FOCAL_SIZE = 12
// text baselines relative to the axis (right) — above: label / note / at
const ABOVE = { at: -20, label: -36, labelWithNote: -52, note: -36, top: -48, topWithNote: -64 }
// below: at / label / note
const BELOW = { at: 24, label: 40, note: 56, bottom: 44, bottomWithNote: 60 }
// text baselines relative to the marker (down) — at / label / note stacked
const SIDE = { at: -4, label: 12, atWithNote: -12, labelWithNote: 4, note: 20, before: 12, beforeWithNote: 20, after: 16, afterWithNote: 24 }

// --- schema --------------------------------------------------------------

const SCALES = new Set(['ordinal', 'time'])
const DIRECTIONS = new Set(['right', 'down'])
const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

/** Milliseconds since the epoch for `YYYY`, `YYYY-MM`, `YYYY-MM-DD`; null
 * for anything else (an ordinal label). Unexported: helpers stay private. */
function parseAt(at) {
  const m = DATE_RE.exec(at)
  if (!m) return null
  const y = Number(m[1])
  const mo = m[2] === undefined ? 1 : Number(m[2])
  const d = m[3] === undefined ? 1 : Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t
}

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  if (!Array.isArray(raw.events) || raw.events.length === 0) throw new IrError(`${ctx}.events must be a non-empty list`)
  const seen = new Set()
  const events = raw.events.map((e, i) => {
    const ectx = `${ctx}.events[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const eid = requireStr(e, 'id', ectx)
    if (seen.has(eid)) throw new IrError(`duplicate event id: "${eid}"`)
    seen.add(eid)
    const label = requireStr(e, 'label', ectx)
    // a bare year (`at: 2026`) arrives from yaml-lite as a number
    const atRaw = typeof e.at === 'number' && Number.isFinite(e.at) ? { at: String(e.at) } : e
    const at = requireStr(atRaw, 'at', ectx)
    const note = optStr(e, 'note', ectx)
    const emphasis = validateBool(e, 'emphasis', ectx)
    const tone = validateTone(e.tone, ectx)
    const out = { id: eid, label, at }
    if (note !== undefined && note !== '') out.note = note
    out.emphasis = emphasis
    out.tone = tone
    return out
  })
  const allDated = events.every((e) => parseAt(e.at) !== null)
  let scale = optStr(raw, 'scale', ctx)
  if (scale === undefined) scale = allDated ? 'time' : 'ordinal'
  else if (!SCALES.has(scale)) throw new IrError(`${ctx}.scale must be ordinal|time (got: ${JSON.stringify(scale)})`)
  if (scale === 'time' && !allDated) {
    const bad = events.findIndex((e) => parseAt(e.at) === null)
    throw new IrError(`${ctx}.scale is "time" but ${ctx}.events[${bad}].at ${JSON.stringify(events[bad].at)} is not a date (YYYY, YYYY-MM or YYYY-MM-DD)`)
  }
  let direction = optStr(raw, 'direction', ctx)
  if (direction === undefined) direction = 'right'
  else if (!DIRECTIONS.has(direction)) throw new IrError(`${ctx}.direction must be right|down (got: ${JSON.stringify(direction)})`)
  return { id, type, title, caption, events, scale, direction }
}

// --- budgets -------------------------------------------------------------

function longestLabel(ir) {
  return ir.events.reduce((m, e) => (e.label.length > m.length ? e.label : m), '')
}

export function budgetWarnings(ir) {
  const out = []
  const n = ir.events.length
  if (n > limits.maxEvents) {
    out.push(budgetWarning('budget:events', n, limits.maxEvents,
      `${n} event(s) (guidance ≤ ${limits.maxEvents})`,
      'split the timeline at a phase boundary or fold minor events into a note'))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and move the detail into the event\'s note'))
  }
  const emphasized = ir.events.filter((e) => e.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized event(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two milestones the decision hinges on'))
  }
  return out
}

// --- layout --------------------------------------------------------------

/** The widest of the three text lines an event block may carry. */
function blockTextWidth(e) {
  const label = textWidth(e.label, FONT_SIZE) * (e.emphasis ? BOLD_FACTOR : 1)
  const at = textWidth(e.at, EDGE_LABEL_SIZE)
  const note = e.note ? textWidth(e.note, EDGE_LABEL_SIZE) : 0
  return Math.ceil(Math.max(label, at, note))
}

/**
 * Where each marker sits along the axis, as offsets from the first one.
 * `metrics[i]` carries `before`/`after` — how far event i's block reaches
 * back and forward along the axis from its marker. Events alternate sides,
 * so only i and i+2 can collide; neighbours only need MIN_ADJ between
 * markers. Returns `{ offsets, length, compressed, collisions }`.
 */
function placeAlongAxis(metrics, times, { fillLen, maxLen }) {
  const n = metrics.length
  if (n === 1) return { offsets: [0], length: 0, compressed: false, collisions: 0 }
  let need = MIN_ADJ
  for (let i = 0; i + 2 < n; i++) need = Math.max(need, Math.ceil((metrics[i].after + metrics[i + 2].before + SAME_SIDE_GAP) / 2))
  let step = snapUp4(need)
  if (fillLen > 0) step = Math.max(step, Math.min(MAX_STEP, snap4(Math.floor(fillLen / (n - 1) / 4) * 4)))
  const ordinal = { offsets: metrics.map((_, i) => i * step), length: (n - 1) * step, compressed: false, collisions: 0 }
  if (!times) return ordinal

  const t0 = times[0]
  const tn = times[n - 1]
  const violations = (offsets) => {
    let count = 0
    for (let i = 1; i < n; i++) if (offsets[i] - offsets[i - 1] < MIN_ADJ) count++
    for (let i = 0; i + 2 < n; i++) {
      if (offsets[i + 2] - offsets[i] < metrics[i].after + metrics[i + 2].before + SAME_SIDE_GAP) count++
    }
    return count
  }
  if (tn <= t0) return { ...ordinal, compressed: true, collisions: violations(metrics.map(() => 0)) }
  const project = (len) => times.map((t) => snap4((len * (t - t0)) / (tn - t0)))
  const floor = Math.max(ordinal.length, Math.min(fillLen, (n - 1) * MAX_STEP))
  const ceiling = Math.max(floor, maxLen)
  const worst = violations(project(ceiling))
  if (worst > 0) return { ...ordinal, compressed: true, collisions: worst }
  let lo = floor
  let hi = ceiling
  while (lo < hi) {
    const mid = snap4(Math.floor((lo + hi) / 2 / 4) * 4)
    if (violations(project(mid)) === 0) hi = mid
    else lo = mid + 4
  }
  return { offsets: project(hi), length: hi, compressed: false, collisions: 0 }
}

/**
 * Deterministic: text metrics decide the block sizes, the scale decides the
 * spacing, and everything else is a fixed offset from the axis. A `right`
 * figure stretches its ordinal spacing to fill the 720px column (capped at
 * MAX_STEP per gap); a `down` figure keeps its natural width and spaces
 * events DOWN_STEP apart (a time axis starts from that length and only
 * grows when its labels need the room).
 */
export async function layout(ir, { column = COLUMN } = {}) {
  const right = ir.direction === 'right'
  const n = ir.events.length
  const metrics = ir.events.map((e) => {
    const w = blockTextWidth(e)
    const hasNote = Boolean(e.note)
    if (right) {
      const half = snapUp4(Math.ceil(w / 2))
      return { w, hasNote, half, before: half, after: half }
    }
    return { w, hasNote, half: 0, before: hasNote ? SIDE.beforeWithNote : SIDE.before, after: hasNote ? SIDE.afterWithNote : SIDE.after }
  })
  const times = ir.scale === 'time' ? ir.events.map((e) => parseAt(e.at)) : null
  const mStart = snapUp4(PAD + Math.max(metrics[0].before, AXIS_LEAD))
  const mEnd = snapUp4(PAD + Math.max(metrics[n - 1].after, ARROW_ROOM))
  const fillLen = right ? snap4(Math.floor((column - mStart - mEnd) / 4) * 4) : (n - 1) * DOWN_STEP
  const maxLen = right ? snap4(Math.floor((column / MIN_SCALE - mStart - mEnd) / 4) * 4) : DOWN_MAX_LEN
  const placed = placeAlongAxis(metrics, times, { fillLen, maxLen })
  const positions = placed.offsets.map((o) => mStart + o)

  let width
  let height
  let axis
  const events = []
  if (right) {
    const aboveDepth = metrics.reduce((m, mt, i) => (i % 2 === 0 ? Math.max(m, mt.hasNote ? -ABOVE.topWithNote : -ABOVE.top) : m), 0)
    const belowDepth = metrics.reduce((m, mt, i) => (i % 2 === 1 ? Math.max(m, mt.hasNote ? BELOW.bottomWithNote : BELOW.bottom) : m), TICK)
    const axisY = snapUp4(PAD + aboveDepth)
    width = mStart + placed.length + mEnd
    height = snapUp4(axisY + belowDepth + PAD)
    axis = { x1: mStart - AXIS_LEAD, y1: axisY, x2: mStart + placed.length + ARROW_ROOM, y2: axisY }
    ir.events.forEach((e, i) => {
      const mt = metrics[i]
      const cx = positions[i]
      const above = i % 2 === 0
      const block = above
        ? { x: cx - mt.half, y: axisY + (mt.hasNote ? ABOVE.topWithNote : ABOVE.top), width: mt.half * 2, height: (mt.hasNote ? -ABOVE.topWithNote : -ABOVE.top) - BLOCK_GAP }
        : { x: cx - mt.half, y: axisY + BLOCK_GAP, width: mt.half * 2, height: (mt.hasNote ? BELOW.bottomWithNote : BELOW.bottom) - BLOCK_GAP }
      const lines = above
        ? [
            { kind: 'label', x: cx, y: axisY + (mt.hasNote ? ABOVE.labelWithNote : ABOVE.label), anchor: 'middle' },
            ...(mt.hasNote ? [{ kind: 'note', x: cx, y: axisY + ABOVE.note, anchor: 'middle' }] : []),
            { kind: 'at', x: cx, y: axisY + ABOVE.at, anchor: 'middle' },
          ]
        : [
            { kind: 'at', x: cx, y: axisY + BELOW.at, anchor: 'middle' },
            { kind: 'label', x: cx, y: axisY + BELOW.label, anchor: 'middle' },
            ...(mt.hasNote ? [{ kind: 'note', x: cx, y: axisY + BELOW.note, anchor: 'middle' }] : []),
          ]
      events.push({ id: e.id, index: i, label: e.label, at: e.at, note: e.note, emphasis: e.emphasis, tone: e.tone, side: above ? 'above' : 'below', cx, cy: axisY, tick: { x1: cx, y1: axisY - TICK, x2: cx, y2: axisY + TICK }, block, lines })
    })
  } else {
    const leftW = metrics.reduce((m, mt, i) => (i % 2 === 0 ? Math.max(m, snapUp4(mt.w)) : m), 0)
    const rightW = metrics.reduce((m, mt, i) => (i % 2 === 1 ? Math.max(m, snapUp4(mt.w)) : m), 0)
    const axisX = snapUp4(PAD + leftW + BLOCK_GAP)
    width = snapUp4(axisX + BLOCK_GAP + rightW + PAD)
    height = mStart + placed.length + mEnd
    axis = { x1: axisX, y1: mStart - AXIS_LEAD, x2: axisX, y2: mStart + placed.length + ARROW_ROOM }
    ir.events.forEach((e, i) => {
      const mt = metrics[i]
      const cy = positions[i]
      const left = i % 2 === 0
      const w = snapUp4(mt.w)
      const block = { x: left ? axisX - BLOCK_GAP - w : axisX + BLOCK_GAP, y: cy - mt.before, width: w, height: mt.before + mt.after }
      const tx = left ? axisX - BLOCK_GAP : axisX + BLOCK_GAP
      const anchor = left ? 'end' : 'start'
      const lines = [
        { kind: 'at', x: tx, y: cy + (mt.hasNote ? SIDE.atWithNote : SIDE.at), anchor },
        { kind: 'label', x: tx, y: cy + (mt.hasNote ? SIDE.labelWithNote : SIDE.label), anchor },
        ...(mt.hasNote ? [{ kind: 'note', x: tx, y: cy + SIDE.note, anchor }] : []),
      ]
      events.push({ id: e.id, index: i, label: e.label, at: e.at, note: e.note, emphasis: e.emphasis, tone: e.tone, side: left ? 'left' : 'right', cx: axisX, cy, tick: { x1: axisX - TICK, y1: cy, x2: axisX + TICK, y2: cy }, block, lines })
    })
  }

  const geo = { direction: ir.direction, scale: ir.scale, compressed: placed.compressed, collisions: placed.collisions, axis, events }
  return { width, height, geo }
}

// --- draw ----------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')
  const a = geo.axis
  parts.push(`<line id="${uid}-axis" x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)

  for (const e of geo.events) {
    const t = e.tick
    parts.push(`<line id="${uid}-tick-${e.id}" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke="currentColor" stroke-width="1"/>`)
    if (e.emphasis) {
      const half = FOCAL_SIZE / 2
      parts.push(`<rect id="${uid}-ev-${e.id}" class="wu-focal" data-tone="${esc(e.tone)}" x="${e.cx - half}" y="${e.cy - half}" width="${FOCAL_SIZE}" height="${FOCAL_SIZE}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1.5"/>`)
    } else {
      const fill = e.tone === 'neutral' ? 'var(--wu-surface)' : `var(--wu-fig-tone-${e.tone})`
      parts.push(`<circle id="${uid}-ev-${e.id}" cx="${e.cx}" cy="${e.cy}" r="${DOT_R}" fill="${fill}" stroke="currentColor" stroke-width="1.5"/>`)
    }
    for (const l of e.lines) {
      const anchor = l.anchor === 'start' ? '' : ` text-anchor="${l.anchor}"`
      if (l.kind === 'label') {
        const weight = e.emphasis ? ' font-weight="700"' : ''
        parts.push(`<text id="${uid}-ev-${e.id}-label" x="${l.x}" y="${l.y}" font-size="${FONT_SIZE}"${weight}${anchor} fill="currentColor">${esc(e.label)}</text>`)
      } else if (l.kind === 'at') {
        parts.push(`<text id="${uid}-ev-${e.id}-at" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}"${anchor} fill="var(--wu-ink-3)">${esc(e.at)}</text>`)
      } else {
        parts.push(`<text id="${uid}-ev-${e.id}-note" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}"${anchor} fill="var(--wu-ink-3)">${esc(e.note)}</text>`)
      }
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------

const overlaps = (p, q) => Math.max(p.x, q.x) < Math.min(p.x + p.width, q.x + q.width)
  && Math.max(p.y, q.y) < Math.min(p.y + p.height, q.y + q.height)

export function verify(layoutResult, ir) {
  const { geo } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'event-count', 'budget:events', `${ir.events.length} event(s)`)
  budgetRow(2, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  budgetRow(3, 'emphasis-count', 'budget:emphasis', `${ir.events.filter((e) => e.emphasis).length} emphasized event(s)`)

  const right = geo.direction === 'right'
  const pos = (e) => (right ? e.cx : e.cy)

  // 4. events run along the axis in IR order, and their dates never go backwards
  const idOrder = ir.events.map((e) => e.id)
  const sameOrder = geo.events.length === idOrder.length && geo.events.every((e, i) => e.id === idOrder[i])
  const backwards = []
  for (let i = 1; i < geo.events.length; i++) {
    if (pos(geo.events[i]) <= pos(geo.events[i - 1])) backwards.push(`${geo.events[i - 1].id}/${geo.events[i].id}`)
  }
  const times = ir.events.map((e) => parseAt(e.at))
  const dateBackwards = []
  if (times.every((t) => t !== null)) {
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) dateBackwards.push(`${ir.events[i - 1].id} (${ir.events[i - 1].at}) → ${ir.events[i].id} (${ir.events[i].at})`)
  }
  const orderedOk = sameOrder && backwards.length === 0 && dateBackwards.length === 0
  rows.push({
    id: 4, name: 'events-ordered', severity: 'fail', ok: orderedOk,
    detail: orderedOk ? `events run ${right ? 'left to right' : 'top to bottom'} in chronological order`
      : !sameOrder ? 'geometry order differs from ir.events'
        : backwards.length ? `event(s) not after their predecessor on the axis: ${backwards.join(', ')}`
          : `date(s) go backwards: ${dateBackwards.join(', ')}`,
    hint: orderedOk ? undefined : 'list events in chronological order (earliest first)',
  })

  // 5. no two text blocks overlap
  const clashes = []
  for (let i = 0; i < geo.events.length; i++) {
    for (let j = i + 1; j < geo.events.length; j++) {
      if (overlaps(geo.events[i].block, geo.events[j].block)) clashes.push(`${geo.events[i].id}/${geo.events[j].id}`)
    }
  }
  rows.push({
    id: 5, name: 'labels-clear', severity: 'fail', ok: clashes.length === 0,
    detail: clashes.length ? `overlapping label block(s): ${clashes.join(', ')}` : 'no two event blocks overlap',
    hint: clashes.length ? 'shorten the colliding labels, or switch to scale: ordinal' : undefined,
  })

  // 6. every marker sits on the axis line, between its two ends
  const off = geo.events.filter((e) => (right
    ? e.cy !== geo.axis.y1 || e.cx < geo.axis.x1 || e.cx > geo.axis.x2
    : e.cx !== geo.axis.x1 || e.cy < geo.axis.y1 || e.cy > geo.axis.y2))
  rows.push({
    id: 6, name: 'events-on-axis', severity: 'fail', ok: off.length === 0,
    detail: off.length ? `marker(s) off the axis: ${off.map((e) => e.id).join(', ')}` : 'every marker sits on the axis',
    hint: off.length ? 'place every marker on the axis line between its two ends' : undefined,
  })

  // 7. the time scale is honest (positions proportional to the dates)
  const compressed = geo.scale === 'time' && geo.compressed
  rows.push({
    id: 7, name: 'time-scale', severity: 'warn', ok: !compressed,
    detail: compressed ? `time scale compressed: ${geo.collisions} pair(s) of events too close for their labels, spacing fell back to ordinal`
      : geo.scale === 'time' ? 'positions are proportional to the dates' : 'ordinal scale (uniform spacing)',
    hint: compressed ? 'merge the events that sit close together, or set scale: ordinal to make the uniform spacing explicit' : undefined,
    ...(compressed ? { key: 'scale:compressed', value: geo.collisions } : {}),
  })

  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'events on a single time axis (release history, incident timeline, phased migration), labels alternating across the axis',
  whenToUse: 'when *when* matters more than *what connects to what* — the context and stages behind a decision; not for causal chains (use sequence) nor for parallel tasks with durations (use gantt). Budgets: events ≤ 12, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn. Dates (YYYY, YYYY-MM, YYYY-MM-DD) get a proportional time scale; anything else is ordinal.',
  irExample: `id: migration
type: timeline
title: 移行の経緯
caption: 方針決定から旧系停止まで、二重書きの期間が山場
events:
  - id: decide
    label: 方針決定
    at: 2026-01-15
  - id: poc
    label: PoC 完了
    at: 2026-02-28
    note: 性能 1.8 倍を確認
  - id: dual
    label: 二重書き開始
    at: 2026-04-01
    emphasis: true
  - id: read
    label: 読み取り切替
    at: 2026-05-20
    tone: new
  - id: write
    label: 書き込み切替
    at: 2026-07-01
    tone: new
  - id: retire
    label: 旧系停止
    at: 2026-09-30
    tone: rs
`,
  rows: ['event-count', 'label-length', 'emphasis-count', 'events-ordered', 'labels-clear', 'events-on-axis', 'time-scale'],
}
