---
paths:
  - "**/*.py"
  - "**/*.pyi"
  - "**/pyproject.toml"
---
# Python Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Python specific content.

Implemented in `packs/python/hooks/`, registered by
`packs/python/settings.layer.json` (only present in the merged
`~/.claude/settings.json` while the `python` pack is enabled —
`yoki-switch pack enable python`). Decision record: task T10 ("post-edit
lint hooks for ts/python/rust"), same owner ruling that shaped
`packs/go/hooks/go-guard-post-edit.js` and
`packs/web/hooks/web-css-lint-post-edit.js`.

## PostToolUse — `py-lint-post-edit.js` (profile: standard)

Runs after `Edit` / `Write` / `MultiEdit` on `.py` / `.pyi` files, scoped to
the edited file only:

1. `ruff format <file>` — writes the formatted file in place
2. `ruff check <file>` — lint only, no `--fix` (this hook never rewrites
   code beyond formatting)

Both are ruff's own subcommands, so `pyproject.toml` / `ruff.toml` /
`.ruff.toml` settings are respected automatically by ruff itself (it walks
up from the target file looking for them) — this hook does no config
discovery of its own, unlike `ts-lint-post-edit.js`'s multi-tool tier
selection, because there is only one tool here.

### Latency budget and fail-open

Every invocation gets a **1000ms timeout**. A timeout, `ruff` missing from
`PATH`, or a non-`.py`/`.pyi` file are all silent, exit-0, fail-open — no
marker files, no hint lines. Output (from `ruff check`) is filtered to
lines that mention the edited file, capped at 10 lines, and printed to
stderr with a `[py-guard]` prefix only when there is something to report.
It never blocks the edit and never exits non-zero.

## Disabling

- Per project: add `post:py-guard:post-edit` to `.yoki.json`'s
  `disabledHooks`, or set `hookProfile` below `standard`.
- Machine-wide: `yoki-switch pack disable python` removes the hook script
  and its registration entirely.

## Why this hook doesn't go through `run-with-flags.js`

Same reason as `go-guard-post-edit.js` — see
`packs/go/rules/golang/hooks.md`, "Why these hooks don't go through
run-with-flags.js". Pack-owned hooks live in `packs/<name>/hooks/` and are
merged (symlinked) into `~/.claude/hooks/` by `yoki-switch`'s `MERGE_DIRS`,
which is outside `runtime/yoki` — the directory `run-with-flags.js`'s
`CLAUDE_PLUGIN_ROOT` path-traversal guard resolves everything against. So
`run-with-flags.js` can never load a pack hook directly. Instead this hook
is registered as a direct `node ...` command in
`packs/python/settings.layer.json` and performs its own profile gating by
requiring `runtime/yoki/scripts/lib/hook-flags.js` directly (via
`$YOKI_ROOT`, which is always set) — the exact module `run-with-flags.js`
itself uses, so gating behavior (profile precedence, `.yoki.json`,
`YOKI_DISABLED_HOOKS`) is identical either way.

## Tools

- `ruff`: not installed by this pack — resolved from `PATH`. Install with
  `uv tool install ruff` (never `pip install`, per this profile's Python
  override) or the project's own dependency management.
