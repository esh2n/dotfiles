#!/usr/bin/env node
// self-check.mjs — the writeup-kit structural/content gate CLI (contract §5).
// Zero-dependency: reads a page with bin/lib/html.mjs (no HTML parser
// dependency) and reports every row of the contract's self-check table.
//
// This is a gate, not a formatter: it never rewrites body content. The only
// mutation it can make (--write-meta) is a narrow, regex-scoped patch of the
// single `<meta name="checks">` tag, so the rest of the file's bytes are
// left untouched (important: figures embed a sha256'd SVG + IR pair that
// build.mjs and to-md.mjs also read, and a full HTML round-trip through the
// tolerant parser would risk reformatting them).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseHtml, findAll, findFirst, isElement, tagName, attr, classList, hasClass,
  elementChildren, textContent, headMeta, titleText, externalRefs,
  structuralSignature, signaturesEqual,
} from './lib/html.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_TEMPLATE_PATH = join(HERE, '..', 'kit', 'template.html')

export const KIND_VALUES = [
  '決定記録', '設計', '調査まとめ', '参考資料まとめ', 'PBI 資料', '絵解き', '作業メモ', '議事録',
]

// Required h2 headings per kind, taken verbatim from references/kinds.md's
// skeleton examples (substring-matched against the page's actual h2 text,
// since a real page may add detail after the required word, e.g. "根拠（表）").
export const KIND_SECTIONS = {
  '決定記録': ['決まったこと', '却下した案', '未決・前提', '次のステップ'],
  '設計': ['目的と読者', '用語', '現状とギャップ', 'あるべき姿', '決定点', '進め方'],
  '調査まとめ': ['問い', '結論', '根拠', '未確認', '含意'],
  '参考資料まとめ': ['資料一覧', '各資料の要点', '取るもの・置き先'],
  'PBI 資料': ['背景', '決めたこと', '未決', '関係する文書'],
  '絵解き': ['フック', '問題', '仕組み', '現実復帰', 'まとめ'],
  '作業メモ': ['今日分かったこと', '次にやること'],
  '議事録': ['決定', '宿題', '論点'],
}

// Body elements allowed inside <main> (contract §5 "role-tagged structure"),
// as specified for this milestone. `svg` subtrees are exempt entirely — SVG
// markup is not role-tagged prose.
const ALLOWED_BODY_TAGS = new Set([
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'pre', 'code', 'figure', 'figcaption', 'svg', 'blockquote', 'dl', 'dt', 'dd',
  'section', 'div', 'span', 'a', 'strong', 'em', 'br', 'script', 'nav', 'cite',
])
// A small, pragmatic exception to the "only wu-* classes" rule: the kit's
// own reference pages (kit/samples.html, the contract) right-align/no-wrap
// numeric table cells with these two utility classes. Real store pages use
// them the same way inside `.wu-table`/`.wu-compare`, so treating them as a
// violation would make every numeric column trigger a false error.
const ALLOWED_NON_WU_CLASSES = new Set(['n', 'num'])

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const ARROW_RE = /[←-⇿]/u
const PAREN_RE = /[（(][^（）()]*[）)]/g

function isSvgOrDescendant(node, ancestorsOfSvg) {
  return ancestorsOfSvg.has(node)
}

export function runSelfCheck(filePath) {
  let raw
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (e) {
    return { unreadable: true, message: `cannot read file: ${filePath} (${e.message})` }
  }

  const items = []
  const add = (level, item, detail) => items.push({ level, item, detail: detail ?? '' })

  let root
  try {
    root = parseHtml(raw)
  } catch (e) {
    return { unreadable: true, message: `cannot parse HTML: ${e.message}` }
  }

  checkSingleFile(root, add)
  checkRequiredMeta(root, add)
  checkChrome(root, add)
  checkRoleStructure(root, add)
  checkKindSections(root, add)
  checkFigures(root, add)
  checkSvgA11y(root, add)
  checkAccentBudget(root, add)
  checkEmojiArrows(root, add)
  checkCalloutRuns(root, add)
  checkTableColumns(root, add)
  const proseBlocks = mainProseBlocks(root)
  checkSentenceLength(proseBlocks, add)
  checkParentheticals(proseBlocks, add)
  checkMarkdownConvertibility(root, add)

  const errors = items.filter((i) => i.level === 'error')
  const warnings = items.filter((i) => i.level === 'warn')
  return { unreadable: false, ok: errors.length === 0, errors, warnings, items }
}

