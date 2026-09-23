# Tokens

Design tokens of `kit/writeup.css`, measured. Contrast numbers come from
`node bin/contrast.mjs --md` (re-run it after editing a color; the test in
`test/contrast.test.mjs` fails when any text pair drops below 4.5:1).

Values marked in the 根拠 column were changed on 2026-08-29 following the
type-and-color token research (learn store, page
`writeup/2026-08-29-type-and-color-token-research.html`; working files in
`_design/2026-08-29-research-type-color.md`, `-contrast-proposed.md`,
`-apca.mjs`). The owner answered all 8 questions of that page YES. APCA Lc
values are from the research's `apca.mjs` (APCA-W3 0.1.9 constants).

## Token table

| Token | Light | Dark | Role | 根拠 |
|---|---|---|---|---|
| `--wu-ground` | `#f7f7f5` | `#13161c` | page background (body, `.wu-page`) | unchanged (warm off-white: Rello & Bigham 2017, weak support) |
| `--wu-surface` | `#ffffff` | `#1b1f27` | box background: summary, toc, callout, decision, tables, figure, quote, chip | unchanged |
| `--wu-ink` | `#1c212b` | `#e7e9ed` | body text, headings, svg strokes/labels, h2 top rule, decision-callout border | unchanged (15.0:1 / Lc 98 light, 14.9:1 / Lc −93 dark) |
| `--wu-ink-2` | `#4a5464` | `#c8cdd6` | secondary text: h4, lede, terms dt, figcaption, th, diff, chips, tok-num/op | dark `#b7bec9` → `#c8cdd6` (Lc −66 → −75, APCA body-text floor 75; used at lede 18px and th). Research §2 APCA; light unchanged (Lc 82) |
| `--wu-ink-3` | `#565e6d` | `#b3bac4` | tertiary text: eyebrow, meta, markers, tone/lang labels, quote source, tok-cmt/del; warn-callout border | light `#5f6776` → `#565e6d` (Lc 74 → 77), dark `#9aa2b0` → `#b3bac4` (Lc −51 → −64): used at 13–14px, where Dobres et al. 2017 shows small text needs more contrast; APCA §2 |
| `--wu-rule` | `#d9dce2` | `#333945` | hairline borders: hr, header/footer, boxes, chips, open (dashed) | unchanged |
| `--wu-rule-soft` | `#ececef` | `#232833` | code / diff / th / warn-callout background; td and steps separators; svg group fill | unchanged |
| `--wu-link` | `#2f4b9c` | `#abbdee` | links, focus-visible outline, `.wu-back`/`.wu-toc a` hover | dark `#93a9e8` → `#abbdee` (Lc −56 → −66; underline carries the rest, so Lc 75 not required). Research §2 APCA, §3.5 CVD-safe blue/orange pair; light unchanged |
| `--wu-accent` | `#9c4a2f` | `#e8ab93` | `.wu-accent`, `.wu-tok-str`, `.wu-focal` stroke (one emphasis per page; the syntax set `--wu-syn-*` is the only other chromatic color, confined to code and diff blocks) | dark `#e0987c` → `#e8ab93` (Lc −55 → −64; 5.64:1 on fig-tone-rs). Research §2 APCA; light unchanged (Lc 75) |
| `--wu-accent-soft` | `#f2e4de` | `#3a281f` | defined in all three blocks, referenced by no rule (unused) | unchanged |
| `--wu-syn-kw` | `#5e3d8c` | `#c9a7e6` | `.wu-tok-kw` (keyword, also bold) | added 2026-08-30 (owner decision: restrained syntax palette). Muted plum, far from link blue; 7.06:1 light / 7.14:1 dark on rule-soft |
| `--wu-syn-type` | `#1a6363` | `#7fc5c1` | `.wu-tok-type` (type name, also bold) | added 2026-08-30. Muted teal; 5.92:1 light / 7.49:1 dark on rule-soft |
| `--wu-syn-add` | `#e2efe0` | `#1e3326` | `.wu-tok-add` line background, `.wu-dv` add-row tint | added 2026-08-30. Pale green; every ink and token color stays ≥ 4.5:1 on it |
| `--wu-syn-del` | `#f6e3e3` | `#3b2326` | `.wu-tok-del` line background, `.wu-dv` del-row tint (text stays ink-3 + line-through) | added 2026-08-30. Pale red; ink-3 5.29:1 light / 7.38:1 dark on it |
| `--wu-fig-tone-ts` / `-rs` / `-new` / `-neutral` | `#e9ecf1` / `#d2d7df` / `#ffffff` / `#f1f1f3` | `#232936` / `#353c49` / `#161a21` / `#272c36` | figure rect fills per `data-tone` (lightness-only distinction) | unchanged |
| `--wu-font-body` | BIZ UDPGothic, Hiragino Sans, Noto Sans JP, sans-serif | same | body text | unchanged (sans-serif: Rello & Baeza-Yates 2013; UD claim itself unsupported: 後藤 2023) |
| `--wu-font-heading` | BIZ UDPGothic, Hiragino Sans, Noto Sans JP, sans-serif (weight 700) | same | headings, toc numbers, terms dt, callout label, decision strong, th, index chips | Zen Kaku Gothic New → BIZ UDPGothic (Q5). **Owner decision against the researcher's recommendation** (research §4.5: no experiment either way; NN/g F-pattern 2006/2017 supports visual distinction of headings, not a second typeface; recommendation was "keep"). Gain: one font request fewer; weight 700 carries the distinction. The Google Fonts `<link>` in `kit/template.html`, `kit/samples.html` and the index in `bin/build.mjs` no longer requests Zen Kaku Gothic New |
| `--wu-font-mono` | IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace | same | code, diff, meta ids | unchanged |
| `--wu-fs-1` … `--wu-fs-6` | 13 / 14 / 16 / 18 / 21 / 30 px | same | type scale (body = fs-3, h3 + lede = fs-4, h2 = fs-5, h1 = fs-6) | fs-3 15.5 → 16px: 阿久津 2010 best-reading range 12–15pt (16–20px) lower bound; Legge & Bigelow 2011 0.2° floor cleared at 60cm. fs-4 17 → 18px: keeps the 1.125 body ratio (no separate evidence). fs-1/2/5/6 unchanged (13px ≈ 9.75pt is inside 阿久津 2010's "≥ 6pt: speed constant" range; only auxiliary text) |
| `--wu-sp-1` … `--wu-sp-7` | 4 / 8 / 12 / 16 / 24 / 32 / 48 px | same | spacing scale | unchanged |
| `--wu-radius-1` … `-3` | 4 / 6 / 8 px | same | radius (boxes use 0; only inline code and chips are rounded) | unchanged |
| `--wu-bw-1` … `-3` | 1 / 1.5 / 2 px | same | border width (hairline / open + decision callout / h2 rule + focus ring) | unchanged |

Both dark blocks (`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values (checked by `darkDrift`).

## Measured contrast (WCAG 2.x)

Generated by `node bin/contrast.mjs --md` (rerun after any token change; the test
`test/contrast.test.mjs` fails the build when a text pair drops below 4.5:1).
`ui` rows are box edges and figure fills: they are decorative, distinguished by a
stroke as well, and are not held to 3:1.

| pair | kind | light | dark | where used |
|---|---|---|---|---|
| ink on ground | text | 15.04 AAA | 14.90 AAA | body, .wu-page, h1-h3, .wu-terms dd, .wu-steps li, .wu-open |
| ink-2 on ground | text | 7.14 AAA | 11.35 AAA | h4, .wu-lede, .wu-terms dt, .wu-footer dd |
| ink-3 on ground | text | 6.08 AA | 9.26 AAA | li::marker, .wu-steps li::marker, .wu-back, .wu-eyebrow, .wu-footer dt, .wu-meta |
| link on ground | text | 7.51 AAA | 9.70 AAA | a, .wu-back:hover, a:focus-visible outline |
| accent on ground | text | 5.70 AA | 9.21 AAA | .wu-accent |
| rule on ground | ui | 1.28 fail (LOW) | 1.56 fail (LOW) | hr, .wu-header/.wu-footer border, .wu-open dashed border, box borders |
| rule-soft on ground | ui | 1.10 fail (LOW) | 1.23 fail (LOW) | .wu-steps li border-bottom; code/.wu-code/.wu-diff background edge |
| ink on surface | text | 16.13 AAA | 13.58 AAA | .wu-summary, .wu-toc a, .wu-callout p, .wu-decision, .wu-quote-ja, td, .wu-figure svg text |
| ink-2 on surface | text | 7.65 AAA | 10.35 AAA | .wu-decision strong, .wu-quote-original, .wu-figure figcaption, .wu-chip li |
| ink-3 on surface | text | 6.53 AA | 8.44 AAA | .wu-toc p, .wu-callout::before (tone label), .wu-quote-source |
| link on surface | text | 8.05 AAA | 8.84 AAA | a inside a surface box, .wu-toc a:hover |
| accent on surface | text | 6.12 AA | 8.40 AAA | .wu-accent inside a surface box |
| accent on surface | ui | 6.12 AA | 8.40 AAA | .wu-figure rect.wu-focal stroke |
| ink on surface | ui | 16.13 AAA | 13.58 AAA | .wu-figure node rect / edge stroke (currentColor), .wu-callout[decision] border |
| ink-3 on surface | ui | 6.53 AA | 8.44 AAA | .wu-callout[warn] border-color (box edge against ground/surface) |
| rule on surface | ui | 1.37 fail (LOW) | 1.42 fail (LOW) | .wu-summary/.wu-toc/.wu-callout/.wu-decision/.wu-quote/.wu-figure/.wu-chip li border |
| rule-soft on surface | ui | 1.18 fail (LOW) | 1.12 fail (LOW) | td border-bottom, th background edge |
| ink on rule-soft | text | 13.68 AAA | 12.14 AAA | code (inline), .wu-code, .wu-tok-fn, .wu-callout[warn] p, .wu-figure group label |
| ink-2 on rule-soft | text | 6.49 AA | 9.25 AAA | .wu-diff, th, .wu-tok-num, .wu-tok-op |
| ink-3 on rule-soft | text | 5.54 AA | 7.55 AAA | .wu-code/.wu-diff[data-lang]::before, .wu-tok-cmt, .wu-tok-del, .wu-callout[warn]::before |
| link on rule-soft | text | 6.83 AA | 7.90 AAA | a > code (inline code inside a link) |
| accent on rule-soft | text | 5.19 AA | 7.50 AAA | .wu-tok-str |
| syn-kw on rule-soft | text | 7.06 AAA | 7.14 AAA | .wu-tok-kw |
| syn-type on rule-soft | text | 5.92 AA | 7.49 AAA | .wu-tok-type |
| ink on syn-add | text | 13.56 AAA | 11.10 AAA | .wu-tok-add line, .wu-dv add row text |
| ink-2 on syn-add | text | 6.44 AA | 8.45 AAA | .wu-tok-num/.wu-tok-op inside an add row; .wu-diff add line |
| ink-3 on syn-add | text | 5.49 AA | 6.90 AA | .wu-tok-cmt inside an add row |
| accent on syn-add | text | 5.14 AA | 6.86 AA | .wu-tok-str inside an add row |
| syn-kw on syn-add | text | 7.00 AAA | 6.52 AA | .wu-tok-kw inside an add row |
| syn-type on syn-add | text | 5.87 AA | 6.85 AA | .wu-tok-type inside an add row |
| ink-3 on syn-del | text | 5.29 AA | 7.38 AAA | .wu-tok-del line, .wu-dv del row (muted ink, tokens flattened to ink-3) |
| ink on syn-del | text | 13.07 AAA | 11.88 AAA | .wu-dv del row line numbers / marker |
| syn-add on surface | ui | 1.19 fail (LOW) | 1.22 fail (LOW) | .wu-dv add row tint vs the untinted context row (lightness-only distinction; marker column carries it) |
| syn-del on surface | ui | 1.23 fail (LOW) | 1.14 fail (LOW) | .wu-dv del row tint vs the untinted context row (lightness-only distinction; marker column carries it) |
| syn-add on rule-soft | ui | 1.01 fail (LOW) | 1.09 fail (LOW) | .wu-tok-add line vs the .wu-diff block background |
| syn-del on rule-soft | ui | 1.05 fail (LOW) | 1.02 fail (LOW) | .wu-tok-del line vs the .wu-diff block background |
| syn-kw on surface | text | 8.33 AAA | 7.98 AAA | .wu-tok-kw in a .wu-dv context row |
| syn-type on surface | text | 6.98 AA | 8.38 AAA | .wu-tok-type in a .wu-dv context row |
| ink on fig-tone-ts | text | 13.62 AAA | 11.98 AAA | .wu-figure rect[data-tone="ts"] + label |
| ink on fig-tone-rs | text | 11.16 AAA | 9.12 AAA | .wu-figure rect[data-tone="rs"] + label |
| ink on fig-tone-new | text | 16.13 AAA | 14.35 AAA | .wu-figure rect[data-tone="new"] + label |
| ink on fig-tone-neutral | text | 14.30 AAA | 11.52 AAA | .wu-figure rect[data-tone="neutral"] + label |
| accent on fig-tone-rs | ui | 4.23 AA-large | 5.64 AA | .wu-figure rect.wu-focal stroke on the darkest tone fill |
| fig-tone-ts on surface | ui | 1.18 fail (LOW) | 1.13 fail (LOW) | tone "ts" fill vs figure surface (lightness-only distinction) |
| fig-tone-rs on surface | ui | 1.45 fail (LOW) | 1.49 fail (LOW) | tone "rs" fill vs figure surface (lightness-only distinction) |
| fig-tone-new on surface | ui | 1.00 fail (LOW) | 1.06 fail (LOW) | tone "new" fill vs figure surface (lightness-only distinction) |
| fig-tone-neutral on surface | ui | 1.13 fail (LOW) | 1.18 fail (LOW) | tone "neutral" fill vs figure surface (lightness-only distinction) |
| fig-tone-ts on fig-tone-rs | ui | 1.22 fail (LOW) | 1.31 fail (LOW) | tone "ts" vs tone "rs" (the two most-used tones side by side) |
| surface on ink | text | 16.13 AAA | 13.58 AAA | ::selection, .wu-chip li[aria-selected="true"] / [data-selected] |
| accent on accent-soft | text | 4.93 AA | 7.10 AAA | (unused) --wu-accent-soft is defined but no rule references it |
| ink on accent-soft | text | 13.00 AAA | 11.49 AAA | (unused) --wu-accent-soft is defined but no rule references it |

## Measure and line-height

| Token | Value | Used by | 根拠 |
|---|---|---|---|
| `--wu-measure` | `45em` (= 720px at fs-3 16px; ≈ 45 full-width characters) | `.wu-page main`, `.wu-header`, `.wu-footer`, `.wu-lede` | 68ch → 45em (research §4.3). BIZ UDPGothic `ch` ≈ 0.76em, so 68ch was 826px ≈ 51.7 kanji per line — above the 35–45 character convention; Dyson & Haselgrove 2001's 55 cpl corresponds to ≤ 45 full-width characters by visual width. 720px also equals the figure column (`COLUMN` in `bin/lib/diagram.mjs`) |
| `--wu-lh-body` | `1.85` | `body` (fs-3 16px × 1.85 = 29.6px leading) | unchanged (inside the 160–200% convention; JLReq gives no number) |
| `--wu-lh-heading` | `1.35` | `h1`–`h4` | unchanged |
| `--wu-lh-code` | `1.6` | `.wu-code` | unchanged |
| `--wu-lh-diff` | `1.7` | `.wu-diff` | unchanged |

Figure fit inside the measure: `.wu-page main` is `border-box`, so its 720px
includes `--wu-sp-4` padding on both sides → 688px content; `.wu-figure` adds
16px padding + 1px border per side → 654px for the `<svg>`. A 720px `COLUMN`
diagram is therefore shown at 654px (scale 0.908) through `max-width: 100%`
(under 68ch it had 760px and fit unscaled). Node text renders at ~11.8px
instead of 13px; the diagram is still not scrolled (`data-scroll` unchanged).

Inline `code` is `0.88em` (literal, not a scale step); `.wu-chip li` is `line-height: 1`.

## State matrix (what the CSS defines)

| Component | hover | focus-visible | active | disabled | selected / current |
|---|---|---|---|---|---|
| `a` | underline 1px → 2px | 2px `link` outline, offset 2px | color → `accent` | — | `:visited` unchanged (deliberate: documents are re-read) |
| `a[data-wu-missing]` | as `a` | as `a` | as `a` | — | muted ink-3, dotted underline (target gone from the store) |
| `button` | — | 2px `link` outline | — | ink-3, `not-allowed` cursor | — |
| `.wu-back` | color → `link`, underline | as hover | as `a` | — | — |
| `.wu-toc a` | color → `link`, underline | inherits `a` | as `a` | — | `[aria-current="true"]`: link color, bold |
| `.wu-table tbody tr` | `td` background → rule-soft | — | — | — | — |
| `.wu-chip li` | — | — | — | — | `[aria-selected="true"]` / `[data-selected]`: ink background, surface text |
| `.wu-callout` | — | — | — | — | `data-tone` note / warn / decision |
| `.wu-figure` | — | — | — | — | `data-scroll="true"`; `rect[data-tone]`; `.wu-focal` |
| `.wu-code` / `.wu-diff` | — | — | — | — | `data-lang` label |
| text selection | — | — | — | — | `::selection`: ink background, surface text |

Media blocks: `prefers-color-scheme: dark`, `[data-theme]` override, `prefers-reduced-motion`,
`print`, `forced-colors: active` (box edges and figure strokes → `CanvasText`, selected chips → `Highlight`).
Not defined: `:target`, reduced-transparency. The index page (`bin/build.mjs`) styles its own
filter chips (`.wu-fchip.is-active`, `.wu-vbtn[aria-pressed]`) with the same ink/surface inversion.
