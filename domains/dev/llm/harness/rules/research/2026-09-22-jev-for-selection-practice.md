---
question: "Does the industry evidence support using jev (TypeSafe's decision-model API) to replace an agent harness's native skill/tool listing with jev-only selection, instead of supplementing it?"
date: 2026-09-22
verdict: "No source, vendor or independent, has produced evidence that would justify hiding the native skill listing and trusting jev alone; every real-world production example (BuilderIO, Switchboard) uses jev as an additive supplement with a deterministic fallback, never a replacement, and no accuracy or calibration numbers exist for jev's choice primitive at agent-harness option counts in any language."
unverified:
  - "no vendor-published accuracy or calibration number for the choice question type, at any option count, in any language"
  - "no case found of an agent harness fully replacing its native skill/tool listing with jev-only selection"
  - "no comparison found of jev picking the skill vs the model reading all skill descriptions itself, on a real agent-harness catalog, by anyone"
  - "no statistically powered, Japanese-language, real-API measurement of jev for skill/tool/agent selection specifically"
  - "no published task-outcome-proxy measurement, as opposed to label-matching accuracy, for any jev-based routing/selection system"
  - "no independently reproduced, high-provenance benchmark of jev vs a deterministic/local baseline for routing (the one found, ToolSpeeder, has weak provenance)"
  - "could not confirm Mario Zechner's own personal writing on jev — his site did not resolve this session"
  - "could not enumerate npm dependents of @typesafe-ai/sdk directly — the browse/depended page returned 403"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# jev for skill/tool/model selection and routing — industry survey (2026-09-22)

## 1. Method and verification legend

- **Direct fetch** — content retrieved and read by a fetch tool (WebFetch, `curl`, `gh api`) this session; quotes below marked direct are drawn from that content, summarized by the fetch tool's own small model unless a raw `curl` dump is shown.
- **Raw dump** — `curl`/`gh api` output shown to me unsummarized (SDK README, CHANGELOG, `demo.ts`, PR bodies, `jev-tool-prefetch.ts`, `switchboard`/`openvons` READMEs, `jev-bench` results.md). These are the highest-confidence sources in this record.
- **Summarized fetch** — WebFetch calls return a small model's summary of the page, not the raw page; marked "(summarized fetch)" inline. Verbatim quotes inside those summaries are the sub-model's transcription, not independently re-verified against the raw HTML by me, except where I show a raw dump of the same source.
- **Not reached**: `npm dependents` browse page (403, blocked); Mario Zechner's own site (`badlogic.lol` — DNS did not resolve from this session; could not confirm a working URL for him in the time budget, so no personal-practitioner finding for him beyond the pi-warden/pi-typesafe/pi-jev-tools repos already on record from 2026-09-19).
- Everything below that carries a star count / push date / issue state was read via `gh api`, authenticated as `esh2n`, on 2026-09-22.
- **Provenance caveat that applies to most of §3–4**: almost every repo cited below was created or last touched within days of this survey (many on 2026-09-21/22 itself), several have 0 stars, and one (`RT123-new/ToolSpeeder`) is an unmerged draft PR in a 0-star repo. I flag each such case individually rather than filtering them out, because they are the only sources that exist on this exact question — but their newness and low external visibility mean none of them has had time to be checked by anyone else. Treat accuracy numbers from 0-star, single-day repos as **self-reported, unreplicated** even where the methodology looks careful.
- A separate, structural observation: at least five near-identical "awesome-jev" list repos (below, §4) appeared within a ~5-day window and are each merging a dozen-plus PRs per day from distinct one-off contributor accounts. I could not determine whether this reflects genuine grassroots adoption of a fast-moving topic or coordinated/incentivized list-building; I did not find evidence of fabrication, but the pattern itself is a channel-bias fact worth stating plainly.

---

## 2. Vendor lens (TypeSafe)

Source: `https://typesafe.ai` (summarized fetch), `https://docs.typesafe.ai/llms.txt` (summarized fetch, gives the doc index), and direct fetches of `docs.typesafe.ai/patterns/intent-routing.md`, `/primitives/choice.md`, `/concepts/use-case-map.md`, `/model-jaggedness/jev-1.13.md`, `/confidence.md` (all summarized fetches of the raw markdown — I did not get raw dumps of these specific pages, only their tool-summarized content).

**Home page claims (verbatim, from the summarized fetch of typesafe.ai):**
> "Jev.Cost $42 Per Billion input tokens"
> "238x Lower input price than Claude Fable 5.1"
> "193.6x Faster, 244.6x Cheaper"
> "Zero Hallucinations"

No accuracy percentage, confusion matrix, or calibration number appears anywhere in the vendor's own materials that I could find — the cost/speed multipliers are the only quantified claims on the home page, and they are comparisons of cost/latency, not correctness.

