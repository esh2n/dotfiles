# yoki-graph — 進捗と `status`

> [SKILL.md](../SKILL.md) の詳細編。

## 進捗の見かた

- **TTY**: 恒久的な行(phase 見出し・log・終わった agent)はそのまま流れ、
  その下に1行のライブ状態が `\r` で更新される:
  `phase 2/5 Review — running 3 / done 7 / failed 0 — [security gpt-5.6-sol 41s +3 tools]`
- **パイプ/ファイル**: ライブ行は出さず、イベント1件=1行(ログに `\r` の
  再描画を残さないため)。
- `--json` は従来どおり NDJSON。`model` / `backend` / `index` / `phases` が
  増え、実行中の tool 呼び出し数を伝える `agent-progress` イベントが増えた
  (codex は `--json` の item イベント、omp は json モードのイベント列から
  数える。mock は合成値を1回だけ返す)。`opts.gate` を持つ呼び出しは
  `agent-gate`(`status` と `gate: {command, exitCode, ms, killed}`)も出す。
- `yoki-graph status <runId>`(または明示の `--once`)は1回だけ描画して終了する
  ワンショット。runId が無い/未知なら usage・`no run found` を出して非0で終了し、
  watch ループには入らない(ハングしない)。`--once` / `--watch` はどの位置でも
  効くブールフラグ。
- `yoki-graph status <runId> --watch` は2秒ごとに journal の**追記分だけ**を
  読んで同じ状態行を描き(全文再読み込みではないので、長いランでも1tickの
  コストが増えていかない)、ランが終わったら通常の `status` 出力を出して
  終了する。ファイルが短くなったら(切り詰め・ローテート)全文を読み直す。

