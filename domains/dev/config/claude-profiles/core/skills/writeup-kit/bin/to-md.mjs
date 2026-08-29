#!/usr/bin/env node
// to-md.mjs — deterministic HTML→Markdown conversion (contract §7). Reads
// only role-tagged structure (bin/lib/html.mjs), so the mapping never has to
// guess. Anything outside the mapping becomes an HTML comment placeholder
// plus a stderr warning, rather than being silently dropped.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, join } from 'node:path'
import {
  parseHtml, serialize, isElement, tagName, attr, hasClass, classList,
  elementChildren, textContent, headMeta, titleText, findFirst, findAll,
} from './lib/html.mjs'
import { parse as parseYaml } from './lib/yaml-lite.mjs'
import { unescapeIrScript } from './lib/ir-script.mjs'

// --- inline rendering (a/strong/em/br/.wu-accent/plain text) ---------------

function renderInline(node) {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return ''
  const tag = node.tag
  const inner = () => (node.children || []).map(renderInline).join('')
  if (tag === 'br') return '\n'
  if (tag === 'strong') return `**${inner()}**`
  if (tag === 'em') return `*${inner()}*`
  if (tag === 'a') {
    const href = attr(node, 'href') || ''
    return `[${inner()}](${href})`
  }
  if (hasClass(node, 'wu-accent')) return `**${inner()}**`
  return inner()
}

function inlineText(node) {
  return renderInline(node).replace(/[ \t]+/g, ' ').trim()
}

// --- table --------------------------------------------------------------------

function renderTable(table) {
  const headRow = findFirst(table, (n) => tagName(n) === 'tr')
  const bodyRows = findAll(table, (n) => tagName(n) === 'tr').slice(headRow ? 1 : 0)
  const headers = headRow ? elementChildren(headRow).map((c) => inlineText(c)) : []
  const lines = []
  if (headers.length) {
    lines.push(`| ${headers.join(' | ')} |`)
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`)
  }
  for (const row of bodyRows) {
    const cells = elementChildren(row).map((c) => inlineText(c).replace(/\|/g, '\\|'))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

// --- figure (svg -> file, IR -> optional mermaid) --------------------------

const MERMAID_ARROW = { sync: '-->', async: '-.->', reply: '-.->' }

/** A mermaid `flowchart` for a node/edge IR, or `null` when this IR has no
 * nodes to draw. `groups` and `edges` are optional in the IR (a diagram
 * without groups is the common case), and the non-`diagram` figure types —
 * bar, timeline, matrix and the rest — carry no nodes at all; none of them
 * has a flowchart form, so they get the SVG image without a mermaid block. */
function mermaidFromIr(ir) {
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : []
  const groups = Array.isArray(ir.groups) ? ir.groups : []
  const edges = Array.isArray(ir.edges) ? ir.edges : []
  if (!nodes.length) return null
  const dir = ir.direction === 'down' ? 'TD' : 'LR'
  const lines = [`flowchart ${dir}`]
  const grouped = new Map()
  for (const g of groups) grouped.set(g.id, [])
  const ungrouped = []
  for (const n of nodes) {
    const line = `${n.id}[${n.label}]`
    if (n.group && grouped.has(n.group)) grouped.get(n.group).push(line)
    else ungrouped.push(line)
  }
  for (const g of groups) {
    lines.push(`  subgraph ${g.id}[${g.label}]`)
    for (const line of grouped.get(g.id)) lines.push(`    ${line}`)
    lines.push('  end')
  }
  for (const line of ungrouped) lines.push(`  ${line}`)
  for (const e of edges) {
    const arrow = MERMAID_ARROW[e.kind] || '-->'
    if (e.kind === 'reply') {
      lines.push(`  ${e.from} ${arrow}|reply| ${e.to}`)
    } else if (e.label) {
      lines.push(`  ${e.from} ${arrow}|${e.label}| ${e.to}`)
    } else {
      lines.push(`  ${e.from} ${arrow} ${e.to}`)
    }
  }
  return lines.join('\n')
}

function renderFigure(fig, ctx) {
  const svg = findFirst(fig, (n) => tagName(n) === 'svg')
  const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
  const caption = cap ? inlineText(cap) : ''
  const out = []

  if (svg && ctx.figuresDir) {
    ctx.figureIndex += 1
    const ir = findIr(fig)
    const figId = ir?.id || `fig${ctx.figureIndex}`
    const svgFileName = `${ctx.slug}-${figId}.svg`
    mkdirSync(ctx.figuresDir, { recursive: true })
    writeFileSync(join(ctx.figuresDir, svgFileName), serialize(svg))
    const relPath = ctx.figuresDirRel ? `${ctx.figuresDirRel}/${svgFileName}` : svgFileName
    out.push(`![${caption}](${relPath})`)
    const mermaid = ir ? mermaidFromIr(ir) : null
    if (mermaid) {
      out.push('')
      out.push('```mermaid')
      out.push(mermaid)
      out.push('```')
    }
  } else if (svg) {
    out.push(`![${caption}](#)`)
  }
  return out.join('\n')
}

