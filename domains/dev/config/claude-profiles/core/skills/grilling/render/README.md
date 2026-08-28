# render — ラウンド文書を 1 ページの HTML にする

grilling が書いたラウンド文書（`round-<n>.md`）を読み、そのラウンドの問いを
すべて載せた 1 枚の HTML にする。外部アセットは Google Fonts のスタイルシートだけ。

**このディレクトリは grilling スキルの一部。生成物（HTML）は scratchpad に置き、
リポジトリには残さない。**

## ページ意匠 — writeup-kit があれば乗せ、無ければ自前

`lib/kit.mjs` が起動のたびに writeup-kit の在り処を解決する
（きょうだいディレクトリ `../writeup-kit` → `~/.claude/skills/writeup-kit` →
無し、の順）。

- **kit がある場合** — ページ chrome（`.wu-header`/`.wu-footer`）と本文の
  コンポーネント（`.wu-summary`/`.wu-terms`/`.wu-compare`/`.wu-decision`/
  `.wu-meta`/`.wu-table`/`.wu-code`/`.wu-steps`）に乗せる。回答フォーム・
  設計ツリーの入れ子・進捗行は kit に対応語彙が無いので、`lib/html.mjs` が
  足す小さな `<style data-grilling>` ブロック（kit の CSS 変数 `--wu-*` を
  使う）だけで賄う。図は kit の `bin/lib/verify-diagram.mjs`
  (`renderFigureHtmlChecked`) にそのまま渡し、幾何・a11y・budget の 20 項目
  検証に通れば `<figure class="wu-figure" data-checks="pass">` として埋め込む。
  通らなければその図だけ `lib/diagram.mjs`（自前の elkjs レンダラー）に
  フォールバックし、失敗理由の最初の hint を `.wu-callout` で注記する。
- **kit が無い場合** — これまでどおり `template/style.css` と
  `lib/diagram.mjs` だけで完結する（外部依存ゼロ）。
- `renderPage(round, { kitDir: null })` で kit 無し経路を強制できる
  （フォールバックのテスト用）。

図は elkjs でレイアウトしてインライン SVG に書き出す（kit ありなら kit 版、
無しなら grilling 自前版のどちらか一方）。

## 決定記録 → writeup ページ

`decision-page.mjs` は grilling の決定記録 Markdown（`## 決定記録` ブロック）を
writeup-kit の `kind: 決定記録` ページに変換する（writeup-kit 必須、
フォールバック無し）。

```sh
node decision-page.mjs <decisions.md> --out <page.html>
```

書き出した直後に writeup-kit の `bin/self-check.mjs --write-meta` を実行し、
結果をそのまま標準出力に出す。self-check の指摘は内容側の問題（長文・括弧の
重なりなど）であることが多く、`decision-page.mjs` 自身は本文を書き換えない。
store への配置・commit は writeup 側の保存手順に従う（`SKILL.md` §12）。

## 使い方

```sh
cd <skill>/render
pnpm install                      # 初回のみ（elkjs / yaml）

node render.mjs <round.md> [-o <out.html>] [--title "<見出し>"] [--fragment]
node render.mjs serve <round.md> [--out <answers.jsonl>] [--port <N>] [--no-open]
```

| オプション | 既定 | 意味 |
| --- | --- | --- |
| `-o`, `--out <path>` | `$GRILLING_OUT_DIR`／未設定なら入力と同じディレクトリ、名前は入力の拡張子違い | 出力先 |
| `--title <str>` | frontmatter の `target` | `<h1>` とタブの見出し |
| `--fragment` | off | `<title>` + フォント + `<style>` + `<main>` だけを出す |
| `-h`, `--help` | — | 使い方 |

成功すると出力先の絶対パスを標準出力に 1 行だけ出す。終了コードは
**0 = 成功 / 1 = 入力を読めない・引数が不正 / 2 = スキーマ違反**。
スキーマ違反はどのブロックのどのフィールドかを書く:

```
/path/round-1.md: スキーマ違反 [diagram d1 edges[0]] フィールド "to" が nodes に存在しません (実際: zzz)
```

### 完全な文書と fragment の使い分け

- **既定（完全な HTML 文書）** — `<!doctype html>` から始まる自己完結の 1 ファイル。
  ローカルでそのままブラウザに開ける。`serve` が配るのもこれ（+ serve 差し込み）。
- **`--fragment`** — Artifact ツールで公開するときはこちら。Artifact は渡した
  内容を `<!doctype html>…<head></head><body>` で包むので、`<html>` や `<body>`
  を自分で書いてはいけない、というのがツール側の約束。fragment はこの約束に
  合わせて `<title>` + フォントの `<link>` + `<style>` + `<main>` だけを出す。

## serve — ローカルで回答を集める

ブラウザのあるマシンなら、Artifact を経由せずここで完結する。

```sh
node render.mjs serve .claude/.cache/grilling/<slug>/round-<n>.md
```

