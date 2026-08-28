import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseFrontmatter } from '../bin/lib/migrate/frontmatter.mjs'
import { parseAttrString, splitLabelAndAttrs } from '../bin/lib/migrate/attrs.mjs'
import { parseOldDiagram } from '../bin/lib/migrate/old-diagram.mjs'
import { parseOldSequence, toSequenceIR } from '../bin/lib/migrate/old-sequence.mjs'
import { parseDirectiveTree } from '../bin/lib/migrate/directive-tree.mjs'
import { renderInline, rewritePageLink } from '../bin/lib/migrate/inline.mjs'
import { parseBlocks, renderBlocksHtml } from '../bin/lib/migrate/blocks.mjs'
import { parseDatedFilename, matchesOnly, cssHrefForDepth } from '../bin/lib/migrate/util.mjs'
import { renderBody, isLegacyFile, legacyReasons } from '../bin/lib/migrate/body.mjs'
import { irToYaml } from '../bin/lib/migrate/util.mjs'
import { runMigration } from '../bin/migrate-explain-pages.mjs'
import { parse as parseYamlLite } from '../bin/lib/yaml-lite.mjs'
import { renderDiagram as renderDiagramDirective } from '../bin/lib/migrate/directives.mjs'
import { unescapeIrScript } from '../bin/lib/ir-script.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures', 'migrate')

function tmpDest() {
  return mkdtempSync(join(tmpdir(), 'migrate-test-'))
}

async function migrateOne(basenameGlob, { dryRun = true, dest } = {}) {
  const d = dest ?? tmpDest()
  const { entries } = await runMigration({ src: FIXTURES, dest: d, dryRun, only: basenameGlob, report: null })
  assert.equal(entries.length, 1, `expected exactly one match for ${basenameGlob}`)
  return { entry: entries[0], dest: d }
}

// --- util.mjs ---------------------------------------------------------

test('util: parseDatedFilename extracts date and slug', () => {
  assert.deepEqual(parseDatedFilename('2026-06-10-sdi-api-phase1.md'), { date: '2026-06-10', slug: 'sdi-api-phase1' })
})

test('util: parseDatedFilename falls back when there is no date prefix', () => {
  const r = parseDatedFilename('no-date-name.md')
  assert.equal(r.date, null)
  assert.equal(r.slug, 'no-date-name')
})

test('util: matchesOnly supports a basename glob and a path glob', () => {
  assert.ok(matchesOnly('lk-sdi/sdi-api/2026-06-10-x.md', '*x.md'))
  assert.ok(matchesOnly('lk-sdi/sdi-api/2026-06-10-x.md', 'lk-sdi/**'))
  assert.ok(!matchesOnly('lk-sdi/sdi-api/2026-06-10-x.md', 'onboarding/**'))
  assert.ok(matchesOnly('anything.md', null))
})

test('util: cssHrefForDepth builds the right number of ../ segments', () => {
  assert.equal(cssHrefForDepth(0), './_kit/writeup.css')
  assert.equal(cssHrefForDepth(1), '../_kit/writeup.css')
  assert.equal(cssHrefForDepth(2), '../../_kit/writeup.css')
})

// --- frontmatter.mjs --------------------------------------------------

test('frontmatter: parses title/summary/date/tags', () => {
  const { meta, body } = parseFrontmatter('---\ntitle: T\nsummary: S\ndate: 2026-01-01\ntags: [a, b]\n---\nbody text')
  assert.equal(meta.title, 'T')
  assert.equal(meta.summary, 'S')
  assert.equal(meta.date, '2026-01-01')
  assert.deepEqual(meta.tags, ['a', 'b'])
  assert.equal(body, 'body text')
})

test('frontmatter: tolerates a colon inside a value (real titles contain ": ")', () => {
  const { meta } = parseFrontmatter('---\ntitle: 識別結果の手動修正の設計 (SDI-487 / SDI-486)\nsummary: 案は 3 つ: 詳細は本文\ndate: 2026-01-01\n---\nbody')
  assert.equal(meta.title, '識別結果の手動修正の設計 (SDI-487 / SDI-486)')
  assert.equal(meta.summary, '案は 3 つ: 詳細は本文')
})

