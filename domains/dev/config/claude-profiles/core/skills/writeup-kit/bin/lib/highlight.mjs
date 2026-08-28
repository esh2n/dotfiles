// highlight.mjs — zero-dependency syntax highlighting for `.wu-code`/`.wu-diff`
// blocks (page-contract.md §5). `highlight(code, lang)` takes plain
// (already-unescaped) source text and returns HTML: the source
// HTML-escaped, with token runs wrapped in `<span class="wu-tok-*">`
// (kw/str/cmt/num/fn/type/op for code, add/del for diff line highlighting).
//
// Each language is a single left-to-right pass over the string (no lookahead
// beyond the current token, no backtracking-prone regexes) driven by a small
// per-language spec: comment markers, string-quote rules, a keyword/type
// word list, and (for go/js family) a "starts with an uppercase letter is a
// type" heuristic. `highlight()` never throws — a spec bug, an unknown
// language, or pathological input all fall back to plain HTML-escaping —
// because build.mjs calls this unattended over every page in the store.
//
// This module is pure: same (code, lang) in, same string out, every time.
// It does not know about `<pre>`/`data-hl`/idempotence — that guard (skip a
// block whose content already carries `wu-tok-` spans) lives in build.mjs,
// the only caller that rewrites page bytes.

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function span(cls, text) {
  if (!text) return ''
  return `<span class="wu-tok-${cls}">${escapeHtml(text)}</span>`
}

// --- shared scanners ---------------------------------------------------------

/** Scans a quoted string starting at `code[i]` (the opening `quote`).
 * Returns the exclusive end index. `raw`: no backslash-escape processing.
 * `multiline`: an unterminated line does not stop the scan. `doubleEscape`:
 * a doubled quote (`''`) inside the string is an escaped quote, not the
 * closing one (SQL's convention, used instead of backslash-escaping). */
function scanQuoted(code, i, quote, { raw = false, multiline = false, doubleEscape = false } = {}) {
  const n = code.length
  let j = i + 1
  while (j < n) {
    const c = code[j]
    if (!raw && c === '\\') { j += 2; continue }
    if (c === quote) {
      if (doubleEscape && code[j + 1] === quote) { j += 2; continue }
      return j + 1
    }
    if (!multiline && c === '\n') return j
    j++
  }
  return n
}

/** Scans a Python-style triple-quoted string (`code[i..i+3)` is `quote`
 * repeated 3x). Returns the exclusive end index. */
function scanTriple(code, i, quote) {
  const n = code.length
  const close = quote + quote + quote
  let j = i + 3
  while (j < n) {
    if (code[j] === '\\') { j += 2; continue }
    if (code.startsWith(close, j)) return j + 3
    j++
  }
  return n
}

const OP_RE = /^(?:===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|=>|::|->|[-+*/%<>=!&|^~])/

/** Single-pass tokenizer shared by every "real" language spec (everything
 * except html/diff/text, which have their own shapes). */
