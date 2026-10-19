# Slide outline (スライド構成): the message lines alone carry the argument

The question a slide deck answers is whether, reading only the message lines from top to bottom, the path to the conclusion comes through. Build on the assumption that the audience looks at a slide for a few seconds and properly reads only the title and the one most prominent sentence. So put the whole claim in the message line, and keep the supporting bullets as material that backs it. This file covers the structure and the role of each element. For how to write sentences, follow SKILL.md §2.

## Required elements

Build each slide from these three.

- Title: the theme the slide deals with. A short noun phrase is fine
- Message line: one sentence that states the slide's conclusion outright (also called the lead sentence). Place it in the most prominent position, right below the title. One sentence, up to about 50 characters. If it grows long from listing what you want to say, narrow it to the one point you most want to make, and move the rest to the supporting bullets or split the slide
- Support: bullets backing the message line. Prefer numbers and cases; do not restate generalities. Match the count to the slide's weight; if one point is enough, one point is fine

## Structure

The basic flow has three parts: introduction (share the problem and the goal), body (groups of support, at most 3), conclusion (what you want done next). Split the body into 4 or more groups and the audience cannot tell which is the main line and which is an add-on. When there are 4 or more pieces of support, treat the main 2–3 thickly and touch the rest lightly on one slide (SKILL.md §2 principle 7).

For checking, the most useful thing is reading only the message lines, start to finish, in one go (SKILL.md §5 "Structure check"). Check the following.

- Does the argument hold
- Does each line state a conclusion
- Is the same sentence pattern repeating
- Is there a difference between important slides and the rest
- Does the last slide lead to what you want done next

If the argument does not hold here, no amount of polishing the support will get the talk across.

When writing it out as text too, present each slide kept to a few lines: title, message line, bullets. Not inserting paragraphs of explanation is the big difference from the other document types; since you cannot lean on running prose, concentrate the information in the one message sentence. Do not bold labels like 「タイトル:」「メッセージ:」 or the bullet phrases. When every line is bold, emphasis stops working as emphasis and the screen gets noisy.

## Quality criteria

- The message line fits in one sentence of about 50 characters. It is not a long sentence that merely lists items, like 「A、B、Cの3点はまだ分かっていない」
- The message line states the conclusion outright. It does not stop at a label like 「新機能の概要」 but goes as far as 「新機能で入力時間が半分になる」
- Reading only the message lines in sequence, you can follow the flow to the conclusion. The argument is clear even when support slides are skipped
- Support is written with concrete numbers and cases. It is not filled with generalities like 「効果が見込まれる」
- Slides differ in information volume. If every slide has the same line count and the same number of bullets, the difference in importance is gone
- The last slide shows what you want the audience to decide or do. It does not end with 「ご清聴ありがとうございました」

## Typical AI failures

The most common is a message line that ends as a label and states no conclusion. Put a title like 「導入のメリット」「今後の展望」 in the message position, and what the slide claims is unclear until all the support has been read.

Next most common is shipping places where material is lacking as fill-in blanks like 「[サービス名]」「[想定コスト]」. A placeholder meant to be filled later gets submitted as a finished outline. If material is lacking, ask the user before filling it in.

Another frequent one is every slide's bullets coming in exactly 3 points every time, so important slides and light slides cannot be told apart.

## Principles that matter most (SKILL.md §2)

- Principle 1 (conclusion first): make the message line the slide's conclusion itself. Not a preamble or a summary of the background
- Principle 2 (conclusions in headings): in slides the title may be a label, but the message line must always be a one-sentence conclusion
- Principle 7 (density): narrow the body groups, add numbers and cases thickly to important support, and keep light support to one line
- Principle 12 (the close): end the last slide not by repeating facts but with what you want the audience to do

## Example: a proposal slide for a sales-support tool

Consider writing one slide of a proposal from the following material.

素材:いまは CRM と見積システムに同じ案件情報を別々に入力していて、1案件あたり平均12分の重複作業がある。新しいツールは CRM への入力を見積システムに自動で反映するので、この重複がなくなる。3チームで試験導入したところ、4週間後に営業1人あたり平均で週1.8時間の作業時間が減った。

Example that ends as a label:

> タイトル:新営業支援ツールについて
> メッセージ:新ツールの導入メリット
> - 業務効率が向上する
> - 情報共有がスムーズになる
> - 顧客満足度の向上が期待できる

Example that states the conclusion outright:

> タイトル:案件情報の二重入力
> メッセージ:二重入力をなくした試験導入で、営業1人あたり週1.8時間の作業が減った
> - いまは CRM と見積システムに同じ情報を別々に入力しており、1案件あたり平均12分の重複作業がある
> - 新しいツールは CRM への入力を見積システムに自動で反映し、この重複をなくす
> - 3チームの試験導入で、4週間後に平均で週1.8時間の削減を確かめた

With the label example, reading all three pieces of support still does not tell how much things improve, and the support is generalities not in the material. The outright example uses only numbers in the material, and the message line's number is the same 1.8 hours per week as the support. Rounding the number up in the message line contradicts the support. Also, since this is the result of a trial in 3 teams, it is not written as an effect that holds anywhere (「なくすと減る」) but as 「試験導入で減った」.

The same difference shows up on the introduction slide. Just listing 「現状の課題」「新ツールの提案」「導入スケジュール」 under the label 「本日のアジェンダ」 leaves the audience guessing at the content. Writing the agenda itself as a preview of the conclusion, like 「二重入力をなくした試験導入で、営業1人あたり週1.8時間の作業が減った。全体への導入と、その時期を提案する」, tells the audience on the first slide what to listen for.

## When material is lacking, ask instead of filling in

In slide requests, numbers such as company names, costs and rollout dates are often not all there at the start. Producing a provisional outline with fill-in blanks like 「[サービス名]」「約[金額]円」 looks finished but has no content, and leads to large rework later. When you notice a place lacking numbers or proper nouns, confirm with the user which numbers to use before filling it in. If there is a reason it cannot be confirmed, write 【要確認】 there and say it is meant to be replaced later.

Even when the request is a single sentence like 「〇〇についてのプレゼン資料を作って」, there is less rework if you first show the conclusion (candidate message lines) and the number of body groups and get agreement, then fill in the support. If the structure is wrong, fixing it at the structure stage is far lighter than fixing it after building out the slides.

## Decide the slide count from the number of conclusions

Fixing the slide count first and then allocating content produces slides that only fill time, or slides crammed with too many claims. First count how many groups the body's support forms, then add the introduction and conclusion to get the slide count. Building a three-group structure when there are only two groups pads one of them.
