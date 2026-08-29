// `type: process` — a stage × slot grid: stages as columns left → right,
// a fixed set of row slots (入力 / 処理 / 出力 / 統制 …) as rows, short items
// in the cells, and flow arrows between stage borders. The figure answers
// "at each step of this process, what goes in, what happens, what comes
// out, and what governs it" in one glance — the stage-framework reading
// the diagram-pattern survey files under "Process" (stage × semantic
// slots), and its before/after use in decision records.
//
// IR shape: `{ id, type:'process', title, caption, slots, stages, arrows }`.
//   - `slots`  — row labels, top → bottom (≤ 4 guidance);
//   - `stages` — `[{ id, label, emphasis?, focal?, cells: { <slot>: string | [string] } }]`,
//     left → right (≤ 6 guidance); a cell is a list of short items (≤ 16
//     chars each, guidance); a slot a stage does not mention is empty;
//     `emphasis` marks the focal stage (exactly one, guidance) and
//     `focal: <slot>` the one focal cell of the figure (≤ 1, guidance);
//   - `arrows` — `'between-stages'` (default: one arrow from each stage to
//     the next, along the first slot row) or an explicit list of
//     `{ from, to, label? }` stage references.
//
// Budgets differ from the survey's lane × step process (lanes ≤ 6, steps
// ≤ 12) on purpose: that grid holds one 100px node per lane × step, this
// one holds up to 4 rows of wrapped text per stage, so 6 stages is what a
// 720px column fits, and 4 slots is the semantic set (入力/処理/出力/統制).
//
// Layout is a deterministic grid, no layout engine: column width comes
// from the widest cell line in that stage (an item wider than WRAP_W is
// wrapped onto two lines first), row height from the tallest cell in that
// row, the header band from the stage labels. Adjacent forward arrows run
// straight through the gap between two columns; any other arrow (a skip
// or a return) leaves the top border of its stage header, makes one jog
// over the header band and drops into the target header's top border —
// never more than one jog, never through a cell, never under the grid —
// which the `arrows-clear` row then proves. Every position is snapped to
// the 4px grid.
//
// Import rule (references/figure-types.md): _shared.mjs and diagram.mjs
// constants only — never ir.mjs / verify-diagram.mjs / figures/index.mjs.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE } from '../diagram.mjs'

export const type = 'process'

export const limits = { maxStages: 6, maxSlots: 4, maxCellTextLen: 16, maxCells: 20, maxEmphasis: 1, maxFocal: 1 }

// --- layout constants (multiples of 4 unless noted) ------------------------
const MARGIN = 16
const HEADER_H = 32
const HEADER_GAP = 8          // header band → first row
const SLOT_COL_MIN_W = 48
const SLOT_COL_GAP = 12       // slot label column → first stage column
const STAGE_GAP = 24          // gap between two stage columns (the arrow lane)
const COL_MIN_W = 96
const CELL_PAD_X = 12
const CELL_PAD_Y = 8
const LINE_H = 16             // 11px text line pitch
const ITEM_GAP = 4
const ROW_MIN_H = 32
const WRAP_W = 88             // an item wider than this is wrapped onto 2 lines
const ARROW_LABEL_H = 14
const ARROW_LABEL_PAD = 8
const OVER_GAP = 16           // header top → nearest over-header lane
const OVER_PITCH = 24         // between two over-header lanes
const OVER_STUB = 8           // out stubs sit +8px, in stubs −8px from the column center (then +8 per extra)
const OVER_LABEL_CLEAR = 20   // topmost lane → canvas top when that lane carries a label
const OVER_LINE_CLEAR = 8     // … when it does not
const BETWEEN_STAGES = 'between-stages'

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const slots = normalizeSlots(raw.slots, ctx)
  const stages = normalizeStages(raw.stages, slots, ctx)
  const arrows = normalizeArrows(raw.arrows, stages, ctx)
  return { id, type, title, caption, slots, stages, arrows }
}

