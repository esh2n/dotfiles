---
slug: kit-demo
round: 1
target: grilling のラウンド HTML を writeup-kit に乗せ換える
status: open
---

## 前提

grilling は今までラウンドを自前の HTML 意匠で描いていた。writeup-kit という
共有の文書デザインが別 skill として存在するので、そちらに乗せ換えて意匠を
一本化する。

```premise
task: ラウンドの HTML 意匠を writeup-kit に寄せる
decided: 図の IR（id/title/groups/nodes/edges）は grilling と kit で共通
why_now: 意匠が 2 つあると、直す場所も 2 つになる
unblocks: 決定記録も同じ kit の page として保存できるようになる
```

## 設計ツリー

```tree
- id: root
  label: HTML 出力の意匠
  state: open
  children:
    - id: n1
      label: 図の描画エンジン
      state: asked
      asks: q1
    - id: n2
      label: ページ chrome
      state: asked
      asks: q2
```

### ❓ Q1: 図は誰が描きますか
**なぜ今この判断か** — kit にも grilling にも elkjs ベースの図レンダラーがあり、どちらを正本にするかで検証の一本化が決まる。
**抽象** — 検証基準を 1 つに保つか、grilling 単体で完結させるか／ **具体** — 現状は grilling 自前の `lib/diagram.mjs` だけが図を描く

kit が無いときと有るときで、描画の道筋が変わる。

#### kit がある場合
kit の `renderFigureHtmlChecked` に IR をそのまま渡し、20 項目の検証（幾何・a11y・budget）に通れば埋め込む。通らなければ grilling 自前のレンダラーに切り替え、失敗理由を注記する。

#### 比較

| 案 | 検証基準 | 失敗時の挙動 |
| --- | --- | --- |
| A | kit の 20 項目 | grilling 自前へフォールバック |
| B | grilling 自前のみ | フォールバック無し |

```diagram
id: d1
title: 図の描画経路
caption: kit があれば kit の検証つきレンダラーを使い、無ければ grilling 自前に落ちる。
groups:
  - id: kit
    label: writeup-kit
    tone: ts
  - id: grilling
    label: grilling
    tone: rs
nodes:
  - id: ir
    label: 図の IR
    group: grilling
  - id: kitrender
    label: kit のレンダラー
    group: kit
    tone: ts
    emphasis: true
  - id: fallback
    label: grilling 自前
    group: grilling
    tone: rs
edges:
  - from: ir
    to: kitrender
    label: 渡す
    kind: sync
  - from: kitrender
    to: fallback
    label: 検証失敗
    kind: async
```

```question
id: q1
options:
  - key: A
    label: kit の renderFigureHtmlChecked を正本にする
    gains: 検証基準が 1 つになり、writeup 全体と揃う
    loses: kit が無い環境向けのフォールバックが要る
  - key: B
    label: grilling 自前のレンダラーのままにする
    gains: 依存が増えない
    loses: 検証基準が writeup と grilling で 2 つに割れる
recommended: A
prioritized_tradeoff: 検証基準を割らないことを、フォールバック実装の手間より優先する
rationale: |
  grilling の diagram.mjs は kit の diagram.mjs の母体そのものなので、IR はほぼ素通しできる。
  B は今は動くが、kit 側の検証基準が増えるたびに grilling 側で追随できなくなる。
sources:
  - kind: path
    ref: render/lib/kit.mjs:1
```

### ❓ Q2: ページの chrome（見出し・進捗）はどちらに寄せますか
**なぜ今この判断か** — chrome を変えると、既存の回答フォーム（ラジオ・textarea）の CSS 変数も一緒に見直す必要がある。
**抽象** — 意匠を統一する範囲を chrome まで広げるか、回答フォームは温存するか／ **具体** — 現状は grilling 独自の `.eyebrow` / `.panel` / `.opt` を使っている

```question
id: q2
options:
  - key: A
    label: chrome は kit の wu-header/wu-footer に寄せ、回答フォームは grilling 独自のまま残す
    gains: kit に無い制御（フォーム・設計ツリー）だけ小さく足せばよい
    loses: 2 つの意匠が同じページに同居する
  - key: B
    label: chrome も回答フォームも grilling 独自のまま
    gains: 変更が小さい
    loses: kit と意匠が揃わない
recommended: A
prioritized_tradeoff: kit との統一を、独自 CSS を温存する楽さより優先する
rationale: |
  回答フォームは kit に対応する語彙が無いので、無理に kit のクラスへ寄せると意味が崩れる。
  chrome だけ揃えれば、他の writeup ページと並べたときの見た目の統一は十分に得られる。
sources:
  - kind: path
    ref: render/lib/html.mjs:1
```

answer: A — 検証基準を割りたくない
