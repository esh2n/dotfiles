// `.wu-cells` — the parser, the old-tone → kit-tone map, the accent budget,
// the shared width scale, and the HTML the migration emits.
//
// Every shape asserted here was taken from the 119 real `:::cells` blocks in
// the 81 explain-pages source files, so the cases are the corpus's, not
// invented ones: label=value cells, `_` placeholders, both suffix orders,
// spans up to 999, a `row` with no label, notes carrying a tone, and blocks
// that paint a whole band `@accent`.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCell, parseCells, parseNote, mapTone, cellsHtml, rowSpan,
  TONE_MAP, CELL_TONES,
} from '../bin/lib/cells.mjs'
import { renderCells } from '../bin/lib/migrate/directives.mjs'
import { convertToMarkdown } from '../bin/to-md.mjs'

const html = (body, attrs = {}) => renderCells(body, attrs).html
const warnings = (body, attrs = {}) => renderCells(body, attrs).warnings

// --- the cell grammar ------------------------------------------------------

test('parseCell: bare text carries no tone, no count, no value', () => {
  const c = parseCell('リクエスト時')
  assert.equal(c.text, 'リクエスト時')
  assert.equal(c.oldTone, undefined)
  assert.equal(c.count, undefined)
  assert.equal(c.span, undefined)
  assert.equal(c.value, undefined)
  assert.equal(c.empty, false)
  assert.equal(c.showCount, false)
})

test('parseCell: `@tone` is stripped from the text and reported', () => {
  // engineering/dev-flow/2026-06-12-branching-strategy.md
  const c = parseCell(' 乖離が蓄積@danger ')
  assert.equal(c.text, '乖離が蓄積')
  assert.equal(c.oldTone, 'danger')
})

test('parseCell: `text@tone*N` is a width — the ×N chip stays off', () => {
  // engineering/frontend/2026-06-12-network-loading.md — 3 units of parsing
  const c = parseCell('パース@accent*3')
  assert.equal(c.text, 'パース')
  assert.equal(c.oldTone, 'accent')
  assert.equal(c.count, 3)
  assert.equal(c.span, 3)
  assert.equal(c.showCount, false)
})

test('parseCell: `text*N@tone` is a count — the ×N chip is shown', () => {
  // engineering/dev-flow/2026-06-12-kanban.md — 6 items in progress
  const c = parseCell('進行中*6@attention')
  assert.equal(c.text, '進行中')
  assert.equal(c.oldTone, 'attention')
  assert.equal(c.count, 6)
  assert.equal(c.showCount, true)
})

test('parseCell: `text*N` with no tone counts as the count spelling, even at N=1', () => {
  // engineering/dev-flow/2026-06-12-pair-mob-programming.md — driver ×1
  const c = parseCell('レビュー*1')
  assert.equal(c.count, 1)
  assert.equal(c.span, undefined, 'a span of 1 needs no data-count')
  assert.equal(c.showCount, true)
})

test('parseCell: `_` is an empty spacer, with or without a suffix', () => {
  assert.deepEqual(
    ['_', '_*6', '_@muted', '_*3'].map((s) => {
      const c = parseCell(s)
      return [c.empty, c.text, c.span, c.showCount]
    }),
    [[true, '', undefined, false], [true, '', 6, false], [true, '', undefined, false], [true, '', 3, false]],
  )
})

test('parseCell: `label=value` splits only when nothing touches the `=`', () => {
  // engineering/dev-flow/2026-06-12-semver-release.md vs the prose form in
  // engineering/backend/a-network/2026-06-11-grpc.md
  const split = parseCell('MAJOR=1@danger')
  assert.equal(split.label, 'MAJOR')
  assert.equal(split.value, '1')
  const prose = parseCell('QNAME = ラベル形式 13 バイト@accent*13')
  assert.equal(prose.value, undefined)
  assert.equal(prose.label, 'QNAME = ラベル形式 13 バイト')
})

test('parseCell: a 999-wide cell keeps its exact span', () => {
  // engineering/dev-flow/2026-06-12-sre.md — the SLO error budget
  assert.equal(parseCell('99.9%@success*999').span, 999)
  assert.equal(parseCell('0.1%@danger*1').span, undefined)
})

// --- notes -----------------------------------------------------------------

test('parseNote: a trailing @tone is stripped, the prose is kept', () => {
  const n = parseNote('フラグが1つ増えるごとに経路は2倍になる @danger')
  assert.equal(n.text, 'フラグが1つ増えるごとに経路は2倍になる')
  assert.equal(n.oldTone, 'danger')
})

