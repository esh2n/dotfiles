// `type: zones` — boxes inside labelled zones with connections. One
// renderer covers four diagram-design survey patterns through `variant`:
//   high-level  (#24) zones are the horizontal bands of a request path
//   it-state    (#2)  zones are environments / domains holding systems
//   integration (#28) source / platform / consumer zones, typed connectors
//   deployment  (#35) zones are hosts / regions holding deployed components
// A variant only picks the default `layout` (rows or columns) and the
// frame style (deployment zones are dashed); the geometry is one model.
//
// IR shape: `{ id, type:'zones', title, caption, variant, layout, zones, edges }`
//   zones: [{ id, label, tone, nodes: [{ id, label, kind, emphasis, tone }] }]
//          kind ∈ service | store | external | queue | ui (a glyph, not a color)
//   edges: [{ from, to, label, kind }] — node ids; kind ∈ sync | async | reply
//
// Geometry is a fixed grid, not an elk layout: zones are equal bands
// (`rows`, stacked top → bottom) or equal columns (`columns`, left → right)
// with the zone label in a band at the start of the cross axis; the nodes
// of a zone sit in one line along that axis in IR order. Edges are
// orthogonal: a straight run across the gutter between two zones when the
// ends line up, otherwise a Z through a lane of that gutter; an edge that
// skips zones runs straight through them where no node is in the way, or
// along a side channel beyond the last node; an edge between non-adjacent
// nodes of one zone loops through the gutter after the zone. Every lane
// is 20px apart so a label sits in its own strip beside its segment.
//
// The code works in abstract (main, cross) coordinates — main is the axis
// the zones are stacked along — and maps to x/y at the very end, so the
// two layouts share one routing path.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc, KINDS, LEGEND_HEIGHT, legendWidth } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, NODE_PAD_X, COLUMN } from '../diagram.mjs'

export const type = 'zones'

export const limits = { maxZones: 5, maxNodes: 12, maxEdges: 14, maxLabelLen: 14, maxEmphasis: 2 }

const VARIANT_LAYOUT = { 'high-level': 'rows', 'it-state': 'columns', integration: 'columns', deployment: 'rows' }
const LAYOUTS = new Set(['rows', 'columns'])
const NODE_KINDS = new Set(['service', 'store', 'external', 'queue', 'ui'])
const EDGE_KIND_ORDER = ['sync', 'async', 'reply']

// --- metrics (px; every one that becomes a position is a multiple of 4) ----

const MARGIN = 16          // canvas edge ↔ zone
const PAD = 16             // zone frame ↔ node (cross axis, and main axis)
const NODE_H = 40          // node size along the axis nodes are NOT stacked on
const NODE_MIN_W = 96
const NODE_GAP = 24        // between nodes of one zone
const HEADER = 32          // columns: zone label band height
const LABEL_COL_PAD = 24   // rows: zone label column padding (12 each side)
const GUTTER_MIN = 40      // between zones with no lane
const LANE_PAD = 20        // gutter edge ↔ first lane
const LANE_STEP = 20       // lane ↔ lane (16px label strip + 4)
const ATTACH_STEP = 20     // attachment ↔ attachment on one node side
const CHANNEL_GAP = 24     // last node ↔ first side channel
const LABEL_H = 16
const LABEL_GAP = 4
const CLEARANCE = 8        // node ↔ zone frame (verify)

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeVariant(raw.variant, ctx)
  const layout = normalizeLayout(raw.layout, variant, ctx)
  const zones = normalizeZones(raw.zones, ctx)
  const nodeIds = new Set(zones.flatMap((z) => z.nodes.map((n) => n.id)))
  const edges = normalizeEdges(raw.edges, nodeIds, ctx)
  return { id, type, title, caption, variant, layout, zones, edges }
}

