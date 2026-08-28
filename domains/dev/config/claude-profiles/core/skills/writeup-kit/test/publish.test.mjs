import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { publish, inlineKitCss, findPrivateWordHits, assertSize, PublishError } from '../bin/publish.mjs'
import { runSelfCheck } from '../bin/self-check.mjs'
import { buildStore } from '../bin/build.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')
const PUBLISH_BIN = join(ROOT, 'bin', 'publish.mjs')
const DECISION_REL = join('decision', '2026-08-01-example-decision.html')

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wu-publish-'))
  cpSync(FIXTURE_STORE, dir, { recursive: true })
  buildStore(dir) // syncs _kit/writeup.css, as a real store always has before publish runs
  return dir
}

describe('publish: pre-stage helpers', () => {
  test('inlineKitCss replaces the ../_kit/writeup.css link with an inline <style>', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
    const staged = inlineKitCss(html, store)
    assert.ok(!staged.includes('href="../_kit/writeup.css"'))
    assert.match(staged, /<style>[\s\S]*<\/style>/)
  })

  test('inlineKitCss keeps the Google Fonts <link> untouched', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
    const staged = inlineKitCss(html, store)
    assert.match(staged, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\//)
  })

  test('inlineKitCss embeds the actual CSS content, not an empty style block', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
    const staged = inlineKitCss(html, store)
    const css = readFileSync(join(store, '_kit', 'writeup.css'), 'utf8')
    assert.ok(staged.includes(css.trim().slice(0, 40)))
  })

  test('findPrivateWordHits finds a case-insensitive match in body text', () => {
    const html = '<html><head><title>t</title></head><body>this mentions AcmeCorp here</body></html>'
    const hits = findPrivateWordHits(html, ['acmecorp'])
    assert.deepEqual(hits, ['acmecorp'])
  })

  test('findPrivateWordHits finds a match inside <meta> content', () => {
    const html = '<html><head><title>t</title><meta name="description" content="project-phoenix rollout"></head><body>clean</body></html>'
    const hits = findPrivateWordHits(html, ['project-phoenix'])
    assert.deepEqual(hits, ['project-phoenix'])
  })

  test('findPrivateWordHits returns [] when nothing matches', () => {
    const html = '<html><head><title>t</title></head><body>nothing sensitive here</body></html>'
    assert.deepEqual(findPrivateWordHits(html, ['acmecorp', 'project-phoenix']), [])
  })

  test('assertSize passes under the 16MB ceiling', () => {
    assert.equal(assertSize('x'.repeat(1024)), 1024)
  })

  test('assertSize throws PublishError(6) over the 16MB ceiling', () => {
    assert.throws(() => assertSize('x'.repeat(17 * 1024 * 1024)), (e) => e instanceof PublishError && e.code === 6)
  })
})

describe('publish(): targets', () => {
  test('--to file writes the staged (CSS-inlined) page to --out', () => {
    const store = freshStore()
    const outFile = join(store, 'out.html')
    const result = publish(join(store, DECISION_REL), { to: 'file', out: outFile, store })
    assert.equal(result.ok, true)
    assert.equal(result.output, outFile)
    const written = readFileSync(outFile, 'utf8')
    assert.match(written, /<style>/)
  })

  test('--to file without --out is a usage error (exit 2)', () => {
    const store = freshStore()
    assert.throws(
      () => publish(join(store, DECISION_REL), { to: 'file', store }),
      (e) => e instanceof PublishError && e.code === 2,
    )
  })

  test('--to artifact writes to <store>/.publish/<slug>.artifact.html', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store })
    const expected = join(store, '.publish', '2026-08-01-example-decision.artifact.html')
    assert.equal(result.output, expected)
    assert.ok(existsSync(expected))
  })

  test('--to cloudflare is refused with exit code 5 when access_required is true and unverified', () => {
    const store = freshStore()
    assert.throws(
      () => publish(join(store, DECISION_REL), { to: 'cloudflare', store }),
      (e) => e instanceof PublishError && e.code === 5,
    )
  })

  test('--to cloudflare succeeds once access_verified = true is set', () => {
    const store = freshStore()
    const tomlPath = join(store, '.writeup.toml')
    writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8') + '\naccess_verified = true\n')
    const result = publish(join(store, DECISION_REL), { to: 'cloudflare', store })
    assert.equal(result.ok, true)
    const expected = join(store, 'public', DECISION_REL)
    assert.ok(existsSync(expected))
    assert.match(result.command, /wrangler pages deploy public --project-name example-writeup/)
  })

  test('--dry-run reports the plan without writing anything or touching the network', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.ok(!existsSync(join(store, '.publish')))
  })

  test('--dry-run on cloudflare still surfaces the access-required block (exit 5)', () => {
    const store = freshStore()
    assert.throws(
      () => publish(join(store, DECISION_REL), { to: 'cloudflare', store, dryRun: true }),
      (e) => e instanceof PublishError && e.code === 5,
    )
  })
})

describe('publish(): pre-stage guards', () => {
  test('refuses to publish when self-check fails (exit code 3)', () => {
    const store = freshStore()
    const badPage = join(store, 'bad.html')
    writeFileSync(badPage, '<html><head><title>t</title><meta name="kind" content="not-a-kind"></head><body>x</body></html>')
    assert.throws(
      () => publish(badPage, { to: 'file', out: join(store, 'o.html'), store }),
      (e) => e instanceof PublishError && e.code === 3,
    )
    // Confirm this is genuinely a self-check failure, not something else.
    assert.equal(runSelfCheck(badPage).ok, false)
  })

  test('refuses to publish when a private word appears on the page (exit code 4)', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
      .replace('実装コストを抑えつつ一斉再試行を避けた。', 'acmecorpの実装コストを抑えつつ一斉再試行を避けた。')
    const page = join(store, 'private.html')
    writeFileSync(page, html)
    assert.throws(
      () => publish(page, { to: 'file', out: join(store, 'o.html'), store }),
      (e) => e instanceof PublishError && e.code === 4 && /acmecorp/.test(e.detail),
    )
  })

  test('a private word appearing only in <meta name="sources"> is still caught', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
      .replace('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex"><meta name="sources" content="[project-phoenix internal doc]">')
    const page = join(store, 'private-meta.html')
    writeFileSync(page, html)
    assert.throws(
      () => publish(page, { to: 'file', out: join(store, 'o.html'), store }),
      (e) => e instanceof PublishError && e.code === 4,
    )
  })
})

describe('publish: CLI', () => {
  test('exit code 0 for a clean --to file publish', () => {
    const store = freshStore()
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, join(store, DECISION_REL), '--to', 'file', '--out', join(store, 'cli-out.html'), '--store', store,
    ])
    assert.equal(r.status, 0)
    assert.ok(existsSync(join(store, 'cli-out.html')))
  })

  test('exit code 4 on the CLI for a private-word hit', () => {
    const store = freshStore()
    const html = readFileSync(join(store, DECISION_REL), 'utf8')
      .replace('実装コストを抑えつつ一斉再試行を避けた。', 'ACME-INTERNALの方針。')
    const page = join(store, 'private-cli.html')
    writeFileSync(page, html)
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, page, '--to', 'file', '--out', join(store, 'cli-out2.html'), '--store', store,
    ])
    assert.equal(r.status, 4)
  })

  test('usage error (missing --to) exits 2', () => {
    const store = freshStore()
    const r = spawnSync(process.execPath, [PUBLISH_BIN, join(store, DECISION_REL), '--store', store])
    assert.equal(r.status, 2)
  })
})
