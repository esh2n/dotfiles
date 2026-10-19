---
id: "08"
category: ja-chat
reader: この質問を初めて見る持ち主
task: 日本語の文章 skill をどう作るかについて、もう一度判断を求める返答を書く。背景・選択肢・推奨を含め、この返答だけで答えられるようにする。
traps: [家, 腕, レーン]
must_keep: [skill, lint, diff]
---

## 事実

1. 選択肢は 3 つ: (A) yomiyasu をそのまま入れる、(B) natural-japanese だけを使う、(C) natural-japanese の上に薄い自前の skill を載せ、yomiyasu からは比喩の語の一覧だけを取り込む。
2. 見本の比喩の段落（5 か所）に対し、yomiyasu の lint は 3 か所を拾い、「潰していく」と「重心を移す」を拾わなかった。
3. yomiyasu の diff は、書き直しに足された「一つずつ」を元にない語として出さなかった。
4. yomiyasu の SKILL.md は 111 KB あり、名前を出して頼まれたときだけ動く。
5. natural-japanese の lint は、内輪の呼び名を含む見本の返答と比喩の段落の両方で 0 件だった。
6. natural-japanese の上流 v1.6.0 は、段落ごとの確かめと newfacts.py（直した文書にだけある数値や固有名詞を出す）を持つ。
7. 推奨は C。
