---
question: "Across five harnesses (Claude Code, Codex, pi, DSH, omp) sharing one MCP server source list, which configured servers are actually called, what do vendors/practitioners/measurements say about their value, and which new servers (if any) are worth adding?"
date: 2026-09-22
verdict: "Almost everything already configured is barely or never used (23 real MCP calls across roughly 6,000 transcript files in 30 days, 5 of 8 configured servers at zero calls), and the categories most tempting to add next (GitHub, issue trackers, databases) are exactly the categories with the strongest documented cost or security downsides for a coding-agent harness; only Playwright (scoped to harnesses with no native browser tool) and context7 (kept exactly as already scoped) clear the bar, and even context7 saw zero calls in this owner's own 30-day data."
unverified:
  - "A named practitioner (2026) post specifically reviewing serena, codebase-memory-mcp, context7, or claude-mem and recommending keep/drop"
  - "Independent reproduction of codebase-memory-mcp's 99.2%-token-reduction claim or claude-mem's '~10x' claim"
  - "DSH's own MCP configuration (no domains/dev/config/dsh/mcp* file found in the paths checked)"
  - "MCP-server latency numbers (only context-cost and accuracy numbers were found)"
  - "The exact date Claude Code's tool-search became enabled by default"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# MCP servers in a personal coding harness (2026) — what's configured, what it's worth, what to add

Date: 2026-09-22. Scope: five harnesses (Claude Code, Codex, pi, DSH, omp) sharing one `mcp/` source list.

## Method and verification legend

- **Local (exact)** — read directly from files on this machine: `~/.claude.json`, `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.omp/agent/mcp.json`, `~/.pi/agent/*`, the repo's `domains/dev/config/claude-profiles/{core,personal}/mcp.json`, `domains/dev/config/omp/`, `domains/dev/config/pi/`, and the local grep/jq counts below. These are ground truth, not inference.
- **Direct fetch** — `WebFetch` against a primary URL (vendor doc, README, GitHub API). WebFetch itself summarizes through a small model, so it is marked `[fetched-via-summarizer]` wherever the exact wording matters; I re-fetched load-bearing quotes a second time to check they weren't paraphrase artifacts.
- **`gh api` / `gh search code`** — authenticated, direct GitHub REST/search API, not a summarizer. Numbers are exact API responses at fetch time (2026-09-22, ~11:00–11:30 UTC).
- **WebSearch was unavailable** — the session's WebSearch budget was already exhausted (200/200) before I could use it here. I substituted known-good direct URLs (Simon Willison's tag/post pages, vendor READMEs) reached via WebFetch. This means practitioner-lens coverage is narrower than a full web search would give — see "no precedent found" at the end.
- Everything below not marked `[unverified]` traces to one of the above.

---

## Part A — what is actually configured, and what actually gets called

### A.1 Inventory (local, exact)

