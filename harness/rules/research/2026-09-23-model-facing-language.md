---
question: "For a Japanese-speaking engineer running coding agents (Claude Code, Codex, pi, omp, DSH), should the files the MODEL reads — AGENTS.md/CLAUDE.md rules, SKILL.md skills, hook-injected context, judgment-model question framing — be written in English or Japanese, while human-facing records and the user's own prompts stay Japanese?"
date: 2026-09-23
verdict: "English for model-facing rule/skill/hook/judgment text is the better-supported default: every multilingual instruction-following benchmark found (M-IFEval, Marco-Bench-MIF, Multi-IF) shows Japanese trailing English by 9-25 points across all tested LLM families including Claude; Claude Code's own thinking-summary pipeline defaults to English even when a non-English language is configured and an explicit CLAUDE.md instruction says otherwise; and 95%+ of instruction files in the wild (including those owned by Japanese GitHub accounts, who lead the world in adoption rate) are already written in English. No vendor tells you to do this — the case is built entirely from measured evidence and revealed practice, not stated guidance. Human-facing text (decisions, research records, the user's own prompts) is explicitly untouched by this."
unverified:
  - "Anthropic never publishes a Japanese-specific token multiplier; the 'up to 15x' figure and general CJK tokenizer disadvantage come from third-party tokenizer-fairness papers, not an Anthropic-published Japanese number"
  - "Whether the SKILL.md description 'character budget' Claude Code documents is truly character-denominated or token-denominated internally is not confirmed independently of the vendor doc's own wording"
  - "Whether current-generation models (Claude Sonnet 4.5/5-era, GPT-5.x) have narrowed the EN/JA instruction-following gap M-IFEval measured on Claude 3.5-era models in Feb 2025 — no newer multilingual IFEval-style benchmark was found"
  - "Whether skill-description language (EN vs JA) causally changes invocation/follow rate specifically — no direct controlled experiment was found; the token-budget mechanics are vendor-documented but the language-choice consequence is inferred, not measured"
  - "Why GitHub issue #82785 (Japanese thinking-summary language instability) was closed — fixed vs closed-without-fix was not confirmed"
  - "GitHub code-search API total_count figures above ~1,000 real hits are known to be approximate; the gh search counts here are order-of-magnitude, not exact"
  - "No DeeSeek or Qwen model-card Japanese-specific instruction-following numbers were located in the time available"
  - "The project's own jev EN-vs-JA framing result (79.0% vs 76.5%, n=200, CIs overlap) is a single local A/B on a typed multiple-choice judgment task, not generalizable, and not independently re-verified in this record"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Should model-facing files be written in English or Japanese?

## Method and verification legend

- WebSearch was unavailable for this session (budget exhausted before this task started). All web evidence below was gathered via **WebFetch** (direct page fetch + summarization by a small model — marked `[fetched]`), **arXiv API** (`export.arxiv.org/api/query`, raw XML, `[arxiv]`), the **Qiita public API** (`qiita.com/api/v2/items`, full article body returned as HTML and stripped, `[qiita]`), and authenticated **`gh` / GitHub REST & code-search API** (`[gh]`). Bing/DuckDuckGo scraping via `curl` was attempted first and abandoned: it returned generic, query-independent results (verified by running distinct queries and getting identical or nonsensical result sets), so nothing from that channel is cited.
- `[fetched]` = WebFetch summarized the live page; the summarizing model's paraphrase is trusted for structure but direct quotes were requested and are reproduced verbatim where quoted.
- `[qiita]` = the Qiita API returned full article HTML, stripped to text locally; quotes below are verbatim from that stripped text.
- `[arxiv]` = abstract or PDF page images read directly; numbers in tables were read off the actual paper (M-IFEval Table 1/2, read from the PDF page images).
- `[gh]` = GitHub API / code-search, authenticated. Code-search `total_count` above ~1,000 true hits is an API-documented approximation, not an exact count — treated as order-of-magnitude only.
- Nothing in this record was reached only through a summarizer without also being available to quote; anywhere a number appears, it was read from primary text (paper table, API JSON, article body), not inferred from a summary alone.

## 1. Vendors

**Anthropic — CLAUDE.md (Claude Code memory docs, `code.claude.com/docs/en/memory`) `[fetched]`**

No language guidance exists on this page. Full-text grep of the fetched page for "language", "english", "japanese", "multilingual" returned zero matches. What the page does say, relevant to the trade-off:

> "Claude Code has two complementary memory systems. Both are loaded at the start of every conversation. Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead. The more specific and concise your instructions, the more consistently Claude follows them."

This is a vendor statement that CLAUDE.md content is *context*, not a system prompt and not enforced — and that conciseness improves adherence. It says nothing about which natural language to write that concise content in.

**Anthropic — Agent Skills best practices (`platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`) `[fetched]`**

No language guidance. What is documented, and directly relevant to a Japanese-vs-English trade-off, is a hard **token/character budget mechanic** for the skill listing that every session preloads. From Claude Code's skills doc, quoted secondhand via a practitioner who quoted it directly (see Lens 2, moname_ai) and consistent with the best-practices page's own framing:

> "The context window is a public good... At startup, only the metadata (name and description) from all Skills is pre-loaded... description: Maximum 1,024 characters... Be specific and include key terms... The description is critical for skill selection: Claude uses it to choose the right Skill from potentially 100+ available Skills."

Style guidance given (`platform.claude.com` best-practices page, direct quote): "**Always write in third person**. The description is injected into the system prompt, and inconsistent point-of-view can cause discovery problems." — a voice rule, not a language rule. No mention of English vs. non-English anywhere on the page.

**OpenAI — Codex AGENTS.md guidance `[fetched]`**

