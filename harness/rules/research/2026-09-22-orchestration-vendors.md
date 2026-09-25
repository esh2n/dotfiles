---
question: "What do vendors of coding agents and agent frameworks say orchestration (parallel subagents, orchestrator/worker, phases, workflows) is for, what it is not for, and what do they publish about its cost and quality?"
date: 2026-09-22
verdict: "Every coding-agent vendor studied ships some orchestration primitive but steers users toward a single agent by default and documents real costs where it publishes any number at all (Anthropic roughly 7x for agent teams, Cursor roughly 5x for parallel subagents, OpenAI 'consumes more tokens'). Vendors converge on code-driven/scripted control flow over LLM-driven graphs, disagree on whether subagents net-save or net-cost tokens, and only a handful (Anthropic, Cursor, Amp, Microsoft's Magentic-One paper) publish any hard multiplier at all; most publish none."
unverified:
  - "One WebFetch hallucination was caught and excluded: quotes attributed to OpenAI's multi-agent API docs ('Subagents do not support function tools'...) do not appear in that page's raw HTML and are not OpenAI's position"
  - "help.openai.com rate-limit articles returned 403 and were unreachable"
  - "Cursor's per-model price points, and whether a 'Best of N' or 'worktrees' doc page exists, could not be confirmed (404s)"
  - "AWS blog posts on Strands Agents multi-agent patterns could not be reached (search blocked)"
  - "OpenCode's raw CHANGELOG URL 404'd, so completeness of its subagent history is unconfirmed"
  - "Amp's 'How we build Amp' page requires sign-in and could not be read; no Thorsten Ball essay on subagents was located on Register Spill"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# How vendors position, ship, and caveat multi-agent orchestration (2026-09-22)

Question: what do the vendors of coding agents and agent frameworks say orchestration (parallel subagents, orchestrator/worker, phases, workflows) is FOR, what it is NOT for, and what do they publish about its cost and quality? Negative evidence collected with the same rigor as positive. Nothing here assumes orchestration is good.

## Method and verification status

- Sources were fetched on 2026-09-22 via WebFetch, `curl` (raw HTML stripped), and `gh api` / raw GitHub. WebSearch was exhausted for the session; discovery relied on known URLs, sitemaps, repo listings and issue trackers.
- Quotes marked **[verified-raw]** were re-checked by me against the raw page text with `grep` after the researcher reported them. Quotes without that mark came through WebFetch's summarizing model and are very likely verbatim but not byte-checked; anything I could not open at all is marked **[unverified]**.
- One WebFetch hallucination was caught and excluded: quotes attributed to `developers.openai.com/api/docs/guides/agents-api/multi-agent` ("Subagents do not support function tools", "Keep short tasks and dependent steps in the main agent") do **not** appear in that page's raw HTML. They are not OpenAI's position and are not used below.
- Several doc sites moved during the research: `cognition.ai/blog/*` -> `cognition.com/blog/*`; `google.github.io/adk-docs` -> `adk.dev`; `docs.windsurf.com` -> `docs.devin.ai/desktop/*`; `docs.cursor.com` -> `cursor.com/docs`; `anthropic.com/engineering/claude-code-best-practices` -> `code.claude.com/docs/en/best-practices` (308). Original URLs are given where the content is identical.

---

## 1. OpenAI

### 1a. "A practical guide to building agents" (PDF) [verified-raw via pdftotext]
URL: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf

What they ship: guidance only (patterns for the Agents SDK). Two orchestration categories: single-agent systems and multi-agent systems; the latter split into "Manager (agents as tools)" and "Decentralized (agents handing off to agents)".

Default recommendation (p.15, "When to consider creating multiple agents"):
> "Our general recommendation is to maximize a single agent's capabilities first. More agents can provide intuitive separation of concepts, but can introduce additional complexity and overhead, so often a single agent with tools is sufficient."

When to split (same page):
> "When your agents fail to follow complicated instructions or consistently select incorrect tools, you may need to further divide your system and introduce more distinct agents."
> "Complex logic: When prompts contain many conditional statements (multiple if-then-else branches), and prompt templates get difficult to scale, consider dividing each logical segment across separate agents."
> "Tool overload: The issue isn't solely the number of tools, but their similarity or overlap. Some implementations successfully manage more than 15 well-defined, distinct tools while others struggle with fewer than 10 overlapping tools. Use multiple agents if improving tool clarity by providing descriptive names, clear parameters, and detailed descriptions doesn't improve performance."

Alternative to multi-agent named explicitly (p.14):
> "An effective strategy for managing complexity without switching to a multi-agent framework is to use prompt templates."

Conclusion (p.32):
> "Use orchestration patterns that match your complexity level, starting with a single agent and evolving to multi-agent systems only when needed."

Published cost numbers: none. Failure modes named: instruction-following failure, wrong tool selection, "complexity and overhead".

### 1b. Agents SDK docs (Python)
URLs: https://openai.github.io/openai-agents-python/multi_agent/ , https://openai.github.io/openai-agents-python/handoffs/

> "While orchestrating via LLM is powerful, orchestrating via code makes tasks more deterministic and predictable, in terms of speed, cost and performance."
> "Use agents as tools when a specialist should help with a bounded subtask but should not take over the user-facing conversation. Use handoffs when routing itself is part of the workflow."
> Handoffs: "Input guardrails still apply only to the first agent in the chain, and output guardrails only to the agent that produces the final output." / "Nested handoff history changes how the transcript is represented; it does not redact sensitive data."

Published cost numbers: none. No statement in the SDK docs on when single-agent suffices; that guidance lives only in the PDF above.

### 1c. Codex — Subagents doc [verified-raw]
URL: https://developers.openai.com/codex/agent-configuration/subagents (redirects to learn.chatgpt.com/docs/agent-configuration/subagents)

What they ship: "Current Codex releases enable subagent workflows by default." across ChatGPT Work, Codex CLI, IDE extension; `/agent` command to inspect threads.

Trigger model is explicit-request at most tiers:
> "At most intelligence levels, ask for subagents or parallel agent work directly. Ultra enables proactive delegation, so ChatGPT can delegate suitable independent work without a separate request."

Cost caveat, stated twice on the page:
> "Because each subagent does its own model and tool work, subagent workflows consume more tokens than comparable single-agent runs."

Read vs write guidance:
> "As a starting point, use parallel agents for read-heavy tasks such as exploration, tests, triage, and summarization. Be more careful with parallel write-heavy workflows, because agents editing code at once can create conflicts and increase coordination overhead."

