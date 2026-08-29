// `type: process` — schema, budgets, layout facts, every verify row failing
// on a hand-mutated render, the registry dispatch, and the CLI. Fixtures:
// test/fixtures/process-*.yaml (see references/figure-types.md §4).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/process.mjs'
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

const OWN_ROWS = ['stage-count', 'slot-count', 'cell-count', 'cell-text-length', 'emphasis-count', 'references-exist', 'grid-aligned', 'text-inside-cells', 'arrows-clear']
const SHARED_ROWS = ['single-finite-svg', 'a11y', 'font-size', 'stroke-radius', 'dark-3-state', 'grid-4px', 'projected-scale']

const minimal = () => ({
  id: 'p', type: 'process', title: 't',
  slots: ['in', 'out'],
  stages: [
    { id: 'a', label: 'A', cells: { in: 'x', out: ['y', 'z'] } },
    { id: 'b', label: 'B', cells: { out: 'w' } },
  ],
})

// --- schema --------------------------------------------------------------

describe('process: schema', () => {
  test('a minimal IR normalizes: cells become item lists in slot order, arrows default to between-stages', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'process')
    assert.deepEqual(r.ir.slots, ['in', 'out'])
    assert.deepEqual(r.ir.stages[0], { id: 'a', label: 'A', emphasis: false, cells: { in: ['x'], out: ['y', 'z'] } })
    assert.deepEqual(r.ir.stages[1].cells, { out: ['w'] })
    assert.equal(r.ir.arrows, 'between-stages')
  })

  test('slots must be a non-empty list of unique strings', () => {
    assert.equal(validateIR({ ...minimal(), slots: [] }).ok, false)
    const dup = validateIR({ ...minimal(), slots: ['in', 'in'] })
    assert.equal(dup.ok, false)
    assert.match(dup.message, /duplicate slot/)
  })

  test('a cell keyed by an undeclared slot is a schema error naming the declared slots', () => {
    const r = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', cells: { ghost: 'x' } }] })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /unknown slot "ghost" \(declared: in, out\)/)
  })

  test('explicit arrows must reference declared stages and join two different ones', () => {
    const unknown = validateIR({ ...minimal(), arrows: [{ from: 'a', to: 'nope' }] })
    assert.equal(unknown.ok, false)
    assert.match(unknown.message, /unknown stage "nope"/)
    const self = validateIR({ ...minimal(), arrows: [{ from: 'a', to: 'a' }] })
    assert.equal(self.ok, false)
    assert.match(self.message, /from and to must differ/)
    const bad = validateIR({ ...minimal(), arrows: 'sideways' })
    assert.equal(bad.ok, false)
    assert.match(bad.message, /between-stages/)
  })

  test('normalize() is idempotent for every fixture and equals validateIR()', () => {
    for (const name of ['simple', 'full', 'over-stages', 'over-cell-text', 'over-emphasis']) {
      const raw = parseYaml(fixture(`process-${name}.yaml`))
      const once = plugin.normalize(raw, 'ir')
      assert.deepEqual(once, validIr(`process-${name}.yaml`), name)
      assert.deepEqual(plugin.normalize(JSON.parse(JSON.stringify(once)), 'ir'), once, `${name}: not idempotent`)
    }
  })
})

// --- budgets -------------------------------------------------------------