**Question types.** Three primitives, confirmed both from the vendor's own summarized docs and from the SDK's raw `demo.ts` (below): `choice`, `score`, `noul`. Each returns `probabilities`/`confidence` except `noul`, which "returns the probability itself" (per the raw `jev-eval-ja` README, §3) rather than a separate confidence field.

**Choice question — the one that matters for selection/routing (direct-summarized fetch of `primitives/choice.md`):**
> "A Choice question accepts up to 255 options"
> "Adding options costs a few tokens each, so give the model the full list of teams, categories, or products rather than a shortlist."
> An `other`/`none of the above` option is recommended "when the list might not cover every input, so the model can say none of the others fit."

Option descriptions can be a bare label, a one-line string, or a structured `{what, not_for, examples}` object. No guidance found anywhere in the docs on how *accuracy* degrades as option count grows toward 255 — the vendor's only quantified claim about option count is cost (tokens), not correctness.

**Routing is a named, documented use case, but at the "route a ticket/request to a queue" grain, not "replace an agent harness's tool/skill listing":**
- `docs.typesafe.ai/patterns/intent-routing.md` exists as a named pattern page; example shown routes to 4 intent categories, no stated limit on option count, no accuracy/latency numbers, no "don't do this above N options" warning.
- `docs.typesafe.ai/concepts/use-case-map.md` explicitly lists, verbatim (per the fetch): "Use Jev to build a custom router that chooses which LLM receives each prompt" under Model Routing. Tool/skill-selection for an agent is not a named use case on this page — the closest analogues are ticket routing to teams, candidate-to-role matching, and lead routing, all support/HR/sales domain examples, not developer-tool selection.

**Known limitations, `model-jaggedness/jev-1.13.md` (direct-summarized fetch), nine documented failure modes verbatim-quoted by the fetch:**
> "Scoping words, negations, and implied conditions are read at face value."
> "Jev is not a calculator" / "does not count reliably."
> "reads dates as text, not as ordered quantities."
> "Accuracy falls as the state grows with content unrelated to the decision."
> "does not treat it [state] as hostile by default." (no adversarial-input hardening)
> "jev-1.13 might get confused" on contradictory instructions.
> "is not trained to generate text."

No accuracy percentages, no language-specific caveats (positive or negative — Japanese is neither promised nor flagged as weak), no stated Choice option-count ceiling on this page either (the 255 ceiling comes only from `primitives/choice.md`).

**Confidence/calibration page (`confidence.md`, direct-summarized fetch):** no calibration numbers or validation methodology published. The only formula shown is an approximation used in the interactive demo, explicitly not the real computation. Vendor's own guidance: "The correct threshold values depend on your domain and the performance of the model for your use case" — i.e., the vendor tells users to measure it themselves, which is the same conclusion pi-jev-tools reached independently (per prior context) and the same gap this survey is trying to fill for the owner.

**SDK (`typesafe-ai/typesafe-sdk-js`, raw dumps via `gh api`):** npm `@typesafe-ai/sdk`, latest `0.6.0`, maintainers `allie@typesafe.ai` / `diogo@typesafe.ai`. The repo's only example (`examples/demo.ts`, raw dump) is a support-ticket triage script exercising all three question types together (`isBilling: noul`, `sentiment: choice`, `urgency: score`, `refundRisk: score`) — classification/triage, not tool or skill selection. **No routing/selection example ships in the vendor's own SDK repo.**

**Verdict on the vendor lens:** "Routing/selection among N options" is a documented, named pattern (`intent-routing.md`, the Model-Routing use case), and `choice` is engineered for it (255-option ceiling, guidance to send the full list rather than a shortlist, `other`-option recommendation). But the vendor publishes **no accuracy or calibration numbers for `choice` at all**, **no language coverage claims** (Japanese is unaddressed either way), and its own example code and use-case map do not cover "replace an agent harness's skill/tool listing" as a scenario — the nearest documented case is ticket/lead/model routing among a handful of categories, not a 54-way developer-tool catalog.

---

## 3. Practitioner lens (named individuals and named projects)

### Simon Willison (named individual, blog post)
Source: `https://simonwillison.net/2026/Sep/21/jev/`, "Jev introduces a new shape of LLM—System One, aka Decision Models" (summarized fetch).
- Frames jev as useful for "anything that can be expressed as a classification task" (spam detection, labeling, prioritization).
- Reports the vendor's own pricing ($0.042/M input tokens) and calls it "really cheap."
- His central caveat is opacity/bias, not accuracy: > "Jev doesn't even give you that: put in all the text you want, the only thing you're going to get back is a floating point number." He describes an experiment where Jev rated Cupertino favorably and East Palo Alto poorly, reads that as evidence of hidden bias, and concludes: > "evals and structured experiments are even more important than they are for regular LLM projects."
- **Gap**: he does not discuss tool/skill/model routing specifically, and does not compare jev's approach against "let the model read the option list itself" — the exact comparison the owner needs is absent even from the most prominent named commentator found.

