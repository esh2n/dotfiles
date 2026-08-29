// `type: layers` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/layers-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as layers from '../../bin/lib/figures/layers.mjs'
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

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const plugin = getFigureType('layers')

const minimal = () => ({
  id: 's', type: 'layers', title: 't',
  layers: [
    { id: 'ui', label: 'UI', items: ['Web', { id: 'app', label: 'App', tone: 'ts' }] },
    { id: 'api', label: 'API', emphasis: true },
    { id: 'db', label: 'DB', tone: 'rs' },
  ],
  side: { label: 'ctl', items: [{ layer: 'api', text: 'auth' }] },
  arrows: [{ from: 'ui', to: 'api', label: 'call' }],
})

// --- schema ----------------------------------------------------------------

describe('figures/layers.mjs: schema', () => {
  test('a valid IR normalizes: bare-string items get derived ids, defaults filled in', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'layers')
    assert.deepEqual(r.ir.layers[0].items, [
      { id: 'ui-1', label: 'Web', tone: 'neutral' },
      { id: 'app', label: 'App', tone: 'ts' },
    ])
    assert.deepEqual(r.ir.layers[1], { id: 'api', label: 'API', tone: 'neutral', emphasis: true, items: [] })
    assert.deepEqual(r.ir.side, { label: 'ctl', items: [{ layer: 'api', text: 'auth' }] })
    assert.deepEqual(r.ir.arrows, [{ from: 'ui', to: 'api', label: 'call' }])
  })

  test('normalize is idempotent', () => {
    const once = layers.normalize(minimal())
    const twice = layers.normalize(once)
    assert.deepEqual(twice, once)
    const fromFixture = validIr('layers-side.yaml')
    assert.deepEqual(layers.normalize(fromFixture), fromFixture)
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), layers: [] }, /ir\.layers must be a non-empty list/],
      [{ ...minimal(), layers: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }, /duplicate layer id: "a"/],
      [{ ...minimal(), layers: [{ id: 'a', label: 'A', items: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }] }] }, /duplicate item id: "x"/],
      [{ ...minimal(), layers: [{ id: 'a', label: 'A', items: [3] }] }, /ir\.layers\[0\]\.items\[0\] must be a string or a mapping/],
      [{ ...minimal(), layers: [{ id: 'a', label: 'A', tone: 'red' }] }, /ir\.layers\[0\]\.tone must be ts\|rs\|new\|neutral/],
      [{ ...minimal(), layers: [{ id: 'a', label: 'A', emphasis: 'yes' }] }, /ir\.layers\[0\]\.emphasis must be a boolean/],
      [{ ...minimal(), side: { label: 'c', items: [{ layer: 'nope', text: 't' }] } }, /ir\.side\.items\[0\]\.layer references unknown layer "nope"/],
      [{ ...minimal(), side: { items: [{ layer: 'ui', text: 't' }] } }, /ir\.side\.label is required/],
      [{ ...minimal(), arrows: [{ from: 'ui', to: 'zzz' }] }, /ir\.arrows\[0\]\.to references unknown layer "zzz"/],
      [{ ...minimal(), arrows: [{ from: 'ui', to: 'ui' }] }, /ir\.arrows\[0\]: from and to must differ/],
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

