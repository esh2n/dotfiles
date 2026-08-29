// `type: line` — a quantity over an ordered x axis, in three variants:
//   line        1–4 series as polylines over categories or dates
//   slopegraph  exactly two x values (before / after), one line per item,
//               the item labelled at both ends with its value
//   ridgeline   one row per series, each a small distribution over x drawn
//               as a lightly filled area on its own baseline, shared amplitude
//
// IR shape: `{ id, type:'line', title, caption?, variant?, unit?, yFrom?, x, series }`.
//   variant: line | slopegraph | ridgeline           default line
//   unit:    string appended to values ("ms", "%")   optional
//   yFrom:   number, the y axis start                 default 0; ≠ 0 draws a visible
//                                                     axis break and a footnote
//   x:       { label?, values: [string] }             categories or dates, in order
//   series:  [{ id, label, values: [number|null], emphasis? }]
//            values.length === x.values.length; null = missing (a gap, disclosed
//            in a footnote); ridgeline values must be ≥ 0 and never null
//
// Chart rules encoded here (survey §2 row 21 + the chart rules): the y axis
// starts at 0 unless `yFrom` says otherwise, and then the break is visible
// and written out; no splines (straight segments only); series are told
// apart by stroke pattern (solid / dashed / dotted / dash-dot), never by
// colour; labels sit at the line ends when they fit, else in the shared
// legend strip; `emphasis` is a heavier line + larger dots (≤ 2 per figure);
// every drawn point carries `data-value`.
//
// Grid: axes, ticks, x positions, label anchors and baselines are on the
// 4px grid (`x`/`y` keys — the shared `grid-4px` row reads them). Data
// points are stored as `px`/`py` (0.1px) because a point snapped to 4px
// would no longer be proportional to its value — `points-proportional`
// (row 5) is the rule that governs them instead.
import { IrError, isObj, requireStr, optStr, normalizeHeader, validateBool, budgetWarning, esc, legendWidth, LEGEND_HEIGHT } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, COLUMN, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'line'

export const limits = { maxSeries: 4, maxX: 24, maxItems: 12, maxEmphasis: 2, maxLabelLen: 14 }

const VARIANTS = new Set(['line', 'slopegraph', 'ridgeline'])
const PAD = 16
const LABEL_GAP = 8           // axis/line end → label
const LABEL_STEP = 16         // minimum vertical distance between two direct labels (13px text)
const MAX_END_LABEL_W = 160   // wider end labels fall back to the legend strip
const PLOT_H_TARGET = 240     // line: target plot height, rounded so every tick sits on the grid
const TICK_PX_MIN = 24
const TICK_PX_MAX = 80
const SLOPE_SPAN = 280        // slopegraph: distance between the two axes
const SLOPE_SPAN_MIN = 160
const RIDGE_PITCH = 40        // ridgeline: baseline to baseline
const RIDGE_AMP = 56          // ridgeline: shared amplitude (vmax → this many px)
const DOT_R = 2
const DOT_R_EMPHASIS = 3
const NOTE_STEP = 16
/** Stroke pattern per series position (line variant): solid, dashed,
 * dotted, dash-dot, then one dash-dot-dot spare so a 5-series (over-budget)
 * chart still renders with a warning; a 6th repeats and fails `series-distinct`. */
const DASHES = ['', '6 4', '1.5 3.5', '8 3 1.5 3', '8 3 1.5 3 1.5 3']

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeVariant(raw.variant, ctx)
  const unit = optStr(raw, 'unit', ctx)
  const yFrom = normalizeYFrom(raw.yFrom, variant, ctx)
  const x = normalizeX(raw.x, variant, ctx)
  const series = normalizeSeries(raw.series, x, variant, yFrom, ctx)
  return { id, type, title, caption, variant, unit, yFrom, x, series }
}

function normalizeVariant(v, ctx) {
  if (v === undefined || v === null) return 'line'
  if (typeof v !== 'string' || !VARIANTS.has(v)) throw new IrError(`${ctx}.variant must be line|slopegraph|ridgeline (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeYFrom(v, variant, ctx) {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${ctx}.yFrom must be a finite number (got: ${JSON.stringify(v)})`)
  if (variant === 'ridgeline' && v !== 0) throw new IrError(`${ctx}.yFrom is not allowed for a ridgeline (every ridge sits on its own zero baseline)`)
  return v
}

function normalizeX(raw, variant, ctx) {
  const xctx = `${ctx}.x`
  if (!isObj(raw)) throw new IrError(`${xctx} must be a mapping { label?, values }`)
  const label = optStr(raw, 'label', xctx)
  if (!Array.isArray(raw.values) || raw.values.length === 0) throw new IrError(`${xctx}.values must be a non-empty list of strings`)
  const values = raw.values.map((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') throw new IrError(`${xctx}.values[${i}] must be a non-empty string (got: ${JSON.stringify(v)})`)
    return v
  })
  if (variant === 'slopegraph' && values.length !== 2) {
    throw new IrError(`${xctx}.values must have exactly 2 entries for a slopegraph (before / after) (got: ${values.length})`)
  }
  return { label, values }
}