function findIr(fig) {
  const script = findFirst(fig, (n) => tagName(n) === 'script' && attr(n, 'type') === 'text/x-writeup-diagram')
  if (!script) return null
  // <script> is HTML raw text, so textContent() returns it un-decoded —
  // unescape before parsing (ir-script.mjs contract; legacy raw text
  // passes through unchanged).
  const raw = unescapeIrScript(textContent(script))
  try {
    return parseYaml(raw)
  } catch {
    return null
  }
}

// --- block-level dispatch ----------------------------------------------------

let footnoteCounter
let footnotes

function renderDl(dl) {
  const children = elementChildren(dl)
  const lines = []
  for (let i = 0; i < children.length; i++) {
    if (tagName(children[i]) !== 'dt') continue
    const name = inlineText(children[i])
    const dd = children[i + 1] && tagName(children[i + 1]) === 'dd' ? children[i + 1] : null
    const what = dd ? inlineText(dd) : ''
    lines.push(`- **${name}** — ${what}`)
  }
  return lines.join('\n')
}

function renderCallout(div) {
  const tone = attr(div, 'data-tone')
  const prefix = tone === 'warn' ? '[!WARNING]' : tone === 'decision' ? '[!IMPORTANT]' : '[!NOTE]'
  const bodyLines = elementChildren(div).map((p) => inlineText(p)).filter(Boolean)
  return [`> ${prefix}`, ...bodyLines.map((l) => `> ${l}`)].join('\n')
}

function renderDecision(div) {
  const lines = elementChildren(div).map((p) => {
    const strong = findFirst(p, (n) => tagName(n) === 'strong')
    if (!strong) return `- ${inlineText(p)}`
    const label = textContent(strong).trim().replace(/[:：]\s*$/, '')
    const restNodes = (p.children || []).filter((n) => n !== strong)
    const rest = restNodes.map(renderInline).join('').replace(/\s+/g, ' ').trim()
    return `- **${label}**: ${rest}`
  })
  return lines.join('\n')
}

function renderSteps(ol) {
  return elementChildren(ol).map((li, i) => `${i + 1}. ${inlineText(li)}`).join('\n')
}

function renderChip(ul) {
  return elementChildren(ul).map((li) => `\`${inlineText(li)}\``).join(', ')
}

function renderQuote(bq) {
  const original = findFirst(bq, (n) => hasClass(n, 'wu-quote-original'))
  const ja = findFirst(bq, (n) => hasClass(n, 'wu-quote-ja'))
  const source = findFirst(bq, (n) => hasClass(n, 'wu-quote-source'))
  const lines = []
  if (original) lines.push(inlineText(original))
  if (ja) lines.push(inlineText(ja))
  if (source) lines.push(`— ${inlineText(source)}`)
  return ['```', ...lines, '```'].join('\n')
}

function renderCode(pre, lang) {
  const code = textContent(pre).replace(/\n+$/, '')
  return ['```' + lang, code, '```'].join('\n')
}

