import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { buildStore, renderStoreSwitcher } from '../bin/build.mjs'
import { runSelfCheck } from '../bin/self-check.mjs'
import { faviconDataUri, statusFromChecks } from '../bin/lib/favicon.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wu-build-'))
  cpSync(FIXTURE_STORE, dir, { recursive: true })
  return dir
}

describe('buildStore(): manifest fields', () => {
  test('produces one manifest record per page, skipping index.html/_kit/public/.publish', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const paths = records.map((r) => r.path).sort()
    assert.deepEqual(paths, [
      'decision/2026-08-01-example-decision.html',
      'design/2026-08-05-example-design.html',
      'design/2026-08-06-example-design-review.html',
      'design/2026-08-09-example-design-decision.html',
      'legacy/2019-05-01-legacy-note.html',
    ])
  })

  test('skips a top-level underscore directory (e.g. _scratch/) entirely — not indexed as a page', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const paths = records.map((r) => r.path)
    assert.ok(!paths.some((p) => p.startsWith('_scratch/')), `expected no _scratch/ page, got: ${paths.join(', ')}`)
  })

  test('reads title/description/kind from <head> meta', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.equal(decision.title, '再試行方針の決定')
    assert.equal(decision.kind, '決定記録')
    assert.ok(decision.description.length > 0)
  })

  test('folder is the leading path segment, empty for a store-root page', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.equal(decision.folder, 'decision')
  })

  test('date comes from the filename prefix; a date-only/absent <meta updated> becomes a full datetime in the date it names', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const legacy = records.find((r) => r.path.startsWith('legacy/'))
    assert.equal(legacy.date, '2019-05-01')
    // legacy page has no <meta updated> at all -> falls back to date, with a synthesized time-of-day
    assert.match(legacy.updated, /^2019-05-01T\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    const design = records.find((r) => r.path === 'design/2026-08-05-example-design.html')
    assert.equal(design.date, '2026-08-05')
    // design page's <meta updated> is date-only ("2026-08-05") -> same date, time filled in
    assert.match(design.updated, /^2026-08-05T\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  test('checks is parsed from <meta name="checks"> into a key=value map', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const design = records.find((r) => r.path === 'design/2026-08-05-example-design.html')
    assert.deepEqual(design.checks, { lint: 'pass', 'self-check': 'pass', diagram: '1/1' })
    const legacy = records.find((r) => r.path.startsWith('legacy/'))
    assert.deepEqual(legacy.checks, {})
  })

  test('sha256 matches an independently computed hash of the file', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    const buf = readFileSync(join(store, decision.path))
    const expected = createHash('sha256').update(buf).digest('hex')
    assert.equal(decision.sha256, expected)
    assert.equal(decision.bytes, buf.length)
  })

  test('legacy/** pages carry legacy: true, others legacy: false', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const byPath = Object.fromEntries(records.map((r) => [r.path, r]))
    assert.equal(byPath['legacy/2019-05-01-legacy-note.html'].legacy, true)
    assert.equal(byPath['decision/2026-08-01-example-decision.html'].legacy, false)
  })
})

describe('buildStore(): sort order', () => {
  test('sorts by updated descending, falling back to date descending', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const updatedValues = records.map((r) => r.updated)
    const sorted = [...updatedValues].sort().reverse()
    assert.deepEqual(updatedValues, sorted)
    // The decision page (updated 2026-08-10) sorts ahead of the design page
    // (updated 2026-08-05), which sorts ahead of the 2019 legacy page.
    assert.equal(records[0].path, 'decision/2026-08-01-example-decision.html')
    assert.equal(records[records.length - 1].path, 'legacy/2019-05-01-legacy-note.html')
  })
})

