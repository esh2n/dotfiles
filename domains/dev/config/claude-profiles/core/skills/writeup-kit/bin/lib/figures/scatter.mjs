// `type: scatter` — two quantities per point on a pair of numeric axes, with
// an optional third quantity as bubble area and up to three series told
// apart by marker shape (circle / square / triangle — never colour).
//
// IR shape: `{ id, type:'scatter', title, caption?, x, y, size?, points, series? }`.
//   x, y:    { label, unit?, from? }        axis title (+ unit in parentheses);
//                                           `from` is the axis start, default 0 —
//                                           ≠ 0 draws a visible axis break and a
//                                           footnote (survey chart rule)
//   size:    { label, unit? }               declares bubbles: every point then
//                                           needs `size` > 0, drawn as AREA ∝ size
//                                           (r = R_MAX·√(size/max)); the footnote
//                                           「円の面積 = <label>」 and a reference
//                                           bubble in the legend state the scale
//   points:  [{ id, label?, x, y, size?, series?, emphasis? }]
//            label is optional — only labelled points get text; emphasis is
//            the kit accent stroke + bold label (≤ 2 per figure)
//   series:  [{ id, label }] ≤ 3            when declared, every point names one
//
// Rules the verify rows encode (survey §2 row 23): every marker sits inside
// the plot; positions are proportional to the values on a shared linear
// scale (within 1px); bubble area is proportional to size within 2% and the
// larger bubbles are drawn first so no bubble hides a smaller one; labels
// are de-collided on the 4px grid with leaders (as in quadrant) and never
// overlap each other or another marker; series shapes are unique; a
// truncated axis is disclosed. Budgets: points ≤ 30, labelled ≤ 12, label ≤
// 12 chars, emphasis ≤ 2 — warnings, never a rejection.
//
// Grid: the plot frame, ticks, tick labels, titles, label boxes, leaders'
// label ends and the legend row are on the 4px grid (`x`/`y` keys — the
// shared `grid-4px` row reads them). Marker centres are `px`/`py` (0.1px):
// a centre snapped to 4px would no longer be proportional to its value —
// `points-proportional` governs them instead. Labels sit an `INSET` inside
// the frame together with the scale, so a bubble at the axis maximum still
// clears the frame.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc, LEGEND_HEIGHT } from './_shared.mjs'
import { COLUMN, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, snap4, snapUp4, textWidth } from '../diagram.mjs'

export const type = 'scatter'

export const limits = { maxPoints: 30, maxLabelled: 12, maxLabelLen: 12, maxEmphasis: 2 }

// --- metrics -----------------------------------------------------------------

const PAD = 16
const AXIS_GAP = 8             // rotated y title → tick labels
const LABEL_GAP = 8            // marker edge → label box; tick → tick label
const LABEL_H = 16             // 13px text box, on the grid
const LABEL_PAD = 4            // halo padding either side of the label text
const SMALL_H = 16             // 11px text box (rotated title width, tick rows)
const DOT_R = 5                // plain marker (equivalent-area radius)
const DOT_R_EMPHASIS = 6
const R_MAX = 24               // bubble radius at the largest size
const MARKER_CLEAR = 4         // keep-out ring around a marker
const INNER_W_TARGET = 432     // scale width at a full column
const INNER_H_TARGET = 288
const TICK_X_MIN = 24
const TICK_X_MAX = 120
const TICK_Y_MIN = 24
const TICK_Y_MAX = 96
const NOTE_STEP = 16
const LEGEND_PAD = 12
const LEGEND_SWATCH = 30
const LEGEND_SWATCH_GAP = 8
const LEGEND_ITEM_GAP = 22
const SHAPES = ['circle', 'square', 'triangle']
const MAX_SERIES = SHAPES.length
const NUDGE_STEPS = [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20, -24, 24, -28, 28, -32, 32, -36, 36, -40, 40]
const PUSH_STEPS = [0, 8, 16, 24]
const SQRT_PI = Math.sqrt(Math.PI)
const TRI_K = Math.sqrt((4 * Math.PI) / Math.sqrt(3))   // equilateral side with the area of a circle of radius 1

// --- schema ------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function normalizeAxis(raw, name, ctx) {
  const actx = `${ctx}.${name}`
  if (!isObj(raw)) throw new IrError(`${actx} must be a mapping with label (and optional unit, from)`)
  const axis = { label: requireStr(raw, 'label', actx) }
  const unit = optStr(raw, 'unit', actx)
  if (unit !== undefined) axis.unit = unit
  if (raw.from === undefined || raw.from === null) axis.from = 0
  else if (!isNum(raw.from)) throw new IrError(`${actx}.from must be a finite number (got: ${JSON.stringify(raw.from)})`)
  else axis.from = raw.from
  return axis
}

function normalizeSizeAxis(raw, ctx) {
  if (raw === undefined || raw === null) return undefined
  const sctx = `${ctx}.size`
  if (!isObj(raw)) throw new IrError(`${sctx} must be a mapping with label (and optional unit)`)
  const axis = { label: requireStr(raw, 'label', sctx) }
  const unit = optStr(raw, 'unit', sctx)
  if (unit !== undefined) axis.unit = unit
  return axis
}

