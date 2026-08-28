import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  listStorePages, findFigureBlocks, figureChecksPass, figureIrText,
  rerenderOne, rerenderPageText, updateDiagramMeta, rerenderStore, parseArgs, main,
} from '../bin/rerender-figures.mjs'
import { escapeIrScript } from '../bin/lib/ir-script.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURES = join(HERE, 'fixtures')
const BIN = join(ROOT, 'bin', 'rerender-figures.mjs')

const SIMPLE_YAML = readFileSync(join(FIXTURES, 'simple.yaml'), 'utf8')
// 11 nodes: over the node budget (guidance only) but geometrically clean —
// re-renders fine, passes, and carries data-warn="budget:nodes=11".
const BUDGET_YAML = readFileSync(join(FIXTURES, 'budget.yaml'), 'utf8')
// K3,3 — within every budget but non-planar, so an unrelated-edge crossing
// is unavoidable: the genuine "still fails verification" case.
const FAILING_YAML = [
  'id: k33', 'title: t', 'nodes:',
  '- id: l0\n  label: L0', '- id: l1\n  label: L1', '- id: l2\n  label: L2',
  '- id: r0\n  label: R0', '- id: r1\n  label: R1', '- id: r2\n  label: R2',
  'edges:',
  ...['l0', 'l1', 'l2'].flatMap((l) => ['r0', 'r1', 'r2'].map((r) => `- from: ${l}\n  to: ${r}\n  kind: sync`)),
].join('\n') + '\n'
// A label carrying a hostile HTML fragment, to exercise the ir-script.mjs
// escaping contract end-to-end (a store page can hold either the escaped
// form a current writer produces, or legacy raw text from before the
// contract existed). Kept short so it doesn't change the node's rendered
// width enough to trip an unrelated layout-geometry check.
const DANGEROUS_YAML = SIMPLE_YAML.replace('label: クライアント', 'label: "<b>x</b>"')

const HEAD = '<!doctype html>\n<html><head><title>t</title>\n<meta name="checks" content="self-check=pass">\n</head><body><main>\n'
const TAIL = '\n</main></body></html>\n'

/** A fallback-shaped figure (table + warn callout), not yet re-rendered:
 * has an embedded script but no data-checks="pass" — exactly the shape
 * bin/lib/migrate/directives.mjs's fallbackFigureHtml() now produces. */
function fallbackFigure(irText) {
  return [
    '<figure class="wu-figure">',
    '<table class="wu-table"><thead><tr><th>種別</th><th>詳細</th></tr></thead><tbody><tr><td>node</td><td>x</td></tr></tbody></table>',
    '<figcaption>古いキャプション</figcaption>',
    `<script type="text/x-writeup-diagram">\n${irText}\n</script>`,
    '</figure>',
    '<div class="wu-callout" data-tone="warn"><p>図は変換時に合格せず、表で代替 (verification)</p></div>',
  ].join('\n')
}

/** A figure already marked as passing (attribute order deliberately
 * shuffled — data-checks before class — to exercise attribute-order
 * robustness), carrying a valid script so --all can still re-render it. */
function passingFigure(irText) {
  return [
    '<figure data-checks="pass" class="wu-figure">',
    '<svg role="img"><title>t</title><desc>d</desc></svg>',
    '<figcaption>古いキャプション</figcaption>',
    `<script type="text/x-writeup-diagram">\n${irText}\n</script>`,
    '</figure>',
  ].join('\n')
}

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wu-rerender-'))
  writeFileSync(join(dir, 'page-a.html'), HEAD + fallbackFigure(SIMPLE_YAML) + TAIL)
  writeFileSync(join(dir, 'page-b.html'), HEAD + fallbackFigure(FAILING_YAML) + TAIL)
  writeFileSync(join(dir, 'page-c.html'), HEAD + passingFigure(SIMPLE_YAML) + TAIL)
  writeFileSync(join(dir, 'page-d.html'), HEAD + fallbackFigure(BUDGET_YAML) + TAIL)
  // excluded locations: must never be touched or even scanned
  mkdirSync(join(dir, '_kit'))
  writeFileSync(join(dir, '_kit', 'ignored.html'), HEAD + fallbackFigure(SIMPLE_YAML) + TAIL)
  mkdirSync(join(dir, 'legacy'))
  writeFileSync(join(dir, 'legacy', 'old.html'), HEAD + fallbackFigure(SIMPLE_YAML) + TAIL)
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}

