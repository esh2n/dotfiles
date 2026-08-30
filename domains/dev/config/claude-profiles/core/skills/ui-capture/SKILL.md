---
name: ui-capture
description: Use when the user wants a screenshot or short GIF of a web UI for a PR description, writeup document, or Artifact — a running or headlessly-launchable web app, not a native macOS app (Tauri/Swift apps steal the user's screen and are out of scope). Symptoms include "スクショ撮って", "GIF にして", "見せて" about a web page, or a request to attach visual evidence of a UI change to a PR or design doc.
---

# ui-capture

## Overview

ui-capture は web UI を headless Chromium で操作して PNG / GIF を書き出す実行体
(`bin/capture.mjs`)だけを持つ。責務の切り分けは明確: **アプリの起動手段を
決めるのは呼び出し元のプロジェクト**(dev サーバ、モックバックエンド、
フィクスチャの用意)、**ブラウザを操作してエンコードするのはこのスキル**。

起動手段の渡し方は2通り: `--url` に既に動いている URL を渡すか、
プロジェクトの `.ui-capture.json` マニフェストで起動コマンドを宣言して
capture.mjs 自身に立ち上げさせるか。どちらの場合も **起動コマンドを
capture.mjs や呼び出しエージェントが推測しない** — マニフェストが無く
`--url` も無ければ、起動を試みずに exit 2 で「起動手段なし」と報告して
止まる。

対象は web UI(Playwright で headless に撮れるもの)に限る。ネイティブ
macOS アプリ(Tauri のパレット、Swift Core 等)は AppKit / Accessibility が要り
対象外 — そもそも起動すると esh2n の画面を奪う。

## Zero-dependency rule

`node` 単体で動く。追加インストールは一切しない。

- **playwright** は呼び出し元プロジェクトの `node_modules` から解決する
  (`require.resolve('playwright', { paths: [process.cwd()] })`)。このスキル
  自身は playwright を持たない。プロジェクトの外から呼ぶ、あるいはテストで
  固定パスを使いたい場合は環境変数 `UI_CAPTURE_PLAYWRIGHT=/path/to/
  node_modules/playwright` で上書きできる。どちらでも解決できなければ
  exit 3(playwright not found)で明確に落ちる。
- **ffmpeg** は PATH 上のものを使う(WebM → GIF の 2 パス変換
  `palettegen`/`paletteuse`)。無ければ GIF は静かに失敗させず、要約 JSON に
  `gif: { status: "skipped", reason: "ffmpeg not found on PATH" }` を出して
  exit 0 で終える(PNG は撮れているので致命ではない)。

## 手順

### 1. プロジェクトの起動方法を見つける

まず「このプロジェクトは web UI をどう起動するか」を探す:

- プロジェクト自身のスキル(`<repo>/.claude/skills/` 等)
- mise task / package.json script(`mise run dev`、`pnpm dev` 等)
- 既存の検収・品質ゲートスクリプトが使っている起動子(arekore の例:
  `apps/viewer/test/quality/mock-daemon.ts` + `serve.ts` — production build
  した `dist/` をモックデーモン付きで静的配信する。同じ helper を import
  して `site.url` を得ればよい)

見つけたら、どちらかの経路で capture.mjs に渡す。**新しい起動方法を自作
しない** — 既にあるものを再利用する。

**経路 A — 自分で起動して `--url` を渡す。** 見つけた起動子を
**バックグラウンドで自分が起動し**、得た URL を `--url` に渡す。1回限りの
撮影、既に起動済みのアプリを撮る場合、起動子がスクリプトから呼びにくい
形(対話 CLI 等)のときに向く。

**経路 B — `.ui-capture.json` マニフェストを書き、capture.mjs 自身に
起動させる。** プロジェクトのルートに1度だけ書けば、以後は capture.mjs が
起動から後始末まで面倒を見る(「起動する側」も「片付ける側」も自分で
やる)。書式は次の節。プロジェクトに `.ui-capture.json` が無く、
`--url` も渡されなければ、capture.mjs は起動を推測せず
`起動手段なし: --url か .ui-capture.json を用意する` で exit 2 する —
これは意図した挙動で、回避しようとせずプロジェクト側にマニフェストを
足す。

SAFETY: `headless: false` は絶対に渡さない。`open`、`osascript`、ブラウザの
実ウィンドウを開くものは一切使わない。ここは capture.mjs 側で強制済み
(常に `chromium.launch()` を引数なしで呼ぶ)だが、起動子側(経路 A の
自作起動コード、経路 B の `launch` コマンド)でも同じ規律を守ること。

### 2. シナリオファイルを書く(JSON — zero-dep のため YAML ではなく JSON)

下記フォーマットのファイルを書き、`--scenario` に渡す。

### 3. capture.mjs を実行する

```bash
# 経路 A(--url)
node "$SELF/bin/capture.mjs" --url http://127.0.0.1:PORT --scenario scenario.json --out ./out

# 経路 B(.ui-capture.json、--project は省略すると cwd から上へ探す)
node "$SELF/bin/capture.mjs" --project . --scenario scenario.json --out ./out
```

主なフラグ(すべて省略可、既定値は括弧内): `--project`(`.ui-capture.json`
を探し始めるディレクトリ。既定は cwd)、`--width`(1280)、`--height`(800)、
`--scale`(2、`deviceScaleFactor`)、`--gif-fps`(10)、`--gif-width`(800)、
`--theme light|dark`(`prefers-color-scheme` をエミュレート)、`--dry-run`
(何も実行・書き出しせず、シナリオの妥当性とステップ数だけ確認する)。

標準出力に JSON 要約(撮ったファイル・バイト数・GIF の長さ・
`launched`(マニフェストから自分で起動したか)・8MB/8s 予算超過の
warning)を1回だけ出す。exit code: 0=成功、2=引数かシナリオが不正
(`--url` も `.ui-capture.json` も無い場合を含む)、3=playwright が
解決できない、4=ステップ実行失敗(どのステップ・どのセレクタで失敗したかを
stderr に出す)、5=マニフェストの `launch` が readiness まで届かずタイムアウト
(60秒)、または `launch` コマンド自体が起動できなかった。

### 4. writeup へ渡す

出力を `<slug>-assets/` にコピーし、`.wu-shot` から参照する(1 figure に
`<img>` は1枚、`alt` は必須。GIF もそのまま `<img src="x.gif">` でよい —
ブラウザも GitHub も自動再生する。詳細は writeup-kit の
`references/components.md` の `.wu-shot` 節)。

### 5. サイズ予算

`.wu-shot` の合計は 8MB 未満、ページ全体は Artifact の上限 16MB 未満に
収める(writeup-kit と同じ予算)。この予算に合わせて GIF の既定値は
fps 10・width 800・目安 8 秒以内にしてある。長いフローは複数の GIF に
分割する — 1本に詰め込まない。

## シナリオフォーマット

```json
{
  "steps": [
    { "goto": "/" },
    { "press": "Meta+KeyK" },
    { "fill": ["role=combobox", "検索語"] },
    { "wait": 300 },
    { "waitFor": "role=listbox" },
    { "shot": "search-open" },
    { "press": "Escape" },
    { "hover": ".row" }
  ],
  "gif": { "name": "search-flow" }
}
```

ステップは1つずつ順に実行する。各行は次のキーのうち **ちょうど1つ**を持つ:

| キー | 意味 |
|---|---|
| `goto` | `--url` を基点にした相対パス、または絶対 URL へ遷移 |
| `click` | セレクタをクリック |
| `fill` | `[セレクタ, テキスト]` — その要素に入力 |
| `press` | `page.keyboard.press()` にそのまま渡すキー文字列(例: `Meta+KeyK`、`Escape`) |
| `wait` | ミリ秒だけ待つ |
| `waitFor` | セレクタが visible になるまで待つ |
| `shot` | PNG を書き出す。名前を渡す。任意で `clip`(セレクタ)を添えるとその要素の bounding box だけ切り出す |
| `hover` | セレクタにホバー |

`gif` を持たせると、シナリオ全体の録画から GIF を1本書き出す。手順は次の
4段階:

1. `recordVideo` 付きでコンテキストを作る(コンテキストごと録画)
2. 全ステップを実行する
3. コンテキストを閉じて WebM を確定する
4. ffmpeg の 2 パス(`palettegen`/`paletteuse`)で GIF 化する

`gif` を省略すれば PNG だけの実行になる。

## プロジェクトマニフェスト(`.ui-capture.json`)

プロジェクトのルートに1つ置く。capture.mjs は `--project`(既定 cwd)から
上へディレクトリを辿り、最初に見つかった `.ui-capture.json` を使う。

```json
{
  "launch": "pnpm --filter @arekore/viewer exec tsx test/quality/serve-only.ts",
  "url": "http://127.0.0.1:41999",
  "ready": "serving on",
  "stop": "pkill -f serve-only.ts"
}
```

| フィールド | 必須 | 意味 |
|---|---|---|
| `launch` | 必須 | シェルで実行する起動コマンド(文字列そのまま `spawn(cmd, { shell: true })`) |
| `url` | 必須 | 起動が終わった後、シナリオが撮りに行く基点 URL |
| `ready` | 必須 | 起動完了の判定。文字列なら `launch` の stdout/stderr にその部分文字列が出るまで待つ。`{ "http": "/path" }` なら `url + path` が HTTP 200 を返すまで待つ。どちらもタイムアウトは60秒(exit 5) |
| `stop` | 任意 | 撮影後に実行する終了コマンド。省略時は `launch` が作ったプロセスグループへ `SIGTERM` を送る(`spawn` を `detached: true` で起動しているため、グループごと止まる) |
| `env` | 任意 | `launch`/`stop` に追加で渡す環境変数(`process.env` に上書きマージ) |

capture.mjs は撮影の成功・失敗を問わず、自分が起動したプロセスを最後に
必ず止める(`finally` で片付け、常駐プロセスを残さない)。

## よくある失敗

- **`--url` も `.ui-capture.json` も無いのに capture.mjs へ起動コマンドを
  推測させようとする** — capture.mjs は起動コマンドを一切推測しない。
  経路 A(自分で起動して `--url`)か経路 B(`.ui-capture.json` を書く)の
  どちらかを選ぶ。exit 2「起動手段なし」が出たら、回避せずマニフェストを
  足すか `--url` を渡す。
- **`.ui-capture.json` の `launch` に自作の起動コマンドをその場ででっち上げる**
  — 既存の dev サーバ・mise task・検収スクリプトの起動子をそのまま
  `launch` に書く。プロジェクトに無い新しい起動手順を発明しない。
- **`headless: false` にして「確認のため」画面を開く** — 絶対にしない。
  esh2n の画面はエージェントの作業中で、奪ってはいけない。
- **`press` に人間可読な表記(`⌘K`)をそのまま書く** — Playwright の
  `keyboard.press()` が解釈できる文字列(`Meta+KeyK` 等)を書く。
- **GIF が長すぎる/大きすぎる** — 1本のシナリオに複数のフローを詰め込んで
  8 秒・8MB を超える。フローごとに `gif.name` を分けて複数回実行する。
- **playwright が見つからないのに黙ってエラーメッセージだけ見て諦める** —
  `UI_CAPTURE_PLAYWRIGHT` で明示指定できることを忘れない。
- **ffmpeg が無い環境で GIF 必須だと思い込む** — スキップは正常系(exit 0)。
  PNG だけでも十分な提出物になることが多い。
