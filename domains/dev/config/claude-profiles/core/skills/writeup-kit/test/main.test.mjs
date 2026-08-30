// main.test.mjs — the entry guard (bin/lib/main.mjs) has to keep working
// when the kit is reached through a symlink, because that's how it's
// normally invoked: `~/.claude/skills/writeup-kit` symlinks into this repo.
// `process.argv[1]` keeps the symlinked path Node was told to run while
// `import.meta.url` resolves to the realpath, so a naive string comparison
// never matches through the symlink and the CLI silently exits 0 having
// done nothing. These tests spawn a CLI through a symlinked `bin` directory
// and assert it still ran.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from '../bin/lib/main.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const REAL_BIN = join(ROOT, 'bin')

// Symlink the whole `bin` directory into a scratch dir, so relative
// imports inside each CLI (`./lib/store.mjs`, `./build.mjs`, ...) still
// resolve correctly through the symlink.
const scratch = mkdtempSync(join(tmpdir(), 'wu-main-guard-'))
const SYMLINKED_BIN = join(scratch, 'bin')
symlinkSync(REAL_BIN, SYMLINKED_BIN, 'dir')

after(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function run(binDir, name, args) {
  const r = spawnSync(process.execPath, [join(binDir, name), ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('bin/lib/main.mjs: isMain', () => {
  test('true when argv[1] equals the module realpath', () => {
    const url = `file://${join(REAL_BIN, 'serve.mjs')}`
    const originalArgv1 = process.argv[1]
    process.argv[1] = join(REAL_BIN, 'serve.mjs')
    try {
      assert.equal(isMain(url), true)
    } finally {
      process.argv[1] = originalArgv1
    }
  })

  test('true when argv[1] is a symlinked path to the same realpath', () => {
    const url = `file://${join(REAL_BIN, 'serve.mjs')}`
    const originalArgv1 = process.argv[1]
    process.argv[1] = join(SYMLINKED_BIN, 'serve.mjs')
    try {
      assert.equal(isMain(url), true)
    } finally {
      process.argv[1] = originalArgv1
    }
  })

  test('false for an unrelated path', () => {
    const url = `file://${join(REAL_BIN, 'serve.mjs')}`
    const originalArgv1 = process.argv[1]
    process.argv[1] = join(REAL_BIN, 'build.mjs')
    try {
      assert.equal(isMain(url), false)
    } finally {
      process.argv[1] = originalArgv1
    }
  })
})

describe('CLI entry guards work through a symlinked bin/', () => {
  test('serve.mjs --list-stores prints the same non-empty output through the symlink as through the realpath', () => {
    const real = run(REAL_BIN, 'serve.mjs', ['--list-stores'])
    const symlinked = run(SYMLINKED_BIN, 'serve.mjs', ['--list-stores'])

    assert.equal(real.status, 0)
    assert.equal(symlinked.status, 0)
    assert.ok(real.stdout.trim().length > 0, 'realpath invocation should print something')
    assert.equal(symlinked.stdout, real.stdout)
  })

  test('render-diagram.mjs --list-types prints the same non-empty output through the symlink as through the realpath', () => {
    const real = run(REAL_BIN, 'render-diagram.mjs', ['--list-types'])
    const symlinked = run(SYMLINKED_BIN, 'render-diagram.mjs', ['--list-types'])

    assert.equal(real.status, 0)
    assert.equal(symlinked.status, 0)
    assert.ok(real.stdout.trim().length > 0, 'realpath invocation should print something')
    assert.equal(symlinked.stdout, real.stdout)
  })
})
