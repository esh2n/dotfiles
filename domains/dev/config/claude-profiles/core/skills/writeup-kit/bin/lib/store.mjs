// store.mjs — store path resolution, `.writeup.toml` reading, and small git
// helpers (via child_process). No network, no npm dependency.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
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
