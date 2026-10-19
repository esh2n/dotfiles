# Research report (調査レポート): write how the numbers bear on the decision

## The question this document answers

A research report answers what is happening and what to do next. Collecting and describing data does not finish the research. What readers want is less the numbers themselves than how the numbers bear on a decision; if the writer does not go that far, readers end up looking at the charts and reinterpreting them themselves. A good report lets the reader decide what to do next from the first few lines alone.

## Required elements

The purpose of the research (who decides what with it), the summary at the top (main message and points), the findings, the proposal of what to do next, the limits of the data, and the method (enough for a third party to follow the same steps). Order them in this order as well. Of these, never omit the method and the limits of the data, however short. Without a method, readers cannot check how reliable the numbers are; without limits, the numbers take on a life of their own.

## Structure

Build it as a pyramid, so that readers can decide from the top alone and only those who want to check the grounds go into the body. Make the top and the proposal bullets or tables so they can be picked up at a glance, and build the body sections for careful reading: a one-sentence conclusion, a table, and short running prose giving the reasons.

- On the first line, state the purpose of the research in one sentence (「7月の部会で解約対策を決めるため、4〜6月の解約を調べた」). Do not make it a section
- Then write the one-sentence main message. If the request includes "what we want to decide", the main message says how to decide it (「〜を確かめてから、〜を決めるのがよい」); do not stop at findings. Then list 2–4 points supporting the main message as numbered bullets. Each item is a one-sentence conclusion plus the main numbers. Keep the points from overlapping
- Do not put definition or method sections at the top. Write a definition in one line next to the table where that number first appears, and move the method section to the end
- Map the body sections one-to-one to the points at the top, and write each heading as that point's conclusion in sentence form. Reading only the headings in order should trace the points at the top. Each section opens with its conclusion, followed by the grounds (tables and numbers)
- Things laid side by side for comparison — segments, hypotheses, options — may be tables. In reports this takes priority over SKILL.md principle 3's "bullets only when items are truly independent". What readers want is the result of the comparison, and dissolving it into running prose makes it hard to compare
- Write facts (what happened), interpretation (so what can be said) and actions or checks (what to do next) separately, so readers can tell which each sentence is
- Split the proposal into "checks that can be done before deciding" and "options to choose from at the decision meeting". Make the options a table or bullets, each with the supporting numbers, what to confirm, and the condition for choosing it (「検証で〜なら A、〜なら B」). Build the options from the stakeholders' proposals in the material, options decided by the result of the checks, and a do-nothing (wait) option; do not add measures or numbers not in the material (duration, cost, expected effect, etc.). If you as the writer favor an option, write 「〜と考える」 and favor at most one. In a fixed-point monitoring report where the request has nothing to decide, do not create options
- Put the limits of the data and the method after the proposal. But place notes on easily misread numbers right next to those numbers (quality criteria)
- Move technical details such as aggregation queries or breakdowns of exclusion conditions to the end or an appendix

For a follow-up study, write one paragraph right after the summary at the top on the relation to the previous study. Showing first what changed to prompt the re-study, and which parts of the previous conclusion carry over and which are overturned, makes the body's position clear. If a past issue contained an error, correct it near the top, not at the end, because readers need to know about the correction before reading the conclusion.

## Quality criteria

- Someone who reads the summary at the top knows what to do next. If it only lines up numbers and their meaning is written only deep in the body, it is not a summary
- Facts and discussion are written distinctly. Write so that a fact such as 「〜だった(出典: アクセス解析、7月集計)」 and the writer's discussion such as 「〜と考えられる」 can be told apart even within running prose. Also do not mix your own company's data with analogies from other companies' cases
- The writer annotates easily misread numbers first. Points such as a total or average being pulled by one outlier, a small base making the ratio unstable, or seasonal effects preventing a simple comparison are written before the reader notices them. Do not gather the notes at the end; place each right next to its number
- The meaning of numbers is restated. Do not stop at 「継続率は4%だった」; writing 「96%は継続しなかった」 conveys the meaning without the reader calculating
- The definition of the population sits next to the table where that number first appears. State whether 「訪問数」 is all access including bots or visits after excluding them, and the aggregation period from when to when. If the definition changes from study to study, comparison with the previous one does not hold
- There is density variation across segments. Do not line up every segment in the same sentence pattern and length; write the segments that changed thickly, and settle the ones without change with a single 「特に変化なし」

## Typical AI failures

The most conspicuous failure is stopping at describing the data without writing what to do next. The text ends at 「訪問数は前月比で減少した」, and nowhere does it say what should therefore be done.

