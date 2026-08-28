import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runSelfCheck, writeMetaChecks } from '../bin/self-check.mjs'

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

describe('self-check: reference pages', () => {
  test('kit/samples.html: figure row fails because the hand-drawn SVG lacks data-checks="pass"', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(result.errors.some((e) => e.item === 'figure-pass'), 'expected a figure-pass error')
  })

  test('kit/samples.html: chrome and required meta still pass (only content-shape rows should fail)', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(!result.errors.some((e) => e.item === 'chrome'))
    assert.ok(!result.errors.some((e) => e.item === 'required-meta'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'))
  })

  test('kit/samples.html: svg a11y passes even though data-checks is missing (independent rows)', () => {
    const result = runSelfCheck(join(ROOT, 'kit', 'samples.html'))
    assert.ok(!result.errors.some((e) => e.item === 'svg-a11y'))
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

  test('row 4 (role-structure): a <nav> inside main is a disallowed element', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<nav>x</nav>' }))
    assert.ok(result.errors.some((e) => e.item === 'role-structure' && /nav/.test(e.detail)))
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

  test('row 13 (parentheticals): 2+ parenthetical groups in one sentence is a warning', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<p>これは（注記1）と（注記2）を含む文である。</p>' }))
    assert.ok(result.warnings.some((w) => w.item === 'parentheticals'))
  })

  test('row 13: a single parenthetical group is not flagged', () => {
    const result = itemsFor(page({ body: DEFAULT_BODY + '<p>これは（注記1）だけを含む文である。</p>' }))
    assert.ok(!result.warnings.some((w) => w.item === 'parentheticals'))
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
