// `type: tree` — a hierarchy: one root, children under (or right of) their
// parent, no sharing, no cycles. The structure itself is the subject —
// a decomposition, an option tree, a reporting line. `variant: org` is the
// same layout drawn as an org chart: every node may carry a second muted
// `sub` line (the role), and the connectors are a shared bus under each
// parent (stem → horizontal bus → one drop per child) instead of per-child
// elbows.
//
// IR shape: `{ id, type:'tree', title, caption, variant, direction, root }`.
// `root` is `{ id, label, sub?, tone, emphasis, children: [same shape] }`;
// `variant` is `tree` (default) or `org`; `direction` is `down` (default)
// or `right` (wide trees: the breadth axis becomes vertical). Every node id
// is unique across the tree.
//
// Layout is a deterministic tidy tree (Reingold–Tilford in its bounding-box
// form): subtrees are measured bottom-up and placed side by side with a
// fixed gap, every parent is centred over the midpoint of its first and
// last child, and levels sit at fixed depths. Nodes on one level share a
// width (so siblings line up) and a height (so the connector bus always
// runs through the empty band between two levels). Everything lands on the
// 4px grid: node widths are multiples of 8, heights 40 or 56, gaps 24/40.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, SUBLABEL_SIZE, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'tree'

export const limits = { maxNodes: 16, maxDepth: 4, maxLabelLen: 14, maxEmphasis: 2 }

const VARIANTS = new Set(['tree', 'org'])
const DIRECTIONS = new Set(['down', 'right'])
const MARGIN = 8
const PAD_X = 16            // text inset inside a node box
const NODE_MIN_W = 88
const NODE_H = 40           // label only
const NODE_H_SUB = 56       // label + sub line
const SIB_GAP = 24          // between sibling subtrees (breadth axis)
const LEVEL_GAP = 40        // between levels (depth axis); the bus runs at its middle
const CENTRE_TOLERANCE = 4  // parent centre vs. midpoint of first/last child centre

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const variant = normalizeEnum(raw.variant, 'variant', VARIANTS, 'tree', ctx)
  const direction = normalizeEnum(raw.direction, 'direction', DIRECTIONS, 'down', ctx)
  if (!isObj(raw.root)) throw new IrError(`${ctx}.root is required and must be a mapping`)
  const seen = new Set()
  const root = normalizeNode(raw.root, `${ctx}.root`, seen)
  return { id, type, title, caption, variant, direction, root }
}

function normalizeEnum(v, field, allowed, fallback, ctx) {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'string' || !allowed.has(v)) {
    throw new IrError(`${ctx}.${field} must be ${[...allowed].join('|')} (got: ${JSON.stringify(v)})`)
  }
  return v
}

function normalizeNode(raw, ctx, seen) {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const id = requireStr(raw, 'id', ctx)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new IrError(`${ctx}.id must match [A-Za-z0-9_-]+ (got: ${JSON.stringify(id)})`)
  if (seen.has(id)) throw new IrError(`duplicate node id: "${id}"`)
  seen.add(id)
  const label = requireStr(raw, 'label', ctx)
  const sub = optStr(raw, 'sub', ctx)
  const tone = validateTone(raw.tone, ctx)
  const emphasis = validateBool(raw, 'emphasis', ctx)
  let children = []
  if (raw.children !== undefined && raw.children !== null) {
    if (!Array.isArray(raw.children)) throw new IrError(`${ctx}.children must be a list`)
    children = raw.children.map((c, i) => normalizeNode(c, `${ctx}.children[${i}]`, seen))
  }
  const node = { id, label, tone, emphasis, children }
  if (sub !== undefined && sub.trim() !== '') node.sub = sub
  return node
}

/** Every node with its level (root = 1) and parent id, in preorder. */
function flatten(root) {
  const out = []
  const walk = (node, level, parent) => {
    out.push({ node, level, parent })
    node.children.forEach((c) => walk(c, level + 1, node.id))
  }
  walk(root, 1, undefined)
  return out
}

