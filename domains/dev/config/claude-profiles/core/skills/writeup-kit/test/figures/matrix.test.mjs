// `type: matrix` — schema, budgets, layout, every verify row failing on a
// mutated render, determinism, the registry dispatch, and the CLI.
// Fixtures: test/fixtures/matrix-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as matrix from '../../bin/lib/figures/matrix.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { unescapeIrScript } from '../../bin/lib/ir-script.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

const ir = (name) => validateIR(parseYaml(fixture(name)))
function validIr(name) {
  const result = ir(name)
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}
const byName = (checks, name) => checks.find((c) => c.name === name)

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** A small raw IR to mutate in schema tests. */
const raw = (over = {}) => ({
  id: 'mx', type: 'matrix', title: 't',
  rows: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  columns: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  cells: [{ row: 'a', col: 'x', mark: 'yes' }, { row: 'b', col: 'y', text: 'n/a' }],
  ...over,
})

const schemaError = (over, re) => {
  const r = validateIR(raw(over))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'schema')
  assert.match(r.message, re)
}

// --- schema ----------------------------------------------------------------

describe('figures/matrix.mjs: schema', () => {
  test('a minimal IR normalizes: marks kept, a text cell gets mark none, legend defaults filled, missing cells stay absent', () => {
    const r = validateIR(raw())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'matrix')
    assert.deepEqual(r.ir.cells, [
      { row: 'a', col: 'x', mark: 'yes', emphasis: false },
      { row: 'b', col: 'y', mark: 'none', text: 'n/a', emphasis: false },
    ])
    assert.deepEqual(r.ir.legend, { yes: 'yes', partial: 'partial', no: 'no' })
    assert.deepEqual(r.warnings, [])
  })

  test('cells may be omitted entirely (an all-blank grid), rows and columns may not', () => {
    assert.equal(validateIR(raw({ cells: undefined })).ok, true)
    schemaError({ rows: [] }, /ir\.rows must be a non-empty list/)
    schemaError({ columns: undefined }, /ir\.columns must be a non-empty list/)
  })

  test('a cell referencing an unknown row or column is a schema error naming the path', () => {
    schemaError({ cells: [{ row: 'zz', col: 'x', mark: 'yes' }] }, /^cells\[0\]\.row references unknown row "zz"$/)
    schemaError({ cells: [{ row: 'a', col: 'zz', mark: 'yes' }] }, /^cells\[0\]\.col references unknown column "zz"$/)
  })

  test('a duplicate row × column cell, a duplicate axis id, and a malformed id are schema errors', () => {
    schemaError({ cells: [{ row: 'a', col: 'x', mark: 'yes' }, { row: 'a', col: 'x', mark: 'no' }] }, /cells\[1\]: duplicate cell for row "a" × column "x"/)
    schemaError({ rows: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }] }, /duplicate row id: "a"/)
    schemaError({ columns: [{ id: 'has space', label: 'X' }] }, /columns\[0\]\.id must match/)
  })

  test('mark is a closed vocabulary, mark and text are exclusive, a cell needs one of them, text is ≤ 8 chars', () => {
    schemaError({ cells: [{ row: 'a', col: 'x', mark: 'maybe' }] }, /cells\[0\]\.mark must be yes\|no\|partial\|none/)
    schemaError({ cells: [{ row: 'a', col: 'x', mark: 'yes', text: 'hi' }] }, /use mark or text, not both/)
    schemaError({ cells: [{ row: 'a', col: 'x' }] }, /needs a mark .* or a text/)
    schemaError({ cells: [{ row: 'a', col: 'x', text: 'nine char' }] }, /text must be ≤ 8 chars \(got 9\)/)
    schemaError({ cells: [{ row: 'a', col: 'x', mark: 'yes', emphasis: 'yes' }] }, /emphasis must be a boolean/)
  })

  test('legend accepts only yes|partial|no captions and fills the rest with defaults', () => {
    const r = validateIR(raw({ legend: { yes: '読み書き', no: '不可' } }))
    assert.equal(r.ok, true)
    assert.deepEqual(r.ir.legend, { yes: '読み書き', partial: 'partial', no: '不可' })
    schemaError({ legend: { maybe: 'x' } }, /legend\.maybe is not a mark/)
    schemaError({ legend: 'yes' }, /legend must be a mapping/)
  })

  test('normalize() is idempotent for every fixture', () => {
    for (const name of ['matrix-simple.yaml', 'matrix-wide.yaml', 'matrix-over-budget.yaml']) {
      const once = matrix.normalize(parseYaml(fixture(name)), 'ir')
      assert.deepEqual(once, validIr(name), name)
      assert.deepEqual(matrix.normalize(JSON.parse(JSON.stringify(once)), 'ir'), once, `${name}: not idempotent`)
    }
  })
})

