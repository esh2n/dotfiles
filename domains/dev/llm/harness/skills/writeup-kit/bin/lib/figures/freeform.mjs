// `type: freeform` — the escape hatch for a figure no parametric type
// covers. Instead of raw SVG text, the writer authors a small, verifiable
// vocabulary of elements on a canvas of their own size: `box`, `text`,
// `line`, `circle`, `region`. Coordinates are the writer's (that is the
// point of freeform); the plugin draws them with kit tokens only and
// then verifies what a hand-drawn figure most often gets wrong — an
// element off the canvas, two texts on top of each other, a label across
// a border, a line through a box it does not connect, coordinates off the
// 4px grid. A figure that fails any of these never ships as
// `data-checks="pass"`.
//
// IR shape: `{ id, type:'freeform', title, caption?, preset?: 'wardley',
// width, height, elements: [
//   { kind:'box',    id, x, y, w, h, label, tone?, emphasis?, dashed? },
//   { kind:'text',   id, x, y, text, size?: 'small'|'normal', anchor?: 'start'|'middle'|'end' },
//   { kind:'line',   id, points: [[x, y], …], arrow?, dashed?, label? },
//   { kind:'circle', id, cx, cy, r, label? },
//   { kind:'region', id, x, y, w, h, label },
// ] }`. Box/region `(x, y)` is the top-left corner; text `(x, y)` is the
// top of the 16px text row at the anchor point; a circle label sits to
// the right of the circle; a line label sits beside its middle segment.
//
// `preset: wardley` adds the two Wardley axes — x = evolution (genesis /
// custom / product / commodity, four bands, never numbers), y =
// visibility (value chain, visible at the top) — and requires every box
// and circle to lie inside the plot the axes frame. Both axis titles are
// plain horizontal words with a short arrowhead line beside them for the
// direction (no rotated text, no arrow characters — the kit's self-check
// flags both). Positions are still authored: a Wardley map's positions are
// the analyst's judgement, which no layout engine can derive. The survey's
// wardley budgets (§2 row 32) apply under the preset: components (boxes +
// circles) ≤ 9, links (lines) ≤ 12, and no isolated component — a node no
// line starts or ends at is warned about as `wardley:isolated`.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, snap4, snapUp4, textWidth } from '../diagram.mjs'

export const type = 'freeform'

/** maxComponents / maxLinks apply under `preset: wardley` only (survey §2 row 32). */
export const limits = { maxElements: 24, maxLabelLen: 20, maxEmphasis: 2, maxComponents: 9, maxLinks: 12 }

// --- metrics ------------------------------------------------------------------

const TEXT_H = 16              // one text row (13px or 11px text) on the grid
const TEXT_PAD = 4             // halo padding either side of a text
const BASELINE = 12            // text top → baseline
const REGION_INSET = 8         // region edge → region label
const CIRCLE_LABEL_GAP = 6     // circle edge → label
const LINE_LABEL_GAP = 4       // line → label box
const ENDPOINT_TOL = 2         // a line endpoint this close to a node "belongs" to it
const GRID = 4

const PRESETS = new Set(['wardley'])
const KINDS = new Set(['box', 'text', 'line', 'circle', 'region'])
const SIZES = new Set(['small', 'normal'])
const ANCHORS = new Set(['start', 'middle', 'end'])

// Wardley preset: the plot the axes frame, in canvas coordinates
const W_LEFT = 32              // y axis band
const W_TOP = 24               // "visibility" title row (4..20) + gap, above the plot
const W_RIGHT = 8
const W_BOTTOM = 36            // tick labels + "evolution" title row
const W_ARROW = 16             // length of the direction arrow beside each axis title
const W_BANDS = ['genesis', 'custom', 'product', 'commodity']
const W_X_TITLE = 'evolution'
const W_Y_TITLE = 'visibility'

// --- schema -------------------------------------------------------------------

function requireNum(obj, field, ctx, { positive = false } = {}) {
  const v = obj[field]
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive && v <= 0)) {
    throw new IrError(`${ctx}.${field} must be a ${positive ? 'positive ' : ''}finite number (got: ${JSON.stringify(v)})`)
  }
  return v
}