const depthOf = (root) => Math.max(...flatten(root).map((r) => r.level))

// --- budgets ---------------------------------------------------------------

export function budgetWarnings(ir) {
  const out = []
  const all = flatten(ir.root)
  if (all.length > limits.maxNodes) {
    out.push(budgetWarning('budget:nodes', all.length, limits.maxNodes,
      `${all.length} node(s) (guidance ≤ ${limits.maxNodes})`,
      'collapse a subtree into one node, or split the figure at a branch'))
  }
  const depth = depthOf(ir.root)
  if (depth > limits.maxDepth) {
    out.push(budgetWarning('budget:depth', depth, limits.maxDepth,
      `${depth} level(s) (guidance ≤ ${limits.maxDepth})`,
      'cut the tree at a level and draw the deeper part as its own figure'))
  }
  const longest = all.reduce((m, r) => ([...r.node.label].length > (m ? [...m.node.label].length : 0) ? r : m), null)
  if (longest && [...longest.node.label].length > limits.maxLabelLen) {
    const len = [...longest.node.label].length
    out.push(budgetWarning('budget:label', len, limits.maxLabelLen,
      `label of node "${longest.node.id}" is ${len} chars (guidance ≤ ${limits.maxLabelLen})`,
      `shorten label of node "${longest.node.id}"`))
  }
  const emphasized = all.filter((r) => r.node.emphasis).length
  if (emphasized > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized, limits.maxEmphasis,
      `${emphasized} emphasized node(s) (guidance ≤ ${limits.maxEmphasis})`,
      'keep emphasis on the root or the one leaf the decision is about'))
  }
  return out
}

// --- layout ----------------------------------------------------------------
//
// Computed on an abstract (breadth, depth) plane and mapped to (x, y) at
// the end: `down` reads breadth as x and depth as y, `right` swaps them.

const snapUp8 = (v) => Math.ceil(v / 8) * 8

/** Per-level node size: one width and one height per level so siblings
 * line up and the inter-level band stays empty for the bus. */
function levelSizes(root) {
  const widths = []
  const heights = []
  for (const { node, level } of flatten(root)) {
    const labelW = textWidth(node.label, FONT_SIZE) * (node.emphasis ? BOLD_FACTOR : 1)
    const subW = node.sub ? textWidth(node.sub, SUBLABEL_SIZE) : 0
    const w = snapUp8(Math.max(NODE_MIN_W, Math.ceil(Math.max(labelW, subW)) + PAD_X * 2))
    widths[level] = Math.max(widths[level] ?? 0, w)
    heights[level] = Math.max(heights[level] ?? NODE_H, node.sub ? NODE_H_SUB : NODE_H)
  }
  return { widths, heights }
}

/** Bottom-up: the breadth span of a subtree and where its root's centre
 * sits inside it. Children subtrees are laid side by side (SIB_GAP apart);
 * the parent is centred over the midpoint of the first and last child
 * centre, and the whole thing is shifted right if the parent would poke
 * out on the left. Every value is a multiple of 4. */
function measure(node, level, breadth) {
  const w = breadth[level]
  if (node.children.length === 0) return { node, level, span: w, c: w / 2, kids: [] }
  let off = 0
  const kids = node.children.map((child) => {
    const sub = measure(child, level + 1, breadth)
    const rec = { sub, off }
    off += sub.span + SIB_GAP
    return rec
  })
  const childrenSpan = off - SIB_GAP
  const first = kids[0], last = kids[kids.length - 1]
  let c = snap4((first.off + first.sub.c + last.off + last.sub.c) / 2)
  let shift = 0
  if (c - w / 2 < 0) { shift = w / 2 - c; c = w / 2 }
  for (const k of kids) k.off += shift
  const span = Math.max(childrenSpan + shift, c + w / 2)
  return { node, level, span, c, kids }
}

