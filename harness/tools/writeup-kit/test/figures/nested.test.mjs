// `type: nested` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/nested-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as nested from '../../bin/lib/figures/nested.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const runCli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })

const box = (id, label, extra = {}) => ({ id, label, ...extra })
const minimal = () => ({
  id: 'n', type: 'nested', title: 't',
  root: box('r', 'R', { children: [box('a', 'A'), box('b', 'B', { children: [box('b1', 'B1', { tone: 'rs' })] })] }),
  edges: [{ from: 'a', to: 'b', label: 'x' }],
})

async function rendered(name) {
  const ir = validIr(name)
  const out = await renderFigure(nested, ir)
  return { ir, out, geo: out.layout.geo }
}

// --- schema ---------------------------------------------------------------

describe('nested: schema', () => {
  test('a minimal valid IR normalizes with direction auto, children [] on leaves, edges kept', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'nested')
    assert.equal(r.ir.direction, 'auto')
    assert.deepEqual(r.ir.root.children[0], { id: 'a', label: 'A', tone: 'neutral', emphasis: false, children: [] })
    assert.deepEqual(r.ir.edges, [{ from: 'a', to: 'b', label: 'x' }])
    assert.deepEqual(r.warnings, [])
  })

  test('normalize is idempotent', () => {
    const once = nested.normalize(parseYaml(fixture('nested-deep.yaml')))
    assert.deepEqual(nested.normalize(once), once)
    const twice = nested.normalize(nested.normalize(minimal()))
    assert.deepEqual(twice, nested.normalize(minimal()))
  })

  test('4 and 5 levels validate clean, 6 warns budget:depth, 7 is a schema error naming the path', () => {
    const chain = (n) => {
      let inner = box(`l${n}`, `L${n}`)
      for (let i = n - 1; i >= 2; i--) inner = box(`l${i}`, `L${i}`, { children: [inner] })
      return { ...minimal(), root: box('r', 'R', { children: [inner] }), edges: [] }
    }
    for (const n of [4, 5]) {
      const r = validateIR(chain(n))
      assert.equal(r.ok, true, `${n} levels: ${JSON.stringify(r)}`)
      assert.deepEqual(r.warnings, [], `${n} levels`)
    }
    const six = validateIR(chain(6))
    assert.equal(six.ok, true)
    assert.deepEqual(six.warnings.map((w) => `${w.key}=${w.value}`), ['budget:depth=6'])
    assert.match(six.warnings[0].hint, /collapse the innermost level/)
    const seven = validateIR(chain(7))
    assert.equal(seven.ok, false)
    assert.equal(seven.reason, 'schema')
    assert.match(seven.message, /^ir\.root\.children\[0\](\.children\[0\]){5}: nesting exceeds 6 levels$/)
  })

  test('2 levels validate with a budget:depth warning (the nesting carries no structure yet)', () => {
    const r = validateIR({ ...minimal(), root: box('r', 'R', { children: [box('a', 'A'), box('b', 'B')] }) })
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:depth=2'])
    assert.match(r.warnings[0].hint, /use a diagram with a group/)
  })

  test('duplicate ids, unknown edge endpoints, self edges and ancestor edges are rejected', () => {
    const dup = validateIR({ ...minimal(), root: box('r', 'R', { children: [box('a', 'A'), box('a', 'A2')] }), edges: [] })
    assert.match(dup.message, /duplicate box id: "a"/)
    const unknown = validateIR({ ...minimal(), edges: [{ from: 'a', to: 'zz' }] })
    assert.match(unknown.message, /^ir\.edges\[0\]\.to references unknown box "zz"$/)
    const self = validateIR({ ...minimal(), edges: [{ from: 'a', to: 'a' }] })
    assert.match(self.message, /from and to must differ/)
    const contain = validateIR({ ...minimal(), edges: [{ from: 'r', to: 'a' }] })
    assert.match(contain.message, /contain one another/)
    const dir = validateIR({ ...minimal(), direction: 'up' })
    assert.match(dir.message, /direction must be auto\|down\|right/)
  })
})

// --- budgets ----------------------------------------------------------------

