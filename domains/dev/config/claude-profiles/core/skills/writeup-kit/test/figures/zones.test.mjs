// `type: zones` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/zones-*.yaml (one per variant).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as zones from '../../bin/lib/figures/zones.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const VARIANTS = ['high-level', 'it-state', 'integration', 'deployment']
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const runCli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })

const minimal = () => ({
  id: 'z', type: 'zones', title: 't',
  zones: [
    { id: 'a', label: 'A', nodes: [{ id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2', kind: 'store' }] },
    { id: 'b', label: 'B', tone: 'rs', nodes: [{ id: 'b1', label: 'B1', emphasis: true }] },
  ],
  edges: [{ from: 'a1', to: 'b1', label: 'x' }, { from: 'a1', to: 'a2', kind: 'async' }],
})

async function rendered(name) {
  const ir = validIr(name)
  const out = await renderFigure(zones, ir)
  return { ir, out, geo: out.layout.geo }
}

// --- schema ---------------------------------------------------------------

describe('zones: schema', () => {
  test('a minimal valid IR normalizes with defaults: variant high-level, layout rows, kind service, edge kind sync', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'zones')
    assert.equal(r.ir.variant, 'high-level')
    assert.equal(r.ir.layout, 'rows')
    assert.deepEqual(r.ir.zones[0].nodes[0], { id: 'a1', label: 'A1', kind: 'service', emphasis: false, tone: 'neutral' })
    assert.deepEqual(r.ir.edges, [{ from: 'a1', to: 'b1', label: 'x', kind: 'sync' }, { from: 'a1', to: 'a2', label: '', kind: 'async' }])
    assert.deepEqual(r.warnings, [])
  })

  test('every variant picks its default layout; an explicit layout wins', () => {
    const expected = { 'high-level': 'rows', 'it-state': 'columns', integration: 'columns', deployment: 'rows' }
    for (const [variant, layout] of Object.entries(expected)) {
      assert.equal(zones.normalize({ ...minimal(), variant }).layout, layout, variant)
    }
    assert.equal(zones.normalize({ ...minimal(), variant: 'it-state', layout: 'rows' }).layout, 'rows')
  })

  test('normalize is idempotent for every fixture', () => {
    for (const v of VARIANTS) {
      const once = zones.normalize(parseYaml(fixture(`zones-${v}.yaml`)))
      assert.deepEqual(zones.normalize(once), once, v)
    }
  })

  test('bad variant/layout/kind, duplicate ids, unknown edge endpoints and self edges are schema errors naming the path', () => {
    assert.match(validateIR({ ...minimal(), variant: 'c4' }).message, /^ir\.variant must be high-level\|it-state\|integration\|deployment/)
    assert.match(validateIR({ ...minimal(), layout: 'grid' }).message, /^ir\.layout must be rows\|columns/)
    const kind = minimal(); kind.zones[0].nodes[0].kind = 'db'
    assert.match(validateIR(kind).message, /^ir\.zones\[0\]\.nodes\[0\]\.kind must be service\|store\|external\|queue\|ui/)
    const dup = minimal(); dup.zones[1].nodes.push({ id: 'a1', label: 'again' })
    assert.match(validateIR(dup).message, /duplicate node id: "a1"/)
    const dupZone = minimal(); dupZone.zones[1].id = 'a'
    assert.match(validateIR(dupZone).message, /duplicate zone id: "a"/)
    assert.match(validateIR({ ...minimal(), edges: [{ from: 'a1', to: 'zz' }] }).message, /^ir\.edges\[0\]\.to references unknown node "zz"$/)
    assert.match(validateIR({ ...minimal(), edges: [{ from: 'a1', to: 'a1' }] }).message, /from and to must differ/)
    assert.match(validateIR({ ...minimal(), edges: [{ from: 'a1', to: 'b1', kind: 'call' }] }).message, /kind must be sync\|async\|reply/)
    assert.match(validateIR({ ...minimal(), zones: [] }).message, /^ir\.zones must be a non-empty list$/)
  })
})

// --- budgets ----------------------------------------------------------------

describe('zones: budgets are advisory warnings in a stable order', () => {
  test('over-budget zones/nodes/edges/label/emphasis warn in that order and reach data-warn', async () => {
    const raw = minimal()
    raw.zones = Array.from({ length: 6 }, (_, i) => ({
      id: `z${i}`, label: `Z${i}`,
      nodes: Array.from({ length: i < 3 ? 3 : 2 }, (_, j) => ({ id: `n${i}${j}`, label: `N${i}${j}`, emphasis: j === 0 })),
    }))
    raw.zones[0].nodes[0].label = 'とても長い部品の名前が十四文字を超える'
    raw.edges = Array.from({ length: 15 }, (_, i) => ({ from: `n${i % 5}0`, to: `n${(i % 5) + 1}0` }))
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:zones=6', 'budget:nodes=15', 'budget:edges=15', 'budget:label=19', 'budget:emphasis=6'])
    assert.match(r.warnings[3].hint, /shorten the label of node "n00"/)
    assert.deepEqual(zones.budgetWarnings(r.ir), r.warnings)
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:zones=6;budget:nodes=15;budget:edges=15;budget:label=19;budget:emphasis=6')
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /data-warn="budget:zones=6;budget:nodes=15;budget:edges=15;budget:label=19;budget:emphasis=6"/)
  })

  test('within budget: no warnings for any fixture', () => {
    for (const v of VARIANTS) assert.deepEqual(zones.budgetWarnings(validIr(`zones-${v}.yaml`)), [], v)
  })
})

