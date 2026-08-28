import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../bin/lib/ir.mjs'
import {
  renderDiagram, renderFigureHtml, textWidth, COLUMN, MIN_SCALE,
  chooseOrientation, legendWidth, EDGE_LABEL_SIZE, normalizePolyline,
  groupLayerMode, groupLayerHeuristicPrefersElk,
} from '../bin/lib/diagram.mjs'
import { verifyDiagram } from '../bin/lib/verify-diagram.mjs'
import { unescapeIrScript } from '../bin/lib/ir-script.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')
const ir = (name) => {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

/** Extract the numeric point list of one edge path's `d` attribute. */
function edgePoints(svg, edgeId) {
  const re = new RegExp(`<path id="${edgeId}"[^>]*? d="([^"]+)"`)
  const m = re.exec(svg)
  assert.ok(m, `edge path ${edgeId} not found in svg`)
  const nums = m[1].match(/-?\d+(?:\.\d+)?/g).map(Number)
  const pts = []
  for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
  return pts
}

function allEdgePaths(svg) {
  return [...svg.matchAll(/<path id="(wu-d-[^"]*?-edge-\d+)"[^>]*? d="([^"]+)"/g)].map((m) => m[2])
}

/** Every attribute (name="value") on one edge path's opening <path> tag. */
function edgeTag(svg, edgeId) {
  const re = new RegExp(`<path id="${edgeId}"[^>]*>`)
  const m = re.exec(svg)
  assert.ok(m, `edge path ${edgeId} not found in svg`)
  return m[0]
}

/** A `d` attribute's point list split into one array per "M…" subpath — a
 * `via` edge draws one subpath per hop, so hop boundaries (at a via node's
 * border) never get treated as a single connected segment. */
function edgeSubpaths(svg, edgeId) {
  const re = new RegExp(`<path id="${edgeId}"[^>]*? d="([^"]+)"`)
  const m = re.exec(svg)
  assert.ok(m, `edge path ${edgeId} not found in svg`)
  return m[1].split(/(?=M)/).filter(Boolean).map((sub) => {
    const nums = sub.match(/-?\d+(?:\.\d+)?/g).map(Number)
    const pts = []
    for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
    return pts
  })
}

/** True when an axis-aligned segment cuts through `box`'s strict interior
 * (touching the border only, from an elk-terminated edge endpoint, does not
 * count — this is what distinguishes "routed near/through a node" from
 * "routed to touch a node's border", contract §4-2 #8's real intent). */
function segmentEntersBoxInterior(a, b, box) {
  const insideX = (x) => x > box.x && x < box.x + box.width
  const insideY = (y) => y > box.y && y < box.y + box.height
  if (a.y === b.y) {
    if (!insideY(a.y)) return false
    const xlo = Math.min(a.x, b.x), xhi = Math.max(a.x, b.x)
    return xhi > box.x && xlo < box.x + box.width
  }
  if (!insideX(a.x)) return false
  const ylo = Math.min(a.y, b.y), yhi = Math.max(a.y, b.y)
  return yhi > box.y && ylo < box.y + box.height
}

/** True when any segment of any subpath enters any node's box interior. */
function anySegmentEntersAnyNode(subpaths, boxes) {
  for (const sec of subpaths) {
    for (let i = 1; i < sec.length; i++) {
      for (const box of boxes.values()) {
        if (segmentEntersBoxInterior(sec[i - 1], sec[i], box)) return true
      }
    }
  }
  return false
}

/** Node boxes in the same post-snap coordinate space the svg's own edge
 * points are drawn in (`renderDiagram`'s `layout.boxes` is elk's raw,
 * pre-snap layout — off by up to a few px from what actually ends up in
 * the markup, which is exactly what layout.geo.nodes records). */
function geoNodeBoxes(out) {
  return new Map(out.layout.geo.nodes.map((n) => [n.id, n]))
}

// --- CJK vs ASCII width ---------------------------------------------------

test('CJK characters are estimated wider than ASCII for the same count', () => {
  assert.ok(textWidth('あああ') > textWidth('aaa'))
  assert.equal(textWidth('a'), 0.6 * 13)
  assert.equal(textWidth('あ'), 1 * 13)
})

// --- orthogonal routing ----------------------------------------------------

test('every edge path segment is horizontal or vertical (ORTHOGONAL routing)', async () => {
  for (const name of ['simple.yaml', 'groups.yaml', 'hints.yaml', 'wide.yaml']) {
    const out = await renderDiagram(ir(name))
    const paths = allEdgePaths(out.svg)
    assert.ok(paths.length > 0, `${name}: no edge paths found`)
    for (const d of paths) {
      const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
      for (let i = 2; i < nums.length; i += 2) {
        const dx = Math.abs(nums[i] - nums[i - 2])
        const dy = Math.abs(nums[i + 1] - nums[i - 1])
        assert.ok(dx === 0 || dy === 0, `${name}: diagonal segment in path "${d}"`)
      }
    }
  }
})

// --- 4px grid snapping -------------------------------------------------

test('node/group boxes and edge points snap to a 4px grid', async () => {
  for (const name of ['simple.yaml', 'groups.yaml', 'hints.yaml']) {
    const out = await renderDiagram(ir(name))
    for (const m of out.svg.matchAll(/<rect[^>]*>/g)) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        const am = new RegExp(`\\b${attr}="(-?\\d+(?:\\.\\d+)?)"`).exec(m[0])
        if (am) assert.equal(Number(am[1]) % 4, 0, `${name}: rect ${attr}=${am[1]} not grid-aligned`)
      }
    }
    for (const d of allEdgePaths(out.svg)) {
      for (const n of d.match(/-?\d+(?:\.\d+)?/g).map(Number)) {
        assert.equal(n % 4, 0, `${name}: edge point ${n} not grid-aligned in "${d}"`)
      }
    }
    assert.equal(out.width % 4, 0)
    assert.equal(out.height % 4, 0)
  }
})

