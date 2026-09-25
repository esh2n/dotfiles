---
question: "For yoki's three capabilities (correction-driven learning, loop/cron, graph/workflows), what does each of Claude Code, Codex, pi, and DSH provide natively in 2026, and what must remain harness-independent?"
date: 2026-09-22
verdict: "All three capabilities are NATIVE-for-Claude-Code-only with real gaps elsewhere: only Claude Code has native memory, durable unattended scheduling, and a rich (but Claude-model-only) Workflow tool; DSH separately ships a real cross-harness workflow/subagent bridge to Codex and Claude Code with unverified budget/gate/dedupe parity; none of the three capabilities falls within jig's approved guard/tier/compaction judgment scope."
unverified:
  - "GEPA was not independently checked"
  - "Codex CLI's absence of scheduling/memory/orchestration is based on four official docs, not an exhaustive site search (developers.openai.com/codex redirected past what could be re-fetched)"
  - "@earendil-works/pi-durable's actual scope is unverified — its repo 404'd"
  - "@earendil-works/chord (an application-composition runtime) was not investigated — possible gap in this research, not a confirmed absence"
  - "DSH's docs site is JS-rendered and did not yield content via WebFetch; findings rest on GitHub raw README files at master"
  - "two gh search code queries (CronCreate, workflow meta search) hit a 403 rate limit — flagged as rate-limited, not confirmed-empty"
  - "whether DSH's native workflow/subagent primitive matches yoki-graph's hard budget cap, deterministic gate, and dedupe behavior was not verified"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Learning / Loop-Cron / Graph-Workflows: native-harness state and industry standard (2026)

Scope: judge yoki's three capabilities (correction-driven learning, loop/cron,
graph/workflows) on today's merits across **all four harnesses the owner
runs** — Claude Code, Codex CLI, pi (`@earendil-works/pi-coding-agent`), and
DSH (`@deepseek-ai/dsh`, "DeepSeek Harness") — not on continuity with yoki's
design, and not centered on Claude Code alone. A NATIVE recommendation is
valid only where every harness in use has the equivalent; where only some do,
that gap is itself the finding, and the closing section names what must stay
harness-independent because of it.

yoki is being retired outright (memory: `yoki-rebuild-jig`, "yoki は退役する
（確定前提）"). jig's own approved design (`design-v2.md`, "LGTM、進めていい"
2026-09-20) scopes jig to the judgment/policy core (guard, tier routing,
skill/compaction judgment) and does **not** claim learning, loop/cron, or
graph/workflows — confirmed by exhaustive grep in `.tmp-research/yoki-jig-coverage.md`.
That prior decision is context, not the answer — each capability is judged
independently below — but it forecloses "JIG" as an option barring a strong
reason to revisit it; none surfaced.

**Unverified/flagged up front:** GEPA was not independently checked. Codex
CLI's absence of scheduling/memory/orchestration is based on four official
docs (README, AGENTS.md, config.md, getting-started.md), not an exhaustive
site search — `developers.openai.com/codex` redirects to a generic ChatGPT
docs page that WebFetch could not follow. pi's findings rest on
`github.com/earendil-works/pi` + `pi.dev/docs/latest` (sessions + extensions
pages only); `@earendil-works/pi-durable`'s actual scope is unverified (its
repo 404'd) and `@earendil-works/chord` (an "application-composition runtime")
was not investigated — flagged as a possible gap in this research, not a
confirmed absence. DSH's docs site (`deepseek-harness.github.io`) is
JS-rendered and did not yield content via WebFetch; findings rest on GitHub
raw README files at `master`, which are the authoritative primary source
regardless. Two `gh search code` queries hit a 403 rate limit (`CronCreate`,
`"export const meta" workflow`) — flagged as rate-limited, not
confirmed-empty. Prior in-repo research notes under
`~/.claude/projects/.../memory/*.md` were grepped for
Mem0/ACE/GEPA/"memory tool"/"auto-memory" — zero hits; there was no
pre-existing research on these frameworks to verify against.

