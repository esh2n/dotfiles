import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { publish, inlineKitCss, adjustBackNav, findPrivateWordHits, assertSize, inlinePageAssets, toArtifactFragment, attachHint, shQuote, PublishError } from '../bin/publish.mjs'
import { runSelfCheck } from '../bin/self-check.mjs'
import { buildStore } from '../bin/build.mjs'
import { makeTinyPng } from './helpers/tiny-png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')
const PUBLISH_BIN = join(ROOT, 'bin', 'publish.mjs')
const DECISION_REL = join('decision', '2026-08-01-example-decision.html')
const DESIGN_REL = join('design', '2026-08-05-example-design.html')

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

  test('refuses to publish when a .wu-diffview cannot be rendered (exit code 7)', () => {
    const store = freshStore()
    const badPage = join(store, 'bad-diff.html')
    // The hunk header claims 5 old and 5 new lines but only one line
    // follows it — parseUnifiedDiff (bin/lib/diffview.mjs) throws "hunk
    // ends early", which ensureDiffViews turns into an onError call rather
    // than letting it propagate; publish collects those and refuses.
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    assert.throws(
      () => publish(badPage, { to: 'file', out: join(store, 'o.html'), store }),
      (e) => e instanceof PublishError && e.code === 7,
    )
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

  test('exit code 7 on the CLI for an unrenderable .wu-diffview', () => {
    const store = freshStore()
    const badPage = join(store, 'bad-diff-cli.html')
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, badPage, '--to', 'file', '--out', join(store, 'cli-out3.html'), '--store', store,
    ])
    assert.equal(r.status, 7)
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

describe('toArtifactFragment(): the Artifact tool\'s fragment contract', () => {
  const HEAD =
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>t</title>\n' +
    '<meta name="description" content="d">\n' +
    '<style>.x{color:red}</style>\n'

  const page = (bodyInner) => `<!DOCTYPE html><html lang="ja"><head>\n${HEAD}</head>\n<body>\n${bodyInner}\n</body></html>`

  test('starts with <title>', () => {
    const frag = toArtifactFragment(page('<main><section class="wu-section">x</section></main>'))
    assert.match(frag, /^<title>t<\/title>/)
  })

  test('contains exactly one <style>', () => {
    const frag = toArtifactFragment(page('<main></main>'))
    assert.equal((frag.match(/<style>/g) || []).length, 1)
  })

  test('strips the whole skeleton: no DOCTYPE/html/head/body tags, no charset/viewport metas, no HTML comments', () => {
    const frag = toArtifactFragment(page('<main><!-- a comment --><section class="wu-section">x</section></main>'))
    assert.ok(!frag.includes('<!DOCTYPE'), frag)
    assert.ok(!frag.includes('<html'), frag)
    assert.ok(!frag.includes('<head>'), frag)
    assert.ok(!frag.includes('<body'), frag)
    assert.ok(!frag.includes('<meta charset'), frag)
    assert.ok(!frag.includes('<meta name="viewport"'), frag)
    assert.ok(!frag.includes('<!--'), frag)
  })

  test('a sidetoc <script> sitting right before </body> survives', () => {
    const frag = toArtifactFragment(page(
      '<main><section class="wu-section">x</section></main>\n<script>window.wuSideToc = 1</script>',
    ))
    assert.match(frag, /<script>window\.wuSideToc = 1<\/script>/)
  })

  test('throws PublishError(2) when no <head>…</head>/<body>…</body> skeleton can be found', () => {
    assert.throws(
      () => toArtifactFragment('<div>not a full document, no skeleton at all</div>'),
      (e) => e instanceof PublishError && e.code === 2,
    )
  })

  test('a page whose own comments literally quote </body> and </head> (mirrors kit/template.html) still yields the full body', () => {
    const templatePath = join(ROOT, 'kit', 'template.html')
    const template = readFileSync(templatePath, 'utf8')
    // template.html's sidetoc comment already quotes </body> literally
    // (right after <main>, well before the real closing tags) — extend it
    // to also quote </head>, so the fixture exercises both hazards this
    // fix guards against in the same comment.
    const mirrored = template.replace(
      'pinned script before </body>) once the page has three or more h2,',
      'pinned script before </body>, mirroring the shape of </head>) once the page has three or more h2,',
    )
    assert.notEqual(mirrored, template, 'fixture setup: the sidetoc comment text must still match')
    assert.match(mirrored, /<!--[\s\S]*<\/body>[\s\S]*<\/head>[\s\S]*-->/, 'fixture setup: both strings must land inside the same comment')

    const srcSectionCount = (template.match(/<section class="wu-section"/g) || []).length
    assert.ok(srcSectionCount > 0, 'fixture setup: template.html should carry example sections')

    const frag = toArtifactFragment(mirrored)
    const fragSectionCount = (frag.match(/<section class="wu-section"/g) || []).length
    assert.equal(fragSectionCount, srcSectionCount)
    assert.ok(!frag.includes('<!--'), frag)
  })
})

describe('publish(): --to artifact is a fragment, --to file is still a full document', () => {
  test('--to artifact output has no DOCTYPE/html/head/body wrapper', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store })
    const artifactHtml = readFileSync(result.output, 'utf8')
    assert.ok(!artifactHtml.includes('<!DOCTYPE'), artifactHtml)
    assert.ok(!artifactHtml.includes('<html'), artifactHtml)
    assert.ok(!artifactHtml.includes('<head>'), artifactHtml)
    assert.ok(!artifactHtml.includes('<body'), artifactHtml)
    assert.match(artifactHtml, /^<title>/)
  })

  test('--to file output is still a full standalone document', () => {
    const store = freshStore()
    const outFile = join(store, 'out-full-doc.html')
    publish(join(store, DECISION_REL), { to: 'file', out: outFile, store })
    const fileHtml = readFileSync(outFile, 'utf8')
    assert.match(fileHtml, /^<!DOCTYPE html>/)
    assert.match(fileHtml, /<html[^>]*>/)
    assert.match(fileHtml, /<head>/)
    assert.match(fileHtml, /<body>/)
  })

  test('--dry-run for --to artifact reports the output will be a fragment', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'artifact', store, dryRun: true })
    assert.equal(result.fragment, true)
  })

  test('--dry-run for --to file does not claim a fragment', () => {
    const store = freshStore()
    const result = publish(join(store, DECISION_REL), { to: 'file', out: join(store, 'x.html'), store, dryRun: true })
    assert.ok(!result.fragment)
  })
})

