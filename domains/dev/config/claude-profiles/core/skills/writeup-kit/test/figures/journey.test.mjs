// `type: journey` — schema, budgets, layout facts, every verify row failing
// on a hand-mutated render, the registry dispatch, and the CLI. Fixtures:
// test/fixtures/journey-*.yaml (see references/figure-types.md §4).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/journey.mjs'
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

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const OWN_ROWS = ['stage-count', 'row-count', 'cell-text-length', 'emphasis-count', 'references-exist', 'cells-inside-grid', 'curve-at-stage-centres', 'labels-clear-of-curve']
const SHARED_ROWS = ['single-finite-svg', 'a11y', 'font-size', 'stroke-radius', 'dark-3-state', 'grid-4px', 'projected-scale']
const ALL_FIXTURES = ['journey-simple.yaml', 'journey-full.yaml', 'journey-over-stages.yaml', 'journey-over-rows.yaml', 'journey-over-cell-text.yaml', 'journey-over-emphasis.yaml']

const minimal = () => ({
  id: 'j', type: 'journey', title: 't',
  rows: ['act', 'pain'],
  stages: [
    { id: 'a', label: 'A', emotion: 1, cells: { act: 'x', pain: ['y', 'z'] } },
    { id: 'b', label: 'B', emotion: -2, emphasis: true, cells: { act: 'w' } },
    { id: 'c', label: 'C', emotion: 2 },
  ],
})

// --- schema --------------------------------------------------------------

describe('journey: schema', () => {
  test('a minimal IR normalizes: cells become item lists in row order, emotion kept, absent emotion is null', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'journey')
    assert.deepEqual(r.ir.rows, ['act', 'pain'])
    assert.deepEqual(r.ir.stages[0], { id: 'a', label: 'A', emphasis: false, emotion: 1, cells: { act: ['x'], pain: ['y', 'z'] } })
    assert.deepEqual(r.ir.stages[2], { id: 'c', label: 'C', emphasis: false, emotion: 2, cells: {} })
    const none = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A' }] })
    assert.equal(none.ir.stages[0].emotion, null)
    assert.equal(r.ir.persona, undefined)
    assert.equal(validateIR({ ...minimal(), persona: '営業担当' }).ir.persona, '営業担当')
  })

  test('rows must be a non-empty list of unique strings; a cell keyed by an undeclared row names the declared ones', () => {
    assert.equal(validateIR({ ...minimal(), rows: [] }).ok, false)
    const dup = validateIR({ ...minimal(), rows: ['act', 'act'] })
    assert.equal(dup.ok, false)
    assert.match(dup.message, /duplicate row/)
    const r = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', cells: { ghost: 'x' } }] })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /unknown row "ghost" \(declared: act, pain\)/)
  })

  test('emotion must be an integer -2..2; duplicate stage ids and non-string cells are rejected', () => {
    for (const bad of [3, -3, 1.5, '1', true]) {
      const r = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', emotion: bad }] })
      assert.equal(r.ok, false, JSON.stringify(bad))
      assert.match(r.message, /stages\[0\]\.emotion must be an integer from -2 to 2/)
    }
    const dup = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })
    assert.match(dup.message, /duplicate stage id "a"/)
    const cell = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', cells: { act: [''] } }] })
    assert.match(cell.message, /cells\["act"\]\[0\] must be a non-empty string/)
  })

  test('normalize() is idempotent for every fixture and equals validateIR()', () => {
    for (const name of ALL_FIXTURES) {
      const raw = parseYaml(fixture(name))
      const once = plugin.normalize(raw)
      const twice = plugin.normalize(once)
      assert.deepEqual(twice, once, name)
      assert.deepEqual(validateIR(raw).ir, once, name)
    }
  })
})

// --- budgets -------------------------------------------------------------

describe('journey: budgets', () => {
  test('clean fixtures have no warnings', () => {
    for (const name of ['journey-simple.yaml', 'journey-full.yaml']) {
      assert.deepEqual(validateIR(parseYaml(fixture(name))).warnings, [], name)
    }
  })

  test('each budget key fires on its fixture and reaches data-warn', async () => {
    const cases = [
      ['journey-over-stages.yaml', 'budget:stages', 8],
      ['journey-over-rows.yaml', 'budget:rows', 5],
      ['journey-over-cell-text.yaml', 'budget:cell-text', 22],
      ['journey-over-emphasis.yaml', 'budget:emphasis', 3],
    ]
    for (const [name, key, value] of cases) {
      const r = validateIR(parseYaml(fixture(name)))
      assert.equal(r.ok, true, name)
      assert.deepEqual(r.warnings.map((w) => [w.key, w.value]), [[key, value]], name)
      assert.ok(r.warnings[0].hint && r.warnings[0].hint !== r.warnings[0].detail, name)
      const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, name)
      assert.match(rendered.html, new RegExp(`data-warn="${key}=${value}" data-type="journey"`), name)
    }
  })

  test('keys come out in a stable order: stages, rows, cell-text, emphasis', () => {
    const ir = validateIR({
      ...minimal(),
      rows: ['r1', 'r2', 'r3', 'r4', 'r5'],
      stages: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, emotion: 0, emphasis: i < 3, cells: { r1: 'a very long cell item indeed' } })),
    }).ir
    const keys = plugin.budgetWarnings(ir).map((w) => w.key)
    assert.deepEqual(keys, ['budget:stages', 'budget:rows', 'budget:cell-text', 'budget:emphasis'])
    assert.equal(formatBudgetWarnings(plugin.budgetWarnings(ir)), 'budget:stages=8;budget:rows=5;budget:cell-text=28;budget:emphasis=3')
  })
})

