// `type: treemap` — part-to-whole by area. Every item is a rectangle whose
// area is proportional to its value; a squarified layout (Bruls et al.)
// keeps the rectangles close to square so the reader can compare them.
// Two levels at most: a top-level item may carry `children`, which tile
// the inside of their parent's rectangle below a title band.
//
// IR shape: `{ id, type:'treemap', title, caption, unit?, items }`
//   items:    [{ id, label, value, emphasis, children? }] — a top-level item
//   children: [{ id, label, value, emphasis }]           — one level, no deeper
//   A parent's `value` is the sum of its children when omitted; when given
//   it must be ≥ that sum, and the remainder is drawn as an unlabeled
//   「その他」 cell (`<parent>--rest`) so the parent's area stays honest.
//
// Layout: a 720×432 frame, tiled exactly (no overlap, full coverage) on the
// 4px grid; each rect is drawn inset 1px so neighbours show a 2px gutter.
// Snapping to the grid moves an edge by ≤ 2px, so areas are verified
// proportional within 2% *beyond* that quantization bound (a 60×60 cell can
// never be 2%-exact on a 4px grid — the row states the slack it applied).
// Labels sit inside their rect when they fit (label + value, else label
// only); anything smaller is listed in a 「小さすぎて表示できない: …」
// footnote so no item silently disappears. Fills are neutral: one lightness
// per top-level item (largest darkest), children lighter inside it.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'treemap'

export const limits = { maxItems: 12, maxChildren: 8, maxLabelLen: 12, maxEmphasis: 2 }

// --- layout constants (px; positions land on the 4px grid) ---------------

const FRAME_W = COLUMN        // the tiled frame spans the column
const FRAME_H = 432           // ≤ 480 by contract
const GRID = 4
const INSET = 1               // each rect is drawn 1px inside its tile → 2px gutters
const BAND = 20               // title band of a parent that has children
const INNER_PAD = 4           // children tile the parent below the band, 4px in from the sides
const MIN_INNER = 16          // a parent narrower/shorter than this inside collapses to a leaf
const LABEL_PAD = 8           // text ↔ rect edge
const LABEL_Y = 16            // label baseline below the tile top
const VALUE_Y = 32            // value baseline below the tile top (second line)
const H_BOTH = 40             // tile height needed for label + value
const H_LABEL = 24            // tile height needed for the label alone
const FOOTNOTE_LINE = 16
const FOOTNOTE_GAP = 8
const OPACITY_MIN = 0.10      // top-level fill lightness ramp, largest item …
const OPACITY_MAX = 0.32      // … to smallest
const CHILD_OPACITY = 0.55    // children: page surface over the parent tint
const AREA_TOLERANCE = 0.02
const REST_LABEL = 'その他'
const REST_SUFFIX = '--rest'
const FOOTNOTE_PREFIX = '小さすぎて表示できない: '

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const unit = optStr(raw, 'unit', ctx)
  if (unit !== undefined && unit.trim() === '') throw new IrError(`${ctx}.unit must be a non-empty string`)
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new IrError(`${ctx}.items must be a non-empty list`)
  const seen = new Set()
  const items = raw.items.map((it, i) => normalizeItem(it, `${ctx}.items[${i}]`, seen, true))
  const out = { id, type, title, caption, items }
  if (unit !== undefined) out.unit = unit
  return out
}

