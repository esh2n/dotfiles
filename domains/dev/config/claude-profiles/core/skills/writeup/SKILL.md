---
name: writeup
description: Use when the user wants a document that is kept and revisited rather than a one-off chat answer — a decision record (決定記録), design doc (設計), research summary (調査まとめ), reference roundup (参考資料まとめ), PBI doc (PBI 資料), picture explainer (絵解き), work note (作業メモ), or meeting minutes (議事録). Triggers include "まとめて", "設計書にして", "決定記録を残して", "資料にして", "writeup", "/writeup", and a research/design-review/acceptance/deliberate workflow that returned a Markdown report worth keeping. Not for a single in-chat visual answer (use show-me), a beginner picture explainer (use eli5), or a grilling interview round.
---

# writeup

## Overview

writeup produces one HTML page for one of 8 kinds of durable document,
saved into a git-backed store with history (commits on every save). The
visual/structural contract lives in `writeup-kit`; this file drives it.
Page output is Japanese; component class names, diagram IR keys, and
CLI flags/output are English.

## Zero-dependency rule and kit resolution

Everything runs on `node` alone. Resolve the kit and the store first:

```bash
SELF="<this skill's own directory>"
if [ -d "$SELF/../writeup-kit" ]; then
  KIT="$SELF/../writeup-kit"
elif [ -d "$HOME/.claude/skills/writeup-kit" ]; then
  KIT="$HOME/.claude/skills/writeup-kit"
else
  KIT=""
fi
STORE="${WRITEUP_STORE:-$HOME/.local/share/writeup}"
```

If `$KIT` is empty, run in **kit-less fallback mode**: hand-write a
minimal inline `<style>`, render each figure's IR as a `.wu-table` of
nodes/edges instead of calling `render-diagram.mjs` (kit-less only —
never once the kit is present), and skip lint. Record the degradation
honestly, e.g. `checks="lint=skipped;self-check=pass;diagram=fallback"`.

## Procedure

1. **Decide kind and audience.** Map the request to one of the 8 kinds —
   heuristics and the full kind table are in `references/procedure.md`.
   If a workflow (research / design-review / acceptance / deliberate)
   already produced a Markdown report to keep, this becomes step 3's
   `--from` path instead of writing from scratch (see "Input from
   Markdown" below).
2. **Read the contract for this kind.** Read the matching row of
   `$KIT/references/kinds.md` (required sections, use/avoid components,
   length/figure budget) and `$KIT/references/components.md` (the 20
   role-named components) — read only what you need, both are short tables.
3. **Write the page.**
   - Copy `$KIT/kit/template.html`, including its `.wu-nav` back-link.
     Never edit `.wu-header` / `.wu-footer` structure (chrome) — only the
     text values inside it (title, kind, dates, lede, checks, sources);
     `build` (step 7) fixes `.wu-nav`'s `href` for this page's depth, or
     inserts the nav if it's missing.
   - Write the body in Japanese with role-named `.wu-*` components,
     covering this kind's required sections in order.
   - For each figure, write the diagram IR as YAML, then run:
     ```
     node $KIT/bin/render-diagram.mjs ir.yaml --figure > fig.html
     ```
     (or `--json` and take the `figureHtml` field). Paste the returned
     `<figure>` block into the page as-is — it already carries
     `data-checks="pass"`, the `<figcaption>`, and the IR in
     `<script type="text/x-writeup-diagram">`. Never hand-wrap a raw
     `<svg>` yourself. Exit 2 = IR invalid (fix the named field, or split
     per the `budget` suggestion). Exit 3 = rendered but failed a
     contract §4-2 check: fix per `checks[].hint` and re-render, up to 3
     attempts. Kit present and still failing after 3: keep the IR with a
     `.wu-callout data-tone="warn"` naming the failing check and tell the
     user — never swap in a `.wu-table` (kit-less mode only). Full
     detail in `references/procedure.md`.
4. **Lint.**
   ```
   node $KIT/bin/lint.mjs page.html --json
   ```
   `--surface-only` only for 作業メモ (contract Q33). `lint.mjs` finds
   `.writeup.toml` automatically (ancestor search, then `$WRITEUP_STORE`)
   — no `--config` needed. `[[allow]]` entries need `category`, `text`,
   `reason`. Decide fix-or-keep per finding; kept findings get their
   reason in the commit message (step 7), never the page body.
5. **Self-check.**
   ```
   node $KIT/bin/self-check.mjs page.html --write-meta
   ```
   Must exit 0. `--write-meta` only patches the `self-check=` key in
   `<meta name="checks">` — set `lint=` and `diagram=N/N` yourself first
   (self-check never computes those two).
6. **Save.** Path: `<store>/<folder>/<YYYY-MM-DD>-<slug>.html` (`folder`
   = project/topic). New page: date is today. Revision: keep the existing
   filename, set `<meta name="updated">` to today's datetime (more
   precise than a bare date, which still works via the git/mtime
   fallback):
   ```bash
   date +%Y-%m-%dT%H:%M%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/'
   ```
