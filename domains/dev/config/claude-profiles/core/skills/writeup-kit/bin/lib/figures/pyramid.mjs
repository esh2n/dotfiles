// `type: pyramid` — stacked trapezoid tiers that narrow upward (a ranked
// hierarchy with the apex on top: `variant: pyramid`) or downward (a
// conversion drop-off with the wide intake on top: `variant: funnel`).
// Tiers touch edge to edge; widths step evenly, or — when every tier
// carries a `value` — proportionally to that value, with the value drawn in
// a column at the right. Labels sit inside their tier when they fit at its
// narrow end, otherwise outside on the right behind a horizontal leader.
//
// IR shape: `{ id, type:'pyramid', title, caption, variant, tiers }`
//   variant: 'pyramid' (default) | 'funnel' — one direction per figure
//   tiers:   [{ id, label, value?, note?, emphasis, tone }] ordered top → bottom;
//            `value` is all-or-none (a partial funnel cannot be proportional)
//
// Focal tier: exactly one tier carries the accent. When no tier says
// `emphasis: true`, normalize() fills the default in — the apex for a
// pyramid, the bottleneck (narrowest, bottom) tier for a funnel — so the
// drawing always has one accent and the IR round-trips unchanged. Budgets
// (design survey #18): 4–6 tiers, emphasis ≤ 1, a funnel should carry real
// values, and a pyramid's accent belongs on the apex, never on the base —
// each an advisory warn row.
//
// Only ranked or monotonically shrinking data belongs here (design survey
// #18): a set without rank wants a tree or a bar chart, and a flow that
// branches wants a sankey.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'pyramid'

export const limits = { minTiers: 4, maxTiers: 6, maxLabelLen: 14, maxEmphasis: 1 }

const VARIANTS = new Set(['pyramid', 'funnel'])

// --- layout constants (px; positions land on the 4px grid) ---------------

const PAD = 16              // canvas margin
const WIDE_W = 416          // the wide end of the stack (base of a pyramid, intake of a funnel)
const NARROW_W = 64         // the narrow end when widths step evenly
const NARROW_RATIO = 0.5    // proportional mode: the free edge of the extreme tier vs its reference edge
const TIER_H = 48           // tier height, label only
const TIER_H_NOTE = 56      // tier height when any tier carries a note
const INNER_PAD = 8         // label ↔ slanted edge clearance for an inside label
const SIDE_GAP = 24         // stack ↔ outside-label / value column
const LEADER_GAP = 8        // leader end ↔ outside label start
const LEADER_MIN = 4        // shortest leader that still reads as one
const OPACITY_MIN = 0.05    // neutral fill lightness steps from top …
const OPACITY_MAX = 0.30    // … to bottom

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeVariant(raw.variant, ctx)
  const tiers = normalizeTiers(raw.tiers, ctx)
  if (!tiers.some((t) => t.emphasis)) tiers[defaultFocalIndex(variant, tiers.length)].emphasis = true
  return { id, type, title, caption, variant, tiers }
}

/** The tier that takes the accent when the author names none: the apex of
 * a pyramid (index 0), the bottleneck of a funnel (the last, narrowest tier). */
const defaultFocalIndex = (variant, n) => (variant === 'funnel' ? n - 1 : 0)

function normalizeVariant(v, ctx) {
  if (v === undefined || v === null) return 'pyramid'
  if (typeof v !== 'string' || !VARIANTS.has(v)) throw new IrError(`${ctx}.variant must be pyramid|funnel (got: ${JSON.stringify(v)})`)
  return v
}

