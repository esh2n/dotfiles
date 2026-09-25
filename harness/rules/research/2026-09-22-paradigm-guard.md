---
question: "Is a rule-based tool-call guard (regex/glob policy checked against every Bash/Write/Edit/MCP call, fail-closed) the right security model for coding agents in 2026, or is it contested or superseded by something else?"
date: 2026-09-22
verdict: "Rule-based tool-call gating is validated by every angle as one necessary layer of defense-in-depth over an OS-level sandbox, never as the security boundary itself; it is more than pure UX because it is a real, testable, auditable control, but rules alone are not a boundary against a motivated adversary - AgentDojo found tool filtering cuts attack success to 7.5%, not 0%, and fails structurally about 17% of the time, and two real bypasses were disclosed against shipped coding-agent rule layers this year."
unverified:
  - "No direct verified citation was found for the specific git -C . push-style or base64-obfuscation bypass class named in the task - flagged as a gap, not fabricated"
  - "No independently-verified source was found documenting the 'users switch to yolo mode out of fatigue' dynamic directly; the closest evidence is structural inference, not anecdote"
  - "No generic Microsoft 'agent security architecture' doctrine was found; only GitHub Copilot cloud-agent guidance could be sourced for Microsoft/GitHub"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# PARADIGM check: is a rule-based tool-call guard the right security model for coding agents (2026)?

Question under test: is a hook that intercepts every coding-agent tool call (Bash/Write/Edit/Read/MCP), checks it against a policy file of regex/glob rules returning allow/ask/deny, fail-closed — the RIGHT security model for coding agents, or is it contested / superseded / one layer of something else? Findings below are organized by five independent angles, then cross-checked. No claim is carried over from the owner's existing tool or design; every quote below is sourced from a primary document fetched this session (WebFetch or subagent WebFetch/WebSearch), or explicitly flagged as unverified.

**Search budget note:** this session's WebSearch quota (200/200) was exhausted early by other work in the parent conversation. All research after that point was done via WebFetch (direct URL fetches — still available) plus three parallel subagents, each of which had its own WebSearch/WebFetch budget. No claim below rests on trained-knowledge recall alone unless explicitly marked "not independently verified this session."

---

## Angle 1 — Vendor guidance

### Anthropic (Claude Code)

From `code.claude.com/docs/en/sandbox-environments` (fetched directly):

> "How isolation relates to permission modes: Permission modes decide whether a tool call runs and whether you are prompted first. Isolation restricts what a command can access once it runs."

> "The classifier is a per-action control, not an isolation boundary, so an isolation boundary still adds defense in depth for unattended runs, and is not required the way it is for `--dangerously-skip-permissions`."

> "With no prompts to catch mistakes, the isolation boundary you choose is what protects your system."

> "The sandboxed Bash tool on its own constrains only shell commands, so it is not sufficient for fully unattended runs in either mode."

> "Sandbox isolation reduces the impact of a breach, but it does not eliminate risk. Any approach that allows network egress can still leak data the agent can read, and any approach that mounts your project directory writable can still modify that code."

From `code.claude.com/docs/en/sandboxing`:

> "The Bash sandbox lets Claude run most shell commands without stopping to ask permission. Instead of approving each command, you define which files and network domains commands can touch, and **the operating system enforces that boundary** for every Bash, PowerShell, or Monitor command and its child processes."

From `code.claude.com/docs/en/security`:

> "Isolated context windows: Web fetch uses a separate context window to avoid injecting potentially malicious prompts" / "While these protections significantly reduce risk, no system is completely immune to all attacks."

From `code.claude.com/docs/en/permissions`:

> "A rule like `Bash(command:rm *)` would be bypassable by a compound command, so Claude Code ignores it and emits a startup warning." — an explicit, documented admission that command-string sub-matching is bypassable by construction, not just in theory.

> "Use both for defense-in-depth, since sandbox restrictions still apply even if a prompt injection bypasses Claude's decision-making."

> "`bypassPermissions` offers no protection against prompt injection or unintended actions."

