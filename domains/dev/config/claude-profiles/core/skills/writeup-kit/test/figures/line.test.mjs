// `type: line` (variants line / slopegraph / ridgeline) — schema, budgets,
// layout, verify rows, the registry dispatch and the CLI.
// Fixtures: test/fixtures/line-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as line from '../../bin/lib/figures/line.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { COLUMN } from '../../bin/lib/diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const ALL = ['line-simple.yaml', 'line-slope.yaml', 'line-ridge.yaml', 'line-yfrom.yaml', 'line-over-budget.yaml', 'line-legend.yaml']

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const plugin = () => getFigureType('line')

function rawIr(overrides = {}) {
  return {
    id: 'l', type: 'line', title: 't',
    x: { values: ['a', 'b', 'c'] },
    series: [{ id: 's1', label: 'S1', values: [1, 2, 3] }],
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

describe('figures/line.mjs: schema', () => {
  test('a minimal IR normalizes with variant=line, yFrom=0, emphasis=false defaults', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'line')
    assert.equal(result.ir.variant, 'line')
    assert.equal(result.ir.yFrom, 0)
    assert.deepEqual(result.ir.x, { label: undefined, values: ['a', 'b', 'c'] })
    assert.deepEqual(result.ir.series[0], { id: 's1', label: 'S1', values: [1, 2, 3], emphasis: false })
    assert.deepEqual(result.warnings, [])
  })

  test('unknown variant, a slopegraph without exactly 2 x values, and yFrom on a ridgeline are schema errors', () => {
    assert.match(validateIR(rawIr({ variant: 'spline' })).message, /variant must be line\|slopegraph\|ridgeline/)
    const slope = validateIR(rawIr({ variant: 'slopegraph' }))
    assert.equal(slope.ok, false)
    assert.equal(slope.reason, 'schema')
    assert.match(slope.message, /exactly 2 entries for a slopegraph/)
    assert.match(validateIR(rawIr({ variant: 'ridgeline', yFrom: 1 })).message, /yFrom is not allowed for a ridgeline/)
  })

  test('value lists must match x, hold finite numbers or null, stay above yFrom, and a ridgeline rejects null/negative', () => {
    assert.match(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: [1, 2] }] })).message, /has 2 entries but x.values has 3/)
    assert.match(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: [1, 'x', 3] }] })).message, /must be a finite number or null/)
    assert.match(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: [null, null, null] }] })).message, /no value at all/)
    assert.match(validateIR(rawIr({ yFrom: 2 })).message, /lies below yFrom/)
    assert.match(validateIR(rawIr({ variant: 'ridgeline', series: [{ id: 's', label: 'S', values: [1, null, 3] }] })).message, /ridgeline needs a value at every x/)
    assert.match(validateIR(rawIr({ variant: 'ridgeline', series: [{ id: 's', label: 'S', values: [1, -1, 3] }] })).message, /must be ≥ 0 in a ridgeline/)
    assert.match(validateIR(rawIr({ series: [{ id: 's', label: 'S', values: [1, 2, 3] }, { id: 's', label: 'T', values: [1, 2, 3] }] })).message, /duplicate series id/)
  })

  test('normalize() is idempotent for every fixture', () => {
    for (const name of ALL) {
      const once = line.normalize(parseYaml(fixture(name)))
      assert.deepEqual(line.normalize(once), once, name)
    }
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/line.mjs: budgets', () => {
  test('the over-budget fixture warns on series, x, label and emphasis in stable order', () => {
    const result = validateIR(parseYaml(fixture('line-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:series=5;budget:x=25;budget:label=17;budget:emphasis=3')
    assert.match(result.warnings[2].hint, /shorten series\[4\]\.label/)
  })

  test('a slopegraph counts items (≤ 12) instead of series; 8 items are within budget', () => {
    const ir = validIr('line-slope.yaml')
    assert.deepEqual(line.budgetWarnings(ir), [])
    const many = { ...ir, series: Array.from({ length: 13 }, (_, i) => ({ id: `i${i}`, label: `I${i}`, values: [i, i + 1], emphasis: false })) }
    const w = line.budgetWarnings(many)
    assert.equal(formatBudgetWarnings(w), 'budget:items=13')
    assert.deepEqual(plugin().limits, { maxSeries: 4, maxX: 24, maxItems: 12, maxEmphasis: 2, maxLabelLen: 14 })
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/line.mjs: layout', () => {
  test('line: fits the column, ticks and x positions on the grid, points proportional, direct labels at the line ends', async () => {
    const { ir, r } = await rendered('line-simple.yaml')
    assert.equal(r.width, COLUMN)
    assert.equal(r.scaled, false)
    assert.equal(r.height % 4, 0)
    const geo = r.layout.geo
    assert.equal(geo.labelMode, 'direct')
    assert.equal(geo.scale.ymin, 0)
    assert.equal(geo.scale.ymax, 500)
    for (const t of geo.ticks) assert.equal(t.y % 4, 0)
    for (const l of geo.xLabels) assert.equal(l.x % 4, 0)
    const search = geo.series[0]
    assert.equal(search.points[3].py, null)
    assert.equal(search.segments.length, 2)
    assert.ok(Math.abs(search.points[0].py - (geo.plot.baseline - (420 / 500) * geo.scale.plotH)) < 0.1)
    assert.equal(geo.labels.length, ir.series.length)
    const lastX = geo.series[1].points[7].px
    assert.ok(geo.labels.every((l) => l.anchor === 'start' && l.x === lastX + 8))
    assert.match(r.svg, /<path id="wu-d-l1-series-list" [^>]*stroke-dasharray="6 4"/)
    assert.match(r.svg, /<path id="wu-d-l1-series-detail" [^>]*stroke-dasharray="1.5 3.5"/)
    assert.match(r.svg, /<path id="wu-d-l1-series-search" d="M[^"]*" fill="none" stroke="currentColor" stroke-width="1.5"/)
    assert.equal((r.svg.match(/data-value="/g) || []).length, 23)
    assert.match(r.svg, /<text id="wu-d-l1-note-missing" [^>]*>欠損: 検索（W04）<\/text>/)
    assert.match(r.svg, /<text id="wu-d-l1-y-5" [^>]*>500 ms<\/text>/)
  })

  test('slopegraph: two axes, every item labelled at both ends with its value, labels stacked ≥ 16px apart', async () => {
    const { ir, r } = await rendered('line-slope.yaml')
    const geo = r.layout.geo
    assert.equal(geo.variant, 'slopegraph')
    assert.equal(geo.axes.length, 2)
    assert.ok(r.width <= COLUMN)
    const starts = geo.labels.filter((l) => l.side === 'start')
    const ends = geo.labels.filter((l) => l.side === 'end')
    assert.equal(starts.length, ir.series.length)
    assert.equal(ends.length, ir.series.length)
    for (const group of [starts, ends]) {
      const ys = group.map((l) => l.y).sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 16, `labels ${ys[i - 1]} and ${ys[i]} too close`)
      for (const y of ys) assert.equal(y % 4, 0)
    }
    assert.match(r.svg, /<text id="wu-d-l2-label-search-start" [^>]*font-weight="600">検索 420 ms<\/text>/)
    assert.match(r.svg, /<text id="wu-d-l2-label-search-end" [^>]*>180 ms 検索<\/text>/)
    assert.match(r.svg, /<text id="wu-d-l2-header-0" [^>]*>移行前<\/text>/)
    assert.match(r.svg, /<text id="wu-d-l2-y-bottom" [^>]*>0 ms<\/text>/)
  })

  test('ridgeline: one baseline per row 40px apart, shared amplitude, light fills, row labels at the left', async () => {
    const { ir, r } = await rendered('line-ridge.yaml')
    const geo = r.layout.geo
    assert.equal(geo.rows.length, ir.series.length)
    for (let i = 1; i < geo.rows.length; i++) assert.equal(geo.rows[i].baseline - geo.rows[i - 1].baseline, 40)
    assert.equal(geo.scale.vmax, 34)
    const peak = geo.series[0].points[2]
    assert.equal(peak.py, geo.rows[0].baseline - 56)
    assert.ok(geo.labels.every((l) => l.side === 'row' && l.anchor === 'end'))
    assert.match(r.svg, /<path id="wu-d-l3-ridge-tokyo-mask" d="M[^"]*Z" fill="var\(--wu-surface\)"/)
    assert.match(r.svg, /<path id="wu-d-l3-ridge-virginia" d="M[^"]*Z" fill="currentColor" fill-opacity="0.06"/)
    assert.match(r.svg, /<text id="wu-d-l3-scale" [^>]*>max 34%<\/text>/)
  })

  test('yFrom ≠ 0 draws an axis break and a footnote; long end labels fall back to the legend strip', async () => {
    const { r } = await rendered('line-yfrom.yaml')
    assert.equal(r.layout.geo.scale.ymin, 96)
    assert.match(r.svg, /<g id="wu-d-l4-axis-break">/)
    assert.match(r.svg, /<text id="wu-d-l4-note-yfrom" [^>]*>y 軸は 96% から始まる（0 起点ではない）<\/text>/)
    const { r: legend } = await rendered('line-legend.yaml')
    assert.equal(legend.layout.geo.labelMode, 'legend')
    assert.deepEqual(legend.layout.geo.labels, [])
    assert.equal(legend.layout.legend.items.length, 2)
    assert.match(legend.svg, /<g id="wu-d-l6-legend"/)
  })

  test('layout and svg are deterministic: two renders of the same IR are deep-equal / byte-equal', async () => {
    for (const name of ['line-simple.yaml', 'line-slope.yaml', 'line-ridge.yaml']) {
      const a = await rendered(name)
      const b = await rendered(name)
      assert.deepEqual(a.r.layout, b.r.layout, name)
      assert.equal(a.r.svg, b.r.svg, name)
    }
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/line.mjs: verify rows', () => {
  test('#1–#4 budget rows are warn severity, carry key/value, and never fail the figure', async () => {
    const { ir, r } = await rendered('line-over-budget.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    for (const [name, key, value] of [['series-count', 'budget:series', 5], ['x-count', 'budget:x', 25], ['label-length', 'budget:label', 17], ['emphasis-count', 'budget:emphasis', 3]]) {
      const row = byName(result.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, false)
      assert.equal(row.key, key)
      assert.equal(row.value, value)
    }
    assert.equal(result.warnings.length, 4)
  })

  test('#5 points-proportional fails when a point is moved off its value or a data-value is dropped from the svg', async () => {
    const { ir, r } = await rendered('line-simple.yaml')
    const moved = structuredClone(r)
    moved.layout.geo.series[1].points[2].py += 2
    const a = await verifyFigure(plugin(), ir, moved)
    assert.equal(byName(a.checks, 'points-proportional').ok, false)
    assert.match(byName(a.checks, 'points-proportional').detail, /list\[2\] value 255 drawn at/)
    assert.equal(a.ok, false)
    const stripped = structuredClone(r)
    stripped.svg = stripped.svg.replace(' data-value="140"', '')
    const b = await verifyFigure(plugin(), ir, stripped)
    assert.equal(byName(b.checks, 'points-proportional').ok, false)
    assert.match(byName(b.checks, 'points-proportional').detail, /22 data-value points in the svg, expected 23/)
  })

  test('#6 end-labels-clear fails when two direct labels overlap', async () => {
    const { ir, r } = await rendered('line-slope.yaml')
    const bad = structuredClone(r)
    const ends = bad.layout.geo.labels.filter((l) => l.side === 'end')
    ends[1].box = { ...ends[0].box }
    const result = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(result.checks, 'end-labels-clear').ok, false)
    assert.match(byName(result.checks, 'end-labels-clear').detail, /overlaps/)
  })

  test('#7 series-distinct fails on a repeated stroke pattern (line) or a missing end label (slopegraph)', async () => {
    const { ir, r } = await rendered('line-simple.yaml')
    const bad = structuredClone(r)
    bad.layout.geo.series[1].dash = ''
    const a = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(a.checks, 'series-distinct').ok, false)
    assert.match(byName(a.checks, 'series-distinct').detail, /"search" and "list" both use a solid stroke/)
    const slope = await rendered('line-slope.yaml')
    const noLabel = structuredClone(slope.r)
    noLabel.layout.geo.labels = noLabel.layout.geo.labels.filter((l) => !(l.series === 'list' && l.side === 'end'))
    const b = await verifyFigure(plugin(), slope.ir, noLabel)
    assert.equal(byName(b.checks, 'series-distinct').ok, false)
    assert.match(byName(b.checks, 'series-distinct').detail, /"list" has no end label/)
    // a 6th series repeats a pattern even before any mutation
    const six = validateIR(rawIr({ series: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, values: [i, i + 1, i + 2] })) }))
    assert.equal(six.ok, true)
    const sixR = await renderFigure(plugin(), six.ir)
    assert.equal(byName((await verifyFigure(plugin(), six.ir, sixR)).checks, 'series-distinct').ok, false)
  })

  test('#8 axis-break-disclosed fails when the break marker or the footnote is missing from the svg', async () => {
    const { ir, r } = await rendered('line-yfrom.yaml')
    const good = await verifyFigure(plugin(), ir, r)
    assert.equal(byName(good.checks, 'axis-break-disclosed').ok, true)
    const noBreak = structuredClone(r)
    noBreak.svg = noBreak.svg.replace('id="wu-d-l4-axis-break"', 'id="wu-d-l4-axis-brk"')
    const a = await verifyFigure(plugin(), ir, noBreak)
    assert.equal(byName(a.checks, 'axis-break-disclosed').ok, false)
    assert.match(byName(a.checks, 'axis-break-disclosed').detail, /no axis-break marker drawn/)
    const noNote = structuredClone(r)
    noNote.layout.geo.notes = []
    noNote.svg = noNote.svg.replace('id="wu-d-l4-note-yfrom"', 'id="wu-d-l4-note-x"')
    const b = await verifyFigure(plugin(), ir, noNote)
    assert.equal(byName(b.checks, 'axis-break-disclosed').ok, false)
    assert.match(byName(b.checks, 'axis-break-disclosed').detail, /no yFrom footnote/)
  })

  test('#9 missing-disclosed fails when a null is bridged instead of broken, or the footnote drops the series', async () => {
    const { ir, r } = await rendered('line-simple.yaml')
    const bridged = structuredClone(r)
    const s = bridged.layout.geo.series[0]
    s.segments = [s.segments.flat()]
    const a = await verifyFigure(plugin(), ir, bridged)
    assert.equal(byName(a.checks, 'missing-disclosed').ok, false)
    assert.match(byName(a.checks, 'missing-disclosed').detail, /drawn as 1 segments, expected 2/)
    const unnamed = structuredClone(r)
    unnamed.svg = unnamed.svg.replace('欠損: 検索（W04）', '欠損: あり')
    const b = await verifyFigure(plugin(), ir, unnamed)
    assert.equal(byName(b.checks, 'missing-disclosed').ok, false)
    assert.match(byName(b.checks, 'missing-disclosed').detail, /does not name "検索"/)
  })

  test('the shared rows follow the plugin rows (ids 10+) and every fixture passes them', async () => {
    for (const name of ALL) {
      const { ir, r } = await rendered(name)
      const result = await verifyFigure(plugin(), ir, r)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.equal(byName(result.checks, 'single-finite-svg').id, 10)
      for (const row of ['grid-4px', 'dark-3-state', 'stroke-radius', 'font-size', 'a11y']) {
        assert.equal(byName(result.checks, row).ok, true, `${name} ${row}: ${byName(result.checks, row).detail}`)
      }
    }
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/line.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('line-simple, line-slope and line-ridge render as data-checks="pass" data-type="line" figures', async () => {
    for (const name of ['line-simple.yaml', 'line-slope.yaml', 'line-ridge.yaml']) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="line">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the over-budget fixture still passes, carrying data-warn', async () => {
    const out = await renderFigureHtmlChecked(validIr('line-over-budget.yaml'), { rawYaml: fixture('line-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:series=5;budget:x=25;budget:label=17;budget:emphasis=3')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:series=5;budget:x=25;budget:label=17;budget:emphasis=3" data-type="line">'))
  })

  test('CLI: --figure exits 0, --json reports ok + checks, --doc line is a clean 6-item slopegraph', () => {
    const fig = runCli([join(FIXTURES, 'line-slope.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="line"/)
    const json = runCli([join(FIXTURES, 'line-simple.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'points-proportional' && c.ok))
    const doc = runCli(['--doc', 'line'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok)
    assert.equal(example.ir.variant, 'slopegraph')
    assert.equal(example.ir.series.length, 6)
    assert.deepEqual(example.warnings, [])
  })
})
