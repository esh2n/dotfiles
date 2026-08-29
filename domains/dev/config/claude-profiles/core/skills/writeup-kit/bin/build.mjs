#!/usr/bin/env node
// build.mjs — regenerates `<store>/manifest.json` and `<store>/index.html`
// from every page's `<head>` meta, and syncs the kit's CSS into
// `<store>/_kit/writeup.css` (contract §1, §1-3). Zero-dependency.
//
// The four places build.mjs edits a page's own bytes (page-contract.md §1):
// (1) when a page's `<head>` lacks `<meta name="id">`, build inserts the
// computed id right after `<meta name="date">` (idempotent — only when the
// meta is missing; see `insertIdMeta`/`buildPageRecord`); (2) `.wu-header`'s
// back-to-index nav (`<nav class="wu-nav"><a class="wu-back" href="…">`)
// gets its `href` rewritten to the relative path up to the store root's
// `index.html` for this page's depth (`index.html`, `../index.html`, …),
// inserting the nav as the header's first child when a pre-nav page lacks
// it entirely (idempotent; see `ensureBackNav`/`backNavHref`); (3) the
// status favicon `<link rel="icon">` is upserted from the page's `kind` and
// `checks` meta, right after `<meta name="checks">` when present, else
// right before the stylesheet `<link>` (idempotent — replaced only when its
// href would differ; see `ensureFavicon`/`bin/lib/favicon.mjs`); (4) every
// `<pre class="wu-code">`/`<pre class="wu-diff">` block whose `<code>`
// content has no `wu-tok-` spans yet gets syntax-highlighted in place —
// the existing (HTML-escaped) text is decoded, run through
// `bin/lib/highlight.mjs`'s `highlight(code, lang)`, and written back with
// `data-hl="1"` set on the `<pre>` (idempotent — a block already carrying
// `wu-tok-` spans is left untouched; see `ensureHighlighted`). Nothing else
// about a page is ever rewritten by build — `<meta name="updated">` in
// particular is read, not patched, even when the manifest fills in a
// synthesized time-of-day.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { resolveStoreDir, pageId, isGitRepo, gitLastCommitDatetime, listStores } from './lib/store.mjs'
import { parseHtml, headMeta, titleText, decodeEntities } from './lib/html.mjs'
import { faviconDataUri, statusFromChecks } from './lib/favicon.mjs'
import { highlight } from './lib/highlight.mjs'
import { repairLinks } from './lib/links.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_CSS_PATH = join(HERE, '..', 'kit', 'writeup.css')

const EXCLUDED_DIRS = new Set(['_kit', 'public', '.publish', '.git', 'node_modules'])

function toPosix(p) {
  return p.split(sep).join('/')
}

/** Recursively lists `*.html` files under `dir`, skipping the store's
 * generated/publish-only directories and, at the store root only, any
 * top-level directory whose name starts with `_` (e.g. `_design/` —
 * bootstrap/scratch material that isn't a page folder). `_kit` is already
 * covered by `EXCLUDED_DIRS`; this is a separate, broader rule so a
 * `_scratch/` or `_design/` folder never needs to be added there by hand.
 * Returns paths relative to `dir`. */
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
      if (dir === base && e.name.startsWith('_')) continue
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

/** `slug` = filename without its `YYYY-MM-DD-` date prefix and `.html`
 * extension. `ref` = `<folder>/<slug>` (bare `slug` for a store-root page). */
