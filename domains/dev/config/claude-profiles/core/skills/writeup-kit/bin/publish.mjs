#!/usr/bin/env node
// publish.mjs — stages a page for an external audience (contract §8).
// Pre-stage, always in this order: (0) --to is one of the 4 known targets,
// (1) run build's rendering passes (viewport meta, `.wu-diffview` tables,
// code highlighting — `ensureRendered`) so a page that skipped `build`, or a
// kit reference page no store build scans, never ships unrendered, then
// self-check must pass on that rendered text (it needs the page's own
// `.wu-shot` asset files to exist on disk, which is still true at this
// point — nothing has moved them yet), (2) inline the kit CSS, (3) inline
// every `.wu-shot` image (a page-relative `<slug>-assets/*` file) as a
// `data:` URI (`inlinePageAssets`) so the staged output stays one file for
// every target, (4) adjust `.wu-header`'s back-to-index nav for the target
// (dropped for file/artifact/github; rewritten to `/index.html` or dropped
// for cloudflare — see `adjustBackNav`), (5) reject on a company-trace word
// hit (skippable with `--internal`, for a private repo whose readers are
// its own members — restricted to `github`: passing `--internal` for any
// other target is a usage error, exit 2, not a silent skip), (6) enforce
// the 16MB Artifact-tool size ceiling. Then dispatch to one of 4 targets: `file` and `cloudflare`
// write the staged text as a full, standalone document (a Slack attachment
// / email, and a hosted page, both need one); `artifact` writes it through
// `toArtifactFragment` instead, which strips the
// `<!DOCTYPE>`/`<html>`/`<head>`/`<body>` skeleton and the charset/viewport
// `<meta>`s — the Artifact tool supplies its own version of exactly those,
// and wraps whatever this returns inside them, so a full document there
// would double them up. `github` is the one target that writes a folder,
// not a single file: there is no external host to hand a GitHub PR body a
// file, only GitHub's own attachment store, and the only door into that is
// `gh pr create|edit|comment --attach` rewriting `![alt](figures/x.svg)`
// references in an uploaded Markdown body — so this target never touches a
// repository, computes no SHA, and calls no `gh` itself; it just writes
// `<slug>.md` (figures linked as `figures/<name>.svg`, the exact relative
// shape `--attach` rewrites) plus the `figures/` files plus a staged
// `<slug>.html` (and optionally `<slug>.pdf`) for a human to attach, drag
// in, or keep as the 原本. The status favicon `<link rel="icon">`
// (page-contract.md §1) is not touched by any of this — its href is an
// inline `data:` URI already, so it carries through to every target
// unchanged (and survives `toArtifactFragment` too, since that only
// removes the skeleton tags and the two `<meta>`s named above).
//
// Exit codes: 0 success/dry-run, 2 usage error (including `--to artifact`
// failing to locate the skeleton `toArtifactFragment` needs, and
// `--internal` passed for any target other than `github`), 3 self-check
// failed, 4 private-word hit, 5 cloudflare Access not verified, 6 size
// over 16MB, 7 a `.wu-diffview` whose diff could not be rendered, 8 the
// kit CSS `<link>` survived inlining (see `inlineKitCss`'s comment-skip
// below).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { runSelfCheckText } from './self-check.mjs'
import { ensureRendered } from './build.mjs'
import { resolveStoreDir, privateWords, cloudflareConfig } from './lib/store.mjs'
import { parseHtml, headMeta, titleText, textContent, findFirst, tagName } from './lib/html.mjs'
import { resolvePageAsset } from './lib/assets.mjs'
import { convertToMarkdown } from './to-md.mjs'
import { standaloneSvg } from './lib/standalone-svg.mjs'
import { renderPdf } from './lib/pdf.mjs'
import { isMain } from './lib/main.mjs'

const MAX_BYTES = 16 * 1024 * 1024

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_DIR = join(HERE, '..', 'kit')

export class PublishError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** Byte ranges (`[start, end)`) of every `<!-- … -->` comment in `html` —
 * used to keep a text-surgery regex from matching an *example* fragment
 * quoted inside an explanatory comment, rather than the real markup it is
 * commenting on. */
