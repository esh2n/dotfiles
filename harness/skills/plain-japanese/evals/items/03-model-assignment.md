---
id: "03"
category: ja-doc
reader: エージェント定義を書く開発者
task: エージェントのモデルの書き方と作業ごとの割り当てを説明するガイド（800〜1,100 字）を書く。表を使ってよい。
traps: [強い格, 部下, 窓]
must_keep: [tier, effort, LiteLLM]
---

## 事実

1. エージェント定義のモデルは tier 名（main・complex・executor）で書くか、書かない。書かなければ親と同じモデルと effort を使う。
2. tier から各ハーネスの具体的なモデル名への変換は agents/models.json の 1 か所だけで行う。
3. 表に無い tier 名や effort の言葉はエラーにする。
4. 設計・計画は complex で effort xhigh。難しいデバッグとセキュリティレビューは complex で high。
5. 一般・言語別のレビューは main で high。探索は main で medium。題名とコミット文は main で low。
6. executor は、計画が細部まで決まっている・成否を機械で確かめられる・速さより外に出さないことを優先する、の 3 条件を満たすときだけ使う。
7. effort は low・medium・high・xhigh・max の 5 段階。max は既定にしない。
8. モデルに無い段階はすぐ下の段階に下げ、記録する（DeepSeek の xhigh は high になる）。
9. 使えないときは同じモデルの別の置き場所までにし、別のモデルへは自動で切り替えない。
