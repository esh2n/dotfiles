// `type: radar` — a spider chart: N axes radiating from one centre, 1–3
// series drawn as closed polygons over 4 concentric rings. Compares a few
// options on several criteria (capability matrix, scoring of alternatives).
//
// IR shape: `{ id, type:'radar', title, caption?, axes, max?, series }`.
//   axes:   [{ id, label }]                      3–8 (fewer than 3 cannot form a polygon → schema error)
//   max:    number > 0, the outer ring's value   default 1 (values are normalized to 0..max)
//   series: [{ id, label, values: { <axisId>: number }, emphasis? }]   1–3
// Every axis must have a value in every series — a missing value is a
// schema error, not a silent 0 (the survey's rule: stop and ask). Values
// outside 0..max are a verify `fail` row (the polygon would leave the
// rings), so the author sees the offending axis rather than a clipped
// figure.
//
// Distinguishing series without colour: the first series is a solid stroke
// with a light neutral fill (currentColor at 8%), the second a dashed
// stroke, the third a dotted stroke; `emphasis: true` adds vertex dots.
// The legend at the bottom is the shared wrapper's (`legend` in layout()).
//
// Geometry and the 4px grid: the centre, the axis-label anchors, the
// legend and the canvas are on the grid (shared row `grid-4px` reads the
// `x`/`y`/`cx`/`cy` keys). Points on the rings — spoke ends and polygon
// vertices — are polar-derived and cannot sit on a 4px grid without the
// spokes visibly missing the ring, so they are stored as `px`/`py`
// (rounded to 0.1) and are the plugin's own rule, not the shared row's.
import { IrError, isObj, requireStr, normalizeHeader, validateBool, budgetWarning, esc, legendWidth, LEGEND_HEIGHT } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, COLUMN } from '../diagram.mjs'

export const type = 'radar'

export const limits = { maxAxes: 8, maxSeries: 3, maxLabelLen: 12 }

const MIN_AXES = 3
const RINGS = 4
const RADIUS = 160          // outer ring radius at a 720px column
const RADIUS_MIN = 96       // the layout shrinks to this before it lets the dispatcher scale/scroll
const LABEL_GAP = 12        // ring → label anchor
const RING_CLEAR = 4        // label box must stay this far outside the outer ring
const PAD = 16
const LEGEND_GAP = 12
const DOT_R = 3
/** Stroke pattern per series position: solid, dashed, dotted, then one
 * dash-dot spare so a 4-series (over-budget) radar still renders with a
 * warning; a 5th series would repeat a pattern and fail `series-distinct`. */
const DASHES = ['', '6 4', '1.5 3.5', '8 3 1.5 3']

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const axes = normalizeAxes(raw.axes, ctx)
  const max = normalizeMax(raw.max, ctx)
  const series = normalizeSeries(raw.series, axes, ctx)
  return { id, type, title, caption, axes, max, series }
}

