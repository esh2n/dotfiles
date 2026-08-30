#!/usr/bin/env node
// pr-pack.mjs — attaches a writeup page to a GitHub pull request in a
// PRIVATE repository, with no external host: everything (the staged page,
// its Markdown, its figures, optionally a PDF) is committed into the repo
// itself and referenced from the PR body by SHA-pinned `blob` URLs. GitHub
// only serves a blob URL to accounts with read access to the repo, so a
// private repo stays private — nothing here uploads anywhere.
//
// Why SHA-pinned `blob` links and not a branch link: a branch ref moves (or
// disappears once the PR merges and the branch is deleted); a commit SHA
// does not. `refs/pull/N/head` also keeps that commit reachable straight
// from the PR after the branch is gone, so the links in the PR body keep
// working for as long as the PR itself exists.
//
// The two-step SHA dance this forces (you cannot know the commit's SHA
// before you make the commit): first `pr-pack` writes the pack — staged
// page, Markdown, figures, optional PDF — into a repo-tracked directory;
// that gets committed and pushed like any other change; only then, with a
// real SHA in hand, does a second `pr-pack --body-out` run turn the same
// pack into a PR body whose links point at that exact commit. See
// references/publish.md for the full walkthrough.
//
// No private-word check here (contrast with publish.mjs): the audience for
// a blob URL inside a private repo's own PR is that repo's own members —
// the same people who could already read the page and its private words by
// checking out the branch. The check exists for publish.mjs's targets
// (artifact / cloudflare / a shared file), which can reach people outside
// the repo; a PR pack never leaves it.
//
// Pre-stage mirrors publish.mjs exactly: render (ensureRendered) -> self-
// check -> inline kit CSS -> drop the back-to-index nav (there is no store
// index inside a PR pack, so this always uses publish's 'file' target
// behavior). Figures are extracted by to-md.mjs and then each rewritten
// through standaloneSvg (lib/standalone-svg.mjs) so they carry their own
// look with no page CSS around them.
//
// Exit codes: 0 ok, 2 usage error, 3 self-check failed,
// 7 a `.wu-diffview` whose diff could not be rendered.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { runSelfCheckText } from './self-check.mjs'
import { ensureRendered } from './build.mjs'
import { inlineKitCss, adjustBackNav } from './publish.mjs'
import { resolveStoreDir } from './lib/store.mjs'
import { convertToMarkdown } from './to-md.mjs'
import { standaloneSvg } from './lib/standalone-svg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_DIR = join(HERE, '..', 'kit')