function requireEnum(obj, field, allowed, fallback, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'string' || !allowed.has(v)) {
    throw new IrError(`${ctx}.${field} must be ${[...allowed].join('|')} (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizePoints(raw, ctx) {
  if (!Array.isArray(raw) || raw.length < 2) throw new IrError(`${ctx}.points must be a list of at least 2 [x, y] pairs`)
  return raw.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new IrError(`${ctx}.points[${i}] must be an [x, y] pair of finite numbers (got: ${JSON.stringify(p)})`)
    }
    return [p[0], p[1]]
  })
}

function normalizeElement(raw, i, ctx, seen) {
  const ectx = `${ctx}.elements[${i}]`
  if (!isObj(raw)) throw new IrError(`${ectx} must be a mapping`)
  const kind = raw.kind
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    throw new IrError(`${ectx}.kind must be ${[...KINDS].join('|')} (got: ${JSON.stringify(kind)})`)
  }
  const id = requireStr(raw, 'id', ectx)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new IrError(`${ectx}.id must match [A-Za-z0-9][A-Za-z0-9_-]* (got: ${JSON.stringify(id)})`)
  if (seen.has(id)) throw new IrError(`duplicate element id: "${id}"`)
  seen.add(id)
  switch (kind) {
    case 'box': {
      const out = {
        kind, id,
        x: requireNum(raw, 'x', ectx), y: requireNum(raw, 'y', ectx),
        w: requireNum(raw, 'w', ectx, { positive: true }), h: requireNum(raw, 'h', ectx, { positive: true }),
        label: requireStr(raw, 'label', ectx),
        tone: validateTone(raw.tone, ectx),
        emphasis: validateBool(raw, 'emphasis', ectx),
        dashed: validateBool(raw, 'dashed', ectx),
      }
      return out
    }
    case 'text':
      return {
        kind, id,
        x: requireNum(raw, 'x', ectx), y: requireNum(raw, 'y', ectx),
        text: requireStr(raw, 'text', ectx),
        size: requireEnum(raw, 'size', SIZES, 'normal', ectx),
        anchor: requireEnum(raw, 'anchor', ANCHORS, 'start', ectx),
      }
    case 'line': {
      const out = {
        kind, id,
        points: normalizePoints(raw.points, ectx),
        arrow: validateBool(raw, 'arrow', ectx),
        dashed: validateBool(raw, 'dashed', ectx),
      }
      const label = optStr(raw, 'label', ectx)
      if (label !== undefined) out.label = label
      return out
    }
    case 'circle': {
      const out = {
        kind, id,
        cx: requireNum(raw, 'cx', ectx), cy: requireNum(raw, 'cy', ectx),
        r: requireNum(raw, 'r', ectx, { positive: true }),
      }
      const label = optStr(raw, 'label', ectx)
      if (label !== undefined) out.label = label
      return out
    }
    case 'region':
      return {
        kind, id,
        x: requireNum(raw, 'x', ectx), y: requireNum(raw, 'y', ectx),
        w: requireNum(raw, 'w', ectx, { positive: true }), h: requireNum(raw, 'h', ectx, { positive: true }),
        label: requireStr(raw, 'label', ectx),
      }
    default:
      throw new IrError(`${ectx}.kind is unsupported`)
  }
}

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const preset = raw.preset === undefined || raw.preset === null ? undefined : raw.preset
  if (preset !== undefined && (typeof preset !== 'string' || !PRESETS.has(preset))) {
    throw new IrError(`${ctx}.preset must be ${[...PRESETS].join('|')} or null (got: ${JSON.stringify(raw.preset)})`)
  }
  const width = requireNum(raw, 'width', ctx, { positive: true })
  const height = requireNum(raw, 'height', ctx, { positive: true })
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) throw new IrError(`${ctx}.elements must be a non-empty list`)
  const seen = new Set()
  const elements = raw.elements.map((e, i) => normalizeElement(e, i, ctx, seen))
  const ir = { id, type, title }
  if (caption !== undefined) ir.caption = caption
  if (preset !== undefined) ir.preset = preset
  ir.width = width
  ir.height = height
  ir.elements = elements
  return ir
}

// --- budgets ------------------------------------------------------------------

/** Every authored string a reader sees, with the element it belongs to. */
function labelsOf(ir) {
  const out = []
  for (const e of ir.elements) {
    if (e.kind === 'text') out.push({ id: e.id, text: e.text })
    else if (e.label !== undefined) out.push({ id: e.id, text: e.label })
  }
  return out
}

export function budgetWarnings(ir) {
  const out = []
  const n = ir.elements.length
  if (n > limits.maxElements) {
    out.push(budgetWarning('budget:elements', n, limits.maxElements,
      `${n} element(s) (guidance ≤ ${limits.maxElements})`,
      'a freeform figure with more than 24 elements is a diagram in disguise — split it, or check --list-types for a parametric type'))
  }
  const long = labelsOf(ir).filter((l) => [...l.text].length > limits.maxLabelLen)
  if (long.length) {
    const longest = long.reduce((m, l) => ([...l.text].length > [...m.text].length ? l : m), long[0])
    out.push(budgetWarning('budget:label', [...longest.text].length, limits.maxLabelLen,
      `${long.length} label(s) longer than ${limits.maxLabelLen} chars (longest: "${longest.text}" on ${longest.id})`,
      `shorten "${longest.text}" to ≤ ${limits.maxLabelLen} chars; put the detail in the caption`))
  }
  const focal = ir.elements.filter((e) => e.kind === 'box' && e.emphasis).length
  if (focal > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', focal, limits.maxEmphasis,
      `${focal} emphasized box(es) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis for the one or two elements the caption is about — more than two accents is no emphasis'))
  }
  if (ir.preset === 'wardley') out.push(...wardleyWarnings(ir))
  return out
}