// --- orientation auto-select --------------------------------------------

test('a diagram without a pinned direction picks whichever orientation fits the column better', async () => {
  const raw = {
    id: 'w', title: 't',
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `XXXXXXXXXX${i}` })),
    edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, kind: 'sync' })),
  }
  const v = validateIR(raw)
  assert.ok(v.ok)
  const out = await renderDiagram(v.ir)
  // A 9-node chain laid out "right" would blow far past the column; "down" wins.
  assert.equal(out.layout.direction, 'down')
})

test('a pinned direction is never overridden even if it does not fit', async () => {
  const raw = {
    id: 'w', title: 't', direction: 'right',
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `XXXXXXXXXX${i}` })),
    edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, kind: 'sync' })),
  }
  const v = validateIR(raw)
  const out = await renderDiagram(v.ir)
  assert.equal(out.layout.direction, 'right')
})

// A short chain that comfortably fits the column laid out "right" still has
// a *larger* fitRatio than the same chain laid out "down" — max(w/720, ...)
// vs max(h/900, ...): the "down" ratio's larger denominator (MAX_HEIGHT=900
// vs COLUMN=720) makes it come out smaller even though "right" already fits
// outright. A naive "smaller fitRatio wins" comparison would pick "down"
// for every ordinary chain like this one, stacking it needlessly tall
// (contract §4-2 #16 amendment). The rule now checks "does right fit at
// scale 1" first, before ever comparing ratios.
test('a chain that fits the column laid out right is not stacked down just because down has the smaller fitRatio', async () => {
  const raw = {
    id: 'chain3', title: 't',
    nodes: [{ id: 'a', label: 'N0' }, { id: 'b', label: 'N1' }, { id: 'c', label: 'N2' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync' }, { from: 'b', to: 'c', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok)
  const chosen = await chooseOrientation(v.ir)
  assert.ok(chosen.fitRatio.right <= 1, `expected "right" to fit the column outright, got fitRatio ${chosen.fitRatio.right}`)
  assert.ok(chosen.fitRatio.down < chosen.fitRatio.right, 'this fixture only demonstrates the amendment if the naive comparison would have picked "down"')
  assert.equal(chosen.direction, 'right')

  const out = await renderDiagram(v.ir)
  assert.equal(out.layout.direction, 'right')
  assert.ok(out.width <= COLUMN)
})

// --- scale / scroll thresholds -------------------------------------------

test('a figure that fits the column is neither scaled nor scrolled', async () => {
  const out = await renderDiagram(ir('simple.yaml'))
  assert.ok(out.width <= COLUMN)
  assert.equal(out.scaled, false)
  assert.equal(out.scroll, false)
})

test('a figure wider than the column but within the 0.78 floor is scaled, not scrolled', async () => {
  const out = await renderDiagram(ir('wide.yaml'))
  assert.ok(out.width > COLUMN, `expected wide.yaml to exceed ${COLUMN}px, got ${out.width}`)
  assert.ok(COLUMN / out.width >= MIN_SCALE)
  assert.equal(out.scaled, true)
  assert.equal(out.scroll, false)
})

test('a figure that would need to shrink below 0.78 scrolls instead of scaling', async () => {
  const out = await renderDiagram(ir('scroll.yaml'))
  assert.ok(out.width > COLUMN)
  assert.ok(COLUMN / out.width < MIN_SCALE, `expected scroll.yaml to need scale < ${MIN_SCALE}`)
  assert.equal(out.scaled, false)
  assert.equal(out.scroll, true)
})

// --- natural size: explicit svg width/height -----------------------------
//
// The <svg> only carried a viewBox before; with no width/height attribute a
// browser gives it no intrinsic size, so CSS's `max-width:100%` (a
// *maximum*, not a fixed size) let a wide container stretch it — and
// `height:auto` then scaled the height up right along with it, turning a
// short 3-node chain into a figure thousands of pixels tall. Explicit
// width/height (in CSS px, after any scale-down) give the svg a real
// intrinsic size so it only ever shrinks to fit a narrower container, never
// grows to fill a wider one.

function svgAttrs(svg) {
  const w = /<svg\b[^>]*\bwidth="([^"]+)"/.exec(svg)
  const h = /<svg\b[^>]*\bheight="([^"]+)"/.exec(svg)
  assert.ok(w && h, 'svg root is missing a width or height attribute')
  return { width: Number(w[1]), height: Number(h[1]) }
}

test('a figure at native size carries width/height attributes equal to the layout size', async () => {
  const out = await renderDiagram(ir('simple.yaml'))
  const attrs = svgAttrs(out.svg)
  assert.equal(attrs.width, out.width)
  assert.equal(attrs.height, out.height)
  assert.match(out.svg, /^<svg role="img" aria-labelledby="wu-d-d1-title wu-d-d1-desc" width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/)
})

test('a scaled-down figure carries width/height attributes at the scaled (not native) size', async () => {
  const out = await renderDiagram(ir('wide.yaml'))
  assert.equal(out.scaled, true)
  const attrs = svgAttrs(out.svg)
  assert.equal(attrs.width, COLUMN)
  assert.ok(attrs.width < out.width, 'scaled width attribute should be smaller than the native layout width')
  assert.equal(attrs.height, Math.round(out.height * (COLUMN / out.width)))
  assert.match(out.svg, new RegExp(`viewBox="0 0 ${out.width} ${out.height}"`))
})

test('a scrolling figure keeps its native width/height in the svg attributes (no shrink)', async () => {
  const out = await renderDiagram(ir('scroll.yaml'))
  assert.equal(out.scroll, true)
  const attrs = svgAttrs(out.svg)
  assert.equal(attrs.width, out.width)
  assert.equal(attrs.height, out.height)
})

// --- budgets ---------------------------------------------------------------