// --- budgets ------------------------------------------------------------------

describe('figures/matrix.mjs: budgets are advisory warnings in a stable order', () => {
  test('the over-budget fixture warns on rows, columns, header and emphasis, in that order', () => {
    const r = ir('matrix-over-budget.yaml')
    assert.equal(r.ok, true)
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:rows=11;budget:columns=9;budget:header=15;budget:emphasis=3')
    assert.deepEqual(r.warnings.map((w) => w.limit), [6, 8, 14, 1])
    assert.match(r.warnings[0].hint, /split the matrix after row 6/)
    assert.match(r.warnings[2].detail, /columns\[0\]\.label is 15 chars/)
    assert.match(r.warnings[3].hint, /the one cell/)
  })

  test('exactly 6 rows, 8 columns, a 14-char header and 1 emphasized cell are within budget; a 7th row or a 2nd emphasis warns', () => {
    const r = ir('matrix-wide.yaml')
    assert.equal(r.ok, true)
    assert.equal(r.ir.rows.length, 6)
    assert.equal(r.ir.columns.length, 8)
    const one = validateIR(raw({
      rows: [{ id: 'a', label: '十四文字ちょうどの見出しです確認' .slice(0, 14) }, { id: 'b', label: 'B' }],
      cells: [{ row: 'a', col: 'x', mark: 'yes', emphasis: true }, { row: 'b', col: 'y', mark: 'no' }],
    }))
    assert.equal([...one.ir.rows[0].label].length, 14)
    assert.deepEqual(one.warnings, [])
    assert.deepEqual(r.warnings, [])
    const two = validateIR(raw({
      rows: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      cells: [{ row: 'a', col: 'x', mark: 'yes', emphasis: true }, { row: 'b', col: 'y', mark: 'no', emphasis: true }],
    }))
    assert.deepEqual(two.warnings.map((w) => [w.key, w.value, w.limit]), [['budget:emphasis', 2, 1]])
    const seven = validateIR(raw({ rows: 'abcdefg'.split('').map((id) => ({ id, label: id })), cells: [] }))
    assert.deepEqual(seven.warnings.map((w) => [w.key, w.value, w.limit]), [['budget:rows', 7, 6]])
  })
})

// --- layout ---------------------------------------------------------------------

describe('figures/matrix.mjs: layout', () => {
  test('columns and rows are ordered, on the 4px grid, and cell centres sit on the grid (widths are multiples of 8)', async () => {
    const l = await matrix.layout(validIr('matrix-wide.yaml'))
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
    let x = l.geo.originX + l.geo.headerColWidth
    for (const col of l.geo.columns) {
      assert.equal(col.x, x, `column ${col.id} not adjacent to the previous`)
      assert.equal(col.width % 8, 0)
      assert.equal(col.cx % 4, 0)
      x += col.width
    }
    let y = l.geo.originY + l.geo.headerRowHeight
    for (const row of l.geo.rows) {
      assert.equal(row.y, y)
      assert.equal(row.cy % 4, 0)
      y += row.height
    }
    for (const c of l.geo.cells) for (const v of [c.x, c.y, c.cx, c.cy]) assert.equal(v % 4, 0)
    assert.equal(l.geo.legend.y % 4, 0)
    for (const it of l.geo.legend.items) assert.equal(it.x % 4, 0)
  })

  test('a long header wraps to 2 lines and widens only its own column; short ones stay on one line', async () => {
    const short = validIr('matrix-simple.yaml')
    const l1 = await matrix.layout(short)
    assert.ok(l1.geo.columns.every((c) => c.lines.length === 1))
    assert.equal(l1.geo.headerRowHeight, 32)
    const long = structuredClone(short)
    long.columns[1].label = 'サービス停止時間の長さ'
    const l2 = await matrix.layout(long)
    assert.equal(l2.geo.columns[1].lines.length, 2)
    assert.equal(l2.geo.headerRowHeight, 48)
    assert.ok(l2.geo.columns[1].width > l1.geo.columns[1].width)
    assert.equal(l2.geo.columns[0].width, l1.geo.columns[0].width)
    assert.equal(l2.geo.columns[2].width, l1.geo.columns[2].width)
    // an ASCII header with spaces breaks at the balanced space
    const spaced = structuredClone(short)
    spaced.columns[0].label = 'Total cost of ownership'
    const l3 = await matrix.layout(spaced)
    assert.deepEqual(l3.geo.columns[0].lines, ['Total cost', 'of ownership'])
  })

  test('a text cell widens its column to fit the text; cells not listed in the IR produce no geometry', async () => {
    const base = validIr('matrix-simple.yaml')
    const l1 = await matrix.layout(base)
    const wide = structuredClone(base)
    wide.cells[3].text = 'WWWWWWWW'
    const l2 = await matrix.layout(wide)
    assert.ok(l2.geo.columns[3].width > l1.geo.columns[3].width)
    const sparse = validateIR(raw()).ir
    const l3 = await matrix.layout(sparse)
    assert.equal(l3.geo.cells.length, 2)
    assert.deepEqual(l3.geo.cells.map((c) => `${c.row} ${c.col}`), ['a x', 'b y'])
  })

  test('layout and svg are deterministic across runs', async () => {
    const plugin = getFigureType('matrix')
    const irv = validIr('matrix-wide.yaml')
    const a = await renderFigure(plugin, irv)
    const b = await renderFigure(plugin, structuredClone(irv))
    assert.deepEqual(a.layout, b.layout)
    assert.equal(a.svg, b.svg)
  })
})

