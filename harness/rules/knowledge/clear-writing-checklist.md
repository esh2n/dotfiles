# 疲れた読者が一読で分かる説明文と図は、どう書くか

確認日: 2026-09-22

## 答え

最重要の情報を先頭に置き、1 段落に 1 つの考えだけを書く。見出しは中身を言い表す記述にし、具体例を必ず添える。説明文（explanation）では、何をだけでなくなぜ・代わりの案・トレードオフを書く。図は仕組みや関係を伝えるときだけ置き、複雑になりすぎたら分けるか単純にする。文の長さに数値の目標を与える出典はないので、目標値は作らない。

## 検査表（16 項目）

1. 最初の一文・段落が主張を述べ、最重要の情報を先頭に置く。
2. 1 段落に 1 つの考え。5〜6 文を超えたら分ける。
3. 見出しは具体的な記述にする（裸のトピック名にしない。名詞句は可）。
4. 弱い言い回し（"there is / there are"、「〜ということがある」）を削る。
5. 具体例を含める。具体例が浮かばない説明は疑う。
6. 書き手が理解してから書く（読者への規則ではなく、書く前の条件）。
7. 説明文は代わりの案・理由・トレードオフを扱う（手順書・リファレンス・チュートリアルには当てはめない）。
8. 説明文は手順やリファレンスに脱線しない範囲に留める。
9. 声に出して自然に読める。専門語を定義なしで使わない。
10. 条件・状況を指示より前に置く。
11. 振る舞いの直感を狙う図は操作できる形にする。静的な図に同じ効果は期待しない。
12. 図の複雑さには上限がある。表す対象が複雑になりすぎたら分けるか単純にする。
13. 図は仕組み・関係を伝えるときだけ置く。箇条書きや平叙文の飾りにしない。
14. 文の短さは Flesch–Kincaid などの指標で機械的に測れるが、目標のスコアは作らない。
15. 同じ階層の見出しは構文を揃える。
16. 見出しはセンテンスケースにする（タイトルケースにしない）。

## 根拠

- 段落は 1 つの考え、最重要の情報を先頭、5〜6 文を超える段落は詰め込みすぎのしるし — Google Developer Documentation Style Guide https://developers.google.com/style/paragraph-structure ("Put the most important information first in a paragraph.")
- 見出しは記述的に、センテンスケース、条件を指示の前に — https://developers.google.com/style/headings 、https://developers.google.com/style/sentence-structure 、https://developers.google.com/style/highlights
- 要点を先に、声に出して読む、弱い言い回しを避ける、見出しは構文を揃える — Microsoft Writing Style Guide https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice 、https://learn.microsoft.com/en-us/style-guide/scannable-content/headings ("If readers don't read the headings, they probably won't read the text that follows, either.")
- 説明文は代わりの案と理由を扱い、範囲を絞る — Diátaxis https://diataxis.fr/explanation/ ("Explanation can and must consider alternatives, counter-examples or multiple different approaches.")
- 具体例の重み — 結城浩「文章を書く心がけ」 https://www.hyuki.com/writing/writing.html （「具体例が思い付かなかったら、たいていはその説明はうそである」）、Julia Evans https://jvns.ca/blog/2026/02/18/man-pages/ ("Except for examples, I LOVE examples.")
- 操作できる図だけが振る舞いの直感を育てる — Bret Victor, Explorable Explanations https://worrydream.com/ExplorableExplanations/
- 複雑な図は読めなくなる — John D. Cook https://www.johndcook.com/blog/2026/08/20/ai-generated-ascii-diagrams/
- 飾りの図への苦情（否定側の根拠） — Ask HN "AI Generated Diagrams" https://news.ycombinator.com/item?id=46927101
- 読みやすさの指標 — Flesch–Kincaid https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests 、日本語の難易度判定 jReadability https://jreadability.net/
- 機械的な検査の道具 — Vale のスタイル集 https://vale.sh/hub/ 、textlint の `sentence-length`（既定 100 文字） https://github.com/textlint-rule/textlint-rule-sentence-length と `max-ten`（読点は 1 文 3 個まで） https://github.com/textlint-ja/textlint-rule-max-ten

## 注意点

- Anthropic は長文を流れる散文で書けと勧める一方、自社の文書は表や XML タグを多用する。散文か構造かはジャンル（説明文か、機械が読む指示か）で決まり、普遍の規則ではない（https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices）。
- 文の長さの数値上限を与える一次の出典は見つからなかった。textlint の 100 文字は道具の既定値で、研究の結論ではない。
- Mayer の多メディア学習の原理（coherence・signaling など）は論文の実在だけ確認でき、原理の定義文は確認できていない。
- Edward Tufte の一次の文章には到達できていない。
