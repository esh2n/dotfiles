# Publish

The store page links `../_kit/writeup.css` (and, for a `.wu-shot`, its
`<slug>-assets/` files) — both exist only inside the store, so a copy of
the page handed anywhere else (the Artifact tool, Slack, email, a PR)
renders unstyled and without pictures. The only HTML that ever leaves the
store is `publish.mjs` output.

```
node $KIT/bin/publish.mjs <page.html> --to artifact|cloudflare|file|github [--out <path>] [--store <dir> | --store-name <name>] [--dry-run] [--deploy] [--pdf] [--internal]
```

Without `--store`/`--store-name`, the store is the page's own (the
nearest ancestor `.writeup.toml`), then `$WRITEUP_STORE`, then the
registry in `~/.local/share/writeup/stores.toml` (cwd prefix match, then
`default`), then the legacy `~/.local/share/writeup` — so a page in the
`work` store is always checked against `work`'s own `[private] words`.
`--store-name work|private` picks a registered store by name. Use `--dry-run` first when you're unsure
what a publish will do — it runs the full pre-stage and reports the
planned output path (and, for `cloudflare`, the `wrangler` command)
without writing or deploying anything.

## Pre-stage (runs for every target, in this order)

1. `self-check` must pass — publish re-runs it internally and refuses if
   it fails. Don't rely on this as your only gate; run
   `self-check.mjs --write-meta` yourself first (`SKILL.md` step 5).
2. The kit CSS `<link>` is replaced with an inlined `<style>`; the Google
   Fonts `<link>` is left as-is (that's the one external reference an
   Artifact page is allowed to keep).
3. Every `.wu-shot` image is inlined as a `data:` URI, so the staged page
   stays one file even when the page carries a screenshot.
4. **Private-word check** — see below.
5. Size check: the fully-staged (CSS-inlined, images-inlined) page must be
   ≤ 16MB.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (or a completed `--dry-run` report) |
| 2 | Usage error — missing `<page.html>` or `--to`, an unknown `--to` value, or (`--to artifact` only) the page's `<head>…</head>`/`<body>…</body>` skeleton could not be located to build the Artifact fragment — a bug, not an authoring mistake; every self-check-passing page has both |
| 3 | self-check failed; publish refused |
| 4 | A private word was found on the page; publish refused |
| 5 | `--to cloudflare` and Cloudflare Access is not verified |
| 6 | Staged page exceeds the 16MB Artifact limit |
| 7 | A `.wu-diffview` on the page carries a diff that could not be parsed; publish refused (fix the diff inside its script, or drop the figure) |
| 8 | The `_kit/writeup.css` `<link>` was still present after CSS inlining — a bug, not an authoring mistake; report it rather than retrying |

## Private-word check (exit 4)

Reads `<store>/.writeup.toml`'s `[private].words` — a list of strings,
one store/person/org's own internal domains, product names, and
abbreviations, **never shipped inside the kit**. The check is a
case-insensitive substring match against the page's `<title>`, every
head `<meta>` value, and the full text content of `<main>`. One hit is
enough to refuse:

```
$ node $KIT/bin/publish.mjs page.html --to artifact
publish: publish refused: private words found on the page
acmecorp, project-phoenix
$ echo $?
4
```

This refusal is final for this run. Tell the user exactly which words
matched (as printed) and ask them to rewrite the passage — never edit
around the checker (e.g. splitting a word with a zero-width character,
using an image of the text, or passing `--to file` instead to dodge the
check does not make the content any less private and defeats the point
of the gate). If the word is a false positive (a common Japanese word
that happens to collide with an entry in `[private].words`), say so and
ask the user whether to remove it from the store's word list — do not
silently strip it from the page instead.

`--internal` skips this check entirely, for every target — pass it only
for a private company repo whose PR readers are the repo's own members
and internal names are expected on the page; that is the one case where
the check would only ever produce false positives. It exists mainly for
`--to github`, where the audience is a specific repo's own PR, but nothing
stops it being passed to another target for the same reason.

