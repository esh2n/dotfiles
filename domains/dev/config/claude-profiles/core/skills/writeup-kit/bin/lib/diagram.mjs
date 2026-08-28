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
import { escapeIrScript } from './ir-script.mjs'

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
async function pickOrientation(ir, column, { forceElk = false } = {}) {
  if (ir.direction) {
    return { direction: ir.direction, pinned: true, layouts: { [ir.direction]: await layoutOnce(ir, ir.direction, { forceElk }) } }
  }
  const right = await layoutOnce(ir, 'right', { forceElk })
  const down = await layoutOnce(ir, 'down', { forceElk })
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
 * @param {{column?: number, forceElk?: boolean}} [opts] `forceElk` renders
 *   with elk's compound-node hierarchical layout even when the IR would
 *   otherwise qualify for grouped-layer mode — used by verify-diagram.mjs's
 *   "try, verify, pick" strategy (see renderCheckedBest()) to lay out the
 *   fallback candidate for an IR that auto-qualifies for grouped-layer mode.
 *   Has no effect on an IR that doesn't qualify for grouped-layer mode in
 *   the first place (already elk either way).
 */
export async function renderDiagram(ir, { column = COLUMN, forceElk = false } = {}) {
  const { direction, layouts } = await pickOrientation(ir, column, { forceElk })
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
    layout: { direction, boxes: best.abs, usedKinds: best.usedKinds, geo: drawn.geo, mode: best.usedGroupLayerMode ? 'group' : 'elk' },
  }
}

/**
 * Lay out both orientations and report which one renderDiagram would pick
 * (the amended row #16 rule — see pickOrientation()), without drawing.
 * Exposed for verify-diagram.mjs's orientation-choice check. `forceElk` must
 * match whatever the renderResult being checked was itself rendered with, or
 * the recomputed "best" orientation can legitimately disagree — grouped-layer
 * and elk layouts of the same IR don't always fit the column the same way.
 */
export async function chooseOrientation(ir, { column = COLUMN, forceElk = false } = {}) {
  if (ir.direction) return { direction: ir.direction, pinned: true }
  const { direction, layouts } = await pickOrientation(ir, column, { forceElk })
  return { direction, pinned: false, fitRatio: { right: fitRatio(layouts.right, column), down: fitRatio(layouts.down, column) } }
}

export const fitRatio = (l, column) => Math.max(l.width / column, l.height / MAX_HEIGHT)

// --- grouped-layer mode ------------------------------------------------
//
// A "mirrored groups" diagram (org team A/B/C next to the system A/B/C it
// owns, conway.yaml being the fixture that exposed this) wants its groups
// drawn as parallel columns/rows, not elk's default hierarchical layout —
// elk's compound-node layered algorithm solves a *separate* layered
// sub-problem inside each group box, so an ordinary intra-group edge
// (ta->tb) pushes tb into a second internal layer instead of leaving it
// stacked beside ta, which detours every other edge around the resulting
// lopsided box.
//
// elk's `elk.layered.layering.layerChoiceConstraint` (the option whose id
// this feature was originally specified against) looks like the right
// primitive but is a no-op through elkjs: per its own metadata description
// ("this option is not part of any of ELK Layered's default configurations
// but is only evaluated as part of the InteractiveLayeredGraphVisitor,
// which must be applied manually or used via the DiagramLayoutEngine"), it
// only takes effect through a Java-only visitor elkjs never ports —
// confirmed empirically: setting it on a node has zero effect on the
// resulting layer. `elk.partitioning.activate` + `elk.partitioning.
// partition` (also real, documented options) DO work through elkjs, but
// only constrain relative *ordering* between different partitions, not
// "these same-partition nodes must share one layer" — a same-partition
// pair still gets split across layers by their own edges. The layout that
// actually works: flatten the whole diagram to elk's root (no elk compound
// group nodes at all), assign every node's partition = its group's layer,
// and simply never feed intra-group ("in-layer") edges to elk in the first
// place — with nothing forcing them apart, same-partition nodes with no
// edges *between* them collapse onto one shared layer on their own. Group
// boxes are then drawn from the resulting node bounds by hand (see the
// group-box block in layoutOnce()), and the omitted in-layer edges are
// drawn by hand too (see inLayerElbow()).

/**
 * Decide whether "grouped-layer" mode applies to `ir`, and if so, the elk
 * partition index (0-based "layer") each group gets. Returns `null` when
 * the mode does not apply, in which case layoutOnce() falls back to the
 * pre-existing elk-compound-node hierarchy unchanged.
 *
 * The mode is off when there are fewer than 2 groups, when any group
 * nests under another (nesting depth is orthogonal to this mode and not
 * supported by it — a nested group's own children still need the compound
 * hierarchy), when any group is hinted `layer: none` (an explicit
 * page-wide opt-out), or when some node belongs to no group at all (a
 * partition needs to be assigned to *every* node or the flat layout has
 * nothing to anchor an unassigned node to).
 *
 * Otherwise the mode is on when at least one group carries an explicit
 * numeric `layer:`, or — with no explicit hint anywhere — when the
 * inter-group edges (edges whose two endpoints sit in different groups)
 * form a DAG over the groups: each group's layer is then the length of the
 * longest path to it in that DAG, so "org" (no incoming inter-group edges)
 * sits at layer 0 and "sys" (reachable only via an org->sys edge) at layer
 * 1, transitively, however many hops separate them. A cycle between groups
 * (both A->B and B->A edges exist) has no well-defined topological order,
 * so auto-detection backs off (falls back to layer 0 for every group) —
 * an explicit numeric `layer:` still wins over that fallback per group.
 *
 * `analyzeGroups()` below folds this decision and `groupLayerMode()`'s
 * (forced-group/auto/forced-elk/off) into one pass over `ir.groups`/
 * `ir.edges` so the two can never drift apart — computeGroupLayers() (the
 * Map layoutOnce() actually lays out with) and groupLayerMode() (the label
 * verify-diagram.mjs's "try, verify, pick" strategy branches on) are both
 * thin views onto the same `{ mode, layers }` result.
 */
