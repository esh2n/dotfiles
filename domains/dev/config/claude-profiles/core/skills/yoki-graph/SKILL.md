---
name: yoki-graph
description: Use to run a multi-agent workflow (review, research, implement, preflight, design-review, acceptance, code-study, deliberate, stocktake, go-optimize) from Codex or omp — the CLI launcher for the same Workflow-tool-shaped scripts Claude Code runs natively. Symptoms include a request to launch one of these workflows outside Claude Code, "codex から review 回して", "omp からワークフロー起動して", or checking a run's status/journal after launch.
---

# yoki-graph

## Overview

yoki-graph は `core/workflows/*.js`(Claude Code の Workflow tool が実行するのと
**同じ**スクリプト)を Claude Code の外から動かすための CLI
(`bin/yoki-graph`、実体は `runtime/yoki/scripts/lib/graph/cli.js`)。責務は
Workflow tool と同一 — スクリプトを書くのはこのスキルの仕事ではなく、
`workflow-authoring` スキルの領域。yoki-graph はその実行だけを担う。

**Claude Code の中では、ネイティブの Workflow tool がこれまでどおり本来の
経路。**yoki-graph に切り替える必要はない。yoki-graph を選ぶのは:

- Codex(`codex exec`)や omp など、Workflow tool を持たない harness から
  同じグラフを起動したいとき
- CLI から `--resume` / `--json` / `status` でランを直接触りたいとき

## いつワークフロー、いつ単発 subagent か

`core/CLAUDE.layer.md`(Expensive-Model Delegation)の原則そのまま:

> Workflow vs single agent: workflows for batches of adjudicated tasks
> (parallel, per-task verify + gate + delivery); a single agent for
> one-cause investigations with a tight repro loop; the main session only
> for judgment and acceptance

つまり「複数の判定/検証を伴うバッチ処理」はワークフロー、「原因が一つに
絞れている調査をタイトなループで回す」だけなら単発の subagent の方が軽い。
迷ったら `yoki-graph list` で既存グラフの `description`/`whenToUse` を見て、
今のタスクがどれかの型にはまるか先に確認する。

## コマンド

```
yoki-graph run <name|path> --backend claude|codex|omp|mock
    [--args '<json>' | --args-file <f>] [--cwd <dir>]
    [--resume <runId>] [--dry-run] [--json] [--concurrency N]
    [--model haiku|sonnet|opus|<id>] [--effort low|medium|high|xhigh|max]
    [--mock <file>] [--timeout <ms>]
yoki-graph list
yoki-graph status <runId>
```

`<name>` は `~/.claude/workflows/<name>.js`(=`core/workflows/` からインストール
された実体。pack 由来のグラフは、そのパックが有効な機体でだけ同じ場所に
merge される)を指す。パス区切りを含む/`.js` で終わる引数はファイルパスとして
先に解決される。`--args` は JSON 文字列、`--args-file` はそれをファイルから
読む — 両方渡す必要はどちらか一方だけ。`--backend mock` は `--mock <file>`
の固定応答で流す(テスト/ドライラン用)。

### ワークフロー別コマンド

`core/workflows/` の9本 + `packs/go/workflows/go-optimize.js`(go pack 有効時
のみインストールされる)。各スクリプト冒頭の `meta`/args コメントから。

- **review** — 独立コンテキストの多エージェントコードレビュー
  ```
  yoki-graph run review --backend codex --args '{"range":"origin/main...HEAD"}'
  ```
  `args: { range?: string, model?: string }`。`range` 省略時は worktree vs
  `origin/main` の merge-base(未 push のコミット+未コミット変更を両方含む)。

- **research** — 複数角度の調査、根拠つき統合
  ```
  yoki-graph run research --backend omp --args '{"question":"..."}'
  ```
  `args: { question: string, context?: string, model?: string, language?: string }`

- **implement** — 合意済みタスクリストのバッチ実行(依存波・ファイル重複
  バッチ・per-task verify+retry・最終ゲート・任意 delivery)
  ```
  yoki-graph run implement --backend claude --args '{"tasksFile":"tasks.md","delivery":"none"}'
  ```
  `args: { tasks?: [{id,title,spec,files?,deps?}], tasksFile?: string,
  rules?: [path], docs?: [path], model?: string, max_retry?: number,
  delivery?: 'none' | 'commit' | 'draft-pr', deliveryBranch?: boolean }`

- **preflight** — PR前のローカル品質ゲート(fan-out review → judge → 自動
  修正 → lint/build ゲート)
  ```
  yoki-graph run preflight --backend codex
  ```
  `args: { model?: string }`

