// `type: gantt` — schema, budgets, layout facts, every verify row failing
// on a hand-mutated render (or a real IR), the registry dispatch, and the
// CLI. Fixtures: test/fixtures/gantt-*.yaml (see references/figure-types.md §4).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/gantt.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { textWidth, EDGE_LABEL_SIZE } from '../../bin/lib/diagram.mjs'

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

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const OWN_ROWS = ['task-count', 'group-count', 'label-length', 'emphasis-count', 'spans-ordered', 'bars-in-range', 'rows-clear', 'deps-clear']
const SHARED_ROWS = ['single-finite-svg', 'a11y', 'font-size', 'stroke-radius', 'dark-3-state', 'grid-4px', 'projected-scale']

const minimal = () => ({
  id: 'g', type: 'gantt', title: 't', unit: 'ordinal',
  tasks: [
    { id: 'a', label: 'A', from: 1, to: 2 },
    { id: 'b', label: 'B', from: 3, milestone: true },
  ],
  deps: [{ from: 'a', to: 'b' }],
})

const p = () => getFigureType('gantt')

// --- schema --------------------------------------------------------------

describe('gantt: schema', () => {
  test('a minimal IR normalizes: range derived, milestone to = from, tone/emphasis defaulted, no group key', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'gantt')
    assert.deepEqual(r.ir.range, { from: 1, to: 3 })
    assert.deepEqual(r.ir.tasks[0], { id: 'a', label: 'A', from: 1, to: 2, emphasis: false, tone: 'neutral', milestone: false })
    assert.deepEqual(r.ir.tasks[1], { id: 'b', label: 'B', from: 3, to: 3, emphasis: false, tone: 'neutral', milestone: true })
    assert.deepEqual(r.ir.deps, [{ from: 'a', to: 'b' }])
    assert.equal('group' in r.ir.tasks[0], false)
  })

  test('each unit accepts its own syntax and rejects the others, naming the field', () => {
    const one = (unit, from, to) => validateIR({ id: 'g', type: 'gantt', title: 't', unit, tasks: [{ id: 'a', label: 'A', from, to }] })
    assert.equal(one('day', '2026-02-02', '2026-02-03').ok, true)
    assert.equal(one('week', '2026-W10', '2026-W11').ok, true)
    assert.equal(one('month', '2026-01', '2026-03').ok, true)
    assert.equal(one('ordinal', 0, 4).ok, true)
    const badDay = one('day', '2026-02-30', '2026-03-01')
    assert.equal(badDay.ok, false)
    assert.match(badDay.message, /ir\.tasks\[0\]\.from must be YYYY-MM-DD for unit "day"/)
    assert.match(one('week', '2025-W53', '2025-W53').message, /YYYY-Www/)   // 2025 has 52 ISO weeks
    assert.match(one('month', '2026-13', '2026-13').message, /YYYY-MM/)
    assert.match(one('ordinal', -1, 2).message, /integer ≥ 0/)
    assert.match(one('week', '2026-02-02', '2026-02-03').message, /ir\.tasks\[0\]\.from must be YYYY-Www/)
    const unit = validateIR({ ...minimal(), unit: 'hour' })
    assert.equal(unit.ok, false)
    assert.match(unit.message, /ir\.unit must be day\|week\|month\|ordinal/)
  })

  test('to before from, a milestone with a different to, a missing to, mixed groups and bad deps are schema errors', () => {
    const back = validateIR({ ...minimal(), tasks: [{ id: 'a', label: 'A', from: 5, to: 2 }] })
    assert.equal(back.ok, false)
    assert.match(back.message, /ir\.tasks\[0\]\.to \(2\) is before from \(5\)/)
    assert.match(validateIR({ ...minimal(), tasks: [{ id: 'a', label: 'A', from: 5, to: 6, milestone: true }] }).message, /must equal from for a milestone/)
    assert.match(validateIR({ ...minimal(), tasks: [{ id: 'a', label: 'A', from: 5 }] }).message, /ir\.tasks\[0\]\.to is required/)
    const mixed = validateIR({ ...minimal(), deps: [], tasks: [{ id: 'a', label: 'A', from: 1, to: 2, group: 'x' }, { id: 'b', label: 'B', from: 3, to: 4 }] })
    assert.equal(mixed.ok, false)
    assert.match(mixed.message, /ir\.tasks\[1\]\.group is missing/)
    assert.match(validateIR({ ...minimal(), deps: [{ from: 'a', to: 'ghost' }] }).message, /unknown task "ghost"/)
    assert.match(validateIR({ ...minimal(), deps: [{ from: 'a', to: 'a' }] }).message, /from and to must differ/)
    assert.match(validateIR({ ...minimal(), tasks: [...minimal().tasks, { id: 'a', label: 'dup', from: 1, to: 1 }] }).message, /duplicate task id "a"/)
    const range = validateIR({ ...minimal(), range: { from: 4, to: 1 } })
    assert.match(range.message, /ir\.range\.to \(1\) is before range\.from \(4\)/)
  })

  test('normalize() is idempotent for every fixture and equals validateIR()', () => {
    for (const name of ['simple', 'groups', 'over-tasks', 'over-label', 'over-emphasis']) {
      const raw = parseYaml(fixture(`gantt-${name}.yaml`))
      const once = plugin.normalize(raw, 'ir')
      assert.deepEqual(once, validIr(`gantt-${name}.yaml`), name)
      assert.deepEqual(plugin.normalize(JSON.parse(JSON.stringify(once)), 'ir'), once, `${name}: not idempotent`)
    }
  })
})