7. **Build and commit.**
   ```
   node $KIT/bin/build.mjs
   git -C "$STORE" add -A && git -C "$STORE" commit -m "<kind>: <title>"
   ```
8. **Report the path.** Tell the user where the page was saved. Offer to
   publish only if asked — see "Publish" below.

## Revisions

Overwrite the same file — same filename, same `<meta name="date">` —
bump `<meta name="updated">` (step 6's datetime one-liner), then repeat
steps 4-7. A page whose *nature* changed (a draft that became a
decision) is a new page of the new `kind`, not a revision.

## Searching

Read `<store>/manifest.json` and filter by `kind`/`folder`/`title`/
`description` — never grep page bodies unless asked for full-text search.
Return at most 3 candidates (`id`, `ref`, `updated`, `description`). A
named id ("id 9f3a1c2d を開いて") resolves via an exact match on
manifest's `id` (`bin/serve.mjs`'s `/id/<id>` route also redirects
there). Full procedure and a worked example in `references/search.md`.

## Input from Markdown

`--from <md-path> --kind <kind>`: map headings, lists, tables, code
blocks, and `A --> B` mermaid edges into `.wu-*` components and diagram
IR (note any loss when mermaid is richer than the IR subset), then
continue at step 3. Full mapping table in `references/from-markdown.md`.

## Publish

```
node $KIT/bin/publish.mjs page.html --to artifact|cloudflare|file …
```
`--to artifact` writes `<store>/.publish/<slug>.artifact.html` — hand
it to the Artifact tool (favicon `📄`; title from `<title>`), then write
the returned URL into `<meta name="published-artifact">` and commit.
Exit 4 (private-word refusal) is final — tell the user, never bypass
it. `--to cloudflare` needs `[cloudflare] access_verified = true` in
`.writeup.toml`. Full exit codes and walkthroughs in
`references/publish.md`.

## Common Mistakes

- Restyling `.wu-header` / `.wu-footer` instead of only changing their text — self-check rejects chrome that diverges from the template.
- Adding a second `.wu-accent` "just for this section" — exactly one per page, ever.
- Skipping lint for a kind other than 作業メモ ("it's just a summary") — lint runs on all 8 kinds; only 作業メモ gets `--surface-only`.
- Pasting a diagram whose `render-diagram.mjs --json` returned `ok: false` — only exit-0 renders belong on the page.
- Forgetting to bump `<meta name="updated">` on a revision — the index sorts by `updated`, so a silent overwrite falls out of view.
- Publishing before self-check passes on its own — publish re-runs it and refuses at exit 3, but that's a backstop, not your gate.
- Giving up on a figure after exit 3 and dropping in a `.wu-table` — that fallback is kit-less-mode only; with the kit present, retry per `checks[].hint` (3 attempts), then keep the IR with a warn callout.
- Hand-editing `.wu-nav`'s `href` — `build` (step 7) computes it from the page's depth; never set it yourself.
