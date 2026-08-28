---
name: writeup
description: Use when the user wants a document that is kept and revisited rather than a one-off chat answer — a decision record (決定記録), design doc (設計), research summary (調査まとめ), reference roundup (参考資料まとめ), PBI doc (PBI 資料), picture explainer (絵解き), work note (作業メモ), or meeting minutes (議事録). Triggers include "まとめて", "設計書にして", "決定記録を残して", "資料にして", "writeup", "/writeup", and a research/design-review/acceptance/deliberate workflow that returned a Markdown report worth keeping. Not for a single in-chat visual answer (use show-me), a beginner picture explainer (use eli5), or a grilling interview round.
---

# writeup

## Overview

writeup produces one HTML page for one of 8 kinds of durable document,
saved into a git-backed store (a commit on every save). The visual and
structural contract lives in `writeup-kit`; this file drives it. Page
output is Japanese; class names, IR keys and CLI flags are English.

## Zero-dependency rule and kit resolution

Everything runs on `node` alone. Resolve the kit first:

```bash
SELF="<this skill's own directory>"; KIT=""
for d in "$SELF/../writeup-kit" "$HOME/.claude/skills/writeup-kit"; do [ -d "$d" ] && { KIT="$d"; break; }; done
```

If `$KIT` is empty, run in **kit-less fallback mode**: hand-write a
minimal inline `<style>`, render each figure's IR as a `.wu-table` of
nodes/edges instead of calling `render-diagram.mjs` (kit-less only), and
skip lint. Record it honestly: `checks="lint=skipped;self-check=pass;diagram=fallback"`.

## Which store (before choosing the kind)

Two independent stores — `work` (day-job pages) and `learn` (personal
study / projects), each its own git repo — are registered in
`~/.local/share/writeup/stores.toml`. Run
`node "$KIT/bin/serve.mjs" --list-stores`: one line per store,
`<mark> <name>\t<path>\t<flags>`, `*` = the store the current directory
resolves to (`cwd_prefixes` match, else `default`). Pick, in order:
1. The request clearly says work (仕事/会社/業務) or learn (個人/勉強) —
   that store wins over `*`. 2. Otherwise the `*` line. 3. A single
   `* legacy` line = no registry: that path is the only store.
Set `STORE=<chosen path>`; pass `--store "$STORE"` to every kit CLI
(`serve`/`publish` also take `--store-name`; `serve --all` serves every
store, one port each). Register: `node "$SELF/scripts/init-store.mjs
--name work --cwd-prefix <repo dir>` / `--name learn --default`. Never
mix work pages into `learn` or vice versa — when unsure, ask first.

## Procedure

1. **Decide kind and audience.** Map the request to one of the 8 kinds
   (heuristics and kind table: `references/procedure.md`). A Markdown
   report from a workflow (research / design-review / acceptance /
   deliberate) becomes step 3's `--from` path ("Input from Markdown").
2. **Read the contract for this kind.** The matching row of
   `$KIT/references/kinds.md` (required sections, use/avoid components,
   length, where a figure helps) and `$KIT/references/components.md`
   (the 20 role-named components) — both short tables.
3. **Write the page.**
   - Copy `$KIT/kit/template.html`, including its `.wu-nav` back-link.
     Never edit `.wu-header` / `.wu-footer` structure (chrome) — only the
     text values inside it (title, kind, dates, lede, checks, sources);
     `build` (step 7) fixes `.wu-nav`'s `href` for the page's depth or inserts it.
   - Read `$KIT/references/writing.md` (reader, one takeaway, sentence
     and card rules), then write the body in Japanese with role-named
     `.wu-*` components, covering this kind's required sections in order.
   - For each figure, write the diagram IR as YAML, then run:
     ```
     node $KIT/bin/render-diagram.mjs ir.yaml --figure > fig.html
     ```
     (or `--json` and take `figureHtml`). Paste the returned `<figure>`
     as-is (it carries `data-checks="pass"`, the caption, and the IR in
     `<script type="text/x-writeup-diagram">`); never hand-wrap a raw
     `<svg>`. Exit 2 = IR invalid (fix the named field). Over-budget
     figures still render, marked `data-warn` — consider splitting.
     Exit 3 = failed a contract §4-2 check: fix per `checks[].hint`,
     re-render, up to 3 attempts; still failing → keep the IR with a
     `.wu-callout data-tone="warn"` naming the check and tell the user;
     a `.wu-table` stand-in is for kit-less mode only (`references/procedure.md`).