describe('buildStore(): kit css href follows the page depth', () => {
  test('a page moved two folders deep gets ../../_kit/writeup.css', () => {
    const store = freshStore()
    const deep = join(store, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    const src = readFileSync(join(store, 'decision', '2026-08-01-example-decision.html'), 'utf8')
    writeFileSync(join(deep, '2026-08-02-moved.html'), src) // still links ../_kit/writeup.css
    buildStore(store)
    const out = readFileSync(join(deep, '2026-08-02-moved.html'), 'utf8')
    assert.match(out, /href="\.\.\/\.\.\/_kit\/writeup\.css"/)
    assert.ok(!/href="\.\.\/_kit\/writeup\.css"/.test(out))
    buildStore(store)
    assert.equal(readFileSync(join(deep, '2026-08-02-moved.html'), 'utf8'), out) // idempotent
  })
})

describe('buildStore(): writes and idempotence', () => {
  test('writes manifest.json, index.html, and _kit/writeup.css', () => {
    const store = freshStore()
    buildStore(store)
    assert.doesNotThrow(() => readFileSync(join(store, 'manifest.json'), 'utf8'))
    assert.doesNotThrow(() => readFileSync(join(store, 'index.html'), 'utf8'))
    assert.doesNotThrow(() => readFileSync(join(store, '_kit', 'writeup.css'), 'utf8'))
  })

  test('index.html satisfies the single-file self-check row (only _kit css + Google Fonts, no external scripts)', () => {
    const store = freshStore()
    buildStore(store)
    const result = runSelfCheck(join(store, 'index.html'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'), JSON.stringify(result.errors))
  })

  test('index.html embeds exactly one inline <script> of at most 160 lines', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length, 1)
    const lineCount = scripts[0][1].trim().split('\n').length
    assert.ok(lineCount <= 160, `script has ${lineCount} lines`)
  })

  test('index.html lists every page and links to it', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /href="decision\/2026-08-01-example-decision\.html"/)
    assert.match(html, /href="design\/2026-08-05-example-design\.html"/)
    assert.match(html, /href="legacy\/2019-05-01-legacy-note\.html"/)
  })

  test('a second build with no source changes reports changed: false', () => {
    const store = freshStore()
    buildStore(store)
    const second = buildStore(store)
    assert.equal(second.changed, false)
  })

  test('--check (check: true) does not write any files', () => {
    const store = freshStore()
    const before = buildStore(store, { check: true })
    assert.equal(before.changed, true) // nothing generated yet
    assert.throws(() => readFileSync(join(store, 'manifest.json'), 'utf8'))
  })

  test('--check reports changed: true after a page is edited, and false once rebuilt', () => {
    const store = freshStore()
    buildStore(store)
    assert.equal(buildStore(store, { check: true }).changed, false)

    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const html = readFileSync(pagePath, 'utf8').replace('再試行方針の決定', '再試行方針の決定（改訂）')
    writeFileSync(pagePath, html)

    assert.equal(buildStore(store, { check: true }).changed, true)
    buildStore(store)
    assert.equal(buildStore(store, { check: true }).changed, false)
  })

  test('a kit CSS version bump is picked up by _kit/writeup.css on the next build', () => {
    const store = freshStore()
    buildStore(store)
    const kitCssPath = join(store, '_kit', 'writeup.css')
    writeFileSync(kitCssPath, '/* stale copy */')
    const result = buildStore(store, { check: true })
    assert.equal(result.cssChanged, true)
    buildStore(store)
    const synced = readFileSync(kitCssPath, 'utf8')
    assert.notEqual(synced, '/* stale copy */')
  })

  test('a new page dropped into the store appears in the next build', () => {
    const store = freshStore()
    buildStore(store)
    mkdirSync(join(store, 'notes'), { recursive: true })
    writeFileSync(
      join(store, 'notes', '2026-09-01-extra.html'),
      '<html><head><title>追加ページ</title></head><body>x</body></html>',
    )
    const result = buildStore(store)
    assert.ok(result.records.some((r) => r.path === 'notes/2026-09-01-extra.html'))
    assert.equal(result.counts.total, 6)
  })
})

describe('buildStore(): id / slug / ref', () => {
  test('id is 8 hex chars, deterministic from the store-relative path alone', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.match(decision.id, /^[0-9a-f]{8}$/)
    const expected = createHash('sha256').update(decision.path).digest('hex').slice(0, 8)
    assert.equal(decision.id, expected)
  })

  test('id is stable across independent builds of two different stores with the same relative path', () => {
    const storeA = freshStore()
    const storeB = freshStore()
    const a = buildStore(storeA).records.find((r) => r.path.startsWith('decision/'))
    const b = buildStore(storeB).records.find((r) => r.path.startsWith('decision/'))
    assert.equal(a.id, b.id)
  })

  test('id is unchanged across a revision (content changes, path does not)', () => {
    const store = freshStore()
    const before = buildStore(store).records.find((r) => r.path.startsWith('decision/'))
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const html = readFileSync(pagePath, 'utf8').replace('再試行方針の決定', '再試行方針の決定（改訂）')
    writeFileSync(pagePath, html)
    const after = buildStore(store).records.find((r) => r.path.startsWith('decision/'))
    assert.equal(after.id, before.id)
  })

  test('two different paths get two different ids', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const ids = records.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('slug strips the date prefix and .html; ref is folder/slug', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path === 'decision/2026-08-01-example-decision.html')
    assert.equal(decision.slug, 'example-decision')
    assert.equal(decision.ref, 'decision/example-decision')
  })

  test('ref is bare slug (no leading slash) for a store-root page', () => {
    const store = freshStore()
    writeFileSync(
      join(store, '2026-09-02-root-page.html'),
      '<html><head><title>root</title><meta name="date" content="2026-09-02"></head><body>x</body></html>',
    )
    const { records } = buildStore(store)
    const root = records.find((r) => r.path === '2026-09-02-root-page.html')
    assert.equal(root.folder, '')
    assert.equal(root.slug, 'root-page')
    assert.equal(root.ref, 'root-page')
  })

  test('build inserts <meta name="id"> into a page that lacks one', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    const html = readFileSync(join(store, decision.path), 'utf8')
    assert.match(html, new RegExp(`<meta name="id" content="${decision.id}">`))
  })

  test('meta insertion is idempotent: a second build does not touch the page bytes again', () => {
    const store = freshStore()
    buildStore(store)
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const afterFirst = readFileSync(pagePath, 'utf8')
    const idCount = (afterFirst.match(/<meta name="id"/g) || []).length
    assert.equal(idCount, 1)
    buildStore(store)
    const afterSecond = readFileSync(pagePath, 'utf8')
    assert.equal(afterSecond, afterFirst)
  })

  test('--check never writes an id meta into a page', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const before = readFileSync(pagePath, 'utf8')
    const result = buildStore(store, { check: true })
    const after = readFileSync(pagePath, 'utf8')
    assert.equal(after, before)
    assert.ok(!after.includes('<meta name="id"'))
    assert.equal(result.pagesChanged, true)
  })

  test('a page whose <meta name="id"> is already present is left untouched by build', () => {
    const store = freshStore()
    const pagePath = join(store, 'design', '2026-08-05-example-design.html')
    const withId = readFileSync(pagePath, 'utf8').replace(
      '<meta name="date" content="2026-08-05">',
      '<meta name="date" content="2026-08-05">\n<meta name="id" content="deadbeef">',
    )
    writeFileSync(pagePath, withId)
    const { records } = buildStore(store)
    // build never overwrites an existing id meta, even if it doesn't match the computed value
    assert.match(readFileSync(pagePath, 'utf8'), /content="deadbeef"/)
    const design = records.find((r) => r.path === 'design/2026-08-05-example-design.html')
    // ...but the manifest's id is always the computed one, independent of the page's own meta
    assert.notEqual(design.id, 'deadbeef')
  })
})

