#!/usr/bin/env node
// rerender-figures.mjs — re-render every stored diagram figure whose IR is
// still recoverable from its own bytes (a `.wu-figure` carrying a
// `text/x-writeup-diagram` script) but isn't confirmed passing (missing
// `data-checks="pass"`) — e.g. every fallback figure directives.mjs ever
// emitted — or, with --all, every figure regardless of its current
// data-checks state (the useful mode right after a kit/renderer upgrade,
// when a figure that passed under the old contract may now fail, or one
// that used to fail may now pass).
//
// A figure whose re-render still doesn't pass verification is left
// byte-for-byte untouched; everything else about the page (chrome, prose,
// other figures) is also left untouched — only the exact
// `<figure class="wu-figure" ...>...</figure>` span of a *fixed* figure is
// replaced, plus the page's `<meta name="checks">` diagram=ok/total pair.
//
//   node bin/rerender-figures.mjs [--store dir] [--only <glob>] [--dry-run] [--all] [--report out.json]
//
// Exit codes: 0 always (this is a report/repair tool, not a gate — run
// self-check.mjs afterward if you need a pass/fail gate), 2 on a bad
// invocation (missing/unreadable store), unless --report can't be written
// (also 2).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { parse as parseYamlLite, YamlError } from './lib/yaml-lite.mjs'
import { validateIR } from './lib/ir.mjs'
import { COLUMN } from './lib/diagram.mjs'
import { renderFigureHtmlChecked } from './lib/verify-diagram.mjs'
import { resolveStoreDir } from './lib/store.mjs'
import { matchesOnly } from './lib/migrate/util.mjs'
import { unescapeIrScript } from './lib/ir-script.mjs'

// Directories that never hold a source page: the kit's own generated CSS
// folder, static publish outputs, and pre-writeup-kit legacy pages (which
// don't carry the `.wu-figure` shape this tool understands).
const EXCLUDED_DIRS = new Set(['_kit', 'public', '.publish', 'legacy', '.git', 'node_modules'])

function toPosix(p) {
  return p.split(sep).join('/')
}

/** Recursively lists `*.html` page files under `storeDir`, skipping
 * EXCLUDED_DIRS and the store-root `index.html` build.mjs generates.
 * Returns paths relative to `storeDir`, POSIX-separated, sorted. */
export function listStorePages(storeDir) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      if (!e.isFile() || !e.name.endsWith('.html')) continue
      const rel = toPosix(relative(storeDir, full))
      if (rel === 'index.html') continue
      out.push(rel)
    }
  }
  walk(storeDir)
  return out.sort()
}

// --- raw-text figure scanning (byte-offset based, so a fixed figure can be
// spliced in place without disturbing anything else in the file) -----------

/** Every top-level `<figure class="...wu-figure...">...</figure>` span in
 * `raw`, matched by tag-depth (a nested `<figure>` — never emitted by this
 * kit, but tolerated) doesn't split a block early. Attribute order inside
 * the opening tag is irrelevant: the class match is a substring test
 * against the raw attribute text, not a fixed position. */
export function findFigureBlocks(raw) {
  const blocks = []
  const openRe = /<figure\b([^>]*)>/g
  let m
  while ((m = openRe.exec(raw))) {
    const attrsStr = m[1]
    if (!/\bclass\s*=\s*"[^"]*\bwu-figure\b[^"]*"/.test(attrsStr)) continue
    const tagRe = /<(\/?)figure\b[^>]*>/g
    tagRe.lastIndex = openRe.lastIndex
    let depth = 1
    let closeIdx = -1
    let t
    while ((t = tagRe.exec(raw))) {
      if (t[1] === '') depth++
      else {
        depth--
        if (depth === 0) { closeIdx = t.index + t[0].length; break }
      }
    }
    if (closeIdx === -1) { openRe.lastIndex = raw.length; continue } // unterminated: bail out of this file
    blocks.push({ start: m.index, end: closeIdx, attrsStr, inner: raw.slice(m.index, closeIdx) })
    openRe.lastIndex = closeIdx
  }
  return blocks
}

const SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*"text\/x-writeup-diagram"[^>]*>([\s\S]*?)<\/script>/

/** True when a figure block's opening tag carries `data-checks="pass"`. */
export function figureChecksPass(block) {
  return /\bdata-checks\s*=\s*"pass"/.test(block.attrsStr)
}

/** The embedded IR text (YAML or JSON — both are accepted by
 * yaml-lite.mjs), stripped of the one leading/trailing newline the
 * `<script>\n${text}\n</script>` wrapper always adds. `null` when the
 * figure carries no `text/x-writeup-diagram` script at all (nothing to
 * re-render from — e.g. a hand-written figure, or a pre-kit-upgrade
 * fallback that predates this being embedded). */
