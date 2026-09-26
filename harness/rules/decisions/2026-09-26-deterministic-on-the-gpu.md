# deterministic を Omarchy 機の GPU（Qwen3.8-27B）へ移す

Status: accepted — 持ち主の裁定（2026-09-26、「決定的を gpu に置きたい」「moe のやつよりも 3.8 の方がいい」）。`2026-09-24-home-llm-second-host-omarchy-llama-server.md` を置き換える。deterministic の置き場所を変え、Omarchy 機のモデルを決める。llama-server の router mode、用途名で載せること、別モデルへの fallback を置かないこと、`allowed_fails: 1` + `cooldown_time: 30` はそのまま引き継ぐ

rule: The `deterministic` tier is served by the Omarchy desktop's `llama-server` (RTX 3090 Ti, Qwen3.8-27B at 4-bit) with temperature 0, a fixed seed and one slot, and never falls back to another machine or model: while the desktop is off or booted into Windows, `deterministic` answers "unavailable". The same model also serves `agent-gpu` (coding and Japanese prose, normal sampling). `llama-server` runs in router mode as a systemd user service with `--api-key`, exposed on the tailnet with one `tailscale serve` TCP port; every machine's LiteLLM lists its models under purpose names with `allowed_fails: 1` + `cooldown_time: 30`, chosen explicitly per session.

## Problem

09-24 の記録は deterministic を Mac の LM Studio に固定した。理由は、CUDA は一台でも出力が揺れる報告があること（llama.cpp #2838）と、Omarchy 機が Windows と切り替えて起動するので止まっていることが多いこと。持ち主は、帯域の大きい GPU（3090 Ti、約 1TB/s）で決定的な作業を動かし、Mac は遅くても大きいモデルに回したい。

## Decision

- **deterministic は Omarchy 機の llama-server が出す。** モデルは Qwen3.8-27B の 4bit（bartowski Q4_K_M、17.44GB）。温度 0、シード固定、同時処理 1。
- **Mac へも別モデルへも fallback しない。** 機械をまたぐと Metal と CUDA で出力が変わり、どちらが答えたか分からない tier は再現性の意味を失う。Omarchy 機が止まっている間、deterministic は使えない（持ち主が受け入れた）。
- **同じモデルを `agent-gpu` としても出す。** コーディングと日本語の文章用、通常のサンプリング。一つのモデルなので router の読み直しは起きない。
- **MoE（Qwen3.6-35B-A3B）は置かない。** 3.8-27B の方が新しく（2026-08）、毎トークン 27B 分を使い、日本語の測定（Nejumi 4 で 0.81、二次情報）があるのは 3.8-27B だけ。速さは 3090 の 27B dense で 70〜90 tok/s（3.6-27B の実測）と足りる。
- **再現するかは実機で測る。** 同じプロンプトを繰り返し投げて出力が一字一句同じかを数え、結果を記録に残す。揃わなければこの決定を見直す。

## Alternatives considered

- **deterministic は Mac のまま、GPU は速さの用途だけ（09-24 の形）**: 持ち主が退けた。
- **GPU 用に試験用の別名を足して併存**: 同じ役割の名前が二つになり、セッションでどちらを選ぶか決められない。却下。
- **GPU を主、Mac を予備**: 機械をまたぐと再現性の意味がなくなり、よく止まる機械を主にすると LiteLLM #40405 を踏む。却下。
- **Qwen3.6-35B-A3B（MoE）**: 速い（100〜133 tok/s）が、計算に使うのは 3B で、日本語の測定がない。却下。
- **gpt-oss-20b**: 軽いが、ツール呼び出しで `reasoning_content` をクライアントが送り返さないと壊れる（#27720 は「クライアント側の問題」としてクローズ）。却下。

## Consequences

- 持ち主の手作業（一度）: Omarchy 機を tailnet に参加させる。1Password の `op://llm-automation/llama-server/credential` を作る。役割ファイルに `model-provider` と NVIDIA ドライバの情報を書く。
- Mac の LM Studio の役割（大きいモデルを別の名前で出すか、何を置くか）は、64GB に載る候補の調査の後に持ち主が決める。決まるまで Mac のモデルは LiteLLM に載らない。
- 残る不具合: Qwen3.8-27B のエージェント用途で 1 日 2 回ほど長い生成が捨てられる（#27733、open）。qwen35 系の線形注意の状態がスロットの使い回しで漏れる報告（#29092、ROCm、CUDA では未報告）。CUDA 13.2 と Qwen3.6 系の組み合わせで出力が壊れる報告（aminrj.com）。llama.cpp は PR #19468（2026-02-10）より後のビルドが要る。
- 「再現性」の実測はまだない。温度 0・同時処理 1 でも揺れるかは #2838 の条件次第。

## Sources

- `rules/research/2026-09-26-omarchy-3090ti-model-choice.md`
- `rules/research/2026-09-24-two-host-home-llm.md`
- https://github.com/ggml-org/llama.cpp/issues/2838
- https://github.com/ggml-org/llama.cpp/issues/27733
- https://github.com/BerriAI/litellm/issues/40405