describe('figures/layers.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(layers.budgetWarnings(validIr('layers-side.yaml')), [])
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('layers-over-budget.yaml')
    const warns = layers.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), ['budget:layers', 'budget:items', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(warns.map((w) => w.value), [8, 9, 16, 3])
    assert.equal(formatBudgetWarnings(warns), 'budget:layers=8;budget:items=9;budget:label=16;budget:emphasis=3')
    for (const w of warns) assert.ok(w.hint && w.hint !== w.detail, `${w.key} needs a concrete hint`)
    const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture('layers-over-budget.yaml') })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:layers=8;budget:items=9;budget:label=16;budget:emphasis=3" data-type="layers">/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/layers.mjs: layout', () => {
  test('bands stack top → bottom in IR order, full width, and fill the 720px column', async () => {
    const ir = validIr('layers-simple.yaml')
    const l = await layers.layout(ir, { column: 720 })
    assert.equal(l.width, 720)
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    assert.deepEqual(l.geo.bands.map((b) => b.id), ir.layers.map((x) => x.id))
    for (let i = 1; i < l.geo.bands.length; i++) assert.ok(l.geo.bands[i].yTop > l.geo.bands[i - 1].yBottom)
    const widths = new Set(l.geo.bands.map((b) => b.width))
    assert.equal(widths.size, 1)
    assert.equal(l.geo.bands[0].x + l.geo.bands[0].width, 720 - 16)
  })

  test('items wrap at 4 per row and the band grows to hold every row', async () => {
    const ir = validIr('layers-side.yaml')
    const l = await layers.layout(ir, { column: 720 })
    const domain = l.geo.bands.find((b) => b.id === 'domain')
    const items = l.geo.items.filter((i) => i.layer === 'domain')
    assert.equal(items.length, 5)
    const rows = new Set(items.map((i) => i.y))
    assert.equal(rows.size, 2)
    assert.equal(items.slice(0, 4).every((i) => i.y === items[0].y), true)
    assert.ok(items[4].y > items[0].y)
    assert.ok(items[4].y + items[4].height + 8 <= domain.yBottom)
    const single = l.geo.bands.find((b) => b.id === 'storage')
    assert.ok(single.height < domain.height)
  })

  test('the side column sits right of the bands, its entries within their band, width from the longest text', async () => {
    const ir = validIr('layers-side.yaml')
    const l = await layers.layout(ir, { column: 720 })
    const band = l.geo.bands[0]
    assert.ok(l.geo.side.x >= band.x + band.width + 16)
    assert.ok(l.geo.side.x + l.geo.side.width <= l.width)
    assert.equal(l.geo.side.entries.length, 4)
    for (const e of l.geo.side.entries) {
      const b = l.geo.bands.find((x) => x.id === e.layer)
      assert.ok(e.y - 11 >= b.yTop && e.y <= b.yBottom, `${e.layer} entry outside its band`)
    }
    const withoutSide = await layers.layout(validIr('layers-simple.yaml'), { column: 720 })
    assert.equal(withoutSide.geo.side, undefined)
    assert.ok(withoutSide.geo.bands[0].width > band.width, 'bands widen when there is no side column')
  })

  test('arrows run vertically through the gap between the two bands they join', async () => {
    const l = await layers.layout(validIr('layers-simple.yaml'), { column: 720 })
    assert.equal(l.geo.arrows.length, 2)
    const [down, up] = l.geo.arrows
    const [app, transport, network, link] = l.geo.bands
    assert.equal(down.x1, down.x2)
    assert.equal(down.y1, app.yBottom)
    assert.equal(down.y2, transport.yTop)
    assert.equal(up.y1, link.yTop)
    assert.equal(up.y2, network.yBottom)
    assert.ok(up.y1 > up.y2, 'the second arrow points upward')
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ['layers-simple.yaml', 'layers-side.yaml', 'layers-over-budget.yaml']) {
      const ir = validIr(name)
      const a = await layers.layout(ir, { column: 720 })
      const b = await layers.layout(ir, { column: 720 })
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

describe('figures/layers.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of ['layers-simple.yaml', 'layers-side.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
    }
  })

  test('bands-ordered fails when a band is moved above its predecessor', async () => {
    const ir = validIr('layers-simple.yaml')
    const l = await layers.layout(ir)
    const b = l.geo.bands[2]
    const shift = b.yTop - l.geo.bands[1].yTop
    Object.assign(b, { y: b.y - shift, yTop: b.yTop - shift, yBottom: b.yBottom - shift })
    const row = byName(layers.verify(l, ir), 'bands-ordered')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlapping bands: transport\/network/)
  })

  test('bands-ordered fails when the geometry order differs from ir.layers', async () => {
    const ir = validIr('layers-simple.yaml')
    const l = await layers.layout(ir)
    l.geo.bands.reverse()
    const row = byName(layers.verify(l, ir), 'bands-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /band order differs/)
  })

  test('items-inside-band fails on an item closer than 8px to its band edge or outside it', async () => {
    const ir = validIr('layers-side.yaml')
    const l = await layers.layout(ir)
    const it = l.geo.items.find((i) => i.id === 'gw')
    const band = l.geo.bands.find((b) => b.id === 'api')
    it.y = band.yTop + 4
    const row = byName(layers.verify(l, ir), 'items-inside-band')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /gw/)
    it.y = band.yBottom + 40
    assert.equal(byName(layers.verify(l, ir), 'items-inside-band').ok, false)
  })

  test('side-aligned fails when an entry drifts out of its band\'s vertical span', async () => {
    const ir = validIr('layers-side.yaml')
    const l = await layers.layout(ir)
    const e = l.geo.side.entries.find((x) => x.layer === 'storage')
    e.y = l.geo.bands.find((b) => b.id === 'ui').yTop + 20
    const row = byName(layers.verify(l, ir), 'side-aligned')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /storage:"暗号化・保持期限"/)
  })

  test('arrows-adjacent fails for an arrow that skips a layer, even though the schema accepts it', async () => {
    const raw = { ...minimal(), arrows: [{ from: 'ui', to: 'db' }] }
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    const rendered = await renderFigure(plugin, r.ir)
    const v = await verifyFigure(plugin, r.ir, rendered)
    assert.equal(v.ok, false)
    const row = byName(v.checks, 'arrows-adjacent')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /ui→db/)
    const html = await renderFigureHtmlChecked(r.ir)
    assert.equal(html.checksOk, false)
    assert.ok(!html.html.includes('data-checks="pass"'))
  })

  test('arrows-adjacent fails when an adjacent arrow is drawn outside the gap', async () => {
    const ir = validIr('layers-simple.yaml')
    const l = await layers.layout(ir)
    l.geo.arrows[0].y1 -= 16
    assert.equal(byName(layers.verify(l, ir), 'arrows-adjacent').ok, false)
  })

  test('the four budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('layers-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true)
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['layer-count', 'budget:layers', 8],
      ['items-per-layer', 'budget:items', 9],
      ['label-length', 'budget:label', 16],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const clean = await verifyFigure(plugin, validIr('layers-side.yaml'), await renderFigure(plugin, validIr('layers-side.yaml')))
    for (const name of ['layer-count', 'items-per-layer', 'label-length', 'emphasis-count']) {
      const row = byName(clean.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/layers.mjs: draw', () => {
  test('emphasis is the accent stroke + bold label, tone is data-tone on the band rect, labels are escaped', async () => {
    const raw = { ...minimal(), layers: [{ id: 'a', label: 'A & <B>', emphasis: true, tone: 'ts', items: ['x<y'] }, { id: 'b', label: 'B' }], side: undefined, arrows: undefined }
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    const rendered = await renderFigure(plugin, r.ir)
    assert.match(rendered.svg, /<rect id="wu-d-s-l-a" class="wu-focal" data-tone="ts"[^>]*stroke-width="1.5"/)
    assert.match(rendered.svg, /<text id="wu-d-s-l-a-label"[^>]*font-weight="700"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(rendered.svg, /<text id="wu-d-s-i-a-1-label"[^>]*>x&lt;y<\/text>/)
    assert.doesNotMatch(rendered.svg, /<rect id="wu-d-s-l-b" class=/)
    assert.doesNotMatch(rendered.svg, /#[0-9a-fA-F]{6}\b/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/layers.mjs: registry dispatch and CLI', () => {
  test('layers-simple.yaml and layers-side.yaml render as data-checks="pass" data-type="layers" figures', async () => {
    for (const name of ['layers-simple.yaml', 'layers-side.yaml']) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="layers">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the registry lists layers with its limits and doc rows', () => {
    assert.equal(plugin.type, 'layers')
    assert.deepEqual(plugin.limits, { maxLayers: 7, maxItemsPerLayer: 8, maxLabelLen: 14, maxEmphasis: 2 })
    assert.equal(plugin.doc.rows.length, 8)
  })

  test('doc.irExample validates with 4 layers and a 2-entry side column, and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.layers.length, 4)
    assert.equal(r.ir.side.items.length, 2)
    assert.ok(r.ir.layers.every((l) => l.items.length > 0))
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="layers">/)
  })

  test('--figure prints a verified layers figure; --json reports warnings for the over-budget fixture', () => {
    const fig = runCli([join(FIXTURES, 'layers-side.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="layers">/)
    const json = runCli([join(FIXTURES, 'layers-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:layers', 'budget:items', 'budget:label', 'budget:emphasis'])
    assert.match(out.figureHtml, /data-warn="budget:layers=8;budget:items=9;budget:label=16;budget:emphasis=3" data-type="layers"/)
    const warnFig = runCli([join(FIXTURES, 'layers-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:layers=8/)
  })
})