### BuilderIO/agent-native — real, shipped, tested tool-selection feature (not a toy)
Repo health (`gh api`): 6,291 stars, pushed **today** (2026-09-22), 80 open issues — an actively maintained, high-visibility production repo, not a weekend project.
Source: raw dump of `packages/core/src/agent/jev-tool-prefetch.ts` and its `.spec.ts`, plus `gh api` on PR #5361.

What it does, from the raw source: a deterministic keyword shortlist first narrows the tool catalog to at most 128 candidates (`MAX_JEV_CANDIDATES`); jev's `choice` question then ranks that shortlist (750ms timeout, `JEV_TIMEOUT_MS`); the top 3 (`DEFAULT_PREFETCH_LIMIT`, capped at `MAX_PREFETCH_LIMIT = 5`) are pre-loaded into the agent's tool list **ahead of**, not instead of, the existing curated/tool-search path. On a missing API key, timeout, malformed response, or provider failure, the function returns `[]` and the code comment says explicitly: "Missing keys and Jev failures preserve the existing curated/tool-search path." A hard 40-tool first-request ceiling is enforced by a separate guard regardless of what jev returns.

PR #5361 (merged 2026-09-18, raw dump of the PR body), "feat(core): add optional Jev tool prefetch":
> "Add optional Jev semantic ranking before the first agent request when `JEV_API_KEY` is configured. Missing keys and Jev failures preserve the existing curated/tool-search path."
> Validation section, verbatim: "Focused Vitest: 7/7 passed. Agent-chat context tests: 7/7 passed. Curated catalog guard: 16 first-party plugins clean."

**No accuracy, follow-rate, or task-outcome number appears anywhere in this PR.** The validation evidence offered to reviewers (42 review comments on the PR) is entirely test-pass counts, not a measurement of whether the jev-ranked tools were actually the right ones on real user prompts. This is the single most directly comparable "notable" production use found — real product, real scale, real fallback discipline — and it still ships with zero measured selection accuracy, and it is explicitly additive to the native listing, never a replacement for it.

### ruban-24/switchboard — jev used for model/reasoning-effort routing in Claude Code and Codex
Repo health: 4 stars, pushed today (2026-09-22), CI green, published on npm as `@ruban24/switchboard`. Source: raw dumps of `README.md` and `docs/routing.md`.

Switchboard makes **one jev `choice` request per classified user turn** inside Claude Code/Codex, asking capability tier (routine/standard/complex/demanding) and, conditionally, reasoning effort per eligible model; a deterministic policy then resolves the actual model/effort and pins it for the rest of the conversation. From `docs/routing.md`, verbatim:
> "These criteria are not measured guarantees of model success."
> "Jev supplies structured judgments; code resolves the policy and execution."

No accuracy, follow-rate, or misrouting-rate number is published anywhere in the repo's docs (`classifiers.md`, `customization.md`, `model-catalog.md`, `routing.md`, `privacy.md` — checked all six doc filenames). A `gh` search of the repo's issues for accuracy/wrong/misroute complaints returned zero results. This is the closest real analogue to "jev replaces a listing the model would otherwise read" (it replaces the model-selection decision a user would otherwise make manually), and it too ships with no published measurement of correctness — only architecture and a policy table.

### buberlo/dsh-jev — open, unresolved negative evidence on tool-catalog selection
Repo health: 13 stars, pushed 2026-09-20, 1 open issue. Issue #3 (opened 2026-09-21, open, unanswered as of this survey), summarized fetch of the GitHub issue:
> Root cause, quoted from the issue: "the only code path that exits without logging is the empty-catalog early return."
> The plugin's tool-catalog selection silently no-ops on an unsupported point release (`0.1.5-rc.2` vs. the verified `0.1.6-alpha.2`) — it "loads and runs `assessment` and `loopDetection` features normally" while tool selection "produces zero log entries despite being enabled." The reporter asks for a simple warn log; no maintainer response yet.

This is a concrete instance of the same fail-open pattern already on record from `pi-jev`'s design (prior 2026-09-19 review) — silent, undetectable no-op when the tool catalog resolves empty, in a *different* implementation by a *different* author. That it recurs independently is worth weighting: fail-open-on-selection-failure looks like a structural hazard of this pattern, not a one-off bug.

