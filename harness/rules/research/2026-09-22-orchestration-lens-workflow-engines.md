---
question: "What does decades of workflow-engine / durable-execution practice (Airflow, Temporal, Step Functions, LangGraph) say about scripted orchestration of AI coding agents?"
date: 2026-09-22
verdict: "Explicit orchestration is validated only for the deterministic scaffolding around agent steps - hard time/step budgets, deterministic gates, fan-out/fan-in, dedupe/idempotency, checkpointed resume, human-approval callbacks - never as a substitute for, or an encoding of, the agent's own reasoning. The field's answer to how to express this in 2026 is thin durable code over a few primitives (record-once activities, replay-based workflow code), not a rich graph/DSL. Cost/token budgeting and idempotency of non-deterministic LLM steps are genuinely unsolved problems this field has not answered for anyone."
unverified:
  - "Prefect's 'negative engineering' framing - could not fetch the primary source this session, stated from an established secondary characterization"
  - "Restate's own narrative claims about durable execution for agents - the repo evidence is solid but the blog-post claims were not independently fetched"
  - "The characterization of 'hidden control flow' as a named cost in Temporal's own materials is this lane's inference from Temporal's stated alternative, not a directly quoted claim"
  - "Dagster's 'why not task DAGs' framing came from a blog retrospective rather than current docs"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Orchestration lens: what workflow-engine / durable-execution practice says about scripted AI-agent orchestration

Scope: this lane judges explicit, script-defined orchestration of AI coding agents (phases,
parallel lanes, pipelines, gates, budgets, resume) purely from the workflow-engine /
distributed-systems angle — decades of DAG orchestration (Airflow, Step Functions, Argo) and
durable execution (Temporal, Restate, LangGraph checkpointing). No vendor-guidance or academic
angle, no reference to any of the owner's own tools.

