#!/usr/bin/env node
// migrate-explain-pages.mjs — one-off converter from the old explain-pages
// Markdown format (`:::directive` blocks, docs/authoring.md) to writeup-kit
// HTML pages (the contract at _design/2026-08-28-writeup-contract.html).
//
// Usage:
//   node bin/migrate-explain-pages.mjs --src <pages-dir> --dest <store-dir> \
//     [--dry-run] [--only <glob>] [--report report.json]
//
// Zero runtime dependencies (Node standard library + the kit's own
// bin/lib/*.mjs). Never writes into a real store unless the caller passes
// a --dest they intend to write into — --dry-run performs every step
// (including self-check, via a throwaway temp file) without touching disk
// at --dest.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFrontmatter } from './lib/migrate/frontmatter.mjs'
import { renderBody, isLegacyFile, legacyReasons } from './lib/migrate/body.mjs'
import { buildPageHtml, buildLegacyStubHtml } from './lib/migrate/page.mjs'
import { parseDatedFilename, matchesOnly, cssHrefForDepth } from './lib/migrate/util.mjs'
import { runSelfCheck } from './self-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// --- CLI args ---------------------------------------------------------

function parseArgs(argv) {
  const args = { src: null, dest: null, dryRun: false, only: null, report: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') args.src = argv[++i]
    else if (a === '--dest') args.dest = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--only') args.only = argv[++i]
    else if (a === '--report') args.report = argv[++i]
  }
  return args
}

// --- file walking -------------------------------------------------------

function walkMarkdownFiles(dir) {
  const out = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMarkdownFiles(full))
    else if (e.isFile() && e.name.endsWith('.md') && e.name !== '_project.md') out.push(full)
  }
  return out
}

function toPosixRel(base, full) {
  return relative(base, full).split(sep).join('/')
}

// --- kind guess -----------------------------------------------------------

function guessKind(title, tags) {
  const hay = `${title} ${(tags || []).join(' ')}`
  if (hay.includes('決定')) return '決定記録'
  if (hay.includes('調査')) return '調査まとめ'
  return '設計'
}

// --- self-check (always via a throwaway temp file, dry-run or not) --------

function computeSelfCheck(html) {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-explain-pages-'))
  const path = join(dir, 'page.html')
  try {
    writeFileSync(path, html)
    const result = runSelfCheck(path)
    if (result.unreadable) return 'error'
    return result.ok ? 'pass' : 'fail'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- per-file conversion --------------------------------------------------

async function convertOne(srcRoot, destRoot, fullPath, { dryRun }) {
  const relPath = toPosixRel(srcRoot, fullPath)
  const raw = readFileSync(fullPath, 'utf8')
  const folders = relPath.split('/').slice(0, -1)
  const basename = relPath.split('/').at(-1)
  const { date: filenameDate, slug } = parseDatedFilename(basename)

  if (isLegacyFile(raw)) {
    const reasons = legacyReasons(raw)
    const { meta } = parseFrontmatter(raw)
    const title = typeof meta.title === 'string' ? meta.title : slug
    const description = typeof meta.summary === 'string' ? meta.summary : ''
    const date = filenameDate ?? (typeof meta.date === 'string' ? meta.date : '1970-01-01')
    const depth = 1 + folders.length // "legacy/" + original folders
    const cssHref = cssHrefForDepth(depth)
    const stubHtml = buildLegacyStubHtml({
      title, description, date, updated: date, migratedFrom: relPath,
      ledeText: description || title, reason: reasons.map((r) => `:::${r}`).join(', '),
      cssHref,
    })
    const mdDest = join(destRoot, 'legacy', relPath)
    const htmlDest = join(destRoot, 'legacy', ...folders, `${date}-${slug}.html`)
    if (!dryRun) {
      mkdirSync(dirname(mdDest), { recursive: true })
      copyFileSync(fullPath, mdDest)
      mkdirSync(dirname(htmlDest), { recursive: true })
      writeFileSync(htmlDest, stubHtml)
    }
    const roughCounts = {}
    for (const name of ['diagram', 'sequence', 'terms', 'cells', 'steps', 'diff', 'scorebars', 'aggregate', 'html', 'board', 'dddboard', 'pr', 'compare']) {
      const c = (raw.match(new RegExp(`:::+${name}\\b`, 'g')) || []).length
      if (c) roughCounts[name] = c
    }
    return {
      src: relPath, dest: relative(destRoot, htmlDest).split(sep).join('/'),
      kind: null, directives: roughCounts, figures: { ok: 0, fallback: 0 },
      sequenceAsSteps: 0, legacy: true, warnings: [`legacy: contains ${reasons.map((r) => `:::${r}`).join(', ')}`],
    }
  }

  const { meta, body } = parseFrontmatter(raw)
  const warnings = []
  const title = typeof meta.title === 'string' && meta.title ? meta.title : (warnings.push('missing frontmatter title, used slug'), slug)
  const summary = typeof meta.summary === 'string' && meta.summary ? meta.summary : (warnings.push('missing frontmatter summary'), '')
  const date = filenameDate ?? (typeof meta.date === 'string' ? meta.date : (warnings.push('missing date, used epoch'), '1970-01-01'))
  const tags = Array.isArray(meta.tags) ? meta.tags : []
  const kind = guessKind(title, tags)

  const { sectionsHtml, warnings: bodyWarnings, directiveCounts, figures, sequenceAsSteps } = await renderBody(body)
  warnings.push(...bodyWarnings)

  const extraMeta = []
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'title' || key === 'summary' || key === 'date') continue
    const content = Array.isArray(value) ? value.join(', ') : String(value)
    extraMeta.push({ name: `x-legacy-${key}`, content })
  }

  const depth = folders.length
  const cssHref = cssHrefForDepth(depth)
  const diagramTotal = figures.ok + figures.fallback
  const checksContent = `lint=skipped;self-check=pending;diagram=${figures.ok}/${diagramTotal}`

  let html = buildPageHtml({
    title, description: summary, kind, date, updated: date, checksContent,
    cssHref, migratedFrom: relPath, extraMeta, ledeText: summary || title, bodyHtml: sectionsHtml,
  })

  const selfCheckResult = computeSelfCheck(html)
  const finalChecksContent = `lint=skipped;self-check=${selfCheckResult};diagram=${figures.ok}/${diagramTotal}`
  html = html.replace(
    /<meta name="checks" content="[^"]*">/,
    `<meta name="checks" content="${finalChecksContent.replace(/"/g, '&quot;')}">`,
  ).replace(
    /<dt>checks<\/dt><dd>[^<]*<\/dd>/,
    `<dt>checks</dt><dd>${finalChecksContent}</dd>`,
  )

  const destPath = join(destRoot, ...folders, `${date}-${slug}.html`)
  if (!dryRun) {
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, html)
  }

  return {
    src: relPath,
    dest: relative(destRoot, destPath).split(sep).join('/'),
    kind, directives: directiveCounts, figures, sequenceAsSteps, legacy: false,
    warnings, selfCheck: selfCheckResult,
  }
}

