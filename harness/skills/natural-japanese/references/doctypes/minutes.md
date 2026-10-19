# Minutes (議事録): write decisions and action items apart from the body

## The question this document answers

Minutes answer what was decided, and who does what by when; recording what was said is not the goal in itself. Most readers either did not attend or attended but remember vaguely, and they only need to confirm the decisions and action items in a few tens of seconds. A record that just traces the remarks in chronological order buries the decisions in the body, and the reader ends up rereading everything.

## Required elements

Meeting name, date and time, attendees; the gist of the discussion per agenda item; decisions (決定事項); action items (宿題) with owner and due date; open items (継続議題). Of these, the three — decisions, action items and open items — are separated from the discussion in the body and gathered at the top. Left buried in the body, the reader has to collect "so what was decided after all" on their own.

Give every action item an owner and a due date. 「チーム全員で対応」 or 「なるべく早く」 does not settle who moves when. If no owner has been decided, write 「未定」.

When revising existing minutes, do not fill in owners or due dates that are not in the original record by guessing. If adding a column or section that is not in the original (a due-date column, an open-items section, etc.) would leave it mostly 「未定」, do not add that column or section.

## Structure

The structure in this section is for writing new minutes. When revising existing minutes, do not change the order or arrangement of sections (SKILL.md §3). If you think moving decisions or action items to the front would make them easier for the reader to find, propose doing so to the user.

At the top, put the meeting name, date and time, attendees and pre-read materials as bullets, one item per line. In Markdown, lines separated only by a line break render joined into one paragraph, and the miscellaneous information becomes one lump that discourages reading, so do not line up plain-prose lines. Then write one paragraph on the premises of the record: stating up front how accurate the transcription is, whether there is a recording, and how certain the speaker attributions are lets readers judge for themselves how far to trust the body. Put the contact for corrections (comments, Slack, etc.) here too.

Next, gather the decisions, action items and open items. This is what readers want to confirm first, so place it before the body. Decisions and open items are bullets; action items are a table or bullets with owner, task and due date.

Split the body into one section per agenda item, and make each heading a summary of what was decided, what was not decided, or what was discussed on that item. Write the course of the discussion in the body as running prose. Do not treat an item that takes 2 lines with the same weight as one that takes 10. If needed, add a 「次回に向けたメモ」 at the end. This memo does not repeat the body; it states only what to change next time.

Noun-ending sentences and the 「である」 style are fine; there is no need to unify on the polite style. Keep key remarks in the speaker's own tone. Tidying 「それ先に言ってよ」 into 「それを先に言ってほしい」 erases the force of the remark and the information of who said it how.

## Quality criteria

- Reading only the list of decisions tells you what changed and how. 「引き続き検討する」 is not a decision, so move it to open items
- Each action item has all three of owner, due date and task. A good example is 「田中: 在庫アラートのしきい値案を7/18までに作成」; a bad one is 「アラートのしきい値については検討していく」
- The certainty of speaker attribution is differentiated. Where the speaker was inferred from a transcript, add something like 「(佐藤さんと推定)」
- The course of the discussion is in running prose, and only the decisions and action items are bullets, because discussion has causality and chronology. But a list whose items are independent and searched later for a specific item, such as a list of advice, stays as bullets
- Advice and comments carry a word on the other party's response. Recording only the advice in a review or 1on1 turns it into a record of a one-way lecture, and what was agreed becomes unclear. 「了承した」 or 「持ち帰って検討する」 is enough. If the original record has no response, do not write one by guessing

## Typical AI failures

The most common failure when an AI writes minutes is summarizing every remark with the same weight, so the decisions are buried at the same weight as other opinions. When a confirmation that took 5 minutes and a point debated for 30 minutes sit side by side with the same number of lines, readers cannot tell what mattered. Speaker certainty is not differentiated either; everyone tends to assert, or everyone becomes 「〜と思われる」.

Writing 「合意した」 for something that was not decided is another common failure. When extracting decisions from a transcript, proposals and agreement are easily mistaken for decisions.

Another is removing fillers like 「えーと」「まあ」 but leaving the verbose wording of speech. 「その件についてはですね、まあ一旦持ち帰らせていただいて、社内で検討した上でまた改めてご相談させていただければと思うんですけれども」 is covered by 「持ち帰って検討する」.

## Principles that matter most (SKILL.md §2)

- Principle 10 (differentiate degrees of certainty): differentiating the limits of the record and the certainty of speaker attribution is the central job of minutes
- Principle 3 (causality and course of events in running prose): follow the course of the discussion in running prose rather than lining it up as bullets
- Principle 2 (put the conclusion in headings): an agenda heading states what was decided on that item, not 「議題1」
- Principle 7 (density): settle light items in a word, and write only heavy items thickly
- Principle 6 (bold): even when keeping a key remark, bold only the core of that remark

## Template

The example is the development standup of 「在庫すいすい」, an inventory management service developed by the fictional SaaS company ソラベース社.

```
# 在庫すいすい開発定例(2026-07-10)

出席: 田中(PM)、佐藤(バックエンド)、鈴木(デザイン)
記録: 会議の録音はなく、田中のメモをもとに構成した。発言者の帰属は
おおむね確実だが、一部推定が入る箇所は「(推定)」と注記する。訂正
はこのドキュメントへのコメントで受け付ける。

## 在庫アラートのしきい値は在庫数でなく在庫回転率で決める
現行のしきい値(在庫数10個未満で通知)は季節商品で誤検知が多いと
佐藤が指摘した。鈴木は、店舗担当者からも同様の苦情が来ていると
補足した(推定: どの店舗からかは未確認)。在庫回転率を基準にする
案を田中が提案し、合意した。

## 決定事項
- しきい値の算出方法を在庫数から在庫回転率に変更する

## 宿題
- 田中: 回転率ベースのしきい値案を7/18までに作成
- 佐藤: 現行ロジックの改修範囲を7/15までに見積もる

## 継続議題
- 通知先をSlackに一本化するかは未定。次回、鈴木がUI観点の意見を持ち寄る
```

## Example: turning a transcript-style record into minutes

Original:

> 田中さんから在庫アラートについて説明があり、現行のしきい値だと誤検知が多いという話になった。佐藤さんはそれに対して在庫回転率を使う案を出し、鈴木さんも賛成した。最終的にどう決まったかは次回また相談することになった。

Revised:

> 在庫アラートの件は結論が出ず、次回また相談することになった。田中さんから在庫アラートの説明があり、現行のしきい値では誤検知が多いという話になった。佐藤さんが在庫回転率を使う案を出し、鈴木さんも賛成した。
>
> 継続議題
> - 在庫アラートの件(次回また相談)

The original traces the course of events chronologically, so you do not learn that nothing was decided until the end. The revision puts the conclusion (carried over) first and moves the course of events after it. It adds no decision, owner or due date that is not in the original, and who said what stays as in the original.
