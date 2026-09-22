---
question: "Is a dedicated judgment model - a separate cheap decision service for routing, skill selection, and compaction - the right approach inside a coding-agent harness in 2026?"
date: 2026-09-22
verdict: "A dedicated judgment model is validated for model-tier routing (RouteLLM/Hybrid-LLM/FrugalGPT-family evidence: large cost gap, context-light separability) but unvalidated and likely mismatched for skill selection and compaction, where the conditions that make a separate judge pay off are plausibly absent and Anthropic's own Claude Code ships both of those as main-model-driven, not judge-driven. Recommendation: narrow the judgment service's scope to model-tier routing only."
unverified:
  - "Could not retrieve dedicated tool-selection literature (Gorilla/ToolBench-style studies) or a compaction-specific model-judged-vs-heuristic study this session - a real coverage gap, not a finding that no such literature exists"
  - "Could not retrieve Codex CLI or Cursor documentation this session (redirect/fetch failures); their skill/model-routing mechanisms are not confirmed either way"
  - "No practitioner reports were found, either direction, of teams running a separate small judge/router model for skill selection or compaction in a coding-agent harness - absence reflects search-tool exhaustion, not a survey result"
  - "No critique article was retrieved this session; the critic-angle points are general, defensible systems-design reasoning, not sourced to a specific document"
  - "Adjacent-field precedent (cascade classifiers, mixture-of-experts gating) is general knowledge not freshly re-verified this session; a targeted fetch to re-confirm MoE gating caveats 404'd"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# PARADIGM check: is a dedicated judgment model the right approach for routing/selection inside a coding-agent harness (2026)?

Scope: the owner has built a judgment service — a separate, cheap dedicated decision model, asked typed questions ("which skills does this task need?", "which model tier?", "what to keep when compacting?") — and needs to know whether this is validated before extending it. This document does not assume it is right, and does not reference any of the owner's own legacy tooling.

