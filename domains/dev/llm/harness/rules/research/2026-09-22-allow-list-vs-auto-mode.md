---
question: "Does the evidence support dropping a personal Claude Code allow-list in favor of auto mode's classifier, and what does it cost?"
date: 2026-09-22
verdict: "Allow rules and the classifier are complementary, not redundant — auto mode itself only prunes broad/dangerous allow rules; dropping a 71-rule allow-list trades a deterministic 0%-error path for a classifier with a vendor-measured ~17% FNR on hard cases and documented cases of overriding matching allow rules, with no vendor or practitioner source found supporting full removal."
unverified:
  - "No practitioner or vendor source found arguing auto mode makes allow-lists pointless and should be removed"
  - "No classifier-accuracy numbers for routine, repeated actions specifically (vendor's 17%/5.7%/0.4% figures are for curated hard-case test sets, not e.g. git commit)"
  - "No 10-repo sample of committed personal settings.json files with defaultMode auto — code search found almost none"
  - "DSH/cordis and pi/omp permission models were not reached (no public docs found without WebSearch)"
  - "Whether the found GitHub issues (allow vetoed by classifier, deny bypassed under auto mode) are still reproducible in the current Claude Code version"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Allow-lists alongside classifier "auto" modes (2026-09-22)

## Question

A personal Claude Code config has `permissions.allow` = 71 rules, `permissions.deny` = 76, `defaultMode: "auto"`. A rebuild proposes: keep deny (projected from a guard policy) + a PreToolUse guard hook, **drop all allow rules**, let auto mode's classifier decide the rest. Does the evidence support dropping the allow-list, and what does it cost?

## Method and verification legend

- **Direct fetch, verified**: `code.claude.com/docs/en/*.md` (fetched raw Markdown, read in full — not summarized) and `anthropic.com/engineering/claude-code-auto-mode` (fetched via `curl`, quotes checked against the raw HTML text with `grep`/Python, not just the WebFetch summary).
- **Summarizing fetch** (WebFetch runs a small model over the page and returns a digest — quotes below are as returned by that digest, not independently re-verified against raw HTML unless noted): Codex docs (`learn.chatgpt.com/docs/config-file/*`), Simon Willison's posts, embracethered.com.
- **Primary source via `gh api`**: GitHub issue bodies (`anthropics/claude-code`) and one third-party `settings.local.json.template` — read verbatim, not summarized.
- **Not reachable**: `raw.githubusercontent.com/openai/codex/main/docs/config.md` (page exists but is a stub pointing elsewhere; DSH/cordis not checked — no public docs found in the time available, listed under "no precedent found").
- WebSearch was unavailable for this session (budget exhausted by prior activity in the same session) — the "In the wild" and "Practitioners" lenses rely on `gh search code`, `gh api search/issues`, and direct WebFetch of specific URLs rather than open search.

---

## 1. Vendors

### Claude Code — allow rules and the classifier are architecturally distinct paths

`permission-modes.md`, "How the classifier evaluates actions" (direct fetch, verbatim):

