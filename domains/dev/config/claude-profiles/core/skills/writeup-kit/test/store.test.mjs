// store.test.mjs — the store registry (`stores.toml`), the repository
// marker (`<repo root>/.writeup`), the store resolution order, plus
// serve.mjs's registry helpers (`--list-stores` formatting, single-port
// multi-store routing) and publish's `--store-name`.

import { test, describe, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readRegistry, listStores, resolveStoreByName, resolveStoreDir, explainStoreDir,
  registryPath, defaultStoreBase, expandHome, findRepoRoot, findRepoMarker, parseRepoMarker,
} from '../bin/lib/store.mjs'
import { formatStoreList, parseArgs, mountsFor, routeRequest, startMultiServer, startServer, portForStore } from '../bin/serve.mjs'
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

/** A temp base dir holding a registry with `work` and `private`
 * (default), each an initialised store directory, plus a fake git
 * repository (`repos/some-service`, with a `.git` dir and a `src/`
 * subdir) carrying no marker yet, and an `elsewhere/` dir outside any
 * repository. */
function registryFixture({ withDefault = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'wu-stores-'))
  const repo = join(base, 'repos', 'some-service')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
  mkdirSync(join(base, 'elsewhere'), { recursive: true })
  for (const name of ['work', 'private']) {
    mkdirSync(join(base, name), { recursive: true })
    writeFileSync(join(base, name, '.writeup.toml'), '[private]\nwords = []\n')
  }
  const registry = join(base, 'stores.toml')
  writeFileSync(registry, `${withDefault ? 'default = "private"\n\n' : ''}# registered stores
[[store]]
name = "work"
path = "work"
description = "仕事"

[[store]]
name = "private"
path = "private"
description = "個人"
`)
  process.env.WRITEUP_STORES = registry
  return { base, registry, repo }
}

function marker(repo, name) {
  writeFileSync(join(repo, '.writeup'), `store = "${name}"\n`)
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

  test('[[store]] entries carry name / path / description only; path resolves relative to the registry dir, absolute and ~ pass through', () => {
    const { base } = registryFixture()
    const r = readRegistry()
    assert.equal(r.exists, true)
    assert.equal(r.defaultName, 'private')
    assert.deepEqual(r.stores, [
      { name: 'work', path: join(base, 'work'), isDefault: false, description: '仕事' },
      { name: 'private', path: join(base, 'private'), isDefault: true, description: '個人' },
    ])

    writeFileSync(process.env.WRITEUP_STORES, `[[store]]\nname = "abs"\npath = "/srv/abs"\n[[store]]\nname = "home"\npath = "~/h"\n`)
    const r2 = readRegistry()
    assert.equal(r2.stores[0].path, '/srv/abs')
    assert.equal(r2.stores[0].description, '')
    assert.equal(r2.stores[1].path, expandHome('~/h'))
  })

  test('cwd_prefixes in an old registry are ignored, not mapped', () => {
    const { base } = registryFixture()
    writeFileSync(process.env.WRITEUP_STORES, `default = "private"\n[[store]]\nname = "work"\npath = "work"\ncwd_prefixes = ["${join(base, 'repos')}"]\n[[store]]\nname = "private"\npath = "private"\n`)
    const r = readRegistry()
    assert.ok(!('cwdPrefixes' in r.stores[0]))
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'repos', 'some-service', 'src') }), join(base, 'private'))
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
      { name: 'private', path: join(base, 'private'), isDefault: true },
    ])
    assert.equal(resolveStoreByName('work').path, join(base, 'work'))
    assert.equal(resolveStoreByName('nope'), null)
  })
})

describe('repository marker', () => {
  test('findRepoRoot walks up to the nearest .git (dir or file), null outside a repo', () => {
    const { base, repo } = registryFixture()
    assert.equal(findRepoRoot(join(repo, 'src', 'deep')), repo)
    assert.equal(findRepoRoot(repo), repo)
    const worktree = join(base, 'wt')
    mkdirSync(join(worktree, 'a'), { recursive: true })
    writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere\n')
    assert.equal(findRepoRoot(join(worktree, 'a')), worktree)
    assert.equal(findRepoRoot(join(base, 'elsewhere')), null)
  })

  test('parseRepoMarker reads store = "<name>", tolerates comments, null when nothing is named', () => {
    assert.equal(parseRepoMarker('store = "work"\n'), 'work')
    assert.equal(parseRepoMarker('# which store this repo saves to\nstore = "private"\n'), 'private')
    assert.equal(parseRepoMarker(''), null)
    assert.equal(parseRepoMarker('other = 1\n'), null)
  })

  test('findRepoMarker: the nearest repo\'s .writeup, from any depth; none without a marker or a repo', () => {
    const { base, repo } = registryFixture()
    assert.equal(findRepoMarker(join(repo, 'src', 'deep')), null)
    marker(repo, 'work')
    assert.deepEqual(findRepoMarker(join(repo, 'src', 'deep')), { repoRoot: repo, path: join(repo, '.writeup'), name: 'work' })
    assert.deepEqual(findRepoMarker(repo).name, 'work')
    assert.equal(findRepoMarker(join(base, 'elsewhere')), null)
    // A nested repository does not inherit its parent's marker.
    const nested = join(repo, 'vendor', 'lib')
    mkdirSync(join(nested, '.git'), { recursive: true })
    assert.equal(findRepoMarker(nested), null)
  })
})

