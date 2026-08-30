#!/usr/bin/env node
// to-md.mjs — deterministic HTML→Markdown conversion (contract §7). Reads
// only role-tagged structure (bin/lib/html.mjs), so the mapping never has to
// guess. Anything outside the mapping becomes an HTML comment placeholder
// plus a stderr warning, rather than being silently dropped.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, extname, join } from 'node:path'
import {
  parseHtml, serialize, isElement, tagName, attr, hasClass, classList,
  elementChildren, textContent, headMeta, titleText, findFirst, findAll,
} from './lib/html.mjs'
import { parse as parseYaml } from './lib/yaml-lite.mjs'
import { unescapeIrScript } from './lib/ir-script.mjs'
import { diffFigureText } from './lib/diffview.mjs'
import { resolvePageAsset } from './lib/assets.mjs'

// --- inline rendering (a/strong/em/br/code/.wu-accent/plain text) ----------

/** Escapes a literal `<` in plain (non-code) text so GitHub's Markdown
 * renderer treats it as a character, not the start of inline HTML — a
 * page whose prose says `<img>` or `docs/writeup/<slug>/` would otherwise
 * have that fragment silently stripped or misrendered. `>` is intentionally
 * left alone here; a leading `>` is only a problem at the very start of a
 * line, handled separately (`escapeLeadingGt`) where a text run becomes
 * its own line. */
function escapeInlineText(text) {
  return text.replace(/</g, '\\<')
}

/** GFM inline code span for a `<code>` element's own raw text — read with
 * `textContent`, never routed back through `renderInline`/`escapeInlineText`,
 * since a code span's content is verbatim (a literal `<` inside `` `code` ``
 * needs no escaping, and must not gain one). The backtick fence is chosen
 * longer than any run of backticks already inside the text, with a padding
 * space when the text starts or ends with a backtick — the same rule GFM
 * itself uses to keep the fence from being ambiguous with its own content. */
function inlineCode(text) {
  const runs = text.match(/`+/g) || []
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0)
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function renderInline(node) {
  if (node.type === 'text') return escapeInlineText(node.value.replace(/\s+/g, ' '))
  if (node.type !== 'element') return ''
  const tag = node.tag
  const inner = () => (node.children || []).map(renderInline).join('')
  if (tag === 'br') return '\n'
  if (tag === 'code') return inlineCode(textContent(node))
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

/** Sanitizes an untrusted id/filename fragment into a safe path component:
 * only `[A-Za-z0-9_-]` survives, any run of anything else (a `/`, a `..`
 * traversal segment, a space, a paren) collapses to a single `-`, and a
 * leading/trailing `-` left over from that collapse is trimmed. A result
 * left empty (nothing survived — e.g. an id of `../..`) falls back to
 * `fallback` so the file still gets a name. Used both for a diagram IR's
 * own `id` (`renderFigure`) and for the base name of a `.wu-shot`'s copied
 * file (`renderShot`) — in both cases the string reaches this function
 * from data the page's own author controls, and in both cases it becomes
 * the tail of a path this code itself joins under `figuresDir`, so an
 * unsanitized `../../evil` would write outside that directory. */
function sanitizePathPart(raw, fallback) {
  const cleaned = String(raw ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

/** Escapes text bound for the `alt` slot of a Markdown image (`![alt](path)`)
 * — used for a `.wu-shot`'s alt/caption and a `.wu-figure`'s caption, both
 * of which land in that position without ever passing through
 * `renderInline`'s own escaping (that path only ever escapes a literal
 * `<`, and running an image's alt through it wouldn't touch the image
 * syntax's own delimiters). A backslash is escaped first so escaping the
 * brackets/parens afterward can't produce a stray double-escape; `]`/`[`
 * would otherwise be read as the alt bracket closing early or a nested
 * link opening, `(`/`)` would be read as the path parens, and a raw
 * newline would break the single-line `![]()` form entirely. */
function escapeImageAltText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([[\]()])/g, '\\$1')
    .replace(/\r?\n/g, ' ')
}

function renderFigure(fig, ctx) {
  const svg = findFirst(fig, (n) => tagName(n) === 'svg')
  const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
  const caption = cap ? inlineText(cap) : ''
  const altCaption = escapeImageAltText(caption)
  const out = []

  if (svg && ctx.figuresDir) {
    ctx.figureIndex += 1
    const ir = findIr(fig)
    const figId = sanitizePathPart(ir?.id, `fig${ctx.figureIndex}`)
    const svgFileName = `${ctx.slug}-${figId}.svg`
    mkdirSync(ctx.figuresDir, { recursive: true })
    writeFileSync(join(ctx.figuresDir, svgFileName), serialize(svg))
    if (ctx.manifest) ctx.manifest.push({ file: svgFileName, kind: 'figure' })
    const relPath = ctx.figuresDirRel ? `${ctx.figuresDirRel}/${svgFileName}` : svgFileName
    out.push(`![${altCaption}](${relPath})`)
    const mermaid = ir ? mermaidFromIr(ir) : null
    if (mermaid) {
      out.push('')
      out.push('```mermaid')
      out.push(mermaid)
      out.push('```')
    }
  } else if (svg) {
    out.push(`![${altCaption}](#)`)
  }
  return out.join('\n')
}