// --- budgets -------------------------------------------------------------

describe('gantt: budgets', () => {
  test('clean fixtures have no warnings', () => {
    assert.deepEqual(plugin.budgetWarnings(validIr('gantt-simple.yaml')), [])
    assert.deepEqual(plugin.budgetWarnings(validIr('gantt-groups.yaml')), [])
  })

  test('each budget key fires on its fixture and reaches data-warn', async () => {
    const cases = [
      ['gantt-over-tasks.yaml', 'budget:tasks', 13],
      ['gantt-over-label.yaml', 'budget:label', 15],
      ['gantt-over-emphasis.yaml', 'budget:emphasis', 3],
    ]
    for (const [name, key, value] of cases) {
      const ir = validIr(name)
      const w = plugin.budgetWarnings(ir)
      assert.deepEqual(w.map((x) => [x.key, x.value]), [[key, value]], name)
      assert.ok(w[0].hint && w[0].hint !== w[0].detail, `${name}: hint must be a concrete fix`)
      const rendered = await renderFigureHtmlChecked(ir)
      assert.match(rendered.html, new RegExp(`data-checks="pass" data-warn="${key}=${value}" data-type="gantt"`), name)
    }
  })

  test('keys come out in a stable order: tasks, groups, label, emphasis', () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({
      id: `t${i}`, label: i === 0 ? 'この作業名は十四文字を超える長さ' : `T${i}`, from: i, to: i + 1, group: `G${i % 5}`, emphasis: i < 3,
    }))
    const r = validateIR({ id: 'g', type: 'gantt', title: 't', unit: 'ordinal', tasks })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(plugin.budgetWarnings(r.ir).map((w) => w.key), ['budget:tasks', 'budget:groups', 'budget:label', 'budget:emphasis'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:tasks=13;budget:groups=5;budget:label=16;budget:emphasis=3')
  })
})

// --- layout --------------------------------------------------------------

