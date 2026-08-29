// `type: loop` — a cyclic flow (flywheel): 3–8 steps as boxes on one
// circle, the first at the top, each joined to the next by an arc on that
// same circle with an arrowhead, the last arc closing back to the first.
// An optional hub sits at the centre with a dashed spoke to every step
// (the write-back that makes a flywheel: every turn accumulates something
// in the hub). An exit is a short orthogonal arrow leaving one step
// outward — the one place the cycle is left.
//
// IR shape: `{ id, type:'loop', title, caption?, hub?, steps, direction?, exits?, edgeLabels? }`
//   steps:      [{ id, label, note?, emphasis?, tone? }] in flow order, 3–8 by guidance
//   direction:  'cw' (default) | 'ccw' — which way round the steps run from the top
//   hub:        string — centre label; spokes are drawn only when it is set
//   exits:      [{ from: stepId, label }] — outward arrow from a step
//   edgeLabels: [{ from, to, label }] — text outside the arc from `from` to
//               the step that follows it (any other pair is a schema error)
//
// Geometry: the survey's Loop type (#12) is parametric — same IR, same
// SVG — and one of the six documented exemptions from the orthogonal-edge
// rule: the arcs between steps and the spokes to the hub are the only
// non-orthogonal strokes; exits stay orthogonal. Box anchors (x/y/centre),
// the hub centre, label anchors and the canvas sit on the 4px grid (shared
// row `grid-4px`). Points on the circle — arc ends, spoke ends — are
// polar-derived and cannot be snapped without visibly leaving the circle,
// so they are stored as `sx/sy/ex/ey` (0.1px) and judged by this plugin's
// own rows, not the shared grid row.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'loop'

export const limits = { maxSteps: 8, maxLabelLen: 14, maxEmphasis: 2 }

const MIN_STEPS = 3
const PAD = 16               // canvas margin
const BOX_H = 32             // label-only step box (multiples of 8 keep a grid-centred box's corners on the grid)
const BOX_H_NOTE = 48        // label + note
const BOX_PAD_X = 12
const BOX_MIN_W = 72
const BOX_GAP = 24           // minimum clearance between two step boxes
const ARC_GAP = 6            // arc ends this far from the box it leaves/enters
const ARC_MIN_LEN = 28       // every arc must show at least this much stroke
const ARC_LABEL_GAP = 10     // arc → label anchor, measured outside the circle
const LABEL_CLEAR = 4        // labels keep this far from boxes and each other
const HUB_MIN_R = 28
const HUB_PAD = 12
const HUB_GAP = 20           // hub circle → nearest box
const SPOKE_GAP = 4          // spoke ends this far from the hub circle / the box
const EXIT_LEN = 32          // exit arrow length
const EXIT_LABEL_GAP = 8
const RADIUS_MIN = 64
const RADIUS_STEP = 8
const RADIUS_MAX = 640
const ANGLE_STEP = Math.PI / 720   // 0.25° search step for arc ends
const SAMPLE_STEP = Math.PI / 180  // 1° when re-checking arcs in verify

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const steps = normalizeSteps(raw.steps, ctx)
  const direction = normalizeDirection(raw.direction, ctx)
  const out = { id, type, title, caption, steps, direction }
  const hub = optStr(raw, 'hub', ctx)
  if (hub !== undefined) {
    if (hub.trim() === '') throw new IrError(`${ctx}.hub must be a non-empty string`)
    out.hub = hub
  }
  const ids = steps.map((s) => s.id)
  const exits = normalizeExits(raw.exits, ids, ctx)
  if (exits.length) out.exits = exits
  const edgeLabels = normalizeEdgeLabels(raw.edgeLabels, ids, ctx)
  if (edgeLabels.length) out.edgeLabels = edgeLabels
  return out
}

