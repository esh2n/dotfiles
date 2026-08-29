// `type: scatter` (points / bubbles / series by shape) — schema, budgets,
// layout (scale, grid, bubble area, label nudging), every verify row failing
// on a hand-mutated render, the registry path and the CLI.
// Fixtures: test/fixtures/scatter-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as scatter from '../../bin/lib/figures/scatter.mjs'
import { getFigureType, renderFigure, verifyFigure, PLUGIN_EXPORTS } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { COLUMN } from '../../bin/lib/diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const ALL = ['scatter-simple.yaml', 'scatter-bubble.yaml', 'scatter-from.yaml', 'scatter-over-budget.yaml']

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const plugin = () => getFigureType('scatter')

function rawIr(overrides = {}) {
  return {
    id: 's', type: 'scatter', title: 't',
    x: { label: 'cost' }, y: { label: 'value' },
    points: [{ id: 'a', label: 'A', x: 10, y: 20 }, { id: 'b', x: 30, y: 5 }],
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

describe('figures/scatter.mjs: schema', () => {
  test('the plugin exports exactly the contract and is registered under "scatter"', () => {
    assert.deepEqual(Object.keys(scatter).sort(), [...PLUGIN_EXPORTS].sort())
    const p = plugin()
    assert.ok(p && p.builtin === false)
    assert.equal(p.type, 'scatter')
    assert.deepEqual(p.doc.rows, scatter.doc.rows)
    assert.deepEqual(p.limits, { maxPoints: 30, minBubbles: 5, maxBubbles: 15, maxLabelled: 3, maxLabelLen: 12, maxEmphasis: 2 })
  })

  test('a minimal IR normalizes: axes get from=0, points keep only the fields given, emphasis=false', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'scatter')
    assert.deepEqual(result.ir.x, { label: 'cost', from: 0 })
    assert.deepEqual(result.ir.y, { label: 'value', from: 0 })
    assert.deepEqual(result.ir.points, [{ id: 'a', label: 'A', x: 10, y: 20, emphasis: false }, { id: 'b', x: 30, y: 5, emphasis: false }])
    assert.equal('size' in result.ir, false)
    assert.equal('series' in result.ir, false)
    assert.deepEqual(result.warnings, [])
  })

  test('axes need a label; from must be a finite number; values below an explicit from are rejected', () => {
    assert.match(validateIR(rawIr({ x: { unit: 'ms' } })).message, /ir\.x\.label is required/)
    assert.match(validateIR(rawIr({ y: 'value' })).message, /ir\.y must be a mapping/)
    assert.match(validateIR(rawIr({ x: { label: 'c', from: 'x' } })).message, /ir\.x\.from must be a finite number/)
    assert.match(validateIR(rawIr({ y: { label: 'v', from: 10 } })).message, /points\[1\]\.y \(5\) lies below y\.from \(10\)/)
    // the default 0 start tolerates negatives: the axis extends below 0
    assert.equal(validateIR(rawIr({ points: [{ id: 'a', x: -5, y: 3 }] })).ok, true)
  })

  test('points: ids unique, x/y finite, size only with a size axis (and then required, > 0), series only when declared', () => {
    assert.match(validateIR(rawIr({ points: [] })).message, /ir\.points must be a non-empty list/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: 1, y: 1 }, { id: 'a', x: 2, y: 2 }] })).message, /duplicate point id: "a"/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: '1', y: 1 }] })).message, /points\[0\]\.x must be a finite number/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: 1, y: 1, size: 3 }] })).message, /points\[0\]\.size is set but ir\.size .* is not declared/)
    assert.match(validateIR(rawIr({ size: { label: 'n' }, points: [{ id: 'a', x: 1, y: 1 }] })).message, /points\[0\]\.size must be a positive number/)
    assert.match(validateIR(rawIr({ size: { label: 'n' }, points: [{ id: 'a', x: 1, y: 1, size: 0 }] })).message, /points\[0\]\.size must be a positive number/)
    assert.match(validateIR(rawIr({ size: 'n' })).message, /ir\.size must be a mapping/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: 1, y: 1, series: 'k' }] })).message, /points\[0\]\.series is set but ir\.series is not declared/)
    assert.match(validateIR(rawIr({ series: [{ id: 'k', label: 'K' }] })).message, /points\[0\]\.series must name one of k/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: 1, y: 1, label: '' }] })).message, /points\[0\]\.label must be a non-empty string/)
    assert.match(validateIR(rawIr({ points: [{ id: 'a', x: 1, y: 1, emphasis: 'yes' }] })).message, /points\[0\]\.emphasis must be a boolean/)
  })

  test('series: ≤ 3 (one marker shape each), unique ids, id + label required', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }))
    assert.match(validateIR(rawIr({ series: four })).message, /ir\.series has 4 entries — at most 3 series/)
    assert.match(validateIR(rawIr({ series: [] })).message, /ir\.series must be a non-empty list/)
    assert.match(validateIR(rawIr({ series: [{ id: 'k', label: 'K' }, { id: 'k', label: 'L' }] })).message, /duplicate series id: "k"/)
    assert.match(validateIR(rawIr({ series: [{ id: 'k' }] })).message, /ir\.series\[0\]\.label is required/)
    const ok = validateIR(rawIr({ series: [{ id: 'k', label: 'K' }], points: [{ id: 'a', x: 1, y: 1, series: 'k' }] }))
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.ir.series, [{ id: 'k', label: 'K' }])
  })

  test('normalize() is idempotent for every fixture (embedded IR re-validates unchanged)', () => {
    for (const name of ALL) {
      const once = scatter.normalize(parseYaml(fixture(name)))
      assert.deepEqual(scatter.normalize(once), once, name)
    }
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/scatter.mjs: budgets', () => {
  test('the over-budget fixture warns on points, labels, label length and emphasis in stable order', () => {
    const result = validateIR(parseYaml(fixture('scatter-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:points=31;budget:labels=13;budget:label=13;budget:emphasis=3')
    assert.match(result.warnings[2].hint, /shorten "とても長いラベルの点その一"/)
    for (const name of ['scatter-simple.yaml', 'scatter-bubble.yaml']) {
      assert.deepEqual(scatter.budgetWarnings(validIr(name)), [], name)
    }
  })

  test('a fourth label warns (survey: label 2–3 points); bubbles warn outside 5–15; a cut axis carries axis:from', () => {
    const four = validateIR(rawIr({ points: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, label: `L${i}`, x: i, y: i })) }))
    assert.equal(formatBudgetWarnings(four.warnings), 'budget:labels=4')
    assert.match(four.warnings[0].hint, /label only the 2–3 points/)
    const bubbles = (n) => validateIR(rawIr({ size: { label: 'n' }, points: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: i, y: i, size: i + 1 })) }))
    assert.equal(formatBudgetWarnings(bubbles(4).warnings), 'budget:bubbles=4')
    assert.match(bubbles(4).warnings[0].detail, /4 bubble\(s\) \(guidance 5–15\)/)
    assert.deepEqual(bubbles(5).warnings, [])
    assert.deepEqual(bubbles(15).warnings, [])
    assert.equal(formatBudgetWarnings(bubbles(16).warnings), 'budget:bubbles=16')
    assert.match(bubbles(16).warnings[0].hint, /drop the size axis/)
    const from = validateIR(parseYaml(fixture('scatter-from.yaml')))
    assert.equal(formatBudgetWarnings(from.warnings), 'axis:from=1')
    assert.match(from.warnings[0].detail, /y axis starts at 96% \(guidance: axes start at 0\)/)
    assert.match(from.warnings[0].hint, /tolerated for a scatter only/)
    assert.equal(formatBudgetWarnings(validateIR(rawIr({ x: { label: 'c', from: 5 }, y: { label: 'v', from: 2 } })).warnings), 'axis:from=2')
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/scatter.mjs: layout', () => {
  test('simple: fits the column, nice ticks on the grid, every marker proportional to its value, only labelled points get a label', async () => {
    const { ir, r } = await rendered('scatter-simple.yaml')
    assert.ok(r.width <= COLUMN)
    assert.equal(r.scaled, false)
    assert.equal(r.width % 4, 0)
    assert.equal(r.height % 4, 0)
    const geo = r.layout.geo
    assert.deepEqual(geo.scale.x.ticks, [0, 100, 200, 300, 400])
    assert.deepEqual(geo.scale.y.ticks, [0, 200, 400, 600, 800, 1000])
    for (const t of geo.xTicks) assert.equal(t.x % 4, 0)
    for (const t of geo.yTicks) assert.equal(t.y % 4, 0)
    const search = geo.markers.find((m) => m.id === 'search')
    const sx = geo.scale.x
    assert.ok(Math.abs(search.px - (sx.left + (120 / 400) * sx.width)) < 0.1)
    assert.equal(search.r, 6)                               // emphasized dot
    assert.equal(geo.markers.find((m) => m.id === 'list').r, 5)
    assert.equal(geo.labels.length, ir.points.filter((p) => p.label).length)
    assert.ok(geo.labels.every((l) => l.x % 4 === 0 && l.y % 4 === 0))
    assert.equal(geo.legend, undefined)
    assert.deepEqual(geo.notes, [])
    assert.match(r.svg, /<circle id="wu-d-s1-p-search" cx="[\d.]+" cy="[\d.]+" r="6" data-x="120" data-y="420" fill="currentColor" stroke="var\(--wu-accent\)" stroke-width="1.5"\/>/)
    assert.match(r.svg, /<text id="wu-d-s1-p-search-label" [^>]*font-weight="700"[^>]*>検索<\/text>/)
    assert.doesNotMatch(r.svg, /wu-d-s1-p-login-label/)
    assert.match(r.svg, /<text id="wu-d-s1-x-title" [^>]*>リクエスト数（千\/日）<\/text>/)
    // the y title is a horizontal row above the frame at the top-left — never rotated
    assert.match(r.svg, /<text id="wu-d-s1-y-title" x="16" y="28" font-size="13" fill="currentColor">p95（ms）<\/text>/)
    assert.doesNotMatch(r.svg, /rotate\(/)
    assert.equal(geo.yTitle.y + geo.yTitle.height <= geo.plot.y, true)
    assert.equal(geo.yTitle.x, 16)
    assert.equal(geo.plot.y, 36)
    assert.equal((r.svg.match(/data-x="/g) || []).length, ir.points.length)
  })

  test('bubble: area ∝ size (r = 24·√(size/max)), largest drawn first, shapes per series, footnote + reference bubble in the legend', async () => {
    const { ir, r } = await rendered('scatter-bubble.yaml')
    const geo = r.layout.geo
    assert.equal(geo.scale.sizeMax, 5200)
    assert.equal(geo.scale.rMax, 24)
    for (const m of geo.markers) {
      const p = ir.points.find((q) => q.id === m.id)
      assert.ok(Math.abs(m.r * m.r / 576 - p.size / 5200) <= 0.02 * (p.size / 5200), `${m.id} area`)
      assert.equal(m.shape, p.series === 'platform' ? 'circle' : 'square')
    }
    assert.equal(geo.order[0], 'search')
    assert.equal(geo.order[geo.order.length - 1], 'audit')
    const rs = geo.order.map((id) => geo.markers.find((m) => m.id === id).r)
    for (let i = 1; i < rs.length; i++) assert.ok(rs[i] <= rs[i - 1])
    // the frame keeps a 28px inset so a bubble at the axis maximum clears it
    assert.equal(geo.inner.x - geo.plot.x, 28)
    assert.equal(geo.notes.map((n) => n.key).join(','), 'size')
    assert.match(r.svg, /<text id="wu-d-s2-note-size" [^>]*>円の面積 = 影響ユーザー数<\/text>/)
    assert.deepEqual(geo.legend.items.map((it) => it.kind), ['series', 'series', 'size'])
    assert.equal(geo.legend.items[2].value, 1000)
    assert.match(r.svg, /<circle id="wu-d-s2-legend-size" [^>]*data-size="1000"/)
    assert.match(r.svg, /<text x="\d+" y="\d+">= 1000人<\/text>/)
    assert.match(r.svg, /<rect id="wu-d-s2-legend-feature" /)
    assert.match(r.svg, /<circle id="wu-d-s2-p-cache" [^>]*data-size="4200" fill="currentColor" fill-opacity="0.12" stroke="var\(--wu-accent\)" stroke-width="1.5"\/>/)
    assert.match(r.svg, /<rect id="wu-d-s2-p-search" [^>]*data-x="45" data-y="80" data-size="5200"/)
    const pts = r.svg.indexOf('id="wu-d-s2-p-search"')
    const aud = r.svg.indexOf('id="wu-d-s2-p-audit"')
    assert.ok(pts < aud, 'largest bubble is drawn first')
  })

  test('from ≠ 0: the axis starts there, a break marker and a footnote are drawn; three series use circle / square / triangle', async () => {
    const { r } = await rendered('scatter-from.yaml')
    const geo = r.layout.geo
    assert.equal(geo.scale.y.vmin, 96)
    assert.equal(geo.scale.y.ticks[0], 96)
    assert.deepEqual(geo.axisBreaks.map((b) => b.axis), ['y'])
    assert.match(r.svg, /<g id="wu-d-s3-axis-break-y">/)
    assert.match(r.svg, /<text id="wu-d-s3-note-yfrom" [^>]*>y 軸は 96% から始まる（0 起点ではない）<\/text>/)
    const ir = validIr('scatter-from.yaml')
    const v = await verifyFigure(plugin(), ir, r)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.equal(byName(v.checks, 'axis-break-disclosed').ok, true)
    const warn = byName(v.checks, 'axis-from-zero')
    assert.equal(warn.severity, 'warn')
    assert.equal(warn.ok, false)
    assert.equal(warn.key, 'axis:from')
    assert.equal(warn.value, 1)
    assert.deepEqual(v.warnings.map((w) => w.key), ['axis:from'])
    assert.deepEqual(geo.legend.items.filter((it) => it.kind === 'series').map((it) => it.shape), ['circle', 'square', 'triangle'])
    assert.match(r.svg, /<polygon id="wu-d-s3-p-b1" points="[^"]+" data-x="1500" data-y="96.5" fill="currentColor" stroke="var\(--wu-accent\)" stroke-width="1.5"\/>/)
    assert.match(r.svg, /<rect id="wu-d-s3-p-w1" x="[\d.]+" y="[\d.]+" width="8.86" height="8.86" data-x="900"/)
  })

  test('three labelled points at one spot: a is pushed past c\'s marker (leader), b takes the left side (no leader), c is nudged up (leader)', async () => {
    const ir = validateIR(rawIr({ points: [
      { id: 'a', label: 'Alpha', x: 10, y: 10 },
      { id: 'b', label: 'Beta', x: 10, y: 10 },
      { id: 'c', label: 'Gamma', x: 10.5, y: 10 },
      { id: 'd', x: 30, y: 20 },
    ] })).ir
    const r = await renderFigure(plugin(), ir)
    const [a, b, c] = r.layout.geo.labels
    assert.equal(a.side, 'right')
    assert.ok(a.leader, 'a label pushed clear of another marker carries a leader')
    assert.equal(b.side, 'left')
    assert.equal(b.leader, undefined)
    assert.equal(c.side, 'right')
    assert.ok(c.y < a.y, 'c is nudged above a')
    assert.ok(c.leader, 'nudged label carries a leader')
    for (const l of [a, c]) {
      assert.equal(l.leader.x2 % 4, 0)
      assert.equal(l.leader.y2 % 4, 0)
    }
    const v = await verifyFigure(plugin(), ir, r)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.match(r.svg, /<line id="wu-d-s-p-c-leader" /)
  })

  test('layout and svg are deterministic across runs', async () => {
    for (const name of ALL) {
      const a = await rendered(name)
      const b = await rendered(name)
      assert.deepEqual(a.r.layout, b.r.layout, name)
      assert.equal(a.r.svg, b.r.svg, name)
    }
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/scatter.mjs: verify rows', () => {
  test('doc.rows lists the eleven own rows in verify() order and the shared rows follow from id 12', async () => {
    const { ir, r } = await rendered('scatter-simple.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.deepEqual(result.checks.slice(0, 11).map((c) => c.name), scatter.doc.rows)
    assert.deepEqual(result.checks.slice(0, 11).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    assert.equal(byName(result.checks, 'single-finite-svg').id, 12)
    assert.equal(byName(result.checks, 'axis-from-zero').ok, true)
    assert.equal(byName(result.checks, 'axis-from-zero').detail, 'both axes start at 0')
    for (const name of ALL) {
      const x = await rendered(name)
      const v = await verifyFigure(plugin(), x.ir, x.r)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      for (const row of ['grid-4px', 'dark-3-state', 'stroke-radius', 'font-size', 'a11y', 'projected-scale']) {
        assert.equal(byName(v.checks, row).ok, true, `${name} ${row}: ${byName(v.checks, row).detail}`)
      }
    }
  })

  test('#1 points-in-plot fails when a marker (with its radius) leaves the frame', async () => {
    const { ir, r } = await rendered('scatter-bubble.yaml')
    const bad = structuredClone(r)
    const m = bad.layout.geo.markers.find((x) => x.id === 'search')
    m.py = bad.layout.geo.plot.y + 4
    const v = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(v.checks, 'points-in-plot').ok, false)
    assert.match(byName(v.checks, 'points-in-plot').detail, /leaving the plot: search/)
    assert.equal(v.ok, false)
  })

  test('#2 points-proportional fails when a centre drifts off its value by > 1px or a data-x is dropped from the svg', async () => {
    const { ir, r } = await rendered('scatter-simple.yaml')
    const moved = structuredClone(r)
    moved.layout.geo.markers[1].py += 2
    const a = await verifyFigure(plugin(), ir, moved)
    assert.equal(byName(a.checks, 'points-proportional').ok, false)
    assert.match(byName(a.checks, 'points-proportional').detail, /list y=260 drawn at/)
    const stripped = structuredClone(r)
    stripped.svg = stripped.svg.replace(' data-x="80"', '')
    const b = await verifyFigure(plugin(), ir, stripped)
    assert.equal(byName(b.checks, 'points-proportional').ok, false)
    assert.match(byName(b.checks, 'points-proportional').detail, /6 data-x \/ 7 data-y markers in the svg, expected 7/)
  })

  test('#3 bubble-area-proportional fails on a radius ∝ value, a small-first draw order, or a missing footnote / reference bubble', async () => {
    const { ir, r } = await rendered('scatter-bubble.yaml')
    const radius = structuredClone(r)
    const m = radius.layout.geo.markers.find((x) => x.id === 'batch')
    m.r = 24 * (900 / 5200)                                   // radius ∝ value — the one forbidden error
    const a = await verifyFigure(plugin(), ir, radius)
    assert.equal(byName(a.checks, 'bubble-area-proportional').ok, false)
    assert.match(byName(a.checks, 'bubble-area-proportional').detail, /batch size 900 drawn with r=/)
    const order = structuredClone(r)
    order.layout.geo.order.reverse()
    const b = await verifyFigure(plugin(), ir, order)
    assert.match(byName(b.checks, 'bubble-area-proportional').detail, /not drawn largest first/)
    const note = structuredClone(r)
    note.layout.geo.notes = []
    note.svg = note.svg.replace('id="wu-d-s2-note-size"', 'id="wu-d-s2-note-x"')
    const c = await verifyFigure(plugin(), ir, note)
    assert.match(byName(c.checks, 'bubble-area-proportional').detail, /no 「円の面積 = …」 footnote in the geometry; no size footnote drawn/)
    const legend = structuredClone(r)
    legend.layout.geo.legend.items = legend.layout.geo.legend.items.filter((it) => it.kind !== 'size')
    legend.svg = legend.svg.replace('id="wu-d-s2-legend-size"', 'id="wu-d-s2-legend-x"')
    const d = await verifyFigure(plugin(), ir, legend)
    assert.match(byName(d.checks, 'bubble-area-proportional').detail, /no reference bubble in the legend; no reference bubble drawn/)
    const simple = await rendered('scatter-simple.yaml')
    const e = await verifyFigure(plugin(), simple.ir, simple.r)
    assert.equal(byName(e.checks, 'bubble-area-proportional').detail, 'no size axis — uniform markers')
  })

  test('#4 labels-no-overlap fails for two coincident label boxes, a label over another marker, or a label outside the plot', async () => {
    const { ir, r } = await rendered('scatter-simple.yaml')
    const same = structuredClone(r)
    same.layout.geo.labels[1].x = same.layout.geo.labels[0].x
    same.layout.geo.labels[1].y = same.layout.geo.labels[0].y
    const a = await verifyFigure(plugin(), ir, same)
    assert.equal(byName(a.checks, 'labels-no-overlap').ok, false)
    assert.match(byName(a.checks, 'labels-no-overlap').detail, /search\/list/)
    const over = structuredClone(r)
    const login = over.layout.geo.markers.find((m) => m.id === 'login')
    over.layout.geo.labels[2].x = Math.round(login.px / 4) * 4 - 8
    over.layout.geo.labels[2].y = Math.round(login.py / 4) * 4 - 8
    const b = await verifyFigure(plugin(), ir, over)
    assert.match(byName(b.checks, 'labels-no-overlap').detail, /detail→login marker/)
    const out = structuredClone(r)
    out.layout.geo.labels[0].x = out.layout.geo.plot.x + out.layout.geo.plot.width
    const c = await verifyFigure(plugin(), ir, out)
    assert.match(byName(c.checks, 'labels-no-overlap').detail, /search leaves the plot/)
    // no clear slot at all: the layout flags the label and the figure fails instead of shipping overlaps
    const crowd = validateIR(rawIr({ points: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, label: `ラベルがとても長い点 ${i}`, x: 10, y: 10 })) })).ir
    const cr = await renderFigure(plugin(), crowd)
    assert.ok(cr.layout.geo.labels.some((l) => l.collides))
    const d = await verifyFigure(plugin(), crowd, cr)
    assert.equal(byName(d.checks, 'labels-no-overlap').ok, false)
    assert.match(byName(d.checks, 'labels-no-overlap').detail, /found no clear slot/)
  })

  test('#5 series-distinct fails when two series share a shape or a marker carries the wrong shape', async () => {
    const { ir, r } = await rendered('scatter-from.yaml')
    const shared = structuredClone(r)
    shared.layout.geo.legend.items[1].shape = 'circle'
    const a = await verifyFigure(plugin(), ir, shared)
    assert.equal(byName(a.checks, 'series-distinct').ok, false)
    assert.match(byName(a.checks, 'series-distinct').detail, /"api" and "web" both use the circle/)
    const wrong = structuredClone(r)
    wrong.layout.geo.markers.find((m) => m.id === 'w1').shape = 'triangle'
    const b = await verifyFigure(plugin(), ir, wrong)
    assert.match(byName(b.checks, 'series-distinct').detail, /w1 is a triangle but its series "web" is the square/)
    const missing = structuredClone(r)
    missing.layout.geo.legend.items = missing.layout.geo.legend.items.filter((it) => it.id !== 'batch')
    const c = await verifyFigure(plugin(), ir, missing)
    assert.match(byName(c.checks, 'series-distinct').detail, /series "batch" has no legend entry/)
    const single = await rendered('scatter-simple.yaml')
    assert.equal(byName((await verifyFigure(plugin(), single.ir, single.r)).checks, 'series-distinct').detail, 'single series')
  })

  test('#6 axis-break-disclosed fails when the break marker or the footnote is missing', async () => {
    const { ir, r } = await rendered('scatter-from.yaml')
    const good = await verifyFigure(plugin(), ir, r)
    assert.equal(byName(good.checks, 'axis-break-disclosed').ok, true)
    const noBreak = structuredClone(r)
    noBreak.layout.geo.axisBreaks = []
    noBreak.svg = noBreak.svg.replace('id="wu-d-s3-axis-break-y"', 'id="wu-d-s3-axis-brk"')
    const a = await verifyFigure(plugin(), ir, noBreak)
    assert.equal(byName(a.checks, 'axis-break-disclosed').ok, false)
    assert.match(byName(a.checks, 'axis-break-disclosed').detail, /no y axis-break marker in the geometry; no y axis-break marker drawn/)
    const noNote = structuredClone(r)
    noNote.svg = noNote.svg.replace('id="wu-d-s3-note-yfrom"', 'id="wu-d-s3-note-x"')
    const b = await verifyFigure(plugin(), ir, noNote)
    assert.match(byName(b.checks, 'axis-break-disclosed').detail, /no y\.from footnote drawn/)
    // an x break is drawn on the bottom edge
    const xr = validateIR(rawIr({ x: { label: 'c', from: 5 }, points: [{ id: 'a', x: 10, y: 1 }] }))
    const xrr = await renderFigure(plugin(), xr.ir)
    assert.match(xrr.svg, /<g id="wu-d-s-axis-break-x">/)
    assert.match(xrr.svg, /<text id="wu-d-s-note-xfrom" [^>]*>x 軸は 5 から始まる（0 起点ではない）<\/text>/)
    assert.equal(byName((await verifyFigure(plugin(), xr.ir, xrr)).checks, 'axis-break-disclosed').ok, true)
  })

  test('#7–#10 budget rows are warn severity, carry key/value from budgetWarnings(), and never fail the figure', async () => {
    const { ir, r } = await rendered('scatter-over-budget.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    for (const [name, key, value] of [['point-count', 'budget:points', 31], ['labelled-count', 'budget:labels', 13], ['label-length', 'budget:label', 13], ['emphasis-count', 'budget:emphasis', 3]]) {
      const row = byName(result.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, false)
      assert.equal(row.key, key)
      assert.equal(row.value, value)
    }
    assert.equal(result.warnings.length, 4)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/scatter.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('scatter-simple and scatter-bubble render as data-checks="pass" data-type="scatter" figures; over-budget carries data-warn', async () => {
    for (const name of ['scatter-simple.yaml', 'scatter-bubble.yaml']) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="scatter">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
    }
    const over = await renderFigureHtmlChecked(validIr('scatter-over-budget.yaml'), { rawYaml: fixture('scatter-over-budget.yaml') })
    assert.equal(over.checksOk, true, JSON.stringify(over.failures))
    assert.equal(over.warn, 'budget:points=31;budget:labels=13;budget:label=13;budget:emphasis=3')
    assert.ok(over.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:points=31;budget:labels=13;budget:label=13;budget:emphasis=3" data-type="scatter">'))
  })

  test('CLI: --figure exits 0 for simple and bubble, --json reports ok + checks, --doc scatter is a clean 8-point / 2-series / 3-label bubble chart', () => {
    for (const f of ['scatter-simple.yaml', 'scatter-bubble.yaml']) {
      const fig = runCli([join(FIXTURES, f), '--figure'])
      assert.equal(fig.status, 0, `${f}: ${fig.stderr}`)
      assert.match(fig.stdout, /data-checks="pass"/)
      assert.match(fig.stdout, /data-type="scatter"/)
    }
    const json = JSON.parse(runCli([join(FIXTURES, 'scatter-bubble.yaml'), '--json']).stdout)
    assert.equal(json.ok, true)
    assert.ok(json.checks.some((c) => c.name === 'bubble-area-proportional' && c.ok))
    assert.equal(json.checks.length, 18)
    const doc = runCli(['--doc', 'scatter'])
    assert.equal(doc.status, 0)
    assert.equal(doc.stdout, scatter.doc.irExample)
    const example = validateIR(parseYaml(doc.stdout))
    assert.equal(example.ok, true)
    assert.equal(example.ir.points.length, 8)
    assert.equal(example.ir.series.length, 2)
    assert.ok(example.ir.points.every((p) => p.size > 0))
    assert.equal(example.ir.points.filter((p) => p.label).length, 3)
    assert.deepEqual(example.warnings, [])
    const listed = runCli(['--list-types'])
    assert.match(listed.stdout, /^scatter {2}\(plugin\)\n {2}purpose: /m)
    assert.match(listed.stdout, /budgets: maxPoints=30 minBubbles=5 maxBubbles=15 maxLabelled=3 maxLabelLen=12 maxEmphasis=2/)
  })
})