// --- --to github ------------------------------------------------------------
// `github` is the one target that writes a folder, not a single file: a
// GitHub PR body has no repo write, no branch and no external host to hand
// a file to — the only door in is `gh --attach` uploading the Markdown's
// figures/ files. See bin/publish.mjs's publishToGithub() docblock.

function freshGithubOut() {
  return mkdtempSync(join(tmpdir(), 'wu-publish-github-out-'))
}

describe('publish(): --to github writes a folder', () => {
  test('writes <slug>.md, <slug>.html and figures/*.svg for a page with a figure', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    assert.equal(result.ok, true)
    assert.equal(result.target, 'github')
    assert.equal(result.output, out)
    assert.ok(existsSync(join(out, '2026-08-05-example-design.md')))
    assert.ok(existsSync(join(out, '2026-08-05-example-design.html')))
    const figs = readdirSync(join(out, 'figures')).filter((f) => f.endsWith('.svg'))
    assert.ok(figs.length >= 1, 'expected at least one figure svg')
  })

  test('defaults to <store>/.publish/<slug>.github when --out is omitted', async () => {
    const store = freshStore()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store })
    assert.equal(result.output, join(store, '.publish', '2026-08-05-example-design.github'))
  })

  test('the md links its figure under figures/ — the exact relative shape gh --attach rewrites', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    const md = readFileSync(join(out, '2026-08-05-example-design.md'), 'utf8')
    assert.match(md, /!\[[^\]]*\]\(figures\/[^)]+\.svg\)/)
  })

  test('the figure svg is rewritten through standaloneSvg (carries its own style + background)', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    const figs = readdirSync(join(out, 'figures')).filter((f) => f.endsWith('.svg'))
    const svg = readFileSync(join(out, 'figures', figs[0]), 'utf8')
    assert.match(svg, /^<svg[^>]*><style/)
    assert.match(svg, /fill="var\(--wu-surface\)"/)
  })

  test('<slug>.html is a full standalone document (not a fragment) with no back nav and an inline <style>', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    const html = readFileSync(result.html, 'utf8')
    assert.match(html, /^<!DOCTYPE html>/)
    assert.match(html, /<head>/)
    assert.match(html, /<body>/)
    assert.ok(!html.includes('<nav class="wu-nav"'))
    assert.match(html, /<style>[\s\S]*<\/style>/)
  })

  test('strips the frontmatter block from the md but keeps the # title line', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    const md = readFileSync(join(out, '2026-08-05-example-design.md'), 'utf8')
    assert.ok(!md.startsWith('---'))
    assert.match(md, /^# /)
  })

  test('returns a gh --attach hint built from the actual figure files on disk', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    assert.match(result.hint, /^\(cd '/)
    assert.ok(result.hint.includes(`cd '${out}' && gh pr create --body-file '2026-08-05-example-design.md'`))
    const figs = readdirSync(join(out, 'figures')).filter((f) => f.endsWith('.svg'))
    for (const f of figs) assert.ok(result.hint.includes(`--attach 'figures/${f}'`))
    assert.match(result.hint, /gh pr comment <number> /)
  })

  test('the hint quotes the md and attach paths and never uses an absolute --attach path', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    assert.ok(!result.hint.includes(join(out, 'figures')), 'an absolute --attach path is never rewritten by gh --attach (cli/cli#14262)')
  })
})