function analyzeGroups(ir) {
  const { groups, nodes, edges } = ir
  if (groups.length < 2) return { mode: 'off' }
  if (groups.some((g) => g.group !== undefined)) return { mode: 'off' }
  if (!nodes.every((n) => n.group !== undefined)) return { mode: 'off' }
  if (groups.some((g) => g.layer === 'none')) return { mode: 'forced-elk' }

  const groupIds = groups.map((g) => g.id)
  const nodeGroup = new Map(nodes.map((n) => [n.id, n.group]))
  const adj = new Map(groupIds.map((id) => [id, new Set()]))
  for (const e of edges) {
    const fromGroup = nodeGroup.get(e.from)
    const toGroup = nodeGroup.get(e.to)
    if (fromGroup !== undefined && toGroup !== undefined && fromGroup !== toGroup) adj.get(fromGroup).add(toGroup)
  }

  const dag = isAcyclic(groupIds, adj)
  const hasExplicit = groups.some((g) => typeof g.layer === 'number')
  if (!hasExplicit && !dag) return { mode: 'off' }

  const base = dag ? longestPathLayers(groupIds, adj) : new Map(groupIds.map((id) => [id, 0]))
  const layers = new Map()
  for (const g of groups) layers.set(g.id, typeof g.layer === 'number' ? g.layer : base.get(g.id))
  return { mode: hasExplicit ? 'forced-group' : 'auto', layers }
}

function computeGroupLayers(ir) {
  const a = analyzeGroups(ir)
  return a.mode === 'forced-group' || a.mode === 'auto' ? a.layers : null
}

/**
 * Whether `ir` qualifies for grouped-layer mode and, if so, whether that
 * came from an explicit per-group hint:
 * - `'off'` — doesn't qualify (see analyzeGroups()'s doc comment above for
 *   every disqualifying shape); layoutOnce() always uses elk's hierarchy.
 * - `'forced-elk'` — some group carries `layer: none`, an explicit
 *   page-wide opt-out; layoutOnce() always uses elk's hierarchy.
 * - `'forced-group'` — some group carries an explicit numeric `layer:`;
 *   the caller asked for grouped-layer mode outright, so verify-diagram.mjs
 *   renders only that mode (no elk fallback attempt).
 * - `'auto'` — qualifies purely by topological auto-detection (no explicit
 *   hint anywhere); this is the case renderCheckedBest() tries both modes
 *   for and picks the one that actually verifies.
 */
export function groupLayerMode(ir) {
  return analyzeGroups(ir).mode
}

/**
 * A cheap topology heuristic for the 'auto' case: grouped-layer mode's
 * hand-drawn cross-layer connector (crossLayerElbow()) draws one straight
 * elbow per edge from each box's own border, with no awareness of *other*
 * nodes or edges sharing its layer gap — unlike elk's own orthogonal
 * router, it never detours around a third node placed between the two it
 * connects, nor spaces itself apart from a parallel sibling beyond the
 * per-pair lane fan-out inLayerElbow() already does for repeated node
 * pairs. Two shapes are more likely than not to defeat that: a node with
 * more than one cross-layer edge (several elbows converging on/departing
 * the same border, crowding the node-clearance and label-clearance checks
 * more than a lone cross-layer edge would), and a long in-layer chain
 * within one group (>2 hops — the group-layer mode books enough same-layer
 * spacing for adjacent pairs, but a chain gives more edges more chances to
 * cut past a same-layer neighbor several hops down the line). Neither
 * condition *guarantees* a check failure — this only orders which mode
 * renderCheckedBest() tries and prefers first; a genuine failure is still
 * caught (and, if it flips the outcome, corrected) by the verify step.
 */
export function groupLayerHeuristicPrefersElk(ir) {
  const { nodes, groups, edges } = ir
  if (groups.length < 2) return false
  const nodeGroup = new Map(nodes.map((n) => [n.id, n.group]))
  const crossCount = new Map(nodes.map((n) => [n.id, 0]))
  const intraAdj = new Map(nodes.map((n) => [n.id, new Set()]))
  for (const e of edges) {
    const fg = nodeGroup.get(e.from)
    const tg = nodeGroup.get(e.to)
    if (fg === undefined || tg === undefined) continue
    if (fg !== tg) {
      crossCount.set(e.from, (crossCount.get(e.from) || 0) + 1)
      crossCount.set(e.to, (crossCount.get(e.to) || 0) + 1)
    } else if (e.from !== e.to) {
      intraAdj.get(e.from).add(e.to)
      intraAdj.get(e.to).add(e.from)
    }
  }
  const manyCrossPerNode = [...crossCount.values()].some((c) => c > 1)
  if (manyCrossPerNode) return true
  return longestChainLength(nodes.map((n) => n.id), intraAdj) > 2
}

/** Longest simple path (edge count) in an undirected adjacency map — small
 * graphs only (kit node-count budgets keep this well within brute-force DFS
 * range). Used by groupLayerHeuristicPrefersElk() to size in-layer chains. */
function longestChainLength(ids, adj) {
  let best = 0
  const visit = (node, visited, depth) => {
    if (depth > best) best = depth
    for (const next of adj.get(node)) {
      if (visited.has(next)) continue
      visited.add(next)
      visit(next, visited, depth + 1)
      visited.delete(next)
    }
  }
  for (const id of ids) visit(id, new Set([id]), 0)
  return best
}

/** DFS 3-color cycle check over the group graph `adj` (id -> Set<id>). */
function isAcyclic(ids, adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map(ids.map((id) => [id, WHITE]))
  const visit = (id) => {
    color.set(id, GRAY)
    for (const next of adj.get(id)) {
      if (color.get(next) === GRAY) return false
      if (color.get(next) === WHITE && !visit(next)) return false
    }
    color.set(id, BLACK)
    return true
  }
  for (const id of ids) if (color.get(id) === WHITE && !visit(id)) return false
  return true
}

/**
 * Longest-path layer assignment over a DAG (Kahn's algorithm + a running
 * max): a source (no incoming edges) sits at layer 0; every other node's
 * layer is 1 + the max layer among its direct predecessors. This is what
 * guarantees every group-graph edge always points from a strictly lower
 * layer to a strictly higher one, however many hops the DAG has.
 */
function longestPathLayers(ids, adj) {
  const indeg = new Map(ids.map((id) => [id, 0]))
  for (const id of ids) for (const next of adj.get(id)) indeg.set(next, indeg.get(next) + 1)
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const layer = new Map(ids.map((id) => [id, 0]))
  while (queue.length) {
    const id = queue.shift()
    for (const next of adj.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1))
      indeg.set(next, indeg.get(next) - 1)
      if (indeg.get(next) === 0) queue.push(next)
    }
  }
  return layer
}

