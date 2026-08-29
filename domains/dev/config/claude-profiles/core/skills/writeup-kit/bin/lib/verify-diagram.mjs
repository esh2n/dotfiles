// Machine verification of a rendered diagram against the writeup contract's
// §4-2 acceptance table (20 rows). Takes the validated IR plus the object
// renderDiagram() returns (svg, width, height, scaled, scroll, layout with
// layout.geo — node/group/edge geometry in the exact post-snap coordinates
// that ended up in the SVG) and reports pass/fail with a concrete hint for
// every failing row.
//
// Geometry checks work directly on layout.geo instead of re-parsing the
// SVG string, because every edge is guaranteed axis-aligned (contract #1),
// which turns segment/rect distance into simple 1-D interval math. a11y,
// color, font-size, and stroke/rx checks read the SVG text itself since
// that is the artifact those rows actually constrain — those svg-level rows
// (a11y / dark-3-state / font-size / stroke-radius / single-finite-svg /
// projected-scale) are the ones every figure kind shares, so they are
// imported from figures/_shared.mjs rather than defined here.
//
// Any `type:` other than the builtin node/edge diagram is a figure plugin
// (bin/lib/figures/<type>.mjs): renderCheckedBest() / renderFigureHtmlChecked()
// route it through figures/index.mjs's renderFigure() + verifyFigure() and
// keep the same output contract (data-checks / data-warn / data-type).
import { LIMITS, budgetWarnings, formatBudgetWarnings } from './ir.mjs'
import {
  textWidth, FONT_SIZE, NODE_PAD_X, BOLD_FACTOR, COLUMN, chooseOrientation,
  renderDiagram, wrapFigureHtml,
  groupLayerMode, groupLayerHeuristicPrefersElk, LABEL_CLEARANCE,
} from './diagram.mjs'
import { getFigureType, isPluginType, renderFigure, verifyFigure } from './figures/index.mjs'
import {
  checkA11y, checkNoHexColors, checkFontSizes, checkStrokeAndRadius, checkSingleFiniteSvg, checkProjectedScale,
  summarizeChecks,
} from './figures/_shared.mjs'

// LABEL_CLEARANCE (row #2's 6px floor) is imported from diagram.mjs: the
// renderer's own manual-label placement keeps the same distance from every
// other edge, so the two can never drift apart.
const GRID = 4
const COLLINEAR_OVERLAP_LIMIT = 8
const BORDER_HUG_DIST = 4
const BORDER_HUG_LEN = 16
const MIN_SEGMENT = 8
const MIN_INTERIOR_SEGMENT = 16
const NODE_CLEARANCE = 2

// --- axis-aligned geometry helpers -----------------------------------------

const isHoriz = (a, b) => a.y === b.y
const segLen = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Euclidean distance between an axis-aligned segment and a rect (both treated as AABBs). */
function segRectDistance(a, b, rect) {
  const rx1 = rect.x, rx2 = rect.x + rect.width
  const ry1 = rect.y, ry2 = rect.y + rect.height
  if (isHoriz(a, b)) {
    const y = a.y
    const xlo = Math.min(a.x, b.x), xhi = Math.max(a.x, b.x)
    const dy = y < ry1 ? ry1 - y : y > ry2 ? y - ry2 : 0
    const dx = xhi < rx1 ? rx1 - xhi : xlo > rx2 ? xlo - rx2 : 0
    return Math.hypot(dx, dy)
  }
  const x = a.x
  const ylo = Math.min(a.y, b.y), yhi = Math.max(a.y, b.y)
  const dx = x < rx1 ? rx1 - x : x > rx2 ? x - rx2 : 0
  const dy = yhi < ry1 ? ry1 - yhi : ylo > ry2 ? ylo - ry2 : 0
  return Math.hypot(dx, dy)
}

