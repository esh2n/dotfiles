// standalone-svg.mjs — makes a `.wu-figure`'s extracted `<svg>` (as written
// by to-md.mjs, one file per figure) render correctly with no page CSS
// around it: every color in the figure is `currentColor` or `var(--wu-*)`
// (kit/writeup.css ~957-1010), so opened bare — or embedded via `<img>` in a
// GitHub PR body — it would be a colorless black-on-transparent outline.
//
// This module inlines a `<style>` (light-theme tokens + the `.wu-figure`
// component rules the svg actually depends on, prefix stripped) plus an
// opaque background `<rect>`, so the file carries its own look.
//
// Light theme only, deliberately: `prefers-color-scheme` inside an `<img>`
// follows the *viewer's OS*, not the page embedding the image (GitHub's own
// light/dark toggle never reaches it), so a page that shipped both variants
// would still mismatch GitHub's theme half the time. One opaque light card
// is the only choice that reads correctly on every GitHub theme.
//
// Only *unconditional* `.wu-figure` rules are carried over (rules with no
// `@media` wrapper). The kit's `@media (forced-colors: active)` block sets
// `stroke: CanvasText` unconditionally-looking but is only ever true inside
// that media query; reproducing it here without its wrapper would paint the
// focal stroke black-on-black in normal viewing. The print and
// prefers-color-scheme blocks are page-context features that don't apply to
// a standalone file either. Skipping all of them is the simple, correct
// choice — this module has no CSS-media-query writer to keep them safe.
//
// Pure function, no I/O: caller reads `kit/writeup.css` and the figure's svg
// markup and passes both in.

import { parseHtml, serialize, findFirst, tagName, attr, elementChildren } from './html.mjs'
import { parseTokens, parseRules } from './contrast.mjs'

const MARKER_ATTR = 'data-wu-standalone'

// `.wu-figure svg` -> `svg`, `.wu-figure rect[data-tone="ts"]` -> `rect[data-tone="ts"]`,
// `.wu-figure[data-scroll="true"] svg` -> `svg`. A bare `.wu-figure` (no
// descendant part) does not match — that rule's declarations (margin,
// padding, overflow, border, background) are page-frame chrome that never
// applied to the svg itself, so there's nothing in it worth keeping.
const FIGURE_PREFIX_RE = /^\.wu-figure(\[[^\]]*\])?\s+(\S[\s\S]*)$/

// Declarations that only make sense laid out inside the page (the figure's
// own box sizing / stacking), not inside a standalone file.
const DROP_PROP_RE = /^(max-width|display|margin(-\w+)?)$/i

/** `.wu-figure`-scoped rules from `cssText`, restyled to apply directly to
 * the (now page-less) svg: prefix stripped from each selector, page-only
 * declarations dropped, and any rule left with nothing worth keeping (no
 * matching selector part, or no declaration survives the drop list) is
 * omitted rather than emitted as an empty block. */
function figureRules(cssText) {
  const out = []
  for (const rule of parseRules(cssText)) {
    if (rule.media) continue // see docblock: media-qualified rules are skipped
    const parts = rule.selector
      .split(',')
      .map((s) => s.trim())
      .map((s) => FIGURE_PREFIX_RE.exec(s))
      .filter(Boolean)
      .map((m) => m[2].trim())
    if (!parts.length) continue
    const decls = Object.entries(rule.decls).filter(([prop]) => !DROP_PROP_RE.test(prop))
    if (!decls.length) continue
    out.push({ selector: [...new Set(parts)].join(', '), decls })
  }
  return out
}

function renderDecls(decls) {
  return decls.map(([prop, value]) => `  ${prop}: ${value};`).join('\n')
}

/** The `<style>` text: light-theme `--wu-*` tokens (colors, fonts, spacing —
 * everything `:root` defines) plus `color`/`font-family` defaults on `svg`,
 * followed by the restyled `.wu-figure` rules. Built entirely from
 * `parseTokens`/`parseRules` — no hand-copied values. */
function buildStyleText(cssText) {
  const tokens = parseTokens(cssText).light
  const tokenLines = Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`)
  const blocks = [
    ['svg', [...tokenLines, '  color: var(--wu-ink);', '  font-family: var(--wu-font-body);'].join('\n')],
    ...figureRules(cssText).map((r) => [r.selector, renderDecls(r.decls)]),
  ]
  return blocks.map(([selector, body]) => `${selector} {\n${body}\n}`).join('\n\n')
}

/**
 * Returns `svgMarkup` with an inline `<style>` (light kit tokens + the
 * `.wu-figure` rules the figure depends on) and an opaque
 * `var(--wu-surface)` background `<rect>` inserted as its first two
 * children, and `xmlns` guaranteed on the root — so the file renders its
 * own look with no page around it (GitHub PR bodies, `<img>` embeds,
 * opened bare). `role`/`aria-labelledby`/`viewBox` are left as they are.
 *
 * Idempotent: a markup that already carries the marker `<style
 * data-wu-standalone="true">` as its first child is returned unchanged
 * (only `xmlns` is still enforced), rather than gaining a second style.
 */
export function standaloneSvg(svgMarkup, cssText) {
  const root = parseHtml(svgMarkup)
  const svg = findFirst(root, (n) => tagName(n) === 'svg')
  if (!svg) return svgMarkup

  if (!svg.attrs.xmlns) svg.attrs.xmlns = 'http://www.w3.org/2000/svg'

  const firstChild = elementChildren(svg)[0]
  const already = firstChild && tagName(firstChild) === 'style' && attr(firstChild, MARKER_ATTR) === 'true'
  if (already) return serialize(svg)

  const styleNode = {
    type: 'element',
    tag: 'style',
    attrs: { [MARKER_ATTR]: 'true' },
    children: [{ type: 'text', value: buildStyleText(cssText), raw: true }],
  }
  const rectNode = {
    type: 'element',
    tag: 'rect',
    attrs: { width: '100%', height: '100%', fill: 'var(--wu-surface)' },
    children: [],
  }
  svg.children = [styleNode, rectNode, ...(svg.children || [])]
  return serialize(svg)
}
