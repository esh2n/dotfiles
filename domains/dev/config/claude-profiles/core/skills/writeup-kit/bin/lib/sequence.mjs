// Lays out a validated `type: sequence` IR (see bin/lib/ir.mjs) and draws it
// as an inline SVG, mirroring the writeup-kit skin diagram.mjs already
// established: currentColor strokes, ids prefixed wu-d-<id>-, tone fill via
// data-tone (the kit's rect[data-tone] CSS already applies to any figure
// rect, not just diagram.mjs's), and the CJK/ASCII textWidth estimate.
//
// Deliberately NOT elk-based: participants ≤6 and messages ≤16 (contract
// budgets — see SEQUENCE_LIMITS in ir.mjs) make a fixed grid layout
// (participants on a row, messages on 40px rows) both sufficient and fully
// deterministic — no layout engine needed. Column x / row y positions are
// snapped to the 4px grid the same way diagram.mjs's layoutOnce()/draw() do.
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

/**
 * Participant box widths (from label width, like diagram.mjs's nodeSize())
 * and their center-x positions. Adjacent spacing is the wider of the two
 * neighboring boxes plus a fixed 24px, floored at 120px — generous enough
 * that a message label between two adjacent columns always has room.
 */
function layoutColumns(participants) {
  const widths = participants.map((p) => (
    snapUp4(Math.max(MIN_BOX_W, Math.ceil(textWidth(p.label, FONT_SIZE)) + NODE_PAD_X * 2))
  ))
  const raw = [MARGIN_X + widths[0] / 2]
  for (let i = 1; i < participants.length; i++) {
    const gap = Math.max(MIN_GAP, Math.max(widths[i - 1], widths[i]) + GAP_EXTRA)
    raw.push(raw[i - 1] + gap)
  }
  return { widths, centers: raw.map(snap4) }
}

function messageLabelBox(text, midX, lineY) {
  const w = Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 8
  return { x: snap4(midX - w / 2), y: snap4(lineY - LABEL_H - 4), width: w, height: LABEL_H, text }
}

function selfLabelBox(text, leftX, midY) {
  const w = Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + 8
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
  const { widths, centers } = layoutColumns(participants)
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
      const x1 = boxes[indexOf.get(m.from)].centerX
      const x2 = boxes[indexOf.get(m.to)].centerX
      const path = [{ x: x1, y }, { x: x2, y }]
      const label = m.label ? messageLabelBox(m.label, (x1 + x2) / 2, y) : null
      return { type: 'message', index: i, from: m.from, to: m.to, kind: m.kind, y, path, label }
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
    const naturalW = (rightX - leftX) + 32
    const textW = Math.ceil(textWidth(m.text, EDGE_LABEL_SIZE)) + 16
    const width = snapUp4(Math.max(naturalW, textW, MIN_BOX_W))
    const cx = (leftX + rightX) / 2
    const x = snap4(cx - width / 2)
    const noteY = snap4(y + (ROW_H - NOTE_H) / 2)
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
      parts.push(`<text id="${uid}-${row.type}-${row.index}-label" x="${row.label.x}" y="${snap4(row.label.y + 11)}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(row.label.text)}</text>`)
    }
  }

  const svgOpen = `<svg role="img" aria-labelledby="${uid}-title ${uid}-desc" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  return `${svgOpen}${parts.join('')}</svg>`
}

/**
 * Render a validated sequence IR to an SVG string. Same scale/scroll
 * contract as diagram.mjs's renderDiagram(): shrink to `column` down to
 * MIN_SCALE (0.78), then fall back to `scroll: true` (native size) below
 * that — the returned shape (`svg`/`width`/`height`/`scaled`/`scroll`/
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
