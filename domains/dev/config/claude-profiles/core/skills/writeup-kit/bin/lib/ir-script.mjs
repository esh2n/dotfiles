// ir-script.mjs — the escaping contract for the diagram IR text embedded
// inside a `.wu-figure`'s `<script type="text/x-writeup-diagram">` block.
//
// `<script>` is an HTML "raw text" element: browsers never decode entities
// inside it, and its content is only ever terminated by a literal
// `</script>`. Embedding the IR verbatim therefore lets a user-authored
// label like `<img src=x onerror=alert(1)>` land byte-for-byte in the page
// (inert — nothing executes non-JS script content — but still noise a
// scanner has to reason about) and lets a caption containing `</script>`
// break out of the block and corrupt the surrounding page.
//
// Contract: writers HTML-escape the IR text before embedding
// (escapeIrScript); readers unescape it before parsing YAML/JSON
// (unescapeIrScript). unescapeIrScript is tolerant of legacy content
// written before this contract existed: text with neither `&lt;` nor
// `&amp;` is assumed to already be raw and is returned unchanged, so pages
// already in the store keep parsing until `rerender-figures.mjs --all`
// rewrites them into the escaped form.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const UNESCAPE_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }

/** HTML-escape IR text for embedding inside a `text/x-writeup-diagram` script. */
export function escapeIrScript(text) {
  return String(text).replace(/[&<>]/g, (c) => ESCAPE_MAP[c])
}

/** Reverse escapeIrScript(). Legacy raw text (no `&lt;`/`&amp;`) passes through unchanged. */
export function unescapeIrScript(text) {
  const s = String(text)
  if (!s.includes('&lt;') && !s.includes('&amp;')) return s
  return s.replace(/&(amp|lt|gt);/g, (m) => UNESCAPE_MAP[m])
}