// --- 1. single file / allowed externals -------------------------------------

function checkSingleFile(root, add) {
  for (const ref of externalRefs(root)) {
    const url = ref.url
    if (isAllowedExternal(url)) continue
    add('error', 'single-file', `${ref.tag} references disallowed external URL: ${url}`)
  }
}

function isAllowedExternal(url) {
  // The kit link at any folder depth: one or more `../` hops up to `_kit/`
  // (a page nested any number of folders under the store root), `./_kit/`
  // (build.mjs's generated store-root index.html, which sits beside `_kit/`
  // rather than under it), or the single-hop `./writeup.css` form pages
  // inside `_kit/` itself use.
  if (/^(?:\.\.\/)+_kit\/writeup\.css$/.test(url)) return true
  if (url === './_kit/writeup.css' || url === './writeup.css') return true
  if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) return true
  if (/^https:\/\/fonts\.gstatic\.com\//.test(url)) return true
  return false
}

// --- 2. required head meta --------------------------------------------------

function checkRequiredMeta(root, add) {
  const meta = headMeta(root)
  const title = titleText(root)
  if (!title) add('error', 'required-meta', 'missing <title>')
  if (!meta.description) add('error', 'required-meta', 'missing <meta name="description">')
  if (!meta.kind) add('error', 'required-meta', 'missing <meta name="kind">')
  else if (!KIND_VALUES.includes(meta.kind)) {
    add('error', 'required-meta', `<meta name="kind"> value is not one of the 8 kinds: ${meta.kind}`)
  }
  if (!meta.date) add('error', 'required-meta', 'missing <meta name="date">')
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    add('error', 'required-meta', `<meta name="date"> is not YYYY-MM-DD: ${meta.date}`)
  }
}

// --- 3. chrome matches template ---------------------------------------------

let cachedTemplateSignatures = null
function templateSignatures() {
  if (cachedTemplateSignatures) return cachedTemplateSignatures
  const text = readFileSync(KIT_TEMPLATE_PATH, 'utf8')
  const tplRoot = parseHtml(text)
  const header = findFirst(tplRoot, (n) => isElement(n) && hasClass(n, 'wu-header'))
  const footer = findFirst(tplRoot, (n) => isElement(n) && hasClass(n, 'wu-footer'))
  cachedTemplateSignatures = {
    header: header ? structuralSignature(header) : null,
    footer: footer ? structuralSignature(footer) : null,
  }
  return cachedTemplateSignatures
}

function checkChrome(root, add) {
  const tpl = templateSignatures()
  const header = findFirst(root, (n) => isElement(n) && hasClass(n, 'wu-header'))
  const footer = findFirst(root, (n) => isElement(n) && hasClass(n, 'wu-footer'))
  if (!header) add('error', 'chrome', 'missing .wu-header')
  else if (!signaturesEqual(structuralSignature(header), tpl.header)) {
    add('error', 'chrome', '.wu-header structure does not match kit/template.html')
  }
  if (!footer) add('error', 'chrome', 'missing .wu-footer')
  else if (!signaturesEqual(structuralSignature(footer), tpl.footer)) {
    add('error', 'chrome', '.wu-footer structure does not match kit/template.html')
  }
}

// --- shared: locate <main> (or fall back to <body> minus chrome) -----------

function findMain(root) {
  const main = findFirst(root, (n) => tagName(n) === 'main')
  if (main) return main
  return findFirst(root, (n) => tagName(n) === 'body')
}

/** Every element inside `main`'s subtree that is itself inside an `<svg>`
 * (so structural/class checks can skip SVG internals entirely). */
function svgDescendantSet(main) {
  const set = new Set()
  for (const svg of findAll(main, (n) => tagName(n) === 'svg')) {
    for (const n of findAll(svg, () => true)) set.add(n)
  }
  return set
}

// --- 4. role-tagged structure ------------------------------------------------