// Budgets are guidance, not a gate: validateIR() still accepts the IR and
// reports the overrun as a warning (with the concrete split suggestion as
// its hint) so the renderer can draw the figure and stamp data-warn.

test('an IR over the node budget validates with a budget:nodes warning carrying a split suggestion', () => {
  const raw = parseYaml(fixture('budget.yaml'))
  const result = validateIR(raw)
  assert.equal(result.ok, true)
  assert.equal(result.warnings.length, 1)
  const w = result.warnings[0]
  assert.equal(w.key, 'budget:nodes')
  assert.equal(w.value, 11)
  assert.equal(w.limit, 9)
  assert.match(w.detail, /11 node\(s\)/)
  assert.match(w.hint, /split:/)
  assert.match(w.hint, /N0/) // n0 has the highest degree (4 edges)
  assert.equal(formatBudgetWarnings(result.warnings), 'budget:nodes=11')
})

test('an IR with 2+ groups over budget warns and suggests splitting by group', () => {
  const raw = {
    id: 'g', title: 't',
    groups: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
      { id: 'c', label: 'C' }, { id: 'd', label: 'D' }, { id: 'e', label: 'E' },
    ],
    nodes: [{ id: 'n1', label: 'N1', group: 'a' }],
  }
  const result = validateIR(raw)
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings.map((w) => w.key), ['budget:groups'])
  assert.match(result.warnings[0].hint, /one diagram per group/)
})

test('an edge label over 12 characters is a budget:label warning with the longest length as its value', () => {
  const raw = {
    id: 'l', title: 't',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync', label: 'this label is far too long' }],
  }
  const result = validateIR(raw)
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings.map((w) => w.key), ['budget:label'])
  assert.equal(result.warnings[0].value, 'this label is far too long'.length)
  assert.match(result.warnings[0].detail, /label/)
})

test('budget warnings come back in a stable order (nodes, edges, groups, label) and an in-budget IR has none', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))
  const edges = Array.from({ length: 13 }, (_, i) => ({ from: `n${i % 10}`, to: `n${(i + 1) % 10}`, kind: 'sync', label: i === 0 ? 'a very long edge label' : undefined }))
  const groups = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, label: `G${i}` }))
  const result = validateIR({ id: 'o', title: 't', nodes, edges, groups })
  assert.equal(result.ok, true)
  assert.equal(formatBudgetWarnings(result.warnings), 'budget:nodes=10;budget:edges=13;budget:groups=5;budget:label=22')
  assert.deepEqual(validateIR(parseYaml(fixture('simple.yaml'))).warnings, [])
})

test('more than 2 emphasis nodes is a budget violation', () => {
  const raw = {
    id: 'e', title: 't',
    nodes: [
      { id: 'a', label: 'A', emphasis: true },
      { id: 'b', label: 'B', emphasis: true },
      { id: 'c', label: 'C', emphasis: true },
    ],
  }
  const result = validateIR(raw)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'budget')
  assert.match(result.message, /emphasis: 3 > 2/)
})

// --- local hints produce ports ------------------------------------------

test('from_side/to_side hints anchor the edge to the requested side of each node', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const boxA = out.layout.boxes.get('a')
  const boxB = out.layout.boxes.get('b')
  const pts = edgePoints(out.svg, 'wu-d-d3-edge-0')
  const start = pts[0]
  const end = pts[pts.length - 1]
  // from_side: right -> starts at A's right edge
  assert.ok(Math.abs(start.x - (boxA.x + boxA.width)) <= 8, `edge does not start at A's right side (start.x=${start.x})`)
  // to_side: left -> ends at B's left edge
  assert.ok(Math.abs(end.x - boxB.x) <= 8, `edge does not end at B's left side (end.x=${end.x})`)
})

test('a `via` hint routes the edge to touch the named node\'s border as a real elk endpoint, not through its interior', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const boxGw = geoNodeBoxes(out).get('gw')
  const subpaths = edgeSubpaths(out.svg, 'wu-d-d3-edge-0')
  // one via node -> two hops -> two "M…" subpaths in the drawn path.
  assert.equal(subpaths.length, 2, `expected 2 subpaths (a->gw, gw->b), got ${subpaths.length}`)
  const onBorder = (p) => (
    Math.abs(p.x - boxGw.x) < 0.5 || Math.abs(p.x - (boxGw.x + boxGw.width)) < 0.5 ||
    Math.abs(p.y - boxGw.y) < 0.5 || Math.abs(p.y - (boxGw.y + boxGw.height)) < 0.5
  )
  const hop0End = subpaths[0][subpaths[0].length - 1]
  const hop1Start = subpaths[1][0]
  assert.ok(onBorder(hop0End), `hop into gw does not end on its border: ${JSON.stringify(hop0End)}`)
  assert.ok(onBorder(hop1Start), `hop out of gw does not start on its border: ${JSON.stringify(hop1Start)}`)
})

test('a `via` hint never draws a segment through the via node\'s interior (or any other node\'s)', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const subpaths = edgeSubpaths(out.svg, 'wu-d-d3-edge-0')
  assert.ok(!anySegmentEntersAnyNode(subpaths, geoNodeBoxes(out)), 'a segment cuts through a node box (including "gw")')
})

test('a `via` edge draws as one <path> with exactly one arrowhead and its label at label_at', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const svg = out.svg
  assert.equal((svg.match(/<path id="wu-d-d3-edge-0"/g) || []).length, 1, 'expected exactly one <path> for the via edge')
  const tag = edgeTag(svg, 'wu-d-d3-edge-0')
  assert.equal((tag.match(/marker-end=/g) || []).length, 1, 'expected exactly one marker-end (one arrowhead)')
  assert.ok(!/marker-start=|marker-mid=/.test(tag), 'no marker-start/marker-mid — a via touch point must not draw an arrowhead')
  assert.match(svg, />認可</, 'edge label text is present in the svg')
  assert.ok(out.layout.geo.edges[0].label, 'geo.edges[0].label was not recorded')
})