> "Each action goes through a fixed decision order. The first matching step wins:
> 1. Actions matching your allow, ask, or deny rules resolve immediately, with these exceptions: [protected-path writes, critical-path `rm`/`rmdir`, `requiresUserInteraction` MCP tools, org-`ask` connector tools, per-command sandbox domains, and content-matching ask rules]
> 2. Read-only actions and file edits in your working directory are auto-approved, except writes to protected paths and the first read outside the working directories
> 3. Everything else goes to the classifier."
(https://code.claude.com/docs/en/permission-modes.md)

So allow rules are not made redundant by auto mode — they are the *first* gate, and matching them means the request never reaches the classifier at all, with a short, named list of exceptions (protected/critical paths, requiresUserInteraction, org-forced ask).

Auto mode **automatically drops** a subset of allow rules on entry, but keeps the rest:

> "On entering auto mode, broad allow rules that grant arbitrary code execution are dropped: Blanket `Bash(*)` or `PowerShell(*)`; Wildcarded interpreters like `Bash(python*)`; Package-manager run commands; `Agent` allow rules; `Monitor` allow rules... Narrow rules like `Bash(npm test)` stay in effect. Claude Code restores the dropped rules when you leave auto mode."
(https://code.claude.com/docs/en/permission-modes.md)

This means most of a 71-rule allow-list in the style of `Edit(./**)`, `Bash(git commit *)`, `Bash(npm run *)` is **not** dropped by auto mode — it continues to short-circuit the classifier for those specific calls. The proposed rebuild removing all 71 rules gives up that short-circuit for every one of those actions, not just the broad/dangerous ones auto mode already strips.

### Cost/latency — allow rules skip a real round-trip, and on some billing paths a real charge

`permission-modes.md`, "Cost and latency" accordion (direct fetch, verbatim):

> "The classifier runs on Claude Sonnet 5 by default... On Enterprise plans and on accounts that use the Claude API, Claude Platform on AWS, Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry, classifier calls count toward your token usage. Each check sends a portion of the transcript plus the pending action, adding a round-trip before execution. Reads and working-directory edits outside protected paths skip the classifier, so the overhead comes mainly from shell commands and network operations."
(https://code.claude.com/docs/en/permission-modes.md)

On a Pro/Max/Team subscription (the common personal-config case), classifier calls are not separately billed, but the round-trip latency is still real (the request goes to Sonnet 5 regardless of the session's own model, per the same section) — dropping allow rules trades a zero-latency local rule match for a model call on every one of those Bash/network actions.

### Vendor's own framing of why allow rules exist and are kept

The Anthropic engineering blog (see §3, "Measured") states directly: *"Many users set up these blanket rules for convenience in manual-approval mode, but leaving them active would mean the classifier never sees the commands most capable of causing damage. Narrow rules ('allow running code formatters') carry over, but broad interpreter escapes don't."* — i.e. Anthropic's own design intent is selective pruning of allow rules (broad/dangerous only), not wholesale removal. Tier 1 of their three-tier design is explicitly "Built-in safe-tool allowlist **and user settings**" — user allow rules are load-bearing infrastructure in the design, not a vestige auto mode obsoletes.

### `dontAsk` mode depends on allow rules existing

`permission-modes.md` (direct fetch): `dontAsk` mode "auto-denies every tool call that would otherwise prompt... plus actions matching your `permissions.allow` rules". A config that drops all allow rules loses the ability to ever use `dontAsk` (CI/locked-down mode) productively, since nothing but the built-in read-only set and hook-approved calls would run.

### Deny rules are not exempt from classifier interaction either

`permissions.md` (direct fetch): "Rules are evaluated in order: deny, then ask, then allow. The first match in that order determines the outcome." This is the documented contract. Section 4 below shows this contract has open, reproduced counter-examples specifically under auto mode.

### Codex — no classifier, no allow-list; a structurally different model

Codex config docs (`learn.chatgpt.com/docs/config-file/config-basic` and `config-reference`, summarizing fetch):

> `approval_policy`: `"on-request"` (interactive prompts) | `"never"` (auto-reject/no prompts) | `{ granular = {...} }` (per-category: sandbox escalation, execution rules, MCP elicitations, permission requests, skill approval).
> Sandbox/permission control is via named profiles (`:read-only`, `:workspace`, `:danger-full-access`) with filesystem and network allow/deny tables, not a per-command rule list.
> "The documentation does not mention a per-command static allow-list mechanism like Claude Code's `permissions.allow`." / "No classifier-driven auto-approval is documented — approval relies on explicit policy configuration and user interaction."

So Codex has neither a per-command allow-list nor a classifier at all — it's not a second data point for "industry moves from allow-lists to classifiers," it's evidence that Claude Code's classifier is currently a vendor-specific mechanism, not a converged industry pattern. `[unverified]`: pi, omp, and DSH/cordis permission models were not reachable in the time available (no public docs found via WebFetch without search) — listed under "no precedent found."

---

## 2. Practitioners

### Simon Willison — trusts auto mode's convenience claim, not its safety envelope; prefers deterministic sandboxing over relying on it as a boundary (summarizing fetch, both posts)

From https://simonwillison.net/2026/Aug/8/auto-mode/:
> "I absolutely buy that auto mode is a better solution than asking humans to constantly approve actions." But: "I'd like to see more independent confirmation of this" (re: prompt-injection resistance), and he names a concrete gap auto mode can't close — a malicious package embedding hidden instructions in its own docs — concluding "I'm not sure how any version of auto mode could protect against that kind of malfeasance." His stated preference: run agents "such that they don't have access to data or tools that can cause harm if triggered in the wrong way" — i.e. boundary via sandbox/capability restriction, not via trusting the classifier's judgment.

From https://simonwillison.net/2026/Mar/24/auto-mode-for-claude-code/:
> "I remain unconvinced by prompt injection protections that rely on AI, since they're non-deterministic by nature." / "I still want my coding agents to run in a robust sandbox by default, one that restricts file access and network connections in a deterministic way." He also flags that auto mode's own docs admit "The classifier may still allow some risky actions: for example, if user intent is ambiguous," and cites the built-in `pip install -r requirements.txt` allow as not protecting against unpinned-dependency supply-chain attacks (referencing the same-period LiteLLM incident).

Willison does not himself argue for keeping or dropping a personal allow-list under auto mode — his argument is orthogonal: allow-lists and classifiers are both inside the "trust the agent's actions" boundary; he wants a *sandbox* outside that boundary regardless of which permission mechanism is used inside it. This is relevant to the proposed rebuild in that it argues the sandbox/hook layer (which the rebuild keeps) matters more than the allow/classifier split — but he gives no evidence either way on allow-list removal specifically.

### A third-party project template that explicitly reasons about this exact question and keeps the allow-list (primary source, `gh api`)

`froggugugugu/project-blueprints`, `.claude/settings.local.json.template` (https://github.com/froggugugugu/project-blueprints, file at `project-blueprint/.claude/settings.local.json.template`, 171 lines, repo created 2026-02-07, last pushed 2026-09-19, 0 stars — small/personal, not a notable-engineer signal, but its comments directly address the question):

> "auto mode（Pro/Max/Teamでは既定の権限モード）との関係: settings.json の deny は分類器より前に効き、ask は auto mode でも必ず確認ダイアログを出す... 分類器の拒否は permission-denied-log.sh が testreport/denials/ に記録する。繰り返し拒否される正当な操作はこのファイルの allow に追加する"
> ("Relationship to auto mode: deny in settings.json takes effect before the classifier; ask always forces a confirmation dialog even in auto mode... Classifier denials are logged by permission-denied-log.sh. Legitimate operations that get denied repeatedly should be added to this file's allow list.")

Its `permissions.allow` list (visible in the fetched content) runs to 30+ entries (npm/npx subcommands, a dozen `git` subcommands, etc.) explicitly labeled "Layer 3" of a four-layer defense stack (sandbox → hooks → deny → allow), kept deliberately *alongside* deny rules and a PreToolUse hook, with a documented workflow for *adding to* the allow-list when the classifier denies something repeatedly — the opposite operational stance from "drop the allow-list." This is independent third-party practice (not the requesting repo), though its vocabulary and layering model closely resembles the requesting user's own harness conventions — treat as one weak data point, not corroboration from an unrelated source.

### No practitioner found who dropped their allow-list specifically because "auto mode made it pointless"

Searched `gh api search/issues` on `anthropics/claude-code` for this framing (`"allow list" auto mode pointless`, `"drop" allow list auto mode`) — no such report found; instead the issue tracker is dominated by the opposite complaint (allow rules the user wants respected are overridden — see §4).

---

## 3. Measured evidence

### Anthropic's own classifier eval (verified: fetched raw HTML, quotes cross-checked with `grep`/Python extraction, not just WebFetch summary)

Source: https://www.anthropic.com/engineering/claude-code-auto-mode ("Claude Code Auto Mode: Key Metrics and Design")

Verbatim, from the page's own methodology section:
> "We report two metrics. False-negative rate (FNR) is the fraction of dangerous actions the classifier lets through; false positive rate (FPR) is the fraction of benign actions it blocks... Stage 1 is fast and cheap, tuned for low FNR at the cost of high FPR. Stage 2 is more expensive and runs only on what stage 1 flagged."

| Test set | n | Stage 1 (fast filter) | Stage 1→2 (deployed pipeline) |
|---|---|---|---|
| Real internal traffic | 10,000 | — | — |
| Real "overeager" actions (curated from denials / post-hoc flags) | 52 | 8.5% FPR, 6.6% FNR | 0.4% FPR, **17% FNR** |
| Synthetic data-exfiltration attempts | 1,000 | 1.8% FNR | 5.7% FNR |

Anthropic's own characterization: "The 17% false-negative rate on real overeager actions is the honest number... In the majority of misses we examined, the classifier..." (page continues past what was extracted). Anthropic itself flags n=52 as a small "real overeager" sample and calls the 17% FNR "the honest number" rather than downplaying it — this is a vendor volunteering a negative number about its own product, which raises its credibility as evidence but also means: on the vendor's own curated hard cases, roughly 1 in 6 genuinely dangerous/overeager actions are *not* caught by the deployed classifier. Read-only and in-directory edits never reach this classifier at all (Tier 1/2 above it); this FNR describes only the residual Tier 3 traffic — precisely the traffic a dropped-allow-list config would divert more of into Tier 3.

> "Allowlisted tools skip straight to execution; everything else goes to the classifier." (same page, describing the two-stage pipeline diagram)

This is the vendor's plainest statement of the tradeoff: an allow rule is a deterministic 0%-FNR/0%-FPR path (the action either matches or it doesn't); dropping it moves that traffic onto a path with a measured, non-zero, vendor-acknowledged false-negative rate.

### Bypass research — auto mode approved a live compromise chain (summarizing fetch; task type is adversarial security research, not routine coding — do not conflate with the FPR/FNR numbers above)

Source: https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/ (Johann Rehberger's `embracethered.com`, a named, notable AI-security researcher)

Per the WebFetch digest: a module-shadowing attack (poisoned `struct.py` shadowing Python's stdlib module) succeeded through Auto Mode's classifier in **3/5 attempts (60%)** for a C2-callback variant and **4/5 (80%)** for a file-write variant; "Auto Mode blocked the cleanup command" (i.e., it caught the *harmless* remediation step, not the *original* compromise). Stated conclusion: "Auto Mode approval is not evidence that a command is safe"; recommended mitigation is container/VM/OS sandboxing and egress restriction — not tighter classifier tuning and not a static allow-list either. `[unverified — summarizing fetch, small n, single research team, not independently reproduced elsewhere in this survey]`.

### No numbers found on: allow-list removal's effect on session speed/latency in practice, or on how many real users have removed allow-lists.

---

## 4. In the wild

### Adoption signal via `gh search code`

`gh search code '"defaultMode": "auto"'` (no filename filter): 37 hits. Manually reviewed all 37 — the overwhelming majority are **not** personal `settings.json` files but third-party tools/SDKs/wrappers that model Claude Code's settings *schema* in Rust/Go/Swift/Kotlin/TS source (e.g. `openless-core/src/shared_types.rs`, multiple `internal/config/config.go` files, i18n locale strings, test fixtures). This is itself a finding: `"defaultMode": "auto"` shows up far more as *something tools understand and interoperate with* than as *a value real developers commit into their own dotfiles*.

`gh search code '"defaultMode": "auto"' permissions` (50 hits, broader): turned up one real hit with actual content — `froggugugugu/project-blueprints`'s `settings.local.json.template` (§2 above, 0 stars, pushed 3 days before this survey). A second, `NewBillofRights/newbillofrights docs/conversations/2026-09-06_c11ed9c3.md`, is a saved chat transcript, not a config. No 10-repo sample of committed personal `settings.json` files with `defaultMode: auto` was found by code search in the time available — `filename:settings.json` restricted queries returned 0 results (either the field is genuinely rare in indexed, committed files, or GitHub's code-search index under-covers dotfiles repos, which are frequently gitignored or kept private; can't distinguish from search alone). `[gap — see "no precedent found"]`

### GitHub issues — the exact interaction the rebuild depends on ("deny + classifier, no allow") has open, reproduced counter-examples

`gh api search/issues -f q='"auto mode" classifier repo:anthropics/claude-code'`: **872** total matching issues (scale indicator — this is a heavily used, heavily reported-on feature, not a fringe one). Filtered to on-topic issues; the following are read directly from issue bodies (primary source, not summarized):

| # | Title | Opened | State | Relevance |
|---|---|---|---|---|
| [#95996](https://github.com/anthropics/claude-code/issues/95996) | auto-mode classifier vetoes commands present in permissions.allow (no override path) | 2026-09-22 (today) | open | `Bash(git worktree remove:*)` in `permissions.allow` is still blocked by the classifier under `[Irreversible Local Destruction]`, with "no override path" |
| [#83611](https://github.com/anthropics/claude-code/issues/83611) | A tool listed in permissions.allow is denied by the permission classifier | 2026-08-03 | open | same pattern, different reporter |
| [#88575](https://github.com/anthropics/claude-code/issues/88575) | Auto mode classifier denies MCP tool calls already in permissions allow list | — | open | same pattern, MCP tools |
| [#85491](https://github.com/anthropics/claude-code/issues/85491) | Permission classifier blocks read-only operations the user explicitly pre-approved, and does so non-deterministically | 2026-08-10 | open | non-determinism explicitly named |
| [#76149](https://github.com/anthropics/claude-code/issues/76149) | Auto-mode content classifier blocks allowlisted MCP calls... (regression, 2.1.205) | 2026-07-09 | open | reported as a regression, i.e. this got *worse* at some point, not just "always been this way" |
| [#88770](https://github.com/anthropics/claude-code/issues/88770) | permissions.deny (Bash(curl \*)) silently bypassed under Auto Mode | 2026-08-22 | open | **the opposite failure**: a `permissions.deny` rule (exactly the mechanism the rebuild plans to rely on) was not enforced in auto mode, though it was correctly enforced in manual mode with the same settings.json |
| [#89652](https://github.com/anthropics/claude-code/issues/89652) | Auto-mode classifier allowed an unrequested sudo command | 2026-08-25 | open | false-approve of a privilege-escalation action from an ambiguous (interrogative) prompt |
| [#95749](https://github.com/anthropics/claude-code/issues/95749) | Auto mode classifier allowed unauthorized push to main branch without explicit confirmation | — | open | false-approve |
| [#91517](https://github.com/anthropics/claude-code/issues/91517) | Auto-mode safety classifier intermittently unavailable for Write/Bash/Edit, blocking work for extended periods | 2026-09-02 | open | ~5 consecutive failures over ~15 min, one 10-min wait, on plain file writes — classifier-service availability risk that a bypassed allow-list would have been immune to |
| [#95118](https://github.com/anthropics/claude-code/issues/95118) | Auto Mode safety classifier times out with claude-opus-5[1m], blocking Bash | — | open | latency/timeout failure mode |
| [#94740](https://github.com/anthropics/claude-code/issues/94740) | Auto mode: a PreToolUse hook "allow" should resolve the action like a permissions.allow rule | — | open | feature request — confirms hooks and allow rules are *not* currently equivalent in how firmly they resolve under auto mode, which matters because the rebuild's whole design substitutes a hook for the allow-list |

Span: issues on the allow-vetoed-by-classifier theme run 2026-07-09 → 2026-09-22 (today), i.e. a persistent three-month-plus pattern across multiple Claude Code versions, not a single transient bug. All are still **open**.

### Negative-evidence bias note

Issue trackers systematically over-represent failure; the 872-issue corpus says nothing about the (much larger, silent) set of sessions where the classifier behaved as documented. But the specific pattern found — allow rules overridden, deny rules bypassed, classifier unavailable — is exactly the three failure modes that matter most to this design decision, and each has multiple independent reporters across different months.

---

## Summary table

| Source | Task type | Result | Cost numbers | Named failure modes |
|---|---|---|---|---|
| Claude Code docs (permission-modes.md, permissions.md) | vendor spec | allow rules resolve before classifier is reached (step 1 of 3); auto mode drops only broad/dangerous allow rules, keeps narrow ones | round-trip added per classifier call; classifier billed on Enterprise/API/cloud, not on Pro/Max/Team subscriptions | documented exceptions where allow doesn't fully bypass (protected/critical paths) |
| Claude Code docs (costs.md) | vendor spec | — | no numbers | — |
| Anthropic eng blog (auto-mode) | vendor self-eval, real+synthetic traffic | Stage1→2 pipeline: 0.4% FPR / 17% FNR (n=52 real overeager), 5.7% FNR (n=1,000 synthetic exfil) | classifier runs on Sonnet 5 by default | vendor-acknowledged 17% FNR on hard real cases; small n=52 sample |
| embracethered.com (Rehberger) | adversarial security research | module-shadowing attack bypassed auto mode | 60–80% success rate across 5 attempts per variant | auto mode approved the compromise, blocked the cleanup |
| Simon Willison (2 posts) | practitioner commentary | trusts convenience claim, distrusts AI-based safety guarantee | no numbers | cites `pip install -r requirements.txt` default-allow as a supply-chain gap |
| froggugugugu/project-blueprints | practitioner template (0★, small) | keeps 30+ allow rules deliberately as "Layer 3", alongside deny + hooks, under auto mode | no numbers | — |
| Codex docs (config-basic/reference) | vendor spec | no classifier, no static per-command allow-list; sandbox permission profiles instead | no numbers | not a converging second data point |
| gh search code (37 + 50 hits) | in-the-wild adoption | mostly third-party schema tooling, not personal settings.json; only 1 real config example found | n/a | committed `defaultMode: auto` personal configs are hard to find via code search |
| anthropics/claude-code issues (872 total; ~10 read in full) | in-the-wild negative evidence | allow-vetoed-by-classifier: 5+ separate open issues, Jul–Sep 2026; deny-bypassed-by-classifier: 1 open issue, Aug 2026; classifier unavailability: 1 open issue, Sep 2026 | no numbers beyond issue counts | recurring, multi-month, still open |

---

## Verdict

**What the evidence supports:** Anthropic's documented design and its own engineering write-up both treat allow rules and the classifier as complementary, not as allow-rules-are-obsolete-under-auto-mode. Allow rules are the fastest, most deterministic path (skip the classifier entirely when matched); the classifier is what handles everything an allow rule doesn't cover, and it has a vendor-measured, non-zero false-negative rate (17% on the vendor's own hard real-world sample) plus a documented, reproduced tendency in the wild to override or ignore matching allow rules on specific action categories, and — separately — to sometimes fail to enforce deny rules the way the docs promise. Auto mode's own default behavior is to prune only the dangerous/broad allow rules (blanket shell, wildcarded interpreters, package-manager run commands), not the narrow, specific ones like the ones in a 71-rule personal config. That is closer to "curate the allow-list" than "delete it."

**What it does not support:** the premise that auto mode's classifier makes a static allow-list redundant. No vendor doc, practitioner post, or measured source found in this survey makes that argument. The one practitioner artifact found that explicitly reasons about the allow/auto-mode relationship (froggugugugu's template) reaches the opposite conclusion — keep and grow the allow-list, specifically *because* the classifier denies things repeatedly. Simon Willison's skepticism is about a different axis (sandboxing vs. trusting model judgment at all) and doesn't argue for or against a personal allow-list either way.

**What dropping the allow-list costs, concretely:**
1. Every action that would have matched one of the 71 rules now takes a classifier round-trip (latency always; token cost only on Enterprise/API/cloud-provider billing, not on Pro/Max/Team).
2. Those actions move from a deterministic 0%-error path onto a path with Anthropic's own measured ~17% FNR on hard cases (though most routine actions are presumably easier than the curated "overeager" test set, so the realized rate for typical repeated commands like `git commit` is very likely much lower than 17% — no source in this survey measured that specifically, so this is `[unverified]` in either direction).
3. Loses `dontAsk` mode as a usable fallback (it depends on `permissions.allow` matching to do anything beyond the built-in read-only set).
4. Trades a rule you can audit and diff in git for a model's per-call judgment that has open, several-months-recurring bug reports of both false-approving and (separately) not fully respecting deny — i.e., the specific two-piece design ("deny + hook, no allow, let the classifier decide the rest") has documented failure reports on both legs in the wild, not just the leg being removed.
5. Gains: 71 fewer rules to maintain/audit, and removes the specific allow-list failure mode documented in #95996/#83611/#88575/#85491 (classifier silently vetoing an allow-matched action anyway) — because there's nothing left for it to silently veto instead of respect. This is a real, if narrow, simplification benefit.

**A middle path the evidence points toward but the proposal doesn't take:** prune the allow-list the way auto mode itself does — drop the broad/dangerous entries, keep the narrow ones — rather than dropping all 71. This matches both Anthropic's stated design intent and the one practitioner artifact that directly addresses the question.

## No precedent found

- No practitioner or vendor source found arguing "auto mode makes allow-lists pointless, remove them."
- No numbers found on classifier accuracy for *routine, repeated* actions (e.g., `git commit`, `npm run test`) specifically — the vendor's 17%/5.7%/0.4% figures are for curated "overeager"/exfiltration test sets, not for the kind of narrow, repeated command an allow-list typically covers. Extrapolating from one to the other is not supported by this survey.
- No 10-repo sample of committed personal `settings.json` files with `defaultMode: "auto"` — code search turned up essentially none (see §4); can't distinguish "rare in practice" from "under-indexed because dotfiles are often private/gitignored."
- DSH/cordis and pi/omp permission models: not reached (no public docs found without WebSearch in the time available).
- Whether the specific bugs in §4 (allow vetoed, deny bypassed) are present in the *current* Claude Code version as of 2026-09-22, or already fixed and just not yet closed on GitHub — issue state is "open" but that doesn't confirm current reproducibility; #95996 is dated today, the others range back to July, none closed.
