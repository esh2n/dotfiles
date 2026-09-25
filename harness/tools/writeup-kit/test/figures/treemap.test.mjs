// `type: treemap` — schema, budgets, squarified layout on the 4px grid,
// label fitting + footnote, verify rows, the registry dispatch and the CLI.
// Fixtures: test/fixtures/treemap-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR } from '../../bin/lib/ir.mjs'
import * as treemap from '../../bin/lib/figures/treemap.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const CLEAN = ['treemap-flat.yaml', 'treemap-nested.yaml', 'treemap-tiny.yaml']

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const plugin = getFigureType('treemap')
const FRAME = { width: 720, height: 432 }
const OWN_ROWS = ['areas-proportional', 'tiling', 'labels-inside', 'tiny-disclosed', 'item-count', 'children-count', 'label-length', 'emphasis-count']

const minimal = () => ({
  id: 'm', type: 'treemap', title: 't',
  items: [
    { id: 'a', label: 'A', value: 50, emphasis: true },
    { id: 'b', label: 'B', children: [{ id: 'b1', label: 'B1', value: 20 }, { id: 'b2', label: 'B2', value: 10 }] },
    { id: 'c', label: 'C', value: 40, children: [{ id: 'c1', label: 'C1', value: 25 }] },
  ],
})

const area = (c) => c.width * c.height
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Asserts `set` tiles `region` exactly: on-grid, inside, disjoint, summing to the region. */
function assertTiles(set, region, what) {
  let sum = 0
  set.forEach((c, i) => {
    sum += area(c)
    for (const k of ['x', 'y', 'width', 'height']) assert.equal(c[k] % 4, 0, `${what}${c.id}.${k}=${c[k]} off grid`)
    assert.ok(c.x >= region.x && c.y >= region.y && c.x + c.width <= region.x + region.width && c.y + c.height <= region.y + region.height, `${what}${c.id} leaves its region`)
    for (let j = i + 1; j < set.length; j++) assert.ok(!overlaps(c, set[j]), `${what}${c.id} overlaps ${set[j].id}`)
  })
  assert.equal(sum, area(region), `${what}tiles do not cover the region`)
}

// --- schema ----------------------------------------------------------------

