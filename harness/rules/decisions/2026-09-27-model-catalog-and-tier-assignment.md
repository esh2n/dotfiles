# tierの中身は候補の一覧から選び、一行で切り替える

Status: accepted — 持ち主の裁定（2026-09-27）。要件: mainとcomplexのモデルを実際に使いながら切り替えられ、今後別のモデルに替えることも考えた設計にする。`2026-09-23-model-routing-per-harness.md`を置き換える。ベンダー製ハーネスは自社モデル、それ以外はLiteLLMのtierだけ、という部分はそのまま引き継ぎ、「tier → モデルは`litellm/config.yaml`で一度だけ決める」を変える

rule: Claude Code runs Claude models and Codex runs OpenAI's; every other harness (pi, DSH, omp) sends all model calls through the local LiteLLM proxy at `localhost:4000` using only the tier names `main` (everyday), `complex` (escalation) and `executor` (the executor of a designed plan), never a provider directly. Every model a tier may use is one entry in the catalog `harness/policy/models.json` (provider, model, key reference, LiteLLM params); `harness/policy/tiers.json` only names catalog ids per tier (`use`, in LiteLLM order), and jig generates the tiers' block of `litellm/config.yaml` from the two — never edit that block by hand. Switch a tier with `dotctl llm use <tier> <model>...`; a new model is one catalog entry plus its key in 1Password. A harness that silently falls back to another provider when its default's auth fails is a defect to fix, not a state to leave.
scope: repo

## Problem

MiMo（Xiaomi）を`main`と`complex`で実際に使ってDeepSeekと比べる。これからも別のモデルが出るたびに試す。ところがtierの中身は、`harness/policy/tiers.json`の`backend`と、手で書いた`litellm/config.yaml`の二か所に書かれていて、切り替えるには両方を直してLiteLLMを再起動する必要があった。LiteLLMの鍵も`litellm-up.sh`にプロバイダごとに書いてあり、新しいプロバイダのたびにスクリプトを直していた。

## Decision

- **候補の一覧`harness/policy/models.json`。** 使うかもしれないモデルを1件ずつ: LiteLLMのプロバイダ、モデル名、APIの場所（環境変数の名前）、鍵の場所（`op://`の参照と、入れる環境変数の名前）、LiteLLMに渡す追加の設定（`litellmParams`、`modelInfo`）、注意書き（`notes`）。鍵そのものは書かない（`keyRef`は`op://`でなければjigが拒む）。
- **tierの表`tiers.json`は割り当てだけ。** 各tierの`use`が候補のIDの並び。二つ以上ならLiteLLMの`order`の順（1番目が答え、落ちているときだけ次）。tierの名前、ハーネスが使う文脈の予算、サンプリングは今のままtierの側。
- **`litellm/config.yaml`のtierの部分は生成。** `# BEGIN jig:tiers`と`# END jig:tiers`の間を、`jig apply --write`が二つのファイルから書く（DSH・ompと同じ仕組み）。これまでの「LiteLLMは書かずに見せるだけ」はやめる。
- **切り替えは一行。** `dotctl llm use <tier> <model>...`が、`jig tiers use`（割り当ての書き換え、一覧に無いIDは拒む）→ `jig apply --target all --write`（生成）→ LiteLLMの再起動を順に行う。今の割り当ては`jig tiers`で見る。
- **鍵は一覧から読む。** `litellm-up.sh`は一覧の`keyRef`を順に読み、`apiKeyEnv`に入れて名前だけをコンテナに渡す。読めない鍵があっても起動は止めず、その鍵を使うモデルだけが失敗する。
- **今の割り当て。** `main` ← `deepseek-flash`、`complex` ← `deepseek-v4-pro`、`executor` ← `qwen3.8-27b-linux` → `qwen3.8-27b-mac`（`2026-09-27-deterministic-falls-back-to-the-mac.md`）。一覧にはMiMoの`mimo-v2.6-flash`と`mimo-v2.6-pro`も入れた（値段は、固定しているLiteLLMがV2.6を知らないので`modelInfo`に書いた）。

## Alternatives considered

- **LiteLLMの`model_group_alias`でtierを別名にする**: 設定項目としては今もあり（`docs/proxy/config_settings.md`）、config.yamlから無視される不具合（#15020）は2025-10に閉じている。ただ、別名にしたtierが`/v1/models`の一覧に出るかがdocsに書かれておらず、出なければ`dotctl llm check`とハーネスのモデル一覧がtierを見つけられない。採らない。
- **tierごとに候補を全部config.yamlに並べ、`order`で使うものを先頭にする**: 切り替えが順番の入れ替えになるが、使わないモデルへ黙って落ちる（fallbackの失敗例、gke-labs/kube-agents #2023）。却下。
- **config.yamlを手で直し続ける**: 二か所の手直しと再起動を毎回やることになり、試す回数が減る。却下。
- **dotctl（Go）でconfig.yamlを生成する**: ハーネスごとの変換はjigの中に置く、という決定（`2026-09-24-harness-top-level-dir.md`）と、既存のjigの生成器・印の仕組みを外れる。却下。

## Consequences

- MiMoを試す: `dotctl llm use main mimo-v2.6-flash`、戻す: `dotctl llm use main deepseek-flash`。MiMoは、ツールを使う複数ターンで前の返答の`reasoning_content`を送り返さないとAPIが拒む。ハーネスがそれをするかは未確認で、使ってみて引っかかったらここで対処する。
- 切り替えは`tiers.json`、`config.yaml`、pi・DSHの設定（表示名）を書き換えるので、リポジトリに差分が出る。試した結果を残すならコミットする。
- `dotctl llm check`はtierの名前で確かめるので変わらない。Grafanaのモデル別の表で、どのモデルが答えたかが分かる。
- 固定しているLiteLLM（v1.103.0-rc.1）が`xiaomi_mimo/`のV2.6を正しく扱うかは、実際に切り替えるまで確かめていない。

## Sources

- MiMoは複数ターンのツール呼び出しで前の`reasoning_content`を送り返さないとAPIが拒否する（LiteLLM公式、day-0対応）: https://docs.litellm.ai/docs/providers/xiaomi_mimo
- MiMo-V2.6-ProとDeepSeekの独立測定（知能指数・速度）: https://artificialanalysis.ai/models/mimo-v2-6-pro
- https://github.com/BerriAI/litellm/issues/15020
- https://github.com/gke-labs/kube-agents/issues/2023
