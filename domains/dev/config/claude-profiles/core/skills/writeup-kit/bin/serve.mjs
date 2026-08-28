#!/usr/bin/env node
// serve.mjs — a static file server for a writeup store, bound to 127.0.0.1
// only. Builds the store first (unless --no-build) so `index.html` and
// `manifest.json` are current. Zero-dependency (node:http only).
//
// Safety, ported from grilling's render/lib/serve.mjs: loopback-only bind,
// a Host-header allowlist (defeats DNS rebinding), and path resolution that
// refuses to escape the store root (defeats `..` traversal).
//
// `/id/<8-hex-id>` redirects (302) to a page's path via manifest.json, so a
// user (or another skill) can say "id 9f3a1c2d を開いて" without knowing the
// page's folder/slug.
//
// Stores: `--store <dir>` / `--store-name <name>` pick one store (see
// lib/store.mjs for the resolution order); `--all` starts one listener per
// registered store on consecutive ports and prints one URL per store;
// `--list-stores` prints the registry (and which store the current
// directory resolves to) without serving anything.

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveStoreDir, explainStoreDir, listStores, readRegistry, readManifest } from './lib/store.mjs'
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

/** Deterministic port derived from the store's absolute path, so the same
 * store always tries the same port across runs. */
export function portForStore(storeDir) {
  const digest = createHash('sha256').update(resolve(storeDir)).digest()
  const n = digest.readUInt32BE(0)
  return PORT_RANGE_START + (n % PORT_RANGE_SIZE)
}

/** Ports for serving `stores` together: `basePort` (default: the port
 * derived from the first store's path) and then consecutive ports, kept
 * inside the deterministic range. Pure — nothing is bound here. */
export function planAllPorts(stores, basePort) {
  if (!stores.length) return []
  const base = basePort ?? portForStore(stores[0].path)
  return stores.map((s, i) => ({
    name: s.name,
    path: s.path,
    port: PORT_RANGE_START + ((base - PORT_RANGE_START + i) % PORT_RANGE_SIZE),
  }))
}

/** Lines for `--list-stores`: one per registered store as
 * `<mark> <name>\t<path>\t<flags>` where `mark` is `*` for the store the
 * current directory resolves to and ` ` otherwise, and `flags` lists
 * `default` and any `cwd_prefixes`. Without a registry the single legacy
 * store is listed as `* legacy\t<path>\t(no registry)`. Pure — exported
 * so the format can be tested without spawning the CLI. */
