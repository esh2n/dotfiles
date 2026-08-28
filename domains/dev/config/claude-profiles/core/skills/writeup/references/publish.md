# Publish

```
node $KIT/bin/publish.mjs <page.html> --to artifact|cloudflare|file [--out <path>] [--store <dir> | --store-name <name>] [--dry-run] [--deploy]
```

Without `--store`/`--store-name`, the store is the page's own (the
nearest ancestor `.writeup.toml`), then `$WRITEUP_STORE`, then the
registry in `~/.local/share/writeup/stores.toml` (cwd prefix match, then
`default`), then the legacy `~/.local/share/writeup` — so a page in the
`work` store is always checked against `work`'s own `[private] words`.
`--store-name work|learn` picks a registered store by name. Use `--dry-run` first when you're unsure
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
3. **Private-word check** — see below.
4. Size check: the fully-staged (CSS-inlined) page must be ≤ 16MB.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (or a completed `--dry-run` report) |
| 2 | Usage error — missing `<page.html>` or `--to`, or an unknown `--to` value |
| 3 | self-check failed; publish refused |
| 4 | A private word was found on the page; publish refused |
| 5 | `--to cloudflare` and Cloudflare Access is not verified |
| 6 | Staged page exceeds the 16MB Artifact limit |

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

## Targets

### `artifact`

```
$ node $KIT/bin/publish.mjs page.html --to artifact
publish: wrote /path/to/store/.publish/2026-08-14-example.artifact.html
```

The CLI's job stops at writing that single self-contained HTML file —
publish.mjs never calls the Artifact tool itself. After it returns:

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