function normalizeTiers(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.tiers must be a non-empty list`)
  if (raw.length < 2) throw new IrError(`${ctx}.tiers needs at least 2 tiers to stack (got: ${raw.length})`)
  const seen = new Set()
  const tiers = raw.map((t, i) => {
    const tctx = `${ctx}.tiers[${i}]`
    if (!isObj(t)) throw new IrError(`${tctx} must be a mapping`)
    const id = requireStr(t, 'id', tctx)
    if (seen.has(id)) throw new IrError(`duplicate tier id: "${id}"`)
    seen.add(id)
    const rec = { id, label: requireStr(t, 'label', tctx) }
    if (t.value !== undefined && t.value !== null) {
      if (typeof t.value !== 'number' || !Number.isFinite(t.value) || t.value <= 0) {
        throw new IrError(`${tctx}.value must be a finite number > 0 (got: ${JSON.stringify(t.value)})`)
      }
      rec.value = t.value
    }
    const note = optStr(t, 'note', tctx)
    if (note !== undefined) {
      if (note.trim() === '') throw new IrError(`${tctx}.note must be a non-empty string`)
      rec.note = note
    }
    rec.tone = validateTone(t.tone, tctx)
    rec.emphasis = validateBool(t, 'emphasis', tctx)
    return rec
  })
  const withValue = tiers.filter((t) => t.value !== undefined).length
  if (withValue !== 0 && withValue !== tiers.length) {
    throw new IrError(`${ctx}.tiers: value must be given on every tier or on none (${withValue} of ${tiers.length} carry one)`)
  }
  return tiers
}

// --- budgets -------------------------------------------------------------

const longestLabel = (ir) => ir.tiers.reduce((m, t) => (t.label.length > m.length ? t.label : m), '')

export function budgetWarnings(ir) {
  const out = []
  const n = ir.tiers.length
  if (n > limits.maxTiers) {
    out.push(budgetWarning('budget:tiers', n, limits.maxTiers,
      `${n} tier(s) (guidance ≤ ${limits.maxTiers})`,
      'merge neighbouring tiers or keep only the stages the decision is about'))
  } else if (n < limits.minTiers) {
    out.push(budgetWarning('budget:tiers', n, limits.minTiers,
      `${n} tier(s) (guidance ≥ ${limits.minTiers})`,
      'fewer than 4 tiers reads as a before/after — name the intermediate stages, or use a bar chart'))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and move the detail into the tier\'s note or the caption'))
  }
  const emphasized = ir.tiers.filter((t) => t.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized tier(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the apex or the one bottleneck tier'))
  }
  if (ir.variant === 'funnel' && !hasValues(ir)) {
    out.push(budgetWarning('budget:values', 0, n,
      `funnel without values (0 of ${n} tiers carry one)`,
      'a funnel is a claim about drop-off — give every tier its real count so the widths are proportional, or draw a pyramid'))
  }
  const base = ir.tiers[n - 1]
  if (ir.variant === 'pyramid' && base.emphasis) {
    out.push(budgetWarning('budget:base-emphasis', 1, 0,
      `the base tier "${base.id}" carries emphasis`,
      'a pyramid\'s accent belongs on the apex (or the one bottleneck tier) — the base is the widest tier and needs no accent to be seen'))
  }
  return out
}

// --- layout --------------------------------------------------------------

const hasValues = (ir) => ir.tiers[0].value !== undefined
const labelWidth = (t) => Math.ceil(textWidth(t.label) * (t.emphasis ? BOLD_FACTOR : 1))
const noteWidth = (t) => (t.note ? Math.ceil(textWidth(t.note, EDGE_LABEL_SIZE)) : 0)
const snap8 = (v) => Math.round(v / 8) * 8

/** Thousands-separated, locale-independent (`12000` → `12,000`, `2.5` → `2.5`). */
function formatValue(v) {
  const s = String(v)
  const [int, frac] = s.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/**
 * The n+1 horizontal edges of the stack, top → bottom. Even mode steps from
 * the narrow to the wide end (snapped to 8 so every corner lands on the
 * grid); proportional mode maps each tier's reference edge (the base of a
 * pyramid tier, the top of a funnel tier) to value/max × WIDE_W and lets
 * the extreme tier's free edge be a fixed ratio of its reference edge.
 */
function edgeWidths(ir) {
  const n = ir.tiers.length
  const funnel = ir.variant === 'funnel'
  if (!hasValues(ir)) {
    const asc = Array.from({ length: n + 1 }, (_, k) => snap8(NARROW_W + (WIDE_W - NARROW_W) * k / n))
    return funnel ? asc.reverse() : asc
  }
  const max = Math.max(...ir.tiers.map((t) => t.value))
  const ref = ir.tiers.map((t) => Math.round(t.value / max * WIDE_W))
  if (funnel) return [...ref, Math.round(ref[n - 1] * NARROW_RATIO)]
  return [Math.round(ref[0] * NARROW_RATIO), ...ref]
}

/** Width of the stack at height `y` inside tier `t` (linear between its edges). */
function widthAt(t, y) {
  const h = t.yBottom - t.yTop
  return t.wTop + (t.wBottom - t.wTop) * (y - t.yTop) / h
}

export async function layout(ir, { column = COLUMN } = {}) {
  const n = ir.tiers.length
  const values = hasValues(ir)
  const anyNote = ir.tiers.some((t) => t.note)
  const tierH = anyNote ? TIER_H_NOTE : TIER_H
  const edges = edgeWidths(ir)
  const funnel = ir.variant === 'funnel'

  // vertical stack: tiers touch, top at PAD
  const tiers = ir.tiers.map((t, i) => {
    const yTop = PAD + i * tierH
    const opacity = n === 1 ? OPACITY_MIN : OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * i / (n - 1)
    const rec = {
      id: t.id, index: i + 1, label: t.label, tone: t.tone, emphasis: t.emphasis,
      yTop, yBottom: yTop + tierH, cx: 0,
      wTop: edges[i], wBottom: edges[i + 1], wRef: funnel ? edges[i] : edges[i + 1],
      opacity: Number(opacity.toFixed(2)),
    }
    if (t.note) rec.note = t.note
    if (values) { rec.value = t.value; rec.valueText = formatValue(t.value) }
    return rec
  })

  // which labels fit inside: the label block must clear the slanted edges at
  // both its top and bottom line, with INNER_PAD on each side
  const blocks = ir.tiers.map((t, i) => {
    const g = tiers[i]
    const midY = g.yTop + tierH / 2
    const labelY = t.note ? midY - 4 : midY + 4          // baselines, on the grid
    const noteY = t.note ? midY + 12 : undefined
    const blockTop = labelY - FONT_SIZE
    const blockBottom = t.note ? noteY : labelY
    const need = Math.max(labelWidth(t), noteWidth(t)) + INNER_PAD * 2
    const avail = Math.min(widthAt(g, blockTop), widthAt(g, blockBottom))
    return { labelY, noteY, midY, need, inside: need <= avail, textW: Math.max(labelWidth(t), noteWidth(t)) }
  })

  // right-hand columns: outside labels first, then the value column
  const outsideW = snapUp4(blocks.reduce((m, b) => (b.inside ? m : Math.max(m, b.textW)), 0))
  const valueW = values ? snapUp4(tiers.reduce((m, t) => Math.max(m, Math.ceil(textWidth(t.valueText, EDGE_LABEL_SIZE))), 0)) : 0
  let sideW = 0
  if (outsideW) sideW += SIDE_GAP + outsideW
  if (valueW) sideW += SIDE_GAP + valueW
  const blockW = WIDE_W + sideW
  const needed = snapUp4(PAD * 2 + blockW)
  const width = Math.max(column, needed)
  const x0 = snap4((width - blockW) / 2)
  const cx = x0 + WIDE_W / 2
  for (const t of tiers) t.cx = cx

  const stackRight = cx + WIDE_W / 2
  const outsideX = stackRight + SIDE_GAP
  const valuesRight = outsideW ? outsideX + outsideW + SIDE_GAP + valueW : stackRight + SIDE_GAP + valueW

  const labels = ir.tiers.map((t, i) => {
    const g = tiers[i]
    const b = blocks[i]
    const rec = { tier: t.id, text: t.label, width: labelWidth(t), inside: b.inside, y: b.labelY }
    if (t.note) rec.note = { text: t.note, width: noteWidth(t), y: b.noteY }
    if (b.inside) {
      rec.x = cx
    } else {
      rec.x = outsideX
      // the leader starts just inside the tier's right edge (floored to the grid) and runs level
      const edgeX = Math.floor((cx + widthAt(g, b.midY) / 2) / 4) * 4
      rec.leader = { x1: edgeX, y1: b.midY, x2: outsideX - LEADER_GAP, y2: b.midY }
    }
    return rec
  })

  const geo = { tiers, labels, tierH, stackRight }
  if (values) {
    geo.values = { x: valuesRight, width: valueW, items: tiers.map((t) => ({ tier: t.id, text: t.valueText, x: valuesRight, y: t.yTop + tierH / 2 + 4 })) }
  }
  const height = snapUp4(PAD * 2 + n * tierH)
  return { width, height, geo }
}

// --- draw ----------------------------------------------------------------

const polygonPoints = (t) => [
  [t.cx - t.wTop / 2, t.yTop], [t.cx + t.wTop / 2, t.yTop],
  [t.cx + t.wBottom / 2, t.yBottom], [t.cx - t.wBottom / 2, t.yBottom],
].map(([x, y]) => `${x},${y}`).join(' ')

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []

  // plain tiers first, emphasized ones on top so the accent stroke is never
  // covered by a neighbour's shared edge
  const ordered = [...geo.tiers.filter((t) => !t.emphasis), ...geo.tiers.filter((t) => t.emphasis)]
  for (const t of ordered) {
    const fill = t.tone === 'neutral'
      ? ` fill="currentColor" fill-opacity="${t.opacity}"`
      : ` fill="var(--wu-fig-tone-${t.tone})"`
    const stroke = t.emphasis ? ' class="wu-focal" stroke="var(--wu-accent)" stroke-width="1.5"' : ' stroke="currentColor" stroke-width="1"'
    const value = t.value !== undefined ? ` data-value="${t.value}"` : ''
    parts.push(`<polygon id="${uid}-t-${t.id}" data-tone="${esc(t.tone)}"${value} points="${polygonPoints(t)}"${fill}${stroke} stroke-linejoin="round"/>`)
  }

  for (const l of geo.labels) {
    const t = geo.tiers.find((x) => x.id === l.tier)
    const weight = t.emphasis ? ' font-weight="700"' : ''
    const anchor = l.inside ? ' text-anchor="middle"' : ''
    if (l.leader) {
      parts.push(`<line id="${uid}-t-${l.tier}-leader" x1="${l.leader.x1}" y1="${l.leader.y1}" x2="${l.leader.x2}" y2="${l.leader.y2}" stroke="currentColor" stroke-width="1"/>`)
    }
    parts.push(`<text id="${uid}-t-${l.tier}-label" x="${l.x}" y="${l.y}" font-size="${FONT_SIZE}"${weight}${anchor} fill="currentColor">${esc(l.text)}</text>`)
    if (l.note) {
      parts.push(`<text id="${uid}-t-${l.tier}-note" x="${l.x}" y="${l.note.y}" font-size="${EDGE_LABEL_SIZE}"${anchor} fill="var(--wu-ink-3)">${esc(l.note.text)}</text>`)
    }
  }

  if (geo.values) {
    for (const v of geo.values.items) {
      parts.push(`<text id="${uid}-t-${v.tier}-value" x="${v.x}" y="${v.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="var(--wu-ink-3)">${esc(v.text)}</text>`)
    }
  }

  return parts.join('')
}

