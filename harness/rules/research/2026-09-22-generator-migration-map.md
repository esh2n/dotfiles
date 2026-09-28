---
question: "What does yoki-switch write today across five harnesses, and what must a new jig-based config generator absorb to replace it?"
date: 2026-09-22
verdict: "Fact-finding only (no design decisions): two independent scripts (yoki-switch + manager.sh) currently write config for five harnesses; a replacement generator must absorb both, replicate per-harness runtime-owned-key carryover (autoMode, Codex hooks.state), and several source categories (commands, non-formatting hooks, settings-merge semantics, ~/.claude.json) have no covering decision record yet."
unverified:
  - "harness-models.json/harness-roles.json are not referenced anywhere in yoki-switch — possibly orphaned from this script's perspective"
  - "no ruling explicitly covers non-formatting hooks (guards, loggers, routers, toggles) beyond format/lint/typecheck timing"
  - "no ruling found for commands/ (slash commands) at all"
  - "design-review.js and preflight.js workflow status is ambiguous under workflow-research-only.md's literal wording"
  - "decision says claude-mem plugin should be disabled but live settings.json still shows it enabled — possible drift"
  - "no ruling addresses whether the generator preserves yoki-switch's exact settings-merge algorithm (hook-array concat order, runtime-owned-key carryover) or redesigns it"
  - "no decision mentions ~/.claude.json (Claude Code's own MCP/plugin state file) at all"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# generator migration map — yoki-switch → new config generator

Fact-finding only. Read-only research from the main checkout
`<checkout>` (branch `main`), plus this
machine's live state. No design decisions here — see
`domains/dev/llm/harness/rules/decisions/*.md` for those.

---

## 1. What `yoki-switch apply` writes, per destination

Source: `domains/dev/bin/yoki-switch` (1039 lines, bash). **There is no
`core/config/manager.sh` delegation inside claude-profiles** — that filename
exists but as a *different* script at the repo root,
`<checkout>/core/config/manager.sh` (602
lines), which is a **separate, wider-scope linker** covering `pi`, `dsh`,
`omp` static files, launchd plists, and every `domains/*` directory — not
just the five AI harnesses. yoki-switch and manager.sh are two independent
entry points that both write into `~/.pi`, `~/.omp/agent` (manager.sh links
static bits, yoki-switch renders the generated bits — see below). **Any
generator replacing yoki-switch must also absorb manager.sh's
`link_pi_resources`, `link_dsh_resources`, `link_omp_resources`,
`link_jig_policy`, `link_launch_agents` or explicitly leave them alone.**

### 1a. Claude Code (`$CLAUDE_DIR = ~/.claude`)

| Destination | Source(s) | Mechanism | Function |
|---|---|---|---|
| `~/.claude/settings.json` | `core/settings.layer.json` × enabled `packs/*/settings.layer.json` × `personal/settings.personal.json`, plus `permissions.yaml` layers and `mcp.json` layers (see 1c/1d) | generated-merge (`jq -s`, personal wins scalars, packs win over core) | `merge_settings()` yoki-switch:200-327 |
| `~/.claude/CLAUDE.md` | `core/CLAUDE.layer.md` + `personal/CLAUDE.personal.md` (concatenated, core first) | copy/concat | `merge_claude_md()` yoki-switch:332-346 |
| `~/.claude/skills`, `hooks`, `commands`, `agents`, `rules`, `workflows`, `scripts` | `core/<dir>` → enabled `packs/*/<dir>` → `personal/<dir>` (`MERGE_DIRS` array, yoki-switch:139) | per-item symlink into a staging dir `.{dir}-merged`, then the top-level name is a symlink to that staging dir (double indirection) | `merge_dir()` yoki-switch:352-390 |
| Machine-specific extra links (declared in `external-links.yaml`, e.g. `commands/prompts`) | `core/external-links.yaml` + `packs/*/external-links.yaml` + `personal/external-links.yaml`, resolved via `lib/external-links.js` | symlink, added into the already-built `.commands-merged` staging dir | `link_external_resources()` yoki-switch:411-452 |
| `~/.claude/.yoki/permissions.json` | `permissions.yaml` layers via `lib/permissions/to-claude.js` | generated (hook-enforced deny set, separate from settings.json) | inside `merge_settings()` yoki-switch:309-313 |
| `~/.claude/.claude-packs` | `packs.default` (seed only, one-time) | copy | `enabled_packs()` yoki-switch:154-172 |
| `~/.cursor/rules/*` | `runtime/yoki/.cursor/rules` (vendored ECC cursor rules) | symlink per item | `link_cursor_rules()` yoki-switch:457-469 |
| `~/.claude/.claude-profile` | literal string `"packs"` | write | yoki-switch:800 (legacy marker, unused) |
| **NOT written by yoki-switch**: `~/.claude.json` | n/a | n/a | Claude Code's own per-user state file (88 KB on this machine, mode 600) — holds `mcpServers` (2 entries here) written by `claude mcp add`, plus dozens of runtime keys (`feedbackSurveyState`, `cachedGrowthBookFeatures`, etc). `lib/mcp-inventory/writers/claude.js:12` and `readers/claude-code.js:12,59` explicitly document this as "a separate mechanism this writer must not duplicate." **Claude Code MCP servers therefore live in two places**: `settings.json.mcpServers` (yoki-switch-generated, from `mcp.json` layers) and `~/.claude.json.mcpServers` (Claude-Code-owned, untouched by the generator). |

