// `type: sankey` — quantities flowing between stages: every node is a thin
// vertical bar (12px) in its stage's column, its height proportional to the
// flow it carries; every link is a ribbon between a slice of the source bar
// and a slice of the target bar whose thickness *is* the value. Ribbons are
// the design survey's documented exemption (#30) from the orthogonal-edge
// rule: they are cubic curves with no arrowhead — direction is left → right
// by construction (a link may only join a stage to a later one).
//
// IR shape: `{ id, type:'sankey', title, caption?, unit?, nodes, links }`
//   nodes: [{ id, label, stage, emphasis? }]   stage: integer ≥ 0, columns
//          are the distinct stages in ascending order; nodes stack in IR
//          order inside a column
//   links: [{ from, to, value, label? }]        from.stage < to.stage, value > 0
//   unit:  appended to every value label ("件", "GB")
//
// Chart rules encoded here (the survey's verify-sankey contract): ribbon
// thickness = value × one shared scale (every ribbon carries `data-value`
// so verify() reads the number back off the svg and compares it with the
// drawn slice within 1px); a node's bar is max(in, out) tall and a node
// whose inflow and outflow differ is disclosed in a 「差分: …」 footnote —
// conservation is never faked by stretching a ribbon; a ribbon thinner
// than 14px cannot carry its value label, so the value moves to a
// 「細い流れ: …」 footnote instead of being dropped. Emphasis is a node
// property: the bar gets the accent stroke, its label goes bold, and every
// ribbon touching it is drawn darker with an accent outline — the reader's
// eye follows one node's flow, never a rainbow.
//
// Grid: bar x/y, label anchors, ribbon end x and footnote lines sit on the
// 4px grid (shared row `grid-4px`). Bar heights and ribbon slice offsets
// are unsnapped — they are the data.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, BOLD_FACTOR, COLUMN } from '../diagram.mjs'

export const type = 'sankey'

export const limits = { maxNodes: 12, maxLinks: 16, maxLabelLen: 12, maxEmphasis: 2 }

// --- layout constants (px) ------------------------------------------------

const PAD = 16
const NODE_W = 12           // bar width (survey: 縦バーノード幅 12)
const NODE_GAP = 12         // minimum gap between stacked bars
const LABEL_GAP = 8         // bar ↔ node label
const LABEL_STEP = 20       // minimum distance between neighbouring node-label baselines
const MAX_COL_H = 400       // the tallest column reaches this (bars + gaps)
const MIN_COL_GAP = 160     // bar-left to bar-left of the next column
const VALUE_MIN_H = 14      // a ribbon at least this tall carries its value label
const VALUE_T = [0.5, 0.3, 0.7, 0.2, 0.8]  // label spots along a ribbon, tried in order
const LABEL_CLEAR = 8       // clearance between any two labels
const FOOT_LINE = 16
const RIBBON_OPACITY = 0.12
const RIBBON_OPACITY_EMPH = 0.24
const NODE_OPACITY = 0.85
const DIFF_PREFIX = '差分: '
const THIN_PREFIX = '細い流れ: '

// --- schema ---------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const out = { id, type, title, caption }
  const unit = optStr(raw, 'unit', ctx)
  if (unit !== undefined) out.unit = unit
  out.nodes = normalizeNodes(raw.nodes, ctx)
  out.links = normalizeLinks(raw.links, out.nodes, ctx)
  return out
}