/** True transversal crossing of two axis-aligned segments (a T-junction touch does not count). */
function segCross(a1, a2, b1, b2) {
  const aH = isHoriz(a1, a2), bH = isHoriz(b1, b2)
  if (aH === bH) return false // parallel — see collinearOverlap instead
  const h = aH ? [a1, a2] : [b1, b2]
  const v = aH ? [b1, b2] : [a1, a2]
  const hy = h[0].y, hxlo = Math.min(h[0].x, h[1].x), hxhi = Math.max(h[0].x, h[1].x)
  const vx = v[0].x, vylo = Math.min(v[0].y, v[1].y), vyhi = Math.max(v[0].y, v[1].y)
  return vx > hxlo && vx < hxhi && hy > vylo && hy < vyhi
}

/** Overlap length of two collinear (same orientation, same line) segments; 0 if not collinear. */
function collinearOverlap(a1, a2, b1, b2) {
  const aH = isHoriz(a1, a2), bH = isHoriz(b1, b2)
  if (aH !== bH) return 0
  if (aH) {
    if (a1.y !== b1.y) return 0
    const alo = Math.min(a1.x, a2.x), ahi = Math.max(a1.x, a2.x)
    const blo = Math.min(b1.x, b2.x), bhi = Math.max(b1.x, b2.x)
    return Math.max(0, Math.min(ahi, bhi) - Math.max(alo, blo))
  }
  if (a1.x !== b1.x) return 0
  const alo = Math.min(a1.y, a2.y), ahi = Math.max(a1.y, a2.y)
  const blo = Math.min(b1.y, b2.y), bhi = Math.max(b1.y, b2.y)
  return Math.max(0, Math.min(ahi, bhi) - Math.max(alo, blo))
}

/** Overlap length of a segment running parallel to another segment within `maxDist`; 0 otherwise. */
function parallelOverlap(a1, a2, b1, b2, maxDist) {
  const aH = isHoriz(a1, a2), bH = isHoriz(b1, b2)
  if (aH !== bH) return 0
  if (aH) {
    if (Math.abs(a1.y - b1.y) > maxDist) return 0
    const alo = Math.min(a1.x, a2.x), ahi = Math.max(a1.x, a2.x)
    const blo = Math.min(b1.x, b2.x), bhi = Math.max(b1.x, b2.x)
    return Math.max(0, Math.min(ahi, bhi) - Math.max(alo, blo))
  }
  if (Math.abs(a1.x - b1.x) > maxDist) return 0
  const alo = Math.min(a1.y, a2.y), ahi = Math.max(a1.y, a2.y)
  const blo = Math.min(b1.y, b2.y), bhi = Math.max(b1.y, b2.y)
  return Math.max(0, Math.min(ahi, bhi) - Math.max(alo, blo))
}

function borderSegs(box) {
  const { x, y, width: w, height: h } = box
  return [
    [{ x, y }, { x: x + w, y }], // top
    [{ x, y: y + h }, { x: x + w, y: y + h }], // bottom
    [{ x, y }, { x, y: y + h }], // left
    [{ x: x + w, y }, { x: x + w, y: y + h }], // right
  ]
}

const related = (e1, e2) => e1.from === e2.from || e1.from === e2.to || e1.to === e2.from || e1.to === e2.to

/** All (a,b) consecutive point pairs across every section of a geo edge. */
function* segments(edge) {
  for (const sec of edge.sections) {
    for (let i = 1; i < sec.length; i++) yield [sec[i - 1], sec[i]]
  }
}

// --- checks (contract §4-2, rows 1-20) --------------------------------------

function checkOrthogonal(ctx) {
  const offenders = new Set()
  for (const e of ctx.geo.edges) {
    for (const [a, b] of segments(e)) {
      if (a.x !== b.x && a.y !== b.y) offenders.add(`edges[${e.index}] (${e.from}->${e.to})`)
    }
  }
  const bad = [...offenders]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `diagonal segment in ${bad.join(', ')}` : 'every edge segment is horizontal or vertical',
    hint: bad.length ? `${bad.join(', ')}: add from_side/to_side hints (or a via node) so elk keeps the route orthogonal` : undefined,
  }
}

