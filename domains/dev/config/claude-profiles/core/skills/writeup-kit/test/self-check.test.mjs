import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runSelfCheck, writeMetaChecks } from '../bin/self-check.mjs'
import { SIDETOC_SCRIPT } from '../bin/build.mjs'
import { pageId } from '../bin/lib/store.mjs'
import { makeTinyPng } from './helpers/tiny-png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SELF_CHECK_BIN = join(ROOT, 'bin', 'self-check.mjs')

let tmpCounter = 0
function writeTempPage(html) {
  const dir = mkdtempSync(join(tmpdir(), 'wu-selfcheck-'))
  const file = join(dir, `page-${tmpCounter++}.html`)
  writeFileSync(file, html)
  return file
}

/** Writes `html` as a temp page, then writes `buffer` at `relPath` under
 * the page's own directory (e.g. `shot-assets/pic.png`) — the on-disk half
 * of a `.wu-shot` fixture whose `<img src>` names that same `relPath`. */
function writeTempPageWithAsset(html, relPath, buffer = makeTinyPng()) {
  const file = writeTempPage(html)
  const assetPath = join(dirname(file), relPath)
  mkdirSync(dirname(assetPath), { recursive: true })
  writeFileSync(assetPath, buffer)
  return file
}

const HEADER = '<header class="wu-header"><p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>'
const FOOTER = '<footer class="wu-footer"><dl><dt>checks</dt><dd>c</dd><dt>sources</dt><dd>s</dd></dl></footer>'
const DEFAULT_BODY =
  '<section class="wu-section"><h2>今日分かったこと</h2><ol class="wu-steps"><li>短い文。</li></ol></section>' +
  '<section class="wu-section"><h2>次にやること</h2><ol class="wu-steps"><li>短い文。</li></ol></section>'