function normalizeNodes(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.nodes must be a non-empty list`)
  const seen = new Set()
  const nodes = raw.map((n, i) => {
    const nctx = `${ctx}.nodes[${i}]`
    if (!isObj(n)) throw new IrError(`${nctx} must be a mapping`)
    const id = requireStr(n, 'id', nctx)
    if (seen.has(id)) throw new IrError(`duplicate node id: "${id}"`)
    seen.add(id)
    const stage = n.stage
    if (!Number.isInteger(stage) || stage < 0) throw new IrError(`${nctx}.stage must be a non-negative integer (got: ${JSON.stringify(stage)})`)
    return { id, label: requireStr(n, 'label', nctx), stage, emphasis: validateBool(n, 'emphasis', nctx) }
  })
  if (new Set(nodes.map((n) => n.stage)).size < 2) throw new IrError(`${ctx}.nodes needs at least 2 distinct stages (a single stage has nothing to flow to)`)
  return nodes
}

function normalizeLinks(raw, nodes, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.links must be a non-empty list`)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return raw.map((l, i) => {
    const lctx = `${ctx}.links[${i}]`
    if (!isObj(l)) throw new IrError(`${lctx} must be a mapping`)
    const from = requireStr(l, 'from', lctx)
    const to = requireStr(l, 'to', lctx)
    if (!byId.has(from)) throw new IrError(`${lctx}.from references unknown node "${from}"`)
    if (!byId.has(to)) throw new IrError(`${lctx}.to references unknown node "${to}"`)
    if (byId.get(from).stage >= byId.get(to).stage) {
      throw new IrError(`${lctx}: "${from}" (stage ${byId.get(from).stage}) must flow to a later stage than "${to}" (stage ${byId.get(to).stage})`)
    }
    const value = l.value
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new IrError(`${lctx}.value must be a positive finite number (got: ${JSON.stringify(value)})`)
    const rec = { from, to, value }
    const label = optStr(l, 'label', lctx)
    if (label !== undefined) rec.label = label
    return rec
  })
}

// --- budgets --------------------------------------------------------------

const labelsOf = (ir) => [...ir.nodes.map((n) => n.label), ...ir.links.map((l) => l.label).filter(Boolean)]
const longestLabel = (ir) => labelsOf(ir).reduce((m, l) => (l.length > m.length ? l : m), '')
const emphasized = (ir) => ir.nodes.filter((n) => n.emphasis)