- **design-review** — 設計/spec をプロジェクトの実態に照らして精査
  ```
  yoki-graph run design-review --backend omp --args '{"target":"docs/design.md"}'
  ```
  `args: { target: string (path/URL/inline text), model?: string, language?: string }`

- **acceptance** — 実装済みの完了判定(基準ごとの証拠マッピング + 敵対的検証)
  ```
  yoki-graph run acceptance --backend claude --args '{"criteriaFile":"acceptance.md","scope":"..."}'
  ```
  `args: { criteria?: [{id,text}], criteriaFile?: string, scope?: string,
  out?: string, language?: string, model?: string }`

- **code-study** — 既存実装を固定質問に沿って読む(file:line 根拠つき)
  ```
  yoki-graph run code-study --backend codex --args '{"target":"./pkg","questions":["..."]}'
  ```
  `args: { target: string, questions: string[], context?: string, out?: string,
  language?: string, model?: string }`

- **deliberate** — ダブルダイヤモンド型の設計検討(発散→ゲート→収束→反証)
  ```
  yoki-graph run deliberate --backend omp --args '{"question":"..."}'
  ```
  `args: { question: string, context?: string, grounding?: string[],
  evidence?: 'auto' | 'never', model?: string, language?: string }`

- **stocktake** — `~/.claude` の定期棚卸し(skills/hooks/MCP/memory、report-only)
  ```
  yoki-graph run stocktake --backend claude
  ```
  `args: { model?: string, language?: string }`

- **go-optimize**(go pack 有効時のみ)— pprof 起点の Go 性能最適化提案、
  worktree 隔離 + benchstat ゲート
  ```
  yoki-graph run go-optimize --backend claude --args '{"pkg":"./internal/codec"}'
  ```
  `args: { pkg: string (必須), bench?: string, threshold?: number,
  budget?: {maxProposals?, maxRounds?}, delivery?: 'draft' | 'commit' | 'pr',
  runId?: string }`。`go-optimize` が `yoki-graph list` に出ないマシンでは
  `yoki-switch pack enable go` が先。

## guard / 日次キャップ

`workflow-guard.sh`(Claude Code の Workflow tool 用 PreToolUse フック)と
**同じカウンタファイル**(`~/.claude/.cache/workflow-guard/count-YYYYMMDD`)を
使う — Claude Code から起動した回数と `yoki-graph run` で起動した回数は
同じ日次上限を共有する。

- キャップの解決順: `.yoki.json` の `workflowDailyCap`(`cwd` から上に探索)
  → 環境変数 `YOKI_WORKFLOW_DAILY_CAP` → デフォルト 5。
- 逃げ道: `WORKFLOW_GUARD_DISABLED=1`、または `.yoki.json` の
  `disabledHooks` に `"workflow-guard"`。
- 内部エラー(state dir が壊れている等)では fail-open — ガードのせいで
  ランが止まることはない。
- **フックにあって yoki-graph には無い挙動**: 「セッション内でそのワーク
  フローを初めて起動したときは理由つきで1回だけ拒否し、同じ内容の再試行は
  通す」というターン。これは Claude Code セッションが拒否理由を読んで
  同じターン内で再試行できることに依存する挙動で、CLI プロセスにはその
  リトライループが無い(拒否されたら単にその起動が失敗して終わる)ため、
  意図的に再現していない。効くのは日次キャップだけ。
- `--dry-run` はガード自体を一切通らない(カウントも消費しない) —
  `agent()` はどのバックエンドも呼ばずプレースホルダを返すだけなので、
  backend 固有の実行を検証したことにはならない点に注意。
- 拒否されると exit code 1、標準出力に理由(トークン消費の目安つき)が出る。

## sandbox(codex backend の書き込み権限)

`--backend codex` のとき、`agent()` は `codex exec -s <sandbox>` で走る。
**デフォルトは `read-only`**(codex 自身のデフォルトと同じ)。
書き込む呼び出しだけがスクリプト側で明示的に要求する:

```js
await agent(prompt, { label: 'impl:t1', sandbox: 'workspace-write' })
```

- 値は `read-only` / `workspace-write` / `danger-full-access`。未知の値は
  黙って広げずエラーになる。
- `isolation: 'worktree'` は書き込み権限を**含まない** — scratch worktree で
  編集する呼び出しは `sandbox` も明示する(go-optimize.js の Propose 参照)。