function normalizeSteps(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.steps must be a non-empty list`)
  if (raw.length < MIN_STEPS) throw new IrError(`${ctx}.steps needs at least ${MIN_STEPS} steps to form a loop (got: ${raw.length})`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.steps[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate step id: "${id}"`)
    seen.add(id)
    const rec = { id, label: requireStr(s, 'label', sctx) }
    const note = optStr(s, 'note', sctx)
    if (note !== undefined && note.trim() !== '') rec.note = note
    rec.emphasis = validateBool(s, 'emphasis', sctx)
    rec.tone = validateTone(s.tone, sctx)
    return rec
  })
}

function normalizeDirection(v, ctx) {
  if (v === undefined || v === null) return 'cw'
  if (v !== 'cw' && v !== 'ccw') throw new IrError(`${ctx}.direction must be cw|ccw (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeExits(raw, ids, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.exits must be a list`)
  const seen = new Set()
  return raw.map((e, i) => {
    const ectx = `${ctx}.exits[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const from = requireStr(e, 'from', ectx)
    if (!ids.includes(from)) throw new IrError(`${ectx}.from references unknown step "${from}"`)
    if (seen.has(from)) throw new IrError(`${ectx}: step "${from}" already has an exit (one exit per step)`)
    seen.add(from)
    return { from, label: requireStr(e, 'label', ectx) }
  })
}

function normalizeEdgeLabels(raw, ids, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.edgeLabels must be a list`)
  const seen = new Set()
  return raw.map((e, i) => {
    const ectx = `${ctx}.edgeLabels[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const from = requireStr(e, 'from', ectx)
    const to = requireStr(e, 'to', ectx)
    const fi = ids.indexOf(from)
    if (fi < 0) throw new IrError(`${ectx}.from references unknown step "${from}"`)
    if (!ids.includes(to)) throw new IrError(`${ectx}.to references unknown step "${to}"`)
    const next = ids[(fi + 1) % ids.length]
    if (to !== next) throw new IrError(`${ectx}: no arc runs ${from} → ${to} (the arc from "${from}" goes to "${next}")`)
    if (seen.has(from)) throw new IrError(`${ectx}: the arc from "${from}" already has a label`)
    seen.add(from)
    return { from, to, label: requireStr(e, 'label', ectx) }
  })
}

// --- budgets -------------------------------------------------------------

const labelsOf = (ir) => [
  ...ir.steps.map((s) => s.label),
  ...(ir.edgeLabels ?? []).map((e) => e.label),
  ...(ir.exits ?? []).map((e) => e.label),
]
const charLen = (s) => [...s].length
const longestLabel = (ir) => labelsOf(ir).reduce((m, l) => (charLen(l) > charLen(m) ? l : m), '')

export function budgetWarnings(ir) {
  const out = []
  if (ir.steps.length > limits.maxSteps) {
    out.push(budgetWarning('budget:steps', ir.steps.length, limits.maxSteps,
      `${ir.steps.length} step(s) (guidance ≤ ${limits.maxSteps})`,
      'merge neighbouring steps that one actor performs, or split the cycle into an inner and an outer loop'))
  }
  const longest = longestLabel(ir)
  if (charLen(longest) > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', charLen(longest), limits.maxLabelLen,
      `label "${longest}" is ${charLen(longest)} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and move the detail into the step note or the caption'))
  }
  const emphasized = ir.steps.filter((s) => s.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized step(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two steps the decision is about'))
  }
  return out
}

// --- geometry helpers ----------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10 || 0
const deg = (a) => round1((a * 180) / Math.PI)
const dirSign = (ir) => (ir.direction === 'ccw' ? -1 : 1)
/** Step i of n: straight up first, then round the circle in `dir`. */
const angleOf = (i, n, dir) => -Math.PI / 2 + (dir * i * 2 * Math.PI) / n
const onCircle = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) })
/** Distance from a point to the nearest point of a `{ left, top, right, bottom }` box. */
function distToBox(x, y, b) {
  const dx = Math.max(b.left - x, 0, x - b.right)
  const dy = Math.max(b.top - y, 0, y - b.bottom)
  return Math.hypot(dx, dy)
}
const boxOf = (s) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height })
const grow = (b, d) => ({ left: b.left - d, top: b.top - d, right: b.right + d, bottom: b.bottom + d })
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
/** Signed sweep from angle a to b in (-π, π]. */
const sweep = (a, b) => {
  let d = b - a
  while (d <= -Math.PI) d += 2 * Math.PI
  while (d > Math.PI) d -= 2 * Math.PI
  return d
}