/** The bounding box of a box or circle straight from the IR (budgets run
 * before layout). */
const irNodeBox = (e) => (e.kind === 'circle'
  ? { x: e.cx - e.r, y: e.cy - e.r, width: e.r * 2, height: e.r * 2 }
  : { x: e.x, y: e.y, width: e.w, height: e.h })

/** Survey §2 row 32 under `preset: wardley`: components ≤ 9, links ≤ 12,
 * and every component connected — an isolated node says nothing about
 * the value chain and is deleted, not drawn. */
function wardleyWarnings(ir) {
  const out = []
  const nodes = ir.elements.filter((e) => e.kind === 'box' || e.kind === 'circle')
  const links = ir.elements.filter((e) => e.kind === 'line')
  if (nodes.length > limits.maxComponents) {
    out.push(budgetWarning('budget:components', nodes.length, limits.maxComponents,
      `${nodes.length} wardley components (guidance ≤ ${limits.maxComponents})`,
      `keep the ${limits.maxComponents} components the decision turns on; fold the rest into their parent or a second map`))
  }
  if (links.length > limits.maxLinks) {
    out.push(budgetWarning('budget:links', links.length, limits.maxLinks,
      `${links.length} wardley links (guidance ≤ ${limits.maxLinks})`,
      `draw only the dependencies the caption reads along (≤ ${limits.maxLinks}); a fully wired map hides the chain`))
  }
  const ends = links.flatMap((l) => [l.points[0], l.points[l.points.length - 1]].map(([x, y]) => ({ x, y })))
  const isolated = nodes.filter((n) => !ends.some((p) => nearNode(p, { kind: n.kind, ...irNodeBox(n), r: n.r, cx: n.cx, cy: n.cy })))
  if (isolated.length) {
    out.push(budgetWarning('wardley:isolated', isolated.length, 0,
      `${isolated.length} isolated component(s): ${isolated.map((n) => n.id).join(', ')} (no line starts or ends there)`,
      'connect the component into the value chain with a line, or delete it — an isolated component is not part of the map'))
  }
  return out
}

// --- geometry helpers -----------------------------------------------------------

const right = (b) => b.x + b.width
const bottom = (b) => b.y + b.height
const intersects = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer)

/** A snapped collision box for one text row anchored at (ax, top). */
function textBox(ax, top, text, size, anchor, bold = false) {
  const width = snapUp4(textWidth(text, size) * (bold ? BOLD_FACTOR : 1) + TEXT_PAD * 2)
  const x = anchor === 'middle' ? snap4(ax - width / 2) : anchor === 'end' ? snap4(ax - width) : snap4(ax)
  return { x, y: snap4(top), width, height: TEXT_H }
}