## Targets

### `artifact`

```
$ node $KIT/bin/publish.mjs page.html --to artifact
publish: wrote /path/to/store/.publish/2026-08-14-example.artifact.html
```

The CLI's job stops at writing that file — publish.mjs never calls the
Artifact tool itself. **The `.artifact.html` file is a fragment shaped for
the Artifact tool, not a full document**: `toArtifactFragment` strips
`<!DOCTYPE>`/`<html>`/`<head>`/`<body>` and the charset/viewport `<meta>`s
before writing it, because the Artifact tool wraps whatever it's given in
its own `<!doctype html>…<head>…</head><body>` skeleton (plus those two
metas) — handing it a full document would double them up. Hand the file
over exactly as written; do not strip anything from it yourself. After
`publish.mjs` returns:

1. Read the written `.publish/<slug>.artifact.html` file.
2. Call the Artifact tool with that file as `file_path`, `favicon: "📄"`
   for every writeup page (keep this favicon stable across all writeup
   artifacts — it's how the user tells writeup pages apart from other
   artifacts in their gallery), and a `title` taken from the page's
   `<title>` if the tool doesn't pick it up from the file's own `<title>`
   tag automatically.
3. Take the URL the Artifact tool returns and write it into the *source*
   page (the one in `<store>/<folder>/...html`, not the `.publish/` copy)
   as `<meta name="published-artifact" content="<url>">`, inserted next
   to the other meta tags.
4. `git -C "$STORE" add -A && git -C "$STORE" commit -m "publish: <title> to artifact"`.

### `cloudflare`

```
$ node $KIT/bin/publish.mjs page.html --to cloudflare --dry-run
publish --dry-run: target=cloudflare bytes=12345
  output: /path/to/store/public/folder/2026-08-14-example.html
  command: wrangler pages deploy public --project-name example-writeup (not run; pass --deploy)
```

Requires `[cloudflare] access_verified = true` in the store's
`.writeup.toml` — if it's `false` or missing, publish refuses at exit 5
regardless of `--dry-run`. Without `--deploy`, the file is written to
`store/public/<same relative path>` but `wrangler` is never invoked —
useful to stage the file and let a human run the deploy. With `--deploy`,
it runs `wrangler pages deploy public --project-name <project>` against
`public/` only (never the whole store) if `wrangler` is on `PATH`;
otherwise it reports `deploySkippedReason: "wrangler not found on PATH"`
and leaves the staged file in place. Confirm `<meta name="robots"
content="noindex">` is still present on the page before deploying —
publish does not remove or check it for you beyond what self-check
already verified.

### `file`

```
$ node $KIT/bin/publish.mjs page.html --to file --out /tmp/for-slack.html
publish: wrote /tmp/for-slack.html
```

Use this when the destination is a Slack attachment or an email, not a
hosted URL. `--out` is required; omitting it is a usage error (exit 2).

### `github` (private-repo safe, no repo write)

A GitHub pull request is not a hosted URL and there is no external host to
hand a file to — but there is also no reason to write into the repository
either: `gh` (the next release after 2.98.0, or trunk today — GHES is not
supported) can attach files straight to a PR body or comment with `--attach
<file>`, uploading each to GitHub's own attachment store and rewriting any
`![alt](figures/x.svg)` reference in the uploaded Markdown to the uploaded
URL. `--to github` writes exactly the folder that flow needs — Markdown
plus standalone SVG figures — and stops there. It never commits anything,
computes no SHA, opens no branch, and never calls `gh` itself.

```
$ node $KIT/bin/publish.mjs page.html --to github --out /tmp/pack [--pdf] [--internal]
publish: wrote /tmp/pack
  gh pr create --body-file /tmp/pack/page.md --attach /tmp/pack/figures/page-fig1.svg (or gh pr comment)
```

