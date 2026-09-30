# Mac（M4 Pro / 64GB / 273GB/s）LM Studio の常駐大型モデル候補 調査記録

調査日 2026-09-30。既知事実（再調査しない）: このMacで `qwen/qwen3.8-27b@4bit` 15.0 tok/s、`qwen/qwen3.6-35b-a3b@8bit` 53.7 tok/s、`prism-ml/bonsai-27b@2bit` 25.1 tok/s を実測済み（`home/shared/litellm/config/bench/report.md`）。`deterministic` tier は Omarchy の RTX 3090 Ti + Qwen3.8-27B が主、Mac の LM Studio は同モデルを JIT 読み込みする予備という条件は [2026-09-27-deterministic-falls-back-to-the-mac.md](../decisions/2026-09-27-deterministic-falls-back-to-the-mac.md) で確定済みのため、本調査では比較対象にしない。

## 方法と検証の凡例

- **直接取得**: `curl` で Hugging Face API (`huggingface.co/api/models/...`)、GitHub public search API (`api.github.com/search/...`)、Artificial Analysis のモデルページ本文を取得。`gh` コマンドは TLS 証明書エラー（`x509: OSStatus -26276`）でサンドボックス経由では使えなかったため、要求どおり `curl` に切り替えた。認証トークンは読み出していない。
- **要約経由 [要約経由]**: `WebFetch` はページを一度要約モデルに通してから返す。Simon Willison の記事、Artificial Analysis の個別モデルページ、GLM 4.7-Flash の README 抜粋などはこの経路。引用符内は要約が「原文からの引用」として返した文字列であり、これも要約を経由している点に注意。
- **到達不能**: LM Studio の `docs/app/advanced/memory`（404）、Nejumi リーダーボード（wandb, JS レンダリングでデータ非表示）、llm-jp の HF Space リーダーボード（ランタイムエラーで停止中）、shisa.ai ブログの GLM/gpt-oss 記事（存在しない）。
- WebSearch はセッションの検索予算を使い切っていたため、本調査はすべて WebFetch・curl・GitHub API・Hugging Face API で行った。

---

## 1. ベンダー

### モデルの現行ラインナップ（2026-09-30 時点、Hugging Face API で実size確認）

`huggingface.co/api/models/<repo>` の `safetensors.total`（パラメータ数）と `tree/main` のファイルサイズ合計（実配布量、GB）を直接取得した。

| モデル | 総パラメータ / 活性 | ライセンス | 4bit 実配布サイズ |
|---|---|---|---|
| `Qwen/Qwen3.8-27B`（既知） | 27.78B dense | apache-2.0 | 16.08GB（既知の実測値） |
| `Qwen/Qwen3.6-35B-A3B`（既知） | 35.95B / ~3B MoE | apache-2.0 | — |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 30.5B / 3B MoE | apache-2.0 | 17.2GB (`mlx-community/Qwen3-30B-A3B-Instruct-2507-4bit`) |
| `Qwen/Qwen3-Coder-Next` | 79.7B / 3B MoE, 512 experts/10 active | apache-2.0 | 44.86GB (`mlx-community/Qwen3-Coder-Next-4bit`, DL 7,075) |
| `Qwen/Qwen3.8-Flash-Next` | 180.0B | license: other | MLX 4bit 未確認、ライセンスが apache でないため候補から除外 |
| `zai-org/GLM-4.5-Air` | 106.85B / 12B MoE | **MIT**（README: “GLM-4.5 has 355 billion total parameters with 32 billion active parameters, while GLM-4.5-Air adopts a more compact design with 106 billion total parameters and 12 billion active parameters.”） | 4bit 60.16GB / 3bit 46.81GB (`mlx-community/GLM-4.5-Air-{4,3}bit`) |
| `zai-org/GLM-4.7-Flash` | 31.2B / ~3B MoE（config: `n_routed_experts=64, num_experts_per_tok=4`） | MIT（README: “GLM-4.7-Flash is a 30B-A3B MoE model. As the strongest model in the 30B class...”） | 4bit 16.87GB / 8bit 31.84GB (`mlx-community/GLM-4.7-Flash-{4,8}bit`) |
| `zai-org/GLM-4.7` | 358.3B | MIT | 検討外（サイズ超過） |
| `zai-org/GLM-5.2` / `GLM-5.3` / `GLM-5.3-Flash` | GLM-5.3-Flash だけでも 321.3B | 未確認（GLM-5.3-Flash は fp8 のみ配布、MLX 4bit は `mlx-community/GLM-5.3-Flash-4bit` が存在するが元が321B のため4bitでも150GB超級） | 検討外（サイズ超過） |
| `openai/gpt-oss-120b`（既知の型） | 116.8B / 5.1B MoE | apache-2.0（vendor: “gpt-oss-120b — for production, general purpose, high reasoning use cases that fit into a single 80GB GPU”） | 62.36GB (`mlx-community/gpt-oss-120b-MXFP4-Q4`, 実ファイルサイズ計測) |
| `openai/gpt-oss-20b` | 20.9B / 3.6B MoE | apache-2.0 | 小さいため「大きめ」候補ではないが比較対象に含めた |
| `moonshotai/Kimi-K2.5` | **1.026兆** パラメータ（4bit量子化後も `mlx-community/Kimi-K2.5` の safetensors 合計が1,026,408,232,448 要素） | license: other（`license_name: modified-mit`） | 4bit でも概算500GB超 — 64GBでは物理的に不可能 |
| `google/gemma-4-31B-it` | 31.27B dense | **apache-2.0**（HF API tag、旧世代 Gemma の独自ライセンスから変更されている） | `mlx-community/gemma-4-31b-it-4bit` 配布あり（サイズ未計測） |
| `mistralai/Devstral-Small-2-24B-Instruct-2512` | 24.01B dense、コーディング特化 | apache-2.0 | 24GB級（配布ファイルから逆算） |
| `Qwen/Qwen3-VL-30B-A3B-Instruct`（VLM） | 31.07B / 3B MoE | apache-2.0 | `mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit` (DL 1,366) |
| `zai-org/GLM-4.6V-Flash`（VLM） | 10.29B | MIT | `mlx-community/GLM-4.6V-Flash-5bit` 8.27GB |