function normalizeVariant(v, ctx) {
  if (v === undefined || v === null) return 'high-level'
  if (typeof v !== 'string' || !(v in VARIANT_LAYOUT)) {
    throw new IrError(`${ctx}.variant must be high-level|it-state|integration|deployment (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeLayout(v, variant, ctx) {
  if (v === undefined || v === null) return VARIANT_LAYOUT[variant]
  if (typeof v !== 'string' || !LAYOUTS.has(v)) {
    throw new IrError(`${ctx}.layout must be rows|columns (got: ${JSON.stringify(v)})`)
  }
  return v
}

const ID_RE = /^[A-Za-z0-9_-]+$/

function normalizeZones(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.zones must be a non-empty list`)
  const zoneIds = new Set()
  const nodeIds = new Set()
  return raw.map((z, i) => {
    const zctx = `${ctx}.zones[${i}]`
    if (!isObj(z)) throw new IrError(`${zctx} must be a mapping`)
    const id = requireStr(z, 'id', zctx)
    if (!ID_RE.test(id)) throw new IrError(`${zctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
    if (zoneIds.has(id)) throw new IrError(`duplicate zone id: "${id}"`)
    zoneIds.add(id)
    const label = requireStr(z, 'label', zctx)
    const tone = validateTone(z.tone, zctx)
    let nodes = []
    if (z.nodes !== undefined && z.nodes !== null) {
      if (!Array.isArray(z.nodes)) throw new IrError(`${zctx}.nodes must be a list`)
      nodes = z.nodes.map((n, j) => normalizeNode(n, `${zctx}.nodes[${j}]`, nodeIds))
    }
    return { id, label, tone, nodes }
  })
}

function normalizeNode(raw, ctx, nodeIds) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const id = requireStr(raw, 'id', ctx)
  if (!ID_RE.test(id)) throw new IrError(`${ctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
  if (nodeIds.has(id)) throw new IrError(`duplicate node id: "${id}"`)
  nodeIds.add(id)
  const label = requireStr(raw, 'label', ctx)
  let kind = 'service'
  if (raw.kind !== undefined && raw.kind !== null) {
    if (typeof raw.kind !== 'string' || !NODE_KINDS.has(raw.kind)) {
      throw new IrError(`${ctx}.kind must be service|store|external|queue|ui (got: ${JSON.stringify(raw.kind)})`)
    }
    kind = raw.kind
  }
  return { id, label, kind, emphasis: validateBool(raw, 'emphasis', ctx), tone: validateTone(raw.tone, ctx) }
}

function normalizeEdges(raw, nodeIds, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.edges must be a list`)
  return raw.map((e, i) => {
    const ectx = `${ctx}.edges[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const from = requireStr(e, 'from', ectx)
    const to = requireStr(e, 'to', ectx)
    if (!nodeIds.has(from)) throw new IrError(`${ectx}.from references unknown node "${from}"`)
    if (!nodeIds.has(to)) throw new IrError(`${ectx}.to references unknown node "${to}"`)
    if (from === to) throw new IrError(`${ectx}: from and to must differ`)
    const label = optStr(e, 'label', ectx) ?? ''
    let kind = 'sync'
    if (e.kind !== undefined && e.kind !== null) {
      if (typeof e.kind !== 'string' || !KINDS.has(e.kind)) throw new IrError(`${ectx}.kind must be sync|async|reply (got: ${JSON.stringify(e.kind)})`)
      kind = e.kind
    }
    return { from, to, label, kind }
  })
}

// --- budgets -------------------------------------------------------------

const allNodes = (ir) => ir.zones.flatMap((z) => z.nodes)
const chars = (s) => [...s].length

function longestLabel(ir) {
  let best = { label: '', where: '' }
  for (const z of ir.zones) {
    if (chars(z.label) > chars(best.label)) best = { label: z.label, where: `zone "${z.id}"` }
    for (const n of z.nodes) if (chars(n.label) > chars(best.label)) best = { label: n.label, where: `node "${n.id}"` }
  }
  return best
}

export function budgetWarnings(ir) {
  const out = []
  const nz = ir.zones.length
  if (nz > limits.maxZones) {
    out.push(budgetWarning('budget:zones', nz, limits.maxZones,
      `${nz} zone(s) (guidance ≤ ${limits.maxZones})`,
      'merge neighbouring zones or split the figure at an environment boundary'))
  }
  const nn = allNodes(ir).length
  if (nn > limits.maxNodes) {
    out.push(budgetWarning('budget:nodes', nn, limits.maxNodes,
      `${nn} node(s) (guidance ≤ ${limits.maxNodes})`,
      'collapse the nodes that share a role into one box, or split by zone'))
  }
  const ne = ir.edges.length
  if (ne > limits.maxEdges) {
    out.push(budgetWarning('budget:edges', ne, limits.maxEdges,
      `${ne} edge(s) (guidance ≤ ${limits.maxEdges})`,
      'keep only the edges that cross a zone boundary — inside-zone detail belongs in a diagram'))
  }
  const longest = longestLabel(ir)
  if (chars(longest.label) > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', chars(longest.label), limits.maxLabelLen,
      `label of ${longest.where} is ${chars(longest.label)} chars (guidance ≤ ${limits.maxLabelLen})`,
      `shorten the label of ${longest.where} and move the detail into the caption`))
  }
  const emphasized = allNodes(ir).filter((n) => n.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized node(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two nodes the decision is about'))
  }
  return out
}

// --- layout --------------------------------------------------------------

const labelW = (text, bold = false) => Math.ceil(textWidth(text, FONT_SIZE) * (bold ? BOLD_FACTOR : 1))
const edgeLabelW = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 4

/** (main, cross) → { x, y } for the layout. */
const toXY = (rows, m, c) => (rows ? { x: c, y: m } : { x: m, y: c })

/**
 * Deterministic grid layout in abstract (main, cross) coordinates, mapped
 * to x/y at the end. Steps: node sizes → attachments per node side (which
 * may grow a node so its edges sit 20px apart) → cross positions (zone
 * label band, nodes in a line) → routes (which lanes each edge needs) →
 * gutter sizes from the lane counts → main positions → points → labels.
 */
export async function layout(ir, { column = COLUMN } = {}) {
  const rows = ir.layout === 'rows'
  const zones = ir.zones.map((z, zi) => ({ ...z, zi }))
  const nodes = []
  zones.forEach((z) => z.nodes.forEach((n, ni) => nodes.push({ ...n, zi: z.zi, ni })))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const nZones = zones.length

  // 1. edges: class and the node side each end attaches to
  const edges = ir.edges.map((e, index) => {
    const A = byId.get(e.from), B = byId.get(e.to)
    const rec = { index, from: e.from, to: e.to, label: e.label, kind: e.kind, A, B, dir: 0 }
    if (A.zi === B.zi) {
      if (Math.abs(A.ni - B.ni) === 1) {
        rec.cls = 'adjacent'
        rec.sideA = B.ni > A.ni ? 'cEnd' : 'cStart'
        rec.sideB = B.ni > A.ni ? 'cStart' : 'cEnd'
      } else {
        rec.cls = 'loop'
        rec.sideA = 'mEnd'
        rec.sideB = 'mEnd'
      }
    } else {
      rec.dir = B.zi > A.zi ? 1 : -1
      rec.cls = Math.abs(B.zi - A.zi) === 1 ? 'cross' : 'span'
      rec.sideA = rec.dir > 0 ? 'mEnd' : 'mStart'
      rec.sideB = rec.dir > 0 ? 'mStart' : 'mEnd'
    }
    return rec
  })

  // 2. attachments on the main sides of every node
  const attach = new Map() // `${nodeId}:${side}` → [{ edge, other }]
  const push = (node, side, edge, other) => {
    const key = `${node.id}:${side}`
    if (!attach.has(key)) attach.set(key, [])
    attach.get(key).push({ edge, other })
  }
  for (const e of edges) {
    if (e.cls === 'adjacent') continue
    push(e.A, e.sideA, e, e.B)
    push(e.B, e.sideB, e, e.A)
  }
  const sideCount = (n, side) => (attach.get(`${n.id}:${side}`) ?? []).length

  // 3. node sizes. rows: main = height, cross = width from the label;
  //    columns: main = one uniform width, cross = height (grown by edges)
  const uniformW = snapUp4(Math.max(NODE_MIN_W, ...nodes.map((n) => labelW(n.label, n.emphasis) + NODE_PAD_X * 2)))
  for (const n of nodes) {
    const k = Math.max(sideCount(n, 'mStart'), sideCount(n, 'mEnd'))
    const need = snapUp4((k + 1) * ATTACH_STEP)
    n.mainSize = rows ? NODE_H : uniformW
    n.crossSize = Math.max(rows ? snapUp4(Math.max(NODE_MIN_W, labelW(n.label, n.emphasis) + NODE_PAD_X * 2)) : NODE_H, need)
  }

  // 4. cross positions: zone label band, then the nodes in a line
  const labelBand = rows
    ? snapUp4(Math.max(...zones.map((z) => labelW(z.label, true))) + LABEL_COL_PAD)
    : HEADER
  const gapAfter = (n) => {
    // rows: a label between two nodes sits above the line and needs width
    const between = edges.filter((e) => e.cls === 'adjacent' && e.label
      && ((e.A === n && e.B.ni === n.ni + 1) || (e.B === n && e.A.ni === n.ni + 1)))
    const need = rows ? Math.max(0, ...between.map((e) => edgeLabelW(e.label) + 8)) : 0
    return snapUp4(Math.max(NODE_GAP, need))
  }
  let contentCross = 0
  for (const z of zones) {
    let c = MARGIN + labelBand + PAD
    z.nodes.forEach((raw, ni) => {
      const n = byId.get(raw.id)
      n.c0 = c
      n.c1 = c + n.crossSize
      c = n.c1 + (ni < z.nodes.length - 1 ? gapAfter(n) : 0)
    })
    contentCross = Math.max(contentCross, c + PAD)
  }
  const maxNodeC1 = nodes.reduce((m, n) => Math.max(m, n.c1), MARGIN + labelBand + PAD)

  // 5. attachment positions along the cross axis (main sides): spread
  //    over the node, ordered by where the other end sits
  const centerC = (n) => snap4((n.c0 + n.c1) / 2)
  for (const [key, list] of attach) {
    const [id] = key.split(':')
    const n = byId.get(id)
    list.sort((p, q) => centerC(p.other) - centerC(q.other) || p.edge.index - q.edge.index)
    list.forEach((a, i) => {
      const c = snap4(n.c0 + ((i + 1) * n.crossSize) / (list.length + 1))
      if (a.edge.A === n) a.edge.cExit = c
      else a.edge.cEntry = c
    })
  }
  // adjacent pairs: both ends share one offset along the main axis
  const pairs = new Map()
  for (const e of edges) {
    if (e.cls !== 'adjacent') continue
    const key = [e.A.id, e.B.id].sort().join('|')
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(e)
  }
  for (const list of pairs.values()) {
    list.sort((p, q) => p.index - q.index)
    list.forEach((e, i) => { e.mOffset = snap4(((i + 1) * NODE_H) / (list.length + 1)) })
  }

  // 6. routes: which gutter lanes / side channels each edge needs. Gutter
  //    g sits before zone g (g = 0 is the top/left margin, g = nZones the
  //    bottom/right margin).
  const clearThrough = (c, z0, z1) => {
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1)
    return nodes.every((n) => n.zi <= lo || n.zi >= hi || c <= n.c0 - CLEARANCE || c >= n.c1 + CLEARANCE)
  }
  const gutterUsers = Array.from({ length: nZones + 1 }, () => [])
  const channelUsers = []
  for (const e of edges) {
    if (e.cls === 'adjacent') continue
    if (e.cls === 'loop') {
      e.route = 'loop'
      e.gutters = [e.A.zi + 1]
    } else if (e.cls === 'cross') {
      e.route = e.cExit === e.cEntry ? 'straight' : 'z'
      e.gutters = e.route === 'z' ? [Math.max(e.A.zi, e.B.zi)] : []
    } else {
      const gAfterA = e.dir > 0 ? e.A.zi + 1 : e.A.zi
      const gBeforeB = e.dir > 0 ? e.B.zi : e.B.zi + 1
      if (e.cExit === e.cEntry && clearThrough(e.cExit, e.A.zi, e.B.zi)) { e.route = 'straight'; e.gutters = [] }
      else if (clearThrough(e.cExit, e.A.zi, e.B.zi)) { e.route = 'z'; e.gutters = [gBeforeB] }
      else if (clearThrough(e.cEntry, e.A.zi, e.B.zi)) { e.route = 'z'; e.gutters = [gAfterA] }
      else { e.route = 'channel'; e.gutters = [gAfterA, gBeforeB]; channelUsers.push(e) }
    }
    for (const g of e.gutters) gutterUsers[g].push(e)
  }
  channelUsers.forEach((e, j) => { e.channel = snap4(maxNodeC1 + CHANNEL_GAP + j * LANE_STEP) })
  const channelEnd = channelUsers.length ? channelUsers[channelUsers.length - 1].channel + PAD : 0
  const zoneCross = snapUp4(Math.max(contentCross - MARGIN, channelEnd - MARGIN, rows ? column - 2 * MARGIN : 0))

  // 7. gutter sizes from lane counts (and, in columns, the label regions
  //    beside the lanes and the labels of straight edges)
  const straightIn = (g) => edges.filter((e) => e.route === 'straight' && e.label && e.cls !== 'loop'
    && Math.min(e.A.zi, e.B.zi) < g && Math.max(e.A.zi, e.B.zi) >= g)
  const gutters = []
  for (let g = 0; g <= nZones; g++) {
    const users = gutterUsers[g]
    users.sort((p, q) => Math.min(p.cExit, p.cEntry) - Math.min(q.cExit, q.cEntry) || p.index - q.index)
    const L = users.length
    const outer = g === 0 || g === nZones
    let regionFwd = 0, regionBack = 0
    if (!rows) {
      regionFwd = snapUp4(Math.max(0, ...users.filter((e) => e.dir >= 0 && e.label).map((e) => edgeLabelW(e.label) + 8)))
      regionBack = snapUp4(Math.max(0, ...users.filter((e) => e.dir < 0 && e.label).map((e) => edgeLabelW(e.label) + 8)))
    }
    const base = L ? 2 * LANE_PAD + (L - 1) * LANE_STEP + regionFwd + regionBack : 0
    const straightNeed = !rows && !outer ? snapUp4(Math.max(0, ...straightIn(g).map((e) => edgeLabelW(e.label) + 16))) : 0
    const size = Math.max(outer ? MARGIN : GUTTER_MIN, base, straightNeed)
    gutters.push({ g, users, size, base, regionFwd })
  }
  let m = 0
  for (let g = 0; g <= nZones; g++) {
    const gu = gutters[g]
    gu.m0 = m
    const laneStart = m + snap4((gu.size - gu.base) / 2) + LANE_PAD + gu.regionFwd
    gu.users.forEach((e, i) => { e.lanes = e.lanes ?? {}; e.lanes[g] = laneStart + i * LANE_STEP })
    m += gu.size
    if (g < nZones) {
      const z = zones[g]
      z.m0 = m
      z.mainSize = rows ? PAD * 2 + NODE_H : PAD * 2 + uniformW
      z.nodes.forEach((raw) => {
        const n = byId.get(raw.id)
        n.m0 = m + PAD
        n.m1 = n.m0 + n.mainSize
      })
      m += z.mainSize
    }
  }
  const mainTotal = m

  // 8. points, in x/y
  const P = (mm, cc) => toXY(rows, mm, cc)
  const geoNodes = nodes.map((n) => {
    const p = P(n.m0, n.c0)
    const size = rows ? { width: n.crossSize, height: n.mainSize } : { width: n.mainSize, height: n.crossSize }
    return { id: n.id, zone: zones[n.zi].id, label: n.label, kind: n.kind, tone: n.tone, emphasis: n.emphasis, ...p, ...size }
  })
  const geoZones = zones.map((z) => {
    const p = P(z.m0, MARGIN)
    const size = rows ? { width: zoneCross, height: z.mainSize } : { width: z.mainSize, height: zoneCross }
    const labelBox = rows
      ? { x: p.x, y: p.y, width: labelBand, height: z.mainSize }
      : { x: p.x, y: p.y, width: z.mainSize, height: HEADER }
    return { id: z.id, index: z.zi, label: z.label, tone: z.tone, ...p, ...size, labelBox, nodes: z.nodes.map((n) => n.id) }
  })
  const geoEdges = edges.map((e) => {
    const { A, B } = e
    let pts
    if (e.cls === 'adjacent') {
      const mm = A.m0 + e.mOffset
      pts = [P(mm, e.sideA === 'cEnd' ? A.c1 : A.c0), P(mm, e.sideB === 'cEnd' ? B.c1 : B.c0)]
    } else {
      const mA = e.sideA === 'mEnd' ? A.m1 : A.m0
      const mB = e.sideB === 'mEnd' ? B.m1 : B.m0
      if (e.route === 'straight') pts = [P(mA, e.cExit), P(mB, e.cEntry)]
      else if (e.route === 'channel') {
        const [g1, g2] = e.gutters
        pts = [P(mA, e.cExit), P(e.lanes[g1], e.cExit), P(e.lanes[g1], e.channel), P(e.lanes[g2], e.channel), P(e.lanes[g2], e.cEntry), P(mB, e.cEntry)]
      } else {
        const lane = e.lanes[e.gutters[0]]
        pts = [P(mA, e.cExit), P(lane, e.cExit), P(lane, e.cEntry), P(mB, e.cEntry)]
      }
    }
    return { index: e.index, from: e.from, to: e.to, label: e.label, kind: e.kind, cls: e.cls, dir: e.dir, points: dedupe(pts) }
  })

  // 9. labels: the rule-of-thumb position first, then every segment side
  const nodeById = new Map(geoNodes.map((n) => [n.id, n]))
  const placed = []
  for (const e of geoEdges) {
    if (!e.label) continue
    const w = edgeLabelW(e.label)
    const A = nodeById.get(e.from)
    const cands = labelCandidates(e, w, rows, A)
    const others = geoEdges.filter((o) => o !== e)
    const blocked = (box) => geoNodes.some((n) => rectsOverlap(box, n, 2))
      || geoZones.some((z) => rectsOverlap(box, z.labelBox, 2))
      || placed.some((p) => rectsOverlap(box, p, 2))
      || others.some((o) => segments(o.points).some(([a, b]) => segmentHitsRect(a, b, box, 0)))
      || segments(e.points).some(([a, b]) => segmentHitsRect(a, b, box, 0))
    const box = cands.find((c) => !blocked(c)) ?? cands[0]
    e.labelBox = { ...box, text: e.label }
    placed.push(box)
  }

  // 10. canvas + legend
  const usedKinds = EDGE_KIND_ORDER.filter((k) => ir.edges.some((e) => e.kind === k))
  const legendItems = usedKinds.length >= 2
    ? usedKinds.map((k) => ({ label: k, dash: k === 'reply' ? '5 4' : undefined, marker: k === 'sync' ? 'solid' : 'open' }))
    : []
  let width = snapUp4(rows ? MARGIN * 2 + zoneCross : mainTotal)
  let height = snapUp4(rows ? mainTotal : MARGIN * 2 + zoneCross)
  let legend
  if (legendItems.length) {
    const y = snap4(height + 4)
    legend = { y, items: legendItems }
    height = snapUp4(y + LEGEND_HEIGHT)
    width = Math.max(width, snapUp4(legendWidth(legendItems)))
  }
  return { width, height, geo: { layout: ir.layout, variant: ir.variant, zones: geoZones, nodes: geoNodes, edges: geoEdges }, legend }
}

function dedupe(points) {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
}

function segments(points) {
  const out = []
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]])
  return out
}

