# Rules in detail

Each rule has the reason, what to do, and a Japanese before/after. Sources are listed at the end.

## 1. Keep technical terms and explain them where they first appear

Reason: replacing a term with an everyday word loses precision, and the reader can no longer search for it. A glossary at the top is read before the reader needs it and forgotten by the time the term appears.

Do:

- Keep the term in its standard spelling. Explain what it does in the same sentence (parentheses are fine) or in the next sentence.
- Explain in steps: a rough meaning first, then the detail the paragraph needs.
- A word everyone has heard is not always understood. When in doubt, explain.
- Explain only at the first use in a document. In chat, "first use" means first use in this reply: the reader may not have seen earlier turns.
- Do not put the explanation in a separate block, a footnote, or a prerequisites section.

Before:

> 前提として、用語を整理する。三値論理：真・偽・不明で評価する方式。相関サブクエリ：外側の行ごとに評価されるサブクエリ。
>
> `NOT IN` は NULL を含むと三値論理のせいで常に偽になる。

After:

> `NOT IN` の右辺に NULL が一つでもあると、条件はどの行でも真にならない。SQL は条件を三値論理（真・偽・不明の三つの値で評価する方式）で評価し、`x <> NULL` は不明になるからだ。

## 2. Never dumb down; split instead of swapping words

Reason: a plainer word with a slightly different meaning is a wrong statement that reads easily.

Do: when a sentence is hard because it carries two ideas, split it into two sentences. Keep the term. Do not drop conditions, exceptions or numbers to make it shorter.

Before:

> 再試行は冪等なときだけ安全。

After (wrong, meaning changed):

> やり直しは、同じ結果になるときだけ安全だ。

After (right):

> 再試行が安全なのは、その処理が冪等なときだけだ。冪等とは、同じ処理を何回実行しても結果が一回目と変わらない性質をいう。

## 3. No analogies, metaphors or personification to explain

Reason: an analogy carries properties the real thing does not have, and the reader cannot tell which ones to drop. A metaphor verb hides what actually happens.

Do: write the mechanism literally. Name who does what to what, with what result.

Before:

> キャッシュは冷蔵庫のようなもの。この変更は静かに壊れる箇所を潰していく。

After:

> キャッシュは、一度読んだデータを手元のメモリに置き、次の読み込みでディスクを読まずに返す。この変更は、エラーを出さずに誤った値を返していた箇所を直す。

If you cannot tell what a metaphor in someone else's text means, do not guess: list the possible readings and ask.

## 4. No in-house names

Reason: a name coined in one conversation or repository means nothing to the next reader. An ordinary word given a special meaning is worse: the reader takes it at its ordinary meaning and does not notice the gap.

Do:

- Use the real name: the file, command, tool or skill name, or what the thing does.
- If a new name is unavoidable, explain it at first use and keep that one name.
- Do not give an ordinary word a new meaning (家 for "this repository's harness", 床 for "rules the repository cannot override").
- Check `terms.tsv`; propose new rows when you notice a leak.

Before:

> 家では書き直さない。床で止まる。

After:

> pstack の原則を、このリポジトリの skill に書き写すことはしない。guard-rules.json の floor 規則（リポジトリ側の設定では外せない規則）がこのコマンドを止める。

## 5. No over-compression

Reason: fragments, symbols and labels make the reader reconstruct the sentence. Each reader reconstructs it differently.

Do: write whole sentences with a subject and a predicate. Write the relation that a symbol stands for.

| Shape | Before | After |
|---|---|---|
| Fragment | 考え方の型ごとに 6 本。 | レビュアーは、見る観点ごとに分けて 6 体置く。 |
| Slash | エージェント／レビュアー | エージェントとレビュアー |
| Arrow | 日付が不正 → 終了コード 2 | 日付が不正なときは、終了コード 2 で終わり、何も書き込まない。 |
| Equals | 家＝ハーネス | ここで言う「ハーネス」は、harness/ にある規則と skill の一式を指す。 |
| Label colon | 一般原則：principle-* を参照する。 | 一般原則は pstack の principle-* を参照する。 |

Lists of parallel nouns are fine. Tables may be compact.

## 6. Structure: conclusion first, nothing missing, nothing twice

- Put the conclusion or the decision in the first sentence. Reasons next, then details.
- Before writing, list the questions the reader will have and check each one is answered somewhere. Delete text that answers no question or repeats an answer.
- One name per thing throughout.

## 7. Figures and examples

- Draw a figure when a flow, a structure or a dependency takes three sentences to describe. Choose the type with writeup-kit's `references/writing.md` §4; do not draw decorative figures or restate the figure in prose (§3).
- Every figure has a title that names what it shows and its scope, a legend for the notation, and a label on every edge that says what moves along it ("呼び出す", "結果を返す", not a bare arrow). Explain abbreviations inside the figure or its legend.
- Pair the figure with one concrete example, such as a single request or a single command, and follow that same example through the figure and the prose. Move between the figure and the example as the explanation needs. Never label sections 「抽象」「具体」.

## 8. Chat replies

- The reader may not have seen earlier turns, and may read the reply alone later.
- When re-asking a question, restate the background, the options with what each changes, and your recommendation, so the question can be answered from this reply alone.
- Do not refer to earlier work by a name you made up in the conversation ("さっきの案 B", "レーン 2"). Say what it is.

## 9. Rewriting

- Add nothing: no facts, rankings, numbers, conditions or certainty that the source lacks. Do not drop them either.
- Run `diff_content.py` and resolve every listed item. Adverbial phrases matter: adding 「一つずつ」 adds a procedure the source did not state.

## Sources

- 文化庁「公用文作成の考え方」(2022), II-2 to II-4 (four treatments of terms, explaining in steps, words known but not understood): https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93651301_01.pdf
- plainlanguage.gov, "Minimize definitions" and "Use the same terms consistently": https://github.com/GSA/plainlanguage.gov/tree/main/_pages/guidelines
- GOV.UK style guide (technical terms are not jargon; avoid metaphors): https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/
- Google developer documentation style guide (figurative language, define on first use): https://developers.google.com/style/tone
- C4 model notation (title, legend, labelled lines, abbreviations explained): https://c4model.com/diagrams/notation
- pstack `unslop` rules 26, 27, 32, 33 and `technical-writing` (cursor/plugins, MIT)
- docwriter-org/plain-writing-skill rules 2, 14, 21: https://github.com/docwriter-org/plain-writing-skill
- bamboo-nova (meiseki): split the sentence rather than replace the term: https://zenn.dev/bamboo_nova/articles/c782c9de31e24b