function normalizeSeries(raw, x, variant, yFrom, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.series must be a non-empty list`)
  const seen = new Set()
  const n = x.values.length
  return raw.map((s, i) => {
    const sctx = `${ctx}.series[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate series id: "${id}"`)
    seen.add(id)
    const label = requireStr(s, 'label', sctx)
    if (!Array.isArray(s.values)) throw new IrError(`${sctx}.values must be a list of numbers (null for a missing value)`)
    if (s.values.length !== n) throw new IrError(`${sctx}.values has ${s.values.length} entries but x.values has ${n} — one value per x, null where missing`)
    const values = s.values.map((v, j) => {
      const vctx = `${sctx}.values[${j}]`
      if (v === null || v === undefined) {
        if (variant === 'ridgeline') throw new IrError(`${vctx} is missing — a ridgeline needs a value at every x (use 0)`)
        return null
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${vctx} must be a finite number or null (got: ${JSON.stringify(v)})`)
      if (variant === 'ridgeline' && v < 0) throw new IrError(`${vctx} must be ≥ 0 in a ridgeline (got: ${v})`)
      if (v < yFrom) throw new IrError(`${vctx} (${v}) lies below yFrom (${yFrom}) — lower yFrom or fix the value`)
      return v
    })
    if (!values.some((v) => v !== null)) throw new IrError(`${sctx}.values has no value at all — drop the series or fill at least one point`)
    return { id, label, values, emphasis: validateBool(s, 'emphasis', sctx) }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const slope = ir.variant === 'slopegraph'
  const count = ir.series.length
  if (slope && count > limits.maxItems) {
    out.push(budgetWarning('budget:items', count, limits.maxItems,
      `${count} slopegraph items (guidance ≤ ${limits.maxItems})`,
      `keep the ${limits.maxItems} items whose change matters and move the rest to a table`))
  } else if (!slope && count > limits.maxSeries) {
    out.push(budgetWarning('budget:series', count, limits.maxSeries,
      `${count} series (guidance ≤ ${limits.maxSeries})`,
      `only ${DASHES.length} stroke patterns stay distinguishable without colour — split into one chart per ${limits.maxSeries} series, or use small multiples`))
  }
  const nx = ir.x.values.length
  if (!slope && nx > limits.maxX) {
    out.push(budgetWarning('budget:x', nx, limits.maxX,
      `${nx} x values (guidance ≤ ${limits.maxX})`,
      `aggregate to ≤ ${limits.maxX} points (weekly instead of daily) or show only the decisive window`))
  }
  const long = []
  ir.series.forEach((s, i) => {
    const len = [...s.label].length
    if (len > limits.maxLabelLen) long.push({ where: `series[${i}].label`, label: s.label, len })
  })
  ir.x.values.forEach((v, i) => {
    const len = [...v].length
    if (len > limits.maxLabelLen) long.push({ where: `x.values[${i}]`, label: v, len })
  })
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, limits.maxLabelLen,
      long.map((e) => `${e.where} "${e.label}" is ${e.len} chars (guidance ≤ ${limits.maxLabelLen})`).join('; '),
      long.map((e) => `shorten ${e.where} ("${e.label}", ${e.len} > ${limits.maxLabelLen})`).join('; ') + ', or move the wording into the caption'))
  }
  const emphasized = ir.series.filter((s) => s.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized series (guidance ≤ ${limits.maxEmphasis})`,
      `emphasis is a signal, not a style — keep it on the ${limits.maxEmphasis} series the caption talks about`))
  }
  return out
}

// --- layout ----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))))
/** `120 ms`, `12%`, `3件` — a one-char unit hugs the number. */
const fmtUnit = (v, unit) => (unit ? `${fmt(v)}${[...unit].length === 1 ? '' : ' '}${unit}` : fmt(v))
const labelW = (text, bold = false) => Math.ceil(textWidth(text, FONT_SIZE) * (bold ? BOLD_FACTOR : 1))
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
  const ymin = lo < from ? Number((Math.floor(lo / step) * step).toPrecision(12)) : from
  const nSteps = Math.max(1, Math.ceil((hi - ymin) / step - 1e-9))
  const ymax = Number((ymin + nSteps * step).toPrecision(12))
  const ticks = Array.from({ length: nSteps + 1 }, (_, k) => Number((ymin + k * step).toPrecision(12)))
  return { ymin, ymax, step, nSteps, ticks }
}

const allValues = (ir) => ir.series.flatMap((s) => s.values.filter((v) => v !== null))

/** x positions for n points across [left, right]: equal 4px-multiple steps
 * from `left` (the right edge is where the last point lands). */
function xPositions(n, left, right) {
  if (n === 1) return [snap4((left + right) / 2)]
  const step = Math.max(4, Math.floor((right - left) / (n - 1) / 4) * 4)
  return Array.from({ length: n }, (_, i) => left + i * step)
}

/** Every k-th x label so that the widest one never touches its neighbour. */
function xLabelSkip(n, step, widest) {
  if (n <= 1 || step <= 0) return 1
  let skip = 1
  while (skip < n && widest + LABEL_GAP > skip * step) skip++
  return skip
}

/** Direct labels stacked apart on the 4px grid: sorted by their wanted y
 * and pushed down to keep LABEL_STEP between baselines; each touching
 * cluster is then moved back up by its mean drift (bounded by the cluster
 * above and by `top`) so a cluster straddles its points instead of
 * hanging below them; finally the whole stack shifts up as a block when it
 * overruns `bottom`. */
function decollide(items, top, bottom) {
  const sorted = [...items].sort((a, b) => a.want - b.want || a.order - b.order)
  let prev = -Infinity
  for (const it of sorted) {
    it.y = Math.max(snap4(it.want), prev + LABEL_STEP)
    prev = it.y
  }
  let i = 0
  let prevEnd = top - LABEL_STEP
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].y === sorted[j].y + LABEL_STEP) j++
    const cluster = sorted.slice(i, j + 1)
    const drift = cluster.reduce((a, it) => a + (it.y - snap4(it.want)), 0) / cluster.length
    const shift = Math.min(snap4(drift), cluster[0].y - (prevEnd + LABEL_STEP))
    if (shift > 0) for (const it of cluster) it.y -= shift
    prevEnd = cluster[cluster.length - 1].y
    i = j + 1
  }
  if (sorted.length) {
    const last = sorted[sorted.length - 1].y
    if (last > bottom) {
      const shift = Math.min(snapUp4(last - bottom), Math.max(0, sorted[0].y - top))
      for (const it of sorted) it.y -= shift
    }
  }
  return sorted
}

const labelBox = (x, y, width, anchor) => {
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
  return { left, top: y - 13, right: left + width, bottom: y + 3 }
}

/** Footnotes drawn under the plot: the axis break and the missing values. */
function buildNotes(ir) {
  const notes = []
  if (ir.variant !== 'ridgeline' && ir.yFrom !== 0) {
    notes.push({ key: 'yfrom', text: `y 軸は ${fmtUnit(ir.yFrom, ir.unit)} から始まる（0 起点ではない）` })
  }
  const missing = ir.series
    .map((s) => ({ label: s.label, xs: ir.x.values.filter((_, j) => s.values[j] === null) }))
    .filter((m) => m.xs.length)
  if (missing.length) {
    notes.push({ key: 'missing', text: `欠損: ${missing.map((m) => `${m.label}（${m.xs.join('、')}）`).join('；')}` })
  }
  return notes
}

function placeNotes(notes, x, y) {
  return notes.map((n, i) => ({ ...n, x, y: y + i * NOTE_STEP }))
}

/** Polyline segments of one series: consecutive non-null runs (a null is a gap). */
function segmentsOf(points) {
  const segments = []
  let run = []
  for (const p of points) {
    if (p.value === null) { if (run.length) segments.push(run); run = [] } else run.push(p)
  }
  if (run.length) segments.push(run)
  return segments
}

function layoutLine(ir, column) {
  const n = ir.x.values.length
  const vals = allValues(ir)
  const scale = niceScale(Math.min(...vals), Math.max(...vals), ir.yFrom)
  const tickPx = clamp(snap4(PLOT_H_TARGET / scale.nSteps), TICK_PX_MIN, TICK_PX_MAX)
  const plotH = scale.nSteps * tickPx
  const tickLabels = scale.ticks.map((t, k) => (k === scale.ticks.length - 1 ? fmtUnit(t, ir.unit) : fmt(t)))
  const tickW = Math.max(...tickLabels.map(smallW))
  const xLabelWidest = Math.max(...ir.x.values.map(smallW))
  const plotLeft = Math.max(snapUp4(PAD + tickW + LABEL_GAP), snapUp4(PAD + xLabelWidest / 2))

  const endLabelW = Math.max(...ir.series.map((s) => labelW(s.label, s.emphasis)))
  const labelMode = endLabelW + LABEL_GAP <= MAX_END_LABEL_W ? 'direct' : 'legend'
  const right = Math.max(
    snapUp4(PAD + xLabelWidest / 2),
    labelMode === 'direct' ? snapUp4(endLabelW + LABEL_GAP + PAD) : 0,
  )
  const width = column
  const plotRight = width - right
  const xs = xPositions(n, plotLeft, plotRight)
  const top = 24
  const baseline = top + plotH
  const yOf = (v) => round1(baseline - ((v - scale.ymin) / (scale.ymax - scale.ymin)) * plotH)

  const ticks = scale.ticks.map((t, k) => ({ value: t, label: tickLabels[k], y: baseline - k * tickPx, zero: t === 0 && scale.ymin < 0 }))
  const skip = xLabelSkip(n, xs.length > 1 ? xs[1] - xs[0] : 0, xLabelWidest)
  const xAxisY = baseline + 20
  const xLabels = ir.x.values.map((text, i) => ({ text, x: xs[i], y: xAxisY, shown: i % skip === 0 }))

  const series = ir.series.map((s, i) => {
    const points = s.values.map((v, j) => ({ x: xs[j], value: v, px: xs[j], py: v === null ? null : yOf(v) }))
    return { id: s.id, label: s.label, dash: DASHES[i % DASHES.length], emphasis: s.emphasis, points, segments: segmentsOf(points).map((seg) => seg.map((p) => ({ px: p.px, py: p.py }))) }
  })

  const labels = []
  if (labelMode === 'direct') {
    const wanted = series.map((s, i) => {
      const last = [...s.points].reverse().find((p) => p.value !== null)
      return { series: s.id, text: s.label, bold: s.emphasis, want: last.py + 4, order: i, x: last.px + LABEL_GAP }
    })
    for (const it of decollide(wanted, top + 8, baseline + 8)) {
      const w = labelW(it.text, it.bold)
      labels.push({ series: it.series, side: 'end', text: it.text, bold: it.bold, x: it.x, y: it.y, anchor: 'start', box: labelBox(it.x, it.y, w, 'start') })
    }
  }

  let cursor = xAxisY + 8
  const xTitle = ir.x.label ? { text: ir.x.label, x: snap4((plotLeft + plotRight) / 2), y: cursor + 12 } : undefined
  if (xTitle) cursor += 16
  const notes = placeNotes(buildNotes(ir), PAD, cursor + 12)
  cursor += notes.length * NOTE_STEP
  const legendItems = labelMode === 'legend'
    ? series.map((s) => ({ label: s.label, ...(s.dash ? { dash: s.dash } : {}) }))
    : []
  let legend
  let height
  if (labelMode === 'legend') {
    const legendY = snapUp4(cursor + 8)
    legend = { y: legendY, items: legendItems }
    height = legendY + LEGEND_HEIGHT + PAD
  } else {
    height = snapUp4(cursor + PAD)
  }
  const axisBreak = ir.yFrom !== 0 ? [{ x: plotLeft, y: baseline - 12 }] : []
  return {
    width: Math.max(width, snapUp4(legendWidth(legendItems))),
    height,
    geo: { variant: 'line', scale: { ...scale, baseline, plotH }, plot: { left: plotLeft, right: plotRight, top, baseline }, ticks, xLabels, xTitle, series, labels, labelMode, axisBreak, notes },
    ...(legend ? { legend } : {}),
  }
}

function layoutSlopegraph(ir, column) {
  const vals = allValues(ir)
  const scale = niceScale(Math.min(...vals), Math.max(...vals), ir.yFrom)
  const plotH = clamp(snapUp4(ir.series.length * 28), 200, 360)
  const top = 48
  const baseline = top + plotH
  const yOf = (v) => round1(baseline - ((v - scale.ymin) / (scale.ymax - scale.ymin)) * plotH)
  const sideText = (s, side) => {
    const v = s.values[side]
    if (v === null) return s.label
    return side === 0 ? `${s.label} ${fmtUnit(v, ir.unit)}` : `${fmtUnit(v, ir.unit)} ${s.label}`
  }
  const leftW = Math.max(...ir.series.map((s) => labelW(sideText(s, 0), s.emphasis)))
  const rightW = Math.max(...ir.series.map((s) => labelW(sideText(s, 1), s.emphasis)))
  const headW = ir.x.values.map(labelW)
  const xL = Math.max(snapUp4(PAD + leftW + LABEL_GAP), snapUp4(PAD + headW[0] / 2))
  let span = SLOPE_SPAN
  while (span > SLOPE_SPAN_MIN && xL + span + LABEL_GAP + rightW + PAD > column) span -= 8
  const xR = xL + span
  const width = Math.max(snapUp4(xR + LABEL_GAP + rightW + PAD), snapUp4(xR + headW[1] / 2 + PAD))

  const axes = [
    { x: xL, header: { text: ir.x.values[0], x: xL, y: 24 } },
    { x: xR, header: { text: ir.x.values[1], x: xR, y: 24 } },
  ]
  const ticks = [
    { value: scale.ymin, label: fmtUnit(scale.ymin, ir.unit), y: baseline, edge: 'bottom' },
    { value: scale.ymax, label: fmtUnit(scale.ymax, ir.unit), y: top, edge: 'top' },
  ]
  const series = ir.series.map((s, i) => {
    const points = s.values.map((v, j) => ({ x: axes[j].x, value: v, px: axes[j].x, py: v === null ? null : yOf(v) }))
    return { id: s.id, label: s.label, dash: '', emphasis: s.emphasis, points, segments: segmentsOf(points).map((seg) => seg.map((p) => ({ px: p.px, py: p.py }))) }
  })
  const labels = []
  for (const side of [0, 1]) {
    const wanted = []
    series.forEach((s, i) => {
      const p = s.points[side]
      if (p.value === null) return
      wanted.push({ series: s.id, text: sideText(ir.series[i], side), bold: s.emphasis, want: p.py + 4, order: i })
    })
    const anchor = side === 0 ? 'end' : 'start'
    const x = side === 0 ? xL - LABEL_GAP : xR + LABEL_GAP
    for (const it of decollide(wanted, top + 8, baseline + 8)) {
      labels.push({ series: it.series, side: side === 0 ? 'start' : 'end', text: it.text, bold: it.bold, x, y: it.y, anchor, box: labelBox(x, it.y, labelW(it.text, it.bold), anchor) })
    }
  }
  const notes = placeNotes(buildNotes(ir), PAD, baseline + 20 + 20)
  const height = snapUp4(baseline + 20 + (notes.length ? 8 + notes.length * NOTE_STEP : 0) + PAD)
  const axisBreak = ir.yFrom !== 0 ? axes.map((a) => ({ x: a.x, y: baseline - 12 })) : []
  return {
    width,
    height,
    geo: { variant: 'slopegraph', scale: { ...scale, baseline, plotH }, plot: { left: xL, right: xR, top, baseline }, axes, ticks, series, labels, labelMode: 'direct', axisBreak, notes },
  }
}

function layoutRidgeline(ir, column) {
  const n = ir.x.values.length
  const vmax = Math.max(1e-9, ...allValues(ir))
  const rowLabelW = Math.max(...ir.series.map((s) => labelW(s.label, s.emphasis)))
  const xLabelWidest = Math.max(...ir.x.values.map(smallW))
  const plotLeft = Math.max(snapUp4(PAD + rowLabelW + LABEL_GAP), snapUp4(PAD + xLabelWidest / 2))
  const width = column
  const plotRight = width - snapUp4(PAD + xLabelWidest / 2)
  const xs = xPositions(n, plotLeft, plotRight)
  const top = RIDGE_AMP + 16
  const rows = ir.series.map((s, i) => ({ id: s.id, baseline: top + i * RIDGE_PITCH }))
  const series = ir.series.map((s, i) => {
    const base = rows[i].baseline
    const points = s.values.map((v, j) => ({ x: xs[j], value: v, px: xs[j], py: round1(base - (v / vmax) * RIDGE_AMP) }))
    return { id: s.id, label: s.label, dash: '', emphasis: s.emphasis, baseline: base, points, segments: [points.map((p) => ({ px: p.px, py: p.py }))] }
  })
  const labels = series.map((s) => {
    const y = s.baseline
    const w = labelW(s.label, s.emphasis)
    return { series: s.id, side: 'row', text: s.label, bold: s.emphasis, x: plotLeft - LABEL_GAP, y, anchor: 'end', box: labelBox(plotLeft - LABEL_GAP, y, w, 'end') }
  })
  const lastBaseline = rows[rows.length - 1].baseline
  const skip = xLabelSkip(n, xs.length > 1 ? xs[1] - xs[0] : 0, xLabelWidest)
  const xAxisY = lastBaseline + 20
  const xLabels = ir.x.values.map((text, i) => ({ text, x: xs[i], y: xAxisY, shown: i % skip === 0 }))
  let cursor = xAxisY + 8
  const xTitle = ir.x.label ? { text: ir.x.label, x: snap4((plotLeft + plotRight) / 2), y: cursor + 12 } : undefined
  if (xTitle) cursor += 16
  const notes = placeNotes(buildNotes(ir), PAD, cursor + 12)
  cursor += notes.length * NOTE_STEP
  const scaleHint = { text: `max ${fmtUnit(vmax, ir.unit)}`, x: plotRight, y: 12 }
  return {
    width,
    height: snapUp4(cursor + PAD),
    geo: { variant: 'ridgeline', scale: { vmax, amp: RIDGE_AMP, pitch: RIDGE_PITCH }, plot: { left: plotLeft, right: plotRight, top, baseline: lastBaseline }, rows, xLabels, xTitle, series, labels, labelMode: 'direct', scaleHint, axisBreak: [], notes },
  }
}

export async function layout(ir, { column = COLUMN } = {}) {
  if (ir.variant === 'slopegraph') return layoutSlopegraph(ir, column)
  if (ir.variant === 'ridgeline') return layoutRidgeline(ir, column)
  return layoutLine(ir, column)
}

// --- draw ------------------------------------------------------------------

const pathOf = (seg) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px} ${p.py}`).join(' ')

