// store.test.mjs — the store registry (`stores.toml`) and the store
// resolution order, plus serve.mjs's multi-store helpers (`--all` port
// planning, `--list-stores` formatting) and publish's `--store-name`.

import { test, describe, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readRegistry, listStores, resolveStoreByName, resolveStoreByCwd, resolveStoreDir,
  explainStoreDir, registryPath, defaultStoreBase, expandHome,
} from '../bin/lib/store.mjs'
import { planAllPorts, formatStoreList, parseArgs, startAll, portForStore } from '../bin/serve.mjs'
import { publish } from '../bin/publish.mjs'
import { buildStore } from '../bin/build.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')
const DECISION_REL = join('decision', '2026-08-01-example-decision.html')

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

/** A temp base dir holding a registry with `work` (cwd-prefixed) and
 * `learn` (default), each an initialised store directory. */
function registryFixture({ withDefault = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'wu-stores-'))
  const repos = join(base, 'repos', 'example-org')
  mkdirSync(join(repos, 'some-service', 'src'), { recursive: true })
  mkdirSync(join(base, 'elsewhere'), { recursive: true })
  for (const name of ['work', 'learn']) {
    mkdirSync(join(base, name), { recursive: true })
    writeFileSync(join(base, name, '.writeup.toml'), '[private]\nwords = []\n')
  }
  const registry = join(base, 'stores.toml')
  writeFileSync(registry, `${withDefault ? 'default = "learn"\n\n' : ''}# registered stores
[[store]]
name = "work"
path = "work"
cwd_prefixes = ["${repos}"]

[[store]]
name = "learn"
path = "learn"
`)
  process.env.WRITEUP_STORES = registry
  return { base, registry, repos }
}

describe('registry parsing', () => {
  test('registryPath honours $WRITEUP_STORES, else <default base>/stores.toml', () => {
    assert.equal(registryPath(), join(defaultStoreBase(), 'stores.toml'))
    process.env.WRITEUP_STORES = '/tmp/x/stores.toml'
    assert.equal(registryPath(), '/tmp/x/stores.toml')
  })

  test('a missing registry reads as exists:false with no stores', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const r = readRegistry()
    assert.equal(r.exists, false)
    assert.deepEqual(r.stores, [])
    assert.deepEqual(listStores(), [])
    assert.equal(resolveStoreByName('work'), null)
  })

  test('[[store]] entries resolve path relative to the registry dir, absolute and ~ pass through', () => {
    const { base, repos } = registryFixture()
    const r = readRegistry()
    assert.equal(r.exists, true)
    assert.equal(r.defaultName, 'learn')
    assert.deepEqual(r.stores.map((s) => s.name), ['work', 'learn'])
    assert.equal(r.stores[0].path, join(base, 'work'))
    assert.deepEqual(r.stores[0].cwdPrefixes, [repos])
    assert.equal(r.stores[0].isDefault, false)
    assert.equal(r.stores[1].isDefault, true)

    writeFileSync(process.env.WRITEUP_STORES, `[[store]]\nname = "abs"\npath = "/srv/abs"\n[[store]]\nname = "home"\npath = "~/h"\ncwd_prefixes = ["~/p"]\n`)
    const r2 = readRegistry()
    assert.equal(r2.stores[0].path, '/srv/abs')
    assert.equal(r2.stores[1].path, expandHome('~/h'))
    assert.deepEqual(r2.stores[1].cwdPrefixes, [expandHome('~/p')])
  })

  test('entries without a name are skipped and a duplicate name keeps the first', () => {
    registryFixture()
    writeFileSync(process.env.WRITEUP_STORES, `[[store]]\npath = "x"\n[[store]]\nname = "a"\npath = "a1"\n[[store]]\nname = "a"\npath = "a2"\n`)
    const r = readRegistry()
    assert.equal(r.stores.length, 1)
    assert.match(r.stores[0].path, /a1$/)
  })

  test('a malformed registry throws instead of reading as empty', () => {
    registryFixture()
    writeFileSync(process.env.WRITEUP_STORES, '[[store]]\nname = { broken = true }\n')
    assert.throws(() => readRegistry())
  })

  test('listStores / resolveStoreByName', () => {
    const { base } = registryFixture()
    assert.deepEqual(listStores().map(({ name, path, isDefault }) => ({ name, path, isDefault })), [
      { name: 'work', path: join(base, 'work'), isDefault: false },
      { name: 'learn', path: join(base, 'learn'), isDefault: true },
    ])
    assert.equal(resolveStoreByName('work').path, join(base, 'work'))
    assert.equal(resolveStoreByName('nope'), null)
  })
})

