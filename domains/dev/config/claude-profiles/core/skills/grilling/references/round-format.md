# ラウンド文書の形式

grilling が各ラウンドで書き出す `.claude/.cache/grilling/<slug>/round-<n>.md` の仕様。

**この形式のフェンス付き YAML ブロックが、ローカルの描画面（`../render/render.mjs`）が
読む機械可読な正本である。** 散文（`### ❓ Q[n]` ブロック）は人間が読む面で、
YAML ブロックは機械が読む面。**両者は常に同じ内容でなければならない。**
片方だけを直さない。散文を書き換えたら同じラウンドの YAML も直す。

## 全体構造

1. frontmatter
2. `## 前提`（任意） — 散文 + ```premise フェンス（YAML）
3. `## 設計ツリー` — ```tree フェンス（YAML）
4. 問いごとに `### ❓ Q[n]` の散文ブロック
   → ```diagram フェンス 0 個以上 → ```question フェンス（YAML）
5. 各問いの直後に `answer:` 行

`diagram` は必ず散文と `question` フェンスの**あいだ**に置く。順番が違うと
レンダラーがスキーマ違反として弾く。

## 1. frontmatter

```yaml
---
slug: <対象から作った英小文字ケバブケース>
round: <整数。1 始まり>
target: <対象の1行説明。ファイルが対象ならパス>
status: open | answered   # このラウンドの全問に回答が付いたら answered
---
```

## 2. 前提（任意、ラウンドに 1 つ）

そのラウンドを読む人が最初に要る文脈。散文の**最初の段落**がページのリード文に、
```premise フェンスが前提パネルの定義リストになる。

```yaml
task: <この作業は何か。1〜2行>
decided: <すでに決まっていること>
why_now: <なぜ今この判断が要るのか>
unblocks: <これが決まると何が始まるか>
```

4 つのキーはすべて任意だが、**それ以外のキーは書けない**（スキーマ違反になる）。

## 3. 設計ツリー

```tree フェンスの中身は YAML。ノードは `id` / `label` / `state` / `children`。
`state` は `decided` | `open` | `asked` のいずれか。

- `decided` — 回答済み。`decision` に決まったことを1行で書く。
- `asked` — このラウンドで質問中。回答待ち。`asks: q1` を書くと、描画面で
  そのノードのラベルがその問い（`#q1`）へのリンクになる。任意。
- `open` — 未着手。前提がすべて `decided` の `open` ノードが frontier。

```yaml
- id: n2
  label: 有効期限とリフレッシュ戦略
  state: asked
  asks: q3          # 任意。この節点で聞いている問いの id
  children: []
```

ページのヘッダの進捗行（決定済み x / 回答待ち y / 未着手 z）はこの木から数える。
木は**入れ子リスト**として描かれる（横に伸びる図にすると読めなくなるため）。

## 4. 問い

散文ブロックは SKILL.md §7 と同じ形式。直後に ```question フェンスを置く。

「なぜ今この判断か」「抽象／具体」の行の後、選択肢の箇条書きの前に置いた行は**解説**として
ページに描画される。使える記法は 段落 / `- ` 箇条書き / `####` 小見出し / GFM 表 /
`**太字**` / `` `code` `` / リンク。読み物にせず、小見出しで塊を分け、比較は表にする。

```yaml
id: q1                      # 散文の Q 番号と一致させる
options:
  - key: A
    label: <選択肢>
    gains: <得るもの>
    loses: <失うもの>
recommended: A              # options の key のいずれか
prioritized_tradeoff: <推奨で重視したトレードオフ。1行>
rationale: |                # 必須。推奨の論証。2〜4文
  <いま一番多く変わるのは何か>
  <他案の利点がなぜ今は要らないのか>
  <条件つきなら、どうなったら推奨がひっくり返るか>
sources:
  - kind: url               # url | path
    ref: https://...        # kind: path なら path:line
```

`prioritized_tradeoff` は**見出し**（1行）、`rationale` は**本文**（複数段落可、
行内マークダウンの最小サブセットが使える）。選択肢の label / gains / loses を
言い直すだけの rationale は書かない——**選択肢の表を読めば分かることは書かない**。

## 5. 図（任意、問いごとに 0 個以上）

**構造を比べる問いには図を描く。** どの部品がどこに載るか、どの経路が変わるか——
言葉より絵のほうが速い問いは描く。逆に**一文で言えるならその一文を書く**。

