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

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  parseHtml, findAll, findFirst, isElement, tagName, attr, classList, hasClass,
  elementChildren, textContent, headMeta, titleText, externalRefs,
  structuralSignature, signaturesEqual,
} from './lib/html.mjs'
import { discoverStoreRoot, pageId } from './lib/store.mjs'
import { resolvePageAsset } from './lib/assets.mjs'
import { SIDETOC_SCRIPT } from './build.mjs'

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
  // <mark> is emitted only by bin/lib/diffview.mjs, for the changed middle
  // of a paired add/del line inside a .wu-diffview table — allowed there and
  // nowhere else (see `checkRoleStructure`).
  'mark',
  // <img> is allowed only inside a <figure class="wu-shot"> — a screenshot
  // or photo, the one place a bare raster image belongs (see
  // `checkRoleStructure` and the `shot` row, `checkShot`).
  'img',
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

// --- hints (appended to a finding's detail by `add`, see runSelfCheckText) --
//
// Keyed by `item`. A plain string is appended verbatim; a function receives
// the finding's own `detail` text so a single item with several distinct
// causes (role-structure, shot) can point at the right fix for each one.
// `diffview-unrendered` is deliberately absent: its own detail text already
// says "run build", so a second hint tail would only repeat it.
const HINTS = {
  'role-structure': (detail) => (/<img>/.test(detail)
    ? 'put it in <figure class="wu-shot"> with src under <slug>-assets/ or a data: URI — components.md'
    : 'use a role-named .wu-* component from components.md'),
  'single-file': 'copy the file next to the page (<slug>-assets/) or use a data: URI; external hosts are never fetched',
  'kit-css': 'run build; a page handed outside the store must be publish.mjs / pr-pack.mjs output, never the store file',
  'required-meta': 'add the missing tag next to the others in <head> — see kit/template.html',
  'chrome': 'copy .wu-header/.wu-footer verbatim from kit/template.html and change only the text',
  'figure-pass': 're-render with render-diagram.mjs --figure and paste its <figure> as-is',
  'svg-a11y': 'never hand-edit generated diagram markup — re-render with render-diagram.mjs --figure',
  'accent-budget': 'keep exactly one .wu-accent on the page; move the emphasis into the prose instead of adding a second',
  'shot': (detail) => {
    if (/is missing alt text/.test(detail)) return 'add alt text describing what the screenshot shows'
    if (/has no <img>/.test(detail)) return 'add the <img> — components.md .wu-shot'
    if (/has \d+ <img> elements/.test(detail)) return 'one picture per figure — split a before/after into two .wu-shot figures'
    if (/is not page-relative or a data: URI/.test(detail)) return 'move the file into <slug>-assets/ next to the page, or inline it as a data: URI'
    if (/escapes the page.s own directory/.test(detail)) return 'keep the file (and, if it\'s a symlink, its real target) under the page\'s own directory, never above <slug>-assets/'
    if (/image file does not exist/.test(detail)) return 'save the file into <slug>-assets/ next to the page, at that exact path'
    if (/images total/.test(detail)) return 'compress the screenshot(s) or crop to the relevant area'
    return 'see components.md .wu-shot'
  },
}

function hintFor(item, detail) {
  const h = HINTS[item]
  if (!h) return null
  return typeof h === 'function' ? h(detail) : h
}

export function runSelfCheck(filePath) {
  let raw
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (e) {
    return { unreadable: true, message: `cannot read file: ${filePath} (${e.message})` }
  }
  return runSelfCheckText(raw, filePath)
}

/** Runs every self-check row over `raw` as if it were the content of
 * `filePath` — the path only feeds the rows that look at the page's
 * location (kit CSS href depth, `id` meta vs. store-relative path). Used by
 * `publish.mjs` to check the rendered, not-yet-written staging text. */
