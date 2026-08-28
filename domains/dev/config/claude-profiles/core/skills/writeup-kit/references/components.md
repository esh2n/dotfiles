# Components

20 role-named components, class-prefixed `wu-`. A component is named for its
**role in the document**, never for its appearance — there is no `.box` or
`.blue`. Each has a "use when" and a "do not use when" — this is the
component side of the kind-to-component mapping in `kinds.md`.

## Component table

| Component | Role | Use when | Do not use when |
|---|---|---|---|
| `.wu-page` | The whole page | Always, exactly one | — |
| `.wu-header` / `.wu-footer` | Chrome: title, kind, date, updated date | Always, copied verbatim from the template | Never edit the content |
| `.wu-lede` | Lede: what / for whom / conclusion | Always, exactly one paragraph | Two or more paragraphs |
| `.wu-summary` | Summary box, 3-5 lines | Opening of a decision record, design, or research summary | A work note |
| `.wu-toc` | Table of contents | 5 or more h2 sections | A short document |
| `.wu-section` | One h2 block | Always | — |
| `.wu-terms` | Term list (name — what it is) | 3 or more terms introduced for the first time | Paraphrasing body text |
| `.wu-callout` | Note / warning / decision aside (tone: `note` \| `warn` \| `decision`) | One point the reader must not skip | Three or more in a row |
| `.wu-decision` | One decision (decision, trade-off prioritized, basis) | A decision record entry | Enumerating candidates |
| `.wu-compare` | Comparison table (row = option, column = axis, up to 4 columns) | Judging 2-4 options on the same axes | Explaining one option, or a procedure |
| `.wu-table` | General table (up to 5 columns, one line per cell) | A plain list of values | A substitute for prose |
| `.wu-steps` | Numbered procedure, one step per line | Order matters | A parallel enumeration |
| `.wu-figure` | Diagram frame (SVG + caption + IR) | Renderer output only | Hand-drawn SVG, emoji |
| `.wu-quote` | Quote (original / translation / source) | Citing an external document | Your own sentence |
| `.wu-code` | Code block, language-tagged (`<pre>`) | DDL, types, config | A heading substitute |
| `.wu-diff` | Diff (before / after) | A change | — |
| `.wu-chip` | Parallel classification labels (3-6) | Tags, statuses | Emphasis, headings |
| `.wu-meta` | Source/basis line (`path:line`, URL) | Right after a claim | A substitute for body text |
| `.wu-open` | Open questions / assumptions frame | End of a decision record or design | — |
| `.wu-accent` | One emphasis point per page | The single point a reader should take away | A second occurrence |

## Minimal HTML shape per component

### `.wu-page`

```html
<div class="wu-page">
  <!-- header, sections, footer -->
</div>
```

### `.wu-header` / `.wu-footer`

Chrome. Copy these two blocks verbatim from `kit/template.html`; only the
text values (kind, dates, title, lede, checks, sources) change. `.wu-nav`,
the header's first child, is copied verbatim too — its `href` is a
placeholder; `build` rewrites it to the correct relative path up to the
store root's `index.html` (or inserts the nav entirely if a pre-nav page
lacks it) — never edit that href by hand.

```html
<header class="wu-header">
<nav class="wu-nav"><a class="wu-back" href="../index.html">一覧</a></nav>
<p class="wu-eyebrow">設計 &middot; 2026-08-28 &middot; 更新 2026-08-28</p>
<h1>ページ表題を一文で</h1>
<p class="wu-lede">このページが何を・誰に向けて書き、何を結論とするかを一段落で書く。</p>
</header>

<footer class="wu-footer">
<dl>
<dt>checks</dt><dd>lint=pass; self-check=pass; diagram=2/2</dd>
<dt>sources</dt><dd>[label (YYYY/MM), location]</dd>
</dl>
</footer>
```

### `.wu-lede`

```html
<p class="wu-lede">One paragraph: what this is, for whom, and the conclusion.</p>
```

### `.wu-summary`

```html
<div class="wu-summary">
  <p>3-5 lines summarizing the page before the reader commits to it.</p>
</div>
```

### `.wu-toc`

```html
<nav class="wu-toc">
  <ol>
    <li><a href="#background">Background</a></li>
  </ol>
</nav>
```

### `.wu-section`

```html
<section class="wu-section">
  <h2>Section title</h2>
  <p>Body text.</p>
</section>
```

### `.wu-terms` (dl)

```html
<dl class="wu-terms">
  <dt>Term</dt>
  <dd>What it is.</dd>
</dl>
```

### `.wu-callout` (`data-tone`: `note` | `warn` | `decision`)

```html
<div class="wu-callout" data-tone="note">
  <p>The one point the reader must not skip.</p>
</div>
```

### `.wu-decision`

```html
<div class="wu-decision">
  <p><strong>Decision:</strong> what was chosen.</p>
  <p><strong>Trade-off prioritized:</strong> what this gains and gives up.</p>
  <p><strong>Basis:</strong> why.</p>
</div>
```

### `.wu-compare` (table, up to 4 columns)

```html
<table class="wu-compare">
  <thead><tr><th>Option</th><th>Axis A</th><th>Axis B</th></tr></thead>
  <tbody><tr><td>Option 1</td><td>...</td><td>...</td></tr></tbody>
</table>
```

### `.wu-table` (up to 5 columns)

