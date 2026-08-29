// `type: venn` — two or three overlapping sets with labelled regions. Says
// "these concerns overlap, and the overlap is the interesting part"
// (responsibility overlap, skill × demand × pay, tool coverage).
//
// IR shape: `{ id, type:'venn', title, caption?, sets, regions }`.
//   sets:    [{ id, label }]                          exactly 2 or 3
//   regions: [{ of: [setId, …], label, emphasis? }]  ≤ 7; `of` names the sets
//            whose intersection (and nothing else) the region is — `[a]` is
//            "only a", `[a, b]` is "a and b but not c". Each combination may
//            appear once; a region naming an unknown set is a schema error.
//
// Geometry is fixed, never derived from set sizes (the survey's rule:
// sizes are not data here — a venn with honest areas is a different
// figure). Two sets sit side by side; three sit on a triangle. Every
// circle is the same light neutral fill (currentColor at 6%) so an
// overlap reads darker simply because two fills stack — no colour, no
// per-set tint. Set labels sit outside the circles (above for two sets;
// above / below-right / below-left for three); region labels sit at the
// region's centroid, sampled on the 4px grid, wrapped onto at most two
// lines. `emphasis` is the kit's usual cue — bold label, accent-stroked
// pill (`rect.wu-focal`) — never a coloured region.
//
// Grid: circle centres, label anchors and the canvas are on the 4px grid
// (shared row `grid-4px`). Label boxes use left/top/right/bottom keys —
// text-fitted sizes are the plugin's rule, not the shared row's.
import { IrError, isObj, requireStr, normalizeHeader, validateBool, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, COLUMN } from '../diagram.mjs'

export const type = 'venn'

export const limits = { maxSets: 3, maxRegions: 7, maxLabelLen: 14, maxEmphasis: 2 }

const MIN_SETS = 2
const R = 120                // circle radius
const TWO_HALF_GAP = 64      // two sets: half the centre distance (lens 112px wide)
const THREE_TOP = { x: 0, y: -72 }        // three sets: centres on a triangle around (0,0)
const THREE_RIGHT = { x: 64, y: 36 }
const THREE_LEFT = { x: -64, y: 36 }
const PAD = 16
const SET_LABEL_GAP = 12     // circle edge → set label baseline / cap
const LINE_H = 16            // region label line height at 13px
const LABEL_CLEAR = 4        // region label box must stay this far inside its region
const FOCAL_PAD = 4          // emphasis pill padding around the label box
const GRID = 4

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const sets = normalizeSets(raw.sets, ctx)
  const regions = normalizeRegions(raw.regions, sets, ctx)
  return { id, type, title, caption, sets, regions }
}