function place(sub, b0, depthAt, breadth, depth, parent, out) {
  const level = sub.level
  const rec = {
    id: sub.node.id, label: sub.node.label, tone: sub.node.tone, emphasis: sub.node.emphasis,
    level, parent, children: sub.node.children.map((c) => c.id),
    b: b0 + sub.c - breadth[level] / 2, d: depthAt[level], bw: breadth[level], dw: depth[level],
  }
  if (sub.node.sub) rec.sub = sub.node.sub
  out.push(rec)
  for (const k of sub.kids) place(k.sub, b0 + k.off, depthAt, breadth, depth, sub.node.id, out)
}

export async function layout(ir) {
  const down = ir.direction === 'down'
  const { widths, heights } = levelSizes(ir.root)
  const breadth = down ? widths : heights   // extent along the sibling axis, per level
  const depth = down ? heights : widths     // extent along the parent→child axis, per level
  const depthAt = []
  let d = MARGIN
  for (let l = 1; l < depth.length; l++) { depthAt[l] = d; d += depth[l] + LEVEL_GAP }
  const abstract = []
  place(measure(ir.root, 1, breadth), MARGIN, depthAt, breadth, depth, undefined, abstract)

  const nodes = abstract.map((n) => {
    const { b, d: dd, bw, dw, ...rest } = n
    const x = down ? b : dd, y = down ? dd : b
    const width = down ? bw : dw, height = down ? dw : bw
    return { ...rest, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links = []
  const buses = []
  for (const p of nodes) {
    if (!p.children.length) continue
    const kids = p.children.map((id) => byId.get(id))
    if (down) {
      const busY = p.y + p.height + LEVEL_GAP / 2
      for (const c of kids) {
        links.push({ index: links.length, parent: p.id, child: c.id, points: [{ x: p.cx, y: p.y + p.height }, { x: p.cx, y: busY }, { x: c.cx, y: busY }, { x: c.cx, y: c.y }] })
      }
      buses.push({ parent: p.id, x1: Math.min(...kids.map((c) => c.cx)), y1: busY, x2: Math.max(...kids.map((c) => c.cx)), y2: busY })
    } else {
      const busX = p.x + p.width + LEVEL_GAP / 2
      for (const c of kids) {
        links.push({ index: links.length, parent: p.id, child: c.id, points: [{ x: p.x + p.width, y: p.cy }, { x: busX, y: p.cy }, { x: busX, y: c.cy }, { x: c.x, y: c.cy }] })
      }
      buses.push({ parent: p.id, x1: busX, y1: Math.min(...kids.map((c) => c.cy)), x2: busX, y2: Math.max(...kids.map((c) => c.cy)) })
    }
  }
  const width = snapUp4(Math.max(...nodes.map((n) => n.x + n.width)) + MARGIN)
  const height = snapUp4(Math.max(...nodes.map((n) => n.y + n.height)) + MARGIN)
  return { width, height, geo: { nodes, links, buses } }
}

// --- draw ----------------------------------------------------------------------

const nodeFill = (n) => (n.tone === 'neutral' ? 'var(--wu-surface)' : `var(--wu-fig-tone-${n.tone})`)

export function draw(geo, ir) {
  const uid = `wu-d-${ir.id}`
  const { nodes, links, buses } = geo.geo
  const parts = []
  // connectors first so node boxes paint over their end points
  if (ir.variant === 'org') {
    const byParent = new Map()
    for (const l of links) {
      if (!byParent.has(l.parent)) byParent.set(l.parent, [])
      byParent.get(l.parent).push(l)
    }
    for (const bus of buses) {
      const group = byParent.get(bus.parent) ?? []
      const stem = group[0]
      const segs = []
      if (stem) segs.push(`M${stem.points[0].x} ${stem.points[0].y} L${stem.points[1].x} ${stem.points[1].y}`)
      if (bus.x1 !== bus.x2 || bus.y1 !== bus.y2) segs.push(`M${bus.x1} ${bus.y1} L${bus.x2} ${bus.y2}`)
      for (const l of group) segs.push(`M${l.points[2].x} ${l.points[2].y} L${l.points[3].x} ${l.points[3].y}`)
      parts.push(`<path id="${uid}-bus-${bus.parent}" d="${segs.join(' ')}" fill="none" stroke="currentColor" stroke-width="1"/>`)
    }
  } else {
    for (const l of links) {
      const d = `M${l.points[0].x} ${l.points[0].y} ${l.points.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`
      parts.push(`<path id="${uid}-link-${l.index}" d="${d}" fill="none" stroke="currentColor" stroke-width="1"/>`)
    }
  }
  for (const n of nodes) {
    const cls = n.emphasis ? ' class="wu-focal"' : ''
    const sw = n.emphasis ? 1.5 : 1
    const weight = n.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-${n.id}" data-tone="${esc(n.tone)}"${cls} x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="${nodeFill(n)}" stroke="currentColor" stroke-width="${sw}"/>`)
    if (n.sub) {
      parts.push(`<text id="${uid}-${n.id}-label" x="${n.cx}" y="${n.y + 23}" font-size="${FONT_SIZE}" text-anchor="middle"${weight} fill="currentColor">${esc(n.label)}</text>`)
      parts.push(`<text id="${uid}-${n.id}-sub" x="${n.cx}" y="${n.y + 41}" font-size="${SUBLABEL_SIZE}" text-anchor="middle" fill="var(--wu-ink-3)">${esc(n.sub)}</text>`)
    } else {
      parts.push(`<text id="${uid}-${n.id}-label" x="${n.cx}" y="${n.cy + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="middle"${weight} fill="currentColor">${esc(n.label)}</text>`)
    }
  }
  return parts.join('')
}

// --- verify --------------------------------------------------------------------

const right = (n) => n.x + n.width
const bottom = (n) => n.y + n.height
const rectsOverlap = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)

/** Does the axis-aligned open segment p→q pass through the open rect? */
function segmentCrosses(p, q, r) {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x)
  const y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y)
  if (p.y === q.y) return p.y > r.y && p.y < bottom(r) && Math.max(x1, r.x) < Math.min(x2, right(r))
  if (p.x === q.x) return p.x > r.x && p.x < right(r) && Math.max(y1, r.y) < Math.min(y2, bottom(r))
  return true
}