export class PrPackError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function assertSelfCheckPasses(rendered, pageFile) {
  const result = runSelfCheckText(rendered, pageFile)
  if (result.unreadable) throw new PrPackError(3, `self-check could not read the page: ${result.message}`)
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.item} — ${e.detail}`).join('\n')
    throw new PrPackError(3, 'self-check failed; pr-pack refused', detail)
  }
}

function slugOf(pageFile) {
  return basename(pageFile, extname(pageFile))
}

/** Renders, self-checks, and stages `pageFile` into `<out>/index.html`;
 * converts the rendered page to `<out>/<slug>.md` with its figures under
 * `<out>/figures/`, each figure rewritten through `standaloneSvg`. Returns
 * the slug. */
function writePack(pageFile, out, { store, storeName }) {
  let raw
  try {
    raw = readFileSync(pageFile, 'utf8')
  } catch (e) {
    throw new PrPackError(3, `self-check could not read the page: cannot read file: ${pageFile} (${e.message})`)
  }
  const renderErrors = []
  const rendered = ensureRendered(raw, { onError: (m) => renderErrors.push(m) })
  if (renderErrors.length) {
    throw new PrPackError(7, 'pr-pack refused: a .wu-diffview could not be rendered', renderErrors.join('\n'))
  }

  assertSelfCheckPasses(rendered, pageFile)

  const storeDir = resolveStoreDir(store, { name: storeName, cwd: dirname(resolve(pageFile)) })
  const staged = adjustBackNav(inlineKitCss(rendered, storeDir), 'file', storeDir)

  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'index.html'), staged)

  const slug = slugOf(pageFile)
  const figuresDir = join(out, 'figures')
  const md = convertToMarkdown(rendered, { slug, figuresDir, figuresDirRel: 'figures' })
  writeFileSync(join(out, `${slug}.md`), md)

  restyleFigures(figuresDir)

  return slug
}

/** Rewrites every `*.svg` to-md just wrote into `figuresDir` through
 * `standaloneSvg`, using the kit's own `writeup.css` (figures are a kit
 * component; a store's `_kit/writeup.css` is only ever a synced copy of
 * the same file, so reading the kit's copy directly needs no store at
 * all — useful when `pageFile` has no store, like kit/samples.html). */
function restyleFigures(figuresDir) {
  if (!existsSync(figuresDir)) return
  const cssPath = join(KIT_DIR, 'writeup.css')
  const cssText = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  for (const name of readdirSync(figuresDir)) {
    if (!name.endsWith('.svg')) continue
    const file = join(figuresDir, name)
    const svg = readFileSync(file, 'utf8')
    writeFileSync(file, standaloneSvg(svg, cssText))
  }
}

async function loadPlaywrightCore() {
  try {
    return await import('playwright-core')
  } catch { /* fall through to the env override */ }
  const envPath = process.env.WRITEUP_PLAYWRIGHT_CORE
  if (!envPath) return null
  try {
    return await import(pathToFileURL(resolve(envPath)).href)
  } catch {
    return null
  }
}

/** Renders `<out>/index.html` to `<out>/<slug>.pdf` via a headless
 * Chromium, when `playwright-core` (or `WRITEUP_PLAYWRIGHT_CORE`) resolves.
 * Never throws: a missing dependency is a graceful no-op, printed and
 * skipped, since a PR pack is still useful (Markdown + figures) without a
 * PDF. */
async function renderPdf(indexHtmlPath, pdfPath) {
  const mod = await loadPlaywrightCore()
  const chromium = mod?.chromium ?? mod?.default?.chromium
  if (!chromium) {
    console.log('pr-pack: pdf skipped (playwright-core not found)')
    return { generated: false }
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`file://${resolve(indexHtmlPath)}`, { waitUntil: 'load' })
    await page.waitForTimeout(500)
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    })
  } finally {
    await browser.close()
  }
  return { generated: true, path: pdfPath }
}

// --- --body-out ---------------------------------------------------------

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n\n?/

function stripFrontmatter(md) {
  return md.replace(FRONTMATTER_RE, '')
}

function blobUrl(repo, sha, repoPath, relPath) {
  return `https://github.com/${repo}/blob/${sha}/${repoPath}/${relPath}?raw=true`
}

/** Rewrites every `](figures/...)` and `src="figures/..."` reference in the
 * Markdown to an absolute SHA-pinned blob URL, so the figures still render
 * once this text leaves the repo's own Markdown rendering (a GitHub PR
 * body is not rendered from the repo tree — relative image paths there
 * would 404). */
function rewriteFigureLinks(md, { repo, sha, path: repoPath }) {
  return md
    .replace(/\]\(figures\/([^)]+)\)/g, (_, rest) => `](${blobUrl(repo, sha, repoPath, `figures/${rest}`)})`)
    .replace(/src="figures\/([^"]+)"/g, (_, rest) => `src="${blobUrl(repo, sha, repoPath, `figures/${rest}`)}"`)
}

function footer({ repo, sha, path: repoPath, slug, hasPdf }) {
  const indexUrl = blobUrl(repo, sha, repoPath, 'index.html')
  let line = `> 原本（kit の見た目のまま）: ${indexUrl}`
  if (hasPdf) {
    line += ` ・PDF: ${blobUrl(repo, sha, repoPath, `${slug}.pdf`)}`
  }
  return line
}

