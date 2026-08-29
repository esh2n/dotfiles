// `type: medallion` — data-platform stages laid out left → right as equal
// columns (bronze → silver → gold, raw → curated → serving): each stage
// holds the tables/datasets living in it (items, stacked as small boxes)
// and a muted list of per-stage properties (retention, schema, quality
// checks), promotions between adjacent stages are shallow arcs drawn above
// the columns with a label, and the sources feeding the first stage /
// the consumers reading the last one are plain text groups at the ends.
//
// IR shape: `{ id, type:'medallion', title, caption, stages, promotions?, sources?, consumers? }`
//   stages:     [{ id, label, items: [string], properties: [string], emphasis }]
//               ordered left → right (3–5 by guidance)
//   promotions: [{ from, to, label? }] — stage ids; a promotion may only
//               join a stage to the one directly right of it (verify row)
//   sources:    [string] feeding stages[0]; consumers: [string] reading the last
//
// Bronze/silver/gold are still greys: the columns step in lightness (a
// currentColor tint that fades to the plain surface at the last stage), so
// refinement reads as "cleaner" in light and dark alike and no chromatic
// color enters the figure. The promotion arcs are the design survey's
// documented exemption (#26) from the orthogonal-edge rule.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'medallion'

export const limits = { maxStages: 5, maxItemsPerStage: 6, maxLabelLen: 14, maxEmphasis: 2 }

// --- layout constants (px; anything that becomes a position is a multiple of 4)

const PAD = 16            // canvas margin
const ARC_ZONE = 48       // reserved above the columns when promotions exist
const ARC_RISE = 28       // arc peak above the column top
const ARC_LABEL_LIFT = 8  // label baseline above the arc peak
const ARC_LABEL_PAD = 8   // clearance either side of an arc label
const ARC_INSET = 0.25    // arcs leave/enter a column a quarter in from the gap
const COL_GAP = 24        // between stage columns
const COL_MIN_W = 120
const COL_MIN_H = 96
const HEAD_H = 32         // stage header (index + label) above the rule
const BAND_PAD = 12       // item/property ↔ column edge clearance (verify demands ≥ 8)
const NUM_W = 20          // index number slot inside the header
const ITEM_H = 28
const ITEM_GAP = 8
const ITEM_PAD_X = 12
const ITEM_MIN_W = 96     // item boxes share one text-fitted width, centered in the column
const PROP_GAP = 8        // items ↔ first property line
const PROP_LINE = 16
const END_GAP = 36        // arrow length between an end group and its column
const END_PAD = 8
const END_LINE = 20
const TINT_STEP = 0.05    // lightness step between neighbouring stages

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const stages = normalizeStages(raw.stages, ctx)
  const stageIds = new Set(stages.map((s) => s.id))
  const out = { id, type, title, caption, stages }
  const promotions = normalizePromotions(raw.promotions, stageIds, ctx)
  if (promotions.length) out.promotions = promotions
  const sources = normalizeStrList(raw.sources, `${ctx}.sources`)
  if (sources.length) out.sources = sources
  const consumers = normalizeStrList(raw.consumers, `${ctx}.consumers`)
  if (consumers.length) out.consumers = consumers
  return out
}

function normalizeStages(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.stages must be a non-empty list`)
  if (raw.length < 2) throw new IrError(`${ctx}.stages needs at least 2 stages (a single stage has nothing to promote to)`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.stages[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate stage id: "${id}"`)
    seen.add(id)
    return {
      id,
      label: requireStr(s, 'label', sctx),
      items: normalizeStrList(s.items, `${sctx}.items`),
      properties: normalizeStrList(s.properties, `${sctx}.properties`),
      emphasis: validateBool(s, 'emphasis', sctx),
    }
  })
}

function normalizeStrList(raw, lctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${lctx} must be a list of strings`)
  return raw.map((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') {
      const hint = isObj(v) ? ' (a "key: value" entry parses as a mapping — quote the string)' : ''
      throw new IrError(`${lctx}[${i}] must be a non-empty string${hint}`)
    }
    return v
  })
}

function normalizePromotions(raw, stageIds, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.promotions must be a list`)
  return raw.map((p, i) => {
    const pctx = `${ctx}.promotions[${i}]`
    if (!isObj(p)) throw new IrError(`${pctx} must be a mapping`)
    const from = requireStr(p, 'from', pctx)
    const to = requireStr(p, 'to', pctx)
    if (!stageIds.has(from)) throw new IrError(`${pctx}.from references unknown stage "${from}"`)
    if (!stageIds.has(to)) throw new IrError(`${pctx}.to references unknown stage "${to}"`)
    if (from === to) throw new IrError(`${pctx}: from and to must differ`)
    const rec = { from, to }
    const label = optStr(p, 'label', pctx)
    if (label !== undefined) rec.label = label
    return rec
  })
}

