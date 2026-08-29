// Validates and normalizes a parsed figure IR object against the writeup
// contract (§4-1 IR shape, §4-2 budgets). Schema violations throw IrError
// internally and are turned into a structured `{ ok:false, reason:'schema' }`
// result; the emphasis cap is the one budget that still rejects
// (`{ ok:false, reason:'budget', suggestion }`), every other budget overrun
// comes back as an advisory `warnings` entry on an `ok:true` result.
//
// Two kinds of IR come through here:
//   - the default node/edge diagram (`type:` absent or `diagram`) — its
//     schema and budgets are defined in this file and rendered by
//     diagram.mjs / verify-diagram.mjs;
//   - every other `type:` is a figure plugin (bin/lib/figures/<type>.mjs,
//     discovered by figures/index.mjs) and validateIR() routes the raw IR
//     to that plugin's normalize() / budgetWarnings().
// The schema helpers themselves (IrError, requireStr, …) live in
// figures/_shared.mjs so plugins can import them without importing this
// file (see the import-graph rule in figures/index.mjs).
import {
  IrError, isObj, requireStr, optStr, validateTone, validateBool, KINDS, normalizeHeader,
} from './figures/_shared.mjs'
import { getFigureType, listFigureTypes, registerBuiltin } from './figures/index.mjs'

export { IrError }

export const LIMITS = {
  maxNodes: 9,
  maxEdges: 12,
  maxGroups: 4,
  maxLabelLen: 12,
  maxEmphasis: 2,
}

const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const DIRECTIONS = new Set(['right', 'down'])

/**
 * Schema violations and the emphasis cap are hard rejections. The four
 * flowchart budgets (nodes / edges / groups / edge-label length) — and
 * every plugin type's budgets — are guidance, not gates: an over-budget IR
 * still validates, and the overruns come back as `warnings` (see
 * budgetWarnings() / the plugin's budgetWarnings()) so the renderer can
 * draw the figure and stamp `data-warn` on it while verified geometry
 * decides pass/fail.
 *
 * @param {unknown} raw parsed IR (from yaml-lite or JSON)
 * @returns {{ok:true, ir:object, warnings:Array<{key:string, value:number, limit:number, detail:string, hint:string}>} | {ok:false, reason:'schema'|'budget', message:string, suggestion?:string}}
 */
export function validateIR(raw) {
  let ir
  try {
    ir = normalize(raw)
  } catch (e) {
    if (e instanceof IrError) return { ok: false, reason: 'schema', message: e.message }
    throw e
  }
  if (ir.type !== 'diagram') return { ok: true, ir, warnings: getFigureType(ir.type).budgetWarnings(ir) }
  const hard = checkBudgets(ir)
  if (!hard.ok) return hard
  return { ok: true, ir, warnings: budgetWarnings(ir) }
}

// --- structural validation --------------------------------------------

/** The `type:` values validateIR() accepts: the builtin diagram plus every
 * registered plugin. */
export const irTypes = () => listFigureTypes()

/** `raw.type` dispatch: `undefined`/`null` defaults to the original
 * node/edge diagram shape (kept backward compatible with every pre-existing
 * IR, which never carried a `type` field); any other value is looked up in
 * the figure registry and normalized by that plugin. */
function normalize(raw) {
  if (!isObj(raw)) throw new IrError('IR must be a mapping')
  const type = raw.type === undefined || raw.type === null ? 'diagram' : raw.type
  if (typeof type !== 'string' || !getFigureType(type)) {
    throw new IrError(`ir.type must be ${irTypes().join('|')} (got: ${JSON.stringify(raw.type)})`)
  }
  if (type !== 'diagram') {
    const ir = getFigureType(type).normalize(raw, 'ir')
    if (!isObj(ir) || ir.type !== type) throw new Error(`figure type "${type}": normalize() must return an IR with type "${type}"`)
    return ir
  }

  const { id, title, caption } = normalizeHeader(raw, 'ir')

  let direction
  if (raw.direction !== undefined && raw.direction !== null) {
    if (typeof raw.direction !== 'string' || !DIRECTIONS.has(raw.direction)) {
      throw new IrError(`ir.direction must be right|down (got: ${JSON.stringify(raw.direction)})`)
    }
    direction = raw.direction
  }

  const groups = normalizeGroups(raw.groups)
  const groupIds = new Set(groups.map((g) => g.id))
  validateGroupNesting(groups, groupIds)

  const nodes = normalizeNodes(raw.nodes, groupIds)
  const nodeIds = new Set(nodes.map((n) => n.id))

  const edges = normalizeEdges(raw.edges, nodeIds)

  return { id, type: 'diagram', title, caption, direction, groups, nodes, edges }
}

