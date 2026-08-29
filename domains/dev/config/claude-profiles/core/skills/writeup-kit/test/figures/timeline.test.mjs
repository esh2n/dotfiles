// `type: timeline` — schema, budgets, layout (ordinal / time / compressed
// fallback / down), every verify row failing on a hand-mutated render, the
// registry dispatch and the CLI. Fixtures: test/fixtures/timeline-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as timeline from '../../bin/lib/figures/timeline.mjs'
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

const plugin = getFigureType('timeline')
const ROWS = ['event-count', 'label-length', 'emphasis-count', 'events-ordered', 'labels-clear', 'events-on-axis', 'time-scale']

const minimal = () => ({
  id: 's', type: 'timeline', title: 't',
  events: [
    { id: 'a', label: 'A', at: '2026-01' },
    { id: 'b', label: 'B', at: '2026-03', note: 'n', emphasis: true, tone: 'ts' },
    { id: 'c', label: 'C', at: '2026-04' },
  ],
})

const DAY = 24 * 60 * 60 * 1000

// --- schema ----------------------------------------------------------------

describe('figures/timeline.mjs: schema', () => {
  test('a valid IR normalizes: defaults filled in, scale inferred from the dates', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'timeline')
    assert.equal(r.ir.scale, 'time')
    assert.equal(r.ir.direction, 'right')
    assert.deepEqual(r.ir.events[0], { id: 'a', label: 'A', at: '2026-01', emphasis: false, tone: 'neutral' })
    assert.deepEqual(r.ir.events[1], { id: 'b', label: 'B', at: '2026-03', note: 'n', emphasis: true, tone: 'ts' })
    // a free ordinal label anywhere → ordinal; a bare year arrives as a number and is kept as text
    const ordinal = validateIR({ ...minimal(), events: [{ id: 'a', label: 'A', at: 2025 }, { id: 'b', label: 'B', at: 'Phase 2' }] })
    assert.equal(ordinal.ok, true)
    assert.equal(ordinal.ir.scale, 'ordinal')
    assert.equal(ordinal.ir.events[0].at, '2025')
    // explicit scale/direction are kept
    const down = validateIR({ ...minimal(), scale: 'ordinal', direction: 'down' })
    assert.equal(down.ir.scale, 'ordinal')
    assert.equal(down.ir.direction, 'down')
  })

  test('normalize is idempotent', () => {
    const once = timeline.normalize(minimal())
    assert.deepEqual(timeline.normalize(once), once)
    for (const name of ['timeline-simple.yaml', 'timeline-dates.yaml', 'timeline-down.yaml']) {
      const ir = validIr(name)
      assert.deepEqual(timeline.normalize(ir), ir, name)
    }
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), events: [] }, /ir\.events must be a non-empty list/],
      [{ ...minimal(), events: [{ id: 'a', label: 'A', at: 'x' }, { id: 'a', label: 'B', at: 'y' }] }, /duplicate event id: "a"/],
      [{ ...minimal(), events: [{ id: 'a', label: 'A' }] }, /ir\.events\[0\]\.at is required/],
      [{ ...minimal(), events: [{ id: 'a', at: 'x' }] }, /ir\.events\[0\]\.label is required/],
      [{ ...minimal(), events: [{ id: 'a', label: 'A', at: 'x', emphasis: 'yes' }] }, /ir\.events\[0\]\.emphasis must be a boolean/],
      [{ ...minimal(), events: [{ id: 'a', label: 'A', at: 'x', tone: 'red' }] }, /ir\.events\[0\]\.tone must be ts\|rs\|new\|neutral/],
      [{ ...minimal(), events: [{ id: 'a', label: 'A', at: 'x', note: 3 }] }, /ir\.events\[0\]\.note must be a string/],
      [{ ...minimal(), scale: 'log' }, /ir\.scale must be ordinal\|time/],
      [{ ...minimal(), scale: 'time', events: [{ id: 'a', label: 'A', at: '2026-01' }, { id: 'b', label: 'B', at: 'later' }] }, /ir\.scale is "time" but ir\.events\[1\]\.at "later" is not a date/],
      [{ ...minimal(), scale: 'time', events: [{ id: 'a', label: 'A', at: '2026-13' }] }, /ir\.events\[0\]\.at "2026-13" is not a date/],
      [{ ...minimal(), direction: 'left' }, /ir\.direction must be right\|down/],
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