function onBorder(p, n) {
  const onX = p.x >= n.x && p.x <= right(n)
  const onY = p.y >= n.y && p.y <= bottom(n)
  return (onX && (p.y === n.y || p.y === bottom(n))) || (onY && (p.x === n.x || p.x === right(n)))
}

function warnRow(id, name, budget, key, okDetail) {
  const w = budget.find((b) => b.key === key)
  return { id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value }
}

function failRow(id, name, problems, okDetail, hint) {
  const ok = problems.length === 0
  return { id, name, severity: 'fail', ok, detail: ok ? okDetail : problems.slice(0, 4).join('; '), hint: ok ? undefined : hint }
}

export function verify(geo, ir) {
  const { nodes, links } = geo.geo
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const budget = budgetWarnings(ir)
  const all = flatten(ir.root)
  const rows = [
    warnRow(1, 'node-count', budget, 'budget:nodes', `${all.length} node(s)`),
    warnRow(2, 'depth', budget, 'budget:depth', `${depthOf(ir.root)} level(s)`),
    warnRow(3, 'label-length', budget, 'budget:label', `every label within ${limits.maxLabelLen} chars`),
    warnRow(4, 'emphasis-count', budget, 'budget:emphasis', `${all.filter((r) => r.node.emphasis).length} emphasized node(s)`),
  ]

  const overlap = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rectsOverlap(nodes[i], nodes[j])) overlap.push(`"${nodes[i].id}" overlaps "${nodes[j].id}"`)
    }
  }
  rows.push(failRow(5, 'node-overlap', overlap, 'no two nodes overlap', 'subtrees must be separated by the sibling gap — check measure()'))

  const shape = []
  const cross = []
  for (const l of links) {
    const P = byId.get(l.parent), C = byId.get(l.child)
    if (!P || !C) { shape.push(`link ${l.index} references a missing node`); continue }
    if (l.points.length < 2) { shape.push(`link ${l.index} has fewer than 2 points`); continue }
    for (let i = 0; i < l.points.length - 1; i++) {
      const p = l.points[i], q = l.points[i + 1]
      if (p.x !== q.x && p.y !== q.y) shape.push(`link ${l.index} ("${l.parent}"→"${l.child}") segment ${i} is diagonal`)
    }
    if (!onBorder(l.points[0], P)) shape.push(`link ${l.index} does not start on the border of "${P.id}"`)
    if (!onBorder(l.points[l.points.length - 1], C)) shape.push(`link ${l.index} does not end on the border of "${C.id}"`)
    for (const n of nodes) {
      if (n.id === l.parent || n.id === l.child) continue
      for (let i = 0; i < l.points.length - 1; i++) {
        if (segmentCrosses(l.points[i], l.points[i + 1], n)) { cross.push(`link ${l.index} ("${l.parent}"→"${l.child}") crosses "${n.id}"`); break }
      }
    }
  }
  rows.push(failRow(6, 'connectors-orthogonal', shape, 'every connector is orthogonal and attaches to both node borders', 'route connectors as stem → bus → drop, starting and ending on the node borders'))
  rows.push(failRow(7, 'connector-clearance', cross, 'no connector crosses an unrelated node', 'the bus must run in the empty band between two levels — check LEVEL_GAP and the per-level heights'))

  const centred = []
  const axis = ir.direction === 'down' ? 'cx' : 'cy'
  for (const p of nodes) {
    if (!p.children.length) continue
    const kids = p.children.map((id) => byId.get(id)).filter(Boolean)
    if (!kids.length) continue
    const mid = (kids[0][axis] + kids[kids.length - 1][axis]) / 2
    const off = Math.abs(p[axis] - mid)
    if (off > CENTRE_TOLERANCE) centred.push(`"${p.id}" is ${off}px off the centre of its children`)
  }
  rows.push(failRow(8, 'parent-centred', centred, `every parent sits within ±${CENTRE_TOLERANCE}px of the midpoint of its first and last child`, 'centre each parent over its children in measure() before placing the level'))
  return rows
}

