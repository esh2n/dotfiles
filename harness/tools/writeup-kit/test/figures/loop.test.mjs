// `type: loop` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/loop-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as loop from '../../bin/lib/figures/loop.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const ALL_FIXTURES = ['loop-simple.yaml', 'loop-hub.yaml', 'loop-ccw.yaml', 'loop-over-budget.yaml']
const CLEAN_FIXTURES = ['loop-hub.yaml']
// Rings under the step floor and without a hub: they render (data-checks pass) but carry data-warn.
const UNDER_FIXTURES = { 'loop-simple.yaml': 'budget:steps=4;budget:hub=0', 'loop-ccw.yaml': 'budget:steps=3;budget:hub=0' }
const BUDGET_KEYS = ['budget:steps', 'budget:label', 'budget:emphasis']
const OWN_ROWS = ['step-count', 'label-length', 'emphasis-count', 'hub-present', 'boxes-clear', 'arcs-clear', 'labels-clear', 'arrow-direction']

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

const plugin = getFigureType('loop')

const minimal = () => ({
  id: 'l', type: 'loop', title: 't',
  hub: 'Hub',
  steps: [
    { id: 'a', label: 'Alpha', tone: 'ts' },
    { id: 'b', label: 'Beta', note: 'n', emphasis: true },
    { id: 'c', label: 'Gamma' },
    { id: 'd', label: 'Delta' },
  ],
  edgeLabels: [{ from: 'a', to: 'b', label: 'ab' }],
  exits: [{ from: 'c', label: 'out' }],
})

const stepAngles = (l) => l.geo.steps.map((s) => s.angle)

// --- schema ----------------------------------------------------------------

