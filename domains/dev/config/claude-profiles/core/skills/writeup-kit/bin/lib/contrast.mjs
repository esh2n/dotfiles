// contrast.mjs — design-token contrast audit for kit/writeup.css.
//
// Pure functions, zero dependencies:
//   parseTokens(cssText)        → { light, dark, darkMedia }  (custom props per theme block)
//   relativeLuminance(hex)      → 0..1  (WCAG 2.x sRGB formula)
//   contrastRatio(hexA, hexB)   → 1..21
//   auditTokens(tokens)         → [{ theme, fg, bg, ratio, level, kind, usage }]
//   usedColorTokens(cssText)    → { fg: Set, bg: Set }  (coverage check for USAGE_PAIRS)
//
// The pair table (USAGE_PAIRS) is hand-derived from the component rules in
// writeup.css: for each `color:` / `fill:` / `stroke:` token, the background
// token(s) it actually sits on — either in the same rule or by inheritance
// from the page ground / a surface box / the code background / a figure tone
// fill. A pair is `text` when the token colors glyphs and `ui` when it colors
// a rule, border, stroke, or a fill that only has to be told apart from its
// neighbour (WCAG 1.4.11 non-text contrast: 3:1).

// ---------------------------------------------------------------
// color math
// ---------------------------------------------------------------

const NAMED = { white: '#ffffff', black: '#000000' }