export const doc = {
  purpose: 'a hierarchy — one root, children under or right of their parent (decomposition, option tree, org chart with variant: org)',
  whenToUse: 'when the *structure itself* is the subject and every node has exactly one parent; use dependency/diagram for shared parents or cycles, nested for containment. `variant: org` adds a muted role line (`sub`) and a shared bus under each parent. Budgets: nodes ≤ 16, 4 levels, label ≤ 14 chars, emphasis ≤ 2 — guidance, over-budget figures still render with data-warn; wide trees can use `direction: right`.',
  irExample: `id: team-org
type: tree
variant: org
title: 開発組織の体制
caption: 技術部門の下に開発と基盤の 2 チーム、事業部門の下に営業
root:
  id: ceo
  label: 代表
  sub: CEO
  emphasis: true
  children:
    - id: tech
      label: 技術部門
      sub: CTO
      children:
        - id: dev
          label: 開発チーム
          sub: Eng Lead
        - id: platform
          label: 基盤チーム
          sub: Platform Lead
    - id: biz
      label: 事業部門
      sub: COO
      children:
        - id: sales
          label: 営業チーム
          sub: Sales Lead
    - id: admin
      label: 管理部門
      sub: CFO
`,
  rows: ['node-count', 'depth', 'label-length', 'emphasis-count', 'node-overlap', 'connectors-orthogonal', 'connector-clearance', 'parent-centred'],
}