describe('figures/loop.mjs: schema', () => {
  test('a valid IR normalizes: direction/tone/emphasis defaulted, empty optional lists dropped', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'loop')
    assert.equal(r.ir.direction, 'cw')
    assert.equal(r.ir.hub, 'Hub')
    assert.deepEqual(r.ir.steps[0], { id: 'a', label: 'Alpha', emphasis: false, tone: 'ts' })
    assert.deepEqual(r.ir.steps[1], { id: 'b', label: 'Beta', note: 'n', emphasis: true, tone: 'neutral' })
    assert.deepEqual(r.ir.edgeLabels, [{ from: 'a', to: 'b', label: 'ab' }])
    assert.deepEqual(r.ir.exits, [{ from: 'c', label: 'out' }])
    const bare = validateIR({ ...minimal(), hub: undefined, edgeLabels: [], exits: undefined, direction: 'ccw' })
    assert.equal(bare.ok, true)
    assert.equal(bare.ir.direction, 'ccw')
    assert.equal('hub' in bare.ir, false)
    assert.equal('edgeLabels' in bare.ir, false)
    assert.equal('exits' in bare.ir, false)
  })

  test('normalize is idempotent', () => {
    const once = loop.normalize(minimal())
    const twice = loop.normalize(once)
    assert.deepEqual(twice, once)
    for (const name of ALL_FIXTURES) {
      const fromFixture = validIr(name)
      assert.deepEqual(loop.normalize(fromFixture), fromFixture, name)
    }
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), steps: [] }, /ir\.steps must be a non-empty list/],
      [{ ...minimal(), steps: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edgeLabels: undefined, exits: undefined }, /ir\.steps needs at least 3 steps to form a loop \(got: 2\)/],
      [{ ...minimal(), steps: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }, { id: 'c', label: 'C' }], edgeLabels: undefined, exits: undefined }, /duplicate step id: "a"/],
      [{ ...minimal(), steps: [{ id: 'a' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }, /ir\.steps\[0\]\.label is required/],
      [{ ...minimal(), steps: [{ id: 'a', label: 'A', tone: 'red' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }, /ir\.steps\[0\]\.tone must be ts\|rs\|new\|neutral/],
      [{ ...minimal(), steps: [{ id: 'a', label: 'A', emphasis: 'yes' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }, /ir\.steps\[0\]\.emphasis must be a boolean/],
      [{ ...minimal(), direction: 'clockwise' }, /ir\.direction must be cw\|ccw \(got: "clockwise"\)/],
      [{ ...minimal(), hub: '' }, /ir\.hub must be a non-empty string/],
      [{ ...minimal(), hub: 3 }, /ir\.hub must be a string/],
      [{ ...minimal(), exits: [{ from: 'zzz', label: 'x' }] }, /ir\.exits\[0\]\.from references unknown step "zzz"/],
      [{ ...minimal(), exits: [{ from: 'a', label: 'x' }, { from: 'a', label: 'y' }] }, /ir\.exits\[1\]: step "a" already has an exit/],
      [{ ...minimal(), exits: [{ from: 'a' }] }, /ir\.exits\[0\]\.label is required/],
      [{ ...minimal(), edgeLabels: [{ from: 'a', to: 'c', label: 'x' }] }, /ir\.edgeLabels\[0\]: no arc runs a → c \(the arc from "a" goes to "b"\)/],
      [{ ...minimal(), edgeLabels: [{ from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'b', label: 'y' }] }, /ir\.edgeLabels\[1\]: the arc from "a" already has a label/],
      [{ ...minimal(), edgeLabels: 'x' }, /ir\.edgeLabels must be a list/],
    ]
    for (const [raw, re] of cases) {
      const r = validateIR(raw)
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(raw).slice(0, 100)}`)
      assert.equal(r.reason, 'schema')
      assert.match(r.message, re)
    }
  })
})

// --- budgets ---------------------------------------------------------------

describe('figures/loop.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    for (const name of CLEAN_FIXTURES) assert.deepEqual(loop.budgetWarnings(validIr(name)), [], name)
  })

  test('fewer than 5 steps warns against the lower bound and a missing hub warns budget:hub (a Cycle, not a Loop)', async () => {
    for (const [name, warn] of Object.entries(UNDER_FIXTURES)) {
      const r = validateIR(parseYaml(fixture(name)))
      assert.equal(r.ok, true)
      assert.equal(formatBudgetWarnings(r.warnings), warn, name)
      assert.match(r.warnings[0].detail, /guidance ≥ 5/)
      assert.match(r.warnings[1].hint, /Cycle, not a Loop/)
      const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, new RegExp(`^<figure class="wu-figure" data-checks="pass" data-warn="${warn}" data-type="loop">`))
    }
    const six = validateIR({ ...minimal(), steps: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id })), edgeLabels: undefined, exits: undefined })
    assert.deepEqual(six.warnings, [], 'five steps with a hub is within budget')
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('loop-over-budget.yaml')
    const warns = loop.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), BUDGET_KEYS)
    assert.deepEqual(warns.map((w) => w.value), [9, 19, 3])
    assert.equal(formatBudgetWarnings(warns), 'budget:steps=9;budget:label=19;budget:emphasis=3')
    for (const w of warns) assert.ok(w.hint && w.hint !== w.detail, `${w.key} needs a concrete hint`)
    const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture('loop-over-budget.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:steps=9;budget:label=19;budget:emphasis=3" data-type="loop">/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/loop.mjs: layout', () => {
  test('steps sit on one circle in IR order, the first at the top, evenly spaced clockwise', async () => {
    const ir = validIr('loop-simple.yaml')
    const l = await loop.layout(ir, { column: 720 })
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    assert.ok(l.width <= 720)
    assert.deepEqual(l.geo.steps.map((s) => s.id), ir.steps.map((s) => s.id))
    assert.deepEqual(stepAngles(l), [-90, 0, 90, 180])
    const { cx, cy, radius } = l.geo
    for (const s of l.geo.steps) {
      assert.ok(Math.abs(Math.hypot(s.centerX - cx, s.centerY - cy) - radius) <= 3, `${s.id} is off the circle`)
      assert.equal(s.x + s.width / 2, s.centerX)
      assert.equal(s.y + s.height / 2, s.centerY)
    }
    const top = l.geo.steps[0]
    assert.equal(top.centerX, cx)
    assert.ok(top.centerY < cy)
    assert.equal(l.geo.hub, undefined)
    assert.equal(l.geo.spokes, undefined)
    assert.deepEqual(l.geo.exits, [])
  })

  test('direction: ccw places the second step to the left and flips the sweep flag', async () => {
    const l = await loop.layout(validIr('loop-ccw.yaml'))
    assert.deepEqual(stepAngles(l), [-90, -210, -330])
    assert.ok(l.geo.steps[1].centerX < l.geo.cx, 'second step lies left of centre')
    assert.ok(l.geo.arcs.every((a) => a.sweep === 0))
    const cw = await loop.layout(validIr('loop-simple.yaml'))
    assert.ok(cw.geo.arcs.every((a) => a.sweep === 1))
  })

  test('the radius grows with step count and label width so boxes never touch', async () => {
    const four = await loop.layout(validIr('loop-simple.yaml'))
    const nine = await loop.layout(validIr('loop-over-budget.yaml'))
    assert.ok(nine.geo.radius > four.geo.radius, `${nine.geo.radius} > ${four.geo.radius}`)
    const wide = validateIR({ ...minimal(), hub: undefined, edgeLabels: undefined, exits: undefined, steps: [{ id: 'a', label: 'a very long step label indeed' }, { id: 'b', label: 'another very long step label' }, { id: 'c', label: 'c' }, { id: 'd', label: 'd' }] }).ir
    const w = await loop.layout(wide)
    assert.ok(w.geo.radius > four.geo.radius)
    for (const l of [four, nine, w]) {
      const boxes = l.geo.steps.map((s) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height }))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]; const b = boxes[j]
          const gapX = Math.max(a.left - b.right, b.left - a.right)
          const gapY = Math.max(a.top - b.bottom, b.top - a.bottom)
          assert.ok(Math.max(gapX, gapY) >= 24, `${l.geo.steps[i].id}/${l.geo.steps[j].id} closer than 24px`)
        }
      }
    }
  })

  test('arcs join consecutive steps on the circle, end 6px short of each box, and carry a label outside the circle when asked', async () => {
    const ir = validIr('loop-hub.yaml')
    const l = await loop.layout(ir, { column: 720 })
    const { cx, cy, radius } = l.geo
    assert.equal(l.geo.arcs.length, 5)
    l.geo.arcs.forEach((a, i) => {
      assert.equal(a.from, ir.steps[i].id)
      assert.equal(a.to, ir.steps[(i + 1) % 5].id)
      assert.ok(Math.abs(Math.hypot(a.sx - cx, a.sy - cy) - radius) < 0.2, 'arc start on the circle')
      assert.ok(Math.abs(Math.hypot(a.ex - cx, a.ey - cy) - radius) < 0.2, 'arc end on the circle')
      assert.ok(a.length >= 28)
    })
    const labelled = l.geo.arcs.filter((a) => a.label)
    assert.deepEqual(labelled.map((a) => [a.from, a.label.text]), [['data', '再学習'], ['referral', '口コミ']])
    for (const a of labelled) {
      const mid = Math.hypot(a.label.x - cx, a.label.y - cy)
      assert.ok(mid > radius, `label anchor of ${a.from} lies outside the circle`)
      assert.equal(a.label.x % 4, 0)
      assert.equal(a.label.y % 4, 0)
    }
  })

  test('a hub is a centred circle sized to its label with one dashed spoke per step ending short of the box', async () => {
    const ir = validIr('loop-hub.yaml')
    const l = await loop.layout(ir)
    const { cx, cy, hub, spokes, steps } = l.geo
    assert.equal(hub.text, 'データ資産')
    assert.equal(hub.cx, cx)
    assert.equal(hub.cy, cy)
    assert.ok(hub.r >= 28 && hub.r % 4 === 0)
    assert.equal(spokes.length, steps.length)
    spokes.forEach((sp, i) => {
      assert.equal(sp.to, steps[i].id)
      assert.ok(Math.abs(Math.hypot(sp.sx - cx, sp.sy - cy) - (hub.r + 4)) < 0.2, 'spoke starts just outside the hub')
      const s = steps[i]
      const dx = Math.max(s.x - sp.ex, 0, sp.ex - (s.x + s.width))
      const dy = Math.max(s.y - sp.ey, 0, sp.ey - (s.y + s.height))
      const d = Math.hypot(dx, dy)
      assert.ok(d >= 3.5 && d <= 6, `spoke to ${s.id} ends ${d}px from its box`)
    })
    for (const s of steps) {
      const dx = Math.max(s.x - cx, 0, cx - (s.x + s.width))
      const dy = Math.max(s.y - cy, 0, cy - (s.y + s.height))
      assert.ok(Math.hypot(dx, dy) >= hub.r + 20, `${s.id} keeps 20px from the hub`)
    }
  })

  test('an exit is a 32px orthogonal arrow out of the outer side of its step, label beyond the tip', async () => {
    const hubL = await loop.layout(validIr('loop-hub.yaml'))
    const [ux] = hubL.geo.exits
    assert.equal(ux.from, 'ux')
    assert.equal(ux.side, 'bottom')
    assert.equal(ux.x1, ux.x2)
    assert.equal(ux.y2 - ux.y1, 32)
    const uxStep = hubL.geo.steps.find((s) => s.id === 'ux')
    assert.ok(ux.y1 >= uxStep.y + uxStep.height && ux.y1 - (uxStep.y + uxStep.height) < 4)
    assert.equal(ux.label.anchor, 'middle')
    assert.ok(ux.label.y > ux.y2)
    const ccwL = await loop.layout(validIr('loop-ccw.yaml'))
    const [esc] = ccwL.geo.exits
    assert.equal(esc.side, 'left')
    assert.equal(esc.y1, esc.y2)
    assert.equal(esc.x1 - esc.x2, 32)
    assert.equal(esc.label.anchor, 'end')
    assert.ok(esc.label.x < esc.x2)
    assert.ok(esc.label.box.left >= 0, 'the exit label stays on the canvas')
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ALL_FIXTURES) {
      const ir = validIr(name)
      const a = await loop.layout(ir, { column: 720 })
      const b = await loop.layout(ir, { column: 720 })
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

describe('figures/loop.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of CLEAN_FIXTURES) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
      assert.deepEqual(plugin.doc.rows, OWN_ROWS)
    }
  })

  test('boxes-clear fails when two step boxes come closer than 24px or a box sits on the hub', async () => {
    const ir = validIr('loop-hub.yaml')
    let l = await loop.layout(ir)
    const [a, b] = l.geo.steps
    b.x = a.x + 8; b.y = a.y; b.centerX = b.x + b.width / 2; b.centerY = b.y + b.height / 2
    let row = byName(loop.verify(l, ir), 'boxes-clear')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /"users" and "data" are closer than 24px/)

    l = await loop.layout(ir)
    const c = l.geo.steps[2]
    c.x = l.geo.cx - c.width / 2; c.y = l.geo.cy - c.height / 2; c.centerX = l.geo.cx; c.centerY = l.geo.cy
    row = byName(loop.verify(l, ir), 'boxes-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /"model" is closer than 20px to the hub/)
  })

  test('arcs-clear fails when a box is moved onto an arc or an arc is too short', async () => {
    const ir = validIr('loop-simple.yaml')
    let l = await loop.layout(ir)
    const { cx, cy, radius } = l.geo
    // park "fix" on the circle at 45°, where the arc write → review runs
    const fix = l.geo.steps[2]
    fix.centerX = cx + Math.round(radius * Math.SQRT1_2 / 4) * 4
    fix.centerY = cy - Math.round(radius * Math.SQRT1_2 / 4) * 4
    fix.x = fix.centerX - fix.width / 2; fix.y = fix.centerY - fix.height / 2
    let row = byName(loop.verify(l, ir), 'arcs-clear')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc write→review crosses "fix"/)

    l = await loop.layout(ir)
    l.geo.arcs[1].length = 10
    row = byName(loop.verify(l, ir), 'arcs-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc review→fix is 10px long \(need ≥ 28\)/)
  })

  test('labels-clear fails when an arc label or an exit label lands on a step box', async () => {
    const ir = validIr('loop-hub.yaml')
    let l = await loop.layout(ir)
    const arc = l.geo.arcs.find((a) => a.label)
    const users = l.geo.steps[0]
    arc.label.box = { left: users.x + 4, top: users.y + 4, right: users.x + 40, bottom: users.y + 20 }
    let row = byName(loop.verify(l, ir), 'labels-clear')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc data→model label overlaps step "users"/)

    l = await loop.layout(ir)
    const model = l.geo.steps.find((s) => s.id === 'model')
    l.geo.exits[0].label.box = { left: model.x, top: model.y, right: model.x + 30, bottom: model.y + 12 }
    row = byName(loop.verify(l, ir), 'labels-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /exit "有料プランへ" label overlaps step "model"/)
  })

  test('arrow-direction fails when an arc runs against the IR direction, in the geometry or in the svg', async () => {
    const ir = validIr('loop-simple.yaml')
    let l = await loop.layout(ir)
    const a = l.geo.arcs[0]
    ;[a.startAngle, a.endAngle] = [a.endAngle, a.startAngle]
    ;[a.sx, a.sy, a.ex, a.ey] = [a.ex, a.ey, a.sx, a.sy]
    let row = byName(loop.verify(l, ir), 'arrow-direction')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc write→review runs against direction cw/)

    l = await loop.layout(ir)
    l.geo.arcs[2].sweep = 0
    row = byName(loop.verify(l, ir), 'arrow-direction')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc fix→merge carries sweep flag 0/)

    l = await loop.layout(ir)
    const rendered = await renderFigure(plugin, ir)
    const flipped = rendered.svg.replace(/(<path id="wu-d-review-cycle-arc-1" d="M[^"]* A[\d.]+ [\d.]+ 0 0 )1/, '$10')
    assert.notEqual(flipped, rendered.svg)
    row = byName(loop.verify(l, ir, { svg: flipped }), 'arrow-direction')
    assert.equal(row.ok, false)
    assert.match(row.detail, /arc review→fix is drawn with sweep flag 0/)
    assert.equal(byName(loop.verify(l, ir, { svg: rendered.svg }), 'arrow-direction').ok, true)
  })

  test('the four budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('loop-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['step-count', 'budget:steps', 9],
      ['label-length', 'budget:label', 19],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const cleanIr = validIr('loop-hub.yaml')
    const clean = await verifyFigure(plugin, cleanIr, await renderFigure(plugin, cleanIr))
    for (const name of ['step-count', 'label-length', 'emphasis-count', 'hub-present']) {
      const row = byName(clean.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
    const noHub = validIr('loop-simple.yaml')
    const nh = await verifyFigure(plugin, noHub, await renderFigure(plugin, noHub))
    assert.deepEqual(nh.warnings.map((w) => [w.name, w.key, w.value]), [['step-count', 'budget:steps', 4], ['hub-present', 'budget:hub', 0]])
  })

  test('the hub takes the accent (wu-focal) only when no step carries emphasis', async () => {
    const stepFocal = validIr('loop-hub.yaml')
    const a = await renderFigure(plugin, stepFocal)
    assert.equal(a.layout.geo.hub.focal, false)
    assert.match(a.svg, /<circle id="wu-d-growth-loop-hub"[^>]*stroke="currentColor" stroke-width="1.5"\/>/)
    assert.doesNotMatch(a.svg, /<circle id="wu-d-growth-loop-hub"[^>]*wu-focal/)
    const hubFocal = validateIR({ ...minimal(), steps: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id })), edgeLabels: undefined, exits: undefined }).ir
    const b = await renderFigure(plugin, hubFocal)
    assert.equal(b.layout.geo.hub.focal, true)
    assert.match(b.svg, /<circle id="wu-d-l-hub"[^>]*class="wu-focal" stroke="var\(--wu-accent\)" stroke-width="1.5"\/>/)
    assert.doesNotMatch(b.svg, /<rect id="wu-d-l-step-[a-e]"[^>]*wu-focal/)
    const v = await verifyFigure(plugin, hubFocal, b)
    assert.match(byName(v.checks, 'hub-present').detail, /carries the accent/)
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/loop.mjs: draw', () => {
  test('boxes carry data-tone, emphasis is the accent stroke + bold label, arcs are arrowed circle segments, spokes are dashed, labels are escaped', async () => {
    const raw = { ...minimal(), hub: 'H&M', steps: [{ id: 'a', label: 'A & <B>', note: 'n<1', tone: 'rs' }, { id: 'b', label: 'B', emphasis: true }, { id: 'c', label: 'C' }], edgeLabels: [{ from: 'a', to: 'b', label: 'l&m' }], exits: [{ from: 'c', label: 'x<y' }] }
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    const rendered = await renderFigure(plugin, r.ir)
    const svg = rendered.svg
    assert.match(svg, /<rect id="wu-d-l-step-a" data-tone="rs" x="\d+" y="\d+"[^>]*rx="4"[^>]*stroke-width="1"\/>/)
    assert.match(svg, /<rect id="wu-d-l-step-b" data-tone="neutral" class="wu-focal"[^>]*stroke-width="1.5"\/>/)
    assert.match(svg, /<text id="wu-d-l-step-b-label"[^>]*font-weight="700"/)
    assert.match(svg, /<text id="wu-d-l-step-a-label"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(svg, /<text id="wu-d-l-step-a-note"[^>]*font-size="11"[^>]*fill="var\(--wu-ink-3\)">n&lt;1<\/text>/)
    assert.match(svg, /<circle id="wu-d-l-hub"[^>]*fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"\/>/)
    assert.match(svg, /<text id="wu-d-l-hub-label"[^>]*font-weight="700"[^>]*>H&amp;M<\/text>/)
    assert.match(svg, /<g id="wu-d-l-spokes" stroke="var\(--wu-ink-3\)" stroke-width="1" stroke-dasharray="4 3">(<line id="wu-d-l-spoke-[abc]"[^>]*\/>){3}<\/g>/)
    assert.equal((svg.match(/<path id="wu-d-l-arc-\d" d="M[\d.]+ [\d.]+ A[\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+" fill="none" stroke="currentColor" stroke-width="1" marker-end="url\(#wu-d-l-solid\)"\/>/g) || []).length, 3)
    assert.match(svg, /<text id="wu-d-l-arc-0-label"[^>]*font-size="11"[^>]*>l&amp;m<\/text>/)
    assert.match(svg, /<line id="wu-d-l-exit-c"[^>]*marker-end="url\(#wu-d-l-solid\)"\/>/)
    assert.match(svg, /<text id="wu-d-l-exit-c-label"[^>]*>x&lt;y<\/text>/)
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}\b/)
    const noHub = await renderFigure(plugin, validateIR({ ...minimal(), hub: undefined }).ir)
    assert.doesNotMatch(noHub.svg, /wu-d-l-hub|wu-d-l-spoke/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/loop.mjs: registry dispatch and CLI', () => {
  test('loop-simple.yaml and loop-hub.yaml render as data-checks="pass" data-type="loop" figures', async () => {
    for (const name of ['loop-simple.yaml', 'loop-hub.yaml']) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" (data-warn="[^"]+" )?data-type="loop">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
      assert.equal(rendered.html.includes('data-scroll="true"'), false, `${name} should fit the column`)
      assert.equal(rendered.scaled, false, `${name} should render 1:1 inside the column`)
    }
  })

  test('the registry lists loop with its limits and doc rows', () => {
    assert.equal(plugin.type, 'loop')
    assert.deepEqual(plugin.limits, { minSteps: 5, maxSteps: 8, maxLabelLen: 14, maxEmphasis: 1 })
    assert.deepEqual(plugin.doc.rows, OWN_ROWS)
  })

  test('doc.irExample validates with 5 steps, a hub and one exit, and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.steps.length, 5)
    assert.equal(typeof r.ir.hub, 'string')
    assert.equal(r.ir.exits.length, 1)
    assert.equal(r.ir.edgeLabels.length, 1)
    assert.deepEqual(loop.budgetWarnings(r.ir), [])
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="loop">/)
  })

  test('--figure prints a verified loop figure; --json reports warnings for the over-budget fixture', () => {
    const fig = runCli([join(FIXTURES, 'loop-hub.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="loop">/)
    const json = runCli([join(FIXTURES, 'loop-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), BUDGET_KEYS)
    assert.match(out.figureHtml, /data-warn="budget:steps=9;budget:label=19;budget:emphasis=3" data-type="loop"/)
    const warnFig = runCli([join(FIXTURES, 'loop-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:steps=9/)
  })
})