describe('publish(): --to github .wu-shot images', () => {
  function addShot(store) {
    const pagePath = join(store, DESIGN_REL)
    const assetDir = join(dirname(pagePath), '2026-08-05-example-design-assets')
    mkdirSync(assetDir, { recursive: true })
    writeFileSync(join(assetDir, 'shot.png'), makeTinyPng())
    const html = readFileSync(pagePath, 'utf8')
    const shot = '<figure class="wu-shot"><img src="2026-08-05-example-design-assets/shot.png" alt="実機の画面"><figcaption>実機の見え方</figcaption></figure>'
    writeFileSync(pagePath, html.replace('</main>', shot + '</main>'))
    return pagePath
  }

  test('is copied into <out>/figures/ (collision-proof <slug>-shot<N>-<basename>) and linked from the md', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshGithubOut()
    await publish(pagePath, { to: 'github', store, out })
    assert.ok(existsSync(join(out, 'figures', '2026-08-05-example-design-shot2-shot.png')))
    const md = readFileSync(join(out, '2026-08-05-example-design.md'), 'utf8')
    assert.match(md, /!\[実機の画面\]\(figures\/2026-08-05-example-design-shot2-shot\.png\)/)
  })

  test('<slug>.html still carries it inlined as a data: URI, not a page-relative src', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshGithubOut()
    const result = await publish(pagePath, { to: 'github', store, out })
    const html = readFileSync(result.html, 'utf8')
    assert.match(html, /<img src="data:image\/png;base64,/)
  })

  test('a .wu-shot whose src is an .svg is copied byte-identical, never restyled through standaloneSvg', async () => {
    const store = freshStore()
    const pagePath = join(store, DESIGN_REL)
    const assetDir = join(dirname(pagePath), '2026-08-05-example-design-assets')
    mkdirSync(assetDir, { recursive: true })
    const svgSrc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
    writeFileSync(join(assetDir, 'shot.svg'), svgSrc)
    const html = readFileSync(pagePath, 'utf8')
    const shot = '<figure class="wu-shot"><img src="2026-08-05-example-design-assets/shot.svg" alt="実機の画面"><figcaption>実機の見え方</figcaption></figure>'
    writeFileSync(pagePath, html.replace('</main>', shot + '</main>'))

    const out = freshGithubOut()
    await publish(pagePath, { to: 'github', store, out })
    const copied = readdirSync(join(out, 'figures')).find((f) => f.includes('shot') && f.endsWith('.svg'))
    assert.ok(copied, 'expected the .wu-shot svg to be copied into figures/')
    assert.equal(readFileSync(join(out, 'figures', copied), 'utf8'), svgSrc, 'must be byte-identical to the source, not run through standaloneSvg')
  })
})

describe('publish(): --to github --pdf', () => {
  test('without playwright-core, skips gracefully — still ok, no .pdf on disk', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const savedEnv = process.env.WRITEUP_PLAYWRIGHT_CORE
    delete process.env.WRITEUP_PLAYWRIGHT_CORE
    try {
      const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out, pdf: true })
      assert.equal(result.ok, true)
      assert.equal(result.pdf.generated, false)
      assert.ok(!existsSync(join(out, '2026-08-05-example-design.pdf')))
    } finally {
      if (savedEnv !== undefined) process.env.WRITEUP_PLAYWRIGHT_CORE = savedEnv
    }
  })

  test('without --pdf, the result carries no pdf key and no file is written', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out })
    assert.equal(result.pdf, undefined)
    assert.ok(!existsSync(join(out, '2026-08-05-example-design.pdf')))
  })
})