---

## A. Learning (correction-detect / /learn / /evolve / continuous-learning-v2 / retrospective-codify)

### What legacy does
- `prompt-correction-detect.js` (UserPromptSubmit hook): regex-matches JP/EN
  correction phrases ("違う", "やめて", "wrong", "undo that", ...) in the raw
  prompt text, debounced once per session and capped at 5/day, appends a row
  to `~/.claude/homunculus/corrections.jsonl`, and prints a systemMessage
  suggesting `/learn` or `retrospective-codify`. Its own code comments note it
  reads `UserPromptSubmit`'s normalized `prompt` field the same way across
  every harness this repo targets (Claude, Codex, omp-bridge) — the hook
  itself is harness-agnostic; only the payoff downstream is not.
- `/learn`: a manual command that greps pending corrections, asks the model to
  extract a reusable pattern, runs a holistic quality-gate checklist, and
  saves a skill file to global or project scope.
- `continuous-learning-v2` (SKILL.md, read in full): a confidence-scored
  "instinct" store with project/global scoping and a 2-project-promotion
  rule. Its own doc states plainly: **the automatic observation path (a
  PreToolUse/PostToolUse hook + background observer daemon) is not wired in
  this repo — the daemon was removed 2026-08-15 and nothing has ever fed
  it.** Only the manual CLI (`/instinct-status`, `/evolve`, `/promote`) and
  the correction hook above are live.
- `retrospective-codify` (skill): turns one hard-won correction into an
  enforced artifact — an ast-grep rule, a skill, or a CLAUDE.md rule. This
  step is already effectively harness-independent: it consumes a correction
  (however it was captured) and writes to files the codebase/CLAUDE.md/lint
  config, none of which are Claude-specific.

### Native coverage — four harnesses

| | Claude Code | Codex CLI | pi | DSH |
|---|---|---|---|---|
| Native persistent/auto memory | **Yes** — auto memory, `feedback` type | No — static `AGENTS.md` only | No — single-session persistence only (`~/.pi/agent/sessions/*.jsonl`); no cross-session recall | No — `docs/user/guide/mcp-memory.md`: "No memory server is present in the shipped composition" |
| Extension/plugin path to memory | n/a (native covers it) | None found | `pi-session-recall` exists as a **third-party extension the owner evaluated and rejected** | Opt-in `cordis.patch.yml` overlays (Memorix, MCP Reference Memory, Engram) — default-off, user must self-host; DSH "does not download the server, initialize its database... or supervise it" |
| Correction/feedback capture (not memory) | Same auto-memory pipeline | none | none | `packages/feedback/` captures ratings/remarks but its own README states flatly: "Neither kind of feedback reaches the model — these are signals about the output, never input to it" |

