// `type: polar` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/polar-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as polar from '../../bin/lib/figures/polar.mjs'
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
const plugin = () => getFigureType('polar')

function rawIr(overrides = {}) {
  return {
    id: 'p', type: 'polar', title: 't',
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    series: [{ id: 's1', label: 'S1', values: { a: 2, b: 5, c: 10, d: 0 } }],
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

describe('figures/polar.mjs: schema', () => {
  test('a minimal valid polar IR normalizes with min=0, a nice max, start_angle=0, clockwise=true, focal=false', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'polar')
    assert.deepEqual([result.ir.min, result.ir.max, result.ir.start_angle, result.ir.clockwise, result.ir.unit], [0, 10, 0, true, undefined])
    assert.deepEqual(result.ir.categories[0], { id: 'a', label: 'A', focal: false })
    assert.deepEqual(result.ir.series[0], { id: 's1', label: 'S1', values: { a: 2, b: 5, c: 10, d: 0 } })
    assert.deepEqual(result.warnings, [])
    // 12 → 12 (step 1.2), 36 → 40 (step 4), 0.7 → 0.8, all zero → 1, explicit max kept
    const withMax = (vals, extra = {}) => validateIR(rawIr({ series: [{ id: 's', label: 'S', values: vals }], ...extra })).ir.max
    assert.equal(withMax({ a: 1, b: 12, c: 3, d: 0 }), 12)
    assert.equal(withMax({ a: 36, b: 1, c: 3, d: 0 }), 40)
    assert.equal(withMax({ a: 0.7, b: 0.1, c: 0.3, d: 0 }), 0.8)
    assert.equal(withMax({ a: 0, b: 0, c: 0, d: 0 }), 1)
    assert.equal(withMax({ a: 1, b: 2, c: 3, d: 4 }, { max: 25 }), 25)
    // `emphasis` is accepted as an alias of `focal`; min: 0 is accepted; start_angle/clockwise are kept
    const alias = validateIR(rawIr({ min: 0, start_angle: 45, clockwise: false, categories: [{ id: 'a', label: 'A', emphasis: true }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }] }))
    assert.equal(alias.ok, true, JSON.stringify(alias))
    assert.equal(alias.ir.categories[0].focal, true)
    assert.deepEqual([alias.ir.start_angle, alias.ir.clockwise], [45, false])
  })

  test('a second series is a schema error pointing at radar', () => {
    const result = validateIR(parseYaml(fixture('polar-two.yaml')))
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'schema')
    assert.match(result.message, /exactly one series \(got: 2\) — use radar for several series/)
  })

  test('fewer than 3 categories, or a min other than 0, is a schema error', () => {
    const few = validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 's', label: 'S', values: { a: 1, b: 1 } }] }))
    assert.equal(few.ok, false)
    assert.match(few.message, /at least 3 categories/)
    const min = validateIR(rawIr({ min: 2 }))
    assert.equal(min.ok, false)
    assert.match(min.message, /min is fixed at 0/)
  })

  test('a missing category value asks the writer to supply it; an unknown category is a schema error', () => {
    const missing = validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 1, b: 1, c: 1 } }] }))
    assert.equal(missing.ok, false)
    assert.match(missing.message, /missing category "d" — supply its value/)
    const unknown = validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 1, b: 1, c: 1, d: 1, zz: 1 } }] }))
    assert.equal(unknown.ok, false)
    assert.match(unknown.message, /unknown category "zz"/)
  })

  test('non-numeric values, a non-positive max, a bad start_angle/clockwise/unit and duplicate ids are schema errors', () => {
    assert.equal(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: 'high', b: 1, c: 1, d: 1 } }] })).ok, false)
    assert.match(validateIR(rawIr({ max: 0 })).message, /max must be a positive number/)
    assert.match(validateIR(rawIr({ start_angle: 'top' })).message, /start_angle must be a number/)
    assert.match(validateIR(rawIr({ clockwise: 'yes' })).message, /clockwise must be a boolean/)
    assert.match(validateIR(rawIr({ unit: 3 })).message, /unit must be a string/)
    assert.match(validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }, { id: 'c', label: 'C' }] })).message, /duplicate category id/)
  })

  test('normalize() is idempotent for every valid fixture (including the derived max and defaults)', () => {
    for (const name of ['polar-simple.yaml', 'polar-over-budget.yaml']) {
      const once = polar.normalize(parseYaml(fixture(name)))
      assert.deepEqual(polar.normalize(once), once, name)
    }
    const once = polar.normalize(rawIr({ start_angle: 30, clockwise: false }))
    assert.deepEqual(polar.normalize(once), once)
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/polar.mjs: budgets', () => {
  test('the over-budget fixture warns on categories, label and focal in stable order', () => {
    const result = validateIR(parseYaml(fixture('polar-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:categories=10;budget:label=15;budget:focal=2')
    assert.match(result.warnings[1].detail, /categories\[9\]\.label/)
    assert.match(result.warnings[1].hint, /shorten categories\[9\]\.label/)
    assert.match(result.warnings[2].hint, /one category/)
  })

  test('3 categories warns (below 4), 4 and 8 are within budget', () => {
    const three = validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's', label: 'S', values: { a: 1, b: 2, c: 3 } }] }))
    assert.equal(three.ok, true)
    assert.equal(formatBudgetWarnings(three.warnings), 'budget:categories=3')
    assert.match(three.warnings[0].hint, /bar/)
    assert.deepEqual(validateIR(rawIr()).warnings, [])
    const eight = validateIR(parseYaml(fixture('polar-simple.yaml')))
    assert.equal(eight.ir.categories.length, 8)
    assert.deepEqual(eight.warnings, [])
    assert.deepEqual(plugin().limits, { minCategories: 4, maxCategories: 8, maxLabelLen: 12, maxFocal: 1 })
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/polar.mjs: layout', () => {
  test('the 8-category figure stays within the column, on the grid, with 5 rings, a spoke and a lollipop per category', async () => {
    const { ir, r } = await rendered('polar-simple.yaml')
    assert.ok(r.width <= COLUMN, `width ${r.width} > ${COLUMN}`)
    assert.equal(r.scaled, false)
    assert.equal(r.scroll, false)
    assert.equal(r.width % 4, 0)
    assert.equal(r.height % 4, 0)
    const geo = r.layout.geo
    assert.equal(geo.cx % 4, 0)
    assert.equal(geo.cy % 4, 0)
    assert.equal(geo.rings.length, 5)
    assert.equal(geo.rings[4].r, geo.radius)
    assert.equal(geo.categories.length, 8)
    for (const c of geo.categories) { assert.equal(c.label.x % 4, 0); assert.equal(c.label.y % 4, 0) }
    assert.equal(geo.series.lollipops.length, ir.categories.length)
    assert.deepEqual(geo.series.lollipops.map((l) => l.category), ir.categories.map((c) => c.id), 'input order preserved')
    assert.deepEqual(r.layout.legend.items, [{ label: '1 日平均' }])
  })

  test('lollipop length is value / max × outer radius; a zero value draws nothing; the dot is a fixed size', async () => {
    const { ir, r } = await rendered('polar-over-budget.yaml')
    const geo = r.layout.geo
    for (const l of geo.series.lollipops) assert.ok(Math.abs(l.r - (l.value / ir.max) * geo.radius) <= 0.05, `${l.category}: ${l.r}`)
    assert.equal(geo.series.lollipops.find((l) => l.category === 'c10').r, 0)
    assert.doesNotMatch(r.svg, /lollipop-c10/)
    assert.match(r.svg, /<g id="wu-d-p9-lollipop-c07" data-polar-category="c07" data-polar-value="9"><line id="wu-d-p9-lollipop-c07-line" x1="\d+" y1="\d+" x2="[\d.]+" y2="[\d.]+" stroke-width="1"\/><circle id="wu-d-p9-lollipop-c07-dot" cx="[\d.]+" cy="[\d.]+" r="4" fill="var\(--wu-surface\)" stroke-width="1"\/><\/g>/)
    assert.equal((r.svg.match(/data-polar-value=/g) || []).length, 9)
    assert.doesNotMatch(r.svg, /<path[^>]* d="M[^"]*A/, 'no filled wedges (the only <path> is the legend swatch)')
    assert.doesNotMatch(r.svg, /fill-opacity/, 'no area fill')
  })

  test('start_angle and clockwise set where the first category sits and which way the cycle runs', async () => {
    const base = await renderFigure(plugin(), validateIR(rawIr()).ir)
    assert.deepEqual(base.layout.geo.categories.map((c) => c.angle), [-90, 0, 90, 180])
    const turned = await renderFigure(plugin(), validateIR(rawIr({ start_angle: 90 })).ir)
    assert.deepEqual(turned.layout.geo.categories.map((c) => c.angle), [0, 90, 180, 270])
    const ccw = await renderFigure(plugin(), validateIR(rawIr({ clockwise: false })).ir)
    assert.deepEqual(ccw.layout.geo.categories.map((c) => c.angle), [-90, -180, -270, -360])
    assert.equal(ccw.layout.geo.categories[1].label.anchor, 'end', 'second category now on the left')
  })

  test('category labels are horizontal, outside the outer ring, anchored by angle (top middle, right start, left end)', async () => {
    const { r } = await rendered('polar-simple.yaml')
    const geo = r.layout.geo
    const [top, , right, , bottom, , left] = geo.categories
    assert.equal(top.label.anchor, 'middle')
    assert.equal(right.label.anchor, 'start')
    assert.equal(bottom.label.anchor, 'middle')
    assert.equal(left.label.anchor, 'end')
    assert.ok(top.label.box.bottom < geo.cy - geo.radius)
    assert.ok(right.label.box.left > geo.cx + geo.radius)
    assert.ok(left.label.box.right < geo.cx - geo.radius)
    assert.ok(bottom.label.box.top > geo.cy + geo.radius)
    assert.doesNotMatch(r.svg, /rotate\(/)
  })

  test('value labels sit beyond the dot when they fit (inside the line near the outer ring), never on tiny lollipops, never overlapping', async () => {
    const { r } = await rendered('polar-simple.yaml')
    const geo = r.layout.geo
    const values = geo.series.values
    const labelled = values.map((v) => v.category)
    for (const c of ['h15', 'h09', 'h12', 'h18']) assert.ok(labelled.includes(c), `${c} missing from ${labelled.join(',')}`)
    assert.ok(!labelled.includes('h03') && !labelled.includes('h00'), 'lollipops shorter than 20px carry no number')
    const focal = values.find((v) => v.category === 'h15')
    const tip = geo.series.lollipops.find((l) => l.category === 'h15')
    assert.ok(Math.hypot(focal.x - geo.cx, focal.y - geo.cy) < tip.r, 'the 36 label sits inside its lollipop (no room beyond the ring)')
    for (const v of values) { assert.equal(v.x % 4, 0); assert.equal(v.y % 4, 0) }
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const a = values[i].box, b = values[j].box
        assert.ok(!(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom), `${values[i].category} overlaps ${values[j].category}`)
      }
    }
    assert.match(r.svg, /<text id="wu-d-p1-value-h15" x="\d+" y="\d+">36<\/text>/)
    assert.match(r.svg, /<text id="wu-d-p1-scale" [^>]*>40 件<\/text>/)
  })

  test('the focal category is the one filled dot on a heavier line with a bold label; every other dot is open', async () => {
    const { r } = await rendered('polar-simple.yaml')
    assert.match(r.svg, /<g id="wu-d-p1-lollipop-h15" data-polar-category="h15" data-polar-value="36" class="wu-focal"><line [^>]*stroke-width="1.5"\/><circle [^>]*r="4" fill="currentColor" stroke-width="1.5"\/>/)
    assert.equal((r.svg.match(/fill="currentColor" stroke-width="1.5"/g) || []).length, 1)
    assert.match(r.svg, /<text id="wu-d-p1-category-h15-label" [^>]*font-weight="700">15–18 時<\/text>/)
    assert.doesNotMatch(r.svg, /category-h09-label" [^>]*font-weight/)
    assert.match(r.svg, /<g id="wu-d-p1-legend"/)
  })

  test('layout and svg are deterministic: two renders of the same IR are deep-equal / byte-equal', async () => {
    const a = await rendered('polar-simple.yaml')
    const b = await rendered('polar-simple.yaml')
    assert.deepEqual(a.r.layout, b.r.layout)
    assert.equal(a.r.svg, b.r.svg)
  })

  test('a long category label shrinks the radius before the dispatcher has to scale', async () => {
    const long = validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: '左側に伸びる十七文字の長い区分ラベル' }] }))
    assert.ok(long.ok)
    const r = await renderFigure(plugin(), long.ir)
    assert.ok(r.layout.geo.radius < 160, `radius ${r.layout.geo.radius}`)
    assert.ok(r.layout.geo.radius >= 96)
    assert.ok(r.width <= COLUMN)
    assert.equal(r.scaled, false)
  })
})

