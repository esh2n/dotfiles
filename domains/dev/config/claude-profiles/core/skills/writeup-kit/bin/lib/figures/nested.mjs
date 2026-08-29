// `type: nested` — containment boxes: what sits inside what. A root box
// holds child boxes, which may hold their own (three levels at most), and
// the reader learns scope, boundaries and responsibilities from the
// nesting alone. Optional edges connect any two boxes with an orthogonal
// arrow that runs between box borders through the gaps, never across a
// sibling or a title band.
//
// IR shape: `{ id, type:'nested', title, caption, direction, root, edges }`.
// `root` is `{ id, label, tone, emphasis, children: [same shape] }`;
// `edges` is `[{ from, to, label }]`; `direction` is `down` (children in
// a column), `right` (a row) or `auto` (a row up to 3 children, else a
// 2-column grid). Every box id is unique across the whole tree.
//
// Layout is a deterministic bottom-up measure / top-down place: a leaf is
// sized from its label like a diagram node, a container from its children
// plus the group-box metrics diagram.mjs uses (36px title band, 16px
// padding). Everything lands on the 4px grid.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, nodeSize, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'nested'

export const limits = { maxBoxes: 12, maxDepth: 3, maxLabelLen: 14, maxEmphasis: 2 }

const DIRECTIONS = new Set(['auto', 'down', 'right'])
const MAX_EDGES = 6
const MARGIN = 8
const TITLE_BAND = 36     // diagram.mjs GROUP_HEADER
const PAD = 16            // diagram.mjs GROUP_PAD
const GAP = 16            // between siblings (a detour edge runs at GAP/2)
const LEAF_MIN_W = 96
const LEAF_H = 40
const MIN_CLEARANCE = 8   // containment rule: child sits ≥ 8px inside its parent
const EDGE_LABEL_H = 16
const ROW_WRAP = 2        // auto mode: children per row once there are more than 3
const LANE = 24           // one detour edge lane: 16px label strip + line + clearance

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const direction = normalizeDirection(raw.direction, ctx)
  if (!isObj(raw.root)) throw new IrError(`${ctx}.root is required and must be a mapping`)
  const seen = new Set()
  const root = normalizeBox(raw.root, `${ctx}.root`, 1, seen)
  const edges = normalizeEdges(raw.edges, root, ctx)
  return { id, type, title, caption, direction, root, edges }
}