### genai-craft/openvons — independent, Japanese-team, open reimplementation of the "typed decision" idea, explicitly for tool selection
Repo health: 13 stars, pushed 2026-09-21. Raw dump of the README. This is **not** TypeSafe's hosted jev — it is `import jev` as an alias inside a from-scratch trained-head library ("open-Jev"), built by a different team, explicitly targeting "intent, tool selection, scores (Noul / Choice / Score)." Its own reported numbers (self-measured, unreplicated):
> "4B frozen + head 0.916 vs 27B zero-shot 0.875; 8 questions in 22.6 ms"
> JevPick (candidate-menu decoding acceleration for tool calling, Qwen3-4B/27B): "the menu contains the true continuation 90% of the time, JevPick picks the right one 88% (vs 64% for a frequency rule), 3.2–4.8x faster decode with byte-identical output"

Relevance: this is evidence that "external, cheap, calibrated classifier picks the tool" is being independently built and measured by a third party specifically for tool selection, with real accuracy comparisons against a frontier-scale zero-shot baseline — but it is a different underlying model (a small trained head on a frozen backbone), not TypeSafe's product, so it cannot be read as evidence about TypeSafe's jev specifically.

---

## 4. Measured lens (independent, non-vendor numbers)

### RT123-new/ToolSpeeder — the one benchmark found that is directly "jev vs baseline for tool routing," but unverified provenance
Repo health: **0 stars**, created 2026-08-27, last push 2026-09-17. PR #2 is **open, unmerged** (`merged_at: null`), a 15,455-line draft. Raw dump of the PR body.

Protocol: pre-registered, SHA-256-pinned ("frozen") benchmark comparing five routing strategies on 120 held-out tasks across 10 semantic families:
> B0 (no speculation): 20.0% accuracy, 0.0ms
> B1 (current heuristic): 20.0% accuracy, 70.0ms
> B2 (deterministic local baseline): **95.0% (114/120)**, P50 0.5ms, Brier 0.2760, ECE 0.4504
> B3 (TypeSafe/Jev): **95.8% (115/120)**, P50 699.9ms, P95 764.5ms, Brier 0.0839, ECE 0.2450

Its own stated verdict, verbatim: > "CONFIRMATORY PARTIALLY SUPPORTED — KEEP OPTIONAL / TARGETED ONLY (Jev is not promoted into the default composite scheduler)." Jev's accuracy edge over the deterministic baseline is marginal overall (+0.8 points) and concentrated in the harder option-count family (K=16: jev 86.7% vs baseline 83.3%); its calibration is meaningfully better (Brier 0.0839 vs 0.2760); its latency is roughly **1,400x** worse (699.9ms vs 0.5ms). A proposed two-tier cascade (local router first, escalate to jev only below 0.80 confidence) holds 95.8% accuracy while skipping 36.7% of remote calls, landing at 443.5ms mean latency.

**Caveat, stated plainly**: I cannot independently verify this data. The repo has zero stars, no external review, the PR is a draft, and I could not fetch or check the referenced protocol/dataset files (`benchmarks/protocols/typesafe-speculation-v1.0.json`, `benchmarks/data/held_out_speculation_tasks_v1.0.json`) beyond their names and claimed hashes in the PR body. The report reads as unusually polished (a full red-team section, an "Absolute Safety Invariant," a formally worded confirmatory/exploratory split) for a 0-star, unmerged, single-author repo — I note this as a reason for skepticism about how the numbers were produced, without being able to confirm or refute fabrication either way. Use this as a directional data point, not a citable benchmark.

### kamo-shika/jev-bench — rigorous, but explicitly does **not** measure the real jev API
Repo health: 0 stars, created/pushed 2026-09-19. Raw dump of `docs/results.md`. The author states up front, verbatim (translated): > "The real Jev (TypeSafe)'s numbers are not here. This measurement did not hit the real API, so 'how close does this get to the real thing' is **BLOCKED**."

What it actually measures: three Qwen3 checkpoints (1.7B/4B/8B, local llama.cpp) reading single-token A/B/C logprobs directly — i.e., the "model reads/scores the options itself" approach — on JGLUE JNLI (Japanese 3-way natural-language inference), 1,000 held-out items, majority-class baseline 55.9%. Methodology is genuinely careful: Wilson 95% CIs, order-swap robustness (3 permutations), prompt-wording ablation (found an 8–16 point swing between wordings on the *same* model), temperature calibration with reported ECE/Brier/NLL, AUROC-style confidence discrimination. Headline result: Qwen3-8B Q4_K_M, order-averaged accuracy **77.1%** (95% CI 74.4–79.6%), ECE after calibration 0.040–0.046.

**Relevance**: this is the most methodologically serious Japanese-language number in this survey for the "model reads the options itself" side of the comparison — but it says nothing about TypeSafe's actual jev, and it is not a skill/tool-selection task (it's NLI).

### unirt/jev-eval-ja — the one source found that hits the real TypeSafe API in Japanese
Repo health: 0 stars, created 2026-09-21, pushed same day (i.e., appeared during this survey window). Raw dump of `README.md`. This directly narrows the gap the owner's prior research flagged ("None of the nine measured Japanese").