export function figureIrText(block) {
  const m = SCRIPT_RE.exec(block.inner)
  if (!m) return null
  // Writers HTML-escape the IR text before embedding it (ir-script.mjs);
  // unescape here so the caller gets parseable YAML/JSON back. Tolerant of
  // legacy pages written before this contract existed (raw, unescaped
  // text passes through unchanged).
  return unescapeIrScript(m[1].replace(/^\n/, '').replace(/\n$/, ''))
}

// --- one figure ------------------------------------------------------------

/**
 * @param {string} irText raw YAML/JSON from figureIrText()
 * @param {{column: number}} opts
 * @returns {Promise<{ok:boolean, html?:string, warnings?:object[], warn?:string, reason?:string, message?:string, failing?:object[]}>}
 *   `warnings` (budget overruns — the figure still rendered and passed) and
 *   `warn` (the `data-warn` string, '' when none) accompany an ok result.
 */
export async function rerenderOne(irText, { column }) {
  let raw
  try {
    raw = parseYamlLite(irText)
  } catch (e) {
    if (e instanceof YamlError) return { ok: false, reason: 'parse-error', message: e.message }
    throw e
  }
  const validated = validateIR(raw)
  if (!validated.ok) return { ok: false, reason: validated.reason, message: validated.message }

  let rendered
  try {
    rendered = await renderFigureHtmlChecked(validated.ir, { column, rawYaml: irText })
  } catch (e) {
    return { ok: false, reason: 'render-error', message: e.message }
  }
  if (!rendered.checksOk) {
    const failing = rendered.failures ?? rendered.checks.filter((c) => !c.ok)
    return { ok: false, reason: 'verification', failing, warnings: rendered.warnings ?? [] }
  }
  return { ok: true, html: rendered.html, warnings: rendered.warnings ?? [], warn: rendered.warn ?? '' }
}

// --- one page ----------------------------------------------------------------

/**
 * @param {string} raw the page's current file content
 * @param {{column: number, all: boolean}} opts
 * @returns {Promise<{raw:string, tried:object[]}>} the (possibly patched)
 *   page content, plus one entry per figure that was attempted.
 */
export async function rerenderPageText(raw, { column, all }) {
  const blocks = findFigureBlocks(raw)
  const attempts = []
  for (const block of blocks) {
    const alreadyPass = figureChecksPass(block)
    if (alreadyPass && !all) continue
    const irText = figureIrText(block)
    if (irText === null) continue
    const outcome = await rerenderOne(irText, { column })
    attempts.push({ block, alreadyPass, ...outcome })
  }

  // Splice fixed figures in from the end of the file backward so earlier
  // offsets stay valid across multiple replacements in the same page.
  let patched = raw
  const fixes = attempts.filter((a) => a.ok).sort((a, b) => b.block.start - a.block.start)
  for (const fix of fixes) {
    patched = patched.slice(0, fix.block.start) + fix.html + patched.slice(fix.block.end)
  }

  return { raw: patched, tried: attempts }
}

// --- diagram=ok/total meta ---------------------------------------------------

/** Upsert the `diagram=ok/total` pair into `<meta name="checks">`, merging
 * with whatever other key=value pairs are already there (mirrors
 * self-check.mjs's writeMetaChecks, but for the `diagram` key) — a narrow
 * text patch so the rest of the file's bytes never move. */
export function updateDiagramMeta(raw, ok, total) {
  const value = `${ok}/${total}`
  const re = /(<meta\s+name="checks"\s+content=")([^"]*)("\s*>)/
  const m = re.exec(raw)
  if (m) {
    const pairs = m[2].split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
      const idx = s.indexOf('=')
      return idx === -1 ? [s, ''] : [s.slice(0, idx), s.slice(idx + 1)]
    })
    let found = false
    const merged = pairs.map(([k, v]) => {
      if (k === 'diagram') { found = true; return [k, value] }
      return [k, v]
    })
    if (!found) merged.push(['diagram', value])
    const content = merged.map(([k, v]) => `${k}=${v}`).join(';')
    return raw.slice(0, m.index) + m[1] + content + m[3] + raw.slice(m.index + m[0].length)
  }
  const headClose = raw.indexOf('</head>')
  const insertion = `<meta name="checks" content="diagram=${value}">\n`
  if (headClose === -1) return insertion + raw
  return raw.slice(0, headClose) + insertion + raw.slice(headClose)
}

// --- store-wide driver ---------------------------------------------------

