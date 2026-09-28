---
question: "Which of yoki's legacy (non-guard) hooks are made obsolete by native features across Claude Code, Codex, pi, and DSH, and which need a harness-independent implementation?"
date: 2026-09-22
verdict: "Format/lint and audit-log hooks are KEEP-AS-PLUGIN on all four harnesses since none has a native equivalent; git-guard.sh and unattended-guard.sh must stay outside jig as stateful per-harness plugins because no harness's PreToolUse-equivalent payload carries the session/branch state they need, and this is higher-stakes on pi/DSH which have no partial native fallback at all; config-protection.js is the strongest MOVE-TO-JIG candidate; pre-rules-context.js (paths: frontmatter rule loading) is native only on Claude Code, with a working Codex backport but real, unfilled gaps on pi and DSH."
unverified: []
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Legacy yoki hooks vs. native harness features and the industry (all 4 harnesses)

Scope: every non-guard hook under `runtime/yoki/scripts/hooks/*.js`, the
personal `.sh` hooks wired in `personal/settings.personal.json`, and the
per-language pack hooks. `pre-permission-guard.js` is out of scope (already
migrated to jig). jig is harness-independent (Claude Code, Codex CLI, pi,
DSH), so **"native?" is answered per harness, not just for Claude Code** —
a hook is only truly obsolete if every harness the owner runs has the
equivalent; if only one harness has it, the gap on the others is exactly
what a harness-independent hook (or jig) must still cover.

Sources: official Claude Code docs at `code.claude.com/docs/en/` (`hooks`,
`hooks-guide`, `settings`, `permissions`, `permission-modes`, `plugins`,
`memory`, `costs`), fetched 2026-09-22, cited inline; this repo's own
already-verified cross-harness integration work (`jig`'s codex/pi/dsh
adapters and the harness-adapter-layer / jig-mcp-visibility memory records,
2026-09-20/21); the checked-out `deepseek-harness` source
(`~/.claude/jobs/7d3622d8/tmp/deepseek-harness`) for DSH's cordis event
names; `~/.claude/.../pi/extensions/*.ts` for pi's `ExtensionAPI` events
actually in use; and a `gh search code` survey of public repositories
(section 5) — `gh auth status` confirmed authenticated, code search worked
but hit GitHub's secondary rate limit repeatedly (noted inline where a
query was skipped or retried).

Verdict legend: **NATIVE** = every harness the hook needs to run on already
does this; drop the hook everywhere. **NATIVE-ON-N/4** = native on some
harnesses only — keep a harness-independent implementation for the rest.
**KEEP-AS-PLUGIN** = still earns its keep on every harness, ship as a thin
per-harness adapter (plugin hooks.json / pi extension / dsh cordis plugin)
rather than through yoki's own runner. **MOVE-TO-JIG** = a stateless
judgment/policy call jig should own (and jig already reaches all four
harnesses' PreToolUse-equivalent surface, so this is free once written
once). **DROP** = not earning its keep anywhere. **BRIDGE-ONLY** = plumbing
for cross-harness delivery, not itself a policy/feature decision.

## 0. What hook/event surface each harness actually exposes

This is the ground truth the rest of the table is checked against — a hook
can only be delivered where the event exists at all.

