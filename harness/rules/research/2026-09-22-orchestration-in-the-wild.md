---
question: "How do people actually run coding agents in practice - independent sessions, orchestrator+subagents, scripted workflows, or loops - and what do they report about cost and quality?"
date: 2026-09-22
verdict: "Independent parallel sessions in worktrees are the dominant real-world pattern (the human is the orchestrator, git is the message bus); subagents are common but should stay read-only fan-out, never parallel writes; loops suit unattended small-scope work with hard stops; scripted workflows are niche, best used for CI-like review/audit/triage fan-out; orchestration should never be the default entry point for ordinary tasks, and every vendor guardrail change since launch has moved concurrency defaults down, not up."
unverified:
  - "Whether Conductor.build follows the same independent-worktree model as its peers - its code is closed-source and could not be read"
  - "Whether Gas Town's development moved to a private fork after its main branch went quiet in mid-2026"
  - "Whether one-shot Workflow-tool adopters (12 of 30 sampled repos) simply wrote once and it worked, or abandoned it - the data is consistent with either reading"
  - "Codex's read-heavy vs write-heavy subagent guidance was paraphrased via the fetch tool, not hand-verified against raw HTML"
  - "Steve Yegge's often-cited claims that Gas Town is extremely token-hungry - the Medium source pages returned 403 to the fetch tool"
  - "GitHub issues #82101, #87815, #92090, #84223 were subagent-extracted and not independently re-verified"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Orchestration in the wild — how people actually run coding agents (observed, 2026-09-22)

Method: authenticated `gh` (repo/issue/code search, REST contents API), Claude Code CHANGELOG, WebFetch of READMEs and a handful of vendor/practitioner pages. Star counts and push dates are as of 2026-09-22. Verbatim quotes are in quotation marks with a URL; everything I infer is marked [unverified]. GitHub code-search `total_count` figures are file counts (not repo counts) and are GitHub's approximate index, so treat them as orders of magnitude.

The four patterns used below:

- **(a) many independent parallel sessions** — worktrees / tmux / dashboards; sessions do not talk to each other
- **(b) orchestrator agent spawning subagents inside one session** — Agent tool, agent teams, Codex/OpenCode subagents
- **(c) scripted multi-agent workflows** — Claude Code Workflow tool `.claude/workflows/*.js`, LangGraph/CrewAI/AutoGen graphs, custom runners
- **(d) plain single session + loops** — Ralph-style `while true`, cron, `/loop`

---

## 1. Pattern (a): independent parallel sessions — the tooling with the most users

### What exists and how alive it is

| Tool | Stars | Last push | Orchestrated? | Notes |
|---|---|---|---|---|
| openai/symphony | 27,340 | 2026-09-15 (3 commits in Sept) | No — one autonomous run per issue | "Symphony turns project work into isolated, autonomous implementation runs, allowing teams to manage work instead of supervising coding agents." (README) |
| BloopAI/vibe-kanban | 28,158 | 2026-09-19 | No — "each workspace gives an agent a branch, a terminal, and a dev server" | **Sunsetting.** README banner: "Vibe Kanban is sunsetting." Shutdown post (2026-04-10): "the vast majority are free users and we couldn't find a business model that we could get excited about"; "Thousands of software engineers use Vibe Kanban every day". https://www.vibekanban.com/blog/shutdown |
| superset-sh/superset | 14,464 | 2026-09-22 (100+ commits in Sept) | No — "Compare the results and merge the winner" | "Run 100+ coding agents at once, each in its own git worktree with its own branch, terminal, and environment." |
| smtg-ai/claude-squad | 8,512 | 2026-08-20 | No — tmux + worktree per task | "Each task gets its own isolated git workspace, so no conflicts." Maintenance-only cadence (3 commits since June: version bumps + fixes). |
| generalaction/emdash (YC W26) | 5,796 | 2026-09-21 | No | "Run multiple coding agents at once without juggling terminals. Keep every agent isolated in its own Git worktree and branch." |
| stravu/crystal → nimbalyst/nimbalyst | 3,118 / 1,753 | 2026-02-26 / 2026-09-21 | No | Crystal was renamed to Nimbalyst; "Run several coding agents at once, each isolated in its own git worktree." |
| coder/xum (ex-mux) | 2,033 | 2026-09-22 | No | Has a cost panel: "Stay looped in on costs and token consumption". Renamed after a trademark complaint. |
| juliensimon/canopy | 110 | 2026-08-23 | No (passive collision detection) | "Token usage is the one thing Claude Code doesn't surface well. Canopy fixes that." |
| Long tail: romp, para, tmux-ccm (16 stars), muxara, plural, claude-sessions-status, jumpmux, agentctl, codecadet … | 0–25 each | mostly 2026 | No | `gh search repos "parallel claude code sessions"` returns 15+ near-identical "worktree + tmux + status" tools, all tiny. |

Conductor (conductor.build) is closed-source; I could not read its code. [unverified: it follows the same independent-worktree model as the above.]

