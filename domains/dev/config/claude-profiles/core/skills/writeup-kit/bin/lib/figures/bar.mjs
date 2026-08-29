// `type: bar` — categories compared by quantity: one bar per category
// (`single`), 2–3 bars side by side (`grouped`), segments stacked into one
// bar (`stacked`), or the survey's dumbbell — before/after per category as
// two markers joined by a line whose length *is* the difference (`dumbbell`).
//
// IR shape: `{ id, type:'bar', title, caption?, variant, orientation?, unit?,
//              allowNegative?, categories, series, emphasis? }`.
//   variant:      single | grouped | stacked | dumbbell        default single
//   orientation:  horizontal | vertical                          default horizontal (labels read better)
//   unit:         string appended to the last axis tick ("ms", "件")
//   categories:   [{ id, label }]                                 1..n (guidance ≤ 10)
//   series:       [{ id, label, values: { <categoryId>: number | null } }]
//                 exactly 1 for single, exactly 2 for dumbbell (before, after), guidance ≤ 3 otherwise
//   emphasis:     [categoryId]                                     bold label + accent stroke, guidance ≤ 2
//
// Chart rules encoded here (the survey's type-bar contract): the value axis
// always starts at 0 and is never truncated — a negative value is a schema
// error unless `allowNegative: true`, in which case the axis extends below 0
// rather than moving it; a missing value (`null` or an absent key) is drawn
// as a muted "—" in the bar's place AND listed in a footnote line
// 「欠損: …」 so the reader never mistakes it for 0; every bar and marker
// carries `data-value` so verify() can read the number back off the svg and
// compare it with the drawn geometry (within 1px). Series are told apart by
// fill lightness (currentColor at 85 / 50 / 22 %) plus a legend strip, never
// by hue, so the three themes stay in sync.
//
// Grid: the plot origin, row/slot positions, label anchors, legend and
// footnote sit on the 4px grid (shared row `grid-4px`). Bar ends, ticks and
// dumbbell markers are proportional to their value and cannot be snapped
// without lying about the number, so they live under non-position keys
// (`left/top/w/h/len`, `px/py`, `pos`) — the plugin's own rows check them.
import { IrError, isObj, requireStr, optStr, normalizeHeader, validateBool, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'bar'

export const limits = { maxCategories: 10, maxSeries: 3, maxLabelLen: 14, maxEmphasis: 2 }

const VARIANTS = ['single', 'grouped', 'stacked', 'dumbbell']
const ORIENTATIONS = ['horizontal', 'vertical']
/** Fill lightness per series position: 85 / 50 / 22 % of currentColor, plus
 * one 10 % spare so a 4-series (over-budget) chart still renders with a warning. */
const FILL_OPACITY = [0.85, 0.5, 0.22, 0.1]
const PAD = 16
const BAR_THICK = 20          // single / stacked bar
const GROUP_THICK = 14        // one bar of a horizontal group
const GROUP_GAP = 2
const ROW_H = 32              // single / stacked / dumbbell row
const PLOT_H = 200            // vertical plot height
const MARKER_R = 5
const LABEL_GAP = 6           // bar end → value label
const MARKER_LABEL_GAP = 10   // marker centre → value label
const TICK_LABEL_DROP = 16
const LEGEND_SWATCH = 12
const LEGEND_ITEM_GAP = 22
const FOOTNOTE_H = 16
const NA = '—'
const NA_PREFIX = '欠損: '

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeEnum(raw.variant, 'variant', VARIANTS, 'single', ctx)
  const orientation = normalizeEnum(raw.orientation, 'orientation', ORIENTATIONS, 'horizontal', ctx)
  const unit = optStr(raw, 'unit', ctx)
  const allowNegative = validateBool(raw, 'allowNegative', ctx)
  if (allowNegative && variant === 'stacked') throw new IrError(`${ctx}.allowNegative cannot be combined with variant: stacked (segments below 0 have no single axis) — use grouped`)
  const categories = normalizeCategories(raw.categories, ctx)
  const series = normalizeSeries(raw.series, categories, { variant, allowNegative }, ctx)
  const emphasis = normalizeEmphasis(raw.emphasis, categories, ctx)
  return { id, type, title, caption, variant, orientation, unit, allowNegative, categories, series, emphasis }
}

function normalizeEnum(v, field, allowed, fallback, ctx) {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'string' || !allowed.includes(v)) throw new IrError(`${ctx}.${field} must be ${allowed.join('|')} (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeCategories(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.categories must be a non-empty list`)
  const seen = new Set()
  return raw.map((c, i) => {
    const cctx = `${ctx}.categories[${i}]`
    if (!isObj(c)) throw new IrError(`${cctx} must be a mapping`)
    const id = requireStr(c, 'id', cctx)
    if (seen.has(id)) throw new IrError(`duplicate category id: "${id}"`)
    seen.add(id)
    return { id, label: requireStr(c, 'label', cctx) }
  })
}

