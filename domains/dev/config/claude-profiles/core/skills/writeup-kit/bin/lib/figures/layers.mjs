// `type: layers` — a layer stack: full-width bands stacked top to bottom
// (UI / API / domain / storage, OSI, a runtime stack), each band optionally
// holding items (the components living in that layer, wrapped ≤ 4 per row),
// an optional right-hand side column aligned band by band (a control
// catalog — "which layer enforces what"), and optional vertical arrows
// between adjacent bands drawn in the gap between them.
//
// IR shape: `{ id, type:'layers', title, caption, layers, side?, arrows? }`
//   layers: [{ id, label, tone, emphasis, items: [{ id, label, tone }] }]
//           ordered top → bottom; a raw item may be a bare string (its id is
//           derived as `<layerId>-<n>`) or `{ id, label, tone? }`
//   side:   { label, items: [{ layer, text }] } — `layer` names a layer id
//   arrows: [{ from, to, label }] — layer ids; adjacency is a verify row
//
// Only a true abstraction stack belongs here (design survey #16): when the
// bands are not ranked, the reader wants a swimlane or a node/edge diagram.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'layers'

export const limits = { maxLayers: 7, maxItemsPerLayer: 8, maxLabelLen: 14, maxEmphasis: 2 }

// --- layout constants (px, all multiples of 4 where they become positions) --

const PAD = 16            // canvas margin
const BAND_GAP = 8        // between bands without arrows
const ARROW_GAP = 32      // between bands when any arrow is declared
const BAND_MIN_H = 48
const BAND_PAD = 12       // item ↔ band edge clearance (verify demands ≥ 8)
const NUM_W = 24          // index number column inside the band
const TITLE_PAD = 12
const ITEM_H = 28
const ITEM_GAP = 8
const ITEM_PAD_X = 12
const ITEM_MIN_W = 72
const ITEMS_PER_ROW = 4
const SIDE_GAP = 16
const SIDE_PAD = 8
const SIDE_LINE = 16
const SIDE_HEADER = 24
const ARROW_X = 40        // arrow shaft offset from the band's left edge
const ARROW_PAIR = 16     // second shaft (opposite direction) offset

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const layers = normalizeLayers(raw.layers, ctx)
  const layerIds = new Set(layers.map((l) => l.id))
  const out = { id, type, title, caption, layers }
  const side = normalizeSide(raw.side, layerIds, ctx)
  if (side) out.side = side
  const arrows = normalizeArrows(raw.arrows, layerIds, ctx)
  if (arrows.length) out.arrows = arrows
  return out
}

function normalizeLayers(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.layers must be a non-empty list`)
  const seenLayer = new Set()
  const seenItem = new Set()
  return raw.map((l, i) => {
    const lctx = `${ctx}.layers[${i}]`
    if (!isObj(l)) throw new IrError(`${lctx} must be a mapping`)
    const id = requireStr(l, 'id', lctx)
    if (seenLayer.has(id)) throw new IrError(`duplicate layer id: "${id}"`)
    seenLayer.add(id)
    const label = requireStr(l, 'label', lctx)
    const tone = validateTone(l.tone, lctx)
    const emphasis = validateBool(l, 'emphasis', lctx)
    const items = normalizeItems(l.items, id, seenItem, lctx)
    return { id, label, tone, emphasis, items }
  })
}

function normalizeItems(raw, layerId, seenItem, lctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${lctx}.items must be a list`)
  return raw.map((it, j) => {
    const ictx = `${lctx}.items[${j}]`
    let rec
    if (typeof it === 'string') {
      if (it.trim() === '') throw new IrError(`${ictx} must be a non-empty string`)
      rec = { id: `${layerId}-${j + 1}`, label: it, tone: 'neutral' }
    } else if (isObj(it)) {
      rec = { id: requireStr(it, 'id', ictx), label: requireStr(it, 'label', ictx), tone: validateTone(it.tone, ictx) }
    } else {
      throw new IrError(`${ictx} must be a string or a mapping`)
    }
    if (seenItem.has(rec.id)) throw new IrError(`duplicate item id: "${rec.id}"`)
    seenItem.add(rec.id)
    return rec
  })
}

