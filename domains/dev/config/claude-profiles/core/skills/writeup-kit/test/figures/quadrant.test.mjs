// `type: quadrant` — schema, budgets, layout (grid, nudging, flipping),
// every verify row failing on a hand-mutated render, the registry path
// and the CLI. Fixtures: test/fixtures/quadrant-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as quadrant from '../../bin/lib/figures/quadrant.mjs'
import { getFigureType, renderFigure, verifyFigure, PLUGIN_EXPORTS } from '../../bin/lib/figures/index.mjs'
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

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const minimal = (extra = {}) => ({
  id: 'q', type: 'quadrant', title: 't',
  x: { label: 'cost' }, y: { label: 'value' },
  items: [{ id: 'a', label: 'A', x: 0.2, y: 0.8 }, { id: 'b', label: 'B', x: 0.7, y: 0.3 }],
  ...extra,
})

async function renderAndVerify(ir) {
  const plugin = getFigureType('quadrant')
  const rendered = await renderFigure(plugin, ir)
  const verification = await verifyFigure(plugin, ir, rendered)
  return { rendered, verification }
}

// --- schema ------------------------------------------------------------------

describe('quadrant: schema', () => {
  test('the plugin exports exactly the contract and is registered under "quadrant"', () => {
    assert.deepEqual(Object.keys(quadrant).sort(), [...PLUGIN_EXPORTS].sort())
    const p = getFigureType('quadrant')
    assert.ok(p && p.builtin === false)
    assert.equal(p.type, 'quadrant')
    assert.deepEqual(p.doc.rows, quadrant.doc.rows)
  })

  test('a minimal IR normalizes: axes keep label only, items get emphasis=false and tone=neutral', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'quadrant')
    assert.deepEqual(r.ir.x, { label: 'cost' })
    assert.deepEqual(r.ir.items[0], { id: 'a', label: 'A', x: 0.2, y: 0.8, emphasis: false, tone: 'neutral' })
    assert.equal('quadrants' in r.ir, false)
    assert.equal('caption' in r.ir, false)
  })

  test('x and y each require a label; low/high are optional strings', () => {
    const noLabel = validateIR(minimal({ y: { low: 'a', high: 'b' } }))
    assert.equal(noLabel.ok, false)
    assert.equal(noLabel.reason, 'schema')
    assert.match(noLabel.message, /ir\.y\.label is required/)
    const badLow = validateIR(minimal({ x: { label: 'cost', low: 3 } }))
    assert.equal(badLow.ok, false)
    assert.match(badLow.message, /ir\.x\.low must be a string/)
    const missingAxis = validateIR({ ...minimal(), x: undefined })
    assert.equal(missingAxis.ok, false)
    assert.match(missingAxis.message, /ir\.x must be a mapping/)
  })

  test('item x/y must be numbers within 0..1, ids unique, emphasis boolean', () => {
    const out = validateIR(minimal({ items: [{ id: 'a', label: 'A', x: 1.2, y: 0.5 }] }))
    assert.equal(out.ok, false)
    assert.match(out.message, /ir\.items\[0\]\.x must be a number between 0 and 1 \(got: 1\.2\)/)
    const str = validateIR(minimal({ items: [{ id: 'a', label: 'A', x: '0.5', y: 0.5 }] }))
    assert.equal(str.ok, false)
    assert.match(str.message, /items\[0\]\.x must be a number/)
    const dup = validateIR(minimal({ items: [{ id: 'a', label: 'A', x: 0.1, y: 0.1 }, { id: 'a', label: 'B', x: 0.9, y: 0.9 }] }))
    assert.equal(dup.ok, false)
    assert.match(dup.message, /duplicate item id: "a"/)
    const emph = validateIR(minimal({ items: [{ id: 'a', label: 'A', x: 0.1, y: 0.1, emphasis: 'yes' }] }))
    assert.equal(emph.ok, false)
    assert.match(emph.message, /items\[0\]\.emphasis must be a boolean/)
    const empty = validateIR(minimal({ items: [] }))
    assert.equal(empty.ok, false)
    assert.match(empty.message, /ir\.items must be a non-empty list/)
  })

  test('quadrants accepts only tl/tr/bl/br captions', () => {
    const ok = validateIR(minimal({ quadrants: { tl: 'do now', br: 'skip' } }))
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.ir.quadrants, { tl: 'do now', br: 'skip' })
    const bad = validateIR(minimal({ quadrants: { top: 'x' } }))
    assert.equal(bad.ok, false)
    assert.match(bad.message, /ir\.quadrants has unknown key\(s\) top/)
    const emptyQ = validateIR(minimal({ quadrants: {} }))
    assert.equal(emptyQ.ok, true)
    assert.equal('quadrants' in emptyQ.ir, false)
  })

  test('normalize() is idempotent for every fixture (embedded IR re-validates unchanged)', () => {
    for (const f of ['quadrant-simple.yaml', 'quadrant-dense.yaml', 'quadrant-over-items.yaml']) {
      const once = quadrant.normalize(parseYaml(fixture(f)))
      const twice = quadrant.normalize(JSON.parse(JSON.stringify(once)))
      assert.deepEqual(twice, once, f)
    }
  })
})

