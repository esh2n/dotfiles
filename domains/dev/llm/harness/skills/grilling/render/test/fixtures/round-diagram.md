---
slug: token-refresh-path
round: 1
target: トークン更新の経路をどこに置くか
status: open
---

## 前提

セッションの保存先は httpOnly Cookie に決まっている。残るのは更新（リフレッシュ）を
**誰が起こすか**で、ここが決まらないと BFF の責務も SDK の API も書き始められない。

```premise
task: リフレッシュの起点をブラウザに置くか BFF に置くかを決める
decided: 保存先は httpOnly Cookie。SDK は TypeScript で書く
why_now: 起点が決まらないと BFF のルート設計も SDK の公開 API も動かせない
unblocks: BFF のルート設計 → SDK の公開 API → 失効伝播の設計
```

## 設計ツリー

```tree
- id: root
  label: トークン更新の経路
  state: open
  children:
    - id: n1
      label: 保存先
      state: decided
      decision: httpOnly Cookie
    - id: n2
      label: リフレッシュの起点
      state: asked
      asks: q1
    - id: n3
      label: 失効の伝播
      state: open
```

### ❓ Q1: リフレッシュをブラウザから起こしますか、BFF に任せますか
**なぜ今この判断か** — Cookie が httpOnly なので、ブラウザ側は残り時間を読めない。起点をどちらに置くかで BFF の責務が変わる。
**抽象** — 経路の単純さと、BFF の状態保持のどちらを取るか／ **具体** — 現状の更新は無し `src/auth/session.ts:42`

```diagram
id: d1
title: 現在地
caption: いまはブラウザが API を直接叩いており、更新の主体がどこにも無い。
groups:
  - id: browser
    label: ブラウザ
    tone: ts
  - id: server
    label: サーバ
    tone: rs
nodes:
  - id: spa
    label: SPA
    group: browser
    tone: ts
  - id: sdk
    label: 認証 SDK
    group: browser
    tone: ts
    emphasis: true
  - id: bff
    label: BFF
    group: server
    tone: rs
  - id: idp
    label: IdP
    group: server
  - id: future
    label: 将来の更新ワーカー
    group: server
    tone: new
    dashed: true
edges:
  - from: spa
    to: sdk
    label: 呼ぶ
    kind: sync
  - from: sdk
    to: bff
    label: API 呼び出し
    kind: sync
  - from: bff
    to: idp
    label: 検証
    kind: sync
  - from: bff
    to: sdk
    label: 401 を返す
    kind: reply
  - from: bff
    to: future
    label: 期限切れ通知
    kind: async
```

```diagram
id: d2
title: 置き場所の候補
caption: 契約の型は Rust 側にしか無く、TS 側には契約パッケージが無い。
groups:
  - id: ts
    label: TypeScript（pnpm workspace）
    tone: ts
  - id: rs
    label: Rust（cargo workspace）
    tone: rs
nodes:
  - id: tokens
    label: packages/tokens
    group: ts
  - id: ui
    label: packages/ui
    group: ts
  - id: viewer
    label: apps/viewer
    group: ts
  - id: site
    label: apps/site
    group: ts
  - id: tscontract
    label: TS の契約パッケージ — 存在しない
    group: ts
    tone: ts
    dashed: true
  - id: renderer
    label: "新規: レンダラー + CLI"
    group: ts
    tone: new
    emphasis: true
  - id: contracts
    label: crates/contracts
    group: rs
  - id: daemon
    label: crates/daemon
    group: rs
  - id: masterdata
    label: crates/master_data
    group: rs
  - id: ingest
    label: "将来: daemon が決定記録を取り込む"
    group: rs
    tone: new
    dashed: true
edges:
  - from: ui
    to: renderer
    label: 使う
    kind: sync
  - from: tokens
    to: contracts
    label: 生成
    kind: async
  - from: contracts
    to: daemon
    kind: sync
  - from: contracts
    to: masterdata
    kind: sync
```

```diagram
id: d3
title: 小さい図
caption: 4 ノードなら列幅に収まるので縮小されない。
nodes:
  - id: a
    label: A
  - id: b
    label: B
  - id: c
    label: C
  - id: d
    label: D
edges:
  - from: a
    to: b
    kind: sync
  - from: b
    to: c
    kind: sync
  - from: c
    to: d
    kind: sync
```

```question
id: q1
options:
  - key: A
    label: ブラウザ（SDK）が 401 を見て更新する
    gains: BFF は状態を持たずに済み、経路が 1 本で追いやすい
    loses: 401 の往復が 1 回増え、同時多発リクエストの重複更新を自前で抑える必要がある
  - key: B
    label: BFF が期限を見て透過的に更新する
    gains: ブラウザ側は更新を知らなくてよく、重複更新も 1 箇所で抑えられる
    loses: BFF がトークンの寿命という状態を持ち、水平展開時に共有ストアが要る
recommended: A
prioritized_tradeoff: BFF を状態レスに保つことを、往復 1 回のコストより優先する
rationale: |
  いま一番変わりやすいのは BFF のルート構成で、そこに寿命という状態を足すと
  水平展開のたびに共有ストアの話が付いてくる。
  B の「重複更新を 1 箇所で抑えられる」という利点は、同時リクエストが増えてから効くもので、
  いまの負荷では効かない。
  条件つき: 同時実行が問題になった時点で B へ移す。
sources:
  - kind: path
    ref: src/auth/session.ts:42
```
