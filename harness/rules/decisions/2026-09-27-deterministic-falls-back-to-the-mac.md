# deterministic は Omarchy 機が止まっている間だけ Mac の同じモデルへ落ちる

Status: accepted — 持ち主の裁定（2026-09-27）。要件: Omarchy 機が止まっていても deterministic の作業が失敗しないこと、普段は空いている Mac で別の大きいモデルを動かせること。`2026-09-26-deterministic-on-the-gpu.md` を置き換える。deterministic の定義（計画の実行役）、主の置き場所（Omarchy 機の llama-server、Qwen3.8-27B Q4_K_M、65,536 文脈、スロット 1、Qwen の推奨サンプリング）はそのまま引き継ぎ、「どこへも fallback しない」だけを変える

rule: The `deterministic` tier is the executor: it carries out a plan that a frontier or higher-benchmark model (`complex`, Claude, Codex) already designed; it is not a tier for bit-identical output. It has two deployments of the same model, Qwen3.8-27B, under one LiteLLM `model_name`: `order: 1` is the Omarchy desktop's `llama-server` (24 GB GPU, 4-bit, one slot with a 65,536-token context, Qwen's recommended sampling), the only deployment LiteLLM health-checks in the background (`enable_health_check_routing`, every 60 s, `cooldown_time` 90); `order: 2` is the Mac's LM Studio (`qwen/qwen3.8-27b@4bit`, loaded just in time with a 600 s `ttl`, `disable_background_health_check: true`), used only while the desktop is out of the pool. Never fall back to a different model. The Mac's own larger model must be JIT-loaded too, so LM Studio's auto-evict swaps it out; whether a fallback happened is read from the `x-litellm-model-api-base` header and `litellm_deployment_success_responses` by `api_base`.

## Problem

09-26 の記録は、Omarchy 機が止まっている間 deterministic を「使えない」にした。Omarchy 機は止まっていることが多く、Mac で作業している間に deterministic の作業が失敗する。一方で、普段は空いている Mac では別の大きいモデルを動かす。

## Decision

- **一つの名前に、同じモデルの行き先を二つ並べる。** LiteLLM の `order` で、1 が Omarchy 機の llama-server、2 が Mac の LM Studio。docs: "When a request to an `order=1` deployment fails (connection error, 404, 429, etc.), the router automatically tries `order=2` deployments"。
- **落ちる先は同じ Qwen3.8-27B（MLX 4bit）。** 別のモデルへ黙って落ちると、ツール呼び出しの中身だけが壊れて気づけない（gke-labs/kube-agents #2023: "the silent degrade cost hours of diagnosis"）。同じモデルなら、遅くなるだけで振る舞いは変わらない。Mac の速さは 4bit で 15.0 tok/s、最初の応答まで約 1.5 秒（`home/shared/litellm/config/bench/report.md` の実測。8bit は約 9）。
- **止まっている Omarchy 機は要求の前に外す。** LiteLLM の `enable_health_check_routing` で、裏の確認（60 秒ごと）が失敗した行き先を外す。`cooldown_time` は確認の間隔より長い 90 秒（docs が明記する条件）。確認するのは deterministic の Omarchy 機の行き先だけ（`background_health_check_model_groups` と `disable_background_health_check`）。確認は毎回本物の生成を走らせるので、Mac に当てると Qwen が常に読み込まれ、クラウドに当てると課金される。
- **Mac は普段、別の大きいモデルを動かしてよい。** LM Studio は JIT で読み込んだモデルを同時に一つしか置かない（Auto-Evict）。落ちてきた要求で Qwen が読み込まれると大きいモデルは下ろされ、Qwen は 600 秒使われなければ下ろされる。そのため大きいモデルも JIT で読み込む（`lms load` で常駐させると両方が載ってメモリが足りなくなる）。
- **落ちたことを見えるようにする。** 応答ヘッダ `x-litellm-model-api-base` と、Grafana の「deterministic の行き先の状態」「deterministic: どちらが答えたか」（`litellm_deployment_state` と、`api_base` ごとの `litellm_deployment_success_responses`。同じ名前の中の `order` の切り替えは、別の名前へ回す `fallbacks` 用の `litellm_deployment_successful_fallbacks` では数えられない恐れがある）。

## Alternatives considered

- **fallback しない（09-26 の形）**: Mac で作業している間に deterministic が失敗する。持ち主が退けた。
- **Mac に常に Qwen を載せておく**: 待ち時間はなくなるが、Mac で別の大きいモデルを動かせない（64GB に大きいモデルと 15GB の Qwen は並ばない）。
- **クラウドのモデル（main の DeepSeek など）へ落とす**: 速いが別のモデルで、黙って振る舞いが変わる（#2023 の型）うえに課金される。却下。
- **別の名前（`deterministic-mac` など）へ `fallbacks` で回す**: ヘッダで区別しやすいが、tier 名が二つになる。一つの名前の中で `order` を使う方が docs の素直な形。却下。
- **裏の確認なし**: Omarchy 機が止まった直後の要求が一度 `timeout` まで待たされる。却下。

## Consequences

- 持ち主の手作業: Omarchy 機以外の機械の役割ファイルに、Mac の tailnet 名 `macModelHost` を書く（Mac 自身は要らない）。Mac の大きいモデルは JIT で読み込む（どのモデルにするかは、64GB に載る候補の調査のあとに決める）。
- 最初の一回は LM Studio の読み込みで待つ（15GB の秒数は未測定）。Mac で大きいモデルを使っている最中に落ちてくると、大きいモデルは一度下ろされる。
- LM Studio の API は `qwen/qwen3.8-27b@4bit` という名前で答える（bench の実測で使った名前）。`dotctl llm check` が、LM Studio の一覧にこの名前があるかを確かめる。
- LiteLLM の `extra_body.ttl` が LM Studio まで届くかは未確認。
- 固定している LiteLLM は v1.103.0-rc.1（プレリリース）。`enable_health_check_routing` はこの世代の docs で新設された。
- Omarchy 機の側の既知の不具合（#27733、#27623、#21383）は `2026-09-26-deterministic-on-the-gpu.md` のとおり。

## Sources

- `rules/research/2026-09-26-deterministic-fallback.md`
- `rules/research/2026-09-26-omarchy-3090ti-model-choice.md`
- https://github.com/gke-labs/kube-agents/issues/2023
- https://lmstudio.ai/docs/app/api/ttl-and-auto-evict