describe('rerender-figures: raw scanning helpers', () => {
  test('findFigureBlocks finds a figure regardless of attribute order', () => {
    const raw = HEAD + passingFigure(SIMPLE_YAML) + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(blocks.length, 1)
    assert.ok(figureChecksPass(blocks[0]))
  })

  test('figureChecksPass is false when data-checks="pass" is absent', () => {
    const raw = HEAD + fallbackFigure(SIMPLE_YAML) + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(figureChecksPass(blocks[0]), false)
  })

  test('figureIrText extracts and un-wraps the embedded script text', () => {
    const raw = HEAD + fallbackFigure(SIMPLE_YAML) + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(figureIrText(blocks[0]), SIMPLE_YAML)
  })

  test('figureIrText returns null when there is no diagram script', () => {
    const raw = HEAD + '<figure class="wu-figure"><p>no script here</p></figure>' + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(figureIrText(blocks[0]), null)
  })

  test('figureIrText unescapes an escaped script back to the original raw IR text', () => {
    const raw = HEAD + fallbackFigure(escapeIrScript(DANGEROUS_YAML)) + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(figureIrText(blocks[0]), DANGEROUS_YAML)
  })

  test('figureIrText leaves legacy unescaped raw text unchanged (pre-contract pages)', () => {
    const raw = HEAD + fallbackFigure(DANGEROUS_YAML) + TAIL
    const blocks = findFigureBlocks(raw)
    assert.equal(figureIrText(blocks[0]), DANGEROUS_YAML)
  })

  test('listStorePages excludes _kit/, public/, .publish/, legacy/, and the store-root index.html', () => {
    const store = tmpStore()
    const pages = listStorePages(store)
    assert.deepEqual(pages, ['page-a.html', 'page-b.html', 'page-c.html', 'page-d.html'])
    rmSync(store, { recursive: true, force: true })
  })
})

describe('rerender-figures: updateDiagramMeta', () => {
  test('inserts a fresh diagram=ok/total pair alongside an existing self-check pair', () => {
    const raw = '<meta name="checks" content="self-check=pass">'
    const out = updateDiagramMeta(raw, 2, 3)
    assert.match(out, /<meta name="checks" content="[^"]*self-check=pass[^"]*">/)
    assert.match(out, /<meta name="checks" content="[^"]*diagram=2\/3[^"]*">/)
  })

  test('replaces an existing diagram= pair in place rather than duplicating it', () => {
    const raw = '<meta name="checks" content="diagram=0/1;self-check=fail">'
    const out = updateDiagramMeta(raw, 1, 1)
    assert.equal(out, '<meta name="checks" content="diagram=1/1;self-check=fail">')
  })

  test('inserts a new checks meta right before </head> when none exists', () => {
    const out = updateDiagramMeta('<head></head>', 1, 1)
    assert.equal(out, '<head><meta name="checks" content="diagram=1/1">\n</head>')
  })
})

describe('rerender-figures: rerenderOne', () => {
  test('a small valid IR renders and passes', async () => {
    const out = await rerenderOne(SIMPLE_YAML, { column: 720 })
    assert.equal(out.ok, true)
    assert.match(out.html, /data-checks="pass"/)
  })

  test('an over-budget IR with clean geometry renders, passes, and reports its budget warning', async () => {
    const out = await rerenderOne(BUDGET_YAML, { column: 720 })
    assert.equal(out.ok, true)
    assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=11">/)
    assert.equal(out.warn, 'budget:nodes=11')
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:nodes'])
  })

  test('an in-budget IR reports no warnings and no data-warn', async () => {
    const out = await rerenderOne(SIMPLE_YAML, { column: 720 })
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings, [])
    assert.equal(out.warn, '')
    assert.ok(!out.html.includes('data-warn'))
  })

  test('a geometry failure still fails with reason "verification" and the failing rows', async () => {
    const out = await rerenderOne(FAILING_YAML, { column: 720 })
    assert.equal(out.ok, false)
    assert.equal(out.reason, 'verification')
    assert.ok(out.failing.some((c) => c.name === 'unrelated-crossing'))
    assert.ok(out.failing.every((c) => c.severity === 'fail'))
  })

  test('unparseable text fails with reason "parse-error"', async () => {
    const out = await rerenderOne('not: [valid', { column: 720 })
    assert.equal(out.ok, false)
    assert.equal(out.reason, 'parse-error')
  })

  test('a hostile label re-renders without leaking raw HTML into the output figure', async () => {
    const out = await rerenderOne(DANGEROUS_YAML, { column: 720 })
    assert.equal(out.ok, true)
    assert.ok(!out.html.includes('<b>x</b>'))
    assert.ok(out.html.includes('&lt;b&gt;x&lt;/b&gt;'))
  })
})