// --- layout --------------------------------------------------------------

describe('journey: layout', () => {
  test('stages are columns left → right, rows top → bottom under the header band, cells sit on their column × row', async () => {
    const ir = validIr('journey-full.yaml')
    const { geo } = await plugin.layout(ir)
    assert.deepEqual(geo.stages.map((s) => s.id), ir.stages.map((s) => s.id))
    for (let i = 1; i < geo.stages.length; i++) assert.ok(geo.stages[i].x >= geo.stages[i - 1].x + geo.stages[i - 1].width + 8)
    assert.deepEqual(geo.rows.map((r) => r.row), ir.rows)
    assert.ok(geo.rows[0].y >= geo.header.y + geo.header.height)
    for (let r = 1; r < geo.rows.length; r++) assert.equal(geo.rows[r].y, geo.rows[r - 1].y + geo.rows[r - 1].height)
    const stageOf = new Map(geo.stages.map((s) => [s.id, s]))
    const rowOf = new Map(geo.rows.map((r) => [r.row, r]))
    for (const c of geo.cells) {
      assert.equal(c.x, stageOf.get(c.stage).x)
      assert.equal(c.width, stageOf.get(c.stage).width)
      assert.equal(c.y, rowOf.get(c.row).y)
      assert.equal(c.height, rowOf.get(c.row).height)
    }
    assert.equal(geo.persona.text, '出張の多い営業担当')
    assert.ok(geo.header.y > geo.persona.y)
  })

  test('the emotion band sits below the grid: points at stage centres, 16px per level, zero line in the middle, 良い / 悪い at the edges', async () => {
    const ir = validIr('journey-full.yaml')
    const { geo } = await plugin.layout(ir)
    const b = geo.band
    assert.ok(b.y >= geo.gridBottom)
    assert.equal(b.x, geo.gridLeft)
    assert.equal(b.width, geo.gridRight - geo.gridLeft)
    assert.equal(b.levelPitch, 16)
    assert.deepEqual(b.levels.map((l) => l.value), [2, 1, 0, -1, -2])
    assert.equal(b.zeroY, b.y + b.height / 2)
    assert.equal(b.points.length, ir.stages.length)
    b.points.forEach((p, i) => {
      const s = geo.stages[i]
      assert.equal(p.stage, s.id)
      assert.equal(p.x, s.centerX)
      assert.equal(p.y, b.zeroY - ir.stages[i].emotion * 16)
      assert.equal(p.emphasis, ir.stages[i].emphasis)
    })
    assert.equal(b.segments.length, ir.stages.length - 1)
    assert.deepEqual(b.edgeLabels.map((l) => l.text), ['良い', '悪い'])
    assert.equal(b.edgeLabels[0].y - 4, b.levels[0].y)
    assert.equal(b.edgeLabels[1].y - 4, b.levels[4].y)
  })

  test('the curve is monotone between neighbouring points and stays inside the band; a stage without emotion is skipped', async () => {
    const ir = validIr('journey-full.yaml')
    const { geo } = await plugin.layout(ir)
    const b = geo.band
    for (const s of b.segments) {
      const p = b.points[s.from], q = b.points[s.to]
      const lo = Math.min(p.y, q.y), hi = Math.max(p.y, q.y)
      for (const c of [s.c1, s.c2]) {
        assert.ok(c.py >= lo - 0.05 && c.py <= hi + 0.05, `control point ${c.py} outside ${lo}..${hi}`)
        assert.ok(c.px > p.x && c.px < q.x)
      }
    }
    const partial = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A', emotion: 1 }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', emotion: -1 }] }).ir
    const pg = (await plugin.layout(partial)).geo
    assert.deepEqual(pg.band.points.map((p) => p.stage), ['a', 'c'])
    const none = validateIR({ ...minimal(), stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }).ir
    assert.equal((await plugin.layout(none)).geo.band, null)
  })

  test('layout and render are deterministic, on the 4px grid, and a 6 × 3 journey fits the column without scaling', async () => {
    const ir = validIr('journey-full.yaml')
    const a = await plugin.layout(ir)
    const b = await plugin.layout(ir)
    assert.deepEqual(a, b)
    const p = getFigureType('journey')
    const r1 = await renderFigure(p, ir)
    const r2 = await renderFigure(p, ir)
    assert.equal(r1.svg, r2.svg)
    assert.equal(a.width % 4, 0)
    assert.equal(a.height % 4, 0)
    assert.equal(r1.scaled, false)
    assert.equal(r1.scroll, false)
    assert.ok(a.width <= 720)
  })

  test('an 8-stage journey fits the column through shared scaling, not the scroll fallback', async () => {
    const r = await renderFigure(getFigureType('journey'), validIr('journey-over-stages.yaml'))
    assert.equal(r.scaled, true)
    assert.equal(r.scroll, false)
    assert.ok(r.width > 720 && 720 / r.width >= 0.78)
  })
})

