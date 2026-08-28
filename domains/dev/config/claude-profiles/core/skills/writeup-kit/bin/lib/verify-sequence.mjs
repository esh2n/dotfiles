// Machine verification of a rendered sequence diagram (bin/lib/sequence.mjs)
// against the sequence contract described alongside SEQUENCE_LIMITS in
// bin/lib/ir.mjs: participant/message budgets, label length, every
// from/to/self/over reference resolving, arrows staying horizontal at the
// lifeline they touch, every drawn coordinate on the 4px grid, labels/notes
// clearing each other and any lifeline they don't belong to by 6px, and the
// same font-size/stroke/color/svg-shape/a11y rules diagram.mjs's figures
// follow (kept as small standalone checks here rather than importing
// verify-diagram.mjs's private helpers, since those read diagram-specific
// geometry — see verify-diagram.mjs's own doc comment for why geometry
// checks read layout.geo instead of re-parsing the SVG).
import { SEQUENCE_LIMITS } from './ir.mjs'

const LABEL_CLEARANCE = 6
const ALLOWED_FONT_SIZES = new Set([13, 11])
const ALLOWED_STROKE_WIDTHS = new Set([1, 1.5])
const GRID = 4

// --- geometry helpers ----------------------------------------------------

/** Euclidean distance between two axis-aligned rects (0 if they overlap). */
function rectDistance(a, b) {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0)
  return Math.hypot(dx, dy)
}

/** Distance between a rect and a vertical line segment (a lifeline). */
function rectLineDistance(rect, line) {
  const dx = line.x < rect.x ? rect.x - line.x : line.x > rect.x + rect.width ? line.x - (rect.x + rect.width) : 0
  const lineLo = Math.min(line.yTop, line.yBottom)
  const lineHi = Math.max(line.yTop, line.yBottom)
  const rectLo = rect.y
  const rectHi = rect.y + rect.height
  const dy = lineHi < rectLo ? rectLo - lineHi : lineLo > rectHi ? lineLo - rectHi : 0
  return Math.hypot(dx, dy)
}

/** The set of participant ids a row is expected to sit near — excluded from
 * that row's own lifeline-clearance check (a message necessarily touches
 * its from/to lifelines; a note deliberately spans the ones in `over`). */
function ownParticipants(row) {
  if (row.type === 'message') return new Set([row.from, row.to])
  if (row.type === 'self') return new Set([row.participant])
  return new Set(row.over)
}

/** Every row's label-like rect (a message/self label, or a note's own box —
 * a note has no separate "label", the box itself is the text container). */
function labelRects(rows) {
  const out = []
  for (const row of rows) {
    if (row.type === 'note') out.push({ row, rect: { x: row.x, y: row.y, width: row.width, height: row.height } })
    else if (row.label) out.push({ row, rect: row.label })
  }
  return out
}

// --- checks --------------------------------------------------------------

function checkParticipantCount(ctx) {
  const n = ctx.ir.participants.length
  const ok = n <= SEQUENCE_LIMITS.maxParticipants
  return {
    ok,
    detail: `${n} participant(s) (limit ${SEQUENCE_LIMITS.maxParticipants})`,
    hint: ok ? undefined : `split the sequence: move some participants into a second figure (${n} > ${SEQUENCE_LIMITS.maxParticipants})`,
  }
}

function checkMessageCount(ctx) {
  const n = ctx.ir.messages.length
  const ok = n <= SEQUENCE_LIMITS.maxMessages
  return {
    ok,
    detail: `${n} row(s) (limit ${SEQUENCE_LIMITS.maxMessages})`,
    hint: ok ? undefined : `split after message ${SEQUENCE_LIMITS.maxMessages}`,
  }
}

function checkLabelLength(ctx) {
  const offenders = []
  ctx.ir.messages.forEach((m, i) => {
    if (m.rowType !== 'message' && m.rowType !== 'self') return
    if (m.label && [...m.label].length > SEQUENCE_LIMITS.maxLabelLen) {
      offenders.push(`shorten label of message ${i + 1} ("${m.label}", ${[...m.label].length} > ${SEQUENCE_LIMITS.maxLabelLen})`)
    }
  })
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every message/self label is within the 16-char budget',
    hint: offenders.length ? offenders.join('; ') : undefined,
  }
}

function checkReferencesExist(ctx) {
  const ids = new Set(ctx.ir.participants.map((p) => p.id))
  const offenders = []
  ctx.ir.messages.forEach((m, i) => {
    if (m.rowType === 'message') {
      if (!ids.has(m.from)) offenders.push(`messages[${i}].from "${m.from}" is not a participant`)
      if (!ids.has(m.to)) offenders.push(`messages[${i}].to "${m.to}" is not a participant`)
    } else if (m.rowType === 'self') {
      if (!ids.has(m.participant)) offenders.push(`messages[${i}].self "${m.participant}" is not a participant`)
    } else {
      for (const p of m.over) if (!ids.has(p)) offenders.push(`messages[${i}].over "${p}" is not a participant`)
    }
  })
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every message/self/over reference resolves to a declared participant',
    hint: offenders.length ? offenders.join('; ') : undefined,
  }
}

