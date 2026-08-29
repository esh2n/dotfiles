// `type: swimlane` — a flow whose steps sit in lanes (actors / systems):
// lanes as horizontal bands with a label column at the left, steps placed
// in columns by flow order, arrows between steps; an arrow that changes
// lane is a hand-off. The figure answers "who does what, in what order,
// and where does the work change hands" — the "Swimlane" pattern of the
// diagram-design survey (lanes ≤ 5, every step in exactly one lane, arrows
// crossing lanes = hand-offs, back edges kept rare).
//
// IR shape: `{ id, type:'swimlane', title, caption, direction, lanes,
// steps, edges }`.
//   - `lanes` — `[{ id, label }]`, top → bottom (2 required, ≤ 5 guidance);
//   - `steps` — `[{ id, label, lane, kind, tone, emphasis, parallel }]` in
//     flow order; `kind` is step (rect) | decision (diamond) | start | end
//     (pills); `parallel: true` puts the step in the same column as the
//     previous one (it must then sit in a different lane);
//   - `edges` — `[{ from, to, label }]`; when omitted, consecutive steps
//     are connected;
//   - `direction` — `right` (lanes horizontal, flow left → right; default)
//     or `down` (lanes vertical, flow top → bottom — for long flows).
//
// Layout is a fixed grid, no engine: one column per step (shared by
// parallel steps), column width from the widest box in it, lane height
// from the tallest box in it plus the strips edges travel along. Edges
// are orthogonal polylines built from a handful of route shapes, chosen
// from the grid occupancy so no segment ever runs through a step box:
//   - straight: same lane, nothing in between;
//   - z: exit right → a slot in the gutter after the source column →
//     across to the target lane → into the target (hand-off);
//   - vertex: a decision leaves from its top/bottom vertex straight into
//     the target lane (the classic yes/no fork);
//   - strip: forward past occupied cells — up to a strip along the target
//     lane's top edge, along, and down in the gutter before the target;
//   - back: every backward edge — down to a strip along the target lane's
//     bottom edge, back, and up in the gutter before the target;
//   - hook: a parallel (same-column) target that the vertex route cannot
//     reach — via the gutter into the target's far side.
// Every vertical run sits in a gutter (or on a column center for the
// vertex route), so the `edges-clear` row proves the invariant instead of
// trusting it. Labels are placed after routing: candidate boxes beside
// each segment (longest first, shifted along it when the midpoint is
// busy) are tested against every segment, box, lane rule and placed
// label; the first clear one wins and `label-clear` fails the figure
// when none was. The code works in main/cross coordinates (flow / lane
// axis) and maps them to x/y at the end, so `direction: down` is the
// same layout transposed.
//
// Import rule (references/figure-types.md): _shared.mjs and diagram.mjs
// constants only — never ir.mjs / verify-diagram.mjs / figures/index.mjs.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'swimlane'

export const limits = { maxLanes: 5, maxSteps: 12, maxLabelLen: 14, maxEmphasis: 2 }

const DIRECTIONS = new Set(['right', 'down'])
const STEP_KINDS = new Set(['step', 'decision', 'start', 'end'])
const MIN_LANES = 2

// --- layout constants (multiples of 4) -------------------------------------
const MARGIN = 16
const LABEL_BAND_MIN = 56      // lane label column (right) …
const HEADER_MAIN = 32         // … or lane header row (down)
const LANE_PAD = 16            // lane edge → box (no strip in the way)
const STRIP_OFFSET = 8         // lane edge → first strip
const STRIP_STEP = 8
const BOX_H = 40
const DECISION_H = 48
const GAP_MIN = 32             // gutter between two columns
const SLOT_EDGE = 12           // gutter edge → first slot
const SLOT_STEP = 12
const LABEL_H = 14
const LABEL_GAP = 6            // label ↔ segment clearance when placing
const LABEL_PAD = 2            // clearance the label-clear row demands
const LABEL_SHIFTS = [0, -16, 16, -32, 32]

const snapUp8 = (v) => Math.ceil(v / 8) * 8
const labelWidth = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 8

// --- schema ----------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const direction = normalizeDirection(raw.direction, ctx)
  const lanes = normalizeLanes(raw.lanes, ctx)
  const steps = normalizeSteps(raw.steps, lanes, ctx)
  const edges = normalizeEdges(raw.edges, steps, ctx)
  return { id, type, title, caption, direction, lanes, steps, edges }
}

