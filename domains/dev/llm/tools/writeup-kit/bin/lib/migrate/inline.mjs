// inline.mjs — inline Markdown -> HTML for a single line/paragraph of text.
// Not a full CommonMark inline grammar: covers exactly what explain-pages
// authoring.md allows (docs/authoring.md "基本記法" + "リンク") — inline
// code, images, links (internal .md page links rewritten to .html), bold,
// italic. Applied after HTML-escaping the raw text, so entities are safe.

import { escapeHtml } from './util.mjs'

const CODE_RE = /`([^`]+)`/g
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const BOLD_RE = /\*\*([^*]+)\*\*/g
const ITALIC_RE = /(?<![*\w])\*([^*]+)\*(?![*\w])|(?<![\w_])_([^_]+)_(?![\w_])/g

/** Rewrite an explain-pages page-to-page link (bare relative "<file>.md",
 * optionally with a "#fragment") to the migrated page's ".html". External
 * links (http(s)://, mailto:, etc.) are left untouched. */
export function rewritePageLink(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href // scheme present -> external/absolute
  return href.replace(/\.md(#.*)?$/i, '.html$1')
}

/**
 * @param {string} text raw (unescaped) Markdown inline text
 * @returns {string} HTML
 */
export function renderInline(text) {
  let html = escapeHtml(text)

  html = html.replace(CODE_RE, (_, code) => `<code>${code}</code>`)
  html = html.replace(IMAGE_RE, (_, alt, src) => `<img src="${rewritePageLink(src)}" alt="${alt}">`)
  html = html.replace(LINK_RE, (_, label, href) => `<a href="${rewritePageLink(href)}">${label}</a>`)
  html = html.replace(BOLD_RE, (_, inner) => `<strong>${inner}</strong>`)
  html = html.replace(ITALIC_RE, (_, a, b) => `<em>${a ?? b}</em>`)

  return html
}
