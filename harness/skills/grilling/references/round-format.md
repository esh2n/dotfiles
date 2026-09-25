# Round document format

Specification of the `.claude/.cache/grilling/<slug>/round-<n>.md` that grilling writes out each round.
Round documents are owner-facing: prose, labels and option text are written in Japanese; this file describes the structure.

**The fenced YAML blocks in this format are the machine-readable source of truth read by the
local renderer (`$DOTFILES_ROOT/domains/dev/llm/tools/grilling-render/render.mjs`).**
The prose (`### ❓ Q[n]` blocks) is the human-facing side; the YAML blocks are the
machine-facing side. **Both must always carry the same content.** Never fix only one.
If you rewrite the prose, fix the same round's YAML too.

## Overall structure

1. frontmatter
2. `## 前提` (optional) — prose + a ```premise fence (YAML)
3. `## 設計ツリー` — a ```tree fence (YAML)
4. Per question, a `### ❓ Q[n]` prose block
   → zero or more ```diagram fences → a ```question fence (YAML)
5. An `answer:` line right after each question

A `diagram` always goes **between** the prose and the `question` fence. Any other
order is rejected by the renderer as a schema violation.

## 1. frontmatter

```yaml
---
slug: <lowercase kebab-case derived from the target>
round: <integer, starting at 1>
target: <one-line description of the target; the path if it is a file>
status: open | answered   # answered once every question in this round has an answer
---
```

## 2. Premise (optional, one per round)

The context a reader of this round needs first. The **first paragraph** of prose becomes
the page's lead; the ```premise fence becomes the premise panel's definition list.

```yaml
task: <what this work is, 1–2 lines>
decided: <what is already decided>
why_now: <why this decision is needed now>
unblocks: <what starts once this is decided>
```

All four keys are optional, but **no other key is allowed** (schema violation).

## 3. Design tree

The ```tree fence holds YAML. Nodes have `id` / `label` / `state` / `children`.
`state` is one of `decided` | `open` | `asked`.

- `decided` — answered. Write the decision in one line under `decision`.
- `asked` — being asked in this round; awaiting an answer. Writing `asks: q1` makes the
  renderer link that node's label to the question (`#q1`). Optional.
- `open` — not started. `open` nodes whose prerequisites are all `decided` form the frontier.

```yaml
- id: n2
  label: 有効期限とリフレッシュ戦略
  state: asked
  asks: q3          # optional; id of the question asked at this node
  children: []
```

The page header's progress line (決定済み x / 回答待ち y / 未着手 z) is counted from this tree.
The tree is drawn as a **nested list** (a sideways-growing figure becomes unreadable).

## 4. Questions

The prose block uses the same format as SKILL.md §7. Place a ```question fence right after it.

Lines placed after the "なぜ今この判断か" and "抽象／具体" lines and before the option bullets
render on the page as **explanation**. Allowed syntax: paragraphs / `- ` bullets / `####`
subheadings / GFM tables / `**bold**` / `` `code` `` / links. Not reading material:
split blocks with subheadings and put comparisons in tables.

```yaml
id: q1                      # must match the prose Q number
options:
  - key: A
    label: <option>
    gains: <what it gains>
    loses: <what it loses>
recommended: A              # one of the option keys
prioritized_tradeoff: <the trade-off prioritized in the recommendation, one line>
rationale: |                # required; the argument for the recommendation, 2–4 sentences
  <what changes the most right now>
  <why the other options' advantages are not needed now>
  <if conditional, what would flip the recommendation>
sources:
  - kind: url               # url | path
    ref: https://...        # for kind: path, path:line
```

`prioritized_tradeoff` is the **heading** (one line); `rationale` is the **body** (several
paragraphs allowed, with a minimal subset of inline Markdown). Do not write a rationale that
merely restates the options' label / gains / loses — **never write what the options table already shows**.

## 5. Diagrams (optional, zero or more per question)

**Draw a diagram for questions that compare structure.** Which component sits where, which
route changes — where a picture is faster than words, draw it. Conversely, **if one sentence
says it, write that sentence.**

```yaml
id: d1                       # required; unique within the question
title: 現在地                # required; the figure's name
caption: <one sentence stating what this picture claims>   # optional; figcaption and aria-label
direction: right             # optional; omitted, the renderer picks the orientation that fits the column
groups:                      # optional; frames around nodes
  - id: browser
    label: ブラウザ
    tone: ts                 # ts | rs | new | neutral
nodes:                       # required; one or more
  - id: spa
    label: SPA
    group: browser           # optional; a groups id
    tone: ts                 # optional; default neutral
    dashed: true             # optional; something not yet existing / future
    emphasis: true           # optional; bold frame + bold text; 1–2 per figure at most
edges:                       # optional
  - from: spa
    to: sdk
    label: 呼ぶ              # optional
    kind: sync               # required; sync | async | reply
```

- `kind` — `sync` is a solid line with a filled arrowhead (synchronous call), `async` a solid
  line with an open arrowhead (asynchronous / spawn), `reply` a dashed line with an open arrowhead (response / return).
- The legend lists **only the kinds actually used**, automatically, in the order sync → async → reply.
  A figure with no edges gets no legend.
- `tone` maps directly to the page's color tokens. Use it to separate "which side this is"
  — existing / new / the other-language side — never for decoration.
- `direction` is **better left out**. Omitted, the renderer tries both horizontal and vertical,
  picks the one that fits the body column (720px), and shrinks down to 0.78x if needed.
  Set explicitly, the orientation is fixed and overflows into horizontal scrolling if it does not fit.
- When `label` / `caption` / `title` contain `: ` (colon + space), **always quote them**
  (e.g. `label: "A: push"`). Written bare, YAML reads it as a nested mapping and the renderer
  stops with a `YAML として読めません` schema violation. Distinguishing options by edge labels
  as `A: …` / `B: …` is handy and falls into this trap every time.

## 6. Answers

Once an answer is in, append one line right after that question's ```question fence.

```
answer: A — <the user's words; a free-text answer outside the options, verbatim>
```

When an answer is attached, set the design tree's node to `decided` and update the frontmatter
`status`. Add newly created open items to the next round's tree as `open`.

---

## Example (round-2.md)

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

## Rendering

```sh
# Collect answers locally (default). Does not return until every question is submitted
node "${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/grilling-render/render.mjs" serve .claude/.cache/grilling/<slug>/round-<n>.md

# Write out a fragment for the Artifact tool
node "${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/grilling-render/render.mjs" .claude/.cache/grilling/<slug>/round-<n>.md \
  --fragment -o "$SCRATCHPAD/round-<n>.html"
```

A schema violation exits with code 2 and names the block and field.

The page design is chosen automatically by `$DOTFILES_ROOT/domains/dev/llm/tools/grilling-render/lib/kit.mjs`. When writeup-kit
(`$DOTFILES_ROOT/domains/dev/llm/tools/writeup-kit`) exists, it rides on that kit's
chrome, components and diagram checks; otherwise it falls back to grilling's own
design as before. The format itself (frontmatter / premise / design tree / questions /
diagrams) is the same under either design. Details: `$DOTFILES_ROOT/domains/dev/llm/tools/grilling-render/README.md`.