describe('resolution order', () => {
  test('explicit dir wins over everything', () => {
    const { repos } = registryFixture()
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir('/explicit', { cwd: repos, name: 'learn' }), '/explicit')
    assert.equal(explainStoreDir('/explicit', { cwd: repos }).via, 'explicit')
  })

  test('name beats $WRITEUP_STORE and cwd; an unknown name throws', () => {
    const { base, repos } = registryFixture()
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir(null, { cwd: repos, name: 'learn' }), join(base, 'learn'))
    assert.equal(explainStoreDir(null, { name: 'learn' }).via, 'name')
    assert.throws(() => resolveStoreDir(null, { name: 'nope' }), /unknown store name: nope/)
  })

  test('$WRITEUP_STORE beats ancestor discovery, cwd prefixes and default', () => {
    const { base, repos } = registryFixture()
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir(null, { cwd: repos }), '/env/store')
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'work', 'sub') }), '/env/store')
    assert.equal(explainStoreDir(null, { cwd: repos }).via, 'env')
  })

  test('an ancestor .writeup.toml beats the registry', () => {
    const { base } = registryFixture()
    mkdirSync(join(base, 'work', 'topic'), { recursive: true })
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'work', 'topic') }), join(base, 'work'))
    assert.equal(explainStoreDir(null, { cwd: join(base, 'work', 'topic') }).via, 'ancestor')
  })

  test('a cwd under a cwd_prefix picks that store; otherwise the default', () => {
    const { base, repos } = registryFixture()
    const inside = join(repos, 'some-service', 'src')
    assert.equal(resolveStoreDir(null, { cwd: inside }), join(base, 'work'))
    assert.equal(resolveStoreDir(null, { cwd: repos }), join(base, 'work'))
    assert.deepEqual(explainStoreDir(null, { cwd: inside }), { dir: join(base, 'work'), via: 'cwd_prefix', name: 'work' })
    // A sibling whose name merely starts with the prefix string is not "under" it.
    mkdirSync(repos + '-other', { recursive: true })
    assert.equal(resolveStoreDir(null, { cwd: repos + '-other' }), join(base, 'learn'))
    assert.deepEqual(explainStoreDir(null, { cwd: join(base, 'elsewhere') }), { dir: join(base, 'learn'), via: 'default', name: 'learn' })
  })

  test('the longest matching cwd_prefix wins', () => {
    const { base, repos } = registryFixture()
    writeFileSync(process.env.WRITEUP_STORES, `[[store]]\nname = "work"\npath = "work"\ncwd_prefixes = ["${dirname(repos)}"]\n[[store]]\nname = "learn"\npath = "learn"\ncwd_prefixes = ["${repos}"]\n`)
    assert.equal(resolveStoreByCwd(join(repos, 'x')).name, 'learn')
    assert.equal(resolveStoreByCwd(join(dirname(repos), 'other')).name, 'work')
    assert.equal(resolveStoreDir(null, { cwd: join(repos, 'x') }), join(base, 'learn'))
  })

  test('no default in the registry and no match → legacy single store path', () => {
    const { base } = registryFixture({ withDefault: false })
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'elsewhere') }), defaultStoreBase())
    const via = explainStoreDir(null, { cwd: join(base, 'elsewhere') }).via
    assert.ok(via === 'legacy' || via === 'fallback', via)
  })

  test('no registry at all → legacy single store path (old behaviour)', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const cwd = mkdtempSync(join(tmpdir(), 'wu-cwd-'))
    assert.equal(resolveStoreDir(null, { cwd }), defaultStoreBase())
    assert.equal(resolveStoreDir(undefined, { cwd }), defaultStoreBase())
  })
})