const box = (x, y, w, h) => ({ x: snap4(x), y: snap4(y), width: w, height: h })

/** Rows: above the longest horizontal segment (or right of a lone vertical
 * one); columns: above the segment leaving the source node, anchored at the
 * node ("label near the source"), or centered on a straight run. Then the
 * generic list — every segment, longest first, both sides. */
function labelCandidates(e, w, rows, A) {
  const h = LABEL_H
  const segs = segments(e.points).map(([a, b], i) => ({ a, b, i, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) }))
  const out = []
  const above = (s, cx) => box(cx - w / 2, s.a.y - LABEL_GAP - h, w, h)
  const beside = (s) => box(s.a.x + LABEL_GAP, (s.a.y + s.b.y) / 2 - h / 2, w, h)
  if (rows) {
    const horiz = segs.filter((s) => s.a.y === s.b.y).sort((p, q) => q.len - p.len || p.i - q.i)
    if (horiz.length) out.push(above(horiz[0], (horiz[0].a.x + horiz[0].b.x) / 2))
    else out.push(beside(segs[0]))
  } else {
    const first = segs[0]
    if (first.a.y === first.b.y) {
      if (e.points.length === 2) out.push(above(first, (first.a.x + first.b.x) / 2))
      else if (e.dir < 0) out.push(box(A.x - LABEL_GAP - w, first.a.y - LABEL_GAP - h, w, h))
      else out.push(box(A.x + A.width + LABEL_GAP, first.a.y - LABEL_GAP - h, w, h))
    } else out.push(beside(first))
  }
  const ordered = [...segs].sort((p, q) => q.len - p.len || p.i - q.i)
  for (const s of ordered) {
    if (s.a.x === s.b.x) {
      const midY = (s.a.y + s.b.y) / 2
      out.push(box(s.a.x + LABEL_GAP, midY - h / 2, w, h))
      out.push(box(s.a.x - LABEL_GAP - w, midY - h / 2, w, h))
    } else {
      const midX = (s.a.x + s.b.x) / 2
      out.push(box(midX - w / 2, s.a.y - LABEL_GAP - h, w, h))
      out.push(box(midX - w / 2, s.a.y + LABEL_GAP, w, h))
    }
  }
  return out.filter((c, i) => out.findIndex((d) => d.x === c.x && d.y === c.y) === i)
}

