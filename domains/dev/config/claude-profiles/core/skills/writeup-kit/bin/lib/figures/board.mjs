// `type: board` — equal-width columns of stacked cards, in two variants
// the diagram-pattern survey files as "Kanban" (#33) and "Story map" (#38):
//
//   - `variant: kanban` — columns are *states* (Todo / Doing / Done …),
//     the header band carries a WIP chip (`3/5` when the column has a
//     `limit`, `3` otherwise); a column over its limit gets the chip in the
//     accent color and a warning. A state census: no arrows, ever — if the
//     reader needs "what hands off to what" that is a process or swimlane.
//   - `variant: story-map` — the header row is the *activities* in story
//     order, under each a column of steps, and `cuts` are horizontal
//     release lines drawn across the whole grid between two rows, labelled
//     at the right (`MVP`, `Release 2` …). The riskiest card is the one
//     marked `emphasis` — the accent stays on the cut lines and that card.
//
// IR shape: `{ id, type:'board', title, caption, variant, columns, cuts }`.
//   - `columns` — `[{ id, label, limit?, cards }]` left → right (≤ 6
//     guidance); `limit` is a positive integer and kanban-only;
//   - `cards` — `[string | { label, emphasis?, tone? }]` top → bottom (≤ 8
//     per column guidance, label ≤ 14 chars guidance);
//   - `cuts` — story-map only: `[{ after, label }]`, `after` the 0-based
//     row index the line is drawn *below*.
//
// Layout is a fixed grid: every column is the same width, derived from the
// 720px COLUMN (and grown, still equal, when a wrapped card line or a
// header would not fit — the dispatcher then scales or scrolls); cards sit
// on shared rows (row r of every column at the same y, height from the
// tallest card in that row) with 8px gaps, so a cut line has a clean
// corridor between two rows. Card text is wrapped onto at most two lines.
// Every position is snapped to the 4px grid.
//
// Import rule (references/figure-types.md): _shared.mjs and diagram.mjs
// constants only — never ir.mjs / verify-diagram.mjs / figures/index.mjs.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, COLUMN, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'board'

export const limits = { maxColumns: 6, maxCardsPerColumn: 8, maxLabelLen: 14, maxEmphasis: 2 }

const VARIANTS = new Set(['kanban', 'story-map'])

// --- layout constants (multiples of 4 unless noted) ------------------------
const MARGIN = 16
const COL_GAP = 16
const COL_MAX_W = 200
const COL_MIN_W = 80
const HEADER_H = 40
const HEADER_PAD_X = 8
const HEADER_GAP = 8          // header band → first row
const CHIP_H = 24
const CHIP_PAD_X = 6          // chip text → chip border (not on grid: a size)
const CHIP_GAP = 8            // header label → chip
const CARD_PAD_X = 8
const CARD_PAD_Y = 8
const CARD_GAP = 8
const LINE_H = 16             // 11px text line pitch
const CUT_EXTRA = 28          // extra height a cut inserts between two rows
const CUT_LINE_DY = 28        // previous row bottom → cut line
const CUT_LABEL_DY = 20       // previous row bottom → cut label baseline
const CUT_LABEL_H = 14
const LANE_PAD_BOTTOM = 8

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeVariant(raw.variant, ctx)
  const columns = normalizeColumns(raw.columns, variant, ctx)
  const cuts = normalizeCuts(raw.cuts, variant, columns, ctx)
  const out = { id, type, title, caption, variant, columns }
  if (variant === 'story-map') out.cuts = cuts
  return out
}

function normalizeVariant(raw, ctx) {
  if (raw === undefined || raw === null) return 'kanban'
  if (typeof raw !== 'string' || !VARIANTS.has(raw)) throw new IrError(`${ctx}.variant must be kanban|story-map (got: ${JSON.stringify(raw)})`)
  return raw
}