// --- verify --------------------------------------------------------------

describe('journey: verify rows', () => {
  const p = () => getFigureType('journey')

  test('a clean render passes every own row and the shared rows, in order, ids 1..15', async () => {
    for (const name of ['journey-simple.yaml', 'journey-full.yaml']) {
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
    const ir = validIr('journey-over-emphasis.yaml')
    const result = await verifyFigure(p(), ir, await renderFigure(p(), ir))
    assert.equal(result.ok, true)
    const row = result.checks.find((c) => c.name === 'emphasis-count')
    assert.deepEqual([row.severity, row.ok, row.key, row.value], ['warn', false, 'budget:emphasis', 3])
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:emphasis'])
  })

  test('references-exist fails when a cell or a curve point names an undeclared stage, or a point belongs to a stage without emotion', async () => {
    const ir = validIr('journey-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.cells[0].stage = 'ghost'
    bad.layout.geo.band.points[0].stage = 'ghost'
    bad.layout.geo.stages[1].emotion = null
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'references-exist')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cells\[0\] → unknown stage "ghost"/)
    assert.match(row.detail, /band\.points\[0\] → unknown stage "ghost"/)
    assert.match(row.detail, /band\.points\[1\] → stage "wait" has no emotion/)
    assert.equal(result.ok, false)
  })

  test('cells-inside-grid fails when a cell leaves its column, overlaps another cell, or a line runs past the padding', async () => {
    const ir = validIr('journey-simple.yaml')
    const shifted = structuredClone(await renderFigure(p(), ir))
    shifted.layout.geo.cells[0].x += 4
    let row = (await verifyFigure(p(), ir, shifted)).checks.find((c) => c.name === 'cells-inside-grid')
    assert.equal(row.ok, false)
    assert.match(row.detail, /x\/width .* ≠ column/)

    const overlapping = structuredClone(await renderFigure(p(), ir))
    const cells = overlapping.layout.geo.cells
    const c1 = cells.find((c) => c.stage === 'wait' && c.row === '行動'), c2 = cells.find((c) => c.stage === 'wait' && c.row === '不満')
    c2.y = c1.y; c2.height = c1.height
    overlapping.layout.geo.rows[1].y = c1.y; overlapping.layout.geo.rows[1].height = c1.height
    row = (await verifyFigure(p(), ir, overlapping)).checks.find((c) => c.name === 'cells-inside-grid')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overlaps/)

    const wide = structuredClone(await renderFigure(p(), ir))
    wide.layout.geo.cells[0].lines[0].x = wide.layout.geo.cells[0].x + wide.layout.geo.cells[0].width - 8
    row = (await verifyFigure(p(), ir, wide)).checks.find((c) => c.name === 'cells-inside-grid')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overflows horizontally/)

    const tall = structuredClone(await renderFigure(p(), ir))
    tall.layout.geo.cells[0].lines[0].y = tall.layout.geo.cells[0].y + tall.layout.geo.cells[0].height + 8
    row = (await verifyFigure(p(), ir, tall)).checks.find((c) => c.name === 'cells-inside-grid')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overflows vertically/)
  })

  test('curve-at-stage-centres fails on a point off its stage centre, at the wrong level, outside the band, out of order, or an overshooting segment', async () => {
    const ir = validIr('journey-full.yaml')
    const check = async (mutate, pattern) => {
      const bad = structuredClone(await renderFigure(p(), ir))
      mutate(bad.layout.geo)
      const result = await verifyFigure(p(), ir, bad)
      const row = result.checks.find((c) => c.name === 'curve-at-stage-centres')
      assert.equal(row.ok, false, pattern)
      assert.match(row.detail, pattern)
      assert.equal(result.ok, false)
    }
    await check((g) => { g.band.points[0].x += 4 }, /is not the stage centre/)
    await check((g) => { g.band.points[1].y += 16 }, /≠ .* for emotion/)
    await check((g) => { g.band.points[2].emotion = 4; g.band.points[2].y = g.band.zeroY - 4 * 16 }, /outside the band/)
    await check((g) => { g.band.points[3].x = g.band.points[2].x; g.stages[3].centerX = g.band.points[2].x }, /does not sit right of/)
    await check((g) => { g.band.segments[0].c1.py -= 40 }, /overshoots/)
  })

  test('labels-clear-of-curve fails when a label box is placed on the curve', async () => {
    const ir = validIr('journey-full.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    const pt = bad.layout.geo.band.points[2]
    bad.layout.geo.band.edgeLabels[1].x = pt.x + 20
    bad.layout.geo.band.edgeLabels[1].y = pt.y + 4
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'labels-clear-of-curve')
    assert.equal(row.ok, false)
    assert.match(row.detail, /band label "悪い" crosses the curve/)
    assert.equal(result.ok, false)

    const cell = structuredClone(await renderFigure(p(), ir))
    const line = cell.layout.geo.cells[0].lines[0]
    line.x = pt.x - 10; line.y = pt.y + 4
    const row2 = (await verifyFigure(p(), ir, cell)).checks.find((c) => c.name === 'labels-clear-of-curve')
    assert.equal(row2.ok, false)
    assert.match(row2.detail, /cells\[0\] line 0 .* crosses the curve/)
  })

  test('shared row grid-4px reads the plugin geometry: an off-grid point y fails it', async () => {
    const ir = validIr('journey-simple.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.band.points[0].y += 2
    bad.layout.geo.band.zeroY += 2
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'grid-4px')
    assert.equal(row.ok, false)
    assert.match(row.detail, /band\.points\[0\]\.y=/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('journey: registry dispatch and CLI', () => {
  test('the plugin is registered with its budgets and row names', () => {
    const p = getFigureType('journey')
    assert.ok(p && !p.builtin)
    assert.deepEqual(p.limits, { maxStages: 7, maxRows: 4, maxCellTextLen: 16, maxEmphasis: 2 })
    assert.deepEqual(p.doc.rows, OWN_ROWS)
  })

  test('renderFigureHtmlChecked() yields a passing journey figure: IR embedded, focal header, accent only on the emphasized point, curve as cubic Béziers', async () => {
    const raw = fixture('journey-full.yaml')
    const rendered = await renderFigureHtmlChecked(validIr('journey-full.yaml'), { rawYaml: raw })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="journey">/)
    assert.match(rendered.html, /<rect id="wu-d-j-full-stage-input" data-tone="neutral" class="wu-focal"/)
    assert.match(rendered.html, /<text id="wu-d-j-full-stage-input-label"[^>]*font-weight="700"/)
    assert.equal((rendered.html.match(/class="wu-focal"/g) || []).length, 1)
    assert.equal((rendered.html.match(/var\(--wu-accent\)/g) || []).length, 1)
    assert.match(rendered.html, /<circle id="wu-d-j-full-point-input"[^>]*stroke="var\(--wu-accent\)"[^>]*data-value="-2"/)
    assert.match(rendered.html, /<path id="wu-d-j-full-curve" d="M\d+ \d+( C[\d. ]+)+"/)
    assert.match(rendered.html, /<text id="wu-d-j-full-persona"/)
    assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
  })

  test('--figure renders journey-simple and journey-full as verified figures', () => {
    for (const name of ['journey-simple.yaml', 'journey-full.yaml']) {
      const r = runCli([join(FIXTURES, name), '--figure'])
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
      assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="journey">/)
      assert.match(r.stdout, /<svg role="img"/)
    }
  })

  test('--json on an over-budget journey reports ok:true plus the warning and data-warn string', () => {
    const r = runCli([join(FIXTURES, 'journey-over-stages.yaml'), '--json'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.warn, 'budget:stages=8')
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:stages'])
    assert.match(out.figureHtml, /data-warn="budget:stages=8" data-type="journey"/)
  })

  test('--doc journey prints the 5 × 3 example with emotions and it renders clean', () => {
    const r = runCli(['--doc', 'journey'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, plugin.doc.irExample)
    const ir = validateIR(parseYaml(r.stdout))
    assert.equal(ir.ok, true, JSON.stringify(ir))
    assert.equal(ir.ir.stages.length, 5)
    assert.equal(ir.ir.rows.length, 3)
    assert.ok(ir.ir.stages.every((s) => Number.isInteger(s.emotion)))
    assert.deepEqual(ir.warnings, [])
  })
})