function normalizeSeries(raw, ctx) {
  if (raw === undefined || raw === null) return undefined
  const sctx = `${ctx}.series`
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${sctx} must be a non-empty list of { id, label }`)
  if (raw.length > MAX_SERIES) throw new IrError(`${sctx} has ${raw.length} entries — at most ${MAX_SERIES} series can be told apart by marker shape (circle / square / triangle); split the figure or merge series`)
  const seen = new Set()
  return raw.map((s, i) => {
    const ictx = `${sctx}[${i}]`
    if (!isObj(s)) throw new IrError(`${ictx} must be a mapping`)
    const id = requireStr(s, 'id', ictx)
    if (seen.has(id)) throw new IrError(`duplicate series id: "${id}"`)
    seen.add(id)
    return { id, label: requireStr(s, 'label', ictx) }
  })
}

function requireCoord(obj, field, axis, ctx) {
  const v = obj[field]
  if (!isNum(v)) throw new IrError(`${ctx}.${field} must be a finite number (got: ${JSON.stringify(v)})`)
  if (axis.from !== 0 && v < axis.from) throw new IrError(`${ctx}.${field} (${v}) lies below ${field}.from (${axis.from}) — lower ${field}.from or fix the value`)
  return v
}

function normalizePoints(raw, x, y, size, series, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.points must be a non-empty list`)
  const seen = new Set()
  const seriesIds = series ? new Set(series.map((s) => s.id)) : undefined
  return raw.map((p, i) => {
    const pctx = `${ctx}.points[${i}]`
    if (!isObj(p)) throw new IrError(`${pctx} must be a mapping`)
    const id = requireStr(p, 'id', pctx)
    if (seen.has(id)) throw new IrError(`duplicate point id: "${id}"`)
    seen.add(id)
    const out = { id }
    const label = optStr(p, 'label', pctx)
    if (label !== undefined) {
      if (label.trim() === '') throw new IrError(`${pctx}.label must be a non-empty string when given`)
      out.label = label
    }
    out.x = requireCoord(p, 'x', x, pctx)
    out.y = requireCoord(p, 'y', y, pctx)
    if (size) {
      if (!isNum(p.size) || p.size <= 0) throw new IrError(`${pctx}.size must be a positive number when ${ctx}.size is declared (got: ${JSON.stringify(p.size)})`)
      out.size = p.size
    } else if (p.size !== undefined && p.size !== null) {
      throw new IrError(`${pctx}.size is set but ${ctx}.size (the size axis) is not declared — add size: { label } to draw bubbles`)
    }
    if (seriesIds) {
      const s = p.series
      if (typeof s !== 'string' || !seriesIds.has(s)) throw new IrError(`${pctx}.series must name one of ${[...seriesIds].join('|')} (got: ${JSON.stringify(s)})`)
      out.series = s
    } else if (p.series !== undefined && p.series !== null) {
      throw new IrError(`${pctx}.series is set but ${ctx}.series is not declared — list the series as [{ id, label }]`)
    }
    out.emphasis = validateBool(p, 'emphasis', pctx)
    return out
  })
}

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const x = normalizeAxis(raw.x, 'x', ctx)
  const y = normalizeAxis(raw.y, 'y', ctx)
  const size = normalizeSizeAxis(raw.size, ctx)
  const series = normalizeSeries(raw.series, ctx)
  const points = normalizePoints(raw.points, x, y, size, series, ctx)
  const ir = { id, type, title }
  if (caption !== undefined) ir.caption = caption
  ir.x = x
  ir.y = y
  if (size) ir.size = size
  ir.points = points
  if (series) ir.series = series
  return ir
}

// --- budgets -----------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const n = ir.points.length
  if (n > limits.maxPoints) {
    out.push(budgetWarning('budget:points', n, limits.maxPoints,
      `${n} point(s) (guidance ≤ ${limits.maxPoints})`,
      `bin or aggregate to ≤ ${limits.maxPoints} points, or show only the decisive subset`))
  }
  const labelled = ir.points.filter((p) => p.label !== undefined)
  if (labelled.length > limits.maxLabelled) {
    out.push(budgetWarning('budget:labels', labelled.length, limits.maxLabelled,
      `${labelled.length} labelled point(s) (guidance ≤ ${limits.maxLabelled})`,
      `label only the points the caption talks about (≤ ${limits.maxLabelled}); the rest stay as markers`))
  }
  const long = labelled.filter((p) => [...p.label].length > limits.maxLabelLen)
  if (long.length) {
    const longest = long.reduce((m, p) => ([...p.label].length > [...m.label].length ? p : m), long[0])
    out.push(budgetWarning('budget:label', [...longest.label].length, limits.maxLabelLen,
      `${long.length} label(s) longer than ${limits.maxLabelLen} chars (longest: "${longest.label}")`,
      `shorten "${longest.label}" to ≤ ${limits.maxLabelLen} chars; put the detail in the caption`))
  }
  const focal = ir.points.filter((p) => p.emphasis).length
  if (focal > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', focal, limits.maxEmphasis,
      `${focal} emphasized point(s) (guidance ≤ ${limits.maxEmphasis})`,
      `keep emphasis for the ${limits.maxEmphasis} point(s) the caption names — more than two accents is no emphasis`))
  }
  return out
}

// --- layout --------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
const round2 = (v) => Math.round(v * 100) / 100
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const snapDown4 = (v) => Math.floor(v / 4) * 4
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))))
/** `120 ms`, `12%`, `3件` — a one-char unit hugs the number. */
const fmtUnit = (v, unit) => (unit ? `${fmt(v)}${[...unit].length === 1 ? '' : ' '}${unit}` : fmt(v))
const titleOf = (axis) => (axis.unit ? `${axis.label}（${axis.unit}）` : axis.label)
const boxW = (text, size, bold = false) => textWidth(text, size) * (bold ? BOLD_FACTOR : 1)
const smallW = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE))