describe('figures/treemap.mjs: schema', () => {
  test('a valid IR normalizes: a parent without value takes the sum, a parent with value keeps it, unit kept only when given', () => {
    const r = validateIR({ ...minimal(), unit: 'GB' })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'treemap')
    assert.equal(r.ir.unit, 'GB')
    assert.deepEqual(r.ir.items[0], { id: 'a', label: 'A', value: 50, emphasis: true })
    assert.equal(r.ir.items[1].value, 30, 'sum of children')
    assert.deepEqual(r.ir.items[1].children[1], { id: 'b2', label: 'B2', value: 10, emphasis: false })
    assert.equal(r.ir.items[2].value, 40, 'given value ≥ sum is kept')
    assert.equal('unit' in validateIR(minimal()).ir, false)
  })

  test('normalize is idempotent', () => {
    const once = treemap.normalize(minimal())
    assert.deepEqual(treemap.normalize(once), once)
    for (const name of [...CLEAN, 'treemap-over-budget.yaml']) {
      const ir = validIr(name)
      assert.deepEqual(treemap.normalize(ir), ir, name)
    }
  })

  test('schema errors carry the offending path', () => {
    const item = (extra) => ({ ...minimal(), items: [{ id: 'a', label: 'A', value: 1 }, extra] })
    const cases = [
      [{ ...minimal(), items: [] }, /ir\.items must be a non-empty list/],
      [{ ...minimal(), unit: '  ' }, /ir\.unit must be a non-empty string/],
      [item({ id: 'b' }), /ir\.items\[1\]\.label is required/],
      [item({ id: 'b', label: 'B' }), /ir\.items\[1\]\.value must be a finite number > 0/],
      [item({ id: 'b', label: 'B', value: -3 }), /ir\.items\[1\]\.value must be a finite number > 0/],
      [item({ id: 'b', label: 'B', value: '12' }), /ir\.items\[1\]\.value must be a finite number > 0/],
      [item({ id: 'a', label: 'B', value: 1 }), /duplicate item id: "a"/],
      [item({ id: 'b c', label: 'B', value: 1 }), /ir\.items\[1\]\.id must match/],
      [item({ id: 'b--rest', label: 'B', value: 1 }), /must not end with "--rest"/],
      [item({ id: 'b', label: 'B', value: 1, emphasis: 'yes' }), /ir\.items\[1\]\.emphasis must be a boolean/],
      [item({ id: 'b', label: 'B', children: [] }), /ir\.items\[1\]\.children must be a non-empty list/],
      [item({ id: 'b', label: 'B', value: 5, children: [{ id: 'b1', label: 'B1', value: 9 }] }), /ir\.items\[1\]\.value \(5\) is less than the sum of its children \(9\)/],
      [item({ id: 'b', label: 'B', children: [{ id: 'b1', label: 'B1', children: [{ id: 'b11', label: 'x', value: 1 }] }] }), /ir\.items\[1\]\.children\[0\]\.children: a treemap nests 2 levels at most/],
      [item({ id: 'b', label: 'B', children: [{ id: 'b1', label: 'B1' }] }), /ir\.items\[1\]\.children\[0\]\.value must be a finite number > 0/],
    ]
    for (const [raw, re] of cases) {
      const r = validateIR(raw)
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(raw).slice(0, 100)}`)
      assert.equal(r.reason, 'schema')
      assert.match(r.message, re)
    }
  })
})

// --- budgets ---------------------------------------------------------------

describe('figures/treemap.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    for (const name of CLEAN) assert.deepEqual(treemap.budgetWarnings(validIr(name)), [], name)
  })

  test('a 9th top-level item and a 2nd emphasis each warn on their own (items ≤ 8, emphasis ≤ 1)', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, label: `項目${i}`, value: 90 - i * 5 }))
    const nine = validateIR({ id: 'n', type: 'treemap', title: 't', items })
    assert.equal(nine.ok, true)
    assert.deepEqual(nine.warnings.map((w) => [w.key, w.value, w.limit]), [['budget:items', 9, 8]])
    const two = validateIR({ id: 'e', type: 'treemap', title: 't', items: [{ id: 'a', label: 'A', value: 5, emphasis: true }, { id: 'b', label: 'B', value: 4, emphasis: true }] })
    assert.deepEqual(two.warnings.map((w) => [w.key, w.value, w.limit]), [['budget:emphasis', 2, 1]])
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('treemap-over-budget.yaml')
    const warns = treemap.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), ['budget:items', 'budget:children', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(warns.map((w) => [w.value, w.limit]), [[13, 8], [9, 8], [15, 12], [3, 1]])
    for (const w of warns) assert.ok(w.hint && w.detail)
    assert.match(warns[0].hint, /8 largest items and fold the rest into one 「その他」 item/)
    assert.match(warns[3].hint, /the one cell/)
    const rendered = await renderFigureHtmlChecked(ir)
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /data-warn="budget:items=13;budget:children=9;budget:label=15;budget:emphasis=3" data-type="treemap"/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/treemap.mjs: layout', () => {
  test('top-level tiles cover the 720×432 frame exactly, largest first, and children tile their parent below the band', async () => {
    for (const name of [...CLEAN, 'treemap-over-budget.yaml']) {
      const ir = validIr(name)
      const l = await treemap.layout(ir)
      assert.equal(l.width, 720)
      assert.ok(l.height >= 432 && l.height <= 480 && l.height % 4 === 0, `${name}: height ${l.height}`)
      assert.deepEqual(l.geo.frame, { x: 0, y: 0, ...FRAME })
      assert.equal(l.geo.cells.length, ir.items.length)
      const values = l.geo.cells.map((c) => c.value)
      assert.ok(values.every((v, i) => i === 0 || v <= values[i - 1]), `${name}: not laid out largest first`)
      assertTiles(l.geo.cells, l.geo.frame, `${name}: `)
      for (const c of l.geo.cells) {
        if (c.kind !== 'group') continue
        assert.equal(c.inner.y, c.y + 20, 'children start below the 20px band')
        assert.equal(c.inner.x, c.x + 4)
        assertTiles(c.children, c.inner, `${name}/${c.id}: `)
      }
    }
  })

  test('areas are proportional: big cells within 2%, every cell within the grid slack; a parent with value > sum gets a 「その他」 rest cell', async () => {
    const ir = validIr('treemap-nested.yaml')
    const l = await treemap.layout(ir)
    const total = ir.items.reduce((s, it) => s + it.value, 0)
    for (const c of l.geo.cells) {
      const expected = area(FRAME) * c.value / total
      const err = Math.abs(area(c) - expected)
      assert.ok(err <= Math.max(0.02 * expected, 4 * (c.width + c.height) + 16), `${c.id}: ${area(c)} vs ${expected}`)
      if (expected > 40000) assert.ok(err / expected <= 0.02, `${c.id}: big cell off by ${(err / expected * 100).toFixed(1)}%`)
    }
    const product = l.geo.cells.find((c) => c.id === 'product')
    assert.equal(product.kind, 'group')
    const rest = product.children.find((c) => c.rest)
    assert.ok(rest, 'remainder cell present')
    assert.equal(rest.id, 'product--rest')
    assert.equal(rest.label, 'その他')
    assert.equal(rest.value, 3)
    const kidTotal = product.children.reduce((s, c) => s + c.value, 0)
    assert.equal(kidTotal, 40)
    for (const k of product.children) {
      const expected = area(product.inner) * k.value / kidTotal
      assert.ok(Math.abs(area(k) - expected) <= Math.max(0.02 * expected, 4 * (k.width + k.height) + 16), `${k.id}: ${area(k)} vs ${expected}`)
    }
  })

  test('labels fit by size: label + value, label only, or nothing → footnote; group bands carry label and value', async () => {
    const nested = await treemap.layout(validIr('treemap-nested.yaml'))
    const analytics = nested.geo.cells.find((c) => c.id === 'analytics')
    assert.equal(analytics.fit, 'both')
    assert.equal(analytics.valueText, '62 TB')
    assert.ok(analytics.valueBox.x > analytics.labelBox.x + analytics.labelBox.width)
    assert.equal(analytics.valueBox.y, analytics.labelBox.y, 'band value sits on the label baseline')
    const raw = analytics.children.find((c) => c.id === 'raw')
    assert.equal(raw.fit, 'both')
    assert.deepEqual([raw.labelBox.x, raw.labelBox.y, raw.valueBox.y], [raw.x + 8, raw.y + 16, raw.y + 32])
    const rest = nested.geo.cells.find((c) => c.id === 'product').children.find((c) => c.rest)
    assert.equal(rest.fit, 'none')
    assert.equal(rest.labelBox, undefined)
    assert.deepEqual(nested.geo.footnote.items, ['product--rest'])
    assert.deepEqual(nested.geo.footnote.lines, ['小さすぎて表示できない: その他 (3 TB)'])
    assert.equal(nested.geo.footnote.y, 432 + 8 + 12)
    assert.equal(nested.height, 464, '432 frame + 8 gap + one 16px footnote line + 8 gap')

    const tiny = await treemap.layout(validIr('treemap-tiny.yaml'))
    const fits = Object.fromEntries(tiny.geo.cells.map((c) => [c.id, c.fit]))
    assert.deepEqual(fits, { search: 'both', detail: 'both', write: 'both', admin: 'none', export: 'none', misc: 'none' })
    assert.equal(tiny.geo.cells.find((c) => c.id === 'search').valueText, '82%', 'a % unit has no space')
    assert.match(tiny.geo.footnote.lines[0], /^小さすぎて表示できない: 管理画面操作 \(1%\), エクスポート \(0\.4%\), その他の操作 \(0\.1%\)$/)

    const flat = await treemap.layout(validIr('treemap-flat.yaml'))
    assert.equal(flat.geo.footnote, null)
    assert.equal(flat.height, 432)
    assert.ok(flat.geo.cells.every((c) => c.fit === 'both'))
    // a narrow tall cell whose value line is too wide keeps its label only
    const r = validateIR({ id: 'n', type: 'treemap', title: 't', items: [{ id: 'big', label: 'B', value: 123456789 }, { id: 'thin', label: 'x', value: 9876543 }] })
    const thin = (await treemap.layout(r.ir)).geo.cells.find((c) => c.id === 'thin')
    assert.equal(thin.fit, 'label')
    assert.equal(thin.valueBox, undefined)
  })

  test('the fill ramp runs largest → smallest and every position sits on the 4px grid; layout and svg are deterministic', async () => {
    for (const name of [...CLEAN, 'treemap-over-budget.yaml']) {
      const ir = validIr(name)
      const a = await treemap.layout(ir)
      const b = await treemap.layout(ir)
      assert.deepEqual(a, b, `${name}: layout differs between runs`)
      const ops = a.geo.cells.map((c) => c.opacity)
      assert.equal(ops[0], 0.1)
      assert.equal(ops[ops.length - 1], 0.32)
      assert.ok(ops.every((o, i) => i === 0 || o >= ops[i - 1]))
      const r1 = await renderFigure(plugin, ir)
      const r2 = await renderFigure(plugin, ir)
      assert.equal(r1.svg, r2.svg, `${name}: svg differs between runs`)
      const v = await verifyFigure(plugin, ir, r1)
      assert.equal(byName(v.checks, 'grid-4px').ok, true, `${name}: ${byName(v.checks, 'grid-4px').detail}`)
    }
  })
})

// --- verify rows -----------------------------------------------------------

describe('figures/treemap.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of CLEAN) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
      assert.equal(byName(v.checks, 'a11y').ok, true)
    }
  })

  test('areas-proportional fails when a cell area drifts beyond 2% and the grid slack', async () => {
    const ir = validIr('treemap-flat.yaml')
    const rendered = await renderFigure(plugin, ir)
    const l = rendered.layout
    const big = l.geo.cells[0]
    big.width -= 40
    const row = byName(treemap.verify(l, ir, { svg: rendered.svg }), 'areas-proportional')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /feature \(\d+px² vs \d+px² expected\)/)
    assert.ok(row.hint)
    // a child drifting inside its parent is caught too
    const n = validIr('treemap-nested.yaml')
    const nl = await treemap.layout(n)
    const kid = nl.geo.cells.find((c) => c.id === 'analytics').children[0]
    kid.height -= 60
    assert.match(byName(treemap.verify(nl, n), 'areas-proportional').detail, /analytics\/raw/)
  })

  test('tiling fails on an overlap, a gap, an off-grid tile, or a child above the band', async () => {
    const ir = validIr('treemap-flat.yaml')
    const l1 = await treemap.layout(ir)
    l1.geo.cells[1].x -= 8
    let row = byName(treemap.verify(l1, ir), 'tiling')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlaps/)
    const l2 = await treemap.layout(ir)
    l2.geo.cells[0].width -= 8
    assert.match(byName(treemap.verify(l2, ir), 'tiling').detail, /tiles cover \d+px² of 311040px²/)
    const l3 = await treemap.layout(ir)
    l3.geo.cells[0].x += 2
    l3.geo.cells[0].width -= 2
    assert.match(byName(treemap.verify(l3, ir), 'tiling').detail, /off the 4px grid/)
    const n = validIr('treemap-nested.yaml')
    const nl = await treemap.layout(n)
    const g = nl.geo.cells.find((c) => c.id === 'analytics')
    g.inner.y -= 4
    g.inner.height += 4
    g.children[0].y -= 4
    g.children[0].height += 4
    assert.match(byName(treemap.verify(nl, n), 'tiling').detail, /covers the title band/)
    const l4 = await treemap.layout(ir)
    l4.geo.cells.pop()
    assert.match(byName(treemap.verify(l4, ir), 'tiling').detail, /5 top-level cell\(s\) for 6 item\(s\)/)
  })

  test('labels-inside fails when a label box leaves its rect or the label is not drawn', async () => {
    const ir = validIr('treemap-flat.yaml')
    const rendered = await renderFigure(plugin, ir)
    const l = rendered.layout
    const c = l.geo.cells[0]
    c.labelBox.width = c.width
    let row = byName(treemap.verify(l, ir, { svg: rendered.svg }), 'labels-inside')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /feature label runs outside its rect/)
    const fresh = await renderFigure(plugin, ir)
    const svg = fresh.svg.replace(/<text id="wu-d-effort-split-ops-value"[^>]*>[^<]*<\/text>/, '')
    assert.match(byName(treemap.verify(fresh.layout, ir, { svg }), 'labels-inside').detail, /ops value not drawn/)
    const l2 = await treemap.layout(ir)
    l2.geo.cells[0].valueBox.y = l2.geo.cells[0].y + l2.geo.cells[0].height
    assert.match(byName(treemap.verify(l2, ir), 'labels-inside').detail, /feature value runs outside its rect/)
  })

  test('tiny-disclosed fails when a tiny item is missing from the footnote, the footnote is missing from the svg, or present without tiny items', async () => {
    const ir = validIr('treemap-tiny.yaml')
    const rendered = await renderFigure(plugin, ir)
    const l = rendered.layout
    l.geo.footnote.items = l.geo.footnote.items.filter((id) => id !== 'export')
    l.geo.footnote.lines = [l.geo.footnote.lines[0].replace('エクスポート (0.4%), ', '')]
    let row = byName(treemap.verify(l, ir, { svg: rendered.svg }), 'tiny-disclosed')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /export not listed in the footnote/)
    const fresh = await renderFigure(plugin, ir)
    const svg = fresh.svg.replace(/<text id="wu-d-request-mix-footnote-0"[^>]*>[^<]*<\/text>/, '')
    assert.match(byName(treemap.verify(fresh.layout, ir, { svg }), 'tiny-disclosed').detail, /footnote missing from the svg/)
    const l2 = await treemap.layout(ir)
    l2.geo.footnote.lines[0] = l2.geo.footnote.lines[0].replace('小さすぎて表示できない: ', '省略: ')
    assert.match(byName(treemap.verify(l2, ir), 'tiny-disclosed').detail, /does not start with/)
    const flat = validIr('treemap-flat.yaml')
    const fl = await treemap.layout(flat)
    fl.geo.footnote = { x: 8, y: 452, lines: ['小さすぎて表示できない: x'], items: [] }
    assert.match(byName(treemap.verify(fl, flat), 'tiny-disclosed').detail, /footnote present without tiny items/)
    const ok = byName(treemap.verify(await treemap.layout(flat), flat), 'tiny-disclosed')
    assert.equal(ok.ok, true)
    assert.match(ok.detail, /every item shows its label/)
  })

  test('the four budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('treemap-over-budget.yaml')
    const v = await verifyFigure(plugin, ir, await renderFigure(plugin, ir))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['item-count', 'budget:items', 13],
      ['children-count', 'budget:children', 9],
      ['label-length', 'budget:label', 15],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const clean = validIr('treemap-nested.yaml')
    const cv = await verifyFigure(plugin, clean, await renderFigure(plugin, clean))
    for (const name of ['item-count', 'children-count', 'label-length', 'emphasis-count']) {
      const row = byName(cv.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/treemap.mjs: draw', () => {
  test('rects carry data-value and inset 1px; neutral ramp; children on the surface token; focal overlay last; labels escaped; footnote muted', async () => {
    const raw = {
      id: 'd', type: 'treemap', title: 't', unit: 'GB',
      items: [
        { id: 'a', label: 'A & <B>', value: 100, emphasis: true },
        { id: 'g', label: 'G', value: 60, children: [{ id: 'g1', label: 'G1', value: 40 }, { id: 'g2', label: 'G2', value: 15 }] },
        { id: 'c', label: 'C', value: 0.5 },
      ],
    }
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    const { svg, layout } = await renderFigure(plugin, r.ir)
    const a = layout.geo.cells.find((c) => c.id === 'a')
    assert.match(svg, new RegExp(`<rect id="wu-d-d-a" data-value="100" x="${a.x + 1}" y="${a.y + 1}" width="${a.width - 2}" height="${a.height - 2}" rx="4" fill="currentColor" fill-opacity="0\\.1"/>`))
    assert.match(svg, /<rect id="wu-d-d-g" data-value="60"[^>]*fill="currentColor" fill-opacity="0\.21"\/>/)
    assert.match(svg, /<rect id="wu-d-d-g1" data-value="40"[^>]*fill="var\(--wu-surface\)" fill-opacity="0\.55"\/>/)
    assert.match(svg, /<rect id="wu-d-d-g--rest" data-value="5" data-rest="true"/)
    assert.match(svg, /<text id="wu-d-d-a-label"[^>]*font-size="13" font-weight="700" fill="currentColor">A &amp; &lt;B&gt;<\/text>/)
    assert.match(svg, /<text id="wu-d-d-a-value"[^>]*font-size="11" fill="var\(--wu-ink-3\)">100 GB<\/text>/)
    assert.match(svg, /<text id="wu-d-d-g-value"[^>]*>60 GB<\/text>/)
    const ids = [...svg.matchAll(/<rect id="wu-d-d-([\w-]+)"/g)].map((m) => m[1])
    assert.equal(ids[ids.length - 1], 'a-focal', 'the focal overlay is drawn last')
    assert.match(svg, /<rect id="wu-d-d-a-focal" class="wu-focal"[^>]*fill="none" stroke="var\(--wu-accent\)" stroke-width="1\.5"\/>/)
    assert.match(svg, /<text id="wu-d-d-footnote-0"[^>]*font-size="11" fill="var\(--wu-ink-3\)">小さすぎて表示できない: /)
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}\b/)
    assert.doesNotMatch(plugin.draw(layout, r.ir), /<svg|<title|<desc/, 'draw() returns the inner svg only')
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/treemap.mjs: registry dispatch and CLI', () => {
  test('treemap-flat.yaml and treemap-nested.yaml render as data-checks="pass" data-type="treemap" figures', async () => {
    for (const name of ['treemap-flat.yaml', 'treemap-nested.yaml']) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="treemap">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the registry lists treemap with its limits and doc rows', () => {
    assert.equal(plugin.type, 'treemap')
    assert.deepEqual(plugin.limits, { maxItems: 8, maxChildren: 8, maxLabelLen: 12, maxEmphasis: 1 })
    assert.deepEqual(plugin.doc.rows, OWN_ROWS)
  })

  test('doc.irExample is 3 groups with children and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.items.length, 3)
    assert.ok(r.ir.items.every((it) => Array.isArray(it.children) && it.children.length >= 2))
    assert.equal(r.ir.items.flatMap((it) => it.children).filter((c) => c.emphasis).length, 1)
    assert.deepEqual(treemap.budgetWarnings(r.ir), [])
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="treemap">/)
    assert.match(rendered.html, /data-value="310"/)
  })

  test('--figure prints a verified treemap figure; --json reports warnings for the over-budget fixture; --doc prints the example', () => {
    const fig = runCli([join(FIXTURES, 'treemap-nested.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="treemap">/)
    const json = runCli([join(FIXTURES, 'treemap-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:items', 'budget:children', 'budget:label', 'budget:emphasis'])
    assert.match(out.figureHtml, /data-warn="budget:items=13;budget:children=9;budget:label=15;budget:emphasis=3" data-type="treemap"/)
    const warnFig = runCli([join(FIXTURES, 'treemap-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:items=13/)
    const doc = runCli(['--doc', 'treemap'])
    assert.equal(doc.status, 0)
    assert.match(doc.stdout, /^id: cloud-cost\ntype: treemap\n/)
  })
})
