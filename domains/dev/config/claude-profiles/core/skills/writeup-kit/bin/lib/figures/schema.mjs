// `type: schema` — entity boxes with a field list and typed relations. One
// plugin covers three notations through `variant`:
//
//   er     (default) — ER / data model: header + fields, crow's foot / bar
//                      at the line ends plus the cardinality as text
//   class  — UML class: header + attributes + methods section, hollow
//            triangle for inheritance, dashed open arrow for `uses`,
//            multiplicities as text only (no crow's foot)
//   db     — database schema: header + columns with PK/FK tags, crow's
//            foot / bar at the line ends, no cardinality text
//
// IR shape: `{ id, type:'schema', title, caption, variant, direction,
// entities, relations }`. An entity is `{ id, label, fields:[{ name, type?,
// key?: pk|fk, note? }], methods:[string], emphasis, tone }`; a relation is
// `{ from, to, kind: one-many|many-many|one-one|inherits|uses, label,
// from_card?, to_card? }` — `from` is the "one" side of a one-many.
//
// Layout: boxes are sized from their longest field line (kit text-width
// estimate), placed by the vendored elk layered engine (the same file
// diagram.mjs loads — only node positions are taken from it), and joined
// by orthogonal relations the plugin routes itself: straight, Z through
// the layer gap, or a detour around the outside; ports fan out along a
// box side; parallel mid-segments spread onto lanes. Every position sits
// on the 4px grid. End markers, cardinality text and labels are placed
// so they never overlap (verify rows 10–12).
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc, LEGEND_HEIGHT, legendWidth } from './_shared.mjs'
import { snap4, snapUp4, textWidth, fitRatio, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ELK = require(join(HERE, '..', '..', '..', 'vendor', 'elk', 'elk.bundled.js'))
const elk = new ELK()

export const type = 'schema'

export const limits = { maxEntities: 8, maxFields: 8, maxRelations: 12, maxLabelLen: 14, maxEmphasis: 2 }

const VARIANTS = new Set(['er', 'class', 'db'])
const DIRECTIONS = new Set(['auto', 'right', 'down'])
const REL_KINDS = new Set(['one-many', 'many-many', 'one-one', 'inherits', 'uses'])
const KEYS = new Set(['pk', 'fk'])

const MARGIN = 16        // canvas margin (also the outer detour channel)
const PAD = 12           // text inset inside a box
const HEADER_H = 28      // 13px bold label band
const ROW_H = 20         // one 11px field / method line
const TAG_W = 28         // db variant: PK/FK tag column
const TYPE_GAP = 16      // between a field name and its type
const SEP_H = 8          // rows → methods separator band
const BOTTOM_PAD = 4
const MIN_W = 120
const LAYER_GAP = 80     // elk: between layers (right) — widened for labels
const LAYER_GAP_DOWN = 64
const NODE_GAP = 32      // elk: between nodes of one layer
const MARKER = 12        // end marker length along the line
const PORT_STEP = 24     // fan-out of several relations on one side
const LABEL_H = 16
const CARD_H = 12
const LANE = 12          // spread of parallel mid-segments
const CHANNEL = 20       // detour distance outside the boxes

// --- schema --------------------------------------------------------------

function normalizeEnum(v, allowed, fallback, ctx, wording) {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'string' || !allowed.has(v)) throw new IrError(`${ctx} must be ${wording} (got: ${JSON.stringify(v)})`)
  return v
}

function optCard(obj, field, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string' || v.trim() === '') throw new IrError(`${ctx}.${field} must be a non-empty string (got: ${JSON.stringify(v)})`)
  return v
}

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeEnum(raw.variant, VARIANTS, 'er', `${ctx}.variant`, 'er|class|db')
  const direction = normalizeEnum(raw.direction, DIRECTIONS, 'auto', `${ctx}.direction`, 'auto|right|down')
  if (!Array.isArray(raw.entities) || raw.entities.length === 0) throw new IrError(`${ctx}.entities must be a non-empty list`)
  const seen = new Set()
  const entities = raw.entities.map((e, i) => normalizeEntity(e, `${ctx}.entities[${i}]`, seen))
  const relations = normalizeRelations(raw.relations, seen, ctx)
  return { id, type, title, caption, variant, direction, entities, relations }
}

