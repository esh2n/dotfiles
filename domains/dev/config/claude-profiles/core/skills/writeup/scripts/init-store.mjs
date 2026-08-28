#!/usr/bin/env node
// init-store.mjs — bootstraps a writeup store: the git-backed directory
// that holds every writeup page. Zero-dependency (Node standard library
// only): no dependency on writeup-kit's own libs, so this script still
// works even before the kit is resolved.
//
//   node scripts/init-store.mjs [--store dir]
//
// Store resolution mirrors writeup-kit's bin/lib/store.mjs: --store, then
// $WRITEUP_STORE, then ~/.local/share/writeup.
//
// Idempotent: every step checks what's already there before writing, so
// running this twice against the same store makes no further changes
// beyond a `build` re-sync (which is itself a no-op once the kit's CSS
// hasn't changed).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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

function resolveStoreDir(explicit) {
  if (explicit) return explicit
  if (process.env.WRITEUP_STORE) return process.env.WRITEUP_STORE
  return join(homedir(), '.local', 'share', 'writeup')
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

function parseArgs(argv) {
  const args = { store: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--store') args.store = argv[++i]
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

function main() {
  const args = parseArgs(process.argv.slice(2))
  const storeDir = resolveStoreDir(args.store)
  const log = initStore(storeDir)
  for (const line of log) console.log(line)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