function commentRanges(html) {
  const ranges = []
  const re = /<!--[\s\S]*?-->/g
  let m
  while ((m = re.exec(html))) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

function isInsideRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end)
}

const KIT_CSS_LINK_RE = /<link\s+rel="stylesheet"\s+href="((?:\.\.\/)?_kit\/writeup\.css|\.\/writeup\.css)"\s*>/g

/** `true` when a *real* (not commented-out) kit CSS `<link>` is still
 * present in `html` — the check `inlineKitCss` runs on its own output
 * before returning, so a page whose link somehow survived inlining fails
 * loudly instead of shipping unstyled. */
function kitCssLinkRemains(html) {
  const ranges = commentRanges(html)
  let m
  KIT_CSS_LINK_RE.lastIndex = 0
  while ((m = KIT_CSS_LINK_RE.exec(html))) {
    if (!isInsideRanges(m.index, ranges)) return true
  }
  return false
}

/** Replaces the kit CSS `<link>` with an inline `<style>`, keeping any
 * Google Fonts `<link>` untouched. Resolves the CSS file relative to
 * `storeDir` (a page-local `../_kit/writeup.css`) or falls back to the
 * kit's own copy (`./writeup.css`, used by kit/template.html itself).
 *
 * `kit/template.html` (and every page copied from it) carries an
 * explanatory `<!-- … -->` comment right before the real `<link>`, quoting
 * that exact same href as an example — a naive first-match regex hits the
 * commented-out copy first and inlines the CSS *inside the comment*,
 * leaving the real `<link>` untouched and the staged page unstyled with no
 * error at all. So this matches every occurrence and takes the first one
 * that does not fall inside an HTML comment (`commentRanges`), and then
 * re-checks its own output (`kitCssLinkRemains`) so that exact silent
 * failure can never ship again — a real `<link>` still present afterward
 * throws instead of publishing an unstyled page. */