function drawSeriesLines(uid, series) {
  const parts = []
  // emphasized series last so they sit on top
  const ordered = [...series.filter((s) => !s.emphasis), ...series.filter((s) => s.emphasis)]
  for (const s of ordered) {
    const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : ''
    const sw = s.emphasis ? 1.5 : 1
    const d = s.segments.map(pathOf).join(' ')
    parts.push(`<path id="${uid}-series-${s.id}" d="${d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`)
    parts.push(`<g id="${uid}-series-${s.id}-points" fill="currentColor">`)
    s.points.forEach((p, j) => {
      if (p.value === null) return
      parts.push(`<circle id="${uid}-series-${s.id}-pt-${j}" cx="${p.px}" cy="${p.py}" r="${s.emphasis ? DOT_R_EMPHASIS : DOT_R}" data-value="${esc(fmt(p.value))}"/>`)
    })
    parts.push('</g>')
  }
  return parts
}

function drawLabels(uid, labels) {
  if (!labels.length) return []
  const parts = [`<g id="${uid}-labels" font-size="${FONT_SIZE}" fill="currentColor">`]
  for (const l of labels) {
    const bold = l.bold ? ' font-weight="600"' : ''
    parts.push(`<text id="${uid}-label-${l.series}-${l.side}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}"${bold}>${esc(l.text)}</text>`)
  }
  parts.push('</g>')
  return parts
}

