// html.mjs — a tiny, tolerant HTML reader (no dependency).
//
// This is not a spec-compliant HTML parser: it is a small state machine
// tuned to the shape of pages this kit itself produces (writeup / grilling /
// eli5 / show-me), which are always well-formed, always UTF-8, and never
// contain arbitrary third-party markup. It is deliberately forgiving about
// unclosed tags (closes them by walking up the stack to the nearest
// matching ancestor) rather than throwing, because self-check and to-md
// need to run on drafts that may not be perfectly balanced yet.
//
// Node shapes:
//   { type: 'root', children: [...] }
//   { type: 'element', tag: 'div', attrs: {class: 'wu-page'}, children: [...] }
//   { type: 'text', value: '...' }
//   { type: 'comment', value: '...' }

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Elements whose content is not parsed as markup at all (raw text).
const RAWTEXT_TAGS = new Set(['script', 'style'])

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', mdash: '—', ndash: '–', middot: '·',
  hellip: '…', copy: '©', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“',
}

/** Decode a small, fixed set of HTML entities (named + numeric). Anything
 * unrecognized is left as-is — this kit never needs the full HTML5 table. */
export function decodeEntities(text) {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (Number.isFinite(code)) {
        try { return String.fromCodePoint(code) } catch { return whole }
      }
      return whole
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole
  })
}

function parseAttrs(str) {
  const attrs = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m
  while ((m = re.exec(str))) {
    // Attribute *names* are kept as-authored (not lowercased): HTML attribute
    // names are conventionally lowercase already, but inline SVG uses
    // case-sensitive camelCase attributes (viewBox, markerWidth, refX, ...)
    // that must round-trip unchanged through serialize() for to-md.mjs's
    // extracted <figures-dir>/*.svg files to render correctly.
    const name = m[1]
    let value = ''
    if (m[2] !== undefined) value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]
    attrs[name] = decodeEntities(value ?? '')
  }
  return attrs
}

/** Parse an HTML document (or fragment) into a root node. */
export function parseHtml(source) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  const n = source.length
  let i = 0

  while (i < n) {
    if (source[i] !== '<') {
      let next = source.indexOf('<', i)
      if (next === -1) next = n
      const raw = source.slice(i, next)
      if (raw.length) top().children.push({ type: 'text', value: decodeEntities(raw) })
      i = next
      continue
    }

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const stop = end === -1 ? n : end
      top().children.push({ type: 'comment', value: source.slice(i + 4, stop) })
      i = end === -1 ? n : end + 3
      continue
    }

    if (source.startsWith('<!', i)) {
      const end = source.indexOf('>', i)
      i = end === -1 ? n : end + 1
      continue
    }

    if (source[i + 1] === '/') {
      const end = source.indexOf('>', i)
      const stop = end === -1 ? n : end
      const name = source.slice(i + 2, stop).trim().toLowerCase()
      i = end === -1 ? n : end + 1
      for (let j = stack.length - 1; j > 0; j--) {
        if (stack[j].tag === name) { stack.length = j; break }
      }
      continue
    }

    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(source.slice(i))
    if (!tagMatch) {
      top().children.push({ type: 'text', value: '<' })
      i += 1
      continue
    }
    const tagName = tagMatch[1].toLowerCase()
    let j = i + tagMatch[0].length
    let inQuote = null
    while (j < n) {
      const c = source[j]
      if (inQuote) {
        if (c === inQuote) inQuote = null
        j++
        continue
      }
      if (c === '"' || c === "'") { inQuote = c; j++; continue }
      if (c === '>') break
      j++
    }
    let attrsStr = source.slice(i + tagMatch[0].length, j)
    const selfClose = /\/\s*$/.test(attrsStr)
    if (selfClose) attrsStr = attrsStr.replace(/\/\s*$/, '')
    const attrs = parseAttrs(attrsStr)
    i = j < n ? j + 1 : n

    const node = { type: 'element', tag: tagName, attrs, children: [] }
    top().children.push(node)

    if (VOID_TAGS.has(tagName) || selfClose) continue

    if (RAWTEXT_TAGS.has(tagName)) {
      const closeRe = new RegExp(`</${tagName}\\s*>`, 'i')
      const rest = source.slice(i)
      const m = closeRe.exec(rest)
      const rawEnd = m ? i + m.index : n
      node.children.push({ type: 'text', value: source.slice(i, rawEnd), raw: true })
      i = m ? rawEnd + m[0].length : n
      continue
    }

    stack.push(node)
  }

  return root
}

