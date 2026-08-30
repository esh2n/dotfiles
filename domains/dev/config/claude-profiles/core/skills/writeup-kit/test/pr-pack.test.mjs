import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { prPack, PrPackError } from '../bin/pr-pack.mjs'
import { buildStore } from '../bin/build.mjs'
import { makeTinyPng } from './helpers/tiny-png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')
const PR_PACK_BIN = join(ROOT, 'bin', 'pr-pack.mjs')
const DESIGN_REL = join('design', '2026-08-05-example-design.html')

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wu-prpack-'))
  cpSync(FIXTURE_STORE, dir, { recursive: true })
  buildStore(dir) // syncs _kit/writeup.css, as a real store always has before pr-pack runs
  return dir
}

function freshOut() {
  return mkdtempSync(join(tmpdir(), 'wu-prpack-out-'))
}

describe('prPack(): writes the pack', () => {
  test('writes index.html, <slug>.md and a figures/*.svg for a page with a figure', async () => {
    const store = freshStore()
    const out = freshOut()
    const result = await prPack(join(store, DESIGN_REL), { out, store })
    assert.equal(result.ok, true)
    assert.ok(existsSync(join(out, 'index.html')))
    assert.ok(existsSync(join(out, '2026-08-05-example-design.md')))
    const figs = readdirSync(join(out, 'figures')).filter((f) => f.endsWith('.svg'))
    assert.ok(figs.length >= 1, 'expected at least one figure svg')
  })

  test('the md links its figure under figures/', () => {
    const store = freshStore()
    const out = freshOut()
    const mdPath = join(out, '2026-08-05-example-design.md')
    return prPack(join(store, DESIGN_REL), { out, store }).then(() => {
      const md = readFileSync(mdPath, 'utf8')
      assert.match(md, /!\[[^\]]*\]\(figures\/[^)]+\.svg\)/)
    })
  })

  test('the figure svg is rewritten through standaloneSvg (carries its own style + background)', async () => {
    const store = freshStore()
    const out = freshOut()
    await prPack(join(store, DESIGN_REL), { out, store })
    const figs = readdirSync(join(out, 'figures')).filter((f) => f.endsWith('.svg'))
    const svg = readFileSync(join(out, 'figures', figs[0]), 'utf8')
    assert.match(svg, /^<svg[^>]*><style/)
    assert.match(svg, /fill="var\(--wu-surface\)"/)
  })

  test('the staged index.html has no back nav and has an inline <style>', async () => {
    const store = freshStore()
    const out = freshOut()
    await prPack(join(store, DESIGN_REL), { out, store })
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    assert.ok(!html.includes('<nav class="wu-nav"'))
    assert.match(html, /<style>[\s\S]*<\/style>/)
  })
})

describe('prPack(): --body-out', () => {
  test('rewrites figure links to SHA-pinned blob URLs and appends the 原本 footer', async () => {
    const store = freshStore()
    const out = freshOut()
    const bodyOut = join(out, 'body.md')
    await prPack(join(store, DESIGN_REL), {
      out, store, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut,
    })
    const body = readFileSync(bodyOut, 'utf8')
    assert.match(body, /https:\/\/github\.com\/o\/r\/blob\/abc123\/docs\/x\/figures\/[^)\s]+\.svg\?raw=true/)
    // The 原本 link is a plain blob-view link (GitHub's syntax-highlighted
    // HTML source + Download button), not an <img> src — no ?raw=true.
    assert.match(body, /> 原本（kit の見た目のまま）: https:\/\/github\.com\/o\/r\/blob\/abc123\/docs\/x\/index\.html\n/)
  })

  test('appends a ・PDF: line when the pdf exists', async () => {
    const store = freshStore()
    const out = freshOut()
    const bodyOut = join(out, 'body.md')
    await prPack(join(store, DESIGN_REL), { out, store })
    // pretend a prior --pdf run produced the slug's pdf
    writeFileSync(join(out, '2026-08-05-example-design.pdf'), 'not a real pdf')
    await prPack(null, { out, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut })
    const body = readFileSync(bodyOut, 'utf8')
    // A plain blob-view link, not ?raw=true — GitHub renders a PDF inline
    // only at the plain blob URL; ?raw=true would force a raw download.
    assert.match(body, /・PDF: https:\/\/github\.com\/o\/r\/blob\/abc123\/docs\/x\/2026-08-05-example-design\.pdf\n/)
  })

  test('the footer links never carry ?raw=true (unlike figure links, which do)', async () => {
    const store = freshStore()
    const out = freshOut()
    const bodyOut = join(out, 'body.md')
    await prPack(join(store, DESIGN_REL), { out, store, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut })
    const body = readFileSync(bodyOut, 'utf8')
    const footerLine = body.split('\n').find((l) => l.startsWith('> 原本'))
    assert.ok(footerLine, body)
    assert.ok(!footerLine.includes('?raw=true'), footerLine)
  })

  test('strips the frontmatter block but keeps the # title line', async () => {
    const store = freshStore()
    const out = freshOut()
    const bodyOut = join(out, 'body.md')
    await prPack(join(store, DESIGN_REL), { out, store, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut })
    const body = readFileSync(bodyOut, 'utf8')
    assert.ok(!body.startsWith('---'))
    assert.match(body, /^# アップロード経路の設計/)
  })

  test('--body-out without --repo/--sha/--path throws PrPackError(2)', async () => {
    const store = freshStore()
    const out = freshOut()
    await assert.rejects(
      () => prPack(join(store, DESIGN_REL), { out, store, bodyOut: join(out, 'body.md') }),
      (e) => e instanceof PrPackError && e.code === 2,
    )
  })

  test('re-runs on an existing pack without the page file, reusing its slug', async () => {
    const store = freshStore()
    const out = freshOut()
    await prPack(join(store, DESIGN_REL), { out, store })
    const bodyOut = join(out, 'body.md')
    const result = await prPack(null, { out, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut })
    assert.equal(result.slug, '2026-08-05-example-design')
    assert.ok(existsSync(bodyOut))
  })
})

