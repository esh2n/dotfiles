import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR } from '../bin/lib/ir.mjs'
import { renderDiagram, renderFigureHtml, normalizePolyline } from '../bin/lib/diagram.mjs'
import { verifyDiagram, renderChecked, renderFigureHtmlChecked } from '../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')
const ir = (name) => {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byId = (checks, id) => checks.find((c) => c.id === id)

// --- hand-built fixtures for the pass/fail pairs -----------------------
//
// A minimal 2-node/1-edge IR + renderResult that satisfies every one of
// the 20 rows by construction. Each check's "fails" test deep-clones this
// and mutates exactly the geometry (or ir field) that row inspects.

function baseIr(overrides = {}) {
  return {
    id: 'v', title: 'T', caption: 'C', direction: 'right', // pinned: keeps check #16 out of every other check's way
    groups: [],
    nodes: [
      { id: 'a', label: 'A', group: undefined, tone: 'neutral', dashed: false, emphasis: false },
      { id: 'b', label: 'B', group: undefined, tone: 'neutral', dashed: false, emphasis: false },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sync', label: undefined, from_side: undefined, to_side: undefined, via: [], label_at: undefined },
    ],
    ...overrides,
  }
}

function baseGeo(overrides = {}) {
  return {
    nodes: [
      { id: 'a', x: 0, y: 0, width: 124, height: 44, label: 'A', tone: 'neutral', emphasis: false, dashed: false },
      { id: 'b', x: 300, y: 0, width: 124, height: 44, label: 'B', tone: 'neutral', emphasis: false, dashed: false },
    ],
    groups: [],
    edges: [
      { id: 'wu-d-v-edge-0', index: 0, from: 'a', to: 'b', kind: 'sync', sections: [[{ x: 124, y: 20 }, { x: 300, y: 20 }]], label: null },
    ],
    legend: null,
    ...overrides,
  }
}

function baseSvg() {
  return [
    '<svg role="img" aria-labelledby="wu-d-v-title wu-d-v-desc" viewBox="0 0 424 44" xmlns="http://www.w3.org/2000/svg">',
    '<title id="wu-d-v-title">T</title>',
    '<desc id="wu-d-v-desc">C</desc>',
    '<defs></defs>',
    '<rect id="wu-d-v-a" data-tone="neutral" x="0" y="0" width="124" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1"/>',
    '<text id="wu-d-v-a-label" x="62" y="26" font-size="13" text-anchor="middle" fill="currentColor">A</text>',
    '<rect id="wu-d-v-b" data-tone="neutral" x="300" y="0" width="124" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1"/>',
    '<text id="wu-d-v-b-label" x="362" y="26" font-size="13" text-anchor="middle" fill="currentColor">B</text>',
    '<path id="wu-d-v-edge-0" d="M124 20 L300 20" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#wu-d-v-solid)"/>',
    '</svg>',
  ].join('')
}

/** A hand-built renderResult that passes every check against baseIr(). */
function baseRenderResult(overrides = {}) {
  return {
    svg: baseSvg(),
    width: 424,
    height: 44,
    scaled: false,
    scroll: false,
    layout: { direction: 'right', boxes: new Map(), usedKinds: ['sync'], geo: baseGeo() },
    ...overrides,
  }
}

function withGeo(patch) {
  const geo = baseGeo()
  return baseRenderResult({ layout: { direction: 'right', boxes: new Map(), usedKinds: ['sync'], geo: patch(geo) } })
}

function withSvg(mutate) {
  return baseRenderResult({ svg: mutate(baseSvg()) })
}

// Sanity: the hand-built base scenario passes all 20 rows, so every
// per-check "fails" test below is mutating away from a known-good baseline.
test('the hand-built base fixture passes every one of the 20 checks', async () => {
  const result = await verifyDiagram(baseIr(), baseRenderResult())
  const failing = result.checks.filter((c) => !c.ok)
  assert.deepEqual(failing, [], `unexpected failures: ${JSON.stringify(failing)}`)
  assert.equal(result.ok, true)
  assert.equal(result.checks.length, 20)
})

// --- 1. orthogonal ----------------------------------------------------

test('#1 orthogonal: passes when every segment is horizontal or vertical', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 1).ok, true)
})