test('frontmatter: a file with no frontmatter fence returns the whole text as body', () => {
  const { meta, body } = parseFrontmatter('no frontmatter here')
  assert.deepEqual(meta, {})
  assert.equal(body, 'no frontmatter here')
})

test('frontmatter: empty tags list parses to an empty array', () => {
  const { meta } = parseFrontmatter('---\ntitle: T\ntags: []\n---\nbody')
  assert.deepEqual(meta.tags, [])
})

// --- attrs.mjs ----------------------------------------------------------

test('attrs: parseAttrString splits on commas', () => {
  assert.deepEqual(parseAttrString('id=x, height=860'), { id: 'x', height: '860' })
})

test('attrs: parseAttrString splits on bare whitespace', () => {
  assert.deepEqual(parseAttrString('title="案A" tone=bad'), { title: '案A', tone: 'bad' })
})

test('attrs: splitLabelAndAttrs keeps a colon inside the label', () => {
  const { label, attrs } = splitLabelAndAttrs('案A: 既存ルールを編集: icon=cloud, tone=bad')
  assert.equal(label, '案A: 既存ルールを編集')
  assert.deepEqual(attrs, { icon: 'cloud', tone: 'bad' })
})

test('attrs: bracket-level attrs split on commas only (unquoted spaced values survive)', () => {
  const { label, attrs } = splitLabelAndAttrs('修正画面: icon=monitor, sub=候補 API か SOC 検索で選ぶ')
  assert.equal(label, '修正画面')
  assert.equal(attrs.sub, '候補 API か SOC 検索で選ぶ')
})

// --- old-diagram.mjs ------------------------------------------------------

test('old-diagram: parses zones, nodes, and edges', () => {
  const r = parseOldDiagram('zone z[Z]\n  a[A]\nend\nb[B]\na -> b : "L" {style=primary}')
  assert.equal(r.zones.length, 1)
  assert.equal(r.zones[0].id, 'z')
  assert.equal(r.nodes.length, 2)
  assert.equal(r.nodes[0].zone, 'z')
  assert.equal(r.nodes[1].zone, undefined)
  assert.equal(r.edges.length, 1)
  assert.equal(r.edges[0].label, 'L')
  assert.equal(r.edges[0].style, 'primary')
  assert.equal(r.warnings.length, 0)
})

test('old-diagram: a ref edge and a dashed edge are captured', () => {
  const r = parseOldDiagram('a[A]\nb[B]\na --> b : "x" {ref=true}')
  assert.equal(r.edges[0].dashed, true)
  assert.equal(r.edges[0].ref, true)
})

test('old-diagram: an unrecognized line is a warning, not a throw', () => {
  const r = parseOldDiagram('this is not valid diagram syntax')
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /unrecognized line/)
})

// --- old-sequence.mjs -------------------------------------------------

test('old-sequence: `A -> A: label` becomes an IR self-message', () => {
  const parsed = parseOldSequence(['participant A', 'participant B', 'A -> A: 検証', 'A --> B: 結果'].join('\n'))
  const ir = toSequenceIR(parsed, { id: 'x', title: 't', caption: 'c' })
  assert.deepEqual(ir.messages[0], { self: 'A', label: '検証', kind: 'sync' })
  assert.equal(ir.messages[1].from, 'A')
  assert.equal(ir.messages[1].to, 'B')
  assert.equal(ir.messages[1].kind, 'reply')
})

test('old-sequence: parses participants, a dashed+toned message, and a note', () => {
  const r = parseOldSequence('participant u[User]\nparticipant s[Server]\nu -> s : req\ns --> u : ok {tone=success}\nnote over s : done')
  assert.equal(r.participants.length, 2)
  assert.equal(r.events.length, 3)
  assert.equal(r.events[1].dashed, true)
  assert.equal(r.events[1].tone, 'success')
  assert.equal(r.events[2].kind, 'note')
})