function slugAndRef(relPath, folder) {
  const base = relPath.split('/').pop()
  const slug = base.replace(/\.html$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
  const ref = folder ? `${folder}/${slug}` : slug
  return { slug, ref }
}

const FULL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** `+09:00`-style local UTC offset for a `Date`. */
function isoOffset(date) {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

function timeOfDayFromMtime(mtime) {
  return `${pad2(mtime.getHours())}:${pad2(mtime.getMinutes())}${isoOffset(mtime)}`
}

/** `HH:MM+TZ` for a page: from `git log`'s commit time when the store is a
 * git repo and the file has history, else the file's mtime. Used only to
 * fill in the *time* half of a date-only `<meta name="updated">` — the
 * *date* half always comes from the meta (or the filename), never from git
 * or mtime, so a page's `updated` date never silently drifts. */
function timeOfDayString(storeDir, relPath, mtime) {
  if (isGitRepo(storeDir)) {
    const commitIso = gitLastCommitDatetime(storeDir, relPath)
    if (commitIso) {
      const m = /T(\d{2}:\d{2}):\d{2}([+-]\d{2}:\d{2}|Z)$/.exec(commitIso)
      if (m) return `${m[1]}${m[2]}`
    }
  }
  return timeOfDayFromMtime(mtime)
}

/** manifest `updated`: the full ISO datetime when `<meta name="updated">`
 * already carries one; otherwise the date (from the meta, or the filename
 * date as a last resort) with a synthesized time-of-day appended (contract
 * §3). The page's own `<meta name="updated">` is never rewritten. */
function computeUpdated(storeDir, relPath, mtime, meta, date) {
  const raw = meta.updated || ''
  if (FULL_DATETIME_RE.test(raw)) return raw
  const dateOnly = DATE_ONLY_RE.test(raw) ? raw : date
  if (!dateOnly) return ''
  return `${dateOnly}T${timeOfDayString(storeDir, relPath, mtime)}`
}

/** Inserts `<meta name="id" content="…">` right after `<meta name="date">`
 * (or before `</head>` if that tag is somehow absent). The only place
 * build.mjs edits a page's bytes — see the module docstring. */
function insertIdMeta(text, id) {
  const metaTag = `<meta name="id" content="${id}">`
  const dateRe = /<meta\s+name="date"[^>]*>\n?/
  const m = dateRe.exec(text)
  if (m) {
    const at = m.index + m[0].length
    return text.slice(0, at) + metaTag + '\n' + text.slice(at)
  }
  const headClose = text.indexOf('</head>')
  if (headClose === -1) return metaTag + '\n' + text
  return text.slice(0, headClose) + metaTag + '\n' + text.slice(headClose)
}

/** The relative path from a page at `relPath` (store-relative, `/`-separated)
 * up to the store root's `index.html`: `index.html` for a store-root page
 * (depth 0), `../index.html` for one folder down (depth 1), `../../index.html`
 * for two, and so on. */
function backNavHref(relPath) {
  const depth = relPath.split('/').length - 1
  return depth === 0 ? 'index.html' : '../'.repeat(depth) + 'index.html'
}

const HEADER_OPEN_RE = /<header\b[^>]*class="[^"]*\bwu-header\b[^"]*"[^>]*>/
const LEADING_NAV_RE = /^\s*<nav\s+class="wu-nav"[^>]*>[\s\S]*?<\/nav>/
const BACK_HREF_RE = /(<a\s+class="wu-back"[^>]*\shref=")([^"]*)(")/

/**
 * Ensures `.wu-header`'s back-to-index nav has the correct href for this
 * page's depth (see `backNavHref`), inserting `<nav class="wu-nav"><a
 * class="wu-back" href="…">一覧</a></nav>` as the header's first child when
 * the page predates it. The other place build.mjs edits a page's own bytes
 * — see the module docstring. A page without `.wu-header` at all (e.g. a
 * frozen legacy/** page) is left untouched. Idempotent: a no-op once the
 * nav is present with the correct href.
 */
function ensureBackNav(text, relPath) {
  const headerMatch = HEADER_OPEN_RE.exec(text)
  if (!headerMatch) return text
  const afterHeader = headerMatch.index + headerMatch[0].length
  const desiredHref = backNavHref(relPath)
  const tail = text.slice(afterHeader)
  const navMatch = LEADING_NAV_RE.exec(tail)
  if (!navMatch) {
    const navHtml = `<nav class="wu-nav"><a class="wu-back" href="${desiredHref}">一覧</a></nav>\n`
    return text.slice(0, afterHeader) + navHtml + text.slice(afterHeader)
  }
  const navBlock = navMatch[0]
  const hrefMatch = BACK_HREF_RE.exec(navBlock)
  if (!hrefMatch || hrefMatch[2] === desiredHref) return text
  const navStart = afterHeader
  const patchedNav = navBlock.slice(0, hrefMatch.index) + hrefMatch[1] + desiredHref + hrefMatch[3] + navBlock.slice(hrefMatch.index + hrefMatch[0].length)
  return text.slice(0, navStart) + patchedNav + text.slice(navStart + navBlock.length)
}

const FAVICON_LINK_RE = /<link\s+rel="icon"[^>]*>/
const CHECKS_META_RE = /<meta\s+name="checks"[^>]*>\n?/
const STYLESHEET_LINK_RE = /<link\s+rel="stylesheet"[^>]*>/

/**
 * Upserts `<link rel="icon" href="…">` — the status favicon for this page's
 * `kind`/`checks` (page-contract.md §1, `bin/lib/favicon.mjs`). Replaces an
 * existing icon link only when its href differs (idempotent); inserted
 * right after `<meta name="checks">` when present, else right before the
 * first stylesheet `<link>` (falling back to just before `</head>` if
 * neither is found). The third and last place build.mjs edits a page's own
 * bytes — see the module docstring.
 */
function ensureFavicon(text, dataUri) {
  const tag = `<link rel="icon" href="${dataUri}">`
  const existing = FAVICON_LINK_RE.exec(text)
  if (existing) {
    if (existing[0] === tag) return text
    return text.slice(0, existing.index) + tag + text.slice(existing.index + existing[0].length)
  }
  const checksMatch = CHECKS_META_RE.exec(text)
  if (checksMatch) {
    const at = checksMatch.index + checksMatch[0].length
    return text.slice(0, at) + tag + '\n' + text.slice(at)
  }
  const styleMatch = STYLESHEET_LINK_RE.exec(text)
  if (styleMatch) {
    return text.slice(0, styleMatch.index) + tag + '\n' + text.slice(styleMatch.index)
  }
  const headClose = text.indexOf('</head>')
  if (headClose === -1) return tag + '\n' + text
  return text.slice(0, headClose) + tag + '\n' + text.slice(headClose)
}

const PRE_BLOCK_RE = /<pre\b([^>]*)>([\s\S]*?)<\/pre>/g
const CODE_WRAP_RE = /^(\s*)<code\b([^>]*)>([\s\S]*?)<\/code>(\s*)$/

function attrValue(attrsStr, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrsStr)
  return m ? m[1] : null
}

/**
 * Syntax-highlights every `.wu-code`/`.wu-diff` block whose `<code>` content
 * has no `wu-tok-` spans yet (page-contract.md §5, `bin/lib/highlight.mjs`).
 * Decodes the block's existing (HTML-escaped) text, re-renders it through
 * `highlight(code, lang)`, and marks the `<pre>` with `data-hl="1"`. The
 * fourth and last place build.mjs edits a page's own bytes — see the module
 * docstring. Idempotent: a block already containing `wu-tok-` spans (or one
 * whose shape this regex doesn't recognize) is returned unchanged, never
 * throws.
 */
function ensureHighlighted(text) {
  return text.replace(PRE_BLOCK_RE, (whole, attrsStr, innerHtml) => {
    const classes = (attrValue(attrsStr, 'class') || '').split(/\s+/).filter(Boolean)
    const isDiff = classes.includes('wu-diff')
    if (!isDiff && !classes.includes('wu-code')) return whole
    if (innerHtml.includes('wu-tok-')) return whole
    const codeMatch = CODE_WRAP_RE.exec(innerHtml)
    if (!codeMatch) return whole
    const [, ws1, codeAttrs, codeInner, ws2] = codeMatch
    const lang = isDiff ? 'diff' : (attrValue(attrsStr, 'data-lang') || '')
    const decoded = decodeEntities(codeInner)
    const highlighted = highlight(decoded, lang)
    const newAttrsStr = attrValue(attrsStr, 'data-hl') !== null ? attrsStr : `${attrsStr} data-hl="1"`
    return `<pre${newAttrsStr}>${ws1}<code${codeAttrs}>${highlighted}</code>${ws2}</pre>`
  })
}

/**
 * Builds one manifest record for `relPath`. When the page's `<head>` lacks
 * `<meta name="id">` and `check` is false, inserts the computed id into the
 * file on disk (idempotent: only when missing) — see `insertIdMeta`. Also
 * ensures `.wu-header`'s back-to-index nav href is correct — see
 * `ensureBackNav` — that the status favicon link reflects this page's
 * current `kind`/`checks` — see `ensureFavicon` — and that every
 * `.wu-code`/`.wu-diff` block is syntax-highlighted — see
 * `ensureHighlighted`. The mtime used for `updated`'s time-of-day fallback
 * is read *before* any edit, so housekeeping itself never bumps a page's
 * `updated`.
 */
function buildPageRecord(storeDir, relPath, { check, linkResolver } = {}) {
  const fullPath = join(storeDir, ...relPath.split('/'))
  const originalMtime = statSync(fullPath).mtime
  let buf = readFileSync(fullPath)
  let text = buf.toString('utf8')
  let root = parseHtml(text)
  let meta = headMeta(root)
  const id = pageId(relPath)
  let metaInserted = false
  let navFixed = false
  let faviconFixed = false
  let highlightFixed = false
  let linksFixed = false
  let missingLinks = 0
  if (meta.id === undefined) {
    metaInserted = true
    if (!check) text = insertIdMeta(text, id)
  }
  const navFixedText = ensureBackNav(text, relPath)
  if (navFixedText !== text) {
    navFixed = true
    if (!check) text = navFixedText
  }
  const checksParsed = parseChecks(meta.checks)
  const desiredIcon = faviconDataUri({ kind: meta.kind, status: statusFromChecks(checksParsed) })
  const faviconFixedText = ensureFavicon(text, desiredIcon)
  if (faviconFixedText !== text) {
    faviconFixed = true
    if (!check) text = faviconFixedText
  }
  const highlightedText = ensureHighlighted(text)
  if (highlightedText !== text) {
    highlightFixed = true
    if (!check) text = highlightedText
  }
  if (linkResolver) {
    // (5) internal links: pages migrated from the old tool wrote hrefs
    // relative to the store root; rewrite them page-relative, follow
    // moved (legacy) targets, and mark the rest with data-wu-missing.
    const repaired = repairLinks(text, {
      pagePath: relPath,
      exists: linkResolver.exists,
      resolveLegacy: linkResolver.resolveLegacy,
    })
    missingLinks = repaired.missing
    if (repaired.html !== text) {
      linksFixed = true
      if (!check) text = repaired.html
    }
  }
  if ((metaInserted || navFixed || faviconFixed || highlightFixed || linksFixed) && !check) {
    writeFileSync(fullPath, text)
    buf = Buffer.from(text, 'utf8')
    root = parseHtml(text)
    meta = headMeta(root)
  }
  const title = titleText(root)
  const segments = relPath.split('/')
  const folder = segments.length > 1 ? segments[0] : ''
  // Full directory path (everything before the filename) — the "topic" a
  // page belongs to in a migrated store, where one folder holds the
  // successive documents of one subject (draft -> review -> decision).
  // Equal to `folder` for a one-segment folder, '' for a store-root page.
  const folderPath = segments.length > 1 ? segments.slice(0, -1).join('/') : ''
  const date = dateFromFilename(relPath, meta.date)
  const updated = computeUpdated(storeDir, relPath, originalMtime, meta, date)
  const { slug, ref } = slugAndRef(relPath, folder)
  const record = {
    path: relPath,
    id,
    slug,
    ref,
    title,
    description: meta.description || '',
    kind: meta.kind || '',
    folder,
    folderPath,
    date,
    updated,
    checks: parseChecks(meta.checks),
    sources: meta.sources || '',
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
    legacy: relPath.startsWith('legacy/'),
    missingLinks,
  }
  return { record, metaInserted, navFixed, faviconFixed, highlightFixed, linksFixed }
}

/**
 * Link resolver for `repairLinks`: `exists` answers from the store's page
 * list (plus directories on disk); `resolveLegacy` follows a target to its
 * `legacy/` copy when the migration froze it there, then falls back to a
 * page whose file name is unique in the store (the old tool addressed
 * pages by name, and several were later moved into topic folders).
 */
function makeLinkResolver(storeDir, relPaths) {
  const pages = new Set(relPaths)
  const byName = new Map()
  for (const p of relPaths) {
    const name = p.slice(p.lastIndexOf('/') + 1)
    byName.set(name, byName.has(name) ? null : p)
  }
  const exists = (rel) => rel === 'index.html' || pages.has(rel) || existsSync(join(storeDir, ...rel.split('/')))
  const resolveLegacy = (rel) => {
    const html = rel.replace(/\.md$/, '.html')
    if (!rel.startsWith('legacy/') && pages.has('legacy/' + html)) return 'legacy/' + html
    const name = html.slice(html.lastIndexOf('/') + 1)
    const unique = byName.get(name)
    return unique || null
  }
  return { exists, resolveLegacy }
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

/** NFKC-normalized, lowercased form used for both the precomputed
 * per-row search blob and the runtime query (contract: substring match,
 * case-insensitive, NFKC-normalized). */
function normalizeForSearch(s) {
  return String(s).normalize('NFKC').toLowerCase()
}

function displayDatetime(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || '')
  return m ? `${m[1]} ${m[2]}` : (iso || '')
}

/** `kind`, falling back to `legacy` (for legacy/** pages) or `未分類`. Used
 * both for the top filter chips and for a row/group's own kind label. */
function kindKeyOf(r) {
  return r.kind || (r.legacy ? 'legacy' : '未分類')
}

/** One page row — shared between the flat list and a group's page list. */
function renderRow(r) {
  const kindKey = kindKeyOf(r)
  const checksSummary = Object.entries(r.checks).map(([k, v]) => `${k}=${v}`).join('; ') || '—'
  const hasFail = Object.values(r.checks).includes('fail')
  const href = escapeHtml(r.path)
  const title = escapeHtml(r.title || r.path)
  const desc = escapeHtml(r.description || '')
  const searchBlob = normalizeForSearch([r.title, r.description, r.ref, r.id, r.folder].join(' '))
  return `<li class="wu-idx-row" data-kind="${escapeHtml(kindKey)}" data-folder="${escapeHtml(r.folder)}" data-date="${escapeHtml(r.date)}" data-updated="${escapeHtml(r.updated)}" data-title="${escapeHtml(r.title || r.path)}" data-s="${escapeHtml(searchBlob)}">` +
    `<div class="wu-idx-row1"><span class="wu-idx-tag">${escapeHtml(kindKey)}</span><a class="wu-idx-title" href="${href}">${title}</a><span class="wu-idx-id">${escapeHtml(r.id)}</span></div>` +
    `<p class="wu-idx-desc">${desc}</p>` +
    `<p class="wu-idx-line3"><span>${escapeHtml(r.ref)}</span> &middot; <span class="wu-idx-updated">${escapeHtml(displayDatetime(r.updated))}</span> &middot; <span class="${hasFail ? 'wu-idx-warn' : 'wu-idx-muted'}">${escapeHtml(checksSummary)}</span></p>` +
    `</li>`
}

/** Folder-path label for a group header: the full path with its last
 * segment (the topic itself, e.g. "a-network" in "engineering/backend/
 * a-network") bolded, and any parent segments kept plain as breadcrumb. */
function groupPathHtml(folderPath) {
  if (!folderPath) return '<b>(root)</b>'
  const parts = folderPath.split('/')
  const last = parts.pop()
  const prefix = parts.join('/')
  return prefix ? `${escapeHtml(prefix)}/<b>${escapeHtml(last)}</b>` : `<b>${escapeHtml(last)}</b>`
}

/** Groups `records` (already sorted `updated` desc) by `folderPath`. Because
 * the input is globally sorted by `updated` desc, taking groups in the order
 * their first member is seen yields groups ordered by their own latest
 * `updated` desc too — no separate group-level sort needed. */
function buildGroups(records) {
  const order = []
  const byFolder = new Map()
  for (const r of records) {
    let g = byFolder.get(r.folderPath)
    if (!g) {
      g = { folderPath: r.folderPath, pages: [] }
      byFolder.set(r.folderPath, g)
      order.push(g)
    }
    g.pages.push(r)
  }
  return order
}

function renderGroup(g) {
  const kinds = [...new Set(g.pages.map(kindKeyOf))].sort()
  const kindChipsHtml = kinds.map((k) => `<span class="wu-idx-gk">${escapeHtml(k)}</span>`).join('')
  const latest = g.pages[0].updated
  return `<details class="wu-idx-group" data-folder="${escapeHtml(g.folderPath)}">` +
    `<summary class="wu-idx-ghead">` +
    `<span class="wu-idx-gpath">${groupPathHtml(g.folderPath)}</span>` +
    `<span class="wu-idx-gcount" data-total="${g.pages.length}">${g.pages.length} 件</span>` +
    `<span class="wu-idx-gupdated">${escapeHtml(displayDatetime(latest))}</span>` +
    `<span class="wu-idx-gkinds">${kindChipsHtml}</span>` +
    `</summary>` +
    `<ul class="wu-idx-list">${g.pages.map(renderRow).join('\n')}</ul>` +
    `</details>`
}

/** The registry name of `storeDir` (work / learn …), or '' when the store is
 * not registered — the index shows it so two open stores are told apart. */
function storeNameFor(storeDir) {
  let stores = []
  try { stores = listStores() } catch { return '' }
  const here = resolve(storeDir)
  const hit = stores.find((st) => resolve(st.path) === here)
  return hit ? hit.name : ''
}

function renderIndexHtml(records, { storeName = '' } = {}) {
  const kindCounts = new Map()
  const folderCounts = new Map()
  for (const r of records) {
    const k = kindKeyOf(r)
    kindCounts.set(k, (kindCounts.get(k) || 0) + 1)
    if (r.folder) folderCounts.set(r.folder, (folderCounts.get(r.folder) || 0) + 1)
  }
  const kinds = [...kindCounts.keys()].sort()
  const folders = [...folderCounts.keys()].sort()

  const chip = (group, value, count) =>
    `<li><button type="button" class="wu-fchip" data-group="${group}" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(value)} (${count})</button></li>`
  const kindChips = kinds.map((k) => chip('kind', k, kindCounts.get(k))).join('')
  const folderChips = folders.map((f) => chip('folder', f, folderCounts.get(f))).join('')

  const groups = buildGroups(records)
  const groupedHtml = groups.map(renderGroup).join('\n')
  const rows = records.map(renderRow).join('\n')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${storeName ? `writeup · ${escapeHtml(storeName)}` : 'writeup'}</title>
<meta name="description" content="writeup store の検索">
<meta name="robots" content="noindex">
<link rel="icon" href="${faviconDataUri({ kind: 'index' })}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="./_kit/writeup.css">
<style data-index>
.wu-idx-search{width:100%;box-sizing:border-box;padding:var(--wu-sp-3) var(--wu-sp-4);font-size:var(--wu-fs-4);font-family:inherit;color:var(--wu-ink);background:var(--wu-surface);border:var(--wu-bw-2) solid var(--wu-rule);border-radius:var(--wu-radius-2);}
.wu-idx-filters{display:flex;flex-wrap:wrap;gap:var(--wu-sp-2);margin:var(--wu-sp-4) 0;padding:0;list-style:none;}
.wu-idx-sep{width:1px;align-self:stretch;background:var(--wu-rule);margin:0 var(--wu-sp-1);}
.wu-fchip{cursor:pointer;font:inherit;padding:var(--wu-sp-1) var(--wu-sp-3);border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-3);background:var(--wu-surface);color:var(--wu-ink-2);font-family:var(--wu-font-heading);font-weight:700;font-size:var(--wu-fs-1);line-height:1.6;white-space:nowrap;}
.wu-fchip.is-active{background:var(--wu-ink);color:var(--wu-surface);border-color:var(--wu-ink);}
.wu-idx-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--wu-sp-4);margin:var(--wu-sp-3) 0;flex-wrap:wrap;}
.wu-idx-count{margin:0;color:var(--wu-ink-3);font-size:var(--wu-fs-1);font-variant-numeric:tabular-nums;}
.wu-idx-sort{font:inherit;padding:var(--wu-sp-1) var(--wu-sp-2);border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-2);background:var(--wu-surface);color:var(--wu-ink);}
.wu-idx-list{list-style:none;margin:0;padding:0;}
.wu-idx-row{padding:var(--wu-sp-3) 0;border-bottom:var(--wu-bw-1) solid var(--wu-rule-soft);}
.wu-idx-row1{display:flex;align-items:baseline;gap:var(--wu-sp-2);flex-wrap:wrap;}
.wu-idx-tag{font-family:var(--wu-font-heading);font-weight:700;font-size:var(--wu-fs-1);color:var(--wu-ink-2);background:var(--wu-rule-soft);border-radius:var(--wu-radius-1);padding:0 var(--wu-sp-2);}
.wu-idx-title{font-weight:700;color:var(--wu-link);}
.wu-idx-id{font-family:var(--wu-font-mono);font-size:var(--wu-fs-1);color:var(--wu-ink-3);}
.wu-idx-desc{margin:var(--wu-sp-1) 0;color:var(--wu-ink-2);}
.wu-idx-line3{margin:0;font-family:var(--wu-font-mono);font-size:var(--wu-fs-1);color:var(--wu-ink-3);font-variant-numeric:tabular-nums;}
.wu-idx-muted{color:var(--wu-ink-3);}
.wu-idx-warn{color:var(--wu-ink);font-weight:700;border-left:var(--wu-bw-3) solid var(--wu-ink);padding-left:var(--wu-sp-2);}
.wu-idx-viewbar{display:flex;align-items:center;gap:var(--wu-sp-2);flex-wrap:wrap;}
.wu-vbtn{cursor:pointer;font:inherit;padding:var(--wu-sp-1) var(--wu-sp-3);border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-3);background:var(--wu-surface);color:var(--wu-ink-2);font-family:var(--wu-font-heading);font-weight:700;font-size:var(--wu-fs-1);line-height:1.6;white-space:nowrap;}
.wu-vbtn[aria-pressed="true"]{background:var(--wu-ink);color:var(--wu-surface);border-color:var(--wu-ink);}
.wu-idx-groups{margin:0;padding:0;}
.wu-idx-group{padding:var(--wu-sp-2) 0;border-bottom:var(--wu-bw-1) solid var(--wu-rule-soft);}
.wu-idx-group[hidden]{display:none;}
.wu-idx-ghead{cursor:pointer;display:flex;align-items:baseline;gap:var(--wu-sp-3);flex-wrap:wrap;padding:var(--wu-sp-2);margin:0;border-radius:var(--wu-radius-2);list-style:none;}
.wu-idx-ghead::-webkit-details-marker{display:none;}
.wu-idx-ghead::before{content:"";flex:none;width:0;height:0;border-style:solid;border-width:5px 0 5px 7px;border-color:transparent transparent transparent var(--wu-ink-3);transition:transform .15s ease;}
.wu-idx-group[open]>.wu-idx-ghead::before{transform:rotate(90deg);}
.wu-idx-ghead:hover{background:var(--wu-rule-soft);}
.wu-idx-ghead:focus-visible{outline:var(--wu-bw-2) solid var(--wu-ink);outline-offset:2px;}
.wu-idx-gpath{font-family:var(--wu-font-mono);font-weight:500;color:var(--wu-ink);}
.wu-idx-gpath b{font-weight:700;}
.wu-idx-gcount,.wu-idx-gupdated{font-family:var(--wu-font-mono);color:var(--wu-ink-3);font-variant-numeric:tabular-nums;}
.wu-idx-gkinds{display:flex;gap:var(--wu-sp-1);flex-wrap:wrap;}
.wu-idx-gk{font-family:var(--wu-font-heading);font-weight:700;font-size:var(--wu-fs-1);color:var(--wu-ink-2);background:var(--wu-rule-soft);border-radius:var(--wu-radius-1);padding:0 var(--wu-sp-2);}
.wu-idx-group>.wu-idx-list{margin-top:var(--wu-sp-2);padding-left:var(--wu-sp-4);}
</style>
</head>
<body>
<div class="wu-page">
<header class="wu-header">
<p class="wu-eyebrow">writeup store${storeName ? ` · ${escapeHtml(storeName)}` : ''}</p>
<h1>${storeName ? escapeHtml(storeName) : 'writeup'}</h1>
<p class="wu-lede">題名・要約・slug・id で検索して開く。</p>
</header>
<main>
<section class="wu-section">
<input id="wu-q" class="wu-idx-search" type="search" autofocus placeholder="題名・要約・slug・id">
<ul class="wu-idx-filters" id="wu-chips">${kindChips}<li class="wu-idx-sep" aria-hidden="true"></li>${folderChips}</ul>
<div class="wu-idx-bar">
<p id="wu-count" class="wu-idx-count">${records.length} 件中 ${records.length} 件 &middot; ${groups.length} グループ</p>
<div class="wu-idx-viewbar">
<button type="button" id="wu-view-grouped" class="wu-vbtn" aria-pressed="true">まとまり</button>
<button type="button" id="wu-view-flat" class="wu-vbtn" aria-pressed="false">フラット</button>
<button type="button" id="wu-expand-all" class="wu-vbtn">すべて展開</button>
<button type="button" id="wu-collapse-all" class="wu-vbtn">すべて折りたたむ</button>
<select id="wu-sort" class="wu-idx-sort">
<option value="updated">更新が新しい順</option>
<option value="created">作成が新しい順</option>
<option value="title">題名</option>
</select>
</div>
</div>
<div class="wu-idx-groups" id="wu-groups">
${groupedHtml}
</div>
<ul class="wu-idx-list" id="wu-rows" hidden>
${rows}
</ul>
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
  var flatRows = Array.prototype.slice.call(document.querySelectorAll('#wu-rows > .wu-idx-row'))
  var total = flatRows.length
  var searchEl = document.getElementById('wu-q')
  var countEl = document.getElementById('wu-count')
  var sortEl = document.getElementById('wu-sort')
  var listEl = document.getElementById('wu-rows')
  var groupsEl = document.getElementById('wu-groups')
  var groupEls = Array.prototype.slice.call(document.querySelectorAll('.wu-idx-group'))
  var chipEls = Array.prototype.slice.call(document.querySelectorAll('#wu-chips .wu-fchip'))
  var viewGroupedBtn = document.getElementById('wu-view-grouped')
  var viewFlatBtn = document.getElementById('wu-view-flat')
  var expandAllBtn = document.getElementById('wu-expand-all')
  var collapseAllBtn = document.getElementById('wu-collapse-all')
  var selKind = new Set()
  var selFolder = new Set()
  var view = 'grouped'
  var openSet = new Set()
  var syncingOpen = false

  function norm(s) { return (s || '').normalize('NFKC').toLowerCase() }
  function loadJson(key) { try { return JSON.parse(localStorage.getItem(key)) } catch (e) { return null } }
  function saveJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch (e) {} }
  function saveOpenSet() { saveJson('writeup.index.open', Array.from(openSet)) }
  function setGroupOpen(g, isOpen) { syncingOpen = true; g.open = isOpen; syncingOpen = false }

  function readState() {
    var p = new URLSearchParams(location.search)
    searchEl.value = p.get('q') || ''
    ;(p.get('kind') || '').split(',').filter(Boolean).forEach(function (k) { selKind.add(k) })
    ;(p.get('folder') || '').split(',').filter(Boolean).forEach(function (f) { selFolder.add(f) })
    var v = p.get('view')
    if (v === 'flat' || v === 'grouped') view = v
    else { try { view = localStorage.getItem('writeup.index.view') || 'grouped' } catch (e) {} }
    var storedOpen = loadJson('writeup.index.open')
    if (storedOpen) storedOpen.forEach(function (f) { openSet.add(f) })
    else { try { localStorage.removeItem('writeup.index.collapsed') } catch (e) {} }
  }

  function writeUrl() {
    var p = new URLSearchParams()
    if (searchEl.value) p.set('q', searchEl.value)
    if (selKind.size) p.set('kind', Array.from(selKind).join(','))
    if (selFolder.size) p.set('folder', Array.from(selFolder).join(','))
    if (view === 'flat') p.set('view', 'flat')
    var qs = p.toString()
    history.replaceState(null, '', qs ? '?' + qs : location.pathname)
  }

  function updateChips() {
    chipEls.forEach(function (c) {
      var set = c.dataset.group === 'kind' ? selKind : selFolder
      var active = set.has(c.dataset.value)
      c.classList.toggle('is-active', active)
      c.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  function applyView() {
    var grouped = view === 'grouped'
    groupsEl.hidden = !grouped
    listEl.hidden = grouped
    viewGroupedBtn.setAttribute('aria-pressed', grouped ? 'true' : 'false')
    viewFlatBtn.setAttribute('aria-pressed', grouped ? 'false' : 'true')
    try { localStorage.setItem('writeup.index.view', view) } catch (e) {}
  }

  function rowMatches(row, q) {
    var okKind = selKind.size === 0 || selKind.has(row.dataset.kind)
    var okFolder = selFolder.size === 0 || selFolder.has(row.dataset.folder)
    var okText = !q || row.dataset.s.indexOf(q) !== -1
    return okKind && okFolder && okText
  }

  function apply() {
    var q = norm(searchEl.value.trim())
    var filterActive = !!q || selKind.size > 0 || selFolder.size > 0
    var shown = 0
    flatRows.forEach(function (row) {
      var visible = rowMatches(row, q)
      row.style.display = visible ? '' : 'none'
      if (visible) shown++
    })
    var groupsShown = 0
    groupEls.forEach(function (g) {
      var gRows = Array.prototype.slice.call(g.querySelectorAll('.wu-idx-row'))
      var gShown = 0
      gRows.forEach(function (row) {
        var visible = rowMatches(row, q)
        row.style.display = visible ? '' : 'none'
        if (visible) gShown++
      })
      g.hidden = gShown === 0
      if (gShown) groupsShown++
      var head = g.querySelector('.wu-idx-gcount')
      if (head) head.textContent = (gShown === gRows.length ? gRows.length : gShown + '/' + gRows.length) + ' 件'
      setGroupOpen(g, filterActive ? gShown > 0 : openSet.has(g.dataset.folder))
    })
    countEl.textContent = total + ' 件中 ' + shown + ' 件 · ' + groupsShown + ' グループ'
    writeUrl()
  }

  function sortRows() {
    var mode = sortEl.value
    flatRows = flatRows.slice().sort(function (a, b) {
      if (mode === 'title') return a.dataset.title.localeCompare(b.dataset.title, 'ja')
      var key = mode === 'created' ? 'date' : 'updated'
      return a.dataset[key] < b.dataset[key] ? 1 : a.dataset[key] > b.dataset[key] ? -1 : 0
    })
    flatRows.forEach(function (row) { listEl.appendChild(row) })
  }

  chipEls.forEach(function (c) {
    c.addEventListener('click', function () {
      var set = c.dataset.group === 'kind' ? selKind : selFolder
      if (set.has(c.dataset.value)) set.delete(c.dataset.value); else set.add(c.dataset.value)
      updateChips()
      apply()
    })
  })
  searchEl.addEventListener('input', apply)
  sortEl.addEventListener('change', function () { sortRows(); apply() })
  viewGroupedBtn.addEventListener('click', function () { view = 'grouped'; applyView(); apply() })
  viewFlatBtn.addEventListener('click', function () { view = 'flat'; applyView(); apply() })
  expandAllBtn.addEventListener('click', function () {
    groupEls.forEach(function (g) { openSet.add(g.dataset.folder) })
    saveOpenSet()
    apply()
  })
  collapseAllBtn.addEventListener('click', function () {
    openSet.clear()
    saveOpenSet()
    apply()
  })
  groupEls.forEach(function (g) {
    g.addEventListener('toggle', function () {
      if (syncingOpen) return
      if (g.open) openSet.add(g.dataset.folder); else openSet.delete(g.dataset.folder)
      saveOpenSet()
    })
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchEl) {
      e.preventDefault()
      searchEl.focus()
    } else if (e.key === 'Escape' && document.activeElement === searchEl) {
      searchEl.value = ''
      apply()
    }
  })

  readState()
  updateChips()
  applyView()
  sortRows()
  apply()
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
  const linkResolver = makeLinkResolver(storeDir, relPaths)
  const built = relPaths.map((p) => buildPageRecord(storeDir, p, { check, linkResolver }))
  const pagesChanged = built.some((b) => b.metaInserted || b.navFixed || b.faviconFixed || b.highlightFixed || b.linksFixed)
  const records = sortManifest(built.map((b) => b.record))
  const manifestText = JSON.stringify(records, null, 2) + '\n'
  const manifestPath = join(storeDir, 'manifest.json')
  const existingManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  const manifestChanged = existingManifest !== manifestText

  const indexHtml = renderIndexHtml(records, { storeName: storeNameFor(storeDir) })
  const indexPath = join(storeDir, 'index.html')
  const existingIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
  const indexChanged = existingIndex !== indexHtml

  const changed = cssChanged || manifestChanged || indexChanged || pagesChanged

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
    pagesChanged,
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