function normalizeSeries(raw, categories, { variant, allowNegative }, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.series must be a non-empty list`)
  if (variant === 'single' && raw.length !== 1) throw new IrError(`${ctx}.series must hold exactly 1 series for variant: single (got: ${raw.length}) — use grouped or stacked for more`)
  if (variant === 'dumbbell' && raw.length !== 2) throw new IrError(`${ctx}.series must hold exactly 2 series (before, after) for variant: dumbbell (got: ${raw.length})`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.series[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate series id: "${id}"`)
    seen.add(id)
    const label = requireStr(s, 'label', sctx)
    if (!isObj(s.values)) throw new IrError(`${sctx}.values must be a mapping of category id → number|null`)
    for (const key of Object.keys(s.values)) {
      if (!categories.some((c) => c.id === key)) throw new IrError(`${sctx}.values references unknown category "${key}"`)
    }
    const values = {}
    for (const c of categories) {
      const v = s.values[c.id]
      if (v === undefined || v === null) { values[c.id] = null; continue }
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${sctx}.values.${c.id} must be a finite number or null (got: ${JSON.stringify(v)})`)
      if (v < 0 && !allowNegative) throw new IrError(`${sctx}.values.${c.id} is negative (${v}) — the value axis starts at 0; set allowNegative: true to extend it below 0`)
      values[c.id] = v
    }
    return { id, label, values }
  })
}

function normalizeEmphasis(raw, categories, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.emphasis must be a list of category ids`)
  const seen = new Set()
  return raw.map((e, i) => {
    if (typeof e !== 'string' || !categories.some((c) => c.id === e)) throw new IrError(`${ctx}.emphasis[${i}] references unknown category ${JSON.stringify(e)}`)
    if (seen.has(e)) throw new IrError(`${ctx}.emphasis[${i}] repeats category "${e}"`)
    seen.add(e)
    return e
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  if (ir.categories.length > limits.maxCategories) {
    out.push(budgetWarning('budget:categories', ir.categories.length, limits.maxCategories,
      `${ir.categories.length} categories (guidance ≤ ${limits.maxCategories})`,
      'group the long tail into an "other" category, or split the chart by theme'))
  }
  if (ir.series.length > limits.maxSeries) {
    out.push(budgetWarning('budget:series', ir.series.length, limits.maxSeries,
      `${ir.series.length} series (guidance ≤ ${limits.maxSeries})`,
      `only ${limits.maxSeries} fill lightnesses stay distinguishable — draw one chart per ${limits.maxSeries} series, or use a table`))
  }
  const long = []
  ir.categories.forEach((c, i) => {
    const len = [...c.label].length
    if (len > limits.maxLabelLen) long.push({ where: `categories[${i}].label`, label: c.label, len })
  })
  ir.series.forEach((s, i) => {
    const len = [...s.label].length
    if (len > limits.maxLabelLen) long.push({ where: `series[${i}].label`, label: s.label, len })
  })
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, limits.maxLabelLen,
      long.map((e) => `${e.where} "${e.label}" is ${e.len} chars (guidance ≤ ${limits.maxLabelLen})`).join('; '),
      long.map((e) => `shorten ${e.where} ("${e.label}", ${e.len} > ${limits.maxLabelLen})`).join('; ') + ', or move the wording into the caption'))
  }
  if (ir.emphasis.length > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', ir.emphasis.length, limits.maxEmphasis,
      `${ir.emphasis.length} emphasized categories (guidance ≤ ${limits.maxEmphasis})`,
      'emphasize only the category the caption talks about'))
  }
  return out
}

// --- scale -----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
const round6 = (v) => Math.round(v * 1e6) / 1e6
/** Value label text: integers as-is, otherwise ≤ 2 decimals. */
const fmt = (v) => String(Number.isInteger(v) ? v : Math.round(v * 100) / 100)

function niceStep(range, target = 4) {
  const rough = range / target
  const p = 10 ** Math.floor(Math.log10(rough))
  const r = rough / p
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10
  return m * p
}

/** The value axis: lo ≤ 0 ≤ hi with nice ticks; lo is 0 unless a negative
 * value (allowNegative) pulls it down — the 0 end is never cut off. */
function axisDomain(values) {
  const present = values.filter((v) => v !== null)
  const max = Math.max(0, ...present)
  const min = Math.min(0, ...present)
  const step = niceStep((max - min) || 1)
  let hi = max > 0 ? round6(Math.ceil(round6(max / step)) * step) : 0
  const lo = min < 0 ? round6(Math.floor(round6(min / step)) * step) : 0
  if (hi === 0 && lo === 0) hi = step
  const ticks = []
  for (let t = lo; t <= hi + step / 2; t = round6(t + step)) ticks.push(round6(t))
  return { lo, hi, step, ticks }
}

/** Values that decide the axis extent: every value, or the per-category
 * sum for a stacked chart. */
function extentValues(ir) {
  if (ir.variant !== 'stacked') return ir.series.flatMap((s) => ir.categories.map((c) => s.values[c.id]))
  return ir.categories.map((c) => ir.series.reduce((sum, s) => sum + (s.values[c.id] ?? 0), 0))
}

function valueLabels(ir) {
  const out = ir.series.flatMap((s) => ir.categories.map((c) => s.values[c.id]).filter((v) => v !== null).map(fmt))
  if (ir.variant === 'stacked') out.push(...extentValues(ir).map(fmt))
  return out
}

const textBox = (x, y, text, size, anchor = 'start') => {
  const w = Math.ceil(textWidth(text, size))
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  return { left, top: y - size, right: left + w, bottom: y + 3 }
}

function missingEntries(ir) {
  const out = []
  for (const c of ir.categories) {
    for (const s of ir.series) if (s.values[c.id] === null) out.push({ category: c.id, series: s.id, text: ir.series.length > 1 ? `${c.label}（${s.label}）` : c.label })
  }
  return out
}

/** px per unit, recovered from the position function (|pos(1) − pos(0)|). */
const scaleOf = (pos) => pos.scale

// --- layout ----------------------------------------------------------------

export async function layout(ir, { column = COLUMN } = {}) {
  return ir.orientation === 'vertical' ? layoutVertical(ir, column) : layoutHorizontal(ir, column)
}