| Harness | Source file | Servers |
|---|---|---|
| Claude Code (user scope) | `~/.claude.json` → `mcpServers` | `codebase-memory-mcp` (stdio, `/Users/esh2n/bin/codebase-memory-mcp-managed`), `serena` (stdio, `uvx serena-agent==1.5.3 start-mcp-server --context claude-code`) |
| Claude Code (settings) | `~/.claude/settings.json` → `mcpServers` | `figma-remote` (http, `https://mcp.figma.com/mcp`), `figma-desktop` (http, `http://127.0.0.1:3845/mcp`) |
| Claude Code (plugin) | `~/.claude/plugins/cache/thedotmack/claude-mem/12.4.9/.mcp.json` (installed plugin `claude-mem@thedotmack` v12.4.9) | `mcp-search` (stdio, `bun ${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.cjs`) — the plugin also installs 5 lifecycle hooks that run independent of MCP |
| Codex | `~/.codex/config.toml` → `[mcp_servers.*]` | `context7` (`npx @upstash/context7-mcp@1.0.14`), `playwright` (`npx @playwright/mcp@0.0.32`), `notion-mcp` (http, `https://mcp.notion.com/mcp`), `codebase-memory-mcp`, `serena` (`--context codex`) |
| omp | `~/.omp/agent/mcp.json` (generated file, confirmed present and populated) | `codebase-memory-mcp`, `serena` (`--context codex` — omp reuses Codex's serena context because serena-agent has no `omp` context; documented as a deliberate approximation in `lib/mcp-inventory/writers/omp.js`) |
| pi | none | **pi has no native MCP client.** `pi --help` lists no `mcp` command or flag. `https://pi.dev/docs/latest` [fetched-via-summarizer] confirms: no mention of MCP; pi's own extensibility model is TypeScript extensions/skills/prompt-templates, not MCP. This is a hard platform gap, not a configuration gap — a shared `mcp/` source list cannot reach pi without pi shipping an MCP client. |
| DSH | not inventoried directly (out of the paths the task named); repo has no `domains/dev/config/dsh/mcp*` file found in this sweep | not covered here — flag for the owner to check separately |
| Repo source of truth | `domains/dev/config/claude-profiles/core/mcp.json` (`jig.mcp.v1`) | Declares `figma-remote`, `figma-desktop` (claude only), `codebase-memory-mcp`, `serena` (codex+omp only — Claude side is registered outside this file via `claude mcp add`), `context7`, `playwright`, `notion-mcp` (codex only). `personal/mcp.json` is empty (`servers: []`). |

Distinct servers actually reachable by at least one harness right now: **codebase-memory-mcp, serena, figma-remote, figma-desktop, mcp-search (claude-mem plugin), context7, playwright, notion-mcp** — 8 servers, not counting `claude_ai Claude Docs`, which is a claude.ai connector, not something in any of the config files above (it showed up as an available deferred tool in this very session, unrelated to the owner's own mcp.json).

### A.2 Usage evidence, last 30 days (local, exact counts)

I did **not** grep for the string `mcp__<name>__` alone — that string also appears once per session in every request's tool-definition list (the tool schemas Claude Code sends the model each turn), so a naive count massively overstates usage. I instead anchored on the literal JSON shape of an actual invocation:

- Claude Code transcripts: `{"type":"tool_use","id":"...","name":"mcp__<server>__<tool>"`
- Codex sessions: `"name":"<tool>","namespace":"mcp__<server>"`

Scope: `~/.claude/projects/*/*.jsonl` modified in the last 30 days (**3,395 files**, out of 4,719 total), and `~/.codex/sessions/**` modified in the last 30 days (**58 files**, out of 62 total).

| Server | Claude Code: real tool_use calls (30d) | Claude Code: distinct sessions with ≥1 call | Codex: real calls (30d) | Codex: distinct sessions |
|---|---|---|---|---|
| `codebase-memory-mcp` | 12 (3× `trace_path`, 3× `search_graph`, 3× `list_projects`, 2× `get_code_snippet`, 1× `check_index_coverage`) | 3 | 0 | 0 |
| `serena` | 3 (1× `get_symbols_overview`, 1× `find_symbol`, 1× `find_referencing_symbols`) | 1 | 4 (all `initial_instructions` — the mandatory onboarding call, no actual symbol tool ever invoked) | 3 |
| `mcp-search` (claude-mem) | 4 (2× `search`, 2× `get_observations`) — notably reached via `ToolSearch` selecting it first, i.e. Claude Code's deferred-loading path was actually exercised | 3 | n/a (Claude Code plugin only) | n/a |
| `figma-remote` / `figma-desktop` | 0 | 0 | n/a | n/a |
| `context7` | n/a (not configured for Claude Code) | n/a | 0 | 0 |
| `playwright` | n/a | n/a | 0 | 0 |
| `notion-mcp` | n/a | n/a | 0 | 0 |

Total real MCP tool invocations across every configured server, both harnesses, 30 days: **23 calls, across roughly 6,000 combined transcript files.** `~/.local/state/jig/guard-audit.jsonl` (4.0 MB, the closest thing to an "audit.jsonl" — no separate `audit.jsonl` file exists) records the guard's own lifetime history and shows only **4 mcp__ entries ever** (`mcp__serena__replace_content` ×2, `replace_symbol_body` ×1, `find_symbol` ×1) — consistent with the transcript count, not contradicting it.

**Reading this:** `codebase-memory-mcp` gets used, thinly, for read-only graph queries. `serena` is essentially only ever onboarded, not used for its actual value proposition (symbolic edits). `mcp-search` gets used a little. `figma-remote`/`figma-desktop`/`context7`/`playwright`/`notion-mcp` were not called even once in 30 days despite being configured and, for the figma pair, loaded into every single Claude Code session's tool list.

---

## Part B — four lenses on the servers already configured

### B.1 Vendors

- **Claude Code's own MCP doc** (`https://code.claude.com/docs/en/mcp.md`, direct fetch): Claude Code ships **tool search, on by default**, which defers loading MCP tool schemas — the model calls a `ToolSearch` tool instead of receiving every MCP tool definition up front. It also caps MCP tool output: a warning above 10,000 tokens, hard default ceiling 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS` env var to raise it), with oversized results spilled to a file under `~/.claude/projects/.../tool-results/` and replaced in-context by a path reference. Servers can raise their own ceiling per-tool via `_meta["anthropic/maxResultSizeChars"]`, up to 500,000 characters. The doc's own framing for *when* to add a server: "Connect a server when you find yourself copying data into chat from another tool, like an issue tracker or a monitoring dashboard" — i.e., it is framed around external-system integration, not internal codebase inspection.
- **Anthropic's engineering post on tool search** (`https://www.anthropic.com/engineering/advanced-tool-use`, direct fetch): concrete numbers — a stack of GitHub (35 tools, ~26K tokens) + Slack (11 tools, ~21K tokens) + Sentry/Grafana/Splunk (~5K more) runs to ~55K tokens for 58 tools; Anthropic says internally "tool definitions consume 134K tokens before optimization." With the tool-search approach, they measured **191,300 tokens preserved vs 122,800 with the traditional approach (≈85% reduction)**, and task accuracy moving from 49%→74% (Opus 4) and 79.5%→88.1% (Opus 4.5) on the affected benchmark. This is Claude-Code/Claude-API-specific — **Codex has no equivalent mechanism** (see next point), so the same GitHub-MCP-style bloat this post describes is not mitigated there.
- **Codex's MCP doc** (`learn.chatgpt.com/docs/extend/mcp?surface=cli`, direct fetch after a 308 redirect from `developers.openai.com/codex/mcp`): no tool-search/deferred-loading equivalent is documented. It offers per-tool `output_token_limit` (with a "standard 20% serialization allowance" default), `startup_timeout_sec` (10s default), `tool_timeout_sec` (60s default), and `enabled_tools`/`disabled_tools` allow/deny lists — i.e., cost control is manual (curate which tools are exposed), not automatic.
- **`serena` README** (`raw.githubusercontent.com/oraios/serena/main/README.md`, direct fetch): positions itself as "the IDE for your coding agent," symbol-level (not line/text) retrieval/edit/refactor across 40+ languages via LSP backends; claims cross-file renames that would be "8–12 careful, error-prone steps" collapse into one call. No token numbers given. Notably does **not** claim to be unnecessary when native IDE/LSP tooling exists — it targets agent workflows specifically, i.e. it doesn't concede the native-equivalent question at all.
- **`codebase-memory-mcp` README** (`raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/README.md`, direct fetch): "fastest and most efficient code intelligence engine for AI coding agents," 17 MCP tools, single static binary, no LSP process, 162 languages via tree-sitter (11 with "hybrid LSP" type resolution). Its own benchmark claim: **"Five structural queries consumed ~3,400 tokens via codebase-memory-mcp versus ~412,000 tokens via file-by-file grep exploration — a 99.2% reduction,"** and separately "83% answer quality, 10× fewer tokens, 2.1× fewer tool calls vs. file-by-file exploration" (vendor's own benchmark, not independently reproduced here — mark `[unverified, vendor-sourced]`). Caveat buried in the same doc: graph artifacts committed to git can bloat repo history ("one team reached ~6 GB across ~350 commits").
- **`context7` README** (direct fetch): exists to fix "outdated training data," "hallucinated APIs," and "generic answers for old package versions" by injecting version-pinned docs into the prompt. No token numbers. No comparison to WebSearch/WebFetch offered by the vendor itself.
- **`playwright-mcp` README** (direct fetch): explicitly frames itself as accessibility-tree-based (not screenshots), and — the most decision-relevant vendor admission in this whole survey — **its own docs say a CLI+Skills workflow (not the MCP server) is "better suited for high-throughput coding agents,"** because CLI invocation "avoids loading large tool schemas and verbose accessibility trees into the model context"; the MCP mode is positioned for workflows needing "persistent state, rich introspection, and iterative reasoning," where token cost is secondary. This is the vendor conceding the exact trade-off this whole research task is about.
- **Notion MCP docs** (`developers.notion.com/docs/mcp`, direct fetch): hosted remotely by Notion (OAuth), no token-cost guidance published.
- **Figma MCP docs** (`help.figma.com`, direct fetch): remote server does read+write-to-canvas+codegen; desktop server needs a Dev/Full paid seat; "currently available for free during the beta period," "will eventually be a usage-based paid feature" — i.e., this is a beta, cost model not finalized.
- **claude-mem README** (direct fetch): 5 lifecycle hooks + a background worker + SQLite + a Chroma vector DB, 4 MCP tools designed for a "3-layer" progressive-disclosure pattern claiming "~10x token savings by filtering before fetching details" (search ~50–100 tokens → fetch ~500–1,000 tokens/item). **Does not mention Claude Code's own native memory/auto-compact features at all** — it markets itself as a full replacement layer, not a complement, without acknowledging what's already built in. One line worth flagging on its own merits: it advertises "up to 100% more usage from your plan" via an "observer" that runs "off-plan during a free 30-day trial" — read that as a monetization/ToS-adjacent claim, not a technical one, and treat it with more skepticism than the rest of the README.

### B.2 Practitioners

WebSearch was unavailable this session (budget exhausted); I reached the following through direct WebFetch of Simon Willison's tag page and the specific posts it linked, which is narrower than a full search — flagged in "no precedent found."

- **Geoffrey Huntley**, via Simon Willison, ["Too many MCPs"](https://simonwillison.net/2025/Aug/22/too-many-mcps/) (2025-08-22): "Adding just the popular GitHub MCP defines 93 additional tools and swallows another 55,000" tokens, against a usable window of "something like 176,000 tokens" after system-prompt overhead. His recommendation: "If your coding agent can run terminal commands and you give it access to GitHub's `gh` tool it gains all of that functionality for a token cost close to zero — because every frontier LLM knows how to use that tool already." This is a direct, named, numbered argument against the GitHub MCP server specifically, and by extension against any MCP server that just wraps a CLI the model can already call via Bash.
- **Peter Steinberger**, via Simon Willison, ["Just talk to it"](https://simonwillison.net/2025/Oct/14/agentic-engineering/) (2025-10-14): "I don't have to pay a price for any tools, unlike MCPs which are a constant cost and garbage in my context." Notes GitHub's MCP server token cost dropped from ~50,000 to ~23,000 tokens over time (still non-trivial) versus the `gh` CLI's "zero context tax."
- Both practitioners are specifically reacting to the GitHub MCP server, not to `serena`/`context7`/`codebase-memory-mcp`/`claude-mem` — I did not find a named practitioner post specifically about removing any of *those four*. That's a real gap, not a "no evidence either way" — see "no precedent found."

### B.3 Measured evidence

- Anthropic's own tool-search numbers above (85% context reduction, accuracy deltas) are the only *independently-labeled* benchmark found; they're Anthropic's own internal benchmark, not third-party, but they do carry real numbers and a stated methodology.
- `codebase-memory-mcp`'s 99.2%-token-reduction and "83% answer quality" claims are vendor-sourced only — no independent reproduction found. Mark `[unverified]`.
- No numbers found for `serena`, `context7`, `notion-mcp`, `figma-remote`/`figma-desktop`, or `claude-mem`'s "~10x" claim beyond what's in their own READMEs (already listed in B.1) — "no numbers" from an independent source for all of these.
- Local usage counts (Part A.2) are themselves the strongest measured evidence this record has, because they're this owner's own data, not a vendor's: **23 real invocations across ~6,000 transcript files in 30 days, split across 3 of the 8 configured servers, 5 servers at zero.**

### B.4 In the wild

| Server | Upstream repo | Stars | Forks (network) | Open issues | Last push | Owner type | Note |
|---|---|---|---|---|---|---|---|
| `serena` | `oraios/serena` | 29,704 | 2,024 | 191 | 2026-09-22 | Org | Actively maintained, plausible growth curve for repo age (created 2025-03-23) |
| `context7` | `upstash/context7` | 62,306 | 3,017 | 68 | 2026-09-22 | Org (Upstash) | Well-known, credible org, plausible |
| `playwright` (mcp) | `microsoft/playwright-mcp` | 37,468 | 3,186 | 5 | 2026-09-18 | Org (Microsoft) | Very low open-issue count relative to stars = healthy |
| `codebase-memory-mcp` | `DeusData/codebase-memory-mcp` | 44,103 | 3,604 | 593 | 2026-09-22 (same-day commits) | Individual (Martin Vogel) | **Flag:** repo created 2026-02-24 — 44K stars and 3,604 forks in ~7 months is an outlier growth rate for a niche tool from a non-marquee org. Fork count (harder to fake than stars) and 30 real contributors with daily commit activity argue it's not pure bot-inflation, but the ratio is unusual enough that I would not cite the star count alone as adoption evidence without independent corroboration. `[flagged, not fully verified]` |
| `claude-mem` (mcp-search) | `thedotmack/claude-mem` | 94,443 | 8,350 | 280 | 2026-09-22 | Individual (Alex Newman) | Same flag as above, more extreme: 94K stars in ~13 months from a personal repo. 30 contributors, daily commits, 300 subscribers (a more bot-resistant signal) — real activity, but the star:subscriber ratio (94,443:300 ≈ 315:1) is far outside what organically-grown repos of this size usually show. Treat the star count with explicit skepticism. `[flagged, not fully verified]` |
| `notion-mcp` | Notion-hosted, no public repo to audit | — | — | — | — | — | n/a |
| `figma-remote`/`figma-desktop` | Figma-hosted, no public repo to audit | — | — | — | — | — | n/a |

Adoption via `gh search code` (exact GitHub code-search API counts, not estimates):
- `context7` in files named `.mcp.json`: **4,168** hits
- `serena` in files named `.claude/settings.json`: **589** hits (and separately, "serena start-mcp-server" in `.mcp.json`: 805)
- `playwright-mcp` in `.mcp.json`: **454** hits
- `codebase-memory-mcp` in `.mcp.json`: **108** hits
- `figma.com/mcp` (any file): **7,136** hits
- `notion-mcp`/`figma-remote` as literal strings in `.mcp.json`/`.claude/settings.json` specifically: **0** hits each (the underlying services are adopted — 7,136 figma.com/mcp hits — but not under those exact literal names/paths I searched; treat as a search-term artifact, not as "nobody uses Notion/Figma MCP")

Concrete example repos surfaced (dated, from the `serena` search): `kurrent-io/KurrentDB` (`.claude/settings.json`, installs serena via `git+https://github.com/oraios/serena`), `moraroy/NonSteamLaunchers-On-Steam-Deck`, `AndroidDagashi/AndroidDagashi`, `taikoxyz/taiko-mono` (`packages/taiko-client-rs/.claude/settings.json`), `oxy-hq/oxygen` (installs it as a Claude Code plugin, `serena@claude-plugins-official`, rather than raw MCP config — worth noting as an alternate distribution channel).

**Negative/security evidence for the MCP category as a whole** (via Simon Willison, direct fetch of his own posts):
- [GitHub MCP exploited](https://simonwillison.net/2025/May/26/github-mcp-exploited/) (2025-05-26): prompt injection via a public issue led to private-repo disclosure through the official GitHub MCP server.
- [Supabase MCP lethal trifecta](https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/) (2025-07-06): a database-access MCP server combining private data + untrusted input + exfil path.
- [When a Jira ticket can steal your secrets](https://simonwillison.net/2025/Aug/9/when-a-jira-ticket-can-steal-your-secrets/) (2025-08-09): exfiltration chained through Cursor + MCP + Jira + Zendesk.
- [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (2025-06-16) — Willison's own naming of the pattern behind all three incidents above: **private-data access + exposure to untrusted content + external communication capability, together, in one agent session.** This is the operative framework for judging any *new* MCP server (Part C), especially trackers/databases/anything with write+network capability.

---

## Part C — candidates for a 2026 personal coding harness: worth adding?

Applying the same four lenses to servers **not** currently configured, and re-applying the lethal-trifecta framework as the security screen for anything that combines private-data access with untrusted-content exposure and outbound communication.

### C.1 Candidates surveyed

| Candidate | What it would add beyond built-ins | Context cost (measured) | Maintenance | Adoption | Lethal-trifecta risk |
|---|---|---|---|---|---|
| **GitHub official MCP server** (`github/github-mcp-server`) | Issue/PR/repo operations as typed tools instead of `gh` CLI calls | 93 tools / ~55K tokens (Huntley's measurement, 2025); Steinberger separately measured a later ~23K-token version — still non-trivial, and **Codex/omp/pi/DSH have no tool-search mitigation for this** | 33,122★, 5,032 forks, 338 open issues, pushed 2026-09-21 (Org: GitHub) | Very high | Yes — exactly the incident Willison's lethal-trifecta post uses as its worked example (public issue → private repo → PR-as-exfil) |
| **Official reference servers** (`modelcontextprotocol/servers`: filesystem, git, memory, etc.) | Nothing a coding CLI doesn't already have as a first-class tool (Read/Write/Edit/Bash+git in all 5 harnesses) | Not separately measured — logically redundant, not a token argument | 90,545★, 11,676 forks (Org, official) | Very high overall, but that adoption is dominated by *non-coding* MCP clients (Claude Desktop, etc.), which is exactly the audience these were built for | Filesystem/git tools with agent-driven Bash already present add limited new risk, but add zero new capability either |
| **Sentry MCP** (`getsentry/sentry-mcp`) | Query/triage errors and performance issues from inside the coding session | Not measured | 858★, 149 forks, 120 open issues, pushed today (Org, official) | Moderate | Read-mostly by default, risk depends on scopes granted; no local signal the owner does Sentry-based on-call work through an agent |
| **Linear/Jira-type trackers** | Read/write issues from inside the session | Not measured | n/a — category, not one repo | High as a category | **Yes, directly** — the exact category in Willison's Jira-ticket-steals-secrets post |
| **Database servers (Postgres-type)** | Direct SQL from the agent instead of `psql`/an ORM CLI via Bash | Not measured | n/a — category | High as a category | **Yes, directly** — the exact category in the Supabase lethal-trifecta post; and `psql`/CLI-via-Bash already covers the capability at near-zero context cost, mirroring the GitHub-MCP-vs-`gh` argument |
| **Playwright/browser MCP** (already configured for Codex only, per A.1) | Live browser automation for harnesses with **no native browser tool** | Vendor's own README concedes CLI+Skills is "better suited for high-throughput coding agents" (B.1) | 37,468★, 5 open issues, pushed 2026-09-18 (Org: Microsoft) — healthiest maintenance signal of any server in this survey | High (454 hits in `.mcp.json` searches) | Low by itself (no private-data class access), but write-to-page + outbound network is a live-execution risk class of its own, distinct from lethal-trifecta |
| **context7 / docs server** (already configured for Codex only, per A.1) | Version-pinned docs instead of generic WebSearch | Not measured by vendor; 0 real calls in this owner's own 30-day Codex usage (A.2) | 62,306★, pushed today (Org: Upstash) | Highest adoption count observed (4,168 `.mcp.json` hits) | Low |

### C.2 Ranked shortlist — worth adding (max 5)

Given the evidence above, and given this owner's own usage data (23 real MCP calls across ~6,000 transcripts in 30 days, split thin across servers already configured), the honest shortlist is short. I am not padding it to five.

1. **Playwright MCP, but scoped to the harnesses that have no native browser tool (Codex, omp — pi has no MCP client, so moot; DSH unverified) — not Claude Code.** Claude Code already has `claude-in-chrome` as a first-party skill covering the same job; adding Playwright MCP there would be the same kind of redundancy this whole survey keeps finding elsewhere. For Codex/omp specifically, there is no native equivalent, the vendor is the healthiest-maintained repo in this entire survey (5 open issues against 37K stars, pushed 4 days ago), and it's already half-adopted (configured for Codex, just never called in 30 days — which argues for *keeping it scoped and cheap*, not for expanding it). Verdict: keep as-is (Codex-only), do not add to Claude Code, do not expand further without a concrete task that needs it.
2. **context7, kept exactly as scoped today (Codex only), not expanded, not promoted.** The vendor case (stale training data / hallucinated APIs) is real and unopposed by any negative evidence found, and it's the single most-adopted server in this whole survey by `gh search code` count. But this owner's own 30-day data shows **zero calls**, which is a stronger signal for *this specific harness* than the community's adoption number. Recommendation is "leave it, don't build new wiring around it," not "add it somewhere new."

Nothing else clears the bar. No new server earns a "yes" on this evidence — the pattern across every candidate with a name-brand vendor (GitHub, official reference servers, Sentry, trackers, databases) is the same: the capability is already reachable through Bash/CLI at near-zero context cost, or it falls into the exact risk category two of Willison's own incident write-ups describe, or (Sentry) there's no local signal it would ever get used.

### C.3 Not worth it for a single-user coding harness — with reasons

- **GitHub official MCP server** — 55K (later ~23K) tokens and up to 93 tool definitions for functionality the harness already has via `gh` (which this very research task's Bash tool used dozens of times) at near-zero marginal context cost. Two named practitioners with numbers say this explicitly (B.2). Also the worked example in Willison's lethal-trifecta framework.
- **Official filesystem/git/memory reference servers** — built for MCP clients that don't already have file/shell tools (e.g. Claude Desktop). A coding CLI harness already has Read/Write/Edit/Bash+git as first-class tools; wrapping them in MCP adds a second, slower, more expensive path to the same operation with no new capability.
- **A fourth memory/knowledge-graph server of any kind** — this owner already runs three overlapping memory-ish MCP servers (`codebase-memory-mcp`, `serena`, `claude-mem`'s `mcp-search`) and, combined, called them only 19 times across 30 days and ~6,000 transcripts (A.2). The problem here isn't a missing memory server, it's underused existing ones — adding another compounds the same unused-surface-area problem this whole survey keeps finding, not solves it.
- **Database (Postgres-type) MCP servers** — directly the risk category in the Supabase lethal-trifecta incident (B.4), and the same "CLI already does this for less" argument as GitHub MCP (`psql` via Bash).
- **Linear/Jira/issue-tracker MCP servers** — directly the risk category in the Jira-ticket-steals-secrets incident (B.4). Would need explicit, scoped, read-only configuration to even be considered, and there's no local evidence this owner works issue-tracker-first inside a coding agent session.
- **Sentry MCP** — not a security red flag on the same level as the above (Sentry's own official server, moderate adoption, actively maintained), but there is no local usage signal at all that this owner does observability/on-call work from inside a coding-agent session, so there's nothing to justify the extra always-loaded tool surface.
- **Notion MCP, Figma remote/desktop MCP** — already configured (Notion: Codex only; Figma: Claude Code only) and, per Part A.2, **zero real calls in 30 days for any of them** despite Figma's pair being loaded into the tool list of every single Claude Code session. This is Part A's finding, repeated here because it's directly relevant to "would a 2026 harness be better off adding more of these": the existing ones aren't earning their keep, so the bar for adding siblings in the same category (more design-tool or more workspace-tool servers) should be high.

---

## Summary table

| Source | Task type | Result | Cost numbers | Named failure modes |
|---|---|---|---|---|
| Claude Code MCP docs (vendor, direct) | product doc | tool search defers MCP tool loading by default; output capped at 25K tokens (raisable) | 10K-token warning, 25K default ceiling, 500K hard ceiling for annotated tools | n/a |
| Anthropic advanced-tool-use post (vendor, direct) | internal benchmark | tool search preserves context, raises accuracy | 55K tokens/58 tools example; 191,300 vs 122,800 tokens (≈85% reduction); 49%→74% / 79.5%→88.1% accuracy | n/a |
| Codex MCP docs (vendor, direct) | product doc | no deferred-loading equivalent; manual `enabled_tools`/output-limit controls only | 20% serialization allowance default; per-tool `output_token_limit` | n/a |
| Geoffrey Huntley via Willison (practitioner, direct) | coding-agent context budget | GitHub MCP dominates context vs `gh` CLI | 93 tools / 55,000 tokens vs "close to zero" for CLI | "too many MCPs" |
| Peter Steinberger via Willison (practitioner, direct) | coding-agent context budget | same conclusion, later measurement | GitHub MCP ~23,000 tokens (down from ~50,000) vs CLI's "zero context tax" | "MCPs... constant cost and garbage in my context" |
| `codebase-memory-mcp` README (vendor, direct) | vendor benchmark, unverified | claims 99.2% token reduction vs grep | ~3,400 vs ~412,000 tokens (5 queries) | `[unverified, vendor-sourced]` |
| This owner's own transcripts (measured, local, exact) | real 30-day usage | 23 real MCP calls total across 8 configured servers, ~6,000 transcript files | n/a | 5 of 8 configured servers: 0 calls |
| Willison, GitHub MCP exploited / Supabase / Jira posts (in the wild, direct) | security incident reports | lethal-trifecta pattern in 3 separate real MCP servers | n/a | prompt injection → private-repo/DB/ticket-system data exfiltration |
| `gh api`/`gh search code` (in the wild, direct) | adoption + maintenance | star/fork/issue counts, `.mcp.json` code-search hit counts | see B.4 table | 2 outlier star-growth repos flagged, not fully verified |

## Verdict, in plain language

What the evidence supports: almost everything this owner has configured is either barely used or entirely unused, and the categories most tempting to add next (GitHub, trackers, databases) are the exact categories with the strongest documented cost or security downsides for a coding-agent harness. The one server whose own vendor concedes it isn't ideal for a "high-throughput coding agent" (Playwright) is also the one with the healthiest maintenance signal in this whole survey — that's not a contradiction, it just means it's well-built for a narrower job (persistent browser state, QA-style interaction) than "every coding agent should have it." `context7` is the most broadly adopted server surveyed and has no negative evidence against it, but this owner's own data says it isn't being used, which matters more for a one-line `mcp/` source-list decision than community adoption does.

What it does not support: a confident "drop everything" or "keep everything" call for the four servers already doing *some* real work (`codebase-memory-mcp`, `serena`, `mcp-search`/claude-mem) — 19 combined calls in 30 days is thin, but it's not zero, and I found no named practitioner post specifically evaluating any of those four the way Huntley/Steinberger evaluated GitHub's server. That's a real gap in the practitioner lens (see below), not a "no evidence" verdict either way.

What's missing: independent (non-vendor) benchmarks for `serena`, `context7`, `codebase-memory-mcp`, and `claude-mem`'s own token-savings claims; a named practitioner take on any of the four servers actually in use here; and DSH's own MCP configuration, which the task named but which wasn't found in the paths checked.

## No precedent found

- No named practitioner (2026) post found specifically reviewing `serena`, `codebase-memory-mcp`, `context7`, or `claude-mem` and recommending keeping or dropping them — the practitioner lens here is limited to Willison's own posts and what they link to, because WebSearch was unavailable this session.
- No independent reproduction of `codebase-memory-mcp`'s 99.2%-reduction claim or `claude-mem`'s "~10x" claim.
- No DSH MCP configuration found in the paths the task named (`domains/dev/config/` has no `dsh/mcp*` file in this sweep) — not confirmed absent, just not found where the other four harnesses' configs live.
- No number for MCP-server latency (only context-cost and accuracy numbers were found).
- Could not confirm whether the exact "when did Claude Code's tool-search become default" question — the docs say "enabled by default" today but not since when, so I can't date-bound the Huntley/Steinberger critiques against it precisely.