export function runSelfCheckText(raw, filePath) {
  const items = []
  // Every error-level finding (and a few high-value warn ones) gets an
  // actionable "→ …" tail appended to its detail text — the finding names
  // the problem, the hint names the fix, so a caller never has to guess
  // "disallowed <img> — then how do I show a picture?" on their own. Hint
  // text stays inside `detail`, so `--json`'s shape (and any test doing a
  // regex/substring match against it) is unaffected; only tests asserting
  // an *exact* detail string would need updating, and none do today.
  const add = (level, item, detail) => {
    const base = detail ?? ''
    const hint = hintFor(item, base)
    items.push({ level, item, detail: hint ? (base ? `${base} → ${hint}` : hint) : base })
  }

  let root
  try {
    root = parseHtml(raw)
  } catch (e) {
    return { unreadable: true, message: `cannot parse HTML: ${e.message}` }
  }

  checkSingleFile(root, add)
  checkKitCss(root, filePath, add)
  checkInlineScripts(root, add)
  checkRequiredMeta(root, add)
  checkIdMeta(root, filePath, add)
  checkUpdatedFormat(root, add)
  checkChrome(root, add)
  checkRoleStructure(root, add)
  checkKindSections(root, add)
  checkFigures(root, add)
  checkShot(root, filePath, add)
  checkDiffViews(root, add)
  checkSvgA11y(root, add)
  checkAccentBudget(root, add)
  checkEmojiArrows(root, add)
  checkCalloutRuns(root, add)
  checkTableColumns(root, add)
  checkLabelRepeat(root, add)
  checkDecisionRecord(root, add)
  const proseBlocks = mainProseBlocks(root)
  checkSentenceLength(proseBlocks, add)
  checkParentheticals(proseBlocks, add)
  checkMarkdownConvertibility(root, add)

  const errors = items.filter((i) => i.level === 'error')
  const warnings = items.filter((i) => i.level === 'warn')
  const infos = items.filter((i) => i.level === 'info')
  return { unreadable: false, ok: errors.length === 0, errors, warnings, infos, items }
}

// --- 1. single file / allowed externals -------------------------------------

function checkSingleFile(root, add) {
  for (const ref of externalRefs(root)) {
    const url = ref.url
    if (ref.tag === 'img') {
      // A .wu-shot image lives next to the page (`<slug>-assets/…`) or is
      // inlined as a data: URI — never fetched from an external host. Its
      // existence on disk, alt text, and one-per-figure rule are checked
      // separately by `checkShot`; this row only screens the URL shape.
      if (url.startsWith('data:') || isPageRelativeUrl(url)) continue
      add('error', 'single-file', `img references disallowed external URL: ${url}`)
      continue
    }
    if (isAllowedExternal(url)) continue
    if (ref.tag === 'link' && attr(ref.node, 'rel') === 'icon') {
      // The status favicon (page-contract.md §1) is a data: URI build.mjs
      // upserts on every page — allowed here specifically because it is
      // inline, not a fetch to an external host. Any other icon href
      // (a real external file) is still rejected like any other link.
      if (url.startsWith('data:')) continue
      add('error', 'single-file', `icon link references disallowed non-data URL: ${url}`)
      continue
    }
    add('error', 'single-file', `${ref.tag} references disallowed external URL: ${url}`)
  }
}

const KIT_CSS_DEPTH_RE = /^(?:\.\.\/)*_kit\/writeup\.css$/
const KIT_CSS_SIBLING_RE = /^(?:\.\/)?writeup\.css$/

/**
 * A page must actually link the store's kit stylesheet
 * (`…/_kit/writeup.css`, `./_kit/writeup.css` at the store root) — a page
 * started from `kit/template.html` keeps that file's own sibling link
 * (`./writeup.css`) and renders completely unstyled inside a store, which
 * nothing else notices. The sibling form is accepted only for a page that
 * really does sit next to a `writeup.css` on disk: the kit's own reference
 * pages (`kit/template.html`, `kit/samples.html`). A page carrying an
 * inline `<style>` (a publish target, whose CSS was inlined) is exempt.
 * `build` repairs the href; this row is the gate for a page that never
 * went through `build`.
 */
