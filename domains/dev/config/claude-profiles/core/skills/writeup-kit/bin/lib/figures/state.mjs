// `type: state` — a state machine: rounded-rect states placed on ranks
// (initial state first, longest-path rank from there), transitions as
// orthogonal arrows, an initial marker (filled dot → state) and final
// markers (double ring) in neutral ink, self-transitions as a small loop
// on the state's side. Plugin contract: references/figure-types.md.
//
// IR shape: `{ id, type:'state', title, caption, direction, states,
// transitions }`. `states` is `[{ id, label, tone, initial, final,
// emphasis }]` (list order is the tie-break for placement; when no state
// is marked `initial` the first one is). `transitions` is `[{ from, to,
// label, kind }]` — `label` may be empty (the design rules discourage it,
// so it is a warning), `kind` is sync|async (open arrowhead for async),
// `from == to` is a self-transition.
//
// Layout (pure, no elk): every state gets a rank — 0 for initial states,
// otherwise the longest path over the forward edges (edges that close a
// cycle, found by DFS from the initial states, are "back" edges). Ranks
// run top→bottom (`direction: down`, the default) or left→right
// (`direction: right`); the code works in main/cross coordinates and maps
// them to x/y at the end. Edges are routed as orthogonal polylines:
//   - forward, adjacent rank: bottom port → (straight | Z via a channel
//     lane in the gap between the ranks) → top port;
//   - forward, skipping ranks: bottom port → channel → a lane on the
//     cross-end side → channel above the target → top port;
//   - back: exit from the cross-start side when the source is first in
//     its rank (else via the gap channel), along a lane on the cross-start
//     side, enter the target's cross-start side (or via the channel above
//     it when it is not first in its rank);
//   - self: a 20×16 loop on the cross-end side.
// Labels are placed after routing: for each transition a list of
// candidate boxes beside each of its segments (longest segment first) is
// tried against every segment, state box, marker and label placed so far,
// and the first clear candidate wins — so a label is never drawn across a
// line by construction, and the `label-clear` row fails the figure when
// no candidate was clear.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc, LEGEND_HEIGHT, legendWidth } from './_shared.mjs'
import { snap4, snapUp4, textWidth, nodeSize, FONT_SIZE, EDGE_LABEL_SIZE } from '../diagram.mjs'

export const type = 'state'

/** Advisory budgets (warnings). `maxEmphasis` is the one hard limit — a
 * third focal state leaves nothing focal, so normalize() rejects it. */
export const limits = { maxStates: 8, maxTransitions: 16, maxLabelLen: 12, maxRanks: 4, maxEmphasis: 2 }

const DIRECTIONS = new Set(['down', 'right'])
const STATE_KINDS = new Set(['sync', 'async'])

// --- layout constants (multiples of 4) -------------------------------------
const BOX_H = 44
const RANK_GAP_MIN = 64
const CROSS_GAP = 40
const MARGIN = 16
const CHANNEL_OFFSET = 24       // first channel lane below a rank
const CHANNEL_OFFSET_FINAL = 48 // …when that rank holds a final marker
const LANE_STEP = 16
const PORT_STEP = 16            // ports along the main-start/main-end sides
const SIDE_PORT_STEP = 8        // ports along the cross-start side
const SELF_W = 20
const SELF_H = 16
const INITIAL_OFFSET = 28       // dot center before the box's main-start
const INITIAL_R = 6
const FINAL_OFFSET = 28         // ring center after the box's main-end
const FINAL_R = 8
const FINAL_INNER_R = 4
const LABEL_H = 14
const LABEL_GAP = 6             // label ↔ segment clearance when placing
const LABEL_PAD = 2             // clearance the label-clear row demands

const labelWidth = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 8