function stepSize(s) {
  const labelW = Math.ceil(textWidth(s.label, FONT_SIZE) * (s.emphasis ? BOLD_FACTOR : 1))
  const noteW = s.note ? Math.ceil(textWidth(s.note, EDGE_LABEL_SIZE)) : 0
  return { width: Math.ceil(Math.max(BOX_MIN_W, Math.max(labelW, noteW) + BOX_PAD_X * 2) / 8) * 8, height: s.note ? BOX_H_NOTE : BOX_H }
}

/** Step boxes on a circle of `radius`, centre-origin, anchors snapped. */
function placeSteps(ir, radius) {
  const n = ir.steps.length
  const dir = dirSign(ir)
  return ir.steps.map((s, i) => {
    const angle = angleOf(i, n, dir)
    const { width, height } = stepSize(s)
    const centerX = snap4(radius * Math.cos(angle))
    const centerY = snap4(radius * Math.sin(angle))
    return {
      id: s.id, index: i, label: s.label, note: s.note, emphasis: s.emphasis, tone: s.tone,
      angle, x: centerX - width / 2, y: centerY - height / 2, width, height, centerX, centerY,
    }
  })
}

/** Angle from `from` (stepping in `sign` direction) at which the circle
 * point first clears `box` by ARC_GAP; undefined when it never does. */
function clearAngle(from, sign, radius, box) {
  for (let k = 0; k <= 720; k++) {
    const a = from + sign * k * ANGLE_STEP
    const p = onCircle(radius, a)
    if (distToBox(p.x, p.y, box) >= ARC_GAP) return a
  }
  return undefined
}

/** Anchor + box for a text placed just outside the circle at `angle`. */
function outsideLabel(text, angle, radius, size = EDGE_LABEL_SIZE) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const tip = onCircle(radius, angle)
  const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle'
  const baseline = s < -0.2 ? tip.y - 3 : s > 0.2 ? tip.y + size : tip.y + size * 0.35
  const x = snap4(tip.x)
  const y = snap4(baseline)
  const width = Math.ceil(textWidth(text, size))
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  return { text, x, y, anchor, width, box: { left, top: y - size, right: left + width, bottom: y + 3 } }
}

function placeArcs(ir, steps, radius) {
  const n = steps.length
  const dir = dirSign(ir)
  const labelByFrom = new Map((ir.edgeLabels ?? []).map((e) => [e.from, e.label]))
  return steps.map((from, i) => {
    const to = steps[(i + 1) % n]
    const start = clearAngle(from.angle, dir, radius, boxOf(from))
    const end = clearAngle(to.angle, -dir, radius, boxOf(to))
    const ok = start !== undefined && end !== undefined && sweep(start, end) * dir > 0
    const len = ok ? round1(radius * Math.abs(sweep(start, end))) : 0
    const s = onCircle(radius, start ?? from.angle)
    const e = onCircle(radius, end ?? to.angle)
    const rec = {
      index: i, from: from.id, to: to.id,
      startAngle: deg(start ?? from.angle), endAngle: deg(end ?? to.angle), length: len,
      sx: round1(s.x), sy: round1(s.y), ex: round1(e.x), ey: round1(e.y), sweep: dir > 0 ? 1 : 0,
    }
    const text = labelByFrom.get(from.id)
    if (text !== undefined) rec.label = outsideLabel(text, (start ?? from.angle) + sweep(start ?? from.angle, end ?? to.angle) / 2, radius + ARC_LABEL_GAP)
    return rec
  })
}

