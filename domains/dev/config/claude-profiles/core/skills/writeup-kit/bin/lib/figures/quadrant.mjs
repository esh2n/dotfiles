// `type: quadrant` — a 2×2 with two labelled axes; every item is placed by
// its (x, y) in 0..1 and read against the two criteria (Impact × Effort,
// Risk × Value, 実装コスト × 効果). This is the *standard* quadrant of the
// diagram-pattern survey: positions carry meaning, the four cells are not
// painted, and the axis text sits at the ends of the axes (never at the
// midpoint). The "consultant 2×2" (four scenario cards, one focal cell, no
// points) is a different grammar and not this type.
//
// IR shape: `{ id, type:'quadrant', title, caption, x:{label, low?, high?},
// y:{label, low?, high?}, quadrants?:{tl?, tr?, bl?, br?}, items:[{id,
// label, x, y, emphasis?, tone?}] }`. `x`/`y` on an item are fractions of
// the plot (0 = low end, 1 = high end); the layout snaps them to the 4px
// grid. `emphasis` marks the item with the kit's accent stroke (a
// `.wu-focal` rounded square instead of a dot, bold label); `tone` is
// accepted for parity with the other types and only fills the emphasized
// marker (dots are always ink). Neutral by default.
//
// Layout is a fixed, deterministic 4:3 plot (≤ COLUMN wide) with the axis
// lines through the middle, the axis labels outside, optional corner
// captions in muted ink, and one dot + label per item. Labels sit to the
// right of the dot and flip to the left near the right edge; when two
// labels would overlap, the later one is nudged on the 4px grid (sideways,
// then above/below) until it is clear of every placed label, marker, corner
// caption and the plot edge. If no clear slot exists the label stays put
// and the `labels-no-overlap` row fails — a figure with unreadable labels
// never ships as `data-checks="pass"`.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { COLUMN, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, snap4, snapUp4, textWidth } from '../diagram.mjs'

export const type = 'quadrant'

export const limits = { maxItems: 12, maxLabelLen: 12, maxEmphasis: 2 }

// --- metrics ---------------------------------------------------------------

const PAD = 16                 // canvas padding
const PLOT_W_MAX = 480         // plot width at a full column (4:3 → 360 tall)
const AXIS_GAP = 8             // plot edge → axis text
const LABEL_GAP = 8            // marker centre → label box
const LABEL_H = 16             // 13px text box, on the grid
const LABEL_PAD = 4            // halo padding either side of the label text
const SMALL_H = 16             // 11px text box (corner captions, axis ends)
const CORNER_INSET = 8
const DOT_R = 4
const FOCAL_SIZE = 12          // emphasized marker is a 12×12 rounded square
const MARKER_CLEAR = 8         // half-size of the keep-out box around a marker
const AXIS_CLEAR = 6           // a dot closer than this to an axis line is "on" it
const NUDGE_STEPS = [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20, -24, 24, -28, 28, -32, 32, -36, 36, -40, 40]
const PUSH_STEPS = [0, 8, 16, 24]   // extra distance from the marker, tried after vertical shifts

// --- schema ------------------------------------------------------------------

const CORNERS = ['tl', 'tr', 'bl', 'br']

function normalizeAxis(raw, name, ctx) {
  const actx = `${ctx}.${name}`
  if (!isObj(raw)) throw new IrError(`${actx} must be a mapping with label (and optional low/high)`)
  const axis = { label: requireStr(raw, 'label', actx) }
  const low = optStr(raw, 'low', actx)
  const high = optStr(raw, 'high', actx)
  if (low !== undefined) axis.low = low
  if (high !== undefined) axis.high = high
  return axis
}

