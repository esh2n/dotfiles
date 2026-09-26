---
question: "deterministic（Omarchy 機の llama-server）が止まっているとき、LiteLLM でどう Mac などへフォールバックさせるか。切り替えの速さ、起きたことの見え方、フォールバック先の候補（Mac の同じ Qwen3.8-27B か、クラウドか）、失敗例。"
date: 2026-09-26
verdict: "型は二つ: 同じ model_name に二つの行き先を並べて litellm_params.order で優先順位を付ける（'When a request to an order=1 deployment fails (connection error, 404, 429, etc.), the router automatically tries order=2 deployments'）か、router_settings.fallbacks で別の model_name へ回す。一つの tier 名を保つなら order が素直。固定している LiteLLM は v1.103.0-rc.1（2026-09-20、プレリリース）で、この世代の docs に新設された enable_health_check_routing を使うと、裏のヘルスチェックが落ちた行き先を要求の前に外す（既定 false、interval 既定 300 秒、cooldown_time は interval より長くしないと効かない）。ヘルスチェックは毎回 /chat/completions を実際に叩く（既定 16 トークン）。どちらが答えたかは応答ヘッダ x-litellm-model-api-base / x-litellm-model-id と Prometheus の litellm_deployment_successful_fallbacks・litellm_deployment_state で分かり、応答本文の model では分からない。最も重い失敗例は、弱いモデルへの黙ったフォールバックがツール呼び出しの中身だけを壊し、診断に何時間もかかった実測（gke-labs/kube-agents #2023、36 件 / 1,195 件）。Mac の Qwen3.8-27B は M4 Pro で Q4_K_M が 14 tok/s（コミュニティ集計、Ollama）、以前の約 9 tok/s は 8bit の上限（273GB/s ÷ 28GB）と一致する。"
unverified:
  - 電源の落ちた機械へ tailnet 越しにつないだときの失敗の仕方（即時の拒否か、名前が引けないか、TCP のタイムアウトまで待つか）と待ち時間
  - LiteLLM #40405（単一デプロイ + fallback は cooldown されない）の現在の状態
  - Qwen3.8-27B の MLX 4bit / 8bit の M4 Pro での実測（GGUF の 14 tok/s のみ）
  - LM Studio が 15GB / 28GB を JIT で読み込む秒数
  - ヘルスチェックが毎回生成を走らせることの、llama-server と LM Studio の常駐メモリへの影響
  - ローカルからクラウドへ落ちたときの切り替えの遅さと費用の実測
---

# deterministic のフォールバック

前提: `2026-09-24-two-host-home-llm.md`（order と fallback、#40405、#7779）と `rules/decisions/2026-09-26-deterministic-on-the-gpu.md`。LiteLLM の docs は 2026 年に別リポジトリ `BerriAI/litellm-docs` へ移っており、原文はそこから取得した。認証情報は使っていない（GitHub の code search は未到達）。

## 固定している LiteLLM の版

`sha256:114aca77…` は `v1.103.0-rc.1`（`"prerelease": true`、2026-09-20）。stable は v1.102.0（09-22）と v1.102.1（09-23、`latest`）。出典: `https://ghcr.io/v2/berriai/litellm/manifests/v1.103.0-rc.1`、`https://api.github.com/repos/BerriAI/litellm/releases/tags/v1.103.0-rc.1`。

## ベンダー（LiteLLM docs の原文）

`docs/routing.md`:
- "Set `order` in `litellm_params` to prioritize deployments. Lower values = higher priority."
- "When a request to an `order=1` deployment fails (connection error, 404, 429, etc.), the router automatically tries `order=2` deployments, then `order=3`, and so on. Each order level gets its own set of retries before escalating to the next. If all order levels are exhausted, the router falls through to any configured fallbacks."
- cooldown の既定は `allowed_fails: 3`・`cooldown_time: 5s`。"`allowed_fails` must be set under `model_info`, not `litellm_params`"。cooldown の条件表に 429、直近 1 分の失敗率 50% 超、401・404・408。
- `enable_weighted_failover`: 同じグループ内を試してから別グループへ。"If the same group also uses `order`, the order filter runs before the weighted pick."

`docs/proxy/reliability.md`: `router_settings.fallbacks: [{"openai_small": ["openai_large"]}]`、"Fallbacks are done in-order"。v1.85.0 から Proxy 経由の `mock_testing_fallbacks` は無効で、フォールバックは本当の障害でしか試せない。

`docs/proxy/timeout.md`: "`timeout` → maximum time for the complete response."、"`stream_timeout` → maximum time to wait for the first chunk"。接続の確立だけのタイムアウトは無い。

`docs/proxy/health_check_routing.md`（新設）:
- "By default, LiteLLM routes traffic to all deployments and only stops sending to a broken one after it has already failed a user request. The cooldown system is reactive."
- "Health check driven routing makes this proactive: a background loop pings every deployment on a configurable interval. If a deployment fails its health check, it gets removed from the routing pool immediately, before a user request lands on it."
- 設定: `general_settings.background_health_checks`・`health_check_interval`（既定 300）・`enable_health_check_routing`（既定 false）・`health_check_ignore_transient_errors`。"If `cooldown_time` is shorter than `health_check_interval`, the counter resets between every check cycle and failures never accumulate."