```html
<table class="wu-table">
  <thead><tr><th>Key</th><th>Value</th></tr></thead>
  <tbody><tr><td>path</td><td>store-relative path</td></tr></tbody>
</table>
```

### `.wu-steps` (ol)

```html
<ol class="wu-steps">
  <li>First step, one line.</li>
  <li>Second step, one line.</li>
</ol>
```

### `.wu-figure` (figure > svg + figcaption + IR script)

```html
<figure class="wu-figure">
  <svg role="img" aria-labelledby="wu-d-1-title" viewBox="0 0 640 320">
    <title id="wu-d-1-title">Diagram title</title>
    <desc>What this diagram argues, in one sentence.</desc>
  </svg>
  <figcaption>Caption: what this diagram argues.</figcaption>
  <script type="text/x-writeup-diagram">
id: d1
title: Diagram title
caption: What this diagram argues.
nodes: []
edges: []
  </script>
</figure>
```

The IR script's content is HTML-escaped text (`&` → `&amp;`, `<` → `&lt;`,
`>` → `&gt;` — `bin/lib/ir-script.mjs`'s `escapeIrScript`/`unescapeIrScript`):
`<script>` is an HTML raw-text element that browsers never decode, so an
unescaped label or caption could inject a literal tag or break out of the
block early via a literal `</script>`. Every writer of this script
(`renderFigureHtml` in `bin/lib/diagram.mjs`, the migration fallback in
`bin/lib/migrate/directives.mjs`) escapes before embedding; every reader
(`bin/rerender-figures.mjs`, `bin/to-md.mjs`) unescapes before parsing the
YAML/JSON. Unescaping is tolerant of legacy pages written before this
contract existed: text with neither `&lt;` nor `&amp;` is treated as
already-raw and passed through unchanged, so old store pages keep parsing
until `bin/rerender-figures.mjs --all` rewrites them into the escaped form.

A diagram with 2+ groups where every node belongs to one, and the edges
crossing between groups all point the same overall direction (a DAG over
the groups — no group cycles back to one that already points to it),
renders those groups as parallel columns (`right`) or rows (`down`)
instead of elk's default nested boxes: each group's position is the
longest inter-group-edge path to it, so a group nothing points to sits
first, however many groups separate it from the last. Give a group an
explicit `layer: <int>` (0-based) to pin its order by hand, or `layer:
none` to opt that diagram back out to elk's default layout — see
`references/procedure.md` in the `writeup` skill for the full IR hint
list.

### `.wu-quote`

```html
<blockquote class="wu-quote">
  <p class="wu-quote-original">Original text in its source language.</p>
  <p class="wu-quote-ja">日本語訳。</p>
  <cite class="wu-quote-source">Source, location</cite>
</blockquote>
```

### `.wu-code` (pre with `data-lang`)

```html
<pre class="wu-code" data-lang="sql"><code>SELECT 1;</code></pre>
```

Author `<code>` plain, un-highlighted, as above — `build` syntax-highlights it
in place (`bin/lib/highlight.mjs`: go, ts/tsx/js/jsx, sql, yaml, json,
bash/sh, python, toml, html, diff, or a plain-text no-op for any other
`data-lang`), wrapping tokens in `<span class="wu-tok-*">` and marking the
`<pre>` `data-hl="1"`; a block already carrying `wu-tok-` spans is left
untouched, so re-running `build` never re-wraps it.

### `.wu-diff` (pre with `data-lang="diff"`)

```html
<pre class="wu-diff" data-lang="diff"><code>-old line
+new line</code></pre>
```

### `.wu-chip`

```html
<ul class="wu-chip">
  <li>tag-a</li>
  <li>tag-b</li>
</ul>
```

### `.wu-meta`

```html
<p class="wu-meta">src/foo.go:42</p>
```

### `.wu-open`

```html
<div class="wu-open">
  <ul>
    <li>Unresolved question or assumption left for later.</li>
  </ul>
</div>
```

### `.wu-accent`

```html
<span class="wu-accent">the one point to take away</span>
```

## Skin rules (apply to every component)

- [ ] Chromatic color budget: one link color, one accent color — the accent
  appears only on `.wu-accent` and a diagram's focal node(s), never as
  decoration elsewhere.
- [ ] No `box-shadow` anywhere. Hierarchy comes from surface color
  differences, borders, and spacing.
- [ ] No emoji and no arrow characters (→, ➜, etc.) used as a diagram symbol
  or a heading marker. If a symbol is needed, use a kit SVG icon.
- [ ] Exactly three type roles: body, heading, monospace. Six size steps
  only: 13 / 14 / 15.5 / 17 / 21 / 30 (px).
- [ ] Exactly seven spacing tokens: 4 / 8 / 12 / 16 / 24 / 32 / 48 (px). No
  literal pixel values written per-component.
- [ ] Three theme states: bare `:root` (light), `prefers-color-scheme: dark`
  guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`.
  Every color goes through a token; dark is a separate paired palette, not a
  hex inversion.
- [ ] Horizontal scroll is contained inside `.wu-table`, `.wu-figure`, and
  `.wu-code` only. Body text wraps at 68ch — it never scrolls horizontally.

### `.wu-scroll`

Scroll container for the rare table (or figure) wider than the column. Wrap
the element; the page body never scrolls sideways. Tables inside keep their
natural width instead of stretching to 100%.

```html
<div class="wu-scroll">
  <table class="wu-table">…</table>
</div>
```