// --- directive-tree.mjs -------------------------------------------------

test('directive-tree: splits plain markdown and a directive apart', () => {
  const nodes = parseDirectiveTree('para one\n\n:::terms\n- **A**: a\n:::\n\npara two')
  assert.equal(nodes.length, 3)
  assert.equal(nodes[0].type, 'md')
  assert.equal(nodes[1].type, 'directive')
  assert.equal(nodes[1].name, 'terms')
  assert.equal(nodes[2].type, 'md')
})

test('directive-tree: compare/col nesting uses one more colon on the outer fence', () => {
  const nodes = parseDirectiveTree('::::compare\n:::col{title=A}\nbody A\n:::\n:::col{title=B}\nbody B\n:::\n::::')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].name, 'compare')
  assert.equal(nodes[0].children.length, 2)
  assert.equal(nodes[0].children[0].attrs.title, 'A')
  assert.equal(nodes[0].children[1].body.trim(), 'body B')
})

// --- inline.mjs -----------------------------------------------------------

test('inline: renders bold, italic, inline code, and a link', () => {
  const html = renderInline('**b** *i* `c` [t](https://x.example/)')
  assert.match(html, /<strong>b<\/strong>/)
  assert.match(html, /<em>i<\/em>/)
  assert.match(html, /<code>c<\/code>/)
  assert.match(html, /<a href="https:\/\/x\.example\/">t<\/a>/)
})

test('inline: rewritePageLink turns a bare .md page link into .html', () => {
  assert.equal(rewritePageLink('2026-06-01-auth-overview.md'), '2026-06-01-auth-overview.html')
  assert.equal(rewritePageLink('2026-06-01-x.md#section'), '2026-06-01-x.html#section')
  assert.equal(rewritePageLink('https://example.com/a.md'), 'https://example.com/a.md')
})

test('inline: HTML-escapes raw text before applying markup', () => {
  assert.equal(renderInline('a < b & c'), 'a &lt; b &amp; c')
})

// --- blocks.mjs -----------------------------------------------------------

test('blocks: parses a heading, a paragraph, a list, a table, code, and a quote', () => {
  const text = '## H\n\npara\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx()\n```\n\n> quoted'
  const blocks = parseBlocks(text)
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'para', 'list', 'table', 'code', 'quote'])
  const html = renderBlocksHtml(blocks)
  assert.match(html, /<h2>H<\/h2>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<table class="wu-table">/)
  assert.match(html, /<pre class="wu-code" data-lang="js">/)
  assert.match(html, /wu-quote/)
})

test('blocks: an ordered list is rendered as <ol>', () => {
  const blocks = parseBlocks('1. first\n2. second')
  assert.equal(blocks[0].type, 'list')
  assert.equal(blocks[0].ordered, true)
  assert.match(renderBlocksHtml(blocks), /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/)
})

// --- body.mjs: legacy detection -----------------------------------------

test('body: isLegacyFile detects aggregate/board/dddboard/html/pr directives', () => {
  assert.ok(isLegacyFile(':::aggregate\nx\n:::'))
  assert.ok(isLegacyFile(':::board{id=x}\n:::'))
  assert.ok(isLegacyFile(':::dddboard\n:::'))
  assert.ok(isLegacyFile(':::html\n<div></div>\n:::'))
  assert.ok(isLegacyFile(':::pr{number=1}\n:::'))
  assert.ok(!isLegacyFile(':::terms\n- **a**: b\n:::'))
})

test('body: legacyReasons lists which legacy directive(s) triggered', () => {
  assert.deepEqual(legacyReasons(':::aggregate\nx\n:::\n:::pr{number=1}\n:::'), ['aggregate', 'pr'])
})

test('body: renderBody groups content under h2 sections and counts directives', async () => {
  const { sectionsHtml, directiveCounts } = await renderBody('intro\n\n## S1\n\n:::terms\n- **A**: a\n:::\n\n## S2\n\npara')
  assert.equal(directiveCounts.terms, 1)
  assert.match(sectionsHtml, /<section class="wu-section">\n<p>intro<\/p>\n<\/section>/)
  assert.match(sectionsHtml, /<h2>S1<\/h2>/)
  assert.match(sectionsHtml, /<h2>S2<\/h2>/)
})