test('a two-via chain (a -> v1 -> v2 -> b) draws as one path and passes all 20 checks', async () => {
  const raw = {
    id: 'via2', title: '2-via chain', direction: 'right',
    nodes: [
      { id: 'a', label: 'A' }, { id: 'v1', label: 'V1' }, { id: 'v2', label: 'V2' }, { id: 'b', label: 'B' },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sync', via: ['v1', 'v2'], label: '経由', label_at: 0.5 },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  const out = await renderDiagram(v.ir)
  const subpaths = edgeSubpaths(out.svg, 'wu-d-via2-edge-0')
  assert.equal(subpaths.length, 3, `expected 3 hops (a->v1, v1->v2, v2->b), got ${subpaths.length}`)
  assert.ok(!anySegmentEntersAnyNode(subpaths, geoNodeBoxes(out)), 'a segment cuts through a node box')
  const tag = edgeTag(out.svg, 'wu-d-via2-edge-0')
  assert.equal((tag.match(/marker-end=/g) || []).length, 1, 'expected exactly one arrowhead')
  assert.ok(!/marker-start=|marker-mid=/.test(tag))

  const { verifyDiagram } = await import('../bin/lib/verify-diagram.mjs')
  const result = await verifyDiagram(v.ir, out)
  assert.deepEqual(result.checks.filter((c) => !c.ok), [], `unexpected failures: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`)
})

// --- a11y ------------------------------------------------------------------

test('the svg root has role=img, a <title> first child, and a non-empty <desc>', async () => {
  const out = await renderDiagram(ir('simple.yaml'))
  assert.match(out.svg, /^<svg role="img" aria-labelledby="wu-d-d1-title wu-d-d1-desc"/)
  const titleIdx = out.svg.indexOf('<title')
  const firstTagAfterSvg = /<svg[^>]*>(<[a-zA-Z]+)/.exec(out.svg)[1]
  assert.equal(firstTagAfterSvg, '<title')
  assert.ok(titleIdx > 0)
  const desc = /<desc id="wu-d-d1-desc">([^<]*)<\/desc>/.exec(out.svg)
  assert.ok(desc && desc[1].trim().length > 0, 'desc must be non-empty')
})

test('every internal id is prefixed wu-d-<id>-', async () => {
  const out = await renderDiagram(ir('simple.yaml'))
  const ids = [...out.svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  assert.ok(ids.length > 0)
  for (const id of ids) assert.ok(id.startsWith('wu-d-d1-'), `id "${id}" is not prefixed wu-d-d1-`)
})

// --- legend ------------------------------------------------------------

test('the legend lists only the edge kinds actually used, and nothing when there are none', async () => {
  const out = await renderDiagram(ir('simple.yaml')) // sync + async + reply
  assert.ok(out.svg.includes('>sync<'))
  assert.ok(out.svg.includes('>async<'))
  assert.ok(out.svg.includes('>reply<'))

  const syncOnly = validateIR({
    id: 'x', title: 't',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync' }],
  })
  const out2 = await renderDiagram(syncOnly.ir)
  assert.ok(out2.svg.includes('>sync<'))
  assert.ok(!out2.svg.includes('>async<'))
  assert.ok(!out2.svg.includes('>reply<'))

  const noEdges = validateIR({ id: 'y', title: 't', nodes: [{ id: 'a', label: 'A' }] })
  const out3 = await renderDiagram(noEdges.ir)
  assert.ok(!out3.svg.includes('wu-d-y-legend'))
})

/** The x/text-end of every `<text>` inside the drawn `<g id="...-legend">`. */
function legendTextEnds(svg) {
  const g = /<g id="wu-d-[^"]*-legend"[^>]*>([\s\S]*?)<\/g>/.exec(svg)
  assert.ok(g, 'legend group not found in svg')
  return [...g[1].matchAll(/<text x="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map(([, x, label]) => Number(x) + Math.ceil(textWidth(label, EDGE_LABEL_SIZE)))
}

test('the legend always fits inside the canvas, even when it is wider than the diagram', async () => {
  for (const name of ['simple.yaml', 'groups.yaml']) {
    const out = await renderDiagram(ir(name))
    const ends = legendTextEnds(out.svg)
    assert.ok(ends.length > 0, `${name}: expected at least one legend entry`)
    for (const end of ends) assert.ok(end <= out.width - 12, `${name}: legend text ends at ${end}, past width-padding ${out.width - 12}`)
  }

  // Two tiny nodes (single-node-wide "down" diagram) but all 3 edge kinds:
  // the legend ("sync" + "async" + "reply") needs more horizontal room than
  // the diagram itself, so the canvas must widen to fit it rather than
  // clipping the last label at the svg's right edge.
  const raw = {
    id: 'leg', title: 't', direction: 'down',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync' },
      { from: 'b', to: 'a', kind: 'async' },
      { from: 'a', to: 'b', kind: 'reply' },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok)
  const out = await renderDiagram(v.ir)
  const legendNeeds = legendWidth(out.layout.usedKinds)
  assert.ok(legendNeeds > 148, `fixture should need a wider canvas than the diagram alone (got ${legendNeeds})`)
  assert.ok(out.width >= legendNeeds, `canvas (${out.width}) should have widened to fit the legend (${legendNeeds})`)
  for (const end of legendTextEnds(out.svg)) assert.ok(end <= out.width - 12, `legend text ends at ${end}, past width-padding ${out.width - 12}`)
})

// --- no hardcoded hex colors --------------------------------------------

test('the svg never hardcodes a hex color (colors route through currentColor/CSS vars)', async () => {
  for (const name of ['simple.yaml', 'groups.yaml', 'hints.yaml']) {
    const out = await renderDiagram(ir(name))
    // Strip id/href fragment references (url(#...), which legitimately contain "#").
    const withoutRefs = out.svg.replace(/url\(#[^)]*\)/g, '').replace(/#wu-d-[^"'\s)]*/g, '')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(withoutRefs), `${name}: found a hex color in svg`)
  }
})

// --- figure wrapper --------------------------------------------------------

test('renderFigureHtml wraps the svg in the kit figure markup with the raw YAML preserved', async () => {
  const rawYaml = fixture('simple.yaml')
  const result = await renderFigureHtml(ir('simple.yaml'), { rawYaml })
  assert.ok(result.html.startsWith('<figure class="wu-figure">'))
  assert.ok(result.html.includes('<svg role="img"'))
  assert.ok(result.html.includes('<figcaption>'))
  assert.ok(result.html.includes('<script type="text/x-writeup-diagram">'))
  assert.ok(result.html.includes(rawYaml.trim()))
  assert.ok(result.html.trim().endsWith('</figure>'))
})

test('renderFigureHtml HTML-escapes the embedded IR script so a hostile label/caption can\'t inject markup or close the block early', async () => {
  const rawYaml = 'id: d1\nlabel: <img src=x onerror=alert(1)>\ncaption: "</script><script>alert(1)</script>"\n'
  const result = await renderFigureHtml(ir('simple.yaml'), { rawYaml })
  assert.ok(!result.html.includes('<img src=x'), 'raw <img must not appear in the html')
  assert.ok(!result.html.includes('</script><script>alert(1)</script>'), 'raw </script> break-out must not appear')
  assert.ok(result.html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(result.html.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'))
})

test('the escaped IR script round-trips through unescapeIrScript back to the original raw YAML', async () => {
  const rawYaml = 'id: d1\nlabel: <img src=x onerror=alert(1)> & more'
  const result = await renderFigureHtml(ir('simple.yaml'), { rawYaml })
  const m = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(result.html)
  assert.ok(m, 'script block not found')
  assert.equal(unescapeIrScript(m[1]), rawYaml)
})

// --- groups ------------------------------------------------------------

test('groups are drawn as containers around their member nodes', async () => {
  const out = await renderDiagram(ir('groups.yaml'))
  assert.ok(out.svg.includes('id="wu-d-d2-browser"'))
  assert.ok(out.svg.includes('id="wu-d-d2-server"'))
  const groupBox = out.layout.boxes.get('browser')
  const spaBox = out.layout.boxes.get('spa')
  assert.ok(spaBox.x >= groupBox.x && spaBox.y >= groupBox.y, 'spa should sit inside the browser group box')
})

test('emphasis nodes get the wu-focal class instead of an inline color', async () => {
  const out = await renderDiagram(ir('simple.yaml'))
  assert.ok(out.svg.includes('class="wu-focal"'))
  assert.equal((out.svg.match(/class="wu-focal"/g) || []).length, 2) // rect + text for the one emphasis node
})

test('an emphasis node gets a 1.5 stroke width and its label stays ink-colored, not accent-colored', async () => {
  const out = await renderDiagram(ir('simple.yaml')) // worker: emphasis: true
  const rect = /<rect id="wu-d-d1-worker"[^>]*\/>/.exec(out.svg)
  assert.ok(rect, 'emphasis node rect not found')
  assert.match(rect[0], /stroke-width="1\.5"/)
  const text = /<text id="wu-d-d1-worker-label"[^>]*>[^<]*<\/text>/.exec(out.svg)
  assert.ok(text, 'emphasis node label not found')
  // fill stays currentColor (normal ink) — any accent color comes from CSS
  // stroke on the rect only, never from the svg's own text fill.
  assert.match(text[0], /fill="currentColor"/)
  assert.doesNotMatch(text[0], /var\(--wu-accent\)|#[0-9a-fA-F]{3,8}/)
})

// The accent color for an emphasized node is a border-only cue: the CSS
// must stroke the .wu-focal <rect>, never fill the .wu-focal <text> (that
// read as too heavy at 13px) — this guards the two rules staying paired.
test('kit css gives .wu-focal an accent stroke on the rect only, never an accent fill on the text', async () => {
  const css = readFileSync(join(HERE, '..', 'kit', 'writeup.css'), 'utf8')
  assert.match(css, /\.wu-figure rect\.wu-focal\s*\{[^}]*stroke:\s*var\(--wu-accent\)/)
  assert.doesNotMatch(css, /\.wu-figure\s+text\.wu-focal/)
})

// --- edge polyline normalization (dup/collinear points from elk) ---------

test('normalizePolyline drops consecutive duplicate points and merges collinear same-direction runs into the minimal polyline', () => {
  // A duplicated point (elk repeating a via/port touch point) followed by
  // three collinear vertical bend points all moving the same direction —
  // the minimal path is a single "down, then left" polyline.
  const points = [
    { x: 344, y: 192 },
    { x: 344, y: 232 },
    { x: 344, y: 232 }, // exact duplicate of the previous point
    { x: 344, y: 400 }, // collinear, same direction (still moving down)
    { x: 344, y: 624 }, // collinear, same direction (still moving down)
    { x: 168, y: 624 }, // turn: now moving left
    { x: 168, y: 632 }, // turn: now moving down again
  ]
  assert.deepEqual(normalizePolyline(points), [
    { x: 344, y: 192 },
    { x: 344, y: 624 },
    { x: 168, y: 624 },
    { x: 168, y: 632 },
  ])
})

test('normalizePolyline never merges a genuine turn (a real short jog stays its own segment)', () => {
  // Same axis and direction changes twice in a row over a short span —
  // this is a real zigzag, not a collinear run, and must survive intact
  // so checkRhythm can still see (and flag) the short interior segment.
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 8 }, // turn: down (short — 8px)
    { x: 80, y: 8 }, // turn: right again
  ]
  assert.deepEqual(normalizePolyline(points), points)
})

test('normalizePolyline is a no-op on an already-minimal polyline', () => {
  const points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 60 }]
  assert.deepEqual(normalizePolyline(points), points)
})

// --- conway.yaml: the fixture that exposed the elk dup/collinear-point bug -

test('conway.yaml (mirrored org/sys groups) renders with all 22 checks passing', async () => {
  const parsedIr = ir('conway.yaml')
  const out = await renderDiagram(parsedIr)
  const { verifyDiagram } = await import('../bin/lib/verify-diagram.mjs')
  const result = await verifyDiagram(parsedIr, out)
  assert.equal(result.checks.length, 22)
  assert.deepEqual(result.checks.filter((c) => !c.ok), [], `unexpected failures: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`)
  assert.equal(result.ok, true)
})

// --- grouped-layer mode (auto-detection, explicit `layer:`, `layer: none`) -

/** A geo edge's single unbent segment: exactly one section, exactly two
 * points — the shape a hand-drawn in-layer/cross-layer connector always
 * produces when its two boxes share a coordinate on the cross axis. */
function soleSegment(geoEdge) {
  assert.equal(geoEdge.sections.length, 1, `edges[${geoEdge.index}] should draw as one section`)
  const sec = geoEdge.sections[0]
  assert.equal(sec.length, 2, `edges[${geoEdge.index}] should have no bends, got ${JSON.stringify(sec)}`)
  return sec
}

function axisOf(sec) {
  const [a, b] = sec
  if (a.y === b.y) return 'horizontal'
  if (a.x === b.x) return 'vertical'
  assert.fail(`segment is neither horizontal nor vertical: ${JSON.stringify(sec)}`)
}

function manhattanLen(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

test('conway.yaml auto-detects grouped-layer mode: the three 写し取る edges are parallel, unbent, and each under 200px', async () => {
  const parsedIr = ir('conway.yaml')
  const out = await renderDiagram(parsedIr)
  const crossEdges = [0, 1, 2].map((i) => out.layout.geo.edges[i])
  const axes = crossEdges.map((e) => axisOf(soleSegment(e)))
  assert.ok(axes.every((a) => a === axes[0]), `写し取る edges are not all on the same axis: ${JSON.stringify(axes)}`)
  for (const e of crossEdges) {
    const [a, b] = e.sections[0]
    const len = manhattanLen(a, b)
    assert.ok(len < 200, `edges[${e.index}] (${e.from}->${e.to}) is ${len}px, expected < 200px`)
  }
})

test('conway.yaml: ta->tb draws as a single straight in-layer connector between the A and B boxes', async () => {
  const parsedIr = ir('conway.yaml')
  const out = await renderDiagram(parsedIr)
  const geo = out.layout.geo
  const taTb = geo.edges.find((e) => e.from === 'ta' && e.to === 'tb')
  assert.ok(taTb, 'ta->tb edge not found')
  const sec = soleSegment(taTb)
  const boxA = geo.nodes.find((n) => n.id === 'ta')
  const boxB = geo.nodes.find((n) => n.id === 'tb')
  // Both endpoints sit on the facing borders of A and B (not floating away
  // from either box), whichever orientation the axis-auto-select picked.
  const onBorder = (p, box) => (
    (Math.abs(p.x - box.x) < 0.5 || Math.abs(p.x - (box.x + box.width)) < 0.5) ||
    (Math.abs(p.y - box.y) < 0.5 || Math.abs(p.y - (box.y + box.height)) < 0.5)
  )
  assert.ok(sec.some((p) => onBorder(p, boxA)), `neither endpoint touches A's border: ${JSON.stringify(sec)}`)
  assert.ok(sec.some((p) => onBorder(p, boxB)), `neither endpoint touches B's border: ${JSON.stringify(sec)}`)
})

test('conway.yaml renders ok in both orientations, each choosing "right" columns or "down" rows per the fit rule', async () => {
  for (const direction of ['right', 'down']) {
    const raw = { ...ir('conway.yaml'), direction }
    const out = await renderDiagram(raw)
    assert.equal(out.layout.direction, direction)
    const { verifyDiagram } = await import('../bin/lib/verify-diagram.mjs')
    const result = await verifyDiagram(raw, out)
    assert.deepEqual(result.checks.filter((c) => !c.ok), [], `${direction}: unexpected failures: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`)
  }
})

test('an explicit numeric `layer:` on a group overrides the auto topological order', async () => {
  const raw = {
    id: 'explicit-layer', title: 't', direction: 'right',
    groups: [
      { id: 'g1', label: 'G1', layer: 1 },
      { id: 'g2', label: 'G2', layer: 0 },
    ],
    nodes: [
      { id: 'n1', label: 'N1', group: 'g1' },
      { id: 'n2', label: 'N2', group: 'g2' },
    ],
    // n1 -> n2 would put g1 before g2 under auto-detection; the explicit
    // layer hints (g1: 1, g2: 0) reverse that.
    edges: [{ from: 'n1', to: 'n2', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  const out = await renderDiagram(v.ir)
  const n1 = out.layout.geo.nodes.find((n) => n.id === 'n1')
  const n2 = out.layout.geo.nodes.find((n) => n.id === 'n2')
  assert.ok(n2.x < n1.x, `expected g2 (layer 0) before g1 (layer 1): n1.x=${n1.x} n2.x=${n2.x}`)
  const { verifyDiagram } = await import('../bin/lib/verify-diagram.mjs')
  const result = await verifyDiagram(v.ir, out)
  assert.deepEqual(result.checks.filter((c) => !c.ok), [], `unexpected failures: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`)
})

test('`layer: none` on a group opts the whole diagram out of grouped-layer mode', async () => {
  const rawNone = parseYaml(fixture('conway.yaml'))
  rawNone.groups[0].layer = 'none'
  const v = validateIR(rawNone)
  assert.ok(v.ok, JSON.stringify(v))

  const autoOut = await renderDiagram(ir('conway.yaml'))
  const noneOut = await renderDiagram(v.ir)
  // `layer: none` restores elk's own hierarchical compound-node layout —
  // the same shape conway.yaml had before this mode existed, which is a
  // visibly different (and, per the original bug report, worse) size than
  // the grouped-layer auto-detected one.
  assert.ok(
    noneOut.width !== autoOut.width || noneOut.height !== autoOut.height,
    'layer: none should change the layout, not silently match grouped-layer mode',
  )
})

// --- groupLayerMode(): the classification renderCheckedBest() branches on -

test('groupLayerMode: "off" when there are fewer than 2 groups', () => {
  const raw = {
    id: 'w', title: 't',
    groups: [{ id: 'g1', label: 'G1' }],
    nodes: [{ id: 'n1', label: 'N1', group: 'g1' }],
    edges: [],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'off')
})

test('groupLayerMode: "off" when a node belongs to no group', () => {
  const raw = {
    id: 'w', title: 't',
    groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2' }],
    nodes: [{ id: 'n1', label: 'N1', group: 'g1' }, { id: 'n2', label: 'N2' }],
    edges: [{ from: 'n1', to: 'n2', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'off')
})

test('groupLayerMode: "off" when the inter-group edges cycle and no explicit `layer:` breaks the tie', () => {
  const raw = {
    id: 'w', title: 't',
    groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2' }],
    nodes: [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g2' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync' }, { from: 'b', to: 'a', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'off')
})

test('groupLayerMode: "forced-elk" when a group carries `layer: none`', () => {
  const rawNone = parseYaml(fixture('conway.yaml'))
  rawNone.groups[0].layer = 'none'
  const v = validateIR(rawNone)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'forced-elk')
})

test('groupLayerMode: "forced-group" when a group carries an explicit numeric `layer:`', () => {
  const raw = {
    id: 'w', title: 't',
    groups: [{ id: 'g1', label: 'G1', layer: 1 }, { id: 'g2', label: 'G2', layer: 0 }],
    nodes: [{ id: 'n1', label: 'N1', group: 'g1' }, { id: 'n2', label: 'N2', group: 'g2' }],
    edges: [{ from: 'n1', to: 'n2', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'forced-group')
})

test('groupLayerMode: "auto" when the inter-group edges form a DAG with no explicit hints', () => {
  assert.equal(groupLayerMode(ir('conway.yaml')), 'auto')
})

// --- groupLayerHeuristicPrefersElk(): the "try, verify, pick" order hint --

test('groupLayerHeuristicPrefersElk: false for a plain two-group chain (one cross edge per node, no in-layer chain)', () => {
  const raw = {
    id: 'w', title: 't',
    groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2' }],
    nodes: [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g2' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerHeuristicPrefersElk(v.ir), false)
})

test('groupLayerHeuristicPrefersElk: true when one node carries more than one cross-layer edge', () => {
  // The shape that exposed this: two upstream nodes in different layers
  // both feeding a single downstream node one layer further on.
  const raw = {
    id: 'w', title: 't', direction: 'right',
    groups: [{ id: 'lib', label: 'L' }, { id: 'full', label: 'F' }, { id: 'meta', label: 'M' }],
    nodes: [
      { id: 'react', label: 'React', group: 'lib' },
      { id: 'angular', label: 'Angular', group: 'full' },
      { id: 'next', label: 'Next', group: 'meta' },
    ],
    edges: [
      { from: 'react', to: 'next', kind: 'sync' },
      { from: 'angular', to: 'next', kind: 'sync' },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerHeuristicPrefersElk(v.ir), true)
})

test('groupLayerHeuristicPrefersElk: true when an in-layer chain exceeds 2 hops', () => {
  const raw = {
    id: 'w', title: 't', direction: 'right',
    groups: [{ id: 'g1', label: 'G1' }, { id: 'g2', label: 'G2' }],
    nodes: [
      { id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g1' },
      { id: 'c', label: 'C', group: 'g1' }, { id: 'd', label: 'D', group: 'g1' },
      { id: 'x', label: 'X', group: 'g2' },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sync' },
      { from: 'b', to: 'c', kind: 'sync' },
      { from: 'c', to: 'd', kind: 'sync' },
      { from: 'a', to: 'x', kind: 'sync' },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerHeuristicPrefersElk(v.ir), true)
})

// --- grouped-layer router: cross-layer corridor fan-out --------------------
//
// Regression coverage for the "flat mode draws its own edge geometry and is
// weaker than elk's router" bug (rerender-figures.mjs on the real store
// dropped 139 -> 127 passing figures after grouped-layer mode landed): three
// edges sharing one node (one hub, three siblings one layer over) all cross
// the exact same pair of layer-facing borders, so crossLayerElbow() computed
// the identical mid coordinate for all three before this fan-out existed —
// landing their non-degenerate middle jogs collinear and overlapping.

test('grouped-layer router: cross-layer edges fanning out from one hub node no longer trip collinear-overlap', async () => {
  const raw = {
    id: 'fanout', title: 't', direction: 'right',
    groups: [{ id: 'hub', label: 'Hub' }, { id: 'leaves', label: 'Leaves' }],
    nodes: [
      { id: 'h', label: 'H', group: 'hub' },
      { id: 't1', label: 'T1', group: 'leaves' },
      { id: 't2', label: 'T2', group: 'leaves' },
      { id: 't3', label: 'T3', group: 'leaves' },
    ],
    edges: [
      { from: 'h', to: 't1', kind: 'sync', label: 'aaa' },
      { from: 'h', to: 't2', kind: 'sync', label: 'bbb' },
      { from: 'h', to: 't3', kind: 'sync', label: 'ccc' },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'auto')
  const rendered = await renderDiagram(v.ir, { forceElk: false })
  assert.equal(rendered.layout.mode, 'group')
  const result = await verifyDiagram(v.ir, rendered, { forceElk: false })
  const collinear = result.checks.find((c) => c.name === 'collinear-overlap')
  assert.equal(collinear.ok, true, collinear.detail)
})

// --- chain-long-labels.yaml: down-orientation layer spacing regression -----
//
// Before this fix, the between-layer spacing fed to elk
// (elk.layered.spacing.nodeNodeBetweenLayers) was derived from edge-label
// WIDTH regardless of orientation. In "down" orientation edges run
// vertically and their labels sit beside the line, so only the label's
// HEIGHT should matter — using width there reserved a whole label's text
// width as *vertical* whitespace at every layer gap, and (compounded by
// elk's own habit of giving a labeled edge a dedicated label layer padded on
// both sides) turned a plain 4-node chain with long node labels and short
// edge labels into a tall column of mostly whitespace.

test('chain-long-labels.yaml (down orientation) keeps consecutive layer gaps under 120px', async () => {
  const parsedIr = ir('chain-long-labels.yaml')
  assert.equal(parsedIr.direction, 'down')
  const out = await renderDiagram(parsedIr)
  assert.equal(out.layout.direction, 'down')
  const boxes = parsedIr.nodes.map((n) => out.layout.boxes.get(n.id))
  boxes.sort((a, b) => a.y - b.y)
  for (let i = 1; i < boxes.length; i++) {
    const gap = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height)
    assert.ok(gap <= 120, `gap between layer ${i - 1} and ${i} is ${gap}px, expected <= 120px`)
  }
})

test('chain-long-labels.yaml (down orientation) passes all verify-diagram checks', async () => {
  const parsedIr = ir('chain-long-labels.yaml')
  const out = await renderDiagram(parsedIr)
  const result = await verifyDiagram(parsedIr, out)
  assert.equal(result.checks.length, 22)
  assert.deepEqual(result.checks.filter((c) => !c.ok), [], `unexpected failures: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`)
  assert.equal(result.ok, true)
})

test('"right" orientation layer spacing is unchanged by the "down" fix: simple.yaml / conway.yaml widths', async () => {
  // Pinned regression values — right orientation's layer spacing formula
  // is untouched by the "down" fix, so these must keep matching what
  // renderDiagram produces. simple.yaml was 760 wide until the "right"
  // triple-booking fix (see the `elkPlacesLabel` comment in diagram.mjs):
  // its 2-char labels are elk-placed, so nodeNodeBetweenLayers dropped from
  // max(64, 32 + 36) = 68 to the 64px base on each of its two layer gaps.
  const expected = { 'simple.yaml': { width: 744, height: 152 }, 'conway.yaml': { width: 384, height: 472 } }
  for (const [name, dims] of Object.entries(expected)) {
    const raw = { ...ir(name), direction: 'right' }
    const out = await renderDiagram(raw)
    assert.equal(out.width, dims.width, `${name}: width changed`)
    assert.equal(out.height, dims.height, `${name}: height changed`)
  }
})

// --- "right" layer gaps: elk-placed labels are booked once, not three times
//
// Two figures from a real page (acl-overview.yaml / acl-internals.yaml, 4-6
// nodes in 3 groups, direction pinned to `right`) rendered 1908px and
// 1972px wide: every layer gap was ~2 x (label + 36) + label, because
// `labelSpace` widened nodeNodeBetweenLayers by the widest label AND elk
// reserved its own label-sized dummy layer padded by that same spacing on
// both sides. A label elk places itself must not count into `labelSpace`.

/** Horizontal gap between consecutive group boxes (sorted by x). */
function groupGaps(out, groupIds) {
  const boxes = groupIds.map((id) => out.layout.boxes.get(id)).sort((a, b) => a.x - b.x)
  const gaps = []
  for (let i = 1; i < boxes.length; i++) gaps.push(boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width))
  return gaps
}

test('acl-overview.yaml pinned right: each group-to-group gap is at most the widest label crossing it plus 2 x 64px, not ~3 labels wide', async () => {
  const parsed = ir('acl-overview.yaml')
  assert.equal(parsed.direction, 'right')
  const out = await renderDiagram(parsed, { forceElk: true })
  assert.equal(out.layout.direction, 'right')
  const widest = Math.max(...parsed.edges.map((e) => Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10))
  const gaps = groupGaps(out, ['mine', 'acl', 'other'])
  assert.equal(gaps.length, 2)
  for (const gap of gaps) {
    assert.ok(gap <= widest + 2 * 64 + 16, `group gap ${gap}px exceeds widest label ${widest}px + 2 x 64px spacing (was ~530px before the fix)`)
  }
  assert.ok(out.width < 1500, `acl-overview.yaml right width ${out.width} (was 1908 before the fix)`)
})

test('acl-internals.yaml pinned right (elk mode) shrank from 1972px: no group gap exceeds the widest label plus 2 x 64px', async () => {
  const parsed = ir('acl-internals.yaml')
  const out = await renderDiagram(parsed, { forceElk: true })
  const widest = Math.max(...parsed.edges.map((e) => Math.ceil(textWidth(e.label, EDGE_LABEL_SIZE)) + 10))
  for (const gap of groupGaps(out, ['sub', 'layer', 'ext'])) {
    assert.ok(gap <= widest + 2 * 64 + 16, `group gap ${gap}px exceeds widest label ${widest}px + 2 x 64px spacing`)
  }
  assert.ok(out.width < 1700, `acl-internals.yaml right width ${out.width} (was 1972 before the fix)`)
})

test('a hand-placed (via) label still widens the "right" layer gap to fit itself: hints.yaml keeps its size', async () => {
  // hints.yaml's only edge is a `via` edge whose label is placed by hand at
  // label_at, so its width must still be booked into nodeNodeBetweenLayers.
  const out = await renderDiagram({ ...ir('hints.yaml'), direction: 'right' })
  assert.equal(out.width, 536)
  assert.equal(out.height, 104)
})