function normalizeDirection(v, ctx) {
  if (v === undefined || v === null) return 'auto'
  if (typeof v !== 'string' || !DIRECTIONS.has(v)) {
    throw new IrError(`${ctx}.direction must be down|right (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeBox(raw, ctx, level, seen) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  if (level > limits.maxDepth) throw new IrError(`${ctx}: nesting exceeds ${limits.maxDepth} levels`)
  const id = requireStr(raw, 'id', ctx)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new IrError(`${ctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
  if (seen.has(id)) throw new IrError(`duplicate box id: "${id}"`)
  seen.add(id)
  const label = requireStr(raw, 'label', ctx)
  const tone = validateTone(raw.tone, ctx)
  const emphasis = validateBool(raw, 'emphasis', ctx)
  let children = []
  if (raw.children !== undefined && raw.children !== null) {
    if (!Array.isArray(raw.children)) throw new IrError(`${ctx}.children must be a list`)
    children = raw.children.map((c, i) => normalizeBox(c, `${ctx}.children[${i}]`, level + 1, seen))
  }
  return { id, label, tone, emphasis, children }
}

function normalizeEdges(raw, root, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.edges must be a list`)
  const parents = parentMap(root)
  const contains = (a, b) => { // is `a` an ancestor of `b`?
    for (let p = parents.get(b); p !== undefined; p = parents.get(p)) if (p === a) return true
    return false
  }
  return raw.map((e, i) => {
    const ectx = `${ctx}.edges[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const from = requireStr(e, 'from', ectx)
    const to = requireStr(e, 'to', ectx)
    if (!parents.has(from)) throw new IrError(`${ectx}.from references unknown box "${from}"`)
    if (!parents.has(to)) throw new IrError(`${ectx}.to references unknown box "${to}"`)
    if (from === to) throw new IrError(`${ectx}: from and to must differ`)
    if (contains(from, to) || contains(to, from)) {
      throw new IrError(`${ectx}: "${from}" and "${to}" contain one another — nesting already shows that relation`)
    }
    const label = optStr(e, 'label', ectx) ?? ''
    return { from, to, label }
  })
}

/** Map of box id → parent id (root maps to undefined) over the whole tree. */
function parentMap(root) {
  const m = new Map([[root.id, undefined]])
  const walk = (box) => box.children.forEach((c) => { m.set(c.id, box.id); walk(c) })
  walk(root)
  return m
}

function flatten(root) {
  const out = []
  const walk = (box, level, parent) => {
    out.push({ box, level, parent })
    box.children.forEach((c) => walk(c, level + 1, box.id))
  }
  walk(root, 1, undefined)
  return out
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const all = flatten(ir.root)
  if (all.length > limits.maxBoxes) {
    out.push(budgetWarning('budget:boxes', all.length, limits.maxBoxes,
      `${all.length} box(es) (guidance ≤ ${limits.maxBoxes})`,
      'collapse a level, or split the figure at a service boundary'))
  }
  if (ir.edges.length > MAX_EDGES) {
    out.push(budgetWarning('budget:edges', ir.edges.length, MAX_EDGES,
      `${ir.edges.length} edge(s) (guidance ≤ ${MAX_EDGES})`,
      'keep only the edges that cross a boundary — inside-box flow belongs in a diagram'))
  }
  const longest = all.reduce((m, r) => ([...r.box.label].length > (m ? [...m.box.label].length : 0) ? r : m), null)
  if (longest && [...longest.box.label].length > limits.maxLabelLen) {
    const len = [...longest.box.label].length
    out.push(budgetWarning('budget:label', len, limits.maxLabelLen,
      `label of box "${longest.box.id}" is ${len} chars (guidance ≤ ${limits.maxLabelLen})`,
      `shorten label of box "${longest.box.id}"`))
  }
  const emphasized = all.filter((r) => r.box.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized box(es) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two boxes the decision is about'))
  }
  return out
}

// --- layout ----------------------------------------------------------------

function arrangeRows(count, direction) {
  const idx = Array.from({ length: count }, (_, i) => i)
  if (direction === 'down') return idx.map((i) => [i])
  if (direction === 'right' || count <= 3) return count ? [idx] : []
  const rows = []
  for (let i = 0; i < count; i += ROW_WRAP) rows.push(idx.slice(i, i + ROW_WRAP))
  return rows
}

/** Bottom-up: size every box from its label and children. Returns
 * `{ width, height, cells }` where `cells` is one entry per child with its
 * offset inside the parent and its (possibly stretched) size. `room` is the
 * per-container extra space edge lanes reserved (see layout()). */
function measure(box, direction, room) {
  const bold = box.emphasis
  if (box.children.length === 0) {
    return { ...nodeSize(box.label, { bold, minWidth: LEAF_MIN_W, height: LEAF_H }), cells: [] }
  }
  const r = room.get(box.id) ?? EMPTY_ROOM
  const gapX = GAP + r.gapX, gapY = GAP + r.gapY
  const sizes = box.children.map((c) => measure(c, direction, room))
  const rows = arrangeRows(sizes.length, direction)
  const gridded = direction === 'down' || (direction === 'auto' && sizes.length > 3)
  const colW = []
  if (gridded) {
    for (const row of rows) row.forEach((i, j) => { colW[j] = Math.max(colW[j] ?? 0, sizes[i].width) })
  }
  const cells = []
  let y = TITLE_BAND
  let contentW = 0
  for (const row of rows) {
    const rowH = Math.max(...row.map((i) => sizes[i].height))
    let x = PAD
    row.forEach((i, j) => {
      const w = gridded ? colW[j] : sizes[i].width
      cells[i] = { dx: x, dy: y, width: w, height: rowH, size: sizes[i] }
      x += w + gapX
    })
    contentW = Math.max(contentW, x - gapX - PAD)
    y += rowH + gapY
  }
  const labelW = Math.ceil(textWidth(box.label, FONT_SIZE) * BOLD_FACTOR)
  const width = snapUp4(Math.max(contentW, labelW) + PAD * 2 + r.right)
  const height = snapUp4(y - gapY + PAD + r.bottom)
  return { width, height, cells }
}

const EMPTY_ROOM = { bottom: 0, right: 0, gapX: 0, gapY: 0 }

/** Does the axis-aligned segment p→q pass through the open rect `r`? */
function overlapsSegment(r, p, q) {
  return segmentCrosses(p, q, r)
}

/** Top-down: absolute positions, all on the 4px grid (sizes are multiples
 * of 4 and the origin is snapped, so children inherit the grid). */
function place(box, size, x, y, level, parent, out) {
  const rec = {
    id: box.id, label: box.label, tone: box.tone, emphasis: box.emphasis, level, parent,
    x: snap4(x), y: snap4(y), width: size.width, height: size.height,
    container: box.children.length > 0,
    children: box.children.map((c) => c.id),
  }
  out.push(rec)
  box.children.forEach((c, i) => {
    const cell = size.cells[i]
    place(c, { width: cell.width, height: cell.height, cells: cell.size.cells }, rec.x + cell.dx, rec.y + cell.dy, level + 1, box.id, out)
  })
}

function build(ir, room, lanes) {
  const size = measure(ir.root, ir.direction, room)
  const boxes = []
  place(ir.root, size, MARGIN, MARGIN, 1, undefined, boxes)
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const edges = ir.edges.map((e, i) => routeEdge(e, i, byId, boxes, lanes.get(i)))
  return { size, boxes, edges }
}

/**
 * Two passes. The first lays the boxes out with the plain group metrics
 * and routes every edge; each edge that had to detour along a gap (below
 * a row or right of a column) is then given its own lane, and the
 * containers that gap belongs to reserve LANE px per lane (bottom padding
 * or row gap; right padding or column gap). The second pass lays out with
 * that room and routes again with the lanes fixed, so detours never share
 * a line and their labels have their own strip.
 */
export async function layout(ir) {
  const first = build(ir, new Map(), new Map())
  const { room, lanes } = reserveLanes(first, ir)
  const { size, boxes, edges } = lanes.size ? build(ir, room, lanes) : first
  const width = snapUp4(size.width + MARGIN * 2)
  const height = snapUp4(size.height + MARGIN * 2)
  return { width, height, geo: { boxes, edges } }
}

function reserveLanes(pass, ir) {
  const byId = new Map(pass.boxes.map((b) => [b.id, b]))
  const room = new Map()
  const lanes = new Map()
  const counts = { below: 0, right: 0 }
  const grow = (id, key, px) => {
    const r = { ...(room.get(id) ?? EMPTY_ROOM) }
    r[key] = Math.max(r[key], px)
    room.set(id, r)
  }
  for (const e of pass.edges) {
    if (!e.channel) continue
    const k = counts[e.channel]++
    lanes.set(e.index, { channel: e.channel, k })
    const labelW = e.label ? Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 8 : 0
    const need = e.channel === 'below' ? (k + 1) * LANE : (k + 1) * LANE + labelW
    // the channel segment is the middle one of the detour
    const p = e.points[1], q = e.points[2]
    for (const c of pass.boxes) {
      if (!c.container) continue
      const inside = e.channel === 'below'
        ? p.y > c.y && p.y < bottom(c) && Math.max(Math.min(p.x, q.x), c.x) < Math.min(Math.max(p.x, q.x), right(c))
        : p.x > c.x && p.x < right(c) && Math.max(Math.min(p.y, q.y), c.y) < Math.min(Math.max(p.y, q.y), bottom(c))
      if (!inside) continue
      const kids = c.children.map((id) => byId.get(id))
      // room is reserved by the innermost container(s) only: a channel
      // that runs inside a container child is that child's business
      if (kids.some((kid) => kid.container && overlapsSegment(kid, p, q))) continue
      const beyond = e.channel === 'below' ? kids.some((kid) => kid.y > p.y) : kids.some((kid) => kid.x > p.x)
      if (beyond) grow(c.id, e.channel === 'below' ? 'gapY' : 'gapX', need)
      else grow(c.id, e.channel === 'below' ? 'bottom' : 'right', need)
    }
  }
  return { room, lanes }
}

// --- edge routing ------------------------------------------------------------
//
// Candidates in order of preference — straight across a gap, an L through
// a gap, then a detour along the gap below / right / above / left. The
// first one that neither crosses an unrelated box or a title band nor
// re-enters an endpoint wins; the straight L is the fallback so a figure
// always draws (and the edge-clearance row then reports it).

const right = (b) => b.x + b.width
const bottom = (b) => b.y + b.height
const cx = (b) => snap4(b.x + b.width / 2)
const cy = (b) => snap4(b.y + b.height / 2)

function ancestors(id, byId) {
  const out = new Set()
  for (let p = byId.get(id)?.parent; p !== undefined; p = byId.get(p)?.parent) out.add(p)
  return out
}

/** Rects an edge between `from` and `to` must not run through: every box
 * that is neither an endpoint nor an ancestor of one, plus the title band
 * of every container (ancestors included — a line across a title is a
 * defect even when the box itself is allowed). */
function obstaclesFor(from, to, byId, boxes) {
  const allowed = new Set([from, to, ...ancestors(from, byId), ...ancestors(to, byId)])
  const out = []
  for (const b of boxes) {
    if (!allowed.has(b.id)) out.push({ id: b.id, kind: 'box', x: b.x, y: b.y, width: b.width, height: b.height })
    if (b.container) out.push({ id: b.id, kind: 'band', x: b.x, y: b.y, width: b.width, height: TITLE_BAND })
  }
  return out
}

/** Does the open segment p→q (axis-aligned) pass through the open rect? */
function segmentCrosses(p, q, r) {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x)
  const y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y)
  const rx2 = r.x + r.width, ry2 = r.y + r.height
  if (p.y === q.y) return p.y > r.y && p.y < ry2 && Math.max(x1, r.x) < Math.min(x2, rx2)
  if (p.x === q.x) return p.x > r.x && p.x < rx2 && Math.max(y1, r.y) < Math.min(y2, ry2)
  return true // diagonal — treated as crossing everything it spans
}