describe('nested: budgets are advisory warnings in a stable order', () => {
  test('13 boxes validate with a budget:boxes warning that reaches data-warn', async () => {
    const r = validateIR(parseYaml(fixture('nested-over-boxes.yaml')))
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:boxes=13'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:boxes=13')
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /data-checks="pass"/)
    assert.match(html.html, /data-warn="budget:boxes=13"/)
  })

  test('a label over 14 chars warns naming the box; 3 emphasized boxes warn; order is boxes → edges → label → depth → emphasis → emphasis-outer', () => {
    const raw = minimal()
    raw.root.children[0].label = 'とても長い部品の名前が十四文字を超える'
    raw.root.children[0].emphasis = true
    raw.root.children[1].emphasis = true
    raw.root.emphasis = true
    raw.edges = Array.from({ length: 7 }, () => ({ from: 'a', to: 'b' }))
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => w.key), ['budget:edges', 'budget:label', 'budget:emphasis', 'budget:emphasis-outer'])
    assert.match(r.warnings[1].hint, /shorten label of box "a"/)
    assert.equal(r.warnings[2].value, 3)
    assert.equal(r.warnings[3].value, 2)
    assert.match(r.warnings[3].detail, /"r", "b"/)
    assert.deepEqual(nested.budgetWarnings(r.ir), r.warnings)
  })

  test('2 emphasized boxes exceed the accent budget of 1; one emphasized container warns emphasis-outer alone', () => {
    const two = minimal()
    two.root.children[0].emphasis = true
    two.root.children[1].children[0].emphasis = true
    assert.deepEqual(validateIR(two).warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis=2'])
    const outer = minimal()
    outer.root.children[1].emphasis = true
    const r = validateIR(outer)
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis-outer=1'])
    assert.match(r.warnings[0].hint, /move emphasis to the leaf/)
  })
})

// --- layout -------------------------------------------------------------------

describe('nested: layout', () => {
  test('nested-deep: 9 boxes, 3 levels, children inside parents below the title band, siblings in a row', async () => {
    const { geo } = await rendered('nested-deep.yaml')
    assert.equal(geo.boxes.length, 9)
    assert.deepEqual([...new Set(geo.boxes.map((b) => b.level))].sort(), [1, 2, 3])
    const byId = new Map(geo.boxes.map((b) => [b.id, b]))
    for (const b of geo.boxes) {
      if (!b.parent) continue
      const p = byId.get(b.parent)
      assert.ok(b.x >= p.x + 8 && b.x + b.width <= p.x + p.width - 8, `${b.id} inside ${p.id} horizontally`)
      assert.ok(b.y >= p.y + 36 && b.y + b.height <= p.y + p.height - 8, `${b.id} below ${p.id}'s title band`)
      for (const [k, v] of Object.entries(b)) if (['x', 'y'].includes(k)) assert.equal(v % 4, 0, `${b.id}.${k} on grid`)
    }
    const leaves = ['order-api', 'order-db', 'order-worker'].map((id) => byId.get(id))
    assert.ok(leaves.every((l) => l.y === leaves[0].y), 'three leaves share a row')
    assert.ok(leaves[0].x + leaves[0].width < leaves[1].x && leaves[1].x + leaves[1].width < leaves[2].x, 'left to right with a gap')
  })

  test('direction: down stacks children in a column of equal width; auto wraps 4+ children 2 per row', async () => {
    const down = nested.normalize({ ...minimal(), direction: 'down', edges: [] })
    const g = (await nested.layout(down)).geo
    const [a, b] = ['a', 'b'].map((id) => g.boxes.find((x) => x.id === id))
    assert.equal(a.x, b.x)
    assert.equal(a.width, b.width)
    assert.ok(b.y >= a.y + a.height + 16)
    const four = nested.normalize({ ...minimal(), edges: [], root: box('r', 'R', { children: ['a', 'b', 'c', 'd'].map((id) => box(id, id.toUpperCase())) }) })
    const g4 = (await nested.layout(four)).geo
    const rows = new Set(g4.boxes.filter((x) => x.parent).map((x) => x.y))
    assert.equal(rows.size, 2)
  })

  test('two detouring edges get separate lanes and never overlap; every edge is orthogonal and starts/ends on a border', async () => {
    const { geo } = await rendered('nested-deep.yaml')
    assert.equal(geo.edges.length, 2)
    assert.deepEqual(geo.edges.map((e) => e.channel), ['below', 'below'])
    assert.notEqual(geo.edges[0].points[1].y, geo.edges[1].points[1].y)
    for (const e of geo.edges) {
      for (let i = 0; i < e.points.length - 1; i++) {
        const p = e.points[i], q = e.points[i + 1]
        assert.ok(p.x === q.x || p.y === q.y, `edge ${e.index} segment ${i} orthogonal`)
      }
      assert.ok(e.labelBox && e.labelBox.text, 'edge label placed')
    }
  })

  test('layout is deterministic: same IR → byte-identical svg', async () => {
    const ir = validIr('nested-deep.yaml')
    const a = await renderFigure(nested, ir)
    const b = await renderFigure(nested, ir)
    assert.equal(a.svg, b.svg)
    assert.deepEqual(a.layout, b.layout)
  })
})

