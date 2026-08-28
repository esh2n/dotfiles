import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { startServer } from '../bin/serve.mjs'
import { buildStore } from '../bin/build.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURE_STORE = join(ROOT, 'test', 'fixtures', 'store')

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wu-serve-'))
  cpSync(FIXTURE_STORE, dir, { recursive: true })
  return dir
}

function get(url, { followRedirects = false } = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject)
  })
}

const servers = []
after(async () => {
  await Promise.all(servers.map((s) => s.stop()))
})

async function serveFreshStore() {
  const store = freshStore()
  const { records } = buildStore(store)
  const server = await startServer(store, { fallbackToFreePort: true })
  servers.push(server)
  return { store, records, server }
}

describe('serve: /id/<id> route', () => {
  test('redirects (302) to the page path for a known id', async () => {
    const { records, server } = await serveFreshStore()
    const decision = records.find((r) => r.path.startsWith('decision/'))
    const res = await get(server.url + 'id/' + decision.id)
    assert.equal(res.status, 302)
    assert.equal(res.headers.location, '/' + decision.path)
  })

  test('a subsequent GET of the redirect target serves the actual page', async () => {
    const { records, server } = await serveFreshStore()
    const design = records.find((r) => r.path.startsWith('design/'))
    const redirect = await get(server.url + 'id/' + design.id)
    assert.equal(redirect.status, 302)
    const page = await get(server.url + redirect.headers.location.replace(/^\//, ''))
    assert.equal(page.status, 200)
    assert.match(page.body, /アップロード経路の設計/)
  })

  test('404s for an id not present in manifest.json', async () => {
    const { server } = await serveFreshStore()
    const res = await get(server.url + 'id/00000000')
    assert.equal(res.status, 404)
  })

  test('404s (not a traversal/500) when manifest.json does not exist yet', async () => {
    const store = freshStore() // no buildStore() call: no manifest.json
    const server = await startServer(store, { fallbackToFreePort: true })
    servers.push(server)
    const res = await get(server.url + 'id/deadbeef')
    assert.equal(res.status, 404)
  })

  test('does not match a non-id path shaped like /id/<not-8-hex>', async () => {
    const { server } = await serveFreshStore()
    const res = await get(server.url + 'id/not-an-id')
    assert.notEqual(res.status, 302)
  })
})