/** A "//" break on a vertical axis at (x, y): a surface-coloured gap, then two slashes. */
function drawAxisBreak(uid, b, i) {
  return `<g id="${uid}-axis-break${i > 0 ? `-${i}` : ''}">` +
    `<rect x="${b.x - 2}" y="${b.y - 4}" width="4" height="8" fill="var(--wu-surface)" stroke="none"/>` +
    `<path d="M${b.x - 4} ${b.y + 1} L${b.x + 4} ${b.y - 5} M${b.x - 4} ${b.y + 5} L${b.x + 4} ${b.y - 1}" fill="none" stroke="currentColor" stroke-width="1"/>` +
    '</g>'
}

function drawNotes(uid, notes) {
  if (!notes.length) return []
  const parts = [`<g id="${uid}-notes" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">`]
  for (const n of notes) parts.push(`<text id="${uid}-note-${n.key}" x="${n.x}" y="${n.y}">${esc(n.text)}</text>`)
  parts.push('</g>')
  return parts
}

function drawXLabels(uid, geo) {
  const parts = [`<g id="${uid}-x-labels" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)" text-anchor="middle">`]
  geo.xLabels.forEach((l, i) => {
    if (!l.shown) return
    parts.push(`<text id="${uid}-x-${i}" x="${l.x}" y="${l.y}">${esc(l.text)}</text>`)
  })
  if (geo.xTitle) parts.push(`<text id="${uid}-x-title" x="${geo.xTitle.x}" y="${geo.xTitle.y}">${esc(geo.xTitle.text)}</text>`)
  parts.push('</g>')
  return parts
}