export function budgetWarnings(ir) {
  const out = []
  if (ir.nodes.length > limits.maxNodes) {
    out.push(budgetWarning('budget:nodes', ir.nodes.length, limits.maxNodes,
      `${ir.nodes.length} node(s) (guidance ≤ ${limits.maxNodes})`,
      'merge the smallest nodes of a stage into an "その他" node, or drop a stage'))
  }
  if (ir.links.length > limits.maxLinks) {
    out.push(budgetWarning('budget:links', ir.links.length, limits.maxLinks,
      `${ir.links.length} link(s) (guidance ≤ ${limits.maxLinks})`,
      'fold the thinnest links into one "その他" flow per source, or split the figure at a stage'))
  }
  const longest = longestLabel(ir)
  if (longest.length > limits.maxLabelLen) {
    out.push(budgetWarning('budget:label', longest.length, limits.maxLabelLen,
      `label "${longest}" is ${longest.length} chars (guidance ≤ ${limits.maxLabelLen})`,
      'shorten the label and put the long form in the caption'))
  }
  const emph = emphasized(ir).length
  if (emph > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emph, limits.maxEmphasis,
      `${emph} emphasized node(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the one or two nodes whose flow the decision is about'))
  }
  return out
}

// --- layout ---------------------------------------------------------------

const round2 = (v) => Math.round(v * 100) / 100
const snapDown4 = (v) => Math.floor(v / 4) * 4
/** Value text: integers as-is, otherwise ≤ 2 decimals, unit appended. */
const fmt = (v, unit) => `${Number.isInteger(v) ? v : round2(v)}${unit ?? ''}`
/** Ribbon label: the link's own label (if any) followed by its value. */
const valueText = (l, unit) => (l.label ? `${l.label} ${fmt(l.value, unit)}` : fmt(l.value, unit))
const textBox = (x, y, w, size, anchor = 'start') => {
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
  return { left, right: left + w, top: y - size, bottom: y + size * 0.25 }
}
const overlaps = (a, b) => a.left < b.right + LABEL_CLEAR && b.left < a.right + LABEL_CLEAR && a.top < b.bottom && b.top < a.bottom

/** Per-node flow totals from the IR. */
function flowTotals(ir) {
  const totals = new Map(ir.nodes.map((n) => [n.id, { in: 0, out: 0 }]))
  for (const l of ir.links) {
    totals.get(l.from).out += l.value
    totals.get(l.to).in += l.value
  }
  for (const t of totals.values()) { t.in = round2(t.in); t.out = round2(t.out); t.basis = Math.max(t.in, t.out) }
  return totals
}

/** Nodes whose inflow and outflow both exist and differ — the 差分 footnote lists them. */
function unbalanced(ir) {
  const totals = flowTotals(ir)
  return ir.nodes.filter((n) => { const t = totals.get(n.id); return t.in > 0 && t.out > 0 && t.in !== t.out })
    .map((n) => ({ id: n.id, label: n.label, in: totals.get(n.id).in, out: totals.get(n.id).out }))
}

/**
 * Deterministic: stages → columns spread across the column width, bars
 * stacked in IR order with ≥ 12px gaps at one shared px-per-unit scale (the
 * tallest column reaches 400px), ribbons as slices ordered to avoid
 * crossings between the same pair of nodes, value labels placed greedily
 * (a label that would overlap one already placed moves to the footnote).
 */
export async function layout(ir, { column = COLUMN } = {}) {
  let result = layoutAt(ir, column)
  const need = footnoteWidth(result.geo)
  if (need > result.width) result = layoutAt(ir, Math.max(column, need))
  return result
}

function footnoteWidth(geo) {
  return geo.footnotes.reduce((m, f) => Math.max(m, snapUp4(PAD * 2 + Math.ceil(textWidth(f.text, EDGE_LABEL_SIZE)))), 0)
}

function layoutAt(ir, targetWidth) {
  const totals = flowTotals(ir)
  const stages = [...new Set(ir.nodes.map((n) => n.stage))].sort((a, b) => a - b)
  const colOf = new Map(stages.map((s, i) => [s, i]))
  const n = stages.length
  const columns = stages.map(() => [])
  ir.nodes.forEach((node, i) => columns[colOf.get(node.stage)].push({ ...node, index: i, col: colOf.get(node.stage), ...totals.get(node.id) }))

  // one scale: the column with the most flow per available px decides
  let scale = Infinity
  for (const col of columns) {
    const sum = col.reduce((s, nd) => s + nd.basis, 0)
    // each gap may grow by < 4px when the next bar snaps up to the grid
    if (sum > 0) scale = Math.min(scale, (MAX_COL_H - (NODE_GAP + 4) * (col.length - 1)) / sum)
  }
  scale = Math.floor(scale * 100) / 100

  // node label widths (label 13px, total 11px muted)
  const labelW = (nd) => {
    const w = Math.ceil(textWidth(nd.label) * (nd.emphasis ? BOLD_FACTOR : 1))
    return w + 4 + Math.ceil(textWidth(fmt(nd.basis, ir.unit), EDGE_LABEL_SIZE))
  }
  const colLabelW = columns.map((col) => col.reduce((m, nd) => Math.max(m, labelW(nd)), 0))
  const valueW = ir.links.reduce((m, l) => Math.max(m, Math.ceil(textWidth(valueText(l, ir.unit), EDGE_LABEL_SIZE))), 0)

  // column pitches: between columns i and i+1 the right-side labels of
  // column i, the value label of a ribbon, and — before the last column —
  // its left-side labels must all fit; spare width is shared out evenly
  const needed = []
  for (let i = 0; i < n - 1; i++) {
    const rightLabel = i + 1 === n - 1 ? colLabelW[n - 1] + LABEL_GAP : 0
    needed.push(Math.max(MIN_COL_GAP, NODE_W + LABEL_GAP + colLabelW[i] + 12 + valueW + 12 + rightLabel))
  }
  const spare = Math.max(0, targetWidth - PAD * 2 - NODE_W - needed.reduce((a, b) => a + b, 0)) / (n - 1)
  const pitches = needed.map((p) => Math.max(snapUp4(p), snapDown4(p + spare)))
  const xs = [PAD]
  for (const p of pitches) xs.push(xs[xs.length - 1] + p)
  const width = snapUp4(xs[n - 1] + NODE_W + PAD)

  // stack bars from 0, then centre every column on the tallest
  const heights = []
  for (const col of columns) {
    let cursor = 0
    let prevH = 0
    col.forEach((nd, j) => {
      const h = round2(nd.basis * scale)
      if (j > 0) cursor += Math.max(NODE_GAP, LABEL_STEP - (prevH + h) / 2)
      nd.y = snapUp4(cursor)
      nd.height = h
      cursor = nd.y + h
      prevH = h
    })
    heights.push(cursor)
  }
  const maxH = Math.max(...heights)
  const nodes = []
  columns.forEach((col, i) => {
    const offset = snap4(PAD + (maxH - heights[i]) / 2)
    for (const nd of col) {
      nd.x = xs[i]
      nd.y += offset
      nd.width = NODE_W
      nodes.push(nd)
    }
  })
  const byId = new Map(nodes.map((nd) => [nd.id, nd]))
  const rank = (id) => { const nd = byId.get(id); return nd.col * 1000 + nd.index }

  // ribbon slices: out-slices ordered by target position, in-slices by source
  const outCursor = new Map(nodes.map((nd) => [nd.id, nd.y]))
  const inCursor = new Map(nodes.map((nd) => [nd.id, nd.y]))
  const linkRecs = ir.links.map((l, index) => ({ ...l, index, thickness: round2(l.value * scale) }))
  for (const l of [...linkRecs].sort((a, b) => rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to) || a.index - b.index)) {
    l.fromTop = round2(outCursor.get(l.from))
    outCursor.set(l.from, l.fromTop + l.thickness)
  }
  for (const l of [...linkRecs].sort((a, b) => rank(a.to) - rank(b.to) || rank(a.from) - rank(b.from) || a.index - b.index)) {
    l.toTop = round2(inCursor.get(l.to))
    inCursor.set(l.to, l.toTop + l.thickness)
  }
  const ribbons = linkRecs.map((l) => {
    const from = byId.get(l.from)
    const to = byId.get(l.to)
    const rec = {
      index: l.index, from: l.from, to: l.to, value: l.value, thickness: l.thickness,
      x1: from.x + NODE_W, x2: to.x, fromTop: l.fromTop, toTop: l.toTop,
      emphasis: from.emphasis || to.emphasis,
    }
    if (l.label) rec.label = l.label
    return rec
  })

  // labels: node labels first (fixed), then ribbon values greedily
  const labels = []
  for (const nd of nodes) {
    const last = nd.col === n - 1
    const x = last ? nd.x - LABEL_GAP : nd.x + NODE_W + LABEL_GAP
    const y = snap4(nd.y + nd.height / 2 + FONT_SIZE * 0.35)
    const w = labelW(nd)
    const anchor = last ? 'end' : 'start'
    nd.label_ = { x, y, anchor, width: w, total: fmt(nd.basis, ir.unit) }
    labels.push({ id: `node-${nd.id}`, kind: 'node', x, y, anchor, width: w, box: textBox(x, y, w, FONT_SIZE, anchor) })
  }
  const thin = []
  for (const r of ribbons) {
    const text = valueText(r, ir.unit)
    const w = Math.ceil(textWidth(text, EDGE_LABEL_SIZE))
    const spot = r.thickness < VALUE_MIN_H ? undefined : valueSpot(r, w, labels)
    if (!spot) { thin.push({ ribbon: r, text }); continue }
    r.valueLabel = { text, ...spot }
    labels.push({ id: `value-${r.index}`, kind: 'value', x: spot.x, y: spot.y, anchor: 'middle', width: w, box: spot.box })
  }

  // footnotes: thin/displaced flows, then in ≠ out disclosures
  const footTexts = []
  if (thin.length) footTexts.push(`${THIN_PREFIX}${thin.map((t) => `${byId.get(t.ribbon.from).label}→${byId.get(t.ribbon.to).label} ${t.text}`).join('、')}`)
  const diff = unbalanced(ir)
  if (diff.length) footTexts.push(`${DIFF_PREFIX}${diff.map((d) => `${d.label} 入 ${fmt(d.in, ir.unit)} / 出 ${fmt(d.out, ir.unit)}`).join('、')}`)
  const colBottom = snapUp4(PAD + maxH)
  const footnotes = footTexts.map((text, k) => {
    const y = colBottom + PAD + 12 + k * FOOT_LINE
    const w = Math.ceil(textWidth(text, EDGE_LABEL_SIZE))
    labels.push({ id: `foot-${k}`, kind: 'footnote', x: PAD, y, anchor: 'start', width: w, box: textBox(PAD, y, w, EDGE_LABEL_SIZE) })
    return { text, x: PAD, y }
  })
  const height = snapUp4(footnotes.length ? footnotes[footnotes.length - 1].y + PAD : colBottom + PAD)

  const geo = { scale, unit: ir.unit, stages, nodes, ribbons, labels, footnotes, pitches, colBottom }
  return { width, height, geo }
}

/**
 * Where a ribbon's value label goes: on the ribbon's centreline, at the
 * midpoint first, then nearer either end (parameter t of the cubic — x
 * follows 1.5t(1−t)+t³, y follows 3t²−2t³), the first spot that overlaps
 * no label placed so far. Undefined when none fits (→ footnote).
 */
function valueSpot(r, w, placed) {
  const fromMid = r.fromTop + r.thickness / 2
  const toMid = r.toTop + r.thickness / 2
  for (const t of VALUE_T) {
    const ux = 1.5 * t * (1 - t) + t ** 3
    const uy = 3 * t * t - 2 * t ** 3
    const x = snap4(r.x1 + (r.x2 - r.x1) * ux)
    const y = snap4(fromMid + (toMid - fromMid) * uy + EDGE_LABEL_SIZE * 0.35)
    const box = textBox(x, y, w, EDGE_LABEL_SIZE, 'middle')
    if (!placed.some((l) => overlaps(l.box, box))) return { x, y, width: w, box }
  }
  return undefined
}

// --- draw -----------------------------------------------------------------

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []

  for (const r of geo.ribbons) {
    const mx = round2((r.x1 + r.x2) / 2)
    const y0 = r.fromTop
    const y1 = r.toTop
    const y0b = round2(y0 + r.thickness)
    const y1b = round2(y1 + r.thickness)
    const d = `M${r.x1} ${y0} C${mx} ${y0} ${mx} ${y1} ${r.x2} ${y1} L${r.x2} ${y1b} C${mx} ${y1b} ${mx} ${y0b} ${r.x1} ${y0b} Z`
    const paint = r.emphasis
      ? `fill="currentColor" fill-opacity="${RIBBON_OPACITY_EMPH}" stroke="var(--wu-accent)" stroke-width="1"`
      : `fill="currentColor" fill-opacity="${RIBBON_OPACITY}" stroke="none"`
    parts.push(`<path id="${uid}-r-${r.index}" data-value="${r.value}" data-from="${esc(r.from)}" data-to="${esc(r.to)}" d="${d}" ${paint}/>`)
  }

  for (const nd of geo.nodes) {
    const cls = nd.emphasis ? ' class="wu-focal"' : ''
    const stroke = nd.emphasis ? ' stroke="var(--wu-accent)" stroke-width="1.5"' : ' stroke="none"'
    parts.push(`<rect id="${uid}-n-${nd.id}"${cls} data-total="${nd.basis}" x="${nd.x}" y="${nd.y}" width="${nd.width}" height="${nd.height}" fill="currentColor" fill-opacity="${NODE_OPACITY}"${stroke}/>`)
    const l = nd.label_
    const weight = nd.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-n-${nd.id}-label" x="${l.x}" y="${l.y}" font-size="${FONT_SIZE}" text-anchor="${l.anchor}"${weight} fill="currentColor">${esc(nd.label)} <tspan font-size="${EDGE_LABEL_SIZE}" font-weight="400" fill="var(--wu-ink-3)">${esc(l.total)}</tspan></text>`)
  }

  for (const r of geo.ribbons) {
    if (!r.valueLabel) continue
    parts.push(`<text id="${uid}-r-${r.index}-value" x="${r.valueLabel.x}" y="${r.valueLabel.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="middle" fill="currentColor">${esc(r.valueLabel.text)}</text>`)
  }

  geo.footnotes.forEach((f, k) => {
    parts.push(`<text id="${uid}-foot-${k}" x="${f.x}" y="${f.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(f.text)}</text>`)
  })

  return parts.join('')
}