/** Nice ticks: a 1/2/2.5/5 × 10^k step giving ≤ 6 steps from `from` (the
 * declared axis start) to the data maximum; data below `from` (negative
 * values with the default 0) extend the axis down to a step multiple. */
function niceScale(lo, hi, from) {
  const span = Math.max(hi - Math.min(lo, from), 0)
  const rough = span > 0 ? span / 4 : 1
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  let step = mag
  for (const m of [1, 2, 2.5, 5, 10]) {
    step = Number((m * mag).toPrecision(12))
    if (Math.ceil(span / step - 1e-9) <= 6) break
  }
  const vmin = lo < from ? Number((Math.floor(lo / step) * step).toPrecision(12)) : from
  const nSteps = Math.max(1, Math.ceil((hi - vmin) / step - 1e-9))
  const vmax = Number((vmin + nSteps * step).toPrecision(12))
  const ticks = Array.from({ length: nSteps + 1 }, (_, k) => Number((vmin + k * step).toPrecision(12)))
  return { vmin, vmax, step, nSteps, ticks }
}

/** The 1/2/5 × 10^k value nearest below `max / 3` — the legend's reference bubble. */
function niceReference(max) {
  const target = max / 3
  const mag = Math.pow(10, Math.floor(Math.log10(target)))
  let best = mag
  for (const m of [1, 2, 5]) {
    const v = Number((m * mag).toPrecision(12))
    if (v <= target) best = v
  }
  return best
}

/** Every k-th tick label so that the widest one never touches its neighbour. */
function tickSkip(n, step, widest) {
  if (n <= 1 || step <= 0) return 1
  let skip = 1
  while (skip < n && widest + LABEL_GAP > skip * step) skip++
  return skip
}

const bubbleRadius = (size, sizeMax) => round2(R_MAX * Math.sqrt(size / sizeMax))

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function inside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

const markerBox = (m) => ({ x: m.px - m.r - MARKER_CLEAR, y: m.py - m.r - MARKER_CLEAR, width: (m.r + MARKER_CLEAR) * 2, height: (m.r + MARKER_CLEAR) * 2 })

/** Candidate label boxes for one marker, sorted by a deterministic cost so
 * the nudging prefers (in order): the natural side at the marker's own
 * height, a small vertical shift, the other side, a push outwards from
 * the marker, and only then a slot centred above or below (quadrant's
 * scheme, with the marker radius folded in). Ties keep generation order. */
function candidates(m, width, plot) {
  const rightX = snapUp4(m.px + m.r + LABEL_GAP)
  const leftX = snapDown4(m.px - m.r - LABEL_GAP - width)
  const baseY = snap4(m.py) - LABEL_H / 2
  const preferRight = rightX + width <= plot.x + plot.width
  const sides = preferRight ? ['right', 'left'] : ['left', 'right']
  const out = []
  sides.forEach((side, sideIdx) => {
    for (const dy of NUDGE_STEPS) {
      for (const push of PUSH_STEPS) {
        const x = side === 'right' ? rightX + push : leftX - push
        out.push({ x, y: baseY + dy, width, height: LABEL_H, side, nudged: dy !== 0 || push > 0, cost: Math.abs(dy) + push * 1.5 + sideIdx * 12 })
      }
    }
  })
  const topY = snapDown4(m.py - m.r - MARKER_CLEAR - LABEL_H)
  const bottomY = snapUp4(m.py + m.r + MARKER_CLEAR)
  for (const dx of NUDGE_STEPS) {
    const x = snap4(m.px - width / 2) + dx
    out.push({ x, y: topY, width, height: LABEL_H, side: 'top', nudged: true, cost: 20 + Math.abs(dx) })
    out.push({ x, y: bottomY, width, height: LABEL_H, side: 'bottom', nudged: true, cost: 22 + Math.abs(dx) })
  }
  return out.map((c, i) => ({ ...c, i })).sort((a, b) => a.cost - b.cost || a.i - b.i)
}

/** Leader from the marker's edge to the midpoint of the label box's edge
 * that faces it (the label end on the grid, the marker end at 0.1px). */
function leaderFor(m, box) {
  const end = box.side === 'right' ? { x: box.x, y: box.y + LABEL_H / 2 }
    : box.side === 'left' ? { x: box.x + box.width, y: box.y + LABEL_H / 2 }
    : box.side === 'top' ? { x: box.x + box.width / 2, y: box.y + LABEL_H }
    : { x: box.x + box.width / 2, y: box.y }
  const x2 = snap4(end.x)
  const y2 = snap4(end.y)
  const dx = x2 - m.px
  const dy = y2 - m.py
  const len = Math.hypot(dx, dy) || 1
  return { fromX: round1(m.px + (dx / len) * m.r), fromY: round1(m.py + (dy / len) * m.r), x2, y2 }
}

function buildNotes(ir) {
  const notes = []
  if (ir.x.from !== 0) notes.push({ key: 'xfrom', text: `x 軸は ${fmtUnit(ir.x.from, ir.x.unit)} から始まる（0 起点ではない）` })
  if (ir.y.from !== 0) notes.push({ key: 'yfrom', text: `y 軸は ${fmtUnit(ir.y.from, ir.y.unit)} から始まる（0 起点ではない）` })
  if (ir.size) notes.push({ key: 'size', text: `円の面積 = ${ir.size.label}` })
  return notes
}