describe('figures/timeline.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(timeline.budgetWarnings(validIr('timeline-simple.yaml')), [])
    assert.deepEqual(timeline.budgetWarnings(validIr('timeline-dates.yaml')), [])
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('timeline-over-budget.yaml')
    const warns = timeline.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), ['budget:events', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(warns.map((w) => w.value), [13, 15, 3])
    assert.equal(formatBudgetWarnings(warns), 'budget:events=13;budget:label=15;budget:emphasis=3')
    for (const w of warns) assert.ok(w.hint && w.hint !== w.detail, `${w.key} needs a concrete hint`)
    const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture('timeline-over-budget.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:events=13;budget:label=15;budget:emphasis=3" data-type="timeline">/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/timeline.mjs: layout', () => {
  test('ordinal: markers evenly spaced on one horizontal axis, blocks alternating above/below, canvas fills the column', async () => {
    const ir = validIr('timeline-simple.yaml')
    const l = await timeline.layout(ir, { column: 720 })
    assert.equal(l.geo.scale, 'ordinal')
    assert.equal(l.geo.compressed, false)
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    assert.ok(l.width <= 720)
    assert.equal(l.geo.axis.y1, l.geo.axis.y2)
    const ev = l.geo.events
    assert.deepEqual(ev.map((e) => e.id), ir.events.map((e) => e.id))
    assert.deepEqual(ev.map((e) => e.side), ['above', 'below', 'above', 'below'])
    const gaps = ev.slice(1).map((e, i) => e.cx - ev[i].cx)
    assert.equal(new Set(gaps).size, 1, `uniform spacing, got ${gaps}`)
    assert.ok(gaps[0] >= 24 && gaps[0] <= 144)
    for (const e of ev) {
      assert.equal(e.cy, l.geo.axis.y1)
      assert.ok(e.cx > l.geo.axis.x1 && e.cx < l.geo.axis.x2)
      if (e.side === 'above') assert.ok(e.block.y + e.block.height <= l.geo.axis.y1 - 8)
      else assert.ok(e.block.y >= l.geo.axis.y1 + 8)
      assert.ok(e.block.x >= 0 && e.block.x + e.block.width <= l.width)
    }
    // note adds a third line: the block with a note is taller than one without
    const withNote = ev.find((e) => e.id === 'beta')
    const without = ev.find((e) => e.id === 'default')
    assert.ok(withNote.block.height > without.block.height)
  })

  test('time: spacing is proportional to the dates (down direction, vertical axis, blocks alternating left/right)', async () => {
    const ir = validIr('timeline-down.yaml')
    const l = await timeline.layout(ir, { column: 720 })
    assert.equal(l.geo.direction, 'down')
    assert.equal(l.geo.scale, 'time')
    assert.equal(l.geo.compressed, false)
    assert.equal(l.geo.axis.x1, l.geo.axis.x2)
    const ev = l.geo.events
    assert.deepEqual(ev.map((e) => e.side), ['left', 'right', 'left', 'right'])
    for (const e of ev) assert.equal(e.cx, l.geo.axis.x1)
    const days = (a, b) => (Date.UTC(...b) - Date.UTC(...a)) / DAY
    const d1 = days([2025, 9, 1], [2025, 11, 1])  // v1 → v1.1: 61 days
    const d3 = days([2026, 1, 1], [2026, 7, 1])   // v1.5 → v2: 181 days
    const g1 = ev[1].cy - ev[0].cy
    const g3 = ev[3].cy - ev[2].cy
    assert.ok(Math.abs(g3 / g1 - d3 / d1) < 0.1, `gap ratio ${g3 / g1} should track the day ratio ${d3 / d1}`)
    const left = ev.filter((e) => e.side === 'left')
    const right = ev.filter((e) => e.side === 'right')
    for (const e of left) assert.ok(e.block.x + e.block.width <= l.geo.axis.x1 - 8)
    for (const e of right) assert.ok(e.block.x >= l.geo.axis.x1 + 8)
    assert.ok(l.height > l.width, 'a down timeline is taller than wide')
  })

  test('time: two events too close for their labels → ordinal fallback flagged as compressed', async () => {
    const ir = validIr('timeline-dates.yaml')
    const l = await timeline.layout(ir, { column: 720 })
    assert.equal(l.geo.scale, 'time')
    assert.equal(l.geo.compressed, true)
    assert.equal(l.geo.collisions, 1)
    const ev = l.geo.events
    const gaps = ev.slice(1).map((e, i) => e.cx - ev[i].cx)
    assert.equal(new Set(gaps).size, 1, `fallback spacing is uniform, got ${gaps}`)
    // the same events spread out in time keep their proportional spacing
    const spread = validateIR({ ...ir, events: ir.events.map((e, i) => ({ ...e, at: `2026-${String(i * 2 + 1).padStart(2, '0')}-01` })) })
    assert.equal(spread.ok, true)
    const l2 = await timeline.layout(spread.ir, { column: 720 })
    assert.equal(l2.geo.compressed, false)
    // a same-side pair that needs more than the column gets a longer axis (still ≥ 0.78 scale) before giving up
    const rendered = await renderFigure(plugin, spread.ir)
    assert.equal(rendered.scroll, false)
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ['timeline-simple.yaml', 'timeline-dates.yaml', 'timeline-down.yaml', 'timeline-over-budget.yaml']) {
      const ir = validIr(name)
      const a = await timeline.layout(ir, { column: 720 })
      const b = await timeline.layout(ir, { column: 720 })
      assert.deepEqual(a, b, `${name}: layout differs between runs`)
      const r1 = await renderFigure(plugin, ir)
      const r2 = await renderFigure(plugin, ir)
      assert.equal(r1.svg, r2.svg, `${name}: svg differs between runs`)
      const v = await verifyFigure(plugin, ir, r1)
      assert.equal(byName(v.checks, 'grid-4px').ok, true, `${name}: ${byName(v.checks, 'grid-4px').detail}`)
      assert.equal(byName(v.checks, 'projected-scale').ok, true, `${name}: ${byName(v.checks, 'projected-scale').detail}`)
    }
  })

  test('a single event still lays out on the axis with no fallback', async () => {
    const r = validateIR({ ...minimal(), events: [{ id: 'only', label: 'Only', at: '2026-01-01' }] })
    assert.equal(r.ok, true)
    const l = await timeline.layout(r.ir, { column: 720 })
    assert.equal(l.geo.events.length, 1)
    assert.equal(l.geo.compressed, false)
    const v = await verifyFigure(plugin, r.ir, await renderFigure(plugin, r.ir))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings, [])
  })
})

