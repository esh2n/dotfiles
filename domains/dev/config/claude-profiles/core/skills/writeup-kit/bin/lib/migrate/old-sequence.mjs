// old-sequence.mjs — a faithful JS port of explain-pages'
// packages/core/src/parseSequence.ts (docs/authoring.md ":::sequence" DSL).
// Tolerant like old-diagram.mjs: unrecognized lines are warnings, not
// thrown errors.
//
// Also carries the old DSL -> writeup-kit `type: sequence` IR mapping
// (toSequenceIR) and that IR's YAML serializer (sequenceIrToYaml, the
// sequence counterpart of util.mjs's irToYaml) — kept alongside the parser
// rather than in directives.mjs so the DSL's own shape (dashed = reply,
// `note over <one participant>`) and its IR mapping stay next to each
// other.

import { yamlScalar } from './util.mjs'

const PARTICIPANT_PATTERN = /^participant\s+(\w+)\[([^\]]*)\]$/
const NOTE_PATTERN = /^note over\s+(\w+)\s*:\s*(.*)$/
const MESSAGE_PATTERN = /^(\w+)\s*(-->|->)\s*(\w+)\s*:\s*(.*?)\s*(?:\{([^}]*)\})?$/

/**
 * @param {string} raw the directive body text
 * @returns {{participants:object[], events:object[], warnings:string[]}}
 */
export function parseOldSequence(raw) {
  const participants = []
  const events = []
  const warnings = []

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    const participantMatch = PARTICIPANT_PATTERN.exec(line)
    if (participantMatch) {
      participants.push({ id: participantMatch[1], label: participantMatch[2] })
      continue
    }

    const noteMatch = NOTE_PATTERN.exec(line)
    if (noteMatch) {
      events.push({ kind: 'note', over: noteMatch[1], text: noteMatch[2] })
      continue
    }

    const messageMatch = MESSAGE_PATTERN.exec(line)
    if (messageMatch) {
      let tone = 'default'
      if (messageMatch[5]) {
        const toneMatch = /tone=(\w+)/.exec(messageMatch[5])
        if (toneMatch && (toneMatch[1] === 'success' || toneMatch[1] === 'danger')) tone = toneMatch[1]
      }
      events.push({
        kind: 'message',
        from: messageMatch[1],
        to: messageMatch[3],
        label: messageMatch[4],
        dashed: messageMatch[2] === '-->',
        tone,
      })
      continue
    }

    warnings.push(`sequence: unrecognized line skipped: ${line}`)
  }

  return { participants, events, warnings }
}

// --- old DSL -> `type: sequence` IR -------------------------------------

/**
 * Map parseOldSequence()'s result to a candidate `type: sequence` IR
 * (bin/lib/ir.mjs's raw/pre-validation shape — `note`/`self`/`from`+`to`
 * keys, not yet normalized). Every old-DSL message becomes a plain
 * `from`/`to` row: `->` (solid) maps to `kind: sync`, `-->` (dashed) to
 * `kind: reply` — the old DSL's only two arrow styles map cleanly onto two
 * of the IR's three kinds (there is no old-DSL syntax for `async`, and none
 * for a self-message either, so a migrated candidate never emits either).
 * A `note over <participant>` line always names exactly one participant, so
 * `over` is always that single id — never inferred from a preceding
 * message the way ir.mjs's schema allows when `over` is omitted, since the
 * old DSL is never ambiguous about which participant a note belongs to.
 *
 * @param {{participants:object[], events:object[]}} parsed parseOldSequence()'s result
 * @param {{id: string, title: string, caption: string}} ctx
 */
export function toSequenceIR(parsed, { id, title, caption }) {
  const participants = parsed.participants.map((p) => ({ id: p.id, label: p.label }))
  const messages = parsed.events.map((ev) => (
    ev.kind === 'note'
      ? { note: ev.text, over: [ev.over] }
      : { from: ev.from, to: ev.to, label: ev.label, kind: ev.dashed ? 'reply' : 'sync' }
  ))
  return { id, type: 'sequence', title, caption, participants, messages }
}

/** Serialize a candidate `type: sequence` IR (toSequenceIR()'s shape, or a
 * normalized ir.mjs one — both use the same `note`/`self`/`from`+`to` keys)
 * into the YAML-lite shape the renderer accepts, for embedding a
 * fallen-back sequence's IR into its fallback figure's
 * `<script type="text/x-writeup-diagram">` (mirrors util.mjs's irToYaml()
 * for the node/edge diagram shape). */
export function sequenceIrToYaml(ir) {
  const lines = []
  lines.push(`id: ${yamlScalar(ir.id)}`)
  lines.push('type: sequence')
  lines.push(`title: ${yamlScalar(ir.title)}`)
  if (ir.caption !== undefined && ir.caption !== null && ir.caption !== '') {
    lines.push(`caption: ${yamlScalar(ir.caption)}`)
  }

  const participants = ir.participants || []
  lines.push(participants.length ? 'participants:' : 'participants: []')
  for (const p of participants) {
    lines.push(`- id: ${yamlScalar(p.id)}`)
    lines.push(`  label: ${yamlScalar(p.label)}`)
  }

  const messages = ir.messages || []
  if (messages.length) {
    lines.push('messages:')
    for (const m of messages) {
      if (m.note !== undefined) {
        lines.push(`- note: ${yamlScalar(m.note)}`)
        if (m.over && m.over.length) lines.push(`  over: [${m.over.map(yamlScalar).join(', ')}]`)
      } else if (m.self !== undefined) {
        lines.push(`- self: ${yamlScalar(m.self)}`)
        if (m.label) lines.push(`  label: ${yamlScalar(m.label)}`)
        if (m.kind) lines.push(`  kind: ${yamlScalar(m.kind)}`)
      } else {
        lines.push(`- from: ${yamlScalar(m.from)}`)
        lines.push(`  to: ${yamlScalar(m.to)}`)
        if (m.label) lines.push(`  label: ${yamlScalar(m.label)}`)
        lines.push(`  kind: ${yamlScalar(m.kind ?? 'sync')}`)
      }
    }
  }

  return lines.join('\n')
}