function checkKitCss(root, filePath, add) {
  // A publish target (contract §6-2) carries the kit CSS inlined in a
  // <style> block and drops the link on purpose — nothing to resolve.
  if (findFirst(root, (n) => isElement(n) && n.tag === 'style')) return
  const links = findAll(root, (n) => isElement(n) && n.tag === 'link' && (attr(n, 'rel') || '') === 'stylesheet')
  const hrefs = links.map((n) => attr(n, 'href') || '').filter((h) => !/^https?:/.test(h))
  const siblingCss = join(dirname(filePath), 'writeup.css')
  const ok = hrefs.some((h) => KIT_CSS_DEPTH_RE.test(h) || h === './_kit/writeup.css' || (KIT_CSS_SIBLING_RE.test(h) && existsSync(siblingCss)))
  if (ok) return
  if (!hrefs.length) {
    add('error', 'kit-css', 'no stylesheet link — the page must link the store kit CSS (../_kit/writeup.css)')
    return
  }
  add('error', 'kit-css', `stylesheet link does not resolve to the store kit CSS: ${hrefs.join(', ')} (expected ../_kit/writeup.css at this page's depth)`)
}

// The MIME types a browser executes; every other `type` marks the block as
// inert data (the `.wu-figure` IR block's `text/x-writeup-diagram`).
const JS_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module'])

/**
 * A page may carry exactly one executable `<script>`: the side-TOC scroll
 * spy `build` injects, pinned to `SIDETOC_SCRIPT`'s source (page-contract.md
 * §1 rewrite point 7, §4). Anything else executable — a hand-written
 * snippet, an analytics tag, a second copy — is an error, so a store page
 * stays a document rather than an app.
 */
