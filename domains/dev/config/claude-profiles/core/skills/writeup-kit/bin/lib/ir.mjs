// Validates and normalizes a parsed diagram IR object against the writeup
// contract (§4-1 IR shape, §4-2 budgets). Schema violations throw IrError
// internally and are turned into a structured `{ ok:false, reason:'schema' }`
// result; budget overruns become `{ ok:false, reason:'budget', suggestion }`
// so a caller can print the reason without a stack trace.

export class IrError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IrError'
  }
}

export const LIMITS = {
  maxNodes: 9,
  maxEdges: 12,
  maxGroups: 4,
  maxLabelLen: 12,
  maxEmphasis: 2,
}

const TONES = new Set(['ts', 'rs', 'new', 'neutral'])
const KINDS = new Set(['sync', 'async', 'reply'])
const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const DIRECTIONS = new Set(['right', 'down'])

/**
 * @param {unknown} raw parsed IR (from yaml-lite or JSON)
 * @returns {{ok:true, ir:object} | {ok:false, reason:'schema'|'budget', message:string, suggestion?:string}}
 */
export function validateIR(raw) {
  let ir
  try {
    ir = normalize(raw)
  } catch (e) {
    if (e instanceof IrError) return { ok: false, reason: 'schema', message: e.message }
    throw e
  }
  const budget = checkBudgets(ir)
  if (!budget.ok) return budget
  return { ok: true, ir }
}

// --- structural validation --------------------------------------------

function normalize(raw) {
  if (!isObj(raw)) throw new IrError('IR must be a mapping')

  const id = requireStr(raw, 'id', 'ir')
  const title = requireStr(raw, 'title', 'ir')
  const caption = optStr(raw, 'caption', 'ir')

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

  return { id, title, caption, direction, groups, nodes, edges }
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

function checkBudgets(ir) {
  const violations = []

  if (ir.nodes.length > LIMITS.maxNodes) {
    violations.push(`nodes: ${ir.nodes.length} > ${LIMITS.maxNodes}`)
  }
  if (ir.edges.length > LIMITS.maxEdges) {
    violations.push(`edges: ${ir.edges.length} > ${LIMITS.maxEdges}`)
  }
  if (ir.groups.length > LIMITS.maxGroups) {
    violations.push(`groups: ${ir.groups.length} > ${LIMITS.maxGroups}`)
  }
  const emphasisCount = ir.nodes.filter((n) => n.emphasis).length
  if (emphasisCount > LIMITS.maxEmphasis) {
    violations.push(`emphasis: ${emphasisCount} > ${LIMITS.maxEmphasis}`)
  }
  ir.edges.forEach((e, i) => {
    if (e.label !== undefined && [...e.label].length > LIMITS.maxLabelLen) {
      violations.push(`edges[${i}].label "${e.label}" exceeds ${LIMITS.maxLabelLen} chars`)
    }
  })

  if (violations.length === 0) return { ok: true }
  return {
    ok: false,
    reason: 'budget',
    message: violations.join('; '),
    suggestion: buildSplitSuggestion(ir),
  }
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

// --- helpers ---------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function requireStr(obj, field, ctx) {
  const v = obj[field]
  if (typeof v !== 'string' || v.trim() === '') {
    throw new IrError(`${ctx}.${field} is required and must be a non-empty string`)
  }
  return v
}

function optStr(obj, field, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new IrError(`${ctx}.${field} must be a string (got: ${JSON.stringify(v)})`)
  return v
}

function validateTone(tone, ctx) {
  if (tone === undefined || tone === null) return 'neutral'
  if (typeof tone !== 'string' || !TONES.has(tone)) {
    throw new IrError(`${ctx}.tone must be ts|rs|new|neutral (got: ${JSON.stringify(tone)})`)
  }
  return tone
}

function validateBool(obj, field, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return false
  if (typeof v !== 'boolean') throw new IrError(`${ctx}.${field} must be a boolean`)
  return v
}
