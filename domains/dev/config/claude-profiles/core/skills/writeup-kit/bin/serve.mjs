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

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveStoreDir } from './lib/store.mjs'
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

/** `/id/<8-hex-id>` → 302 to the page's path, resolved via manifest.json.
 * Read-only: never rebuilds the manifest itself, so this never mutates the
 * store — a request just reflects whatever the last build wrote. */
async function handleIdRoute(req, res, storeDir, id) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(storeDir, 'manifest.json'), 'utf8'))
  } catch {
    return send(res, 404, 'not found (no manifest.json — run build first)')
  }
  const record = Array.isArray(manifest) ? manifest.find((r) => r.id === id) : null
  if (!record) return send(res, 404, `not found: no page with id ${id}`)
  res.writeHead(302, { location: '/' + record.path })
  res.end()
}

async function handleRequest(req, res, storeDir) {
  if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) return send(res, 403, 'forbidden')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')

  const pathOnly = (req.url || '/').split('?')[0].split('#')[0]
  const idMatch = ID_ROUTE_RE.exec(pathOnly)
  if (idMatch) return handleIdRoute(req, res, storeDir, idMatch[1])

  const target = resolveSafePath(storeDir, req.url || '/')
  if (!target) return send(res, 400, 'bad request')

  let st
  try {
    st = await stat(target)
  } catch {
    return send(res, 404, 'not found')
  }
  const filePath = st.isDirectory() ? join(target, 'index.html') : target
  let body
  try {
    body = await readFile(filePath)
  } catch {
    return send(res, 404, 'not found')
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

function parseArgs(argv) {
  const args = { store: null, port: null, open: true, build: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') args.store = argv[++i]
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--no-open') args.open = false
    else if (a === '--no-build') args.build = false
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const storeDir = resolveStoreDir(args.store)

  if (args.build) {
    const result = buildStore(storeDir)
    process.stderr.write(`serve: built ${result.counts.total} pages (legacy: ${result.counts.legacy})\n`)
  }

  const { url, port } = await startServer(storeDir, { port: args.port || undefined })
  process.stderr.write(`serve: ${url} (store: ${storeDir})\n`)
  if (args.open && process.platform === 'darwin') {
    try {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } catch (e) {
      process.stderr.write(`serve: could not open a browser (${e.message}). Open the URL above manually.\n`)
    }
  }
  return port
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`serve: ${e.stack || e}`)
    process.exitCode = 1
  })
}