function checkRoleStructure(root, add) {
  const main = findMain(root)
  if (!main) return
  const svgNodes = svgDescendantSet(main)
  for (const n of findAll(main, isElement)) {
    if (n === main) continue
    if (svgNodes.has(n)) continue
    if (!ALLOWED_BODY_TAGS.has(n.tag)) {
      add('error', 'role-structure', `disallowed element in body: <${n.tag}>`)
      continue
    }
    const bad = classList(n).filter((c) => !c.startsWith('wu-') && !ALLOWED_NON_WU_CLASSES.has(c))
    if (bad.length) {
      add('error', 'role-structure', `<${n.tag}> has non-wu- class: ${bad.join(', ')}`)
    }
  }
}

// --- 5. kind's required sections (warn) -------------------------------------

function checkKindSections(root, add) {
  const kind = headMeta(root).kind
  const required = KIND_SECTIONS[kind]
  if (!required) return
  const headings = findAll(root, (n) => tagName(n) === 'h2').map((n) => textContent(n).trim())
  for (const section of required) {
    if (!headings.some((h) => h.includes(section))) {
      add('warn', 'kind-sections', `missing required h2 for kind "${kind}": ${section}`)
    }
  }
}

// --- 6. figure pass marks ----------------------------------------------------

function checkFigures(root, add) {
  const figures = findAll(root, (n) => isElement(n) && hasClass(n, 'wu-figure'))
  figures.forEach((fig, i) => {
    if (attr(fig, 'data-checks') !== 'pass') {
      const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
      const label = cap ? textContent(cap).trim() : `#${i + 1}`
      add('error', 'figure-pass', `.wu-figure "${label}" is missing data-checks="pass"`)
    }
  })
}

// --- 7. SVG a11y --------------------------------------------------------------

function checkSvgA11y(root, add) {
  const svgs = findAll(root, (n) => tagName(n) === 'svg')
  svgs.forEach((svg, i) => {
    const label = `svg #${i + 1}`
    if (attr(svg, 'role') !== 'img') add('error', 'svg-a11y', `${label}: missing role="img"`)
    const firstElementChild = (svg.children || []).find(isElement)
    if (!firstElementChild || tagName(firstElementChild) !== 'title') {
      add('error', 'svg-a11y', `${label}: first child element must be <title>`)
    }
    const desc = findFirst(svg, (n) => tagName(n) === 'desc')
    if (!desc || !textContent(desc).trim()) {
      add('error', 'svg-a11y', `${label}: <desc> is missing or empty`)
    }
    const badIds = findAll(svg, (n) => isElement(n) && attr(n, 'id'))
      .map((n) => attr(n, 'id'))
      .filter((id) => !id.startsWith('wu-d-'))
    if (badIds.length) {
      add('error', 'svg-a11y', `${label}: id(s) not prefixed "wu-d-": ${badIds.join(', ')}`)
    }
  })
}

// --- 8. accent budget ---------------------------------------------------------

function checkAccentBudget(root, add) {
  const accents = findAll(root, (n) => isElement(n) && hasClass(n, 'wu-accent'))
  if (accents.length > 1) {
    add('warn', 'accent-budget', `.wu-accent appears ${accents.length} times (budget: 1)`)
  }
}

// --- 9. emoji / arrow characters ----------------------------------------------

function checkEmojiArrows(root, add) {
  const main = findMain(root)
  if (!main) return
  const text = textContent(main)
  if (EMOJI_RE.test(text)) add('warn', 'emoji', 'body text contains an emoji character')
  if (ARROW_RE.test(text)) add('warn', 'emoji', 'body text contains an arrow character')
}

// --- 10. consecutive callouts --------------------------------------------------

function checkCalloutRuns(root, add) {
  const main = findMain(root)
  if (!main) return
  for (const parent of findAll(main, isElement)) {
    let run = 0
    for (const child of elementChildren(parent)) {
      if (hasClass(child, 'wu-callout')) {
        run++
        if (run >= 3) {
          add('warn', 'callout-run', `3 or more .wu-callout in a row under <${parent.tag}>`)
          break
        }
      } else {
        run = 0
      }
    }
  }
}

// --- 11. table column counts ----------------------------------------------------

function tableColumnCount(table) {
  const headRow = findFirst(table, (n) => tagName(n) === 'tr')
  if (!headRow) return 0
  return elementChildren(headRow).filter((n) => tagName(n) === 'th' || tagName(n) === 'td').length
}