Primary sources: `code.claude.com/docs/en/memory` (fetched in full) — Claude
records four typed notes (`user`, **`feedback`** = "corrections you give
Claude and approaches you confirm", `project`, `reference`) to
`~/.claude/projects/<project>/memory/`, fully automatic, no regex trigger, no
manual distillation step, no daily cap, survives `/compact`. Also checked the
Anthropic API-level **memory tool**
(`platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool`) — a
client-implemented `/memories` file-op primitive, confirming "structured
memory files, client-owned storage" is Anthropic's standard shape generally,
not something specific to the CLI. `github.com/earendil-works/pi`,
`pi.dev/docs/latest/sessions`, `pi.dev/docs/latest/extensions` for pi.
`github.com/deepseek-ai/deepseek-harness` (`packages/feedback/README.md`,
`docs/user/guide/mcp-memory.md`) for DSH.

**Verdict: 3 of 4 harnesses (Codex, pi, DSH) have no native memory or
correction-capture at all.** Only Claude Code does. This is a real
harness-independence gap, not a rounding error.

### Industry standard 2026 — docs + real-world survey

- **Anthropic memory tool / auto memory**: structured, client-owned files —
  the pattern the field is converging on for the "native to one harness"
  case.
- **Mem0** (`mem0.ai`; GitHub `mem0ai/mem0`, **65,773★**, pushed the day of
  this research): "Add → Learn → Retrieve" with a "Memory Compression Engine"
  (hierarchical distillation + multi-signal retrieval), benchmarked on
  LoCoMo/LongMemEval/BEAM. Multi-tenant, infrastructure-grade.
- **Letta** (`letta-ai/letta`, **24,823★**, pushed 11 days before this
  research): another structured, typed-memory-store implementation with
  comparable adoption to Mem0.
- **ACE — Agentic Context Engineering** (arXiv 2510.04618, primary source
  confirmed): frames agent memory as an evolving "playbook" built through
  generation/reflection/curation, explicitly designed to avoid **"brevity
  bias"** and **"context collapse"** — the exact failure modes of a naive
  log-then-LLM-summarize pipeline. Direct, citable evidence that "regex-detect
  correction phrases → append to jsonl → periodically ask an LLM to distill"
  is the naive baseline the field has moved past.
- **GEPA**: not checked — do not cite either way.

**Real-world survey (GitHub, `gh search`, authenticated, working):** two
clearly separated clusters.
1. *Naive log+LLM-distill hobby projects* — yoki's own pattern's peer group:
   `humanplane/homunculus` (391★, last push 2026-01-23 — the exact project
   `continuous-learning-v2`'s skill credits as its inspiration, ~8 months
   stale at time of research), `Luispitik/sinapsis-v1` (39★, **archived**,
   explicitly "Based on ECC v2.1" — same lineage as this repo's dead
   `continuous-learning-v2`), `AlexMikhalev/claude-code-continuous-learning-skill`
   (38★), `QLYYLQ/continual-learning` (4★), `jhammant/continuous-learning`
   (5★). Consistently tiny, several abandoned or archived.
2. *Structured memory infrastructure* — Mem0 and Letta above, 2-3 orders of
   magnitude more adoption, and actively maintained.

**The market has already run this experiment.** The naive pattern exists as a
genre, but it is a hobbyist tail with high abandonment; capital and adoption
concentrate in structured-memory infra. This corroborates ACE's critique with
real usage data, not just a paper's framing.

### Recommendation

1. **correction-detect.js + `/learn` + continuous-learning-v2's instinct
   store/observer machinery → NATIVE for Claude Code (drop there).** Auto
   memory's `feedback` type is a strict, already-shipped superset for
   Claude sessions: automatic, judgment-based rather than regex-triggered,
   documented, and — per the GitHub survey — the naive pattern it replaces
   is exactly the genre that gets abandoned in the wild.
   **Trade-off (the harness-independence gap):** Codex, pi, and DSH get
   **no equivalent** — none of the three has any native memory or
   correction-capture path, and the market evidence says *don't rebuild
   yoki's naive log+distill design to fill that gap* (it's the abandoned
   genre). If cross-harness correction-capture is ever pursued, the sound
   shape is a Mem0/Letta-style structured store wired in front of all four
   harnesses' hook surfaces, not a revival of `corrections.jsonl`. This is
   flagged as a real gap, not silently dropped — see closing section.
2. **retrospective-codify → SEPARATE (keep as its own skill), already
   effectively harness-independent.** It turns a correction into an
   *enforced* artifact (ast-grep rule / CLAUDE.md rule / lint) regardless of
   which harness produced the correction — the one thing no harness's native
   memory feature does. Not jig — jig's design-v2.md scope is
   guard/tier/compaction judgment, not rule/file authoring.

---

## B. Loop / cron