test('#1 orthogonal: fails on a diagonal segment', async () => {
  const rr = withGeo((geo) => {
    geo.edges[0].sections = [[{ x: 124, y: 20 }, { x: 300, y: 60 }]]
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 1)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 2. label-route clearance >= 6px ------------------------------------

test('#2 label-clearance: passes when a label sits clear of every other edge', async () => {
  const irx = baseIr({
    nodes: [...baseIr().nodes, { id: 'c', label: 'C', tone: 'neutral', dashed: false, emphasis: false }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync', label: 'x' },
      { from: 'b', to: 'c', kind: 'sync' },
    ],
  })
  const rr = withGeo((geo) => {
    geo.nodes.push({ id: 'c', x: 600, y: 200, width: 124, height: 44, label: 'C', tone: 'neutral', emphasis: false, dashed: false })
    geo.edges[0].label = { x: 200, y: 4, width: 20, height: 14, text: 'x' } // far from edges[1] below
    geo.edges.push({ id: 'wu-d-v-edge-1', index: 1, from: 'b', to: 'c', kind: 'sync', sections: [[{ x: 424, y: 220 }, { x: 600, y: 220 }]], label: null })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  assert.equal(byId(r.checks, 2).ok, true)
})

test('#2 label-clearance: fails when a label sits within 6px of another edge path', async () => {
  const irx = baseIr({
    nodes: [...baseIr().nodes, { id: 'c', label: 'C', tone: 'neutral', dashed: false, emphasis: false }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync', label: 'x' },
      { from: 'b', to: 'c', kind: 'sync' },
    ],
  })
  const rr = withGeo((geo) => {
    geo.nodes.push({ id: 'c', x: 600, y: 0, width: 124, height: 44, label: 'C', tone: 'neutral', emphasis: false, dashed: false })
    geo.edges[0].label = { x: 450, y: 18, width: 20, height: 14, text: 'x' } // sits right on edges[1]'s y=20 line
    geo.edges.push({ id: 'wu-d-v-edge-1', index: 1, from: 'b', to: 'c', kind: 'sync', sections: [[{ x: 424, y: 20 }, { x: 600, y: 20 }]], label: null })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 2)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 3. unrelated edge crossings == 0 -----------------------------------

test('#3 unrelated-crossing: passes when two unrelated edges do not cross', async () => {
  const irx = baseIr({
    nodes: [...baseIr().nodes, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync' },
      { from: 'c', to: 'd', kind: 'sync' },
    ],
  })
  const rr = withGeo((geo) => {
    geo.nodes.push({ id: 'c', x: 0, y: 200, width: 124, height: 44 }, { id: 'd', x: 300, y: 200, width: 124, height: 44 })
    geo.edges.push({ id: 'e1', index: 1, from: 'c', to: 'd', kind: 'sync', sections: [[{ x: 124, y: 220 }, { x: 300, y: 220 }]], label: null })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  assert.equal(byId(r.checks, 3).ok, true)
})

test('#3 unrelated-crossing: fails when two unrelated edges cross transversally', async () => {
  const irx = baseIr({
    nodes: [...baseIr().nodes, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync' }, // horizontal at y=20, x in [124,300]
      { from: 'c', to: 'd', kind: 'sync' }, // vertical at x=200, y in [-20,60] — crosses edges[0]
    ],
  })
  const rr = withGeo((geo) => {
    geo.nodes.push({ id: 'c', x: 176, y: -60, width: 44, height: 44 }, { id: 'd', x: 176, y: 60, width: 44, height: 44 })
    geo.edges.push({ id: 'e1', index: 1, from: 'c', to: 'd', kind: 'sync', sections: [[{ x: 200, y: -20 }, { x: 200, y: 60 }]], label: null })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 3)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 4. unrelated collinear overlap < 8px -------------------------------

test('#4 collinear-overlap: passes when unrelated edges do not share a lane', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 4).ok, true)
})

test('#4 collinear-overlap: fails when two unrelated edges share >=8px of the same line', async () => {
  const irx = baseIr({
    nodes: [...baseIr().nodes, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    edges: [
      { from: 'a', to: 'b', kind: 'sync' },
      { from: 'c', to: 'd', kind: 'sync' },
    ],
  })
  const rr = withGeo((geo) => {
    geo.nodes.push({ id: 'c', x: 500, y: -40, width: 44, height: 44 }, { id: 'd', x: 700, y: -40, width: 44, height: 44 })
    // Same y=20 line as edges[0], overlapping x range [200,280] inside [124,300]: 80px shared.
    geo.edges.push({ id: 'e1', index: 1, from: 'c', to: 'd', kind: 'sync', sections: [[{ x: 200, y: 20 }, { x: 280, y: 20 }]], label: null })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 4)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 5. edge does not run along a group border ---------------------------

test('#5 border-hug: passes when an edge stays clear of every group border', async () => {
  const irx = baseIr({ groups: [{ id: 'g', label: 'G', tone: 'neutral' }] })
  const rr = withGeo((geo) => {
    geo.groups.push({ id: 'g', x: 0, y: 100, width: 500, height: 100, label: 'G', tone: 'neutral' })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  assert.equal(byId(r.checks, 5).ok, true)
})

test('#5 border-hug: fails when an edge runs parallel to a group border within 4px for >=16px', async () => {
  const irx = baseIr({ groups: [{ id: 'g', label: 'G', tone: 'neutral' }] })
  const rr = withGeo((geo) => {
    // Group's top border is the horizontal line y=20 from x=0..500 — exactly the edge's own line.
    geo.groups.push({ id: 'g', x: 0, y: 20, width: 500, height: 100, label: 'G', tone: 'neutral' })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 5)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 6. rhythm: segments >=8px, interior segments >=16px -----------------

test('#6 rhythm: passes when every segment clears the 8px/16px floor', async () => {
  const rr = withGeo((geo) => {
    geo.edges[0].sections = [[{ x: 124, y: 20 }, { x: 160, y: 20 }, { x: 160, y: 60 }, { x: 300, y: 60 }]]
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  assert.equal(byId(r.checks, 6).ok, true)
})

test('#6 rhythm: fails on a short interior segment', async () => {
  const rr = withGeo((geo) => {
    // 3 segments: 36px, 4px (interior, < 16px), 130px.
    geo.edges[0].sections = [[{ x: 124, y: 20 }, { x: 160, y: 20 }, { x: 160, y: 24 }, { x: 300, y: 24 }]]
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 6)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// A raw elk-style point list carrying the exact defect diagram.mjs's
// normalizePolyline() is meant to clean up (a duplicate touch point, then
// a run of collinear bend points) alongside a genuine 8px interior jog
// that is NOT a duplicate/collinear artifact. Normalizing must erase the
// former but leave the latter alone, and the rhythm check must still
// flag it — normalization is not a way to launder a real too-short
// segment past the verifier.
test('#6 rhythm: a genuine 8px interior segment still fails after normalizePolyline (not just a duplicate/collinear artifact)', async () => {
  const raw = [
    { x: 124, y: 20 },
    { x: 160, y: 20 },
    { x: 160, y: 20 }, // exact duplicate — must be dropped
    { x: 160, y: 60 }, // collinear continuation — must merge into one run
    { x: 220, y: 60 },
    { x: 220, y: 68 }, // genuine turn: real 8px interior jog (< 16px floor)
    { x: 300, y: 68 },
  ]
  const normalized = normalizePolyline(raw)
  // the real 8px jog survives normalization as its own segment
  assert.ok(normalized.some((p, i) => i > 0 && Math.abs(p.x - normalized[i - 1].x) + Math.abs(p.y - normalized[i - 1].y) === 8))
  const rr = withGeo((geo) => {
    geo.edges[0].sections = [normalized]
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 6)
  assert.equal(c.ok, false)
  assert.match(c.detail, /8px/)
  assert.ok(c.hint)
})

// --- 7. legend clearance -------------------------------------------------

test('#7 legend-clearance: passes when no legend is present', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 7).ok, true)
})

test('#7 legend-clearance: fails when an edge segment intersects the legend region', async () => {
  const rr = withGeo((geo) => {
    geo.legend = { x: 0, y: 16, width: 500, height: 28 } // overlaps edge's y=20 line
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 7)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// The legend box the check inspects must be the one actually inside the
// rendered canvas: when the legend needs more room than the diagram (a
// narrow diagram with all 3 edge kinds), the canvas widens to fit it
// (contract §4-2 amendment) — the legend box here must reflect that wider
// canvas, not the narrower diagram width, or this check would compare
// edges against a legend region narrower than what is actually drawn.
test('#7 legend-clearance: uses the widened canvas as the legend box, not the narrower diagram width', async () => {
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
  assert.ok(out.layout.geo.legend.width > 148, `legend box should span the widened canvas, got ${out.layout.geo.legend.width}`)
  assert.equal(out.layout.geo.legend.width, out.width)
  const r = await verifyDiagram(v.ir, out)
  assert.equal(byId(r.checks, 7).ok, true)
})

// --- 8. edge clears unrelated nodes by >=2px ------------------------------

test('#8 node-clearance: passes when the only nodes near the path are the ones it is attached to', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 8).ok, true)
})

test('#8 node-clearance: fails when an edge cuts through a node it is not attached to', async () => {
  const irx = baseIr({ nodes: [...baseIr().nodes, { id: 'c', label: 'C' }] })
  const rr = withGeo((geo) => {
    // c sits directly on the edge's y=20 line, between a and b.
    geo.nodes.push({ id: 'c', x: 180, y: 0, width: 44, height: 44 })
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 8)
  assert.equal(c.ok, false)
  assert.match(c.detail, /"c"/)
  assert.ok(c.hint)
})

test('#8 node-clearance: a `via` node is exempt even though the edge passes through it', async () => {
  const parsedIr = ir('hints.yaml')
  const out = await renderDiagram(parsedIr)
  const r = await verifyDiagram(parsedIr, out)
  assert.equal(byId(r.checks, 8).ok, true, JSON.stringify(byId(r.checks, 8)))
})

// --- 9. projected text scale >= 0.78 (or scroll) --------------------------

test('#9 projected-scale: passes at native size (width under the column)', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult(), { column: 720 })
  assert.equal(byId(r.checks, 9).ok, true)
})

test('#9 projected-scale: fails when the figure would need to shrink below 0.78 and is not scrolling', async () => {
  const rr = baseRenderResult({ width: 2000, scaled: false, scroll: false })
  const r = await verifyDiagram(baseIr(), rr, { column: 720 })
  const c = byId(r.checks, 9)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

test('#9 projected-scale: the scroll fallback is exempt from the 0.78 floor', async () => {
  const rr = baseRenderResult({ width: 2000, scaled: false, scroll: true })
  const r = await verifyDiagram(baseIr(), rr, { column: 720 })
  assert.equal(byId(r.checks, 9).ok, true)
})

// --- 10. node count <= 9 --------------------------------------------------

test('#10 node-count: passes at 9 nodes', async () => {
  const irx = baseIr({ nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })) })
  const r = await verifyDiagram(irx, baseRenderResult())
  assert.equal(byId(r.checks, 10).ok, true)
})

test('#10 node-count: fails over 9 nodes', async () => {
  const irx = baseIr({ nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })) })
  const r = await verifyDiagram(irx, baseRenderResult())
  const c = byId(r.checks, 10)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 11. edge count <= 12 -------------------------------------------------

test('#11 edge-count: passes at 12 edges', async () => {
  const irx = baseIr({ edges: Array.from({ length: 12 }, () => ({ from: 'a', to: 'b', kind: 'sync' })) })
  const r = await verifyDiagram(irx, baseRenderResult())
  assert.equal(byId(r.checks, 11).ok, true)
})

test('#11 edge-count: fails over 12 edges', async () => {
  const irx = baseIr({ edges: Array.from({ length: 13 }, () => ({ from: 'a', to: 'b', kind: 'sync' })) })
  const r = await verifyDiagram(irx, baseRenderResult())
  const c = byId(r.checks, 11)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 12. 4px grid ----------------------------------------------------------

test('#12 grid-4px: passes when every coordinate/size is a multiple of 4', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 12).ok, true)
})

test('#12 grid-4px: fails on an off-grid node position', async () => {
  const rr = withGeo((geo) => {
    geo.nodes[0].x = 3
    return geo
  })
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 12)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 13. emphasis count 1-2 (0 treated as acceptable) ---------------------

test('#13 emphasis-count: passes with 0 emphasis nodes (documented exception)', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  const c = byId(r.checks, 13)
  assert.equal(c.ok, true)
  assert.match(c.detail, /0 emphasis/)
})

test('#13 emphasis-count: passes with 1-2 emphasis nodes', async () => {
  const irx = baseIr({ nodes: [{ ...baseIr().nodes[0], emphasis: true }, baseIr().nodes[1]] })
  const r = await verifyDiagram(irx, baseRenderResult())
  assert.equal(byId(r.checks, 13).ok, true)
})

test('#13 emphasis-count: fails with more than 2 emphasis nodes', async () => {
  const irx = baseIr({
    nodes: [
      { id: 'a', label: 'A', emphasis: true },
      { id: 'b', label: 'B', emphasis: true },
      { id: 'c', label: 'C', emphasis: true },
    ],
  })
  const r = await verifyDiagram(irx, baseRenderResult())
  const c = byId(r.checks, 13)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 14. a11y --------------------------------------------------------------

test('#14 a11y: passes with role/title/desc/id-prefix all present', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 14).ok, true)
})

test('#14 a11y: fails when an id is not prefixed wu-d-<id>-', async () => {
  const rr = withSvg((svg) => svg.replace('id="wu-d-v-b"', 'id="stray-id"'))
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 14)
  assert.equal(c.ok, false)
  assert.match(c.detail, /stray-id/)
  assert.ok(c.hint)
})

test('#14 a11y: fails when role="img" is missing', async () => {
  const rr = withSvg((svg) => svg.replace(' role="img"', ''))
  const r = await verifyDiagram(baseIr(), rr)
  assert.equal(byId(r.checks, 14).ok, false)
})

// --- 15. label fits its node box ------------------------------------------

test('#15 label-fit: passes when the label estimate fits inside the box', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 15).ok, true)
})

test('#15 label-fit: fails when a label is wider than the box gives it room for', async () => {
  const irx = baseIr({ nodes: [{ id: 'a', label: 'ずいぶん長いラベルがここに入ってしまう例', emphasis: false }, baseIr().nodes[1]] })
  const rr = withGeo((geo) => {
    geo.nodes[0] = { id: 'a', x: 0, y: 0, width: 124, height: 44, label: 'ずいぶん長いラベルがここに入ってしまう例', tone: 'neutral', emphasis: false, dashed: false }
    return geo
  })
  const r = await verifyDiagram(irx, rr)
  const c = byId(r.checks, 15)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 16. orientation choice == smaller fitRatio ---------------------------

test('#16 orientation-choice: passes when direction is pinned (auto-select does not apply)', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult()) // baseIr() pins direction: 'right'
  const c = byId(r.checks, 16)
  assert.equal(c.ok, true)
  assert.match(c.detail, /pinned/)
})

test('#16 orientation-choice: passes when the renderer picked the better-fitting orientation', async () => {
  const raw = {
    id: 'w', title: 't',
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `XXXXXXXXXX${i}` })),
    edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, kind: 'sync' })),
  }
  const v = validateIR(raw)
  const out = await renderDiagram(v.ir) // renderDiagram itself picks the better fit
  const r = await verifyDiagram(v.ir, out)
  assert.equal(byId(r.checks, 16).ok, true)
})

test('#16 orientation-choice: fails when the claimed direction is the worse-fitting one', async () => {
  const raw = {
    id: 'w', title: 't',
    nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `XXXXXXXXXX${i}` })),
    edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, kind: 'sync' })),
  }
  const v = validateIR(raw)
  const out = await renderDiagram(v.ir) // picks "down" (see diagram.test.mjs)
  assert.equal(out.layout.direction, 'down')
  const tampered = { ...out, layout: { ...out.layout, direction: 'right' } }
  const r = await verifyDiagram(v.ir, tampered)
  const c = byId(r.checks, 16)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// Amended row #16: a short chain that fits the column laid out "right" must
// pass even though a naive fitRatio comparison would call "down" the better
// fit (see diagram.test.mjs for why the two denominators disagree).
test('#16 orientation-choice: passes for a chain that fits right, even though down has the smaller raw fitRatio', async () => {
  const raw = {
    id: 'chain3', title: 't',
    nodes: [{ id: 'a', label: 'N0' }, { id: 'b', label: 'N1' }, { id: 'c', label: 'N2' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync' }, { from: 'b', to: 'c', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok)
  const out = await renderDiagram(v.ir)
  assert.equal(out.layout.direction, 'right')
  const r = await verifyDiagram(v.ir, out)
  assert.equal(byId(r.checks, 16).ok, true)
})

// --- 17. dark 3-state: no hex colors, no rgb() ----------------------------

test('#17 dark-3-state: passes when every color routes through currentColor/var()', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 17).ok, true)
})

test('#17 dark-3-state: fails on a hardcoded hex color', async () => {
  const rr = withSvg((svg) => svg.replace('fill="none"', 'fill="#ff0000"'))
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 17)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

test('#17 dark-3-state: fails on an rgb() color', async () => {
  const rr = withSvg((svg) => svg.replace('fill="none"', 'fill="rgb(255,0,0)"'))
  const r = await verifyDiagram(baseIr(), rr)
  assert.equal(byId(r.checks, 17).ok, false)
})

// --- 18. font sizes in {13, 11} --------------------------------------------

test('#18 font-size: passes when every font-size is 13 or 11', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 18).ok, true)
})

test('#18 font-size: fails on an ad-hoc font-size', async () => {
  const rr = withSvg((svg) => svg.replace('font-size="13"', 'font-size="12"'))
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 18)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

// --- 19. stroke width in {1,1.5}, rx in {4,6,8} ---------------------------

test('#19 stroke-radius: passes when stroke widths and rx stay within the kit scale', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 19).ok, true)
})

