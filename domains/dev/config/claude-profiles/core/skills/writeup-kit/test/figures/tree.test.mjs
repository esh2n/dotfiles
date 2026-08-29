// `type: tree` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/tree-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as tree from '../../bin/lib/figures/tree.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const FIXTURE_NAMES = ['tree-simple.yaml', 'tree-org.yaml', 'tree-right.yaml', 'tree-over-nodes.yaml']

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const runCli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })

const node = (id, label, extra = {}) => ({ id, label, ...extra })
const minimal = () => ({
  id: 't', type: 'tree', title: 't',
  root: node('r', 'R', { sub: 'root', children: [node('a', 'A'), node('b', 'B', { tone: 'rs' })] }),
})

async function rendered(name) {
  const ir = validIr(name)
  const out = await renderFigure(tree, ir)
  return { ir, out, geo: out.layout.geo }
}

const find = (geo, id) => geo.nodes.find((n) => n.id === id)

// --- schema ---------------------------------------------------------------

describe('tree: schema', () => {
  test('a minimal valid IR normalizes with variant tree, direction down, children [] on leaves, sub kept only where given', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'tree')
    assert.equal(r.ir.variant, 'tree')
    assert.equal(r.ir.direction, 'down')
    assert.equal(r.ir.root.sub, 'root')
    assert.deepEqual(r.ir.root.children[0], { id: 'a', label: 'A', tone: 'neutral', emphasis: false, children: [] })
    assert.equal('sub' in r.ir.root.children[0], false)
    assert.deepEqual(r.warnings, [])
  })

  test('normalize is idempotent for every fixture and the minimal IR', () => {
    for (const name of FIXTURE_NAMES) {
      const once = tree.normalize(parseYaml(fixture(name)))
      assert.deepEqual(tree.normalize(once), once, name)
    }
    assert.deepEqual(tree.normalize(tree.normalize(minimal())), tree.normalize(minimal()))
  })

  test('bad variant/direction, a missing root, duplicate ids, non-list children and an empty label are schema errors naming the path', () => {
    const variant = validateIR({ ...minimal(), variant: 'mindmap' })
    assert.equal(variant.reason, 'schema')
    assert.match(variant.message, /^ir\.variant must be tree\|org \(got: "mindmap"\)$/)
    assert.match(validateIR({ ...minimal(), direction: 'up' }).message, /^ir\.direction must be down\|right/)
    assert.match(validateIR({ id: 't', type: 'tree', title: 't' }).message, /^ir\.root is required and must be a mapping$/)
    const dup = validateIR({ ...minimal(), root: node('r', 'R', { children: [node('a', 'A'), node('a', 'A2')] }) })
    assert.match(dup.message, /duplicate node id: "a"/)
    const list = validateIR({ ...minimal(), root: node('r', 'R', { children: 'a' }) })
    assert.match(list.message, /^ir\.root\.children must be a list$/)
    const label = validateIR({ ...minimal(), root: node('r', 'R', { children: [node('a', '')] }) })
    assert.match(label.message, /^ir\.root\.children\[0\]\.label is required/)
  })
})

// --- budgets ----------------------------------------------------------------

describe('tree: budgets are advisory warnings in a stable order', () => {
  test('17 nodes validate with a budget:nodes warning that reaches data-warn and still renders as a passing figure', async () => {
    const r = validateIR(parseYaml(fixture('tree-over-nodes.yaml')))
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:nodes=17'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:nodes=17')
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /data-checks="pass" data-warn="budget:nodes=17" data-type="tree" data-scroll="true"/)
  })

  test('5 levels, a label over 14 chars and 3 emphasized nodes warn in the order nodes → depth → label → emphasis', () => {
    const raw = minimal()
    raw.root.emphasis = true
    raw.root.children[0].emphasis = true
    raw.root.children[0].label = 'とても長い部品の名前が十四文字を超える'
    raw.root.children[1].emphasis = true
    raw.root.children[1].children = [node('l3', 'L3', { children: [node('l4', 'L4', { children: [node('l5', 'L5')] })] })]
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => w.key), ['budget:depth', 'budget:label', 'budget:emphasis'])
    assert.equal(r.warnings[0].value, 5)
    assert.match(r.warnings[1].hint, /shorten label of node "a"/)
    assert.equal(r.warnings[2].value, 3)
    assert.deepEqual(tree.budgetWarnings(r.ir), r.warnings)
    const many = minimal()
    many.root.children = Array.from({ length: 16 }, (_, i) => node(`n${i}`, `N${i}`))
    assert.deepEqual(validateIR(many).warnings.map((w) => w.key), ['budget:nodes'])
  })
})