Setup: real TypeSafe Jev via Cloudflare Workers AI/AI Gateway, compared against Laya (open, local, via `laya-mlx` on Apple Silicon) and a regex baseline, on three synthetic Japanese business tasks (compliance-phrase noul, financial-institution-name entity-match noul, ticket triage choice/noul/score), N=10 cases per task, each case leveled 易/中/難.

Results (verbatim table, translated labels):
| task (type) | regex | jev (question in Japanese) | jev (question in English) |
|---|---:|---:|---:|
| compliance detection (noul) | 40% | 90% | 90% |
| institution-name match (noul) | — | 90% | 90% |
| triage department (choice) | — | 100% | 100% |
| triage same_day (noul) | — | 100% | 100% |
| triage offensive (noul) | — | 100% | 100% |
| triage frustration (score) | — | 80% | 90% |

Author's own disclosed limitations, verbatim (translated): > "With only 10 cases per task, the numbers themselves carry no precision." The one frustration miss is a 0.33-confidence boundary flip, not a clear error; a 0.90 confidence threshold would still be required (since one 0.80-confidence answer was wrong), which "would send close to half [the frustration cases] to a human." A stability check (5 reruns per case, `RUNS=5`) found **0 of 40** case-question answers flipped; max probability spread 0.08. The one clear miss (a Japanese bank name after a merger) was a knowledge gap, not a reasoning failure — adding one line of context to `state` raised the confidence from 0.14 to 0.96.

Laya (open local model) comparison in the same repo: performance collapses to majority-class answering in most conditions (flagged `*` in the table — e.g., 5 of 6 entity-match conditions and all 6 frustration conditions return the same answer regardless of input); switching the *question* language to English (holding the Japanese document text fixed) raised some Laya scores sharply (compliance 40%→80%, department 40%→70%), meaning for this open model the language of the *prompt*, not the *content*, was the bottleneck — and the Japanese-native "typed-decisions" checkpoint variant did not fix this when questioned in Japanese.

**This is real, if extremely small-N, evidence that TypeSafe's actual jev is usable in Japanese for noul/choice/score business-classification tasks at high point-accuracy (80–100%) with no answer-flip instability across reruns** — but it is not a skill/tool-selection task, and N=10/task is explicitly too small for the author's own comfort, let alone for a design decision.

### No comparison found anywhere of "jev picks the skill" vs "model reads all skill descriptions" on an actual agent-harness catalog
Every source above that touches tool/skill selection either (a) supplements the native listing rather than replacing it (BuilderIO), (b) routes a different axis — model/effort, not tool/skill list (Switchboard), (c) is a routing benchmark on synthetic task families, not a real skill catalog, with unverifiable provenance (ToolSpeeder), or (d) is a different underlying model, not TypeSafe's (openvons). **No numbers found, anywhere, for the owner's exact question**: does hiding a harness's native skill listing and letting jev alone pick, beat leaving the listing visible, on a real prompt distribution.

---

## 5. In the wild lens

**Package**: `@typesafe-ai/sdk` on npm, latest `0.6.0`, MIT license, repo `typesafe-ai/typesafe-sdk-js`. The npm "browse/depended" dependents page returned HTTP 403 from this session — could not enumerate downstream npm packages directly.

**GitHub code-search totals** (`gh api search/code`, authenticated, 2026-09-22): `"typesafe-ai"` → 11,168 files; `"systemOne"` → 10,672 files; `"@typesafe-ai/sdk"` → 4,008 files.

**Named, high-profile dependents found via code search** (all confirmed real repos via `gh search code`, not summarized): `elizaOS/eliza` (agent framework, `packages/agent/src/services/typesafe/`), `Effect-TS/effect` (`packages/ai/typesafe/src/TypeSafeDecisionModel.ts` — a first-class AI-package provider), `ComposioHQ/composio` (`ts/packages/providers/typesafe/`), `Arize-ai/openinference` (a dedicated `openinference-instrumentation-typesafe` package with its own README and examples) and `Arize-ai/phoenix` (integration docs page), `ax-llm/ax` (native-provider examples in Go, TypeScript, and Java, plus a dedicated skill doc `src/ax/skills/ax-typesafe.md`), `maximhq/bifrost` (`docs/integrations/typesafe-sdk.mdx`), `CopilotKit/CopilotKit` (a cookbook entry, `jev-generative-ui.mdx`), `langchain-ai/docs` (`src/langsmith/llm-gateway-decision-models.mdx` — LangSmith documents jev-style decision models as a gateway concept), `samchon/typia` (`packages/jev/`). **Reading**: jev/TypeSafe is treated as a standard, first-class "LLM provider" by several observability and agent-framework projects — this is real plumbing-level adoption — but none of these integration docs, on inspection, are specifically about skill/tool selection; they are provider/instrumentation/evaluation integrations (i.e., jev as one more model you can call, wired into existing eval/observability pipelines).

