import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR } from '../bin/lib/ir.mjs'
import {
  renderDiagram, renderFigureHtml, textWidth, COLUMN, MIN_SCALE,
  chooseOrientation, legendWidth, EDGE_LABEL_SIZE,
} from '../bin/lib/diagram.mjs'

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

test('an IR over the node budget is rejected with a concrete split suggestion', () => {
  const raw = parseYaml(fixture('budget.yaml'))
  const result = validateIR(raw)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'budget')
  assert.match(result.message, /nodes: 11 > 9/)
  assert.match(result.suggestion, /^split:/)
  assert.match(result.suggestion, /N0/) // n0 has the highest degree (4 edges)
})

test('an IR with 2+ groups over budget suggests splitting by group', () => {
  const raw = {
    id: 'g', title: 't',
    groups: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
      { id: 'c', label: 'C' }, { id: 'd', label: 'D' }, { id: 'e', label: 'E' },
    ],
    nodes: [{ id: 'n1', label: 'N1', group: 'a' }],
  }
  const result = validateIR(raw)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'budget')
  assert.match(result.suggestion, /one diagram per group/)
})

test('an edge label over 12 characters is a budget violation', () => {
  const raw = {
    id: 'l', title: 't',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync', label: 'this label is far too long' }],
  }
  const result = validateIR(raw)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'budget')
  assert.match(result.message, /label/)
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

test('a `via` hint routes the edge near the named node, still fully orthogonal', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const boxGw = out.layout.boxes.get('gw')
  const pts = edgePoints(out.svg, 'wu-d-d3-edge-0')
  const gwCenter = { x: boxGw.x + boxGw.width / 2, y: boxGw.y + boxGw.height / 2 }
  const closest = Math.min(...pts.map((p) => Math.hypot(p.x - gwCenter.x, p.y - gwCenter.y)))
  assert.ok(closest <= 8, `via node "gw" not visited by the edge path (closest=${closest})`)
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
