#!/usr/bin/env node
// build.mjs — regenerates `<store>/manifest.json` and `<store>/index.html`
// from every page's `<head>` meta, and syncs the kit's CSS into
// `<store>/_kit/writeup.css` (contract §1, §1-3). Zero-dependency.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { resolveStoreDir } from './lib/store.mjs'
import { parseHtml, headMeta, titleText } from './lib/html.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_CSS_PATH = join(HERE, '..', 'kit', 'writeup.css')

const EXCLUDED_DIRS = new Set(['_kit', 'public', '.publish', '.git', 'node_modules'])

function toPosix(p) {
  return p.split(sep).join('/')
}

/** Recursively lists `*.html` files under `dir`, skipping the store's
 * generated/publish-only directories. Returns paths relative to `dir`. */
function listHtmlFiles(dir, base = dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') {
      if (EXCLUDED_DIRS.has(e.name)) continue
    }
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue
      out.push(...listHtmlFiles(full, base))
    } else if (e.isFile() && e.name.endsWith('.html')) {
      const rel = toPosix(relative(base, full))
      if (rel === 'index.html') continue
      out.push(rel)
    }
  }
  return out
}

function parseChecks(raw) {
  const out = {}
  if (!raw) return out
  for (const pair of raw.split(';')) {
    const s = pair.trim()
    if (!s) continue
    const idx = s.indexOf('=')
    if (idx === -1) out[s] = ''
    else out[s.slice(0, idx)] = s.slice(idx + 1)
  }
  return out
}

/** First-version date from a `YYYY-MM-DD-` filename prefix, falling back to
 * `<meta name="date">`. */
function dateFromFilename(relPath, metaDate) {
  const base = relPath.split('/').pop()
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(base)
  if (m) return m[1]
  return metaDate || ''
}

function buildPageRecord(storeDir, relPath) {
  const fullPath = join(storeDir, ...relPath.split('/'))
  const buf = readFileSync(fullPath)
  const text = buf.toString('utf8')
  const root = parseHtml(text)
  const meta = headMeta(root)
  const title = titleText(root)
  const segments = relPath.split('/')
  const folder = segments.length > 1 ? segments[0] : ''
  const date = dateFromFilename(relPath, meta.date)
  const updated = meta.updated || date
  return {
    path: relPath,
    title,
    description: meta.description || '',
    kind: meta.kind || '',
    folder,
    date,
    updated,
    checks: parseChecks(meta.checks),
    sources: meta.sources || '',
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
    legacy: relPath.startsWith('legacy/'),
  }
}