// --- end-to-end via runMigration (dry-run: never touches --dest) --------

test('e2e: terms directive becomes a dl.wu-terms with dt/dd pairs', async () => {
  const { entry } = await migrateOne('2026-01-01-terms.md')
  assert.equal(entry.directives.terms, 1)
  assert.equal(entry.legacy, false)
})

test('e2e: steps directive becomes an ol.wu-steps (written page contains three <li>)', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-02-steps.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.equal((html.match(/<li>/g) || []).length, 3)
  assert.match(html, /class="wu-steps"/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: cells directive is converted to a wu-table', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-03-cells.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.equal(entry.directives.cells, 1)
  assert.match(html, /class="wu-table"/)
  assert.match(html, /境界の前後で 200 件が通過する/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: scorebars directive is converted to a wu-table with one column per axis', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-04-scorebars.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<th>コスト<\/th><th>レイテンシ<\/th>/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: diff directive becomes a pre.wu-diff with data-lang="diff"', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-05-diff.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<pre class="wu-diff" data-lang="diff">/)
  assert.match(html, /-old\(\)/)
  assert.match(html, /\+new\(\)/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: info/warning/danger/success map to wu-callout with note/warn tones', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-06-callouts.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.equal(entry.directives.info, 1)
  assert.equal(entry.directives.warning, 1)
  assert.equal(entry.directives.danger, 1)
  assert.equal(entry.directives.success, 1)
  const toneCounts = [...html.matchAll(/data-tone="(note|warn)"/g)].reduce((acc, m) => {
    acc[m[1]] = (acc[m[1]] ?? 0) + 1
    return acc
  }, {})
  assert.equal(toneCounts.note, 2) // info, success
  assert.equal(toneCounts.warn, 2) // warning, danger
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: compare directive becomes a wu-compare table with one column per col', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-07-compare.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<table class="wu-compare">/)
  assert.match(html, /<th>案A<\/th><th>案B<\/th>/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: a small diagram renders and passes verification (figures.ok)', async () => {
  const { entry } = await migrateOne('2026-01-08-diagram-simple.md')
  assert.equal(entry.figures.ok, 1)
  assert.equal(entry.figures.fallback, 0)
})

test('e2e: a 12-node diagram is over the node budget (guidance only) but renders, passes, and carries data-warn', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-09-diagram-fallback.md', { dryRun: false, dest })
  assert.equal(entry.figures.ok, 1)
  assert.equal(entry.figures.fallback, 0)
  assert.ok(entry.warnings.some((w) => /budget warning — budget:nodes=12/.test(w)))
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=12">/)
  assert.ok(!html.includes('図は変換時に合格せず、表で代替'))
  assert.match(html, /diagram=1\/1/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: a K3,3 diagram fails geometry (unrelated crossing) and falls back to a table', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-15-diagram-geometry-fallback.md', { dryRun: false, dest })
  assert.equal(entry.figures.ok, 0)
  assert.equal(entry.figures.fallback, 1)
  assert.ok(entry.warnings.some((w) => /verification failed \(.*unrelated-crossing/.test(w)))
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /図は変換時に合格せず、表で代替/)
  assert.match(html, /class="wu-callout" data-tone="warn"/)
  assert.ok(!html.includes('data-warn'))
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: a fallback figure embeds the candidate IR as YAML and round-trips through yaml-lite.mjs', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-15-diagram-geometry-fallback.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  const scriptMatch = /<figure class="wu-figure">[\s\S]*?<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>\n<\/figure>/.exec(html)
  assert.ok(scriptMatch, 'fallback figure should carry a text/x-writeup-diagram script block')
  const yaml = scriptMatch[1]
  const parsed = parseYamlLite(yaml)
  assert.equal(parsed.id, 'd1') // this fixture's only diagram, so nextDiagramId assigns "d1"
  assert.equal(parsed.nodes.length, 6)
  assert.equal(parsed.edges.length, 9)
  assert.equal(parsed.edges[0].from, 'l0')
  assert.equal(parsed.edges[0].to, 'r0')
  // the callout carries the failing check name/hint (here: the crossing row)
  assert.match(html, /図は変換時に合格せず、表で代替 \(verification: [^)]*unrelated-crossing[^)]*\)/)
  rmSync(dest, { recursive: true, force: true })
})

