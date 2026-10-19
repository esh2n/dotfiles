# Research memo / discussion paper (リサーチメモ・ディスカッションペーパー): state first what you want decided

The question a research memo answers is how much is known about this issue now, what is still undecided, and what the reader is asked to judge. It differs both from minutes, which record what happened, and from a report, which conveys findings as reliable information. It is written before the conclusion has firmed up, as a draft to draw out the reader's judgment and discussion. So it has to state both the provisional conclusion and the unresolved issues.

## Required elements

- The central claim in the title or the first sentence (in the form 「〜すべきである」「〜が課題である」, not 「〜について」)
- Write the title and the first sentence in words that make sense before the body is read. Do not use names first explained in the body (「A案」「第2案」 etc.); say the content (「紙の申請書をやめて Web フォームにしたい」 rather than 「A案を採用したい」)
- Scope and what is out of scope (what is discussed, and what is deliberately not). List as out of scope only what appears in the material or the user's words
- The flow of background, problem statement, proposals or issues, unresolved issues, conclusion
- What this memo wants decided (at the top)

## Structure

Show the central claim and what you want decided at the top, then move to background and problem statement. Even when the conclusion has not firmed up, show it first, stating that it is the 「現時点での見立て」 (current view). With a structure where the claim is reached only by reading from the background onward, a reader who stops partway never learns what the memo wanted to say.

Write definitions of concepts in the running prose, not split out as a glossary. When the definition sentence 「Xとは〜である」 starts a paragraph three times in a row, that alone looks mechanical (SKILL.md §2 principle 8). Mixing forms — a parenthetical in mid-sentence (「起動率(アプリを開いてから災害情報を確認するまで進んだ利用者の割合)は〜」) or naming after use (「この動線を、本メモでは平時導線と呼ぶ」) — keeps the same pattern from repeating.

When comparing options, a comparison table with fixed axes helps the reader's judgment more than listing pros and cons. Laid out on the same axes across options, such as 「コストが低い/高い」「導入が速い/遅い」, the table lets readers read it by their own priorities. Mark cells where an axis does not apply to an option with 「—」. Do not write the table's or the material's circumstances as they are, such as 「該当しない」「記載なし」.

Without scope and out-of-scope, readers wonder why this issue is not touched. Adding one line on why it is deliberately not discussed (settled elsewhere, not enough information this time, etc.) conveys that it was left out on purpose, not by oversight. But do not invent plausible out-of-scope items absent from the material (such as 「顧客からの問い合わせは含めない」).

## About the writer's current view

A memo's value lies in the writer's current view being attached to the unresolved issues (such as 「現時点では A 案に傾いている」). A list of questions alone is no starting point for discussion.

But the view belongs to the writer. When you write a memo for the user, write only views that appear in the material or the user's words. If there are none, ask the user which way they lean. When revising an existing memo, do not add a view that is not in the original (the top rule in SKILL.md (add nothing that is not in the original)).

Views are not the only thing you must not add. Conditional judgments such as 「〜と分かったら始めないほうがよい」, and plans such as evaluation metrics, schedules, criteria for continuing or stopping, or new contacts and procedures, are not written either unless they are in the material. Writing something the writer did not commit to as the writer's plan makes readers take it as part of the proposal. If you think the plan is lacking, tell the user instead of adding it to the body.

A view is a view on the issue itself, not a ranking or tiering of issues such as 「最優先・次点・後回し」. In particular, when the core of the claim is that something applies equally to every target, write the targets in parallel without ranking them. For unresolved issues too, first consider whether they can be grouped by kind rather than by priority.

## Quality criteria

- The title or first sentence alone conveys what the memo claims. It does not stop at merely indicating the topic, like 「〜についての検討」
- Unresolved issues carry the writer's view. They are not just listed and closed with 「今後の検討課題」
- The comparison of options has axes the reader can use
- The central claim is supported by cases and numbers the writer checked, not generalities. If the claim holds with the proper nouns and numbers removed, the material is insufficient
- The reader knows what to judge next
- No judgments or plans absent from the material (evaluation metrics, schedules, conditional judgments, etc.) have been added