### What users of (a) say about cost/quality

- The dominant complaint in the biggest Claude Code threads is quota, not quality, and parallel sessions are named as the multiplier. #38335 (873 comments, open): "Running ~10 agents via Claude Code CLI on a Mac Mini. Rate limit errors started appearing randomly across agents since March 23" — and, notably, "Confirmed it's not related to number of parallel sessions". Another: "With the $100 max plan I blew through the 5-hour limit in around 30 minutes with a standard workload. A few weeks ago … I could concurrently run multiple autonomous agents and STILL have headroom". https://github.com/anthropics/claude-code/issues/38335
- Controlled measurement in the same thread (Max 5x, Opus 4.6, 1M ctx): "7 exchanges including a subagent (39.5k tokens, 19 tool calls) and 5 parallel main-thread tool calls — Total usage: 7% over ~20 minutes — Subagent alone cost ~2%."
- A heavy automation user in #38335: "~57 headless Claude Code sessions per day via LaunchAgents" — pattern (d)/(a) hybrid, running on a subscription.
- Coordination pain of (a) is real and users solve it with files, not orchestration. #24798 "Inter-session communication for multi-Claude workflows" (22 👍, 80 comments): "Today I'm running 5 concurrent Claude sessions … There is no way for the migration session to notify the others. I have to manually relay information between sessions — copy-pasting context, writing handoff documents to disk". Current workarounds listed as "all terrible": "File-based handoffs", "Health monitor scripts", "User as message bus". A physician replies: "I routinely run 4 parallel sessions". https://github.com/anthropics/claude-code/issues/24798
- Cursor's scaling post (independent agents at the extreme): "Twenty agents would slow down to the effective throughput of two or three, with most time spent waiting" (locking), and "agents became risk-averse. They avoided difficult tasks and made small, safe changes instead." https://cursor.com/blog/scaling-agents

**Read:** (a) is the mainstream. Even the tools that call themselves "orchestrators" (Symphony, Superset, Vibe Kanban, Squad, emdash, xum, Nimbalyst) do not make agents talk to each other; they isolate, run, and let a human review. The single biggest one by users (Vibe Kanban) could not monetize.

---

## 2. Pattern (b): orchestrator + subagents inside one session

### Adoption proxies (GitHub code search, file counts)

| Artifact | Files indexed | Meaning |
|---|---|---|
| `.claude/skills/**/*.md` | ~1,013,760 | skills (single-session, no fan-out) |
| `.agents/skills/**/*.md` | ~770,048 | Codex/portable skills |
| `.claude/agents/*.md` | ~239,104 | custom subagent definitions → pattern (b) |
| `.claude/commands/*.md` | ~222,208 | slash commands |
| `"teammateMode"` | ~10,576 | agent-teams config |
| `.claude/workflows/*.js` | ~3,872 (483 unique files / 351 repos in the first 500 hits) | Workflow tool scripts → pattern (c) |
| `"while true" "claude -p"` | ~5,312 | shell loops → pattern (d) |
| `filename:ralph.sh` | ~1,584 | Ralph loops → pattern (d) |

Subagent definitions are ~60x more common than workflow scripts; skills are ~4x more common than subagent definitions.

### Vendor numbers (the only hard multipliers that exist)

- Anthropic, multi-agent research system: "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens as chats." Also: "token usage by itself explains 80% of the variance" in quality, and Opus-lead + Sonnet-subagents "outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval." https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code costs doc: "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan mode, because each teammate maintains its own context window and runs as a separate Claude instance." Baseline: "average cost is around $13 per developer per active day and $150-250 per developer per month". https://code.claude.com/docs/en/costs
- Claude Code CHANGELOG 2.1.32: "Added research preview agent teams feature for multi-agent collaboration (token-intensive feature, requires setting CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)".
- Codex subagents doc: `agents.max_concurrent_threads_per_session` — "Cap concurrently open spawned-agent threads"; guidance [unverified paraphrase via fetch tool]: use for "parallel, read-heavy tasks like exploration, testing, log analysis, and summarization"; avoid "parallel write-heavy workflows".

### Complaints with numbers (anthropics/claude-code)