/** The bounding box of an element (its shape only, labels excluded). */
function shapeBox(e) {
  if (e.kind === 'circle') return { x: e.cx - e.r, y: e.cy - e.r, width: e.r * 2, height: e.r * 2 }
  if (e.kind === 'line') {
    const xs = e.points.map((p) => p.x)
    const ys = e.points.map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  if (e.kind === 'text') return e.box
  return { x: e.x, y: e.y, width: e.width, height: e.height }
}

/** Whether segment p→q crosses the interior of `rect` (touching the border
 * does not count: the rect is inset by 1px before the Liang–Barsky clip). */
function segmentCrosses(p, q, rect) {
  const x0 = rect.x + 1
  const y0 = rect.y + 1
  const x1 = right(rect) - 1
  const y1 = bottom(rect) - 1
  if (x1 <= x0 || y1 <= y0) return false
  const dx = q.x - p.x
  const dy = q.y - p.y
  let t0 = 0
  let t1 = 1
  const clip = (den, num) => {
    if (den === 0) return num >= 0
    const t = num / den
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
    return true
  }
  if (!clip(-dx, p.x - x0) || !clip(dx, x1 - p.x) || !clip(-dy, p.y - y0) || !clip(dy, y1 - p.y)) return false
  return t1 - t0 > 1e-9
}

const nearNode = (pt, node) => {
  const b = shapeBox(node)
  return pt.x >= b.x - ENDPOINT_TOL && pt.x <= right(b) + ENDPOINT_TOL && pt.y >= b.y - ENDPOINT_TOL && pt.y <= bottom(b) + ENDPOINT_TOL
}

// --- layout ---------------------------------------------------------------------

function wardleyGeometry(width, height) {
  const plotW = Math.floor((width - W_LEFT - W_RIGHT) / 16) * 16
  const plot = { x: W_LEFT, y: W_TOP, width: plotW, height: height - W_TOP - W_BOTTOM }
  const band = plotW / 4
  const axisY = bottom(plot)
  const texts = []
  W_BANDS.forEach((name, i) => {
    const cx = plot.x + band * i + band / 2
    texts.push({ owner: 'preset', role: `tick-${name}`, text: name, size: EDGE_LABEL_SIZE, anchor: 'middle', ax: snap4(cx), ...textBox(cx, axisY + 4, name, EDGE_LABEL_SIZE, 'middle') })
  })
  // axis titles: plain horizontal words, each with a short arrowhead line
  // beside it giving the direction (never rotated, never an arrow glyph)
  const xRowTop = axisY + 20
  const xArrow = { x1: right(plot) - W_ARROW, y1: xRowTop + TEXT_H / 2, x2: right(plot), y2: xRowTop + TEXT_H / 2 }
  const xAx = xArrow.x1 - TEXT_PAD
  texts.push({ owner: 'preset', role: 'x-title', text: W_X_TITLE, size: EDGE_LABEL_SIZE, anchor: 'end', ax: xAx, ...textBox(xAx, xRowTop, W_X_TITLE, EDGE_LABEL_SIZE, 'end') })
  const yRowTop = W_TOP - TEXT_H - 4
  const yArrow = { x1: plot.x, y1: yRowTop + TEXT_H, x2: plot.x, y2: yRowTop }
  const yAx = plot.x + TEXT_PAD * 2
  texts.push({ owner: 'preset', role: 'y-title', text: W_Y_TITLE, size: EDGE_LABEL_SIZE, anchor: 'start', ax: yAx, ...textBox(yAx, yRowTop, W_Y_TITLE, EDGE_LABEL_SIZE, 'start') })
  const dividers = [1, 2, 3].map((i) => ({ x: plot.x + band * i, y1: plot.y, y2: axisY }))
  return { plot, axes: { x: { x1: plot.x, x2: right(plot), y: axisY }, y: { x: plot.x, y1: plot.y, y2: axisY } }, arrows: { x: xArrow, y: yArrow }, dividers, texts }
}

export async function layout(ir) {
  const width = ir.width
  const height = ir.height
  const texts = []
  const elements = ir.elements.map((e) => {
    switch (e.kind) {
      case 'box': {
        const labelBox = textBox(e.x + e.w / 2, e.y + e.h / 2 - TEXT_H / 2, e.label, FONT_SIZE, 'middle', e.emphasis)
        texts.push({ owner: e.id, role: 'label', text: e.label, ...labelBox })
        return { kind: e.kind, id: e.id, x: e.x, y: e.y, width: e.w, height: e.h, label: e.label, tone: e.tone, emphasis: e.emphasis, dashed: e.dashed, labelBox }
      }
      case 'region': {
        const labelBox = textBox(e.x + REGION_INSET, e.y + REGION_INSET, e.label, EDGE_LABEL_SIZE, 'start')
        texts.push({ owner: e.id, role: 'label', text: e.label, ...labelBox })
        return { kind: e.kind, id: e.id, x: e.x, y: e.y, width: e.w, height: e.h, label: e.label, labelBox }
      }
      case 'text': {
        const size = e.size === 'small' ? EDGE_LABEL_SIZE : FONT_SIZE
        const box = textBox(e.x, e.y, e.text, size, e.anchor)
        texts.push({ owner: e.id, role: 'text', text: e.text, ...box })
        return { kind: e.kind, id: e.id, x: e.x, y: e.y, text: e.text, size, anchor: e.anchor, box }
      }
      case 'circle': {
        const out = { kind: e.kind, id: e.id, cx: e.cx, cy: e.cy, r: e.r }
        if (e.label !== undefined) {
          out.label = e.label
          out.labelBox = textBox(e.cx + e.r + CIRCLE_LABEL_GAP, e.cy - TEXT_H / 2, e.label, FONT_SIZE, 'start')
          texts.push({ owner: e.id, role: 'label', text: e.label, ...out.labelBox })
        }
        return out
      }
      case 'line': {
        const points = e.points.map(([x, y]) => ({ x, y }))
        const out = { kind: e.kind, id: e.id, points, arrow: e.arrow, dashed: e.dashed }
        if (e.label !== undefined) {
          const i = Math.floor((points.length - 1) / 2)
          const p = points[i]
          const q = points[i + 1]
          const mx = (p.x + q.x) / 2
          const my = (p.y + q.y) / 2
          const horizontal = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)
          out.label = e.label
          out.labelBox = horizontal
            ? { ...textBox(mx, my - LINE_LABEL_GAP - TEXT_H, e.label, EDGE_LABEL_SIZE, 'middle'), anchor: 'middle' }
            : { ...textBox(mx + LINE_LABEL_GAP, my - TEXT_H / 2, e.label, EDGE_LABEL_SIZE, 'start'), anchor: 'start' }
          texts.push({ owner: e.id, role: 'label', text: e.label, ...out.labelBox })
        }
        return out
      }
      default:
        throw new Error(`freeform: unknown element kind ${e.kind}`)
    }
  })
  const geo = { canvas: { width, height }, elements, texts }
  if (ir.preset === 'wardley') {
    const w = wardleyGeometry(width, height)
    geo.preset = { name: 'wardley', plot: w.plot, axes: w.axes, arrows: w.arrows, dividers: w.dividers }
    geo.texts.push(...w.texts)
  }
  return { width, height, geo }
}