describe('buildStore(): .wu-nav back-to-index href', () => {
  function headerOf(html) {
    return /<header[\s\S]*?<\/header>/.exec(html)[0]
  }

  test('depth 1 (one folder down): href is ../index.html', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'design', '2026-08-05-example-design.html'), 'utf8')
    assert.match(headerOf(html), /<nav class="wu-nav"><a class="wu-back" href="\.\.\/index\.html">/)
  })

  test('depth 0 (store-root page): href is index.html (no ../)', () => {
    const store = freshStore()
    writeFileSync(
      join(store, '2026-09-02-root-page.html'),
      readFileSync(join(store, 'decision', '2026-08-01-example-decision.html'), 'utf8')
        .replace('<meta name="date" content="2026-08-01">', '<meta name="date" content="2026-09-02">'),
    )
    buildStore(store)
    const html = readFileSync(join(store, '2026-09-02-root-page.html'), 'utf8')
    assert.match(headerOf(html), /<nav class="wu-nav"><a class="wu-back" href="index\.html">/)
  })

  test('depth 3 (three folders down): href is ../../../index.html', () => {
    const store = freshStore()
    mkdirSync(join(store, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(
      join(store, 'a', 'b', 'c', '2026-09-02-deep.html'),
      readFileSync(join(store, 'decision', '2026-08-01-example-decision.html'), 'utf8')
        .replace('<meta name="date" content="2026-08-01">', '<meta name="date" content="2026-09-02">'),
    )
    buildStore(store)
    const html = readFileSync(join(store, 'a', 'b', 'c', '2026-09-02-deep.html'), 'utf8')
    assert.match(headerOf(html), /<nav class="wu-nav"><a class="wu-back" href="\.\.\/\.\.\/\.\.\/index\.html">/)
  })

  test('inserts the nav as .wu-header\'s first child exactly once on a page that predates it', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    buildStore(store)
    const html = readFileSync(pagePath, 'utf8')
    const navCount = (html.match(/<nav class="wu-nav"/g) || []).length
    assert.equal(navCount, 1)
    assert.match(html, /<header class="wu-header"><nav class="wu-nav">/)
  })

  test('a second build makes no further change to a page whose nav href is already correct', () => {
    const store = freshStore()
    buildStore(store)
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const afterFirst = readFileSync(pagePath, 'utf8')
    const result = buildStore(store)
    const afterSecond = readFileSync(pagePath, 'utf8')
    assert.equal(afterSecond, afterFirst)
    assert.equal(result.pagesChanged, false)
  })

  test('a stale nav href (page moved to a different depth) is rewritten to the correct one', () => {
    const store = freshStore()
    buildStore(store)
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const staleHtml = readFileSync(pagePath, 'utf8').replace(
      '<nav class="wu-nav"><a class="wu-back" href="../index.html">一覧</a></nav>',
      '<nav class="wu-nav"><a class="wu-back" href="../../index.html">一覧</a></nav>',
    )
    writeFileSync(pagePath, staleHtml)
    buildStore(store)
    const fixed = readFileSync(pagePath, 'utf8')
    assert.match(headerOf(fixed), /href="\.\.\/index\.html"/)
  })

  test('a page without .wu-header (legacy/**) gets no nav (build still fills in the unrelated id meta)', () => {
    const store = freshStore()
    const pagePath = join(store, 'legacy', '2019-05-01-legacy-note.html')
    const before = readFileSync(pagePath, 'utf8')
    assert.ok(!before.includes('wu-nav'))
    buildStore(store)
    const after = readFileSync(pagePath, 'utf8')
    assert.ok(!after.includes('wu-nav'))
  })

  test('--check reports pagesChanged: true for a nav-less page without writing it', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const before = readFileSync(pagePath, 'utf8')
    const result = buildStore(store, { check: true })
    assert.equal(readFileSync(pagePath, 'utf8'), before)
    assert.ok(!before.includes('wu-nav'))
    assert.equal(result.pagesChanged, true)
  })

  test('a built page still passes self-check\'s chrome row', () => {
    const store = freshStore()
    buildStore(store)
    const result = runSelfCheck(join(store, 'design', '2026-08-05-example-design.html'))
    assert.ok(!result.errors.some((e) => e.item === 'chrome'), JSON.stringify(result.errors))
  })
})

