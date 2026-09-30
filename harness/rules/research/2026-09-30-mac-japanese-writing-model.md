# Mac（64GB, LM Studio / MLX・GGUF）で「自然な日本語の文章を書く」役に使うモデル 調査記録

調査日 2026-09-30。この用途は [2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md) が扱った「常駐する汎用モデル」とは別枠で、AIっぽい日本語の書き直し・レポート/メモ/ブログ下書き・日本語校正のための **用途別スロット**（コーディング/エージェント用モデルとは別に、都度JITロードする想定、目標メモリ ≤ 約40GB）。前回の同シリーズ調査（Nejumiリーダーボード=JSレンダリングで不通、llm-jp HF Spaceリーダーボード=停止中）で日本語の独立評価に到達できなかった点が今回のギャップ。本調査ではこのギャップを別経路（後述）で一部埋められた。

## 方法と検証の凡例

- **直接取得**: `curl` で Hugging Face API (`huggingface.co/api/models/...`)、GitHub public search/contents API (`api.github.com`)、Zenn 公開API (`zenn.dev/api/search`, `zenn.dev/api/articles`)、GitHub raw (`raw.githubusercontent.com`) を取得。認証トークンは使用していない。
- **要約経由 [要約経由]**: `WebFetch` は一度要約モデルを経由する。各モデルの README、Zenn個人記事の内容、PLaMo 3.0 Prime の紹介記事はこの経路。
- **到達不能**: LM Studio のモデルカタログページ（`lmstudio.ai/models?searchQuery=...`）はJSレンダリングで検索クエリの文字列がHTMLに埋め込まれるだけで実際の検索結果が取得できず。Nejumiリーダーボード（wandb）とllm-jp HF Spaceリーダーボードは前回調査で到達不能と確認済みのため今回は再検証していない（状態が変わっている可能性はあるが未確認）。
- **重要な制約**: このセッションは `WebSearch` の予算を使い切っており（"this session has used its web search budget (200 of 200)"）、実践者調査（レンズ2）はすべて Zenn の公開JSON API (`zenn.dev/api/search?q=...&source=articles`) を直接叩いて代替した。Qiita・X（旧Twitter）・note.com の横断検索は今回行えていない — 「見つからなかった」ではなく「試せていない」。
- 日本語のベンチマーク到達不能というギャップは、`swallow-llm.github.io`（Swallowリーダーボード、JSレンダリングで同様に不通）の**裏側のデータファイル**（`github.com/swallow-llm/leaderboard` の `_data/model.yml`、GitHub raw で直接取得可能な静的YAML）を発見したことで、部分的に解消した。これは要約経由ではなく直接取得したYAMLの生データ。

---

## 1. ベンダー

### 各社の現行ラインナップ（Hugging Face API で直接確認、2026-09-30時点）