## Typical AI failures

The most likely is a memo that only organizes concepts, with no primary information or cases the writer checked. When paragraphs fill up with sentences like 「一般に〜と考えられる」「〜というアプローチが有効である」, anyone could have written the same content. Narrow down to the 2–3 issues that have material, write those thick, and keep the rest short (SKILL.md §2 principle 7).

Another is ending with a list of unresolved questions and no writer's view anywhere. Conversely, the AI may plausibly add views or numbers not in the material. Get the view from the material or the user.

## Principles that matter most (SKILL.md §2)

- Principle 1 (conclusion first): show the central claim in the title and first sentence. A preamble like 「〜について検討する」 does not replace a claim
- Principle 3 (cause and sequence in running prose): write the background and history of the issues in running prose; use bullets only for truly parallel items, such as comparison axes or a list of options
- Principle 10 (degree of certainty): write 「未解決」 for unresolved issues, then add the view
- Principle 11 (fact and opinion): do not mix primary information or findings with the writer's view. Distinguish 「〜と考える」 and 「〜と推定する」

## Example: a concept memo for a disaster-preparedness app

Consider writing a memo from the following material.

素材(ユーザーから受け取ったもの):県内の自治体アプリの利用状況を調べた県の報告書では、ダウンロード数に比べて災害時の起動率が低い。原因は、平時に開く理由がないことだと自分は見ている。通知方式の候補は、プッシュ通知だけの案、サイレンと連動する案、両方を組み合わせる案の3つ。比べる軸は、届く速さ、電池の消費、誤報のときに取り消しやすいか。プッシュ通知だけの案は速いが、誤報のときに不信感を招きやすいので、いまは組み合わせる案に傾いている。高齢者向けの画面をどう検証するかは決まっておらず、社内にユーザーテストの経験がない。外部の使い勝手調査に予算をつけるかを決めたい。

Example that only indicates the topic and ends with a list of questions:

> # 地域防災アプリの検討について
>
> 近年、災害時の情報伝達手段としてスマートフォンアプリが注目されている。本メモでは地域防災アプリの可能性について検討する。
>
> 検討すべき論点は以下の通りである。
> - 通知の仕組みをどうするか
> - 高齢者にも使いやすいUIをどう実現するか
> - 平時の利用をどう促すか
>
> これらについては今後さらなる検討が必要である。

Example with the claim and view written first:

> # 防災アプリが災害時に開かれない原因は、平時に開く理由がないことだと考える
>
> 県の報告書によると、県内の自治体アプリは、ダウンロード数に比べて災害時の起動率が低い。筆者は、原因は平時に開く理由がないことにあると考えている。このメモでは、通知方式と高齢者向けの画面について、判断してほしい論点を示す。
>
> 通知方式の候補は、プッシュ通知だけ、サイレン連動、その組み合わせの3案で、届く速さ・電池の消費・誤報のときの取り消しやすさで比べられる。プッシュ通知だけの案は速いが、誤報のときに不信感を招きやすい。筆者は現時点では組み合わせる案に傾いている。
>
> 未解決なのは高齢者向けの画面の検証方法で、社内にユーザーテストの経験がない。外部の使い勝手調査に予算をつけるかどうかを、このメモで判断してほしい。

The example with the claim and view first uses only the facts and views in the material, cites the source (the prefecture's report), and separates opinion from fact with 「考える」「傾いている」. The view on the cause is written with 「考える」 in the title too, not asserted as fact. No numbers, comparisons or proposals absent from the material were added.

## How it differs from minutes and reports

A research memo comes before minutes, which are a record (→ `minutes.md`), and reports, which convey reliable facts (→ `report.md`): it lays out the issues before discussion starts. So it ends not with decisions but with the issues the reader is asked to judge. Without this awareness, issues that have not firmed up get written as if certain, and need correcting later.

Write a memo on the assumption that readers will reply with agreement or objection. Writing, for each issue, one sentence on what the reader is asked to judge makes it easier for readers not just to receive it but to respond.
