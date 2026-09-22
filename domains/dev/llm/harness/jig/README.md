# jig

Local-first agent harness — guards, automation, orchestration, and multi-tool
config composition. The rebuild of yoki: same responsibilities, clean layering.

Runtime **Bun**, language **TypeScript** (strict). Dependencies point inward
(Clean / Hexagonal). The core never imports infrastructure.

## Layers

```
src/
  domain/   pure logic + ports (interfaces). Zero IO. The core.
    hooks/    guard decisions (allow/deny/ask)
    ports.ts  the interfaces the core needs (Logger/Clock/FileSystem/ProcessRunner)
  app/      use-cases. Depend only on domain + ports.
    hooks/    run-hook
  infra/    adapters implementing ports. The only place with IO / externals.
    logger/ clock/ fs/ proc/
  cli/      entrypoints = composition root. Wire concrete adapters into use-cases.
    jig.ts    the CLI
    hooks/    hook entrypoints (stdin JSON -> stdout JSON)
test/       mirrors src/. Domain/app tested with in-memory fakes of the ports.
```

Not yet ported (placeholders will land as the migration proceeds):
`domain/graph` + `app/graph`, `app/loop`, `infra/secrets`, `infra/model`,
`infra/state`. The config generator that replaces yoki-switch is partly
landed — see [The generator](#the-generator-jig-apply--retiring-yoki-switch).

## Develop

```sh
bun install
bun test          # unit tests (Bun's built-in runner)
bun run typecheck # tsc --noEmit (strict)
bun run lint      # biome
bun run src/cli/jig.ts version
```

## Placement

Lives at `domains/dev/llm/harness/jig/` in the dotfiles monorepo, replacing the
old `claude-profiles/runtime/yoki`. The composed content (skills/rules/packs/
personal) stays alongside under `llm/harness/` and jig composes it — it is not
vendored inside jig.

## The generator (`jig apply`) — retiring `yoki-switch`

`domains/dev/bin/yoki-switch` (1039 lines of bash) writes five harnesses'
configuration today. `jig apply` replaces it target by target. The sources are
the flat tree named by
[`rules/decisions/2026-09-22-config-layout-no-personal-layer.md`](../rules/decisions/2026-09-22-config-layout-no-personal-layer.md)
— `rules/ skills/ agents/ hooks/ mcp/ policy/` under `llm/harness/`, with no
`core`/`packs`/`personal` layers and no pack switch.

### The invariant

**The generator reads sources only. Output-side reads are for preservation
only.** A destination file is read for exactly two purposes: to carry through
keys jig does not own, and to report what an apply would remove. No managed
value and no diagnostic is ever derived from what was read there — the
dependency runs one way, sources → output. Reconciling a setting that exists in
two places (an MCP server registered both in `settings.json` and in
`~/.claude.json`, say) is a one-time manual migration step, not a generator
feature; the decision above records the day that dependency nearly got
inverted.

`~/.claude.json` is never touched at all.

### Milestones

| # | Scope | Status |
|---|---|---|
| 1 | Claude Code's `~/.claude/settings.json`: `hooks`, `permissions.{allow,deny,defaultMode}`, `sandbox`, `mcpServers`, and the removal of `YOKI_*` from `env` | **done** |
| 2 | The sources move: `skills/`, `rules/` and `agents/` into `llm/harness/`, and jig delivers `~/.claude/{skills,rules,agents}` and the generated `AGENTS.md` (with `CLAUDE.md` → `AGENTS.md`) | next |
| 3 | The other targets: Codex (`config.toml` + `hooks.json`), pi, omp, DSH | |
| 4 | `yoki-switch` retired, along with `core/config/manager.sh`'s `link_*` functions for the harnesses | |

### What each milestone replaces in `yoki-switch`

Rows cite the destination table in
[`rules/research/2026-09-22-generator-migration-map.md`](../rules/research/2026-09-22-generator-migration-map.md)
§1a.

| yoki-switch mechanism (map §1a) | Replaced by | Milestone |
|---|---|---|
| `merge_settings()` (yoki-switch:200-327) — `jq -s` over `core/settings.layer.json` × packs × `personal/settings.personal.json` | `app/apply/apply-claude.ts` + `domain/claude/settings.ts`: no layers, six managed keys, everything else preserved | 1 |
| the `hooks` array concatenation of §1e (personal → packs → core, 33 entries over 7 events) | `domain/claude/hooks.ts`: five events, one hook each, generated from jig's own subcommands | 1 |
| `permissions.yaml` layers → `lib/permissions/to-claude.js` (§1c) | `domain/policy/to-claude-permissions.ts` over `policy/guard-rules.json`, plus `domain/claude/permits.ts` | 1 |
| `mcp.json` layers → `lib/mcp-inventory/writers/claude.js` (§1d) | `mcp/servers.json` → `domain/mcp/to-claude.ts` | 1 |
| `.autoMode` carry-over (yoki-switch:317-326) | generalized: every unmanaged key is preserved, not just the one | 1 |
| `~/.claude/.yoki/permissions.json` (hook-enforced deny set) | nothing — the guard reads `policy/guard-rules.json` directly | 1 |
| `merge_claude_md()` (yoki-switch:332-346) — `CLAUDE.layer.md` + `CLAUDE.personal.md` | generated `AGENTS.md` from `rules/`; the decision-line and research-index parts already render (`domain/claude/agents-md.ts`) and appear in milestone 1's dry-run as a **preview only** | 2 |
| `merge_dir()` (yoki-switch:352-390) — the `.{dir}-merged` staging dirs behind `skills`/`hooks`/`commands`/`agents`/`rules`/`workflows`/`scripts` | one flat source tree, delivered by symlink; no `commands/` at all ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)) | 2 |
| `link_external_resources()` (yoki-switch:411-452) and `external-links.yaml` | folded into the flat tree | 2 |
| `.claude-packs` / `packs.default` / `pack enable\|disable` | gone — rules are selected by `paths:` frontmatter, skills by the judgment service | 2 |
| `apply_target_generator()` (yoki-switch:670-706) → `targets/gen.js` for codex and omp | per-target modules under `app/apply/` | 3 |
| `core/config/manager.sh`'s `link_pi_resources` / `link_dsh_resources` / `link_omp_resources` | per-target modules under `app/apply/` | 3 |

