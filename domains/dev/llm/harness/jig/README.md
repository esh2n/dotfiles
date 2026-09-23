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
two places (an MCP server registered in `~/.claude.json` under a name the
source no longer has, say) is a one-time manual migration step, not a generator
feature; the decision above records the day that dependency nearly got
inverted.

`~/.claude.json` is never touched at all.

### Milestones

| # | Scope | Status |
|---|---|---|
| 1 | Claude Code's `~/.claude/settings.json`: `hooks`, `permissions.{allow,deny,defaultMode}`, `sandbox`, and the removal of `YOKI_*` from `env`; MCP servers as printed `claude mcp add` lines | **done** |
| 2 | The sources move: `skills/`, `rules/` and `agents/` into `llm/harness/`, and jig delivers `~/.claude/{skills,rules,agents}` and the generated `AGENTS.md` (with `CLAUDE.md` → `AGENTS.md`), and retires `~/.claude/commands` | **done** |
| 3a | Codex: `~/.agents/skills` and `~/.codex/skills` as managed link directories, `~/.codex/AGENTS.md`, `~/.codex/agents/*.toml`, jig's MCP block in `~/.codex/config.toml` | **done** |
| 3b | omp: the same `~/.agents/skills` mount (one plan shared with 3a), `~/.omp/agent/agents/*.md`, jig's entries in `~/.omp/agent/mcp.json`, `~/.omp/agent/extensions/jig.ts` → jig's omp extension; `config.yml` reported, not owned | **done** |
| 3c | pi, DSH | |
| 4 | `yoki-switch` retired, along with `core/config/manager.sh`'s `link_*` functions for the harnesses | |

### What each milestone replaces in `yoki-switch`

Rows cite the destination table in
[`rules/research/2026-09-22-generator-migration-map.md`](../rules/research/2026-09-22-generator-migration-map.md)
§1a.

| yoki-switch mechanism (map §1a) | Replaced by | Milestone |
|---|---|---|
| `merge_settings()` (yoki-switch:200-327) — `jq -s` over `core/settings.layer.json` × packs × `personal/settings.personal.json` | `app/apply/apply-claude.ts` + `domain/claude/settings.ts`: no layers, five managed keys, everything else preserved | 1 |
| the `hooks` array concatenation of §1e (personal → packs → core, 33 entries over 7 events) | `domain/claude/hooks.ts`: five events, one hook each, generated from jig's own subcommands | 1 |
| `permissions.yaml` layers → `lib/permissions/to-claude.js` (§1c) | `domain/policy/to-claude-permissions.ts` over `policy/guard-rules.json`, plus `domain/claude/permits.ts` | 1 |
| `mcp.json` layers → `lib/mcp-inventory/writers/claude.js` (§1d), which wrote `mcpServers` into settings.json — a key Claude Code never reads | `mcp/servers.json` → `domain/mcp/to-claude.ts` → `domain/mcp/claude-mcp-add.ts`: one printed `claude mcp add --scope user` line per server, run by hand (see "MCP servers" below) | 1 |
| `.autoMode` carry-over (yoki-switch:317-326) | generalized: every unmanaged key is preserved, not just the one | 1 |
| `~/.claude/.yoki/permissions.json` (hook-enforced deny set) | nothing — the guard reads `policy/guard-rules.json` directly | 1 |
| `merge_claude_md()` (yoki-switch:332-346) — `CLAUDE.layer.md` + `CLAUDE.personal.md` | generated `AGENTS.md` from `rules/common/` + `rules/decisions/` (`domain/claude/agents-md.ts`), `CLAUDE.md` → `AGENTS.md` | 2 |
| `merge_dir()` (yoki-switch:352-390) — the `.{dir}-merged` staging dirs behind `skills`/`hooks`/`commands`/`agents`/`rules`/`workflows`/`scripts` | one flat source tree, delivered by symlink; no `commands/` at all ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)) | 2 |
| `link_external_resources()` (yoki-switch:411-452) and `external-links.yaml` | folded into the flat tree | 2 |
| `.claude-packs` / `packs.default` / `pack enable\|disable` | gone — rules are selected by `paths:` frontmatter, skills by the judgment service | 2 |
| `apply_target_generator()` (yoki-switch:670-706) → `targets/gen.js` for codex: `codex-agents.js`, `codex-skills.js`, the `# yoki:begin` block of `config.toml`, the `~/.agents/skills` links | `app/apply/apply-codex.ts` + `domain/codex/{skills,agents,config}.ts`, with the milestone-2 delivery verbs shared through `app/apply/delivery.ts` | 3a |
| `targets/gen.js` for omp: `omp-agents.js` + `omp-tool-names.js`, `omp-mcp.js`, the `~/.agents/skills` links, `link_omp_resources` in `core/config/manager.sh` | `app/apply/apply-omp.ts` + `domain/omp/{agents,mcp,agent-dir}.ts`, the mount through `app/apply/delivery.ts`'s `planAgentsSkillsMount` (shared with 3a) | 3b |
| `targets/gen.js` for omp: `omp-config-yml.js`, `omp-rules-md.js`, `omp-hooks.js` (`config.yml`, `RULES.md`, `yoki-hooks.json`, the `yoki-*.ts` extension links) | nothing yet — reported as leftovers by 3b; `config.yml` ownership is a ruling not made | 4 |
| `link_pi_resources` / `link_dsh_resources` in `core/config/manager.sh` | per-target modules under `app/apply/` | 3c |

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