// --- layout -------------------------------------------------------------------

describe('tree: layout', () => {
  test('tree-org: 7 nodes on 3 levels, one width and one 56px height per level, siblings left to right with a gap, every position on the grid', async () => {
    const { geo } = await rendered('tree-org.yaml')
    assert.equal(geo.nodes.length, 7)
    assert.deepEqual([...new Set(geo.nodes.map((n) => n.level))].sort(), [1, 2, 3])
    for (const level of [1, 2, 3]) {
      const row = geo.nodes.filter((n) => n.level === level)
      assert.equal(new Set(row.map((n) => n.width)).size, 1, `level ${level} shares a width`)
      assert.equal(new Set(row.map((n) => n.y)).size, 1, `level ${level} shares a y`)
      assert.ok(row.every((n) => n.height === 56), `level ${level} is 56px tall (sub line)`)
    }
    const [tech, biz, admin] = ['tech', 'biz', 'admin'].map((id) => find(geo, id))
    assert.ok(tech.x + tech.width + 24 <= biz.x && biz.x + biz.width + 24 <= admin.x, 'siblings run left to right ≥ 24px apart')
    assert.equal(find(geo, 'dev').y, tech.y + tech.height + 40, 'the next level sits one LEVEL_GAP below')
    for (const n of geo.nodes) for (const k of ['x', 'y', 'cx', 'cy']) assert.equal(n[k] % 4, 0, `${n.id}.${k} on grid`)
    assert.equal(find(geo, 'ceo').sub, 'CEO')
  })

  test('every parent is centred over the midpoint of its first and last child; a single child hangs straight below with a zero-length bus', async () => {
    const { geo } = await rendered('tree-org.yaml')
    for (const p of geo.nodes.filter((n) => n.children.length)) {
      const kids = p.children.map((id) => find(geo, id))
      assert.equal(p.cx, (kids[0].cx + kids[kids.length - 1].cx) / 2, `${p.id} centred`)
    }
    assert.equal(find(geo, 'sales').cx, find(geo, 'biz').cx)
    const bizBus = geo.buses.find((b) => b.parent === 'biz')
    assert.equal(bizBus.x1, bizBus.x2)
    assert.equal(geo.buses.length, 3)
    assert.equal(geo.links.length, 6)
  })

  test('direction: right runs levels along x and siblings along y, with vertical buses', async () => {
    const { geo } = await rendered('tree-right.yaml')
    const [cfg, core, rules] = ['cfg', 'core', 'rules'].map((id) => find(geo, id))
    assert.ok(cfg.x + cfg.width < core.x && core.x + core.width < rules.x, 'levels progress to the right')
    assert.equal(core.x, cfg.x + cfg.width + 40)
    const kids = ['core', 'packs', 'runtime'].map((id) => find(geo, id))
    assert.ok(kids.every((k) => k.x === kids[0].x), 'siblings share an x')
    assert.ok(kids[0].y + kids[0].height <= kids[1].y && kids[1].y + kids[1].height <= kids[2].y, 'siblings stack downward')
    assert.equal(cfg.cy, (kids[0].cy + kids[2].cy) / 2)
    for (const b of geo.buses) assert.equal(b.x1, b.x2, 'bus is vertical')
    assert.equal(geo.nodes.filter((n) => n.level === 1)[0].height, 40)
  })

  test('layout is deterministic: same IR → byte-identical svg and deep-equal geometry', async () => {
    for (const name of ['tree-org.yaml', 'tree-right.yaml']) {
      const ir = validIr(name)
      const a = await renderFigure(tree, ir)
      const b = await renderFigure(tree, ir)
      assert.equal(a.svg, b.svg, name)
      assert.deepEqual(a.layout, b.layout, name)
    }
  })

  test('a wide tree falls back to sideways scroll instead of shrinking below the floor', async () => {
    const out = await renderFigure(tree, validIr('tree-over-nodes.yaml'))
    assert.ok(out.width > 720)
    assert.equal(out.scroll, true)
    assert.equal(out.scaled, false)
  })
})