function buildLegend(ir, sizeMax) {
  const items = []
  if (ir.series) {
    ir.series.forEach((s, i) => items.push({ kind: 'series', id: s.id, shape: SHAPES[i], label: s.label }))
  }
  if (ir.size) {
    const ref = niceReference(sizeMax)
    items.push({ kind: 'size', value: ref, r: bubbleRadius(ref, sizeMax), label: `= ${fmtUnit(ref, ir.size.unit)}` })
  }
  if (!items.length) return undefined
  let x = LEGEND_PAD
  let tallest = LEGEND_HEIGHT
  const laid = items.map((item) => {
    const labelWidth = smallW(item.label)
    const swatch = item.kind === 'size' ? Math.max(LEGEND_SWATCH, Math.ceil(item.r * 2)) : LEGEND_SWATCH
    const swatchX = x
    const textX = swatchX + swatch + LEGEND_SWATCH_GAP
    x = textX + labelWidth + LEGEND_ITEM_GAP
    if (item.kind === 'size') tallest = Math.max(tallest, Math.ceil(item.r * 2) + 8)
    return { ...item, swatchX, swatchW: swatch, textX, labelWidth }
  })
  return { items: laid, width: x - LEGEND_ITEM_GAP + LEGEND_PAD, height: snapUp4(tallest) }
}

export async function layout(ir, { column = COLUMN } = {}) {
  const hasSize = !!ir.size
  const xs = ir.points.map((p) => p.x)
  const ys = ir.points.map((p) => p.y)
  const sx = niceScale(Math.min(...xs), Math.max(...xs), ir.x.from)
  const sy = niceScale(Math.min(...ys), Math.max(...ys), ir.y.from)
  const sizeMax = hasSize ? Math.max(...ir.points.map((p) => p.size)) : undefined
  const maxR = hasSize ? R_MAX : DOT_R_EMPHASIS
  const inset = snapUp4(maxR + MARKER_CLEAR)

  const xTickLabels = sx.ticks.map(fmt)
  const yTickLabels = sy.ticks.map(fmt)
  const yTickW = Math.max(...yTickLabels.map(smallW))
  const xTickWidest = Math.max(...xTickLabels.map(smallW))
  const plotX = snapUp4(PAD + SMALL_H + AXIS_GAP + yTickW + LABEL_GAP)
  const plotY = PAD

  const availInner = column - plotX - PAD - inset * 2
  let tickPxX = clamp(snap4(INNER_W_TARGET / sx.nSteps), TICK_X_MIN, TICK_X_MAX)
  while (sx.nSteps * tickPxX > availInner && tickPxX > TICK_X_MIN) tickPxX -= 4
  const innerW = sx.nSteps * tickPxX
  const tickPxY = clamp(snap4(INNER_H_TARGET / sy.nSteps), TICK_Y_MIN, TICK_Y_MAX)
  const innerH = sy.nSteps * tickPxY
  const plot = { x: plotX, y: plotY, width: innerW + inset * 2, height: innerH + inset * 2 }
  const inner = { x: plot.x + inset, y: plot.y + inset, width: innerW, height: innerH }
  const scale = { x: { ...sx, left: inner.x, width: innerW }, y: { ...sy, bottom: inner.y + innerH, height: innerH }, sizeMax, rMax: R_MAX }
  const xOf = (v) => round1(inner.x + ((v - sx.vmin) / (sx.vmax - sx.vmin)) * innerW)
  const yOf = (v) => round1(inner.y + innerH - ((v - sy.vmin) / (sy.vmax - sy.vmin)) * innerH)

  const xSkip = tickSkip(sx.ticks.length, tickPxX, xTickWidest)
  const xTicks = sx.ticks.map((t, k) => ({ value: t, label: xTickLabels[k], x: inner.x + k * tickPxX, zero: t === 0 && sx.vmin < 0, shown: k % xSkip === 0 }))
  const yTicks = sy.ticks.map((t, k) => ({ value: t, label: yTickLabels[k], y: inner.y + innerH - k * tickPxY, zero: t === 0 && sy.vmin < 0, shown: true }))

  // titles: x centred under the tick row, y rotated at the left edge
  const xTitleText = titleOf(ir.x)
  const yTitleText = titleOf(ir.y)
  const tickRowY = plot.y + plot.height + 4          // top of the x tick label row
  const xTitleW = snapUp4(boxW(xTitleText, FONT_SIZE))
  const xTitle = { text: xTitleText, x: snap4(plot.x + plot.width / 2 - xTitleW / 2), y: tickRowY + SMALL_H + 4, width: xTitleW, height: LABEL_H }
  const yTitleW = snapUp4(boxW(yTitleText, FONT_SIZE))
  const yTitle = { text: yTitleText, x: PAD, y: snap4(plot.y + plot.height / 2 - yTitleW / 2), width: SMALL_H, height: yTitleW }

  // markers (0.1px centres; radius is the equivalent-area radius)
  const seriesIndex = new Map((ir.series || []).map((s, i) => [s.id, i]))
  const markers = ir.points.map((p, i) => ({
    id: p.id,
    px: xOf(p.x),
    py: yOf(p.y),
    r: hasSize ? bubbleRadius(p.size, sizeMax) : (p.emphasis ? DOT_R_EMPHASIS : DOT_R),
    shape: p.series !== undefined ? SHAPES[seriesIndex.get(p.series)] : 'circle',
    vx: p.x,
    vy: p.y,
    ...(hasSize ? { vsize: p.size } : {}),
    ...(p.series !== undefined ? { series: p.series } : {}),
    emphasis: p.emphasis,
    order: i,
  }))
  // draw order: bubbles largest first (a small one is never hidden), then
  // by IR order; plain markers in IR order with the emphasized ones last
  const order = [...markers]
    .sort((a, b) => (hasSize ? b.r - a.r || a.order - b.order : (a.emphasis === b.emphasis ? a.order - b.order : a.emphasis ? 1 : -1)))
    .map((m) => m.id)

  // labels: deterministic nudging on the 4px grid, IR order
  const placed = []
  const labels = []
  ir.points.forEach((p, i) => {
    if (p.label === undefined) return
    const m = markers[i]
    const width = snapUp4(boxW(p.label, FONT_SIZE, p.emphasis) + LABEL_PAD * 2)
    const obstacles = [...placed, ...markers.filter((o) => o !== m).map(markerBox)]
    const options = candidates(m, width, plot)
    let box = options.find((c) => inside(c, plot) && !obstacles.some((o) => intersects(c, o)))
    let collides = false
    if (!box) { box = options[0]; collides = true }
    const rec = { point: p.id, text: p.label, bold: p.emphasis, x: box.x, y: box.y, width, height: LABEL_H, side: box.side, collides }
    if (box.nudged && !collides) rec.leader = leaderFor(m, rec)
    placed.push(rec)
    labels.push(rec)
  })

  // below the plot: tick row, x title, footnotes, legend row
  let cursor = xTitle.y + LABEL_H
  const notes = buildNotes(ir).map((n, i) => ({ ...n, x: PAD, y: cursor + 4 + i * NOTE_STEP }))
  if (notes.length) cursor += 4 + notes.length * NOTE_STEP
  const legendRow = buildLegend(ir, sizeMax)
  let legend
  if (legendRow) {
    const y = snapUp4(cursor + 8)
    legend = { y, height: legendRow.height, items: legendRow.items }
    cursor = y + legendRow.height
  }
  const noteW = notes.length ? Math.max(...notes.map((n) => smallW(n.text))) + PAD * 2 : 0
  const width = snapUp4(Math.max(plot.x + plot.width + PAD, legendRow ? legendRow.width : 0, noteW))
  const height = snapUp4(cursor + PAD)
  const axisBreaks = []
  if (ir.x.from !== 0) axisBreaks.push({ axis: 'x', x: plot.x + 12, y: plot.y + plot.height })
  if (ir.y.from !== 0) axisBreaks.push({ axis: 'y', x: plot.x, y: plot.y + plot.height - 12 })
  return {
    width,
    height,
    geo: { plot, inner, scale, xTicks, yTicks, xTitle, yTitle, markers, order, labels, notes, axisBreaks, ...(legend ? { legend } : {}) },
  }
}