function normalizeEntity(raw, ctx, seen) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const id = requireStr(raw, 'id', ctx)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new IrError(`${ctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
  if (seen.has(id)) throw new IrError(`duplicate entity id: "${id}"`)
  seen.add(id)
  const label = requireStr(raw, 'label', ctx)
  let fields = []
  if (raw.fields !== undefined && raw.fields !== null) {
    if (!Array.isArray(raw.fields)) throw new IrError(`${ctx}.fields must be a list`)
    fields = raw.fields.map((f, i) => normalizeField(f, `${ctx}.fields[${i}]`))
  }
  let methods = []
  if (raw.methods !== undefined && raw.methods !== null) {
    if (!Array.isArray(raw.methods)) throw new IrError(`${ctx}.methods must be a list of strings`)
    methods = raw.methods.map((m, i) => {
      if (typeof m !== 'string' || m.trim() === '') throw new IrError(`${ctx}.methods[${i}] must be a non-empty string`)
      return m
    })
  }
  return { id, label, fields, methods, emphasis: validateBool(raw, 'emphasis', ctx), tone: validateTone(raw.tone, ctx) }
}

function normalizeField(raw, ctx) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const name = requireStr(raw, 'name', ctx)
  const key = raw.key === undefined || raw.key === null ? undefined : raw.key
  if (key !== undefined && (typeof key !== 'string' || !KEYS.has(key))) throw new IrError(`${ctx}.key must be pk|fk (got: ${JSON.stringify(key)})`)
  return { name, type: optStr(raw, 'type', ctx), key, note: optStr(raw, 'note', ctx) }
}

function normalizeRelations(raw, ids, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.relations must be a list`)
  return raw.map((r, i) => {
    const rctx = `${ctx}.relations[${i}]`
    if (!isObj(r)) throw new IrError(`${rctx} must be a mapping`)
    const from = requireStr(r, 'from', rctx)
    const to = requireStr(r, 'to', rctx)
    if (!ids.has(from)) throw new IrError(`${rctx}.from references unknown entity "${from}"`)
    if (!ids.has(to)) throw new IrError(`${rctx}.to references unknown entity "${to}"`)
    if (from === to) throw new IrError(`${rctx}: from and to must differ (self relations are not drawn)`)
    const kind = normalizeEnum(r.kind, REL_KINDS, 'one-many', `${rctx}.kind`, 'one-many|many-many|one-one|inherits|uses')
    return { from, to, kind, label: optStr(r, 'label', rctx) ?? '', from_card: optCard(r, 'from_card', rctx), to_card: optCard(r, 'to_card', rctx) }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const n = ir.entities.length
  if (n > limits.maxEntities) {
    out.push(budgetWarning('budget:entities', n, limits.maxEntities,
      `${n} entities (guidance ≤ ${limits.maxEntities})`,
      'split the model by ownership, or drop the lookup tables'))
  }
  const widest = ir.entities.reduce((m, e) => (e.fields.length > (m ? m.fields.length : 0) ? e : m), null)
  if (widest && widest.fields.length > limits.maxFields) {
    out.push(budgetWarning('budget:fields', widest.fields.length, limits.maxFields,
      `entity "${widest.id}" lists ${widest.fields.length} fields (guidance ≤ ${limits.maxFields})`,
      `keep the keys and the fields the decision is about in "${widest.id}"; drop the rest`))
  }
  if (ir.relations.length > limits.maxRelations) {
    out.push(budgetWarning('budget:relations', ir.relations.length, limits.maxRelations,
      `${ir.relations.length} relations (guidance ≤ ${limits.maxRelations})`,
      'draw only the relations that carry the decision — not every FK needs a line'))
  }
  const labels = [
    ...ir.entities.map((e) => ({ what: `entity "${e.id}"`, text: e.label })),
    ...ir.relations.map((r, i) => ({ what: `relation ${i} ("${r.from}"→"${r.to}")`, text: r.label })),
  ]
  const longest = labels.reduce((m, l) => ([...l.text].length > (m ? [...m.text].length : 0) ? l : m), null)
  if (longest && [...longest.text].length > limits.maxLabelLen) {
    const len = [...longest.text].length
    out.push(budgetWarning('budget:label', len, limits.maxLabelLen,
      `label of ${longest.what} is ${len} chars (guidance ≤ ${limits.maxLabelLen})`,
      `shorten the label of ${longest.what}`))
  }
  const emphasized = ir.entities.filter((e) => e.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized entities (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the table the decision is about'))
  }
  return out
}

// --- measure -----------------------------------------------------------------

const w11 = (s) => Math.ceil(textWidth(s, EDGE_LABEL_SIZE))
const rightText = (f) => [f.type, f.note].filter(Boolean).join(' · ')

/** Width the text of one field line needs inside the box (without PAD). */
function fieldLineWidth(f, variant) {
  const tag = variant === 'db' && f.key ? TAG_W : 0
  const right = rightText(f)
  return tag + w11(f.name) + (right ? TYPE_GAP + w11(right) : 0)
}

function measureEntity(e, variant) {
  const labelW = Math.ceil(textWidth(e.label, FONT_SIZE) * BOLD_FACTOR)
  const lines = [labelW, ...e.fields.map((f) => fieldLineWidth(f, variant)), ...e.methods.map(w11)]
  const width = snapUp4(Math.max(MIN_W, Math.max(...lines) + PAD * 2))
  const showMethods = variant === 'class' && e.methods.length > 0
  const rows = e.fields.map((f, i) => ({ ...f, top: HEADER_H + i * ROW_H, text: f.name, right: rightText(f), tag: variant === 'db' && f.key ? f.key.toUpperCase() : '' }))
  // the separator band exists only between two non-empty sections
  const sep = showMethods && e.fields.length > 0 ? SEP_H : 0
  const methodsTop = HEADER_H + e.fields.length * ROW_H + sep
  const methods = showMethods ? e.methods.map((m, i) => ({ text: m, top: methodsTop + i * ROW_H })) : []
  const bodyEnd = showMethods ? methodsTop + methods.length * ROW_H : HEADER_H + e.fields.length * ROW_H
  const height = snapUp4(Math.max(bodyEnd + BOTTOM_PAD, HEADER_H + 12))
  return { id: e.id, label: e.label, tone: e.tone, emphasis: e.emphasis, width, height, rows, methods, methodsTop: showMethods ? methodsTop : undefined, methodsSep: sep > 0 }
}

// --- layout ----------------------------------------------------------------

export async function layout(ir, { column = COLUMN } = {}) {
  const sizes = ir.entities.map((e) => measureEntity(e, ir.variant))
  if (ir.direction !== 'auto') return place(ir, sizes, ir.direction)
  const right = await place(ir, sizes, 'right')
  const down = await place(ir, sizes, 'down')
  if (right.width <= column) return right
  if (down.width <= column) return down
  return fitRatio(down, column) < fitRatio(right, column) ? down : right
}

async function place(ir, sizes, direction) {
  const maxLabelW = Math.max(0, ...ir.relations.map((r) => (r.label ? w11(r.label) + 8 : 0)))
  const hasCards = ir.variant !== 'db' && ir.relations.some((r) => cardsOf(r, ir.variant).some(Boolean))
  const laid = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(direction === 'down' ? Math.max(LAYER_GAP_DOWN, hasCards ? 72 : 0) : Math.max(LAYER_GAP, maxLabelW + 32)),
      'elk.spacing.nodeNode': String(direction === 'down' ? Math.max(NODE_GAP, maxLabelW + 20) : NODE_GAP),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: sizes.map((s) => ({ id: s.id, width: s.width, height: s.height })),
    edges: ir.relations.map((r, i) => ({ id: `r${i}`, sources: [r.from], targets: [r.to] })),
  })
  const pos = new Map((laid.children || []).map((c) => [c.id, c]))
  const boxes = sizes.map((s) => {
    const p = pos.get(s.id) || { x: 0, y: 0 }
    return { ...s, x: snap4(MARGIN + p.x), y: snap4(MARGIN + p.y) }
  })
  const byId = new Map(boxes.map((b) => [b.id, b]))

  // Pass 1: route with centered ports to learn which side each relation
  // leaves/enters; pass 2: fan the ports out along each side and route
  // again with the sides fixed.
  const first = ir.relations.map((r, i) => routeEdge(r, i, byId, boxes, null))
  const ports = assignPorts(first, byId)
  const edges = ir.relations.map((r, i) => routeEdge(r, i, byId, boxes, ports.get(i)))
  spreadMids(edges)

  for (const e of edges) decorate(e, ir)
  placeLabels(edges, boxes)

  // Translate so nothing sits closer than 8px to the top-left, then size
  // the canvas from everything drawn.
  const rects = () => [
    ...boxes,
    ...edges.flatMap((e) => [e.labelBox, ...e.ends.map((n) => n.markerBox), ...e.ends.map((n) => n.cardBox)].filter(Boolean)),
    ...edges.flatMap((e) => e.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))),
  ]
  let all = rects()
  const dx = snapUp4(Math.max(0, 8 - Math.min(...all.map((r) => r.x))))
  const dy = snapUp4(Math.max(0, 8 - Math.min(...all.map((r) => r.y))))
  if (dx || dy) { translate(boxes, edges, dx, dy); all = rects() }
  const legend = legendFor(ir)
  const contentW = Math.max(...all.map((r) => r.x + r.width))
  const contentH = Math.max(...all.map((r) => r.y + r.height))
  const width = snapUp4(Math.max(contentW + MARGIN, legend ? legendWidth(legend.items) : 0))
  let height = snapUp4(contentH + MARGIN)
  let legendOut
  if (legend) { legendOut = { y: height, items: legend.items }; height += LEGEND_HEIGHT }
  return { width, height, geo: { variant: ir.variant, direction, boxes, edges }, legend: legendOut }
}

