// blocks.mjs — a small block-level Markdown -> HTML converter for the plain
// (non-directive) Markdown chunks of an explain-pages document: headings,
// paragraphs, lists, GFM tables, fenced code, and blockquotes (docs/
// authoring.md "基本記法"). Not a full CommonMark implementation — tuned to
// what explain-pages bodies actually contain.
//
// Returns a flat list of block nodes; `renderBlocksHtml` turns those into
// wu-* tagged HTML fragments. Headings are returned as their own node type
// so the caller (page assembly) can group content under h2 sections.

import { escapeHtml } from './util.mjs'
import { renderInline } from './inline.mjs'

const HEADING_RE = /^(#{2,4})\s+(.*)$/
const FENCE_RE = /^```\s*([\w-]*)\s*$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+\.\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/

/** @param {string} text @returns {Array<object>} block nodes */
export function parseBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i++; continue }

    const fence = FENCE_RE.exec(line)
    if (fence) {
      const lang = fence[1] || undefined
      const codeLines = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++ }
      i++ // consume closing fence
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = splitTableRow(line)
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++ }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (QUOTE_RE.test(line)) {
      const qLines = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) { qLines.push(QUOTE_RE.exec(lines[i])[1]); i++ }
      blocks.push({ type: 'quote', text: qLines.join(' ').trim() })
      continue
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line)
      const itemRe = ordered ? OL_RE : UL_RE
      const items = []
      while (i < lines.length) {
        const m = itemRe.exec(lines[i])
        if (m) { items.push(m[1].trim()); i++; continue }
        // continuation line: indented text belonging to the previous item
        if (lines[i].trim() !== '' && /^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim()
          i++
          continue
        }
        break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // paragraph: consume until a blank line or a line that starts a new block
    const paraLines = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !TABLE_ROW_RE.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'para', text: paraLines.join(' ').trim() })
  }

  return blocks
}

function splitTableRow(line) {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

/** Render parsed blocks to HTML. `headingBase` maps the smallest heading
 * level present to <h2> — used when a directive body (e.g. inside a
 * callout) happens to contain headings of its own (rare, but the grammar
 * allows arbitrary Markdown inside a callout). */
export function renderBlocksHtml(blocks) {
  const parts = []
  for (const b of blocks) {
    if (b.type === 'heading') {
      const tag = b.level === 2 ? 'h2' : b.level === 3 ? 'h3' : 'h4'
      parts.push(`<${tag}>${renderInline(b.text)}</${tag}>`)
    } else if (b.type === 'para') {
      parts.push(`<p>${renderInline(b.text)}</p>`)
    } else if (b.type === 'code') {
      const lang = b.lang ? ` data-lang="${b.lang}"` : ''
      parts.push(`<pre class="wu-code"${lang}><code>${escapeHtml(b.text)}</code></pre>`)
    } else if (b.type === 'quote') {
      parts.push(`<blockquote class="wu-quote"><p class="wu-quote-original">${renderInline(b.text)}</p></blockquote>`)
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul'
      const items = b.items.map((it) => `<li>${renderInline(it)}</li>`).join('\n')
      parts.push(`<${tag}>\n${items}\n</${tag}>`)
    } else if (b.type === 'table') {
      const thead = `<thead><tr>${b.header.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>`
      parts.push(`<table class="wu-table">\n${thead}\n${tbody}\n</table>`)
    }
  }
  return parts.join('\n')
}
