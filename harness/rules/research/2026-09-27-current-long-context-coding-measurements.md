---
question: 2026-06 以降に公開された測定は、ハーネスに「設定した」context window の値そのものを操作変数として扱っているか — 同じモデルで 200K 設定と 1M 設定を比べたとき、コスト・キャッシュ・品質はどう動くか。そして設定値はどこで効かなくなるか
date: 2026-09-27
verdict: 設定した窓を操作変数にした統制比較は 2026-06〜09 に一件も存在しない。代わりに三種の測定が揃う。(1) 設定値→実効値の変換率 — Codex は利用者が `model_context_window` に何を書いても、同梱 models.json の `context_window` と `effective_context_window_percent`=95 の積で頭打ちになり、1,000,000 や 1,050,000 を書いた報告はすべて 258,400〜272,000 に着地する。OpenAI 自身が 2026-07-18 の PR #33972 で GPT-5.6 の同梱既定を 372,000 から 272,000 へ下げている（ファイル差分で直接確認）。(2) コスト — 窓を上げると 1 リクエストあたりの cache read が膨らむ。Cline #14329 は圧縮点が 0.81×窓 に連動するため 200K → 1M の設定変更だけで発火点が約 150K から約 800K へ移り、1 タスク $49.63・cache hit 12%（対照 98%）を記録した。OpenAI は自社グラフを添えて「272k 超でも出力品質はほぼ同じ、コストのスイートスポットは最大値ではない」と述べた（2026-07-13）。(3) 品質 — 設定値を振った品質比較は存在せず、近いのは充填量を振った研究だけであり、そこでも安定した単一の劣化開始点は出ていない（2607.17937 は約 299,140 文字＝約 75K トークンで 8/10→3/10、ただし p=0.0698 で有意でない）。結論として、200K を下回らせる根拠も 1M を正当化する品質根拠も出ておらず、証拠が支持するのは「窓は速度と 1 リクエストの入力上限を買うが、品質は買わない」という一点である
unverified:
  - Codex の実効窓が「同梱 models.json の context_window × 95%」で決まるという機構は issue 報告者の観察（models_cache.json のダンプ値と CLI 表示の一致、および Sol の値を一時的に書き換えると大きい値が通ったという 1 件）に依拠しており、OpenAI が仕様として明文化した文書は見つかっていない
  - effective_context_window_percent=95 は #29142 / #27743 の models ダンプで確認できるが、272,000 × 0.95 = 258,400 ちょうどに一致しない報告（259,628〜263,127 で失敗、258,400 と 353,400 の振動）もあり、単一の式では説明できない
  - Cline #14329 の $49.63・cache hit 12% は報告者自身が「fresh task / git init / モデル切替」という交絡を認めており、窓設定だけの効果として分離されていない
  - 2607.17937 の劣化（8/10→3/10）は p=0.0698 で有意でなく、n=10 であり、著者自身が「普遍的な文脈長しきい値は支持されない」と書いている
  - LOCA-bench（2602.07962）の表の数値は 2026-02-08 公開で本記録の現行世代条件の外にある。対照としてのみ引いており、現行世代の根拠としては数えていない
  - 200K 設定と 1M 設定を同一モデル・同一タスクで A/B した品質測定は発見できなかった。これは「存在しないことの証明」ではなく「到達できた範囲での不在」
sources_note: web_search は本セッションの egress で全プロバイダ失敗。代わりに (1) `read` による URL 直接取得（Atom/XML は `:raw`。arXiv は export.arxiv.org の API を使用）、(2) 認証済み `gh api`（repos contents / pulls / issues / search）、(3) HN Algolia API、(4) api.fxtwitter.com（X 投稿本文を JSON で返す）を使った。数値はすべて出典 URL と公開日付き。到達できなかったものは §9 に列挙。引用はフェッチ結果からの逐字で、第三経由のものは TRANSCRIBED と明記した
---

# A configured context window buys speed and a per-request input ceiling — not quality

Scope note. This record is the **measurement** leg: it asks what happens to cost, cache, and quality
as a function of the value someone *configures*, and where a configured value stops being the value
in force. Three neighbouring questions are deliberately **not** re-collected here:

- **Which named person sets which value.** That is `2026-09-27-current-generation-context-practice.md`
  (peer record, live at write time — not edited by me). Where I need a person's literal setting I
  cite that path rather than restating the row.
- **Whether to match the vendor's advertised maximum.** That is
  `2026-09-24-context-window-budget-for-1m-models.md` (on disk).
- **Harness trigger defaults.** Contract named
  `2026-09-27-compaction-defaults-across-harnesses.md`; it is absent from disk (§10).

Evidence rule for this record: a configured value counts as measured only if a number exists for
what it cost, what it cached, or what it scored. "I set 1M and it felt better" is collected in the
practitioner record, not here.

## 0. Method and verification legend

- **DIRECT** — the primary artefact (file contents at a git SHA, GitHub issue comment via API, tweet
  JSON, arXiv API entry) was fetched in this session and the quoted text is verbatim.
- **DIRECT (measured)** — a number produced by an instrument rather than asserted: a file diff, a
  tokenizer/pricing table, a fleet trace.
- **VENDOR-INTERESTED** — published by the party that sells the window. Kept, labelled, weighted down.
- **TRANSCRIBED** — obtained through a third party page; canonical URL given.
- **NOT CURRENT-GENERATION** — published before 2026-06-01. Included only as contrast, always labelled.
- **NON-EVIDENCE** — recorded so the search is not repeated; excluded from the verdict.