### What legacy does
`scripts/lib/loop/*` (9 files) backs `yoki-loop`: a launchd-based scheduler.
`install` writes a `.plist` and prints (never runs) the `launchctl bootstrap`
command; `run` invokes a headless `codex`/`omp` session with a saved prompt.
Its own code **already refuses `--harness claude`** by name: "Claude Code has
native /loop and scheduled routines, so a headless `claude -p` loop was a
second, unsupported path to the same thing." Even the legacy implementation
concedes the Claude case to native; its remaining scope was always
Codex/omp only.

### Native coverage — four harnesses

| | Claude Code | Codex CLI | pi | DSH |
|---|---|---|---|---|
| Session-scoped scheduling | **Yes** — `/loop`, `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup` | Not found in any official doc checked | **Absent** — extension hook API (~25 events) has none scheduling-related | **Yes, but narrow** — `packages/schedule/` gives `schedule_create`/`schedule_list`/`schedule_delete`; survive restarts |
| Unattended / machine-off durability | **Yes** — cloud Routines (schedule, API webhook, GitHub-event triggers, no local machine needed) | none | none | **No** — README states explicitly: reminders "never leave the session or send email, SMS, or push notifications" — no cross-session daemon, no webhook trigger |
| Min interval | Routines: 1h · Desktop/`/loop`: 1min | n/a | n/a | not specified as sub-session interval, but bounded to the session's lifetime |

Primary sources: `code.claude.com/docs/en/scheduled-tasks`,
`code.claude.com/docs/en/routines` (fetched in full). DSH:
`github.com/deepseek-ai/deepseek-harness/packages/schedule/README.md`,
`packages/jobs/README.md` (background-task tracking within a session, not
scheduling). pi: `pi.dev/docs/latest/extensions` (hook event list has no
timer/wake/recurring-task events).

**Verdict:** Claude Code alone has durable, unattended, cross-machine-state
scheduling. DSH has *native* scheduling but it is session-bound and
explicitly cannot run unattended — materially weaker. Codex and pi have
nothing at all.

### Industry standard 2026 + real-world survey

Scheduling has moved **into** the harness for the harness's own sessions —
Claude Code's three tiers (session/desktop/cloud) cover what a
harness-external launchd/cron script used to fake. A harness-external
scheduler remains standard only for the genuinely harness-external case.