describe('buildStore(): updated datetime', () => {
  test('a full ISO datetime <meta updated> is carried through unchanged', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const html = readFileSync(pagePath, 'utf8').replace(
      '<meta name="updated" content="2026-08-10">',
      '<meta name="updated" content="2026-08-10T14:05+09:00">',
    )
    writeFileSync(pagePath, html)
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.equal(decision.updated, '2026-08-10T14:05+09:00')
  })

  test('a date-only <meta updated> keeps that date and gets a synthesized time-of-day', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.match(decision.updated, /^2026-08-10T\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  test('build never rewrites <meta name="updated"> on the page itself', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'decision', '2026-08-01-example-decision.html'), 'utf8')
    assert.match(html, /<meta name="updated" content="2026-08-10">/)
  })

  test('sort order is unaffected by the synthesized time-of-day: date ordering still wins', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    assert.equal(records[0].path, 'decision/2026-08-01-example-decision.html')
    assert.equal(records[records.length - 1].path, 'legacy/2019-05-01-legacy-note.html')
  })
})

describe('buildStore(): search-first index.html', () => {
  test('passes self-check\'s single-file row (kit CSS + Google Fonts only, no other external refs)', () => {
    const store = freshStore()
    buildStore(store)
    const result = runSelfCheck(join(store, 'index.html'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'), JSON.stringify(result.errors))
  })

  test('has a search input, a sort select, and a result-count line', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /<input id="wu-q"[^>]*autofocus[^>]*placeholder="題名・要約・slug・id"/)
    assert.match(html, /<select id="wu-sort"/)
    assert.match(html, /id="wu-count"/)
    // fixture store has 5 pages across 3 topic folders, none filtered initially
    assert.match(html, /5 件中 5 件 &middot; 3 グループ/)
  })

  test('emits a kind chip per kind (legacy pages grouped under a "legacy" chip) with counts', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /data-group="kind" data-value="決定記録"[^>]*>決定記録 \(2\)/)
    assert.match(html, /data-group="kind" data-value="設計"[^>]*>設計 \(2\)/)
    assert.match(html, /data-group="kind" data-value="legacy"[^>]*>legacy \(1\)/)
  })

  test('emits a folder chip per non-empty folder with counts', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /data-group="folder" data-value="decision"[^>]*>decision \(1\)/)
    assert.match(html, /data-group="folder" data-value="design"[^>]*>design \(3\)/)
    assert.match(html, /data-group="folder" data-value="legacy"[^>]*>legacy \(1\)/)
  })

  test('each row shows id (mono), ref, and updated as "YYYY-MM-DD HH:MM"', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const decision = records.find((r) => r.path.startsWith('decision/'))
    assert.match(html, new RegExp(`class="wu-idx-id">${decision.id}<`))
    assert.match(html, new RegExp(`<span>${decision.ref}</span>`))
    assert.match(html, /<span class="wu-idx-updated">\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/span>/)
  })

  test('a page whose checks include a fail gets the warn-tone class, others get the muted class', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const html0 = readFileSync(pagePath, 'utf8').replace('lint=pass;self-check=pass', 'lint=fail;self-check=pass')
    writeFileSync(pagePath, html0)
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /class="wu-idx-warn">lint=fail; self-check=pass</)
    assert.match(html, /class="wu-idx-muted">lint=pass; self-check=pass; diagram=1\/1</)
  })

  test('the row search blob (data-s) is NFKC-normalized and lowercased', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    // title "再試行方針の決定" contains no ASCII letters to case-fold, but the
    // description does get folded; assert the attribute exists and is lowercase ascii-safe
    const m = /data-s="([^"]*)"/.exec(html)
    assert.ok(m)
    assert.equal(m[1], m[1].toLowerCase())
  })

  test('id links resolve: /id/<id> route data is present via manifest.json for serve.mjs to read', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const manifest = JSON.parse(readFileSync(join(store, 'manifest.json'), 'utf8'))
    for (const r of records) {
      assert.ok(manifest.some((m) => m.id === r.id && m.path === r.path))
    }
  })
})

