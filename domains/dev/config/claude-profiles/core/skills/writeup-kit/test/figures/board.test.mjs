// `type: board` (variant kanban | story-map) — schema, budgets, layout
// facts, every verify row failing on a hand-mutated render, the registry
// dispatch, and the CLI. Fixtures: test/fixtures/board-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as plugin from '../../bin/lib/figures/board.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const FIXTURE_NAMES = ['board-kanban.yaml', 'board-kanban-over-wip.yaml', 'board-story.yaml', 'board-over-budget.yaml']

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const OWN_ROWS = ['column-count', 'cards-per-column', 'label-length', 'emphasis-count', 'wip-within-limit', 'cards-in-column', 'cards-no-overlap', 'wip-count-matches', 'cuts-clear', 'text-inside-cards']
const SHARED_ROWS = ['single-finite-svg', 'a11y', 'font-size', 'stroke-radius', 'dark-3-state', 'grid-4px', 'projected-scale']

const minimal = (extra = {}) => ({
  id: 'b', type: 'board', title: 't',
  columns: [
    { id: 'todo', label: 'Todo', cards: ['a', { label: 'b', emphasis: true, tone: 'rs' }] },
    { id: 'doing', label: 'Doing', limit: 2, cards: ['c'] },
  ],
  ...extra,
})

const p = () => getFigureType('board')

// --- schema --------------------------------------------------------------

