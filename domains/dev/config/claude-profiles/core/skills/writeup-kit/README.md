# writeup-kit

The shared design kit behind the `writeup`, `show-me`, `eli5` and `grilling`
skills: CSS tokens, 20 role-named page components, a page template, a diagram
IR contract with 29 figure types, a Japanese prose linter, and a structural
self-check. Skills read it; users do not invoke it directly.

Pages are HTML, saved into a **store** — a git repository holding the pages,
a generated `index.html` and `manifest.json`, and a synced copy of the kit's
CSS under `_kit/`.

## Requirements

Node.js ≥ 20 (verified on v22.20.0). That is the whole list. There is no
`npm install`, no lockfile, no network access, and no other toolchain: the two
native-ish dependencies are vendored under `vendor/` — `elk` (graph layout,
1.5 MB) and `lindera` (Japanese tokenizer WASM + IPADIC dictionary, 17 MB).
They are loaded by relative path from `bin/`, so a plain `cp -R` is a complete
install.

Sizes: `writeup-kit` 22 MB, of which `vendor/` is 19 MB and everything else
3.8 MB; `writeup` 100 KB; `show-me` 24 KB.

## Install

Copy the three skill directories into `~/.claude/skills/`:

```bash
cp -R writeup-kit writeup show-me ~/.claude/skills/
```

Skills resolve the kit as a sibling directory first, then
`~/.claude/skills/writeup-kit` — both layouts work. With the kit in neither
place, tools that need it say so and name both paths they checked.

Verify the copy:

```bash
cd ~/.claude/skills/writeup-kit && node --test   # 1740 tests
cd ~/.claude/skills/writeup     && node --test   #   15 tests
```

## Stores and the registry

A store is created by the `writeup` skill's `init-store.mjs`, which makes the
directory, runs `git init`, writes `.writeup.toml` (private-word list, lint
config, publish config), creates `_kit/ public/ legacy/ .publish/`, and builds
the empty index. It is idempotent.

```bash
node ~/.claude/skills/writeup/scripts/init-store.mjs --name work    --description 仕事
node ~/.claude/skills/writeup/scripts/init-store.mjs --name private --description 個人 --default
```

Each named store is its own git repository, so work pages and personal pages
never share a history.

The **registry** is `~/.local/share/writeup/stores.toml` (override with
`$WRITEUP_STORES`). It holds only a `default` and, per store, a `name`, a
`path` and a one-line `description` — never a directory-to-store mapping:

```toml
default = "private"

[[store]]
name = "work"
path = "work"          # relative to the registry dir, absolute, or ~/...
description = "仕事"
```

Paths are written back relative to the registry directory or `~`-rooted, so
the file survives being carried to another machine.

Every CLI resolves its store in this order: `--store <dir>`, then
`--store-name <name>` (registry lookup), then `$WRITEUP_STORE`, then a
`.writeup.toml` at or above the current directory, then `<repo root>/.writeup`
(a marker naming a store, written by `init-store.mjs --marker <name>`), then
the registry `default`, then `~/.local/share/writeup`. `node bin/serve.mjs
--list-stores` prints the registry and marks the store the current directory
resolves to.

## CLIs (`bin/`)

| Command | What it does |
|---|---|
| `render-diagram.mjs <ir.yaml> --figure` | Renders a figure IR to a `<figure>` with inline SVG. `--list-types` lists all 29 types with their budgets; `--doc <type>` prints an example IR; `--json` returns the same result as data. Exit 2 = invalid IR, exit 3 = a failed geometry check. |
| `lint.mjs <page.html> --json` | Japanese prose gate — sentence length, rhythm, lexical diversity, n-gram repetition, specificity. Finds `.writeup.toml` by ancestor search. `--surface-only` for the lightest pass. |
| `self-check.mjs <page.html>` | Structural gate: required `<meta>`, header/footer chrome matching `kit/template.html`, component shape per kind, `data-checks="pass"` on every figure. `--write-meta` patches the `self-check=` key. |
| `build.mjs --store <dir>` | Regenerates the store's `manifest.json` and `index.html` from each page's `<head>`, syncs `kit/writeup.css` into `_kit/`, and fixes each page's `.wu-nav` link and status favicon. |
| `serve.mjs [--store <dir>]` | Static server on 127.0.0.1 for one store, or for every registered store on one port. Builds first unless `--no-build`. |
| `publish.mjs <page.html> --to artifact\|cloudflare\|file` | Stages a page for an external audience, re-running self-check and a private-word scan first. |
| `to-md.mjs <page.html>` | Converts a page to Markdown; `--figures-dir` writes each figure's SVG out and adds a mermaid block for node/edge diagrams. |
| `pr-pack.mjs <page.html> --out <dir>` | Packs a page for a GitHub pull request: staged `index.html` + `<slug>.md` + `figures/*.svg`, optional `--pdf`; re-runs self-check and a private-word scan first (exit 4 on a hit; pass `--internal` for a private company repo where that check would only false-positive). `--repo/--sha/--path --body-out` turns a committed pack into a PR body of SHA-pinned blob URLs. |
| `rerender-figures.mjs --store <dir>` | Re-renders every stored figure whose IR is still embedded, reporting fixed / warned / still-failing counts. |
| `contrast.mjs` | Audits `kit/writeup.css` tokens for WCAG contrast in both themes. |
| `migrate-explain-pages.mjs --src <dir> --dest <store>` | One-off importer for the old explain-pages Markdown format. |

## First page in five commands

Assuming a store at `$STORE` and the kit at `$KIT`:

```bash
node $KIT/bin/render-diagram.mjs fig.yaml --figure > fig.html   # 1. draw
node $KIT/bin/lint.mjs  $STORE/notes/2026-08-29-title.html --json  # 2. prose gate
node $KIT/bin/self-check.mjs $STORE/notes/2026-08-29-title.html --write-meta  # 3. structure gate
node $KIT/bin/build.mjs --store "$STORE"                        # 4. index + CSS
node $KIT/bin/serve.mjs --store "$STORE"                        # 5. read it
```

Between 1 and 2 you write the page itself: copy `kit/template.html`, point its
stylesheet at `../_kit/writeup.css` (the template ships with `./writeup.css`,
correct only inside `kit/`; step 4's `build` repairs it either way), fill in
the `<head>` meta and the header text, paste the `<figure>` from step 1
unmodified, and write the body from the components in `kit/samples.html`.
Save it as `$STORE/<folder>/<YYYY-MM-DD>-<slug>.html`, then commit in `$STORE`.

## References

`references/kinds.md` (the 8 document kinds and their required sections),
`references/components.md` (the 20 components), `references/figure-types.md`,
`references/writing.md`, `references/tokens.md`, `references/page-contract.md`.
