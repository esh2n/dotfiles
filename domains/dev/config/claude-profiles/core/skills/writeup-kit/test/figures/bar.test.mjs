// `type: bar` — schema, budgets, layout (single / grouped / stacked in both
// orientations, dumbbell horizontal only), verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/bar-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as bar from '../../bin/lib/figures/bar.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { COLUMN } from '../../bin/lib/diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const FIXTURE_NAMES = ['bar-single.yaml', 'bar-grouped.yaml', 'bar-dumbbell.yaml', 'bar-stacked-vertical.yaml', 'bar-over-budget.yaml']
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const plugin = () => getFigureType('bar')

function rawIr(overrides = {}) {
  return {
    id: 'b', type: 'bar', title: 't',
    categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
    series: [{ id: 's1', label: 'S1', values: { a: 10, b: 25, d: 4 } }],
    ...overrides,
  }
}

async function rendered(name) {
  const ir = validIr(name)
  const r = await renderFigure(plugin(), ir)
  return { ir, r }
}

async function renderedRaw(raw) {
  const result = validateIR(raw)
  assert.ok(result.ok, result.message)
  const r = await renderFigure(plugin(), result.ir)
  return { ir: result.ir, r }
}

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// --- schema ---------------------------------------------------------------

describe('figures/bar.mjs: schema', () => {
  test('a minimal IR normalizes with single/horizontal defaults and an absent value as null', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true, result.message)
    assert.equal(result.ir.type, 'bar')
    assert.equal(result.ir.variant, 'single')
    assert.equal(result.ir.orientation, 'horizontal')
    assert.equal(result.ir.allowNegative, false)
    assert.deepEqual(result.ir.emphasis, [])
    assert.deepEqual(result.ir.series[0].values, { a: 10, b: 25, c: null, d: 4 })
    assert.deepEqual(result.warnings, [])
  })

  test('a dumbbell is horizontal only: variant: dumbbell × orientation: vertical is a schema error with a hint', () => {
    const two = [{ id: 'before', label: 'B', values: { a: 1 } }, { id: 'after', label: 'A', values: { a: 2 } }]
    const r = validateIR(rawIr({ variant: 'dumbbell', orientation: 'vertical', series: two }))
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /orientation: vertical cannot be combined with variant: dumbbell — a dumbbell is horizontal only/)
    assert.match(r.message, /use grouped/)
    assert.equal(validateIR(rawIr({ variant: 'dumbbell', orientation: 'horizontal', series: two })).ok, true)
    assert.equal(validateIR(rawIr({ variant: 'grouped', orientation: 'vertical', series: two })).ok, true)
  })

  test('an unknown variant or orientation is a schema error', () => {
    const v = validateIR(rawIr({ variant: 'pie' }))
    assert.equal(v.ok, false)
    assert.equal(v.reason, 'schema')
    assert.match(v.message, /variant must be single\|grouped\|stacked\|dumbbell/)
    assert.match(validateIR(rawIr({ orientation: 'diagonal' })).message, /orientation must be horizontal\|vertical/)
  })

  test('series count is fixed per variant: single needs exactly 1, dumbbell exactly 2', () => {
    const two = [{ id: 's1', label: 'S1', values: { a: 1 } }, { id: 's2', label: 'S2', values: { a: 2 } }]
    assert.match(validateIR(rawIr({ series: two })).message, /exactly 1 series for variant: single/)
    assert.match(validateIR(rawIr({ variant: 'dumbbell' })).message, /exactly 2 series .* dumbbell/)
    assert.equal(validateIR(rawIr({ variant: 'grouped', series: two })).ok, true)
    assert.equal(validateIR(rawIr({ variant: 'dumbbell', series: two })).ok, true)
  })

  test('a negative value is rejected unless allowNegative; stacked never allows it', () => {
    const neg = { series: [{ id: 's1', label: 'S1', values: { a: -3, b: 2 } }] }
    assert.match(validateIR(rawIr(neg)).message, /values\.a is negative \(-3\)/)
    assert.equal(validateIR(rawIr({ ...neg, allowNegative: true })).ok, true)
    assert.match(validateIR(rawIr({ ...neg, allowNegative: true, variant: 'stacked' })).message, /allowNegative cannot be combined with variant: stacked/)
  })

  test('unknown category references, non-numeric values, duplicate ids and bad emphasis are schema errors', () => {
    assert.match(validateIR(rawIr({ series: [{ id: 's1', label: 'S1', values: { zz: 1 } }] })).message, /unknown category "zz"/)
    assert.match(validateIR(rawIr({ series: [{ id: 's1', label: 'S1', values: { a: 'high' } }] })).message, /values\.a must be a finite number or null/)
    assert.match(validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }] })).message, /duplicate category id/)
    assert.match(validateIR(rawIr({ variant: 'grouped', series: [{ id: 's', label: 'S', values: {} }, { id: 's', label: 'S', values: {} }] })).message, /duplicate series id/)
    assert.match(validateIR(rawIr({ emphasis: ['zz'] })).message, /emphasis\[0\] references unknown category "zz"/)
    assert.match(validateIR(rawIr({ emphasis: ['a', 'a'] })).message, /emphasis\[1\] repeats category "a"/)
  })

  test('normalize() is idempotent for every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const once = bar.normalize(parseYaml(fixture(name)))
      assert.deepEqual(bar.normalize(once), once, name)
    }
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/bar.mjs: budgets', () => {
  test('the over-budget fixture warns on categories, series, label and emphasis in stable order', () => {
    const result = validateIR(parseYaml(fixture('bar-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:categories=11;budget:series=4;budget:label=17;budget:emphasis=3')
    assert.match(result.warnings[2].detail, /categories\[10\]\.label/)
    assert.match(result.warnings[2].hint, /shorten categories\[10\]\.label/)
    assert.deepEqual(plugin().limits, { minCategories: 4, maxCategories: 8, maxSeries: 3, maxGroupedSeries: 2, maxLabelLen: 14, maxEmphasis: 1 })
  })

  test('survey budgets: fewer than 4 categories warns, grouped warns above 2 series while stacked allows 3, a second emphasis warns', () => {
    const few = validateIR(rawIr({ categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], series: [{ id: 's1', label: 'S1', values: { a: 10, b: 25, c: 4 } }] }))
    assert.equal(few.ok, true, few.message)
    assert.equal(formatBudgetWarnings(few.warnings), 'budget:categories=3')
    assert.match(few.warnings[0].detail, /3 categories \(guidance 4–8\)/)
    assert.equal(few.warnings[0].limit, 4)
    const three = [{ id: 's1', label: 'S1', values: { a: 1 } }, { id: 's2', label: 'S2', values: { a: 2 } }, { id: 's3', label: 'S3', values: { a: 3 } }]
    const grouped = validateIR(rawIr({ variant: 'grouped', series: three }))
    assert.equal(formatBudgetWarnings(grouped.warnings), 'budget:series=3')
    assert.match(grouped.warnings[0].detail, /3 series \(guidance ≤ 2 for grouped\)/)
    assert.match(grouped.warnings[0].hint, /use stacked/)
    assert.deepEqual(validateIR(rawIr({ variant: 'stacked', series: three })).warnings, [])
    const two = validateIR(rawIr({ emphasis: ['a', 'b'] }))
    assert.equal(formatBudgetWarnings(two.warnings), 'budget:emphasis=2')
    assert.deepEqual(validateIR(rawIr({ emphasis: ['a'] })).warnings, [])
  })

  test('the clean fixtures carry no warnings', () => {
    for (const name of FIXTURE_NAMES.slice(0, 4)) {
      const result = validateIR(parseYaml(fixture(name)))
      assert.deepEqual(result.warnings, [], name)
    }
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/bar.mjs: layout', () => {
  test('single/horizontal: full column, axis 0..150 by 50, bars proportional, null drawn as "—" + footnote, no bar', async () => {
    const { r } = await rendered('bar-single.yaml')
    const g = r.layout.geo
    assert.equal(r.width, COLUMN)
    assert.equal(r.height % 4, 0)
    assert.equal(g.axis.lo, 0)
    assert.equal(g.axis.hi, 150)
    assert.deepEqual(g.axis.ticks.map((t) => t.value), [0, 50, 100, 150])
    assert.equal(g.axis.ticks[3].text, '150 万円')
    assert.equal(g.axis.ticks[0].text, '0')
    assert.equal(g.bars.length, 4)
    for (const b of g.bars) {
      assert.equal(b.left, g.plot.x)
      assert.ok(Math.abs(b.len - b.value * g.axis.scale) <= 1, `${b.category}: ${b.len} vs ${b.value * g.axis.scale}`)
    }
    assert.equal(g.bars.find((b) => b.category === 'compute').emphasis, true)
    assert.deepEqual(g.nas.map((n) => n.category), ['other'])
    assert.equal(g.footnote.text, '欠損: その他')
    assert.match(r.svg, /<text id="wu-d-b1-na-other-cost" data-missing="true"[^>]*>—<\/text>/)
    assert.match(r.svg, /<text id="wu-d-b1-footnote"[^>]*>欠損: その他<\/text>/)
    assert.match(r.svg, /<rect id="wu-d-b1-bar-compute-cost" data-value="128" data-category="compute" data-series="cost"[^>]*class="wu-focal" stroke-width="1.5"\/>/)
    assert.match(r.svg, /<text id="wu-d-b1-cat-compute" [^>]*font-weight="700">コンピュート<\/text>/)
  })

  test('grouped: 2 bars per row told apart by fill-opacity, one legend entry per series; a third series takes the 22% fill', async () => {
    const { r } = await rendered('bar-grouped.yaml')
    const g = r.layout.geo
    assert.equal(g.bars.length, 8)
    const tokyo = g.bars.filter((b) => b.category === 'tokyo')
    assert.deepEqual(tokyo.map((b) => b.seriesIndex), [0, 1])
    assert.ok(tokyo[1].top > tokyo[0].top)
    assert.match(r.svg, /id="wu-d-b2-bar-tokyo-read"[^>]*fill-opacity="0\.85"/)
    assert.match(r.svg, /id="wu-d-b2-bar-tokyo-write"[^>]*fill-opacity="0\.5"/)
    assert.deepEqual(g.legend.items.map((i) => i.id), ['read', 'write'])
    assert.equal(g.footnote, null)
    assert.doesNotMatch(r.svg, /footnote/)
    const stacked = await renderedRaw(rawIr({ variant: 'stacked', series: [
      { id: 's1', label: 'S1', values: { a: 10, b: 5, c: 4, d: 2 } }, { id: 's2', label: 'S2', values: { a: 6, b: 5, c: 4, d: 2 } }, { id: 's3', label: 'S3', values: { a: 3, b: 5, c: 4, d: 2 } },
    ] }))
    assert.match(stacked.r.svg, /id="wu-d-b-bar-a-s3"[^>]*fill-opacity="0\.22"/)
  })

  test('dumbbell: open before / filled after markers, a connecting line carrying the delta, labels on the outer sides', async () => {
    const { r } = await rendered('bar-dumbbell.yaml')
    const g = r.layout.geo
    assert.equal(g.markers.length, 9)
    assert.equal(g.lines.length, 4)
    const search = g.lines.find((l) => l.category === 'search')
    assert.equal(search.delta, -560)
    assert.ok(Math.abs(Math.abs(search.to - search.from) - 560 * g.axis.scale) <= 1)
    const before = g.markers.find((m) => m.category === 'search' && m.series === 'before')
    const after = g.markers.find((m) => m.category === 'search' && m.series === 'after')
    assert.equal(before.filled, false)
    assert.equal(after.filled, true)
    const labelOf = (s) => g.labels.find((l) => l.id === `wu-d-b3-val-search-${s}`)
    assert.equal(labelOf('after').anchor, 'end')       // 260 is the smaller value → label to its left
    assert.equal(labelOf('before').anchor, 'start')    // 820 → label to its right
    assert.ok(labelOf('after').box.right < after.px)
    assert.ok(labelOf('before').box.left > before.px)
    // the export row has no before value: no line, one marker, a "—" in the left gutter and a footnote entry
    assert.equal(g.lines.some((l) => l.category === 'export'), false)
    assert.equal(g.markers.filter((m) => m.category === 'export').length, 1)
    assert.deepEqual(g.nas.map((n) => `${n.category}/${n.series}`), ['export/before'])
    assert.ok(g.nas[0].tx < g.plot.x)
    assert.equal(g.footnote.text, '欠損: エクスポート（導入前）')
    assert.match(r.svg, /<line id="wu-d-b3-delta-search" data-delta="-560"/)
    assert.match(r.svg, /<circle id="wu-d-b3-mark-search-before" data-value="820"[^>]*fill="var\(--wu-surface\)"\/>/)
    assert.match(r.svg, /<circle id="wu-d-b3-legend-before-swatch"[^>]*fill="var\(--wu-surface\)"/)
  })

  test('stacked/vertical: segments stack upward, a 0 segment is not drawn, totals sit above, the canvas is narrower than the column', async () => {
    const { r } = await rendered('bar-stacked-vertical.yaml')
    const g = r.layout.geo
    assert.equal(g.orientation, 'vertical')
    assert.ok(r.width < COLUMN)
    assert.equal(r.width % 4, 0)
    const q1 = g.bars.filter((b) => b.category === 'q1')
    assert.deepEqual(q1.map((b) => b.value), [2, 5, 12])
    assert.ok(Math.abs((q1[0].top) - (q1[1].top + q1[1].h)) <= 0.2, 'sev2 sits on sev1')
    assert.ok(Math.abs((q1[1].top) - (q1[2].top + q1[2].h)) <= 0.2, 'sev3 sits on sev2')
    assert.equal(g.bars.some((b) => b.category === 'q3' && b.series === 'sev1'), false, 'zero segment skipped')
    const total = g.labels.find((l) => l.id === 'wu-d-b4-val-q1-total')
    assert.equal(total.text, '19')
    assert.ok(total.box.bottom <= q1[2].top)
    assert.deepEqual(g.nas.map((n) => `${n.category}/${n.series}`), ['q3/sev3'])
    assert.equal(g.footnote.text, '欠損: Q3（Sev3）')
    assert.match(r.svg, /<text id="wu-d-b4-val-q4-sev1" [^>]*fill="var\(--wu-surface\)">3<\/text>/)
    for (const c of g.catLabels) { assert.equal(c.x % 4, 0); assert.equal(c.y % 4, 0) }
  })

  test('allowNegative extends the axis below 0 instead of moving it; the zero line stays inside the plot', async () => {
    const { ir, r } = await renderedRaw(rawIr({ allowNegative: true, unit: '%', series: [{ id: 'd', label: 'Δ', values: { a: -12, b: 8, c: 3, d: 1 } }] }))
    const g = r.layout.geo
    assert.ok(g.axis.lo < 0 && g.axis.lo <= -12)
    assert.ok(g.axis.hi >= 8)
    assert.ok(g.axis.ticks.some((t) => t.value === 0))
    assert.ok(g.axis.zero > g.plot.x && g.axis.zero < g.plot.x + g.plot.w)
    const neg = g.bars.find((b) => b.value === -12)
    assert.ok(Math.abs(neg.left + neg.len - g.axis.zero) <= 0.2, 'negative bar ends at the zero line')
    const negLabel = g.labels.find((l) => l.id === 'wu-d-b-val-a-d')
    assert.equal(negLabel.anchor, 'end')
    assert.ok(negLabel.box.right < neg.left)
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
  })

  test('layout and svg are deterministic: two renders of the same IR are deep-equal / byte-equal', async () => {
    for (const name of ['bar-dumbbell.yaml', 'bar-grouped.yaml']) {
      const a = await rendered(name)
      const b = await rendered(name)
      assert.deepEqual(a.r.layout, b.r.layout, name)
      assert.equal(a.r.svg, b.r.svg, name)
    }
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/bar.mjs: verify rows', () => {
  test('every fixture passes every own and shared row; doc.rows lists the own rows in order', async () => {
    for (const name of FIXTURE_NAMES.slice(0, 4)) {
      const { ir, r } = await rendered(name)
      const result = await verifyFigure(plugin(), ir, r)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.deepEqual(result.checks.slice(0, 9).map((c) => c.name), bar.doc.rows)
      assert.equal(byName(result.checks, 'grid-4px').ok, true, `${name}: ${byName(result.checks, 'grid-4px').detail}`)
      assert.equal(byName(result.checks, 'grid-4px').id, 15)
    }
    assert.deepEqual(bar.doc.rows, ['category-count', 'series-count', 'label-length', 'emphasis-count', 'axis-from-zero', 'bars-proportional', 'labels-clear', 'legend-series', 'missing-disclosed'])
  })

  test('#4 emphasis-count warns (never fails) above 1 emphasized category', async () => {
    const { ir, r } = await renderedRaw(rawIr({ emphasis: ['a', 'b'] }))
    const result = await verifyFigure(plugin(), ir, r)
    const row = byName(result.checks, 'emphasis-count')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.equal(row.key, 'budget:emphasis')
    assert.equal(row.value, 2)
    assert.equal(result.ok, true)
  })

  test('#5 axis-from-zero fails when the axis is truncated or loses its 0 tick', async () => {
    const { ir, r } = await rendered('bar-single.yaml')
    const truncated = structuredClone(r)
    truncated.layout.geo.axis.lo = 10
    truncated.layout.geo.axis.ticks = truncated.layout.geo.axis.ticks.filter((t) => t.value !== 0)
    const a = await verifyFigure(plugin(), ir, truncated)
    assert.equal(byName(a.checks, 'axis-from-zero').ok, false)
    assert.match(byName(a.checks, 'axis-from-zero').detail, /axis starts at 10, not 0/)
    assert.match(byName(a.checks, 'axis-from-zero').detail, /no tick at 0/)
    assert.equal(a.ok, false)
    const cut = structuredClone(r)
    cut.layout.geo.axis.hi = 100
    const b = await verifyFigure(plugin(), ir, cut)
    assert.match(byName(b.checks, 'axis-from-zero').detail, /cuts off values/)
  })

  test('#6 bars-proportional fails when a drawn width, a marker position, or the geometry disagrees with data-value', async () => {
    const { ir, r } = await rendered('bar-single.yaml')
    const svgBad = structuredClone(r)
    svgBad.svg = svgBad.svg.replace(/(id="wu-d-b1-bar-db-cost" data-value="64"[^>]*width=")([^"]+)"/, (_, pre, w) => `${pre}${parseFloat(w) + 3}"`)
    const a = await verifyFigure(plugin(), ir, svgBad)
    assert.equal(byName(a.checks, 'bars-proportional').ok, false)
    assert.match(byName(a.checks, 'bars-proportional').detail, /svg wu-d-b1-bar-db-cost: drawn [\d.]+px for value 64/)
    const geoBad = structuredClone(r)
    geoBad.layout.geo.bars[0].len += 2
    const b = await verifyFigure(plugin(), ir, geoBad)
    assert.match(byName(b.checks, 'bars-proportional').detail, /bar compute\/cost: length/)
    const d = await rendered('bar-dumbbell.yaml')
    const markBad = structuredClone(d.r)
    markBad.svg = markBad.svg.replace(/(id="wu-d-b3-mark-auth-after" data-value="90"[^>]*cx=")([^"]+)"/, (_, pre, cx) => `${pre}${parseFloat(cx) + 4}"`)
    const c = await verifyFigure(plugin(), d.ir, markBad)
    assert.match(byName(c.checks, 'bars-proportional').detail, /svg wu-d-b3-mark-auth-after: drawn at/)
    const dropped = structuredClone(r)
    dropped.svg = dropped.svg.replace(/<rect id="wu-d-b1-bar-db-cost"[^>]*\/>/, '')
    const e = await verifyFigure(plugin(), ir, dropped)
    assert.match(byName(e.checks, 'bars-proportional').detail, /3 data-value element\(s\) in the svg, expected 4/)
  })

  test('#7 labels-clear fails when two labels overlap', async () => {
    const { ir, r } = await rendered('bar-grouped.yaml')
    const clash = structuredClone(r)
    const labels = clash.layout.geo.labels
    const val = labels.find((l) => l.id === 'wu-d-b2-val-tokyo-read')
    const cat = labels.find((l) => l.id === 'wu-d-b2-cat-tokyo')
    val.box = { ...cat.box }
    const result = await verifyFigure(plugin(), ir, clash)
    assert.equal(byName(result.checks, 'labels-clear').ok, false)
    assert.match(byName(result.checks, 'labels-clear').detail, /cat-tokyo overlaps val-tokyo-read/)
  })

  test('#8 legend-series fails when the legend drops a series or mislabels one', async () => {
    const { ir, r } = await rendered('bar-grouped.yaml')
    const missing = structuredClone(r)
    missing.layout.geo.legend.items.pop()
    missing.svg = missing.svg.replace(/<text id="wu-d-b2-legend-write" data-series="write"[^>]*>[^<]*<\/text>/, '')
    const a = await verifyFigure(plugin(), ir, missing)
    assert.equal(byName(a.checks, 'legend-series').ok, false)
    assert.match(byName(a.checks, 'legend-series').detail, /legend lists \[read\], series are \[read, write\]/)
    assert.match(byName(a.checks, 'legend-series').detail, /series "write" missing from the svg legend/)
    const wrong = structuredClone(r)
    wrong.svg = wrong.svg.replace(/(<text id="wu-d-b2-legend-write" data-series="write"[^>]*>)[^<]*(<\/text>)/, '$1書込$2')
    const b = await verifyFigure(plugin(), ir, wrong)
    assert.match(byName(b.checks, 'legend-series').detail, /legend for "write" reads "書込", series label is "書き込み"/)
  })

  test('#9 missing-disclosed fails when a null value loses its "—" or its footnote entry', async () => {
    const { ir, r } = await rendered('bar-dumbbell.yaml')
    const noFoot = structuredClone(r)
    noFoot.layout.geo.footnote = null
    noFoot.svg = noFoot.svg.replace(/<text id="wu-d-b3-footnote"[^>]*>[^<]*<\/text>/, '')
    const a = await verifyFigure(plugin(), ir, noFoot)
    assert.equal(byName(a.checks, 'missing-disclosed').ok, false)
    assert.match(byName(a.checks, 'missing-disclosed').detail, /export\/before not listed in the footnote/)
    assert.match(byName(a.checks, 'missing-disclosed').detail, /footnote missing from the svg/)
    const noDash = structuredClone(r)
    noDash.layout.geo.nas = []
    noDash.svg = noDash.svg.replace(/<text id="wu-d-b3-na-export-before"[^>]*>[^<]*<\/text>/, '')
    const b = await verifyFigure(plugin(), ir, noDash)
    assert.match(byName(b.checks, 'missing-disclosed').detail, /export\/before has no "—" placeholder; export\/before "—" not in the svg/)
    const g = await rendered('bar-grouped.yaml')
    const spurious = structuredClone(g.r)
    spurious.layout.geo.footnote = { text: '欠損: なし', x: 16, y: 200 }
    const c = await verifyFigure(plugin(), g.ir, spurious)
    assert.match(byName(c.checks, 'missing-disclosed').detail, /footnote present without missing values/)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/bar.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('single, grouped, dumbbell and stacked-vertical render as data-checks="pass" data-type="bar" figures with data-value bindings', async () => {
    for (const name of FIXTURE_NAMES.slice(0, 4)) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="bar">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
      assert.match(out.html, /data-value="/)
      assert.doesNotMatch(out.html, /#[0-9a-fA-F]{3,6}\b|rgb\(/)
    }
  })

  test('the over-budget fixture still passes, carrying data-warn with every geometry row green', async () => {
    const out = await renderFigureHtmlChecked(validIr('bar-over-budget.yaml'), { rawYaml: fixture('bar-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:categories=11;budget:series=4;budget:label=17;budget:emphasis=3')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:categories=11;budget:series=4;budget:label=17;budget:emphasis=3" data-type="bar">'))
  })

  test('CLI: --figure exits 0 with the figure, --json reports ok + checks, --doc bar is a 5-category dumbbell that renders clean', () => {
    const fig = runCli([join(FIXTURES, 'bar-dumbbell.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="bar"/)
    const json = runCli([join(FIXTURES, 'bar-single.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'bars-proportional' && c.ok))
    const doc = runCli(['--doc', 'bar'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok, example.message)
    assert.equal(example.ir.variant, 'dumbbell')
    assert.equal(example.ir.categories.length, 5)
    assert.equal(example.ir.series.length, 2)
    assert.deepEqual(example.warnings, [])
  })
})
