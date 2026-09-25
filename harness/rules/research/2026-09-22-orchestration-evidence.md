---
question: "Does multi-agent orchestration outperform a single agent on coding tasks, based on measured evidence?"
date: 2026-09-22
verdict: "Single agent + good tools sits at or near the top of every 2026 coding leaderboard; orchestrator/role-specialized multi-agent designs measure worse on coding (-2% to -19%) at 1.6-7x tokens; the only multi-agent pattern with measured coding gains is test-grounded selection over parallel rollouts, not decomposition; multi-agent wins are confined to decomposable non-coding work; verification pays off only when grounded in tests or a stronger judge, unmeasured as same-model opinion; budget caps and resume are unmeasured for quality, supported only by cost data."
unverified:
  - "MetaGPT and AgentCoder's self-reported HumanEval/MBPP wins have no independent replication found"
  - "The Aider architect/editor split numbers came from a WebFetch summary, not independently re-verified"
  - "Whether resume would have preserved spent tokens after rate-limit kills is an inference from the failure reports, not a measurement"
  - "TRAE's roughly 30x generation-cost multiplier for its 30-rollout selector is an inferred estimate, not a stated figure"
  - "GitHub issues #82101, #87815, #92090, #84223 were subagent-extracted and not independently re-verified via gh api"
  - "The Terminal-Bench Orchestrator (Danau5tin) cost table was read from the README but not independently re-checked line by line"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Orchestration evidence: multi-agent vs single-agent for coding tasks

Date: 2026-09-22. Scope: measured evidence only (papers, leaderboards, vendor cost docs, user-filed cost reports). Skeptical results weighted equally with positive ones. Everything not marked `[unverified]` was fetched from the cited URL in this session; GitHub issue numbers and the SWE-bench leaderboard JSON were independently re-checked via `gh api`.

Conventions:
- Task type is tagged on every result. **The question is coding**; research/math/QA results are included only to show where multi-agent gains come from and why they do not transfer.
- "Multi-agent" is split into three architecture classes, because the evidence differs sharply between them:
  - **A. Orchestrator + role-specialized subagents** (planner/explorer/coder/verifier, each with its own context) — what "workflow graphs" and "agent teams" mean.
  - **B. Parallel rollouts + selector/verifier** (N independent attempts at the same task, then pick one) — test-time scaling, not delegation.
  - **C. Debate / voting ensembles** (N agents answer the same question, then vote or argue).
- `[unverified]` marks an inference or a number a subagent extracted but I could not confirm directly.

---

## 1. Papers

### 1.1 MAST — "Why Do Multi-Agent LLM Systems Fail?" (Berkeley, arXiv 2503.13657)
URL: https://arxiv.org/abs/2503.13657 , https://arxiv.org/html/2503.13657
Task type: mixed — coding (ChatDev, MetaGPT, HyperAgent/SWE-bench, ProgramDev), math (AG2 MathChat), general agent tasks (AppWorld).

Verbatim abstract opening: "Despite enthusiasm for Multi-Agent LLM Systems (MAS), their performance gains on popular benchmarks are often minimal. This gap highlights a critical need for a principled understanding of why MAS fail."

Headline rate: "empirical analysis reveals 41% to 86.7% failure rate on 7 state-of-the-art (SOTA) open-source MAS". Dataset: 1,600+ annotated traces, 7 frameworks, 150 traces expert-annotated (kappa = 0.88). Models: GPT-4, Claude 3, Qwen 2.5, CodeLlama.

Failure taxonomy (share of all observed failures):

| Category | Share | Notable modes |
|---|---|---|
| FC1 System design issues | 43.8% | Step repetition 15.7%; Unaware of termination 12.4%; Disobey task spec 11.8% |
| FC2 Inter-agent misalignment | 31.5% | Reasoning-action mismatch 13.2%; Task derailment 7.4%; Fail to ask clarification 6.8% |
| FC3 Task verification | 24.5% | Incorrect verification 9.1%; No/incomplete verification 8.2%; Premature termination 6.2% |

Coding-specific: ChatDev's chess program "passes superficial checks (e.g., code compilation) but contains runtime bugs because it fails to validate against actual game rules" (FM-3.2). Wordle: told to pick a new word daily, produced a fixed list — "failures stem from the MAS's design for interpreting specifications." MetaGPT vs ChatDev on the same benchmark: MetaGPT had 60–68% fewer FC1/FC2 failures but 1.56x more FC3 (verification) failures.

Interventions: improved role specs on ChatDev +9.4% success; adding high-level task-objective verification +15.6% on ProgramDev. Authors' caveat: "achieving robust MAS reliability often requires more than isolated fixes."