function checkInlineScripts(root, add) {
  let pinned = 0
  for (const node of findAll(root, (n) => isElement(n) && n.tag === 'script')) {
    const type = (attr(node, 'type') || '').trim().toLowerCase()
    if (!JS_SCRIPT_TYPES.has(type)) continue
    if (textContent(node).trim() === SIDETOC_SCRIPT.trim()) {
      pinned++
      if (pinned > 1) add('error', 'inline-script', "the page carries build's side-TOC script more than once")
      continue
    }
    add('error', 'inline-script', "executable <script> that is not build's pinned side-TOC script")
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

/** No scheme (so not `data:`, `http:`, `https:`, …) and no leading `/` —
 * the shape a `.wu-shot` `src` must have to be "next to the page" rather
 * than a fetch to an external host. Escaping above the page's own
 * directory via `../` (or a symlink pointing outside it) is checked
 * separately, where a page path is available (`resolvePageAsset`,
 * `checkShot`). */
function isPageRelativeUrl(url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false
  if (url.startsWith('/')) return false
  return true
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

// --- 2b. id meta (optional; must match the computed value when present) -----

/** `<meta name="id">` is optional. When present, it must equal the
 * path-derived id (contract §1-3: `pageId` = first 8 hex chars of
 * sha256(store-relative path)) — a warn, not an error, since a mismatch
 * doesn't break anything the page itself does, only cross-page lookups by
 * id. Verification needs the page's store-relative path, so it only runs
 * when `filePath` resolves under a store (an ancestor `.writeup.toml`) —
 * a page checked outside any known store skips this row silently rather
 * than guessing. */
function checkIdMeta(root, filePath, add) {
  const meta = headMeta(root)
  if (meta.id === undefined || meta.id === '') return
  const storeRoot = discoverStoreRoot(dirname(resolve(filePath)))
  if (!storeRoot) return
  const relPath = relative(storeRoot, resolve(filePath)).split(sep).join('/')
  const expected = pageId(relPath)
  if (meta.id !== expected) {
    add('warn', 'id-meta', `<meta name="id"> is "${meta.id}", expected "${expected}" (computed from ${relPath})`)
  }
}

// --- 2c. updated meta format --------------------------------------------------

const UPDATED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UPDATED_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/

/** `<meta name="updated">` may be a bare date (`YYYY-MM-DD`) or an ISO
 * datetime with minutes (`YYYY-MM-DDTHH:MM+09:00` / `...Z`) — both are
 * accepted; anything else is a warn. */
function checkUpdatedFormat(root, add) {
  const meta = headMeta(root)
  if (meta.updated === undefined || meta.updated === '') return
  if (UPDATED_DATE_RE.test(meta.updated) || UPDATED_DATETIME_RE.test(meta.updated)) return
  add('warn', 'updated-format', `<meta name="updated"> is not YYYY-MM-DD or YYYY-MM-DDTHH:MM(+TZ|Z): ${meta.updated}`)
}

// --- 3. chrome matches template ---------------------------------------------

/** `true` for a structural-signature child that is `<nav class="wu-nav">`
 * (the back-to-index link `build` inserts/rewrites as `.wu-header`'s first
 * child — page-contract.md §1). */
function isNavSig(childSig) {
  return !!childSig && childSig.tag === 'nav' && childSig.classes.includes('wu-nav')
}

let cachedTemplateSignatures = null
function templateSignatures() {
  if (cachedTemplateSignatures) return cachedTemplateSignatures
  const text = readFileSync(KIT_TEMPLATE_PATH, 'utf8')
  const tplRoot = parseHtml(text)
  const header = findFirst(tplRoot, (n) => isElement(n) && hasClass(n, 'wu-header'))
  const footer = findFirst(tplRoot, (n) => isElement(n) && hasClass(n, 'wu-footer'))
  const headerSig = header ? structuralSignature(header) : null
  let nav = null
  let headerWithoutNav = headerSig
  if (headerSig && isNavSig(headerSig.children[0])) {
    nav = headerSig.children[0]
    headerWithoutNav = { ...headerSig, children: headerSig.children.slice(1) }
  }
  cachedTemplateSignatures = {
    headerWithoutNav,
    nav,
    footer: footer ? structuralSignature(footer) : null,
  }
  return cachedTemplateSignatures
}

/** `.wu-header` must match the template once its optional `.wu-nav` first
 * child is set aside: `build` inserts/rewrites that nav's `href` for a
 * page's depth (page-contract.md §1), so this row has to accept a header
 * both before a page has been built (no nav yet) and after (nav present,
 * any href — `structuralSignature` already carries no attrs, so the href
 * itself is never compared). A present nav's own shape (`nav > a.wu-back`)
 * is still checked against the template's, so a malformed or misplaced nav
 * is still a chrome error. */
function checkChrome(root, add) {
  const tpl = templateSignatures()
  const header = findFirst(root, (n) => isElement(n) && hasClass(n, 'wu-header'))
  const footer = findFirst(root, (n) => isElement(n) && hasClass(n, 'wu-footer'))
  if (!header) {
    add('error', 'chrome', 'missing .wu-header')
  } else {
    const sig = structuralSignature(header)
    const hasNav = isNavSig(sig.children[0])
    const rest = hasNav ? { ...sig, children: sig.children.slice(1) } : sig
    const restOk = signaturesEqual(rest, tpl.headerWithoutNav)
    const navOk = !hasNav || !tpl.nav || signaturesEqual(sig.children[0], tpl.nav)
    if (!restOk || !navOk) {
      add('error', 'chrome', '.wu-header structure does not match kit/template.html')
    }
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

/** Every element inside `main`'s subtree that sits under a
 * `<figure class="wu-diffview">` — the one place `<mark>` is legitimate,
 * since `bin/lib/diffview.mjs` emits it for a changed line's middle. A
 * `<mark>` anywhere else is a writer highlighting prose, which the kit's
 * two-color rule does not allow. */
function diffViewDescendantSet(main) {
  const set = new Set()
  for (const fig of findAll(main, (n) => isElement(n) && hasClass(n, 'wu-diffview'))) {
    for (const n of findAll(fig, () => true)) set.add(n)
  }
  return set
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

/** Every element inside `main`'s subtree that sits under a
 * `<figure class="wu-shot">` — the one place a bare `<img>` is legitimate
 * (a screenshot or photo, its file next to the page in `<slug>-assets/`, or
 * a `data:` URI). An `<img>` anywhere else is a disallowed body element
 * (see `checkRoleStructure`); the figure's own contract — alt text, src
 * shape, file existence, one image per figure — is `checkShot`'s job. */
function shotDescendantSet(main) {
  const set = new Set()
  for (const fig of findAll(main, (n) => isElement(n) && hasClass(n, 'wu-shot'))) {
    for (const n of findAll(fig, () => true)) set.add(n)
  }
  return set
}

// --- 4. role-tagged structure ------------------------------------------------

function checkRoleStructure(root, add) {
  const main = findMain(root)
  if (!main) return
  const svgNodes = svgDescendantSet(main)
  const diffViewNodes = diffViewDescendantSet(main)
  const shotNodes = shotDescendantSet(main)
  for (const n of findAll(main, isElement)) {
    if (n === main) continue
    if (svgNodes.has(n)) continue
    if (!ALLOWED_BODY_TAGS.has(n.tag)) {
      add('error', 'role-structure', `disallowed element in body: <${n.tag}>`)
      continue
    }
    if (n.tag === 'mark' && !diffViewNodes.has(n)) {
      add('error', 'role-structure', '<mark> outside a .wu-diffview — the kit has no prose highlight')
      continue
    }
    if (n.tag === 'img' && !shotNodes.has(n)) {
      add('error', 'role-structure', '<img> outside a .wu-shot — the kit has no bare image')
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

// --- 6. figure pass marks / budget warnings -----------------------------------
//
// `data-checks="pass"` is the gate (verified geometry). `data-warn` is the
// renderer's note that the figure is over a budget (nodes/edges/groups/
// edge-label length — guidance, not a gate): it still passes, but the
// author should consider splitting it, so it is reported as a warn row
// carrying the renderer's own text (e.g. `budget:nodes=11`).

function checkFigures(root, add) {
  const figures = findAll(root, (n) => isElement(n) && hasClass(n, 'wu-figure'))
  figures.forEach((fig, i) => {
    const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
    const label = cap ? textContent(cap).trim() : `#${i + 1}`
    if (attr(fig, 'data-checks') !== 'pass') {
      add('error', 'figure-pass', `.wu-figure "${label}" is missing data-checks="pass"`)
      return
    }
    const warn = attr(fig, 'data-warn')
    if (warn) {
      add('warn', 'figure-budget', `.wu-figure "${label}" is over budget (${warn}) — consider splitting the figure`)
    }
  })
}

// --- 6b. .wu-shot (screenshot / photo) ---------------------------------------
//
// Contract: one `<img>` per `<figure class="wu-shot">`, `alt` required, and
// a `src` that is either page-relative (resolves under the page's own
// directory — the `<slug>-assets/` convention, never above it) or a `data:`
// URI. Existence is checked on disk, resolved against the page's own
// directory (`dirname(filePath)` — the same basis `checkKitCss`'s sibling
// lookup and `checkIdMeta`'s store-relative path both already use, so a
// page checked from any cwd resolves its own assets the same way).

const SHOT_TOTAL_WARN_BYTES = 8 * 1024 * 1024

/** The byte size a `data:` URI's payload decodes to — base64 decoded when
 * the URI says so, percent-decoded otherwise — used only for the 8MB
 * budget warning, so an approximation on a malformed URI is fine. */
function dataUriByteSize(url) {
  const comma = url.indexOf(',')
  if (comma === -1) return Buffer.byteLength(url, 'utf8')
  const meta = url.slice('data:'.length, comma)
  const payload = url.slice(comma + 1)
  if (/;base64$/i.test(meta)) {
    try { return Buffer.from(payload, 'base64').length } catch { return Buffer.byteLength(payload, 'utf8') }
  }
  try { return Buffer.byteLength(decodeURIComponent(payload), 'utf8') } catch { return Buffer.byteLength(payload, 'utf8') }
}

function checkShot(root, filePath, add) {
  const main = findMain(root)
  if (!main) return
  const figures = findAll(main, (n) => isElement(n) && hasClass(n, 'wu-shot'))
  if (!figures.length) return
  const pageDir = dirname(filePath)
  let totalBytes = 0
  figures.forEach((fig, i) => {
    const cap = findFirst(fig, (n) => tagName(n) === 'figcaption')
    const capText = cap ? textContent(cap).trim() : ''
    const label = capText ? `"${capText}"` : `#${i + 1}`
    const imgs = findAll(fig, (n) => tagName(n) === 'img')
    if (imgs.length === 0) {
      add('error', 'shot', `.wu-shot ${label} has no <img>`)
      return
    }
    if (imgs.length > 1) {
      add('error', 'shot', `.wu-shot ${label} has ${imgs.length} <img> elements`)
    }
    for (const img of imgs) {
      if (!attr(img, 'alt')) {
        add('error', 'shot', `.wu-shot ${label}: <img> is missing alt text`)
      }
      const src = attr(img, 'src') || ''
      if (!src) {
        add('error', 'shot', `.wu-shot ${label}: <img> has no src`)
        continue
      }
      if (src.startsWith('data:')) {
        totalBytes += dataUriByteSize(src)
        continue
      }
      if (!isPageRelativeUrl(src)) {
        add('error', 'shot', `.wu-shot ${label}: <img src> is not page-relative or a data: URI: ${src}`)
        continue
      }
      const resolved = resolvePageAsset(pageDir, src)
      if (!resolved) {
        add('error', 'shot', `.wu-shot ${label}: <img src> escapes the page's own directory: ${src}`)
        continue
      }
      if (!existsSync(resolved)) {
        add('error', 'shot', `.wu-shot ${label}: image file does not exist: ${src}`)
        continue
      }
      try { totalBytes += statSync(resolved).size } catch { /* unreadable; not this row's concern */ }
    }
  })
  if (totalBytes > SHOT_TOTAL_WARN_BYTES) {
    const mb = (totalBytes / (1024 * 1024)).toFixed(1)
    add('warn', 'shot', `.wu-shot images total ${mb}MB — the Artifact tool's limit is 16MB after CSS inlining`)
  }
}

/** A `<figure class="wu-diffview">` whose body carries no rendered
 * `<table class="wu-dv">` means `build` never ran over the page, or the raw
 * diff failed to parse — either way the page ships raw diff text with
 * nothing rendered. */
function checkDiffViews(root, add) {
  for (const f of findAll(root, (n) => isElement(n) && hasClass(n, 'wu-diffview'))) {
    if (!findFirst(f, (n) => isElement(n) && hasClass(n, 'wu-dv'))) {
      add('error', 'diffview-unrendered', '.wu-diffview has no rendered .wu-dv table — run build')
    }
  }
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

// --- 11b. repeated generic label ------------------------------------------------
//
// `<p><strong>決定:</strong> …` repeated down the page is the card template
// showing through: the same label + colon on item after item. Two of the
// same label is a coincidence; three is a mould. Not kind-gated — the
// pattern is a writing tell wherever it appears (writing.md "Prohibitions").

const LABEL_COLON_RE = /^(.*?)\s*[:：]\s*$/

/** The label text of a `<p>` whose first non-blank child is a `<strong>`
 * ending in `:`/`：` (whitespace-only text before it is ignored), or null. */
function leadingLabel(p) {
  let first = null
  for (const child of p.children || []) {
    if (child.type === 'text' && !child.value.trim()) continue
    first = child
    break
  }
  if (!isElement(first) || first.tag !== 'strong') return null
  const m = LABEL_COLON_RE.exec(textContent(first).trim())
  if (!m || !m[1]) return null
  return m[1]
}

function checkLabelRepeat(root, add) {
  const main = findMain(root)
  if (!main) return
  const svgNodes = svgDescendantSet(main)
  const counts = new Map()
  for (const p of findAll(main, (n) => tagName(n) === 'p')) {
    if (svgNodes.has(p)) continue
    const label = leadingLabel(p)
    if (label === null) continue
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  for (const [label, n] of counts) {
    if (n >= 3) {
      add('warn', 'label-repeat', `<p><strong>${label}:</strong> appears ${n} times — a repeated generic label reads as a filled-in template; move what the label names into the heading or the prose`)
    }
  }
}

// --- 11c. decision record layout (kind 決定記録) ----------------------------------
//
// The layout kinds.md fixes for a 決定記録: a 一覧表 (`.wu-table`, first
// header 番号) before the first h2; each decision an `h3 id="d<n>"` whose
// text is the decision, followed by at least one `<p>` (the one-sentence
// summary, then the prose) and a `.wu-meta` basis line before the next
// heading; `.wu-decision` cards only for a design doc's 1–2 decisions,
// never for the list; and, once the list is long, one 決定の関係図.

const DECISION_H3_ID_RE = /^d\d+$/
const DECISION_SECTION_HEADING = '決まったこと'
// h2s that close the decisions span (theme h2s in between are allowed).
const DECISION_TAIL_HEADINGS = ['却下した案', '未決・前提', '次のステップ']
const DECISION_CARDS_MAX = 2
const RELATION_FIGURE_MIN_DECISIONS = 5

function headingText(n) {
  return textContent(n).replace(/\s+/g, ' ').trim()
}

function checkDecisionRecord(root, add) {
  if (headMeta(root).kind !== '決定記録') return
  const main = findMain(root)
  if (!main) return
  const svgNodes = svgDescendantSet(main)
  // Document order, SVG internals excluded.
  const flat = findAll(main, isElement).filter((n) => !svgNodes.has(n))

  // (c) decision-index: a 一覧表 before the first h2.
  const firstH2 = flat.findIndex((n) => n.tag === 'h2')
  const head = firstH2 === -1 ? flat : flat.slice(0, firstH2)
  const hasIndex = head.some((n) => hasClass(n, 'wu-table') && firstHeaderText(n) === '番号')
  if (!hasIndex) {
    add('warn', 'decision-index', 'no 一覧表 before the first h2 — a 決定記録 opens with a .wu-table (番号 / 決定 / タグ / 状態) whose 決定 cells link to each h3 id="d<n>"')
  }

  // (d) decision-cards: cards are for 1–2 decisions, not the list.
  const cards = flat.filter((n) => hasClass(n, 'wu-decision'))
  if (cards.length > DECISION_CARDS_MAX) {
    add('warn', 'decision-cards', `.wu-decision appears ${cards.length} times — cards are for 1–2 decisions; write the list as h3 + summary sentence + prose + .wu-meta`)
  }

  // (a) decision-shape: every decision h3 in the 決まったこと span.
  const spanStart = flat.findIndex((n) => n.tag === 'h2' && headingText(n).includes(DECISION_SECTION_HEADING))
  let decisionCount = 0
  if (spanStart !== -1) {
    let spanEnd = flat.length
    for (let i = spanStart + 1; i < flat.length; i++) {
      const n = flat[i]
      if (n.tag === 'h2' && DECISION_TAIL_HEADINGS.some((h) => headingText(n).includes(h))) { spanEnd = i; break }
    }
    const h3Idx = []
    for (let i = spanStart + 1; i < spanEnd; i++) if (flat[i].tag === 'h3') h3Idx.push(i)
    // h3s carrying id="d<n>" are the decisions; an h3 without one (the
    // 決定の関係図 heading) is not. A page that gave no h3 an id is checked
    // on every h3 instead, so a card-per-theme page still gets the row.
    const withId = h3Idx.filter((i) => DECISION_H3_ID_RE.test(attr(flat[i], 'id') || ''))
    const decisions = withId.length ? withId : h3Idx
    // Without ids the h3s are most likely theme headings over cards, so
    // the cards are the better decision count for the relation-figure row.
    decisionCount = withId.length || Math.max(h3Idx.length, cards.length)
    for (const i of decisions) {
      let paragraphs = 0
      let metas = 0
      for (let j = i + 1; j < spanEnd; j++) {
        const n = flat[j]
        if (n.tag === 'h2' || n.tag === 'h3') break
        if (hasClass(n, 'wu-meta')) metas++
        else if (n.tag === 'p') paragraphs++
      }
      if (paragraphs < 1 || metas < 1) {
        const missing = [paragraphs < 1 ? 'a <p>' : null, metas < 1 ? 'a .wu-meta basis line' : null].filter(Boolean).join(' and ')
        add('warn', 'decision-shape', `h3 "${headingText(flat[i]).slice(0, 40)}" is not followed by ${missing} before the next heading`)
      }
    }
  }

  // (e) relation-figure: a long list needs one 決定の関係図.
  if (decisionCount === 0) decisionCount = cards.length
  if (decisionCount >= RELATION_FIGURE_MIN_DECISIONS) {
    const hasRelation = flat.some((n) => hasClass(n, 'wu-figure') && findAll(n, (c) => tagName(c) === 'figcaption').some((c) => textContent(c).includes('関係')))
    if (!hasRelation) {
      add('info', 'relation-figure', `${decisionCount} decisions and no figure whose caption mentions 関係 — end the decisions with one 決定の関係図 (制約する / 可能にする / 競合する)`)
    }
  }
}

function firstHeaderText(table) {
  const headRow = findFirst(table, (n) => tagName(n) === 'tr')
  if (!headRow) return ''
  const cell = elementChildren(headRow).find((n) => tagName(n) === 'th' || tagName(n) === 'td')
  return cell ? textContent(cell).trim() : ''
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
  'span', 'a', 'strong', 'em', 'br', 'svg', 'script', 'cite', 'nav', 'mark',
  // <img> — the one child of .wu-shot; bin/to-md.mjs's renderShot maps it.
  'img',
])
const MD_MAPPED_CLASSES = new Set([
  'wu-lede', 'wu-summary', 'wu-terms', 'wu-callout', 'wu-decision', 'wu-compare', 'wu-table',
  'wu-steps', 'wu-figure', 'wu-shot', 'wu-quote', 'wu-quote-original', 'wu-quote-ja', 'wu-quote-source',
  'wu-code', 'wu-diff', 'wu-diffview', 'wu-dv', 'wu-chip', 'wu-meta', 'wu-open', 'wu-accent',
  'wu-section', 'wu-focal', 'wu-eyebrow', 'wu-toc', 'wu-sidetoc', 'wu-sidetoc-sub',
  // .wu-cells — one thing split into labelled parts; bin/to-md.mjs renders
  // the strip as one list item per row, so every class under it is covered
  // by the .wu-cells row of the §7 mapping.
  'wu-cells', 'wu-cells-title', 'wu-cells-row', 'wu-cells-label',
  'wu-cell', 'wu-cell-label', 'wu-cell-value', 'wu-cell-count', 'wu-cells-note',
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
    // wu-tok-* (bin/lib/highlight.mjs's token spans inside .wu-code/.wu-diff)
    // and wu-dv-* (diffview's rows, cells and word marks) are covered by the
    // .wu-code/.wu-diff and .wu-diffview mappings themselves — to-md reads
    // the block's own text, so these internal spans are invisible to
    // Markdown and never need their own §7 row.
    const unmappedClasses = classList(n).filter((c) => c.startsWith('wu-') && !c.startsWith('wu-tok-') && !c.startsWith('wu-dv-') && !MD_MAPPED_CLASSES.has(c))
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
    console.log(JSON.stringify({ ok: result.ok, errors: result.errors, warnings: result.warnings, infos: result.infos, items: result.items }, null, 2))
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