describe('board: schema', () => {
  test('a minimal IR normalizes: variant defaults to kanban, string cards become { label, emphasis, tone }, limit is kept', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'board')
    assert.equal(r.ir.variant, 'kanban')
    assert.deepEqual(r.ir.columns[0], { id: 'todo', label: 'Todo', cards: [{ label: 'a', emphasis: false, tone: 'neutral' }, { label: 'b', emphasis: true, tone: 'rs' }] })
    assert.deepEqual(r.ir.columns[1], { id: 'doing', label: 'Doing', limit: 2, cards: [{ label: 'c', emphasis: false, tone: 'neutral' }] })
    assert.equal('cuts' in r.ir, false)
  })

  test('variant must be kanban|story-map; limit is kanban-only; cuts are story-map-only', () => {
    const v = validateIR(minimal({ variant: 'scrum' }))
    assert.equal(v.ok, false)
    assert.match(v.message, /variant must be kanban\|story-map/)
    const l = validateIR(minimal({ variant: 'story-map' }))
    assert.equal(l.ok, false)
    assert.match(l.message, /columns\[1\]\.limit is kanban-only/)
    const c = validateIR(minimal({ cuts: [{ after: 0, label: 'MVP' }] }))
    assert.equal(c.ok, false)
    assert.match(c.message, /cuts is story-map-only/)
    const bad = validateIR(minimal({ columns: [{ id: 'a', label: 'A', limit: 0, cards: ['x'] }] }))
    assert.equal(bad.ok, false)
    assert.match(bad.message, /limit must be a positive integer/)
  })

  test('cuts: after must be a row index inside the grid, unique, with a label; they come back sorted', () => {
    const story = (cuts) => validateIR({ id: 'b', type: 'board', title: 't', variant: 'story-map', columns: [{ id: 'a', label: 'A', cards: ['x', 'y', 'z'] }, { id: 'b', label: 'B', cards: ['w'] }], cuts })
    const out = story([{ after: 2, label: 'R2' }, { after: 0, label: 'MVP' }])
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(out.ir.cuts, [{ after: 0, label: 'MVP' }, { after: 2, label: 'R2' }])
    assert.match(story([{ after: 3, label: 'x' }]).message, /after must be a row index 0\.\.2/)
    assert.match(story([{ after: -1, label: 'x' }]).message, /after must be a row index/)
    assert.match(story([{ after: 1, label: 'x' }, { after: 1, label: 'y' }]).message, /two cuts after row 1/)
    assert.match(story([{ after: 1 }]).message, /cuts\[0\]\.label is required/)
  })

  test('columns need unique ids, a label, and at least one card overall; a card must be a string or a { label } mapping', () => {
    const dup = validateIR(minimal({ columns: [{ id: 'a', label: 'A', cards: ['x'] }, { id: 'a', label: 'B', cards: ['y'] }] }))
    assert.match(dup.message, /duplicate column id "a"/)
    const empty = validateIR(minimal({ columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', cards: [] }] }))
    assert.match(empty.message, /at least one card in total/)
    const badCard = validateIR(minimal({ columns: [{ id: 'a', label: 'A', cards: [3] }] }))
    assert.match(badCard.message, /cards\[0\] must be a string or a mapping/)
    const badTone = validateIR(minimal({ columns: [{ id: 'a', label: 'A', cards: [{ label: 'x', tone: 'red' }] }] }))
    assert.match(badTone.message, /tone must be ts\|rs\|new\|neutral/)
  })

  test('normalize() is idempotent for every fixture and equals validateIR()', () => {
    for (const name of FIXTURE_NAMES) {
      const raw = parseYaml(fixture(name))
      const once = plugin.normalize(raw, 'ir')
      assert.deepEqual(once, validIr(name), name)
      assert.deepEqual(plugin.normalize(JSON.parse(JSON.stringify(once)), 'ir'), once, `${name}: not idempotent`)
    }
  })
})

// --- budgets -------------------------------------------------------------

describe('board: budgets', () => {
  test('clean fixtures have no warnings', () => {
    assert.deepEqual(plugin.budgetWarnings(validIr('board-kanban.yaml')), [])
    assert.deepEqual(plugin.budgetWarnings(validIr('board-story.yaml')), [])
  })

  test('a column over its WIP limit warns with budget:wip and a concrete hint, and reaches data-warn', async () => {
    const ir = validIr('board-kanban-over-wip.yaml')
    const w = plugin.budgetWarnings(ir)
    assert.deepEqual(w.map((x) => [x.key, x.value]), [['budget:wip', 1]])
    assert.match(w[0].detail, /column "doing" holds 3 card\(s\) over its WIP limit 2/)
    assert.match(w[0].hint, /finish or pull back 1 card\(s\) in "doing"/)
    const rendered = await renderFigureHtmlChecked(ir)
    assert.match(rendered.html, /data-checks="pass" data-warn="budget:wip=1" data-type="board"/)
  })

  test('each budget key fires alone on an inline IR', () => {
    const cols = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `C${i}`, cards: ['x'] }))
    const key = (ir) => plugin.budgetWarnings(validateIR(ir).ir).map((w) => [w.key, w.value])
    assert.deepEqual(key(minimal({ columns: cols(7) })), [['budget:columns', 7]])
    assert.deepEqual(key(minimal({ columns: [{ id: 'a', label: 'A', cards: Array.from({ length: 9 }, (_, i) => `k${i}`) }] })), [['budget:cards', 9]])
    assert.deepEqual(key(minimal({ columns: [{ id: 'a', label: 'A', cards: ['このラベルは十五文字ある長さです'] }] })), [['budget:label', 16]])
    assert.deepEqual(key(minimal({ columns: [{ id: 'a', label: 'A', cards: ['x', 'y', 'z'].map((label) => ({ label, emphasis: true })) }] })), [['budget:emphasis', 3]])
  })

  test('keys come out in a stable order: columns, cards, label, emphasis, wip', () => {
    const r = validateIR(parseYaml(fixture('board-over-budget.yaml')))
    assert.equal(r.ok, true)
    assert.deepEqual(plugin.budgetWarnings(r.ir).map((w) => w.key), ['budget:columns', 'budget:cards', 'budget:label', 'budget:emphasis', 'budget:wip'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:columns=7;budget:cards=9;budget:label=17;budget:emphasis=3;budget:wip=1')
  })
})

// --- layout --------------------------------------------------------------