function normalizeQuadrants(raw, ctx) {
  if (raw === undefined || raw === null) return undefined
  const qctx = `${ctx}.quadrants`
  if (!isObj(raw)) throw new IrError(`${qctx} must be a mapping of tl/tr/bl/br captions`)
  const unknown = Object.keys(raw).filter((k) => !CORNERS.includes(k))
  if (unknown.length) throw new IrError(`${qctx} has unknown key(s) ${unknown.join(', ')} — only tl, tr, bl, br`)
  const out = {}
  for (const c of CORNERS) {
    const v = optStr(raw, c, qctx)
    if (v !== undefined) out[c] = v
  }
  return Object.keys(out).length ? out : undefined
}

function requireFraction(obj, field, ctx) {
  const v = obj[field]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new IrError(`${ctx}.${field} must be a number between 0 and 1 (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeItems(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.items must be a non-empty list`)
  const seen = new Set()
  return raw.map((it, i) => {
    const ictx = `${ctx}.items[${i}]`
    if (!isObj(it)) throw new IrError(`${ictx} must be a mapping`)
    const id = requireStr(it, 'id', ictx)
    if (seen.has(id)) throw new IrError(`duplicate item id: "${id}"`)
    seen.add(id)
    return {
      id,
      label: requireStr(it, 'label', ictx),
      x: requireFraction(it, 'x', ictx),
      y: requireFraction(it, 'y', ictx),
      emphasis: validateBool(it, 'emphasis', ictx),
      tone: validateTone(it.tone, ictx),
    }
  })
}

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const x = normalizeAxis(raw.x, 'x', ctx)
  const y = normalizeAxis(raw.y, 'y', ctx)
  const quadrants = normalizeQuadrants(raw.quadrants, ctx)
  const items = normalizeItems(raw.items, ctx)
  const ir = { id, type, title }
  if (caption !== undefined) ir.caption = caption
  ir.x = x
  ir.y = y
  if (quadrants) ir.quadrants = quadrants
  ir.items = items
  return ir
}