// --- report / summary ------------------------------------------------------

function warningType(w) {
  const m = /^([a-zA-Z-]+):/.exec(w)
  return m ? m[1] : (w.startsWith('legacy:') ? 'legacy' : (w.startsWith('missing') ? 'frontmatter' : 'other'))
}

function summarize(entries) {
  const totals = {
    files: entries.length,
    legacy: entries.filter((e) => e.legacy).length,
    directives: {},
    figures: { ok: 0, fallback: 0 },
    sequenceAsSteps: 0,
    warningTypes: {},
    selfCheck: { pass: 0, fail: 0, error: 0 },
  }
  for (const e of entries) {
    for (const [name, count] of Object.entries(e.directives)) {
      totals.directives[name] = (totals.directives[name] ?? 0) + count
    }
    totals.figures.ok += e.figures.ok
    totals.figures.fallback += e.figures.fallback
    totals.sequenceAsSteps += e.sequenceAsSteps
    if (e.selfCheck) totals.selfCheck[e.selfCheck] = (totals.selfCheck[e.selfCheck] ?? 0) + 1
    for (const w of e.warnings) {
      const t = warningType(w)
      totals.warningTypes[t] = (totals.warningTypes[t] ?? 0) + 1
    }
  }
  return totals
}

function printSummary(totals) {
  const lines = []
  lines.push(`files: ${totals.files} (legacy: ${totals.legacy})`)
  lines.push('directives:')
  for (const [name, count] of Object.entries(totals.directives).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${name}: ${count}`)
  }
  lines.push(`figures: ok=${totals.figures.ok} fallback=${totals.figures.fallback}`)
  lines.push(`sequence-as-steps: ${totals.sequenceAsSteps}`)
  lines.push(`self-check: pass=${totals.selfCheck.pass ?? 0} fail=${totals.selfCheck.fail ?? 0} error=${totals.selfCheck.error ?? 0}`)
  const topWarnings = Object.entries(totals.warningTypes).sort((a, b) => b[1] - a[1]).slice(0, 5)
  lines.push('top warning types:')
  for (const [type, count] of topWarnings) lines.push(`  ${type}: ${count}`)
  console.error(lines.join('\n'))
}

// --- main -------------------------------------------------------------

export async function runMigration(args) {
  if (!args.src || !args.dest) {
    throw new Error('usage: migrate-explain-pages.mjs --src <pages-dir> --dest <store-dir> [--dry-run] [--only <glob>] [--report report.json]')
  }
  const allFiles = walkMarkdownFiles(args.src)
  const files = allFiles.filter((f) => matchesOnly(toPosixRel(args.src, f), args.only))

  const entries = []
  for (const f of files) {
    entries.push(await convertOne(args.src, args.dest, f, { dryRun: args.dryRun }))
  }

  const totals = summarize(entries)
  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true })
    writeFileSync(args.report, JSON.stringify({ entries, totals }, null, 2))
  }
  printSummary(totals)
  return { entries, totals }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  runMigration(args).catch((e) => {
    console.error(`error: ${e.message}`)
    process.exitCode = 1
  })
}