function normalizeColumns(raw, variant, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.columns must be a non-empty list`)
  const seen = new Set()
  let total = 0
  const columns = raw.map((c, i) => {
    const cctx = `${ctx}.columns[${i}]`
    if (!isObj(c)) throw new IrError(`${cctx} must be a mapping`)
    const id = requireStr(c, 'id', cctx)
    if (seen.has(id)) throw new IrError(`${ctx}.columns: duplicate column id "${id}"`)
    seen.add(id)
    const label = requireStr(c, 'label', cctx)
    const limit = normalizeLimit(c.limit, variant, cctx)
    const cards = normalizeCards(c.cards, cctx)
    total += cards.length
    const col = { id, label, cards }
    if (limit !== undefined) col.limit = limit
    return col
  })
  if (total === 0) throw new IrError(`${ctx}.columns must hold at least one card in total`)
  return columns
}

function normalizeLimit(raw, variant, cctx) {
  if (raw === undefined || raw === null) return undefined
  if (variant !== 'kanban') throw new IrError(`${cctx}.limit is kanban-only (a story map has no WIP limit)`)
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) throw new IrError(`${cctx}.limit must be a positive integer (got: ${JSON.stringify(raw)})`)
  return raw
}

/** `[string | { label, emphasis?, tone? }]` → `[{ label, emphasis, tone }]`
 * so a normalized card re-normalizes unchanged. */
function normalizeCards(raw, cctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${cctx}.cards must be a list of card labels or { label, emphasis?, tone? }`)
  return raw.map((card, j) => {
    const kctx = `${cctx}.cards[${j}]`
    if (typeof card === 'string') {
      if (card.trim() === '') throw new IrError(`${kctx} must be a non-empty string`)
      return { label: card, emphasis: false, tone: 'neutral' }
    }
    if (!isObj(card)) throw new IrError(`${kctx} must be a string or a mapping`)
    return { label: requireStr(card, 'label', kctx), emphasis: validateBool(card, 'emphasis', kctx), tone: validateTone(card.tone, kctx) }
  })
}