function normalizeGroups(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError('ir.groups must be a list')
  const seen = new Set()
  return raw.map((g, i) => {
    const ctx = `groups[${i}]`
    if (!isObj(g)) throw new IrError(`${ctx} must be a mapping`)
    const id = requireStr(g, 'id', ctx)
    if (seen.has(id)) throw new IrError(`duplicate group id: "${id}"`)
    seen.add(id)
    const label = requireStr(g, 'label', ctx)
    const tone = validateTone(g.tone, ctx)
    const parent = optStr(g, 'group', ctx)
    const layer = validateGroupLayer(g.layer, ctx)
    return { id, label, tone, group: parent, layer }
  })
}

/**
 * A group's `layer:` hint — see diagram.mjs's computeGroupLayers() for what
 * it does. A non-negative integer pins the group to that elk partition
 * outright; `"auto"` explicitly opts into the automatic topological
 * assignment (the default when the hint is omitted); `"none"` opts the
 * whole diagram out of grouped-layer mode so elk's default hierarchical
 * layout applies instead.
 */
function validateGroupLayer(v, ctx) {
  if (v === undefined || v === null) return undefined
  if (v === 'auto' || v === 'none') return v
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  throw new IrError(`${ctx}.layer must be a non-negative integer, "auto", or "none" (got: ${JSON.stringify(v)})`)
}

function validateGroupNesting(groups, groupIds) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const g of groups) {
    if (g.group === undefined) continue
    if (!groupIds.has(g.group)) {
      throw new IrError(`group "${g.id}" references unknown parent group "${g.group}"`)
    }
    if (g.group === g.id) throw new IrError(`group "${g.id}" cannot be its own parent`)
  }
  for (const g of groups) {
    let depth = 0
    let cur = g
    const seen = new Set()
    while (cur.group !== undefined) {
      if (seen.has(cur.id)) throw new IrError(`group "${g.id}" has a cyclic parent chain`)
      seen.add(cur.id)
      depth++
      if (depth > 1) throw new IrError(`group "${g.id}" nests deeper than 1 level (groups: nesting depth ≤ 1)`)
      cur = byId.get(cur.group)
    }
  }
}

function normalizeNodes(raw, groupIds) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError('ir.nodes must be a non-empty list')
  const seen = new Set()
  return raw.map((n, i) => {
    const ctx = `nodes[${i}]`
    if (!isObj(n)) throw new IrError(`${ctx} must be a mapping`)
    const id = requireStr(n, 'id', ctx)
    if (seen.has(id)) throw new IrError(`duplicate node id: "${id}"`)
    if (groupIds.has(id)) throw new IrError(`node id "${id}" collides with a group id`)
    seen.add(id)
    const label = requireStr(n, 'label', ctx)
    const group = optStr(n, 'group', ctx)
    if (group !== undefined && !groupIds.has(group)) {
      throw new IrError(`${ctx}.group references unknown group "${group}"`)
    }
    const tone = validateTone(n.tone, ctx)
    const dashed = validateBool(n, 'dashed', ctx)
    const emphasis = validateBool(n, 'emphasis', ctx)
    return { id, label, group, tone, dashed, emphasis }
  })
}