// --- budgets -----------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  if (ir.items.length > limits.maxItems) {
    out.push(budgetWarning('budget:items', ir.items.length, limits.maxItems,
      `${ir.items.length} item(s) (guidance ≤ ${limits.maxItems})`,
      'drop the options that are clearly dominated, or split into one quadrant per theme'))
  }
  const long = ir.items.filter((it) => [...it.label].length > limits.maxLabelLen)
  if (long.length) {
    const longest = long.reduce((m, it) => ([...it.label].length > [...m.label].length ? it : m), long[0])
    out.push(budgetWarning('budget:label', [...longest.label].length, limits.maxLabelLen,
      `${long.length} label(s) longer than ${limits.maxLabelLen} chars (longest: "${longest.label}")`,
      `shorten "${longest.label}" to ≤ ${limits.maxLabelLen} chars; put the detail in the caption`))
  }
  const focal = ir.items.filter((it) => it.emphasis).length
  if (focal > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', focal, limits.maxEmphasis,
      `${focal} emphasized item(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis for the recommended option(s) — more than two accents is no emphasis'))
  }
  return out
}

// --- layout --------------------------------------------------------------------

const boxW = (text, size, bold = false) => textWidth(text, size) * (bold ? BOLD_FACTOR : 1)

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function inside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

const markerBox = (m) => ({ x: m.cx - MARKER_CLEAR, y: m.cy - MARKER_CLEAR, width: MARKER_CLEAR * 2, height: MARKER_CLEAR * 2 })

/** Candidate label boxes for one item, sorted by a deterministic cost so
 * the nudging prefers (in order): the natural side at the marker's own
 * height, a small vertical shift, the other side, a push outwards from
 * the marker, and only then a slot centred above or below. Ties keep
 * generation order, so the same IR always yields the same placement. */
function candidates(m, width, plot) {
  const preferRight = m.cx + LABEL_GAP + width <= plot.x + plot.width
  const sides = preferRight ? ['right', 'left'] : ['left', 'right']
  const out = []
  sides.forEach((side, sideIdx) => {
    for (const dy of NUDGE_STEPS) {
      for (const push of PUSH_STEPS) {
        const x = side === 'right' ? m.cx + LABEL_GAP + push : m.cx - LABEL_GAP - push - width
        out.push({ x, y: m.cy - LABEL_H / 2 + dy, width, height: LABEL_H, side, nudged: dy !== 0 || push > 0, cost: Math.abs(dy) + push * 1.5 + sideIdx * 12 })
      }
    }
  })
  for (const dx of NUDGE_STEPS) {
    const x = snap4(m.cx - width / 2) + dx
    out.push({ x, y: m.cy - MARKER_CLEAR - LABEL_H, width, height: LABEL_H, side: 'top', nudged: true, cost: 20 + Math.abs(dx) })
    out.push({ x, y: m.cy + MARKER_CLEAR, width, height: LABEL_H, side: 'bottom', nudged: true, cost: 22 + Math.abs(dx) })
  }
  return out.map((c, i) => ({ ...c, i })).sort((a, b) => a.cost - b.cost || a.i - b.i)
}

/** Leader line from the marker centre to the midpoint of the label box's
 * edge that faces it (endpoints snapped to the grid). */
function leaderFor(m, box) {
  const end = box.side === 'right' ? { x: box.x, y: box.y + LABEL_H / 2 }
    : box.side === 'left' ? { x: box.x + box.width, y: box.y + LABEL_H / 2 }
    : box.side === 'top' ? { x: box.x + box.width / 2, y: box.y + LABEL_H }
    : { x: box.x + box.width / 2, y: box.y }
  return { x1: m.cx, y1: m.cy, x2: snap4(end.x), y2: snap4(end.y) }
}

export async function layout(ir, { column = COLUMN } = {}) {
  const xEnds = [ir.x.low, ir.x.high].filter((s) => s !== undefined)
  const yEnds = [ir.y.low, ir.y.high].filter((s) => s !== undefined)
  const yEndW = yEnds.length ? Math.max(...yEnds.map((s) => boxW(s, EDGE_LABEL_SIZE))) : 0

  // left band: rotated y label (16) + gap + y end labels + gap
  const leftBand = PAD + SMALL_H + AXIS_GAP + (yEnds.length ? snapUp4(yEndW) + AXIS_GAP : 0)
  const plotX = snapUp4(leftBand)
  const plotW = Math.min(PLOT_W_MAX, Math.floor((column - plotX - PAD) / 4) * 4)
  const plotH = snap4(plotW * 3 / 4)
  const plotY = PAD
  const plot = { x: plotX, y: plotY, width: plotW, height: plotH }
  const midX = plotX + plotW / 2
  const midY = plotY + plotH / 2
  const axes = { vertical: { x: midX, y1: plotY, y2: plotY + plotH }, horizontal: { y: midY, x1: plotX, x2: plotX + plotW } }

  // axis text (all outside the plot); boxes are screen-space for collision
  const texts = []
  const xLabelW = snapUp4(boxW(ir.x.label, FONT_SIZE))
  const bandY = plotY + plotH + AXIS_GAP
  const endBoxes = []
  if (ir.x.low !== undefined) {
    const w = snapUp4(boxW(ir.x.low, EDGE_LABEL_SIZE))
    endBoxes.push({ role: 'x-low', text: ir.x.low, x: plotX, y: bandY, width: w, height: SMALL_H, anchor: 'start', size: EDGE_LABEL_SIZE, muted: true })
  }
  if (ir.x.high !== undefined) {
    const w = snapUp4(boxW(ir.x.high, EDGE_LABEL_SIZE))
    endBoxes.push({ role: 'x-high', text: ir.x.high, x: plotX + plotW - w, y: bandY, width: w, height: SMALL_H, anchor: 'end', size: EDGE_LABEL_SIZE, muted: true })
  }
  let xLabel = { role: 'x-label', text: ir.x.label, x: snap4(midX - xLabelW / 2), y: bandY, width: xLabelW, height: LABEL_H, anchor: 'middle', size: FONT_SIZE, muted: false }
  if (endBoxes.some((b) => intersects(b, xLabel))) xLabel = { ...xLabel, y: bandY + LABEL_H }
  texts.push(...endBoxes, xLabel)
  const bottom = Math.max(xLabel.y + LABEL_H, ...endBoxes.map((b) => b.y + b.height))

  const yLabelW = snapUp4(boxW(ir.y.label, FONT_SIZE))
  texts.push({ role: 'y-label', text: ir.y.label, x: PAD, y: snap4(midY - yLabelW / 2), width: SMALL_H, height: yLabelW, anchor: 'middle', size: FONT_SIZE, muted: false, rotate: true })
  const yEndX = PAD + SMALL_H + AXIS_GAP
  if (ir.y.high !== undefined) {
    texts.push({ role: 'y-high', text: ir.y.high, x: yEndX, y: plotY, width: snapUp4(yEndW), height: SMALL_H, anchor: 'end', size: EDGE_LABEL_SIZE, muted: true })
  }
  if (ir.y.low !== undefined) {
    texts.push({ role: 'y-low', text: ir.y.low, x: yEndX, y: plotY + plotH - SMALL_H, width: snapUp4(yEndW), height: SMALL_H, anchor: 'end', size: EDGE_LABEL_SIZE, muted: true })
  }

  // corner captions (inside the plot, muted)
  const corners = []
  const q = ir.quadrants ?? {}
  for (const c of CORNERS) {
    if (q[c] === undefined) continue
    const w = snapUp4(boxW(q[c], EDGE_LABEL_SIZE) + LABEL_PAD * 2)
    const left = c === 'tl' || c === 'bl'
    const top = c === 'tl' || c === 'tr'
    corners.push({
      corner: c, text: q[c], width: w, height: SMALL_H,
      x: left ? plotX + CORNER_INSET : plotX + plotW - CORNER_INSET - w,
      y: top ? plotY + CORNER_INSET : plotY + plotH - CORNER_INSET - SMALL_H,
    })
  }

  // markers on the grid
  const markers = ir.items.map((it) => ({
    id: it.id,
    cx: plotX + snap4(it.x * plotW),
    cy: plotY + snap4((1 - it.y) * plotH),
    emphasis: it.emphasis,
    tone: it.tone,
  }))

  // labels: deterministic nudging on the 4px grid, IR order
  const placed = []
  const items = ir.items.map((it, i) => {
    const m = markers[i]
    const width = snapUp4(boxW(it.label, FONT_SIZE, it.emphasis) + LABEL_PAD * 2)
    const obstacles = [...placed, ...corners, ...markers.filter((o) => o !== m).map(markerBox)]
    const options = candidates(m, width, plot)
    let label = options.find((c) => inside(c, plot) && !obstacles.some((o) => intersects(c, o)))
    let collides = false
    if (!label) { label = options[0]; collides = true }
    const rec = { x: label.x, y: label.y, width, height: LABEL_H, side: label.side, collides }
    // a nudged label gets a short leader from the marker to its near edge,
    // so the reader never has to guess which dot it names
    if (label.nudged && !collides) rec.leader = leaderFor(m, rec)
    placed.push(rec)
    return { id: it.id, label: it.label, emphasis: it.emphasis, tone: it.tone, marker: m, labelBox: rec }
  })

  const width = snapUp4(plotX + plotW + PAD)
  const height = snapUp4(bottom + PAD)
  return { width, height, geo: { plot, axes, texts, corners, items } }
}

// --- draw ------------------------------------------------------------------------

export function draw(geo, ir) {
  const uid = `wu-d-${ir.id}`
  const { plot, axes, texts, corners, items } = geo.geo
  const parts = []
  parts.push(`<rect id="${uid}-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" rx="4" fill="none" stroke="var(--wu-rule)" stroke-width="1"/>`)
  for (const c of corners) {
    const anchorEnd = c.corner === 'tr' || c.corner === 'br'
    const tx = anchorEnd ? c.x + c.width - LABEL_PAD : c.x + LABEL_PAD
    parts.push(`<text id="${uid}-q-${c.corner}" x="${tx}" y="${c.y + 12}" font-size="${EDGE_LABEL_SIZE}" text-anchor="${anchorEnd ? 'end' : 'start'}" fill="var(--wu-ink-3)">${esc(c.text)}</text>`)
  }
  parts.push(`<line id="${uid}-axis-v" x1="${axes.vertical.x}" y1="${axes.vertical.y1}" x2="${axes.vertical.x}" y2="${axes.vertical.y2}" stroke="currentColor" stroke-width="1"/>`)
  parts.push(`<line id="${uid}-axis-h" x1="${axes.horizontal.x1}" y1="${axes.horizontal.y}" x2="${axes.horizontal.x2}" y2="${axes.horizontal.y}" stroke="currentColor" stroke-width="1"/>`)
  for (const t of texts) {
    const fill = t.muted ? 'var(--wu-ink-3)' : 'currentColor'
    if (t.rotate) {
      const cx = t.x + 12
      const cy = t.y + t.height / 2
      parts.push(`<text id="${uid}-${t.role}" x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})" font-size="${t.size}" text-anchor="middle" fill="${fill}">${esc(t.text)}</text>`)
      continue
    }
    const tx = t.anchor === 'end' ? t.x + t.width : t.anchor === 'middle' ? t.x + t.width / 2 : t.x
    parts.push(`<text id="${uid}-${t.role}" x="${tx}" y="${t.y + 12}" font-size="${t.size}" text-anchor="${t.anchor}" fill="${fill}">${esc(t.text)}</text>`)
  }
  // leaders, then label halos (so a label stays legible over an axis
  // line), then the text, then every marker on top
  for (const it of items) {
    const l = it.labelBox.leader
    if (l) parts.push(`<line id="${uid}-i-${it.id}-leader" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="var(--wu-ink-3)" stroke-width="1"/>`)
  }
  for (const it of items) {
    const b = it.labelBox
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="var(--wu-surface)" stroke="none"/>`)
  }
  for (const it of items) {
    const b = it.labelBox
    const weight = it.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-i-${it.id}-label" x="${b.x + LABEL_PAD}" y="${b.y + 12}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(it.label)}</text>`)
  }
  for (const it of items) {
    const m = it.marker
    if (it.emphasis) {
      const half = FOCAL_SIZE / 2
      parts.push(`<rect id="${uid}-i-${it.id}" class="wu-focal" data-tone="${esc(it.tone)}" x="${m.cx - half}" y="${m.cy - half}" width="${FOCAL_SIZE}" height="${FOCAL_SIZE}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1.5"/>`)
    } else {
      parts.push(`<circle id="${uid}-i-${it.id}" cx="${m.cx}" cy="${m.cy}" r="${DOT_R}" fill="currentColor"/>`)
    }
  }
  return parts.join('')
}