// --- budgets -------------------------------------------------------------------

describe('quadrant: budgets', () => {
  test('limits are items ≤ 12, label ≤ 12 chars, emphasis ≤ 2', () => {
    assert.deepEqual(quadrant.limits, { maxItems: 12, maxLabelLen: 12, maxEmphasis: 2 })
  })

  test('13 items → budget:items=13 as a validateIR warning, still ok', () => {
    const r = validateIR(parseYaml(fixture('quadrant-over-items.yaml')))
    assert.equal(r.ok, true)
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:items=13')
    assert.match(r.warnings[0].hint, /split/)
  })

  test('a long label and three emphasized items warn in a stable order (items, label, emphasis)', () => {
    const items = [
      { id: 'a', label: 'a very long option name here', x: 0.1, y: 0.9, emphasis: true },
      { id: 'b', label: 'B', x: 0.5, y: 0.2, emphasis: true },
      { id: 'c', label: 'C', x: 0.9, y: 0.6, emphasis: true },
    ]
    const ir = quadrant.normalize(minimal({ items }))
    const w = quadrant.budgetWarnings(ir)
    assert.deepEqual(w.map((x) => x.key), ['budget:label', 'budget:emphasis'])
    assert.equal(w[0].value, 28)
    assert.equal(w[1].value, 3)
    assert.match(w[0].hint, /shorten "a very long option name here"/)
    const many = quadrant.normalize(minimal({ items: [...items, ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, x: (i + 1) / 12, y: 1 - (i + 1) / 12 }))] }))
    assert.deepEqual(quadrant.budgetWarnings(many).map((x) => x.key), ['budget:items', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(quadrant.budgetWarnings(quadrant.normalize(minimal())), [])
  })
})

// --- layout ----------------------------------------------------------------------