function dedupe(points) {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
}

function candidateRoutes(A, B, lane) {
  const laneAt = (channel) => (lane && lane.channel === channel ? GAP / 2 + 12 + lane.k * LANE : GAP / 2)
  const tag = (points, channel) => Object.assign(points, { channel })
  const yOverlap = [Math.max(A.y, B.y), Math.min(bottom(A), bottom(B))]
  const xOverlap = [Math.max(A.x, B.x), Math.min(right(A), right(B))]
  const routes = []
  // straight across a horizontal gap
  if (yOverlap[1] - yOverlap[0] >= 16) {
    const y = snap4((yOverlap[0] + yOverlap[1]) / 2)
    if (right(A) <= B.x) routes.push([{ x: right(A), y }, { x: B.x, y }])
    if (right(B) <= A.x) routes.push([{ x: A.x, y }, { x: right(B), y }])
  }
  // straight across a vertical gap
  if (xOverlap[1] - xOverlap[0] >= 16) {
    const x = snap4((xOverlap[0] + xOverlap[1]) / 2)
    if (bottom(A) <= B.y) routes.push([{ x, y: bottom(A) }, { x, y: B.y }])
    if (bottom(B) <= A.y) routes.push([{ x, y: A.y }, { x, y: bottom(B) }])
  }
  // one elbow: out of A sideways, into B from above/below
  const sideX = B.x >= right(A) ? right(A) : A.x
  const vertY = B.y >= bottom(A) ? B.y : bottom(B)
  routes.push([{ x: sideX, y: cy(A) }, { x: cx(B), y: cy(A) }, { x: cx(B), y: vertY }])
  // one elbow: out of A vertically, into B from the side
  const outY = B.y >= bottom(A) ? bottom(A) : A.y
  const inX = B.x >= right(A) ? B.x : right(B)
  routes.push([{ x: cx(A), y: outY }, { x: cx(A), y: cy(B) }, { x: inX, y: cy(B) }])
  // detours along the gap below / right / above / left
  const yBelow = snap4(Math.max(bottom(A), bottom(B)) + laneAt('below'))
  routes.push(tag([{ x: cx(A), y: bottom(A) }, { x: cx(A), y: yBelow }, { x: cx(B), y: yBelow }, { x: cx(B), y: bottom(B) }], 'below'))
  const xRight = snap4(Math.max(right(A), right(B)) + laneAt('right'))
  routes.push(tag([{ x: right(A), y: cy(A) }, { x: xRight, y: cy(A) }, { x: xRight, y: cy(B) }, { x: right(B), y: cy(B) }], 'right'))
  const yAbove = snap4(Math.min(A.y, B.y) - GAP / 2)
  routes.push([{ x: cx(A), y: A.y }, { x: cx(A), y: yAbove }, { x: cx(B), y: yAbove }, { x: cx(B), y: B.y }])
  const xLeft = snap4(Math.min(A.x, B.x) - GAP / 2)
  routes.push([{ x: A.x, y: cy(A) }, { x: xLeft, y: cy(A) }, { x: xLeft, y: cy(B) }, { x: B.x, y: cy(B) }])
  return routes.map((r) => tag(dedupe(r), r.channel)).filter((r) => r.length >= 2)
}

