#!/usr/bin/env node
// init-store.mjs — bootstraps a writeup store: the git-backed directory
// that holds every writeup page. Zero-dependency (Node standard library
// only): no dependency on writeup-kit's own libs, so this script still
// works even before the kit is resolved.
//
//   node scripts/init-store.mjs [--store dir]
//   node scripts/init-store.mjs --name <name> [--store dir] [--description <text>] [--default]
//   node scripts/init-store.mjs --marker <name>
//
// Without --name this is the legacy single store: --store, then
// $WRITEUP_STORE, then ~/.local/share/writeup — the registry is not touched,
// so a machine with an un-split old store keeps working as before.
//
// With --name the store is created at --store (default:
// `<registry dir>/<name>`) and registered in the store registry
// (`$WRITEUP_STORES`, else ~/.local/share/writeup/stores.toml): the
// registry is created if missing, a `[[store]]` entry is appended if absent
// (never duplicated), --description sets that entry's one-line
// `description`, and --default sets the registry's `default`.
//
// --marker <name> writes the repository marker `<repo root>/.writeup`
// (`store = "<name>"`) for the git repository containing the current
// directory, so later saves from that repository resolve to <name> without
// asking. The marker names a store *name*, not a path, so the file is
// portable to any machine whose registry has that name.
//
// Idempotent: every step checks what's already there before writing, so
// running this twice against the same store makes no further changes
// beyond a `build` re-sync (which is itself a no-op once the kit's CSS
// hasn't changed).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(HERE, '..')

const WRITEUP_TOML_TEMPLATE = `[private]
words = []

[lint]

[cloudflare]
project = ""
access_required = true
access_verified = false
`

const GITIGNORE_TEMPLATE = `.publish/
`

/** The repository marker file name — the same as writeup-kit's
 * bin/lib/store.mjs `REPO_MARKER`. */
export const REPO_MARKER = '.writeup'

function defaultStoreBase() {
  return join(homedir(), '.local', 'share', 'writeup')
}

function resolveStoreDir(explicit) {
  if (explicit) return explicit
  if (process.env.WRITEUP_STORE) return process.env.WRITEUP_STORE
  return defaultStoreBase()
}

function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** `$WRITEUP_STORES`, else `~/.local/share/writeup/stores.toml` — the same
 * rule as writeup-kit's bin/lib/store.mjs `registryPath()`. */
export function registryPath() {
  if (process.env.WRITEUP_STORES) return resolve(expandHome(process.env.WRITEUP_STORES))
  return join(defaultStoreBase(), 'stores.toml')
}

// --- registry (stores.toml) editing -----------------------------------------
//
// Line-based so that comments and unrelated entries survive untouched. Only
// the shape the kit's toml-lite parser reads is written: a top-level
// `default = "<name>"`, then `[[store]]` tables with `name`, `path` and an
// optional one-line `description`.

function tomlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function tomlStringValue(line, key) {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`).exec(line)
  if (!m) return null
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]
}

/** Splits registry text into `{ header: string[], entries: [{ lines }] }`
 * where each entry starts at a `[[store]]` line. */
function splitRegistry(text) {
  const header = []
  const entries = []
  let current = null
  for (const line of text.split('\n')) {
    if (/^\s*\[\[\s*store\s*\]\]\s*(#.*)?$/.test(line)) {
      current = { lines: [line] }
      entries.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      header.push(line)
    }
  }
  return { header, entries }
}

function entryName(entry) {
  for (const line of entry.lines) {
    const v = tomlStringValue(line, 'name')
    if (v !== null) return v
  }
  return null
}

/** Sets the entry's single-line `description` (adding the line when
 * absent). Returns true when the entry changed. */
function setDescription(entry, description) {
  if (description === null || description === undefined) return false
  const idx = entry.lines.findIndex((l) => /^\s*description\s*=/.test(l))
  if (idx !== -1 && tomlStringValue(entry.lines[idx], 'description') === description) return false
  const line = `description = ${tomlString(description)}`
  if (idx === -1) {
    // Insert after the last non-blank line of the entry so a trailing blank
    // line (entry separator) stays trailing.
    let at = entry.lines.length
    while (at > 1 && entry.lines[at - 1].trim() === '') at--
    entry.lines.splice(at, 0, line)
  } else {
    entry.lines[idx] = line
  }
  return true
}

/** A store path as written into the registry: relative when it sits
 * under the registry's directory, `~/...` when under $HOME, else absolute. */
export function portablePath(target, registryDir) {
  const abs = resolve(target)
  const base = resolve(registryDir)
  if (abs === base || abs.startsWith(base + sep)) return relative(base, abs) || '.'
  const home = homedir()
  if (abs === home) return '~'
  if (abs.startsWith(home + sep)) return '~/' + relative(home, abs).split(sep).join('/')
  return abs
}

/**
 * Returns `{ text, changes }`: the registry text with `name` registered at
 * `storePath`, its `description` set when given, and (when `makeDefault`)
 * the top-level `default` set. Pure — the caller writes the file.
 * Registering an already-present name never adds a second `[[store]]`.
 */
export function registerStore(text, { name, storePath, description = null, makeDefault = false, registryDir }) {
  const changes = []
  const { header, entries } = splitRegistry(text || '')

  if (makeDefault) {
    const idx = header.findIndex((l) => /^\s*default\s*=/.test(l))
    const line = `default = ${tomlString(name)}`
    if (idx === -1) {
      header.unshift(line)
      changes.push(`set default = "${name}"`)
    } else if (header[idx].trim() !== line) {
      header[idx] = line
      changes.push(`set default = "${name}"`)
    }
  }

  let entry = entries.find((e) => entryName(e) === name)
  if (!entry) {
    const pathValue = portablePath(storePath, registryDir)
    entry = { lines: ['[[store]]', `name = ${tomlString(name)}`, `path = ${tomlString(pathValue)}`] }
    entries.push(entry)
    changes.push(`registered store "${name}" (path = "${pathValue}")`)
  } else {
    changes.push(`store "${name}" already registered — left as is`)
  }
  if (setDescription(entry, description)) changes.push(`description for "${name}" = "${description}"`)

  // Re-assemble: header, then entries separated by exactly one blank line.
  const headerText = header.join('\n').replace(/\s+$/, '')
  const entryTexts = entries.map((e) => e.lines.join('\n').replace(/\s+$/, ''))
  const parts = [headerText, ...entryTexts].filter((t) => t !== '')
  return { text: parts.join('\n\n') + '\n', changes }
}

/** Reads, updates, and writes the registry file. Returns the log lines. */
export function registerStoreInFile(registryFile, opts) {
  const before = existsSync(registryFile) ? readFileSync(registryFile, 'utf8') : ''
  const { text, changes } = registerStore(before, { ...opts, registryDir: dirname(registryFile) })
  const log = []
  if (!existsSync(registryFile)) log.push(`init-store: creating registry ${registryFile}`)
  if (text !== before) {
    mkdirSync(dirname(registryFile), { recursive: true })
    writeFileSync(registryFile, text)
  }
  for (const c of changes) log.push(`init-store: ${c}`)
  if (!/^\s*default\s*=/m.test(text)) log.push('init-store: registry has no default yet — pass --default on the store that should win when no repository marker applies')
  return log
}

/** The names registered in `registryFile` (`[]` when it does not exist). */
export function registeredNames(registryFile) {
  if (!existsSync(registryFile)) return []
  return splitRegistry(readFileSync(registryFile, 'utf8')).entries.map(entryName).filter((n) => n !== null)
}

// --- repository marker --------------------------------------------------------

/** The nearest git repository root at or above `startDir` — the first
 * directory containing `.git`. `null` outside any repository. */
export function findRepoRoot(startDir) {
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The text of a marker naming `name`. */
export function markerText(name) {
  return `store = ${tomlString(name)}\n`
}

/**
 * Writes `<repo root>/.writeup` naming `name` for the repository containing
 * `cwd`. `name` must be registered in `registryFile` (a marker naming an
 * unknown store would make every kit CLI in that repository fail, since
 * the kit refuses to guess). Idempotent; an existing marker naming another
 * store is rewritten and reported. Returns the log lines.
 */
export function writeRepoMarker(name, { cwd = process.cwd(), registryFile = registryPath() } = {}) {
  const repoRoot = findRepoRoot(cwd)
  if (!repoRoot) throw new Error(`--marker: ${resolve(cwd)} is not inside a git repository`)
  const names = registeredNames(registryFile)
  if (!names.includes(name)) {
    throw new Error(`--marker: "${name}" is not a registered store (registry: ${registryFile}; known: ${names.join(', ') || 'none'}) — register it first with --name ${name}`)
  }
  const path = join(repoRoot, REPO_MARKER)
  const text = markerText(name)
  const log = []
  if (existsSync(path)) {
    const before = readFileSync(path, 'utf8')
    if (before === text) {
      log.push(`init-store: ${path} already names "${name}" — left as is`)
      return log
    }
    writeFileSync(path, text)
    log.push(`init-store: rewrote ${path} → store = "${name}" (was: ${before.trim()})`)
    return log
  }
  writeFileSync(path, text)
  log.push(`init-store: wrote ${path} (store = "${name}") — commit it: it names a store by name, so it works on any machine with that store registered`)
  return log
}

/** Same resolution order as SKILL.md: sibling `../writeup-kit/` next to
 * this skill's own directory, then `~/.claude/skills/writeup-kit/`. */
function resolveKitDir() {
  const sibling = join(SKILL_DIR, '..', 'writeup-kit')
  if (existsSync(join(sibling, 'bin', 'build.mjs'))) return sibling
  const shared = join(homedir(), '.claude', 'skills', 'writeup-kit')
  if (existsSync(join(shared, 'bin', 'build.mjs'))) return shared
  return null
}

const USAGE = 'usage: node scripts/init-store.mjs [--store dir] [--name name [--description text] [--default]] | --marker name'
const NAME_RE = /^[A-Za-z0-9_-]+$/

export function parseArgs(argv) {
  const args = { store: null, name: null, description: null, makeDefault: false, marker: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--store') args.store = argv[++i]
    else if (a === '--name') args.name = argv[++i]
    else if (a === '--description') args.description = argv[++i]
    else if (a === '--default') args.makeDefault = true
    else if (a === '--marker') args.marker = argv[++i]
    else throw new Error(`unknown argument: ${a}\n${USAGE}`)
  }
  if (args.marker !== null) {
    if (!args.marker || !NAME_RE.test(args.marker)) throw new Error(`--marker needs a store name matching [A-Za-z0-9_-]+`)
    if (args.store || args.name || args.description !== null || args.makeDefault) {
      throw new Error(`--marker takes no other flags\n${USAGE}`)
    }
    return args
  }
  if (!args.name && (args.description !== null || args.makeDefault)) {
    throw new Error(`--description and --default need --name\n${USAGE}`)
  }
  if (args.name && !NAME_RE.test(args.name)) {
    throw new Error(`--name must match [A-Za-z0-9_-]+: ${args.name}`)
  }
  return args
}

function ensureDir(path, log, label) {
  if (existsSync(path)) {
    log.push(`init-store: ${label} already exists — left as is`)
    return
  }
  mkdirSync(path, { recursive: true })
  log.push(`init-store: created ${label}`)
}

function ensureFile(path, content, log, label) {
  if (existsSync(path)) {
    log.push(`init-store: ${label} already exists — left as is`)
    return
  }
  writeFileSync(path, content)
  log.push(`init-store: wrote ${label}`)
}

function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

export function initStore(storeDir) {
  const log = []

  ensureDir(storeDir, log, `store directory (${storeDir})`)

  if (isGitRepo(storeDir)) {
    log.push('init-store: store is already a git repository — left as is')
  } else {
    execFileSync('git', ['init'], { cwd: storeDir })
    log.push('init-store: ran git init')
  }

  ensureFile(join(storeDir, '.writeup.toml'), WRITEUP_TOML_TEMPLATE, log, '.writeup.toml')
  ensureFile(join(storeDir, '.gitignore'), GITIGNORE_TEMPLATE, log, '.gitignore')

  ensureDir(join(storeDir, '_kit'), log, '_kit/')
  ensureDir(join(storeDir, 'public'), log, 'public/')
  ensureDir(join(storeDir, 'legacy'), log, 'legacy/')
  ensureDir(join(storeDir, '.publish'), log, '.publish/')

  const kitDir = resolveKitDir()
  if (!kitDir) {
    log.push('init-store: writeup-kit not found (checked ../writeup-kit and ~/.claude/skills/writeup-kit) — skipped build')
    return log
  }

  const buildScript = join(kitDir, 'bin', 'build.mjs')
  try {
    const output = execFileSync('node', [buildScript, '--store', storeDir], { encoding: 'utf8' })
    for (const line of output.trim().split('\n')) log.push(`init-store: ${line}`)
  } catch (e) {
    log.push(`init-store: build failed: ${e.message}`)
  }

  return log
}

/** A named store: `--store` or `<registry dir>/<name>`, created like any
 * other store and then registered. */
export function initNamedStore({ name, store, description = null, makeDefault = false }) {
  const registryFile = registryPath()
  const storeDir = store ? resolve(expandHome(store)) : join(dirname(registryFile), name)
  const log = initStore(storeDir)
  log.push(...registerStoreInFile(registryFile, { name, storePath: storeDir, description, makeDefault }))
  return log
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`init-store: ${e.message}`)
    return 2
  }
  let log
  try {
    log = args.marker
      ? writeRepoMarker(args.marker)
      : args.name
        ? initNamedStore(args)
        : initStore(resolveStoreDir(args.store))
  } catch (e) {
    console.error(`init-store: ${e.message}`)
    return 1
  }
  for (const line of log) console.log(line)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
