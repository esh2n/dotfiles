// `type: radar` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/radar-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as radar from '../../bin/lib/figures/radar.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { COLUMN } from '../../bin/lib/diagram.mjs'

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
const plugin = () => getFigureType('radar')

function rawIr(overrides = {}) {
  return {
    id: 'r', type: 'radar', title: 't',
    axes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    series: [{ id: 's1', label: 'S1', values: { a: 0.2, b: 0.5, c: 1 } }],
    ...overrides,
  }
}

async function rendered(name) {
  const ir = validIr(name)
  const r = await renderFigure(plugin(), ir)
  return { ir, r }
}

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// --- schema ---------------------------------------------------------------

describe('figures/radar.mjs: schema', () => {
  test('a minimal valid radar IR normalizes with max=1 and emphasis=false defaults', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'radar')
    assert.equal(result.ir.max, 1)
    assert.deepEqual(result.ir.series[0], { id: 's1', label: 'S1', values: { a: 0.2, b: 0.5, c: 1 }, emphasis: false })
    assert.deepEqual(result.warnings, [])
  })

  test('fewer than 3 axes is a schema error (no polygon)', () => {
    const result = validateIR(rawIr({ axes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'S', values: { a: 1, b: 1 } }] }))
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'schema')
    assert.match(result.message, /at least 3 axes/)
  })

  test('a series missing an axis value, or naming an unknown axis, is a schema error', () => {
    const missing = validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 1, b: 1 } }] }))
    assert.equal(missing.ok, false)
    assert.match(missing.message, /missing axis "c"/)
    const unknown = validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 1, b: 1, c: 1, zz: 1 } }] }))
    assert.equal(unknown.ok, false)
    assert.match(unknown.message, /unknown axis "zz"/)
  })

  test('non-numeric values, a non-positive max, and duplicate ids are schema errors', () => {
    assert.equal(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 'high', b: 1, c: 1 } }] })).ok, false)
    assert.match(validateIR(rawIr({ max: 0 })).message, /max must be a positive number/)
    assert.match(validateIR(rawIr({ axes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }, { id: 'c', label: 'C' }] })).message, /duplicate axis id/)
    const dupSeries = rawIr({ series: [{ id: 's', label: 'S', values: { a: 1, b: 1, c: 1 } }, { id: 's', label: 'S', values: { a: 1, b: 1, c: 1 } }] })
    assert.match(validateIR(dupSeries).message, /duplicate series id/)
  })

  test('normalize() is idempotent for every fixture', () => {
    for (const name of ['radar-simple.yaml', 'radar-three.yaml', 'radar-over-budget.yaml']) {
      const once = radar.normalize(parseYaml(fixture(name)))
      assert.deepEqual(radar.normalize(once), once, name)
    }
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/radar.mjs: budgets', () => {
  test('the over-budget fixture warns on axes, series and label in stable order', () => {
    const result = validateIR(parseYaml(fixture('radar-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:axes=9;budget:series=4;budget:label=14')
    assert.match(result.warnings[2].detail, /axes\[8\]\.label/)
    assert.match(result.warnings[2].hint, /shorten axes\[8\]\.label/)
  })

  test('exactly 8 axes and 3 series are within budget (at the limit, not over it)', () => {
    const result = validateIR(parseYaml(fixture('radar-three.yaml')))
    assert.equal(result.ok, true)
    assert.equal(result.ir.axes.length, 8)
    assert.equal(result.ir.series.length, 3)
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(plugin().limits, { maxAxes: 8, maxSeries: 3, maxLabelLen: 12 })
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/radar.mjs: layout', () => {
  test('the 8-axis / 3-series figure stays within the column, on the grid, with N vertices per series', async () => {
    const { ir, r } = await rendered('radar-three.yaml')
    assert.ok(r.width <= COLUMN, `width ${r.width} > ${COLUMN}`)
    assert.equal(r.scaled, false)
    assert.equal(r.scroll, false)
    assert.equal(r.width % 4, 0)
    assert.equal(r.height % 4, 0)
    const geo = r.layout.geo
    assert.equal(geo.cx % 4, 0)
    assert.equal(geo.cy % 4, 0)
    assert.equal(geo.rings.length, 4)
    for (const a of geo.axes) { assert.equal(a.label.x % 4, 0); assert.equal(a.label.y % 4, 0) }
    for (const s of geo.series) assert.equal(s.points.length, ir.axes.length)
    assert.equal(r.layout.legend.items.length, 3)
  })

  test('axis labels sit outside the outer ring, anchored by angle (top middle, right start, left end)', async () => {
    const { r } = await rendered('radar-simple.yaml')
    const geo = r.layout.geo
    const [top, right, bottom, left] = geo.axes
    assert.equal(top.label.anchor, 'middle')
    assert.equal(right.label.anchor, 'start')
    assert.equal(bottom.label.anchor, 'middle')
    assert.equal(left.label.anchor, 'end')
    assert.ok(top.label.box.bottom < geo.cy - geo.radius)
    assert.ok(right.label.box.left > geo.cx + geo.radius)
    assert.ok(left.label.box.right < geo.cx - geo.radius)
    assert.ok(bottom.label.box.top > geo.cy + geo.radius)
  })

  test('series are told apart without colour: solid + fill, dashed, dotted; emphasis adds vertex dots', async () => {
    const { r } = await rendered('radar-three.yaml')
    assert.match(r.svg, /<polygon id="wu-d-r3-series-a" points="[^"]+" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"[^>]*\/>/)
    assert.match(r.svg, /<polygon id="wu-d-r3-series-b" [^>]*fill="none"[^>]*stroke-dasharray="6 4"\/>/)
    assert.match(r.svg, /<polygon id="wu-d-r3-series-c" [^>]*fill="none"[^>]*stroke-dasharray="1.5 3.5"\/>/)
    assert.match(r.svg, /<g id="wu-d-r3-series-a-dots"/)
    assert.doesNotMatch(r.svg, /series-b-dots|series-c-dots/)
    assert.match(r.svg, /<g id="wu-d-r3-legend"/)
    assert.match(r.svg, /<text id="wu-d-r3-scale" [^>]*>5<\/text>/)
  })

  test('layout and svg are deterministic: two renders of the same IR are deep-equal / byte-equal', async () => {
    const a = await rendered('radar-three.yaml')
    const b = await rendered('radar-three.yaml')
    assert.deepEqual(a.r.layout, b.r.layout)
    assert.equal(a.r.svg, b.r.svg)
  })

  test('a long axis label shrinks the radius before the dispatcher has to scale', async () => {
    // 17 CJK chars (221px) on the lower-left axis: at the default 160px
    // radius the label would push the canvas past 720px; shrinking the
    // rings brings it back inside the column without scaling.
    const long = validateIR(rawIr({ axes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: '左側に伸びる十七文字の長い軸ラベル' }] }))
    assert.ok(long.ok)
    const r = await renderFigure(plugin(), long.ir)
    assert.ok(r.layout.geo.radius < 160, `radius ${r.layout.geo.radius}`)
    assert.ok(r.layout.geo.radius >= 96)
    assert.ok(r.width <= COLUMN, `width ${r.width}`)
    assert.equal(r.scaled, false)
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/radar.mjs: verify rows', () => {
  test('a clean figure passes every own and shared row; doc.rows lists the own rows', async () => {
    const { ir, r } = await rendered('radar-simple.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.checks.slice(0, 7).map((c) => c.name), radar.doc.rows)
    assert.deepEqual(radar.doc.rows, ['axis-count', 'series-count', 'label-length', 'values-in-range', 'labels-clear', 'polygons-closed', 'series-distinct'])
  })

  test('#4 values-in-range fails on a value above max or below 0', async () => {
    const { ir, r } = await rendered('radar-simple.yaml')
    const over = structuredClone(ir)
    over.series[0].values.speed = 1.2
    const a = await verifyFigure(plugin(), over, r)
    assert.equal(byName(a.checks, 'values-in-range').ok, false)
    assert.match(byName(a.checks, 'values-in-range').detail, /series\[0\]\.values\.speed=1\.2/)
    const neg = structuredClone(ir)
    neg.series[1].values.cost = -0.1
    const b = await verifyFigure(plugin(), neg, r)
    assert.equal(byName(b.checks, 'values-in-range').ok, false)
    assert.equal(b.ok, false)
  })

  test('#5 labels-clear fails when two labels overlap, and when a label is moved onto the rings', async () => {
    const { ir, r } = await rendered('radar-simple.yaml')
    const clash = structuredClone(r)
    clash.layout.geo.axes[1].label.box = { ...clash.layout.geo.axes[0].label.box }
    const a = await verifyFigure(plugin(), ir, clash)
    assert.equal(byName(a.checks, 'labels-clear').ok, false)
    assert.match(byName(a.checks, 'labels-clear').detail, /"speed" overlaps "relevance"/)
    const onRing = structuredClone(r)
    const g = onRing.layout.geo
    g.axes[1].label.box = { left: g.cx + g.radius - 20, top: g.cy - 8, right: g.cx + g.radius + 40, bottom: g.cy + 8 }
    const b = await verifyFigure(plugin(), ir, onRing)
    assert.equal(byName(b.checks, 'labels-clear').ok, false)
    assert.match(byName(b.checks, 'labels-clear').detail, /from the outer ring/)
  })

  test('#6 polygons-closed fails when a series loses a vertex in the geometry or in the svg', async () => {
    const { ir, r } = await rendered('radar-simple.yaml')
    const geoBad = structuredClone(r)
    geoBad.layout.geo.series[0].points.pop()
    const a = await verifyFigure(plugin(), ir, geoBad)
    assert.equal(byName(a.checks, 'polygons-closed').ok, false)
    assert.match(byName(a.checks, 'polygons-closed').detail, /3 vertices, expected 4/)
    const svgBad = structuredClone(r)
    svgBad.svg = svgBad.svg.replace(/(<polygon id="wu-d-r1-series-pg" points=")([^"]+)"/, (_, pre, pts) => `${pre}${pts.split(' ').slice(0, 6).join(' ')}"`)
    const b = await verifyFigure(plugin(), ir, svgBad)
    assert.equal(byName(b.checks, 'polygons-closed').ok, false)
    assert.match(byName(b.checks, 'polygons-closed').detail, /3 points in the svg, expected 4/)
  })

  test('#7 series-distinct fails when two series share a stroke pattern', async () => {
    const { ir, r } = await rendered('radar-simple.yaml')
    const bad = structuredClone(r)
    bad.layout.geo.series[1].dash = bad.layout.geo.series[0].dash
    const result = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(result.checks, 'series-distinct').ok, false)
    assert.match(byName(result.checks, 'series-distinct').detail, /"es" and "pg" both use a solid stroke/)
  })

  test('the shared rows follow the plugin rows and the geometry passes grid-4px', async () => {
    const { ir, r } = await rendered('radar-three.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(byName(result.checks, 'grid-4px').ok, true, byName(result.checks, 'grid-4px').detail)
    assert.equal(byName(result.checks, 'dark-3-state').ok, true)
    assert.equal(byName(result.checks, 'stroke-radius').ok, true)
    assert.equal(byName(result.checks, 'grid-4px').id, 13)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/radar.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('radar-simple and radar-three render as data-checks="pass" data-type="radar" figures', async () => {
    for (const name of ['radar-simple.yaml', 'radar-three.yaml']) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="radar">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the over-budget fixture still passes, carrying data-warn with every geometry row green', async () => {
    const out = await renderFigureHtmlChecked(validIr('radar-over-budget.yaml'), { rawYaml: fixture('radar-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:axes=9;budget:series=4;budget:label=14')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:axes=9;budget:series=4;budget:label=14" data-type="radar">'))
  })

  test('CLI: --figure exits 0 with the figure, --json reports ok + checks, --doc radar renders clean', () => {
    const fig = runCli([join(FIXTURES, 'radar-three.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="radar"/)
    const json = runCli([join(FIXTURES, 'radar-simple.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'polygons-closed' && c.ok))
    const doc = runCli(['--doc', 'radar'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok)
    assert.equal(example.ir.axes.length, 5)
    assert.equal(example.ir.series.length, 2)
    assert.deepEqual(example.warnings, [])
  })
})