// --- budgets -------------------------------------------------------------

function labelsOf(ir) {
  return [
    ...ir.stages.map((s) => s.label),
    ...ir.stages.flatMap((s) => s.items),
    ...(ir.promotions ?? []).map((p) => p.label).filter(Boolean),
  ]
}

const longestLabel = (ir) => labelsOf(ir).reduce((m, l) => (l.length > m.length ? l : m), '')

export function budgetWarnings(ir) {
  const out = []
  if (ir.stages.length > limits.maxStages) {
    out.push(budgetWarning('budget:stages', ir.stages.length, limits.maxStages,
      `${ir.stages.length} stage(s) (guidance ≤ ${limits.maxStages})`,
      'merge neighbouring stages that share a quality bar, or split the platform into two figures'))
  }
  const fattest = ir.stages.reduce((m, s) => (s.items.length > m.items.length ? s : m), ir.stages[0])
  if (fattest.items.length > limits.maxItemsPerStage) {
    out.push(budgetWarning('budget:items', fattest.items.length, limits.maxItemsPerStage,
      `stage "${fattest.id}" holds ${fattest.items.length} item(s) (guidance ≤ ${limits.maxItemsPerStage})`,
      `name the dataset families of "${fattest.id}" instead of every table, or list the rest in the caption`))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and move the detail into the stage properties or the caption'))
  }
  const emphasized = ir.stages.filter((s) => s.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized stage(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two stages the decision is about'))
  }
  return out
}

// --- layout --------------------------------------------------------------

const boldWidth = (text, size = FONT_SIZE) => Math.ceil(textWidth(text, size) * BOLD_FACTOR)
const tintOf = (index, count) => Math.round((count - 1 - index) * TINT_STEP * 100) / 100

/**
 * A fixed grid, fully deterministic. Columns share one width and one
 * height (the tallest stage decides); they stretch to fill the column when
 * the content needs less and grow the canvas when it needs more, and the
 * dispatcher decides between scaling and the scroll fallback.
 */
export async function layout(ir, { column = COLUMN } = {}) {
  const n = ir.stages.length
  const promotions = ir.promotions ?? []
  const sources = ir.sources ?? []
  const consumers = ir.consumers ?? []

  // column width: the widest header / item / property / arc label decides
  const headW = ir.stages.reduce((m, s) => Math.max(m, NUM_W + boldWidth(s.label)), 0) + BAND_PAD * 2
  const itemBoxW = snapUp4(Math.max(ITEM_MIN_W, ir.stages.flatMap((s) => s.items).reduce((m, t) => Math.max(m, Math.ceil(textWidth(t)) + ITEM_PAD_X * 2), 0)))
  const itemW = itemBoxW + BAND_PAD * 2
  const propW = ir.stages.flatMap((s) => s.properties).reduce((m, t) => Math.max(m, Math.ceil(textWidth(t, EDGE_LABEL_SIZE))), 0) + BAND_PAD * 2
  const arcLabelW = promotions.reduce((m, p) => Math.max(m, p.label ? Math.ceil(textWidth(p.label, EDGE_LABEL_SIZE)) + ARC_LABEL_PAD * 2 : 0), 0)
  const neededColW = snapUp4(Math.max(COL_MIN_W, headW, itemW, propW, arcLabelW))

  // end groups: plain text lists, width from the longest name
  const endW = (names) => (names.length ? snapUp4(names.reduce((m, t) => Math.max(m, Math.ceil(textWidth(t))), 0) + END_PAD * 2) : 0)
  const srcW = endW(sources)
  const consW = endW(consumers)
  const fixed = PAD * 2 + (srcW ? srcW + END_GAP : 0) + (consW ? END_GAP + consW : 0) + (n - 1) * COL_GAP
  const colW = Math.max(neededColW, snap4((column - fixed) / n))
  const width = snapUp4(fixed + n * colW)

  // column height: the tallest stage decides, every column shares it
  const bodyH = (s) => {
    const itemsH = s.items.length ? s.items.length * ITEM_H + (s.items.length - 1) * ITEM_GAP : 0
    const propsH = s.properties.length ? (itemsH ? PROP_GAP : 0) + s.properties.length * PROP_LINE : 0
    return itemsH + propsH
  }
  const tallest = ir.stages.reduce((m, s) => Math.max(m, bodyH(s)), 0)
  const colH = snapUp4(Math.max(COL_MIN_H, HEAD_H + BAND_PAD + tallest + BAND_PAD))

  const yTop = PAD + (promotions.length ? ARC_ZONE : 0)
  const yBottom = yTop + colH
  const centerY = snap4(yTop + colH / 2)
  const height = snapUp4(yBottom + PAD)

  const firstX = PAD + (srcW ? srcW + END_GAP : 0)
  const stages = []
  const items = []
  const properties = []
  ir.stages.forEach((s, i) => {
    const x = firstX + i * (colW + COL_GAP)
    stages.push({
      id: s.id, index: i + 1, label: s.label, emphasis: s.emphasis, tint: tintOf(i, n),
      x, y: yTop, width: colW, height: colH, yTop, yBottom, centerX: snap4(x + colW / 2),
    })
    let y = yTop + HEAD_H + BAND_PAD
    s.items.forEach((label, j) => {
      items.push({ id: `${s.id}-${j + 1}`, stage: s.id, label, x: snap4(x + (colW - itemBoxW) / 2), y, width: itemBoxW, height: ITEM_H })
      y += ITEM_H + ITEM_GAP
    })
    if (s.items.length) y += PROP_GAP - ITEM_GAP
    s.properties.forEach((text) => {
      // baseline sits 12px into the 16px line: 11px text with 1px of lead
      properties.push({ stage: s.id, text, x: x + BAND_PAD, y: y + 12 })
      y += PROP_LINE
    })
  })

  const byId = new Map(stages.map((c) => [c.id, c]))
  const promotionGeo = promotions.map((p, i) => {
    const from = byId.get(p.from)
    const to = byId.get(p.to)
    const forward = to.x >= from.x
    const x1 = snap4(from.x + colW * (forward ? 1 - ARC_INSET : ARC_INSET))
    const x2 = snap4(to.x + colW * (forward ? ARC_INSET : 1 - ARC_INSET))
    const peakY = yTop - ARC_RISE
    const rec = { index: i, from: p.from, to: p.to, x1, y1: yTop, x2, y2: yTop, peakY }
    if (p.label) {
      rec.label = { text: p.label, x: snap4((x1 + x2) / 2), y: peakY - ARC_LABEL_LIFT, width: Math.ceil(textWidth(p.label, EDGE_LABEL_SIZE)) }
    }
    return rec
  })

  const endGroup = (names, x, w, arrowFrom, arrowTo) => {
    if (!names.length) return undefined
    const blockTop = snap4(centerY - (names.length * END_LINE) / 2)
    return {
      x, y: blockTop, width: w, height: names.length * END_LINE,
      entries: names.map((text, k) => ({ text, x: x + END_PAD, y: blockTop + 16 + k * END_LINE })),
      arrow: { x1: arrowFrom, y1: centerY, x2: arrowTo, y2: centerY },
    }
  }
  const first = stages[0]
  const last = stages[n - 1]
  const geo = { stages, items, properties, promotions: promotionGeo, colW, colH, itemBoxW }
  const src = endGroup(sources, PAD, srcW, PAD + srcW + 4, first.x - 4)
  if (src) geo.sources = src
  const cons = endGroup(consumers, last.x + colW + END_GAP, consW, last.x + colW + 4, last.x + colW + END_GAP - 4)
  if (cons) geo.consumers = cons
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

  for (const c of geo.stages) {
    const cls = c.emphasis ? ' class="wu-focal"' : ''
    const sw = c.emphasis ? 1.5 : 1
    const weight = c.emphasis ? ' font-weight="700"' : ''
    const headMid = c.y + HEAD_H / 2
    // the tint: a currentColor wash that fades to nothing at the last stage
    parts.push(`<rect id="${uid}-s-${c.id}-tint" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" fill="currentColor" fill-opacity="${c.tint}" stroke="none"/>`)
    parts.push(`<rect id="${uid}-s-${c.id}"${cls} x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-s-${c.id}-num" x="${c.x + BAND_PAD}" y="${headMid + EDGE_LABEL_SIZE * 0.35}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${c.index}</text>`)
    parts.push(`<text id="${uid}-s-${c.id}-label" x="${c.x + BAND_PAD + NUM_W}" y="${headMid + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(c.label)}</text>`)
    parts.push(`<line id="${uid}-s-${c.id}-rule" x1="${c.x}" y1="${c.y + HEAD_H}" x2="${c.x + c.width}" y2="${c.y + HEAD_H}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  }

  for (const it of geo.items) {
    parts.push(`<rect id="${uid}-i-${it.id}" x="${it.x}" y="${it.y}" width="${it.width}" height="${it.height}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1"/>`)
    parts.push(`<text id="${uid}-i-${it.id}-label" x="${it.x + it.width / 2}" y="${it.y + it.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle" fill="currentColor">${esc(it.label)}</text>`)
  }

  geo.properties.forEach((p, i) => {
    parts.push(`<text id="${uid}-p-${i}" x="${p.x}" y="${p.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(p.text)}</text>`)
  })

  for (const a of geo.promotions) {
    // a cubic whose control points sit level above both ends peaks at
    // 3/4 of their height, so the peak lands exactly ARC_RISE above the top
    const ctlY = a.y1 - (a.y1 - a.peakY) / 0.75
    parts.push(`<path id="${uid}-a-${a.index}" d="M${a.x1} ${a.y1} C${a.x1} ${round2(ctlY)} ${a.x2} ${round2(ctlY)} ${a.x2} ${a.y2}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
    if (a.label) {
      parts.push(`<text id="${uid}-a-${a.index}-label" x="${a.label.x}" y="${a.label.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="middle" fill="currentColor">${esc(a.label.text)}</text>`)
    }
  }

  const endGroup = (g, key) => {
    if (!g) return
    g.entries.forEach((e, i) => {
      parts.push(`<text id="${uid}-${key}-${i}" x="${e.x}" y="${e.y}" font-size="${FONT_SIZE}" fill="currentColor">${esc(e.text)}</text>`)
    })
    parts.push(`<line id="${uid}-${key}-arrow" x1="${g.arrow.x1}" y1="${g.arrow.y1}" x2="${g.arrow.x2}" y2="${g.arrow.y2}" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
  }
  endGroup(geo.sources, 'src')
  endGroup(geo.consumers, 'cons')

  return parts.join('')
}

const round2 = (v) => Math.round(v * 100) / 100

// --- verify --------------------------------------------------------------

const ITEM_CLEARANCE = 8

export function verify(layoutResult, ir) {
  const { geo } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    const row = { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint }
    if (w) { row.key = w.key; row.value = w.value }
    rows.push(row)
  }
  budgetRow(1, 'stage-count', 'budget:stages', `${ir.stages.length} stage(s)`)
  budgetRow(2, 'items-per-stage', 'budget:items', `at most ${ir.stages.reduce((m, s) => Math.max(m, s.items.length), 0)} item(s) in a stage`)
  budgetRow(3, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  budgetRow(4, 'emphasis-count', 'budget:emphasis', `${ir.stages.filter((s) => s.emphasis).length} emphasized stage(s)`)

  // 5. columns run left → right in IR order, equal width, never overlapping
  const order = ir.stages.map((s) => s.id)
  const inOrder = geo.stages.length === order.length && geo.stages.every((c, i) => c.id === order[i])
  const overlaps = []
  for (let i = 1; i < geo.stages.length; i++) {
    const prev = geo.stages[i - 1]
    const cur = geo.stages[i]
    if (cur.x < prev.x + prev.width) overlaps.push(`${prev.id}/${cur.id}`)
  }
  const widths = new Set(geo.stages.map((c) => c.width))
  const stagesOk = inOrder && overlaps.length === 0 && widths.size === 1 && geo.stages.every((c) => c.width > 0 && c.yBottom > c.yTop)
  rows.push({
    id: 5, name: 'stages-ordered', severity: 'fail', ok: stagesOk,
    detail: stagesOk ? 'stages run left to right in IR order, equal width, without overlapping'
      : !inOrder ? 'stage order differs from ir.stages' : overlaps.length ? `overlapping stages: ${overlaps.join(', ')}` : 'stage columns differ in width',
    hint: stagesOk ? undefined : 'lay the stages out in IR order, one shared column width, each starting right of the previous column',
  })

  // 6. promotions join a stage to the one directly right of it, and only that one
  const indexOf = new Map(order.map((id, i) => [id, i]))
  const badPromotions = geo.promotions.filter((a) => indexOf.get(a.to) - indexOf.get(a.from) !== 1)
  rows.push({
    id: 6, name: 'promotions-adjacent', severity: 'fail', ok: badPromotions.length === 0,
    detail: badPromotions.length ? `promotion(s) that skip a stage or run right → left: ${badPromotions.map((a) => `${a.from}→${a.to}`).join(', ')}`
      : geo.promotions.length ? 'every promotion joins a stage to the one directly right of it' : 'no promotions',
    hint: badPromotions.length ? 'a promotion may only move data one stage to the right — chain it through the stage in between, or drop it' : undefined,
  })

  // 7. arc labels never overlap each other (they share one baseline) and stay on the canvas
  const labels = geo.promotions.filter((a) => a.label).map((a) => ({ id: `${a.from}→${a.to}`, left: a.label.x - a.label.width / 2, right: a.label.x + a.label.width / 2 })).sort((p, q) => p.left - q.left)
  const collisions = []
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].left < labels[i - 1].right + ARC_LABEL_PAD) collisions.push(`${labels[i - 1].id} / ${labels[i].id}`)
  }
  const offCanvas = labels.filter((l) => l.left < 0 || l.right > layoutResult.width).map((l) => l.id)
  const labelsOk = collisions.length === 0 && offCanvas.length === 0
  rows.push({
    id: 7, name: 'arc-labels-clear', severity: 'fail', ok: labelsOk,
    detail: labelsOk ? (labels.length ? `every arc label keeps ≥ ${ARC_LABEL_PAD}px from its neighbours` : 'no arc labels')
      : collisions.length ? `overlapping arc labels: ${collisions.join(', ')}` : `arc label(s) leave the canvas: ${offCanvas.join(', ')}`,
    hint: labelsOk ? undefined : 'shorten the promotion labels or widen the stage columns so each label fits above its own arc',
  })

  // 8. every item box and property line sits inside its own stage with ≥ 8px clearance
  const stageById = new Map(geo.stages.map((c) => [c.id, c]))
  const outsideItems = geo.items.filter((it) => {
    const c = stageById.get(it.stage)
    if (!c) return true
    return it.x < c.x + ITEM_CLEARANCE || it.x + it.width > c.x + c.width - ITEM_CLEARANCE
      || it.y < c.yTop + HEAD_H || it.y + it.height > c.yBottom - ITEM_CLEARANCE
  }).map((it) => it.id)
  const outsideProps = geo.properties.filter((p) => {
    const c = stageById.get(p.stage)
    if (!c) return true
    return p.x < c.x + ITEM_CLEARANCE || p.y - EDGE_LABEL_SIZE < c.yTop + HEAD_H || p.y > c.yBottom - ITEM_CLEARANCE
  }).map((p) => `${p.stage}:"${p.text}"`)
  const outside = [...outsideItems, ...outsideProps]
  rows.push({
    id: 8, name: 'items-inside-stage', severity: 'fail', ok: outside.length === 0,
    detail: outside.length ? `item(s)/propert${outside.length === 1 ? 'y' : 'ies'} outside their stage or closer than ${ITEM_CLEARANCE}px to its edge: ${outside.join(', ')}`
      : `every item and property sits inside its stage with ≥ ${ITEM_CLEARANCE}px clearance`,
    hint: outside.length ? 'grow the column to hold every item and property line of its stage' : undefined,
  })

  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'data-platform stages left → right (bronze → silver → gold) with the datasets in each, per-stage properties, and the promotions between them',
  whenToUse: 'when one dataset moves through ranked quality/access tiers and the question is "what lives where, under which rules, and how does it get promoted"; not for a role workflow (use process) or a cluster overview (use diagram). Budgets: stages ≤ 5, items per stage ≤ 6, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: lakehouse-tiers
type: medallion
title: レイクハウスの層構成
caption: ゴールド層だけを BI と API に公開し、下位層は内部利用に限る
stages:
  - id: bronze
    label: ブロンズ
    items: [raw_events, raw_orders]
    properties: ["保持 90 日", "スキーマ検証なし"]
  - id: silver
    label: シルバー
    items: [events, orders]
    properties: ["保持 2 年", "重複排除・型検証"]
  - id: gold
    label: ゴールド
    emphasis: true
    items: [daily_sales, customer_360]
    properties: ["保持 無期限", "SLA 付き品質検査"]
promotions:
  - from: bronze
    to: silver
    label: 正規化
  - from: silver
    to: gold
    label: 集計
sources: [アプリ DB, 行動ログ]
consumers: [BI, 公開 API]
`,
  rows: ['stage-count', 'items-per-stage', 'label-length', 'emphasis-count', 'stages-ordered', 'promotions-adjacent', 'arc-labels-clear', 'items-inside-stage'],
}