describe('quadrant: layout', () => {
  test('a 4:3 plot that fits the column, axis lines through the middle, axis text outside the plot', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const l = await quadrant.layout(ir, { column: COLUMN })
    assert.ok(l.width <= COLUMN, `width ${l.width} > ${COLUMN}`)
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    const { plot, axes, texts } = l.geo
    assert.equal(plot.height, plot.width * 3 / 4)
    assert.equal(axes.vertical.x, plot.x + plot.width / 2)
    assert.equal(axes.horizontal.y, plot.y + plot.height / 2)
    const roles = texts.map((t) => t.role).sort()
    assert.deepEqual(roles, ['x-high', 'x-label', 'x-low', 'y-high', 'y-label', 'y-low'])
    const inPlot = (b) => b.x < plot.x + plot.width && b.x + b.width > plot.x && b.y < plot.y + plot.height && b.y + b.height > plot.y
    for (const t of texts) assert.equal(inPlot(t), false, `${t.role} sits inside the plot`)
    assert.equal(l.geo.corners.length, 4)
    for (const c of l.geo.corners) assert.equal(inPlot(c), true, `corner ${c.corner} outside the plot`)
  })

  test('items map x→right and y→up onto the 4px grid; (0,0) is the bottom-left corner, (1,1) the top-right', async () => {
    const ir = quadrant.normalize(minimal({ items: [
      { id: 'bl', label: 'bl', x: 0, y: 0 }, { id: 'tr', label: 'tr', x: 1, y: 1 }, { id: 'mid', label: 'm', x: 0.37, y: 0.61 },
    ] }))
    const l = await quadrant.layout(ir)
    const { plot, items } = l.geo
    const m = Object.fromEntries(items.map((it) => [it.id, it.marker]))
    assert.deepEqual([m.bl.cx, m.bl.cy], [plot.x, plot.y + plot.height])
    assert.deepEqual([m.tr.cx, m.tr.cy], [plot.x + plot.width, plot.y])
    assert.ok(m.mid.cx > plot.x + plot.width / 4 && m.mid.cx < plot.x + plot.width / 2)
    assert.ok(m.mid.cy < plot.y + plot.height / 2)
    for (const it of items) {
      assert.equal(it.marker.cx % 4, 0)
      assert.equal(it.marker.cy % 4, 0)
      assert.equal(it.labelBox.x % 4, 0)
      assert.equal(it.labelBox.y % 4, 0)
    }
  })

  test('a label sits to the right of its dot and flips to the left near the right edge', async () => {
    const ir = quadrant.normalize(minimal({ items: [
      { id: 'left', label: 'left side', x: 0.1, y: 0.5 }, { id: 'edge', label: 'near the edge', x: 0.97, y: 0.5 },
    ] }))
    const l = await quadrant.layout(ir)
    const [left, edge] = l.geo.items
    assert.equal(left.labelBox.side, 'right')
    assert.equal(left.labelBox.x, left.marker.cx + 8)
    assert.equal('leader' in left.labelBox, false)
    assert.equal(edge.labelBox.side, 'left')
    assert.equal(edge.labelBox.x + edge.labelBox.width, edge.marker.cx - 8)
    assert.ok(edge.labelBox.x + edge.labelBox.width <= l.geo.plot.x + l.geo.plot.width)
  })

  test('two items at the same spot: the second label takes the other side (no leader needed); a third is nudged and gets a leader', async () => {
    const ir = quadrant.normalize(minimal({ items: [
      { id: 'a', label: 'first', x: 0.5, y: 0.6 }, { id: 'b', label: 'second', x: 0.5, y: 0.6 }, { id: 'c', label: 'third', x: 0.5, y: 0.6 },
    ] }))
    const l = await quadrant.layout(ir)
    const [a, b, c] = l.geo.items
    for (const it of [a, b, c]) assert.equal(it.labelBox.collides, false, `${it.id} collides`)
    assert.equal(a.labelBox.side, 'right')
    assert.equal(b.labelBox.side, 'left')
    assert.equal('leader' in b.labelBox, false)
    assert.notDeepEqual([c.labelBox.x, c.labelBox.y], [a.labelBox.x, a.labelBox.y])
    assert.ok(c.labelBox.leader, 'nudged label carries a leader')
    for (const k of ['x1', 'y1', 'x2', 'y2']) assert.equal(c.labelBox.leader[k] % 4, 0, `leader.${k} off grid`)
    assert.deepEqual([c.labelBox.leader.x1, c.labelBox.leader.y1], [c.marker.cx, c.marker.cy])
    const { verification } = await renderAndVerify(ir)
    assert.equal(byName(verification.checks, 'labels-no-overlap').ok, true)
    assert.equal(byName(verification.checks, 'labels-clear-of-axis-text').ok, true)
  })

  test('when no clear slot exists the label stays put, is flagged, and the figure fails instead of shipping overlaps', async () => {
    // two dozen items on one spot exhaust the candidate slots around it
    const items = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, label: 'crowded option', x: 0.5, y: 0.6 }))
    const ir = quadrant.normalize(minimal({ items }))
    const { verification } = await renderAndVerify(ir)
    const stuck = (await quadrant.layout(ir)).geo.items.filter((it) => it.labelBox.collides)
    assert.ok(stuck.length >= 1, 'at least one label could not be placed')
    assert.equal(verification.ok, false)
    assert.equal(byName(verification.checks, 'labels-no-overlap').ok, false)
    assert.match(byName(verification.checks, 'labels-no-overlap').hint, /spread the crowded items apart/)
  })

  test('the dense fixture (10 items, three clusters) renders with every fail row passing', async () => {
    const ir = validIr('quadrant-dense.yaml')
    const { rendered, verification } = await renderAndVerify(ir)
    assert.equal(verification.ok, true, JSON.stringify(verification.failures))
    assert.deepEqual(verification.warnings, [])
    assert.equal(rendered.scroll, false)
    const nudged = rendered.layout.geo.items.filter((it) => it.labelBox.leader)
    assert.ok(nudged.length >= 1, 'the clusters force at least one nudged label')
    assert.match(rendered.svg, /-leader" x1=/)
  })

  test('layout and svg are deterministic across runs', async () => {
    const ir = validIr('quadrant-dense.yaml')
    const a = await renderAndVerify(ir)
    const b = await renderAndVerify(ir)
    assert.deepEqual(a.rendered.layout, b.rendered.layout)
    assert.equal(a.rendered.svg, b.rendered.svg)
    assert.deepEqual(a.verification.checks, b.verification.checks)
  })

  test('draw(): emphasized item is a .wu-focal rounded square with a bold label; others are ink dots; corner text is muted', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const { rendered } = await renderAndVerify(ir)
    assert.match(rendered.svg, /<rect id="wu-d-q1-i-cache" class="wu-focal" data-tone="neutral"[^>]*rx="4"[^>]*stroke-width="1\.5"/)
    assert.match(rendered.svg, /<text id="wu-d-q1-i-cache-label"[^>]*font-weight="700"/)
    assert.match(rendered.svg, /<circle id="wu-d-q1-i-rewrite" cx="\d+" cy="\d+" r="4" fill="currentColor"\/>/)
    assert.match(rendered.svg, /<text id="wu-d-q1-q-tl"[^>]*fill="var\(--wu-ink-3\)">すぐやる<\/text>/)
    assert.match(rendered.svg, /<text id="wu-d-q1-y-label"[^>]*transform="rotate\(-90 /)
    assert.doesNotMatch(rendered.svg, /#[0-9a-f]{3,6}\b/i)
  })
})

