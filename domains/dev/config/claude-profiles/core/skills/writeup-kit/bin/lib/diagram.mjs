// Lays out a validated diagram IR with elkjs (vendored, zero npm deps at
// runtime) and draws it as an inline SVG that follows the writeup-kit skin:
// currentColor strokes, the kit's .wu-focal helper class for emphasis, ids
// prefixed wu-d-<id>-, and a legend of only the edge kinds actually used.
//
// Ported from the grilling render/lib/diagram.mjs prototype: CJK/ASCII
// width estimate, 720px column, orientation auto-select via fitRatio,
// MIN_SCALE 0.78 / scroll fallback, layer spacing derived from edge label
// width, and the sync/async/reply edge styles + legend.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ELK = require(join(HERE, '..', '..', 'vendor', 'elk', 'elk.bundled.js'))
const elk = new ELK()

export const FONT_SIZE = 13
export const EDGE_LABEL_SIZE = 11
export const SUBLABEL_SIZE = 11
const NODE_H = 44
export const NODE_PAD_X = 18
const NODE_MIN_W = 124
const GROUP_HEADER = 36
const GROUP_PAD = 16
export const BOLD_FACTOR = 1.08
const LEGEND_H = 36
const GRID = 4

/** The body column a figure should fit inside without scrolling. */
export const COLUMN = 720
/** Height allowance used only to pick between "right" and "down" orientation. */
export const MAX_HEIGHT = 900
/** Never shrink a figure below this scale; beyond it we scroll instead. */
export const MIN_SCALE = 0.78

const CJK_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
]
const isWide = (cp) => CJK_RANGES.some(([a, b]) => cp >= a && cp <= b)

/** ASCII 0.6em / CJK 1em width estimate (contract §4-2 #15). */
export function textWidth(text, fontSize = FONT_SIZE) {
  let em = 0
  for (const ch of String(text)) em += isWide(ch.codePointAt(0)) ? 1 : 0.6
  return em * fontSize
}

export const snap4 = (v) => Math.round(v / GRID) * GRID
export const snapUp4 = (v) => Math.ceil(v / GRID) * GRID

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const EDGE_KIND_ORDER = ['sync', 'async', 'reply']
const EDGE_KIND_LABEL = { sync: 'sync', async: 'async', reply: 'reply' }
const SIDE_TO_ELK = { top: 'NORTH', right: 'EAST', bottom: 'SOUTH', left: 'WEST' }

/** Node box size, wide enough that `label` never overflows at 13px. */
export function nodeSize(label, { bold = false, fontSize = FONT_SIZE, minWidth = NODE_MIN_W, height = NODE_H } = {}) {
  const w = textWidth(label, fontSize) * (bold ? BOLD_FACTOR : 1) + NODE_PAD_X * 2
  return { width: snapUp4(Math.max(minWidth, Math.ceil(w))), height: snapUp4(height) }
}

function edgeStyle(kind, uid) {
  if (kind === 'sync') return { dash: null, marker: `${uid}-solid` }
  if (kind === 'async') return { dash: null, marker: `${uid}-open` }
  return { dash: '5 4', marker: `${uid}-open` }
}

/**
 * Decide which orientation a diagram should use and lay out whatever that
 * requires. An explicit `ir.direction` always wins outright (only that one
 * orientation is laid out). Otherwise both "right" and "down" are laid out
 * and compared by the amended contract row #16 rule: prefer "right" if it
 * fits the column unscaled (width <= column); otherwise prefer "down" if
 * *it* fits unscaled; otherwise fall back to whichever has the smaller
 * fitRatio = max(w/column, h/MAX_HEIGHT), same as before this amendment.
 *
 * This is the single source of truth both renderDiagram() and
 * chooseOrientation() build on, so the two can never disagree the way the
 * old renderDiagram (which only ever looked at the alternate orientation
 * when its first pick overflowed) could disagree with a plain fitRatio
 * comparison: a short, comfortably-fitting "right" chain has a small but
 * nonzero width/column ratio, while the equivalent "down" stack's
 * height/MAX_HEIGHT ratio is smaller still purely because MAX_HEIGHT (900)
 * is a larger denominator than column (720) — favoring "down" on every
 * ordinary chain even though "right" already fits outright.
 */