export function inlineKitCss(html, storeDir) {
  const ranges = commentRanges(html)
  KIT_CSS_LINK_RE.lastIndex = 0
  let m
  let match = null
  while ((m = KIT_CSS_LINK_RE.exec(html))) {
    if (!isInsideRanges(m.index, ranges)) { match = m; break }
  }
  if (!match) return html
  const href = match[1]
  const cssPath = href.endsWith('_kit/writeup.css') ? join(storeDir, '_kit', 'writeup.css') : join(KIT_DIR, 'writeup.css')
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  const style = `<style>\n${css}\n</style>`
  const staged = html.slice(0, match.index) + style + html.slice(match.index + match[0].length)
  if (kitCssLinkRemains(staged)) {
    throw new PublishError(8, 'publish refused: a _kit/writeup.css stylesheet link survived CSS inlining — the staged page would render unstyled')
  }
  return staged
}

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const IMG_SRC_RE = /(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/g

/** Replaces every page-relative `<img src>` (a `.wu-shot` asset file next
 * to the page, under `<slug>-assets/`) with a `data:<mime>;base64,…` URI
 * read from `pageDir`, so the staged output stays one self-contained file
 * for every publish target — the same reason `inlineKitCss` inlines the
 * stylesheet instead of leaving it as a link. A `data:` src (already
 * inline) or an external one (`http(s):`, already rejected by self-check's
 * `single-file`/`shot` rows before this ever runs) is left untouched, and
 * so is a `src` that fails `resolvePageAsset`'s containment guard (path
 * traversal, a symlink escaping `pageDir`, or a disallowed extension) — by
 * the time publish runs, self-check has already refused a page whose shot
 * escapes its own directory, so this is a defensive no-op, not the gate
 * itself: the untouched page-relative src just ships as-is rather than
 * risking pulling an out-of-tree file into the inlined output. Inlining is
 * a plain text substitution, not an HTML re-serialization, for the same
 * reason `inlineKitCss`'s regex swap is — the rest of the page's bytes (a
 * figure's sha256'd SVG + IR pair) must not risk reformatting. */
export function inlinePageAssets(html, pageDir) {
  return html.replace(IMG_SRC_RE, (whole, pre, src, post) => {
    const resolved = resolvePageAsset(pageDir, src)
    if (!resolved || !existsSync(resolved)) return whole
    const mime = MIME_BY_EXT[extname(resolved).slice(1).toLowerCase()]
    if (!mime) return whole
    const data = readFileSync(resolved).toString('base64')
    return `${pre}data:${mime};base64,${data}${post}`
  })
}

const NAV_BLOCK_RE = /\s*<nav\s+class="wu-nav"[^>]*>[\s\S]*?<\/nav>/
const BACK_HREF_RE = /(<a\s+class="wu-back"[^>]*\shref=")([^"]*)(")/

/** Adjusts `.wu-header`'s back-to-index nav for the target audience: a
 * single exported file (`--to file` / `--to artifact`) has no store index
 * to link back to, so the nav is dropped entirely. `--to cloudflare`
 * deploys into `public/`, which only carries its own `index.html` once
 * `build` has been run against it — when `<store>/public/index.html`
 * exists, the nav's href is rewritten to the deployed site's absolute
 * `/index.html`; otherwise it is dropped the same as file/artifact. A page
 * with no `.wu-nav` at all (predates this feature, or already stripped) is
 * left untouched either way. */
export function adjustBackNav(html, to, storeDir) {
  if (to === 'cloudflare' && existsSync(join(storeDir, 'public', 'index.html'))) {
    return html.replace(BACK_HREF_RE, (whole, pre, _href, post) => `${pre}/index.html${post}`)
  }
  return html.replace(NAV_BLOCK_RE, '')
}

/** Every word from the store's `[private] words` list found in the page's
 * title, head meta values, or body text. Case-insensitive substring match. */
export function findPrivateWordHits(html, words) {
  if (!words.length) return []
  const root = parseHtml(html)
  const meta = headMeta(root)
  const title = titleText(root)
  const main = findFirst(root, (n) => tagName(n) === 'main') || root
  const haystack = [title, ...Object.values(meta), textContent(main)].join('\n').toLowerCase()
  return words.filter((w) => haystack.includes(String(w).toLowerCase()))
}

/** Enforces the Artifact tool's 16MB ceiling on the fully-staged (CSS-inlined)
 * content. Exported so the guard itself can be unit-tested directly against
 * a synthetic oversized string, without needing a 16MB fixture page that
 * also happens to pass every other self-check row. */
export function assertSize(staged) {
  const bytes = Buffer.byteLength(staged, 'utf8')
  if (bytes > MAX_BYTES) {
    throw new PublishError(6, `publish refused: page is ${bytes} bytes, over the 16MB Artifact limit`)
  }
  return bytes
}

function assertSelfCheckPasses(rendered, pageFile) {
  const result = runSelfCheckText(rendered, pageFile)
  if (result.unreadable) throw new PublishError(3, `self-check could not read the page: ${result.message}`)
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.item} — ${e.detail}`).join('\n')
    throw new PublishError(3, 'self-check failed; publish refused', detail)
  }
}

function slugOf(pageFile) {
  return basename(pageFile, extname(pageFile))
}

function wranglerAvailable() {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['wrangler'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Runs the full pre-stage and dispatches to the requested target.
 *
 * Synchronous for the `file`/`artifact`/`cloudflare` targets (unchanged
 * from before `github` existed — every existing caller keeps working
 * without an `await`). `github` returns a `Promise` instead — writing its
 * folder can involve an async PDF render (`--pdf`) — so callers of that
 * target must `await` the result.
 *
 * @returns {{ok: true, target: string, output?: string, command?: string, dryRun?: boolean}
 *   | Promise<{ok: true, target: 'github', output: string, md: string, figuresDir: string, html: string, pdf?: object, hint: string}>}
 */
export function publish(pageFile, opts) {
  const { to, out, store, storeName, dryRun = false, deploy = false, internal = false, pdf = false } = opts
  // The page's own store (an ancestor `.writeup.toml`) wins over the
  // registry's marker/default pick, so a page in `work/` is checked against
  // `work/.writeup.toml`'s private words even when run from elsewhere.
  const storeDir = resolveStoreDir(store, { name: storeName, cwd: dirname(resolve(pageFile)) })

  if (!['file', 'artifact', 'cloudflare', 'github'].includes(to)) {
    throw new PublishError(2, `unknown --to target: ${to}`)
  }

  if (internal && to !== 'github') {
    throw new PublishError(2, '--internal only applies to --to github; for artifact/cloudflare/file the private-word check always runs')
  }

  let raw
  try {
    raw = readFileSync(pageFile, 'utf8')
  } catch (e) {
    throw new PublishError(3, `self-check could not read the page: cannot read file: ${pageFile} (${e.message})`)
  }
  const renderErrors = []
  const rendered = ensureRendered(raw, { onError: (m) => renderErrors.push(m) })
  if (renderErrors.length) {
    throw new PublishError(7, 'publish refused: a .wu-diffview could not be rendered', renderErrors.join('\n'))
  }

  assertSelfCheckPasses(rendered, pageFile)

  const cssInlined = inlineKitCss(rendered, storeDir)
  const assetsInlined = inlinePageAssets(cssInlined, dirname(pageFile))
  const staged = adjustBackNav(assetsInlined, to, storeDir)

  if (!internal) {
    const hits = findPrivateWordHits(staged, privateWords(storeDir))
    if (hits.length) {
      throw new PublishError(4, 'publish refused: private words found on the page', hits.join(', '))
    }
  }

  assertSize(staged)

  if (to === 'cloudflare') assertCloudflareAccess(storeDir)

  if (dryRun) {
    return planDryRun(pageFile, staged, { to, out, storeDir, deploy, pdf })
  }

  if (to === 'file') return publishToFile(staged, out)
  if (to === 'artifact') return publishToArtifact(staged, pageFile, storeDir)
  if (to === 'github') return publishToGithub(staged, rendered, pageFile, storeDir, { out, pdf })
  return publishToCloudflare(staged, pageFile, storeDir, { deploy })
}

function assertCloudflareAccess(storeDir) {
  const cfg = cloudflareConfig(storeDir)
  if (cfg.access_required === true && cfg.access_verified !== true) {
    throw new PublishError(5, 'publish refused: cloudflare Access is required but not verified ([cloudflare] access_verified = true is missing)')
  }
}

function planDryRun(pageFile, staged, { to, out, storeDir, deploy, pdf }) {
  const bytes = Buffer.byteLength(staged, 'utf8')
  const plan = { ok: true, target: to, dryRun: true, bytes }
  if (to === 'file') plan.output = out || '(missing --out)'
  if (to === 'artifact') {
    plan.output = join(storeDir, '.publish', `${slugOf(pageFile)}.artifact.html`)
    // The reported `bytes` is still the full staged document's size (a
    // conservative, slightly-over-real-size upper bound for the 16MB
    // check); the file actually written is smaller — a fragment with the
    // <!DOCTYPE>/<html>/<head>/<body> skeleton and two <meta>s stripped.
    plan.fragment = true
  }
  if (to === 'cloudflare') {
    const rel = relative(storeDir, pageFile)
    plan.output = join(storeDir, 'public', rel)
    const project = cloudflareConfig(storeDir).project || '<project>'
    plan.command = `wrangler pages deploy public --project-name ${project}`
    plan.wouldDeploy = deploy
  }
  if (to === 'github') {
    const slug = slugOf(pageFile)
    plan.output = githubOutDir(storeDir, slug, out)
    // Exact figure file names depend on each figure's IR id, only known
    // once to-md.mjs actually walks the page — a dry-run reports the
    // shape of what would land in the folder, not the final names.
    plan.files = [`${slug}.md`, `${slug}.html`, 'figures/ (*.svg per .wu-figure, plus any .wu-shot copies)']
    if (pdf) plan.files.push(`${slug}.pdf`)
  }
  return plan
}

function publishToFile(staged, out) {
  if (!out) throw new PublishError(2, '--to file requires --out <path>')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, staged)
  return { ok: true, target: 'file', output: out }
}

const HEAD_OPEN_TAG = '<head>'
const HEAD_COMMENT_RE = /<!--[\s\S]*?-->/g
const META_CHARSET_RE = /<meta\s+charset="[^"]*"\s*>/gi
const META_VIEWPORT_RE = /<meta\s+name="viewport"[^>]*>/gi
const TITLE_TAG_RE = /<title\b[^>]*>[\s\S]*?<\/title>/i

/**
 * Converts a full staged HTML document into the fragment the Artifact tool
 * expects: no `<!DOCTYPE>`/`<html>`/`<head>`/`<body>` of its own, since the
 * tool wraps whatever it's given in exactly that skeleton (plus a charset
 * and viewport `<meta>`) at publish time. Returns the `<head>`'s own
 * children — minus the charset/viewport `<meta>`s the tool already
 * supplies, minus every HTML comment, with `<title>` moved to the very
 * front (the tool's contract: "put your own `<title>` and `<style>` at the
 * top of the file") — followed by the `<body>`'s inner content (comments
 * removed there too).
 *
 * The skeleton is located by literal tag search (`indexOf`/`lastIndexOf`),
 * never a regex spanning from an opening tag to its closing one: this
 * kit's own `kit/template.html` carries an explanatory comment that quotes
 * `</body>` as literal text (the sidetoc note right after `<main>`), so the
 * *first* `</head>`/`</body>` found via a naive scan is correct, but a
 * naive scan for `</body>` specifically must use the *last* occurrence —
 * the same reason `build.mjs`'s own sidetoc-script insertion point is
 * `text.lastIndexOf('</body>')`, not the first. A `<body …>` open tag's own
 * closing `>` is located rather than assuming a bare `<body>`, since a
 * page could (in principle) carry attributes there.
 */
export function toArtifactFragment(html) {
  // `<head>` never carries attributes in this kit — an exact literal match
  // (rather than `indexOf('<head')` + a search for its closing `>`) also
  // sidesteps `<head` matching as a prefix of `<header`, which does carry
  // attributes and appears inside every page's body.
  const headOpen = html.indexOf(HEAD_OPEN_TAG)
  const headInnerStart = headOpen === -1 ? -1 : headOpen + HEAD_OPEN_TAG.length
  const headClose = headInnerStart === -1 ? -1 : html.indexOf('</head>', headInnerStart)
  const bodyOpen = html.indexOf('<body')
  const bodyOpenEnd = bodyOpen === -1 ? -1 : html.indexOf('>', bodyOpen)
  const bodyClose = html.lastIndexOf('</body>')
  if (
    headOpen === -1 || headClose === -1 ||
    bodyOpen === -1 || bodyOpenEnd === -1 || bodyClose === -1 ||
    bodyClose <= bodyOpenEnd
  ) {
    throw new PublishError(2, 'publish refused: could not locate a <head>…</head> / <body>…</body> skeleton to build the Artifact fragment')
  }

  const headInner = html.slice(headInnerStart, headClose)
    .replace(HEAD_COMMENT_RE, '')
    .replace(META_CHARSET_RE, '')
    .replace(META_VIEWPORT_RE, '')
  const bodyInner = html.slice(bodyOpenEnd + 1, bodyClose).replace(HEAD_COMMENT_RE, '')

  const titleMatch = TITLE_TAG_RE.exec(headInner)
  const title = titleMatch ? titleMatch[0] : ''
  const headWithoutTitle = titleMatch
    ? headInner.slice(0, titleMatch.index) + headInner.slice(titleMatch.index + titleMatch[0].length)
    : headInner

  return [title, headWithoutTitle, bodyInner]
    .filter((part) => part.trim() !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') + '\n'
}

function publishToArtifact(staged, pageFile, storeDir) {
  const dir = join(storeDir, '.publish')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${slugOf(pageFile)}.artifact.html`)
  writeFileSync(out, toArtifactFragment(staged))
  return { ok: true, target: 'artifact', output: out }
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n\n?/