function normalizeCuts(raw, variant, columns, ctx) {
  if (raw === undefined || raw === null) return []
  if (variant !== 'story-map') throw new IrError(`${ctx}.cuts is story-map-only (a kanban has no release cut)`)
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.cuts must be a list of { after, label }`)
  const rows = Math.max(...columns.map((c) => c.cards.length))
  const seen = new Set()
  const cuts = raw.map((cut, i) => {
    const kctx = `${ctx}.cuts[${i}]`
    if (!isObj(cut)) throw new IrError(`${kctx} must be a mapping`)
    const after = cut.after
    if (typeof after !== 'number' || !Number.isInteger(after) || after < 0 || after > rows - 1) {
      throw new IrError(`${kctx}.after must be a row index 0..${rows - 1} (the line is drawn below that row; got: ${JSON.stringify(after)})`)
    }
    if (seen.has(after)) throw new IrError(`${ctx}.cuts: two cuts after row ${after}`)
    seen.add(after)
    return { after, label: requireStr(cut, 'label', kctx) }
  })
  return cuts.sort((a, b) => a.after - b.after)
}

// --- budgets -------------------------------------------------------------

const allCards = (ir) => ir.columns.flatMap((c) => c.cards.map((card) => ({ column: c, card })))
const overLimit = (ir) => ir.columns.filter((c) => c.limit !== undefined && c.cards.length > c.limit)

export function budgetWarnings(ir) {
  const out = []
  const n = ir.columns.length
  if (n > limits.maxColumns) {
    out.push(budgetWarning('budget:columns', n, limits.maxColumns,
      `${n} column(s) (guidance ≤ ${limits.maxColumns})`,
      `merge states or split the board after column ${limits.maxColumns} ("${ir.columns[limits.maxColumns - 1].label}")`))
  }
  const tallest = ir.columns.reduce((a, b) => (b.cards.length > a.cards.length ? b : a))
  if (tallest.cards.length > limits.maxCardsPerColumn) {
    out.push(budgetWarning('budget:cards', tallest.cards.length, limits.maxCardsPerColumn,
      `column "${tallest.id}" holds ${tallest.cards.length} card(s) (guidance ≤ ${limits.maxCardsPerColumn})`,
      `drop or merge cards in "${tallest.id}" past the ${limits.maxCardsPerColumn}th, or move the rest into the caption`))
  }
  const long = allCards(ir).map((e) => ({ ...e, len: [...e.card.label].length })).filter((e) => e.len > limits.maxLabelLen)
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, limits.maxLabelLen,
      long.map((e) => `"${e.card.label}" in "${e.column.id}" is ${e.len} chars (guidance ≤ ${limits.maxLabelLen})`).join('; '),
      long.map((e) => `shorten "${e.card.label}" (${e.len} > ${limits.maxLabelLen})`).join('; ')))
  }
  const emphasized = allCards(ir).filter((e) => e.card.emphasis)
  if (emphasized.length > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized.length, limits.maxEmphasis,
      `${emphasized.length} emphasized card(s) (guidance ≤ ${limits.maxEmphasis})`,
      `keep emphasis on at most ${limits.maxEmphasis} cards (${emphasized.map((e) => `"${e.card.label}"`).join(', ')} are all emphasized)`))
  }
  const over = overLimit(ir)
  if (over.length) {
    out.push(budgetWarning('budget:wip', over.length, 0,
      over.map((c) => `column "${c.id}" holds ${c.cards.length} card(s) over its WIP limit ${c.limit}`).join('; '),
      over.map((c) => `finish or pull back ${c.cards.length - c.limit} card(s) in "${c.id}"`).join('; ') + ' — or raise the limit if the census is the point'))
  }
  return out
}

// --- text wrapping ---------------------------------------------------------

/** Split `text` onto at most two lines when it is wider than `maxW`. The
 * cut balances the two lines; a cut at a space wins when it costs at most
 * SPACE_SLACK px over the balanced one; no line starts with a character
 * Japanese typesetting keeps on the previous line. The wider line may
 * still exceed maxW — the columns then grow together. */
const NO_LINE_START = /^[ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ、。，．,.)）」』】〕〉》!?！？:：;；]/
const SPACE_SLACK = 12
function wrapTwo(text, maxW, fontSize, factor = 1) {
  const w = (s) => textWidth(s, fontSize) * factor
  if (w(text) <= maxW) return [text]
  const chars = [...text]
  if (chars.length < 2) return [text]
  let best = null
  let bestSpace = null
  for (let i = 1; i < chars.length; i++) {
    const atSpace = chars[i] === ' ' || chars[i - 1] === ' '
    const head = chars.slice(0, i).join('').trimEnd()
    const tail = chars.slice(i).join('').trimStart()
    if (!head || !tail || NO_LINE_START.test(tail)) continue
    const cost = Math.max(w(head), w(tail))
    if (!best || cost < best.cost) best = { cost, head, tail }
    if (atSpace && (!bestSpace || cost < bestSpace.cost)) bestSpace = { cost, head, tail }
  }
  const pick = bestSpace && bestSpace.cost <= best.cost + SPACE_SLACK ? bestSpace : best
  return pick ? [pick.head, pick.tail] : [text]
}

const chipText = (col) => (col.limit !== undefined ? `${col.cards.length}/${col.limit}` : `${col.cards.length}`)
const chipWidth = (text) => snapUp4(Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) + CHIP_PAD_X * 2)

// --- layout --------------------------------------------------------------

export async function layout(ir, { column = COLUMN } = {}) {
  const { columns, variant } = ir
  const n = columns.length
  const kanban = variant === 'kanban'

  // 1. equal column width from the column budget, capped
  const base = Math.floor((column - MARGIN * 2 - (n - 1) * COL_GAP) / n)
  let colW = Math.max(COL_MIN_W, Math.min(COL_MAX_W, base - (base % 4)))

  // 2. wrap every card at that width; grow the (equal) width when a line
  //    or a header does not fit
  const wrapAt = (w) => columns.map((c) => c.cards.map((card) => wrapTwo(card.label, w - CARD_PAD_X * 2, EDGE_LABEL_SIZE, card.emphasis ? BOLD_FACTOR : 1)))
  let wrapped = wrapAt(colW)
  let need = 0
  wrapped.forEach((cards, i) => {
    cards.forEach((lines, j) => {
      const factor = columns[i].cards[j].emphasis ? BOLD_FACTOR : 1
      for (const line of lines) need = Math.max(need, Math.ceil(textWidth(line, EDGE_LABEL_SIZE) * factor) + CARD_PAD_X * 2)
    })
    const labelW = Math.ceil(textWidth(columns[i].label, FONT_SIZE) * BOLD_FACTOR)
    const chipW = kanban ? chipWidth(chipText(columns[i])) + CHIP_GAP : 0
    need = Math.max(need, labelW + chipW + HEADER_PAD_X * 2)
  })
  if (need > colW) {
    colW = snapUp4(need)
    wrapped = wrapAt(colW)
  }

  // 3. rows: the tallest card in each row sets its height
  const nRows = Math.max(...columns.map((c) => c.cards.length))
  const rowHeights = Array.from({ length: nRows }, (_, r) => {
    let tallest = CARD_PAD_Y * 2 + LINE_H
    wrapped.forEach((cards) => { if (cards[r]) tallest = Math.max(tallest, CARD_PAD_Y * 2 + cards[r].length * LINE_H) })
    return snapUp4(tallest)
  })
  const cutAfter = new Map((ir.cuts ?? []).map((cut, i) => [cut.after, { ...cut, index: i }]))
  const rows = []
  let y = MARGIN + HEADER_H + HEADER_GAP
  const cuts = []
  for (let r = 0; r < nRows; r++) {
    rows.push({ index: r, y, height: rowHeights[r] })
    y += rowHeights[r]
    const cut = cutAfter.get(r)
    if (cut) {
      cuts.push({ index: cut.index, after: r, label: cut.label, y: y + CUT_LINE_DY, labelY: y + CUT_LABEL_DY, labelWidth: Math.ceil(textWidth(cut.label, EDGE_LABEL_SIZE) * BOLD_FACTOR) })
      y += CUT_EXTRA
    }
    if (r < nRows - 1) y += CARD_GAP
  }
  const gridBottom = y + LANE_PAD_BOTTOM

  // 4. columns, headers, chips
  const gridLeft = MARGIN
  const colGeo = columns.map((c, i) => {
    const x = gridLeft + i * (colW + COL_GAP)
    const header = { x, y: MARGIN, width: colW, height: HEADER_H }
    const col = {
      id: c.id, label: c.label, index: i, x, width: colW, centerX: snap4(x + colW / 2),
      count: c.cards.length, over: c.limit !== undefined && c.cards.length > c.limit,
      header, lane: { x, y: MARGIN, width: colW, height: gridBottom - MARGIN },
    }
    if (c.limit !== undefined) col.limit = c.limit
    if (kanban) {
      const text = chipText(c)
      const width = chipWidth(text)
      const cx = x + colW - HEADER_PAD_X - width
      col.chip = { text, x: cx, y: MARGIN + (HEADER_H - CHIP_H) / 2, width, height: CHIP_H, textX: cx + width / 2, textY: MARGIN + (HEADER_H - CHIP_H) / 2 + 16 }
      col.labelX = x + HEADER_PAD_X
    } else {
      col.labelX = col.centerX
    }
    col.labelY = MARGIN + 24
    return col
  })
  const gridRight = gridLeft + n * colW + (n - 1) * COL_GAP

  // 5. cards on their column × row
  const cards = []
  columns.forEach((c, i) => {
    c.cards.forEach((card, j) => {
      const col = colGeo[i], row = rows[j]
      const lines = wrapped[i][j]
      const contentH = lines.length * LINE_H
      const top = row.y + CARD_PAD_Y + snap4((row.height - CARD_PAD_Y * 2 - contentH) / 2)
      const factor = card.emphasis ? BOLD_FACTOR : 1
      cards.push({
        column: c.id, row: j, index: j, label: card.label, emphasis: card.emphasis, tone: card.tone,
        x: col.x, y: row.y, width: col.width, height: row.height,
        lines: lines.map((text, k) => ({ text, x: col.x + CARD_PAD_X, y: top + k * LINE_H + 12, width: Math.ceil(textWidth(text, EDGE_LABEL_SIZE) * factor) })),
      })
    })
  })

  // 6. cut lines span the full grid; the label sits right-aligned above
  for (const cut of cuts) {
    cut.x1 = gridLeft
    cut.x2 = gridRight
    cut.labelX = gridRight
  }

  const width = snapUp4(gridRight + MARGIN)
  const height = snapUp4(gridBottom + MARGIN)
  return { width, height, geo: { variant, columns: colGeo, rows, cards, cuts, gridLeft, gridRight, gridTop: MARGIN, gridBottom } }
}

// --- drawing -------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []

  // lanes (under everything)
  for (const c of geo.columns) {
    parts.push(`<rect id="${uid}-lane-${c.id}" x="${c.lane.x}" y="${c.lane.y}" width="${c.lane.width}" height="${c.lane.height}" rx="4" fill="none" stroke="var(--wu-rule-soft)" stroke-width="1"/>`)
  }

  // cut lines, before cards so a card is never hidden by one (they never
  // cross — the cuts-clear row proves it)
  for (const cut of geo.cuts) {
    parts.push(`<line id="${uid}-cut-${cut.index}" x1="${cut.x1}" y1="${cut.y}" x2="${cut.x2}" y2="${cut.y}" stroke="var(--wu-accent)" stroke-width="1.5" stroke-dasharray="6 4"/>`)
    parts.push(`<text id="${uid}-cut-${cut.index}-label" x="${cut.labelX}" y="${cut.labelY}" font-size="${EDGE_LABEL_SIZE}" font-weight="700" text-anchor="end" fill="var(--wu-accent)">${esc(cut.label)}</text>`)
  }

  // headers
  for (const c of geo.columns) {
    const h = c.header
    parts.push(`<rect id="${uid}-col-${c.id}" data-tone="ts" x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/>`)
    const anchor = geo.variant === 'kanban' ? 'start' : 'middle'
    parts.push(`<text id="${uid}-col-${c.id}-label" x="${c.labelX}" y="${c.labelY}" font-size="${FONT_SIZE}" font-weight="700" text-anchor="${anchor}" fill="currentColor">${esc(c.label)}</text>`)
    if (c.chip) {
      const cls = c.over ? ' class="wu-focal"' : ''
      const fill = c.over ? 'var(--wu-accent)' : 'currentColor'
      parts.push(`<rect id="${uid}-col-${c.id}-chip"${cls} x="${c.chip.x}" y="${c.chip.y}" width="${c.chip.width}" height="${c.chip.height}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="${c.over ? 1.5 : 1}"/>`)
      parts.push(`<text id="${uid}-col-${c.id}-chip-text" x="${c.chip.textX}" y="${c.chip.textY}" font-size="${EDGE_LABEL_SIZE}"${c.over ? ' font-weight="700"' : ''} text-anchor="middle" fill="${fill}">${esc(c.chip.text)}</text>`)
    }
  }

  // cards
  for (const card of geo.cards) {
    const cid = `${uid}-card-${card.column}-${card.index}`
    const cls = card.emphasis ? ' class="wu-focal"' : ''
    const weight = card.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${cid}" data-tone="${esc(card.tone)}"${cls} x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="4" fill="var(--wu-surface)" stroke="var(--wu-rule)" stroke-width="${card.emphasis ? 1.5 : 1}"/>`)
    card.lines.forEach((l, k) => {
      parts.push(`<text id="${cid}-l${k}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}"${weight} fill="currentColor">${esc(l.text)}</text>`)
    })
  }

  return parts.join('')
}