/** `#rgb` / `#rrggbb` / white / black → [r, g, b] 0..255. Throws on anything else. */
export function parseHex(color) {
  let s = String(color).trim().toLowerCase()
  if (NAMED[s]) s = NAMED[s]
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (!m) throw new Error(`not a hex color: ${color}`)
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

function channel(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance of a hex color. */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio between two hex colors (order-independent). */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG level label for a text ratio: AAA ≥ 7, AA ≥ 4.5, AA-large ≥ 3, else fail. */
export function levelFor(ratio) {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

// ---------------------------------------------------------------
// css parsing (just enough for token blocks)
// ---------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Flatten a stylesheet into [{ selector, media, decls }]. Handles one level of
 * @media nesting (all writeup.css needs). Declarations are kept as raw strings.
 */
export function parseRules(cssText) {
  const out = []
  walk(stripComments(cssText), null, out)
  return out
}

function walk(css, media, out) {
  let i = 0
  const n = css.length
  while (i < n) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).trim()
    // find the matching close brace
    let depth = 1
    let j = open + 1
    while (j < n && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    if (selector.startsWith('@media')) {
      walk(body, selector.replace(/^@media\s*/, '').trim(), out)
    } else if (selector.startsWith('@')) {
      // other at-rules (keyframes, font-face …): not needed for tokens
    } else {
      out.push({ selector, media, decls: parseDecls(body) })
    }
    i = j
  }
}

function parseDecls(body) {
  const decls = {}
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const prop = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (prop) decls[prop] = value
  }
  return decls
}

function customProps(decls) {
  const out = {}
  for (const [k, v] of Object.entries(decls)) if (k.startsWith('--')) out[k] = v
  return out
}

const LIGHT_SEL = ':root'
const DARK_FORCED_SEL = ':root[data-theme="dark"]'
const DARK_MEDIA_SEL = ':root:not([data-theme="light"])'

/**
 * Extract the three token blocks. `light` is bare :root, `dark` is the forced
 * `:root[data-theme="dark"]` block, `darkMedia` is the
 * `@media (prefers-color-scheme: dark)` block. Any token missing from a dark
 * block falls through to the light value (that is what the cascade does too).
 */
export function parseTokens(cssText) {
  const rules = parseRules(cssText)
  const pick = (sel, wantMedia) =>
    rules
      .filter((r) => r.selector === sel && (wantMedia ? /prefers-color-scheme\s*:\s*dark/.test(r.media || '') : !r.media))
      .reduce((acc, r) => Object.assign(acc, customProps(r.decls)), {})
  const light = pick(LIGHT_SEL, false)
  const darkForced = pick(DARK_FORCED_SEL, false)
  const darkMedia = pick(DARK_MEDIA_SEL, true)
  return {
    light,
    dark: { ...light, ...darkForced },
    darkMedia: { ...light, ...darkMedia },
    raw: { light, dark: darkForced, darkMedia },
  }
}

/** Token names whose forced-dark and media-dark values differ (should be none). */
export function darkDrift(tokens) {
  const names = new Set([...Object.keys(tokens.raw.dark), ...Object.keys(tokens.raw.darkMedia)])
  return [...names].filter((k) => tokens.raw.dark[k] !== tokens.raw.darkMedia[k]).sort()
}

const COLOR_TOKEN_RE = /var\((--wu-(?:ground|surface|ink(?:-[0-9])?|rule(?:-soft)?|link|accent(?:-soft)?|fig-tone-[a-z]+))\)/g

/**
 * Every color token referenced as a foreground (color / fill / stroke /
 * border-color / outline / border shorthand) or as a background (background /
 * background-color) anywhere in the component rules (token blocks excluded).
 * Used by the tests to prove USAGE_PAIRS covers every token the CSS paints with.
 */
export function usedColorTokens(cssText) {
  const fg = new Set()
  const bg = new Set()
  for (const r of parseRules(cssText)) {
    if ([LIGHT_SEL, DARK_FORCED_SEL, DARK_MEDIA_SEL].includes(r.selector)) continue
    for (const [prop, value] of Object.entries(r.decls)) {
      const toks = [...value.matchAll(COLOR_TOKEN_RE)].map((m) => m[1])
      if (!toks.length) continue
      if (/^(background|background-color)$/.test(prop)) toks.forEach((t) => bg.add(t))
      else if (/^(color|fill|stroke|border|border-color|border-top|outline)$/.test(prop)) toks.forEach((t) => fg.add(t))
    }
  }
  return { fg, bg }
}

// ---------------------------------------------------------------
// the audit table
// ---------------------------------------------------------------

/**
 * Foreground token × background token pairs, as used in kit/writeup.css.
 * `kind`: 'text' (glyphs; needs 4.5:1) or 'ui' (borders, strokes, fills;
 * needs 3:1). `usage` cites the rules the pair comes from.
 */
export const USAGE_PAIRS = [
  // --- on the page ground (body / .wu-page) ---
  { fg: '--wu-ink', bg: '--wu-ground', kind: 'text', usage: 'body, .wu-page, h1-h3, .wu-terms dd, .wu-steps li, .wu-open' },
  { fg: '--wu-ink-2', bg: '--wu-ground', kind: 'text', usage: 'h4, .wu-lede, .wu-terms dt, .wu-footer dd' },
  { fg: '--wu-ink-3', bg: '--wu-ground', kind: 'text', usage: 'li::marker, .wu-steps li::marker, .wu-back, .wu-eyebrow, .wu-footer dt, .wu-meta' },
  { fg: '--wu-link', bg: '--wu-ground', kind: 'text', usage: 'a, .wu-back:hover, a:focus-visible outline' },
  { fg: '--wu-accent', bg: '--wu-ground', kind: 'text', usage: '.wu-accent' },
  { fg: '--wu-rule', bg: '--wu-ground', kind: 'ui', usage: 'hr, .wu-header/.wu-footer border, .wu-open dashed border, box borders' },
  { fg: '--wu-rule-soft', bg: '--wu-ground', kind: 'ui', usage: '.wu-steps li border-bottom; code/.wu-code/.wu-diff background edge' },

  // --- on a surface box (.wu-summary/.wu-toc/.wu-callout/.wu-decision/.wu-quote/.wu-figure/tables/.wu-chip) ---
  { fg: '--wu-ink', bg: '--wu-surface', kind: 'text', usage: '.wu-summary, .wu-toc a, .wu-callout p, .wu-decision, .wu-quote-ja, td, .wu-figure svg text' },
  { fg: '--wu-ink-2', bg: '--wu-surface', kind: 'text', usage: '.wu-decision strong, .wu-quote-original, .wu-figure figcaption, .wu-chip li' },
  { fg: '--wu-ink-3', bg: '--wu-surface', kind: 'text', usage: '.wu-toc p, .wu-callout::before (tone label), .wu-quote-source' },
  { fg: '--wu-link', bg: '--wu-surface', kind: 'text', usage: 'a inside a surface box, .wu-toc a:hover' },
  { fg: '--wu-accent', bg: '--wu-surface', kind: 'text', usage: '.wu-accent inside a surface box' },
  { fg: '--wu-accent', bg: '--wu-surface', kind: 'ui', usage: '.wu-figure rect.wu-focal stroke' },
  { fg: '--wu-ink', bg: '--wu-surface', kind: 'ui', usage: '.wu-figure node rect / edge stroke (currentColor), .wu-callout[decision] border' },
  { fg: '--wu-ink-3', bg: '--wu-surface', kind: 'ui', usage: '.wu-callout[warn] border-color (box edge against ground/surface)' },
  { fg: '--wu-rule', bg: '--wu-surface', kind: 'ui', usage: '.wu-summary/.wu-toc/.wu-callout/.wu-decision/.wu-quote/.wu-figure/.wu-chip li border' },
  { fg: '--wu-rule-soft', bg: '--wu-surface', kind: 'ui', usage: 'td border-bottom, th background edge' },

  // --- on the code background (code, .wu-code, .wu-diff, th, .wu-callout[warn]) ---
  { fg: '--wu-ink', bg: '--wu-rule-soft', kind: 'text', usage: 'code (inline), .wu-code, .wu-tok-fn, .wu-callout[warn] p, .wu-figure group label' },
  { fg: '--wu-ink-2', bg: '--wu-rule-soft', kind: 'text', usage: '.wu-diff, th, .wu-tok-num, .wu-tok-op' },
  { fg: '--wu-ink-3', bg: '--wu-rule-soft', kind: 'text', usage: '.wu-code/.wu-diff[data-lang]::before, .wu-tok-cmt, .wu-tok-del, .wu-callout[warn]::before' },
  { fg: '--wu-link', bg: '--wu-rule-soft', kind: 'text', usage: 'a > code (inline code inside a link)' },
  { fg: '--wu-accent', bg: '--wu-rule-soft', kind: 'text', usage: '.wu-tok-str' },
  { fg: '--wu-syn-kw', bg: '--wu-rule-soft', kind: 'text', usage: '.wu-tok-kw' },
  { fg: '--wu-syn-type', bg: '--wu-rule-soft', kind: 'text', usage: '.wu-tok-type' },

  // --- inside diff rows (.wu-tok-add/.wu-tok-del in .wu-diff, .wu-dv row tints) ---
  { fg: '--wu-ink', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-add line, .wu-dv add row text' },
  { fg: '--wu-ink-2', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-num/.wu-tok-op inside an add row; .wu-diff add line' },
  { fg: '--wu-ink-3', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-cmt inside an add row' },
  { fg: '--wu-accent', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-str inside an add row' },
  { fg: '--wu-syn-kw', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-kw inside an add row' },
  { fg: '--wu-syn-type', bg: '--wu-syn-add', kind: 'text', usage: '.wu-tok-type inside an add row' },
  { fg: '--wu-ink-3', bg: '--wu-syn-del', kind: 'text', usage: '.wu-tok-del line, .wu-dv del row (muted ink, tokens flattened to ink-3)' },
  { fg: '--wu-ink', bg: '--wu-syn-del', kind: 'text', usage: '.wu-dv del row line numbers / marker' },
  { fg: '--wu-syn-add', bg: '--wu-surface', kind: 'ui', usage: '.wu-dv add row tint vs the untinted context row (lightness-only distinction; marker column carries it)' },
  { fg: '--wu-syn-del', bg: '--wu-surface', kind: 'ui', usage: '.wu-dv del row tint vs the untinted context row (lightness-only distinction; marker column carries it)' },
  { fg: '--wu-syn-add', bg: '--wu-rule-soft', kind: 'ui', usage: '.wu-tok-add line vs the .wu-diff block background' },
  { fg: '--wu-syn-del', bg: '--wu-rule-soft', kind: 'ui', usage: '.wu-tok-del line vs the .wu-diff block background' },
  { fg: '--wu-syn-kw', bg: '--wu-surface', kind: 'text', usage: '.wu-tok-kw in a .wu-dv context row' },
  { fg: '--wu-syn-type', bg: '--wu-surface', kind: 'text', usage: '.wu-tok-type in a .wu-dv context row' },

  // --- figure tone fills (svg text is currentColor = ink; rect stroke is ink) ---
  { fg: '--wu-ink', bg: '--wu-fig-tone-ts', kind: 'text', usage: '.wu-figure rect[data-tone="ts"] + label' },
  { fg: '--wu-ink', bg: '--wu-fig-tone-rs', kind: 'text', usage: '.wu-figure rect[data-tone="rs"] + label' },
  { fg: '--wu-ink', bg: '--wu-fig-tone-new', kind: 'text', usage: '.wu-figure rect[data-tone="new"] + label' },
  { fg: '--wu-ink', bg: '--wu-fig-tone-neutral', kind: 'text', usage: '.wu-figure rect[data-tone="neutral"] + label' },
  { fg: '--wu-accent', bg: '--wu-fig-tone-rs', kind: 'ui', usage: '.wu-figure rect.wu-focal stroke on the darkest tone fill' },
  { fg: '--wu-fig-tone-ts', bg: '--wu-surface', kind: 'ui', usage: 'tone "ts" fill vs figure surface (lightness-only distinction)' },
  { fg: '--wu-fig-tone-rs', bg: '--wu-surface', kind: 'ui', usage: 'tone "rs" fill vs figure surface (lightness-only distinction)' },
  { fg: '--wu-fig-tone-new', bg: '--wu-surface', kind: 'ui', usage: 'tone "new" fill vs figure surface (lightness-only distinction)' },
  { fg: '--wu-fig-tone-neutral', bg: '--wu-surface', kind: 'ui', usage: 'tone "neutral" fill vs figure surface (lightness-only distinction)' },
  { fg: '--wu-fig-tone-ts', bg: '--wu-fig-tone-rs', kind: 'ui', usage: 'tone "ts" vs tone "rs" (the two most-used tones side by side)' },

  // --- inverted (light text on ink) ---
  { fg: '--wu-surface', bg: '--wu-ink', kind: 'text', usage: '::selection, .wu-chip li[aria-selected="true"] / [data-selected]' },

  // --- accent-soft: defined in every block but referenced by no rule ---
  { fg: '--wu-accent', bg: '--wu-accent-soft', kind: 'text', usage: '(unused) --wu-accent-soft is defined but no rule references it' },
  { fg: '--wu-ink', bg: '--wu-accent-soft', kind: 'text', usage: '(unused) --wu-accent-soft is defined but no rule references it' },
]

/** Minimum ratio a pair must reach for its kind. */
export const MIN_RATIO = { text: 4.5, ui: 3 }

/**
 * Run USAGE_PAIRS (or a custom pair list) against both themes.
 * Returns one row per (theme, pair); `pass` is against MIN_RATIO[kind].
 */
export function auditTokens(tokens, pairs = USAGE_PAIRS) {
  const rows = []
  for (const theme of ['light', 'dark']) {
    const t = tokens[theme]
    for (const p of pairs) {
      const fgv = t[p.fg]
      const bgv = t[p.bg]
      if (fgv === undefined || bgv === undefined) {
        throw new Error(`${theme}: token missing for pair ${p.fg} on ${p.bg}`)
      }
      const ratio = contrastRatio(fgv, bgv)
      rows.push({
        theme,
        fg: p.fg,
        bg: p.bg,
        fgValue: fgv,
        bgValue: bgv,
        ratio: Math.round(ratio * 100) / 100,
        level: levelFor(ratio),
        kind: p.kind,
        pass: ratio >= MIN_RATIO[p.kind],
        usage: p.usage,
      })
    }
  }
  return rows
}

/** Rows that fail their kind's minimum. */
export function failures(rows) {
  return rows.filter((r) => !r.pass)
}

/** Fixed-width text table of the audit rows (what the CLI prints). */
export function formatTable(rows) {
  const head = ['theme', 'pair', 'ratio', 'level', 'kind', 'ok', 'where used']
  const lines = rows.map((r) => [
    r.theme,
    `${r.fg.replace('--wu-', '')} on ${r.bg.replace('--wu-', '')}`,
    r.ratio.toFixed(2),
    r.level,
    r.kind,
    r.pass ? 'ok' : 'LOW',
    r.usage,
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)))
  const fmt = (cols) => cols.map((c, i) => (i === cols.length - 1 ? c : c.padEnd(widths[i]))).join('  ')
  return [fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...lines.map(fmt)].join('\n')
}

/**
 * Same audit as a Markdown table, one row per pair with the light and dark
 * ratios side by side (for references/tokens.md).
 */
export function formatMarkdown(rows) {
  const byPair = new Map()
  for (const r of rows) {
    const key = `${r.fg}|${r.bg}|${r.kind}`
    const entry = byPair.get(key) ?? { fg: r.fg, bg: r.bg, kind: r.kind, usage: r.usage }
    byPair.set(key, { ...entry, [r.theme]: r })
  }
  const cell = (r) => (r ? `${r.ratio.toFixed(2)} ${r.level}${r.pass ? '' : ' (LOW)'}` : '—')
  const out = ['| pair | kind | light | dark | where used |', '|---|---|---|---|---|']
  for (const e of byPair.values()) {
    const pair = `${e.fg.replace('--wu-', '')} on ${e.bg.replace('--wu-', '')}`
    out.push(`| ${pair} | ${e.kind} | ${cell(e.light)} | ${cell(e.dark)} | ${e.usage} |`)
  }
  return out.join('\n')
}
