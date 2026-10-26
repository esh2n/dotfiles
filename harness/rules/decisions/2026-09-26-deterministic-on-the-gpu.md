# deterministic（計画を実行するモデル）をOmarchy機のGPU（Qwen3.8-27B）へ移す

Status: superseded by 2026-09-27-deterministic-falls-back-to-the-mac.md（Omarchy機が止まっている間はMacの同じモデルへ落ちるようにした。定義と主の置き場所はそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-09-26）。deterministicはGPU機に置き、MoEではなくQwen3.8-27Bにする。定義は、上位のモデルが設計したものを実行するモデル（やることが決まっていて、あとは実行するだけの時に使う）。同日、最初の版がdeterministicを「出力がビット単位で揃うtier」と読み違えていたので、定義を直して書き直した。`2026-09-24-home-llm-second-host-omarchy-llama-server.md`を置き換える。llama-serverのrouter mode、tailnetへの出し方、別モデルへのfallbackを置かないこと、`allowed_fails: 1` + `cooldown_time: 30`はそのまま引き継ぐ

rule: The `deterministic` tier is the executor: it carries out a plan that a frontier or higher-benchmark model (`complex`, Claude, Codex) already designed, when what to do is settled and only doing it remains — it is not a tier for bit-identical output. It is served by the Omarchy desktop's `llama-server` (24 GB GPU, Qwen3.8-27B at 4-bit, one slot with a 65,536-token context, Qwen's recommended sampling) and never falls back to another machine or model: while the desktop is off or booted into Windows, `deterministic` answers "unavailable". `llama-server` runs in router mode as a systemd user service with `--api-key`, exposed on the tailnet with one `tailscale serve` TCP port; every machine's LiteLLM lists it with `allowed_fails: 1` + `cooldown_time: 30` in its `model_info`.

## Problem

`deterministic`は、上位のモデルが設計したものを実行するモデルのはずだった。ところがリポジトリの記録は、それを「出力が再現するtier」（09-23の`reproducible/offline`）や「JSON・分類・素直な編集のtier」（09-18の選定メモ）と書き、09-24の記録は再現性を理由にMacのLM Studioへ固定した。実行役は帯域の大きいGPU機（約1TB/s。Macは約273GB/s）で速く回し、Macは遅くても大きいモデルに回す。

## Decision

- **deterministicは計画の実行役。** 何をするかは上位のモデル（`complex`、Claude、Codex）が決め、deterministicはそれを手順どおりに実行する。求めるのは、ツール呼び出しを崩さないこと、指示に従うこと、計画とコードが入る文脈、速さ。出力がビット単位で揃うことは求めない。
- **Omarchy機のllama-serverが出す。** モデルはQwen3.8-27Bの4bit（`bartowski/Qwen3.8-27B-GGUF`の`Qwen3.8-27B-Q4_K_M.gguf`、17.44GB）。文脈65,536、KVは量子化しない（fp16で約4.2GB、合わせて約22GB）。24GBではこの文脈を一つのスロットにしか持てないので、同時処理は1。サンプリングはQwenの推奨値。
- **Macへも別モデルへもfallbackしない。** 別のモデルが答えると、計画を実行する力が黙って変わる。Omarchy機が止まっている間、deterministicは使えない（持ち主が受け入れた）。
- **MoE（Qwen3.6-35B-A3B）は置かない。** 3.8-27Bの方が新しく（2026-08）、毎トークン27B分を使う。速さはこのGPU機の27B denseで70〜90 tok/s（3.6-27Bの実測）と足りる。
- **MacのLM StudioはLiteLLMから外す。** 何を置くか（遅くても大きいモデル）は、64GBに載る候補の調査のあとに持ち主が決める。

## Alternatives considered

- **deterministicはMacのまま（09-24の形）**: 持ち主が退けた。Macを選んだ理由（CUDAは出力が揺れる）は、実行役という定義では効かない。
- **実行役とは別にGPUの名前（`agent-gpu`など）を足す**: 同じ役割の名前が二つになり、セッションでどちらを選ぶか決められない。却下。
- **GPUを主、Macを予備**: 別のモデルが黙って答え、よく止まる機械を主にするとLiteLLM #40405を踏む。却下。
- **Qwen3.6-35B-A3B（MoE）**: 速い（100〜133 tok/s）が、計算に使うのは3B。持ち主が3.8-27Bを選んだ。
- **gpt-oss-20b**: 軽いが、ツール呼び出しで`reasoning_content`をクライアントが送り返さないと壊れる（#27720は「クライアント側の問題」としてクローズ）。却下。
- **温度0・キャッシュ無効で出力を揃える設定**: 実行役には要らない。思考つきのモデルを貪欲生成で回すとループしやすい。却下。

## Consequences

- 持ち主の手作業（一度）: Omarchy機をtailnetに参加させる。1Passwordにllama-serverの鍵を作る。役割ファイルに`model-provider`、NVIDIAドライバの情報、Omarchy機のtailnet名（`llamaServerHost`）を書く。
- 残る不具合: Qwen3.8-27Bのエージェント用途で1日2回ほど長い生成が捨てられる（#27733、open）。実行役の用途にそのまま当たるので、頻度を実機で見る。約80Kを超えると生成が約25倍遅くなる（#27623）ので文脈は65,536に抑える。KVを量子化すると不正メモリアクセスの報告がある（#21383、同じ世代のGPU）。llama.cppはPR #19468（2026-02-10）より後のビルドが要る。
- harnessの文脈の予算（`contextWindow`）は65,536になる。

## Sources

- Qwen3.6-27B denseの同世代GPUでの実測（70〜90 tok/sの根拠）: https://sanj.dev/post/qwen-3-6-27b-dual-rtx-3090-llama-cpp-tuning/
- Qwen3.6-35B-A3B（MoE）の実測（100〜133 tok/s）: https://aminrj.com/posts/llamacpp-qwen36-35b/
- CUDAの非決定性の技術的背景: https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- https://github.com/ggml-org/llama.cpp/issues/27733
- https://github.com/ggml-org/llama.cpp/issues/27623
- https://github.com/BerriAI/litellm/issues/40405
