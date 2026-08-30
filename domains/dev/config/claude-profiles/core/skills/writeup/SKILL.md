---
name: writeup
description: Use when the user wants a document that is kept and revisited rather than a one-off chat answer — a decision record (決定記録), design doc (設計), research summary (調査まとめ), reference roundup (参考資料まとめ), PBI doc (PBI 資料), picture explainer (絵解き), work note (作業メモ), or meeting minutes (議事録). Triggers include "まとめて", "設計書にして", "決定記録を残して", "資料にして", "writeup", "/writeup", and a research/design-review/acceptance/deliberate workflow that returned a Markdown report worth keeping. Not for a single in-chat visual answer (use show-me), a beginner picture explainer (use eli5), or a grilling interview round. Also not writeup when the text is headed somewhere else — Notion, a 社内 wiki, Slack, スライド, a PR description, or a repo README — even when the request says まとめて or 議事録.
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

If `$KIT` is empty, run in **kit-less fallback mode**: hand-write a minimal
inline `<style>`, render each figure's IR as a `.wu-table` of nodes/edges
instead of `render-diagram.mjs` (kit-less only), and skip lint. Record it:
`checks="lint=skipped;self-check=pass;diagram=fallback"`.

## Which store (before choosing the kind)

Stores are registered in `~/.local/share/writeup/stores.toml` — `default`
plus `name`/`path`/`description` per store (`work` = 仕事, `private` =
個人; never a directory mapping). `node "$KIT/bin/serve.mjs" --list-stores`
prints `<mark> <name>\t<path>\t<description>\t<flags>`, `*` = the store
this directory resolves to (repo marker, else `default`). **Nothing listed,
or one `legacy … (no registry: …)` line? No store exists yet — make them
before step 1:** `node "$SELF/scripts/init-store.mjs" --name work
--description 仕事`, then the same with `--name private --description 個人
--default` (each becomes its own git repo), then carry on. Decide from the
request wording, the repository you are in, and the recent conversation;
declare it in one line before saving (「work に保存します」); ask once only
when genuinely unsure. Set `STORE=<that path>` and pass `--store "$STORE"`
to every kit CLI (`serve`/`publish` also take `--store-name`). After the
first save inside a repository, offer `init-store.mjs --marker <name>`: it
writes `<repo root>/.writeup` (`store = "<name>"`) so later saves there skip
the question — portable, it names a store, not a path. Never mix work pages
into `private`.

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
   - Copy `$KIT/kit/template.html` with its `.wu-nav` back-link, and set the
     stylesheet to `../_kit/writeup.css` at the page's depth — the template
     ships `./writeup.css`, correct only inside `kit/`. A first save that
     renders unstyled is that placeholder and nothing worse: `build` (step 7)
     rewrites it, and re-depths it and `.wu-nav` on every later run. Never
     edit `.wu-header` / `.wu-footer` structure — only their text.
   - Read `$KIT/references/writing.md` (reader, one takeaway, sentence
     and card rules), then write the body in Japanese with role-named
     `.wu-*` components, covering this kind's required sections in order.
   - For each figure, pick the type first (`writing.md` §4: what must the
     reader see faster than prose — structure / flow / state / quantity /
     hierarchy / cause), check it against `render-diagram.mjs --list-types`,
     take the IR shape from `--doc <type>`, write the IR as YAML, then run
     `node $KIT/bin/render-diagram.mjs ir.yaml --figure > fig.html` (same
     command for every type; or `--json`, take `figureHtml`). Paste the
     `<figure>` as-is (`data-checks="pass"`, caption, IR script); never
     hand-wrap a raw `<svg>`. Exit 2 = IR invalid, exit 3 = a failed
     geometry check; over-budget figures render with `data-warn`. Handling
     each, and the 3-attempt rule: `references/procedure.md`.
   - A screenshot goes in `.wu-shot` with the file in `<slug>-assets/` next
     to the page; never `<img>` elsewhere, never an external image URL.
4. **Lint.** `node $KIT/bin/lint.mjs page.html --json`.
   `--surface-only` only for 作業メモ (contract Q33). `lint.mjs` finds
   `.writeup.toml` itself (ancestor search, then `$WRITEUP_STORE`).
   `[[allow]]` entries need `category`, `text`, `reason`. Fix or keep
   each finding; a kept one gets its reason in the commit message
   (step 7), never the page body.
5. **Self-check.** `node $KIT/bin/self-check.mjs page.html --write-meta`.
   Must exit 0. The value lives in `<meta name="checks">`: `--write-meta`
   patches only its `self-check=` key, so write `lint=` and `diagram=N/N`
   into that meta yourself first (self-check computes neither). The
   `.wu-footer` `<dd>` repeats the same string for the reader and **nothing
   syncs it** — retype it there in the same edit, or a passing page still
   reads `pending`.
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
   `init-store.mjs` makes every store its own git repo. A commit failing
   with `not a git repository` means the directory was conjured by `build`
   alone — run `init-store.mjs --name <name> --description <text>` against
   it (idempotent), then retry.
