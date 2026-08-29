// `type: state` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/state-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/state.mjs'
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
  id: 'm', type: 'state', title: 't',
  states: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  transitions: [{ from: 'a', to: 'b', label: 'go' }],
  ...extra,
})

// --- schema ------------------------------------------------------------------

describe('state: schema', () => {
  test('a minimal IR normalizes: first state becomes initial, defaults filled', () => {
    const ir = plugin.normalize(minimal())
    assert.equal(ir.type, 'state')
    assert.equal(ir.direction, 'down')
    assert.deepEqual(ir.states[0], { id: 'a', label: 'A', tone: 'neutral', initial: true, final: false, emphasis: false })
    assert.deepEqual(ir.transitions[0], { from: 'a', to: 'b', label: 'go', kind: 'sync' })
  })

  test('normalize is idempotent', () => {
    const once = plugin.normalize(raw('state-retry.yaml'))
    const twice = plugin.normalize(once)
    assert.deepEqual(twice, once)
    const simple = plugin.normalize(raw('state-simple.yaml'))
    assert.deepEqual(plugin.normalize(simple), simple)
  })

  test('rejects unknown state references, duplicate ids, bad kind/direction, >2 emphasis', () => {
    assert.throws(() => plugin.normalize(minimal({ transitions: [{ from: 'a', to: 'zz' }] })), /transitions\[0\]\.to references unknown state "zz"/)
    assert.throws(() => plugin.normalize(minimal({ states: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })), /duplicate state id "a"/)
    assert.throws(() => plugin.normalize(minimal({ transitions: [{ from: 'a', to: 'b', kind: 'reply' }] })), /kind must be sync\|async/)
    assert.throws(() => plugin.normalize(minimal({ direction: 'up' })), /direction must be down\|right/)
    assert.throws(() => plugin.normalize(minimal({ states: [{ id: 'a', label: 'A', emphasis: true }, { id: 'b', label: 'B', emphasis: true }, { id: 'c', label: 'C', emphasis: true }] })), /at most 2 focal states/)
    assert.throws(() => plugin.normalize(minimal({ states: [] })), /states must be a non-empty list/)
  })

  test('validateIR routes type: state through the plugin', () => {
    const r = validateIR(raw('state-simple.yaml'))
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'state')
    assert.equal(r.ir.states[0].initial, true)
    const bad = validateIR(minimal({ transitions: [{ from: 'a', to: 'nope' }] }))
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'schema')
  })
})

// --- budgets -----------------------------------------------------------------

describe('state: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(plugin.budgetWarnings(validIr('state-retry.yaml')), [])
  })

  test('states over 8 and ranks over 4 warn, in stable order', () => {
    const ir = validIr('state-over-states.yaml')
    const w = plugin.budgetWarnings(ir)
    assert.deepEqual(w.map((x) => x.key), ['budget:states', 'budget:ranks'])
    assert.equal(w[0].value, 9)
    assert.equal(w[1].value, 9)
    assert.equal(formatBudgetWarnings(w), 'budget:states=9;budget:ranks=9')
    const r = validateIR(raw('state-over-states.yaml'))
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((x) => x.key), ['budget:states', 'budget:ranks'])
  })

  test('a label over 12 chars warns with the transition index', () => {
    const w = plugin.budgetWarnings(validIr('state-label-too-long.yaml'))
    assert.equal(w.length, 1)
    assert.equal(w[0].key, 'budget:label')
    assert.match(w[0].detail, /transition 0 label/)
  })

  test('transitions over 16 and unlabeled transitions warn', () => {
    const transitions = Array.from({ length: 17 }, (_, i) => ({ from: i % 2 ? 'a' : 'b', to: i % 2 ? 'b' : 'a', label: `e${i}` }))
    const w = plugin.budgetWarnings(plugin.normalize(minimal({ transitions })))
    assert.deepEqual(w.map((x) => x.key), ['budget:transitions'])
    const u = plugin.budgetWarnings(plugin.normalize(minimal({ transitions: [{ from: 'a', to: 'b' }] })))
    assert.deepEqual(u.map((x) => x.key), ['budget:unlabeled'])
  })

  test('an unreachable state warns (budget:unreachable) and the reachable row reports it', async () => {
    const ir = plugin.normalize(minimal({ states: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'lost', label: 'Lost' }] }))
    const w = plugin.budgetWarnings(ir)
    assert.deepEqual(w.map((x) => x.key), ['budget:unreachable'])
    assert.match(w[0].detail, /lost/)
    const rendered = await renderFigure(plugin, ir)
    const result = await verifyFigure(plugin, ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    const row = byName(result.checks, 'reachable')
    assert.equal(row.severity, 'warn')
    assert.equal(row.ok, false)
    assert.equal(row.key, 'budget:unreachable')
    assert.deepEqual(result.warnings.map((x) => x.key), ['budget:unreachable'])
  })
})