function page({ kind = '作業メモ', date = '2026-08-20', body = DEFAULT_BODY, extraHead = '', extraLink = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>test page</title>
<meta name="description" content="test description">
<meta name="kind" content="${kind}">
<meta name="date" content="${date}">
${extraHead}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=x">
<link rel="stylesheet" href="../_kit/writeup.css">
${extraLink}
</head>
<body>
<div class="wu-page">
${HEADER}
<main>
${body}
</main>
${FOOTER}
</div>
</body>
</html>`
}

function itemsFor(html) {
  const file = writeTempPage(html)
  return runSelfCheck(file)
}

/** `itemsFor(page({ body }))`, for a test that only cares about swapping
 * the body content. */
function itemsForBody(body) {
  return itemsFor(page({ body: DEFAULT_BODY + body }))
}

describe('self-check: reference pages', () => {
  test('kit/samples.html: figure row passes because the figure is real renderer output with data-checks="pass"', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(!result.errors.some((e) => e.item === 'figure-pass'), 'expected no figure-pass error')
  })

  test('kit/samples.html: chrome and required meta pass', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(!result.errors.some((e) => e.item === 'chrome'))
    assert.ok(!result.errors.some((e) => e.item === 'required-meta'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('kit/samples.html: svg a11y passes', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(!result.errors.some((e) => e.item === 'svg-a11y'))
  })

  test('kit/samples.html: passes self-check with zero errors (only the kind-sections warning is expected)', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.deepEqual(result.errors, [])
    assert.ok(result.warnings.every((w) => w.item === 'kind-sections'))
  })

  test('a well-formed synthetic page passes with zero errors and zero warnings', () => {
    const result = runSelfCheck(join(ROOT, 'test', 'fixtures', 'store', 'design', '2026-08-05-example-design.html'))
    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
  })

  test('a well-formed decision-record page also passes cleanly', () => {
    const result = runSelfCheck(join(ROOT, 'test', 'fixtures', 'store', 'decision', '2026-08-01-example-decision.html'))
    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
  })
})

describe('self-check: adversarial rows', () => {
  test('row 1 (single-file): a disallowed external script src is an error', () => {
    const result = itemsFor(page({ extraLink: '<script src="https://evil.example.com/a.js"></script>' }))
    assert.ok(result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: the kit CSS relative link and Google Fonts are both allowed', () => {
    const result = itemsFor(page())
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: the kit link is allowed at folder depth 1 (../_kit/writeup.css)', () => {
    const html = page().replace('href="../_kit/writeup.css"', 'href="../_kit/writeup.css"')
    const result = itemsFor(html)
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: the kit link is allowed at folder depth 3 (../../../_kit/writeup.css)', () => {
    const html = page().replace('href="../_kit/writeup.css"', 'href="../../../_kit/writeup.css"')
    const result = itemsFor(html)
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: ./writeup.css (the form used from inside _kit/ itself) is allowed', () => {
    const html = page().replace('href="../_kit/writeup.css"', 'href="./writeup.css"')
    const result = itemsFor(html)
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: a wrong path that merely resembles the kit link is still rejected', () => {
    const html = page().replace('href="../_kit/writeup.css"', 'href="../_kit/style.css"')
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'single-file' && /style\.css/.test(e.detail)))
  })

  test('row 1: <link rel="icon"> with a data: href is allowed (the status favicon)', () => {
    const result = itemsFor(page({ extraHead: '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E">' }))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('row 1: <link rel="icon"> with a non-data (external file) href is still an error', () => {
    const result = itemsFor(page({ extraHead: '<link rel="icon" href="https://example.com/favicon.ico">' }))
    assert.ok(result.errors.some((e) => e.item === 'single-file' && /favicon\.ico/.test(e.detail)))
  })

  test('row 1: <link rel="icon"> with a bare relative file href is still an error', () => {
    const result = itemsFor(page({ extraHead: '<link rel="icon" href="./favicon.png">' }))
    assert.ok(result.errors.some((e) => e.item === 'single-file' && /favicon\.png/.test(e.detail)))
  })

  test('row 2 (required-meta): a missing kind is an error', () => {
    const html = page().replace('<meta name="kind" content="作業メモ">', '')
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'required-meta' && /kind/.test(e.detail)))
  })

  test('row 2: an invalid kind value is an error', () => {
    const result = itemsFor(page({ kind: 'no-such-kind' }))
    assert.ok(result.errors.some((e) => e.item === 'required-meta' && /8 kinds/.test(e.detail)))
  })

  test('row 2: a malformed date is an error', () => {
    const result = itemsFor(page({ date: '2026/08/20' }))
    assert.ok(result.errors.some((e) => e.item === 'required-meta' && /date/.test(e.detail)))
  })

  test('row 3 (chrome): a header missing the lede paragraph is an error', () => {
    const html = page().replace('<p class="wu-lede">l</p>', '')
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 3: a footer with only one dt/dd pair is an error', () => {
    const badFooter = '<footer class="wu-footer"><dl><dt>checks</dt><dd>c</dd></dl></footer>'
    const html = page().replace(FOOTER, badFooter)
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 3: a header with .wu-nav (matching the template) is not a chrome error', () => {
    const headerWithNav = '<header class="wu-header"><nav class="wu-nav"><a class="wu-back" href="../index.html">一覧</a></nav><p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>'
    const html = page().replace(HEADER, headerWithNav)
    const result = itemsFor(html)
    assert.ok(!result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 3: a header without .wu-nav (predating the feature) is still not a chrome error', () => {
    const result = itemsFor(page())
    assert.ok(!result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 3: the chrome-match rule ignores .wu-back\'s href value entirely', () => {
    const headerWithNav = '<header class="wu-header"><nav class="wu-nav"><a class="wu-back" href="/anything/weird.html">一覧</a></nav><p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>'
    const html = page().replace(HEADER, headerWithNav)
    const result = itemsFor(html)
    assert.ok(!result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 3: a .wu-nav that is missing its a.wu-back link is still a chrome error (nav shape itself is checked)', () => {
    const badNavHeader = '<header class="wu-header"><nav class="wu-nav"><span>一覧</span></nav><p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>'
    const html = page().replace(HEADER, badNavHeader)
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'chrome'))
  })

  test('row 4 (role-structure): an <aside> inside main is a disallowed element', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<aside>x</aside>' }))
    assert.ok(result.errors.some((e) => e.item === 'role-structure' && /aside/.test(e.detail)))
  })

  test('row 4: a <nav> (.wu-toc) inside main is allowed', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<nav class="wu-toc"><p>目次</p><ol><li><a href="#a">a</a></li></ol></nav>' }))
    assert.ok(!result.errors.some((e) => e.item === 'role-structure' && /nav/.test(e.detail)))
  })

  test('inline-script: build\'s pinned side-TOC script is accepted', () => {
    const html = page().replace('</body>', `<script>${SIDETOC_SCRIPT}</script>\n</body>`)
    const result = itemsFor(html)
    assert.deepEqual(result.errors.filter((e) => e.item === 'inline-script'), [])
  })

  test('inline-script: any other executable script is an error', () => {
    const result = itemsFor(page().replace('</body>', '<script>console.log(1)</script>\n</body>'))
    assert.ok(result.errors.some((e) => e.item === 'inline-script'), JSON.stringify(result.errors))
  })

  test('inline-script: a script whose source drifts from the pin by one character is an error', () => {
    const drifted = SIDETOC_SCRIPT.replace("'0px 0px -72% 0px'", "'0px 0px -50% 0px'")
    const result = itemsFor(page().replace('</body>', `<script>${drifted}</script>\n</body>`))
    assert.ok(result.errors.some((e) => e.item === 'inline-script'), JSON.stringify(result.errors))
  })

  test('inline-script: the pinned script twice on one page is an error', () => {
    const twice = `<script>${SIDETOC_SCRIPT}</script>\n<script>${SIDETOC_SCRIPT}</script>\n</body>`
    const result = itemsFor(page().replace('</body>', twice))
    assert.ok(result.errors.some((e) => e.item === 'inline-script' && /more than once/.test(e.detail)))
  })

  test('inline-script: a .wu-figure IR block (type="text/x-writeup-diagram") is data, not a script', () => {
    const ir = '<figure class="wu-figure" data-checks="pass"><script type="text/x-writeup-diagram">type: flow</script></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + ir }))
    assert.deepEqual(result.errors.filter((e) => e.item === 'inline-script'), [])
  })

  test('markdown-convertibility: the generated .wu-sidetoc nav is mapped, not a warn', () => {
    const nav = '<nav class="wu-sidetoc" aria-label="目次"><ol><li><a href="#a">a</a><ol class="wu-sidetoc-sub"><li><a href="#b">b</a></li></ol></li></ol></nav>'
    const result = itemsFor(page({ body: nav + DEFAULT_BODY }))
    assert.ok(!result.warnings.some((w) => w.item === 'markdown-convertibility' && /wu-sidetoc/.test(w.detail)), JSON.stringify(result.warnings))
    assert.ok(!result.errors.some((e) => e.item === 'role-structure'), JSON.stringify(result.errors))
  })

  test('row 4: a non-wu- class on a body element is an error', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<p class="not-a-wu-class">x</p>' }))
    assert.ok(result.errors.some((e) => e.item === 'role-structure' && /not-a-wu-class/.test(e.detail)))
  })

  test('row 5 (kind-sections): missing a required h2 for the kind is a warning', () => {
    const result = itemsFor(page({ body: '<section class="wu-section"><h2>今日分かったこと</h2><p>x</p></section>' }))
    assert.ok(result.warnings.some((w) => w.item === 'kind-sections' && /次にやること/.test(w.detail)))
  })

  test('row 6 (figure-pass): a .wu-figure without data-checks="pass" is an error', () => {
    const fig = '<figure class="wu-figure"><svg role="img"><title>t</title><desc>d</desc></svg><figcaption>c</figcaption></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'figure-pass'))
  })

  test('row 6: data-checks="pass" clears the figure-pass row', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg role="img"><title>t</title><desc>d</desc></svg><figcaption>c</figcaption></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(!result.errors.some((e) => e.item === 'figure-pass'))
    assert.ok(!result.warnings.some((w) => w.item === 'figure-budget'))
  })

  test('row 6 (figure-budget): a passing figure with data-warn is a warn row carrying the warning text, not an error', () => {
    const fig = '<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=11;budget:label=15"><svg role="img"><title>t</title><desc>d</desc></svg><figcaption>大きい図</figcaption></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.equal(result.ok, true)
    assert.ok(!result.errors.some((e) => e.item === 'figure-pass'))
    const warn = result.warnings.find((w) => w.item === 'figure-budget')
    assert.ok(warn, 'expected a figure-budget warn row')
    assert.match(warn.detail, /"大きい図"/)
    assert.match(warn.detail, /budget:nodes=11;budget:label=15/)
    assert.match(warn.detail, /consider splitting/)
  })

  test('row 6: data-warn without data-checks="pass" is still the figure-pass error (no warn row)', () => {
    const fig = '<figure class="wu-figure" data-warn="budget:nodes=11"><svg role="img"><title>t</title><desc>d</desc></svg><figcaption>c</figcaption></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'figure-pass'))
    assert.ok(!result.warnings.some((w) => w.item === 'figure-budget'))
  })

  test('row 7 (svg-a11y): missing role="img" is an error', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg><title>t</title><desc>d</desc></svg></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'svg-a11y' && /role/.test(e.detail)))
  })

  test('row 7: a first child other than <title> is an error', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg role="img"><desc>d</desc><title>t</title></svg></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'svg-a11y' && /title/.test(e.detail)))
  })

  test('row 7: an empty <desc> is an error', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg role="img"><title>t</title><desc></desc></svg></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'svg-a11y' && /desc/.test(e.detail)))
  })

  test('row 7 (svg-a11y): an id inside the svg not prefixed "wu-d-" is an error', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg role="img"><title>t</title><desc>d</desc><g id="node-1"></g></svg></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(result.errors.some((e) => e.item === 'svg-a11y' && /wu-d-/.test(e.detail) && /node-1/.test(e.detail)))
  })

  test('row 7: every id inside the svg prefixed "wu-d-" clears the id-prefix row', () => {
    const fig = '<figure class="wu-figure" data-checks="pass"><svg role="img"><title>t</title><desc>d</desc><g id="wu-d-demo-node-1"></g></svg></figure>'
    const result = itemsFor(page({ body: DEFAULT_BODY + fig }))
    assert.ok(!result.errors.some((e) => e.item === 'svg-a11y'))
  })

  test('row 8 (accent-budget): a second .wu-accent is a warning', () => {
    const body = DEFAULT_BODY + '<p><span class="wu-accent">a</span> <span class="wu-accent">b</span></p>'
    const result = itemsFor(page({ body }))
    assert.ok(result.warnings.some((w) => w.item === 'accent-budget'))
  })

  test('row 8: exactly one .wu-accent is not flagged', () => {
    const body = DEFAULT_BODY + '<p><span class="wu-accent">a</span></p>'
    const result = itemsFor(page({ body }))
    assert.ok(!result.warnings.some((w) => w.item === 'accent-budget'))
  })

  test('row 9 (emoji): an emoji character in body text is a warning', () => {
    const body = DEFAULT_BODY + '<p>done \u{1F389}</p>'
    const result = itemsFor(page({ body }))
    assert.ok(result.warnings.some((w) => w.item === 'emoji'))
  })

  test('row 9: an arrow character in body text is a warning', () => {
    const body = DEFAULT_BODY + '<p>A → B</p>'
    const result = itemsFor(page({ body }))
    assert.ok(result.warnings.some((w) => w.item === 'emoji'))
  })

  test('row 10 (callout-run): three consecutive .wu-callout are a warning', () => {
    const callout = '<div class="wu-callout" data-tone="note"><p>x</p></div>'
    const result = itemsFor(page({ body: DEFAULT_BODY + callout + callout + callout }))
    assert.ok(result.warnings.some((w) => w.item === 'callout-run'))
  })

  test('row 10: two consecutive .wu-callout (with a paragraph between the group) are not flagged', () => {
    const callout = '<div class="wu-callout" data-tone="note"><p>x</p></div>'
    const result = itemsFor(page({ body: DEFAULT_BODY + callout + callout + '<p>break</p>' + callout }))
    assert.ok(!result.warnings.some((w) => w.item === 'callout-run'))
  })

  test('row 11 (table-columns): a .wu-table with 6 columns is a warning', () => {
    const table = '<table class="wu-table"><tr><th>a</th><th>b</th><th>c</th><th>d</th><th>e</th><th>f</th></tr></table>'
    const result = itemsFor(page({ body: DEFAULT_BODY + table }))
    assert.ok(result.warnings.some((w) => w.item === 'table-columns' && /wu-table/.test(w.detail)))
  })

  test('row 11: a .wu-compare with 5 columns is a warning', () => {
    const table = '<table class="wu-compare"><tr><th>a</th><th>b</th><th>c</th><th>d</th><th>e</th></tr></table>'
    const result = itemsFor(page({ body: DEFAULT_BODY + table }))
    assert.ok(result.warnings.some((w) => w.item === 'table-columns' && /wu-compare/.test(w.detail)))
  })

  test('row 12 (sentence-length): a sentence over 80 chars is a warning', () => {
    const s = 'あ'.repeat(85)
    const result = itemsFor(page({ body: DEFAULT_BODY + `<p>${s}。</p>` }))
    assert.ok(result.warnings.some((w) => w.item === 'sentence-length'))
    assert.ok(!result.errors.some((e) => e.item === 'sentence-length'))
  })

  test('row 12: a sentence over 120 chars is an error, not just a warning', () => {
    const s = 'あ'.repeat(130)
    const result = itemsFor(page({ body: DEFAULT_BODY + `<p>${s}。</p>` }))
    assert.ok(result.errors.some((e) => e.item === 'sentence-length'))
  })

  test('row 12: two adjacent 60-char paragraphs never concatenate into one long "sentence"', () => {
    // Neither paragraph ends with 。！？ on its own — each is one prose block
    // (contract §5), so they must be measured independently. Concatenating
    // them across the <p> boundary would read as one ~120-char run and
    // wrongly warn/error.
    const s1 = 'あ'.repeat(60)
    const s2 = 'い'.repeat(60)
    const result = itemsFor(page({ body: DEFAULT_BODY + `<p>${s1}</p><p>${s2}</p>` }))
    assert.ok(!result.warnings.some((w) => w.item === 'sentence-length'), JSON.stringify(result.warnings))
    assert.ok(!result.errors.some((e) => e.item === 'sentence-length'), JSON.stringify(result.errors))
  })

  test('row 13 (parentheticals): 2+ parenthetical groups in one sentence is a warning', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<p>これは（注記1）と（注記2）を含む文である。</p>' }))
    assert.ok(result.warnings.some((w) => w.item === 'parentheticals'))
  })

  test('row 13: a single parenthetical group is not flagged', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<p>これは（注記1）だけを含む文である。</p>' }))
    assert.ok(!result.warnings.some((w) => w.item === 'parentheticals'))
  })

  test('row 12: table cell text is not counted as prose, even when it runs long unpunctuated', () => {
    const s = 'あ'.repeat(130)
    const table = `<table class="wu-table"><thead><tr><th>x</th></tr></thead><tbody><tr><td>${s}</td></tr></tbody></table>`
    const result = itemsFor(page({ body: DEFAULT_BODY + table + '<p>結論。</p>' }))
    assert.ok(!result.errors.some((e) => e.item === 'sentence-length'))
    assert.ok(!result.warnings.some((w) => w.item === 'sentence-length'))
  })

  test('row 12: .wu-toc nav link labels are not counted as prose', () => {
    const s = 'あ'.repeat(130)
    const nav = `<nav class="wu-toc"><p>目次</p><ol><li><a href="#a">${s}</a></li></ol></nav>`
    const result = itemsFor(page({ body: DEFAULT_BODY + nav + '<p>結論。</p>' }))
    assert.ok(!result.errors.some((e) => e.item === 'sentence-length'))
    assert.ok(!result.warnings.some((w) => w.item === 'sentence-length'))
  })

  test('row 12: a blockquote (.wu-quote) excerpt is not counted as prose, even without full-width punctuation', () => {
    const quote = '<blockquote class="wu-quote"><p class="wu-quote-original">' +
      'A very long English sentence with no full-width terminator that would otherwise merge into the surrounding prose run on and on and on.' +
      '</p></blockquote>'
    const result = itemsFor(page({ body: DEFAULT_BODY + quote + '<p>結論。</p>' }))
    assert.ok(!result.errors.some((e) => e.item === 'sentence-length'))
    assert.ok(!result.warnings.some((w) => w.item === 'sentence-length'))
  })

  test('row 14 (markdown-convertibility): an <input> element is outside the §7 mapping', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<input type="text">' }))
    assert.ok(result.warnings.some((w) => w.item === 'markdown-convertibility'))
  })
})

describe('self-check: CLI and --write-meta', () => {
  test('exit code 0 when there are no errors', () => {
    const file = writeTempPage(page())
    const r = spawnSync(process.execPath, [SELF_CHECK_BIN, file])
    assert.equal(r.status, 0)
  })

  test('exit code 1 when there is at least one error', () => {
    const html = page({ kind: 'no-such-kind' })
    const file = writeTempPage(html)
    const r = spawnSync(process.execPath, [SELF_CHECK_BIN, file])
    assert.equal(r.status, 1)
  })

  test('exit code 2 for a missing file', () => {
    const r = spawnSync(process.execPath, [SELF_CHECK_BIN, '/no/such/file.html'])
    assert.equal(r.status, 2)
  })

  test('--json prints a structured report', () => {
    const file = writeTempPage(page())
    const r = spawnSync(process.execPath, [SELF_CHECK_BIN, file, '--json'])
    const parsed = JSON.parse(r.stdout.toString())
    assert.equal(parsed.ok, true)
    assert.ok(Array.isArray(parsed.items))
  })

  test('--write-meta upserts self-check=pass while preserving an existing lint= value', () => {
    const html = page({ extraHead: '<meta name="checks" content="lint=pass;diagram=1/1">' })
    const file = writeTempPage(html)
    writeMetaChecks(file, true)
    const updated = readFileSync(file, 'utf8')
    assert.match(updated, /name="checks" content="lint=pass;diagram=1\/1;self-check=pass"/)
  })

  test('--write-meta records self-check=fail when errors are present', () => {
    const html = page({ kind: 'no-such-kind', extraHead: '<meta name="checks" content="lint=pass">' })
    const file = writeTempPage(html)
    writeMetaChecks(file, false)
    const updated = readFileSync(file, 'utf8')
    assert.match(updated, /self-check=fail/)
  })

  test('--write-meta inserts a checks meta tag when none exists yet', () => {
    const html = page().replace(/\n<meta name="checks"[^\n]*\n/, '\n')
    const file = writeTempPage(html)
    writeMetaChecks(file, true)
    const updated = readFileSync(file, 'utf8')
    assert.match(updated, /<meta name="checks" content="self-check=pass">/)
  })
})

describe('self-check: <meta name="updated"> format', () => {
  test('a bare date (YYYY-MM-DD) is accepted with no finding', () => {
    const result = itemsFor(page({ extraHead: '<meta name="updated" content="2026-08-20">' }))
    assert.ok(!result.items.some((i) => i.item === 'updated-format'))
  })

  test('an ISO datetime with minutes and a +TZ offset is accepted with no finding', () => {
    const result = itemsFor(page({ extraHead: '<meta name="updated" content="2026-08-20T14:05+09:00">' }))
    assert.ok(!result.items.some((i) => i.item === 'updated-format'))
  })

  test('an ISO datetime with a trailing Z is accepted with no finding', () => {
    const result = itemsFor(page({ extraHead: '<meta name="updated" content="2026-08-20T14:05Z">' }))
    assert.ok(!result.items.some((i) => i.item === 'updated-format'))
  })

  test('a malformed updated value (missing minutes) is a warning', () => {
    const result = itemsFor(page({ extraHead: '<meta name="updated" content="2026-08-20T14+09:00">' }))
    assert.ok(result.warnings.some((w) => w.item === 'updated-format'))
  })

  test('an absent updated meta is not flagged (optional, falls back to date)', () => {
    const result = itemsFor(page())
    assert.ok(!result.items.some((i) => i.item === 'updated-format'))
  })
})

describe('self-check: <meta name="id"> (optional, must match the computed value)', () => {
  function storeWithPage(relPath, extraHead) {
    const storeDir = mkdtempSync(join(tmpdir(), 'wu-selfcheck-store-'))
    writeFileSync(join(storeDir, '.writeup.toml'), '[private]\nwords = []\n')
    const parts = relPath.split('/')
    const fileDir = parts.length > 1 ? join(storeDir, ...parts.slice(0, -1)) : storeDir
    if (fileDir !== storeDir) mkdirSync(fileDir, { recursive: true })
    const filePath = join(storeDir, ...parts)
    writeFileSync(filePath, page({ extraHead }))
    return { storeDir, filePath }
  }

  test('id meta absent is not flagged (optional)', () => {
    const { filePath } = storeWithPage('decision/2026-08-20-test.html')
    const result = runSelfCheck(filePath)
    assert.ok(!result.items.some((i) => i.item === 'id-meta'))
  })

  test('id meta matching the computed value (from the store-relative path) is not flagged', () => {
    const relPath = 'decision/2026-08-20-test.html'
    const id = pageId(relPath)
    const { filePath } = storeWithPage(relPath, `<meta name="id" content="${id}">`)
    const result = runSelfCheck(filePath)
    assert.ok(!result.items.some((i) => i.item === 'id-meta'))
  })

  test('id meta not matching the computed value is a warning naming both values', () => {
    const relPath = 'decision/2026-08-20-test.html'
    const { filePath } = storeWithPage(relPath, '<meta name="id" content="deadbeef">')
    const result = runSelfCheck(filePath)
    const expected = pageId(relPath)
    assert.ok(result.warnings.some((w) => w.item === 'id-meta' && w.detail.includes('deadbeef') && w.detail.includes(expected)))
  })

  test('a page outside any store (no ancestor .writeup.toml) skips id verification rather than guessing', () => {
    const file = writeTempPage(page({ extraHead: '<meta name="id" content="deadbeef">' }))
    const result = runSelfCheck(file)
    assert.ok(!result.items.some((i) => i.item === 'id-meta'))
  })
})

// ---------------------------------------------------------------------------
// Decision record layout rows (kinds.md 決定記録; writing.md "Prohibitions")
// ---------------------------------------------------------------------------

const DR_INDEX =
  '<table class="wu-table"><thead><tr><th>番号</th><th>決定</th><th>タグ</th><th>状態</th></tr></thead>' +
  '<tbody><tr><td>1</td><td><a href="#d1">案 A にする</a></td><td>経路</td><td>合意</td></tr></tbody></table>'

/** One decision in the h3 + summary sentence + prose + basis shape. */
function decision(n, { meta = true, prose = true } = {}) {
  return `<h3 id="d${n}">決定 ${n} は案 A にする</h3>` +
    (prose ? `<p>案 B を捨て、案 A を選ぶ。</p><p>案 A が勝つ理由。</p>` : '') +
    (meta ? '<p class="wu-meta">docs/adr/x.md (2026-08-20 合意)</p>' : '')
}

const DR_TAIL =
  '<section class="wu-section"><h2>却下した案</h2><p>案 B は捨てた。</p></section>' +
  '<section class="wu-section"><h2>未決・前提</h2><div class="wu-open"><ul><li>未決。</li></ul></div></section>' +
  '<section class="wu-section"><h2>次のステップ</h2><ol class="wu-steps"><li>実装。</li></ol></section>'

function decisionRecord({ index = DR_INDEX, decisions = decision(1), extra = '', kind = '決定記録' } = {}) {
  return page({
    kind,
    body:
      '<div class="wu-summary"><p>要約。</p></div>' + index +
      `<section class="wu-section"><h2>決まったこと</h2>${decisions}${extra}</section>` + DR_TAIL,
  })
}

const RELATION_FIGURE =
  '<h3>決定の関係図</h3><figure class="wu-figure" data-checks="pass">' +
  '<svg role="img"><title id="wu-d-r-title">関係図</title><desc id="wu-d-r-desc">d</desc></svg>' +
  '<figcaption>図 決定の関係図。矢印は制約する</figcaption></figure>'

describe('self-check: decision-shape (h3 + <p> + .wu-meta per decision)', () => {
  test('negative: h3 id="d<n>" followed by a <p> and a .wu-meta line is clean', () => {
    const result = itemsFor(decisionRecord())
    assert.ok(!result.items.some((i) => i.item === 'decision-shape'), JSON.stringify(result.items))
  })

  test('positive: a decision h3 with no .wu-meta before the next h3 warns, naming the h3', () => {
    const result = itemsFor(decisionRecord({ decisions: decision(1, { meta: false }) + decision(2) }))
    const hits = result.warnings.filter((w) => w.item === 'decision-shape')
    assert.equal(hits.length, 1)
    assert.ok(hits[0].detail.includes('決定 1 は案 A にする'))
    assert.ok(hits[0].detail.includes('.wu-meta'))
  })

  test('positive: a decision h3 with a .wu-meta but no <p> warns about the missing paragraph', () => {
    const result = itemsFor(decisionRecord({ decisions: decision(1, { prose: false }) }))
    const hit = result.warnings.find((w) => w.item === 'decision-shape')
    assert.ok(hit && hit.detail.includes('<p>'))
  })

  test('the 決定の関係図 h3 (no id="d<n>") is not treated as a decision', () => {
    const result = itemsFor(decisionRecord({ decisions: decision(1) + decision(2), extra: RELATION_FIGURE }))
    assert.ok(!result.items.some((i) => i.item === 'decision-shape'))
  })

  test('theme h2s between 決まったこと and 却下した案 keep the decisions in scope', () => {
    const decisions = decision(1) + '<h2>テーマ B</h2>' + decision(2, { meta: false })
    const result = itemsFor(decisionRecord({ decisions }))
    const hits = result.warnings.filter((w) => w.item === 'decision-shape')
    assert.equal(hits.length, 1)
    assert.ok(hits[0].detail.includes('決定 2'))
  })

  test('a page whose h3s carry no id="d<n>" has every h3 checked (card-per-theme layout)', () => {
    const decisions = '<h3>経路</h3><div class="wu-decision"><p><strong>決定:</strong> A。</p></div>'
    const result = itemsFor(decisionRecord({ decisions }))
    assert.ok(result.warnings.some((w) => w.item === 'decision-shape' && w.detail.includes('経路')))
  })

  test('not applied to other kinds', () => {
    const result = itemsFor(decisionRecord({ kind: '設計', decisions: decision(1, { meta: false }) }))
    assert.ok(!result.items.some((i) => i.item === 'decision-shape'))
  })
})

describe('self-check: label-repeat (same <p><strong>label:</strong> 3 or more times)', () => {
  const labelled = (label, n) => Array.from({ length: n }, () => `<p><strong>${label}</strong> 本文。</p>`).join('')

  test('positive: three <p><strong>決定:</strong> paragraphs warn with the label and the count', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + labelled('決定:', 3) }))
    const hit = result.warnings.find((w) => w.item === 'label-repeat')
    assert.ok(hit && hit.detail.includes('決定') && hit.detail.includes('3 times'))
  })

  test('positive: a full-width colon (：) counts the same', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + labelled('根拠：', 3) }))
    assert.ok(result.warnings.some((w) => w.item === 'label-repeat' && w.detail.includes('根拠')))
  })

  test('negative: two of the same label is not flagged', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + labelled('決定:', 2) }))
    assert.ok(!result.items.some((i) => i.item === 'label-repeat'))
  })

  test('negative: three different labels (one card) are not flagged', () => {
    const body = DEFAULT_BODY + labelled('決定:', 1) + labelled('重視したトレードオフ:', 1) + labelled('根拠:', 1)
    const result = itemsFor(page({ body }))
    assert.ok(!result.items.some((i) => i.item === 'label-repeat'))
  })

  test('negative: bold text without a trailing colon is not a label', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + labelled('強調', 3) }))
    assert.ok(!result.items.some((i) => i.item === 'label-repeat'))
  })

  test('applies regardless of kind (fires on a 作業メモ too)', () => {
    const result = itemsFor(page({ kind: '作業メモ', body: DEFAULT_BODY + labelled('結果:', 3) }))
    assert.ok(result.warnings.some((w) => w.item === 'label-repeat'))
  })
})

describe('self-check: decision-index (一覧表 before the first h2)', () => {
  test('negative: a .wu-table whose first header is 番号 before the first h2 is clean', () => {
    const result = itemsFor(decisionRecord())
    assert.ok(!result.items.some((i) => i.item === 'decision-index'))
  })

  test('positive: a 決定記録 with no such table warns', () => {
    const result = itemsFor(decisionRecord({ index: '' }))
    assert.ok(result.warnings.some((w) => w.item === 'decision-index'))
  })

  test('positive: the table after the first h2 does not count', () => {
    const result = itemsFor(decisionRecord({ index: '', extra: DR_INDEX }))
    assert.ok(result.warnings.some((w) => w.item === 'decision-index'))
  })

  test('positive: a table whose first header is not 番号 does not count', () => {
    const other = DR_INDEX.replace('<th>番号</th>', '<th>項目</th>')
    const result = itemsFor(decisionRecord({ index: other }))
    assert.ok(result.warnings.some((w) => w.item === 'decision-index'))
  })

  test('not applied to other kinds', () => {
    const result = itemsFor(decisionRecord({ kind: '設計', index: '' }))
    assert.ok(!result.items.some((i) => i.item === 'decision-index'))
  })
})

describe('self-check: decision-cards (.wu-decision is for 1–2 decisions)', () => {
  const card = '<div class="wu-decision"><p>決定。</p></div>'

  test('positive: three .wu-decision on a 決定記録 warn', () => {
    const result = itemsFor(decisionRecord({ extra: card + card + card }))
    const hit = result.warnings.find((w) => w.item === 'decision-cards')
    assert.ok(hit && hit.detail.includes('3 times') && hit.detail.includes('1–2'))
  })

  test('negative: two .wu-decision are allowed', () => {
    const result = itemsFor(decisionRecord({ extra: card + card }))
    assert.ok(!result.items.some((i) => i.item === 'decision-cards'))
  })

  test('not applied to other kinds', () => {
    const result = itemsFor(decisionRecord({ kind: '設計', extra: card + card + card }))
    assert.ok(!result.items.some((i) => i.item === 'decision-cards'))
  })
})

describe('self-check: relation-figure (info; 5 or more decisions need one 決定の関係図)', () => {
  const five = [1, 2, 3, 4, 5].map((n) => decision(n)).join('')

  test('positive: five decisions and no figure whose caption mentions 関係 is an info, not a warning', () => {
    const result = itemsFor(decisionRecord({ decisions: five }))
    const hit = result.infos.find((i) => i.item === 'relation-figure')
    assert.ok(hit && hit.detail.includes('5 decisions'))
    assert.ok(!result.warnings.some((w) => w.item === 'relation-figure'))
    assert.equal(result.ok, true)
  })

  test('negative: a figure whose caption contains 関係 satisfies the row', () => {
    const result = itemsFor(decisionRecord({ decisions: five, extra: RELATION_FIGURE }))
    assert.ok(!result.items.some((i) => i.item === 'relation-figure'))
  })

  test('negative: four decisions do not ask for one', () => {
    const result = itemsFor(decisionRecord({ decisions: [1, 2, 3, 4].map((n) => decision(n)).join('') }))
    assert.ok(!result.items.some((i) => i.item === 'relation-figure'))
  })

  test('a card-per-theme page counts its .wu-decision cards as the decisions', () => {
    const card = '<div class="wu-decision"><p>決定。</p></div>'
    const decisions = '<h3>テーマ</h3>' + card.repeat(5) + '<p class="wu-meta">x</p>'
    const result = itemsFor(decisionRecord({ decisions }))
    assert.ok(result.infos.some((i) => i.item === 'relation-figure' && i.detail.includes('5 decisions')))
  })

  test('--json output carries the info rows under "infos"', () => {
    const file = writeTempPage(decisionRecord({ decisions: five }))
    const run = spawnSync('node', [SELF_CHECK_BIN, file, '--json'], { encoding: 'utf8' })
    const out = JSON.parse(run.stdout)
    assert.equal(run.status, 0)
    assert.ok(out.infos.some((i) => i.item === 'relation-figure'))
  })
})

describe('self-check: kit stylesheet link (kit-css)', () => {
  test('a page carrying the template\'s own ./writeup.css href is an error', () => {
    const html = page().replace('<link rel="stylesheet" href="../_kit/writeup.css">', '<link rel="stylesheet" href="./writeup.css">')
    const result = itemsFor(html)
    assert.ok(result.errors.some((e) => e.item === 'kit-css'), JSON.stringify(result.errors))
  })

  test('a page with no stylesheet link at all is an error', () => {
    const html = page().replace('<link rel="stylesheet" href="../_kit/writeup.css">', '')
    assert.ok(itemsFor(html).errors.some((e) => e.item === 'kit-css'))
  })

  test('a correct ../_kit/writeup.css (any depth) passes, and so does the store-root ./_kit/ form', () => {
    assert.deepEqual(itemsFor(page()).errors.filter((e) => e.item === 'kit-css'), [])
    const deep = page().replace('href="../_kit/writeup.css"', 'href="../../../_kit/writeup.css"')
    assert.deepEqual(itemsFor(deep).errors.filter((e) => e.item === 'kit-css'), [])
    const root = page().replace('href="../_kit/writeup.css"', 'href="./_kit/writeup.css"')
    assert.deepEqual(itemsFor(root).errors.filter((e) => e.item === 'kit-css'), [])
  })

  test('a publish target with the CSS inlined in <style> is exempt', () => {
    const html = page().replace('<link rel="stylesheet" href="../_kit/writeup.css">', '<style>.wu-page{color:#000}</style>')
    assert.deepEqual(itemsFor(html).errors.filter((e) => e.item === 'kit-css'), [])
  })
})

describe('self-check: .wu-diffview', () => {
  const RENDERED =
    '<section class="wu-section"><h2>今日分かったこと</h2>' +
    '<figure class="wu-diffview" data-mode="unified">\n' +
    '<table class="wu-dv" data-mode="unified" data-lang="go">\n' +
    '<thead><tr><th class="wu-dv-file" colspan="4">x.go</th></tr></thead>\n' +
    '<tbody>\n<tr class="wu-dv-hunk"><td colspan="4">@@ -1,2 +1,2 @@</td></tr>\n' +
    '<tr class="wu-dv-del"><td class="wu-dv-no">1</td><td class="wu-dv-no"></td><td class="wu-dv-mark">−</td>' +
    '<td class="wu-dv-code">a := <mark class="wu-dv-w">1</mark></td></tr>\n' +
    '<tr class="wu-dv-add"><td class="wu-dv-no"></td><td class="wu-dv-no">1</td><td class="wu-dv-mark">+</td>' +
    '<td class="wu-dv-code">a := <mark class="wu-dv-w">2</mark></td></tr>\n' +
    '</tbody>\n</table>\n<figcaption>差分。</figcaption>\n' +
    '<script type="text/x-writeup-diff">\n--- a/x.go\n+++ b/x.go\n@@ -1,2 +1,2 @@\n-a := 1\n+a := 2\n</script>\n</figure>' +
    '</section>' +
    '<section class="wu-section"><h2>次にやること</h2><ol class="wu-steps"><li>短い文。</li></ol></section>'

  test('a rendered diff view passes: no diffview-unrendered error, no role-structure/markdown warnings for it', () => {
    const result = itemsFor(page({ body: RENDERED }))
    assert.ok(!result.errors.some((e) => e.item === 'diffview-unrendered'), JSON.stringify(result.errors))
    assert.ok(!result.errors.some((e) => e.item === 'role-structure'), JSON.stringify(result.errors))
    assert.ok(!result.warnings.some((w) => w.item === 'markdown-convertibility'), JSON.stringify(result.warnings))
  })

  test('<mark> is allowed inside a diff view (it is what the word mark uses)', () => {
    const result = itemsFor(page({ body: RENDERED }))
    assert.ok(!result.items.some((i) => i.detail && i.detail.includes('mark')), JSON.stringify(result.items))
  })

  test('a .wu-diffview with no rendered .wu-dv table is a diffview-unrendered error', () => {
    const body =
      '<section class="wu-section"><h2>今日分かったこと</h2>' +
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">\n--- a/x.go\n+++ b/x.go\n@@ -1,1 +1,1 @@\n-a\n+b\n</script>' +
      '<figcaption>未描画。</figcaption></figure></section>' +
      '<section class="wu-section"><h2>次にやること</h2><ol class="wu-steps"><li>短い文。</li></ol></section>'
    const result = itemsFor(page({ body }))
    assert.ok(result.errors.some((e) => e.item === 'diffview-unrendered'), JSON.stringify(result.errors))
  })

  test('a stray <mark> outside a diff view is still rejected by the role-structure allow-list', () => {
    const body =
      '<section class="wu-section"><h2>今日分かったこと</h2><p>ここに<mark>強調</mark>がある。</p></section>' +
      '<section class="wu-section"><h2>次にやること</h2><ol class="wu-steps"><li>短い文。</li></ol></section>'
    const result = itemsFor(page({ body }))
    assert.ok(
      result.items.some((i) => i.detail && i.detail.includes('mark')),
      'expected a finding naming <mark>: ' + JSON.stringify(result.items),
    )
  })
})

// ---------------------------------------------------------------------------
// .wu-shot (screenshot / photo) — row 6b and its role-structure interaction
// ---------------------------------------------------------------------------

describe('self-check: .wu-shot (screenshot / photo)', () => {
  const shot = (inner) => `<figure class="wu-shot">${inner}</figure>`

  test('ok case: a real file, alt present, is clean', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/pic.png" alt="実機の画面"><figcaption>実機の見え方</figcaption>'),
    })
    const file = writeTempPageWithAsset(html, 'shot-assets/pic.png')
    const result = runSelfCheck(file)
    assert.deepEqual(result.errors, [])
    assert.ok(!result.warnings.some((w) => w.item === 'shot'), JSON.stringify(result.warnings))
  })

  test('a .wu-shot with no <img> at all is an error, with a hint', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<figcaption>空の枠</figcaption>'),
    })
    const result = runSelfCheck(writeTempPage(html))
    const hit = result.errors.find((e) => e.item === 'shot' && /has no <img>/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
    assert.match(hit.detail, /空の枠/)
    assert.match(hit.detail, /→ add the <img>/)
  })

  test('an <img> with no src at all is an error naming the figure', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img alt="a"><figcaption>キャプション</figcaption>'),
    })
    const result = runSelfCheck(writeTempPage(html))
    const hit = result.errors.find((e) => e.item === 'shot' && /has no src/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
  })

  test('.wu-shot images totalling over 8MB is a warning naming the total', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/big.png" alt="a">'),
    })
    const file = writeTempPage(html)
    const assetDir = join(dirname(file), 'shot-assets')
    mkdirSync(assetDir, { recursive: true })
    // checkShot only sums file sizes on disk — the bytes don't need to be a
    // real PNG for the 8MB budget row to fire.
    writeFileSync(join(assetDir, 'big.png'), Buffer.alloc(9 * 1024 * 1024))
    const result = runSelfCheck(file)
    const hit = result.warnings.find((w) => w.item === 'shot' && /images total/.test(w.detail))
    assert.ok(hit, JSON.stringify(result.warnings))
    assert.match(hit.detail, /9\.0MB/)
    assert.match(hit.detail, /→ compress the screenshot/)
  })

  test('missing alt is an error naming the figure', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/pic.png"><figcaption>キャプション</figcaption>'),
    })
    const file = writeTempPageWithAsset(html, 'shot-assets/pic.png')
    const result = runSelfCheck(file)
    const hit = result.errors.find((e) => e.item === 'shot' && /missing alt text/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
    assert.match(hit.detail, /キャプション/)
  })

  test('an external (http) src is an error, not a page-relative or data: src', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="https://example.com/pic.png" alt="a">'),
    })
    const result = runSelfCheck(writeTempPage(html))
    assert.ok(result.errors.some((e) => e.item === 'shot' && /not page-relative or a data: URI/.test(e.detail)))
  })

  test('a page-relative src whose file does not exist is an error', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/missing.png" alt="a">'),
    })
    const result = runSelfCheck(writeTempPage(html))
    assert.ok(result.errors.some((e) => e.item === 'shot' && /image file does not exist/.test(e.detail)))
  })

  test('an <img> outside .wu-shot is a role-structure error carrying the .wu-shot hint', () => {
    const html = page({ body: DEFAULT_BODY + '<img src="x.png" alt="a">' })
    const result = runSelfCheck(writeTempPage(html))
    const hit = result.errors.find((e) => e.item === 'role-structure' && /<img>/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
    assert.match(hit.detail, /figure class="wu-shot"/)
    assert.match(hit.detail, /<slug>-assets\//)
  })

  test('a data: src is accepted with no shot or single-file error', () => {
    const dataUri = `data:image/png;base64,${makeTinyPng().toString('base64')}`
    const html = page({
      body: DEFAULT_BODY + shot(`<img src="${dataUri}" alt="a">`),
    })
    const result = runSelfCheck(writeTempPage(html))
    assert.deepEqual(result.errors.filter((e) => e.item === 'shot' || e.item === 'single-file'), [])
  })

  test('two <img> in one .wu-shot is an error (one picture per figure)', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/a.png" alt="a"><img src="shot-assets/b.png" alt="b">'),
    })
    const file = writeTempPageWithAsset(html, 'shot-assets/a.png')
    writeFileSync(join(dirname(file), 'shot-assets', 'b.png'), makeTinyPng())
    const result = runSelfCheck(file)
    const hit = result.errors.find((e) => e.item === 'shot' && /has 2 <img> elements/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
  })

  test('a page-relative src that escapes the page\'s own directory (../) is an error', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="../outside.png" alt="a">'),
    })
    const result = runSelfCheck(writeTempPage(html))
    assert.ok(result.errors.some((e) => e.item === 'shot' && /escapes the page's own directory/.test(e.detail)))
  })

  test('a src that is a symlink whose real target escapes the page\'s own directory is an error, with a symlink hint', () => {
    const html = page({
      body: DEFAULT_BODY + shot('<img src="shot-assets/link.png" alt="a">'),
    })
    const file = writeTempPage(html)
    const assetDir = join(dirname(file), 'shot-assets')
    mkdirSync(assetDir, { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), 'wu-selfcheck-outside-'))
    writeFileSync(join(outsideDir, 'secret.png'), makeTinyPng())
    symlinkSync(join(outsideDir, 'secret.png'), join(assetDir, 'link.png'))
    const result = runSelfCheck(file)
    const hit = result.errors.find((e) => e.item === 'shot' && /escapes the page's own directory/.test(e.detail))
    assert.ok(hit, JSON.stringify(result.errors))
    assert.match(hit.detail, /symlink/)
  })
})

describe('self-check: error hints (the "→ …" tail appended to a finding\'s detail)', () => {
  test('role-structure: a disallowed <img> points at .wu-shot, a disallowed tag points at components.md generically', () => {
    const imgResult = runSelfCheck(writeTempPage(page({ body: DEFAULT_BODY + '<img src="x.png" alt="a">' })))
    const imgHit = imgResult.errors.find((e) => e.item === 'role-structure' && /<img>/.test(e.detail))
    assert.match(imgHit.detail, /→.*wu-shot/)

    const asideResult = itemsForBody('<aside>x</aside>')
    const asideHit = asideResult.errors.find((e) => e.item === 'role-structure' && /aside/.test(e.detail))
    assert.match(asideHit.detail, /→ use a role-named \.wu-\* component from components\.md/)
  })

  test('chrome, figure-pass, kit-css, single-file, required-meta and svg-a11y each carry a hint tail', () => {
    const badKitCss = itemsFor(page().replace('<link rel="stylesheet" href="../_kit/writeup.css">', '<link rel="stylesheet" href="./writeup.css">'))
    assert.match(badKitCss.errors.find((e) => e.item === 'kit-css').detail, /→ run build/)

    const badChrome = itemsFor(page().replace('<p class="wu-lede">l</p>', ''))
    assert.match(badChrome.errors.find((e) => e.item === 'chrome').detail, /→ copy \.wu-header\/\.wu-footer verbatim/)

    const fig = '<figure class="wu-figure"><svg role="img"><title>t</title><desc>d</desc></svg><figcaption>c</figcaption></figure>'
    const badFigure = itemsForBody(fig)
    assert.match(badFigure.errors.find((e) => e.item === 'figure-pass').detail, /→ re-render with render-diagram\.mjs/)

    const badSingleFile = itemsFor(page({ extraLink: '<script src="https://evil.example.com/a.js"></script>' }))
    assert.match(badSingleFile.errors.find((e) => e.item === 'single-file').detail, /→ copy the file next to the page/)

    const badMeta = itemsFor(page().replace('<meta name="kind" content="作業メモ">', ''))
    assert.match(badMeta.errors.find((e) => e.item === 'required-meta' && /kind/.test(e.detail)).detail, /→ add the missing tag/)

    const badSvg = itemsForBody('<figure class="wu-figure" data-checks="pass"><svg><title>t</title><desc>d</desc></svg></figure>')
    assert.match(badSvg.errors.find((e) => e.item === 'svg-a11y').detail, /→ never hand-edit generated diagram markup/)
  })

  test('accent-budget (warn) and shot each carry a hint tail too', () => {
    const badAccent = itemsForBody('<p><span class="wu-accent">a</span> <span class="wu-accent">b</span></p>')
    assert.match(badAccent.warnings.find((w) => w.item === 'accent-budget').detail, /→ keep exactly one \.wu-accent/)

    const html = page({ body: DEFAULT_BODY + '<figure class="wu-shot"><img src="shot-assets/pic.png"></figure>' })
    const file = writeTempPageWithAsset(html, 'shot-assets/pic.png')
    const shotHit = runSelfCheck(file).errors.find((e) => e.item === 'shot' && /missing alt text/.test(e.detail))
    assert.match(shotHit.detail, /→ add alt text describing what the screenshot shows/)
  })

  test('diffview-unrendered keeps its own "run build" wording, with no duplicated hint tail', () => {
    const body =
      '<section class="wu-section"><h2>今日分かったこと</h2>' +
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">\n--- a/x.go\n+++ b/x.go\n@@ -1,1 +1,1 @@\n-a\n+b\n</script>' +
      '<figcaption>未描画。</figcaption></figure></section>' +
      '<section class="wu-section"><h2>次にやること</h2><ol class="wu-steps"><li>短い文。</li></ol></section>'
    const result = itemsForBody(body)
    const hit = result.errors.find((e) => e.item === 'diffview-unrendered')
    assert.equal((hit.detail.match(/run build/g) || []).length, 1)
  })

  test('the JSON/CLI shape is unchanged — the hint lives inside "detail", not a new field', () => {
    const file = writeTempPage(page({ kind: 'no-such-kind' }))
    const run = spawnSync(process.execPath, [SELF_CHECK_BIN, file, '--json'], { encoding: 'utf8' })
    const out = JSON.parse(run.stdout)
    const hit = out.errors.find((e) => e.item === 'required-meta' && /8 kinds/.test(e.detail))
    assert.ok(hit)
    assert.deepEqual(Object.keys(hit).sort(), ['detail', 'item', 'level'])
  })
})
