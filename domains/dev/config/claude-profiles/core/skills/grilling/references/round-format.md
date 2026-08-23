# ラウンド文書の形式

grilling が各ラウンドで書き出す `.claude/.cache/grilling/<slug>/round-<n>.md` の仕様。

**この形式のフェンス付き YAML ブロックが、将来のローカルレビュー CLI／描画面が読む
機械可読な正本である。** 散文（`### ❓ Q[n]` ブロック）は人間が読む面で、
YAML ブロックは機械が読む面。**両者は常に同じ内容でなければならない。**
片方だけを直さない。散文を書き換えたら同じラウンドの YAML も直す。

## 全体構造

1. frontmatter
2. `## 設計ツリー` — ```tree フェンス（YAML）
3. 問いごとに `### ❓ Q[n]` の散文ブロック + ```question フェンス（YAML）
4. 各問いの直後に `answer:` 行

## 1. frontmatter

```yaml
---
slug: <対象から作った英小文字ケバブケース>
round: <整数。1 始まり>
target: <対象の1行説明。ファイルが対象ならパス>
status: open | answered   # このラウンドの全問に回答が付いたら answered
---
```

## 2. 設計ツリー

```tree フェンスの中身は YAML。ノードは `id` / `label` / `state` / `children`。
`state` は `decided` | `open` | `asked` のいずれか。

- `decided` — 回答済み。`decision` に決まったことを1行で書く。
- `asked` — このラウンドで質問中。回答待ち。
- `open` — 未着手。前提がすべて `decided` の `open` ノードが frontier。

## 3. 問い

散文ブロックは SKILL.md §6 と同じ形式。直後に ```question フェンスを置く。

```yaml
id: q1                      # 散文の Q 番号と一致させる
options:
  - key: A
    label: <選択肢>
    gains: <得るもの>
    loses: <失うもの>
recommended: A              # options の key のいずれか
prioritized_tradeoff: <推奨で重視したトレードオフ。1行>
sources:
  - kind: url               # url | path
    ref: https://...        # kind: path なら path:line
```

## 4. 回答

回答を得たら、その問いの ```question フェンスの直後に1行で追記する。

```
answer: A — <ユーザーの言葉。選択肢外の自由回答ならその内容をそのまま>
```

回答が付いたら設計ツリーの該当ノードを `decided` にし、frontmatter の
`status` を更新する。新しく生まれた未決事項は次ラウンドの木に `open` で足す。

---

## 記入例（round-2.md）

```markdown
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
      children:
        - id: n4
          label: リフレッシュトークンの失効伝播
          state: open
    - id: n3
      label: 複数タブ間の同期
      state: asked
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
sources:
  - kind: path
    ref: src/auth/store.ts:88
```

answer: A — 即時同期。ただし BroadcastChannel 非対応環境は B にフォールバック
```