describe('prPack(): .wu-shot images', () => {
  /** Adds a `.wu-shot` figure (with a real on-disk asset) to the fixture
   * design page before packing it. */
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

  test('the asset file is copied into <out>/figures/ as <slug>-shot<N>-<basename>, not its own bare basename (collision-proof)', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshOut()
    await prPack(pagePath, { out, store })
    assert.ok(existsSync(join(out, 'figures', '2026-08-05-example-design-shot2-shot.png')))
    assert.ok(!existsSync(join(out, 'figures', 'shot.png')))
  })

  test('the Markdown links it under figures/ using the <img>\'s own alt text, with the caption below', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshOut()
    await prPack(pagePath, { out, store })
    const md = readFileSync(join(out, '2026-08-05-example-design.md'), 'utf8')
    assert.match(md, /!\[実機の画面\]\(figures\/2026-08-05-example-design-shot2-shot\.png\)/)
    assert.match(md, /実機の見え方/)
  })

  test('the staged index.html carries the image inlined as a data: URI, not a page-relative src', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshOut()
    await prPack(pagePath, { out, store })
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(html, /<img src="data:image\/png;base64,/)
    assert.ok(!html.includes('src="2026-08-05-example-design-assets'))
  })

  test('--body-out rewrites the figures/<slug>-shot<N>-shot.png reference to a SHA-pinned blob URL', async () => {
    const store = freshStore()
    const pagePath = addShot(store)
    const out = freshOut()
    const bodyOut = join(out, 'body.md')
    await prPack(pagePath, { out, store, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut })
    const body = readFileSync(bodyOut, 'utf8')
    assert.match(body, /https:\/\/github\.com\/o\/r\/blob\/abc123\/docs\/x\/figures\/2026-08-05-example-design-shot2-shot\.png\?raw=true/)
  })
})

describe('prPack(): existingSlug() — reusing a pack with no <page.html>', () => {
  test('an --out with no .md file throws PrPackError(2)', async () => {
    const out = freshOut()
    await assert.rejects(
      () => prPack(null, { out, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut: join(out, 'body.md') }),
      (e) => e instanceof PrPackError && e.code === 2 && /found 0/.test(e.message),
    )
  })

  test('an --out with two or more .md files throws PrPackError(2)', async () => {
    const store = freshStore()
    const out = freshOut()
    await prPack(join(store, DESIGN_REL), { out, store })
    // A second, unrelated .md file dropped into the same pack directory —
    // existingSlug() can no longer tell which one is the pack's own.
    writeFileSync(join(out, 'stray.md'), '# stray\n')
    await assert.rejects(
      () => prPack(null, { out, repo: 'o/r', sha: 'abc123', path: 'docs/x', bodyOut: join(out, 'body.md') }),
      (e) => e instanceof PrPackError && e.code === 2 && /found 2/.test(e.message),
    )
  })
})