function checkLabelClearance(ctx) {
  const offenders = []
  for (const e of ctx.geo.edges) {
    if (!e.label) continue
    let worst = Infinity
    let blockerIdx = null
    for (const other of ctx.geo.edges) {
      if (other.index === e.index) continue
      for (const [a, b] of segments(other)) {
        const d = segRectDistance(a, b, e.label)
        if (d < worst) { worst = d; blockerIdx = other.index }
      }
    }
    if (worst < LABEL_CLEARANCE) offenders.push({ e, worst, blockerIdx })
  }
  const ok = offenders.length === 0
  return {
    ok,
    detail: ok
      ? 'every edge label clears every other edge path by ≥6px'
      : offenders.map((o) => `label "${o.e.label.text}" of edges[${o.e.index}] is ${o.worst.toFixed(1)}px from edges[${o.blockerIdx}]`).join('; '),
    hint: ok ? undefined : offenders.map((o) => `move the label of edges[${o.e.index}] with label_at, or reroute edges[${o.blockerIdx}] with from_side/to_side/via`).join('; '),
  }
}

function checkCrossings(ctx) {
  const edges = ctx.geo.edges
  const offenders = new Set()
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i], e2 = edges[j]
      if (related(e1, e2)) continue
      for (const [a1, a2] of segments(e1)) {
        for (const [b1, b2] of segments(e2)) {
          if (segCross(a1, a2, b1, b2)) offenders.add(`edges[${e1.index}]×edges[${e2.index}]`)
        }
      }
    }
  }
  const bad = [...offenders]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `unrelated edges cross: ${bad.join(', ')}` : 'no unrelated edges cross',
    hint: bad.length ? `reroute one side of ${bad.join(', ')} with from_side/to_side/via so the paths no longer cross` : undefined,
  }
}

function checkCollinearOverlap(ctx) {
  const edges = ctx.geo.edges
  const offenders = []
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i], e2 = edges[j]
      if (related(e1, e2)) continue
      for (const [a1, a2] of segments(e1)) {
        for (const [b1, b2] of segments(e2)) {
          const overlap = collinearOverlap(a1, a2, b1, b2)
          if (overlap >= COLLINEAR_OVERLAP_LIMIT) offenders.push(`edges[${e1.index}] and edges[${e2.index}] share ${overlap}px of the same lane`)
        }
      }
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'no unrelated edges share ≥8px of the same lane',
    hint: offenders.length ? `${offenders.join('; ')} — offset one edge with from_side/to_side` : undefined,
  }
}

