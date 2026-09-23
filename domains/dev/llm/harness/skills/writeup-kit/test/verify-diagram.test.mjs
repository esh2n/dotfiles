import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../bin/lib/ir.mjs'
import { renderDiagram, renderFigureHtml, normalizePolyline, groupLayerMode, groupLayerHeuristicPrefersElk, COLUMN, MIN_SCALE, LABEL_CLEARANCE } from '../bin/lib/diagram.mjs'
import { verifyDiagram, renderChecked, renderFigureHtmlChecked, renderCheckedBest, betterCandidate } from '../bin/lib/verify-diagram.mjs'

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
test('the hand-built base fixture passes every one of the 22 checks', async () => {
  const result = await verifyDiagram(baseIr(), baseRenderResult())
  const failing = result.checks.filter((c) => !c.ok)
  assert.deepEqual(failing, [], `unexpected failures: ${JSON.stringify(failing)}`)
  assert.equal(result.ok, true)
  assert.equal(result.checks.length, 22)
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
  for (const name of ['simple.yaml', 'groups.yaml', 'hints.yaml', 'wide.yaml', 'scroll.yaml', 'conway.yaml']) {
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
  assert.equal(out.checks.length, 22)
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

// --- renderCheckedBest: the "try, verify, pick" strategy -------------------
//
// Regression coverage for rerender-figures.mjs on the real store dropping
// 139 -> 127 passing figures once grouped-layer mode started auto-applying
// to any DAG-shaped grouped IR, even where its hand-drawn router did worse
// than elk's own orthogonal one. renderCheckedBest() is what renderChecked()
// and renderFigureHtmlChecked() (and so rerender-figures.mjs/
// render-diagram.mjs) now call instead of a single renderDiagram().

test('renderCheckedBest: an explicit numeric `layer:` forces grouped-layer mode only', async () => {
  const raw = {
    id: 'explicit-layer', title: 't', direction: 'right',
    groups: [{ id: 'g1', label: 'G1', layer: 1 }, { id: 'g2', label: 'G2', layer: 0 }],
    nodes: [{ id: 'n1', label: 'N1', group: 'g1' }, { id: 'n2', label: 'N2', group: 'g2' }],
    edges: [{ from: 'n1', to: 'n2', kind: 'sync' }],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'forced-group')
  const best = await renderCheckedBest(v.ir)
  assert.equal(best.layoutMode, 'group')
  assert.equal(best.checksOk, true)
})

test('renderCheckedBest: `layer: none` forces elk mode only', async () => {
  const rawNone = parseYaml(fixture('conway.yaml'))
  rawNone.groups[0].layer = 'none'
  const v = validateIR(rawNone)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'forced-elk')
  const best = await renderCheckedBest(v.ir)
  assert.equal(best.layoutMode, 'elk')
  assert.equal(best.checksOk, true)
})

test('renderCheckedBest: auto-eligible IR that fully passes in grouped-layer mode stays grouped-layer', async () => {
  const best = await renderCheckedBest(ir('conway.yaml'))
  assert.equal(groupLayerMode(ir('conway.yaml')), 'auto')
  assert.equal(best.layoutMode, 'group')
  assert.equal(best.checksOk, true)
})

// Real fixture (a 2-group cert-chain diagram from the store this regression
// was found on) where grouped-layer mode alone fails verification but elk's
// hierarchical layout passes cleanly — exactly the shape rerender-figures.mjs
// found 12 real pages of on the store copy.
function certChainIr() {
  return {
    id: 'd1', title: '証明書チェーンの検証',
    groups: [
      { id: 'store', label: 'OS / ブラウザのルートストア' },
      { id: 'sent', label: 'サーバーがハンドシェイクで送るチェーン' },
    ],
    nodes: [
      { id: 'root', label: 'ルート CA 証明書', group: 'store' },
      { id: 'inter', label: '中間 CA 証明書', group: 'sent' },
      { id: 'leaf', label: 'サーバー証明書', group: 'sent' },
    ],
    edges: [
      { from: 'root', to: 'inter', kind: 'sync', label: '署名を検証' },
      { from: 'inter', to: 'leaf', kind: 'sync', label: '署名を検証' },
    ],
  }
}

test('renderCheckedBest: the certificate-chain fixture that once failed grouped-layer mode now passes it outright (labels sit beside their runs)', async () => {
  // This fixture was the original "falls back to elk" regression: its
  // in-layer 署名を検証 label, centered on its connector, collided. With
  // hand-placed labels offset beside their own segment the grouped-layer
  // candidate is clean, so it is what renderCheckedBest() returns first.
  const v = validateIR(certChainIr())
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'auto')
  assert.equal(groupLayerHeuristicPrefersElk(v.ir), false)
  const group = await renderDiagram(v.ir, { forceElk: false })
  const groupVerify = await verifyDiagram(v.ir, group, { forceElk: false })
  assert.equal(groupVerify.ok, true, JSON.stringify(groupVerify.failures))
  const best = await renderCheckedBest(v.ir)
  assert.equal(best.checksOk, true)
  assert.equal(best.layoutMode, 'group')
})

test('renderCheckedBest: falls back to elk when grouped-layer mode fails verification (acl-internals.yaml)', async () => {
  const parsed = ir('acl-internals.yaml')
  assert.equal(groupLayerMode(parsed), 'auto')
  assert.equal(groupLayerHeuristicPrefersElk(parsed), false, 'this fixture should try grouped-layer mode first, then fall back')

  // Confirm the regression is actually present in this fixture: grouped-layer
  // mode alone fails (its hand-drawn router puts an in-layer edge through a
  // sibling node), so a plain renderDiagram()/verifyDiagram() call (the
  // pre-fix pipeline) would have reported this figure as failing.
  const group = await renderDiagram(parsed, { forceElk: false })
  const groupVerify = await verifyDiagram(parsed, group, { forceElk: false })
  assert.equal(groupVerify.ok, false, 'fixture no longer exercises the regression — pick a different one')

  const best = await renderCheckedBest(parsed)
  assert.equal(best.checksOk, true, JSON.stringify(best.failures))
  assert.equal(best.layoutMode, 'elk')
})

// Real fixture (a 3-group framework-comparison diagram, also from the store)
// where *neither* mode fully passes — the tie-break should still pick
// whichever candidate has fewer failing checks (elk, here), and this shape
// is also the one groupLayerHeuristicPrefersElk() flags (the downstream node
// carries two cross-layer edges), so it tries elk first.
function frameworkComparisonIr() {
  return {
    id: 'd1', title: 't', direction: 'right',
    groups: [{ id: 'lib', label: 'ライブラリ層' }, { id: 'full', label: 'フルフレームワーク層' }, { id: 'meta', label: 'メタフレームワーク層' }],
    nodes: [
      { id: 'react', label: 'React', group: 'lib' },
      { id: 'angular', label: 'Angular', group: 'full' },
      { id: 'next', label: 'Next や Nuxt や SvelteKit', group: 'meta' },
    ],
    edges: [
      { from: 'react', to: 'next', kind: 'sync', label: '本体の上に載る' },
      { from: 'angular', to: 'next', kind: 'sync', label: '本体の上に載る' },
    ],
  }
}

test('betterCandidate: zero failures first, then no scroll, then fewer warnings, then fewer failing rows; a full tie keeps the first', () => {
  const cand = ({ fail = 0, warn = 0, scroll = false, failingRows = fail + warn }) => ({
    failures: Array.from({ length: fail }, (_, i) => ({ id: i })),
    warnings: Array.from({ length: warn }, (_, i) => ({ id: 10 + i })),
    scroll,
    checks: [...Array.from({ length: failingRows }, () => ({ ok: false })), { ok: true }],
  })
  assert.equal(betterCandidate(cand({ fail: 1 }), cand({ fail: 0, scroll: true })), true, 'clean beats failing even when it scrolls')
  assert.equal(betterCandidate(cand({ fail: 0, scroll: true }), cand({ fail: 0 })), true, 'no scroll beats scroll')
  assert.equal(betterCandidate(cand({ fail: 0 }), cand({ fail: 0, scroll: true })), false)
  assert.equal(betterCandidate(cand({ warn: 2 }), cand({ warn: 1 })), true, 'fewer warnings')
  assert.equal(betterCandidate(cand({ fail: 2 }), cand({ fail: 1 })), true, 'fewer failing rows when both fail')
  assert.equal(betterCandidate(cand({ fail: 1 }), cand({ fail: 2 })), false)
  assert.equal(betterCandidate(cand({ fail: 1 }), cand({ fail: 1 })), false, 'a full tie keeps the first-tried candidate')
})

test('renderCheckedBest: when neither mode fully passes and they tie on failing rows, the first-tried (heuristically preferred) candidate is kept', async () => {
  // The framework-comparison fixture used to fail twice in grouped-layer
  // mode (border-hug + label-clearance) against once in elk; with labels
  // placed beside their runs it fails once in each — border-hug (its
  // fanned cross-layer elbow runs along a group border) vs elk's diagonal
  // segment — so the ranking's final tie-break, "keep the first tried",
  // is what decides, and the heuristic tries elk first for this shape.
  const v = validateIR(frameworkComparisonIr())
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(groupLayerMode(v.ir), 'auto')
  assert.equal(groupLayerHeuristicPrefersElk(v.ir), true, 'this fixture should try elk first per the heuristic')

  const group = await renderDiagram(v.ir, { forceElk: false })
  const groupVerify = await verifyDiagram(v.ir, group, { forceElk: false })
  const elk = await renderDiagram(v.ir, { forceElk: true })
  const elkVerify = await verifyDiagram(v.ir, elk, { forceElk: true })
  assert.equal(groupVerify.ok, false, 'fixture no longer exercises the regression — pick a different one')
  assert.equal(elkVerify.ok, false, 'fixture no longer exercises the regression — pick a different one')
  const groupFailing = groupVerify.checks.filter((c) => !c.ok).length
  const elkFailing = elkVerify.checks.filter((c) => !c.ok).length
  assert.ok(elkFailing <= groupFailing, 'fixture should make elk the better-or-equal of two failing candidates')

  const best = await renderCheckedBest(v.ir)
  assert.equal(best.checksOk, false)
  assert.equal(best.layoutMode, 'elk')
  assert.equal(best.checks.filter((c) => !c.ok).length, elkFailing)
})

test('renderCheckedBest: a plain (non-grouped) IR renders once via elk, same as renderChecked always did', async () => {
  assert.equal(groupLayerMode(ir('simple.yaml')), 'off')
  const best = await renderCheckedBest(ir('simple.yaml'))
  assert.equal(best.layoutMode, 'elk')
  assert.equal(best.checksOk, true)
})

// --- severities: budgets are guidance (warn), geometry decides (fail) --------
//
// The four budget rows (#10 node-count, #11 edge-count, #21 group-count,
// #22 label-length) are `warn` severity: a figure whose only findings are
// budget overruns still passes, renders, and carries data-warn. Every other
// row is `fail` and still blocks the figure.

test('severity: exactly the four budget rows are warn, every other row is fail', async () => {
  const r = await verifyDiagram(baseIr(), baseRenderResult())
  const warnIds = r.checks.filter((c) => c.severity === 'warn').map((c) => c.id)
  assert.deepEqual(warnIds, [10, 11, 21, 22])
  assert.ok(r.checks.every((c) => c.severity === 'fail' || c.severity === 'warn'))
  assert.deepEqual(r.failures, [])
  assert.deepEqual(r.warnings, [])
})

test('an 11-node IR with passing geometry verifies ok with a budget:nodes warning and renders with data-warn', async () => {
  const parsedIr = ir('budget.yaml')
  assert.equal(parsedIr.nodes.length, 11)
  const out = await renderDiagram(parsedIr)
  const r = await verifyDiagram(parsedIr, out)
  assert.equal(r.ok, true)
  assert.deepEqual(r.failures, [])
  assert.equal(r.warnings.length, 1)
  assert.equal(r.warnings[0].id, 10)
  assert.equal(r.warnings[0].name, 'node-count')
  assert.equal(r.warnings[0].key, 'budget:nodes')
  assert.equal(r.warnings[0].value, 11)
  assert.match(r.warnings[0].hint, /split/)
  assert.equal(byId(r.checks, 10).ok, false)
  assert.equal(byId(r.checks, 10).severity, 'warn')
  assert.equal(formatBudgetWarnings(r.warnings), 'budget:nodes=11')

  const fig = await renderFigureHtmlChecked(parsedIr, { rawYaml: fixture('budget.yaml') })
  assert.equal(fig.checksOk, true)
  assert.equal(fig.warn, 'budget:nodes=11')
  assert.match(fig.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=11">/)
  assert.match(fig.html, /<svg /)
})

test('an in-budget figure carries no data-warn attribute at all', async () => {
  const fig = await renderFigureHtmlChecked(ir('simple.yaml'), { rawYaml: fixture('simple.yaml') })
  assert.equal(fig.warn, '')
  assert.deepEqual(fig.warnings, [])
  assert.ok(!fig.html.includes('data-warn'))
})

test('a geometry failure still fails even when the IR is also over budget (warnings are reported alongside failures)', async () => {
  const parsedIr = ir('budget.yaml')
  const out = await renderDiagram(parsedIr)
  // mutate the first edge into a diagonal so row #1 (orthogonal, fail severity) trips
  const geo = out.layout.geo
  const e0 = geo.edges[0]
  const sec = e0.sections[0]
  const bent = { ...out, layout: { ...out.layout, geo: { ...geo, edges: [{ ...e0, sections: [[sec[0], { x: sec[sec.length - 1].x + 4, y: sec[sec.length - 1].y + 4 }]] }, ...geo.edges.slice(1)] } } }
  const r = await verifyDiagram(parsedIr, bent)
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((c) => c.id === 1 && c.name === 'orthogonal'))
  assert.ok(r.failures.every((c) => c.severity === 'fail'))
  assert.deepEqual(r.warnings.map((w) => w.key), ['budget:nodes'])
})

test('group-count (#21) and label-length (#22) warn from the IR alone, in stable data-warn order', async () => {
  const groups = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, label: `G${i}` }))
  const edges = [{ from: 'a', to: 'b', kind: 'sync', label: 'this edge label is long', from_side: undefined, to_side: undefined, via: [], label_at: undefined }]
  const r = await verifyDiagram(baseIr({ groups, edges }), baseRenderResult())
  assert.equal(r.ok, true)
  assert.equal(byId(r.checks, 21).ok, false)
  assert.equal(byId(r.checks, 22).ok, false)
  assert.deepEqual(r.warnings.map((w) => w.key), ['budget:groups', 'budget:label'])
  assert.equal(formatBudgetWarnings(r.warnings), 'budget:groups=5;budget:label=23')
})

