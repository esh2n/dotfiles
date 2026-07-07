---
name: humanize-writing
description: >
  Use when the user asks to remove the AI-generated feel from text, to humanize,
  naturalize, or de-slop a draft, to fix 「AIっぽい / AI臭い」文章 in Japanese, or
  when reviewing prose that reads like ChatGPT/LLM output — em dash overuse,
  delve/underscore/tapestry vocabulary, 「〜と言えるでしょう」, uniform 「〜です。」
  endings, tricolon lists, generic conclusions. Works for both Japanese and English.
---

# Humanize Writing

## Overview

Rewrite text so it stops reading like LLM output and starts sounding like a specific
human wrote it — **while preserving meaning, facts, and technical terms**.

**Core principle:** The goal is *readability and the writer's voice*, NOT evading AI
detectors. Do not chase perplexity/burstiness scores. A rewrite that fools GPTZero but
loses the writer's intent is a failure.

**Second principle — trim, don't purge.** Humans use em dashes, transitions, and lists
too. The AI tell is *overuse and uniformity*, not the feature itself. Cut the excess and
break the uniformity; don't mechanically ban every instance.

The detectable patterns are empirically grounded, not folklore: LLM vocabulary overuse
(`delve` 25×, `meticulous` 34.7×, `intricate` 11.2×) is measured in peer-reviewed corpora
(Kobak et al., *Science Advances* 2025; Liang et al., ICML 2024; Juzek & Ward, COLING 2025).
The root cause is RLHF preference amplification, not training data. See **patterns-en.md**
and **patterns-ja.md** for the full pattern catalog with sources.

## When to Use

- User pastes a draft and asks to make it sound human / less AI / more natural
- User says 「AIっぽい」「AI臭い」「機械的」「もっと自分の言葉で」
- Reviewing your own or the user's writing before it ships (blog, PR description, docs, email)
- Text shows the tells below

**When NOT to use:** code, structured data, or when the user explicitly wants formal
boilerplate (legal, templated notices). Humanizing there just adds noise.

## The Strongest Tells (check these first)

Native readers spot these in one glance — prioritize them:

| Rank | English | 日本語 |
|------|---------|--------|
| 1 | em dash — overuse for asides | 記号癖: 太字乱用・「——」ダッシュ・「：」コロン・絵文字見出し・**矢印列挙 `A→B→C→D`** |
| 2 | overused vocab: delve, underscore, tapestry, showcase, testament, meticulous | 文末: 均一な「〜です。」連続 **も** 体言止めの羅列「〜追加。」「〜ポーリング。」**も** AI臭（両極） |
| 3 | uniform sentence length (10–30 tokens), no rhythm | 定型句: 「〜と言えるでしょう」「〜が重要です」「いかがでしたか」 |
| 4 | tricolon / rule-of-three lists implying false completeness | 一次体験ゼロの一般論、温度が一定（感情が見えない） |
| 5 | hedge opener + resolution closer ("It's important to note…" … "In conclusion…") | バランス取り「一概には言えませんが」「ケースバイケース」で締める |

## Rewrite Method

1. **Detect** — scan against patterns-en.md / patterns-ja.md by language (handle JP/EN
   mixed text: apply both). Name the specific tells you find; don't just "rewrite vibes."
2. **Preserve** — lock down facts, numbers, proper nouns, technical terms, code. Never
   invent detail to sound human. If the draft is vague, the humanized version stays vague
   (or you ask) — do not fabricate a fake anecdote.
3. **Rewrite** — swap overused vocab for plain words, vary sentence length for rhythm, cut
   mechanical transitions, replace generic conclusions with a concrete point. For JP:
   - Break uniform 「〜です。」endings, but do NOT pile up 体言止め in running prose —
     「〜まで待つポーリングだ」reads as AI. Prefer natural verb endings. (体言止め in *bullet
     items* is fine — the tell is 体言止め断定 in the geubun/散文.)
   - **Don't over-prose-ify.** Lists and step sequences belong in `1. 2. 3.`, not stitched
     into one sentence with 読点 (「〜し、〜し、〜する」). Arrow-packing (`A→B→C`) is also out —
     a plain numbered list is the natural form. AIs prose-ify to sound "polished"; engineers
     just list.
   - Cut empty intensifiers (きっちり/しっかり/適切に), 「〜だけでなく〜も」antithesis, 括弧
     asides, 倒置のキメ文 (「〜を保証するためだ」), and self-evident 「〜ため」justifications.
     Drop info that isn't needed at all.
   - See patterns-ja.md §2/§4/§7.
4. **Voice-calibrate (if a sample exists)** — if the user provides their own past writing,
   match its sentence length, formality, punctuation habits, and vocabulary level. Absent a
   sample, aim for plain, direct prose and ask if they want a specific register.
5. **Second-pass audit** — reread the output and ask "what still reads as AI here?" Fix
   what remains. State which tells you removed.

## Quick Before/After

**English**
- Before: `This framework delves into the intricate tapestry of modern development, underscoring its pivotal role.`
- After: `This framework handles the messy parts of modern development, and that's where it earns its place.`

**日本語**
- Before: 「この施策は非常に有効であり、業務効率化において重要な役割を果たすと言えるでしょう。」
- After: 「この施策、実際に回してみたら効率がはっきり上がった。効くのはここ。」

## Do Not

- Do not fabricate personal anecdotes or specifics to fake a human voice
- Do not alter meaning, facts, numbers, or technical terms
- Do not optimize for AI-detector evasion (perplexity/burstiness) as the goal
- Do not mechanically ban every em dash / transition / list — trim excess, keep what serves
- Do not over-casualize professional writing past the register the user wants
- Do not flag 和欧間の半角スペース (「CSV 取り込み」「E2E で」) as an AI tell — it's legitimate
  JP typography (四分アキ). Only *inconsistent* spacing (some words spaced, others not) is a
  smell; consistent spacing is the author's style — leave it
- **Do not confirm or change domain terminology you can't verify.** LLMs hallucinate
  plausible-but-wrong jargon — renaming a `dedup`/`merge` step to an invented domain term,
  or citing a config flag/suffix that isn't in the codebase. **This isn't limited to flashy
  coinages** — ordinary nouns (「契約」「設定」「型」「ジョブ」) also mismatch the real code
  identifiers. You can't tell which are right, so flag domain nouns broadly, not just the
  obvious jargon. Leave them as-is with 〔※用語要確認〕 — never swap in a generic synonym

## Reference

- **patterns-en.md** — English tells with peer-reviewed sources (vocab tables, phrases, structure, punctuation, tone)
- **patterns-ja.md** — 日本語の癖（定型句・記号・文末・トーン・翻訳調）と出典
