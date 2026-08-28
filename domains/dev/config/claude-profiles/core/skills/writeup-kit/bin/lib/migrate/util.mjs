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