test('renderCheckedBest on an over-budget auto-mode IR returns a zero-failure candidate and keeps its warnings', async () => {
  // groups.yaml qualifies for grouped-layer auto mode; pad it past the node
  // budget with isolated nodes (no new edges, so the geometry stays clean).
  const raw = parseYaml(fixture('groups.yaml'))
  const firstGroup = raw.groups[0].id
  const extra = Array.from({ length: 10 - raw.nodes.length }, (_, i) => ({ id: `pad${i}`, label: `P${i}`, group: firstGroup }))
  const v = validateIR({ ...raw, nodes: [...raw.nodes, ...extra] })
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(v.ir.nodes.length, 10)
  assert.equal(groupLayerMode(v.ir), 'auto')
  const best = await renderCheckedBest(v.ir)
  assert.ok(['group', 'elk'].includes(best.layoutMode))
  assert.equal(best.checksOk, true, JSON.stringify(best.failures))
  assert.deepEqual(best.failures, [])
  assert.deepEqual(best.warnings.map((w) => w.key), ['budget:nodes'])
  assert.equal(best.warn, 'budget:nodes=10')
})

// --- renderCheckedBest: a pinned orientation that can only scroll yields ---
//
// Two figures from a real page (acl-overview.yaml / acl-internals.yaml: 4-6
// nodes in 3 groups, `direction: right` pinned by a 1:1 Mermaid `flowchart
// LR` migration) rendered as 1908px / 1972px-wide SVGs that passed every
// check (`data-checks="pass" data-scroll="true"`) while a reader saw only
// their left third. Even with the "right" spacing triple-booking fixed
// (diagram.test.mjs), their node and edge labels don't fit side by side in
// a 720px column, so renderCheckedBest() now retries the other orientation
// when a pinned one falls back to scroll, and ranks "no scroll" right after
// "zero failures".