/** Strips to-md's YAML frontmatter block, keeping the `# title` line right
 * after it — a GitHub PR body would otherwise render the frontmatter as a
 * raw `---` fence, not metadata. */
function stripFrontmatter(md) {
  return md.replace(FRONTMATTER_RE, '')
}

function githubOutDir(storeDir, slug, out) {
  return out || join(storeDir, '.publish', `${slug}.github`)
}

/** Rewrites every file to-md's own manifest marked `kind: 'figure'`
 * (a `.wu-figure`'s exported SVG) through `standaloneSvg`, using the kit's
 * own `writeup.css` (figures are a kit component; a store's
 * `_kit/writeup.css` is only ever a synced copy of the same file, so
 * reading the kit's copy directly needs no store at all — useful when
 * `pageFile` has no store, like kit/samples.html).
 *
 * Deliberately driven by the manifest, never a directory listing filtered
 * on `.svg` — a `.wu-shot` screenshot whose own source happens to be an
 * `.svg` (allowed by `lib/assets.mjs`'s extension guard) sits in the same
 * `figures/` directory with the same extension, and restyling it would
 * inject the kit's CSS/background into a file that is meant to ship
 * byte-identical to what the page author supplied — the manifest is the
 * only thing that actually knows which file came from which component. */
function restyleFigures(figuresDir, figureFiles) {
  if (!existsSync(figuresDir)) return
  const cssPath = join(KIT_DIR, 'writeup.css')
  const cssText = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  for (const name of figureFiles) {
    const file = join(figuresDir, name)
    if (!existsSync(file)) continue
    const svg = readFileSync(file, 'utf8')
    writeFileSync(file, standaloneSvg(svg, cssText))
  }
}