function commonParts(ir) {
  const axis = axisDomain(extentValues(ir))
  const tickTexts = axis.ticks.map((t, i) => (i === axis.ticks.length - 1 && ir.unit ? `${fmt(t)} ${ir.unit}` : fmt(t)))
  const valW = Math.max(0, ...valueLabels(ir).map((t) => textWidth(t, EDGE_LABEL_SIZE)))
  const catW = Math.max(...ir.categories.map((c) => textWidth(c.label, FONT_SIZE) * (ir.emphasis.includes(c.id) ? BOLD_FACTOR : 1)))
  const missing = missingEntries(ir)
  const legendItems = ir.series.map((s, i) => ({ id: s.id, label: s.label, opacity: FILL_OPACITY[i % FILL_OPACITY.length], ...(ir.variant === 'dumbbell' ? { marker: i === 0 ? 'open' : 'filled' } : {}) }))
  const hasNegative = axis.lo < 0
  return { axis, tickTexts, valW: Math.ceil(valW), catW: Math.ceil(catW), missing, legendItems, hasNegative }
}

/** Legend strip + footnote below `y`; returns them and the canvas height. */
function tailParts(parts, y, labels, uid) {
  let x = PAD
  const items = parts.legendItems.map((item) => {
    const textX = x + LEGEND_SWATCH + LABEL_GAP
    const w = Math.ceil(textWidth(item.label, EDGE_LABEL_SIZE))
    const laid = { ...item, swatchX: x, textX, textY: y + 12 }
    labels.push({ id: `${uid}-legend-${item.id}`, box: { left: x, top: y, right: textX + w, bottom: y + 15 } })
    x = textX + w + LEGEND_ITEM_GAP
    return laid
  })
  let bottom = y + 20
  let footnote = null
  if (parts.missing.length) {
    const text = NA_PREFIX + parts.missing.map((m) => m.text).join(', ')
    footnote = { text, x: PAD, y: bottom + 12 }
    labels.push({ id: `${uid}-footnote`, box: textBox(PAD, bottom + 12, text, EDGE_LABEL_SIZE) })
    bottom += FOOTNOTE_H + 4
  }
  return { legend: { y, items }, footnote, height: snapUp4(bottom + PAD - 4) }
}

function layoutHorizontal(ir, column) {
  const uid = `wu-d-${ir.id}`
  const parts = commonParts(ir)
  const { axis, valW, catW, hasNegative } = parts
  const dumbbell = ir.variant === 'dumbbell'
  const n = ir.series.length
  const width = column
  const catCol = snapUp4(catW + 12)
  const leftGutter = dumbbell || hasNegative ? snapUp4(valW + MARKER_LABEL_GAP + 4) : 0
  const lastTick = parts.tickTexts[parts.tickTexts.length - 1]
  const rightGutter = snapUp4(Math.max(valW + LABEL_GAP + 4, Math.ceil(textWidth(lastTick, EDGE_LABEL_SIZE) / 2) + 4) + (ir.variant === 'stacked' && parts.missing.length ? 16 : 0))
  const plotX0 = PAD + catCol + leftGutter
  const plotX1 = snap4(width - PAD - rightGutter)
  const plotW = plotX1 - plotX0
  const scale = plotW / (axis.hi - axis.lo)
  const pos = Object.assign((v) => round1(plotX0 + (v - axis.lo) * scale), { scale })
  const rowH = ir.variant === 'grouped' ? snapUp4(8 + n * GROUP_THICK + (n - 1) * GROUP_GAP) : ROW_H
  const plotTop = PAD
  const out = { bars: [], markers: [], lines: [], nas: [], labels: [], uid }
  const catLabels = []
  const rows = ir.categories.map((c, i) => {
    const y = plotTop + i * rowH
    const cy = y + rowH / 2
    const catX = PAD + catCol - 12
    catLabels.push({ id: c.id, text: c.label, x: catX, y: cy + 4, anchor: 'end', bold: ir.emphasis.includes(c.id) })
    out.labels.push({ id: `${uid}-cat-${c.id}`, box: textBox(catX, cy + 4, c.label, FONT_SIZE, 'end') })
    if (dumbbell) placeDumbbellRow(ir, c, { cy, pos, plotX0 }, out)
    else if (ir.variant === 'stacked') placeStackedRow(ir, c, { y, pos, plotX0 }, out)
    else placeBarRow(ir, c, { y, pos, plotX0, rowH }, out)
    return { id: c.id, y, cy }
  })
  const axisY = plotTop + rows.length * rowH + 4
  const ticks = axis.ticks.map((t, i) => {
    const text = parts.tickTexts[i]
    const p = pos(t)
    out.labels.push({ id: `${uid}-tick-${i}-label`, box: textBox(p, axisY + TICK_LABEL_DROP, text, EDGE_LABEL_SIZE, 'middle') })
    return { value: t, pos: p, text, labelY: axisY + TICK_LABEL_DROP }
  })
  const tail = tailParts(parts, axisY + 28, out.labels, uid)
  return {
    width,
    height: tail.height,
    geo: {
      orientation: 'horizontal', variant: ir.variant,
      axis: { lo: axis.lo, hi: axis.hi, step: axis.step, scale: round6(scale), zero: pos(0), ticks },
      plot: { x: plotX0, y: plotTop, w: plotW, h: axisY - plotTop, axisY },
      rows, catLabels, bars: out.bars, markers: out.markers, lines: out.lines, nas: out.nas, labels: out.labels,
      legend: tail.legend, footnote: tail.footnote,
    },
  }
}