// --- verify --------------------------------------------------------------

export function verify(layoutResult, ir, { svg = '' } = {}) {
  const { geo, width } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'tier-count', 'budget:tiers', `${ir.tiers.length} tier(s)`)
  budgetRow(2, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  budgetRow(3, 'emphasis-count', 'budget:emphasis', `${ir.tiers.filter((t) => t.emphasis).length} emphasized tier(s)`)
  budgetRow(4, 'funnel-values', 'budget:values', ir.variant === 'funnel' ? 'every funnel tier carries a value' : 'not a funnel')
  budgetRow(5, 'emphasis-placement', 'budget:base-emphasis', ir.variant === 'pyramid' ? 'the accent is off the base tier' : 'a funnel may accent its bottleneck')

  // 4. tiers in IR order, top → bottom, sharing both the edge y and the edge width
  const order = ir.tiers.map((t) => t.id)
  const inOrder = geo.tiers.length === order.length && geo.tiers.every((t, i) => t.id === order[i])
  const gaps = []
  for (let i = 1; i < geo.tiers.length; i++) {
    const prev = geo.tiers[i - 1]
    const cur = geo.tiers[i]
    if (cur.yTop !== prev.yBottom || cur.wTop !== prev.wBottom || cur.cx !== prev.cx) gaps.push(`${prev.id}/${cur.id}`)
  }
  const positive = geo.tiers.every((t) => t.yBottom > t.yTop)
  const orderedOk = inOrder && gaps.length === 0 && positive
  rows.push({
    id: 6, name: 'tiers-ordered', severity: 'fail', ok: orderedOk,
    detail: orderedOk ? 'tiers run top to bottom in IR order, each sharing its edge with the next'
      : !inOrder ? 'tier order differs from ir.tiers' : !positive ? 'a tier has no height' : `tiers not touching edge to edge: ${gaps.join(', ')}`,
    hint: orderedOk ? undefined : 'stack tiers in IR order so each starts on the previous tier\'s bottom edge with the same width',
  })

  // 5. widths monotonic in the variant's direction (narrowing upward for a pyramid, downward for a funnel)
  const edges = geo.tiers.length ? [geo.tiers[0].wTop, ...geo.tiers.map((t) => t.wBottom)] : []
  const funnel = ir.variant === 'funnel'
  const step = (a, b) => (funnel ? b <= a : b >= a)
  const monotonic = edges.every((w, k) => k === 0 || step(edges[k - 1], w)) && edges.length > 1
    && (funnel ? edges[0] > edges[edges.length - 1] : edges[0] < edges[edges.length - 1])
  rows.push({
    id: 7, name: 'widths-monotonic', severity: 'fail', ok: monotonic,
    detail: monotonic ? `widths ${funnel ? 'narrow downward' : 'widen downward'} (${edges.join(' → ')})`
      : `widths are not ${funnel ? 'non-increasing' : 'non-decreasing'} top → bottom (${edges.join(' → ')})`,
    hint: monotonic ? undefined : funnel
      ? 'a funnel\'s values must not grow from one tier to the next — reorder the tiers or use variant: pyramid'
      : 'a pyramid\'s values must not shrink from one tier to the next — reorder the tiers or use variant: funnel',
  })

  // 6. proportional widths when values are given: reference edge = value/max × WIDE_W within 1px, value drawn
  if (hasValues(ir)) {
    const max = Math.max(...ir.tiers.map((t) => t.value))
    const off = []
    const byId = new Map(geo.tiers.map((t) => [t.id, t]))
    for (const t of ir.tiers) {
      const g = byId.get(t.id)
      const expect = t.value / max * WIDE_W
      if (!g || Math.abs(g.wRef - expect) > 1) off.push(`${t.id} (${g ? g.wRef : '?'}px vs ${expect.toFixed(1)}px)`)
      else if (!new RegExp(`id="wu-d-${ir.id}-t-${t.id}-value"[^>]*>${esc(formatValue(t.value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(svg)) off.push(`${t.id} (value ${formatValue(t.value)} not drawn)`)
      else if (!new RegExp(`id="wu-d-${ir.id}-t-${t.id}"[^>]*data-value="${t.value}"`).test(svg)) off.push(`${t.id} (missing data-value)`)
    }
    rows.push({
      id: 8, name: 'values-proportional', severity: 'fail', ok: off.length === 0,
      detail: off.length ? `tier width not proportional to its value or value not drawn: ${off.join(', ')}` : `every tier's ${funnel ? 'top' : 'base'} edge is value/max × ${WIDE_W}px within 1px, value drawn at the right`,
      hint: off.length ? 'lay widths out from value/max × the wide end and draw each value in the right-hand column' : undefined,
    })
  } else {
    rows.push({ id: 8, name: 'values-proportional', severity: 'fail', ok: true, detail: 'no values — widths step evenly' })
  }

  // 7. every label legible: inside labels clear the slanted edges, outside labels sit within the canvas behind a leader that does not cross the value column
  const bad = []
  const tierById = new Map(geo.tiers.map((t) => [t.id, t]))
  for (const l of geo.labels) {
    const t = tierById.get(l.tier)
    if (!t) { bad.push(`${l.tier} (no tier)`); continue }
    const textW = Math.max(l.width, l.note?.width ?? 0)
    const top = l.y - FONT_SIZE
    const bottom = l.note ? l.note.y : l.y
    if (top < t.yTop || bottom > t.yBottom) { bad.push(`${l.tier} (label outside its tier's rows)`); continue }
    if (l.inside) {
      const avail = Math.min(widthAt(t, top), widthAt(t, bottom))
      if (textW + INNER_PAD * 2 > avail || l.x !== t.cx) bad.push(`${l.tier} (needs ${textW + INNER_PAD * 2}px, tier offers ${Math.floor(avail)}px)`)
    } else {
      const ld = l.leader
      const right = l.x + textW
      const limit = geo.values ? geo.values.x - geo.values.width - LEADER_MIN : width - PAD
      if (!ld || ld.y1 !== ld.y2 || ld.x2 - ld.x1 < LEADER_MIN || ld.y1 < t.yTop || ld.y1 > t.yBottom) bad.push(`${l.tier} (leader missing or not a level line inside the tier)`)
      else if (ld.x2 > l.x || right > limit) bad.push(`${l.tier} (outside label runs past ${geo.values ? 'the value column' : 'the canvas'})`)
    }
  }
  rows.push({
    id: 9, name: 'labels-legible', severity: 'fail', ok: bad.length === 0,
    detail: bad.length ? `label(s) not legible: ${bad.join(', ')}` : `${geo.labels.filter((l) => l.inside).length} label(s) inside their tier, ${geo.labels.filter((l) => !l.inside).length} outside with a leader`,
    hint: bad.length ? 'move a label that no longer fits its tier outside with a leader, or shorten it' : undefined,
  })

  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'stacked tiers narrowing upward (a ranked hierarchy, apex on top) or downward (a conversion funnel, optionally proportional to real values)',
  whenToUse: 'when the tiers are truly ranked or shrink monotonically and the question is "what sits above what" or "where do we lose the most"; not for unranked sets (use a tree or a bar chart) or branching flows (use a sankey). Budgets: tiers 4–6, label ≤ 14 chars, emphasis ≤ 1 (on the apex or the bottleneck, never the base), funnels carry real values — guidance, over-budget figures still render with data-warn. With no emphasis given, the apex (pyramid) or the bottom tier (funnel) takes the accent.',
  irExample: `id: signup-funnel
type: pyramid
variant: funnel
title: 登録ファネル
caption: 有料化の手前で 87% が離脱している
tiers:
  - id: visit
    label: 訪問
    value: 12000
  - id: signup
    label: 登録
    value: 3600
    note: メール認証まで
  - id: paid
    label: 有料化
    value: 480
    emphasis: true
  - id: retained
    label: 継続
    value: 210
    note: 3 か月後
`,
  rows: ['tier-count', 'label-length', 'emphasis-count', 'funnel-values', 'emphasis-placement', 'tiers-ordered', 'widths-monotonic', 'values-proportional', 'labels-legible'],
}