// --- verify rows ----------------------------------------------------------------

describe('nested: verify rows', () => {
  test('a real render of every fixture passes every row; rows 1–5 warn, 6–10 fail; shared rows follow', async () => {
    for (const name of ['nested-simple.yaml', 'nested-deep.yaml']) {
      const { ir, out } = await rendered(name)
      const result = await verifyFigure(nested, ir, out)
      assert.deepEqual(result.checks.filter((c) => !c.ok), [], name)
      assert.equal(result.ok, true)
      assert.deepEqual(result.checks.slice(0, 10).map((c) => c.severity), ['warn', 'warn', 'warn', 'warn', 'warn', 'fail', 'fail', 'fail', 'fail', 'fail'])
      assert.deepEqual(result.checks.slice(0, 10).map((c) => c.name), nested.doc.rows)
      assert.equal(result.checks.length, 10 + 7)
    }
  })

  test('a 5-level chain with an edge renders and passes every row without a warning', async () => {
    let inner = box('l5', 'L5', { emphasis: true })
    for (let i = 4; i >= 2; i--) inner = box(`l${i}`, `L${i}`, { children: [inner] })
    const raw = { ...minimal(), root: box('r', 'R', { children: [inner, box('peer', 'Peer')] }), edges: [{ from: 'l5', to: 'peer', label: '参照' }] }
    const ir = validateIR(raw).ir
    const out = await renderFigure(nested, ir)
    const result = await verifyFigure(nested, ir, out)
    assert.deepEqual(result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`), [])
    assert.deepEqual([...new Set(out.layout.geo.boxes.map((b) => b.level))].sort(), [1, 2, 3, 4, 5])
  })

  test('containment fails when a child is pushed outside its parent\'s padding', async () => {
    const { ir, out } = await rendered('nested-deep.yaml')
    const bad = structuredClone(out)
    bad.layout.geo.boxes.find((b) => b.id === 'order-api').x -= 16
    const result = await verifyFigure(nested, ir, bad)
    assert.equal(byName(result.checks, 'containment').ok, false)
    assert.match(byName(result.checks, 'containment').detail, /"order-api" is not ≥ 8px inside "order"/)
    assert.equal(result.ok, false)
  })

  test('sibling-overlap fails when two siblings are moved onto each other', async () => {
    const { ir, out } = await rendered('nested-deep.yaml')
    const bad = structuredClone(out)
    const db = bad.layout.geo.boxes.find((b) => b.id === 'order-db')
    const api = bad.layout.geo.boxes.find((b) => b.id === 'order-api')
    db.x = api.x + 8
    const result = await verifyFigure(nested, ir, bad)
    assert.equal(byName(result.checks, 'sibling-overlap').ok, false)
    assert.match(byName(result.checks, 'sibling-overlap').detail, /"order-api" overlaps "order-db"/)
  })

  test('title-band-clear fails when a child rises into its parent\'s title band', async () => {
    const { ir, out } = await rendered('nested-simple.yaml')
    const bad = structuredClone(out)
    const a = bad.layout.geo.boxes.find((b) => b.id === 'sched')
    a.y -= 16 // still ≥ 8px inside, but over the 36px band
    const result = await verifyFigure(nested, ir, bad)
    assert.equal(byName(result.checks, 'containment').ok, true)
    assert.equal(byName(result.checks, 'title-band-clear').ok, false)
    assert.match(byName(result.checks, 'title-band-clear').detail, /"sched" covers the title band of "ingest"/)
  })

  test('edges-orthogonal fails on a diagonal segment or an endpoint off the box border', async () => {
    const { ir, out } = await rendered('nested-deep.yaml')
    const diag = structuredClone(out)
    diag.layout.geo.edges[0].points[1].x += 8
    let result = await verifyFigure(nested, ir, diag)
    assert.equal(byName(result.checks, 'edges-orthogonal').ok, false)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /diagonal/)
    const off = structuredClone(out)
    off.layout.geo.edges[0].points[0].y += 4
    off.layout.geo.edges[0].points[1].y += 4
    result = await verifyFigure(nested, ir, off)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /does not start on the border/)
  })

  test('edge-clearance fails when an edge is re-routed straight through a sibling', async () => {
    const { ir, out } = await rendered('nested-deep.yaml')
    const bad = structuredClone(out)
    const boxes = bad.layout.geo.boxes
    const api = boxes.find((b) => b.id === 'order-api')
    const pay = boxes.find((b) => b.id === 'pay-api')
    const y = api.y + 20
    bad.layout.geo.edges[0].points = [{ x: api.x + api.width, y }, { x: pay.x, y }]
    const result = await verifyFigure(nested, ir, bad)
    assert.equal(byName(result.checks, 'edges-orthogonal').ok, true)
    assert.equal(byName(result.checks, 'edge-clearance').ok, false)
    assert.match(byName(result.checks, 'edge-clearance').detail, /edge 0 \("order-api"→"pay-api"\)/)
  })

  test('emphasis-count and emphasis-innermost warn (ok stays true overall) when 3 boxes including containers are emphasized', async () => {
    const raw = minimal()
    raw.root.emphasis = true
    raw.root.children.forEach((c) => { c.emphasis = true })
    const ir = validateIR(raw).ir
    const out = await renderFigure(nested, ir)
    const result = await verifyFigure(nested, ir, out)
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis=3', 'budget:emphasis-outer=2'])
    assert.equal(byName(result.checks, 'emphasis-count').severity, 'warn')
    assert.equal(byName(result.checks, 'emphasis-innermost').severity, 'warn')
    assert.equal(byName(result.checks, 'depth').ok, true)
  })

  test('edge-clearance fails when an edge label is moved onto a box, under another edge, or onto another label', async () => {
    const { ir, out } = await rendered('nested-deep.yaml')
    const clean = await verifyFigure(nested, ir, out)
    assert.equal(byName(clean.checks, 'edge-clearance').ok, true)
    const onBox = structuredClone(out)
    const ledger = onBox.layout.geo.boxes.find((b) => b.id === 'pay-ledger')
    Object.assign(onBox.layout.geo.edges[0].labelBox, { x: ledger.x + 8, y: ledger.y + 8 })
    let row = byName((await verifyFigure(nested, ir, onBox)).checks, 'edge-clearance')
    assert.equal(row.ok, false)
    assert.match(row.detail, /edge 0 label "与信" covers box "pay-ledger"/)
    const underEdge = structuredClone(out)
    const other = underEdge.layout.geo.edges[1]
    const seg = other.points[1], seg2 = other.points[2]
    Object.assign(underEdge.layout.geo.edges[0].labelBox, { x: Math.min(seg.x, seg2.x) + 8, y: seg.y - 8 })
    row = byName((await verifyFigure(nested, ir, underEdge)).checks, 'edge-clearance')
    assert.equal(row.ok, false)
    assert.match(row.detail, /label "与信" is crossed by edge 1/)
    const onLabel = structuredClone(out)
    Object.assign(onLabel.layout.geo.edges[0].labelBox, { x: onLabel.layout.geo.edges[1].labelBox.x, y: onLabel.layout.geo.edges[1].labelBox.y })
    row = byName((await verifyFigure(nested, ir, onLabel)).checks, 'edge-clearance')
    assert.equal(row.ok, false)
    assert.match(row.detail, /label "与信" overlaps edge 1 label "完了"/)
  })
})

// --- registry + CLI -----------------------------------------------------------------

describe('nested: registry dispatch and CLI', () => {
  test('the registry knows nested with its limits and rows; the doc example renders clean', async () => {
    const t = getFigureType('nested')
    assert.deepEqual(t.limits, { maxBoxes: 12, minDepth: 3, maxDepth: 5, maxLabelLen: 14, maxEmphasis: 1 })
    const r = validateIR(parseYaml(t.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.warnings, [])
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /^<figure class="wu-figure" data-checks="pass" data-type="nested">/)
  })

  test('renderFigureHtmlChecked embeds the IR, carries data-type, and scales the deep fixture to the column without scrolling', async () => {
    const ir = validIr('nested-deep.yaml')
    const html = await renderFigureHtmlChecked(ir, { rawYaml: fixture('nested-deep.yaml') })
    assert.equal(html.checksOk, true, JSON.stringify(html.failures))
    assert.match(html.html, /data-checks="pass" data-type="nested"/)
    assert.doesNotMatch(html.html, /data-scroll/)
    assert.match(html.html, /type: nested/)
    assert.match(html.html, /class="wu-focal"/)
  })

  test('CLI: --figure exits 0 with a passing figure; --json carries figureHtml and the warnings of an over-budget fixture', () => {
    const ok = runCli([join(FIXTURES, 'nested-deep.yaml'), '--figure'])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="nested">/)
    const over = runCli([join(FIXTURES, 'nested-over-boxes.yaml'), '--json'])
    assert.equal(over.status, 0, over.stderr)
    const j = JSON.parse(over.stdout)
    assert.ok(j.figureHtml)
    assert.equal(j.warn, 'budget:boxes=13')
    assert.deepEqual(j.warnings.map((w) => w.key), ['budget:boxes'])
  })
})
