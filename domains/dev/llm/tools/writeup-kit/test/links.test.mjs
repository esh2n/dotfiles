import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { repairLinks } from '../bin/lib/links.mjs'

const PAGE = 'engineering/backend/d-data/2026-06-11-transactions.html'

const STORE = new Set([
  'index.html',
  'engineering/backend/2026-06-11-index.html',
  'engineering/backend/d-data/2026-06-11-transactions.html',
  'engineering/backend/d-data/2026-06-11-sibling.html',
  'engineering/backend/d-data/2026-06-11-note.md',
  'engineering/backend/e-resilience/2026-06-11-idempotency.html',
  'engineering/backend/e-resilience/2026-06-11-idempotency.md',
  'engineering/frontend/2026-06-12-rendering-pipeline.html',
  'legacy/onboarding/2026-06-08-csv-export.html',
  '仕様/2026-06-04-soc-usage.html',
])
const exists = (p) => STORE.has(p)

const LEGACY = new Map([
  ['onboarding/2026-06-08-csv-export.md', 'legacy/onboarding/2026-06-08-csv-export.html'],
  ['onboarding/2026-06-08-csv-export.html', 'legacy/onboarding/2026-06-08-csv-export.html'],
])
const resolveLegacy = (p) => LEGACY.get(p) ?? null

function run(html, opts = {}) {
  return repairLinks(html, { pagePath: PAGE, exists, resolveLegacy, ...opts })
}

describe('repairLinks(): resolution rules', () => {
  test('rule 2 — page-relative href that exists is left unchanged', () => {
    const html = '<a href="2026-06-11-sibling.html">x</a> <a href="../../frontend/2026-06-12-rendering-pipeline.html">y</a>'
    const r = run(html)
    assert.equal(r.html, html)
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 0, 2])
    assert.deepEqual(r.details, [])
  })

  test('rule 3 — store-root-relative bare path is rewritten page-relative', () => {
    const r = run('<a href="engineering/backend/e-resilience/2026-06-11-idempotency.html">idem</a>')
    assert.equal(r.html, '<a href="../e-resilience/2026-06-11-idempotency.html">idem</a>')
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [1, 0, 0])
    assert.deepEqual(r.details, [{
      from: 'engineering/backend/e-resilience/2026-06-11-idempotency.html',
      to: '../e-resilience/2026-06-11-idempotency.html',
      kind: 'root',
    }])
  })

  test('rule 3 — root-relative link to a top-level page climbs the full page depth', () => {
    const r = run('<a href="index.html">top</a>')
    assert.equal(r.html, '<a href="../../../index.html">top</a>')
    assert.equal(r.fixed, 1)
  })

  test('rule 3 — non-ASCII folder names pass through undecoded when the href was not encoded', () => {
    const r = run('<a href="仕様/2026-06-04-soc-usage.html">spec</a>')
    assert.equal(r.html, '<a href="../../../仕様/2026-06-04-soc-usage.html">spec</a>')
  })

  test('rule 3 — percent-encoded href is decoded for lookup and re-encoded on output', () => {
    const enc = encodeURIComponent('仕様')
    const r = run(`<a href="${enc}/2026-06-04-soc-usage.html">spec</a>`)
    assert.equal(r.html, `<a href="../../../${enc}/2026-06-04-soc-usage.html">spec</a>`)
    assert.equal(r.fixed, 1)
  })

  test('rule 4 — moved page resolved through resolveLegacy', () => {
    const r = run('<a href="onboarding/2026-06-08-csv-export.html">csv</a>')
    assert.equal(r.html, '<a href="../../../legacy/onboarding/2026-06-08-csv-export.html">csv</a>')
    assert.deepEqual([r.fixed, r.missing], [1, 0])
    assert.equal(r.details[0].kind, 'legacy')
  })

  test('rule 4 — a .md source path is also offered to resolveLegacy', () => {
    const r = run('<a href="onboarding/2026-06-08-csv-export.md">csv</a>')
    assert.equal(r.html, '<a href="../../../legacy/onboarding/2026-06-08-csv-export.html">csv</a>')
    assert.equal(r.details[0].kind, 'legacy')
  })

  test('rule 4 — resolveLegacy result that does not exist falls through to missing', () => {
    const r = run('<a href="onboarding/2026-06-08-csv-export.html">csv</a>', {
      resolveLegacy: () => 'legacy/nowhere.html',
    })
    assert.equal(r.missing, 1)
    assert.match(r.html, /data-wu-missing=""/)
  })

  test('rule 4 — resolveLegacy is optional', () => {
    const r = run('<a href="onboarding/2026-06-08-csv-export.html">csv</a>', { resolveLegacy: undefined })
    assert.equal(r.missing, 1)
  })

  test('rule 5 — unresolvable href is kept and marked with data-wu-missing + class', () => {
    const r = run('<a href="engineering/backend/nope.html">gone</a>')
    assert.equal(r.html, '<a href="engineering/backend/nope.html" data-wu-missing="" class="wu-missing">gone</a>')
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 1, 0])
    assert.deepEqual(r.details, [{ from: 'engineering/backend/nope.html', to: 'engineering/backend/nope.html', kind: 'missing' }])
  })

  test('rule 5 — class is merged into an existing class attribute', () => {
    const r = run('<a class="wu-link primary" href="nope.html">gone</a>')
    assert.equal(r.html, '<a class="wu-link primary wu-missing" href="nope.html" data-wu-missing="">gone</a>')
  })

  test('rule 5 — single-quoted class attribute keeps its quote style', () => {
    const r = run("<a class='x' href='nope.html'>gone</a>")
    assert.equal(r.html, `<a class='x wu-missing' href='nope.html' data-wu-missing="">gone</a>`)
  })

  test('rule 5 — page-relative href escaping the store root is missing', () => {
    const r = run('<a href="../../../../outside.html">out</a>')
    assert.equal(r.missing, 1)
  })

  test('rule 6 — page-relative .md rewritten to its .html sibling', () => {
    const r = run('<a href="2026-06-11-missing-md-sibling.md">n</a> <a href="../e-resilience/2026-06-11-idempotency.md">i</a>')
    // first has neither .md nor .html → missing; second .md exists → unchanged
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 1, 1])

    const r2 = run('<a href="../../frontend/2026-06-12-rendering-pipeline.md">fe</a>')
    assert.equal(r2.html, '<a href="../../frontend/2026-06-12-rendering-pipeline.html">fe</a>')
    assert.equal(r2.fixed, 1)
    assert.equal(r2.details[0].kind, 'md')
  })

  test('rule 6 — root-relative .md rewritten to the page-relative .html', () => {
    const r = run('<a href="engineering/frontend/2026-06-12-rendering-pipeline.md">fe</a>')
    assert.equal(r.html, '<a href="../../frontend/2026-06-12-rendering-pipeline.html">fe</a>')
    assert.equal(r.details[0].kind, 'md')
  })

  test('rule 6 — an existing .md target is not rewritten', () => {
    const html = '<a href="2026-06-11-note.md">note</a>'
    const r = run(html)
    assert.equal(r.html, html)
    assert.equal(r.unchanged, 1)
  })
})