test('parseNote: a note without a tone is left alone', () => {
  const n = parseNote('下の層ほど 速く・安定し・原因特定が容易')
  assert.equal(n.text, '下の層ほど 速く・安定し・原因特定が容易')
  assert.equal(n.oldTone, undefined)
})

test('a note carrying inline code renders the code, and drops the tone', () => {
  const out = html('row 同期 | パース@accent*3\nnote `<script>` の取得と実行の間 パースが止まる @danger')
  assert.match(out, /<p class="wu-cells-note"><code>&lt;script&gt;<\/code> の取得と実行の間 パースが止まる<\/p>/)
  assert.doesNotMatch(out, /wu-cells-note[^>]*data-tone/)
})

// --- tone mapping ----------------------------------------------------------

test('mapTone: every old tone in the corpus lands on a kit tone', () => {
  assert.deepEqual(
    ['accent', 'primary', 'danger', 'attention', 'warning', 'success', 'default', 'muted'].map((t) => mapTone(t)),
    ['key', 'key', 'strong', 'base', 'base', 'soft', 'base', 'ghost'],
  )
  for (const t of Object.values(TONE_MAP)) assert.ok(CELL_TONES.includes(t), `${t} is not a kit tone`)
})

test('mapTone: no tone falls back to base, and an empty cell is always ghost', () => {
  assert.equal(mapTone(undefined), 'base')
  assert.equal(mapTone('accent', { empty: true }), 'ghost')
  assert.equal(mapTone(undefined, { empty: true }), 'ghost')
})

test('an unknown tone falls back to base and is reported', () => {
  const r = renderCells('row a | b@chartreuse', {})
  assert.match(r.html, /data-tone="base"/)
  assert.deepEqual(r.warnings, ['cells: unknown tone "@chartreuse" mapped to base'])
})

test('the accent budget is one cell per strip; a whole accent band is demoted', () => {
  // engineering/dev-flow/2026-06-12-ci-cd.md paints 9 cells @accent
  const one = renderCells('row 1.4.2 | MAJOR=1@danger | MINOR=4@accent | PATCH=2@success', {})
  assert.equal((one.html.match(/data-tone="key"/g) || []).length, 1)
  assert.deepEqual(one.warnings, [])

  const many = renderCells('row CI | 統合@accent | ビルド@accent | テスト@accent | 手動@muted', {})
  assert.equal((many.html.match(/data-tone="key"/g) || []).length, 0)
  assert.equal((many.html.match(/data-tone="strong"/g) || []).length, 3, 'the band keeps its contrast one step down')
  assert.deepEqual(many.warnings, ['cells: 3 accent cells in one strip — demoted to the neutral scale (accent budget: 1)'])
})

// --- rows, labels, notes ---------------------------------------------------

test('a row without a label still gets the alignment gutter when other rows have one', () => {
  // engineering/dev-flow/2026-06-12-tech-debt.md — the quadrant's header row
  const out = html('row 慎重 | 期日のため今は出荷@success\nrow | 意図的 | 不注意')
  assert.match(out, /<span class="wu-cells-label">慎重<\/span>/)
  assert.match(out, /<span class="wu-cells-label"><\/span><span class="wu-cell"/)
})

test('a block where no row has a label emits no label gutter at all', () => {
  const out = html('row | 意図的 | 不注意')
  assert.doesNotMatch(out, /wu-cells-label/)
})

test('notes keep their source position between rows', () => {
  // engineering/dev-flow/2026-06-12-kanban-vs-scrum.md interleaves them
  const out = html('row スクラム | A@accent\nnote 固定長の期間で区切る\nrow カンバン | B@success\nnote 1 件ずつ流れる')
  const order = [...out.matchAll(/class="(wu-cells-row|wu-cells-note)"/g)].map((m) => m[1])
  assert.deepEqual(order, ['wu-cells-row', 'wu-cells-note', 'wu-cells-row', 'wu-cells-note'])
})

test('an unrecognized line is skipped and reported', () => {
  const r = renderCells('row a | b\ncol nope', {})
  assert.deepEqual(r.warnings, ['cells: unrecognized line skipped: col nope'])
  assert.equal((r.html.match(/wu-cells-row/g) || []).length, 1)
})

test('an unsupported directive attribute is reported, title is not', () => {
  assert.deepEqual(warnings('row a | b', { title: 't' }), [])
  assert.deepEqual(warnings('row a | b', { title: 't', age: '3' }), ['cells: unsupported attribute ignored: age'])
})

// --- the shared width scale ------------------------------------------------

