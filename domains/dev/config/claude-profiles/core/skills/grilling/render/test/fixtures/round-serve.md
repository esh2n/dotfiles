---
slug: serve-fixture
round: 1
target: serve モードのテスト用ラウンド
status: open
---

## 前提

serve モードのテストのためだけのラウンド。図は置かない（描画を速く保つため）。

```premise
task: serve モードの回答回収を検証する
why_now: 回答が jsonl に落ちることを確かめたい
```

## 設計ツリー

```tree
- id: root
  label: serve モードの検証
  state: open
  children:
    - id: n1
      label: 回答の追記先
      state: asked
      asks: q1
    - id: n2
      label: 再提出の扱い
      state: asked
      asks: q2
```

### ❓ Q1: 回答をどこに追記しますか
**なぜ今この判断か** — 置き場所が決まらないと回収の手順が書けない。
**抽象** — 追記先の形式／ **具体** — `render.mjs:1`
- **A** — jsonl に 1 行ずつ — 追記だけで済む／読むときに畳む処理が要る
- **B** — json を毎回書き直す — 読むのが楽／途中で壊れると全部失う
**推奨: A** — 重視したトレードオフ: 読む手間より書き込みの安全。根拠: `render.mjs:1`

```question
id: q1
options:
  - key: A
    label: jsonl に 1 行ずつ
    gains: 追記だけで済む
    loses: 読むときに畳む処理が要る
  - key: B
    label: json を毎回書き直す
    gains: 読むのが楽
    loses: 途中で壊れると全部失う
recommended: A
prioritized_tradeoff: 読む手間より書き込みの安全
rationale: |
  追記は途中で落ちても既に書いた行が残る。
  B の「読むのが楽」は畳む処理を 1 回書けば消える利点でしかない。
sources:
  - kind: path
    ref: render.mjs:1
```

### ❓ Q2: 再提出をどう扱いますか
**なぜ今この判断か** — 同じ問いに 2 回答えられる以上、どちらを採るか決めないと要約が定まらない。
**抽象** — 上書きか追記か／ **具体** — `lib/serve.mjs:1`
- **A** — 最後の 1 行が勝つ — 履歴が残る／読む側が畳む必要がある
- **B** — 2 回目を拒否する — 実装が単純／打ち間違いを直せない
**推奨: A** — 重視したトレードオフ: 実装の単純さより訂正できること。根拠: `lib/serve.mjs:1`

```question
id: q2
options:
  - key: A
    label: 最後の 1 行が勝つ
    gains: 履歴が残る
    loses: 読む側が畳む必要がある
  - key: B
    label: 2 回目を拒否する
    gains: 実装が単純
    loses: 打ち間違いを直せない
recommended: A
prioritized_tradeoff: 実装の単純さより訂正できること
rationale: |
  打ち間違いを直せない回答フォームは、回答そのものの質を落とす。
  畳む処理は要約を出す 1 箇所にしか要らない。
sources:
  - kind: path
    ref: lib/serve.mjs:1
```