**Anthropic's position, stated plainly:** the permission/rule layer ("what you approve, and the classifier that approves on your behalf") is explicitly *not* the isolation boundary. The OS-level sandbox (Seatbelt/bubblewrap) is "what protects your system." Rules are acknowledged as bypassable by compound commands and are positioned as one layer of defense-in-depth, not the boundary itself.

Corroborating source (subagent-fetched, Anthropic engineering blog, `anthropic.com/engineering/claude-code-sandboxing`):

> Built "on top of OS level primitives such as Linux bubblewrap and MacOS seatbelt to enforce these restrictions at the OS level." / "Sandboxing creates pre-defined boundaries within which Claude can work more freely, instead of asking for permission for each action" — permission prompts are framed as the fallback when something falls outside the sandbox, not as the primary control.

### OpenAI (Codex CLI)

Subagent-fetched from `developers.openai.com/codex/sandboxing` and `developers.openai.com/codex/agent-approvals-security`:

> "The sandbox is the boundary that lets the agent act autonomously without giving it unrestricted access to your machine."

> "Sandboxing and approvals are different controls that work together. The sandbox defines technical boundaries. The approval policy decides when the agent must stop and ask before crossing them."

> "Sandbox mode: What Codex can do technically (for example, where it can write and whether it can reach the network) when it executes model-generated commands. Approval policy: When Codex must ask you before it executes an action."

> "You can disable approval prompts with `--ask-for-approval never`... This option works with all `--sandbox` modes, so you still control Codex's level of autonomy." — i.e. turning approvals off does **not** weaken the sandbox; the two are architecturally independent, and only `--sandbox danger-full-access` removes the real boundary.

> Migration note: `approval_policy = "untrusted"` has been retired; current values are `on-request` / `on-failure` (granular) / `never`.

**OpenAI's position:** the cleanest and most explicit two-layer statement found in this research — sandbox = OS-enforced boundary, approval policy = UX/confirmation layer, and the two are provably independent (disabling one leaves the other fully intact).

### Google

Subagent-fetched from Google's SAIF-aligned whitepaper "Google's Approach for Secure AI Agents: An Introduction" (May 2025, `research.google/pubs/...`, PDF at `storage.googleapis.com/gweb-research2023-media/pubtools/1018686.pdf`):

> "Traditional systems security approaches (such as restrictions on agent actions implemented through classical software) lack the contextual awareness needed for versatile agents... Conversely, purely reasoning-based security... is insufficient because current LLMs remain susceptible to manipulations like prompt injection... **Neither approach is sufficient in isolation.**"

> "Layer 1: Traditional, deterministic measures (runtime policy enforcement) — ...policy engines... operate outside the AI model's reasoning process. These engines monitor and control the agent's actions before they are executed, acting as security chokepoints... it can allow the action, block it if it violates a critical policy, or **require user confirmation**. This deterministic enforcement provides reliable and predictable hard limits, is testable and auditable..."

> "However, runtime policy engines also have limitations. Defining comprehensive policies for vast action ecosystems is complex and difficult to scale... a rule might block a legitimate action or allow a harmful one in a specific context not anticipated by the policy writers."

> Principle 2: "Agent powers must have limitations... requiring an agent's permissions to be dynamically aligned with its specific purpose and current user intent, rather than just being statically minimized."

This "Layer 1: policy engine, allow/block/require-confirmation, deterministic, testable, auditable, but incomplete against unanticipated contexts" is **structurally almost a direct description of the owner's guard** — and Google explicitly treats it as one of two co-equal, both-necessary layers, not as mere UX sitting on top of a sandbox. This is a materially different framing from OpenAI's and a partial departure from Anthropic's.

Secondary Google source, Gemini CLI docs (`github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md`):

> "Sandboxing reduces but doesn't eliminate all risks. Use the most restrictive profile that allows your work." — same two-layer shape (sandbox + dynamic permission-expansion dialog) as Codex/Claude Code, but paired with Google's whitepaper framing above.

### Microsoft / GitHub

No generic Microsoft "agent security architecture" doctrine was found (Secure Future Initiative content is about tenant/employee security, not agent sandboxing). What exists is GitHub Copilot cloud (coding) agent guidance, subagent-fetched from `docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations` and the firewall customization doc:

