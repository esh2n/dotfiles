# tier の中身は候補の一覧から選び、一行で切り替える

Status: accepted — 持ち主の裁定（2026-09-27、「main も complex も実際に私が使ってみて考えたほうがいい、とりあえずは deepseek でもいいけど切り替えられるようになってるんだっけ」「今後別のモデルになることも考えた設計になるべき」への提案に「はい」）。`2026-09-23-model-routing-per-harness.md` を置き換える。ベンダー製ハーネスは自社モデル、それ以外は LiteLLM の tier だけ、という部分はそのまま引き継ぎ、「tier → モデルは `litellm/config.yaml` で一度だけ決める」を変える

rule: Claude Code runs Claude models and Codex runs OpenAI's; every other harness (pi, DSH, omp) sends all model calls through the local LiteLLM proxy at `localhost:4000` using only the tier names `main` (everyday), `complex` (escalation) and `deterministic` (the executor of a designed plan), never a provider directly. Every model a tier may use is one entry in the catalog `harness/policy/models.json` (provider, model, key reference, LiteLLM params); `harness/policy/tiers.json` only names catalog ids per tier (`use`, in LiteLLM order), and jig generates the tiers' block of `litellm/config.yaml` from the two — never edit that block by hand. Switch a tier with `dotctl llm use <tier> <model>...`; a new model is one catalog entry plus its key in 1Password. A harness that silently falls back to another provider when its default's auth fails is a defect to fix, not a state to leave.

## Problem

持ち主は、MiMo（Xiaomi）を `main` と `complex` で実際に使って DeepSeek と比べたい。これからも別のモデルが出るたびに試したい。ところが tier の中身は、`harness/policy/tiers.json` の `backend` と、手で書いた `litellm/config.yaml` の二か所に書かれていて、切り替えるには両方を直して LiteLLM を再起動する必要があった。LiteLLM の鍵も `litellm-up.sh` にプロバイダごとに書いてあり、新しいプロバイダのたびにスクリプトを直していた。

## Decision

- **候補の一覧 `harness/policy/models.json`。** 使うかもしれないモデルを 1 件ずつ: LiteLLM のプロバイダ、モデル名、API の場所（環境変数の名前）、鍵の場所（`op://` の参照と、入れる環境変数の名前）、LiteLLM に渡す追加の設定（`litellmParams`、`modelInfo`）、注意書き（`notes`）。鍵そのものは書かない（`keyRef` は `op://` でなければ jig が拒む）。
- **tier の表 `tiers.json` は割り当てだけ。** 各 tier の `use` が候補の ID の並び。二つ以上なら LiteLLM の `order` の順（1 番目が答え、落ちているときだけ次）。tier の名前、ハーネスが使う文脈の予算、サンプリングは今のまま tier の側。
- **`litellm/config.yaml` の tier の部分は生成。** `# BEGIN jig:tiers` と `# END jig:tiers` の間を、`jig apply --write` が二つのファイルから書く（DSH・omp と同じ仕組み）。これまでの「LiteLLM は書かずに見せるだけ」はやめる。
- **切り替えは一行。** `dotctl llm use <tier> <model>...` が、`jig tiers use`（割り当ての書き換え、一覧に無い ID は拒む）→ `jig apply --target all --write`（生成）→ LiteLLM の再起動を順に行う。今の割り当ては `jig tiers` で見る。
- **鍵は一覧から読む。** `litellm-up.sh` は一覧の `keyRef` を順に読み、`apiKeyEnv` に入れて名前だけをコンテナに渡す。読めない鍵があっても起動は止めず、その鍵を使うモデルだけが失敗する。
- **今の割り当て。** `main` ← `deepseek-flash`、`complex` ← `deepseek-v4-pro`、`deterministic` ← `qwen3.8-27b-linux` → `qwen3.8-27b-mac`（`2026-09-27-deterministic-falls-back-to-the-mac.md`）。一覧には MiMo の `mimo-v2.6-flash` と `mimo-v2.6-pro` も入れた（値段は、固定している LiteLLM が V2.6 を知らないので `modelInfo` に書いた）。

## Alternatives considered

- **LiteLLM の `model_group_alias` で tier を別名にする**: 設定項目としては今もあり（`docs/proxy/config_settings.md`）、config.yaml から無視される不具合（#15020）は 2025-10 に閉じている。ただ、別名にした tier が `/v1/models` の一覧に出るかが docs に書かれておらず、出なければ `dotctl llm check` とハーネスのモデル一覧が tier を見つけられない。採らない。
- **tier ごとに候補を全部 config.yaml に並べ、`order` で使うものを先頭にする**: 切り替えが順番の入れ替えになるが、使わないモデルへ黙って落ちる（fallback の失敗例、gke-labs/kube-agents #2023）。却下。
- **config.yaml を手で直し続ける**: 二か所の手直しと再起動を毎回やることになり、持ち主が試す回数が減る。却下。
- **dotctl（Go）で config.yaml を生成する**: ハーネスごとの変換は jig の中に置く、という決定（`2026-09-24-harness-top-level-dir.md`）と、既存の jig の生成器・印の仕組みを外れる。却下。

## Consequences

- MiMo を試す: `dotctl llm use main mimo-v2.6-flash`、戻す: `dotctl llm use main deepseek-flash`。MiMo は、ツールを使う複数ターンで前の返答の `reasoning_content` を送り返さないと API が拒む。ハーネスがそれをするかは未確認で、使ってみて引っかかったらここで対処する。
- 切り替えは `tiers.json`、`config.yaml`、pi・DSH の設定（表示名）を書き換えるので、リポジトリに差分が出る。試した結果を残すならコミットする。
- `dotctl llm check` は tier の名前で確かめるので変わらない。Grafana のモデル別の表で、どのモデルが答えたかが分かる。
- 固定している LiteLLM（v1.103.0-rc.1）が `xiaomi_mimo/` の V2.6 を正しく扱うかは、実際に切り替えるまで確かめていない。

## Sources

- `rules/research/2026-09-26-mimo-vs-deepseek.md`
- `rules/research/2026-09-26-deterministic-fallback.md`
- https://github.com/BerriAI/litellm/issues/15020
- https://github.com/gke-labs/kube-agents/issues/2023