function routeIsClear(points, A, B, obstacles, root) {
  if (root && points.some((p) => p.x < root.x || p.x > right(root) || p.y < root.y || p.y > bottom(root))) return false
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], q = points[i + 1]
    if (p.x !== q.x && p.y !== q.y) return false
    if (segmentCrosses(p, q, A) || segmentCrosses(p, q, B)) return false
    if (obstacles.some((o) => segmentCrosses(p, q, o))) return false
  }
  return true
}

function edgeLabelBox(points, label) {
  if (!label) return undefined
  let best = 0
  let bestLen = -1
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y)
    if (len > bestLen) { bestLen = len; best = i }
  }
  const p = points[best], q = points[best + 1]
  const w = Math.ceil(textWidth(label, EDGE_LABEL_SIZE)) + 8
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
  if (p.y === q.y) return { x: snap4(mx - w / 2), y: snap4(my - EDGE_LABEL_H - 2), width: w, height: EDGE_LABEL_H, text: label, along: 'h' }
  return { x: snap4(mx + 6), y: snap4(my - EDGE_LABEL_H / 2), width: w, height: EDGE_LABEL_H, text: label, along: 'v' }
}

function routeEdge(e, index, byId, boxes, lane) {
  const A = byId.get(e.from), B = byId.get(e.to)
  const root = boxes[0]
  const obstacles = obstaclesFor(e.from, e.to, byId, boxes)
  const candidates = candidateRoutes(A, B, lane)
  const chosen = candidates.find((r) => routeIsClear(r, A, B, obstacles, root)) ?? candidates[candidates.length - 1]
  const points = chosen.map((p) => ({ x: p.x, y: p.y }))
  return { index, from: e.from, to: e.to, label: e.label, channel: chosen.channel, points, labelBox: edgeLabelBox(points, e.label) }
}