test('rowSpan: a cell with no count weighs 1', () => {
  const { items } = parseCells('row x | a | b@accent*3 | _*2')
  assert.equal(rowSpan(items[0]), 6)
})

test('rows of one block share a width scale — a short row is padded with a filler', () => {
  // engineering/dev-flow/2026-06-12-test-strategy.md: 6 / 3 / 1, one cell per
  // row. Without the filler each row would stretch to full width and the
  // whole point of the block (the 6:3:1 ratio) would be lost.
  const out = html('row 単体 | 多い@success*6\nrow 結合 | 中くらい@accent*3\nrow E2E | 少ない@attention*1')
  const fills = [...out.matchAll(/data-fill="1" data-count="(\d+)"/g)].map((m) => Number(m[1]))
  assert.deepEqual(fills, [3, 5])
  assert.equal((out.match(/data-fill="1"[^>]*><\/span>/g) || []).length, 2, 'the filler carries no content')
})

test('the widest row gets no filler and rows that already match get none either', () => {
  const out = html('row a | x@accent*2 | y\nrow b | z@success*3')
  assert.equal((out.match(/data-fill/g) || []).length, 0)
})

test('a span above the stylesheet range also rides on an inline custom property', () => {
  const out = html('row 成功 | 99.9%@success*999\nrow 失敗 | 0.1%@danger*1')
  assert.match(out, /data-count="999" style="--wu-cell-span:999"/)
  assert.match(out, /data-fill="1" data-count="998" aria-hidden="true" style="--wu-cell-span:998"/)
  assert.doesNotMatch(out, /data-count="3"[^>]*style=/, 'small spans stay in the stylesheet')
})

// --- markup contract -------------------------------------------------------