出典: [huggingface.co/api/models/...](https://huggingface.co) 直接叩き（各行のモデルID）、README は [zai-org/GLM-4.5-Air](https://huggingface.co/zai-org/GLM-4.5-Air/raw/main/README.md)・[zai-org/GLM-4.7-Flash](https://huggingface.co/zai-org/GLM-4.7-Flash/raw/main/README.md)・[openai/gpt-oss-120b](https://huggingface.co/openai/gpt-oss-120b/raw/main/README.md) から直接取得。

### 重要な否定的事実: GLM-4.6-Air は存在しない

zai-org の全モデル一覧を直接取得したところ、"Air" ティアは GLM-4.5-Air のまま止まっており、GLM-4.6/4.7/5.x に対応する Air 版は無い。代わりに軽量ティアの後継は GLM-4.7-Flash（30B-A3B）という別名で出ている。GLM-4.6-Air という名前のモデルを前提にした調査は成立しない。

### LM Studio 自身のメモリに関する記述は薄い

- `https://lmstudio.ai/docs/app/advanced/memory` は **404**（存在しないURL）。
- 到達できた `https://lmstudio.ai/docs/app/system-requirements` の記載は macOS について "16GB+ RAM recommended. You may still be able to use LM Studio on 8GB Macs, but stick to smaller models and modest context sizes." のみ [要約経由]。Apple Silicon のユニファイドメモリの内訳、wired memory 上限、OS 予約分についての記述は**この文書には無い**。
- `https://lmstudio.ai/docs/app/basics/download-model` にも量子化の一般論（"choose a 4-bit option or higher if your machine is capable enough"）しかなく、メモリ計算式は無い [要約経由]。
- MLX 自体のドキュメント（[ml-explore/mlx unified_memory.rst](https://raw.githubusercontent.com/ml-explore/mlx/main/docs/src/usage/unified_memory.rst)）はユニファイドメモリの計算モデルを説明するが、macOS の wired memory 上限や実際に使える GB 数の具体的なガイドラインは記載していない。
- 結論: 「64GBのうち35〜45GBが現実的」という見積もりの根拠になる**ベンダー公式の数値文書は見つからなかった**。この数値は次節の実践者の実測（後述、47.687GB でも動いたが逼迫）から逆算する以外にない。

### ライセンス一覧

| モデル | ライセンス |
|---|---|
| Qwen 系（3.8-27B, 3.6-35B-A3B, 3-30B-A3B, Coder-Next, VL-30B-A3B） | apache-2.0 |
| GLM-4.5-Air, GLM-4.7-Flash, GLM-4.6V-Flash | MIT |
| gpt-oss-120b, gpt-oss-20b | apache-2.0 |
| Gemma-4-31B-it | apache-2.0（Gemma の従来の独自利用規約から変更） |
| Devstral-Small-2-24B | apache-2.0 |
| Kimi-K2.5 | "other" / modified-mit（独自条項あり、要確認） |

---

## 2. 名前のある実践者

### Simon Willison — GLM-4.5-Air 3bit を 64GB MacBook Pro M2 で実行

[simonwillison.net/2025/Jul/29/space-invaders/](https://simonwillison.net/2025/Jul/29/space-invaders/) [要約経由]

- ハードウェア: "a 64GB MacBook Pro M2"
- ピークメモリ: "Peak memory: 47.687 GB"
- 生成速度: "Generation: 4193 tokens, 25.564 tokens-per-sec"
- **逼迫の証言**: "leaving me with just 16GB for everything else—I had to quit quite a few apps in order to get the model to run."
- 評価: "it works _extremely well_"、"Local coding models are really good now."

この記事は M2 チップ（M4 Pro とはメモリ帯域が異なる、M2 の世代は base/Pro/Max で 100/200/400GB/s とばらつくため直接比較は [unverified]）だが、**同じ「64GBのMac」「GLM-4.5-Air 3bit」という条件で、47.687GBのピークメモリを使い、残り16GBでは日常アプリを閉じる必要があった**という一次証言は重い。GLM-4.5-Air は 4bit で 60.16GB（4bitは64GB機では起動不可能）、3bit でも 46.81GB（HF上の配布サイズ）で、Willison の実測ピークメモリ47.687GBとほぼ整合する。これは持ち主が想定する「35〜45GBが現実的」という見積もりの**上限ギリギリか、それを超える**水準であり、GLM-4.5-Air は 64GB Mac で開発作業と同時に常駐させるには厳しいという否定的な実践者証拠になる。

### 同種の実践者記録は他に見つからず

Awni Hannun（MLX作者）や exolabs チームの個人ブログで M4 Pro / 64GB 固有のベンチマーク記事は検索予算切れのため発見できなかった [not found]。GLM-4.7-Flash や gpt-oss-120b を 64GB Mac で常駐させた個人の実践報告も見つからなかった。

---

## 3. 測定された証拠

### Artificial Analysis Intelligence Index（クラウドAPI経由の計測、直接取得）

各モデルの Artificial Analysis 個別ページ（`artificialanalysis.ai/models/<slug>`）を直接フェッチ。ここでの tok/s はクラウド提供元のホスト環境での値であり、**Mac上のローカル量子化とは別物**（[unverified] 相関未検証）。

| モデル | AA Intelligence Index | 順位 | クラウド出力速度 | コンテキスト |
|---|---:|---|---:|---|
| Qwen3.8-27B (xhigh) | **34** | #1/142 | 43.8 tok/s | 256k |
| Qwen3.6-35B-A3B (Reasoning) | 18 | — | 124.8 tok/s（"notably fast"） | 262k |
| GLM-4.7-Flash (Reasoning) | 15 | #18/142 | 60.4 tok/s | 200k |
| gpt-oss-120b (high) | 12 | #9/65 | 211.0 tok/s | 131k |
| GLM-4.5-Air | 11 | #15/65 | 76.9 tok/s | 128k |
| gpt-oss-20b (high) | 9 | — | 166.2 tok/s | 131k |
| Qwen3-Coder-Next | 9 | #5/39（非推論クラス） | 98.3 tok/s | 256k |
| Qwen3-VL-30B-A3B-Instruct（VLM） | 8 | — | 113.5 tok/s | 256k |

既知の実測値（このMac・ローカル4bit/8bit）と比べると、Qwen3.8-27B は**クラウドAPIでも Intelligence Index 1位**（34点、142モデル中）であり、他候補は軒並み半分以下のスコア。GLM-4.5-Air と GLM-4.7-Flash は、Artificial Analysis のページ自体が両方とも「非推奨（deprecated）」と注記している — GLM-4.5-Air は GLM-4.7-Flash に、GLM-4.7-Flash は Z AI 自身が GLM-5 を推奨、と明記されている [要約経由: "The page indicates this model is deprecated, with Z AI recommending their newer GLM-5 release instead."]。ただし GLM-5系は 320B超で64GBには収まらない。

出典: [artificialanalysis.ai/models/qwen3-8-27b](https://artificialanalysis.ai/models/qwen3-8-27b)、[.../qwen3-6-35b-a3b](https://artificialanalysis.ai/models/qwen3-6-35b-a3b)、[.../glm-4-7-flash](https://artificialanalysis.ai/models/glm-4-7-flash)、[.../gpt-oss-120b](https://artificialanalysis.ai/models/gpt-oss-120b)、[.../glm-4-5-air](https://artificialanalysis.ai/models/glm-4-5-air)、[.../gpt-oss-20b](https://artificialanalysis.ai/models/gpt-oss-20b)、[.../qwen3-coder-next](https://artificialanalysis.ai/models/qwen3-coder-next)、[.../qwen3-vl-30b-a3b-instruct](https://artificialanalysis.ai/models/qwen3-vl-30b-a3b-instruct)（すべて要約経由フェッチ）

### 日本語評価は到達不能

- Nejumi リーダーボード（[wandb.ai/wandb-japan/llm-leaderboard4](https://wandb.ai/wandb-japan/llm-leaderboard4/reports/Nejumi-LLM-4--Vmlldzo5NTI0MDI0)）は JS レンダリングでデータテーブルが取得できず [到達不能]。
- llm-jp の HF Space リーダーボード（[huggingface.co/spaces/llm-jp/open-japanese-llm-leaderboard](https://huggingface.co/spaces/llm-jp/open-japanese-llm-leaderboard)）は "runtime error: The container could not be located when the pod was terminated" で**現在停止中** [到達不能]。
- shisa.ai のブログ（[blog.shisa.ai](https://blog.shisa.ai/)）には GLM-4.5-Air/4.7-Flash・Qwen3.6/3.8・gpt-oss の日本語評価記事は**存在しない**。あるのは2025年4-5月の Qwen3 / Llama 4 の記事のみ [要約経由]。
- **結論: GLM-4.5-Air、GLM-4.7-Flash、Qwen3.6-35B-A3B、Qwen3.8-27B、gpt-oss 系のいずれについても、日本語能力を定量比較できる独立リーダーボードのスコアは今回到達できなかった。**

### 長文脈での否定的証拠（重要）

GitHub `ml-explore/mlx-lm` のIssue検索（直接取得、`api.github.com/search/issues`）:

- **[#1480](https://github.com/ml-explore/mlx-lm/issues/1480)**（open, 2026-07-06作成）: "MLX/Metal OOM during long-context prefill for Qwen3.6/Qwen3.5 hybrid MoE despite only 10 KV-cache layers" — 本文引用: "I am seeing a reproducible MLX/Metal OOM during long-context prefill with `mlx-community/Qwen3.6-35B-A3B-4bit` on Apple Silicon. ... prompt prefill crashes around 176K tokens with a Metal command buffer OOM. System memory is not close to exhausted". 報告環境は **128GB** の Mac Studio — 64GB機ならさらに早く破綻する可能性が高い。これは今回の既知実測モデルである Qwen3.6-35B-A3B 自体の不具合。
- **[#1587](https://github.com/ml-explore/mlx-lm/issues/1587)**（open）: "QuantizedKVCache shows higher peak memory than fp16 KVCache (worse at longer contexts)" — KVキャッシュを量子化しても長文脈では逆にメモリを食う場合がある、という一般的な注意点。
- **[#1438](https://github.com/ml-explore/mlx-lm/issues/1438)**（open）: "Feature request: MoE expert streaming / SSD offload for memory-constrained Apple Silicon (run 395 GB GLM-5.2-mxfp4 on 128 GB RAM)" — 大型MoEをメモリ制約のあるAppleシリコンで動かす一般的な難しさを示す傍証。

LM Studio バグトラッカー（直接取得）:

- **[#2255](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2255)**（open, 2026-08-09作成）: "Model crashes without additional information (Exit code: null) on concurrent predict requests — qwen3.6-35b-a3b via MLX on Apple M2 Max" — 本文引用: "The model crashes reproducibly when two prediction streams hit the same model simultaneously... Both streams die immediately with: Error: The model has crashed without additional information. (Exit code: null)"。手順の環境欄には "Mac chip: Apple M2 Max"、"Model: `qwen/qwen3.6-35b-a3b` (MLX backend)" と明記。これは Open WebUI からの利用と裏で走るバックグラウンド処理が重なった場合に起きうる不具合。
- **[#1105](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1105)**（open, 2025-10-13作成）: "Structured Output doesn't work for GPT-OSS-20b and GBT-OSS-120b"
- **[#2264](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2264)**（open, 2026-08-11作成）: "gpt-oss: second system/developer message is dropped when converting OpenAI-compatible chat messages to Harmony input"
- **[#876](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/876)** / **[#2182](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2182)**: gpt-oss のツールコール・harmony形式まわりの不具合が2025-08から2026-07まで断続的に報告されている。

これらは開発相談（ツール呼び出しを使う）用途と長文ログ読み込み用途の両方に直結する否定的証拠であり、**Qwen3.6-35B-A3B と gpt-oss 系の両方に、それぞれ別種の未解決不具合がある**ことが直接ソースから確認できた。

---

## 4. 実態（公開リポジトリ・配布数）

Hugging Face のダウンロード数を「実際に使われている量」の代理指標として直接取得（星数や push日時に相当するモデル版の指標は HF には無いため、ダウンロード数と `mlx-community` での量子化バリエーション数を採用）。

| モデル (mlx-community 配布) | ダウンロード数 |
|---|---:|
| `Qwen3.8-27B-4bit` | 82,706 |
| `Qwen3.8-27B-8bit` | 79,338 |
| `Qwen3.6-35B-A3B-4bit` | 26,265 |
| `Qwen3.6-27B-4bit` | 51,239 |
| `gpt-oss-20b-MXFP4-Q8` | 268,067 |
| `Kimi-K2.5` | 153,076（サイズ的に64GBでは使えないにもかかわらず高ダウンロード） |
| `gpt-oss-120b-MXFP4-Q8` | 5,854 |
| `gpt-oss-120b-MXFP4-Q4` | 1,424 |
| `GLM-4.5-Air-8bit` | 1,283 |
| `GLM-4.5-Air-4bit` | 859 |
| `GLM-4.5-Air-3bit` | 641 |
| `GLM-4.7-Flash-4bit` | 5,354 |
| `GLM-4.7-Flash-8bit` | 2,378 |
| `Qwen3-Coder-Next-4bit` | 7,075 |
| `Qwen3-VL-30B-A3B-Instruct-4bit` | 1,366 |
| `GLM-4.6V-Flash-5bit` | 見つかったが件数は上記参照 |

出典: [huggingface.co/api/models?author=mlx-community](https://huggingface.co)（直接取得）。

解釈: Qwen 系（既知実測の 3.8-27B / 3.6-35B-A3B）は MLX 量子化のダウンロード数で他候補を圧倒しており、コミュニティでの採用は厚い。GLM-4.5-Air の MLX 量子化は数百〜千件台と薄く、GLM-4.7-Flash の方がやや多い。gpt-oss-20b は非常に多いが gpt-oss-**120b** は Qwen3.6-35B-A3B の 1/5 程度のダウンロード数にとどまり、64GB級Macでの採用はまだ薄いと読める。この数字はバイアスとして「ダウンロード数が多い=品質が高い」ではなく「早く出た・話題になった・小型で誰でも試せる」ことも反映する点に注意。

---

## 5. 用途別の整理

推奨は書かない。各用途について「向く可能性がある事実」と「向かない可能性がある事実」を両方並べる。

### (1) 日本語の文章を書く・直す

- 直接比較できる独立の日本語評価は今回**到達できなかった**（Nejumi・llm-jp Space・shisa.ai いずれも不可、上記「測定された証拠」参照）。
- Gemma 系は伝統的に多言語・文章生成に強いという評判があるが、Gemma-4-31B-it についての日本語スコアは今回見つけられなかった [not found]。
- Qwen3.8-27B は AA Intelligence Index で最上位（34点）だが、これは日本語特化の指標ではなく英語中心の総合指標であり、日本語品質への外挿は [unverified]。
- 結論: この用途だけで他候補と比べる定量的根拠は今回そろわなかった。

### (2) コードの読解・レビュー・開発相談

- GLM-4.7-Flash のベンダー README は自社ベンチマークで SWE-bench Verified 59.2（Qwen3-30B-A3B-Thinking-2507 は 22.0、GPT-OSS-20B は 34.0）と主張している（出典: [zai-org/GLM-4.7-Flash README](https://huggingface.co/zai-org/GLM-4.7-Flash/raw/main/README.md)）。ベンダー自身の数値であり中立的な追試ではない点に注意。
- gpt-oss 系は LM Studio 上でのツールコール・構造化出力に既知の不具合が複数件、2025-10から2026-08まで継続して報告されている（[#1105](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1105)、[#2264](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2264) 等）。ツール呼び出しを伴う開発相談用途にはマイナス材料。
- Qwen3-Coder-Next はコーディング特化モデルとして2026年2月にリリースされたが、AA Intelligence Index は9点と低い（非推論クラス比較のため単純比較不可）。79.7B/3B活性、4bitで44.86GBとほぼ予算上限。
- Devstral-Small-2-24B はコーディング特化の密モデルだが、今回 AA のスコアページを確認できておらず [not found]。

### (3) 長い文書・大量のログの読み込み（長文脈）

- Qwen3.6-35B-A3B は AA 上のコンテキスト window 262k を謳うが、**同モデルの MLX 4bit 版で128GBのMac Studioでも約176Kトークンのプリフィルで Metal OOM を起こす再現バグが未解決で残っている**（[mlx-lm #1480](https://github.com/ml-explore/mlx-lm/issues/1480)）。64GB機ではこれより手前で破綻する可能性が高い [unverified だが方向性は明確]。
- 量子化KVキャッシュは長文脈でかえってメモリを食う場合があるという報告もある（[mlx-lm #1587](https://github.com/ml-explore/mlx-lm/issues/1587)）。
- 結論: 長文脈は「コンテキストウィンドウの公称値」と「実際にメモリが持つ長さ」が一致しない、という否定的な実測が複数系統から出ている。

### (4) スマホから Open WebUI で気軽に話す相手（速さ重視）

- ローカル実測（既知）: `Qwen3.6-35B-A3B@8bit` 53.7 tok/s、`Qwen3.8-27B@4bit` 15.0 tok/s、`bonsai-27b@2bit` 25.1 tok/s。MoEで活性パラメータが小さいモデルほど速いという傾向は、クラウド計測（AA: Qwen3.6-35B-A3B 124.8 tok/s、gpt-oss-120b 211.0 tok/s、gpt-oss-20b 166.2 tok/s）とも方向は一致する。
- ただし Qwen3.6-35B-A3B には同時リクエストでのクラッシュ報告がある（[LM Studio #2255](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2255)、Apple M2 Max、MLXバックエンド）。スマホからの単発チャットなら同時多重リクエストになりにくいが、Open WebUI や裏で動く別ツールと同時使用する場合は再現条件に該当しうる。
- GLM-4.7-Flash・gpt-oss-20b はこのMac上でのローカルtok/s実測が**今回は取れていない**（既知実測の対象外だったため）[not found]。

### (5) 画像を読む（視覚言語モデル）

- `Qwen3-VL-30B-A3B-Instruct`（31.07B/3B MoE、apache-2.0、AA Index 8、[deprecated per AA — 後継はテキストのみのQwen3.5-35B-A3Bで、視覚版の後継は見つからず]）。MLX 4bit配布あり（ダウンロード1,366件）。
- `GLM-4.6V-Flash`（10.29B、MIT）。MLX 5bit配布で8.27GBと小さく軽い。AA上のスコアページは見つからなかった [not found]。
- Qwen3.5/3.6世代の視覚言語モデル（Qwen3.5-VL, Qwen3.6-VL）はHugging Face上に**存在しない**ことを確認した（検索結果ゼロ件）。現行のQwen系視覚モデルは2025年10月リリースのQwen3-VL-30B-A3B-Instructのまま止まっている。

### (6) Omarchy が止まったときの deterministic の予備

- これは比較対象ではなく、[2026-09-27-deterministic-falls-back-to-the-mac.md](../decisions/2026-09-27-deterministic-falls-back-to-the-mac.md) で条件が固定されている：Mac は Omarchy と同じ Qwen3.8-27B を LM Studio 上で JIT 読み込み（ttl 600秒、`disable_background_health_check: true`）する。他のモデルへの差し替えは決定の対象外。

### 1本だけ常駐させる場合 と JIT切り替えの場合の違い（事実整理）

- **1本だけ常駐**させる場合、(6)の予備要件から Qwen3.8-27B（16.08GB）は待機コストとして常時メモリを持つか、あるいは常駐モデルをJITにして都度切り替えるかの二択になる。GLM-4.5-Air（3bitで46.81GB）や gpt-oss-120b（62.36GB）を常駐させると、(6)のJIT読み込み分の空きが無くなる可能性が高い（サイズの重なりは実測されていないため [unverified]）。
- **JIT切り替え**にする場合、LM Studio 側の `ttl` とオートエビクトの挙動は決定記録で gpt-oss-120b や GLM-4.5-Air については触れられておらず、複数の大型モデルをJITで使い分ける設定の実践例は今回見つからなかった [not found]。

---

## 6. 比較表（総合）

| モデル | 種類 | 量子化とサイズ(4bit系) | 実測 tok/s | 品質指標 | 日本語 | ライセンス | 弱点 |
|---|---|---|---|---|---|---|---|
| Qwen3.8-27B | dense 27.8B | 4bit 16.08GB（既知実測） | **15.0**（このMac実測, 4bit） | AA Index **34**, #1/142 | 不明[not found] | apache-2.0 | dense のため帯域あたりの速度は遅い |
| Qwen3.6-35B-A3B | MoE 36B/~3B活性 | 8bit 37.75GB（既知実測） | **53.7**（このMac実測, 8bit） | AA Index 18 | 不明[not found] | apache-2.0 | 長文脈プリフィルでMetal OOM再現(#1480)、同時リクエストでクラッシュ(#2255) |
| bonsai-27b | 不明系統 2bit | 2bit 8.52GB（既知実測） | **25.1**（このMac実測） | ベンダー未検証[not found] | 不明[not found] | 不明[not found] | 量子化ビット数が低く品質未検証 |
| GLM-4.5-Air | MoE 107B/12B活性 | 4bit 60.16GB / 3bit 46.81GB | 25.564（実践者実測, 3bit, **M2** 64GBでピーク47.687GB） | AA Index 11, #15/65, ベンダー非推奨扱い | 不明[not found] | MIT | 64GB機では3bitでもメモリ逼迫（実践者実測: 常用アプリを閉じる必要） |
| GLM-4.7-Flash | MoE 31.2B/~3B活性 | 4bit 16.87GB / 8bit 31.84GB | このMacでの実測なし[not found] | AA Index 15, #18/142（AA・Z AI自身も非推奨扱いでGLM-5推奨） | 不明[not found] | MIT | ベンダーのSWE-bench数値は自社測定 |
| gpt-oss-120b | MoE 117B/5.1B活性 | MXFP4 4bit 62.36GB | このMacでの実測なし[not found] | AA Index 12, #9/65 | 不明[not found] | apache-2.0 | 64GB機ではOS/開発作業分の余裕がほぼ無い。LM Studioでツール呼び出し・構造化出力の不具合が継続 |
| gpt-oss-20b | MoE 21B/3.6B活性 | 小さい（数GB級） | このMacでの実測なし[not found] | AA Index 9 | 不明[not found] | apache-2.0 | 同上の不具合。「大きめ」の候補ではない |
| Qwen3-Coder-Next | MoE 79.7B/3B活性 | 4bit 44.86GB | このMacでの実測なし[not found] | AA Index 9（非推論クラス比較） | 不明[not found] | apache-2.0 | 4bitでも予算上限ぎりぎり |
| Kimi-K2.5 | MoE 1.03兆/巨大 | 4bitでも約500GB超 | 該当なし | 未確認[not found] | 不明[not found] | other/modified-mit | **64GBでは物理的に不可能** |
| Gemma-4-31B-it | dense 31.27B | サイズ未計測 | このMacでの実測なし[not found] | AAページ未確認[not found] | 不明[not found] | apache-2.0 | 品質指標が今回そろわなかった |
| Devstral-Small-2-24B | dense 24B | ~24GB級 | このMacでの実測なし[not found] | AAページ未確認[not found] | 不明[not found] | apache-2.0 | 品質指標が今回そろわなかった |
| Qwen3-VL-30B-A3B-Instruct (VLM) | MoE 31B/3B活性 | 4bit（サイズ未計測、DL1,366） | このMacでの実測なし[not found] | AA Index 8（deprecated扱い） | 不明[not found] | apache-2.0 | AAが非推奨扱い、後継の視覚版が存在しない |
| GLM-4.6V-Flash (VLM) | 10.29B | 5bit 8.27GB | このMacでの実測なし[not found] | AAページ未確認[not found] | 不明[not found] | MIT | 品質指標が今回そろわなかった |

---

## 判定（この証拠が支持すること・支持しないこと）

**この証拠が支持すること:**

1. 「Macでもっと遅くていいからパラメーターの大きいモデルを」という発想自体は、GLM-4.5-Air（3bit・実践者実測47.687GBピーク）や gpt-oss-120b（4bit・62.36GB実配布）のような大型MoEが実在し、ライセンスも MIT / apache-2.0 で使える形で公開されている、という点では成立する。
2. ただしその「大きいモデル」を64GBのMacで**開発作業と同時に**常駐させる余地は、実践者の実測（Simon Willisonの47.687GBピーク、残り16GB）から見て、35〜45GBという見積もりの上限に迫るか超える。GLM-4.5-Airは3bitでも46.81GB（HF配布サイズ）であり、35〜45GBの予算内に収まるとは言い切れない。
3. GLM-4.7-Flash（30B級MoE、4bit 16.87GB）は、サイズの面では最も予算に余裕があり、ベンダー自身のSWE-bench主張も強気だが、AA独立指標でのIntelligence Indexは15点にとどまり、AA自身とZ AI自身の両方が「非推奨（新しいGLM-5系を使え）」と位置づけている。
4. 既知実測済みの Qwen3.6-35B-A3B（このMacで53.7 tok/s）は、独立クラウド指標（AA Index 18）でもGLM-4.5-Air・GLM-4.7-Flashより上だが、**長文脈プリフィルでのMetal OOM再現バグ（#1480）と同時リクエストでのクラッシュ（#2255）が未解決のまま残っている**——どちらも直接GitHub Issueで確認した一次情報であり、単なる噂ではない。
5. gpt-oss-120bはサイズ(62.36GB)の面で64GBのMacをほぼ埋めてしまい、LM Studio上でのツール呼び出し・構造化出力の不具合が2025年10月から2026年8月まで断続的に報告され続けている。

**この証拠が支持しないこと:**

- 「GLM-4.6-Air」というモデル名を前提にした比較 — そのモデルは存在しない。
- 日本語の文章品質での定量順位付け — 到達可能な独立リーダーボードが今回すべて不通だった。
- Mac上でのGLM-4.7-Flash・gpt-oss-120b・Qwen3-Coder-Next・VLM候補群の**実際のtok/s** — このMacでの実測値はいずれも無い（Qwen3.8-27B/Qwen3.6-35B-A3B/bonsai-27bの3つだけが実測済み）。
- 「35〜45GBが現実的」という数値の**ベンダー公式の裏付け** — LM StudioにもAppleにもMLXにも、この具体的な数値を導出する公式ドキュメントは見つからなかった。実践者の実測(47.687GBピークで16GB残)から逆算する以外の根拠は無い。

**足りないもの（このレポートだけでは埋まらない）:**

- このMac(M4 Pro)実機でのGLM-4.7-Flash・gpt-oss-120b・Qwen3-Coder-Next・VLM候補のtok/s実測。
- 到達可能な日本語ベンチマーク（Nejumi・llm-jp Spaceが復旧するか、代替の独立ソースを探す必要がある）。
- 64GB機（M4 Pro、47.687GBよりも厳しい可能性がある機体）でのGLM-4.5-Air実測 — Willisonの記録はM2機。
- 複数の大型モデルをJITで切り替える運用の実例。

---

## 「前例が見つからなかった」一覧

- GLM-4.6-Air という名前のモデル自体が存在しない。
- 64GB M4 Pro 実機でのGLM-4.5-Air / GLM-4.7-Flash / gpt-oss-120b / Qwen3-Coder-Next のtok/s実測記事・実践者証言。
- GLM-4.5-Air・GLM-4.7-Flash・gpt-oss系・Qwen3.6/3.8の日本語能力を横断比較できる、到達可能な独立リーダーボードのスコア。
- 複数の大型モデル（例: Qwen3.8-27B予備 + GLM-4.7-Flash常駐）を1台のMac上でJIT切り替えしながら安定運用している設定例・実践報告。
- Qwen3.5-VL / Qwen3.6-VL の存在（検索してゼロ件、つまり現行世代の視覚版アップデートは無い）。
