// `type: swimlane` — schema, budgets, layout/routing, verify rows, the
// registry dispatch and the CLI. Fixtures: test/fixtures/swimlane-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/swimlane.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const raw = (name) => parseYaml(fixture(name))

function validIr(name) {
  const result = validateIR(raw(name))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const minimal = (extra = {}) => ({
  id: 'm', type: 'swimlane', title: 't',
  lanes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  steps: [{ id: 's1', label: 'one', lane: 'a' }, { id: 's2', label: 'two', lane: 'b' }, { id: 's3', label: 'three', lane: 'a' }],
  ...extra,
})

const inside = (s, l) => s.x >= l.x && s.y >= l.y && s.x + s.width <= l.x + l.width && s.y + s.height <= l.y + l.height

async function renderClean(ir) {
  const rendered = await renderFigure(plugin, ir)
  const result = await verifyFigure(plugin, ir, rendered)
  assert.equal(result.ok, true, JSON.stringify(result.failures))
  return rendered
}

// --- schema ------------------------------------------------------------------

describe('swimlane: schema', () => {
  test('a minimal IR normalizes: defaults filled, consecutive edges when edges is omitted', () => {
    const ir = plugin.normalize(minimal())
    assert.equal(ir.type, 'swimlane')
    assert.equal(ir.direction, 'right')
    assert.deepEqual(ir.steps[0], { id: 's1', label: 'one', lane: 'a', kind: 'step', tone: 'neutral', emphasis: false, parallel: false })
    assert.deepEqual(ir.edges, [{ from: 's1', to: 's2', label: '', emphasis: false }, { from: 's2', to: 's3', label: '', emphasis: false }])
    const focal = plugin.normalize(minimal({ edges: [{ from: 's1', to: 's2', label: 'hand-off', emphasis: true }] }))
    assert.deepEqual(focal.edges[0], { from: 's1', to: 's2', label: 'hand-off', emphasis: true })
    assert.throws(() => plugin.normalize(minimal({ edges: [{ from: 's1', to: 's2', emphasis: 'yes' }] })), /edges\[0\]\.emphasis must be a boolean/)
  })

  test('normalize is idempotent on every fixture', () => {
    for (const name of ['swimlane-simple.yaml', 'swimlane-decision.yaml', 'swimlane-down.yaml', 'swimlane-over-budget.yaml']) {
      const once = plugin.normalize(raw(name))
      assert.deepEqual(plugin.normalize(once), once, name)
    }
  })

  test('rejects unknown lane / step references, duplicates, bad kind, bad direction, self loops, too few lanes', () => {
    assert.throws(() => plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'zz' }] })), /steps\[0\]\.lane references unknown lane "zz"/)
    assert.throws(() => plugin.normalize(minimal({ edges: [{ from: 's1', to: 'ghost' }] })), /edges\[0\]\.to references unknown step "ghost"/)
    assert.throws(() => plugin.normalize(minimal({ edges: [{ from: 's1', to: 's1' }] })), /from and to must differ/)
    assert.throws(() => plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'a' }, { id: 's1', label: 'y', lane: 'b' }] })), /duplicate step id "s1"/)
    assert.throws(() => plugin.normalize(minimal({ lanes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })), /duplicate lane id "a"/)
    assert.throws(() => plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'a', kind: 'loop' }] })), /kind must be step\|decision\|start\|end/)
    assert.throws(() => plugin.normalize(minimal({ direction: 'up' })), /direction must be right\|down/)
    assert.throws(() => plugin.normalize(minimal({ lanes: [{ id: 'a', label: 'A' }] })), /at least 2 lanes/)
  })

  test('parallel: rejected on the first step and when the lane already holds a step in that column', () => {
    assert.throws(() => plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'a', parallel: true }] })), /first step has no previous step/)
    assert.throws(() => plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'a' }, { id: 's2', label: 'y', lane: 'a', parallel: true }] })), /lane "a" already holds a step in this column/)
    const ok = plugin.normalize(minimal({ steps: [{ id: 's1', label: 'x', lane: 'a' }, { id: 's2', label: 'y', lane: 'b', parallel: true }] }))
    assert.equal(ok.steps[1].parallel, true)
  })

  test('validateIR routes type: swimlane through the plugin', () => {
    const r = validateIR(raw('swimlane-simple.yaml'))
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'swimlane')
    assert.equal(r.ir.edges.length, 4)
    const bad = validateIR(minimal({ edges: [{ from: 's1', to: 'nope' }] }))
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'schema')
  })
})