test('directive: a fallback figure with a hostile label/caption escapes the embedded script and round-trips through the reader', async () => {
  // K3,3 (non-planar, so an unrelated-edge crossing is unavoidable) forces
  // the geometry-failure fallback path that embeds the candidate IR via
  // fallbackFigureHtml(). Budgets alone no longer do — they are guidance.
  const body = [
    'n1[<img src=x onerror=alert(1)>]',
    'n2[ノード2]', 'n3[ノード3]', 'n4[ノード4]', 'n5[ノード5]', 'n6[ノード6]',
    ...['n1', 'n2', 'n3'].flatMap((l) => ['n4', 'n5', 'n6'].map((r) => `${l} -> ${r}`)),
  ].join('\n')
  const ctx = { nextDiagramId: () => 'd1', sectionTitle: '</script><script>alert(1)</script>', column: 720 }
  const { html, figureOk } = await renderDiagramDirective({ body, attrs: {} }, ctx)
  assert.equal(figureOk, false)
  assert.ok(!html.includes('<img src=x'), 'raw <img must not appear in the html')
  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'raw </script> break-out must not appear inside the figure')
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))

  const scriptMatch = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(html)
  assert.ok(scriptMatch, 'fallback figure should carry a text/x-writeup-diagram script block')
  const parsed = parseYamlLite(unescapeIrScript(scriptMatch[1]))
  assert.equal(parsed.nodes[0].label, '<img src=x onerror=alert(1)>')
})

test('util: irToYaml round-trips a label containing ": " by quoting it', () => {
  const ir = {
    id: 'd1',
    title: 'A: push を含むタイトル',
    caption: 'キャプション',
    nodes: [{ id: 'a', label: 'A: push' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', kind: 'sync', label: 'x: y' }],
  }
  const yaml = irToYaml(ir)
  const parsed = parseYamlLite(yaml)
  assert.equal(parsed.title, 'A: push を含むタイトル')
  assert.equal(parsed.nodes[0].label, 'A: push')
  assert.equal(parsed.edges[0].label, 'x: y')
})

test('e2e: sequence directive renders a wu-figure sequence diagram when it fits the budget', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-10-sequence.md', { dryRun: false, dest })
  assert.equal(entry.sequenceAsSteps, 0)
  assert.equal(entry.figures.ok, 1)
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<figure class="wu-figure" data-checks="pass" data-type="sequence">/)
  assert.match(html, /<script type="text\/x-writeup-diagram">/)
  assert.ok(!html.includes('class="wu-steps"'), 'a figure that fits the budget should not fall back to a steps list')
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: a sequence directive over budget still renders (guidance only), carries data-warn, and logs the warning', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-17-sequence-overflow.md', { dryRun: false, dest })
  assert.equal(entry.sequenceAsSteps, 0)
  assert.equal(entry.figures.ok, 1)
  assert.equal(entry.figures.fallback, 0)
  assert.ok(entry.warnings.some((w) => w.includes('budget:messages=17')), JSON.stringify(entry.warnings))
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<figure class="wu-figure" data-checks="pass" data-warn="budget:messages=17" data-type="sequence">/)
  assert.ok(!html.includes('class="wu-steps"'))
  assert.match(html, /<script type="text\/x-writeup-diagram">/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: aggregate directive marks the whole file legacy and freezes the .md', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-11-legacy-aggregate.md', { dryRun: false, dest })
  assert.equal(entry.legacy, true)
  assert.match(entry.dest, /^legacy\//)
  assert.ok(existsSync(join(dest, 'legacy', '2026-01-11-legacy-aggregate.md')))
  assert.ok(existsSync(join(dest, entry.dest)))
  const original = readFileSync(join(FIXTURES, '2026-01-11-legacy-aggregate.md'), 'utf8')
  const frozen = readFileSync(join(dest, 'legacy', '2026-01-11-legacy-aggregate.md'), 'utf8')
  assert.equal(frozen, original)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: board directive also marks the file legacy', async () => {
  const { entry } = await migrateOne('2026-01-12-legacy-board.md')
  assert.equal(entry.legacy, true)
})

