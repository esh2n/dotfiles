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
`infra/state`. The config generator that replaced yoki-switch is complete —
see [The generator](#the-generator-jig-apply--retiring-yoki-switch).

## Develop

```sh
bun install
bun test          # unit tests (Bun's built-in runner)
bun run typecheck # tsc --noEmit (strict)
bun run lint      # biome
bun run src/cli/jig.ts version
```

## Commands

`bun run src/cli/jig.ts` with no arguments prints the usage; on a terminal it
opens the interactive entry point (which harness, then host or box). The
subcommands (`src/cli/jig.ts`):

| command | what it does |
|---|---|
| `version` | prints the version |
| `hooks <pre-tool-use\|session-start\|user-prompt-submit\|post-tool-use-format\|stop-gate>` | the five hook entrypoints (stdin JSON → stdout JSON) |
| `decide`, `tier` | one-shot judgments: a request on stdin, the answer on stdout (`src/cli/decide.ts`, `src/cli/tier.ts`) |
| `serve` | the judgment service over HTTP, with `/metrics` |
| `report skills [--days N] [--json] [--opened-via read\|skill\|any]` | what the skill router injected against what the model opened, from session transcripts |
| `report guard-coverage [--days N] [--json]` | reconciles the tool calls Claude Code and Codex recorded in their transcripts against jig's audit log, and names the harnesses it cannot reconcile (`src/app/coverage/`) |
| `apply [--target claude\|codex\|omp\|pi\|dsh\|litellm\|all] [--write [--take-over]]` | the generator below. Dry-run by default. `--target all` (the default) runs the tiers half only — `pi`, `dsh`, `omp` and `litellm` (`home/shared/litellm/config/config.yaml`'s tiers block) from `policy/tiers.json` and `policy/models.json`. `--take-over` (claude, codex or pi, with `--write`): when jig's own earlier writes no longer match its record, copies the files aside (`<file>.pre-dotfiles`), forgets that record and writes jig's part again |
| `tiers [list]`, `tiers use <tier> <model>...` | lists the tiers and the model catalog, or points a tier at catalog models in LiteLLM order (rewrites `policy/tiers.json`; run `apply --write` after) |
| `setup [--target claude\|codex\|pi\|omp\|dsh]` | what home-manager activation runs once the links are written (`app/setup/setup-harness.ts`): builds the DSH plugin, installs DSH's expanded copies and links the plugin into each scaffolded profile, seeds codex's `config.toml` once, then `apply --target <h> --write` per harness and `codex register --write` when codex is installed. A failed step warns; it exits 0 |
| `codex register [--write]` | registers jig's hooks with Codex (`hooks.json` and the trust entry) |
| `retire yoki [--write]` | [Milestone 4](#milestone-4-jig-retire-yoki) |
| `skills <hide\|show> [--write]` | sets or clears `disable-model-invocation` on every skill under the root |
| `box <new\|list\|resume\|fetch\|rm>` | runs an agent in a Docker Sandboxes microVM around a clone of this repository (`src/cli/box.ts`, `rules/decisions/2026-09-22-box-shape.md`) |

## Placement

Lives at `harness/jig/` in the dotfiles monorepo, replacing the
old `claude-profiles/runtime/yoki`. The composed content (skills, rules,
agents, MCP, policy) stays alongside under `harness/` and jig composes it — it
is not vendored inside jig.

## The generator (`jig apply`) — retiring `yoki-switch`

`domains/dev/bin/yoki-switch` (1039 lines of bash) wrote five harnesses'
configuration. `jig apply` replaced it target by target, and yoki-switch was
deleted (834c0d71); every milestone below is done. The sources are the flat
tree named by
[`rules/decisions/2026-09-24-harness-top-level-dir.md`](../rules/decisions/2026-09-24-harness-top-level-dir.md)
— `rules/ skills/ agents/ hooks/ mcp/ policy/` under `harness/`, with no
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

`~/.claude.json` is Claude Code's own state file. jig changes one key of it,
`mcpServers`, and only the servers it recorded writing ([MCP servers](#mcp-servers)).

### Milestones

| # | Scope | Status |
|---|---|---|
| 1 | Claude Code's `~/.claude/settings.json`: `hooks`, `permissions.{allow,deny,defaultMode}`, `sandbox`, and the removal of `YOKI_*` from `env`; MCP servers in `~/.claude.json`'s `mcpServers` | **done** |
| 2 | The sources move: `skills/`, `rules/` and `agents/` into `harness/`, and jig delivers `~/.claude/{skills,rules,agents}` and the generated `AGENTS.md` (with `CLAUDE.md` → `AGENTS.md`), and retires `~/.claude/commands` | **done** |
| 3a | Codex: `~/.agents/skills` as a managed link directory (`~/.codex/skills` reported, not managed), `~/.codex/AGENTS.md`, `~/.codex/agents/*.toml` with the model from `agents/models.json`, jig's MCP block in `~/.codex/config.toml` | **done** |
| 3b | omp: the same `~/.agents/skills` mount (one plan shared with 3a), `~/.omp/agent/agents/*.md`, jig's entries in `~/.omp/agent/mcp.json`, `~/.omp/agent/extensions/jig.ts` → jig's omp extension; jig's keys of `config.yml` | **done** |
| 3c-pi | pi: the same `~/.agents/skills` mount (one plan shared with 3a/3b), `~/.pi/agent/AGENTS.md` as the same generated file (replacing today's symlink into the repo), jig's entries in pi-mcp-adapter's `~/.config/mcp/mcp.json`; `packages` and `extensions/` reported, not owned | **done** |
| 3c-dsh | DSH: jig's `@deepseek-ai/dsh-mcp-client` rows (serena, codebase-memory, context7 — the `targets.dsh` set) in each scaffolded-and-repo-owned profile's `$DSH_HOME/profiles/<name>/cordis.patch.yml`, every other row carried through; `$DSH_HOME/AGENTS.md` as the same generated file; skills, the home-level patch, `settings.yaml`, `hooks.claude.json` and the guard plugin reported, not owned | **done** |
| 4 | `~/.claude/{scripts,workflows}` as two more managed directories of the Claude target, and `jig retire yoki [--write]`: the yoki / yoki-switch artifacts on the machine, listed with evidence and removed on `--write` — the staging directories, state, links, Codex's block and hook groups, omp's files, Cursor's links | **done** (2026-09-23: sources moved, `retire yoki --write` run, `claude-profiles/` and `yoki-switch` deleted — see [Milestone 4](#milestone-4-jig-retire-yoki)). `core/config/manager.sh` was deleted later (52411843): home-manager (`home/shared/harness/default.nix`) links pi's and DSH's files, and `jig setup` does DSH's copies and plugin |

### What each milestone replaces in `yoki-switch`

Rows cite the destination table in the yoki-switch migration map, §1a.

| yoki-switch mechanism (map §1a) | Replaced by | Milestone |
|---|---|---|
| `merge_settings()` (yoki-switch:200-327) — `jq -s` over `core/settings.layer.json` × packs × `personal/settings.personal.json` | `app/apply/apply-claude.ts` + `domain/claude/settings.ts`: no layers, five managed keys, everything else preserved | 1 |
| the `hooks` array concatenation of §1e (personal → packs → core, 33 entries over 7 events) | `domain/claude/hooks.ts`: five events, one hook each, generated from jig's own subcommands | 1 |
| `permissions.yaml` layers → `lib/permissions/to-claude.js` (§1c) | `domain/policy/to-claude-permissions.ts` over `policy/guard-rules.json`, plus `domain/claude/permits.ts` | 1 |
| `mcp.json` layers → `lib/mcp-inventory/writers/claude.js` (§1d), which wrote `mcpServers` into settings.json — a key Claude Code never reads | `mcp/servers.json` → `domain/mcp/to-claude.ts` → `domain/claude/claude-json.ts`: the `mcpServers` key of `~/.claude.json` (see "MCP servers" below) | 1 |
| `.autoMode` carry-over (yoki-switch:317-326) | generalized: every unmanaged key is preserved, not just the one | 1 |
| `~/.claude/.yoki/permissions.json` (hook-enforced deny set) | nothing — the guard reads `policy/guard-rules.json` directly | 1 |
| `merge_claude_md()` (yoki-switch:332-346) — `CLAUDE.layer.md` + `CLAUDE.personal.md` | generated `AGENTS.md` from `rules/common/` + `rules/decisions/` (`domain/claude/agents-md.ts`), `CLAUDE.md` → `AGENTS.md` | 2 |
| `merge_dir()` (yoki-switch:352-390) — the `.{dir}-merged` staging dirs behind `skills`/`hooks`/`commands`/`agents`/`rules`/`workflows`/`scripts` | one flat source tree, delivered by symlink; no `commands/` at all ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)); `scripts` and `workflows` as managed directories, and the staging dirs themselves, `~/.claude/hooks`, `.yoki/` and `.claude-packs` removed by `jig retire yoki` | 2, 4 |
| `link_external_resources()` (yoki-switch:411-452) and `external-links.yaml` | folded into the flat tree | 2 |
| `.claude-packs` / `packs.default` / `pack enable\|disable` | gone — language guidance lives in the language skills (`skills/<lang>-*`), and skills are selected by the judgment service | 2 |
| `apply_target_generator()` (yoki-switch:670-706) → `targets/gen.js` for codex: `codex-agents.js`, `codex-skills.js`, the `# yoki:begin` block of `config.toml`, the `~/.agents/skills` links | `app/apply/apply-codex.ts` + `domain/codex/{agents,config}.ts` and `domain/claude/agent-models.ts`, with the milestone-2 delivery verbs shared through `app/apply/delivery.ts`; `codex-skills.js` has no successor (no Codex-specific skills) — its `cmd-*` directories, the two port links, the block, `[permissions.yoki]`, `rules/yoki.rules`, `.yoki/` and the hook groups in `hooks.json` are removed by `jig retire yoki` | 3a, 4 |
| `targets/gen.js` for omp: `omp-agents.js` + `omp-tool-names.js`, `omp-mcp.js`, the `~/.agents/skills` links, `link_omp_resources` in `core/config/manager.sh` (deleted) | `app/apply/apply-omp.ts` + `domain/omp/{agents,mcp,agent-dir}.ts`, the mount through `app/apply/delivery.ts`'s `planAgentsSkillsMount` (shared with 3a) | 3b |
| `targets/gen.js` for omp: `omp-config-yml.js`, `omp-rules-md.js`, `omp-hooks.js` (`config.yml`, `RULES.md`, `yoki-hooks.json`, the `yoki-*.ts` extension links) | `RULES.md`, `yoki-hooks.json`, `.yoki/` and the two `yoki-*.ts` links removed by `jig retire yoki`; `config.yml`: jig's keys written by `apply --target omp` (`domain/omp/config.ts`, since fb2503ac) | 4 |
| `link_cursor_rules` — `~/.cursor/rules/*` → `claude-profiles/runtime/yoki/.cursor/rules/` | nothing delivered (Cursor is not a jig target); the links removed by `jig retire yoki` | 4 |
| `link_pi_resources` in `core/config/manager.sh` (deleted): the `AGENTS.md` link | `app/apply/apply-pi.ts`: the generated file over the link, `domain/pi/{mcp,packages,agent-dir}.ts` for the rest; the mount through `planAgentsSkillsMount` (shared with 3a/3b) | 3c-pi |
| `link_pi_resources`: the `settings.json`/`models.json` links, the `extensions/*.ts` and `themes/*.json` file links | home-manager (`home/shared/harness/default.nix`); 3c-pi reports `extensions/` and reads `settings.json` as the `packages` source; `models.json` is the tiers target's file | — |
| `link_dsh_resources` in `core/config/manager.sh` (deleted): the profile discovery rule (scaffolded AND in the repo) | `app/apply/apply-dsh.ts`, the same rule, plus what manager.sh never did — the MCP rows (`domain/dsh/{mcp,cordis-patch}.ts`) and `AGENTS.md` | 3c-dsh |
| `link_dsh_resources`: the `settings.yaml` link, the `hooks.claude.json` expanded copy, the per-profile `cordis.patch.yml` expanded copy, the plugin build + `pnpm add link:` | home-manager (the `settings.yaml` link) and `jig setup` (`app/setup/setup-harness.ts`: the copies, the build, the link), both reported by 3c-dsh; `jig setup` installs the copies before it runs `apply --target dsh --write`, so the block lands after them | — |

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
  The formatter (`post-tool-use-format`) and the gate (`stop-gate`) follow
  [`2026-09-23-project-hooks-first-jig-table-fallback.md`](../rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md):
  a project with `lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml` gets its own runner
  (`lefthook run pre-commit --file <f>…` / `pre-commit run --files <f>…`) on the edited file and, at Stop, on the files the turn touched;
  jig's extension and marker tables apply only to projects with no such file, and a config without its tool blocks once with "install it" instead of falling back.
  Per [`2026-09-23-hooks-carry-formatters-only-stylelint-added.md`](../rules/decisions/2026-09-23-hooks-carry-formatters-only-stylelint-added.md)
  the table runs formatters only: `.css .scss .sass .less` get `stylelint --fix <f>` when the project has a stylelint config
  (`stylelint.config.{js,mjs,cjs}`, `.stylelintrc{,.js,.mjs,.cjs,.yml,.yaml,.json}`, or a `stylelint` key in `package.json`); `.css` falls to biome / prettier only without one, and the preprocessor extensions to nothing.
  `.rs` gets bare `rustfmt <f>` when a `rustfmt.toml` / `.rustfmt.toml` exists (rustfmt's own edition lookup), else `--edition` from the root `Cargo.toml`'s `[package]`, else `--edition 2021`.
  staticcheck, cargo clippy, `go test -race` and html-validate are never hooks: they are default permits (below) and one `rules/common` line.
  Per [`2026-09-23-all-languages-format-and-gate.md`](../rules/decisions/2026-09-23-all-languages-format-and-gate.md)
  the tables cover eleven languages, each with one edit-time formatter (file-scoped, in place) and one Stop-time check
  chosen by the marker at the cwd, in this precedence; a missing tool is a silent skip, and the Stop gate runs a plan's
  commands in order and reports the first failure:

  | language | edit: extensions → formatter | Stop: marker → check |
  |---|---|---|
  | TS/JS/JSON/CSS | `.ts .tsx .js .jsx .mjs .cjs .mts .cts .json .jsonc .css` → `biome check --write` (with `biome.json`) else `prettier --write`; stylelint as above | `tsconfig.json` → `bunx tsc --noEmit` |
  | Go | `.go` → `gofmt -w` | `go.mod` → `go vet ./...` |
  | Python | `.py` → `ruff format` | `pyproject.toml` / `ruff.toml` / `.ruff.toml` → `ruff check .` |
  | Rust | `.rs` → `rustfmt` (edition as above) | `Cargo.toml` → `cargo check --quiet` |
  | C/C++ | `.cpp .cc .cxx .hpp .hh .h .c` → `clang-format -i` | `CMakeLists.txt` → `cmake --build <build\|out/build\|cmake-build-debug>`, first that exists (none: skip) |
  | C# | `.cs` → `dotnet format <nearest .csproj, else root .sln> --include <f>` (no project: skip) | `*.sln` else `*.csproj` at cwd → `dotnet build <it> --no-restore --nologo -clp:ErrorsOnly` |
  | Java | `.java` → `google-java-format --replace` | `pom.xml` → `./mvnw` / `mvn -q compile`; `build.gradle(.kts)` → `./gradlew` / `gradle -q compileJava` (`src/main/java`) and/or `compileKotlin` (`src/main/kotlin`), `classes` when neither is at the root |
  | Kotlin | `.kt .kts` → `ktlint --format` when `.editorconfig` has a `[*.{kt,kts}]` section, else `ktfmt` | `build.gradle(.kts)` → as Java |
  | Perl | `.pl .pm .t .psgi .cgi` → `perltidy -b -bext=/` | `cpanfile` (or, with no marker at all, any touched `.pl`/`.pm`) → `perl -c <f>` per touched `.pl`/`.pm` |
  | PHP | `.php` → `vendor/bin/pint` / `pint` (with `pint.json` or the vendored binary), else `php-cs-fixer fix` (with `.php-cs-fixer(.dist).php`), else `pint` | `composer.json` → `php -l <f>` per touched `.php`, then `vendor/bin/phpstan analyse --no-progress <files>` with `phpstan.neon` / `.neon.dist` / `.dist.neon` |
  | Swift | `.swift` → `swiftformat` | `Package.swift` → `swift build` |

  The doc URL each argv form was checked against sits next to its entry in `domain/hooks/format.ts` and `domain/hooks/gate.ts`.
  The touched-files list (`git diff --name-only --relative HEAD` plus untracked) is asked for only when the plan needs it: a project hook runner, a Perl or PHP gate, or a project with no marker.
- `permissions.allow` / `permissions.deny` — projected from
  `policy/guard-rules.json` by `domain/policy/to-claude-permissions.ts`, plus
  the default permits of
  [`2026-09-22-allow-from-guard-permit.md`](../rules/decisions/2026-09-22-allow-from-guard-permit.md).
  Rules with no native form are listed as `hookOnly` in the dry-run — the hook
  is their enforcement, and a `PreToolUse` deny holds in every permission mode.
- `permissions.defaultMode` — `auto`.
- `sandbox` — `{ "enabled": false }` on the host, per
  [`2026-09-30-host-claude-without-os-sandbox.md`](../rules/decisions/2026-09-30-host-claude-without-os-sandbox.md)
  (`domain/claude/sandbox.ts`): jig's guard and auto mode's classifier check
  every tool call. The key is written rather than left out, so a sandbox
  turned on by hand is visibly jig's to turn off. A box keeps Claude Code's
  own sandbox (`app/box/kit.ts`).

Preserved: everything else in the live file, byte-for-byte in value —
`autoMode`, `enabledPlugins`, `model`, `effortLevel`, `theme`,
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
NOT stored in settings.json"). Its user-scope servers live in the
`mcpServers` key of `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when
that is set), so the same `apply --target claude` writes them there, per
[`2026-09-25-jig-writes-claude-json-mcp.md`](../rules/decisions/2026-09-25-jig-writes-claude-json-mcp.md)
(`domain/claude/claude-json.ts`, planned in `app/apply/apply-claude.ts`).

- One entry per `targets.claude` server in `mcp/servers.json`, in Claude
  Code's own shape: `targetOverrides.claude` applied, `{{HOME}}` substituted;
  stdio as `type`, `command`, `args`, `env`; http/sse as `type`, `url`,
  `headers` (`domain/mcp/to-claude.ts`). A `${VAR}` reference is written as
  is, and Claude Code expands it at runtime.
- Only that key changes. Every other key of the file, and every server jig
  did not write, comes back exactly as read.
- The manifest records the server names jig wrote. A recorded server that
  `mcp/servers.json` no longer has is removed; a server jig never wrote is
  left alone and listed.
- A server of the same name that jig did not write stops the write as a
  conflict, unless it is already identical to jig's entry. The fix is
  `claude mcp remove --scope user <name>`, a rename in `mcp/servers.json`, or
  `--write --take-over`, which makes the servers of jig's names jig's.
- A file that is not a JSON object, or an `mcpServers` that is not an
  object, is a conflict too: nothing is written.

`--write` writes the file atomically together with `settings.json` and the
rest of the Claude target. jig does not run the `claude` CLI for this.

### What the generator prints instead of writing

`policy/` is not agent-writable — its own floor rules (`floor-policy-write`,
`floor-policy-edit`) forbid it, and the guard blocks even a deliberate attempt.
Where a decision's source belongs there, the dry-run prints what to paste:
**the default permits.** `src/domain/claude/permits.ts` (`DEFAULT_PERMITS`) is
a *fallback* that keeps those rules in the output until they exist in
`policy/guard-rules.json`; the list there is the authority on which rules they
are. The dry-run prints them as a ready `rules[]` fragment; once pasted, the
projection produces the identical strings and the fallback collapses into
them, so pasting changes nothing in the output.
`test/domain/claude/permits.test.ts` pins that equivalence through the real
parser and the real projection.

### Waiver lists: a rule switched off per repository, by the owner, outside git

A forbid or ask rule may carry `"unlessCwdIn": "<list name>"`. The list is a
plain text file **beside the policy** (`~/.config/jig/policy/<list name>`),
one path prefix per line (`~` allowed, `#` comments), written by the owner
and never committed: the policy directory is floor-protected, so no agent can
add a line, and `.gitignore` keeps the file out of the repository even if the
directory is the linked one. When the calling session's cwd is under a listed
prefix, that one rule does not fire; the audit line names it under `waived`.
A command that reaches into another repository (`git -C`, `--git-dir`,
`--work-tree`, a `cd`/`pushd` on the same line, or anything the reader could
not resolve) is never waived. Every adapter loads lists through
`src/app/hooks/load-policy.ts`, so the four harnesses agree.

The one use today is `git-push-main-master` with `main-push-allowed`: the
owner's personal repositories may take a push to `main`, work repositories
keep the forbid, and nothing about it lives in a repository or the shell
environment (`rules/decisions/2026-09-24-main-push-allowed-repos-in-owner-policy.md`).

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

Sources, all under `harness/`: `skills/<name>/SKILL.md` (one flat tree;
language guidance lives here, in `skills/<lang>-*`), `rules/common/*.md`
(always-on), `rules/decisions/*.md`, `agents/*.md`. There is no
`rules/<lang>/` and no `paths:`-scoped rule
([`2026-09-23-language-rules-fold-into-skills.md`](../rules/decisions/2026-09-23-language-rules-fold-into-skills.md)).

Destinations:

- **`AGENTS.md`** — generated, written atomically with the same hand-edit
  detection as `settings.json` (`domain/tiers/plan.ts` + the manifest). In
  order: one HTML comment naming the sources; the bodies of `rules/common/*.md`
  in file-name order, frontmatter stripped, otherwise verbatim (`README.md`
  skipped); then one line pointing at the two indexes,
  `rules/knowledge/INDEX.md` (settled facts) and `rules/research/INDEX.md`
  (research of the last 14 days), and `## Decisions`. Every link is
  absolute under the harness root — the file lives in `~/.claude`, where a
  relative link resolves nowhere. The dry-run prints the byte size and warns
  past 32 KiB, where Codex truncates
  ([`2026-09-22-decision-records.md`](../rules/decisions/2026-09-22-decision-records.md));
  a warning, not a refusal. A file at that path jig has no record of writing
  is kept as `AGENTS.md.pre-jig.<stamp>` before the first generated one lands.
  Each decision is one plain line: the note's `rule:` line, copied verbatim
  per [`2026-09-23-model-facing-english.md`](../rules/decisions/2026-09-23-model-facing-english.md),
  ending with the note's file name; the notes' directory is named once
  ([`2026-10-18-decision-scope.md`](../rules/decisions/2026-10-18-decision-scope.md));
  an accepted note with no `rule:` line does not bind and is reported as a
  gap — the generator never translates a title into one. A note marked
  `scope: repo` under its `rule:` line goes to the repository's own file
  instead (next item).
- **the checkout's `AGENTS.md`** (with `CLAUDE.md` → `AGENTS.md` beside it) —
  generated by the same run into the dotfiles checkout's root, untracked
  (`renderRepoAgentsMd` in `domain/claude/agents-md.ts`). It holds only the
  `scope: repo` decisions, under `## Decisions for this repository`, so every
  harness reads them when it works in this repository and nowhere else.
- **`CLAUDE.md`** → symlink, relative target `AGENTS.md`.
- **`skills/`**, **`rules/`** → two real directories jig manages, each
  holding one symlink per entry (`domain/claude/managed-dir.ts`, one
  reconciliation shared by both):
  - `skills/<name>` → `harness/skills/<name>`, for every directory
    there that holds a `SKILL.md` (`domain/claude/skills-dir.ts`; the
    tree's `README.md` and a directory without one get no link).
  - `rules/<name>` → `harness/rules/<name>`, for every subdirectory of
    `rules/` except `common`, `decisions`, `knowledge` and `research`
    (`domain/claude/rules-dir.ts`, `NOT_RULE_DIRS`, with the why): `common`
    is in AGENTS.md and a link would load it twice; the other three are
    Markdown for humans and would load as always-on rules. Since the
    language rules were folded into skills (2026-09-23) no such
    subdirectory exists, so the directory holds no links; the reconciliation
    stays so a future non-language rule directory would be delivered.

  Why directories of links and not one symlink per tree: Claude Code writes
  into `~/.claude/skills/` itself — it keeps `synced/<bucket-id>/…` there
  (skills synced from the claude.ai account) with a `.bucket-<id>` marker
  beside it, and updates that tree on its own. One symlink from
  `~/.claude/skills` into the harness would land those writes in git
  sources. On write, for each managed directory: the directory is created if
  missing (a symlink standing there — today yoki-switch's `.<x>-merged` — is
  replaced, its target left alone), missing links added, links pointing
  elsewhere replaced, links into the source tree that are no longer planned
  removed as stale, and anything else left alone and reported as "not
  jig's" — `synced/` and its marker are the expected case, named in the
  dry-run.
- **`agents/`** — a real directory of generated files, one per house or
  pack agent (`app/apply/claude-agents.ts`, since 0a0fe4d7). The sources name
  a house tier (`main`, `complex`, `executor`) that Claude Code does not know,
  so each file is the source with `model:` replaced by the alias the `claude`
  table of [`agents/models.json`](../agents/models.json) maps it to
  (`domain/claude/claude-agent.ts`), per
  [`2026-10-19-model-assignment.md`](../rules/decisions/2026-10-19-model-assignment.md).
  The links jig kept here before are replaced in place. A file jig wrote whose
  source is gone is removed; one edited since stays, named. A house agent
  outside the tier and effort vocabulary stops the apply; a pack agent that
  does not parse is left out with its reason.
- **`commands`** — retired
  ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)).
  A symlink, or a directory whose entries are all symlinks, is removed on
  write; a directory holding any regular file is a conflict and is not
  touched.

Each symlink destination — `CLAUDE.md` and every entry of the managed
directories — is planned by `domain/claude/links.ts` from what `lstat` finds
there and printed one line per destination: `ok` (already the planned link),
`create`, `replace` (a symlink elsewhere — the old target is shown; what it
pointed at is untouched), or `backup-then-create` (a regular file or a real
directory: renamed to `<path>.pre-jig.<YYYYMMDD-HHMMSS>`, UTC, then linked —
user content is never deleted). The dry-run prints a `links` section for
`CLAUDE.md`, then a `skills directory:` and `rules directory:` section of
the same shape: the directory's own state, the count
of entries to link, one line per entry (planned, stale, or not jig's), and
the source entries that get no link with why. On the machine yoki-switch
left, that read: `CLAUDE.md` backup-then-create; `skills`, `agents` and
`rules` directories replace (currently → `.<x>-merged`) with every entry
`create`; `commands` remove. (`agents/` has since become the directory of
generated files above.)

The skill router (`hooks user-prompt-submit`, `serve`, `skills hide|show`)
reads its default root from `<config dir>/skills`, the directory Claude Code
itself loads from (`~/.claude/skills`, or under `CLAUDE_CONFIG_DIR` when that
is set). `JIG_SKILL_ROOT` still overrides it. Each router log row carries the
session id and the prompt's leading slash command, if any, and no other part
of the prompt.

External skill packs (`../plugins/<name>/source.json`,
`src/domain/plugins/`, `src/app/apply/plugins.ts`) join the skills and agents
directories: `~/.claude/skills` and `~/.agents/skills` link the pack's
skills, and `~/.claude/agents` and omp's agents directory get a generated file
per pack agent, from its checkout under
`resolvePluginsDir` (`JIG_PLUGINS_DIR`, else `$XDG_DATA_HOME/jig/plugins`,
else `~/.local/share/jig/plugins`) beside the house's own. A house entry of
the same name wins and the pack's shows under "not linked"; a pack not
fetched yet links nothing and its leftover links go as stale. jig never
fetches: `dotctl setup plugins` does, before the apply in `make up`. When the
pack names an `adapter`, the apply warns about any of its Cursor-side names
missing from `translated`.

Not touched in milestone 2: `~/.claude/{hooks,scripts,workflows}` and every
`.<x>-merged` staging directory stayed with `yoki-switch` until milestone 4
(below: `scripts` and `workflows` join the managed directories, `hooks` and
the staging directories go through `jig retire yoki`).

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
- **`~/.codex/skills/`** — not managed by jig. Codex reads every skill from
  `~/.agents/skills` like pi and omp, and the Codex-specific ports
  (`skills/<name>/codex/SKILL.md`, once `grilling` and
  `code-graph-exploration`) were dropped on 2026-09-23: a port was a second
  `SKILL.md` for the same skill, and Codex "doesn't merge" two skills of one
  `name` (build-skills doc), so the skill appeared twice. Nothing is
  delivered into the directory and nothing in it is removed; the dry-run
  lists what stands there today — yoki's two port links (into the retired
  tree), its sixteen `cmd-*` directories (the command→skill conversion,
  redundant now that commands are skills), and Codex's bundled `.system/` —
  under a `yoki leftovers (milestone 4) — not managed by jig` heading, each
  with whose it is, for the hand cleanup.
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
  dropped field should be visible. `model:` is a house tier (`main`,
  `complex`, `executor`) and Codex wants one of its own ids, so the tier is
  looked up in the `codex` table of
  [`agents/models.json`](../agents/models.json)
  (`domain/claude/agent-models.ts`; documented in
  [`agents/README.md`](../agents/README.md)), per
  [`2026-10-19-model-assignment.md`](../rules/decisions/2026-10-19-model-assignment.md):
  `complex` → `gpt-6-sol`, `main` and `executor` → `gpt-6-luna`; the file's
  `_comment` carries the sources. `model_reasoning_effort` is the agent's
  own `effort:` (`agent-definition.ts`) when it has one, else the override's
  `reasoningEffort` below; the table carries none. An agent may
  override its entry with a `models: { codex: { model, reasoningEffort } }`
  block in its frontmatter, which wins over the tier. A house agent whose
  `model:` or `effort:` is outside the vocabulary stops the apply
  (`checkAgentVocabulary`); a pack agent's model name the table does not know
  leaves `model` out (Codex applies its default; an absent `model:` inherits,
  which is not a gap) and the dry-run counts it; a `reasoningEffort` outside
  the config reference's `low | medium | high | xhigh | max | ultra` is
  refused before anything is written. The table reaches the use-case as
  `CodexApplyOptions.codexModels`, read once at the composition root, so the
  tests inject a map and the CLI reads the file. Files there that no source
  produces are not jig's.
- **`~/.codex/config.toml`** — `[mcp_servers.<id>]` for every server with
  `targets.codex: true` (`targetOverrides.codex` applied, `{{HOME}}`
  substituted; stdio: `command`, `args`, `env`; HTTP: `url`), and the
  status line as `[tui].status_line` (`domain/codex/config.ts`). Codex
  rewrites this file itself — trusting a project or a hook, counting a model
  notice, `codex mcp add` — and regroups its tables by parent key on every
  write, which leaves comment markers enclosing the wrong lines (reproduced
  with codex-cli 0.160.0). So jig finds what it owns by table name
  (`domain/codex/toml-sections.ts`): every `[mcp_servers.<id>]` it writes now
  or wrote last time (the names are in the manifest) goes wherever it
  stands, the status line joins the file's own `[tui]` when it has one, and
  the tables are appended between `# jig:begin mcp` … `# jig:end mcp`
  markers that are a courtesy to the reader, never relied on.
  `jig codex register` does the same for its `[hooks.state."<key>"]` trust
  entry. Every other table is carried through byte for byte. The hand-edit
  check compares jig's tables by value (`ownedView`: Codex drops `args = []`
  and moves tables, neither of which is an edit) against the by-value hash
  the manifest keeps; a value someone changed is a conflict that stops the
  write. Tables under jig's names that jig never wrote (yoki's, or written by
  hand) are a conflict too, not taken over. `[permissions.yoki]` and
  `[permissions.yoki.filesystem]`, and yoki's block as a whole, are reported
  as leftovers for milestone 4.
- **`~/.codex/hooks.json`** — `jig codex register`'s. The dry-run says so and
  nothing touches it here.

`--write` writes all of it in one run — the generated files, the block, the
manifest and provenance, then the two directories — and any conflict
anywhere (a hand-edited generated file, a changed or foreign table under
jig's names) returns `wrote: false` with nothing written.

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
  omits the key and omp grants its default set. `model:` is a house tier
  and omp wants a provider-qualified selector or a `modelRoles` alias, so
  the tier is looked up in the `omp` table of `agents/models.json`
  (`OmpApplyOptions.ompModels`, read at the composition root), which maps
  each tier to `proxy/<tier>`: the LiteLLM proxy's tier of the same name.
  The agent's own `effort:` becomes omp's `thinking` key; a mapping's
  `reasoningEffort` is ignored here. A house agent outside the vocabulary
  stops the apply, as for Codex; a pack agent's unknown model is left out
  and counted. A `models: { omp: { model } }` block in an agent's frontmatter
  overrides its entry. The generated frontmatter is validated as YAML before
  writing.
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
- **`~/.omp/agent/config.yml`** — jig's keys only, every other key carried
  through as omp wrote it (`domain/omp/config.ts`, since fb2503ac; ruled by
  the owner on 2026-09-27). omp rewrites this file itself, so ownership is
  by key, and hand-edit detection looks at jig's keys alone. jig owns:
  `modelRoles` (the thinking roles `slow`, `plan`, `advisor`, `designer` on
  `complex`, every other role on `main`, per
  [`2026-10-19-model-assignment.md`](../rules/decisions/2026-10-19-model-assignment.md));
  `tools.approvalMode` (`yolo`) and `tools.approval.eval` (`prompt`, per
  [`2026-09-27-eval-stays-prompt-under-yolo.md`](../rules/decisions/2026-09-27-eval-stays-prompt-under-yolo.md));
  `retry.modelFallback` off and `retry.maxRetries` 0, since LiteLLM is the
  one retry layer; and `statusLine`. `symbolPreset`, `composer`, `theme` and
  `setupVersion` are written only when the file does not exist yet.
- **Report only.** `yoki-hooks.json`, `RULES.md` and `.yoki/` under the
  agent directory are yoki's, listed with what each is and removed by
  `jig retire yoki`. Skills and the instructions file
  reach omp natively — `~/.agents/skills` above, and `~/.claude/CLAUDE.md`
  (→ `AGENTS.md`) through omp's `claude` provider; jig writes no
  `~/.omp/agent/AGENTS.md`, which would shadow it. Language guidance reaches
  omp inside the language skills (`skills/<lang>-*`, the mount above); there
  is no separate rules delivery to any harness
  ([`2026-09-23-language-rules-fold-into-skills.md`](../rules/decisions/2026-09-23-language-rules-fold-into-skills.md)).

`--write` writes all of it in one run — the generated files, `mcp.json`,
`config.yml`'s keys, the manifest and provenance, then the skills mount and
the extension link —
and any conflict anywhere (a hand-edited generated file, a changed jig entry
in `mcp.json`, an unreadable `mcp.json`, a regular file where the
`extensions` directory should be) returns `wrote: false` with nothing
written.

### Milestone 3c: pi

```sh
bun src/cli/jig.ts apply --target pi            # dry-run: models.json, then the agent directory
bun src/cli/jig.ts apply --target pi --write    # writes both halves in one run; any conflict aborts the second
```

`--target pi` names one harness, so it runs both halves: the tiers write into
the checkout's `home/shared/harness/pi/models.json` from `policy/tiers.json`
(the part `--target all` has always run, unchanged), then the agent-directory
half below (`app/apply/apply-pi.ts`), which is never part of `--target all`
for the reason the other three are not. The agent directory is resolved the
way pi resolves it (`domain/pi/agent-dir.ts`, from
[configuration](https://pi.dev/docs/latest/configuration) and
[environment-variables](https://pi.dev/docs/latest/environment-variables)):
`~/.pi/agent`, or `PI_CODING_AGENT_DIR` as a whole replacement. The formats
are pi's own documentation and pi-mcp-adapter's README, cited where each is
fixed in code. The facts about pi that the delivery rests on are in the
[MCP list decision](../rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md)
(no MCP client; pi-mcp-adapter is the de facto adapter), the
[commands-are-skills decision](../rules/decisions/2026-09-22-commands-are-skills.md)
(skill discovery paths, `/skill:name`), and the yoki-switch migration map
§2 and §6.3 (what `core/config/manager.sh link_pi_resources` linked, file by
file, never a directory, because pi writes its own files into `~/.pi/agent`;
home-manager does that now, `home/shared/harness/default.nix`).

Destinations, one source tree:

- **`~/.agents/skills/`** — the directory the Codex and omp targets deliver,
  from the one function all three call (`planAgentsSkillsMount`); whichever
  target runs first creates the links and the others find every entry `ok`.
  pi reads it natively ([skills](https://pi.dev/docs/latest/skills): "Pi also
  supports the Agent Skills locations `~/.agents/skills/` and
  `.agents/skills/`") and registers each as `/skill:name`, so jig creates no
  `~/.pi/agent/skills/`.
- **`~/.pi/agent/AGENTS.md`** — the same generated content as
  `~/.claude/AGENTS.md` and `~/.codex/AGENTS.md`, from the same renderer;
  pi reads it from the agent directory
  ([configuration](https://pi.dev/docs/latest/configuration): "User
  instructions applied across working directories"). Per the
  [config-layout decision](../rules/decisions/2026-09-22-config-layout-no-personal-layer.md)
  (Consequences, 2026-09-24; its location part is superseded by
  [`2026-09-24-harness-top-level-dir.md`](../rules/decisions/2026-09-24-harness-top-level-dir.md))
  the generated file is identical for all five harnesses and pi's short
  `home/shared/harness/pi/AGENTS.md` retires. Where the path is still a
  symlink to that repo file, `--write` removes the link and writes the
  generated regular file in its place — a symlink is `replace`, not a
  backup, and what it pointed at is untouched. The dry-run then names the
  repo file as a source-side cleanup for the owner (jig does not delete
  repository files); home-manager no longer links it, so the link does not
  come back. A regular file jig has no record of writing is
  kept as `AGENTS.md.pre-jig.<stamp>`, and a hand edit after jig wrote is a
  conflict, as everywhere.
- **`~/.config/mcp/mcp.json`** — jig's entries of `mcpServers` for every
  server with `targets.pi: true` (`targetOverrides.pi` applied, `{{HOME}}`
  substituted, `${VAR}` left for the adapter; stdio: `command`, `args`,
  `env`; http/sse: `url`, `headers`), in pi-mcp-adapter's shape
  (`domain/pi/mcp.ts`). pi has no MCP client and will not get one; the
  [MCP-list decision](../rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md)
  delivers the full list through that community extension, which reads
  this path as its "Preferred user-global shared config"
  ([README](https://github.com/nicobailon/pi-mcp-adapter), "Quick Start",
  "Config → File Layout") and is "lazy by default — [servers] won't connect
  until you actually call one of their tools", so a server costs nothing
  until called. The README's "Server Options" table documents no `type`
  field — the transport is which of `command`/`url` is set — so none is
  written, and a source `sse` server becomes a `url` entry the adapter
  reaches with its SSE fallback. Ownership is per entry, as in omp's
  `mcp.json` (the rule is one function, `domain/mcp/mcp-json.ts`, that both
  call): every entry no source produces and every other top-level key (the
  adapter's `settings`, a `$schema`) is carried through and named; no
  `$schema` is added. `/mcp disable` never edits this file (it writes
  `disabled` into the project's `.pi/mcp.json`, "the source file is never
  rewritten"), so a `disabled` inside a jig entry here is a hand edit and a
  conflict. `~/.pi/agent/mcp.json` is the adapter's own override file, with
  higher precedence ("later entries win"): it is reported as found and
  never written. Where neither file exists: one write, then noop.
- **Report only: `packages`.** The delivery relies on two extensions, and
  jig does not edit pi's settings in this milestone. The dry-run reads the
  REPO `home/shared/harness/pi/settings.json` — a source; `~/.pi/agent/settings.json`
  is a symlink to it — and says per package whether `packages` declares it
  (by pi's identity rule, package name at any version;
  [packages](https://pi.dev/docs/latest/packages), "Understand scope and
  identity"): `pi-mcp-adapter`, without which the entries above reach
  nothing, and `@tintinweb/pi-subagents` (`domain/pi/packages.ts`). For each
  that is missing it prints the `pi install npm:<name>` line ("Personal
  installs are written to `~/.pi/agent/settings.json`") and the
  `"npm:<name>"` entry to add by hand. **Not implemented yet:** the accepted
  [`2026-10-19-swarm-on-native-subagents.md`](../rules/decisions/2026-10-19-swarm-on-native-subagents.md)
  replaces tintinweb's package with `nicobailon/pi-subagents` and has jig
  write the house agents into `~/.pi/agent/agents/` (and a Cordis preset for
  DSH). The code still checks for tintinweb's package and delivers no agents
  to pi or DSH.
- **Report only: `~/.pi/agent/extensions/`.** Every symlink into
  `home/shared/harness/pi/extensions/` is named as delivered by home-manager
  (`home/shared/harness/default.nix`); everything else (orca's own `*.ts`
  files today) as not jig's. Nothing is linked or unlinked by jig.
- **Two gaps, one line each.** Subagents: jig delivers no agent definitions
  to pi yet (the `packages` item above says what the accepted decision
  requires). Language guidance: inside the language skills, as for omp.

`--write` writes both halves in one run — `models.json`, then AGENTS.md
(the link removed first), the adapter config, the manifest and provenance,
then the skills mount — and any conflict in the agent-directory half (a
hand-edited AGENTS.md, a changed jig entry in the adapter config, an
unreadable adapter config) returns `wrote: false` for that half with nothing
of it written; the exit code is 1 when either half conflicts.

### Milestone 3c: dsh

```sh
bun src/cli/jig.ts apply --target dsh            # dry-run: settings.yaml's block, then the harness home
bun src/cli/jig.ts apply --target dsh --write    # writes both halves in one run; any conflict aborts the second
```

`--target omp` likewise runs the tiers half first: the `proxy:` provider
block of the checkout's `home/shared/harness/omp/models.yml`, between the
same `# BEGIN jig:tiers` / `# END jig:tiers` markers dsh uses
(`domain/tiers/write-omp.ts`, since 2026-09-24 — the hand-written block
before it carried no `contextWindow` / `maxTokens`, so omp assumed its
defaults, 128k / 16k, for the 1M-token tiers). Then the agent-directory half
above.

`--target dsh` names one harness, so, as `--target pi` does, it runs both
halves: the tiers write into the checkout's `home/shared/harness/dsh/settings.yaml`
from `policy/tiers.json` (the part `--target all` has always run, unchanged),
then the harness-home half below (`app/apply/apply-dsh.ts`), never part of
`--target all`. The home is resolved the way DSH resolves it
(`domain/dsh/home.ts`, from `@deepseek-ai/dsh-home-paths`' README: `$DSH_HOME`,
a blank value ignored, else `~/.dsh` — the rule `link_dsh_resources` reads
too). The formats are DSH's own package READMEs at 0.1.5-rc.2 — the
installed copies under `~/.dsh/profiles/node_modules/@deepseek-ai/`, which
is the running version — cited where each is fixed in code; the facts the
delivery rests on are also in the
[MCP list decision](../rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md)
§Q2 (the Cordis row shape, eager loading) and the yoki-switch migration map
§6.5 (the profile tree, expanded copies, never creating a profile).

DSH composes a profile as patches over an empty entry list: each bundle's
patch in `dsh.profile.bundles` order, then the profile's own
`cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`, then
`--patch` overlays (dsh README, "Profiles"). A patch file is "a top-level
YAML array of loader patch entries (id-targeted config overrides, disables,
and insert lists; `!!js` expressions allowed)" — DSH's own comment in the
file it scaffolds — applied "in order" (`applyEntryPatches`,
cordis-plugin-include): a row with `id:` replaces that entry's whole config
("does not deep-merge"), a row with `insert:` appends entries. So the rows
ARE mergeable, and the answer to "whole file or rows" is rows: jig owns one
`- insert:` row and nothing else in the file.

Destinations, one source tree:

- **`$DSH_HOME/profiles/<name>/cordis.patch.yml`** — for every profile that
  DSH has scaffolded there AND the repo owns
  (`home/shared/harness/dsh/profiles/<name>/cordis.patch.yml` exists), the
  rule `jig setup` applies too. Profiles are pnpm workspaces DSH
  scaffolds itself; jig never creates one, and a repo profile DSH has not
  scaffolded is named and gets nothing. `node_modules` under `profiles/` is
  DSH's shared module fallback, not a profile. When no profile matches, DSH
  is not scaffolded and the target delivers nothing at all — not even
  AGENTS.md, which would create the home. Into each matching file goes one
  `- insert:` patch row holding one `@deepseek-ai/dsh-mcp-client` entry per
  server with `targets.dsh: true` (`domain/dsh/mcp.ts`; `targetOverrides.dsh`
  applied, `{{HOME}}` substituted because DSH reads paths literally — the
  reason `install_expanded` exists), between `# jig:begin mcp` and
  `# jig:end mcp` at the end of the file (`domain/dsh/cordis-patch.ts`).
  Per the [MCP-list decision](../rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md)
  DSH gets only serena, codebase-memory-mcp and context7: its client is
  eager — "The tool descriptions and input schemas enter every request
  while the tools are registered" (dsh-mcp-client README, "Model
  Experience") — and the set is chosen in `mcp/servers.json`, not in code.
  Each entry carries the README's fields: `serverName`, `transport`
  (`stdio`, or `streamable-http` for a source `http`/`sse` server — the only
  remote transport documented), `command`/`args`/`env` or `url`/`headers`;
  ids are `mcp-<name>`, the README's own convention. Every string is
  single-quoted, except that a `${VAR}` reference — which DSH does not
  expand — is rendered as the documented `!!js` expression (`!!js
  process.env.VAR`, or the template form `!!js '`Bearer
  ${process.env.TOKEN}`'`). Every other row — the repo's
  `agent-default-model` override and `jig-guard` insert that `jig setup`
  installs, anything hand-added, every comment — is carried through byte
  for byte: the file is spliced as text and never re-serialised. The
  scaffold's lone `[]` (DSH: "an empty or comments-only file fails boot —
  disable the layer with `[]` instead") gives way to the block, and comes
  back if the block is ever removed from a file that then holds only
  comments. Hand-edit detection compares the block, not the file, per
  profile in the manifest: a hand edit inside the block is a conflict; a
  jig id or `serverName` declared outside it (by hand, or in the home-level
  layer) is a conflict naming the line, because a duplicate id fails boot
  ("duplicate loader entry id") and a duplicate server name drops the later
  row — the one-time manual reconciliation the config-layout decision keeps
  out of the generator; an unterminated block is one too. `jig setup
  --target dsh` overwrites the file with the expanded repo copy and drops
  the block, then runs `apply --target dsh --write` itself; the dropped
  block reads as "write again", never as a conflict. On this machine both
  `headless` and `proxy` are scaffolded with the repo's rows and the plugin
  linked: two writes, then noop.
- **`$DSH_HOME/AGENTS.md`** — the same generated content as
  `~/.claude/AGENTS.md`, from the same renderer, with the same hand-edit
  detection and first-write backup. DSH reads it: "The first request
  includes one durable baseline message with the user-global
  `$DSH_HOME/AGENTS.md` followed by the project chain" (dsh-agent-instructions
  README; `dsh-base` enables it by default with a 65,536-byte `maxBytes`
  over the whole chain, and "broader files are omitted before the most
  specific file is truncated"), so the dry-run prints the size against that
  budget and warns past it — this file is the broadest, so it is the first
  DSH drops. On this machine the file does not exist yet: one write.
- **Report only: skills.** DSH reads `~/.agents/skills` natively
  (dsh-skill-filesystem README: the `user-agents` root `<agentsHome>/skills`,
  `agentsHome` = `$DSH_AGENTS_HOME` or `~/.agents`, rank 500, beside
  `<dshHome>/skills` at rank 400). The mount is the Codex/omp/pi targets'
  delivery, one plan (`planAgentsSkillsMount`); this target reports its
  state and plans nothing there. Promoting `dsh` into
  `AGENTS_SKILLS_MOUNT_TARGETS` would be a one-line change if wanted.
- **Report only: home-manager's and `jig setup`'s.** `settings.yaml` (the
  link to the repo file the tiers half writes, made by home-manager),
  `hooks.claude.json` (the expanded copy for the `dsh-hooks-claude-code`
  bridge, which the profiles no longer compose), and the jig-guard plugin
  (`bun run build` in `adapters/dsh`, then `pnpm add link:` into each
  profile — reported per profile as linked or not); the last two are
  `jig setup`'s (`app/setup/setup-harness.ts`). The home-level
  `$DSH_HOME/cordis.patch.yml` is reported as found, scanned for a jig
  duplicate, and never written. Language guidance: inside the language
  skills, as for omp and pi.

`--write` writes both halves in one run — `settings.yaml`'s block, then each
profile's patch file, AGENTS.md, the manifest and provenance (into
`$DSH_HOME`) — and any conflict in the harness-home half returns `wrote:
false` for that half with nothing of it written; the exit code is 1 when
either half conflicts.

**`[unverified]`** — what DSH's own docs did not settle, printed by the
dry-run and marked in the code:

- `docs/config-catalog.md`, the "exhaustive source for every accepted
  field", was not fetched (404 on raw `main`); the dsh-mcp-client README's
  field table at 0.1.5-rc.2 is what the entries follow.
- A source `http`/`sse` server becomes `transport: streamable-http`, the
  only remote transport the README documents; whether an SSE-only server
  answers it is untested. No `targets.dsh` server uses either today.
- `!!js process.env.X` inside an inserted row's config: documented for
  entries (mcp-client README) and for patch files (dsh-app-boot README:
  "interpolate `!!js` expressions at boot"); the combination is not
  exercised, since no `targets.dsh` server carries `${VAR}` today. Bun's
  YAML parser reads the tag as its text, which the tests pin.
- Only `$DSH_HOME` is honoured; a home configured inside DSH's own settings
  ("an explicit configured path has the highest precedence",
  dsh-home-paths README) is not read, because jig reads no DSH settings
  file.
- Whether one row in the home-level `$DSH_HOME/cordis.patch.yml` could
  replace the per-profile rows for every profile at once — a ruling, not a
  guess; the delivery is per profile, as `jig setup`'s copies are.

### Milestone 4: `jig retire yoki`

```sh
bun src/cli/jig.ts apply --target claude            # now also plans ~/.claude/{scripts,workflows}
bun src/cli/jig.ts retire yoki                      # dry-run: every yoki artifact, per harness, with evidence
bun src/cli/jig.ts retire yoki --write              # removes what the dry-run listed; skips stay skipped
```

Two pieces. The first is two more managed directories of the Claude target,
same mechanism as `skills/`, `agents/` and `rules/`
(`domain/claude/managed-dir.ts`):

- **`~/.claude/scripts/`** — one link per regular file of `H/scripts/`
  (`domain/claude/scripts-dir.ts`; `README.md` gets none). The path is
  fixed by `settings.json`'s `statusLine.command:
  "~/.claude/scripts/statusline.sh"`, which the link keeps valid. jig owns
  that `statusLine` key whenever `H/scripts/statusline.sh` exists, so a new
  machine gets the status line too; without the script the key is carried
  as found.
- **`~/.claude/workflows/`** — one link per `*.js` of `H/workflows/` plus one
  for `lib/` when it is a directory (`domain/claude/workflows-dir.ts`). The
  scripts are the ones the
  [subagents decision](../rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md)
  keeps, minus the review and design-review scripts that the
  [review redesign](../rules/decisions/2026-10-19-review-redesign.md) retired
  in favour of the `change-review` skill and reviewer agents: research and implement
  today. Neither imports `./lib/…` and the source tree has no `lib/` now; the
  `lib` link is there for the day a script does.

Today both destinations are yoki-switch's symlinks to `.scripts-merged` and
`.workflows-merged`: `replace`, exactly as `skills` was. A source directory
that does not exist yet is a report line — `scripts directory: not planned
(no H/scripts yet)` — and nothing is planned for its destination, so the
yoki-switch link keeps serving `statusline.sh` until the files arrive. The
owner's moves are the prerequisite (jig does not move repository files):

- `domains/dev/config/claude-profiles/personal/scripts/statusline.sh` →
  `H/scripts/statusline.sh`
- `domains/dev/config/claude-profiles/core/workflows/{review,research,code-study,stocktake,design-review}.js`
  and `lib/` → `H/workflows/`

The second is the verb. `jig retire yoki` lists, and on `--write` removes,
the artifacts yoki and yoki-switch left that jig knows about, grouped per
harness, each line with what it is, the evidence it is yoki's, and the
action (`app/retire/retire-yoki.ts`; the classifiers in
`domain/retire/classify.ts`, the two text rewrites in
`domain/retire/codex-config.ts`). Everything is classified before anything
is removed; a path that does not match its evidence — a real file where a
link was expected, a staging directory that grew a regular file, a block
with no end marker, a `config.toml` that would not parse afterwards — is
`SKIP` with the reason, never forced, and the rest of the run goes on.

- **Claude Code**: `~/.claude/hooks` when it is a symlink to `.hooks-merged`
  (hooks have no jig successor — the five are settings.json-inline); each
  `.{skills,hooks,scripts,commands,agents,rules,workflows}-merged` staging
  directory when every entry is a symlink or it is empty, and — `hooks`
  excepted — while `~/.claude/<x>` no longer links to it (otherwise it is
  skipped with "run `jig apply --target claude --write` first"; on this
  machine `.skills-merged` is skipped for good: Claude Code wrote its
  `synced/` tree into it while `skills` still pointed there, and that is
  the owner's to move); `.yoki/` (yoki's permission set; the one tree whose
  regular files go); `.claude-packs`.
- **Codex**: `config.toml`'s `# yoki:begin … # yoki:end` block
  (`removeMarkedBlock`, the helper the two jig blocks use) and the
  `[permissions.yoki]` / `[permissions.yoki.filesystem]` tables wherever
  they stand, every other byte kept. Two tables the block holds are
  Codex's, not yoki's, and are lifted out and kept: `[features]` and
  `[features.multi_agent_v2]` — `hooks = true` is what makes Codex run
  hooks at all, jig's registered guard included, and dropping the block
  whole would switch the guard off silently. `hooks.json`'s groups whose
  commands reference `run-with-flags.js`, `$YOKI_ROOT` or `YOKI_`
  (parsed with `parseHooksDocument`, the reader `jig codex register`
  uses; jig's group and every other — orca's, herdr's — stay in order; an
  event left empty is dropped), and the `[hooks.state.…]` trust tables of
  those handlers (on this machine they sit inside the block; a kept group
  whose index shifts is reported, since re-trusting is Codex's prompt).
  `rules/yoki.rules` (by name and its `GENERATED by yoki` header);
  `.yoki/`; the sixteen `cmd-*` skill directories, each holding only the
  `SKILL.md` yoki wrote — no `cmd-*` `SKILL.md` carries a yoki marker (the
  frontmatter is `name`/`description`), so the evidence is yoki's own
  record, `.yoki/codex-manifest.json`, with the inventory's sixteen names
  as the fallback when that manifest is gone (a manifest that exists and
  does not list a directory is the last word); the two port links
  (`grilling`, `code-graph-exploration`) into `claude-profiles/`.
  `~/.codex/skills/.system` and the directory itself stay.
- **omp**: `yoki-hooks.json`, `RULES.md` (by its `<!-- yoki:begin -->`
  header), `.yoki/`, and `extensions/{yoki-bridge,yoki-guard}.ts` when they
  are symlinks into `home/shared/harness/omp/extensions/` or
  `claude-profiles/`. `config.yml` stays: `apply --target omp` owns jig's
  keys of it.
- **Cursor**: every `~/.cursor/rules/*` symlink into
  `claude-profiles/runtime/yoki/.cursor/rules/` (39 today); the count of
  other entries is reported and they stay, as does the directory.

Removal order on `--write`: files and links first, then `config.toml` and
`hooks.json` (each renamed to `<file>.pre-retire.<YYYYMMDD-HHMMSS>` before
the new text lands atomically), directories last — a `cmd-*` directory's
`SKILL.md` is gone before the then-empty directory is. The adapter's three
removal verbs (`app/retire/ports.ts`, `infra/apply/node-apply-fs.ts`) each
refuse any other kind of path than the one they are named for, and
`removeTree` refuses a tree holding a regular file anywhere outside
`.yoki/`; a refusal is recorded per item (exit 1) and the run continues.

Never touched by this verb: `~/.claude.json` and `~/.claude/settings.json`
(the Claude target's, and the latter's `statusLine.command` keeps working
through the `scripts` link); `~/.claude/{scripts,workflows}` (that target's
too); Codex's `.system/`; omp's `config.yml` (the omp target's); and the
repository trees the removed links point into — jig deletes no repository
file. Not in this verb: pi's `extensions/` and settings links and DSH's
`settings.yaml` (home-manager's), and DSH's `hooks.claude.json` and guard
plugin (`jig setup`'s), which the pi and DSH targets report.

The order that leaves nothing dangling: the owner's two moves; `jig apply
--target claude --write` (replaces the `scripts`/`workflows` links); `jig
retire yoki --write`; then `jig apply --target codex --write`, whose
`[mcp_servers.*]` conflict with yoki's block resolves once the block is
gone, and `jig codex register --write` if Codex asks to re-trust.