function renderOpen(div) {
  const ul = findFirst(div, (n) => tagName(n) === 'ul' || tagName(n) === 'ol')
  const items = ul ? elementChildren(ul).map((li) => `- ${inlineText(li)}`) : []
  return items.join('\n')
}

/** `.wu-cells` — one thing split into labelled parts. Markdown has no strip,
 * so each row becomes a list item (`**label** — part / part / part`), the
 * optional title a bold line, and each `.wu-cells-note` a plain line. Tones
 * and `data-count` widths are presentation and do not survive. */
function renderCells(div) {
  const lines = []
  for (const child of elementChildren(div)) {
    if (hasClass(child, 'wu-cells-title')) { lines.push(`**${inlineText(child)}**`); continue }
    if (hasClass(child, 'wu-cells-note')) { lines.push(inlineText(child)); continue }
    if (!hasClass(child, 'wu-cells-row')) continue
    const kids = elementChildren(child)
    const label = kids.filter((k) => hasClass(k, 'wu-cells-label')).map((k) => inlineText(k))[0]
    const parts = kids.filter((k) => hasClass(k, 'wu-cell')).map((k) => inlineText(k)).filter((t) => t !== '')
    lines.push(`- ${label ? `**${label}** — ` : ''}${parts.join(' / ')}`)
  }
  return lines.join('\n')
}

function renderMeta(p) {
  footnoteCounter += 1
  const n = footnoteCounter
  footnotes.push(`[^${n}]: ${inlineText(p)}`)
  return `[^${n}]`
}

/** Renders one block-level node (a heading, or a `<section>`/`.wu-*`
 * component) into zero or more Markdown blocks, appended to `out`. Recurses
 * into generic wrappers (`section`, `div` without a mapped class) so nested
 * content is still visited. */
function renderBlock(node, out, ctx) {
  if (!isElement(node)) return
  const tag = node.tag

  if (tag === 'h2') return void out.push(`## ${inlineText(node)}`)
  if (tag === 'h3') return void out.push(`### ${inlineText(node)}`)
  if (tag === 'h4') return void out.push(`#### ${inlineText(node)}`)

  if (hasClass(node, 'wu-lede')) {
    return void out.push(inlineText(node))
  }
  if (hasClass(node, 'wu-summary')) {
    const paras = elementChildren(node).length ? elementChildren(node) : [node]
    const body = paras.map((p) => inlineText(p)).join('\n>\n> ')
    return void out.push(`> [!NOTE]\n> ${body}`)
  }
  if (tag === 'dl' && hasClass(node, 'wu-terms')) return void out.push(renderDl(node))
  if (hasClass(node, 'wu-cells')) return void out.push(renderCells(node))
  if (hasClass(node, 'wu-callout')) return void out.push(renderCallout(node))
  if (hasClass(node, 'wu-decision')) return void out.push(renderDecision(node))
  if (hasClass(node, 'wu-compare') || hasClass(node, 'wu-table')) return void out.push(renderTable(node))
  if (tag === 'ol' && hasClass(node, 'wu-steps')) return void out.push(renderSteps(node))
  if (hasClass(node, 'wu-figure')) return void out.push(renderFigure(node, ctx))
  if (hasClass(node, 'wu-quote')) return void out.push(renderQuote(node))
  if (hasClass(node, 'wu-code')) return void out.push(renderCode(node, attr(node, 'data-lang') || ''))
  if (hasClass(node, 'wu-diff')) return void out.push(renderCode(node, 'diff'))
  if (tag === 'ul' && hasClass(node, 'wu-chip')) return void out.push(renderChip(node))
  if (hasClass(node, 'wu-meta')) return void out.push(renderMeta(node))
  if (hasClass(node, 'wu-open')) return void out.push(renderOpen(node))

  if (tag === 'section' || (tag === 'div' && hasClass(node, 'wu-page'))) {
    for (const child of elementChildren(node)) renderBlock(child, out, ctx)
    return
  }
  if (tag === 'div' && !classList(node).some((c) => c.startsWith('wu-'))) {
    for (const child of elementChildren(node)) renderBlock(child, out, ctx)
    return
  }

  if (tag === 'p' || tag === 'blockquote') {
    const text = inlineText(node)
    if (text) out.push(tag === 'blockquote' ? `> ${text}` : text)
    return
  }
  if (tag === 'ul' || tag === 'ol') {
    out.push(elementChildren(node).map((li) => `- ${inlineText(li)}`).join('\n'))
    return
  }
  if (tag === 'table') return void out.push(renderTable(node))
  if (tag === 'pre') return void out.push(renderCode(node, attr(node, 'data-lang') || ''))
  if (tag === 'header' && hasClass(node, 'wu-header')) return // chrome, not content
  if (tag === 'footer' && hasClass(node, 'wu-footer')) return // chrome, not content

  // Unmapped: emit a placeholder and warn, but still recurse so nested
  // mappable content underneath isn't silently lost.
  const cls = classList(node).join('.')
  const label = cls ? `${tag}.${cls}` : tag
  out.push(`<!-- writeup: unmapped ${label} -->`)
  process.stderr.write(`to-md: unmapped element <${label}>\n`)
  for (const child of elementChildren(node)) renderBlock(child, out, ctx)
}