Preserved: everything else in the live file, byte-for-byte in value —
`autoMode`, `enabledPlugins`, `statusLine`, `model`, `effortLevel`, `theme`,
`env` (minus the retiring harness's own keys: `YOKI_*` and
`CLAUDE_PLUGIN_ROOT`, whose value names the runtime being retired), and any key
Claude Code adds later.

Removed as jig's own dead value: `mcpServers`. Milestone 1 first wrote it on
the assumption that Claude Code reads MCP servers from settings.json; it does
not (next section). The key is neither owned nor carried: it leaves on
`--write`, and the dry-run lists it under "keys jig would REMOVE" with that
reason.

### MCP servers

Claude Code does not read MCP servers from `~/.claude/settings.json`
([mcp.md](https://code.claude.com/docs/en/mcp.md),
[settings.md](https://code.claude.com/docs/en/settings.md): "MCP servers are
NOT stored in settings.json"). Its sources are `~/.claude.json` (user scope,
written by `claude mcp add --scope user …`), the project's `.mcp.json`,
plugins, claude.ai connectors and managed-mcp.json. There is no JSON bulk-add
command: `claude mcp add` and `claude mcp remove` are the only documented
writers of `~/.claude.json`, and `claude mcp list` shows every source with its
scope. `~/.claude.json` is also a file jig may neither read nor write (the
invariant above), so the delivery is the same as the default permits': the
dry-run prints, under `mcp servers (claude mcp, user scope)`, one paste-able
line per `targets.claude` server in `mcp/servers.json` —
`targetOverrides.claude` applied, `{{HOME}}` substituted, `env` as `-e`,
`headers` as `-H`, `transport` as `--transport stdio|http|sse`, every word
shell-quoted (`domain/mcp/shell-quote.ts`; a `${VAR}` reference is
single-quoted so it reaches `~/.claude.json` intact, where Claude Code expands
it at runtime). The owner runs the block once, and again after editing
`mcp/servers.json`. A server registered in `~/.claude.json` but no longer in
the source is removed by hand with `claude mcp remove --scope user <name>`;
jig cannot list those, because it does not read `~/.claude.json`.

`--write` does not run the lines. Whether jig may invoke the `claude` CLI is a
ruling the owner has not made; until then `--write` performs the settings.json
change only, and the dry-run says so under the block.

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

The dry-run prints a whole-file unified diff plus three lists: **keys jig now
owns**, **keys left as-is**, and **keys jig would REMOVE**. The third is the
one-time cleanup — the 33 yoki hooks, the 71 inherited allow rules, the
`YOKI_*` environment variables — spelled out value by value, so no flag is
needed to opt out of a surprise that has already been read.

### Milestone 2: the rest of `~/.claude`, same command

The same `jig apply --target claude` delivers the directories and the
generated instructions file; `--write` does all of it in one run, and one
conflict anywhere (either generated file hand-edited, or a `commands`
directory holding real files) stops the whole write — the parts are one
delivery.

Sources, all under `llm/harness/`: `skills/<name>/SKILL.md` (one flat tree),
`rules/common/*.md` (always-on), `rules/<lang>/*.md` (conditional, keyed by
`paths:` frontmatter), `rules/decisions/*.md`, `agents/*.md`.

Destinations:

- **`AGENTS.md`** — generated, written atomically with the same hand-edit
  detection as `settings.json` (`domain/tiers/plan.ts` + the manifest). In
  order: one HTML comment naming the sources; the bodies of `rules/common/*.md`
  in file-name order, frontmatter stripped, otherwise verbatim (`README.md`
  skipped); then the research-index line and `## Decisions`. Every link is
  absolute under the harness root — the file lives in `~/.claude`, where a
  relative link resolves nowhere. The dry-run prints the byte size and warns
  past 32 KiB, where Codex truncates
  ([`2026-09-22-decision-records.md`](../rules/decisions/2026-09-22-decision-records.md));
  a warning, not a refusal. A file at that path jig has no record of writing
  is kept as `AGENTS.md.pre-jig.<stamp>` before the first generated one lands.
  The bold line per decision is the note's `rule:` line, copied verbatim, per
  [`2026-09-23-model-facing-english.md`](../rules/decisions/2026-09-23-model-facing-english.md);
  an accepted note with no `rule:` line does not bind and is reported as a
  gap — the generator never translates a title into one.
- **`CLAUDE.md`** → symlink, relative target `AGENTS.md`.
- **`skills/`**, **`agents/`**, **`rules/`** → three real directories jig
  manages, each holding one symlink per entry
  (`domain/claude/managed-dir.ts`, one reconciliation shared by all three):
  - `skills/<name>` → `llm/harness/skills/<name>`, for every directory
    there that holds a `SKILL.md` (`domain/claude/skills-dir.ts`; the
    tree's `README.md` and a directory without one get no link).
  - `agents/<name>.md` → `llm/harness/agents/<name>.md`, for every regular
    `*.md` file there (`domain/claude/agents-dir.ts`).
  - `rules/<lang>` → `llm/harness/rules/<lang>`, for every subdirectory of
    `rules/` except `common`, `decisions` and `research`
    (`domain/claude/rules-dir.ts`, `NOT_RULE_DIRS`, with the why): `common`
    is in AGENTS.md and a link would load it twice; the other two are
    Markdown for humans and would load as always-on rules.

  Why directories of links and not one symlink per tree: Claude Code writes
  into `~/.claude/skills/` itself — it keeps `synced/<bucket-id>/…` there
  (skills synced from the claude.ai account) with a `.bucket-<id>` marker
  beside it, and updates that tree on its own. One symlink from
  `~/.claude/skills` into the harness would land those writes in git
  sources. `agents/` takes the same shape for the same reason and for
  symmetry. On write, for each of the three: the directory is created if
  missing (a symlink standing there — today yoki-switch's `.<x>-merged` — is
  replaced, its target left alone), missing links added, links pointing
  elsewhere replaced, links into the source tree that are no longer planned
  removed as stale, and anything else left alone and reported as "not
  jig's" — `synced/` and its marker are the expected case, named in the
  dry-run.
- **`commands`** — retired
  ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)).
  A symlink, or a directory whose entries are all symlinks, is removed on
  write; a directory holding any regular file is a conflict and is not
  touched.

Each symlink destination — `CLAUDE.md` and every entry of the three managed
directories — is planned by `domain/claude/links.ts` from what `lstat` finds
there and printed one line per destination: `ok` (already the planned link),
`create`, `replace` (a symlink elsewhere — the old target is shown; what it
pointed at is untouched), or `backup-then-create` (a regular file or a real
directory: renamed to `<path>.pre-jig.<YYYYMMDD-HHMMSS>`, UTC, then linked —
user content is never deleted). The dry-run prints a `links` section for
`CLAUDE.md`, then a `skills directory:`, `agents directory:` and `rules
directory:` section of the same shape: the directory's own state, the count
of entries to link, one line per entry (planned, stale, or not jig's), and
the source entries that get no link with why. On the machine yoki-switch
left, that reads: `CLAUDE.md` backup-then-create; `skills`, `agents` and
`rules` directories replace (currently → `.<x>-merged`) with every entry
`create`; `commands` remove.

The skill router (`hooks user-prompt-submit`, `serve`, `skills hide|show`)
reads its default root from `~/.claude/skills`, the directory Claude Code
itself loads from — before the first `--write` yoki-switch's symlink to the
same content, after it the managed directory above. `JIG_SKILL_ROOT` still
overrides it.

Not touched in milestone 2: `~/.claude/{hooks,scripts,workflows}` and every
`.<x>-merged` staging directory stay with `yoki-switch` until milestone 4, and
`~/.claude.json` is never touched in any milestone.

### Milestone 3a: codex

```sh
bun src/cli/jig.ts apply --target codex            # dry-run: the plan, the diffs, the leftovers
bun src/cli/jig.ts apply --target codex --write    # writes everything in one run; any conflict aborts it
```

Same shape as the Claude target, over `$CODEX_HOME` (default `~/.codex`,
honored as `CLAUDE_CONFIG_DIR` is) and the cross-harness skills mount. Never
part of `--target all`, for the same reason. The formats are Codex's own
documentation, cited where each is fixed in code:
[build-skills](https://learn.chatgpt.com/docs/build-skills) (skill discovery
paths, `agents/openai.yaml`), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
(`~/.codex/agents/*.toml`), and the
[config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
(`[mcp_servers.<id>]`).

Destinations, one source tree:

- **`~/.agents/skills/`** — a managed directory of links
  (`domain/claude/managed-dir.ts`, the milestone-2 mechanism), one per skill
  directory of `skills/` that holds a `SKILL.md` — the `$HOME/.agents/skills`
  row of Codex's discovery table ("Personal skills across repositories"), and
  the directory pi and omp read too. On the machine yoki-switch left it holds
  53 links into the retired `claude-profiles/` tree, all dangling since the
  sources moved: two widenings of the milestone-2 stale rule, both opt-in per
  destination (`formerSourceDirs`, `dangling`), make those stale — removed on
  write, reported as `link into the retired tree` or `dangling link` — while
  the Claude directories keep the narrow rule. Anything else is not jig's.
- **`~/.codex/skills/`** — the same mechanism, only for skills with a Codex
  port: `~/.codex/skills/<name>` → `skills/<name>/codex`
  (`domain/codex/skills.ts`; today `grilling` and `code-graph-exploration`).
  Codex's bundled `.system/` is foreign and stays. yoki's `cmd-*`
  directories — its command→skill conversion, redundant now that commands
  are skills delivered through `~/.agents/skills` — are real directories, so
  jig does not remove them; the dry-run lists them under a `yoki leftovers`
  heading for milestone 4. One consequence the doc states and the dry-run
  repeats: "If two skills share the same `name`, Codex doesn't merge them;
  both can appear in skill selectors" — a ported skill is listed twice. The
  generator delivers what the sources say; whether the generic entry should
  yield is a ruling, not a flag.
- **`~/.codex/AGENTS.md`** — the same generated content as
  `~/.claude/AGENTS.md`, from the same renderer, with the same hand-edit
  detection and the same first-write backup (`.pre-jig.<stamp>`; today the
  file there is yoki's, with its markers). One source, two destinations, no
  vocabulary substitution — the header names the claude target because the
  bytes are that file's. The dry-run prints the diff rather than the text.
- **`~/.codex/agents/<name>.toml`** — one generated file per `agents/*.md`,
  each tracked in the manifest (`planApply` per file; a hand edit is a
  conflict; a file jig has no record of writing is kept as
  `<name>.toml.pre-jig.<stamp>` first). The translation
  (`domain/codex/agents.ts`): `name` and `description` verbatim, the body as
  `developer_instructions`, and `tools:` as one trailing sentence of the
  instructions, because Codex's custom agent has no per-agent tool list and a
  dropped field should be visible. `model:` is a Claude tier name
  (`sonnet`/`opus`/`haiku`) and jig has no source that maps it to a Codex id
  — `policy/tiers.json` maps tiers to the proxy's backends, and yoki's
  `harness-models.json` is the retiring generator's guess, not a ruling — so
  `model` is left out (Codex applies its default) and the dry-run counts the
  gap per tier. The map is a `CodexApplyOptions.codexModels` parameter,
  empty at the composition root until a decision note fills it. Files there
  that no source produces are not jig's.
- **`~/.codex/config.toml`** — `[mcp_servers.<id>]` for every server with
  `targets.codex: true` (`targetOverrides.codex` applied, `{{HOME}}`
  substituted; stdio: `command`, `args`, `env`; HTTP: `url`), inside jig's
  own `# jig:begin mcp` … `# jig:end mcp` block, beside the
  `# jig:begin hooks` block `jig codex register` keeps
  (`domain/codex/config.ts`). Each command rewrites only its own block;
  every other table — `[projects.*]` that Codex writes when a directory is
  trusted, `[features]`, `[sandbox_workspace_write]`, yoki's block — is
  carried through byte for byte. Hand-edit detection compares the block,
  not the file, so a directory Codex trusts after jig wrote is not a
  conflict. A `[mcp_servers.<id>]` outside the block for a server jig also
  writes is a conflict that names the table and its line and stops the write:
  a duplicate table stops Codex from loading its configuration at all, and
  reconciling a setting that exists in two places is the one-time manual
  step the config-layout decision keeps out of the generator, exactly as
  with `~/.claude.json`. On the machine yoki-switch left, that is five
  servers (three in yoki's block, two at the top level). `[permissions.yoki]`
  and `[permissions.yoki.filesystem]`, and yoki's block as a whole, are
  reported as leftovers for milestone 4.
- **`~/.codex/hooks.json`** — `jig codex register`'s. The dry-run says so and
  nothing touches it here.

`--write` writes all of it in one run — the generated files, the block, the
manifest and provenance, then the two directories — and any conflict
anywhere (a hand-edited generated file, the block, a server declared outside
it) returns `wrote: false` with nothing written.

### Milestone 3b: omp

```sh
bun src/cli/jig.ts apply --target omp            # dry-run: the plan, the diffs, the leftovers
bun src/cli/jig.ts apply --target omp --write    # writes everything in one run; any conflict aborts it
```

Same shape as the Codex target, over omp's agent directory and the
cross-harness skills mount. Never part of `--target all`. The agent directory
is resolved the way omp resolves it (`domain/omp/agent-dir.ts`, from
[environment-variables.md §6](https://github.com/can1357/oh-my-pi/blob/main/docs/environment-variables.md)
and [config-usage.md "Profiles"](https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md#profiles)):
`~/.omp/agent` by default, `~/.omp/profiles/<name>/agent` under
`OMP_PROFILE` (or the legacy `PI_PROFILE`), `PI_CODING_AGENT_DIR` as a whole
replacement for the default profile only, `PI_CONFIG_DIR` renaming `.omp`.
The formats are omp's own documentation and sources, cited where each is
fixed in code: [task-agent-discovery.md](https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md)
(custom agents), [mcp-config.md](https://github.com/can1357/oh-my-pi/blob/main/docs/mcp-config.md)
(`mcp.json`), [extension-loading.md](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md)
(extensions), and `packages/coding-agent/src/tools/builtin-names.ts` (tool
ids).

Destinations, one source tree:

- **`~/.agents/skills/`** — the directory the Codex target delivers, from
  the one function both call (`planAgentsSkillsMount` in
  `app/apply/delivery.ts`): same sources, same selection, same stale rules,
  so whichever target runs first creates the links and the other finds every
  entry `ok`. The report carries which target planned it and the dry-run
  says so. omp reads the directory through its `agents` provider
  ("Load skills from .agent/skills and .agents/skills"), and
  `~/.claude/skills` through its `claude` provider; duplicate names are
  deduplicated by omp, first provider wins.
- **`~/.omp/agent/agents/<name>.md`** — one generated file per
  `agents/*.md`, manifest-tracked (a hand edit is a conflict; a file jig has
  no record of writing — today yoki's — is kept as
  `<name>.md.pre-jig.<stamp>` first; a file no source produces is not
  jig's). omp's agent file is the source's own shape, so the body is copied
  verbatim and only the frontmatter is translated (`domain/omp/agents.ts`):
  `name` and `description` verbatim (omp drops a file missing either);
  `tools:` through a fixed table onto omp's ids — omp's own
  `normalizeToolNames` lower-cases a name only when the result is a built-in
  id, so `WebSearch` or `TodoWrite` would otherwise pass through as unknown
  tools and restrict the agent to nothing; `WebFetch` maps to `read`, which
  is omp's URL reader; a name with no omp tool is left out and counted
  (`NotebookEdit`, `Skill`), which only narrows the agent; an empty result
  omits the key and omp grants its default set. `model:` is a Claude tier
  and omp wants a provider-qualified selector or a `modelRoles` alias; jig
  has no source for that mapping, so `model` is left out and the dry-run
  counts the gap per tier, exactly as the Codex target does
  (`OmpApplyOptions.ompModels`, empty at the composition root until a
  decision note fills it). The generated frontmatter is validated as YAML
  before writing.
- **`~/.omp/agent/mcp.json`** — jig's entries of `mcpServers` for every
  server with `targets.omp: true` (`targetOverrides.omp` applied, `{{HOME}}`
  substituted, `${VAR}` left for omp to expand at discovery; stdio:
  `type`, `command`, `args`, `env`; http/sse: `type`, `url`, `headers`),
  in omp's documented shape (`domain/omp/mcp.ts`). Per the
  [MCP-list decision](../rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md)
  omp gets the full list: its MCP client is lazy (`xdev`), so a server
  costs nothing until called. Ownership is per entry: every `mcpServers`
  entry no source produces (a hand-added server, or one from `/mcp add`) and
  every other top-level key (`$schema`, `disabledServers`, `enabledServers`)
  is carried through and named. Hand-edit detection compares jig's entries,
  not the file — omp writes into this file itself — so a server omp adds
  after jig wrote is not a conflict, while a `/mcp disable` on a jig server
  (omp edits the entry's `enabled` in place) is one, and the dry-run names
  `disabledServers` as the way that does not collide. A file that cannot be
  read as a JSON object is a conflict too: nothing can be carried through,
  so nothing is written. On the machine yoki-switch left, the file holds two
  of the six servers in the other order: one write, then noop.
- **`~/.omp/agent/extensions/jig.ts`** — a symlink to
  `jig/adapters/omp/src/index.ts`, the extension that carries the guard,
  the session record, the formatter and the stop gate
  ([adapters/omp/README.md](adapters/omp/README.md), "Installing it"). omp's
  native discovery scans that directory for `*.{ts,js}`, "symlinks are
  treated as eligible files/directories", and loads TypeScript directly, so
  there is no package and no build. The directory is created when missing;
  a regular file at the link's path is renamed aside. The directory's other
  entries are listed and left alone: `yoki-bridge.ts` and `yoki-guard.ts`
  under a "yoki leftovers (milestone 4)" heading, anything else as not
  jig's. To switch the extension off, `disabledExtensions:
  [extension-module:jig]` in `config.yml` — omp derives that id from the
  link's name.
- **Report only.** `yoki-hooks.json`, `RULES.md`, `.yoki/` and `config.yml`
  under the agent directory are yoki's, listed with what each is and left
  for milestone 4. jig does not own `config.yml` in this milestone: omp's
  approval policy, tool settings and model roles live there, and what jig
  should write is a ruling not yet made. Skills and the instructions file
  reach omp natively — `~/.agents/skills` above, and `~/.claude/CLAUDE.md`
  (→ `AGENTS.md`) through omp's `claude` provider; jig writes no
  `~/.omp/agent/AGENTS.md`, which would shadow it. The conditional `paths:`
  rules (`rules/<lang>/`) are **not** delivered to omp in this milestone:
  omp has no `~/.claude/rules` reader and jig's omp extension does not
  inject them yet. The dry-run names that gap.

`--write` writes all of it in one run — the generated files, `mcp.json`,
the manifest and provenance, then the skills mount and the extension link —
and any conflict anywhere (a hand-edited generated file, a changed jig entry
in `mcp.json`, an unreadable `mcp.json`, a regular file where the
`extensions` directory should be) returns `wrote: false` with nothing
written.