function drawLineVariant(uid, geo) {
  const { plot, ticks } = geo
  const parts = []
  parts.push(`<g id="${uid}-grid" stroke-width="1">`)
  for (const t of ticks) {
    const strong = t.y === plot.baseline || t.zero
    parts.push(`<line x1="${plot.left}" y1="${t.y}" x2="${plot.right}" y2="${t.y}" stroke="${strong ? 'var(--wu-rule)' : 'var(--wu-rule-soft)'}"/>`)
  }
  parts.push(`<line id="${uid}-y-axis" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.baseline}" stroke="var(--wu-rule)"/>`)
  parts.push('</g>')
  parts.push(`<g id="${uid}-y-labels" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)" text-anchor="end">`)
  ticks.forEach((t, k) => parts.push(`<text id="${uid}-y-${k}" x="${plot.left - LABEL_GAP}" y="${t.y + 4}">${esc(t.label)}</text>`))
  parts.push('</g>')
  parts.push(...drawXLabels(uid, geo))
  parts.push(...drawSeriesLines(uid, geo.series))
  geo.axisBreak.forEach((b, i) => parts.push(drawAxisBreak(uid, b, i)))
  parts.push(...drawLabels(uid, geo.labels))
  parts.push(...drawNotes(uid, geo.notes))
  return parts
}