// --- layout ------------------------------------------------------------------

describe('state: layout', () => {
  test('initial state on rank 0, longest-path ranks, retry edge is a back edge', async () => {
    const ir = validIr('state-retry.yaml')
    const L = await plugin.layout(ir)
    assert.deepEqual(L.geo.ranks, [['pending'], ['fetching'], ['verifying'], ['done']])
    const byId = new Map(L.geo.states.map((s) => [s.id, s]))
    assert.ok(byId.get('pending').y < byId.get('fetching').y && byId.get('fetching').y < byId.get('verifying').y && byId.get('verifying').y < byId.get('done').y)
    const retry = L.geo.transitions.find((t) => t.from === 'verifying' && t.to === 'pending')
    assert.equal(retry.cls, 'back')
    assert.ok(retry.points.every((p) => p.x <= byId.get('pending').x), 'the retry edge runs on the left side')
    const self = L.geo.transitions.find((t) => t.from === 'fetching' && t.to === 'fetching')
    assert.equal(self.cls, 'self')
    assert.equal(self.points.length, 4)
    assert.ok(self.points.every((p) => p.x >= byId.get('fetching').x + byId.get('fetching').width), 'the self loop sits on the right side')
    assert.equal(L.geo.markers.initial.length, 1)
    assert.equal(L.geo.markers.final.length, 1)
    assert.ok(L.geo.markers.initial[0].cy < byId.get('pending').y)
    assert.ok(L.geo.markers.final[0].cy > byId.get('done').y + byId.get('done').height)
    assert.equal(L.width % 4, 0)
    assert.equal(L.height % 4, 0)
    assert.ok(L.legend, 'async transition → legend')
  })

  test('direction: right lays ranks out left to right', async () => {
    const ir = validIr('state-over-states.yaml')
    const L = await plugin.layout(ir)
    const xs = L.geo.states.map((s) => s.x)
    assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]))
    assert.ok(new Set(L.geo.states.map((s) => s.y)).size === 1, 'a chain sits on one row')
  })

  test('layout is deterministic and every label is beside its edge', async () => {
    const ir = validIr('state-retry.yaml')
    const a = await plugin.layout(ir)
    const b = await plugin.layout(ir)
    assert.deepEqual(a, b)
    assert.ok(a.geo.transitions.every((t) => t.label), 'every labelled transition got a label box')
  })

  test('a branching machine (two targets from one state, two states in a rank) verifies clean', async () => {
    const ir = plugin.normalize({
      id: 'br', type: 'state', title: 'branch',
      states: [{ id: 'new', label: '新規' }, { id: 'ok', label: '承認' }, { id: 'ng', label: '却下' }, { id: 'end', label: '終了', final: true }],
      transitions: [
        { from: 'new', to: 'ok', label: 'approve' }, { from: 'new', to: 'ng', label: 'reject' },
        { from: 'ok', to: 'end', label: 'close' }, { from: 'ng', to: 'new', label: 'retry' }, { from: 'ng', to: 'end', label: 'give up' },
      ],
    })
    const rendered = await renderFigure(plugin, ir)
    const result = await verifyFigure(plugin, ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(rendered.layout.geo.ranks, [['new'], ['ok', 'ng'], ['end']])
  })
})

// --- verify rows on crafted geometry ------------------------------------------

