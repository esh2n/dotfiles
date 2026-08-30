import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { publish, inlineKitCss, adjustBackNav, findPrivateWordHits, assertSize, inlinePageAssets, PublishError } from '../bin/publish.mjs'
import { runSelfCheck } from '../bin/self-check.mjs'
import { buildStore } from '../bin/build.mjs'
import { makeTinyPng } from './helpers/tiny-png.mjs'

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

describe('inlineKitCss(): a commented-out example link (kit/template.html shape) is ignored', () => {
  // The exact comment kit/template.html keeps right before its real <link>
  // — an authored page copied from the template keeps this too, and it
  // quotes the very same href the real regex is looking for.
  const TEMPLATE_COMMENT =
    '<!--\n' +
    '  A page inside the store links the kit two directories up:\n' +
    '    <link rel="stylesheet" href="../_kit/writeup.css">\n' +
    '  template.html and samples.html live inside kit/ itself, so they\n' +
    '  link the sibling file directly instead.\n' +
    '-->\n'
  const REAL_LINK = '<link rel="stylesheet" href="../_kit/writeup.css">'

  test('the CSS is inlined at the real link, not inside the comment; exactly one <style> remains, and no real link survives', () => {
    const store = freshStore()
    const html = `<html><head><title>t</title>\n${TEMPLATE_COMMENT}${REAL_LINK}\n</head><body>x</body></html>`
    const staged = inlineKitCss(html, store)
    assert.equal((staged.match(/<style>/g) || []).length, 1)
    const withoutComments = staged.replace(/<!--[\s\S]*?-->/g, '')
    assert.ok(!withoutComments.includes('_kit/writeup.css'), 'no real <link> to _kit/writeup.css should remain outside the comment')
    const commentEnd = staged.indexOf('-->') + 3
    assert.ok(staged.indexOf('<style>') > commentEnd, 'the <style> must be inserted after the comment closes, not inside it')
  })

  test('publish(): a page copied verbatim from kit/template.html (comment kept) renders styled', () => {
    const store = freshStore()
    const pagePath = join(store, DECISION_REL)
    const html = readFileSync(pagePath, 'utf8')
    assert.ok(html.includes(REAL_LINK))
    writeFileSync(pagePath, html.replace(REAL_LINK, TEMPLATE_COMMENT + REAL_LINK))
    const outFile = join(store, 'out-template-comment.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    const staged = readFileSync(outFile, 'utf8')
    assert.equal((staged.match(/<style>/g) || []).length, 1)
    const css = readFileSync(join(store, '_kit', 'writeup.css'), 'utf8')
    assert.ok(staged.includes(css.trim().slice(0, 40)), 'the real kit CSS must be inlined, not left empty/missing')
  })

  test('inlineKitCss throws PublishError(8) when a real link still survives after inlining (defense in depth)', () => {
    const store = freshStore()
    const html = `<head>${REAL_LINK}${REAL_LINK}</head>`
    assert.throws(() => inlineKitCss(html, store), (e) => e instanceof PublishError && e.code === 8)
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

describe('adjustBackNav(): .wu-nav pre-stage handling', () => {
  const withNav = (href) =>
    `<header class="wu-header"><nav class="wu-nav"><a class="wu-back" href="${href}">一覧</a></nav>` +
    `<p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>`

  test('--to file drops .wu-nav entirely', () => {
    const out = adjustBackNav(withNav('../index.html'), 'file', '/does/not/matter')
    assert.ok(!/<nav class="wu-nav"/.test(out))
    assert.ok(!/wu-back/.test(out))
  })

  test('--to artifact drops .wu-nav entirely', () => {
    const out = adjustBackNav(withNav('../index.html'), 'artifact', '/does/not/matter')
    assert.ok(!/<nav class="wu-nav"/.test(out))
  })

  test('--to cloudflare drops .wu-nav when <store>/public/index.html does not exist yet', () => {
    const store = freshStore()
    const out = adjustBackNav(withNav('../index.html'), 'cloudflare', store)
    assert.ok(!/<nav class="wu-nav"/.test(out))
  })

  test('--to cloudflare rewrites the href to /index.html when <store>/public/index.html exists', () => {
    const store = freshStore()
    mkdirSync(join(store, 'public'), { recursive: true })
    writeFileSync(join(store, 'public', 'index.html'), '<html></html>')
    const out = adjustBackNav(withNav('../index.html'), 'cloudflare', store)
    assert.match(out, /<a class="wu-back" href="\/index\.html">/)
  })

  test('a page with no .wu-nav at all is left untouched (any target)', () => {
    const headerOnly = '<header class="wu-header"><p class="wu-eyebrow">e</p><h1>t</h1><p class="wu-lede">l</p></header>'
    assert.equal(adjustBackNav(headerOnly, 'file', '/x'), headerOnly)
    assert.equal(adjustBackNav(headerOnly, 'cloudflare', '/x'), headerOnly)
  })

  test('publish(): --to file writes a staged page with .wu-nav removed', () => {
    const store = freshStore()
    const outFile = join(store, 'out-file.html')
    const result = publish(join(store, DECISION_REL), { to: 'file', out: outFile, store })
    assert.equal(result.ok, true)
    assert.ok(!/<nav class="wu-nav"/.test(readFileSync(outFile, 'utf8')))
  })

  test('publish(): --to artifact writes a staged page with .wu-nav removed', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store })
    assert.ok(!/<nav class="wu-nav"/.test(readFileSync(result.output, 'utf8')))
  })

  test('publish(): --to cloudflare with no public/index.html yet removes .wu-nav', () => {
    const store = freshStore()
    const tomlPath = join(store, '.writeup.toml')
    writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8') + '\naccess_verified = true\n')
    const result = publish(join(store, DECISION_REL), { to: 'cloudflare', store })
    assert.ok(!/<nav class="wu-nav"/.test(readFileSync(result.output, 'utf8')))
  })

  test('publish(): --to cloudflare with an existing public/index.html rewrites the href to /index.html', () => {
    const store = freshStore()
    const tomlPath = join(store, '.writeup.toml')
    writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8') + '\naccess_verified = true\n')
    mkdirSync(join(store, 'public'), { recursive: true })
    writeFileSync(join(store, 'public', 'index.html'), '<html></html>')
    const result = publish(join(store, DECISION_REL), { to: 'cloudflare', store })
    assert.match(readFileSync(result.output, 'utf8'), /<a class="wu-back" href="\/index\.html">/)
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

describe('publish(): status favicon survives staging', () => {
  test('--to file keeps the <link rel="icon"> href unchanged', () => {
    const store = freshStore()
    const original = readFileSync(join(store, DECISION_REL), 'utf8')
    const iconMatch = /<link rel="icon" href="[^"]*">/.exec(original)
    assert.ok(iconMatch, 'fixture page should already carry a favicon link after freshStore()\'s buildStore()')
    const outFile = join(store, 'out-icon.html')
    const result = publish(join(store, DECISION_REL), { to: 'file', out: outFile, store })
    assert.equal(result.ok, true)
    assert.ok(readFileSync(outFile, 'utf8').includes(iconMatch[0]))
  })

  test('--to artifact keeps the <link rel="icon"> href unchanged', () => {
    const store = freshStore()
    const original = readFileSync(join(store, DECISION_REL), 'utf8')
    const iconMatch = /<link rel="icon" href="[^"]*">/.exec(original)
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store })
    assert.ok(readFileSync(result.output, 'utf8').includes(iconMatch[0]))
  })

  test('--to cloudflare keeps the <link rel="icon"> href unchanged', () => {
    const store = freshStore()
    const tomlPath = join(store, '.writeup.toml')
    writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8') + '\naccess_verified = true\n')
    const original = readFileSync(join(store, DECISION_REL), 'utf8')
    const iconMatch = /<link rel="icon" href="[^"]*">/.exec(original)
    const result = publish(join(store, DECISION_REL), { to: 'cloudflare', store })
    assert.ok(readFileSync(result.output, 'utf8').includes(iconMatch[0]))
  })

  test('the staged page still satisfies self-check\'s single-file row (icon is a data: href)', () => {
    const store = freshStore()
    const outFile = join(store, 'out-icon-check.html')
    publish(join(store, DECISION_REL), { to: 'file', out: outFile, store })
    const result = runSelfCheck(outFile)
    assert.ok(!result.errors.some((e) => e.item === 'single-file'), JSON.stringify(result.errors))
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

describe('publish(): build\'s rendering passes are applied before staging', () => {
  const CODE = '<pre class="wu-code" data-lang="go"><code>func main() {\n\treturn "ok"\n}</code></pre>\n'
  const DIFF = '<figure class="wu-diffview" data-mode="unified" data-lang="go"><script type="text/x-writeup-diff">\n--- a/x.go\n+++ b/x.go\n@@ -1 +1 @@\n-old := 1\n+new := 2\n</script><figcaption>c</figcaption></figure>\n'

  function pageWith(store, extra) {
    const pagePath = join(store, DECISION_REL)
    const html = readFileSync(pagePath, 'utf8')
    assert.ok(html.includes('</main>'))
    writeFileSync(pagePath, html.replace('</main>', extra + '</main>'))
    return pagePath
  }

  test('a never-built page gets its .wu-code highlighted in the staged output, while the store copy stays as written', () => {
    const store = freshStore()
    const pagePath = pageWith(store, CODE)
    const outFile = join(store, 'out.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    const staged = readFileSync(outFile, 'utf8')
    assert.match(staged, /<span class="wu-tok-kw">func<\/span>/)
    assert.match(staged, /data-hl="1"/)
    assert.ok(!readFileSync(pagePath, 'utf8').includes('wu-tok-'))
  })

  test('a never-built .wu-diffview is rendered into a .wu-dv table in the staged output', () => {
    const store = freshStore()
    const pagePath = pageWith(store, DIFF)
    const outFile = join(store, 'out.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    const staged = readFileSync(outFile, 'utf8')
    assert.match(staged, /<table class="wu-dv"/)
    assert.match(staged, /text\/x-writeup-diff/)
  })

  test('the staged output carries the viewport meta even when the page lacks it', () => {
    const store = freshStore()
    const pagePath = join(store, DECISION_REL)
    writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace(/<meta name="viewport"[^>]*>\n?/, ''))
    assert.ok(!readFileSync(pagePath, 'utf8').includes('name="viewport"'))
    const outFile = join(store, 'out.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    assert.match(readFileSync(outFile, 'utf8'), /<meta name="viewport" content="width=device-width, initial-scale=1">/)
  })

  test('an already-built page stages byte-identically to the build\'s rendering (the passes are idempotent)', () => {
    const store = freshStore()
    const pagePath = pageWith(store, CODE + DIFF)
    buildStore(store)
    const built = readFileSync(pagePath, 'utf8')
    const outFile = join(store, 'out.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    const staged = readFileSync(outFile, 'utf8')
    const codeOf = (s) => s.slice(s.indexOf('<pre class="wu-code"'), s.indexOf('</main>'))
    assert.equal(codeOf(staged), codeOf(built))
  })

  test('kit/samples.html publishes with highlighted code and a rendered diff view', () => {
    const outFile = join(freshStore(), 'samples.html')
    publish(join(ROOT, 'kit', 'samples.html'), { to: 'file', out: outFile, store: FIXTURE_STORE })
    const staged = readFileSync(outFile, 'utf8')
    assert.match(staged, /<span class="wu-tok-kw">type<\/span>/)
    assert.match(staged, /<table class="wu-dv"/)
  })

  test('kit/samples.html\'s .wu-shot sample is inlined as a data: URI, not left page-relative', () => {
    const outFile = join(freshStore(), 'samples.html')
    publish(join(ROOT, 'kit', 'samples.html'), { to: 'file', out: outFile, store: FIXTURE_STORE })
    const staged = readFileSync(outFile, 'utf8')
    assert.match(staged, /<img src="data:image\/png;base64,/)
    assert.ok(!staged.includes('src="samples-assets/'))
  })
})

describe('inlinePageAssets(): .wu-shot image inlining', () => {
  test('a page-relative <img src> is replaced with a data: URI holding the exact file bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-publish-assets-'))
    mkdirSync(join(dir, 'shot-assets'), { recursive: true })
    const png = makeTinyPng()
    writeFileSync(join(dir, 'shot-assets', 'pic.png'), png)
    const html = '<figure class="wu-shot"><img src="shot-assets/pic.png" alt="a"></figure>'
    const out = inlinePageAssets(html, dir)
    assert.match(out, /<img src="data:image\/png;base64,/)
    const b64 = /src="data:image\/png;base64,([^"]+)"/.exec(out)[1]
    assert.ok(Buffer.from(b64, 'base64').equals(png))
  })

  test('a data: src and an http(s) src are left untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-publish-assets-'))
    const html = '<img src="data:image/png;base64,AAAA" alt="a"><img src="https://example.com/x.png" alt="b">'
    assert.equal(inlinePageAssets(html, dir), html)
  })

  test('a page-relative src whose file is missing on disk is left untouched (defensive; self-check already gates this before publish reaches here)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-publish-assets-'))
    const html = '<img src="shot-assets/missing.png" alt="a">'
    assert.equal(inlinePageAssets(html, dir), html)
  })

  test('mime is chosen from the file extension (png/jpg/jpeg/gif/webp/svg)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-publish-assets-'))
    writeFileSync(join(dir, 'pic.jpg'), makeTinyPng())
    const out = inlinePageAssets('<img src="pic.jpg" alt="a">', dir)
    assert.match(out, /src="data:image\/jpeg;base64,/)
  })

  test('publish(): the staged output has no page-relative .wu-shot src left', () => {
    const store = freshStore()
    const pagePath = join(store, DECISION_REL)
    const pageDir = dirname(pagePath)
    const assetDir = join(pageDir, '2026-08-01-example-decision-assets')
    mkdirSync(assetDir, { recursive: true })
    writeFileSync(join(assetDir, 'shot.png'), makeTinyPng())
    const html = readFileSync(pagePath, 'utf8')
    const shot = '<figure class="wu-shot"><img src="2026-08-01-example-decision-assets/shot.png" alt="実機の画面"><figcaption>c</figcaption></figure>'
    writeFileSync(pagePath, html.replace('</main>', shot + '</main>'))
    const outFile = join(store, 'out-shot.html')
    publish(pagePath, { to: 'file', out: outFile, store })
    const staged = readFileSync(outFile, 'utf8')
    assert.match(staged, /<img src="data:image\/png;base64,/)
    assert.ok(!staged.includes('src="2026-08-01-example-decision-assets'))
  })
})