async function pickOrientation(ir, column) {
  if (ir.direction) {
    return { direction: ir.direction, pinned: true, layouts: { [ir.direction]: await layoutOnce(ir, ir.direction) } }
  }
  const right = await layoutOnce(ir, 'right')
  const down = await layoutOnce(ir, 'down')
  const rightFits = right.width <= column
  const downFits = down.width <= column
  const direction = rightFits ? 'right' : downFits ? 'down' : (fitRatio(down, column) < fitRatio(right, column) ? 'down' : 'right')
  return { direction, pinned: false, layouts: { right, down } }
}

/**
 * Render a validated diagram IR (see bin/lib/ir.mjs) to an SVG string.
 *
 * Orientation: see pickOrientation() above. If the winner is wider than
 * `column`, scale down to fit — but never below MIN_SCALE; past that point
 * we keep native size and report `scroll: true` instead of shrinking
 * further. The <svg>'s `width`/`height` attributes reflect that final
 * on-page CSS-px size (native, or scaled down when `scaled` is true); the
 * `viewBox` and the returned `width`/`height` fields always stay the
 * unscaled layout size so downstream geometry/verification math is
 * unaffected by presentation scaling.
 *
 * @param {object} ir normalized IR from ir.mjs
 * @param {{column?: number}} [opts]
 */
export async function renderDiagram(ir, { column = COLUMN } = {}) {
  const { direction, layouts } = await pickOrientation(ir, column)
  const best = layouts[direction]

  let scaled = false
  let scroll = false
  let displayWidth = best.width
  let displayHeight = best.height
  if (best.width > column) {
    const scale = column / best.width
    if (scale >= MIN_SCALE) { scaled = true; displayWidth = column; displayHeight = Math.round(best.height * scale) }
    else scroll = true
  }

  const drawn = draw(ir, best, { column, displayWidth, displayHeight })
  return {
    svg: drawn.svg,
    width: best.width,
    height: best.height,
    scaled,
    scroll,
    layout: { direction, boxes: best.abs, usedKinds: best.usedKinds, geo: drawn.geo },
  }
}

/**
 * Lay out both orientations and report which one renderDiagram would pick
 * (the amended row #16 rule — see pickOrientation()), without drawing.
 * Exposed for verify-diagram.mjs's orientation-choice check.
 */
export async function chooseOrientation(ir, { column = COLUMN } = {}) {
  if (ir.direction) return { direction: ir.direction, pinned: true }
  const { direction, layouts } = await pickOrientation(ir, column)
  return { direction, pinned: false, fitRatio: { right: fitRatio(layouts.right, column), down: fitRatio(layouts.down, column) } }
}

export const fitRatio = (l, column) => Math.max(l.width / column, l.height / MAX_HEIGHT)

// --- layout ----------------------------------------------------------------