function normalizeAxes(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.axes must be a non-empty list`)
  if (raw.length < MIN_AXES) throw new IrError(`${ctx}.axes needs at least ${MIN_AXES} axes to form a polygon (got: ${raw.length})`)
  const seen = new Set()
  return raw.map((a, i) => {
    const actx = `${ctx}.axes[${i}]`
    if (!isObj(a)) throw new IrError(`${actx} must be a mapping`)
    const id = requireStr(a, 'id', actx)
    if (seen.has(id)) throw new IrError(`duplicate axis id: "${id}"`)
    seen.add(id)
    return { id, label: requireStr(a, 'label', actx) }
  })
}

function normalizeMax(v, ctx) {
  if (v === undefined || v === null) return 1
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new IrError(`${ctx}.max must be a positive number (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeSeries(raw, axes, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.series must be a non-empty list`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.series[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate series id: "${id}"`)
    seen.add(id)
    const label = requireStr(s, 'label', sctx)
    if (!isObj(s.values)) throw new IrError(`${sctx}.values must be a mapping of axis id → number`)
    for (const key of Object.keys(s.values)) {
      if (!axes.some((a) => a.id === key)) throw new IrError(`${sctx}.values references unknown axis "${key}"`)
    }
    const values = {}
    for (const a of axes) {
      const v = s.values[a.id]
      if (v === undefined || v === null) throw new IrError(`${sctx}.values is missing axis "${a.id}" — every axis needs a value (use 0 explicitly, never omit)`)
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${sctx}.values.${a.id} must be a finite number (got: ${JSON.stringify(v)})`)
      values[a.id] = v
    }
    return { id, label, values, emphasis: validateBool(s, 'emphasis', sctx) }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  if (ir.axes.length > limits.maxAxes) {
    out.push(budgetWarning('budget:axes', ir.axes.length, limits.maxAxes,
      `${ir.axes.length} axes (guidance ≤ ${limits.maxAxes})`,
      'drop the least decisive criteria, or compare them in a table instead'))
  }
  if (ir.series.length > limits.maxSeries) {
    out.push(budgetWarning('budget:series', ir.series.length, limits.maxSeries,
      `${ir.series.length} series (guidance ≤ ${limits.maxSeries})`,
      `only ${limits.maxSeries} stroke patterns stay distinguishable without colour — draw one radar per ${limits.maxSeries} options, or use a table`))
  }
  const long = []
  ir.axes.forEach((a, i) => {
    const len = [...a.label].length
    if (len > limits.maxLabelLen) long.push({ where: `axes[${i}].label`, label: a.label, len })
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
  return out
}

// --- layout ----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
/** Axis i of n: straight up first, then clockwise. */
const angleOf = (i, n) => -Math.PI / 2 + (i * 2 * Math.PI) / n
/** Polar point (centre-origin) on `radius` at `angle`; 0.1px precision, no -0. */
const polar = (radius, angle) => ({ px: round1(radius * Math.cos(angle)) || 0, py: round1(radius * Math.sin(angle)) || 0 })

/** Label anchor + box in centre-origin coordinates, snapped to the grid. */
function labelPlacement(axis, angle, radius) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const tip = { x: (radius + LABEL_GAP) * c, y: (radius + LABEL_GAP) * s }
  const anchor = c > 0.1 ? 'start' : c < -0.1 ? 'end' : 'middle'
  // Baseline: above the tip when the axis points up, below when it points
  // down, vertically centred on the sides.
  const baseline = s < -0.1 ? tip.y - 4 : s > 0.1 ? tip.y + 13 : tip.y + 4
  const x = snap4(tip.x)
  const y = snap4(baseline)
  const width = Math.ceil(textWidth(axis.label, FONT_SIZE))
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  // Box keys are left/top/right/bottom on purpose: x1/y1 are position keys
  // for the shared grid row, and a text-fitted box edge is a size, not a position.
  return { id: axis.id, label: axis.label, x, y, anchor, box: { left, top: y - 13, right: left + width, bottom: y + 3 } }
}

function extents(radius, axes) {
  const labels = axes.map((a, i) => labelPlacement(a, angleOf(i, axes.length), radius))
  let minX = -radius, maxX = radius, minY = -radius, maxY = radius
  for (const l of labels) {
    minX = Math.min(minX, l.box.left); maxX = Math.max(maxX, l.box.right)
    minY = Math.min(minY, l.box.top); maxY = Math.max(maxY, l.box.bottom)
  }
  return { labels, minX, maxX, minY, maxY }
}

export async function layout(ir, { column = COLUMN } = {}) {
  const n = ir.axes.length
  // Radius: the default, shrunk in 8px steps (down to RADIUS_MIN) until the
  // rings plus the outside labels fit the column; beyond that the
  // dispatcher's scale/scroll decision takes over.
  let radius = RADIUS
  let ext = extents(radius, ir.axes)
  while (radius > RADIUS_MIN && Math.max(-ext.minX, ext.maxX) * 2 + PAD * 2 > column) {
    radius -= 8
    ext = extents(radius, ir.axes)
  }
  const legendItems = ir.series.map((s, i) => ({ label: s.label, ...(DASHES[i % DASHES.length] ? { dash: DASHES[i % DASHES.length] } : {}) }))
  const half = snapUp4(Math.max(-ext.minX, ext.maxX) + PAD)
  const width = Math.max(half * 2, snapUp4(legendWidth(legendItems)))
  const cx = snap4(width / 2)
  const cy = snapUp4(-ext.minY + PAD)
  const bodyBottom = snapUp4(cy + ext.maxY + PAD)
  const legendY = bodyBottom + LEGEND_GAP
  const height = legendY + LEGEND_HEIGHT

  const rings = Array.from({ length: RINGS }, (_, k) => ({ k: k + 1, r: round1((radius * (k + 1)) / RINGS), value: round1((ir.max * (k + 1)) / RINGS) }))
  const axes = ir.axes.map((a, i) => {
    const angle = angleOf(i, n)
    const l = ext.labels[i]
    return {
      id: a.id,
      angle: round1((angle * 180) / Math.PI),
      end: polar(radius, angle),
      label: { text: a.label, x: cx + l.x, y: cy + l.y, anchor: l.anchor, box: { left: cx + l.box.left, top: cy + l.box.top, right: cx + l.box.right, bottom: cy + l.box.bottom } },
    }
  })
  const series = ir.series.map((s, i) => ({
    id: s.id,
    label: s.label,
    dash: DASHES[i % DASHES.length],
    fill: i === 0,
    emphasis: s.emphasis,
    points: ir.axes.map((a, j) => {
      const v = s.values[a.id]
      const p = polar((radius * v) / ir.max, angleOf(j, n))
      return { axis: a.id, value: v, px: p.px, py: p.py }
    }),
  }))
  // The outer ring's value, just inside the ring to the right of the top
  // spoke — the one scale hint the reader needs (rings are max/4 apart).
  const scale = { text: String(ir.max), x: cx + 8, y: snap4(cy - radius + 16) }
  return {
    width,
    height,
    geo: { cx, cy, radius, rings, axes, series, scale },
    legend: { y: legendY, items: legendItems },
  }
}

// --- draw ------------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { cx, cy, rings, axes, series, scale } = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const abs = (p) => `${round1(cx + p.px)} ${round1(cy + p.py)}`
  const parts = []
  parts.push(`<g id="${uid}-rings" fill="none" stroke="var(--wu-rule)" stroke-width="1">`)
  for (const ring of rings) parts.push(`<circle id="${uid}-ring-${ring.k}" cx="${cx}" cy="${cy}" r="${ring.r}"/>`)
  parts.push('</g>')
  parts.push(`<g id="${uid}-spokes" stroke="var(--wu-rule)" stroke-width="1">`)
  for (const a of axes) parts.push(`<line id="${uid}-spoke-${a.id}" x1="${cx}" y1="${cy}" x2="${round1(cx + a.end.px)}" y2="${round1(cy + a.end.py)}"/>`)
  parts.push('</g>')
  series.forEach((s) => {
    const points = s.points.map(abs).join(' ')
    const fill = s.fill ? ' fill="currentColor" fill-opacity="0.08"' : ' fill="none"'
    const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : ''
    parts.push(`<polygon id="${uid}-series-${s.id}" points="${points}"${fill} stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"${dash}/>`)
    if (s.emphasis) {
      parts.push(`<g id="${uid}-series-${s.id}-dots" fill="currentColor">`)
      s.points.forEach((p, i) => parts.push(`<circle id="${uid}-series-${s.id}-dot-${i}" cx="${round1(cx + p.px)}" cy="${round1(cy + p.py)}" r="${DOT_R}"/>`))
      parts.push('</g>')
    }
  })
  // The scale hint sits inside the rings where a polygon edge may cross it,
  // so it is drawn last over a surface-coloured mask (as sequence does for
  // a label crossing a lifeline) and stays legible.
  const scaleW = Math.ceil(textWidth(scale.text, EDGE_LABEL_SIZE)) + 4
  parts.push(`<rect x="${scale.x - 2}" y="${scale.y - 11}" width="${scaleW}" height="14" fill="var(--wu-surface)" stroke="none"/>`)
  parts.push(`<text id="${uid}-scale" x="${scale.x}" y="${scale.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(scale.text)}</text>`)
  parts.push(`<g id="${uid}-axis-labels" font-size="${FONT_SIZE}" fill="currentColor">`)
  for (const a of axes) {
    parts.push(`<text id="${uid}-axis-${a.id}-label" x="${a.label.x}" y="${a.label.y}" text-anchor="${a.label.anchor}">${esc(a.label.text)}</text>`)
  }
  parts.push('</g>')
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
/** Distance from a point to the nearest point of an axis-aligned box. */
function distToBox(x, y, b) {
  const dx = Math.max(b.left - x, 0, x - b.right)
  const dy = Math.max(b.top - y, 0, y - b.bottom)
  return Math.hypot(dx, dy)
}

export function verify(layoutResult, ir, { svg } = {}) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  warnRow(1, 'axis-count', 'budget:axes', `${ir.axes.length} axes`)
  warnRow(2, 'series-count', 'budget:series', `${ir.series.length} series`)
  warnRow(3, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`)

  // #4 values within 0..max
  const outOfRange = []
  ir.series.forEach((s, i) => {
    for (const a of ir.axes) {
      const v = s.values[a.id]
      if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= ir.max)) outOfRange.push(`series[${i}].values.${a.id}=${v}`)
    }
  })
  rows.push({
    id: 4, name: 'values-in-range', severity: 'fail', ok: outOfRange.length === 0,
    detail: outOfRange.length ? `outside 0..${ir.max}: ${outOfRange.slice(0, 6).join(', ')}` : `every value lies within 0..${ir.max}`,
    hint: outOfRange.length ? `normalize every value to 0..${ir.max} (or raise max) before drawing` : undefined,
  })

  // #5 axis labels clear of each other and of the outer ring
  const problems = []
  const labels = geo.axes.map((a) => ({ id: a.id, box: a.label.box }))
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (overlaps(labels[i].box, labels[j].box)) problems.push(`"${labels[i].id}" overlaps "${labels[j].id}"`)
    }
    const d = distToBox(geo.cx, geo.cy, labels[i].box)
    if (d < geo.radius + RING_CLEAR) problems.push(`"${labels[i].id}" is ${round1(d - geo.radius)}px from the outer ring (need ≥ ${RING_CLEAR})`)
  }
  rows.push({
    id: 5, name: 'labels-clear', severity: 'fail', ok: problems.length === 0,
    detail: problems.length ? problems.slice(0, 6).join('; ') : 'axis labels sit outside the rings and clear of each other',
    hint: problems.length ? 'shorten the axis labels (≤ 12 chars) or reduce the axis count' : undefined,
  })

  // #6 polygons closed with N vertices — in the geometry and in the svg
  const n = ir.axes.length
  const uid = `wu-d-${ir.id}`
  const polyProblems = []
  for (const s of geo.series) {
    if (!Array.isArray(s.points) || s.points.length !== n) polyProblems.push(`series "${s.id}" has ${s.points?.length ?? 0} vertices, expected ${n}`)
    if (svg !== undefined) {
      const m = new RegExp(`<polygon id="${uid}-series-${s.id}" points="([^"]*)"`).exec(svg)
      const pairs = m ? m[1].trim().split(/\s+/).length / 2 : 0
      if (!m) polyProblems.push(`series "${s.id}" is not drawn as a <polygon>`)
      else if (pairs !== n) polyProblems.push(`series "${s.id}" polygon has ${pairs} points in the svg, expected ${n}`)
    }
  }
  rows.push({
    id: 6, name: 'polygons-closed', severity: 'fail', ok: polyProblems.length === 0,
    detail: polyProblems.length ? polyProblems.join('; ') : `every series is a closed <polygon> with ${n} vertices`,
    hint: polyProblems.length ? 'every series must carry one value per axis and be drawn as a single closed polygon' : undefined,
  })

  // #7 series distinguishable without colour
  const seen = new Map()
  const dupes = []
  for (const s of geo.series) {
    const key = s.dash || 'solid'
    if (seen.has(key)) dupes.push(`"${seen.get(key)}" and "${s.id}" both use ${key === 'solid' ? 'a solid stroke' : `dash "${key}"`}`)
    else seen.set(key, s.id)
  }
  rows.push({
    id: 7, name: 'series-distinct', severity: 'fail', ok: dupes.length === 0,
    detail: dupes.length ? dupes.join('; ') : 'every series has its own stroke pattern (solid / dashed / dotted)',
    hint: dupes.length ? `give each series a distinct stroke pattern — at most ${DASHES.length} series per radar (guidance ≤ ${limits.maxSeries})` : undefined,
  })
  return rows
}

