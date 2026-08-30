// pdf.mjs — renders a staged HTML document to a PDF via headless
// Chromium, for publish.mjs's `--to github` target: the caller stages a
// full document (publish.mjs writes it as `<slug>.html` inside the github
// target's output folder) and hands its path here.
//
// Never throws: a missing `playwright-core` (this kit ships with no
// dependencies of its own — Node.js alone) or any render failure inside
// Chromium is a graceful no-op, since a github publish folder is still
// useful as Markdown + figures without a PDF attached.

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadPlaywrightCore() {
  try {
    return await import('playwright-core')
  } catch { /* fall through to the env override */ }
  const envPath = process.env.WRITEUP_PLAYWRIGHT_CORE
  if (!envPath) return null
  try {
    return await import(pathToFileURL(resolve(envPath)).href)
  } catch {
    return null
  }
}

/**
 * Renders `htmlPath` to `pdfPath` via a headless Chromium, resolved from
 * `playwright-core` (`await import('playwright-core')`) or, when that
 * fails, the module path in `WRITEUP_PLAYWRIGHT_CORE`.
 *
 * @param {string} htmlPath a local file to render (`file://` URL built here)
 * @param {string} pdfPath where to write the PDF
 * @returns {Promise<{generated: boolean, path?: string, reason?: string}>}
 *   Never throws — `generated: false` with a `reason` covers both "no
 *   playwright-core available" and any error Chromium itself raised.
 */
export async function renderPdf(htmlPath, pdfPath) {
  const mod = await loadPlaywrightCore()
  const chromium = mod?.chromium ?? mod?.default?.chromium
  if (!chromium) {
    return { generated: false, reason: 'playwright-core not found' }
  }
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(`file://${resolve(htmlPath)}`, { waitUntil: 'load' })
    await page.waitForTimeout(500)
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    })
  } catch (err) {
    return { generated: false, reason: err?.message ?? String(err) }
  } finally {
    await browser?.close()
  }
  return { generated: true, path: pdfPath }
}