// --- draw -------------------------------------------------------------------------

function drawPreset(uid, preset) {
  const { plot, axes, arrows, dividers } = preset
  const parts = []
  for (const [i, d] of dividers.entries()) {
    parts.push(`<line id="${uid}-band-${i}" x1="${d.x}" y1="${d.y1}" x2="${d.x}" y2="${d.y2}" stroke="var(--wu-rule)" stroke-width="1" stroke-dasharray="2 4"/>`)
  }
  parts.push(`<line id="${uid}-axis-x" x1="${axes.x.x1}" y1="${axes.x.y}" x2="${axes.x.x2}" y2="${axes.x.y}" stroke="currentColor" stroke-width="1"/>`)
  parts.push(`<line id="${uid}-axis-y" x1="${axes.y.x}" y1="${axes.y.y1}" x2="${axes.y.x}" y2="${axes.y.y2}" stroke="currentColor" stroke-width="1"/>`)
  // the direction of each axis: a short muted line with a real arrowhead beside the title word
  for (const axis of ['x', 'y']) {
    const a = arrows[axis]
    parts.push(`<line id="${uid}-arrow-${axis}" x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="var(--wu-ink-3)" stroke-width="1" marker-end="url(#${uid}-muted)"/>`)
  }
  return parts.join('')
}