async function layoutOnce(ir, direction) {
  const { nodes, groups, edges } = ir

  const elkNodes = new Map()
  for (const n of nodes) {
    const size = nodeSize(n.label, { bold: n.emphasis })
    elkNodes.set(n.id, { id: n.id, width: size.width, height: size.height, ports: [] })
  }

  // Local routing hints (from_side / to_side): give the node FIXED_SIDE port
  // constraints and an explicit port on the requested side, per node per edge.
  const edgePorts = edges.map(() => ({}))
  edges.forEach((e, i) => {
    if (e.from_side) edgePorts[i].fromPort = addPort(elkNodes.get(e.from), e.from, i, 'from', e.from_side)
    if (e.to_side) edgePorts[i].toPort = addPort(elkNodes.get(e.to), e.to, i, 'to', e.to_side)
  })

  const groupIndex = new Map(groups.map((g) => [g.id, g]))
  const rootGroups = groups.filter((g) => g.group === undefined)
  const childGroups = (parentId) => groups.filter((g) => g.group === parentId)

  const buildGroupNode = (g) => {
    const kids = nodes.filter((n) => n.group === g.id).map((n) => finalizeNode(elkNodes.get(n.id)))
    const subGroups = childGroups(g.id).map(buildGroupNode)
    const minW = snapUp4(Math.ceil(textWidth(g.label, FONT_SIZE) * BOLD_FACTOR) + NODE_PAD_X * 2)
    return {
      id: g.id,
      layoutOptions: {
        'elk.padding': `[top=${GROUP_HEADER},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${minW},60)`,
      },
      children: [...kids, ...subGroups],
    }
  }

  const children = [...rootGroups.map(buildGroupNode)]
  for (const n of nodes) if (!n.group) children.push(finalizeNode(elkNodes.get(n.id)))

  let labelSpace = 0
  const elkEdges = edges.map((e, i) => {
    const labels = []
    if (e.label) {
      const w = Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10
      labelSpace = Math.max(labelSpace, w)
      labels.push({ id: `el${i}`, text: e.label, width: w, height: 14 })
    }
    // `reply` edges point back toward an earlier layer; feed them to elk
    // reversed so layering has no cycle, then flip the drawn point order
    // back so the arrowhead still lands on the real target.
    const flip = e.kind === 'reply'
    const fromEnd = edgePorts[i].fromPort || e.from
    const toEnd = edgePorts[i].toPort || e.to
    return {
      id: `e${i}`,
      sources: [flip ? toEnd : fromEnd],
      targets: [flip ? fromEnd : toEnd],
      labels,
      kind: e.kind,
      flip,
      raw: e,
      index: i,
    }
  })
  const layerSpacing = Math.max(64, labelSpace + 36)

  const laid = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.nodeNode': '26',
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeLabel': '6',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children,
    edges: elkEdges.map(({ id, sources, targets, labels }) => ({ id, sources, targets, labels })),
  })

  const usedKinds = EDGE_KIND_ORDER.filter((k) => edges.some((e) => e.kind === k))
  const abs = absolutePositions(laid)
  const diagramWidth = Math.max(1, Math.ceil(laid.width))
  // The legend can need more room than the diagram itself (a short/narrow
  // diagram with long edge-kind labels): widen the canvas to fit it rather
  // than letting it clip or run past the svg's own viewBox (contract §4-2
  // #7 relies on the legend box actually being inside the canvas).
  const width = snapUp4(Math.max(diagramWidth, legendWidth(usedKinds)))
  const height = snapUp4(Math.max(1, Math.ceil(laid.height)) + (usedKinds.length ? LEGEND_H : 0))
  return { laid, elkEdges, abs, usedKinds, groupIndex, width, height }
}

function addPort(elkNode, nodeId, edgeIndex, role, side) {
  const portId = `${nodeId}__p${edgeIndex}_${role}`
  elkNode.ports.push({
    id: portId,
    width: 1,
    height: 1,
    layoutOptions: { 'elk.port.side': SIDE_TO_ELK[side] },
  })
  elkNode.__fixedSide = true
  return portId
}

function finalizeNode(elkNode) {
  const out = { id: elkNode.id, width: elkNode.width, height: elkNode.height }
  if (elkNode.ports.length) {
    out.ports = elkNode.ports
    out.layoutOptions = { 'elk.portConstraints': 'FIXED_SIDE' }
  }
  return out
}

// --- drawing -----------------------------------------------------------

