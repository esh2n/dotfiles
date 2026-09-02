---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
---
# Rust Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Rust-specific content.

Implemented in `packs/rust/hooks/`, registered by
`packs/rust/settings.layer.json` (only present in the merged
`~/.claude/settings.json` while the `rust` pack is enabled —
`yoki-switch pack enable rust`). Decision record: task T10 ("post-edit lint
hooks for ts/python/rust"), same owner ruling that shaped
`packs/go/hooks/go-guard-post-edit.js` and
`packs/web/hooks/web-css-lint-post-edit.js`.

## PostToolUse — `rust-fmt-post-edit.js` (profile: standard)

Runs after `Edit` / `Write` / `MultiEdit` on `.rs` files: `rustfmt <file>`
only, scoped to the edited file.

Deliberately does **not** run `cargo check` or `cargo clippy` here: both
build the crate graph (compile, run build scripts) rather than touch just
the edited file, so they belong to a session-level gate (e.g. a Stop hook),
not a per-edit one — the same file-vs-project boundary
`go-guard-post-edit.js` draws between `go vet ./` (package only) and
`go test -race` (Stop hook). `rustfmt` alone reformats a single file with
no compilation involved, so it is the only tool this hook runs.

`rustfmt` reads the nearest `rustfmt.toml` / `.rustfmt.toml` on its own by
walking up from its working directory, so this hook sets `cwd` to the
edited file's directory and does no config discovery of its own — same
reasoning as `ruff` in `py-lint-post-edit.js`.

### Latency budget and fail-open

The invocation gets a **1000ms timeout**. A timeout, `rustfmt` missing from
`PATH`, or a non-`.rs` file are all silent, exit-0, fail-open — no marker
files, no hint lines. Output is filtered to lines that mention the edited
file, capped at 10 lines, and printed to stderr with a `[rust-guard]`
prefix only when there is something to report. It never blocks the edit and
never exits non-zero.

## Disabling

- Per project: add `post:rust-guard:post-edit` to `.yoki.json`'s
  `disabledHooks`, or set `hookProfile` below `standard`.
- Machine-wide: `yoki-switch pack disable rust` removes the hook script and
  its registration entirely.

## Why this hook doesn't go through `run-with-flags.js`

Same reason as `go-guard-post-edit.js` — see
`packs/go/rules/golang/hooks.md`, "Why these hooks don't go through
run-with-flags.js". Pack-owned hooks live in `packs/<name>/hooks/` and are
merged (symlinked) into `~/.claude/hooks/` by `yoki-switch`'s `MERGE_DIRS`,
which is outside `runtime/yoki` — the directory `run-with-flags.js`'s
`CLAUDE_PLUGIN_ROOT` path-traversal guard resolves everything against. So
`run-with-flags.js` can never load a pack hook directly. Instead this hook
is registered as a direct `node ...` command in
`packs/rust/settings.layer.json` and performs its own profile gating by
requiring `runtime/yoki/scripts/lib/hook-flags.js` directly (via
`$YOKI_ROOT`, which is always set) — the exact module `run-with-flags.js`
itself uses, so gating behavior (profile precedence, `.yoki.json`,
`YOKI_DISABLED_HOOKS`) is identical either way.

## Tools

- `rustfmt`: not installed by this pack — it ships with the Rust toolchain
  (`rustup component add rustfmt`) and is resolved from `PATH`.
- `cargo check` / `cargo clippy`: intentionally not wired to any hook by
  this pack (see above) — run them by hand or from CI.