Search budget note: this session's WebSearch quota was exhausted before this lane could run any
searches (shared budget across the whole conversation's other lanes). All findings below come
from `WebFetch` against known primary-source URLs and `gh search repos`, per the fallback
instruction. Several fetches 404'd (Prefect's "negative engineering" post — not found at the
URLs tried, including Wayback, which WebFetch cannot reach; Restate's agent-workflow guide;
Dagster's own "why not task DAGs" post came from a blog retrospective rather than current docs).
Those gaps are flagged inline as unverified/secondhand rather than silently dropped.

---

## 1. What the workflow-engine world learned about when explicit orchestration is right

**Airflow: DAGs are for scheduled, topologically-stable batch work, not dynamic control flow.**
Airflow's own docs are explicit that the *topology* of a DAG — not just its parameters — is
meant to be an author-time decision, not a runtime one:

> "we advise you to try and keep the *topology* (the layout) of your Dag tasks relatively
> stable" — dynamic DAGs are positioned as useful mainly "for dynamically loading configuration
> options or changing operator options," not for branching control flow decided by task output.
> ([Airflow docs — DAGs](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html))

The DAG "doesn't care about *what* is happening inside the tasks; it is merely concerned with
*how* to execute them" — i.e., Airflow's abstraction is a scheduling/dependency graph over
opaque, assumed-idempotent, assumed-deterministic units of work run on a data interval. This is
the classic batch-ETL shape: known task set, known edges, retried on failure, re-run on the same
inputs produces the same graph.

**Temporal: durable execution replaces the graph with "workflow as code," because the graph was
never the hard part — crash recovery and retry boilerplate were.** Temporal's positioning
explicitly names the alternative-to-DAGs problem:

> "Without that guarantee, a crash loses the state of an in-flight process. Recovering it takes a
> state table, checkpoint columns, a reconciliation job, and retry logic at every call site — code
> that has nothing to do with the problem you set out to solve." Temporal's answer: "A Workflow is
> your business process defined in code, with each step written as ordinary control flow: loops,
> conditionals, and function calls." "Temporal is not a no-code Workflow engine. You write
> Workflows in your own language, editor, and version control, and you keep the control flow of a
> normal program."
> ([Temporal docs — Understanding Temporal](https://docs.temporal.io/evaluate/understanding-temporal))

Mechanically: Workflow code must be **deterministic**; all non-deterministic or I/O work (LLM
calls, tool calls, HTTP) is pushed into **Activities**, which get independent retry policies,
timeouts, and heartbeats. Crash recovery works by replaying the deterministic Workflow code
against a durable **Event History** log to reconstruct state — not by re-executing side effects.
**Worker Versioning** lets in-flight executions keep running on the code version they started
with while new executions pick up new code — this is the field's answer to "what happens to a
run in flight when you change the graph," a problem DAG systems mostly punt on.

**Prefect's "negative engineering" framing (unverified — could not fetch primary source this
session; stating from established secondary characterization, flag accordingly):** Prefect
popularized the idea that most orchestration code is *negative engineering* — retries, timeouts,
alerting, state tracking, backfills — work that exists purely to handle the ways a pipeline can
fail, not the business logic itself. The implication for this research question is directly
relevant even unverified-in-primary-source: **the orchestration layer's job is to absorb failure
handling generically so task/step authors don't hand-roll it**, not to encode business branching
logic as a graph. Treat this paragraph as directionally correct but not independently confirmed
by primary source in this pass.

**Dagster: task-DAG systems answered "did the job run," not "is the data right" — hence
asset-oriented orchestration.** From Dagster's software-defined-assets material:

> Traditional task/DAG orchestrators "operate at the task level, not the asset level. As a
> result, they provide insight into pipeline status but not the state of the underlying assets we
> actually care about." Without asset-level reconciliation, teams resort to "simple
> schedule-based materialization" that causes wasteful recomputation, and "maintaining a
> monolithic DAG to capture all dependencies" becomes an organizational bottleneck.
> ([Dagster — Software-Defined Assets](https://dagster.io/blog/software-defined-assets))

The generalizable principle: **a DAG of *tasks* is the wrong unit of truth when what stakeholders
actually care about is the state of *outputs***. This maps onto agent orchestration as a caution:
a graph of "phases ran" is not the same claim as "the deliverable is correct" — which is exactly
why deterministic **gates** (exit-code/assert checks) matter more than the graph shape itself.

**Cross-cutting principles extracted:**
- **Static topology ↔ deterministic, replayable steps.** Graph engines earn their reliability
  guarantees (retry-to-same-state, replay, versioning) only because the steps are assumed
  idempotent/deterministic. That assumption is the foundation the whole DAG-orchestration
  reliability model sits on.
- **Durability is a runtime property, achieved by event-sourcing + replay, not by the graph
  shape.** Temporal separates "what happened" (Event History) from "what to do next"
  (Workflow code), so crash recovery never re-runs side effects, only re-derives state.
- **Idempotency and retries belong at the step/activity boundary, not the orchestrator core.**
  Every engine surveyed (Airflow operators, Temporal Activities, Step Functions Tasks, Argo
  templates) pushes retry policy to the individual unit of work, with the orchestrator supplying
  policy (backoff, max attempts, timeout) generically.
- **Human-in-the-loop and long external waits are a first-class, solved primitive** — not a hack
  — via callback/token patterns (see §3).
- **Versioning of in-flight runs is a known hard problem** with a known answer (Temporal Worker
  Versioning: old runs finish on old code, new runs start on new code) — DAG systems (Airflow)
  are weaker here because they mostly assume you don't change a DAG's topology while it's
  mid-flight.

---

## 2. Is "graph" (nodes/edges) the right abstraction, or does the field prefer "just write code with durable primitives"?

The field has visibly bifurcated, and the split correlates with *how dynamic the control flow
needs to be*:

- **Batch/ETL-shaped work (fixed task set, data-interval driven, mostly deterministic order)** →
  graph abstraction wins on debuggability: you can look at the DAG and know what will run. This
  is Airflow/Argo/Step-Functions-as-state-machine territory.
- **Long-running, branchy, externally-triggered, or agentic work** → the field's most influential
  recent voice (Temporal) explicitly argues *against* the graph as the programming model and
  *for* plain code with durable primitives layered underneath:

> "You write Workflows in your own language, editor, and version control, and you keep the
> control flow of a normal program." ([Temporal docs](https://docs.temporal.io/evaluate/understanding-temporal))

Temporal's stated costs of the graph/DSL approach (paraphrased from its own positioning, which
frames itself as the alternative): a declarative graph pushes branching logic either out of the
tool (into a DSL with its own conditionals, which just reinvents a worse programming language) or
requires per-node code with control flow hidden in edges/conditions rather than visible in one
place. The debuggability cost of graphs specifically shows up as: **control flow that lives in
edges and conditional-transition config is harder to step through, diff, and code-review than
control flow that lives in a function body.** This is a real, named trade-off, though I could not
find a Temporal doc stating it in exactly those terms — treat "hidden control flow" as this lane's
inference from Temporal's stated alternative, not a directly sourced quote.

**LangGraph is the interesting middle case**, and it matters most for this question because it is
graph-shaped *and* durable, and increasingly runs *on top of* Temporal rather than instead of it.
From LangGraph's persistence docs: it checkpoints "graph state snapshots" scoped to a thread,
supporting conversation continuity, human-in-the-loop pauses, "time travel" (inspecting/rewinding
to prior checkpoints), and fault tolerance via `thread_id`-keyed resume. Temporal's own blog post
"The thread is the Workflow" describes wrapping LangGraph so that **the graph is the
business-logic layer and Temporal is the durability layer underneath it** — LangGraph's
checkpointer is backed by Temporal's Event History without the agent code knowing:

> "The agent application only knows that it has a LangGraph checkpointer... What it doesn't know
> is that its entire existence is, under the covers, a Temporal Workflow."
> ([Temporal blog — The thread is the Workflow](https://temporal.io/blog/manetu-the-thread-is-the-workflow))

This is strong evidence for a specific answer to Q2: **the graph and the durability primitive are
separable concerns, and 2025-2026 production integrations are explicitly separating them** — a
thin graph (or even no graph, just code) for the agent's own control flow, with a durable-execution
substrate underneath for crash recovery, retries, and long waits. Nobody in the sources found is
arguing for a *rich*, all-encompassing orchestration graph as the single source of truth for both
business logic and durability — the two are being decoupled.

---

## 3. What agent orchestration needs — solved pattern vs genuinely new

| Need | Solved workflow-engine pattern? | What's new/harder for LLM agents |
|---|---|---|
| Hard budget caps (time) | Yes — `HeartbeatSeconds`, per-task/workflow timeouts are first-class in every engine surveyed (Step Functions `HeartbeatSeconds`, Temporal timeouts, Airflow `execution_timeout`). | Cost caps in *dollars/tokens* have no native primitive in any engine surveyed — timeouts bound wall-clock, not spend. Budget-as-a-resource (stop after $N regardless of time) appears to be orchestrator-layer custom logic in every agent framework found (e.g. `alkaline`'s "token budget" is a bespoke feature, not inherited from a workflow engine). |
| Hard budget caps (cost) | No — not found as a native primitive in Temporal, Step Functions, Airflow, Argo, Dagster docs. | Genuinely new/DIY: token/dollar accounting has to be threaded through by the agent-orchestration layer itself. |
| Deterministic gates (exit-code/assert) | Yes, completely solved — this is exactly what Task-state success/failure, Airflow sensors, and Temporal Activity return values already are. A shell exit code or assertion is a deterministic Activity/Task result like any other. | Nothing new here *if* the gate is genuinely deterministic (tests, lint, exit codes). The new failure mode is teams substituting a model's self-report ("I verified it passes") for the deterministic check — that is a misuse of the pattern, not a gap in it. |
| Model self-report as a gate | N/A — no workflow engine treats a step's own narrative output as its success signal; every engine keys success/failure off a structured return (exit code, exception, explicit token). | This is the one place agent orchestration is tempted to *diverge* from established practice. The durable-execution literature has no precedent for "trust the worker's prose" — its entire reliability model rests on structured, checkable step outcomes. |
| Dedupe / idempotency | Yes, well-solved: Temporal's Workflow ID + Activity idempotency, Step Functions' `SendTaskSuccess` token semantics, Airflow's per-`(dag, task, execution_date)` identity. | Idempotency of an *LLM call* is not free the way an idempotent Activity is — re-running the same prompt is not guaranteed to produce the same result, so "retry = safe" doesn't hold without extra care (caching, request IDs to the model API to dedupe on the provider side, or treating a re-run as a fresh non-deterministic step, not a retry of an old one). |
| Resume-from-checkpoint | Yes — Temporal's Event-History replay and LangGraph's `thread_id`-keyed checkpointer are both mature, documented mechanisms. | New: what counts as "the state to resume" is fuzzier for an agent — is it the last tool result, the full conversation, a compacted summary? Workflow engines checkpoint *variables*; agent state is a growing, semantically lossy context window, which is a different kind of state to snapshot correctly. |
| Fan-out/fan-in of parallel workers | Yes, thoroughly solved — Step Functions `Map`/`Parallel` states, Argo Workflows DAG fan-out, Temporal child workflows all have mature fan-out/fan-in with per-branch retry and result aggregation. | Aggregation logic itself may need to be a judgment call (e.g., "which of 3 parallel agent attempts is best") rather than a deterministic merge/reduce — workflow engines have no built-in primitive for a *qualitative* fan-in decision; that has to be a separate deterministic or human step. |
| Human-in-the-loop / approval gates | Yes, thoroughly solved and old (predates agents entirely) — Step Functions' `.waitForTaskToken` callback pattern is the canonical implementation: a task pauses indefinitely (up to a 1-year quota), with a configurable `HeartbeatSeconds` timeout, until an external call supplies the token via `SendTaskSuccess`/`SendTaskFailure`. ([AWS docs](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)) LangGraph's `interrupt`/checkpoint model and Temporal's Signals serve the same role. | Nothing structurally new — this pattern transfers directly and is already the mechanism agent frameworks reuse (LangGraph human-in-the-loop is explicitly this shape). |
| Compensation / rollback of partial work | Yes — the Saga pattern is a named, decades-old answer (Temporal documents it directly for multi-step workflows: define a compensating action per step, run compensations in reverse order on failure). | New: "compensating" a partially-wrong code edit or a partially-completed agent task isn't as clean as compensating a payment or a reservation — there may be no automatic undo for "the agent already opened a PR" or "already sent a message." Compensation logic has to be authored per side-effect type, same as always, but agent side effects are more varied and less transactional than typical Saga examples (payments, bookings). |
| Versioning a graph mid-flight | Yes — Temporal Worker Versioning is a direct, documented answer (old runs finish on old code, new runs start on new). | Not new for orchestration; but if the *agent's own reasoning/plan* changes shape between runs (not just the harness code), that's a different kind of versioning problem no engine addresses — it's a model-behavior concern, not an infra concern. |

---

## 4. Are teams actually running LLM agents on these engines? (2025-2026 evidence)

Yes, and the integrations are recent and growing quickly as of this pass (Sept 2026):

- **Temporal**: multiple 2026 blog posts confirm active investment — "The thread is the Workflow:
  Durable AI agents without changing Agent code" (wraps LangGraph's checkpointer in a Temporal
  Workflow transparently); "Run durable AI agents on Amazon Bedrock AgentCore with Temporal
  Serverless Workers" (Temporal supplies durability/retries/signals that Bedrock AgentCore's
  managed runtime lacks — "Workflow lifetime is independent of Worker lifetime... A Workflow can
  run or wait far longer than any individual Worker process"); and a funding announcement
  ("Temporal raises $550M ... as demand grows for reliable AI infrastructure," Sept 14 2026)
  citing AI workloads as a demand driver. (all via [temporal.io/blog](https://temporal.io/blog))
- **Restate**: ships a dedicated `restatedev/ai-examples` repo (88 stars) covering agents, A2A,
  and MCP, plus a `restatedev/skills` repo aimed at AI coding agents integrating with Restate, and
  a Google ADK + Restate resilient-agent example. I could not fetch Restate's own "why durable
  execution for agents" blog post this session (404/thin content on the URLs tried) — the repo
  evidence is solid, the narrative-claim evidence is not independently verified here.
- **Inngest**: has an official Codex plugin (`inngest/inngest-codex-plugin`) explicitly to "audit
  codebases and build durable workflows and agents with Inngest," plus numerous community repos
  wiring agentic pipelines (RAG, triage, autoresearch) through Inngest's durable-function model.
- **LangGraph**: durable execution / checkpointing is now documented as core, not
  bolted-on — conversation continuity, human-in-the-loop, time-travel, and fault tolerance are
  named as the four use cases its checkpointer exists for.
- Broader ecosystem signal from `gh search repos "durable execution" agent llm`: a cluster of
  small (0-700 star) but conceptually consistent projects — `Deuz-SDK` (697★, "durable execution,
  ... human-in-the-loop approval"), `prashkn/agent-durable-execution-engine` ("write-ahead
  logging, idempotent tool calls, retries, replayable, resumable"), `davccavalcante/alkaline`
  ("Deterministic replay, retries, cycle detection, a token budget"). The pattern language is
  converging: **replay + idempotent tool calls + token budget + human-in-the-loop**, independently
  reinvented across many small projects — a decent signal of what the field currently believes
  the necessary primitive set is, even though none of these are individually authoritative.

What this reveals about what agent orchestration actually needs: teams are not building new
graph engines for agents — they are **bolting agent loops onto existing durable-execution
runtimes and treating the LLM call as "just another non-deterministic Activity."** The durability
substrate (event log, replay, retries, signals, timeouts) is being reused wholesale; only the
"what runs at each step" logic is agent-specific.

---

## 5. Deterministic-step assumption vs non-deterministic LLM steps

This is the crux, and the sources are consistent on it. Temporal's entire reliability model
depends on Workflow code being deterministic so it can be **replayed** against the Event History
to reconstruct state after a crash — this is stated as a hard constraint, not a preference
("only deterministic code runs in Workflows; external interactions move to Activities"). An LLM
call is definitionally non-deterministic (even at temperature 0, model/infra changes break
byte-identical replay) and expensive to re-run (cost, latency, rate limits) — so it **cannot
live in the deterministic Workflow-code layer**, it can only live in the **Activity layer**: a
non-deterministic side effect whose *result* gets durably recorded once, then treated as fixed
history rather than replayed. This is exactly the "thread is the workflow" design LangGraph +
Temporal ship in 2026: the LLM call and tool calls are Activities (recorded, not replayed); the
surrounding control flow (loop, check budget, decide to continue) is the deterministic Workflow
code, which *can* safely be a plain function with ordinary `if`/`for`, or (per LangGraph) a small
graph, as long as the actual non-deterministic work stays pushed out to the activity boundary.

This directly supports **thinner orchestration over richer graphs** for the non-deterministic
parts specifically: the durable-execution literature does not offer a pattern for "orchestrate
non-determinism," it offers a pattern for **quarantining non-determinism behind a
record-once boundary** and keeping everything else (routing, retries, budget checks, gating)
deterministic and replayable. A rich graph adds value only for the deterministic
scaffolding around the LLM calls (routing, fan-out/fan-in, gates) — it adds no value, and adds
real cost (harder debugging, harder versioning of in-flight runs, a DSL to maintain) if it tries
to also encode the agent's own reasoning/branching, which is exactly the part that's inherently
unpredictable and best left to the agent's own code/prompt rather than to graph edges.

---

## Verdict (this lane only)

**Explicit orchestration is validated, but only for the deterministic scaffolding around agent
steps — not as a substitute for, or an encoding of, the agent's own reasoning.** The
workflow-engine field's collective experience is unambiguous on the shape:

- **What the orchestration layer SHOULD do** (all solved, boring, well-understood patterns, safe
  to build/adopt): enforce hard time/step budgets, run deterministic gates (exit codes, asserts,
  never model self-report), fan out parallel lanes and fan them back in with a defined merge
  step, dedupe/idempotency-key side-effecting calls, checkpoint state at defined boundaries so a
  run can resume without re-doing already-recorded (especially already-paid-for) work, and pause
  cleanly for human approval via a callback/token-style mechanism rather than a busy-wait or a
  re-prompt.
- **What it should NOT do**: encode agent decision-making as graph edges/conditions, assume LLM
  steps are retry-safe/idempotent the way a database write is, treat cost/token spend as covered
  by wall-clock timeouts, or let a model's narrated self-assessment stand in for a deterministic
  check.
- **Shape**: **thin durable-code, not a rich all-purpose graph.** The field's most-cited 2025-2026
  pattern (Temporal running underneath LangGraph, "the thread is the workflow") is explicitly
  a *two-layer* answer — a thin durability substrate (record-once Activities, replay-based
  Workflow code, signals, timers) underneath, with only as much explicit graph/phase structure on
  top as the deterministic scaffolding needs (budget checks, gates, fan-out/fan-in, approval
  points). Cost/token budgeting and idempotency-of-non-deterministic-steps are the two genuinely
  new problems this field hasn't solved for anyone yet — they are not "borrow the DAG-engine
  answer," they have to be designed fresh.

Unverified/flagged items in this report: Prefect's "negative engineering" framing (could not
fetch primary source this session — stated as established but unconfirmed here); Restate's own
narrative claims about durable execution for agents (repo evidence is solid, blog-post claims
are not independently fetched); the characterization of "hidden control flow" as a *named* cost
in Temporal's own materials is this lane's inference from Temporal's stated alternative, not a
directly quoted claim.