describe('board: layout', () => {
  test('columns are equal-width, left → right with a 16px gap, derived from the 720px column and never wider than 720', async () => {
    const ir = validIr('board-story.yaml')
    const { width, geo } = await plugin.layout(ir)
    assert.deepEqual(geo.columns.map((c) => c.id), ['signup', 'setup', 'use', 'notify', 'review'])
    const w = geo.columns[0].width
    assert.equal(w, 124) // floor((720 - 32 - 4*16) / 5) = 124, already on the 4px grid
    for (const c of geo.columns) assert.equal(c.width, w)
    for (let i = 1; i < geo.columns.length; i++) assert.equal(geo.columns[i].x, geo.columns[i - 1].x + w + 16)
    assert.ok(width <= 720)
    assert.equal(geo.gridRight, geo.columns[4].x + w)
  })

  test('cards sit on shared rows with 8px gaps; a row is as tall as its tallest (wrapped) card', async () => {
    const ir = validIr('board-story.yaml')
    const { geo } = await plugin.layout(ir)
    assert.equal(geo.rows.length, 4)
    for (const card of geo.cards) {
      const col = geo.columns.find((c) => c.id === card.column), row = geo.rows[card.row]
      assert.deepEqual([card.x, card.width, card.y, card.height], [col.x, col.width, row.y, row.height])
      assert.ok(card.lines.length >= 1 && card.lines.length <= 2)
    }
    const rowsWithoutCut = geo.rows.filter((r, i) => i > 0 && !geo.cuts.some((c) => c.after === i - 1))
    for (const r of rowsWithoutCut) assert.equal(r.y, geo.rows[r.index - 1].y + geo.rows[r.index - 1].height + 8)
    assert.equal(geo.rows[0].y, geo.columns[0].header.y + geo.columns[0].header.height + 8)
    for (const r of geo.rows) assert.equal(r.height, 32)
  })

  test('a card label wider than the card wraps onto two lines and the row grows to 48', async () => {
    const r = validateIR(minimal({ columns: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, cards: [i === 0 ? '十二文字のラベルを折り返す' : 'x'] })) }))
    assert.equal(r.ok, true, JSON.stringify(r))
    const { width, geo } = await plugin.layout(r.ir)
    assert.ok(width <= 720)
    const wrapped = geo.cards.find((c) => c.column === 'c0')
    assert.equal(wrapped.lines.length, 2)
    assert.equal(geo.rows[0].height, 48)
    assert.equal(wrapped.lines[1].y, wrapped.lines[0].y + 16)
  })

  test('a story-map cut inserts a corridor: the line sits below its row, above the next, spans the grid, label right-aligned above the line', async () => {
    const ir = validIr('board-story.yaml')
    const { geo } = await plugin.layout(ir)
    assert.deepEqual(geo.cuts.map((c) => [c.after, c.label]), [[0, 'MVP'], [2, 'Release 2']])
    for (const cut of geo.cuts) {
      const prev = geo.rows[cut.after], next = geo.rows[cut.after + 1]
      assert.equal(cut.y, prev.y + prev.height + 28)
      assert.equal(next.y, prev.y + prev.height + 8 + 28)
      assert.equal(cut.labelY, cut.y - 8)
      assert.deepEqual([cut.x1, cut.x2, cut.labelX], [geo.gridLeft, geo.gridRight, geo.gridRight])
    }
  })

  test('kanban headers carry a WIP chip: count/limit when a limit is set, the bare count otherwise, over-limit flagged', async () => {
    const { geo } = await plugin.layout(validIr('board-kanban-over-wip.yaml'))
    assert.deepEqual(geo.columns.map((c) => [c.id, c.chip.text, c.over]), [['todo', '1', false], ['doing', '3/2', true], ['done', '1', false]])
    for (const c of geo.columns) {
      assert.equal(c.chip.x + c.chip.width, c.header.x + c.header.width - 8, `${c.id}: chip is right-aligned in the header`)
      assert.equal(c.chip.y, c.header.y + 8)
    }
    const story = await plugin.layout(validIr('board-story.yaml'))
    assert.ok(story.geo.columns.every((c) => c.chip === undefined), 'a story map has no chips')
  })

  test('layout and render are deterministic, canvas on the 4px grid', async () => {
    for (const name of ['board-kanban.yaml', 'board-story.yaml']) {
      const ir = validIr(name)
      const a = await plugin.layout(ir)
      const b = await plugin.layout(ir)
      assert.deepEqual(a, b, name)
      const r1 = await renderFigure(p(), ir)
      const r2 = await renderFigure(p(), ir)
      assert.equal(r1.svg, r2.svg, name)
      assert.equal(a.width % 4, 0)
      assert.equal(a.height % 4, 0)
    }
  })

  test('an over-budget 7-column board still renders, wider than the column, through the shared scale/scroll decision', async () => {
    const r = await renderFigure(p(), validIr('board-over-budget.yaml'))
    assert.ok(r.width > 720)
    assert.ok(r.scaled || r.scroll)
  })
})

// --- verify --------------------------------------------------------------