describe('buildStore(): manifest folderPath', () => {
  test('folderPath is the full directory path (folder for a one-segment path, "" for a store-root page)', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path === 'decision/2026-08-01-example-decision.html')
    assert.equal(decision.folderPath, 'decision')
    const review = records.find((r) => r.path === 'design/2026-08-06-example-design-review.html')
    assert.equal(review.folderPath, 'design')
  })

  test('a manifest record carries ref, slug, and folderPath together', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const decision = records.find((r) => r.path === 'decision/2026-08-01-example-decision.html')
    assert.equal(decision.ref, 'decision/example-decision')
    assert.equal(decision.slug, 'example-decision')
    assert.equal(decision.folderPath, 'decision')
  })
})

describe('buildStore(): grouped index view ("まとまり")', () => {
  function groupedBlock(html) {
    const m = /<div class="wu-idx-groups" id="wu-groups">([\s\S]*?)<\/div>\s*<ul class="wu-idx-list" id="wu-rows"/.exec(html)
    return m[1]
  }

  test('renders one <details class="wu-idx-group"> per topic folder (folderPath), including single-page folders', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    assert.match(block, /<details class="wu-idx-group" data-folder="decision">/)
    assert.match(block, /<details class="wu-idx-group" data-folder="design">/)
    assert.match(block, /<details class="wu-idx-group" data-folder="legacy">/)
  })

  test('groups render collapsed by default (no "open" attribute on <details>)', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    assert.doesNotMatch(block, /<details class="wu-idx-group" open /)
    assert.doesNotMatch(block, /<details[^>]* open[^>]* class="wu-idx-group"/)
  })

  test('a group header shows the page count, the group\'s latest updated, and its kind chips', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    // design/ now holds 3 pages (draft, review, decision); latest updated is the decision page's 2026-08-09
    assert.match(block, /data-folder="design">[\s\S]*?class="wu-idx-gcount" data-total="3">3 件</)
    assert.match(block, /data-folder="design"[\s\S]*?class="wu-idx-gupdated">2026-08-09 \d{2}:\d{2}</)
    assert.match(block, /data-folder="design"[\s\S]*?class="wu-idx-gkinds">(?:<span class="wu-idx-gk">[^<]+<\/span>){2}/)
    // decision/ is a single-page folder and still renders as a (compact) group
    assert.match(block, /data-folder="decision">[\s\S]*?class="wu-idx-gcount" data-total="1">1 件</)
  })

  test('the folder-path label bolds only the last segment', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /<span class="wu-idx-gpath"><b>design<\/b><\/span>/)
  })

  test('groups are ordered by the group\'s own latest updated, descending', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    // decision (updated 2026-08-10) > design (latest member updated 2026-08-09) > legacy (2019)
    const iDecision = block.indexOf('data-folder="decision"')
    const iDesign = block.indexOf('data-folder="design"')
    const iLegacy = block.indexOf('data-folder="legacy"')
    assert.ok(iDecision >= 0 && iDesign > iDecision && iLegacy > iDesign)
  })

  test('a group lists its own pages sorted by updated descending', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    const designGroup = /<details class="wu-idx-group" data-folder="design">([\s\S]*?)<\/details>/.exec(block)[1]
    const iDecision = designGroup.indexOf('design/2026-08-09-example-design-decision.html')
    const iReview = designGroup.indexOf('design/2026-08-06-example-design-review.html')
    const iDraft = designGroup.indexOf('design/2026-08-05-example-design.html')
    assert.ok(iDecision >= 0 && iReview > iDecision && iDraft > iReview)
  })

  test('the flat row list is still present (each page appears in #wu-rows too, for the "フラット" view)', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const flatBlock = /<ul class="wu-idx-list" id="wu-rows" hidden>([\s\S]*?)<\/ul>\s*<\/section>/.exec(html)[1]
    assert.match(flatBlock, /href="decision\/2026-08-01-example-decision\.html"/)
    assert.match(flatBlock, /href="design\/2026-08-06-example-design-review\.html"/)
    assert.match(flatBlock, /href="design\/2026-08-09-example-design-decision\.html"/)
    assert.match(flatBlock, /href="legacy\/2019-05-01-legacy-note\.html"/)
  })

  test('renders a まとまり/フラット view toggle and expand/collapse-all controls', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /<button type="button" id="wu-view-grouped"[^>]*>まとまり<\/button>/)
    assert.match(html, /<button type="button" id="wu-view-flat"[^>]*>フラット<\/button>/)
    assert.match(html, /<button type="button" id="wu-expand-all"[^>]*>すべて展開<\/button>/)
    assert.match(html, /<button type="button" id="wu-collapse-all"[^>]*>すべて折りたたむ<\/button>/)
  })

  test('index.html still satisfies the single-file self-check row with the grouped view added', () => {
    const store = freshStore()
    buildStore(store)
    const result = runSelfCheck(join(store, 'index.html'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'), JSON.stringify(result.errors))
  })

  test('a group\'s <summary> carries the clickable-header class', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const block = groupedBlock(html)
    assert.match(block, /<summary class="wu-idx-ghead">/)
  })

  test('the script persists an OPEN set under the new storage key, not the old "collapsed" key', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /writeup\.index\.open/)
    assert.doesNotMatch(html, /localStorage\.setItem\('writeup\.index\.collapsed'/)
  })
})

