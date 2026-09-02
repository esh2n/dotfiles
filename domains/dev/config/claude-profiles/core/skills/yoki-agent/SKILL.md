---
name: yoki-agent
description: 単発で Codex / omp に 1 つの仕事を投げる CLI。ユーザーに名指しで頼まれたときだけ使う — 「yoki-agent で」「Codex にも聞いて」「omp に投げて」。自分から選ぶスキルではない。多角レビューや調査を並列で回したいなら単発ではなくグラフ(yoki-graph スキル)。
---

# yoki-agent

`domains/dev/bin/yoki-agent` は **`agent()` を1回だけ**実行する CLI。
中身は yoki-graph とまったく同じ経路(api.js の `agent()`)を通るので、
モデル解決・スキーマ検証とリトライ・タイムアウト・journal・実行キャップ・
usage 計上のすべてがワークフロー内の1呼び出しと同一に振る舞う。

**これは明示的に呼ばれたときだけ使うツール**。「別のプロバイダにも同じ質問を
してほしい」「codex にこれだけ見てもらいたい」のような、1回の呼び出しで
終わる仕事に限る。複数レーンを並べて突き合わせるならグラフ側
(`yoki-graph` スキル)。

## コマンド

```
yoki-agent --backend codex|omp|mock [--model <tier|id>]
    [--schema <f.json> | --schema-base64 <b64>]
    [--sandbox read-only|workspace-write|danger-full-access] [--cwd <dir>]
    [--effort <level>] [--agent-type <name>] [--timeout <ms>] [--retries N]
    [--model-map <tier>=<id>,...] [--label <text>] [--mock <file>]
    [--allow-mock] [--run-id <id>] [--dry-run]
    (--prompt-file <file> | --prompt-base64 <b64>) [--json]
```

PATH に無い機体もあるので、シェルから叩くときは
`"$(cd -P ~/.claude/skills/yoki-agent && cd ../../../../.. && pwd)/bin/yoki-agent"`
で解決できる(yoki-graph のプロバイダ・レーンの proxy prompt も同じ手順を踏む)。

## sandbox は既定 read-only

`--sandbox` の既定は **`read-only`**(codex 自身の既定と同じ)。書き込みが
要る呼び出しだけが `workspace-write` / `danger-full-access` を明示的に要求
する。未知の値は黙って広げずエラーになる。omp では read-only を
`--tools read,grep,glob,web_search` の許可リストで表現する。

## exit code

| code | 意味 |
| --- | --- |
| `0` | 成功 |
| `1` | 使い方の誤り — 必須フラグ欠落、**知らないフラグ**、prompt/schema が読めない or base64 として壊れている、未知の backend、綴りを間違えた tier、`^[A-Za-z0-9._:/-]{1,64}$` に合わない `--model` / `--backend` |
| `2` | バックエンド失敗 — spawn 失敗、非ゼロ終了、リトライ後のタイムアウト、キャップ超過 |
| `3` | リトライ後もスキーマを満たさなかった |

`--jsonn` のようなタイポは黙って無視されない。

## 出力とプロンプトの渡し方

- `--json` を付けると **stdout は結果 JSON だけ**(そのままパースできる)。
  解決後のモデル・トークン・cached・所要時間を1行にまとめたフッターは
  stderr に出る。付けない場合は結果もフッターも stdout。
- `--prompt-base64` / `--schema-base64` がレーンの実際の渡し方。payload は
  信用できないテキスト(diff・設計文書・取得したページ)で、呼び出し元は
  haiku の運搬 subagent なので、**payload が指示やシェル構文として読まれうる
  位置に置かれてはいけない**。base64 は argv が確定したあとで yoki-agent が
  復号するため、途中でだれも解釈しないし、一時ファイルも要らない(だから
  運搬役に書き込み権限が要らない)。
- `--run-id <既存>` で既存ランの journal に追記できる。`index` は既存の
  続きから振られ、フッターと exit code は**今回の呼び出しだけ**を報告する。

## `--allow-mock`

`YOKI_AGENT_MOCK=<fixture.json>` は **`--allow-mock` と併用したときだけ**
効き、要求された backend が何であれ mock に差し替わる(codex/omp が
入っていない機体でレーンの配線を試すため)。環境変数だけでは何も起きず、
無視したことを stderr に出す — レビュー対象リポジトリの `.envrc` や
検証の消し忘れ export が、別プロバイダのレビュー結果を差し替えられては
ならない(空の fixture は「codex は何も見つけなかった」と見分けがつかない)。
差し替えたときはフッターに `backend=mock (requested codex)` が出るうえ、
**stdout の結果自体に `"_mock": true` が付く**(フッターは stderr なので
`--json` の呼び出し元には届かない)。

## 日次キャップは消費しない

`workflow-guard.sh` と共有するワークフロー起動カウンタは減らない。codex
レーンを6本持つ review 1本は「ワークフロー起動1回」であって7回ではない。
ラン単位の実行キャップ(`graphMaxAgentCalls` など)は従来どおり効く。
