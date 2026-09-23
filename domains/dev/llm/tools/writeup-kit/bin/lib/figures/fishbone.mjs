// `type: fishbone` — a cause-and-effect (Ishikawa) diagram: one effect box
// at the right end of a horizontal spine, category bones leaning back from
// the spine at 60°, alternating above / below it in IR order, the category
// label boxed at the outer tip of its bone, and the causes of each category
// hung along the bone as short horizontal ticks with the cause text to the
// left of the tick.
//
// IR shape: `{ id, type:'fishbone', title, caption, effect, categories }`
//   effect:     the symptom the figure explains (write it as a symptom, not
//               as the fix — "p95 が 3 倍に悪化", not "キャッシュを入れる")
//   categories: [{ id, label, emphasis, causes: [{ label, emphasis }] }] — a
//               raw cause may be a bare string. The accent lives on the
//               category bone (design survey #31: accent = the root-cause
//               bone + the effect box): `emphasis` on a category draws its
//               bone and label box in the accent stroke, and `emphasis` on a
//               cause promotes its category (normalize() sets the category's
//               `emphasis`) and bolds the cause text. At most one accented
//               bone per figure (budget:emphasis).
// Budgets (survey #31): categories ≤ 6, causes ≤ 3 per bone and ≤ 18 in
// total, labels ≤ 14 chars — advisory warn rows.
//
// Geometry: the bones are the documented exception to the kit's
// orthogonal-connector rule (design survey §3: "Fishbone の骨"). They are
// drawn with a 7:4 rise:run — atan(7/4) = 60.26°, visually the classic 60°
// — instead of an exact tan(60°), because every tick then lands on the 4px
// grid: one 28px slot down the spine is one 16px step along the run, so
// bone/tick anchors are integers and the shared `grid-4px` row holds
// without any snapping that would lift a tick off its bone.
import { IrError, isObj, requireStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'fishbone'

export const limits = { maxCategories: 6, maxCausesPerCategory: 3, maxCauses: 18, maxLabelLen: 14, maxEmphasis: 1 }

// --- layout constants (px; positions derived from them stay on the 4px grid) --

const PAD = 16
const SLOT = 28           // vertical distance between two cause ticks on a bone
const RUN = 16            // horizontal shift per slot → bone slope 7:4 (60.26°)
const TICK = 32           // cause tick length (design survey: 32px sub-cause tick)
const TICK_GAP = 4        // tick end ↔ cause text
const CLEAR = 12          // cause text ↔ the neighbouring bone (verify: no overlap)
const MIN_SPACING = 96    // join ↔ join floor
const CAT_BOX_H = 24
const CAT_BOX_PAD_X = 12
const EFFECT_H = 40
const EFFECT_PAD_X = 16
const END_GAP = 48        // last join → effect box
const TEXT_HALF_H = 6     // half the 11px cause text's box height (for overlap tests)

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const effect = requireStr(raw, 'effect', ctx)
  const categories = normalizeCategories(raw.categories, ctx)
  return { id, type, title, caption, effect, categories }
}