describe('rerender-figures: rerenderPageText', () => {
  test('a fallback figure that now renders clean is replaced; only the <figure>...</figure> span changes', async () => {
    const raw = HEAD + fallbackFigure(SIMPLE_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, true)
    assert.match(patched, /<figure class="wu-figure" data-checks="pass">/)
    assert.ok(!/<table class="wu-table">/.test(patched)) // the old table fallback is gone
    // everything outside the <figure>...</figure> span is untouched, including
    // the sibling warn callout the migration converter also emitted
    assert.ok(patched.startsWith(HEAD))
    assert.ok(patched.endsWith(TAIL))
    assert.match(patched, /図は変換時に合格せず、表で代替/)
  })

  test('a still-failing figure is left byte-for-byte untouched', async () => {
    const raw = HEAD + fallbackFigure(FAILING_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, false)
    assert.equal(tried[0].reason, 'verification')
    assert.equal(patched, raw)
  })

  test('an over-budget fallback figure is replaced by a passing figure that carries data-warn', async () => {
    const raw = HEAD + fallbackFigure(BUDGET_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, true)
    assert.match(patched, /<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=11">/)
    assert.ok(!/<table class="wu-table">/.test(patched))
  })

  test('an already-passing figure is skipped (not even attempted) without --all', async () => {
    const raw = HEAD + passingFigure(SIMPLE_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 0)
    assert.equal(patched, raw)
  })

  test('reads a properly-escaped fallback figure and re-renders it without leaking raw HTML', async () => {
    const raw = HEAD + fallbackFigure(escapeIrScript(DANGEROUS_YAML)) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, true)
    assert.ok(!patched.includes('<b>x</b>'))
    assert.ok(patched.includes('&lt;b&gt;x&lt;/b&gt;'))
  })

  test('also reads a legacy unescaped fallback figure (pre-contract page) and re-renders it clean', async () => {
    const raw = HEAD + fallbackFigure(DANGEROUS_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: false })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, true)
    assert.ok(!patched.includes('<b>x</b>'))
    assert.ok(patched.includes('&lt;b&gt;x&lt;/b&gt;'))
  })

  test('--all re-renders an already-passing figure too, replacing stale content', async () => {
    const raw = HEAD + passingFigure(SIMPLE_YAML) + TAIL
    const { raw: patched, tried } = await rerenderPageText(raw, { column: 720, all: true })
    assert.equal(tried.length, 1)
    assert.equal(tried[0].ok, true)
    assert.ok(!patched.includes('古いキャプション'))
  })
})