// --- layout -------------------------------------------------------------------

describe('zones: layout', () => {
  test('rows: zones are full-column bands stacked top to bottom, equal width; nodes in a row after the label column', async () => {
    const { geo, out } = await rendered('zones-high-level.yaml')
    assert.equal(geo.layout, 'rows')
    assert.equal(geo.zones.length, 3)
    assert.equal(out.width, 720)
    const widths = new Set(geo.zones.map((z) => z.width))
    assert.equal(widths.size, 1)
    for (let i = 1; i < geo.zones.length; i++) assert.ok(geo.zones[i].y >= geo.zones[i - 1].y + geo.zones[i - 1].height + 40, 'gutter ≥ 40')
    const app = geo.nodes.filter((n) => n.zone === 'app')
    assert.deepEqual(app.map((n) => n.id), ['search', 'indexer', 'queue'])
    assert.ok(app.every((n) => n.y === app[0].y), 'one row')
    assert.ok(app[0].x + app[0].width < app[1].x && app[1].x + app[1].width < app[2].x, 'left to right')
    const zone = geo.zones.find((z) => z.id === 'app')
    assert.ok(app[0].x >= zone.labelBox.x + zone.labelBox.width, 'past the label column')
  })

  test('columns: zones are equal columns left to right; nodes stacked top to bottom below the header', async () => {
    const { geo } = await rendered('zones-it-state.yaml')
    assert.equal(geo.layout, 'columns')
    const heights = new Set(geo.zones.map((z) => z.height))
    const widths = new Set(geo.zones.map((z) => z.width))
    assert.equal(heights.size, 1)
    assert.equal(widths.size, 1)
    for (let i = 1; i < geo.zones.length; i++) assert.ok(geo.zones[i].x >= geo.zones[i - 1].x + geo.zones[i - 1].width + 40)
    const prod = geo.nodes.filter((n) => n.zone === 'prod')
    assert.ok(prod.every((n) => n.x === prod[0].x), 'one column')
    assert.ok(prod[0].y + prod[0].height < prod[1].y && prod[1].y + prod[1].height < prod[2].y, 'top to bottom')
    assert.ok(prod[0].y >= geo.zones[0].labelBox.y + geo.zones[0].labelBox.height, 'below the header')
  })

  test('node kinds and emphasis reach the svg as glyphs: store double line, queue dashed side, external dashed border, ui title bar, wu-focal', async () => {
    const { out } = await rendered('zones-deployment.yaml')
    assert.match(out.svg, /id="wu-d-zdep-n-pg-glyph"[^>]*y1="\d+" x2/)
    assert.match(out.svg, /id="wu-d-zdep-n-mq-glyph"[^>]*stroke-dasharray="3 3"/)
    assert.match(out.svg, /id="wu-d-zdep-n-mail"[^>]*stroke-dasharray="5 4"/)
    assert.match(out.svg, /id="wu-d-zdep-n-web-glyph"/)
    assert.match(out.svg, /id="wu-d-zdep-n-api" class="wu-focal"/)
    assert.match(out.svg, /id="wu-d-zdep-z-managed" data-tone="ts"[^>]*stroke-dasharray="6 4"/, 'deployment zones are dashed')
    const hl = await rendered('zones-high-level.yaml')
    assert.doesNotMatch(hl.out.svg, /id="wu-d-zhl-z-edge"[^>]*stroke-dasharray/)
  })

  test('edges: every segment orthogonal, a Z through the gutter when ends differ, a loop for non-adjacent same-zone nodes, straight for adjacent', async () => {
    const { geo } = await rendered('zones-it-state.yaml')
    const byId = new Map(geo.nodes.map((n) => [n.id, n]))
    for (const e of geo.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const p = e.points[i - 1], q = e.points[i]
        assert.ok(p.x === q.x || p.y === q.y, `edge ${e.index} orthogonal`)
      }
    }
    const loop = geo.edges.find((e) => e.from === 'crm' && e.to === 'proddb')
    assert.equal(loop.cls, 'loop')
    assert.equal(loop.points.length, 4)
    const crm = byId.get('crm')
    assert.ok(loop.points[1].x > crm.x + crm.width, 'loops through the gutter after the zone')
    const adjacent = geo.edges.find((e) => e.from === 'erp' && e.to === 'proddb')
    assert.equal(adjacent.points.length, 2)
    const z = geo.edges.find((e) => e.from === 'proddb' && e.to === 'sftp')
    assert.equal(z.points.length, 4)
    assert.equal(z.points[1].x, z.points[2].x)
  })

  test('edge kinds: sync solid arrow, async open arrow, reply dashed; legend only when ≥ 2 kinds are used', async () => {
    const { out } = await rendered('zones-integration.yaml')
    assert.match(out.svg, /id="wu-d-zint-e-0"[^>]*marker-end="url\(#wu-d-zint-solid\)"/)
    assert.match(out.svg, /id="wu-d-zint-e-2"[^>]*marker-end="url\(#wu-d-zint-open\)"/)
    assert.match(out.svg, /id="wu-d-zint-e-8"[^>]*stroke-dasharray="5 4"[^>]*marker-end="url\(#wu-d-zint-open\)"/)
    assert.ok(out.layout.legend)
    assert.deepEqual(out.layout.legend.items.map((i) => i.label), ['sync', 'async', 'reply'])
    const only = zones.normalize({ ...minimal(), edges: [{ from: 'a1', to: 'b1' }] })
    assert.equal((await zones.layout(only)).legend, undefined)
  })

  test('layout is deterministic: same IR → byte-identical svg and deep-equal geometry', async () => {
    for (const v of VARIANTS) {
      const ir = validIr(`zones-${v}.yaml`)
      const a = await renderFigure(zones, ir)
      const b = await renderFigure(zones, ir)
      assert.equal(a.svg, b.svg, v)
      assert.deepEqual(a.layout, b.layout, v)
    }
  })
})