function checkBorderHug(ctx) {
  const offenders = []
  for (const g of ctx.geo.groups) {
    for (const border of borderSegs(g)) {
      for (const e of ctx.geo.edges) {
        for (const [a, b] of segments(e)) {
          const overlap = parallelOverlap(a, b, border[0], border[1], BORDER_HUG_DIST)
          if (overlap >= BORDER_HUG_LEN) offenders.push(`edges[${e.index}] runs ${overlap}px along group "${g.id}"'s border`)
        }
      }
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'no edge traces a group border',
    hint: offenders.length ? `${offenders.join('; ')} — nudge the route off the border with from_side/to_side` : undefined,
  }
}

function checkRhythm(ctx) {
  const offenders = []
  for (const e of ctx.geo.edges) {
    for (const sec of e.sections) {
      const n = sec.length - 1
      for (let i = 1; i <= n; i++) {
        const len = segLen(sec[i - 1], sec[i])
        const interior = n >= 3 && i >= 2 && i <= n - 1
        const min = interior ? MIN_INTERIOR_SEGMENT : MIN_SEGMENT
        if (len < min) offenders.push(`edges[${e.index}] segment ${i}/${n} is ${len}px (< ${min}px${interior ? ', interior' : ''})`)
      }
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every segment meets the 8px/16px rhythm floor',
    hint: offenders.length ? `${offenders.join('; ')} — give elk more room (wider node spacing) or drop the via bend causing the short jog` : undefined,
  }
}

function checkLegend(ctx) {
  if (!ctx.geo.legend) return { ok: true, detail: 'no legend (no edge kinds to show)' }
  const offenders = []
  for (const e of ctx.geo.edges) {
    for (const [a, b] of segments(e)) {
      if (segRectDistance(a, b, ctx.geo.legend) <= 0) offenders.push(`edges[${e.index}]`)
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? `legend intersected by ${offenders.join(', ')}` : 'legend sits clear of every edge',
    hint: offenders.length ? `${offenders.join(', ')} extends into the legend row — shorten the diagram or move the legend-triggering edge` : undefined,
  }
}

function checkNodeClearance(ctx) {
  const offenders = []
  for (const e of ctx.geo.edges) {
    const irEdge = ctx.ir.edges[e.index]
    const attached = new Set([e.from, e.to, ...(irEdge?.via || [])])
    for (const n of ctx.geo.nodes) {
      if (attached.has(n.id)) continue
      for (const [a, b] of segments(e)) {
        const d = segRectDistance(a, b, n)
        if (d < NODE_CLEARANCE) offenders.push(`edges[${e.index}] passes ${d.toFixed(1)}px from unrelated node "${n.id}"`)
      }
    }
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'no edge passes within 2px of a node it is not attached to',
    hint: offenders.length ? `${offenders.join('; ')} — route around it with from_side/to_side/via` : undefined,
  }
}

// The four budget rows (#10, #11, #21, #22) are `warn` severity: they read
// ir.mjs's budgetWarnings() — the same source validateIR() reports from —
// so a figure that is only over budget still renders and passes, carrying
// the overrun in `data-warn`. Geometry (every other row) decides pass/fail.
function budgetCheck(key, okDetail) {
  return (ctx) => {
    const w = ctx.budget.find((b) => b.key === key)
    if (!w) return { ok: true, detail: okDetail(ctx) }
    return { ok: false, detail: w.detail, hint: w.hint, key: w.key, value: w.value }
  }
}

const checkNodeCount = budgetCheck('budget:nodes', (ctx) => `${ctx.ir.nodes.length} node(s) (guidance ≤ ${LIMITS.maxNodes})`)
const checkEdgeCount = budgetCheck('budget:edges', (ctx) => `${ctx.ir.edges.length} edge(s) (guidance ≤ ${LIMITS.maxEdges})`)
const checkGroupCount = budgetCheck('budget:groups', (ctx) => `${ctx.ir.groups.length} group(s) (guidance ≤ ${LIMITS.maxGroups})`)
const checkLabelLength = budgetCheck('budget:label', () => `every edge label is ≤ ${LIMITS.maxLabelLen} chars`)

function checkGrid(ctx) {
  const offenders = []
  const check = (v, label) => { if (v % GRID !== 0) offenders.push(`${label}=${v}`) }
  for (const n of ctx.geo.nodes) {
    check(n.x, `node "${n.id}".x`); check(n.y, `node "${n.id}".y`)
    check(n.width, `node "${n.id}".width`); check(n.height, `node "${n.id}".height`)
  }
  for (const g of ctx.geo.groups) {
    check(g.x, `group "${g.id}".x`); check(g.y, `group "${g.id}".y`)
    check(g.width, `group "${g.id}".width`); check(g.height, `group "${g.id}".height`)
  }
  for (const e of ctx.geo.edges) {
    for (const [a, b] of segments(e)) { check(a.x, `edges[${e.index}].x`); check(a.y, `edges[${e.index}].y`); check(b.x, `edges[${e.index}].x`); check(b.y, `edges[${e.index}].y`) }
    if (e.label) { check(e.label.x, `edges[${e.index}].label.x`); check(e.label.y, `edges[${e.index}].label.y`) }
  }
  const uniq = [...new Set(offenders)]
  return {
    ok: uniq.length === 0,
    detail: uniq.length ? `off-grid: ${uniq.slice(0, 6).join(', ')}${uniq.length > 6 ? ', …' : ''}` : 'every coordinate/size sits on the 4px grid',
    hint: uniq.length ? 'run every drawn coordinate through snap4()/snapUp4() before writing it to the svg' : undefined,
  }
}

function checkEmphasis(ctx) {
  const count = ctx.ir.nodes.filter((n) => n.emphasis).length
  if (count === 0) return { ok: true, detail: '0 emphasis nodes — contract asks for 1–2 but treats 0 as acceptable (no focal point chosen yet)' }
  const ok = count <= LIMITS.maxEmphasis
  return {
    ok,
    detail: `${count} emphasis node(s)`,
    hint: ok ? undefined : `drop emphasis from ${count - LIMITS.maxEmphasis} node(s) — only 1–2 focal points are allowed`,
  }
}

function checkLabelFit(ctx) {
  const offenders = []
  for (const n of ctx.geo.nodes) {
    const bold = n.emphasis ? BOLD_FACTOR : 1
    const needed = textWidth(n.label, FONT_SIZE) * bold
    const available = n.width - NODE_PAD_X * 2
    if (needed > available) offenders.push(`node "${n.id}" label "${n.label}" needs ~${Math.ceil(needed)}px but the box gives ${available}px`)
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every node label fits its box at the estimated width',
    hint: offenders.length ? `${offenders.join('; ')} — shorten the label` : undefined,
  }
}

async function checkOrientation(ctx) {
  const chosen = await chooseOrientation(ctx.ir, { column: ctx.column, forceElk: ctx.forceElk })
  if (chosen.pinned) return { ok: true, detail: `direction pinned to "${chosen.direction}" — auto-select does not apply` }
  const actual = ctx.renderResult.layout.direction
  const ok = actual === chosen.direction
  return {
    ok,
    detail: `renderer picked "${actual}"; recomputed best fit is "${chosen.direction}" (fitRatio right=${chosen.fitRatio.right.toFixed(3)}, down=${chosen.fitRatio.down.toFixed(3)})`,
    hint: ok ? undefined : `pin direction: ${chosen.direction} in the IR — the renderer chose the worse-fitting orientation`,
  }
}

// --- driver ------------------------------------------------------------

// [id, name, fn, severity]: `fail` rows gate rendering; `warn` rows (the
// four budgets) are advisory — a failing warn row is reported in
// `warnings` and `data-warn`, never in `failures`.
const CHECK_DEFS = [
  [1, 'orthogonal', checkOrthogonal, 'fail'],
  [2, 'label-clearance', checkLabelClearance, 'fail'],
  [3, 'unrelated-crossing', checkCrossings, 'fail'],
  [4, 'collinear-overlap', checkCollinearOverlap, 'fail'],
  [5, 'border-hug', checkBorderHug, 'fail'],
  [6, 'rhythm', checkRhythm, 'fail'],
  [7, 'legend-clearance', checkLegend, 'fail'],
  [8, 'node-clearance', checkNodeClearance, 'fail'],
  [9, 'projected-scale', checkProjectedScale, 'fail'],
  [10, 'node-count', checkNodeCount, 'warn'],
  [11, 'edge-count', checkEdgeCount, 'warn'],
  [12, 'grid-4px', checkGrid, 'fail'],
  [13, 'emphasis-count', checkEmphasis, 'fail'],
  [14, 'a11y', checkA11y, 'fail'],
  [15, 'label-fit', checkLabelFit, 'fail'],
  [16, 'orientation-choice', checkOrientation, 'fail'],
  [17, 'dark-3-state', checkNoHexColors, 'fail'],
  [18, 'font-size', checkFontSizes, 'fail'],
  [19, 'stroke-radius', checkStrokeAndRadius, 'fail'],
  [20, 'single-finite-svg', checkSingleFiniteSvg, 'fail'],
  [21, 'group-count', checkGroupCount, 'warn'],
  [22, 'label-length', checkLabelLength, 'warn'],
]

export { formatBudgetWarnings }

/**
 * Verify a rendered diagram against the writeup contract's §4-2 acceptance
 * table: rows 1–20 plus the two extra budget rows 21–22. Every check has a
 * severity — `fail` (geometry, a11y, svg hygiene) or `warn` (the four
 * budgets: node/edge/group count and edge-label length). `ok` is true when
 * no `fail` row fails; budget overruns only populate `warnings`.
 *
 * @param {object} ir validated IR from ir.mjs
 * @param {object} renderResult the object renderDiagram() returns — must
 *   carry `layout.geo` (nodes/groups/edges geometry). Hand-built objects of
 *   the same shape are accepted, which is how tests exercise adversarial
 *   layouts without going through elk.
 * @param {{column?: number, forceElk?: boolean}} [opts] `forceElk` must
 *   match whatever `renderResult` was itself rendered with (see
 *   diagram.mjs's chooseOrientation() doc comment) — row #16 recomputes the
 *   orientation choice for the same mode, not the IR's default mode.
 * @returns {Promise<{ok: boolean, checks: Array<{id:number, name:string, severity:'fail'|'warn', ok:boolean, detail:string, hint?:string}>, failures: object[], warnings: Array<{id:number, name:string, key:string, value:number, detail:string, hint?:string}>}>}
 */
export async function verifyDiagram(ir, renderResult, { column = COLUMN, forceElk = false } = {}) {
  if (!renderResult || !renderResult.layout || !renderResult.layout.geo) {
    throw new Error('verifyDiagram requires renderResult.layout.geo (render with the current diagram.mjs, or build one with the same shape)')
  }
  const ctx = {
    ir, renderResult, geo: renderResult.layout.geo, svg: renderResult.svg, column, forceElk,
    budget: budgetWarnings(ir),
  }

  const checks = []
  for (const [id, name, fn, severity] of CHECK_DEFS) {
    // runCheck() is sync; row #16 (orientation-choice) is async, so await
    // inside a try of its own here.
    let result
    try {
      result = await fn(ctx)
    } catch (e) {
      result = { ok: false, detail: `check threw: ${e.message}`, hint: 'internal verifier error — check the renderResult/ir shape passed in' }
    }
    const check = { id, name, severity, ok: result.ok, detail: result.detail, hint: result.hint }
    if (severity === 'warn' && !result.ok) {
      check.key = result.key
      check.value = result.value
    }
    checks.push(check)
  }
  return summarizeChecks(checks)
}

/** renderDiagram() + verifyDiagram() for one specific mode, tagged with
 * which mode it used — the building block renderCheckedBest() compares.
 * `warn` is the ready-made `data-warn` value ('' when nothing to warn). */
async function renderAndVerify(ir, { column, forceElk, layoutMode }) {
  const rendered = await renderDiagram(ir, { column, forceElk })
  const verification = await verifyDiagram(ir, rendered, { column, forceElk })
  return {
    ...rendered,
    checks: verification.checks,
    checksOk: verification.ok,
    failures: verification.failures,
    warnings: verification.warnings,
    warn: formatBudgetWarnings(verification.warnings),
    layoutMode,
  }
}

const countFailing = (r) => r.checks.filter((c) => !c.ok).length

/** Candidate ranking for renderCheckedBest(): a candidate with zero
 * failures beats any that has one; among those, one that shows whole in the
 * column (no sideways scroll — native or scaled within MIN_SCALE) beats one
 * that scrolls; then fewer warnings; then fewer failing rows overall
 * (today's crossing/geometry tie-break); a full tie keeps the first-tried
 * (heuristically preferred) candidate. Returns true when `b` should
 * replace `a`.
 *
 * "No scroll" ranks above "fewer warnings" deliberately: a budget warning
 * is advisory text in `data-warn`, while a scrolling figure hides its
 * right-hand part from every reader who doesn't drag sideways — a
 * passing-but-1900px-wide layout must never outrank a compact one that
 * fits. */
export function betterCandidate(a, b) {
  const aClean = a.failures.length === 0, bClean = b.failures.length === 0
  if (aClean !== bClean) return bClean
  if (a.scroll !== b.scroll) return !b.scroll
  if (a.warnings.length !== b.warnings.length) return b.warnings.length < a.warnings.length
  return countFailing(b) < countFailing(a)
}

const isClean = (r) => r.checksOk && r.warnings.length === 0 && !r.scroll

/** The orientation to retry when a pinned one can only be shown with a
 * sideways scroll. */
const otherDirection = (d) => (d === 'down' ? 'right' : 'down')

/**
 * Render `ir` in one layout mode and verify it; when `ir.direction` is
 * pinned and that orientation falls back to scroll (wider than
 * column / MIN_SCALE), also render the *other* orientation (pinned in a
 * copy of the IR, so row #16 keeps treating it as an explicit choice) and
 * return both candidates, pinned one first. An unpinned IR already picks
 * its orientation inside renderDiagram() (see pickOrientation()), so it
 * yields a single candidate; a pinned orientation that merely scales down
 * (>= MIN_SCALE) is honored outright and also yields one.
 *
 * A pin is a preference about reading direction, not a request to scroll:
 * the real page this was measured on carried `direction: right` (a
 * Mermaid `flowchart LR` migrated 1:1) on a 3-group figure whose "right"
 * layout is ~1400px wide even with spacing fixed — its groups' node and
 * edge labels simply don't fit side by side in a 720px column — while
 * "down" showed the whole figure at native size.
 */
async function renderCandidates(ir, { column, forceElk, layoutMode }) {
  const first = await renderAndVerify(ir, { column, forceElk, layoutMode })
  if (!ir.direction || !first.scroll) return [first]
  const retry = { ...ir, direction: otherDirection(ir.direction) }
  const second = await renderAndVerify(retry, { column, forceElk, layoutMode })
  return [first, second]
}

/**
 * The "try, verify, pick" strategy for an IR that may qualify for
 * grouped-layer mode (see diagram.mjs's groupLayerMode()):
 *
 * - `'forced-elk'`/`'off'` — only elk's hierarchical layout ever applies;
 *   render and verify that once.
 * - `'forced-group'` — a group carries an explicit numeric `layer:`, an
 *   explicit request for grouped-layer mode; render and verify that once,
 *   no elk fallback attempt (the caller asked for this mode outright).
 * - `'auto'` — the IR qualifies purely by topological auto-detection.
 *   Render *both* modes and verify each; return the first that is clean
 *   (no failing row, no warning). groupLayerHeuristicPrefersElk() (a cheap
 *   topology read — see its doc comment in diagram.mjs) decides which mode
 *   is tried, and preferred on a tie, first: normally grouped-layer, but
 *   elk first when the IR's cross-layer/in-layer edge shape is one the
 *   hand-drawn grouped-layer router is more likely to struggle with.
 *   Otherwise the better candidate wins (betterCandidate(): zero failures
 *   first, then no sideways scroll, then fewer warnings, then fewer failing
 *   rows — so a caller reporting an exit-3 failure still gets the
 *   more-nearly-passing candidate's hints).
 *
 * Orthogonally to the mode, every mode tried contributes one candidate per
 * orientation renderCandidates() lays out: the IR's own (auto-picked, or
 * pinned) orientation, plus the other one when a pinned orientation could
 * only be shown scrolling. "Clean" — the early-return condition — means
 * every row passes, no warning, and no scroll.
 *
 * A plugin IR (`ir.type` other than `diagram`) skips all of this: it has
 * one deterministic layout, rendered and verified once through
 * figures/index.mjs (renderPluginChecked()).
 *
 * @param {object} ir validated IR from ir.mjs
 * @param {{column?: number}} [opts]
 * @returns {Promise<object>} a renderDiagram()-shaped result plus
 *   `checks`, `checksOk`, `failures`, `warnings`, `warn` (the `data-warn`
 *   string, '' when none) and `layoutMode` ('group'|'elk' — which mode
 *   won; the type name for a plugin figure)
 */
export async function renderCheckedBest(ir, { column = COLUMN } = {}) {
  if (ir.type && ir.type !== 'diagram') return renderPluginChecked(ir, { column })
  const mode = groupLayerMode(ir)
  let order
  if (mode === 'forced-group') order = [{ forceElk: false, layoutMode: 'group' }]
  else if (mode !== 'auto') order = [{ forceElk: true, layoutMode: 'elk' }]
  else if (groupLayerHeuristicPrefersElk(ir)) order = [{ forceElk: true, layoutMode: 'elk' }, { forceElk: false, layoutMode: 'group' }]
  else order = [{ forceElk: false, layoutMode: 'group' }, { forceElk: true, layoutMode: 'elk' }]

  let best = null
  for (const opt of order) {
    for (const result of await renderCandidates(ir, { column, ...opt })) {
      if (isClean(result)) return result
      if (!best || betterCandidate(best, result)) best = result
    }
  }
  return best
}

/**
 * renderDiagram() + verifyDiagram() in one call — what the CLI and page
 * builder use so they never have a rendered SVG without a verification
 * result attached to it. Implements the "try, verify, pick" strategy (see
 * renderCheckedBest()) for an IR that qualifies for grouped-layer mode.
 *
 * @param {object} ir validated IR from ir.mjs
 * @param {{column?: number}} [opts]
 */
export async function renderChecked(ir, { column = COLUMN } = {}) {
  return renderCheckedBest(ir, { column })
}

/**
 * The plugin counterpart of renderAndVerify()/renderCheckedBest() above:
 * a figure plugin's layout is deterministic (no elk, no orientation
 * choice, no grouped-layer mode), so there is only ever one candidate to
 * render and verify — unlike the diagram path there is no "try both, pick
 * the winner" step. `layoutMode` carries the type name.
 */
async function renderPluginChecked(ir, { column = COLUMN } = {}) {
  const plugin = getFigureType(ir.type)
  if (!plugin || !isPluginType(ir.type)) throw new Error(`unknown figure type "${ir.type}"`)
  const rendered = await renderFigure(plugin, ir, { column })
  const verification = await verifyFigure(plugin, ir, rendered, { column })
  return {
    ...rendered,
    checks: verification.checks,
    checksOk: verification.ok,
    failures: verification.failures,
    warnings: verification.warnings,
    warn: formatBudgetWarnings(verification.warnings),
    layoutMode: ir.type,
  }
}

/**
 * renderFigureHtml() that also runs verification and stamps
 * `data-checks="pass"` on the <figure> only when every check passes
 * (contract §5 relies on this attribute to know a figure was checked, not
 * just rendered). Dispatches on `ir.type`: a plugin IR (any type other
 * than the builtin diagram — `sequence` today) is laid out/verified by its
 * plugin through figures/index.mjs instead of diagram.mjs/
 * renderCheckedBest() above, and its figure additionally carries
 * `data-type="<type>"` so downstream tooling (rerender-figures.mjs,
 * self-check.mjs) can tell the figure kinds apart without re-parsing the
 * embedded IR. diagram.mjs's wrapFigureHtml() is reused as-is either way —
 * it only ever reads `rendered.svg`/`rendered.scroll` and `ir.title`/
 * `ir.caption`, which every render result shape provides identically.
 *
 * @param {object} ir validated IR from ir.mjs
 * @param {{column?: number, rawYaml?: string}} [opts]
 */
export async function renderFigureHtmlChecked(ir, { column = COLUMN, rawYaml } = {}) {
  // Every kind: `data-checks="pass"` when no `fail` row failed; a budget
  // overrun (warn rows) still passes and is surfaced as
  // `data-warn="budget:nodes=11;budget:label=15"` (diagram) or
  // `data-warn="budget:participants=7;budget:messages=20;budget:label=23"`
  // (sequence) — stable order, no attribute at all when there is nothing
  // to warn about. A plugin figure additionally carries
  // `data-type="<type>"` (after the check attributes).
  const isPlugin = Boolean(ir.type) && ir.type !== 'diagram'
  const best = await renderCheckedBest(ir, { column })
  const plainHtml = wrapFigureHtml(ir, best, { rawYaml })
  const passAttr = best.checksOk ? ' data-checks="pass"' : ''
  const warnAttr = best.checksOk && best.warn ? ` data-warn="${best.warn}"` : ''
  const typeAttr = isPlugin ? ` data-type="${ir.type}"` : ''
  const html = plainHtml.replace(/^<figure class="wu-figure"/, `<figure class="wu-figure"${passAttr}${warnAttr}${typeAttr}`)
  return { ...best, html, checks: best.checks, checksOk: best.checksOk }
}
