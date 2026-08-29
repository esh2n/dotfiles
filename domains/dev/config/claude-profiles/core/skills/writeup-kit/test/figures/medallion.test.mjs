// `type: medallion` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/medallion-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as medallion from '../../bin/lib/figures/medallion.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const ALL_FIXTURES = ['medallion-simple.yaml', 'medallion-full.yaml', 'medallion-over-budget.yaml']
const CLEAN_FIXTURES = ['medallion-simple.yaml', 'medallion-full.yaml']
const BUDGET_KEYS = ['budget:stages', 'budget:items', 'budget:label']

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

const plugin = getFigureType('medallion')

const minimal = () => ({
  id: 'm', type: 'medallion', title: 't',
  stages: [
    { id: 'bronze', label: 'Bronze', items: ['raw'], properties: ['keep 90d'] },
    { id: 'silver', label: 'Silver', emphasis: true },
    { id: 'gold', label: 'Gold', items: ['sales', 'c360'] },
  ],
  promotions: [{ from: 'bronze', to: 'silver', label: 'clean' }, { from: 'silver', to: 'gold' }],
  sources: ['app db'],
  consumers: ['BI', 'API'],
})

// --- schema ----------------------------------------------------------------

describe('figures/medallion.mjs: schema', () => {
  test('a valid IR normalizes: defaults filled in, empty optional lists dropped', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'medallion')
    assert.deepEqual(r.ir.stages[0], { id: 'bronze', label: 'Bronze', items: ['raw'], properties: ['keep 90d'], emphasis: false })
    assert.deepEqual(r.ir.stages[1], { id: 'silver', label: 'Silver', items: [], properties: [], emphasis: true })
    assert.deepEqual(r.ir.promotions, [{ from: 'bronze', to: 'silver', label: 'clean' }, { from: 'silver', to: 'gold' }])
    assert.deepEqual(r.ir.sources, ['app db'])
    assert.deepEqual(r.ir.consumers, ['BI', 'API'])
    const bare = validateIR({ ...minimal(), promotions: [], sources: [], consumers: undefined })
    assert.equal(bare.ok, true)
    assert.equal('promotions' in bare.ir, false)
    assert.equal('sources' in bare.ir, false)
    assert.equal('consumers' in bare.ir, false)
  })

  test('normalize is idempotent', () => {
    const once = medallion.normalize(minimal())
    const twice = medallion.normalize(once)
    assert.deepEqual(twice, once)
    for (const name of ALL_FIXTURES) {
      const fromFixture = validIr(name)
      assert.deepEqual(medallion.normalize(fromFixture), fromFixture, name)
    }
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), stages: [] }, /ir\.stages must be a non-empty list/],
      [{ ...minimal(), stages: [{ id: 'a', label: 'A' }], promotions: undefined }, /ir\.stages needs at least 2 stages/],
      [{ ...minimal(), stages: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], promotions: undefined }, /duplicate stage id: "a"/],
      [{ ...minimal(), stages: [{ id: 'a', label: 'A', items: [{ retention: '90d' }] }, { id: 'b', label: 'B' }], promotions: undefined }, /ir\.stages\[0\]\.items\[0\] must be a non-empty string \(a "key: value" entry parses as a mapping — quote the string\)/],
      [{ ...minimal(), stages: [{ id: 'a', label: 'A', properties: 'x' }, { id: 'b', label: 'B' }], promotions: undefined }, /ir\.stages\[0\]\.properties must be a list of strings/],
      [{ ...minimal(), stages: [{ id: 'a', label: 'A', emphasis: 'yes' }, { id: 'b', label: 'B' }], promotions: undefined }, /ir\.stages\[0\]\.emphasis must be a boolean/],
      [{ ...minimal(), promotions: [{ from: 'bronze', to: 'zzz' }] }, /ir\.promotions\[0\]\.to references unknown stage "zzz"/],
      [{ ...minimal(), promotions: [{ from: 'bronze', to: 'bronze' }] }, /ir\.promotions\[0\]: from and to must differ/],
      [{ ...minimal(), promotions: [{ from: 'bronze', to: 'silver', label: 3 }] }, /ir\.promotions\[0\]\.label must be a string/],
      [{ ...minimal(), sources: 'app' }, /ir\.sources must be a list of strings/],
      [{ ...minimal(), consumers: [''] }, /ir\.consumers\[0\] must be a non-empty string/],
    ]
    for (const [raw, re] of cases) {
      const r = validateIR(raw)
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(raw).slice(0, 80)}`)
      assert.equal(r.reason, 'schema')
      assert.match(r.message, re)
    }
  })
})

// --- budgets ---------------------------------------------------------------

describe('figures/medallion.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    for (const name of CLEAN_FIXTURES) assert.deepEqual(medallion.budgetWarnings(validIr(name)), [], name)
  })

  test('fewer than 3 stages warns budget:stages against the lower bound (a 2-stage ladder is a before/after)', () => {
    const two = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', emphasis: true }, { id: 'b', label: 'B' }], promotions: undefined })
    assert.equal(two.ok, true)
    assert.deepEqual(two.warnings.map((w) => [w.key, w.value, w.limit]), [['budget:stages', 2, 3]])
    assert.match(two.warnings[0].detail, /guidance ≥ 3/)
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('medallion-over-budget.yaml')
    const warns = medallion.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), BUDGET_KEYS)
    assert.deepEqual(warns.map((w) => w.value), [7, 7, 16])
    assert.equal(formatBudgetWarnings(warns), 'budget:stages=7;budget:items=7;budget:label=16')
    for (const w of warns) assert.ok(w.hint && w.hint !== w.detail, `${w.key} needs a concrete hint`)
    const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture('medallion-over-budget.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:stages=7;budget:items=7;budget:label=16" data-type="medallion" data-scroll="true">/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/medallion.mjs: layout', () => {
  test('stages are equal-width columns left → right in IR order, sharing one height and filling the 720px column', async () => {
    const ir = validIr('medallion-simple.yaml')
    const l = await medallion.layout(ir, { column: 720 })
    assert.ok(l.width <= 720 && l.width >= 700, `width ${l.width} should fill the column`)
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    assert.deepEqual(l.geo.stages.map((c) => c.id), ir.stages.map((s) => s.id))
    for (let i = 1; i < l.geo.stages.length; i++) assert.ok(l.geo.stages[i].x >= l.geo.stages[i - 1].x + l.geo.stages[i - 1].width + 24)
    assert.equal(new Set(l.geo.stages.map((c) => c.width)).size, 1)
    assert.equal(new Set(l.geo.stages.map((c) => c.yTop)).size, 1)
    assert.equal(new Set(l.geo.stages.map((c) => c.height)).size, 1)
    assert.equal(l.geo.stages[0].x, 16, 'no sources → the first column starts at the canvas margin')
    assert.equal(l.geo.sources, undefined)
    assert.equal(l.geo.consumers, undefined)
  })

  test('the tint steps down stage by stage and reaches the plain surface at the last stage', async () => {
    const l = await medallion.layout(validIr('medallion-full.yaml'))
    const tints = l.geo.stages.map((c) => c.tint)
    assert.deepEqual(tints, [0.15, 0.1, 0.05, 0])
    const three = await medallion.layout(validIr('medallion-simple.yaml'))
    assert.deepEqual(three.geo.stages.map((c) => c.tint), [0.1, 0.05, 0])
  })

  test('items stack one per row under the header, properties follow as a muted list, the tallest stage sets the shared height', async () => {
    const ir = validIr('medallion-full.yaml')
    const l = await medallion.layout(ir, { column: 720 })
    const bronze = l.geo.stages.find((c) => c.id === 'bronze')
    const items = l.geo.items.filter((i) => i.stage === 'bronze')
    assert.deepEqual(items.map((i) => i.id), ['bronze-1', 'bronze-2', 'bronze-3'])
    assert.equal(new Set(items.map((i) => i.x)).size, 1, 'items share one x')
    assert.equal(new Set(items.map((i) => i.width)).size, 1)
    for (let i = 1; i < items.length; i++) assert.equal(items[i].y, items[i - 1].y + items[i - 1].height + 8)
    assert.ok(items[0].y >= bronze.yTop + 32 + 8, 'first item sits below the header')
    assert.ok(items[0].x >= bronze.x + 8 && items[0].x + items[0].width <= bronze.x + bronze.width - 8, 'items are centered inside the column')
    const props = l.geo.properties.filter((p) => p.stage === 'bronze')
    assert.deepEqual(props.map((p) => p.text), ['保持 90 日', 'スキーマ検証なし', '追記のみ'])
    assert.ok(props[0].y - 11 > items[2].y + items[2].height, 'properties start below the last item')
    for (let i = 1; i < props.length; i++) assert.equal(props[i].y, props[i - 1].y + 16)
    assert.ok(props[2].y + 8 <= bronze.yBottom)
    // landing (2 items, 2 properties) shares bronze's height (3 items, 3 properties)
    const landing = l.geo.stages.find((c) => c.id === 'landing')
    assert.equal(landing.height, bronze.height)
    const landingProps = l.geo.properties.filter((p) => p.stage === 'landing')
    assert.ok(landingProps[1].y < props[2].y)
  })

  test('promotion arcs leave the from-column, land in the to-column, peak 28px above the columns and carry a centered label', async () => {
    const ir = validIr('medallion-simple.yaml')
    const l = await medallion.layout(ir, { column: 720 })
    assert.equal(l.geo.promotions.length, 2)
    const [bronze, silver, gold] = l.geo.stages
    const [a, b] = l.geo.promotions
    assert.ok(a.x1 > bronze.x + bronze.width / 2 && a.x1 < bronze.x + bronze.width, 'arc starts in the right half of bronze')
    assert.ok(a.x2 > silver.x && a.x2 < silver.x + silver.width / 2, 'arc lands in the left half of silver')
    assert.equal(a.y1, bronze.yTop)
    assert.equal(a.y2, silver.yTop)
    assert.equal(a.peakY, bronze.yTop - 28)
    assert.equal(a.label.text, '検証')
    assert.equal(a.label.x, (a.x1 + a.x2) / 2)
    assert.ok(a.label.y < a.peakY)
    assert.ok(b.x1 > silver.x && b.x2 < gold.x + gold.width)
    assert.equal(bronze.yTop, 16 + 48, 'the arc zone is reserved above the columns')
    const noArcs = await medallion.layout(validateIR({ ...minimal(), promotions: undefined }).ir)
    assert.equal(noArcs.geo.stages[0].yTop, 16, 'no promotions → no arc zone')
    assert.deepEqual(noArcs.geo.promotions, [])
  })

  test('sources sit left of the first stage and consumers right of the last, each with one arrow at the column midline', async () => {
    const ir = validIr('medallion-full.yaml')
    const l = await medallion.layout(ir, { column: 720 })
    const first = l.geo.stages[0]
    const last = l.geo.stages[l.geo.stages.length - 1]
    const midY = first.yTop + first.height / 2
    const { sources, consumers } = l.geo
    assert.equal(sources.entries.length, 3)
    assert.equal(consumers.entries.length, 3)
    assert.ok(sources.x + sources.width < first.x)
    assert.ok(consumers.x > last.x + last.width)
    assert.ok(consumers.x + consumers.width <= l.width)
    assert.ok(sources.arrow.x1 > sources.x + sources.width - 8 && sources.arrow.x2 < first.x && sources.arrow.x2 > sources.arrow.x1)
    assert.ok(consumers.arrow.x1 >= last.x + last.width && consumers.arrow.x2 <= consumers.x && consumers.arrow.x2 > consumers.arrow.x1)
    assert.equal(sources.arrow.y1, sources.arrow.y2)
    assert.ok(Math.abs(sources.arrow.y1 - midY) <= 4)
    assert.ok(sources.entries[0].y > sources.y && sources.entries[2].y <= sources.y + sources.height)
    assert.ok(Math.abs((sources.y + sources.height / 2) - midY) <= 8, 'the name list is centered on the columns')
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ALL_FIXTURES) {
      const ir = validIr(name)
      const a = await medallion.layout(ir, { column: 720 })
      const b = await medallion.layout(ir, { column: 720 })
      assert.deepEqual(a, b, `${name}: layout differs between runs`)
      const r1 = await renderFigure(plugin, ir)
      const r2 = await renderFigure(plugin, ir)
      assert.equal(r1.svg, r2.svg, `${name}: svg differs between runs`)
      const v = await verifyFigure(plugin, ir, r1)
      assert.equal(byName(v.checks, 'grid-4px').ok, true, `${name}: ${byName(v.checks, 'grid-4px').detail}`)
    }
  })
})

// --- verify rows -----------------------------------------------------------

describe('figures/medallion.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of CLEAN_FIXTURES) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
    }
  })

  test('stages-ordered fails on overlap, on a reordered geometry, and on unequal widths', async () => {
    const ir = validIr('medallion-simple.yaml')
    let l = await medallion.layout(ir)
    const silver = l.geo.stages[1]
    silver.x = l.geo.stages[0].x + 16
    let row = byName(medallion.verify(l, ir), 'stages-ordered')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlapping stages: bronze\/silver/)

    l = await medallion.layout(ir)
    l.geo.stages.reverse()
    row = byName(medallion.verify(l, ir), 'stages-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /stage order differs/)

    l = await medallion.layout(ir)
    l.geo.stages[2].width -= 8
    row = byName(medallion.verify(l, ir), 'stages-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /differ in width/)
  })

  test('promotions-adjacent fails for a promotion that skips a stage or runs right → left, even though the schema accepts both', async () => {
    for (const [promotions, re] of [
      [[{ from: 'bronze', to: 'gold' }], /bronze→gold/],
      [[{ from: 'silver', to: 'bronze' }], /silver→bronze/],
    ]) {
      const r = validateIR({ ...minimal(), promotions })
      assert.equal(r.ok, true)
      const rendered = await renderFigure(plugin, r.ir)
      const v = await verifyFigure(plugin, r.ir, rendered)
      assert.equal(v.ok, false)
      const row = byName(v.checks, 'promotions-adjacent')
      assert.equal(row.severity, 'fail')
      assert.equal(row.ok, false)
      assert.match(row.detail, re)
      const html = await renderFigureHtmlChecked(r.ir)
      assert.equal(html.checksOk, false)
      assert.ok(!html.html.includes('data-checks="pass"'))
    }
  })

  test('arc-labels-clear fails when two arc labels collide or a label leaves the canvas', async () => {
    const ir = validIr('medallion-simple.yaml')
    let l = await medallion.layout(ir)
    const [a, b] = l.geo.promotions
    b.label.x = a.label.x + 8
    let row = byName(medallion.verify(l, ir), 'arc-labels-clear')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlapping arc labels: bronze→silver \/ silver→gold/)

    l = await medallion.layout(ir)
    l.geo.promotions[1].label.x = l.width
    row = byName(medallion.verify(l, ir), 'arc-labels-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /leave the canvas: silver→gold/)
  })

  test('items-inside-stage fails on an item or property outside its stage or closer than 8px to its edge', async () => {
    const ir = validIr('medallion-full.yaml')
    let l = await medallion.layout(ir)
    const it = l.geo.items.find((i) => i.id === 'silver-1')
    const silver = l.geo.stages.find((c) => c.id === 'silver')
    it.x = silver.x + 4
    let row = byName(medallion.verify(l, ir), 'items-inside-stage')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /silver-1/)
    it.x = silver.x + silver.width + 40
    assert.equal(byName(medallion.verify(l, ir), 'items-inside-stage').ok, false)

    l = await medallion.layout(ir)
    const prop = l.geo.properties.find((p) => p.stage === 'gold')
    prop.y = l.geo.stages.find((c) => c.id === 'gold').yBottom + 20
    row = byName(medallion.verify(l, ir), 'items-inside-stage')
    assert.equal(row.ok, false)
    assert.match(row.detail, /gold:"保持 無期限"/)
  })

  test('focal-count fails (hard rule) when no stage or more than one stage carries emphasis', async () => {
    for (const [stages, re] of [
      [[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], /no stage carries emphasis/],
      [[{ id: 'a', label: 'A', emphasis: true }, { id: 'b', label: 'B', emphasis: true }, { id: 'c', label: 'C' }], /2 stages carry emphasis: a, b/],
    ]) {
      const r = validateIR({ ...minimal(), stages, promotions: undefined })
      assert.equal(r.ok, true, JSON.stringify(r))
      assert.deepEqual(r.warnings, [], 'the focal rule is a fail row, not a budget warning')
      const v = await verifyFigure(plugin, r.ir, await renderFigure(plugin, r.ir))
      assert.equal(v.ok, false)
      const row = byName(v.checks, 'focal-count')
      assert.equal(row.id, 4)
      assert.equal(row.severity, 'fail')
      assert.equal(row.ok, false)
      assert.match(row.detail, re)
      assert.match(row.hint, /exactly one stage/)
      const html = await renderFigureHtmlChecked(r.ir)
      assert.equal(html.checksOk, false)
    }
    const one = validIr('medallion-simple.yaml')
    const row = byName((await verifyFigure(plugin, one, await renderFigure(plugin, one))).checks, 'focal-count')
    assert.equal(row.ok, true)
    assert.match(row.detail, /one focal stage \("gold"\)/)
  })

  test('the three budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('medallion-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['stage-count', 'budget:stages', 7],
      ['items-per-stage', 'budget:items', 7],
      ['label-length', 'budget:label', 16],
    ])
    const cleanIr = validIr('medallion-full.yaml')
    const clean = await verifyFigure(plugin, cleanIr, await renderFigure(plugin, cleanIr))
    for (const name of ['stage-count', 'items-per-stage', 'label-length']) {
      const row = byName(clean.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/medallion.mjs: draw', () => {
  test('emphasis is the accent stroke + bold label, the tint is a currentColor wash, arcs are curves with an arrowhead, labels are escaped', async () => {
    const raw = { ...minimal(), stages: [{ id: 'a', label: 'A & <B>', items: ['x<y'], properties: ['p>q'] }, { id: 'b', label: 'B', emphasis: true }], promotions: [{ from: 'a', to: 'b', label: 'l&m' }], sources: ['s<'], consumers: undefined }
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    const rendered = await renderFigure(plugin, r.ir)
    const svg = rendered.svg
    assert.match(svg, /<rect id="wu-d-m-s-a-tint"[^>]*fill="currentColor" fill-opacity="0.05"/)
    assert.match(svg, /<rect id="wu-d-m-s-b-tint"[^>]*fill-opacity="0"/)
    assert.match(svg, /<rect id="wu-d-m-s-b" class="wu-focal"[^>]*stroke-width="1.5"/)
    assert.match(svg, /<text id="wu-d-m-s-b-label"[^>]*font-weight="700"/)
    assert.doesNotMatch(svg, /<rect id="wu-d-m-s-a" class=/)
    assert.match(svg, /<text id="wu-d-m-s-a-label"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(svg, /<text id="wu-d-m-i-a-1-label"[^>]*>x&lt;y<\/text>/)
    assert.match(svg, /<text id="wu-d-m-p-0"[^>]*fill="var\(--wu-ink-3\)">p&gt;q<\/text>/)
    assert.match(svg, /<path id="wu-d-m-a-0" d="M\d+ \d+ C[^"]+" fill="none" stroke="currentColor" stroke-width="1" marker-end="url\(#wu-d-m-solid\)"\/>/)
    assert.match(svg, /<text id="wu-d-m-a-0-label"[^>]*text-anchor="middle"[^>]*>l&amp;m<\/text>/)
    assert.match(svg, /<text id="wu-d-m-src-0"[^>]*>s&lt;<\/text>/)
    assert.match(svg, /<line id="wu-d-m-src-arrow"[^>]*marker-end="url\(#wu-d-m-solid\)"/)
    assert.doesNotMatch(svg, /wu-d-m-cons-/)
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}\b/)
    assert.doesNotMatch(svg, /data-tone=/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/medallion.mjs: registry dispatch and CLI', () => {
  test('medallion-simple.yaml and medallion-full.yaml render as data-checks="pass" data-type="medallion" figures', async () => {
    for (const name of CLEAN_FIXTURES) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="medallion">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
      assert.equal(rendered.html.includes('data-scroll="true"'), false, `${name} should fit by scaling, not scroll`)
    }
  })

  test('the registry lists medallion with its limits and doc rows', () => {
    assert.equal(plugin.type, 'medallion')
    assert.deepEqual(plugin.limits, { minStages: 3, maxStages: 6, maxItemsPerStage: 6, maxLabelLen: 14, maxEmphasis: 1 })
    assert.equal(plugin.doc.rows.length, 8)
  })

  test('doc.irExample validates with 3 stages, 2 promotions, 2 sources, 2 consumers, and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.stages.length, 3)
    assert.equal(r.ir.promotions.length, 2)
    assert.equal(r.ir.sources.length, 2)
    assert.equal(r.ir.consumers.length, 2)
    assert.ok(r.ir.stages.every((s) => s.items.length > 0 && s.properties.length > 0))
    assert.equal(r.ir.stages.filter((s) => s.emphasis).length, 1)
    assert.deepEqual(medallion.budgetWarnings(r.ir), [])
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="medallion">/)
  })

  test('--figure prints a verified medallion figure; --json reports warnings for the over-budget fixture', () => {
    const fig = runCli([join(FIXTURES, 'medallion-full.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="medallion">/)
    const json = runCli([join(FIXTURES, 'medallion-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), BUDGET_KEYS)
    assert.match(out.figureHtml, /data-warn="budget:stages=7;budget:items=7;budget:label=16" data-type="medallion"/)
    const warnFig = runCli([join(FIXTURES, 'medallion-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:stages=7/)
  })
})
