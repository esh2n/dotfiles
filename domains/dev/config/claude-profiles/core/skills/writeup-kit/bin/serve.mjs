#!/usr/bin/env node
// serve.mjs — a static file server for writeup stores, bound to 127.0.0.1
// only. Builds each store first (unless --no-build) so `index.html` and
// `manifest.json` are current. Zero-dependency (node:http only).
//
// Safety, ported from grilling's render/lib/serve.mjs: loopback-only bind,
// a Host-header allowlist (defeats DNS rebinding), and path resolution that
// refuses to escape the store root (defeats `..` traversal).
//
// One viewer for every store. With no store flag every registered store is
// served from a single port, each under its own prefix:
//
//   /                      → 302 to the default store's index (`/<name>/`)
//   /<name>/…              → files of the store registered as <name>
//   /<name>/id/<8-hex-id>  → 302 to that page inside <name>
//   /id/<8-hex-id>         → 302 to the page, searched across every store
//
// The index page's store switcher (build.mjs) links `../<name>/index.html`,
// which resolves under these prefixes exactly as it does on `file://`.
// `--store <dir>` / `--store-name <name>` serve one store at the root, the
// old single-store behaviour, and without a registry the legacy single
// store is served the same way. `--list-stores` prints the registry (and
// which store the current directory resolves to) without serving.

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveStoreDir, explainStoreDir, readRegistry, readManifest } from './lib/store.mjs'

/** What to run when no store exists yet. The writeup skill owns
 * init-store.mjs; the kit only points at it. */
const INIT_HINT = 'run `node <writeup skill>/scripts/init-store.mjs --name <name> --description <text> [--default]`'
import { buildStore } from './build.mjs'

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const ID_ROUTE_RE = /^\/id\/([0-9a-f]{8})\/?$/
const PORT_RANGE_START = 40000
const PORT_RANGE_SIZE = 10000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
}

/** Deterministic port derived from an absolute path, so the same store
 * (or the same registry, for the all-stores viewer) always tries the same
 * port across runs. */
export function portForStore(storeDir) {
  const digest = createHash('sha256').update(resolve(storeDir)).digest()
  const n = digest.readUInt32BE(0)
  return PORT_RANGE_START + (n % PORT_RANGE_SIZE)
}

/** Lines for `--list-stores`: one per registered store as
 * `<mark> <name>\t<path>\t<description>\t<flags>` where `mark` is `*` for
 * the store the current directory resolves to (repository marker, else
 * `default`) and ` ` otherwise, `description` is the registry's one-line
 * description (may be empty) and `flags` is `default` or empty; trailing
 * tabs are trimmed. Without a registry the single legacy store is listed
 * as `* legacy\t<path>\t(no registry)`. Pure — exported so the format can
 * be tested without spawning the CLI. */
export function formatStoreList({ cwd = process.cwd() } = {}) {
  const registry = readRegistry()
  if (!registry.stores.length) {
    const picked = explainStoreDir(null, { cwd })
    // `fallback` means nothing is initialized yet: the path is only where a
    // store *would* go. Say so, and name the command that makes one — this
    // is the first writeup command a newcomer runs.
    const hint = picked.via === 'fallback' ? ` — no store yet: ${INIT_HINT}` : ''
    return [`* legacy\t${picked.dir}\t(no registry: ${registry.path})${hint}`]
  }
  let pickedDir = null
  try { pickedDir = resolve(explainStoreDir(null, { cwd }).dir) } catch { pickedDir = null }
  return registry.stores.map((s) => {
    const mark = resolve(s.path) === pickedDir ? '*' : ' '
    const flags = s.isDefault ? 'default' : ''
    return `${mark} ${s.name}\t${s.path}\t${s.description}\t${flags}`.replace(/\t+$/, '')
  })
}

/** Resolves a URL path against `root`, refusing to leave it. Returns null
 * for a path that would escape (`..` traversal, absolute overrides, etc.). */
export function resolveSafePath(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const cleaned = decoded === '/' ? '/index.html' : decoded
  const rootResolved = resolve(root)
  const target = resolve(rootResolved, '.' + cleaned)
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) return null
  return target
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

// --- mounts -----------------------------------------------------------------
//
// A mount is one store at a URL prefix: `{ name, prefix, dir, isDefault }`.
// Single-store mode is one mount with the empty prefix; the all-stores
// viewer is one mount per registered store with prefix `/<name>`.

/** Mounts for `stores` (`[{ name, path, isDefault }]`): prefix `/<name>`
 * each. The default mount is the registry default, else the first store. */
export function mountsFor(stores) {
  const mounts = stores.map((s) => ({ name: s.name, prefix: `/${s.name}`, dir: s.path, isDefault: !!s.isDefault }))
  if (mounts.length && !mounts.some((m) => m.isDefault)) mounts[0].isDefault = true
  return mounts
}