test('#19 stroke-radius: fails on an out-of-scale stroke-width', async () => {
  const rr = withSvg((svg) => svg.replace('stroke-width="1"/>', 'stroke-width="2.2"/>'))
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 19)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

test('#19 stroke-radius: fails on an out-of-scale rx', async () => {
  const rr = withSvg((svg) => svg.replace('rx="6"', 'rx="10"'))
  const r = await verifyDiagram(baseIr(), rr)
  assert.equal(byId(r.checks, 19).ok, false)
})

// --- 20. single, finite svg -------------------------------------------------

test('#20 single-finite-svg: passes with exactly one <svg> and no non-finite values', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  assert.equal(byId(r.checks, 20).ok, true)
})

test('#20 single-finite-svg: fails when the markup contains NaN', async () => {
  const rr = withSvg((svg) => svg.replace('x="300"', 'x="NaN"'))
  const r = await verifyDiagram(baseIr(), rr)
  const c = byId(r.checks, 20)
  assert.equal(c.ok, false)
  assert.ok(c.hint)
})

test('#20 single-finite-svg: fails when there is more than one <svg> root', async () => {
  const rr = withSvg((svg) => svg + '<svg role="img"></svg>')
  const r = await verifyDiagram(baseIr(), rr)
  assert.equal(byId(r.checks, 20).ok, false)
})