/** The on-page width the <svg> will occupy (its width attribute). */
function svgDisplayWidth(svg) {
  const m = /<svg\b[^>]*\bwidth="([^"]+)"/.exec(svg)
  assert.ok(m, 'svg root is missing a width attribute')
  return Number(m[1])
}

for (const name of ['acl-overview.yaml', 'acl-internals.yaml']) {
  test(`renderCheckedBest: ${name} (pinned right, 3 groups) shows whole in the column — no scroll, every check passing`, async () => {
    const parsedIr = ir(name)
    assert.equal(parsedIr.direction, 'right')
    const best = await renderCheckedBest(parsedIr)
    assert.equal(best.checksOk, true, `failures: ${JSON.stringify(best.failures)}`)
    assert.equal(best.scroll, false, `${name} still scrolls at ${best.width}px`)
    assert.ok(best.width <= COLUMN || (best.scaled && COLUMN / best.width >= MIN_SCALE), `${name}: ${best.width}px neither fits ${COLUMN}px nor scales within ${MIN_SCALE}`)
    assert.ok(svgDisplayWidth(best.svg) <= COLUMN)
    assert.equal(best.layout.direction, 'down')
    const html = (await renderFigureHtmlChecked(parsedIr, { rawYaml: fixture(name) })).html
    const figureTag = /^<figure[^>]*>/.exec(html)[0]
    assert.match(figureTag, /^<figure class="wu-figure" data-checks="pass"/)
    // The fixture's own YAML comment quotes the old `data-scroll="true"`, so
    // only the <figure> opening tag is inspected, not the embedded IR text.
    assert.doesNotMatch(figureTag, /data-scroll/)
  })
}