function checkArrowsHorizontal(ctx) {
  const offenders = []
  for (const row of ctx.geo.rows) {
    if (row.type === 'note') continue
    const pts = row.path
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if (a.x !== b.x && a.y !== b.y) offenders.push(`${row.type}[${row.index}] segment ${i} is diagonal`)
    }
    const last = pts[pts.length - 1]
    const beforeLast = pts[pts.length - 2]
    if (last.y !== beforeLast.y) offenders.push(`${row.type}[${row.index}] arrowhead segment is not horizontal`)
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? offenders.join('; ') : 'every arrow (and a self-message loop\'s in/out legs) is axis-aligned and horizontal at the lifeline',
    hint: offenders.length ? offenders.join('; ') : undefined,
  }
}

function checkGrid(ctx) {
  const offenders = []
  const check = (v, label) => { if (v % GRID !== 0) offenders.push(`${label}=${v}`) }
  for (const p of ctx.geo.participants) {
    check(p.x, `participant "${p.id}".x`); check(p.y, `participant "${p.id}".y`)
    check(p.width, `participant "${p.id}".width`); check(p.height, `participant "${p.id}".height`)
  }
  for (const row of ctx.geo.rows) {
    if (row.type === 'note') {
      check(row.x, `note[${row.index}].x`); check(row.y, `note[${row.index}].y`)
      check(row.width, `note[${row.index}].width`); check(row.height, `note[${row.index}].height`)
      continue
    }
    for (const pt of row.path) { check(pt.x, `${row.type}[${row.index}].x`); check(pt.y, `${row.type}[${row.index}].y`) }
    if (row.label) { check(row.label.x, `${row.type}[${row.index}].label.x`); check(row.label.y, `${row.type}[${row.index}].label.y`) }
  }
  const uniq = [...new Set(offenders)]
  return {
    ok: uniq.length === 0,
    detail: uniq.length ? `off-grid: ${uniq.slice(0, 6).join(', ')}${uniq.length > 6 ? ', …' : ''}` : 'every coordinate/size sits on the 4px grid',
    hint: uniq.length ? 'run every drawn coordinate through snap4()/snapUp4() before writing it to the svg' : undefined,
  }
}

function checkLabelClearance(ctx) {
  const labels = labelRects(ctx.geo.rows)
  const offenders = []
  for (let i = 0; i < labels.length; i++) {
    const { row, rect } = labels[i]
    let worst = Infinity
    let against = null
    for (let j = 0; j < labels.length; j++) {
      if (i === j) continue
      const d = rectDistance(rect, labels[j].rect)
      if (d < worst) { worst = d; against = `${labels[j].row.type}[${labels[j].row.index}]` }
    }
    const own = ownParticipants(row)
    for (const ll of ctx.geo.lifelines) {
      if (own.has(ll.id)) continue
      const d = rectLineDistance(rect, ll)
      if (d < worst) { worst = d; against = `lifeline "${ll.id}"` }
    }
    if (worst < LABEL_CLEARANCE) offenders.push({ row, worst, against })
  }
  const ok = offenders.length === 0
  return {
    ok,
    detail: ok
      ? 'every label/note clears every other label and unrelated lifeline by ≥6px'
      : offenders.map((o) => `${o.row.type}[${o.row.index}] is ${o.worst.toFixed(1)}px from ${o.against}`).join('; '),
    hint: ok ? undefined : offenders.map((o) => `shorten or reposition ${o.row.type}[${o.row.index}] (crowds ${o.against})`).join('; '),
  }
}