export function formatStoreList({ cwd = process.cwd() } = {}) {
  const registry = readRegistry()
  const picked = explainStoreDir(null, { cwd })
  if (!registry.stores.length) {
    return [`* legacy\t${picked.dir}\t(no registry: ${registry.path})`]
  }
  return registry.stores.map((s) => {
    const mark = resolve(s.path) === resolve(picked.dir) ? '*' : ' '
    const flags = []
    if (s.isDefault) flags.push('default')
    if (s.cwdPrefixes.length) flags.push(`cwd_prefixes=${s.cwdPrefixes.join(',')}`)
    return `${mark} ${s.name}\t${s.path}\t${flags.join(' ')}`.trimEnd()
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

// --- 404 handling ------------------------------------------------------------
//
// When a requested path doesn't resolve to a file, look the request's
// basename up against manifest.json: a unique match redirects (302) straight
// to that page (so a stale/half-remembered link still lands somewhere), and
// anything else (zero matches, or more than one) renders a kit-styled 404
// page listing whatever near-matches were found plus a link into the index
// search. Legacy pages (`legacy/**`) are ordinary manifest records, so they
// participate exactly like any other page.

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

/** `/`-prefixed URL for a store-relative page path, each segment
 * percent-encoded individually (so a `Location` header is always valid even
 * if a path segment ever contains characters that need escaping). */
function encodePath(relPath) {
  return '/' + relPath.split('/').map(encodeURIComponent).join('/')
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

/** The kit-styled 404 page: `.wu-header` (back nav to `/`, eyebrow, the
 * requested path as h1, a lede), an optional "近いページ" section listing
 * `candidates`, and an always-present "探す" section linking into the index
 * search for `searchQuery`. No inline styles beyond the kit's own
 * stylesheet, no emoji, no external assets — only `/_kit/writeup.css`. */
function renderNotFoundHtml(requestedPath, candidates, searchQuery) {
  const nearHtml = candidates.length
    ? `<section class="wu-section">
<h2>近いページ</h2>
<ul>
${candidates.map((c) => `<li><a href="${escapeHtml(encodePath(c.path))}">${escapeHtml(c.title || c.path)}</a> &middot; ${escapeHtml(c.ref || '')} &middot; ${escapeHtml(shortDatetime(c.updated))}</li>`).join('\n')}
</ul>
</section>`
    : ''
  const searchHref = `/?q=${encodeURIComponent(searchQuery)}`
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>見つかりません</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/_kit/writeup.css">
</head>
<body>
<div class="wu-page">
<header class="wu-header">
<nav class="wu-nav"><a class="wu-back" href="/">一覧</a></nav>
<p class="wu-eyebrow">見つかりません</p>
<h1>${escapeHtml(requestedPath)}</h1>
<p class="wu-lede">このパスにページはありません。</p>
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
function sendNotFound(res, requestedPath, candidates) {
  const searchQuery = stripDateAndExt(basenameOf(requestedPath))
  const html = renderNotFoundHtml(requestedPath, candidates, searchQuery)
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}

/** A request path that didn't resolve to a file: looks up candidates by
 * basename and either redirects (302) to a unique match — logging the
 * redirect to stderr — or renders the 404 page with whatever candidates (if
 * any) were found. */
function handleNotFound(res, storeDir, pathOnly) {
  const requestedPath = safeDecode(pathOnly)
  const manifest = readManifest(storeDir)
  const candidates = findNotFoundCandidates(manifest, basenameOf(requestedPath))
  if (candidates.length === 1) {
    const location = encodePath(candidates[0].path)
    process.stderr.write(`serve: 404 redirect ${requestedPath} -> ${location} (matched ${candidates[0].ref})\n`)
    res.writeHead(302, { location })
    return void res.end()
  }
  return sendNotFound(res, requestedPath, candidates)
}

/** `/id/<8-hex-id>` → 302 to the page's path, resolved via manifest.json,
 * or the same kit-styled 404 page as any other unresolved path when the id
 * isn't known (or manifest.json doesn't exist yet). Read-only: never
 * rebuilds the manifest itself, so this never mutates the store — a request
 * just reflects whatever the last build wrote. */
async function handleIdRoute(req, res, storeDir, id, pathOnly) {
  const manifest = readManifest(storeDir)
  const record = manifest.find((r) => r && r.id === id)
  if (!record) return sendNotFound(res, safeDecode(pathOnly), [])
  res.writeHead(302, { location: encodePath(record.path) })
  res.end()
}

async function handleRequest(req, res, storeDir) {
  if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) return send(res, 403, 'forbidden')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')

  const pathOnly = (req.url || '/').split('?')[0].split('#')[0]
  const idMatch = ID_ROUTE_RE.exec(pathOnly)
  if (idMatch) return handleIdRoute(req, res, storeDir, idMatch[1], pathOnly)

  const target = resolveSafePath(storeDir, req.url || '/')
  if (!target) return send(res, 400, 'bad request')

  let st
  try {
    st = await stat(target)
  } catch {
    return handleNotFound(res, storeDir, pathOnly)
  }
  const filePath = st.isDirectory() ? join(target, 'index.html') : target
  let body
  try {
    body = await readFile(filePath)
  } catch {
    return handleNotFound(res, storeDir, pathOnly)
  }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  if (req.method === 'HEAD') return void res.end()
  res.end(body)
}

/**
 * Starts the static server. Resolves once listening; the server keeps
 * running until `stop()` is called (or the process exits).
 * @returns {Promise<{server: import('node:http').Server, port: number, url: string, stop: () => Promise<void>}>}
 */
export async function startServer(storeDir, { port, fallbackToFreePort = true } = {}) {
  const server = createServer((req, res) => {
    handleRequest(req, res, storeDir).catch((e) => {
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

  const requested = port ?? portForStore(storeDir)
  try {
    await listenOn(requested)
  } catch (e) {
    if (!(fallbackToFreePort && e.code === 'EADDRINUSE')) throw e
    await listenOn(0)
  }

  const bound = server.address().port
  const url = `http://127.0.0.1:${bound}/`
  return {
    server,
    port: bound,
    url,
    stop: () => new Promise((res) => { server.closeAllConnections?.(); server.close(() => res()) }),
  }
}

// --- CLI --------------------------------------------------------------------

const USAGE = 'usage: node bin/serve.mjs [--store dir | --store-name name | --all] [--port n] [--no-open] [--no-build] [--list-stores]'

export function parseArgs(argv) {
  const args = { store: null, storeName: null, all: false, listStores: false, port: null, open: true, build: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') args.store = argv[++i]
    else if (a === '--store-name') args.storeName = argv[++i]
    else if (a === '--all') args.all = true
    else if (a === '--list-stores') args.listStores = true
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--no-open') args.open = false
    else if (a === '--no-build') args.build = false
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`unknown argument: ${a}\n${USAGE}`)
  }
  if ((args.store ? 1 : 0) + (args.storeName ? 1 : 0) + (args.all ? 1 : 0) > 1) {
    throw new Error(`--store, --store-name and --all are mutually exclusive\n${USAGE}`)
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

/** `--all`: one listener per registered store, consecutive ports. A store
 * whose planned port is taken falls back to a free one. Stores are
 * started in registry order so the port assignment stays predictable. */
export async function startAll(stores, { basePort, fallbackToFreePort = true } = {}) {
  const started = []
  for (const plan of planAllPorts(stores, basePort)) {
    const server = await startServer(plan.path, { port: plan.port, fallbackToFreePort })
    started.push({ name: plan.name, path: plan.path, ...server })
  }
  return started
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

  if (args.all) {
    const stores = listStores()
    if (!stores.length) throw new Error(`--all: no registered stores (registry: ${readRegistry().path})`)
    for (const s of stores) buildIfWanted(args, s.path)
    const started = await startAll(stores, { basePort: args.port || undefined })
    for (const s of started) {
      process.stderr.write(`serve: ${s.url} (store ${s.name}: ${s.path})\n`)
      if (args.open) openInBrowser(s.url)
    }
    return started.map((s) => s.port)
  }

  const storeDir = resolveStoreDir(args.store, { name: args.storeName })
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
