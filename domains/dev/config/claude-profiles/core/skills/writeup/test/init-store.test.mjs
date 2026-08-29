// init-store.test.mjs — registry registration is idempotent, `--name`
// creates + registers a store (with `--description`), `--marker` writes
// the repository marker, and the flag-less legacy run never touches the
// registry. Uses a temp dir and $WRITEUP_STORES / $WRITEUP_STORE.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  registerStore, registerStoreInFile, registeredNames, initNamedStore, initStore, parseArgs, portablePath, registryPath,
  findRepoRoot, markerText, writeRepoMarker, REPO_MARKER,
} from '../scripts/init-store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_TOML = join(HERE, '..', '..', 'writeup-kit', 'bin', 'lib', 'toml-lite.mjs')
const KIT_STORE = join(HERE, '..', '..', 'writeup-kit', 'bin', 'lib', 'store.mjs')

const ENV_KEYS = ['WRITEUP_STORE', 'WRITEUP_STORES']
let savedEnv
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('registerStore (pure)', () => {
  const registryDir = '/reg'

  test('creates an entry: relative path under the registry dir, one-line description', () => {
    const { text, changes } = registerStore('', { name: 'work', storePath: '/reg/work', description: '仕事', registryDir })
    assert.equal(text, '[[store]]\nname = "work"\npath = "work"\ndescription = "仕事"\n')
    assert.equal(changes.length, 2)
    assert.equal(registerStore('', { name: 'work', storePath: '/reg/work', registryDir }).text, '[[store]]\nname = "work"\npath = "work"\n')
  })

  test('is idempotent: re-registering adds no second [[store]] and reports it', () => {
    const first = registerStore('', { name: 'work', storePath: '/reg/work', description: '仕事', registryDir }).text
    const second = registerStore(first, { name: 'work', storePath: '/reg/work', description: '仕事', registryDir })
    assert.equal(second.text, first)
    assert.deepEqual(second.changes, ['store "work" already registered — left as is'])
    assert.equal((second.text.match(/\[\[store\]\]/g) || []).length, 1)
  })

  test('updates an existing description, keeps other entries, never writes cwd_prefixes', () => {
    let text = registerStore('', { name: 'work', storePath: '/reg/work', description: 'old', registryDir }).text
    text = registerStore(text, { name: 'private', storePath: '/reg/private', description: '個人', makeDefault: true, registryDir }).text
    const { text: updated, changes } = registerStore(text, { name: 'work', storePath: '/reg/work', description: '仕事', registryDir })
    assert.match(updated, /name = "work"\npath = "work"\ndescription = "仕事"\n/)
    assert.doesNotMatch(updated, /old/)
    assert.ok(changes.some((c) => c.includes('description for "work"')))
    assert.ok(updated.startsWith('default = "private"\n\n'))
    assert.equal((updated.match(/\[\[store\]\]/g) || []).length, 2)
    assert.doesNotMatch(updated, /cwd_prefixes/)
  })

  test('--default replaces an existing default line and never duplicates it', () => {
    let text = registerStore('', { name: 'work', storePath: '/reg/work', makeDefault: true, registryDir }).text
    text = registerStore(text, { name: 'private', storePath: '/reg/private', makeDefault: true, registryDir }).text
    assert.equal((text.match(/^default = /gm) || []).length, 1)
    assert.match(text, /^default = "private"/m)
    assert.equal(registerStore(text, { name: 'private', storePath: '/reg/private', makeDefault: true, registryDir }).text, text)
  })

  test('preserves comments and hand-written entries', () => {
    const hand = '# my stores\ndefault = "private"\n\n[[store]]\nname = "private"\npath = "private"\n'
    const { text } = registerStore(hand, { name: 'work', storePath: '/reg/work', registryDir })
    assert.ok(text.startsWith('# my stores\ndefault = "private"\n\n[[store]]\nname = "private"'))
    assert.match(text, /\[\[store\]\]\nname = "work"\npath = "work"\n$/)
  })

  test('the emitted registry parses with the kit\'s toml-lite and store.mjs', async () => {
    const { parseToml } = await import(KIT_TOML)
    let text = registerStore('', { name: 'work', storePath: '/reg/work', description: 'a "quoted" 仕事', registryDir }).text
    text = registerStore(text, { name: 'private', storePath: '/reg/private', makeDefault: true, registryDir }).text
    const cfg = parseToml(text)
    assert.equal(cfg.default, 'private')
    assert.deepEqual(cfg.store.map((s) => s.name), ['work', 'private'])
    assert.equal(cfg.store[0].description, 'a "quoted" 仕事')
  })

  test('portablePath: relative under the registry, ~ under home, absolute elsewhere', () => {
    assert.equal(portablePath('/reg/work', '/reg'), 'work')
    assert.equal(portablePath('/reg', '/reg'), '.')
    assert.equal(portablePath(join(process.env.HOME, 'x', 'y'), '/reg'), '~/x/y')
    assert.equal(portablePath('/srv/other', '/reg'), '/srv/other')
  })
})