describe('repairLinks(): fragments and queries', () => {
  test('fragment is preserved on a rewritten href', () => {
    const r = run('<a href="engineering/backend/e-resilience/2026-06-11-idempotency.html#retry">i</a>')
    assert.equal(r.html, '<a href="../e-resilience/2026-06-11-idempotency.html#retry">i</a>')
  })

  test('query + fragment are preserved and not used for lookup', () => {
    const r = run('<a href="engineering/frontend/2026-06-12-rendering-pipeline.md?v=2#top">fe</a>')
    assert.equal(r.html, '<a href="../../frontend/2026-06-12-rendering-pipeline.html?v=2#top">fe</a>')
  })

  test('fragment stays on a missing href too', () => {
    const r = run('<a href="nope.html#x">n</a>')
    assert.equal(r.html, '<a href="nope.html#x" data-wu-missing="" class="wu-missing">n</a>')
    assert.equal(r.details[0].from, 'nope.html#x')
  })
})

describe('repairLinks(): skip cases', () => {
  const SKIPPED = [
    '#section',
    'http://example.com/a.html',
    'https://example.com/a.html',
    'HTTPS://example.com/a.html',
    'mailto:a@example.com',
    'data:text/plain,hi',
    'javascript:void(0)',
    '/absolute/a.html',
    '_kit/writeup.css',
    '',
  ]
  for (const href of SKIPPED) {
    test(`href="${href}" is left untouched and uncounted`, () => {
      const html = `<a href="${href}">x</a>`
      const r = run(html)
      assert.equal(r.html, html)
      assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 0, 0])
    })
  }

  test('<link href> is never touched', () => {
    const html = '<link rel="stylesheet" href="engineering/backend/nope.css">'
    const r = run(html)
    assert.equal(r.html, html)
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 0, 0])
  })

  test('<a> without href is ignored', () => {
    const html = '<a name="anchor">x</a>'
    const r = run(html)
    assert.equal(r.html, html)
  })

  test('anchors inside <script>, <pre>, <code> and the IR script are not rewritten', () => {
    const bad = '<a href="engineering/backend/nope.html">x</a>'
    const html = [
      `<script>${bad}</script>`,
      `<script type="text/x-writeup-diagram">${bad}</script>`,
      `<pre><code>${bad}</code></pre>`,
      `<code>${bad}</code>`,
      `<!-- ${bad} -->`,
      `<pre class="wu-code">${bad}</pre>`,
    ].join('\n')
    const r = run(html)
    assert.equal(r.html, html)
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [0, 0, 0])
  })

  test('anchors between protected blocks are still processed', () => {
    const html = '<pre>a</pre><a href="index.html">t</a><script>b</script><a href="nope.html">m</a>'
    const r = run(html)
    assert.equal(r.html, '<pre>a</pre><a href="../../../index.html">t</a><script>b</script><a href="nope.html" data-wu-missing="" class="wu-missing">m</a>')
    assert.deepEqual([r.fixed, r.missing], [1, 1])
  })
})