describe('board: verify rows', () => {
  test('a clean render passes every own row and the shared rows, in order, ids 1..17', async () => {
    for (const name of ['board-kanban.yaml', 'board-story.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(p(), ir)
      const result = await verifyFigure(p(), ir, rendered)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.deepEqual(result.checks.map((c) => c.name), [...OWN_ROWS, ...SHARED_ROWS], name)
      assert.deepEqual(result.checks.map((c) => c.id), Array.from({ length: 17 }, (_, i) => i + 1), name)
      assert.deepEqual(result.warnings, [], name)
    }
  })

  test('wip-within-limit and emphasis-count are warn rows carrying the budget key/value', async () => {
    const ir = validIr('board-over-budget.yaml')
    const result = await verifyFigure(p(), ir, await renderFigure(p(), ir))
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    const wip = result.checks.find((c) => c.name === 'wip-within-limit')
    assert.deepEqual([wip.severity, wip.ok, wip.key, wip.value], ['warn', false, 'budget:wip', 1])
    const emph = result.checks.find((c) => c.name === 'emphasis-count')
    assert.deepEqual([emph.severity, emph.ok, emph.key, emph.value], ['warn', false, 'budget:emphasis', 3])
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:columns', 'budget:cards', 'budget:label', 'budget:emphasis', 'budget:wip'])
  })

  test('cards-in-column fails when a card leaves its column, its row, or the lane', async () => {
    const ir = validIr('board-kanban.yaml')
    const shifted = structuredClone(await renderFigure(p(), ir))
    shifted.layout.geo.cards[0].x += 4
    let row = (await verifyFigure(p(), ir, shifted)).checks.find((c) => c.name === 'cards-in-column')
    assert.equal(row.ok, false)
    assert.match(row.detail, /x\/width .* ≠ column "todo"/)

    const lane = structuredClone(await renderFigure(p(), ir))
    const last = lane.layout.geo.cards.find((c) => c.column === 'todo' && c.row === 2)
    last.y += 200; lane.layout.geo.rows[2].y += 200
    row = (await verifyFigure(p(), ir, lane)).checks.find((c) => c.name === 'cards-in-column')
    assert.equal(row.ok, false)
    assert.match(row.detail, /leaves the lane of "todo"/)
  })

  test('cards-no-overlap fails when two cards share space', async () => {
    const ir = validIr('board-kanban.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    const [a, b] = bad.layout.geo.cards
    b.y = a.y; bad.layout.geo.rows[1].y = a.y
    const result = await verifyFigure(p(), ir, bad)
    const row = result.checks.find((c) => c.name === 'cards-no-overlap')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cards\[0\] \("検索の遅延調査"\) overlaps cards\[1\]/)
    assert.equal(result.ok, false)
  })

  test('wip-count-matches fails when a header count or chip disagrees with the cards drawn', async () => {
    const ir = validIr('board-kanban.yaml')
    const count = structuredClone(await renderFigure(p(), ir))
    count.layout.geo.columns[1].count = 5
    let row = (await verifyFigure(p(), ir, count)).checks.find((c) => c.name === 'wip-count-matches')
    assert.equal(row.ok, false)
    assert.match(row.detail, /column "doing" says 5 but 2 card\(s\) are drawn/)

    const chip = structuredClone(await renderFigure(p(), ir))
    chip.layout.geo.columns[1].chip.text = '3/3'
    row = (await verifyFigure(p(), ir, chip)).checks.find((c) => c.name === 'wip-count-matches')
    assert.equal(row.ok, false)
    assert.match(row.detail, /chip reads "3\/3", expected "2\/3"/)

    const flag = structuredClone(await renderFigure(p(), ir))
    flag.layout.geo.columns[1].over = true
    row = (await verifyFigure(p(), ir, flag)).checks.find((c) => c.name === 'wip-count-matches')
    assert.equal(row.ok, false)
    assert.match(row.detail, /over-limit flag is true, expected false/)
  })

  test('cuts-clear fails when a cut line runs through a card, its label sits on one, or it does not span the grid', async () => {
    const ir = validIr('board-story.yaml')
    const through = structuredClone(await renderFigure(p(), ir))
    through.layout.geo.cuts[0].y = through.layout.geo.rows[1].y + 16
    let row = (await verifyFigure(p(), ir, through)).checks.find((c) => c.name === 'cuts-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /crosses cards\[/)

    const label = structuredClone(await renderFigure(p(), ir))
    label.layout.geo.cuts[0].labelY = label.layout.geo.rows[0].y + 20
    row = (await verifyFigure(p(), ir, label)).checks.find((c) => c.name === 'cuts-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /label "MVP" overlaps cards\[/)

    const short = structuredClone(await renderFigure(p(), ir))
    short.layout.geo.cuts[1].x2 -= 40
    row = (await verifyFigure(p(), ir, short)).checks.find((c) => c.name === 'cuts-clear')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cuts\[1\] does not span the grid/)
  })

  test('text-inside-cards fails when a line runs past the card padding or a card has more than two lines', async () => {
    const ir = validIr('board-kanban.yaml')
    const wide = structuredClone(await renderFigure(p(), ir))
    const card = wide.layout.geo.cards[0]
    card.lines[0].x = card.x + card.width - 8
    let row = (await verifyFigure(p(), ir, wide)).checks.find((c) => c.name === 'text-inside-cards')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overflows horizontally/)

    const tall = structuredClone(await renderFigure(p(), ir))
    const c0 = tall.layout.geo.cards[0]
    c0.lines = [c0.lines[0], { ...c0.lines[0], y: c0.lines[0].y + 16 }, { ...c0.lines[0], y: c0.lines[0].y + 32 }]
    row = (await verifyFigure(p(), ir, tall)).checks.find((c) => c.name === 'text-inside-cards')
    assert.equal(row.ok, false)
    assert.match(row.detail, /overflows vertically/)
    assert.match(row.detail, /has 3 lines \(max 2\)/)
  })

  test('shared row grid-4px reads the plugin geometry: an off-grid cut y fails it', async () => {
    const ir = validIr('board-story.yaml')
    const bad = structuredClone(await renderFigure(p(), ir))
    bad.layout.geo.cuts[0].y += 2
    const row = (await verifyFigure(p(), ir, bad)).checks.find((c) => c.name === 'grid-4px')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cuts\[0\]\.y=/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('board: registry dispatch and CLI', () => {
  test('the plugin is registered with its budgets and row names', () => {
    const plug = p()
    assert.ok(plug && !plug.builtin)
    assert.deepEqual(plug.limits, { maxColumns: 6, maxCardsPerColumn: 8, maxLabelLen: 14, maxEmphasis: 2 })
    assert.deepEqual(plug.doc.rows, OWN_ROWS)
  })

  test('renderFigureHtmlChecked() yields a passing board with the IR embedded: accent on the cut line and the one focal card', async () => {
    const raw = fixture('board-story.yaml')
    const rendered = await renderFigureHtmlChecked(validIr('board-story.yaml'), { rawYaml: raw })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="board">/)
    assert.match(rendered.html, /<line id="wu-d-sm1-cut-0" [^>]*stroke="var\(--wu-accent\)"/)
    assert.match(rendered.html, /<text id="wu-d-sm1-cut-0-label" [^>]*text-anchor="end" fill="var\(--wu-accent\)">MVP<\/text>/)
    assert.match(rendered.html, /<rect id="wu-d-sm1-card-setup-1" data-tone="neutral" class="wu-focal"/)
    assert.equal((rendered.html.match(/class="wu-focal"/g) || []).length, 1)
    assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    assert.doesNotMatch(rendered.html, /marker-end/, 'a board never draws arrows')
  })

  test('an over-limit kanban chip is drawn in the accent color as the focal rect, with the count in the header', async () => {
    const rendered = await renderFigureHtmlChecked(validIr('board-kanban-over-wip.yaml'))
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /<rect id="wu-d-kb2-col-doing-chip" class="wu-focal"/)
    assert.match(rendered.html, /<text id="wu-d-kb2-col-doing-chip-text" [^>]*fill="var\(--wu-accent\)">3\/2<\/text>/)
    assert.match(rendered.html, /<text id="wu-d-kb2-col-todo-chip-text" [^>]*fill="currentColor">1<\/text>/)
    assert.match(rendered.html, /data-warn="budget:wip=1"/)
  })

  test('--figure renders board-kanban and board-story as verified figures', () => {
    for (const name of ['board-kanban.yaml', 'board-story.yaml']) {
      const r = runCli([join(FIXTURES, name), '--figure'])
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
      assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="board">/)
      assert.match(r.stdout, /<svg role="img"/)
    }
  })

  test('--json on an over-budget board reports ok:true plus the warnings and data-warn string', () => {
    const r = runCli([join(FIXTURES, 'board-over-budget.yaml'), '--json'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.warn, 'budget:columns=7;budget:cards=9;budget:label=17;budget:emphasis=3;budget:wip=1')
    assert.match(out.figureHtml, /data-warn="budget:columns=7;[^"]*budget:wip=1" data-type="board"/)
  })

  test('--doc board prints the 4-activity story map with one cut and it renders clean', () => {
    const r = runCli(['--doc', 'board'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, plugin.doc.irExample)
    const ir = validateIR(parseYaml(r.stdout))
    assert.equal(ir.ok, true, JSON.stringify(ir))
    assert.equal(ir.ir.variant, 'story-map')
    assert.equal(ir.ir.columns.length, 4)
    assert.deepEqual(ir.ir.cuts, [{ after: 1, label: 'MVP' }])
    assert.deepEqual(ir.warnings, [])
  })
})
