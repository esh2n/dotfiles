// `type: sequence` — participants on a row, messages as horizontal arrows
// between dashed lifelines, top to bottom. This file is the plugin
// (references/figure-types.md's contract); the layout/drawing lives in
// ../sequence.mjs and the type-specific verify rows in
// ../verify-sequence.mjs, both wrapped here rather than moved.
//
// IR shape: `{ id, type:'sequence', title, caption, participants, messages }`.
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
import { IrError, isObj, requireStr, optStr, validateTone, normalizeHeader, KINDS } from './_shared.mjs'
import { layoutSequence, drawSequenceInner } from '../sequence.mjs'
import { verifySequence, sequenceBudgetWarnings, SEQUENCE_LIMITS, SEQUENCE_OWN_ROWS } from '../verify-sequence.mjs'

export const type = 'sequence'

export const limits = SEQUENCE_LIMITS

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const participants = normalizeParticipants(raw.participants, ctx)
  const participantIds = new Set(participants.map((p) => p.id))
  const messages = normalizeMessages(raw.messages, participantIds, ctx)
  return { id, type, title, caption, participants, messages }
}

function normalizeParticipants(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.participants must be a non-empty list`)
  const seen = new Set()
  return raw.map((p, i) => {
    const pctx = `participants[${i}]`
    if (!isObj(p)) throw new IrError(`${pctx} must be a mapping`)
    const id = requireStr(p, 'id', pctx)
    if (seen.has(id)) throw new IrError(`duplicate participant id: "${id}"`)
    seen.add(id)
    const label = requireStr(p, 'label', pctx)
    const tone = validateTone(p.tone, pctx)
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

function normalizeMessages(raw, participantIds, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.messages must be a list`)
  let prevMessage = null
  return raw.map((row, i) => {
    const mctx = `messages[${i}]`
    if (!isObj(row)) throw new IrError(`${mctx} must be a mapping`)
    // Accept an already-normalized row (rowType/text/participant) so the IR a
    // figure embeds after rendering re-validates unchanged: normalization is
    // idempotent.
    const m = row.rowType === 'note' ? { note: row.text, over: row.over }
      : row.rowType === 'self' ? { self: row.participant, label: row.label, kind: row.kind }
      : row

    if (m.note !== undefined) {
      const text = requireStr(m, 'note', mctx)
      let over
      if (m.over !== undefined && m.over !== null) {
        if (!Array.isArray(m.over) || m.over.length === 0) {
          throw new IrError(`${mctx}.over must be a non-empty list of participant ids`)
        }
        over = m.over.map((v) => {
          if (typeof v !== 'string' || !participantIds.has(v)) {
            throw new IrError(`${mctx}.over references unknown participant "${v}"`)
          }
          return v
        })
      } else if (prevMessage) {
        over = [prevMessage.from, prevMessage.to]
      } else {
        throw new IrError(`${mctx}: note has no "over" and no preceding message to infer it from`)
      }
      return { rowType: 'note', text, over }
    }

    if (m.self !== undefined) {
      const participant = requireStr(m, 'self', mctx)
      if (!participantIds.has(participant)) throw new IrError(`${mctx}.self references unknown participant "${participant}"`)
      const label = optStr(m, 'label', mctx) ?? ''
      const kind = validateSeqKind(m.kind, mctx, { required: false })
      return { rowType: 'self', participant, label, kind }
    }

    const from = requireStr(m, 'from', mctx)
    const to = requireStr(m, 'to', mctx)
    if (!participantIds.has(from)) throw new IrError(`${mctx}.from references unknown participant "${from}"`)
    if (!participantIds.has(to)) throw new IrError(`${mctx}.to references unknown participant "${to}"`)
    if (from === to) throw new IrError(`${mctx}: from and to must differ — use "self:" for a self-message`)
    const label = optStr(m, 'label', mctx) ?? ''
    const kind = validateSeqKind(m.kind, mctx, { required: true })
    const rec = { rowType: 'message', from, to, label, kind }
    prevMessage = rec
    return rec
  })
}

// --- budgets / layout / draw / verify --------------------------------------

export function budgetWarnings(ir) {
  return sequenceBudgetWarnings(ir)
}

/** A fixed grid (no elk, no orientation choice) — fully deterministic. */
export async function layout(ir) {
  return layoutSequence(ir)
}

export function draw(geo, ir) {
  return drawSequenceInner(ir, geo)
}

/** The eight sequence-specific rows of verify-sequence.mjs (its ids kept);
 * the dispatcher appends the shared svg/a11y/font/stroke/color/grid/scale
 * rows after them. */
export function verify(geo, ir, { column, svg, rendered } = {}) {
  const renderResult = rendered ?? { svg, width: geo.width, height: geo.height, scroll: false, layout: { geo: geo.geo } }
  const own = new Set(SEQUENCE_OWN_ROWS)
  return verifySequence(ir, renderResult, { column }).checks.filter((c) => own.has(c.name))
}

export const doc = {
  purpose: 'time-ordered messages between participants (API traces, protocols, call order)',
  whenToUse: 'when the reader must follow *who calls whom in what order*; not for structure (use diagram) or branching logic. Budgets: participants ≤ 6, rows ≤ 16, message label ≤ 16 chars — guidance, over-budget figures still render with data-warn.',
  irExample: `id: checkout
type: sequence
title: チェックアウトの呼び出し順
caption: 決済は同期、通知は非同期
participants:
  - id: ui
    label: 画面
  - id: api
    label: Order API
    tone: ts
  - id: pay
    label: 決済
messages:
  - from: ui
    to: api
    kind: sync
    label: 注文確定
  - from: api
    to: pay
    kind: sync
    label: 与信
  - from: pay
    to: api
    kind: reply
    label: OK
  - note: ここで在庫を引き当てる
    over: [api]
  - self: api
    label: 通知を積む
  - from: api
    to: ui
    kind: reply
    label: 完了
`,
  rows: SEQUENCE_OWN_ROWS,
}