/** Where a request path lands, given `mounts`. Pure. Returns one of:
 *   `{ kind: 'redirect', location }`      — `/` → default index, `/<name>` → `/<name>/`
 *   `{ kind: 'id', id, mount }`           — `/id/<id>` (mount null = every store)
 *                                           or `/<name>/id/<id>`
 *   `{ kind: 'file', mount, rest }`       — a path inside one mount
 *   `{ kind: 'unknown' }`                 — no mount claims the path */
export function routeRequest(pathOnly, mounts) {
  const single = mounts.length === 1 && mounts[0].prefix === ''
  if (!single) {
    if (pathOnly === '/' || pathOnly === '') {
      const dflt = mounts.find((m) => m.isDefault) || mounts[0]
      return dflt ? { kind: 'redirect', location: `${dflt.prefix}/` } : { kind: 'unknown' }
    }
    const idAll = ID_ROUTE_RE.exec(pathOnly)
    if (idAll) return { kind: 'id', id: idAll[1], mount: null }
  }
  for (const mount of mounts) {
    if (mount.prefix === '') {
      const idMatch = ID_ROUTE_RE.exec(pathOnly)
      return idMatch ? { kind: 'id', id: idMatch[1], mount } : { kind: 'file', mount, rest: pathOnly || '/' }
    }
    if (pathOnly === mount.prefix) return { kind: 'redirect', location: `${mount.prefix}/` }
    if (pathOnly.startsWith(mount.prefix + '/')) {
      const rest = pathOnly.slice(mount.prefix.length)
      const idMatch = ID_ROUTE_RE.exec(rest)
      return idMatch ? { kind: 'id', id: idMatch[1], mount } : { kind: 'file', mount, rest }
    }
  }
  return { kind: 'unknown' }
}

// --- 404 handling ------------------------------------------------------------
//
// When a requested path doesn't resolve to a file, look the request's
// basename up against manifest.json: a unique match redirects (302) straight
// to that page (so a stale/half-remembered link still lands somewhere), and
// anything else (zero matches, or more than one) renders a kit-styled 404
// page listing whatever near-matches were found plus a link into the index
// search. Legacy pages (`legacy/**`) are ordinary manifest records, so they
// participate exactly like any other page. A path no mount claims is looked
// up across every mount.

function safeDecode(s) {
  try { return decodeURIComponent(s) } catch { return s }
}

/** The last `/`-separated segment of a (decoded) request path, trailing
 * slashes ignored — `''` for the root path, which is never used to match
 * (an empty basename would trivially "end-with"-match every candidate). */
function basenameOf(pathname) {
  const trimmed = pathname.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

/** Strips a leading `YYYY-MM-DD-` date prefix and a trailing `.html`
 * extension from a basename, e.g. `2026-08-05-example-design.html` →
 * `example-design`. */
function stripDateAndExt(basename) {
  return basename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/i, '')
}

/** Candidate manifest records for a 404: pages whose `path` ends with the
 * requested basename, plus pages whose `slug` or `ref` contains the
 * basename with its date prefix and `.html` extension stripped — all
 * case-insensitive. `''` never matches (see `basenameOf`). */
export function findNotFoundCandidates(manifest, basename) {
  if (!basename) return []
  const baseLower = basename.toLowerCase()
  const stripped = stripDateAndExt(basename).toLowerCase()
  const out = []
  for (const r of manifest) {
    if (!r || typeof r.path !== 'string') continue
    const pathMatch = r.path.toLowerCase().endsWith(baseLower)
    const slugMatch = !!stripped && typeof r.slug === 'string' && r.slug.toLowerCase().includes(stripped)
    const refMatch = !!stripped && typeof r.ref === 'string' && r.ref.toLowerCase().includes(stripped)
    if (pathMatch || slugMatch || refMatch) out.push(r)
  }
  return out
}

/** Candidates across `mounts`, each tagged with the mount it came from. */
function findCandidatesAcross(mounts, basename) {
  const out = []
  for (const mount of mounts) {
    for (const r of findNotFoundCandidates(readManifest(mount.dir), basename)) out.push({ ...r, mount })
  }
  return out
}

/** `/`-prefixed URL for a store-relative page path, each segment
 * percent-encoded individually (so a `Location` header is always valid even
 * if a path segment ever contains characters that need escaping). */
function encodePath(relPath) {
  return '/' + relPath.split('/').map(encodeURIComponent).join('/')
}

/** The URL of a page inside its mount. */
function pageUrl(mount, relPath) {
  return `${mount.prefix}${encodePath(relPath)}`
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** `updated` (`YYYY-MM-DDTHH:MM...`) trimmed to `YYYY-MM-DD HH:MM` for
 * display; passed through unchanged if it doesn't match that shape. */
function shortDatetime(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || '')
  return m ? `${m[1]} ${m[2]}` : (iso || '')
}

