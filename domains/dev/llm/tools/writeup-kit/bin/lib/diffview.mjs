// diffview.mjs — a real diff view for writeup pages: `parseUnifiedDiff()`
// turns raw unified-diff text into a per-file model, `renderDiffView()`
// turns that model into a `<table class="wu-dv">` per file (unified or
// split columns, line numbers, hunk headers, intra-line word marks), and
// `ensureDiffViews()` rewrites a page's `.wu-diffview` figures in place.
//
// Author-facing markup (what a writer puts in the page; `build` converts it
// in place, idempotently, and keeps the raw diff so it can be re-rendered
// after a kit upgrade — the same pattern `.wu-figure` uses for its diagram
// IR, see `bin/lib/ir-script.mjs`):
//
//   <figure class="wu-diffview" data-mode="unified" data-lang="go">
//   <script type="text/x-writeup-diff">
//   --- a/internal/order/service.go
//   +++ b/internal/order/service.go
//   @@ -12,7 +12,9 @@ func (s *Service) Place(
//   …
//   </script><figcaption>…</figcaption></figure>
//
// No color. Additions and deletions are told apart by the marker column
// (`+` / `−`), a background tint drawn from the neutral scale, and — for
// deletions only — muted ink. The kit allows exactly two chromatic colors
// (link, accent) and a diff must not spend either of them.
//
// This module is pure: no I/O, no globals, same input in, same string out.
// `parseUnifiedDiff()` is the one function that throws (on malformed input,
// naming the offending line); every renderer escapes everything it emits
// and never produces a raw `<`.

import { highlight } from './highlight.mjs'
import { escapeIrScript, unescapeIrScript } from './ir-script.mjs'

/** The minus sign (U+2212), not a hyphen: it aligns with `+` in a mono face. */
export const MINUS = '−'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strict inverse of `highlight()`'s escaping (it escapes `&`, `<`, `>` and
 * nothing else), applied in a single pass so a literal `&amp;` in the
 * source round-trips. */
function unescapeHl(s) {
  return s.replace(/&(amp|lt|gt);/g, (m) => (m === '&amp;' ? '&' : m === '&lt;' ? '<' : '>'))
}

// --- parsing -------------------------------------------------------------

const HUNK_RE = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+(?: ?(.*))?$/

function fail(lineNo, line, why) {
  const shown = line.length > 60 ? `${line.slice(0, 60)}…` : line
  throw new Error(`diff: ${why} at line ${lineNo}: ${JSON.stringify(shown)}`)
}

/** `--- a/x.go\t2026-01-01` → `x.go`; `/dev/null` → null. Strips the git
 * `a/`/`b/` prefix and the surrounding quotes git adds for odd names. */
