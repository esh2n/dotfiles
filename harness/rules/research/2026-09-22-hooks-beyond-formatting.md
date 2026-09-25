---
question: "Which coding-agent hooks beyond format/lint/typecheck does the industry actually run in 2026, and which have measured value?"
date: 2026-09-22
verdict: "Audit-logging and cost/budget-guard hooks are strictly superseded by native vendor features (Claude Code's OTel export, --max-budget-usd with tamper-proof deny hooks); command-output rewriting (rtk-style) is not redundant with native compaction and is vendor-endorsed; session-start hint and prompt-injection coaching hooks are common in the wild but have zero measured outcome evidence and documented harness-level failure modes (blocked input, crashed sessions, broken prompt caching)."
unverified:
  - "no independent (non-vendor) practitioner account of adopting or abandoning rtk or a similar command-rewriting tool"
  - "no Codex-native equivalent to Claude Code's OTEL_LOG_TOOL_DETAILS/tool_decision audit schema found — docs pages not reached, not confirmed absent"
  - "no Codex-native dollar-budget cap flag equivalent to --max-budget-usd found in reachable docs"
  - "no data on pi / Oh My Pi (OMP) / DSH native audit-logging or budget-guard equivalents — out of this session's research budget"
  - "no measured (numeric) evidence in any direction for session-start hint hooks or UserPromptSubmit coaching/routing hooks changing task outcomes"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Which coding-agent hooks (beyond format/lint/typecheck) does the industry actually run in 2026, and which have measured value?

Decision this feeds: a personal harness registers 12 non-formatter hook scripts in Claude Code; a rebuild must decide which categories survive.

## Method and verification legend

