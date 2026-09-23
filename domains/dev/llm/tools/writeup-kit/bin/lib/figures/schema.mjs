// `type: schema` — entity boxes with a field list and typed relations. One
// plugin covers three notations through `variant`:
//
//   er     (default) — ER / data model: header + fields, crow's foot / bar
//                      at the line ends plus the cardinality as text
//   class  — UML class: header + attributes + methods section, hollow
//            triangle for inheritance, dashed open arrow for `uses`,
//            filled / hollow diamond at the owner end for composition /
//            aggregation, multiplicities as text only (no crow's foot)
//   db     — database schema: header + columns with PK/FK tags, crow's
//            foot / bar at the line ends, no cardinality text; a relation
//            joins the two *rows* it is about (the child's FK row and the
//            parent's PK row) and carries its ON DELETE rule as a muted tag
//
// IR shape: `{ id, type:'schema', title, caption, variant, direction,
// entities, relations }`. An entity is `{ id, label, fields:[{ name, type?,
// key?: pk|fk, note? }], methods:[string], emphasis, tone }`; a relation is
// `{ from, to, kind: one-many|many-many|one-one|inherits|uses|composition|
// aggregation, label, from_card?, to_card?, onDelete? }` — `from` is the
// "one" side of a one-many and the owner (diamond) side of a composition /
// aggregation. `composition`/`aggregation` are class-only, `onDelete` is
// db-only; either outside its variant is a schema error.
//
// Vocabulary: `entities` / `entity-count` keep the ER term because the IR
// name is public (renaming it would break every stored figure) — the kit
// wording rule is waived for this one type.
//
// Layout: boxes are sized from their longest field line (kit text-width
// estimate), placed by the vendored elk layered engine (the same file
// diagram.mjs loads — only node positions are taken from it), and joined
// by orthogonal relations the plugin routes itself: straight, Z through
// the layer gap, or a detour around the outside; ports fan out along a
// box side (in db they are pinned to the joined rows and only the left /
// right sides are used, so the line meets the column it is about);
// parallel mid-segments spread onto lanes. Every position sits on the 4px
// grid. End markers, cardinality text, ON DELETE tags and labels are
// placed so they never overlap (verify rows 10–13).
//
// A field (or method) list longer than the per-entity budget is drawn as
// the first N lines plus a muted `+M more` row — the full count still
// drives the budget warning, and a relation that would land on a hidden
// row anchors to the `+M more` row instead.
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

// A db schema and a class diagram are read differently from an ER sketch:
// a physical schema stops being readable past five tables, and a class
// diagram past five members per compartment. `limits` above is the er
// baseline (and what --list-types prints); these override it per variant.
const VARIANT_LIMITS = {
  db: { maxEntities: 5, maxRelations: 6 },
  class: { maxEntities: 7, maxFields: 5, maxRelations: 8 },
}

const limitsFor = (variant) => ({ ...limits, ...(VARIANT_LIMITS[variant] || {}) })

const VARIANTS = new Set(['er', 'class', 'db'])
const DIRECTIONS = new Set(['auto', 'right', 'down'])
const REL_KINDS = new Set(['one-many', 'many-many', 'one-one', 'inherits', 'uses', 'composition', 'aggregation'])
const REL_KIND_WORDING = 'one-many|many-many|one-one|inherits|uses|composition|aggregation'
const CLASS_ONLY_KINDS = new Set(['composition', 'aggregation'])
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
  const relations = normalizeRelations(raw.relations, seen, ctx, variant)
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