function normalizeDirection(v, ctx) {
  if (v === undefined || v === null) return 'right'
  if (typeof v !== 'string' || !DIRECTIONS.has(v)) throw new IrError(`${ctx}.direction must be right|down (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeLanes(raw, ctx) {
  if (!Array.isArray(raw) || raw.length < MIN_LANES) throw new IrError(`${ctx}.lanes must be a list of at least ${MIN_LANES} lanes { id, label }`)
  const seen = new Set()
  return raw.map((l, i) => {
    const lctx = `${ctx}.lanes[${i}]`
    if (!isObj(l)) throw new IrError(`${lctx} must be a mapping`)
    const lid = requireStr(l, 'id', lctx)
    if (seen.has(lid)) throw new IrError(`${ctx}.lanes: duplicate lane id "${lid}"`)
    seen.add(lid)
    return { id: lid, label: requireStr(l, 'label', lctx) }
  })
}

function normalizeSteps(raw, lanes, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.steps must be a non-empty list`)
  const laneIds = new Set(lanes.map((l) => l.id))
  const seen = new Set()
  const columnLanes = []   // lanes occupied by the current column
  return raw.map((s, i) => {
    const sctx = `${ctx}.steps[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const sid = requireStr(s, 'id', sctx)
    if (seen.has(sid)) throw new IrError(`${ctx}.steps: duplicate step id "${sid}"`)
    seen.add(sid)
    const lane = requireStr(s, 'lane', sctx)
    if (!laneIds.has(lane)) throw new IrError(`${sctx}.lane references unknown lane "${lane}"`)
    let kind = s.kind
    if (kind === undefined || kind === null) kind = 'step'
    else if (typeof kind !== 'string' || !STEP_KINDS.has(kind)) throw new IrError(`${sctx}.kind must be step|decision|start|end (got: ${JSON.stringify(kind)})`)
    const parallel = validateBool(s, 'parallel', sctx)
    if (parallel && i === 0) throw new IrError(`${sctx}.parallel: the first step has no previous step to sit beside`)
    if (!parallel) columnLanes.length = 0
    if (columnLanes.includes(lane)) throw new IrError(`${sctx}.parallel: lane "${lane}" already holds a step in this column`)
    columnLanes.push(lane)
    return {
      id: sid,
      label: requireStr(s, 'label', sctx),
      lane,
      kind,
      tone: validateTone(s.tone, sctx),
      emphasis: validateBool(s, 'emphasis', sctx),
      parallel,
    }
  })
}

function normalizeEdges(raw, steps, ctx) {
  if (raw === undefined || raw === null) {
    return steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id, label: '' }))
  }
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.edges must be a list of { from, to, label? }`)
  const ids = new Set(steps.map((s) => s.id))
  return raw.map((e, i) => {
    const ectx = `${ctx}.edges[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const from = requireStr(e, 'from', ectx)
    const to = requireStr(e, 'to', ectx)
    if (!ids.has(from)) throw new IrError(`${ectx}.from references unknown step "${from}"`)
    if (!ids.has(to)) throw new IrError(`${ectx}.to references unknown step "${to}"`)
    if (from === to) throw new IrError(`${ectx}: from and to must differ (a swimlane has no self loops)`)
    return { from, to, label: optStr(e, 'label', ectx) ?? '' }
  })
}

// --- budgets ---------------------------------------------------------------

/** Decisions whose outgoing edges are fewer than two or not all labelled. */
function weakDecisions(ir) {
  return ir.steps.filter((s) => s.kind === 'decision').filter((s) => {
    const out = ir.edges.filter((e) => e.from === s.id)
    return out.length < 2 || out.some((e) => !e.label)
  })
}

export function budgetWarnings(ir) {
  const out = []
  const L = limits
  if (ir.lanes.length > L.maxLanes) {
    out.push(budgetWarning('budget:lanes', ir.lanes.length, L.maxLanes,
      `${ir.lanes.length} lane(s) (guidance ≤ ${L.maxLanes})`,
      `merge lanes past "${ir.lanes[L.maxLanes - 1].label}" into one actor, or split the flow by phase`))
  }
  if (ir.steps.length > L.maxSteps) {
    out.push(budgetWarning('budget:steps', ir.steps.length, L.maxSteps,
      `${ir.steps.length} step(s) (guidance ≤ ${L.maxSteps})`,
      `split the flow after step ${L.maxSteps} ("${ir.steps[L.maxSteps - 1].label}"), or use direction: down`))
  }
  let longest = null
  const consider = (what, label) => {
    const len = [...label].length
    if (len > L.maxLabelLen && (!longest || len > longest.len)) longest = { what, label, len }
  }
  ir.steps.forEach((s) => consider(`step "${s.id}"`, s.label))
  ir.edges.forEach((e, i) => consider(`edge ${i}`, e.label))
  if (longest) {
    out.push(budgetWarning('budget:label', longest.len, L.maxLabelLen,
      `${longest.what} label "${longest.label}" is ${longest.len} chars (guidance ≤ ${L.maxLabelLen})`,
      'shorten the label to the action; put the detail in the caption'))
  }
  const emphasized = ir.steps.filter((s) => s.emphasis)
  if (emphasized.length > L.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized.length, L.maxEmphasis,
      `${emphasized.length} emphasized step(s) (guidance ≤ ${L.maxEmphasis})`,
      `keep emphasis on at most ${L.maxEmphasis} steps (${emphasized.map((s) => `"${s.id}"`).join(', ')} are all emphasized)`))
  }
  const weak = weakDecisions(ir)
  if (weak.length) {
    out.push(budgetWarning('budget:decision', weak.length, 0,
      weak.map((s) => `decision "${s.id}" lacks two labelled outgoing edges`).join('; '),
      'give every decision at least two outgoing edges, each labelled with its outcome (はい / いいえ)'))
  }
  return out
}

// --- layout ----------------------------------------------------------------

/** Box size in x/y terms (width fitted to the label, height by kind). */
function boxSize(step) {
  const tw = textWidth(step.label, FONT_SIZE) * (step.emphasis ? BOLD_FACTOR : 1)
  if (step.kind === 'decision') return { w: snapUp8(Math.max(72, tw * 1.4 + 16)), h: DECISION_H }
  if (step.kind === 'start' || step.kind === 'end') return { w: snapUp8(Math.max(64, tw + 32)), h: BOX_H }
  return { w: snapUp8(Math.max(64, tw + 16)), h: BOX_H }
}

/** Columns by flow order: a `parallel` step shares its predecessor's. */
function columnsOf(steps) {
  let col = -1
  return steps.map((s) => (s.parallel ? col : ++col))
}

export async function layout(ir) {
  const { direction, lanes, steps, edges } = ir
  const right = direction === 'right'
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]))
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]))
  const cols = columnsOf(steps)
  const nCols = cols.length ? cols[cols.length - 1] + 1 : 0

  // Box extents on the main (flow) and cross (lane) axes.
  const sizes = steps.map((s) => {
    const { w, h } = boxSize(s)
    return right ? { w, h, main: w, cross: h } : { w, h, main: h, cross: w }
  })
  const occupied = new Map()
  steps.forEach((s, i) => occupied.set(`${cols[i]}:${laneIndex.get(s.lane)}`, i))
  const clearCells = (lane, c0, c1) => {
    for (let c = c0; c <= c1; c++) if (occupied.has(`${c}:${lane}`)) return false
    return true
  }
  const clearBetweenLanes = (col, la, lb) => {
    for (let l = Math.min(la, lb) + 1; l < Math.max(la, lb); l++) if (occupied.has(`${col}:${l}`)) return false
    return true
  }

  // 1. route shape per edge, from grid occupancy alone.
  const routed = edges.map((e, index) => {
    const a = stepIndex.get(e.from), b = stepIndex.get(e.to)
    const ca = cols[a], cb = cols[b]
    const la = laneIndex.get(steps[a].lane), lb = laneIndex.get(steps[b].lane)
    let route
    if (cb > ca) {
      if (la === lb && clearCells(la, ca + 1, cb - 1)) route = 'straight'
      else if (steps[a].kind === 'decision' && la !== lb && clearBetweenLanes(ca, la, lb) && clearCells(lb, ca, cb - 1)) route = 'vertex'
      else if (la !== lb && clearCells(lb, ca + 1, cb - 1)) route = 'z'
      else route = 'strip'
    } else if (cb === ca) {
      route = clearBetweenLanes(ca, la, lb) ? 'vertex' : 'hook'
    } else {
      route = 'back'
    }
    return { ...e, index, a, b, ca, cb, la, lb, route }
  })

  // 2. gutter slots (vertical runs) and lane strips (horizontal runs).
  //    A labelled z/hook edge reserves room beside its slot for the label.
  const labelMain = (e) => (e.label ? snapUp4((right ? labelWidth(e.label) : LABEL_H) + 8) : 0)
  const labelCross = (e) => (e.label ? snapUp4((right ? LABEL_H : labelWidth(e.label)) + 8) : 0)
  const gutterUsers = new Map()    // gutter g (−1 … nCols−1) → [{ index, need }]
  const gutterExtra = new Map()    // straight-edge label room
  const useGutter = (g, e, need) => {
    if (!gutterUsers.has(g)) gutterUsers.set(g, [])
    gutterUsers.get(g).push({ index: e.index, need })
  }
  const strips = lanes.map(() => ({ start: [], end: [] }))
  for (const e of routed) {
    switch (e.route) {
      case 'straight':
        if (e.label) gutterExtra.set(e.ca, Math.max(gutterExtra.get(e.ca) ?? 0, labelMain(e) + 8))
        break
      case 'z':
        useGutter(e.ca, e, e.cb === e.ca + 1 ? labelMain(e) : 0)
        break
      case 'hook':
        useGutter(e.ca, e, labelMain(e))
        break
      case 'strip':
        useGutter(e.ca, e, 0); useGutter(e.cb - 1, e, 0)
        strips[e.lb].start.push(e)
        break
      case 'back':
        useGutter(e.ca, e, 0); useGutter(e.cb - 1, e, 0)
        strips[e.lb].end.push(e)
        break
      default:
        break
    }
  }
  const slotOffset = new Map()     // `${g}:${index}` → offset from the gutter start
  const gutterUsed = new Map()
  for (const [g, users] of gutterUsers) {
    let off = SLOT_EDGE
    users.forEach((u, i) => {
      slotOffset.set(`${g}:${u.index}`, off)
      if (i < users.length - 1) off += SLOT_STEP + u.need
      else off += u.need + SLOT_EDGE
    })
    gutterUsed.set(g, snapUp4(off))
  }
  const gutterMain = []            // index g + 1
  for (let g = -1; g < nCols; g++) {
    const used = gutterUsed.get(g) ?? 0
    const outer = g === -1 || g === nCols - 1
    const w = outer ? used : Math.max(GAP_MIN, used, gutterExtra.get(g) ?? 0)
    gutterMain.push(snapUp4(w))
  }

  // 3. columns (main) and lanes (cross).
  const colMain = Array.from({ length: nCols }, (_, c) => {
    const inCol = steps.map((s, i) => (cols[i] === c ? sizes[i].main : 0))
    return snapUp8(Math.max(right ? 64 : 40, ...inCol))
  })
  const labelBand = right
    ? snapUp4(Math.max(LABEL_BAND_MIN, Math.ceil(Math.max(...lanes.map((l) => textWidth(l.label, FONT_SIZE)))) + 16))
    : HEADER_MAIN
  const laneGeo = lanes.map((l, k) => {
    const inLane = steps.map((s, i) => (laneIndex.get(s.lane) === k ? sizes[i].cross : 0))
    const inner = snapUp8(Math.max(BOX_H, ...inLane))
    const stripPad = (list) => {
      if (!list.length) return LANE_PAD
      const labelled = list.filter((e) => e.label)
      const room = labelled.length ? Math.max(...labelled.map(labelCross)) + 4 : 0
      return snapUp4(LANE_PAD + STRIP_STEP * (list.length - 1) + room)
    }
    const padStart = stripPad(strips[k].start)
    const padEnd = stripPad(strips[k].end)
    const minCross = right ? 0 : snapUp4(textWidth(l.label, FONT_SIZE) + 16)
    const cross = Math.max(snapUp4(padStart + inner + padEnd), minCross)
    return { id: l.id, label: l.label, index: k, padStart, padEnd, inner, cross }
  })

  // Main positions: margin, label band, gutter −1, col 0, gutter 0, …
  let m = MARGIN + labelBand
  const gutterStart = []
  const colStart = []
  for (let c = 0; c < nCols; c++) {
    gutterStart.push(m); m += gutterMain[c]
    colStart.push(m); m += colMain[c]
  }
  gutterStart.push(m); m += gutterMain[nCols]
  const mainEnd = m
  const slotMain = (g, index) => {
    const off = slotOffset.get(`${g}:${index}`)
    const used = gutterUsed.get(g)
    const w = gutterMain[g + 1]
    return snap4(gutterStart[g + 1] + (w - used) / 2 + off)
  }

  // Cross positions: lanes stacked from the margin.
  let c = MARGIN
  for (const l of laneGeo) {
    l.crossStart = c
    l.center = snap4(c + l.padStart + l.inner / 2)
    c += l.cross
  }
  const crossEnd = c
  const stripCross = (lane, side, e) => {
    const list = strips[lane][side]
    const i = list.findIndex((x) => x.index === e.index)
    const l = laneGeo[lane]
    return side === 'start' ? l.crossStart + STRIP_OFFSET + STRIP_STEP * i : l.crossStart + l.cross - STRIP_OFFSET - STRIP_STEP * i
  }

  // Boxes in main/cross.
  const boxes = steps.map((s, i) => {
    const sz = sizes[i]
    const col = cols[i]
    const lane = laneGeo[laneIndex.get(s.lane)]
    const mc = snap4(colStart[col] + colMain[col] / 2)
    const m0 = mc - sz.main / 2
    const c0 = lane.center - sz.cross / 2
    return { i, m0, m1: m0 + sz.main, mc, c0, c1: c0 + sz.cross, cc: lane.center, col, lane: lane.index }
  })

  // 4. polylines in main/cross, then x/y.
  const P = (mm, cc) => (right ? { x: mm, y: cc } : { x: cc, y: mm })
  const edgeGeo = routed.map((e) => {
    const A = boxes[e.a], B = boxes[e.b]
    const pts = []
    switch (e.route) {
      case 'straight':
        pts.push(P(A.m1, A.cc), P(B.m0, B.cc))
        break
      case 'z': {
        const s = slotMain(e.ca, e.index)
        pts.push(P(A.m1, A.cc), P(s, A.cc), P(s, B.cc), P(B.m0, B.cc))
        break
      }
      case 'vertex': {
        const v = e.lb > e.la ? A.c1 : A.c0
        if (e.cb === e.ca) pts.push(P(A.mc, v), P(B.mc, e.lb > e.la ? B.c0 : B.c1))
        else pts.push(P(A.mc, v), P(A.mc, B.cc), P(B.m0, B.cc))
        break
      }
      case 'hook': {
        const s = slotMain(e.ca, e.index)
        pts.push(P(A.m1, A.cc), P(s, A.cc), P(s, B.cc), P(B.m1, B.cc))
        break
      }
      case 'strip':
      case 'back': {
        const sa = slotMain(e.ca, e.index), sb = slotMain(e.cb - 1, e.index)
        const st = stripCross(e.lb, e.route === 'strip' ? 'start' : 'end', e)
        pts.push(P(A.m1, A.cc), P(sa, A.cc), P(sa, st), P(sb, st), P(sb, B.cc), P(B.m0, B.cc))
        break
      }
      default:
        break
    }
    return { index: e.index, from: e.from, to: e.to, route: e.route, text: e.label, points: simplify(pts), label: null }
  })

  const stepGeo = steps.map((s, i) => {
    const b = boxes[i]
    const p = P(b.m0, b.c0)
    const { w, h } = sizes[i]
    return {
      id: s.id, label: s.label, lane: s.lane, kind: s.kind, tone: s.tone, emphasis: s.emphasis, column: b.col,
      x: p.x, y: p.y, width: w, height: h, cx: snap4(p.x + w / 2), cy: snap4(p.y + h / 2),
    }
  })
  const laneOut = laneGeo.map((l) => {
    const p0 = P(MARGIN, l.crossStart), p1 = P(mainEnd, l.crossStart + l.cross)
    const lb0 = P(MARGIN, l.crossStart), lb1 = P(MARGIN + labelBand, l.crossStart + l.cross)
    const tc = P(snap4(MARGIN + labelBand / 2), l.center)
    return {
      id: l.id, label: l.label, index: l.index,
      x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y,
      labelBox: { x: lb0.x, y: lb0.y, width: lb1.x - lb0.x, height: lb1.y - lb0.y },
      textX: right ? tc.x : tc.x, textY: right ? l.center + 4 : MARGIN + HEADER_MAIN / 2 + 4,
    }
  })
  const f0 = P(MARGIN, MARGIN), f1 = P(mainEnd, crossEnd)
  const frame = { x: f0.x, y: f0.y, width: f1.x - f0.x, height: f1.y - f0.y }
  const b0 = P(MARGIN + labelBand, MARGIN), b1 = P(MARGIN + labelBand, crossEnd)
  const separators = laneOut.slice(1).map((l) => (right
    ? { x1: frame.x, y1: l.y, x2: frame.x + frame.width, y2: l.y }
    : { x1: l.x, y1: frame.y, x2: l.x, y2: frame.y + frame.height }))
  separators.push({ x1: b0.x, y1: b0.y, x2: b1.x, y2: b1.y })
  const columnGeo = colStart.map((cs, k) => {
    const p0 = P(cs, MARGIN), p1 = P(cs + colMain[k], crossEnd)
    return { index: k, x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y }
  })

  // 5. labels beside their edges.
  const segments = []
  for (const e of edgeGeo) for (let i = 1; i < e.points.length; i++) segments.push([e.points[i - 1], e.points[i]])
  const rules = separators.map((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])
  const frameEdges = [
    [{ x: frame.x, y: frame.y }, { x: frame.x + frame.width, y: frame.y }],
    [{ x: frame.x, y: frame.y + frame.height }, { x: frame.x + frame.width, y: frame.y + frame.height }],
    [{ x: frame.x, y: frame.y }, { x: frame.x, y: frame.y + frame.height }],
    [{ x: frame.x + frame.width, y: frame.y }, { x: frame.x + frame.width, y: frame.y + frame.height }],
  ]
  const lines = [...segments, ...rules, ...frameEdges]
  const obstacles = [...stepGeo.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height })), ...laneOut.map((l) => l.labelBox)]
  const placed = []
  for (const e of edgeGeo) {
    if (!e.text) continue
    const w = labelWidth(e.text)
    const cands = labelCandidates(e.points, w, LABEL_H)
    const clear = cands.find((cand) => !lines.some((s) => segmentHitsRect(s[0], s[1], cand, LABEL_GAP - 2))
      && !obstacles.some((o) => rectsOverlap(o, cand, LABEL_PAD))
      && !placed.some((o) => rectsOverlap(o, cand, LABEL_PAD)))
    const pick = clear ?? cands[0]
    e.label = { ...pick, width: w, height: LABEL_H, text: e.text }
    placed.push(e.label)
  }

  // 6. canvas — labels may poke past the frame; grow the canvas for them.
  let maxX = frame.x + frame.width, maxY = frame.y + frame.height
  for (const l of placed) { maxX = Math.max(maxX, l.x + l.width); maxY = Math.max(maxY, l.y + l.height) }
  const width = snapUp4(maxX + MARGIN)
  const height = snapUp4(maxY + MARGIN)
  return {
    width,
    height,
    geo: { direction, frame, labelBand: { x: b0.x - (right ? labelBand : 0), y: b0.y - (right ? 0 : labelBand), width: right ? labelBand : frame.width, height: right ? frame.height : labelBand }, lanes: laneOut, columns: columnGeo, separators, steps: stepGeo, edges: edgeGeo },
  }
}

/** Drop repeated points and points that sit on a straight run. */
function simplify(points) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    const prev = out[out.length - 2]
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

/** Label boxes beside each segment, longest segment first; a vertical
 * segment offers its right then left side, a horizontal one above then
 * below, each at the midpoint and then shifted along the segment. */
function labelCandidates(points, w, h) {
  const segs = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    segs.push({ a, b, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y), order: i })
  }
  segs.sort((p, q) => q.len - p.len || p.order - q.order)
  const out = []
  for (const { a, b, len } of segs) {
    for (const shift of LABEL_SHIFTS) {
      if (shift !== 0 && Math.abs(shift) > len / 2) continue
      if (a.x === b.x) {
        const midY = (a.y + b.y) / 2 + shift
        out.push({ x: snap4(a.x + LABEL_GAP), y: snap4(midY - h / 2), width: w, height: h })
        out.push({ x: snap4(a.x - LABEL_GAP - w), y: snap4(midY - h / 2), width: w, height: h })
      } else {
        const midX = (a.x + b.x) / 2 + shift
        out.push({ x: snap4(midX - w / 2), y: snap4(a.y - LABEL_GAP - h), width: w, height: h })
        out.push({ x: snap4(midX - w / 2), y: snap4(a.y + LABEL_GAP), width: w, height: h })
      }
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

const inside = (v, lo, hi) => v > lo && v < hi
const overlapsOpen = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2)

/** Whether the segment p→q passes through the interior of rect r
 * (touching the border does not count). */
function segmentThroughRect(p, q, r) {
  if (p.y === q.y) return inside(p.y, r.y, r.y + r.height) && overlapsOpen(Math.min(p.x, q.x), Math.max(p.x, q.x), r.x, r.x + r.width)
  if (p.x === q.x) return inside(p.x, r.x, r.x + r.width) && overlapsOpen(Math.min(p.y, q.y), Math.max(p.y, q.y), r.y, r.y + r.height)
  return true
}

// --- draw ------------------------------------------------------------------

const pathD = (pts) => `M${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`

function shapeSvg(uid, s) {
  const cls = s.emphasis ? ' class="wu-focal"' : ''
  const sw = s.emphasis ? 1.5 : 1
  const fill = `var(--wu-fig-tone-${s.tone})`
  const common = `id="${uid}-${s.id}" data-tone="${esc(s.tone)}"${cls} fill="${fill}" stroke-width="${sw}"`
  if (s.kind === 'decision') {
    const pts = `${s.cx},${s.y} ${s.x + s.width},${s.cy} ${s.cx},${s.y + s.height} ${s.x},${s.cy}`
    return `<polygon ${common} points="${pts}" stroke="${s.emphasis ? 'var(--wu-accent)' : 'currentColor'}" stroke-linejoin="round"/>`
  }
  if (s.kind === 'start' || s.kind === 'end') {
    const r = s.height / 2
    const d = `M${s.x + r} ${s.y} H${s.x + s.width - r} A${r} ${r} 0 0 1 ${s.x + s.width - r} ${s.y + s.height} H${s.x + r} A${r} ${r} 0 0 1 ${s.x + r} ${s.y} Z`
    return `<path ${common} d="${d}" stroke="${s.emphasis ? 'var(--wu-accent)' : 'currentColor'}"/>`
  }
  return `<rect ${common} x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="4" stroke="currentColor"/>`
}

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')

  // lanes: label cells, rules, frame
  for (const l of geo.lanes) {
    const b = l.labelBox
    parts.push(`<rect id="${uid}-lane-${l.id}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="var(--wu-rule-soft)" stroke="none"/>`)
  }
  geo.separators.forEach((s, i) => {
    parts.push(`<line id="${uid}-rule-${i}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  })
  parts.push(`<rect id="${uid}-frame" x="${geo.frame.x}" y="${geo.frame.y}" width="${geo.frame.width}" height="${geo.frame.height}" fill="none" stroke="var(--wu-rule)" stroke-width="1"/>`)
  for (const l of geo.lanes) {
    parts.push(`<text id="${uid}-lane-${l.id}-label" x="${l.textX}" y="${l.textY}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(l.label)}</text>`)
  }

  // edges under the boxes
  for (const e of geo.edges) {
    parts.push(`<path id="${uid}-e-${e.index}" d="${pathD(e.points)}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
  }

  // steps
  for (const s of geo.steps) {
    parts.push(shapeSvg(uid, s))
    const weight = s.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-${s.id}-label" x="${s.cx}" y="${s.cy + 4}" font-size="${FONT_SIZE}"${weight} text-anchor="middle" fill="currentColor">${esc(s.label)}</text>`)
  }

  // edge labels last, over everything
  for (const e of geo.edges) {
    if (!e.label) continue
    parts.push(`<text id="${uid}-e-${e.index}-label" x="${e.label.x + 4}" y="${e.label.y + 11}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(e.label.text)}</text>`)
  }
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

const ROW_NAMES = ['references', 'lane-count', 'step-count', 'label-length', 'emphasis-count', 'decision-branches', 'steps-in-lane', 'edges-clear', 'label-clear']

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }

  // 1. references: step → lane, edge → step
  const laneIds = new Set(ir.lanes.map((l) => l.id))
  const stepIds = new Set(ir.steps.map((s) => s.id))
  const bad = []
  ir.steps.forEach((s, i) => { if (!laneIds.has(s.lane)) bad.push(`steps[${i}] → lane "${s.lane}"`) })
  ir.edges.forEach((e, i) => { for (const id of [e.from, e.to]) if (!stepIds.has(id)) bad.push(`edges[${i}] → step "${id}"`) })
  rows.push({ id: 1, name: 'references', severity: 'fail', ok: bad.length === 0, detail: bad.length ? `unknown reference: ${bad.join(', ')}` : 'every step names a known lane and every edge two known steps', hint: bad.length ? 'fix the lane / from / to ids or add the missing lane or step' : undefined })

  budgetRow(2, 'lane-count', 'budget:lanes', `${ir.lanes.length} lane(s)`)
  budgetRow(3, 'step-count', 'budget:steps', `${ir.steps.length} step(s)`)
  budgetRow(4, 'label-length', 'budget:label', `every label is within the ${limits.maxLabelLen}-char guidance`)
  budgetRow(5, 'emphasis-count', 'budget:emphasis', `${ir.steps.filter((s) => s.emphasis).length} emphasized step(s)`)
  budgetRow(6, 'decision-branches', 'budget:decision', 'every decision has two or more labelled outgoing edges')

  // 7. every step box inside its lane band, past the label band
  const laneOf = new Map(geo.lanes.map((l) => [l.id, l]))
  const outside = []
  for (const s of geo.steps) {
    const l = laneOf.get(s.lane)
    if (!l) { outside.push(`step ${s.id} has no lane band`); continue }
    const inLane = s.x >= l.x && s.x + s.width <= l.x + l.width && s.y >= l.y && s.y + s.height <= l.y + l.height
    const overBand = rectsOverlap(s, l.labelBox)
    if (!inLane) outside.push(`step ${s.id} leaves lane "${s.lane}"`)
    else if (overBand) outside.push(`step ${s.id} overlaps the lane label`)
  }
  rows.push({ id: 7, name: 'steps-in-lane', severity: 'fail', ok: outside.length === 0, detail: outside.length ? outside.join('; ') : `every step box sits inside its lane band`, hint: outside.length ? 'internal layout error — report the IR' : undefined })

  // 8. edges orthogonal and never through a step box
  const problems = []
  for (const e of geo.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i]
      if (a.x !== b.x && a.y !== b.y) { problems.push(`edge ${e.index} segment ${i} is diagonal`); continue }
      const hit = geo.steps.find((s) => segmentThroughRect(a, b, s))
      if (hit) problems.push(`edge ${e.index} segment ${i} passes through step ${hit.id}`)
    }
  }
  rows.push({ id: 8, name: 'edges-clear', severity: 'fail', ok: problems.length === 0, detail: problems.length ? problems.slice(0, 4).join('; ') : `${geo.edges.length} edge(s) run orthogonally, none through a step box`, hint: problems.length ? 'route lane changes through the gutter between columns; mark a side-by-side step parallel: true' : undefined })

  // 9. labels clear of every line and box
  const lines = []
  for (const e of geo.edges) for (let i = 1; i < e.points.length; i++) lines.push({ a: e.points[i - 1], b: e.points[i], owner: `edge ${e.index}` })
  geo.separators.forEach((s, i) => lines.push({ a: { x: s.x1, y: s.y1 }, b: { x: s.x2, y: s.y2 }, owner: `lane rule ${i}` }))
  const boxes = [...geo.steps.map((s) => ({ ...s, owner: `step ${s.id}` })), ...geo.lanes.map((l) => ({ ...l.labelBox, owner: `lane label "${l.label}"` }))]
  const labelHits = []
  const seen = []
  for (const e of geo.edges) {
    if (!e.label) continue
    const hitLine = lines.find((s) => segmentHitsRect(s.a, s.b, e.label, LABEL_PAD))
    if (hitLine) labelHits.push(`label "${e.label.text}" crosses ${hitLine.owner}`)
    const hitBox = boxes.find((b) => rectsOverlap(b, e.label, LABEL_PAD))
    if (hitBox) labelHits.push(`label "${e.label.text}" overlaps ${hitBox.owner}`)
    const hitLabel = seen.find((b) => rectsOverlap(b, e.label, LABEL_PAD))
    if (hitLabel) labelHits.push(`label "${e.label.text}" overlaps label "${hitLabel.text}"`)
    seen.push(e.label)
  }
  rows.push({ id: 9, name: 'label-clear', severity: 'fail', ok: labelHits.length === 0, detail: labelHits.length ? labelHits.slice(0, 4).join('; ') : 'every edge label sits beside its edge, clear of every line and box', hint: labelHits.length ? 'shorten the label, move the step to another column, or drop the label into the caption' : undefined })

  return rows
}

export const doc = {
  purpose: 'a flow whose steps sit in lanes (actors / systems) — who does what in what order, and where the work changes hands',
  whenToUse: 'when the hand-offs between actors matter as much as the order of steps (approval flows, cross-team release steps); not for the payload of every step (use process) or for call order inside one system (use sequence). Budgets: lanes ≤ 5, steps ≤ 12, label ≤ 14 chars, emphasis ≤ 2; a decision needs two labelled outgoing edges. Guidance only — over-budget figures still render with data-warn. Long flows: direction: down.',
  irExample: `id: expense-approval
type: swimlane
title: 経費申請の流れ
caption: 差戻しは申請者に戻る
lanes:
  - id: requester
    label: 申請者
  - id: manager
    label: 上長
  - id: accounting
    label: 経理
steps:
  - id: draft
    label: 申請を作成
    lane: requester
    kind: start
  - id: submit
    label: 提出
    lane: requester
  - id: review
    label: 内容を確認
    lane: manager
  - id: approve
    label: 承認する？
    lane: manager
    kind: decision
  - id: pay
    label: 支払処理
    lane: accounting
    emphasis: true
  - id: notify
    label: 結果を通知
    lane: requester
  - id: done
    label: 完了
    lane: requester
    kind: end
edges:
  - from: draft
    to: submit
  - from: submit
    to: review
  - from: review
    to: approve
  - from: approve
    to: pay
    label: 承認
  - from: approve
    to: draft
    label: 差戻し
  - from: pay
    to: notify
  - from: notify
    to: done
`,
  rows: ROW_NAMES,
}