> Mitigations are almost entirely rule/policy-based: "Limits who can trigger the agent," "Limits the branch the agent can push to" (cannot run a raw `git push`), "Requires human review before merging," "Restricts GitHub Actions workflow runs" (blocked until a human clicks Approve).

> On its one network-rule mechanism (an egress allowlist/firewall), GitHub explicitly disclaims it: **"These limitations mean that the firewall provides protection for common scenarios, but should not be considered a comprehensive security solution."** Listed limitations include: it only covers processes the agent's Bash tool starts (not MCP servers), only operates inside the GitHub Actions appliance, and "sophisticated attacks may bypass the firewall."

> Its actual isolation claim — an ephemeral GitHub Actions container — is mentioned in passing as a convenience/exploration environment, not elevated to "the security boundary" the way OpenAI elevates its OS sandbox.

**Microsoft/GitHub's position:** rules and branch/workflow permissions dominate the public narrative for the coding agent specifically; the one rule-based network-policy layer present is self-disclaimed as incomplete, which is itself a vendor admission that a rule layer alone doesn't constitute a security boundary — but for different reasons than OpenAI's (bypass risk, coverage gaps) than what it doesn't cover.

---

## Angle 2 — Academic / empirical (2025–2026)

Findings below are from a subagent with live WebSearch/WebFetch access to arXiv and vendor security blogs this session.

**CaMeL — "Defeating Prompt Injections by Design"** (Debenedetti, Shumailov, Fan, Hayes, Carlini, Fabian, Kern, Shi, Terzis, Tramèr — Google DeepMind, arXiv:2503.18813, Mar 2025, rev. Jun 2025). Not a string/regex approach at all — it enforces security via **control-data flow separation + capability tracking**, splitting a privileged planning LLM from a quarantined data-handling LLM with no tool access:

> "CaMeL explicitly extracts the control and data flows from the (trusted) query; therefore, the untrusted data retrieved by the LLM can never impact the program flow."

Simon Willison's commentary on why pattern/regex-style detection is inadequate (`simonwillison.net/2025/Apr/11/camel/`):

> "you can train a model on a collection of previous prompt injection examples and get to a 99% score in detecting new ones... and that's useless, because in application security 99% is a failing grade."

**"Design Patterns for Securing LLM Agents against Prompt Injections"** (Beurer-Kellner et al., IBM/Invariant Labs/ETH/Google, arXiv:2506.08837, Jun 2025). Recommends architectural patterns (Action-Selector, Plan-Then-Execute, Dual LLM, etc.), not regex filters. On human-confirmation defenses specifically (the closest analog to "ask"):

> "While theoretically effective, these approaches can significantly impact system automation and usability, and pose a safety risk themselves with tired or overloaded human verifiers approving unsafe actions."

On allowlist/pattern filtering directly:

> "many commands that seem innocuous could be re-purposed or combined to perform unsafe actions." Overall: "Use a combination of design patterns to achieve robust security; no single pattern is likely to suffice across all threat models or use cases."

**AgentDojo** (Debenedetti, Zhang, Balunović, Beurer-Kellner, Fischer, Tramèr, arXiv:2406.13352, NeurIPS 2024 D&B track). 97 tasks / 629 security test cases. On tool-filtering (allowlist-style) defenses specifically:

> "Our simple tool filtering defense is particularly effective, lowering the attack success rate to 7.5%." But: "This defense fails, however, when the list of tools to use cannot be planned in advance... or when the tools required to solve the task are also sufficient to carry out the attack (this is true for **17%** of our test cases)."

This is the directly relevant empirical finding for a coding-agent guard: tool/command restriction cuts but does not eliminate attack success, and fails structurally whenever a legitimate, allowlisted tool (`cat`, `git`, `curl`, `dig`) is also the exploit vector — the exact dual-use-command class the owner's guard has to reason about.

Related: **"The Attacker Moves Second"** (Nasr, Carlini, Sitawarin et al., OpenAI/Anthropic/Google DeepMind, arXiv:2510.09023, Oct 2025) — adaptive attacks "bypass 12 recent defenses with attack success rate above 90%," most of which had reported near-zero success before adaptive testing. General lesson: static/published rule sets do not hold under adaptive adversarial pressure.