describe('prPack(): unrenderable .wu-diffview', () => {
  test('throws PrPackError(7) instead of packing a page with a diff that fails to parse', async () => {
    const store = freshStore()
    const out = freshOut()
    const badPage = join(store, 'bad-diff-fn.html')
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    await assert.rejects(
      () => prPack(badPage, { out, store }),
      (e) => e instanceof PrPackError && e.code === 7,
    )
  })
})

describe('prPack(): private-word gate', () => {
  /** Injects a private word (from the fixture store's own
   * `[private] words`, see test/fixtures/store/.writeup.toml) into the
   * design page's body text. */
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
    const out = freshOut()
    await assert.rejects(
      () => prPack(pagePath, { out, store }),
      (e) => e instanceof PrPackError && e.code === 4 && /acmecorp/.test(e.detail),
    )
  })

  test('the same page packs fine with --internal', async () => {
    const store = freshStore()
    const pagePath = withPrivateWord(store)
    const out = freshOut()
    const result = await prPack(pagePath, { out, store, internal: true })
    assert.equal(result.ok, true)
    assert.ok(existsSync(join(out, 'index.html')))
  })

  test('CLI: exit code 4 without --internal, exit 0 with it', () => {
    const store = freshStore()
    const pagePath = withPrivateWord(store)
    const out1 = freshOut()
    const r1 = spawnSync(process.execPath, [PR_PACK_BIN, pagePath, '--out', out1, '--store', store])
    assert.equal(r1.status, 4)

    const out2 = freshOut()
    const r2 = spawnSync(process.execPath, [PR_PACK_BIN, pagePath, '--out', out2, '--store', store, '--internal'])
    assert.equal(r2.status, 0, r2.stderr.toString())
  })
})

describe('prPack(): --pdf without playwright-core', () => {
  test('skips gracefully and still returns ok', async () => {
    const store = freshStore()
    const out = freshOut()
    const savedEnv = process.env.WRITEUP_PLAYWRIGHT_CORE
    delete process.env.WRITEUP_PLAYWRIGHT_CORE
    try {
      const result = await prPack(join(store, DESIGN_REL), { out, store, pdf: true })
      assert.equal(result.ok, true)
      assert.equal(result.pdf.generated, false)
      assert.ok(!existsSync(join(out, '2026-08-05-example-design.pdf')))
    } finally {
      if (savedEnv !== undefined) process.env.WRITEUP_PLAYWRIGHT_CORE = savedEnv
    }
  })
})

describe('prPack(): CLI', () => {
  test('exit code 0 for a clean pack', () => {
    const store = freshStore()
    const out = freshOut()
    const r = spawnSync(process.execPath, [PR_PACK_BIN, join(store, DESIGN_REL), '--out', out, '--store', store])
    assert.equal(r.status, 0, r.stderr.toString())
    assert.ok(existsSync(join(out, 'index.html')))
  })

  test('usage error (missing --out) exits 2', () => {
    const store = freshStore()
    const r = spawnSync(process.execPath, [PR_PACK_BIN, join(store, DESIGN_REL), '--store', store])
    assert.equal(r.status, 2)
  })

  test('self-check failure exits 3', () => {
    const store = freshStore()
    const out = freshOut()
    const badPage = join(store, 'bad.html')
    writeFileSync(badPage, '<html><head><title>t</title><meta name="kind" content="not-a-kind"></head><body>x</body></html>')
    const r = spawnSync(process.execPath, [PR_PACK_BIN, badPage, '--out', out, '--store', store])
    assert.equal(r.status, 3)
  })

  test('an unrenderable .wu-diffview exits 7', () => {
    const store = freshStore()
    const out = freshOut()
    const badPage = join(store, 'bad-diff.html')
    // Same malformed hunk as publish.test.mjs's exit-7 case: the header
    // claims 5 old/5 new lines but only one line follows.
    writeFileSync(badPage, [
      '<!DOCTYPE html><html><head><title>t</title></head><body>',
      '<figure class="wu-diffview"><script type="text/x-writeup-diff">',
      '@@ -1,5 +1,5 @@',
      ' unchanged',
      '</script></figure>',
      '</body></html>',
    ].join('\n'))
    const r = spawnSync(process.execPath, [PR_PACK_BIN, badPage, '--out', out, '--store', store])
    assert.equal(r.status, 7)
  })
})