function normalizeSide(raw, layerIds, ctx) {
  if (raw === undefined || raw === null) return undefined
  const sctx = `${ctx}.side`
  if (!isObj(raw)) throw new IrError(`${sctx} must be a mapping`)
  const label = requireStr(raw, 'label', sctx)
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new IrError(`${sctx}.items must be a non-empty list`)
  const items = raw.items.map((e, i) => {
    const ectx = `${sctx}.items[${i}]`
    if (!isObj(e)) throw new IrError(`${ectx} must be a mapping`)
    const layer = requireStr(e, 'layer', ectx)
    if (!layerIds.has(layer)) throw new IrError(`${ectx}.layer references unknown layer "${layer}"`)
    const text = requireStr(e, 'text', ectx)
    return { layer, text }
  })
  return { label, items }
}

function normalizeArrows(raw, layerIds, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.arrows must be a list`)
  return raw.map((a, i) => {
    const actx = `${ctx}.arrows[${i}]`
    if (!isObj(a)) throw new IrError(`${actx} must be a mapping`)
    const from = requireStr(a, 'from', actx)
    const to = requireStr(a, 'to', actx)
    if (!layerIds.has(from)) throw new IrError(`${actx}.from references unknown layer "${from}"`)
    if (!layerIds.has(to)) throw new IrError(`${actx}.to references unknown layer "${to}"`)
    if (from === to) throw new IrError(`${actx}: from and to must differ`)
    const label = optStr(a, 'label', actx) ?? ''
    return { from, to, label }
  })
}

// --- budgets -------------------------------------------------------------

function longestLabel(ir) {
  let best = ''
  for (const l of ir.layers) {
    if (l.label.length > best.length) best = l.label
    for (const it of l.items) if (it.label.length > best.length) best = it.label
  }
  return best
}

export function budgetWarnings(ir) {
  const out = []
  const n = ir.layers.length
  if (n > limits.maxLayers) {
    out.push(budgetWarning('budget:layers', n, limits.maxLayers,
      `${n} layer(s) (guidance ≤ ${limits.maxLayers})`,
      'merge neighbouring layers or split the stack into two figures'))
  }
  const fattest = ir.layers.reduce((m, l) => (l.items.length > m.items.length ? l : m), ir.layers[0])
  if (fattest.items.length > limits.maxItemsPerLayer) {
    out.push(budgetWarning('budget:items', fattest.items.length, limits.maxItemsPerLayer,
      `layer "${fattest.id}" holds ${fattest.items.length} item(s) (guidance ≤ ${limits.maxItemsPerLayer})`,
      `group the items of "${fattest.id}" or move the detail into a nested figure`))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and move the detail into the caption or the side column'))
  }
  const emphasized = ir.layers.filter((l) => l.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized layer(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two layers the decision is about'))
  }
  return out
}

// --- layout --------------------------------------------------------------

const boldWidth = (text, size = FONT_SIZE) => Math.ceil(textWidth(text, size) * BOLD_FACTOR)

/**
 * A fixed grid, fully deterministic. Bands are stretched to fill the 720px
 * column when the content needs less, so a short stack still reads full
 * width; when the content needs more the canvas grows and the dispatcher
 * decides between scaling and the scroll fallback.
 */
export async function layout(ir, { column = COLUMN } = {}) {
  const hasSide = Boolean(ir.side)
  const arrows = ir.arrows ?? []
  const gap = arrows.length ? ARROW_GAP : BAND_GAP

  // title column: index number + label (bold when emphasized)
  const titleW = ir.layers.reduce((m, l) => Math.max(m, boldWidth(l.label)), 0)
  const titleColW = snapUp4(NUM_W + titleW + TITLE_PAD * 2)

  // items: one uniform width across the figure, ≤ 4 per row
  const allItems = ir.layers.flatMap((l) => l.items)
  const itemW = allItems.length
    ? snapUp4(Math.max(ITEM_MIN_W, allItems.reduce((m, it) => Math.max(m, Math.ceil(textWidth(it.label)) + ITEM_PAD_X * 2), 0)))
    : 0
  const maxItems = ir.layers.reduce((m, l) => Math.max(m, l.items.length), 0)
  const perRow = Math.min(ITEMS_PER_ROW, maxItems)
  const itemsW = perRow ? perRow * itemW + (perRow - 1) * ITEM_GAP + BAND_PAD * 2 : 0

  // side column: header label and the longest entry decide the width
  const sideByLayer = new Map()
  if (hasSide) {
    for (const e of ir.side.items) {
      if (!sideByLayer.has(e.layer)) sideByLayer.set(e.layer, [])
      sideByLayer.get(e.layer).push(e)
    }
  }
  const sideTextW = hasSide
    ? Math.max(boldWidth(ir.side.label, EDGE_LABEL_SIZE), ...ir.side.items.map((e) => Math.ceil(textWidth(e.text, EDGE_LABEL_SIZE))))
    : 0
  const sideW = hasSide ? snapUp4(sideTextW + SIDE_PAD * 2) : 0

  const bandX = PAD
  const neededBandW = snapUp4(titleColW + itemsW)
  const fixed = PAD * 2 + (hasSide ? SIDE_GAP + sideW : 0)
  const bandW = Math.max(neededBandW, snap4(column - fixed), 160)
  const width = snapUp4(fixed + bandW)
  const sideX = bandX + bandW + SIDE_GAP

  let y = PAD + (hasSide ? SIDE_HEADER : 0)
  const bands = []
  const items = []
  const sideEntries = []
  ir.layers.forEach((l, i) => {
    const rows = Math.ceil(l.items.length / ITEMS_PER_ROW)
    const itemsH = rows ? rows * ITEM_H + (rows - 1) * ITEM_GAP + BAND_PAD * 2 : 0
    const sideCount = sideByLayer.get(l.id)?.length ?? 0
    const sideH = sideCount ? sideCount * SIDE_LINE + SIDE_PAD * 2 : 0
    const height = snapUp4(Math.max(BAND_MIN_H, itemsH, sideH))
    const band = { id: l.id, index: i + 1, x: bandX, y, width: bandW, height, yTop: y, yBottom: y + height, tone: l.tone, emphasis: l.emphasis, label: l.label }
    bands.push(band)
    l.items.forEach((it, j) => {
      const col = j % ITEMS_PER_ROW
      const row = Math.floor(j / ITEMS_PER_ROW)
      items.push({
        id: it.id, layer: l.id, label: it.label, tone: it.tone,
        x: bandX + titleColW + BAND_PAD + col * (itemW + ITEM_GAP),
        y: y + BAND_PAD + row * (ITEM_H + ITEM_GAP),
        width: itemW, height: ITEM_H,
      })
    })
    // side entries: the block of lines is centered on the band so a single
    // entry sits level with the band's title
    const entries = sideByLayer.get(l.id) ?? []
    const blockTop = snap4(y + (height - entries.length * SIDE_LINE) / 2)
    entries.forEach((e, k) => {
      sideEntries.push({ layer: l.id, text: e.text, x: sideX + SIDE_PAD, y: blockTop + EDGE_LABEL_SIZE + 1 + k * SIDE_LINE })
    })
    y += height + gap
  })
  const stackBottom = y - gap
  const height = snapUp4(stackBottom + PAD)

  const byId = new Map(bands.map((b) => [b.id, b]))
  const arrowGeo = arrows.map((a, i) => {
    const from = byId.get(a.from)
    const to = byId.get(a.to)
    const down = to.yTop >= from.yBottom
    const x = bandX + ARROW_X + (down ? 0 : ARROW_PAIR)
    return {
      index: i, from: a.from, to: a.to, label: a.label, down,
      x1: x, y1: down ? from.yBottom : from.yTop,
      x2: x, y2: down ? to.yTop : to.yBottom,
    }
  })

  const side = hasSide
    ? { label: ir.side.label, x: sideX, y: PAD + EDGE_LABEL_SIZE + 1, width: sideW, entries: sideEntries }
    : undefined

  const geo = { bands, items, arrows: arrowGeo, titleColW, itemW, gap }
  if (side) geo.side = side
  return { width, height, geo }
}

// --- draw ----------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')

  for (const b of geo.bands) {
    const cls = b.emphasis ? ' class="wu-focal"' : ''
    const sw = b.emphasis ? 1.5 : 1
    const weight = b.emphasis ? ' font-weight="700"' : ''
    const midY = b.y + b.height / 2
    parts.push(`<rect id="${uid}-l-${b.id}"${cls} data-tone="${esc(b.tone)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-l-${b.id}-num" x="${b.x + TITLE_PAD}" y="${midY + EDGE_LABEL_SIZE * 0.35}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${b.index}</text>`)
    parts.push(`<text id="${uid}-l-${b.id}-label" x="${b.x + TITLE_PAD + NUM_W}" y="${midY + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(b.label)}</text>`)
  }

  for (const it of geo.items) {
    const tone = it.tone === 'neutral' ? '' : ` data-tone="${esc(it.tone)}"`
    parts.push(`<rect id="${uid}-i-${it.id}"${tone} x="${it.x}" y="${it.y}" width="${it.width}" height="${it.height}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/>`)
    parts.push(`<text id="${uid}-i-${it.id}-label" x="${it.x + it.width / 2}" y="${it.y + it.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(it.label)}</text>`)
  }

  for (const a of geo.arrows) {
    parts.push(`<line id="${uid}-a-${a.index}" x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    if (a.label) {
      const lx = Math.max(a.x1, a.x2) + 8
      const ly = (a.y1 + a.y2) / 2 + EDGE_LABEL_SIZE * 0.35
      parts.push(`<text id="${uid}-a-${a.index}-label" x="${lx}" y="${ly}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(a.label)}</text>`)
    }
  }

  if (geo.side) {
    const s = geo.side
    parts.push(`<text id="${uid}-side-label" x="${s.x + SIDE_PAD}" y="${s.y}" font-size="${EDGE_LABEL_SIZE}" font-weight="700" fill="var(--wu-ink-3)">${esc(s.label)}</text>`)
    s.entries.forEach((e, i) => {
      parts.push(`<text id="${uid}-side-${i}" x="${e.x}" y="${e.y}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(e.text)}</text>`)
    })
    // a hairline separating the stack from the side column
    const first = geo.bands[0]
    const last = geo.bands[geo.bands.length - 1]
    parts.push(`<line id="${uid}-side-rule" x1="${s.x - SIDE_GAP / 2}" y1="${first.yTop}" x2="${s.x - SIDE_GAP / 2}" y2="${last.yBottom}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  }

  return parts.join('')
}

// --- verify --------------------------------------------------------------

const ITEM_CLEARANCE = 8

export function verify(layoutResult, ir) {
  const { geo } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'layer-count', 'budget:layers', `${ir.layers.length} layer(s)`)
  budgetRow(2, 'items-per-layer', 'budget:items', `≤ ${limits.maxItemsPerLayer} items in every layer`)
  budgetRow(3, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  budgetRow(4, 'emphasis-count', 'budget:emphasis', `${ir.layers.filter((l) => l.emphasis).length} emphasized layer(s)`)

  // 5. bands ordered top → bottom in IR order and never overlapping
  const order = ir.layers.map((l) => l.id)
  const bandsInOrder = geo.bands.length === order.length && geo.bands.every((b, i) => b.id === order[i])
  const overlaps = []
  for (let i = 1; i < geo.bands.length; i++) {
    const prev = geo.bands[i - 1]
    const cur = geo.bands[i]
    if (cur.yTop < prev.yBottom) overlaps.push(`${prev.id}/${cur.id}`)
  }
  const bandsOk = bandsInOrder && overlaps.length === 0 && geo.bands.every((b) => b.yBottom > b.yTop)
  rows.push({
    id: 5, name: 'bands-ordered', severity: 'fail', ok: bandsOk,
    detail: bandsOk ? 'bands run top to bottom in IR order without overlapping'
      : !bandsInOrder ? 'band order differs from ir.layers' : `overlapping bands: ${overlaps.join(', ')}`,
    hint: bandsOk ? undefined : 'stack bands in IR order, each starting at or below the previous band\'s bottom',
  })

  // 6. every item sits inside its own band with ≥ 8px clearance
  const bandById = new Map(geo.bands.map((b) => [b.id, b]))
  const outside = geo.items.filter((it) => {
    const b = bandById.get(it.layer)
    if (!b) return true
    return it.x < b.x + ITEM_CLEARANCE || it.x + it.width > b.x + b.width - ITEM_CLEARANCE
      || it.y < b.yTop + ITEM_CLEARANCE || it.y + it.height > b.yBottom - ITEM_CLEARANCE
  })
  rows.push({
    id: 6, name: 'items-inside-band', severity: 'fail', ok: outside.length === 0,
    detail: outside.length ? `item(s) outside their band or closer than ${ITEM_CLEARANCE}px to its edge: ${outside.map((i) => i.id).join(', ')}` : `every item sits inside its band with ≥ ${ITEM_CLEARANCE}px clearance`,
    hint: outside.length ? 'widen the band or wrap the items onto another row' : undefined,
  })

  // 7. side entries aligned to their band's vertical span
  const misaligned = (geo.side?.entries ?? []).filter((e) => {
    const b = bandById.get(e.layer)
    return !b || e.y - EDGE_LABEL_SIZE < b.yTop || e.y > b.yBottom
  })
  rows.push({
    id: 7, name: 'side-aligned', severity: 'fail', ok: misaligned.length === 0,
    detail: misaligned.length ? `side entr${misaligned.length === 1 ? 'y' : 'ies'} outside the band span: ${misaligned.map((e) => `${e.layer}:"${e.text}"`).join(', ')}`
      : geo.side ? 'every side entry sits within its band\'s vertical span' : 'no side column',
    hint: misaligned.length ? 'grow the band to fit its side entries or move the entry to the layer it describes' : undefined,
  })

  // 8. arrows connect adjacent layers only, and run through the gap between them
  const indexOf = new Map(order.map((id, i) => [id, i]))
  const badArrows = geo.arrows.filter((a) => {
    if (Math.abs(indexOf.get(a.from) - indexOf.get(a.to)) !== 1) return true
    const from = bandById.get(a.from)
    const to = bandById.get(a.to)
    const lo = Math.min(from.yBottom, to.yBottom)
    const hi = Math.max(from.yTop, to.yTop)
    return a.x1 !== a.x2 || Math.min(a.y1, a.y2) < lo || Math.max(a.y1, a.y2) > hi
  })
  rows.push({
    id: 8, name: 'arrows-adjacent', severity: 'fail', ok: badArrows.length === 0,
    detail: badArrows.length ? `arrow(s) between non-adjacent layers or leaving the gap: ${badArrows.map((a) => `${a.from}→${a.to}`).join(', ')}`
      : geo.arrows.length ? 'every arrow joins two adjacent layers through the gap between them' : 'no arrows',
    hint: badArrows.length ? 'an arrow may only join a layer to the one directly above or below it — route through the intermediate layers or drop it' : undefined,
  })

  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'a ranked stack of layers (UI / API / domain / storage) with the components in each and, optionally, what each layer enforces',
  whenToUse: 'when the bands are truly ordered by abstraction and the question is "which layer owns/enforces what" or "what does adding/replacing a layer touch"; not for peers without rank (use diagram or a swimlane). Budgets: layers ≤ 7, items per layer ≤ 8, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: web-stack
type: layers
title: Web アプリの層構成
caption: 認可はドメイン層で強制し、UI は表示のみ
layers:
  - id: ui
    label: UI
    items: [Web, Mobile]
  - id: api
    label: API
    items:
      - id: gw
        label: Gateway
        tone: ts
      - 認証
  - id: domain
    label: ドメイン
    emphasis: true
    items: [注文, 在庫, 決済]
  - id: storage
    label: ストレージ
    tone: rs
    items: [PostgreSQL, S3]
side:
  label: 統制
  items:
    - layer: domain
      text: 認可・不変条件
    - layer: storage
      text: 暗号化・保持期限
`,
  rows: ['layer-count', 'items-per-layer', 'label-length', 'emphasis-count', 'bands-ordered', 'items-inside-band', 'side-aligned', 'arrows-adjacent'],
}