Rationale offered (quality, not speed): "Context pollution: useful information gets buried under noisy intermediate output. Context rot: performance degrades as the chat fills up with less relevant details." (cites Chroma's external "context rot" writeup, not an OpenAI measurement).

### 1d. Codex source (openai/codex, codex-rs) — shipped default is non-proactive
URL: https://raw.githubusercontent.com/openai/codex/main/codex-rs/prompts/src/model_messages/multi_agent.rs
> "Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work."

Proactive variant (opt-in): "If at any point you can parallelize work by delegating tasks to another agent (no matter if you are root or subagent), you should do so using collaboration tools if it could save time or improve quality."

Model-facing hazard text (codex-rs/prompts/src/multi_agent_instructions.rs): "All agents have access to the same container and filesystem as you. All agents use the same current working directory. As a result, edits made by one agent are immediately visible to all other agents." and "There are {max_concurrency} available concurrency slots".

Internal recursion guard (codex-rs/memories/README.md): the memory-consolidation subagent "disables collab for that agent (to prevent recursive delegation)".

### 1e. Responses API "Multi-agent" (beta) [verified-raw]
URL: https://developers.openai.com/api/docs/guides/responses-multi-agent

> "Multi-agent is available as a beta feature with all GPT-5.6 models." / "Item schemas may change while Multi-agent is in beta."
> Decision table: "Use Multi-agent when: Work can be split into independent, bounded tasks / Separate context improves focus / Parallel exploration can reduce wall-clock time / Comparing independent findings improves coverage" vs "Prefer one agent when: Each step depends directly on the previous step / The task is small enough to complete in one short run / Agents would contend over the same mutable resource / You require a fixed, deterministic execution graph".
> "Note that adding subagents can increase token usage, and may not be as beneficial for tasks that depend on a single ordered chain of reasoning, require frequent writes to shared mutable state, or are already dominated by one slow external operation."
> "The API does not impose a fixed upper bound on this setting. The default is 3, which is recommended for most workloads. Multi-agent runs also have no fixed limit on tree depth or the total number of subagents created during a run."

### 1f. Codex Cloud / pricing / worktrees
- Cloud "when to use" (WebFetch, not raw-checked): "Work needs to run in the background", "You want to compare several attempts", "Work starts in GitHub, GitLab, Linear, or Slack", "You are away from your development machine". URL: https://developers.openai.com/codex/cloud
- Pricing: no per-subagent multiplier published. The only published multiplier is for speed, not agents: Fast mode "a 2.5x multiplier to Astra's Standard rate". URL: https://developers.openai.com/codex/pricing [WebFetch]
- Worktrees: "Work in parallel with Codex without disturbing your current Local setup." Default keep count 15 (`DEFAULT_WORKTREE_KEEP_COUNT = 15` in codex-rs/worktree/src/settings.rs). URL: https://developers.openai.com/codex/environments/git-worktrees [WebFetch]
- help.openai.com rate-limit articles returned 403 **[unverified]**.

**OpenAI summary.** Ships subagents on by default but non-proactive by default; explicit "consume more tokens" caveat with no multiplier; explicit "prefer one agent when" list; names shared-filesystem write conflicts. No published quality delta.

---

## 2. Google

### 2a. ADK — agents overview
URL: https://raw.githubusercontent.com/google/adk-docs/main/docs/agents/index.md (live: https://adk.dev/agents/)
> "ADK does not impose any hard requirements to move from a single-agent architecture to a multi-agent or graph-based Workflow architecture. You can decide when to make that change based on the needs of your project, or as you discover limitations of a single-agent approach, such as: Instruction following performance: Beyond a certain length or complexity of a multiple step set of instructions, you may discover that a single agent does not reliably complete all instructions... Context limitations... Agent code modularity... Mixing deterministic and non-deterministic tasks".

### 2b. ADK — template workflow agents (Sequential / Parallel / Loop)
URLs: https://raw.githubusercontent.com/google/adk-docs/main/docs/agents/workflow-agents/{index,sequential-agents,parallel-agents,loop-agents}.md

Status caveat on every page:
> "Starting in ADK 2.0 for Python and Go, template workflows have been superseded by more flexible workflow structures, including graph-based workflows and dynamic workflows."

Framing: "They determine the execution sequence according to their type, such as sequential, parallel, or loop, without consulting an AI model for assistance with the orchestration. This approach results in deterministic and predictable execution patterns."

Sequential: "Use SequentialAgent when you want execution to occur in a fixed, strict order."

Parallel — when to use and named failure modes:
> "This execution strategy can dramatically speed up workflows where two or more tasks can be performed independently... it is important that each sub-agent can operate without depending on the other sub-agents."
> "There is no automatic sharing of conversation history or state between these branches during execution." / "The order of results may not be deterministic."
> "If you need communication or data sharing between these agents, you must implement it explicitly... you'd need to manage concurrent access to this shared context carefully (e.g., using locks) to avoid race conditions."

Loop — infinite-loop hazard:
> "Crucially, the LoopAgent itself does not inherently decide when to stop looping. You must implement a termination mechanism to prevent infinite loops."

LLM-driven delegation (docs/agents/custom-agents.md, llm-agents.md): "the behavior of this type of agent is non-deterministic and must be built and evaluated with this behavior in mind." RoutedAgent (docs/agents/routing.md) is "experimental and may change in future releases."

Published cost numbers: none. "dramatically", "significantly", "substantial performance gains" are unquantified.

### 2c. Google Cloud blog — a named failure mode of `transfer_to_agent`
URL: https://cloud.google.com/blog/products/ai-machine-learning/build-multi-agentic-systems-using-google-adk (2025-07-03)
> "Monolithic agents often crumble under their own weight because of instruction overload, inaccurate outputs, and brittle systems that are impossible to scale."
> "When the Root Agent calls the Flight Agent as a sub-agent, the responsibility for answering the user is completely transferred to the Flight Agent. The Root Agent is effectively out of the loop... This often leads to incomplete or irrelevant answers because the broader context of the initial multi-step request is lost".
Fix proposed: use `AgentTool` (manager keeps control) instead of one-way transfer. No numbers.

### 2d. Gemini CLI — subagents
URL: https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/core/subagents.md
> "Recursion protection: To prevent infinite loops and excessive token usage, subagents cannot call other subagents. If a subagent is granted the `*` tool wildcard, it will still be unable to see or invoke other agents."
> Generalist: "Use this agent when a task requires many steps, handles large volumes of information, or requires the same full capabilities as the main agent... By delegating these tasks, you prevent your main conversation from becoming cluttered or slow."
> Browser agent: "`maxActionsPerTask` — Maximum tool calls per task. The agent is terminated when the limit is reached." (default 100)

Maintainer positions in the tracker (negative evidence):
- https://github.com/google-gemini/gemini-cli/issues/18287 — "This issue is blocked until we have sufficient logic to support parallel subagents." (abhipatel12)
- https://github.com/google-gemini/gemini-cli/issues/15179 — "For the v1, we intentionally avoid letting subagent delegate to more subagents." (abhipatel12)
- https://github.com/google-gemini/gemini-cli/issues/25534 — open P2 report: "The first subagent ran in 5 mins, the second took about 12 mins, the third in sequence took over 15 mins." (user report, no root cause from Google in-thread)

Extensions can bundle subagents: "Gemini CLI extensions package prompts, MCP servers, custom commands, themes, hooks, sub-agents, and agent skills" (docs/extensions/index.md).

### 2e. Jules
URL: https://jules.google/docs/usage-limits/ [verified by researcher from raw HTML]
Concurrency is the only hard number: Daily tasks 15 / 100 / 300 and Concurrent tasks 3 / 15 / 60 for free / Pro / Ultra. "task limits are not shared or pooled."
URL: https://jules.google/docs/guides/continuous-ai-overview — "You can kick off multiple tasks in parallel and watch your to-do list shrink in real-time." No documented caveat about two parallel tasks touching the same files/branch (checked /docs/running-tasks/, /docs/errors/, /docs/tasks-repos/ — none).

**Google summary.** ADK: deterministic template workflows (now "superseded" by graph workflows), explicit race-condition and infinite-loop hazards, no cost numbers. Gemini CLI: subagents are single-level by design; parallel subagent collaboration is "blocked" per maintainers. Jules: quotas only. No Google source publishes a token multiplier or quality delta for any pattern.

---

## 3. Anthropic — Claude Code docs only (not the two known essays)

All quotes below are from `code.claude.com/docs/en/*` (docs.claude.com / docs.anthropic.com redirect there). Items marked [verified-raw] were grepped from the `.md` endpoints.

### 3a. Subagents (`/docs/en/sub-agents`) [verified-raw]
> "Use the main conversation when: The task needs frequent back-and-forth or iterative refinement / Multiple phases share significant context, such as planning, implementation, and testing / You're making a quick, targeted change / Latency matters. A subagent that isn't a fork starts fresh and may need time to gather context"
> "Use subagents when: The task produces verbose output you don't need in your main context / You want to enforce specific tool restrictions or permissions / The work is self-contained and can return a summary"
> "Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history, the skills you've already invoked, or the files Claude has already read."
No "experimental" label. Positioned as a context-preservation tool, not a throughput tool.

### 3b. Agent teams (`/docs/en/agent-teams`) [verified-raw]
> "Agent teams are experimental and disabled by default." (gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
> "Before you set up a team, check whether a lighter option does the job."
> "Agent teams add coordination overhead and use significantly more tokens than a single session. They work best when teammates can operate independently. For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective."
> "For research, review, and new feature work, the extra tokens are usually worthwhile. For routine tasks, a single session is more cost-effective."
> Comparison table: "Token cost | Lower: results summarized back to main context | Higher: each teammate is a separate Claude instance"
> "Token costs scale linearly: each teammate has its own context window and consumes tokens independently." / "Start with 3-5 teammates for most workflows... If you have 15 independent tasks, 3 teammates is a good starting point." / "Three focused teammates often outperform five scattered ones."
Limitations list (verbatim heads): no session resumption with in-process teammates; "Task status can lag: teammates sometimes fail to mark tasks as completed, which blocks dependent tasks"; "Shutdown can be slow"; one team per session; "No nested teams"; lead is fixed; permissions set at spawn.

### 3c. Costs (`/docs/en/costs`) [verified-raw]
The one hard multiplier published by any coding-agent vendor:
> "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan mode, because each teammate maintains its own context window and runs as a separate Claude instance. Keep team tasks small and self-contained to limit per-teammate token usage."
> "Delegate verbose operations to subagents: Running tests, fetching documentation, or processing log files can consume significant context. Delegate these to subagents so the verbose output stays in the subagent's context while only a summary returns to your main conversation."
> "Agent teammates: each active teammate keeps consuming tokens until it exits" (listed as a driver of climbing usage)
> Cost-control list: "Use Sonnet for teammates" / "Keep teams small" / "Keep spawn prompts focused" / "Shut down teammates when their work is done."
> Cache-stat caveat: "It covers the main conversation only, not subagents."

### 3d. Workflows / Workflow tool (`/docs/en/workflows`) [verified-raw]
> "A workflow spawns many agents, so a single run can use meaningfully more tokens than working through the same task in conversation. Runs count toward your plan's usage and rate limits."
> "When a workflow schedules more than 25 agents, or its projected token total passes 1.5 million, its progress line in the task panel below the input box shows a `Large workflow` warning." / "The warning is advisory: it doesn't pause or limit the run."
> "Reach for a workflow when a task needs more agents than one conversation can coordinate, or when you want the orchestration codified as a script you can read and rerun."
> Limits: "Up to 16 concurrent agents by default... Up to 4,096 items in a single parallel() or pipeline() call... 1,000 agents total per run".
> Comparison table row "Scale": Subagents "A few delegated tasks per turn" / Agent teams "A handful of long-running peers" / Workflows "Dozens to hundreds of agents per run".
Not labeled experimental (available on paid plans, API, Bedrock, Vertex, Foundry). Advice: "run the workflow on a small slice first".

### 3e. Best practices (`/docs/en/best-practices`; the engineering blog post now 308-redirects here)
> "Since context is your fundamental constraint, use subagents to keep research out of it."
> Adversarial review caveat: "A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do. Chasing every finding leads to over-engineering: extra abstraction layers, defensive code, and tests for cases that can't happen."
> "Plan mode is useful, but also adds overhead. For tasks where the scope is clear and the fix is small... ask Claude to do it directly."
> Parallel options list labels: "Agent view: research preview" / "Agent teams: experimental and disabled by default".
> "A fresh context improves code review since Claude won't be biased toward code it just wrote."

### 3f. Agent SDK subagents (`/docs/en/agent-sdk/subagents`)
> "Each subagent makes its own API requests, which count toward the query's total_cost_usd, and a subagent can spawn subagents of its own, so one prompt can grow into a tree of agents. You can cap that growth in three ways: how deeply subagents nest, how many run at once, and how much the whole query spends."
> "Claude Opus 5 delegates to subagents more readily than earlier models, so the depth, concurrency, and spend limits matter most on queries that run Opus 5."
> "The parent receives the subagent's final message as the Agent tool result, but may summarize it in its own response."

### 3g. "Effective context engineering" (multi-agent paragraph only)
URL: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
> "Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)."

### 3h. Changelog (partial scan, **[unverified: completeness]**)
URL: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- v2.1.268: "Changed `/code-review` to use leaner inline review prompts for every model that has no tuned settings of its own, instead of spawning many review subagents" — a case of reducing subagent use.
- v2.1.271/278: subagent results now arrive "under a header marking them as subagent output... so text in a subagent's result cannot pass as the session's own instructions" (prompt-injection hardening); `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1-256) added.

**Anthropic summary.** Three tiers with escalating cost language: subagents (cost-reduction framing, no multiplier), agent teams ("significantly more", "approximately 7x" in plan mode, experimental), workflows ("meaningfully more", 25-agent / 1.5M-token advisory warning, not experimental). Explicit steer to the lighter option first.

---

## 4. Cognition (Devin, Windsurf)

### 4a. "Don't Build Multi-Agents" (2025-06-12) — cost/failure parts only [verified-raw]
URL: https://cognition.ai/blog/dont-build-multi-agents (canonical: cognition.com)
> "it is evident that in 2025, running multiple agents in collaboration only results in fragile systems. The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough between the agents."
> "I personally think it will come for free as we make our single-threaded agents even better at communicating with humans. When this day comes, it will unlock much greater amounts of parallelism and efficiency."
Failure mode named: two subagents "cannot not see what the other was doing and so their work ends up being inconsistent with each other." No cost numbers.

### 4b. "Multi-Agents: What's Actually Working" (2026-04-22, same author) [verified-raw]
URL: https://cognition.ai/blog/multi-agents-working
> "10 months ago I argued against building multi-agent systems. Today, a narrower class works, where agents contribute intelligence while writes stay single-threaded."
> "most of the sexy ideas in that space still don't see meaningful adoption. But we've found a narrower class of patterns that do: setups where multiple agents contribute intelligence to a task while writes stay single-threaded."
> "multi-agent systems work best today when writes stay single-threaded and the additional agents contribute intelligence rather than actions. A clean-context reviewer catches bugs the coder can't see."
Quality number: "even on PRs written by Devin, Devin Review catches an average of 2 bugs per PR, of which roughly 58% are severe (logic errors, missing edge cases, security vulnerabilities)."
Named failure: "SWE 1.5 was not good enough at being the primary model for this setup to really work. The gap between it and Sonnet 4.5 was too wide." / open problem: "How does a weaker model learn when to escalate?"
This is a narrowing, not a reversal: parallel writers with siloed context are still not endorsed.

### 4c. Devin docs — Dynamic Workflows [verified-raw]
URL: https://docs.devin.ai/work-with-devin/dynamic-workflows
> "Every agent in a workflow is a Devin session, so one run can consume far more ACUs than doing the same task in a single session. Before pointing a workflow at an entire repo, run it on a slice — one directory, three modules, a narrower question — and check the ACU usage".
> Use when: "Wide fan-out with a combine step — roughly five or more independent units (files, modules, endpoints, tickets) that each need judgment or verification, whose results are then rolled up." or staged pipelines "audit -> fix -> verify".
> Stay single-session when changes "are mechanical, involve only one or two independent tasks, or feature tightly coupled shared state." [WebFetch]
> Parallel writers require "strictly non-overlapping files or directories". [WebFetch]

### 4d. Devin docs — Managed Devins / "Devin can now Manage Devins" (2026-03-19)
URLs: https://docs.devin.ai/work-with-devin/advanced-capabilities , https://cognition.ai/blog/devin-can-now-manage-devins
> "Break down a large task and delegate pieces to a team of managed Devin sessions, each running in its own isolated VM."
> Coordinator: "Monitor ACU consumption — track how much compute each child session is using".
> Rationale: "when one agent tries to handle too many things in a single session, context accumulates, focus degrades, and the quality of each subtask suffers."
No ACU multiplier published; Enterprise ACU rate is order-form only (https://docs.devin.ai/admin/billing/enterprise).

### 4e. Windsurf Cascade (now under docs.devin.ai/desktop)
URL: https://docs.devin.ai/desktop/cascade/cascade
> "If two Cascades edit the same file at the same time, the edits can race, and sometimes the second edit will fail." / recommends worktrees "if you expect two Cascades to edit similar files".

**Cognition summary.** The strongest published skeptic; 2026 position: multi-agent only where "writes stay single-threaded" (reviewers, smart-friend escalation) plus file-isolated fan-out under a deterministic script. Cost language is "far more ACUs", never a number.

---

## 5. Cursor

URLs: https://cursor.com/docs/agent/subagents [verified-raw], https://cursor.com/docs/background-agent , https://cursor.com/blog/projects , https://cursor.com/changelog , https://cursor.com/docs/account/pricing

Subagents doc:
> "Subagents consume tokens independently — Each subagent has its own context window and token usage. Running five subagents in parallel uses roughly five times the tokens of a single agent."
> "Subagents can be slower — The benefit is context isolation, not speed. A subagent doing a simple task may be slower than the main agent because it starts fresh."
> "Evaluate the overhead — For quick, simple tasks, the main agent is often faster. Subagents shine for complex, long-running, or parallel work."
> "If you find yourself creating a subagent for a simple, single-purpose task like 'generate a changelog' or 'format imports,' consider using a skill instead."
When to use: "You need context isolation for long research tasks / Running multiple workstreams in parallel / The task requires specialized expertise across many steps / You want an independent verification of work".

Cloud Agents: "Cloud Agents are charged at API pricing for the selected model." Advice to "set a spend limit". Named limitations: long-running unavailable for multi-repo; hooks skip early read-only phases; `.env.local` not carried by default. [WebFetch]

Projects (2026-09-10 blog + changelog): "delegates tasks to thousands of subagents"; "The coordinator doesn't write code itself but directs other agents that do." Self-reported throughput: new users "merge 30% more PRs while users who primarily use Projects merge six times as many" (adoption/throughput, not correctness). The post contains **no cost, merge-conflict, or QA discussion** (negative finding). Changelog 2026-08-19: "Subagents can now run on their own virtual machines."

Pricing: Max Mode (legacy plans) billed "at the model's API rate plus 20%"; long context ">256k input tokens is billed at 2x standard rates". Per-model price points **[unverified-fetch]**. "Best of N" and a "worktrees" doc page were not found (404s) **[unverified]**.

**Cursor summary.** Only vendor besides Anthropic to put a number on it ("roughly five times"), and explicitly says the benefit is isolation "not speed". Projects marketing carries no caveats at all.

---

## 6. Microsoft (Agent Framework, AutoGen, Magentic-One)

### 6a. Agent Framework overview
URL: https://learn.microsoft.com/en-us/agent-framework/overview/agent-framework-overview
> Table: "Use an agent when… The task is open-ended or conversational / You need autonomous tool use and planning / A single LLM call (possibly with tools) suffices" vs "Use a workflow when… The process has well-defined steps / You need explicit control over execution order / Multiple agents or functions must coordinate".
> "If you can write a function to handle the task, do that instead of using an AI agent."
> "You are responsible for any usage and associated costs."

### 6b. Orchestration patterns
URL: https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/ (+ /sequential, /concurrent, /handoff, /group-chat, /magentic)
Five patterns: Sequential, Concurrent, Handoff, Group Chat, Magentic. Only Group Chat and Magentic carry explicit guidance:
> Group Chat "Consider alternatives when: You need strict sequential processing (use Sequential) / Agents should work completely independently (use Concurrent) / Direct agent-to-agent handoffs are needed (use Handoff) / Complex dynamic planning is required (use Magentic)".
> Magentic: "If your scenario requires simpler coordination without complex planning, consider using the Group Chat pattern instead."
> Magentic: "it is untested how well the Magentic orchestration will perform outside of the original Magentic-One design."
> Magentic: "Warning: Don't share a stateful explicit `manager` across concurrent or interleaved workflows."
Semantic Kernel's copy of the same page: "Agent Orchestration features in the Agent Framework are in the experimental stage." (https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/)

### 6c. AutoGen status [verified-raw by researcher via curl]
URL: https://raw.githubusercontent.com/microsoft/autogen/main/README.md
> "AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."

### 6d. Magentic-One paper [verified-raw]
URL: https://arxiv.org/html/2411.04468v1 (Section 6.2)
> "Magentic-One requires dozens of iterations and LLM calls to solve most problems. The latency and cost of those calls can be prohibitive, incurring perhaps several US dollars, and tens of minutes per task."
Benchmarks reported: GAIA 38% (best config), AssistantBench 13.3% EM, WebArena 32.8% (percentages as reported by the researcher, not re-checked against the PDF table). Failure modes named: persistent inefficient actions, insufficient verification, underutilized resources; agents "repeatedly attempt and fail to log into a WebArena website" leading to account suspension; agents "attempted to recruit human assistance by posting on social media".
MSR blog (https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/): "Magentic-One may be susceptible to prompt injection attacks from webpages."; "Run all tasks in docker containers".

**Microsoft summary.** Ships five orchestration patterns; guidance is "prefer a function, then an agent, then a workflow"; Magentic explicitly "untested" outside its origin; the only cost statement is the paper's "several US dollars, and tens of minutes per task". No token multiplier anywhere in Microsoft docs.

---

## 7. LangChain (LangGraph, Deep Agents)

### 7a. Multi-agent concepts
URL: https://docs.langchain.com/oss/python/langchain/multi-agent (the /langgraph/multi-agent URL 404s)
> "Not every complex task requires this approach—a single agent with the right (sometimes dynamic) tools and prompt can often achieve similar results."
Multi-agent is valuable when "a single agent has too many tools and makes poor decisions about which to use, when tasks require specialized knowledge with extensive context... or when you need to enforce sequential constraints."
Overheads named: subagent pattern costs 4 calls vs 3 on one-shot requests ("this overhead provides centralized control"); skills: "every subsequent call processes all 6K tokens of skill documentation"; handoffs "must execute sequentially and can't leverage parallel tool calling."

### 7b. Deep Agents subagents
URL: https://docs.langchain.com/oss/python/deepagents/subagents
> Use for: "Multi-step tasks that would clutter the main agent's context"; "Specialized domains"; "Tasks requiring different model capabilities"; "When you want to keep the main agent focused on high-level coordination."
> Avoid for: "Simple, single-step tasks"; "When you need to maintain intermediate context"; "When the overhead outweighs benefits."
> Forking: "APIs and behavior may change between releases."
The deepagents README (https://raw.githubusercontent.com/langchain-ai/deepagents/main/README.md) and the "Deep Agents" launch post (https://blog.langchain.com/deep-agents/) contain **no** cost/complexity caveats (negative finding).

### 7c. "Benchmarking multi-agent architectures"
URL: https://blog.langchain.com/benchmarking-multi-agent-architectures/
> "the single agent baseline falls off sharply when there are two or more distractor domains"
> "single agent uses consistently more tokens as the number of distractor domains grows, while supervisor and swarm remain flat" / "supervisor consistently uses more tokens than swarm"
> "swarm architecture slightly outperforms supervisor architecture across the board"
> Self-limitation: the study tests "best-case performance" because "very little coordination is required in practice to pass a test case, apart from filtering out irrelevant tools and instructions."
> "this architecture may not [be] feasible in all cases"
Note: in this narrow tool-routing benchmark multi-agent was cheaper than single-agent as distractor count grew — the opposite direction from every coding-agent vendor's statement.

### 7d. Other LangChain posts
- "How to think about agent frameworks" (https://blog.langchain.com/how-to-think-about-agent-frameworks/): "Agent abstractions can make it easy to get started, but they can often obfuscate and make it hard to make sure the LLM has the appropriate context at each step." / "This blend of workflows and agents often gives the best reliability."
- "Context engineering for agents" (https://blog.langchain.com/context-engineering-for-agents/): cites Anthropic's "up to 15x more tokens than chat" (attributed, not LangChain's measurement); challenges "token use... the need for careful prompt engineering to plan sub-agent work, and coordination of sub-agents."
- langgraph-supervisor README (https://raw.githubusercontent.com/langchain-ai/langgraph-supervisor-py/main/README.md): "We now recommend using the supervisor pattern directly via tools rather than this library for most use cases. The tool-calling approach gives you more control over context engineering." — a self-deprecation of their packaged abstraction.
- langgraph-swarm README: shared `messages` key "may expose internal agent histories undesirably"; "Without it [short-term memory], the swarm would 'forget' which agent was last active".

**LangChain summary.** Ships everything; docs say single agent "can often achieve similar results"; their own benchmark shows multi-agent cheaper in a distractor-tool setting but they flag it as best-case; flagship README/launch post carry zero caveats; they retired their own supervisor library in favor of raw tool calls.

---

## 8. CrewAI

Quotes below were copied by the researcher from the raw `.md` endpoints of docs.crewai.com and the GitHub README (not WebFetch summaries).

### 8a. Crews and Processes
URLs: https://docs.crewai.com/en/concepts/crews , https://docs.crewai.com/en/concepts/processes
> "Sequential: Executes tasks sequentially, ensuring tasks are completed in an orderly progression."
> "Hierarchical: Organizes tasks in a managerial hierarchy, where tasks are delegated and executed based on a structured chain of command. A manager language model (`manager_llm`) or a custom manager agent (`manager_agent`) must be specified".
> "Tasks are not pre-assigned; the manager allocates tasks to agents based on their capabilities, reviews outputs, and assesses task completion."
No cost/complexity caveat comparing sequential and hierarchical on either page.

### 8b. Hierarchical process
URL: https://docs.crewai.com/en/learn/hierarchical-process
> "The hierarchical process is designed to leverage advanced models like GPT-4, optimizing token usage while handling complex tasks with greater efficiency." (tip box; no number or benchmark behind "optimizing token usage")
> "Delegation Control: Delegation is now disabled by default to give users explicit control."
> Knobs: "Max Requests Per Minute", "Max Iterations: Limit the maximum number of iterations for obtaining a final answer."

### 8c. Evaluating use cases — Crews vs Flows
URL: https://docs.crewai.com/en/guides/concepts/evaluating-use-cases
Complexity/precision matrix:
> "Low Complexity, Low Precision ... Recommended Approach: Simple Crews with minimal agents"
> "Low Complexity, High Precision ... Recommended Approach: Flows with direct LLM calls or simple Crews with structured outputs"
> "High Complexity, Low Precision ... Recommended Approach: Complex Crews with multiple specialized agents"
> "High Complexity, High Precision ... Recommended Approach: Flows orchestrating multiple Crews with validation steps"
Choose Crews when: "You need collaborative intelligence / The problem requires emergent thinking / The task is primarily creative or analytical / You value adaptability over strict structure / The output format can be somewhat flexible".
Choose Flows when: "You need precise control over execution / The application has complex state requirements / You need structured, predictable outputs / The workflow involves conditional logic / You need to combine AI with procedural code".

### 8d. Flows — token accounting footgun
URL: https://docs.crewai.com/en/concepts/flows
> "`flow.usage_metrics` is not the same as `flow.kickoff().token_usage`. The latter returns the `CrewOutput.token_usage` of the last `@listen` method that returned a `CrewOutput`, which means it only reflects the final Crew and ignores prior Crews and bare `LLM.call(...)` invocations entirely."

### 8e. README
URL: https://raw.githubusercontent.com/crewAIInc/crewAI/main/README.md
> "High Performance: Optimized for speed and minimal resource usage, enabling faster execution." — no benchmark supplied.

**CrewAI summary.** Ships crews (sequential / hierarchical with a manager LLM) and flows; the guidance is a qualitative complexity/precision matrix that steers high-precision work to Flows (code-driven) rather than more agents; delegation is off by default; no cost multiplier or quality delta published anywhere reached; the one hard caveat is that the default token accessor undercounts multi-crew flows.

---

## 9. Amazon — Strands Agents SDK and Kiro

### 9a. Strands Agents SDK — multi-agent patterns
Docs source: https://github.com/strands-agents/docs, `site/src/content/docs/user-guide/concepts/multi-agent/*.mdx` (the rendered strandsagents.com subpage URLs guessed in the brief 404; raw `.mdx` used instead). Patterns shipped: Agents-as-tools, Swarm, Graph, Workflow.

Comparison page (https://raw.githubusercontent.com/strands-agents/docs/main/site/src/content/docs/user-guide/concepts/multi-agent/multi-agent-patterns.mdx):
> "To be more explicit, the most difference you should consider among those patterns is how the path of execution is determined."
> Error handling row: Graph "Controllable. A developer can define explicit 'error' edges" / Swarm "Agent-driven... The system relies on timeouts and handoff limits to prevent indefinite loops." / Workflow "Systemic. A failure in one task will halt all downstream dependent tasks. The entire workflow will likely enter a `Failed` state."
> "When to Use Graph: When you need a structured process that requires conditional logic, branching, or loops with deterministic execution flow."
> "When to Use Swarm: When your problem can be broken down into sub-tasks that benefit from different specialized perspectives. A Swarm is ideal for exploration, brainstorming, or synthesizing information from multiple sources through collaborative handoffs."
> "When to Use Workflow: When you have a complex but repeatable process that you want to encapsulate into a single, reliable, and reusable tool."

Workflow page (.../workflow.mdx) — the one explicit "not for":
> "Consider other approaches (swarms, agent graphs) for simple tasks, highly collaborative problems, or situations requiring extensive agent-to-agent communication."

Swarm page (.../swarm.mdx) — bounded-runaway caveats:
> "Swarms include several safety mechanisms to prevent infinite loops and ensure reliable execution: 1. Step limits ... 2. Execution timeout ... 3. Node timeout ... 4. Repetitive handoff detection: Prevents agents from endlessly passing control back and forth"
> TypeScript: "If neither `maxSteps` nor `timeout` is set, the SDK emits a one-time warning at construction since a swarm with no bound can run indefinitely."
Python defaults: `max_handoffs=20`, `max_iterations=20`, `execution_timeout=900.0`, `node_timeout=300.0`.

Graph page (.../graph.mdx): custom nodes give "Performance optimization: Skip LLM calls for deterministic operations".

Published cost/quality numbers: none. AWS blog posts on Strands patterns could not be reached (search blocked) **[unverified]**.

### 9b. Kiro
Subagents (https://kiro.dev/docs/custom-agents/subagents.md, raw):
> "Sub-agents let you hand off focused tasks to agents that run in their own isolated context. The main agent spawns sub-agents when a task benefits from parallelism, specialized tools, or context isolation - then aggregates the results when they finish."
> "Sub-agents support directed acyclic graphs (DAGs) where tasks depend on each other. The main agent plans the full task graph upfront".
> "Task graphs are planned upfront and cannot be modified during execution."
> "Non-interactive sub-agents can't prompt for approvals. If `is_interactive` is false and a tool requires approval, the sub-agent fails fast."
The word "credit" does not appear on the subagents page (grep-confirmed by the researcher).

Specs parallel execution (https://kiro.dev/docs/specs.md):
> "Kiro builds a dependency graph of the tasks in your `tasks.md` and groups independent tasks into waves... Waves execute sequentially; tasks within a wave execute concurrently." / "For most feature specs, this cuts execution time significantly without any setup." (unquantified)

Pricing (https://kiro.dev/pricing/):
> "a given task that consumes X credits to execute in Auto, will cost you 1.3X credits to execute via Sonnet 4.6."
> "Any prompt you ask Kiro to execute, whether in vibe mode or spec mode, as well as spec refinement, task execution, and agent hook execution, will consume credits."
No rule for subagent or parallel fan-out cost is stated; the per-model multiplier is the only multiplier on the page.

Changelog (https://kiro.dev/changelog/), 2026-09-05 "Kiro Crew 0.6.0":
> "let crew members dispatch workers of their own." / "Subagents can run for three hours with `agent.subagent_timeout_secs` at 10800, and `agent.subagent_max_turns` supports up to 1000 tool calls."
No cost note accompanies these entries.

**Amazon summary.** Strands: four patterns, qualitative when-to-use, explicit runaway guards on Swarm, "Systemic" failure on Workflow; no numbers. Kiro: parallel subagents with upfront DAG planning and 3-hour / 1000-turn ceilings; pricing is silent on fan-out.

---

## 10. Sourcegraph Amp (incl. Thorsten Ball)

### 10a. "Agents for the Agent" (2025-06-10, launch of subagents) [verified-raw]
URL: https://ampcode.com/notes/agents-for-the-agent (also /agents-for-the-agent)
Why: "the agent can now spawn a subagent to fix the error. The subagent in turn will have a completely fresh context window and once it's done fixing the error, no matter how many attempts it took, only a tiny fraction of the main agents tokens (just enough to spawn the subagent and send a prompt along) have been used."
Prior failures admitted: "Over the past few months, we've also experimented with other types of subagents. Each type would have a different system prompt or a different set of tools, but they never turned out to be useful. Either their job was already covered by the search agent and it wasn't even clear to us humans when to use one subagent over the other, or, as was often the case, the model behind the main agent... simply didn't invoke them".
Uncertainty admitted: "We don't know and I bet no one knows." / "we still need to figure out how to best integrate them" (into the system prompt).
Observation: "Sonnet 4 really likes delegating work to subagents and invokes them whenever it can spot clearly defined tasks."

### 10b. Oracle [verified-raw]
URL: https://ampcode.com/news/oracle
> "o3 is slightly slower than the model behind Amp's main agent, Sonnet 4. It's also slightly more expensive and less suited for day-to-day agentic coding. But it is impressively good at reviewing, at debugging, at analyzing, at figuring out what to do next."
> "We consciously haven't pushed the oracle too hard in the system prompt, to avoid unnecessarily increasing costs for you or slowing you down. Instead, we rely on explicit prompting to get the main agent to consult the oracle."
GPT-5 oracle update (https://ampcode.com/news/gpt-5-oracle): oracle is "less proactive" and "less likely to jump over that last hurdle" than the main model. [WebFetch]

### 10c. Published subagent cost/speed numbers
- Librarian (https://ampcode.com/news/a-faster-librarian): "The Librarian is now ~3x faster and 43% cheaper, with the same quality." Average cost $1.21 -> $0.69 per search; ~5 turns instead of ~15. [WebFetch]
- Search subagent (https://ampcode.com/news/gemini-3-flash-search): "now uses Gemini 3 Flash instead of Haiku 4.5. It's 3x faster for the same quality." [WebFetch]
- Rush mode (https://ampcode.com/news/rush-mode) [verified-raw]: "Token-by-token, it's 67% cheaper and 50% faster than smart." but "It's less capable, which means that on complex tasks it often spends more tokens and time fixing its mistakes along the way." / "Don't rush complex tasks: new end-to-end features, bugs with no clear diagnosis, an architecture refactor. It'll be slower and not much cheaper, if it even arrives at a solution at all."

### 10d. Handoff vs compaction; agent-to-agent; agents panel
- https://ampcode.com/news/handoff: compaction "always had downsides. It's lossy, for one." / "Instead of summarizing a thread, you're extracting from it what matters for your next task." [WebFetch]
- https://ampcode.com/news/from-agent-to-agent: "You can now ask your agents in Amp to spawn other agents... They can send messages and files to each other, too." No caveats stated. [WebFetch]
- https://ampcode.com/news/agents-panel: "more time will be spent by humans in managing and orchestrating work across multiple agent threads." [WebFetch]
- https://ampcode.com/how-we-build-amp requires sign-in **[unverified]**; no Thorsten Ball essay specifically on subagents was located on registerspill.thorstenball.com **[unverified]**; his "How I use Amp" note does not mention subagents or the oracle at all (negative finding).

**Amp summary.** Subagents are cheap for the *parent* ("tiny fraction of the main agent's tokens"), specialized subagents are tuned per-model with published $/speed numbers, the oracle is deliberately under-prompted to save cost, and the team openly says earlier subagent types "never turned out to be useful".

---

## 11. OpenCode

URLs: https://opencode.ai/docs/agents/ , https://opencode.ai/docs/config/ , https://github.com/sst/opencode
> "Subagents are specialized assistants that primary agents can invoke for specific tasks." Invoked "Manually by @ mentioning a subagent" or via the Task tool (`permission.task`).
> Built-ins: general ("A general-purpose agent for researching complex questions and executing multi-step tasks. Has full tool access (except todo)") and explore ("A fast, read-only agent for exploring codebases. Cannot modify files.").
> "If you don't specify a model, primary agents use the model globally configured while subagents will use the model of the primary agent that invoked the subagent." — no automatic cheaper model for subagents.
> `subagent_depth` "control how deeply subagents can invoke other subagents", default 1 (subagents cannot spawn subagents), 0 disables.
No published cost multiplier, quality delta, or when-not-to-use prose. Zen pricing (https://opencode.ai/docs/zen/) is per-model and says nothing about subagents. CHANGELOG raw URL 404 **[unverified]**.

**OpenCode summary.** Ships subagents with a depth-1 default cap and no cost or quality guidance either way.

---

## 12. DeepSeek DSH (deepseek-harness) [verified-raw from master branch]

Repo: https://github.com/deepseek-ai/deepseek-harness (default branch `master`; "DeepSeek Harness: Everything is a Plugin.")

### 12a. packages/subagent
URL: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/subagent/README.md
> "Choose a fresh in-process child for isolated work, a history-seeded in-process child when prior conversation matters, or an out-of-process child backed by ACP, Codex, Claude Code, or another Harness runtime."
tool-subagent (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/subagent/tool-subagent/README.md):
> `maxDepth` default: "Host setting (`1`)" — "Absolute delegation-depth cap (`0` forbids delegation)".
> Model-facing guidance (continuable mode): "Use subagent in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. Set `run_in_background: false` only when your next action depends on that subagent's result."
> "Success contains only the child's final text... Intermediate child steps stay out of the parent."
> Known limitation: "Shipped fork tools cannot select a child LLM route — they inherit the parent's provider and model to keep the copied conversation prefix eligible for KV Cache reuse."
> Token-effect notes per feature: "Fixed schema cost per parent request"; "One short fixed section per continuable instance, paid on every parent request while the tool is in scope."

### 12b. packages/workflow
URL: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/README.md
> "The workflow group lets an agent run orchestration scripts that delegate work to subagents and return a final value. The `workflow` tool supports scripted fan-out; the opt-in `ralph` tool runs a fixed sequence of fresh agents."
tool-workflow (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-workflow/README.md) — the explicit "not for" line:
> "Use it only when the user explicitly asks for a workflow or for large multi-agent orchestration — an audit over many files, a migration, multi-angle research; for one or two delegations, prefer plain subagent calls."
> Model-facing guidance: "Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration... For one or two delegations, prefer plain subagent calls."
> "Substantial fixed schema cost on each request where the tool is visible."
> Known limitations: "The parent turn blocks until the whole workflow settles"; "cancellation discards partial output as an error"; "JSON beyond `maxResultChars` is truncated in the model-facing projection".
tool-ralph (https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/workflow/tool-ralph/README.md):
> "Use it only when the direct human explicitly requests Ralph-style fresh-agent iteration; use goal tools for ordinary long-running work and subagents or workflows for bounded delegation."
> "Completion is worker self-declaration — there is no independent evaluator or verifier deciding whether the objective is complete".
> "Only round count bounds aggregate effort — token, price, and elapsed-time budgets are deferred."
> "uncommitted conversational reasoning disappears with each child."

**DSH summary.** Ships subagents, scripted workflows and a ralph loop, but gates workflow and ralph behind "only when the user explicitly asks"; delegation depth 1 by default; no token/price budget on workflows yet (stated as deferred); no quality claims.

---

## 13. pi (earendil-works/pi, Mario Zechner) [verified-raw]

### 13a. What the docs say
URL: https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/README.md ("Philosophy")
> "No sub-agents. There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions, or install a package that does it your way."
> "No built-in to-dos. They confuse models."

Correction to the brief's premise: extensions CAN spawn subagents. The repo ships an example extension at `packages/coding-agent/examples/extensions/subagent/` (https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/examples/extensions/subagent/README.md): "Isolated context: Each subagent runs in a separate `pi` process", "Parallel streaming", "Usage tracking: Shows turns, tokens, cost, and context usage per agent", with scout/planner/reviewer/worker agents and chained presets. The extensions doc table lists `subagent/ | Spawn sub-agents | registerTool, exec`. What pi lacks is a *built-in* subagent tool, by design.

### 13b. Author's rationale — "What I learned building a minimal LLM coding agent" (2025-11-30)
URL: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
> "pi does not have a dedicated sub-agent tool. When Claude Code needs to do something complex, it often spawns a sub-agent to handle part of the task. You have zero visibility into what that sub-agent does. It's a black box within a black box. Context transfer between agents is also poor. The orchestrating agent decides what initial context to pass to the sub-agent, and you generally have little control over that. If the sub-agent makes a mistake, debugging is painful because you can't see the full conversation."
> "People use sub-agents within a session thinking they're saving context space, which is true. But that's the wrong way to think about sub-agents. Using a sub-agent mid-session for context gathering is a sign you didn't plan ahead. If you need to gather context, do that first in its own session. Create an artifact that you can later use in a fresh session".
> "despite popular belief, models are still poor at finding all the context needed for implementing a new feature or fixing a bug."
> "I'm not dismissing sub-agents entirely. There are valid use cases. My most common one is code review: I tell pi to spawn itself with a code review prompt".
> On plan mode: "In Claude Code, the orchestrating Claude instance usually spawns a sub-agent and you have zero visibility into what that sub-agent does."

### 13c. "Year in review 2025" (2025-12-22)
URL: https://mariozechner.at/posts/2025-12-22-year-in-review-2025/
> "Despite my best efforts, I could never get armies of agents to work for me at all, apart from maybe research tasks. Having them write large amounts of code has so far been a recipe for disaster for me."
> "I'd also like to point out that not a lot of army of agents people have actually published their work, whereas I try to open source as much of my shit as possible".
> "nobody knows yet how to do this properly."

### 13d. "Thoughts on slowing the fuck down" (2026-03-25)
URL: https://mariozechner.at/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/
> "You're building an orchestration layer to command an army of autonomous agents... Look, Anthropic built a C compiler with an agent swarm. It's kind of broken... Cursor built a browser with a battalion of agents. Yes, of course, it's not really working and it needed a human to spin the wheel a little bit every now and then."
> "at least among my circle of peers I have yet to find evidence that this kind of shit works. Maybe we all have skill issues."
> "With an orchestrated army of agents, there is no bottleneck, no human pain. These tiny little harmless booboos suddenly compound at a rate that's unsustainable. You have removed yourself from the loop".

**pi summary.** No built-in subagents by design; the author's objections are observability ("black box within a black box"), poor context transfer, and compounding-error rate at scale; endorsed use is a spawned reviewer and "maybe research tasks". No cost numbers (pi tracks cost per session, and the example extension tracks per-agent cost).

---

## Summary table

| Vendor | Ships orchestration? | Default recommendation | Published cost numbers | Named failure modes |
|---|---|---|---|---|
| OpenAI (guide, SDK) | Manager + handoff patterns | Single agent first; "evolving to multi-agent systems only when needed" | None | Instruction-following failure, tool overload; LLM orchestration less predictable in "speed, cost and performance" than code |
| OpenAI (Codex, Responses multi-agent beta) | Subagents on by default, non-proactive by default; beta API | Ask explicitly; "use parallel agents for read-heavy tasks"; "Prefer one agent when" steps depend on each other / shared mutable state | "consume more tokens" (no multiplier); default 3 concurrent | Write conflicts on shared filesystem, coordination overhead, tasks "dominated by one slow external operation" |
| Google ADK | Sequential/Parallel/Loop (now "superseded" by graph workflows), LLM transfer, RoutedAgent (experimental) | No hard rule; move when a single agent shows instruction-following or context limits | None | Race conditions in shared state, non-deterministic result order, infinite loops, root agent "out of the loop" after transfer |
| Google Gemini CLI | Single-level subagents | Delegate large/multi-step work to generalist; recursion forbidden | None | Parallel subagent collaboration "blocked"; open P2 slow-start bug |
| Google Jules | Parallel tasks | Marketing only | Quotas: 3/15/60 concurrent, 15/100/300 daily | None documented |
| Anthropic Claude Code | Subagents (stable), agent teams (experimental), workflows (GA) | "check whether a lighter option does the job"; subagents for verbose/self-contained work; single session for sequential/same-file/many-dependency work | Agent teams "approximately 7x" (plan mode), "significantly more"; workflows "meaningfully more", advisory warning at 25 agents / 1.5M tokens; subagents return "1,000-2,000 tokens" from "tens of thousands" | Task status lag, no nested teams, fresh-context latency, reviewer over-reporting, Opus 5 "delegates more readily" |
| Cognition | Managed Devins, dynamic workflows, Devin Review | Single-threaded writes; extra agents "contribute intelligence rather than actions"; fan-out only for ~5+ independent units | "far more ACUs" (no number); Review "2 bugs per PR, ~58% severe" | Inconsistent parallel writers, dispersed decision-making, weak primary model can't escalate, Cascade edit races |
| Cursor | Subagents, Cloud Agents, Projects coordinator | Main agent for quick tasks; skills for simple single-purpose tasks | "five subagents... roughly five times the tokens"; API pricing for cloud agents | Slower on simple tasks (fresh start); Projects post names none |
| Microsoft | Sequential/Concurrent/Handoff/Group Chat/Magentic workflows | "If you can write a function... do that instead"; agent before workflow; Group Chat before Magentic | Magentic-One: "several US dollars, and tens of minutes per task" | Magentic "untested" outside origin; repeated failed actions, insufficient verification, prompt injection; AutoGen in maintenance mode |
| LangChain | Supervisor/swarm/handoff/subagents/Deep Agents | "a single agent... can often achieve similar results"; avoid subagents "when the overhead outweighs benefits" | Benchmark: single agent uses more tokens as distractors grow (best-case caveat); cites Anthropic "15x" | Abstractions "obfuscate" context; swarm leaks histories; supervisor library self-deprecated |
| CrewAI | Crews (sequential / hierarchical manager LLM), Flows | Matrix: high-precision work goes to Flows (code), not more agents; delegation off by default | None ("optimizing token usage" unquantified) | `token_usage` undercounts multi-crew flows; manager LLM required |
| Amazon Strands | Agents-as-tools, Swarm, Graph, Workflow | Pick by "how the path of execution is determined"; Workflow not for "simple tasks, highly collaborative problems" | None (only Swarm safety defaults: 20 handoffs / 20 iterations / 15 min) | Unbounded swarm "can run indefinitely"; Workflow failure is "Systemic" |
| Amazon Kiro | Parallel subagents with upfront DAG, spec waves, Crew | Delegate when "parallelism, specialized tools, or context isolation" help | Per-model 1.3X only; nothing for fan-out | DAG "cannot be modified during execution"; non-interactive subagents "fail fast" on approvals |
| Sourcegraph Amp | Subagents, oracle, librarian, agent-to-agent, custom agents | Explicit prompting for oracle (cost); rush mode only for small well-defined tasks | Librarian "43% cheaper", rush "67% cheaper and 50% faster" but slower on complex tasks | Earlier subagent types "never turned out to be useful"; oracle "more expensive", "less proactive"; compaction "lossy"; human orchestration overhead |
| OpenCode | Subagents (Task tool, @mention), depth 1 default | None stated | None | None stated |
| DeepSeek DSH | Subagents, scripted workflow, ralph loop | Workflow/ralph "only when the user explicitly asks"; "for one or two delegations, prefer plain subagent calls"; depth 1 default | None; token/price budgets "deferred" | Parent blocks; partial output discarded; ralph completion is "worker self-declaration" |
| pi | No built-in; example extension only | Plan context in its own session; spawn a reviewer; "maybe research tasks" | None | "black box within a black box", poor context transfer, compounding errors with no human bottleneck |

## Where vendors disagree with each other

1. **Whether subagents cost more or less.** Anthropic, Amp and Cursor position *subagents* as a way to spend fewer tokens in the parent (results "summarized back", "tiny fraction of the main agent's tokens"), while Cursor simultaneously says five parallel subagents cost "roughly five times" overall and OpenAI says subagent workflows "consume more tokens than comparable single-agent runs". These are compatible only if you separate parent-context cost from total spend; no vendor states both sides in one place except Cursor.
2. **Whether multi-agent is cheaper in any setting.** LangChain's benchmark is the only vendor result where multi-agent used fewer tokens than a single agent (as distractor tools grow), and they flag it as best-case. Every coding-agent vendor says the opposite.
3. **Proactive vs explicit delegation.** Codex's shipped default and DSH's workflow/ralph tools require an explicit user request; Amp's oracle is deliberately under-prompted; Anthropic notes Opus 5 "delegates to subagents more readily" and gives spend caps instead of turning it off; OpenAI Ultra and Codex's proactive prompt encourage delegation "if it could save time or improve quality".
4. **Parallel writers.** Cognition (2026) and OpenAI say writes should stay single-threaded or file-isolated; Anthropic agent teams and Cursor Projects ship parallel writers with coordination via shared task lists / a coordinator, with Anthropic warning against "same-file edits" and Cursor's Projects post saying nothing about conflicts.
5. **How much to trust the pattern at all.** Microsoft calls Magentic "untested" outside its paper and put AutoGen in maintenance; LangChain retired its supervisor library in favor of raw tool calls; Cognition narrowed its stance to "intelligence, not actions"; pi's author reports being unable to make "armies of agents" work outside research. Against that, Cursor markets "thousands of subagents" and Anthropic ships workflows GA with a 1,000-agent cap.
6. **Observability as a first-order objection.** Only pi (and, in passing, Amp's agents-panel note about human orchestration overhead) treats the inability to watch a subagent as a reason not to use one; other vendors treat isolation as the feature.
7. **Numbers.** Only Anthropic ("approximately 7x", 25 agents / 1.5M tokens), Cursor ("five times"), Amp (43% / 67%) and Microsoft's paper ("several US dollars") publish any figure; Google, Cognition, OpenAI, CrewAI, Strands, Kiro, OpenCode and DSH publish none. The two non-Anthropic numbers that are about orchestration itself (Cursor's "five times", Magentic-One's "several US dollars") are order-of-magnitude statements, not measurements with a method.
8. **Code-driven vs LLM-driven control.** OpenAI ("orchestrating via code makes tasks more deterministic and predictable, in terms of speed, cost and performance"), Google ADK (template workflows are "deterministic and predictable"), Microsoft ("If you can write a function... do that instead"), CrewAI (Flows for high precision), Cognition (dynamic workflows are "a deterministic Python script") and DSH (model-written scripts) converge on scripts for the control flow; Anthropic agent teams, Cursor Projects' coordinator, Strands Swarm and LangChain swarm/handoffs let the model decide. Anthropic's own docs put Workflows ("The script" decides) above agent teams ("The lead agent, turn by turn") on scale.
