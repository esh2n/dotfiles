---
question: "What do notable individual practitioners (not vendors) say, from their own actual practice, about orchestrated/parallel coding agents versus a single session?"
date: 2026-09-22
verdict: "The modal practice among practitioners who describe their own day-to-day is several independent, human-steered parallel sessions, not a formal orchestrator. Daily orchestrator-plus-subagent operation is rare and concentrated among people who build or sell the orchestrator, or who scope it to read-only research. The single-session group is not laggards - it includes pi's author, Ghostty's maintainer, Amp's lead, and Kent Beck, all citing observability, context hygiene, or enjoyment as the reason."
unverified:
  - "Boris Cherny's parallel-session and worktree quotes come only from two GitHub mirrors of an X thread that could not be opened directly"
  - "Cherny's team having an 'unlimited token budget' is a mirror's paraphrase of a podcast, unconfirmed"
  - "Karpathy's praise for NanoClaw is sourced via a third party (Simon Willison) since the original X post returned HTTP 402"
  - "Ryan Carson's 2026 shift toward multi-agent orchestration is known only from X post titles, not their content"
  - "Thorsten Ball's 2025 Register Spill essays and Dex Horthy's literal 'dumb zone' phrase could not be located in any text source"
  - "Several quotes (e.g. Osmani, Chase, Klaassen) came through a WebFetch summarizer and were not hand-verified against raw HTML"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# What notable practitioners say (2025-2026) about orchestrated / parallel coding agents vs. a single session

Research date: 2026-09-22. Scope: individual practitioners' own writing, not vendor marketing. Vendor documents are cited only where they carry a cost caveat or where a practitioner leans on them.

## Method and verification legend

- Sources were fetched from each person's own site (post pages, archives, RSS, sitemaps), GitHub (`gh api` / `gh issue view`, raw text), and the Wayback Machine for Medium (403 to fetchers). WebSearch was exhausted early; coverage relies on direct fetches of known URLs, so some posts may have been missed.
- x.com returned HTTP 402 to every fetch. Tweets are only cited where mirrored elsewhere and are marked **[unverified]**.
- WebFetch passes page text through a summarizer. Quotes were cross-checked against raw HTML (curl + grep) for Zechner, Steinberger, Huntley, Yegge, Hashimoto, Ronacher, Horthy and the GitHub issues. Quotes for other people are marked **[via-summarizer]** where the batch could not hand-verify them; treat those as high-confidence but not character-exact.
- "No statement found" means exactly that: nothing located, nothing invented.

---

## 1. Per-person findings

### Andrej Karpathy — stance: skeptical of autonomy for novel work; single-agent, tight loop