function drawPresetTexts(uid, texts) {
  const parts = []
  for (const t of texts) {
    if (t.owner !== 'preset') continue
    parts.push(`<text id="${uid}-${t.role}" x="${t.ax}" y="${t.y + BASELINE}" font-size="${t.size}" text-anchor="${t.anchor}" fill="var(--wu-ink-3)">${esc(t.text)}</text>`)
  }
  return parts.join('')
}

export function draw(geo, ir) {
  const uid = `wu-d-${ir.id}`
  const { elements, texts, preset } = geo.geo
  const parts = ['<defs>',
    `<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`,
    ...(preset ? [`<marker id="${uid}-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--wu-ink-3)"/></marker>`] : []),
    '</defs>']
  if (preset) parts.push(drawPreset(uid, preset))
  const byKind = (k) => elements.filter((e) => e.kind === k)
  // z-order: regions (background zones) → lines (before nodes) → boxes →
  // circles → free text → line labels with their halo
  for (const r of byKind('region')) {
    parts.push(`<rect id="${uid}-${r.id}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="var(--wu-rule-soft)" stroke="var(--wu-rule)" stroke-width="1"/>`)
    parts.push(`<text id="${uid}-${r.id}-label" x="${r.labelBox.x + TEXT_PAD}" y="${r.labelBox.y + BASELINE}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(r.label)}</text>`)
  }
  for (const l of byKind('line')) {
    const d = `M${l.points[0].x} ${l.points[0].y} ${l.points.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`
    const dash = l.dashed ? ' stroke-dasharray="4 3"' : ''
    const marker = l.arrow ? ` marker-end="url(#${uid}-solid)"` : ''
    parts.push(`<path id="${uid}-${l.id}" d="${d}" fill="none" stroke="currentColor" stroke-width="1"${dash}${marker}/>`)
  }
  for (const b of byKind('box')) {
    const cls = b.emphasis ? ' class="wu-focal"' : ''
    const sw = b.emphasis ? 1.5 : 1
    const dash = b.dashed ? ' stroke-dasharray="4 3"' : ''
    const weight = b.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-${b.id}" data-tone="${esc(b.tone)}"${cls} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" fill="var(--wu-surface)" stroke="currentColor" stroke-width="${sw}"${dash}/>`)
    parts.push(`<text id="${uid}-${b.id}-label" x="${b.x + b.width / 2}" y="${b.y + b.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle"${weight} fill="currentColor">${esc(b.label)}</text>`)
  }
  for (const c of byKind('circle')) {
    parts.push(`<circle id="${uid}-${c.id}" cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/>`)
    if (c.labelBox) parts.push(`<text id="${uid}-${c.id}-label" x="${c.labelBox.x + TEXT_PAD}" y="${c.labelBox.y + BASELINE}" font-size="${FONT_SIZE}" fill="currentColor">${esc(c.label)}</text>`)
  }
  for (const t of byKind('text')) {
    parts.push(`<text id="${uid}-${t.id}" x="${t.x}" y="${t.box.y + BASELINE}" font-size="${t.size}" text-anchor="${t.anchor}" fill="currentColor">${esc(t.text)}</text>`)
  }
  for (const l of byKind('line')) {
    if (!l.labelBox) continue
    const b = l.labelBox
    const tx = b.anchor === 'middle' ? b.x + b.width / 2 : b.x + TEXT_PAD
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="var(--wu-surface)" stroke="none"/>`)
    parts.push(`<text id="${uid}-${l.id}-label" x="${tx}" y="${b.y + BASELINE}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${b.anchor}" fill="currentColor">${esc(l.label)}</text>`)
  }
  if (preset) parts.push(drawPresetTexts(uid, texts))
  return parts.join('')
}

// --- verify -----------------------------------------------------------------------

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 6).join('; ') + (problems.length > 6 ? '; …' : ''), hint: ok ? undefined : hint }
}

function warnRow(id, name, budget, key, okDetail) {
  const w = budget.find((b) => b.key === key)
  return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
}

const offGrid = (v) => !Number.isFinite(v) || v % GRID !== 0