function tokenizeGeneric(code, spec) {
  const n = code.length
  let i = 0
  let out = ''
  let plain = ''
  const flush = () => { if (plain) { out += escapeHtml(plain); plain = '' } }

  while (i < n) {
    const c = code[i]

    // line comments
    let matched = false
    if (spec.lineComments) {
      for (const lc of spec.lineComments) {
        if (code.startsWith(lc, i)) {
          const nl = code.indexOf('\n', i)
          const end = nl === -1 ? n : nl
          flush(); out += span('cmt', code.slice(i, end)); i = end; matched = true
          break
        }
      }
    }
    if (matched) continue

    // block comments
    if (spec.blockComments) {
      for (const [open, close] of spec.blockComments) {
        if (code.startsWith(open, i)) {
          const idx = code.indexOf(close, i + open.length)
          const end = idx === -1 ? n : idx + close.length
          flush(); out += span('cmt', code.slice(i, end)); i = end; matched = true
          break
        }
      }
    }
    if (matched) continue

    // strings (with an optional prefix, e.g. python's r"..."/f"...")
    if (spec.quotes) {
      let prefixLen = 0
      if (spec.stringPrefixRe) {
        const pm = spec.stringPrefixRe.exec(code.slice(i, i + 3))
        if (pm && pm.index === 0 && spec.quotes[code[i + pm[0].length]]) prefixLen = pm[0].length
      }
      const qc = code[i + prefixLen]
      const cfg = qc ? spec.quotes[qc] : null
      if (cfg) {
        const isTriple = spec.tripleQuotes && code.slice(i + prefixLen, i + prefixLen + 3) === qc + qc + qc
        const raw = cfg.raw || (prefixLen > 0 && /[rR]/.test(code.slice(i, i + prefixLen)))
        const end = isTriple
          ? scanTriple(code, i + prefixLen, qc)
          : scanQuoted(code, i + prefixLen, qc, { raw, multiline: cfg.multiline, doubleEscape: cfg.doubleEscape })
        flush(); out += span('str', code.slice(i, end)); i = end
        continue
      }
    }

    // numbers
    if (spec.numberRe && c >= '0' && c <= '9') {
      const m = spec.numberRe.exec(code.slice(i, i + 64))
      if (m && m.index === 0) {
        flush(); out += span('num', m[0]); i += m[0].length
        continue
      }
    }

    // identifiers / keywords / types / function calls
    if (spec.identRe) {
      const m = spec.identRe.exec(code.slice(i, i + 128))
      if (m && m.index === 0) {
        const word = m[0]
        const key = spec.keywordCase === 'upper' ? word.toUpperCase() : spec.keywordCase === 'lower' ? word.toLowerCase() : word
        let cls = null
        if (spec.keywords && spec.keywords.has(key)) cls = 'kw'
        else if (spec.types && spec.types.has(key)) cls = 'type'
        else if (/^\s?\(/.test(code.slice(i + word.length, i + word.length + 2))) cls = 'fn'
        else if (spec.capitalizedIsType && word.length > 1 && /^[A-Z]/.test(word)) cls = 'type'
        if (cls) { flush(); out += span(cls, word) } else { plain += word }
        i += word.length
        continue
      }
    }

    // operators
    if (spec.opRe) {
      const m = spec.opRe.exec(code.slice(i, i + 8))
      if (m && m.index === 0 && m[0]) {
        flush(); out += span('op', m[0]); i += m[0].length
        continue
      }
    }

    plain += c
    i += 1
  }
  flush()
  return out
}

// --- language specs -----------------------------------------------------------

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false', 'iota',
])
const GO_TYPES = new Set([
  'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64', 'int', 'int8',
  'int16', 'int32', 'int64', 'rune', 'string', 'uint', 'uint8', 'uint16', 'uint32', 'uint64',
  'uintptr', 'any',
])
function goSpec() {
  return {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: { '"': { multiline: false }, "'": { multiline: false }, '`': { multiline: true, raw: true } },
    numberRe: /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/,
    identRe: /^[A-Za-z_][A-Za-z0-9_]*/,
    keywords: GO_KEYWORDS,
    types: GO_TYPES,
    capitalizedIsType: true,
    opRe: OP_RE,
  }
}

const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await', 'async', 'implements',
  'interface', 'package', 'private', 'protected', 'public', 'abstract', 'as', 'from', 'of',
  'declare', 'namespace', 'satisfies', 'keyof', 'infer', 'readonly', 'override', 'type',
  'true', 'false', 'null', 'undefined',
])
const JS_TYPES = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'object', 'symbol', 'bigint'])
function jsSpec() {
  return {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: { '"': { multiline: false }, "'": { multiline: false }, '`': { multiline: true } },
    numberRe: /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/,
    identRe: /^[A-Za-z_$][A-Za-z0-9_$]*/,
    keywords: JS_KEYWORDS,
    types: JS_TYPES,
    capitalizedIsType: true,
    opRe: OP_RE,
  }
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS', 'DISTINCT', 'CREATE', 'TABLE',
  'ALTER', 'DROP', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'UNIQUE',
  'CHECK', 'CONSTRAINT', 'VIEW', 'WITH', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'LIKE', 'BETWEEN', 'ASC', 'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TRUE', 'FALSE',
])
const SQL_TYPES = new Set([
  'INT', 'INTEGER', 'VARCHAR', 'CHAR', 'TEXT', 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'BIGINT', 'SMALLINT', 'UUID', 'JSON', 'JSONB', 'SERIAL',
])
function sqlSpec() {
  return {
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    quotes: { "'": { multiline: false, raw: true, doubleEscape: true }, '"': { multiline: false, raw: true, doubleEscape: true } },
    numberRe: /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/,
    identRe: /^[A-Za-z_][A-Za-z0-9_]*/,
    keywords: SQL_KEYWORDS,
    types: SQL_TYPES,
    keywordCase: 'upper',
    opRe: OP_RE,
  }
}

const YAML_KEYWORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off'])
function yamlSpec() {
  return {
    lineComments: ['#'],
    quotes: { '"': { multiline: false }, "'": { multiline: false, doubleEscape: true } },
    numberRe: /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/,
    identRe: /^[A-Za-z_][A-Za-z0-9_-]*/,
    keywords: YAML_KEYWORDS,
    keywordCase: 'lower',
  }
}

