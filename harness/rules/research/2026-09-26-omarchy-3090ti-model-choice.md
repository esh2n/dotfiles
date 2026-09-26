---
question: "Omarchy 機（RTX 3090 Ti 24GB 一枚、一人、llama-server の router mode、LiteLLM から用途名で明示的に選ぶ）に、どの用途でどのモデルを置くのが通例か。日本語の文章用と軽量 4bit を出発点に、第三の用途（コーディング・エージェント用など）を持つのは普通か。Mac の deterministic（LM Studio）とは役割を重ねない。"
date: 2026-09-26
verdict: "用途を分けて複数のモデルを置くのは実地の型（単一 24GB で 11 モデルを持つ実践者、2x3090 で用途別にハイパーパラメータを管理する ★836 の文書）で、コーディングを独立した用途にするのも標準的。日本語は、二次要約経由の Nejumi 4（2026-09-01）で汎用の Qwen 27B 級（0.79〜0.81）が 24GB に載る日本特化モデル（llm-jp-4-33b-thinking 0.6760）を上回り、「日本語だから日本製」は支持されない。PLaMo の最新世代はオープンウェイトとして見つからず、Sarashina2.2 は 3B と音声・OCR 特化のみ。軽量は gpt-oss-20b（Q4_K_M 約 13GB、3090 で 161 tok/s）と Qwen3-30B-A3B 系（Q4_K_M 18.56GB）に根拠があるが、gpt-oss は harmony と jinja テンプレートの不整合でツール呼び出しが一部壊れる報告（#27720）がある。GLM-4.5-Air は最小量子化でも 38.26GB で 24GB に載らない。ただし日本語の順位は原典未到達、推した 3 モデルのうち Qwen3.8-27B と Qwen3.6 系の GGUF の実在とサイズ、Coder 版の 3090 実測は未確認で、決定の前に確かめる必要がある。"
unverified:
  - Nejumi LLM リーダーボード 4 の原典（Qualiteg の二次要約に依存）
  - Swallow リーダーボードの 20B 級の個別スコア
  - Qwen3.8-27B・Qwen3.6-27B・Qwen3.6-35B-A3B の GGUF リポジトリの実在とファイルサイズ（HF API では確かめていない）
  - Qwen3-Coder-30B-A3B-Instruct の 3090 / 3090 Ti での実測 tok/s（姉妹モデルからの類推のみ）
  - gpt-oss-20b の harmony / jinja 不具合（#27720）が 2026-09 時点で直っているか
  - Qwen3 系が llama-server の function-calling 一覧に個別に載っていないことの影響
  - GLM-4.5-Air を 32GB RAM 機で --n-cpu-moe 運用した失敗報告
---

# Omarchy（RTX 3090 Ti 24GB）の llama-server に置くモデル

前提として次の記録は読み込み済みで、再調査していない: `2026-09-24-vllm-vs-llama-server.md`、`2026-09-25-llama-server-router-and-cuda-packaging.md`、`2026-09-24-two-host-home-llm.md`、`2026-09-23-qwen3-8-next-lm-studio.md`。

調べ方: HF API と GitHub REST API の直接取得（ファイルサイズ・ライセンス・日付・DL 数・★）、WebFetch（ページ本文）、WebSearch（スニペットのみのものは「WebSearch 経由」と明記）。`gh` はこの環境で TLS 検証エラーになり、GitHub の code search は認証が要るため到達できなかった（0 件ではない）。

## ベンダー（モデルカード・ライセンス・README）

実在とライセンス（`https://huggingface.co/api/models/<id>`、2026-09-26）:

| モデル | ライセンス | 総 / 活性 | 更新 |
|---|---|---|---|
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | Apache-2.0 | 30B / 3B (MoE) | 2025-07 |
| `Qwen/Qwen3-Coder-30B-A3B-Instruct` | Apache-2.0 | 30B / 3B (MoE) | 2025-07-31 |
| `openai/gpt-oss-20b`（`unsloth/gpt-oss-20b-GGUF`） | Apache-2.0 | 21B / 3.6B (MoE) | 2025-12 |
| `llm-jp/llm-jp-4-33b-thinking`（`-gguf`） | Apache-2.0 | 33B dense | 2026-08-14 |
| `elyza/ELYZA-Thinking-1.0-Qwen-32B`（`mmnga/...-gguf`） | Apache-2.0 | 32B dense | 2025-04-30 |
| `tokyotech-llm/GPT-OSS-Swallow-20B-RL-v0.1`（`mmnga-o/...-gguf`） | Apache-2.0 | 21B / 3.6B (MoE) | 2026-02-14 |
| `sbintuitions/sarashina2.2-3b-instruct-v0.1` | MIT | 3B dense | 2026-08-25 |
| `zai-org/GLM-4.5-Air`（`unsloth/GLM-4.5-Air-GGUF`） | MIT | 106B / 12B (MoE) | 2025-12 |
| `pfnet/PLaMo-2.2-Prime` | 検索 0 件 | — | — |

