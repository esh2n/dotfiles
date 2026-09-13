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


## `yoki-graph top` — 全ラン横断のライブビューア

- `yoki-graph top [--state-home <dir>] [--once] [--columns <path>]`。state
  ルート配下の**全ラン**を kubectl 風に一覧する: ヘッダ(active/done と現在
  時刻) → ランごとのブロック(ラン行 + レーン行) → フッタ(合計トークン)。
- ラン行: `状態 name backend phase 2/5 経過 tokens レーン done/total`。状態は
  ▶ running / ● ok / ✗ error / **⚠ stale**(run.json が running のまま lock の
  pid が死んでいる — 落ちたラン)。
- レーン行: `状態 label phase backend/model 経過 tick tokens 進捗バー`。
  ◉ running / ● ok / ✗ error / ↻ retry 中 / ○ cached(replay) / 🔸 needs-human。
  進捗バーは同一ラン内の**完了済み兄弟レーン**の (durationMs, toolCalls) の
  対数中央値を事前分布にした推定で、表示は 0.85 でキャップ。兄弟が 0 本なら
  バーは出ない(嘘の % を出さない)。
- lane 由来のラン(runId に `-lane-` を含む、yoki-agent が作るもの)は親ランの
  ブロック内にレーン行としてネストされる。
- 表示状態は各ランの `events.ndjson` の畳み込み**のみ**から作る(journal は
  読まない)。データ読みはポーリングせず fs.watch 駆動 + 5秒に1回の安全網。
  再描画は 100ms で合流し、前回と同一画面なら書かない。
- **非 TTY または `--once`** はスナップショットを1回印字して exit 0 —
  スクリプトから読む一級経路。
- 列は `~/.config/yoki-graph/top-columns.json`(または `--columns <path>`)で
  選択・順序・幅・右寄せを上書きできる。壊れた JSON・未知の key は警告1行で
  既定にフォールバックし、起動は失敗しない。書式は
  runtime/yoki/scripts/lib/graph/API.md の「top の列スキーマ」参照。