/** Single-quotes `s` for safe interpolation into a shell command line:
 * wraps it in `'…'` and escapes every embedded `'` as `'\''` (close the
 * quote, an escaped literal quote, reopen the quote) — the standard POSIX
 * shell-quoting trick, since a single-quoted string otherwise cannot
 * contain a `'` at all. Used everywhere `attachHint` interpolates a path
 * it did not fully control the shape of (a slug or figure file name can,
 * in principle, come from page content) into the printed `gh`/`cd`
 * command. */
export function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

/** A `gh` invocation the caller can run once the folder is committed
 * nowhere and attached everywhere: `--attach` uploads each figure to
 * GitHub's own attachment store and rewrites the Markdown body's
 * `![alt](figures/x.svg)` references to the uploaded URLs — but only when
 * the attached path resolves to the *same file* as the reference, and
 * that resolution runs against the process's current working directory
 * (cli/cli#14262), not against the Markdown file's own location. The
 * `.md` here links its figures as the relative `figures/<name>.svg` (the
 * shape `--attach` rewrites), so the printed command `cd`s into the
 * output folder first and passes `--attach` the same relative
 * `figures/<name>.svg` path — an absolute `--attach` path would still
 * upload the file, but silently fail to rewrite the reference, appending
 * the image at the end of the body instead of inlining it where the
 * figure actually sits. Every path is single-quoted (`shQuote`) since a
 * slug or figure file name is, in principle, content-controlled. Built
 * from the actual files on disk, not a guess — a page with no figures
 * gets a plain `--body-file` command. */
