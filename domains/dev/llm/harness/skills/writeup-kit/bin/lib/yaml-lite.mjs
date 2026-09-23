// Zero-dependency parser for the small YAML subset used by writeup diagram IR.
//
// Supported: block mappings, block sequences ("- " items, including a
// sequence at the same indentation as its parent key), inline sequences
// ("[a, b]"), plain / "double" / 'single' quoted scalars, integers,
// floats, true/false/null, nested indentation, and "#" comments (only
// outside quotes). `key: value` splits on the first *unquoted* ": " so a
// colon-space inside a quoted string (`label: "A: push"`) is safe, while
// the same thing unquoted (`label: A: push`) is rejected with a clear
// error instead of being silently misparsed.
//
// Also accepts JSON: if the input starts with "{", it is parsed as JSON.

export class YamlError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`)
    this.name = 'YamlError'
    this.line = line
  }
}

/**
 * Parse a YAML-lite (or JSON) document into a plain JS value.
 * @param {string} input
 */
export function parse(input) {
  if (typeof input !== 'string') throw new TypeError('yaml-lite parse() expects a string')
  const withoutBom = input.replace(/^﻿/, '')
  if (withoutBom.trimStart().startsWith('{')) {
    try {
      return JSON.parse(withoutBom)
    } catch (e) {
      throw new YamlError(1, `invalid JSON: ${e.message}`)
    }
  }

  const lines = tokenizeLines(withoutBom)
  if (lines.length === 0) return null

  if (lines[0].indent !== 0) {
    throw new YamlError(lines[0].no, 'bad indentation: top-level content must start at column 0')
  }
  const { value, nextIdx } = parseBlock(lines, 0, 0)
  if (nextIdx !== lines.length) {
    throw new YamlError(lines[nextIdx].no, 'bad indentation: unexpected indentation')
  }
  return value
}

// --- tokenizing ------------------------------------------------------------

/** Split into non-blank, comment-stripped lines with precomputed indent. */
function tokenizeLines(input) {
  const raw = input.replace(/\r\n?/g, '\n').split('\n')
  const lines = []
  for (let i = 0; i < raw.length; i++) {
    const no = i + 1
    const line = raw[i]
    const leading = /^[ \t]*/.exec(line)[0]
    if (leading.includes('\t')) {
      throw new YamlError(no, 'tabs are not allowed for indentation')
    }
    const stripped = stripComment(line, no)
    const trimmedRight = stripped.replace(/[ \t]+$/, '')
    if (trimmedRight.trim() === '') continue
    const indent = /^ */.exec(trimmedRight)[0].length
    lines.push({ no, indent, content: trimmedRight.slice(indent) })
  }
  return lines
}

/** Remove a "# ..." comment that starts outside quotes, at start-of-line or after whitespace. */
function stripComment(line) {
  let inQuote = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (inQuote === '"' && c === '\\') { i++; continue }
      if (c === inQuote) {
        if (inQuote === "'" && line[i + 1] === "'") { i++; continue }
        inQuote = null
      }
      continue
    }
    if (c === '"' || c === "'") { inQuote = c; continue }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

const isDash = (content) => content === '-' || content.startsWith('- ')

// --- block dispatch ----------------------------------------------------

function parseBlock(lines, idx, indent) {
  if (idx >= lines.length || lines[idx].indent !== indent) {
    return { value: null, nextIdx: idx }
  }
  if (isDash(lines[idx].content)) return parseSequence(lines, idx, indent)
  return parseMapping(lines, idx, indent)
}

/** Resolve the value that follows an empty "key:" (or "- key:") at `parentIndent`. */
function resolveNestedValue(lines, idx, parentIndent) {
  if (idx >= lines.length) return { value: null, nextIdx: idx }
  const next = lines[idx]
  if (next.indent > parentIndent) return parseBlock(lines, idx, next.indent)
  if (next.indent === parentIndent && isDash(next.content)) return parseBlock(lines, idx, next.indent)
  return { value: null, nextIdx: idx }
}

// --- sequences -----------------------------------------------------------

function parseSequence(lines, idx, indent) {
  const arr = []
  while (idx < lines.length && lines[idx].indent === indent && isDash(lines[idx].content)) {
    const line = lines[idx]
    const content = line.content
    let restStart = 1
    while (content[restStart] === ' ') restStart++
    const rest = content.slice(restStart)
    const dashIndent = indent
    idx++

    if (rest === '') {
      const { value, nextIdx } = resolveNestedValue(lines, idx, dashIndent)
      arr.push(value)
      idx = nextIdx
      continue
    }

    const colonIdx = findUnquotedColonSpace(rest)
    if (colonIdx === -2) throw new YamlError(line.no, 'unterminated quoted string')
    if (colonIdx >= 0) {
      const itemColumn = indent + restStart
      const { obj, nextIdx } = parseMappingInline(lines, rest, line.no, idx, itemColumn)
      arr.push(obj)
      idx = nextIdx
    } else {
      arr.push(parseScalarOrInline(rest, line.no))
    }
  }
  return { value: arr, nextIdx: idx }
}

// --- mappings --------------------------------------------------------------

function parseMapping(lines, idx, indent) {
  const obj = {}
  const nextIdx = consumeMappingPairs(lines, obj, idx, indent)
  return { value: obj, nextIdx }
}

/** A mapping that starts inline (as the content of a "- key: value" sequence item). */
function parseMappingInline(lines, rest, lineNo, startIdx, column) {
  const obj = {}
  const colonIdx = findUnquotedColonSpace(rest)
  if (colonIdx < 0) throw new YamlError(lineNo, `expected "key: value" but got: ${rest}`)
  const key = rest.slice(0, colonIdx).trim()
  if (!key) throw new YamlError(lineNo, 'missing key before ":"')
  const valuePart = rest.slice(colonIdx + 1).trim()
  let idx = startIdx
  if (valuePart === '') {
    const { value, nextIdx } = resolveNestedValue(lines, idx, column)
    obj[key] = value
    idx = nextIdx
  } else {
    obj[key] = parseScalarOrInline(valuePart, lineNo)
  }
  idx = consumeMappingPairs(lines, obj, idx, column)
  return { obj, nextIdx: idx }
}

function consumeMappingPairs(lines, obj, idx, indent) {
  while (idx < lines.length && lines[idx].indent === indent && !isDash(lines[idx].content)) {
    const line = lines[idx]
    const colonIdx = findUnquotedColonSpace(line.content)
    if (colonIdx === -2) throw new YamlError(line.no, 'unterminated quoted string')
    if (colonIdx < 0) throw new YamlError(line.no, `expected "key: value" but got: ${line.content}`)
    const key = line.content.slice(0, colonIdx).trim()
    if (!key) throw new YamlError(line.no, 'missing key before ":"')
    const valuePart = line.content.slice(colonIdx + 1).trim()
    idx++
    if (valuePart === '') {
      const { value, nextIdx } = resolveNestedValue(lines, idx, indent)
      obj[key] = value
      idx = nextIdx
    } else {
      obj[key] = parseScalarOrInline(valuePart, line.no)
    }
  }
  return idx
}

// --- key/value splitting ----------------------------------------------------

/** Index of the first unquoted ": " (or trailing ":"), -1 if none, -2 if a quote never closes. */
function findUnquotedColonSpace(content) {
  let inQuote = null
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (inQuote) {
      if (inQuote === '"' && c === '\\') { i++; continue }
      if (c === inQuote) {
        if (inQuote === "'" && content[i + 1] === "'") { i++; continue }
        inQuote = null
      }
      continue
    }
    if (c === '"' || c === "'") { inQuote = c; continue }
    if (c === ':' && (i + 1 === content.length || content[i + 1] === ' ')) return i
  }
  return inQuote ? -2 : -1
}

// --- scalars -----------------------------------------------------------

function parseScalarOrInline(text, lineNo) {
  const t = text.trim()
  if (t.startsWith('[')) return parseInlineSeq(t, lineNo)
  if (t.startsWith('"')) return parseDoubleQuoted(t, lineNo)
  if (t.startsWith("'")) return parseSingleQuoted(t, lineNo)
  return parsePlainScalar(t, lineNo)
}

function parsePlainScalar(text, lineNo) {
  if (text.includes(': ') || /:$/.test(text)) {
    throw new YamlError(lineNo, `unquoted value contains ": " — wrap it in quotes: "${text}"`)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~' || text === '') return null
  if (/^-?\d+$/.test(text)) return parseInt(text, 10)
  if (/^-?\d+\.\d+$/.test(text) || /^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) return parseFloat(text)
  return text
}

function parseDoubleQuoted(text, lineNo) {
  const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' }
  let out = ''
  let i = 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      const next = text[i + 1]
      if (next === undefined) throw new YamlError(lineNo, 'unterminated double-quoted string')
      out += ESCAPES[next] !== undefined ? ESCAPES[next] : next
      i += 2
      continue
    }
    if (c === '"') {
      const rest = text.slice(i + 1).trim()
      if (rest !== '') throw new YamlError(lineNo, `unexpected content after closing quote: ${rest}`)
      return out
    }
    out += c
    i++
  }
  throw new YamlError(lineNo, 'unterminated double-quoted string')
}

function parseSingleQuoted(text, lineNo) {
  let out = ''
  let i = 1
  while (i < text.length) {
    const c = text[i]
    if (c === "'") {
      if (text[i + 1] === "'") { out += "'"; i += 2; continue }
      const rest = text.slice(i + 1).trim()
      if (rest !== '') throw new YamlError(lineNo, `unexpected content after closing quote: ${rest}`)
      return out
    }
    out += c
    i++
  }
  throw new YamlError(lineNo, 'unterminated single-quoted string')
}

function parseInlineSeq(text, lineNo) {
  if (!text.endsWith(']')) throw new YamlError(lineNo, 'unterminated inline sequence "["')
  const inner = text.slice(1, -1).trim()
  if (inner === '') return []
  return splitTopLevel(inner, lineNo).map((it) => parseScalarOrInline(it.trim(), lineNo))
}

/** Split on top-level commas, respecting quotes and nested [ ]. */
function splitTopLevel(text, lineNo) {
  const parts = []
  let depth = 0
  let inQuote = null
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      cur += c
      if (inQuote === '"' && c === '\\') {
        const next = text[i + 1]
        if (next !== undefined) { cur += next; i++ }
        continue
      }
      if (c === inQuote) {
        if (inQuote === "'" && text[i + 1] === "'") { cur += text[++i]; continue }
        inQuote = null
      }
      continue
    }
    if (c === '"' || c === "'") { inQuote = c; cur += c; continue }
    if (c === '[') { depth++; cur += c; continue }
    if (c === ']') { depth--; cur += c; continue }
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += c
  }
  if (inQuote) throw new YamlError(lineNo, `unterminated ${inQuote === '"' ? 'double' : 'single'}-quoted string`)
  parts.push(cur)
  return parts
}
