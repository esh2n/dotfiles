---
name: writeup-kit
description: Shared design kit (CSS tokens, 20 role-named components, page template, diagram IR contract, self-check rules) read by the writeup, grilling, eli5 and show-me skills whenever they produce an HTML page. Not invoked directly by users.
---

# writeup-kit

## Overview

writeup-kit is the shared visual and structural contract behind every page
that the writeup, grilling, eli5, and show-me skills produce. It supplies
CSS tokens, 20 role-named components, a page template, the diagram IR
(intermediate representation) format, and the self-check rules that decide
whether a page is well-formed before it is saved or published.

**Zero-dependency rule:** everything in this kit runs on `node` alone — no
`npm install`, no calling out to another skill, no external CLI. Vendored
files (a bundled graph layout library, a bundled Japanese tokenizer) ship
inside `vendor/` so the kit works on a machine with nothing else installed.

## How other skills resolve the kit

A skill that produces a page looks for the kit in this order:

1. Sibling directory: `../writeup-kit/` (next to the calling skill's own directory)
2. Shared install: `~/.claude/skills/writeup-kit/`
3. **Kit-less fallback mode** — if neither exists, the calling skill still
   produces a page, but with reduced fidelity: minimal CSS inlined by hand
   (no shared tokens), diagrams rendered as a plain table of their IR
   instead of SVG, and the lint gate reduced to its 6 surface-level
   detectors only. The page's `<meta name="checks">` records that it ran
   in fallback mode.

## File map

- `kit/` — `writeup.css` (tokens + components), `template.html` (page
  skeleton with verbatim chrome), `samples.html` (one example of every
  component)
- `references/` — `components.md` (full component table + HTML shapes),
  `kinds.md` (the 8 page types and their required sections), `page-contract.md`
  (store layout, meta contract, self-check table, Markdown mapping, publish)
- `bin/` — *arrives in M2–M4*: `render-diagram`, `lint`, `self-check`,
  `build`, `serve`, `publish`, `to-md`
- `vendor/` — *arrives in M2–M4*: `elk.bundled.js` (graph layout),
  lindera wasm + dictionary (Japanese tokenizer for the lint gate)

## Quick Reference

20 role-named components, prefixed `wu-`. Full table with do/don't guidance
in `references/components.md`.

| Component | Use when |
|---|---|
| `wu-page` | always, once, wraps the whole document |
| `wu-header` / `wu-footer` | always — chrome copied verbatim from the template |
| `wu-lede` | always, exactly one paragraph |
| `wu-summary` | opening of a decision record, design, or research summary |
| `wu-toc` | 5 or more h2 sections |
| `wu-section` | always, one per h2 |
| `wu-terms` | 3 or more terms introduced for the first time |
| `wu-callout` | one point the reader must not skip |
| `wu-decision` | one decision record entry |
| `wu-compare` | 2-4 options judged on the same axes |
| `wu-table` | a plain list of values |
| `wu-steps` | order matters |
| `wu-figure` | renderer output only — never hand-drawn SVG or emoji |
| `wu-quote` | quoting an external source |
| `wu-code` | DDL, types, config |
| `wu-diff` | before/after change |
| `wu-chip` | 3-6 parallel tags or statuses |
| `wu-meta` | a citation right after a claim |
| `wu-open` | end of a decision record or design: open questions/assumptions |
| `wu-accent` | the single point a reader should take away — one per page |

## Rules that apply to every component

- **Two colors only**: one link color, one accent color. The accent color
  appears only on `.wu-accent` and on a diagram's focal node(s) — never as
  decoration.
- **Three theme states**: bare `:root` (light), `prefers-color-scheme: dark`
  guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`.
  Every color goes through a token; dark mode is a separate paired palette,
  never a hex inversion.
- **No shadows.** Hierarchy comes from surface color, borders, and spacing —
  never `box-shadow`.
- **No emoji, no arrow characters** as diagram symbols or heading markers.
  If a symbol is needed, use a kit SVG icon.

## Common Mistakes

- Restyling the chrome (`.wu-header` / `.wu-footer`) instead of copying it
  verbatim from `kit/template.html` — the self-check gate rejects any
  chrome that diverges from the template.
- Adding a second accent color for "just this one section" — the contract
  allows exactly one accent color per page, used on `.wu-accent` and
  diagram focal nodes only.
- Using an emoji or an arrow character (→, ➜) as a glyph in a heading,
  callout, or diagram — use plain text or a kit SVG icon instead.
- Writing a literal pixel value for spacing (`margin: 10px`) instead of one
  of the 7 spacing tokens (4/8/12/16/24/32/48) — literal values drift from
  the rest of the kit over time.
- Loading any external CSS or script beyond `_kit/writeup.css` and the
  Google Fonts stylesheet link — the self-check gate flags any other
  external `href`/`src` as an error.
