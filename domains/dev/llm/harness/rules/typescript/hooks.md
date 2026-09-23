---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mts"
  - "**/*.cts"
  - "**/package.json"
  - "**/tsconfig*.json"
---
# TypeScript/JavaScript Hooks

> This file extends [common/hooks.md](../common/hooks.md) with TypeScript/JavaScript specific content.

Implemented in `packs/typescript/hooks/`, registered by
`packs/typescript/settings.layer.json` (only present in the merged
`~/.claude/settings.json` while the `typescript` pack is enabled —
`yoki-switch pack enable typescript`). Decision record: task T10 ("post-edit
lint hooks for ts/python/rust"), same owner ruling that shaped
`packs/go/hooks/go-guard-post-edit.js` and
`packs/web/hooks/web-css-lint-post-edit.js`.

## PostToolUse — `ts-lint-post-edit.js` (profile: standard)

Runs after `Edit` / `Write` / `MultiEdit` on `.ts` / `.tsx` / `.js` / `.jsx`
/ `.mts` / `.cts` files, scoped to the edited file only. Tool selection
follows the project's own configuration, most specific first:

1. `biome.json` / `biome.jsonc` / `.biomerc` found (walked up from the
   file) -> `biome check --write <file>`. If the binary is missing, this
   fails open — no fallback to a tool the project didn't ask for.
2. Else an eslint and/or prettier config found -> that project's own
   tool(s): `prettier --write <file>` then `eslint --fix <file>`, whichever
   is configured (both run if both are).
3. Else (no config at all) but a `biome` binary resolves (project's own
   `node_modules/.bin/biome`, else `PATH`) -> `biome check --write <file>`
   anyway — biome ships usable defaults with no config file.
4. Else if an `oxlint` binary resolves -> `oxlint <file>`, lint only (no
   safe default write behavior to lean on here).
5. Else nothing runs.

Binary resolution prefers the project's own `node_modules/.bin/<tool>`
(walked up from the config directory) over a bare name on `PATH`, same
technique as `web-css-lint-post-edit.js`. Both walks — config discovery and
binary resolution — stop at the nearest `.git` (after checking that
directory itself), so an unrelated checkout higher in the tree can never
supply the config or the binary.

### Latency budget and fail-open

Every tool invocation gets a **1000ms timeout**. A timeout, a missing
binary, or a non-matching file are all silent, exit-0, fail-open — no
marker files, no hint lines (deliberately simpler than go-guard's /
web-guard's one-time hints: this hook only ever prints when a tool actually
ran and produced output that mentions the edited file). Output is filtered
to lines that mention the edited file, capped at 10 lines, and printed to
stderr with a `[ts-guard]` prefix only when there is something to report.
It never blocks the edit and never exits non-zero.

## Disabling

- Per project: add `post:ts-guard:post-edit` to `.yoki.json`'s
  `disabledHooks`, or set `hookProfile` below `standard`.
- Machine-wide: `yoki-switch pack disable typescript` removes the hook
  script and its registration entirely.

## Why this hook doesn't go through `run-with-flags.js`

Same reason as `go-guard-post-edit.js` — see
`packs/go/rules/golang/hooks.md`, "Why these hooks don't go through
run-with-flags.js". Pack-owned hooks live in `packs/<name>/hooks/` and are
merged (symlinked) into `~/.claude/hooks/` by `yoki-switch`'s `MERGE_DIRS`,
which is outside `runtime/yoki` — the directory `run-with-flags.js`'s
`CLAUDE_PLUGIN_ROOT` path-traversal guard resolves everything against. So
`run-with-flags.js` can never load a pack hook directly. Instead this hook
is registered as a direct `node ...` command in
`packs/typescript/settings.layer.json` and performs its own profile gating
by requiring `runtime/yoki/scripts/lib/hook-flags.js` directly (via
`$YOKI_ROOT`, which is always set) — the exact module `run-with-flags.js`
itself uses, so gating behavior (profile precedence, `.yoki.json`,
`YOKI_DISABLED_HOOKS`) is identical either way.

## Tools

- `biome`, `eslint`, `prettier`, `oxlint`: not installed by this pack —
  each is resolved from the project's own `node_modules` (or `PATH`)
  precisely because the config that governs it is project-owned, not
  machine-owned. Nothing is installed globally on their behalf.