// --- verify --------------------------------------------------------------

const overlapsOpen = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2)

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'column-count', 'budget:columns', `${ir.columns.length} column(s)`)
  budgetRow(2, 'cards-per-column', 'budget:cards', `at most ${Math.max(...ir.columns.map((c) => c.cards.length))} card(s) in a column`)
  budgetRow(3, 'label-length', 'budget:label', `every card label is ≤ ${limits.maxLabelLen} chars`)
  budgetRow(4, 'emphasis-count', 'budget:emphasis', `${allCards(ir).filter((e) => e.card.emphasis).length} emphasized card(s)`)
  budgetRow(5, 'wip-within-limit', 'budget:wip', ir.variant === 'kanban' ? 'every column with a limit is at or under it' : 'story map — no WIP limits')

  // 6. every card sits on its column (x/width) and its row (y/height),
  //    inside the column's lane
  const colOf = new Map(geo.columns.map((c) => [c.id, c]))
  const inColumn = []
  geo.cards.forEach((card, i) => {
    const c = colOf.get(card.column), r = geo.rows[card.row]
    if (!c) { inColumn.push(`cards[${i}] → unknown column "${card.column}"`); return }
    if (card.x !== c.x || card.width !== c.width) inColumn.push(`cards[${i}] ("${card.label}") x/width ${card.x}/${card.width} ≠ column "${c.id}" ${c.x}/${c.width}`)
    if (!r || card.y !== r.y || card.height !== r.height) inColumn.push(`cards[${i}] ("${card.label}") y/height ${card.y}/${card.height} ≠ row ${card.row}`)
    if (card.y < c.lane.y + c.header.height || card.y + card.height > c.lane.y + c.lane.height) inColumn.push(`cards[${i}] ("${card.label}") leaves the lane of "${c.id}"`)
  })
  rows.push({ id: 6, name: 'cards-in-column', severity: 'fail', ok: inColumn.length === 0, detail: inColumn.length ? inColumn.slice(0, 4).join('; ') : `${geo.cards.length} card(s) each on its column × row, inside the lane`, hint: inColumn.length ? 'derive every card rect from its column and row — never position a card on its own' : undefined })

  // 7. no two cards overlap
  const overlaps = []
  for (let i = 0; i < geo.cards.length; i++) {
    for (let j = i + 1; j < geo.cards.length; j++) {
      const a = geo.cards[i], b = geo.cards[j]
      if (overlapsOpen(a.x, a.x + a.width, b.x, b.x + b.width) && overlapsOpen(a.y, a.y + a.height, b.y, b.y + b.height)) overlaps.push(`cards[${i}] ("${a.label}") overlaps cards[${j}] ("${b.label}")`)
    }
  }
  rows.push({ id: 7, name: 'cards-no-overlap', severity: 'fail', ok: overlaps.length === 0, detail: overlaps.length ? overlaps.slice(0, 4).join('; ') : 'no two cards overlap', hint: overlaps.length ? `keep ${CARD_GAP}px between stacked cards and ${COL_GAP}px between columns` : undefined })

  // 8. the WIP count each header shows equals the cards drawn in that column
  const wip = []
  for (const c of geo.columns) {
    const drawn = geo.cards.filter((card) => card.column === c.id).length
    if (c.count !== drawn) wip.push(`column "${c.id}" says ${c.count} but ${drawn} card(s) are drawn`)
    if (c.chip) {
      const expected = c.limit !== undefined ? `${drawn}/${c.limit}` : `${drawn}`
      if (c.chip.text !== expected) wip.push(`column "${c.id}" chip reads "${c.chip.text}", expected "${expected}"`)
      const over = c.limit !== undefined && drawn > c.limit
      if (c.over !== over) wip.push(`column "${c.id}" over-limit flag is ${c.over}, expected ${over}`)
    }
  }
  rows.push({ id: 8, name: 'wip-count-matches', severity: 'fail', ok: wip.length === 0, detail: wip.length ? wip.join('; ') : 'every column count (and chip) equals its drawn cards', hint: wip.length ? 'compute the chip text from the cards actually laid out, never from a separate count' : undefined })

  // 9. cut lines run between rows: no line through a card, no label over
  //    a card, every line inside the grid span
  const cutProblems = []
  for (const cut of geo.cuts) {
    if (cut.x1 > geo.gridLeft || cut.x2 < geo.gridRight) cutProblems.push(`cuts[${cut.index}] does not span the grid`)
    const label = { x1: cut.labelX - cut.labelWidth, x2: cut.labelX, y1: cut.labelY - CUT_LABEL_H + 3, y2: cut.labelY + 3 }
    geo.cards.forEach((card, i) => {
      if (cut.y > card.y && cut.y < card.y + card.height && overlapsOpen(cut.x1, cut.x2, card.x, card.x + card.width)) cutProblems.push(`cuts[${cut.index}] ("${cut.label}") crosses cards[${i}] ("${card.label}")`)
      if (overlapsOpen(label.x1, label.x2, card.x, card.x + card.width) && overlapsOpen(label.y1, label.y2, card.y, card.y + card.height)) cutProblems.push(`cuts[${cut.index}] label "${cut.label}" overlaps cards[${i}] ("${card.label}")`)
    })
    const prev = geo.rows[cut.after], next = geo.rows[cut.after + 1]
    if (prev && cut.y <= prev.y + prev.height) cutProblems.push(`cuts[${cut.index}] is not below row ${cut.after}`)
    if (next && cut.y >= next.y) cutProblems.push(`cuts[${cut.index}] is not above row ${cut.after + 1}`)
  }
  rows.push({ id: 9, name: 'cuts-clear', severity: 'fail', ok: cutProblems.length === 0, detail: cutProblems.length ? cutProblems.slice(0, 4).join('; ') : `${geo.cuts.length} cut line(s) run between rows across the whole grid, none through a card`, hint: cutProblems.length ? `insert ${CUT_EXTRA}px between the two rows a cut separates and draw the line in that corridor` : undefined })

  // 10. text inside its card with padding
  const textProblems = []
  geo.cards.forEach((card, i) => {
    card.lines.forEach((l, k) => {
      const top = l.y - 12
      if (l.x < card.x + CARD_PAD_X || l.x + l.width > card.x + card.width - CARD_PAD_X + 1) textProblems.push(`cards[${i}] line ${k} "${l.text}" overflows horizontally`)
      if (top < card.y + CARD_PAD_Y || l.y > card.y + card.height - CARD_PAD_Y + 4) textProblems.push(`cards[${i}] line ${k} "${l.text}" overflows vertically`)
    })
    if (card.lines.length > 2) textProblems.push(`cards[${i}] ("${card.label}") has ${card.lines.length} lines (max 2)`)
  })
  rows.push({ id: 10, name: 'text-inside-cards', severity: 'fail', ok: textProblems.length === 0, detail: textProblems.length ? textProblems.slice(0, 4).join('; ') : `every card line (≤ 2 per card) sits inside its card with ${CARD_PAD_X}/${CARD_PAD_Y}px padding`, hint: textProblems.length ? 'grow the shared column width from the widest wrapped line before placing text' : undefined })

  return rows
}

