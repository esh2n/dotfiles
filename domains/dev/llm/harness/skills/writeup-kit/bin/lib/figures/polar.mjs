// `type: polar` — a polar chart: N categories around one circle, each a
// lollipop (a line from the centre plus a fixed-size end dot) whose length
// is its value, over 5 concentric rings with a spoke per category. For one
// quantity whose category order is cyclic (hour of day, weekday, month,
// compass sector): the reader sees at once where on the cycle the load sits.
// Follows the diagram-design survey's "Polar chart" grammar: one series
// only, radius = value from a fixed 0, no filled wedges, input order kept.
//
// IR shape: `{ id, type:'polar', title, caption?, unit?, min?, max?, start_angle?, clockwise?, categories, series }`.
//   categories:  [{ id, label, focal? }]        3+ (4–8 is the budget), drawn in input order; focal ≤ 1
//   unit:        string shown on the outer-ring scale hint ("件", "ms")
//   min:         fixed at 0 (any other value is a schema error — a polar radius has no offset)
//   max:         number > 0, the outer ring's value   default: a nice ceiling above the largest value
//   start_angle: degrees clockwise from the top for the first category, default 0
//   clockwise:   boolean, default true
//   series:      [{ id, label, values: { <catId>: number } }]   exactly 1 (several series → radar)
// Every category must have a value — a missing value is a schema error
// asking the writer to supply it, never a silent 0. A value of 0 draws no
// lollipop. Values outside 0..max are a verify `fail` row (the lollipop
// would leave the rings), so the author sees the offending category rather
// than a clipped figure.
//
// The one series has no colour to carry: the focal category (if any) is
// the one filled dot with a heavier line, every other dot is open. The
// legend at the bottom is the shared wrapper's (`legend` in layout()).
//
// Geometry and the 4px grid: the centre, the label anchors, the legend and
// the canvas are on the grid (shared row `grid-4px` reads the `x`/`y`/`cx`/
// `cy` keys). Points on the rings — spoke ends, lollipop tips — are
// polar-derived and cannot sit on a 4px grid without the lollipop visibly
// missing its spoke, so they are stored as `px`/`py` (rounded to 0.1) and
// are the plugin's own rule, not the shared row's.
import { IrError, isObj, requireStr, optStr, normalizeHeader, validateBool, budgetWarning, esc, legendWidth, LEGEND_HEIGHT } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, COLUMN } from '../diagram.mjs'

export const type = 'polar'

export const limits = { minCategories: 4, maxCategories: 8, maxLabelLen: 12, maxFocal: 1 }

const MIN_CATEGORIES = 3     // below this the circle has no shape — schema error
const RINGS = 5
const RADIUS = 160          // outer ring radius at a 720px column
const RADIUS_MIN = 96       // the layout shrinks to this before it lets the dispatcher scale/scroll
const LABEL_GAP = 12        // ring → category label anchor
const RING_CLEAR = 4        // label box must stay this far outside the outer ring
const DOT_R = 4             // the fixed end-dot radius (never encodes the value)
const VALUE_GAP = 14        // lollipop tip → value label centre
const VALUE_MIN_R = 20      // shorter lollipops carry no value label (the number would sit on the centre)
const PAD = 16
const LEGEND_GAP = 12

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const unit = optStr(raw, 'unit', ctx)
  if (raw.min !== undefined && raw.min !== null && raw.min !== 0) {
    throw new IrError(`${ctx}.min is fixed at 0 for a polar chart (got: ${JSON.stringify(raw.min)}) — a radius has no offset; drop min`)
  }
  const categories = normalizeCategories(raw.categories, ctx)
  const series = normalizeSeries(raw.series, categories, ctx)
  const max = normalizeMax(raw.max, series, ctx)
  const start_angle = normalizeStartAngle(raw.start_angle, ctx)
  const clockwise = raw.clockwise === undefined || raw.clockwise === null ? true : validateBool(raw, 'clockwise', ctx)
  return { id, type, title, caption, unit, min: 0, max, start_angle, clockwise, categories, series }
}

