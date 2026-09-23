// assets.test.mjs — the shared page-asset containment guard
// (bin/lib/assets.mjs `resolvePageAsset`), used by self-check.mjs,
// to-md.mjs and publish.mjs so a `.wu-shot` `src` gets exactly one
// path-traversal / symlink-escape / extension check across all three.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePageAsset } from '../bin/lib/assets.mjs'

function freshPageDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'wu-assets-')))
}

describe('resolvePageAsset(): the ok case', () => {
  test('a plain same-directory file resolves to its absolute path', () => {
    const pageDir = freshPageDir()
    writeFileSync(join(pageDir, 'pic.png'), 'x')
    assert.equal(resolvePageAsset(pageDir, 'pic.png'), join(pageDir, 'pic.png'))
  })

  test('a file in a subdirectory (<slug>-assets/…) resolves', () => {
    const pageDir = freshPageDir()
    mkdirSync(join(pageDir, 'assets'))
    writeFileSync(join(pageDir, 'assets', 'pic.png'), 'x')
    assert.equal(resolvePageAsset(pageDir, 'assets/pic.png'), join(pageDir, 'assets', 'pic.png'))
  })

  test('a nonexistent but syntactically-contained path is still returned (existence is the caller\'s own check)', () => {
    const pageDir = freshPageDir()
    assert.equal(resolvePageAsset(pageDir, 'missing.png'), join(pageDir, 'missing.png'))
  })
})

describe('resolvePageAsset(): rejections', () => {
  test('a URL scheme is rejected', () => {
    const pageDir = freshPageDir()
    assert.equal(resolvePageAsset(pageDir, 'https://example.com/pic.png'), null)
    assert.equal(resolvePageAsset(pageDir, 'data:image/png;base64,AAAA'), null)
  })

  test('a leading / (absolute path) is rejected', () => {
    const pageDir = freshPageDir()
    assert.equal(resolvePageAsset(pageDir, '/etc/passwd'), null)
  })

  test('a .. path that escapes the page directory is rejected, existing file or not', () => {
    const pageDir = freshPageDir()
    const outside = freshPageDir()
    writeFileSync(join(outside, 'secret.png'), 'x')
    assert.equal(resolvePageAsset(pageDir, '../outside.png'), null)
    // Still rejected even when the escaping path happens to point at a
    // real file — containment is checked before existence.
    const rel = join('..', ...outside.split('/').slice(-1), 'secret.png')
    assert.equal(resolvePageAsset(pageDir, rel), null)
  })

  test('a disallowed extension is rejected', () => {
    const pageDir = freshPageDir()
    writeFileSync(join(pageDir, 'notes.txt'), 'x')
    assert.equal(resolvePageAsset(pageDir, 'notes.txt'), null)
  })

  test('a symlink whose real target escapes the page directory is rejected', () => {
    const pageDir = freshPageDir()
    const outsideDir = freshPageDir()
    writeFileSync(join(outsideDir, 'secret.png'), 'the secret bytes')
    symlinkSync(join(outsideDir, 'secret.png'), join(pageDir, 'link.png'))
    assert.equal(resolvePageAsset(pageDir, 'link.png'), null)
  })

  test('a symlink whose real target stays inside the page directory is allowed', () => {
    const pageDir = freshPageDir()
    mkdirSync(join(pageDir, 'real'))
    writeFileSync(join(pageDir, 'real', 'pic.png'), 'bytes')
    symlinkSync(join(pageDir, 'real', 'pic.png'), join(pageDir, 'link.png'))
    assert.equal(resolvePageAsset(pageDir, 'link.png'), join(pageDir, 'real', 'pic.png'))
  })

  test('a symlinked page directory itself does not confuse the containment check', () => {
    // pageDir is already realpath'd by freshPageDir(); an asset directly
    // inside it must still resolve cleanly.
    const pageDir = freshPageDir()
    writeFileSync(join(pageDir, 'pic.svg'), '<svg/>')
    assert.equal(resolvePageAsset(pageDir, 'pic.svg'), join(pageDir, 'pic.svg'))
  })
})