// --- verify rows -----------------------------------------------------------

describe('figures/timeline.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of ['timeline-simple.yaml', 'timeline-down.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 7).map((c) => c.name), ROWS)
      assert.deepEqual(v.checks.slice(0, 7).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7])
      assert.deepEqual(plugin.doc.rows, ROWS)
    }
  })

  test('events-ordered fails when a marker is moved before its predecessor', async () => {
    const ir = validIr('timeline-simple.yaml')
    const l = await timeline.layout(ir)
    const ev = l.geo.events
    ev[2].cx = ev[1].cx - 4
    const row = byName(timeline.verify(l, ir), 'events-ordered')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /beta\/ga/)
    // geometry order differing from ir.events is caught too
    const l2 = await timeline.layout(ir)
    l2.geo.events.reverse()
    assert.match(byName(timeline.verify(l2, ir), 'events-ordered').detail, /geometry order differs/)
  })

  test('events-ordered fails on dates listed out of order, even though the schema accepts them', async () => {
    const raw = { ...minimal(), scale: 'ordinal', events: [{ id: 'late', label: 'Late', at: '2026-06-01' }, { id: 'early', label: 'Early', at: '2026-01-01' }] }
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    const rendered = await renderFigure(plugin, r.ir)
    const v = await verifyFigure(plugin, r.ir, rendered)
    assert.equal(v.ok, false)
    const row = byName(v.checks, 'events-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /date\(s\) go backwards: late \(2026-06-01\) → early \(2026-01-01\)/)
    const html = await renderFigureHtmlChecked(r.ir)
    assert.equal(html.checksOk, false)
    assert.ok(!html.html.includes('data-checks="pass"'))
  })

  test('labels-clear fails when two blocks are pushed into each other', async () => {
    const ir = validIr('timeline-simple.yaml')
    const l = await timeline.layout(ir)
    const [a, , c] = l.geo.events
    c.block.x = a.block.x + 8
    const row = byName(timeline.verify(l, ir), 'labels-clear')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /internal\/ga/)
  })

  test('events-on-axis fails when a marker leaves the axis line or its span', async () => {
    const ir = validIr('timeline-simple.yaml')
    const l = await timeline.layout(ir)
    l.geo.events[1].cy += 8
    let row = byName(timeline.verify(l, ir), 'events-on-axis')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /beta/)
    const l2 = await timeline.layout(ir)
    l2.geo.events[3].cx = l2.geo.axis.x2 + 40
    assert.equal(byName(timeline.verify(l2, ir), 'events-on-axis').ok, false)
    // down: the check runs on cx / the y span
    const d = await timeline.layout(validIr('timeline-down.yaml'))
    d.geo.events[0].cx += 4
    assert.equal(byName(timeline.verify(d, validIr('timeline-down.yaml')), 'events-on-axis').ok, false)
  })

  test('time-scale is a warn row carrying scale:compressed only when the fallback kicked in', async () => {
    const ir = validIr('timeline-dates.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [['time-scale', 'scale:compressed', 1]])
    const html = await renderFigureHtmlChecked(ir, { rawYaml: fixture('timeline-dates.yaml') })
    assert.equal(html.checksOk, true)
    assert.match(html.html, /^<figure class="wu-figure" data-checks="pass" data-warn="scale:compressed=1" data-type="timeline">/)
    const clean = await verifyFigure(plugin, validIr('timeline-down.yaml'), await renderFigure(plugin, validIr('timeline-down.yaml')))
    const row = byName(clean.checks, 'time-scale')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, true)
    assert.equal('key' in row, false)
  })

  test('the three budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('timeline-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['event-count', 'budget:events', 13],
      ['label-length', 'budget:label', 15],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const clean = await verifyFigure(plugin, validIr('timeline-simple.yaml'), await renderFigure(plugin, validIr('timeline-simple.yaml')))
    for (const name of ['event-count', 'label-length', 'emphasis-count']) {
      const row = byName(clean.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/timeline.mjs: draw', () => {
  test('emphasis is the focal square + bold label, tone fills the dot, dates sit in ink-3, labels are escaped', async () => {
    const raw = { ...minimal(), events: [{ id: 'a', label: 'A & <B>', at: '2026-01', emphasis: true, tone: 'ts' }, { id: 'b', label: 'B', at: '2026-02', tone: 'rs', note: 'x<y' }, { id: 'c', label: 'C', at: '2026-03' }] }
    const r = validateIR(raw)
    assert.equal(r.ok, true)
    const rendered = await renderFigure(plugin, r.ir)
    assert.match(rendered.svg, /<rect id="wu-d-s-ev-a" class="wu-focal" data-tone="ts"[^>]*rx="4"[^>]*stroke-width="1.5"/)
    assert.match(rendered.svg, /<text id="wu-d-s-ev-a-label"[^>]*font-weight="700"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(rendered.svg, /<circle id="wu-d-s-ev-b"[^>]*fill="var\(--wu-fig-tone-rs\)"/)
    assert.match(rendered.svg, /<circle id="wu-d-s-ev-c"[^>]*fill="var\(--wu-surface\)"/)
    assert.match(rendered.svg, /<text id="wu-d-s-ev-b-note"[^>]*font-size="11"[^>]*fill="var\(--wu-ink-3\)">x&lt;y<\/text>/)
    assert.match(rendered.svg, /<text id="wu-d-s-ev-a-at"[^>]*font-size="11"[^>]*>2026-01<\/text>/)
    assert.match(rendered.svg, /<line id="wu-d-s-axis"[^>]*marker-end="url\(#wu-d-s-solid\)"/)
    assert.doesNotMatch(rendered.svg, /<text id="wu-d-s-ev-b-label"[^>]*font-weight/)
    assert.doesNotMatch(rendered.svg, /#[0-9a-fA-F]{6}\b/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/timeline.mjs: registry dispatch and CLI', () => {
  test('timeline-simple.yaml (ordinal) and timeline-dates.yaml (time) render as data-checks="pass" data-type="timeline" figures', async () => {
    const simple = await renderFigureHtmlChecked(validIr('timeline-simple.yaml'), { rawYaml: fixture('timeline-simple.yaml') })
    assert.equal(simple.checksOk, true, JSON.stringify(simple.failures))
    assert.match(simple.html, /^<figure class="wu-figure" data-checks="pass" data-type="timeline">/)
    assert.match(simple.html, /<script type="text\/x-writeup-diagram">/)
    const dates = await renderFigureHtmlChecked(validIr('timeline-dates.yaml'), { rawYaml: fixture('timeline-dates.yaml') })
    assert.equal(dates.checksOk, true, JSON.stringify(dates.failures))
    assert.match(dates.html, /^<figure class="wu-figure" data-checks="pass" data-warn="scale:compressed=1" data-type="timeline">/)
    assert.equal(dates.layoutMode, 'timeline')
  })

  test('the registry lists timeline with its limits and doc rows', () => {
    assert.equal(plugin.type, 'timeline')
    assert.deepEqual(plugin.limits, { maxEvents: 12, maxLabelLen: 14, maxEmphasis: 2 })
    assert.equal(plugin.doc.rows.length, 7)
  })

  test('doc.irExample validates with 6 dated events on a time scale, and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.events.length, 6)
    assert.equal(r.ir.scale, 'time')
    assert.ok(r.ir.events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.at)))
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="timeline">/)
    assert.equal(rendered.layout.geo.compressed, false)
  })

  test('--figure prints a verified timeline figure; --json reports warnings for the over-budget and compressed fixtures', () => {
    const fig = runCli([join(FIXTURES, 'timeline-simple.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="timeline">/)
    const json = runCli([join(FIXTURES, 'timeline-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:events', 'budget:label', 'budget:emphasis'])
    assert.match(out.figureHtml, /data-warn="budget:events=13;budget:label=15;budget:emphasis=3" data-type="timeline"/)
    const compressed = runCli([join(FIXTURES, 'timeline-dates.yaml'), '--figure'])
    assert.equal(compressed.status, 0)
    assert.match(compressed.stderr, /warning: scale:compressed=1/)
    assert.match(compressed.stdout, /data-warn="scale:compressed=1"/)
  })
})
