// old-sequence.mjs — a faithful JS port of explain-pages'
// packages/core/src/parseSequence.ts (docs/authoring.md ":::sequence" DSL).
// Tolerant like old-diagram.mjs: unrecognized lines are warnings, not
// thrown errors.

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
