// Validates and normalizes a parsed diagram IR object against the writeup
// contract (§4-1 IR shape, §4-2 budgets). Schema violations throw IrError
// internally and are turned into a structured `{ ok:false, reason:'schema' }`
// result; the emphasis cap is the one budget that still rejects
// (`{ ok:false, reason:'budget', suggestion }`), every other budget overrun
// comes back as an advisory `warnings` entry on an `ok:true` result.

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

/** Budgets for `type: sequence` IR (see sequence.mjs/verify-sequence.mjs) —
 * kept alongside LIMITS so both IR shapes' schema+budget rules live in this
 * one file. */
export const SEQUENCE_LIMITS = {
  maxParticipants: 6,
  maxMessages: 16,
  maxLabelLen: 16,
}

const TONES = new Set(['ts', 'rs', 'new', 'neutral'])
const KINDS = new Set(['sync', 'async', 'reply'])
const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const DIRECTIONS = new Set(['right', 'down'])
const IR_TYPES = new Set(['diagram', 'sequence'])

/**
 * Schema violations and the emphasis cap are hard rejections. The four
 * flowchart budgets (nodes / edges / groups / edge-label length) and the
 * three sequence budgets (participants / messages / message-label length)
 * are guidance, not gates: an over-budget IR still validates, and the
 * overruns come back as `warnings` (see budgetWarnings() /
 * sequenceBudgetWarnings()) so the renderer can draw the figure and stamp
 * `data-warn` on it while verified geometry decides pass/fail.
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
  if (ir.type === 'sequence') return { ok: true, ir, warnings: sequenceBudgetWarnings(ir) }
  const hard = checkBudgets(ir)
  if (!hard.ok) return hard
  return { ok: true, ir, warnings: budgetWarnings(ir) }
}

// --- structural validation --------------------------------------------

/** `raw.type` dispatch: `undefined`/`null` defaults to the original
 * node/edge diagram shape (kept backward compatible with every pre-existing
 * IR, which never carried a `type` field); `"sequence"` normalizes against
 * the participants/messages shape instead — see normalizeSequence(). */
