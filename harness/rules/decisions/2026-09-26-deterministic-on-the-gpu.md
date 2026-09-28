# deterministic（計画を実行するモデル）を Omarchy 機の GPU（Qwen3.8-27B）へ移す

Status: superseded by 2026-09-27-deterministic-falls-back-to-the-mac.md（Omarchy 機が止まっている間は Mac の同じモデルへ落ちるようにした。定義と主の置き場所はそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-09-26）。deterministic は GPU 機に置き、MoE ではなく Qwen3.8-27B にする。定義は、上位のモデルが設計したものを実行するモデル（やることが決まっていて、あとは実行するだけの時に使う）。同日、最初の版が deterministic を「出力がビット単位で揃う tier」と読み違えていたので、定義を直して書き直した。`2026-09-24-home-llm-second-host-omarchy-llama-server.md` を置き換える。llama-server の router mode、tailnet への出し方、別モデルへの fallback を置かないこと、`allowed_fails: 1` + `cooldown_time: 30` はそのまま引き継ぐ

rule: The `deterministic` tier is the executor: it carries out a plan that a frontier or higher-benchmark model (`complex`, Claude, Codex) already designed, when what to do is settled and only doing it remains — it is not a tier for bit-identical output. It is served by the Omarchy desktop's `llama-server` (24 GB GPU, Qwen3.8-27B at 4-bit, one slot with a 65,536-token context, Qwen's recommended sampling) and never falls back to another machine or model: while the desktop is off or booted into Windows, `deterministic` answers "unavailable". `llama-server` runs in router mode as a systemd user service with `--api-key`, exposed on the tailnet with one `tailscale serve` TCP port; every machine's LiteLLM lists it with `allowed_fails: 1` + `cooldown_time: 30` in its `model_info`.

## Problem

`deterministic` は、上位のモデルが設計したものを実行するモデルのはずだった。ところがリポジトリの記録は、それを「出力が再現する tier」（09-23 の `reproducible/offline`）や「JSON・分類・素直な編集の tier」（09-18 の選定メモ）と書き、09-24 の記録は再現性を理由に Mac の LM Studio へ固定した。実行役は帯域の大きい GPU 機（約 1TB/s。Mac は約 273GB/s）で速く回し、Mac は遅くても大きいモデルに回す。

## Decision

- **deterministic は計画の実行役。** 何をするかは上位のモデル（`complex`、Claude、Codex）が決め、deterministic はそれを手順どおりに実行する。求めるのは、ツール呼び出しを崩さないこと、指示に従うこと、計画とコードが入る文脈、速さ。出力がビット単位で揃うことは求めない。
- **Omarchy 機の llama-server が出す。** モデルは Qwen3.8-27B の 4bit（`bartowski/Qwen3.8-27B-GGUF` の `Qwen3.8-27B-Q4_K_M.gguf`、17.44GB）。文脈 65,536、KV は量子化しない（fp16 で約 4.2GB、合わせて約 22GB）。24GB ではこの文脈を一つのスロットにしか持てないので、同時処理は 1。サンプリングは Qwen の推奨値。
- **Mac へも別モデルへも fallback しない。** 別のモデルが答えると、計画を実行する力が黙って変わる。Omarchy 機が止まっている間、deterministic は使えない（持ち主が受け入れた）。
- **MoE（Qwen3.6-35B-A3B）は置かない。** 3.8-27B の方が新しく（2026-08）、毎トークン 27B 分を使う。速さはこの GPU 機の 27B dense で 70〜90 tok/s（3.6-27B の実測）と足りる。
- **Mac の LM Studio は LiteLLM から外す。** 何を置くか（遅くても大きいモデル）は、64GB に載る候補の調査のあとに持ち主が決める。

## Alternatives considered

- **deterministic は Mac のまま（09-24 の形）**: 持ち主が退けた。Mac を選んだ理由（CUDA は出力が揺れる）は、実行役という定義では効かない。
- **実行役とは別に GPU の名前（`agent-gpu` など）を足す**: 同じ役割の名前が二つになり、セッションでどちらを選ぶか決められない。却下。
- **GPU を主、Mac を予備**: 別のモデルが黙って答え、よく止まる機械を主にすると LiteLLM #40405 を踏む。却下。
- **Qwen3.6-35B-A3B（MoE）**: 速い（100〜133 tok/s）が、計算に使うのは 3B。持ち主が 3.8-27B を選んだ。
- **gpt-oss-20b**: 軽いが、ツール呼び出しで `reasoning_content` をクライアントが送り返さないと壊れる（#27720 は「クライアント側の問題」としてクローズ）。却下。
- **温度 0・キャッシュ無効で出力を揃える設定**: 実行役には要らない。思考つきのモデルを貪欲生成で回すとループしやすい。却下。

## Consequences

- 持ち主の手作業（一度）: Omarchy 機を tailnet に参加させる。1Password に llama-server の鍵を作る。役割ファイルに `model-provider`、NVIDIA ドライバの情報、Omarchy 機の tailnet 名（`llamaServerHost`）を書く。
- 残る不具合: Qwen3.8-27B のエージェント用途で 1 日 2 回ほど長い生成が捨てられる（#27733、open）。実行役の用途にそのまま当たるので、頻度を実機で見る。約 80K を超えると生成が約 25 倍遅くなる（#27623）ので文脈は 65,536 に抑える。KV を量子化すると不正メモリアクセスの報告がある（#21383、同じ世代の GPU）。llama.cpp は PR #19468（2026-02-10）より後のビルドが要る。
- harness の文脈の予算（`contextWindow`）は 65,536 になる。

## Sources

- Qwen3.6-27B dense の同世代 GPU での実測（70〜90 tok/s の根拠）: https://sanj.dev/post/qwen-3-6-27b-dual-rtx-3090-llama-cpp-tuning/
- Qwen3.6-35B-A3B（MoE）の実測（100〜133 tok/s）: https://aminrj.com/posts/llamacpp-qwen36-35b/
- CUDA の非決定性の技術的背景: https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- https://github.com/ggml-org/llama.cpp/issues/27733
- https://github.com/ggml-org/llama.cpp/issues/27623
- https://github.com/BerriAI/litellm/issues/40405