// --- budgets -----------------------------------------------------------------

describe('swimlane: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(plugin.budgetWarnings(validIr('swimlane-simple.yaml')), [])
    assert.deepEqual(plugin.budgetWarnings(validIr('swimlane-decision.yaml')), [])
  })

  test('lanes, steps, label, emphasis and decision overruns warn in stable order', () => {
    const w = plugin.budgetWarnings(validIr('swimlane-over-budget.yaml'))
    assert.deepEqual(w.map((x) => x.key), ['budget:lanes', 'budget:steps', 'budget:label', 'budget:emphasis', 'budget:decision'])
    assert.deepEqual(w.map((x) => x.value), [6, 13, 15, 3, 1])
    assert.match(w[2].detail, /step "s7"/)
    assert.match(w[4].detail, /decision "s4" has fewer than two outgoing edges/)
    assert.equal(formatBudgetWarnings(w), 'budget:lanes=6;budget:steps=13;budget:label=15;budget:emphasis=3;budget:decision=1')
    const r = validateIR(raw('swimlane-over-budget.yaml'))
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((x) => x.key), w.map((x) => x.key))
  })

  test('a decision with one outgoing edge warns; two labelled branches do not; an unlabelled branch is a fail row, not a warning', async () => {
    const one = plugin.normalize(minimal({ steps: [{ id: 's1', label: 'q?', lane: 'a', kind: 'decision' }, { id: 's2', label: 'y', lane: 'b' }], edges: [{ from: 's1', to: 's2', label: 'yes' }] }))
    assert.deepEqual(plugin.budgetWarnings(one).map((x) => x.key), ['budget:decision'])
    const two = plugin.normalize(minimal({ steps: [{ id: 's1', label: 'q?', lane: 'a', kind: 'decision' }, { id: 's2', label: 'y', lane: 'b' }, { id: 's3', label: 'n', lane: 'a' }], edges: [{ from: 's1', to: 's2', label: 'yes' }, { from: 's1', to: 's3', label: 'no' }] }))
    assert.deepEqual(plugin.budgetWarnings(two), [])
    const unlabelled = plugin.normalize(minimal({ steps: two.steps, edges: [{ from: 's1', to: 's2', label: 'yes' }, { from: 's1', to: 's3' }] }))
    assert.deepEqual(plugin.budgetWarnings(unlabelled), [])
    const rendered = await renderFigure(plugin, unlabelled)
    const result = await verifyFigure(plugin, unlabelled, rendered)
    assert.equal(result.ok, false)
    const row = byName(result.checks, 'decision-labels')
    assert.deepEqual([row.severity, row.ok], ['fail', false])
    assert.match(row.detail, /unlabelled branch\(es\): edges\[1\] s1 → s3/)
    assert.match(row.hint, /label each branch out of a decision/)
    assert.deepEqual(result.failures.map((f) => f.name), ['decision-labels'])
    const html = await renderFigureHtmlChecked(unlabelled, { rawYaml: 'id: m\n' })
    assert.equal(html.checksOk, false)
  })

  test('emphasis on edges shares the accent budget with steps; more than one backward edge warns', () => {
    const shared = plugin.normalize(minimal({
      steps: [{ id: 's1', label: 'one', lane: 'a', emphasis: true }, { id: 's2', label: 'two', lane: 'b', emphasis: true }, { id: 's3', label: 'three', lane: 'a' }],
      edges: [{ from: 's1', to: 's2', emphasis: true }, { from: 's2', to: 's3' }],
    }))
    const w = plugin.budgetWarnings(shared)
    assert.deepEqual(w.map((x) => [x.key, x.value]), [['budget:emphasis', 3]])
    assert.match(w[0].detail, /3 emphasized step\(s\)\/edge\(s\)/)
    assert.match(w[0].hint, /edge s1 → s2/)
    const twoBack = plugin.normalize(minimal({
      steps: [{ id: 's1', label: 'one', lane: 'a' }, { id: 's2', label: 'two', lane: 'b' }, { id: 's3', label: 'three', lane: 'a' }],
      edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }, { from: 's3', to: 's1', label: 'redo' }, { from: 's2', to: 's1', label: 'fix' }],
    }))
    const b = plugin.budgetWarnings(twoBack)
    assert.deepEqual(b.map((x) => [x.key, x.value, x.limit]), [['budget:back', 2, 1]])
    assert.match(b[0].detail, /s3 → s1, s2 → s1/)
    assert.match(b[0].hint, /reorder the steps/)
    const oneBack = plugin.normalize({ ...twoBack, edges: twoBack.edges.slice(0, 3) })
    assert.deepEqual(plugin.budgetWarnings(oneBack), [])
  })
})