/** Exit: an orthogonal arrow out of the box's outermost side, label beyond the tip. */
function placeExits(ir, steps) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  return (ir.exits ?? []).map((e) => {
    const s = byId.get(e.from)
    const c = Math.cos(s.angle)
    const si = Math.sin(s.angle)
    const box = boxOf(s)
    const horizontal = Math.abs(c) >= Math.abs(si)
    const side = horizontal ? (c > 0 ? 'right' : 'left') : (si > 0 ? 'bottom' : 'top')
    let x1, y1, x2, y2, label
    if (side === 'right') {
      x1 = snapUp4(box.right); y1 = s.centerY; x2 = x1 + EXIT_LEN; y2 = y1
      label = textAt(e.label, x2 + EXIT_LABEL_GAP, y1 + 4, 'start')
    } else if (side === 'left') {
      x1 = snap4(Math.floor(box.left / 4) * 4); y1 = s.centerY; x2 = x1 - EXIT_LEN; y2 = y1
      label = textAt(e.label, x2 - EXIT_LABEL_GAP, y1 + 4, 'end')
    } else if (side === 'bottom') {
      x1 = s.centerX; y1 = snapUp4(box.bottom); x2 = x1; y2 = y1 + EXIT_LEN
      label = textAt(e.label, x1, snapUp4(y2 + EXIT_LABEL_GAP + EDGE_LABEL_SIZE), 'middle')
    } else {
      x1 = s.centerX; y1 = snap4(Math.floor(box.top / 4) * 4); x2 = x1; y2 = y1 - EXIT_LEN
      label = textAt(e.label, x1, y2 - EXIT_LABEL_GAP, 'middle')
    }
    return { from: e.from, side, x1, y1, x2, y2, label }
  })
}

function textAt(text, x, y, anchor) {
  const width = Math.ceil(textWidth(text, EDGE_LABEL_SIZE))
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  return { text, x, y, anchor, width, box: { left, top: y - EDGE_LABEL_SIZE, right: left + width, bottom: y + 3 } }
}

function placeSpokes(steps, hubR) {
  return steps.map((s) => {
    const box = boxOf(s)
    let tEnd = hubR + SPOKE_GAP
    for (let t = hubR + SPOKE_GAP; t <= Math.hypot(s.centerX, s.centerY); t += 1) {
      const p = onCircle(t, s.angle)
      if (distToBox(p.x, p.y, box) < SPOKE_GAP) break
      tEnd = t
    }
    const a = onCircle(hubR + SPOKE_GAP, s.angle)
    const b = onCircle(tEnd, s.angle)
    return { to: s.id, sx: round1(a.x), sy: round1(a.y), ex: round1(b.x), ey: round1(b.y) }
  })
}

/** Everything placed on a circle of `radius`, centre-origin, plus the
 * clearance problems that radius still has (empty = the radius fits). */
function place(ir, radius, hubR) {
  const steps = placeSteps(ir, radius)
  const arcs = placeArcs(ir, steps, radius)
  const exits = placeExits(ir, steps)
  const spokes = hubR ? placeSpokes(steps, hubR) : []
  return { steps, arcs, exits, spokes, problems: clearanceProblems(steps, arcs, exits, hubR) }
}

function boxProblems(steps, hubR) {
  const out = []
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      if (overlaps(grow(boxOf(steps[i]), BOX_GAP / 2), grow(boxOf(steps[j]), BOX_GAP / 2))) out.push(`"${steps[i].id}" and "${steps[j].id}" are closer than ${BOX_GAP}px`)
    }
    if (hubR && distToBox(0, 0, boxOf(steps[i])) < hubR + HUB_GAP) out.push(`"${steps[i].id}" is closer than ${HUB_GAP}px to the hub`)
  }
  return out
}