function translate(boxes, edges, dx, dy) {
  for (const b of boxes) { b.x += dx; b.y += dy }
  for (const e of edges) {
    for (const p of e.points) { p.x += dx; p.y += dy }
    if (e.labelBox) { e.labelBox.x += dx; e.labelBox.y += dy }
    for (const n of e.ends) {
      n.x += dx; n.y += dy
      if (n.markerBox) { n.markerBox.x += dx; n.markerBox.y += dy }
      if (n.cardBox) { n.cardBox.x += dx; n.cardBox.y += dy }
    }
  }
}

function legendFor(ir) {
  const kinds = new Set(ir.relations.map((r) => r.kind))
  const items = []
  if (ir.variant !== 'class') {
    if (kinds.has('one-many') || kinds.has('many-many')) items.push({ label: 'many', marker: 'crow' })
    if (kinds.has('one-many') || kinds.has('one-one')) items.push({ label: 'one', marker: 'bar' })
  }
  if (kinds.has('inherits')) items.push({ label: 'inherits', marker: 'tri' })
  if (kinds.has('uses')) items.push({ label: 'uses', marker: 'open', dash: '5 4' })
  return items.length ? { items } : null
}

// --- routing -------------------------------------------------------------------

const right = (b) => b.x + b.width
const bottom = (b) => b.y + b.height
const cx = (b) => snap4(b.x + b.width / 2)
const cy = (b) => snap4(b.y + b.height / 2)
const rectsOverlap = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)