4. **Lint.**
   ```
   node $KIT/bin/lint.mjs page.html --json
   ```
   `--surface-only` only for 作業メモ (contract Q33). `lint.mjs` finds
   `.writeup.toml` itself (ancestor search, then `$WRITEUP_STORE`).
   `[[allow]]` entries need `category`, `text`, `reason`. Fix or keep
   each finding; a kept one gets its reason in the commit message
   (step 7), never the page body.
5. **Self-check.**
   ```
   node $KIT/bin/self-check.mjs page.html --write-meta
   ```
   Must exit 0. `--write-meta` only patches the `self-check=` key in
   `<meta name="checks">` — set `lint=` and `diagram=N/N` yourself first
   (self-check never computes those two).
6. **Save.** Path: `$STORE/<folder>/<YYYY-MM-DD>-<slug>.html` (`folder`
   = project/topic). New page: date is today. Revision: keep the
   filename, set `<meta name="updated">` to today's datetime (a bare
   date also works via the git/mtime fallback):
   ```bash
   date +%Y-%m-%dT%H:%M%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/'
   ```
7. **Build and commit.**
   ```
   node $KIT/bin/build.mjs --store "$STORE"
   git -C "$STORE" add -A && git -C "$STORE" commit -m "<kind>: <title>"
   ```
8. **Report the path** (store name + path). Offer to publish only if
   asked — see "Publish" below.

## Revisions

Overwrite the same file — same filename, same `<meta name="date">` —
bump `<meta name="updated">` (step 6's one-liner), then repeat steps 4-7.
A page whose *nature* changed (draft → decision) is a new page of the
new `kind`, not a revision.

## Searching

Read `$STORE/manifest.json` (the other store too when the request could
belong to either), filter by `kind`/`folder`/`title`/`description` —
never grep page bodies unless asked for full-text search. Return at most
3 candidates (`id`, `ref`, `updated`, `description`). A named id ("id
9f3a1c2d を開いて") is an exact `id` match (`serve.mjs` `/id/<id>` redirects there). See `references/search.md`.

## Input from Markdown

`--from <md-path> --kind <kind>`: map headings, lists, tables, code
blocks, and `A --> B` mermaid edges into `.wu-*` components and diagram
IR (note any loss where mermaid is richer than the IR subset), then
continue at step 3. Mapping table in `references/from-markdown.md`.

## Publish

```
node $KIT/bin/publish.mjs page.html --to artifact|cloudflare|file …
```
`--to artifact` writes `<store>/.publish/<slug>.artifact.html` — hand
it to the Artifact tool (favicon `📄`; title from `<title>`), write the
returned URL into `<meta name="published-artifact">`, commit. Exit 4
(private-word refusal) is final — tell the user, never bypass it.
`--to cloudflare` needs `[cloudflare] access_verified = true` in
`.writeup.toml`. Exit codes and walkthroughs: `references/publish.md`.

## Common Mistakes

- Restyling `.wu-header` / `.wu-footer` instead of only changing their text — self-check rejects chrome that diverges from the template; likewise hand-editing `.wu-nav`'s `href` (`build` computes it).
- Adding a second `.wu-accent` "just for this section" — exactly one per page, ever.
- Skipping lint for a kind other than 作業メモ ("it's just a summary") — lint runs on all 8 kinds; only 作業メモ gets `--surface-only`.
- Pasting a diagram whose `render-diagram.mjs --json` returned `ok: false` — only exit-0 renders belong on the page.
- Forgetting to bump `<meta name="updated">` on a revision — the index sorts by `updated`, so a silent overwrite falls out of view.
- Publishing before self-check passes on its own — publish re-runs it and refuses at exit 3, but that's a backstop, not your gate.
- Saving to whichever store `serve` last used — the store is decided per request ("Which store" above); `build`/`git` must target that same `$STORE`.