function checkTableColumns(root, add) {
  for (const t of findAll(root, (n) => isElement(n) && hasClass(n, 'wu-table'))) {
    const cols = tableColumnCount(t)
    if (cols > 5) add('warn', 'table-columns', `.wu-table has ${cols} columns (max 5)`)
  }
  for (const t of findAll(root, (n) => isElement(n) && hasClass(n, 'wu-compare'))) {
    const cols = tableColumnCount(t)
    if (cols > 4) add('warn', 'table-columns', `.wu-compare has ${cols} columns (max 4)`)
  }
}

// --- sentence extraction (shared by 12 and 13) --------------------------------

// Each of these is its own text run: a real prose block boundary. Text is
// never concatenated across two of these (e.g. two adjacent <p> — one
// missing its closing 。 — must not merge into one run and misread as a
// single long sentence; see the regression test in self-check.test.mjs).
const PROSE_BLOCK_TAGS = new Set(['p', 'li', 'dt', 'dd', 'figcaption', 'h2', 'h3', 'h4'])

// Subtrees whose text is never prose: code/pre/script (diagram IR, code
// samples), `.wu-meta` (a citation/path line, not prose), `table` (cell
// values, not sentences), `nav` (`.wu-toc` link labels, not sentences),
// `blockquote` (`.wu-quote`'s original/translated excerpt is someone
// else's writing, not the page author's prose, and the original may not
// even use full-width 。！？), and `svg` (diagram markup, not prose).
const PROSE_SKIP_TAGS = new Set(['pre', 'code', 'table', 'nav', 'blockquote', 'script', 'svg'])

/** A block element's own text, recursing into inline descendants (e.g. a
 * <p>'s <strong>/<a>/<em>) but stopping at a nested prose-block tag (it
 * gets its own separate run — e.g. a <li> containing a nested <ul><li>)
 * or a skip subtree. */
function blockOwnText(node, skip) {
  let text = ''
  for (const child of node.children || []) {
    if (child.type === 'text') { text += child.value; continue }
    if (!isElement(child) || skip.has(child) || PROSE_BLOCK_TAGS.has(child.tag)) continue
    text += blockOwnText(child, skip)
  }
  return text
}

/** One text run per prose block element in <main> (contract §5's
 * sentence-length/parentheses rows read each block independently — see
 * PROSE_BLOCK_TAGS/PROSE_SKIP_TAGS above). */
function mainProseBlocks(root) {
  const main = findMain(root)
  if (!main) return []
  const skip = new Set()
  for (const n of findAll(main, (n) => isElement(n) && (PROSE_SKIP_TAGS.has(n.tag) || hasClass(n, 'wu-meta')))) {
    for (const d of findAll(n, () => true)) skip.add(d)
  }
  const blocks = []
  for (const n of findAll(main, (n) => isElement(n) && PROSE_BLOCK_TAGS.has(n.tag))) {
    if (skip.has(n)) continue
    blocks.push(blockOwnText(n, skip))
  }
  return blocks
}