- **#68110** "General-purpose sub-agents recursively spawn unbounded child agents, causing exponential fan-out and massive token burn" (open, 12 👍): "a single Agent call for 'research Venmo integration options' resulted in 48+ background agents … ~1.5M+ tokens consumed … The useful research was complete within the first 3-4 agents; the remaining 44 added no new information." Root cause traced by a commenter to CHANGELOG 2.1.172: "Sub-agents can now spawn their own sub-agents (up to 5 levels deep)". Other commenters: "1718 background agents were stopped by the user"; "it spawned 905 agents. Each made 2k+ calls for websearch, etc. Used up my 5hr max limit in 2 mins + 87$ in another minute i literally unplugged the pc". https://github.com/anthropics/claude-code/issues/68110
- **#90544** (open): subagent report "truncated at roughly 2,500 characters" when flagged as instruction-shaped; re-asking "resumes the subagent on its full transcript, so every re-ask is a full re-run … One ~1,500-word report took three Opus 5 runs to arrive; the user paid roughly 3x for the same content." https://github.com/anthropics/claude-code/issues/90544
- **#80988** (open, **71 👍**, 37 comments) — the vendor itself throttling (b): Claude Code 2.1.219 injects for Opus 5 "Do not call the AgentTool unless the user requested it / Do not use workflows or deep-research unless the user requested it", "enabled by model capability, not by user configuration". Users complain because it overrides their CLAUDE.md delegation rules. https://github.com/anthropics/claude-code/issues/80988 (same in #82371)
- Agent teams bug surface (all closed): #64550 lead "routes AS the teammate", #63684 "unbounded team-lead inbox stalls … at ~1MB / 1000+ msgs", #69808 teammate never exits. Feature requests for teams are almost all about split-pane backends (Ghostty/WezTerm/Windows Terminal/zellij, 3–17 comments each) — i.e. the UI, not the coordination.
- Praise exists but is thin and unquantified: #64348 "I was working in the Workflow Dynamics and I love it. It's kind of like Agent SDK." (5 👍, auto-closed for inactivity).

### Critique from practitioners

- Cognition, "Don't build multi-agents": "Subagent 1 and subagent 2 cannot not see what the other was doing and so their work ends up being inconsistent with each other." https://cognition.ai/blog/dont-build-multi-agents
- 12-factor agents, Factor 10: "As context grows, LLMs are more likely to get lost or lose focus"; recommends agents of "3-10 steps, potentially up to 20 maximum."

**Read:** (b) is widely *configured* (240k agent files) and is the second most common pattern, but the loud data points are cost blow-ups, and Anthropic's own default prompt for its top model now says don't delegate unless asked. The Anthropic 90.2% quality gain is for *research*, not code edits; the Codex docs explicitly steer subagents to read-only work.

---

## 3. Pattern (c): scripted multi-agent workflows

### 3a. Claude Code Workflow tool (`.claude/workflows/*.js`)

Timeline from CHANGELOG.md (https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md):

