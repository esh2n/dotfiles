#!/usr/bin/env node
// publish.mjs — stages a page for an external audience (contract §8).
// Pre-stage, always in this order: (0) --to is one of the 3 known targets,
// (1) run build's rendering passes (viewport meta, `.wu-diffview` tables,
// code highlighting — `ensureRendered`) so a page that skipped `build`, or a
// kit reference page no store build scans, never ships unrendered, then
// self-check must pass on that rendered text (it needs the page's own
// `.wu-shot` asset files to exist on disk, which is still true at this
// point — nothing has moved them yet), (2) inline the kit CSS, (3) inline
// every `.wu-shot` image (a page-relative `<slug>-assets/*` file) as a
// `data:` URI (`inlinePageAssets`) so the staged output stays one file for
// every target, (4) adjust `.wu-header`'s back-to-index nav for the target
// (dropped for file/artifact; rewritten to `/index.html` or dropped for
// cloudflare — see `adjustBackNav`), (5) reject on a company-trace word
// hit, (6) enforce the 16MB Artifact-tool size ceiling. Then dispatch to
// one of 3 targets. The status favicon `<link rel="icon">` (page-
// contract.md §1) is not touched by any of this — its href is an inline
// `data:` URI already, so it carries through to every target unchanged.
//
// Exit codes: 0 success/dry-run, 2 usage error, 3 self-check failed,
// 4 private-word hit, 5 cloudflare Access not verified, 6 size over 16MB,
// 7 a `.wu-diffview` whose diff could not be rendered, 8 the kit CSS
// `<link>` survived inlining (see `inlineKitCss`'s comment-skip below).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { runSelfCheckText } from './self-check.mjs'
import { ensureRendered } from './build.mjs'
import { resolveStoreDir, privateWords, cloudflareConfig } from './lib/store.mjs'
import { parseHtml, headMeta, titleText, textContent, findFirst, tagName } from './lib/html.mjs'
import { resolvePageAsset } from './lib/assets.mjs'

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
 * @returns {{ok: true, target: string, output?: string, command?: string, dryRun?: boolean}}
 */
export function publish(pageFile, opts) {
  const { to, out, store, storeName, dryRun = false, deploy = false } = opts
  // The page's own store (an ancestor `.writeup.toml`) wins over the
  // registry's marker/default pick, so a page in `work/` is checked against
  // `work/.writeup.toml`'s private words even when run from elsewhere.
  const storeDir = resolveStoreDir(store, { name: storeName, cwd: dirname(resolve(pageFile)) })

  if (!['file', 'artifact', 'cloudflare'].includes(to)) {
    throw new PublishError(2, `unknown --to target: ${to}`)
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

  const hits = findPrivateWordHits(staged, privateWords(storeDir))
  if (hits.length) {
    throw new PublishError(4, 'publish refused: private words found on the page', hits.join(', '))
  }

  assertSize(staged)

  if (to === 'cloudflare') assertCloudflareAccess(storeDir)

  if (dryRun) {
    return planDryRun(pageFile, staged, { to, out, storeDir, deploy })
  }

  if (to === 'file') return publishToFile(staged, out)
  if (to === 'artifact') return publishToArtifact(staged, pageFile, storeDir)
  return publishToCloudflare(staged, pageFile, storeDir, { deploy })
}

function assertCloudflareAccess(storeDir) {
  const cfg = cloudflareConfig(storeDir)
  if (cfg.access_required === true && cfg.access_verified !== true) {
    throw new PublishError(5, 'publish refused: cloudflare Access is required but not verified ([cloudflare] access_verified = true is missing)')
  }
}

function planDryRun(pageFile, staged, { to, out, storeDir, deploy }) {
  const bytes = Buffer.byteLength(staged, 'utf8')
  const plan = { ok: true, target: to, dryRun: true, bytes }
  if (to === 'file') plan.output = out || '(missing --out)'
  if (to === 'artifact') plan.output = join(storeDir, '.publish', `${slugOf(pageFile)}.artifact.html`)
  if (to === 'cloudflare') {
    const rel = relative(storeDir, pageFile)
    plan.output = join(storeDir, 'public', rel)
    const project = cloudflareConfig(storeDir).project || '<project>'
    plan.command = `wrangler pages deploy public --project-name ${project}`
    plan.wouldDeploy = deploy
  }
  return plan
}

function publishToFile(staged, out) {
  if (!out) throw new PublishError(2, '--to file requires --out <path>')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, staged)
  return { ok: true, target: 'file', output: out }
}

function publishToArtifact(staged, pageFile, storeDir) {
  const dir = join(storeDir, '.publish')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${slugOf(pageFile)}.artifact.html`)
  writeFileSync(out, staged)
  return { ok: true, target: 'artifact', output: out }
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
  const args = { file: null, to: null, out: null, store: null, storeName: null, dryRun: false, deploy: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--to') args.to = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--store') args.store = argv[++i]
    else if (a === '--store-name') args.storeName = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--deploy') args.deploy = true
    else positional.push(a)
  }
  args.file = positional[0] ?? null
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file || !args.to) {
    console.error('usage: node bin/publish.mjs <page.html> --to artifact|cloudflare|file [--out path] [--store dir | --store-name name] [--dry-run] [--deploy]')
    return 2
  }
  try {
    const result = publish(args.file, args)
    if (result.dryRun) {
      console.log(`publish --dry-run: target=${result.target} bytes=${result.bytes}`)
      console.log(`  output: ${result.output}`)
      if (result.command) console.log(`  command: ${result.command}${result.wouldDeploy ? '' : ' (not run; pass --deploy)'}`)
    } else {
      console.log(`publish: wrote ${result.output}`)
      if (result.command) console.log(`  ${result.deployed ? 'ran' : 'to deploy'}: ${result.command}`)
      if (result.deploySkippedReason) console.log(`  skipped deploy: ${result.deploySkippedReason}`)
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