// --- layout ------------------------------------------------------------------

describe('swimlane: layout', () => {
  test('steps take one column each in flow order, parallel steps share a column, every box sits in its lane', async () => {
    const ir = validIr('swimlane-decision.yaml')
    const L = await plugin.layout(ir)
    const cols = L.geo.steps.map((s) => s.column)
    assert.deepEqual(cols, [0, 1, 2, 3, 4, 4, 5])
    const xs = L.geo.steps.map((s) => s.x)
    assert.ok(xs.every((x, i) => i === 0 || i === 5 || x > xs[i - 1]), 'columns run left to right')
    assert.equal(L.geo.steps[4].cx, L.geo.steps[5].cx, 'parallel steps share the column center')
    const laneOf = new Map(L.geo.lanes.map((l) => [l.id, l]))
    for (const s of L.geo.steps) assert.ok(inside(s, laneOf.get(s.lane)), `${s.id} inside lane ${s.lane}`)
    assert.equal(L.width % 4, 0)
    assert.equal(L.height % 4, 0)
    assert.ok(L.width <= 720 / 0.78, 'a 6-column flow fits the column by scaling')
  })

  test('route shapes: straight in a lane, z for a hand-off, vertex out of a decision, back for a backward edge', async () => {
    const ir = validIr('swimlane-decision.yaml')
    const L = await plugin.layout(ir)
    const route = (from, to) => L.geo.edges.find((e) => e.from === from && e.to === to)
    assert.equal(route('draft', 'submit').route, 'straight')
    assert.equal(route('draft', 'submit').points.length, 2)
    assert.equal(route('submit', 'review').route, 'z')
    assert.equal(route('submit', 'review').points.length, 4)
    const yes = route('approve', 'pay')
    assert.equal(yes.route, 'vertex')
    const approve = L.geo.steps.find((s) => s.id === 'approve')
    assert.deepEqual(yes.points[0], { x: approve.cx, y: approve.y + approve.height }, 'leaves the diamond at its bottom vertex')
    const back = route('approve', 'draft')
    assert.equal(back.route, 'back')
    const draft = L.geo.steps.find((s) => s.id === 'draft')
    assert.deepEqual(back.points[back.points.length - 1], { x: draft.x, y: draft.cy }, 'enters the start pill from the left')
    assert.ok(back.points.slice(1, -1).every((p) => p.x < approve.x + approve.width + 40), 'the back edge turns in the gutter right after the decision')
    for (const e of L.geo.edges) {
      if (e.text) assert.ok(e.label, `edge ${e.index} got a label box`)
      for (let i = 1; i < e.points.length; i++) assert.ok(e.points[i].x === e.points[i - 1].x || e.points[i].y === e.points[i - 1].y, `edge ${e.index} segment ${i} orthogonal`)
    }
  })

  test('strip and hook routes verify clean when the direct path is blocked', async () => {
    const strip = plugin.normalize(minimal({
      steps: [{ id: 'a1', label: 'a1', lane: 'a' }, { id: 'a2', label: 'a2', lane: 'a' }, { id: 'a3', label: 'a3', lane: 'a' }],
      edges: [{ from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }, { from: 'a1', to: 'a3', label: 'skip' }],
    }))
    const r1 = await renderClean(strip)
    assert.equal(r1.layout.geo.edges[2].route, 'strip')
    assert.equal(r1.layout.geo.edges[2].points.length, 6)
    const hook = plugin.normalize(minimal({
      lanes: [{ id: 'a', label: 'A' }, { id: 'm', label: 'M' }, { id: 'b', label: 'B' }],
      steps: [{ id: 'p', label: 'p', lane: 'a' }, { id: 'mid', label: 'mid', lane: 'm', parallel: true }, { id: 'q', label: 'q', lane: 'b', parallel: true }],
      edges: [{ from: 'p', to: 'mid' }, { from: 'p', to: 'q', label: 'far' }],
    }))
    const r2 = await renderClean(hook)
    assert.equal(r2.layout.geo.edges[0].route, 'vertex')
    assert.equal(r2.layout.geo.edges[1].route, 'hook')
  })

  test('direction: down transposes — lanes side by side, flow top to bottom, header on top', async () => {
    const ir = validIr('swimlane-down.yaml')
    const L = await plugin.layout(ir)
    const lanes = L.geo.lanes
    assert.ok(lanes.every((l, i) => i === 0 || l.x > lanes[i - 1].x), 'lanes run left to right')
    assert.ok(lanes.every((l) => l.y === lanes[0].y), 'lanes share the top')
    assert.ok(lanes.every((l) => l.labelBox.y === l.y && l.labelBox.width === l.width), 'the label cell is the lane header')
    const ys = L.geo.steps.map((s) => s.y)
    assert.ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'steps flow downward')
    const laneOf = new Map(lanes.map((l) => [l.id, l]))
    for (const s of L.geo.steps) assert.ok(inside(s, laneOf.get(s.lane)), `${s.id} inside lane ${s.lane}`)
    assert.ok(L.width < L.height)
    await renderClean(ir)
  })

  test('layout is deterministic', async () => {
    const ir = validIr('swimlane-decision.yaml')
    assert.deepEqual(await plugin.layout(ir), await plugin.layout(ir))
  })
})