8. **Report the path** (store name + path). Offer to publish only if
   asked — see "Publish" below.

## Revisions

Overwrite the same file — same filename, same `<meta name="date">` — bump
`<meta name="updated">` (step 6's one-liner), then repeat steps 4-7. A page
whose *nature* changed (draft → decision) is a new page of the new `kind`.

## Searching

Read `$STORE/manifest.json` (the other store too when the request could
belong to either), filter by `kind`/`folder`/`title`/`description` — never
grep page bodies unless asked for full-text search. Return at most 3
candidates (`id`, `ref`, `updated`, `description`); a named id is an exact
`id` match (`serve.mjs` `/id/<id>` redirects). See `references/search.md`.

## Input from Markdown

`--from <md-path> --kind <kind>`: map headings, lists, tables, code blocks
and `A --> B` mermaid edges into `.wu-*` components and diagram IR (note any
loss where mermaid is richer), then continue at step 3. Mapping table:
`references/from-markdown.md`.

## Publish

The store page links `../_kit/writeup.css` (and, for a `.wu-shot`, its
`<slug>-assets/` files) — both exist only inside the store, so a copy of
the page handed anywhere else (the Artifact tool, Slack, email, a PR)
renders unstyled and without pictures; the only HTML that ever leaves the
store is `publish.mjs` output.

`node $KIT/bin/publish.mjs page.html --to artifact|cloudflare|file|github …`.
`--to artifact` writes `<store>/.publish/<slug>.artifact.html` as a
**fragment** (no `<!DOCTYPE>`/`<html>`/`<head>`/`<body>`, `<title>` first)
already shaped for the Artifact tool's own contract — hand it to the tool
as `file_path` exactly as written, never stripped or re-wrapped by hand
(favicon `📄`; title from `<title>`), write the returned URL into `<meta
name="published-artifact">`, commit. Exit 4 (private-word refusal) is
final — never bypass it. `--to cloudflare` needs `[cloudflare]
access_verified = true`. Exit codes and walkthroughs: `references/publish.md`.

**GitHub PR（非公開リポでも可）**: `--to github` is the one target that
writes a **folder**, not a single file — there is no repo commit, no
branch and no external host in this path, only GitHub's own attachment
store. `node $KIT/bin/publish.mjs page.html --to github --out
<dir> [--pdf] [--internal]` writes `<slug>.md` (figures linked as
`figures/<name>.svg`), `figures/*.svg` restyled standalone, a staged
`<slug>.html` (the 原本, useful on its own), and `<slug>.pdf` with `--pdf`.
Hand the folder to `gh pr create|comment --body-file <slug>.md --attach
figures/... [--attach <slug>.pdf]` — `--attach` uploads the files and
rewrites the Markdown's `![alt](figures/x.svg)` references to the
uploaded URLs (`gh` version: the next release after 2.98.0, or trunk —
GHES does not support it; on GHES, or an older `gh`, drag the same
`figures/` files into the PR editor by hand instead). It runs the same
private-word check as every other target by default (exit 4 on a hit) —
a public repo's PR is exactly as exposed as an Artifact page; pass
`--internal` only for a private company repo whose readers are its own
members. Walkthrough: `references/publish.md`.

## Common Mistakes

- Restyling `.wu-header` / `.wu-footer` instead of only changing their text — self-check rejects chrome that diverges from the template; likewise hand-editing `.wu-nav`'s `href` (`build` computes it).
- Hand-editing the stylesheet link after `build` has set it — write `../_kit/writeup.css` at the page's depth once; `build` rewrites the template's `./writeup.css` placeholder and re-depths the link, so an unstyled first save needs a build, not a panic.
- Adding a second `.wu-accent` "just for this section" — exactly one per page, ever.
- Skipping lint for a kind other than 作業メモ ("it's just a summary") — lint runs on all 8 kinds; only 作業メモ gets `--surface-only`.
- Pasting a diagram whose `render-diagram.mjs --json` returned `ok: false` — only exit-0 renders belong on the page.
- Forgetting to bump `<meta name="updated">` on a revision — the index sorts by `updated`, so a silent overwrite falls out of view.
- Publishing before self-check passes on its own — publish re-runs it and refuses at exit 3, but that's a backstop, not your gate.
- Handing a page's HTML to the Artifact tool (or any host) without going through `publish.mjs` — the store file links `../_kit/writeup.css` and its `<slug>-assets/` images, which exist only inside the store, so a raw copy renders unstyled and with broken pictures; `publish` inlines the kit CSS and every `.wu-shot` image, drops the back nav, screens private words, and re-runs build's rendering passes (viewport meta, `.wu-diffview` tables, code highlighting) — the only HTML that should ever leave the store is its output.
- Publishing a page that was never built and assuming it is finished — highlighting and diff tables are added by `build` (step 7), not by the author; publish re-applies them as a backstop, but the copy in the store stays unrendered until `build` runs.
- Saving to whichever store `serve` last used — the store is decided per request ("Which store" above); `build`/`git` must target that same `$STORE`.
