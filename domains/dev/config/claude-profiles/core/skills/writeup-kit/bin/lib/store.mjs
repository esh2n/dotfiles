// store.mjs — store path resolution, the store registry (`stores.toml`),
// `.writeup.toml` reading, and small git helpers (via child_process). No
// network, no npm dependency.
//
// Two layouts are supported side by side:
//   - legacy: a single store at `~/.local/share/writeup` (or `$WRITEUP_STORE`)
//     whose root directly contains `.writeup.toml`;
//   - registry: `~/.local/share/writeup/stores.toml` (or `$WRITEUP_STORES`)
//     naming several independent stores (e.g. `work` and `learn`), each its
//     own git repo with its own `.writeup.toml`, picked by an explicit name,
//     by the current working directory (`cwd_prefixes`), or by `default`.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseToml } from './toml-lite.mjs'

/** The legacy single-store location, also the base directory the registry
 * and its relative store paths hang off. Not affected by `$WRITEUP_STORE`. */
export function defaultStoreBase() {
  return join(homedir(), '.local', 'share', 'writeup')
}

/** Path of the store registry: `$WRITEUP_STORES`, else
 * `<defaultStoreBase>/stores.toml`. The file need not exist. */
export function registryPath() {
  if (process.env.WRITEUP_STORES) return resolve(expandHome(process.env.WRITEUP_STORES))
  return join(defaultStoreBase(), 'stores.toml')
}

/** `~` / `~/x` → the user's home directory. Other strings pass through. */
export function expandHome(p) {
  if (p === '~') return homedir()
  if (typeof p === 'string' && p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

function resolveAgainst(baseDir, p) {
  const expanded = expandHome(p)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded)
}

/** Parses `stores.toml` into `{ path, exists, defaultName, stores }` where
 * each store is `{ name, path (absolute), isDefault, cwdPrefixes (absolute) }`.
 * A missing registry yields `exists: false` and no stores. A malformed
 * registry throws (TomlParseError) — never silently read as empty. Entries
 * without a `name` or a `path` are skipped; a duplicate name keeps the
 * first entry. */
export function readRegistry(path = registryPath()) {
  if (!existsSync(path)) return { path, exists: false, defaultName: null, stores: [] }
  const cfg = parseToml(readFileSync(path, 'utf8'))
  const baseDir = dirname(path)
  const defaultName = typeof cfg.default === 'string' && cfg.default ? cfg.default : null
  const seen = new Set()
  const stores = []
  for (const entry of Array.isArray(cfg.store) ? cfg.store : []) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) continue
    if (seen.has(entry.name)) continue
    const rawPath = typeof entry.path === 'string' && entry.path ? entry.path : entry.name
    const prefixes = Array.isArray(entry.cwd_prefixes) ? entry.cwd_prefixes : []
    seen.add(entry.name)
    stores.push({
      name: entry.name,
      path: resolveAgainst(baseDir, rawPath),
      isDefault: entry.name === defaultName,
      cwdPrefixes: prefixes.filter((p) => typeof p === 'string' && p).map((p) => resolveAgainst(baseDir, p)),
    })
  }
  return { path, exists: true, defaultName, stores }
}

/** Every registered store as `[{ name, path, isDefault, cwdPrefixes }]`,
 * `[]` when there is no registry. */
export function listStores() {
  return readRegistry().stores
}

/** The registered store named `name`, or `null` when unknown. */
export function resolveStoreByName(name) {
  return listStores().find((s) => s.name === name) ?? null
}

function isUnder(dir, prefix) {
  return dir === prefix || dir.startsWith(prefix + sep)
}

/** The registered store whose `cwd_prefixes` contains `cwd` — the longest
 * matching prefix wins when several stores overlap. `null` if none. */
export function resolveStoreByCwd(cwd, stores = listStores()) {
  const dir = resolve(cwd)
  let best = null
  let bestLen = -1
  for (const s of stores) {
    for (const p of s.cwdPrefixes) {
      if (isUnder(dir, p) && p.length > bestLen) { best = s; bestLen = p.length }
    }
  }
  return best
}

/** Resolves the store directory, in this order:
 *   1. `explicit` (`--store <dir>`)
 *   2. `name` (`--store-name <name>`), looked up in the registry — an
 *      unknown name throws rather than silently picking another store
 *   3. `$WRITEUP_STORE`
 *   4. ancestor discovery: an existing `.writeup.toml` at or above `cwd`
 *   5. the registry store whose `cwd_prefixes` covers `cwd`
 *   6. the registry `default`
 *   7. the legacy single store (`~/.local/share/writeup`), when its root
 *      directly contains `.writeup.toml`
 *   8. otherwise the same legacy path, so `init-store` and `build` still
 *      have somewhere to create on a fresh machine.
 * Callers that pass an explicit dir see exactly the old behavior. */