describe('resolution order', () => {
  test('explicit dir wins over everything', () => {
    const { repo } = registryFixture()
    marker(repo, 'work')
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir('/explicit', { cwd: repo, name: 'private' }), '/explicit')
    assert.equal(explainStoreDir('/explicit', { cwd: repo }).via, 'explicit')
  })

  test('name beats $WRITEUP_STORE and the marker; an unknown name throws', () => {
    const { base, repo } = registryFixture()
    marker(repo, 'work')
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir(null, { cwd: repo, name: 'private' }), join(base, 'private'))
    assert.equal(explainStoreDir(null, { name: 'private' }).via, 'name')
    assert.throws(() => resolveStoreDir(null, { name: 'nope' }), /unknown store name: nope/)
  })

  test('$WRITEUP_STORE beats ancestor discovery, the marker and default', () => {
    const { base, repo } = registryFixture()
    marker(repo, 'work')
    process.env.WRITEUP_STORE = '/env/store'
    assert.equal(resolveStoreDir(null, { cwd: repo }), '/env/store')
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'work', 'sub') }), '/env/store')
    assert.equal(explainStoreDir(null, { cwd: repo }).via, 'env')
  })

  test('an ancestor .writeup.toml (a page\'s own store) beats the registry', () => {
    const { base } = registryFixture()
    mkdirSync(join(base, 'work', 'topic'), { recursive: true })
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'work', 'topic') }), join(base, 'work'))
    assert.equal(explainStoreDir(null, { cwd: join(base, 'work', 'topic') }).via, 'ancestor')
  })

  test('a repo marker beats the registry default; without one the default wins', () => {
    const { base, repo } = registryFixture()
    const inside = join(repo, 'src', 'deep')
    assert.equal(resolveStoreDir(null, { cwd: inside }), join(base, 'private'))
    assert.deepEqual(explainStoreDir(null, { cwd: inside }), { dir: join(base, 'private'), via: 'default', name: 'private' })
    marker(repo, 'work')
    assert.equal(resolveStoreDir(null, { cwd: inside }), join(base, 'work'))
    assert.equal(resolveStoreDir(null, { cwd: repo }), join(base, 'work'))
    assert.deepEqual(explainStoreDir(null, { cwd: inside }), { dir: join(base, 'work'), via: 'marker', name: 'work', markerPath: join(repo, '.writeup') })
    assert.deepEqual(explainStoreDir(null, { cwd: join(base, 'elsewhere') }), { dir: join(base, 'private'), via: 'default', name: 'private' })
  })

  test('the directory a repo lives under never matters — only its marker does', () => {
    const { base, repo } = registryFixture()
    // A sibling repository next to a marked one is unaffected.
    marker(repo, 'work')
    const sibling = join(base, 'repos', 'other-service')
    mkdirSync(join(sibling, '.git'), { recursive: true })
    assert.equal(resolveStoreDir(null, { cwd: sibling }), join(base, 'private'))
    // A non-repo directory under repos/ is not "in" any repository.
    mkdirSync(join(base, 'repos', 'notes'), { recursive: true })
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'repos', 'notes') }), join(base, 'private'))
  })

  test('a marker naming a store missing from the registry throws (never falls through to default)', () => {
    const { repo } = registryFixture()
    marker(repo, 'archive')
    assert.throws(() => resolveStoreDir(null, { cwd: join(repo, 'src') }), /names unknown store "archive"/)
    assert.throws(() => explainStoreDir(null, { cwd: repo }), /names unknown store "archive"/)
  })

  test('no default in the registry and no marker → legacy single store path', () => {
    const { base } = registryFixture({ withDefault: false })
    assert.equal(resolveStoreDir(null, { cwd: join(base, 'elsewhere') }), defaultStoreBase())
    const via = explainStoreDir(null, { cwd: join(base, 'elsewhere') }).via
    assert.ok(via === 'legacy' || via === 'fallback', via)
  })

  test('no registry at all → legacy single store path (old behaviour), even inside a marked repo', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const cwd = mkdtempSync(join(tmpdir(), 'wu-cwd-'))
    assert.equal(resolveStoreDir(null, { cwd }), defaultStoreBase())
    assert.equal(resolveStoreDir(undefined, { cwd }), defaultStoreBase())
  })
})