function normalizeSlots(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.slots must be a non-empty list of row labels`)
  const seen = new Set()
  return raw.map((s, i) => {
    if (typeof s !== 'string' || s.trim() === '') throw new IrError(`${ctx}.slots[${i}] must be a non-empty string`)
    if (seen.has(s)) throw new IrError(`${ctx}.slots: duplicate slot "${s}"`)
    seen.add(s)
    return s
  })
}

function normalizeStages(raw, slots, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.stages must be a non-empty list`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.stages[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`${ctx}.stages: duplicate stage id "${id}"`)
    seen.add(id)
    const label = requireStr(s, 'label', sctx)
    const emphasis = validateBool(s, 'emphasis', sctx)
    const cells = normalizeCells(s.cells, slots, sctx)
    const focal = optStr(s, 'focal', sctx)
    if (focal !== undefined) {
      if (!slots.includes(focal)) throw new IrError(`${sctx}.focal references unknown slot "${focal}" (declared: ${slots.join(', ')})`)
      if (!cells[focal]) throw new IrError(`${sctx}.focal names slot "${focal}" but the stage has no cell there`)
    }
    return { id, label, emphasis, focal, cells }
  })
}

/** `{ <slot>: string | [string] }` → `{ <slot>: [string] }` in slot order,
 * empty slots dropped — so a normalized stage re-normalizes unchanged. */
function normalizeCells(raw, slots, sctx) {
  if (raw === undefined || raw === null) return {}
  if (!isObj(raw)) throw new IrError(`${sctx}.cells must be a mapping of slot → item(s)`)
  const slotSet = new Set(slots)
  for (const key of Object.keys(raw)) {
    if (!slotSet.has(key)) throw new IrError(`${sctx}.cells references unknown slot "${key}" (declared: ${slots.join(', ')})`)
  }
  const cells = {}
  for (const slot of slots) {
    if (!(slot in raw)) continue
    const v = raw[slot]
    const items = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
    const cctx = `${sctx}.cells[${JSON.stringify(slot)}]`
    const out = items.map((item, j) => {
      if (typeof item !== 'string' || item.trim() === '') throw new IrError(`${cctx}[${j}] must be a non-empty string`)
      return item
    })
    if (out.length) cells[slot] = out
  }
  return cells
}

