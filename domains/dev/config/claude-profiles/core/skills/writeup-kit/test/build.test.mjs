import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { buildStore } from '../bin/build.mjs'
import { runSelfCheck } from '../bin/self-check.mjs'

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
      'legacy/2019-05-01-legacy-note.html',
    ])
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
    const design = records.find((r) => r.path.startsWith('design/'))
    assert.equal(design.date, '2026-08-05')
    // design page's <meta updated> is date-only ("2026-08-05") -> same date, time filled in
    assert.match(design.updated, /^2026-08-05T\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  test('checks is parsed from <meta name="checks"> into a key=value map', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const design = records.find((r) => r.path.startsWith('design/'))
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

  test('index.html embeds exactly one inline <script> of at most 120 lines', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length, 1)
    const lineCount = scripts[0][1].trim().split('\n').length
    assert.ok(lineCount <= 120, `script has ${lineCount} lines`)
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
    assert.equal(result.counts.total, 4)
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
    const design = records.find((r) => r.path.startsWith('design/'))
    // ...but the manifest's id is always the computed one, independent of the page's own meta
    assert.notEqual(design.id, 'deadbeef')
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
    assert.match(html, /3 件中 3 件/) // fixture store has 3 pages, none filtered initially
  })

  test('emits a kind chip per kind (legacy pages grouped under a "legacy" chip) with counts', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /data-group="kind" data-value="決定記録"[^>]*>決定記録 \(1\)/)
    assert.match(html, /data-group="kind" data-value="設計"[^>]*>設計 \(1\)/)
    assert.match(html, /data-group="kind" data-value="legacy"[^>]*>legacy \(1\)/)
  })

  test('emits a folder chip per non-empty folder with counts', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    assert.match(html, /data-group="folder" data-value="decision"[^>]*>decision \(1\)/)
    assert.match(html, /data-group="folder" data-value="design"[^>]*>design \(1\)/)
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