describe('serve.mjs registry helpers', () => {
  test('formatStoreList: <mark> <name>\\t<path>\\t<description>\\t<flags>, * on the store the cwd resolves to', () => {
    const { base, repo } = registryFixture()
    marker(repo, 'work')
    const lines = formatStoreList({ cwd: join(repo, 'src') })
    assert.equal(lines.length, 2)
    assert.equal(lines[0], `* work\t${join(base, 'work')}\t仕事`)
    assert.equal(lines[1], `  private\t${join(base, 'private')}\t個人\tdefault`)
    const fromElsewhere = formatStoreList({ cwd: join(base, 'elsewhere') })
    assert.ok(fromElsewhere[0].startsWith('  work'))
    assert.ok(fromElsewhere[1].startsWith('* private'))
    assert.ok(!lines.join('\n').includes('cwd_prefix'))
  })

  test('formatStoreList: an empty description leaves its column empty; a bad marker marks nothing', () => {
    const { base, repo } = registryFixture()
    writeFileSync(process.env.WRITEUP_STORES, `default = "private"\n[[store]]\nname = "work"\npath = "work"\n[[store]]\nname = "private"\npath = "private"\n`)
    assert.deepEqual(formatStoreList({ cwd: join(base, 'elsewhere') }), [`  work\t${join(base, 'work')}`, `* private\t${join(base, 'private')}\t\tdefault`])
    marker(repo, 'archive')
    assert.ok(formatStoreList({ cwd: repo }).every((l) => l.startsWith('  ')))
  })

  test('formatStoreList without a registry lists the single legacy store', () => {
    process.env.WRITEUP_STORES = join(tmpdir(), 'wu-nope', 'stores.toml')
    const lines = formatStoreList({ cwd: tmpdir() })
    assert.equal(lines.length, 1)
    assert.ok(lines[0].startsWith(`* legacy\t${defaultStoreBase()}\t(no registry:`), lines[0])
  })

  test('parseArgs accepts --store-name and --list-stores, rejects --all and mixing store flags', () => {
    assert.equal(parseArgs(['--store-name', 'work']).storeName, 'work')
    assert.equal(parseArgs(['--list-stores']).listStores, true)
    assert.equal(parseArgs(['--no-open', '--no-build']).build, false)
    assert.throws(() => parseArgs(['--all']), /unknown argument/)
    assert.throws(() => parseArgs(['--store-name', 'a', '--store', '/x']), /mutually exclusive/)
    assert.throws(() => parseArgs(['--bogus']), /unknown argument/)
  })
})

describe('single-port routing (pure)', () => {
  const stores = [{ name: 'work', path: '/s/work', isDefault: false }, { name: 'private', path: '/s/private', isDefault: true }]
  const mounts = mountsFor(stores)

  test('mountsFor: /<name> prefixes; the registry default, else the first store, is the default mount', () => {
    assert.deepEqual(mounts.map((m) => [m.name, m.prefix, m.dir, m.isDefault]), [['work', '/work', '/s/work', false], ['private', '/private', '/s/private', true]])
    const noDefault = mountsFor(stores.map((s) => ({ ...s, isDefault: false })))
    assert.equal(noDefault[0].isDefault, true)
  })

  test('/ redirects to the default store index; /<name> to /<name>/', () => {
    assert.deepEqual(routeRequest('/', mounts), { kind: 'redirect', location: '/private/' })
    assert.deepEqual(routeRequest('/work', mounts), { kind: 'redirect', location: '/work/' })
  })

  test('/<name>/… lands in that store; /id/ searches every store; /<name>/id/ one store', () => {
    const r = routeRequest('/work/decision/x.html', mounts)
    assert.equal(r.kind, 'file'); assert.equal(r.mount.name, 'work'); assert.equal(r.rest, '/decision/x.html')
    assert.equal(routeRequest('/private/', mounts).rest, '/')
    assert.deepEqual(routeRequest('/id/0123abcd', mounts), { kind: 'id', id: '0123abcd', mount: null })
    const one = routeRequest('/work/id/0123abcd', mounts)
    assert.equal(one.kind, 'id'); assert.equal(one.mount.name, 'work')
    assert.equal(routeRequest('/workshop/x.html', mounts).kind, 'unknown')
    assert.equal(routeRequest('/nope/', mounts).kind, 'unknown')
  })

  test('single-store mode (empty prefix) keeps the old root routing', () => {
    const single = [{ name: null, prefix: '', dir: '/s', isDefault: true }]
    assert.deepEqual(routeRequest('/', single), { kind: 'file', mount: single[0], rest: '/' })
    assert.equal(routeRequest('/id/0123abcd', single).kind, 'id')
    assert.equal(routeRequest('/work/x.html', single).rest, '/work/x.html')
  })
})