/**
 * A hand-drawn connector between two nodes elk assigned to the same
 * group-layer column/row (see computeGroupLayers() and the "in-layer"
 * branch in layoutOnce()) — elk never routes this edge, so there is no elk
 * section to read for it. "right" stacks a layer's nodes vertically, so
 * the connector runs top-to-bottom between the two boxes' facing borders;
 * "down" stacks them horizontally, so it runs left-to-right instead. When
 * both boxes share the same center on the cross axis (the common case —
 * same-width nodes in one column/row, e.g. conway.yaml's ta/tb) the two
 * middle points collapse onto the two end points once normalizePolyline()
 * runs, leaving a single straight segment; when the boxes differ in size
 * enough that their centers don't line up, the elbow's middle jog keeps
 * every segment axis-aligned instead of drawing a diagonal.
 *
 * Only handles the case where nothing else sits between the two boxes on
 * the stacking axis — true for every fixture this kit currently draws in
 * this mode. A same-layer edge between two non-adjacent nodes would cut
 * straight through whatever sits between them; checkNodeClearance /
 * checkCrossings will flag that the same way they flag any other bad
 * route, and the fix is the same as elsewhere in the kit: reorder the
 * nodes (so the connected pair ends up adjacent) or give the edge an
 * explicit `via`.
 *
 * `offset` shifts both ends on the cross axis (x when stacking is
 * vertical, y when it's horizontal) — used to fan out multiple in-layer
 * edges between the *same* node pair (groups.yaml's gw<->db request/reply
 * pair) into parallel lanes instead of drawing them on top of each other,
 * which would fail both the collinear-overlap and label-clearance checks.
 * It is clamped to stay within each box's own span so the line still
 * touches that box's border, not float off its side.
 */
function inLayerElbow(fromBox, toBox, direction, offset = 0) {
  return elbowPoints(fromBox, toBox, direction !== 'down', offset)
}

/**
 * A hand-drawn connector between two nodes in *different* group-layer
 * columns/rows, replacing whatever polyline elk itself computed for a
 * plain (no `via`, no `from_side`/`to_side`) edge between them.
 *
 * elk is still fed this edge (see edgeInputs in layoutOnce()) so its
 * crossing-minimization still orders same-partition siblings using it —
 * only the *drawn* geometry is replaced. That turned out to be necessary,
 * not just tidier: elk's own edge-label handling can put one connected
 * pair a full extra layer-spacing further along the stacking axis than
 * another pair crossing the exact same two layers with the exact same
 * label (confirmed empirically — 3 identically-labeled parallel edges
 * between two elk.partitioning layers, and elk staggers one of them), so
 * even the box positions elk hands back for supposedly-aligned columns
 * can't be trusted at pixel level once labels are involved. Drawing every
 * plain grouped-layer edge from the final (already-realigned, see
 * layoutOnce()'s partition-alignment pass) box positions instead is what
 * actually keeps conway.yaml's three "写し取る" edges parallel and equal
 * length.
 *
 * `midOffset` shifts the elbow's own middle jog coordinate (midX/midY,
 * *not* the box-touching ends the way inLayerElbow's `offset` does) —
 * used to fan out multiple cross-layer edges that share the exact same
 * pair of layer-facing borders (see the corridor-grouping block in
 * layoutOnce()) apart from each other. A mirrored pair whose near/far
 * centers already line up (nearCy===farCy or nearCx===farCx — conway.yaml's
 * ta->sa etc.) draws a straight line regardless of `midOffset`:
 * normalizePolyline() collapses the jog away before the offset can ever
 * show up, since the jog's only visible when the centers *don't* line up
 * — exactly the case where two edges sharing a corridor would otherwise
 * overlap.
 */
function crossLayerElbow(fromBox, toBox, direction, midOffset = 0) {
  return elbowPoints(fromBox, toBox, direction === 'down', 0, midOffset)
}

/**
 * Shared elbow-shape math for inLayerElbow()/crossLayerElbow(): a 4-point
 * polyline between two boxes' facing borders, running along the `vertical`
 * axis (y) when true, the horizontal axis (x) otherwise. When both boxes
 * share the same coordinate on the *other* axis (the common case — same
 * column/row), normalizePolyline() collapses the two middle points onto
 * the two ends, leaving a single straight segment; otherwise the middle
 * jog keeps every segment axis-aligned instead of drawing a diagonal.
 * `offset` (inLayerElbow only) shifts both ends on the non-`vertical` axis,
 * clamped to stay within each box's own span, to fan out multiple edges
 * between the same node pair onto parallel lanes. `midOffset`
 * (crossLayerElbow only) shifts the jog's own mid coordinate instead, to
 * fan out multiple edges that share the same pair of facing borders.
 */
function elbowPoints(fromBox, toBox, vertical, offset, midOffset = 0) {
  const fromFirst = vertical ? fromBox.y <= toBox.y : fromBox.x <= toBox.x
  const near = fromFirst ? fromBox : toBox
  const far = fromFirst ? toBox : fromBox
  const clamped = (box) => {
    const room = Math.max(0, (vertical ? box.width : box.height) / 2 - 10)
    return Math.max(-room, Math.min(room, offset))
  }
  let pts
  if (vertical) {
    const nearCx = near.x + near.width / 2 + clamped(near)
    const farCx = far.x + far.width / 2 + clamped(far)
    const nearY = near.y + near.height
    const farY = far.y
    const midY = (nearY + farY) / 2 + midOffset
    pts = [{ x: nearCx, y: nearY }, { x: nearCx, y: midY }, { x: farCx, y: midY }, { x: farCx, y: farY }]
  } else {
    const nearCy = near.y + near.height / 2 + clamped(near)
    const farCy = far.y + far.height / 2 + clamped(far)
    const nearX = near.x + near.width
    const farX = far.x
    const midX = (nearX + farX) / 2 + midOffset
    pts = [{ x: nearX, y: nearCy }, { x: midX, y: nearCy }, { x: midX, y: farCy }, { x: farX, y: farCy }]
  }
  return fromFirst ? pts : pts.slice().reverse()
}

// --- layout ----------------------------------------------------------------

