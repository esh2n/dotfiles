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

  test('date comes from the filename prefix; updated falls back to date when <meta updated> is absent', () => {
    const store = freshStore()
    const { records } = buildStore(store)
    const legacy = records.find((r) => r.path.startsWith('legacy/'))
    assert.equal(legacy.date, '2019-05-01')
    assert.equal(legacy.updated, '2019-05-01') // legacy page has no <meta updated>
    const design = records.find((r) => r.path.startsWith('design/'))
    assert.equal(design.date, '2026-08-05')
    assert.equal(design.updated, '2026-08-05')
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

  test('index.html embeds exactly one inline <script> of at most 60 lines', () => {
    const store = freshStore()
    buildStore(store)
    const html = readFileSync(join(store, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length, 1)
    const lineCount = scripts[0][1].trim().split('\n').length
    assert.ok(lineCount <= 60, `script has ${lineCount} lines`)
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
