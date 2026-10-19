# Internal guide / manual (社内ガイド・マニュアル): readers open it only when they are stuck

The question an internal guide answers is how to do this operation right now. Getting the reader to understand the whole system is not the main goal. Most readers do not read it through; they jump from the table of contents or a search to the chapter they want, read only that chapter, and go back to work. So a guide is judged less by how complete it is when read through than by whether it leaves the reader lost when only part of it is read. This file covers chapter structure and the paths between chapters. For how to write sentences, follow SKILL.md §2.

## Required elements

- A 「まず覚えること」 (what to remember first) block at the top: the minimum actions to follow, numbered, 3–4 items
- The intended reader (a title or one line at the top that makes it clear is enough. State prerequisite knowledge only when the reader needs it to judge whether the guide is for them)
- Which part is read through and which part is looked up when needed (at the top, write something like 「1〜3章は初回に通読、4章以降は必要なときに引く」)
- A glossary (terms explained in the body also appear again as a list at the end)
- Where to ask (where to take questions this guide does not resolve)

The one most often missing is the split between the part to read through and the part to look up. The writer assumes the table of contents makes it obvious, but the reader cannot judge from the table of contents alone. If the top does not say how far to read for a minimum understanding, the reader either skims every chapter every time or skips chapters they actually need.

## Vary the structure by the nature of the chapter

When every chapter is written with the same structure, the reader has to re-judge, chapter by chapter, how carefully to read. When the structure matches the nature of each chapter, the reader can switch reading mode just by seeing the structure.

- Narrative: suits introductory chapters. Explains in order, following the flow of the work
- Reverse lookup: shows the means for each 「〜したい」 (I want to ...), close to a lookup table. Suits readers whose goal is already fixed
- Hands-on: one operation per step, with one line right after each step saying why you do it. Steps and reasons alternate, so the reader follows the operation by understanding rather than memorizing
- Reference: parameters and settings laid out in a table. Not something to explain in running prose

Whatever the structure, use the following as the baseline. A guide is a document people look things up in, and readers search for the lines that concern them, so this takes priority over principle 3 in SKILL.md, 「箇条書きは本当に独立して並ぶときだけ」 (bullets only when items are truly independent).

- The top may open with one line addressed to the reader (for newcomers, a line of welcome). Follow with 「まず覚えること」 as 3–4 numbered items (more cannot be remembered), then a note on what to read. Do not write preambles the reader will not use for their next action, such as who prepared the guide or what assumptions it is written under
- Headings are short names that make it clear at once what the section is about (「VPN につながらないとき」「パスワードの再設定」). A structure that puts a conclusion sentence in the heading and the content in running prose gets skipped in a guide (this takes priority over the heading rule in SKILL.md §1). Give each item (a rule with a deadline, one operation, one exception) its own subheading. Do not merge items into one section joined by running prose. Write each item's content only as bullets and numbers, with no introductory sentence or paragraph of reasons in between. When a reason is needed, add it in a few words in parentheses at the end of that line
- Steps are numbered, one action per step. Before the steps, say in one sentence what they do. Add the reason in a few words right after the step, and move long explanations to a separate section (do not start explaining the mechanism in the middle of the steps)
- Rules (deadlines, conditions, exceptions) go in bullets
- Do not use stiff wording such as 「該当の」「当該」「〜の際は」; write in everyday spoken words (「その節を開く」 rather than 「該当の節を開く」)
- Put common mistakes in a two-column table of symptom and fix (「VPN につながらない|ルーターを再起動してから、もう一度つなぐ」). Readers search by symptom, so make the fix readable on the same row. Contacts (困りごと|連絡先) and terms (用語|意味) also go in tables
- In sentences addressed to the reader, check that the reader is the subject. Do not mix the writer's circumstances (who distributes it, why this guide was made) into one sentence with an instruction to the reader. 「全体会議で共有し、迷ったときに参照してください」 has a twisted subject: the writer shares it, the reader refers to it

Keep involved supplements out of the body; separate them as a 「深掘りノート」 (deep-dive note), at the end of a chapter or similar. But if the line introducing the note is the same wording every time, that itself becomes a monotonous pattern. In each chapter, use a line that says what the note supplements.

## Quality criteria

- The reader can reach the target chapter from the headings in the table of contents alone. Use names that say what the section is about, like 「VPN につながらないとき」, not names whose content is unclear, like 「概要」「利用方法」
- A reader who has not read the earlier chapters can do the task from that section alone. Do not write bridging sentences between chapters such as 「ここまでで〜できました。ここからは〜です」 (in a lookup document they are not read and only lengthen the section). Only in a long narrative introductory chapter may you note its relation to the previous chapter in one line
- When the same concept is explained in several chapters, the later chapters state only the differences. Write something like 「詳細は3章を参照。ここでは4章で違う点だけを述べる」
- Chapters not yet written are not padded with boilerplate to the same thickness as the others. For some chapters, writing 「準備中」 and showing only where to send questions is enough
- Operations that must not be done are written as a pair of operation and result. Do not stop at 「注意してください」; say what happens if you do it

## Typical AI failures

The most common is writing every chapter with the same structure and the same sentence length, so the reader cannot judge each chapter's weight. A chapter that needs 2 lines and one that needs 10 get the same heading level and section structure. Deciding, before writing, how much each chapter is worth writing prevents this (SKILL.md §1 "Density").