function normalizeStartAngle(v, ctx) {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${ctx}.start_angle must be a number of degrees (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeCategories(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.categories must be a non-empty list`)
  if (raw.length < MIN_CATEGORIES) throw new IrError(`${ctx}.categories needs at least ${MIN_CATEGORIES} categories to form a circle (got: ${raw.length})`)
  const seen = new Set()
  return raw.map((c, i) => {
    const cctx = `${ctx}.categories[${i}]`
    if (!isObj(c)) throw new IrError(`${cctx} must be a mapping`)
    const id = requireStr(c, 'id', cctx)
    if (seen.has(id)) throw new IrError(`duplicate category id: "${id}"`)
    seen.add(id)
    // `focal` is the survey's word; `emphasis` is the kit's — accept both, keep `focal`.
    const focal = validateBool(c, 'focal', cctx) || validateBool(c, 'emphasis', cctx)
    return { id, label: requireStr(c, 'label', cctx), focal }
  })
}

/** A "nice" ceiling ({1,1.2,1.5,2,2.5,3,4,5,6,8} × 10^k) at or above `v`;
 * 1 when v ≤ 0. The steps are fine so the longest lollipop nearly reaches
 * the outer ring instead of the whole chart huddling around the centre. */
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
function niceCeil(v) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const r = v / p
  const m = NICE_STEPS.find((step) => r <= step + 1e-9)
  return Math.round(m * p * 1e6) / 1e6
}

function normalizeMax(v, series, ctx) {
  if (v === undefined || v === null) {
    let largest = 0
    for (const s of series) for (const x of Object.values(s.values)) largest = Math.max(largest, x)
    return niceCeil(largest)
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new IrError(`${ctx}.max must be a positive number (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeSeries(raw, categories, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.series must be a list with exactly one series`)
  if (raw.length > 1) throw new IrError(`${ctx}.series must hold exactly one series (got: ${raw.length}) — use radar for several series`)
  return raw.map((s, i) => {
    const sctx = `${ctx}.series[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    const label = requireStr(s, 'label', sctx)
    if (!isObj(s.values)) throw new IrError(`${sctx}.values must be a mapping of category id → number`)
    for (const key of Object.keys(s.values)) {
      if (!categories.some((c) => c.id === key)) throw new IrError(`${sctx}.values references unknown category "${key}"`)
    }
    const values = {}
    for (const c of categories) {
      const v = s.values[c.id]
      if (v === undefined || v === null) throw new IrError(`${sctx}.values is missing category "${c.id}" — supply its value (write 0 explicitly if it is really zero; never omit)`)
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new IrError(`${sctx}.values.${c.id} must be a finite number (got: ${JSON.stringify(v)})`)
      values[c.id] = v
    }
    return { id, label, values }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const n = ir.categories.length
  if (n > limits.maxCategories) {
    out.push(budgetWarning('budget:categories', n, limits.maxCategories,
      `${n} categories (guidance ${limits.minCategories}–${limits.maxCategories})`,
      'merge neighbouring buckets (e.g. 3-hour bands instead of hours), or use a line chart for a finer cycle'))
  } else if (n < limits.minCategories) {
    out.push(budgetWarning('budget:categories', n, limits.minCategories,
      `${n} categories (guidance ${limits.minCategories}–${limits.maxCategories})`,
      'a cycle of 3 reads better as a bar chart — split the buckets finer, or use bar'))
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
  const focal = ir.categories.filter((c) => c.focal).length
  if (focal > limits.maxFocal) {
    out.push(budgetWarning('budget:focal', focal, limits.maxFocal,
      `${focal} focal categories (guidance ≤ ${limits.maxFocal})`,
      'keep focal on the one category the caption is about'))
  }
  return out
}

// --- layout ----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10
const fmt = (v) => String(Number.isInteger(v) ? v : Math.round(v * 100) / 100)
/** Angle of category i of n: start_angle degrees clockwise from straight up, then round the cycle. */
const angleOf = (i, n, ir) => -Math.PI / 2 + (ir.start_angle * Math.PI) / 180 + ((ir.clockwise ? 1 : -1) * i * 2 * Math.PI) / n
/** Polar point (centre-origin) on `radius` at `angle`; 0.1px precision, no -0. */
const polar = (radius, angle) => ({ px: round1(radius * Math.cos(angle)) || 0, py: round1(radius * Math.sin(angle)) || 0 })
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Category label anchor + box in centre-origin coordinates, snapped to the
 * grid. Text is always horizontal; only the anchor follows the angle. */
function labelPlacement(category, angle, radius) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const tip = { x: (radius + LABEL_GAP) * c, y: (radius + LABEL_GAP) * s }
  const anchor = c > 0.1 ? 'start' : c < -0.1 ? 'end' : 'middle'
  // Baseline: above the tip when the category points up, below when it
  // points down, vertically centred on the sides.
  const baseline = s < -0.1 ? tip.y - 4 : s > 0.1 ? tip.y + 13 : tip.y + 4
  const x = snap4(tip.x)
  const y = snap4(baseline)
  const width = Math.ceil(textWidth(category.label, FONT_SIZE))
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  // Box keys are left/top/right/bottom on purpose: x1/y1 are position keys
  // for the shared grid row, and a text-fitted box edge is a size, not a position.
  return { id: category.id, label: category.label, x, y, anchor, box: { left, top: y - 13, right: left + width, bottom: y + 3 } }
}

function extents(radius, ir) {
  const labels = ir.categories.map((c, i) => labelPlacement(c, angleOf(i, ir.categories.length, ir), radius))
  let minX = -radius, maxX = radius, minY = -radius, maxY = radius
  for (const l of labels) {
    minX = Math.min(minX, l.box.left); maxX = Math.max(maxX, l.box.right)
    minY = Math.min(minY, l.box.top); maxY = Math.max(maxY, l.box.bottom)
  }
  return { labels, minX, maxX, minY, maxY }
}

/**
 * Value labels: just beyond the end dot, along the lollipop, when the label
 * stays inside the outer ring — else just inside the dot, over the line
 * (masked), when the lollipop is long enough; lollipops shorter than
 * VALUE_MIN_R carry no label (it would sit on the centre), and a label
 * that would overlap an already placed label (value or scale hint) is
 * dropped — the number is never worth an unreadable figure. Boxes are
 * centre-origin, on the grid.
 */
function placeValueLabels(lollipops, radius, taken) {
  const placed = []
  const boxAt = (text, angle, dist) => {
    const width = Math.ceil(textWidth(text, EDGE_LABEL_SIZE))
    const x = snap4(dist * Math.cos(angle))
    const y = snap4(dist * Math.sin(angle) + 4)
    return { x, y, box: { left: x - width / 2, top: y - 11, right: x + width / 2, bottom: y + 2 } }
  }
  const farthest = (b) => Math.hypot(Math.max(Math.abs(b.left), Math.abs(b.right)), Math.max(Math.abs(b.top), Math.abs(b.bottom)))
  for (const l of lollipops) {
    if (!(l.r >= VALUE_MIN_R)) continue
    const text = fmt(l.value)
    let c = boxAt(text, l.angle, l.r + DOT_R + VALUE_GAP)
    if (farthest(c.box) > radius - 2) {
      const inside = l.r - DOT_R - VALUE_GAP
      if (inside < VALUE_MIN_R) continue
      c = boxAt(text, l.angle, inside)
    }
    if (taken.some((b) => overlaps(b, c.box)) || placed.some((p) => overlaps(p.box, c.box))) continue
    placed.push({ category: l.category, text, x: c.x, y: c.y, box: c.box })
  }
  return placed
}

export async function layout(ir, { column = COLUMN } = {}) {
  const n = ir.categories.length
  // Radius: the default, shrunk in 8px steps (down to RADIUS_MIN) until the
  // rings plus the outside labels fit the column; beyond that the
  // dispatcher's scale/scroll decision takes over.
  let radius = RADIUS
  let ext = extents(radius, ir)
  while (radius > RADIUS_MIN && Math.max(-ext.minX, ext.maxX) * 2 + PAD * 2 > column) {
    radius -= 8
    ext = extents(radius, ir)
  }
  const legendItems = ir.series.map((s) => ({ label: s.label }))
  const half = snapUp4(Math.max(-ext.minX, ext.maxX) + PAD)
  const width = Math.max(half * 2, snapUp4(legendWidth(legendItems)))
  const cx = snap4(width / 2)
  const cy = snapUp4(-ext.minY + PAD)
  const bodyBottom = snapUp4(cy + ext.maxY + PAD)
  const legendY = bodyBottom + LEGEND_GAP
  const height = legendY + LEGEND_HEIGHT

  const rings = Array.from({ length: RINGS }, (_, k) => ({ k: k + 1, r: round1((radius * (k + 1)) / RINGS), value: round1((ir.max * (k + 1)) / RINGS) }))
  const categories = ir.categories.map((c, i) => {
    const angle = angleOf(i, n, ir)
    const l = ext.labels[i]
    return {
      id: c.id,
      focal: c.focal,
      angle: round1((angle * 180) / Math.PI),
      spoke: polar(radius, angle),
      label: { text: c.label, x: cx + l.x, y: cy + l.y, anchor: l.anchor, box: { left: cx + l.box.left, top: cy + l.box.top, right: cx + l.box.right, bottom: cy + l.box.bottom } },
    }
  })
  // The outer ring's value (with unit), just inside the ring to the right
  // of the top — the one scale hint the reader needs (rings are max/5 apart).
  const scaleText = ir.unit ? `${fmt(ir.max)} ${ir.unit}` : fmt(ir.max)
  const scale = { text: scaleText, x: cx + 8, y: snap4(cy - radius + 16) }
  const scaleW = Math.ceil(textWidth(scaleText, EDGE_LABEL_SIZE))
  const scaleBox = { left: scale.x - 2 - cx, top: scale.y - 11 - cy, right: scale.x + scaleW + 2 - cx, bottom: scale.y + 3 - cy }

  const s = ir.series[0]
  const raw = ir.categories.map((c, j) => {
    const v = s.values[c.id]
    const angle = angleOf(j, n, ir)
    const r = round1((radius * v) / ir.max)
    return { category: c.id, value: v, r, angle, focal: c.focal, tip: polar(r, angle) }
  })
  const values = placeValueLabels(raw, radius, [scaleBox])
    .map((p) => ({ category: p.category, text: p.text, x: cx + p.x, y: cy + p.y, box: { left: cx + p.box.left, top: cy + p.box.top, right: cx + p.box.right, bottom: cy + p.box.bottom } }))
  const series = {
    id: s.id,
    label: s.label,
    lollipops: raw.map(({ angle, ...l }) => ({ ...l, angle: round1((angle * 180) / Math.PI) })),
    values,
  }
  return {
    width,
    height,
    geo: { cx, cy, radius, rings, categories, series, scale },
    legend: { y: legendY, items: legendItems },
  }
}

// --- draw ------------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { cx, cy, rings, categories, series, scale } = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push(`<g id="${uid}-rings" fill="none" stroke="var(--wu-rule)" stroke-width="1">`)
  for (const ring of rings) parts.push(`<circle id="${uid}-ring-${ring.k}" cx="${cx}" cy="${cy}" r="${ring.r}"/>`)
  parts.push('</g>')
  parts.push(`<g id="${uid}-spokes" stroke="var(--wu-rule)" stroke-width="1">`)
  for (const c of categories) parts.push(`<line id="${uid}-spoke-${c.id}" x1="${cx}" y1="${cy}" x2="${round1(cx + c.spoke.px)}" y2="${round1(cy + c.spoke.py)}"/>`)
  parts.push('</g>')
  // One lollipop per category with a non-zero value: the line carries the
  // value (length ∝ value), the dot is a fixed size. The focal category is
  // the one filled dot on a heavier line; every other dot is open.
  parts.push(`<g id="${uid}-series-${series.id}" stroke="currentColor" stroke-linecap="round">`)
  for (const l of series.lollipops) {
    if (!(l.r > 0)) continue
    const x2 = round1(cx + l.tip.px)
    const y2 = round1(cy + l.tip.py)
    const sw = l.focal ? 1.5 : 1
    const fill = l.focal ? 'currentColor' : 'var(--wu-surface)'
    parts.push(`<g id="${uid}-lollipop-${l.category}" data-polar-category="${esc(l.category)}" data-polar-value="${l.value}"${l.focal ? ' class="wu-focal"' : ''}>`)
    parts.push(`<line id="${uid}-lollipop-${l.category}-line" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke-width="${sw}"/>`)
    parts.push(`<circle id="${uid}-lollipop-${l.category}-dot" cx="${x2}" cy="${y2}" r="${DOT_R}" fill="${fill}" stroke-width="${sw}"/>`)
    parts.push('</g>')
  }
  parts.push('</g>')
  // Value labels sit inside the rings where a ring or spoke may cross
  // them, so they are drawn over a surface-coloured mask (as sequence does
  // for a label crossing a lifeline) and stay legible.
  if (series.values.length) {
    parts.push(`<g id="${uid}-values" font-size="${EDGE_LABEL_SIZE}" fill="currentColor" text-anchor="middle">`)
    for (const v of series.values) {
      parts.push(`<rect x="${v.box.left - 2}" y="${v.box.top}" width="${v.box.right - v.box.left + 4}" height="${v.box.bottom - v.box.top}" fill="var(--wu-surface)" stroke="none"/>`)
      parts.push(`<text id="${uid}-value-${v.category}" x="${v.x}" y="${v.y}">${esc(v.text)}</text>`)
    }
    parts.push('</g>')
  }
  const scaleW = Math.ceil(textWidth(scale.text, EDGE_LABEL_SIZE)) + 4
  parts.push(`<rect x="${scale.x - 2}" y="${scale.y - 11}" width="${scaleW}" height="14" fill="var(--wu-surface)" stroke="none"/>`)
  parts.push(`<text id="${uid}-scale" x="${scale.x}" y="${scale.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(scale.text)}</text>`)
  parts.push(`<g id="${uid}-category-labels" font-size="${FONT_SIZE}" fill="currentColor">`)
  for (const c of categories) {
    const weight = c.focal ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-category-${c.id}-label" x="${c.label.x}" y="${c.label.y}" text-anchor="${c.label.anchor}"${weight}>${esc(c.label.text)}</text>`)
  }
  parts.push('</g>')
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

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
  warnRow(1, 'category-count', 'budget:categories', `${ir.categories.length} categories`)
  warnRow(2, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`)
  warnRow(3, 'focal-count', 'budget:focal', `${ir.categories.filter((c) => c.focal).length} focal category`)

  // #4 values within 0..max (min is fixed at 0)
  const outOfRange = []
  for (const c of ir.categories) {
    const v = ir.series[0].values[c.id]
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= ir.max)) outOfRange.push(`series[0].values.${c.id}=${v}`)
  }
  rows.push({
    id: 4, name: 'values-in-range', severity: 'fail', ok: outOfRange.length === 0,
    detail: outOfRange.length ? `outside 0..${ir.max}: ${outOfRange.slice(0, 6).join(', ')}` : `every value lies within 0..${ir.max}`,
    hint: outOfRange.length ? `keep every value within 0..${ir.max} (or raise max) before drawing — a polar radius cannot be negative or leave the rings` : undefined,
  })

  // #5 every lollipop length proportional to its value — in the geometry and in the svg
  const uid = `wu-d-${ir.id}`
  const scale = geo.radius / ir.max
  const propProblems = []
  const drawn = geo.series.lollipops.filter((l) => l.r > 0)
  for (const l of geo.series.lollipops) {
    if (Math.abs(l.r - l.value * scale) > 1) propProblems.push(`${l.category}: length ${l.r} ≠ ${l.value} × ${round1(scale)}`)
    if (Math.abs(Math.hypot(l.tip.px, l.tip.py) - l.r) > 1) propProblems.push(`${l.category}: tip is ${round1(Math.hypot(l.tip.px, l.tip.py))}px from the centre, length is ${l.r}`)
  }
  if (svg !== undefined) {
    let seen = 0
    const re = /<g id="([^"]+)" data-polar-category="([^"]+)" data-polar-value="([^"]+)"[^>]*><line [^>]*x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g
    for (const m of svg.matchAll(re)) {
      seen++
      const v = parseFloat(m[3])
      const len = Math.hypot(parseFloat(m[6]) - parseFloat(m[4]), parseFloat(m[7]) - parseFloat(m[5]))
      if (!(Math.abs(len - v * scale) <= 1)) propProblems.push(`svg ${m[1]}: drawn ${round1(len)}px for value ${v} (expected ${round1(v * scale)})`)
      if (!drawn.some((l) => l.category === m[2])) propProblems.push(`svg ${m[1]}: data-polar-category "${m[2]}" is not a drawn category`)
    }
    if (seen !== drawn.length) propProblems.push(`${seen} data-polar-value lollipop(s) in the svg, expected ${drawn.length}`)
    const dots = [...svg.matchAll(/<circle id="[^"]+-lollipop-[^"]+-dot"[^>]*\sr="([^"]+)"/g)].map((m) => parseFloat(m[1]))
    if (dots.some((r) => r !== DOT_R)) propProblems.push(`end dots must all be r=${DOT_R} (the dot never encodes the value)`)
  }
  rows.push({
    id: 5, name: 'lollipops-proportional', severity: 'fail', ok: propProblems.length === 0,
    detail: propProblems.length ? propProblems.slice(0, 6).join('; ') : `every lollipop is value × ${round1(scale)}px long within 1px, end dots fixed at r=${DOT_R} (${drawn.length} drawn, ${geo.series.lollipops.length - drawn.length} zero)`,
    hint: propProblems.length ? 'lollipop length must be value / max × outer radius — read data-polar-value back and compare' : undefined,
  })

  // #6 category labels clear of each other and of the outer ring; value labels clear of them
  const problems = []
  const labels = geo.categories.map((c) => ({ id: c.id, box: c.label.box }))
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (overlaps(labels[i].box, labels[j].box)) problems.push(`"${labels[i].id}" overlaps "${labels[j].id}"`)
    }
    const d = distToBox(geo.cx, geo.cy, labels[i].box)
    if (d < geo.radius + RING_CLEAR) problems.push(`"${labels[i].id}" is ${round1(d - geo.radius)}px from the outer ring (need ≥ ${RING_CLEAR})`)
  }
  const values = geo.series.values
  for (let i = 0; i < values.length; i++) {
    for (const l of labels) if (overlaps(values[i].box, l.box)) problems.push(`value ${values[i].category} overlaps label "${l.id}"`)
    for (let j = i + 1; j < values.length; j++) if (overlaps(values[i].box, values[j].box)) problems.push(`value ${values[i].category} overlaps value ${values[j].category}`)
  }
  rows.push({
    id: 6, name: 'labels-clear', severity: 'fail', ok: problems.length === 0,
    detail: problems.length ? problems.slice(0, 6).join('; ') : `category labels sit outside the rings and clear of each other; ${values.length} value label(s) clear`,
    hint: problems.length ? 'shorten the category labels (≤ 12 chars) or reduce the category count' : undefined,
  })

  // #7 exactly one series, drawn as one lollipop group — several series belong in a radar
  const seriesProblems = []
  if (ir.series.length !== 1) seriesProblems.push(`${ir.series.length} series in the IR`)
  if (svg !== undefined) {
    const groups = [...svg.matchAll(new RegExp(`<g id="${uid}-series-([^"]+)"`, 'g'))].map((m) => m[1])
    if (groups.length !== 1) seriesProblems.push(`${groups.length} series group(s) in the svg [${groups.join(', ')}]`)
    else if (groups[0] !== geo.series.id) seriesProblems.push(`svg series group "${groups[0]}" is not the geometry's "${geo.series.id}"`)
  }
  rows.push({
    id: 7, name: 'single-series', severity: 'fail', ok: seriesProblems.length === 0,
    detail: seriesProblems.length ? seriesProblems.join('; ') : `one series ("${geo.series.id}") drawn as one lollipop group`,
    hint: seriesProblems.length ? 'a polar chart carries exactly one series — use radar for several series' : undefined,
  })
  return rows
}

// --- doc -------------------------------------------------------------------

export const doc = {
  purpose: 'one quantity per category around a cycle (hour of day, weekday, month, compass sector)',
  whenToUse: 'when the category order is cyclic and the reader should see where on the cycle the load sits; for several series use radar, for a non-cyclic order use bar, for more than 8 buckets use line. One series, radius = value from 0, lollipops (no filled wedges). Budgets: categories 4–8, label ≤ 12 chars, focal ≤ 1 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: inquiry-hours
type: polar
title: 時間帯別の問い合わせ件数
caption: 3 時間ごとの 1 日平均、外周が 40 件
unit: 件
max: 40
categories:
  - id: h00
    label: 0–3 時
  - id: h03
    label: 3–6 時
  - id: h06
    label: 6–9 時
  - id: h09
    label: 9–12 時
  - id: h12
    label: 12–15 時
  - id: h15
    label: 15–18 時
    focal: true
  - id: h18
    label: 18–21 時
  - id: h21
    label: 21–24 時
series:
  - id: avg
    label: 1 日平均
    values:
      h00: 2
      h03: 1
      h06: 6
      h09: 31
      h12: 22
      h15: 36
      h18: 14
      h21: 5
`,
  rows: ['category-count', 'label-length', 'focal-count', 'values-in-range', 'lollipops-proportional', 'labels-clear', 'single-series'],
}