/**
 * @param {string} storeDir
 * @param {{only?:string, dryRun?:boolean, all?:boolean, column?:number}} [opts]
 */
export async function rerenderStore(storeDir, { only = null, dryRun = false, all = false, column = COLUMN } = {}) {
  const pages = listStorePages(storeDir).filter((rel) => matchesOnly(rel, only))
  const report = {
    storeDir,
    pagesScanned: pages.length,
    figuresTried: 0,
    fixed: 0,
    // Subset of `fixed`: rendered and passing, but over a budget
    // (data-warn stamped) — the author should consider splitting these.
    warned: 0,
    stillFailing: 0,
    failingChecks: {},
    warnedChecks: {},
    pages: [],
  }

  for (const rel of pages) {
    const full = join(storeDir, rel)
    const original = readFileSync(full, 'utf8')
    const { raw: patched, tried } = await rerenderPageText(original, { column, all })
    if (tried.length === 0) continue

    const fixed = tried.filter((a) => a.ok)
    const warned = fixed.filter((a) => a.warnings && a.warnings.length)
    const failed = tried.filter((a) => !a.ok)

    report.figuresTried += tried.length
    report.fixed += fixed.length
    report.warned += warned.length
    report.stillFailing += failed.length
    for (const f of failed) {
      const names = f.failing && f.failing.length ? f.failing.map((c) => c.name) : [f.reason]
      for (const name of names) report.failingChecks[name] = (report.failingChecks[name] ?? 0) + 1
    }
    for (const w of warned) {
      for (const b of w.warnings) report.warnedChecks[b.key] = (report.warnedChecks[b.key] ?? 0) + 1
    }

    // Recount pass/total across every figure on the page (not just the
    // ones we tried) so `diagram=ok/total` reflects the whole page.
    const finalBlocks = findFigureBlocks(patched)
    const total = finalBlocks.length
    const ok = finalBlocks.filter(figureChecksPass).length
    const withMeta = total > 0 ? updateDiagramMeta(patched, ok, total) : patched

    report.pages.push({
      path: rel,
      tried: tried.length,
      fixed: fixed.length,
      warned: warned.length,
      stillFailing: failed.length,
      diagram: `${ok}/${total}`,
      warnings: warned.map((w) => w.warn),
      failing: failed.map((f) => ({
        reason: f.reason,
        checks: f.failing ? f.failing.map((c) => c.name) : undefined,
        message: f.message,
      })),
    })

    if (!dryRun && withMeta !== original) writeFileSync(full, withMeta, 'utf8')
  }

  return report
}

// --- CLI ------------------------------------------------------------------

const USAGE = 'usage: rerender-figures.mjs [--store dir] [--only <glob>] [--dry-run] [--all] [--report out.json]'

export function parseArgs(argv) {
  const args = { store: null, only: null, dryRun: false, all: false, report: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') { args.store = argv[++i]; if (args.store === undefined) throw new Error('--store requires a path') }
    else if (a === '--only') { args.only = argv[++i]; if (args.only === undefined) throw new Error('--only requires a glob') }
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--all') args.all = true
    else if (a === '--report') { args.report = argv[++i]; if (args.report === undefined) throw new Error('--report requires a path') }
    else if (a === '-h' || a === '--help') args.help = true
    else throw new Error(`unknown argument: ${a}`)
  }
  return args
}

function topChecks(counts, n = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ')
}

function printSummary(report) {
  console.log(`rerender-figures: ${report.pagesScanned} page(s) scanned, ${report.figuresTried} figure(s) tried`)
  console.log(`  fixed: ${report.fixed}`)
  console.log(`  warned: ${report.warned} (rendered and passing, but over a budget — consider splitting)`)
  console.log(`  still failing: ${report.stillFailing}`)
  const topFail = topChecks(report.failingChecks)
  if (topFail) console.log(`  top failing checks: ${topFail}`)
  const topWarn = topChecks(report.warnedChecks)
  if (topWarn) console.log(`  budget warnings: ${topWarn}`)
}

export async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message)
    console.error(USAGE)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  const storeDir = resolveStoreDir(args.store)
  if (!existsSync(storeDir)) {
    console.error(`error: store not found: ${storeDir}`)
    return 2
  }

  const report = await rerenderStore(storeDir, { only: args.only, dryRun: args.dryRun, all: args.all })
  printSummary(report)

  if (args.report) {
    try {
      writeFileSync(args.report, JSON.stringify(report, null, 2))
    } catch (e) {
      console.error(`error: cannot write --report ${args.report}: ${e.message}`)
      return 2
    }
  }

  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
