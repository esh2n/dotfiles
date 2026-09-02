# yoki-graph — guard / 実行キャップ / リトライとトークン

> [SKILL.md](../SKILL.md) の詳細編。

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

## 実行キャップ(暴走防止)

日次キャップ(前節)は「その日の起動回数」の上限で、**1回のランの暴走は
止めない**。ラン単位の上限はこの3つ:

| cap | `.yoki.json` | CLI | 既定 |
| --- | --- | --- | --- |
| `agent()` 呼び出し数 | `graphMaxAgentCalls` | `--max-agent-calls` | 1000 |
| トークン | `graphMaxTokens` | `--max-tokens` | 無制限 |
| 実行時間(ms) | `graphMaxWallMs` | `--max-wall-ms` | 無制限 |

- 解決順は CLI フラグ → `.yoki.json`(`cwd` から上に探索)→ 環境変数
  (`YOKI_GRAPH_MAX_AGENT_CALLS` など)→ 既定値。値 `0` はそのキャップの無効化。
- 超過は**ハードフェイル**(ランが `status: error` で終わる)。`parallel()` /
  `pipeline()` は普通の失敗を `null` に畳むが、キャップ超過だけは畳まずに
  再送出する — `null` に落としたら暴走ループはそのまま回り続けてしまう。
- `budget.total` / `budget.remaining()` は `graphMaxTokens` を設定していれば
  実数を返す(未設定なら `null` / `Infinity`)。再生された呼び出しは
  `agent()` 呼び出し数を消費しない。

## リトライ・タイムアウト・トークン計上

- **リトライ**: バックエンドの一時障害(429、5xx、timeout、EPIPE/ECONNRESET
  など)は指数バックオフ(500ms → 1s → …、上限5s)で既定2回まで再試行する
  (`--retries N`)。`ENOENT` や不正なフラグのような「やり直しても同じ」失敗は
  1回で諦める。再試行は journal に `status: "retry"` として残る。
  これはスキーマ違反のリトライ(schema.js が1回だけ行う)とは別の層。
- **タイムアウト**: `agent(prompt, { timeoutMs })` > `--timeout <ms>` >
  既定15分。`opts.gate` のタイムアウトはこれとは別枠(`gateTimeoutMs` >
  `--gate-timeout <ms>` > 既定10分、リトライ対象外)。超えた子プロセスは SIGKILL され、`timedOut: true` で journal に
  記録される(タイムアウトは一時障害扱いなのでリトライ対象)。
- **トークン**: 各バックエンド自身の出力から読む — codex は `--json` の
  `turn.completed` の usage、omp は assistant レコードの `usage`。報告が
  無い場合だけ出力長からの**推定**にフォールバックし、
  `tokensSource: "estimated"` と明示する(黙って 0 にはしない)。ラン終了時に
  `tokens: N (X reported, Y estimated) — over K agent calls — M cached` の
  1行が出る。codex の課金対象は `input + output` のみで、キャッシュ分は
  加算しない([model-map.md](model-map.md) 参照)。