function placeBarRow(ir, c, { y, pos, plotX0, rowH }, out) {
  const grouped = ir.variant === 'grouped'
  const thick = grouped ? GROUP_THICK : BAR_THICK
  ir.series.forEach((s, j) => {
    const v = s.values[c.id]
    const top = grouped ? y + 4 + j * (GROUP_THICK + GROUP_GAP) : y + (rowH - BAR_THICK) / 2
    const mid = top + thick / 2 + 4
    if (v === null) {
      out.nas.push({ category: c.id, series: s.id, tx: plotX0 + LABEL_GAP, ty: mid, anchor: 'start' })
      out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(plotX0 + LABEL_GAP, mid, NA, EDGE_LABEL_SIZE) })
      return
    }
    const len = round1(Math.abs(v) * scaleOf(pos))
    const left = v >= 0 ? pos(0) : pos(v)
    if (v !== 0) out.bars.push({ category: c.id, series: s.id, seriesIndex: j, value: v, left, top, w: len, h: thick, len, emphasis: ir.emphasis.includes(c.id) })
    const lx = v >= 0 ? round1(pos(v) + LABEL_GAP) : round1(pos(v) - LABEL_GAP)
    const anchor = v >= 0 ? 'start' : 'end'
    out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(lx, mid, fmt(v), EDGE_LABEL_SIZE, anchor), text: fmt(v), tx: lx, ty: mid, anchor, category: c.id, series: s.id, kind: 'value' })
  })
}

function placeStackedRow(ir, c, { y, pos, plotX0 }, out) {
  const top = y + (ROW_H - BAR_THICK) / 2
  const mid = top + BAR_THICK / 2 + 4
  let cursor = 0
  let anyNull = false
  ir.series.forEach((s, j) => {
    const v = s.values[c.id]
    if (v === null) { anyNull = true; return }
    if (v === 0) return
    const left = pos(cursor)
    const len = round1(v * scaleOf(pos))
    out.bars.push({ category: c.id, series: s.id, seriesIndex: j, value: v, left, top, w: len, h: BAR_THICK, len, emphasis: ir.emphasis.includes(c.id) })
    const text = fmt(v)
    if (len >= textWidth(text, EDGE_LABEL_SIZE) + 8) {
      const cx = round1(left + len / 2)
      out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(cx, mid, text, EDGE_LABEL_SIZE, 'middle'), text, tx: cx, ty: mid, anchor: 'middle', category: c.id, series: s.id, kind: 'segment', inverse: FILL_OPACITY[j % FILL_OPACITY.length] >= 0.4 })
    }
    cursor += v
  })
  const total = fmt(round6(cursor))
  const lx = round1(pos(cursor) + LABEL_GAP)
  const showTotal = cursor > 0 || !anyNull
  if (showTotal) {
    out.labels.push({ id: `${out.uid}-val-${c.id}-total`, box: textBox(lx, mid, total, EDGE_LABEL_SIZE), text: total, tx: lx, ty: mid, anchor: 'start', category: c.id, series: 'total', kind: 'value' })
  }
  if (anyNull) {
    const nx = showTotal ? round1(lx + textWidth(total, EDGE_LABEL_SIZE) + LABEL_GAP) : plotX0 + LABEL_GAP
    for (const s of ir.series) {
      if (s.values[c.id] !== null) continue
      out.nas.push({ category: c.id, series: s.id, tx: nx, ty: mid, anchor: 'start' })
      out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(nx, mid, NA, EDGE_LABEL_SIZE) })
    }
  }
}

function placeDumbbellRow(ir, c, { cy, pos, plotX0 }, out) {
  const [before, after] = ir.series
  const vb = before.values[c.id]
  const va = after.values[c.id]
  const present = [[before, vb, 0], [after, va, 1]].filter(([, v]) => v !== null)
  for (const s of ir.series) {
    if (s.values[c.id] !== null) continue
    const nx = plotX0 - MARKER_LABEL_GAP
    out.nas.push({ category: c.id, series: s.id, tx: nx, ty: cy + 4, anchor: 'end' })
    out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(nx, cy + 4, NA, EDGE_LABEL_SIZE, 'end') })
  }
  if (present.length === 2) out.lines.push({ category: c.id, from: pos(vb), to: pos(va), cy, delta: round6(va - vb) })
  const lo = present.length === 2 ? Math.min(vb, va) : null
  for (const [s, v, j] of present) {
    out.markers.push({ category: c.id, series: s.id, seriesIndex: j, value: v, px: pos(v), cy, filled: j === 1, emphasis: ir.emphasis.includes(c.id) })
    const leftSide = present.length === 2 && v === lo && !(vb === va && j === 1)
    const lx = round1(pos(v) + (leftSide ? -MARKER_LABEL_GAP : MARKER_LABEL_GAP))
    const anchor = leftSide ? 'end' : 'start'
    out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(lx, cy + 4, fmt(v), EDGE_LABEL_SIZE, anchor), text: fmt(v), tx: lx, ty: cy + 4, anchor, category: c.id, series: s.id, kind: 'value' })
  }
}