function normalizeSets(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.sets must be a non-empty list`)
  if (raw.length < MIN_SETS || raw.length > limits.maxSets) {
    throw new IrError(`${ctx}.sets needs ${MIN_SETS} or ${limits.maxSets} sets (got: ${raw.length}) — four or more sets do not overlap legibly, use a matrix`)
  }
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.sets[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`duplicate set id: "${id}"`)
    seen.add(id)
    return { id, label: requireStr(s, 'label', sctx) }
  })
}

function normalizeRegions(raw, sets, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.regions must be a non-empty list`)
  const order = new Map(sets.map((s, i) => [s.id, i]))
  const seen = new Set()
  return raw.map((r, i) => {
    const rctx = `${ctx}.regions[${i}]`
    if (!isObj(r)) throw new IrError(`${rctx} must be a mapping`)
    if (!Array.isArray(r.of) || r.of.length === 0) throw new IrError(`${rctx}.of must be a non-empty list of set ids`)
    const of = []
    for (const ref of r.of) {
      if (typeof ref !== 'string' || !order.has(ref)) throw new IrError(`${rctx}.of references unknown set ${JSON.stringify(ref)}`)
      if (of.includes(ref)) throw new IrError(`${rctx}.of names set "${ref}" twice`)
      of.push(ref)
    }
    of.sort((a, b) => order.get(a) - order.get(b))
    const key = of.join('+')
    if (seen.has(key)) throw new IrError(`${rctx} duplicates the region [${of.join(', ')}] — each intersection may be labelled once`)
    seen.add(key)
    return { of, label: requireStr(r, 'label', rctx), emphasis: validateBool(r, 'emphasis', rctx) }
  })
}

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  if (ir.regions.length > limits.maxRegions) {
    out.push(budgetWarning('budget:regions', ir.regions.length, limits.maxRegions,
      `${ir.regions.length} region(s) (guidance ≤ ${limits.maxRegions})`,
      'label only the intersections the reader must find; move the rest into the caption'))
  }
  const long = []
  ir.sets.forEach((s, i) => {
    const len = [...s.label].length
    if (len > limits.maxLabelLen) long.push({ where: `sets[${i}].label`, label: s.label, len })
  })
  ir.regions.forEach((r, i) => {
    const len = [...r.label].length
    if (len > limits.maxLabelLen) long.push({ where: `regions[${i}].label`, label: r.label, len })
  })
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, limits.maxLabelLen,
      long.map((e) => `${e.where} "${e.label}" is ${e.len} chars (guidance ≤ ${limits.maxLabelLen})`).join('; '),
      long.map((e) => `shorten ${e.where} ("${e.label}", ${e.len} > ${limits.maxLabelLen})`).join('; ') + ', or move the wording into the caption'))
  }
  const focal = ir.regions.filter((r) => r.emphasis).length
  if (focal > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', focal, limits.maxEmphasis,
      `${focal} emphasized region(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis for the one intersection the page is about — more than two accents is no emphasis'))
  }
  return out
}

// --- text ------------------------------------------------------------------

/** Split `text` onto at most two lines when wider than `maxW`; balanced
 * cut, a cut at a space wins within SPACE_SLACK px, no line starts with a
 * character Japanese typesetting keeps on the previous line. */
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

/** Cut at the space nearest the middle of the text, or null when there is none. */
function splitAtSpace(text) {
  const chars = [...text]
  let best = null
  chars.forEach((ch, i) => {
    if (ch !== ' ') return
    const head = chars.slice(0, i).join('').trimEnd()
    const tail = chars.slice(i + 1).join('').trimStart()
    if (!head || !tail) return
    const off = Math.abs(i - chars.length / 2)
    if (!best || off < best.off) best = { off, lines: [head, tail] }
  })
  return best ? best.lines : null
}

/** The forms a region label may take, narrowest last: one line; two
 * lines cut at a space (a word boundary reads better than a balanced
 * cut through a word); two balanced lines. Duplicates dropped. */
function labelForms(text) {
  const forms = [[text]]
  const push = (lines) => { if (lines && lines.length === 2 && !forms.some((f) => f.join('\n') === lines.join('\n'))) forms.push(lines) }
  push(splitAtSpace(text))
  push(wrapTwo(text, 0, FONT_SIZE))
  return forms
}

// --- geometry --------------------------------------------------------------

const inside = (c, x, y) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r
/** Bitmask of the circles containing (x, y). */
const signatureAt = (circles, x, y) => circles.reduce((m, c, i) => (inside(c, x, y) ? m | (1 << i) : m), 0)
/** Signed clearance of (x, y) from the boundary of the region `mask`:
 * min distance to any circle edge (positive when the point's membership
 * already matches `mask`, else 0). */
function clearanceAt(circles, mask, x, y) {
  if (signatureAt(circles, x, y) !== mask) return 0
  let best = Infinity
  circles.forEach((c) => {
    const d = Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)
    if (d < best) best = d
  })
  return best
}
/** The nine points a label box is tested at: corners, edge midpoints,
 * centre. Corners alone miss a crescent's inner arc bulging into the box. */
function boxSamples(box) {
  const mx = (box.left + box.right) / 2
  const my = (box.top + box.bottom) / 2
  return [
    [box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom],
    [mx, box.top], [mx, box.bottom], [box.left, my], [box.right, my], [mx, my],
  ]
}
function boxFits(circles, mask, box, clear = 0) {
  return boxSamples(box).every(([x, y]) => clearanceAt(circles, mask, x, y) >= clear && signatureAt(circles, x, y) === mask)
}
const overlaps = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)

/** Sample every 4px grid point inside the circles' bounding box, grouped
 * by membership signature: centroid (mean) and the deepest point (max
 * clearance) per signature. Deterministic: fixed scan order, strict >. */
function sampleRegions(circles) {
  const minX = Math.min(...circles.map((c) => c.cx - c.r))
  const maxX = Math.max(...circles.map((c) => c.cx + c.r))
  const minY = Math.min(...circles.map((c) => c.cy - c.r))
  const maxY = Math.max(...circles.map((c) => c.cy + c.r))
  const acc = new Map()
  for (let y = Math.ceil(minY / GRID) * GRID; y <= maxY; y += GRID) {
    for (let x = Math.ceil(minX / GRID) * GRID; x <= maxX; x += GRID) {
      const sig = signatureAt(circles, x, y)
      if (!sig) continue
      let a = acc.get(sig)
      if (!a) { a = { n: 0, sx: 0, sy: 0, deep: null, deepest: -1 }; acc.set(sig, a) }
      a.n++; a.sx += x; a.sy += y
      const clear = clearanceAt(circles, sig, x, y)
      if (clear > a.deepest) { a.deepest = clear; a.deep = { x, y } }
    }
  }
  const out = new Map()
  for (const [sig, a] of acc) out.set(sig, { centroid: { x: snap4(a.sx / a.n), y: snap4(a.sy / a.n) }, deepest: a.deep })
  return out
}

function regionMask(ir, of) {
  return of.reduce((m, id) => m | (1 << ir.sets.findIndex((s) => s.id === id)), 0)
}

/** Label lines + box for a region label centred on (x, y). */
function regionLabelBox(lines, x, y, bold) {
  const width = Math.ceil(Math.max(...lines.map((l) => textWidth(l, FONT_SIZE))) * (bold ? 1.08 : 1))
  const height = lines.length * LINE_H
  return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 }
}

function setLabelPlacement(set, circle, place) {
  const width = Math.ceil(textWidth(set.label, FONT_SIZE))
  let x, y, anchor
  if (place === 'above-middle') { x = circle.cx; y = snap4(circle.cy - circle.r - SET_LABEL_GAP); anchor = 'middle' }
  else if (place === 'above-left') { x = circle.cx; y = snap4(circle.cy - circle.r - SET_LABEL_GAP); anchor = 'end' }
  else if (place === 'above-right') { x = circle.cx; y = snap4(circle.cy - circle.r - SET_LABEL_GAP); anchor = 'start' }
  else if (place === 'below-right') { x = circle.cx; y = snap4(circle.cy + circle.r + SET_LABEL_GAP + 13); anchor = 'start' }
  else { x = circle.cx; y = snap4(circle.cy + circle.r + SET_LABEL_GAP + 13); anchor = 'end' }
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  return { id: set.id, text: set.label, x, y, anchor, place, box: { left, top: y - 13, right: left + width, bottom: y + 3 } }
}

export async function layout(ir, { column = COLUMN } = {}) {
  // Local frame: circles around (0, 0); translated onto the canvas by an
  // on-grid offset at the end, so every sampled point stays on the grid.
  const local = ir.sets.length === 2
    ? [{ cx: -TWO_HALF_GAP, cy: 0, r: R }, { cx: TWO_HALF_GAP, cy: 0, r: R }]
    : [{ cx: THREE_TOP.x, cy: THREE_TOP.y, r: R }, { cx: THREE_RIGHT.x, cy: THREE_RIGHT.y, r: R }, { cx: THREE_LEFT.x, cy: THREE_LEFT.y, r: R }]
  const places = ir.sets.length === 2 ? ['above-left', 'above-right'] : ['above-middle', 'below-right', 'below-left']
  const setLabels = ir.sets.map((s, i) => setLabelPlacement(s, local[i], places[i]))

  const samples = sampleRegions(local)
  const regionLabels = ir.regions.map((reg) => {
    const mask = regionMask(ir, reg.of)
    const s = samples.get(mask)
    // Candidates in order: every label form (one line, then two) at the
    // region's centroid — a pairwise sliver of a 3-set is too narrow for
    // one line — then the same forms at the deepest point of the region,
    // the spot with the most room around it. The first that fits with
    // LABEL_CLEAR to spare wins; when none fits the last candidate is
    // kept and the verify row reports it.
    const forms = labelForms(reg.label)
    const spots = s ? [s.centroid, s.deepest] : [{ x: 0, y: 0 }]
    let chosen = null
    outer: for (const at of spots) {
      for (const lines of forms) {
        const box = regionLabelBox(lines, at.x, at.y, reg.emphasis)
        chosen = { at, lines, box }
        if (boxFits(local, mask, box, LABEL_CLEAR)) break outer
      }
    }
    const { at, lines, box } = chosen
    return { key: reg.of.join('+'), of: reg.of, mask, text: reg.label, lines, emphasis: reg.emphasis, x: at.x, y: at.y, box }
  })

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const extend = (b) => { minX = Math.min(minX, b.left); maxX = Math.max(maxX, b.right); minY = Math.min(minY, b.top); maxY = Math.max(maxY, b.bottom) }
  for (const c of local) extend({ left: c.cx - c.r, right: c.cx + c.r, top: c.cy - c.r, bottom: c.cy + c.r })
  for (const l of setLabels) extend(l.box)
  for (const l of regionLabels) extend(l.emphasis ? padBox(l.box, FOCAL_PAD) : l.box)
  const ox = snapUp4(-minX + PAD)
  const oy = snapUp4(-minY + PAD)
  const width = snapUp4(ox + maxX + PAD)
  const height = snapUp4(oy + maxY + PAD)
  const shiftBox = (b) => ({ left: b.left + ox, top: b.top + oy, right: b.right + ox, bottom: b.bottom + oy })

  const circles = local.map((c, i) => ({ id: ir.sets[i].id, cx: c.cx + ox, cy: c.cy + oy, r: c.r }))
  const sets = setLabels.map((l) => ({ ...l, x: l.x + ox, y: l.y + oy, box: shiftBox(l.box) }))
  const regions = regionLabels.map((l) => ({ ...l, x: l.x + ox, y: l.y + oy, box: shiftBox(l.box) }))
  return { width, height, geo: { circles, sets, regions } }
}

const padBox = (b, p) => ({ left: b.left - p, top: b.top - p, right: b.right + p, bottom: b.bottom + p })

// --- draw ------------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { circles, sets, regions } = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const parts = []
  // Same fill on every circle: an overlap is darker only because two (or
  // three) translucent fills stack — the reader needs no legend.
  parts.push(`<g id="${uid}-sets" fill="currentColor" fill-opacity="0.06" stroke="var(--wu-ink-3)" stroke-width="1">`)
  for (const c of circles) parts.push(`<circle id="${uid}-set-${c.id}" cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`)
  parts.push('</g>')
  parts.push(`<g id="${uid}-set-labels" font-size="${FONT_SIZE}" fill="currentColor">`)
  for (const l of sets) parts.push(`<text id="${uid}-set-${l.id}-label" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${esc(l.text)}</text>`)
  parts.push('</g>')
  for (const l of regions) {
    if (!l.emphasis) continue
    const b = padBox(l.box, FOCAL_PAD)
    parts.push(`<rect id="${uid}-region-${l.key}-focal" class="wu-focal" x="${b.left}" y="${b.top}" width="${b.right - b.left}" height="${b.bottom - b.top}" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>`)
  }
  parts.push(`<g id="${uid}-region-labels" font-size="${FONT_SIZE}" fill="currentColor" text-anchor="middle">`)
  for (const l of regions) {
    const weight = l.emphasis ? ' font-weight="700"' : ''
    const n = l.lines.length
    // Baselines: one line sits 4px below centre; two lines straddle it.
    const first = l.y - ((n - 1) * LINE_H) / 2 + 4
    const spans = l.lines.map((t, i) => `<tspan x="${l.x}" y="${first + i * LINE_H}">${esc(t)}</tspan>`).join('')
    parts.push(`<text id="${uid}-region-${l.key}-label" x="${l.x}" y="${first}"${weight}>${spans}</text>`)
  }
  parts.push('</g>')
  return parts.join('')
}

// --- verify ----------------------------------------------------------------

export function verify(layoutResult, ir) {
  const { circles, sets, regions } = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  warnRow(1, 'region-count', 'budget:regions', `${ir.regions.length} region(s)`)
  warnRow(2, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`)
  warnRow(3, 'emphasis-count', 'budget:emphasis', `${ir.regions.filter((r) => r.emphasis).length} emphasized region(s)`)

  // #4 regions reference known sets, each combination once
  const known = new Set(ir.sets.map((s) => s.id))
  const seen = new Set()
  const refProblems = []
  ir.regions.forEach((r, i) => {
    const bad = r.of.filter((id) => !known.has(id))
    if (bad.length) refProblems.push(`regions[${i}] references unknown set(s) ${bad.map((b) => `"${b}"`).join(', ')}`)
    const key = [...r.of].sort().join('+')
    if (seen.has(key)) refProblems.push(`regions[${i}] duplicates [${r.of.join(', ')}]`)
    seen.add(key)
  })
  rows.push({
    id: 4, name: 'regions-valid', severity: 'fail', ok: refProblems.length === 0,
    detail: refProblems.length ? refProblems.join('; ') : 'every region names known sets and each intersection is labelled once',
    hint: refProblems.length ? 'fix regions[].of: only set ids, each combination at most once' : undefined,
  })

  // #5 every region label sits inside its own region
  const insideProblems = []
  for (const l of regions) {
    const mask = regionMask(ir, l.of)
    const out = boxSamples(l.box).filter(([x, y]) => signatureAt(circles, x, y) !== mask)
    if (out.length) insideProblems.push(`"${l.text}" leaves region [${l.of.join(', ')}] at ${out.length} of 9 sample points`)
  }
  rows.push({
    id: 5, name: 'region-labels-inside', severity: 'fail', ok: insideProblems.length === 0,
    detail: insideProblems.length ? insideProblems.join('; ') : 'every region label box lies inside the region it names',
    hint: insideProblems.length ? `shorten the region label (≤ ${limits.maxLabelLen} chars, or let it wrap) so it fits the intersection` : undefined,
  })

  // #6 set labels outside every circle
  const outsideProblems = []
  for (const l of sets) {
    const hit = boxSamples(l.box).filter(([x, y]) => signatureAt(circles, x, y) !== 0)
    if (hit.length) outsideProblems.push(`"${l.text}" enters a circle at ${hit.length} of 9 sample points`)
  }
  rows.push({
    id: 6, name: 'set-labels-outside', severity: 'fail', ok: outsideProblems.length === 0,
    detail: outsideProblems.length ? outsideProblems.join('; ') : 'every set label sits outside all circles',
    hint: outsideProblems.length ? 'set labels belong outside the circles — the layout places them above/below; do not move them inward' : undefined,
  })

  // #7 no label box overlaps another
  const boxes = [
    ...sets.map((l) => ({ name: `set "${l.text}"`, box: l.box })),
    ...regions.map((l) => ({ name: `region "${l.text}"`, box: l.emphasis ? padBox(l.box, FOCAL_PAD) : l.box })),
  ]
  const overlapProblems = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i].box, boxes[j].box)) overlapProblems.push(`${boxes[i].name} overlaps ${boxes[j].name}`)
    }
  }
  rows.push({
    id: 7, name: 'labels-no-overlap', severity: 'fail', ok: overlapProblems.length === 0,
    detail: overlapProblems.length ? overlapProblems.slice(0, 6).join('; ') : 'no label box overlaps another',
    hint: overlapProblems.length ? 'shorten the colliding labels or drop one of the regions' : undefined,
  })
  return rows
}

// --- doc -------------------------------------------------------------------

export const doc = {
  purpose: 'two or three overlapping concerns and what sits in each overlap (responsibility overlap, skill × demand × pay)',
  whenToUse: 'when the *overlap* of 2–3 sets is the message and each intersection has a name; not for four or more sets (use a matrix) or for honest set sizes (areas here are fixed, not data). Budgets: regions ≤ 7, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn.',
  irExample: `id: career-fit
type: venn
title: 何を仕事にするか
caption: 三つが重なる領域を狙う
sets:
  - id: can
    label: できる
  - id: wanted
    label: 求められる
  - id: paid
    label: 稼げる
regions:
  - of: [can, wanted]
    label: 頼られる仕事
  - of: [wanted, paid]
    label: 市場がある
  - of: [can, paid]
    label: 専門性
  - of: [can, wanted, paid]
    label: 狙う領域
    emphasis: true
`,
  rows: ['region-count', 'label-length', 'emphasis-count', 'regions-valid', 'region-labels-inside', 'set-labels-outside', 'labels-no-overlap'],
}