const SHOT_EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** Decodes a `.wu-shot` `data:` `src` into its raw bytes plus a file
 * extension guessed from its MIME type (`bin` for anything unrecognized —
 * still a usable, if oddly-named, file). */
function decodeShotDataUri(url) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url)
  if (!m) return { ext: 'bin', buffer: Buffer.from(url, 'utf8') }
  const [, mime, isBase64, payload] = m
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { ext: SHOT_EXT_BY_MIME[mime] || 'bin', buffer }
}

/** `.wu-shot` — a screenshot or photo (evidence, not a mechanism —
 * writing.md §4), one `<img>` plus an optional `<figcaption>`. The image
 * becomes a Markdown image using the `<img>`'s own `alt` (falling back to
 * the caption when `alt` is empty), and the caption — a separate piece of
 * text from `alt` — follows as its own line, the same "block, then a
 * caption line below it" shape `renderDiffView` uses for its fence. With a
 * figures directory available the file is materialized there: a
 * page-relative `src` is copied from `ctx.pageDir`, named
 * `<slug>-shot<N>-<basename>` (`N` = `ctx.figureIndex`, the same
 * position-in-document counter the `data:` branch already uses) rather
 * than its own bare basename — two shots on the same page that both happen
 * to be saved as e.g. `shot.png` would otherwise silently overwrite one
 * another in `figures/`. A `data:` `src` is decoded to
 * `<slug>-shot<N>.<ext>`. The page-relative `src` is resolved through
 * `resolvePageAsset` (path traversal / symlink-escape / extension guard —
 * lib/assets.mjs); a `src` it rejects is never copied — the figure
 * degrades to the same `![alt](#)` placeholder `.wu-figure` uses when it
 * has no svg to write out, plus a stderr warning, rather than either
 * throwing or silently exfiltrating a file from outside the page's own
 * directory. Without a figures directory at all it degrades to that same
 * placeholder unconditionally. */