// --- doc -------------------------------------------------------------------

export const doc = {
  purpose: 'a few options scored on several criteria (capability matrix, alternative comparison)',
  whenToUse: 'when 1–3 options must be compared on 3–8 quantified criteria at a glance; if the criteria are qualitative, or there are more series, use a table. Budgets: axes ≤ 8, series ≤ 3, label ≤ 12 chars — guidance, over-budget figures still render with data-warn.',
  irExample: `id: queue-choice
type: radar
title: キュー基盤の比較
caption: 各基準を 0〜1 に正規化して採点
axes:
  - id: throughput
    label: スループット
  - id: latency
    label: 遅延
  - id: ops
    label: 運用の手間
  - id: cost
    label: コスト
  - id: ecosystem
    label: エコシステム
series:
  - id: kafka
    label: Kafka
    emphasis: true
    values:
      throughput: 1
      latency: 0.6
      ops: 0.3
      cost: 0.4
      ecosystem: 0.9
  - id: sqs
    label: SQS
    values:
      throughput: 0.5
      latency: 0.5
      ops: 0.9
      cost: 0.8
      ecosystem: 0.6
`,
  rows: ['axis-count', 'series-count', 'label-length', 'values-in-range', 'labels-clear', 'polygons-closed', 'series-distinct'],
}