/** The kit-styled 404 page: `.wu-header` (back nav to the index of `home`,
 * eyebrow, the requested path as h1, a lede), an optional "近いページ"
 * section listing `candidates` (each linked inside its own mount, named
 * when the viewer has several), and an always-present "探す" section
 * linking into `home`'s index search for `searchQuery`. No inline styles
 * beyond the kit's own stylesheet, no emoji, no external assets — only
 * `home`'s `_kit/writeup.css`. */
function renderNotFoundHtml(requestedPath, candidates, searchQuery, home, { named = false } = {}) {
  const nearHtml = candidates.length
    ? `<section class="wu-section">
<h2>近いページ</h2>
<ul>
${candidates.map((c) => `<li><a href="${escapeHtml(pageUrl(c.mount, c.path))}">${escapeHtml(c.title || c.path)}</a> &middot; ${named ? `${escapeHtml(c.mount.name)} &middot; ` : ''}${escapeHtml(c.ref || '')} &middot; ${escapeHtml(shortDatetime(c.updated))}</li>`).join('\n')}
</ul>
</section>`
    : ''
  const searchHref = `${home.prefix}/?q=${encodeURIComponent(searchQuery)}`
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>見つかりません</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="${escapeHtml(home.prefix)}/_kit/writeup.css">
</head>
<body>
<div class="wu-page">
<header class="wu-header">
<nav class="wu-nav"><a class="wu-back" href="${escapeHtml(home.prefix)}/">一覧</a></nav>
<p class="wu-eyebrow">見つかりません</p>
<h1>${escapeHtml(requestedPath)}</h1>
<p class="wu-lede">このパスにページはありません</p>
</header>
<main>
${nearHtml}
<section class="wu-section">
<h2>探す</h2>
<p><a href="${escapeHtml(searchHref)}">${escapeHtml(searchQuery)} を索引で探す</a></p>
</section>
</main>
</div>
</body>
</html>
`
}

/** Sends the 404 page for `requestedPath` (already decoded), listing
 * `candidates` (possibly empty) as near-matches. */
function sendNotFound(res, requestedPath, candidates, home, opts) {
  const searchQuery = stripDateAndExt(basenameOf(requestedPath))
  const html = renderNotFoundHtml(requestedPath, candidates, searchQuery, home, opts)
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}

/** A request path that didn't resolve to a file: looks up candidates by
 * basename in `searchMounts` and either redirects (302) to a unique match
 * — logging the redirect to stderr — or renders the 404 page with whatever
 * candidates (if any) were found. */
function handleNotFound(res, pathOnly, searchMounts, home) {
  const requestedPath = safeDecode(pathOnly)
  const candidates = findCandidatesAcross(searchMounts, basenameOf(requestedPath))
  if (candidates.length === 1) {
    const location = pageUrl(candidates[0].mount, candidates[0].path)
    process.stderr.write(`serve: 404 redirect ${requestedPath} -> ${location} (matched ${candidates[0].ref})\n`)
    res.writeHead(302, { location })
    return void res.end()
  }
  return sendNotFound(res, requestedPath, candidates, home, { named: searchMounts.length > 1 })
}

/** `/id/<8-hex-id>` → 302 to the page's path, resolved via manifest.json of
 * `searchMounts` (one store, or every store for the viewer-wide route), or
 * the same kit-styled 404 page as any other unresolved path when the id
 * isn't known (or manifest.json doesn't exist yet). Read-only: never
 * rebuilds the manifest itself, so this never mutates the store — a request
 * just reflects whatever the last build wrote. */
function handleIdRoute(res, id, pathOnly, searchMounts, home) {
  for (const mount of searchMounts) {
    const record = readManifest(mount.dir).find((r) => r && r.id === id)
    if (record) {
      res.writeHead(302, { location: pageUrl(mount, record.path) })
      return void res.end()
    }
  }
  return sendNotFound(res, safeDecode(pathOnly), [], home)
}

async function handleRequest(req, res, mounts) {
  if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) return send(res, 403, 'forbidden')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')

  const pathOnly = (req.url || '/').split('?')[0].split('#')[0]
  const home = mounts.find((m) => m.isDefault) || mounts[0]
  const route = routeRequest(pathOnly, mounts)
  if (route.kind === 'redirect') {
    res.writeHead(302, { location: route.location })
    return void res.end()
  }
  if (route.kind === 'id') return handleIdRoute(res, route.id, pathOnly, route.mount ? [route.mount] : mounts, route.mount || home)
  if (route.kind === 'unknown') return handleNotFound(res, pathOnly, mounts, home)

  const { mount, rest } = route
  const target = resolveSafePath(mount.dir, rest)
  if (!target) return send(res, 400, 'bad request')

  let st
  try {
    st = await stat(target)
  } catch {
    return handleNotFound(res, pathOnly, [mount], mount)
  }
  const filePath = st.isDirectory() ? join(target, 'index.html') : target
  let body
  try {
    body = await readFile(filePath)
  } catch {
    return handleNotFound(res, pathOnly, [mount], mount)
  }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  if (req.method === 'HEAD') return void res.end()
  res.end(body)
}

async function listen(mounts, { port, fallbackToFreePort }) {
  const server = createServer((req, res) => {
    handleRequest(req, res, mounts).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`internal error: ${e.message}`)
    })
  })

  const listenOn = (p) => new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(p, '127.0.0.1', () => {
      server.off('error', rej)
      res()
    })
  })

  try {
    await listenOn(port)
  } catch (e) {
    if (!(fallbackToFreePort && e.code === 'EADDRINUSE')) throw e
    await listenOn(0)
  }

  const bound = server.address().port
  return {
    server,
    port: bound,
    url: `http://127.0.0.1:${bound}/`,
    mounts,
    stop: () => new Promise((res) => { server.closeAllConnections?.(); server.close(() => res()) }),
  }
}