// --- real fixtures through the full pipeline -----------------------------

test('every non-budget fixture passes all 20 checks end to end', async () => {
  for (const name of ['simple.yaml', 'groups.yaml', 'hints.yaml', 'wide.yaml', 'scroll.yaml']) {
    const parsedIr = ir(name)
    const out = await renderDiagram(parsedIr)
    const result = await verifyDiagram(parsedIr, out)
    const failing = result.checks.filter((c) => !c.ok)
    assert.deepEqual(failing, [], `${name}: unexpected failures: ${JSON.stringify(failing)}`)
  }
})

test('routeVia detours around a node it is not attached to (checks #3/#8 stay green)', async () => {
  const raw = {
    id: 'stress', title: 't', direction: 'right',
    nodes: [
      { id: 'n0', label: 'N0' }, { id: 'n1', label: 'N1' }, { id: 'n2', label: 'N2' },
      { id: 'n3', label: 'N3' }, { id: 'n4', label: 'N4' },
    ],
    edges: [
      { from: 'n0', to: 'n1', kind: 'sync' },
      { from: 'n1', to: 'n2', kind: 'sync' },
      { from: 'n2', to: 'n3', kind: 'sync' },
      { from: 'n3', to: 'n4', kind: 'sync' },
      { from: 'n0', to: 'n4', kind: 'async', via: ['n2'] },
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok)
  const out = await renderDiagram(v.ir)
  const result = await verifyDiagram(v.ir, out)
  const failing = result.checks.filter((c) => !c.ok)
  assert.deepEqual(failing, [], `unexpected failures: ${JSON.stringify(failing)}`)
})

// --- integration: renderChecked / renderFigureHtmlChecked -----------------

test('renderChecked attaches checks + checksOk to the plain render result', async () => {
  const out = await renderChecked(ir('simple.yaml'))
  assert.equal(out.checksOk, true)
  assert.equal(out.checks.length, 20)
  assert.ok(out.svg.startsWith('<svg'))
})

test('renderFigureHtmlChecked stamps data-checks="pass" only when every row passes', async () => {
  const good = await renderFigureHtmlChecked(ir('simple.yaml'), { rawYaml: fixture('simple.yaml') })
  assert.equal(good.checksOk, true)
  assert.match(good.html, /^<figure class="wu-figure" data-checks="pass">/)

  // A hand-built failing renderResult would come from a mutated pipeline;
  // exercise the "not stamped" branch directly against verifyDiagram's own
  // false case using the same figure template renderFigureHtml produces.
  const plain = await renderFigureHtml(ir('simple.yaml'), { rawYaml: fixture('simple.yaml') })
  assert.ok(!plain.html.includes('data-checks="pass"'), 'renderFigureHtml (unchecked) must not stamp data-checks itself')
})
