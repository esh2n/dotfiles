# executorはOmarchy機が止まっている間だけMacの同じモデルへ落ちる

Status: accepted — 持ち主の裁定（2026-09-27）。要件: Omarchy機が止まっていてもexecutorの作業が失敗しないこと、普段は空いているMacで別の大きいモデルを動かせること。`2026-09-26-deterministic-on-the-gpu.md`を置き換える。executorの定義（計画の実行役）、主の置き場所（Omarchy機のllama-server、Qwen3.8-27B Q4_K_M、65,536文脈、スロット1、Qwenの推奨サンプリング）はそのまま引き継ぎ、「どこへもfallbackしない」だけを変える。tier名は`2026-10-19-model-assignment.md`で`deterministic`から`executor`に改めた（本文のtier名もそれに合わせた）

rule: The `executor` tier is the executor: it carries out a plan that a frontier or higher-benchmark model (`complex`, Claude, Codex) already designed; it is not a tier for bit-identical output. It has two deployments of the same model, Qwen3.8-27B, under one LiteLLM `model_name`: `order: 1` is the Omarchy desktop's `llama-server` (24 GB GPU, 4-bit, one slot with a 65,536-token context, Qwen's recommended sampling), the only deployment LiteLLM health-checks in the background (`enable_health_check_routing`, every 60 s, `cooldown_time` 90); `order: 2` is the Mac's LM Studio (`qwen/qwen3.8-27b@4bit`, loaded just in time with a 600 s `ttl`, `disable_background_health_check: true`), used only while the desktop is out of the pool. Never fall back to a different model. The Mac's own larger model must be JIT-loaded too, so LM Studio's auto-evict swaps it out; whether a fallback happened is read from the `x-litellm-model-api-base` header and `litellm_deployment_success_responses` by `api_base`.
scope: repo

## Problem

09-26の記録は、Omarchy機が止まっている間executorを「使えない」にした。Omarchy機は止まっていることが多く、Macで作業している間にexecutorの作業が失敗する。一方で、普段は空いているMacでは別の大きいモデルを動かす。

## Decision

- **一つの名前に、同じモデルの行き先を二つ並べる。** LiteLLMの`order`で、1がOmarchy機のllama-server、2がMacのLM Studio。docs: "When a request to an `order=1` deployment fails (connection error, 404, 429, etc.), the router automatically tries `order=2` deployments"。
- **落ちる先は同じQwen3.8-27B（MLX 4bit）。** 別のモデルへ黙って落ちると、ツール呼び出しの中身だけが壊れて気づけない（gke-labs/kube-agents #2023: "the silent degrade cost hours of diagnosis"）。同じモデルなら、遅くなるだけで振る舞いは変わらない。Macの速さは4bitで15.0 tok/s、最初の応答まで約1.5秒（`home/shared/litellm/config/bench/report.md`の実測。8bitは約9）。
- **止まっているOmarchy機は要求の前に外す。** LiteLLMの`enable_health_check_routing`で、裏の確認（60秒ごと）が失敗した行き先を外す。`cooldown_time`は確認の間隔より長い90秒（docsが明記する条件）。確認するのはexecutorのOmarchy機の行き先だけ（`background_health_check_model_groups`と`disable_background_health_check`）。確認は毎回本物の生成を走らせるので、Macに当てるとQwenが常に読み込まれ、クラウドに当てると課金される。
- **Macは普段、別の大きいモデルを動かしてよい。** LM StudioはJITで読み込んだモデルを同時に一つしか置かない（Auto-Evict）。落ちてきた要求でQwenが読み込まれると大きいモデルは下ろされ、Qwenは600秒使われなければ下ろされる。そのため大きいモデルもJITで読み込む（`lms load`で常駐させると両方が載ってメモリが足りなくなる）。
- **落ちたことを見えるようにする。** 応答ヘッダ`x-litellm-model-api-base`と、Grafanaの「executorの行き先の状態」「executor: どちらが答えたか」（`litellm_deployment_state`と、`api_base`ごとの`litellm_deployment_success_responses`。同じ名前の中の`order`の切り替えは、別の名前へ回す`fallbacks`用の`litellm_deployment_successful_fallbacks`では数えられない恐れがある）。

## Alternatives considered

- **fallbackしない（09-26の形）**: Macで作業している間にdeterministicが失敗する。持ち主が退けた。
- **Macに常にQwenを載せておく**: 待ち時間はなくなるが、Macで別の大きいモデルを動かせない（64GBに大きいモデルと15GBのQwenは並ばない）。
- **クラウドのモデル（mainのDeepSeekなど）へ落とす**: 速いが別のモデルで、黙って振る舞いが変わる（#2023の型）うえに課金される。却下。
- **別の名前（`deterministic-mac`など）へ`fallbacks`で回す**: ヘッダで区別しやすいが、tier名が二つになる。一つの名前の中で`order`を使う方がdocsの素直な形。却下。
- **裏の確認なし**: Omarchy機が止まった直後の要求が一度`timeout`まで待たされる。却下。

## Consequences

- 持ち主の手作業: Omarchy機以外の機械の役割ファイルに、Macのtailnet名`macModelHost`を書く（Mac自身は要らない）。Macの大きいモデルはJITで読み込む（どのモデルにするかは、64GBに載る候補の調査のあとに決める）。
- 最初の一回はLM Studioの読み込みで待つ（15GBの秒数は未測定）。Macで大きいモデルを使っている最中に落ちてくると、大きいモデルは一度下ろされる。
- LM StudioのAPIは`qwen/qwen3.8-27b@4bit`という名前で答える（benchの実測で使った名前）。`dotctl llm check`が、LM Studioの一覧にこの名前があるかを確かめる。
- LiteLLMの`extra_body.ttl`がLM Studioまで届くかは未確認。
- 固定しているLiteLLMはv1.103.0-rc.1（プレリリース）。`enable_health_check_routing`はこの世代のdocsで新設された。
- Omarchy機の側の既知の不具合（#27733、#27623、#21383）は`2026-09-26-deterministic-on-the-gpu.md`のとおり。

## Sources

- Qwen3.6-27B denseの同世代GPUでの実測（70〜90 tok/s、Mac側4bit 15.0 tok/sと比べる根拠）: https://sanj.dev/post/qwen-3-6-27b-dual-rtx-3090-llama-cpp-tuning/
- Qwen3.6-35B-A3B（MoE）の実測: https://aminrj.com/posts/llamacpp-qwen36-35b/
- https://github.com/gke-labs/kube-agents/issues/2023
- https://lmstudio.ai/docs/app/api/ttl-and-auto-evict