| Version | Change |
|---|---|
| 2.1.154 (late May 2026) | "Introducing dynamic workflows: … orchestrates work across tens to hundreds of agents in the background" |
| 2.1.172 | "Sub-agents can now spawn their own sub-agents (up to 5 levels deep)" → #68110 |
| 2.1.202 | "Dynamic workflow size" setting — "an advisory guideline, not an enforced cap" |
| 2.1.219 | default "medium size guideline (aim for fewer than 15 agents)"; `heron_brook` "Do not use workflows … unless the user requested it" for Opus 5 |
| 2.1.248 | Workflow tool description shrunk "about 1k tokens instead of 5.7k" |
| 2.1.269 | `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1–256) |
| 2.1.271 (Sept) | "Changed the default dynamic workflow size to small on Pro plans and lowered the medium size guideline from 15 to 10 agents"; workflows now "pause when you hit your usage limit" |

Docs limits: "Up to 16 concurrent agents by default … 1,000 agents total per run"; "When a workflow schedules more than 25 agents, or its projected token total passes 1.5 million, its progress line … shows a `Large workflow` warning." https://code.claude.com/docs/en/workflows

Every guardrail change since launch has moved the defaults *down*. That is the vendor's revealed opinion of what happened in the field.

**Adoption in public repos.** GitHub code search `path:.claude/workflows language:JavaScript` → ~3,872 files (approx.); the first 500 hits resolve to 483 unique files in 351 repos. Sample of 39 of those repos: median 1 star (max 1,035 = forcedotcom/salesforcedx-vscode; next 111, 74, 35, 32, 24, 24); 27/39 pushed within 30 days. Of 30 repos checked for commit history touching `.claude/workflows/`: **12 touched it exactly once, 8 touched it on ≤2 days, and 6 maintain it over months** (salesforcedx-vscode 23 commits Jun–Sep; kamiazya/whiteboard 28 commits, 11 workflow files; piconic-ai/barefootjs 15; s977043/my-blog 11; bagumamartin/futo-notes 11; Hal0ai/hal0 7). So roughly 1 in 5 adopters keeps iterating; the rest wrote one and stopped. [unverified: whether "wrote once" means "works fine" or "abandoned" — both are consistent with the data.]

**Shape in the wild.** Files are named `code-review.js`, `review-pr.js`, `fix-issue.js`, `bugfix.js`, `security-audit.mjs`, `feature-fanout.js`, `qa-run.js`, `audit.js`, `dependabot-triage.workflow.mjs`, `ci-triage.workflow.mjs` — i.e. review/triage/audit fan-outs, not feature implementation. The one corporate example is Salesforce:

> "Workflow scripts for Workflow tool orchestration. Each `.js` file is a self-contained, multi-agent pipeline that fans out subagents per phase and returns a structured result. ## Note This code is a mess. Claude requires this live in 1 file (no imports, no TS, no effect)" — https://github.com/forcedotcom/salesforcedx-vscode/blob/develop/.claude/workflows/README.md (auto-build-wi.js is 83 KB; paired with "`/loop 10m /auto-build-wi`" — pattern (c) driven by pattern (d)).

**Reported cost/quality, with numbers:**

- #81018 (open): claude-security plugin workflow, "medium effort", 208 files: "95 agents spawned over 2.5 hours … Token cost: ~$12–15 (147k output tokens + ~2.3M cache-read tokens) for an incomplete result." Also: "Our project CLAUDE.md explicitly restricts parallel agents to 4. The claude-security:scan workflow ignored this entirely". Maintainer (bcherny): "The verifier fan-out is intended, not a missing cap … There is no wall-clock timeout for a whole run — that part is accurate." https://github.com/anthropics/claude-code/issues/81018
- #78019 (open): "a workflow fanned out to ~32 subagents with no cost stated to me beforehand" after an undocumented `skipWorkflowUsageWarning` was found in settings — "An agent can therefore disable the warning that exists to protect users from agents." https://github.com/anthropics/claude-code/issues/78019
- #92631 (open): "Ultracode overrides the workflow size guideline — no effective agent ceiling, 50+ agents on trivial tasks"; quotes the built-in skill: "token cost is not a constraint". https://github.com/anthropics/claude-code/issues/92631
- #95895 (open, 2026-09-21): hidden reminders every N turns "Ultracode is still on — use the Workflow tool"; "reminders per session jumped from 1 (2.1.228, Aug 23) to 11-48 (from Sep 4-9); agents began launching multi-agent workflows for trivial actions (re-running an existing script, a single check, a question)." https://github.com/anthropics/claude-code/issues/95895
- #70250, #63725, #64524, #65971: the word "workflow"/"ultracode" in ordinary text triggers a workflow ("System reminder causes Claude to create a workflow for a one-line bugfix"). Opt-out: `"workflowKeywordTriggerEnabled": false`.
- #94907 (open): "System tools" schemas (Workflow/Artifact/DesignSync/Cron/worktrees) "consuming 52.4k of 200k tokens (26.2%) before any actual work began" in a session that used none of them.
- #66032 — explicit abandonment: "The lack of plugin support means we've had to move away from using dynamic workflows entirely, and instead using script approaches that bundle in plugin scripts - Using scripts with `claude-agent-sdk` … and now looking at other libs entirely like langgraph." (Anthropic later shipped plugin-bundled workflows.) https://github.com/anthropics/claude-code/issues/66032
- Bugs specific to scripted runs: #86156 "`args` never reaches the script sandbox"; #91005 same-named local script silently shadowed by built-in; #93797 SendMessage to a live workflow agent "resumes a second copy"; #92546/#94440 script rejected for CRLF / "control characters".
- Positive with no numbers: #64348 "I love it"; #66032's author calls workflows "among the most powerful automation primitives in Claude Code".

### 3b. LangGraph / CrewAI / AutoGen / MetaGPT-style graphs for coding

| Repo | Stars | Last push | Status |
|---|---|---|---|
| microsoft/autogen | 61,100 | 2026-04-15 | **"AutoGen is now in maintenance mode. It will not receive new features"** (README); successor is Microsoft Agent Framework |
| FoundationAgents/MetaGPT | 70,545 | 2026-01-21 | 1 commit in 2026 — dormant |
| OpenBMB/ChatDev | 34,358 | 2026-07-24 | active |
| crewAIInc/crewAI | 58,880 | 2026-09-22 | active (general agents, not coding-specific) |
| langchain-ai/langgraph | 42,102 | 2026-09-21 | active; langchain-ai/deepagents (29,629) is their "batteries-included agent harness" — one agent with subagents, i.e. pattern (b), not a graph |
| ruvnet/ruflo (ex claude-flow) | 73,011 | 2026-09-21 | Issue #1514 "Ruflo is 99% Theater, 1% Real — An Independent Audit": "~290 out of 300+ MCP tools are stubs … `agent_spawn` … Writes `{ status: "idle" }` to a Map" (closed by maintainer). https://github.com/ruvnet/ruflo/issues/1514 |
| Single-agent coding harnesses for contrast: OpenHands 88,758 (pushed today), SWE-agent 20,384 (pushed yesterday), aider 49,106 (2026-05-22) | | | the SWE-bench lineage stayed single-agent |

`gh search repos --archived` for "crewai coding", "langgraph coding agent", "multi-agent software development" returned nothing notable — abandonment shows up as dormancy (MetaGPT) and maintenance mode (AutoGen), not archiving.

**Read:** (c) is niche. The Workflow tool has real adopters (3.9k files, one Fortune-500 repo running it on a `/loop`), but the documented outcomes are cost incidents, the vendor keeps lowering defaults, and one team publicly moved off it. The older "AI software company" graph frameworks are dormant or in maintenance mode; the coding harnesses that survived (OpenHands, SWE-agent, aider, Codex, Claude Code, pi) are single-agent cores with optional subagents.

---

## 4. Pattern (d): single session + loops (Ralph, cron, `/loop`)

| Repo | Stars | Last push | Notes |
|---|---|---|---|
| snarktank/ralph | 21,837 | 2026-02-02 | "Ralph is an autonomous AI agent loop that runs repeatedly until all PRD items are complete." Fresh context per iteration; memory via git + `progress.txt` + `prd.json`; default 10 iterations. No commits since Feb — the pattern is done, not the tool [unverified]. |
| mikeyobrien/ralph-orchestrator | 3,152 | 2026-09-10 | 3 commits since Aug; hats/personas hand off sequentially — drifted toward (b). |
| michaelshimeles/ralphy | 2,973 | 2026-02-05 | `--max-parallel N` "default 3 agents", `--max-iterations N`; parallel mode = worktree per agent → (a). |
| Th0rgal/open-ralph-wiggum | 1,892 | 2026-06-02 | `--max-iterations`, multi-CLI (Claude, Codex, Copilot, Cursor, Qwen, OpenCode). |
| vercel-labs/ralph-loop-agent | 837 | 2026-09-16 | The only README with explicit cost stops: `costIs(5.00)`, `tokenCountIs(100_000)`, `iterationCountIs(50)`. "experimental". |
| tzachbon/smart-ralph | 549 | 2026-09-16 | Ralph + 7-agent spec pipeline — (d) mutating into (b)/(c). |
| anthropics/claude-plugins-official `ralph-loop` | — | — | Anthropic ships a Ralph plugin; coleam00/ralph-loop-quickstart (159★) is titled "NOT using the Anthropic plugin". |
| Code search `"while true" "claude -p"` | ~5,312 files | | plain shell loops are more common than any Ralph repo's forks |

Original source, ghuntley.com/ralph: "Cost of a $50k USD contract, delivered, MVP, tested + reviewed with @ampcode. $297 USD." Failure modes: "you'll wake up to a broken codebase that doesn't compile from time to time"; "Claude has the inherent bias to do minimal and placeholder implementations"; "There's no way in heck would I use Ralph in an existing code base"; "The more you use the context window, the worse the outcomes you'll get." snarktank/ralph README: "Each PRD item should be small enough to complete in one context window … Ralph only works if there are feedback loops".

**Read:** (d) is cheap, popular, and has the only concrete "$X for outcome Y" number in the whole corpus — but it is self-limited to greenfield/small stories, and its successful derivatives drift into (a) (parallel worktrees) or (b) (role handoffs).

---

## 5. Other CLIs: Codex, OpenCode, Gemini CLI, pi — what maintainers say

Collected from each repo's issues (`gh search issues … --sort reactions`, `gh issue view` with `authorAssociation`).

**openai/codex (125.8k★)** — subagents shipped (`MultiAgentV2`, `spawn_agent`, experimental).
- Maintainer etraut-openai closing #2604 "Subagent Support" (103 comments): "we have pretty robust support in place now for subagents. It's still experimental, but it's getting broad use." https://github.com/openai/codex/issues/2604#issuecomment-3947685168
- On cost, same maintainer in #9748: "you should assume that even in its final form, it will consume tokens much faster than a single agent. The consumption rate should scale roughly linearly with the number of concurrent agents." https://github.com/openai/codex/issues/9748#issuecomment-3788710475 — and, after users reported draining a 5-hour Pro quota in under a minute with 6–12 agents: "The bug that caused instant draining of usage quota has been fixed on the server." The team also pulled the feature back: "Version 0.91.0 removes the 'Multi-agents' feature from the '/experimental' menu. We got ahead of ourselves by adding it there." https://github.com/openai/codex/issues/9748#issuecomment-3797394551
- #12488 "Sub-agent costs are too high and too opaque": "Subagent token usage are not charged differently … If you use the same model for subagents, the increase should scale linearly… you may be able to use a smaller (and therefore cheaper) model for your subagents."
- #38989 (open) runaway report [unverified, user-reported]: "75 total execution threads (1 root + 74 subagents) … maximum nesting depth 3, 5,389,446,245 total recorded tokens, 4,977,729,875 tokens from subagents alone … One review subtree alone expanded to 39 agents". Cross-linked to #38237, #38375, #38519, #37748 — the same amplification shape as Claude Code #68110. https://github.com/openai/codex/issues/38989
- #8570 "Use git worktrees to achieve parallel agents" (closed) — Codex went the worktree route natively, and Symphony (OpenAI's own orchestration) is one run per issue, not agents talking to each other.

**anomalyco/opencode (209.2k★, ex sst/opencode)** — `Task` tool with `subagent_type` shipped; Claude-style "Agent Teams" not shipped.
- #12661 "Add Agent Teams Equivalent or Better" (36 comments): zero maintainer comments in six months; stale-closed 2026-08-07.
- Cost invisibility is the live complaint. #45417 "Session cost excludes subagent cost" (open): "Subagents were 42% of the session's real cost — none of it visible in the sidebar, `opencode stats`, or `/export`." and "the built-in sidebar showed $1.21 spent while its 81 child sessions had spent $6.41 on top of that, so roughly 84% of the real cost was invisible." https://github.com/anomalyco/opencode/issues/45417 — no maintainer reply found.

**google-gemini/gemini-cli (107.1k★)** — parent→child SubAgent primitive only; core RFC #3132 "[Agents] Post V1.0 Work" still open and bot-triaged as "a nice-to-have feature (P3)". #19430 "Parallel Agent Teams / Multi-Agent Collaboration (like Claude Code Agent Teams)": zero maintainer engagement, stale warning 2026-09-19; every reply is a community member promoting their own tmux-orchestrator side project. `"subagent tokens"` search: zero results (feature too small to complain about).

**earendil-works/pi (108.2k★, ex badlogic/pi-mono)** — deliberately no built-in subagent layer.
- badlogic on #552 (RFC to make subagent execution a library): "I'm reluctant to add a subagent abstraction to pi itself. This could easily be a library outside of pi, maintained by folks who have a vested interest in subagent orchestration, workflows and so on." and "The existing functionality serves more as an example and is not meant to be the canonical implementation." https://github.com/earendil-works/pi/issues/552
- On `agent.fork()` for cheap handoff/summarizer subagents (#2050): "too hard at the moment."
- Lowest issue volume on the topic of the four CLIs.

**Read across the four:** two vendors shipped subagents and immediately hit runaway-cost incidents (Codex pulled the menu entry; Anthropic lowered defaults and injected "don't delegate unless asked"); one (OpenCode) shipped and cannot even show the cost; one (Gemini) deprioritized it to P3; one (pi) refuses on principle. Nobody among them is building agents-talk-to-each-other orchestration into the core; the worktree/per-issue-run model (Codex worktrees, Symphony, Claude Code `--worktree`/EnterWorktree) is where all four invested instead.

---

## 6. Summary table

| Name | Stars | Pattern | Orchestrated or independent | Cost remarks |
|---|---|---|---|---|
| openai/symphony | 27.3k | a (+d: run per issue) | independent | none in README |
| BloopAI/vibe-kanban | 28.2k | a | independent | none; **sunsetting** (no business model) |
| superset-sh/superset | 14.5k | a | independent | "100+ agents", no cost text |
| smtg-ai/claude-squad | 8.5k | a | independent (tmux+worktree) | none; maintenance cadence |
| generalaction/emdash | 5.8k | a | independent | none |
| coder/xum | 2.0k | a | independent | has cost/token panel |
| nimbalyst (ex-crystal) | 1.8k / 3.1k | a | independent | none |
| juliensimon/canopy | 110 | a | independent | token dashboard is the selling point |
| gastownhall/gastown | 18.1k | b/c (Mayor + convoys + mailboxes) | **orchestrated** | "Scale comfortably to 20-30 agents"; scheduler "to prevent API rate limit exhaustion"; **0 commits on main since 2026-07-23** |
| ruvnet/ruflo | 73.0k | b/c ("queen-led swarm") | orchestrated (claimed) | audit: ~290/300 tools are stubs |
| mtarcure/claude-vibe-squad | 161 | b | orchestrated (coordinator + 71 specialists, worktree each) | "Cost implications remain undisclosed" |
| Claude Code Agent tool / `.claude/agents` | ~239k files | b | orchestrated | 4x/15x (Anthropic); 48–905 agents runaway (#68110); 3x re-run (#90544) |
| Claude Code agent teams (`teammateMode`) | ~10.6k files | b | orchestrated | "approximately 7x more tokens"; "token-intensive feature" |
| Claude Code Workflow tool `.claude/workflows/*.js` | ~3.9k files / ~351+ repos | c | orchestrated (script) | 95 agents/2.5h/$12–15 incomplete (#81018); 32 agents no warning (#78019); 50+ agents trivial task (#92631); defaults lowered 3 times |
| forcedotcom/salesforcedx-vscode workflows | 1,035 (repo) | c driven by d (`/loop 10m`) | orchestrated | "This code is a mess" |
| microsoft/autogen | 61.1k | c | orchestrated | **maintenance mode** |
| FoundationAgents/MetaGPT | 70.5k | c | orchestrated | dormant (1 commit in 2026) |
| crewAIInc/crewAI, langchain-ai/langgraph | 58.9k / 42.1k | c | orchestrated | active, not coding-specific; deepagents (29.6k) is a single harness + subagents |
| snarktank/ralph | 21.8k | d | independent | 10 iterations default; no commits since Feb |
| ralph-orchestrator / ralphy / open-ralph-wiggum | 3.2k / 3.0k / 1.9k | d→b / d→a / d | mixed | `--max-iterations`, `--max-parallel 3` |
| vercel-labs/ralph-loop-agent | 837 | d | independent | `costIs(5.00)`, `tokenCountIs(100_000)` |
| ghuntley Ralph (post) | — | d | independent | "$50k contract … $297 USD"; greenfield only |
| OpenHands / SWE-agent / aider | 88.8k / 20.4k / 49.1k | single agent | independent | the benchmark lineage never went multi-agent |
| openai/codex subagents (`spawn_agent`) | 125.8k (repo) | b | orchestrated | "scale roughly linearly"; quota-drain bug; 74-subagent / 5.39B-token runaway (#38989, user-reported); menu entry removed once |
| anomalyco/opencode Task/subagent | 209.2k (repo) | b | orchestrated | "84% of the real cost was invisible" (#45417); Agent Teams request stale-closed |
| google-gemini/gemini-cli SubAgent | 107.1k (repo) | b (minimal) | parent→child only | P3; no cost complaints because barely used |
| earendil-works/pi | 108.2k (repo) | none in core | — | maintainer: subagent orchestration belongs in userland |

## 7. Tally by pattern and judgment

| Pattern | Evidence of actual use | Dominant / niche |
|---|---|---|
| (a) independent parallel sessions | 7 tools ≥1.7k stars all shipping the same thing; 15+ tiny clones; the top Claude Code cost threads describe "~10 agents", "4 parallel sessions", "5 concurrent sessions", "57 headless sessions/day"; Cursor/OpenAI/Anthropic all ship worktree isolation natively | **Dominant.** The human is the orchestrator; git is the message bus. |
| (b) orchestrator + subagents | ~239k `.claude/agents` files; native in Claude Code, Codex, OpenCode, deepagents; Anthropic shows 90% research-quality gain at 15x tokens; runaway incidents in both Claude Code (905 agents) and Codex (74 subagents / 5.39B tokens); Codex's "should scale roughly linearly"; OpenCode hides 42–84% of the cost; Anthropic's Opus 5 default prompt says don't | **Common but contained**: used for read-only fan-out (explore/review/research), distrusted for writes. Second place. |
| (c) scripted workflows | ~3.9k Workflow scripts (≈1/60th of subagent files), ~20% of adopters iterate; AutoGen maintenance mode, MetaGPT dormant; one public "moved away entirely"; vendor defaults lowered three times in four months | **Niche**, used mainly for review/audit/triage fan-out and by a few teams with CI-like needs. |
| (d) single session + loop | 21.8k-star Ralph, 5k+ `while true; claude -p` files, Anthropic ships a `ralph-loop` plugin, `/loop` used to drive (c) | **Common, second-tier**; the default "unattended" mode, bounded by greenfield/small-story constraints. |

## 8. Signals of abandonment

1. **Vibe Kanban (28k★) sunsetting** — "couldn't find a business model" despite "thousands of engineers every day" (2026-04-10).
2. **Gas Town (18k★)**: no commits on main since 2026-07-23; the only "agents talk to each other" tool with a big following went quiet in two months. [unverified: whether development moved to a private fork.]
3. **AutoGen (61k★) in maintenance mode**; **MetaGPT (70k★) 1 commit in 2026**; the "AI software company" graph frameworks did not survive contact with real coding agents.
4. **ruflo (73k★)**: independent audit — "~290 out of 300+ MCP tools are stubs". Stars on "swarm orchestration" repos are not usage.
5. **Anthropic retreating on workflow defaults**: 2.1.202 advisory size → 2.1.219 "<15 agents" + "Do not use workflows … unless the user requested it" for Opus 5 → 2.1.271 "small on Pro", medium 15→10, pause at usage limit. Plus #94907 (52k tokens of unused tool schemas) and 2.1.248 shrinking the tool description 5.7k→1k.
6. **#66032**: "we've had to move away from using dynamic workflows entirely … now looking at other libs entirely like langgraph."
7. **One-shot workflow scripts**: 12/30 sampled repos touched `.claude/workflows/` exactly once; 20/30 never after the first two days.
8. **Ralph tooling frozen**: snarktank/ralph (Feb), ralphy (Feb), agrimsingh/ralph-wiggum-cursor (Jan), coleam00 quickstart (Jan) — the pattern moved into vendors' plugins (`ralph-loop`, `/loop`) and stopped needing repos.
9. **Claude Squad** (8.5k★) on a version-bump cadence; Crystal renamed to Nimbalyst; Mux renamed to Xum — the (a) category is consolidating, not growing in kind.
10. **Agent-teams feature requests are all about terminal panes** (Ghostty, WezTerm, zellij, Windows Terminal), none about coordination quality — users want to *watch* parallel agents, not wire them together.
11. **Codex removed "Multi-agents" from its `/experimental` menu** ("We got ahead of ourselves by adding it there") after the quota-drain incident; OpenCode's "Agent Teams" request stale-closed with no maintainer reply; Gemini CLI's SubAgent RFC is P3 and its Agent Teams request is about to auto-close; pi's maintainer declined twice.
12. **Cross-session messaging never became a product**: #24798 (80 comments) shows users building "Ed25519 message signing", "FastAPI server with HTTP/3", "tmux-based wake system" by hand — and Anthropic's answer was SendMessage between subagents, not between sessions.

## 9. Method notes and limits

- `gh search code` is capped at ~10 requests/min and returns at most 1,000 results; the `.claude/workflows` JS census is the first 500 hits (483 files / 351 repos) plus GitHub's approximate `total_count` (3,872). Repo-level sample (39 repos for stars/push dates, 30 for commit history) was every 9th repo of the sorted list, not random.
- Steve Yegge's Gas Town posts on Medium and OpenAI's Symphony announcement returned 403 to the fetch tool; no cost numbers from those two sources are included. [unverified: Yegge's often-cited statements that Gas Town is extremely token-hungry.]
- GitHub Discussions are disabled on anthropics/claude-code (0 discussions), so "complaints vs praise" is from issues only. Praise is structurally under-represented in an issue tracker; I compensated by reading READMEs and the vendor engineering posts, which are the pro-orchestration side.
- Stars are a poor proxy for use (ruflo audit). Where I could, I paired stars with commit cadence and with issue content.

## 10. Plain-language answer for a solo developer running Claude Code + Codex + pi + DSH

**What observed practice suggests**

- Run **independent sessions in worktrees** (pattern a) as the default unit of parallelism. This is what the most-used tools (Symphony, Superset, Squad, emdash, Nimbalyst, Xum, and the sunset Vibe Kanban) all do, what Cursor/OpenAI/Anthropic built natively, and what the users in the big cost threads describe ("4 sessions", "~10 agents", "5 concurrent"). You are the orchestrator; git and a task list are the message bus. Keep it to a handful — the coordination-pain thread (#24798) starts at 4–5 sessions, and Cursor found agents "slow down to the effective throughput of two or three" once they contend for the same files.
- Use **subagents (pattern b) for read-only fan-out only**: exploration, review, research, log analysis. That is exactly where Anthropic measured the 90% gain and where the Codex docs point; it is also the cheapest failure mode when a subagent goes wrong. Cap depth and breadth yourself (`.claude/agents` with narrow tool lists; Codex `max_concurrent_threads_per_session`). Do not let subagents edit in parallel — every write-side complaint (#68110's 905 agents, the 3x re-run in #90544, Cognition's "conflicting assumptions") comes from letting them.
- **Loops (pattern d) for unattended work**, with fresh context per iteration, small stories, and hard stops (`--max-iterations`, `costIs`, `tokenCountIs`). This is the only pattern with a published "$297 for a $50k scope" number, and it composes with (a) (one loop per worktree) and with (c) (Salesforce runs its workflow from `/loop 10m`).
- **Scripted workflows (pattern c) only where you would otherwise write CI**: PR review, dependabot triage, security audit, flaky-test triage — deterministic shape, bounded fan-out, structured output. That is the shape of the scripts that actually survive in public repos (`review-pr.js`, `ci-triage.workflow.mjs`, `security-audit.mjs`), and it is the one place where "agents talk to each other" (a verify pass over a review pass) has demonstrated value.

**What it warns against**

- Do not make a workflow/orchestrator the default entry point for ordinary tasks. The failure reports are all "trivial task → 32/50/95 agents"; Anthropic's own Opus 5 prompt now says "Do not use workflows … unless the user requested it", and the defaults have been lowered three times. Keep `workflowKeywordTriggerEnabled: false` and treat ultracode as a per-task opt-in, never a session default (#95895: reminders every N turns push the model to fan out).
- Do not expect a multi-harness orchestration layer (Claude Code + Codex + pi + DSH talking to each other) to have precedent: the one popular tool that tried (Gas Town) is stalled, the 73k-star one is largely stubs, and users who needed cross-session messaging built HTTP/Ed25519 message buses by hand (#24798) — nobody reports that being worth it for a solo dev. The multi-CLI tools that thrive (Superset, emdash, Xum, ralphy, open-ralph-wiggum) treat the CLIs as interchangeable *workers* behind one dashboard, not as peers.
- Do not trust star counts or "swarm" READMEs as evidence of use; trust commit cadence, issue content, and whether the README states a cost cap.
- Across four harnesses, expect subagent cost to be at best linear in agent count (Codex: "should scale roughly linearly") and often invisible in the harness's own meter (OpenCode: "84% of the real cost was invisible"; Claude Code cost doc: 7x for teams). Measure at the HTTP boundary, not in the TUI, if you run more than one CLI.
- Do not let an agent own the spend knobs (#78019: settings.json is agent-writable) and account for fixed overhead: unused Workflow/Artifact/Cron schemas cost ~52k tokens per session (#94907) before any work starts.
- If you are on a subscription rather than API billing, every pattern above multiplies quota burn (4x/7x/15x), and the largest threads in the Claude Code tracker (#16157: 1,496 comments; #38335: 873) are people discovering that after the fact. Budget with the API-rate numbers even if you pay flat.
