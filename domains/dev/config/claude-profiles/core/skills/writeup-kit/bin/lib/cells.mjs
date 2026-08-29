// cells.mjs — the `.wu-cells` component: one thing split into labelled
// parts, drawn as adjacent boxes in a strip.
//
// This module holds the *shared* half of the component — the legacy
// `:::cells` line grammar, the old-tone → kit-tone map, the accent budget,
// and the HTML builder — so bin/lib/migrate/directives.mjs and the tests
// agree on one implementation. The component itself is static HTML a writer
// types (see references/components.md); nothing here runs at build time.
//
// Line grammar (explain-pages, surveyed over 119 real blocks in 81 files):
//
//   row <label> | <cell> | <cell> …     label may be empty (`row | a | b`)
//   note <text> [@tone]                 0–4 per block, interleaved with rows
//
// A cell is `<text>[@tone][*count]`, in either suffix order, where:
//   `_`      the cell is empty — a blank span that offsets what follows
//   `@tone`  one of accent / primary / danger / attention / warning /
//            success / default / muted (see TONE_MAP)
//   `*count` a span weight, not a repetition: the source uses it for both
//            "6 items" and "99.9 % of the width" (counts run 1…999). It
//            always drives width; it is *shown* as `×N` only when the
//            source wrote it before the tone (`text*6@attention`), which
//            in the corpus is exactly the spelling used where N is a real
//            count rather than a proportion.

/** Kit tones, darkest fill first. `key` is the accent — budget 1 per block. */
export const CELL_TONES = ['key', 'strong', 'base', 'soft', 'ghost']

/** old explain-pages tone → kit tone. No green, no red: the whole ladder is
 * the neutral fill scale plus `--wu-accent` for the one focal cell. */
export const TONE_MAP = {
  accent: 'key',
  primary: 'key',
  danger: 'strong',
  attention: 'base',
  warning: 'base',
  default: 'base',
  neutral: 'base',
  success: 'soft',
  muted: 'ghost',
}

const DEFAULT_TONE = 'base'
/** `label=value` only when nothing around the `=` is whitespace — the corpus
 * also writes prose like `QNAME = ラベル形式 13 バイト`, which is one label. */
const LABEL_VALUE_RE = /^([^\s=]+)=([^\s=]+)$/

/** Parses one `<text>[@tone][*count]` cell segment. */
export function parseCell(raw) {
  let text = String(raw).trim()
  let oldTone
  let count
  let toneIdx = -1
  let countIdx = -1
  const toneMatch = /@([a-zA-Z]+)/.exec(text)
  if (toneMatch) {
    oldTone = toneMatch[1]
    toneIdx = toneMatch.index
    text = (text.slice(0, toneMatch.index) + text.slice(toneMatch.index + toneMatch[0].length)).trim()
  }
  const countMatch = /\*(\d+)/.exec(text)
  if (countMatch) {
    count = Number(countMatch[1])
    // index in the *original* string, so the two suffixes can be ordered
    countIdx = countMatch.index + (toneIdx !== -1 && countMatch.index >= toneIdx ? toneMatch[0].length : 0)
    text = (text.slice(0, countMatch.index) + text.slice(countMatch.index + countMatch[0].length)).trim()
  }
  const empty = text === '_' || text === ''
  if (empty) text = ''
  let label = text
  let value
  const lv = LABEL_VALUE_RE.exec(text)
  if (lv) { label = lv[1]; value = lv[2] }
  // `*N` before `@tone` (or with no tone at all) is the corpus's "this is a
  // count" spelling; `text@tone*N` is the "this is a width" spelling.
  const countFirst = count !== undefined && (toneIdx === -1 || countIdx < toneIdx)
  return {
    text,
    label,
    value,
    empty,
    oldTone,
    count,
    span: count !== undefined && count > 1 ? count : undefined,
    showCount: Boolean(count !== undefined && countFirst && !empty),
  }
}

/** old tone (or undefined) → kit tone, with `_` cells always `ghost`. */
export function mapTone(oldTone, { empty = false } = {}) {
  if (empty) return 'ghost'
  if (!oldTone) return DEFAULT_TONE
  return TONE_MAP[oldTone] ?? DEFAULT_TONE
}

/** Strips a trailing `@tone` off a note line and returns the prose. */
export function parseNote(raw) {
  const text = String(raw).trim()
  const m = /\s*@([a-zA-Z]+)\s*$/.exec(text)
  if (!m) return { text, oldTone: undefined }
  return { text: text.slice(0, m.index).trim(), oldTone: m[1] }
}

/**
 * Parses a whole `:::cells` body into `{ items, warnings }`, where an item is
 * `{ kind: 'row', label, cells }` or `{ kind: 'note', text }`, in source order.
 * Tones are already mapped and the accent budget already applied.
 */