function normalizeCategories(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.categories must be a non-empty list`)
  const seen = new Set()
  return raw.map((c, i) => {
    const cctx = `${ctx}.categories[${i}]`
    if (!isObj(c)) throw new IrError(`${cctx} must be a mapping`)
    const id = requireStr(c, 'id', cctx)
    if (seen.has(id)) throw new IrError(`duplicate category id: "${id}"`)
    seen.add(id)
    const label = requireStr(c, 'label', cctx)
    if (!Array.isArray(c.causes) || c.causes.length === 0) throw new IrError(`${cctx}.causes must be a non-empty list (an empty bone says nothing — drop the category)`)
    const causes = c.causes.map((k, j) => {
      const kctx = `${cctx}.causes[${j}]`
      if (typeof k === 'string') {
        if (k.trim() === '') throw new IrError(`${kctx} must be a non-empty string`)
        return { label: k, emphasis: false }
      }
      if (isObj(k)) return { label: requireStr(k, 'label', kctx), emphasis: validateBool(k, 'emphasis', kctx) }
      throw new IrError(`${kctx} must be a string or a mapping`)
    })
    // an emphasised cause accents its bone: the category becomes the focal one
    const emphasis = validateBool(c, 'emphasis', cctx) || causes.some((k) => k.emphasis)
    return { id, label, emphasis, causes }
  })
}

// --- budgets -------------------------------------------------------------

function longestLabel(ir) {
  let best = ''
  for (const c of ir.categories) {
    if (c.label.length > best.length) best = c.label
    for (const k of c.causes) if (k.label.length > best.length) best = k.label
  }
  return best
}

const emphasisCount = (ir) => ir.categories.filter((c) => c.emphasis).length
const causeCount = (ir) => ir.categories.reduce((n, c) => n + c.causes.length, 0)

export function budgetWarnings(ir) {
  const out = []
  const n = ir.categories.length
  if (n > limits.maxCategories) {
    out.push(budgetWarning('budget:categories', n, limits.maxCategories,
      `${n} categor${n === 1 ? 'y' : 'ies'} (guidance ≤ ${limits.maxCategories})`,
      'merge the two closest categories, or split the analysis into one fishbone per symptom'))
  }
  const fattest = ir.categories.reduce((m, c) => (c.causes.length > m.causes.length ? c : m), ir.categories[0])
  if (fattest.causes.length > limits.maxCausesPerCategory) {
    out.push(budgetWarning('budget:causes', fattest.causes.length, limits.maxCausesPerCategory,
      `category "${fattest.id}" lists ${fattest.causes.length} cause(s) (guidance ≤ ${limits.maxCausesPerCategory})`,
      `keep the causes of "${fattest.id}" that were actually investigated and move the rest to the caption or a list`))
  }
  const total = causeCount(ir)
  if (total > limits.maxCauses) {
    out.push(budgetWarning('budget:total', total, limits.maxCauses,
      `${total} causes in total (guidance ≤ ${limits.maxCauses})`,
      'a fishbone shows what was investigated, not everything imaginable — keep the causes with evidence and list the rest in the caption'))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label to a noun phrase and put the explanation in the caption'))
  }
  const emphasized = emphasisCount(ir)
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized bone(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep the accent on the one bone whose root cause the decision acts on'))
  }
  return out
}

// --- layout --------------------------------------------------------------

const boldWidth = (text, size = FONT_SIZE) => Math.ceil(textWidth(text, size) * BOLD_FACTOR)
const causeWidth = (k) => Math.ceil(textWidth(k.label, EDGE_LABEL_SIZE) * (k.emphasis ? BOLD_FACTOR : 1))

/**
 * Deterministic: every bone has the same length (K+1 slots, K = the largest
 * cause count), categories 0,2,4… hang above the spine and 1,3,5… below it,
 * the pair (2j, 2j+1) sharing the join x. A category with fewer causes than
 * K uses the slots nearest its label box, so the text reads label → causes
 * top-to-bottom on the upper side and causes → label on the lower side,
 * cause order always increasing with y.
 */
export async function layout(ir) {
  const n = ir.categories.length
  const K = ir.categories.reduce((m, c) => Math.max(m, c.causes.length), 1)
  const rise = SLOT * (K + 1)
  const run = RUN * (K + 1)

  const maxCauseW = ir.categories.reduce((m, c) => Math.max(m, ...c.causes.map(causeWidth)), 0)
  // multiples of 8 so a box centered on its bone tip keeps its x on the grid
  const boxWidths = ir.categories.map((c) => Math.ceil((boldWidth(c.label) + CAT_BOX_PAD_X * 2) / 8) * 8)
  const maxBoxW = Math.max(...boxWidths)
  const spacing = snapUp4(Math.max(MIN_SPACING, maxCauseW + TICK + TICK_GAP + CLEAR, maxBoxW + 8))

  // the top-most tick (slot K) reaches furthest left; so does the label box
  const firstJoin = PAD + snapUp4(Math.max(RUN * K + TICK + TICK_GAP + maxCauseW, run + maxBoxW / 2))
  const perSide = Math.ceil(n / 2)
  const hasBottom = n >= 2
  const spineY = PAD + CAT_BOX_H + rise
  const height = snapUp4(spineY + (hasBottom ? rise + CAT_BOX_H : SLOT) + PAD)

  const lastJoin = firstJoin + (perSide - 1) * spacing
  const spineX2 = lastJoin + END_GAP
  const effectW = snapUp4(boldWidth(ir.effect) + EFFECT_PAD_X * 2)
  const effect = { x: spineX2, y: spineY - EFFECT_H / 2, width: effectW, height: EFFECT_H, label: ir.effect }
  const spine = { x1: PAD, y1: spineY, x2: spineX2, y2: spineY }
  const width = snapUp4(spineX2 + effectW + PAD)

  const bones = ir.categories.map((c, i) => {
    const top = i % 2 === 0
    const dir = top ? -1 : 1
    const join = firstJoin + Math.floor(i / 2) * spacing
    const tipX = join - run
    const tipY = spineY + dir * rise
    const bw = boxWidths[i]
    const box = { x: tipX - bw / 2, y: top ? tipY - CAT_BOX_H : tipY, width: bw, height: CAT_BOX_H, label: c.label }
    const m = c.causes.length
    const causes = c.causes.map((k, j) => {
      const slot = top ? K - j : K - m + 1 + j
      const bx = join - RUN * slot
      const y = spineY + dir * SLOT * slot
      return {
        index: j, label: k.label, emphasis: k.emphasis, slot,
        tick: { x1: bx - TICK, y1: y, x2: bx, y2: y },
        text: { x: bx - TICK - TICK_GAP, y, width: causeWidth(k), anchor: 'end' },
      }
    })
    return { id: c.id, index: i, side: top ? 'top' : 'bottom', emphasis: c.emphasis, x1: tipX, y1: tipY, x2: join, y2: spineY, box, causes }
  })

  return { width, height, geo: { spineY, spine, effect, bones, spacing, slots: K } }
}

// --- draw ----------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')

  const s = geo.spine
  parts.push(`<line id="${uid}-spine" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="currentColor" stroke-width="1.5" marker-end="url(#${uid}-solid)"/>`)

  for (const b of geo.bones) {
    // the accent is the bone itself (plus its label box), never a cause tick
    const boneStroke = b.emphasis ? 'var(--wu-accent)' : 'currentColor'
    const boneSw = b.emphasis ? 1.5 : 1
    const boxCls = b.emphasis ? ' class="wu-focal"' : ''
    parts.push(`<line id="${uid}-bone-${b.id}" x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="${boneStroke}" stroke-width="${boneSw}" marker-end="url(#${uid}-solid)"/>`)
    const bx = b.box
    parts.push(`<rect id="${uid}-cat-${b.id}"${boxCls} x="${bx.x}" y="${bx.y}" width="${bx.width}" height="${bx.height}" rx="4" fill="var(--wu-surface)" stroke="currentColor" stroke-width="${boneSw}"/>`)
    parts.push(`<text id="${uid}-cat-${b.id}-label" x="${bx.x + bx.width / 2}" y="${bx.y + bx.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" font-weight="700" text-anchor="middle" fill="currentColor">${esc(bx.label)}</text>`)
    for (const k of b.causes) {
      const t = k.tick
      const weight = k.emphasis ? ' font-weight="700"' : ''
      parts.push(`<line id="${uid}-tick-${b.id}-${k.index}" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke="currentColor" stroke-width="1"/>`)
      parts.push(`<text id="${uid}-cause-${b.id}-${k.index}" x="${k.text.x}" y="${k.text.y + EDGE_LABEL_SIZE * 0.35}" font-size="${EDGE_LABEL_SIZE}"${weight} text-anchor="end" fill="currentColor">${esc(k.label)}</text>`)
    }
  }

  const e = geo.effect
  parts.push(`<rect id="${uid}-effect" class="wu-focal" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="6" fill="var(--wu-surface)" stroke="currentColor" stroke-width="1.5"/>`)
  parts.push(`<text id="${uid}-effect-label" x="${e.x + e.width / 2}" y="${e.y + e.height / 2 + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" font-weight="700" text-anchor="middle" fill="currentColor">${esc(e.label)}</text>`)

  return parts.join('')
}

// --- verify --------------------------------------------------------------

/** Closed-interval overlap of two axis-aligned boxes `{ x0, y0, x1, y1 }`. */
const rectsOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Whether segment p→q crosses the interior of box r (Liang–Barsky). */
function segmentHitsRect(p, q, r) {
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  const checks = [[-dx, p.x - r.x0], [dx, r.x1 - p.x], [-dy, p.y - r.y0], [dy, r.y1 - p.y]]
  for (const [pk, qk] of checks) {
    if (pk === 0) { if (qk < 0) return false; continue }
    const t = qk / pk
    if (pk < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t0 < t1
}

const boxRect = (b) => ({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height })
const textRect = (t) => ({ x0: t.x - t.width, y0: t.y - TEXT_HALF_H, x1: t.x, y1: t.y + TEXT_HALF_H })

export function verify(layoutResult, ir) {
  const { geo } = layoutResult
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'category-count', 'budget:categories', `${ir.categories.length} categor${ir.categories.length === 1 ? 'y' : 'ies'}`)
  budgetRow(2, 'causes-per-category', 'budget:causes', `at most ${ir.categories.reduce((m, c) => Math.max(m, c.causes.length), 0)} cause(s) per category`)
  budgetRow(3, 'cause-total', 'budget:total', `${causeCount(ir)} cause(s) in total`)
  budgetRow(4, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  budgetRow(5, 'emphasis-count', 'budget:emphasis', `${emphasisCount(ir)} emphasized bone(s)`)

  // 5. the spine is horizontal and ends exactly at the effect box, which
  //    straddles it and stays inside the canvas
  const { spine, effect, spineY } = geo
  const spineFlat = spine.y1 === spineY && spine.y2 === spineY && spine.x2 > spine.x1
  const endsAtBox = spine.x2 === effect.x && effect.y < spineY && spineY < effect.y + effect.height
  const inside = effect.x + effect.width <= layoutResult.width
  const effectOk = spineFlat && endsAtBox && inside
  rows.push({
    id: 6, name: 'effect-at-spine-end', severity: 'fail', ok: effectOk,
    detail: effectOk ? 'the spine runs horizontally into the effect box at its right end'
      : !spineFlat ? 'the spine is not a horizontal left-to-right line'
        : !endsAtBox ? `the spine ends at x=${spine.x2} but the effect box starts at x=${effect.x} (spine y=${spineY}, box y ${effect.y}–${effect.y + effect.height})`
          : 'the effect box runs past the canvas edge',
    hint: effectOk ? undefined : 'end the spine at the effect box\'s left edge, vertically centered on it, and size the canvas to hold the box',
  })

  // 6. bones alternate above / below the spine in IR order, meet the spine
  //    at their join, and lean back toward the tail at 60° (7:4)
  const bad = []
  geo.bones.forEach((b, i) => {
    const expected = i % 2 === 0 ? 'top' : 'bottom'
    const problems = []
    if (b.id !== ir.categories[i]?.id) problems.push('order differs from ir.categories')
    if (b.side !== expected) problems.push(`side ${b.side}, expected ${expected}`)
    if (b.y2 !== spineY) problems.push('does not meet the spine')
    if (expected === 'top' ? !(b.y1 < spineY) : !(b.y1 > spineY)) problems.push(`tip on the wrong side of the spine`)
    if (!(b.x1 < b.x2) || Math.abs(b.x2 - b.x1) * 7 !== Math.abs(b.y2 - b.y1) * 4) problems.push('not a 60° (7:4) bone leaning toward the tail')
    if (problems.length) bad.push(`${b.id}: ${problems.join(', ')}`)
  })
  const bonesOk = bad.length === 0 && geo.bones.length === ir.categories.length
  rows.push({
    id: 7, name: 'bones-alternate', severity: 'fail', ok: bonesOk,
    detail: bonesOk ? `${geo.bones.length} bone(s) alternate above/below the spine at 60° in IR order`
      : bad.length ? bad.join('; ') : 'bone count differs from ir.categories',
    hint: bonesOk ? undefined : 'hang category 0 above the spine, 1 below, 2 above… each bone from its join on the spine back toward the tail at 60°',
  })

  // 7. no label (cause text, category box, effect box) touches any line
  //    (spine, bone, tick) other than the one that anchors it, nor another
  //    label
  const labels = []
  const lines = [{ name: 'spine', p: { x: spine.x1, y: spine.y1 }, q: { x: spine.x2, y: spine.y2 }, owner: 'effect' }]
  labels.push({ name: 'effect box', rect: boxRect(effect), owner: 'effect' })
  for (const b of geo.bones) {
    lines.push({ name: `bone ${b.id}`, p: { x: b.x1, y: b.y1 }, q: { x: b.x2, y: b.y2 }, owner: `cat:${b.id}` })
    labels.push({ name: `category "${b.box.label}"`, rect: boxRect(b.box), owner: `cat:${b.id}` })
    for (const k of b.causes) {
      const owner = `cause:${b.id}:${k.index}`
      lines.push({ name: `tick ${b.id}/${k.index}`, p: { x: k.tick.x1, y: k.tick.y1 }, q: { x: k.tick.x2, y: k.tick.y2 }, owner })
      labels.push({ name: `cause "${k.label}"`, rect: textRect(k.text), owner })
    }
  }
  const hits = []
  for (const l of labels) {
    for (const ln of lines) {
      if (ln.owner === l.owner) continue
      if (segmentHitsRect(ln.p, ln.q, l.rect)) hits.push(`${l.name} × ${ln.name}`)
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (rectsOverlap(labels[i].rect, labels[j].rect)) hits.push(`${labels[i].name} × ${labels[j].name}`)
    }
  }
  rows.push({
    id: 8, name: 'no-overlap', severity: 'fail', ok: hits.length === 0,
    detail: hits.length ? `overlap(s): ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? `, … (${hits.length})` : ''}` : `${labels.length} label(s) clear of every line and of each other`,
    hint: hits.length ? 'widen the join spacing to the longest cause text plus the tick, or shorten the label' : undefined,
  })

  return rows
}

// --- doc -----------------------------------------------------------------

export const doc = {
  purpose: 'a cause-and-effect (Ishikawa) diagram: one symptom, the categories of causes examined, and which ones were the root',
  whenToUse: 'when a decision record needs to show *why* — which cause categories were investigated for one symptom and which cause the decision acts on (postmortems, "why this change"); not for a chain of events in time (use sequence or a timeline). Write the effect as a symptom, not as the fix. The accent is the root-cause bone (emphasis on a category, or on one of its causes) plus the effect box. Budgets: categories ≤ 6, causes ≤ 3 per bone and ≤ 18 in total, label ≤ 14 chars, emphasis ≤ 1 bone — guidance, over-budget figures still render with data-warn.',
  irExample: `id: p95-regression
type: fishbone
title: p95 悪化の原因分析
caption: 根本原因は接続プールの枯渇。強調した骨が対処対象
effect: デプロイ後に API の p95 が 3 倍に悪化
categories:
  - id: code
    label: コード
    causes:
      - N+1 クエリ
      - label: プール枯渇
        emphasis: true
      - 同期ログ出力
  - id: infra
    label: インフラ
    causes:
      - ノード数の削減
      - プール上限 10
      - DNS キャッシュ切れ
  - id: process
    label: 手順
    causes:
      - 負荷試験の省略
      - カナリア未実施
      - ロールバック手順なし
  - id: data
    label: データ
    causes:
      - テーブル肥大化
      - 索引の欠落
      - 統計情報の古さ
`,
  rows: ['category-count', 'causes-per-category', 'cause-total', 'label-length', 'emphasis-count', 'effect-at-spine-end', 'bones-alternate', 'no-overlap'],
}