// --- frontmatter --------------------------------------------------------------

function yamlFrontmatterValue(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderFrontmatter(meta, title) {
  const lines = ['---']
  lines.push(`title: ${yamlFrontmatterValue(title)}`)
  if (meta.kind) lines.push(`kind: ${yamlFrontmatterValue(meta.kind)}`)
  if (meta.date) lines.push(`date: ${yamlFrontmatterValue(meta.date)}`)
  if (meta.updated) lines.push(`updated: ${yamlFrontmatterValue(meta.updated)}`)
  if (meta.sources) lines.push(`sources: ${yamlFrontmatterValue(meta.sources)}`)
  lines.push('---')
  return lines.join('\n')
}

// --- top-level conversion -------------------------------------------------------

/**
 * @param {string} html
 * @param {{ slug: string, figuresDir?: string, figuresDirRel?: string }} opts
 */
export function convertToMarkdown(html, opts) {
  footnoteCounter = 0
  footnotes = []
  const root = parseHtml(html)
  const meta = headMeta(root)
  const title = titleText(root)
  const main = findFirst(root, (n) => tagName(n) === 'main') || findFirst(root, (n) => tagName(n) === 'body')

  const out = []
  out.push(renderFrontmatter(meta, title))
  out.push('')
  out.push(`# ${title}`)

  const ctx = {
    slug: opts.slug,
    figuresDir: opts.figuresDir,
    figuresDirRel: opts.figuresDirRel,
    figureIndex: 0,
  }
  if (main) {
    for (const child of elementChildren(main)) {
      const blocks = []
      renderBlock(child, blocks, ctx)
      out.push(...blocks.filter((b) => b !== undefined && b !== ''))
    }
  }
  if (footnotes.length) {
    out.push('')
    out.push(...footnotes)
  }
  return out.filter((b, i, arr) => !(b === '' && arr[i - 1] === '')).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = { file: null, out: null, figuresDir: null }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--figures-dir') args.figuresDir = argv[++i]
    else positional.push(a)
  }
  args.file = positional[0] ?? null
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('usage: node bin/to-md.mjs <page.html> [--out x.md] [--figures-dir dir]')
    return 2
  }
  if (!existsSync(args.file)) {
    console.error(`error: file not found: ${args.file}`)
    return 2
  }
  const html = readFileSync(args.file, 'utf8')
  const slug = basename(args.file, extname(args.file))
  const outPath = args.out || join(dirname(args.file), `${slug}.md`)
  const figuresDir = args.figuresDir || join(dirname(outPath), `${slug}-figures`)
  const md = convertToMarkdown(html, { slug, figuresDir, figuresDirRel: `${slug}-figures` })
  writeFileSync(outPath, md)
  console.log(`to-md: wrote ${outPath}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