function normalizeEdges(raw, nodeIds) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError('ir.edges must be a list')
  return raw.map((e, i) => {
    const ctx = `edges[${i}]`
    if (!isObj(e)) throw new IrError(`${ctx} must be a mapping`)
    const from = requireStr(e, 'from', ctx)
    const to = requireStr(e, 'to', ctx)
    if (!nodeIds.has(from)) throw new IrError(`${ctx}.from references unknown node "${from}"`)
    if (!nodeIds.has(to)) throw new IrError(`${ctx}.to references unknown node "${to}"`)
    const kind = requireStr(e, 'kind', ctx)
    if (!KINDS.has(kind)) throw new IrError(`${ctx}.kind must be sync|async|reply (got: ${kind})`)
    const label = optStr(e, 'label', ctx)

    let from_side
    if (e.from_side !== undefined && e.from_side !== null) {
      if (typeof e.from_side !== 'string' || !SIDES.has(e.from_side)) {
        throw new IrError(`${ctx}.from_side must be top|right|bottom|left (got: ${JSON.stringify(e.from_side)})`)
      }
      from_side = e.from_side
    }
    let to_side
    if (e.to_side !== undefined && e.to_side !== null) {
      if (typeof e.to_side !== 'string' || !SIDES.has(e.to_side)) {
        throw new IrError(`${ctx}.to_side must be top|right|bottom|left (got: ${JSON.stringify(e.to_side)})`)
      }
      to_side = e.to_side
    }

    let via = []
    if (e.via !== undefined && e.via !== null) {
      if (!Array.isArray(e.via)) throw new IrError(`${ctx}.via must be a list of node ids`)
      via = e.via.map((v) => {
        if (typeof v !== 'string') throw new IrError(`${ctx}.via entries must be node id strings`)
        if (!nodeIds.has(v)) throw new IrError(`${ctx}.via references unknown node "${v}"`)
        return v
      })
    }

    let label_at
    if (e.label_at !== undefined && e.label_at !== null) {
      const n = Number(e.label_at)
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new IrError(`${ctx}.label_at must be within 0..1 (got: ${JSON.stringify(e.label_at)})`)
      }
      label_at = n
    }

    return { from, to, kind, label, from_side, to_side, via, label_at }
  })
}

// --- budgets -------------------------------------------------------------

/** The one budget that stays a hard rejection: more than 2 emphasis nodes
 * has no focal point left to emphasize, so the figure is wrong, not just
 * crowded. */
function checkBudgets(ir) {
  const emphasisCount = ir.nodes.filter((n) => n.emphasis).length
  if (emphasisCount <= LIMITS.maxEmphasis) return { ok: true }
  return {
    ok: false,
    reason: 'budget',
    message: `emphasis: ${emphasisCount} > ${LIMITS.maxEmphasis}`,
    suggestion: `drop emphasis from ${emphasisCount - LIMITS.maxEmphasis} node(s) — only 1–2 focal points are allowed`,
  }
}

/**
 * The four flowchart budgets (contract §4-2: nodes ≤ 9, edges ≤ 12,
 * groups ≤ 4, edge label ≤ 12 chars) as advisory warnings. The node cap of
 * 9 has measured backing and stays the default guidance for authors, but
 * verified geometry — not the count — decides whether a figure renders.
 * Order is stable (nodes, edges, groups, label) so the `data-warn`
 * attribute built from it (formatBudgetWarnings()) is byte-stable too.
 *
 * @param {object} ir normalized flowchart IR
 * @returns {Array<{key:string, value:number, limit:number, detail:string, hint:string}>}
 */
export function budgetWarnings(ir) {
  const out = []
  const split = () => buildSplitSuggestion(ir)
  if (ir.nodes.length > LIMITS.maxNodes) {
    out.push({
      key: 'budget:nodes', value: ir.nodes.length, limit: LIMITS.maxNodes,
      detail: `${ir.nodes.length} node(s) (guidance ≤ ${LIMITS.maxNodes})`,
      hint: `consider splitting the figure — ${split()}`,
    })
  }
  if (ir.edges.length > LIMITS.maxEdges) {
    out.push({
      key: 'budget:edges', value: ir.edges.length, limit: LIMITS.maxEdges,
      detail: `${ir.edges.length} edge(s) (guidance ≤ ${LIMITS.maxEdges})`,
      hint: `consider splitting the figure — ${split()}`,
    })
  }
  if (ir.groups.length > LIMITS.maxGroups) {
    out.push({
      key: 'budget:groups', value: ir.groups.length, limit: LIMITS.maxGroups,
      detail: `${ir.groups.length} group(s) (guidance ≤ ${LIMITS.maxGroups})`,
      hint: `consider splitting the figure — ${split()}`,
    })
  }
  const longLabels = ir.edges
    .map((e, i) => ({ i, label: e.label, len: e.label === undefined ? 0 : [...e.label].length }))
    .filter((e) => e.len > LIMITS.maxLabelLen)
  if (longLabels.length) {
    const longest = longLabels.reduce((a, b) => (b.len > a.len ? b : a))
    out.push({
      key: 'budget:label', value: longest.len, limit: LIMITS.maxLabelLen,
      detail: longLabels.map((e) => `edges[${e.i}].label "${e.label}" is ${e.len} chars (guidance ≤ ${LIMITS.maxLabelLen})`).join('; '),
      hint: 'shorten the edge label(s), or move the wording into the caption',
    })
  }
  return out
}

