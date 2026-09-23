# yoki-graph — journal / `--resume` / ロック

> [SKILL.md](../SKILL.md) の詳細編。

## journal の読み方 / `--resume` は prefix 再生

`agent()` 呼び出し1回につき1行、
`~/.local/state/yoki/graph/<runId>/journal.jsonl`
(`YOKI_STATE_HOME` があればそちら配下、なければ `XDG_STATE_HOME` — 他の
yoki state ファイルと同じ解決)に
`{gen, index, key, label, phase, status, result, tokens?, tokensSource?,
usage?, durationMs}` が追記される。`index` は呼び出しの到着順、`gen` は
その runId に対する何回目の実行か、`key` は
`sha256(prompt + JSON(opts + 解決後の backend + 解決後の model))`
(スクリプトが付けた `label` も含む)。`opts.model` だけでは足りない —
省略されてランの `--model` を継ぐことも、`--model-map` で意味が変わる
tier 名であることもあるため。これが無かった頃は、`--model` を差し替えて
`--resume` すると**別のモデルが出した答え**が再生されていた。

- `yoki-graph run` の標準出力/`--json` は `run.json`(name/backend/args/cwd/
  status/error/usage)とこの journal をそのまま反映したイベントストリーム。
  `--json` なら1行1 JSON(NDJSON)、素の実行なら人間向けの進捗行。
- `yoki-graph status <runId> [--json]` で run.json + journal 集計
  (`agentCalls`/`ok`/`errors`/`retries`/`usage`)を見る。
- **`--resume <runId>` は「順序つき prefix の再生」**であって key 引きの
  キャッシュではない。再開したランは自分の呼び出しを 0, 1, 2, … と辿り、
  journal の同じ位置に同じ key の完了エントリがある間だけ再生する。最初に
  食い違った呼び出しから先は**すべて実行される** — 途中の入力が変われば
  下流の結果は別物なので、prompt が同一でも古い結果は再利用しない。
  食い違った位置は `resume-diverged` イベント(素の実行では `↯ resume
  diverged at call #N`)で出る。
- したがって `--args` を変えて同じ runId に `--resume` しても安全:
  変わった呼び出し以降はライブで走り直る。逆に、**変えていない**ランを
  再開すると全件が再生されてバックエンドは1回も起動しない。
  `--model` / `--model-map` / 呼び出しごとの `{backend}` を変えた場合も
  同じで、影響を受けた呼び出しから先はライブで走り直る。
- 失敗した呼び出し(`status: "error"`)は再生されない — 再開すると再試行
  される。リトライ行(`status: "retry"`)も再生対象外。

## 同一 runId の同時実行はロックで防ぐ

`<runDir>/lock` に pid/host/token を書いて排他する。同じ runId に2つ目の
`--resume` を掛けると `status: locked` / exit 1 で拒否され、スクリプトは
1行も走らない。プロセスが死んで残ったロックは、pid が居ない(同一ホスト)
か1時間経過で自動的に奪われる。