function draw(ir, layout, { column, displayWidth, displayHeight }) {
  const { nodes, groups } = ir
  const { laid, elkEdges, abs, usedKinds, width, height } = layout
  const uid = `wu-d-${ir.id}`
  const parts = []
  // Collected in parallel with the SVG string so a caller (verify-diagram)
  // can check geometry against the contract's acceptance rows without
  // re-parsing the markup. Coordinates here are the exact post-snap values
  // that end up in the SVG attributes.
  const geo = { nodes: [], groups: [], edges: [], legend: null }

  parts.push(`<title id="${uid}-title">${esc(ir.title)}</title>`)
  parts.push(`<desc id="${uid}-desc">${esc(ir.caption || ir.title)}</desc>`)

  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push(`<marker id="${uid}-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`)
  parts.push('</defs>')

  // Groups: neutral container box. `tone` is recorded as data-tone so the
  // kit's --wu-fig-tone-* tokens can style it (see kit/writeup.css).
  const drawGroup = (g) => {
    const box = abs.get(g.id)
    if (!box) return
    const x = snap4(box.x), y = snap4(box.y), w = snapUp4(box.width), h = snapUp4(box.height)
    parts.push(`<rect id="${uid}-${g.id}" data-tone="${esc(g.tone)}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="var(--wu-rule-soft)" stroke="currentColor" stroke-width="1"/>`)
    parts.push(`<text x="${x + GROUP_PAD}" y="${y + 23}" font-size="${FONT_SIZE}" font-weight="700" fill="currentColor">${esc(g.label)}</text>`)
    geo.groups.push({ id: g.id, x, y, width: w, height: h, label: g.label, tone: g.tone })
  }
  for (const g of groups) drawGroup(g)

  // Nodes
  for (const n of nodes) {
    const box = abs.get(n.id)
    if (!box) continue
    const x = snap4(box.x), y = snap4(box.y), w = snapUp4(box.width), h = snapUp4(box.height)
    const cls = n.emphasis ? ' class="wu-focal"' : ''
    const dash = n.dashed ? ' stroke-dasharray="5 4"' : ''
    const sw = n.emphasis ? 1.5 : 1
    parts.push(`<rect id="${uid}-${n.id}" data-tone="${esc(n.tone)}"${cls} x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="currentColor" stroke-width="${sw}"${dash}/>`)
    const weight = n.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-${n.id}-label"${cls} x="${x + w / 2}" y="${y + h / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor"${weight}>${esc(n.label)}</text>`)
    geo.nodes.push({ id: n.id, x, y, width: w, height: h, label: n.label, tone: n.tone, emphasis: !!n.emphasis, dashed: !!n.dashed, group: n.group })
  }

  // Edges. `via` bypasses elk's own bend points: elkjs has no notion of
  // "route near this existing node without connecting to it", so a `via`
  // hint is honored as a manual orthogonal polyline through each via
  // node's center, inserted between elk's own start/end anchor points.
  // routeVia detours around any *other* node box that the naive hop would
  // cross (contract §4-2 #8) — see hopAvoiding below — but still does not
  // avoid other edges the way elk's own router does; that residual case is
  // caught (not fixed) by verify-diagram.mjs.
  for (const [i, e] of (laid.edges || []).entries()) {
    const meta = elkEdges[i]
    const off = abs.get(e.container || 'root') || { x: 0, y: 0 }
    const base = e.container && e.container !== 'root' ? { x: off.x, y: off.y } : { x: 0, y: 0 }
    const st = edgeStyle(meta.kind, uid)
    const geoEdge = { id: `${uid}-edge-${i}`, index: i, from: meta.raw.from, to: meta.raw.to, kind: meta.kind, sections: [], label: null }
    for (const sec of e.sections || []) {
      let raw = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => ({ x: p.x + base.x, y: p.y + base.y }))
      if (meta.flip) raw.reverse()
      if (meta.raw.via && meta.raw.via.length) {
        const attached = new Set([meta.raw.from, meta.raw.to, ...meta.raw.via])
        const obstacles = nodes.filter((n) => !attached.has(n.id)).map((n) => abs.get(n.id)).filter(Boolean)
        raw = routeVia(raw[0], raw[raw.length - 1], meta.raw.via.map((vid) => centerOf(abs.get(vid))), obstacles, VIA_CLEARANCE)
      }
      const snapped = raw.map((p) => ({ x: snap4(p.x), y: snap4(p.y) }))
      const pts = snapped.map((p) => `${p.x} ${p.y}`)
      const d = `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')}`
      const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
      parts.push(`<path id="${uid}-edge-${i}" d="${d}" fill="none" stroke="currentColor" stroke-width="1"${dash} marker-end="url(#${st.marker})"/>`)
      geoEdge.sections.push(snapped)
    }
    for (const lb of e.labels || []) {
      const lx = snap4(lb.x + base.x), ly = snap4(lb.y + base.y)
      parts.push(`<text x="${lx}" y="${snap4(lb.y + base.y + 11)}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(meta.raw.label)}</text>`)
      geoEdge.label = { x: lx, y: ly, width: lb.width || Math.ceil(textWidth(meta.raw.label, EDGE_LABEL_SIZE)) + 10, height: lb.height || 14, text: meta.raw.label }
    }
    geo.edges.push(geoEdge)
  }

  if (usedKinds.length) {
    const legendY = snap4(Math.ceil(laid.height) + 8)
    parts.push(legendSvg(usedKinds, uid, legendY))
    geo.legend = { x: 0, y: legendY, width, height: height - legendY }
  }

  // width/height are the on-page CSS-px size (native, or scaled down to
  // the column — contract §4-2 "natural size" fix): the browser stretches
  // or shrinks the viewBox's coordinate system to fill exactly that box,
  // so the figure never renders larger than intended just because its
  // container happens to be wider (kit/writeup.css's `.wu-figure svg` only
  // adds `max-width:100%; height:auto` on top, for narrower viewports).
  const dw = displayWidth ?? width
  const dh = displayHeight ?? height
  const svg = `<svg role="img" aria-labelledby="${uid}-title ${uid}-desc" width="${dw}" height="${dh}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
  return { svg, geo }
}

function centerOf(box) {
  if (!box) return { x: 0, y: 0 }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Minimum clearance a manual via-hop keeps from any node box it does not
// intend to touch (contract §4-2 #8 asks for 2px; padded so post-snap
// rounding of both the node box and the edge point never eats it away).
const VIA_CLEARANCE = 8

/**
 * Build an all-orthogonal polyline start -> via[0] -> ... -> end, detouring
 * around any `obstacles` box (a node the edge is not attached to) that the
 * direct hop would otherwise cut through or run too close to.
 */
function routeVia(start, end, viaPoints, obstacles = [], margin = VIA_CLEARANCE) {
  const points = [start, ...viaPoints, end]
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]
    const next = points[i]
    const hop = obstacles.length ? hopAvoiding(prev, next, obstacles, margin) : lShapeHop(prev, next)
    for (const p of hop.slice(1)) out.push(p)
  }
  return dedupePolyline(out)
}

/** The plain single-corner hop routeVia used before collision-avoidance existed. */
function lShapeHop(prev, next) {
  if (prev.x === next.x || prev.y === next.y) return [prev, next]
  return [prev, { x: next.x, y: prev.y }, next]
}

/** An orthogonal hop from `from` to `to` that keeps `margin` clear of every obstacle box. */
function hopAvoiding(from, to, obstacles, margin) {
  const bendA = [from, { x: to.x, y: from.y }, to]
  const bendB = [from, { x: from.x, y: to.y }, to]
  if (!polylineHitsAny(bendA, obstacles, margin)) return dedupePolyline(bendA)
  if (!polylineHitsAny(bendB, obstacles, margin)) return dedupePolyline(bendB)

  // Both single-corner hops cut through something: detour around the
  // union of the boxes actually in the way, going over the top or under
  // the bottom of that union, whichever costs less vertical travel.
  const blockers = obstacles.filter((o) => polylineHitsAny(bendA, [o], margin) || polylineHitsAny(bendB, [o], margin))
  const top = Math.min(...blockers.map((o) => o.y)) - margin
  const bottom = Math.max(...blockers.map((o) => o.y + o.height)) + margin
  const costAbove = Math.abs(from.y - top) + Math.abs(to.y - top)
  const costBelow = Math.abs(from.y - bottom) + Math.abs(to.y - bottom)
  const laneY = costAbove <= costBelow ? top : bottom
  return dedupePolyline([from, { x: from.x, y: laneY }, { x: to.x, y: laneY }, to])
}

function polylineHitsAny(path, obstacles, margin) {
  for (let i = 1; i < path.length; i++) {
    for (const o of obstacles) {
      if (segRectDist(path[i - 1], path[i], o) < margin) return true
    }
  }
  return false
}

/** Euclidean distance between an axis-aligned segment and a box (both treated as AABBs). */
function segRectDist(a, b, rect) {
  const rx1 = rect.x, rx2 = rect.x + rect.width, ry1 = rect.y, ry2 = rect.y + rect.height
  if (a.y === b.y) {
    const y = a.y, xlo = Math.min(a.x, b.x), xhi = Math.max(a.x, b.x)
    const dy = y < ry1 ? ry1 - y : y > ry2 ? y - ry2 : 0
    const dx = xhi < rx1 ? rx1 - xhi : xlo > rx2 ? xlo - rx2 : 0
    return Math.hypot(dx, dy)
  }
  const x = a.x, ylo = Math.min(a.y, b.y), yhi = Math.max(a.y, b.y)
  const dx = x < rx1 ? rx1 - x : x > rx2 ? x - rx2 : 0
  const dy = yhi < ry1 ? ry1 - yhi : ylo > ry2 ? ylo - ry2 : 0
  return Math.hypot(dx, dy)
}

function dedupePolyline(pts) {
  const out = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
  }
  return out
}

const LEGEND_PAD = 12
const LEGEND_SWATCH = 30
const LEGEND_SWATCH_GAP = 8
const LEGEND_ITEM_GAP = 22

/**
 * Per-kind legend item metrics (swatch position, label text position/width).
 * Shared by legendSvg() (drawing) and legendWidth() (sizing the canvas) so
 * the two can never drift apart — the canvas is only ever as wide as what
 * legendSvg actually draws.
 */
function legendItems(kinds) {
  let x = LEGEND_PAD
  const items = []
  for (const k of kinds) {
    const label = EDGE_KIND_LABEL[k]
    const labelWidth = Math.ceil(textWidth(label, EDGE_LABEL_SIZE))
    const swatchX = x
    const textX = swatchX + LEGEND_SWATCH + LEGEND_SWATCH_GAP
    items.push({ kind: k, label, swatchX, textX, labelWidth, end: textX + labelWidth })
    x = textX + labelWidth + LEGEND_ITEM_GAP
  }
  return items
}

/** Canvas width the legend needs, including its own left/right padding. */
export function legendWidth(kinds) {
  if (!kinds.length) return 0
  const items = legendItems(kinds)
  return items[items.length - 1].end + LEGEND_PAD
}

function legendSvg(kinds, uid, y) {
  const out = [`<g id="${uid}-legend" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">`]
  for (const item of legendItems(kinds)) {
    const st = edgeStyle(item.kind, uid)
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
    out.push(`<path d="M${item.swatchX} ${y + 8} L${item.swatchX + LEGEND_SWATCH} ${y + 8}" fill="none" stroke="currentColor" stroke-width="1"${dash} marker-end="url(#${st.marker})"/>`)
    out.push(`<text x="${item.textX}" y="${y + 12}">${esc(item.label)}</text>`)
  }
  out.push('</g>')
  return out.join('')
}