// --- draw ------------------------------------------------------------------------

/** One marker of `shape` centred at (cx, cy) with the area of a circle of
 * radius r: a circle, a square of side r·√π, or an equilateral triangle
 * (apex up) of side r·√(4π/√3), its centroid at the centre. */
function shapeSvg(shape, cx, cy, r, id, attrs) {
  if (shape === 'square') {
    const s = round2(r * SQRT_PI)
    return `<rect id="${id}" x="${round2(cx - s / 2)}" y="${round2(cy - s / 2)}" width="${s}" height="${s}"${attrs}/>`
  }
  if (shape === 'triangle') {
    const s = r * TRI_K
    const h = (s * Math.sqrt(3)) / 2
    const top = `${round2(cx)},${round2(cy - (2 * h) / 3)}`
    const bl = `${round2(cx - s / 2)},${round2(cy + h / 3)}`
    const br = `${round2(cx + s / 2)},${round2(cy + h / 3)}`
    return `<polygon id="${id}" points="${top} ${br} ${bl}"${attrs}/>`
  }
  return `<circle id="${id}" cx="${cx}" cy="${cy}" r="${r}"${attrs}/>`
}

function markerStyle(bubble, emphasis) {
  const stroke = emphasis ? 'var(--wu-accent)' : 'currentColor'
  if (bubble) return ` fill="currentColor" fill-opacity="0.12" stroke="${stroke}" stroke-width="${emphasis ? 1.5 : 1}"`
  if (emphasis) return ` fill="currentColor" stroke="${stroke}" stroke-width="1.5"`
  return ' fill="currentColor"'
}

function drawAxisBreak(uid, b) {
  if (b.axis === 'x') {
    return `<g id="${uid}-axis-break-x">` +
      `<rect x="${b.x - 4}" y="${b.y - 2}" width="8" height="4" fill="var(--wu-surface)" stroke="none"/>` +
      `<path d="M${b.x - 1} ${b.y + 4} L${b.x + 5} ${b.y - 4} M${b.x - 5} ${b.y + 4} L${b.x + 1} ${b.y - 4}" fill="none" stroke="currentColor" stroke-width="1"/>` +
      '</g>'
  }
  return `<g id="${uid}-axis-break-y">` +
    `<rect x="${b.x - 2}" y="${b.y - 4}" width="4" height="8" fill="var(--wu-surface)" stroke="none"/>` +
    `<path d="M${b.x - 4} ${b.y + 1} L${b.x + 4} ${b.y - 5} M${b.x - 4} ${b.y + 5} L${b.x + 4} ${b.y - 1}" fill="none" stroke="currentColor" stroke-width="1"/>` +
    '</g>'
}

