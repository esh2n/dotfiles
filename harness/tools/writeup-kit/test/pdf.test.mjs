import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPdf } from '../bin/lib/pdf.mjs'

describe('renderPdf(): graceful skip', () => {
  test('with no playwright-core resolvable, returns { generated: false, reason } and never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-pdf-'))
    const htmlPath = join(dir, 'index.html')
    writeFileSync(htmlPath, '<!DOCTYPE html><html><body>x</body></html>')
    const pdfPath = join(dir, 'out.pdf')

    const savedEnv = process.env.WRITEUP_PLAYWRIGHT_CORE
    delete process.env.WRITEUP_PLAYWRIGHT_CORE
    try {
      const result = await renderPdf(htmlPath, pdfPath)
      assert.equal(result.generated, false)
      assert.equal(typeof result.reason, 'string')
      assert.ok(!existsSync(pdfPath))
    } finally {
      if (savedEnv !== undefined) process.env.WRITEUP_PLAYWRIGHT_CORE = savedEnv
    }
  })

  test('WRITEUP_PLAYWRIGHT_CORE pointing at a non-existent module still skips gracefully, no throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-pdf-'))
    const htmlPath = join(dir, 'index.html')
    writeFileSync(htmlPath, '<!DOCTYPE html><html><body>x</body></html>')
    const pdfPath = join(dir, 'out.pdf')

    const savedEnv = process.env.WRITEUP_PLAYWRIGHT_CORE
    process.env.WRITEUP_PLAYWRIGHT_CORE = join(dir, 'does-not-exist.mjs')
    try {
      const result = await renderPdf(htmlPath, pdfPath)
      assert.equal(result.generated, false)
      assert.ok(!existsSync(pdfPath))
    } finally {
      if (savedEnv === undefined) delete process.env.WRITEUP_PLAYWRIGHT_CORE
      else process.env.WRITEUP_PLAYWRIGHT_CORE = savedEnv
    }
  })
})