describe('parseArgs', () => {
  test('--name with --description / --default; --marker stands alone; --cwd-prefix is gone', () => {
    const a = parseArgs(['--name', 'work', '--description', '仕事', '--default'])
    assert.deepEqual(a, { store: null, name: 'work', description: '仕事', makeDefault: true, marker: null })
    assert.deepEqual(parseArgs([]), { store: null, name: null, description: null, makeDefault: false, marker: null })
    assert.equal(parseArgs(['--marker', 'work']).marker, 'work')
    assert.throws(() => parseArgs(['--default']), /need --name/)
    assert.throws(() => parseArgs(['--description', 'x']), /need --name/)
    assert.throws(() => parseArgs(['--cwd-prefix', '/a']), /unknown argument/)
    assert.throws(() => parseArgs(['--marker', 'work', '--name', 'work']), /takes no other flags/)
    assert.throws(() => parseArgs(['--marker', 'bad name']), /store name/)
    assert.throws(() => parseArgs(['--name', 'bad name']), /must match/)
    assert.throws(() => parseArgs(['--what']), /unknown argument/)
  })
})

describe('initNamedStore (temp dir, $WRITEUP_STORES)', () => {
  test('creates the store under the registry dir, registers it with its description, and is idempotent', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-init-'))
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    assert.equal(registryPath(), join(base, 'stores.toml'))

    const log1 = initNamedStore({ name: 'work', description: '仕事' })
    assert.ok(existsSync(join(base, 'work', '.writeup.toml')))
    assert.ok(existsSync(join(base, 'work', '.git')))
    assert.ok(existsSync(join(base, 'stores.toml')))
    assert.ok(log1.some((l) => l.includes('registered store "work"')), log1.join('\n'))
    assert.ok(log1.some((l) => l.includes('no default yet')))

    const log2 = initNamedStore({ name: 'private', description: '個人', makeDefault: true })
    assert.ok(existsSync(join(base, 'private', '.writeup.toml')))
    assert.ok(!log2.some((l) => l.includes('no default yet')))

    const before = readFileSync(join(base, 'stores.toml'), 'utf8')
    const log3 = initNamedStore({ name: 'work', description: '仕事' })
    assert.equal(readFileSync(join(base, 'stores.toml'), 'utf8'), before)
    assert.ok(log3.some((l) => l.includes('already registered')))
    assert.equal((before.match(/\[\[store\]\]/g) || []).length, 2)
    assert.doesNotMatch(before, /cwd_prefixes/)
    assert.deepEqual(registeredNames(join(base, 'stores.toml')), ['work', 'private'])

    // The kit resolves the same registry the same way: default, no cwd mapping.
    const { listStores, resolveStoreDir } = await import(KIT_STORE)
    assert.deepEqual(listStores().map((s) => [s.name, s.path, s.isDefault, s.description]), [
      ['work', join(base, 'work'), false, '仕事'],
      ['private', join(base, 'private'), true, '個人'],
    ])
    assert.equal(resolveStoreDir(null, { cwd: base }), join(base, 'private'))
  })

  test('--store places a named store elsewhere and records an absolute/portable path', () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-init-'))
    const elsewhere = mkdtempSync(join(tmpdir(), 'wu-elsewhere-'))
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    initNamedStore({ name: 'work', store: elsewhere })
    assert.ok(existsSync(join(elsewhere, '.writeup.toml')))
    assert.match(readFileSync(join(base, 'stores.toml'), 'utf8'), new RegExp(`path = "${elsewhere.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  })

  test('registerStoreInFile creates the registry file only when needed', () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-init-'))
    const file = join(base, 'nested', 'stores.toml')
    registerStoreInFile(file, { name: 'a', storePath: join(base, 'nested', 'a') })
    assert.equal(readFileSync(file, 'utf8'), '[[store]]\nname = "a"\npath = "a"\n')
  })
})

describe('--marker (repository marker)', () => {
  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'wu-marker-'))
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    writeFileSync(join(base, 'stores.toml'), 'default = "private"\n\n[[store]]\nname = "work"\npath = "work"\n\n[[store]]\nname = "private"\npath = "private"\n')
    for (const n of ['work', 'private']) {
      mkdirSync(join(base, n), { recursive: true })
      writeFileSync(join(base, n, '.writeup.toml'), '[private]\nwords = []\n')
    }
    const repo = join(base, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(repo, 'src', 'pkg'), { recursive: true })
    return { base, repo }
  }

  test('writes <repo root>/.writeup naming the store, from any subdirectory, idempotently', async () => {
    const { base, repo } = fixture()
    assert.equal(findRepoRoot(join(repo, 'src', 'pkg')), repo)
    assert.equal(markerText('work'), 'store = "work"\n')
    const log1 = writeRepoMarker('work', { cwd: join(repo, 'src', 'pkg') })
    assert.equal(readFileSync(join(repo, REPO_MARKER), 'utf8'), 'store = "work"\n')
    assert.ok(log1.some((l) => l.includes('wrote') && l.includes('by name')), log1.join('\n'))
    const log2 = writeRepoMarker('work', { cwd: repo })
    assert.ok(log2.some((l) => l.includes('already names "work"')))
    const log3 = writeRepoMarker('private', { cwd: repo })
    assert.ok(log3.some((l) => l.includes('rewrote') && l.includes('was: store = "work"')))
    assert.equal(readFileSync(join(repo, REPO_MARKER), 'utf8'), 'store = "private"\n')

    // The kit honours the marker: it beats the registry default.
    const { resolveStoreDir, explainStoreDir } = await import(KIT_STORE)
    writeRepoMarker('work', { cwd: repo })
    assert.equal(resolveStoreDir(null, { cwd: join(repo, 'src', 'pkg') }), join(base, 'work'))
    assert.equal(explainStoreDir(null, { cwd: repo }).via, 'marker')
    assert.equal(resolveStoreDir(null, { cwd: base }), join(base, 'private'))
  })

  test('refuses an unregistered name and a directory outside any repository', () => {
    const { base, repo } = fixture()
    assert.throws(() => writeRepoMarker('archive', { cwd: repo }), /not a registered store/)
    assert.ok(!existsSync(join(repo, REPO_MARKER)))
    mkdirSync(join(base, 'loose'), { recursive: true })
    assert.throws(() => writeRepoMarker('work', { cwd: join(base, 'loose') }), /not inside a git repository/)
  })
})

describe('legacy single store (no flags)', () => {
  test('initStore on $WRITEUP_STORE leaves the registry untouched', () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-legacy-'))
    const legacy = join(base, 'writeup')
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    process.env.WRITEUP_STORE = legacy
    initStore(legacy)
    assert.ok(existsSync(join(legacy, '.writeup.toml')))
    assert.ok(!existsSync(join(base, 'stores.toml')))
    // Running again is a no-op on the store's own files.
    const toml = readFileSync(join(legacy, '.writeup.toml'), 'utf8')
    writeFileSync(join(legacy, '.writeup.toml'), toml + '# keep\n')
    initStore(legacy)
    assert.equal(readFileSync(join(legacy, '.writeup.toml'), 'utf8'), toml + '# keep\n')
  })
})