function drawSlopegraph(uid, geo) {
  const { plot, axes, ticks } = geo
  const parts = []
  parts.push(`<g id="${uid}-grid" stroke-width="1">`)
  parts.push(`<line x1="${plot.left}" y1="${plot.top}" x2="${plot.right}" y2="${plot.top}" stroke="var(--wu-rule-soft)"/>`)
  parts.push(`<line x1="${plot.left}" y1="${plot.baseline}" x2="${plot.right}" y2="${plot.baseline}" stroke="var(--wu-rule)"/>`)
  axes.forEach((a, i) => parts.push(`<line id="${uid}-axis-${i}" x1="${a.x}" y1="${plot.top}" x2="${a.x}" y2="${plot.baseline}" stroke="var(--wu-rule)"/>`))
  parts.push('</g>')
  parts.push(`<g id="${uid}-headers" font-size="${FONT_SIZE}" fill="var(--wu-ink-2)" text-anchor="middle">`)
  axes.forEach((a, i) => parts.push(`<text id="${uid}-header-${i}" x="${a.header.x}" y="${a.header.y}">${esc(a.header.text)}</text>`))
  parts.push('</g>')
  parts.push(`<g id="${uid}-y-labels" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">`)
  for (const t of ticks) {
    const y = t.edge === 'bottom' ? t.y + 14 : t.y - 4
    parts.push(`<text id="${uid}-y-${t.edge}" x="${plot.left + 4}" y="${y}">${esc(t.label)}</text>`)
  }
  parts.push('</g>')
  parts.push(...drawSeriesLines(uid, geo.series))
  geo.axisBreak.forEach((b, i) => parts.push(drawAxisBreak(uid, b, i)))
  parts.push(...drawLabels(uid, geo.labels))
  parts.push(...drawNotes(uid, geo.notes))
  return parts
}

