---
question: "yoki → jig coverage map: which yoki capabilities has jig actually replaced, measured against jig's own intended scope (design-v2.md), and what still requires yoki-switch today?"
date: 2026-09-21
verdict: "Everything that actually writes a running harness's configuration to disk — composing/writing settings.json (permissions, MCP, hooks, env), symlinking ~/.claude/{skills,hooks,scripts,commands,agents,rules,workflows}, Codex/omp target generation, pack enable/disable, and deploying jig's own policy file to the path the live guard reads — still requires yoki-switch/manager.sh. jig's permission/MCP compiler modules (domain/permissions/to-claude.ts, domain/mcp/to-claude.ts, app/install/install-profile.ts) are built and unit-tested but have zero CLI entrypoint, by the code's own comment: staged, not wired."
unverified: []
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# yoki → jig coverage map

Sources read directly: `design-v2.md`, memory files (`yoki-rebuild-jig`,
`harness-adapter-layer-design`, `guard-rules-promotion-and-retirement`,
`jig-mcp-visibility`), yoki runtime tree (`domains/dev/config/claude-profiles/`),
jig source tree (`domains/dev/llm/harness/jig/{src,adapters}`), `yoki-switch`
(`domains/dev/bin/yoki-switch`), `core/config/manager.sh`.

## 0. jig's intended scope (measure "un-migrated" against this, not against "everything yoki does")

`design-v2.md` (承認済み 2026-09-20, "LGTM、進めていい") states its own scope
explicitly. The document's title is "ハーネス非依存の政策コアと、薄い強制アダプタ"
and §2 defines exactly three things jig owns: a **判定器** (one evaluator,
`domain/policy/evaluate.ts`), **接続部** (four thin adapters: pi, DSH, Claude
Code, codex), and a **最後の防御層** (sandbox + floor rules). §7's phase plan
(Phase 0–5) and §8's approval list cover only: subject extraction/parsing,
policy v2 schema, floor rules, audit, JEV-as-advisor, sandbox tiering, adapter
wiring. Explicitly deferred to "別タスク" at the end of §7: "MCP のルールの詳細、
skills・agents・commands の投影、rulesync."

Nowhere in design-v2.md, nor in any memory file, is there a statement that jig
will absorb yoki's install/apply pipeline UI, the loop/cron scheduler, the
graph/workflow engine, or the learning/instinct system. The `yoki-rebuild-jig`
memory's original ambition ("yoki は退役する（確定前提）— ガード政策も jig が
全量持つ") was about **guard policy**, and was later narrowed further
(2026-09-20 裁定): "権限/ガードの設計重心を...ハーネス非依存の政策コアへ". The
memory's own persisted "次（未着手）" list names what's left as: compose 書き込み
経路／ガード全量の再導出／認証／shadow モード／codex・omp TargetWriter／**graph・
loop・secrets・model・state** — i.e. graph and loop are named as separate,
unstarted, unscoped-in-detail items, not sub-items of the guard work.

