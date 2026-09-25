// frontmatter.mjs — a tolerant reader for explain-pages frontmatter.
//
// explain-pages frontmatter (docs/authoring.md) is intentionally flat:
// `title`, `summary`, `date` (scalars, possibly containing ": " or
// parentheses — free Japanese prose) and `tags` (an inline `[a, b]` list).
// A general YAML parser (bin/lib/yaml-lite.mjs) rejects an unquoted value
// that contains ": " — which real titles/summaries do — so this reads the
// simple "key: value" shape directly instead of delegating to it.

const FENCE_RE = /^---\s*$/

/**
 * @param {string} raw full file content
 * @returns {{meta: Record<string,string|string[]>, body: string, order: string[]}}
 */
export function parseFrontmatter(raw) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  if (!FENCE_RE.test(lines[0] ?? '')) {
    return { meta: {}, body: raw, order: [] }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) { end = i; break }
  }
  if (end === -1) {
    return { meta: {}, body: raw, order: [] }
  }
  const meta = {}
  const order = []
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (!key) continue
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      meta[key] = inner === '' ? [] : inner.split(',').map((s) => stripQuotes(s.trim()))
    } else {
      meta[key] = stripQuotes(value)
    }
    order.push(key)
  }
  const body = lines.slice(end + 1).join('\n')
  return { meta, body, order }
}

function stripQuotes(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1)
  }
  return s
}