// --- verify ----------------------------------------------------------------------

export function verify(geo, ir) {
  const { plot, axes, texts, corners, items } = geo.geo
  const rows = []

  const axisLabels = ['x-label', 'y-label'].filter((r) => {
    const t = texts.find((tt) => tt.role === r)
    return !t || typeof t.text !== 'string' || t.text.trim() === ''
  })
  rows.push({
    id: 1, name: 'axis-labels', severity: 'fail', ok: axisLabels.length === 0,
    detail: axisLabels.length ? `missing axis label(s): ${axisLabels.join(', ')}` : 'both axes carry a label outside the plot',
    hint: axisLabels.length ? 'give x.label and y.label a one-word criterion each' : undefined,
  })

  const outside = items.filter((it) => {
    const m = it.marker
    return m.cx < plot.x || m.cx > plot.x + plot.width || m.cy < plot.y || m.cy > plot.y + plot.height
  })
  rows.push({
    id: 2, name: 'items-in-plot', severity: 'fail', ok: outside.length === 0,
    detail: outside.length ? `item(s) outside the plot: ${outside.map((i) => i.id).join(', ')}` : `${items.length} item(s) inside the plot`,
    hint: outside.length ? 'keep every item x/y within 0..1' : undefined,
  })

  const overlaps = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (intersects(items[i].labelBox, items[j].labelBox)) overlaps.push(`${items[i].id}/${items[j].id}`)
    }
    for (const other of items) {
      if (other !== items[i] && intersects(items[i].labelBox, markerBox(other.marker))) overlaps.push(`${items[i].id}→${other.id} marker`)
    }
  }
  rows.push({
    id: 3, name: 'labels-no-overlap', severity: 'fail', ok: overlaps.length === 0,
    detail: overlaps.length ? `overlapping label(s): ${overlaps.join(', ')}` : 'no two labels overlap and no label covers another marker',
    hint: overlaps.length ? 'spread the crowded items apart (a few hundredths on x or y) or shorten their labels' : undefined,
  })

  const crossing = []
  for (const it of items) {
    if (!inside(it.labelBox, plot)) crossing.push(`${it.id} leaves the plot`)
    for (const t of texts) if (intersects(it.labelBox, t)) crossing.push(`${it.id}/${t.role}`)
    for (const c of corners) if (intersects(it.labelBox, c)) crossing.push(`${it.id}/quadrant ${c.corner}`)
  }
  rows.push({
    id: 4, name: 'labels-clear-of-axis-text', severity: 'fail', ok: crossing.length === 0,
    detail: crossing.length ? `label(s) crossing axis or corner text: ${crossing.join(', ')}` : 'every label stays inside the plot and clear of the axis and corner text',
    hint: crossing.length ? 'move the item away from the edge or shorten the corner caption' : undefined,
  })

  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
  }
  rows.push(budgetRow(5, 'item-count', 'budget:items', `${ir.items.length} item(s)`))
  rows.push(budgetRow(6, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`))
  rows.push(budgetRow(7, 'emphasis-count', 'budget:emphasis', `${ir.items.filter((i) => i.emphasis).length} emphasized item(s)`))

  const onAxis = items.filter((it) => Math.abs(it.marker.cx - axes.vertical.x) < AXIS_CLEAR || Math.abs(it.marker.cy - axes.horizontal.y) < AXIS_CLEAR)
  rows.push({
    id: 8, name: 'items-off-axis', severity: 'warn', ok: onAxis.length === 0,
    detail: onAxis.length ? `item(s) sitting on an axis line: ${onAxis.map((i) => i.id).join(', ')}` : 'no item sits on an axis line',
    hint: onAxis.length ? 'a point on the axis reads as undecided — commit it to one side (x or y ≠ 0.5)' : undefined,
    key: onAxis.length ? 'axis:on-line' : undefined, value: onAxis.length || undefined,
  })
  return rows
}

export const doc = {
  purpose: 'options compared on two criteria — a 2×2 with labelled axes and items placed by coordinates',
  whenToUse: 'when the *position* of each option against two criteria is the message (Impact × Effort, Risk × Value, 実装コスト × 効果); not for four scenario cards without points (consultant 2×2) or more than two criteria (use radar or a table). Budgets: items ≤ 12, label ≤ 12 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: options
type: quadrant
title: 改善案の比較
caption: 右上ほど費用対効果が悪い。左上の案から着手する
x:
  label: 実装コスト
  low: 低
  high: 高
y:
  label: 効果
  low: 小
  high: 大
quadrants:
  tl: すぐやる
  tr: 計画して投資
  bl: 手が空いたら
  br: 見送り
items:
  - id: cache
    label: キャッシュ導入
    x: 0.2
    y: 0.72
    emphasis: true
  - id: rewrite
    label: 全面書き換え
    x: 0.9
    y: 0.85
  - id: logs
    label: ログ整備
    x: 0.32
    y: 0.3
  - id: manual
    label: 手動運用の継続
    x: 0.1
    y: 0.12
  - id: partial
    label: 部分移行
    x: 0.62
    y: 0.62
`,
  rows: ['axis-labels', 'items-in-plot', 'labels-no-overlap', 'labels-clear-of-axis-text', 'item-count', 'label-length', 'emphasis-count', 'items-off-axis'],
}
