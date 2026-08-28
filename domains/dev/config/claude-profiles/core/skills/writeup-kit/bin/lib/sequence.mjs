// Lays out a validated `type: sequence` IR (see bin/lib/ir.mjs) and draws it
// as an inline SVG, mirroring the writeup-kit skin diagram.mjs already
// established: currentColor strokes, ids prefixed wu-d-<id>-, tone fill via
// data-tone (the kit's rect[data-tone] CSS already applies to any figure
// rect, not just diagram.mjs's), and the CJK/ASCII textWidth estimate.
//
// Deliberately NOT elk-based: a sequence is a fixed grid (participants on
// a row, messages on 40px rows), which is both sufficient and fully
// deterministic — no layout engine needed. The budgets (participants ≤6,
// messages ≤16, label ≤16 chars — SEQUENCE_LIMITS in ir.mjs) are guidance
// reported as warnings, not layout inputs: the column gaps grow to fit the
// widest label drawn between two lifelines (see layoutColumns()), so a
// long label widens its gap instead of running into the neighbouring
// lifeline, and the resulting width goes through the same scale/scroll
// decision (COLUMN / MIN_SCALE) as a node/edge diagram. Column x / row y
// positions are snapped to the 4px grid the same way diagram.mjs's
// layoutOnce()/draw() do.
import { textWidth, snap4, snapUp4, COLUMN, MIN_SCALE, FONT_SIZE, EDGE_LABEL_SIZE, NODE_PAD_X } from './diagram.mjs'

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// --- layout constants (all multiples of 4 — see checkRowsGrid in
// verify-sequence.mjs) ------------------------------------------------------
const PARTICIPANT_TOP = 8
const PARTICIPANT_H = 36
const MIN_BOX_W = 64
const MIN_GAP = 120
const GAP_EXTRA = 24
// Clearance a message/self label or a note keeps from a lifeline it does
// not belong to (> verify-sequence.mjs's LABEL_CLEARANCE of 6, with room
// for the ≤2px snap4 shift of a centered rect).
const LABEL_GAP_PAD = 12
const MARGIN_X = 24
const ROW_H = 40
const ROW_TOP_PAD = 24
const ROW_BOTTOM_PAD = 24
const SELF_LOOP_W = 40
const SELF_LOOP_H = 16
const NOTE_H = 24
const LABEL_H = 14

const EDGE_KIND_STYLE = {
  sync: { dash: null, marker: 'solid' },
  async: { dash: null, marker: 'open' },
  reply: { dash: '5 4', marker: 'open' },
}

// --- column layout -----------------------------------------------------

const labelWidth = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 8

/** A note box is as wide as its `over` span plus 32px, or its text plus
 * 16px, whichever is larger (floored at MIN_BOX_W). `span` is the distance
 * between the leftmost and rightmost `over` lifelines (0 for one). */
const noteWidth = (text, span) => snapUp4(Math.max(span + 32, Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 16, MIN_BOX_W))

/**
 * Participant box widths (from label width, like diagram.mjs's nodeSize())
 * and their center-x positions. The gap between two adjacent columns starts
 * at the wider of the two boxes plus 24px, floored at 120px, and is then
 * widened by whatever is drawn across it:
 *
 * - a message label is centered on its arrow, so the arrow's span (the
 *   gaps between its from/to columns) must hold the label plus
 *   LABEL_GAP_PAD on each side — the shortfall is spread evenly over the
 *   gaps the arrow crosses;
 * - a self-message label sits to the right of its loop, so the gap to the
 *   next column must hold loop + label + pad;
 * - a note wider than its `over` span overhangs both sides equally, so the
 *   gap just outside each end must hold the overhang plus pad (a note over
 *   the first column instead pushes the whole diagram right).
 *
 * Every gap is a multiple of 4, so the centers land on the grid and the
 * spans computed here are exactly the ones layoutSequence() draws.
 */