- **[direct]** — fetched the primary page/file myself (WebFetch on a vendor doc, `curl` on a raw `.md`/source file, `gh api`/`gh search` against GitHub's API).
- **[summarized]** — reached through WebFetch's summarizing model rather than reading raw text; flagged inline where it materially matters.
- **[not reached]** — URL existed but 404'd, redirected past what I could re-fetch, or hit a rate limit; noted as "not found" per the rules of evidence (not found ≠ absent).
- `gh search code` / `gh api search/code` results are keyword matches inside files named `settings.json`; counts are the API's `total_count`, an upper bound that includes false positives (the term appearing in an unrelated JSON file called `settings.json`), not a clean count of Claude Code hook configs. Treated as an order of magnitude, not an exact adoption number.
- WebSearch was unavailable for this session (budget exhausted before this task started) — every claim below comes from WebFetch, `curl`, or `gh`, as the task instructed.
- Known channel bias: GitHub issue trackers skew negative (people who file issues had a bad time); vendor docs skew toward the vendor's own feature; a repo full of hook scripts says a maintainer wrote them, not that they measured value.

---

## 1. Command rewriting for token saving (`rtk` and similar)

**Vendor — rtk itself** [direct, `github.com/rtk-ai/rtk`, README fetched via `raw.githubusercontent.com/rtk-ai/rtk/develop/README.md`]

- Found it: `rtk-ai/rtk`, homepage `rtk-ai.app`, Apache-2.0, Rust, created 2026-01-22, last push 2026-09-21 (active, daily commits).
- Claim, verbatim from the README: "High-performance CLI proxy that cuts up to 90% of the bash output your agent reads." It rewrites `git`, `ls`, `cat`, `grep`, test runners (`pytest`, `go test`, `cargo test`, `npm test`), linters, `docker ps`, etc. into compact forms via a Bash-tool hook (`rtk init -g`) that transparently prefixes commands with `rtk`.
- The vendor's own caveat page, `docs/guide/resources/savings-explained.md` [direct], is unusually candid: *"So the reduction dilutes at every step: a large cut in bash output produces a smaller cut in input tokens, and a smaller one again in cost. A command showing 90% fewer output bytes does not make your session 90% cheaper."* It also discloses the token counter is `bytes / 4` with **no real tokenizer**: *"The percentage is reliable... The absolute token counts are approximate. They will not match your provider's billing."*
- Supported targets per the Quick Start block include Claude Code, Gemini CLI, Codex, Cursor, Windsurf, Cline, Kilo Code, Antigravity, Kimi, **Pi**, **Oh My Pi (OMP)**, Hermes, Factory Droid, Trae — confirming these are real, separately-adopted harnesses, not the requesting repo's own naming.
- Explicit scope limit in the README: *"the hook only runs on Bash tool calls. Claude Code built-in tools like Read, Grep, and Glob do not pass through the Bash hook, so they are not auto-rewritten."*

**Measured / in the wild — rtk** [direct, `gh api repos/rtk-ai/rtk`, `gh api search/issues?q=repo:rtk-ai/rtk`]

- 81,356 stars, 5,155 forks, 217 subscribers, 1,555 **open** issues, 1,668 issues total, 8 months old (created 2026-01-22). Growth this fast on a single-purpose Rust CLI is itself worth flagging as `[unverified]` for organic-vs-inflated star counts — I had no tool to check star-history authenticity, only the raw count.
- Concrete, currently-open correctness bugs (5 of many, with dates), i.e. the failure modes the task asked for:
  - `#4189` (2026-09-22, open): *"`rtk rewrite` skips rewriting entirely when the command contains a pipe."*
  - `#4183` (2026-09-21, open): *"git diff/status output can contain text that exists nowhere on disk"* — a fabrication/hallucination-adjacent bug in the compaction itself.
  - `#4178` (2026-09-21, open): *"pytest --collect-only renders as 'No tests collected' while 15 tests collected"* — silently wrong summary.
  - `#4158` (2026-09-20, open): *"uv_cmd discards print_with_hint's return value, so the tee hint is not counted and savings read 100%"* — the tool's own reported savings number is not trustworthy in this path.
  - `#4161`/`#4155` (2026-09-20, open): `rtk git log` bugs that report the wrong commits or print nothing, because rtk feeds `-10`/stdin handling through its own filter incorrectly.
  - Recently-merged fixes (`#4122`, `#4121`, `#4120`, `#4119`, `#4168`) show these are being actively patched, not ignored — but the open-issue count (1,555) relative to the repo's age says correctness debt is accumulating faster than it's paid down.

**Practitioners** — not independently found within this session's tool access: no named blogger's own site with a "we tried rtk / rolled it back" account turned up (WebSearch unavailable, and rtk's Discord is not `curl`-able). Treat as **no precedent found** for this specific angle rather than as a negative result.

**Does Claude Code natively make this redundant?** [direct, `code.claude.com/docs/en/costs.md`]

No — and the vendor's own docs argue the opposite. Claude Code's native cost-reduction machinery is **prompt caching** (caches repeated prefixes) and **auto-compaction** (summarizes old conversation history when near the context limit) — neither is per-command output truncation. Claude Code's official "Manage costs effectively" page has a whole subsection, **"Offload processing to hooks and skills"**, that recommends exactly rtk's category of hook, with a full worked example:

> "Custom hooks can preprocess data before Claude sees it. Instead of Claude reading a 10,000-line log file to find errors, a hook can grep for `ERROR` and return only matching lines, reducing context from tens of thousands of tokens to hundreds."

...followed by a complete `PreToolUse` + `filter-test-output.sh` example that intercepts `npm test`/`pytest`/`go test`, greps for `FAIL|ERROR`, and rewrites `tool_input.command` — structurally identical to what rtk does for test runners. **Conclusion: command-output filtering is not redundant with any native Claude Code feature; the vendor documents and endorses hand-rolled hooks for it.** What is redundant is *conversation-level* compaction, which Claude Code already does on its own.

**In the wild** — the pattern (a hook rewriting/filtering bash output) does not commonly appear as literal `rtk` in `.claude/settings.json` searches (rtk installs itself outside `settings.json`, via its own `rtk init` writer), so `gh search code` undercounts it; I did not find a clean way to count rtk-hook adoption directly in this session.

---

## 2. Audit logging of tool calls

**Vendor — Claude Code** [direct, `code.claude.com/docs/en/monitoring-usage.md`]

Claude Code ships native OpenTelemetry export that already is an audit log: *"Tool result events (`claude_code.tool_result`): Logged when tools complete, including tool_name, tool_use_id, success status, duration_ms, and error details"* and *"Tool decision events (`claude_code.tool_decision`): Track permission decisions (accept/reject) with decision_source indicating whether the decision came from config, hook, user prompt, or auto-approval."* Setting `OTEL_LOG_TOOL_DETAILS=1` logs full tool parameters (command text, file paths). This is a superset of what a typical hand-rolled `PostToolUse` → `echo >> audit.log` hook produces (structured events, spans, cost/token attribution, `agent.name`/`skill.name`/`mcp_server.name` attribution) and routes to a real observability backend rather than a flat text file.

**Vendor — Codex (OpenAI)** [direct, `raw.githubusercontent.com/openai/codex/main/docs/config.md`; `gh search code approval_policy repo:openai/codex`]

Codex's `docs/config.md` documents a **"Lifecycle hooks"** section at the admin/config level: *"Admins can set top-level `allow_managed_hooks_only = true` in requirements.toml to ignore user, project, and session hook configs while still allowing managed hooks from requirements and managed config layers."* This confirms Codex has its own hook system with an admin override, separate from Claude Code's. The full docs pages for hook event types were not reachable this session (`developers.openai.com/codex/*` 308-redirects to `learn.chatgpt.com/docs/...`, which then 404'd on the specific sub-pages I tried) — **[not reached]** for exact Codex hook event names and whether Codex ships native per-call audit logging equivalent to Claude Code's OTel export. Codex's execution-gating primitive is confirmed directly from source (`codex-rs/core/src/session/step_settings.rs`, `codex-rs/protocol/src/environment.rs`): an `AskForApproval` enum (`unless-trusted`, `never`, and others referenced in `codex-rs/prompts/templates/permissions/approval_policy/`) that every tool call is checked against before execution — this is Codex's audit/gate primitive, and it is native, not a hook.

**pi / OMP (Oh My Pi) / DSH** — confirmed to be real, separately-maintained public tools (`can1357/oh-my-pi`, 32,431 stars, pushed 2026-09-22; multiple companion projects like `oh-my-pi-gui`), but I did not have budget in this session to verify whether they ship native audit/telemetry equivalents to Claude Code's OTel export or Codex's approval gate. **[not investigated — mark unverified, not "no native logging."]**

**In the wild** [direct, `gh search code`]

`gh search code "PostToolUse" "audit.log"` and `gh api search/code?q=PostToolUse+audit+filename:settings.json` (total_count ≈ 1,632) turned up real, concrete examples of hand-rolled audit-logging hooks, with last-push context:
- `agulli/atlas-agents` (`ch10_claude_code_antigravity/.claude/settings.json`): `PreToolUse` hook running `echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) CMD: $CLAUDE_TOOL_INPUT" >> .claude/bash_audit.log` — a textbook example of the category, in what reads as a book/course companion repo.
- `biffjezos/bbn` (`.claude/hooks/posttooluse-audit.sh`): *"PostToolUse audit hook — logs every file-modifying or shell action with timestamp... Output: .claude/session-audit.log (TSV: timestamp | tool | detail)."*
- `ganchevdimitarg/e-commorce` (`.claude/hooks.md`): documents an async `audit-log.sh` that "append[s] every command to .claude/audit.log," explicitly marked "all advisory — fail open" in its own docs.
- `awslabs/aidlc-workflows` (`harness/claude/settings.json`): a `PreToolUse` hook that shells out to a Bun/TypeScript "aidlc.ts engine hook write-audit-log" — a more structured version of the same idea, inside an AWS-authored repo.
- `ben-manes/caffeine` (`.claude/settings.json`): `audit-report-guard.sh` as a `PreToolUse` hook, in a long-lived, well-known Java caching-library repo (not a throwaway template).

**Verdict for this category**: prevalent in the wild as flat-file `echo >> log` hooks, but every example found is strictly less capable than Claude Code's native OTel `tool_result`/`tool_decision` events, which already carry structured fields, permission-decision provenance, and cost attribution. A hand-rolled audit hook adds value only where OTel export is not wired up (no observability backend deployed) or where the log must be a plain local file for a non-telemetry consumer (e.g., a compliance reviewer who wants `grep`-able text, not a Prometheus/OTLP pipeline).

---

## 3. Session-start hooks (environment hints, worktree hygiene, version checks)

**Vendor** [direct, `code.claude.com/docs/en/hooks-guide.md`]

Claude Code's own guide gives `SessionStart` two blessed use cases, both with worked examples: (1) re-injecting critical context after compaction — *"When Claude's context window fills up, compaction summarizes the conversation to free space. This can lose important details. Use a SessionStart hook with a compact matcher to re-inject critical context after every compaction"* — and (2) loading directory-scoped environment variables via `direnv`, paired with a `CwdChanged` hook so it re-fires on `cd`. Notably, for the generic "inject context every session" case the vendor steers people **away** from `SessionStart` hooks: *"For injecting context on every session start, consider using CLAUDE.md instead."*

**In the wild** [direct, `gh search code SessionStart filename:settings.json`, total_count ≈ 11,264 as an upper-bound keyword hit count]

20+ distinct concrete repos surfaced in a single page, e.g.: `samply/blaze` (health-data FHIR server, real production repo), `vanzan01/claude-code-sub-agent-collective` (template), `jesseleite/dotfiles`, `Positronic-Robotics/positronic`, `wrg32786/aigent-os` (a `sessionstart-reinject.mjs` daemon — the exact compaction-reinjection pattern the vendor's own doc describes), `agents-squads/squads-cli` (scaffolding template). Mix of real product repos and dotfiles/template repos — prevalence is real but skews toward "someone's personal harness config," same category as the requesting repo.

**Measured evidence of outcome change**: none found. No benchmark, no before/after number, on whether a `SessionStart` hint hook changes task success or session quality — this is a **"no numbers"** category across all four lenses.

**Negative evidence** [direct, `gh search issues repo:anthropics/claude-code`]:
- `#60112` (closed): *"SessionStart Hook in Project Settings Crashes All Agent View Background Sessions."*
- `#73363` (open, 2026-08-19): *"Background sessions from a non-git dir deadlock when any WorktreeCreate hook is configured (hooks can't decline)"* — adjacent session-start/worktree-hygiene category, same failure shape.

---

## 4. Prompt-injection hooks (`UserPromptSubmit` — coaching, routing, context)

**Vendor guidance on hooks vs. rules/skills** [direct, `code.claude.com/docs/en/hooks-guide.md`]

The vendor's stated design intent for hooks generally: *"Hooks are user-defined shell commands... which gives you deterministic control: certain actions always happen rather than relying on the LLM to choose to run them."* For `UserPromptSubmit` specifically, structured output is `hookSpecificOutput.additionalContext`, with the worked example being dynamic, per-turn state (*"Current branch: release-42. Deploy freeze until Friday."*) — i.e., the vendor's own example is for facts that change turn-to-turn, not static coaching text, which is explicitly pointed at CLAUDE.md instead (same quote as §3).

**In the wild** [direct, `gh api search/code?q=UserPromptSubmit+filename:settings.json`, total_count ≈ 7,168]

Concrete, dated examples across the full range the task asked about:
- **Coaching/keyword-routing**: `ZIONISREAL/Claude-Praxis` (`settings.json.sample`) — a hook that greps the prompt for `refactor|implement|architect|migrate|debug|fix bug|redesign|build a` and injects `"[Harness reminder] This prompt suggests non-trivial work. Verify execution mode..."` — this is a hook doing what a skill's trigger description is supposed to do.
- **Hard rule injection every turn**: `bright-interaction/second-brain-for-claude` injects a 5-point numbered "ENFORCED RULES (no interpretation, execute exactly)" block via `additionalContext` on every prompt — the exact anti-pattern the vendor's own guidance steers away from ("for injecting context on every session start/turn, consider CLAUDE.md instead").
- **Journaling**: `wrg32786/aigent-os` — `userpromptsubmit-journal.mjs`, logs every prompt.
- Framework-level adoption: `carlrannaberg/claudekit`, `sorah/config` (personal dotfiles, Jsonnet-generated), `mehd-io/dotfiles`, `Prorise-cool/Claude-Code-Multi-Agent`, `l33tdawg/sage` — all real, separately-maintained repos, not templates only.

**Measured evidence**: none found — no A/B or before/after data on whether `UserPromptSubmit` coaching hooks change outcomes vs. the same instructions living in CLAUDE.md or a skill description. **"No numbers."**

**Negative evidence** [direct, `gh search issues repo:anthropics/claude-code`]:
- `#64223` (closed, 2026-08-02): *"UserPromptSubmit hook failure blocks all input when plugin cache file is missing [Errno 2]"* — a session-availability failure caused directly by this hook category.
- `#84011` (open, 2026-08-20): *"PreToolUse hook additionalContext loses trailing newline on history rebuild, breaking prompt cache at the first tool call of every turn"* — a hook using the injection mechanism silently defeats prompt caching, i.e. it can make the session *more* expensive, not less.

---

## 5. Cost / budget guard hooks at tool boundaries

**Vendor — Claude Code has a native flag for this** [direct, `code.claude.com/docs/en/costs.md`]

Claude Code ships `--max-budget-usd` as a CLI flag, referenced directly in the docs' cost-multiplier discussion (*"the multiplied figure also counts toward `--max-budget-usd`"*), plus native permission modes (`bypassPermissions`, plan mode, etc.) and, at the hook layer, an explicit guarantee that a `PreToolUse` `deny` **cannot be bypassed even in `bypassPermissions` mode**: *"A hook that returns `permissionDecision: 'deny'` blocks the tool even in `bypassPermissions` mode or with `--dangerously-skip-permissions`. This lets you enforce policy that users can't bypass by changing their permission mode."* But the reverse also holds — *"a hook returning 'allow' doesn't bypass deny rules from settings... Hooks can tighten restrictions but not loosen them past what permission rules allow"* — so a hook-based budget guard can only add friction, never substitute for the native flag as the actual ceiling.

**Vendor — Codex** [direct, GitHub source: `codex-rs/core/src/session/step_settings.rs`, `codex-rs/execpolicy/src/decision.rs`]

Codex's native gate is the `approval_policy`/`AskForApproval` enum, checked before every exec; the `never` value is explicitly documented in source comments as auto-rejecting anything needing explicit approval (`execpolicy/src/decision.rs`: *"Request explicit user approval; rejected outright when running with `approval_policy=\"never\"`"*). This is a per-call gate, not a dollar-budget cap — Codex's equivalent to Claude Code's `--max-budget-usd` was not found in the reachable docs this session (**[not reached]** for a direct Codex spend-cap flag).

**In the wild** [direct, `gh api search/code`]

Direct evidence that people *reference* the native flag from inside their own tooling rather than reinventing it: `markus-global/markus` UI locale strings literally say *"budgetCapHint": "Hard limit enforced by Claude Code via --max-budget-usd"* (in both English and Chinese locale files) — a third-party product surfacing Claude Code's own native flag to its users rather than building a hook-based guard. A parity-tracking doc, `SSFSKIM/somersault` (`CC-to-SDK/docs/parity/data/c1-boot-settings.json`), independently lists `max-turns`/`max-budget-usd`/`task-budget` together as the native boot-time limits it is tracking parity for. Searching for a hook-shaped `cost_guard`/`budget guard` pattern specifically in `.claude/settings.json` did **not** turn up a live example in this session — the `cost_guard` hits that came back were unrelated application code (a LangChain travel agent, a job-search bot's LangGraph node, an internal FinOps helper), not Claude Code hooks. **Read this as absence-of-evidence, not evidence-of-absence** — the search terms may simply not match how people name these hooks — but combined with the native-flag references above, it suggests the native flag, not a hook, is the default reach for this category.

---

## Summary table

| # | Category | Vendor native equivalent exists? | Measured numbers | In-the-wild adoption (order of magnitude) | Named failure modes |
|---|---|---|---|---|---|
| 1 | Command output rewriting (rtk-style) | No (native = conversation compaction, different layer) — vendor's own docs recommend hand-rolled filtering hooks | rtk vendor discloses its own numbers are estimates (`bytes/4`, no tokenizer); no independent practitioner measurement found | 81k stars / 5.1k forks for rtk itself; hook pattern itself not cleanly countable via `gh search` | rtk: pipe-skipped rewriting, fabricated diff text, false 100% savings, wrong `git log` output — 1,555 open issues on an 8-month-old repo |
| 2 | Audit logging of tool calls | Yes — Claude Code OTel (`tool_result`/`tool_decision` events); Codex has an admin-governed hook layer but its native audit-log equivalent wasn't reachable this session | none | ~1,600+ keyword hits in `settings.json`; 5 concrete repos cited, spanning real production code to book companions | none specific found; general hook-crash issues apply |
| 3 | Session-start hooks | Partial — vendor steers static context to CLAUDE.md, reserves `SessionStart` for compaction re-injection and env reload | none | ~11k keyword hits; 20+ distinct repos in one page | `#60112` crashes background sessions; `#73363` deadlocks worktree creation |
| 4 | Prompt-injection (`UserPromptSubmit`) | Partial — vendor explicitly prefers CLAUDE.md/skills for static injection | none | ~7k keyword hits; concrete coaching/routing/rule-injection examples found | `#64223` blocks all input on hook failure; `#84011` breaks prompt cache every turn (raises cost) |
| 5 | Cost/budget guard hooks | Yes — Claude Code `--max-budget-usd` + tamper-proof deny hooks; Codex `approval_policy`/`AskForApproval` | none | Hook-shaped budget guards not found in the wild; third parties reference the native flag instead | n/a (native path preferred) |

## Verdict

Two of the five categories (audit logging, cost/budget guards) have a **native, vendor-shipped equivalent that is strictly more capable** than a hand-rolled hook — Claude Code's OTel export already produces structured, attributed tool-call logs, and `--max-budget-usd` plus tamper-proof `deny` hooks already cap spend in a way a bespoke hook cannot outdo (it can only add friction on top). A hook still earns its keep here only where OTel isn't deployed, or where a plain local text log is the actual deliverable (e.g. handed to a non-technical auditor).

Command-output rewriting (category 1) is the opposite case: Claude Code's own official cost-reduction docs recommend exactly this pattern (their worked example is a `PreToolUse` test-output filter), so it is *not* redundant with anything native — compaction operates on conversation history, not per-command bytes. The specific tool named in the request, rtk, is real, fast-growing, and vendor-honest about its own measurement limits, but is also carrying a large and current correctness-bug backlog (broken pipe handling, fabricated output, unreliable self-reported savings) — the in-the-wild evidence supports "the category is real and vendor-endorsed" but not "this specific implementation is safe to trust blindly."

Session-start hints and prompt-injection coaching (categories 3 and 4) are the weakest categories by evidence: real and common in the wild, but with zero measured-outcome evidence in any direction, explicit vendor guidance to prefer CLAUDE.md/skills for the static case, and concrete GitHub issues showing both categories have caused session-level failures (blocked input, crashed background sessions, broken prompt caching — the last one actively working against the cost goal these hooks are often deployed for). Nothing here says "don't use them"; it says the burden of proof sits with the harness author, not with the industry, since the industry itself has not measured this.

## No-precedent-found list

- No independent (non-vendor) practitioner account of adopting or abandoning rtk or a similar command-rewriting tool.
- No Codex-native equivalent to Claude Code's `OTEL_LOG_TOOL_DETAILS`/`tool_decision` audit event schema found in reachable docs (page redirects/404s blocked verification either way — this is "not reached," not "confirmed absent").
- No Codex-native dollar-budget cap flag equivalent to `--max-budget-usd` found in reachable docs.
- No data on pi / Oh My Pi (OMP) / DSH native audit-logging or budget-guard equivalents — confirmed these tools exist and are separately adopted (rtk supports them as install targets; `oh-my-pi` has 32k+ stars), but their own hook/telemetry surfaces were out of this session's research budget.
- No measured (numeric) evidence in any direction for session-start hint hooks or `UserPromptSubmit` coaching/routing hooks changing task outcomes.