test('e2e: extra frontmatter keys become x-legacy-<key> meta tags', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-13-frontmatter-extra.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<meta name="x-legacy-custom_field" content="カスタム値">/)
  assert.match(html, /<meta name="x-legacy-tags" content="alpha, beta">/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: paragraphs/lists/tables/code/quotes/links all convert (dry-run does not touch --dest)', async () => {
  const dest = tmpDest()
  const before = existsSync(dest)
  const { entry } = await migrateOne('2026-01-14-inline-and-blocks.md', { dryRun: true, dest })
  assert.equal(entry.legacy, false)
  // dry-run: nothing should have been written under dest
  const wrote = existsSync(join(dest, entry.dest))
  assert.equal(wrote, false)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: internal .md links are rewritten to .html in the rendered page', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('2026-01-14-inline-and-blocks.md', { dryRun: false, dest })
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<a href="2026-01-01-terms\.html">別ページ<\/a>/)
  assert.match(html, /<a href="https:\/\/example\.com">外部<\/a>/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: filename without a date prefix falls back to the frontmatter date', async () => {
  const dest = tmpDest()
  const { entry } = await migrateOne('no-date-name.md', { dryRun: false, dest })
  assert.equal(entry.dest, '2026-01-15-no-date-name.html')
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: _project.md is excluded from conversion entirely', async () => {
  const dest = tmpDest()
  const { entries } = await runMigration({ src: FIXTURES, dest, dryRun: true, only: '_project.md', report: null })
  assert.equal(entries.length, 0)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: a page in a nested folder links ../../_kit/writeup.css (folder depth = 2 incl. sub/)', async () => {
  // fixtures/migrate/sub/2026-01-16-nested.md -> depth 1 folder ("sub")
  const dest = tmpDest()
  const { entry } = await migrateOne('sub/2026-01-16-nested.md', { dryRun: false, dest })
  assert.equal(entry.dest, 'sub/2026-01-16-nested.html')
  const html = readFileSync(join(dest, entry.dest), 'utf8')
  assert.match(html, /<link rel="stylesheet" href="\.\.\/_kit\/writeup\.css">/)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: report totals equal the sum of per-file entries across the whole fixture set', async () => {
  const dest = tmpDest()
  const { entries, totals } = await runMigration({ src: FIXTURES, dest, dryRun: true, only: null, report: null })
  // _project.md excluded; everything else (13 convertible + 2 legacy + nested + no-date) included
  assert.ok(entries.length >= 15, `expected at least 15 converted files, got ${entries.length}`)
  const sumOk = entries.reduce((n, e) => n + e.figures.ok, 0)
  const sumFallback = entries.reduce((n, e) => n + e.figures.fallback, 0)
  assert.equal(totals.figures.ok, sumOk)
  assert.equal(totals.figures.fallback, sumFallback)
  assert.equal(totals.legacy, entries.filter((e) => e.legacy).length)
  const sumSeq = entries.reduce((n, e) => n + e.sequenceAsSteps, 0)
  assert.equal(totals.sequenceAsSteps, sumSeq)
  rmSync(dest, { recursive: true, force: true })
})

test('e2e: --only filters by a basename glob', async () => {
  const dest = tmpDest()
  const { entries } = await runMigration({ src: FIXTURES, dest, dryRun: true, only: '*callouts*', report: null })
  assert.equal(entries.length, 1)
  rmSync(dest, { recursive: true, force: true })
})