function drawRidgeline(uid, geo) {
  const { plot, rows, scaleHint } = geo
  const parts = []
  parts.push(`<g id="${uid}-grid" stroke="var(--wu-rule-soft)" stroke-width="1">`)
  for (const r of rows) parts.push(`<line x1="${plot.left}" y1="${r.baseline}" x2="${plot.right}" y2="${r.baseline}"/>`)
  parts.push('</g>')
  parts.push(`<text id="${uid}-scale" x="${scaleHint.x}" y="${scaleHint.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)" text-anchor="end">${esc(scaleHint.text)}</text>`)
  parts.push(...drawXLabels(uid, geo))
  // top row first: each lower ridge occludes the one above it
  for (const s of geo.series) {
    const pts = s.points
    const area = `M${pts[0].px} ${s.baseline} ` + pts.map((p) => `L${p.px} ${p.py}`).join(' ') + ` L${pts[pts.length - 1].px} ${s.baseline} Z`
    parts.push(`<path id="${uid}-ridge-${s.id}-mask" d="${area}" fill="var(--wu-surface)" stroke="none"/>`)
    parts.push(`<path id="${uid}-ridge-${s.id}" d="${area}" fill="currentColor" fill-opacity="${s.emphasis ? 0.12 : 0.06}" stroke="none"/>`)
    parts.push(`<path id="${uid}-series-${s.id}" d="${pathOf(s.segments[0])}" fill="none" stroke="currentColor" stroke-width="${s.emphasis ? 1.5 : 1}" stroke-linejoin="round" stroke-linecap="round"/>`)
    parts.push(`<g id="${uid}-series-${s.id}-points" fill="currentColor">`)
    pts.forEach((p, j) => parts.push(`<circle id="${uid}-series-${s.id}-pt-${j}" cx="${p.px}" cy="${p.py}" r="1.5" data-value="${esc(fmt(p.value))}"/>`))
    parts.push('</g>')
  }
  parts.push(...drawLabels(uid, geo.labels))
  parts.push(...drawNotes(uid, geo.notes))
  return parts
}