function layoutColumns(participants, messages) {
  const n = participants.length
  const indexOf = new Map(participants.map((p, i) => [p.id, i]))
  const widths = participants.map((p) => (
    snapUp4(Math.max(MIN_BOX_W, Math.ceil(textWidth(p.label, FONT_SIZE)) + NODE_PAD_X * 2))
  ))
  const gaps = []
  for (let i = 1; i < n; i++) gaps.push(Math.max(MIN_GAP, Math.max(widths[i - 1], widths[i]) + GAP_EXTRA))
  const spanOf = (lo, hi) => gaps.slice(lo, hi).reduce((a, b) => a + b, 0)
  const widen = (lo, hi, need) => {
    if (hi <= lo) return
    const span = spanOf(lo, hi)
    if (span >= need) return
    const share = snapUp4((need - span) / (hi - lo))
    for (let i = lo; i < hi; i++) gaps[i] += share
  }

  for (const m of messages) {
    if (m.rowType === 'message' && m.label) {
      const a = indexOf.get(m.from), b = indexOf.get(m.to)
      widen(Math.min(a, b), Math.max(a, b), labelWidth(m.label) + LABEL_GAP_PAD * 2)
    } else if (m.rowType === 'self' && m.label) {
      const i = indexOf.get(m.participant)
      if (i < n - 1) gaps[i] = Math.max(gaps[i], snapUp4(SELF_LOOP_W + 8 + labelWidth(m.label) + LABEL_GAP_PAD))
    }
  }
  // Notes last: their overhang depends on the span the message pass
  // produced, and widening an outer gap never shrinks another note's span.
  let leftOverhang = 0
  for (const m of messages) {
    if (m.rowType !== 'note') continue
    const idx = m.over.map((id) => indexOf.get(id))
    const lo = Math.min(...idx), hi = Math.max(...idx)
    const overhang = Math.ceil((noteWidth(m.text, spanOf(lo, hi)) - spanOf(lo, hi)) / 2)
    if (overhang <= 0) continue
    if (lo > 0) gaps[lo - 1] = Math.max(gaps[lo - 1], snapUp4(overhang + LABEL_GAP_PAD))
    else leftOverhang = Math.max(leftOverhang, overhang)
    if (hi < n - 1) gaps[hi] = Math.max(gaps[hi], snapUp4(overhang + LABEL_GAP_PAD))
  }

  const centers = [snap4(MARGIN_X + Math.max(widths[0] / 2, leftOverhang + 8))]
  for (let i = 1; i < n; i++) centers.push(centers[i - 1] + gaps[i - 1])
  return { widths, centers }
}

function messageLabelBox(text, midX, lineY) {
  const w = labelWidth(text)
  return { x: snap4(midX - w / 2), y: snap4(lineY - LABEL_H - 4), width: w, height: LABEL_H, text }
}

function selfLabelBox(text, leftX, midY) {
  const w = labelWidth(text)
  return { x: snap4(leftX), y: snap4(midY - LABEL_H / 2), width: w, height: LABEL_H, text }
}

/**
 * Lay out a validated sequence IR (bin/lib/ir.mjs's `type: sequence` shape)
 * into pixel geometry: participant boxes, dashed lifelines, and one row per
 * message/note/self entry. Returns `{width, height, geo}` — `geo` is read
 * both by draw() below and by verify-sequence.mjs's checks, the same split
 * diagram.mjs/verify-diagram.mjs use.
 */
export function layoutSequence(ir) {
  const { participants, messages } = ir
  const { widths, centers } = layoutColumns(participants, messages)
  const indexOf = new Map(participants.map((p, i) => [p.id, i]))

  const boxes = participants.map((p, i) => {
    const width = widths[i]
    const x = snap4(centers[i] - width / 2)
    return { id: p.id, label: p.label, tone: p.tone, x, y: PARTICIPANT_TOP, width, height: PARTICIPANT_H, centerX: centers[i] }
  })

  const rowTop = PARTICIPANT_TOP + PARTICIPANT_H
  const firstRowY = snap4(rowTop + ROW_TOP_PAD)
  const rowYs = messages.map((_, i) => firstRowY + i * ROW_H)
  const lastRowY = rowYs.length ? rowYs[rowYs.length - 1] : rowTop
  const lifelineBottom = snap4(lastRowY + ROW_BOTTOM_PAD)

  const lifelines = boxes.map((b) => ({ id: b.id, x: b.centerX, yTop: b.y + b.height, yBottom: lifelineBottom }))

  const rows = messages.map((m, i) => {
    const y = rowYs[i]
    if (m.rowType === 'message') {
      const a = indexOf.get(m.from), b = indexOf.get(m.to)
      const x1 = boxes[a].centerX
      const x2 = boxes[b].centerX
      const path = [{ x: x1, y }, { x: x2, y }]
      const label = m.label ? messageLabelBox(m.label, (x1 + x2) / 2, y) : null
      // Lifelines strictly between from and to: the arrow crosses them
      // regardless, and the label (centered on the arrow) may sit over one
      // — draw() masks the lifeline under such a label, and
      // verify-sequence.mjs's lifeline-clearance row skips exactly these.
      const crosses = participants.slice(Math.min(a, b) + 1, Math.max(a, b)).map((p) => p.id)
      return { type: 'message', index: i, from: m.from, to: m.to, kind: m.kind, y, path, label, crosses }
    }
    if (m.rowType === 'self') {
      const x = boxes[indexOf.get(m.participant)].centerX
      const loopRight = x + SELF_LOOP_W
      const path = [{ x, y }, { x: loopRight, y }, { x: loopRight, y: y + SELF_LOOP_H }, { x, y: y + SELF_LOOP_H }]
      const label = m.label ? selfLabelBox(m.label, loopRight + 8, y + SELF_LOOP_H / 2) : null
      return { type: 'self', index: i, participant: m.participant, kind: m.kind, y, path, label }
    }
    // note
    const xs = m.over.map((id) => boxes[indexOf.get(id)].centerX)
    const leftX = Math.min(...xs)
    const rightX = Math.max(...xs)
    const width = noteWidth(m.text, rightX - leftX)
    const cx = (leftX + rightX) / 2
    const x = snap4(cx - width / 2)
    // Centered on the row's y like an arrow would be (box y-12..y+12), so
    // it never reaches into the label zone (y-18..y-4) of the next row.
    const noteY = snap4(y - NOTE_H / 2)
    return { type: 'note', index: i, over: m.over, x, y: noteY, width, height: NOTE_H, text: m.text }
  })

  const rightMost = Math.max(
    ...boxes.map((b) => b.x + b.width),
    ...rows.map((r) => (r.type === 'note' ? r.x + r.width : r.type === 'self' ? r.path[1].x : 0)),
    ...rows.map((r) => (r.label ? r.label.x + r.label.width : 0)),
  )
  const width = snapUp4(rightMost + MARGIN_X)
  const height = snapUp4(lifelineBottom + 8)

  return { width, height, geo: { participants: boxes, lifelines, rows } }
}