ラウンドを**完全な HTML 文書**として `127.0.0.1` に配り、`open` でブラウザを開き、
**全問が提出されるまで戻らない**。答え終わるとプロセスが自分で終わる。

| オプション | 既定 | 意味 |
| --- | --- | --- |
| `--out <path>` | `<round.md と同じディレクトリ>/answers.jsonl` | 回答の追記先 |
| `--port <N>` | slug から決まる固定ポート（40000〜49999）。使用中なら空きポートへ退避 | 待ち受けポート。明示したときは退避しない |
| `--no-open` | off | ブラウザを自動で開かない（URL は標準エラーに出る） |

- **提出** — 各問の「提出」が `/answer` に
  `{round, slug, question, choice, note, ts}` を POST する。サーバは jsonl に
  1 行追記して `204` を返す。`round` / `slug` はラウンド文書の値を使い、
  クライアントの申告は採らない。未知の問い・未知の選択肢は `400` で書かない。
- **進捗** — ページ下端に「提出済み n / m」が出る。再読込しても戻らない
  （サーバが GET のたびに提出済みの問い id を差し込む）。
- **再提出は上書き** — 同じ問いに何度でも出せる。**jsonl には毎回 1 行残り、
  最後の行が勝つ**。要約と完了判定は畳んだあとの「効いている回答」で数える。
- **終了** — 全問揃うと最後の `204` を返してから約 300ms 待ち、標準出力に
  問いの順で要約を出して **0** で終わる。`Ctrl-C` はそこまでの回答を要約して **130**。

```
$ node render.mjs serve round-1.md --no-open
serve: http://127.0.0.1:53127/ — 全 3 問。回答は …/answers.jsonl に追記します（Ctrl-C で中断）
提出済み 1 / 3
…
q1: A — 15分で。リフレッシュは既存のものを使い回す
q2: B
q3: other — 両方いらない
```

要約だけが標準出力に出る（URL と進捗は標準エラー）。呼び出し側はそのまま
`answer:` 行としてラウンド文書に書き戻せる。

**serve のときだけ差し込むもの**（フッタ・POST するスクリプト・その CSS）は
`lib/html.mjs` の `serveBlock` にまとめてある。既定の書き出しと `--fragment` には
一切出さない——Artifact に出す HTML にローカルサーバ前提の JS を混ぜないため。

## 入力の契約

正本は [`../references/round-format.md`](../references/round-format.md)。
このレンダラーが読むのは次のブロックだけで、それ以外の散文は無視する。

| ブロック | 必須 | 描画先 |
| --- | --- | --- |
| frontmatter (`slug` / `round` / `target` / `status`) | 必須 | ヘッダの進捗行、見出し |
| `## 前提` の散文 + ```premise フェンス | 任意 | リード文と 前提パネル（dl） |
| ```tree フェンス | 必須 | 設計ツリーの入れ子リスト（`asks: q1` があればその問いへのリンク） |
| `### ❓ Q[n]` の散文 | 必須 | 見出し・なぜ今この判断か・抽象／具体。その後の段落・`- ` 箇条書き・`####` 小見出し・GFM 表・`**太字**` は解説として描画する |
| ```diagram フェンス（問いごとに 0 個以上） | 任意 | figure + インライン SVG + figcaption |
| ```question フェンス | 必須 | 選択肢・推奨（`prioritized_tradeoff` が見出し、`rationale` が本文）・根拠・回答フォーム |
| `answer:` 行 | 任意 | 回答フォームの初期値（提出済み表示） |

散文の選択肢行と `**推奨: X**` 行は読まない。**選択肢・推奨・トレードオフ・出典は
```question フェンスが正本**で、散文はそのコピー。

### 図の語彙

```yaml
id: d1                     # 必須。問いの中で一意
title: 現在地              # 必須。図の名前（eyebrow に出る）
caption: 一文で言える主張    # 任意。figcaption と SVG の aria-label
direction: right           # 任意。書かなければ収まる向きをレンダラーが選ぶ
groups:                    # 任意。ノードを囲む枠
  - { id: browser, label: ブラウザ, tone: ts }
nodes:                     # 必須。1 個以上
  - { id: spa, label: SPA, group: browser, tone: ts }
  - { id: future, label: 将来の更新ワーカー, tone: new, dashed: true }
  - { id: sdk, label: 認証 SDK, tone: ts, emphasis: true }
edges:                     # 任意
  - { from: spa, to: sdk, label: 呼ぶ, kind: sync }