function arcProblems(steps, arcs, radius, hubR) {
  const out = []
  for (const a of arcs) {
    if (a.length < ARC_MIN_LEN) { out.push(`arc ${a.from}→${a.to} is ${a.length}px long (need ≥ ${ARC_MIN_LEN})`); continue }
    const start = (a.startAngle * Math.PI) / 180
    const total = sweep(start, (a.endAngle * Math.PI) / 180)
    const samples = Math.max(2, Math.ceil(Math.abs(total) / SAMPLE_STEP))
    const hit = new Set()
    for (let k = 0; k <= samples; k++) {
      const p = onCircle(radius, start + (total * k) / samples)
      for (const s of steps) if (distToBox(p.x, p.y, boxOf(s)) < ARC_GAP - 0.5) hit.add(s.id)
      if (hubR && Math.hypot(p.x, p.y) < hubR + SPOKE_GAP) hit.add('hub')
    }
    if (hit.size) out.push(`arc ${a.from}→${a.to} crosses ${[...hit].map((h) => `"${h}"`).join(', ')}`)
  }
  return out
}

function labelProblems(steps, arcs, exits, hubR) {
  const labels = [
    ...arcs.filter((a) => a.label).map((a) => ({ id: `arc ${a.from}→${a.to}`, box: a.label.box })),
    ...exits.map((e) => ({ id: `exit "${e.label.text}"`, box: e.label.box })),
  ]
  const out = []
  for (let i = 0; i < labels.length; i++) {
    for (const s of steps) if (overlaps(grow(labels[i].box, LABEL_CLEAR), boxOf(s))) out.push(`${labels[i].id} label overlaps step "${s.id}"`)
    for (let j = i + 1; j < labels.length; j++) if (overlaps(grow(labels[i].box, LABEL_CLEAR), labels[j].box)) out.push(`${labels[i].id} label overlaps ${labels[j].id} label`)
    if (hubR && distToBox(0, 0, labels[i].box) < hubR + LABEL_CLEAR) out.push(`${labels[i].id} label overlaps the hub`)
  }
  for (const e of exits) {
    const seg = { left: Math.min(e.x1, e.x2), top: Math.min(e.y1, e.y2), right: Math.max(e.x1, e.x2), bottom: Math.max(e.y1, e.y2) }
    for (const s of steps) if (s.id !== e.from && overlaps(grow(seg, LABEL_CLEAR), boxOf(s))) out.push(`exit arrow from "${e.from}" crosses step "${s.id}"`)
  }
  return out
}

function clearanceProblems(steps, arcs, exits, hubR) {
  const radius = arcs.length ? Math.hypot(arcs[0].sx, arcs[0].sy) : 0
  return [...boxProblems(steps, hubR), ...arcProblems(steps, arcs, radius, hubR), ...labelProblems(steps, arcs, exits, hubR)]
}

// --- layout --------------------------------------------------------------

/**
 * Deterministic: the radius starts small and grows in 8px steps until no
 * clearance rule is broken (boxes ≥ 24px apart and ≥ 20px from the hub,
 * every arc ≥ 28px long and 6px clear of every box, labels clear), then the
 * whole centre-origin drawing is translated onto a canvas whose margins
 * are PAD. Width may exceed the column for many long labels; the
 * dispatcher decides between scaling and the scroll fallback.
 */