Reading: a quarter of MAS failures are the verifier itself failing (absent, incomplete, or wrong). A verify phase is not free correctness; it is a component with its own failure rate.

### 1.2 "Towards a Science of Scaling Agent Systems" (arXiv 2512.08296) — the key controlled study
URL: https://arxiv.org/html/2512.08296 (spot-checked directly)
Task type: mixed, includes two coding benchmarks (SWE-bench Verified, Terminal-Bench). Models: GPT-5-nano/mini/5, Gemini 2.0/2.5 Flash, 2.5 Pro, Claude Sonnet 3.7/4/4.5. Architectures: single-agent (SAS), independent, decentralized, centralized (orchestrator), hybrid.

Per-benchmark change vs single-agent (subagent-extracted, SWE-bench and Terminal-Bench rows re-verified verbatim):

| Benchmark | Independent | Decentralized | Centralized | Hybrid |
|---|---|---|---|---|
| Finance-Agent (decomposable) | — | +74.5% | +80.8% | +73.1% |
| PlanCraft (sequential) | −70.0% | −41.5% | −50.3% | −39.1% |
| BrowseComp-Plus (web) | −35% | +9.2% | +0.2% | — |
| WorkBench | — | +5.6% | −1.2% | −1.2% |
| **SWE-bench Verified (coding)** | **−14.9%** | **−5.4%** | **−3.1%** | **−2.1%** |
| **Terminal-Bench (coding/CLI)** | **+1.7%** | — | **−19.2%** | — |

Verbatim (SWE-bench): "all MAS architectures show slight degradation relative to SAS (mean 0.522): Hybrid −2.1% (0.511), Centralized −3.1% (0.506), Decentralized −5.4% (0.494), and Independent −14.9% (0.444)". Verbatim (Terminal-Bench): "Independent shows marginal gains (+1.7%, 0.350) while Centralized degrades substantially (−19.2%, 0.278)" — "the low tool count (2 tools) limits the benefit of orchestration-heavy architectures."

Why: "tasks where single-agent performance already exceeds 45% accuracy experience negative returns from additional agents, as coordination costs exceed diminishing improvement potential" (the "capability-saturation threshold"; regression term β(PSA×log(1+na)) = −0.236, p=0.004). Tool-count interaction significantly negative (β(Ec×T) = −0.096, p=0.002).

Token cost, verbatim: "multi-agent architectures incur substantial overhead: independent (58%), centralized (285%), decentralized (263%), and hybrid (515%), representing 1.6–6.2× token budgets relative to single-agent". Success per 1,000 tokens: SAS 67.7, Independent 42.4, Decentralized 23.9, Centralized 21.5, Hybrid 13.6.

Error amplification: single-agent 1.0x, centralized 4.4x, hybrid 5.1x, decentralized 7.8x, independent 17.2x. "architectures without centralized verification tend to propagate errors more."

Predictive model: R²(CV) = 0.373–0.413; picks best architecture for 87% of held-out configs.

Reading: the only controlled, multi-model, multi-architecture comparison found. On both coding benchmarks every orchestrated variant was worse than single-agent, at 1.6–6.2x tokens. Gains exist only on highly decomposable non-coding tasks (finance QA) and vanish once the single agent is already above ~45%.

### 1.3 "More Agents Is All You Need" (arXiv 2402.05120) — class C
URL: https://arxiv.org/html/2402.05120v2
Task type: coding (HumanEval) + reasoning.
HumanEval, single sample vs ensemble of 40 (sampling + voting): Llama2-13B 0.14→0.18; Llama2-70B 0.24→0.33; GPT-3.5-Turbo 0.67→0.73. Cost scales linearly with N (40x samples for +6pt on GPT-3.5). Gains are larger on harder tasks; on HumanEval they are the smallest. No explicit saturation point extracted for HumanEval `[unverified]`.

### 1.4 Multi-agent debate — class C
- Du et al. 2023 (arXiv 2305.14325), math/QA, NOT coding: GSM8K single 77.0 → debate 85.0; arithmetic 67.0 → 81.8. https://arxiv.org/html/2305.14325
- "Should we be going MAD?" (arXiv 2311.17371): "multi-agent debating systems, in their current form, do not reliably outperform other proposed prompting strategies, such as self-consistency and ensembling." https://arxiv.org/abs/2311.17371
- "Debate or Vote" (arXiv 2508.17536): "Majority Voting alone accounts for most of the performance gains typically attributed to MAD"; "debate alone does not improve expected correctness". https://arxiv.org/abs/2508.17536
- "Stop Overvaluing Multi-Agent Debate" (arXiv 2502.08788): "MAD often fail to outperform simple single-agent baselines such as Chain-of-Thought and Self-Consistency, even when consuming significantly more inference-time computation." https://arxiv.org/abs/2502.08788
- Huang et al. "LLMs Cannot Self-Correct Reasoning Yet" (arXiv 2310.01798), Table 7: at 6 responses, multi-agent debate 83.2% vs plain self-consistency 85.3% — "multi-agent debate significantly underperforms simple self-consistency using majority voting." https://arxiv.org/html/2310.01798