export function attachHint(dir, mdPath, figuresDir) {
  const mdRel = relative(dir, mdPath)
  const files = existsSync(figuresDir) ? readdirSync(figuresDir).sort() : []
  const attach = files.map((f) => `--attach ${shQuote(join('figures', f))}`).join(' ')
  const bodyArgs = `--body-file ${shQuote(mdRel)}${attach ? ` ${attach}` : ''}`
  return `(cd ${shQuote(dir)} && gh pr create ${bodyArgs}) (or, from inside that folder: gh pr comment <number> ${bodyArgs})`
}

/**
 * Writes the `github` target's output folder: `<slug>.md` (to-md's
 * Markdown, figures linked as `figures/<name>.svg` — the exact relative
 * shape `gh --attach` rewrites), `figures/*.svg` (each `.wu-figure`
 * restyled through `standaloneSvg` so it carries its own look) plus any
 * `.wu-shot` file copied alongside them, `<slug>.html` (the same staged,
 * fully self-contained document every other target produces — useful on
 * its own as the 原本 for a human to attach or keep), and, only with
 * `--pdf`, `<slug>.pdf` rendered from that same `<slug>.html`.
 *
 * Never writes into a repository, computes no SHA, and never calls `gh`
 * itself — the only door into a PR's body or a comment is `gh`'s own
 * `--attach` upload, run by a human (or a follow-up tool call) afterward.
 *
 * Async only because `--pdf` is (`renderPdf` launches a real headless
 * Chromium); the caller (`publish()`) returns whatever this returns, so
 * only a `--to github` call needs an `await` — every other target stays
 * synchronous.
 */