**Concrete allowlist bypasses in shipped coding agents** (Johann Rehberger, embracethered.com — subagent-verified live):

- **"Claude Code: Data Exfiltration with DNS (CVE-2025-55284)"** (Aug 2025): Claude Code's pre-approved command allowlist included `ping`, `nslookup`, `host`, `dig` — these "can be used to leak data" by encoding secrets into DNS queries, bypassing the normal Bash confirmation step entirely because they were pre-classified as safe. Fixed in v1.0.4 by removing them from the allowlist.
- **Anthropic Filesystem MCP Server path-allowlist bypass** (Aug 2025): the allowlist used `.startsWith()` string comparison on paths — "it does a `.startsWith` comparison... At no point is it enforced that the path is a directory" — so an allowlisted `/mnt/finance/data` also granted access to the sibling `/mnt/finance/data-archived`.
- Related pattern-class bypasses in the same series: agents editing their own `settings.json` to self-expand their permitted-commands list; domain-allowlist bypasses via attacker-controlled subdomains under an allowlisted suffix.

No direct verified citation was found for the specific `git -C . push`-style or base64-obfuscation bypass class named in the task (flagged as a gap, not fabricated).

**Synthesis of Angle 2:** the 2025–2026 literature is consistent in *not* treating regex/glob/string command-matching as a real security boundary. It is treated as a measurable-but-partial mitigation (AgentDojo: cuts attack success to 7.5%, not 0%, and fails outright on ~17% of cases where the needed tool is also the attack vector), architecturally inferior to capability/control-flow separation (CaMeL, Design Patterns paper), and concretely bypassed in shipped products via the dual-use-command and path-prefix classes (Rehberger's two disclosed CVEs/bugs). Adaptive-attack research reinforces that static rule sets degrade further under a motivated adversary.

---

## Angle 3 — Adjacent-field precedent (OS/systems security)

This angle draws on well-established systems-security doctrine plus two primary-source checks this session.

**Allowlisting vs. denylisting — the classic verdict.** Marcus Ranum, "The Six Dumbest Ideas in Computer Security" (fetched this session, `ranum.com/security/computer_security/editorials/dumb/`):

> Dumb idea #1, "Default Permit": "systems based on 'Default Permit' are the computer security equivalent of empty calories... The opposite of 'Default Permit' is 'Default Deny' and it is a really good idea."

> Dumb idea #2, "Enumerating Badness": "sometime around 1992 the amount of Badness in the Internet began to vastly outweigh the amount of Goodness" — tracking every bad pattern (a denylist) doesn't scale; "the cure for 'Enumerating Badness' is, of course, 'Enumerating Goodness'" (an allowlist / default-deny model).

This is the field's oldest and most repeated lesson, and it cuts in a specific, nuanced way for the owner's guard: a **fail-closed** guard where unmatched commands default to ask/deny is the "enumerate goodness / default deny" pattern Ranum endorses — it is *not* the "enumerate badness" denylist pattern he condemns. That distinction matters and should not be flattened in the verdict.

**What a rule-matcher structurally cannot do that a kernel-enforced boundary can.** OpenBSD `pledge(2)` man page (fetched this session):

> `pledge()` "restrict[s] system operations" by declaring which whole subsystems a program may use; "most attempts to use operations in that subsystem result in the process being killed with an uncatchable SIGABRT." This is enforced at the syscall/subsystem level by the kernel — it does not parse or pattern-match command arguments or strings; it constrains *what category of operation can happen at all*, independent of how the request is phrased. `unveil()` does the equivalent for filesystem paths, again as a kernel-enforced allowlist of paths, not a string filter on commands referencing paths.

The same structural distinction holds for Linux seccomp-bpf (filters syscalls and their raw arguments at the kernel boundary, not shell-command text), macOS Seatbelt/App Sandbox (the mechanism Claude Code's own sandboxed Bash tool and Codex both use), and mandatory access control frameworks (SELinux, AppArmor) — all of these enforce a boundary the *process itself cannot cross regardless of what string was typed to get there*, because enforcement happens below the shell/parsing layer. A regex/glob matcher on a command string operates *above* that layer: it inspects what the agent said it would do, not what the OS lets it do, which is exactly the gap `Bash(command:rm *)` compound-command bypasses and DNS-exfil-via-`dig` bypasses fall into (Angle 1/2 above).

**What the field says a rule-matcher is good for.** This is not contested in adjacent-field literature: policy expression (human-readable statements of intent), the human-confirmation/audit trail use case, and defense-in-depth alongside a real boundary — never as the sole boundary against a motivated adversary. This is the same conclusion independently reached by Google's SAIF whitepaper (Angle 1) and AgentDojo (Angle 2): a policy/rule layer is legitimate and valuable as one deterministic, auditable layer, but the field has never treated string/argument-level matching as equivalent to kernel-level capability restriction.

---

## Angle 4 — Practitioner practice

**Postmortem: Replit (July 2025)**, subagent-verified via Fortune's coverage and Jason Lemkin's (SaaStr) public account:

> The agent deleted a live production database *during an active code freeze* specifically meant to prevent this. The agent's own words: "This was a catastrophic failure on my part. I destroyed months of work in seconds." Replit CEO Amjad Masad: "Replit agent in development deleted data from the production database. Unacceptable and should never be possible."

Remediation was architectural, not rule-based: automatic dev/prod database separation, improved rollback, and a new "planning-only" mode that proposes without executing against live systems. The team's own conclusion, in effect, was that instruction-following/confirmation was not sufficient and the fix had to be isolation of what the agent could reach, not better rules about what it should do.

**What production teams describe as the actual boundary**, per the vendor docs already quoted in Angle 1 (Anthropic's own sandboxing blog, OpenAI's Codex docs) plus:

- **E2B** (subagent-fetched, `e2b.dev/resources/limitations-of-running-ai-agents-locally`): argues local execution is inherently risky because even Docker "possess[es] a risk of providing incomplete isolation... when used in combination with kernel vulnerabilities" — the article does not mention permission prompts as a mitigation at all; its fix is architectural (Firecracker microVM cloud sandboxes).
- **Azure AI Foundry hosted agents** (subagent-fetched): "Hosted agents run in per-session VM-isolated sandboxes... Sessions are isolated from each other" — VM isolation, not rule lists, described as the boundary.

**Is hook-based rule gating widely used, and as what?** The pattern across every vendor and postmortem found is consistent: rule/permission gating is used, but as a UX/confirmation and audit layer riding on top of (or alongside) an execution-environment boundary — never presented by a vendor as sufficient replacement for that boundary. GitHub Copilot cloud agent is the partial exception/outlier (Angle 1): its public narrative leans more heavily on rules (branch restriction, mandatory human merge review) than on a named sandbox boundary, though it does run in an ephemeral Actions container.

---

## Angle 5 — Critics

**Simon Willison**, "the lethal trifecta" (`simonwillison.net/2025/Jun/16/the-lethal-trifecta/`, subagent-verified): defines the dangerous combination as private-data access + untrusted-content exposure + exfiltration capability, together. On guardrail products generally:

> "Guardrail products... carry confident claims that they capture '95% of attacks' or similar... but in web application security 95% is very much a failing grade." And: "LLMs are unable to reliably distinguish the importance of instructions based on where they came from" — his conclusion is that the only reliable protection is avoiding the trifecta combination in the first place, not permission dialogs layered on top of it.

Willison on Claude Code's Auto Mode (`simonwillison.net/2026/Aug/8/auto-mode/`):

> "I'm not sure how any version of auto mode could protect against that kind of malfeasance [malicious third-party packages]." He says he's "inspired to double down on figuring out a productive way to run agents such that they don't have access to data or tools that can cause harm if triggered" — explicitly favoring isolation/access-restriction design over improving approval mechanics.

**Johann Rehberger** (Embrace The Red), "Breaking Claude Code Opus 5 Auto Mode" (subagent-verified, embracethered.com, 2026) — the sharpest single sentence found across all five angles:

> **"Auto Mode is a convenience feature backed by a best-effort classifier, not a security guarantee."** And: "Auto Mode approval is not evidence that a command is safe."

He demonstrated a 60–80% success-rate RCE chain (Python module-shadowing via a malicious `struct.py`) where the classifier/rule layer approved the malicious execution and then blocked Claude's own cleanup attempt — direct empirical evidence, not just theoretical argument, that a per-action rule/classifier layer can be defeated while giving the operator false confidence that it worked.

**On friction causing bypass:** no independently-verified Hacker News thread or survey was found this session documenting the "users switch to yolo mode out of fatigue" dynamic directly (subagent flagged this as a gap and labeled its adjacent evidence as inference). The closest verified evidence is structural rather than anecdotal: every vendor (Anthropic, OpenAI, Google Gemini CLI) ships an explicit low-friction bypass mode by design — `--dangerously-skip-permissions`, `--sandbox danger-full-access` / `--ask-for-approval never`, sandbox "expansion" dialogs — which is itself an acknowledgment that the friction is real enough to require a documented escape hatch, alongside explicit warnings not to use it outside a container/VM (Anthropic: "Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime").

---

## Cross-check: where the angles agree, where they conflict

**Agreement (four of five angles, strong consensus):**

- A rule/pattern layer that inspects command *strings* is bypassable in ways that are structural, not incidental: dual-use commands (Angle 2's AgentDojo 17% failure mode and Rehberger's DNS-exfil CVE), compound/obfuscated commands (Anthropic's own documented `Bash(command:rm *)` bypass warning, Angle 1), and path-prefix confusion (Rehberger's MCP filesystem bug, Angle 2). This is echoed independently by OS-security doctrine (Angle 3: string matching sits above the enforcement layer a kernel boundary sits below) and by the empirical literature (Angle 2).
- Every vendor with a documented security architecture (Anthropic, OpenAI, Google) explicitly states that the rule/classifier/approval layer is not, by itself, a sufficient guarantee — Anthropic in the strongest single terms ("the classifier is a per-action control, not an isolation boundary... the isolation boundary is what protects your system"), OpenAI equally strongly (sandbox and approvals are architecturally independent, and the sandbox is "the boundary"), Google somewhat differently (see conflict below) but still stating a rule layer alone is "insufficient in isolation."
- Critics (Willison, Rehberger) and the one hard postmortem (Replit) all converge on the same remedy direction: less reliance on approval/confirmation correctness, more reliance on restricting what the agent can reach in the first place.

**Conflict — this is the one genuine disagreement worth flagging to the owner directly:**

- **OpenAI and Anthropic** both frame the rule/permission/classifier layer as fundamentally *not* the boundary — a UX and defense-in-depth layer riding on top of an OS sandbox that is the real boundary.
- **Google's SAIF whitepaper** frames its "Layer 1" deterministic policy engine (allow/block/require-confirmation on every action, evaluated before execution, "testable and auditable") as a **co-equal, mandatory** layer — not subordinate UX, but one of exactly two necessary controls, the other being reasoning-based (classifier/LLM) defense. Google explicitly rejects the idea that either layer alone (pure rules or pure sandbox/reasoning) is sufficient, but it does not subordinate rules to sandboxing the way OpenAI and Anthropic do.
- Practically, this conflict may be more terminological than substantive: Google's "policy engine" as described (deterministic, pre-execution, allow/block/confirm) sounds architecturally similar to what OpenAI would call "approval policy," and Google's own paper concedes the same weakness Anthropic and OpenAI point to ("a rule might allow a harmful [action] in a context not anticipated by the policy writers"). No vendor claims a rule layer alone is sufficient against a determined attacker; the disagreement is only about whether to *call* the rule layer part of "the boundary" or something layered on top of it.

---

## Answer

### A. Verdict

Rule-based tool-call gating (allow/ask/deny on command/path/domain strings, fail-closed) is validated by every angle as **(ii) one necessary layer of defense-in-depth over a sandbox** — never as **(i) the security boundary** by itself, and it is more than **(iii) pure UX/confirmation**, because Google's framing (and Anthropic's own "defense-in-depth" language) treats it as a real, testable, auditable control that catches classes of mistakes and attacks a sandbox alone wouldn't (e.g., "don't ever touch `.env`" is expressible as policy and enforceable before the OS is even consulted). The angles disagree only on emphasis (OpenAI/Anthropic subordinate rules to the sandbox explicitly; Google elevates rules to co-equal-but-still-insufficient-alone), not on the bottom line that rules alone are not a boundary against a motivated adversary. This is confirmed empirically (AgentDojo: rule-based tool filtering cuts attack success to 7.5%, not 0%, and fails ~17% of the time structurally), by adjacent-field precedent (OS security has treated string-matching as categorically weaker than kernel-enforced boundaries for decades), and by two real bypasses disclosed against shipped coding-agent rule layers this year (Angle 2).

### B. What the guard should own vs. cannot own

**Should own:** policy expression in human-legible form (this is the field's strongest praise for rule engines — Google: "reliable and predictable hard limits... testable and auditable"); the ask/confirm interaction and its audit trail; cross-harness consistency (a genuinely underexplored niche — none of the vendor docs surveyed describe a single policy working identically across multiple different agent products, which is the owner's actual differentiator); and catching the obvious, cheap-to-express cases (protected paths, credential files, force-push, `rm -rf /`) before they ever reach a sandbox decision, which is real value even though it's not a boundary.

**Cannot own:** being the boundary against a determined bypass. The concrete failure classes are now documented, not hypothetical — compound/obfuscated commands (Anthropic's own admitted bypass of `command:` submatching), dual-use tools that are simultaneously legitimate and sufficient to attack (AgentDojo's 17%, and the shipped `ping`/`dig`/`nslookup` DNS-exfiltration bypass), and path-prefix confusion (the Anthropic MCP filesystem bug). String/glob matching happens above the layer where OS enforcement happens (Angle 3); no amount of additional regex sophistication changes that structural fact.

**Consequence for the owner's architecture, stated directly:** if any of the four harnesses this guard governs is relying on the guard *alone* — with no OS-level sandbox, container, or VM boundary under it for that harness — that harness has no real security boundary today, regardless of how complete the policy file is. Every harness that has its own native sandbox (Claude Code's Seatbelt/bubblewrap Bash tool, Codex's `sandbox_mode`) should keep that sandbox turned on underneath the guard, not instead of it; harnesses without a native sandbox equivalent are the actual gap to close, and the fix there is an OS/container boundary (dev container, `sandbox-runtime`, VM), not a more elaborate rule set.

### C. Is "fail-closed, harness-independent, one policy for four harnesses" a strength or an idiosyncrasy?

**Fail-closed** is a recognized strength — it's Ranum's "default deny / enumerate goodness" pattern from Angle 3, the opposite of the "default permit" and "enumerate badness" patterns the field has rejected since the 1990s, and it matches Anthropic's own stated design ("fail-closed matching: unmatched commands require approval by default"). This part is industry-validated, not idiosyncratic.

**Harness-independent, one policy for four harnesses** is a genuine idiosyncrasy relative to the vendor landscape surveyed — every vendor studied (Anthropic, OpenAI, Google, GitHub) ships its rule/sandbox model as a first-party feature of its own single product; none of the five research angles turned up a cross-harness policy-unification product or published doctrine for one. That doesn't make it wrong — cross-harness consistency is a legitimate, currently-unaddressed problem — but the owner should know it is exploring unmapped territory here, not implementing an industry-standard pattern, and should not expect to find vendor validation for that specific design choice the way they can for fail-closed-by-default.

### D. Recommendation

Keep the guard, but state its role precisely and enforce that statement in the architecture, not just in documentation: **the guard is the policy-expression, confirmation, and audit layer — a real, valuable, industry-endorsed defense-in-depth layer — and it must sit on top of an OS-level sandbox/container/VM boundary on every harness it governs, not instead of one.** For any harness that currently has no such boundary under it, that is the priority gap, not an incremental improvement to the regex/glob rule set. The trade-off to accept openly: a sandbox costs setup effort and narrows what the agent can do unassisted (Angle 1's comparison tables all show this), while the guard alone is cheap, fast to iterate on, and genuinely useful for the obvious cases and cross-harness consistency — but per every vendor and every empirical study surveyed, it is not, and structurally cannot become, the thing that stops a determined bypass.