Reading: debate gains are attributable to sampling+voting; the "debate" step adds cost, not accuracy. No coding-task debate result found in either direction.

### 1.5 Self-correction / self-repair (relevant to verify loops)
- Huang et al. 2310.01798 (math/QA): intrinsic self-correction degrades accuracy — GSM8K 75.9→75.1→74.7; CommonSenseQA 75.8→38.1→41.8; HotpotQA 26.0→25.0. "LLMs struggle to self-correct their responses without external feedback, and at times, their performance even degrades after self-correction."
- Olausson et al. "Is Self-Repair a Silver Bullet for Code Generation?" (arXiv 2306.09896), CODING (HumanEval, APPS): "when the cost of carrying out repair is taken into account, performance gains are often modest, vary a lot between subsets of the data, and are sometimes not present at all." GPT-4 on APPS: 10 samples + 1 repair each (20 total) gives pass rate only "1.05× higher than pass@20" i.i.d. sampling. Feedback from a stronger model helps: with GPT-4 feedback, "both Code Llama and GPT-3.5 now beat out both their baselines... and their respective self-repair modes." Human feedback: "increased the fraction of repaired programs which pass all unit tests by a factor of 1.58×". https://arxiv.org/html/2306.09896

Reading: a same-model critic adds little at equal compute; the critic must be strictly stronger than the author (or be a real test) to pay off.

### 1.6 Multi-agent code-generation frameworks (self-reported, class A)
- MetaGPT (arXiv 2308.00352): HumanEval 85.9%, MBPP 87.7% Pass@1; SoftwareDev executability 3.75/4 vs ChatDev 2.1, AutoGPT/LangChain/AgentVerse ≈1.0. Self-reported; no independent replication found `[unverified]`.
- AgentCoder (arXiv 2312.13010): HumanEval 96.3% / MBPP 91.8% vs "SOTA baseline" 90.2% / 78.9%; claims lower tokens (56.9K vs 138.2K). Baseline identity not confirmed `[unverified]`.
- MAST (1.1) later measured these very frameworks at 41–86.7% failure rates on harder tasks; the scaling study (1.2) found the orchestrated pattern loses on SWE-bench. Function-level HumanEval/MBPP wins from 2023 have not carried over to repository-level benchmarks.