| 系統 | 最新の主要リリース | 日付 | ライセンス | 備考 |
|---|---|---|---|---|
| **LLM-jp**（国立情報学研究所 主導） | `llm-jp/llm-jp-4-33b-thinking`（Dense 33.2B） | 2026-08-14 | apache-2.0 | GGUF配布は `llm-jp-4-33b-thinking-gguf` に Q4_K_M(20.16GB)・BF16(66.4GB)のみ。MLX変換は`mlx-community`に**存在しない**（確認済み） |
| LLM-jp（さらに新しい版） | `llm-jp/llm-jp-4.1-33b-thinking`（+ GGUF版） | 2026-09-28（**調査の2日前**） | apache-2.0 | リリース直後のためコミュニティ量子化・独立評価とも未整備 |
| **Swallow**（東工大 tokyotech-llm） | `tokyotech-llm/Qwen3-Swallow-32B-RL-v0.2`（Qwen3-32Bの継続事前学習+RL） | 2026-02-23 | apache-2.0 | 公式AWQ-INT4 19.3GB。有志MLX変換（`tocchitocchi`, `tokimoa` 個人アカウント）が4bit 18.4GB/8bit 34.8GB/fp16で存在 |
| Swallow（大型） | `tokyotech-llm/GPT-OSS-Swallow-120B-RL-v0.1-MXFP4` | 2026-05-28 | apache-2.0 | gpt-oss-120bベース、サイズはベースと同水準（約60GB級）で**40GB予算を超える** |
| **Sarashina**（SB Intuitions） | `sbintuitions/sarashina2.2-3b-instruct-v0.1` | 2026-08-25 | 要確認[not found] | **最大の指示チューニング済みモデルが3B**。30B級の新しいinstructモデルは見つからなかった |
| **PLaMo**（Preferred Networks） | `pfnet/plamo-3-nict-31b-base`（31B, **ベースモデル**） | 2026-08-21 | 要確認[not found] | instructチューニング版が存在しない。ビジネス向け新フラッグシップ「PLaMo 3.0 Prime」（2026-06-22発表）はAPI/オンプレ提供のみで**オープンウェイトではない**（[Zenn記事、要約経由](https://zenn.dev/neotechpark/articles/251b1e576a875f)） |
| **Rakuten AI** | `Rakuten/RakutenAI-3.0` | 2026-03-17 | 要確認[not found] | ダウンロード430件と薄く、サイズ・量子化配布とも未確認 |
| **CyberAgent** | `cyberagent/CAT-Paws-8B`, `CAT-Thinking-8B` | 2026-07-14 | apache-2.0 | Qwen3-Swallow-8B-CPT-v0.2 ベースの**エージェント/コーディング特化**モデル。README自身が「シングルターンのコーディング・数学では他モデルに劣る」と明記（[README、要約経由](https://huggingface.co/cyberagent/CAT-Paws-8B/raw/main/README.md)）。文章執筆用途ではない |
| **ELYZA** | `elyza/ELYZA-Shortcut-1.0-Qwen-32B`, `ELYZA-Thinking-1.0-Qwen-32B` | 2025-04-30 | 要確認[not found] | 汎用フラッグシップの`Llama-3-ELYZA-JP-8B`は2024-06から更新なし。ダウンロード数も32B系は99〜108件と薄い |
| **Karakuri** | `karakuri-ai/karakuri-vl-2-8b-thinking-2603` | 2026-03-27 | 要確認[not found] | 視覚言語モデルへ舵を切っており、汎用フラッグシップ`karakuri-lm-70b-chat-v0.1`は2024-05から更新なし |
| **Stockmark** | `stockmark/Stockmark-2-100B-Instruct` | 2025-09-25 | 要確認[not found] | 100B denseで4bit量子化でも40GB予算を大きく超える |
| **Gemma**（Google, 参考） | `google/gemma-4-31B-it`（31.27B, マルチモーダル） | [前回調査で確認済み] | apache-2.0 | `mlx-community/gemma-4-31b-it-4bit` 公式変換 18.41GB、ダウンロード41,035件 |

出典（HF API直叩き）: [llm-jp/llm-jp-4-33b-thinking](https://huggingface.co/api/models/llm-jp/llm-jp-4-33b-thinking)、[llm-jp-4-33b-thinking-gguf](https://huggingface.co/api/models/llm-jp/llm-jp-4-33b-thinking-gguf)、[tokyotech-llm/Qwen3-Swallow-32B-RL-v0.2](https://huggingface.co/api/models/tokyotech-llm/Qwen3-Swallow-32B-RL-v0.2)、各社 `?author=` 一覧API。

### llm-jp-4-33b-thinking の重大な負の事実: チャットテンプレートが gpt-oss と同じ Harmony 形式

`llm-jp-4-33b-thinking` の `tokenizer_config.chat_template` を直接取得したところ、`<|start|>system<|message|>` / `<|channel|>analysis<|message|>` / `<|channel|>final<|message|>` というトークン構造で、これは OpenAI の gpt-oss シリーズが使う **Harmony 形式そのもの**だった（出典: [huggingface.co/api/models/llm-jp/llm-jp-4-33b-thinking](https://huggingface.co/api/models/llm-jp/llm-jp-4-33b-thinking) 直接取得、`config.tokenizer_config.chat_template` フィールド）。さらに `llama.cpp` の Pull Request を直接確認すると、この構造を明示的に裏付けている：

> "LLM-jp-4.1 uses the GPT-OSS Harmony format with two differences: the tokenizer decodes a space after every special token... and parallel tool calls are consecutive assistant messages separated by `<|end|>`. The GPT-OSS handler rejects this output (`500 does not match the expected peg-native format`...)"
> — [ggml-org/llama.cpp PR #29681](https://github.com/ggml-org/llama.cpp/pull/29681)（直接取得, 2026-09-30時点で `open`, `merged: false`）

前回調査（[2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md)）は gpt-oss 系で LM Studio の Harmony パース不具合（[#2264](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2264) 二番目のsystem/developerメッセージが消える、[#876](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/876)・[#2182](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2182) ツールコール不具合）を直接ソースで確認済み。llm-jp-4系はこれと**同じ形式を採用している**ため、構造的に同種の不具合を踏む可能性がある——ただしllm-jp-4自体でこの不具合が実際に報告された例はLM Studioバグトラッカー上で見つからなかった（後述レンズ4）。これは形式の一致からの推論であり、**[unverified: llm-jp-4での実際の不具合報告はまだ無い]**。

---

## 2. 測定された証拠

### 日本語の独立評価: Swallow リーダーボードの生データに到達（前回の未到達を一部解消）

`swallow-llm.github.io` の表示ページ自体はJSレンダリングで前回同様不通だが、そのビルド元である GitHub リポジトリ [swallow-llm/leaderboard](https://github.com/swallow-llm/leaderboard)（最終更新 2026-06-24、`build.py`/`deploy.sh` を持つ現役プロジェクト）の `_data/model.yml` を `raw.githubusercontent.com` 経由で直接取得できた。評価方法は `_data/task_post.yml` に明記されている：

> "日本語 MT-Bench: マルチターン対話能力を測定するMT-Benchの日本語版（Nejumi LLMリーダーボード版）を用いました。設問はv4を、模範回答はv2の誤答を修正したものを採用しています。評価スコアは0（最低）から1（最高）"
> — [swallow-llm/leaderboard `_data/task_post.yml`](https://raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/task_post.yml)（直接取得）

採点モデルは `_data/about.yml` の更新履歴に明記：

> "日本語と英語のMT-Benchの自動採点モデルをGPT-5.2（推論off）に変更しました。この変更は幻覚・誤答・指示追従違反・対話の破綻に対する採点（減点）をより厳密に行うことを狙っています。"
> — [swallow-llm/leaderboard `_data/about.yml`](https://raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/about.yml)（直接取得）

この日本語MT-Benchには `writing`（文章執筆）と `roleplay` のサブスコアがあり、「自然な日本語の文章を書く」に最も近い定量指標として採用する。**ただし注意**: これは短い創作課題をLLM審判が採点する一般的なMT-Benchの執筆カテゴリであり、「AIっぽい文章を自然な日本語に書き直す」という具体的タスクを測るベンチマークではない——そのようなベンチマークはこの調査では見つからなかった（後述「前例なし」参照）。

### 40GB予算内で比較できるモデルの ja_mtb（日本語MT-Bench）スコア

| モデル | params/active | ja_mtb avg | **writing** | roleplay | 40GB予算に収まるか |
|---|---:|---:|---:|---:|---|
| gpt-oss-120b（ベース） | 120B/5.1B | 0.757 | 0.68 | 0.704 | **収まらない**（MXFP4 4bit 62.36GB、前回調査で実測済み） |
| GPT-OSS-Swallow-120B-RL-v0.1 | 120B/5.1B | 0.772 | **0.707**（全候補中最高） | 0.716 | **収まらない**（サイズは元gpt-oss-120b級） |
| **Gemma 4 31B IT** | 33B/33B | **0.815**（40GB予算内で最高） | **0.748**（40GB予算内で最高） | 0.75 | 収まる（MLX4bit 18.41GB） |
| Qwen3-Swallow-32B-RL-v0.2 | 33B/33B | 0.753 | 0.665 | 0.71 | 収まる（MLX4bit 18.4GB/AWQ-INT4 19.3GB） |
| llm-jp-4-32b-a3b-thinking | 32B/32B（"a3b"表記だがリーダーボード上のactive_paramsは32、Qwen3-A3B系の命名慣習(3B活性)との整合性は**未確認・要検証**） | 0.726 | 0.663 | 0.685 | 収まる（GGUF Q4_K_M、有志imatrix版あり） |
| Qwen3-32B（無チューニング, 比較基準） | 33B/33B | 0.722 | 0.631 | 0.642 | 収まる |
| GPT-OSS-Swallow-20B-RL-v0.1 | 22B/3.6B | 0.726 | 0.613 | 0.662 | 収まる（より小さい） |
| Gemma 3 27B IT（前世代, 参考） | 27B/27B | 0.691 | 0.639 | 0.705 | 収まる |
| ELYZA-Shortcut-1.0-Qwen-32B | 33B/33B | 0.675 | 0.642 | 0.638 | 収まる |
| ELYZA-Thinking-1.0-Qwen-32B | 33B/33B | 0.664 | 0.581 | 0.636 | 収まる |

出典（すべて直接取得、`raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/model.yml`）。`llm-jp-4-33b-thinking`（8月リリースの新フラッグシップ）と`llm-jp-4.1`系はこのリーダーボードに**まだ収録されていない**——新しすぎて独立評価が存在しない、というのがそのまま結論になる。

### 到達できなかった他の日本語評価

- **ELYZA-tasks-100**、**llm-jp-eval**、**Shaberi**（lightblue）: このセッションでは着手できなかった（WebSearch予算切れ、時間配分の都合）。「存在しない」ではなく「試せていない」[gap]。
- **Nejumi リーダーボード**（wandb）、**llm-jp HF Spaceリーダーボード**: 前回調査時点でJSレンダリング不通・停止中と確認済み。今回は再検証していない（状態が変化している可能性はある）[未再検証]。

---

## 3. 名前のある実践者

WebSearch予算が枯渇していたため、Zenn の公開JSON API（`zenn.dev/api/search?q=...&source=articles`）で直接検索し、該当記事をWebFetchで内容確認した。Qiita・X・noteの横断検索は今回行えていない。

### Swallowチーム自身（Kazuki Fujii, tokyotech-llm）— ベンダー寄りだが日本語一次情報として貴重

[zenn.dev/tokyotech_lm/articles/fa56f10e51fd7d](https://zenn.dev/tokyotech_lm/articles/fa56f10e51fd7d)（liked 157, bookmarked 63、2026-02-20公開）[要約経由]

- "Qwen3-Swallow-32B-RL-v0.2 surpasses the base Qwen3-32B model on Japanese Q&A tasks (JamC-QA) while maintaining English performance" — チーム自身の主張。独立追試ではない点に注意。
- 量子化: 公式にAWQ-INT4/GPTQ-INT4を用意したが、"GPTQ versions were depublished due to inference instability"（**GPTQ版は推論不安定のため公開停止**）——これは公表された負の事実。
- 自己申告の弱点: "Thinking trajectories for Japanese inputs remain 'English mixed with Japanese' rather than fully Japanese"（日本語入力でも思考過程が英日混在のまま）、"future issue" として認めている。

### black_lotus（個人ブログ「ローカルLLM」シリーズ）— M4 MacBook Air 16GB での実測と負の証拠

- **#2**: [zenn.dev/black_lotus/articles/393aecc980ed20](https://zenn.dev/black_lotus/articles/393aecc980ed20)（2026-04-30）[要約経由] — `llm-jp-4-8b-thinking-Q4_K_M.gguf`（5.3GB）を M4 MacBook Air 16GB + Ollama で実行。メモリ使用量6.5GB、GPU使用率100%、"response speed is roughly the same"（Qwen3比）。問題なく動作。
- **#3**: [zenn.dev/black_lotus/articles/2f68d0790002d9](https://zenn.dev/black_lotus/articles/2f68d0790002d9)（2026-05-10）[要約経由] — 同じM4 MacBook Air 16GB上でQwen3(8B)・LLM-jp-4(8B)・Gemma3(4B)を比較。**重要な負の証拠**: "形式的な専門性が高いが内容は捏造"——LLM-jp-4(8B)は表や引用など見た目は専門的だが、物理分野の事実確認では広範な捏造が見つかった。結論: "8Bモデルは「文章を整える道具」として使うのが妥当"（知識源ではなく文章整形の道具として使うべき）。Gemma3(4B)は読みやすさで"最も安定している"と評価された。
  - **この調査への意味**: 今回探している用途（AIっぽい文章の書き直し・校正）はまさに「文章を整える道具」に該当する。black_lotus氏の結論はこの用途に対して肯定的だが、**検証対象は8Bクラスのみ**であり、32B/33Bクラスへの外挿は[unverified]。Gemma系が読みやすさで安定という定性評価は、前節のリーダーボードでGemma-4-31B-ITがwriting/roleplayで最高スコアだったことと方向性が一致する。

### suzumura_lab — llm-jp-4-32B の Mac Metal 対応 GGUF を独自公開

[zenn.dev/suzumura_lab/articles/0a1bdb04ec87ca](https://zenn.dev/suzumura_lab/articles/0a1bdb04ec87ca)（2026-05-03）[要約経由]

- `llm-jp-4-32b-a3b-thinking` を Q4_K_M に量子化。**モデル自身の事前学習コーパス（llm-jp-corpus-v4、学術要約15%含む）でimatrixキャリブレーションした**点が独自の工夫（汎用Web/英語Wikipediaでのキャリブレーションではなく）。
- Apple Silicon Mac 上で `brew install llama.cpp` + Metal (`-ngl 99`) でのデプロイ手順を公開——Mac上での配布・実行実績があることの直接証拠。
- 量子化前後の品質比較数値は明示されていない[not found]。

### 見つからなかった実践者記録

- Qwen3-Swallow-32B や Gemma-4-31B-IT を**Mac上で**動かした個人の実測（tok/s、メモリ）記事は見つからなかった。30Bクラスの実測はすべてクラウド/Colab/RTX（[nakanishitf氏のColab記事](https://zenn.dev/nakanishitf/articles/fd25ef1fbeb1ea)、[shunmoridev氏のRTX 5090 EXL3量子化記事](https://zenn.dev/shunmoridev/articles/46394a41674c0c)）であり、Mac実測が見つかったのは8Bクラスのみ[gap]。
- Sarashina の Mac実測記事（[shakshi3104氏、2025-03-08](https://zenn.dev/shakshi3104/articles/4a78a1cf18eabb)）は見つかったが、対象は `Sarashina2.2` の小型SLM（3B未満級）でM2 Pro Mac mini、今回の候補（30B級）とはサイズが違いすぎるため比較材料にならない。

---

## 4. 実態（公開リポジトリ・配布数・保守状況）

### Hugging Face ダウンロード数（直接取得）

| モデル（配布形態） | ダウンロード数 | 備考 |
|---|---:|---|
| `mlx-community/gemma-4-31b-it-4bit` | 41,035 | 公式`mlx-community`変換、likes 49 |
| `llm-jp/llm-jp-4-33b-thinking-gguf` | 281,868 | Q4_K_M+BF16のみ、MLX変換なし |
| `tokyotech-llm/Qwen3-Swallow-32B-RL-v0.2-AWQ-INT4` | 18,148 | 公式量子化 |
| `tokyotech-llm/Qwen3-Swallow-32B-RL-v0.2` | 10,952 | 公式fp16/bf16元モデル |
| `ultimatechris/Qwen3-Swallow-32B-RL-v0.2-GGUF` | 251 | 有志GGUF変換（個人アカウント） |
| `tocchitocchi/Qwen3-Swallow-32B-RL-v0.2-MLX-4bit` | 57 | 有志MLX変換（個人アカウント、`mlx-community`ではない） |
| `tokimoa/Qwen3-Swallow-32B-RL-v0.2-MLX-4bit` | 58 | 同上、別の有志アカウント |
| `mlx-community/llm-jp-4-32b-a3b-thinking-4bit` | 112 | `mlx-community`公式扱いだが薄い |

出典: [huggingface.co/api/models?author=mlx-community](https://huggingface.co)、各リポジトリAPI直接取得。

**解釈**: Gemma-4-31B-ITのMLX変換は`mlx-community`公式かつダウンロード数が突出して多く、コミュニティでの採用が厚い。Qwen3-Swallow-32BはAWQ-INT4という東工大チーム自身の公式量子化が最も使われており、MLX変換は個人アカウントによる非公式変換にとどまる（`mlx-community`組織アカウントではない）。llm-jp-4-33b-thinkingのGGUFダウンロード数は281,868と突出しているが、MLX変換が一切存在しないため、**Macでネイティブに（MLXで）動かす選択肢が今のところ無く、GGUF/llama.cpp経由に限られる**。

### llama.cpp / LM Studio でのフォーマット対応状況

- [ggml-org/llama.cpp PR #29681](https://github.com/ggml-org/llama.cpp/pull/29681)「chat: add LLM-jp-4.1 parser」— 2026-09-30時点で **open, merged: false**。つまりllm-jp-4.1のHarmony方言パーサーはまだ本流にマージされていない状態。
- [llm-jp/llama.cpp PR #3](https://github.com/llm-jp/llama.cpp/pull/3)「common: add LLM-jp-4.1 Harmony dialect handler」— llm-jp自身のフォークでの対応PR、これも進行中。
- LM Studio バグトラッカーを "Swallow" "llm-jp" で検索した結果、**該当する不具合は0件**（ヒットした2件はMCP認証とM5 MacのMetal Tensor APIの話で無関係）。ただしこれは「まだ誰も踏んでいない」可能性が高く（利用者が少ないため）、「不具合が無い」ことの確証ではない。
- `ml-explore/mlx-lm` を "Swallow" で検索すると11件ヒットしたが、内容を確認すると英単語の"swallow"（例外を握りつぶす、の意味）にマッチした偽陽性であり、**Qwen3-Swallowモデル固有の不具合は見つからなかった**。

出典: [github.com/ggml-org/llama.cpp/pull/29681](https://github.com/ggml-org/llama.cpp/pull/29681)、[github.com/llm-jp/llama.cpp/pull/3](https://github.com/llm-jp/llama.cpp/pull/3)、`api.github.com/search/issues` 直接取得。

### プロジェクトの保守状況

`swallow-llm/leaderboard` リポジトリは最終pushが2026-06-24で、`build.py`/`deploy.sh`を持つ現役の自動ビルドパイプライン——放棄されたプロジェクトではない。`llm-jp/llm-jp-4.1-*` 系は2026-09-28公開と最新で、LLM-jpプロジェクト自体も活発（[llm-jp/awesome-japanese-llm issue #720「LLM-jp-4.1」](https://github.com/llm-jp/awesome-japanese-llm/issues/720)が同日に立っている）。

---

## 5. 比較表（総合）

| モデル | サイズ（量子化） | ライセンス | ja_mtb writing | ja_mtb avg | 実践者の定性評価 | 既知の弱点 |
|---|---|---|---:|---:|---|---|
| **Gemma 4 31B IT** | MLX 4bit **18.41GB**（`mlx-community`公式、41,035DL） | apache-2.0 | **0.748**（予算内最高） | **0.815**（予算内最高） | Gemma3系(4B)が読みやすさ最安定との定性評価あり（世代は異なるが傾向一致） | Mac実測tok/sなし、4bit以外のサイズ未確認 |
| **Qwen3-Swallow-32B-RL-v0.2** | MLX4bit 18.4GB(有志)/AWQ-INT4 19.3GB(公式)/MLX8bit 34.8GB(有志) | apache-2.0 | 0.665 | 0.753 | Swallowチーム自身の一次情報のみ、独立実践者記録なし | GPTQ版は推論不安定で公開停止済み（公表済みの負の事実）、MLX変換は非公式個人アカウント |
| llm-jp-4-32b-a3b-thinking | GGUF Q4_K_M（サイズ未計測、有志imatrix版あり） | apache-2.0 | 0.663 | 0.726 | suzumura_lab氏がMac Metal対応版を公開／black_lotus氏は同系列8B版で「内容捏造」を報告（32B版は未検証） | Harmonyチャットテンプレート採用でgpt-oss系と同種の不具合リスクを共有する可能性[unverified]、"a3b"命名と実際のactive_paramsの整合性が未確認 |
| llm-jp-4-33b-thinking（新フラッグシップ） | GGUF Q4_K_M **20.16GB** / BF16 66.4GB、MLX変換なし | apache-2.0 | 未収録（新しすぎてリーダーボード未反映） | 同上 | RTX5090でのEXL3量子化実践記録はあるがMac実測なし | 独立日本語評価が存在しない、Mac上で動かすならGGUF/llama.cpp限定（MLXなし） |
| GPT-OSS-Swallow-120B-RL-v0.1 | 約60GB級（gpt-oss-120bと同水準） | apache-2.0 | 0.707（全候補中最高） | 0.772 | なし | **40GB予算を超過、対象外** |

---

## 判定（この証拠が支持すること・支持しないこと）

**この証拠が支持すること:**

1. 40GBの予算内で比較できる範囲では、**Gemma 4 31B IT が独立測定（Swallowリーダーボードのja_mtb "writing"サブスコア）で最高点（0.748）**を取っており、かつ apache-2.0・`mlx-community`公式MLX4bit（18.41GB）・ダウンロード数41,035件という条件も揃っている。「日本語特化」を名乗るモデル群（Swallow、llm-jp）はどれもこの数値を上回れていない。
2. **Qwen3-Swallow-32B-RL-v0.2** は次点の候補として妥当：日本語専用の継続事前学習を経ており、ベースのQwen3-32B（writing 0.631）より高いスコア（0.665）を独立指標でも確認できた。ライセンスも量子化選択肢も揃っている。
3. **llm-jp-4系には固有の構造的リスクがある**: 新フラッグシップの33Bモデルは gpt-oss と同じ Harmony チャットテンプレートを採用しており（llama.cppのPRで直接確認）、前回調査で確認したLM Studio上のHarmony関連不具合と同種の問題を踏む可能性が構造的にある。加えて、8Bクラスでは実践者（black_lotus氏）が「内容捏造」を直接報告しており、32B/33Bクラスでこの傾向が緩和されているかは検証されていない。
4. 最も高いwriting/roleplayスコアを持つのは GPT-OSS-Swallow-120B-RL-v0.1（0.707/0.716）と gpt-oss-120b（0.68/0.704）だが、どちらも約60GB級で**40GBの予算に収まらない**。
5. 「文章を整える道具」（knowledge sourceではなく校正・整形ツール）としての用途はblack_lotus氏の実践的結論と一致しており、今回のユースケース（AIっぽい文章の書き直し・校正）に対する定性的な裏付けにはなるが、これは8Bクラスでの観察であり30B級への外挿は検証されていない。

**この証拠が支持しないこと:**

- 「AIっぽい日本語を自然な日本語に書き直す」というタスクに特化したベンチマークは、公開情報の範囲では**存在しない**。今回使った ja_mtb "writing" スコアはMT-Bench形式の短い創作課題の代理指標であり、書き直し・校正タスクそのものを測ってはいない。
- Qwen3-Swallow-32BやGemma-4-31B-ITをこのMac機（またはM-series Mac一般）で動かした際の実測tok/s・メモリ使用量——これは30Bクラスでは見つからなかった（8Bクラスの実測のみ存在）。
- llm-jp-4-33b-thinking（8月リリース）とllm-jp-4.1（9月リリース）についての独立した日本語品質スコア——新しすぎてリーダーボードに未収録。
- ELYZA-tasks-100、llm-jp-eval、Shaberi（lightblue）のスコア——このセッションでは着手できなかった。

**足りないもの（このレポートだけでは埋まらない）:**

- この用途スロット候補（Gemma-4-31B-IT、Qwen3-Swallow-32B、llm-jp-4-32b/33b）の、このMac実機での実測tok/s・メモリ使用量。
- 「AIっぽい文章の書き直し」を模した実タスクでの、候補モデル間の直接比較（今回の証拠はすべて代理指標）。
- llm-jp-4系のHarmonyチャットテンプレートが実際にLM Studio上で不具合を起こすかどうかの直接確認（現状は形式の一致からの推論にとどまる）。
- ELYZA-tasks-100・llm-jp-eval・Shaberiでのクロスチェック。
- Sarashina・PLaMo・Rakuten AIの最新版について、ライセンス条項の詳細（今回すべて[not found]扱い）。

---

## 「前例が見つからなかった」一覧

- 「AIっぽい日本語文章を自然な日本語に書き直す」ことに特化した公開ベンチマーク・リーダーボード。
- Gemma-4-31B-IT、Qwen3-Swallow-32B、llm-jp-4-32b/33bクラスモデルのMac M-series実機でのtok/s実測記事（8Bクラスの実測は存在するが、30Bクラスでは見つからなかった）。
- `mlx-community`（または他の組織アカウント）による `llm-jp-4-33b-thinking` / `llm-jp-4.1-33b-thinking` のMLX変換。
- Sarashina・PLaMoの、3Bを超える規模のオープンウェイト・instructチューニング済みモデルの過去12ヶ月以内のリリース（Sarashinaの最大instructは3B、PLaMoの31Bはベースモデルのみで、ビジネス向け後継「PLaMo 3.0 Prime」はAPI/オンプレのみでオープンウェイトではない）。
- llm-jp-4系でのHarmonyチャットテンプレート関連の不具合報告そのもの（LM Studioバグトラッカーにはヒットなし——リスクは形式の一致から推論したものであり、実際の不具合報告ではない）。