// --- draw ------------------------------------------------------------------------

describe('figures/matrix.mjs: draw', () => {
  test('marks are glyphs distinguishable without colour: filled, empty and half-filled squares; none draws nothing; emphasis is the accent frame plus bold text', async () => {
    const plugin = getFigureType('matrix')
    const irv = validIr('matrix-simple.yaml')
    const { svg } = await renderFigure(plugin, irv)
    assert.match(svg, /<rect id="wu-d-m1-cell-bigbang-cost" data-mark="yes" [^>]*fill="currentColor" stroke="currentColor"/)
    assert.match(svg, /<rect id="wu-d-m1-cell-bigbang-downtime" data-mark="no" [^>]*fill="none" stroke="currentColor"/)
    assert.match(svg, /<rect id="wu-d-m1-cell-staged-cost" data-mark="partial" [^>]*fill="none"[^>]*\/><rect id="wu-d-m1-cell-staged-cost-half" [^>]*width="6" height="12" fill="currentColor"/)
    assert.match(svg, /<rect id="wu-d-m1-cell-staged-downtime-focus" class="wu-focal" [^>]*stroke="var\(--wu-accent\)" stroke-width="1.5"/)
    assert.match(svg, /<text id="wu-d-m1-cell-bigbang-period-text" [^>]*font-size="11"[^>]*>1 週<\/text>/)
    assert.doesNotMatch(svg, /data-mark="none"/)
    const bold = structuredClone(irv)
    bold.cells[3].emphasis = true
    const { svg: svg2 } = await renderFigure(plugin, bold)
    assert.match(svg2, /<text id="wu-d-m1-cell-bigbang-period-text" [^>]*font-weight="700"/)
  })

  test('the legend strip lists exactly the marks in use, yes → partial → no, with the IR captions; a text-only matrix has no legend', async () => {
    const plugin = getFigureType('matrix')
    const { svg, layout } = await renderFigure(plugin, validIr('matrix-simple.yaml'))
    assert.deepEqual(layout.geo.legend.items.map((i) => [i.mark, i.label]), [['yes', '有利'], ['partial', '条件付き'], ['no', '不利']])
    assert.match(svg, /<g id="wu-d-m1-legend" font-size="11"/)
    const yesNo = validateIR(raw({ cells: [{ row: 'a', col: 'x', mark: 'yes' }, { row: 'b', col: 'y', mark: 'no' }] })).ir
    const r2 = await renderFigure(plugin, yesNo)
    assert.deepEqual(r2.layout.geo.legend.items.map((i) => i.mark), ['yes', 'no'])
    const textOnly = validateIR(raw({ cells: [{ row: 'a', col: 'x', text: 'A' }] })).ir
    const r3 = await renderFigure(plugin, textOnly)
    assert.equal(r3.layout.geo.legend, null)
    assert.doesNotMatch(r3.svg, /-legend/)
    assert.ok(r3.height < r2.height)
  })
})

// --- verify ----------------------------------------------------------------------