// --- verify rows ---------------------------------------------------------------------

describe('quadrant: verify rows fail on a hand-mutated render', () => {
  const rows = ['axis-labels', 'items-in-plot', 'labels-no-overlap', 'labels-clear-of-axis-text', 'item-count', 'label-length', 'emphasis-count', 'items-off-axis']

  test('doc.rows lists the eight own rows in verify() order and the shared rows follow', async () => {
    assert.deepEqual(quadrant.doc.rows, rows)
    const { verification } = await renderAndVerify(validIr('quadrant-simple.yaml'))
    assert.deepEqual(verification.checks.slice(0, 8).map((c) => c.name), rows)
    assert.deepEqual(verification.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(verification.checks[8].name, 'single-finite-svg')
    assert.equal(verification.checks[8].id, 9)
    assert.equal(verification.ok, true)
  })

  test('#1 axis-labels fails when an axis label is missing from the geometry', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const l = await quadrant.layout(ir)
    l.geo.texts = l.geo.texts.filter((t) => t.role !== 'y-label')
    const row = byName(quadrant.verify(l, ir), 'axis-labels')
    assert.equal(row.ok, false)
    assert.equal(row.severity, 'fail')
    assert.match(row.detail, /missing axis label\(s\): y-label/)
  })

  test('#2 items-in-plot fails when a marker leaves the plot', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const l = await quadrant.layout(ir)
    l.geo.items[1].marker.cx = l.geo.plot.x + l.geo.plot.width + 8
    const row = byName(quadrant.verify(l, ir), 'items-in-plot')
    assert.equal(row.ok, false)
    assert.match(row.detail, /outside the plot: rewrite/)
  })

  test('#3 labels-no-overlap fails for two coincident label boxes and for a label covering another marker', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const l = await quadrant.layout(ir)
    l.geo.items[1].labelBox = { ...l.geo.items[0].labelBox }
    const row = byName(quadrant.verify(l, ir), 'labels-no-overlap')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cache\/rewrite/)
    const l2 = await quadrant.layout(ir)
    const m = l2.geo.items[2].marker
    l2.geo.items[0].labelBox = { ...l2.geo.items[0].labelBox, x: m.cx - 8, y: m.cy - 8 }
    const row2 = byName(quadrant.verify(l2, ir), 'labels-no-overlap')
    assert.equal(row2.ok, false)
    assert.match(row2.detail, /cache→logs marker/)
  })

  test('#4 labels-clear-of-axis-text fails when a label crosses the axis text, a corner caption, or the plot edge', async () => {
    const ir = validIr('quadrant-simple.yaml')
    const l = await quadrant.layout(ir)
    const xLabel = l.geo.texts.find((t) => t.role === 'x-label')
    l.geo.items[0].labelBox = { ...l.geo.items[0].labelBox, x: xLabel.x, y: xLabel.y }
    const row = byName(quadrant.verify(l, ir), 'labels-clear-of-axis-text')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cache leaves the plot/)
    assert.match(row.detail, /cache\/x-label/)
    const l2 = await quadrant.layout(ir)
    const tl = l2.geo.corners.find((c) => c.corner === 'tl')
    l2.geo.items[0].labelBox = { ...l2.geo.items[0].labelBox, x: tl.x, y: tl.y }
    assert.match(byName(quadrant.verify(l2, ir), 'labels-clear-of-axis-text').detail, /cache\/quadrant tl/)
  })

  test('#5–#7 budget rows are warn severity and carry key/value from budgetWarnings()', async () => {
    const ir = validIr('quadrant-over-items.yaml')
    const { verification } = await renderAndVerify(ir)
    assert.equal(verification.ok, true)
    const row = byName(verification.checks, 'item-count')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.equal(row.key, 'budget:items')
    assert.equal(row.value, 13)
    assert.deepEqual(verification.warnings.map((w) => w.key), ['budget:items'])
    const three = quadrant.normalize(minimal({ items: [
      { id: 'a', label: 'A', x: 0.1, y: 0.9, emphasis: true }, { id: 'b', label: 'B', x: 0.4, y: 0.2, emphasis: true }, { id: 'c', label: 'C', x: 0.9, y: 0.6, emphasis: true },
    ] }))
    const v = await renderAndVerify(three)
    assert.equal(byName(v.verification.checks, 'emphasis-count').ok, false)
    assert.equal(byName(v.verification.checks, 'emphasis-count').value, 3)
    assert.equal(byName(v.verification.checks, 'label-length').ok, true)
    const long = quadrant.normalize(minimal({ items: [{ id: 'a', label: 'thirteen chars', x: 0.1, y: 0.9 }] }))
    assert.equal(byName((await renderAndVerify(long)).verification.checks, 'label-length').ok, false)
  })

  test('#8 items-off-axis warns for an item sitting on an axis line, never fails', async () => {
    const ir = quadrant.normalize(minimal({ items: [{ id: 'mid', label: 'undecided', x: 0.5, y: 0.8 }] }))
    const { verification } = await renderAndVerify(ir)
    const row = byName(verification.checks, 'items-off-axis')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.match(row.detail, /on an axis line: mid/)
    assert.equal(verification.ok, true)
  })
})