### 1b. Codex / omp

Both are built by a **shared** generator, not per-target bash:
`apply_target_generator()` (yoki-switch:670-706) shells out to
`RUNTIME_DIR/scripts/lib/targets/gen.js --target <codex|omp> --sources
<core>,<enabled-packs>,<personal> --out <CODEX_DIR|OMP_AGENT_DIR>`. Skipped
entirely (one info line, no error) when the target's home dir does not
exist yet (yoki-switch:674-677). `gen.js`'s per-target modules live in
`domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/`:
`codex.js`, `codex-config-toml.js`, `codex-hooks-merge.js`,
`codex-toml-lite.js`, `codex-trust.js`, `codex-skills.js`,
`codex-agents.js`, `codex-agents-md.js`, `omp.js`, `omp-config-yml.js`,
`omp-yaml-lite.js`, `omp-hooks.js`, `omp-mcp.js`, `omp-agents.js`,
`omp-rules-md.js`, `omp-tool-names.js`, `layers.js`, `manifest.js`,
`managed-block.js`, `frontmatter.js`, `bash-wrapper-hook.js`, `vocab.json`.
Not individually traced line-by-line in this pass (out of budget) but the
naming makes the per-file ownership legible; a generator author should read
`gen.js` + `manifest.js` first for the file list each target actually
writes.

manager.sh separately owns **omp's static reference files** —
`models.yml`, `lsp.yml` (`link_omp_resources()`, manager.sh:391-406,
symlink) — and then itself shells out to `yoki-switch apply --target omp`
for the generated bits (`config.yml`, `yoki-hooks.json`, `RULES.md`,
`agents/*.md`, `extensions/yoki-bridge.ts`, `mcp.json`) — comment at
manager.sh:252-273 explains `config.yml` was **demoted from symlink to
generated file** because omp writes into it at runtime (`setupVersion`
bumps, theme changes) and a symlink meant every write landed in the tracked
repo file.

### 1c. Permissions (all targets)

Single source of truth is **not** the settings.layer.json files but
`permissions.yaml` per layer (`core/permissions.yaml`, `packs/*/permissions.yaml`,
`personal/permissions.yaml`). `lib/permissions/parse.js` parses a "tiny YAML
subset, no dependency"; `lib/permissions/to-claude.js --sources <files>`
unions + dedupes core → enabled packs → personal and prints
`{settings:{allow,deny,defaultMode}, hookEnforced:[...]}` (yoki-switch:223-249).
Missing per-layer file = empty layer, not an error.

### 1d. MCP servers (settings.json only, not `~/.claude.json`)

Single source of truth is `mcp.json` per layer (`core/mcp.json`,
`packs/*/mcp.json`, `personal/mcp.json`), converted by
`lib/mcp-inventory/writers/claude.js --sources <files>` (core → packs →
personal, later layer wins by name) into the `settings.json.mcpServers`
object (yoki-switch:250-269). This is a **generic MCP inventory** module
(`lib/mcp-inventory/`) with a `readers/claude-code.js` that can read
`~/.claude.json`'s `mcpServers` back out — implying the intended design is
"inventory in, per-harness writer out," reusable for Codex/omp/pi/dsh MCP
config too, though only the `claude.js` writer was confirmed read in this
pass.

### 1e. `hooks` key composition inside settings.json