function parsePath(rest) {
  let s = String(rest ?? '').replace(/\t.*$/, '').trim()
  if (!s || s === '/dev/null') return null
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  return s.replace(/^[ab]\//, '')
}

function newFile() {
  return {
    oldPath: null,
    newPath: null,
    hunks: [],
    added: 0,
    removed: 0,
    binary: false,
    renamed: false,
  }
}

/**
 * `parseUnifiedDiff(text)` → an array of file records:
 *
 *   { oldPath, newPath, hunks, added, removed, binary, renamed }
 *
 * with `hunks: [{ oldStart, oldLines, newStart, newLines, heading, rows }]`
 * and `rows: [{ kind: 'ctx'|'add'|'del', oldNo, newNo, text, noNewline? }]`.
 *
 * Tolerant of `diff --git` headers, `index`/mode lines, renames, binary
 * files, `\ No newline at end of file`, `git format-patch` preamble prose,
 * and of a bare hunk with no `---`/`+++` pair (then the file is unnamed:
 * both paths are null). Throws — naming the offending line — on empty
 * input, a diff with no hunks, a malformed `@@` header, an unrecognized
 * line prefix inside a hunk, or a hunk that ends before its declared line
 * counts are satisfied.
 */
export function parseUnifiedDiff(text) {
  const src = String(text ?? '')
  if (!src.trim()) throw new Error('diff: empty input (nothing to render)')
  const lines = src.split('\n')
  const files = []
  let cur = null

  const ensureFile = () => {
    if (!cur) { cur = newFile(); files.push(cur) }
    return cur
  }
  const startFile = () => { cur = newFile(); files.push(cur); return cur }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const lineNo = i + 1

    if (line.startsWith('diff --git ')) {
      const f = startFile()
      const m = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(line)
      if (m) { f.oldPath = parsePath(m[1]); f.newPath = parsePath(m[2]) }
      i++
      continue
    }
    if (/^(old|new) mode /.test(line) || line.startsWith('index ')) { ensureFile(); i++; continue }
    if (/^(new|deleted) file mode /.test(line)) { ensureFile(); i++; continue }
    if (line.startsWith('similarity index ') || line.startsWith('dissimilarity index ')) { ensureFile(); i++; continue }
    if (line.startsWith('rename from ')) {
      const f = ensureFile()
      f.renamed = true
      f.oldPath = parsePath(line.slice('rename from '.length))
      i++
      continue
    }
    if (line.startsWith('rename to ')) {
      const f = ensureFile()
      f.renamed = true
      f.newPath = parsePath(line.slice('rename to '.length))
      i++
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      ensureFile().binary = true
      i++
      continue
    }
    if (line.startsWith('--- ')) {
      // A second `---` for a file that already has hunks starts a new file
      // (a plain `diff -u` stream with no `diff --git` headers).
      const f = !cur || cur.hunks.length > 0 || cur.binary ? startFile() : cur
      f.oldPath = parsePath(line.slice(4))
      i++
      continue
    }
    if (line.startsWith('+++ ')) {
      const f = ensureFile()
      const p = parsePath(line.slice(4))
      if (!f.renamed || !f.newPath) f.newPath = p
      i++
      continue
    }
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line)
      if (!m) fail(lineNo, line, 'malformed hunk header')
      const f = ensureFile()
      const oldStart = Number(m[1])
      const oldLines = m[2] === undefined ? 1 : Number(m[2])
      const newStart = Number(m[3])
      const newLines = m[4] === undefined ? 1 : Number(m[4])
      const heading = (m[5] ?? '').trim()
      const hunk = { oldStart, oldLines, newStart, newLines, heading, rows: [] }
      f.hunks.push(hunk)

      let oldNo = oldStart
      let newNo = newStart
      let oldLeft = oldLines
      let newLeft = newLines
      let j = i + 1
      while (j < lines.length && (oldLeft > 0 || newLeft > 0)) {
        const body = lines[j]
        if (body.startsWith('\\')) {
          const last = hunk.rows[hunk.rows.length - 1]
          if (last) last.noNewline = true
          j++
          continue
        }
        const c = body === '' ? ' ' : body[0]
        const rest = body === '' ? '' : body.slice(1)
        if (c === ' ') {
          if (oldLeft <= 0 || newLeft <= 0) fail(j + 1, body, 'context line past the hunk line counts')
          hunk.rows.push({ kind: 'ctx', oldNo, newNo, text: rest })
          oldNo++; newNo++; oldLeft--; newLeft--
        } else if (c === '+') {
          if (newLeft <= 0) fail(j + 1, body, 'added line past the hunk line counts')
          hunk.rows.push({ kind: 'add', oldNo: null, newNo, text: rest })
          newNo++; newLeft--
          f.added++
        } else if (c === '-') {
          if (oldLeft <= 0) fail(j + 1, body, 'removed line past the hunk line counts')
          hunk.rows.push({ kind: 'del', oldNo, newNo: null, text: rest })
          oldNo++; oldLeft--
          f.removed++
        } else {
          fail(j + 1, body, `unrecognized line prefix ${JSON.stringify(c)} inside a hunk`)
        }
        j++
      }
      if (oldLeft > 0 || newLeft > 0) {
        fail(lineNo, line, `hunk ends early (${oldLeft} old / ${newLeft} new lines missing)`)
      }
      // Consume a trailing `\ No newline` that sits after the last counted line.
      while (j < lines.length && lines[j].startsWith('\\')) {
        const last = hunk.rows[hunk.rows.length - 1]
        if (last) last.noNewline = true
        j++
      }
      i = j
      continue
    }
    // Anything else outside a hunk (commit message, `--`, signature, blank
    // separator) is preamble noise and is skipped.
    i++
  }

  const usable = files.filter((f) => f.hunks.length > 0 || f.binary)
  if (usable.length === 0) {
    const firstReal = lines.find((l) => l.trim())
    throw new Error(`diff: no hunks found (nothing starting with "@@"); first line was ${JSON.stringify(firstReal ?? '')}`)
  }
  return usable
}