describe('figures/matrix.mjs: verify rows', () => {
  const plugin = getFigureType('matrix')

  test('the registry path yields the 9 own rows then the 7 shared rows, all green on the simple fixture', async () => {
    const irv = validIr('matrix-simple.yaml')
    const v = await verifyFigure(plugin, irv, await renderFigure(plugin, irv))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.checks.map((c) => c.name), [
      ...matrix.doc.rows,
      'single-finite-svg', 'a11y', 'font-size', 'stroke-radius', 'dark-3-state', 'grid-4px', 'projected-scale',
    ])
    assert.deepEqual(v.checks.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    assert.deepEqual(v.checks.slice(0, 4).map((c) => c.severity), ['warn', 'warn', 'warn', 'warn'])
    assert.ok(v.checks.slice(4).every((c) => c.severity === 'fail'))
  })

  test('references-exist and cells-unique fail when the IR is mutated behind the schema', async () => {
    const irv = validIr('matrix-simple.yaml')
    const layout = await matrix.layout(irv)
    const dangling = structuredClone(irv)
    dangling.cells[0].col = 'ghost'
    const r1 = byName(matrix.verify(layout, dangling), 'references-exist')
    assert.equal(r1.ok, false)
    assert.match(r1.detail, /cells\[0\]\.col="ghost"/)
    const dup = structuredClone(irv)
    dup.cells.push({ ...irv.cells[0] })
    const r2 = byName(matrix.verify(layout, dup), 'cells-unique')
    assert.equal(r2.ok, false)
    assert.match(r2.detail, /cells\[12\] \(bigbang × cost\)/)
  })

  test('text-fits fails when a cell is narrower than its text', async () => {
    const irv = validIr('matrix-simple.yaml')
    const layout = structuredClone(await matrix.layout(irv))
    const cell = layout.geo.cells.find((c) => c.text !== undefined)
    cell.width = 16
    const row = byName(matrix.verify(layout, irv), 'text-fits')
    assert.equal(row.ok, false)
    assert.match(row.detail, new RegExp(`${cell.row} × ${cell.col} "${cell.text}"`))
    assert.match(row.hint, /≤ 8 chars/)
  })

  test('headers-clear fails on an overlapping column, a header wider than its column, a 3-line header, and a row label wider than the header column', async () => {
    const irv = validIr('matrix-simple.yaml')
    const good = await matrix.layout(irv)
    const overlap = structuredClone(good)
    overlap.geo.columns[0].width += 8
    assert.match(byName(matrix.verify(overlap, irv), 'headers-clear').detail, /columns "cost" and "downtime" overlap/)
    const narrow = structuredClone(good)
    narrow.geo.columns[1].width = 8
    assert.match(byName(matrix.verify(narrow, irv), 'headers-clear').detail, /column "downtime" header wider than its column/)
    const tall = structuredClone(good)
    tall.geo.columns[1].lines = ['停', '止', '時間']
    assert.match(byName(matrix.verify(tall, irv), 'headers-clear').detail, /column "downtime" wraps to 3 lines/)
    const rowWide = structuredClone(good)
    rowWide.geo.headerColWidth = 16
    assert.match(byName(matrix.verify(rowWide, irv), 'headers-clear').detail, /row "bigbang" label wider than the header column/)
    assert.equal(byName(matrix.verify(good, irv), 'headers-clear').ok, true)
  })

  test('legend-matches fails when the strip lists a mark the cells do not use, or misses one they do', async () => {
    const irv = validIr('matrix-simple.yaml')
    const good = await matrix.layout(irv)
    const missing = structuredClone(good)
    missing.geo.legend.items.pop()
    const r1 = byName(matrix.verify(missing, irv), 'legend-matches')
    assert.equal(r1.ok, false)
    assert.match(r1.detail, /legend lists \[yes, partial\] but the cells use \[yes, partial, no\]/)
    const yesOnly = structuredClone(irv)
    yesOnly.cells = yesOnly.cells.map((c) => ({ ...c, mark: c.text !== undefined ? 'none' : 'yes' }))
    const r2 = byName(matrix.verify(good, yesOnly), 'legend-matches')
    assert.equal(r2.ok, false)
    assert.match(r2.detail, /but the cells use \[yes\]/)
  })

  test('the four budget rows carry key/value when over budget and reach data-warn', async () => {
    const irv = validIr('matrix-over-budget.yaml')
    const v = await verifyFigure(plugin, irv, await renderFigure(plugin, irv))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => `${w.key}=${w.value}`), ['budget:rows=11', 'budget:columns=9', 'budget:header=15', 'budget:emphasis=3'])
    assert.deepEqual(v.warnings.map((w) => w.name), ['row-count', 'column-count', 'header-length', 'emphasis-count'])
  })

  test('shared row grid-4px reads the matrix geometry: an off-grid column x fails it', async () => {
    const irv = validIr('matrix-simple.yaml')
    const bad = structuredClone(await renderFigure(plugin, irv))
    bad.layout.geo.columns[0].x += 2
    const v = await verifyFigure(plugin, irv, bad)
    assert.equal(byName(v.checks, 'grid-4px').ok, false)
    assert.match(byName(v.checks, 'grid-4px').detail, /columns\[0\]\.x=/)
  })
})