function renderShot(fig, ctx) {
  const img = findFirst(fig, (n) => tagName(n) === 'img')
  const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
  const caption = cap ? inlineText(cap) : ''
  if (!img) return caption
  const alt = escapeImageAltText(attr(img, 'alt') || caption)
  const src = attr(img, 'src') || ''
  const out = []

  if (ctx.figuresDir) {
    ctx.figureIndex += 1
    mkdirSync(ctx.figuresDir, { recursive: true })
    let fileName = null
    if (src.startsWith('data:')) {
      const { ext, buffer } = decodeShotDataUri(src)
      fileName = `${ctx.slug}-shot${ctx.figureIndex}.${ext}`
      writeFileSync(join(ctx.figuresDir, fileName), buffer)
    } else {
      const resolved = ctx.pageDir ? resolvePageAsset(ctx.pageDir, src) : null
      if (resolved && existsSync(resolved)) {
        // The copy is ours to name, so its base name is sanitized the same
        // way a figure id is — a src basename of `") pwned` or one with a
        // space would otherwise land unescaped in `![alt](path)` below.
        const rawBase = basename(src)
        const ext = extname(rawBase)
        const base = sanitizePathPart(ext ? rawBase.slice(0, -ext.length) : rawBase, `shot${ctx.figureIndex}`)
        const safeExt = ext.replace(/[^A-Za-z0-9.]/g, '')
        fileName = `${ctx.slug}-shot${ctx.figureIndex}-${base}${safeExt}`
        copyFileSync(resolved, join(ctx.figuresDir, fileName))
      } else {
        process.stderr.write(`to-md: refusing to copy unsafe .wu-shot src: ${src}\n`)
      }
    }
    if (fileName && ctx.manifest) ctx.manifest.push({ file: fileName, kind: 'shot' })
    out.push(fileName ? `![${alt}](${ctx.figuresDirRel ? `${ctx.figuresDirRel}/${fileName}` : fileName})` : `![${alt}](#)`)
  } else {
    out.push(`![${alt}](#)`)
  }
  if (caption) out.push(escapeLeadingGt(caption))
  return out.join('\n\n')
}

/** `.wu-diffview` — the rendered `.wu-dv` tables are a presentation of one
 * raw unified diff, and Markdown already has an honest form for that: a
 * ```` ```diff ```` fence holding the diff itself, read back from the
 * figure's `text/x-writeup-diff` script (the source of truth `build`
 * re-renders from). Line numbers, hunk chrome and word marks are the
 * rendering and do not survive; `data-mode` is presentation too. A figure
 * whose script is missing falls back to its caption. */
function renderDiffView(fig) {
  const raw = diffFigureText(serialize(fig))
  const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
  const caption = cap ? inlineText(cap) : ''
  const out = []
  if (raw !== null) out.push('```diff\n' + raw.replace(/\n+$/, '') + '\n```')
  if (caption) out.push(escapeLeadingGt(caption))
  return out.join('\n\n')
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

/** Escapes a leading `>` — a text run that becomes its own standalone
 * line/block (a plain `<p>`, a `.wu-shot`/`.wu-diffview` caption) would
 * otherwise open that line as a one-line Markdown blockquote if the
 * source text itself starts with `>`. Applied per line so a `<br>`-created
 * hard break inside the same block is covered too. */
function escapeLeadingGt(text) {
  return text.split('\n').map((line) => (line.startsWith('>') ? `\\${line}` : line)).join('\n')
}

/** Prefixes *every* line of `text` with GFM blockquote syntax (`> `, or a
 * bare `>` for a blank line) — not only its first line. `inlineText`
 * collapses whitespace inside one text node, but a `<br>` (a deliberate
 * hard break) or a multi-`<p>` body still produces an embedded `\n`;
 * joining those into `> [!NOTE]\n> ${body}` naively only prefixes the
 * very first line, so every line after the first falls out of the alert
 * as its own paragraph once GitHub renders it — the exact bug this fixes. */
function toBlockquote(text) {
  return text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
}

function renderCallout(div) {
  const tone = attr(div, 'data-tone')
  const prefix = tone === 'warn' ? '[!WARNING]' : tone === 'decision' ? '[!IMPORTANT]' : '[!NOTE]'
  const bodyLines = elementChildren(div).map((p) => inlineText(p)).filter(Boolean)
  return toBlockquote([prefix, ...bodyLines].join('\n'))
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
    const parts = kids.filter((k) => hasClass(k, 'wu-cell')).map(cellText).filter((t) => t !== '')
    lines.push(`- ${label ? `**${label}** — ` : ''}${parts.join(' / ')}`)
  }
  return lines.join('\n')
}

/** One `.wu-cell`'s text. A cell can hold a bare string ("パース"), a
 * label/value pair ("MAJOR" + "1"), and an `×N` chip, in any combination;
 * `inlineText` would run them together as "MAJOR1" / "進行中×6", so the
 * pieces are re-joined with spaces here. */