describe('publish(): --to github --dry-run writes nothing', () => {
  test('reports the planned folder and file list without touching disk', () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = publish(join(store, DESIGN_REL), { to: 'github', store, out, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.equal(result.target, 'github')
    assert.equal(result.output, out)
    assert.ok(result.files.some((f) => f.endsWith('.md')))
    assert.ok(result.files.some((f) => f.endsWith('.html')))
    assert.ok(!existsSync(join(out, '2026-08-05-example-design.md')))
    assert.ok(!existsSync(join(out, '2026-08-05-example-design.html')))
  })

  test('--pdf on a dry-run lists the .pdf file too', () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = publish(join(store, DESIGN_REL), { to: 'github', store, out, dryRun: true, pdf: true })
    assert.ok(result.files.some((f) => f.endsWith('.pdf')))
  })
})

describe('publish(): --to github private-word gate', () => {
  function withPrivateWord(store) {
    const pagePath = join(store, DESIGN_REL)
    const html = readFileSync(pagePath, 'utf8')
      .replace('実装担当者向けに、アップロード経路の段構成を1つに決める。', 'acmecorpの実装担当者向けに、アップロード経路の段構成を1つに決める。')
    writeFileSync(pagePath, html)
    return pagePath
  }

  test('a page hitting a private word is refused at exit code 4 without --internal', async () => {
    const store = freshStore()
    const pagePath = withPrivateWord(store)
    const out = freshGithubOut()
    await assert.rejects(
      async () => publish(pagePath, { to: 'github', store, out }),
      (e) => e instanceof PublishError && e.code === 4 && /acmecorp/.test(e.detail),
    )
  })

  test('the same page packs fine with --internal', async () => {
    const store = freshStore()
    const pagePath = withPrivateWord(store)
    const out = freshGithubOut()
    const result = await publish(pagePath, { to: 'github', store, out, internal: true })
    assert.equal(result.ok, true)
    assert.ok(existsSync(join(out, '2026-08-05-example-design.md')))
  })
})

describe('publish(): --to github unrenderable .wu-diffview', () => {
  test('throws PublishError(7) instead of writing a folder for a page with a diff that fails to parse', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const badPage = join(store, 'bad-diff-github.html')
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    await assert.rejects(
      async () => publish(badPage, { to: 'github', store, out }),
      (e) => e instanceof PublishError && e.code === 7,
    )
  })
})

describe('publish(): --to github CLI', () => {
  test('exit code 0 for a clean publish; writes the folder', () => {
    const store = freshStore()
    const out = freshGithubOut()
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, join(store, DESIGN_REL), '--to', 'github', '--out', out, '--store', store,
    ])
    assert.equal(r.status, 0, r.stderr.toString())
    assert.ok(existsSync(join(out, '2026-08-05-example-design.md')))
    assert.ok(existsSync(join(out, '2026-08-05-example-design.html')))
  })

  test('exit code 4 without --internal on a private-word hit, exit 0 with it', () => {
    const store = freshStore()
    const pagePath = join(store, DESIGN_REL)
    const html = readFileSync(pagePath, 'utf8')
      .replace('実装担当者向けに、アップロード経路の段構成を1つに決める。', 'ACME-INTERNALの方針。')
    writeFileSync(pagePath, html)

    const out1 = freshGithubOut()
    const r1 = spawnSync(process.execPath, [PUBLISH_BIN, pagePath, '--to', 'github', '--out', out1, '--store', store])
    assert.equal(r1.status, 4)

    const out2 = freshGithubOut()
    const r2 = spawnSync(process.execPath, [PUBLISH_BIN, pagePath, '--to', 'github', '--out', out2, '--store', store, '--internal'])
    assert.equal(r2.status, 0, r2.stderr.toString())
  })

  test('--dry-run reports the plan and writes nothing', () => {
    const store = freshStore()
    const out = freshGithubOut()
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, join(store, DESIGN_REL), '--to', 'github', '--out', out, '--store', store, '--dry-run',
    ])
    assert.equal(r.status, 0, r.stderr.toString())
    assert.match(r.stdout.toString(), /would write/)
    assert.ok(!existsSync(join(out, '2026-08-05-example-design.md')))
  })

  test('an unrenderable .wu-diffview exits 7', () => {
    const store = freshStore()
    const out = freshGithubOut()
    const badPage = join(store, 'bad-diff-github-cli.html')
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    const r = spawnSync(process.execPath, [PUBLISH_BIN, badPage, '--to', 'github', '--out', out, '--store', store])
    assert.equal(r.status, 7)
  })
})

