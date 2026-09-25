# writeup-kit

The shared design kit behind the `writeup`, `show-me`, `eli5` and `grilling`
skills: CSS tokens, 20 role-named page components, a page template, a diagram
IR contract with 29 figure types, a Japanese prose linter, and a structural
self-check. Skills read it; users do not invoke it directly.

This directory (`$DOTFILES_ROOT/harness/tools/writeup-kit/`) holds the
kit's executable and vendored parts — `bin/`, `vendor/`, `kit/`, `test/`. The
skill that describes it (`SKILL.md`, `references/`) stays at
`$DOTFILES_ROOT/harness/skills/writeup-kit/`; the skills that
drive it (`writeup`, `show-me`, `eli5`, `grilling`) resolve it as
`KIT="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/writeup-kit"`.

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

Nothing to install: the kit is used in place from the dotfiles checkout, and
the skills that drive it are linked into `~/.claude/skills/` by `jig apply`.
Every skill resolves the kit at
`${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/writeup-kit`; with the
kit absent there, tools that need it say so and name the path they checked.

Verify the checkout:

```bash
KIT="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/writeup-kit"
cd "$KIT" && node --test                                              # 1867 tests
cd "${DOTFILES_ROOT:-$HOME/dotfiles}/harness/skills/writeup" && node --test   #   15 tests
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
| `publish.mjs <page.html> --to artifact\|cloudflare\|file\|github` | Stages a page for an external audience, re-running self-check and a private-word scan first (`--internal` skips the scan, for a private company repo whose readers are its own members). `artifact`/`cloudflare`/`file` write one staged file; `github` instead writes a folder — `<slug>.md` (figures linked as `figures/<name>.svg`), `figures/*.svg` (each restyled standalone), `<slug>.html` (the staged document), and `<slug>.pdf` with `--pdf` — meant for `gh pr create\|comment --body-file <slug>.md --attach figures/...`, never a repo commit. |
| `to-md.mjs <page.html>` | Converts a page to Markdown; `--figures-dir` writes each figure's SVG out and adds a mermaid block for node/edge diagrams. |
| `rerender-figures.mjs --store <dir>` | Re-renders every stored figure whose IR is still embedded, reporting fixed / warned / still-failing counts. |
| `contrast.mjs` | Audits `kit/writeup.css` tokens for WCAG contrast in both themes. |
| `migrate-explain-pages.mjs --src <dir> --dest <store>` | One-off importer for the old explain-pages Markdown format. |

Each CLI's entry guard resolves realpaths on both sides (`bin/lib/main.mjs`'s
`isMain`) rather than comparing `process.argv[1]` to `import.meta.url`
directly — `$DOTFILES_ROOT` is commonly a symlink, so the kit is reached
through one, and a raw string comparison never matches through it.

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

Under `$DOTFILES_ROOT/harness/skills/writeup-kit/references/`:
`kinds.md` (the 8 document kinds and their required sections),
`components.md` (the 20 components), `figure-types.md`, `writing.md`,
`tokens.md`, `page-contract.md`.