function normalizeValue(obj, ctx) {
  const v = obj.value
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new IrError(`${ctx}.value must be a finite number > 0 (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeItem(raw, ctx, seen, allowChildren) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const id = requireStr(raw, 'id', ctx)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new IrError(`${ctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
  if (id.endsWith(REST_SUFFIX)) throw new IrError(`${ctx}.id must not end with "${REST_SUFFIX}" (reserved for the remainder cell)`)
  if (seen.has(id)) throw new IrError(`duplicate item id: "${id}"`)
  seen.add(id)
  const label = requireStr(raw, 'label', ctx)
  const emphasis = validateBool(raw, 'emphasis', ctx)
  const hasChildren = raw.children !== undefined && raw.children !== null
  if (hasChildren && !allowChildren) throw new IrError(`${ctx}.children: a treemap nests 2 levels at most`)
  if (!hasChildren) return { id, label, value: normalizeValue(raw, ctx), emphasis }
  if (!Array.isArray(raw.children) || raw.children.length === 0) throw new IrError(`${ctx}.children must be a non-empty list`)
  const children = raw.children.map((c, i) => normalizeItem(c, `${ctx}.children[${i}]`, seen, false))
  const sum = children.reduce((s, c) => s + c.value, 0)
  let value = sum
  if (raw.value !== undefined && raw.value !== null) {
    value = normalizeValue(raw, ctx)
    if (value < sum) throw new IrError(`${ctx}.value (${value}) is less than the sum of its children (${sum})`)
  }
  return { id, label, value, emphasis, children }
}

// --- budgets -------------------------------------------------------------

function allItems(ir) {
  const out = []
  for (const it of ir.items) {
    out.push({ item: it, parent: undefined })
    for (const c of it.children ?? []) out.push({ item: c, parent: it.id })
  }
  return out
}

const strLen = (s) => [...s].length

export function budgetWarnings(ir) {
  const out = []
  const n = ir.items.length
  if (n > limits.maxItems) {
    out.push(budgetWarning('budget:items', n, limits.maxItems,
      `${n} top-level item(s) (guidance ≤ ${limits.maxItems})`,
      'merge the smallest items into an 「その他」 item'))
  }
  const biggest = ir.items.reduce((m, it) => ((it.children?.length ?? 0) > (m ? m.children.length : 0) ? it : m), null)
  if (biggest && biggest.children.length > limits.maxChildren) {
    out.push(budgetWarning('budget:children', biggest.children.length, limits.maxChildren,
      `item "${biggest.id}" has ${biggest.children.length} children (guidance ≤ ${limits.maxChildren})`,
      `merge the smallest children of "${biggest.id}" into one`))
  }
  const all = allItems(ir)
  const longest = all.reduce((m, r) => (strLen(r.item.label) > (m ? strLen(m.item.label) : 0) ? r : m), null)
  if (longest && strLen(longest.item.label) > limits.maxLabelLen) {
    const len = strLen(longest.item.label)
    out.push(budgetWarning('budget:label', len, limits.maxLabelLen,
      `label of item "${longest.item.id}" is ${len} chars (guidance ≤ ${limits.maxLabelLen})`,
      `shorten label of item "${longest.item.id}" — a long label needs a wide cell to show at all`))
  }
  const emphasized = all.filter((r) => r.item.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized item(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two cells the decision is about'))
  }
  return out
}

// --- layout --------------------------------------------------------------

/** Thousands-separated, locale-independent (`12000` → `12,000`, `2.5` → `2.5`). */
function formatValue(v) {
  const [int, frac] = String(v).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

function valueText(v, unit) {
  const s = formatValue(v)
  if (!unit) return s
  return /^[%‰°]$/.test(unit) ? `${s}${unit}` : `${s} ${unit}`
}

/** The items a rect tiles: children sorted largest first, plus the
 * remainder cell when the parent's value exceeds the children's sum. */
function cellsOf(parent) {
  const kids = parent.children.map((c, i) => ({ ...c, order: i }))
  const sum = kids.reduce((s, c) => s + c.value, 0)
  if (parent.value > sum) kids.push({ id: `${parent.id}${REST_SUFFIX}`, label: REST_LABEL, value: parent.value - sum, emphasis: false, rest: true, order: kids.length })
  return kids
}

const byValueDesc = (a, b) => b.value - a.value || a.order - b.order

/**
 * Squarified layout in float space. `entries` are `[{ key, value }]`
 * (already sorted largest first); `rect` is `{ x, y, w, h }`. Returns one
 * `{ key, x1, y1, x2, y2 }` per entry. Every shared edge is the *same*
 * float on both sides (strip boundaries are stored once and reused; the
 * last item of a strip and the last strip end exactly on the rect edge),
 * so snapping each coordinate afterwards keeps the tiling exact.
 */
function squarify(entries, rect) {
  const total = entries.reduce((s, e) => s + e.value, 0)
  const scale = (rect.w * rect.h) / total
  const worst = (row, side) => {
    const s = row.reduce((a, e) => a + e.value * scale, 0)
    let m = 0
    for (const e of row) {
      const a = e.value * scale
      m = Math.max(m, (side * side * a) / (s * s), (s * s) / (side * side * a))
    }
    return m
  }
  const tiles = []
  let x = rect.x, y = rect.y, w = rect.w, h = rect.h
  const xEnd = rect.x + rect.w, yEnd = rect.y + rect.h
  let i = 0
  while (i < entries.length) {
    const side = Math.min(w, h)
    const row = [entries[i]]
    i++
    while (i < entries.length && worst(row, side) >= worst([...row, entries[i]], side)) { row.push(entries[i]); i++ }
    const area = row.reduce((s, e) => s + e.value * scale, 0)
    const last = i >= entries.length
    if (w >= h) {
      // a vertical strip on the left, `t` wide
      const t = area / h
      const x2 = last ? xEnd : x + t
      let cy = y
      row.forEach((e, k) => {
        const y2 = k === row.length - 1 ? yEnd : cy + (e.value * scale) / t
        tiles.push({ key: e.key, x1: x, y1: cy, x2, y2 })
        cy = y2
      })
      x = x2
      w = xEnd - x
    } else {
      const t = area / w
      const y2 = last ? yEnd : y + t
      let cx = x
      row.forEach((e, k) => {
        const x2 = k === row.length - 1 ? xEnd : cx + (e.value * scale) / t
        tiles.push({ key: e.key, x1: cx, y1: y, x2, y2 })
        cx = x2
      })
      y = y2
      h = yEnd - y
    }
  }
  return tiles
}

/** Float tiles → grid tiles `{ x, y, width, height }` (may be zero-sized). */
function snapTiles(tiles) {
  return tiles.map((t) => {
    const x = snap4(t.x1), y = snap4(t.y1)
    return { key: t.key, x, y, width: snap4(t.x2) - x, height: snap4(t.y2) - y }
  })
}

const labelW = (text, bold) => Math.ceil(textWidth(text, FONT_SIZE) * (bold ? BOLD_FACTOR : 1))
const valueW = (text) => Math.ceil(textWidth(text, EDGE_LABEL_SIZE))

/** Which of label / value fit inside a leaf tile of `width × height`. */
function fitLeaf(tile, item, vText) {
  const lw = labelW(item.label, item.emphasis)
  const vw = valueW(vText)
  const inner = tile.width - 2 * INSET - 2 * LABEL_PAD
  const innerH = tile.height - 2 * INSET
  if (innerH >= H_BOTH && lw <= inner && vw <= inner) return 'both'
  if (innerH >= H_LABEL && lw <= inner) return 'label'
  return 'none'
}

function leafCell(tile, item, ir, opts) {
  const vText = valueText(item.value, ir.unit)
  const fit = fitLeaf(tile, item, vText)
  const cell = {
    id: item.id, label: item.label, value: item.value, valueText: vText, emphasis: item.emphasis,
    x: tile.x, y: tile.y, width: tile.width, height: tile.height,
    kind: 'leaf', fit, hidden: tile.width < GRID || tile.height < GRID, ...opts,
  }
  if (cell.hidden) cell.fit = 'none'
  if (cell.fit !== 'none') cell.labelBox = { x: tile.x + LABEL_PAD, y: tile.y + LABEL_Y, width: labelW(item.label, item.emphasis), height: FONT_SIZE }
  if (cell.fit === 'both') cell.valueBox = { x: tile.x + LABEL_PAD, y: tile.y + VALUE_Y, width: valueW(vText), height: EDGE_LABEL_SIZE }
  if (item.rest) cell.rest = true
  return cell
}

export async function layout(ir) {
  const top = ir.items.map((it, i) => ({ ...it, order: i })).sort(byValueDesc)
  const n = top.length
  const frame = { x: 0, y: 0, width: FRAME_W, height: FRAME_H }
  const tiles = snapTiles(squarify(top.map((it) => ({ key: it.id, value: it.value })), { x: 0, y: 0, w: FRAME_W, h: FRAME_H }))
  const cells = []
  top.forEach((it, rank) => {
    const tile = tiles[rank]
    const opacity = Number((n === 1 ? OPACITY_MIN : OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * rank / (n - 1)).toFixed(2))
    if (!it.children) { cells.push(leafCell(tile, it, ir, { opacity, rank })); return }
    const inner = { x: tile.x + INNER_PAD, y: tile.y + BAND, width: tile.width - 2 * INNER_PAD, height: tile.height - BAND - INNER_PAD }
    const collapsed = inner.width < MIN_INNER || inner.height < MIN_INNER
    if (collapsed) {
      const leaf = leafCell(tile, it, ir, { opacity, rank })
      leaf.kind = 'collapsed'
      leaf.children = cellsOf(it).map((c) => ({ id: c.id, label: c.label, value: c.value, valueText: valueText(c.value, ir.unit), hidden: true, fit: 'none' }))
      cells.push(leaf)
      return
    }
    const vText = valueText(it.value, ir.unit)
    const lw = labelW(it.label, it.emphasis)
    const vw = valueW(vText)
    const bandInner = tile.width - 2 * INSET - 2 * LABEL_PAD
    const fit = lw <= bandInner ? (lw + LABEL_PAD + vw <= bandInner ? 'both' : 'label') : 'none'
    const group = {
      id: it.id, label: it.label, value: it.value, valueText: vText, emphasis: it.emphasis,
      x: tile.x, y: tile.y, width: tile.width, height: tile.height,
      kind: 'group', fit, hidden: false, opacity, rank, inner,
    }
    if (fit !== 'none') group.labelBox = { x: tile.x + LABEL_PAD, y: tile.y + LABEL_Y, width: lw, height: FONT_SIZE }
    if (fit === 'both') group.valueBox = { x: snapUp4(tile.x + LABEL_PAD + lw + LABEL_PAD), y: tile.y + LABEL_Y, width: vw, height: EDGE_LABEL_SIZE }
    const kids = cellsOf(it).sort(byValueDesc)
    const kidTiles = snapTiles(squarify(kids.map((c) => ({ key: c.id, value: c.value })), { x: inner.x, y: inner.y, w: inner.width, h: inner.height }))
    group.children = kids.map((c, k) => leafCell(kidTiles[k], c, ir, { parent: it.id }))
    cells.push(group)
  })

  // footnote: every item that shows no label, in layout order
  const tiny = []
  for (const c of cells) {
    if (c.fit === 'none') tiny.push(c)
    for (const k of c.children ?? []) if (k.fit === 'none') tiny.push(k)
  }
  let footnote = null
  let height = FRAME_H
  if (tiny.length) {
    const lines = wrapFootnote(tiny.map((c) => `${c.label} (${c.valueText})`), FRAME_W - 2 * LABEL_PAD)
    footnote = { x: LABEL_PAD, y: FRAME_H + FOOTNOTE_GAP + 12, lines, items: tiny.map((c) => c.id) }
    height = snapUp4(FRAME_H + FOOTNOTE_GAP + lines.length * FOOTNOTE_LINE + FOOTNOTE_GAP)
  }
  return { width: FRAME_W, height, geo: { frame, cells, footnote } }
}

/** Pack `entries` into lines of ≤ `maxW` px at 11px; the first line carries the prefix. */
function wrapFootnote(entries, maxW) {
  const lines = []
  let cur = FOOTNOTE_PREFIX
  let curW = textWidth(cur, EDGE_LABEL_SIZE)
  let first = true
  for (const e of entries) {
    const piece = first ? e : `, ${e}`
    const pw = textWidth(piece, EDGE_LABEL_SIZE)
    if (!first && curW + pw > maxW) {
      lines.push(cur + ',')
      cur = e
      curW = textWidth(e, EDGE_LABEL_SIZE)
    } else {
      cur += piece
      curW += pw
    }
    first = false
  }
  lines.push(cur)
  return lines
}

// --- draw ----------------------------------------------------------------

function rectAttrs(c) {
  return `x="${c.x + INSET}" y="${c.y + INSET}" width="${c.width - 2 * INSET}" height="${c.height - 2 * INSET}"`
}

function drawText(uid, c, suffix, box, size, extra, text) {
  return `<text id="${uid}-${c.id}-${suffix}" x="${box.x}" y="${box.y}" font-size="${size}"${extra}>${esc(text)}</text>`
}

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  const focal = []
  const emit = (c, fill) => {
    if (c.hidden) return
    const bold = c.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-${c.id}" data-value="${c.value}"${c.rest ? ' data-rest="true"' : ''} ${rectAttrs(c)} rx="4" ${fill}/>`)
    if (c.labelBox) parts.push(drawText(uid, c, 'label', c.labelBox, FONT_SIZE, `${bold} fill="currentColor"`, c.label))
    if (c.valueBox) parts.push(drawText(uid, c, 'value', c.valueBox, EDGE_LABEL_SIZE, ' fill="var(--wu-ink-3)"', c.valueText))
    if (c.emphasis) focal.push(`<rect id="${uid}-${c.id}-focal" class="wu-focal" ${rectAttrs(c)} rx="4" fill="none" stroke="var(--wu-accent)" stroke-width="1.5"/>`)
  }
  for (const c of geo.cells) {
    emit(c, `fill="currentColor" fill-opacity="${c.opacity}"`)
    for (const k of c.children ?? []) if (c.kind === 'group') emit(k, `fill="var(--wu-surface)" fill-opacity="${CHILD_OPACITY}"`)
  }
  parts.push(...focal)
  if (geo.footnote) {
    geo.footnote.lines.forEach((line, i) => {
      parts.push(`<text id="${uid}-footnote-${i}" x="${geo.footnote.x}" y="${geo.footnote.y + i * FOOTNOTE_LINE}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(line)}</text>`)
    })
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------

const right = (r) => r.x + r.width
const bottom = (r) => r.y + r.height
const overlaps = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
const inside = (a, r) => a.x >= r.x && a.y >= r.y && right(a) <= right(r) && bottom(a) <= bottom(r)

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 4).join('; '), hint: ok ? undefined : hint }
}

/** area error allowed for a tile: 2% of the expected area, or the grid
 * quantization bound (every edge may sit ≤ 2px off its float position). */
const slack = (expected, t) => Math.max(AREA_TOLERANCE * expected, GRID * (t.width + t.height) + GRID * GRID)

export function verify(layoutResult, ir, { svg = '' } = {}) {
  const { geo } = layoutResult
  const { frame, cells, footnote } = geo
  const uid = `wu-d-${ir.id}`
  const rows = []

  // 1. areas proportional: top-level vs the frame, children vs their parent's inner area
  const off = []
  let worst = 0
  const checkSet = (set, region, values, what) => {
    const total = values.reduce((s, v) => s + v, 0)
    const area = region.width * region.height
    set.forEach((c, i) => {
      const expected = area * values[i] / total
      const actual = c.width * c.height
      const err = Math.abs(actual - expected)
      if (expected > 0) worst = Math.max(worst, err / expected)
      if (err > slack(expected, c)) off.push(`${what}${c.id} (${actual}px² vs ${expected.toFixed(0)}px² expected)`)
    })
  }
  const byId = new Map(ir.items.map((it) => [it.id, it]))
  checkSet(cells, frame, cells.map((c) => byId.get(c.id)?.value ?? NaN), '')
  for (const c of cells) {
    if (c.kind !== 'group') continue
    checkSet(c.children, c.inner, c.children.map((k) => k.value), `${c.id}/`)
  }
  rows.push(failRow(1, 'areas-proportional', off,
    `every area within max(2%, grid slack) of value/total (worst ${(worst * 100).toFixed(1)}%)`,
    'lay every cell out from value/total × the region area; only grid snapping may move an edge, by ≤ 2px'))

  // 2. tiling: no overlap, every tile inside its region, areas summing to the region
  const tiling = []
  const checkTiling = (set, region, what) => {
    let sum = 0
    set.forEach((c, i) => {
      sum += c.width * c.height
      if (c.width < 0 || c.height < 0) tiling.push(`${what}${c.id} has a negative size`)
      if (!inside(c, region)) tiling.push(`${what}${c.id} leaves its region`)
      if (c.x % GRID || c.y % GRID || c.width % GRID || c.height % GRID) tiling.push(`${what}${c.id} is off the 4px grid`)
      for (let j = i + 1; j < set.length; j++) if (overlaps(c, set[j])) tiling.push(`${what}${c.id} overlaps ${set[j].id}`)
    })
    if (sum !== region.width * region.height) tiling.push(`${what || 'frame'}: tiles cover ${sum}px² of ${region.width * region.height}px²`)
  }
  checkTiling(cells, frame, '')
  for (const c of cells) {
    if (c.kind !== 'group') continue
    if (!inside(c.inner, c) || c.inner.y < c.y + BAND) tiling.push(`${c.id}: inner region leaves the tile or covers the title band`)
    checkTiling(c.children, c.inner, `${c.id}/`)
  }
  if (cells.length !== ir.items.length) tiling.push(`${cells.length} top-level cell(s) for ${ir.items.length} item(s)`)
  rows.push(failRow(2, 'tiling', tiling,
    `${cells.length} top-level tile(s) cover the ${frame.width}×${frame.height} frame exactly; children tile their parent below its band`,
    'tiles of one region must not overlap and must sum to the region — snap shared edges once, from the same float'))

  // 3. every drawn label sits inside its rect (and the svg carries it)
  const labels = []
  const checkLabel = (c, region) => {
    if (c.fit === 'none' || c.hidden) return
    const r = { x: c.x + LABEL_PAD, y: c.y + INSET, width: c.width - 2 * LABEL_PAD, height: c.height - 2 * INSET }
    const boxes = [['label', c.labelBox, FONT_SIZE]]
    if (c.fit === 'both') boxes.push(['value', c.valueBox, EDGE_LABEL_SIZE])
    for (const [kind, b, size] of boxes) {
      if (!b) { labels.push(`${c.id} ${kind} box missing`); continue }
      const top = b.y - size
      if (b.x < r.x || b.x + b.width > right(r) || top < r.y || b.y + 3 > bottom(r)) labels.push(`${c.id} ${kind} runs outside its rect`)
      else if (svg && !svg.includes(`id="${uid}-${c.id}-${kind}"`)) labels.push(`${c.id} ${kind} not drawn`)
    }
    if (c.kind === 'group' && c.labelBox && c.labelBox.y > c.y + BAND) labels.push(`${c.id} label below its title band`)
    if (c.kind === 'group') for (const k of c.children) if (k.fit !== 'none' && k.y < c.y + BAND) labels.push(`${k.id} covers the title band of ${c.id}`)
  }
  for (const c of cells) {
    checkLabel(c, frame)
    if (c.kind === 'group') for (const k of c.children) checkLabel(k, c.inner)
  }
  const shown = cells.reduce((n, c) => n + (c.fit !== 'none' ? 1 : 0) + (c.children ?? []).filter((k) => k.fit !== 'none').length, 0)
  rows.push(failRow(3, 'labels-inside', labels,
    `${shown} label(s) drawn, each inside its own rect`,
    'a label that does not fit its rect must be dropped and disclosed in the footnote, never drawn across a neighbour'))

  // 4. tiny items disclosed: every unlabeled item is in the footnote, which is in the svg; no footnote otherwise
  const tinyProblems = []
  const tiny = []
  for (const c of cells) {
    if (c.fit === 'none') tiny.push(c)
    for (const k of c.children ?? []) if (k.fit === 'none') tiny.push(k)
  }
  const text = footnote ? footnote.lines.join(' ') : ''
  for (const c of tiny) {
    if (!footnote || !footnote.items.includes(c.id) || !text.includes(`${c.label} (${c.valueText})`)) tinyProblems.push(`${c.id} not listed in the footnote`)
  }
  if (tiny.length === 0 && footnote) tinyProblems.push('footnote present without tiny items')
  if (footnote) {
    if (!footnote.lines[0].startsWith(FOOTNOTE_PREFIX)) tinyProblems.push(`footnote does not start with 「${FOOTNOTE_PREFIX.trim()}」`)
    if (svg && !svg.includes(`id="${uid}-footnote-0"`)) tinyProblems.push('footnote missing from the svg')
    if (footnote.y - 12 < frame.y + frame.height) tinyProblems.push('footnote overlaps the frame')
  }
  rows.push(failRow(4, 'tiny-disclosed', tinyProblems,
    tiny.length ? `${tiny.length} item(s) too small for a label, listed in the footnote` : 'every item shows its label',
    'an item whose rect cannot hold its label must be listed in the 「小さすぎて表示できない: …」 footnote with its value'))

  // 5–8. budgets
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  const all = allItems(ir)
  warnRow(5, 'item-count', 'budget:items', `${ir.items.length} top-level item(s)`)
  warnRow(6, 'children-count', 'budget:children', `at most ${Math.max(0, ...ir.items.map((it) => it.children?.length ?? 0))} children per item`)
  warnRow(7, 'label-length', 'budget:label', `every label within ${limits.maxLabelLen} chars`)
  warnRow(8, 'emphasis-count', 'budget:emphasis', `${all.filter((r) => r.item.emphasis).length} emphasized item(s)`)
  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'part-to-whole by area — nested rectangles sized to their value (cost split, effort allocation, storage by team)',
  whenToUse: 'when *relative size* is the point and there are more parts than a bar chart reads well with; not for exact values (use bar), containment without quantities (use nested) or parent–child tracing (use tree). Two levels at most. Budgets: items ≤ 12, children ≤ 8 per item, label ≤ 12 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: cloud-cost
type: treemap
title: 月次クラウド費用の内訳
caption: 計算資源が 6 割、その半分はバッチ基盤
unit: 万円
items:
  - id: compute
    label: 計算資源
    children:
      - id: batch
        label: バッチ基盤
        value: 310
        emphasis: true
      - id: api
        label: API サーバ
        value: 180
      - id: dev
        label: 開発環境
        value: 90
  - id: storage
    label: ストレージ
    children:
      - id: warehouse
        label: DWH
        value: 150
      - id: object
        label: オブジェクト
        value: 70
      - id: backup
        label: バックアップ
        value: 40
  - id: network
    label: ネットワーク
    children:
      - id: egress
        label: 転送量
        value: 85
      - id: cdn
        label: CDN
        value: 35
`,
  rows: ['areas-proportional', 'tiling', 'labels-inside', 'tiny-disclosed', 'item-count', 'children-count', 'label-length', 'emphasis-count'],
}