**Real-world survey (GitHub):** `ScheduleWakeup`/`CronCreate` code search
surfaced reverse-engineering docs and a judgment-layer skill
(`coreyhaines31/makerskills`'s "loopify" — chooses between native primitives,
structurally the same "judgment layer over native primitives" shape jig
itself takes — a useful pattern reference, not evidence either way for
cross-harness need). Cross-harness scheduling **does exist in the wild and is
being actively built right now**: `dennisadriaans/openrun` (28★, "Schedule
Claude Code, Codex, Grok and Gemini like cron jobs"), `mblua/AgentsCommander`
(12★, explicitly lists pi among supported agents), `dork-labs/dorkos` (10★,
Claude Code+Codex+OpenCode on a schedule) — all pushed within the survey
week. Single-harness schedulers are bigger (`JKHeadley/instar` 80★,
`vinhnguyenthanhdn/claude-jobs` 65★) but stay Claude-only. **The cross-harness
niche is real but immature — nothing over 30★, no consolidation winner.**

### Recommendation

**NATIVE for Claude Code (drop yoki-loop's Claude path — already dead code,
refused by name).** **SEPARATE, harness-independent scheduler for Codex + pi
+ DSH's unattended case** — not jig (pure plumbing/mechanism, not a
policy-judgment concern per jig's approved scope). Three of four harnesses
need this covered externally: Codex and pi have zero native path; DSH's
native `schedule` tool only covers in-session reminders, so unattended/
headless DSH runs still need an external cron/launchd wrapper the same way
Codex does.
**Trade-off:** the GitHub survey shows this niche is real but young and
unconsolidated (nothing above 30★) — reasonable to keep a thin wrapper
(yoki-loop, narrowed: drop omp now that it's retired, keep Codex/pi/DSH), but
also reasonable to evaluate adopting one of the small OSS cross-harness
schedulers (`openrun`, `AgentsCommander`) instead of maintaining bespoke
launchd-plist code — no clear winner exists yet to defer to.

---

## C. Graph / workflows

### What legacy does
`scripts/lib/graph/*` (20 files) backs `yoki-graph`: a full multi-agent
workflow engine. Scripts export `meta` + a script body using injected globals
(`agent`, `parallel`/`pipeline`, `phase`, `log`, `runInfo`), executed against
`codex`/`omp`/`deepseek`/`local`/`mock` backends. Distinctive machinery read
directly from `budget.js`, `gate.js`, `API.md`:
- **Configurable per-run caps** (`maxAgentCalls`, `maxTokens`, `maxWallMs`),
  hard-failing on breach.
- **`opts.gate`**: a shell command deciding pass/fail by exit code —
  deliberately not left to the model's own judgment.
- **`--resume`**: index-ordered prefix replay across any backend.
- **`opts.backend`/`opts.role`**: the explicit mechanism for running the
  *same* script against Codex or omp.
- 9 catalog workflow scripts (review/research/implement/preflight/
  design-review/acceptance/code-study/deliberate/stocktake) plus a
  `go-optimize` pack workflow.

### Native coverage — four harnesses

| | Claude Code | Codex CLI | pi | DSH |
|---|---|---|---|---|
| Native multi-agent orchestration primitive | **Yes** — Workflow tool: `agent()`/`parallel()`/`pipeline()`/`phase()`, schema-validated output, resume | **No** — nothing found in README/config.md/AGENTS.md/getting-started.md | **No** — Extensions docs explicitly state extensions **cannot spawn subagents or parallel agent instances**; only sequential continuations | **Yes, and substantial** — `packages/workflow/` (model-authored orchestration scripts via sandboxed PTC Node runtime) + `packages/subagent/` (fresh child, history-seeded child, or **out-of-process child backed by ACP, Codex, or Claude Code**) |
| Cross-harness reach | None — confirmed explicitly Anthropic-model-only across every listed surface (API, Bedrock, Google Cloud Agent Platform, Microsoft Foundry) | n/a | n/a | **Bridges to Codex and Claude Code natively** as subagent backends — the one harness in this set that already ships a real cross-harness orchestration primitive |
| Budget caps / deterministic gate / dedupe | Structural caps (16 concurrent / 1000 agents / 4096 items/parallel) + *advisory* cost warnings only — no scriptable hard budget gate; no exit-code-style deterministic gate found; no built-in dedupe primitive | n/a | n/a | Not verified this pass — DSH's workflow/subagent existence is confirmed, but whether it has an equivalent to `opts.gate`/`budget.js`'s hard caps was not checked; **flagged as a follow-up** |

Primary sources: `code.claude.com/docs/en/workflows` (fetched in full).
`pi.dev/docs/latest/extensions`. `github.com/deepseek-ai/deepseek-harness`
(`packages/workflow/README.md`, `packages/subagent/README.md`) — Cordis
confirmed as a general "everything-is-a-plugin" framework
(`@deepseek-ai/cordis`), not narrowly a hook bridge; every DSH capability
(schedule, workflow, subagent, feedback, goal, jobs) is itself a cordis
plugin.

**This is the single most important finding of this research pass:** one of
the owner's four harnesses (DSH) already ships, natively, a real cross-harness
orchestration primitive that talks to Codex and Claude Code as child
runtimes — the exact capability yoki-graph was hand-built to provide. It is a
"developer preview" and its budget/gate/dedupe parity with yoki-graph is
unverified, but its existence changes the shape of the recommendation below.
Note also: DSH's subagent backends are named explicitly as ACP, Codex, and
Claude Code — **pi is not listed**, so pi remains outside even DSH's bridge.

### Industry standard 2026 + real-world survey

**Real-world survey (GitHub) — the strongest signal in this whole research
pass:** `gh search repos "multi-agent workflow" claude codex` and a
cross-harness variant returned a crowded, active field, nearly all pushed
within the survey week: `Suraj1235/open-dynamic-workflows` (38★) explicitly
describes itself as "the script-as-orchestrator engine behind Claude Code
dynamic workflows & ultracode, for OpenCode, Codex, Antigravity & VS Code" —
i.e., someone is already doing precisely what yoki-graph claims (porting the
native Workflow script shape cross-harness) as a dedicated open-source
project. `getpipher/armory-fleet` targets **pi** specifically.
`xxxoooxoxo/wiff` (5★, self-described "harness-agnostic, deterministic,
resumable"). `Skyzzzfq/cross-harness-agent-orchestrator` (0★, brand new,
Codex-focused). `ZibbyDev/agent-workflow` (7★). `Neko-Catpital-Labs/Invoker`
(18★). `Mng-dev-ai/agentrove` (327★, broadest scope — a full multi-tool
workspace, not primarily a workflow-script port).

**Verdict: cross-harness workflow orchestration is a real, currently-forming
2026 niche with many independent entrants — the opposite of "nobody needs
this."** It has not consolidated (nothing above ~330★, most under 40★), so
yoki-graph's founding premise is validated as directionally correct, just not
yet a solved or standardized industry problem — and, per the DSH finding
above, one of the owner's own four harnesses already ships a native attempt
at it.

### Gap analysis (native Workflow tool, Claude-only case)
- **Cross-harness portability**: none — Claude-model-only across every listed
  surface.
- **Configurable budget caps**: structural limits + advisory warnings only,
  no scriptable hard ceiling.
- **Deterministic gate**: no primitive equivalent to `opts.gate`
  (exit-code pass/fail distinct from a model's self-report).
- **Dedupe**: no built-in cross-agent finding-dedupe primitive documented.
- **Resume**: parity — index-ordered prefix replay, same principle as
  yoki-graph's `--resume`, scoped to one Claude Code session/account.

### Recommendation

**NATIVE for the Claude-only case (drop yoki-graph's Claude path).** The
native Workflow tool has a richer runtime there (live progress UI,
prompt-cache-aware fan-out, usage-limit-aware pausing, save-as-command,
plugin distribution) and matches yoki-graph's script shape closely enough
that no capability is lost for Claude-only runs.

**For the cross-harness case, SEPARATE is still warranted — but re-scope the
target before building.** Codex has zero native orchestration and pi's
extension model structurally forbids subagent spawning, so both remain
orchestration islands that need an external layer to be included in any
multi-harness graph at all. Given that, two live options instead of one:
(a) keep maintaining yoki-graph's own engine (budget caps, deterministic
gate, cross-backend resume all remain real, unmatched value-adds versus
every native alternative checked), narrowed now that omp is retired to
Codex (+ pi as an opaque single-call participant, since pi cannot host a
subagent tree of its own); or (b) **evaluate DSH's native workflow/subagent
system as the cross-harness hub instead**, since it already bridges to Codex
and Claude Code out of process, is under active upstream development (unlike
yoki-graph, which is retiring with yoki), and matches the exact pattern the
GitHub survey shows the wider ecosystem converging on. Option (b) has an open
question this research did not close: whether DSH's native primitive matches
yoki-graph's hard budget cap / deterministic gate / dedupe behavior — verify
before committing.
**Trade-off:** with omp retired, yoki-graph's original two-backend rationale
is already halved; the DSH finding raises the real possibility that the
cross-harness need is better met by leaning on a harness that already does
this natively than by continuing to hand-maintain a bespoke wrapper CLI. Not
jig either way — jig's approved scope is guard/tier/compaction judgment, not
multi-agent orchestration.

---

## Summary table

| Capability | Claude Code | Codex CLI | pi | DSH | Recommendation | Key trade-off |
|---|---|---|---|---|---|---|
| A. Learning | Auto memory `feedback` type — native, automatic | Static AGENTS.md only | No memory; rejected `pi-session-recall` extension | No memory; opt-in unmanaged MCP memory overlays only | **NATIVE** (Claude only) / **SEPARATE** (retrospective-codify, already harness-agnostic) | 3 of 4 harnesses have zero native memory; market evidence (Mem0/Letta vs. abandoned hobby projects) says don't rebuild yoki's naive design to fill that gap |
| B. Loop/cron | `/loop` + cron tools + cloud Routines (durable, unattended) | Nothing found | Nothing found | Native but session-scoped only, no unattended/webhook capability | **NATIVE** (Claude) / **SEPARATE, harness-independent** (Codex + pi + DSH's unattended case) | Cross-harness niche real but immature in the wild (<30★, no consolidation) |
| C. Graph/workflows | Workflow tool — rich, Claude-model-only | Nothing found | Extensions explicitly cannot spawn subagents | **Native workflow + subagent bridge to Codex and Claude Code** | **NATIVE** (Claude-only runs) / **SEPARATE** (cross-harness — either narrowed yoki-graph or DSH's native bridge, unverified which is better) | DSH already ships a real cross-harness orchestration primitive; GitHub survey shows this niche is real and actively forming industry-wide, just unconsolidated |

None of the three land on **JIG**: jig's approved `design-v2.md` scope is the
guard/tier/compaction judgment core, and none of these three capabilities is
a policy-judgment concern in that sense.

---

## What must be harness-independent because at least one harness lacks it natively

This is the direct answer to "is yoki-graph's (and by extension yoki-loop's
and the correction-hook's) cross-harness premise real, or is native coverage
in one harness enough."

1. **Learning/memory.** Only Claude Code has native memory. Codex, pi, and
   DSH have none — DSH's own docs state this most bluntly ("No memory server
   is present in the shipped composition," feedback "never reaches the
   model"). **A harness-independent layer is required if correction-capture
   parity across all four harnesses matters at all** — but the GitHub survey
   is clear that yoki's own shape (regex hook → jsonl → manual LLM distill)
   is the specific design the market has already tried and mostly abandoned.
   If this gap is worth closing, close it with a structured memory store
   (Mem0/Letta-shaped) in front of all four harnesses' hook surfaces, not a
   revival of `corrections.jsonl`. `retrospective-codify` is the one piece of
   the legacy design that is *already* harness-independent (it consumes a
   correction regardless of source) and needs no rebuilding.

2. **Loop/cron.** Only Claude Code has durable, unattended, machine-off
   scheduling. DSH's native scheduling is real but session-bound (no
   unattended path); Codex and pi have nothing. **A harness-independent
   scheduler is required to cover Codex, pi, and DSH's unattended/headless
   case** — this is exactly yoki-loop's remaining, narrowed niche
   (Codex/pi/DSH, omp dropped since retired). The GitHub survey confirms
   real but young external demand for this (`openrun`, `AgentsCommander`,
   `dorkos`, all <30★, all built within the last week of this research) —
   validating the niche without yet crowning a winner to adopt instead of
   building.

3. **Workflows/orchestration.** Only Claude Code and DSH have a native
   multi-agent primitive; Codex has none, and pi's extension model
   structurally cannot host a subagent tree at all (confirmed in its own
   docs, not just inferred from omission). **A harness-independent
   orchestration layer is required for any workflow that must include Codex
   or pi** — Codex as an orchestration island with no native alternative,
   pi as a harness that can only ever be an opaque single-call leaf, never an
   internal orchestrator. The one genuine surprise of this research is that
   DSH already ships a working answer to part of this (bridging to Codex and
   Claude Code natively) — meaning the harness-independent layer the owner
   needs may already partly exist inside one of their own four harnesses,
   rather than requiring a full yoki-graph rebuild from scratch. pi still
   falls outside that bridge and would need to be wrapped as an opaque call
   regardless of which orchestrator (yoki-graph-successor or DSH) is chosen.