// --- verify rows ----------------------------------------------------------------

describe('zones: verify rows', () => {
  test('a real render of every fixture passes every row; rows 1–5 warn, 6–11 fail; shared rows follow', async () => {
    for (const v of VARIANTS) {
      const { ir, out } = await rendered(`zones-${v}.yaml`)
      const result = await verifyFigure(zones, ir, out)
      assert.deepEqual(result.checks.filter((c) => !c.ok), [], v)
      assert.equal(result.ok, true)
      assert.deepEqual(result.checks.slice(0, 11).map((c) => c.severity), ['warn', 'warn', 'warn', 'warn', 'warn', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
      assert.deepEqual(result.checks.slice(0, 11).map((c) => c.name), zones.doc.rows)
      assert.equal(result.checks.length, 11 + 7)
    }
  })

  test('edge-refs fails when a drawn edge points at a node that is not drawn', async () => {
    const { ir, out } = await rendered('zones-high-level.yaml')
    const bad = structuredClone(out)
    bad.layout.geo.edges[0].to = 'ghost'
    const result = await verifyFigure(zones, ir, bad)
    assert.equal(byName(result.checks, 'edge-refs').ok, false)
    assert.match(byName(result.checks, 'edge-refs').detail, /edge 0 to unknown node "ghost"/)
    assert.equal(result.ok, false)
  })

  test('nodes-inside-zone fails when a node is pushed out of its zone or onto the zone label', async () => {
    const { ir, out } = await rendered('zones-high-level.yaml')
    const outside = structuredClone(out)
    outside.layout.geo.nodes.find((n) => n.id === 'cdn').y -= 24
    let result = await verifyFigure(zones, ir, outside)
    assert.match(byName(result.checks, 'nodes-inside-zone').detail, /"cdn" is not ≥ 8px inside zone "edge"/)
    const onLabel = structuredClone(out)
    onLabel.layout.geo.nodes.find((n) => n.id === 'cdn').x -= 60
    result = await verifyFigure(zones, ir, onLabel)
    assert.match(byName(result.checks, 'nodes-inside-zone').detail, /"cdn" covers the label of zone "edge"/)
  })

  test('zones-disjoint fails when two zones overlap or leave IR order', async () => {
    const { ir, out } = await rendered('zones-it-state.yaml')
    const bad = structuredClone(out)
    bad.layout.geo.zones[1].x = bad.layout.geo.zones[0].x + 20
    const result = await verifyFigure(zones, ir, bad)
    assert.equal(byName(result.checks, 'zones-disjoint').ok, false)
    assert.match(byName(result.checks, 'zones-disjoint').detail, /zone "prod" overlaps "batch"/)
  })

  test('edges-orthogonal fails on a diagonal segment or an endpoint off the node border', async () => {
    const { ir, out } = await rendered('zones-deployment.yaml')
    const diag = structuredClone(out)
    diag.layout.geo.edges[2].points[1].x += 8
    let result = await verifyFigure(zones, ir, diag)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /diagonal/)
    const off = structuredClone(out)
    off.layout.geo.edges[0].points[0].x += 4 // slides off lb's right border into the gap
    result = await verifyFigure(zones, ir, off)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /does not start on the border of "lb"/)
  })

  test('edge-clearance fails when an edge is re-routed straight through another node', async () => {
    const { ir, out } = await rendered('zones-high-level.yaml')
    const bad = structuredClone(out)
    const nodes = bad.layout.geo.nodes
    const cdn = nodes.find((n) => n.id === 'cdn')
    const queue = nodes.find((n) => n.id === 'queue')
    const y = cdn.y + 20
    const e = bad.layout.geo.edges[0] // cdn → gw, now drawn straight through gw and beyond
    e.points = [{ x: cdn.x + cdn.width, y }, { x: queue.x + queue.width, y }, { x: queue.x + queue.width, y: queue.y + queue.height }]
    e.to = 'queue'
    const result = await verifyFigure(zones, ir, bad)
    assert.equal(byName(result.checks, 'edges-orthogonal').ok, true)
    assert.equal(byName(result.checks, 'edge-clearance').ok, false)
    assert.match(byName(result.checks, 'edge-clearance').detail, /edge 0 \("cdn"→"queue"\) runs through "gw"/)
  })

  test('labels-clear fails when a label is moved onto a node or onto another label', async () => {
    const { ir, out } = await rendered('zones-integration.yaml')
    const bad = structuredClone(out)
    const labelled = bad.layout.geo.edges.filter((e) => e.labelBox)
    const ingest = bad.layout.geo.nodes.find((n) => n.id === 'ingest')
    labelled[0].labelBox.x = ingest.x + 8
    labelled[0].labelBox.y = ingest.y + 8
    labelled[1].labelBox.x = labelled[2].labelBox.x
    labelled[1].labelBox.y = labelled[2].labelBox.y
    const result = await verifyFigure(zones, ir, bad)
    assert.equal(byName(result.checks, 'labels-clear').ok, false)
    assert.match(byName(result.checks, 'labels-clear').detail, /overlaps "ingest"/)
    assert.match(byName(result.checks, 'labels-clear').detail, /labels of edges \d+ and \d+ overlap/)
  })

  test('emphasis-count warns (ok stays true overall) when 3 nodes are emphasized', async () => {
    const raw = minimal()
    raw.zones[0].nodes.forEach((n) => { n.emphasis = true })
    const ir = validateIR(raw).ir
    const out = await renderFigure(zones, ir)
    const result = await verifyFigure(zones, ir, out)
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis=3'])
  })
})