// --- verify rows on crafted geometry ------------------------------------------

describe('swimlane: verify rows', () => {
  test('row names match doc.rows, ids run 1..n, every row passes on the clean fixtures', async () => {
    for (const name of ['swimlane-simple.yaml', 'swimlane-decision.yaml', 'swimlane-down.yaml']) {
      const ir = validIr(name)
      const rows = plugin.verify(await plugin.layout(ir), ir)
      assert.deepEqual(rows.map((r) => r.name), plugin.doc.rows)
      assert.deepEqual(rows.map((r) => r.id), rows.map((_, i) => i + 1))
      assert.ok(rows.every((r) => r.ok), `${name}: ${JSON.stringify(rows.filter((r) => !r.ok))}`)
    }
  })

  test('references fails on an unknown lane or step', async () => {
    const ir = validIr('swimlane-simple.yaml')
    const L = await plugin.layout(ir)
    const mutated = { ...ir, steps: [...ir.steps, { id: 'x', label: 'x', lane: 'nowhere', kind: 'step', tone: 'neutral', emphasis: false, parallel: false }], edges: [...ir.edges, { from: 'ask', to: 'ghost', label: '' }] }
    const row = byName(plugin.verify(L, mutated), 'references')
    assert.equal(row.ok, false)
    assert.match(row.detail, /lane "nowhere"/)
    assert.match(row.detail, /step "ghost"/)
  })

  test('steps-in-lane fails when a box is moved out of its lane band', async () => {
    const ir = validIr('swimlane-simple.yaml')
    const L = await plugin.layout(ir)
    L.geo.steps[1].y += 60
    const row = byName(plugin.verify(L, ir), 'steps-in-lane')
    assert.equal(row.ok, false)
    assert.match(row.detail, /step triage leaves lane "support"/)
  })

  test('edges-clear fails on a diagonal segment and on a segment through a step box', async () => {
    const ir = validIr('swimlane-simple.yaml')
    const L = await plugin.layout(ir)
    L.geo.edges[1].points[1].y += 8
    let row = byName(plugin.verify(L, ir), 'edges-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /edge 1 segment 1 is diagonal/)
    const L2 = await plugin.layout(ir)
    const box = L2.geo.steps[2]
    L2.geo.edges[0].points = [{ x: box.x - 8, y: box.cy }, { x: box.x + box.width + 8, y: box.cy }]
    row = byName(plugin.verify(L2, ir), 'edges-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /passes through step investigate/)
  })

  test('label-clear fails when a label is moved across a line or onto a box', async () => {
    const ir = validIr('swimlane-decision.yaml')
    const L = await plugin.layout(ir)
    const e = L.geo.edges.find((x) => x.route === 'back')
    e.label.x = e.points[1].x - 8
    e.label.y = e.points[1].y - 24
    let row = byName(plugin.verify(L, ir), 'label-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /crosses edge 5/)
    const L2 = await plugin.layout(ir)
    const box = L2.geo.steps[0]
    const e2 = L2.geo.edges.find((x) => x.route === 'back')
    e2.label.x = box.x + 4
    e2.label.y = box.y + 4
    row = byName(plugin.verify(L2, ir), 'label-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlaps step draft/)
  })

  test('budget rows are warn severity and carry the budget key on the over-budget fixture', async () => {
    const ir = validIr('swimlane-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const result = await verifyFigure(plugin, ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    for (const [name, key] of [['lane-count', 'budget:lanes'], ['step-count', 'budget:steps'], ['label-length', 'budget:label'], ['emphasis-count', 'budget:emphasis'], ['decision-branches', 'budget:decision']]) {
      const row = byName(result.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, false)
      assert.equal(row.key, key)
    }
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:lanes', 'budget:steps', 'budget:label', 'budget:emphasis', 'budget:decision'])
  })
})

// --- registry, output, CLI ------------------------------------------------------

describe('swimlane: registry + output', () => {
  test('the registry knows type: swimlane with the plugin limits', () => {
    const p = getFigureType('swimlane')
    assert.ok(p && !p.builtin)
    assert.equal(p.limits.maxLanes, 5)
    assert.equal(p.limits.maxSteps, 12)
  })

  test('renderFigureHtmlChecked → data-checks="pass" data-type="swimlane" for the simple and decision fixtures', async () => {
    for (const name of ['swimlane-simple.yaml', 'swimlane-decision.yaml']) {
      const ir = validIr(name)
      const r = await renderFigureHtmlChecked(ir, { rawYaml: fixture(name) })
      assert.equal(r.checksOk, true, `${name}: ${JSON.stringify(r.failures)}`)
      assert.match(r.html, /^<figure class="wu-figure" data-checks="pass" data-type="swimlane">/)
      assert.ok(!/data-warn=/.test(r.html), `${name} should carry no data-warn`)
      assert.match(r.html, /<svg role="img"/)
    }
  })

  test('a focal edge is drawn in the accent colour at 1.5px with its own arrowhead; the others stay in ink', async () => {
    const ir = validateIR(parseYaml(plugin.doc.irExample)).ir
    const r = await renderFigure(plugin, ir)
    const focal = r.layout.geo.edges.find((e) => e.emphasis)
    assert.deepEqual([focal.from, focal.to], ['approve', 'pay'])
    assert.match(r.svg, new RegExp(`<path id="wu-d-expense-approval-e-${focal.index}" class="wu-focal" d="[^"]+" fill="none" stroke="var\\(--wu-accent\\)" stroke-width="1.5" marker-end="url\\(#wu-d-expense-approval-focal\\)"`))
    assert.match(r.svg, /<marker id="wu-d-expense-approval-focal"[^>]*><path [^>]*fill="var\(--wu-accent\)"/)
    assert.match(r.svg, new RegExp(`<text id="wu-d-expense-approval-e-${focal.index}-label"[^>]*font-weight="700"`))
    assert.equal((r.svg.match(/stroke="var\(--wu-accent\)"/g) || []).length, 1, 'only the focal edge carries the accent stroke')
    assert.equal((r.svg.match(/<path id="wu-d-expense-approval-e-\d+" d=[^>]*stroke="currentColor" stroke-width="1"/g) || []).length, ir.edges.length - 1)
    const result = await verifyFigure(plugin, ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.warnings, [])
  })

  test('the decision figure draws a diamond, pills, the focal step, lane labels and arrowheads', async () => {
    const ir = validIr('swimlane-decision.yaml')
    const r = await renderFigure(plugin, ir)
    assert.match(r.svg, /<polygon id="wu-d-sw2-approve" data-tone="neutral"/)
    assert.match(r.svg, /<path id="wu-d-sw2-draft" data-tone="neutral"[^>]* d="M[^"]*A20 20/)
    assert.match(r.svg, /<path id="wu-d-sw2-done"/)
    assert.match(r.svg, /<rect id="wu-d-sw2-pay" data-tone="ts" class="wu-focal"[^>]*stroke-width="1.5"/)
    assert.match(r.svg, /id="wu-d-sw2-lane-manager-label"[^>]*>上長</)
    assert.match(r.svg, /marker-end="url\(#wu-d-sw2-solid\)"/)
    assert.match(r.svg, /id="wu-d-sw2-e-5-label"[^>]*>差戻し</)
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(r.svg.replace(/url\(#[^)]*\)/g, '')), 'no hex colors')
  })

  test('over-budget fixtures still pass with data-warn', async () => {
    const ir = validIr('swimlane-over-budget.yaml')
    const r = await renderFigureHtmlChecked(ir, { rawYaml: fixture('swimlane-over-budget.yaml') })
    assert.equal(r.checksOk, true, JSON.stringify(r.failures))
    assert.match(r.html, /data-warn="budget:lanes=6;budget:steps=13;budget:label=15;budget:emphasis=3;budget:decision=1"/)
  })

  test('rendering is byte-deterministic', async () => {
    const ir = validIr('swimlane-decision.yaml')
    const a = await renderFigureHtmlChecked(ir, { rawYaml: fixture('swimlane-decision.yaml') })
    const b = await renderFigureHtmlChecked(ir, { rawYaml: fixture('swimlane-decision.yaml') })
    assert.equal(a.html, b.html)
  })

  test('doc.irExample renders clean through the CLI (--doc | --figure) and --json reports pass', () => {
    const doc = runCli(['--doc', 'swimlane'])
    assert.equal(doc.status, 0)
    const ir = validateIR(parseYaml(doc.stdout))
    assert.equal(ir.ok, true)
    assert.deepEqual(ir.warnings, [])
    const fig = runCli([join(FIXTURES, 'swimlane-decision.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-checks="pass" data-type="swimlane"/)
    const json = runCli([join(FIXTURES, 'swimlane-decision.yaml'), '--json'])
    assert.equal(json.status, 0)
    assert.equal(JSON.parse(json.stdout).ok, true)
  })
})