### 1.7 Long context / context engineering
- "Lost in the Middle" (arXiv 2307.03172): U-shaped recall, degrades for mid-context information even in long-context-tuned models.
- Chroma "Context Rot" (https://www.trychroma.com/research/context-rot): "performance grows increasingly unreliable as input length grows"; even a single distractor lowers accuracy; Claude models abstain more, GPT models hallucinate more. Not coding-specific.
- Agentless (arXiv 2407.01489): a fixed localize→repair→validate pipeline with no agent loop. v1 abstract: "the simplistic Agentless is able to achieve both the highest performance (27.33%) and lowest cost ($0.34)" (SWE-bench Lite, vs open-source agents at the time); v2/v3: 32.00% at $0.70. https://arxiv.org/abs/2407.01489v1

Reading: context degradation is real and is a legitimate reason to keep bulk reads out of the main context. It is an argument for **context isolation** (a subagent that returns a summary), not for **decomposed parallel implementation**. These are different claims and the evidence supports only the first.

### 1.8 Anthropic's multi-agent research system (the source of the "15x")
URL: https://www.anthropic.com/engineering/multi-agent-research-system
Task type: research (explicitly not coding).
Verbatim: "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats." "A multi-agent system with Claude Opus 4 as the lead agent and Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval." And: "some domains that require all agents to share the same context or involve many dependencies between agents are not a good fit for multi-agent systems today. For instance, most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time."

Independent measurement of the multiplier: the scaling study (1.2) gives 1.6–6.2x vs single-agent (not vs chat); Claude Code's own cost doc gives ~7x for agent teams (section 2.2). The 15x is vs chat, so 15x/4x ≈ 3.75x vs a single agent, consistent with the independent 2.9–3.9x for centralized orchestration in 1.2.

### 1.9 Test-time verification in code generation (class B)
- CodeMonkeys (arXiv 2501.14723, SWE-bench Verified): coverage (some candidate correct) 69.8%; random selection 45.8%; test-voting ~52%; best selector 57.4%; total cost ≈ $2,300 (≈$4.60/instance): context $334, test gen $440, edit gen $1,366, selection $132. "Barrel of Monkeys" ensemble over top submissions: 80.8% coverage → 66.2% selected. Verbatim: "If, however, we instead selected edits at random, our expected score of only 45.8% would not even rank among the top 20 leaderboard submissions. This significant performance gap underscores the importance of accurate selection." https://arxiv.org/html/2501.14723
- AlphaCodium (arXiv 2401.08500, CodeContests): GPT-4 pass@5 "from 19% with a single well-designed direct prompt to 44%" via test-based iterative flow. Competitive programming with executable tests, not repo-level. https://arxiv.org/abs/2401.08500
- TRAE (SWE-bench Verified #3): single attempt 70.6% → 30 parallel patches + regression filter + selector 78.8% (+8.2pp) (section 2.1).

Reading: verification pays when it is grounded in executable tests and used to **select among candidates**. The selector recovers about half the oracle gap and costs ~6x per instance vs the best single-agent scaffolds.

---

## 2. Leaderboards and industry measurements

### 2.1 SWE-bench Verified top-10 (live JSON from swebench.com source, re-verified via `gh api`)
Source: https://github.com/SWE-bench/swe-bench.github.io `data/leaderboards.json`; READMEs in https://github.com/SWE-bench/experiments.

| Score | Entry | Date | Attempts | Class | Cost/instance |
|---|---|---|---|---|---|
| 79.2 | Sonar Foundation Agent + Claude 4.5 Opus | 2025-12 | 1 | single agent, 3 tools | — |
| 79.2 | live-SWE-agent + Claude 4.5 Opus | 2025-12 | 1 | single agent (self-modifying scaffold) | — |
| 78.8 | TRAE + Doubao-Seed-Code | 2025-09 | 2+ | B: 30 rollouts + selector (single-attempt 70.6%) | — |
| 77.4 | live-SWE-agent + Gemini 3 Pro | 2025-11 | 1 | single agent | — |
| 76.8 | EPAM AI/Run | 2025-08 | 2+ | B `[unverified]` | — |
| 76.8 | Atlassian Rovo Dev | 2025-09 | 2 | B: "simple test time scaling" | — |
| 76.8 | mini-SWE-agent + Claude 4.5 Opus (high) | 2026-02 | 1 | single agent, bash only, ~100 lines | $0.754 |
| 76.4 | ACoder | 2025-08 | 2+ | **A**: "Subagent-as-a-Tool" + 4-model selector | — |
| 75.8 | mini-SWE-agent + Gemini 3 Flash | 2026-02 | 1 | single agent | $0.356 |
| 75.8 | mini-SWE-agent + MiniMax M2.5 | 2026-02 | 1 | single agent | $0.073 |

Verbatim, Sonar (#1): "Sonar Foundation Agent is a tool-calling-style agent... iteratively invokes tools to investigate and resolve the issue... has three tools: bash, str_replace_editor, and find_symbols."
Verbatim, ACoder (#8, the only class-A entry in the top 10): "built upon a subagent architecture... 'Subagent-as-a-Tool' philosophy. We encapsulate domain-specific capabilities into subagents, each running in its own independent context window" plus "Selection module employs four leading LLMs... to evaluate the candidates."
Verbatim, swebench.com on the bash-only track: "No tools, no special scaffold structure; just a simple ReAct agent loop."

Reading: 13 of the top 20 are single-attempt single agents. The #1 is a plain tool loop. The one orchestrator+subagent design in the top 10 sits 2.8pp below it despite also using a 4-model ensemble selector. A 100-line bash-only agent is within 2.4pp of #1 at under $1/instance.

### 2.2 Terminal-Bench
Live table is client-rendered and could not be fetched; numbers below are from submission repos and an archived 2025-11-03 snapshot `[dated]`.
- Apex2 (#1 at the time, 64.5% ± 1.8 with Sonnet 4.5), verbatim: "thoughtful architecture and sophisticated prompting beat complex multi-agent orchestration"; "reducing system complexity by 90%". Snapshot: Ante 60.3, Droid 57.5, Chaterm 52.5, Terminus 2 51.0 (all single-loop agents). https://github.com/heartyguy/Apex2-Terminal-Bench-Agent
- Meta-Harness (TB 2.0): 76.4% with Opus 4.6, single ReAct agent + environment preamble. https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact
- Orchestrator (Danau5tin/multi-agent-coding-system), a class-A orchestrator/explorer/coder/verifier design, README verbatim: "placing #12 on Stanford's Terminal Bench (not for very long, so screenshot above shows #13)". Reported: Sonnet-4 37.0% success, $263.56, 93.2M tokens over 400 trajectories `[subagent-extracted from README table; #12/13 placement re-verified, cost table not re-read]`. https://github.com/Danau5tin/multi-agent-coding-system

### 2.3 Aider polyglot leaderboard — architect/editor split `[unverified: WebFetch summary]`
o3 (high) + gpt-4.1 architect mode 78.2% at $17.55 vs o3 (high) alone 81.3% at $21.23. The two-model split was cheaper and 3.1pp worse. https://aider.chat/docs/leaderboards/

### 2.4 Vendor cost statements (Anthropic)
- Claude Code costs doc, verbatim: "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan mode, because each teammate maintains its own context window and runs as a separate Claude instance." "Keep teams small. Each teammate runs its own context window, so token usage is roughly proportional to team size." Enterprise average "$13 per developer per active day". https://code.claude.com/docs/en/costs
- Subagents doc, verbatim: use main conversation when "Multiple phases share significant context, such as planning, implementation, and testing"; "Running many subagents that each return detailed results can consume significant context." https://code.claude.com/docs/en/sub-agents
- Best practices, verbatim: "A fresh context improves code review since Claude won't be biased toward code it just wrote." (stated, not measured). https://code.claude.com/docs/en/best-practices
- GitHub Copilot cost post (2026-09-02): per-optimization savings of 2.3–5.5%; caution that "optimizing individual tool calls doesn't necessarily reduce overall task cost—agents may need additional retrieval steps when context is removed, ultimately increasing total expenditure." https://github.blog/ai-and-ml/github-copilot/how-we-make-ai-coding-more-cost-efficient-without-sacrificing-task-quality/

### 2.5 METR developer-productivity RCT (2025) and 2026 follow-up
URL: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
Verbatim: "When developers are allowed to use AI tools, they take 19% longer to complete issues"; "developers expected AI to speed them up by 24%, and even after experiencing the slowdown, they still believed AI had sped them up by 20%." 16 developers, 246 issues. No 2026 follow-up on METR's blog index as of today. Not a multi-agent study; it is the only RCT on AI-assisted coding time and it warns that self-reported speedup is unreliable — relevant because all "praise" evidence below is self-reported.

### 2.6 Cognition, "Don't Build Multi-Agents"
URL: https://cognition.com/blog/dont-build-multi-agents
Core claims: "Share context, and share full agent traces, not just individual messages"; "Actions carry implicit decisions, and conflicting decisions carry bad results." Position piece, no measurements.

### 2.7 User-filed cost reports (GitHub issues; all six issue numbers/titles re-verified via `gh api`)
Complaints with numbers, anthropics/claude-code:
- #66023 (2026-06-07) "Workflow tool: one invocation spawned 46 Opus subagents (~3M tokens) with no cost confirmation" — "~2,986,845 subagent tokens / 791 tool uses in ~18 minutes, for a task whose output was ultimately discarded."
- #87178 (2026-08-16) "Autonomous orchestration burned ~20% of a weekly Max quota on redundant self-validation loops the user never requested" — "~6M subagent tokens in the session; ~3M+ on validation; ~2M judged pure waste by the assistant's own accounting."
- #90443 (2026-08-28) subagent polling wake-ups: "~150k+ tokens per 30s wake for a no-op status check... estimated 1.8M+ tokens in pure polling overhead for one background command."
- #91942 (2026-09-04) two Workflow runs, "56 + 104 subagents, ~3.2M subagent tokens in ~12 minutes... 92 of 160 agents" hit the session limit.
- #94770 (2026-09-16) "premium-model fan-out burned ~70% of a weekly Fable 5.1 allowance" — 12 then 20 parallel subagents, ~2.0M tokens, mostly killed by rate limit; "The same prompt in a single-thread run on a competing product consumed ~7% of that product's allowance and produced output of comparable quality."
- #82101, #87815, #92090, #84223 (subagent-extracted, not re-verified): 9 workflows / 100 agents / 17.38M tokens in ~24h; fleets inheriting premium model tier; Fable 5.1 subagents re-caching 200–430K contexts ("8 parallel agents re-wrote 2.9M tokens in 40 min"); subagent usage under-reported by up to ~2/3.
- openai/codex #45790 (2026-09-15, verified): subagents boot in the orchestrator's model and re-orient before switching — "burning a ton of tokens in my orchestrator model."

Praise with numbers: **none found** across anthropics/claude-code, openai/codex, sst/opencode, google-gemini/gemini-cli with the queries used. Issue trackers are complaint-skewed, so this is an absence of evidence in this channel, not evidence of absence. No vendor has published a quantified quality/time win for parallel multi-agent coding in the sources checked.

---

## 3. Verify / evaluator loops

Evidence FOR (grounded verification):
- Executable-test selection: CodeMonkeys 45.8% (random) → 57.4% (selector), TRAE 70.6% → 78.8%, AlphaCodium 19% → 44% (section 1.9). All three verify against **running tests**, not against a second model's opinion.
- CriticGPT (arXiv 2407.00215, code): model critiques preferred over human critiques in 63% of cases; "LLMs catch substantially more inserted bugs than qualified humans paid for code review"; but "Critics can have limitations of their own, including hallucinated bugs that could mislead humans... human-machine teams of critics and contractors catch similar numbers of bugs to LLM critics while hallucinating less than LLMs alone." Explicit Pareto trade-off between comprehensiveness and spurious claims. https://arxiv.org/abs/2407.00215
- MAST intervention: adding task-objective verification to ChatDev +15.6% on ProgramDev (1.1).

Evidence AGAINST (same-model, opinion-based verification):
- Self-repair at equal compute ≈ 1.05x pass@20 for GPT-4 (1.5); intrinsic self-correction degrades math/QA accuracy (1.5).
- MAST: 24.5% of MAS failures are the verification step itself — incorrect verification 9.1%, no/incomplete 8.2%; "passes superficial checks (e.g., code compilation)".
- Debate: no gain over majority vote at equal samples (1.4).
- Google, "Resolving code review comments with ML": calibrated to "a target precision of 50%"; "40% to 50% of all previewed suggested edits are applied"; precision was improved by "serving-time heuristics to filter" and "traded quantity for quality". https://research.google/blog/resolving-code-review-comments-with-ml/
- "Automated Code Review In Practice" (arXiv 2412.18531, industrial, 4,335 PRs): 73.8% of AI comments resolved, but PR closure time rose from 5h52m to 8h20m; practitioners cite "faulty reviews, unnecessary corrections, and irrelevant comments." https://arxiv.org/abs/2412.18531
- Greptile v4 A/B ("hundreds of thousands of PRs"): comments addressed 30% → 43%; addressed per PR 0.92 → 1.60. Even after improvement, 57% of AI review comments are not acted on. "Addressed" is LLM-judged. https://www.greptile.com/blog/greptile-v4
- CodeJudgeBench (arXiv 2507.10535): "Simply changing the order in which responses are presented can substantially impact accuracy"; thinking models judge much better than non-thinking; pairwise beats pointwise. https://arxiv.org/abs/2507.10535

Not found: any published precision / false-positive rate for an "adversarial verify" phase applied to AI-generated review findings (i.e., a second agent screening a first agent's findings). Cursor Bugbot page returned 404; CodeRabbit and Graphite publish no precision numbers that were reachable. **No measurement exists in the sources checked that a critic-of-the-critic reduces false findings.** The nearest evidence is CriticGPT's human+critic team (fewer hallucinations than the critic alone) and Google's heuristic filtering — both are filters with an independent signal (a human, or user-feedback-derived rules), not a second LLM opinion.

---

## 4. Summary table

| Study / source | Task type | Multi-agent vs single result | Cost multiplier | Notes |
|---|---|---|---|---|
| Scaling Agent Systems 2512.08296 | SWE-bench Verified (coding) | All 4 MAS variants worse: −2.1% to −14.9% | 1.6–6.2x tokens vs single | Controlled, 3 model families; negative returns once single agent > ~45% |
| Same | Terminal-Bench (coding/CLI) | Centralized −19.2%; independent +1.7% | same | Low tool count limits orchestration benefit |
| Same | Finance-Agent (decomposable QA) | Centralized +80.8% | same | Where MAS wins: parallelizable, non-coding |
| Same | PlanCraft (sequential planning) | −39% to −70% | same | Sequential dependencies punish splitting |
| MAST 2503.13657 | Coding + math + agent tasks | 41–86.7% failure rate across 7 MAS | n/a | 24.5% of failures are the verifier; +9.4/+15.6% from targeted fixes |
| Anthropic research system | Research (not coding) | +90.2% vs single Opus 4 | 15x vs chat (≈3.75x vs single agent) | Authors: coding "not a good fit" |
| Claude Code costs doc | Coding sessions | (no quality claim) | ~7x for agent teams | Vendor's own number |
| SWE-bench Verified top-20 (live) | Coding | #1 = single agent 79.2%; only class-A entry (ACoder) 76.4% | mini-SWE-agent $0.07–$0.75/inst | 13/20 single-attempt |
| TRAE (SWE-bench #3) | Coding | Class B: 70.6% → 78.8% with 30 rollouts + selector | ≈30x generation `[inferred]` | Selection, not delegation |
| CodeMonkeys 2501.14723 | Coding | Class B: random 45.8% → selected 57.4% (oracle 69.8%) | ≈$4.60/inst (~6x mini-SWE-agent) | Executable-test voting + selector trajectory |
| Terminal-Bench Orchestrator (Danau5tin) | Coding/CLI | Class A: 37.0%, #12–13, vs single-agent SOTA 64.5–76.4% | $263.56 / 93.2M tokens per 400 runs | Only public class-A cost table found |
| Apex2 (Terminal-Bench #1, 2025-11) | Coding/CLI | Single agent 64.5%, "beat complex multi-agent orchestration" | complexity −90% | Author's claim |
| Aider architect/editor `[unverified]` | Coding (polyglot) | 2-model split 78.2% vs single 81.3% | 0.83x cost | Cheaper, worse |
| More Agents 2402.05120 | HumanEval | Class C: GPT-3.5 67% → 73% at N=40 | 40x samples | Smallest gains on coding |
| Debate papers (2311.17371, 2508.17536, 2502.08788, 2310.01798) | Math/QA | Debate ≤ self-consistency at equal samples (83.2 vs 85.3) | more compute | No coding result either way |
| Self-Repair 2306.09896 | Coding (APPS/HumanEval) | Self-repair ≈ 1.05x i.i.d. sampling at equal budget; stronger-model feedback helps; human feedback 1.58x | — | Critic must be stronger than author |
| CriticGPT 2407.00215 | Code review | Critic > human 63%; human+critic hallucinate less than critic alone | — | Hallucinated bugs are the failure mode |
| Google ML code-review | Code review (prod) | Target precision 50%; 40–50% applied | — | Filtering via user-feedback heuristics |
| Automated Code Review In Practice 2412.18531 | Code review (industrial) | 73.8% comments resolved; PR closure +2.5h | — | Noise and slower cycles |
| Greptile v4 | Code review (prod) | 30% → 43% comments addressed | — | Vendor A/B, LLM-judged "addressed" |
| METR RCT 2025 | Coding (human + AI) | Humans 19% slower with AI, believed 20% faster | — | Self-reported speedup unreliable; no 2026 follow-up |
| Claude Code issues #66023 #87178 #90443 #91942 #94770 | Coding workflows | Output discarded / quota exhausted | 2–17M tokens per run; ~70% of weekly quota | Verified issue numbers; no numeric praise found |

---

## 5. What the evidence supports and does not support

**(a) Parallel read-only research/review lanes.**
Supported: context isolation. Long-context degradation is measured (Lost in the Middle, Context Rot), Anthropic's research eval shows +90% for breadth-first *research*, and the scaling study shows decomposable, low-dependency tasks (finance QA +80%) are where multi-agent wins. Reading files and returning a summary is exactly that shape. Independent-agent architectures also amplify errors 17x, so a lane's findings must be treated as claims to be checked, not results.
Not supported: that multiple review lanes produce *more correct* findings than one. No coding study measured N parallel reviewers vs one; debate literature says N voices ≈ majority vote, and review-tool data says 50–57% of AI review comments are not acted on. Cost is measured at 1.6–3.9x tokens vs a single agent for centralized fan-out (2512.08296), ~7x for agent teams (Anthropic).
Net: reasonable for large read-only sweeps where the alternative is flooding one context; the quality claim is unproven and the cost is 2–7x.

**(b) Parallel implementation lanes.**
Not supported. Every controlled coding comparison found is negative: SWE-bench −2 to −15%, Terminal-Bench centralized −19%, orchestrator entries below single-agent leaders on both leaderboards, aider's 2-model split worse than the single model. Anthropic and Cognition both state coding has too many shared-context dependencies. The scaling study's own model predicts negative returns once the single agent exceeds ~45% on the task, which current frontier models do on most repository tasks. User-filed reports show the tail risk (multi-million-token runs with discarded output). The one pattern that does help — parallel *rollouts of the same task* with a test-grounded selector (TRAE +8pp, CodeMonkeys) — is not decomposition; it is N independent full attempts plus selection, at roughly 6–30x generation cost.
Net: no measured evidence that splitting one implementation across role-specialized parallel agents beats one agent with tools; measured evidence that it is worse and costlier.

**(c) Verify / evaluator phases.**
Supported, with a condition: verification helps when it has an independent signal — executable tests (AlphaCodium 19→44, CodeMonkeys +11.6pp over random, TRAE +8.2pp), a strictly stronger model (Olausson), or a human in the loop (CriticGPT teams). MAST's +15.6% intervention was an objective-level check.
Not supported: same-model opinion verification. Self-repair at equal compute ≈ 1.05x; self-correction degrades QA accuracy; MAST attributes 24.5% of failures to the verifier; LLM judges are order-sensitive (CodeJudgeBench). No study measures whether a second LLM pass over a first LLM's review *findings* reduces false positives — that specific claim is unmeasured in every source checked. Google's and CriticGPT's false-positive reductions came from non-LLM filters (user-feedback heuristics, humans).
Net: a verify phase is worth its cost when it runs tests or a materially stronger judge; an "adversarial critic" using the same model class is unmeasured and the adjacent evidence (self-repair, debate) predicts small or zero gain.

**(d) Hard budget caps.**
No study measures the effect of budget caps on quality. What is measured: the scaling study's 1.6–6.2x token multiplier and 17x error amplification for uncoordinated agents; the user reports of 2–17M-token runs, ~70% of weekly quota, and workflows whose output was discarded (#66023, #94770); polling overhead of ~150k tokens per no-op wake (#90443); subagent usage under-reported by up to 2/3 (#84223) `[unverified]`. Anthropic's own guidance is "keep teams small", "shut down teammates when their work is done". Caps are justified by the measured cost distribution and its tail, not by any measured quality benefit. Note the GitHub Copilot caveat: trimming context can raise total cost by forcing extra retrieval; a cap that truncates a lane mid-task may waste everything spent on it (#91942: 92 of 160 agents killed by limit).
Net: caps are a cost-control necessity supported by cost data; there is no evidence about the quality trade-off of a cap, and some evidence that hard mid-flight kills waste the entire spend.

**(e) Resume.**
No evidence found in either direction. No paper, leaderboard writeup, or vendor doc measured checkpoint/resume of orchestrated runs. The only adjacent data are the failure reports where rate-limit kills discarded partial work (#91942, #94770), which imply resume would have preserved spent tokens — an inference `[unverified]`, not a measurement. Resume's value is an engineering argument about sunk cost, not something the literature has tested.

**Overall.** The measured record for coding is consistent: single agent + good tools is at or near the top of every 2026 coding leaderboard; orchestrator/role-specialized multi-agent designs are measured worse on coding (−2 to −19%) at 1.6–7x tokens; the only multi-agent pattern with measured coding gains is test-grounded selection over parallel rollouts of the same task; multi-agent wins are confined to decomposable, low-dependency, non-coding work (research, finance QA). Verification pays when grounded in tests or a stronger judge; unmeasured when it is another model's opinion. Budget caps and resume are unmeasured for quality; caps are supported by cost data alone.

---

## Sources (all fetched 2026-09-22)
- https://arxiv.org/abs/2503.13657 ; https://arxiv.org/html/2503.13657 (MAST)
- https://arxiv.org/html/2512.08296 (Scaling Agent Systems)
- https://arxiv.org/html/2402.05120v2 (More Agents)
- https://arxiv.org/html/2305.14325 ; https://arxiv.org/abs/2311.17371 ; https://arxiv.org/abs/2508.17536 ; https://arxiv.org/abs/2502.08788 (debate)
- https://arxiv.org/html/2310.01798 (self-correction) ; https://arxiv.org/html/2306.09896 (self-repair)
- https://arxiv.org/html/2308.00352 (MetaGPT) ; https://arxiv.org/abs/2312.13010 (AgentCoder)
- https://arxiv.org/abs/2307.03172 ; https://www.trychroma.com/research/context-rot ; https://arxiv.org/abs/2407.01489v1 (Agentless)
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://arxiv.org/html/2501.14723 (CodeMonkeys) ; https://arxiv.org/abs/2401.08500 (AlphaCodium) ; https://arxiv.org/html/2407.00215 (CriticGPT) ; https://arxiv.org/abs/2507.10535 (CodeJudgeBench)
- https://github.com/SWE-bench/swe-bench.github.io (data/leaderboards.json) ; https://github.com/SWE-bench/experiments ; https://github.com/SWE-agent/mini-swe-agent
- https://github.com/heartyguy/Apex2-Terminal-Bench-Agent ; https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact ; https://github.com/Danau5tin/multi-agent-coding-system
- https://aider.chat/docs/leaderboards/
- https://code.claude.com/docs/en/costs ; https://code.claude.com/docs/en/sub-agents ; https://code.claude.com/docs/en/best-practices
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://cognition.com/blog/dont-build-multi-agents
- https://github.blog/ai-and-ml/github-copilot/how-we-make-ai-coding-more-cost-efficient-without-sacrificing-task-quality/
- https://research.google/blog/resolving-code-review-comments-with-ml/ ; https://arxiv.org/abs/2412.18531 ; https://www.greptile.com/blog/greptile-v4
- GitHub issues: anthropics/claude-code #66023 #87178 #90443 #91942 #94770 (verified), #82101 #87815 #92090 #84223 (unverified); openai/codex #45790 (verified)