export function resolveStoreDir(explicit, { cwd = process.cwd(), name } = {}) {
  if (explicit) return explicit
  if (name) {
    const s = resolveStoreByName(name)
    if (!s) throw new Error(`unknown store name: ${name} (registry: ${registryPath()})`)
    return s.path
  }
  if (process.env.WRITEUP_STORE) return process.env.WRITEUP_STORE
  const discovered = discoverStoreRoot(cwd)
  if (discovered) return discovered
  const registry = readRegistry()
  const byCwd = resolveStoreByCwd(cwd, registry.stores)
  if (byCwd) return byCwd.path
  const dflt = registry.stores.find((s) => s.isDefault)
  if (dflt) return dflt.path
  return defaultStoreBase()
}

/** Explains which rule picked the store for `cwd` — the same order as
 * `resolveStoreDir`, returned as `{ dir, via, name }` for `--list-stores`
 * style output. `via` is one of `explicit`, `name`, `env`, `ancestor`,
 * `cwd_prefix`, `default`, `legacy`, `fallback`. */
export function explainStoreDir(explicit, { cwd = process.cwd(), name } = {}) {
  if (explicit) return { dir: explicit, via: 'explicit', name: null }
  if (name) return { dir: resolveStoreDir(null, { cwd, name }), via: 'name', name }
  if (process.env.WRITEUP_STORE) return { dir: process.env.WRITEUP_STORE, via: 'env', name: null }
  const discovered = discoverStoreRoot(cwd)
  if (discovered) return { dir: discovered, via: 'ancestor', name: null }
  const registry = readRegistry()
  const byCwd = resolveStoreByCwd(cwd, registry.stores)
  if (byCwd) return { dir: byCwd.path, via: 'cwd_prefix', name: byCwd.name }
  const dflt = registry.stores.find((s) => s.isDefault)
  if (dflt) return { dir: dflt.path, via: 'default', name: dflt.name }
  const legacy = defaultStoreBase()
  if (existsSync(join(legacy, '.writeup.toml'))) return { dir: legacy, via: 'legacy', name: null }
  return { dir: legacy, via: 'fallback', name: null }
}

/** Read and parse `<store>/.writeup.toml`. Returns `{}` if the file is
 * absent. Throws TomlParseError on a malformed file (never silently
 * ignored — a broken private-word list must not fail open). */
export function readStoreConfig(storeDir) {
  const path = join(storeDir, '.writeup.toml')
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  return parseToml(text)
}

/** The `[private] words = [...]` list — company-trace words to refuse on
 * publish. Never shipped with the kit; lives per store. */
export function privateWords(storeDir) {
  const cfg = readStoreConfig(storeDir)
  const words = cfg?.private?.words
  return Array.isArray(words) ? words.filter((w) => typeof w === 'string' && w.length > 0) : []
}

/** The `[cloudflare]` table (project name, access flags). */
export function cloudflareConfig(storeDir) {
  const cfg = readStoreConfig(storeDir)
  return (cfg && typeof cfg.cloudflare === 'object' && !Array.isArray(cfg.cloudflare)) ? cfg.cloudflare : {}
}

/** Reads and parses `<store>/manifest.json`. Returns `[]` when the file is
 * missing, unreadable, malformed JSON, or not an array — read-only lookups
 * (id redirects, 404 "near pages" candidates) should degrade to "no
 * candidates" rather than throw. */
export function readManifest(storeDir) {
  try {
    const data = JSON.parse(readFileSync(join(storeDir, 'manifest.json'), 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Stable short id for a page: the first 8 hex chars of sha256(relPath),
 * where `relPath` is the page's store-relative path with `/` separators.
 * Path-based (not content-based), so it never changes on revision and
 * stays unique across folders since the full path is hashed. */
export function pageId(relPath) {
  return createHash('sha256').update(relPath).digest('hex').slice(0, 8)
}

/** Finds the store root containing `startDir` (or `startDir` itself) by
 * walking up looking for `.writeup.toml`, stopping at `$HOME` or the
 * filesystem root. Returns `null` if none is found — e.g. a file being
 * self-checked outside any known store, where a page's `id` cannot be
 * verified against its (unknowable) store-relative path. */
export function discoverStoreRoot(startDir) {
  const home = homedir()
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, '.writeup.toml'))) return dir
    if (dir === home) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** `git log -1 --format=%cI -- <relPath>` (the file's last commit datetime,
 * ISO 8601 with a minute-and-second offset), or `null` if `dir` is not a
 * git repo, the file has no commits, or git is unavailable. */
export function gitLastCommitDatetime(dir, relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

export function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

/** `git add <paths...>` relative to `dir`. Throws on failure. */
export function gitAdd(dir, paths) {
  execFileSync('git', ['add', ...paths], { cwd: dir })
}

/** `git commit -m <message>`. Throws on failure (including "nothing to commit"). */
export function gitCommit(dir, message) {
  execFileSync('git', ['commit', '-m', message], { cwd: dir })
}

/** True if any of `paths` (relative to `dir`) has a pending change. */
export function gitHasChanges(dir, paths) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: dir }).toString()
    return out.trim().length > 0
  } catch {
    return false
  }
}