### Milestone 1: what `jig apply --target claude` does

```sh
bun src/cli/jig.ts apply --target claude            # dry-run: prints the diff and the reports
bun src/cli/jig.ts apply --target claude --write    # writes, atomically, after a hand-edit check
```

Dry-run is the default and `--target all` never includes `claude`: that target
writes into `$HOME` rather than into this checkout, so it has to be named.

Owned, from sources:

- `hooks` — the five of
  [`2026-09-22-hooks-five-events.md`](../rules/decisions/2026-09-22-hooks-five-events.md),
  each an absolute bun path plus an absolute path to `src/cli/jig.ts`.
- `permissions.allow` / `permissions.deny` — projected from
  `policy/guard-rules.json` by `domain/policy/to-claude-permissions.ts`, plus
  the default permits of
  [`2026-09-22-allow-from-guard-permit.md`](../rules/decisions/2026-09-22-allow-from-guard-permit.md).
  Rules with no native form are listed as `hookOnly` in the dry-run — the hook
  is their enforcement, and a `PreToolUse` deny holds in every permission mode.
- `permissions.defaultMode` — `auto`.
- `sandbox` — host mode, per
  [`2026-09-22-box-shape.md`](../rules/decisions/2026-09-22-box-shape.md): the
  same block `app/box/kit.ts` writes inside a box, minus the box's network
  allowlist. `enabled`, `failIfUnavailable` and `allowUnsandboxedCommands` are
  fixed in code; `excludedCommands` is copied verbatim from
  `policy/sandbox.json`, which the owner maintains and no agent may write.
- `mcpServers` — `mcp/servers.json` filtered to `targets.claude`.

Preserved: everything else in the live file, byte-for-byte in value —
`autoMode`, `enabledPlugins`, `statusLine`, `model`, `effortLevel`, `theme`,
`env` (minus the retiring harness's own keys: `YOKI_*` and
`CLAUDE_PLUGIN_ROOT`, whose value names the runtime being retired), and any key
Claude Code adds later.

### Two things the generator prints instead of writing

`policy/` is not agent-writable — its own floor rules (`floor-policy-write`,
`floor-policy-edit`) forbid it, and the guard blocks even a deliberate attempt.
Where a decision's source belongs there, the dry-run prints what to paste:

- **the default permits.** `src/domain/claude/permits.ts` is a *fallback* that
  keeps the six rules in the output until they exist in
  `policy/guard-rules.json`. The dry-run prints them as a ready `rules[]`
  fragment; once pasted, the projection produces the identical strings and the
  fallback collapses into them, so pasting changes nothing in the output.
  `test/domain/claude/permits.test.ts` pins that equivalence through the real
  parser and the real projection.
- **`policy/sandbox.json`.** Absent, `excludedCommands` falls back to `[]` —
  the tightest possible answer, so a missing source can only over-restrict —
  and the dry-run states which of the two it used.

And one it previews: the generated `AGENTS.md`. Its bold line per decision is
the note's `rule:` line, copied verbatim, per
[`2026-09-23-model-facing-english.md`](../rules/decisions/2026-09-23-model-facing-english.md)
(what the model reads is English, what the owner reads stays Japanese, and a
human writes the seam at the time of the ruling). An accepted note with no
`rule:` line does not bind and is reported as a gap — the generator never
translates a title into one.

The dry-run prints a whole-file unified diff plus three lists: **keys jig now
owns**, **keys left as-is**, and **keys jig would REMOVE**. The third is the
one-time cleanup — the 33 yoki hooks, the 71 inherited allow rules, the
`YOKI_*` environment variables — spelled out value by value, so no flag is
needed to opt out of a surprise that has already been read.

Not touched in milestone 1: `~/.claude/{skills,rules,agents,commands}` and
`~/.claude/CLAUDE.md` are still `yoki-switch` symlinks, and `~/.claude.json` is
never touched in any milestone.