const JSON_KEYWORDS = new Set(['true', 'false', 'null'])
function jsonSpec() {
  return {
    quotes: { '"': { multiline: false } },
    numberRe: /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/,
    identRe: /^[A-Za-z_][A-Za-z0-9_]*/,
    keywords: JSON_KEYWORDS,
  }
}

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'function', 'in', 'return', 'local', 'export', 'readonly', 'declare', 'select', 'break',
  'continue', 'exit', 'source', 'alias', 'unset', 'shift', 'trap', 'wait',
])
function bashSpec() {
  return {
    lineComments: ['#'],
    quotes: { '"': { multiline: false }, "'": { multiline: false, raw: true } },
    numberRe: /^\d[\d_]*(\.\d[\d_]*)?/,
    identRe: /^\$?[A-Za-z_][A-Za-z0-9_]*/,
    keywords: BASH_KEYWORDS,
    opRe: OP_RE,
  }
}

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield',
])
const PY_TYPES = new Set([
  'int', 'str', 'float', 'bool', 'list', 'dict', 'tuple', 'set', 'bytes', 'frozenset',
  'complex', 'bytearray', 'object', 'type',
])
function pythonSpec() {
  return {
    lineComments: ['#'],
    quotes: { '"': { multiline: false }, "'": { multiline: false } },
    tripleQuotes: true,
    stringPrefixRe: /^[rRuUbBfF]{1,2}/,
    numberRe: /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/,
    identRe: /^[A-Za-z_][A-Za-z0-9_]*/,
    keywords: PY_KEYWORDS,
    types: PY_TYPES,
    capitalizedIsType: true,
    opRe: OP_RE,
  }
}

const TOML_KEYWORDS = new Set(['true', 'false', 'inf', 'nan'])
function tomlSpec() {
  return {
    lineComments: ['#'],
    quotes: { '"': { multiline: false }, "'": { multiline: false, raw: true } },
    numberRe: /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/,
    identRe: /^[A-Za-z_][A-Za-z0-9_-]*/,
    keywords: TOML_KEYWORDS,
  }
}

const LANG_SPECS = {
  go: goSpec,
  js: jsSpec,
  sql: sqlSpec,
  yaml: yamlSpec,
  json: jsonSpec,
  bash: bashSpec,
  python: pythonSpec,
  toml: tomlSpec,
}

const LANG_ALIASES = {
  go: 'go',
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', javascript: 'js', typescript: 'js',
  sql: 'sql',
  yaml: 'yaml', yml: 'yaml',
  json: 'json',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  python: 'python', py: 'python',
  toml: 'toml',
}

// --- html (minimal: tags / attrs / strings) -----------------------------------

function highlightHtml(code) {
  const n = code.length
  let i = 0
  let out = ''
  let plain = ''
  const flush = () => { if (plain) { out += escapeHtml(plain); plain = '' } }

  while (i < n) {
    if (code.startsWith('<!--', i)) {
      const idx = code.indexOf('-->', i + 4)
      const end = idx === -1 ? n : idx + 3
      flush(); out += span('cmt', code.slice(i, end)); i = end
      continue
    }
    if (code[i] === '<') {
      flush()
      let j = i + 1
      const isClose = code[j] === '/'
      out += escapeHtml('<') + (isClose ? escapeHtml('/') : '')
      if (isClose) j++
      const tagStart = j
      while (j < n && /[A-Za-z0-9:-]/.test(code[j])) j++
      if (j > tagStart) out += span('kw', code.slice(tagStart, j))
      // attributes, up to the closing '>'
      while (j < n && code[j] !== '>') {
        const ch = code[j]
        if (ch === '"' || ch === "'") {
          const end = scanQuoted(code, j, ch, { multiline: true })
          flush(); out += span('str', code.slice(j, end)); j = end
          continue
        }
        if (/[A-Za-z-]/.test(ch)) {
          let e = j
          while (e < n && /[A-Za-z0-9:-]/.test(code[e])) e++
          flush(); out += span('type', code.slice(j, e)); j = e
          continue
        }
        plain += ch
        j++
      }
      flush()
      if (j < n) { out += escapeHtml('>'); j++ }
      i = j
      continue
    }
    plain += code[i]
    i++
  }
  flush()
  return out
}

// --- diff (line-based +/-) -----------------------------------------------------

function highlightDiff(code) {
  return code.split('\n').map((line) => {
    if (line.startsWith('+')) return span('add', line)
    if (line.startsWith('-')) return span('del', line)
    return escapeHtml(line)
  }).join('\n')
}

// --- entry point ----------------------------------------------------------------

const NO_OP_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext'])

/** `highlight(code, lang) -> html`. `code` is plain (already-unescaped)
 * source text; the result is HTML-escaped with `<span class="wu-tok-*">`
 * token wrapping. Never throws: an unrecognized `lang`, a missing spec, or
 * any internal error all fall back to a plain HTML-escape of `code`. */
export function highlight(code, lang) {
  const source = code == null ? '' : String(code)
  try {
    const key = String(lang ?? '').trim().toLowerCase()
    if (key === 'diff') return highlightDiff(source)
    if (key === 'html' || key === 'htm' || key === 'xml') return highlightHtml(source)
    if (NO_OP_LANGS.has(key)) return escapeHtml(source)
    const canon = LANG_ALIASES[key]
    const specFn = canon ? LANG_SPECS[canon] : null
    if (!specFn) return escapeHtml(source)
    return tokenizeGeneric(source, specFn())
  } catch {
    return escapeHtml(source)
  }
}