// --- language inference --------------------------------------------------

const EXT_LANG = {
  go: 'go',
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  sql: 'sql',
  yaml: 'yaml', yml: 'yaml',
  json: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python',
  toml: 'toml',
  html: 'html', htm: 'html', xml: 'xml',
}

/** The highlight language for a file, from its extension. `''` when the
 * extension is unknown (highlight() then plain-escapes, which is correct). */
export function inferLang(path) {
  const p = String(path ?? '')
  const dot = p.lastIndexOf('.')
  if (dot === -1 || dot === p.length - 1) return ''
  return EXT_LANG[p.slice(dot + 1).toLowerCase()] ?? ''
}

// --- word diff -----------------------------------------------------------

const WORD_CHAR = /[A-Za-z0-9_$]/

/** Pulls a common-prefix boundary back out of the middle of a word, so a
 * mark starts at a token edge instead of one character into an identifier. */
function snapPrefix(a, b, p) {
  while (p > 0 && WORD_CHAR.test(a[p - 1]) && (WORD_CHAR.test(a[p] ?? '') || WORD_CHAR.test(b[p] ?? ''))) p--
  return p
}

/** Same, for a common-suffix boundary (`sa`/`sb` are start offsets). */
function snapSuffix(a, b, sa, sb) {
  while (sa < a.length && WORD_CHAR.test(a[sa]) && (WORD_CHAR.test(a[sa - 1] ?? '') || WORD_CHAR.test(b[sb - 1] ?? ''))) {
    sa++; sb++
  }
  return [sa, sb]
}

/**
 * `wordDiffRanges(oldText, newText)` → `{ del: {start,end}, add: {start,end} }`
 * for the differing middle of a paired del/add line, or `null` when there is
 * nothing worth marking: the lines are identical, one side is empty, or the
 * change covers more than half of either line (a rewritten line reads better
 * whole than as one giant mark).
 */
export function wordDiffRanges(oldText, newText) {
  const a = String(oldText ?? '')
  const b = String(newText ?? '')
  if (a === b || !a || !b) return null

  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a[p] === b[p]) p++
  // The suffix scan may not run back past the prefix on either side.
  let s = 0
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const sa0 = a.length - s
  const sb0 = b.length - s

  // Suppression is judged on the *raw* character-level change, before the
  // word-boundary snap below widens the marks: a one-character typo fix is
  // a word edit even though the whole identifier ends up marked, and a
  // rewritten line stays a rewrite even if it happens to share a token.
  if (sa0 - p === 0 && sb0 - p === 0) return null
  if (sa0 - p > a.length / 2 || sb0 - p > b.length / 2) return null

  const start = snapPrefix(a, b, p)
  const [sa, sb] = snapSuffix(a, b, sa0, sb0)
  return {
    del: { start, end: Math.max(start, sa) },
    add: { start, end: Math.max(start, sb) },
  }
}

// --- highlight + marks ---------------------------------------------------

const TOK_RE = /<span class="wu-tok-([a-z]+)">([\s\S]*?)<\/span>/g

/** Splits `highlight()` output back into `{cls, text}` segments carrying the
 * *raw* (unescaped) text. Returns null when the segments do not reassemble
 * into the original source — the one invariant this pass depends on, so a
 * highlighter change can never silently shift the mark offsets. */