/**
 * Starts the single-store server: `storeDir` at the root. Resolves once
 * listening; the server keeps running until `stop()` is called (or the
 * process exits).
 * @returns {Promise<{server: import('node:http').Server, port: number, url: string, stop: () => Promise<void>}>}
 */
export async function startServer(storeDir, { port, fallbackToFreePort = true } = {}) {
  const mounts = [{ name: null, prefix: '', dir: storeDir, isDefault: true }]
  return listen(mounts, { port: port ?? portForStore(storeDir), fallbackToFreePort })
}

/**
 * Starts the all-stores viewer: every store in `stores`
 * (`[{ name, path, isDefault }]`, registry order) under `/<name>/` on one
 * port — by default the port derived from `portKey` (the registry path),
 * so the viewer keeps its address across runs whatever the stores are.
 */
export async function startMultiServer(stores, { port, portKey, fallbackToFreePort = true } = {}) {
  if (!stores.length) throw new Error('startMultiServer: no stores')
  const mounts = mountsFor(stores)
  return listen(mounts, { port: port ?? portForStore(portKey ?? stores[0].path), fallbackToFreePort })
}

// --- CLI --------------------------------------------------------------------

const USAGE = 'usage: node bin/serve.mjs [--store dir | --store-name name] [--port n] [--no-open] [--no-build] [--list-stores]'

export function parseArgs(argv) {
  const args = { store: null, storeName: null, listStores: false, port: null, open: true, build: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') args.store = argv[++i]
    else if (a === '--store-name') args.storeName = argv[++i]
    else if (a === '--list-stores') args.listStores = true
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--no-open') args.open = false
    else if (a === '--no-build') args.build = false
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`unknown argument: ${a}\n${USAGE}`)
  }
  if (args.store && args.storeName) {
    throw new Error(`--store and --store-name are mutually exclusive\n${USAGE}`)
  }
  return args
}

function openInBrowser(url) {
  if (process.platform !== 'darwin') return
  try {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch (e) {
    process.stderr.write(`serve: could not open a browser (${e.message}). Open the URL above manually.\n`)
  }
}

function buildIfWanted(args, storeDir) {
  if (!args.build) return
  const result = buildStore(storeDir)
  process.stderr.write(`serve: built ${result.counts.total} pages (legacy: ${result.counts.legacy}) in ${storeDir}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (args.listStores) {
    for (const line of formatStoreList()) console.log(line)
    return 0
  }

  const registry = readRegistry()
  if (!args.store && !args.storeName && registry.stores.length) {
    for (const s of registry.stores) buildIfWanted(args, s.path)
    const { url, port, mounts } = await startMultiServer(registry.stores, { port: args.port || undefined, portKey: registry.path })
    for (const m of mounts) process.stderr.write(`serve: ${url}${m.name}/ (store ${m.name}: ${m.dir}${m.isDefault ? ', default' : ''})\n`)
    if (args.open) openInBrowser(url)
    return port
  }

  const storeDir = resolveStoreDir(args.store, { name: args.storeName })
  if (!existsSync(join(storeDir, '.writeup.toml'))) {
    process.stderr.write(`serve: ${storeDir} is not an initialized store (no .writeup.toml) — ${INIT_HINT}\n`)
  }
  buildIfWanted(args, storeDir)
  const { url, port } = await startServer(storeDir, { port: args.port || undefined })
  process.stderr.write(`serve: ${url} (store: ${storeDir})\n`)
  if (args.open) openInBrowser(url)
  return port
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`serve: ${e.stack || e}`)
    process.exitCode = 1
  })
}