function drawLegendRow(uid, legend) {
  const parts = [`<g id="${uid}-legend" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">`]
  const midY = legend.y + legend.height / 2
  for (const item of legend.items) {
    const cx = item.swatchX + item.swatchW / 2
    if (item.kind === 'series') {
      parts.push(shapeSvg(item.shape, cx, midY, DOT_R, `${uid}-legend-${item.id}`, ' fill="currentColor"'))
    } else {
      parts.push(`<circle id="${uid}-legend-size" cx="${cx}" cy="${midY}" r="${item.r}" data-size="${esc(fmt(item.value))}"${markerStyle(true, false)}/>`)
    }
    parts.push(`<text x="${item.textX}" y="${midY + 4}">${esc(item.label)}</text>`)
  }
  parts.push('</g>')
  return parts
}

export function draw(layoutResult, ir) {
  const uid = `wu-d-${ir.id}`
  const { plot, xTicks, yTicks, xTitle, yTitle, markers, order, labels, notes, axisBreaks, legend } = layoutResult.geo
  const bubble = !!ir.size
  const parts = []

  // grid + frame
  parts.push(`<g id="${uid}-grid" stroke="var(--wu-rule-soft)" stroke-width="1">`)
  for (const t of xTicks) {
    parts.push(`<line x1="${t.x}" y1="${plot.y}" x2="${t.x}" y2="${plot.y + plot.height}"${t.zero ? ' stroke="var(--wu-rule)"' : ''}/>`)
  }
  for (const t of yTicks) {
    parts.push(`<line x1="${plot.x}" y1="${t.y}" x2="${plot.x + plot.width}" y2="${t.y}"${t.zero ? ' stroke="var(--wu-rule)"' : ''}/>`)
  }
  parts.push('</g>')
  parts.push(`<rect id="${uid}-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" rx="4" fill="none" stroke="var(--wu-rule)" stroke-width="1"/>`)

  // tick labels + titles
  parts.push(`<g id="${uid}-x-ticks" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)" text-anchor="middle">`)
  xTicks.forEach((t, k) => { if (t.shown) parts.push(`<text id="${uid}-x-${k}" x="${t.x}" y="${plot.y + plot.height + 16}">${esc(t.label)}</text>`) })
  parts.push('</g>')
  parts.push(`<g id="${uid}-y-ticks" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)" text-anchor="end">`)
  yTicks.forEach((t, k) => parts.push(`<text id="${uid}-y-${k}" x="${plot.x - LABEL_GAP}" y="${t.y + 4}">${esc(t.label)}</text>`))
  parts.push('</g>')
  parts.push(`<text id="${uid}-x-title" x="${xTitle.x + xTitle.width / 2}" y="${xTitle.y + 12}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(xTitle.text)}</text>`)
  const ycx = yTitle.x + 12
  const ycy = yTitle.y + yTitle.height / 2
  parts.push(`<text id="${uid}-y-title" x="${ycx}" y="${ycy}" transform="rotate(-90 ${ycx} ${ycy})" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(yTitle.text)}</text>`)
  for (const b of axisBreaks) parts.push(drawAxisBreak(uid, b))

  // leaders, label halos, label text, then every marker on top
  for (const l of labels) {
    const ld = l.leader
    if (ld) parts.push(`<line id="${uid}-p-${l.point}-leader" x1="${ld.fromX}" y1="${ld.fromY}" x2="${ld.x2}" y2="${ld.y2}" stroke="var(--wu-ink-3)" stroke-width="1"/>`)
  }
  for (const l of labels) parts.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="4" fill="var(--wu-surface)" stroke="none"/>`)
  for (const l of labels) {
    const weight = l.bold ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-p-${l.point}-label" x="${l.x + LABEL_PAD}" y="${l.y + 12}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(l.text)}</text>`)
  }
  const byId = new Map(markers.map((m) => [m.id, m]))
  parts.push(`<g id="${uid}-points">`)
  for (const id of order) {
    const m = byId.get(id)
    if (!m) continue
    const data = ` data-x="${esc(fmt(m.vx))}" data-y="${esc(fmt(m.vy))}"${bubble ? ` data-size="${esc(fmt(m.vsize))}"` : ''}`
    parts.push(shapeSvg(m.shape, m.px, m.py, m.r, `${uid}-p-${m.id}`, `${data}${markerStyle(bubble, m.emphasis)}`))
  }
  parts.push('</g>')

  if (notes.length) {
    parts.push(`<g id="${uid}-notes" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">`)
    for (const n of notes) parts.push(`<text id="${uid}-note-${n.key}" x="${n.x}" y="${n.y + 12}">${esc(n.text)}</text>`)
    parts.push('</g>')
  }
  if (legend) parts.push(...drawLegendRow(uid, legend))
  return parts.join('')
}

// --- verify ----------------------------------------------------------------------