test('renderCheckedBest: a pinned orientation that merely scales (>= MIN_SCALE) is honored, not flipped (wide.yaml)', async () => {
  const best = await renderCheckedBest(ir('wide.yaml'))
  assert.equal(best.layout.direction, 'right')
  assert.equal(best.scaled, true)
  assert.equal(best.scroll, false)
  assert.equal(best.width, 900)
})

test('renderCheckedBest: a pinned orientation that would scroll yields to the other one when that shows whole (scroll.yaml)', async () => {
  // renderDiagram() itself still honors the pin (see diagram.test.mjs's
  // scroll-threshold tests, which are what scroll.yaml exists for); only
  // the verified "try, verify, pick" path retries the other orientation.
  const pinned = await renderDiagram(ir('scroll.yaml'))
  assert.equal(pinned.scroll, true)
  const best = await renderCheckedBest(ir('scroll.yaml'))
  assert.equal(best.layout.direction, 'down')
  assert.equal(best.scroll, false)
  assert.ok(best.width <= COLUMN)
  assert.equal(best.checksOk, true)
})

test('renderCheckedBest: when both orientations of a pinned IR scroll, the pinned one is kept', async () => {
  // A 6-node wide chain (scrolls laid out "right") whose head also fans out
  // to 7 wide siblings (a row too wide for the column laid out "down").
  const wide = (i) => ({ id: `n${i}`, label: `XXXXXXXXXX${i}` })
  const raw = {
    id: 'both', title: 't', direction: 'right',
    nodes: [...Array.from({ length: 6 }, (_, i) => wide(i)), ...Array.from({ length: 7 }, (_, i) => wide(10 + i))],
    edges: [
      ...Array.from({ length: 5 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, kind: 'sync' })),
      ...Array.from({ length: 7 }, (_, i) => ({ from: 'n0', to: `n${10 + i}`, kind: 'sync' })),
    ],
  }
  const v = validateIR(raw)
  assert.ok(v.ok, JSON.stringify(v))
  const down = await renderDiagram({ ...v.ir, direction: 'down' })
  assert.equal(down.scroll, true, 'this fixture only demonstrates the tie if "down" scrolls too')
  const best = await renderCheckedBest(v.ir)
  assert.equal(best.layout.direction, 'right')
  assert.equal(best.scroll, true)
})