function segmentsOf(html, raw) {
  const segs = []
  let last = 0
  let m
  TOK_RE.lastIndex = 0
  while ((m = TOK_RE.exec(html)) !== null) {
    if (m.index > last) segs.push({ cls: null, text: unescapeHl(html.slice(last, m.index)) })
    segs.push({ cls: m[1], text: unescapeHl(m[2]) })
    last = m.index + m[0].length
  }
  if (last < html.length) segs.push({ cls: null, text: unescapeHl(html.slice(last)) })
  if (segs.map((s) => s.text).join('') !== raw) return null
  return segs
}

/**
 * `renderCodeCell(text, lang, range)` → the inner HTML of one code cell:
 * `text` highlighted, with `[range.start, range.end)` wrapped in
 * `<mark class="wu-dv-w">`.
 *
 * Order of operations: highlight the whole raw line first (so the tokenizer
 * sees complete strings, comments and identifiers), then split the resulting
 * token segments at the mark boundaries and re-emit. A mark boundary landing
 * inside a token splits that token into two spans of the same class, so the
 * `<mark>` always opens and closes *between* complete `<span>` elements —
 * tags stay properly nested and no highlight span is ever left unbalanced.
 */
export function renderCodeCell(text, lang, range) {
  const raw = String(text ?? '')
  const html = highlight(raw, lang)
  if (!range || range.end <= range.start) return html

  const segs = segmentsOf(html, raw) ?? [{ cls: null, text: raw }]
  const start = Math.max(0, Math.min(range.start, raw.length))
  const end = Math.max(start, Math.min(range.end, raw.length))

  let out = ''
  let pos = 0
  let markOpen = false
  for (const seg of segs) {
    const segStart = pos
    const segEnd = pos + seg.text.length
    pos = segEnd
    if (!seg.text) continue
    // Cut this segment at the mark boundaries that fall inside it.
    const cuts = [segStart, segEnd]
    for (const c of [start, end]) if (c > segStart && c < segEnd) cuts.push(c)
    cuts.sort((x, y) => x - y)
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]
      const b = cuts[k + 1]
      if (b <= a) continue
      const inMark = a >= start && b <= end
      if (inMark && !markOpen) { out += '<mark class="wu-dv-w">'; markOpen = true }
      if (!inMark && markOpen) { out += '</mark>'; markOpen = false }
      const piece = escapeHtml(seg.text.slice(a - segStart, b - segStart))
      out += seg.cls ? `<span class="wu-tok-${seg.cls}">${piece}</span>` : piece
    }
  }
  if (markOpen) out += '</mark>'
  return out
}

// --- rendering -----------------------------------------------------------

/** Groups a hunk's rows into context rows and del/add change blocks, so a
 * changed pair can share a split row and a word mark. */
function blocksOf(rows) {
  const blocks = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.kind === 'ctx') { blocks.push({ type: 'ctx', row: r }); i++; continue }
    const dels = []
    const adds = []
    while (i < rows.length && rows[i].kind === 'del') { dels.push(rows[i]); i++ }
    while (i < rows.length && rows[i].kind === 'add') { adds.push(rows[i]); i++ }
    if (dels.length === 0 && adds.length === 0) { i++; continue }
    blocks.push({ type: 'change', dels, adds })
  }
  return blocks
}

function pairRanges(dels, adds) {
  const n = Math.max(dels.length, adds.length)
  const out = []
  for (let k = 0; k < n; k++) {
    const d = dels[k]
    const a = adds[k]
    out.push(d && a ? wordDiffRanges(d.text, a.text) : null)
  }
  return out
}

const num = (n) => (n == null ? '' : String(n))

function noCell(n) {
  return `<td class="wu-dv-no">${escapeHtml(num(n))}</td>`
}