export async function layout(ir, { column = COLUMN } = {}) {
  const hubR = ir.hub ? snapUp4(Math.max(HUB_MIN_R, Math.ceil(textWidth(ir.hub, FONT_SIZE) * BOLD_FACTOR) / 2 + HUB_PAD)) : 0
  let radius = RADIUS_MIN
  let placed = place(ir, radius, hubR)
  while (placed.problems.length && radius < RADIUS_MAX) {
    radius += RADIUS_STEP
    placed = place(ir, radius, hubR)
  }
  const { steps, arcs, exits, spokes } = placed

  // extents (centre-origin): boxes, the circle plus its arrowheads, labels, exits
  let minX = -radius - 8, maxX = radius + 8, minY = -radius - 8, maxY = radius + 8
  const take = (b) => { minX = Math.min(minX, b.left); maxX = Math.max(maxX, b.right); minY = Math.min(minY, b.top); maxY = Math.max(maxY, b.bottom) }
  for (const s of steps) take(boxOf(s))
  for (const a of arcs) if (a.label) take(a.label.box)
  for (const e of exits) { take(e.label.box); take({ left: Math.min(e.x1, e.x2), top: Math.min(e.y1, e.y2), right: Math.max(e.x1, e.x2), bottom: Math.max(e.y1, e.y2) }) }
  const cx = snapUp4(-minX + PAD)
  const cy = snapUp4(-minY + PAD)
  const width = snapUp4(cx + maxX + PAD)
  const height = snapUp4(cy + maxY + PAD)

  const shiftBox = (b) => ({ left: b.left + cx, top: b.top + cy, right: b.right + cx, bottom: b.bottom + cy })
  const shiftText = (t) => ({ ...t, x: t.x + cx, y: t.y + cy, box: shiftBox(t.box) })
  const geo = {
    cx, cy, radius, direction: ir.direction,
    steps: steps.map((s) => ({ ...s, angle: deg(s.angle), x: s.x + cx, y: s.y + cy, centerX: s.centerX + cx, centerY: s.centerY + cy })),
    arcs: arcs.map((a) => ({ ...a, sx: round1(a.sx + cx), sy: round1(a.sy + cy), ex: round1(a.ex + cx), ey: round1(a.ey + cy), ...(a.label ? { label: shiftText(a.label) } : {}) })),
    exits: exits.map((e) => ({ ...e, x1: e.x1 + cx, y1: e.y1 + cy, x2: e.x2 + cx, y2: e.y2 + cy, label: shiftText(e.label) })),
  }
  if (ir.hub) {
    geo.hub = { text: ir.hub, cx, cy, r: hubR }
    geo.spokes = spokes.map((s) => ({ ...s, sx: round1(s.sx + cx), sy: round1(s.sy + cy), ex: round1(s.ex + cx), ey: round1(s.ey + cy) }))
  }
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

  if (geo.hub) {
    // the hub is the one dense fill: a currentColor wash with the heavy stroke
    parts.push(`<circle id="${uid}-hub" cx="${geo.hub.cx}" cy="${geo.hub.cy}" r="${geo.hub.r}" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"/>`)
    parts.push(`<text id="${uid}-hub-label" x="${geo.hub.cx}" y="${geo.hub.cy + 4}" font-size="${FONT_SIZE}" font-weight="700" text-anchor="middle" fill="currentColor">${esc(geo.hub.text)}</text>`)
    parts.push(`<g id="${uid}-spokes" stroke="var(--wu-ink-3)" stroke-width="1" stroke-dasharray="4 3">`)
    for (const s of geo.spokes) parts.push(`<line id="${uid}-spoke-${s.to}" x1="${s.sx}" y1="${s.sy}" x2="${s.ex}" y2="${s.ey}"/>`)
    parts.push('</g>')
  }

  for (const a of geo.arcs) {
    parts.push(`<path id="${uid}-arc-${a.index}" d="M${a.sx} ${a.sy} A${geo.radius} ${geo.radius} 0 0 ${a.sweep} ${a.ex} ${a.ey}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    if (a.label) parts.push(`<text id="${uid}-arc-${a.index}-label" x="${a.label.x}" y="${a.label.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${a.label.anchor}" fill="currentColor">${esc(a.label.text)}</text>`)
  }

  for (const e of geo.exits) {
    parts.push(`<line id="${uid}-exit-${e.from}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    parts.push(`<text id="${uid}-exit-${e.from}-label" x="${e.label.x}" y="${e.label.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${e.label.anchor}" fill="currentColor">${esc(e.label.text)}</text>`)
  }

  for (const s of geo.steps) {
    const cls = s.emphasis ? ' class="wu-focal"' : ''
    const sw = s.emphasis ? 1.5 : 1
    const weight = s.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-step-${s.id}" data-tone="${s.tone}"${cls} x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="4" stroke="currentColor" stroke-width="${sw}"/>`)
    if (s.note) {
      parts.push(`<text id="${uid}-step-${s.id}-label" x="${s.centerX}" y="${s.centerY - 4}" font-size="${FONT_SIZE}"${weight} text-anchor="middle" fill="currentColor">${esc(s.label)}</text>`)
      parts.push(`<text id="${uid}-step-${s.id}-note" x="${s.centerX}" y="${s.centerY + 14}" font-size="${EDGE_LABEL_SIZE}" text-anchor="middle" fill="var(--wu-ink-3)">${esc(s.note)}</text>`)
    } else {
      parts.push(`<text id="${uid}-step-${s.id}-label" x="${s.centerX}" y="${s.centerY + 5}" font-size="${FONT_SIZE}"${weight} text-anchor="middle" fill="currentColor">${esc(s.label)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------

export function verify(layoutResult, ir, { svg } = {}) {
  const { geo } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    const row = { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint }
    if (w) { row.key = w.key; row.value = w.value }
    rows.push(row)
  }
  budgetRow(1, 'step-count', 'budget:steps', `${ir.steps.length} step(s)`)
  budgetRow(2, 'label-length', 'budget:label', `longest label ${charLen(longestLabel(ir))} chars`)
  budgetRow(3, 'emphasis-count', 'budget:emphasis', `${ir.steps.filter((s) => s.emphasis).length} emphasized step(s)`)

  // re-centre the geometry so the placement predicates apply as in layout()
  const { cx, cy } = geo
  const hubR = geo.hub ? geo.hub.r : 0
  const steps = geo.steps.map((s) => ({ ...s, angle: (s.angle * Math.PI) / 180, x: s.x - cx, y: s.y - cy, centerX: s.centerX - cx, centerY: s.centerY - cy }))
  const unshift = (t) => ({ ...t, box: { left: t.box.left - cx, top: t.box.top - cy, right: t.box.right - cx, bottom: t.box.bottom - cy } })
  const arcs = geo.arcs.map((a) => ({ ...a, sx: a.sx - cx, sy: a.sy - cy, ex: a.ex - cx, ey: a.ey - cy, ...(a.label ? { label: unshift(a.label) } : {}) }))
  const exits = geo.exits.map((e) => ({ ...e, x1: e.x1 - cx, y1: e.y1 - cy, x2: e.x2 - cx, y2: e.y2 - cy, label: unshift(e.label) }))

  // 4. step boxes never overlap each other or the hub
  const boxes = boxProblems(steps, hubR)
  rows.push({
    id: 4, name: 'boxes-clear', severity: 'fail', ok: boxes.length === 0,
    detail: boxes.length ? boxes.slice(0, 6).join('; ') : `every step box keeps ≥ ${BOX_GAP}px from its neighbours${hubR ? ` and ≥ ${HUB_GAP}px from the hub` : ''}`,
    hint: boxes.length ? 'shorten the step labels or reduce the step count so the circle can hold every box' : undefined,
  })

  // 5. arcs stay on the circle, clear of every box, and are long enough to read
  const arcIssues = arcProblems(steps, arcs, geo.radius, hubR)
  rows.push({
    id: 5, name: 'arcs-clear', severity: 'fail', ok: arcIssues.length === 0,
    detail: arcIssues.length ? arcIssues.slice(0, 6).join('; ') : `every arc keeps ≥ ${ARC_GAP}px from the boxes and is ≥ ${ARC_MIN_LEN}px long`,
    hint: arcIssues.length ? 'widen the circle (fewer or shorter steps) so each arc has room between its two boxes' : undefined,
  })

  // 6. arc labels and exits clear of boxes, the hub, and each other
  const labelIssues = labelProblems(steps, arcs, exits, hubR)
  rows.push({
    id: 6, name: 'labels-clear', severity: 'fail', ok: labelIssues.length === 0,
    detail: labelIssues.length ? labelIssues.slice(0, 6).join('; ') : (arcs.some((a) => a.label) || exits.length ? `arc labels and exits keep ≥ ${LABEL_CLEAR}px from every box and each other` : 'no arc labels or exits'),
    hint: labelIssues.length ? 'shorten the arc/exit label, or drop it and say it in the caption' : undefined,
  })

  // 7. every arc runs from a step to the next in `direction`, in the geometry and in the svg
  const dir = dirSign(ir)
  const order = ir.steps.map((s) => s.id)
  const uid = `wu-d-${ir.id}`
  const dirIssues = []
  if (arcs.length !== order.length) dirIssues.push(`${arcs.length} arc(s) for ${order.length} steps`)
  arcs.forEach((a, i) => {
    const fi = order.indexOf(a.from)
    if (fi < 0 || order[(fi + 1) % order.length] !== a.to) dirIssues.push(`arc ${a.from}→${a.to} does not join consecutive steps`)
    const start = (a.startAngle * Math.PI) / 180
    const end = (a.endAngle * Math.PI) / 180
    const geoSweep = sweep(start, end) * dir
    const fromAngle = Math.atan2(a.sy, a.sx)
    const toAngle = Math.atan2(a.ey, a.ex)
    if (geoSweep <= 0 || sweep(fromAngle, toAngle) * dir <= 0) dirIssues.push(`arc ${a.from}→${a.to} runs against direction ${ir.direction}`)
    if (a.sweep !== (dir > 0 ? 1 : 0)) dirIssues.push(`arc ${a.from}→${a.to} carries sweep flag ${a.sweep}`)
    if (svg !== undefined) {
      const m = new RegExp(`<path id="${uid}-arc-${i}" d="M[^"]* A[\\d.]+ [\\d.]+ 0 0 (\\d) [^"]*"[^>]*marker-end=`).exec(svg)
      if (!m) dirIssues.push(`arc ${a.from}→${a.to} is not drawn as an arrowed arc`)
      else if (Number(m[1]) !== (dir > 0 ? 1 : 0)) dirIssues.push(`arc ${a.from}→${a.to} is drawn with sweep flag ${m[1]}`)
    }
  })
  rows.push({
    id: 7, name: 'arrow-direction', severity: 'fail', ok: dirIssues.length === 0,
    detail: dirIssues.length ? dirIssues.slice(0, 6).join('; ') : `every arc runs ${ir.direction === 'ccw' ? 'counter-clockwise' : 'clockwise'} from a step to the next, arrowhead at the next step`,
    hint: dirIssues.length ? 'lay each arc out from step i to step i+1 in the direction the IR names, and draw it with the matching sweep flag' : undefined,
  })
  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'a cycle whose last step feeds the first (flywheel): steps round a circle, arcs between them, an optional hub that accumulates, exits where the loop is left',
  whenToUse: 'when the point is that the flow closes on itself and each turn strengthens something in the middle — growth loops, feedback loops, a review cycle. A flow with an end or a branch is a process/diagram; a plain cycle without accumulation needs no hub. Budgets: steps ≤ 8, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: data-flywheel
type: loop
title: データ資産のフライホイール
caption: 一周ごとに中央のデータ資産が増え、次の周を速くする
hub: データ資産
direction: cw
steps:
  - id: users
    label: 利用者が増える
  - id: data
    label: データが貯まる
    note: 行動ログ・評価
  - id: model
    label: 精度が上がる
    emphasis: true
  - id: ux
    label: 体験が良くなる
  - id: referral
    label: 紹介が増える
edgeLabels:
  - from: data
    to: model
    label: 再学習
exits:
  - from: ux
    label: 有料プランへ
`,
  rows: ['step-count', 'label-length', 'emphasis-count', 'boxes-clear', 'arcs-clear', 'labels-clear', 'arrow-direction'],
}