**"Awesome-jev" list ecosystem**: five near-identical curated lists appeared within days of this survey — `Anil-matcha/awesome-jev-by-typesafe` (788★), `yibie/awesome-jev` (1,210★), `AbdelStark/awesome-typesafe-jev` (445★), `cobanov/awesome-jev` (329★), `AnotiaWang/awesome-jev` (287★) — all created in the ~2026-09-17 to 2026-09-20 window and still merging many PRs per day from distinct one-off contributor accounts (`yibie/awesome-jev`'s commit log shows over a dozen merges in the six hours preceding this survey). I flag this pattern (many list repos, very fast star growth, high daily merge velocity, single-PR contributor accounts) as unusual for organic curation without concluding it is illegitimate — I found no evidence of fabricated content inside the entries I checked (e.g., the `jev-table-import-mapper` entry's claimed numbers — "10/10 mapped, 253 questions in one call, 915 ms, $0.0012" — point to a real, checkable repo), but the *speed and volume* of list-building itself is a fact worth weighting when judging how "established" jev practice looks from outside.

**Negative/maintenance evidence, collected:**
- `buberlo/dsh-jev` issue #3 — open, unresolved silent fail-open bug in tool-catalog selection (§3).
- `RT123-new/ToolSpeeder`'s own confirmatory verdict keeps jev "optional / targeted only," explicitly declining default-scheduler promotion on latency grounds (§4) — a rare case of a jev integration attempt concluding "don't switch it on by default," structurally similar to pi-jev-tools' own "don't auto-use on every task" conclusion from the prior 2026-09-19 review.
- `jwalin-shah/tensor-logic` issue #92 (open, proposal only, zero results at time of writing) records a community-recognized measurement gap, verbatim: > "Laya's public Jev comparisons are not controlled head-to-head because Laya's author reports no direct Jev API access" — i.e., even people trying to benchmark jev against alternatives report they can't get a fair, direct comparison easily.
- `siren2345/jev-single-decode` issue #1: a local single-decode adapter scores 33.8% (47/139) vs a competing "SemIf" approach's 78.4% (109/139) on a public choice benchmark called "JevBench" — but on inspection this is a bug report about the adapter's own decoding method (post-sampling vs. pre-sampling logits, possible tensor/runtime mismatch), not a finding about jev's ceiling; the author proposes a fix and re-test rather than treating the gap as a verdict.

---

## 6. Summary table