`docs/proxy/health.md`: "It runs a real test request against every configured model, so it costs a few tokens per model."、`health_check_max_tokens` 既定 16、`health_check_timeout` 既定 60 秒。llama-server 自身の軽い `/health` を使う経路はない。

`docs/proxy/response_headers.md`: `x-litellm-model-id`（"Deployment id"）、`x-litellm-model-api-base`、`x-litellm-model-group`、`x-litellm-attempted-fallbacks`。応答本文の `model` は "Often restamped to match the client"。

`docs/proxy/prometheus.md`: `litellm_deployment_cooled_down`、`litellm_deployment_successful_fallbacks`、`litellm_deployment_failed_fallbacks`、`litellm_deployment_state`（"0 = healthy, 1 = partial outage, 2 = complete outage"）。

## 実践者

- Steve Scargall（https://stevescargall.com/blog/2026/04/run-free-llms-at-scale-litellm-gateway-with-groq-nvidia-nim-openrouter-and-local-vllm/ ）: ローカル vLLM からクラウド 4 社への `fallbacks`、`cooldown_time: 86400`（一度落ちると丸一日戻らない）。切り替えの遅さと費用の数値はなし。
- AlexsJones（https://gist.github.com/AlexsJones/2be576db3ccc61724c0c4059d4f4df7f ）: Tailscale + llama-server 一台、フォールバックの言及なし。

## 測定

- gke-labs/kube-agents #2023（https://github.com/gke-labs/kube-agents/issues/2023 、open）: `default_fallbacks` で 2B 級へ落ちたターンが "silently routed that turn to the 2B-class fallback, mid-conversation, with no signal to the agent, the run record, or the operator."。"36 agent requests served by the fallback deployment ... against ~1,195 served by the primary"。ツール呼び出しに "literal schema placeholders" が入り、"A hard error would have been retried at the run level and cost minutes; the silent degrade cost hours of diagnosis."
- LiteLLM #23546（closed）: フォールバックの連鎖で無限リトライ。#32353（open）: 例外文字列の正規表現でイベントループが止まり 26 時間以上クラッシュを繰り返した。

Apple Silicon:

| 出典 | 機械 | 量子化 | tok/s |
|---|---|---|---|
| llmcheck.net/benchmarks | M4 Pro 48GB | Qwen3.8-27B Q4_K_M（Ollama） | 14 |
| thomas-wiegold.com | M4 Mac mini 32GB（約 120GB/s） | MLX 4bit | 5〜6 |
| zachrattner.com（M1 Ultra 800GB/s、M4 Pro ではない） | M1 Ultra | Qwen3.8-27B 4bit: MLX 27.5〜30.9 / Ollama 19.0〜22.4、8bit: MLX 18.1〜19.5 / Ollama 19.1〜20.4 | — |
| siliconscore.com | M4 Pro 24GB | Qwen3.6-35B-A3B Q4_K_M | 32 |

検索の要約が zachrattner の測定を M4 Pro と取り違えていたのを、本文で確かめて訂正した。

LM Studio（https://lmstudio.ai/docs/app/api/ttl-and-auto-evict ）: "By default, JIT-loaded models have a TTL of 60 minutes."、JIT で読み込むと同時に置くのは 1 モデルまで。読み込みの秒数の一次資料はない。

## この記録で言えること

- 一つの tier 名（`deterministic`）を保つなら、同じ `model_name` に Omarchy 機（`order: 1`）と Mac（`order: 2`）を並べる形が docs の素直な書き方。
- 黙ったフォールバックの最大の害は、弱いモデルに替わってツール呼び出しの中身が壊れること。フォールバック先を同じモデル（Qwen3.8-27B）にすればこの害は小さく、起きたことは応答ヘッダと Prometheus で見える。
- Mac の Qwen3.8-27B は 4bit なら 11〜14 tok/s 程度の見込み（8bit は約 9）。MLX での実測はない。
- 止まっている機械を要求の前に外すには `enable_health_check_routing` が要る。無ければ、止まった直後の要求が一度 `timeout` まで待たされる。ヘルスチェックは毎回本物の生成を走らせる。

## 追補: Mac の MLX 4bit の実測（2026-09-27、手元の記録）

`home/shared/litellm/config/bench/report.md`（このリポジトリの A/B、LM Studio、温度 0、runs 2）に、M4 Pro での `qwen/qwen3.8-27b@4bit` の実測がある: 平均 TTFT 1548 ms、平均 decode 15.0 tok/s、読み込み後の重み 16.08 GB、自動採点 10/10。上の「MLX での M4 Pro の実測は見つからない」はこれで埋まる。LM Studio の API はこの `qwen/qwen3.8-27b@4bit` という名前で答える。