`jq` merge concatenates arrays per event, in a **fixed order**: personal
entries first, then merged-pack entries, then core entries (yoki-switch:277-279,
291-296: "personal entries run FIRST — guards (git-guard) must see the
original command before any rewriter hooks (rtk-rewrite) touch it").
Non-hook keys use `*` (last-object-wins) merge: `layer * packsMerged *
personal` (yoki-switch:285-287) — so personal overrides packs overrides core
for every scalar/object key, **except** `permissions.*` (from `perm_json`,
already unioned), `hooks` (concatenated, not overridden), `mcpServers`
(from `mcp_json`, unioned), `enabledPlugins`/`extraKnownMarketplaces`/`env`
(shallow-merged `{} + {} + {}`, not concatenated — later layer's keys win,
whole objects don't replace). `.autoMode` is carried over from the previous
`settings.json` output verbatim (yoki-switch:317-326) because Claude Code
itself writes that key at runtime and a plain rewrite would drop it every
apply — **a runtime-owned-key preservation pattern the generator must
replicate for every harness that writes back into its own config file**
(omp's `config.yml` has the same problem, per 1b).

---

## 2. What is actually on this machine now

### Claude Code (`~/.claude`)

Top level (`ls -la ~/.claude`): six merged-dir symlinks
(`agents`/`commands`/`hooks`/`rules`/`scripts`/`skills` → `.{name}-merged`
staging dirs, all timestamped `22 Sep 13:29`, the last `yoki-switch apply`);
plus non-generator runtime state (`.claude-packs`, `.claude-profile`,
`.yoki/`, `history.jsonl` 1.1 MB, `projects/`, `sessions/`, `plugins/`,
`mcp-configs/`, `settings.json.bak`/`.bak.` backups, `daemon.log`,
`stats-cache.json`, `AGENTS.md` — a second, non-generated file living
alongside `CLAUDE.md`).

`~/.claude/settings.json` (python3 summary):
- top-level keys: `agentPushNotifEnabled, autoMode, cleanupPeriodDays,
  effortLevel, enabledPlugins, env, extraKnownMarketplaces, hooks, language,
  mcpServers, model, permissions, preferredNotifChannel,
  skipWorkflowUsageWarning, statusLine, switchModelsOnFlag, theme`
- hooks per event: `Notification:2, PostToolUse:7, PreCompact:1,
  PreToolUse:13, SessionStart:3, Stop:2, UserPromptSubmit:5` (33 total)
- `permissions.allow: 71`, `permissions.deny: 76`, `permissions.ask: 0`,
  `permissions.defaultMode: "auto"`
- `enabledPlugins`: `rust-analyzer-lsp@claude-plugins-official`,
  `claude-mem@thedotmack`, `crit@crit` (all `true`)
- `statusLine`: `{type: command, command: "~/.claude/scripts/statusline.sh"}`
- `sandbox`: key absent (`None`)
- `env` keys (16): `YOKI_ROOT, CLAUDE_PLUGIN_ROOT, YOKI_HOOK_PROFILE,
  YOKI_DISABLED_HOOKS, CLV2_HOMUNCULUS_DIR, CLAUDECODE,
  CLAUDE_CODE_ENABLE_TELEMETRY, DISABLE_COST_WARNINGS,
  BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS, SHELL, UV_CACHE_DIR,
  UV_PYTHON_PREFERENCE, DENO_DIR, CARGO_HOME, RUSTUP_HOME, GOPATH,
  NODE_OPTIONS`
- `mcpServers` (settings.json, 2): `figma-remote`, `figma-desktop`

`~/.claude.json` (sibling **file**, not under `~/.claude/`, 88 KB, mode 600,
not touched by yoki-switch): top-level keys include `mcpServers` (2 entries,
different from settings.json's) plus ~30+ Claude-Code-internal keys
(`feedbackSurveyState`, `cachedGrowthBookFeatures`, `autoModeEnvSetup`,
`fable5ToFableAliasMigrationTimestamp`, etc). No key contains
key/token/secret at the top level scanned.

`~/.claude/.claude-packs`: `go python react rust typescript web` (6 of 26
available packs enabled).

### Codex (`~/.codex`)

`config.toml` top-level tables (`grep '^\['`): `[permissions.yoki]`,
`[permissions.yoki.filesystem]`, `[features]`,
`[features.multi_agent_v2]`, `[shell_environment_policy.set]`,
`[mcp_servers.context7]`, `[mcp_servers.playwright]`,
`[mcp_servers.notion-mcp]`, `[mcp_servers.codebase-memory-mcp]`,
`[mcp_servers.serena]`, `[tui.model_availability_nux]`,
`[sandbox_workspace_write]`, plus ~30 `[hooks.state."...":event:n:m"]`
entries (runtime-written hook-execution bookkeeping, one per
hook-index-per-arg) and 7 `[projects."<path>"]` tables (per-project trust
state, includes stray sandbox scratch paths — runtime-accumulated cruft the
generator must not clobber or duplicate).

`hooks.json` (16 KB, separate file from `config.toml`): top-level key
`hooks`, a dict with 9 event keys: `SessionStart, PreToolUse,
UserPromptSubmit, PreCompact, PostToolUse, Stop, PermissionRequest,
SubagentStart, SubagentStop` — **two more event names than Claude Code's
settings.json hooks** (`PermissionRequest`, `SubagentStart`/`SubagentStop`
have no Claude Code equivalent in the 7 events counted above).

### pi (`~/.pi/agent`, `~/.pi/settings.json`)

`~/.pi/settings.json` is a **symlink** to
`domains/dev/config/pi/settings.json` (not staged/merged like Claude Code —
pi gets a direct file symlink, one file, no layering visible on this
machine). Top-level keys: `defaultProvider, defaultModel, enabledModels,
defaultThinkingLevel, showCacheMissNotices, compaction, packages,
lastChangelogVersion, theme`. `~/.pi/models.json` and `~/.pi/AGENTS.md` are
likewise direct symlinks to `domains/dev/config/pi/`. `~/.pi/agent/` itself
(mode `drwx------`, not listed by `ls -la` due to permissions in this scan)
holds pi's own extensions/themes per `link_pi_resources()` (see §1, top of
report) — file-by-file symlinks, never a directory symlink, because pi
writes its own files there (saved themes) that a directory-link would
capture into the repo.

### omp (`~/.omp/agent`, `~/.omp/`)

`~/.omp/models.yml` and `~/.omp/lsp.yml` are symlinks to
`domains/dev/config/omp/`; `~/.omp/config.yml`, `~/.omp/yoki-hooks.json`,
`~/.omp/RULES.md`, `~/.omp/mcp.json`, `~/.omp/agents/` are real
(non-symlink) generated files/dirs, per the "omp writes into it at runtime"
rationale in §1b.

### `~/.agents/skills` (shared skill mount for non-Claude harnesses)

Flat directory of ~50 symlinks, one per skill, pointing directly at
`domains/dev/config/claude-profiles/{core,packs/*,personal}/skills/<name>`
— this is the **cross-harness skill delivery mechanism** cited in decision
`config-layout-no-personal-layer.md`: "skills(Claude Code は `~/.claude/skills`、他は `~/.agents/skills`)".

### DSH — not installed on this machine

`which dsh` → not found; `~/.config/dsh` does not exist. See §6.

---

## 3. Source content inventory (`domains/dev/config/claude-profiles/`)

### `core/`
- `rules/`: 10 files (`common/` + `README.md`)
- `skills/`: 20 skill directories (raw file count 2428 is dominated by
  vendored assets inside two skills — `yoki-artifact` 230 MB,
  `writeup-kit` 23 MB, `grilling` 9.2 MB — not representative of "skill
  count"; treat directory count, not file count, as the real unit)
- `agents/`: 8 files
- `hooks/`: 0 files (core carries no hook scripts of its own — all hooks
  are personal or pack-owned)
- `commands/`: 11 files
- `workflows/`: 10 files
- `scripts/`: 0 files
- settings fragments present: `CLAUDE.layer.md`, `harness-models.json`,
  `harness-roles.json`, `mcp.json`, `permissions.yaml`,
  `settings.layer.json`. **`harness-models.json`/`harness-roles.json` are
  not referenced anywhere in `yoki-switch`** (grep confirmed 0 hits) —
  likely consumed by jig's model-tier routing instead; flag for the
  generator author as possibly-orphaned-from-this-script's-perspective.

### `packs/` (26 available, 6 enabled on this machine: go, python, react,
rust, typescript, web)
Per-pack file counts (only non-zero dirs shown; most packs are skill-only):
`clean-arch` skills:1 · `cloudflare` skills:1 · `cpp` rules:5 skills:2
agents:3 · `csharp` rules:5 · `db` skills:1 agents:2 · `ddd` skills:1 ·
`design` skills:21 · `django` skills:3 · `event-driven` skills:4 ·
`flutter` agents:2 · `gcp` rules:1 skills:1 · **`go`** rules:5 skills:11
agents:3 hooks:6 workflows:2 · `java` rules:5 skills:4 agents:3 · `k8s`
rules:1 skills:1 · `kotlin` rules:5 skills:7 agents:2 · `ml` agents:1 ·
`observability` skills:2 · `perl` rules:5 skills:2 · `php` rules:5 skills:3
· **`python`** rules:5 skills:2 agents:2 hooks:2 · **`react`** skills:5
agents:3 · **`rust`** rules:5 skills:2 agents:2 hooks:2 · `swift` rules:5 ·
**`typescript`** rules:5 skills:4 agents:3 hooks:2 · **`web`** rules:1
skills:5 agents:2 hooks:2. Only 6 of 26 packs carry hooks at all (go,
python, rust, typescript, web — 5 packs, 14 hook files total; count above
double-checked against the header scan in the next block).

Pack hook scripts (all `PostToolUse`/`Stop`/`SessionStart`, one line each
from the file's own header comment):
- `go/go-guard-post-edit.js` — PostToolUse: `go vet` + `staticcheck` after editing a `.go` file
- `go/go-guard-race.js` — Stop: `go test -race` for every package touched this session
- `go/go-version-check.js` — SessionStart: warn (≤once/week) when a newer Go release exists
- `go/go-version-check.test.mjs` — test file, no hook header
- `python/py-lint-post-edit.js` — PostToolUse: `ruff format` + `ruff check` (no `--fix`) after editing a `.py` file
- `rust/rust-fmt-post-edit.js` — PostToolUse: `rustfmt` after editing a Rust file
- `typescript/ts-lint-post-edit.js` — PostToolUse: format/lint after editing a TS/JS file
- `web/web-css-lint-post-edit.js` — PostToolUse: stylelint/html-validate after editing a stylesheet

### `personal/`
- `rules/`: 0 files
- `skills/`: 14 skill directories (raw count 20478 dominated by
  `dopa-shorts` = 345 MB of vendored video/voice assets — again, directory
  count is the real unit)
- `agents/`: 1 file
- `hooks/`: 12 files
- `commands/`: 5 files
- `workflows/`: 0 files
- `scripts/`: 2 files
- settings fragments: `CLAUDE.personal.md`, `external-links.yaml`,
  `mcp.json`, `permissions.yaml`, `settings.personal.json`

Personal hook scripts (12, headers):
- `audit-log.sh` — PostToolUse(Bash): log all executed bash commands (rotates ~1 MB)
- `english-coach.sh` — UserPromptSubmit: injects coaching instructions (toggle file `~/.claude/.english-coach`)
- `git-guard.sh` — PreToolUse: guard destructive git ops, protect main/master, allow feature-branch flow
- `herdr-agent-state.sh` — installed/managed by the `herdr` tool itself (not yoki-switch-owned content, just merged in)
- `mcp-audit.sh` — PostToolUse(mcp__*): log MCP tool usage (rotates ~1 MB)
- `rtk-rewrite.sh` — PreToolUse(Bash): rewrites CLI commands through `rtk` for 60-90% token reduction
- `skill-router.sh` — hands the submitted prompt to jig for judgment-service skill routing
- `tmux-sidebar.sh` — wrapper for tmux-agent-sidebar plugin hooks (default disabled via env)
- `unattended-guard.sh` — PreToolUse: while session marked unattended, blocks guardrail bypass
- `workflow-guard.sh` — PreToolUse(Workflow tool): cost guardrail at the graph boundary
- `worktree-hygiene.sh` — SessionStart: warns when repo has accumulated too many worktrees
- `yoki-project-hint.sh` — SessionStart: reads `.yoki.json` `langs`, flags declared-but-disabled packs

Enabled packs on this machine (`~/.claude/.claude-packs`): `go python
react rust typescript web`.

---

## 4. What already exists in the new layout (`domains/dev/llm/harness/`)

```
agents/
  research.md                      (only one agent def so far — "research" role)
jig/                                (the generator-in-progress itself, TypeScript/Bun)
  adapters/dsh/  {cordis.patch.yml, package.json, lib/index.js, src/index.ts}
  package.json, biome.json, bun.lock, tsconfig.json, README.md
  src/app/       {apply, box, codex, compaction, coverage, decision, hooks, install, routing, skills}
  src/cli/       {apply.ts, box.ts, codex.ts, coverage.ts, decide.ts, interactive.ts, jig.ts, report.ts, serve.ts, tier.ts, hooks/}
  src/domain/    {codex, compose, coverage, decision, hooks, mcp, permissions, policy, ports.ts, routing, skills, subject, tiers}
  src/infra/     {apply, audit, box, clock, coverage, decision, fs, interactive, logger, logs, metrics, proc, skills, targets, transcripts}
  src/index.ts
  test/          {adapters, app, cli, domain, infra}  (mirrors src/)
policy/
  guard-rules.json                  (25 KB — the single guard-policy format per decision `box-shape.md`'s reference and the "one format, not v1/v2" commit e10ba58/c7866db in git log)
  tiers.json                        (4.7 KB — model tier routing, likely consumer of core/harness-*.json noted in §3)
rules/
  decisions/                        (9 decision files + README, all read in §5)
```

`jig` already has `src/domain/mcp`, `src/domain/permissions`,
`src/domain/policy`, `src/app/apply`, `src/app/routing/select-skills.ts`
(referenced by decision `config-layout-no-personal-layer.md` line 21) —
i.e. **the generator's domain model is already partially built**; this is
not a from-scratch design. `src/cli/apply.ts` and `src/app/apply/` are the
existing entry point a new generator would extend rather than replace.
`adapters/dsh` already exists as a named adapter package (`lib/index.js` +
`src/index.ts`) even though DSH itself is not installed on this machine —
confirms DSH is an intended, partially-implemented target, not deferred.

---

## 5. Cross-check: source categories vs. the nine rulings

Read: `domains/dev/llm/harness/rules/decisions/{box-shape,
config-layout-no-personal-layer, decision-records,
format-on-edit-gate-on-stop, loop-native-goal, memory-files-only,
research-four-lenses, tools-nix-list-box-subset,
workflow-research-only}.md` (all 9, plus README.md).

| Source category (from §1-3) | Ruling that covers it | What the ruling implies |
|---|---|---|
| Rules (`rules/`, AGENTS.md) | `config-layout-no-personal-layer.md` | "元ファイルは `domains/dev/llm/harness/` 以下に種類ごとに置く: `rules/`(AGENTS.md の元、common と言語別)" — rules move wholesale into the new tree, keyed by `paths:` frontmatter, not packs |
| Skills | `config-layout-no-personal-layer.md` | "翻訳が要るもの… symlink で足りるもの: skills(Claude Code は `~/.claude/skills`、他は `~/.agents/skills`)" — confirmed live on this machine (§2, `~/.agents/skills`); "何を読むかは…スキルは jev の選択が決める" — dynamic selection replaces static pack on/off |
| Packs (language on/off toggle) | `config-layout-no-personal-layer.md` | "機械ごとの on/off(packs)はやめる" — explicit kill of the pack mechanism entirely; language dirs stay, but the enable/disable machinery (`.claude-packs`, `packs.default`, `pack enable/disable`) does not carry over |
| Personal layer | `config-layout-no-personal-layer.md` | "personal 層は作らない。jig はユーザー一人の層なので、個人のスキルもルールも同じ場所に置く" — `personal/` as a distinct merge-precedence layer disappears; its content folds into the single tree |
| Hooks (all of §1e, §3's pack/personal hook inventory) | `format-on-edit-gate-on-stop.md` | Per-harness prescription: "Claude Code: 整形は編集ごと(PostToolUse)…無音…型検査と lint は Stop の関門…pi: `agent_before_settle`…DSH: `tools/post-execute`…Codex: 指示(AGENTS.md)で". **Only formatting-on-edit + gate-on-stop + (implicitly) jig's own guard hook survive** — this reads as narrower than the current hook roster: personal hooks like `english-coach.sh`, `tmux-sidebar.sh`, `skill-router.sh`, `mcp-audit.sh`, `audit-log.sh`, `unattended-guard.sh`, `worktree-hygiene.sh`, `workflow-guard.sh`, `herdr-agent-state.sh`, `rtk-rewrite.sh`, `yoki-project-hint.sh` (11 of 12 personal hooks) are **not explicitly addressed** by this ruling — it only rules on the formatter/lint/typecheck timing question, not on every hook category. **Flagged: no ruling explicitly covers non-formatting hooks (guards, loggers, routers, toggles).** |
| Commands / slash commands | *no ruling found* | None of the 9 decisions mention `commands/`. **Flagged: uncovered category.** |
| Agents (subagent defs) | `config-layout-no-personal-layer.md` (partial) | Listed under "翻訳が要るもの…サブエージェント定義(Codex の形式と pi の package は未確認)" — agents move to the new tree but the Codex/pi translation format is explicitly marked unresolved |
| MCP server lists | `config-layout-no-personal-layer.md` | "MCP の一覧(四つの形)" — one `mcp/` source dir, four per-harness writers (matches jig's existing `src/domain/mcp`) |
| Permissions / guard-rules | `config-layout-no-personal-layer.md` + `decision-records.md` | "権限(guard-rules.json から四つの形)"; `decision-records.md`: "機械で検査できる決定は同じコミットで `guard-rules.json` か lint に変換" — `policy/guard-rules.json` is the single source, already exists (§4), git log shows it was just unified from v1/v2 (commits e10ba58, c7866db) |
| Workflows | `workflow-research-only.md` | "workflow として残すのは…調査系(review、research、code-study、stocktake)…実装系(implement、acceptance)と…(deliberate)は捨てる" — of the 10 files in `core/workflows/` (§3: acceptance.js, code-study.js, deliberate.js, design-review.js, implement.js, preflight.js, research.js, review.js, stocktake.js + lib/) **at least 3 (acceptance.js, implement.js, deliberate.js) are ruled OUT** for the new generator's scope; design-review.js and preflight.js are not named either way (not in the explicit "残す" list of review/research/code-study/stocktake) — **flagged: design-review, preflight status ambiguous under this ruling's literal wording** |
| Memory / auto memory | `memory-files-only.md` | "記憶はリポジトリ内のファイルだけに置き…Claude Code の auto memory は Claude だけの補助として残し…横断の記憶基盤は作らない" — no generator work implied beyond leaving Claude's native mechanism alone; claude-mem plugin explicitly disabled by decision (matches `enabledPlugins.claude-mem@thedotmack: true` still present in live settings.json §2 — **flagged: decision says disabled, live state shows it still enabled** — possible drift or the decision predates today's apply) |
| Loop / scheduled execution | `loop-native-goal.md` | "実行系は jig に作らない。回すときは各ハーネスの goal 機能を使う…jig は『goal で回すときの制約』をガードのルールとして持つ" — no generator surface, only a guard-rules addition (fs.write/fs.edit forbid on test paths during unattended runs — matches recent commit `test(jig): pin fs.write/fs.edit rules` in git log) |
| Sandbox / box (`sbx`) | `box-shape.md` | Not a source-tree category from §1-3, but relevant to how the generator's OWN config (guard rules, AGENTS.md, hook code) gets delivered into a sandboxed run: "jig の設定…は型の `files/home/` として起動時に描画して置く。ホストの `~/.claude` などをマウントしない" — implies the generator needs a render-to-sandbox mode distinct from render-to-`$HOME` |
| Toolchain / LSP provisioning | `tools-nix-list-box-subset.md` | Not a `claude-profiles` source category either — orthogonal to config generation, covers Nix flake packaging for host+sandbox tool availability |
| Decision records themselves | `decision-records.md` | Format ruling for how future generator-affecting decisions get written; meta, not a source category |
| Research methodology | `research-four-lenses.md` | Process ruling for how future investigations (like this one, partially) should be sourced; not a generator source category |
| **Settings merge semantics (§1e: hook-array concat order, `*`-merge precedence, runtime-owned-key carryover)** | *no ruling found* | **Flagged: no decision addresses whether the generator preserves yoki-switch's exact merge algorithra (personal-hooks-run-first, autoMode carryover, etc.) or redesigns it.** `config-layout-no-personal-layer.md` only says the generator "must know each harness's own layering algorithm" (Claude Code JSON precedence, Codex TOML precedence, pi deep merge, DSH profile patch) — it names the *problem* but not the *answer* for any of them. |
| **`~/.claude.json` MCP/plugin state** | *no ruling found* | **Flagged: no decision mentions `~/.claude.json` at all** — the file exists, holds MCP entries and dozens of runtime keys, and the current code explicitly avoids touching it (`readers/claude-code.js`, `writers/claude.js` comment). A generator author has to decide read-only-inventory vs. hands-off by default, and no ruling says which. |

---

## 6. Harness-side facts (verified live on this machine, not memory)

1. **Claude Code settings precedence** (fetched
   `https://code.claude.com/docs/en/settings.md`, "Settings files and
   precedence" section): 5 levels, highest to lowest — (1) Managed settings
   (`managed-settings.json`, MDM, or claude.ai console — org-controlled),
   (2) Command line (`claude --settings`), (3) Project local
   (`.claude/settings.local.json`), (4) Shared project
   (`.claude/settings.json`), (5) User (`~/.claude/settings.json`).
   `claude --help` confirms the flag: `--settings <file-or-json>  Path to a
   settings JSON file or a JSON string to load additional settings from`.
   No settings-*directory* mechanism was found in `--help` output — only a
   single-file (`~/.claude/settings.json`) or single-file/inline-JSON
   (`--settings`) shape at each precedence level; `~/.claude/settings.local.json`
   does not exist on this machine (checked, §2).

2. **Codex config.toml layering** (fetched
   `https://learn.chatgpt.com/docs/config-file/config-basic`): locations in
   precedence order highest→lowest — CLI flags/`-c` overrides → project
   config (`.codex/config.toml`, root-down, closest wins, **only loaded for
   trusted projects**) → `--profile` files → user config
   (`~/.codex/config.toml`) → cloud-managed workspace defaults → system
   config (`/etc/codex/config.toml`) → built-in defaults. `hooks.json`'s
   exact relationship to `config.toml` was **not resolved** by the fetched
   doc page (it only says hooks can come from `hooks.json` or inline
   `[hooks]` TOML sections, without pinning the file's location) — on this
   machine `hooks.json` lives at `~/.codex/hooks.json` (16 KB, sibling to
   `config.toml`, confirmed by `ls`, §2) and `config.toml` carries a large
   generated `[hooks.state."~/.codex/hooks.json:event:n:m"]`
   block that is runtime execution bookkeeping keyed back to that same
   `hooks.json` path+index — i.e. Codex round-trips state into `config.toml`
   the same way Claude Code round-trips `.autoMode` into `settings.json`
   (§1e) — **another runtime-owned-key carryover case the generator must
   not clobber**.

3. **pi settings/extension paths** (`pi --help`, live `ls`): `pi config
   [-l]` opens a TUI to enable/disable package resources ("Tab switches
   scope"); `pi install/remove/uninstall/update/list` manage extension
   *sources* directly through pi's own settings, independent of the
   dotfiles generator. On this machine `~/.pi/agent/` (mode `drwx------`)
   holds pi's actual extension/theme files; `~/.pi/settings.json`,
   `~/.pi/models.json`, `~/.pi/AGENTS.md` are direct file symlinks into
   `domains/dev/config/pi/` (not `claude-profiles/`) — **pi's dotfiles
   source lives in a different repo directory than the other four
   harnesses**, and its current linking is done by `core/config/manager.sh`
   `link_pi_resources()`, not by `yoki-switch`.

4. **omp config paths** (`omp --help` via resolved binary, live `ls`):
   `--profile=<value>` "Use an isolated profile for auth, sessions,
   settings, and caches"; `--config=<value>` "Load an extra config.yml-style
   overlay for this run (repeatable)" — both are omp-native layering
   mechanisms distinct from the dotfiles generator's own layering. Live
   paths: `~/.omp/agent/` (config home), `~/.omp/config.yml` (generated, not
   symlinked — runtime-written, §1b/2), `~/.omp/models.yml`/`lsp.yml`
   (symlinked reference data), `~/.omp/mcp.json`, `~/.omp/yoki-hooks.json`,
   `~/.omp/RULES.md`, `~/.omp/agents/`.

5. **DSH — not installed on this machine** (`which dsh` → not found,
   `~/.config/dsh` does not exist). What the repo documents:
   `domains/dev/config/dsh/README.md` describes a **profile-tree layout**:
   config home is `$DSH_HOME` (default `~/.dsh`); `settings.yaml` symlinks
   to `~/.dsh/settings.yaml` (model/provider routing, "re-read per
   request"); `dsh.op-vars` holds a 1Password reference (not a secret) for
   the proxy key; profiles are **pnpm workspaces DSH itself scaffolds** at
   `~/.dsh/profiles/<name>/` — the repo only owns
   `profiles/{proxy,headless}/cordis.patch.yml`, installed into
   already-scaffolded profile dirs by `link_dsh_resources()`
   (`core/config/manager.sh:301+`), never creating the profile dir itself.
   `hooks.claude.json` is installed as an **expanded copy** (not a symlink —
   `install_expanded()`, manager.sh:287-299 — because the DSH hook bridge
   reads the command path literally and does not expand `{{DOTFILES_ROOT}}`
   tokens) at `~/.dsh/hooks.claude.json`, wiring DSH into jig's guard via
   the official `@deepseek-ai/dsh-hooks-claude-code` bridge, reading the
   same `domains/dev/llm/harness/policy/guard-rules.json` jig's other
   adapters read. `jig/adapters/dsh/` already exists in the new layout
   (§4) with its own `package.json` + `lib/index.js`/`src/index.ts`,
   confirming DSH is a live target for the new generator despite being
   absent from this particular machine.

---

## Ten facts most relevant to scoping the generator (summary for the caller)

1. Two independent scripts write into `$HOME` today, not one:
   `domains/dev/bin/yoki-switch` (claude/codex/omp, layered under
   `claude-profiles/`) and `core/config/manager.sh` (pi/dsh/omp-statics/
   launchd, layered under `domains/dev/config/{pi,dsh,omp}`). A replacement
   generator needs to absorb both or explicitly scope out one.
2. Claude Code has **two** separate MCP-server stores —
   `settings.json.mcpServers` (generator-owned, from `mcp.json` layers) and
   `~/.claude.json.mcpServers` (Claude-Code-owned, written by `claude mcp
   add`, explicitly untouched by the current writer, live 2 vs 2 entries
   differ on this machine) — and no decision record addresses the second
   one at all.
3. Both Claude Code (`settings.json.autoMode`) and Codex
   (`config.toml`'s `[hooks.state...]` blocks) have runtime-owned keys the
   harness itself writes back; the current generator carries these forward
   by reading-before-writing (yoki-switch:317-326); any rewrite has to
   replicate this per harness or risk clobbering live state on every apply.
4. The `config-layout-no-personal-layer.md` decision **kills the packs
   on/off mechanism and the personal/core split entirely** — 20 of 26
   packs on this machine contribute nothing but skills (no rules/agents/
   hooks), and only 6 packs (go, python, react, rust, typescript, web) are
   even enabled — so the generator's source tree collapses from 3 layers ×
   26 packs to one flat tree keyed by `paths:` frontmatter (rules) and jev
   selection (skills).
5. `format-on-edit-gate-on-stop.md` is the only ruling that touches hooks,
   and it only rules on formatter/lint/typecheck timing — **11 of 12
   personal hook scripts** (git-guard, audit-log, mcp-audit, skill-router,
   tmux-sidebar, unattended-guard, workflow-guard, worktree-hygiene,
   yoki-project-hint, rtk-rewrite, herdr-agent-state) are guards/loggers/
   routers with no explicit ruling either way.
6. `workflow-research-only.md` keeps only review/research/code-study/
   stocktake; of the 10 files in `core/workflows/`, acceptance.js,
   implement.js, and deliberate.js are explicitly ruled out, while
   design-review.js and preflight.js are not named in either direction.
7. No ruling covers `commands/` (slash commands) at all — 11 core + 5
   personal command files currently merge with no forward decision.
8. `jig/` at `domains/dev/llm/harness/jig/` is not a blank slate — it
   already has `src/domain/{mcp,permissions,policy,routing,skills}`,
   `src/app/apply/`, `src/cli/apply.ts`, and a named `adapters/dsh/`
   package; the generator work is extension of an existing domain model,
   not a from-scratch build.
9. DSH's live layout (from its own README, since it's not installed here)
   is fundamentally different from the other four: profiles are pnpm
   workspaces DSH itself scaffolds at runtime, and the repo only ever
   patches into already-existing profile dirs — a "generate everything"
   model doesn't fit DSH the way it fits Claude Code/Codex/omp.
10. Verified precedence chains differ in shape per harness: Claude Code is
    5 discrete named levels with a `--settings` file/inline-JSON override
    and no directory-of-settings mechanism; Codex is 7 levels including a
    **trust-gated** project layer (untrusted projects skip `.codex/`
    entirely) and a `--profile` mechanism; pi and omp each have their own
    native runtime layering (`pi config` TUI scopes; omp `--profile`/
    `--config` overlays) that sits *underneath* whatever the dotfiles
    generator produces — the generator is not the only layering system in
    play for any of the five harnesses.