function cellText(cell) {
  const kids = elementChildren(cell)
  const count = kids.filter((k) => hasClass(k, 'wu-cell-count')).map((k) => inlineText(k))[0] ?? ''
  const pair = kids.filter((k) => hasClass(k, 'wu-cell-label') || hasClass(k, 'wu-cell-value')).map((k) => inlineText(k))
  let head
  if (pair.length) {
    head = pair.filter((t) => t !== '').join(' ')
  } else {
    head = inlineText(cell)
    if (count && head.endsWith(count)) head = head.slice(0, -count.length)
  }
  return [head, count].filter((t) => t !== '').join(' ')
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
    return void out.push(escapeLeadingGt(inlineText(node)))
  }
  if (hasClass(node, 'wu-summary')) {
    const paras = elementChildren(node).length ? elementChildren(node) : [node]
    const body = paras.map((p) => inlineText(p)).join('\n\n')
    return void out.push(toBlockquote(`[!NOTE]\n${body}`))
  }
  if (tag === 'dl' && hasClass(node, 'wu-terms')) return void out.push(renderDl(node))
  if (hasClass(node, 'wu-cells')) return void out.push(renderCells(node))
  if (hasClass(node, 'wu-callout')) return void out.push(renderCallout(node))
  if (hasClass(node, 'wu-decision')) return void out.push(renderDecision(node))
  if (hasClass(node, 'wu-compare') || hasClass(node, 'wu-table')) return void out.push(renderTable(node))
  if (tag === 'ol' && hasClass(node, 'wu-steps')) return void out.push(renderSteps(node))
  if (hasClass(node, 'wu-diffview')) return void out.push(renderDiffView(node))
  if (hasClass(node, 'wu-figure')) return void out.push(renderFigure(node, ctx))
  if (hasClass(node, 'wu-shot')) return void out.push(renderShot(node, ctx))
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
    if (text) out.push(tag === 'blockquote' ? toBlockquote(text) : escapeLeadingGt(text))
    return
  }
  if (tag === 'ul' || tag === 'ol') {
    out.push(elementChildren(node).map((li) => `- ${inlineText(li)}`).join('\n'))
    return
  }
  if (tag === 'table') return void out.push(renderTable(node))
  if (tag === 'pre') return void out.push(renderCode(node, attr(node, 'data-lang') || ''))
  if (hasClass(node, 'wu-dv') || classList(node).some((c) => c.startsWith('wu-dv-'))) return // diffview's rendered tables (build.mjs), a presentation of the raw diff
  if (tag === 'nav' && hasClass(node, 'wu-sidetoc')) return // generated side TOC (build.mjs), not content
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
 * @param {{ slug: string, figuresDir?: string, figuresDirRel?: string, pageDir?: string, manifest?: Array }} opts
 *   `pageDir` — the page's own directory, needed only to copy a
 *   `.wu-shot`'s page-relative image file (`renderShot`); a `.wu-figure`'s
 *   svg needs no such lookup, since it is serialized straight out of the
 *   parsed HTML. `manifest` — an optional array the caller owns; every
 *   file this call writes into `figuresDir` is pushed onto it as
 *   `{ file, kind: 'figure' | 'shot' }` (`file` is the bare name, relative
 *   to `figuresDir`), so a caller that needs to tell a `.wu-figure`'s own
 *   SVG export apart from a `.wu-shot`'s copied screenshot — e.g. publish's
 *   `restyleFigures`, which must never re-style a shot even when it
 *   happens to be an `.svg` too — doesn't have to guess from the directory
 *   listing alone.
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
    pageDir: opts.pageDir,
    figureIndex: 0,
    manifest: opts.manifest,
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
  const md = convertToMarkdown(html, { slug, figuresDir, figuresDirRel: `${slug}-figures`, pageDir: dirname(args.file) })
  writeFileSync(outPath, md)
  console.log(`to-md: wrote ${outPath}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