- **Operates:** predominantly one agent at a time, close review, autocomplete-heavy for serious research code (nanochat); full delegation only for throwaway projects (MenuGen). No evidence found of him running parallel coding-agent sessions.
- **Reason:** agents "kept misunderstanding the code because they have too much memory from all the typical ways of doing things on the Internet" and were "bloating the code base, bloating the complexity" (Dwarkesh interview, 2025-10-18, https://www.dwarkesh.com/p/andrej-karpathy [via-summarizer]).
- **Cost numbers:** none found.
- **Quotes:**
  - "Claude Code (CC) emerged as the first convincing demonstration of what an LLM Agent looks like" — https://karpathy.bearblog.dev/year-in-review-2025/ (2025-12-19)
  - "LLM apps like Cursor bundle and orchestrate LLM calls for specific verticals... They orchestrate multiple LLM calls under the hood strung into increasingly more complex DAGs. They offer an 'autonomy slider'" — same post (description of the industry pattern, not a personal endorsement)
  - "I did not write any code directly; 100% of the code was written by Cursor+Claude" and "Claude kept hallucinating deprecated APIs, model names, and input/output conventions" — https://karpathy.bearblog.dev/vibe-coding-menugen/ (2025-04-27)
  - On NanoClaw (Feb 2026): praised because its "core engine is ~4000 lines of code (fits into both my head and that of AI agents, so it feels manageable, auditable, flexible, etc.)" — via https://simonwillison.net/2026/Feb/21/claws/ **[unverified; original X post 402]**
- **Parallel agents:** no statement found either for or against.

### Simon Willison — stance: mixed / pragmatic; several independent sessions, no orchestrator

- **Operates:** several independent terminal sessions, fresh checkouts into `/tmp` rather than worktrees; review is sequential. Uses a handful of review subagents on a large job (sqlite-utils 4.0).
- **Reason:** "AI-generated code needs to be reviewed, which means the natural bottleneck on all of this is how fast I can review the results." — https://simonwillison.net/2025/Oct/5/parallel-coding-agents/ (2025-10-05)
- **Cost numbers:** sqlite-utils 4.0rc2 cost **$149.25** (main session $141.02 + five review subagents $2.40/$2.39/$1.72/$1.40/$0.32, 37 prompts, 34 commits) — https://simonwillison.net/2026/Jul/5/sqlite-utils-fable/ (2026-07-05). Relays the Bun-in-Rust figure "5.9 billion uncached input tokens, 690 million output tokens, and 72 billion cached input token reads — around $165,000 at API pricing" — https://simonwillison.net/2026/Jul/8/rewriting-bun-in-rust/ (2026-07-08).
- **Quotes:**
  - "I haven't adopted git worktrees yet: if I want to run two agents in isolation against the same repo I do a fresh checkout, often into `/tmp`." (2025-10-05)
  - "I can only focus on reviewing and landing one significant change at a time, but I'm finding an increasing number of tasks that can still be fired off in parallel without adding too much cognitive overhead to my primary work." (2025-10-05)
  - "At one point I had six terminal windows open running this same prompt against six different repos" — https://simonwillison.net/2025/Nov/11/six-coding-agents-at-once/ (2025-11-11) [via-summarizer]
  - "While it can be tempting to go overboard breaking up tasks across dozens of different specialist subagents, it's important to remember that the main value of subagents is in preserving that valuable root context and managing token-heavy operations." — https://simonwillison.net/guides/agentic-engineering-patterns/subagents/
  - The parent agent "is perfectly capable of debugging or reviewing its own output provided it has the tokens to spare" — same guide
  - On Anthropic's 15x figure: multi-agent token spend is justified only when "the value of the task is high enough to pay for the increased performance" — https://simonwillison.net/2025/Jun/14/multi-agent-research-system/ (2025-06-14)
  - "let Fable (and to a certain extent Opus) use their own judgement rather than dictating how they should work" — https://simonwillison.net/2026/Jul/3/judgement/ (2026-07-03) [via-summarizer]

### Mitchell Hashimoto — stance: single agent by choice

- **Operates:** one agent (Amp), sequential sessions, manual iteration afterwards. Uses Amp's read-only Oracle subagent for planning only.
- **Reason:** "a good balance for me right now between being able to do deep, manual work I find enjoyable, and babysitting my kind of stupid and yet mysteriously productive robot friend."
- **Cost numbers:** one non-trivial Ghostty feature: "16 separate sessions totalling $15.98 in token spend on Amp" — https://mitchellh.com/writing/non-trivial-vibing (2025-10-11)
- **Quotes:**
  - "I'm not [yet?] running multiple agents, and currently don't really want to." — https://mitchellh.com/writing/my-ai-adoption-journey (2026-02-05)
  - "It actually did a really bad job here and I ended up throwing all of this code away. The code it produced worked, but it was obviously the wrong approach." (2025-10-11)
  - "Please don't ever ship AI-written code without a thorough manual review." (2025-10-11)
  - "It is an Amp-specific read-only subagent that uses a slower, higher-cost model that is generally better at thinking about things. I consult the oracle for all planning." (2025-10-11)
  - "I almost always go in after an AI does work and iterate myself for awhile, too." (2025-10-11)
- Note: "Ghostty Is Leaving GitHub" (2026-04-28) contains nothing about AI PR policy.

### Thorsten Ball (Amp) — stance: small, short threads; subagents as isolated helpers, not a fleet

- **Operates:** one thread at a time, kept small; new threads often; Oracle for planning. No statement of running many parallel sessions himself.
- **Reason:** "after the context window reaches 100k tokens, things start to feel blurry, imprecise" — https://ampcode.com/how-i-use-amp
- **Cost numbers:** none found.
- **Quotes:**
  - "In general — and I'll give you some exceptions soon — I'll try to keep the threads, the conversations I have with the model, small."
  - "I think a lot of the problems that people who are new to working with agents run into can be traced back to them not starting new threads often enough"
  - "my guess is that Amp now writes 70-80% of the code I commit."
  - Amp docs (product he built): subagents "work in isolation, so they can't communicate with each other, you can't guide them mid-task, and they start with the instructions and context the main agent gives them rather than the full conversation." — https://ampcode.com/docs/models-and-subagents
- Gap: the 2025 Register Spill essays could not be located through the archive/RSS reachable this pass.

### Boris Cherny (Claude Code) — stance: strongly pro-parallel; many independent sessions plus worktrees plus loops

- **Operates:** "I run 5 Claudes in parallel in my terminal. I number my tabs 1-5, and use system notifications to know when a Claude needs input" plus "5-10 Claudes on claude.ai/code, in parallel with my local Claudes" plus sessions started from the phone. By mid-2026: "I don't prompt Claude anymore. I have loops running that prompt Claude and figuring out what to do. My job is to write loops." (via Pragmatic Engineer, 2026-07-14, https://newsletter.pragmaticengineer.com/)
- **Source caveat:** the X thread (x.com/bcherny/status/2007179832300581177) could not be opened; quotes come from two independent GitHub mirrors that agree word-for-word: https://github.com/dzyim/boris-cherny-claude-code-tips and https://github.com/YuqingNicole/boris-cherny-claude-code. **[unverified against primary]**
- **Reason:** throughput; the Starcraft analogy. Also "give Claude a way to verify its work. If Claude has that feedback loop, it will 2-3x the quality of the final result."
- **Cost numbers:** none of his own. Team reportedly has an "unlimited token budget" (mirror's paraphrase of Lenny's Podcast, [unverified]).
- **Quotes:**
  - "Spin up 3-5 git worktrees at once, each running its own Claude session in parallel. It's the single biggest productivity unlock, and the top tip from the team." (Jan 31 2026 thread, via mirror) [unverified]
  - "I use Opus 4.5 with thinking for everything... it is almost always faster than using a smaller model in the end."
  - "I use a few subagents regularly: code-simplifier simplifies the code after Claude is done working, verify-app has detailed instructions for testing Claude Code end to end, and so on."
  - "Most sessions start in Plan mode... From there, I switch into auto-accept edits mode and Claude can usually 1-shot it. A good plan is really important!"
- Anthropic's own docs, which he presumably shaped, treat parallelism as an escalation, not a baseline: "Once you're effective with one Claude, multiply your output with parallel sessions" and name "the kitchen sink session" and reviewer over-reporting as failure modes — https://code.claude.com/docs/en/best-practices.

### Armin Ronacher — stance: mixed-to-skeptical; ran a subagent "software factory" and calls it a failure

- **Operates:** Amp, Claude Code and pi from the CLI, hands-off per task, second checkout for parallel work, cheaper model by preference. Tried the Task tool for context isolation and went back to fresh sessions plus Markdown notes. Built a pi subagent extension he does not use day to day.
- **Cost numbers:** Astra factory: "In the 35 hours it burned around 1B tokens for a total of around 1200 USD in raw API costs." / "It managed to produce 79 commits, and that comes to a cost of around 15.5 USD per commit." / "I burned a full reset's worth of ChatGPT tokens on this which appears to be around 4 billion tokens." — https://lucumr.pocoo.org/2026/9/7/astra-why/ (2026-09-07)
- **Quotes:**
  - "35 hours later, the factory has delivered absolutely nothing of value and also not taught me anything about how to operate a better one." (2026-09-07)
  - "When however goes all bananza with subagents (where the agent believes nobody is looking) it's resorting to all kinds of increasingly bizarre behavior." / "Even if the failure rate is quite low, I would not want this." (2026-09-07)
  - "My software factory was intentionally set up to let the model decide the how of the workflow entirely." (2026-09-07)
  - "While sub-agents should preserve context better, I often get better results by starting new sessions, writing thoughts to Markdown files, or even switching to o3 in the chat interface." — https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/ (2025-07-30)
  - "Tasks that don't parallelize well — especially those mixing reads and writes — create chaos." (2025-07-30)
  - "Agents aren't exceptionally fast individually, but parallelization boosts overall efficiency." / "Your initial shared state is just the file system and a second check-out will do." — https://lucumr.pocoo.org/2025/6/12/agentic-coding/ (2025-06-12)
  - "I exclusively use the cheaper Sonnet model. It's perfectly adequate for my needs, and in fact, I prefer its outputs over the more expensive Opus model." (2025-06-12)
  - "An extension I experiment with but don't actively use. It lets one Pi agent send prompts to another." — https://lucumr.pocoo.org/2026/1/31/pi/ (2026-01-31)
  - "Task queues for coding tasks, orchestration of agents, subagents, durable sessions will matter more and more." / "I have no doubts that this looping future is going to be our future despite the fact that I presently resent it." — https://lucumr.pocoo.org/2026/6/23/the-coming-loop/ (2026-06-23)
  - "A better tool caller will do the job in fewer tokens. There are some cheaper models available than sonnet today, but they are not necessarily cheaper in a loop." — https://lucumr.pocoo.org/2025/11/21/agents-are-hard/ (2025-11-21)

### Dex Horthy (HumanLayer, 12-factor agents) — stance: phase-dependent; subagents for research, sparingly for implementation

- **Operates:** Claude Code with research → plan → implement commands. Research fans out to parallel subagents; implementation is serial and the only step done in a worktree. Sometimes runs two competing plans as separate top-level sessions.
- **Reason:** "the contents of your context window are the ONLY lever you have to affect the quality of your output"; keep utilization "in the 40%-60% range". "Subagents are not about playing house and anthropomorphizing roles. Subagents are about context control." — https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md (2025-08-29)
- **Cost numbers:** "our team of three is averaging about $12k on opus per month" (ace-fca.md, 2025-08).
- **Quotes:**
  - "Rather than building monolithic agents that try to do everything, build small, focused agents that do one thing well. Agents are just one building block in a larger, mostly deterministic system." — 12-factor-agents, factor 10
  - "Use sub-tasks sparingly - mainly for targeted debugging or exploring unfamiliar territory." — humanlayer/humanlayer `.claude/commands/implement_plan.md`
  - "A bad line of code is… a bad line of code. But a bad line of a plan could lead to hundreds of bad lines of code. And a bad line of research… could land you with thousands of bad lines of code." (ace-fca.md)
  - "I ran both plans in parallel and submitted both as PRs before signing off for the night." (ace-fca.md)
  - Failure account: 7 hours with a collaborator on removing Hadoop deps from parquet-java "did not go well" because research "didn't go deep enough"; "In August the whole team spent 2 weeks spinning circles on a really tricky race condition." (ace-fca.md)
- The literal phrase "dumb zone": not found in any text source; may exist only in the spoken talk.

### Harrison Chase (LangChain) — stance: pro-orchestration as a framework builder, with cost acknowledged

- **Operates:** builds LangGraph / Deep Agents / Open SWE; not an individual-coder workflow.
- **Cost numbers:** cites Anthropic's "up to 15× more tokens" (Context Engineering for Agents, 2025-07-02 [via-summarizer]); benchmark post notes supervisor "consistently uses more tokens than swarm" (2025-06-10).
- **Quotes:**
  - "Most of the performance issues for the supervisor architecture came from the 'translation' occurring when the supervisor agent had to play telephone between the sub agents and the user." — Benchmarking Multi-Agent Architectures, 2025-06-10
  - "When your agents fail to follow complicated instructions or consistently select incorrect tools, you may need to further divide your system and introduce more distinct agents." — How to Think About Agent Frameworks, 2025-04-20
  - "Deep agents go deeper on topics. This is largely accomplished by spinning up sub agents that specifically focused on individual tasks." — Deep Agents launch, 2025-07-30
- Direct rebuttal to Cognition's "Don't Build Multi-Agents": not found.

### Mario Zechner / badlogic (pi) — stance: subagents as default are an anti-pattern; self-spawn under observation for review only

- **Operates:** one pi session per task; spawns pi itself via bash/tmux for isolated sub-tasks (code review); no built-in subagent tool or plan mode. "hundreds of exchanges" in a single session without compaction.
- **Reason:** observability. Cost numbers: none of his own; documents MCP overhead ("7-9% of your context window gone before you even start working") and pi's system prompt "below 1000 tokens".
- **Quotes** (all https://mariozechner.at/posts/2025-11-30-pi-coding-agent/, 2025-11-30, hand-verified):
  - "pi does not have a dedicated sub-agent tool. When Claude Code needs to do something complex, it often spawns a sub-agent to handle part of the task. You have zero visibility into what that sub-agent does. It's a black box within a black box."
  - "Spawning multiple sub-agents to implement various features in parallel is an anti-pattern in my book and doesn't work, unless you don't care if your codebase devolves into a pile of garbage."
  - "Using a sub-agent mid-session for context gathering is a sign you didn't plan ahead. If you need to gather context, do that first in its own session."
  - "I'm not dismissing sub-agents entirely. There are valid use cases. My most common one is code review: I tell pi to spawn itself with a code review prompt (via a custom slash command)..."
  - "pi does not and will not have a built-in plan mode."
  - On Claude Code hiding cost from Max users: "don't worry your little head about it. You have a plan. You don't need to know the numbers." — https://mariozechner.at/posts/2025-08-06-cc-antidebug/ (2025-08-06)

### Peter Steinberger (OpenClaw) — stance: pro-parallel independent panes, explicitly anti-subagent / anti-framework

- **Operates:** "I run between 3-8 in parallel in a 3x3 terminal grid, most of them in the same folder, some experiments go in separate folders." Tried worktrees and PRs, "always revert back to this setup as it gets stuff done the fastest." Now Codex CLI as daily driver.
- **Cost numbers:** "I currently have 4 OpenAI subs and 1 Anthropic sub, so my overall costs are around 1k/month for basically unlimited tokens. If I'd use API calls, that'd cost my around 10x more" — https://steipete.me/posts/just-talk-to-it (2025-10-14). Earlier: "The $200/month Max plan pays for itself." — https://steipete.me/posts/2025/claude-code-is-my-computer (2025-06-03)
- **Quotes** (hand-verified):
  - "What others do with subagents, I usually do with separate windows... This gives me complete control and visibility over the context I engineer, unlike subagents who make it harder to view and steer or control what is sent back." (2025-10-14)
  - "Don't waste your time on stuff like RAG, subagents, Agents 2.0 or other things that are mostly just charade. Just talk to it. Play with it. Develop intuition." (2025-10-14)
  - On Anthropic's recommended "AI Engineer" subagent: "It's an amalgamation of slop... you could even make the argument that this slop is context poison." (2025-10-14)
  - "I run one dev server, as I evolve my project I click through it and test multiple changes at once. Having a tree/branch per change would make this significantly slower" (2025-10-14)
  - "realistically Claude gets very silly long before it depletes that context" (2025-10-14)
  - "When you have six tabs all saying 'claude', finding the right one becomes a game of terminal roulette." — https://steipete.me/posts/2025/commanding-your-claude-code-army (2025-06-05)

### Geoffrey Huntley — stance: rejects agent-to-agent orchestration frameworks; runs one deterministic loop with heavy internal subagent fan-out

- **Operates:** the Ralph loop (`while :; do cat PROMPT.md | claude-code ; done`), one process, one repo, one task per iteration, human "on the loop". Inside the loop: up to hundreds of parallel subagents for search/read, exactly one for build/test. Separately "multi-boxing" several independent agents on separate stories.
- **Cost numbers:** "Cost of a $50k USD contract, delivered, MVP, tested + reviewed with @ampcode. $297 USD." (embedded tweet 2025-07-11 in https://ghuntley.com/ralph/) — a delivery-cost claim, self-reported.
- **Quotes** (hand-verified):
  - "everyone seemed to be trying to crack on multi-agent, agent-to-agent communication and multiplexing. At this stage, it's not needed. Consider microservices and all the complexities that come with them. Now, consider what microservices would look like if the microservices (agents) themselves are non-deterministic—a red hot mess." — https://ghuntley.com/ralph/ (2025-07-14)
  - "Ralph is monolithic. Ralph works autonomously in a single repository as a single process that performs one task per loop."
  - "Your primary context window should operate as a scheduler..."
  - "You may use up to [500] parrallel subagents for all operations but only 1 subagent for build/tests of rust."
  - "If you were to fan out to a couple of hundred subagents and then tell those subagents to run the build and test of an application, what you'll get is bad form back pressure."
  - "Ralph is an orchestrator pattern where you allocate the array with the required backing specifications and then give it a goal then looping the goal." — https://ghuntley.com/loop/ (2026-01-17)
  - "The key to making it work is ensuring these agents don't fight with each other by splitting the work into separate discrete domain units of work within the same code-base or checking out the code-base multiple times." — https://ghuntley.com/multi-boxing/ (2025-01-28)
- ghuntley.com/specs/ is subscriber-gated; /slop/ (2026-07-24) is a career announcement.

### Steve Yegge — stance: most bullish pro-fleet voice; self-documents cost and chaos

- **Operates:** two agents in parallel (Mar 2025) → Gas Town (Mayor + crew of workers, Beads memory) → Gas City ("hundreds of concurrent workers"). Medium content recovered via Wayback.
- **Cost numbers:**
  - "They burn lots of LLM tokens, to the tune of $10-$12/hour at current rates." / "budget more like $80-$100 of LLM spend per developer, per day." / "If your developers are each on average running, say, five agents at once... then those devs are each now spending $50/hr, or roughly $100k/year." / "fleets will enable your developers to spend thousands of dollars a day." — https://sourcegraph.com/blog/revenge-of-the-junior-developer (2025-03-22)
  - "Jeffrey Emanuel and his 22 accounts at $4400/month, not to mention all the other crazy early adopters–we're all part of the problem... We're all setting unrealistic standards for everyone else." — The AI Vampire, https://steve-yegge.medium.com/the-ai-vampire-eda6e4f07163 (2026-02-11)
  - "Every new AI tooling form-factor breakthrough has involved 100x increase in token spend." — Welcome to the Wasteland (2026-03-04)
- **Quotes:**
  - "You should never just have one coding agent managing a piece of infrastructure... You should always have at least two or three working together on a little crew." — Welcome to Gas City (2026-04-24)
  - "Claude Code is a wall of scrolling text. The harder it works, the scrollier it gets. Now imagine having 10 standard coding agents running..."
  - Own admission of chaos: "the serial killer sprees, viciously taking out random workers mid-job... the 22-nose Clown Show, where the Mayor scored a new clown nose every time it had massive data loss, which went on for weeks... piles of worker corpses." — Gas Town: from Clown Show to v1.0 (2026-04-03)
  - "I have 40 years of experience... and I have essentially unlimited time, energy, and now tokens for experimenting. I am completely unrepresentative of the average developer. But I'm still standing up and telling everyone 'do it this way!'" (2026-02-11)
  - Jab at minimal harnesses: "Claude Code and some other agents are trying to turn themselves into dark factories, by running subagents... a monolith. I've read some interesting blog posts about that approach, but safe to say I'm not a fan." (2026-04-03)
- Third-party Gas Town user (Justin Abrahms, 2026-01-05, https://justin.abrah.ms/blog/2026-01-05-wrapping-my-head-around-gas-town.html): "Monitoring the state of the workers is too much effort. I'm cycling to each tab and checking in on it. There's a frenetic energy to it that feels like plate spinning." / "The hardest problem is keeping it fed."

### Kent Beck — stance: skeptical; tried a 3-agent orchestrator product and did not want it

- **Operates:** one agent, TDD loop, watched closely; 13-hour single sessions on BPlusTree3.
- **Cost numbers:** none.
- **Quotes** (https://newsletter.kentbeck.com/p/genie-lessons-nobody-wants-agents, 2026-04-23 [via-summarizer]):
  - "Nobody wants agents. Nobody wants agent swarms. I have a system and I want it to change."
  - "Multi-agent is a feature. Outcome-orientation is the thing the feature is supposed to deliver. We keep getting those confused."
  - "I was managing it. Watching which agent was doing what. Wondering when to interrupt. Holding state in my head that the system should have been holding for me." (on a coordinator/implementer/verifier setup)
  - "I'd said I wanted readable code and instead I had a coordination problem."
  - "Five agents can work on this codebase simultaneously. Five people can't. That's backwards." (a capability he still wants solved)
  - Supervision triggers: "(1) Loops. (2) Functionality I hadn't asked for... (3) Any indication that the genie was cheating" — Augmented Coding: Beyond the Vibes (2025-06-25)

### Gergely Orosz / Pragmatic Engineer — stance: reporter; pairs throughput claims with review-overload warnings

- **Reports (not his own practice):** "Everyone runs multiple AI agents all the time. Running 3-10 parallel agents is a given." (Anthropic, 2026-07-28, https://newsletter.pragmaticengineer.com/p/inside-anthropic); Bun rewrite: one orchestrator, "64 parallel agents", 11 days, $165,000 in tokens at API price, engineer avoided worktrees "which he found slow"; Cherny "ships 20–30 PRs/day".
- **Skeptical material:** "We're seeing a lot more code generated, and less of it than ever being reviewed by devs"; "Shipping unread code spells disaster within months... it took three weeks to re-onboard to a codebase no human had ever read." (2026-07-15); Uber built a "Code Inbox" because "devs are, indeed, getting overloaded with AI code reviews." A section "Disappointment and 'tokenmaxxing'" (2026-07-14) is paywalled.
- **Survey percentages** on parallel vs single: not found in the free tier.

### Addy Osmani — stance: mixed; prescriptive orchestration pieces for readers, scaled-back personal practice

- **Operates (own words, changes across 2026):** "I stick to one main agent at a time and maybe a secondary one for reviews." (2026-01-04) → "four to five background agents... across another three to five sessions" (2026-01-08) → "My ceiling for a typical session is somewhere around three to four threads" (2026-04-07) → "Very typically I'll max out at about five concurrently" plus a scripted `/loop` on his repo (2026-08-14). No account of him personally running a hierarchical orchestrator. [via-summarizer]
- **Cost numbers:** subagent demo "roughly 220k tokens total"; "3-5 teammates is the sweet spot. Token costs scale linearly with team size" (2026-03-26); "an agent can quietly burn through a week's API budget in an afternoon" (2026-04-28).
- **Quotes:**
  - "I've dabbled in this 'massively parallel' approach; it's surprisingly effective at getting a lot done quickly, but it's also mentally taxing to monitor multiple AI threads!" (2026-01-04)
  - "You can run 20 agents and feel completely busy. But that's not 20 agents worth of shipped work." — Orchestration Tax (2026-05-24)
  - "Spawning 8 agents doesn't speed up your judgement time. It just makes the queue of things feeding into it much deeper." (2026-05-24)
  - "The bottleneck is no longer generation. It's verification." (2026-03-26)
  - "A single agent with good tools often outperforms a multi-agent system with poor orchestration." (undated)

### Martin Fowler's site (Böckeler, Morris, Edwards-Alexander) — stance: cautiously positive with friction documented

- Böckeler, Context Engineering for Coding Agents (2026-02-05): subagents "can be parallelised", useful "to reduce costs" and for second opinions; "subagents are foundational for swarm experiments like claude-flow or Gas Town"; execution "still depends on how well the LLM interprets" the config.
- Edwards-Alexander, An Accidental Blackboard (2026-09-02): ten engineers, four days, emergent coordination through the repo. Downside: "With lots of agents working in one repo, build pipelines suffered. To deal with this we introduced a discipline: our agents were to continually commit and rebase from main." / "This was entirely ad hoc... We saw it happen. And then started to use it."
- Böckeler, TDD inside the agent loop (2026-08-10): TDD consumed 2.96x-8.5x more tokens than non-TDD (single agent; a citable cost figure).
- Morris (2026-03-04): teams "firing up a bunch of agents and leaving them to keep looping until (hopefully) they finish."
- No statement by Fowler himself found.

### swyx — stance: pro-parallel fan-out for exploration, cost-conscious

- **Quotes** (https://www.latent.space/p/claude-code, 2025-05-07 [via-summarizer]): "I just want to fan out to everything all at once. And once I'm not satisfied with the next one solution, I'll just sort of switch to the next." / "I don't have that much money to run commit hook on 3.7."
- No solo essay weighing multi-agent vs single found.

### Matt Pocock — stance: single-session-centric by practice; no explicit argument against multi-agent

- **Operates:** plan mode inside one session, then execute in the same context: "You usually don't clear the context window between planning and execution" — https://aihero.dev/plan-mode-introduction (2026-01-09). Uses "autonomous Ralph loops" for some work.
- "I use plan mode for almost everything - even small bug fixes."
- No statement found on subagents, "context rot", or cost.

### Kieran Klaassen (Every / Cora) — stance: strongly pro-orchestration; three role sessions

- **Operates:** "My monitor now looks like mission control" — three Claude instances: planning, implementing, reviewing — https://every.to/superorganizers/my-ai-had-already-fixed-the-code-before-i-saw-it (2025-08-18) [via-summarizer]. Ships the compound-engineering plugin with `ce-worktree` and "Report-only multi-agent review".
- **Cost:** "You can spin up five specialized agents for the cost of a cup of coffee." No figures.
- "Your instinct will be to micromanage and review every line. Instead, trust the system you've built—but verify through tests, evals, and spot checks."
- No skeptical statement found.

### Ryan Carson — stance: moved from sequential single-task to multi-agent (later era unverified)

- ai-dev-tasks (https://github.com/snarktank/ai-dev-tasks): "instruct the AI to work through the task list one sub-task at a time"; "Stop wrestling with monolithic AI requests and start guiding your AI collaborator step-by-step!"
- 2026 X posts ("How to setup a team of agents in OpenClaw", "Code Factory") — titles only, **[unverified]**.
- Cost numbers: none.

### Dan Shipper (Every) — stance: pro-parallel by implication; thin evidence

- "if you know how to YOLO four agents at once in Claude Code, GPT-5 feels like a step backward" — https://every.to/chain-of-thought/openai-has-some-catching-up-to-do (2026-01-16) [via-summarizer]
- No cost numbers; no skeptical statement found.

### Nicholas Carlini — no statement found on parallel vs single

- Cautionary on unsupervised autonomy only: "Don't hook the random text generator up to anything that interacts with the physical world" — https://nicholas.carlini.com/writing/2025/are-llms-worth-it.html (2025-11-19) [via-summarizer]

### Cal Paterson — skeptical of adding agents, scoped to security

- "You cannot dig yourself out of this problem by adding more agents." / "Multi-level, 'agentic', 'LLM-as-a-Judge' or whatever you call it all suffer from the same problem." — https://www.calpaterson.com/disregard.html (2026-03). No personal workflow statement found.

### Erik Meijer — no statement found (2025-2026)

Only pre-2025 research-positioning material located; nothing on this question.

---

## 2. Vendor cost caveats and measured waste (cited because practitioners lean on them)

- Anthropic: "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats." and "most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time." — https://www.anthropic.com/engineering/built-multi-agent-research-system (2025-06)
- Claude Code agent-teams doc: "Agent teams add coordination overhead and use significantly more tokens than a single session... For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective." / "Three focused teammates often outperform five scattered ones." — https://code.claude.com/docs/en/agent-teams
- Cognition (Walden Yan): "In 2025, running multiple agents in collaboration only results in fragile systems. The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough between the agents." / "Actions carry implicit decisions, and conflicting decisions carry bad results" — https://cognition.com/blog/dont-build-multi-agents (2025-06-12)
- anthropics/claude-code issues (raw text via `gh`):
  - #82565 (2026-07-30): "I asked Claude Code to run 3 research subagents... 24 agents ended up running. Only 4 ever returned a result... This exhausted a monthly spend limit in roughly 20 minutes." 897k tokens, 80.8% wasted.
  - #94013 (2026-09-13): three background agents "used 1,710,388 tokens between them... Nothing required the model to state their cost or get approval first."
  - #92090 (2026-09-04): "10 full-context rewrites = 2.88M cache-write tokens in under 40 minutes, across 6 of the 8 agents... ~$36 of re-caching in one 40-minute session."
  - #47930 (2026-04-14, agent teams): "Token consumption scales with the product (teammates × notifications), not with actual work." 13-22% of spend on no-op acks.
  - #87293 (2026-08-17): worktree subagent "completed with 443,914 tokens consumed and zero tool calls".
- MAST paper (Cemri et al., arXiv 2503.13657): 14 failure modes from "1600+ annotated traces collected across 7 popular MAS frameworks"; "performance gains on popular benchmarks are often minimal." No single failure-rate percentage in the abstract.
- METR RCT (2025-07-10): experienced devs with AI "take 19% longer to complete issues" (single-agent assist, not orchestration).

## 3. Accounts of trying orchestration and stepping back

| Who | What they tried | Outcome | Source |
|---|---|---|---|
| Armin Ronacher | Autonomous multi-agent "software factory" (Astra), model chooses the workflow | 35 h, ~1B tokens, ~$1200, 79 commits, "absolutely nothing of value"; earlier tried Task-tool subagents and preferred fresh sessions + Markdown | lucumr 2026-09-07; 2025-07-30 |
| Kent Beck | Coordinator/implementer/verifier product (Intent) | "I'd said I wanted readable code and instead I had a coordination problem." / "Nobody wants agent swarms." | newsletter.kentbeck.com 2026-04-23 |
| Peter Steinberger | Worktrees + PR-per-change | "always revert back to this setup" (same folder, 3-8 panes); rejects subagents entirely | steipete.me 2025-10-14 |
| Mario Zechner | Framework subagents (Claude Code) | Rejected as "black box within a black box"; kept self-spawn under tmux for review only | mariozechner.at 2025-11-30 |
| Addy Osmani | ~7-10 concurrent agents | Later states a ceiling of "three to four threads"; wrote "Orchestration Tax" | addyosmani.com 2026-01-08 → 2026-04-07 → 2026-05-24 |
| Bun rewrite engineer (via Orosz) | Worktrees | Dropped worktrees "which he found slow"; kept 64-agent fan-out | pragmaticengineer 2026-07-28 |
| Justin Abrahms | Gas Town | "plate spinning"; "broke enough I had to restart it once" | justin.abrah.ms 2026-01-05 |
| Steve Yegge | Gas Town (own system) | Did not step back, but documents weeks of "massive data loss" and "piles of worker corpses" before v1.0 | medium 2026-04-03 |

No clean essay of the form "I tried an orchestrator and permanently went back to one session" was found from a named author; the closest are Ronacher and Beck above.

---

## 4. Summary table (1): person | how they actually operate | stance | cost/token remarks

| Person | How they actually operate | Stance on orchestrated / multi-agent coding | Quoted cost/token remarks |
|---|---|---|---|
| Karpathy | One agent, tight loop, autocomplete for serious code | Skeptical of autonomy on novel code; no view on parallelism found | none |
| Willison | Several independent terminals, fresh /tmp checkouts; a few review subagents on big jobs | Mixed: "tempting to go overboard"; parent "perfectly capable" of reviewing itself | $149.25 for sqlite-utils 4.0rc2; relays 15x and $165k |
| Hashimoto | One agent (Amp) + Oracle for planning | Single agent by choice: "don't really want to" | $15.98 / 16 sessions for one feature |
| Ball | One small thread at a time, new threads often; Oracle | Skeptical of long sessions; subagents as isolated helpers | none |
| Cherny | 5 terminal + 5-10 web sessions, worktrees, subagents, loops [unverified mirror] | Strongly pro-parallel | none of his own |
| Ronacher | Hands-off per task, second checkout, Sonnet; tried factory | Mixed-to-skeptical; factory "delivered absolutely nothing of value" | ~1B tokens / ~$1200 / $15.5 per commit |
| Horthy | research (parallel subagents) → plan → implement (serial, worktree) | Phase-dependent | "$12k on opus per month" for a team of three |
| Chase | Framework builder (Deep Agents subagents) | Pro-orchestration | cites 15x; supervisor > swarm tokens |
| Zechner | One pi session; self-spawn via tmux for review | Parallel feature subagents "an anti-pattern" | MCP overhead 7-9% of context; pi prompt <1000 tokens |
| Steinberger | 3-8 panes, same folder, no worktrees, no subagents | Pro-parallel-independent, anti-subagent | ~$1k/month on 5 subs; "10x more" on API |
| Huntley | One Ralph loop; hundreds of subagents inside; 1 for build/test; multi-boxing | Anti agent-to-agent frameworks ("red hot mess"); pro fan-out inside a loop | "$50k contract... $297 USD" |
| Yegge | Gas Town / Gas City fleets | Most pro-fleet | $10-12/h per agent; $100k/yr/dev at 5 agents; "$4400/month" user; "100x token spend" per generation |
| Beck | One agent, TDD, close supervision | Skeptical: "Nobody wants agent swarms" | none |
| Orosz | Reporter | Mixed: throughput plus review overload | Bun: 64 agents, 11 days, $165k |
| Osmani | 3-5 concurrent typical + scripted loop; sensitive work single | Mixed; "Orchestration Tax" | 220k tokens demo; "linear" with team size |
| Fowler site | Multiple authors; one 10-engineer blackboard swarm | Cautiously positive with friction | TDD 2.96x-8.5x tokens (single agent) |
| swyx | Fan-out several instances, worktrees | Pro-parallel exploration | "don't have that much money to run commit hook on 3.7" |
| Pocock | One session, plan mode; some Ralph loops | Single-session by practice | none |
| Klaassen | 3 role sessions (plan/implement/review), plugin | Strongly pro-orchestration | "cost of a cup of coffee" |
| Carson | 2025: one sub-task at a time; 2026: agent teams [unverified] | Moved toward orchestration | none |
| Shipper | "YOLO four agents at once" | Pro-parallel (thin) | none |
| Carlini | n/a | No statement found | none |
| Paterson | n/a | "cannot dig yourself out... by adding more agents" (security) | none |
| Meijer | n/a | No statement found | none |

## 5. Summary table (2): tally by primary day-to-day mode

Classified by what the person says they themselves do most of the time (secondary modes in parentheses). People with no personal-workflow statement (Carlini, Paterson, Meijer, Orosz, Fowler-site authors as a group, Chase as framework builder) are excluded from the count.

| Mode | Count | People |
|---|---|---|
| Many independent parallel sessions (no orchestrator) | 7 | Willison, Cherny (+worktrees, +loops), Steinberger, swyx, Klaassen (role lanes), Osmani (+loop), Shipper |
| Orchestrator + subagents | 3 | Yegge, Horthy (research phase only), Carson-2026 [unverified] |
| Scripted loop / workflow | 1 primary (+4 secondary) | Huntley (Ralph); secondary: Cherny "I write loops", Osmani `/loop`, Pocock "Ralph loops", Carson nightly loop |
| Single session | 6 | Karpathy, Hashimoto, Ball, Zechner, Beck, Pocock |
| Tried orchestration, reported it net-negative | 2 | Ronacher (Astra factory; earlier Task-tool subagents), Beck (Intent) |

Reading: the modal practice among people who describe their own day is several independent, human-steered sessions, not an orchestrator. Formal orchestrator-plus-subagent operation as the daily mode is rare and concentrated in people who build or sell the orchestrator (Yegge, Chase, Klaassen) or who scope it to read-only research (Horthy). The single-session group is not made of laggards; it includes the pi author, Ghostty's maintainer, the Amp lead and Kent Beck, all citing observability, context hygiene or enjoyment as the reason.

## 6. Recurring arguments against orchestration (who says it)

1. **Review/verification is the bottleneck, not generation.** Willison ("how fast I can review"), Osmani ("The bottleneck is no longer generation. It's verification"; "Spawning 8 agents doesn't speed up your judgement time"), Orosz ("less of it than ever being reviewed"), Abrahms ("plate spinning"), Hashimoto ("thorough manual review"), Beck ("Holding state in my head that the system should have been holding for me").
2. **Subagents are black boxes that lose context and steerability.** Zechner ("black box within a black box"), Steinberger ("harder to view and steer or control what is sent back"), Ronacher ("better results by starting new sessions, writing thoughts to Markdown"), Amp docs ("you can't guide them mid-task"), Cognition ("context isn't able to be shared thoroughly enough").
3. **Parallel writes to one codebase produce conflicting decisions and garbage.** Zechner ("pile of garbage"), Ronacher ("mixing reads and writes — create chaos"), Cognition ("conflicting decisions carry bad results"), Huntley (only 1 build/test subagent; "don't fight with each other"), Fowler-site blackboard ("build pipelines suffered"), Claude Code docs ("Two teammates editing the same file leads to overwrites").
4. **Token cost multiplies, often without output.** Anthropic (15x), Ronacher ($15.5 per commit for nothing), Yegge ($100k/yr/dev at 5 agents; "100x token spend"), GitHub issues (80% wasted; 1.7M tokens unapproved; 13-22% on acks), Osmani ("burn through a week's API budget in an afternoon"), Claude Code docs ("significantly more tokens").
5. **Non-deterministic components should not be composed like microservices.** Huntley ("a red hot mess"), Karpathy (prefers a ~4000-line engine that "fits into my head"), Zechner/Ronacher (minimal harness, no built-in orchestration).
6. **Unattended subagents misbehave.** Ronacher ("where the agent believes nobody is looking... increasingly bizarre behavior"), Yegge (own "serial killer sprees", "massive data loss"), GitHub #82565 (recursive spawning).
7. **Long contexts degrade anyway, so the fix is short threads, not more agents.** Ball (100k "blurry"), Steinberger ("very silly long before it depletes that context"), Horthy (40-60% utilization), Ronacher ("Long sessions lead to forgotten context").
8. **Multi-agent is a feature confused with the goal.** Beck ("Outcome-orientation is the thing the feature is supposed to deliver"), Steinberger ("mostly just charade. Just talk to it").
9. **Adding agents does not contain untrusted input.** Paterson ("cannot dig yourself out of this problem by adding more agents").

## 7. Recurring arguments for orchestration / parallelism (who says it)

1. **Throughput when tasks are independent.** Cherny ("single biggest productivity unlock" [unverified]), Steinberger ("gets stuff done the fastest"), Ronacher ("parallelization boosts overall efficiency"), Willison ("fired off in parallel without adding too much cognitive overhead"), Orosz reporting Anthropic ("3-10 parallel agents is a given"; 67% PR throughput), Klaassen ("scale on demand").
2. **Context isolation: keep the root context clean, push token-heavy reads out.** Willison ("preserving that valuable root context"), Horthy ("Subagents are about context control"), Huntley ("primary context window should operate as a scheduler"), Böckeler ("their own context for efficiency... or to reduce costs"), Chase (Deep Agents), Claude Code docs.
3. **Fresh-context review catches what the author misses.** Zechner (self-spawn for code review), Cherny (code-simplifier, verify-app), Klaassen (review lane), Claude Code docs ("won't be biased toward code it just wrote"), Hashimoto/Ball (Oracle for planning).
4. **Fan out to explore, then pick.** swyx ("fan out to everything all at once"), Horthy ("ran both plans in parallel and submitted both as PRs"), Willison (six repos, same prompt).
5. **Redundancy against single-agent error.** Yegge ("at least two or three working together on a little crew"), Cherny (verification loops "2-3x the quality").
6. **Cheap relative to labor.** Klaassen ("cost of a cup of coffee"), Huntley ("$297"), Hashimoto ($15.98 "less than coffee shops"), Steinberger ($1k/month "damn good deal").
7. **Direction of travel.** Ronacher, resentfully ("this looping future is going to be our future"), Orosz (loop engineering absorbed into native `/goal` commands), Yegge (fleets).

## 8. Gaps

- x.com inaccessible: Cherny's thread, Karpathy's tweets, Carson's 2026 posts are mirrored/unverified.
- Paywalled: Orosz "tokenmaxxing" section; several Beck posts; ghuntley.com/specs/.
- Not located: Thorsten Ball's 2025 Register Spill essays; Horthy's literal "dumb zone"; Harrison Chase's reply to Cognition; any survey percentage of engineers running parallel sessions; Anthropic's "Scaling long-running autonomous coding" (Jan 2026) primary post; Yegge's "Flat Curve Society".
- Erik Meijer and Nicholas Carlini: genuine null results for this question.