export function draw(layoutResult, ir) {
  const geo = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const parts = geo.variant === 'slopegraph' ? drawSlopegraph(uid, geo)
    : geo.variant === 'ridgeline' ? drawRidgeline(uid, geo)
      : drawLineVariant(uid, geo)
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

export function verify(layoutResult, ir, { svg } = {}) {
  const geo = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const rows = []
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, keys, okDetail) => {
    const w = budget.find((b) => keys.includes(b.key))
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  warnRow(1, 'series-count', ['budget:series', 'budget:items'], `${ir.series.length} ${ir.variant === 'slopegraph' ? 'items' : 'series'}`)
  warnRow(2, 'x-count', ['budget:x'], `${ir.x.values.length} x values`)
  warnRow(3, 'label-length', ['budget:label'], `every label ≤ ${limits.maxLabelLen} chars`)
  warnRow(4, 'emphasis-count', ['budget:emphasis'], `${ir.series.filter((s) => s.emphasis).length} emphasized series (≤ ${limits.maxEmphasis})`)

  // #5 every drawn point is proportional to its value (within 1px) and carries data-value
  const expectedY = (s, p) => {
    if (geo.variant === 'ridgeline') return s.baseline - (p.value / geo.scale.vmax) * geo.scale.amp
    return geo.scale.baseline - ((p.value - geo.scale.ymin) / (geo.scale.ymax - geo.scale.ymin)) * geo.scale.plotH
  }
  const off = []
  let drawn = 0
  for (const s of geo.series) {
    s.points.forEach((p, j) => {
      if (p.value === null) return
      drawn++
      const want = expectedY(s, p)
      if (!(typeof p.py === 'number' && Math.abs(p.py - want) <= 1)) off.push(`${s.id}[${j}] value ${p.value} drawn at y=${p.py} (expected ${round1(want)})`)
    })
  }
  const inSvg = svg === undefined ? drawn : (svg.match(/\bdata-value="/g) || []).length
  if (inSvg !== drawn) off.push(`${inSvg} data-value points in the svg, expected ${drawn}`)
  rows.push({
    id: 5, name: 'points-proportional', severity: 'fail', ok: off.length === 0,
    detail: off.length ? off.slice(0, 6).join('; ') : `every point sits within 1px of its value on the shared scale (${drawn} points, each with data-value)`,
    hint: off.length ? 'derive every point from the same y scale (never snap a data point to the grid) and stamp data-value on each' : undefined,
  })

  // #6 direct labels never overlap each other or leave the canvas
  const clashes = []
  const labels = geo.labels || []
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (overlaps(labels[i].box, labels[j].box)) clashes.push(`"${labels[i].text}" overlaps "${labels[j].text}"`)
    }
    if (labels[i].box.left < 0 || labels[i].box.right > layoutResult.width) clashes.push(`"${labels[i].text}" leaves the canvas`)
  }
  rows.push({
    id: 6, name: 'end-labels-clear', severity: 'fail', ok: clashes.length === 0,
    detail: clashes.length ? clashes.slice(0, 6).join('; ') : labels.length ? `${labels.length} direct labels clear of each other` : 'no direct labels (legend strip in use)',
    hint: clashes.length ? 'shorten the labels or reduce the series count; the layout stacks labels 16px apart on the grid' : undefined,
  })

  // #7 series distinguishable without colour
  const distinct = []
  if (geo.variant === 'line') {
    const seen = new Map()
    for (const s of geo.series) {
      const key = s.dash || 'solid'
      if (seen.has(key)) distinct.push(`"${seen.get(key)}" and "${s.id}" both use ${key === 'solid' ? 'a solid stroke' : `dash "${key}"`}`)
      else seen.set(key, s.id)
    }
  } else {
    const needed = geo.variant === 'slopegraph' ? ['start', 'end'] : ['row']
    const texts = new Map()
    for (const s of geo.series) {
      for (const side of needed) {
        const has = labels.some((l) => l.series === s.id && l.side === side)
        const p = geo.variant === 'slopegraph' ? s.points[side === 'start' ? 0 : 1] : null
        if (!has && !(p && p.value === null)) distinct.push(`"${s.id}" has no ${side} label`)
      }
      if (texts.has(s.label)) distinct.push(`"${texts.get(s.label)}" and "${s.id}" share the label "${s.label}"`)
      else texts.set(s.label, s.id)
    }
  }
  rows.push({
    id: 7, name: 'series-distinct', severity: 'fail', ok: distinct.length === 0,
    detail: distinct.length ? distinct.join('; ') : geo.variant === 'line' ? 'every series has its own stroke pattern (solid / dashed / dotted / dash-dot)' : 'every series is named by its own direct label',
    hint: distinct.length ? (geo.variant === 'line' ? `at most ${DASHES.length} series per chart (guidance ≤ ${limits.maxSeries}) so each keeps a distinct stroke pattern` : 'give every series a unique label; a slopegraph item is named at both ends') : undefined,
  })

  // #8 a y axis that does not start at 0 shows a break and says so
  const breakProblems = []
  if (ir.variant !== 'ridgeline' && ir.yFrom !== 0) {
    if (!geo.axisBreak?.length) breakProblems.push('no axis-break marker in the geometry')
    if (!(geo.notes || []).some((n) => n.key === 'yfrom')) breakProblems.push('no yFrom footnote in the geometry')
    if (svg !== undefined) {
      if (!svg.includes(`id="${uid}-axis-break"`)) breakProblems.push('no axis-break marker drawn')
      if (!svg.includes(`id="${uid}-note-yfrom"`)) breakProblems.push('no yFrom footnote drawn')
    }
  }
  rows.push({
    id: 8, name: 'axis-break-disclosed', severity: 'fail', ok: breakProblems.length === 0,
    detail: breakProblems.length ? breakProblems.join('; ') : ir.yFrom === 0 || ir.variant === 'ridgeline' ? 'the y axis starts at 0' : `y axis starts at ${ir.yFrom}: break marker and footnote present`,
    hint: breakProblems.length ? 'a truncated axis must show a break marker on the axis and a footnote naming the start value' : undefined,
  })

  // #9 missing values are drawn as gaps and written out
  const missProblems = []
  const missing = ir.series.filter((s) => s.values.some((v) => v === null))
  if (missing.length) {
    if (!(geo.notes || []).some((n) => n.key === 'missing')) missProblems.push('no missing-values footnote in the geometry')
    if (svg !== undefined) {
      const m = new RegExp(`<text id="${uid}-note-missing"[^>]*>([^<]*)</text>`).exec(svg)
      if (!m) missProblems.push('no missing-values footnote drawn')
      else for (const s of missing) if (!m[1].includes(esc(s.label))) missProblems.push(`footnote does not name "${s.label}"`)
    }
    for (const s of geo.series) {
      const irS = ir.series.find((x) => x.id === s.id)
      if (!irS) continue
      const runs = segmentsOf(irS.values.map((v) => ({ value: v }))).length
      if ((s.segments || []).length !== runs) missProblems.push(`"${s.id}" is drawn as ${s.segments?.length ?? 0} segments, expected ${runs} (a null must break the line)`)
    }
  }
  rows.push({
    id: 9, name: 'missing-disclosed', severity: 'fail', ok: missProblems.length === 0,
    detail: missProblems.length ? missProblems.join('; ') : missing.length ? `${missing.length} series with gaps: drawn as breaks and listed in the footnote` : 'no missing values',
    hint: missProblems.length ? 'never interpolate across a null — break the line there and list the gap in the footnote' : undefined,
  })
  return rows
}

// --- doc -------------------------------------------------------------------

export const doc = {
  purpose: 'a quantity over an ordered axis: a trend (line), a before/after shift per item (slopegraph), or one small distribution per row (ridgeline)',
  whenToUse: 'when the direction and speed of change is the point — a trend over 4–24 dates or categories, exactly two states compared item by item (slopegraph), or a few distributions compared row by row (ridgeline). For a single snapshot comparison use a bar or a table. Budgets: series ≤ 4 (slopegraph items ≤ 12), x values ≤ 24, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: p95-migration
type: line
variant: slopegraph
title: 移行前後の p95 レイテンシ
caption: 6 エンドポイントの p95（ms）。強調は今回の移行対象
unit: ms
x:
  values: [移行前, 移行後]
series:
  - id: search
    label: 検索
    emphasis: true
    values: [420, 180]
  - id: list
    label: 一覧
    values: [260, 210]
  - id: detail
    label: 詳細
    values: [150, 140]
  - id: export
    label: エクスポート
    values: [900, 640]
  - id: login
    label: ログイン
    values: [120, 125]
  - id: upload
    label: アップロード
    values: [700, 320]
`,
  rows: ['series-count', 'x-count', 'label-length', 'emphasis-count', 'points-proportional', 'end-labels-clear', 'series-distinct', 'axis-break-disclosed', 'missing-disclosed'],
}