/** Does the axis-aligned open segment p→q pass through the open rect r? */
function segmentCrosses(p, q, r) {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x)
  const y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y)
  if (p.y === q.y) return p.y > r.y && p.y < bottom(r) && Math.max(x1, r.x) < Math.min(x2, right(r))
  if (p.x === q.x) return p.x > r.x && p.x < right(r) && Math.max(y1, r.y) < Math.min(y2, bottom(r))
  return true
}

const dedupe = (pts) => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y)

/** The point on `side` of box `b` at cross coordinate `at` (or the side's center). */
function portPoint(b, side, at) {
  if (side === 'right') return { x: right(b), y: at ?? cy(b) }
  if (side === 'left') return { x: b.x, y: at ?? cy(b) }
  if (side === 'bottom') return { x: at ?? cx(b), y: bottom(b) }
  return { x: at ?? cx(b), y: b.y }
}

/** Candidate polylines for one side pair, most direct first. Each is
 * tagged with `sides` so pass 2 can pin the ports. */
function candidates(A, B, sides, pa, pb, boxes) {
  const P = portPoint(A, sides[0], pa), Q = portPoint(B, sides[1], pb)
  const out = []
  const tag = (pts, extra = {}) => Object.assign(dedupe(pts), { sides, ...extra })
  const minY = Math.min(...boxes.map((b) => b.y)), maxY = Math.max(...boxes.map(bottom))
  const minX = Math.min(...boxes.map((b) => b.x)), maxX = Math.max(...boxes.map(right))
  const horizontal = sides[0] === 'right' || sides[0] === 'left'
  if (horizontal && sides[1] !== sides[0]) {
    // straight or Z through the gap between the two boxes
    if (P.y === Q.y) out.push(tag([P, Q]))
    const midX = snap4((P.x + Q.x) / 2)
    out.push(tag([P, { x: midX, y: P.y }, { x: midX, y: Q.y }, Q], { mid: 'v' }))
  } else if (!horizontal && sides[1] !== sides[0]) {
    if (P.x === Q.x) out.push(tag([P, Q]))
    const midY = snap4((P.y + Q.y) / 2)
    out.push(tag([P, { x: P.x, y: midY }, { x: Q.x, y: midY }, Q], { mid: 'h' }))
  } else if (sides[0] === 'top' || sides[0] === 'bottom') {
    // detour over the top / under the bottom of everything in between
    const local = sides[0] === 'top' ? Math.min(A.y, B.y) - CHANNEL : Math.max(bottom(A), bottom(B)) + CHANNEL
    const global = sides[0] === 'top' ? minY - CHANNEL : maxY + CHANNEL
    for (const y of [snap4(local), snap4(global)]) out.push(tag([P, { x: P.x, y }, { x: Q.x, y }, Q], { mid: 'h', detour: true }))
  } else {
    const local = sides[0] === 'left' ? Math.min(A.x, B.x) - CHANNEL : Math.max(right(A), right(B)) + CHANNEL
    const global = sides[0] === 'left' ? minX - CHANNEL : maxX + CHANNEL
    for (const x of [snap4(local), snap4(global)]) out.push(tag([P, { x, y: P.y }, { x, y: Q.y }, Q], { mid: 'v', detour: true }))
  }
  return out.filter((r) => r.length >= 2)
}

function routeIsClear(pts, A, B, boxes) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1]
    if (p.x !== q.x && p.y !== q.y) return false
    for (const b of boxes) if (segmentCrosses(p, q, b)) return false
  }
  return true
}

/** Side pairs to try, most natural first, given where B sits relative to A. */
function sidePairs(A, B) {
  const pairs = []
  if (B.x >= right(A)) pairs.push(['right', 'left'])
  if (right(B) <= A.x) pairs.push(['left', 'right'])
  if (B.y >= bottom(A)) pairs.push(['bottom', 'top'])
  if (bottom(B) <= A.y) pairs.push(['top', 'bottom'])
  pairs.push(['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right'])
  return pairs
}

function routeEdge(r, index, byId, boxes, port) {
  const A = byId.get(r.from), B = byId.get(r.to)
  const pairs = port ? [port.sides] : sidePairs(A, B)
  let fallback = null
  for (const sides of pairs) {
    for (const c of candidates(A, B, sides, port?.pa, port?.pb, boxes)) {
      if (!fallback) fallback = c
      if (routeIsClear(c, A, B, boxes)) return makeEdge(r, index, c)
    }
  }
  return makeEdge(r, index, fallback)
}

function makeEdge(r, index, pts) {
  return { index, from: r.from, to: r.to, kind: r.kind, label: r.label, sides: pts.sides, mid: pts.mid, detour: !!pts.detour, points: pts.map((p) => ({ x: p.x, y: p.y })) }
}

/** Fan several relations on one box side out along it (sorted by where
 * the other end sits), PORT_STEP apart, never past the side's ends. */