function layoutVertical(ir, column) {
  const uid = `wu-d-${ir.id}`
  const parts = commonParts(ir)
  const { axis, valW, catW, hasNegative } = parts
  const dumbbell = ir.variant === 'dumbbell'
  const n = ir.series.length
  const thick = Math.max(BAR_THICK, snapUp4(valW + 6))
  const groupW = ir.variant === 'grouped' ? n * thick + (n - 1) * 4 : dumbbell ? MARKER_R * 2 : thick
  const slotW = Math.ceil(Math.max(40, catW + 8, groupW + 12) / 8) * 8
  const tickW = Math.max(...parts.tickTexts.map((t) => textWidth(t, EDGE_LABEL_SIZE)))
  const plotX0 = PAD + snapUp4(tickW + 8)
  const width = snapUp4(plotX0 + ir.categories.length * slotW + PAD)
  const topGutter = 20
  const plotTop = PAD + topGutter
  const plotBottom = plotTop + PLOT_H
  const scale = PLOT_H / (axis.hi - axis.lo)
  const pos = Object.assign((v) => round1(plotBottom - (v - axis.lo) * scale), { scale })
  const bottomGutter = dumbbell || hasNegative ? 20 : 0
  const catY = plotBottom + bottomGutter + 16
  const out = { bars: [], markers: [], lines: [], nas: [], labels: [], uid }
  const catLabels = []
  const rows = ir.categories.map((c, i) => {
    const x = plotX0 + i * slotW
    const cx = x + slotW / 2
    catLabels.push({ id: c.id, text: c.label, x: cx, y: catY, anchor: 'middle', bold: ir.emphasis.includes(c.id) })
    out.labels.push({ id: `${uid}-cat-${c.id}`, box: textBox(cx, catY, c.label, FONT_SIZE, 'middle') })
    if (dumbbell) placeDumbbellColumn(ir, c, { cx, pos, plotBottom }, out)
    else if (ir.variant === 'stacked') placeStackedColumn(ir, c, { cx, pos, thick }, out)
    else placeBarColumn(ir, c, { cx, pos, thick, groupW, plotBottom }, out)
    return { id: c.id, x, cx }
  })
  const ticks = axis.ticks.map((t, i) => {
    const text = parts.tickTexts[i]
    const p = pos(t)
    out.labels.push({ id: `${uid}-tick-${i}-label`, box: textBox(plotX0 - 8, p + 4, text, EDGE_LABEL_SIZE, 'end') })
    return { value: t, pos: p, text, labelX: plotX0 - 8 }
  })
  const tail = tailParts(parts, catY + 12, out.labels, uid)
  return {
    width: Math.max(width, snapUp4(tail.legend.items.length ? tail.legend.items[tail.legend.items.length - 1].textX + textWidth(tail.legend.items[tail.legend.items.length - 1].label, EDGE_LABEL_SIZE) + PAD : 0)),
    height: tail.height,
    geo: {
      orientation: 'vertical', variant: ir.variant,
      axis: { lo: axis.lo, hi: axis.hi, step: axis.step, scale: round6(scale), zero: pos(0), ticks },
      plot: { x: plotX0, y: plotTop, w: rows.length * slotW, h: PLOT_H, yBottom: plotBottom },
      rows, catLabels, bars: out.bars, markers: out.markers, lines: out.lines, nas: out.nas, labels: out.labels,
      legend: tail.legend, footnote: tail.footnote,
    },
  }
}

function placeBarColumn(ir, c, { cx, pos, thick, groupW, plotBottom }, out) {
  const grouped = ir.variant === 'grouped'
  ir.series.forEach((s, j) => {
    const v = s.values[c.id]
    const left = grouped ? cx - groupW / 2 + j * (thick + 4) : cx - thick / 2
    const mid = left + thick / 2
    if (v === null) {
      out.nas.push({ category: c.id, series: s.id, tx: mid, ty: plotBottom - LABEL_GAP, anchor: 'middle' })
      out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(mid, plotBottom - LABEL_GAP, NA, EDGE_LABEL_SIZE, 'middle') })
      return
    }
    const len = round1(Math.abs(v) * scaleOf(pos))
    const top = v >= 0 ? pos(v) : pos(0)
    if (v !== 0) out.bars.push({ category: c.id, series: s.id, seriesIndex: j, value: v, left, top, w: thick, h: len, len, emphasis: ir.emphasis.includes(c.id) })
    const ly = v >= 0 ? round1(pos(v) - LABEL_GAP) : round1(pos(v) + LABEL_GAP + 11)
    out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(mid, ly, fmt(v), EDGE_LABEL_SIZE, 'middle'), text: fmt(v), tx: mid, ty: ly, anchor: 'middle', category: c.id, series: s.id, kind: 'value' })
  })
}

function placeStackedColumn(ir, c, { cx, pos, thick }, out) {
  const left = cx - thick / 2
  let cursor = 0
  let anyNull = false
  ir.series.forEach((s, j) => {
    const v = s.values[c.id]
    if (v === null) { anyNull = true; return }
    if (v === 0) return
    const len = round1(v * scaleOf(pos))
    const top = pos(cursor + v)
    out.bars.push({ category: c.id, series: s.id, seriesIndex: j, value: v, left, top, w: thick, h: len, len, emphasis: ir.emphasis.includes(c.id) })
    const text = fmt(v)
    if (len >= 18) {
      const my = round1(top + len / 2 + 4)
      out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(cx, my, text, EDGE_LABEL_SIZE, 'middle'), text, tx: cx, ty: my, anchor: 'middle', category: c.id, series: s.id, kind: 'segment', inverse: FILL_OPACITY[j % FILL_OPACITY.length] >= 0.4 })
    }
    cursor += v
  })
  const total = fmt(round6(cursor))
  const ly = round1(pos(cursor) - LABEL_GAP)
  out.labels.push({ id: `${out.uid}-val-${c.id}-total`, box: textBox(cx, ly, total, EDGE_LABEL_SIZE, 'middle'), text: total, tx: cx, ty: ly, anchor: 'middle', category: c.id, series: 'total', kind: 'value' })
  if (anyNull) {
    const ny = round1(ly - 14)
    for (const s of ir.series) {
      if (s.values[c.id] !== null) continue
      out.nas.push({ category: c.id, series: s.id, tx: cx, ty: ny, anchor: 'middle' })
      out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(cx, ny, NA, EDGE_LABEL_SIZE, 'middle') })
    }
  }
}