test('the emitted markup uses only the documented classes and tags', () => {
  const out = html('row 1.4.2 | MAJOR=1@danger | 進行中*6@accent | _*2', { title: 'タイトル' })
  const classes = new Set([...out.matchAll(/class="([^"]+)"/g)].map((m) => m[1]))
  assert.deepEqual([...classes].sort(), [
    'wu-cell', 'wu-cell-count', 'wu-cell-label', 'wu-cell-value',
    'wu-cells', 'wu-cells-label', 'wu-cells-row', 'wu-cells-title',
  ])
  const tags = new Set([...out.matchAll(/<([a-z]+)[ >]/g)].map((m) => m[1]))
  assert.deepEqual([...tags].sort(), ['div', 'p', 'span'])
  assert.match(out, /<span class="wu-cell-label">MAJOR<\/span><span class="wu-cell-value">1<\/span>/)
  assert.match(out, /<span class="wu-cell-count">×6<\/span>/)
})

test('every data-tone written is one of the five kit tones', () => {
  const out = html([
    'row a | x@accent | y@danger | z@attention',
    'row b | p@success | q@muted | _',
  ].join('\n'))
  const tones = [...out.matchAll(/data-tone="([^"]+)"/g)].map((m) => m[1])
  assert.ok(tones.length > 0)
  for (const t of tones) assert.ok(CELL_TONES.includes(t), `unexpected tone ${t}`)
})

// --- escaping --------------------------------------------------------------

test('HTML in a cell, a label, a title and a note is escaped, not injected', () => {
  const out = html('row <b>ラベル</b> | <img src=x onerror=1>@danger\nnote "5 < 6" & <script>', { title: '<i>t</i>' })
  assert.doesNotMatch(out, /<script>/)
  assert.doesNotMatch(out, /<img/)
  assert.doesNotMatch(out, /<b>ラベル<\/b>/)
  assert.match(out, /&lt;img src=x onerror=1&gt;/)
  assert.match(out, /"5 &lt; 6" &amp; &lt;script&gt;/)
  assert.match(out, /&lt;i&gt;t&lt;\/i&gt;/)
})

test('a double quote in a cell stays in text and never reaches an attribute', () => {
  // every attribute .wu-cells writes (data-tone / data-count / data-fill /
  // style) is built from parsed numbers and the fixed tone set, never from
  // source text, so a quote in the text has no attribute to break out of.
  const out = html('row a | b" data-tone="key')
  assert.equal((out.match(/data-tone="key"/g) || []).length, 0)
  assert.match(out, /<span class="wu-cell" data-tone="base">b" data-tone="key<\/span>/)
})

// --- determinism -----------------------------------------------------------

test('the same source renders byte-identical HTML every time', () => {
  const src = [
    ':::body',
    'row 制限なし | 進行中*6@attention | レビュー*1 | 完了*1',
    'note 全部が中途半端なまま進む @danger',
    'row 制限あり | 進行中*2@accent | レビュー*2@accent | 完了*4@success',
    'row | 意図的 | _*3',
  ].slice(1).join('\n')
  const runs = Array.from({ length: 5 }, () => renderCells(src, { title: 'WIP' }))
  for (const r of runs) {
    assert.equal(r.html, runs[0].html)
    assert.deepEqual(r.warnings, runs[0].warnings)
  }
})

test('parseCells does not mutate its input and reports the same result twice', () => {
  const src = 'row a | x@accent*2 | _\nnote n @muted'
  const frozen = String(src)
  const a = parseCells(src)
  const b = parseCells(src)
  assert.equal(src, frozen)
  assert.deepEqual(a, b)
})

// --- full shapes from the corpus -------------------------------------------

test('the semver block round-trips into the documented markup', () => {
  const out = html('row 1.4.2 | MAJOR=1@danger | MINOR=4@accent | PATCH=2@success\nnote MAJOR は後方互換を壊す変更', { title: '3 つの桁' })
  assert.equal(out, [
    '<div class="wu-cells">',
    '<p class="wu-cells-title">3 つの桁</p>',
    '<div class="wu-cells-row"><span class="wu-cells-label">1.4.2</span>'
      + '<span class="wu-cell" data-tone="strong"><span class="wu-cell-label">MAJOR</span><span class="wu-cell-value">1</span></span>'
      + '<span class="wu-cell" data-tone="key"><span class="wu-cell-label">MINOR</span><span class="wu-cell-value">4</span></span>'
      + '<span class="wu-cell" data-tone="soft"><span class="wu-cell-label">PATCH</span><span class="wu-cell-value">2</span></span></div>',
    '<p class="wu-cells-note">MAJOR は後方互換を壊す変更</p>',
    '</div>',
  ].join('\n'))
})

test('the preload block keeps its leading blank span and its offsets', () => {
  const out = html('row preload | HTML 取得@accent*3 | _*6\nrow 並行 | _ | CSS 取得@success*3 | フォント取得@success*3')
  assert.match(out, /<span class="wu-cell" data-tone="ghost" data-count="6"><\/span>/)
  assert.match(out, /<span class="wu-cell" data-tone="ghost"><\/span><span class="wu-cell" data-tone="soft" data-count="3">CSS 取得<\/span>/)
  assert.match(out, /data-fill="1" data-count="2"/)
})

test('an empty body produces an empty component rather than throwing', () => {
  const r = renderCells('', {})
  assert.equal(r.html, '<div class="wu-cells">\n</div>')
  assert.deepEqual(r.warnings, [])
})

// --- Markdown convertibility ----------------------------------------------

test('cellsHtml escapes by default when no inline renderer is supplied', () => {
  const parsed = parseCells('row <a> | <b>@danger')
  const out = cellsHtml(parsed, { title: '<t>' })
  assert.match(out, /&lt;t&gt;/)
  assert.match(out, /&lt;a&gt;/)
  assert.match(out, /&lt;b&gt;/)
})

/** Wraps a `.wu-cells` strip in the minimum page to-md accepts. */
function toMarkdown(strip) {
  const page = `<!doctype html><html><head><title>t</title>`
    + `<meta name="kind" content="設計"><meta name="date" content="2026-01-01">`
    + `</head><body><div class="wu-page"><main>${strip}</main></div></body></html>`
  return convertToMarkdown(page, { slug: 'p', figuresDir: '/tmp', figuresDirRel: 'f' })
}

test('to-md: a strip becomes one list item per row, with the title and notes kept', () => {
  const md = toMarkdown(html('row 1.4.2 | MAJOR=1@danger | MINOR=4@accent\nnote 桁の意味', { title: '3 つの桁' }))
  assert.match(md, /\*\*3 つの桁\*\*/)
  assert.match(md, /- \*\*1\.4\.2\*\* — MAJOR 1 \/ MINOR 4/)
  assert.match(md, /^桁の意味$/m)
  assert.doesNotMatch(md, /writeup: unmapped/)
})

test('to-md: the ×N chip keeps a space, and the structural filler contributes nothing', () => {
  const md = toMarkdown(html('row 制限なし | 進行中*6@attention | 完了*1\nrow 制限あり | 進行中*2@accent'))
  assert.match(md, /- \*\*制限なし\*\* — 進行中 ×6 \/ 完了 ×1/)
  assert.match(md, /- \*\*制限あり\*\* — 進行中 ×2$/m)
})