function assignPorts(edges, byId) {
  const groups = new Map() // `${box}:${side}` → [{ edge, endIndex }]
  for (const e of edges) {
    const ends = [[e.from, e.sides[0], 0], [e.to, e.sides[1], 1]]
    for (const [id, side, k] of ends) {
      const key = `${id}:${side}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ e, k })
    }
  }
  const at = new Map() // edge index → { pa, pb }
  const otherCenter = (e, k) => {
    const box = byId.get(k === 0 ? e.to : e.from)
    return e.sides[k] === 'left' || e.sides[k] === 'right' ? cy(box) : cx(box)
  }
  for (const [key, list] of groups) {
    const [id, side] = key.split(':')
    const box = byId.get(id)
    const vertical = side === 'left' || side === 'right'
    const len = vertical ? box.height : box.width
    const center = vertical ? cy(box) : cx(box)
    list.sort((a, b) => otherCenter(a.e, a.k) - otherCenter(b.e, b.k) || a.e.index - b.e.index)
    const n = list.length
    const step = n > 1 ? Math.max(8, Math.min(PORT_STEP, snap4((len - 16) / (n - 1)))) : 0
    list.forEach(({ e, k }, i) => {
      const v = snap4(center + (i - (n - 1) / 2) * step)
      const rec = at.get(e.index) ?? { sides: e.sides }
      rec[k === 0 ? 'pa' : 'pb'] = v
      at.set(e.index, rec)
    })
  }
  return at
}

/** Two Z / detour routes whose mid-segments share a line and overlap in
 * span would draw as one — shift the later one onto its own lane. */
function spreadMids(edges) {
  const placed = []
  for (const e of edges) {
    if (e.points.length !== 4) continue
    const axis = e.mid === 'v' ? 'x' : 'y'
    const cross = e.mid === 'v' ? 'y' : 'x'
    const span = () => [Math.min(e.points[1][cross], e.points[2][cross]), Math.max(e.points[1][cross], e.points[2][cross])]
    const collides = () => placed.some((o) => o.axis === axis && Math.abs(o.at - e.points[1][axis]) < LANE && Math.max(o.span[0], span()[0]) <= Math.min(o.span[1], span()[1]))
    for (let k = 1; k <= 6 && collides(); k++) {
      const shift = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * LANE
      const base = e.points[1][axis]
      e.points[1][axis] = base + shift
      e.points[2][axis] = base + shift
      if (!collides()) break
      e.points[1][axis] = base
      e.points[2][axis] = base
    }
    placed.push({ axis, at: e.points[1][axis], span: span() })
  }
}

// --- decorations: markers, cardinality text, labels ----------------------------------

function cardsOf(r, variant) {
  if (r.from_card !== undefined || r.to_card !== undefined) return [r.from_card, r.to_card]
  if (variant === 'db') return [undefined, undefined]
  const many = variant === 'class' ? '*' : 'N'
  if (r.kind === 'one-many') return ['1', many]
  if (r.kind === 'many-many') return [many, many]
  if (r.kind === 'one-one') return ['1', '1']
  return [undefined, undefined]
}

function markersOf(r, variant) {
  if (r.kind === 'inherits') return [null, 'tri']
  if (r.kind === 'uses') return [null, 'open']
  if (variant === 'class') return [null, null]
  if (r.kind === 'one-many') return ['bar', 'crow']
  if (r.kind === 'many-many') return ['crow', 'crow']
  return ['bar', 'bar']
}

function decorate(e, ir) {
  const r = ir.relations[e.index]
  const cards = cardsOf(r, ir.variant)
  const markers = markersOf(r, ir.variant)
  const pts = e.points
  e.dash = r.kind === 'uses'
  e.ends = [0, 1].map((k) => {
    const P = k === 0 ? pts[0] : pts[pts.length - 1]
    const Q = k === 0 ? pts[1] : pts[pts.length - 2]
    const R = k === 0 ? pts[2] : pts[pts.length - 3]
    const horizontal = P.y === Q.y
    const dir = horizontal ? Math.sign(Q.x - P.x) : Math.sign(Q.y - P.y)
    const marker = markers[k]
    const markerBox = marker
      ? horizontal
        ? { x: dir > 0 ? P.x : P.x - MARKER, y: P.y - 8, width: MARKER, height: 16 }
        : { x: P.x - 8, y: dir > 0 ? P.y : P.y - MARKER, width: 16, height: MARKER }
      : null
    const card = cards[k]
    let cardBox = null
    let cardAnchor = 'start'
    if (card) {
      const cw = w11(card)
      if (horizontal) {
        cardBox = { x: dir > 0 ? P.x + MARKER + 4 : P.x - MARKER - 4 - snapUp4(cw), y: P.y + 8, width: cw, height: CARD_H }
        cardAnchor = dir > 0 ? 'start' : 'end'
      } else {
        // the side away from the next bend, so the label (which starts on
        // the bend's side) can never meet it
        const leftSide = !R || R.x >= Q.x
        cardBox = { x: leftSide ? P.x - 8 - snapUp4(cw) : P.x + 8, y: dir > 0 ? P.y + MARKER + 4 : P.y - MARKER - 4 - CARD_H, width: cw, height: CARD_H }
        cardAnchor = leftSide ? 'end' : 'start'
      }
    }
    return { x: P.x, y: P.y, side: e.sides[k], marker, markerBox, card, cardBox, cardAnchor }
  })
}

/**
 * Label candidates for one relation, most conventional first: above the
 * upper horizontal segment (starting past the end marker), above the
 * other one, beside the vertical mid-segment, then the mirrored spots.
 * placeLabels() takes the first that is clear of every box, marker,
 * cardinality text, earlier label and line segment.
 */
function labelCandidates(e) {
  const w = w11(e.label) + 8
  const pts = e.points
  const box = (x, y) => ({ x: snap4(x), y: snap4(y), width: w, height: LABEL_H, text: e.label })
  const midOf = (p, q, axis) => Math.min(p[axis], q[axis]) + Math.abs(q[axis] - p[axis]) / 2
  const above = (p, q) => box(midOf(p, q, 'x') - w / 2, p.y - LABEL_H - 8)
  const below = (p, q) => box(midOf(p, q, 'x') - w / 2, p.y + 8)
  const rightOf = (p, q) => box(p.x + 8, midOf(p, q, 'y') - LABEL_H / 2)
  const leftOf = (p, q) => box(p.x - 8 - w, midOf(p, q, 'y') - LABEL_H / 2)
  // along a horizontal segment whose end P sits on a box border: start
  // 16px past the marker, run toward the interior end Q
  const fromBorder = (P, Q, dy) => box(Q.x >= P.x ? P.x + MARKER + 4 : P.x - MARKER - 4 - w, P.y + dy)
  const out = []
  if (pts.length === 2) {
    if (pts[0].y === pts[1].y) out.push(above(pts[0], pts[1]), below(pts[0], pts[1]))
    else out.push(rightOf(pts[0], pts[1]), leftOf(pts[0], pts[1]))
  } else if (pts.length === 4 && e.mid === 'v' && !e.detour) {
    const upperFirst = pts[0].y <= pts[3].y
    const [U, Uq, L, Lq] = upperFirst ? [pts[0], pts[1], pts[3], pts[2]] : [pts[3], pts[2], pts[0], pts[1]]
    out.push(fromBorder(U, Uq, -LABEL_H - 8), fromBorder(L, Lq, -LABEL_H - 8),
      rightOf(pts[1], pts[2]), leftOf(pts[1], pts[2]),
      fromBorder(U, Uq, 8), fromBorder(L, Lq, 8))
  } else if (pts.length === 4 && e.mid === 'h' && !e.detour) {
    const a = pts[1], b = pts[2]
    const towardB = b.x >= a.x
    out.push(box(towardB ? a.x + 8 : a.x - 8 - w, a.y - LABEL_H - 8),
      box(towardB ? b.x - 8 - w : b.x + 8, a.y + 8),
      rightOf(pts[0], pts[1]), leftOf(pts[0], pts[1]), rightOf(pts[2], pts[3]), leftOf(pts[2], pts[3]))
  } else {
    let best = 0, bestLen = -1
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
      if (len > bestLen) { bestLen = len; best = i }
    }
    const p = pts[best], q = pts[best + 1]
    if (p.y === q.y) out.push(above(p, q), below(p, q))
    else out.push(rightOf(p, q), leftOf(p, q))
  }
  return out
}

function placeLabels(edges, boxes) {
  const rects = [...boxes]
  for (const e of edges) for (const n of e.ends) { if (n.markerBox) rects.push(n.markerBox); if (n.cardBox) rects.push(n.cardBox) }
  const segments = edges.flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i], q]))
  for (const e of edges) {
    e.labelBox = null
    if (!e.label) continue
    const cands = labelCandidates(e)
    const clear = (c) => !rects.some((r) => rectsOverlap(c, r)) && !segments.some(([p, q]) => segmentCrosses(p, q, c))
    e.labelBox = cands.find(clear) ?? cands[0]
    rects.push(e.labelBox)
  }
}

// --- draw ----------------------------------------------------------------------

function headerPath(b) {
  const r = 6
  return `M${b.x} ${b.y + HEADER_H} V${b.y + r} a${r} ${r} 0 0 1 ${r} -${r} H${right(b) - r} a${r} ${r} 0 0 1 ${r} ${r} V${b.y + HEADER_H} Z`
}

export function draw(geo, ir) {
  const uid = `wu-d-${ir.id}`
  const muted = 'var(--wu-ink-3)'
  const parts = ['<defs>',
    `<marker id="${uid}-crow" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 6 L12 0 M0 6 L12 6 M0 6 L12 12" fill="none" stroke="currentColor" stroke-width="1"/></marker>`,
    `<marker id="${uid}-bar" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M6 0 L6 12" fill="none" stroke="currentColor" stroke-width="1"/></marker>`,
    `<marker id="${uid}-tri" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 0 L12 6 L0 12 z" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/></marker>`,
    `<marker id="${uid}-open" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 0 L12 6 L0 12" fill="none" stroke="currentColor" stroke-width="1"/></marker>`,
    '</defs>']
  for (const b of geo.geo.boxes) {
    const cls = b.emphasis ? ' class="wu-focal"' : ''
    const sw = b.emphasis ? 1.5 : 1
    parts.push(`<rect id="${uid}-${b.id}" data-tone="${esc(b.tone)}"${cls} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" fill="var(--wu-surface)" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<path id="${uid}-${b.id}-head" d="${headerPath(b)}" fill="var(--wu-fig-tone-${b.tone})" stroke="none"/>`)
    parts.push(`<line x1="${b.x}" y1="${b.y + HEADER_H}" x2="${right(b)}" y2="${b.y + HEADER_H}" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-${b.id}-label" x="${cx(b)}" y="${b.y + 18}" font-size="${FONT_SIZE}" font-weight="700" text-anchor="middle" fill="currentColor">${esc(b.label)}</text>`)
    b.rows.forEach((row, i) => {
      const y = b.y + row.top + 14
      let x = b.x + PAD
      if (row.tag) {
        parts.push(`<text x="${x}" y="${y}" font-size="${EDGE_LABEL_SIZE}" fill="${muted}">${esc(row.tag)}</text>`)
        x += TAG_W
      }
      const deco = row.key === 'pk' && ir.variant !== 'db' ? ' text-decoration="underline"' : ''
      parts.push(`<text id="${uid}-${b.id}-f${i}" x="${x}" y="${y}" font-size="${EDGE_LABEL_SIZE}"${deco} fill="currentColor">${esc(row.text)}</text>`)
      if (row.right) parts.push(`<text x="${right(b) - PAD}" y="${y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="${muted}">${esc(row.right)}</text>`)
    })
    if (b.methodsTop !== undefined) {
      const sy = b.y + b.methodsTop - SEP_H / 2
      if (b.methodsSep) parts.push(`<line x1="${b.x}" y1="${sy}" x2="${right(b)}" y2="${sy}" stroke="currentColor" stroke-width="1"/>`)
      b.methods.forEach((m, i) => {
        parts.push(`<text id="${uid}-${b.id}-m${i}" x="${b.x + PAD}" y="${b.y + m.top + 14}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(m.text)}</text>`)
      })
    }
  }
  for (const e of geo.geo.edges) {
    const d = `M${e.points[0].x} ${e.points[0].y} ${e.points.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`
    const dash = e.dash ? ' stroke-dasharray="5 4"' : ''
    const ms = e.ends[0].marker ? ` marker-start="url(#${uid}-${e.ends[0].marker})"` : ''
    const me = e.ends[1].marker ? ` marker-end="url(#${uid}-${e.ends[1].marker})"` : ''
    parts.push(`<path id="${uid}-r${e.index}" d="${d}" fill="none" stroke="currentColor" stroke-width="1"${dash}${ms}${me}/>`)
    e.ends.forEach((n, k) => {
      if (!n.cardBox) return
      const c = n.cardBox
      const x = n.cardAnchor === 'end' ? c.x + c.width : c.x
      parts.push(`<text id="${uid}-r${e.index}-c${k}" x="${x}" y="${c.y + 10}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${n.cardAnchor}" fill="currentColor">${esc(n.card)}</text>`)
    })
    if (e.labelBox) {
      const l = e.labelBox
      parts.push(`<text id="${uid}-r${e.index}-label" x="${l.x + 4}" y="${l.y + 12}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(l.text)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------------

function warnRow(id, name, budget, key, okDetail) {
  const w = budget.find((b) => b.key === key)
  return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
}

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 4).join('; '), hint: ok ? undefined : hint }
}

function onBorder(p, b) {
  const onX = p.x >= b.x && p.x <= right(b)
  const onY = p.y >= b.y && p.y <= bottom(b)
  return (onX && (p.y === b.y || p.y === bottom(b))) || (onY && (p.x === b.x || p.x === right(b)))
}

export function verify(geo, ir) {
  const { boxes, edges, variant } = geo.geo
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const budget = budgetWarnings(ir)
  const maxFields = Math.max(0, ...ir.entities.map((e) => e.fields.length))
  const rows = [
    warnRow(1, 'entity-count', budget, 'budget:entities', `${ir.entities.length} entities`),
    warnRow(2, 'field-count', budget, 'budget:fields', `at most ${maxFields} fields per entity`),
    warnRow(3, 'relation-count', budget, 'budget:relations', `${ir.relations.length} relations`),
    warnRow(4, 'label-length', budget, 'budget:label', `every label within ${limits.maxLabelLen} chars`),
    warnRow(5, 'emphasis-count', budget, 'budget:emphasis', `${ir.entities.filter((e) => e.emphasis).length} emphasized entities`),
  ]

  const refs = []
  for (const e of edges) {
    if (!byId.has(e.from)) refs.push(`relation ${e.index} starts at unknown entity "${e.from}"`)
    if (!byId.has(e.to)) refs.push(`relation ${e.index} ends at unknown entity "${e.to}"`)
  }
  for (const ent of ir.entities) if (!byId.has(ent.id)) refs.push(`entity "${ent.id}" has no box`)
  rows.push(failRow(6, 'relation-refs', refs, 'every relation joins two laid-out entities', 'relations must name entity ids that exist in the geometry'))

  const overlap = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsOverlap(boxes[i], boxes[j])) overlap.push(`"${boxes[i].id}" overlaps "${boxes[j].id}"`)
    }
  }
  rows.push(failRow(7, 'box-overlap', overlap, 'no two entity boxes overlap', 'entity boxes must be separated — check the elk spacing in place()'))

  const fit = []
  for (const b of boxes) {
    const inner = b.width - PAD * 2
    const labelW = Math.ceil(textWidth(b.label, FONT_SIZE) * BOLD_FACTOR)
    if (labelW > inner) fit.push(`label of "${b.id}" is wider than its box`)
    for (const row of b.rows) {
      const need = (row.tag ? TAG_W : 0) + w11(row.text) + (row.right ? TYPE_GAP + w11(row.right) : 0)
      if (need > inner) fit.push(`field "${row.text}" of "${b.id}" is wider than its box`)
      if (row.top + ROW_H > b.height) fit.push(`field "${row.text}" of "${b.id}" falls below its box`)
    }
    for (const m of b.methods) {
      if (w11(m.text) > inner) fit.push(`method "${m.text}" of "${b.id}" is wider than its box`)
      if (m.top + ROW_H > b.height) fit.push(`method "${m.text}" of "${b.id}" falls below its box`)
    }
  }
  rows.push(failRow(8, 'field-fit', fit, 'every field and method line sits inside its box', 'size the box from its longest line — check measureEntity()'))

  const shape = []
  const cross = []
  for (const e of edges) {
    const A = byId.get(e.from), B = byId.get(e.to)
    if (!A || !B) continue
    if (e.points.length < 2) { shape.push(`relation ${e.index} has fewer than 2 points`); continue }
    for (let i = 0; i < e.points.length - 1; i++) {
      const p = e.points[i], q = e.points[i + 1]
      if (p.x !== q.x && p.y !== q.y) shape.push(`relation ${e.index} segment ${i} is diagonal`)
    }
    if (!onBorder(e.points[0], A)) shape.push(`relation ${e.index} does not start on the border of "${A.id}"`)
    if (!onBorder(e.points[e.points.length - 1], B)) shape.push(`relation ${e.index} does not end on the border of "${B.id}"`)
    if (!routeIsClear(e.points, A, B, boxes)) cross.push(`relation ${e.index} ("${e.from}"→"${e.to}") runs through an entity box`)
  }
  rows.push(failRow(9, 'edges-orthogonal', shape, 'every relation is orthogonal and attaches to both box borders', 'route relations with axis-aligned segments that start and end on the box borders'))
  rows.push(failRow(10, 'edge-clearance', cross, 'no relation crosses an entity box', 'pick a detour route, or reorder the entities so a clear route exists'))

  const labelHits = []
  for (const e of edges) {
    if (!e.labelBox) continue
    for (const b of boxes) if (rectsOverlap(e.labelBox, b)) labelHits.push(`label of relation ${e.index} overlaps "${b.id}"`)
  }
  rows.push(failRow(11, 'label-clear', labelHits, 'every relation label is clear of the entity boxes', 'widen the layer gap or shorten the label'))

  const markerHits = []
  const decorations = edges.flatMap((e) => e.ends.flatMap((n, k) => [
    n.markerBox && { rect: n.markerBox, what: `the ${k ? 'end' : 'start'} marker of relation ${e.index}` },
    n.cardBox && { rect: n.cardBox, what: `the ${k ? 'end' : 'start'} cardinality of relation ${e.index}` },
  ].filter(Boolean)))
  for (const e of edges) {
    if (!e.labelBox) continue
    for (const d of decorations) if (rectsOverlap(e.labelBox, d.rect)) markerHits.push(`label of relation ${e.index} overlaps ${d.what}`)
  }
  rows.push(failRow(12, 'marker-label-clear', markerHits, `no end marker or cardinality text overlaps a label (${variant})`, 'move the label away from the line ends — labels sit above the upper segment, cardinalities below it'))
  return rows
}

export const doc = {
  purpose: 'entity boxes with a field list and typed relations — ER / data model (er), UML class (class), database schema (db)',
  whenToUse: 'when the decision is about *what the data is and how it relates* — table ownership, a type/inheritance design, a schema change. Not for flow (use diagram) or call order (use sequence). Budgets: entities ≤ 8, fields per entity ≤ 8, relations ≤ 12, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: order-model
type: schema
title: 注文まわりのデータモデル
caption: 明細は注文の中でだけ意味を持つ
variant: er
entities:
  - id: customer
    label: 顧客
    fields:
      - name: id
        type: uuid
        key: pk
      - name: name
        type: text
  - id: order
    label: 注文
    emphasis: true
    fields:
      - name: id
        type: uuid
        key: pk
      - name: customer_id
        type: uuid
        key: fk
      - name: status
        type: enum
  - id: line
    label: 明細
    fields:
      - name: order_id
        type: uuid
        key: fk
      - name: product_id
        type: uuid
        key: fk
      - name: qty
        type: int
  - id: product
    label: 商品
    fields:
      - name: id
        type: uuid
        key: pk
      - name: price
        type: money
relations:
  - from: customer
    to: order
    kind: one-many
    label: 発注
  - from: order
    to: line
    kind: one-many
  - from: product
    to: line
    kind: one-many
`,
  rows: ['entity-count', 'field-count', 'relation-count', 'label-length', 'emphasis-count', 'relation-refs', 'box-overlap', 'field-fit', 'edges-orthogonal', 'edge-clearance', 'label-clear', 'marker-label-clear'],
}
