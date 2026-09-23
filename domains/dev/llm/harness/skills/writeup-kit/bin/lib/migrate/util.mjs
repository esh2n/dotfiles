// util.mjs — small shared helpers for the explain-pages migration converter.
// Zero-dependency: Node standard library only.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/** Convert a small glob (`*` = any run of non-slash chars, `**` = any run
 * including slashes, `?` = one char) into a RegExp anchored at both ends. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/** True if `relPath` matches `pattern` either as a full-path glob or, when
 * the pattern has no slash, as a basename glob. */
export function matchesOnly(relPath, pattern) {
  if (!pattern) return true
  if (pattern.includes('/')) return globToRegExp(pattern).test(relPath)
  const base = relPath.split('/').pop()
  return globToRegExp(pattern).test(base) || globToRegExp(pattern).test(relPath)
}

/** Split a POSIX-ish relative path into folder segments and basename. */
export function splitRelPath(relPath) {
  const parts = relPath.split('/')
  const base = parts.pop()
  return { folders: parts, base }
}

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/

/** Extract {date, slug} from an explain-pages filename, e.g.
 * "2026-06-10-sdi-api-phase1.md" -> {date: "2026-06-10", slug: "sdi-api-phase1"}.
 * Falls back to a null date when the filename does not carry the prefix. */
export function parseDatedFilename(basename) {
  const m = DATE_PREFIX_RE.exec(basename)
  if (m) return { date: m[1], slug: m[2] }
  return { date: null, slug: basename.replace(/\.md$/, '') }
}

// --- IR -> YAML (for embedding a candidate/failed IR into a fallback figure) --

/** True when a plain YAML scalar needs quoting to survive a round-trip
 * through yaml-lite.mjs's parser: it would otherwise be misread as a
 * different type (true/false/null/number), get its comment-stripping or
 * ": " key-split rules triggered, or be parsed as an inline sequence. */
function yamlScalarNeedsQuote(s) {
  if (s === '') return true
  if (s === 'true' || s === 'false' || s === 'null' || s === '~') return true
  if (/^-?\d+$/.test(s) || /^-?\d+\.\d+$/.test(s) || /^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return true
  if (s.includes(': ') || /:$/.test(s)) return true
  if (s.startsWith('[') || s.startsWith('"') || s.startsWith("'")) return true
  if (/(^|\s)#/.test(s)) return true
  if (/^\s|\s$/.test(s)) return true
  return false
}

/** Double-quote a scalar for yaml-lite.mjs (which only supports the
 * escapes it lists: \n \t \r \" \\ \/). */
function yamlQuote(s) {
  return `"${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

/** A YAML-lite scalar for `value` — quoted only when required to round-trip.
 * Exported so old-sequence.mjs's sequenceIrToYaml() can reuse the same
 * quoting contract as irToYaml() below instead of duplicating it. */
export function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const s = String(value)
  return yamlScalarNeedsQuote(s) ? yamlQuote(s) : s
}

/** Serialize a diagram IR-shaped object (id/title/caption/direction/
 * groups/nodes/edges — the same fields ir.mjs normalizes, but tolerant of
 * a candidate IR that never passed validateIR) into the YAML-lite shape
 * the renderer accepts, for embedding a failed diagram's IR into a
 * fallback figure's `<script type="text/x-writeup-diagram">`. */
export function irToYaml(ir) {
  const lines = []
  lines.push(`id: ${yamlScalar(ir.id)}`)
  lines.push(`title: ${yamlScalar(ir.title)}`)
  if (ir.caption !== undefined && ir.caption !== null && ir.caption !== '') {
    lines.push(`caption: ${yamlScalar(ir.caption)}`)
  }
  if (ir.direction) lines.push(`direction: ${yamlScalar(ir.direction)}`)

  const groups = ir.groups || []
  if (groups.length) {
    lines.push('groups:')
    for (const g of groups) {
      lines.push(`- id: ${yamlScalar(g.id)}`)
      lines.push(`  label: ${yamlScalar(g.label)}`)
      if (g.tone && g.tone !== 'neutral') lines.push(`  tone: ${yamlScalar(g.tone)}`)
      if (g.group) lines.push(`  group: ${yamlScalar(g.group)}`)
    }
  }

  const nodes = ir.nodes || []
  lines.push(nodes.length ? 'nodes:' : 'nodes: []')
  for (const n of nodes) {
    lines.push(`- id: ${yamlScalar(n.id)}`)
    lines.push(`  label: ${yamlScalar(n.label)}`)
    if (n.group) lines.push(`  group: ${yamlScalar(n.group)}`)
    if (n.tone && n.tone !== 'neutral') lines.push(`  tone: ${yamlScalar(n.tone)}`)
    if (n.dashed) lines.push('  dashed: true')
    if (n.emphasis) lines.push('  emphasis: true')
  }

  const edges = ir.edges || []
  if (edges.length) {
    lines.push('edges:')
    for (const e of edges) {
      lines.push(`- from: ${yamlScalar(e.from)}`)
      lines.push(`  to: ${yamlScalar(e.to)}`)
      lines.push(`  kind: ${yamlScalar(e.kind ?? 'sync')}`)
      if (e.label !== undefined && e.label !== null && e.label !== '') lines.push(`  label: ${yamlScalar(e.label)}`)
      if (e.from_side) lines.push(`  from_side: ${yamlScalar(e.from_side)}`)
      if (e.to_side) lines.push(`  to_side: ${yamlScalar(e.to_side)}`)
      if (e.via && e.via.length) lines.push(`  via: [${e.via.map(yamlScalar).join(', ')}]`)
      if (e.label_at !== undefined && e.label_at !== null) lines.push(`  label_at: ${e.label_at}`)
    }
  }

  return lines.join('\n')
}

/** A relative path from a page at `n` folders deep back to the store root,
 * suffixed with `_kit/writeup.css`. self-check's allowed-external regex
 * only recognizes a leading "./" or one/two "../" segments (contract §1
 * pages always live inside at least one folder, so depth 0 is a
 * synthetic case, not a real store shape) — special-cased to "./" so it
 * still passes that check rather than emitting a bare "_kit/writeup.css".
 */
export function cssHrefForDepth(n) {
  return n <= 0 ? './_kit/writeup.css' : '../'.repeat(n) + '_kit/writeup.css'
}