// --- registry + CLI -----------------------------------------------------------------

describe('quadrant: registry path and CLI', () => {
  test('renderFigureHtmlChecked → data-checks="pass" data-type="quadrant", data-warn only when over budget', async () => {
    const clean = await renderFigureHtmlChecked(validIr('quadrant-dense.yaml'))
    assert.equal(clean.checksOk, true)
    assert.match(clean.html, /<figure class="wu-figure"[^>]*data-checks="pass"/)
    assert.match(clean.html, /data-type="quadrant"/)
    assert.doesNotMatch(clean.html, /data-warn=/)
    assert.match(clean.html, /<script type="text\/x-writeup-diagram"/)
    const over = await renderFigureHtmlChecked(validIr('quadrant-over-items.yaml'))
    assert.equal(over.checksOk, true)
    assert.equal(over.warn, 'budget:items=13')
    assert.match(over.html, /data-warn="budget:items=13"/)
  })

  test('the CLI renders quadrant-simple and quadrant-dense with --figure (exit 0) and --json exposes the checks', () => {
    for (const f of ['quadrant-simple.yaml', 'quadrant-dense.yaml']) {
      const r = runCli([join(FIXTURES, f), '--figure'])
      assert.equal(r.status, 0, `${f}: ${r.stderr}`)
      assert.match(r.stdout, /data-checks="pass"/)
      assert.match(r.stdout, /data-type="quadrant"/)
    }
    const j = JSON.parse(runCli([join(FIXTURES, 'quadrant-dense.yaml'), '--json']).stdout)
    assert.equal(j.ok, true)
    assert.equal(j.checks.filter((c) => c.severity === 'fail' && !c.ok).length, 0)
    assert.equal(j.checks.length, 15)
  })

  test('--doc quadrant prints the irExample (5 options on 実装コスト × 効果) and it renders clean', () => {
    const doc = runCli(['--doc', 'quadrant'])
    assert.equal(doc.status, 0)
    assert.equal(doc.stdout, quadrant.doc.irExample)
    const ir = validateIR(parseYaml(doc.stdout))
    assert.equal(ir.ok, true)
    assert.equal(ir.ir.items.length, 5)
    assert.equal(ir.ir.x.label, '実装コスト')
    assert.equal(ir.ir.y.label, '効果')
    assert.deepEqual(ir.warnings, [])
    const listed = runCli(['--list-types'])
    assert.match(listed.stdout, /^quadrant {2}\(plugin\)\n {2}purpose: /m)
    assert.match(listed.stdout, /budgets: maxItems=12 maxLabelLen=12 maxEmphasis=2/)
  })
})