**Method note / search status:** WebSearch was exhausted for this session (200/200 budget consumed by prior activity in this conversation, before this task's searches ran) before any query for this task executed. All findings below come from `WebFetch` against specific known URLs (arXiv abstract pages, official docs, one survey, one OSS project). This means: (a) angles 1 and 2 have solid primary-source coverage, (b) angle 3 (practitioner/gh-search reports) and angle 4 (critic articles) have thin, largely unverified coverage — several targeted URL guesses 404'd and could not be replaced by search — and angle 5 relies on general, well-established systems-design knowledge that was **not** independently re-verified with a fresh citation this session. Every claim below is labeled **[sourced]** (fetched from a specific document, quoted) or **[general/unverified]** (defensible domain knowledge, not freshly checked). Treat [general/unverified] items as lower-confidence.

---

## 1. Academic / empirical

**[sourced] RouteLLM (Ong et al., arXiv:2406.18665).** Trains a family of *learned* routers (similarity-weighted ranking, matrix factorization, a BERT classifier, and an LLM-judge variant) on human preference data to decide, per query, whether to send it to a strong or a weak model.
> "reducing expenses 'by over 2 times in certain cases' while maintaining response quality comparable to consistently using the powerful model... routers 'maintain their performance even when the strong and weak models are changed at test time'"

This is the strongest direct evidence *for* a separate, cheap judgment mechanism beating "always use the expensive model" — and it generalizes across model pairs without retraining. Note the scope: this is binary/few-way **model-tier routing**, not skill selection or compaction.

**[sourced] "Hybrid LLM: Cost-Efficient Query Routing" (Ding et al., ICLR 2024, arXiv:2404.14618).** A router predicts query difficulty and routes to a small or large model.
> "up to 40% fewer calls to the large model, with no drop in response quality"

Same family of result as RouteLLM: a lightweight, purpose-built router pays off specifically for model-tier decisions.

**[sourced] FrugalGPT (Chen et al., arXiv:2305.05176).** Uses LLM cascades (start cheap, escalate on low confidence) plus prompt adaptation and LLM approximation.
> "Cost reduction: Up to 98% savings while maintaining GPT-4's performance level... Accuracy improvement: 4% accuracy gains over GPT-4 at equivalent cost"

Important distinction: a cascade derives its "judgment" from the cheap model's own output/confidence, not necessarily a separate dedicated judge model — conceptually adjacent to the owner's approach but not identical.

**[sourced] 2025 LLM-routing survey (arXiv:2502.00409).** Frames routing as a cost/performance optimization problem, covering four families of methods: similarity-based, supervised learning, reinforcement learning, and generative.
> Routing is beneficial when "different queries may require different levels of reasoning, domain knowledge or pre-processing"... open challenges include "standardizing experiments," accounting for non-financial costs, and "designing truly adaptive strategies."

The survey confirms routing-as-a-field is real and active, but its scope — like RouteLLM and Hybrid LLM — is **model selection**, not skill selection or context compaction. It also flags calibration/generalization as *still open*, i.e., not a solved problem even within the one use case that has the most evidence.

**Gap [general/unverified]:** I could not retrieve dedicated tool-selection literature (e.g., Gorilla/ToolBench-style "which tool via embeddings vs LLM" studies) or a compaction-specific "model-judged vs heuristic" study this session — WebSearch was unavailable and targeted URL guesses failed. This is a real coverage gap, not a finding of "no such literature exists."

**Bottom line for angle 1:** the empirical literature strongly supports a separate cheap judge for *model-tier routing* specifically (high-frequency, large cost gap, benchmarkable accuracy). It does not provide direct support — or direct refutation — for a separate judge doing skill selection or compaction; those uses fall outside what this literature has tested.

---

## 2. Vendor practice

**[sourced] Claude Code — skill selection.** Progressive disclosure: skill descriptions sit in the system prompt at all times; the *main* model reads them and decides.
> "skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked"
> "`description` (Recommended): What the skill does and when to use it. Claude uses this to decide when to apply the skill."

No separate router/classifier model is documented for skill selection.

**[sourced] Claude Code — subagent selection and subagent model choice.** The main model reads subagent descriptions and delegates itself:
> "Claude uses each subagent's description to decide when to delegate tasks."

Which *model* a subagent runs on is resolved by a static precedence chain, not a runtime judgment call:
> "1. The per-invocation `model` parameter / 2. The subagent definition's `model` frontmatter... / 3. `CLAUDE_CODE_SUBAGENT_MODEL`... / 4. The main conversation's model"

This is config/precedence-based tiering, not a dedicated decision model at request time.

**[sourced] Claude Code — compaction.** The *same* acting model performs compaction, per Anthropic's own context-engineering guidance:
> "In Claude Code, for example, we implement this by passing the message history to the model to summarize and compress the most critical details."

And per the Claude Code cost-management docs:
> "auto-compaction, which summarizes conversation history when approaching context limits" — with user-steerable `/compact <instructions>` and CLAUDE.md-level compact instructions, not a separate model.

**[sourced] Anthropic, "Building Effective Agents" — the routing *pattern* in general (not Claude Code specifically).** Explicitly leaves the routing-decision mechanism open:
> classification "can be handled accurately, either by an LLM or a more traditional classification model/algorithm"

Their own worked example (easy questions → Haiku, hard questions → Sonnet) routes *to* different models but the document does not commit to a separate dedicated judgment model as the mechanism that decides — it presents "the LLM itself" and "a classifier" as equally valid, application-dependent choices.

**Gap [unverified]:** Could not retrieve Codex CLI or Cursor documentation this session (redirect/fetch failures); no independent confirmation of their skill/model-routing mechanisms. Do not treat their practice as known either way.

**Bottom line for angle 2:** for the one vendor I could verify in depth (Anthropic/Claude Code), 2026 production practice is **main-model self-selection** for skills and subagents, **static config precedence** (not a runtime judge) for subagent model tiering, and **same-model compaction** — not a separate dedicated judgment model for any of the owner's three uses. The one place Anthropic's own docs endorse a separate mechanism is coarse difficulty-based model routing (Haiku vs. Sonnet), consistent with angle 1.

---

## 3. Practitioner practice

Coverage here is thin — WebSearch (the tool suited to gh-search and engineering-blog discovery) was exhausted before this task began, and targeted URL guesses for practitioner blog posts (Portkey, LeewayHertz, a Substack piece) all 404'd.

**[sourced] semantic-router (aurelio-labs, OSS project).** A practitioner-facing routing library that deliberately avoids using an LLM for the routing decision:
> "Instead of having language models make routing decisions, this system leverages 'the magic of semantic vector space' to classify user input... eliminating LLM-based decision latency"
> Limitation: "when input doesn't match any route semantically, the system returns `None`... works best for applications with well-defined, discrete routing categories"

This is one concrete, shipped example of the **retrieval/embeddings alternative** to both "main model decides" and "dedicated LLM judge decides" — explicitly positioned against asking an LLM to route, for latency/cost reasons, but only viable for a bounded, well-separated route set.

**No findings, either direction, on:** teams running a separate small judge/router model specifically for skill selection or compaction in a coding-agent harness; reports of removing such a layer after finding the main model sufficient; reports of adding one after cost/latency analysis. **This absence should not be read as evidence of absence** — it reflects search-tool exhaustion, not a survey result.

---

## 4. Critics / failure modes

No critique article was retrieved this session (fetch attempts 404'd; WebSearch unavailable to find replacements). The points below are **[general/unverified]** — standard, defensible systems-design reasoning, not sourced to a specific document found this session:

- **Added latency per decision.** A separate judgment-model call is a full extra network/inference round trip on the critical path of every prompt (for skill/tier routing) or every compaction event, on top of the main model's own call.
- **The judge lacks the main model's accumulated context**, unless it is fed that context — at which point much of the "small and cheap" premise erodes, since a judge that needs the full conversation to be accurate is not meaningfully cheaper to run than the main model doing the judgment itself.
- **Calibration/overconfidence** is flagged even within the *best-supported* use case: the 2025 routing survey [sourced, §1] lists "designing truly adaptive strategies" and "standardizing experiments" as open problems, i.e., router calibration is not a solved problem even where routing is most validated.
- **Double cost when the judge and the main model don't need to disagree.** For skill selection specifically, the main model already reads skill descriptions as part of normal operation (per Claude Code's progressive disclosure, §2) — a separate judge duplicates work the main model does essentially for free, and introduces a two-decision-maker reconciliation problem when they disagree.
- **No measured null result was found this session** (i.e., no "we added a judgment layer and it didn't help" report was located) — flagged as a gap, not as "no such result exists."

---

## 5. Adjacent-field precedent

**[general/unverified]** — general knowledge of cascade/admission-control system design, not freshly re-verified this session (a targeted fetch to re-confirm mixture-of-experts gating-network caveats 404'd):

- **Cascade classifiers** (e.g., Viola-Jones-style face detection) and **admission control / cache-aside** patterns put a cheap, fast, high-recall filter in front of an expensive path. They are known to pay off when: (a) request volume is high enough to amortize the filter's own infrastructure cost, (b) the cost/latency gap between the cheap and expensive path is large, (c) the classification task is *separable* using a cheap, fast signal that does not require the same context the expensive path needs, and (d) misrouting is either caught downstream or cheaply tolerable.
- **Mixture-of-experts gating networks** are the closest ML analogue to a "dedicated small judgment model" and are widely documented (general knowledge, not freshly sourced) to be prone to load-imbalance and instability without explicit regularization — i.e., even in the ML architecture most structurally similar to the owner's judgment service, the router component itself is a known source of failure modes that need active management, not a "set and forget" layer.
- Mapped onto the owner's three uses: model-tier routing satisfies (a)-(d) reasonably well (high frequency, large price gap between tiers, difficulty is often separable from surface features, wrong-tier cost is usually just "suboptimal" not catastrophic). Skill selection and compaction plausibly fail (c) — both need enough of the actual task/conversation context to judge well that a "cheap, context-light" front filter is hard to make accurate.

---

## Cross-check

| Angle | Model-tier routing | Skill selection | Compaction keep/drop |
|---|---|---|---|
| 1. Academic | Validated (RouteLLM, Hybrid LLM, FrugalGPT-family) | No direct literature found either way | No direct literature found either way |
| 2. Vendor practice | Anthropic explicitly allows a separate classifier for difficulty routing | Claude Code: main model self-selects, no separate model | Claude Code: same acting model compacts, no separate model |
| 3. Practitioner | Not directly confirmed (search exhausted) | Not directly confirmed | Not directly confirmed |
| 4. Critics | Even here, calibration flagged as open | Duplicate-cost concern applies directly (main model already reads descriptions for free) | Context-sufficiency concern applies directly (judge needs near-full context to be accurate) |
| 5. Adjacent fields | Conditions (a)-(d) plausibly met | Conditions plausibly unmet (task not separable from full context cheaply) | Conditions plausibly unmet (same reason) |

**Agreement:** all angles that produced evidence agree the case is *strongest, and only clearly validated, for model-tier routing*. No angle produced positive evidence for a dedicated judgment model doing skill selection or compaction; the vendor-practice angle produced direct counter-evidence (Anthropic ships both as main-model-driven, not judge-driven).

**Disagreement / tension:** none of substance — the literature's silence on skill-selection/compaction is a coverage gap, not a contradiction of vendor practice; it is consistent with "nobody has published strong evidence either way for those two uses," which itself argues for caution rather than confidence in extending the judgment service there.

---

## Conditions table (from angles 1 + 5) and where the owner's three uses land

| Condition | Needed for a separate judge to pay off | Per-prompt skill selection | Per-prompt model-tier routing | Per-compaction keep/drop |
|---|---|---|---|---|
| Decision frequency | High (amortizes the extra call) | High | High | Lower (once per compaction event) |
| Cost gap: judge vs. "let the main model decide" | Large — judge must be much cheaper than the alternative path it prevents | **Negative/near-zero** — main model already reads descriptions in-context for free | **Large** — judge is a small model, alternative is running the expensive tier by default | **Unclear/negative** — judge needs near-full context to be accurate, eroding "cheap" |
| Separability without full context | Decision must be makeable from a small, cheap signal | Weak — good skill choice often depends on task nuance the descriptions alone may not capture | Strong — many benchmarks show difficulty/domain is inferable from the query alone | Weak — "what to keep" is inherently a full-context judgment |
| Latency budget | Must tolerate one extra round trip | Tolerable but pure overhead given the free alternative | Tolerable, and evidenced as worth it | Tolerable in isolation, but compaction is already a large request (Claude Code docs: "compacting a large context... is itself a large request") — stacking a second model call compounds this |
| **Meets conditions?** | — | **Likely does not** | **Likely does** | **Likely does not** |

---

## Recommendation

**A. Verdict:** Contested-to-niche overall, but the angles split cleanly by use case rather than disagreeing with each other. A dedicated judgment model is **validated** for one of the owner's three uses (model-tier routing) and **unvalidated / likely mismatched** for the other two (skill selection, compaction) — not because evidence argues against them, but because the conditions that make a separate judge pay off (large cost gap, context-light separability) are plausibly absent there, and the one vendor whose practice could be verified this session (Anthropic/Claude Code) ships both of those as main-model-driven, not judge-driven.

**B. Conditions and fit:** see table above. Per-prompt model-tier routing meets the evidenced conditions (high frequency, large cost gap, benchmarkable accuracy, tolerable latency). Per-prompt skill selection and per-compaction keep/drop plausibly fail on cost-gap and separability grounds — in both cases the "free" alternative (the main model already holding the relevant context) is hard to beat with a separate call.

**C. Strongest alternative per use, and cost of being wrong:**
- **Skill selection:** main model self-selects from skill descriptions already in its system prompt (the shipped Claude Code default). Wrong-skill risk exists either way and is mitigated by description quality, not by adding a second decision-maker; a separate judge adds latency/cost and a disagreement-reconciliation problem without removing that risk.
- **Model-tier routing:** a dedicated small/learned router (RouteLLM-style) is the evidenced strongest option; the cheaper fallback is static/heuristic rules (e.g., file-size or task-type thresholds), which cost less to build/run but capture less of the available savings since they can't discriminate as finely as a learned router — a real trade-off, not a free lunch either way.
- **Compaction:** have the acting model (which already holds full context) do the keep/drop judgment inline, as Anthropic ships it — or fall back to cheap heuristics (drop oldest tool output first) when a model call is undesirable. A separate dedicated compaction judge would need close to the same context to be accurate, so it is unlikely to beat either alternative on cost or quality.

**D. Recommendation:** Keep the dedicated judgment model, but **narrow its scope to model-tier routing** — the one use with direct empirical backing (RouteLLM/Hybrid-LLM/FrugalGPT family) and the one use the conditions table supports. For skill selection, fold the decision back into the main model's own read of its available skill descriptions (or, only if the skill catalog grows too large for a system prompt, move to embeddings-based retrieval — the evidenced alternative, per semantic-router — not an LLM judge). For compaction, align with the vendor-validated pattern: let the acting model (or a cheap heuristic) do the keep/drop call inline rather than routing it through a separate model. The trade-off to flag to the owner: narrowing gives up the architectural uniformity of "one judgment service handles everything," but running it on all three uses means paying a real per-decision latency/cost tax on two uses where no evidence — academic, vendor, or adjacent-field — shows it beats what the main model already does for free.