async function publishToGithub(staged, rendered, pageFile, storeDir, { out, pdf: wantPdf }) {
  const slug = slugOf(pageFile)
  const dir = githubOutDir(storeDir, slug, out)
  const figuresDir = join(dir, 'figures')
  mkdirSync(dir, { recursive: true })

  const htmlPath = join(dir, `${slug}.html`)
  writeFileSync(htmlPath, staged)

  // to-md's manifest tells figure exports (kind: 'figure') apart from
  // .wu-shot copies (kind: 'shot') that happen to land in the same
  // figures/ directory — only the former gets restyled below.
  const manifest = []
  const md = convertToMarkdown(rendered, { slug, figuresDir, figuresDirRel: 'figures', pageDir: dirname(pageFile), manifest })
  const mdPath = join(dir, `${slug}.md`)
  writeFileSync(mdPath, stripFrontmatter(md))

  const figureFiles = manifest.filter((m) => m.kind === 'figure').map((m) => m.file)
  restyleFigures(figuresDir, figureFiles)

  const result = { ok: true, target: 'github', output: dir, md: mdPath, figuresDir, html: htmlPath }

  if (wantPdf) {
    result.pdf = await renderPdf(htmlPath, join(dir, `${slug}.pdf`))
  }

  result.hint = attachHint(dir, mdPath, figuresDir)
  return result
}

function publishToCloudflare(staged, pageFile, storeDir, { deploy }) {
  const cfg = cloudflareConfig(storeDir)
  const rel = relative(storeDir, pageFile)
  const out = join(storeDir, 'public', rel)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, staged)

  const project = cfg.project || ''
  const command = `wrangler pages deploy public --project-name ${project}`
  const result = { ok: true, target: 'cloudflare', output: out, command }

  if (deploy) {
    if (!wranglerAvailable()) {
      result.deployed = false
      result.deploySkippedReason = 'wrangler not found on PATH'
    } else {
      execFileSync('wrangler', ['pages', 'deploy', 'public', '--project-name', project], {
        cwd: storeDir, stdio: 'inherit',
      })
      result.deployed = true
    }
  }
  return result
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    file: null, to: null, out: null, store: null, storeName: null,
    dryRun: false, deploy: false, pdf: false, internal: false,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--to') args.to = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--store') args.store = argv[++i]
    else if (a === '--store-name') args.storeName = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--deploy') args.deploy = true
    else if (a === '--pdf') args.pdf = true
    else if (a === '--internal') args.internal = true
    else positional.push(a)
  }
  args.file = positional[0] ?? null
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file || !args.to) {
    console.error('usage: node bin/publish.mjs <page.html> --to artifact|cloudflare|file|github [--out path] [--store dir | --store-name name] [--dry-run] [--deploy] [--pdf] [--internal]')
    return 2
  }
  try {
    const result = await publish(args.file, args)
    if (result.dryRun) {
      console.log(`publish --dry-run: target=${result.target} bytes=${result.bytes}`)
      console.log(`  output: ${result.output}`)
      if (result.fragment) console.log('  note: written as a <head>/<body>-stripped fragment for the Artifact tool, not a full document — bytes above is the pre-fragment upper bound')
      if (result.command) console.log(`  command: ${result.command}${result.wouldDeploy ? '' : ' (not run; pass --deploy)'}`)
      if (result.files) {
        console.log(`  would write, under ${result.output}/:`)
        for (const f of result.files) console.log(`    ${f}`)
      }
    } else {
      console.log(`publish: wrote ${result.output}`)
      if (result.command) console.log(`  ${result.deployed ? 'ran' : 'to deploy'}: ${result.command}`)
      if (result.deploySkippedReason) console.log(`  skipped deploy: ${result.deploySkippedReason}`)
      if (result.pdf) {
        if (result.pdf.generated) console.log(`  pdf: ${result.pdf.path}`)
        else console.log(`  pdf skipped: ${result.pdf.reason}`)
      }
      if (result.hint) console.log(`  ${result.hint}`)
    }
    return 0
  } catch (e) {
    if (e instanceof PublishError) {
      console.error(`publish: ${e.message}`)
      if (e.detail) console.error(e.detail)
      return e.code
    }
    console.error(`publish: unexpected error: ${e.stack || e}`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code))
}
