# yoki-graph — モデル解決と `--model-map`

> [SKILL.md](../SKILL.md) の詳細編。

## モデルの指定と表示

優先順は **呼び出しごとの `agent({model})` > run の `--model` > バックエンド
既定**。tier(`haiku`/`sonnet`/`opus`、omp の `review`/`scout`)は
`core/harness-models.json` で実 ID に解決され、`gpt-5.5` のような具体的な
ID はそのまま通る。

- **存在しない tier はエラー**(有効な tier を並べて拒否)。以前は素通りして
  `codex -m sonnett` が typo から遠い場所で落ちていた。
- `--model-map haiku=gpt-5.4-mini,sonnet=gpt-5.5` でその run だけ上書き
  (ファイルに無い tier を足すこともできる)。
- 進捗行・journal・`--json` イベント・`status` はすべて**解決後の ID**を出す:
  `→ review:security (codex gpt-5.6-sol) [Review]`。`--model-map` や
  呼び出しごとの `model` が絡むと "sonnet" という表示は何も特定しないため。
- ラン終了時にモデル別の表(calls / tokens / cached / wall)が出る。
  `run.json` にも入るので `yoki-graph status <runId>` で後から同じ表を見られる。
  行のキーは **backend + 解決後の ID**。backend 列は複数 backend を混ぜた
  ランでだけ出る(単一 backend のランの表は従来どおり)。表と usage 行は
  **JSON の result より前**に出る — result は数千行になり得るので、後ろに
  置くと TTY では流れ、リダイレクトしたログでは最下部に埋もれるため。
- `cached` は「入力のうちキャッシュから供給された分」。**`tokens` には
  足さない**。codex の `cached_input_tokens` は `input_tokens` の
  部分集合(足すと二重計上 — 実際に 4.1M のランが 7.46M と報告された)、
  omp の `cacheRead` は `input` と互いに素でレコード自身の `totalTokens` に
  既に含まれる。向きが逆なので backend ごとに扱いを変えている。