describe('buildStore(): status favicon', () => {
  function iconHrefOf(html) {
    const m = /<link rel="icon" href="([^"]*)">/.exec(html)
    return m ? m[1] : null
  }

  function decodedSvgOf(html) {
    const href = iconHrefOf(html)
    return href ? decodeURIComponent(href.slice('data:image/svg+xml,'.length)) : null
  }

  test('build inserts <link rel="icon"> exactly once into a page that lacks one', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'design', '2026-08-05-example-design.html'), 'utf8')
    assert.equal((html.match(/<link rel="icon"/g) || []).length, 1)
  })

  test('the inserted href matches faviconDataUri({kind, status}) computed from the page\'s own meta', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'design', '2026-08-05-example-design.html'), 'utf8')
    // fixture: kind=設計, checks=lint=pass;self-check=pass;diagram=1/1 -> status pass
    const expected = faviconDataUri({ kind: '設計', status: 'pass' })
    assert.equal(iconHrefOf(html), expected)
  })

  test('a page whose checks include self-check=fail gets the fail-ring favicon', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const html0 = readFileSync(pagePath, 'utf8').replace('lint=pass;self-check=pass', 'lint=pass;self-check=fail')
    writeFileSync(pagePath, html0)
    buildStore(store)
    const html = readFileSync(pagePath, 'utf8')
    assert.equal(decodedSvgOf(html), decodeURIComponent(faviconDataUri({ kind: '決定記録', status: 'fail' }).slice('data:image/svg+xml,'.length)))
    assert.match(decodedSvgOf(html), /stroke-width="3"/)
  })

  test('a legacy page (no kind, no checks meta) gets the pending, middle-dot favicon', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'legacy', '2019-05-01-legacy-note.html'), 'utf8')
    const svg = decodedSvgOf(html)
    assert.match(svg, />·<\/text>/)
    assert.match(svg, /stroke-dasharray="3 2"/)
    assert.equal(statusFromChecks({}), 'pending')
  })

  test('index.html carries the index (three-bar) favicon', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const svg = decodedSvgOf(html)
    assert.ok(svg)
    assert.ok(!svg.includes('<text'))
    assert.equal((svg.match(/fill="#ffffff"/g) || []).length, 3)
  })

  test('meta insertion is idempotent: a second build does not touch the icon link again', () => {
    const store = freshStore()
    buildStore(store)
    const pagePath = join(store, 'design', '2026-08-05-example-design.html')
    const afterFirst = readFileSync(pagePath, 'utf8')
    buildStore(store)
    const afterSecond = readFileSync(pagePath, 'utf8')
    assert.equal(afterSecond, afterFirst)
  })

  test('a stale icon href (checks changed since the last build) is rewritten to the correct one', () => {
    const store = freshStore()
    buildStore(store)
    const pagePath = join(store, 'design', '2026-08-05-example-design.html')
    const before = readFileSync(pagePath, 'utf8')
    const iconCountBefore = (before.match(/<link rel="icon"/g) || []).length
    assert.equal(iconCountBefore, 1)

    const withFail = before.replace('lint=pass;self-check=pass', 'lint=fail;self-check=pass')
    writeFileSync(pagePath, withFail)
    buildStore(store)
    const after = readFileSync(pagePath, 'utf8')
    assert.equal((after.match(/<link rel="icon"/g) || []).length, 1)
    assert.equal(decodedSvgOf(after), decodeURIComponent(faviconDataUri({ kind: '設計', status: 'fail' }).slice('data:image/svg+xml,'.length)))
  })

  test('--check reports pagesChanged: true for a page without a favicon link yet, without writing it', () => {
    const store = freshStore()
    const pagePath = join(store, 'decision', '2026-08-01-example-decision.html')
    const before = readFileSync(pagePath, 'utf8')
    const result = buildStore(store, { check: true })
    assert.equal(readFileSync(pagePath, 'utf8'), before)
    assert.ok(!before.includes('rel="icon"'))
    assert.equal(result.pagesChanged, true)
  })

  test('a built page still passes self-check\'s single-file row with the icon link present', () => {
    const store = freshStore()
    buildStore(store)
    const result = runSelfCheck(join(store, 'design', '2026-08-05-example-design.html'))
    assert.ok(!result.errors.some((e) => e.item === 'single-file'), JSON.stringify(result.errors))
  })

  test('the icon is inserted right after <meta name="checks"> when that meta is present', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'design', '2026-08-05-example-design.html'), 'utf8')
    assert.match(html, /<meta name="checks"[^>]*>\n<link rel="icon"/)
  })

  test('with neither a checks meta nor a stylesheet link (legacy/**), the icon falls back to just before </head>', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'legacy', '2019-05-01-legacy-note.html'), 'utf8')
    assert.ok(!html.includes('rel="stylesheet"'))
    assert.match(html, /<link rel="icon"[^>]*>\n<\/head>/)
  })
})