export const isElement = (node) => !!node && node.type === 'element'
export const isText = (node) => !!node && node.type === 'text'
export const tagName = (node) => (isElement(node) ? node.tag : null)
export const attr = (node, name) => (isElement(node) ? node.attrs[name] : undefined)

export function classList(node) {
  const c = attr(node, 'class')
  return c ? c.split(/\s+/).filter(Boolean) : []
}
export const hasClass = (node, cls) => classList(node).includes(cls)

export function* walk(node) {
  yield node
  if (node.children) for (const c of node.children) yield* walk(c)
}

export function findAll(node, pred) {
  const out = []
  for (const n of walk(node)) if (pred(n)) out.push(n)
  return out
}

export function findFirst(node, pred) {
  for (const n of walk(node)) if (pred(n)) return n
  return null
}

export function elementChildren(node) {
  return (node.children || []).filter(isElement)
}

/** Concatenate the text of all descendant text nodes (raw/rawtext nodes included). */
export function textContent(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value
  if (!node.children) return ''
  return node.children.map(textContent).join('')
}

export function findHead(root) {
  return findFirst(root, (n) => tagName(n) === 'head')
}
export function findBody(root) {
  return findFirst(root, (n) => tagName(n) === 'body')
}

/** Collect `<meta name="..." content="...">` pairs. Reads the children of
 * `<head>` when present; a document without `<head>` (a bare fragment that
 * starts with `<title>` and `<meta>`) is scanned for every `<meta>` that
 * appears before `<body>` / the first sectioning element instead, so meta
 * lookups and id insertion stay idempotent for both shapes. */
export function headMeta(root) {
  const head = findHead(root)
  const metas = {}
  const scope = head ? elementChildren(head) : findAll(root, (n) => tagName(n) === 'meta')
  for (const m of scope) {
    if (tagName(m) !== 'meta') continue
    const name = attr(m, 'name')
    if (name && metas[name] === undefined) metas[name] = attr(m, 'content') ?? ''
  }
  return metas
}

export function titleText(root) {
  const t = findFirst(root, (n) => tagName(n) === 'title')
  return t ? textContent(t).trim() : ''
}

/** Every external `href`/`src` reachable from `link`, `script`, `img`, and
 * svg `image` (whose reference lives in `href` or the legacy `xlink:href`). */
export function externalRefs(root) {
  const refs = []
  for (const n of findAll(root, isElement)) {
    if (tagName(n) === 'link') {
      const href = attr(n, 'href')
      if (href) refs.push({ tag: 'link', url: href, node: n })
    }
    if (tagName(n) === 'script') {
      const src = attr(n, 'src')
      if (src) refs.push({ tag: 'script', url: src, node: n })
    }
    if (tagName(n) === 'img') {
      const src = attr(n, 'src')
      if (src) refs.push({ tag: 'img', url: src, node: n })
    }
    if (tagName(n) === 'image') {
      const href = attr(n, 'href') ?? attr(n, 'xlink:href')
      if (href) refs.push({ tag: 'image', url: href, node: n })
    }
  }
  return refs
}

/** A tag+class-only structural signature (text values are erased), used to
 * compare the header/footer chrome against the template ignoring content. */
export function structuralSignature(node) {
  if (node.type === 'text' || node.type === 'comment') return null
  if (node.type === 'root') {
    return elementChildren(node).map(structuralSignature)
  }
  const classes = classList(node).filter((c) => c !== 'n' && c !== 'num').sort()
  const childSigs = (node.children || [])
    .map(structuralSignature)
    .filter((s) => s !== null)
  return { tag: node.tag, classes, children: childSigs }
}

export function signaturesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// --- serialization (round-trip for extracted subtrees, e.g. a `.wu-figure`'s
// `<svg>`, into a standalone file) ------------------------------------------

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttrValue(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function serializeAttrs(attrs) {
  const parts = []
  for (const [name, value] of Object.entries(attrs || {})) {
    parts.push(value === '' ? name : `${name}="${escapeAttrValue(value)}"`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

/** Reconstruct HTML markup from a parsed node (root, element, text, or
 * comment). Void tags are emitted unclosed; raw-text tags (`script`/`style`)
 * emit their text content verbatim, unescaped. */
export function serialize(node) {
  if (!node) return ''
  if (node.type === 'root') return (node.children || []).map(serialize).join('')
  if (node.type === 'text') return node.raw ? node.value : escapeText(node.value)
  if (node.type === 'comment') return `<!--${node.value}-->`
  // element
  const open = `<${node.tag}${serializeAttrs(node.attrs)}>`
  if (VOID_TAGS.has(node.tag)) return open
  const inner = (node.children || []).map(serialize).join('')
  return `${open}${inner}</${node.tag}>`
}