```yaml
id: d1                       # 必須。その問いの中で一意
title: 現在地                # 必須。図の名前
caption: <この絵が主張することを一文で>   # 任意。figcaption と aria-label
direction: right             # 任意。書かなければ列幅に収まる向きをレンダラーが選ぶ
groups:                      # 任意。ノードを囲む枠
  - id: browser
    label: ブラウザ
    tone: ts                 # ts | rs | new | neutral
nodes:                       # 必須。1 個以上
  - id: spa
    label: SPA
    group: browser           # 任意。groups の id
    tone: ts                 # 任意。既定は neutral
    dashed: true             # 任意。まだ無いもの・将来のもの
    emphasis: true           # 任意。太枠＋太字。図に 1〜2 個まで
edges:                       # 任意
  - from: spa
    to: sdk
    label: 呼ぶ              # 任意
    kind: sync               # 必須。sync | async | reply
```

- `kind` — `sync` は実線＋塗りつぶし矢尻（同期の呼び出し）、`async` は実線＋
  開いた矢尻（非同期・生成）、`reply` は破線＋開いた矢尻（応答・戻り）。
- 凡例は**実際に使われた種類だけ**が sync → async → reply の順で自動で付く。
  辺が無い図には凡例も付かない。
- `tone` はページの配色トークンにそのまま対応する。既存／新規／別言語側といった
  「どちら側の話か」を色で分けるために使い、装飾のために使わない。
- `direction` は**書かないほうがよい**。書かなければ、レンダラーが横向き・縦向きの
  両方を試して本文の列（720px）に収まるほうを選び、必要なら 0.78 倍までは縮める。
  明示するとその向きに固定され、収まらなければ横スクロールになる。
- `label` / `caption` / `title` に `: `（コロン + 空白）を含めるときは**必ず引用符で
  囲む**（例: `label: "A: push"`）。裸で書くと YAML が入れ子のマッピングと解釈し、
  レンダラーが `YAML として読めません` のスキーマ違反で止まる。選択肢を辺のラベルで
  区別する `A: …` / `B: …` の書き方は便利なぶん、この罠に毎回かかる。

## 6. 回答

回答を得たら、その問いの ```question フェンスの直後に1行で追記する。

```
answer: A — <ユーザーの言葉。選択肢外の自由回答ならその内容をそのまま>
```

回答が付いたら設計ツリーの該当ノードを `decided` にし、frontmatter の
`status` を更新する。新しく生まれた未決事項は次ラウンドの木に `open` で足す。

---

## 記入例（round-2.md）

````markdown
---
slug: session-token-storage
round: 2
target: spec/requirements.md のセッション保持要件
status: answered
---

## 前提

セッションの保存先は httpOnly Cookie に決まった。残るのは期限とタブ間の扱いで、
どちらもクライアント側の実装量と、失効の見落としのトレードオフになる。

```premise
task: セッション保持の期限・更新・タブ間同期を決める
decided: 保存先は httpOnly Cookie
why_now: 期限が決まらないとリフレッシュ経路も 401 の扱いも書けない
unblocks: /auth/refresh の契約 → タブ間同期の実装 → E2E のシナリオ
```

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

```diagram
id: d1
title: 失効したときに何が起きるか
caption: A では SDK が 401 を受けて更新するので往復が 1 回増える。B では失効まで誰も気付かない。
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
  - id: api
    label: API
    group: server
    tone: rs
  - id: refresh
    label: /auth/refresh
    group: server
    tone: new
    dashed: true
edges:
  - from: spa
    to: sdk
    label: 呼ぶ
    kind: sync
  - from: sdk
    to: api
    label: リクエスト
    kind: sync
  - from: api
    to: sdk
    label: 401
    kind: reply
  - from: sdk
    to: refresh
    label: 再取得
    kind: async
```

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
  往復が増える分の遅延は失効時の 1 回だけなので体感に出ない。
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
````

## 描画

```sh
# ローカルで回答まで集める（既定）。全問の提出まで戻らない
node <skill>/render/render.mjs serve .claude/.cache/grilling/<slug>/round-<n>.md

# Artifact に出す fragment を書き出す
node <skill>/render/render.mjs .claude/.cache/grilling/<slug>/round-<n>.md \
  --fragment -o "$SCRATCHPAD/round-<n>.html"
```

スキーマ違反は終了コード 2 で、どのブロックのどのフィールドかを出す。
詳細は [`../render/README.md`](../render/README.md)。