function normalizeArrows(raw, stages, ctx) {
  if (raw === undefined || raw === null || raw === BETWEEN_STAGES) return BETWEEN_STAGES
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.arrows must be "${BETWEEN_STAGES}" or a list of { from, to, label? }`)
  const ids = new Set(stages.map((s) => s.id))
  return raw.map((a, i) => {
    const actx = `${ctx}.arrows[${i}]`
    if (!isObj(a)) throw new IrError(`${actx} must be a mapping`)
    const from = requireStr(a, 'from', actx)
    const to = requireStr(a, 'to', actx)
    if (!ids.has(from)) throw new IrError(`${actx}.from references unknown stage "${from}"`)
    if (!ids.has(to)) throw new IrError(`${actx}.to references unknown stage "${to}"`)
    if (from === to) throw new IrError(`${actx}: from and to must differ`)
    const label = optStr(a, 'label', actx) ?? ''
    return { from, to, label }
  })
}

// --- budgets -------------------------------------------------------------

const cellEntries = (ir) => ir.stages.flatMap((s) => ir.slots.filter((slot) => s.cells[slot]).map((slot) => ({ stage: s, slot, items: s.cells[slot] })))

export function budgetWarnings(ir) {
  const out = []
  const n = ir.stages.length
  if (n > limits.maxStages) {
    out.push(budgetWarning('budget:stages', n, limits.maxStages,
      `${n} stage(s) (guidance ≤ ${limits.maxStages})`,
      `split the process after stage ${limits.maxStages} ("${ir.stages[limits.maxStages - 1].label}") into a second figure`))
  }
  if (ir.slots.length > limits.maxSlots) {
    out.push(budgetWarning('budget:slots', ir.slots.length, limits.maxSlots,
      `${ir.slots.length} slot(s) (guidance ≤ ${limits.maxSlots})`,
      `merge or drop slot rows past "${ir.slots[limits.maxSlots - 1]}" — a 5th row reads as a table, not a flow`))
  }
  const cells = cellEntries(ir)
  if (cells.length > limits.maxCells) {
    out.push(budgetWarning('budget:cells', cells.length, limits.maxCells,
      `${cells.length} filled cell(s) (guidance ≤ ${limits.maxCells})`,
      'leave cells that add nothing empty, or split the process into two figures'))
  }
  const long = []
  for (const c of cells) {
    c.items.forEach((item, j) => {
      const len = [...item].length
      if (len > limits.maxCellTextLen) long.push({ c, j, item, len })
    })
  }
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:cell-text', longest.len, limits.maxCellTextLen,
      long.map((e) => `stage "${e.c.stage.id}" / ${e.c.slot} "${e.item}" is ${e.len} chars (guidance ≤ ${limits.maxCellTextLen})`).join('; '),
      long.map((e) => `shorten "${e.item}" in stage "${e.c.stage.id}" (${e.len} > ${limits.maxCellTextLen})`).join('; ') + ', or move the wording into the caption'))
  }
  // the focal stage: exactly one — none leaves the reader without the
  // step the figure is about, more than one dilutes it
  const emphasized = ir.stages.filter((s) => s.emphasis)
  if (emphasized.length > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized.length, limits.maxEmphasis,
      `${emphasized.length} emphasized stage(s) (guidance: exactly ${limits.maxEmphasis})`,
      `keep emphasis on exactly ${limits.maxEmphasis} stage (${emphasized.map((s) => `"${s.id}"`).join(', ')} are all emphasized)`))
  } else if (emphasized.length === 0) {
    out.push(budgetWarning('budget:emphasis', 0, limits.maxEmphasis,
      `no emphasized stage (guidance: exactly ${limits.maxEmphasis})`,
      'mark the stage the figure is about with emphasis: true'))
  }
  const focal = ir.stages.filter((s) => s.focal)
  if (focal.length > limits.maxFocal) {
    out.push(budgetWarning('budget:focal', focal.length, limits.maxFocal,
      `${focal.length} focal cell(s) (guidance ≤ ${limits.maxFocal})`,
      `keep focal on one cell (${focal.map((s) => `"${s.id}"/${s.focal}`).join(', ')} are all focal)`))
  }
  return out
}

// --- text wrapping ---------------------------------------------------------

/** Split `text` onto at most two lines when it is wider than `maxW` at
 * `fontSize`. The cut balances the two lines (the column is as wide as
 * the wider line, so a balanced cut is the narrowest column); a cut at a
 * space wins when it costs at most SPACE_SLACK px over the balanced one,
 * and no line starts with a character Japanese typesetting keeps on the
 * previous line (small kana, prolonged sound mark, closing punctuation).
 * The second line may still be wider than maxW — the column then grows. */
const NO_LINE_START = /^[ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ、。，．,.)）」』】〕〉》!?！？:：;；]/
const SPACE_SLACK = 12
function wrapTwo(text, maxW, fontSize) {
  if (textWidth(text, fontSize) <= maxW) return [text]
  const chars = [...text]
  if (chars.length < 2) return [text]
  let best = null
  let bestSpace = null
  for (let i = 1; i < chars.length; i++) {
    const atSpace = chars[i] === ' ' || chars[i - 1] === ' '
    const head = chars.slice(0, i).join('').trimEnd()
    const tail = chars.slice(i).join('').trimStart()
    if (!head || !tail || NO_LINE_START.test(tail)) continue
    const cost = Math.max(textWidth(head, fontSize), textWidth(tail, fontSize))
    if (!best || cost < best.cost) best = { cost, head, tail }
    if (atSpace && (!bestSpace || cost < bestSpace.cost)) bestSpace = { cost, head, tail }
  }
  const pick = bestSpace && bestSpace.cost <= best.cost + SPACE_SLACK ? bestSpace : best
  return pick ? [pick.head, pick.tail] : [text]
}

// --- layout --------------------------------------------------------------

export async function layout(ir) {
  const { slots, stages } = ir
  const nStages = stages.length

  // 1. wrap every item, measure the widest line per stage
  const wrapped = stages.map((s) => {
    const cells = {}
    for (const slot of slots) {
      if (!s.cells[slot]) continue
      cells[slot] = s.cells[slot].map((item) => wrapTwo(item, WRAP_W, EDGE_LABEL_SIZE))
    }
    return cells
  })
  const colWidths = stages.map((s, i) => {
    let widest = textWidth(s.label, FONT_SIZE) * (s.emphasis ? 1.08 : 1)
    for (const lines of Object.values(wrapped[i])) {
      for (const item of lines) for (const line of item) widest = Math.max(widest, textWidth(line, EDGE_LABEL_SIZE))
    }
    return snapUp4(Math.max(COL_MIN_W, Math.ceil(widest) + CELL_PAD_X * 2))
  })

  // 2. row heights from the tallest cell in each row
  const rowHeights = slots.map((slot) => {
    let tallest = ROW_MIN_H
    wrapped.forEach((cells) => {
      const items = cells[slot]
      if (!items) return
      const lines = items.reduce((n, it) => n + it.length, 0)
      tallest = Math.max(tallest, lines * LINE_H + (items.length - 1) * ITEM_GAP + CELL_PAD_Y * 2)
    })
    return snapUp4(tallest)
  })

  // 3. arrows — decide the route of each before the columns are placed,
  //    because a labelled gap arrow widens its gap
  const indexOf = new Map(stages.map((s, i) => [s.id, i]))
  const arrowSpecs = ir.arrows === BETWEEN_STAGES
    ? stages.slice(1).map((s, i) => ({ from: stages[i].id, to: s.id, label: '' }))
    : ir.arrows
  const arrowLabelW = (label) => (label ? Math.ceil(textWidth(label, EDGE_LABEL_SIZE)) + ARROW_LABEL_PAD : 0)
  const gaps = Array.from({ length: Math.max(0, nStages - 1) }, () => STAGE_GAP)
  const routed = arrowSpecs.map((a, index) => {
    const fi = indexOf.get(a.from), ti = indexOf.get(a.to)
    const route = ti === fi + 1 ? 'gap' : 'over'
    if (route === 'gap' && a.label) gaps[fi] = Math.max(gaps[fi], snapUp4(arrowLabelW(a.label) + ARROW_LABEL_PAD * 2))
    return { ...a, index, fi, ti, route }
  })
  // over-header arrows: one lane each, the shortest span nearest the
  // header band so the fewest verticals cross a lower lane; the band
  // above the headers grows with the lanes and the topmost lane's label
  const overOrder = routed.filter((a) => a.route === 'over')
    .sort((a, b) => Math.abs(a.ti - a.fi) - Math.abs(b.ti - b.fi) || a.index - b.index)
  const laneOf = new Map(overOrder.map((a, k) => [a.index, k]))
  const topClear = overOrder.length ? (overOrder[overOrder.length - 1].label ? OVER_LABEL_CLEAR : OVER_LINE_CLEAR) : 0
  const headerY = MARGIN + (overOrder.length ? topClear + (overOrder.length - 1) * OVER_PITCH + OVER_GAP : 0)

  // 4. columns
  const slotColW = snapUp4(Math.max(SLOT_COL_MIN_W, Math.ceil(Math.max(...slots.map((s) => textWidth(s, EDGE_LABEL_SIZE)))) + 8))
  const gridLeft = MARGIN + slotColW + SLOT_COL_GAP
  const stageGeo = []
  let x = gridLeft
  stages.forEach((s, i) => {
    const width = colWidths[i]
    stageGeo.push({ id: s.id, label: s.label, emphasis: s.emphasis, index: i, x, width, centerX: snap4(x + width / 2), header: { x, y: headerY, width, height: HEADER_H } })
    x += width + (i < nStages - 1 ? gaps[i] : 0)
  })
  const gridRight = x

  // 5. rows + cells
  const rows = []
  let y = headerY + HEADER_H + HEADER_GAP
  slots.forEach((slot, r) => {
    const height = rowHeights[r]
    rows.push({ slot, index: r, y, height, centerY: snap4(y + height / 2) })
    y += height
  })
  const gridBottom = y
  const cells = []
  stages.forEach((s, i) => {
    rows.forEach((row) => {
      const items = wrapped[i][row.slot]
      if (!items) return
      const col = stageGeo[i]
      const lines = []
      const contentH = items.reduce((n, it) => n + it.length, 0) * LINE_H + (items.length - 1) * ITEM_GAP
      let ly = row.y + CELL_PAD_Y + snap4((row.height - CELL_PAD_Y * 2 - contentH) / 2)
      items.forEach((itemLines, j) => {
        itemLines.forEach((text) => {
          lines.push({ text, item: j, x: col.x + CELL_PAD_X, y: ly + 12, width: Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) })
          ly += LINE_H
        })
        ly += ITEM_GAP
      })
      cells.push({ stage: s.id, slot: row.slot, x: col.x, y: row.y, width: col.width, height: row.height, items: s.cells[row.slot], lines, focal: s.focal === row.slot })
    })
  })
  const slotLabels = rows.map((row) => ({ slot: row.slot, x: MARGIN + slotColW, y: row.centerY + 4, width: Math.ceil(textWidth(row.slot, EDGE_LABEL_SIZE)) }))

  // 6. arrow paths — gap arrows along the first row's center; over arrows
  //    leave the source header's top (right of center), run along their
  //    lane above the header band and drop into the target header's top
  //    (left of center); a stage with several exits/entries fans them
  //    outward by OVER_STUB each
  const firstRowY = rows[0].centerY
  const stubOffset = (list, a) => list.filter((o) => o.index !== a.index && o.index < a.index).length
  const exits = (id) => overOrder.filter((o) => o.from === id)
  const entries = (id) => overOrder.filter((o) => o.to === id)
  const arrows = routed.map((a) => {
    const from = stageGeo[a.fi], to = stageGeo[a.ti]
    if (a.route === 'gap') {
      const x1 = from.x + from.width, x2 = to.x
      const path = [{ x: x1, y: firstRowY }, { x: x2, y: firstRowY }]
      const label = a.label ? { text: a.label, x: snap4((x1 + x2) / 2), y: firstRowY - 8, width: arrowLabelW(a.label), height: ARROW_LABEL_H } : null
      return { from: a.from, to: a.to, index: a.index, route: 'gap', path, label }
    }
    const k = laneOf.get(a.index)
    const laneY = headerY - OVER_GAP - k * OVER_PITCH
    const x1 = snap4(from.centerX + OVER_STUB * (1 + stubOffset(exits(a.from), a)))
    const x2 = snap4(to.centerX - OVER_STUB * (1 + stubOffset(entries(a.to), a)))
    const path = [{ x: x1, y: headerY }, { x: x1, y: laneY }, { x: x2, y: laneY }, { x: x2, y: headerY }]
    const label = a.label ? { text: a.label, x: snap4((x1 + x2) / 2), y: laneY - 8, width: arrowLabelW(a.label), height: ARROW_LABEL_H } : null
    return { from: a.from, to: a.to, index: a.index, route: 'over', lane: k, path, label }
  })
  const height = snapUp4(gridBottom + MARGIN)
  const width = snapUp4(gridRight + MARGIN)

  return {
    width,
    height,
    geo: { header: { y: headerY, height: HEADER_H }, slotColumn: { x: MARGIN, width: slotColW }, stages: stageGeo, rows, cells, slotLabels, arrows, gridLeft, gridRight, gridBottom },
  }
}

// --- drawing -------------------------------------------------------------

const pathD = (pts) => `M${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')

  // row rules across the grid (drawn first, under everything)
  geo.rows.forEach((row, r) => {
    if (r === 0) return
    parts.push(`<line id="${uid}-rule-${r}" x1="${geo.slotColumn.x}" y1="${row.y}" x2="${geo.gridRight}" y2="${row.y}" stroke="var(--wu-rule-soft)" stroke-width="1"/>`)
  })

  // arrows before boxes (z-order rule)
  for (const a of geo.arrows) {
    parts.push(`<path id="${uid}-arrow-${a.index}" d="${pathD(a.path)}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    if (a.label) {
      parts.push(`<text id="${uid}-arrow-${a.index}-label" x="${a.label.x}" y="${a.label.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="middle" fill="currentColor">${esc(a.label.text)}</text>`)
    }
  }

  // slot labels
  for (const l of geo.slotLabels) {
    parts.push(`<text id="${uid}-slot-${slugify(l.slot)}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="var(--wu-ink-2)">${esc(l.slot)}</text>`)
  }

  // stage headers
  for (const s of geo.stages) {
    const h = s.header
    const cls = s.emphasis ? ' class="wu-focal"' : ''
    const sw = s.emphasis ? 1.5 : 1
    const weight = s.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-stage-${s.id}" data-tone="neutral"${cls} x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" rx="4" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-stage-${s.id}-label" x="${s.centerX}" y="${h.y + h.height / 2 + 4}" font-size="${FONT_SIZE}"${weight} text-anchor="middle" fill="currentColor">${esc(s.label)}</text>`)
  }

  // cells
  geo.cells.forEach((c, i) => {
    const focal = c.focal ? ' class="wu-focal" stroke="currentColor" stroke-width="1.5"' : ' stroke="var(--wu-rule)" stroke-width="1"'
    parts.push(`<rect id="${uid}-cell-${i}" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="var(--wu-surface)"${focal}/>`)
    c.lines.forEach((l, j) => {
      parts.push(`<text id="${uid}-cell-${i}-l${j}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(l.text)}</text>`)
    })
  })

  return parts.join('')
}

/** An id-safe suffix for a slot label (CJK kept, everything else that is
 * not [A-Za-z0-9_-] replaced) plus its index for uniqueness. */
function slugify(s) {
  return String(s).replace(/[^\p{L}\p{N}_-]/gu, '-')
}

// --- verify --------------------------------------------------------------

const inside = (v, lo, hi) => v > lo && v < hi
const overlapsOpen = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2)

