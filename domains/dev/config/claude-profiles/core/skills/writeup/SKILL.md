---
name: writeup
description: Use when the user wants a document that is kept and revisited rather than a one-off chat answer — a decision record (決定記録), design doc (設計), research summary (調査まとめ), reference roundup (参考資料まとめ), PBI doc (PBI 資料), picture explainer (絵解き), work note (作業メモ), or meeting minutes (議事録). Triggers include "まとめて", "設計書にして", "決定記録を残して", "資料にして", "writeup", "/writeup", and a research/design-review/acceptance/deliberate workflow that returned a Markdown report worth keeping. Not for a single in-chat visual answer (use show-me), a beginner picture explainer (use eli5), or a grilling interview round.
---

# writeup

## Overview

writeup produces one HTML page for one of 8 kinds of durable document,
saves it into a git-backed store with history, and commits on every save.
The visual/structural contract (components, template, diagram renderer,
lint, self-check, build, publish) lives in `writeup-kit`; this file is
the procedure that drives it. Page output is Japanese; component class
names, diagram IR keys, and CLI flags/output are English.

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
minimal inline `<style>` (no shared tokens), render each figure's IR as
a `.wu-table` of nodes and edges instead of calling `render-diagram.mjs`,
and skip lint entirely (no bundled tokenizer to fall back to). Record
the degradation honestly, e.g. `checks="lint=skipped;self-check=pass;
diagram=fallback"` — never claim a normal run happened.

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
   role-named components). Read only what you need — both are short
   tables.
3. **Write the page.**
   - Copy `$KIT/kit/template.html`. Never edit `.wu-header` / `.wu-footer`
     structure (chrome) — only the text values inside it (title, kind,
     dates, lede, checks, sources).
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
     per the `budget` suggestion); exit 3 = rendered but failed a
     contract §4-2 check — fix per `checks[].hint` and re-render. Full
     detail in `references/procedure.md`.
4. **Lint.**
   ```
   node $KIT/bin/lint.mjs page.html --json
   ```
   Add `--surface-only` only for 作業メモ (contract Q33). `lint.mjs` finds
   the store's `.writeup.toml` automatically (ancestor search, then
   `$WRITEUP_STORE`) — `[private]`/`[cloudflare]` sections there are fine,
   no `--config` needed. `[[allow]]` entries need `category`, `text`, and
   `reason`. For each finding, decide fix-or-keep; findings you keep get
   their reason in the commit message (step 7), never in the page body.
5. **Self-check.**
   ```
   node $KIT/bin/self-check.mjs page.html --write-meta
   ```
   Must exit 0. `--write-meta` only patches the `self-check=` key in
   `<meta name="checks">` — set `lint=` and `diagram=N/N` yourself first
   (self-check never computes those two).
6. **Save.** Path: `<store>/<folder>/<YYYY-MM-DD>-<slug>.html`, where
   `folder` is the project or topic. New page: date is today. Revision:
   **keep the existing filename** (its date never changes) and set
   `<meta name="updated">` to today's date, or — better, since it sorts and
   displays at minute granularity — today's datetime:
   ```bash
   date +%Y-%m-%dT%H:%M%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/'
   ```
   (portable macOS/Linux: `date`'s `%z` prints a bare `+0900`; the `sed`
   inserts the colon `build.mjs`/self-check expect, `+09:00`.) A bare date
   also still works — build fills in a time-of-day from git/mtime for
   sorting, but the datetime form is more precise and skips that fallback.
7. **Build and commit.**
   ```
   node $KIT/bin/build.mjs
   git -C "$STORE" add -A && git -C "$STORE" commit -m "<kind>: <title>"
   ```
8. **Report the path.** Tell the user where the page was saved. Offer to
   publish only if asked — see "Publish" below.

## Revisions

Overwrite the same file — same filename, same `<meta name="date">` —
bump `<meta name="updated">` to today (step 6's datetime one-liner), then
repeat steps 4-7. A page whose *nature* changed (a design draft that
became a decision) is a new page of the new `kind`, not a revision.

## Searching

Read `<store>/manifest.json` and filter by `kind` / `folder` / `title` /
`description` — never grep page bodies unless the user explicitly asks
for full-text search. Return at most 3 candidates: `id`, `ref`, `updated`,
and `description`. If the user names an id directly ("id 9f3a1c2d を開いて",
"id 9f3a1c2d を直して"), resolve it via an exact match on manifest's `id`
field instead of searching — `bin/serve.mjs`'s `/id/<id>` route also
302-redirects there, for handing back a clickable link. Full procedure and
a worked example in `references/search.md`.

## Input from Markdown

`--from <md-path> --kind <kind>`: read the Markdown, map its headings,
lists, tables, code blocks, and any `A --> B` mermaid edges into `.wu-*`
components and diagram IR (noting any loss when the mermaid is richer
than the IR subset), then continue at step 3 above. Full mapping table
in `references/from-markdown.md`.

## Publish

```
node $KIT/bin/publish.mjs page.html --to artifact|cloudflare|file …
```
`--to artifact` only writes `<store>/.publish/<slug>.artifact.html` — you
then hand that file to the Artifact tool yourself (favicon `📄`; title
from the page's `<title>`), then write the returned URL into
`<meta name="published-artifact">` and commit. A private-word refusal
(exit 4) is final — tell the user which words hit, never bypass it.
`--to cloudflare` additionally requires `[cloudflare] access_verified =
true` in the store's `.writeup.toml`. Full exit codes and walkthroughs
in `references/publish.md`.

## Common Mistakes

- Restyling `.wu-header` / `.wu-footer` instead of only changing their
  text — self-check rejects chrome that diverges from the template.
- Adding a second `.wu-accent` "just for this section" — exactly one per
  page, ever.
- Skipping lint for a kind other than 作業メモ ("it's just a summary") —
  lint runs on all 8 kinds; only 作業メモ gets `--surface-only`.
- Pasting a diagram whose `render-diagram.mjs --json` returned
  `ok: false` — only exit-0 renders belong on the page.
- Forgetting to bump `<meta name="updated">` on a revision — the index
  sorts by `updated`, so a silent overwrite falls out of view.
- Publishing before self-check passes on its own — publish re-runs it
  and refuses at exit 3, but that's a backstop, not your gate.
