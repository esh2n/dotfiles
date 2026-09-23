// page.mjs — assemble a full writeup-kit page (contract §1-2, kit/template.html
// chrome) from a converted body and the metadata computed by the migration
// CLI. Kept separate from body conversion (directives.mjs / body.mjs) so the
// chrome shape lives in exactly one place.

import { escapeHtml, escapeAttr } from './util.mjs'

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap'

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.description
 * @param {string} p.kind
 * @param {string} p.date
 * @param {string} p.updated
 * @param {string} p.checksContent
 * @param {string} p.cssHref
 * @param {string} p.migratedFrom store-relative path of the original .md
 * @param {Array<{name:string, content:string}>} [p.extraMeta]
 * @param {string} p.ledeText
 * @param {string} p.bodyHtml sections HTML (already wrapped in .wu-section)
 */
export function buildPageHtml(p) {
  const extraMeta = (p.extraMeta ?? []).map((m) => `<meta name="${escapeAttr(m.name)}" content="${escapeAttr(m.content)}">`).join('\n')
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeAttr(p.description)}">
<meta name="kind" content="${escapeAttr(p.kind)}">
<meta name="date" content="${escapeAttr(p.date)}">
<meta name="updated" content="${escapeAttr(p.updated)}">
<meta name="checks" content="${escapeAttr(p.checksContent)}">
<meta name="robots" content="noindex">
<meta name="x-migrated-from" content="${escapeAttr(p.migratedFrom)}">
${extraMeta}
<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}">
<link rel="stylesheet" href="${escapeAttr(p.cssHref)}">
</head>
<body>
<div class="wu-page">

<header class="wu-header">
<p class="wu-eyebrow">${escapeHtml(p.kind)} &middot; ${escapeHtml(p.date)} &middot; 更新 ${escapeHtml(p.updated)}</p>
<h1>${escapeHtml(p.title)}</h1>
<p class="wu-lede">${escapeHtml(p.ledeText)}</p>
</header>

<main>
${p.bodyHtml}
</main>

<footer class="wu-footer">
<dl>
<dt>checks</dt><dd>${escapeHtml(p.checksContent)}</dd>
<dt>sources</dt><dd>&mdash;</dd>
</dl>
</footer>

</div>
</body>
</html>
`
}

/** A minimal legacy stub page for a directive family the IR does not
 * support (aggregate/board/dddboard/html/pr) — contract §1 `legacy/`. */
export function buildLegacyStubHtml(p) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeAttr(p.description)}">
<meta name="kind" content="${escapeAttr(p.kind)}">
<meta name="date" content="${escapeAttr(p.date)}">
<meta name="updated" content="${escapeAttr(p.updated)}">
<meta name="checks" content="lint=skipped;self-check=skipped">
<meta name="robots" content="noindex">
<meta name="x-migrated-from" content="${escapeAttr(p.migratedFrom)}">
<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}">
<link rel="stylesheet" href="${escapeAttr(p.cssHref)}">
</head>
<body>
<div class="wu-page">

<header class="wu-header">
<p class="wu-eyebrow">${escapeHtml(p.kind)} &middot; ${escapeHtml(p.date)} &middot; 更新 ${escapeHtml(p.updated)}</p>
<h1>${escapeHtml(p.title)}</h1>
<p class="wu-lede">${escapeHtml(p.ledeText)}</p>
</header>

<main>
<section class="wu-section">
<h2>凍結された旧ページ</h2>
<p>このページは writeup-kit の IR が対応しない記法 (${escapeHtml(p.reason)}) を含むため変換できず、旧 Markdown を凍結して保存した。</p>
<p class="wu-meta">元ファイル: ${escapeHtml(p.migratedFrom)}</p>
</section>
</main>

<footer class="wu-footer">
<dl>
<dt>checks</dt><dd>lint=skipped; self-check=skipped</dd>
<dt>sources</dt><dd>&mdash;</dd>
</dl>
</footer>

</div>
</body>
</html>
`
}