describe('repairLinks(): idempotence and tag shapes', () => {
  const MIXED = [
    '<a href="engineering/backend/e-resilience/2026-06-11-idempotency.html">a</a>',
    '<a class="c" href="engineering/backend/nope.html#f">b</a>',
    '<a href="onboarding/2026-06-08-csv-export.md">c</a>',
    '<a href="2026-06-11-sibling.html">d</a>',
    '<a\n  href="index.html"\n  target="_blank">e</a>',
  ].join('\n')

  test('second pass is a no-op with fixed=0 and identical html', () => {
    const first = run(MIXED)
    assert.deepEqual([first.fixed, first.missing, first.unchanged], [3, 1, 1])
    const second = run(first.html)
    assert.equal(second.html, first.html)
    assert.deepEqual([second.fixed, second.missing, second.unchanged], [0, 1, 4])
  })

  test('data-wu-missing and wu-missing class are not duplicated', () => {
    const r = run('<a href="nope.html" data-wu-missing="" class="wu-missing x">n</a>')
    assert.equal(r.html, '<a href="nope.html" data-wu-missing="" class="wu-missing x">n</a>')
    assert.equal((r.html.match(/data-wu-missing/g) ?? []).length, 1)
    assert.equal((r.html.match(/wu-missing/g) ?? []).length, 2)
  })

  test('a stale missing marker is removed once the target resolves', () => {
    const r = run('<a href="2026-06-11-sibling.html" data-wu-missing="" class="wu-missing">s</a>')
    assert.equal(r.html, '<a href="2026-06-11-sibling.html">s</a>')
    assert.equal(r.unchanged, 1)
    assert.deepEqual(r.details, [{ from: '2026-06-11-sibling.html', to: '2026-06-11-sibling.html', kind: 'unmarked' }])

    const r2 = run('<a href="index.html" data-wu-missing="" class="a wu-missing">s</a>')
    assert.equal(r2.html, '<a href="../../../index.html" class="a">s</a>')
    assert.equal(r2.fixed, 1)
  })

  test('multi-line tags and other attributes survive', () => {
    const r = run('<a\n  target="_blank"\n  href="index.html"\n  rel="noopener">t</a>')
    assert.equal(r.html, '<a\n  target="_blank"\n  href="../../../index.html"\n  rel="noopener">t</a>')
  })

  test('single-quoted href is rewritten with single quotes', () => {
    const r = run("<a href='index.html'>t</a>")
    assert.equal(r.html, "<a href='../../../index.html'>t</a>")
  })

  test('a page at the store root links without ../ prefixes', () => {
    const r = run('<a href="engineering/backend/2026-06-11-index.html">b</a>', { pagePath: 'index.html' })
    assert.equal(r.html, '<a href="engineering/backend/2026-06-11-index.html">b</a>')
    assert.equal(r.unchanged, 1)
  })

  test('multiple anchors on one line are each handled', () => {
    const r = run('<a href="index.html">1</a><a href="nope.html">2</a><a href="2026-06-11-sibling.html">3</a>')
    assert.deepEqual([r.fixed, r.missing, r.unchanged], [1, 1, 1])
    assert.equal(r.details.length, 2)
  })
})

describe('repairLinks(): argument validation', () => {
  test('throws on missing pagePath or exists', () => {
    assert.throws(() => repairLinks('<a href="x">', { exists }), /pagePath/)
    assert.throws(() => repairLinks('<a href="x">', { pagePath: PAGE }), /exists/)
    assert.throws(() => repairLinks(null, { pagePath: PAGE, exists }), /html/)
  })
})