// --- verify ---------------------------------------------------------------

export function verify(layoutResult, ir, { svg } = {}) {
  const g = layoutResult.geo
  const uid = `wu-d-${ir.id}`
  const rows = []
  const budget = budgetWarnings(ir)
  const warnRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    const row = { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint }
    if (w) { row.key = w.key; row.value = w.value }
    rows.push(row)
  }
  warnRow(1, 'node-count', 'budget:nodes', `${ir.nodes.length} node(s)`)
  warnRow(2, 'link-count', 'budget:links', `${ir.links.length} link(s)`)
  warnRow(3, 'label-length', 'budget:label', `longest label ${longestLabel(ir).length} chars`)
  warnRow(4, 'emphasis-count', 'budget:emphasis', `${emphasized(ir).length} emphasized node(s)`)

  // #5 every ribbon joins two known nodes and runs to a later column
  const byId = new Map(g.nodes.map((nd) => [nd.id, nd]))
  const badLinks = []
  for (const r of g.ribbons) {
    const from = byId.get(r.from)
    const to = byId.get(r.to)
    if (!from || !to) { badLinks.push(`${r.from}→${r.to} references an unknown node`); continue }
    if (!(from.col < to.col)) badLinks.push(`${r.from}→${r.to} does not move to a later stage`)
    else if (!(r.x2 > r.x1)) badLinks.push(`${r.from}→${r.to} is drawn right → left`)
  }
  if (g.ribbons.length !== ir.links.length) badLinks.push(`${g.ribbons.length} ribbon(s) for ${ir.links.length} link(s)`)
  rows.push({
    id: 5, name: 'links-forward', severity: 'fail', ok: badLinks.length === 0,
    detail: badLinks.length ? badLinks.slice(0, 6).join('; ') : `every ribbon joins two known nodes and flows left → right (${g.ribbons.length} checked)`,
    hint: badLinks.length ? 'a link may only join a node to one in a later stage — reorder the stages or drop the backward link' : undefined,
  })

  // #6 ribbon thickness = value × scale, in the geometry and in the svg
  const prop = []
  for (const r of g.ribbons) {
    if (Math.abs(r.thickness - r.value * g.scale) > 1) prop.push(`ribbon ${r.from}→${r.to}: ${r.thickness}px ≠ ${r.value} × ${g.scale}`)
  }
  for (const nd of g.nodes) {
    if (Math.abs(nd.height - nd.basis * g.scale) > 1) prop.push(`node ${nd.id}: ${nd.height}px ≠ ${nd.basis} × ${g.scale}`)
  }
  if (svg !== undefined) {
    let seen = 0
    for (const m of svg.matchAll(/<path id="([^"]+)" data-value="([^"]+)"[^>]*\sd="M[\d.-]+ ([\d.-]+) C[^"]* ([\d.-]+) Z"/g)) {
      seen++
      const v = parseFloat(m[2])
      const drawn = parseFloat(m[4]) - parseFloat(m[3])
      if (Math.abs(drawn - v * g.scale) > 1) prop.push(`svg ${m[1]}: ${round2(drawn)}px for value ${v} (expected ${round2(v * g.scale)})`)
    }
    if (seen !== g.ribbons.length) prop.push(`${seen} data-value ribbon(s) in the svg, expected ${g.ribbons.length}`)
  }
  rows.push({
    id: 6, name: 'ribbons-proportional', severity: 'fail', ok: prop.length === 0,
    detail: prop.length ? prop.slice(0, 6).join('; ') : `every ribbon and bar matches its value × ${g.scale} within 1px (${g.ribbons.length + g.nodes.length} checked)`,
    hint: prop.length ? 'ribbon thickness must be value × geo.scale — read data-value back and compare' : undefined,
  })

  // #7 every node whose inflow ≠ outflow is disclosed in the 差分 footnote
  const diff = unbalanced(ir)
  const diffFoot = g.footnotes.find((f) => f.text.startsWith(DIFF_PREFIX))
  const cons = []
  for (const d of diff) {
    const entry = `${d.label} 入 ${fmt(d.in, ir.unit)} / 出 ${fmt(d.out, ir.unit)}`
    if (!diffFoot || !diffFoot.text.includes(entry)) cons.push(`${d.id} (in ${d.in}, out ${d.out}) not listed in the footnote`)
  }
  if (!diff.length && diffFoot) cons.push('差分 footnote present although every node balances')
  if (svg !== undefined && diff.length) {
    const k = g.footnotes.indexOf(diffFoot)
    if (!diffFoot || !svg.includes(`id="${uid}-foot-${k}"`)) cons.push('差分 footnote missing from the svg')
  }
  rows.push({
    id: 7, name: 'flow-conserved', severity: 'fail', ok: cons.length === 0,
    detail: cons.length ? cons.slice(0, 6).join('; ') : diff.length ? `${diff.length} node(s) with in ≠ out disclosed in the 差分 footnote` : 'every intermediate node balances (in = out)',
    hint: cons.length ? 'a node whose inflow and outflow differ must be listed as 「差分: <label> 入 X / 出 Y」 — never stretch a ribbon to hide it' : undefined,
  })

  // #8 bars in a column never overlap and keep ≥ 12px between them
  const stackProblems = []
  for (let c = 0; c < g.stages.length; c++) {
    const col = g.nodes.filter((nd) => nd.col === c).sort((a, b) => a.y - b.y)
    for (let j = 1; j < col.length; j++) {
      const gap = col[j].y - (col[j - 1].y + col[j - 1].height)
      if (gap < NODE_GAP - 1e-6) stackProblems.push(`${col[j - 1].id}/${col[j].id}: ${round2(gap)}px apart`)
    }
    for (const nd of col) if (!(nd.height > 0)) stackProblems.push(`${nd.id} has no height`)
  }
  rows.push({
    id: 8, name: 'nodes-stacked', severity: 'fail', ok: stackProblems.length === 0,
    detail: stackProblems.length ? stackProblems.slice(0, 6).join('; ') : `bars in every column keep ≥ ${NODE_GAP}px between them`,
    hint: stackProblems.length ? 'stack the bars of a column with at least 12px between them, top to bottom in IR order' : undefined,
  })

  // #9 labels (node, value, footnote) clear of each other and inside the canvas
  const clash = []
  for (let i = 0; i < g.labels.length; i++) {
    for (let j = i + 1; j < g.labels.length; j++) {
      if (overlaps(g.labels[i].box, g.labels[j].box)) clash.push(`${g.labels[i].id} overlaps ${g.labels[j].id}`)
    }
  }
  const off = g.labels.filter((l) => l.box.left < 0 || l.box.right > layoutResult.width || l.box.top < 0 || l.box.bottom > layoutResult.height).map((l) => l.id)
  if (off.length) clash.push(`off-canvas: ${off.join(', ')}`)
  rows.push({
    id: 9, name: 'labels-clear', severity: 'fail', ok: clash.length === 0,
    detail: clash.length ? clash.slice(0, 6).join('; ') : `${g.labels.length} labels, none overlapping`,
    hint: clash.length ? 'shorten node labels or merge the smallest nodes so every label has its own room' : undefined,
  })

  return rows
}