// --- verify rows ----------------------------------------------------------------

describe('tree: verify rows', () => {
  test('a real render of every fixture passes every fail row; rows 1–4 warn, 5–8 fail; the 7 shared rows follow', async () => {
    for (const name of FIXTURE_NAMES) {
      const { ir, out } = await rendered(name)
      const result = await verifyFigure(tree, ir, out)
      assert.deepEqual(result.failures, [], name)
      assert.equal(result.ok, true)
      assert.deepEqual(result.checks.slice(0, 8).map((c) => c.severity), ['warn', 'warn', 'warn', 'warn', 'fail', 'fail', 'fail', 'fail'])
      assert.deepEqual(result.checks.slice(0, 8).map((c) => c.name), tree.doc.rows)
      assert.equal(result.checks.length, 8 + 7)
      if (name !== 'tree-over-nodes.yaml') assert.deepEqual(result.warnings, [], name)
    }
  })

  test('node-overlap fails when a sibling is moved onto its neighbour', async () => {
    const { ir, out } = await rendered('tree-org.yaml')
    const bad = structuredClone(out)
    const biz = find(bad.layout.geo, 'biz')
    biz.x = find(bad.layout.geo, 'tech').x + 8
    const result = await verifyFigure(tree, ir, bad)
    assert.equal(byName(result.checks, 'node-overlap').ok, false)
    assert.match(byName(result.checks, 'node-overlap').detail, /"tech" overlaps "biz"/)
    assert.equal(result.ok, false)
  })

  test('connectors-orthogonal fails on a diagonal segment or an endpoint off the node border', async () => {
    const { ir, out } = await rendered('tree-simple.yaml')
    const diag = structuredClone(out)
    diag.layout.geo.links[0].points[1].x += 8
    let result = await verifyFigure(tree, ir, diag)
    assert.equal(byName(result.checks, 'connectors-orthogonal').ok, false)
    assert.match(byName(result.checks, 'connectors-orthogonal').detail, /segment 0 is diagonal/)
    const off = structuredClone(out)
    off.layout.geo.links[0].points[3].y += 4
    off.layout.geo.links[0].points[2].y += 4
    result = await verifyFigure(tree, ir, off)
    assert.match(byName(result.checks, 'connectors-orthogonal').detail, /does not end on the border of "bigbang"/)
  })

  test('connector-clearance fails when an unrelated node is pushed onto the bus band', async () => {
    const { ir, out } = await rendered('tree-org.yaml')
    const bad = structuredClone(out)
    const admin = find(bad.layout.geo, 'admin')
    const tech = find(bad.layout.geo, 'tech')
    admin.x = tech.x + 8 + tech.width // no overlap with any node …
    admin.y = tech.y + tech.height + 8 // … but a 24px strip sitting on the bus between tech and its children
    admin.height = 24
    admin.cx = admin.x + admin.width / 2
    admin.cy = admin.y + admin.height / 2
    const result = await verifyFigure(tree, ir, bad)
    assert.equal(byName(result.checks, 'node-overlap').ok, true)
    assert.equal(byName(result.checks, 'connector-clearance').ok, false)
    assert.match(byName(result.checks, 'connector-clearance').detail, /link \d \("tech"→"platform"\) crosses "admin"/)
  })

  test('parent-centred fails when a parent is shifted 8px off its children; a 4px shift is tolerated', async () => {
    const { ir, out } = await rendered('tree-org.yaml')
    const shift = async (px) => {
      const bad = structuredClone(out)
      const ceo = find(bad.layout.geo, 'ceo')
      ceo.x += px
      ceo.cx += px
      for (const l of bad.layout.geo.links.filter((k) => k.parent === 'ceo')) { l.points[0].x += px; l.points[1].x += px }
      return verifyFigure(tree, ir, bad)
    }
    const eight = await shift(8)
    assert.equal(byName(eight.checks, 'parent-centred').ok, false)
    assert.match(byName(eight.checks, 'parent-centred').detail, /"ceo" is 8px off the centre/)
    const four = await shift(4)
    assert.equal(byName(four.checks, 'parent-centred').ok, true)
  })

  test('emphasis-count warns (ok stays true overall) when 3 nodes are emphasized', async () => {
    const raw = minimal()
    raw.root.emphasis = true
    raw.root.children.forEach((c) => { c.emphasis = true })
    const ir = validateIR(raw).ir
    const out = await renderFigure(tree, ir)
    const result = await verifyFigure(tree, ir, out)
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis=3'])
    assert.equal(byName(result.checks, 'emphasis-count').severity, 'warn')
  })
})

