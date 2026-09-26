---
question: "RTX 3090 Ti 一枚の llama-server（router mode、Qwen3.8-27B Q4_K_M、qwen3_5 = Gated DeltaNet と通常の注意の混在）で、deterministic tier の「同じ入力なら同じ出力」をどう設定し、どう確かめるか。llama.cpp の決定的モードは今どうなったか。Mac の Metal は本当に揃うのか。"
date: 2026-09-26
verdict: "llama.cpp の公式な答えは専用モードではなく既存の設定の組み合わせ: プロンプトキャッシュを切り（--no-cache-prompt / cache_prompt: false）、スロットを一つにする。作者 ggerganov は 'Just use --no-cache-prompt if you need determinism'（2026-04-21）と述べて修正 PR #22224 を退け、#2838 は同日 completed でクローズ。決定的モードの PR #16016 は 2025-09-15 から動かず、CUDA 担当の JohannesGaessler は 'you can already get bit-for-bit identical results by disabling prompt caching and using only a single slot for the HTTP server' と書いた。ずれの原因はプロンプトキャッシュの再利用でバッチの大きさが変わること（#2838 の根本原因、CPU でも #28368）。seed の既定は -1（毎回ランダム）なので明示が要る。GDN の演算自体は CUDA でバッチに依らず一致した（PR #28109、RTX 5080 Laptop で 6/6）。一方で qwen3_5 系は CUDA で長文脈の速度崩壊（#27623、open）、量子化 KV と単一スロットでの不正メモリアクセス（#21383、未修正のまま自動クローズ、RTX 3090）、状態の巻き戻しの不具合（#29454 ほか、投機的デコードか複数スロットのとき）を抱える。再起動をまたいで揃うか、LiteLLM 経由で seed が届くか、Metal が揃うかは、どの一次資料も確かめていない。"
unverified:
  - llama-server の再起動をまたいでビット単位で一致するか（専用に検証した一次資料なし）
  - CUDA で #29092（qwen35 の状態がスロットをまたいで漏れる、ROCm）と同じ症状が起きるか（報告は見つからないが、無いことの証明ではない）
  - RTX 3090 Ti での GATED_DELTA_NET_BATCH_INVARIANCE の結果（RTX 5080 Laptop の 1 件のみ）
  - LiteLLM の openai/ 経由で seed・temperature・cache_prompt が llama-server の router まで届くか
  - Apple Metal / MLX が揃うか揃わないか（どちら向きにも質の高い一次資料なし）
  - '#27164（CUDA の DeltaNet で出力が壊れる、#29092 本文が言及）は 404 で内容不明'
---

# llama-server（CUDA、qwen3_5）で出力を揃える

前提: `2026-09-24-two-host-home-llm.md` の 3.4 節（#2838 と #16016 だけを根拠にしていた）を、この記録で更新する。GitHub の issue・PR の本文とコメントは API で原文を取得した。

## ベンダー（llama.cpp、LiteLLM）

`tools/server/README.md`（master、2026-09-26 に取得）:

- `cache_prompt`（L587）: "Because (depending on the backend) the logits are **not** guaranteed to be bit-for-bit identical for different batch sizes (prompt processing vs. token generation) enabling this option can cause nondeterministic results. Default: `true`"。サーバー側は `--cache-prompt, --no-cache-prompt`（既定で有効、L220）。
- `-s, --seed`（L123）と要求の `seed`（L573）: 既定 `-1` で毎回ランダム。
- `-np, --parallel`（L176）: 既定 `-1`（自動）。
- `--cache-reuse N`（L221）: 既定 0（無効）。
- router mode（L1708）: "model instances inherit both command line arguments and environment variables from the router server."。`--models-preset` の INI でモデルごとに上書きでき、優先順は CLI > モデル別の節 > `[*]`。
- `--models-dir` のモデル名はファイル名から `.gguf` を除いたもの（`common/preset.cpp` の `load_from_models_dir`、`string_replace_all(name, ".gguf", "")`）。

決定的モードの経緯:

- PR #16016「Deterministic inference mode」（https://github.com/ggml-org/llama.cpp/pull/16016）: draft、2025-09-15 から更新なし。提案は "an **opt-in deterministic mode** that makes CUDA inference **bit-identical** for identical inputs—independent of batch size, prompt chunking, or concurrency."。JohannesGaessler の返信: "I don't want to maintain guarantees for bit-for-bit identical results as the batch size is varied. ... BTW, as I kind of implied in my previous post, you can already get bit-for-bit identical results by disabling prompt caching and using only a single slot for the HTTP server."
- issue #2838（https://github.com/ggml-org/llama.cpp/issues/2838）: 2026-03-20 に ivich123 が根本原因を特定（RTX 5090、CUDA 13.1）。初回は全プロンプトを一度に評価（batch.n_tokens=5）、二回目以降はキャッシュの末尾 1 トークンだけを再評価（n_tokens=1）し、"CUDA Flash Attention is not bit-identical when computing attention with different batch sizes"。修正 PR #22224 は ggerganov が "Just use `--no-cache-prompt` if you need determinism" として退け、未マージでクローズ。#2838 は 2026-04-21 に completed でクローズ。
- issue #28368（https://github.com/ggml-org/llama.cpp/issues/28368、open）: CPU バックエンド、Gemma-4 26B-A4B で、`cache_prompt` の true / false だけで top-2 の logprob の差が 0.1313 と 0.8663 nats に分かれる。CUDA だけの話ではない。