Conversely, the AI sometimes writes proposals beyond what the grounds support. Deciding even the priority of measures from only some of the numbers makes the conclusion contradict the bias written in the notes.

Other frequent failures:

- Lining up per-segment descriptions in the same pattern — 「Aチャネルは〜だった。Bチャネルは〜だった。Cチャネルは〜だった。」 — hiding where the important differences are
- Gathering caveats at the end, so that the fact that one outlier pushed up the total reaches only those who read to the end
- Comparing with the previous period without stating the population definition. Writing increases and decreases without confirming the definition is the same as last time can amount to comparing differences in aggregation method

## Principles that matter most (SKILL.md §2)

- Principle 1 (conclusion first): the summary at the top is itself the conclusion with numbers
- Principle 12 (closing): do not end with a description of facts; write what to do next, but do not exceed the range of the grounds
- Principle 11 (fact and opinion): make sources, the distinction between primary and secondary, and the parts that are discussion explicit
- Principle 10 (degree of certainty): write the limits of the data and corrections of past errors without hiding them
- Principle 7 (density): vary the amount written per segment

## Template

The example is the top and proposal parts of a monthly report investigating the traffic sources of the fictional e-commerce site 「そらマルシェ」.

```
# そらマルシェ 流入経路調査(2026年6月分)

7月の販促会議で SNS 導線への予算配分を決めるため、6月の流入経路を調べた。

訂正: 前号(5月分)で「検索流入は横ばい」と書いたが、集計対象に
社内アクセスが混入しておりデータの誤りだった。除外後は前月比
5%減で、今号の「2カ月連続の減少」は訂正後の数値にもとづく。

SNS 導線への予算配分は、上位1商品を除いた7月の購入率を見てから決めるのがよい。

1. 検索流入が2カ月続けて減った(71,200件、前月比 -8%)。総訪問数の減少(-3%)の主因である
2. SNS経由の購入率は4.6%で、サイト平均(2.0%)の2.3倍に見える
3. ただし購入の41%が上位1商品(季節限定の虫よけスプレー)で、除くと2.1%と平均並みになる

(本文:論点ごとの節。見出しは論点の結論の文、頭に結論、続けて表と理由)

## 次にすべきこと

会議の前にできる検証
- 上位1商品を除いた SNS 経由の購入率を、7月前半の分で出す

会議で選ぶ選択肢
| 選択肢 | 支える数字 | 選ぶ条件 |
|---|---|---|
| SNS 導線の予算を増やす | 購入率 4.6%(平均の2.3倍) | 1商品を除いても平均を上回るとき |
| 今の配分のまま、検索流入の減少を先に調べる | 検索流入 2カ月連続の減少 | 1商品を除くと平均並みのとき |

## データの限界 / 方法
(末尾に置く)
```

## Text that stops at description vs. text that goes on to what to do next

Consider writing the report body from the following findings.

素材:6月の数字。総訪問数 128,400(前月比 -3%)。検索流入 71,200(前月比 -8%、2カ月連続の減少)。SNS経由の購入率 4.6%(サイト平均 2.0%)。SNS経由の購入の41%が上位1商品で、この商品を除くと購入率は2.1%。チームの考え:SNS導線に力を入れるかは、この1商品を除いた数字を見てから決めたい。

Text that stops at description:

> 6月の総訪問数は128,400件で、前月から3%減少した。検索流入は71,200件で前月比8%減、SNS経由の購入率は4.6%だった。

Text that goes on to what to do next:

> 6月の総訪問数は128,400件で、前月比3%減だった。検索流入は2カ月続けて減り、前月比8%減の71,200件だった。前月比から逆算すると、検索流入の減少は約6,200件で、総訪問数の減少(約4,000件)より大きい。ほかの経路からの訪問は増えていることになる。SNS経由の購入率は4.6%でサイト平均の2.3倍だが、購入の41%を占める上位1商品を除くと2.1%で、平均(2.0%)とほぼ同じになる。チームとしては、SNS導線に力を入れるかどうかを、この1商品を除いた数字を見てから決めたい考えである。

The descriptive text only lines up numbers, leaving readers to work out what to do. The other text uses only numbers from the material, shows by calculation that the drop in search traffic exceeds the drop in total visits, states first that the high SNS purchase rate is propped up by one product, and then writes the team's view as an intention (「決めたい考えである」). The calculated numbers (about 6,200 and about 4,000) are derived from the material's numbers; no number or reason absent from the material is added.
