# Manual checklist (for environments where lint cannot run)

A procedure for checking by eye in place of lint in environments where `uv` is unavailable and `scripts/lint.py` cannot run (Claude.ai, etc.). The approach to fixing is the same as in SKILL.md: for each spot found, record whether you fixed it or, if kept, why (SKILL.md §4).

You do not need to check everything strictly every time. Look at 1–3 first, and go on to 4–9 if the document seems worth it.

## 1. Wording common in AI-written text

Search for the following wording. Most of it can be deleted without changing the meaning. Only when deleting breaks the connection with what surrounds it, rephrase using the original document's content. Keep it if it is part of a proper noun or a quotation.

- Pushing a conclusion: と言えるでしょう、と言えるだろう、と言えます、ということになるでしょう、のではないでしょうか、結論から言うと、結論として、まとめると、総じて、いかがでしたか、いかがでしょうか
- Emphasis: 非常に重要、極めて重要、重要なのは、大切なのは、ポイントは、言うまでもなく、言うまでもありません、まさしく
- Preambles and bridges: さて、それでは、このように、このような中、ここで注目したいのは、見ていきましょう、紹介していきます、解説していきます、深掘りしていきます、について見ていく、を探求する
- Hedging: 一概には言えません、個人差がありますが、あくまで一例ですが
- Words that state a stance instead of content: 正面から扱う(見る・書く・立てる・回収する)、不可欠、核心的、鍵となる、根本的な、多角的、包括的、総合的、掘り下げる、深掘りする、言語化する

「重要なのは」「このように」「不可欠」「ポイントは」「さて」 also appear often in human documents, so one or two need not concern you.

## 2. Translationese

Turn wording that traces English syntax into the way it is ordinarily said in Japanese. Do not change the degree of certainty.

- 「〜という点で」「〜という観点から」 become 「〜では」「〜で見ると」
- 「〜にとって重要」「〜にとって不可欠」 become 「〜には〜が要る」
- 「〜を持つ」 with an abstract object becomes 「〜がある」
- 「〜することによって」 becomes 「〜して」「〜すると」
- 「〜であることは間違いない」「〜に他ならない」 are stated as 「〜だ」. If the original document gives grounds, put them first. Do not add grounds
- Sentences that make a thing the subject and end in 「もたらす」「示す」「意味する」「証明する」 get a person or situation as the subject, or become 「〜から分かる」「〜を見ると」
- 「それは〜である。なぜなら〜だ」: write the reason first, or merge into one sentence with 「〜だからだ」
- 「〜することができる」 becomes 「〜できる」 or the verb's potential form

## 3. Negation and contrast

If 「〜ではなく〜」「〜だけでなく〜も」 appear 3 or more times in the whole document, or 4 or more sentences end in 「〜ではない。」「〜ではありません。」「〜わけではない。」, suspect overuse (do not count questions such as 「〜ではないでしょうか」). Handle them separately as follows (SKILL.md §3).

- A sentence that preemptively negates an assumption nobody stated (「〜するだけで自動的に〜わけではない」): delete the whole sentence
- 「AはBではない。Cだ。」: delete the negation and join the subject to the affirmative sentence
- Keep negations that narrow a meaning, easily misunderstood facts, cautions, and contrasts that explain a difference

## 4. Sentence length

Check whether the sentences in each paragraph are nearly all the same length. If a newly written document is too uniform, split or join sentences to fit the units of content. When revising an existing document, do not change sentences for this reason alone. Do not insert short sentences just for rhythm. Split any sentence that carries two or more claims (SKILL.md §3).

## 5. Paragraphs

Check whether every paragraph has the same number of sentences (say, three each). Match paragraph length to the weight of the content. If many paragraphs start with a conjunction such as 「しかし」「また」「そして」, remove the conjunctions where the content already connects.

## 6. Repeated openings and sentence construction

Check whether the same opening (「そして、」「これは、」 etc.) or the same sentence construction occurs 3 or more times in a row. If so, swap the order of sentences or the subject, or merge two sentences into one. Do not insert questions or noun-ending sentences as a device to break the pattern.

## 7. Noun-ending sentences

A document over roughly 2,000 characters with not a single noun-ending sentence (体言止め) is a feature often seen in AI-written text. This is for reference only; you need not force any in.

## 8. Paragraphs of generalities only

Look for paragraphs with no proper nouns, numbers or real examples. When writing new, gather material again. When revising an existing document, do not add examples or numbers yourself; tell the user what material would make it concrete (SKILL.md §3).

## 9. Readability

Check by eye the items in SKILL.md §5 "Readability check". In particular look at double negatives (after folding, confirm the truth value has not flipped), long sentences carrying two or more claims, runs of 7 or more kanji, 3 or more 「の」 in a row, and lists of 3 or more items buried in a sentence.

## Structure check

`scripts/outline.py` is unavailable too, so extract the headings and the first sentence of each paragraph by hand, line them up, and check the items in SKILL.md §5 "Structure check".

## Convergence and finishing

Finish by state, not by number of passes. When every spot found is sorted into "fixed" or "kept (reason)" and the fixes have created no new spots, finish. If the same spot reverts after being fixed twice, rewrite the whole sentence or paragraph construction, or keep it with a reason.

Finally, put the revised document side by side with the original and check that no facts, numbers, evaluations or policies absent from the original have entered (the top rule in SKILL.md: add nothing that is not in the original).
