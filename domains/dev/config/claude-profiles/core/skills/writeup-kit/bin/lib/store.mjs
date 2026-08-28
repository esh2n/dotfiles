// store.mjs — store path resolution, `.writeup.toml` reading, and small git
// helpers (via child_process). No network, no npm dependency.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseToml } from './toml-lite.mjs'

/** Resolve the store directory: explicit arg > WRITEUP_STORE env > default. */
export function resolveStoreDir(explicit) {
  if (explicit) return explicit
  if (process.env.WRITEUP_STORE) return process.env.WRITEUP_STORE
  return join(homedir(), '.local', 'share', 'writeup')
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