LiteLLM（https://docs.litellm.ai/docs/completion/input、https://docs.litellm.ai/docs/completion/drop_params、要約経由）: `seed` と `temperature` は OpenAI の引数として転送される。対応しない引数は既定でエラーになり、黙って落とされない。openai 互換の項に転送の明記はない。

止まり扱いの設定（docs.litellm.ai/docs/routing、二つの取得で一致）: `allowed_fails` と `cooldown_time` はそのモデルの `model_info` に書く。モデル単位の `num_retries` は無視される不具合が open（https://github.com/BerriAI/litellm/issues/18968）。回避はモデル名ごとの `router_settings.model_group_retry_policy`。

## 実践者

- 公開リポジトリで `--no-cache-prompt` を再現性のために使う例が二件: hogeheer499-commits/strix-halo-guide（★345、Qwen3.6-35B-A3B、Vulkan、ベンチの条件を揃える目的、`-np 8`）と antoinezambelli/forge（★2251、評価ハーネスの CLI に "Disable llama-server prompt caching" を公開）。単一 GPU・単一スロットの CUDA で出力の一致を確かめた公開例は見つからなかった。
- vLLM での例（Marcus Chen、dev.to、著名性未確認）: 800 プロンプト × 20 回、ずれの原因をバッチ依存（±1.8pt）と別ビルドへの振り分けの混在（±2.1pt）に分け、`max_num_seqs: 1` で固定したら評価が 4 分から 19 分になった。
- Apple Silicon（Aditya Karnam、MLX）: 非決定性を主張するが、回数や比較の方法の記載がなく、単独では根拠にならない。

## 測定

- PR #28109（https://github.com/ggml-org/llama.cpp/pull/28109、draft）: `ggml_gated_delta_net` を一括と逐次で比べ、`memcmp` と `max_err() = 0` で `n_tokens {1,2,3,4,5,8}` を確認。"on an RTX 5080 Laptop: **6/6 passed**."、"This is regression coverage, not a bug report — the op is invariant on CUDA today."。サーバーのスロットやキャッシュは通していない。
- issue #1340（2023）: CUDA のストリームを 1 にすると揃った（6% 遅い）。今は `GGML_CUDA_MAX_STREAMS` がコンパイル時定数 8 で、複数 GPU 間の同期用。一枚の GPU には関係しない（ソースで確認）。
- Thinking Machines（https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/）: バッチ不変のカーネルで Qwen-3-8B が 26 秒から 55 秒、改善後 42 秒。vLLM（`VLLM_BATCH_INVARIANT=1`、compute capability 8.0 以上）と SGLang にも同様の機能があるが、コストの数値は記載なし。llama.cpp に相当するカーネルはない。

## qwen3_5 系の CUDA での既知の不具合

- #27623（open、2026-09-24 更新）: Qwen3.8-27B が約 80K 位置を超えると生成が約 25 倍遅くなる（RTX 4080 SUPER、68K で 33 tok/s、91K で 1.4 tok/s）。
- #21383（未修正のまま自動クローズ）: Qwen3.5-27B、RTX 3090、`-np 1` でも、エージェント的な長いプロンプトの二回目以降にプロンプトキャッシュの保存経路で illegal memory access。`LLAMA_ATTN_ROT_DISABLE=1` で消える（量子化 KV の回転、PR #21038 由来）。
- #28019・#29454（2026-09-26）・#28286: GDN の状態の巻き戻しの不具合。投機的デコードか `--parallel > 1` のときに出る。
- #29092（ROCm、open）: qwen3.6:35b-a3b と qwen3.8:27b を名指しで、使い回したスロットに前のリクエストの状態が漏れ、前のプロンプトの文が次の応答に出る。回避策（層 0 を CPU に）で prompt +24%、decode +26〜29%。CUDA での同じ症状の報告は見つからなかった。

## この記録で言えること

最も揃いやすい設定（このマシン向け）:

1. スロットは一つ（`-np 1`）。
2. プロンプトキャッシュを使わない（要求ごとに `cache_prompt: false`、または `--no-cache-prompt`）。
3. `seed` を毎回明示する。
4. `temperature 0` と `top_k 1`。1 と 2 が無いと温度 0 だけでは揃わない（#2838）。
5. `--cache-reuse` は既定の 0 のまま。
6. 投機的デコードは使わない。
7. KV キャッシュを量子化しない（使うなら `LLAMA_ATTN_ROT_DISABLE=1`、#21383）。
8. `-b`・`-ub`・`-fa` などの起動設定を再起動をまたいで同じに保つ。

確かめ方:

1. 起動中の一台に、同じプロンプト・固定シード・温度 0・`top_k 1`・`cache_prompt: false` を 20〜50 回送り、トークン列の SHA256 がすべて一致するか。
2. 同じことを、毎回サーバーを止めて起動し直して 10 回。
3. 固定プロンプトだけでなく、接頭辞が毎回変わるエージェント的な列でも。
4. できれば `test-backend-ops test -o GATED_DELTA_NET_BATCH_INVARIANCE -b CUDA0` をこの個体で。