export function verify(geo, ir) {
  const { canvas, elements, texts, preset } = geo.geo
  const canvasBox = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const rows = []

  // 1. everything inside the canvas (shapes and their labels)
  const outside = []
  for (const e of elements) {
    if (!contains(canvasBox, shapeBox(e))) outside.push(`${e.id} (${e.kind})`)
  }
  for (const t of texts) {
    if (t.owner !== 'preset' && !contains(canvasBox, t)) outside.push(`${t.owner} ${t.role} "${t.text}"`)
  }
  rows.push(failRow(1, 'in-canvas', outside, `${elements.length} element(s) inside the ${canvas.width}×${canvas.height} canvas`,
    'move the element inside 0..width × 0..height, or enlarge width/height'))

  // 2. no text over another text
  const overlaps = []
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (intersects(texts[i], texts[j])) overlaps.push(`${texts[i].owner} "${texts[i].text}" / ${texts[j].owner} "${texts[j].text}"`)
    }
  }
  rows.push(failRow(2, 'text-no-overlap', overlaps, `${texts.length} text(s), none overlapping`,
    'move the two texts apart (16px rows), shorten one, or widen the canvas'))

  // 3. no text across a border it does not belong to; a label fits its own shape
  const crossing = []
  const frames = elements.filter((e) => e.kind === 'box' || e.kind === 'region')
  for (const t of texts) {
    for (const f of frames) {
      const own = t.owner === f.id
      const inside = contains(f, t)
      if (own && !inside) crossing.push(`${t.owner} label "${t.text}" is wider than its ${f.kind}`)
      else if (!own && intersects(f, t) && !inside) crossing.push(`${t.owner} "${t.text}" crosses the border of ${f.id}`)
    }
  }
  rows.push(failRow(3, 'text-clear-of-borders', crossing, 'no text crosses a box or region border',
    'widen the box, shorten the label, or move the text fully inside or outside the frame'))

  // 4. a line only passes through the nodes it starts or ends at
  const through = []
  const nodes = elements.filter((e) => e.kind === 'box' || e.kind === 'circle')
  for (const l of elements.filter((e) => e.kind === 'line')) {
    const first = l.points[0]
    const last = l.points[l.points.length - 1]
    for (const n of nodes) {
      if (nearNode(first, n) || nearNode(last, n)) continue
      const box = shapeBox(n)
      for (let i = 0; i + 1 < l.points.length; i++) {
        if (segmentCrosses(l.points[i], l.points[i + 1], box)) { through.push(`${l.id} passes through ${n.id}`); break }
      }
    }
  }
  rows.push(failRow(4, 'lines-avoid-nodes', through, 'every line stays clear of the boxes and circles it does not connect',
    'route the line around the node with an extra bend point, or end it at that node'))

  // 5. authored coordinates on the 4px grid (canvas, positions and box sizes; a circle radius is free)
  const off = []
  if (offGrid(canvas.width) || offGrid(canvas.height)) off.push(`canvas ${canvas.width}×${canvas.height}`)
  for (const e of elements) {
    const bad = []
    if (e.kind === 'box' || e.kind === 'region') {
      for (const [k, v] of [['x', e.x], ['y', e.y], ['w', e.width], ['h', e.height]]) if (offGrid(v)) bad.push(`${k}=${v}`)
    } else if (e.kind === 'text') {
      for (const [k, v] of [['x', e.x], ['y', e.y]]) if (offGrid(v)) bad.push(`${k}=${v}`)
    } else if (e.kind === 'circle') {
      for (const [k, v] of [['cx', e.cx], ['cy', e.cy]]) if (offGrid(v)) bad.push(`${k}=${v}`)
    } else if (e.kind === 'line') {
      e.points.forEach((p, i) => { if (offGrid(p.x) || offGrid(p.y)) bad.push(`points[${i}]=[${p.x}, ${p.y}]`) })
    }
    if (bad.length) off.push(`${e.id} ${bad.join(' ')}`)
  }
  rows.push(failRow(5, 'grid-4px-authored', off, 'every authored coordinate and size is a multiple of 4',
    'author x/y/w/h/cx/cy/points and width/height as multiples of 4 (a circle r may be any size)'))

  // 6–8. budgets
  const budget = budgetWarnings(ir)
  rows.push(warnRow(6, 'element-count', budget, 'budget:elements', `${ir.elements.length} element(s)`))
  rows.push(warnRow(7, 'label-length', budget, 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`))
  rows.push(warnRow(8, 'emphasis-count', budget, 'budget:emphasis', `${ir.elements.filter((e) => e.kind === 'box' && e.emphasis).length} emphasized box(es)`))

  // 9. preset: every component inside the plot the axes frame
  const outPlot = []
  if (preset) {
    for (const n of nodes) if (!contains(preset.plot, shapeBox(n))) outPlot.push(`${n.id} (${n.kind})`)
  }
  rows.push(failRow(9, 'preset-in-plot', outPlot,
    preset ? `every box and circle lies inside the ${preset.name} plot (${preset.plot.x}..${right(preset.plot)} × ${preset.plot.y}..${bottom(preset.plot)})` : 'no preset — no plot to check',
    preset ? `keep every box and circle inside x ${preset.plot.x}..${right(preset.plot)}, y ${preset.plot.y}..${bottom(preset.plot)} (the axis bands are reserved)` : undefined))

  // 10–12. wardley budgets (warn; no-ops without the preset)
  const none = preset ? undefined : 'no preset — not a wardley map'
  rows.push(warnRow(10, 'wardley-components', budget, 'budget:components', none ?? `${nodes.length} component(s)`))
  rows.push(warnRow(11, 'wardley-links', budget, 'budget:links', none ?? `${elements.filter((e) => e.kind === 'line').length} link(s)`))
  rows.push(warnRow(12, 'wardley-isolated', budget, 'wardley:isolated', none ?? 'every component is on a line'))
  return rows
}

export const doc = {
  purpose: 'a one-off figure drawn from authored coordinates — boxes, text, lines, circles, regions on a canvas of your size; preset: wardley adds the evolution × visibility axes',
  whenToUse: 'when no parametric type fits and the picture is worth authoring by hand: every coordinate is yours, the plugin only draws with kit tokens and verifies (inside the canvas, no text overlap, no text across a border, lines clear of unconnected nodes, 4px grid). preset: wardley for a Wardley map — x = genesis/custom/product/commodity, y = visibility (both titles horizontal, direction shown by an arrowhead line), positions are the analyst\'s judgement, the plot starts at y = 24. Budgets: elements ≤ 24, label ≤ 20 chars, emphasis ≤ 2; under preset: wardley also components ≤ 9, links ≤ 12 and no isolated component. Freeform is for one-off figures only: run `render-diagram.mjs --list-types` first and pick a parametric type when one covers the picture — it lays out for you and verifies more; reach for freeform only when none does.',
  irExample: `id: wardley-booking
type: freeform
preset: wardley
title: 予約サービスの Wardley map
caption: 決済は product 帯にあり、自前実装から SaaS 利用へ移す判断点
width: 488
height: 320
elements:
  - kind: box
    id: user
    x: 176
    y: 24
    w: 96
    h: 28
    label: 利用者
  - kind: box
    id: booking
    x: 176
    y: 80
    w: 96
    h: 28
    label: 予約 UI
  - kind: box
    id: api
    x: 176
    y: 136
    w: 96
    h: 28
    label: 予約 API
  - kind: box
    id: payment
    x: 288
    y: 192
    w: 88
    h: 28
    label: 決済
    emphasis: true
  - kind: box
    id: db
    x: 176
    y: 208
    w: 96
    h: 28
    label: 予約 DB
  - kind: box
    id: cloud
    x: 376
    y: 248
    w: 96
    h: 28
    label: クラウド基盤
  - kind: line
    id: user-booking
    points: [[224, 52], [224, 80]]
  - kind: line
    id: booking-api
    points: [[224, 108], [224, 136]]
  - kind: line
    id: api-payment
    points: [[272, 156], [312, 192]]
  - kind: line
    id: api-db
    points: [[224, 164], [224, 208]]
  - kind: line
    id: db-cloud
    points: [[272, 228], [400, 248]]
`,
  rows: ['in-canvas', 'text-no-overlap', 'text-clear-of-borders', 'lines-avoid-nodes', 'grid-4px-authored', 'element-count', 'label-length', 'emphasis-count', 'preset-in-plot', 'wardley-components', 'wardley-links', 'wardley-isolated'],
}