- 実際に `workspace-write` を要求しているのは、編集・コミット・ビルド/テスト
  実行・レポート書き出しの段だけ。レビュー/調査/検証の段は read-only のまま
  — これらのプロンプトは diff hunk や取得した外部テキストで組み立てられる。
- `claude` / `omp` バックエンドには対応するフラグが無いので、この option は
  無視される。

## journal の読み方

`agent()` 呼び出し1回につき1行、
`~/.local/state/yoki/graph/<runId>/journal.jsonl`
(`YOKI_STATE_HOME` があればそちら配下、なければ `XDG_STATE_HOME` — 他の
yoki state ファイルと同じ解決)に
`{key, label, phase, status, result, tokens?, durationMs}` が追記される。
`key` は `sha256(prompt + JSON(opts))` — 同じ呼び出しは常に同じ key になり、
これが `--resume` のキャッシュキー。

- `yoki-graph run` の標準出力/`--json` は `run.json`(name/backend/args/cwd/
  status/error)とこの journal をそのまま反映したイベントストリーム。
  `--json` なら1行1 JSON(NDJSON)、素の実行なら人間向けの進捗行。
- `yoki-graph status <runId> [--json]` で run.json + journal 集計
  (`agentCalls`/`ok`/`errors`)を見る。
- `--resume <runId>` で同じ runId を渡すと、journal に `status: "ok"` で
  残っている呼び出しはそのままキャッシュから返り、新規/変化した呼び出しと
  それ以降だけが実際に走る。**args を変えて同じ runId を再利用すると、
  変わっていない呼び出しは古い結果のまま返る**点に注意 — 別の入力で
  やり直すなら新しい runId(省略してデフォルトで自動採番)で走らせる。

## delivery(commit / draft-pr)のルール

`implement.js` と `go-optimize.js` はどちらもコード上でこう明言している:

> delivery mode must be confirmed with the user BEFORE launching this
> workflow — the graph itself never asks mid-run (boundary principle:
> interactive decisions happen outside the graph, not inside a phase)

つまり `args.delivery`(`implement`: `'none' | 'commit' | 'draft-pr'`、
`go-optimize`: `'draft' | 'commit' | 'pr'`)は **`yoki-graph run` を叩く前に
ユーザーへ確認して決める** — グラフの途中で聞き返してくることは無い。
未知の値や無指定は必ず安全側(`implement` は `'none'`、`go-optimize` は
`'draft'`)にフォールバックし、`'commit'`/`'pr'` 側へは絶対に倒れない。
Codex/omp からこの2本を起動するときも同じ順番を守る: 先にユーザーの
delivery 選択を得てから `--args` に載せる。

## よくある失敗

- **Claude Code の中なのに yoki-graph に切り替える** — ネイティブの
  Workflow tool がそのまま使える。harness をまたぐ必要が無いなら回り道。
- **`--args` に文字列化した JSON を二重にエスケープして渡す** — 各
  スクリプトは `typeof A === 'string'` なら自分で `JSON.parse` する保険を
  持っているが、それに頼らず `--args '<JSON>'` はそのまま JSON として渡す。
- **delivery をユーザーに確認せず `implement`/`go-optimize` を起動する** —
  デフォルトは安全側に倒れるので何も壊れはしないが、意図した commit/
  draft-pr を出すには前節の順番どおり事前確認が要る。
- **`go-optimize` が `yoki-graph list` に出ないと言って直接パス指定で呼ぶ** —
  go pack が無効な機体ではそもそも `~/.claude/workflows/go-optimize.js` が
  存在しない。`yoki-switch pack enable go` が先。
- **`--dry-run` の結果を「backend 固有の動作確認ができた」と扱う** —
  `agent()` はどのバックエンドでも実プロセスを起動せずプレースホルダを
  返すだけで、backend ごとの argv や実行結果の違いはここでは見えない。
- **`WORKFLOW_GUARD_DISABLED=1` を常時 export する** — 日次キャップという
  暴走防止そのものを恒久的に無効化してしまう。単発の起動のときだけ付ける。
- **同じ `runId` に `--resume` しつつ `--args` を変える** — journal の
  キャッシュキーは prompt+opts のハッシュなので、変わっていない呼び出しは
  古い結果のまま返ってくる。入力を変えたら新しい runId で走らせる。
- **Claude Code の「セッション内初回起動は1回だけ拒否」を CLI でも期待する** —
  yoki-graph にそのリトライループは無い(前節参照)。効くのは日次キャップ
  だけなので、初回起動がいきなり拒否されることはない(キャップ超過時を除く)。
