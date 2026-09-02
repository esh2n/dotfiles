# yoki-graph — コマンドとワークフロー別の起動

> [SKILL.md](../SKILL.md) の詳細編。

## コマンド

```
yoki-graph run <name|path> --backend codex|omp|mock
    [--args '<json>' | --args-file <f>] [--cwd <dir>]
    [--resume <runId>] [--dry-run] [--json] [--concurrency N]
    [--model haiku|sonnet|opus|<id>] [--effort low|medium|high|xhigh|max]
    [--mock <file>] [--timeout <ms>] [--gate-timeout <ms>] [--retries N]
    [--max-agent-calls N] [--max-tokens N] [--max-wall-ms N]
    [--model-map <tier>=<id>,...]
yoki-graph list
yoki-graph status <runId> [--once|--watch]
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
  `args: { range?: string, model?: string, providers?: array }`。`range`
  省略時は worktree vs `origin/main` の merge-base(未 push のコミット+
  未コミット変更を両方含む)。`providers` は **Claude Code から起動する
  ときだけ**意味を持つ([providers.md](providers.md))
  — yoki-graph から起動する場合は `--backend` が全レーンを決めるので不要。

- **research** — 複数角度の調査、根拠つき統合
  ```
  yoki-graph run research --backend omp --args '{"question":"..."}'
  ```
  `args: { question: string, context?: string, model?: string,
  language?: string, providers?: array }`

- **implement** — 合意済みタスクリストのバッチ実行(依存波・ファイル重複
  バッチ・per-task verify+retry・最終ゲート・任意 delivery)
  ```
  yoki-graph run implement --backend codex --args '{"tasksFile":"tasks.md","delivery":"none"}'
  ```
  `args: { tasks?: [{id,title,spec,files?,deps?}], tasksFile?: string,
  rules?: [path], docs?: [path], model?: string, max_retry?: number,
  delivery?: 'none' | 'commit' | 'draft-pr', deliveryBranch?: boolean,
  gateCommand?: string }`。`gateCommand` を渡すと Gate 段にコマンド gate が
  付き、その終了コードが delivery の前提になる([gate.md](gate.md))。

- **preflight** — PR前のローカル品質ゲート(fan-out review → judge → 自動
  修正 → lint/build ゲート)
  ```
  yoki-graph run preflight --backend codex
  ```
  `args: { model?: string, gateCommand?: string }`。`gateCommand` を渡すと
  Gate 段にコマンド gate が付き、非0なら pass marker を書かない。

- **design-review** — 設計/spec をプロジェクトの実態に照らして精査
  ```
  yoki-graph run design-review --backend omp --args '{"target":"docs/design.md"}'
  ```
  `args: { target: string (path/URL/inline text), model?: string, language?: string }`

- **acceptance** — 実装済みの完了判定(基準ごとの証拠マッピング + 敵対的検証)
  ```
  yoki-graph run acceptance --backend codex --args '{"criteriaFile":"acceptance.md","scope":"..."}'
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
  yoki-graph run stocktake --backend omp
  ```
  `args: { model?: string, language?: string }`

- **go-optimize**(go pack 有効時のみ)— pprof 起点の Go 性能最適化提案、
  worktree 隔離 + benchstat ゲート
  ```
  yoki-graph run go-optimize --backend codex --args '{"pkg":"./internal/codec"}'
  ```
  `args: { pkg: string (必須), bench?: string, threshold?: number,
  budget?: {maxProposals?, maxRounds?}, delivery?: 'draft' | 'commit' | 'pr',
  runId?: string, gateCommand?: string | false }`。`gateCommand` の既定は
  `go build ./... && go vet ./...` で、候補ごとの worktree の中で走る。。`go-optimize` が `yoki-graph list` に出ないマシンでは
  `yoki-switch pack enable go` が先。

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
  Workflow tool がそのまま使える。harness をまたぐ必要が無いなら回り道で、
  そもそも `--backend claude` は存在しない(拒否される)。
- **`--args` に文字列化した JSON を二重にエスケープして渡す** — 各
  スクリプトは `typeof A === 'string'` なら自分で `JSON.parse` する保険を
  持っているが、それに頼らず `--args '<JSON>'` はそのまま JSON として渡す。
- **delivery をユーザーに確認せず `implement`/`go-optimize` を起動する** —
  デフォルトは安全側に倒れるので何も壊れはしないが、意図した commit/
  draft-pr を出すには上の delivery 節の順番どおり事前確認が要る。
- **`go-optimize` が `yoki-graph list` に出ないと言って直接パス指定で呼ぶ** —
  go pack が無効な機体ではそもそも `~/.claude/workflows/go-optimize.js` が
  存在しない。`yoki-switch pack enable go` が先。
- **`--dry-run` の結果を「backend 固有の動作確認ができた」と扱う** —
  `agent()` はどのバックエンドでも実プロセスを起動せずプレースホルダを
  返すだけで、backend ごとの argv や実行結果の違いはここでは見えない。
- **`WORKFLOW_GUARD_DISABLED=1` を常時 export する** — 日次キャップという
  暴走防止そのものを恒久的に無効化してしまう。単発の起動のときだけ付ける。
- **`--resume` を「変わっていない呼び出しは古い結果が返る」ものとして扱う** —
  prefix 再生なので、食い違った位置から先はすべて走り直る。`--args` を変えた
  再開でも下流に古い結果は混ざらない。
- **`status: locked` を「壊れた」と読む** — 同じ runId を別プロセスが
  掴んでいるだけ。終わるのを待つか、その pid が本当に死んでいるなら
  `<runDir>/lock` を消す(放っておいても1時間で stale になる)。
- **`tokensSource: "estimated"` の数字をコストトラッカーと突き合わせる** —
  バックエンドが usage を報告しなかった呼び出しの推定値なので、実測と
  混ぜて集計しない(表示も reported / estimated を分けている)。
- **Claude Code の「セッション内初回起動は1回だけ拒否」を CLI でも期待する** —
  yoki-graph にそのリトライループは無い([budget.md](budget.md) 参照)。効くのは日次キャップ
  だけなので、初回起動がいきなり拒否されることはない(キャップ超過時を除く)。
