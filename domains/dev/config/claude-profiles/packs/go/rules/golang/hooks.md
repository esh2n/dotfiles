---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---
# Go Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Go specific content.

Implemented in `packs/go/hooks/`, registered by `packs/go/settings.layer.json`
(only present in the merged `~/.claude/settings.json` while the `go` pack is
enabled — `yoki-switch pack enable go`). Decision record:
`packs/go/docs/plans/2026-08-26-go-perf-concurrency-agents.md` ("決定的ツール
と LLM の境界").

## PostToolUse — `go-guard-post-edit.js` (profile: standard)

Runs after `Edit` / `Write` / `MultiEdit` on `*.go` files:

1. `go vet ./` scoped to the edited file's package directory only (15s timeout)
2. `staticcheck ./` in the same directory, only if `staticcheck` is on PATH (20s timeout)

Output is filtered to lines that mention the edited file, capped at 10 lines,
and printed to stderr with a `[go-guard]` prefix — **only when there is
something to report** (0 findings = 0 extra tokens). It never blocks the edit
and never exits non-zero.

If `go` itself is missing from PATH: one warning line, at most once (tracked
via a marker file in `os.tmpdir()`), then silent on later edits.

It also records the touched package directory to a per-session marker file
that the Stop hook below consumes.

## Stop — `go-guard-race.js` (profile: strict only)

At session Stop, reads the marker file `go-guard-post-edit.js` wrote this
session, and for each distinct package directory touched runs
`go test -race -count=1 ./...` (120s total budget, split across the touched
packages). Prints at most the first 10 lines of failures to stderr with a
`[go-guard -race]` prefix, then clears the marker. Always exits 0 — this
only reports, it never blocks Stop. Silent (no exec at all) if nothing was
touched, if `go` is missing, or outside the `strict` profile.

## SessionStart — `go-version-check.js` (profile: minimal — always runs)

Checks whether the last Go-version check was more than 7 days ago; if so,
fetches `https://go.dev/dl/?mode=json` once and prints a single line if a
newer Go release exists. Does not call `go-version-scout` itself — that
agent is invoked by a person after seeing the notice.

## Disabling

- Per project: add the hook id to `.yoki.json`'s `disabledHooks`
  (`post:go-guard:post-edit`, `stop:go-guard:race`) or set `hookProfile`
  below `standard` / `strict`.
- Machine-wide: `yoki-switch pack disable go` removes the hook scripts and
  their registration entirely (nothing Go-specific is registered on a
  machine that doesn't have the `go` pack enabled).

## Why these hooks don't go through `run-with-flags.js`

Every other yoki hook is invoked via
`runtime/yoki/scripts/hooks/run-with-flags.js "<hookId>" "<relScriptPath>" "<profilesCsv>"`,
which does the profile-gating and then `require()`s the script. That runner
resolves `relScriptPath` against `CLAUDE_PLUGIN_ROOT`, which is hard-set to
the `runtime/yoki` checkout by `core/settings.layer.json`'s global `env`
block for every hook invocation on this machine, and it rejects (as path
traversal) any resolved path outside that directory — verified empirically,
`path.resolve(pluginRoot, rel)` never lands inside `packs/go/hooks/` no
matter how `rel` is written, and an absolute path is rejected the same way.

`packs/go/hooks/*.js` are merged (symlinked) into `~/.claude/hooks/` by
`yoki-switch`'s `MERGE_DIRS`, which is a different location than
`runtime/yoki` — so `run-with-flags.js` can never load them. Instead these
hooks are registered as direct `node ...` commands (same pattern
`personal/hooks/*.sh` already uses for `~/.claude/hooks/git-guard.sh`
etc.) and do their own profile gating by requiring
`runtime/yoki/scripts/lib/hook-flags.js` directly (via `$YOKI_ROOT`, which
is always set) — the exact module `run-with-flags.js` itself uses, so gating
behavior (profile precedence, `.yoki.json`, `YOKI_DISABLED_HOOKS`) is
identical either way.

## Tools

- `staticcheck`, `golangci-lint`, `govulncheck`: installed via
  `domains/dev/packages/homebrew.nix` (Nix-managed — never `brew install`
  directly)
- `benchstat` and (pre-1.26) `modernize`: not installed; invoked with
  `go run <pkg>@latest` by `go-optimize` / `go-reviewer` when needed