function normalize(raw) {
  if (!isObj(raw)) throw new IrError('IR must be a mapping')
  const type = raw.type === undefined || raw.type === null ? 'diagram' : raw.type
  if (typeof type !== 'string' || !IR_TYPES.has(type)) {
    throw new IrError(`ir.type must be diagram|sequence (got: ${JSON.stringify(raw.type)})`)
  }
  if (type === 'sequence') return normalizeSequence(raw)

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

// --- sequence IR (type: sequence) --------------------------------------
//
// Shape: `{ id, type:'sequence', title, caption, participants, messages }`.
// `participants` is a flat list of `{id, label, tone}` (left→right order —
// no groups/nesting, sequence diagrams don't need them). `messages` is one
// row per line of the diagram, top→bottom, each row one of three shapes
// distinguished by which key is present:
//   - a plain message: `{from, to, label?, kind}` (kind: sync|async|reply)
//   - a note:          `{note: text, over?: [participant ids]}` — `over`
//     defaults to the two participants of the immediately preceding message
//     row when omitted (an error if there is no preceding message to infer
//     it from)
//   - a self-message:  `{self: participant id, label?, kind?}` (kind
//     defaults to sync)
// Normalized rows carry a `rowType` discriminator ('message'|'note'|'self')
// instead of reusing the raw `note`/`self` keys as flags, so a message's
// own `kind` (sync/async/reply) is never confused with the row-shape
// discriminator.

function normalizeSequence(raw) {
  const id = requireStr(raw, 'id', 'ir')
  const title = requireStr(raw, 'title', 'ir')
  const caption = optStr(raw, 'caption', 'ir')
  const participants = normalizeParticipants(raw.participants)
  const participantIds = new Set(participants.map((p) => p.id))
  const messages = normalizeMessages(raw.messages, participantIds)
  return { id, type: 'sequence', title, caption, participants, messages }
}

function normalizeParticipants(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError('ir.participants must be a non-empty list')
  const seen = new Set()
  return raw.map((p, i) => {
    const ctx = `participants[${i}]`
    if (!isObj(p)) throw new IrError(`${ctx} must be a mapping`)
    const id = requireStr(p, 'id', ctx)
    if (seen.has(id)) throw new IrError(`duplicate participant id: "${id}"`)
    seen.add(id)
    const label = requireStr(p, 'label', ctx)
    const tone = validateTone(p.tone, ctx)
    return { id, label, tone }
  })
}

function validateSeqKind(v, ctx, { required }) {
  if (v === undefined || v === null) {
    if (required) throw new IrError(`${ctx}.kind is required and must be sync|async|reply`)
    return 'sync'
  }
  if (typeof v !== 'string' || !KINDS.has(v)) {
    throw new IrError(`${ctx}.kind must be sync|async|reply (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeMessages(raw, participantIds) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError('ir.messages must be a list')
  let prevMessage = null
  return raw.map((m, i) => {
    const ctx = `messages[${i}]`
    if (!isObj(m)) throw new IrError(`${ctx} must be a mapping`)

    if (m.note !== undefined) {
      const text = requireStr(m, 'note', ctx)
      let over
      if (m.over !== undefined && m.over !== null) {
        if (!Array.isArray(m.over) || m.over.length === 0) {
          throw new IrError(`${ctx}.over must be a non-empty list of participant ids`)
        }
        over = m.over.map((v) => {
          if (typeof v !== 'string' || !participantIds.has(v)) {
            throw new IrError(`${ctx}.over references unknown participant "${v}"`)
          }
          return v
        })
      } else if (prevMessage) {
        over = [prevMessage.from, prevMessage.to]
      } else {
        throw new IrError(`${ctx}: note has no "over" and no preceding message to infer it from`)
      }
      return { rowType: 'note', text, over }
    }

    if (m.self !== undefined) {
      const participant = requireStr(m, 'self', ctx)
      if (!participantIds.has(participant)) throw new IrError(`${ctx}.self references unknown participant "${participant}"`)
      const label = optStr(m, 'label', ctx) ?? ''
      const kind = validateSeqKind(m.kind, ctx, { required: false })
      return { rowType: 'self', participant, label, kind }
    }

    const from = requireStr(m, 'from', ctx)
    const to = requireStr(m, 'to', ctx)
    if (!participantIds.has(from)) throw new IrError(`${ctx}.from references unknown participant "${from}"`)
    if (!participantIds.has(to)) throw new IrError(`${ctx}.to references unknown participant "${to}"`)
    if (from === to) throw new IrError(`${ctx}: from and to must differ — use "self:" for a self-message`)
    const label = optStr(m, 'label', ctx) ?? ''
    const kind = validateSeqKind(m.kind, ctx, { required: true })
    const rec = { rowType: 'message', from, to, label, kind }
    prevMessage = rec
    return rec
  })
}

/**
 * The three sequence budgets (SEQUENCE_LIMITS: participants ≤ 6, rows ≤ 16,
 * message/self label ≤ 16 chars) as advisory warnings — the `type:
 * sequence` counterpart of budgetWarnings() below, same record shape, so
 * verify-diagram.mjs / rerender-figures.mjs / self-check.mjs handle both
 * figure kinds through one code path. Verified geometry (sequence.mjs
 * widens a column gap to fit the widest label between its lifelines;
 * verify-sequence.mjs checks the result) decides whether a figure renders.
 * Order is stable (participants, messages, label) so the `data-warn`
 * attribute built from it (formatBudgetWarnings()) is byte-stable too.
 *
 * @param {object} ir normalized `type: sequence` IR
 * @returns {Array<{key:string, value:number, limit:number, detail:string, hint:string}>}
 */
export function sequenceBudgetWarnings(ir) {
  const out = []
  if (ir.participants.length > SEQUENCE_LIMITS.maxParticipants) {
    out.push({
      key: 'budget:participants', value: ir.participants.length, limit: SEQUENCE_LIMITS.maxParticipants,
      detail: `${ir.participants.length} participant(s) (guidance ≤ ${SEQUENCE_LIMITS.maxParticipants})`,
      hint: 'consider splitting the sequence: draw one sequence diagram per participant subset',
    })
  }
  if (ir.messages.length > SEQUENCE_LIMITS.maxMessages) {
    out.push({
      key: 'budget:messages', value: ir.messages.length, limit: SEQUENCE_LIMITS.maxMessages,
      detail: `${ir.messages.length} row(s) (guidance ≤ ${SEQUENCE_LIMITS.maxMessages})`,
      hint: `consider splitting the sequence: split after message ${SEQUENCE_LIMITS.maxMessages}`,
    })
  }
  const longLabels = []
  ir.messages.forEach((m, i) => {
    if (m.rowType !== 'message' && m.rowType !== 'self') return
    const len = m.label ? [...m.label].length : 0
    if (len > SEQUENCE_LIMITS.maxLabelLen) longLabels.push({ i, label: m.label, len })
  })
  if (longLabels.length) {
    const longest = longLabels.reduce((a, b) => (b.len > a.len ? b : a))
    out.push({
      key: 'budget:label', value: longest.len, limit: SEQUENCE_LIMITS.maxLabelLen,
      detail: longLabels.map((e) => `messages[${e.i}].label "${e.label}" is ${e.len} chars (guidance ≤ ${SEQUENCE_LIMITS.maxLabelLen})`).join('; '),
      hint: longLabels.map((e) => `shorten label of message ${e.i + 1} ("${e.label}", ${e.len} > ${SEQUENCE_LIMITS.maxLabelLen})`).join('; ') + ', or move the wording into a note',
    })
  }
  return out
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