Retrieval paths that worked: `read` on a URL (append `:raw` for Atom/XML — without it titles and
summaries are stripped), `gh api` authenticated as `esh2n`, the HN Algolia API
(`hn.algolia.com/api/v1/...`), `api.fxtwitter.com/<handle>/status/<id>`, and the arXiv export API.

Retrieval that failed, recorded as such: `web_search` on every provider (this session's egress);
`simonwillison.net/search` (HTTP 403); `ghuntley.com/rss/` (titles stripped without `:raw`);
`export.arxiv.org` over plain `curl http://` (empty body — the `read` tool over https works).

**Channel bias, stated up front.** The GitHub issue tracker is negative by construction: people file
when the harness contradicts them, so clamp reports over-represent breakage and under-represent the
silent majority for whom a raised window simply worked. Vendor pages and a vendor lead's tweets skew
positive about their own defaults. arXiv preprints are unfiltered by peer review and their titles
over-promise; the ones below are quoted only for the numbers in their abstracts, which are
self-reported by their authors. Production traces (Copilot) are the least biased instrument here —
nobody chose to be in the sample — and also the least controllable.

## 1. A configured number is not the number the harness enforces

This is the mechanism the peer record leaves out and it is the single most useful thing in this
record: everywhere the window is configurable, the configured value feeds a **ratio stack**, and the
ratio is what people trip over.

| Harness | Key you set | What turns it into a usable budget | Worked example | Source (date) | Legend |
|---|---|---|---|---|---|
| Codex CLI | `model_context_window` | `min(yours, bundled `context_window`) × effective_context_window_percent`; the percent is **95** | 272,000 × 0.95 = **258,400** | `codex-rs/models-manager/models.json` at PR #33972 (2026-07-18); #29142 (2026-06-19) | DIRECT (measured) |
| Codex CLI | *(same)* | the **server** catalog can hand back a `max_context_window` lower than the bundled file's | Sol 272,000 vs terra/luna 872,000 from one `/models` call, same ETag | #39144 (2026-08-18) | DIRECT |
| Cline | provider `contextWindow` | `CONTEXT_WINDOW_INPUT_RATIO` 0.9 × `COMPACTION_TRIGGER_RATIO` 0.9 = **0.81 × window** | 162,000 on a 200K window; 810,000 on a 1M window | #14329 (2026-09-20), source-derived at `9a2512bb` | DIRECT |
| pi | `contextWindow` | fires at `window − reserveTokens` | 1,050,000 − 16,384 = **1,033,616** (98.4% of the configured value) | peer record §1, `nicknisi/dotfiles` (2026-09-16) | DIRECT |
| Claude Code | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | fires at `window × trigger fraction`, and the fraction itself moves | 200,000 × 0.73 = **146,000** (the fraction was ~0.83 before) | #86863 (2026-08-15) | DIRECT |

Three consequences follow, and they are what makes "200K vs 1M" the wrong axis:

1. **Changing the window silently changes the compaction trigger.** Cline is the cleanest instance:
   the practitioner did not touch any compaction setting, and moving the model from a 200K window to
   a 1M window moved the effective firing point from ~150K to ~800K tokens, because the trigger is a
   *fraction* of the window. The reporter of #14329 states this as the cause of the bill.
2. **A larger configured value never guarantees a larger enforced value.** Codex reports the clamp
   as fact (below), and Claude Code has an entire gating tier for it.
3. **The pairing matters more than the number.** Every worked configuration in the peer record
   carries a window *and* a compaction point (1,033,616 / 794,000 / 900,000). A window without a
   paired trigger is not a configuration anyone publishes.

### 1a. The hardest number in this record: a shipped default moved down in July 2026

**Codex PR #33972**, authored by `sayan-oai`, merged **2026-07-18**, title *"Backport refreshed
bundled model metadata to 0.144"*. I read `codex-rs/models-manager/models.json` at both ends of the
PR (`gh api repos/openai/codex/contents/...?ref=<sha>` at the PR's base and head SHAs):

```
base 215fb464f1…  gpt-5.6-sol    context_window=372000 max_context_window=372000
                  gpt-5.6-terra  context_window=372000 max_context_window=372000
                  gpt-5.6-luna   context_window=372000 max_context_window=372000

head b06f4fa9f5…  gpt-5.6-sol    context_window=272000 max_context_window=272000
                  gpt-5.6-terra  context_window=272000 max_context_window=272000
                  gpt-5.6-luna   context_window=272000 max_context_window=272000
```

**The shipped default for GPT-5.6 was lowered 372,000 → 272,000 on 2026-07-18.** Not a user setting,
not a doc recommendation — the number in the binary, changed a week after the vendor explained the
cost curve (§3.2). HN story `48965850` (2026-07-19, 371 points, 166 comments) is where the community
noticed; user-level workaround reported there is *"You can set `model_context_window=YOUR_VALUE` in
config"* (`@dannyw`, 2026-07-19), which §2 shows only half-works.

For scale, the model's own page claims 1,050,000 total with 128,000 max output (#47805, 2026-09-24),
so the enforced 272,000 is **25.9% of the advertised figure**.

## 2. What value is actually usable (measured envelope, 2026-06 → 2026-09)

All rows are `gh api repos/openai/codex/issues/<n>` (Codex) or `anthropics/claude-code/issues/<n>`
unless noted. "Configured" is what the user wrote; "reported effective" is what the harness then used.

| Date | Issue | Configured | Reported effective | What the reporter observed |
|---|---|---|---|---|
| 2026-06-12 | #27743 | `model_context_window = 1050000` (Azure OpenAI, 1M) | `context_window: 272000, max_context_window: 1000000, effective_context_window_percent: 95` | Bundled file and models_cache agree; the configured 1.05M is ignored |
| 2026-06-19 | #29142 | model metadata claims `"context_window":1000000` | `effective_input_budget: 950000` | Fails at **259,628–263,127** input tokens |
| 2026-06-19 | #29080 | `1000000` / `auto_compact 900000` | auto-compacts at **~260K** | Directly contradicts the writer's own compact limit |
| 2026-06-19 | #29039 | `gpt-5.5 high`, reports 1M | **258K** mid-thread | Window changes silently during one task |
| 2026-07-01 | #30875 | — | oscillates **258,400 ⇄ 353,400** | Same session, no action |
| 2026-07-13 | #32803 | — | 360K → **258K** | Shrink after an upgrade |
| 2026-07-21 | #34619 | — | 272,000 raw / **258,400** effective | Requests restoration of the earlier 372,000 / 353,400; states the loss as **a 95,000-token, ~26.9% reduction** |
| 2026-08-18 | #39144 | Sol raised by editing `models_cache.json` | **872,000 → back to 272,000** after cache TTL | The one clean demonstration that the catalog wins: the hand-edit worked until the TTL expired |
| 2026-08-24 | #40347 | — | **828.4K ⇄ 258.4K** | Flips within a single task |
| 2026-08-28 | #41325 | bundled source limit raised | **872K remote cap** | *"the ChatGPT-backed Codex service enforces a remote 872K cap even after the bundled source limit is raised"* |
| 2026-09-08 | #43648 | `model_context_window = 450000`, `auto_compact = 400000` | compaction fired at **400,990** | **Honored** — window and trigger both respected |
| 2026-09-24 | #47805 | `model_context_window = 1000000` | **828,400** | Highest effective ceiling observed anywhere; `session token_count.info.model_context_window = 828400` |

Claude Code side, same period:

| Date | Issue | Configured | Reported effective |
|---|---|---|---|
| 2026-08-05 | #84310 | `[1m]` model variants | Sonnet 5 stuck at **200K**; *"Opus 5 with 1M context works correctly on the same account"*; all four context env vars unset |
| 2026-08-13 | #86470 | `/model claude-opus-4-6` | **200K** window |
| 2026-08-24 | #87510 | — | prompt over 1M served, but the CLI truncates at **40%** of the window and issues a hard 10-minute stall |
| 2026-09-03 | #91840 | `{"model": "claude-opus-4-6[1m]"}` in global `settings.json` | Desktop sessions start at **200k**; `/context` confirms 200k |
| 2026-09-12 | #93808 | `autoCompactEnabled: false`, no 1M env vars | 663,871-token prompt **served** by 2.1.257, **rejected** by 2.1.269 as "Prompt is too long" — same conversation carried 679,998 tokens on 2.1.197 (2026-07-01) |
| 2026-09-16 | #94665 | — | *"We only have 200k context and 1 mil context, can we get a middle ground? 1 mil context too costly and 200k context too short for real work"* |

**The envelope, stated plainly.** In 2026-06 → 2026-09 the *enforced* Codex budget reported by users
sits between **258,400** (the floor whenever the clamp wins) and **828,400** (the highest ceiling
anyone reported), with a hard community memory of **353,400** as the value that used to be normal
before 2026-07-18. Configurations in the **400,000–450,000** band are the ones demonstrably honoured
(#43648 fired at 400,990 exactly where its own trigger said). Configurations written as 1,000,000 or
1,050,000 land at either 258,400 or 828,400 and the reporter cannot tell which in advance.

On the Claude Code side, **every 1M variant is gated behind usage credits**; the largest cluster of
issue titles matching `1M context` on that tracker is raw *"Usage credits required for 1M context"*
account failures (#63060, #65514, #63896, #64398, #66067, #64544, #65340, #61692, #65205, #63141,
#68727, #63015). A separately large cluster is 1M-variant **safeguard false positives** (#96676,
#96136, #95451, #97395, #96874, #96648, #96461, #97477, #95843, #96254, #96377, #96118) — i.e. the
accessor to the big window is a different product tier with a different failure surface.

## 3. Cost and cache, as a function of the configured window

### 3.1 The only practitioner-measured case: Cline #14329 (2026-09-20)

`github.com/cline/cline/issues/14329`. The reporter moved to a provider that exposes a **1M** window
instead of **200K** and **changed nothing else**. Measured outcome of one task on Sonnet 5:

- context used **294.9k / 1.0m**
- **24.1m prompt tokens**, 62.4k completion, 32.8k cache writes, **3.3m cache reads**
- **$49.63 reported cost**, **cache hit rate 12%**
- comparison task on Sonnet 4.6 with a 200K window: **~98% cache hit**

Mechanism, derived from Cline's own source at `9a2512bb` by commenter `pm25coder` (2026-09-20):
`CONTEXT_WINDOW_INPUT_RATIO = 0.9` × `COMPACTION_TRIGGER_RATIO = 0.9`, applied at
`sdk/packages/core/src/extensions/context/compaction-shared.ts:13-17` and consumed at
`compaction.ts:352` as `requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO`. So the
trigger is **0.81 × the configured window**: ~162k at 200K, ~810k at 1M, with a downstream
`resolveAutoRequestTargetTokens = 0.7 × trigger`. The reporter's own framing is that raising the
window *disabled* compaction, not that the model got worse.

Maintainer `dominiccooney` replied (2026-09-21) that the model must be present in Cline's
`models.json` for the setting to bind, and demonstrated the **supported** direction of travel — a
down-cap, not an up-cap:

```json
{ "claude-sonnet-5": { "contextWindow": 250000, "maxInputTokens": 250000 } }
```

Two clocks to read this by. First, **the confounds the reporter stated himself** — fresh task,
`git init`, and a model switch — so $49.63 is not "the price of a 1M window" in a controlled sense.
Second, the **direction**: the maintainer's answer to a high bill is to lower the configured window
to 250,000, and the reporter's own conclusion is the same.

### 3.2 The vendor's cost curve, and the decision that followed it

`@thsottiaux` (Tibo, Codex & ChatGPT @OpenAI) posted a chart on **2026-07-13**,
`x.com/thsottiaux/status/2076543065045795309` (note-tweet; 350,455 views, 1,833 likes; replying to
`@theo`). Verbatim, DIRECT via `api.fxtwitter.com`:

> "The overall trajectory length, which is the total some of all context windows across compactions,
> changes little based on the reasoning effort. Similarly the quality of the overall output is
> similar across context lengths above 272k. The benefits of higher context lengths are mostly
> overall speed (as you don't wait for compaction), ability to deal with humongously large input and
> potentially cost if the system is well tuned and you hit your cache perfectly."

> "The actual reason is the what you can see depicted in the chart below, which is the difference in
> the orange line and the blue line. It is caused by overall cost of cache reads going up with the
> size of the context being shuffled back and forth between toolcalls. The sweet spot in terms of
> cost is therefore not necessarily to use the maximum possible context length."

> "What we're working on is tuning the system differently so that we can go back higher without it
> resulting in higher usage being charged."

And one day earlier, **2026-07-12**, `status/2076201049086648705`, replying to `@mylifcc`:

> "This is not correct. Do not do this if you do not understand exactly what you are doing. We do not
> charge extra above 270k context and the context threshold has been tuned for GPT 5.6 Sol to be
> perfect at the default limit."

**VENDOR-INTERESTED, and load-bearing anyway**, for three reasons. (a) The five days between the
tweet (2026-07-13) and the merged PR that lowered the shipped default (2026-07-18) make a causal
story that the diff in §1a independently confirms — the direction of pressure from the party with
the cost data is *down*, not up. (b) It is the only source in 2026-06→09 that states a quality
result as a function of context length with the vendor's own charts behind it: flat above 272k.
(c) It is contradicted by named-practitioner reports in the same window — `@kelnos` (2026-06-14,
`news.ycombinator.com/item?id=48524620` thread) writes *"I routinely push past 500k tokens, even
sometimes up to around 800k tokens, and don't see this problem"*, and `@arcanemachiner` in the same
thread: *"Opus 4.6 was on drugs past 200k, I skipped 4.7, 4.8 did good up to ~350k, and Fable did
great beyond 400k"*. Flat-above-272k is a claim about OpenAI's own tuning for its own subscription
economics; it is not a law, and the counter-reports are about a different vendor's models.

### 3.3 Production traces: cache dies at compaction, and that is the cost mechanism

**"Agentic Coding in the Wild: Characterizing GitHub Copilot Traces at Production Scale"**,
arXiv `2608.00101v1`, published **2026-07-30**, Liu, Qiu, Goiri, Fonseca, Bianchini, Choukse
(DIRECT via the arXiv API). Scale, verbatim: *"sampled GitHub Copilot traces from June 2026,
comprising 3.2M users, 13M sessions, 761M LLM calls, and 95T tokens."* The load-bearing sentence:

> "This structure yields KV cache hit rates averaging 90% within a turn, but falling to 55\% across
> turn boundaries and drastically invalidated after events like model switches or context compaction."

That is the measurement behind §3.2's "cost of cache reads going up". Compaction is not a neutral
housekeeping step: it destroys the prefix cache, and the prefix is the thing you were paying cache-read
rates to keep cheap. Compaction is also frequent, not exotic: **7.8% of sessions, 44.2% of total
tokens, and 37.1% of LLM calls**. In wall-clock terms the paper reports compaction consuming a median
of **22% of a turn** with a **P90 of 34%** — which is the honest quantification of the one benefit the
vendor attributes to a larger window ("you don't wait for compaction").

The same paper's pre-compaction utilization distribution is the best available evidence that fleet
behaviour is multi-modal rather than one-threshold: peaks near ~50%, ~65–66%, ~80%, and a tail
approaching the window, which the authors read as *"the distribution indicates multiple thresholds"*.
Practitioners are not converging on one number.

### 3.4 Why a wider window costs more even when the per-token price is flat

- **Anthropic** (`platform.claude.com/docs/en/about-claude/pricing`, page updated 2026-09-19):
  Claude 4.6 and later, including the `[1m]` variants, are priced at **standard rates** — the older
  long-context premium is gone. Cache reads are **0.1× base input**. A 5-minute cache write is
  **1.25×**, a 1-hour write is **2×**. 4.7 and later use a tokenizer that produces **≈+30% tokens**
  for the same text.
- The cost growth at a wide window therefore comes from three places, none of which is the headline
  token price: **(i) cache reads scale with the shuffled prefix** (Tibo's "orange line vs blue
  line"); **(ii) cache invalidation at every compaction and model switch** (Copilot traces, −66.1%
  median hit rate); **(iii) cache *writes* at 1.25×–2× when the prompt is recreated instead of read.**
- **Claude Code #70459 (2026-06-23)** is the pathological case: `/compact` reused a 47-minute-stale
  precompute summary and kept **~200k tokens verbatim**, so the bloated prefix was cache-**created**
  at $10/MTok (1h write) instead of cache-**read** at $0.50/MTok — roughly **20× more, recurring on
  every precompute**.
- **Claude Code #28927 (2026-02-26, NOT CURRENT-GENERATION)** is the cleanest accidental A/B of a
  version change at a fixed workload: Feb 23 on v2.1.50 → 644 Opus-1M API calls and 85,100,082
  cache-read tokens with no extra-usage impact; Feb 25 on v2.1.51+ → 392 calls and 80,173,520
  cache-read tokens for **+17% ($48.79 total)**. Included only as contrast; it is pre-window.

## 4. Quality as a function of the configured window

### 4.1 The measurement does not exist

I could not find, anywhere in 2026-06 → 2026-09, a study, a vendor benchmark, or a
practitioner-published A/B that holds the model and task fixed and varies **the configured window**
(200K setting vs 1M setting) while reporting a quality outcome. This is stated as a finding, not a
gap in effort: §9 lists what was tried. The claim "1M gives better quality" and the claim "200K is
enough" are both, in the 2026-06→09 record, **unsupported by measurement of the setting**.

### 4.2 The nearest substitutes, and exactly why they are not it

| Work | Date | What it actually varies | Why it is not the configured window |
|---|---|---|---|
| **LOCA-bench** `2602.07962` (Zeng, Huang, He) | 2026-02-08 — **NOT CURRENT-GENERATION** | environment-state complexity, so context grows under fixed task semantics | varies *fill*, not the *setting*; and pre-window |
| **When and How Context Rot Appears in Coding Agents** `2607.17937v2` (Yue Xue) | 2026-07-20 (v2 2026-08-01) | injected surrounding context at fixed task and 24 fixed checks | varies *fill*: clean 10,991 chars vs 299,140 chars |
| **Lost in Compaction** `2608.11242v1` (Wang, Zhang, Lee, Yang) | 2026-07-31 | the compactor, at fixed task | varies *compaction*, the thing a wider window postpones |
| **Classifier Context Rot** `2605.12366v1` (Martin, Roger) | 2026-05-12 — **NOT CURRENT-GENERATION** | transcript length in front of a *monitor* model | different task (monitoring), and pre-window |
| **How Inference Compute Shapes Frontier LLM Evaluation** `2606.17930v3` (McFadyen et al.) | 2026-06-16 | token budget / compaction / retries, as inference-scaling knobs | budget is a *per-run spend* knob, not a configured window |
| **The Complexity Trap** `2508.21433v3` (Lindenbauer et al.) | 2025-08-29 (v3 2025-10-27) — **NOT CURRENT-GENERATION** | masking vs summarization | a compaction-strategy comparison; no window value |

### 4.3 The numbers these studies do produce, with their limits attached

- `2607.17937` (DIRECT, arXiv API): *"Codex with gpt-5.4-mini passes 8/10 runs in a 10,991-character
  clean context but only 3/10 in both a 299,140-character relevant context and an equal-length
  irrelevant context. This 50-percentage-point difference is large but remains trend-level under
  two-sided Fisher tests (p = 0.0698)."* Two things matter for the house's 170K trigger. First,
  **299,140 characters is roughly 75,000 tokens at 4 chars/token** — the degradation in this case
  study appears *below* a 200K window, so "we compact at 170K, therefore we are safe" does not follow
  from it. Second, and more important: *"Requirement coverage nevertheless stays above 92% in both
  long conditions"* and *"the evidence does not support a universal context-length threshold"* — the
  failure was a handful of omitted checks, not a collapse. The paper's own remedy is a scaffold
  effect, not a window: *"A detailed external checklist passes 10/10 runs, compared with 5/10 for a
  generic self-check (p = 0.0325)."*
- `2608.11242` (DIRECT): *"Current compactors retain only 17% of injected SCs on average, and most
  perform worse than running the same task without compaction."* This is the strongest measured
  argument for a **larger configured window** in the whole record — every compaction avoided is a
  session constraint not silently dropped — and it is a result about compactors, not about windows.
- `2608.00101` §3.3: compaction is **44.2% of all tokens** fleet-wide, and it is what invalidates the
  cache. This is the strongest measured argument for a **smaller** configured window.
- `2605.12366` (DIRECT, NOT CURRENT-GENERATION): *"Opus 4.6, GPT 5.4, and Gemini 3.1 miss these
  actions $2\times$ to $30\times$ more often when they occur after 800K tokens of benign activity than
  when they occur on their own."* Relevant as an *upper-end* warning — it is the one measured result
  that says something is materially worse at 800K fill — but the task is a safety monitor's
  classification, not coding.
- `2606.17930v3` (DIRECT): *"larger token budgets substantially improve performance on benchmarks
  across multiple domains"* and *"fixed-budget evaluations can increasingly understate frontier
  capability as models advance"*. This is the strongest measured argument that being stingy has a
  cost — but its knob is the **per-run budget**, and the mechanisms it tests include context
  compaction, so it is compatible with either window value.
- `2602.07962` (DIRECT, NOT CURRENT-GENERATION): *"While agent performance generally degrades as the
  environment states grow more complex, advanced context management techniques can substantially
  improve the overall success rate."* Contract-level, and pre-window. Its recurring-reminder
  mitigation finding was not independently confirmed in 2026-06→09 in this session.

**Read together, §4.3 does not converge.** The same 2026-06→09 corpus contains a measured argument for
a wider configured window (constraint loss under compaction) and a measured argument for a narrower
one (cache and token cost of the compactions a wider window postpones). Neither is a quality result
about the setting. That non-convergence is the finding.

## 5. Summary table

| Source | Date | Task type | Configured value | Result | Cost numbers | Named failure modes |
|---|---|---|---|---|---|---|
| Codex `models.json` @ PR #33972 (DIRECT, measured) | 2026-07-18 | shipped default | — | **372,000 → 272,000** for gpt-5.6-sol/terra/luna | — | default silently lowered; users discovered it via #34619 |
| Codex #29142 (DIRECT) | 2026-06-19 | coding | 1,000,000 claimed | fails at 259,628–263,127 input tokens | — | metadata says 1M, `effective_input_budget 950000` |
| Codex #39144 (DIRECT) | 2026-08-18 | coding | catalog hand-edited | 872,000 honored until cache TTL, then 272,000 | — | **user's edit reverted by the server catalog** |
| Codex #43648 (DIRECT) | 2026-09-08 | coding | `window 450000` / `compact 400000` | compaction fired at **400,990** | — | none — the honored case |
| Codex #47805 (DIRECT) | 2026-09-24 | coding | 1,000,000 | effective **828,400** | — | advertised 1,050,000 = 3.9× the shipped 272,000 default, 1.27× the enforced value |
| Codex #34619 (DIRECT) | 2026-07-21 | coding | — | wants 372,000/353,400 back | — | **−95,000 tokens, −26.9%** effective |
| Codex #41325 (DIRECT) | 2026-08-28 | coding | bundled limit raised | remote **872K** cap still applies | — | source allows it, service refuses it |
| Claude Code #93808 (DIRECT) | 2026-09-12 | coding | `autoCompactEnabled: false` | 663,871-token prompt served by 2.1.257, **rejected** by 2.1.269 | — | same conversation carried 679,998 tokens on 2.1.197 |
| Claude Code #94665 (DIRECT) | 2026-09-16 | coding | — | asks for a middle ground | *"1 mil context too costly"* | 200K too short / 1M too expensive |
| Claude Code #70459 (DIRECT) | 2026-06-23 | `/compact` | — | ~200k tokens kept verbatim via a 47-min-stale summary | **~20× more** (cache-create at $10/MTok vs read at $0.50/MTok) | recurring on every precompute |
| Cline #14329 (DIRECT) | 2026-09-20 | coding, 1 task | provider 200K → **1M**, nothing else | trigger moved ~150K → ~800K; **0.81 × window** | **$49.63**, 24.1m prompt tokens, **cache 12%** vs 98% control | compaction silently disabled by raising the window |
| `@thsottiaux` (DIRECT, VENDOR-INTERESTED) | 2026-07-13 | vendor position + chart | 272,000 default | *"quality of the overall output is similar across context lengths above 272k"* | *"cost of cache reads going up with the size of the context"*; *"sweet spot … not necessarily … the maximum possible context length"* | — (denies 2× charging above 272k) |
| `2608.00101` Copilot traces (DIRECT) | 2026-07-30 | production fleet | — | 13M sessions / 95T tokens | cache hit **90% → 55% across turns**, invalidated by compaction; compaction = **44.2% of tokens**, median **22%** of a turn | multi-modal utilization: ~50 / ~65 / ~80% clusters |
| `2608.11242` Lost in Compaction (DIRECT) | 2026-07-31 | compaction integrity | — | **17%** of session constraints retained on average | — | *"most perform worse than running the same task without compaction"* |
| `2607.17937` white-box context rot (DIRECT) | 2026-07-20 | code auditing | — | 8/10 → 3/10 at 299,140 characters (~75K tokens), **p=0.0698** | — | relevant and irrelevant context degrade equally; **no universal threshold** |
| `2606.17930v3` inference compute (DIRECT) | 2026-06-16 | 7 benchmarks | budget/compaction/retries | *"larger token budgets substantially improve performance"* | — | single-budget evaluations understate capability |
| `2605.12366` Classifier Context Rot (DIRECT, NOT-CG) | 2026-05-12 | safety monitoring | — | **2× to 30×** more misses after 800K of benign context | — | monitors overstate performance without long-context degradation |
| `2508.21433v3` Complexity Trap (DIRECT, NOT-CG) | 2025-08-29 | SWE-bench Verified | — | observation masking **halves cost** and matches summarization | −7% / −11% for the hybrid | pure LLM summarization is not justified |
| Anthropic pricing (DIRECT) | 2026-09-19 page | pricing | 1M at standard rates | no long-context premium on 4.6+ | cache read 0.1×, 5-min write 1.25×, 1-h write 2×; 4.7+ tokenizer **≈+30% tokens** | — |

## 6. Verdict

### The setting is never the budget, and the gap is one to four times the number

Every harness in the table transforms the configured value before using it, and the transforms differ
by a factor of 0.81 (Cline), 0.95 (Codex), ~0.98 (pi with a 16K reserve), and 0.73-and-drifting
(Claude Code). Codex goes further and clamps against a catalog the user does not control, so the same
literal `1000000` produced 258,400 for one reporter and 828,400 for another, and the one person who
successfully overrode it watched the override expire with the cache TTL (#39144). **A recorded
configured value is therefore evidence about intent, not about the budget in force** — which is the
main caution this record adds to the peer record's table.

### The party with the cost data pushed the default down, and the diff proves it

On 2026-07-13 the Codex lead said, with a chart, that quality is flat above 272k and that the cost
sweet spot is below the maximum. On 2026-07-18 the shipped `models.json` moved 372,000 → 272,000 for
all three GPT-5.6 variants. Ten days later, users were filing issues asking for the old number back
(#34619: −95,000 tokens, −26.9%). This is the single clearest 2026-06→09 datum about direction of
travel, and it points **away** from 1M as a default.

### Nobody published a quality A/B on the setting, so both camps are arguing from cost

The 200K camp argues cache (Cline's 12% vs 98%; the Copilot traces' compaction-invalidated cache) and
the 1M camp argues constraint loss (17% retention under compaction) and wall-clock (compaction is 22%
median of a turn). Both of those are real, measured, and about *cost and mechanics*. Not one source in
the window measured quality as a function of the configured window. When a source asserts flat
quality above 272K, check who is paying for the tokens (§3.2 is the vendor; §4.3's counter-reports are
named practitioners on a different vendor's models).

### The degradation onset is not a scalar, and the nearest measurements sit below 200K

No 2026-06→09 source produces a single token count at which quality falls off. The nearest thing —
`2607.17937`, trend-level, n=10 — sees 8/10 → 3/10 at roughly 75K tokens of injected context, i.e.
*below* the house's 170K trigger, and its own author declines to claim a universal threshold. The
Copilot traces see fleet utilization clustering at ~50%, ~65%, and ~80% of window, which reads as
several different practitioner thresholds rather than one capability cliff. The honest statement is
that onset is **task-dependent and scaffold-dependent**, and that a 170K trigger is neither obviously
safe nor obviously wasteful on the evidence available — but it is not contradicted by anything either.

### The measured case for a wider window exists, and it is not about the model's attention

`2608.11242` — compactors retain 17% of session constraints and usually do worse than no compaction —
is a real, quantified argument for postponing compaction, which is exactly what a wider configured
window buys. It is an argument about the **compactor**, and it points at improving or bypassing
compaction rather than at raising the window. `2608.00101` and Cline #14329 show what raising the
window costs when the trigger moves with it. A harness that raises the window *and* holds the trigger
independently (as the house already does: `maxContextWindow: 1000000` with a fixed 170K trigger) is
doing the one thing the evidence supports and neither camp's failure mode.

### What the evidence supports for the house's 200K / 170K split

It supports **keeping 200K as the default**, for the narrow reason that 200K plus a 170K trigger is a
configuration whose two numbers are independent, which is the property every measured failure above
lacks (Cline's trigger is welded to the window; Codex's window is welded to a catalog; Claude Code's
trigger fraction drifts with releases). It does **not** support lowering 200K — nothing measured puts
a cliff below 200K — and it does **not** refute deliberate widening to 1M for large-input tasks,
where the only measured benefit is speed and input room, not quality. The one thing the evidence
affirmatively recommends is to buy constraint retention by fixing compaction (an external checklist / 
an SC-aware extractor, both measured at >90% retention) rather than by raising the window.

## 7. No precedent found

- **No 2026-06 → 2026-09 source A/Bs a 200K configured window against a 1M configured window on the
  same model and task with a quality outcome.** Nothing approaches it.
- **No vendor or third-party benchmark reports quality as a function of the configured window.**
  Benchmarks vary fill or strategy (§4.2), never the setting.
- **No OpenAI- or Anthropic-authored document** stating the Codex transform
  `min(configured, catalog) × 95%` as a documented rule. It is inferred from issue dumps and one
  successful hand-edit (#39144). Marked unverified in the frontmatter.
- **No measured case where raising the Codex window produced a sustained larger budget.** Every
  sustained report lands at 258,400 or 828,400; the one that moved was reverted by the cache TTL.
- **No published `settings.json` or config from a *named* practitioner** showing a *measured* cost or
  quality delta from changing the window in-window. The peer record owns the values; the outcomes
  attached to those values are 3 failures out of 4 and no cost measurement.
- **No cost incident attributed to the Claude Code 1M setting itself** beyond #28927's +17% (which is
  a version change, pre-window). The 1M failures reported are *access* failures (usage credits,
  safeguards), not *cost* failures.
- **No numbers at all** on degradation onset specifically for the current generation of models
  (Opus 4.6+, gpt-5.6, Gemini 3.x) — `2605.12366` covers Opus 4.6 in an 800K *monitor* setting and
  `2607.17937` covers gpt-5.4-mini in a 75K-token audit setting; neither is the coding-agent question.

## 8. Relations to the other records, and one citation fact

- **`2026-09-27-current-generation-context-practice.md`** (peer, live at write time; not edited by me)
  owns the literal per-person values. Its unverified list flags `@mycall`'s `model_context_window =
  27000` / `model_auto_compact_token_limit = 17000` as a possible typo for 270000/170000. This
  record does not resolve it and does not restate the row; the surrounding evidence in §2 (every
  2026-06→09 Codex configuration in the 270K region is written as `272000`, and the deliberate
  down-cap discussed by `@mylifcc` is `272000`/`240000`) makes a transposition plausible but does not
  establish it.
- **`2026-09-24-context-window-budget-for-1m-models.md`** (on disk) already covers the vendor-max
  question and cites Cline #14329 and pi #9482. This record goes deeper on #14329 (the 0.81 arithmetic,
  the maintainer's down-cap reply, the reporter's own confounds) and does not repeat its vendor survey.
- **Four paths named by my contract do not exist on disk at write time** —
  `2026-09-27-practitioner-context-management.md`, `-context-management-lab-guidance.md`,
  `-japanese-practitioner-context-practice.md`, `-compaction-defaults-across-harnesses.md`. `read` and
  a recursive `find` both report them absent; `INDEX.md` was modified 2026-09-27 22:48. I therefore
  cite no content from them here.
- **Citation fact, verifiable independently of any missing file.** arXiv `2605.12366` is *"Classifier
  Context Rot: Monitor Performance Degrades with Context Length"* (Sam Martin, Fabien Roger,
  2026-05-12) — confirmed by direct API fetch. The paper commonly called *"The Complexity Trap:
  Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management"* is
  `2508.21433` (Tobias Lindenbauer et al.), confirmed by direct API fetch. A sibling record is
  reported to attribute "The Complexity Trap" to `2605.12366`; because that file is not on disk I
  cannot confirm the attribution, so I record only the ID-to-title mapping, which is directly checked.
- **`INDEX.md` was not edited.** Proposed line, for the main session to place:

  `- [設定した context window は測定上何を買うか — 同じモデルで 200K と 1M を比べた測定は存在するか](2026-09-27-current-long-context-coding-measurements.md) — 設定窓を操作変数にした品質比較は 2026-06〜09 に存在しない。窓は変換率（Codex 0.95×カタログ、Cline 0.81×窓）で目減りし、窓を上げると圧縮点も連動して動くためコストはキャッシュ失効で膨らむ（Cline 1 タスク $49.63・cache 12% 対 98%）。OpenAI は 2026-07-18 に同梱既定を 372,000→272,000 へ下げ、1M を正当化する品質根拠はどの角度からも出ていない。劣化開始点は単一値ではなく、最も近い測定は約 75K トークンで有意でない (2026-09-27)`

## 9. Unreachable

- `web_search` — every provider failed in this session's egress (recorded by the peer record as
  startpage / duckduckgo / ecosia / google / mojeek). No search-based discovery was possible; all
  sources below were reached by direct URL, `gh api`, HN Algolia, fxtwitter, or the arXiv API.
- `simonwillison.net/search/?q=...` — HTTP 403.
- `ghuntley.com/rss/` — items returned with titles stripped unless `:raw` is appended.
- **X/Twitter has no search endpoint.** Tweet IDs must be harvested from issues, blogs, or HN; the
  `api.fxtwitter.com` single-status route works. Videos and images in tweets (including the cost
  chart in `2076543065045795309`) were **not** read — only the tweet text is quoted, and the chart's
  axes are therefore NOT-EVIDENCE here.
- **Reddit / Lobsters / vendor Discord and Slack archives** — not attempted with a working path in
  this session. Any 2026-06→09 discussion there is unreached, not absent.
- **Paywalled or JS-rendered vendor blog posts** (some `learn.chatgpt.com` and
  `platform.claude.com` subpages render client-side) — the pricing page resolved; deeper model pages
  did not always.
- **The four sibling record paths named by the contract** — absent from disk (§8).
- **Non-English practitioner corpora** (Chinese-language blogs, Japanese Zenn/Qiita) — not searched
  in this leg; a Japanese-only record is named in the contract and was not reachable.

## 結論（一段落）

「設定した窓の値」を操作変数にした統制比較は 2026-06〜09 に一件も存在せず、200K と 1M の品質差を測った数字はどこにも無い。代わりに測れているのは三つで、いずれも品質ではない。第一に変換率で、設定値はそのまま使われない。Codex は同梱カタログと 95% 係数の積で頭打ちになり（同じ `1000000` が 258,400 にも 828,400 にもなる）、Cline は圧縮点が窓の 0.81 倍に溶接され、Claude Code は発火率そのものが版ごとに動く。第二にコストで、窓を上げると 1 リクエストの cache read が膨らみ、圧縮は prefix cache を破壊する（Copilot の本番トレースでキャッシュヒットはターン内 90% からターン境界 55% へ落ち、圧縮は全トークンの 44.2% を占める中央値でターンの 22% を食う）。Cline #14329 は同じモデルで窓を 200K から 1M にしただけで 1 タスク $49.63・キャッシュヒット 12%（対照 98%）を記録した。第三に方向で、2026-07-13 に OpenAI の Codex 責任者が「272k 超では出力品質はほぼ同じ、コストのスイートスポットは最大値ではない」と自社グラフを添えて述べ、その 5 日後の 2026-07-18 に同梱既定が 372,000 から 272,000 へ下がった（PR #33972 のファイル差分で直接確認）。1M の側に立つ測定は「圧縮がセッション制約の 83% を落とす」（2608.11242）だけで、これは圧縮の欠陥であって窓の効能ではない。劣化開始点は単一の値では出ておらず、最も近い測定は約 75K トークンで 8/10→3/10（p=0.0698、有意でない）、本番の充填率分布は 50%・65%・80% に山が分かれる。したがって、omp の 200K 既定と 170K 発火点という「窓と発火点が独立している」構成を否定する証拠は無く、窓を下げる根拠も、1M へ広げて品質が上がる根拠も無い。唯一の積極的な示唆は、制約保持を窓ではなく圧縮側の修正（外部チェックリスト 10/10、SC-aware extractor 90% 超）で買え、という一点である。

**Proposed INDEX line (text only; `INDEX.md` was not edited):**

- [設定した context window は測定上何を買うか — 同じモデルで 200K と 1M を比べた測定は存在するか](2026-09-27-current-long-context-coding-measurements.md) — 設定窓を操作変数にした品質比較は 2026-06〜09 に存在しない。窓は変換率（Codex 0.95×カタログ、Cline 0.81×窓）で目減りし、窓を上げると圧縮点も連動して動くためコストはキャッシュ失効で膨らむ（Cline 1 タスク $49.63・cache 12% 対 98%）。OpenAI は 2026-07-18 に同梱既定を 372,000→272,000 へ下げ、1M を正当化する品質根拠はどの角度からも出ていない。劣化開始点は単一値ではなく、最も近い測定は約 75K トークンで有意でない (2026-09-27)