// --- schema ----------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const direction = normalizeDirection(raw.direction, ctx)
  if (!Array.isArray(raw.states) || raw.states.length === 0) throw new IrError(`${ctx}.states must be a non-empty list`)
  const seen = new Set()
  const states = raw.states.map((s, i) => {
    const sctx = `${ctx}.states[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const sid = requireStr(s, 'id', sctx)
    if (seen.has(sid)) throw new IrError(`${ctx}.states: duplicate state id "${sid}"`)
    seen.add(sid)
    return {
      id: sid,
      label: requireStr(s, 'label', sctx),
      tone: validateTone(s.tone, sctx),
      initial: validateBool(s, 'initial', sctx),
      final: validateBool(s, 'final', sctx),
      emphasis: validateBool(s, 'emphasis', sctx),
    }
  })
  if (!states.some((s) => s.initial)) states[0].initial = true
  const emphasisCount = states.filter((s) => s.emphasis).length
  if (emphasisCount > limits.maxEmphasis) {
    throw new IrError(`${ctx}.states: ${emphasisCount} states carry emphasis — at most ${limits.maxEmphasis} focal states are allowed`)
  }
  const transitions = normalizeTransitions(raw.transitions, seen, ctx)
  return { id, type, title, caption, direction, states, transitions }
}

function normalizeDirection(v, ctx) {
  if (v === undefined || v === null) return 'down'
  if (typeof v !== 'string' || !DIRECTIONS.has(v)) throw new IrError(`${ctx}.direction must be down|right (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeTransitions(raw, stateIds, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.transitions must be a list`)
  return raw.map((t, i) => {
    const tctx = `${ctx}.transitions[${i}]`
    if (!isObj(t)) throw new IrError(`${tctx} must be a mapping`)
    const from = requireStr(t, 'from', tctx)
    const to = requireStr(t, 'to', tctx)
    if (!stateIds.has(from)) throw new IrError(`${tctx}.from references unknown state "${from}"`)
    if (!stateIds.has(to)) throw new IrError(`${tctx}.to references unknown state "${to}"`)
    const label = optStr(t, 'label', tctx) ?? ''
    let kind = t.kind
    if (kind === undefined || kind === null) kind = 'sync'
    else if (typeof kind !== 'string' || !STATE_KINDS.has(kind)) throw new IrError(`${tctx}.kind must be sync|async (got: ${JSON.stringify(kind)})`)
    return { from, to, label, kind }
  })
}

// --- ranks (pure function of the IR, shared by budgets/layout/verify) -------

/**
 * `{ rank: Map<id, number>, ranks: string[][], back: Set<'from>to'>,
 * reachable: Set<id> }`. Initial states are rank 0; every other state is
 * one past its deepest forward parent (longest path). Edges into an
 * initial state, and edges DFS finds closing a cycle, are back edges.
 */
function computeRanks(ir) {
  const ids = ir.states.map((s) => s.id)
  const initial = new Set(ir.states.filter((s) => s.initial).map((s) => s.id))
  const known = new Set(ids)
  // Transitions with an unknown end are skipped here (normalize() rejects
  // them; verify()'s transition-refs row reports them on a hand-built IR).
  const transitions = ir.transitions.filter((t) => known.has(t.from) && known.has(t.to))
  const out = new Map(ids.map((id) => [id, []]))
  for (const t of transitions) {
    if (t.from === t.to || initial.has(t.to)) continue
    if (!out.get(t.from).includes(t.to)) out.get(t.from).push(t.to)
  }
  const color = new Map(ids.map((id) => [id, 0]))
  const back = new Set()
  const post = []
  const dfs = (u) => {
    color.set(u, 1)
    for (const v of out.get(u)) {
      if (color.get(v) === 1) back.add(`${u}>${v}`)
      else if (color.get(v) === 0) dfs(v)
    }
    color.set(u, 2)
    post.push(u)
  }
  for (const id of [...initial, ...ids]) if (color.get(id) === 0) dfs(id)
  for (const t of transitions) if (t.from !== t.to && initial.has(t.to)) back.add(`${t.from}>${t.to}`)

  const rank = new Map(ids.map((id) => [id, 0]))
  for (const u of [...post].reverse()) {
    for (const v of out.get(u)) {
      if (back.has(`${u}>${v}`)) continue
      rank.set(v, Math.max(rank.get(v), rank.get(u) + 1))
    }
  }
  const count = Math.max(...rank.values()) + 1
  const ranks = Array.from({ length: count }, () => [])
  for (const id of ids) ranks[rank.get(id)].push(id)

  // Reachability over every transition (self and back edges included).
  const all = new Map(ids.map((id) => [id, []]))
  for (const t of transitions) all.get(t.from).push(t.to)
  const reachable = new Set()
  const queue = [...initial]
  while (queue.length) {
    const u = queue.shift()
    if (reachable.has(u)) continue
    reachable.add(u)
    for (const v of all.get(u)) if (!reachable.has(v)) queue.push(v)
  }
  return { rank, ranks, back, reachable }
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const L = limits
  if (ir.states.length > L.maxStates) {
    out.push(budgetWarning('budget:states', ir.states.length, L.maxStates,
      `${ir.states.length} state(s) (guidance ≤ ${L.maxStates})`,
      'split into two machines at a state that reads as a phase boundary'))
  }
  if (ir.transitions.length > L.maxTransitions) {
    out.push(budgetWarning('budget:transitions', ir.transitions.length, L.maxTransitions,
      `${ir.transitions.length} transition(s) (guidance ≤ ${L.maxTransitions})`,
      'collapse "from any state" transitions into one note, or split the machine'))
  }
  let longest = null
  ir.transitions.forEach((t, i) => {
    const len = [...t.label].length
    if (len > L.maxLabelLen && (!longest || len > longest.len)) longest = { len, i, label: t.label }
  })
  if (longest) {
    out.push(budgetWarning('budget:label', longest.len, L.maxLabelLen,
      `transition ${longest.i} label "${longest.label}" is ${longest.len} chars (guidance ≤ ${L.maxLabelLen})`,
      'shorten the label to the event name; put the guard/action in the caption'))
  }
  const { ranks, reachable } = computeRanks(ir)
  if (ranks.length > L.maxRanks) {
    out.push(budgetWarning('budget:ranks', ranks.length, L.maxRanks,
      `${ranks.length} rank(s) deep (guidance ≤ ${L.maxRanks})`,
      'a chain this deep reads as a flowchart — use direction: right or split the machine'))
  }
  const unreachable = ir.states.filter((s) => !reachable.has(s.id)).map((s) => s.id)
  if (unreachable.length) {
    out.push(budgetWarning('budget:unreachable', unreachable.length, 0,
      `${unreachable.length} state(s) unreachable from an initial state: ${unreachable.join(', ')}`,
      'add the transition that enters them, mark one initial, or drop them'))
  }
  const unlabeled = ir.transitions.filter((t) => !t.label).length
  if (unlabeled) {
    out.push(budgetWarning('budget:unlabeled', unlabeled, 0,
      `${unlabeled} transition(s) without a label`,
      'name the event on every transition — an unlabeled arrow is a guess for the reader'))
  }
  return out
}

// --- layout ----------------------------------------------------------------

/** Main/cross → x/y for the direction. */
const toXY = (direction, m, c) => (direction === 'down' ? { x: c, y: m } : { x: m, y: c })

/** Ports along a side: k positions centered on `center`, `step` apart. */
const spread = (center, k, step) => Array.from({ length: k }, (_, i) => snap4(center + (i - (k - 1) / 2) * step))

export async function layout(ir) {
  const { direction, states, transitions } = ir
  const { rank, ranks } = computeRanks(ir)
  const byId = new Map(states.map((s) => [s.id, s]))
  const index = new Map(states.map((s, i) => [s.id, i]))
  const lastRank = ranks.length - 1

  // Box sizes: width from the label (diagram.mjs's nodeSize), height 44.
  const size = new Map(states.map((s) => {
    const { width } = nodeSize(s.label, { bold: s.emphasis })
    return [s.id, direction === 'down' ? { main: BOX_H, cross: width, w: width, h: BOX_H } : { main: width, cross: BOX_H, w: width, h: BOX_H }]
  }))

  // Transition classes.
  const classified = transitions.map((t, i) => {
    const kind = t.from === t.to ? 'self' : rank.get(t.to) > rank.get(t.from) ? 'forward' : 'back'
    return { ...t, index: i, cls: kind, span: Math.abs(rank.get(t.to) - rank.get(t.from)) }
  })
  const selfOf = new Map()
  for (const t of classified) if (t.cls === 'self') selfOf.set(t.from, t)

  // Order within a rank: barycenter of forward parents' positions, then
  // list order. Positions are rank-local indices, computed rank by rank.
  const pos = new Map()
  for (let r = 0; r < ranks.length; r++) {
    const ordered = [...ranks[r]].sort((a, b) => {
      const key = (id) => {
        const parents = classified.filter((t) => t.cls === 'forward' && t.to === id).map((t) => pos.get(t.from)).filter((p) => p !== undefined)
        return parents.length ? parents.reduce((x, y) => x + y, 0) / parents.length : Number.POSITIVE_INFINITY
      }
      const ka = key(a), kb = key(b)
      if (ka !== kb) return ka < kb ? -1 : 1
      return index.get(a) - index.get(b)
    })
    ranks[r] = ordered
    ordered.forEach((id, i) => pos.set(id, i))
  }
  const firstInRank = new Set(ranks.map((r) => r[0]))

  // Cross packing: each box reserves its width plus the self-loop and
  // its label on the cross-end side; ranks are centered on the widest.
  const extra = (id) => {
    const s = selfOf.get(id)
    if (!s) return 0
    return SELF_W + LABEL_GAP + (s.label ? labelWidth(s.label) : 0) + 8
  }
  // A rank's centering width counts every box, the gaps, and the loop
  // extras of all but the last box; the last box's loop hangs past it so
  // single-state ranks stay aligned on their box centers.
  const rankCross = ranks.map((ids) => ids.reduce((sum, id, i) => sum + size.get(id).cross + (i < ids.length - 1 ? extra(id) : 0) + (i ? CROSS_GAP : 0), 0))
  const rankTail = ranks.map((ids) => extra(ids[ids.length - 1]))
  const contentCross = snapUp4(Math.max(...rankCross))
  const contentTail = snapUp4(Math.max(...ranks.map((_, r) => (contentCross - rankCross[r]) / 2 + rankCross[r] + rankTail[r])) - contentCross)
  const backEdges = classified.filter((t) => t.cls === 'back')
  const maxBackLabel = Math.max(0, ...backEdges.map((t) => (t.label ? labelWidth(t.label) : 0)))
  const backLaneGap = backEdges.length ? snapUp4(CHANNEL_OFFSET + maxBackLabel) : 0
  const crossStart = snapUp4(MARGIN + (backEdges.length ? maxBackLabel + 8 + (backEdges.length - 1) * LANE_STEP : 0) + backLaneGap)

  // Lanes on the cross-start side (back edges) and cross-end side
  // (forward edges skipping ranks): shorter spans inner.
  const laneOrder = (list) => [...list].sort((a, b) => a.span - b.span || a.index - b.index)
  const backLane = new Map(laneOrder(backEdges).map((t, i) => [t.index, crossStart - backLaneGap - i * LANE_STEP]))
  const skipEdges = classified.filter((t) => t.cls === 'forward' && t.span > 1)
  const contentEnd = crossStart + contentCross + contentTail
  const skipLane = new Map(laneOrder(skipEdges).map((t, i) => [t.index, contentEnd + CHANNEL_OFFSET + i * LANE_STEP]))

  // Cross positions of boxes.
  const boxCross = new Map()
  ranks.forEach((ids, r) => {
    let c = snap4(crossStart + (contentCross - rankCross[r]) / 2)
    for (const id of ids) {
      boxCross.set(id, c)
      c += size.get(id).cross + extra(id) + CROSS_GAP
    }
  })
  const centerCross = (id) => snap4(boxCross.get(id) + size.get(id).cross / 2)

  // Which transitions use a channel lane in which gap. Gap g lies after
  // rank g (g = -1 is the strip above rank 0, used only by back edges
  // entering a non-first rank-0 state).
  const channelUsers = new Map()
  const useChannel = (g, t) => {
    if (!channelUsers.has(g)) channelUsers.set(g, [])
    channelUsers.get(g).push(t.index)
  }
  const outPorts = new Map(states.map((s) => [s.id, []]))
  const inPorts = new Map(states.map((s) => [s.id, []]))
  const sidePortsOut = new Map(states.map((s) => [s.id, []]))
  const sidePortsIn = new Map(states.map((s) => [s.id, []]))
  const routes = new Map()
  for (const t of classified) {
    if (t.cls === 'self') continue
    const rf = rank.get(t.from), rt = rank.get(t.to)
    if (t.cls === 'forward') {
      const straight = t.span === 1 && centerCross(t.from) === centerCross(t.to)
      routes.set(t.index, { straight })
      outPorts.get(t.from).push({ index: t.index, cross: centerCross(t.to) })
      inPorts.get(t.to).push({ index: t.index, cross: centerCross(t.from) })
      if (t.span > 1) { useChannel(rf, t); useChannel(rt - 1, t) }
    } else {
      const exitSide = firstInRank.has(t.from)
      const enterSide = firstInRank.has(t.to)
      routes.set(t.index, { exitSide, enterSide })
      const lane = backLane.get(t.index)
      if (exitSide) sidePortsOut.get(t.from).push({ index: t.index, main: rt })
      else { outPorts.get(t.from).push({ index: t.index, cross: lane }); useChannel(rf, t) }
      if (enterSide) sidePortsIn.get(t.to).push({ index: t.index, main: rf })
      else { inPorts.get(t.to).push({ index: t.index, cross: lane }); useChannel(rt - 1, t) }
    }
  }
  // Markers take part in port allocation like an edge would.
  for (const s of states) {
    if (s.final) outPorts.get(s.id).push({ index: `final:${s.id}`, cross: centerCross(s.id) })
    if (s.initial) inPorts.get(s.id).push({ index: `initial:${s.id}`, cross: Number.POSITIVE_INFINITY })
  }

  // Main positions: rank starts, gap sizes from channel lanes and final
  // markers. Straight forward edges never need a channel; Z edges do.
  for (const t of classified) {
    if (t.cls === 'forward' && t.span === 1 && !routes.get(t.index).straight) useChannel(rank.get(t.from), t)
  }
  const finalInRank = ranks.map((ids) => ids.some((id) => byId.get(id).final))
  const topLanes = (channelUsers.get(-1) ?? []).length
  const mainStart = Math.max(INITIAL_OFFSET + INITIAL_R + MARGIN, CHANNEL_OFFSET + topLanes * LANE_STEP + MARGIN)
  const rankMain = []
  const rankExtent = ranks.map((ids) => Math.max(...ids.map((id) => size.get(id).main)))
  const channelMain = new Map()
  let m = snapUp4(mainStart)
  const laneMain = (g, i) => (g === -1
    ? rankMain[0] - CHANNEL_OFFSET - i * LANE_STEP
    : rankMain[g] + rankExtent[g] + (finalInRank[g] ? CHANNEL_OFFSET_FINAL : CHANNEL_OFFSET) + i * LANE_STEP)
  for (let r = 0; r < ranks.length; r++) {
    rankMain.push(m)
    const lanes = (channelUsers.get(r) ?? []).length
    const offset = finalInRank[r] ? CHANNEL_OFFSET_FINAL : CHANNEL_OFFSET
    const gap = r === lastRank
      ? (lanes ? offset + lanes * LANE_STEP : finalInRank[r] ? FINAL_OFFSET + FINAL_R + 4 : 8)
      : Math.max(RANK_GAP_MIN, offset + lanes * LANE_STEP + MARGIN)
    m += rankExtent[r] + snapUp4(gap)
  }
  for (const [g, users] of channelUsers) {
    users.forEach((idx, i) => channelMain.set(idx, laneMain(g, i)))
  }

  // Boxes in x/y.
  const boxes = states.map((s) => {
    const sz = size.get(s.id)
    const r = rank.get(s.id)
    const main = snap4(rankMain[r] + (rankExtent[r] - sz.main) / 2)
    const { x, y } = toXY(direction, main, boxCross.get(s.id))
    return {
      id: s.id, label: s.label, tone: s.tone, emphasis: s.emphasis, initial: s.initial, final: s.final, rank: r,
      x, y, width: sz.w, height: sz.h, cx: snap4(x + sz.w / 2), cy: snap4(y + sz.h / 2),
    }
  })
  const box = new Map(boxes.map((b) => [b.id, b]))
  const mainOf = (id) => (direction === 'down' ? box.get(id).y : box.get(id).x)
  const mainEnd = (id) => mainOf(id) + size.get(id).main
  const mainCenter = (id) => snap4(mainOf(id) + size.get(id).main / 2)
  const crossOf = (id) => boxCross.get(id)
  const crossEnd = (id) => crossOf(id) + size.get(id).cross

  // Port positions: main-start/main-end ports sorted by the far end's
  // cross, side ports by the far end's rank.
  const portAt = (list, sortKey, center, step) => {
    const sorted = [...list].sort((a, b) => a[sortKey] - b[sortKey] || String(a.index).localeCompare(String(b.index)))
    const xs = spread(center, sorted.length, step)
    return new Map(sorted.map((p, i) => [p.index, xs[i]]))
  }
  const outAt = new Map(states.map((s) => [s.id, portAt(outPorts.get(s.id), 'cross', centerCross(s.id), PORT_STEP)]))
  const inAt = new Map(states.map((s) => [s.id, portAt(inPorts.get(s.id), 'cross', centerCross(s.id), PORT_STEP)]))
  const sideOutAt = new Map(states.map((s) => [s.id, portAt(sidePortsOut.get(s.id), 'main', mainCenter(s.id), SIDE_PORT_STEP)]))
  const sideInAt = new Map(states.map((s) => [s.id, portAt(sidePortsIn.get(s.id), 'main', mainCenter(s.id), SIDE_PORT_STEP)]))

  // Routes as (main, cross) polylines.
  const P = (mm, cc) => toXY(direction, mm, cc)
  const edges = classified.map((t) => {
    const pts = []
    if (t.cls === 'self') {
      const c0 = crossEnd(t.from)
      const m0 = mainCenter(t.from) - SELF_H / 2
      pts.push(P(m0, c0), P(m0, c0 + SELF_W), P(m0 + SELF_H, c0 + SELF_W), P(m0 + SELF_H, c0))
    } else if (t.cls === 'forward') {
      const pc = outAt.get(t.from).get(t.index)
      const tc = inAt.get(t.to).get(t.index)
      pts.push(P(mainEnd(t.from), pc))
      if (t.span === 1) {
        if (!routes.get(t.index).straight) {
          const ch = channelMain.get(t.index)
          pts.push(P(ch, pc), P(ch, tc))
        }
      } else {
        const lane = skipLane.get(t.index)
        const chSrc = laneMain(rank.get(t.from), (channelUsers.get(rank.get(t.from)) ?? []).indexOf(t.index))
        const chTgt = laneMain(rank.get(t.to) - 1, (channelUsers.get(rank.get(t.to) - 1) ?? []).indexOf(t.index))
        pts.push(P(chSrc, pc), P(chSrc, lane), P(chTgt, lane), P(chTgt, tc))
      }
      pts.push(P(mainOf(t.to), tc))
    } else {
      const { exitSide, enterSide } = routes.get(t.index)
      const lane = backLane.get(t.index)
      if (exitSide) {
        const pm = sideOutAt.get(t.from).get(t.index)
        pts.push(P(pm, crossOf(t.from)), P(pm, lane))
      } else {
        const pc = outAt.get(t.from).get(t.index)
        const ch = laneMain(rank.get(t.from), (channelUsers.get(rank.get(t.from)) ?? []).indexOf(t.index))
        pts.push(P(mainEnd(t.from), pc), P(ch, pc), P(ch, lane))
      }
      if (enterSide) {
        const pm = sideInAt.get(t.to).get(t.index)
        pts.push(P(pm, lane), P(pm, crossOf(t.to)))
      } else {
        const tc = inAt.get(t.to).get(t.index)
        const g = rank.get(t.to) - 1
        const ch = laneMain(g, (channelUsers.get(g) ?? []).indexOf(t.index))
        pts.push(P(ch, lane), P(ch, tc), P(mainOf(t.to), tc))
      }
    }
    return { index: t.index, from: t.from, to: t.to, kind: t.kind, cls: t.cls, text: t.label, points: dedupe(pts), label: null }
  })

  // Markers.
  const markers = { initial: [], final: [] }
  for (const s of states) {
    if (s.initial) {
      const c = inAt.get(s.id).get(`initial:${s.id}`)
      const dot = P(mainOf(s.id) - INITIAL_OFFSET, c)
      const end = P(mainOf(s.id), c)
      markers.initial.push({ state: s.id, cx: dot.x, cy: dot.y, x1: dot.x, y1: dot.y, x2: end.x, y2: end.y })
    }
    if (s.final) {
      const c = outAt.get(s.id).get(`final:${s.id}`)
      const start = P(mainEnd(s.id), c)
      const tip = P(mainEnd(s.id) + FINAL_OFFSET - FINAL_R, c)
      const ring = P(mainEnd(s.id) + FINAL_OFFSET, c)
      markers.final.push({ state: s.id, cx: ring.x, cy: ring.y, x1: start.x, y1: start.y, x2: tip.x, y2: tip.y })
    }
  }

  // Labels: candidates beside each segment, first clear one wins.
  const segments = []
  for (const e of edges) for (let i = 1; i < e.points.length; i++) segments.push([e.points[i - 1], e.points[i]])
  for (const mk of [...markers.initial, ...markers.final]) segments.push([{ x: mk.x1, y: mk.y1 }, { x: mk.x2, y: mk.y2 }])
  const obstacles = boxes.map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }))
  for (const mk of markers.initial) obstacles.push({ x: mk.cx - INITIAL_R, y: mk.cy - INITIAL_R, width: INITIAL_R * 2, height: INITIAL_R * 2 })
  for (const mk of markers.final) obstacles.push({ x: mk.cx - FINAL_R, y: mk.cy - FINAL_R, width: FINAL_R * 2, height: FINAL_R * 2 })
  const placed = []
  for (const e of edges) {
    if (!e.text) continue
    const w = labelWidth(e.text)
    const cands = labelCandidates(e.points, w, LABEL_H)
    const clear = cands.find((c) => !segments.some((s) => segmentHitsRect(s[0], s[1], c, LABEL_GAP - 2))
      && !obstacles.some((o) => rectsOverlap(o, c, LABEL_PAD))
      && !placed.some((o) => rectsOverlap(o, c, LABEL_PAD)))
    const pick = clear ?? cands[0]
    e.label = { ...pick, width: w, height: LABEL_H, text: e.text }
    placed.push(e.label)
  }

  // Canvas: bounds of everything, translated to a 16px margin (on-grid).
  const xs = [], ys = []
  const extend = (x, y, w = 0, h = 0) => { xs.push(x, x + w); ys.push(y, y + h) }
  for (const b of boxes) extend(b.x, b.y, b.width, b.height)
  for (const e of edges) { for (const p of e.points) extend(p.x, p.y); if (e.label) extend(e.label.x, e.label.y, e.label.width, e.label.height) }
  for (const o of obstacles) extend(o.x, o.y, o.width, o.height)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const dx = snap4(MARGIN - minX), dy = snap4(MARGIN - minY)
  const shift = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] !== 'number') continue
      if (k === 'x' || k === 'x1' || k === 'x2' || k === 'cx') o[k] += dx
      else if (k === 'y' || k === 'y1' || k === 'y2' || k === 'cy') o[k] += dy
    }
  }
  for (const b of boxes) shift(b)
  for (const e of edges) { e.points.forEach(shift); if (e.label) shift(e.label) }
  for (const mk of [...markers.initial, ...markers.final]) shift(mk)
  let width = snapUp4(Math.max(...xs) + dx + MARGIN)
  let height = snapUp4(Math.max(...ys) + dy + MARGIN)

  // Legend only when both arrow kinds appear.
  let legend
  const kinds = new Set(transitions.map((t) => t.kind))
  if (kinds.has('async')) {
    const items = [{ label: 'sync', marker: 'solid' }, { label: 'async', marker: 'open' }].filter((i) => kinds.has(i.label))
    legend = { y: height, items }
    width = Math.max(width, snapUp4(legendWidth(items)))
    height = snapUp4(height + LEGEND_HEIGHT + 4)
  }

  return { width, height, geo: { direction, ranks, states: boxes, transitions: edges, markers }, legend }
}

function dedupe(points) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out
}

/** Label boxes beside each segment of a polyline, longest segment first;
 * a vertical segment offers its right then left side, a horizontal one
 * above then below. Snapped to the grid. */
function labelCandidates(points, w, h) {
  const segs = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    segs.push({ a, b, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y), order: i })
  }
  segs.sort((p, q) => q.len - p.len || p.order - q.order)
  const out = []
  for (const { a, b } of segs) {
    if (a.x === b.x) {
      const midY = (a.y + b.y) / 2
      out.push({ x: snap4(a.x + LABEL_GAP), y: snap4(midY - h / 2), width: w, height: h })
      out.push({ x: snap4(a.x - LABEL_GAP - w), y: snap4(midY - h / 2), width: w, height: h })
    } else {
      const midX = (a.x + b.x) / 2
      out.push({ x: snap4(midX - w / 2), y: snap4(a.y - LABEL_GAP - h), width: w, height: h })
      out.push({ x: snap4(midX - w / 2), y: snap4(a.y + LABEL_GAP), width: w, height: h })
    }
  }
  return out
}

/** Axis-aligned segment a→b crosses rect r grown by `pad`. */
function segmentHitsRect(a, b, r, pad = 0) {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.width + pad, y1 = r.y + r.height + pad
  const sx0 = Math.min(a.x, b.x), sx1 = Math.max(a.x, b.x)
  const sy0 = Math.min(a.y, b.y), sy1 = Math.max(a.y, b.y)
  return sx1 > x0 && sx0 < x1 && sy1 > y0 && sy0 < y1
}

function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
}

// --- draw ------------------------------------------------------------------

const pathD = (pts) => `M${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push(`<marker id="${uid}-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`)
  parts.push('</defs>')

  for (const mk of geo.markers.initial) {
    parts.push(`<line id="${uid}-initial-${mk.state}-line" x1="${mk.x1}" y1="${mk.y1}" x2="${mk.x2}" y2="${mk.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    parts.push(`<circle id="${uid}-initial-${mk.state}" cx="${mk.cx}" cy="${mk.cy}" r="${INITIAL_R}" fill="currentColor"/>`)
  }
  for (const mk of geo.markers.final) {
    parts.push(`<line id="${uid}-final-${mk.state}-line" x1="${mk.x1}" y1="${mk.y1}" x2="${mk.x2}" y2="${mk.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    parts.push(`<circle id="${uid}-final-${mk.state}" cx="${mk.cx}" cy="${mk.cy}" r="${FINAL_R}" fill="none" stroke="currentColor" stroke-width="1"/>`)
    parts.push(`<circle id="${uid}-final-${mk.state}-core" cx="${mk.cx}" cy="${mk.cy}" r="${FINAL_INNER_R}" fill="currentColor"/>`)
  }

  for (const s of geo.states) {
    const cls = s.emphasis ? ' class="wu-focal"' : ''
    const sw = s.emphasis ? 1.5 : 1
    const weight = s.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-${s.id}" data-tone="${esc(s.tone)}"${cls} x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="8" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-${s.id}-label"${cls} x="${s.x + s.width / 2}" y="${s.y + s.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor"${weight}>${esc(s.label)}</text>`)
  }

  for (const e of geo.transitions) {
    const marker = e.kind === 'async' ? 'open' : 'solid'
    parts.push(`<path id="${uid}-t-${e.index}" d="${pathD(e.points)}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-${marker})"/>`)
    if (e.label) {
      parts.push(`<text id="${uid}-t-${e.index}-label" x="${e.label.x + 4}" y="${e.label.y + 11}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(e.label.text)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

const ROW_NAMES = ['transition-refs', 'state-count', 'transition-count', 'label-length', 'rank-count', 'reachable', 'transition-labels', 'box-overlap', 'label-clear', 'orthogonal', 'grid']

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }

  const ids = new Set(ir.states.map((s) => s.id))
  const badRefs = ir.transitions.flatMap((t, i) => [t.from, t.to].filter((id) => !ids.has(id)).map((id) => `transitions[${i}] → "${id}"`))
  rows.push({ id: 1, name: 'transition-refs', severity: 'fail', ok: badRefs.length === 0, detail: badRefs.length ? `unknown state: ${badRefs.join(', ')}` : 'every transition references a known state', hint: badRefs.length ? 'fix the from/to ids or add the missing state' : undefined })
  budgetRow(2, 'state-count', 'budget:states', `${ir.states.length} state(s)`)
  budgetRow(3, 'transition-count', 'budget:transitions', `${ir.transitions.length} transition(s)`)
  budgetRow(4, 'label-length', 'budget:label', `every transition label is within the ${limits.maxLabelLen}-char guidance`)
  budgetRow(5, 'rank-count', 'budget:ranks', `${geo.ranks.length} rank(s)`)
  budgetRow(6, 'reachable', 'budget:unreachable', 'every state is reachable from an initial state')
  budgetRow(7, 'transition-labels', 'budget:unlabeled', 'every transition carries a label')

  const overlaps = []
  for (let i = 0; i < geo.states.length; i++) {
    for (let j = i + 1; j < geo.states.length; j++) {
      if (rectsOverlap(geo.states[i], geo.states[j])) overlaps.push(`${geo.states[i].id}/${geo.states[j].id}`)
    }
  }
  rows.push({ id: 8, name: 'box-overlap', severity: 'fail', ok: overlaps.length === 0, detail: overlaps.length ? `overlapping state boxes: ${overlaps.join(', ')}` : 'no two state boxes overlap', hint: overlaps.length ? 'internal layout error — report the IR' : undefined })

  const segments = []
  for (const e of geo.transitions) for (let i = 1; i < e.points.length; i++) segments.push({ a: e.points[i - 1], b: e.points[i], owner: `transition ${e.index}` })
  for (const mk of geo.markers.initial) segments.push({ a: { x: mk.x1, y: mk.y1 }, b: { x: mk.x2, y: mk.y2 }, owner: `initial marker of ${mk.state}` })
  for (const mk of geo.markers.final) segments.push({ a: { x: mk.x1, y: mk.y1 }, b: { x: mk.x2, y: mk.y2 }, owner: `final marker of ${mk.state}` })
  const labelHits = []
  for (const e of geo.transitions) {
    if (!e.label) continue
    const hitSeg = segments.find((s) => segmentHitsRect(s.a, s.b, e.label, LABEL_PAD))
    if (hitSeg) labelHits.push(`label "${e.label.text}" crosses ${hitSeg.owner}`)
    const hitBox = geo.states.find((b) => rectsOverlap(b, e.label, LABEL_PAD))
    if (hitBox) labelHits.push(`label "${e.label.text}" overlaps state ${hitBox.id}`)
  }
  rows.push({ id: 9, name: 'label-clear', severity: 'fail', ok: labelHits.length === 0, detail: labelHits.length ? labelHits.join('; ') : 'every label sits beside its edge, clear of every line and box', hint: labelHits.length ? 'shorten the label, reduce transitions out of that state, or split the machine' : undefined })

  const diagonals = []
  for (const e of geo.transitions) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i]
      if (a.x !== b.x && a.y !== b.y) diagonals.push(`transition ${e.index} segment ${i}`)
    }
  }
  rows.push({ id: 10, name: 'orthogonal', severity: 'fail', ok: diagonals.length === 0, detail: diagonals.length ? `diagonal segment(s): ${diagonals.join(', ')}` : 'every segment is horizontal or vertical', hint: diagonals.length ? 'internal routing error — report the IR' : undefined })

  const off = []
  const onGrid = (v) => Number.isFinite(v) && v % 4 === 0
  for (const b of geo.states) for (const k of ['x', 'y', 'width', 'height']) if (!onGrid(b[k])) off.push(`state ${b.id}.${k}=${b[k]}`)
  for (const e of geo.transitions) {
    e.points.forEach((p, i) => { if (!onGrid(p.x) || !onGrid(p.y)) off.push(`transition ${e.index} point ${i} (${p.x},${p.y})`) })
    if (e.label && (!onGrid(e.label.x) || !onGrid(e.label.y))) off.push(`transition ${e.index} label (${e.label.x},${e.label.y})`)
  }
  for (const mk of [...geo.markers.initial, ...geo.markers.final]) if (!onGrid(mk.cx) || !onGrid(mk.cy)) off.push(`marker of ${mk.state} (${mk.cx},${mk.cy})`)
  rows.push({ id: 11, name: 'grid', severity: 'fail', ok: off.length === 0, detail: off.length ? `off the 4px grid: ${off.slice(0, 6).join(', ')}` : 'boxes, segments, labels and markers sit on the 4px grid', hint: off.length ? 'snap every coordinate with snap4()/snapUp4()' : undefined })
  return rows
}

export const doc = {
  purpose: 'states and the transitions between them (order lifecycle, connection state, wizard steps)',
  whenToUse: 'when the reader must see *which state can become which, on what event* — not for call order (use sequence) or structure (use diagram). Budgets: states ≤ 8 across ≤ 4 ranks, transitions ≤ 16, label ≤ 12 chars; more transitions than 2× states means two machines. Guidance only — over-budget figures still render with data-warn.',
  irExample: `id: fetch-lifecycle
type: state
title: 取り込みジョブの状態
caption: 検証で失敗したら取得待ちに戻る
states:
  - id: pending
    label: 取得待ち
    initial: true
  - id: fetching
    label: 取得中
    tone: ts
  - id: verifying
    label: 検証
    emphasis: true
  - id: done
    label: 完了
    final: true
transitions:
  - from: pending
    to: fetching
    label: 開始
  - from: fetching
    to: verifying
    label: 取得完了
  - from: verifying
    to: done
    label: 検証 OK
  - from: verifying
    to: pending
    label: 失敗
`,
  rows: ROW_NAMES,
}