| Claude Code (official) | Codex CLI (`hooks.json`) | pi (`ExtensionAPI`) | DSH (cordis waterfall) |
|---|---|---|---|
| Full catalog, official & stable: `SessionStart`, `SessionEnd`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`, `Elicitation*`, `SubagentStart`, `SubagentStop`, `TaskCreated/Completed`, `TeammateIdle`, `FileChanged`, `CwdChanged`, `DirectoryAdded`, `InstructionsLoaded`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `MessageDisplay`, `ConfigChange`, `Notification`, `WorktreeCreate/Remove`. ([hooks reference](https://code.claude.com/docs/en/hooks)) | Recognizes (per this repo's own `codex-hooks-merge.js` `KNOWN_EVENTS`, verified against a live trusted config, and independently confirmed by a public repo — see §5): `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Interrupt`. **No** `Notification` — Codex uses a separate `notify` program in `config.toml` instead (see `codex-notify.js`). Only `PreToolUse` is currently wired by jig. `PreCompact` is a recognized event but, per this repo's own `pre-compact.js` header, "unreachable from `codex exec`" in the mode actually used. Codex also can't present an interactive `ask` — jig's own code degrades `ask`→`deny` for it (`CAN_ASK = {claude, dsh}`, harness-adapter-layer memory). Marked "experimental" by third parties too (§5). | Events confirmed actually wired in this repo's own `pi/extensions/*.ts`, plus more confirmed in public pi plugins (§5): `session_start` (≈SessionStart), `before_agent_start` (≈UserPromptSubmit, pre-turn), `tool_call` (≈PreToolUse — can block), `tool_result` (≈PostToolUse), `agent_settled` (≈Stop), `session_before_compact` (≈PreCompact), `session_shutdown` (≈SessionEnd, seen in a public plugin). **pi has no permission layer of its own at all** — its own `guard.ts` says so explicitly: `tool_call` extensions are the *only* thing between the model and the shell, for every kind of gating, not just jig's. | Cordis waterfall pipeline, confirmed from deepseek-ai's own docs: `tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*`, plus `agent/session-start` (≈SessionStart), `agent/pre-step` ("decides what the model sees this step" — the right shape for rules-context-style injection), `agent/turn-stopping` (≈Stop), and a large `session/*` family. jig's own DSH adapter today only wires `tools/pre-execute`. **No compact-specific waterfall event found** in this survey, and no notification waterfall found — both look like real gaps, not just under-wired ones. DSH's `tools/pre-execute` can return allow/deny/ask; ask routes to DSH's own approval UI, same shape as pi and cc. |

Net: **PreToolUse-equivalent and PostToolUse-equivalent exist on all four
harnesses.** SessionStart-equivalent exists on all four. Stop-equivalent
exists on all four. PreCompact-equivalent exists natively on cc and pi;
exists-but-effectively-unreachable on Codex; **not found at all on DSH**.
Notification-equivalent exists on cc; is explicitly a different mechanism
on Codex (bridged); **not found on pi or DSH** in this survey. A native
declarative permission-rule layer (deny/ask/allow by string pattern,
independent of any hook) exists only on Claude Code — pi and DSH have no
such thing, so *every* guard-style hook (not just git-guard) is load-bearing
on those two, not a redundant belt-and-suspenders layer the way it can look
on cc.

## 1. Core hooks (`runtime/yoki/scripts/hooks/`)

| hook | event | what it does | native equivalent? (cc / codex / pi / dsh) | community standard? | recommendation |
|---|---|---|---|---|---|
| `artifact-comments.js` | SessionStart / UserPromptSubmit | Surfaces unread yoki-artifact comments as context. | cc: no push-notify hook event for this (Notification's matcher list has no artifact-comment type); pi/codex/dsh: same, and none of them have the Artifact feature at all — this is inherently cc/claude.ai-product-specific plumbing surfaced to other harnesses only because the *agent* might be running there. | Not a general pattern — specific to this product's own Artifact feature. | **KEEP-AS-PLUGIN** (pure I/O plumbing, not policy). |
| `codex-notify.js` | Codex's `notify` program (not a hooks.json event) | Bridges Codex's own notify payload to the same macOS notification UX `Notification` gives natively on cc. | cc: native (`Notification`, `permission_prompt`/`idle_prompt` — already used directly in `personal/settings.personal.json`); codex: no `Notification` hook event, `notify` config key is the *only* channel, so this file is mandatory, not optional; pi/dsh: no notification surface found in this survey either — same gap, currently unaddressed. | Desktop notification on idle/approval is the documented [hooks-guide example](https://code.claude.com/docs/en/hooks-guide#get-notified-when-claude-needs-input) for cc. | **BRIDGE-ONLY** for Codex (mandatory). **NATIVE-ON-1/4** overall — flag pi/dsh notification as an open gap, not urgent. |
| `config-protection.js` | PreToolUse Write\|Edit\|MultiEdit | Blocks edits to existing lint/formatter config files. | cc: native [protected paths](https://code.claude.com/docs/en/permission-modes#protected-paths) list does **not** include eslint/prettier/tsconfig — gap; codex/pi/dsh: no protected-path concept at all (pi/dsh have zero declarative permission layer; Codex's protected-path list, if any, wasn't found) — same gap on all four, and pure stateless path-pattern matching. | Yes — [hooks-guide "Block edits to protected files"](https://code.claude.com/docs/en/hooks-guide#block-edits-to-protected-files) is close to verbatim this hook; multiple real repos independently do file-pattern PreToolUse blocking (§5). | **MOVE-TO-JIG**. Needs zero session/branch state, and jig's PreToolUse-equivalent adapter already reaches all four harnesses — write it once as a `fs.edit`/`fs.write` rule and it's covered everywhere, which a per-harness hook is not. |
| `cost-tracker.js` | Stop (async) | Cross-session cost JSONL, backs the `cost-tracking`/`cost-report` skills. | cc: largely native now (`/usage` session block + 24h/7d attribution by skill/subagent/MCP + status line `cost.total_cost_usd`); codex/pi/dsh: Stop-equivalent event exists on all three (`Stop`, `agent_settled`, `agent/turn-stopping`), but none was confirmed in this survey to expose usage/token figures in that event's payload the way cc's transcript does — **unconfirmed, not verified absent**. | Real repos do Stop-hook cost logging on cc (§5: `biliboss/tmux-agents` types a `Stop` payload with `stop_hook_active`, generic Stop-hook tooling is common); the *durable, cross-machine* version of this is documented as [OpenTelemetry export](https://code.claude.com/docs/en/monitoring-usage), not a bespoke hook, on cc specifically. | **NATIVE-ON-1/4 (cc)** for the reporting surface; unresolved on codex/pi/dsh — needs a follow-up check of what each Stop-equivalent payload actually carries before deciding whether a harness-independent cost hook is worth building, versus leaning on cc's native `/usage` and treating the others as out of scope until the owner runs them for real work. |
| `post-bash-pr-created.js` | PostToolUse Bash (`if: gh pr create*`) | Prints a `gh pr review` reminder. | Trivial on any harness with PostToolUse-equivalent (all four); not worth a cross-harness build either way. | Not a real pattern, just an echo. | **DROP**. |
| `post-edit-format.js` / `quality-gate.js` (and all pack format hooks, §3) | PostToolUse Edit | Auto-format the edited file. | All four have a PostToolUse-equivalent (`PostToolUse`, `PostToolUse`(Codex), `tool_result`, `tools/post-execute`) — genuinely **NATIVE-PATTERN on all four**, just not built-in on any of them (all four need *a* hook/extension/plugin, none do it by default). | Yes, canonical (§5) — **but** one real repo (`marmelab/crm-builder`, §5) found this exact pattern harmful in practice on cc and replaced their PostToolUse-Edit-Prettier hook with a Stop-hook batch format, because per-edit reformatting caused an edit→reformat→re-read confusion loop that burned 4+ minutes per task. Worth weighing before assuming "PostToolUse Edit + formatter" is unconditionally correct. | **KEEP-AS-PLUGIN, all four harnesses** — same shape everywhere (adapter differs, logic doesn't) — but consider the Stop-hook-batch alternative given the real-world failure mode found in §5. |
| `post-edit-typecheck.js` | PostToolUse Edit | `tsc --noEmit` on the edited file. | cc: partially superseded — installed LSP plugins now "report type errors automatically after edits" per the [costs doc](https://code.claude.com/docs/en/costs#install-code-intelligence-plugins-for-typed-languages), and this machine already runs `rust-analyzer-lsp@claude-plugins-official`; codex/pi/dsh: no LSP-plugin-equivalent surface found — this hook's job would need the same PostToolUse-equivalent build as any other language hook. | Same PostToolUse pattern. | **NATIVE-ON-1/4 (cc, once a TS LSP plugin is confirmed)**; **KEEP-AS-PLUGIN** on the other three regardless. |
| `pre-bash-git-push-reminder.js` | PreToolUse Bash | Advisory-only, never blocks; own comment admits it's a stub. | N/A on any harness — it doesn't do anything real to port. | N/A. | **DROP** on all four. |
| `pre-compact.js` | PreCompact | LLM summary before compaction, cross-harness delivery already built (Claude marker file; omp `{summary}` return; Codex/pi via the pending-context queue). | cc: largely superseded by native resume-from-summary + native `PreCompact`/`PostCompact`; codex: event recognized but "unreachable from `codex exec`" per this repo's own comment; pi: **has** `session_before_compact`, actively used in this very repo (`compaction-judgment.ts`) — largely native there too; dsh: **no compact event found at all** in this survey — real gap. | [hooks-guide "Re-inject context after compaction"](https://code.claude.com/docs/en/hooks-guide#re-inject-context-after-compaction) is documented for cc; a real repo (`oliver-kriska/claude-elixir-phoenix`, §5) does exactly this — re-injecting "the active phase's rules plus scratchpad dead ends" on `PreCompact`. | **NATIVE-ON-2/4 (cc, pi)**. **KEEP as harness-independent bridge for Codex (best-effort) and DSH (only real option — no native hook to fall back on at all).** |
| `pre-edit-write-suggest-compact.js` | PreToolUse Edit\|Write\|MultiEdit | Token-threshold nudge toward manual `/compact`. | cc: overlaps heavily with native auto-compact + the `strategic-compact` skill already installed in this environment; codex/pi/dsh: no native "suggest compact at a boundary" concept, but also no evidence a duplicate hook is wanted there either — this is a UX nicety, not a safety gap. | Not a distinct pattern from ordinary compact hooks. | **DROP the hook**, keep the `strategic-compact` skill; don't rebuild this cross-harness — low value relative to effort. |
| `pre-rules-context.js` | PreToolUse Read\|Write\|Edit | Backports `paths:`-frontmatter rule loading. | cc: **confirmed fully native** — `.claude/rules/*.md` with `paths:` frontmatter is an official mechanism ([memory doc](https://code.claude.com/docs/en/memory#path-specific-rules)) with its own `InstructionsLoaded` event (`path_glob_match` matcher); codex: no native equivalent — this hook already exists specifically to backport it there; pi: **no native path-scoped rule loading found**, and no existing port of this hook to pi either — real gap; dsh: no native path-scoped rule loading found, but `agent/pre-step` ("decides what the model sees this step") is exactly the right waterfall to build it on — real gap, mechanism exists, implementation doesn't. | `paths:` frontmatter for conditional rule loading is real, adopted community practice on cc specifically (§5: `modu-ai/moai-adk` has 14+ production path-scoped rules; a squad-agent config explicitly recommends "Use paths: frontmatter for conditional rule loading"). | **NATIVE-ON-1/4 (cc only)**. **This is the clearest case in the whole survey for a harness-independent hook**: drop it on cc, keep the existing Codex backport, and **build the missing pi (`before_agent_start`/`tool_call`) and DSH (`agent/pre-step`) ports** — the harness-independent rules `core/rules/README.md` describes are currently invisible on two of the four harnesses the owner runs. |
| `pre-webfetch-websearch-delegate-warn.js` | PreToolUse WebFetch\|WebSearch | Advisory nudge to delegate to a subagent on an expensive model. | No native "delegate this call" mechanism on any of the four; duplicates a rule already in CLAUDE.md context on cc (observed firing redundantly during this very research). | Not a known pattern; bespoke personal-workflow enforcement. | **DROP-or-KEEP-AS-PLUGIN, lean DROP** everywhere — advisory-only, enforces nothing, and CLAUDE.md/AGENTS.md-equivalent instructions already carry the same text on any harness that loads them. |
| `prompt-correction-detect.js` | UserPromptSubmit | Correction → `corrections.jsonl` for `/learn`. | cc: Claude Code now ships native **auto memory** — "notes Claude writes itself based on your corrections," loaded every session ([memory doc](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory)) — significant overlap; codex/pi/dsh: no evidence of an equivalent native auto-memory feature was found in this survey. | Auto memory is Anthropic's own native answer to this exact problem, cc-only. | Flagged, not verdicted (task scope: this is the "learning lane," a separate owner's call) — but the finding is directly relevant: native auto-memory covers this territory on cc but not, as far as this survey found, on the other three. |
| `prompt-pending-context.js` | UserPromptSubmit | Drains the cross-harness pending-context queue for harnesses with no direct injection channel. | Pure glue; not itself a feature question. | — | **BRIDGE-ONLY**, keep as long as any harness lacks a direct channel (currently Codex, per pre-compact.js's own finding). |
| `run-bash-hook.js` | infra | Wraps a `.sh` hook for any harness. | N/A — infra. | — | Keep as harness-bridge plumbing regardless of the rest of this audit. |

## 2. Personal `.sh` hooks (`personal/hooks/`)

| hook | event | what it does | native equivalent? (cc / codex / pi / dsh) | community standard? | recommendation |
|---|---|---|---|---|---|
| `git-guard.sh` | PreToolUse Bash | Branch/session/worktree-aware git safety, PR-gate, identity guard. See **Step 3**. | cc: partial via `permissions.deny: ["Bash(git push *)"]`, but the docs' own example table shows `git -C . push` **isn't matched** — trivially evadable; codex: `PreToolUse` exists and is exactly how a real repo (`zackees/running-process`, §5) gates raw commands today; pi: **no other permission layer exists at all** — `tool_call` is the only possible enforcement point, and public pi plugins (`pi-read-before-write`, `smart-approve`, §5) confirm this is how the community does exactly this kind of gating there; dsh: `tools/pre-execute` is the equivalent, already wired by jig's own DSH adapter for other rules. | Blocking `git push --force`/protecting main is one of the most common hook patterns found in §5 (6+ independent repos, cc-side). Nothing at this level of branch/session-state sophistication was found on any harness, cc included. | **KEEP, stays bash, not jig** (see Step 3) — **and this needs delivering on all four**, since only cc has even a partial native fallback; pi and dsh have *zero* fallback if this hook isn't there. |
| `unattended-guard.sh` | PreToolUse Write\|Edit\|MultiEdit\|Bash | Blocks guardrail self-modification while unattended. | cc: native [protected paths](https://code.claude.com/docs/en/permission-modes#protected-paths) cover `.claude` but are explicitly **not enforced in `bypassPermissions` mode** — the exact mode an unattended run is likely to use — so cc's one overlapping safety net is off when this hook matters most; codex/pi/dsh: no protected-path concept exists at all, so there is no partial fallback whatsoever — this hook is the *entire* safety net on those three. | No equivalent "unattended mode" concept documented on any harness. | **KEEP, stays bash, not jig** (Step 3) — **higher-stakes on pi/dsh than on cc**, since they have nothing else standing between an autonomous run and its own guardrail files. |
| `workflow-guard.sh` | PreToolUse Workflow | Session/daily cost cap for the `Workflow` tool. | `Workflow` is a Claude-Code-specific tool; no direct analog on codex/pi/dsh today (no Workflow-tool concept there), so this one is inherently cc-only regardless of native-feature status. No native per-tool cost cap exists on cc either. | Bespoke to yoki-graph. | **KEEP-AS-PLUGIN on cc only** — same stateful-marker-file shape as git-guard, so also not a jig fit; not applicable to the other three harnesses since the tool itself doesn't exist there. |
| `audit-log.sh` / `mcp-audit.sh` | PostToolUse Bash / `mcp__*` | Append every Bash/MCP call to a log file. | PostToolUse-equivalent exists on all four (§0); no native persistent audit log on any of them. | Matches the documented [hooks-guide "Audit configuration changes"](https://code.claude.com/docs/en/hooks-guide#audit-configuration-changes) pattern (different event, same jq-append shape); "log every tool call" is a very common public hook pattern. | **KEEP-AS-PLUGIN, all four** — cheap, same shape everywhere. |
| `rtk-rewrite.sh` | PreToolUse Bash | Token-saving CLI rewrite via `rtk` — default OFF. | N/A. | Niche. | **DROP** — default-off, self-described as noisy, not earning its keep on any harness. |
| `skill-router.sh` | UserPromptSubmit | Already hands routing to jig's judgment service. | codex/pi/dsh: the "full skill catalog rendered into every prompt" cost is presumably the same wherever a large local skill catalog is rendered client-side; not separately verified per-harness here. | Genuine cost optimization, not an external pattern. | Already MOVE-TO-JIG — **no further action**; example of the boundary working. |
| `worktree-hygiene.sh`, `yoki-project-hint.sh` | SessionStart | Personal/yoki-pack-system nudges (worktree count, undeclared packs). | N/A — tied to yoki's own architecture, not a harness feature gap. | N/A. | Out of scope for native-vs-legacy; not a candidate for jig or a cross-harness port. |
| `english-coach.sh` | UserPromptSubmit | Re-injects the english-coach skill's instructions on a toggle. | Could plausibly be a directly-invoked skill/toggle instead of a hook, on any harness with a skill system. | N/A. | Low priority; **candidate for NATIVE-ish simplification**, not urgent, not harness-dependent. |
| `tmux-sidebar.sh`, `herdr-agent-state.sh` | various | Thin dispatch to third-party tools (`tmux-agent-sidebar`, `herdr`), not yoki logic. | N/A. | N/A. | Out of scope; not yoki's or jig's to change. |

## 3. Pack hooks (`packs/*/hooks/`)

All are the PostToolUse-format/lint-on-edit family, one per language, file-scoped:

| hook | native equivalent? (cc / codex / pi / dsh) | recommendation |
|---|---|---|
| `typescript/ts-lint-post-edit.js` | Same PostToolUse-equivalent-exists-on-all-four answer as `post-edit-format.js` above. cc additionally gets TS LSP-plugin type-error coverage as a bonus, separate from formatting. | **KEEP-AS-PLUGIN, all four.** |
| `go/go-guard-post-edit.js` | Same. No Go LSP plugin confirmed enabled on any harness here, so this fills a real gap everywhere, not just non-cc. | **KEEP-AS-PLUGIN, all four**; re-evaluate if/when an official Go LSP plugin exists. |
| `go/go-guard-race.js` | Stop-equivalent exists on all four (§0); this is exactly the "project-level gate on Stop" use case the harness's own Stop hook is meant for, on any of them. | **KEEP-AS-PLUGIN, all four.** |
| `go/go-version-check.js` | SessionStart-equivalent exists on all four. Low stakes either way. | **KEEP-AS-PLUGIN** (cheap) or DROP as noise — owner's call, not evidence-driven. |
| `web/web-css-lint-post-edit.js`, `python/py-lint-post-edit.js` | Same PostToolUse family. | **KEEP-AS-PLUGIN, all four.** |
| `rust/rust-fmt-post-edit.js` | Same family; check for overlap with the already-enabled `rust-analyzer-lsp@claude-plugins-official` plugin on cc before assuming full duplication of effort is needed there. | **KEEP-AS-PLUGIN, all four**, dedupe against the rust LSP plugin on cc specifically. |

## 4. Hook-profile mechanism (minimal/standard/strict) vs. native

`run-with-flags.js` + `lib/hook-flags.js`: per-project `.yoki.json`
(`hookProfile`, `disabledHooks: [...]`) searched upward from cwd, falling
back to `YOKI_HOOK_PROFILE`/`YOKI_DISABLED_HOOKS` env — per-hook-ID,
per-project granularity.

- **cc**: `disableAllHooks` (all-or-nothing, any settings file); per-project
  settings layering (`.claude/settings.json` vs `.local.json` vs
  `~/.claude/settings.json`) is a native per-project *hook-block-presence*
  story, not a per-hook-ID toggle; a plugin's hooks are enabled/disabled by
  enabling/disabling the whole plugin (`enabledPlugins`) — coarser than one
  hook ID, finer than `disableAllHooks`.
- **codex/pi/dsh**: no per-hook-ID enable/disable mechanism found in this
  survey at all — coarsest of all (whole hooks.json / whole extension /
  whole cordis plugin, on or off).

**Conclusion unchanged, and now confirmed across all four**: no harness has
a native equivalent to yoki's three-tier, per-hook-ID profile system. If
hooks move to per-harness plugins/extensions, expect to trade today's
per-hook-ID granularity for per-plugin/per-extension granularity on every
harness, not just cc — a real, uniform loss in precision, the one place in
this whole survey where "native" isn't strictly better anywhere.

## 5. Real-world survey (GitHub, `gh search code`)

`gh auth status` confirmed authenticated (`repo`/`read:org`/etc.
scopes). Code search itself hit GitHub's **secondary rate limit** (HTTP 403
"API rate limit exceeded") repeatedly mid-survey — each query below
succeeded after a short backoff (`until ...; do sleep 8; done`); a few
planned queries (osascript+Notification, additional cost-tracking variants)
were dropped rather than retried further, so notification/cost coverage in
§1 is based on fewer independent data points than the other categories and
should be treated as thinner evidence.

- **PostToolUse-Edit-format-on-save**: canonical and everywhere (`vivid-life-vs-code`, `commercetools/ui-kit`, `andysingal/llm-course`, `zeffyr-000/suiviseries` all run `PostToolUse(Edit|Write) → prettier/eslint --write`). **Counter-evidence found**: `marmelab/crm-builder`'s changelog documents *removing* exactly this pattern from `atomic-crm` after diagnosing an edit→reformat→re-read confusion loop that cost 4+ minutes per task, replacing it with a Stop-hook batch format instead. Not unanimous best practice — cited in §1.
- **git-push --force / branch guard**: very common, independently reinvented — `j-morgan6/elixir-phoenix-guide`, `kid-sid/claude-spellbook`, `assafkip/kipi-system`, `RayFernando1337/vibestamps`, `avelikiy/great_cto` all block `git push --force` (several also suggest `--force-with-lease`) via `PreToolUse(Bash)`. None found at git-guard.sh's level of branch/worktree/session-state sophistication.
- **Config-file / sensitive-file protection**: also common — `affaan-m/ECC`'s `plankton-code-quality` skill explicitly pairs "PreToolUse blocks + Stop hook detection" for `biome.json`/`.eslintrc*`/`prettier.config*`/`tsconfig.json`/`pyproject.toml` (i.e. exactly config-protection.js's file list); `vamseeachanta/workspace-hub` and `mizkun/vibeflow`/`pneuma-core` all implement the same `exit 2` / `{"decision":"block"}` PreToolUse pattern for protected paths.
- **PreCompact re-injection**: real and documented outside Anthropic too — `oliver-kriska/claude-elixir-phoenix`'s `precompact-rules` hook "re-injects the active phase's rules plus scratchpad dead ends," the same shape as `pre-compact.js`; `qwwiwi/public-architecture-claude-code` chains multiple `PreCompact` handlers (activity-logger, review-reminder, flush-to-openviking, compact-notify) in one project.
- **Codex `hooks.json` in the wild**: real, but self-described as experimental everywhere it's found — `dsmedeiros/armature-public` confirms Codex's `hooks.json` supports `PreToolUse`/`PostToolUse`/`SessionStart`/`Stop` (matching this repo's own `KNOWN_EVENTS`) and recommends it as the native alternative to Claude-Code-style lifecycle hooks; `zackees/running-process` uses Codex `PreToolUse` to deny raw build commands unless routed through a wrapper — the same *shape* as git-guard.sh, on Codex, in production; `iamfakeguru/agent-md` and others independently label Codex hook support "experimental."
- **pi `ExtensionAPI` `tool_call` guards in the wild**: confirmed as a real, independently-invented pattern — `SteelDynamite/pi-read-before-write` and `mentalfl0w/smart-approve` both register `tool_call` (smart-approve also uses `session_start`/`session_shutdown`) to gate tool calls before they run, the same role `guard.ts` plays for jig on pi. This is strong independent confirmation that `tool_call` is *the* place to put any pi-side guard, format hook, or rules-context port.
- **DSH cordis `tools/pre-execute` in the wild**: deepseek-ai's own docs give the canonical waterfall (`tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*`); independent tutorials/blogs (`yanhua1010/dsh-harness-tutorial`, `amlei/harness-learning`, `raksix/lokma`) all describe the same approval-chain semantics (a decision-holding listener skips `next()` to veto; an observer must always call `next()`), consistent with jig's DSH adapter's own design comment.
- **`paths:` frontmatter for conditional rules**: confirmed as real, adopted practice specifically on Claude Code — `modu-ai/moai-adk` (and its template fork) has 14+ production path-scoped rule files and a spec doc noting "Claude Code runtime paths 해석... 런타임 메커니즘 검증됨" (the runtime mechanism is verified working); a "claude-code-mastery" config-engineer agent definition explicitly recommends "Use paths: frontmatter for conditional rule loading" as a technique. No equivalent pattern found for codex/pi/dsh in this survey — consistent with §1's NATIVE-ON-1/4 verdict for `pre-rules-context.js`.

## 6. Hooks that need a harness-independent implementation

Hooks where **at least one of the four harnesses lacks a native equivalent
and the owner runs that harness for real work** — these can't be resolved
by "drop it, the harness does it natively" and need either a jig policy
rule (if stateless) or a small adapter per harness (if not):

1. **`git-guard.sh`** — cc has a partial, evadable native fallback
   (`permissions.deny`); pi and DSH have *no* fallback at all (no
   declarative permission layer exists on either). Must be delivered on
   all four. Stays outside jig (stateful — Step 3).
2. **`unattended-guard.sh`** — cc's one overlapping native protection
   (protected paths) is explicitly disabled in the exact mode
   ("unattended"/`bypassPermissions`) this hook targets; pi/DSH have no
   protected-path concept whatsoever. Must be delivered on all four. Stays
   outside jig (stateful — Step 3).
3. **`config-protection.js`** — no harness protects lint/formatter configs
   natively. Stateless — this is the strongest **MOVE-TO-JIG** candidate in
   the whole survey precisely because it's cheap to make harness-universal
   through jig's existing four adapters.
4. **`pre-rules-context.js`** — native only on cc. Codex already has a
   working backport. **pi and DSH have the right event surface
   (`tool_call`/`before_agent_start`; `agent/pre-step`) but no
   implementation at all** — the clearest concrete gap this survey found:
   `core/rules/README.md`'s conditional-loading contract is currently
   invisible on two of the four harnesses the owner runs.
5. **`pre-compact.js`** — native on cc and pi; nominally present but
   unreachable on Codex; **no event found on DSH at all**. Keep the
   existing cross-harness bridge; DSH has no native fallback to lean on if
   the bridge is ever removed.
6. **Format-on-edit hooks** (`post-edit-format.js`, `quality-gate.js`, all
   of §3) — every harness has the PostToolUse-equivalent surface but none
   does formatting natively; this is "needs an adapter on all four," not
   "gap on some" — already the plan (KEEP-AS-PLUGIN everywhere), listed
   here for completeness since the framing correction asks for every
   harness to be checked, not because it's a surprise finding.
7. **Notification** (`codex-notify.js`'s job) — native on cc; bridged on
   Codex (mandatory, `notify` config); **no notification surface found on
   pi or DSH** in this survey. Lowest priority of this list (cosmetic), but
   a genuine, currently-unaddressed gap if the owner wants idle/approval
   alerts from all four harnesses, not just two.

## 7. Step 3 — git-guard.sh / unattended-guard.sh: "stateful, unrepresentable in jig" — verified, and now cross-harness

**Verified, both hooks, and the state problem is identical on every harness — this isn't a Claude-Code-specific finding.**

`git-guard.sh` reads, per invocation:
- **Current branch** (`git -C "$CWD" rev-parse --abbrev-ref HEAD`).
- **Worktree-vs-main-checkout** (`git rev-parse --git-dir` vs `--git-common-dir`).
- **Session identity + a per-session marker directory** (`~/.claude/.cache/git-guard/<session_id>/`) for "warn once, then allow the identical retry."
- **Other sessions' transcript mtimes in the same project dir** for "another session is live here right now" — a cross-process, point-in-time fact.
- **A content-hash marker file written by a separate command** (`preflight` pass marker) for the PR-gate's 3-strikes-then-disclose counter.
- **A project's `.yoki.json`** (`allowMainBranchWork`) — the one piece that is ordinary stateless project config.

`unattended-guard.sh` reads, per invocation, a **session-mode flag**
(`YOKI_UNATTENDED` env, fixed at session start, or `.yoki.json.unattended`,
re-read per call); everything downstream of that flag is ordinary stateless
path/command matching.

None of this state is a first-class input on **any** of the four harnesses'
PreToolUse-equivalent payload — not `cwd`+`session_id` on cc, not the
`ToolExecution` shape DSH's `tools/pre-execute` hands a cordis plugin
(§dsh adapter source: `callId`, `name`, `arguments`, `agent.session`), not
pi's `tool_call` event, not Codex's `PreToolUse` JSON. On every harness it
is a subprocess call (`git`) or a hand-rolled marker-file cache the hook
itself maintains — the same shape of workaround, four times over. A
**plugin hook / extension / cordis plugin** can still do all of this on any
of the four (it's just code with the same subprocess/marker-file access,
wherever it runs) — the state isn't unavailable to *bash or TypeScript*, it
is unavailable to **jig's stateless rule model** specifically, which (per
the harness-parity project) evaluates a rule as a pure function of the
current call, not of session history, other processes' file mtimes, or
accumulated per-session counters, on any harness.

**Verdict, now explicitly cross-harness: both hooks stay outside jig on all
four harnesses, and both need to actually exist on all four**, not just cc
— per §0/§6, pi and DSH have *no* fallback protection at all if these two
hooks aren't there, which makes them higher-stakes on pi/DSH than they are
on cc (where `permissions.deny`/protected-paths offer a partial, if
evadable, safety net). The right delivery shape is **KEEP, as a
harness-native plugin/extension/cordis-plugin per harness** (still doing
`git` subprocess calls and marker files under the hood) rather than through
yoki's bespoke `run-with-flags.js`/profile system — that profile/`.yoki.json`
plumbing is the one part of today's delivery with no reason to exist once
these become native per-harness hooks with their own defaults.