// regression: a page without <head> (meta tags at top level) must be read and
// must not receive a second <meta name="id"> on rebuild
import { test as _t2 } from 'node:test'
import assert2 from 'node:assert/strict'
import { mkdtempSync as _mk, writeFileSync as _wf, readFileSync as _rf, mkdirSync as _md } from 'node:fs'
import { tmpdir as _tmp } from 'node:os'
import { join as _j } from 'node:path'
_t2('build: headless page meta is read and id insertion stays idempotent', async () => {
  const { buildStore } = await import('../bin/build.mjs')
  const dir = _mk(_j(_tmp(), 'wu-headless-'))
  _md(_j(dir, 'notes'), { recursive: true })
  const page = _j(dir, 'notes', '2026-08-28-headless.html')
  _wf(page, '<title>Headless</title>\n<meta name="description" content="d">\n<meta name="kind" content="設計">\n<meta name="date" content="2026-08-28">\n<main><section class="wu-section"><h2>x</h2><p>y</p></section></main>\n')
  await buildStore(dir)
  await buildStore(dir)
  const text = _rf(page, 'utf8')
  assert2.equal((text.match(/name="id"/g) || []).length, 1)
  const manifest = JSON.parse(_rf(_j(dir, 'manifest.json'), 'utf8'))
  const rec = (Array.isArray(manifest) ? manifest : (manifest.pages || manifest.entries)).find((r) => r.path.endsWith('headless.html'))
  assert2.equal(rec.kind, '設計')
})

describe('buildStore(): syntax highlighting of .wu-code / .wu-diff', () => {
  function pageWithBlocks({ code, diff }) {
    return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<title>Highlight fixture</title>\n' +
      '<meta name="description" content="d">\n<meta name="kind" content="設計">\n<meta name="date" content="2026-08-28">\n' +
      '<meta name="checks" content="lint=pass;self-check=pass">\n<link rel="stylesheet" href="../_kit/writeup.css">\n</head>\n<body>\n' +
      '<div class="wu-page">\n<header class="wu-header"><h1>Highlight fixture</h1></header>\n<main>\n<section class="wu-section">\n<h2>code</h2>\n' +
      code + '\n' + diff + '\n</section>\n</main>\n</body>\n</html>\n'
  }

  function freshHighlightStore() {
    const dir = mkdtempSync(join(tmpdir(), 'wu-hl-'))
    mkdirSync(join(dir, 'notes'), { recursive: true })
    const page = join(dir, 'notes', '2026-08-28-highlight.html')
    const codeBlock = '<pre class="wu-code" data-lang="go"><code>func Greet(name string) string {\n\treturn "Hello, " + name + "! &lt;3"\n}</code></pre>'
    const diffBlock = '<pre class="wu-diff" data-lang="diff"><code> ctx\n-old\n+new</code></pre>'
    writeFileSync(page, pageWithBlocks({ code: codeBlock, diff: diffBlock }))
    return { dir, page }
  }

  test('build wraps .wu-code content in wu-tok- spans and marks the <pre> data-hl="1"', () => {
    const { page } = freshHighlightStore()
    buildStore(dirname(page).replace(/\/notes$/, ''))
    const html = readFileSync(page, 'utf8')
    assert.match(html, /<pre class="wu-code" data-lang="go" data-hl="1">/)
    assert.ok(html.includes('wu-tok-kw'), html)
    assert.ok(html.includes('wu-tok-str'), html)
  })

  test('build wraps .wu-diff content in wu-tok-add/wu-tok-del spans and marks data-hl="1"', () => {
    const { page } = freshHighlightStore()
    buildStore(dirname(page).replace(/\/notes$/, ''))
    const html = readFileSync(page, 'utf8')
    assert.match(html, /<pre class="wu-diff" data-lang="diff" data-hl="1">/)
    assert.ok(html.includes('wu-tok-add'), html)
    assert.ok(html.includes('wu-tok-del'), html)
  })

  test('a "<" already escaped in the source is preserved (not double-escaped) through highlighting', () => {
    const { page } = freshHighlightStore()
    buildStore(dirname(page).replace(/\/notes$/, ''))
    const html = readFileSync(page, 'utf8')
    assert.ok(html.includes('&lt;3'), html)
    assert.ok(!html.includes('&amp;lt;3'), html)
  })

  test('idempotent: a second build does not re-wrap already-highlighted spans', () => {
    const { page } = freshHighlightStore()
    const store = dirname(page).replace(/\/notes$/, '')
    buildStore(store)
    const afterFirst = readFileSync(page, 'utf8')
    buildStore(store)
    const afterSecond = readFileSync(page, 'utf8')
    assert.equal(afterSecond, afterFirst)
    // no nested/doubled spans: every open wu-tok- span has exactly one matching close in sequence
    const opens = (afterFirst.match(/<span class="wu-tok-/g) || []).length
    const closes = (afterFirst.match(/<\/span>/g) || []).length
    assert.equal(opens, closes)
    assert.equal((afterFirst.match(/data-hl="1"/g) || []).length, 2)
  })

  test('a block that already carries wu-tok- spans (pre-highlighted) is left untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-hl-pre-'))
    mkdirSync(join(dir, 'notes'), { recursive: true })
    const page = join(dir, 'notes', '2026-08-28-pre.html')
    const already = '<pre class="wu-code" data-lang="go" data-hl="1"><code><span class="wu-tok-kw">func</span> x() {}</code></pre>'
    writeFileSync(page, pageWithBlocks({ code: already, diff: '<pre class="wu-diff" data-lang="diff"><code> ctx</code></pre>' }))
    buildStore(dir)
    const html = readFileSync(page, 'utf8')
    assert.equal((html.match(/wu-tok-kw/g) || []).length, 1)
  })

  test('--check reports pagesChanged: true for a page with an un-highlighted .wu-code block, without writing it', () => {
    const { page } = freshHighlightStore()
    const store = dirname(page).replace(/\/notes$/, '')
    const before = readFileSync(page, 'utf8')
    const result = buildStore(store, { check: true })
    assert.equal(readFileSync(page, 'utf8'), before)
    assert.equal(result.pagesChanged, true)
  })

  test('a highlighted page still passes self-check\'s markdown-convertibility row (wu-tok-* spans are not flagged)', () => {
    const { page } = freshHighlightStore()
    const store = dirname(page).replace(/\/notes$/, '')
    buildStore(store)
    const result = runSelfCheck(page)
    assert.ok(!result.warnings.some((w) => w.item === 'markdown-convertibility' && w.detail.includes('wu-tok-')), JSON.stringify(result.warnings))
  })
})