describe('publish(): --to github, a page with no .wu-figure/.wu-shot at all', () => {
  test('writes the folder with no figures/ directory (or an empty one) and a hint carrying no --attach', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DECISION_REL), { to: 'github', store, out })
    assert.equal(result.ok, true)
    assert.ok(existsSync(join(out, '2026-08-01-example-decision.md')))
    assert.ok(existsSync(join(out, '2026-08-01-example-decision.html')))
    const figuresExists = existsSync(join(out, 'figures'))
    if (figuresExists) assert.deepEqual(readdirSync(join(out, 'figures')), [])
    assert.ok(!result.hint.includes('--attach'))
    assert.match(result.hint, /^\(cd '/)
  })
})

describe('shQuote / attachHint: shell-safe quoting (publish refused unquoted paths into a shell command)', () => {
  test('shQuote wraps a plain path in single quotes', () => {
    assert.equal(shQuote('/tmp/plain/path.md'), "'/tmp/plain/path.md'")
  })

  test('shQuote escapes an embedded single quote as \'\\\'\'', () => {
    assert.equal(shQuote("it's"), "'it'\\''s'")
  })

  test('shQuote leaves an embedded space untouched other than the surrounding quotes', () => {
    assert.equal(shQuote('a b/c.md'), "'a b/c.md'")
  })

  test('attachHint quotes a folder path containing a space and a single quote', () => {
    const dir = "/tmp/it's a dir"
    const figuresDir = join(dir, 'figures')
    const hint = attachHint(dir, join(dir, "it's a slug.md"), figuresDir)
    assert.ok(hint.startsWith(`(cd ${shQuote(dir)} && gh pr create --body-file ${shQuote("it's a slug.md")}`))
  })

  test('attachHint quotes a figure file name containing a space and a single quote, as a relative figures/ path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-attach-hint-'))
    const figuresDir = join(dir, 'figures')
    mkdirSync(figuresDir, { recursive: true })
    writeFileSync(join(figuresDir, "a b'c.svg"), '<svg></svg>')
    const hint = attachHint(dir, join(dir, 'slug.md'), figuresDir)
    assert.ok(hint.includes(`--attach ${shQuote("figures/a b'c.svg")}`))
    assert.ok(!hint.includes(join(figuresDir, "a b'c.svg")), 'must never print the absolute figures/ path')
  })
})

describe('publish(): --internal is restricted to --to github', () => {
  for (const to of ['artifact', 'file', 'cloudflare']) {
    test(`--to ${to} with --internal is a usage error (exit 2), not a silent skip of the private-word check`, async () => {
      const store = freshStore()
      await assert.rejects(
        async () => publish(join(store, DECISION_REL), { to, store, internal: true }),
        (e) => e instanceof PublishError && e.code === 2 && /--internal/.test(e.message) && /github/.test(e.message),
      )
    })
  }

  test('--to github with --internal is accepted (unchanged behavior)', async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DECISION_REL), { to: 'github', store, out, internal: true })
    assert.equal(result.ok, true)
  })

  test('CLI: --to artifact --internal exits 2 with a message naming github', () => {
    const store = freshStore()
    const r = spawnSync(process.execPath, [
      PUBLISH_BIN, join(store, DECISION_REL), '--to', 'artifact', '--store', store, '--internal',
    ])
    assert.equal(r.status, 2)
    assert.match(r.stderr.toString(), /--internal/)
    assert.match(r.stderr.toString(), /github/)
  })
})

describe('publish(): --to github --pdf, playwright-core actually resolvable', () => {
  test('renders a real PDF starting with %PDF', { skip: !process.env.WRITEUP_PLAYWRIGHT_CORE }, async () => {
    const store = freshStore()
    const out = freshGithubOut()
    const result = await publish(join(store, DESIGN_REL), { to: 'github', store, out, pdf: true })
    assert.equal(result.ok, true)
    assert.equal(result.pdf.generated, true)
    assert.ok(existsSync(result.pdf.path))
    const bytes = readFileSync(result.pdf.path)
    assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF')
  })
})