function splitSentences(text) {
  return text
    .split(/[。！？]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// --- 12. sentence length --------------------------------------------------------

function checkSentenceLength(blocks, add) {
  for (const block of blocks) {
    for (const s of splitSentences(block)) {
      const len = [...s].length
      if (len > 120) {
        add('error', 'sentence-length', `sentence over 120 chars (${len}): ${s.slice(0, 40)}…`)
      } else if (len > 80) {
        add('warn', 'sentence-length', `sentence over 80 chars (${len}): ${s.slice(0, 40)}…`)
      }
    }
  }
}

// --- 13. parenthetical annotations -----------------------------------------------

function checkParentheticals(blocks, add) {
  for (const block of blocks) {
    for (const s of splitSentences(block)) {
      const matches = s.match(PAREN_RE)
      if (matches && matches.length >= 2) {
        add('warn', 'parentheticals', `sentence has ${matches.length} parenthetical groups: ${s.slice(0, 40)}…`)
      }
    }
  }
}

// --- 14. Markdown-convertibility --------------------------------------------------

// Elements the §7 HTML→Markdown mapping recognizes on their own (a bare tag,
// independent of class) plus the wu-* component classes it maps by name.
const MD_MAPPED_TAGS = new Set([
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'pre', 'code', 'figure', 'figcaption', 'blockquote', 'section', 'div',
  'span', 'a', 'strong', 'em', 'br', 'svg', 'script', 'cite', 'nav',
])
const MD_MAPPED_CLASSES = new Set([
  'wu-lede', 'wu-summary', 'wu-terms', 'wu-callout', 'wu-decision', 'wu-compare', 'wu-table',
  'wu-steps', 'wu-figure', 'wu-quote', 'wu-quote-original', 'wu-quote-ja', 'wu-quote-source',
  'wu-code', 'wu-diff', 'wu-chip', 'wu-meta', 'wu-open', 'wu-accent', 'wu-section', 'wu-focal',
  'wu-eyebrow', 'wu-toc',
])

function checkMarkdownConvertibility(root, add) {
  const main = findMain(root)
  if (!main) return
  const svgNodes = svgDescendantSet(main)
  for (const n of findAll(main, isElement)) {
    if (n === main || svgNodes.has(n)) continue
    if (!MD_MAPPED_TAGS.has(n.tag)) {
      add('warn', 'markdown-convertibility', `<${n.tag}> is outside the §7 HTML→Markdown mapping`)
      continue
    }
    const unmappedClasses = classList(n).filter((c) => c.startsWith('wu-') && !MD_MAPPED_CLASSES.has(c))
    if (unmappedClasses.length) {
      add('warn', 'markdown-convertibility', `<${n.tag}> class not in the §7 mapping: ${unmappedClasses.join(', ')}`)
    }
  }
}

// --- write-meta ---------------------------------------------------------------

/** Upsert `<meta name="checks" content="…">`, merging with any existing
 * key=value pairs (e.g. `lint=pass`) rather than clobbering them. Done as a
 * narrow text patch, not a full HTML re-serialization, so nothing else in
 * the file's bytes changes. */
export function writeMetaChecks(filePath, ok) {
  const raw = readFileSync(filePath, 'utf8')
  const re = /(<meta\s+name="checks"\s+content=")([^"]*)("\s*>)/
  const m = re.exec(raw)
  const status = ok ? 'pass' : 'fail'
  if (m) {
    const pairs = m[2].split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
      const idx = s.indexOf('=')
      return idx === -1 ? [s, ''] : [s.slice(0, idx), s.slice(idx + 1)]
    })
    let found = false
    const merged = pairs.map(([k, v]) => {
      if (k === 'self-check') { found = true; return [k, status] }
      return [k, v]
    })
    if (!found) merged.push(['self-check', status])
    const content = merged.map(([k, v]) => `${k}=${v}`).join(';')
    const patched = raw.slice(0, m.index) + m[1] + content + m[3] + raw.slice(m.index + m[0].length)
    writeFileSync(filePath, patched)
    return
  }
  // No existing checks meta: insert one right before </head>.
  const headClose = raw.indexOf('</head>')
  const insertion = `<meta name="checks" content="self-check=${status}">\n`
  if (headClose === -1) {
    writeFileSync(filePath, insertion + raw)
  } else {
    writeFileSync(filePath, raw.slice(0, headClose) + insertion + raw.slice(headClose))
  }
}

// --- CLI ------------------------------------------------------------------

function formatHuman(result) {
  const lines = []
  for (const i of result.items) lines.push(`${i.level}: ${i.item} — ${i.detail}`)
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { file: null, json: false, writeMeta: false }
  const positional = []
  for (const a of argv) {
    if (a === '--json') args.json = true
    else if (a === '--write-meta') args.writeMeta = true
    else positional.push(a)
  }
  args.file = positional[0] ?? null
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('usage: node bin/self-check.mjs <page.html> [--json] [--write-meta]')
    return 2
  }
  if (!existsSync(args.file)) {
    console.error(`error: file not found: ${args.file}`)
    return 2
  }
  const result = runSelfCheck(args.file)
  if (result.unreadable) {
    console.error(`error: ${result.message}`)
    return 2
  }
  if (args.writeMeta) writeMetaChecks(args.file, result.ok)
  if (args.json) {
    console.log(JSON.stringify({ ok: result.ok, errors: result.errors, warnings: result.warnings, items: result.items }, null, 2))
  } else {
    const out = formatHuman(result)
    if (out) console.log(out)
    else console.log('self-check: no findings')
  }
  return result.ok ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