/** `data-warn` attribute value: `budget:nodes=11;budget:label=15` (or, for
 * a sequence, `budget:participants=7;budget:messages=20;budget:label=23`) —
 * stable order, semicolon-separated; '' when there is nothing to warn about. */
export function formatBudgetWarnings(warnings) {
  return warnings.map((w) => `${w.key}=${w.value}`).join(';')
}

/** A concrete "how to fix it" suggestion: split by group, or around the highest-degree node. */
function buildSplitSuggestion(ir) {
  if (ir.groups.length >= 2) {
    const names = ir.groups.map((g) => g.label).join(', ')
    return `split: draw one diagram per group (${names})`
  }
  const degree = new Map(ir.nodes.map((n) => [n.id, 0]))
  for (const e of ir.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1)
    degree.set(e.to, (degree.get(e.to) || 0) + 1)
  }
  let top = null
  for (const [nid, d] of degree) {
    if (!top || d > top.d) top = { id: nid, d }
  }
  if (!top) return 'split: draw two smaller diagrams instead of one'
  const label = ir.nodes.find((n) => n.id === top.id)?.label ?? top.id
  return `split: move the edges around node "${label}" (degree ${top.d}) into a separate diagram`
}

// --- the builtin diagram, listed next to the plugins ------------------------

/** verify-diagram.mjs's row names (§4-2 rows 1–20 plus the two extra
 * budget rows 21–22), for `render-diagram.mjs --list-types` / `--doc`. */
export const DIAGRAM_ROWS = [
  'orthogonal', 'label-clearance', 'unrelated-crossing', 'collinear-overlap', 'border-hug', 'rhythm',
  'legend-clearance', 'node-clearance', 'projected-scale', 'node-count', 'edge-count', 'grid-4px',
  'emphasis-count', 'a11y', 'label-fit', 'orientation-choice', 'dark-3-state', 'font-size', 'stroke-radius',
  'single-finite-svg', 'group-count', 'label-length',
]

registerBuiltin({
  type: 'diagram',
  limits: LIMITS,
  doc: {
    purpose: 'boxes (nodes) in optional groups, connected by orthogonal edges — structure, flow, and boundaries',
    whenToUse: 'the default figure: components and their connections, layers, before/after structure. `type:` may be omitted. Not for time-ordered calls (use sequence). Budgets: nodes ≤ 9, edges ≤ 12, groups ≤ 4, edge label ≤ 12 chars (guidance); emphasis ≤ 2 (hard).',
    irExample: `id: request-path
title: リクエストの通り道
caption: API は応答を返してから、キュー経由でワーカーに渡す
groups:
  - id: backend
    label: バックエンド
    tone: ts
nodes:
  - id: ui
    label: 画面
    tone: neutral
  - id: api
    label: API
    group: backend
    emphasis: true
  - id: queue
    label: キュー
    group: backend
  - id: worker
    label: ワーカー
    group: backend
  - id: db
    label: DB
    group: backend
edges:
  - from: ui
    to: api
    kind: sync
    label: 送信
  - from: api
    to: queue
    kind: async
    label: 積む
  - from: queue
    to: worker
    kind: sync
    label: 取り出す
  - from: worker
    to: db
    kind: sync
    label: 保存
`,
    rows: DIAGRAM_ROWS,
  },
})
