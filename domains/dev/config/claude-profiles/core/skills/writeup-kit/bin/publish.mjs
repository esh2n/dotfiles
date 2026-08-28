#!/usr/bin/env node
// publish.mjs — stages a page for an external audience (contract §8).
// Pre-stage, always in this order: (0) --to is one of the 3 known targets,
// (1) self-check must pass, (2) inline the kit CSS and adjust `.wu-header`'s
// back-to-index nav for the target (dropped for file/artifact; rewritten to
// `/index.html` or dropped for cloudflare — see `adjustBackNav`), (3) reject
// on a company-trace word hit, (4) enforce the 16MB Artifact-tool size
// ceiling. Then dispatch to one of 3 targets. The status favicon `<link
// rel="icon">` (page-contract.md §1) is not touched by any of this — its
// href is an inline `data:` URI already, so it carries through to every
// target unchanged.
//
// Exit codes: 0 success/dry-run, 2 usage error, 3 self-check failed,
// 4 private-word hit, 5 cloudflare Access not verified, 6 size over 16MB.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, join, relative } from 'node:path'
import { runSelfCheck } from './self-check.mjs'
import { resolveStoreDir, privateWords, cloudflareConfig } from './lib/store.mjs'
import { parseHtml, headMeta, titleText, textContent, findFirst, tagName } from './lib/html.mjs'

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

/** Replaces the kit CSS `<link>` with an inline `<style>`, keeping any
 * Google Fonts `<link>` untouched. Resolves the CSS file relative to
 * `storeDir` (a page-local `../_kit/writeup.css`) or falls back to the
 * kit's own copy (`./writeup.css`, used by kit/template.html itself). */
export function inlineKitCss(html, storeDir) {
  const linkRe = /<link\s+rel="stylesheet"\s+href="((?:\.\.\/)?_kit\/writeup\.css|\.\/writeup\.css)"\s*>/
  const m = linkRe.exec(html)
  if (!m) return html
  const href = m[1]
  const cssPath = href.endsWith('_kit/writeup.css') ? join(storeDir, '_kit', 'writeup.css') : join(KIT_DIR, 'writeup.css')
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  const style = `<style>\n${css}\n</style>`
  return html.slice(0, m.index) + style + html.slice(m.index + m[0].length)
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

function assertSelfCheckPasses(pageFile) {
  const result = runSelfCheck(pageFile)
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
  const { to, out, store, dryRun = false, deploy = false } = opts
  const storeDir = resolveStoreDir(store)

  if (!['file', 'artifact', 'cloudflare'].includes(to)) {
    throw new PublishError(2, `unknown --to target: ${to}`)
  }

  assertSelfCheckPasses(pageFile)

  const raw = readFileSync(pageFile, 'utf8')
  const staged = adjustBackNav(inlineKitCss(raw, storeDir), to, storeDir)

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
  const args = { file: null, to: null, out: null, store: null, dryRun: false, deploy: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--to') args.to = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--store') args.store = argv[++i]
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
    console.error('usage: node bin/publish.mjs <page.html> --to artifact|cloudflare|file [--out path] [--store dir] [--dry-run] [--deploy]')
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