| source | task type | result | cost/latency | named failure mode / caveat |
|---|---|---|---|---|
| TypeSafe docs (vendor) | choice/score/noul spec | 255-option ceiling for Choice; no accuracy numbers | "$42/B input tokens," "193.6x faster, 244.6x cheaper" than an unnamed comparison, "238x lower input price than Claude Fable 5.1" (all vendor-claimed, no methodology shown) | 9 documented failure modes (literal reading, no math, no dates, drowns in irrelevant state, no adversarial hardening, no generation); no calibration numbers; no language claims either way |
| Simon Willison (blog) | general classification | qualitative only, no numbers on accuracy | $0.042/M input tokens (vendor's own number, repeated) | opacity/bias risk ("only a floating point number"); no routing/selection discussion |
| BuilderIO/agent-native (merged PR #5361) | tool-list pre-ranking, shipped in production | additive to native listing, capped at top-3-of-5, 40-tool ceiling enforced separately | 750ms timeout budget; fails open to existing path | validation = test-pass counts only (7/7, 7/7, 16 plugins), **no selection-accuracy number published** |
| ruban-24/switchboard | model/effort routing (Claude Code, Codex) | one choice call/turn, deterministic policy on top | not published | explicit: "not measured guarantees of model success"; zero accuracy/misroute numbers in docs or issues |
| buberlo/dsh-jev issue #3 | tool-catalog selection | N/A — feature silently disabled | N/A | fail-open silent no-op on unsupported version, open/unresolved |
| RT123-new/ToolSpeeder PR #2 (unverified provenance, unmerged, 0★) | tool routing, 120 held-out tasks | jev 95.8% (115/120) vs deterministic-local 95.0% (114/120) | jev P50 699.9ms vs local 0.5ms (~1,400x); jev Brier 0.0839 vs local 0.2760 | own verdict: "keep optional / targeted only," not promoted to default |
| kamo-shika/jev-bench (0★, does NOT hit real jev API) | Japanese NLI (JGLUE JNLI), 1,000 items | Qwen3-8B reading own logprobs: 77.1% (baseline 55.9%) | 0.4–0.5s local inference | explicitly BLOCKED on comparing to the real vendor API; prompt wording alone swings accuracy 8–16 pts |
| unirt/jev-eval-ja (0★, real jev API, Japanese) | business noul/choice/score, N=10/task | noul 90%, choice 100%, score 80–90% | not reported | author: "numbers carry no precision" at N=10; 0/40 answer flips across 5 reruns; one miss traced to a knowledge gap, fixed with one line of context |
| genai-craft/openvons (independent reimplementation, not TypeSafe) | tool/intent selection | trained 4B head 0.916 vs 27B zero-shot 0.875 | 22.6ms/8 questions | not TypeSafe's model — evidence the *idea* is being reproduced and measured elsewhere, not evidence about jev itself |
| npm / GitHub code search | adoption | 4,008–11,168 files referencing typesafe-ai/systemOne; real dependents: elizaOS, Effect-TS, Composio, Arize, ax-llm, Bifrost, CopilotKit, LangSmith docs | — | npm dependents page blocked (403); "awesome-jev" list ecosystem (5 lists, up to 1,210★) grew unusually fast, provenance not independently confirmable |

---

## 7. What a fair experiment would look like (and what no source above has done)

The closest model for protocol discipline found in this survey (beyond the already-known pi-jev-tools precedent) is `RT123-new/ToolSpeeder`'s SHA-256-pinned frozen protocol and `kamo-shika/jev-bench`'s statistical rigor (Wilson CIs, order-swap and wording ablations, calibration curves) — even though neither is directly trustworthy as a citable number (ToolSpeeder's provenance is weak; jev-bench doesn't test the real API). `unirt/jev-eval-ja` is the best model for *scope discipline*: synthetic-but-realistic cases, explicit difficulty levels with a documented `why` for hard cases, a stability check via repeated runs, and — critically — the author stating outright that their own N is too small to trust.

A fair experiment for the owner's decision ("hide the native listing and let jev select" vs "keep the native listing") should combine these:

1. **Freeze the protocol before any run**, committed with a hash (ToolSpeeder's practice): the exact skill catalog snapshot (54 skills), the exact `disable-model-invocation: true` flags to flip for the hidden-listing arm, the question wording in both Japanese and English (since `unirt/jev-eval-ja` found question-language changes accuracy independent of document language, and `kamo-shika/jev-bench` found wording alone swings accuracy 8–16 points), and the confidence threshold(s) to be tested.
2. **A labeled Japanese prompt set** built from real historical prompts where possible, hand-labeled by the owner with the "correct" skill(s), explicitly including hard/ambiguous cases (per `unirt`'s 易/中/難 levels with a `why` field) and a "none of the above" bucket (per the vendor's own Choice guidance and `openvons`' explicit "none" calibration).
3. **A real A/B, not a simulated one**: Arm A = native listing visible, model chooses (current jig behavior). Arm B = native listing hidden via `disable-model-invocation: true` on every skill, jev top-3 injected as context (mirrors jig's existing mechanism). Optionally Arm C = BuilderIO's pattern, jev pre-ranks but the native listing stays visible/searchable as fallback — this third arm has real production precedent (BuilderIO) and no measured numbers exist for it either, so it would also be new.
4. **Pre-declared metrics**: top-1/top-3 accuracy against the label; calibration (ECE/Brier, per `kamo-shika`'s method); the owner's own already-defined **follow rate** (does the agent actually invoke what was selected — currently 11.9% with the listing present, and no external source in this survey measures an analogous number for a comparable hidden-listing setup); a task-outcome proxy (did the conversation finish without a skill-correction turn — no source found publishes this for any jev-based selector); latency P50/P95 (per ToolSpeeder); cost per decision at the owner's real prompt volume (no source publishes this either).
5. **Robustness before trust**: repeat each case ≥5x (per `unirt`'s stability check) and report the answer-flip rate before trusting any single accuracy number; report Wilson 95% CIs (per `kamo-shika`) rather than bare percentages, especially given the sample sizes realistically available to a single owner's real prompt volume — likely small enough that `unirt`'s own caveat ("the numbers themselves carry no precision") will apply directly.
6. **A stated promotion/non-promotion rule decided in advance** — ToolSpeeder's "confirmatory partially supported, keep optional" framing, whatever the flaws in its provenance, is a usable template for writing an honest mixed verdict instead of rationalizing a preferred outcome after the fact.

**What no source in this survey has done, explicitly:**
- A frozen A/B with the harness's native listing *actually hidden* (`disable-model-invocation: true` on every skill) compared against jev-only selection, on the same harness, same prompt set. Not vendor, not BuilderIO (additive only), not Switchboard (different axis), not ToolSpeeder (synthetic task families, unverified provenance).
- Any test near the vendor's own stated 255-option Choice ceiling applied to a skill/tool catalog — the largest option count found tested for routing anywhere in this survey is ToolSpeeder's K=16 family (unverified provenance); most real examples (Switchboard: 4 tiers; `unirt` triage: department is a handful; BuilderIO: shortlisted to ≤128 then ranked to top-3-of-5) are far below the owner's 54-skill catalog and far below 255.
- A statistically powered (large-N, CI-reportable), Japanese-language measurement of the *real* TypeSafe jev API specifically for skill/tool/agent selection. `unirt/jev-eval-ja` is real-API and Japanese but N=10/task and not a skill-selection task; `kamo-shika/jev-bench` is statistically serious (N=1,000) but explicitly not the real API and not a selection task.
- Publication of a task-outcome proxy (as opposed to label-matching accuracy) for any jev-based routing/selection system found here.
- A vendor-published accuracy or calibration number for Choice specifically, in any language.

---

## 8. Plain-language verdict

Jev is real, is being adopted as a standard "LLM-ish provider" by several visible agent/observability projects, and is documented, deliberately, as a routing/classification tool with a 255-option `choice` primitive built for exactly this shape of problem. But at the specific altitude the owner needs — "can an external jev classifier replace an agent harness's native skill/tool listing, at agent-harness option counts, in Japanese, with a follow-rate and task-outcome measurement" — the evidence thins out fast:

- The vendor documents the *pattern* (intent routing, model routing) but publishes **zero accuracy or calibration numbers** for it, in any language, at any option count.
- The single most production-credible example (BuilderIO, 6.3k★, merged and live) uses jev to **supplement**, never replace, the native listing, with a hard fallback to the old path on any failure, and reports **no selection-accuracy number**, only test-pass counts.
- The single most directly relevant open-source router for a coding-agent harness (Switchboard) explicitly disclaims that its jev-driven choices are "measured guarantees," and nobody — including its own issue tracker — has published an accuracy number for it either.
- The only benchmark found that directly compares jev-based routing against a simpler baseline (ToolSpeeder) shows a **marginal** accuracy edge (95.8% vs 95.0%) bought at roughly **1,400x** the latency, better calibration, and its own authors' verdict is "keep it optional, don't make it the default" — but this source's provenance (0★, unmerged draft, unverifiable protocol files) means it should inform intuition, not be cited as fact.
- The recurring negative pattern across independently-built jev integrations (`pi-jev`'s known fail-open design, and now `dsh-jev`'s open, unresolved silent-no-op bug) is **fail-open on selection failure**, appearing in at least two unrelated codebases — worth treating as a structural hazard of this pattern, not a one-off.
- Japanese coverage, which the owner's prior research flagged as entirely unmeasured across nine reference implementations, now has one small real-API data point (`unirt/jev-eval-ja`: 80–100% on N=10 business-classification cases, self-described as too small to trust) and one rigorous-but-off-target data point (`kamo-shika/jev-bench`: 77.1% on 1,000-item Japanese NLI, explicitly not the real jev API). Neither closes the gap for skill/tool selection specifically.

Given the owner's own already-measured 11.9% follow rate with the native listing still present, and the complete absence anywhere in this survey of a comparable follow-rate or task-outcome number for a hidden-listing arm, the honest reading is: **no source, vendor or independent, has produced evidence that would justify hiding the native listing and trusting jev alone.** The nearest real-world analogues that exist (BuilderIO, Switchboard) both keep a deterministic fallback and neither has published the number that would settle this. The fair-experiment design in §7 is not a formality — it is, on the evidence gathered here, a genuinely unoccupied niche.

---

## 9. Explicit "no precedent found" list

- No vendor-published accuracy/calibration number for the `choice` question type, at any option count, in any language.
- No case found of an agent harness *fully* replacing its native skill/tool listing with jev-only selection (every real example found supplements or operates on a different axis).
- No comparison found of "external jev classifier picks the skill" vs "model reads all descriptions itself," on a real agent-harness skill catalog, by anyone (vendor or independent).
- No statistically powered, Japanese-language, real-API measurement of jev for skill/tool/agent selection specifically.
- No published task-outcome-proxy measurement (as opposed to label-matching accuracy) for any jev-based routing/selection system.
- No independently reproduced, high-provenance benchmark of jev vs. a deterministic/local baseline for routing — the one benchmark found on this exact question (ToolSpeeder) has provenance too weak to cite as fact.
- Could not confirm Mario Zechner's own personal writing on jev in the time budget (his site did not resolve from this session); the pi-adjacent repos already on record (`pi-warden`, `pi-typesafe`, `pi-jev`, `pi-jev-tools`) remain the only pi-ecosystem evidence, per the prior 2026-09-19 review.
- Could not enumerate npm dependents directly (browse page returned 403).