describe('startMultiServer: every store on one port', () => {
  const started = []
  after(async () => { await Promise.all(started.map((s) => s.stop())) })

  async function viewer() {
    const { base, registry } = registryFixture()
    const stores = []
    for (const name of ['work', 'private']) {
      const dir = join(base, name)
      cpSync(FIXTURE_STORE, dir, { recursive: true })
      stores.push({ name, path: dir, isDefault: name === 'private', records: buildStore(dir).records })
    }
    const server = await startMultiServer(stores, { portKey: registry, fallbackToFreePort: true })
    started.push(server)
    return { base, registry, stores, server }
  }

  async function get(url) {
    const res = await fetch(url, { redirect: 'manual' })
    return { status: res.status, location: res.headers.get('location'), body: await res.text() }
  }

  test('serves /work/ and /private/ from one port, / redirects to the default store', async () => {
    const { server } = await viewer()
    const root = await get(server.url)
    assert.equal(root.status, 302)
    assert.equal(root.location, '/private/')
    for (const name of ['work', 'private']) {
      const res = await get(`${server.url}${name}/`)
      assert.equal(res.status, 200)
      assert.match(res.body, new RegExp(`writeup store · ${name}`))
      assert.match(res.body, new RegExp(`<a href="\\.\\./${name}/index\\.html" aria-current="page"`))
    }
    assert.equal((await get(`${server.url}work`)).location, '/work/')
  })

  test('pages and kit css resolve inside their store prefix', async () => {
    const { stores, server } = await viewer()
    const page = stores[0].records.find((r) => r.path === 'decision/2026-08-01-example-decision.html')
    const res = await get(`${server.url}work/${page.path}`)
    assert.equal(res.status, 200)
    assert.match(res.body, /<html/)
    assert.equal((await get(`${server.url}work/_kit/writeup.css`)).status, 200)
    assert.equal((await get(`${server.url}private/_kit/writeup.css`)).status, 200)
  })

  test('/id/<id> finds the page in whichever store has it; /<name>/id/<id> only in that store', async () => {
    const { base, stores, server } = await viewer()
    // Give `private` a page `work` lacks, so the id is unique to one store.
    mkdirSync(join(base, 'private', 'note'), { recursive: true })
    const src = readFileSync(join(base, 'private', 'decision', '2026-08-01-example-decision.html'), 'utf8')
    writeFileSync(join(base, 'private', 'note', '2026-08-02-only-here.html'), src.replace(/<meta name="id" content="[0-9a-f]{8}">/, ''))
    const records = buildStore(join(base, 'private')).records
    const only = records.find((r) => r.path === 'note/2026-08-02-only-here.html')
    assert.ok(only)
    assert.equal((await get(`${server.url}id/${only.id}`)).location, `/private/${only.path}`)
    assert.equal((await get(`${server.url}private/id/${only.id}`)).location, `/private/${only.path}`)
    assert.equal((await get(`${server.url}work/id/${only.id}`)).status, 404)
    // An id present in both stores (same fixture) resolves to the first store in registry order.
    const shared = stores[0].records[0]
    assert.equal((await get(`${server.url}id/${shared.id}`)).location, `/work/${shared.path}`)
    assert.equal((await get(`${server.url}id/deadbeef`)).status, 404)
  })

  test('404 inside a store links back into that store; an unknown prefix searches every store', async () => {
    const { server } = await viewer()
    const inStore = await get(`${server.url}work/totally-unknown-xyz.html`)
    assert.equal(inStore.status, 404)
    assert.match(inStore.body, /class="wu-back" href="\/work\/"/)
    assert.match(inStore.body, /href="\/work\/_kit\/writeup\.css"/)
    assert.match(inStore.body, /href="\/work\/\?q=totally-unknown-xyz"/)
    const unique = await get(`${server.url}work/legacy-note.html`)
    assert.equal(unique.status, 302)
    assert.match(unique.location, /^\/work\/legacy\//)
    const across = await get(`${server.url}nope/legacy-note.html`)
    assert.equal(across.status, 404)
    assert.match(across.body, /href="\/work\/legacy\//)
    assert.match(across.body, /href="\/private\/legacy\//)
    assert.match(across.body, /&middot; work &middot;/)
  })

  test('the viewer port is derived from the registry path, and startServer still serves one store at the root', async () => {
    const { base, registry, stores, server } = await viewer()
    assert.ok(server.port === portForStore(registry) || server.port > 0)
    const single = await startServer(stores[0].path, { fallbackToFreePort: true })
    started.push(single)
    const res = await get(single.url)
    assert.equal(res.status, 200)
    assert.match(res.body, /writeup store · work/)
    assert.ok(existsSync(join(base, 'work', 'index.html')))
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