Without `--out`, it defaults to `<store>/.publish/<slug>.github/`. Runs
the same pre-stage as every other target, in the same order (render →
self-check → inline kit CSS → inline `.wu-shot` images → drop the back
nav → **private-word check**, exit 4 on a hit unless `--internal` → size),
then writes:

- **`<slug>.md`** — to-md's Markdown conversion, with every `.wu-figure`
  linked as `figures/<name>.svg` — the exact relative path shape `gh
  --attach` rewrites — and every `.wu-shot` linked as `figures/<file>` the
  same way. The YAML frontmatter block to-md would normally emit is
  stripped (GitHub would render it as a raw `---` fence, not metadata);
  the `# title` line right after it stays.
- **`figures/*.svg`** — one file per `.wu-figure`, each rewritten through
  `standalone-svg.mjs` so it carries its own light-theme background and
  tokens with no page CSS around it (see below), plus each `.wu-shot`'s
  image file copied in as-is (already a raster, nothing to restyle).
- **`<slug>.html`** — the same fully staged, self-contained document every
  other target produces (kit CSS inlined, `.wu-shot` images inlined, back
  nav dropped). Useful on its own as the 原本 — a human can attach it too,
  or just keep it, even though nothing in this target ever uploads it
  anywhere automatically.
- **`<slug>.pdf`**, only with `--pdf` — rendered from that same
  `<slug>.html` via a headless Chromium, if `playwright-core` resolves
  (`await import('playwright-core')`, or the module path in
  `$WRITEUP_PLAYWRIGHT_CORE`); if neither resolves, publish prints `pdf
  skipped: playwright-core not found` and still exits 0 — a folder without
  a PDF is still useful. **A PDF can only be attached to a PR *comment*,
  not the description** (GitHub's description editor does not accept a
  raw file upload the way a comment does), and even there it is a
  clickable attachment, not rendered inline — mention it in the body as a
  manual "see the attached PDF" pointer rather than expecting it to
  display.

`--dry-run` reports the plan — the folder path and the file list it would
write — without writing anything.

Once the folder exists, a human (or a follow-up tool call) runs:

```
gh pr create --body-file /tmp/pack/page.md --attach /tmp/pack/figures/page-fig1.svg --attach /tmp/pack/figures/page-fig2.svg
# or, on an existing PR:
gh pr comment <number> --body-file /tmp/pack/page.md --attach /tmp/pack/figures/page-fig1.svg
# or --attach /tmp/pack/page.pdf on a comment, for the PDF
```

`--attach` accepts each figure individually; build the list from the
files actually in `figures/` (publish's own printed hint already does
this for you). On GHES, or with an older `gh`, there is no `--attach` at
all — drag-and-drop the same `figures/*.svg` files into the PR
description or comment editor by hand instead; GitHub still rewrites the
Markdown references the same way.

**What survives into the PR body's Markdown**: alerts (`> [!NOTE]` etc.),
tables, ```` ```diff ```` fences, and code blocks — GitHub renders all of
these natively. **What only the SVG figures (and the optional PDF) keep**:
the kit's own styling and type scale, diff view line numbers and hunk
chrome, and the side table of contents — none of that survives
HTML→Markdown text, which is exactly why each figure ships as its own
standalone image instead of being redrawn as a mermaid block (mermaid is
not used anywhere in this kit).

**Figures are opaque light cards, deliberately**: `standalone-svg.mjs`
inlines the kit's light-theme tokens plus an opaque `var(--wu-surface)`
background into each figure SVG, so it reads as a light card on GitHub's
theme too — `prefers-color-scheme` inside an `<img>` follows the *viewer's
OS*, not GitHub's own light/dark toggle, so there is no single dark-aware
variant that would track GitHub's theme; one opaque light card is the
robust choice.

**Tokens**: `gh --attach` uploads as the account `gh` is authenticated
as — either OAuth (`gh auth login`) or a fine-grained PAT with write
access to the repository (attachments are a write, same as posting the PR
or comment itself). No token or scope is specific to this feature beyond
that.