// --- draw ----------------------------------------------------------------------

function boxFill(b) {
  if (!b.container && b.tone !== 'neutral') return `var(--wu-fig-tone-${b.tone})`
  return b.level % 2 === 1 ? 'var(--wu-surface)' : 'var(--wu-rule-soft)'
}

export function draw(geo, ir) {
  const uid = `wu-d-${ir.id}`
  const parts = ['<defs>',
    `<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`,
    '</defs>']
  for (const b of geo.geo.boxes) {
    const cls = b.emphasis ? ' class="wu-focal"' : ''
    const sw = b.emphasis ? 1.5 : 1
    const weight = b.container || b.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-${b.id}" data-tone="${esc(b.tone)}"${cls} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.container ? 8 : 6}" fill="${boxFill(b)}" stroke="currentColor" stroke-width="${sw}"/>`)
    if (b.container) {
      parts.push(`<text id="${uid}-${b.id}-label" x="${b.x + PAD}" y="${b.y + 23}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(b.label)}</text>`)
    } else {
      parts.push(`<text id="${uid}-${b.id}-label" x="${b.x + b.width / 2}" y="${b.y + b.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle"${weight} fill="currentColor">${esc(b.label)}</text>`)
    }
  }
  for (const e of geo.geo.edges) {
    const d = `M${e.points[0].x} ${e.points[0].y} ${e.points.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`
    parts.push(`<path id="${uid}-e-${e.index}" d="${d}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    if (e.labelBox) {
      const l = e.labelBox
      const anchor = l.along === 'h' ? ' text-anchor="middle"' : ''
      const tx = l.along === 'h' ? l.x + l.width / 2 : l.x
      parts.push(`<text id="${uid}-e-${e.index}-label" x="${tx}" y="${l.y + 12}" font-size="${EDGE_LABEL_SIZE}"${anchor} fill="currentColor">${esc(l.text)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------------

const rectsOverlap = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)

function warnRow(id, name, budget, key, okDetail) {
  const w = budget.find((b) => b.key === key)
  return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
}

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 4).join('; '), hint: ok ? undefined : hint }
}