// --- draw + registry + CLI ------------------------------------------------------

describe('tree: draw, registry dispatch and CLI', () => {
  test('org variant draws one bus path per parent and a muted 11px sub line; tree variant draws one elbow per link', async () => {
    const org = await rendered('tree-org.yaml')
    assert.equal((org.out.svg.match(/id="wu-d-org1-bus-/g) || []).length, 3)
    assert.doesNotMatch(org.out.svg, /-link-/)
    assert.match(org.out.svg, /<text id="wu-d-org1-ceo-sub" [^>]*font-size="11" [^>]*fill="var\(--wu-ink-3\)">CEO<\/text>/)
    assert.match(org.out.svg, /<rect id="wu-d-org1-ceo" data-tone="neutral" class="wu-focal"[^>]*stroke-width="1.5"/)
    const plain = await rendered('tree-simple.yaml')
    assert.equal((plain.out.svg.match(/id="wu-d-t1-link-/g) || []).length, 6)
    assert.doesNotMatch(plain.out.svg, /-bus-/)
    assert.doesNotMatch(plain.out.svg, /-sub"/)
    assert.match(plain.out.svg, /<rect id="wu-d-t1-parallel" data-tone="rs"[^>]*fill="var\(--wu-fig-tone-rs\)"/)
  })

  test('the registry knows tree with its limits and rows; the doc example is a 7-node 3-level org chart that renders clean', async () => {
    const t = getFigureType('tree')
    assert.deepEqual(t.limits, { maxNodes: 16, maxDepth: 4, maxLabelLen: 14, maxEmphasis: 2 })
    assert.deepEqual(t.doc.rows, tree.doc.rows)
    const r = validateIR(parseYaml(t.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.variant, 'org')
    assert.deepEqual(r.warnings, [])
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /^<figure class="wu-figure" data-checks="pass" data-type="tree">/)
    const geo = (await renderFigure(tree, r.ir)).layout.geo
    assert.equal(geo.nodes.length, 7)
    assert.equal(Math.max(...geo.nodes.map((n) => n.level)), 3)
    assert.ok(geo.nodes.every((n) => n.sub))
  })

  test('renderFigureHtmlChecked embeds the IR, carries data-type, and scales the org fixture into the column without scrolling', async () => {
    const ir = validIr('tree-org.yaml')
    const html = await renderFigureHtmlChecked(ir, { rawYaml: fixture('tree-org.yaml') })
    assert.equal(html.checksOk, true, JSON.stringify(html.failures))
    assert.match(html.html, /data-checks="pass" data-type="tree"/)
    assert.doesNotMatch(html.html, /data-scroll/)
    assert.match(html.html, /type: tree/)
    assert.match(html.html, /variant: org/)
    assert.match(html.html, /class="wu-focal"/)
  })

  test('CLI: --figure exits 0 with a passing figure; --json carries figureHtml and the warnings of the over-budget fixture; --doc prints the example', () => {
    const ok = runCli([join(FIXTURES, 'tree-org.yaml'), '--figure'])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="tree">/)
    const over = runCli([join(FIXTURES, 'tree-over-nodes.yaml'), '--json'])
    assert.equal(over.status, 0, over.stderr)
    const j = JSON.parse(over.stdout)
    assert.ok(j.figureHtml)
    assert.equal(j.warn, 'budget:nodes=17')
    assert.deepEqual(j.warnings.map((w) => w.key), ['budget:nodes'])
    const doc = runCli(['--doc', 'tree'])
    assert.equal(doc.status, 0, doc.stderr)
    assert.equal(doc.stdout, tree.doc.irExample)
  })
})