describe('process: budgets', () => {
  test('a clean fixture has no warnings', () => {
    assert.deepEqual(plugin.budgetWarnings(validIr('process-simple.yaml')), [])
  })

  test('each budget key fires on its fixture and reaches data-warn', async () => {
    const cases = [
      ['process-over-stages.yaml', 'budget:stages', 7],
      ['process-over-cell-text.yaml', 'budget:cell-text', 21],
      ['process-over-emphasis.yaml', 'budget:emphasis', 3],
    ]
    for (const [name, key, value] of cases) {
      const ir = validIr(name)
      const w = plugin.budgetWarnings(ir)
      assert.deepEqual(w.map((x) => [x.key, x.value]), [[key, value]], name)
      assert.ok(w[0].hint && w[0].hint !== w[0].detail, `${name}: hint must be a concrete fix`)
      const rendered = await renderFigureHtmlChecked(ir)
      assert.match(rendered.html, new RegExp(`data-checks="pass" data-warn="${key}=${value}" data-type="process"`), name)
    }
  })

  test('keys come out in a stable order: stages, slots, cells, cell-text, emphasis', () => {
    const stages = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`, label: `S${i}`, emphasis: i < 3,
      cells: { a: 'x', b: 'y', c: 'z', d: 'w', e: i === 0 ? 'この項目は十六文字を超える長さになっている' : 'v' },
    }))
    const r = validateIR({ id: 'p', type: 'process', title: 't', slots: ['a', 'b', 'c', 'd', 'e'], stages })
    assert.equal(r.ok, true)
    const keys = plugin.budgetWarnings(r.ir).map((w) => w.key)
    assert.deepEqual(keys, ['budget:stages', 'budget:slots', 'budget:cells', 'budget:cell-text', 'budget:emphasis'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:stages=7;budget:slots=5;budget:cells=35;budget:cell-text=21;budget:emphasis=3')
  })
})

// --- layout --------------------------------------------------------------

describe('process: layout', () => {
  test('stages are columns left → right with a gap, rows are slots top → bottom, cells sit on their column × row', async () => {
    const ir = validIr('process-simple.yaml')
    const { geo } = await plugin.layout(ir)
    assert.deepEqual(geo.stages.map((s) => s.id), ['fetch', 'transform', 'store'])
    for (let i = 1; i < geo.stages.length; i++) assert.ok(geo.stages[i].x >= geo.stages[i - 1].x + geo.stages[i - 1].width + 24, 'columns overlap or touch')
    assert.deepEqual(geo.rows.map((r) => r.slot), ['入力', '処理', '出力'])
    for (let i = 1; i < geo.rows.length; i++) assert.equal(geo.rows[i].y, geo.rows[i - 1].y + geo.rows[i - 1].height)
    assert.equal(geo.cells.length, 9)
    for (const c of geo.cells) {
      const s = geo.stages.find((x) => x.id === c.stage), r = geo.rows.find((x) => x.slot === c.slot)
      assert.deepEqual([c.x, c.width, c.y, c.height], [s.x, s.width, r.y, r.height])
    }
    assert.equal(geo.stages[0].x, geo.slotColumn.x + geo.slotColumn.width + 12)
  })

  test('column width follows the widest wrapped line in that stage; an item wider than the wrap width takes two lines', async () => {
    const ir = validIr('process-full.yaml')
    const { geo } = await plugin.layout(ir)
    for (const c of geo.cells) {
      assert.ok(c.lines.length <= c.items.length * 2, `${c.stage}/${c.slot}: more than 2 lines per item`)
      for (const l of c.lines) assert.ok(l.x + textWidth(l.text, EDGE_LABEL_SIZE) <= c.x + c.width - 12 + 1, `${l.text} overflows`)
    }
    const wrapped = geo.cells.find((c) => c.stage === 'discover' && c.slot === '入力')
    assert.deepEqual(wrapped.lines.map((l) => l.text), ['顧客ヒア', 'リング記録'])
    for (const stage of ['discover', 'build']) {
      const widest = Math.max(...geo.cells.filter((c) => c.stage === stage).flatMap((c) => c.lines.map((l) => textWidth(l.text, EDGE_LABEL_SIZE))))
      const col = geo.stages.find((s) => s.id === stage)
      assert.equal(col.width, Math.max(96, Math.ceil((Math.ceil(widest) + 24) / 4) * 4), `${stage}: column is not fitted to its widest line`)
    }
    assert.ok(geo.stages.find((s) => s.id === 'build').width > 96, 'build (コードレビュー) must exceed the minimum column width')
  })

  test('row height follows the tallest cell in the row', async () => {
    const ir = validIr('process-full.yaml')
    const { geo } = await plugin.layout(ir)
    const row = geo.rows.find((r) => r.slot === '処理')
    const tallest = Math.max(...geo.cells.filter((c) => c.slot === '処理').map((c) => c.lines.length * 16 + (c.items.length - 1) * 4 + 16))
    assert.equal(row.height, Math.ceil(tallest / 4) * 4)
    assert.equal(geo.rows.find((r) => r.slot === '出力').height, 32)
  })

  test('arrows: adjacent forward arrows cross the column gap on the first row; others take the channel below the grid', async () => {
    const ir = validIr('process-full.yaml')
    const { geo, height } = await plugin.layout(ir)
    assert.equal(geo.arrows.length, 6)
    const gap = geo.arrows.filter((a) => a.route === 'gap')
    const channel = geo.arrows.filter((a) => a.route === 'channel')
    assert.equal(gap.length, 5)
    assert.equal(channel.length, 1)
    for (const a of gap) {
      const from = geo.stages.find((s) => s.id === a.from), to = geo.stages.find((s) => s.id === a.to)
      assert.deepEqual(a.path, [{ x: from.x + from.width, y: geo.rows[0].centerY }, { x: to.x, y: geo.rows[0].centerY }])
    }
    const back = channel[0]
    assert.deepEqual([back.from, back.to, back.label.text], ['verify', 'build', '差し戻し'])
    assert.equal(back.path[0].y, geo.gridBottom)
    assert.equal(back.path[3].y, geo.gridBottom)
    assert.ok(back.path[1].y > geo.gridBottom && back.path[1].y < height)
    const labelled = gap.find((a) => a.label)
    assert.equal(labelled.label.text, '承認後')
    const gapW = geo.stages.find((s) => s.id === 'build').x - (geo.stages.find((s) => s.id === 'design').x + geo.stages.find((s) => s.id === 'design').width)
    assert.ok(gapW >= labelled.label.width + 16, 'a labelled gap is widened to hold its label')
  })

  test('the default between-stages arrows join each stage to the next', async () => {
    const { geo } = await plugin.layout(validIr('process-simple.yaml'))
    assert.deepEqual(geo.arrows.map((a) => [a.from, a.to, a.route]), [['fetch', 'transform', 'gap'], ['transform', 'store', 'gap']])
  })

  test('layout and render are deterministic', async () => {
    const ir = validIr('process-full.yaml')
    const a = await plugin.layout(ir)
    const b = await plugin.layout(ir)
    assert.deepEqual(a, b)
    const p = getFigureType('process')
    const r1 = await renderFigure(p, ir)
    const r2 = await renderFigure(p, ir)
    assert.equal(r1.svg, r2.svg)
    assert.equal(a.width % 4, 0)
    assert.equal(a.height % 4, 0)
  })

  test('a 6 × 4 grid fits the column through shared scaling, not the scroll fallback', async () => {
    const r = await renderFigure(getFigureType('process'), validIr('process-full.yaml'))
    assert.equal(r.scaled, true)
    assert.equal(r.scroll, false)
    assert.ok(r.width > 720 && 720 / r.width >= 0.78)
  })
})

// --- verify --------------------------------------------------------------

describe('process: verify rows', () => {
  const p = () => getFigureType('process')

  test('a clean render passes every own row and the shared rows, in order, ids 1..16', async () => {
    for (const name of ['process-simple.yaml', 'process-full.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(p(), ir)
      const result = await verifyFigure(p(), ir, rendered)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.deepEqual(result.checks.map((c) => c.name), [...OWN_ROWS, ...SHARED_ROWS], name)
      assert.deepEqual(result.checks.map((c) => c.id), Array.from({ length: 16 }, (_, i) => i + 1), name)
      assert.deepEqual(result.warnings, [], name)
    }
  })

  test('emphasis-count is a warn row carrying the budget key/value', async () => {
    const ir = validIr('process-over-emphasis.yaml')
    const result = await verifyFigure(p(), ir, await renderFigure(p(), ir))
    assert.equal(result.ok, true)
    const row = result.checks.find((c) => c.name === 'emphasis-count')
    assert.deepEqual([row.severity, row.ok, row.key, row.value], ['warn', false, 'budget:emphasis', 3])
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:emphasis'])
  })

  test('references-exist fails when a cell or arrow points at an undeclared stage', async () => {
    const ir = validIr('process-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.cells[0].stage = 'ghost'
    bad.layout.geo.arrows[0].to = 'ghost'
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'references-exist')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cells\[0\] → unknown stage "ghost"/)
    assert.match(row.detail, /arrows\[0\]\.to → unknown stage "ghost"/)
    assert.equal(result.ok, false)
  })

  test('grid-aligned fails when a cell leaves its column or overlaps another cell', async () => {
    const ir = validIr('process-simple.yaml')
    const shifted = structuredClone(await renderFigure(p(), ir))
    shifted.layout.geo.cells[0].x += 4
    let row = (await verifyFigure(p(), ir, shifted)).checks.find((c) => c.name === 'grid-aligned')
    assert.equal(row.ok, false)
    assert.match(row.detail, /x\/width .* ≠ column/)

    const overlapping = structuredClone(await renderFigure(p(), ir))
    const c0 = overlapping.layout.geo.cells[0], c1 = overlapping.layout.geo.cells[1]
    c1.y = c0.y; c1.height = c0.height
    overlapping.layout.geo.rows[1].y = c0.y; overlapping.layout.geo.rows[1].height = c0.height
    row = (await verifyFigure(p(), ir, overlapping)).checks.find((c) => c.name === 'grid-aligned')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlaps/)
  })

  test('text-inside-cells fails when a line runs past the cell padding', async () => {
    const ir = validIr('process-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    const cell = bad.layout.geo.cells[0]
    cell.lines[0].x = cell.x + cell.width - 8
    const wide = (await verifyFigure(p(), ir, bad)).checks.find((c) => c.name === 'text-inside-cells')
    assert.equal(wide.ok, false)
    assert.match(wide.detail, /overflows horizontally/)

    const tall = structuredClone(await renderFigure(p(), ir))
    tall.layout.geo.cells[0].lines[0].y = tall.layout.geo.cells[0].y + tall.layout.geo.cells[0].height + 8
    const row = (await verifyFigure(p(), ir, tall)).checks.find((c) => c.name === 'text-inside-cells')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overflows vertically/)
  })

  test('arrows-clear fails on a diagonal segment, a segment through a cell, or an endpoint off the stage border', async () => {
    const ir = validIr('process-full.yaml')
    const diagonal = structuredClone(await renderFigure(p(), ir))
    diagonal.layout.geo.arrows[0].path[1].y += 8
    let row = (await verifyFigure(p(), ir, diagonal)).checks.find((c) => c.name === 'arrows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /diagonal/)

    const through = structuredClone(await renderFigure(p(), ir))
    const back = through.layout.geo.arrows.find((a) => a.route === 'channel')
    const y = through.layout.geo.rows[1].centerY
    back.path = [{ x: back.path[0].x, y }, { x: back.path[3].x, y }]
    row = (await verifyFigure(p(), ir, through)).checks.find((c) => c.name === 'arrows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /passes through cell/)

    const off = structuredClone(await renderFigure(p(), ir))
    off.layout.geo.arrows[0].path[0].x += 4
    row = (await verifyFigure(p(), ir, off)).checks.find((c) => c.name === 'arrows-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /does not start on the border/)
  })

  test('shared row grid-4px reads the plugin geometry: an off-grid row y fails it', async () => {
    const ir = validIr('process-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.rows[0].y += 2
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'grid-4px')
    assert.equal(row.ok, false)
    assert.match(row.detail, /rows\[0\]\.y=/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('process: registry dispatch and CLI', () => {
  test('the plugin is registered with its budgets and row names', () => {
    const p = getFigureType('process')
    assert.ok(p && !p.builtin)
    assert.deepEqual(p.limits, { maxStages: 6, maxSlots: 4, maxCellTextLen: 16, maxCells: 20, maxEmphasis: 2 })
    assert.deepEqual(p.doc.rows, OWN_ROWS)
  })

  test('renderFigureHtmlChecked() yields a passing process figure with the IR embedded, emphasis as the focal header', async () => {
    const raw = fixture('process-simple.yaml')
    const rendered = await renderFigureHtmlChecked(validIr('process-simple.yaml'), { rawYaml: raw })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="process">/)
    assert.match(rendered.html, /<rect id="wu-d-p1-stage-transform" data-tone="neutral" class="wu-focal"/)
    assert.match(rendered.html, /<text id="wu-d-p1-stage-transform-label"[^>]*font-weight="700"/)
    assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    assert.equal((rendered.html.match(/class="wu-focal"/g) || []).length, 1)
  })

  test('--figure renders process-simple and process-full as verified figures', () => {
    for (const name of ['process-simple.yaml', 'process-full.yaml']) {
      const r = runCli([join(FIXTURES, name), '--figure'])
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
      assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="process">/)
      assert.match(r.stdout, /<svg role="img"/)
    }
  })

  test('--json on an over-budget process reports ok:true plus the warning and data-warn string', () => {
    const r = runCli([join(FIXTURES, 'process-over-stages.yaml'), '--json'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.warn, 'budget:stages=7')
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:stages'])
    assert.match(out.figureHtml, /data-warn="budget:stages=7" data-type="process"/)
  })

  test('--doc process prints the 4 × 3 example and it renders clean', () => {
    const r = runCli(['--doc', 'process'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, plugin.doc.irExample)
    const ir = validateIR(parseYaml(r.stdout))
    assert.equal(ir.ok, true, JSON.stringify(ir))
    assert.equal(ir.ir.stages.length, 4)
    assert.equal(ir.ir.slots.length, 3)
    assert.deepEqual(ir.warnings, [])
  })
})