test('renderCheckedBest: the existing fixtures keep the size and mode they rendered at before the scroll ranking', async () => {
  const expected = {
    'simple.yaml': { mode: 'elk', direction: 'down', width: 276, height: 320 },
    'groups.yaml': { mode: 'group', direction: 'right', width: 360, height: 284 },
    'conway.yaml': { mode: 'group', direction: 'right', width: 384, height: 472 },
    'hints.yaml': { mode: 'elk', direction: 'right', width: 536, height: 104 },
    'budget.yaml': { mode: 'elk', direction: 'right', width: 336, height: 660 },
    'wide.yaml': { mode: 'elk', direction: 'right', width: 900, height: 104 },
    'samples-figure.yaml': { mode: 'elk', direction: 'down', width: 184, height: 320 },
    'chain-long-labels.yaml': { mode: 'elk', direction: 'down', width: 348, height: 428 },
  }
  for (const [name, dims] of Object.entries(expected)) {
    const best = await renderCheckedBest(ir(name))
    assert.equal(best.layoutMode, dims.mode, `${name}: layout mode changed`)
    assert.equal(best.layout.direction, dims.direction, `${name}: orientation changed`)
    assert.equal(best.width, dims.width, `${name}: width changed`)
    assert.equal(best.height, dims.height, `${name}: height changed`)
    assert.equal(best.scroll, false)
  }
})