function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
}

/** Axis-aligned segment a→b passes through rect r grown by `pad` (open). */
function segmentHitsRect(a, b, r, pad = 0) {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.width + pad, y1 = r.y + r.height + pad
  const sx0 = Math.min(a.x, b.x), sx1 = Math.max(a.x, b.x)
  const sy0 = Math.min(a.y, b.y), sy1 = Math.max(a.y, b.y)
  return sx1 > x0 && sx0 < x1 && sy1 > y0 && sy0 < y1
}

// --- draw ----------------------------------------------------------------

const pathD = (pts) => `M${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const rows = geo.layout === 'rows'
  const parts = ['<defs>',
    `<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`,
    `<marker id="${uid}-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    '</defs>']

  for (const z of geo.zones) {
    const dash = geo.variant === 'deployment' ? ' stroke-dasharray="6 4"' : ''
    parts.push(`<rect id="${uid}-z-${z.id}" data-tone="${esc(z.tone)}" x="${z.x}" y="${z.y}" width="${z.width}" height="${z.height}" rx="8" fill="var(--wu-fig-tone-${z.tone})" stroke="currentColor" stroke-width="1"${dash}/>`)
    const lx = z.x + 12
    const ly = rows ? z.y + z.height / 2 + FONT_SIZE * 0.35 : z.y + 21
    parts.push(`<text id="${uid}-z-${z.id}-label" x="${lx}" y="${ly}" font-size="${FONT_SIZE}" font-weight="700" fill="currentColor">${esc(z.label)}</text>`)
  }

  for (const n of geo.nodes) {
    const cls = n.emphasis ? ' class="wu-focal"' : ''
    const sw = n.emphasis ? 1.5 : 1
    const tone = n.tone === 'neutral' ? '' : ` data-tone="${esc(n.tone)}"`
    const fill = n.tone === 'neutral' ? 'var(--wu-surface)' : `var(--wu-fig-tone-${n.tone})`
    const dash = n.kind === 'external' ? ' stroke-dasharray="5 4"' : ''
    parts.push(`<rect id="${uid}-n-${n.id}"${cls}${tone} x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="${fill}" stroke="currentColor" stroke-width="${sw}"${dash}/>`)
    let textY = n.y + n.height / 2 + FONT_SIZE * 0.35
    if (n.kind === 'store') {
      parts.push(`<line id="${uid}-n-${n.id}-glyph" x1="${n.x}" y1="${n.y + 6}" x2="${n.x + n.width}" y2="${n.y + 6}" stroke="currentColor" stroke-width="1"/>`)
      textY += 3
    } else if (n.kind === 'queue') {
      parts.push(`<line id="${uid}-n-${n.id}-glyph" x1="${n.x + n.width - 8}" y1="${n.y + 4}" x2="${n.x + n.width - 8}" y2="${n.y + n.height - 4}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3"/>`)
    } else if (n.kind === 'ui') {
      parts.push(`<line id="${uid}-n-${n.id}-glyph" x1="${n.x}" y1="${n.y + 10}" x2="${n.x + n.width}" y2="${n.y + 10}" stroke="currentColor" stroke-width="1"/>`)
      textY += 5
    }
    const weight = n.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-n-${n.id}-label" x="${n.x + n.width / 2}" y="${textY}" font-size="${FONT_SIZE}" text-anchor="middle"${weight} fill="currentColor">${esc(n.label)}</text>`)
  }

  for (const e of geo.edges) {
    const dash = e.kind === 'reply' ? ' stroke-dasharray="5 4"' : ''
    const marker = e.kind === 'sync' ? 'solid' : 'open'
    parts.push(`<path id="${uid}-e-${e.index}" d="${pathD(e.points)}" fill="none" stroke="currentColor" stroke-width="1"${dash} marker-end="url(#${uid}-${marker})"/>`)
    if (e.labelBox) {
      const l = e.labelBox
      parts.push(`<text id="${uid}-e-${e.index}-label" x="${l.x + 2}" y="${l.y + 12}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(l.text)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------

function warnRow(id, name, budget, key, okDetail) {
  const w = budget.find((b) => b.key === key)
  return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
}

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 4).join('; '), hint: ok ? undefined : hint }
}

function onBorder(p, b) {
  const onX = p.x >= b.x && p.x <= b.x + b.width
  const onY = p.y >= b.y && p.y <= b.y + b.height
  return (onX && (p.y === b.y || p.y === b.y + b.height)) || (onY && (p.x === b.x || p.x === b.x + b.width))
}

export function verify(layoutResult, ir) {
  const { zones, nodes, edges } = layoutResult.geo
  const budget = budgetWarnings(ir)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const zoneById = new Map(zones.map((z) => [z.id, z]))
  const rows = [
    warnRow(1, 'zone-count', budget, 'budget:zones', `${ir.zones.length} zone(s)`),
    warnRow(2, 'node-count', budget, 'budget:nodes', `${allNodes(ir).length} node(s)`),
    warnRow(3, 'edge-count', budget, 'budget:edges', `${ir.edges.length} edge(s)`),
    warnRow(4, 'label-length', budget, 'budget:label', `every label within ${limits.maxLabelLen} chars`),
    warnRow(5, 'emphasis-count', budget, 'budget:emphasis', `${allNodes(ir).filter((n) => n.emphasis).length} emphasized node(s)`),
  ]

  // 6. every drawn edge resolves to two drawn nodes; every IR edge is drawn
  const refs = []
  for (const e of edges) {
    if (!nodeById.has(e.from)) refs.push(`edge ${e.index} from unknown node "${e.from}"`)
    if (!nodeById.has(e.to)) refs.push(`edge ${e.index} to unknown node "${e.to}"`)
  }
  if (edges.length !== ir.edges.length) refs.push(`${edges.length} edge(s) drawn for ${ir.edges.length} in the IR`)
  rows.push(failRow(6, 'edge-refs', refs, 'every edge joins two drawn nodes', 'an edge endpoint must be a node id declared inside a zone'))

  // 7. nodes inside their zone, clear of the frame and the zone label
  const inside = []
  for (const n of nodes) {
    const z = zoneById.get(n.zone)
    if (!z) { inside.push(`"${n.id}" belongs to no drawn zone`); continue }
    if (n.x < z.x + CLEARANCE || n.x + n.width > z.x + z.width - CLEARANCE || n.y < z.y + CLEARANCE || n.y + n.height > z.y + z.height - CLEARANCE) {
      inside.push(`"${n.id}" is not ≥ ${CLEARANCE}px inside zone "${z.id}"`)
    } else if (rectsOverlap(n, z.labelBox)) inside.push(`"${n.id}" covers the label of zone "${z.id}"`)
  }
  rows.push(failRow(7, 'nodes-inside-zone', inside, `every node sits ≥ ${CLEARANCE}px inside its zone, past the zone label`, 'the zone must grow around its nodes — check the cross-axis sizing in layout()'))

  // 8. zones disjoint and in IR order along the stacking axis
  const disjoint = []
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) if (rectsOverlap(zones[i], zones[j])) disjoint.push(`zone "${zones[i].id}" overlaps "${zones[j].id}"`)
    if (i > 0) {
      const p = zones[i - 1], z = zones[i]
      const after = layoutResult.geo.layout === 'rows' ? z.y >= p.y + p.height : z.x >= p.x + p.width
      if (!after) disjoint.push(`zone "${z.id}" does not follow "${p.id}"`)
    }
  }
  rows.push(failRow(8, 'zones-disjoint', disjoint, 'zones are separate bands in IR order', 'stack zones in IR order with a gutter between them'))

  // 9. orthogonal segments attached to both node borders
  const shape = []
  const cross = []
  for (const e of edges) {
    const A = nodeById.get(e.from), B = nodeById.get(e.to)
    if (!A || !B) continue
    if (e.points.length < 2) { shape.push(`edge ${e.index} has fewer than 2 points`); continue }
    segments(e.points).forEach(([p, q], i) => { if (p.x !== q.x && p.y !== q.y) shape.push(`edge ${e.index} segment ${i} is diagonal`) })
    if (!onBorder(e.points[0], A)) shape.push(`edge ${e.index} does not start on the border of "${A.id}"`)
    if (!onBorder(e.points[e.points.length - 1], B)) shape.push(`edge ${e.index} does not end on the border of "${B.id}"`)
    // 10. clear of every other node and of every zone label
    for (const [p, q] of segments(e.points)) {
      for (const n of nodes) if (n !== A && n !== B && segmentHitsRect(p, q, n)) cross.push(`edge ${e.index} ("${e.from}"→"${e.to}") runs through "${n.id}"`)
      for (const z of zones) if (segmentHitsRect(p, q, z.labelBox)) cross.push(`edge ${e.index} ("${e.from}"→"${e.to}") runs through the label of zone "${z.id}"`)
    }
  }
  rows.push(failRow(9, 'edges-orthogonal', shape, 'every edge is orthogonal and attaches to both node borders', 'route edges with axis-aligned segments that start and end on the node borders'))
  rows.push(failRow(10, 'edge-clearance', cross, 'no edge runs through a node it does not join, nor through a zone label', 'move the edge to a gutter lane or a side channel — see layout() step 6'))

  // 11. labels clear of nodes, zone labels and each other
  const labels = edges.filter((e) => e.labelBox)
  const clash = []
  labels.forEach((e, i) => {
    const l = e.labelBox
    for (const n of nodes) if (rectsOverlap(l, n)) clash.push(`label of edge ${e.index} ("${l.text}") overlaps "${n.id}"`)
    for (const z of zones) if (rectsOverlap(l, z.labelBox)) clash.push(`label of edge ${e.index} ("${l.text}") overlaps the label of zone "${z.id}"`)
    for (let j = i + 1; j < labels.length; j++) {
      if (rectsOverlap(l, labels[j].labelBox)) clash.push(`labels of edges ${e.index} and ${labels[j].index} overlap`)
    }
  })
  rows.push(failRow(11, 'labels-clear', clash, 'every edge label is clear of nodes, zone labels and other labels', 'shorten the label, or move the edge so a free segment side exists'))
  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'boxes inside labelled zones with orthogonal connections — a request path (high-level), an IT landscape (it-state), an integration topology (integration) or a deployment (deployment)',
  whenToUse: 'when the reader must see *which zone a component lives in* and *which links cross a boundary*; pick the variant by the question (request path → high-level, environments → it-state, sources/platform/consumers → integration, hosts/regions → deployment). Not for pure containment without links (use nested) or a ranked stack (use layers). Budgets: zones ≤ 5, nodes ≤ 12, edges ≤ 14, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: request-path
type: zones
variant: high-level
title: 注文リクエストの経路
caption: 認証は Edge で済ませ、決済は外部に委ねる
zones:
  - id: edge
    label: Edge
    nodes:
      - id: cdn
        label: CDN
      - id: gw
        label: API Gateway
        emphasis: true
  - id: app
    label: アプリ
    nodes:
      - id: order
        label: 注文
      - id: pay
        label: 決済
      - id: bus
        label: イベント
        kind: queue
  - id: data
    label: データ
    tone: rs
    nodes:
      - id: db
        label: 注文 DB
        kind: store
      - id: psp
        label: 決済代行
        kind: external
edges:
  - from: cdn
    to: gw
  - from: gw
    to: order
    label: 認証済み
  - from: order
    to: pay
  - from: order
    to: db
  - from: pay
    to: psp
    kind: async
  - from: pay
    to: bus
    kind: async
    label: 決済完了
`,
  rows: ['zone-count', 'node-count', 'edge-count', 'label-length', 'emphasis-count', 'edge-refs', 'nodes-inside-zone', 'zones-disjoint', 'edges-orthogonal', 'edge-clearance', 'labels-clear'],
}