export function verify(layoutResult, ir, { svg } = {}) {
  const geo = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const { plot, scale, markers, labels } = geo
  const bubble = !!ir.size
  const rows = []

  // #1 every marker (with its radius) inside the plot frame
  const outside = markers.filter((m) => m.px - m.r < plot.x || m.px + m.r > plot.x + plot.width || m.py - m.r < plot.y || m.py + m.r > plot.y + plot.height)
  rows.push({
    id: 1, name: 'points-in-plot', severity: 'fail', ok: outside.length === 0,
    detail: outside.length ? `marker(s) leaving the plot: ${outside.map((m) => m.id).join(', ')}` : `${markers.length} marker(s) inside the plot frame`,
    hint: outside.length ? 'the scale must cover every value and the frame must keep an inset of the largest radius' : undefined,
  })

  // #2 positions proportional to the values on the shared linear scale (1px), data-x/data-y stamped
  const off = []
  const sxs = scale.x
  const sys = scale.y
  for (const m of markers) {
    const wantX = sxs.left + ((m.vx - sxs.vmin) / (sxs.vmax - sxs.vmin)) * sxs.width
    const wantY = sys.bottom - ((m.vy - sys.vmin) / (sys.vmax - sys.vmin)) * sys.height
    if (!(typeof m.px === 'number' && Math.abs(m.px - wantX) <= 1)) off.push(`${m.id} x=${m.vx} drawn at ${m.px} (expected ${round1(wantX)})`)
    if (!(typeof m.py === 'number' && Math.abs(m.py - wantY) <= 1)) off.push(`${m.id} y=${m.vy} drawn at ${m.py} (expected ${round1(wantY)})`)
  }
  if (svg !== undefined) {
    const nx = (svg.match(/\bdata-x="/g) || []).length
    const ny = (svg.match(/\bdata-y="/g) || []).length
    if (nx !== markers.length || ny !== markers.length) off.push(`${nx} data-x / ${ny} data-y markers in the svg, expected ${markers.length}`)
  }
  rows.push({
    id: 2, name: 'points-proportional', severity: 'fail', ok: off.length === 0,
    detail: off.length ? off.slice(0, 6).join('; ') : `every marker sits within 1px of its (x, y) on the shared scale (${markers.length} markers, each with data-x/data-y)`,
    hint: off.length ? 'derive every centre from the same linear scale (never snap a data point to the grid) and stamp data-x/data-y on each' : undefined,
  })

  // #3 bubble area ∝ size within 2%, largest drawn first, scale stated (footnote + legend reference)
  const areaProblems = []
  if (bubble) {
    for (const m of markers) {
      const want = m.vsize / scale.sizeMax
      const got = (m.r * m.r) / (scale.rMax * scale.rMax)
      if (!(Math.abs(got - want) <= 0.02 * want)) areaProblems.push(`${m.id} size ${m.vsize} drawn with r=${m.r} (area ratio ${got.toFixed(4)}, expected ${want.toFixed(4)})`)
    }
    const byId = new Map(markers.map((m) => [m.id, m]))
    const rs = (geo.order || []).map((id) => byId.get(id)?.r ?? 0)
    for (let i = 1; i < rs.length; i++) if (rs[i] > rs[i - 1]) { areaProblems.push('bubbles are not drawn largest first'); break }
    if (!(geo.notes || []).some((n) => n.key === 'size')) areaProblems.push('no 「円の面積 = …」 footnote in the geometry')
    if (!(geo.legend?.items || []).some((it) => it.kind === 'size')) areaProblems.push('no reference bubble in the legend')
    if (svg !== undefined) {
      const ns = (svg.match(/\bdata-size="/g) || []).length
      if (ns < markers.length) areaProblems.push(`${ns} data-size markers in the svg, expected ${markers.length}`)
      if (!svg.includes(`id="${uid}-note-size"`)) areaProblems.push('no size footnote drawn')
      if (!svg.includes(`id="${uid}-legend-size"`)) areaProblems.push('no reference bubble drawn')
    }
  }
  rows.push({
    id: 3, name: 'bubble-area-proportional', severity: 'fail', ok: areaProblems.length === 0,
    detail: areaProblems.length ? areaProblems.slice(0, 6).join('; ') : bubble ? `every bubble's area is within 2% of size/${fmt(scale.sizeMax)} × the largest; largest drawn first; scale stated in the footnote and legend` : 'no size axis — uniform markers',
    hint: areaProblems.length ? 'r = R_MAX·√(size/max) — radius ∝ value is the one error a bubble chart may not make; draw the largest first and state the scale' : undefined,
  })

  // #4 labels never overlap each other, another marker, or the plot edge
  const overlaps = []
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].collides) overlaps.push(`${labels[i].point} found no clear slot`)
    if (!inside(labels[i], plot)) overlaps.push(`${labels[i].point} leaves the plot`)
    for (let j = i + 1; j < labels.length; j++) {
      if (intersects(labels[i], labels[j])) overlaps.push(`${labels[i].point}/${labels[j].point}`)
    }
    for (const m of markers) {
      if (m.id !== labels[i].point && intersects(labels[i], markerBox(m))) overlaps.push(`${labels[i].point}→${m.id} marker`)
    }
  }
  rows.push({
    id: 4, name: 'labels-no-overlap', severity: 'fail', ok: overlaps.length === 0,
    detail: overlaps.length ? `overlapping label(s): ${[...new Set(overlaps)].join(', ')}` : labels.length ? `${labels.length} label(s), none overlapping another label or marker` : 'no labelled points',
    hint: overlaps.length ? 'label fewer points in the crowded area, shorten the labels, or let the crowded points go unlabelled' : undefined,
  })

  // #5 series told apart by shape: each declared series has its own shape, every marker carries its series' shape
  const shapeProblems = []
  if (ir.series) {
    const shapeOf = new Map()
    const seen = new Map()
    ir.series.forEach((s, i) => {
      const legendItem = (geo.legend?.items || []).find((it) => it.kind === 'series' && it.id === s.id)
      const shape = legendItem?.shape
      if (!shape) { shapeProblems.push(`series "${s.id}" has no legend entry`); return }
      if (seen.has(shape)) shapeProblems.push(`series "${seen.get(shape)}" and "${s.id}" both use the ${shape}`)
      else seen.set(shape, s.id)
      shapeOf.set(s.id, shape)
    })
    for (const m of markers) {
      if (shapeOf.has(m.series) && m.shape !== shapeOf.get(m.series)) shapeProblems.push(`${m.id} is a ${m.shape} but its series "${m.series}" is the ${shapeOf.get(m.series)}`)
    }
  }
  rows.push({
    id: 5, name: 'series-distinct', severity: 'fail', ok: shapeProblems.length === 0,
    detail: shapeProblems.length ? shapeProblems.slice(0, 6).join('; ') : ir.series ? `${ir.series.length} series, each with its own marker shape (${ir.series.map((s, i) => SHAPES[i]).join(' / ')}) and a legend entry` : 'single series',
    hint: shapeProblems.length ? `at most ${MAX_SERIES} series, one shape each (circle / square / triangle) — never colour` : undefined,
  })

  // #6 an axis that does not start at 0 shows a break and says so
  const breakProblems = []
  for (const axis of ['x', 'y']) {
    if (ir[axis].from === 0) continue
    if (!(geo.axisBreaks || []).some((b) => b.axis === axis)) breakProblems.push(`no ${axis} axis-break marker in the geometry`)
    if (!(geo.notes || []).some((n) => n.key === `${axis}from`)) breakProblems.push(`no ${axis}.from footnote in the geometry`)
    if (svg !== undefined) {
      if (!svg.includes(`id="${uid}-axis-break-${axis}"`)) breakProblems.push(`no ${axis} axis-break marker drawn`)
      if (!svg.includes(`id="${uid}-note-${axis}from"`)) breakProblems.push(`no ${axis}.from footnote drawn`)
    }
  }
  const truncated = ['x', 'y'].filter((a) => ir[a].from !== 0)
  rows.push({
    id: 6, name: 'axis-break-disclosed', severity: 'fail', ok: breakProblems.length === 0,
    detail: breakProblems.length ? breakProblems.join('; ') : truncated.length ? `${truncated.map((a) => `${a} axis starts at ${ir[a].from}`).join(', ')}: break marker and footnote present` : 'both axes start at 0',
    hint: breakProblems.length ? 'a truncated axis must show a break marker on the axis and a footnote naming the start value' : undefined,
  })

  // #7–#10 budgets (warn)
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
  }
  rows.push(budgetRow(7, 'point-count', 'budget:points', `${ir.points.length} point(s)`))
  rows.push(budgetRow(8, 'labelled-count', 'budget:labels', `${ir.points.filter((p) => p.label !== undefined).length} labelled point(s)`))
  rows.push(budgetRow(9, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`))
  rows.push(budgetRow(10, 'emphasis-count', 'budget:emphasis', `${ir.points.filter((p) => p.emphasis).length} emphasized point(s)`))
  return rows
}

// --- doc ---------------------------------------------------------------------------

export const doc = {
  purpose: 'two quantities per item on numeric axes — a distribution or correlation; a third quantity as bubble area; up to three series by marker shape',
  whenToUse: 'when every item has two measured values and their spread or relation is the message (cost × effect, latency × traffic, size × growth); with a third quantity add `size` for bubbles (area ∝ value, the scale is stated). Not for ordered categories (use bar or line) or hand-placed positions (use quadrant). Budgets: points ≤ 30, labelled points ≤ 12, label ≤ 12 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn; series ≤ 3 is a hard limit (circle / square / triangle).',
  irExample: `id: initiatives
type: scatter
title: 施策の工数と効果
caption: 右上が高効果・高工数。円の面積は影響ユーザー数。強調は今期の着手候補
x:
  label: 工数
  unit: 人日
y:
  label: 効果
  unit: pt
size:
  label: 影響ユーザー数
  unit: 人
series:
  - id: platform
    label: 基盤
  - id: feature
    label: 機能
points:
  - id: cache
    label: キャッシュ
    x: 12
    y: 68
    size: 4200
    series: platform
    emphasis: true
  - id: index
    label: 索引再設計
    x: 30
    y: 55
    size: 3600
    series: platform
  - id: batch
    label: バッチ分割
    x: 18
    y: 25
    size: 900
    series: platform
  - id: search
    label: 検索改善
    x: 45
    y: 80
    size: 5200
    series: feature
  - id: export
    label: エクスポート
    x: 8
    y: 30
    size: 700
    series: feature
  - id: mobile
    label: モバイル対応
    x: 60
    y: 62
    size: 2400
    series: feature
  - id: notify
    x: 22
    y: 45
    size: 1500
    series: feature
  - id: audit
    x: 38
    y: 20
    size: 600
    series: platform
`,
  rows: ['points-in-plot', 'points-proportional', 'bubble-area-proportional', 'labels-no-overlap', 'series-distinct', 'axis-break-disclosed', 'point-count', 'labelled-count', 'label-length', 'emphasis-count'],
}