async function layoutOnce(ir, direction, { forceElk = false } = {}) {
  const { nodes, groups, edges } = ir
  const groupLayers = forceElk ? null : computeGroupLayers(ir)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const partitionOf = (nodeId) => {
    if (!groupLayers) return undefined
    const grp = nodeById.get(nodeId)?.group
    return grp === undefined ? undefined : groupLayers.get(grp)
  }

  const elkNodes = new Map()
  for (const n of nodes) {
    const size = nodeSize(n.label, { bold: n.emphasis })
    elkNodes.set(n.id, { id: n.id, width: size.width, height: size.height, ports: [], partition: partitionOf(n.id) })
  }

  // Build one elk edge per "hop". A plain edge is a single hop (from -> to).
  // An edge with `via: [v1, v2, …]` becomes a chain of hops
  // (from -> v1 -> v2 -> … -> to) fed to elk as real edges, so elk assigns
  // real ports on every via node and routes each hop orthogonally between
  // real node borders — never through a via node's interior the way a
  // hand-rolled "route near this node" polyline would. `from_side`/`to_side`
  // only ever apply to the chain's outer ends (the first hop's source, the
  // last hop's target); via nodes get elk's own port choice. `reply` edges
  // are still fed to elk reversed per hop (layering has no cycle) and
  // flipped back per hop when draw() stitches the hops into one path.
  //
  // Edge labels are reserved room via `labelSpace` either way, but only a
  // plain edge's label is attached to elk (elk positions it along its one
  // segment). A `via` edge's label has no single elk edge to attach to —
  // draw() places it manually at `label_at` along the assembled path's
  // total length instead (see pointAtLength()).
  //
  // In grouped-layer mode (groupLayers !== null), an edge whose two
  // endpoints share a partition ("in-layer") is left out of `edgeInputs`
  // altogether — see the "grouped-layer mode" comment above
  // computeGroupLayers() for why — and marked `isInLayer` instead; its
  // geometry is filled in by hand once node positions are known (the
  // group-box block below). A *plain* edge between two different
  // partitions (`crossLayerEligible`) is still fed to elk — its
  // crossing-minimization still needs it to order same-partition siblings
  // well — but its drawn geometry gets replaced the same way, by
  // crossLayerElbow(): see that function's doc comment for why elk's own
  // routing can't be trusted at pixel level here either. An edge with
  // `via` or an explicit `from_side`/`to_side` keeps elk's real routing
  // regardless of mode — that hint asked for elk's own port logic.
  let labelSpace = 0
  let labelLines = 1
  let inLayerLabelSpace = 0
  const edgeInputs = []
  const edgeMeta = edges.map((e, i) => {
    const labelWidth = e.label ? Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10 : 0
    const labelLineCount = e.label ? String(e.label).split('\n').length : 1
    const hasVia = !!(e.via && e.via.length)
    const hasPorts = !!(e.from_side || e.to_side)
    const fp = partitionOf(e.from)
    const tp = partitionOf(e.to)
    const groupedPlain = groupLayers !== null && !hasVia && !hasPorts && fp !== undefined && tp !== undefined
    const isInLayer = groupedPlain && fp === tp
    if (isInLayer) {
      if (e.label) inLayerLabelSpace = Math.max(inLayerLabelSpace, labelWidth)
      return { index: i, raw: e, kind: e.kind, flip: false, hasVia: false, isInLayer: true, crossLayerEligible: false, hopIds: [] }
    }

    // A plain (no via, no groups at all) edge in "down" orientation runs
    // vertically, so its label reads sideways-on to the layering axis —
    // handing it to elk as a real edge label hits the exact same elk
    // quirk documented just below for groupedPlain edges (a dedicated
    // label layer padded by nodeNodeBetweenLayers on *both* sides, doubling
    // the requested gap: 64+64+14=142px measured on a plain 4-node chain
    // with a single short label, before this fix). Hand-placing it the same
    // way via/groupedPlain edges already do keeps the real layer-to-layer
    // gap equal to what layerSpacing (see below) actually asked for.
    //
    // Scoped to `groups.length === 0` deliberately: a diagram with groups
    // (whether grouped-layer/flat mode, where these edges are already
    // groupedPlain/isInLayer and never reach here, or the older elk
    // compound-node hierarchy from `layer: none` / forceElk) hands elk a
    // much busier routing problem, and bypassing elk's own label-layer
    // reservation there was found empirically to shrink elk's routing
    // budget enough to reopen unrelated label/edge clearance and rhythm
    // failures on conway.yaml's forced-elk case — that mode keeps its
    // pre-existing (already-passing) elk-label behavior untouched.
    const manualLabel = direction === 'down' && !hasVia && !groupedPlain && groups.length === 0
    // Whether elk itself positions this edge's label (attached below as a
    // real elk edge label). Only a label the renderer places by hand
    // (via / groupedPlain / manualLabel — all placed at `label_at` along the
    // final path) needs `labelSpace` to widen the inter-layer gap so the
    // run is long enough to carry it: elk reserves a dedicated label-sized
    // dummy layer for every label it places itself, padded by
    // nodeNodeBetweenLayers on BOTH sides, so counting such a label into
    // nodeNodeBetweenLayers as well booked its width three times over
    // (2 x (label + 36) + label): a 13-char CJK label turned every "right"
    // layer gap into ~530px and a 4-node, 3-group figure into a 1908px-wide
    // sideways-scrolling SVG whose right-hand group nobody ever saw.
    const elkPlacesLabel = !!e.label && !hasVia && !groupedPlain && !manualLabel
    if (e.label) {
      if (!elkPlacesLabel) labelSpace = Math.max(labelSpace, labelWidth)
      labelLines = Math.max(labelLines, labelLineCount)
    }
    const flip = e.kind === 'reply'
    const chain = hasVia ? [e.from, ...e.via, e.to] : [e.from, e.to]
    const hopCount = chain.length - 1
    const hopIds = []
    for (let h = 0; h < hopCount; h++) {
      const hopFrom = chain[h]
      const hopTo = chain[h + 1]
      let fromEnd = hopFrom
      let toEnd = hopTo
      if (h === 0 && e.from_side) fromEnd = addPort(elkNodes.get(hopFrom), hopFrom, i, 'from', e.from_side)
      if (h === hopCount - 1 && e.to_side) toEnd = addPort(elkNodes.get(hopTo), hopTo, i, 'to', e.to_side)
      const hopId = `e${i}_h${h}`
      hopIds.push(hopId)
      // A groupedPlain edge's drawn geometry (and label) is entirely
      // hand-computed later (see crossLayerElbow() and the manualSections
      // block) — attaching a label here would only cost accuracy for
      // nothing gained: empirically, elk gives 3 identically-labeled
      // parallel edges between the same two elk.partitioning layers a
      // layer-to-layer gap several times wider than
      // nodeNodeBetweenLayers alone (it appears to reserve a label-sized
      // dummy layer *per edge* rather than sharing one), which is exactly
      // what made conway.yaml's "写し取る" edges too long. `labelSpace`
      // (below) still widens the real inter-layer gap enough for our own
      // hand-placed label to fit.
      const labels = elkPlacesLabel ? [{ id: `el${i}`, text: e.label, width: labelWidth, height: 14 }] : []
      edgeInputs.push({ id: hopId, sources: [flip ? toEnd : fromEnd], targets: [flip ? fromEnd : toEnd], labels })
    }
    return { index: i, raw: e, kind: e.kind, flip, hasVia, isInLayer: false, crossLayerEligible: groupedPlain, manualLabel, hopIds }
  })
  // Between-layer spacing must reserve room along the axis an edge label
  // actually occupies there, which flips with orientation: "right" runs
  // edges horizontally and stacks each label above its run, so the label's
  // WIDTH eats into the horizontal gap between columns — but only for a
  // label the renderer places by hand (`labelSpace` counts just those, see
  // `elkPlacesLabel` above; a label elk places gets its own elk-reserved
  // label layer instead, so the gap here stays at the 64px base). "down"
  // runs edges vertically and sits the label beside the line, so only the
  // label's (line-count-driven) HEIGHT matters there — using width for
  // "down" too was the bug: it reserved a whole label's text width as
  // *vertical* whitespace between every layer, e.g. a 216px gap for a
  // couple of short 4-5 char labels on a plain 4-node chain.
  const layerSpacing = direction === 'down'
    ? Math.max(64, labelLines * 16 + 32)
    : Math.max(64, labelSpace + 36)
  // Same-layer node spacing needs extra room only when an in-layer edge
  // carries a label (the label is centered on the connector — see
  // inLayerElbow()/draw()'s manual-label branch — and needs headroom
  // between the two boxes it sits between); everywhere else this keeps the
  // pre-existing fixed 26px.
  const sameLayerSpacing = groupLayers ? Math.max(26, inLayerLabelSpace + 16) : 26

  // Group/node children are built only now, after every addPort() call
  // above has already mutated each elkNode's `ports` array — finalizeNode()
  // snapshots `ports` at this point, so ports must exist before it runs.
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

  // Grouped-layer mode feeds elk a flat graph — every node a direct root
  // child carrying `elk.partitioning.partition` — instead of the nested
  // compound group nodes buildGroupNode() produces; group boxes are drawn
  // from the resulting node bounds afterward (see the group-box block
  // below), the same way the legend is sized from what it will actually
  // draw rather than delegated to elk.
  let children
  const rootExtraOptions = {}
  if (groupLayers) {
    children = nodes.map((n) => finalizeNode(elkNodes.get(n.id)))
    rootExtraOptions['elk.partitioning.activate'] = 'true'
    // A node whose every edge is in-layer (excluded from edgeInputs above —
    // groups.yaml's "db" is exactly this: both gw->db and db->gw are
    // intra-group) is otherwise a fully disconnected node in elk's eyes.
    // elk's default `separateConnectedComponents` packs each disconnected
    // piece into its own compact block *before* honoring partitioning,
    // which can strand such a node outside its group's column/row entirely
    // — disabling it keeps every node, edge-less or not, positioned by its
    // partition alone.
    rootExtraOptions['elk.separateConnectedComponents'] = 'false'
  } else {
    children = [...rootGroups.map(buildGroupNode)]
    for (const n of nodes) if (!n.group) children.push(finalizeNode(elkNodes.get(n.id)))
  }

  // Grouped-layer mode reserves room for each group's header text
  // (GROUP_HEADER, 36px) since elk no longer draws the group boxes itself
  // and so never accounts for it: "right" places layers side by side, so
  // every column's header sits in the same top band — boost the root's own
  // top padding once. "down" stacks layers top to bottom, so *every* layer
  // after the first also needs its own header room immediately above it —
  // boost the inter-layer spacing too, on top of the one-time top padding
  // for the first layer's header. The root's side/bottom padding is also
  // floored to GROUP_PAD (16px, more than the usual 12px) so a group box —
  // which pads GROUP_PAD beyond its member nodes on those three sides —
  // never lands at a negative coordinate.
  const rootPaddingTop = groupLayers ? 12 + GROUP_HEADER : 12
  const rootPaddingSide = groupLayers ? Math.max(12, GROUP_PAD) : 12
  const layerSpacingUsed = groupLayers && direction === 'down' ? layerSpacing + GROUP_HEADER : layerSpacing

  const laid = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': `[top=${rootPaddingTop},left=${rootPaddingSide},bottom=${rootPaddingSide},right=${rootPaddingSide}]`,
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacingUsed),
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.nodeNode': String(sameLayerSpacing),
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeLabel': '6',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      ...rootExtraOptions,
    },
    children,
    edges: edgeInputs,
  })
  const usedKinds = EDGE_KIND_ORDER.filter((k) => edges.some((e) => e.kind === k))
  const abs = absolutePositions(laid)

  if (groupLayers) {
    // elk's own per-node layer assignment can drift apart within one
    // partition once edge labels are involved — confirmed empirically: 3
    // identically-labeled parallel edges crossing the same two
    // elk.partitioning layers, and elk staggers one of them a full extra
    // layer-spacing along the stacking axis, even though every one of them
    // is a plain edge with no reason to differ. Force every node in a
    // partition onto the same stacking-axis coordinate (the furthest-out
    // one, so nothing ever lands *before* another member and re-crosses an
    // earlier partition's boundary) — the cross-axis (sibling ordering)
    // coordinate elk chose is left alone. This is safe unconditionally
    // (not just for edge-less nodes like groups.yaml's "db") because every
    // plain edge's drawn geometry gets recomputed from these final
    // positions right below (crossLayerElbow/inLayerElbow), never read
    // from elk's own (now possibly stale) polyline.
    const axisKey = direction === 'down' ? 'y' : 'x'
    const byPartition = new Map()
    for (const n of nodes) {
      const p = partitionOf(n.id)
      if (p === undefined) continue
      if (!byPartition.has(p)) byPartition.set(p, [])
      byPartition.get(p).push(n.id)
    }
    for (const ids of byPartition.values()) {
      const boxes = ids.map((id) => abs.get(id)).filter(Boolean)
      if (boxes.length < 2) continue
      const target = Math.max(...boxes.map((b) => b[axisKey]))
      for (const id of ids) {
        const b = abs.get(id)
        if (b && b[axisKey] !== target) abs.set(id, { ...b, [axisKey]: target })
      }
    }

    // Group box = the bounding box of its member nodes' actual positions,
    // padded the same way buildGroupNode()'s elk.padding padded a compound
    // group node (GROUP_HEADER on top for the label, GROUP_PAD elsewhere),
    // widened to the label's own minimum width when the members alone
    // wouldn't be wide enough for it to fit.
    for (const g of groups) {
      const memberBoxes = nodes.filter((n) => n.group === g.id).map((n) => abs.get(n.id)).filter(Boolean)
      if (!memberBoxes.length) continue
      const minX = Math.min(...memberBoxes.map((b) => b.x))
      const minY = Math.min(...memberBoxes.map((b) => b.y))
      const maxX = Math.max(...memberBoxes.map((b) => b.x + b.width))
      const maxY = Math.max(...memberBoxes.map((b) => b.y + b.height))
      const minW = snapUp4(Math.ceil(textWidth(g.label, FONT_SIZE) * BOLD_FACTOR) + NODE_PAD_X * 2)
      abs.set(g.id, {
        x: minX - GROUP_PAD,
        y: minY - GROUP_HEADER,
        width: Math.max(maxX - minX + GROUP_PAD * 2, minW),
        height: (maxY - minY) + GROUP_HEADER + GROUP_PAD,
      })
    }
    // Now that node positions are final, fill in the geometry of every
    // edge elk's own polyline can no longer be trusted for in this mode:
    // in-layer edges (elk never routed them at all -- see the edgeMeta loop
    // above) and crossLayerEligible edges (elk did route them, but see
    // crossLayerElbow()'s doc comment for why that routing is discarded
    // anyway). Two (or more) in-layer edges between the *same* node pair --
    // e.g. groups.yaml's gw->db request and db->gw reply, both inside the
    // "server" group -- fan out onto parallel lanes (see inLayerElbow()'s
    // `offset`) instead of being drawn on top of each other.
    const pairs = new Map()
    for (const meta of edgeMeta) {
      if (!meta.isInLayer) continue
      const key = [meta.raw.from, meta.raw.to].slice().sort().join(' ')
      if (!pairs.has(key)) pairs.set(key, [])
      pairs.get(key).push(meta)
    }
    const IN_LAYER_LANE_MIN_GAP = 24
    for (const metas of pairs.values()) {
      const n = metas.length
      const maxLabelW = Math.max(0, ...metas.map((m) => (
        m.raw.label ? Math.ceil(textWidth(m.raw.label, EDGE_LABEL_SIZE)) + 10 : 0
      )))
      const gap = n > 1 ? Math.max(IN_LAYER_LANE_MIN_GAP, maxLabelW + 16) : 0
      metas.forEach((meta, idx) => {
        const offset = (idx - (n - 1) / 2) * gap
        const fromBox = abs.get(meta.raw.from)
        const toBox = abs.get(meta.raw.to)
        meta.manualSections = fromBox && toBox ? [inLayerElbow(fromBox, toBox, direction, offset)] : []
      })
    }
    // crossLayerEligible edges connecting the exact same pair of
    // layer-facing borders (e.g. every edge crossing from layer 0 straight
    // into layer 1 has an identical near/far border pair once the
    // axis-alignment pass above pins every node in a partition to one
    // shared stacking-axis coordinate) would otherwise all compute the
    // identical elbow mid coordinate from crossLayerElbow(), landing their
    // middle jogs collinear and overlapping (checkCollinearOverlap)
    // whenever the jog isn't degenerate — i.e. whenever the two edges
    // connect node pairs whose centers don't already line up on the cross
    // axis (a mirrored pair like conway.yaml's ta->sa always lines up, so
    // this never touches that fixture — see crossLayerElbow()'s doc
    // comment). Fan same-corridor edges across parallel mid coordinates the
    // same way the in-layer loop above fans repeated same-pair edges, wide
    // enough that a label riding the widest one still keeps its 6px
    // clearance from a neighbor's path (checkLabelClearance).
    const corridorAxisVertical = direction === 'down'
    // The near/far border pair a given (fromBox, toBox) pair would draw its
    // elbow between — see elbowPoints()'s own near/far selection, mirrored
    // here so a corridor's grouping key and its span are read the exact
    // same way the geometry itself will be computed.
    const corridorSpan = (fromBox, toBox) => {
      const fromFirst = corridorAxisVertical ? fromBox.y <= toBox.y : fromBox.x <= toBox.x
      const near = fromFirst ? fromBox : toBox
      const far = fromFirst ? toBox : fromBox
      return corridorAxisVertical ? [near.y + near.height, far.y] : [near.x + near.width, far.x]
    }
    // Whether this edge's own elbow is degenerate (its two boxes already
    // share a coordinate on the cross axis, so normalizePolyline() collapses
    // the jog to a single straight segment regardless of any mid coordinate
    // — conway.yaml's mirrored ta->sa is exactly this shape). A degenerate
    // edge never needs — or safely tolerates — a nonzero midOffset: since
    // its whole path sits on one line already, nudging the mid coordinate
    // off that line reintroduces a jog (and, if the nudge overshoots the
    // corridor's own span, a direction-reversing zigzag) for no reason, so
    // it's excluded from the fan-out below and always drawn with offset 0.
    const isDegenerate = (fromBox, toBox) => (
      corridorAxisVertical
        ? fromBox.x + fromBox.width / 2 === toBox.x + toBox.width / 2
        : fromBox.y + fromBox.height / 2 === toBox.y + toBox.height / 2
    )
    const corridors = new Map()
    for (const meta of edgeMeta) {
      if (!meta.crossLayerEligible) continue
      const fromBox = abs.get(meta.raw.from)
      const toBox = abs.get(meta.raw.to)
      if (!fromBox || !toBox) continue
      if (isDegenerate(fromBox, toBox)) { meta.manualSections = [crossLayerElbow(fromBox, toBox, direction, 0)]; continue }
      const [nearCoord, farCoord] = corridorSpan(fromBox, toBox)
      const key = `${nearCoord}|${farCoord}`
      if (!corridors.has(key)) corridors.set(key, { metas: [], nearCoord, farCoord })
      corridors.get(key).metas.push(meta)
    }
    const CROSS_LANE_MIN_GAP = 24
    const CROSS_LANE_MARGIN = 12
    for (const { metas, nearCoord, farCoord } of corridors.values()) {
      const n = metas.length
      if (n === 1) {
        const [meta] = metas
        const fromBox = abs.get(meta.raw.from)
        const toBox = abs.get(meta.raw.to)
        meta.manualSections = [crossLayerElbow(fromBox, toBox, direction, 0)]
        continue
      }
      const center = (nearCoord + farCoord) / 2
      const lo = Math.min(nearCoord, farCoord) + CROSS_LANE_MARGIN
      const hi = Math.max(nearCoord, farCoord) - CROSS_LANE_MARGIN
      const maxLabelW = Math.max(0, ...metas.map((m) => (
        m.raw.label ? Math.ceil(textWidth(m.raw.label, EDGE_LABEL_SIZE)) + 10 : 0
      )))
      const gap = Math.max(CROSS_LANE_MIN_GAP, maxLabelW + 16)
      metas.forEach((meta, idx) => {
        const target = center + (idx - (n - 1) / 2) * gap
        // Clamp the fanned position to the corridor's own span (minus a
        // small margin) so a wide gap (many edges, or a long label) can
        // never push the jog past the far side's own border and invert the
        // path's direction into a backtracking zigzag instead of a clean
        // elbow. A corridor too narrow for even the margin (lo > hi) just
        // falls every member back to the shared center — no worse than the
        // pre-fan-out overlap this loop exists to avoid.
        const midOffset = (hi >= lo ? Math.max(lo, Math.min(hi, target)) : center) - center
        const fromBox = abs.get(meta.raw.from)
        const toBox = abs.get(meta.raw.to)
        meta.manualSections = fromBox && toBox ? [crossLayerElbow(fromBox, toBox, direction, midOffset)] : []
      })
    }
  }

  let diagramWidth = Math.max(1, Math.ceil(laid.width))
  let diagramHeight = Math.max(1, Math.ceil(laid.height))
  if (groupLayers) {
    // Group boxes (GROUP_PAD/GROUP_HEADER padded beyond their member
    // nodes) can protrude past elk's own laid.width/height, which only
    // ever accounted for the flat nodes' extents plus the root's 12px
    // padding — widen the canvas so a group box is never clipped.
    for (const g of groups) {
      const b = abs.get(g.id)
      if (!b) continue
      diagramWidth = Math.max(diagramWidth, Math.ceil(b.x + b.width) + 12)
      diagramHeight = Math.max(diagramHeight, Math.ceil(b.y + b.height) + 12)
    }
  }
  // The legend can need more room than the diagram itself (a short/narrow
  // diagram with long edge-kind labels): widen the canvas to fit it rather
  // than letting it clip or run past the svg's own viewBox (contract §4-2
  // #7 relies on the legend box actually being inside the canvas).
  const width = snapUp4(Math.max(diagramWidth, legendWidth(usedKinds)))
  const height = snapUp4(Math.max(1, diagramHeight) + (usedKinds.length ? LEGEND_H : 0))
  return { laid, edgeMeta, abs, usedKinds, groupIndex, width, height, usedGroupLayerMode: !!groupLayers }
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
  const layoutOptions = {}
  if (elkNode.ports.length) {
    out.ports = elkNode.ports
    layoutOptions['elk.portConstraints'] = 'FIXED_SIDE'
  }
  if (elkNode.partition !== undefined) layoutOptions['elk.partitioning.partition'] = String(elkNode.partition)
  if (Object.keys(layoutOptions).length) out.layoutOptions = layoutOptions
  return out
}

