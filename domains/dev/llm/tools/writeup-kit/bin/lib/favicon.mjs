// favicon.mjs — status favicon for writeup pages (page-contract.md §1/§2).
//
// Renders a small (32x32) inline SVG as a `data:image/svg+xml,` URI: a
// rounded ink square holding a one-character glyph for the page's `kind`
// (or three white bars for the store index), with an accent-colored ring
// around the square when the page's checks are not clean — no ring for
// pass, a solid ring for fail, a dashed ring for pending. Two palette
// colors only (ink + accent) plus white for the glyph/bars, transparent
// everywhere else — no other fill or stroke value ever appears.

const INK = '#1c2230'
const ACCENT = '#2f4b9c'
const WHITE = '#ffffff'

const KIND_GLYPHS = {
  '決定記録': '決',
  '設計': '設',
  '調査まとめ': '調',
  '参考資料まとめ': '資',
  'PBI 資料': 'P',
  '絵解き': '絵',
  '作業メモ': 'メ',
  '議事録': '議',
}

// Unknown/legacy kind (no entry in the 8-kind table, e.g. legacy/**).
const UNKNOWN_GLYPH = '·' // middle dot

/** The one-character glyph for `kind` — the kind's own table entry, or a
 * middle dot for an unrecognized/legacy/empty kind. */
export function glyphFor(kind) {
  return KIND_GLYPHS[kind] || UNKNOWN_GLYPH
}

/** `pass` (no ring) when every recorded check passed; `fail` when
 * `self-check` or `lint` recorded `fail`; `pending` when `checks` is empty
 * or any recorded check is `pending`/`skipped`/blank. `checks` is the
 * parsed `{key: value}` map from `<meta name="checks">` (build.mjs's
 * `parseChecks`), not the raw string. */
export function statusFromChecks(checks) {
  const entries = Object.entries(checks || {})
  if (entries.length === 0) return 'pending'
  if (checks['self-check'] === 'fail' || checks.lint === 'fail') return 'fail'
  if (entries.some(([, v]) => v === 'pending' || v === 'skipped' || v === '')) return 'pending'
  return 'pass'
}

function ringMarkup(status) {
  if (status === 'fail') {
    return `<rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="${ACCENT}" stroke-width="3"/>`
  }
  if (status === 'pending') {
    return `<rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="3 2"/>`
  }
  return ''
}

const INDEX_BAR_Y = [10, 15, 20]

function markMarkup(kind) {
  if (kind === 'index') {
    return INDEX_BAR_Y
      .map((y) => `<rect x="9" y="${y}" width="14" height="2.5" rx="1.25" fill="${WHITE}"/>`)
      .join('')
  }
  return `<text x="16" y="16" font-family="sans-serif" font-size="18" fill="${WHITE}" text-anchor="middle" dominant-baseline="central">${glyphFor(kind)}</text>`
}

/** The favicon's raw SVG markup (32x32, not yet URI-encoded) for `kind`
 * (one of the 8 kind values, `'index'` for the store index, or anything
 * else — treated as unknown/legacy) and `status` (`'pass'` / `'fail'` /
 * `'pending'`; omitted or unrecognized behaves like `'pass'`, i.e. no
 * ring). */
export function faviconSvg({ kind, status } = {}) {
  const square = `<rect x="6" y="6" width="20" height="20" rx="4" fill="${INK}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `${ringMarkup(status)}${square}${markMarkup(kind)}</svg>`
}

/** `data:image/svg+xml,<url-encoded svg>` href for `<link rel="icon">` —
 * percent-encoded (not base64), matching self-check's "single file" row
 * (page-contract.md §4), which allows a `rel="icon"` link only when its
 * href is a `data:` URI. */
export function faviconDataUri(opts) {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(opts))}`
}