function normalizeRelations(raw, ids, ctx, variant) {
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
    const kind = normalizeEnum(r.kind, REL_KINDS, 'one-many', `${rctx}.kind`, REL_KIND_WORDING)
    if (CLASS_ONLY_KINDS.has(kind) && variant !== 'class') throw new IrError(`${rctx}.kind: ${kind} belongs to variant: class`)
    const onDelete = optStr(r, 'onDelete', rctx)
    if (onDelete !== undefined && variant !== 'db') throw new IrError(`${rctx}.onDelete belongs to variant: db`)
    if (onDelete !== undefined && onDelete.trim() === '') throw new IrError(`${rctx}.onDelete must be a non-empty string`)
    return { from, to, kind, label: optStr(r, 'label', rctx) ?? '', from_card: optCard(r, 'from_card', rctx), to_card: optCard(r, 'to_card', rctx), onDelete }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const lim = limitsFor(ir.variant)
  const n = ir.entities.length
  if (n > lim.maxEntities) {
    out.push(budgetWarning('budget:entities', n, lim.maxEntities,
      `${n} entities (guidance ≤ ${lim.maxEntities} for variant: ${ir.variant})`,
      'split the model by ownership, or drop the lookup tables'))
  }
  // one compartment at a time: fields, and (class only) methods
  const sections = ir.entities.flatMap((e) => [
    { id: e.id, what: 'fields', count: e.fields.length },
    ...(ir.variant === 'class' ? [{ id: e.id, what: 'methods', count: e.methods.length }] : []),
  ])
  const widest = sections.reduce((m, s) => (s.count > (m ? m.count : 0) ? s : m), null)
  if (widest && widest.count > lim.maxFields) {
    out.push(budgetWarning('budget:fields', widest.count, lim.maxFields,
      `entity "${widest.id}" lists ${widest.count} ${widest.what} (guidance ≤ ${lim.maxFields})`,
      `keep the keys and the ${widest.what} the decision is about in "${widest.id}"; the rest collapse into a "+N more" row`))
  }
  if (ir.relations.length > lim.maxRelations) {
    out.push(budgetWarning('budget:relations', ir.relations.length, lim.maxRelations,
      `${ir.relations.length} relations (guidance ≤ ${lim.maxRelations} for variant: ${ir.variant})`,
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

/** The first `max` items plus how many were left out. */
function collapse(items, max) {
  if (items.length <= max) return { shown: items, hidden: 0 }
  return { shown: items.slice(0, max), hidden: items.length - max }
}

const moreText = (hidden) => `+${hidden} more`

function measureEntity(e, variant) {
  const max = limitsFor(variant).maxFields
  const f = collapse(e.fields, max)
  const m = collapse(e.methods, max)
  const labelW = Math.ceil(textWidth(e.label, FONT_SIZE) * BOLD_FACTOR)
  const extra = [f.hidden, m.hidden].filter(Boolean).map((h) => w11(moreText(h)))
  const lines = [labelW, ...f.shown.map((x) => fieldLineWidth(x, variant)), ...m.shown.map(w11), ...extra]
  const width = snapUp4(Math.max(MIN_W, Math.max(...lines) + PAD * 2))
  const showMethods = variant === 'class' && e.methods.length > 0
  const rows = f.shown.map((x, i) => ({ ...x, top: HEADER_H + i * ROW_H, text: x.name, right: rightText(x), tag: variant === 'db' && x.key ? x.key.toUpperCase() : '' }))
  if (f.hidden) rows.push({ name: moreText(f.hidden), text: moreText(f.hidden), right: '', tag: '', top: HEADER_H + rows.length * ROW_H, more: true, hidden: f.hidden })
  // the separator band exists only between two non-empty sections
  const sep = showMethods && rows.length > 0 ? SEP_H : 0
  const methodsTop = HEADER_H + rows.length * ROW_H + sep
  const methods = showMethods ? m.shown.map((x, i) => ({ text: x, top: methodsTop + i * ROW_H })) : []
  if (showMethods && m.hidden) methods.push({ text: moreText(m.hidden), top: methodsTop + methods.length * ROW_H, more: true, hidden: m.hidden })
  const bodyEnd = showMethods ? methodsTop + methods.length * ROW_H : HEADER_H + rows.length * ROW_H
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
  const annotW = Math.max(0, ...ir.relations.map((r) => (r.onDelete ? w11(odText(r)) + 12 : 0)))
  const maxLabelW = Math.max(0, annotW, ...ir.relations.map((r) => (r.label ? w11(r.label) + 8 : 0)))
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

  // db: the ports are the rows the relation is about, so there is nothing
  // to fan out — route once with the row y pinned and only the left/right
  // sides in play. Otherwise pass 1 routes with centered ports to learn
  // which side each relation leaves/enters, and pass 2 fans the ports out
  // along each side and routes again with the sides fixed.
  let edges
  if (ir.variant === 'db') {
    const entById = new Map(ir.entities.map((e) => [e.id, e]))
    const anchors = ir.relations.map((r) => rowAnchors(r, byId, entById))
    edges = ir.relations.map((r, i) => {
      const [a, b] = anchors[i]
      const e = routeEdge(r, i, byId, boxes, { pa: anchorY(byId.get(r.from), a.row), pb: anchorY(byId.get(r.to), b.row) }, true)
      e.anchors = anchors[i]
      return e
    })
  } else {
    const first = ir.relations.map((r, i) => routeEdge(r, i, byId, boxes, null))
    const ports = assignPorts(first, byId)
    edges = ir.relations.map((r, i) => routeEdge(r, i, byId, boxes, ports.get(i)))
  }
  spreadMids(edges)

  for (const e of edges) decorate(e, ir)
  placeEndTexts(edges, boxes)
  placeLabels(edges, boxes)

  // Translate so nothing sits closer than 8px to the top-left, then size
  // the canvas from everything drawn.
  const rects = () => [
    ...boxes,
    ...edges.flatMap((e) => [e.labelBox, ...e.ends.map((n) => n.markerBox), ...e.ends.map((n) => n.cardBox), ...e.ends.map((n) => n.odBox)].filter(Boolean)),
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
      if (n.odBox) { n.odBox.x += dx; n.odBox.y += dy }
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
  if (kinds.has('composition')) items.push({ label: 'composition', marker: 'dia' })
  if (kinds.has('aggregation')) items.push({ label: 'aggregation', marker: 'dia-open' })
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

/** Side pairs to try, most natural first, given where B sits relative to A.
 * `horizontalOnly` (db) keeps every port on a left/right side so it can sit
 * on a field row. */
function sidePairs(A, B, horizontalOnly = false) {
  const pairs = []
  if (B.x >= right(A)) pairs.push(['right', 'left'])
  if (right(B) <= A.x) pairs.push(['left', 'right'])
  if (horizontalOnly) {
    pairs.push(['right', 'right'], ['left', 'left'])
    return pairs
  }
  if (B.y >= bottom(A)) pairs.push(['bottom', 'top'])
  if (bottom(B) <= A.y) pairs.push(['top', 'bottom'])
  pairs.push(['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right'])
  return pairs
}

/** Where on a box side the relation attaches: the middle of the row it
 * joins (rows are ROW_H tall and start on the 4px grid, so top + 12 is on
 * the grid too), or the side's centre when the entity lists no fields. */
const ROW_ANCHOR = 12
const anchorY = (box, row) => (row === null ? cy(box) : snap4(box.y + box.rows[row].top + ROW_ANCHOR))

/** `user_id` refers to `users`; `id` refers to nothing. */
const stem = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/id$/, '').replace(/s$/, '')
function refersTo(fieldName, other) {
  const f = stem(fieldName)
  if (!f) return false
  return [other.id, other.label].some((cand) => {
    const c = stem(cand)
    return !!c && (c === f || c.startsWith(f) || f.startsWith(c))
  })
}

/** The row index a db relation end attaches to: the key row that names the
 * other table, else the first row with that key, else the first row — and
 * the "+N more" row when the field it wants is collapsed away. */
function anchorIndex(box, ent, key, other) {
  if (!box.rows.length) return null
  const visible = box.rows.filter((r) => !r.more).length
  const fields = ent.fields
  const keyed = fields.filter((f) => f.key === key)
  const target = keyed.find((f) => refersTo(f.name, other)) ?? keyed[0] ?? fields.find((f) => refersTo(f.name, other))
  if (!target) return 0
  const idx = fields.indexOf(target)
  if (idx < visible) return idx
  const more = box.rows.findIndex((r) => r.more)
  return more >= 0 ? more : visible - 1
}

/** [parent end, child end] — `from` is the "one" side, so its PK row and
 * the child's FK row are what the line is about. */
function rowAnchors(r, byId, entById) {
  const A = byId.get(r.from), B = byId.get(r.to)
  const ref = (box, row) => ({ box: box.id, row, name: row === null ? '' : box.rows[row].text })
  return [ref(A, anchorIndex(A, entById.get(r.from), 'pk', B)), ref(B, anchorIndex(B, entById.get(r.to), 'fk', A))]
}

function routeEdge(r, index, byId, boxes, port, horizontalOnly = false) {
  const A = byId.get(r.from), B = byId.get(r.to)
  const pairs = port?.sides ? [port.sides] : sidePairs(A, B, horizontalOnly)
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

/** The ON DELETE rule as it reads on a schema print-out. */
const odText = (r) => (r.onDelete ? r.onDelete.trim().toUpperCase() : '')

function markersOf(r, variant) {
  if (r.kind === 'inherits') return [null, 'tri']
  if (r.kind === 'uses') return [null, 'open']
  // the diamond sits at the owner end — `from` is the whole, `to` the part
  if (r.kind === 'composition') return ['dia', null]
  if (r.kind === 'aggregation') return ['dia-open', null]
  if (variant === 'class') return [null, null]
  if (r.kind === 'one-many') return ['bar', 'crow']
  if (r.kind === 'many-many') return ['crow', 'crow']
  return ['bar', 'bar']
}

/** Text set just past the end marker, below the line (horizontal ends) or
 * on the side away from the next bend (vertical ends), so it never meets
 * the label, which starts on the bend's side. */
function endTextBox(text, P, Q, R, dir, horizontal) {
  const cw = w11(text)
  if (horizontal) {
    return {
      box: { x: dir > 0 ? P.x + MARKER + 4 : P.x - MARKER - 4 - snapUp4(cw), y: P.y + 8, width: cw, height: CARD_H },
      anchor: dir > 0 ? 'start' : 'end',
    }
  }
  const leftSide = !R || R.x >= Q.x
  return {
    box: { x: leftSide ? P.x - 8 - snapUp4(cw) : P.x + 8, y: dir > 0 ? P.y + MARKER + 4 : P.y - MARKER - 4 - CARD_H, width: cw, height: CARD_H },
    anchor: leftSide ? 'end' : 'start',
  }
}

function decorate(e, ir) {
  const r = ir.relations[e.index]
  const cards = cardsOf(r, ir.variant)
  const markers = markersOf(r, ir.variant)
  const od = ir.variant === 'db' ? odText(r) : ''
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
    const cardAt = card ? endTextBox(card, P, Q, R, dir, horizontal) : null
    // the ON DELETE rule belongs to the child end — the row that loses its
    // parent — so it only ever hangs off end 1
    const onDelete = k === 1 && od ? od : ''
    const odAt = onDelete ? endTextBox(onDelete, P, Q, R, dir, horizontal) : null
    return {
      x: P.x, y: P.y, side: e.sides[k], marker, markerBox,
      card, cardBox: cardAt ? cardAt.box : null, cardAnchor: cardAt ? cardAt.anchor : 'start',
      onDelete, odBox: odAt ? odAt.box : null, odAnchor: odAt ? odAt.anchor : 'start',
    }
  })
}

/** The four spots an ON DELETE tag may take, most conventional first:
 * below the line just past the marker, above it, then the same two a step
 * further along the line. */
function odCandidates(e, k, w) {
  const pts = e.points
  const P = k === 0 ? pts[0] : pts[pts.length - 1]
  const Q = k === 0 ? pts[1] : pts[pts.length - 2]
  const R = k === 0 ? pts[2] : pts[pts.length - 3]
  const horizontal = P.y === Q.y
  const dir = horizontal ? Math.sign(Q.x - P.x) : Math.sign(Q.y - P.y)
  const out = []
  const box = (x, y, anchor) => out.push({ x: snap4(x), y: snap4(y), width: w, height: CARD_H, anchor })
  if (horizontal) {
    const anchor = dir > 0 ? 'start' : 'end'
    for (const step of [0, 24, 48, 72]) {
      const x = dir > 0 ? P.x + MARKER + 4 + step : P.x - MARKER - 4 - snapUp4(w) - step
      box(x, P.y + 8, anchor)
      box(x, P.y - 8 - CARD_H, anchor)
    }
  } else {
    const near = !R || R.x >= Q.x
    for (const step of [0, 24, 48, 72]) {
      const y = dir > 0 ? P.y + MARKER + 4 + step : P.y - MARKER - 4 - CARD_H - step
      box(near ? P.x - 8 - snapUp4(w) : P.x + 8, y, near ? 'end' : 'start')
      box(near ? P.x + 8 : P.x - 8 - snapUp4(w), y, near ? 'start' : 'end')
    }
  }
  return out
}

/** ON DELETE tags sit in the layer gap the relations run through, so each
 * one takes the first of its spots that is clear of the boxes, the other
 * tags and every line. */
function placeEndTexts(edges, boxes) {
  const segments = edges.flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i], q]))
  const taken = []
  for (const e of edges) {
    e.ends.forEach((n, k) => {
      if (!n.odBox) return
      const cands = odCandidates(e, k, n.odBox.width)
      const clear = (c) => !boxes.some((b) => rectsOverlap(c, b)) && !taken.some((t) => rectsOverlap(c, t))
        && !segments.some(([p, q]) => segmentCrosses(p, q, c))
      const pick = cands.find(clear) ?? cands[0]
      n.odBox = { x: pick.x, y: pick.y, width: pick.width, height: pick.height }
      n.odAnchor = pick.anchor
      taken.push(n.odBox)
    })
  }
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
  for (const e of edges) for (const n of e.ends) { if (n.markerBox) rects.push(n.markerBox); if (n.cardBox) rects.push(n.cardBox); if (n.odBox) rects.push(n.odBox) }
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
    `<marker id="${uid}-dia" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 6 L6 1 L12 6 L6 11 z" fill="currentColor" stroke="currentColor" stroke-width="1"/></marker>`,
    `<marker id="${uid}-dia-open" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 6 L6 1 L12 6 L6 11 z" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/></marker>`,
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
      parts.push(`<text id="${uid}-${b.id}-f${i}" x="${x}" y="${y}" font-size="${EDGE_LABEL_SIZE}"${deco} fill="${row.more ? muted : 'currentColor'}">${esc(row.text)}</text>`)
      if (row.right) parts.push(`<text x="${right(b) - PAD}" y="${y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="${muted}">${esc(row.right)}</text>`)
    })
    if (b.methodsTop !== undefined) {
      const sy = b.y + b.methodsTop - SEP_H / 2
      if (b.methodsSep) parts.push(`<line x1="${b.x}" y1="${sy}" x2="${right(b)}" y2="${sy}" stroke="currentColor" stroke-width="1"/>`)
      b.methods.forEach((m, i) => {
        parts.push(`<text id="${uid}-${b.id}-m${i}" x="${b.x + PAD}" y="${b.y + m.top + 14}" font-size="${EDGE_LABEL_SIZE}" fill="${m.more ? muted : 'currentColor'}">${esc(m.text)}</text>`)
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
      if (n.cardBox) {
        const c = n.cardBox
        const x = n.cardAnchor === 'end' ? c.x + c.width : c.x
        parts.push(`<text id="${uid}-r${e.index}-c${k}" x="${x}" y="${c.y + 10}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${n.cardAnchor}" fill="currentColor">${esc(n.card)}</text>`)
      }
      if (n.odBox) {
        const o = n.odBox
        const x = n.odAnchor === 'end' ? o.x + o.width : o.x
        parts.push(`<text id="${uid}-r${e.index}-od" x="${x}" y="${o.y + 10}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${n.odAnchor}" fill="${muted}">${esc(n.onDelete)}</text>`)
      }
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
    n.odBox && { rect: n.odBox, what: `the ON DELETE tag of relation ${e.index}` },
  ].filter(Boolean)))
  for (const e of edges) {
    if (!e.labelBox) continue
    for (const d of decorations) if (rectsOverlap(e.labelBox, d.rect)) markerHits.push(`label of relation ${e.index} overlaps ${d.what}`)
  }
  // the ON DELETE tag hangs in the gap the relations run through
  const segments = edges.flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i], q]))
  for (const e of edges) {
    for (const n of e.ends) {
      if (!n.odBox) continue
      for (const b of boxes) if (rectsOverlap(n.odBox, b)) markerHits.push(`the ON DELETE tag of relation ${e.index} overlaps "${b.id}"`)
      if (segments.some(([p, q]) => segmentCrosses(p, q, n.odBox))) markerHits.push(`the ON DELETE tag of relation ${e.index} sits on a relation line`)
    }
  }
  rows.push(failRow(12, 'marker-label-clear', markerHits, `no end marker, cardinality or ON DELETE text overlaps a label (${variant})`, 'move the label away from the line ends — labels sit above the upper segment, cardinalities below it'))

  // db: the line has to touch the row it is about; class: the diamond has
  // to sit at the owner (from) end.
  const anchored = []
  for (const e of edges) {
    if (variant === 'db') {
      if (!e.anchors) { anchored.push(`relation ${e.index} names no rows to join`); continue }
      e.anchors.forEach((a, k) => {
        const b = byId.get(a.box)
        if (!b) return
        if (e.sides[k] !== 'left' && e.sides[k] !== 'right') {
          anchored.push(`relation ${e.index} leaves "${a.box}" on its ${e.sides[k]} side, off the rows`)
          return
        }
        const P = k === 0 ? e.points[0] : e.points[e.points.length - 1]
        const rowTop = a.row === null ? null : b.y + b.rows[a.row].top
        const ok = rowTop === null ? P.y === cy(b) : P.y >= rowTop && P.y <= rowTop + ROW_H
        if (!ok) anchored.push(`relation ${e.index} misses the "${a.name || 'centre'}" row of "${a.box}"`)
      })
    }
    const kind = ir.relations[e.index]?.kind
    if (kind === 'composition' || kind === 'aggregation') {
      const want = kind === 'composition' ? 'dia' : 'dia-open'
      if (e.ends[0].marker !== want) anchored.push(`relation ${e.index} (${kind}) has no diamond at the "${e.from}" end`)
      if (e.ends[1].marker) anchored.push(`relation ${e.index} (${kind}) marks the "${e.to}" (part) end`)
    }
  }
  const anchorOk = variant === 'db' ? 'every relation meets the key row it joins' : 'every diamond sits at the owner end'
  rows.push(failRow(13, 'end-anchors', anchored, `${anchorOk} (${variant})`, 'in db a relation joins the child FK row to the parent PK row — check rowAnchors(); the diamond of a composition/aggregation belongs at the `from` end'))
  return rows
}

export const doc = {
  purpose: 'entity boxes with a field list and typed relations — ER / data model (er), UML class (class), database schema (db)',
  whenToUse: 'when the decision is about *what the data is and how it relates* — table ownership, a type/inheritance design, a schema change. Not for flow (use diagram) or call order (use sequence). variant: db joins the child FK row to the parent PK row (not box to box) and draws each relation\'s `onDelete` (cascade / restrict / set null) as a muted CASCADE tag at the child end; variant: class adds `composition` (filled diamond) and `aggregation` (hollow diamond) at the owner (`from`) end next to `inherits` (hollow triangle) and `uses` (dashed open arrow). A compartment longer than its budget shows the first N lines and a muted "+M more" row. Budgets: entities ≤ 8 (db 5, class 7), fields per entity ≤ 8 (class 5 per compartment), relations ≤ 12 (db 6, class 8), label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
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
  rows: ['entity-count', 'field-count', 'relation-count', 'label-length', 'emphasis-count', 'relation-refs', 'box-overlap', 'field-fit', 'edges-orthogonal', 'edge-clearance', 'label-clear', 'marker-label-clear', 'end-anchors'],
}
