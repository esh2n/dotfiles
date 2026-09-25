---
title: "「qwen3.8-next」は LM Studio で動かせるか — 実在するモデル名と 64GB Mac での可否"
date: 2026-09-23
---

## 対象の問い

LM Studio のカタログで「qwen3.8-next」を検索してもヒットしない。そのモデルは存在するのか、存在するなら 64GB の Apple Silicon Mac で LM Studio から動かせるのか。deterministic tier（現行 `lm_studio/qwen/qwen3.8-27b`）の置き換え候補としての可否を確定する。

## 凡例

- 「直接API」= `curl https://huggingface.co/api/models/...` で生 JSON を取得した箇所。
- 「要約経由」= WebFetch / WebSearch の要約のみで確認した箇所。

## 1. 「qwen3.8-next」という名前は存在しない

Hugging Face `Qwen` 組織に完全一致の id は無い。近い実在モデルは次の 3 つ。

| モデル id | 構成 | リリース | 出典 |
|---|---|---|---|
| `Qwen/Qwen3.8-Flash-Next` | 総 125B / 活性 6B の MoE（Gated DeltaNet + Qwen Sparse Attention、512 experts、MTP ヘッド付き）、`model_type: "qwen4_exp"` | 2026-08-27 | 直接API: https://huggingface.co/api/models/Qwen/Qwen3.8-Flash-Next （`"lastModified":"2026-08-27T05:03:36.000Z"`, `"architectures":["Qwen4ExpForConditionalGeneration"]`） |
| `Qwen/Qwen3.8-27B` | dense 27.3B、`"architecture":"qwen35"` | 2026-08-14 | 直接API: https://huggingface.co/api/models/lmstudio-community/Qwen3.8-27B-GGUF |
| `Qwen/Qwen3-Next-80B-A3B`（旧世代） | 総 80B / 活性 3B MoE、ハイブリッドアテンション | 2025 年後半 | 要約経由 |

探していた名前は、新世代番号「3.8」と旧世代の系列名「Next」を合成したものと考えるのが自然で、実体は `Qwen3.8-Flash-Next`（GitHub: https://github.com/QwenLM/Qwen3.8-Flash-Next 、要約経由）。LM Studio のアプリ内検索は Hugging Face Hub を直接引く（https://huggingface.co/docs/hub/lmstudio 、https://lmstudio.ai/docs/app/basics/download-model 、要約経由）ので、文字列が存在しない＝ヒットしない。

## 2. 64GB Mac での可否

- `Qwen3.8-Flash-Next`: LM Studio のモデルページに「Minimum system memory: 96GB」（https://lmstudio.ai/models/qwen/qwen3.8-flash-next 、要約経由）。GGUF 実サイズは Q4_K_M 119GB / Q6_K 168GB / Q8_0 188GB（https://huggingface.co/lmstudio-community/Qwen3.8-Flash-Next-GGUF 、要約経由）。**64GB では 4bit でも起動不可。**
- `Qwen3.8-27B`: 最小 16GB RAM（https://lmstudio.ai/models/qwen/qwen3.8-27b 、要約経由）。GGUF / MLX 4bit とも lmstudio-community にあり。現行 deterministic そのもの。
- `Qwen3-Next-80B-A3B`: `lmstudio-community/Qwen3-Next-80B-A3B-Thinking-GGUF` の Q4_K_M 48.5GB / Q6_K 65.5GB / Q8_0 84.8GB（要約経由）。64GB では Q4_K_M が OS 分を除いてぎりぎり収まる。

llama.cpp のアーキテクチャ対応: `qwen4exp` は PR #27742「model: add Qwen3.8-Flash-Next (qwen4exp)」で 2026-08-27 にマージ済みだが、**MTP ヘッドは「WIP」と明記**（https://github.com/ggml-org/llama.cpp/pull/27742 、要約経由）。旧 `Qwen3-Next` のハイブリッドアテンションは PR #16095（2025）で対応済み。LM Studio 側は新アーキテクチャごとにランタイム更新が要る（公式 X 告知「Qwen3-Next support in llama.cpp is now live... `lms runtime update --channel beta`」 https://x.com/lmstudio/status/1995646603919606140 、要約経由）。

## 3. 否定的証拠

- `Qwen3.8-Flash-Next` の GGUF 版は MTP ヘッドを除外しているとの言及あり（要約経由の別ソース、直接確認できず）。MLX 版は MTP を保持し投機的デコードが使えるとの記述があるが 128GB+ 前提（要約経由）。
- 4bit 量子化の精度劣化データは Qwen3-8B（別モデル）のものしか見つからず、`Qwen3.8-Flash-Next` / `Qwen3-Next-80B-A3B` 固有の劣化データは無し。

## 4. 検証できなかったこと

- Qwen 公式ブログ（`qwen.ai/blog?id=qwen3.8-flash-next`）は本文が取得できず未到達。
- `Qwen3.8-Flash-Next` の mlx-community 版の実サイズ・実測 RAM。
- LM Studio での実機起動（プロンプト処理速度、ツール呼び出しテンプレートの不具合）は未実施。Reddit / issue tracker の実測ログも検索でヒットせず。
- llama.cpp PR #28243（MTP 追加 PR）のマージ状況。
- `Qwen3.8-Flash-Next` を 64GB Apple Silicon で動かした一次情報は皆無（96GB 要件のため原理的に対象外）。

## 5. 結論の材料

deterministic tier の候補として、`Qwen3.8-Flash-Next` は 64GB 機では対象外。MoE の速さを取るなら旧世代 `Qwen3-Next-80B-A3B` Q4_K_M（メモリの選定候補にあった 80B/A3B と同じもの）が唯一の現実的な線で、既存の `litellm/bench/quant-ab.mjs` で `qwen3.8-27b` と実測比較できる。採否はオーナーの判断。