function absolutePositions(laid) {
  const map = new Map([['root', { x: 0, y: 0, width: laid.width, height: laid.height }]])
  const walk = (node, ox, oy) => {
    for (const c of node.children || []) {
      const x = ox + (c.x || 0)
      const y = oy + (c.y || 0)
      map.set(c.id, { x, y, width: c.width || 0, height: c.height || 0 })
      walk(c, x, y)
    }
  }
  walk(laid, 0, 0)
  return map
}

// --- figure wrapper ----------------------------------------------------

/**
 * Wrap a rendered diagram in the kit's <figure class="wu-figure"> markup,
 * matching kit/samples.html: svg, then figcaption, then the original IR
 * text preserved verbatim for re-editing / HTML->Markdown conversion.
 *
 * @param {object} ir normalized IR from ir.mjs
 * @param {{column?: number, rawYaml?: string}} [opts]
 */
export async function renderFigureHtml(ir, { column = COLUMN, rawYaml } = {}) {
  const rendered = await renderDiagram(ir, { column })
  const caption = ir.caption || ir.title
  const scrollAttr = rendered.scroll ? ' data-scroll="true"' : ''
  const script = rawYaml !== undefined ? rawYaml : ''
  return {
    html: `<figure class="wu-figure"${scrollAttr}>\n${rendered.svg}\n<figcaption>${esc(caption)}</figcaption>\n<script type="text/x-writeup-diagram">\n${script}\n</script>\n</figure>`,
    ...rendered,
  }
}