describe('serve.mjs multi-store helpers', () => {
  test('planAllPorts assigns consecutive ports from the first store\'s port', () => {
    const stores = [{ name: 'work', path: '/s/work' }, { name: 'learn', path: '/s/learn' }, { name: 'x', path: '/s/x' }]
    const plan = planAllPorts(stores)
    const base = portForStore('/s/work')
    assert.deepEqual(plan.map((p) => p.port), [base, base + 1, base + 2])
    assert.deepEqual(plan.map((p) => p.name), ['work', 'learn', 'x'])
    assert.deepEqual(planAllPorts(stores, 45000).map((p) => p.port), [45000, 45001, 45002])
    assert.deepEqual(planAllPorts([], 45000), [])
  })

  test('planAllPorts wraps inside the deterministic port range', () => {
    const stores = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }]
    assert.deepEqual(planAllPorts(stores, 49999).map((p) => p.port), [49999, 40000])
  })

  test('formatStoreList marks the store the cwd resolves to', () => {
    const { base, repos } = registryFixture()
    const lines = formatStoreList({ cwd: repos })
    assert.equal(lines.length, 2)
    assert.equal(lines[0], `* work\t${join(base, 'work')}\tcwd_prefixes=${repos}`)
    assert.equal(lines[1], `  learn\t${join(base, 'learn')}\tdefault`)
    const fromElsewhere = formatStoreList({ cwd: join(base, 'elsewhere') })
    assert.ok(fromElsewhere[0].startsWith('  work'))
    assert.ok(fromElsewhere[1].startsWith('* learn'))
  })

  test('formatStoreList without a registry lists the single legacy store', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const lines = formatStoreList({ cwd: tmpdir() })
    assert.equal(lines.length, 1)
    assert.ok(lines[0].startsWith(`* legacy\t${defaultStoreBase()}\t(no registry:`), lines[0])
  })

  test('parseArgs accepts --store-name, --all, --list-stores and rejects mixing them', () => {
    assert.equal(parseArgs(['--store-name', 'work']).storeName, 'work')
    assert.equal(parseArgs(['--all', '--no-open']).all, true)
    assert.equal(parseArgs(['--list-stores']).listStores, true)
    assert.throws(() => parseArgs(['--store', '/x', '--all']), /mutually exclusive/)
    assert.throws(() => parseArgs(['--store-name', 'a', '--store', '/x']), /mutually exclusive/)
    assert.throws(() => parseArgs(['--bogus']), /unknown argument/)
  })
})

describe('startAll', () => {
  const started = []
  after(async () => { await Promise.all(started.map((s) => s.stop())) })

  test('starts one listener per store and each serves its own index', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wu-all-'))
    const stores = []
    for (const name of ['work', 'learn']) {
      const dir = join(base, name)
      cpSync(FIXTURE_STORE, dir, { recursive: true })
      buildStore(dir)
      stores.push({ name, path: dir })
    }
    const servers = await startAll(stores, { fallbackToFreePort: true })
    started.push(...servers)
    assert.equal(servers.length, 2)
    assert.deepEqual(servers.map((s) => s.name), ['work', 'learn'])
    assert.notEqual(servers[0].port, servers[1].port)
    for (const s of servers) {
      const res = await fetch(s.url)
      assert.equal(res.status, 200)
      assert.match(await res.text(), /<html/)
    }
  })
})

describe('publish --store-name', () => {
  test('resolves the store through the registry', () => {
    const { base } = registryFixture()
    cpSync(FIXTURE_STORE, join(base, 'work'), { recursive: true })
    buildStore(join(base, 'work'))
    const page = join(base, 'work', DECISION_REL)
    const result = publish(page, { to: 'artifact', storeName: 'work' })
    assert.equal(result.output, join(base, 'work', '.publish', '2026-08-01-example-decision.artifact.html'))
    assert.ok(existsSync(result.output))
    assert.throws(() => publish(page, { to: 'artifact', storeName: 'nope' }), /unknown store name/)
  })

  test('without --store, the page\'s own ancestor store is used (its private words apply)', () => {
    const { base } = registryFixture()
    cpSync(FIXTURE_STORE, join(base, 'work'), { recursive: true })
    buildStore(join(base, 'work'))
    const page = join(base, 'work', DECISION_REL)
    const title = /<title>([^<]*)<\/title>/.exec(readFileSync(page, 'utf8'))[1].trim()
    writeFileSync(join(base, 'work', '.writeup.toml'), `[private]\nwords = ["${title}"]\n`)
    assert.throws(() => publish(page, { to: 'artifact' }), (e) => e.code === 4)
  })
})