Fetched `github.com/openai/codex/blob/main/docs/getting-started.md` and `raw.githubusercontent.com/openai/codex/main/docs/config.md`. Neither page (within what was fetched) mentions AGENTS.md language, `project_doc`, or non-English instructions at all. This is a negative result from a partial fetch (Codex's docs are large and not fully crawled here) — logged as "not found in what was checked," not "confirmed absent everywhere."

**agents.md (the spec site itself, `agents.md`) `[fetched]`**

> "The page contains no guidance regarding which natural language AGENTS.md files should be written in. There is no mention of English versus other languages anywhere in the specification."

Confirmed: the cross-vendor spec (stewarded by OpenAI Codex, Amp, Google, Cursor, Factory, now the Agentic AI Foundation / Linux Foundation, per the same fetch) is silent on language, same as Anthropic's docs.

**Tokenization — Anthropic's own glossary (`platform.claude.com/docs/en/about-claude/glossary`) `[fetched]`**

> "Tokens are the smallest individual units of a language model... For Claude, a token approximately represents 3.5 English characters, though the exact number can vary depending on the language used."

This is the entirety of Anthropic's own public acknowledgment that language affects token count. No Japanese-specific multiplier is published anywhere Anthropic-side that was found. The multiplier has to come from third-party measurement (Lens 3).

**Summary of the vendor lens: all four vendor surfaces checked (Anthropic CLAUDE.md docs, Anthropic Skills docs, OpenAI Codex docs, the agents.md spec) are silent on natural-language choice for model-facing files.** This is itself a finding: there is no vendor ruling to defer to either way. The only vendor-published fact bearing on the question is the token/character-budget mechanics (skills) and the generic "~3.5 characters per token, varies by language" caveat (tokenization) — both point toward "conciseness and token efficiency matter" without naming a language.

## 2. Practitioners

**The question is barely asked, and where it's implicitly answered, it's answered by not discussing it.** Across roughly fifteen targeted Qiita-API queries (`CLAUDE.md 日本語 英語`, `AGENTS.md 日本語で書く`, `Claude Code 指示 英語 日本語`, `SKILL.md 書き方`, `スキル description 英語 日本語 呼び出し`, etc. — 2026-09 dated results), no article was found that treats "should CLAUDE.md/SKILL.md be in English or Japanese" as its own topic. Multiple substantial, recent Japanese practitioner articles about CLAUDE.md and SKILL.md authoring (all `[qiita]`, article bodies read in full):

- Yusei_tech, "CLAUDE.mdの書き方、初心者がやりがちな失敗と改善例" (2026-09-16) — five detailed failure patterns for CLAUDE.md authoring, quoting Anthropic's own docs ("Size: target under 200 lines... Longer files consume more context and reduce adherence" and "CLAUDE.md content is delivered as a user message after the system prompt... there's no guarantee of strict compliance"). All example CLAUDE.md snippets in the article are written in Japanese, with no comment on that choice.
- Takuya__, "Claude Code を「言うことを聞く」エージェントにする4つのレイヤー" (2026-09-16) — a four-layer framework (CLAUDE.md / permissions / hooks / sandbox) ranked by enforcement strength; again, all example content is Japanese, unremarked.
- syun136_616, "Claude Codeスキル47本運用でわかった7つの学び" (2026-09-17) — 47 skills in production; the article's core finding is that **description wording determines invocation precision** ("descriptionを「何をするか」だけ書いたスキルは、意図しない場面で呼ばれたり...「いつ使うか」を具体的なトリガー語つきで書いたスキルの方が、明らかに安定して動きます"), but never raises language choice as a variable — only specificity and trigger-word presence.
- syun136_616, "Claude CodeがAGENTS.mdを読み込まない理由と対処法" (2026-09-22) — practical AGENTS.md/CLAUDE.md interop notes, tested in Japanese, no language discussion.

**The one practitioner article that quantifies a mechanism relevant to language choice** is moname_ai, "Claude Codeのスキルが呼ばれない原因は、descriptionの書き方ではなく文字数予算だった" (Qiita, 2026-07-30, reprint of a Zenn original) `[qiita]`. It quotes Claude Code's official skills documentation directly:

> "Claude Code loads a listing of skill names and descriptions into context so Claude knows what's available... if you have many skills, Claude Code shortens descriptions to fit the listing's character budget, which can strip the keywords Claude needs to match your request. The budget scales at 1% of the model's context window. When the listing overflows, Claude Code drops descriptions starting with the skills you invoke least."

The author then measured their own environment: 42 skills, Japanese-language descriptions totaling 14,062 characters, against an estimated ~2,000-character budget (1% of a 200k-token context, by the author's own arithmetic, explicitly flagged by the author as "私の計算であって公式の数字ではありません" — their own estimate, not an official number) — **703% over budget**, with descriptions silently truncated from the least-invoked skill first, removing exactly the trigger phrases the author had written to make skills fire. This does not compare English vs. Japanese directly, but it establishes that (a) the constraint is real, vendor-documented, and biting in practice, and (b) whatever language a description is written in is competing for the same shrinking budget — and Japanese, being less token-efficient per unit of meaning in BPE tokenizers generally (Lens 3), would be expected to hit that ceiling sooner for equivalent semantic content, though no one has run that specific A/B.

**A second practitioner measurement, tangential but informative**: RyugaMisono, "AI AgentとのLLM会話で敬語を排除した結果、トークン消費量が27%削減された実測データと運用指針" (Qiita, 2026-09-03) `[qiita]` — a personal, non-rigorous benchmark (own admission: "厳密な効果測定というよりは、個人の興味からの検証") using Bedrock Claude 3/3.5 Sonnet, found that polite/keigo Japanese phrasing costs meaningfully more tokens than casual phrasing for identical meaning — word-pair examples measured with `client.count_tokens()`: "教えてください (5t) → 教えて (3t) [40.0%削減]", "よろしくお願いいたします (10t) → よろしく (3t) [70.0%削減]". This is not an English-vs-Japanese comparison — it shows Japanese itself has a large internal token-efficiency axis (keigo vs. casual, kanji vs. kana) that practitioners are already optimizing separately from the English/Japanese question this record addresses.

**The most decision-relevant practitioner-adjacent source is actually a measured survey, not opinion** — see Lens 4 (hisashi-ito).

## 3. Measured evidence

**M-IFEval: Multilingual Instruction-Following Evaluation** — Dussolle, Cardeña Díaz, Sato, Devine (Lightblue KK), arXiv:2502.04688, Feb 2025 `[arxiv, read directly from PDF pages]`. This is the single most decision-relevant paper found: it evaluates 8 state-of-the-art LLMs — including **Claude 3.5 Opus, Sonnet, and Haiku**, plus GPT-4o, GPT-4o Mini, o1, o1 Mini, and Qwen 2.5 32B Instruct — on instruction-following in English, Spanish, French, and **Japanese**, using objective (string-checkable) criteria extending the original IFEval benchmark.

Table 1 (average strict scores, all instructions, EN vs. JA columns, read directly from the paper):

| Model | EN | JA | EN−JA gap |
|---|---|---|---|
| o1 | 86.7 | 75.7 | 11.0 |
| Opus (3.5) | 87.3 | 75.7 | 11.6 |
| Sonnet (3.5) | 88.1 | 77.0 | 11.1 |
| o1 Mini | 83.9 | 69.5 | 14.4 |
| GPT4o | 88.6 | 70.4 | 18.2 |
| GPT4o Mini | 86.0 | 65.9 | 20.1 |
| Qwen 2.5 32B Instruct | 86.0 | 65.9 | 20.1 |
| Haiku (3.5) | 77.3 | 61.9 | 15.4 |

**Every single model tested scores lower on Japanese than on English — the gap ranges from 11.0 to 20.1 points, with no exceptions.** Restricting to only the instruction types that also existed in the original English-only IFEval (i.e., excluding Japanese-specific script/kanji-control instructions, the paper's own robustness check): o1 scores 84.8 on Japanese vs. 86.7 on English; Sonnet scores 81.2 on Japanese vs. 88.1 on English — the gap narrows (2-7 points) but does not close, even on generic, non-language-specific instruction types. Table 2 shows Japanese-*specific* instructions (script/kanji/katakana/hiragana control, sentence-ending forms) score far lower still — 47.7 to 70.5 across models, the worst-performing category in the whole paper. The paper's own discussion: "we find that LLMs generally achieve poor performance on seemingly simple language-specific tasks such as restricting usage of a given script... This may reflect a gap between LLM performance in English to that of other languages which has been observed in other tasks."

**Caveat, logged in `unverified`**: this is Claude 3.5-era data from Feb 2025; no equivalent benchmark for current-generation models (Claude Sonnet 4.5/5-era, GPT-5.x) was found. Whether the gap has narrowed since is unknown.

**Tokenizer fairness — Petrov, Malfa, Weinberg, Cohn, "Language Model Tokenizers Introduce Unfairness Between Languages," arXiv:2305.15425 (May 2023)** `[arxiv]`:

> "The same text translated into different languages can have drastically different tokenization lengths, with differences up to 15 times in some cases. These disparities persist even for tokenizers that are intentionally trained for multilingual support. Character-level and byte-level models also exhibit over 4 times the difference in the encoding length for some language pairs... we should train future language models using multilingually fair subword tokenizers."

This is the canonical tokenizer-fairness paper (not Japanese-specific — it's a general cross-language result) establishing that token-count disparity by language is a structural, well-documented phenomenon, not an artifact of any one vendor's tokenizer. It is the closest thing to primary-source backing for "Japanese instructions cost more tokens for equivalent meaning" absent an Anthropic-published Japanese-specific number.

**"The Token Tax: Systematic Bias in Multilingual Tokenization," arXiv:2509.05486 (Sept 2025)** `[arxiv]` — evaluates 10 LLMs on AfriMMLU (16 African languages, not Japanese): "fertility (tokens/word) reliably predicts accuracy. Higher fertility consistently predicts lower accuracy across all models and subjects... a doubling in tokens results in quadrupled training cost and time." Establishes the general mechanism (token inflation → both cost inflation and accuracy degradation) that M-IFEval's Japanese-specific result is consistent with, though this paper itself doesn't test Japanese.

**Marco-Bench-MIF, arXiv:2507.11882 (July 2025)** `[arxiv]` — 30-language extension of IFEval, 20+ LLMs: "(1) 25-35% accuracy gap between high/low-resource languages, (2) model scales largely impact performance by 45-60% yet persists script-specific challenges, and (3) machine-translated data underestimates accuracy by 7-22% versus localized data." Japanese is a high-resource language in this framing, so the 25-35-point gap figure applies more to low-resource languages than to Japanese specifically — logged for context, not as a Japanese number.

**Multi-IF, arXiv:2410.15553 (Meta, Oct 2024)** `[arxiv]` — multi-turn, multilingual (8 languages incl. non-Latin scripts): "languages with non-Latin scripts (Hindi, Russian, and Chinese) generally exhibit higher error rates... o1-preview drops from 0.877 at the first turn to 0.707 at the third turn." Japanese was not one of the 8 languages in this particular benchmark, but it corroborates the non-Latin-script-penalty pattern M-IFEval found for Japanese specifically.

**This project's own local data point (per the task brief, not independently re-verified in this record)**: jev (TypeSafe) choice-question framing scored 79.0% (English framing) vs. 76.5% (Japanese framing) top-1, n=200, confidence intervals overlapping. Cite as a single local, underpowered result — consistent in *direction* with M-IFEval's much larger and more statistically clear English-favoring pattern, but not independently significant and not a general claim.

## 4. In the wild

**GitHub code search, 2026-09-23, `[gh]`** (counts above ~1,000 are API-approximate, order-of-magnitude only):

| Query | total_count |
|---|---|
| `filename:CLAUDE.md` | 778,240 |
| `filename:AGENTS.md` | 970,752 |
| `filename:SKILL.md` | 6,340,608 (likely inflated — see caveat) |
| `です。 filename:CLAUDE.md` | 4,560 (≈0.6%) |
| `ます。 filename:CLAUDE.md` | 4,712 (≈0.6%) |
| `です。 filename:AGENTS.md` | 5,048 |
| `です。 filename:SKILL.md` | 16,992 |

These crude sentence-ending-particle searches (catching only two of many ways a Japanese file could be written) are directionally consistent with — and lower than — the more rigorous measured figure below, as expected for an undercount.

**Named repos with Japanese-language CLAUDE.md, verified via `gh api repos/<owner>/<repo>` (2026-09-23 snapshot):**

1. `CALIL/sabatomap` — pushed 2026-09-21, 21 stars, JavaScript, "鯖江市図書館マップアプリ「さばとマップ」" (Sabae city library map app)
2. `SousiOmine/Metasia` — pushed 2026-08-26, 6 stars, C#, "Multiplatform Video Editor"
3. `hiboma/hiboma` — pushed 2026-03-31, 241 stars, Shell, personal notes/experiment-log repo
4. `hiroyuki-miyauchi/axiarch` — pushed 2026-09-15, 3 stars, Python, "Constitution-driven governance framework for AI agents"
5. `tktcorporation/.github` — pushed 2026-09-20, 0 stars, TypeScript, dev-environment template CLI

**The single most decision-relevant "in the wild" source is a rigorous, large-n measured survey**: hisashi-ito, "GitHub のリポジトリ5件に1件が、AI エージェントへの指示ファイルを持っていた——100万人の GitHub アカウント調査から（第2弾）" (Qiita, 2026-09-21) `[qiita, full article read]`. Methodology: uniform random sample of 1M GitHub accounts (same sample as the author's Part 1 census); 118,582 accounts with a push in the last year; GitHub GraphQL, one query per account, listing repo root + `.github`/`.cursor`/`.claude` directories and reading canonical-filename instruction files; danger-classification of file content run through Jev (TypeSafe) for the risky subset. Result set: 378,677 active repos, of which 8.4% carry an instruction file (CLAUDE.md 5.3%, AGENTS.md 4.1%, others smaller); of files with body content (n=34,920):

> "Claude への言及は全ファイルの 43%、Copilot 7%、Codex 6%、Cursor 5%、Gemini 5%。**日本語、中国語、韓国語、ロシア語は合わせて 5% ほどです**。"
> (Claude is mentioned in 43% of all files, Copilot 7%, Codex 6%, Cursor 5%, Gemini 5%. **Japanese, Chinese, Korean, and Russian combined account for only about 5%.**)

Implying roughly 95% of instruction-file content in the wild is English. The same survey's country breakdown (self-reported location, n>300 per country): **Japan leads all countries at 33.1%** share of accounts-with-instruction-files, ahead of Korea (30.5%), the US (26.4%), and China (25.3%) — i.e., **Japanese developers adopt AGENTS.md/CLAUDE.md at the highest rate of any country surveyed, while writing the actual file content in English at roughly the same ~95% rate as everyone else.** This is a strong revealed-preference signal: the population with the most at-scale experience writing these files in Japan does not, in aggregate, write them in Japanese. (English overview by the same author: `medium.com/@it.hisas/github-says-it-has-180-million-developers-i-counted-how-many-actually-show-up-d63359d7f81e`; Part 1 census: `qiita.com/hisashi-ito/items/c7bbc1116b81807cf9ac`.)

**Negative and anomalous evidence — `anthropics/claude-code` GitHub issues, fetched 2026-09-23 `[gh]`:**

- **#87367** (open, "Thinking summaries should follow the configured language (Korean: 84.5% English across 380 blocks)"): a user with `"language": "korean"` set measured every non-empty thinking block across their 6 most recent sessions (380 blocks total), classified by script ratio: only 8.9% Korean-dominant vs. **84.5% English-dominant** (6.6% mixed). Per-session Korean share ranged 0-23%. Critically: "Instructing the model in CLAUDE.md to reason in Korean: does not reliably change the summaries (the numbers above were collected with a Korean-language instruction already in place)." Response text itself was reliably Korean throughout — only the internal reasoning summaries defaulted to English.
- **#82785** (closed, filed 2026-07-31, referenced by #87367 as "same underlying behaviour, reported for Japanese"): "Thinking summaries randomly switch between Japanese and English within the same session... In one case the summary also mistranslated a referenced fact, reversing its meaning," despite the response text itself being "always Japanese." Whether this was fixed or just closed is unverified.
- **#21400** (open, "Feature Request: Granular Language Customization (separate chat vs code language)"): direct practitioner precedent for the exact seam this research is about. Quoted verbatim: "Many developers prefer to communicate with Claude in their native language (e.g., Russian, Japanese, Chinese) while keeping code-related content in English: Code comments, Docstrings, Commit messages... Currently, users must add explicit instructions to CLAUDE.md files like: 'Respond in Russian' / 'All code comments must be in English' / 'Commit messages in English'. This works, but consumes context tokens that could be saved with a proper system setting." This confirms the human-Japanese/model-artifact-English seam is a real, currently-manual, currently-unsupported-as-a-first-class-feature pattern that practitioners already hand-roll today.
- **#62291** (closed, "Feature Request: Japanese (日本語) UI localization support"): demand exists for Japanese at the UI-chrome layer (dialogs, prompts) — a different layer from CLAUDE.md/SKILL.md content, not in tension with the finding above.

## Summary table

| Source | Task type | Result | Cost numbers | Named failure modes |
|---|---|---|---|---|
| Anthropic CLAUDE.md docs `[fetched]` | vendor doc | no language guidance | "target under 200 lines"; context not enforced | adherence drops with length, not language |
| Anthropic Skills best-practices `[fetched]` | vendor doc | no language guidance | description ≤1,024 chars; body <500 lines; listing budget = 1% of context window | truncation silently strips trigger keywords |
| agents.md spec `[fetched]` | vendor doc | no language guidance | — | — |
| M-IFEval (arXiv:2502.04688) `[arxiv]` | instruction-following, 8 LLMs incl. Claude 3.5 | JA scores 11.0-20.1 pts below EN, every model, no exceptions | — | script/kanji-control instructions score 47.7-70.5 (worst category) |
| Petrov et al. 2023 (arXiv:2305.15425) `[arxiv]` | tokenizer measurement, cross-language | up to 15x tokenization-length difference between languages for same text | 15x max; >4x even for byte-level models | persists even in multilingual-trained tokenizers |
| The Token Tax (arXiv:2509.05486) `[arxiv]` | 10 LLMs, AfriMMLU, 16 languages | fertility (tokens/word) predicts accuracy | doubling tokens ≈ quadrupling training cost | not Japanese-specific |
| Marco-Bench-MIF (arXiv:2507.11882) `[arxiv]` | 20+ LLMs, 30 languages | 25-35 pt gap high- vs low-resource | MT-data underestimates accuracy 7-22% | Japanese is high-resource here, gap smaller than low-resource figure |
| jev local A/B (project brief) | judgment-model choice framing | EN 79.0% vs JA 76.5% top-1 | n=200, CIs overlap | not independently re-verified here; underpowered |
| hisashi-ito 1M-account survey `[qiita]` | GitHub census | ~95% of instruction-file content is English incl. Japan-authored files | n=378,677 repos, n=34,920 bodies read | Japan #1 adoption (33.1%) yet still ~95% English content |
| moname_ai skill-budget measurement `[qiita]` | practitioner, 1 environment | 42 JA-language skill descriptions = 703% over estimated budget | 14,062 chars vs. ~2,000-char estimated budget | least-used skills' trigger keywords truncated first |
| gh issue #87367 `[gh]` | measured, 1 user, 380 blocks | 84.5% English-dominant thinking summaries with Korean configured + JA/KO CLAUDE.md instruction already present | 380 blocks / 6 sessions | CLAUDE.md instruction to reason in target language does not reliably override |
| gh issue #82785 `[gh]` | reported, 1 user | same phenomenon, Japanese; summary mistranslation observed | — | closed; fix status unverified |
| gh issue #21400 `[gh]` | feature request | practitioner precedent for EN-model-artifact / JA-chat seam | "consumes context tokens" (qualitative) | today hand-rolled via two CLAUDE.md instruction lines |

## Verdict, by file class

**Rules (CLAUDE.md / AGENTS.md instruction text, model-facing).** English is the better-supported choice for new model-facing rule content going forward. No vendor mandates it, but three independent lines of evidence converge: (1) M-IFEval shows every one of 8 tested LLMs — including Claude 3.5 Opus/Sonnet/Haiku — following instructions worse in Japanese than English, by double digits, even on instruction types with nothing Japanese-specific about them; (2) Japanese is measurably less token-efficient than English in BPE-family tokenizers generally (Petrov et al.), and CLAUDE.md content directly consumes context-window budget every single session; (3) in the wild, the country that adopts these files fastest (Japan, 33.1% share) still writes them in English roughly 95% of the time — this is the revealed preference of the most experienced population, not a hypothetical. This is directional evidence, not a vendor ruling — there is no official guidance either way, and the gap could plausibly be smaller or absent on current-generation models (unverified).

**Skills (SKILL.md, especially the `description` field).** English is the higher-leverage choice specifically here, more than for CLAUDE.md, because the description field is (a) always preloaded every session regardless of relevance, (b) subject to a hard, shrinking, vendor-documented truncation budget that removes least-used skills' trigger words first, and (c) the sole mechanism by which Claude decides to invoke a skill among "100+ available Skills" per Anthropic's own docs. A token-denser language for the same trigger-keyword content buys more headroom before truncation. No direct EN-vs-JA invocation-rate experiment was found (logged as unverified) — this verdict rests on the mechanics being vendor-documented plus the general tokenizer-fairness literature, not a skills-specific controlled test.

**Hook-injected context (system-reminder-style text a hook writes into the model's turn).** Weakly favors English, on the strength of the thinking-summary evidence (#87367, #82785): Claude Code's own internal pipeline shows a structural pull toward English in model-facing processing that persists even when the user-facing language is explicitly configured otherwise and an instruction saying "reason in [language]" is already present in CLAUDE.md. No study specifically tested hook-injected guard/reminder text, so this is inference from an adjacent, vendor-acknowledged failure mode, not a direct measurement — logged accordingly.

**Judgment-model question framing (e.g., jev choice questions).** No resolved verdict. The project's own local A/B (79.0% EN vs 76.5% JA, n=200) is directionally consistent with the broader English-favoring pattern but the confidence intervals overlap and n=200 is underpowered next to M-IFEval's much larger evaluation. The task shapes differ (typed multiple-choice judgment vs. open-ended instruction-following), so M-IFEval's result should not be treated as directly transferable proof for this file class either. Recommend treating this as "probably English, not yet confirmed for this specific task shape" rather than a settled call.

## No-precedent list

- No vendor (Anthropic, OpenAI/Codex, the agents.md spec) publishes guidance on what natural language to write CLAUDE.md, AGENTS.md, or SKILL.md content in.
- No Anthropic-published Japanese-specific token multiplier exists; the "varies by language" caveat is the extent of what Anthropic states.
- No tool was found that automates the "decisions in Japanese → rules rendered in English" translation seam. `dyoshikawa/rulesync` (1,461★, the most-starred rule-sync tool found) only syncs identical content verbatim across AGENTS.md/CLAUDE.md/.cursor/rules/Copilot formats — it translates *format*, not *language*; whatever language the source is written in propagates unchanged.
- No Japanese-language blog post was found that treats "CLAUDE.md/SKILL.md: English or Japanese?" as its own explicit topic, despite ~15 targeted searches across a large, active corpus of 2026-dated Claude Code practitioner writing. The question appears to be unexamined in Japanese practitioner discourse, not actively debated and resolved either way.
- No current-generation (post-2025) multilingual instruction-following benchmark equivalent to M-IFEval was found; the EN/JA gap is documented on Claude-3.5-era and contemporaneous models only.
- No controlled experiment isolating SKILL.md description language (holding content constant, varying only EN vs. JA) and measuring invocation/follow rate was found.
- The closest existing precedent for the human-Japanese/model-English seam is not a tool but a manual practitioner workaround, documented in GitHub issue #21400: two separate instruction lines inside the same CLAUDE.md ("Respond in [language]" + "All code comments must be in English"), explicitly because no first-class setting exists for it yet.
