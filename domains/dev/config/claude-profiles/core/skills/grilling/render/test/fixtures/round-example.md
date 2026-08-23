---
slug: session-token-storage
round: 2
target: spec/requirements.md のセッション保持要件
status: answered
---

## 設計ツリー

```tree
- id: root
  label: セッショントークンの保持方式
  state: open
  children:
    - id: n1
      label: 保存先（Cookie / localStorage）
      state: decided
      decision: httpOnly Cookie に保存する
    - id: n2
      label: 有効期限とリフレッシュ戦略
      state: asked
      asks: q3
      children:
        - id: n4
          label: リフレッシュトークンの失効伝播
          state: open
    - id: n3
      label: 複数タブ間の同期
      state: asked
      asks: q4
```

### ❓ Q3: アクセストークンの有効期限をどれくらいにしますか
**なぜ今この判断か** — 保存先が httpOnly Cookie に決まったので、失効時の再取得経路が期限の長さで変わる。
**抽象** — 漏洩時の被害時間と、リフレッシュ通信の頻度のどちらを削るか／ **具体** — 現状は無期限 `src/auth/session.ts:42`
- **A** — 15分 + リフレッシュトークン — 漏洩時の被害窓が短い／リフレッシュ経路の実装とテストが増える
- **B** — 24時間・リフレッシュなし — 実装が最小／漏洩時に丸1日有効なトークンが残る
**推奨: A** — 重視したトレードオフ: 実装コストより漏洩時の被害時間を削る。根拠: OWASP Session Management Cheat Sheet

```question
id: q3
options:
  - key: A
    label: 15分 + リフレッシュトークン
    gains: 漏洩時の被害窓が短い
    loses: リフレッシュ経路の実装とテストが増える
  - key: B
    label: 24時間・リフレッシュなし
    gains: 実装が最小
    loses: 漏洩時に丸1日有効なトークンが残る
recommended: A
prioritized_tradeoff: 実装コストより漏洩時の被害時間を削る
rationale: |
  いま漏洩の窓を決めているのは期限だけで、他に短くする手段が無い。
  B の「実装が最小」という利点は、リフレッシュ経路が既に `/auth/refresh` にある以上ほとんど効かない。
  往復が増える分の遅延は、失効時の 1 回だけなので体感に出ない。
  条件つき: 端末を跨がない社内専用の面になったら B に戻してよい。
sources:
  - kind: url
    ref: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  - kind: path
    ref: src/auth/session.ts:42
```

answer: A — 15分で。リフレッシュは既存の `/auth/refresh` を使い回す

### ❓ Q4: 複数タブでログアウトしたとき、他タブをどう扱いますか
**なぜ今この判断か** — Cookie 方式では他タブの状態が自動では変わらず、失効済みトークンで操作を続けられる。
**抽象** — 即時性と実装の複雑さのどちらを取るか／ **具体** — 現状はタブごとに独立 `src/auth/store.ts:88`
- **A** — BroadcastChannel で即時同期 — 他タブが即ログアウト／対応ブラウザ前提と受信側の実装が要る
- **B** — 次の API 呼び出しの 401 で気付く — 追加実装ゼロ／失効から検知まで操作が通る見た目が残る
**推奨: A** — 重視したトレードオフ: 実装量より、ログアウトしたつもりで残るタブを無くす。根拠: `src/auth/store.ts:88`

```question
id: q4
options:
  - key: A
    label: BroadcastChannel で即時同期
    gains: 他タブが即ログアウトする
    loses: 対応ブラウザ前提と受信側の実装が要る
  - key: B
    label: 次の API 呼び出しの 401 で気付く
    gains: 追加実装がゼロ
    loses: 失効から検知まで操作が通る見た目が残る
recommended: A
prioritized_tradeoff: 実装量より、ログアウトしたつもりで残るタブを無くす
rationale: |
  ログアウトしたつもりのタブが操作を受け付ける状態は、事故そのものより説明が難しい。
  B の「追加実装ゼロ」は、次の API 呼び出しまで気付かないという穴とセットで、
  その穴が開いている時間はユーザーの操作次第で長くなる。
  非対応ブラウザには B が自然なフォールバックとして残るので、A を選んでも退路はある。
sources:
  - kind: path
    ref: src/auth/store.ts:88
```

answer: A — 即時同期。ただし BroadcastChannel 非対応環境は B にフォールバック