// --- drawing -------------------------------------------------------------

function pathD(points) {
  return `M${points[0].x} ${points[0].y} ${points.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`
}

function drawSequenceSvg(ir, layout, { displayWidth, displayHeight }) {
  const { width, height, geo } = layout
  const uid = `wu-d-${ir.id}`
  const parts = []

  parts.push(`<title id="${uid}-title">${esc(ir.title)}</title>`)
  parts.push(`<desc id="${uid}-desc">${esc(ir.caption || ir.title)}</desc>`)

  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push(`<marker id="${uid}-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`)
  parts.push('</defs>')

  for (const ll of geo.lifelines) {
    parts.push(`<line id="${uid}-life-${ll.id}" x1="${ll.x}" y1="${ll.yTop}" x2="${ll.x}" y2="${ll.yBottom}" stroke="currentColor" stroke-width="1" stroke-dasharray="4 4"/>`)
  }

  for (const p of geo.participants) {
    parts.push(`<rect id="${uid}-p-${p.id}" data-tone="${esc(p.tone)}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="6" fill="none" stroke="currentColor" stroke-width="1"/>`)
    parts.push(`<text id="${uid}-p-${p.id}-label" x="${p.x + p.width / 2}" y="${p.y + p.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(p.label)}</text>`)
  }

  for (const row of geo.rows) {
    if (row.type === 'note') {
      parts.push(`<rect id="${uid}-note-${row.index}" data-tone="neutral" x="${row.x}" y="${row.y}" width="${row.width}" height="${row.height}" rx="4" fill="var(--wu-fig-tone-neutral)" stroke="currentColor" stroke-width="1"/>`)
      parts.push(`<text id="${uid}-note-${row.index}-label" x="${row.x + row.width / 2}" y="${row.y + row.height / 2 + EDGE_LABEL_SIZE * 0.35}" font-size="${EDGE_LABEL_SIZE}" text-anchor="middle" fill="currentColor">${esc(row.text)}</text>`)
      continue
    }
    const style = EDGE_KIND_STYLE[row.kind] ?? EDGE_KIND_STYLE.sync
    const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : ''
    parts.push(`<path id="${uid}-${row.type}-${row.index}" d="${pathD(row.path)}" fill="none" stroke="currentColor" stroke-width="1"${dash} marker-end="url(#${uid}-${style.marker})"/>`)
    if (row.label) {
      const l = row.label
      const masked = (row.crosses ?? []).some((id) => {
        const ll = geo.lifelines.find((x) => x.id === id)
        return ll && ll.x >= l.x && ll.x <= l.x + l.width
      })
      // A label lying over a lifeline its arrow crosses gets a surface-
      // colored mask so the dashed line does not run through the text.
      if (masked) parts.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" fill="var(--wu-surface)" stroke="none"/>`)
      parts.push(`<text id="${uid}-${row.type}-${row.index}-label" x="${l.x}" y="${snap4(l.y + 11)}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(l.text)}</text>`)
    }
  }

  const svgOpen = `<svg role="img" aria-labelledby="${uid}-title ${uid}-desc" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  return `${svgOpen}${parts.join('')}</svg>`
}

/**
 * Render a validated sequence IR to an SVG string. Same scale/scroll
 * contract as diagram.mjs's renderDiagram(): shrink to `column` (COLUMN,
 * 720) down to MIN_SCALE (0.78), then fall back to `scroll: true` (native
 * size) below that — the returned shape (`svg`/`width`/`height`/`scaled`/`scroll`/
 * `layout.geo`) is intentionally the same one renderDiagram() returns, so
 * diagram.mjs's wrapFigureHtml() and verify-diagram.mjs's dispatch can
 * treat a sequence render result as a drop-in.
 *
 * @param {object} ir validated `type: sequence` IR from ir.mjs
 * @param {{column?: number}} [opts]
 */
export function renderSequenceDiagram(ir, { column = COLUMN } = {}) {
  const layout = layoutSequence(ir)
  let scaled = false
  let scroll = false
  let displayWidth = layout.width
  let displayHeight = layout.height
  if (layout.width > column) {
    const scale = column / layout.width
    if (scale >= MIN_SCALE) { scaled = true; displayWidth = column; displayHeight = Math.round(layout.height * scale) }
    else scroll = true
  }
  const svg = drawSequenceSvg(ir, layout, { displayWidth, displayHeight })
  return { svg, width: layout.width, height: layout.height, scaled, scroll, layout: { geo: layout.geo } }
}
