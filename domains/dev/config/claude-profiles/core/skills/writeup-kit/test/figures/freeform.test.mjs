// `type: freeform` — schema, budgets, layout (canvas, wardley plot),
// determinism, every verify row failing on a crafted IR, the registry
// path and the CLI. Fixtures: test/fixtures/freeform-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as freeform from '../../bin/lib/figures/freeform.mjs'
import { getFigureType, renderFigure, verifyFigure, PLUGIN_EXPORTS } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const ALL_FIXTURES = ['freeform-simple.yaml', 'freeform-wardley.yaml', 'freeform-over-budget.yaml']

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

const box = (id, x, y, extra = {}) => ({ kind: 'box', id, x, y, w: 96, h: 32, label: id, ...extra })

/** Two boxes side by side and an arrow between them on a 320×120 canvas. */
const minimal = (extra = {}) => ({
  id: 'ff', type: 'freeform', title: 't', width: 320, height: 120,
  elements: [box('a', 16, 40), box('b', 176, 40), { kind: 'line', id: 'ab', points: [[112, 56], [176, 56]], arrow: true }],
  ...extra,
})

async function renderAndVerify(ir) {
  const plugin = getFigureType('freeform')
  const rendered = await renderFigure(plugin, ir)
  const verification = await verifyFigure(plugin, ir, rendered)
  return { rendered, verification }
}

async function ownRows(raw) {
  const ir = freeform.normalize(raw)
  const l = await freeform.layout(ir)
  return freeform.verify(l, ir)
}

// --- schema ------------------------------------------------------------------

describe('freeform: schema', () => {
  test('the plugin exports exactly the contract and is registered under "freeform"', () => {
    assert.deepEqual(Object.keys(freeform).sort(), [...PLUGIN_EXPORTS].sort())
    const p = getFigureType('freeform')
    assert.ok(p && p.builtin === false)
    assert.equal(p.type, 'freeform')
    assert.deepEqual(p.doc.rows, freeform.doc.rows)
  })

  test('a minimal IR normalizes: no preset key, box defaults (tone neutral, emphasis/dashed false), line defaults, text size/anchor', () => {
    const r = validateIR(minimal({ elements: [
      box('a', 16, 40), { kind: 'line', id: 'l', points: [[0, 0], [4, 4]] },
      { kind: 'text', id: 't', x: 8, y: 8, text: 'hi' }, { kind: 'circle', id: 'c', cx: 200, cy: 60, r: 6 },
      { kind: 'region', id: 'r', x: 0, y: 0, w: 64, h: 64, label: 'zone' },
    ] }))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'freeform')
    assert.equal('preset' in r.ir, false)
    assert.equal('caption' in r.ir, false)
    assert.deepEqual(r.ir.elements[0], { kind: 'box', id: 'a', x: 16, y: 40, w: 96, h: 32, label: 'a', tone: 'neutral', emphasis: false, dashed: false })
    assert.deepEqual(r.ir.elements[1], { kind: 'line', id: 'l', points: [[0, 0], [4, 4]], arrow: false, dashed: false })
    assert.deepEqual(r.ir.elements[2], { kind: 'text', id: 't', x: 8, y: 8, text: 'hi', size: 'normal', anchor: 'start' })
    assert.deepEqual(r.ir.elements[3], { kind: 'circle', id: 'c', cx: 200, cy: 60, r: 6 })
    assert.deepEqual(r.ir.elements[4], { kind: 'region', id: 'r', x: 0, y: 0, w: 64, h: 64, label: 'zone' })
    assert.equal(validateIR(minimal({ preset: null })).ir.preset, undefined)
    assert.equal(validateIR(minimal({ preset: 'wardley' })).ir.preset, 'wardley')
  })

  test('rejects an unknown kind, an unknown preset, a missing label, malformed points, a bad id and duplicate ids', () => {
    const bad = (extra) => validateIR(minimal(extra))
    let r = bad({ elements: [{ kind: 'blob', id: 'x', x: 0, y: 0 }] })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /ir\.elements\[0\]\.kind must be box\|text\|line\|circle\|region \(got: "blob"\)/)
    r = bad({ preset: 'bcg' })
    assert.match(r.message, /ir\.preset must be wardley or null \(got: "bcg"\)/)
    r = bad({ elements: [{ kind: 'box', id: 'x', x: 0, y: 0, w: 8, h: 8 }] })
    assert.match(r.message, /ir\.elements\[0\]\.label is required/)
    r = bad({ elements: [{ kind: 'line', id: 'x', points: [[0, 0]] }] })
    assert.match(r.message, /ir\.elements\[0\]\.points must be a list of at least 2/)
    r = bad({ elements: [{ kind: 'line', id: 'x', points: [[0, 0], [1]] }] })
    assert.match(r.message, /ir\.elements\[0\]\.points\[1\] must be an \[x, y\] pair/)
    r = bad({ elements: [{ kind: 'box', id: 'x', x: 0, y: 0, w: 0, h: 8, label: 'a' }] })
    assert.match(r.message, /ir\.elements\[0\]\.w must be a positive finite number \(got: 0\)/)
    r = bad({ elements: [{ kind: 'text', id: 'x', x: 0, y: 0, text: 'a', size: 'huge' }] })
    assert.match(r.message, /ir\.elements\[0\]\.size must be small\|normal/)
    r = bad({ elements: [{ kind: 'text', id: 'bad id', x: 0, y: 0, text: 'a' }] })
    assert.match(r.message, /ir\.elements\[0\]\.id must match/)
    r = bad({ elements: [box('a', 0, 0), box('a', 120, 0)] })
    assert.match(r.message, /duplicate element id: "a"/)
    r = bad({ width: -4 })
    assert.match(r.message, /ir\.width must be a positive finite number/)
    r = bad({ elements: [] })
    assert.match(r.message, /ir\.elements must be a non-empty list/)
  })

  test('normalize() is idempotent for every fixture (embedded IR re-validates unchanged)', () => {
    for (const f of ALL_FIXTURES) {
      const once = freeform.normalize(parseYaml(fixture(f)))
      const twice = freeform.normalize(JSON.parse(JSON.stringify(once)))
      assert.deepEqual(twice, once, f)
    }
  })
})