function placeDumbbellColumn(ir, c, { cx, pos, plotBottom }, out) {
  const [before, after] = ir.series
  const vb = before.values[c.id]
  const va = after.values[c.id]
  const present = [[before, vb, 0], [after, va, 1]].filter(([, v]) => v !== null)
  for (const s of ir.series) {
    if (s.values[c.id] !== null) continue
    out.nas.push({ category: c.id, series: s.id, tx: cx, ty: plotBottom + 14, anchor: 'middle' })
    out.labels.push({ id: `${out.uid}-na-${c.id}-${s.id}`, box: textBox(cx, plotBottom + 14, NA, EDGE_LABEL_SIZE, 'middle') })
  }
  if (present.length === 2) out.lines.push({ category: c.id, cx, y1v: pos(vb), y2v: pos(va), delta: round6(va - vb) })
  const lo = present.length === 2 ? Math.min(vb, va) : null
  for (const [s, v, j] of present) {
    out.markers.push({ category: c.id, series: s.id, seriesIndex: j, value: v, cx, py: pos(v), filled: j === 1, emphasis: ir.emphasis.includes(c.id) })
    const below = present.length === 2 && v === lo && !(vb === va && j === 1)
    const ly = round1(pos(v) + (below ? MARKER_LABEL_GAP + 9 : -MARKER_LABEL_GAP + 2))
    out.labels.push({ id: `${out.uid}-val-${c.id}-${s.id}`, box: textBox(cx, ly, fmt(v), EDGE_LABEL_SIZE, 'middle'), text: fmt(v), tx: cx, ty: ly, anchor: 'middle', category: c.id, series: s.id, kind: 'value' })
  }
}

// --- draw ------------------------------------------------------------------

