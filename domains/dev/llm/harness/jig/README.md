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
| 3a | Codex: `~/.agents/skills` as a managed link directory (`~/.codex/skills` reported, not managed), `~/.codex/AGENTS.md`, `~/.codex/agents/*.toml` with the model from `agents/models.json`, jig's MCP block in `~/.codex/config.toml` | **done** |
| 3b | omp: the same `~/.agents/skills` mount (one plan shared with 3a), `~/.omp/agent/agents/*.md`, jig's entries in `~/.omp/agent/mcp.json`, `~/.omp/agent/extensions/jig.ts` → jig's omp extension; `config.yml` reported, not owned | **done** |
| 3c-pi | pi: the same `~/.agents/skills` mount (one plan shared with 3a/3b), `~/.pi/agent/AGENTS.md` as the same generated file (replacing today's symlink into the repo), jig's entries in pi-mcp-adapter's `~/.config/mcp/mcp.json`; `packages` and `extensions/` reported, not owned | **done** |
| 3c-dsh | DSH: jig's `@deepseek-ai/dsh-mcp-client` rows (serena, codebase-memory, context7 — the `targets.dsh` set) in each scaffolded-and-repo-owned profile's `$DSH_HOME/profiles/<name>/cordis.patch.yml`, every other row carried through; `$DSH_HOME/AGENTS.md` as the same generated file; skills, the home-level patch, `settings.yaml`, `hooks.claude.json` and the guard plugin reported, not owned | **done** |
| 4 | `~/.claude/{scripts,workflows}` as two more managed directories of the Claude target, and `jig retire yoki [--write]`: the yoki / yoki-switch artifacts on the machine, listed with evidence and removed on `--write` — the staging directories, state, links, Codex's block and hook groups, omp's files, Cursor's links | **done** (2026-09-23: sources moved, `retire yoki --write` run, `claude-profiles/` and `yoki-switch` deleted — see [Milestone 4](#milestone-4-jig-retire-yoki)). `core/config/manager.sh`'s `link_*` functions for pi and DSH stay, now calling `jig apply` |

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
| `merge_dir()` (yoki-switch:352-390) — the `.{dir}-merged` staging dirs behind `skills`/`hooks`/`commands`/`agents`/`rules`/`workflows`/`scripts` | one flat source tree, delivered by symlink; no `commands/` at all ([commands are skills](../rules/decisions/2026-09-22-commands-are-skills.md)); `scripts` and `workflows` as managed directories, and the staging dirs themselves, `~/.claude/hooks`, `.yoki/` and `.claude-packs` removed by `jig retire yoki` | 2, 4 |
| `link_external_resources()` (yoki-switch:411-452) and `external-links.yaml` | folded into the flat tree | 2 |
| `.claude-packs` / `packs.default` / `pack enable\|disable` | gone — rules are selected by `paths:` frontmatter, skills by the judgment service | 2 |
| `apply_target_generator()` (yoki-switch:670-706) → `targets/gen.js` for codex: `codex-agents.js`, `codex-skills.js`, the `# yoki:begin` block of `config.toml`, the `~/.agents/skills` links | `app/apply/apply-codex.ts` + `domain/codex/{agents,config}.ts` and `domain/claude/agent-models.ts`, with the milestone-2 delivery verbs shared through `app/apply/delivery.ts`; `codex-skills.js` has no successor (no Codex-specific skills) — its `cmd-*` directories, the two port links, the block, `[permissions.yoki]`, `rules/yoki.rules`, `.yoki/` and the hook groups in `hooks.json` are removed by `jig retire yoki` | 3a, 4 |
| `targets/gen.js` for omp: `omp-agents.js` + `omp-tool-names.js`, `omp-mcp.js`, the `~/.agents/skills` links, `link_omp_resources` in `core/config/manager.sh` | `app/apply/apply-omp.ts` + `domain/omp/{agents,mcp,agent-dir}.ts`, the mount through `app/apply/delivery.ts`'s `planAgentsSkillsMount` (shared with 3a) | 3b |
| `targets/gen.js` for omp: `omp-config-yml.js`, `omp-rules-md.js`, `omp-hooks.js` (`config.yml`, `RULES.md`, `yoki-hooks.json`, the `yoki-*.ts` extension links) | `RULES.md`, `yoki-hooks.json`, `.yoki/` and the two `yoki-*.ts` links removed by `jig retire yoki`; `config.yml` left, its ownership a ruling not made | 4 |
| `link_cursor_rules` — `~/.cursor/rules/*` → `claude-profiles/runtime/yoki/.cursor/rules/` | nothing delivered (Cursor is not a jig target); the links removed by `jig retire yoki` | 4 |
| `link_pi_resources` in `core/config/manager.sh`: the `AGENTS.md` link | `app/apply/apply-pi.ts`: the generated file over the link, `domain/pi/{mcp,packages,agent-dir}.ts` for the rest; the mount through `planAgentsSkillsMount` (shared with 3a/3b) | 3c-pi |
| `link_pi_resources`: the `settings.json`/`models.json` links, the `extensions/*.ts` and `themes/*.json` file links | nothing yet — reported by 3c-pi (`extensions/`) or untouched (`settings.json` is read as the `packages` source; `models.json` is the tiers target's file) | 4 |
| `link_dsh_resources` in `core/config/manager.sh`: the profile discovery rule (scaffolded AND in the repo) | `app/apply/apply-dsh.ts`, the same rule, plus what manager.sh never did — the MCP rows (`domain/dsh/{mcp,cordis-patch}.ts`) and `AGENTS.md` | 3c-dsh |
| `link_dsh_resources`: the `settings.yaml` link, the `hooks.claude.json` expanded copy, the per-profile `cordis.patch.yml` expanded copy, the plugin build + `pnpm add link:` | nothing yet — reported by 3c-dsh; the expanded copy still overwrites jig's block on each run, which reads as "write again" | 4 |

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

Sources, all under `llm/harness/`: `skills/<name>/SKILL.md` (one flat tree;
language guidance lives here, in `skills/<lang>-*`), `rules/common/*.md`
(always-on), `rules/decisions/*.md`, `agents/*.md`. There is no
`rules/<lang>/` and no `paths:`-scoped rule
([`2026-09-23-language-rules-fold-into-skills.md`](../rules/decisions/2026-09-23-language-rules-fold-into-skills.md)).

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
  - `rules/<name>` → `llm/harness/rules/<name>`, for every subdirectory of
    `rules/` except `common`, `decisions` and `research`
    (`domain/claude/rules-dir.ts`, `NOT_RULE_DIRS`, with the why): `common`
    is in AGENTS.md and a link would load it twice; the other two are
    Markdown for humans and would load as always-on rules. Since the
    language rules were folded into skills (2026-09-23) no such
    subdirectory exists, so the directory holds no links; the reconciliation
    stays so a future non-language rule directory would be delivered.

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
`.<x>-merged` staging directory stayed with `yoki-switch` until milestone 4
(below: `scripts` and `workflows` join the managed directories, `hooks` and
the staging directories go through `jig retire yoki`), and `~/.claude.json` is
never touched in any milestone.

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
  dropped field should be visible. `model:` is a Claude tier name
  (`sonnet`/`opus`/`haiku`) and Codex wants one of its own ids, so the tier
  is looked up in the `codex` table of
  [`agents/models.json`](../agents/models.json)
  (`domain/claude/agent-models.ts`; documented in
  [`agents/README.md`](../agents/README.md)), ruled on 2026-09-23 from
  Codex's model and pricing pages: `sonnet` → `gpt-6-luna` at
  `model_reasoning_effort = "high"`, `haiku` → `gpt-6-luna` at `medium`,
  `opus` → `gpt-6-sol` at `medium`; the file's `_comment` carries the
  prices and the sources. An agent may override its entry with a
  `models: { codex: { model, reasoningEffort } }` block in its frontmatter,
  which wins over the tier. A tier the table does not know leaves `model`
  out (Codex applies its default; an absent `model:` inherits, which is not
  a gap) and the dry-run counts it; a `reasoningEffort` outside the config
  reference's `low | medium | high | xhigh | max | ultra` is refused before
  anything is written. The table reaches the use-case as
  `CodexApplyOptions.codexModels`, read once at the composition root, so the
  tests inject a map and the CLI reads the file. Files there that no source
  produces are not jig's.
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
  and omp wants a provider-qualified selector or a `modelRoles` alias; the
  `omp` table of `agents/models.json` is empty until a ruling names one, so
  `model` is left out and the dry-run counts the gap per tier, exactly as
  the Codex target does (`OmpApplyOptions.ompModels`, the same file's `omp`
  object, read at the composition root; filling it is the whole change — a
  mapping's `reasoningEffort` is ignored here, the selector carries the
  effort). A `models: { omp: { model } }` block in an agent's frontmatter
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
- **Report only.** `yoki-hooks.json`, `RULES.md`, `.yoki/` and `config.yml`
  under the agent directory are yoki's, listed with what each is and left
  for milestone 4. jig does not own `config.yml` in this milestone: omp's
  approval policy, tool settings and model roles live there, and what jig
  should write is a ruling not yet made. Skills and the instructions file
  reach omp natively — `~/.agents/skills` above, and `~/.claude/CLAUDE.md`
  (→ `AGENTS.md`) through omp's `claude` provider; jig writes no
  `~/.omp/agent/AGENTS.md`, which would shadow it. Language guidance reaches
  omp inside the language skills (`skills/<lang>-*`, the mount above); there
  is no separate rules delivery to any harness
  ([`2026-09-23-language-rules-fold-into-skills.md`](../rules/decisions/2026-09-23-language-rules-fold-into-skills.md)).

`--write` writes all of it in one run — the generated files, `mcp.json`,
the manifest and provenance, then the skills mount and the extension link —
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
the checkout's `domains/dev/config/pi/models.json` from `policy/tiers.json`
(the part `--target all` has always run, unchanged), then the agent-directory
half below (`app/apply/apply-pi.ts`), which is never part of `--target all`
for the reason the other three are not. The agent directory is resolved the
way pi resolves it (`domain/pi/agent-dir.ts`, from
[configuration](https://pi.dev/docs/latest/configuration) and
[environment-variables](https://pi.dev/docs/latest/environment-variables)):
`~/.pi/agent`, or `PI_CODING_AGENT_DIR` as a whole replacement. The formats
are pi's own documentation and pi-mcp-adapter's README, cited where each is
fixed in code. The facts about pi that the delivery rests on are in
[`rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md`](../rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md)
(no MCP client; pi-mcp-adapter is the de facto adapter),
[`2026-09-22-commands-vs-skills.md`](../rules/research/2026-09-22-commands-vs-skills.md)
(skill discovery paths, `/skill:name`), and
[`2026-09-22-generator-migration-map.md`](../rules/research/2026-09-22-generator-migration-map.md)
§2 and §6.3 (what `core/config/manager.sh link_pi_resources` links today, file
by file, never a directory, because pi writes its own files into
`~/.pi/agent`).

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
  (Consequences, 2026-09-24) the generated file is identical for all five
  harnesses and pi's short `domains/dev/config/pi/AGENTS.md` retires. On
  the machine manager.sh left, the path is a symlink to that repo file: on
  `--write` the link is removed and the generated regular file written in
  its place — a symlink is `replace`, not a backup, and what it pointed at
  is untouched. The dry-run then names the repo file as a source-side
  cleanup for the owner (jig does not delete repository files) and says to
  drop `AGENTS.md` from `link_pi_resources`, which would otherwise put the
  link back on its next run. A regular file jig has no record of writing is
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
  never written. On the machine manager.sh left, neither file exists: one
  write, then noop.
- **Report only: `packages`.** The delivery relies on two extensions, and
  jig does not edit pi's settings in this milestone. The dry-run reads the
  REPO `domains/dev/config/pi/settings.json` — a source; `~/.pi/agent/settings.json`
  is a symlink to it — and says per package whether `packages` declares it
  (by pi's identity rule, package name at any version;
  [packages](https://pi.dev/docs/latest/packages), "Understand scope and
  identity"): `pi-mcp-adapter`, without which the entries above reach
  nothing, and `@tintinweb/pi-subagents`, the runner of the subagents
  decision. For each that is missing it prints the `pi install npm:<name>`
  line ("Personal installs are written to `~/.pi/agent/settings.json`") and
  the `"npm:<name>"` entry to add by hand. On the machine manager.sh left,
  both are missing.
- **Report only: `~/.pi/agent/extensions/`.** Every symlink into
  `domains/dev/config/pi/extensions/` is named as delivered by
  `core/config/manager.sh link_pi_resources` until milestone 4; everything
  else (orca's own `*.ts` files today) as not jig's. Nothing is linked or
  unlinked.
- **Two gaps, one line each.** Subagents: pi has none natively
  ([`2026-09-22-multi-lane-review-per-harness.md`](../rules/research/2026-09-22-multi-lane-review-per-harness.md):
  "Pi itself remains fundamentally single-agent"); the
  [subagents decision](../rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md)'s
  answer is a workflow script written once in Claude Code's syntax, which
  pi runs through tintinweb/pi-subagents when that package is installed —
  the `packages` check above. Language guidance: inside the language skills,
  as for omp.

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
block of the checkout's `domains/dev/config/omp/models.yml`, between the
same `# BEGIN jig:tiers` / `# END jig:tiers` markers dsh uses
(`domain/tiers/write-omp.ts`, since 2026-09-24 — the hand-written block
before it carried no `contextWindow` / `maxTokens`, so omp assumed its
defaults, 128k / 16k, for the 1M-token tiers). Then the agent-directory half
above.

`--target dsh` names one harness, so, as `--target pi` does, it runs both
halves: the tiers write into the checkout's `domains/dev/config/dsh/settings.yaml`
from `policy/tiers.json` (the part `--target all` has always run, unchanged),
then the harness-home half below (`app/apply/apply-dsh.ts`), never part of
`--target all`. The home is resolved the way DSH resolves it
(`domain/dsh/home.ts`, from `@deepseek-ai/dsh-home-paths`' README: `$DSH_HOME`,
a blank value ignored, else `~/.dsh` — the rule `link_dsh_resources` reads
too). The formats are DSH's own package READMEs at 0.1.5-rc.2 — the
installed copies under `~/.dsh/profiles/node_modules/@deepseek-ai/`, which
is the running version — cited where each is fixed in code; the facts the
delivery rests on are also in
[`rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md`](../rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md)
§Q2 (the Cordis row shape, eager loading) and
[`2026-09-22-generator-migration-map.md`](../rules/research/2026-09-22-generator-migration-map.md)
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
  (`domains/dev/config/dsh/profiles/<name>/cordis.patch.yml` exists), the
  rule `link_dsh_resources` applies. Profiles are pnpm workspaces DSH
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
  `agent-default-model` override and `jig-guard` insert that manager.sh
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
  out of the generator; an unterminated block is one too. Until milestone 4,
  `link_dsh_resources` overwrites the file with the repo copy on each run
  and drops the block; that reads as "write again", never as a conflict,
  and the dry-run says to re-apply after it. On this machine both
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
- **Report only: manager.sh's.** `settings.yaml` (the link to the repo file
  the tiers half writes), `hooks.claude.json` (the expanded copy for the
  `dsh-hooks-claude-code` bridge, which the profiles no longer compose), and
  the jig-guard plugin (`bun run build` in `adapters/dsh`, then `pnpm add
  link:` into each profile — reported per profile as linked or not) stay
  with `link_dsh_resources` until milestone 4. The home-level
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
  guess; the delivery is per profile as manager.sh's is.

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
  "~/.claude/scripts/statusline.sh"`, which the link keeps valid.
- **`~/.claude/workflows/`** — one link per `*.js` of `H/workflows/` plus one
  for `lib/` when it is a directory (`domain/claude/workflows-dir.ts`). The
  scripts are the ones the
  [subagents decision](../rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md)
  keeps: review, research, code-study, stocktake, design-review; preflight
  and the yoki-graph engine go. As of 2026-09-23 none of them imports
  `./lib/…` — `review.js`, `research.js` and `design-review.js` carry the
  provider-lane helpers inline, `lib/lanes.js` being the canonical copy
  (review.js:75) — so the `lib` link is there for the day one does, and
  resolves the same whichever way the Workflow tool loads the file.

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
  are symlinks into `domains/dev/config/omp/extensions/` or
  `claude-profiles/`. `config.yml` stays: a ruling not made.
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

Never touched: `~/.claude.json`; `~/.claude/settings.json` (the Claude
target's, and its `statusLine.command` keeps working through the `scripts`
link); `~/.claude/{scripts,workflows}` (that target's too); Codex's
`.system/`; omp's `config.yml`; and the repository trees the removed links
point into — jig deletes no repository file. Not in this verb:
`core/config/manager.sh`'s `link_pi_resources` and `link_dsh_resources`
(pi's `extensions/` and settings links, DSH's `settings.yaml`,
`hooks.claude.json` and the guard plugin), which the pi and DSH targets
still report.

The order that leaves nothing dangling: the owner's two moves; `jig apply
--target claude --write` (replaces the `scripts`/`workflows` links); `jig
retire yoki --write`; then `jig apply --target codex --write`, whose
`[mcp_servers.*]` conflict with yoki's block resolves once the block is
gone, and `jig codex register --write` if Codex asks to re-trust.