// --- budgets -------------------------------------------------------------------

describe('freeform: budgets', () => {
  test('limits are elements ≤ 24, label ≤ 20 chars, emphasis ≤ 2', () => {
    assert.deepEqual(freeform.limits, { maxElements: 24, maxLabelLen: 20, maxEmphasis: 2, maxComponents: 9, maxLinks: 12 })
  })

  test('25 elements → budget:elements=25 as a validateIR warning, still ok', () => {
    const r = validateIR(parseYaml(fixture('freeform-over-budget.yaml')))
    assert.equal(r.ok, true)
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:elements=25')
    assert.match(r.warnings[0].hint, /--list-types/)
  })

  test('a long label and three emphasized boxes warn in a stable order (elements, label, emphasis)', () => {
    const elements = [
      box('a', 16, 8, { emphasis: true, label: 'twenty-one characters' }),
      box('b', 16, 48, { emphasis: true }),
      box('c', 176, 8, { emphasis: true }),
      { kind: 'text', id: 't', x: 176, y: 56, text: 'a very long annotation text' },
    ]
    const w = freeform.budgetWarnings(freeform.normalize(minimal({ elements })))
    assert.deepEqual(w.map((x) => x.key), ['budget:label', 'budget:emphasis'])
    assert.equal(w[0].value, 27)
    assert.match(w[0].detail, /2 label\(s\) longer than 20 chars \(longest: "a very long annotation text" on t\)/)
    assert.equal(w[1].value, 3)
    const many = freeform.normalize(minimal({ elements: [...elements, ...Array.from({ length: 21 }, (_, i) => ({ kind: 'circle', id: `c${i}`, cx: 8 + i * 12, cy: 100, r: 4 }))] }))
    assert.deepEqual(freeform.budgetWarnings(many).map((x) => x.key), ['budget:elements', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(freeform.budgetWarnings(freeform.normalize(minimal())), [])
  })

  test('preset: wardley adds the survey budgets — components ≤ 9, links ≤ 12, no isolated component; a plain freeform never warns on them', () => {
    const node = (i) => box(`n${i}`, 40 + (i % 4) * 104, 32 + Math.floor(i / 4) * 48, { w: 96, h: 28 })
    const link = (i) => ({ kind: 'line', id: `l${i}`, points: [[88 + (i % 4) * 104, 60 + Math.floor(i / 4) * 48], [88 + (i % 4) * 104, 80 + Math.floor(i / 4) * 48]] })
    const wardley = (elements) => freeform.normalize(minimal({ preset: 'wardley', width: 488, height: 320, elements }))
    // 10 connected components: every box has a line starting on its bottom edge
    const ten = wardley([...Array.from({ length: 10 }, (_, i) => node(i)), ...Array.from({ length: 10 }, (_, i) => link(i))])
    const w = freeform.budgetWarnings(ten)
    assert.deepEqual(w.map((x) => x.key), ['budget:components'])
    assert.equal(w[0].value, 10)
    assert.match(w[0].detail, /10 wardley components \(guidance ≤ 9\)/)
    // 13 links on 4 connected boxes
    const many = wardley([...Array.from({ length: 4 }, (_, i) => node(i)), ...Array.from({ length: 13 }, (_, i) => ({ kind: 'line', id: `l${i}`, points: [[88 + (i % 4) * 104, 60], [88 + (i % 4) * 104, 96 + i * 4]] }))])
    const wl = freeform.budgetWarnings(many)
    assert.deepEqual(wl.map((x) => x.key), ['budget:links'])
    assert.equal(wl[0].value, 13)
    // an isolated box and an isolated circle
    const lonely = wardley([node(0), node(1), link(0), { kind: 'circle', id: 'c', cx: 400, cy: 200, r: 6 }])
    const wi = freeform.budgetWarnings(lonely)
    assert.deepEqual(wi.map((x) => x.key), ['wardley:isolated'])
    assert.equal(wi[0].value, 2)
    assert.match(wi[0].detail, /isolated component\(s\): n1, c/)
    assert.match(wi[0].hint, /connect the component/)
    // the same elements without the preset: no wardley warning
    assert.deepEqual(freeform.budgetWarnings(freeform.normalize(minimal({ width: 488, height: 320, elements: lonely.elements }))), [])
    assert.deepEqual(freeform.budgetWarnings(validIr('freeform-wardley.yaml')), [])
  })
})

// --- layout ----------------------------------------------------------------------

describe('freeform: layout', () => {
  test('the canvas is exactly the authored width × height and every element keeps its authored position', async () => {
    const ir = validIr('freeform-simple.yaml')
    const l = await freeform.layout(ir)
    assert.equal(l.width, 400)
    assert.equal(l.height, 200)
    assert.equal('preset' in l.geo, false)
    const web = l.geo.elements.find((e) => e.id === 'web')
    assert.deepEqual([web.x, web.y, web.width, web.height], [32, 56, 96, 32])
    const monitor = l.geo.elements.find((e) => e.id === 'monitor')
    assert.deepEqual([monitor.cx, monitor.cy, monitor.r], [296, 72, 12])
    assert.ok(monitor.labelBox.x >= monitor.cx + monitor.r, 'circle label sits to the right of the circle')
    const line = l.geo.elements.find((e) => e.id === 'api-batch')
    assert.deepEqual(line.points, [{ x: 192, y: 88 }, { x: 192, y: 112 }, { x: 80, y: 112 }, { x: 80, y: 128 }])
    assert.equal(line.labelBox.anchor, 'middle')
    assert.ok(line.labelBox.y + line.labelBox.height <= 112, 'a horizontal-segment label sits above the segment')
    assert.equal(l.geo.texts.length, 7, 'region + 3 box labels + line label + circle label + text')
  })

  test('preset: wardley frames a plot with the two axes, four evenly spaced band ticks and three dividers on the grid', async () => {
    const ir = validIr('freeform-wardley.yaml')
    const l = await freeform.layout(ir)
    const { plot, axes, arrows, dividers } = l.geo.preset
    assert.deepEqual(plot, { x: 32, y: 24, width: 448, height: 260 })
    assert.deepEqual(axes.x, { x1: 32, x2: 480, y: 284 })
    assert.deepEqual(axes.y, { x: 32, y1: 24, y2: 284 })
    assert.deepEqual(dividers.map((d) => d.x), [144, 256, 368])
    const ticks = l.geo.texts.filter((t) => t.owner === 'preset' && t.role.startsWith('tick-'))
    assert.deepEqual(ticks.map((t) => t.text), ['genesis', 'custom', 'product', 'commodity'])
    assert.deepEqual(ticks.map((t) => t.ax), [88, 200, 312, 424])
    for (const t of ticks) assert.ok(t.y >= axes.x.y, `tick ${t.text} sits below the x axis`)
    // axis titles: horizontal plain words, no arrow glyph; the direction is a short arrowhead line beside each
    const xTitle = l.geo.texts.find((t) => t.role === 'x-title')
    const yTitle = l.geo.texts.find((t) => t.role === 'y-title')
    assert.equal(xTitle.text, 'evolution')
    assert.equal(yTitle.text, 'visibility')
    for (const t of [xTitle, yTitle]) {
      assert.equal('rotate' in t, false)
      assert.equal(t.height, 16)
      assert.doesNotMatch(t.text, /[←-⇿]/u)
    }
    assert.deepEqual(arrows.x, { x1: 464, y1: 312, x2: 480, y2: 312 })
    assert.deepEqual(arrows.y, { x1: 32, y1: 20, x2: 32, y2: 4 })
    assert.equal(xTitle.x + xTitle.width, 460)
    assert.equal(yTitle.y, 4)
    assert.ok(yTitle.y + yTitle.height <= plot.y)
    assert.ok(yTitle.x >= arrows.y.x1, "the y title sits right of its direction arrow")
  })

  test('layout and render are deterministic: same IR → deep-equal geometry and byte-identical svg', async () => {
    for (const f of ['freeform-simple.yaml', 'freeform-wardley.yaml']) {
      const ir = validIr(f)
      const a = await freeform.layout(ir)
      const b = await freeform.layout(JSON.parse(JSON.stringify(ir)))
      assert.deepEqual(a, b, f)
      const r1 = await renderFigure(getFigureType('freeform'), ir)
      const r2 = await renderFigure(getFigureType('freeform'), ir)
      assert.equal(r1.svg, r2.svg, f)
    }
  })

  test('draw() uses kit tokens only: data-tone on boxes, wu-focal + 1.5 stroke on emphasis, dashed 4 3, marker on arrows', async () => {
    const ir = validIr('freeform-simple.yaml')
    const svg = freeform.draw(await freeform.layout(ir), ir)
    assert.match(svg, /<rect id="wu-d-ff-simple-web" data-tone="ts" class="wu-focal"[^>]*stroke-width="1\.5"/)
    assert.match(svg, /<rect id="wu-d-ff-simple-batch" data-tone="neutral"[^>]*stroke-dasharray="4 3"/)
    assert.match(svg, /<path id="wu-d-ff-simple-web-api"[^>]*marker-end="url\(#wu-d-ff-simple-solid\)"/)
    assert.match(svg, /<rect id="wu-d-ff-simple-zone"[^>]*fill="var\(--wu-rule-soft\)"/)
    assert.match(svg, /<text id="wu-d-ff-simple-note"[^>]*font-size="11"/)
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}\b/)
    assert.doesNotMatch(svg, /<svg/)
    assert.doesNotMatch(svg, /wu-d-ff-simple-muted/, 'the muted arrowhead marker is a wardley-only def')
    const w = validIr('freeform-wardley.yaml')
    const wsvg = freeform.draw(await freeform.layout(w), w)
    assert.doesNotMatch(wsvg, /rotate\(/)
    assert.doesNotMatch(wsvg, /[←-⇿]/u, 'no arrow characters (self-check emoji/arrow rule)')
    assert.match(wsvg, /<marker id="wu-d-ff-wardley-muted"[^>]*><path [^>]*fill="var\(--wu-ink-3\)"\/><\/marker>/)
    assert.match(wsvg, /<line id="wu-d-ff-wardley-arrow-x" x1="464" y1="312" x2="480" y2="312" stroke="var\(--wu-ink-3\)" stroke-width="1" marker-end="url\(#wu-d-ff-wardley-muted\)"\/>/)
    assert.match(wsvg, /<line id="wu-d-ff-wardley-arrow-y" x1="32" y1="20" x2="32" y2="4" [^>]*marker-end="url\(#wu-d-ff-wardley-muted\)"\/>/)
    assert.match(wsvg, /<text id="wu-d-ff-wardley-x-title" x="460" y="316" font-size="11" text-anchor="end" fill="var\(--wu-ink-3\)">evolution<\/text>/)
    assert.match(wsvg, /<text id="wu-d-ff-wardley-y-title" x="40" y="16" font-size="11" text-anchor="start" fill="var\(--wu-ink-3\)">visibility<\/text>/)
  })
})

// --- verify rows -----------------------------------------------------------------

describe('freeform: verify rows fail on a crafted IR', () => {
  const rows = ['in-canvas', 'text-no-overlap', 'text-clear-of-borders', 'lines-avoid-nodes', 'grid-4px-authored', 'element-count', 'label-length', 'emphasis-count', 'preset-in-plot', 'wardley-components', 'wardley-links', 'wardley-isolated']

  test('doc.rows lists the twelve own rows in verify() order, the shared rows follow, and the fixtures pass', async () => {
    assert.deepEqual(freeform.doc.rows, rows)
    for (const f of ['freeform-simple.yaml', 'freeform-wardley.yaml']) {
      const { verification } = await renderAndVerify(validIr(f))
      assert.deepEqual(verification.checks.slice(0, 12).map((c) => c.name), rows)
      assert.deepEqual(verification.checks.slice(0, 12).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      assert.equal(verification.checks[12].name, 'single-finite-svg')
      assert.equal(verification.checks[12].id, 13)
      assert.equal(verification.ok, true, `${f}: ${JSON.stringify(verification.failures)}`)
      assert.deepEqual(verification.warnings, [])
    }
    const simple = await renderAndVerify(validIr('freeform-simple.yaml'))
    assert.equal(byName(simple.verification.checks, 'wardley-isolated').detail, 'no preset — not a wardley map')
    const lonely = freeform.normalize(minimal({ preset: 'wardley', width: 488, height: 320, elements: [box('a', 40, 40), box('b', 200, 40)] }))
    const lv = await renderAndVerify(lonely)
    assert.equal(lv.verification.ok, true)
    const row = byName(lv.verification.checks, 'wardley-isolated')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.equal(row.key, 'wardley:isolated')
    assert.equal(row.value, 2)
    assert.deepEqual(lv.verification.warnings.map((w) => w.key), ['wardley:isolated'])
  })

  test('#1 in-canvas fails for a box past the right edge, a line point below the bottom, and a text whose width leaves the canvas', async () => {
    let r = byName(await ownRows(minimal({ elements: [box('a', 240, 40)] })), 'in-canvas')
    assert.equal(r.ok, false)
    assert.equal(r.severity, 'fail')
    assert.match(r.detail, /a \(box\)/)
    r = byName(await ownRows(minimal({ elements: [{ kind: 'line', id: 'l', points: [[8, 8], [8, 124]] }] })), 'in-canvas')
    assert.match(r.detail, /l \(line\)/)
    r = byName(await ownRows(minimal({ elements: [{ kind: 'text', id: 't', x: 296, y: 8, text: 'runs off the edge' }] })), 'in-canvas')
    assert.match(r.detail, /t text "runs off the edge"/)
    r = byName(await ownRows(minimal({ elements: [{ kind: 'circle', id: 'c', cx: 316, cy: 60, r: 8 }] })), 'in-canvas')
    assert.match(r.detail, /c \(circle\)/)
  })

  test('#2 text-no-overlap fails for two texts on the same row and for a text over a box label', async () => {
    let r = byName(await ownRows(minimal({ elements: [
      { kind: 'text', id: 't1', x: 16, y: 16, text: 'first' }, { kind: 'text', id: 't2', x: 24, y: 16, text: 'second' },
    ] })), 'text-no-overlap')
    assert.equal(r.ok, false)
    assert.match(r.detail, /t1 "first" \/ t2 "second"/)
    r = byName(await ownRows(minimal({ elements: [box('a', 16, 40), { kind: 'text', id: 't', x: 48, y: 48, text: 'on top' }] })), 'text-no-overlap')
    assert.equal(r.ok, false)
    assert.match(r.detail, /a "a" \/ t "on top"/)
    // a wardley plot too narrow for its own ticks fails the same row
    r = byName(await ownRows(minimal({ preset: 'wardley', width: 176, height: 120, elements: [{ kind: 'circle', id: 'c', cx: 80, cy: 40, r: 6 }] })), 'text-no-overlap')
    assert.equal(r.ok, false)
    assert.match(r.detail, /preset "genesis" \/ preset "custom"/)
  })

  test('#3 text-clear-of-borders fails for a text across a box border, a region border, and a label wider than its box', async () => {
    let r = byName(await ownRows(minimal({ elements: [box('a', 16, 40), { kind: 'text', id: 't', x: 96, y: 60, text: 'straddles' }] })), 'text-clear-of-borders')
    assert.equal(r.ok, false)
    assert.equal(r.severity, 'fail')
    assert.match(r.detail, /t "straddles" crosses the border of a/)
    r = byName(await ownRows(minimal({ elements: [
      { kind: 'region', id: 'z', x: 16, y: 16, w: 128, h: 80, label: 'zone' }, { kind: 'text', id: 't', x: 128, y: 48, text: 'half in' },
    ] })), 'text-clear-of-borders')
    assert.match(r.detail, /t "half in" crosses the border of z/)
    r = byName(await ownRows(minimal({ elements: [box('a', 16, 40, { label: 'a label far wider than 96px' })] })), 'text-clear-of-borders')
    assert.match(r.detail, /a label "a label far wider than 96px" is wider than its box/)
    // fully inside a box (a sublabel) is allowed
    r = byName(await ownRows(minimal({ elements: [box('a', 16, 40, { h: 48 }), { kind: 'text', id: 't', x: 24, y: 64, text: 'sub', size: 'small' }] })), 'text-clear-of-borders')
    assert.equal(r.ok, true)
  })

  test('#4 lines-avoid-nodes fails when a line runs through a box or circle it does not start or end at', async () => {
    let r = byName(await ownRows(minimal({ elements: [
      box('a', 16, 40), box('b', 176, 40), box('mid', 120, 40, { w: 40 }),
      { kind: 'line', id: 'ab', points: [[112, 56], [176, 56]], arrow: true },
    ] })), 'lines-avoid-nodes')
    assert.equal(r.ok, false)
    assert.equal(r.severity, 'fail')
    assert.match(r.detail, /ab passes through mid/)
    r = byName(await ownRows(minimal({ elements: [
      { kind: 'circle', id: 'c', cx: 160, cy: 56, r: 12 },
      { kind: 'line', id: 'l', points: [[16, 56], [304, 56]] },
    ] })), 'lines-avoid-nodes')
    assert.match(r.detail, /l passes through c/)
    // a bend around the node, or ending at it, passes
    r = byName(await ownRows(minimal({ elements: [
      box('a', 16, 40), box('b', 176, 40), box('mid', 120, 40, { w: 40 }),
      { kind: 'line', id: 'ab', points: [[64, 72], [64, 88], [224, 88], [224, 72]], arrow: true },
      { kind: 'line', id: 'am', points: [[112, 56], [160, 56]] },
    ] })), 'lines-avoid-nodes')
    assert.equal(r.ok, true, r.detail)
  })

  test('#5 grid-4px-authored fails for an off-grid canvas, box position, box size, circle centre, text and line point; a circle r is free', async () => {
    let r = byName(await ownRows(minimal({ width: 322 })), 'grid-4px-authored')
    assert.equal(r.ok, false)
    assert.equal(r.severity, 'fail')
    assert.match(r.detail, /canvas 322×120/)
    r = byName(await ownRows(minimal({ elements: [box('a', 18, 40, { h: 30 })] })), 'grid-4px-authored')
    assert.match(r.detail, /a x=18 h=30/)
    r = byName(await ownRows(minimal({ elements: [
      { kind: 'circle', id: 'c', cx: 50, cy: 60, r: 6 }, { kind: 'text', id: 't', x: 8, y: 10, text: 'x' },
      { kind: 'line', id: 'l', points: [[8, 100], [9, 100]] },
    ] })), 'grid-4px-authored')
    assert.match(r.detail, /c cx=50/)
    assert.match(r.detail, /t y=10/)
    assert.match(r.detail, /l points\[1\]=\[9, 100\]/)
    r = byName(await ownRows(minimal({ elements: [{ kind: 'circle', id: 'c', cx: 48, cy: 60, r: 6 }] })), 'grid-4px-authored')
    assert.equal(r.ok, true)
  })

  test('#6–#8 budget rows are warn severity and carry key/value from budgetWarnings()', async () => {
    const { verification } = await renderAndVerify(validIr('freeform-over-budget.yaml'))
    assert.equal(verification.ok, true)
    const row = byName(verification.checks, 'element-count')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.equal(row.key, 'budget:elements')
    assert.equal(row.value, 25)
    assert.deepEqual(verification.warnings.map((w) => w.key), ['budget:elements'])
    const three = freeform.normalize(minimal({ elements: [box('a', 16, 8, { emphasis: true }), box('b', 16, 56, { emphasis: true }), box('c', 176, 8, { emphasis: true })] }))
    const v = await renderAndVerify(three)
    assert.equal(byName(v.verification.checks, 'emphasis-count').ok, false)
    assert.equal(byName(v.verification.checks, 'emphasis-count').value, 3)
    assert.equal(byName(v.verification.checks, 'label-length').ok, true)
    const long = freeform.normalize(minimal({ elements: [{ kind: 'text', id: 't', x: 8, y: 8, text: 'twenty-one characters' }] }))
    const lv = await renderAndVerify(long)
    assert.equal(byName(lv.verification.checks, 'label-length').ok, false)
    assert.equal(byName(lv.verification.checks, 'label-length').value, 21)
    assert.equal(lv.verification.ok, true)
  })

  test('#9 preset-in-plot fails for a wardley box in the axis band or past the plot, and is a no-op without a preset', async () => {
    let r = byName(await ownRows(minimal({ preset: 'wardley', width: 488, height: 320, elements: [box('a', 16, 40)] })), 'preset-in-plot')
    assert.equal(r.ok, false)
    assert.equal(r.severity, 'fail')
    assert.match(r.detail, /a \(box\)/)
    assert.match(r.hint, /x 32\.\.480, y 24\.\.284/)
    r = byName(await ownRows(minimal({ preset: 'wardley', width: 488, height: 320, elements: [{ kind: 'circle', id: 'c', cx: 200, cy: 280, r: 6 }] })), 'preset-in-plot')
    assert.match(r.detail, /c \(circle\)/)
    r = byName(await ownRows(minimal()), 'preset-in-plot')
    assert.equal(r.ok, true)
    assert.match(r.detail, /no preset/)
  })
})

// --- registry + CLI -----------------------------------------------------------------

describe('freeform: registry path and CLI', () => {
  test('renderFigureHtmlChecked → data-checks="pass" data-type="freeform", data-warn only when over budget, a failing row withholds pass', async () => {
    for (const f of ['freeform-simple.yaml', 'freeform-wardley.yaml']) {
      const clean = await renderFigureHtmlChecked(validIr(f))
      assert.equal(clean.checksOk, true, `${f}: ${JSON.stringify(clean.failures)}`)
      assert.match(clean.html, /<figure class="wu-figure"[^>]*data-checks="pass"/)
      assert.match(clean.html, /data-type="freeform"/)
      assert.doesNotMatch(clean.html, /data-warn=/)
      assert.match(clean.html, /<script type="text\/x-writeup-diagram"/)
    }
    const over = await renderFigureHtmlChecked(validIr('freeform-over-budget.yaml'))
    assert.equal(over.checksOk, true)
    assert.equal(over.warn, 'budget:elements=25')
    assert.match(over.html, /data-warn="budget:elements=25"/)
    const broken = await renderFigureHtmlChecked(validateIR(minimal({ elements: [box('a', 18, 40)] })).ir)
    assert.equal(broken.checksOk, false)
    assert.deepEqual(broken.failures.map((c) => c.name), ['grid-4px-authored', 'grid-4px'])
    assert.doesNotMatch(broken.html, /data-checks="pass"/)
  })

  test('the CLI renders freeform-simple and freeform-wardley with --figure (exit 0), --json exposes the checks, a broken IR exits 3', () => {
    for (const f of ['freeform-simple.yaml', 'freeform-wardley.yaml']) {
      const r = runCli([join(FIXTURES, f), '--figure'])
      assert.equal(r.status, 0, `${f}: ${r.stderr}`)
      assert.match(r.stdout, /data-checks="pass"/)
      assert.match(r.stdout, /data-type="freeform"/)
    }
    const j = JSON.parse(runCli([join(FIXTURES, 'freeform-wardley.yaml'), '--json']).stdout)
    assert.equal(j.ok, true)
    assert.equal(j.checks.length, 19)
    assert.equal(j.checks.filter((c) => !c.ok).length, 0)
    assert.match(j.figureHtml, /genesis/)
    assert.match(j.figureHtml, /commodity/)
    assert.doesNotMatch(j.figureHtml, /[←-⇿]/u)
  })

  test('--doc freeform prints the irExample (a wardley map: 6 boxes, 5 lines) and it renders clean; --list-types mentions the escape-hatch rule', () => {
    const doc = runCli(['--doc', 'freeform'])
    assert.equal(doc.status, 0)
    assert.equal(doc.stdout, freeform.doc.irExample)
    const ir = validateIR(parseYaml(doc.stdout))
    assert.equal(ir.ok, true)
    assert.equal(ir.ir.preset, 'wardley')
    assert.equal(ir.ir.elements.filter((e) => e.kind === 'box').length, 6)
    assert.equal(ir.ir.elements.filter((e) => e.kind === 'line').length, 5)
    assert.deepEqual(ir.warnings, [])
    const listed = runCli(['--list-types'])
    assert.match(listed.stdout, /^freeform {2}\(plugin\)\n {2}purpose: /m)
    assert.match(listed.stdout, /budgets: maxElements=24 maxLabelLen=20 maxEmphasis=2 maxComponents=9 maxLinks=12/)
    assert.match(listed.stdout, /one-off figures only/)
    assert.match(listed.stdout, /--list-types/)
    assert.match(freeform.doc.whenToUse, /one-off figures only[^]*--list-types/)
  })
})