function sortManifest(records) {
  return [...records].sort((a, b) => {
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderIndexHtml(records) {
  const rows = records.map((r) => {
    const checksSummary = Object.entries(r.checks).map(([k, v]) => `${k}=${v}`).join('; ') || '—'
    const href = escapeHtml(r.path)
    const title = escapeHtml(r.title || r.path)
    const desc = escapeHtml(r.description || '')
    return `<tr data-kind="${escapeHtml(r.kind)}" data-folder="${escapeHtml(r.folder)}" data-text="${escapeHtml((r.title + ' ' + r.description).toLowerCase())}">` +
      `<td>${escapeHtml(r.updated)}</td>` +
      `<td>${escapeHtml(r.kind)}</td>` +
      `<td>${escapeHtml(r.folder)}</td>` +
      `<td><a href="${href}">${title}</a>${desc ? ` — ${desc}` : ''}</td>` +
      `<td>${escapeHtml(checksSummary)}</td>` +
      `</tr>`
  }).join('\n')

  const kinds = [...new Set(records.map((r) => r.kind).filter(Boolean))].sort()
  const folders = [...new Set(records.map((r) => r.folder).filter(Boolean))].sort()
  const kindOptions = kinds.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('')
  const folderOptions = folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>writeup</title>
<meta name="description" content="writeup store の一覧">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="./_kit/writeup.css">
</head>
<body>
<div class="wu-page">
<header class="wu-header">
<p class="wu-eyebrow">writeup store</p>
<h1>writeup</h1>
<p class="wu-lede">このstoreにある全ページの一覧。kind・フォルダ・文字列で絞り込める。</p>
</header>
<main>
<section class="wu-section">
<h2>一覧</h2>
<p>
<label>kind <select id="wu-filter-kind"><option value="">すべて</option>${kindOptions}</select></label>
<label>フォルダ <select id="wu-filter-folder"><option value="">すべて</option>${folderOptions}</select></label>
<label>検索 <input id="wu-filter-text" type="text" placeholder="題名・要約"></label>
</p>
<div class="tablewrap">
<table class="wu-table" id="wu-index-table">
<thead><tr><th>更新</th><th>kind</th><th>フォルダ</th><th>題名（要約）</th><th>checks</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</section>
</main>
<footer class="wu-footer">
<dl>
<dt>checks</dt><dd>self-check=skipped（build が生成した一覧、page ではない）</dd>
<dt>sources</dt><dd>&mdash;</dd>
</dl>
</footer>
</div>
<script>
(function () {
  var kindSel = document.getElementById('wu-filter-kind')
  var folderSel = document.getElementById('wu-filter-folder')
  var textInput = document.getElementById('wu-filter-text')
  var rows = Array.prototype.slice.call(document.querySelectorAll('#wu-index-table tbody tr'))
  function apply() {
    var kind = kindSel.value
    var folder = folderSel.value
    var text = textInput.value.trim().toLowerCase()
    rows.forEach(function (row) {
      var okKind = !kind || row.getAttribute('data-kind') === kind
      var okFolder = !folder || row.getAttribute('data-folder') === folder
      var okText = !text || row.getAttribute('data-text').indexOf(text) !== -1
      row.style.display = (okKind && okFolder && okText) ? '' : 'none'
    })
  }
  kindSel.addEventListener('change', apply)
  folderSel.addEventListener('change', apply)
  textInput.addEventListener('input', apply)
})()
</script>
</body>
</html>
`
}

/**
 * Builds the manifest and index for `storeDir`. Always syncs `_kit/writeup.css`
 * and writes `manifest.json` / `index.html` unless `check` is true, in which
 * case nothing is written and `changed` reports whether it would differ.
 */
export function buildStore(storeDir, { check = false } = {}) {
  const kitCss = readFileSync(KIT_CSS_PATH, 'utf8')
  const destCssPath = join(storeDir, '_kit', 'writeup.css')
  const existingCss = existsSync(destCssPath) ? readFileSync(destCssPath, 'utf8') : null
  const cssChanged = existingCss !== kitCss

  const relPaths = existsSync(storeDir) ? listHtmlFiles(storeDir).sort() : []
  const records = sortManifest(relPaths.map((p) => buildPageRecord(storeDir, p)))
  const manifestText = JSON.stringify(records, null, 2) + '\n'
  const manifestPath = join(storeDir, 'manifest.json')
  const existingManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  const manifestChanged = existingManifest !== manifestText

  const indexHtml = renderIndexHtml(records)
  const indexPath = join(storeDir, 'index.html')
  const existingIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
  const indexChanged = existingIndex !== indexHtml

  const changed = cssChanged || manifestChanged || indexChanged

  if (!check) {
    mkdirSync(dirname(destCssPath), { recursive: true })
    if (cssChanged) writeFileSync(destCssPath, kitCss)
    writeFileSync(manifestPath, manifestText)
    writeFileSync(indexPath, indexHtml)
  }

  return {
    records,
    changed,
    cssChanged,
    manifestChanged,
    indexChanged,
    counts: {
      total: records.length,
      legacy: records.filter((r) => r.legacy).length,
    },
  }
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = { store: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') args.store = argv[++i]
    else if (a === '--check') args.check = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const storeDir = resolveStoreDir(args.store)
  const result = buildStore(storeDir, { check: args.check })
  console.log(`build: ${result.counts.total} pages (legacy: ${result.counts.legacy}) in ${storeDir}`)
  if (args.check) {
    if (result.changed) {
      console.log('build --check: manifest.json/index.html/_kit/writeup.css would change')
      return 1
    }
    console.log('build --check: up to date')
    return 0
  }
  console.log('build: wrote manifest.json, index.html, _kit/writeup.css')
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