describe('state: verify rows', () => {
  test('row names match doc.rows and every row passes on a clean fixture', async () => {
    const ir = validIr('state-retry.yaml')
    const L = await plugin.layout(ir)
    const rows = plugin.verify(L, ir)
    assert.deepEqual(rows.map((r) => r.name), plugin.doc.rows)
    assert.ok(rows.every((r) => r.ok), JSON.stringify(rows.filter((r) => !r.ok)))
    assert.deepEqual(rows.map((r) => r.id), rows.map((_, i) => i + 1))
  })

  test('transition-refs fails on an unknown state', async () => {
    const ir = validIr('state-simple.yaml')
    const L = await plugin.layout(ir)
    const mutated = { ...ir, transitions: [...ir.transitions, { from: 'idle', to: 'ghost', label: 'x', kind: 'sync' }] }
    const row = byName(plugin.verify(L, mutated), 'transition-refs')
    assert.equal(row.ok, false)
    assert.match(row.detail, /ghost/)
  })

  test('box-overlap fails when two state boxes overlap', async () => {
    const ir = validIr('state-simple.yaml')
    const L = await plugin.layout(ir)
    L.geo.states[1].y = L.geo.states[0].y + 8
    const row = byName(plugin.verify(L, ir), 'box-overlap')
    assert.equal(row.ok, false)
    assert.match(row.detail, /idle\/connecting/)
  })

  test('label-clear fails when a label is moved across a line or onto a box', async () => {
    const ir = validIr('state-simple.yaml')
    const L = await plugin.layout(ir)
    const t = L.geo.transitions[0]
    t.label.x = t.points[0].x - 8
    const row = byName(plugin.verify(L, ir), 'label-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /crosses transition 0/)
    const L2 = await plugin.layout(ir)
    const box = L2.geo.states[0]
    L2.geo.transitions[0].label.x = box.x + 4
    L2.geo.transitions[0].label.y = box.y + 4
    assert.match(byName(plugin.verify(L2, ir), 'label-clear').detail, /overlaps state idle/)
  })

  test('orthogonal fails on a diagonal segment', async () => {
    const ir = validIr('state-simple.yaml')
    const L = await plugin.layout(ir)
    L.geo.transitions[0].points[1].x += 16
    const row = byName(plugin.verify(L, ir), 'orthogonal')
    assert.equal(row.ok, false)
    assert.match(row.detail, /transition 0 segment 1/)
  })

  test('grid fails on an off-grid coordinate', async () => {
    const ir = validIr('state-simple.yaml')
    const L = await plugin.layout(ir)
    L.geo.states[0].x += 2
    L.geo.transitions[0].label.y += 1
    const row = byName(plugin.verify(L, ir), 'grid')
    assert.equal(row.ok, false)
    assert.match(row.detail, /state idle\.x/)
    assert.match(row.detail, /transition 0 label/)
  })
})

// --- registry, output, CLI ------------------------------------------------------

describe('state: registry + output', () => {
  test('the registry knows type: state with the plugin limits', () => {
    const p = getFigureType('state')
    assert.ok(p && !p.builtin)
    assert.equal(p.limits.maxStates, 8)
  })

  test('renderFigureHtmlChecked → data-checks="pass" data-type="state" for state-simple and state-retry', async () => {
    for (const name of ['state-simple.yaml', 'state-retry.yaml']) {
      const ir = validIr(name)
      const r = await renderFigureHtmlChecked(ir, { rawYaml: fixture(name) })
      assert.equal(r.checksOk, true, `${name}: ${JSON.stringify(r.failures)}`)
      assert.match(r.html, /^<figure class="wu-figure" data-checks="pass" data-type="state">/)
      assert.ok(!/data-warn=/.test(r.html), `${name} should carry no data-warn`)
      assert.match(r.html, /<svg role="img"/)
    }
  })

  test('the retry figure draws the self loop, initial dot, final ring, focal state and open async arrowhead', async () => {
    const ir = validIr('state-retry.yaml')
    const r = await renderFigure(plugin, ir)
    assert.match(r.svg, /id="wu-d-st2-initial-pending" cx=/)
    assert.match(r.svg, /id="wu-d-st2-final-done" [^>]*r="8" fill="none"/)
    assert.match(r.svg, /id="wu-d-st2-final-done-core"/)
    assert.match(r.svg, /id="wu-d-st2-verifying" [^>]*class="wu-focal"[^>]*stroke-width="1.5"/)
    assert.match(r.svg, /id="wu-d-st2-t-2" [^>]*marker-end="url\(#wu-d-st2-open\)"/)
    assert.match(r.svg, /id="wu-d-st2-legend"/)
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(r.svg.replace(/url\(#[^)]*\)/g, '')), 'no hex colors')
  })

  test('over-budget fixtures still pass with data-warn', async () => {
    const ir = validIr('state-over-states.yaml')
    const r = await renderFigureHtmlChecked(ir, { rawYaml: fixture('state-over-states.yaml') })
    assert.equal(r.checksOk, true, JSON.stringify(r.failures))
    assert.match(r.html, /data-warn="budget:states=9;budget:ranks=9"/)
  })

  test('rendering is byte-deterministic', async () => {
    const ir = validIr('state-retry.yaml')
    const a = await renderFigureHtmlChecked(ir, { rawYaml: fixture('state-retry.yaml') })
    const b = await renderFigureHtmlChecked(ir, { rawYaml: fixture('state-retry.yaml') })
    assert.equal(a.html, b.html)
  })

  test('doc.irExample renders clean through the CLI (--doc | --figure) and --json reports pass', () => {
    const doc = runCli(['--doc', 'state'])
    assert.equal(doc.status, 0)
    const ir = validateIR(parseYaml(doc.stdout))
    assert.equal(ir.ok, true)
    assert.deepEqual(ir.warnings, [])
    const fig = runCli([join(FIXTURES, 'state-retry.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-checks="pass" data-type="state"/)
    const json = runCli([join(FIXTURES, 'state-retry.yaml'), '--json'])
    assert.equal(json.status, 0)
    assert.equal(JSON.parse(json.stdout).ok, true)
  })
})