/** Whether the segment p→q passes through the interior of rect r. */
function segmentThroughRect(p, q, r) {
  if (p.y === q.y) {
    return inside(p.y, r.y, r.y + r.height) && overlapsOpen(Math.min(p.x, q.x), Math.max(p.x, q.x), r.x, r.x + r.width)
  }
  if (p.x === q.x) {
    return inside(p.x, r.x, r.x + r.width) && overlapsOpen(Math.min(p.y, q.y), Math.max(p.y, q.y), r.y, r.y + r.height)
  }
  return true // diagonal — never allowed near the grid
}

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'stage-count', 'budget:stages', `${ir.stages.length} stage(s)`)
  budgetRow(2, 'slot-count', 'budget:slots', `${ir.slots.length} slot(s)`)
  budgetRow(3, 'cell-count', 'budget:cells', `${cellEntries(ir).length} filled cell(s)`)
  budgetRow(4, 'cell-text-length', 'budget:cell-text', `every cell item is ≤ ${limits.maxCellTextLen} chars`)
  budgetRow(5, 'emphasis-count', 'budget:emphasis', `${ir.stages.filter((s) => s.emphasis).length} emphasized stage(s)`)
  budgetRow(6, 'focal-count', 'budget:focal', `${ir.stages.filter((s) => s.focal).length} focal cell(s)`)

  // 7. references: every cell sits in a declared stage and slot, every
  //    arrow joins two declared stages
  const stageIds = new Set(geo.stages.map((s) => s.id))
  const slotSet = new Set(geo.rows.map((r) => r.slot))
  const badRefs = []
  geo.cells.forEach((c, i) => {
    if (!stageIds.has(c.stage)) badRefs.push(`cells[${i}] → unknown stage "${c.stage}"`)
    if (!slotSet.has(c.slot)) badRefs.push(`cells[${i}] → unknown slot "${c.slot}"`)
  })
  geo.arrows.forEach((a) => {
    if (!stageIds.has(a.from)) badRefs.push(`arrows[${a.index}].from → unknown stage "${a.from}"`)
    if (!stageIds.has(a.to)) badRefs.push(`arrows[${a.index}].to → unknown stage "${a.to}"`)
  })
  rows.push({ id: 7, name: 'references-exist', severity: 'fail', ok: badRefs.length === 0, detail: badRefs.length ? badRefs.join('; ') : 'every cell and arrow references a declared stage/slot', hint: badRefs.length ? 'declare the stage/slot before referencing it' : undefined })

  // 8. grid: every cell matches its column (x/width) and row (y/height);
  //    no two cells overlap
  const stageOf = new Map(geo.stages.map((s) => [s.id, s]))
  const rowOf = new Map(geo.rows.map((r) => [r.slot, r]))
  const gridProblems = []
  geo.cells.forEach((c, i) => {
    const s = stageOf.get(c.stage), r = rowOf.get(c.slot)
    if (s && (c.x !== s.x || c.width !== s.width)) gridProblems.push(`cells[${i}] (${c.stage}/${c.slot}) x/width ${c.x}/${c.width} ≠ column ${s.x}/${s.width}`)
    if (r && (c.y !== r.y || c.height !== r.height)) gridProblems.push(`cells[${i}] (${c.stage}/${c.slot}) y/height ${c.y}/${c.height} ≠ row ${r.y}/${r.height}`)
  })
  for (let i = 0; i < geo.cells.length; i++) {
    for (let j = i + 1; j < geo.cells.length; j++) {
      const a = geo.cells[i], b = geo.cells[j]
      if (overlapsOpen(a.x, a.x + a.width, b.x, b.x + b.width) && overlapsOpen(a.y, a.y + a.height, b.y, b.y + b.height)) {
        gridProblems.push(`cells[${i}] (${a.stage}/${a.slot}) overlaps cells[${j}] (${b.stage}/${b.slot})`)
      }
    }
  }
  rows.push({ id: 8, name: 'grid-aligned', severity: 'fail', ok: gridProblems.length === 0, detail: gridProblems.length ? gridProblems.slice(0, 4).join('; ') : `${geo.cells.length} cell(s) aligned to ${geo.stages.length} column(s) × ${geo.rows.length} row(s), none overlapping`, hint: gridProblems.length ? 'derive every cell rect from its stage column and slot row — never position a cell on its own' : undefined })

  // 9. text inside its cell with padding
  const textProblems = []
  geo.cells.forEach((c, i) => {
    c.lines.forEach((l, j) => {
      const w = Math.ceil(textWidth(l.text, EDGE_LABEL_SIZE))
      const top = l.y - 12
      if (l.x < c.x + CELL_PAD_X || l.x + w > c.x + c.width - CELL_PAD_X + 1) textProblems.push(`cells[${i}] line ${j} "${l.text}" overflows horizontally`)
      if (top < c.y + CELL_PAD_Y || l.y > c.y + c.height - CELL_PAD_Y + 4) textProblems.push(`cells[${i}] line ${j} "${l.text}" overflows vertically`)
    })
  })
  rows.push({ id: 9, name: 'text-inside-cells', severity: 'fail', ok: textProblems.length === 0, detail: textProblems.length ? textProblems.slice(0, 4).join('; ') : `every cell line sits inside its cell with ${CELL_PAD_X}/${CELL_PAD_Y}px padding`, hint: textProblems.length ? 'size the column from the widest wrapped line and the row from the tallest cell before placing text' : undefined })

  // 10. arrows: orthogonal with at most one jog (≤ 4 points), endpoints on
  //     a stage side border or the header's top border, no segment through
  //     a cell or header, nothing routed under the grid
  const boxes = [...geo.cells, ...geo.stages.map((s) => s.header)]
  const arrowProblems = []
  for (const a of geo.arrows) {
    const from = stageOf.get(a.from), to = stageOf.get(a.to)
    const p = a.path
    if (p.length > 4) arrowProblems.push(`arrows[${a.index}] has ${p.length - 2} bends (at most one jog = 2 bends)`)
    for (let i = 1; i < p.length; i++) {
      if (p[i].x !== p[i - 1].x && p[i].y !== p[i - 1].y) arrowProblems.push(`arrows[${a.index}] segment ${i} is diagonal`)
      const hit = boxes.find((b) => segmentThroughRect(p[i - 1], p[i], b))
      if (hit) arrowProblems.push(`arrows[${a.index}] segment ${i} passes through ${hit.stage ? `cell ${hit.stage}/${hit.slot}` : 'a stage header'}`)
    }
    if (p.some((pt) => pt.y > geo.gridBottom)) arrowProblems.push(`arrows[${a.index}] runs below the grid`)
    if (from && to) {
      const start = p[0], end = p[p.length - 1]
      const onBorder = (pt, s) => (pt.x === s.x || pt.x === s.x + s.width) && pt.y >= geo.header.y && pt.y <= geo.gridBottom
        || (pt.y === geo.header.y && pt.x >= s.x && pt.x <= s.x + s.width)
      if (!onBorder(start, from)) arrowProblems.push(`arrows[${a.index}] does not start on the border of stage "${a.from}"`)
      if (!onBorder(end, to)) arrowProblems.push(`arrows[${a.index}] does not end on the border of stage "${a.to}"`)
    }
  }
  rows.push({ id: 10, name: 'arrows-clear', severity: 'fail', ok: arrowProblems.length === 0, detail: arrowProblems.length ? arrowProblems.slice(0, 4).join('; ') : `${geo.arrows.length} arrow(s) run orthogonally between stage borders with at most one jog, none through a cell`, hint: arrowProblems.length ? 'route adjacent forward arrows through the column gap and every other arrow over the header band with one jog' : undefined })

  return rows
}