function checkFontSizes(ctx) {
  const sizes = [...ctx.svg.matchAll(/font-size="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const bad = [...new Set(sizes.filter((s) => !ALLOWED_FONT_SIZES.has(s)))]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `font-size(s) outside {13,11}: ${bad.join(', ')}` : 'every font-size is 13 or 11',
    hint: bad.length ? 'draw text at FONT_SIZE (13, participant labels) or EDGE_LABEL_SIZE (11, message/note text), not an ad-hoc size' : undefined,
  }
}

function checkStrokeWidths(ctx) {
  const widths = [...ctx.svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const bad = [...new Set(widths.filter((w) => !ALLOWED_STROKE_WIDTHS.has(w)))]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `stroke-width outside {1,1.5}: ${bad.join(', ')}` : 'every stroke-width is 1 or 1.5',
    hint: bad.length ? 'use the kit\'s border-width scale (1/1.5)' : undefined,
  }
}

function checkNoHexColors(ctx) {
  const svg = ctx.svg
  const withoutRefs = svg.replace(/url\(#[^)]*\)/g, '').replace(/#wu-d-[^"'\s)]*/g, '')
  const hasHex = /#[0-9a-fA-F]{3,8}\b/.test(withoutRefs)
  const hasRgb = /\brgb\(/i.test(svg)
  const ok = !hasHex && !hasRgb
  const found = [hasHex && 'a hex color', hasRgb && 'rgb()'].filter(Boolean).join(' and ')
  return {
    ok,
    detail: ok ? 'no hex color or rgb() in the svg — every color routes through currentColor/var(--wu-*)' : `found ${found} in the svg`,
    hint: ok ? undefined : 'replace the literal color with currentColor or a var(--wu-*) token',
  }
}

function checkSingleFiniteSvg(ctx) {
  const svgOpenCount = (ctx.svg.match(/<svg[\s>]/g) || []).length
  const hasBadValue = /\b(NaN|Infinity|undefined)\b/.test(ctx.svg)
  const ok = svgOpenCount === 1 && !hasBadValue
  const problems = []
  if (svgOpenCount !== 1) problems.push(`found ${svgOpenCount} <svg> elements, expected 1`)
  if (hasBadValue) problems.push('markup contains NaN/Infinity/undefined')
  return {
    ok,
    detail: ok ? 'exactly one <svg>, no non-finite values in the markup' : problems.join('; '),
    hint: ok ? undefined : problems.join('; '),
  }
}

function checkA11y(ctx) {
  const svg = ctx.svg
  const idPrefix = `wu-d-${ctx.ir.id}-`
  const problems = []
  if (!/^<svg\b[^>]*\brole="img"/.test(svg)) problems.push('svg root missing role="img"')
  const firstTag = /<svg[^>]*>(<[a-zA-Z]+)/.exec(svg)
  if (!firstTag || firstTag[1] !== '<title') problems.push('first child of <svg> is not <title>')
  const desc = /<desc[^>]*>([^<]*)<\/desc>/.exec(svg)
  if (!desc || !desc[1].trim()) problems.push('<desc> missing or empty')
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  const badIds = ids.filter((id) => !id.startsWith(idPrefix))
  if (badIds.length) problems.push(`id(s) not prefixed "${idPrefix}": ${badIds.slice(0, 4).join(', ')}`)
  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ') : 'role="img", <title> first child, non-empty <desc>, ids all prefixed correctly',
    hint: problems.length ? `fix svg generation: ${problems.join('; ')}` : undefined,
  }
}

// --- driver ----------------------------------------------------------------

const CHECK_DEFS = [
  [1, 'participant-count', checkParticipantCount],
  [2, 'message-count', checkMessageCount],
  [3, 'label-length', checkLabelLength],
  [4, 'references-exist', checkReferencesExist],
  [5, 'arrows-horizontal', checkArrowsHorizontal],
  [6, 'rows-grid', checkGrid],
  [7, 'label-clearance', checkLabelClearance],
  [8, 'font-size', checkFontSizes],
  [9, 'stroke-width', checkStrokeWidths],
  [10, 'no-hex-colors', checkNoHexColors],
  [11, 'single-finite-svg', checkSingleFiniteSvg],
  [12, 'a11y', checkA11y],
]

/**
 * Verify a rendered sequence diagram (bin/lib/sequence.mjs's
 * renderSequenceDiagram() output) against the sequence contract.
 *
 * @param {object} ir validated `type: sequence` IR from ir.mjs
 * @param {object} renderResult renderSequenceDiagram()'s return — must carry
 *   `layout.geo` (participants/lifelines/rows geometry)
 * @returns {{ok: boolean, checks: Array<{id:number, name:string, ok:boolean, detail:string, hint?:string}>}}
 */
export function verifySequence(ir, renderResult) {
  if (!renderResult || !renderResult.layout || !renderResult.layout.geo) {
    throw new Error('verifySequence requires renderResult.layout.geo (render with sequence.mjs, or build one with the same shape)')
  }
  const ctx = { ir, renderResult, geo: renderResult.layout.geo, svg: renderResult.svg }
  const checks = CHECK_DEFS.map(([id, name, fn]) => {
    let result
    try {
      result = fn(ctx)
    } catch (e) {
      result = { ok: false, detail: `check threw: ${e.message}`, hint: 'internal verifier error — check the renderResult/ir shape passed in' }
    }
    return { id, name, ok: result.ok, detail: result.detail, hint: result.hint }
  })
  return { ok: checks.every((c) => c.ok), checks }
}