export function parseCells(body) {
  const warnings = []
  const items = []
  for (const rawLine of String(body).split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (/^row\b/.test(line) || line === 'row') {
      const rest = line.slice(3).trim()
      const segs = rest.split('|')
      const label = segs.shift().trim()
      const cells = segs.map((s) => {
        const c = parseCell(s)
        if (c.oldTone && !(c.oldTone in TONE_MAP)) warnings.push(`cells: unknown tone "@${c.oldTone}" mapped to ${DEFAULT_TONE}`)
        return { ...c, tone: mapTone(c.oldTone, { empty: c.empty }) }
      })
      if (cells.length === 0) warnings.push(`cells: row has no cells: ${line}`)
      items.push({ kind: 'row', label, cells })
    } else if (/^note\b/.test(line) || line === 'note') {
      items.push({ kind: 'note', ...parseNote(line.slice(4)) })
    } else {
      warnings.push(`cells: unrecognized line skipped: ${line}`)
    }
  }
  // Accent budget: the kit spends `--wu-accent` on one "this is the point"
  // cell per component. The corpus routinely paints a whole band `@accent`
  // (up to 9 cells in one block); when more than one cell claims the accent
  // nobody gets it and the band drops one step down the neutral ladder,
  // which keeps the contrast the band was drawing on.
  const keys = items.filter((it) => it.kind === 'row').flatMap((r) => r.cells).filter((c) => c.tone === 'key')
  if (keys.length > 1) {
    for (const c of keys) c.tone = 'strong'
    warnings.push(`cells: ${keys.length} accent cells in one strip — demoted to the neutral scale (accent budget: 1)`)
  }
  return { items, warnings }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One cell's inline markup. `inline` renders the cell text (Markdown inline
 * during migration, plain escaping otherwise). */
function cellHtml(cell, inline) {
  const attrs = [`class="wu-cell"`, `data-tone="${esc(cell.tone)}"`]
  if (cell.span) {
    attrs.push(`data-count="${cell.span}"`)
    // `data-count` covers 2–12 from the stylesheet; past that the weight has
    // to ride on the element (the corpus goes to 999 for an SLO budget).
    if (cell.span > 12) attrs.push(`style="--wu-cell-span:${cell.span}"`)
  }
  const parts = []
  if (cell.value !== undefined) {
    parts.push(`<span class="wu-cell-label">${inline(cell.label)}</span>`)
    parts.push(`<span class="wu-cell-value">${inline(cell.value)}</span>`)
  } else if (cell.text) {
    parts.push(inline(cell.text))
  }
  if (cell.showCount) parts.push(`<span class="wu-cell-count">×${cell.count}</span>`)
  return `<span ${attrs.join(' ')}>${parts.join('')}</span>`
}

/**
 * Builds the `.wu-cells` markup for a parsed block.
 * @param {{items: Array}} parsed
 * @param {{title?: string, inline?: (s: string) => string}} [opts]
 */
export function cellsHtml(parsed, opts = {}) {
  const inline = opts.inline ?? esc
  const rows = parsed.items.filter((it) => it.kind === 'row')
  // A block's rows are read against each other ("多い ×6 / 中くらい ×3 /
  // 少ない ×1", "99.9 % vs 0.1 %"), so every row has to share one width
  // scale. Each row is its own flex line, which would stretch a short row
  // to full width, so a short row is padded to the widest row's total with
  // a borderless filler cell.
  const totals = rows.map((r) => rowSpan(r))
  const widest = totals.length ? Math.max(...totals) : 0
  // A block that labels any row keeps the label gutter on every row, so a
  // label-less row (the corpus uses one as a column header: `row | 意図的 |
  // 不注意`) still lines its parts up with the rows above it.
  const anyLabel = rows.some((r) => r.label)
  const out = ['<div class="wu-cells">']
  if (opts.title) out.push(`<p class="wu-cells-title">${inline(opts.title)}</p>`)
  let rowIndex = 0
  for (const item of parsed.items) {
    if (item.kind === 'note') {
      out.push(`<p class="wu-cells-note">${inline(item.text)}</p>`)
      continue
    }
    const bits = []
    if (item.label) bits.push(`<span class="wu-cells-label">${inline(item.label)}</span>`)
    else if (anyLabel) bits.push('<span class="wu-cells-label"></span>')
    for (const c of item.cells) bits.push(cellHtml(c, inline))
    const slack = widest - totals[rowIndex++]
    if (slack > 0) bits.push(fillerHtml(slack))
    out.push(`<div class="wu-cells-row">${bits.join('')}</div>`)
  }
  out.push('</div>')
  return out.join('\n')
}

/** Total span weight of one row (a cell with no `*N` weighs 1). */
export function rowSpan(row) {
  return row.cells.reduce((n, c) => n + (c.span ?? 1), 0)
}

/** The borderless spacer that pads a short row to the block's widest row. */
function fillerHtml(span) {
  const attrs = ['class="wu-cell"', 'data-tone="ghost"', 'data-fill="1"', `data-count="${span}"`, 'aria-hidden="true"']
  if (span > 12) attrs.push(`style="--wu-cell-span:${span}"`)
  return `<span ${attrs.join(' ')}></span>`
}