- PLaMo の最新世代はオープンウェイトとして見つからない。PFN の公開世代は `pfnet/plamo-13b`（2023）までで、`plamo-13b-instruct-nc` は CC-BY-NC-4.0（非商用）。
- Sarashina2.2 は 3B の instruct と TTS・OCR 特化だけが見つかった（大きい対話モデルが無いことの証明ではない）。
- Qwen は 35B 以下を Apache-2.0 に保つ一方、Qwen3.8-Max に商用制限を新設した（[SCMP](https://www.scmp.com/tech/tech-trends/article/3363927/alibaba-adds-commercial-restrictions-open-weight-qwen38-max-ai-model)、要約経由）。27〜35B 級は影響なし。

GGUF のサイズ（`https://huggingface.co/api/models/<repo>/tree/main`）:

| GGUF | サイズ | 24GB 一枚 |
|---|---|---|
| `unsloth/Qwen3-30B-A3B-GGUF` Q4_K_M | 18.56 GB | 載る（KV に約 5GB） |
| `unsloth/Qwen3-30B-A3B-GGUF` Q6_K | 25.09 GB | 載らない |
| `unsloth/gpt-oss-20b-GGUF` Q4_K_M | 約 13.3 GB（WebSearch 経由） | 余裕、128k でも約 22GB 以内 |
| `llm-jp/llm-jp-4-33b-thinking-gguf` Q4_K_M | 20.16 GB | 載るが KV は約 4GB |
| `unsloth/GLM-4.5-Air-GGUF` 最小 UD-TQ1_0 | 38.26 GB | 載らない |

- `--n-cpu-moe` は attention を GPU に残して専門家の FFN を RAM に逃がす仕組み。上の 30B 級 MoE は 24GB に収まるので要らず、要るのは GLM-4.5-Air 級だけ。
- llama-server の function-calling 一覧（[docs/function-calling.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)）には Qwen 2.5 / 2.5 Coder が載り、Qwen3 系の個別記載はない。同文書の警告: "Beware of extreme KV quantizations (e.g. `-ctk q4_0`), they can substantially degrade the model's tool calling performance."

## 実践者

- [varunvasudeva1/llm-server-docs](https://github.com/varunvasudeva1/llm-server-docs)（★836、2026-06-30 push）: 2x RTX 3090。llama-swap を主に、llama.cpp の `--models-preset` を「GUI なしの低オーバーヘッドな代替」として併記。Qwen3.6-27B と Gemma-4-31B を個別のハイパーパラメータで持つ。
- [akehir.com](https://akehir.com/blog/llama-swap-and-llama-cpp-for-self-hosting-multiple-llm-models/): 24GB 一枚（RX 7900 XTX）+ RAM 64GB で 11 モデル。コーディングに Qwen-3-coder-30B、文章（メール・人間らしい文）に gemma3。GLM 4.5 Air は GPU に 11 層だけ載せて動かす。
- [tfriedel/qwen3.6-rtx3090-lab](https://github.com/tfriedel/qwen3.6-rtx3090-lab): 3090 一枚で Qwen3.6-27B dense が 70〜72 tok/s（会話）/ 91（コード）、Qwen3.6-35B-A3B（IQ4_XS）が 115〜133 tok/s。同じ機械で vLLM は 18 tok/s、"vllm is not going to run on a single 3090 with this model"。投機的デコードは "every variant is net-negative on consumer Ampere"。
- [aminrj.com](https://aminrj.com/posts/llamacpp-qwen36-35b/): Qwen3.6-35B-A3B UD-Q4_K_XL、65k 文脈で VRAM 24.2GB、101.7 / 80.9 tok/s。"Do NOT use CUDA 13.2 with Qwen3.6 — it produces gibberish outputs."
- [sanj.dev](https://sanj.dev/post/qwen-3-6-27b-dual-rtx-3090-llama-cpp-tuning/): 2x3090 で既定のままでは 19 tok/s、調整で 22.8 tok/s（一枚の参考にはならない）。

## 測定

Nejumi LLM リーダーボード 4（2026-09-01、[Qualiteg の要約](https://journal.qualiteg.com/llm-ranking-2026/) 経由、原典未到達）:

| モデル | スコア |
|---|---|
| Qwen3.8-27B (reasoning-xhigh) | 0.8091 |
| Qwen3.5-27B (reasoning) | 0.8049 |
| Qwen3.6-27B (reasoning) | 0.7955 |
| Gemma-4-26B-A4B-it | 0.7872 |
| Qwen3.5-4B (reasoning) | 0.7352 |
| NVIDIA Nemotron Nano 9B v2 Japanese | 0.7111 |
| GPT-OSS-Swallow-120B-RL-v0.1 | 0.6914 |
| llm-jp-4-33b-thinking | 0.6760 |

- [GPT-OSS Swallow 公式](https://swallow-llm.github.io/gptoss-swallow.en.html): "the 20B and 120B models have achieved state-of-the-art performance among open LLMs of comparable or smaller size (as of February 2026)"。20B の日本語の数値には届かなかった。

3090 / 3090 Ti の生成速度:

| モデル | 量子化 | tok/s | 出典 |
|---|---|---|---|
| Qwen3-32B dense | UD-Q4_K_XL | 35.1（4K）/ 30.3（16K） | smeltcore.com（Hardware Corner 由来） |
| Qwen3.6-35B-A3B | UD-Q4_K_XL | 101.7 / 80.9（65K） | aminrj.com |
| Qwen3.6-35B-A3B | IQ4_XS | 115〜133 | tfriedel |
| Qwen3.6-27B dense | fp8_e5m2 KV | 70〜72 / 91 | tfriedel |
| gpt-oss-20b | Q4_K_M | 161 | hardware-corner.net ほか（WebSearch 経由） |

量子化とツール呼び出し（dev.to の BFCL 計測、WebSearch 経由）: 量子化は推論力より先に指示追従と構造化出力を崩す。Q4_K_M までは構造は壊れず、最も荒い量子化で呼び出し率が落ちる。

## 実地（公開リポジトリ・配布）

- llama-swap（mostlygeek/llama-swap）は ★5,755、2026-09-26 push。router mode の登場後も最大手で、置き換わっていない。
- HF の DL 数: `unsloth/gpt-oss-20b-GGUF` 511,050、`llm-jp/llm-jp-4-33b-thinking-gguf` 254,344、`unsloth/Qwen3-30B-A3B-GGUF` 28,056、`GPT-OSS-Swallow-20B-RL-v0.1` 1,774、ELYZA-Thinking の GGUF 1,025。

## 否定側の証拠

- gpt-oss-20b: harmony 形式と jinja テンプレートの不整合で、温度 1.0 のとき約 4% のターンのツール呼び出しが壊れる（llama.cpp #27720、現在の状態は未確認）。Ollama 側は別の不具合（#17638）。
- GLM-4.5-Air: jinja テンプレートの不具合でツール呼び出しが動かず手で直す報告（`unsloth/GLM-4.5-Air-GGUF` discussion #1）。24GB には載らない。
- CUDA 13.2 と Qwen3.6 の組み合わせで出力が壊れる（aminrj.com）。nightly を追う CUDA ビルドではこの種の後退がありうる。
- 投機的デコードは Ampere で逆効果（tfriedel）。
- KV キャッシュを極端に量子化するとツール呼び出しが劣化する（llama.cpp 公式）。
- 日本特化モデルは実在しても採用が薄い（DL 数で汎用の 1/100 以下）。

## この記録で言えること

- 用途を分けて置くのは通例。第三の用途としてコーディング・エージェント用を持つ実践者が二件ある。
- 日本語の文章用は汎用の Qwen 27B 級が有力で、24GB に載る日本特化モデルは測定上それより下。ただし順位は二次情報。
- 軽量は gpt-oss-20b と Qwen3-30B-A3B 系のどちらにも根拠がある。gpt-oss はツール呼び出しの不具合報告付き。
- 推された組み合わせ（Qwen 27B 級・gpt-oss-20b か Qwen3-30B-A3B・Qwen3-Coder-30B-A3B）は、どれも 24GB に単独で載る。RAM は 32GB で足りる見込み（推論）で、64GB が効くのは GLM-4.5-Air 級を足すときだけ。

## 決める前に確かめること

この記録は、最新世代（Qwen3.6 / 3.8）の GGUF の実在とサイズを HF API で確かめていない。一方でサイズを確かめた Qwen3-30B-A3B-2507 と Qwen3-Coder-30B-A3B は 2025-07 の世代で、3090 の実測があるのは Qwen3.6 系。どの世代を置くかは、次の三点を確かめてから決める。

1. Qwen3.8-27B・Qwen3.6-27B・Qwen3.6-35B-A3B（とその Coder 版があればそれ）の GGUF リポジトリとファイルサイズ
2. Nejumi 4 の原典の数値
3. gpt-oss-20b の #27720 の現状

## 追補: 決める前に確かめた三点（同日）

HF API（`/api/models/<id>`、`/tree/main`）と GitHub REST API を直接確認。

**Qwen3.6 / 3.8 の実在とサイズ。** `Qwen/Qwen3.6-27B`（2026-04）、`Qwen/Qwen3.8-27B`（2026-08-14）、`Qwen/Qwen3.6-35B-A3B`（2026-04、256 専門家・8 活性）はどれも実在し Apache-2.0。27B は画像も読むマルチモーダル（`image-text-to-text`）。Qwen 公式の Coder 版は 3.6 / 3.8 とも無く、検索に出るのはコミュニティの改造（abliterated 系を含む）だけ。

`config.json` の `text_config` は線形注意と通常の注意の混在（`full_attention_interval: 4`）で、KV キャッシュを持つのは 27B が 64 層中 16 層、35B-A3B が 40 層中 10 層だけ。fp16 の KV は 27B が 2×4×256×2B×16 = 64KB/トークン（32k で約 2.1GB、65k で約 4.2GB）、35B-A3B が 2×2×256×2B×10 = 20KB/トークン（32k で約 0.64GB、65k で約 1.28GB）。

| GGUF（GB） | Q4_K_M | UD-Q4_K_XL | IQ4_XS | Q5_K_M | Q6_K |
|---|---|---|---|---|---|
| Qwen3.6-27B unsloth | 16.82 | 17.61 | 15.44 | 19.51 | 22.52 |
| Qwen3.6-27B bartowski | 17.98 | — | 15.78 | 20.97 | 23.68 |
| Qwen3.8-27B unsloth | UD-Q4_K_M 16.46 | 17.56 | UD-IQ4_XS 14.25 | UD-Q5_K_M 19.77 | UD-Q6_K 21.98 |
| Qwen3.8-27B bartowski | 17.44 | — | 15.48 | 20.92 | 23.86 |
| Qwen3.6-35B-A3B bartowski | 22.29 | — | 19.70 | 25.91 | 30.95 |
| Qwen3.6-35B-A3B unsloth | UD-Q4_K_M 22.13 | 22.36 | 17.73 | UD 26.46 | — |

24GB に収まるのは、27B の Q4 級（65k でも 19〜22GB）、27B の Q5_K_M（32k でぎりぎり）、35B-A3B の Q4 級（65k で約 23〜24GB、aminrj.com の実測 24.2GB と一致）。27B の Q6_K と 35B-A3B の Q5 以上は載らない。この二つを同時に VRAM に置くことはできないので、router は切り替えのたびに読み直す。

llama.cpp は PR #19468（qwen3.5 系の対応、2026-02-10 マージ）より後のビルドが要る。変換の修正 PR #27132（線形注意のテンソル）は 2026-08-15 時点でまだオープン。

**Nejumi 4 の原典。** W&B のレポート（https://wandb.ai/llm-leaderboard/nejumi-leaderboard4/reports/Nejumi-LLM-Leaderboaed-4--VmlldzoxNDQyMzkxMA ）は JS 描画で表を取れず、GraphQL は非公開。原典は未到達のまま。二次要約の数値は再確認でき、gpt-oss-20b・Qwen3-30B-A3B-2507・Qwen3-Coder-30B-A3B はその要約に載っていない（[unverified]）。

**不具合の現状。**
- #27720（gpt-oss のツール呼び出し）は 2026-08-26 にクローズ。直ったのではなく、クライアントがツール呼び出しを含むターンで `reasoning_content` を送り返していないのが原因とされた: "I'm going to close this simply because handling garbage output is not feasible from a parsing perspective. Feel free to reopen if you continue to have issues even after round-tripping the reasoning content."
- #27733（オープン、2026-08-26）: Qwen3.8-27B のエージェント用途で、1 日 2 回ほど末尾の閉じていない `<think>` のせいで最終の解析が失敗し、1 万トークン超の生成が捨てられる（CUDA で再現、`--jinja`）。
- #29092（オープン、2026-09-18、HIP/ROCm）: qwen35 / qwen35moe の線形注意の状態が、使い回したスロットでリクエストをまたいで残る。CUDA での報告は見つからなかった（[unverified]）。
- #28522 のコメントに「Qwen 系で MCP のツールがループする」という未確認の報告。

**エージェント用途のツール呼び出しの測定。** llama-server `--jinja` 経由で三モデルを比べた測定は見つからなかった（前例なし）。ベンダーの数値は gpt-oss-20b の tau-bench Retail 54.8%（OpenAI 公式、別のハーネス）だけ。Qwen3.6-35B-A3B の公式ブログ（"Agentic Coding Power, Now Open to All"）は JS 描画で数値を取れなかった。