**Conclusion: jig's intended scope is the judgment/decision core — guard
(shell/fs/net policy), tier routing, and skill/compaction judgment via
`DecisionProvider` — plus (per code, ahead of design-v2.md's paper scope) a
staged-but-unwired settings/permissions/MCP compiler. Learning, loop/cron, and
graph/workflows are not planned jig work; they are separate systems that keep
running under yoki/personal-layer/core-skill ownership indefinitely.** "Yoki
retirement" (event-approved, "今後、退役があるならOK") means retiring the
guard-adjacent code that jig has actually replaced (e.g. `pre-permission-guard.js`'s
`enforce:[hook]` subset, already a no-op) — not the whole `runtime/yoki` tree,
which still carries scripts/lib/{loop,graph,permissions,targets,mcp-inventory,
install*} that have no jig counterpart at all.

---

## 1. Guard / permission decision (the judgment core)

| yoki capability | what it does | jig equivalent | status | evidence | gap |
|---|---|---|---|---|---|
| Shell command guard (regex-based) | `guard.ts`/bridges matched raw command strings against 19 v1 rules | `domain/subject/walk.ts` (unbash-based strict/lenient parser) + `domain/policy/evaluate.ts` | **migrated** | `jig/src/domain/subject/`, `jig/src/domain/policy/{parse,evaluate}.ts`; policy v2 collapsed to v1 numbering (`c7866db`, `e10ba58`) | none — subject-aware, not string-regex; live on all 4 harnesses |
| Floor / absolute-deny rules (rm -rf root/home, mkfs, dd to block device, fork bomb, shutdown/reboot, `.git/hooks`) | scattered across `permissions.yaml` `enforce:[hook]` + `guard.ts` hardcodes | `policy.floor` in `guard-rules.json` (19 floor rules) | **migrated** | `guard-rules-promotion-and-retirement` memory; live-tested `sudo rm -rf /` → floor deny | none |
| fs.write/fs.edit rules (shell rc floor, home-secret forbid, repo-secret/CI ask) | none — yoki's equivalent (`permissions.yaml`) is a much broader denylist (see §2 table) designed only for Claude Code | `policy.rules` action `fs.write`/`fs.edit`, D-20 | **migrated (narrow, by design)** | memory `guard-rules-promotion-and-retirement` "fs/net ルール確定 D-20 live"; `~/.aws/credentials`→deny, `~/.zshrc`→floor deny, `.env`→ask tested live | jig's fs ruleset (~29 rules) is deliberately narrower than yoki's 40+ pattern `permissions.yaml` — see §2 gap |
| fs.read gating | `pre-permission-guard.js` denies `Read`/`Glob`/`Grep`/`LS` against `.yoki/permissions.json` (secret paths) — **only enforcement on codex/omp today** | none (deliberate: "fs.read はガードで作らず sandbox 任せ") | **out-of-scope-by-design** | design-v2.md §5.2: "Anthropic 自身が『ファイル読み取りのゲートは境界ではない』…と明記" | pi/DSH have neither yoki's fs.read guard (not consumed) nor a jig one — this is a real coverage hole for pi/DSH specifically, accepted as sandbox's job, but sandbox for pi/DSH (srt/sbx) is not yet the default posture (§5 below) |
| net.fetch allow/deny | none in yoki (no explicit net rules found) | none by design (D-20: sandbox layer's job) | **out-of-scope-by-design** | design-v2.md §5.2 | — |
| Confirmation/ask semantics per harness | ad hoc per bridge | `evaluate.ts` decision → adapter translates (ask→deny degrade on codex/pi-no-UI) | **migrated** | design-v2.md §4.1; `dsh/src/index.ts:189-196` | none |
| Audit trail of every decision | none (no structured audit) | `infra/audit/jsonl-audit.ts` → `~/.local/state/jig/guard-audit.jsonl` | **migrated (new capability)** | design-v2.md §3.5; memory | none |
| JEV-as-advisor for ambiguous verdicts | not attempted in yoki | `domain/decision/provider.ts` gray-zone path (design-v2 §3.6) | **not-started (deferred by design)** | design-v2.md §3.6, §7 Phase 4; memory "次: Phase 4 JEV 実測" | default off, awaiting measurement — intentional, not a gap |
| Sandbox (last line of defense) | none (yoki has no sandbox wiring) | codex `workspace-write`+`network_access=false` live; DSH default `workspace-write`; Claude Code declined (breaks TLS tooling); pi/DSH unattended via sbx (proven, not wired as default) | **partial** | memory "Phase 4 一段目 完了" | Claude Code has NO sandbox layer at all now (declined, not deferred); srt-wrapped pi for everyday use still unstarted; sbx not wired as an automatic gate for `--loop`/unattended runs — still manual |

---

## 2. Permission COMPILATION + install/apply pipeline — **the central finding**

**`yoki-switch apply` is still the only thing that actually writes
`~/.claude/settings.json`, `~/.codex/`, symlinks skills/hooks/rules/commands/
agents/workflows, and runs the pack-aware merge. jig's parallel compiler
(`domain/compose`, `domain/permissions/to-claude.ts`, `domain/mcp/to-claude.ts`,
`app/install/install-profile.ts`) exists, is tested, and is explicitly
documented in its own source as unwired:**

> `app/install/install-profile.ts:24-27`: *"Not yet wired to a CLI command —
> this is staged ahead of the `install` / `apply --target claude` command
> that will call it, on purpose, not an oversight."*

`jig apply` (the only `apply` subcommand that exists — `src/cli/jig.ts:209-217`,
`src/cli/apply.ts`) does **one narrow thing**: regenerate `pi/models.json`,
`dsh/settings.yaml`, and `litellm/config.yaml`'s tier-routing block from
`policy/tiers.json`. Its own usage text says so: *"apply regenerates pi/models.json
and dsh/settings.yaml's managed block from policy/tiers.json... this writes
the repo files jig's existing symlink machinery already points pi/dsh at — it
does not itself install or symlink anything."* (`jig.ts:313-318`)

| yoki capability | what it does | jig equivalent | status | evidence | gap |
|---|---|---|---|---|---|
| Compose Claude `settings.json` (core+packs+personal merge, array/hooks/env semantics) | `manager.sh` `merge_settings()` (jq-based, layered) | `domain/compose/{merge,layers,compose,template}.ts` | **built, not wired** | `manager.sh:200-327`; `install-profile.ts:24-27` | no CLI entrypoint calls `installProfile`/`composeSettings`; yoki-switch still writes the real file |
| Permissions compilation (`permissions.yaml` → Claude `permissions.allow/deny`) | `scripts/lib/permissions/to-claude.js`, `to-codex.js`, `to-omp.js` | `domain/permissions/to-claude.ts` (Claude only) | **built, not wired; no codex/omp equivalent** | `manager.sh:245`; `to-claude.ts` grep shows zero callers outside `compose.ts`/tests | jig has no `to-codex`/`to-omp` permission compiler at all (only `to-claude.ts`); omp is retiring by user decision so that's moot, but codex permission compilation is a real gap — codex today gets permissions via yoki's `lib/targets/codex.js`, not jig |
| MCP servers compilation (`mcp.json` → `mcpServers`) | `scripts/lib/mcp-inventory/writers/claude.js` | `domain/mcp/to-claude.ts` | **built, not wired** | `manager.sh:259-269`; grep shows `to-claude.ts` has zero callers outside its own module/tests | same as above — ported logic exists, no CLI path |
| Hook-enforced deny subset for non-declarative patterns | `pre-permission-guard.js` reads `.yoki/permissions.json` (written by to-claude/to-codex/omp at apply time) | n/a | **yoki-only, still live** | `pre-permission-guard.js:1-67` | jig's guard doesn't consume/replace this file; still yoki's job |
| Full `permissions.yaml` denylist (~80 patterns: terraform/az/gcloud/kubectl destructive ops, npm/cargo/docker publish, `kill -9`, `Edit(/etc,/usr,/var,/bin,/sbin,/lib,/boot,/proc,/sys,/dev/**)`, `Read(~/.azure,~/.gcp,~/.ssh/id_*,**/*.pem,**/*.key)`) | Claude-native `permissions.deny` + codex/omp translation via `to-codex.js`/`to-omp.js` | **none** — jig's `guard-rules.json` floor+rules (~48 rules total) is a much narrower, independently-designed D-20 set (shell rc, home secrets subset, repo secrets/CI) | **not-started** | `personal/permissions.yaml` (full list, lines 24-100); design-v2.md §5.2 explicitly says "yoki の 40 パターンは参考の一つで正本にしない" | **this is the single biggest live coverage hole**: none of these ~80 cloud-destructive-command / broad Edit-system-path / broad Read-cloud-cred denials exist in jig's policy at all. On Claude Code they're still enforced (yoki's native permissions.deny + `pre-permission-guard.js` hook-subset). On **pi and DSH, which only consume `guard-rules.json`, none of these ~80 patterns apply** — `terraform destroy`, `az vm delete`, `kubectl delete namespace`, `npm publish`, `docker system prune`, `kill -9`, editing `/etc/**` etc. are unguarded on pi/DSH today unless independently caught by jig's own floor/D-20 rules (which they mostly are not) |
| Codex trust/hooks.json registration | `scripts/lib/targets/codex-trust.js`, `codex-hooks-merge.js`, `codex-config-toml.js` (part of `apply_target_generator codex`) | `jig codex register [--write]` (`app/codex/register-codex.ts`, `domain/codex/register.ts`) | **migrated** | memory "codex 登録 2026-09-21"; `src/cli/jig.ts:218-229` | live, hash-verified against yoki's codex-trust.js |
| Codex/omp full target generation (AGENTS.md, skills symlinks, config.toml merge beyond hooks, omp yaml/rules) | `scripts/lib/targets/{codex,codex-agents*,codex-skills,codex-toml-lite,omp*}.js` via `gen.js` | none | **not-started / not planned** | `manager.sh:670-706` (`apply_target_generator`) calls yoki's `gen.js` exclusively | omp is retiring (out of scope by user decision); codex's broader target generation (not just guard-hook registration) remains 100% yoki |
| Symlink/merge-dir machinery (skills, hooks, scripts, commands, agents, rules, workflows → `~/.claude/*`) | `manager.sh merge_dir()` / `yoki-switch`'s `MERGE_DIRS` loop | none | **not-started** | `manager.sh:352-390`; `yoki-switch:139,791-793` | no jig code touches symlinks at all |
| pi/DSH/jig-policy/launchd resource linking (`link_pi_resources`, `link_dsh_resources`, `link_jig_policy`, `link_omp_resources`, `link_launch_agents`) | `core/config/manager.sh` (a *different* script from `yoki-switch`) | none | **not-started** | `manager.sh:164-523` (`link_pi_resources`, `link_dsh_resources`, `link_jig_policy`, `link_launch_agents`) | jig's own policy file (`~/.config/jig/policy/guard-rules.json`) is symlinked into place by **yoki/dotfiles' `manager.sh`**, not by jig itself — jig cannot deploy its own policy changes |
| Pack enable/disable, pack-aware settings merge | `yoki-switch pack enable/disable <pack>` | none | **not-started / out-of-scope for now** | `yoki-switch:965-998`; memory "未使用 pack 19 個は今消さない" (deferred) | packs are explicitly deferred: "pack は yoki の概念であり、jig 側で相応の仕組みが実装完了→yoki 退役の時に...消えるだけ" |
| Dry-run / diff / capability-report / provenance for apply | `yoki-switch apply --dry-run` (settings.json/CLAUDE.md/permissions.json diff against a sandboxed rebuild) | `jig apply` has this (dry-run default, diff, stage→rename, provenance sidecar) — but **only for the tiers.json slice**, not settings/permissions/MCP | **partial** | `yoki-switch:472-625`; jig `apply-tiers.ts` / `app/apply/ports.ts` | jig's apply infrastructure (dry-run/diff/manifest/provenance) is real and good, but scoped to model-tier config only |

**Answer to "who actually runs the install today": `yoki-switch` (bash,
`domains/dev/bin/yoki-switch`) plus `core/config/manager.sh` (a separate bash
script) do 100% of the real Claude Code / Codex / omp settings compilation and
all symlinking. `jig apply` only touches `policy/tiers.json` → pi/dsh/litellm
model-routing config. jig's settings/permissions/MCP compiler modules exist
and are unit-tested but have zero CLI callers — they are staged, not live.**

---

## 3. Other yoki hooks (not guard-related)

| hook | job | jig equivalent | status | evidence |
|---|---|---|---|---|
| `pre-permission-guard.js` | denies hook-enforced permission subset on Read/Glob/Grep/LS/WebFetch/Bash for codex/omp (only enforcement there) | none | **not-started** | `pre-permission-guard.js:1-67`; jig has zero fs.read logic |
| `git-guard.sh` (personal/hooks, 311 lines) | branch-aware git guard: main/master push-deny, `--no-verify` block, PR-gate via preflight content-hash, warn-once on main commit, cross-session branch-switch warning, `.yoki.json` `allowMainBranchWork` relaxation | none (jig has stateless floor rules `deny-force-push`/`deny-rm-recursive` only) | **not-started (scoped out)** | `personal/hooks/git-guard.sh:1-40`; memory: "git-guard.sh の文脈依存ガード（実ブランチ検出・PR ゲート・identity）はパターン表現不能なので Phase 1 スコープ外＝bash 存続" | stateful/session/branch-context logic is explicitly declared unrepresentable in jig's stateless rule model |
| `unattended-guard.sh` (personal/hooks, 111 lines) | blocks self-modification (`~/.claude/**`, `**/claude-profiles/**`, yoki-switch invocation) when session is marked unattended | none | **not-started** | `personal/hooks/unattended-guard.sh:1-40` | no jig concept of "unattended session" or self-modification protection |
| `config-protection.js` | blocks edits to linter/formatter config files | none | **not-started / likely out-of-scope** | grep of jig `src/` for config-protection: no hits | narrow lint-steering hook, orthogonal to jig's mission |
| `pre-compact.js` | writes LLM-generated session summary before Claude compaction | none (jig has `app/compaction/*` but that's skill/tier *compaction-judgment* via JEV, a different concept — decides whether to keep/drop, not summarize) | **unrelated / not a migration item** | `pre-compact.js:1-15` vs `app/compaction/compact.ts` | naming collision only; not the same capability |
| `pre-rules-context.js` | injects `~/.claude/rules/**/*.md` `paths:`-matched bodies as `additionalContext` (mainly for codex, which can't self-read rules) | none | **still registered, still needed for codex** | `core/settings.layer.json:95`; confirmed native `~/.claude/rules` loading exists for Claude Code itself, so this hook is redundant for Claude Code but still load-bearing for codex | no jig equivalent; not deferred anywhere in design docs |
| `pre-bash-git-push-reminder.js` | advisory context reminder on `git push` | none | **not-started, low stakes** | still registered (`core/settings.layer.json`, hooks flow) |
| `quality-gate.js`, `post-edit-format.js`, `post-edit-typecheck.js` | post-edit lint/format/typecheck (Biome/Prettier/tsc/Go/Python) | none | **not-started / out-of-scope** | zero hits in jig `src/` for typecheck/format/quality-gate | orthogonal to guard/permission/decision mission |
| `cost-tracker.js` | sums per-session token usage from transcripts → `~/.claude/metrics/costs.jsonl`, backs the `cost-tracking` skill | jig has its OWN separate metrics (`infra/metrics/registry.ts`, Prometheus-style `/metrics` on the judgment service) for **judgment-service token spend only** | **parallel, not overlapping** | `cost-tracker.js:1-16` vs `jig/src/infra/metrics/registry.ts` | different scopes: yoki tracks whole-session Claude cost; jig tracks only its own decision-service LLM calls |
| `codex-notify.js` | handles codex's `notify` external-program callback | none (jig only registers PreToolUse hooks, not `notify`) | **not-started** | `codex-notify.js:1-15` | separate codex integration point jig doesn't touch |
| `artifact-comments.js`, `pretooluse-visible-output.js`, `pre-webfetch-websearch-delegate-warn.js`, `pre-edit-write-suggest-compact.js` | misc UX/advisory hooks (artifact inbox surfacing, context-injection plumbing, delegation nudges, compact nudges) | none | **not-started / out-of-scope** | no jig references | all orthogonal to jig's guard/tier/decision mission |
| Pack post-edit lint hooks (5 packs — go/python/rust/typescript/web — 14 files incl. tests: go has 3 real hook scripts + tests, the other 4 packs have 1 each + tests) | per-language post-edit lint/format enforcement | none | **not-started / out-of-scope** | verified via `find domains/dev/config/claude-profiles/packs -path "*/hooks/*" -type f` | packs are deferred wholesale (see §2, §7) |

---

## 4. Learning (correction-detect / instincts / /learn / /evolve)

Fully separate system, **zero overlap with jig**, confirmed by exhaustive grep
(`homunculus|instinct|correction|continuous-learning` → 0 hits anywhere in
`jig/src` or `jig/adapters`).

| yoki capability | what it does | jig equivalent | status | evidence |
|---|---|---|---|---|
| `prompt-correction-detect.js` (UserPromptSubmit hook) | detects user corrections, appends to `~/.claude/homunculus/corrections.jsonl` | none | **not-started / out-of-scope-by-design** | `core/settings.layer.json:129` (still registered, `minimal,standard,strict`) |
| `continuous-learning-v2` skill (core/skills, vendored inside `runtime/yoki/skills/`) | v2.1 instinct system: `hooks/observe.sh`, `scripts/instinct-cli.py`, `scripts/migrate-homunculus.sh`, project-scoped instincts, confidence scoring | none | **not-started / out-of-scope-by-design** | `runtime/yoki/skills/continuous-learning-v2/{hooks,scripts}` |
| `/learn`, `/instinct-status` commands | distill/inspect instincts | none | **not-started / out-of-scope-by-design** | `core/commands/learn.md`, `core/commands/instinct-status.md` |
| `/evolve` | promote instincts | (no dedicated command file found — likely invoked via the skill itself) | **not-started / out-of-scope-by-design** | no `evolve.md` found under `core/commands/` |

**Learning was never part of jig's design brief and there is no mention of migrating it anywhere in design-v2.md or memory. It stays on yoki/core-skill indefinitely.**

---

## 5. Loop / cron

| yoki capability | what it does | jig equivalent | status | evidence |
|---|---|---|---|---|
| `scripts/lib/loop/{argv,cli,config,inbox,models,plist,runner,session-id,state}.js` | real implementation backing the `/loop` skill (recurring prompt/slash-command execution, launchd `.plist` generation, session tracking) | none | **not-started / out-of-scope-by-design** | `runtime/yoki/scripts/lib/loop/*`; zero `loop`/`cron` hits in jig `src/` (verified by grep, excluding false-positive "event loop" comments) |
| `schedule` skill (cron-scheduled cloud agents/routines) | separate Claude Code native feature (not a yoki subsystem) — distinct from `/loop` | n/a | **unrelated to yoki/jig** | listed as its own top-level skill, no yoki runtime files reference it |

`/loop` is a genuine yoki-owned subsystem with real backing code (9 lib files),
not just the generic skill description. No jig migration is planned or
mentioned anywhere.

---

## 6. Graph / workflows

| yoki capability | what it does | jig equivalent | status | evidence |
|---|---|---|---|---|
| `scripts/lib/graph/*` (20 files: `agent-cli`, `api`, `backends/`, `budget`, `catalog`, `escalate`, `events`, `gate`, `guard.js` [naming collision only — not the same "guard" as the shell guard], `journal`, `lock`, `models`, `progress`, `retry`, `roles`, `runner`, `schema`, `top*`, `widget-lines`, `worker-host`, `worker-source`, `worktree`) | full multi-agent workflow engine backing `yoki-graph`/Workflow tool (review/research/implement/preflight/design-review/acceptance/code-study/deliberate/stocktake/go-optimize graphs) | none | **not-started / out-of-scope-by-design** | `runtime/yoki/scripts/lib/graph/`; zero hits for workflow/graph/yoki-graph anywhere in jig `src`/`adapters` |
| `core/workflows/*.js` (the actual graph scripts: `acceptance.js`, `code-study.js`, `deliberate.js`, `design-review.js`, `implement.js`, `preflight.js`, `research.js`, `review.js`, `stocktake.js`, `lib/`) | the workflow definitions themselves, merged into `~/.claude/workflows/` via `yoki-switch`'s `MERGE_DIRS` | none | **not-started / out-of-scope-by-design** | `core/workflows/`; `yoki-switch:139` (`MERGE_DIRS=(... workflows)`) |
| `yoki-graph` CLI (`domains/dev/bin/yoki-graph`) | runs the same workflow scripts for Codex/omp (non-Claude-Code harnesses) | none | **not-started / out-of-scope-by-design** | `domains/dev/bin/yoki-graph` |
| `build_workflow_catalog()` in `yoki-switch` | regenerates the "which workflow when" table in the `yoki-graph` skill's `SKILL.md` from `lib/graph/catalog.js` at apply time | none | **not-started** | `yoki-switch:640-668` |

Graph/workflows is entirely yoki-owned, has substantial real code (20+ lib
files plus 9 workflow scripts), and — like loop — has no jig migration
mentioned anywhere in design docs or memory.

---

## 7. Pack management + rules

| yoki capability | what it does | jig equivalent | status | evidence |
|---|---|---|---|---|
| `yoki-switch pack list/enable/disable` | toggles packs in `~/.claude/.claude-packs`, triggers re-`apply()` | none | **not-started, explicitly deferred** | `yoki-switch:965-998`; memory: "未使用 pack 19 個は今消さない...pack は yoki の概念であり、jig 側で相応の仕組みが実装完了→yoki 退役の時に...消えるだけ" |
| Pack `settings.layer.json`/`permissions.yaml`/`mcp.json`/`external-links.yaml` layering | merged by `manager.sh`/`yoki-switch` at apply time, personal wins over packs wins over core | none | **not-started** | `manager.sh:196-327` |
| Language-pack rules (`paths:` frontmatter, loaded natively by Claude Code once installed under `~/.claude/rules/`) | authored content, not a mechanism yoki "runs" — Claude Code itself loads `paths:`-gated rules natively | n/a — this was found to be **already native to Claude Code**, no compiler needed at all (for Claude Code; codex still needs `pre-rules-context.js` injection) | **not a migration item** (mechanism is Claude-native, not yoki/jig) | memory `yoki-rebuild-jig`: "`~/.claude/rules/` は `paths:` frontmatter 込みでネイティブ...yoki の pre-rules-context.js 注入フックは不要" (for Claude Code) |
| Pack lint hooks (go×5/python×2/rust×2/typescript×2/web×2) | see §3 | none | **not-started, deferred with packs** | `packs/*/hooks` |

---

## 8. `yoki-switch` CLI + `link_*` symlink management + rename status

| item | current state | evidence |
|---|---|---|
| `yoki-switch` binary (`domains/dev/bin/yoki-switch`, `claude-switch` = permanent alias) | fully live, the only real apply/install/pack/doctor CLI in use today | `yoki-switch:1-1039` (own 1000+ line implementation, not a thin wrapper) |
| `core/config/manager.sh` | a **separate** script (not `yoki-switch` internals) owning `link_pi_resources`, `link_dsh_resources`, `link_jig_policy`, `link_omp_resources`, `link_launch_agents` — machine/account-specific symlinks including jig's own policy directory | `manager.sh:164-523` |
| jig's own policy deployment | jig cannot deploy its own `guard-rules.json`/`tiers.json` edits — a human must `cp` into two paths (repo + `~/.config/jig/policy/`) and the actual symlink for the installed path is made by `manager.sh link_jig_policy`, invoked by the user, not by jig | `guard-rules-promotion-and-retirement` memory: "エージェントは両パスとも書けない...ユーザーが 2 パスへ cp + `yoki-switch apply`" | 
| Rename `yoki-switch`→something jig-branded, `yoki-box`→`jig` | **not done** — deferred to "Phase 5" bundled with actual yoki retirement, to avoid a half-renamed intermediate state | `guard-rules-promotion-and-retirement` memory: "ランチャ名 `yoki-switch`...と `yoki-box→jig` のリネームも Phase 5 に束ねる" |
| `doctor`, `doctor --prepush` | yoki-switch subcommands (health-check, secret/PII pre-push scan) | none in jig | **not-started** | `yoki-switch:817-871` |

---

## Summary: what still requires `yoki-switch` today

**Everything that actually changes a running harness's configuration on disk**
still requires `yoki-switch` (or `manager.sh` for jig's own policy symlink):
composing and writing `~/.claude/settings.json` (permissions, MCP servers,
hooks, env), symlinking every `~/.claude/{skills,hooks,scripts,commands,
agents,rules,workflows}` directory, generating Codex's/omp's broader config
(AGENTS.md, skills symlinks, non-guard config.toml sections), pack enable/
disable, and — critically — deploying jig's *own* policy file changes to the
path the live guard actually reads (`~/.config/jig/policy/guard-rules.json`,
via `manager.sh link_jig_policy`). `jig apply` only rewrites the model-tier
slice of `pi/models.json`, `dsh/settings.yaml`, `litellm/config.yaml`.
`domain/permissions/to-claude.ts`, `domain/mcp/to-claude.ts`, and
`app/install/install-profile.ts` are real, tested ports of yoki's compilers
but have no CLI entrypoint — the code says so in its own comment.

**Is jig's permission-compilation module wired into an install path?**
**No.** It exists, is unit-tested, and is explicitly documented as staged-not-
wired (`install-profile.ts:24-27`). `yoki-switch` still does the real apply
for Claude Code/Codex/omp settings, permissions, and MCP.
