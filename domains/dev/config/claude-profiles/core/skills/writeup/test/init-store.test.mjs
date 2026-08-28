// init-store.test.mjs — registry registration is idempotent, `--name`
// creates + registers a store, and the flag-less legacy run never touches
// the registry. Uses a temp dir and $WRITEUP_STORES / $WRITEUP_STORE.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerStore, registerStoreInFile, initNamedStore, initStore, parseArgs, portablePath, registryPath } from '../scripts/init-store.mjs'

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

  test('creates an entry, relative path under the registry dir, portable prefixes', () => {
    const { text, changes } = registerStore('', { name: 'work', storePath: '/reg/work', cwdPrefixes: ['~/go/github.com/example-org'], registryDir })
    assert.equal(text, '[[store]]\nname = "work"\npath = "work"\ncwd_prefixes = ["~/go/github.com/example-org"]\n')
    assert.equal(changes.length, 2)
  })

  test('is idempotent: re-registering adds no second [[store]] and reports it', () => {
    const first = registerStore('', { name: 'work', storePath: '/reg/work', registryDir }).text
    const second = registerStore(first, { name: 'work', storePath: '/reg/work', registryDir })
    assert.equal(second.text, first)
    assert.deepEqual(second.changes, ['store "work" already registered — left as is'])
    assert.equal((second.text.match(/\[\[store\]\]/g) || []).length, 1)
  })

  test('merges cwd_prefixes without duplicates and keeps other entries', () => {
    let text = registerStore('', { name: 'work', storePath: '/reg/work', cwdPrefixes: ['/a'], registryDir }).text
    text = registerStore(text, { name: 'learn', storePath: '/reg/learn', makeDefault: true, registryDir }).text
    const { text: merged, changes } = registerStore(text, { name: 'work', storePath: '/reg/work', cwdPrefixes: ['/a', '/b'], registryDir })
    assert.match(merged, /cwd_prefixes = \["\/a", "\/b"\]/)
    assert.ok(changes.some((c) => c.includes('/b')))
    assert.equal(registerStore(merged, { name: 'work', storePath: '/reg/work', cwdPrefixes: ['/b'], registryDir }).text, merged)
    assert.ok(merged.startsWith('default = "learn"\n\n'))
    assert.equal((merged.match(/\[\[store\]\]/g) || []).length, 2)
  })

  test('--default replaces an existing default line and never duplicates it', () => {
    let text = registerStore('', { name: 'work', storePath: '/reg/work', makeDefault: true, registryDir }).text
    text = registerStore(text, { name: 'learn', storePath: '/reg/learn', makeDefault: true, registryDir }).text
    assert.equal((text.match(/^default = /gm) || []).length, 1)
    assert.match(text, /^default = "learn"/m)
    assert.equal(registerStore(text, { name: 'learn', storePath: '/reg/learn', makeDefault: true, registryDir }).text, text)
  })

  test('preserves comments and hand-written entries', () => {
    const hand = '# my stores\ndefault = "learn"\n\n[[store]]\nname = "learn"\npath = "learn"\n'
    const { text } = registerStore(hand, { name: 'work', storePath: '/reg/work', registryDir })
    assert.ok(text.startsWith('# my stores\ndefault = "learn"\n\n[[store]]\nname = "learn"'))
    assert.match(text, /\[\[store\]\]\nname = "work"\npath = "work"\n$/)
  })

  test('the emitted registry parses with the kit\'s toml-lite and store.mjs', async () => {
    const { parseToml } = await import(KIT_TOML)
    let text = registerStore('', { name: 'work', storePath: '/reg/work', cwdPrefixes: ['/a b', '~/c'], registryDir }).text
    text = registerStore(text, { name: 'learn', storePath: '/reg/learn', makeDefault: true, registryDir }).text
    const cfg = parseToml(text)
    assert.equal(cfg.default, 'learn')
    assert.deepEqual(cfg.store.map((s) => s.name), ['work', 'learn'])
    assert.deepEqual(cfg.store[0].cwd_prefixes, ['/a b', '~/c'])
  })

  test('portablePath: relative under the registry, ~ under home, absolute elsewhere', () => {
    assert.equal(portablePath('/reg/work', '/reg'), 'work')
    assert.equal(portablePath('/reg', '/reg'), '.')
    assert.equal(portablePath(join(process.env.HOME, 'x', 'y'), '/reg'), '~/x/y')
    assert.equal(portablePath('/srv/other', '/reg'), '/srv/other')
  })
})

describe('parseArgs', () => {
  test('collects repeated --cwd-prefix and validates flag combinations', () => {
    const a = parseArgs(['--name', 'work', '--cwd-prefix', '/a', '--cwd-prefix', '/b', '--default'])
    assert.deepEqual(a, { store: null, name: 'work', cwdPrefixes: ['/a', '/b'], makeDefault: true })
    assert.deepEqual(parseArgs([]), { store: null, name: null, cwdPrefixes: [], makeDefault: false })
    assert.throws(() => parseArgs(['--default']), /need --name/)
    assert.throws(() => parseArgs(['--cwd-prefix', '/a']), /need --name/)
    assert.throws(() => parseArgs(['--name', 'bad name']), /must match/)
    assert.throws(() => parseArgs(['--what']), /unknown argument/)
  })
})

describe('initNamedStore (temp dir, $WRITEUP_STORES)', () => {
  test('creates the store under the registry dir, registers it, and is idempotent', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-init-'))
    process.env.WRITEUP_STORES = join(base, 'stores.toml')
    assert.equal(registryPath(), join(base, 'stores.toml'))

    const log1 = initNamedStore({ name: 'work', cwdPrefixes: ['/repos/example-org'] })
    assert.ok(existsSync(join(base, 'work', '.writeup.toml')))
    assert.ok(existsSync(join(base, 'work', '.git')))
    assert.ok(existsSync(join(base, 'stores.toml')))
    assert.ok(log1.some((l) => l.includes('registered store "work"')), log1.join('\n'))
    assert.ok(log1.some((l) => l.includes('no default yet')))

    const log2 = initNamedStore({ name: 'learn', makeDefault: true })
    assert.ok(existsSync(join(base, 'learn', '.writeup.toml')))
    assert.ok(!log2.some((l) => l.includes('no default yet')))

    const before = readFileSync(join(base, 'stores.toml'), 'utf8')
    const log3 = initNamedStore({ name: 'work', cwdPrefixes: ['/repos/example-org'] })
    assert.equal(readFileSync(join(base, 'stores.toml'), 'utf8'), before)
    assert.ok(log3.some((l) => l.includes('already registered')))
    assert.equal((before.match(/\[\[store\]\]/g) || []).length, 2)

    // The kit resolves the same registry the same way.
    const { listStores, resolveStoreDir } = await import(KIT_STORE)
    assert.deepEqual(listStores().map((s) => [s.name, s.path, s.isDefault]), [
      ['work', join(base, 'work'), false],
      ['learn', join(base, 'learn'), true],
    ])
    assert.equal(resolveStoreDir(null, { cwd: '/repos/example-org/svc' }), join(base, 'work'))
    assert.equal(resolveStoreDir(null, { cwd: base }), join(base, 'learn'))
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