export function verify(geo, ir) {
  const { boxes, edges } = geo.geo
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const budget = budgetWarnings(ir)
  const all = flatten(ir.root)
  const rows = [
    warnRow(1, 'box-count', budget, 'budget:boxes', `${all.length} box(es)`),
    warnRow(2, 'label-length', budget, 'budget:label', 'every label within 14 chars'),
    warnRow(3, 'emphasis-count', budget, 'budget:emphasis', `${all.filter((r) => r.box.emphasis).length} emphasized box(es)`),
  ]

  const contain = []
  const band = []
  for (const b of boxes) {
    if (b.parent === undefined) continue
    const p = byId.get(b.parent)
    if (!p) { contain.push(`"${b.id}" has no parent box in the geometry`); continue }
    if (b.x < p.x + MIN_CLEARANCE || right(b) > right(p) - MIN_CLEARANCE || bottom(b) > bottom(p) - MIN_CLEARANCE || b.y < p.y + MIN_CLEARANCE) {
      contain.push(`"${b.id}" is not ≥ ${MIN_CLEARANCE}px inside "${p.id}"`)
    }
    if (b.y < p.y + TITLE_BAND) band.push(`"${b.id}" covers the title band of "${p.id}"`)
  }
  rows.push(failRow(4, 'containment', contain, `every child sits ≥ ${MIN_CLEARANCE}px inside its parent`, 'the layout must pad children inside their parent — check measure()/place()'))

  const overlap = []
  for (const p of boxes) {
    const kids = p.children.map((id) => byId.get(id)).filter(Boolean)
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        if (rectsOverlap(kids[i], kids[j])) overlap.push(`"${kids[i].id}" overlaps "${kids[j].id}"`)
      }
    }
  }
  rows.push(failRow(5, 'sibling-overlap', overlap, 'no two siblings overlap', 'siblings must be separated by the gap — check arrangeRows()'))
  rows.push(failRow(6, 'title-band-clear', band, `every title band (${TITLE_BAND}px) is free of children`, 'start children below the parent\'s title band'))

  const shape = []
  const cross = []
  for (const e of edges) {
    const A = byId.get(e.from), B = byId.get(e.to)
    if (!A || !B) { shape.push(`edge ${e.index} references a missing box`); continue }
    if (e.points.length < 2) { shape.push(`edge ${e.index} has fewer than 2 points`); continue }
    for (let i = 0; i < e.points.length - 1; i++) {
      const p = e.points[i], q = e.points[i + 1]
      if (p.x !== q.x && p.y !== q.y) shape.push(`edge ${e.index} segment ${i} is diagonal`)
    }
    const first = e.points[0], last = e.points[e.points.length - 1]
    if (!onBorder(first, A)) shape.push(`edge ${e.index} does not start on the border of "${A.id}"`)
    if (!onBorder(last, B)) shape.push(`edge ${e.index} does not end on the border of "${B.id}"`)
    if (!routeIsClear(e.points, A, B, obstaclesFor(e.from, e.to, byId, boxes), boxes[0])) {
      cross.push(`edge ${e.index} ("${e.from}"→"${e.to}") runs through an unrelated box or a title band, or leaves the root box`)
    }
  }
  rows.push(failRow(7, 'edges-orthogonal', shape, 'every edge is orthogonal and attaches to both box borders', 'route edges with axis-aligned segments that start and end on the box borders'))
  rows.push(failRow(8, 'edge-clearance', cross, 'no edge crosses an unrelated box or a title band; every edge stays inside the root box', 'move the endpoints so a gap route exists, or drop the edge — nesting already shows containment'))
  return rows
}

function onBorder(p, b) {
  const onX = p.x >= b.x && p.x <= right(b)
  const onY = p.y >= b.y && p.y <= bottom(b)
  return (onX && (p.y === b.y || p.y === bottom(b))) || (onY && (p.x === b.x || p.x === right(b)))
}

export const doc = {
  purpose: 'containment boxes — what sits inside what (scope, boundaries, responsibilities)',
  whenToUse: 'when the decision is *where a boundary lies* or *what a component owns*; not for flow (use diagram) or call order (use sequence). Budgets: boxes ≤ 12, 3 levels, label ≤ 14 chars, emphasis ≤ 2, edges ≤ 6 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: order-scope
type: nested
title: 注文システムの責務境界
caption: 決済は別サービスに切り出し、注文側は在庫までを持つ
root:
  id: system
  label: 注文システム
  children:
    - id: order
      label: 注文サービス
      children:
        - id: order-api
          label: API
        - id: order-stock
          label: 在庫
          emphasis: true
    - id: pay
      label: 決済サービス
      tone: rs
      children:
        - id: pay-api
          label: 決済 API
        - id: pay-ledger
          label: 台帳
edges:
  - from: order-api
    to: pay-api
    label: 与信
`,
  rows: ['box-count', 'label-length', 'emphasis-count', 'containment', 'sibling-overlap', 'title-band-clear', 'edges-orthogonal', 'edge-clearance'],
}