// --- doc ------------------------------------------------------------------

export const doc = {
  purpose: 'quantities flowing between stages as ribbons whose thickness is the value (traffic routing, cost allocation, funnel with branches)',
  whenToUse: 'when the reader must see where a quantity splits and merges across 2–4 stages and how big each branch is; not for a plain funnel without branches (use pyramid) or a role workflow without quantities (use process). Budgets: nodes ≤ 12, links ≤ 16, label ≤ 12 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn. A node whose inflow and outflow differ is disclosed in a 差分 footnote; ribbons too thin for a value label list their value in a 細い流れ footnote.',
  irExample: `id: traffic-routing
type: sankey
title: 流入経路と申込までの振り分け
caption: 検索と広告は LP に集中し、申込の 6 割は LP 経由
unit: 件
nodes:
  - id: search
    label: 検索
    stage: 0
  - id: ads
    label: 広告
    stage: 0
  - id: direct
    label: 直接
    stage: 0
  - id: lp
    label: LP
    stage: 1
  - id: top
    label: トップ
    stage: 1
  - id: signup
    label: 申込
    stage: 2
    emphasis: true
  - id: exit
    label: 離脱
    stage: 2
links:
  - from: search
    to: lp
    value: 120
  - from: search
    to: top
    value: 40
  - from: ads
    to: lp
    value: 80
  - from: direct
    to: top
    value: 60
  - from: lp
    to: signup
    value: 50
  - from: lp
    to: exit
    value: 150
  - from: top
    to: signup
    value: 30
  - from: top
    to: exit
    value: 70
`,
  rows: ['node-count', 'link-count', 'label-length', 'emphasis-count', 'links-forward', 'ribbons-proportional', 'flow-conserved', 'nodes-stacked', 'labels-clear'],
}