```

- `tone` は `ts` | `rs` | `new` | `neutral`（既定）。ページの CSS 変数
  `--ts` / `--rs` / `--new` と `--*-soft` にそのまま対応する。
- `dashed: true` は「まだ無いもの・将来のもの」を表す（塗りなしの破線）。
- `emphasis: true` は太枠＋太字。1 つの図で 1〜2 個まで。
- `kind` は必須。`sync` = 実線＋塗りつぶし矢尻、`async` = 実線＋開いた矢尻、
  `reply` = 破線＋開いた矢尻。**凡例は実際に使われた種類だけを sync → async →
  reply の順で自動生成する**（辺が無ければ凡例も出ない）。
- `reply` はレイアウト上「戻り」として扱い、レイヤ計算では逆向きに食わせる。
  こうしないと往復のある図が右から左に流れてしまう。

### 図を列幅に収める順序

読み手が右半分を見られない図には意味が無いので、次の順で本文の列（720px）に収める。

1. 著者の向き（既定 `right`）でレイアウトする。
2. 収まらず、かつ `direction` が**書かれていなければ**逆向きでもレイアウトし、
   `max(幅/720, 高さ/900)` が小さいほうを採る。
3. それでも広ければ 720px まで縮小する。ただし **0.78 倍が下限**。
   下回るなら実寸のまま `.scroll` の横スクロールに逃がす。

縮小しても読めるように、描画時の基準文字サイズは **13px**（`FONT_SIZE`）。
`direction` を書くと 1〜2 が飛ばされるので、**向きは指定しないほうがよい**。

## 拡張のしかた（ブロックを 1 つ足す）

たとえば `diff` ブロックを足す場合、触るのは 3 箇所だけ。

1. **`lib/parse.mjs`** — `parseRound` のフェンス分岐に `info === 'diff'` を足し、
   `validateDiff()` を書く。検証は必ず `SchemaError(block, message)` を投げる。
   `block` は `diff <id>` のように**利用者がファイル内で探せる名前**にする。
   フィールド 1 つずつ `requireString` / `optionalString` で見る。
2. **`lib/diagram.mjs`**（絵にするなら） — レイアウトが要るなら elkjs を使い、
   幅は `nodeSize()` と `textWidth()` で決める。**文字幅の見積りは 1 箇所だけ**に
   保つ。テストのはみ出し検査も同じ関数を使うため。色は `TONE` 表に足す。
   列幅に収める処理（`COLUMN` / `MIN_SCALE`）は `renderDiagram` に集約してある。
3. **`lib/html.mjs`** — `renderQuestion()` に描画を足す。ユーザー由来の文字列は
   必ず `escapeHtml()` か `mdInline()` を通す。生の HTML は通さない。
4. **`template/style.css`** — クラスを足す。色は必ず CSS 変数経由にし、
   3 状態（bare `:root` / `prefers-color-scheme: dark` / `[data-theme="dark"]`）
   すべてに定義がある変数だけを使う。
5. **`test/`** — fixture に例を足し、(a) スキーマ違反がブロック名つきで出ること、
   (b) 生成 HTML に出ること、(c) SVG に NaN が出ないこと、を足す。
6. **`../references/round-format.md`** — 語彙の正本なので必ず同時に直す。

## テスト

```sh
pnpm test        # node:test。parse / render / serve / decision-page の 4 ファイル
```

検査しているのは主に: 記入例が読めること、スキーマ違反がブロック id つきで
報告されること、生成 HTML に全問の id と選択肢 key が出ること、凡例が実際に
使われた種類だけになること、SVG に NaN が出ないこと、ノードのラベルが箱から
はみ出さないこと、ラウンド文書の文字列がすべてエスケープされること。

serve は実際にサーバを立てて（`--no-open`・空きポート）`fetch` で回答を投げ、
jsonl の中身・標準出力の要約・終了コード（全問 = 0 / SIGINT = 130）・再提出の
上書き・400 の検証・serve の差し込みが Artifact 側に漏れないことを見ている。

## 設計上の約束

- **ページは横スクロールしない** — `body` は `overflow-x: hidden`、図は `.scroll`
  （`overflow-x: auto`）の中に置く。図はまず列幅に収め（向きの入れ替え → 0.78 倍までの縮小）、
  それでも無理なときだけ図の中を横スクロールさせる。
- **設計ツリーは絵にしない** — 節が増えると横に伸びて読めなくなる。入れ子リストで出す。
- **外部アセットは Google Fonts だけ** — 画像も CDN スクリプトも使わない。
- **色は 3 状態のテーマトークン** — 明示指定（`[data-theme]`）と OS 設定の
  両方で正しく出る。単独のメディアクエリの中だけで色を定義しない。
- **`color-scheme` もトークンと同じ 3 状態で切り替える** — 宣言を落とすと、
  暗色のページでもラジオ・テキストエリア・スクロールバーだけが UA の明色で
  描かれる。Artifact 側の外殻は `color-scheme` を宣言するので、こちらが
  宣言しないと**ローカルで開いたときだけ**フォームが浮く。
- **文字幅は見積り** — ブラウザで測らずに SVG を確定させるため、ASCII 0.6em /
  CJK 1em で数える。太字は 1.08 倍。
