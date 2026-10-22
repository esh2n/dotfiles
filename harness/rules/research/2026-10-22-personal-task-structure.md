---
question: "仕事と私生活の全タスクを Taskwarrior 3.5 一つで扱うとき、最上位の分け方、project と tag の意味、優先度、受信箱、見直し、見積もり、日付の使い分けは、何を根拠に決められるか"
date: 2026-10-22
verdict: "測定で決まる項目はほぼ無い。実践者とベンダーの合意があるのは三つで、project は終わりのある成果物に使う（GTD・PARA）、due は本当の締め切りにだけ付けて着手日は scheduled と wait で表す（Things・Todoist・Linenberger）、受信箱と週次の見直しを持つ（GTD・Todoist）。仕事と私生活を最上位で分けるかは GTD 公式が『正解は無い』とし、境界理論の測定は分離か統合かより本人の好みとの一致と制御感が効くと示すだけ。重要と緊急の二軸、緊急の N 日、重要の二値化、見積もりの要否は、支持も反対も資料が無く好みで決める"
unverified:
  - "Zhu, Yang & Hsee 2018 の数値（選択率、効果量）。抄録の文だけを取得した"
  - "Mills, Cubitt, Starmer 2026 の追試の数値。二次記事経由"
  - "Halkjelsvik & Jørgensen 2012 の結論。書誌のみ確認"
  - "Things 公式の Areas の定義文と、Todoist 公式の『仕事と私用を分けるか』の記述"
  - "Taskwarrior で tag の乱立や深い階層が失敗した例（見つからなかった）"
  - "to-do アプリを放棄する理由の調査（近いのは健康アプリの scoping review だけ）"
  - "GTD の hard landscape という語が Allen 自身の資料にあるか"
sources_note: "取得はすべて WebFetch と WebSearch の要約を通しており、引用は原文で照合していない。urgency_due だけはソースの抜粋を取得した。"
---

# 個人の全タスクを Taskwarrior で扱うときの構造の根拠

## 最上位の分け方（仕事と私生活）

- GTD 公式ブログは、一つのリストにまとめる側として「We don't necessarily recommend trying to keep a clear point of demarcation between our personal lives and work lives」と書き、同じ回答で「There really isn't a right or wrong here.」とも書く。会社の規則で私用データを置けない人は二重管理になる、とも述べる。https://gettingthingsdone.com/2016/12/should-i-have-separate-list-for-personal-and-professional/
- PARA は仕事と私生活を軸にしない。どちらの領域にも project（終わりがある）と area（終わらない）があるという立て付け。https://fortelabs.com/blog/para/
- 境界理論の測定は、タスクリストではなく仕事と家庭の境界についてのもの。
  - Kreiner 2006（n=325）は、分けたいか混ぜたいかの本人の好みと職場の境界が一致すると、葛藤とストレスが低いと示した。効果量は未確認。https://pure.psu.edu/en/publications/consequences-of-work-home-segmentation-or-integration-a-person-en/
  - Kossek ほか 2012 は、分離型か統合型かより、本人が境界を制御できているかが結果を分けると示した。
  - Ashforth ほか 2000 は概念モデルで、分離と統合は一長一短とする。
- タスクを一つのシステムにまとめた場合と分けた場合を比べた測定は見つからなかった。

## project と tag

- GTD と PARA の定義では、project は複数の手順からなり、終わりのある成果物。終わらない責任の領域は area（GTD の Horizon 2、Things の Areas、OmniFocus の folder）。https://gettingthingsdone.com/2011/01/the-6-horizons-of-focus/
- Taskwarrior の project は 1 タスクに 1 つなので、領域と成果物を両方持たせるなら、最上位を領域、二段目を成果物にする形になる（組み合わせ自体は推論）。
- Taskwarrior 公式の best practices は、できる限り project を付けること、tag は絞り込みに便利なこと、due と priority を付けすぎたり動かしすぎたりしないことを書く。https://taskwarrior.org/docs/best-practices/
- Taskwarrior での GTD の実践例（CS SYD、2015）は、project を成果物にし、受信箱を `task in` で処理し、context を tag にする。https://cs-syd.eu/posts/2015-06-14-gtd-with-taskwarrior-part-1-intro
- 場所だけの context（@computer など）はスマートフォンの普及で弱まった、という意見が実践者に多い。人、待ち、短時間のような少数の実用的な tag は支持されている。どちらも測定は無い。