// --- registry + CLI -----------------------------------------------------------------

describe('zones: registry dispatch and CLI', () => {
  test('the registry knows zones with its limits and rows; the doc example renders clean', async () => {
    const t = getFigureType('zones')
    assert.deepEqual(t.limits, { maxZones: 5, maxNodes: 12, maxEdges: 14, maxLabelLen: 14, maxEmphasis: 2 })
    assert.deepEqual(t.doc.rows, zones.doc.rows)
    const r = validateIR(parseYaml(t.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.warnings, [])
    assert.equal(r.ir.variant, 'high-level')
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /^<figure class="wu-figure" data-checks="pass" data-type="zones">/)
  })

  test('renderFigureHtmlChecked passes every fixture with data-type="zones", embeds the IR and never scrolls', async () => {
    for (const v of VARIANTS) {
      const ir = validIr(`zones-${v}.yaml`)
      const html = await renderFigureHtmlChecked(ir, { rawYaml: fixture(`zones-${v}.yaml`) })
      assert.equal(html.checksOk, true, `${v}: ${JSON.stringify(html.failures)}`)
      assert.match(html.html, /data-checks="pass" data-type="zones"/)
      assert.doesNotMatch(html.html, /data-scroll/)
      assert.match(html.html, /type: zones/)
    }
  })

  test('CLI: --figure exits 0 with a passing figure for every fixture; --json carries figureHtml', () => {
    for (const v of VARIANTS) {
      const ok = runCli([join(FIXTURES, `zones-${v}.yaml`), '--figure'])
      assert.equal(ok.status, 0, ok.stderr)
      assert.match(ok.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="zones">/)
    }
    const j = JSON.parse(runCli([join(FIXTURES, 'zones-integration.yaml'), '--json']).stdout)
    assert.ok(j.figureHtml)
    assert.equal(j.ok, true)
    assert.equal(j.warn, null)
  })
})