function writeBody(out, slug, { repo, sha, path: repoPath }) {
  const mdPath = join(out, `${slug}.md`)
  const raw = readFileSync(mdPath, 'utf8')
  const body = rewriteFigureLinks(stripFrontmatter(raw), { repo, sha, path: repoPath })
  const hasPdf = existsSync(join(out, `${slug}.pdf`))
  return `${body.trimEnd()}\n\n${footer({ repo, sha, path: repoPath, slug, hasPdf })}\n`
}

/** Finds the slug of an already-written pack (no `pageFile` given): the
 * single `*.md` file directly under `out`. */
function existingSlug(out) {
  const mdFiles = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.md')) : []
  if (mdFiles.length !== 1) {
    throw new PrPackError(2, `--out must contain exactly one existing .md pack when <page.html> is omitted (found ${mdFiles.length} in ${out})`)
  }
  return basename(mdFiles[0], '.md')
}

/**
 * Writes (or reuses) a PR pack at `opts.out` and, when `opts.bodyOut` is
 * set, a PR body next to it.
 * @returns {Promise<{ok: true, out: string, slug: string, index?: string, md?: string, figuresDir?: string, pdf?: object, bodyOut?: string}>}
 */
export async function prPack(pageFile, opts) {
  const { out, store, storeName, pdf = false, repo, sha, path: repoPath, bodyOut } = opts
  if (!out) throw new PrPackError(2, '--out <dir> is required')
  if (bodyOut && (!repo || !sha || !repoPath)) {
    throw new PrPackError(2, '--body-out requires --repo, --sha and --path')
  }

  const slug = pageFile ? writePack(pageFile, out, { store, storeName }) : existingSlug(out)

  const result = { ok: true, out, slug }
  if (pageFile) {
    result.index = join(out, 'index.html')
    result.md = join(out, `${slug}.md`)
    result.figuresDir = join(out, 'figures')
  }

  if (pdf) {
    result.pdf = await renderPdf(join(out, 'index.html'), join(out, `${slug}.pdf`))
  }

  if (bodyOut) {
    const body = writeBody(out, slug, { repo, sha, path: repoPath })
    writeFileSync(bodyOut, body)
    result.bodyOut = bodyOut
  }

  return result
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    file: null, out: null, store: null, storeName: null, pdf: false,
    repo: null, sha: null, path: null, bodyOut: null,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--store') args.store = argv[++i]
    else if (a === '--store-name') args.storeName = argv[++i]
    else if (a === '--pdf') args.pdf = true
    else if (a === '--repo') args.repo = argv[++i]
    else if (a === '--sha') args.sha = argv[++i]
    else if (a === '--path') args.path = argv[++i]
    else if (a === '--body-out') args.bodyOut = argv[++i]
    else positional.push(a)
  }
  args.file = positional[0] ?? null
  return args
}

const USAGE = 'usage: node bin/pr-pack.mjs <page.html> --out <dir> [--store <dir> | --store-name <name>] [--pdf] [--repo owner/name --sha <sha> --path <repo-relative dir> --body-out <file>]'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.out) {
    console.error(USAGE)
    return 2
  }
  try {
    const result = await prPack(args.file, {
      out: args.out, store: args.store, storeName: args.storeName, pdf: args.pdf,
      repo: args.repo, sha: args.sha, path: args.path, bodyOut: args.bodyOut,
    })
    console.log(`pr-pack: wrote ${result.out}`)
    if (result.index) console.log(`  index: ${result.index}`)
    if (result.md) console.log(`  md: ${result.md}`)
    if (result.pdf?.generated) console.log(`  pdf: ${result.pdf.path}`)
    if (result.bodyOut) console.log(`  body: ${result.bodyOut}`)
    return 0
  } catch (e) {
    if (e instanceof PrPackError) {
      console.error(`pr-pack: ${e.message}`)
      if (e.detail) console.error(e.detail)
      return e.code
    }
    console.error(`pr-pack: unexpected error: ${e.stack || e}`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code))
}