export const doc = {
  purpose: 'a stage × slot grid — what goes in, happens, comes out and is governed at each step of a process',
  whenToUse: 'when the reader must compare the *same* few facets (入力/処理/出力/統制) across sequential stages; not for who-hands-off-to-whom (use sequence or a swimlane) or for structure (use diagram). Budgets: stages ≤ 6, slots ≤ 4 (a stage × semantic-slot table of wrapped text — narrower than the survey\'s lane × step grid of fixed nodes on purpose), cell item ≤ 16 chars, filled cells ≤ 20, emphasis (the focal stage) exactly 1, focal cell ≤ 1 — guidance, over-budget figures still render with data-warn. Arrows: adjacent forward ones run through the column gap along the first row; any skip or return goes over the header band with one jog, never under the grid.',
  irExample: `id: release-process
type: process
title: リリース手順
caption: 各段階の入力・処理・出力を並べる
slots: [入力, 処理, 出力]
stages:
  - id: plan
    label: 計画
    cells:
      入力: 要望一覧
      処理: 優先順位付け
      出力: リリース計画
  - id: build
    label: 実装
    emphasis: true
    focal: 処理
    cells:
      入力: リリース計画
      処理: [実装, レビュー]
      出力: マージ済み PR
  - id: verify
    label: 検証
    cells:
      入力: マージ済み PR
      処理: [E2E, 手動確認]
      出力: 検証報告
  - id: ship
    label: 公開
    cells:
      入力: 検証報告
      処理: デプロイ
      出力: リリースノート
`,
  rows: ['stage-count', 'slot-count', 'cell-count', 'cell-text-length', 'emphasis-count', 'focal-count', 'references-exist', 'grid-aligned', 'text-inside-cells', 'arrows-clear'],
}