Next most common is pasting a stock bridge such as 「詳細は次章で解説します」 into every chapter: it looks like a bridge but connects nothing. Another is stating screen operations or behavior that have not been checked as certain. For unchecked steps, mark the certainty, as in 「〜と表示される想定」, and limit assertions to what the material or the user has confirmed.

## Principles that matter most (SKILL.md §2)

- Principle 2 (headings): in a guide, a heading is not a conclusion sentence but a short name that says what the section is about. In a reverse-lookup chapter, each line is a mapping of 「症状や目的 → 手段」 (symptom or goal → means)
- Principle 7 (density): write the read-through part thick, and the lookup part light, with tables and short notes
- Principle 8 (do not repeat a pattern): check whether chapter openings, the lines introducing 深掘りノート, and the wording of references to other chapters take the same form three times in a row
- Principle 10 (degree of certainty): mark unchecked steps and chapters not yet written with a label showing their state

## Template: the shape of one guide

As an example, an internal VPN connection guide at a fictional company.

```
# 社内 VPN 接続ガイド(在宅勤務をする人向け)

在宅勤務を始める方へ。自宅から社内のシステムを使うときは、このガイドの手順で VPN につないでください。

## まず覚えること
1. 社内のシステムを使う前に、VPN アプリで「接続」を押す
2. パスワードは90日ごとに変わる。期限の7日前に通知が届く
3. つながらないときは、下の「困ったとき」を見る

初回は「はじめての接続」だけを読めば足ります。ほかの節は、必要になったときに開いてください。

## はじめての接続
1. 社内ポータルから VPN アプリをダウンロードする
2. アプリを開き、社員番号とパスワードを入れる
3. スマートフォンに届く確認コードを入れる

## パスワードの更新
- 90日ごとに更新が必要
- 期限の7日前に、メールで通知が届く
- 期限を過ぎると接続できなくなる(情報システム部で再発行が必要)

## 困ったとき
| 症状 | 直し方 |
|---|---|
| 「認証に失敗しました」と出る | パスワードの期限が切れていないか確かめる |
| つながるがすぐ切れる | 自宅のルーターを再起動してから、もう一度つなぐ |
| 確認コードが届かない | 情報システム部に連絡する |

## 問い合わせ先
| 困りごと | 連絡先 |
|---|---|
| 接続の操作 | 情報システム部(#it-help) |
| 在宅勤務の申請 | 総務部 |

最終更新日:2026年4月1日
```

In this template, the opening line is only an instruction with the reader as subject; it does not say who made the guide. Each item has its own subheading, and its content is only numbers and bullets, with no paragraphs of running prose. Symptoms and fixes, and contacts, are tables. Reasons are kept to a few words in parentheses at the end of the line, as in 「(情報システム部で再発行が必要)」.

## Example: an internal guide to an expense reimbursement system

Consider writing a chapter of the guide from the following material.

素材:申請は領収書1枚につき1件。経理の突き合わせが領収書単位なので、まとめて申請すると差し戻しになる。承認後の振込は自動で、通常は3営業日。月末は遅れることがあるが、どのくらい遅れるかは経理チームに確認中。

Example written with a heading whose content is unclear and running prose:

> ## 概要
> 経費精算システムの使い方を説明します。申請は領収書1枚につき1件です。経理の突き合わせが領収書単位で行われるため、まとめて申請すると差し戻しになりますので注意してください。承認後は自動で振り込まれます。

Example written with headings that say what the section is and bullets:

> ## 申請のしかた
> - 領収書1枚につき1件で申請する。まとめて申請すると差し戻しになる(経理の突き合わせが領収書単位のため)
>
> ## 振込
> - 承認後、自動で振り込まれる。通常は3営業日
> - 月末は遅れることがある。どのくらい遅れるかは経理チームに確認中【要確認】

Both examples use only the same material. With the second, the reader finds the heading, reads one bullet line, and is done. The reason is kept to a few words in parentheses, and the unconfirmed month-end delay is not asserted but marked 【要確認】.

In a reverse-lookup chapter, the shape of the headings itself changes. Consider writing the same guide's 「困ったときは」 chapter from the following material.

素材:領収書をなくしたときは「紛失理由書」フォームから代わりに申請できる。差し戻しの理由は、通知メールの末尾に書いてある。海外出張の外貨の領収書は、申請日のシステム内レートで自動で換算される。

Lay out the headings like this.

> ## 領収書をなくした → 「紛失理由書」フォームから代わりに申請できる
> ## 申請が差し戻された → 差し戻しの理由は、通知メールの末尾に書いてある
> ## 海外出張の領収書が外貨 → 申請日のシステム内レートで自動で換算される

Where a narrative chapter explains one flow of operations in order, in a reverse-lookup chapter each line is an independent mapping. Readers read only the line closest to their situation, so the connection between lines does not matter. Even within one guide, the structure may differ from chapter to chapter.

## A guide is fixed while it is in use

An internal guide is a document where readers' questions become the material for the next revision as they are. Put the last-updated date at the end, and add where to ask about anything this chapter did not make clear.

There is no need to rewrite every chapter at each revision. Thicken only the chapters where questions concentrated, and leave chapters with no questions as they are. If every chapter keeps being updated the same way, readers cannot tell what changed.

Unlike minutes or reports, an internal guide is not a document for preserving the state at the time of writing. It exists to change what the reader does now, so a leftover old procedure leads to an actually wrong operation. Do not hide the last-updated date; write it.