function fileLabel(file) {
  if (file.renamed && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return `${escapeHtml(file.oldPath)} <span class="wu-dv-arrow" aria-hidden="true">→</span> ${escapeHtml(file.newPath)}`
  }
  const p = file.newPath ?? file.oldPath
  if (!p) return '<span class="wu-dv-unnamed">(unnamed)</span>'
  return escapeHtml(p)
}

function fileNote(file) {
  if (file.binary) return 'binary'
  if (file.oldPath == null && file.newPath != null) return 'new file'
  if (file.newPath == null && file.oldPath != null) return 'deleted'
  return ''
}

function headerRow(file) {
  const note = fileNote(file)
  const noteHtml = note ? `<span class="wu-dv-note">${escapeHtml(note)}</span>` : ''
  const stat = file.binary ? '' : `<span class="wu-dv-stat">+${file.added} ${MINUS}${file.removed}</span>`
  return `<thead><tr class="wu-dv-file"><th colspan="4" scope="colgroup"><span class="wu-dv-path">${fileLabel(file)}</span>${noteHtml}${stat}</th></tr></thead>`
}

function hunkRow(hunk) {
  const counts = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  const heading = hunk.heading ? ` <span class="wu-dv-fn">${escapeHtml(hunk.heading)}</span>` : ''
  return `<tr class="wu-dv-hunk"><td colspan="4"><span class="wu-dv-at">${escapeHtml(counts)}</span>${heading}</td></tr>`
}

function nlNote(row) {
  return row.noNewline ? '<span class="wu-dv-nonl" title="No newline at end of file">↵</span>' : ''
}

function unifiedRow(row, lang, range) {
  const cls = row.kind === 'add' ? 'wu-dv-add' : row.kind === 'del' ? 'wu-dv-del' : 'wu-dv-ctx'
  const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? MINUS : ''
  const code = renderCodeCell(row.text, lang, range)
  return `<tr class="wu-dv-line ${cls}">${noCell(row.oldNo)}${noCell(row.newNo)}`
    + `<td class="wu-dv-mark" aria-hidden="true">${escapeHtml(mark)}</td>`
    + `<td class="wu-dv-code">${code}${nlNote(row)}</td></tr>`
}

function splitCells(row, side, lang, range) {
  if (!row) return `<td class="wu-dv-no wu-dv-blank"></td><td class="wu-dv-code wu-dv-blank"></td>`
  const cls = side === 'old' ? 'wu-dv-del' : 'wu-dv-add'
  const tint = row.kind === 'ctx' ? '' : ` ${cls}`
  const n = side === 'old' ? row.oldNo : row.newNo
  const code = renderCodeCell(row.text, lang, range)
  return `<td class="wu-dv-no${tint}">${escapeHtml(num(n))}</td>`
    + `<td class="wu-dv-code${tint}">${code}${nlNote(row)}</td>`
}

/**
 * `renderDiffView(files, { mode, lang })` → HTML: one
 * `<table class="wu-dv">` per file.
 *
 * `mode`: `'unified'` (default) — columns are old no / new no / marker /
 * code — or `'split'` — old no / old code / new no / new code, with a
 * changed del/add pair sharing one row and a lone add or del leaving the
 * other side blank. `lang` overrides the language inferred from the file
 * extension. Everything is escaped; the output never contains a raw `<`
 * from the diff text.
 */