describe('gantt: layout', () => {
  test('rows follow the tasks under their group band in first-appearance order; ungrouped charts have no band', async () => {
    const { geo } = await plugin.layout(validIr('gantt-groups.yaml'))
    assert.deepEqual(geo.bands.map((b) => b.group), ['準備', '移行', '定着'])
    assert.deepEqual(geo.rows.map((r) => r.task), ['inventory', 'design', 'freeze', 'migrate', 'verify', 'cutover', 'watch', 'retire'])
    // band → its rows → next band, stacked without gaps from the axis
    assert.equal(geo.bands[0].y, geo.axis.y)
    assert.equal(geo.rows[0].y, geo.bands[0].y + geo.bands[0].height)
    assert.equal(geo.bands[1].y, geo.rows[2].y + geo.rows[2].height)
    for (let i = 1; i < geo.rows.length; i++) assert.ok(geo.rows[i].y >= geo.rows[i - 1].y + geo.rows[i - 1].height)
    assert.equal(geo.rows[0].height, 40)
    const simple = await plugin.layout(validIr('gantt-simple.yaml'))
    assert.deepEqual(simple.geo.bands, [])
    assert.equal(simple.geo.rows[0].y, simple.geo.axis.y)
    assert.equal(simple.geo.labels[0].x, 16)
    assert.equal(geo.labels[0].x, 16 + 12, 'grouped task labels are indented under the band')
  })

  test('bars sit at from × unit width, span (to − from + 1) units, 24px tall inside a 40px row; milestones are diamonds centered in their unit', async () => {
    const ir = validIr('gantt-simple.yaml')
    const { geo } = await plugin.layout(ir)
    assert.equal(geo.unitW % 4, 0)
    const impl = geo.bars.find((b) => b.task === 'impl')
    assert.equal(impl.kind, 'bar')
    assert.equal(impl.x, geo.chartLeft)                           // 2026-02-02 is the range start
    assert.equal(impl.width, 12 * geo.unitW)                      // 02-02 .. 02-13 inclusive
    assert.equal(impl.height, 24)
    const row = geo.rows.find((r) => r.task === 'impl')
    assert.equal(impl.y, row.y + 8)
    const review = geo.bars.find((b) => b.task === 'review')
    assert.equal(review.x, geo.chartLeft + 7 * geo.unitW)
    const go = geo.bars.find((b) => b.task === 'go')
    assert.equal(go.kind, 'milestone')
    assert.equal(go.cy, geo.rows.find((r) => r.task === 'go').centerY)
    assert.ok(Math.abs(go.cx - (geo.chartLeft + 21 * geo.unitW + geo.unitW / 2)) <= 2)
    assert.equal(geo.chartRight, geo.chartLeft + 22 * geo.unitW)
  })

  test('tick labels are thinned to a step whose pitch holds the widest label, anchored on Mondays for weekly day steps', async () => {
    const { geo } = await plugin.layout(validIr('gantt-simple.yaml'))
    const shown = geo.ticks.filter((t) => t.showLabel)
    assert.ok(shown.length >= 3)
    for (let i = 1; i < shown.length; i++) {
      assert.ok(shown[i].labelX >= shown[i - 1].labelX + shown[i - 1].labelWidth + 4, `labels "${shown[i - 1].label}" and "${shown[i].label}" collide`)
    }
    for (const t of shown) assert.ok(t.labelX + t.labelWidth <= geo.chartRight, `label "${t.label}" runs past the chart`)
    // 300 days at the minimum unit width → weekly ticks on Mondays
    const long = validateIR({ id: 'g', type: 'gantt', title: 't', unit: 'day', tasks: [{ id: 'a', label: 'A', from: '2026-01-01', to: '2026-10-27' }] })
    assert.equal(long.ok, true)
    const wide = await plugin.layout(long.ir)
    assert.equal(wide.geo.unitW, 4)
    const step = wide.geo.ticks[1].t - wide.geo.ticks[0].t
    assert.equal(step % 7, 0)
    assert.equal(wide.geo.ticks[0].label, '1/5')               // first Monday of 2026
    for (let i = 1; i < wide.geo.ticks.length; i++) assert.equal(wide.geo.ticks[i].x - wide.geo.ticks[i - 1].x, step * 4)
    const labelled = wide.geo.ticks.filter((t) => t.showLabel)
    for (let i = 1; i < labelled.length; i++) assert.ok(labelled[i].x - labelled[i - 1].x >= textWidth(labelled[i - 1].label, EDGE_LABEL_SIZE) + 8)
  })

  test('a dependency arrow leaves the predecessor end and drops orthogonally into the successor start', async () => {
    const { geo } = await plugin.layout(validIr('gantt-groups.yaml'))
    assert.equal(geo.deps.length, 3)
    const freezeToMigrate = geo.deps[0]
    const freeze = geo.bars.find((b) => b.task === 'freeze'), migrate = geo.bars.find((b) => b.task === 'migrate')
    assert.deepEqual(freezeToMigrate.path[0], { x: freeze.x + freeze.width, y: freeze.centerY })
    const end = freezeToMigrate.path[freezeToMigrate.path.length - 1]
    assert.equal(end.y, migrate.y, 'the arrow enters the successor through its top edge')
    assert.ok(end.x >= migrate.x && end.x <= migrate.x + migrate.width)
    for (const d of geo.deps) {
      for (let i = 1; i < d.path.length; i++) assert.ok(d.path[i].x === d.path[i - 1].x || d.path[i].y === d.path[i - 1].y, `deps[${d.index}] has a diagonal segment`)
    }
    const verifyToCutover = geo.deps[1]
    const cutover = geo.bars.find((b) => b.task === 'cutover')
    assert.equal(verifyToCutover.path[verifyToCutover.path.length - 1].x, cutover.cx, 'a milestone is entered at its top tip')
  })

  test('layout and render are deterministic, on the 4px grid, and fit the column without scaling', async () => {
    for (const name of ['gantt-simple.yaml', 'gantt-groups.yaml']) {
      const ir = validIr(name)
      const a = await plugin.layout(ir)
      const b = await plugin.layout(ir)
      assert.deepEqual(a, b, name)
      assert.equal(a.width % 4, 0)
      assert.equal(a.height % 4, 0)
      const r1 = await renderFigure(p(), ir)
      const r2 = await renderFigure(p(), ir)
      assert.equal(r1.svg, r2.svg, name)
      assert.equal(r1.scaled, false, name)
      assert.equal(r1.scroll, false, name)
      assert.ok(r1.width <= 720, `${name}: ${r1.width}px exceeds the column`)
    }
  })

  test('a long day range takes the shared scaling or scroll path, never a scale below 0.78', async () => {
    const r = validateIR({ id: 'g', type: 'gantt', title: 't', unit: 'day', tasks: [{ id: 'a', label: 'A', from: '2026-01-01', to: '2026-06-30' }] })
    assert.equal(r.ok, true)
    const rendered = await renderFigure(p(), r.ir)
    assert.ok(rendered.width > 720)
    assert.ok(rendered.scroll || 720 / rendered.width >= 0.78)
    const result = await verifyFigure(p(), r.ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
  })
})

// --- verify --------------------------------------------------------------

describe('gantt: verify rows', () => {
  test('a clean render passes every own row and the shared rows, in order, ids 1..15', async () => {
    for (const name of ['gantt-simple.yaml', 'gantt-groups.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(p(), ir)
      const result = await verifyFigure(p(), ir, rendered)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.deepEqual(result.checks.map((c) => c.name), [...OWN_ROWS, ...SHARED_ROWS], name)
      assert.deepEqual(result.checks.map((c) => c.id), Array.from({ length: 15 }, (_, i) => i + 1), name)
      assert.deepEqual(result.warnings, [], name)
    }
  })

  test('emphasis-count is a warn row carrying the budget key/value and never gates the figure', async () => {
    const ir = validIr('gantt-over-emphasis.yaml')
    const result = await verifyFigure(p(), ir, await renderFigure(p(), ir))
    assert.equal(result.ok, true)
    const row = result.checks.find((c) => c.name === 'emphasis-count')
    assert.deepEqual([row.severity, row.ok, row.key, row.value], ['warn', false, 'budget:emphasis', 3])
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:emphasis'])
  })

  test('spans-ordered fails when a bar ends before it starts or its width does not match its span', async () => {
    const ir = validIr('gantt-simple.yaml')
    const back = structuredClone(await renderFigure(p(), ir))
    back.layout.geo.bars[0].t1 = back.layout.geo.bars[0].t0 - 1
    let row = (await verifyFigure(p(), ir, back)).checks.find((c) => c.name === 'spans-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /task "impl" ends .* before it starts/)
    const short = structuredClone(await renderFigure(p(), ir))
    short.layout.geo.bars[0].width -= 4
    row = (await verifyFigure(p(), ir, short)).checks.find((c) => c.name === 'spans-ordered')
    assert.equal(row.ok, false)
    assert.match(row.detail, /bar width .* ≠/)
  })

  test('bars-in-range is a real gate: a task outside an explicit range fails the figure and the CLI exits 3', async () => {
    const r = validateIR({ ...minimal(), range: { from: 1, to: 2 } })
    assert.equal(r.ok, true, 'a task outside the range is a verify failure, not a schema error')
    const rendered = await renderFigure(p(), r.ir)
    const result = await verifyFigure(p(), r.ir, rendered)
    assert.equal(result.ok, false)
    const row = result.checks.find((c) => c.name === 'bars-in-range')
    assert.equal(row.ok, false)
    assert.match(row.detail, /milestone "b" \(3\) lies outside range 1\.\.2/)
    assert.match(row.hint, /widen range/)
    const html = await renderFigureHtmlChecked(r.ir)
    assert.equal(html.checksOk, false)
    assert.doesNotMatch(html.html, /data-checks="pass"/)
    const bar = structuredClone(rendered)
    bar.layout.geo.bars[0].x -= 4
    assert.match((await verifyFigure(p(), r.ir, bar)).checks.find((c) => c.name === 'bars-in-range').detail, /task "a" \(1\.\.2\) lies outside/)
  })

  test('rows-clear fails when two rows overlap, a band overlaps a row, or a bar leaves its row', async () => {
    const ir = validIr('gantt-groups.yaml')
    const rowsOverlap = structuredClone(await renderFigure(p(), ir))
    rowsOverlap.layout.geo.rows[1].y = rowsOverlap.layout.geo.rows[0].y + 8
    let row = (await verifyFigure(p(), ir, rowsOverlap)).checks.find((c) => c.name === 'rows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /row "inventory" overlaps row "design"/)
    const bandOverlap = structuredClone(await renderFigure(p(), ir))
    bandOverlap.layout.geo.bands[1].y = bandOverlap.layout.geo.rows[2].y
    row = (await verifyFigure(p(), ir, bandOverlap)).checks.find((c) => c.name === 'rows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /band "移行" overlaps row "freeze"/)
    const escaped = structuredClone(await renderFigure(p(), ir))
    escaped.layout.geo.bars[0].y -= 12
    row = (await verifyFigure(p(), ir, escaped)).checks.find((c) => c.name === 'rows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /bar "inventory" leaves its row/)
  })

  test('deps-clear fails on a diagonal segment, an arrow through a bar, an endpoint off the bar, or an unknown task', async () => {
    const ir = validIr('gantt-groups.yaml')
    const diagonal = structuredClone(await renderFigure(p(), ir))
    diagonal.layout.geo.deps[0].path[1].y += 8
    let row = (await verifyFigure(p(), ir, diagonal)).checks.find((c) => c.name === 'deps-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /deps\[0\] segment 1 is diagonal/)

    // a real IR: the successor sits two rows down behind a bar the arrow must cross
    const crossing = validateIR({
      id: 'x', type: 'gantt', title: 't', unit: 'ordinal',
      tasks: [
        { id: 'a', label: 'A', from: 0, to: 1 },
        { id: 'wall', label: 'W', from: 1, to: 5 },
        { id: 'b', label: 'B', from: 2, to: 3 },
      ],
      deps: [{ from: 'a', to: 'b' }],
    })
    assert.equal(crossing.ok, true)
    const rendered = await renderFigure(p(), crossing.ir)
    const result = await verifyFigure(p(), crossing.ir, rendered)
    assert.equal(result.ok, false)
    row = result.checks.find((c) => c.name === 'deps-clear')
    assert.match(row.detail, /deps\[0\] \(a → b\) segment 2 crosses bar "wall"/)
    assert.match(row.hint, /order dependent tasks next to each other/)

    const off = structuredClone(await renderFigure(p(), ir))
    off.layout.geo.deps[0].path[0].x += 4
    row = (await verifyFigure(p(), ir, off)).checks.find((c) => c.name === 'deps-clear')
    assert.match(row.detail, /does not start at the end of "freeze"/)
    const unknown = structuredClone(await renderFigure(p(), ir))
    unknown.layout.geo.deps[0].to = 'ghost'
    row = (await verifyFigure(p(), ir, unknown)).checks.find((c) => c.name === 'deps-clear')
    assert.match(row.detail, /deps\[0\]\.to → unknown task "ghost"/)
  })

  test('a successor that starts before its predecessor ends is routed around the row edge and still verifies', async () => {
    const r = validateIR({
      id: 'x', type: 'gantt', title: 't', unit: 'ordinal',
      tasks: [{ id: 'a', label: 'A', from: 2, to: 5 }, { id: 'b', label: 'B', from: 0, to: 3 }],
      deps: [{ from: 'a', to: 'b' }],
    })
    assert.equal(r.ok, true)
    const rendered = await renderFigure(p(), r.ir)
    const d = rendered.layout.geo.deps[0]
    assert.equal(d.path.length, 6)
    const b = rendered.layout.geo.bars[1]
    assert.deepEqual(d.path[5], { x: b.x, y: b.centerY })
    const result = await verifyFigure(p(), r.ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
  })

  test('shared row grid-4px reads the plugin geometry: an off-grid bar x fails it', async () => {
    const ir = validIr('gantt-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.bars[0].x += 2
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'grid-4px')
    assert.equal(row.ok, false)
    assert.match(row.detail, /bars\[0\]\.x=/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('gantt: registry dispatch and CLI', () => {
  test('the plugin is registered with its budgets and row names', () => {
    const g = getFigureType('gantt')
    assert.ok(g && !g.builtin)
    assert.deepEqual(g.limits, { maxTasks: 12, maxGroups: 4, maxLabelLen: 14, maxEmphasis: 2 })
    assert.deepEqual(g.doc.rows, OWN_ROWS)
  })

  test('renderFigureHtmlChecked() yields a passing gantt figure with the IR embedded, emphasis as the focal bar, tones on bars', async () => {
    const raw = fixture('gantt-groups.yaml')
    const rendered = await renderFigureHtmlChecked(validIr('gantt-groups.yaml'), { rawYaml: raw })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="gantt">/)
    assert.match(rendered.html, /<rect id="wu-d-g2-bar-3" class="wu-focal" data-tone="new"/)
    assert.match(rendered.html, /<rect id="wu-d-g2-ms-5" class="wu-focal"/)
    assert.match(rendered.html, /<text id="wu-d-g2-label-3"[^>]*font-weight="700"/)
    assert.match(rendered.html, /<rect id="wu-d-g2-bar-1" data-tone="ts"/)
    assert.match(rendered.html, /<text id="wu-d-g2-band-0-label"[^>]*>準備<\/text>/)
    assert.equal((rendered.html.match(/class="wu-focal"/g) || []).length, 2)
    assert.equal((rendered.html.match(/<path id="wu-d-g2-dep-/g) || []).length, 3)
    assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
  })

  test('--figure renders gantt-simple and gantt-groups as verified figures', () => {
    for (const name of ['gantt-simple.yaml', 'gantt-groups.yaml']) {
      const r = runCli([join(FIXTURES, name), '--figure'])
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
      assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="gantt">/)
      assert.match(r.stdout, /<svg role="img"/)
    }
  })

  test('--json on an over-budget gantt reports ok:true plus the warning and data-warn string', () => {
    const r = runCli([join(FIXTURES, 'gantt-over-tasks.yaml'), '--json'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.warn, 'budget:tasks=13')
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:tasks'])
    assert.match(out.figureHtml, /data-warn="budget:tasks=13" data-type="gantt"/)
  })

  test('--doc gantt prints the 6-task / 2-group / 2-dep example and it renders clean', () => {
    const r = runCli(['--doc', 'gantt'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, plugin.doc.irExample)
    const ir = validateIR(parseYaml(r.stdout))
    assert.equal(ir.ok, true, JSON.stringify(ir))
    assert.equal(ir.ir.tasks.length, 6)
    assert.equal(new Set(ir.ir.tasks.map((t) => t.group)).size, 2)
    assert.equal(ir.ir.deps.length, 2)
    assert.deepEqual(ir.warnings, [])
  })
})