// --- registry dispatch --------------------------------------------------------------

describe('verify-diagram.mjs: renderFigureHtmlChecked dispatches type: matrix', () => {
  test('matrix-simple renders a data-checks="pass" data-type="matrix" figure with the IR embedded, and the script round-trips', async () => {
    const rawText = fixture('matrix-simple.yaml')
    const rendered = await renderFigureHtmlChecked(validIr('matrix-simple.yaml'), { rawYaml: rawText })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="matrix">/)
    assert.match(rendered.html, /<figcaption>段階移行が費用と停止時間の両方で優位<\/figcaption>/)
    const scriptMatch = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(rendered.html)
    assert.ok(scriptMatch)
    const back = validateIR(parseYaml(unescapeIrScript(scriptMatch[1])))
    assert.equal(back.ok, true)
    assert.deepEqual(back.ir, validIr('matrix-simple.yaml'))
  })

  test('matrix-wide (6 × 8) is wider than the column and scales (≥ 0.78) instead of scrolling, every row green', async () => {
    const rendered = await renderFigureHtmlChecked(validIr('matrix-wide.yaml'), { rawYaml: fixture('matrix-wide.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.ok(rendered.width > 720, `width ${rendered.width}`)
    assert.equal(rendered.scaled, true)
    assert.equal(rendered.scroll, false)
    assert.match(rendered.html, /<svg role="img"[^>]* width="720" height="\d+" viewBox="0 0 \d+ \d+"/)
    assert.doesNotMatch(rendered.html, /data-scroll/)
    assert.ok(!rendered.warn, `unexpected warn ${rendered.warn}`)
  })

  test('the over-budget fixture still passes, carrying data-warn with all four budget keys', async () => {
    const rendered = await renderFigureHtmlChecked(validIr('matrix-over-budget.yaml'), { rawYaml: fixture('matrix-over-budget.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.ok(rendered.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:rows=11;budget:columns=9;budget:header=15;budget:emphasis=3" data-type="matrix">'), rendered.html.slice(0, 160))
  })

  test('the plugin is registered with its limits and rows, and its doc.irExample renders clean with a legend', async () => {
    const plugin = getFigureType('matrix')
    assert.equal(plugin.builtin, false)
    assert.deepEqual(plugin.limits, { maxRows: 6, maxColumns: 8, maxHeaderLen: 14, maxEmphasis: 1 })
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.rows.length, 4)
    assert.equal(r.ir.columns.length, 5)
    assert.deepEqual(r.warnings, [])
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.deepEqual(rendered.layout.geo.legend.items.map((i) => i.label), ['読み書き', '読み取りのみ', '不可'])
  })
})

// --- CLI -------------------------------------------------------------------------------

describe('render-diagram.mjs CLI: type matrix', () => {
  test('--figure prints a verified matrix figure; --json reports ok with figureHtml', () => {
    const r = runCli([join(FIXTURES, 'matrix-simple.yaml'), '--figure'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="matrix">/)
    const j = runCli([join(FIXTURES, 'matrix-wide.yaml'), '--json'])
    assert.equal(j.status, 0)
    const out = JSON.parse(j.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.scaled, true)
    assert.match(out.figureHtml, /data-type="matrix"/)
  })

  test('a budget overrun exits 0 with data-warn and echoes every warning on stderr; a schema error exits 2', () => {
    const r = runCli([join(FIXTURES, 'matrix-over-budget.yaml'), '--figure'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /data-warn="budget:rows=11;budget:columns=9;budget:header=15;budget:emphasis=3"/)
    assert.match(r.stderr, /warning: budget:rows=11 \(#1 row-count\)/)
    assert.match(r.stderr, /warning: budget:emphasis=3 \(#4 emphasis-count\)/)
    const doc = runCli(['--doc', 'matrix'])
    assert.equal(doc.status, 0)
    assert.equal(doc.stdout, matrix.doc.irExample)
  })
})