export function draw(layoutResult, ir) {
  const g = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const horizontal = g.orientation === 'horizontal'
  const parts = []
  // gridlines + tick labels
  parts.push(`<g id="${uid}-ticks" stroke="var(--wu-rule-soft)" stroke-width="1">`)
  g.axis.ticks.forEach((t, i) => {
    if (t.value === 0) return
    parts.push(horizontal
      ? `<line id="${uid}-tick-${i}" x1="${t.pos}" y1="${g.plot.y}" x2="${t.pos}" y2="${g.plot.axisY}"/>`
      : `<line id="${uid}-tick-${i}" x1="${g.plot.x}" y1="${t.pos}" x2="${g.plot.x + g.plot.w}" y2="${t.pos}"/>`)
  })
  parts.push('</g>')
  parts.push(`<g id="${uid}-tick-labels" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">`)
  g.axis.ticks.forEach((t, i) => {
    parts.push(horizontal
      ? `<text id="${uid}-tick-${i}-label" x="${t.pos}" y="${t.labelY}" text-anchor="middle">${esc(t.text)}</text>`
      : `<text id="${uid}-tick-${i}-label" x="${t.labelX}" y="${t.pos + 4}" text-anchor="end">${esc(t.text)}</text>`)
  })
  parts.push('</g>')
  // the zero axis line
  parts.push(horizontal
    ? `<line id="${uid}-axis" x1="${g.axis.zero}" y1="${g.plot.y}" x2="${g.axis.zero}" y2="${g.plot.axisY}" stroke="var(--wu-rule)" stroke-width="1"/>`
    : `<line id="${uid}-axis" x1="${g.plot.x}" y1="${g.axis.zero}" x2="${g.plot.x + g.plot.w}" y2="${g.axis.zero}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  // bars
  if (g.bars.length) {
    parts.push(`<g id="${uid}-bars" stroke="currentColor" stroke-width="1">`)
    for (const b of g.bars) {
      const focal = b.emphasis ? ' class="wu-focal" stroke-width="1.5"' : ''
      parts.push(`<rect id="${uid}-bar-${b.category}-${b.series}" data-value="${b.value}" data-category="${esc(b.category)}" data-series="${esc(b.series)}" x="${b.left}" y="${b.top}" width="${b.w}" height="${b.h}" fill="currentColor" fill-opacity="${FILL_OPACITY[b.seriesIndex % FILL_OPACITY.length]}"${focal}/>`)
    }
    parts.push('</g>')
  }
  // dumbbell lines + markers
  if (g.lines.length || g.markers.length) {
    parts.push(`<g id="${uid}-dumbbells" stroke="currentColor" stroke-width="1.5">`)
    for (const l of g.lines) {
      parts.push(horizontal
        ? `<line id="${uid}-delta-${l.category}" data-delta="${l.delta}" x1="${l.from}" y1="${l.cy}" x2="${l.to}" y2="${l.cy}"/>`
        : `<line id="${uid}-delta-${l.category}" data-delta="${l.delta}" x1="${l.cx}" y1="${l.y1v}" x2="${l.cx}" y2="${l.y2v}"/>`)
    }
    for (const m of g.markers) {
      const cx = horizontal ? m.px : m.cx
      const cy = horizontal ? m.cy : m.py
      parts.push(`<circle id="${uid}-mark-${m.category}-${m.series}" data-value="${m.value}" data-category="${esc(m.category)}" data-series="${esc(m.series)}" cx="${cx}" cy="${cy}" r="${MARKER_R}" fill="${m.filled ? 'currentColor' : 'var(--wu-surface)'}"/>`)
    }
    parts.push('</g>')
  }
  // value labels (segment labels inside a dark segment are drawn in the surface colour)
  parts.push(`<g id="${uid}-values" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">`)
  for (const l of g.labels) {
    if (l.kind !== 'value' && l.kind !== 'segment') continue
    const fill = l.inverse ? ' fill="var(--wu-surface)"' : ''
    parts.push(`<text id="${l.id}" x="${l.tx}" y="${l.ty}" text-anchor="${l.anchor}"${fill}>${esc(l.text)}</text>`)
  }
  parts.push('</g>')
  // missing values
  if (g.nas.length) {
    parts.push(`<g id="${uid}-missing" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">`)
    for (const n of g.nas) parts.push(`<text id="${uid}-na-${n.category}-${n.series}" data-missing="true" x="${n.tx}" y="${n.ty}" text-anchor="${n.anchor}">${NA}</text>`)
    parts.push('</g>')
  }
  // category labels
  parts.push(`<g id="${uid}-cats" font-size="${FONT_SIZE}" fill="currentColor">`)
  for (const c of g.catLabels) {
    parts.push(`<text id="${uid}-cat-${c.id}" x="${c.x}" y="${c.y}" text-anchor="${c.anchor}"${c.bold ? ' font-weight="700"' : ''}>${esc(c.text)}</text>`)
  }
  parts.push('</g>')
  // legend strip
  parts.push(`<g id="${uid}-legend" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">`)
  for (const item of g.legend.items) {
    if (item.marker) {
      parts.push(`<circle id="${uid}-legend-${item.id}-swatch" cx="${item.swatchX + LEGEND_SWATCH / 2}" cy="${g.legend.y + 8}" r="${MARKER_R}" fill="${item.marker === 'filled' ? 'currentColor' : 'var(--wu-surface)'}" stroke="currentColor" stroke-width="1.5"/>`)
    } else {
      parts.push(`<rect id="${uid}-legend-${item.id}-swatch" x="${item.swatchX}" y="${g.legend.y + 2}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" fill="currentColor" fill-opacity="${item.opacity}" stroke="currentColor" stroke-width="1"/>`)
    }
    parts.push(`<text id="${uid}-legend-${item.id}" data-series="${esc(item.id)}" x="${item.textX}" y="${item.textY}">${esc(item.label)}</text>`)
  }
  parts.push('</g>')
  if (g.footnote) {
    parts.push(`<text id="${uid}-footnote" x="${g.footnote.x}" y="${g.footnote.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(g.footnote.text)}</text>`)
  }
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

export function verify(layoutResult, ir, { svg } = {}) {
  const g = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const horizontal = g.orientation === 'horizontal'
  const rows = []
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  warnRow(1, 'category-count', 'budget:categories', `${ir.categories.length} categories`)
  warnRow(2, 'series-count', 'budget:series', `${ir.series.length} series`)
  warnRow(3, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`)
  warnRow(4, 'emphasis-count', 'budget:emphasis', `${ir.emphasis.length} emphasized`)

  // #5 the value axis starts at 0 and is never truncated
  const present = extentValues(ir).filter((v) => v !== null)
  const minV = Math.min(0, ...present)
  const maxV = Math.max(0, ...present)
  const axisProblems = []
  if (!(g.axis.lo <= 0 && g.axis.hi >= 0)) axisProblems.push(`axis ${g.axis.lo}..${g.axis.hi} does not include 0`)
  if (minV >= 0 && g.axis.lo !== 0) axisProblems.push(`axis starts at ${g.axis.lo}, not 0`)
  if (!g.axis.ticks.some((t) => t.value === 0)) axisProblems.push('no tick at 0')
  if (g.axis.lo > minV || g.axis.hi < maxV) axisProblems.push(`axis ${g.axis.lo}..${g.axis.hi} cuts off values (${minV}..${maxV})`)
  rows.push({
    id: 5, name: 'axis-from-zero', severity: 'fail', ok: axisProblems.length === 0,
    detail: axisProblems.length ? axisProblems.join('; ') : `value axis ${g.axis.lo}..${g.axis.hi} starts at 0 with a tick every ${g.axis.step}`,
    hint: axisProblems.length ? 'the value axis must run from 0 to a nice tick above the largest value — never truncate it' : undefined,
  })

  // #6 every bar / marker proportional to its data-value, in geometry and in the svg
  const propProblems = []
  const scale = g.axis.scale
  const markerPos = (v) => (horizontal ? g.plot.x + (v - g.axis.lo) * scale : g.plot.yBottom - (v - g.axis.lo) * scale)
  for (const b of g.bars) {
    if (Math.abs(b.len - Math.abs(b.value) * scale) > 1) propProblems.push(`bar ${b.category}/${b.series}: length ${b.len} ≠ |${b.value}| × ${scale}`)
  }
  for (const m of g.markers) {
    const actual = horizontal ? m.px : m.py
    if (Math.abs(actual - markerPos(m.value)) > 1) propProblems.push(`marker ${m.category}/${m.series}: at ${actual}, value ${m.value} maps to ${round1(markerPos(m.value))}`)
  }
  if (svg !== undefined) {
    let seen = 0
    for (const m of svg.matchAll(/<rect id="([^"]+)" data-value="([^"]+)"[^>]*\swidth="([^"]+)" height="([^"]+)"/g)) {
      seen++
      const v = parseFloat(m[2])
      const len = parseFloat(horizontal ? m[3] : m[4])
      if (Math.abs(len - Math.abs(v) * scale) > 1) propProblems.push(`svg ${m[1]}: drawn ${len}px for value ${v} (expected ${round1(Math.abs(v) * scale)})`)
    }
    for (const m of svg.matchAll(/<circle id="([^"]+)" data-value="([^"]+)"[^>]*\scx="([^"]+)" cy="([^"]+)"/g)) {
      seen++
      const v = parseFloat(m[2])
      const actual = parseFloat(horizontal ? m[3] : m[4])
      if (Math.abs(actual - markerPos(v)) > 1) propProblems.push(`svg ${m[1]}: drawn at ${actual} for value ${v} (expected ${round1(markerPos(v))})`)
    }
    const expectedCount = g.bars.length + g.markers.length
    if (seen !== expectedCount) propProblems.push(`${seen} data-value element(s) in the svg, expected ${expectedCount}`)
  }
  rows.push({
    id: 6, name: 'bars-proportional', severity: 'fail', ok: propProblems.length === 0,
    detail: propProblems.length ? propProblems.slice(0, 6).join('; ') : `every bar/marker matches its data-value within 1px (${g.bars.length + g.markers.length} checked)`,
    hint: propProblems.length ? 'bar length must be |value| × axis.scale — read data-value back and compare' : undefined,
  })

  // #7 labels (category, value, tick, legend, footnote, "—") clear of each other
  const clash = []
  for (let i = 0; i < g.labels.length; i++) {
    for (let j = i + 1; j < g.labels.length; j++) {
      if (overlaps(g.labels[i].box, g.labels[j].box)) clash.push(`${g.labels[i].id.slice(uid.length + 1)} overlaps ${g.labels[j].id.slice(uid.length + 1)}`)
    }
  }
  rows.push({
    id: 7, name: 'labels-clear', severity: 'fail', ok: clash.length === 0,
    detail: clash.length ? clash.slice(0, 6).join('; ') : `${g.labels.length} labels, none overlapping`,
    hint: clash.length ? 'shorten labels, reduce series, or switch orientation so value labels have room' : undefined,
  })

  // #8 the legend lists exactly the series, in order, with their labels
  const legendProblems = []
  const legendIds = g.legend.items.map((i) => i.id)
  const seriesIds = ir.series.map((s) => s.id)
  if (legendIds.join(' ') !== seriesIds.join(' ')) legendProblems.push(`legend lists [${legendIds.join(', ')}], series are [${seriesIds.join(', ')}]`)
  if (svg !== undefined) {
    const drawn = [...svg.matchAll(/<text id="[^"]+-legend-([^"]+)" data-series="[^"]*"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[1], m[2]])
    if (drawn.length !== ir.series.length) legendProblems.push(`${drawn.length} legend entr${drawn.length === 1 ? 'y' : 'ies'} in the svg, expected ${ir.series.length}`)
    for (const s of ir.series) {
      const d = drawn.find(([id]) => id === s.id)
      if (!d) legendProblems.push(`series "${s.id}" missing from the svg legend`)
      else if (d[1] !== esc(s.label)) legendProblems.push(`legend for "${s.id}" reads "${d[1]}", series label is "${s.label}"`)
    }
  }
  rows.push({
    id: 8, name: 'legend-series', severity: 'fail', ok: legendProblems.length === 0,
    detail: legendProblems.length ? legendProblems.join('; ') : `legend lists exactly the ${ir.series.length} series`,
    hint: legendProblems.length ? 'the legend strip must carry one entry per series, in series order, using the series label' : undefined,
  })

  // #9 every missing value is drawn as "—" and disclosed in the footnote
  const missing = missingEntries(ir)
  const naProblems = []
  for (const m of missing) {
    if (!g.nas.some((n) => n.category === m.category && n.series === m.series)) naProblems.push(`${m.category}/${m.series} has no "—" placeholder`)
    if (svg !== undefined && !svg.includes(`id="${uid}-na-${m.category}-${m.series}"`)) naProblems.push(`${m.category}/${m.series} "—" not in the svg`)
    if (!g.footnote || !g.footnote.text.includes(m.text)) naProblems.push(`${m.category}/${m.series} not listed in the footnote`)
  }
  if (missing.length === 0 && g.footnote) naProblems.push('footnote present without missing values')
  if (svg !== undefined) {
    const has = svg.includes(`id="${uid}-footnote"`)
    if (missing.length && !has) naProblems.push('footnote missing from the svg')
    if (missing.length && has && !svg.includes(esc(NA_PREFIX))) naProblems.push(`footnote does not start with "${NA_PREFIX.trim()}"`)
  }
  rows.push({
    id: 9, name: 'missing-disclosed', severity: 'fail', ok: naProblems.length === 0,
    detail: naProblems.length ? naProblems.slice(0, 6).join('; ') : missing.length ? `${missing.length} missing value(s) drawn as "—" and listed in the footnote` : 'no missing values',
    hint: naProblems.length ? 'a null value must be drawn as a muted "—" in place of the bar and listed in the 「欠損: …」 footnote — never as 0' : undefined,
  })
  return rows
}

// --- doc -------------------------------------------------------------------

export const doc = {
  purpose: 'quantities compared across categories — single bars, grouped, stacked, or a before/after dumbbell',
  whenToUse: 'when the reader must compare exact magnitudes (cost, latency, counts) across 2–10 categories; the dumbbell variant when the *difference* between two states per category is the point. Not for parts of a whole by area (treemap) or trends over many points (line). Budgets: categories ≤ 10, series ≤ 3, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn. The value axis always starts at 0; a null value is drawn as "—" and listed in a 欠損 footnote.',
  irExample: `id: p95-before-after
type: bar
variant: dumbbell
title: エンドポイント別 p95 遅延の改善
caption: 接続プール導入の前後。線の長さが差分
unit: ms
categories:
  - id: search
    label: 検索
  - id: detail
    label: 詳細取得
  - id: create
    label: 登録
  - id: export
    label: エクスポート
  - id: auth
    label: 認証
emphasis:
  - search
series:
  - id: before
    label: 導入前
    values:
      search: 820
      detail: 310
      create: 540
      export: 1250
      auth: 95
  - id: after
    label: 導入後
    values:
      search: 260
      detail: 180
      create: 410
      export: 900
      auth: 90
`,
  rows: ['category-count', 'series-count', 'label-length', 'emphasis-count', 'axis-from-zero', 'bars-proportional', 'labels-clear', 'legend-series', 'missing-disclosed'],
}