// --- verify ---------------------------------------------------------------

describe('figures/polar.mjs: verify rows', () => {
  test('a clean render passes every plugin row, in doc order, with the shared rows after them', async () => {
    const { ir, r } = await rendered('polar-simple.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.checks.slice(0, plugin().doc.rows.length).map((c) => c.name), plugin().doc.rows)
    assert.equal(byName(result.checks, 'grid-4px').ok, true, byName(result.checks, 'grid-4px').detail)
    assert.equal(byName(result.checks, 'grid-4px').id, 13)
    assert.deepEqual(result.warnings, [])
  })

  test('#1–#3 the budget rows fail as warn on the over-budget fixture, carrying key/value', async () => {
    const { ir, r } = await rendered('polar-over-budget.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.warnings.map((w) => [w.name, w.key, w.value]), [
      ['category-count', 'budget:categories', 10],
      ['label-length', 'budget:label', 15],
      ['focal-count', 'budget:focal', 2],
    ])
  })

  test('#4 values-in-range fails for a value above max and for a negative value', async () => {
    const over = validateIR(rawIr({ max: 5 }))
    assert.ok(over.ok)
    const a = await verifyFigure(plugin(), over.ir, await renderFigure(plugin(), over.ir))
    assert.equal(byName(a.checks, 'values-in-range').ok, false)
    assert.match(byName(a.checks, 'values-in-range').detail, /series\[0\]\.values\.c=10/)
    assert.equal(a.ok, false)
    const neg = validateIR(rawIr({ series: [{ id: 's', label: 'S', values: { a: -1, b: 1, c: 1, d: 1 } }] }))
    const b = await verifyFigure(plugin(), neg.ir, await renderFigure(plugin(), neg.ir))
    assert.equal(byName(b.checks, 'values-in-range').ok, false)
  })

  test('#5 lollipops-proportional fails when a length drifts in the geometry or the svg, a lollipop goes missing, or a dot encodes size', async () => {
    const { ir, r } = await rendered('polar-simple.yaml')
    const geoBad = structuredClone(r)
    geoBad.layout.geo.series.lollipops[3].r += 3
    const a = await verifyFigure(plugin(), ir, geoBad)
    assert.equal(byName(a.checks, 'lollipops-proportional').ok, false)
    assert.match(byName(a.checks, 'lollipops-proportional').detail, /h09: length/)
    const svgBad = structuredClone(r)
    svgBad.svg = svgBad.svg.replace(/(<line id="wu-d-p1-lollipop-h09-line" x1="\d+" y1="\d+" x2=")([\d.]+)"/, (_, pre, x) => `${pre}${parseFloat(x) + 12}"`)
    const b = await verifyFigure(plugin(), ir, svgBad)
    assert.equal(byName(b.checks, 'lollipops-proportional').ok, false)
    assert.match(byName(b.checks, 'lollipops-proportional').detail, /svg wu-d-p1-lollipop-h09: drawn/)
    const missing = structuredClone(r)
    missing.svg = missing.svg.replace(/<g id="wu-d-p1-lollipop-h09"[\s\S]*?<\/g>/, '')
    const c = await verifyFigure(plugin(), ir, missing)
    assert.match(byName(c.checks, 'lollipops-proportional').detail, /7 data-polar-value lollipop\(s\) in the svg, expected 8/)
    const bigDot = structuredClone(r)
    bigDot.svg = bigDot.svg.replace(/(<circle id="wu-d-p1-lollipop-h15-dot"[^>]*\sr=")4"/, '$19"')
    const d = await verifyFigure(plugin(), ir, bigDot)
    assert.match(byName(d.checks, 'lollipops-proportional').detail, /end dots must all be r=4/)
  })

  test('#6 labels-clear fails when two category labels overlap, when a label sits on the rings, and when a value label hits a category label', async () => {
    const { ir, r } = await rendered('polar-simple.yaml')
    const clash = structuredClone(r)
    clash.layout.geo.categories[1].label.box = { ...clash.layout.geo.categories[0].label.box }
    const a = await verifyFigure(plugin(), ir, clash)
    assert.equal(byName(a.checks, 'labels-clear').ok, false)
    assert.match(byName(a.checks, 'labels-clear').detail, /"h00" overlaps "h03"/)
    const onRing = structuredClone(r)
    const g = onRing.layout.geo
    g.categories[2].label.box = { left: g.cx + g.radius - 20, top: g.cy - 8, right: g.cx + g.radius + 40, bottom: g.cy + 8 }
    const b = await verifyFigure(plugin(), ir, onRing)
    assert.match(byName(b.checks, 'labels-clear').detail, /from the outer ring/)
    const valueHit = structuredClone(r)
    valueHit.layout.geo.series.values[0].box = { ...valueHit.layout.geo.categories[0].label.box }
    const c = await verifyFigure(plugin(), ir, valueHit)
    assert.match(byName(c.checks, 'labels-clear').detail, /value \w+ overlaps label "h00"/)
  })

  test('#7 single-series fails when a second series group appears in the svg or the IR', async () => {
    const { ir, r } = await rendered('polar-simple.yaml')
    const twoGroups = structuredClone(r)
    twoGroups.svg = twoGroups.svg.replace('<g id="wu-d-p1-values"', '<g id="wu-d-p1-series-ghost"></g><g id="wu-d-p1-values"')
    const a = await verifyFigure(plugin(), ir, twoGroups)
    assert.equal(byName(a.checks, 'single-series').ok, false)
    assert.match(byName(a.checks, 'single-series').detail, /2 series group\(s\) in the svg \[avg, ghost\]/)
    assert.match(byName(a.checks, 'single-series').hint, /use radar/)
    const twoSeries = structuredClone(ir)
    twoSeries.series.push({ id: 'x', label: 'X', values: { ...ir.series[0].values } })
    const b = await verifyFigure(plugin(), twoSeries, r)
    assert.match(byName(b.checks, 'single-series').detail, /2 series in the IR/)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/polar.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('polar-simple renders as a data-checks="pass" data-type="polar" figure with the IR embedded', async () => {
    const out = await renderFigureHtmlChecked(validIr('polar-simple.yaml'), { rawYaml: fixture('polar-simple.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="polar">/)
    assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
  })

  test('the over-budget fixture still passes, carrying data-warn with every geometry row green', async () => {
    const out = await renderFigureHtmlChecked(validIr('polar-over-budget.yaml'), { rawYaml: fixture('polar-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:categories=10;budget:label=15;budget:focal=2')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:categories=10;budget:label=15;budget:focal=2" data-type="polar">'))
  })

  test('CLI: --figure exits 0 with the figure, the two-series fixture is a schema error, --json reports ok + checks, --doc polar renders clean', () => {
    const fig = runCli([join(FIXTURES, 'polar-simple.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="polar"/)
    const two = runCli([join(FIXTURES, 'polar-two.yaml'), '--figure'])
    assert.notEqual(two.status, 0)
    assert.match(two.stderr, /use radar for several series/)
    const json = runCli([join(FIXTURES, 'polar-simple.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'lollipops-proportional' && c.ok))
    const doc = runCli(['--doc', 'polar'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok)
    assert.equal(example.ir.categories.length, 8)
    assert.equal(example.ir.series.length, 1)
    assert.equal(example.ir.categories.filter((c) => c.focal).length, 1)
    assert.deepEqual(example.warnings, [])
  })
})
