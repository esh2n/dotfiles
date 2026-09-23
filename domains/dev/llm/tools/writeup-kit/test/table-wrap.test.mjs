import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '..', 'kit', 'writeup.css'), 'utf8')

// A table treats width:100% as a minimum, so one unbreakable code token
// (a file path, a `path:line` citation) can push the whole table past the
// 45em column on viewports the narrow-screen scroll guard never covers.
// Layout itself needs a browser to assert (see the playwright measurement
// in the fix's commit); this pins the one declaration that prevents it.
describe('kit css: table cell code tokens can break', () => {
  test('.wu-compare td code / .wu-table td code declare overflow-wrap: anywhere', () => {
    const m = css.match(/\.wu-compare td code,\s*\.wu-table td code\s*\{([^}]*)\}/)
    assert.ok(m, 'the td code rule is missing from kit/writeup.css')
    assert.match(m[1], /overflow-wrap:\s*anywhere/)
  })
})
