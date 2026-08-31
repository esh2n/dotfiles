'use strict';

/**
 * Generic "replace a marker-delimited section, keep everything else
 * byte-for-byte" primitive, shared by codex-config-toml.js
 * (`# yoki:begin`/`# yoki:end`) and codex-agents-md.js
 * (`<!-- yoki:begin -->`/`<!-- yoki:end -->`).
 */

/**
 * @returns {{before: string, inner: string|null, after: string}} `inner` is
 *   `null` (and `before` `''`) when no existing block is found — `after` is
 *   then the whole original text.
 */
function extractBlock(text, startMarker, endMarker) {
  const source = String(text || '');
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { before: '', inner: null, after: source };
  }
  const before = source.slice(0, startIdx);
  // wrapBlock inserts up to TWO newlines after endMarker for a non-empty
  // `rest` — one ending the "# yoki:end" line, one blank-line separator —
  // and only one when `rest` was empty (nothing follows). Stripping just
  // the first (as this used to) leaves the separator's own newline behind,
  // which then survives into the next `rest`, and `wrapBlock` adds a FRESH
  // separator on top of it — one extra blank line every re-run, forever.
  // Eating both here (the second only if present) restores exactly what
  // was passed to `wrapBlock` in the first place, so a round trip through
  // extractBlock -> wrapBlock -> extractBlock is a true no-op on `rest`.
  const after = source.slice(endIdx + endMarker.length).replace(/^\r?\n(?:\r?\n)?/, '');
  return { before, inner: source.slice(startIdx, endIdx), after };
}

/** Re-assembles `startMarker\ncontent\nendMarker\n` followed by `rest`
 * (preceded by a blank line when non-empty). The block is always placed at
 * the top — callers needing a conflict check run it against `rest` first. */
function wrapBlock(startMarker, endMarker, content, rest) {
  return `${startMarker}\n${content}\n${endMarker}\n${rest ? `\n${rest}` : ''}`;
}

module.exports = { extractBlock, wrapBlock };