export function renderDiffView(files, { mode = 'unified', lang } = {}) {
  const m = mode === 'split' ? 'split' : 'unified'
  const list = Array.isArray(files) ? files : [files]
  return list.map((file) => {
    const fileLang = lang || inferLang(file.newPath ?? file.oldPath)
    const rows = []
    for (const hunk of file.hunks) {
      rows.push(hunkRow(hunk))
      for (const block of blocksOf(hunk.rows)) {
        if (block.type === 'ctx') {
          const r = block.row
          rows.push(m === 'unified'
            ? unifiedRow(r, fileLang, null)
            : `<tr class="wu-dv-line wu-dv-ctx">${splitCells(r, 'old', fileLang, null)}${splitCells(r, 'new', fileLang, null)}</tr>`)
          continue
        }
        const ranges = pairRanges(block.dels, block.adds)
        if (m === 'unified') {
          block.dels.forEach((r, k) => rows.push(unifiedRow(r, fileLang, ranges[k]?.del ?? null)))
          block.adds.forEach((r, k) => rows.push(unifiedRow(r, fileLang, ranges[k]?.add ?? null)))
        } else {
          const n = Math.max(block.dels.length, block.adds.length)
          for (let k = 0; k < n; k++) {
            const d = block.dels[k] ?? null
            const a = block.adds[k] ?? null
            rows.push(`<tr class="wu-dv-line wu-dv-chg">${splitCells(d, 'old', fileLang, ranges[k]?.del ?? null)}${splitCells(a, 'new', fileLang, ranges[k]?.add ?? null)}</tr>`)
          }
        }
      }
    }
    const langAttr = fileLang ? ` data-lang="${escapeHtml(fileLang)}"` : ''
    const body = rows.length ? `\n<tbody>\n${rows.join('\n')}\n</tbody>` : ''
    return `<table class="wu-dv" data-mode="${m}"${langAttr}>\n${headerRow(file)}${body}\n</table>`
  }).join('\n')
}

/** `parseUnifiedDiff()` + `renderDiffView()` in one call. */
export function renderUnifiedDiff(text, opts = {}) {
  return renderDiffView(parseUnifiedDiff(text), opts)
}

// --- page-level pass -----------------------------------------------------

const FIGURE_RE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g
const DIFF_SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*"text\/x-writeup-diff"[^>]*>([\s\S]*?)<\/script>/
const FIGCAPTION_RE = /<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/

function attrValue(attrsStr, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrsStr)
  return m ? m[1] : null
}

/** The raw diff text a `.wu-diffview` figure carries, unescaped and stripped
 * of the one leading/trailing newline the `<script>\n…\n</script>` wrapper
 * adds. `null` when the figure carries no `text/x-writeup-diff` script. */
export function diffFigureText(inner) {
  const m = DIFF_SCRIPT_RE.exec(String(inner))
  if (!m) return null
  return unescapeIrScript(m[1].replace(/^\n/, '').replace(/\n$/, ''))
}

/**
 * `ensureDiffViews(text, { onError })` → the page text with every
 * `<figure class="wu-diffview">` re-rendered from the raw diff its
 * `text/x-writeup-diff` script carries. The figure's children are
 * normalized to tables → figcaption → script (the `.wu-figure` order), so
 * the pass is idempotent by construction: it always rebuilds from the
 * stored raw text, never from the rendered tables, and re-running it on its
 * own output yields the same bytes. A `data-mode` or `data-lang` edit
 * therefore takes effect on the next `build`.
 *
 * A figure with no diff script, or one whose diff fails to parse, is
 * returned byte-for-byte unchanged; `onError(message)` is called for the
 * latter so the caller can report it. Never throws.
 */
export function ensureDiffViews(text, { onError } = {}) {
  return String(text).replace(FIGURE_RE, (whole, attrsStr, inner) => {
    const classes = (attrValue(attrsStr, 'class') || '').split(/\s+/).filter(Boolean)
    if (!classes.includes('wu-diffview')) return whole
    const raw = diffFigureText(inner)
    if (raw === null) return whole
    const mode = attrValue(attrsStr, 'data-mode') === 'split' ? 'split' : 'unified'
    const lang = attrValue(attrsStr, 'data-lang') || undefined
    let tables
    try {
      tables = renderDiffView(parseUnifiedDiff(raw), { mode, lang })
    } catch (err) {
      if (typeof onError === 'function') onError(err && err.message ? err.message : String(err))
      return whole
    }
    const capMatch = FIGCAPTION_RE.exec(inner)
    const caption = capMatch ? `\n${capMatch[0]}` : ''
    const script = `\n<script type="text/x-writeup-diff">\n${escapeIrScript(raw)}\n</script>`
    return `<figure${attrsStr}>\n${tables}${caption}${script}\n</figure>`
  })
}