// --- drawing -----------------------------------------------------------

function draw(ir, layout, { column, displayWidth, displayHeight }) {
  const { nodes, groups } = ir
  const { laid, edgeMeta, abs, usedKinds, width, height } = layout
  const laidById = new Map((laid.edges || []).map((e) => [e.id, e]))
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

  // Edges. A plain edge is one hop, drawn exactly as elk laid it out. A
  // `via` edge is a chain of hops (see layoutOnce) that elk laid out and
  // ported independently — each hop touches its via node's real border,
  // never its interior — and is stitched here into ONE drawn path: a
  // single <path> whose `d` uses one "M…L…" subpath per hop (so the SVG
  // never draws a straight connector between a hop's end and the next
  // hop's start, which could cut across the via node's box) and exactly
  // one marker-end (SVG only ever places marker-end at the path's very
  // last vertex, so a chain of hops draws exactly one arrowhead, on the
  // final hop, with no marker at the via touch points in between).
  for (const meta of edgeMeta) {
    const e = meta.raw
    const st = edgeStyle(meta.kind, uid)
    const geoEdge = { id: `${uid}-edge-${meta.index}`, index: meta.index, from: e.from, to: e.to, kind: meta.kind, sections: [], label: null }
    // An in-layer edge (see the grouped-layer mode comment above
    // computeGroupLayers()) was never fed to elk, so its geometry comes
    // from the manual sections layoutOnce() computed once node positions
    // were known, not from laidById.
    const hopSections = meta.manualSections ? meta.manualSections : []
    let elkLabel = null
    if (!meta.manualSections) {
      for (const hopId of meta.hopIds) {
        const laidEdge = laidById.get(hopId)
        if (!laidEdge) continue
        const off = abs.get(laidEdge.container || 'root') || { x: 0, y: 0 }
        const base = laidEdge.container && laidEdge.container !== 'root' ? { x: off.x, y: off.y } : { x: 0, y: 0 }
        for (const sec of laidEdge.sections || []) {
          let raw = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => ({ x: p.x + base.x, y: p.y + base.y }))
          if (meta.flip) raw.reverse()
          hopSections.push(raw)
        }
        if (!meta.hasVia && !meta.manualLabel && e.label) {
          for (const lb of laidEdge.labels || []) elkLabel = { x: lb.x + base.x, y: lb.y + base.y, width: lb.width, height: lb.height }
        }
      }
    }

    const snappedSections = hopSections.map((raw) => normalizePolyline(raw.map((p) => ({ x: snap4(p.x), y: snap4(p.y) }))))
    const d = snappedSections.map((pts) => {
      const strs = pts.map((p) => `${p.x} ${p.y}`)
      return `M${strs[0]} ${strs.slice(1).map((p) => `L${p}`).join(' ')}`
    }).join(' ')
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
    parts.push(`<path id="${uid}-edge-${meta.index}" d="${d}" fill="none" stroke="currentColor" stroke-width="1"${dash} marker-end="url(#${st.marker})"/>`)
    geoEdge.sections = snappedSections

    if (e.label) {
      let lx, ly, lw, lh
      if (meta.hasVia || meta.manualSections || meta.manualLabel) {
        // No single elk edge to attach the label to (hasVia/manualSections),
        // or elk was deliberately never given one to avoid its dummy-layer
        // doubling (manualLabel — see the comment above where it's set) —
        // either way, place it manually at `label_at` (default 0.5) along
        // the assembled path's total length.
        lw = Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10
        lh = 14
        const pt = pointAtLength(snappedSections, totalPathLength(snappedSections) * (e.label_at ?? 0.5))
        lx = snap4(pt.x - lw / 2)
        ly = snap4(pt.y - lh / 2)
      } else if (elkLabel) {
        lx = snap4(elkLabel.x)
        ly = snap4(elkLabel.y)
        lw = elkLabel.width || Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10
        lh = elkLabel.height || 14
      }
      if (lx !== undefined) {
        parts.push(`<text x="${lx}" y="${snap4(ly + 11)}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(e.label)}</text>`)
        geoEdge.label = { x: lx, y: ly, width: lw, height: lh, text: e.label }
      }
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

/**
 * Normalize one axis-aligned polyline to its minimal point list: drop
 * consecutive duplicate points, then merge any run of consecutive
 * collinear segments that keep moving in the same direction on the same
 * axis into a single segment (skipping the redundant intermediate
 * vertices). A genuine turn — the direction changes axis, or reverses
 * back over the same axis — is never merged away, so a real short jog
 * still shows up as its own segment for the rhythm check (contract §4-2
 * #6) to see.
 *
 * elk sometimes hands back consecutive identical points (a via/port touch
 * point repeated) or several collinear bend points along what is really
 * one straight run; left as-is those become 0px (or otherwise sub-floor)
 * "segments" that trip checkRhythm even though nothing is actually drawn
 * there. Normalizing after the 4px snap (snapping itself can also collapse
 * two close points onto the same grid cell) is what both the drawn `d`
 * path and the geometry handed to verify-diagram.mjs should see.
 *
 * @param {{x:number,y:number}[]} points
 * @returns {{x:number,y:number}[]}
 */
export function normalizePolyline(points) {
  const deduped = []
  for (const p of points) {
    const last = deduped[deduped.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) deduped.push(p)
  }
  if (deduped.length < 3) return deduped
  const out = [deduped[0], deduped[1]]
  for (let i = 2; i < deduped.length; i++) {
    const p = deduped[i]
    const b = out[out.length - 1]
    const a = out[out.length - 2]
    const dir1 = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
    const dir2 = { x: Math.sign(p.x - b.x), y: Math.sign(p.y - b.y) }
    if (dir1.x === dir2.x && dir1.y === dir2.y) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/** Manhattan length of one axis-aligned segment. */
function manhattanLen(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/** Total drawn length of a `via` edge's assembled path — the sum of every
 * segment in every hop's section, deliberately NOT counting any (undrawn)
 * gap between one hop's end and the next hop's start at a via node's
 * border, since `label_at` positions the label along what actually gets
 * drawn. */
function totalPathLength(sections) {
  let len = 0
  for (const sec of sections) for (let i = 1; i < sec.length; i++) len += manhattanLen(sec[i - 1], sec[i])
  return len
}

/** The point `target` manhattan-length units along `sections` (see
 * totalPathLength) — clamped to the last point if `target` overruns. */
function pointAtLength(sections, target) {
  let acc = 0
  for (const sec of sections) {
    for (let i = 1; i < sec.length; i++) {
      const a = sec[i - 1], b = sec[i]
      const len = manhattanLen(a, b)
      const isLast = sec === sections[sections.length - 1] && i === sec.length - 1
      if (acc + len >= target || isLast) {
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, (target - acc) / len))
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      }
      acc += len
    }
  }
  const last = sections[sections.length - 1]
  return last[last.length - 1]
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
 * Wrap an already-rendered diagram (renderDiagram()'s return shape — svg +
 * scroll are the only fields read here) in the kit's
 * <figure class="wu-figure"> markup, matching kit/samples.html: svg, then
 * figcaption, then the original IR text preserved verbatim for re-editing /
 * HTML->Markdown conversion. Split out from renderFigureHtml() so
 * verify-diagram.mjs's renderCheckedBest() — which may render two candidate
 * layouts (grouped-layer and elk) before picking a winner — can wrap
 * whichever `rendered` it already has, instead of rendering a third time.
 *
 * @param {object} ir normalized IR from ir.mjs
 * @param {{svg: string, scroll: boolean}} rendered renderDiagram()'s return
 * @param {{rawYaml?: string}} [opts]
 */
export function wrapFigureHtml(ir, rendered, { rawYaml } = {}) {
  const caption = ir.caption || ir.title
  const scrollAttr = rendered.scroll ? ' data-scroll="true"' : ''
  // The IR text is embedded inside a <script> raw-text element, which
  // browsers never HTML-decode — escape it here so a user-authored label
  // or caption can never inject a literal tag or close the block early
  // (contract in ir-script.mjs; readers unescape with unescapeIrScript).
  const script = rawYaml !== undefined ? escapeIrScript(rawYaml) : ''
  return `<figure class="wu-figure"${scrollAttr}>\n${rendered.svg}\n<figcaption>${esc(caption)}</figcaption>\n<script type="text/x-writeup-diagram">\n${script}\n</script>\n</figure>`
}

/**
 * @param {object} ir normalized IR from ir.mjs
 * @param {{column?: number, rawYaml?: string, forceElk?: boolean}} [opts]
 */
export async function renderFigureHtml(ir, { column = COLUMN, rawYaml, forceElk = false } = {}) {
  const rendered = await renderDiagram(ir, { column, forceElk })
  return {
    html: wrapFigureHtml(ir, rendered, { rawYaml }),
    ...rendered,
  }
}