// --- renderCheckedBest: the "down" grouped figures keep their tightened size
//
// With hand-placed labels extended to elk's compound-node hierarchy (see
// the "down layer gaps with groups" tests in diagram.test.mjs), the two ACL
// figures shrank from 532x936 / 384x972 (152px between group boxes) to
// 404x748 / 320x812 (74px). Pinned so a spacing regression shows up as a
// number, not as a screenshot.
test('renderCheckedBest: acl-overview.yaml / acl-internals.yaml keep their tightened "down" size', async () => {
  // 404x748 / 320x812 -> 432x612 / 320x688 once the group boxes stopped
  // carrying elk's phantom bottom band (see diagram.test.mjs's "group
  // padding" tests); the extra 28px of width is the loop-around label
  // now sitting beside its run instead of astride it.
  const expected = {
    'acl-overview.yaml': { mode: 'elk', direction: 'down', width: 432, height: 612 },
    'acl-internals.yaml': { mode: 'elk', direction: 'down', width: 320, height: 688 },
  }
  for (const [name, dims] of Object.entries(expected)) {
    const best = await renderCheckedBest(ir(name))
    assert.equal(best.layoutMode, dims.mode, `${name}: layout mode changed`)
    assert.equal(best.layout.direction, dims.direction, `${name}: orientation changed`)
    assert.equal(best.width, dims.width, `${name}: width changed`)
    assert.equal(best.height, dims.height, `${name}: height changed`)
    assert.equal(best.scroll, false)
    assert.equal(best.checksOk, true, JSON.stringify(best.failures))
  }
})

test('row #2 label-clearance and the renderer\'s own manual-label placement share one 6px floor', () => {
  assert.equal(LABEL_CLEARANCE, 6)
})

// --- grilling's round-diagram.md figures, and one path for CLI + page builder
//
// grilling's html.mjs hands each round diagram to renderFigureHtmlChecked();
// bin/render-diagram.mjs --json goes through renderCheckedBest(). Both must
// report the same verdict for the same IR — they share the candidate
// selection, and these tests keep it that way for every flowchart fixture.

const FLOWCHART_FIXTURES = ['simple.yaml', 'groups.yaml', 'hints.yaml', 'wide.yaml', 'scroll.yaml', 'conway.yaml', 'budget.yaml', 'samples-figure.yaml', 'chain-long-labels.yaml', 'acl-overview.yaml', 'acl-internals.yaml', 'browser-server.yaml', 'two-workspaces.yaml']

test('renderFigureHtmlChecked and renderCheckedBest agree on mode, orientation, size and verdict for every fixture', async () => {
  for (const name of FLOWCHART_FIXTURES) {
    const parsed = ir(name)
    const best = await renderCheckedBest(parsed)
    const figure = await renderFigureHtmlChecked(parsed, { rawYaml: fixture(name) })
    const summary = (r) => ({ ok: r.checksOk, mode: r.layoutMode, direction: r.layout.direction, width: r.width, height: r.height, scroll: r.scroll, failures: r.failures.map((f) => f.name), warn: r.warn })
    assert.deepEqual(summary(figure), summary(best), `${name}: the two paths disagree`)
    assert.equal(figure.html.includes('data-checks="pass"'), best.checksOk, `${name}: data-checks stamp disagrees with the verdict`)
  }
})

test('browser-server.yaml / two-workspaces.yaml (grilling round-diagram.md figures) pass every geometry check through both paths', async () => {
  for (const [name, warn] of [['browser-server.yaml', ''], ['two-workspaces.yaml', 'budget:nodes=10']]) {
    const parsed = ir(name)
    const figure = await renderFigureHtmlChecked(parsed, { rawYaml: fixture(name) })
    assert.equal(figure.checksOk, true, `${name}: ${JSON.stringify(figure.failures)}`)
    assert.equal(figure.warn, warn, name)
    assert.match(figure.html, warn ? new RegExp(`^<figure class="wu-figure" data-checks="pass" data-warn="${warn}">`) : /^<figure class="wu-figure" data-checks="pass">/)
    assert.equal(figure.scroll, false, name)
  }
})