describe('buildStore(): store switcher in the index header', () => {
  const ENV_KEYS = ['WRITEUP_STORE', 'WRITEUP_STORES']
  let savedEnv
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  /** Two registered stores (`work`, `private` = default) under one base
   * dir, `work` populated from the fixture; returns the built work index. */
  function registeredStores() {
    const base = mkdtempSync(join(tmpdir(), 'wu-switch-'))
    cpSync(FIXTURE_STORE, join(base, 'work'), { recursive: true })
    mkdirSync(join(base, 'private'), { recursive: true })
    writeFileSync(join(base, 'stores.toml'), 'default = "private"\n\n[[store]]\nname = "work"\npath = "work"\ndescription = "仕事"\n\n[[store]]\nname = "private"\npath = "private"\ndescription = "個人"\n')
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    return base
  }

  test('renderStoreSwitcher: relative ../<name>/index.html links, aria-current on the current store, description as title', () => {
    const stores = [{ name: 'work', description: '仕事' }, { name: 'private', description: '' }]
    const html = renderStoreSwitcher('private', stores)
    assert.equal(html, '<nav class="wu-idx-stores" aria-label="store"><a href="../work/index.html" title="仕事">work</a><a href="../private/index.html" aria-current="page">private</a></nav>\n')
    assert.equal(renderStoreSwitcher('', stores), '')
    assert.equal(renderStoreSwitcher('other', stores), '')
    assert.equal((renderStoreSwitcher('work', stores).match(/aria-current/g) || []).length, 1)
  })

  test('a registered store\'s index carries the switcher above the eyebrow, inside .wu-header', () => {
    const base = registeredStores()
    buildStore(join(base, 'work'))
    const html = readFileSync(join(base, 'work', 'index.html'), 'utf8')
    const header = /<header class="wu-header">([\s\S]*?)<\/header>/.exec(html)[1]
    const nav = header.indexOf('<nav class="wu-idx-stores"')
    const eyebrow = header.indexOf('<p class="wu-eyebrow">')
    assert.ok(nav !== -1 && eyebrow !== -1 && nav < eyebrow, header)
    assert.match(header, /<a href="\.\.\/work\/index\.html" aria-current="page" title="仕事">work<\/a>/)
    assert.match(header, /<a href="\.\.\/private\/index\.html" title="個人">private<\/a>/)
    assert.doesNotMatch(header, /aria-current="page"[^>]*>private/)
    // Styled with the existing index tokens only; nothing remembered client-side.
    assert.match(html, /\.wu-idx-stores a\[aria-current="page"\]\{color:var\(--wu-ink\);\}/)
    assert.doesNotMatch(html, /localStorage[^\n]*stores/)
    // The private (default) store gets the same switcher with its own current mark.
    buildStore(join(base, 'private'))
    const other = readFileSync(join(base, 'private', 'index.html'), 'utf8')
    assert.match(other, /<a href="\.\.\/private\/index\.html" aria-current="page" title="個人">private<\/a>/)
    assert.match(other, /<a href="\.\.\/work\/index\.html" title="仕事">work<\/a>/)
  })

  test('an unregistered store (or no registry) builds an index without a switcher', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.doesNotMatch(html, /wu-idx-stores"/)
    assert.match(html, /<p class="wu-eyebrow">writeup store<\/p>/)
  })
})