describe('rerender-figures: rerenderStore (4 fixture pages)', () => {
  test('fixes the fallback-now-passing pages (counting the over-budget one as warned), leaves the still-failing page alone, skips the already-passing page', async () => {
    const store = tmpStore()
    const report = await rerenderStore(store, {})

    assert.equal(report.pagesScanned, 4)
    assert.equal(report.figuresTried, 3) // page-a (fallback) + page-b (still fails) + page-d (over budget); page-c skipped
    assert.equal(report.fixed, 2)
    assert.equal(report.warned, 1)
    assert.equal(report.stillFailing, 1)
    assert.ok(report.failingChecks['unrelated-crossing'] >= 1)
    assert.equal(report.failingChecks.budget, undefined)
    assert.deepEqual(report.warnedChecks, { 'budget:nodes': 1 })

    const a = readFileSync(join(store, 'page-a.html'), 'utf8')
    assert.match(a, /<figure class="wu-figure" data-checks="pass">/)
    assert.match(a, /diagram=1\/1/)

    const b = readFileSync(join(store, 'page-b.html'), 'utf8')
    assert.match(b, /図は変換時に合格せず、表で代替/) // unchanged fallback content
    assert.match(b, /diagram=0\/1/)

    // over budget but geometry passes: rendered, counted as passing in
    // diagram=ok/total, and the warning is on the page entry
    const d = readFileSync(join(store, 'page-d.html'), 'utf8')
    assert.match(d, /<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=11">/)
    assert.match(d, /diagram=1\/1/)
    const dEntry = report.pages.find((p) => p.path === 'page-d.html')
    assert.equal(dEntry.warned, 1)
    assert.deepEqual(dEntry.warnings, ['budget:nodes=11'])

    const cBefore = HEAD + passingFigure(SIMPLE_YAML) + TAIL
    const c = readFileSync(join(store, 'page-c.html'), 'utf8')
    assert.equal(c, cBefore) // untouched: already passing, no --all

    rmSync(store, { recursive: true, force: true })
  })

  test('--all also fixes the already-passing page (forcing a fresh render)', async () => {
    const store = tmpStore()
    await rerenderStore(store, { all: true })
    const c = readFileSync(join(store, 'page-c.html'), 'utf8')
    assert.ok(!c.includes('古いキャプション'))
    assert.match(c, /diagram=1\/1/)
    rmSync(store, { recursive: true, force: true })
  })

  test('--dry-run computes the same report but writes nothing', async () => {
    const store = tmpStore()
    const before = readFileSync(join(store, 'page-a.html'), 'utf8')
    const report = await rerenderStore(store, { dryRun: true })
    assert.equal(report.fixed, 2)
    assert.equal(report.warned, 1)
    const after = readFileSync(join(store, 'page-a.html'), 'utf8')
    assert.equal(after, before)
    rmSync(store, { recursive: true, force: true })
  })

  test('--only filters to a single page by basename glob', async () => {
    const store = tmpStore()
    const report = await rerenderStore(store, { only: 'page-a.html' })
    assert.equal(report.pagesScanned, 1)
    assert.equal(report.fixed, 1)
    rmSync(store, { recursive: true, force: true })
  })
})

describe('rerender-figures: CLI', () => {
  test('parseArgs reads --store/--only/--dry-run/--all/--report', () => {
    const args = parseArgs(['--store', '/x', '--only', '*.html', '--dry-run', '--all', '--report', 'out.json'])
    assert.deepEqual(args, { store: '/x', only: '*.html', dryRun: true, all: true, report: 'out.json', help: false })
  })

  test('parseArgs rejects an unknown flag', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown argument/)
  })

  test('main() writes a --report JSON file and prints a summary', async () => {
    const store = tmpStore()
    const reportPath = join(store, 'report.json')
    const logs = []
    const origLog = console.log
    console.log = (...a) => logs.push(a.join(' '))
    let code
    try {
      code = await main(['--store', store, '--report', reportPath])
    } finally {
      console.log = origLog
    }
    assert.equal(code, 0)
    assert.ok(logs.some((l) => /page\(s\) scanned/.test(l)))
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.equal(report.fixed, 2)
    assert.equal(report.warned, 1)
    assert.equal(report.stillFailing, 1)
    assert.ok(logs.some((l) => /warned: 1/.test(l)))
    rmSync(store, { recursive: true, force: true })
  })

  test('main() errors on a missing store', async () => {
    const code = await main(['--store', join(tmpdir(), 'wu-rerender-does-not-exist')])
    assert.equal(code, 2)
  })

  test('CLI subprocess: --help prints usage and exits 0', () => {
    const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /usage: rerender-figures\.mjs/)
  })

  test('CLI subprocess: end-to-end run against a real store fixes the fallback page', () => {
    const store = tmpStore()
    const r = spawnSync(process.execPath, [BIN, '--store', store], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /fixed: 2/)
    assert.match(r.stdout, /warned: 1/)
    assert.match(r.stdout, /budget warnings: budget:nodes \(1\)/)
    const a = readFileSync(join(store, 'page-a.html'), 'utf8')
    assert.match(a, /data-checks="pass"/)
    rmSync(store, { recursive: true, force: true })
  })
})