export const doc = {
  purpose: 'equal-width columns of stacked cards — a kanban (states × WIP count) or a story map (activities × steps with release cut lines)',
  whenToUse: 'kanban when the message is "how much sits in each state right now" (a census, no arrows — use process/swimlane for hand-offs); story-map when the decision is where to cut a release across a story-ordered backlog. Budgets: columns ≤ 6, cards per column ≤ 8, label ≤ 14 chars, emphasis ≤ 2; a kanban column over its WIP limit warns — guidance, over-budget figures still render with data-warn.',
  irExample: `id: onboarding-map
type: board
variant: story-map
title: オンボーディングのストーリーマップ
caption: カット線より上が MVP。最リスクは決済連携
columns:
  - id: signup
    label: 登録
    cards: [メール登録, SSO 連携]
  - id: setup
    label: 初期設定
    cards:
      - 組織作成
      - label: 決済連携
        emphasis: true
      - 招待メール
  - id: use
    label: 利用
    cards: [記事作成, 共有リンク, コメント]
  - id: review
    label: 振り返り
    cards: [利用レポート]
cuts:
  - after: 1
    label: MVP
`,
  rows: ['column-count', 'cards-per-column', 'label-length', 'emphasis-count', 'wip-within-limit', 'cards-in-column', 'cards-no-overlap', 'wip-count-matches', 'cuts-clear', 'text-inside-cards'],
}