## 優先度

- 「重要なものはめったに緊急でなく、緊急なものはめったに重要でない」は 1954 年の Eisenhower の演説の言葉で、本人は他人の言葉として引いた。マトリクスにしたのは Covey とされる。https://quoteinvestigator.com/2014/05/09/urgent/ （本文は取得できず、検索結果の抜粋のみ）
- Zhu, Yang & Hsee 2018 は、5 つの実験で、報酬が低くても期限が迫って見える課題が選ばれやすいと示した（「a tendency to pursue urgency over importance」）。2026 年の追試（n=2,374）では効果が弱まったが検出された。二軸で管理すると成果が上がる、という測定ではない。https://academic.oup.com/jcr/advance-article/doi/10.1093/jcr/ucy008/4847790
- アイゼンハワーマトリクスや Ivy Lee 法の効果を比べた研究は見つからなかった。GTD は、優先度をその場で判断するものとし、固定の優先度の項目を前提にしない。
- 「N 日以内なら緊急」とする基準の N を示した資料は無い。重要を二値にすることを支持する資料も反対する資料も無い。
- Taskwarrior の urgency の既定係数は priority H=6.0、due=12.0、scheduled=5.0。https://taskwarrior.org/docs/urgency/
- due の係数は、期限の 14 日以上前に 0.2、そこから 7 日超過まで線形に上がり、7 日以上超過で 1.0。https://raw.githubusercontent.com/GothenburgBitFactory/taskwarrior/develop/src/Task.cpp
  - priority H を 12 にすると、重要で緊急は約 19〜21、重要だけは 12、緊急だけ（期限まで 3 日から当日）は 7.4〜8.8 になる。
  - ただし、重要でないタスクも 7 日以上超過すると 12 になり、重要だけのタスクと並ぶ。
  - この計算はソースからの算術で、公式の文書ではない。2026-10-22 に試し用のデータベースで、21.6、13、9.6、1 の順になることを確認した。

## 受信箱、見直し、続けられるかどうか

- Todoist は週次の見直しを GTD の中核とし、繰り返しタスクとして予約することを勧める。https://www.todoist.com/ja/productivity-methods/weekly-review
- 見直しの習慣がタスク管理を続けられるかを決める、という測定は見つからなかった。健康アプリの scoping review（18 件）では、中央値で 70% が 100 日以内に使用をやめた。https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11694054/

## 見積もり

- Buehler, Griffin & Ross 1994 では、卒業論文の完了日の予測が平均 33.9 日、実際は 55.5 日で、予測日までに終えたのは約 30%。https://bear.warrington.ufl.edu/brenner/mar7588/Papers/buehler-et-al-1994.pdf
- 個人の日常のタスクに見積もりを付けることを勧める資料は見つからなかった。Taskwarrior では見積もりは UDA で、組み込みの挙動は無い。

## 日付

- Things は、着手日（start date）と締め切り（deadline）を分ける。https://culturedcode.com/things/support/articles/2803579/
- Todoist は、外部への影響があるものにだけ deadline を使う。https://www.todoist.com/help/todoist/features/introduction-to-deadlines-in-todoist-uMqbSLM6U
- Linenberger は、ほとんどのタスクに締め切りは無く、作った期限は無視されるようになると書く。https://www.michaellinenberger.com/blog/most-tasks-do-not-have-deadlines-excerpt-from-new-third-edition-of-outlook-book/
- 反対に、動機付けのために期限を作る手法を勧める一般向けの記事もある。
- Taskwarrior では due が urgency に係数 12 で効くので、本当の締め切りでない due を付けると並び順が歪む。
