# 64GB Mac（LM Studio, LiteLLM 経由 JIT ロード）に用途別で何を置くか 調査記録

調査日 2026-09-30。既存記録（再調査しない）: [2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md)（汎用常駐候補の比較）、[2026-09-30-mac-japanese-writing-model.md](2026-09-30-mac-japanese-writing-model.md)（日本語文章執筆用途、Gemma 4 31B IT が ja_mtb writing で 0.748 最高・Qwen3-Swallow-32B-RL-v0.2 が次点 0.665）、[2026-09-30-home-model-fleet-control.md](2026-09-30-home-model-fleet-control.md)（LM Studio の遠隔操作口）。本調査はこれらに Q1（「ハミングウェイ」の正体）と Q2（文章執筆以外の用途別モデル）を追加する。

## 方法と検証の凡例

- **直接取得**: `curl` で Hugging Face API（`huggingface.co/api/models/...`）、GitHub public API（`api.github.com`）、GitHub raw、Zenn 公開API（`zenn.dev/api/search`, `zenn.dev/api/articles`）、LM Studio 公式ドキュメント（`lmstudio.ai/docs/...`）、各モデルの README を取得。
- **要約経由 [要約経由]**: `WebFetch` は一度要約モデルを経由する。Zenn個人記事の内容確認はこの経路（本調査ではQ1のlabmemo記事以外は主に直接取得のZenn APIで代替し、内容抽出のみWebFetchを使用）。
- **到達不能**: MTEB リーダーボード（Hugging Face Space、JSレンダリングでスコア非取得）、Artificial Analysis の Hemmingway-1 個別ページ（404、未掲載）。
- **重要な制約**: WebSearchは本セッション開始前から予算切れ（200/200）だったため、`WebSearch` は2回のみ試行しいずれも実行不可を確認した。その後は `html.duckduckgo.com` のHTML検索結果を直接取得する代替経路で日本語検索を行った——これは公式サポートのWebSearchツールではないが、キーワード「ヘミングウェイ LLM 日本語」から本調査の核心（Hemmingway-1の実在）を発見できた直接取得の経路である。

---

# Q1. 「ハミングウェイ（ヘミングウェイ）」の正体

## 結論（先に書く）

「ハミングウェイ」は日本語書き文字特化モデルではない。正体は **Hemmingway-1**（綴りは `Hemingway` ではなく二重mの `Hemmingway`）——2026-09-20にAltworldという小規模スタートアップが公開した、Qwen3.8-27Bをベースにした27Bオープンウェイトモデルで、**「人間が書いたように読める日常英文（メール・メッセージ）」に特化**して追加学習されている。ベンダー自身が公式モデルカードで「It is English-first」と明記し、日本語を含む英語以外の品質は保証しないとしている。日本語の文章品質はベースのQwen3.8-27Bの多言語能力に依存し、独立した日本語評価は今回のリーダーボード（Swallow）にも収録されていない（2026-09-20公開のため新しすぎる）。**「日本語の文章がうまい」という評判の根拠は今回の調査では見つからなかった** ——見つかったのはその正反対、「英語ファーストで日本語は自己責任」というベンダー自身の明示的な注記である。

## 1. ベンダー

出典: [huggingface.co/api/models/Altworld/Hemmingway-1](https://huggingface.co/api/models/Altworld/Hemmingway-1)（直接取得）、[huggingface.co/Altworld/Hemmingway-1/raw/main/README.md](https://huggingface.co/Altworld/Hemmingway-1/raw/main/README.md)（直接取得）、[github.com/lukeckprobierts/Hemmingway-1](https://github.com/lukeckprobierts/Hemmingway-1)（`api.github.com/repos/...` 直接取得）。

| 項目 | 内容 |
|---|---|
| モデル名 | Hemmingway-1（綴り注意: 二重m） |
| 開発元 | Altworld（`hemmingway.io`） |
| ベース | `Qwen/Qwen3.8-27B` |
| パラメータ | 27.32B（BF16, HF API `safetensors.parameters.BF16`） |
| コンテキスト長 | 262,144 トークン |
| ライセンス | **CC BY-NC 4.0**（HF APIの`cardData.license`および GitHub repo の `license.key` で確認、非商用無料・商用は別途契約） |
| 重み形式/サイズ | BF16 safetensors、約54.7GB（`usedStorage` 54,661,789,272 バイト） |
| 公開日 | 2026-09-20（`createdAt`） |
| HF ダウンロード数（親リポジトリ） | 8,524、likes 780、trendingScore 244（2026-09-30時点） |
| GitHub stars | 40（`lukeckprobierts/Hemmingway-1`、2026-09-30時点） |

README（原文引用、直接取得）:

> "**The AI that writes like a person.** 27B parameters, open weights, free for non-commercial use."
> "We built it for the writing people actually do every day: messages, emails, the awkward note to a colleague, the thing you have been putting off."
> "It is English-first. It can be wrong and still sound certain about it. So do not use it to decide anything medical, legal or financial."
> — [Altworld/Hemmingway-1 README](https://huggingface.co/Altworld/Hemmingway-1/raw/main/README.md)（直接取得）

**日本語に関するベンダーの明示的な立場**: README本文に日本語への直接の言及はないが、"English-first" という一文がその代わりを果たしている。Zenn個人ブログ（labmemo、後述レンズ2）が公式モデルカードとFAQを引用した内容は本調査でHF一次資料と突き合わせて整合を確認できた:

> 「Hemmingway-1は日本語でも使えますか？ 公式は英語ファーストを明示しており、ベンチマークも英語の日常文です。ベースのQwen3.8-27Bの多言語能力に依存するため、日本語の文章品質は自己責任での検証が必要です。」
> — [labmemo.com「Hemmingway-1徹底解説」](https://labmemo.com/hemmingway-1-27b-open-weights-human-likeness-writing/)（直接取得、公開日2026-09-21、参照日2026-09-30）

**ライセンス表記の不一致（負の事実）**: labmemo記事は「Apache-2.0ライセンスで商用利用を含む利用が許諾されており」と書いているが、HF APIとGitHub repoの両方から直接取得した一次情報は一貫して **CC BY-NC 4.0**（商用利用は別途契約が必要）である。labmemo記事のこの記述は誤りか、記事執筆時点からライセンスが変更された可能性があり、**二次情報だけに頼らず一次資料で裏取りする必要性を示す実例**になった。なお、コミュニティによる量子化派生（bartowskiのGGUF、mlx-communityのOptiQ-4bitなど）はタグ上 `license:apache-2.0` と表記しているものがあり、親リポジトリのCC BY-NC 4.0と食い違っている——量子化配布側のライセンス表記が不正確である可能性がある。

## 2. 名前のある実践者

- **labmemo.com**（2026-09-21公開、著者個人名不明・ブログ運営）[直接取得]: 公式ベンチマーク・仕様を丁寧に整理した記事。ただし同ブログは「NeoHorse-1-9B」「Xing4.0-29B-A4B」など類似フォーマットのAIモデル解説記事を大量に持ち、テンプレート的なFAQ構成から見て個人の実践レビューというより情報整理系のコンテンツブログである点に注意（実際に動かした一人称の実測は記事中に無い）。それでも一次資料の引用は本調査でHF/GitHubと突き合わせて概ね正確だった（ライセンス表記の一点を除く）。
- **Hacker News**: [Hemmingway-1: The AI that writes like a person](https://huggingface.co/Altworld/Hemmingway-1) の投稿（2026-09-21、`hn.algolia.com` 直接取得）は **3 points、コメント0件**。議論が一切起きていない——公開から10日、話題性の割に反応は薄い。
- **日本語の実践者記録**: Zenn公開API（`zenn.dev/api/search?q=Hemmingway`, `q=Hemmingway-1`, `q=ヘミングウェイ`）を直接検索したがいずれも **0件**。note.comの検索APIも該当なし。Qiitaの検索APIでは無関係な記事のみヒット（「hemingway」という文字列が別の文脈にたまたま含まれる誤検出）。**日本語圏でHemmingway-1を実際に試した実践者の記録は、本調査の到達範囲では一件も見つからなかった**——公開から10日と日が浅いことが一因と考えられる。

## 3. 測定された証拠

- **ベンダー自社ベンチ（CommunicationBench, Human-Likeness, StoryBench）**: いずれも「INTERNAL」と明記された自社実施・自社判定のベンチマーク。README原文: "Full disclosure: CommunicationBench, Human-Likeness and StoryBench are our own benchmarks. We built them, we ran them, and we are saying that up front."（[Altworld/Hemmingway-1 README](https://huggingface.co/Altworld/Hemmingway-1/raw/main/README.md) 直接取得）。80件の実務文（メール・メッセージ）を両順・盲検で他モデルと対戦させ、第三モデルが判定する方式で、Human-Likenessでは2位のFable 5.1に26ポイント差をつけて首位（公表値）。**これは英語の日常文に対する評価であり、日本語の評価ではない。**
- **公開ベンチ（EQ-Bench 4）**: ベンダー以外が運用するベンチマークハーネスだが、**実行自体はベンダー自身**。公表値でHemmingway-1は1330、Fable 5（1341）・Kimi K3（1332）に次ぐ3位、GPT-5.5（1316）・Opus 4.7（1312）・Opus 4.8（1285）を上回るとされる。第三者による再現検証は今回見つからなかった。
- **独立の第三者評価**: Artificial Analysisの個別モデルページ（`artificialanalysis.ai/models/hemmingway-1`）は **404（未掲載）**——[2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md) で他モデルの独立指標として使ったAAには、Hemmingway-1はまだ登録されていない。
- **日本語の独立評価**: Swallowリーダーボード生データ（`raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/model.yml`、直接取得）を "hemmingway" "hemingway" で検索したが **ヒットなし**。同リーダーボードの最終ビルドは2026-06-24（前回調査で確認済み）で、2026-09-20公開のHemmingway-1が新しすぎて収録されていないのは当然の結果ではあるが、結果として「日本語の独立評価は存在しない」という事実に変わりはない。

## 4. 実態（公開リポジトリ・配布数）

出典: [huggingface.co/api/models?search=Hemmingway-1](https://huggingface.co)（直接取得、2026-09-30時点）。

| リポジトリ | ダウンロード数 | likes | 形式 |
|---|---:|---:|---|
| `Altworld/Hemmingway-1`（親） | 8,524 | 780 | safetensors (BF16) |
| `bartowski/Altworld_Hemmingway-1-GGUF` | 37,567 | 46 | GGUF（著名な量子化者bartowski） |
| `mradermacher/Hemmingway-1-GGUF` | 33,859 | 6 | GGUF |
| `mlx-community/Hemmingway-1-OptiQ-4bit` | 398 | 2 | **MLX 4bit（Mac向け）** |
| `sixstringzen/Hemmingway-1-oQ4e-mtp` 等（oQ4e/oQ6e/oQ8e） | 各500〜1,300台 | 各1〜3 | **MLX 4/6/8bit（個人配布）** |
| `ailexleon/Hemmingway-1-mlx-{4,8}Bit` | 430 / 595 | 0 / 1 | **MLX（個人配布）** |

**MLX/GGUF可用性の結論**: 公開10日で著名な量子化者（bartowski）を含む複数のGGUF・MLX変換が既に存在し、**Mac (LM Studio) でJITロードできる状態にある**——技術的な可用性自体は確認できた。一方で、公開直後の10日間で「heretic」「abliterated」「uncensored」「decensored」を冠する検閲解除・ロールプレイ向け派生モデルが10種類以上乱立している（例: `Abiray/Hemmingway-1-heretic-GGUF`、`JohnDi/Hemmingway-1-Abliterated-Extreme-GGUF`、`brainnxdomain/Hemmingway-1-Heretic-MTP-V3-*` 等）。これは「日常文の自然な代筆」という開発元の主目的とは別に、**ロールプレイ・検閲解除コミュニティに急速に取り込まれた**ことを示す実態であり、日本語文章執筆という今回の関心事とは別方向への拡散である。

## 判定（Q1）

**支持されること:**
1. 「ハミングウェイ」の実体は Hemmingway-1（Altworld、Qwen3.8-27Bベース、27B、CC BY-NC 4.0、2026-09-20公開）であるという同定は、HF API・README・GitHub repoの直接取得で一次資料として確認できた。
2. このモデルは「人間らしい自然な文章」を主眼にした設計・自社ベンチマークで実際にその方向の結果を出しており、話題になっている理由は理解できる（HFのtrendingScore 244は本調査全体で見た中でも高い数値）。
3. **しかしベンダー自身が「English-first」と明記しており、日本語の文章品質を主張したことは一度もない。** 日本語で「自然な文章が書ける」という評判の裏付けは、ベンダー一次資料にも、独立ベンチマークにも、日本語圏の実践者記録にも見つからなかった。

**支持されないこと:**
- 「Hemmingway/ハミングウェイが日本語の自然な文章に強い」という主張——見つかった一次資料はこれと逆（英語ファースト、日本語は自己責任）。
- MLX量子化の日本語品質——量子化自体は存在するが、量子化前のベースモデル自体に日本語の独立評価が無い。

**足りないもの:**
- Hemmingway-1のQwen3.8-27Bベースが持つ多言語（日本語）能力そのものの独立評価。
- 日本語圏実践者によるHemmingway-1の実際の使用記録（公開10日のため時期尚早）。
- Artificial Analysis・Swallowリーダーボードいずれの独立指標への収録も今後の課題（現状は未収録）。

**この用途スロットへの示唆**: [2026-09-30-mac-japanese-writing-model.md](2026-09-30-mac-japanese-writing-model.md) が既に確立したGemma 4 31B IT（ja_mtb writing 0.748）・Qwen3-Swallow-32B-RL-v0.2（0.665）という候補と、Hemmingway-1を並べて日本語での優劣を今回比較することはできない——比較に足る日本語スコアがHemmingway-1に存在しないため。「英語の日常文なら試す価値がある、日本語は期待値を下げるべき」というのが一次資料から言える最大限の結論である。

---

# Q2. 文章執筆以外の用途で、64GB Macのローカルモデルに何を任せるか

## 方法

エージェント・コーディング作業はLinux機のQwen3.8-27B（RTX 3090 Ti）とクラウドのDeepSeek階層が担う前提（[2026-09-25-roles-named-as-people.md](../decisions/2026-09-25-roles-named-as-people.md)、[2026-09-27-model-catalog-and-tier-assignment.md](../decisions/2026-09-27-model-catalog-and-tier-assignment.md)）のため、Macに残る用途は「音声・画像・埋め込み・翻訳・生成・小型分類」に分かれる。各用途について、ベンダー一次資料・実践者・測定・実態の4レンズと、LM StudioでJITロードできるか（LLM/VLM/embeddingのみ対応、ASR/TTS/拡散モデルは非対応)を確認した。

### LM Studioが対応するモデル種別（確認済みの一次情報）

[lmstudio.ai/docs/developer/rest](https://lmstudio.ai/docs/developer/rest)（直接取得）のエンドポイント一覧には `Chat Completions` `Completions` `Embeddings` `List Models` はあるが、`whisper` `speech` `audio` `image generation` `diffusion` `tts` `text-to-speech` のいずれの語も本文中に一度も出現しない（grep 0件）。既存記録[2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md)で確認済みのVLM対応（Qwen3-VL, GLM-4.6V-Flash）と合わせ、**LM Studioが公式にJITロードで面倒を見るのはLLM・VLM（画像入力対応LLM）・embeddingの3種のみ**であることを一次資料で確認した。ASR（音声認識）・TTS（音声合成）・画像生成（拡散モデル）はLM Studioの対象外——これらは別ランタイム（後述）が必要になる。

## 用途別の整理

### (1) 音声認識（STT）

| モデル | 提供元 | サイズ/形式 | 日本語 | LM Studio | 実践者評価 |
|---|---|---|---|---|---|
| `mlx-community/whisper-large-v3-turbo` | OpenAI(Whisper)のMLX変換 | MLX | 多言語（日本語含む） | **非対応（別ランタイム: mlx-audio, whisper.cpp等）** | HFダウンロード305,824件（[huggingface.co/api/models/mlx-community/whisper-large-v3-turbo](https://huggingface.co)直接取得）、圧倒的に厚い |
| `kotoba-tech/kotoba-whisper-v2.0` | Kotoba Technologies + Asahi Ushio | apache-2.0、日本語特化ASR | 日本語専用 | 非対応 | HFダウンロード24,058件。MLX変換は`masahiroid/kotoba-whisper-v2.0-mlx`（DL 26件）と非常に薄い |

**測定された証拠（実践者による直接比較、負の事実）**: Zenn個人ブログの実測比較記事は、日本語特化を謳う`kotoba-whisper`が汎用の`whisper-large-v3-turbo`に**速度・精度の両方で劣る**と報告している:

> 速度: "whisper-large-v3-turbo が大幅に高速です：turbo は kotoba の2倍以上速いという結果でした（RTF 0.123 対 0.273）"
> 精度: "合成音声テストでは、turbo は「ほぼ完璧」に対し、kotoba は「同じフレーズの繰り返しループ、タイムスタンプの逆行、固有名詞の脱落」が発生"
> 結論: "品質・速度・入力頑健性を総合すると、ブラウザ用途のデフォルトは turbo が優位"
> — [zenn.dev/jir0/articles/92342b0ea7466f](https://zenn.dev/jir0/articles/92342b0ea7466f)（2026-07-20公開、[要約経由]でWebFetch内容抽出、原記事はブラウザ/WebGPU実行でありMLX/Macのローネイティブ実行とは条件が異なる点に注意 [unverified: MLXでも同じ傾向になるかは未検証]）

**結論**: 「日本語特化モデルの方が日本語で強い」という直感を裏切る実測が一件存在する。ただしこれはWebGPU/ブラウザでの実測であり、MLXでの実測ではない。MLXでの厚い採用（30万DL超）と直近の実践者実測の両方が揃うのは`whisper-large-v3-turbo`側であり、日本語専用の`kotoba-whisper`はMLX変換自体が薄い（DL 26件）。**ASR用途はLM Studio非対応**であり、`mlx-audio`（後述TTS参照、Blaizzy/mlx-audio、7,964 stars、2026-09-28直近push）のような別ランタイムでJIT実行することになる。

### (2) OCR・文書/スクリーンショット読解（視覚言語モデル）

| モデル | パラメータ | ライセンス | HFダウンロード | MLX | 実践者評価 |
|---|---:|---|---:|---|---|
| `Qwen/Qwen3-VL-30B-A3B-Instruct` | 31B/3B活性 | apache-2.0 | 426,559（[api.github.com直接取得](https://huggingface.co)） | あり（`mlx-community`、既存調査で確認済み） | **96GB以上のメモリが必要と実践者が明記**（後述） |
| `PaddlePaddle/PaddleOCR-VL-1.6` | 軽量 | 要確認[not found] | 41,057 | あり（`jmbarrancoidener/PaddleOCR-VL-1.6-mlx-8bit`、DL 160件、薄い） | Amazon SageMaker非同期推論でのデプロイ記事はあるがMac実測なし |
| `allenai/olmOCR-7B-0225-preview` | 7B | 要確認[not found] | 66,569 | 見つからず[not found]（GGUF量子化のみ確認） | 日本語実践者記録は今回見つからず |
| `dots-studio/dots.ocr`（旧`rednote-hilab/dots.ocr`） | **1.7B LLM基盤** | MIT | **1,044,767**（圧倒的） | 公式MLXなし（`helizac/dots.ocr-4bit`はbitsandbytes量子化、MLXではない） | GitHub Issue「Mac M1 support?」closed、「Add macOS support」closed（要求はあったが本流はflash-attn前提でMac対応に摩擦） |
| `zai-org/GLM-4.6V-Flash`（既存調査） | 10.29B | MIT | — | MLX 5bit 8.27GB | — |

**測定された証拠（OmniDocBench, ベンダー自己申告）**: dots.ocrの公式READMEは「dots.ocr achieves SOTA performance for text, tables, and reading order on OmniDocBench, while delivering formula recognition results comparable to much larger models like Doubao-1.5 and gemini2.5-pro」と主張（[huggingface.co/dots-studio/dots.ocr/raw/main/README.md](https://huggingface.co/dots-studio/dots.ocr/raw/main/README.md) 直接取得）——**ベンダー自身の主張であり第三者追試ではない**。1.7Bという小ささにもかかわらずダウンロード数が100万を超えるのは、軽量さとOCR専用設計への評価の高さを示す実態証拠だが、GitHub本体（`studio-dots-ai/dots.ocr`、9,159 stars）の最終pushは2026-03-24で、調査日（09-30）から半年止まっている——**stars最大級だが直近半年メンテナンスの動きが見えない**。

**実践者による直接実測（Qwen3-VL-30B-A3B、負の事実含む）**:

> ハードウェア: "Mac Studio (M2 Ultra, 128GB)" のユニファイドメモリ環境。記事では **96GB以上のメモリが必要**と明記。
> 速度: 著者は「推論はわりと遅い」と評価（具体的なtok/s数値記載なし）。
> 精度: 「グラフ・日本語の読み取りはかなり良い印象」——**日本語OCR的な用途には肯定的**。
> 既知の不具合: 「生成が無限に続くことがあり、そこはいまいちなポイント」
> — [zenn.dev/robustonian/articles/local_qwen3_vl](https://zenn.dev/robustonian/articles/local_qwen3_vl)（[要約経由]でWebFetch内容抽出）

**結論**: Qwen3-VL-30B-A3Bは日本語の画像読解自体には実践者から肯定的評価があるが、**フル精度では128GB機でも「わりと遅い」**——64GBのMacで動かすには量子化（MLX 4bit、DL 1,366件、既存調査で確認済み）が前提になり、その量子化版のMac実測はどのソースにも見つからなかった。dots.ocrは軽量（1.7B）でLM Studioが対応するLLM/VLMカテゴリに理論上収まるはずだが、**公式のMLX配布が無く**、Mac対応はGitHub issueレベルの後付け（flash-attnのビルド摩擦あり）。「1件の実測でモデル全体を判断しない」の原則どおり、Qwen3-VL・dots.ocrいずれも64GB Mac実機でのOCR実測（tok/s・精度）は今回**見つからなかった**。

### (3) 埋め込み・リランキング（ローカルRAG）

| モデル | パラメータ | HFダウンロード | 日本語 | MLX | 実践者評価 |
|---|---:|---:|---|---|---|
| `Qwen/Qwen3-Embedding-0.6B` | 0.6B | **9,744,263**（全候補中最大） | 多言語 | `mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ`（DL 20,401件） | RAG実装記事は多数（後述） |
| `BAAI/bge-m3` | — | 35,675,298（さらに大きい、汎用ライブラリの一部として広く使われる） | 多言語 | 見つからず[not found] | — |
| `cl-nagoya/ruri-v3-pt-310m` | 310M | 1,244 | **日本語特化** | `masahiroid/ruri-v3-310m-mlx`（DL 16件、非常に薄い）、`masahiroid/ruri-v3-310m-coreml`（Core ML版） | 下記参照 |
| `Qwen/Qwen3-Reranker-0.6B` | 0.6B | 1,672,965 | 多言語 | 見つからず[not found] | — |
| `masahiroid/ruri-v3-reranker-310m-mlx` | 310M | 30 | 日本語特化 | あり（本人配布） | — |

**実践者（複数、Zenn直接取得）**:

- ikora氏「RAGを自分で実装したくなったらまずこれ見て【ruri-v3 × Faiss】」（2026-12-06、**liked 141**——本調査で見つかった中で最も支持を集めたZenn記事の一つ）。日本語RAG実装の実用記事としてruri-v3が定番的に参照されていることを示す。
- masahiroid氏「iPhoneで動く日本語意味検索 — Core ML版 ruri-v3 と Apple NLContextualEmbedding の比較」（2026-09-25、公開5日前）。同一人物がkotoba-whisperのMLX変換・ruri-v3のMLX/Core ML変換の両方を手がけており、**日本語×Apple Silicon変換の個人実践者として複数の用途で名前が重なる**——単発の思いつきではなく継続的な取り組みであることの傍証。
- yakumo3氏「ruri-v3をOpenAI互換embedding APIで使う」（2025-04-30）——LM Studio/LiteLLM的なOpenAI互換API経由での利用実績あり。

**結論**: 埋め込みはLM Studioが公式対応する数少ない非LLM用途で、`Qwen3-Embedding-0.6B`はMLX変換・ダウンロード数ともに突出して厚い。日本語特化の`ruri-v3`はコミュニティの実践者評価（liked 141の記事）は高いが、MLX変換自体は個人配布1件のみで薄い（DL 16件）。**リランキングのMLX変換は今回一件も見つからなかった**——`Qwen3-Reranker`・`ruri-v3-reranker`ともにMLXでの配布は`masahiroid`氏の個人リポジトリ（reranker-310m-mlx、DL 30件）のみ。

### (4) 翻訳

| モデル | 提供元 | ライセンス | MLX | 実践者評価 |
|---|---|---|---|---|
| `pfnet/plamo-2-translate` | Preferred Networks | **PLaMoコミュニティライセンス（独自、商用は別途フォーム申請）** | `mlx-community/plamo-2-translate`（DL 64件） | HFダウンロード2,088、likes 124——高評価 |
| `tencent/Hunyuan-MT-7B` | Tencent | 要確認[not found] | 見つからず（GGUF複数あり、MLXは今回未確認） | HFダウンロード2,363、**likes 744**（ダウンロード数の割に非常に高いlikes比率） |

**結論**: plamo-2-translateは日英翻訳特化でPFN公式、MLX変換も存在するがダウンロード数はまだ薄い（64件）。ライセンスが独自の「PLaMoコミュニティライセンス」で商用利用に別途申請が要る点は、Apache-2.0系の他候補と比べて運用上の制約になる。Hunyuan-MT-7Bはlikes比率が際立って高く注目度は高いが、Mac(MLX)での配布・実測はいずれも確認できなかった[not found]。

### (5) 画像生成

| ツール | 種別 | GitHub stars | 最終push | 状態 |
|---|---|---:|---|---|
| `drawthingsai/draw-things-community` | Mac/iOSネイティブアプリ、GPLv3 | 575 | **2026-09-30**（調査当日） | 活発 |
| `mflux-community/mflux` | MLXネイティブFLUX実装 | 2,424 | 2026-09-30（調査当日） | 活発、Community org化（旧filipstrand個人リポジトリから移管されたとみられる） |
| `argmaxinc/DiffusionKit` | MLXネイティブ拡散モデル実装 | 701 | 2025-04-11 | **1年半以上更新なし、事実上の停止状態** |

**結論**: Draw ThingsとmfluxはいずれもMLXネイティブで活発に更新されている一方、DiffusionKit（Argmax社）は2025-04以降更新が止まっている——同じ「MLXで画像生成」という括りでも活発さに大きな差がある。**画像生成はLM Studio非対応**（前述の一次資料で確認済み）であり、Draw Things（アプリ）かmflux（CLI/ComfyUI連携）のいずれかを別ランタイムとして立てる必要がある。

### (6) 音声合成（TTS、日本語）

| ツール/モデル | 種別 | GitHub stars | 最終push | 日本語 |
|---|---|---:|---|---|
| `Blaizzy/mlx-audio` | MLXネイティブTTS/STT/STSライブラリ | **7,964** | **2026-09-28**（調査2日前、非常に活発） | Kokoro-82Mモデル経由で対応（`jf_alpha`, `jm_kumo`等の日本語voice ID確認済み） |
| `mlx-community/Kokoro-82M-{bf16,8bit,6bit,4bit}` | TTSモデル本体 | — | — | 公式に "EN, JA, ZH, FR, ES, IT, PT, HI" の多言語対応と明記（[raw.githubusercontent.com/Blaizzy/mlx-audio/main/README.md](https://raw.githubusercontent.com/Blaizzy/mlx-audio/main/README.md) 直接取得）。日本語利用には`misaki[ja]`という追加パッケージが必要 |
| `litagin02/Style-Bert-VITS2` | 日本語特化TTS（PyTorch） | 1,377 | 2025-12-07 | 日本語特化、MLX非対応（別ランタイム） |
| `VOICEVOX/voicevox_engine` | 日本語音声合成エンジン | 1,764 | **2026-09-26**（活発） | 日本語専用、MLX非対応・独自エンジン |

**結論**: **TTSはLM Studio非対応**。MLXネイティブで日本語に対応する現実的な選択肢は`mlx-audio`+Kokoro-82Mで、ライブラリ自体が非常に活発（8k近いstars、調査2日前にpush）。ただし日本語専用エンジンとして実績が厚いのは非MLXのVOICEVOX・Style-Bert-VITS2であり、「MLXでJIT実行できる」ことと「日本語TTSとして実績が厚い」ことは今回一致しなかった——Kokoro-82Mの日本語品質そのものを検証した実践者記録は今回見つからなかった[not found]。

### (7) 補完・分類用の小型高速モデル

| モデル | パラメータ | ライセンス | HFダウンロード |
|---|---:|---|---:|
| `Qwen/Qwen3-0.6B` | 0.6B | apache-2.0 | 29,622,035（likes 1,706） |
| `google/gemma-3-270m` / `gemma-3-270m-it` | 270M | 要確認[not found] | 86,462 / 73,920 |

**結論**: どちらも軽量・高ダウンロードで、補完/分類用途の実態としての採用は厚い。ただし「日本語の分類・補完に強い」という日本語特化の独立評価は今回の調査範囲では確認できていない[not found]——この用途スロットは事実整理のみにとどまる。

### (8) プライバシー重視のチャット

これは既存記録[2026-09-30-mac-64gb-resident-model.md](2026-09-30-mac-64gb-resident-model.md)の「(4) スマホから Open WebUI で気軽に話す相手」節がそのまま該当し、本調査で新たに追加する事実はない。Qwen3.8-27B・Qwen3.6-35B-A3Bなど既存候補の実測（このMacで15.0〜53.7 tok/s）がそのまま使える。

## LM Studio対応可否 総括表

| 用途 | LM Studioで直接JITロード可能か | 根拠 |
|---|---|---|
| 音声認識(STT) | **不可** | REST APIドキュメントに whisper/speech/audio の記載なし（直接取得で確認） |
| OCR/画像読解(VLM) | **可**（既に対応実績あり） | 既存調査でQwen3-VL・GLM-4.6V-FlashのMLX配布を確認済み |
| 埋め込み | **可** | REST APIに `Embeddings` エンドポイントあり（直接取得で確認） |
| リランキング | 理論上は埋め込みと同じ経路だが、MLX変換自体が薄く実用例が乏しい | HFダウンロード数が数十〜数百件と薄い |
| 翻訳 | **可**（テキストLLMとして） | plamo-2-translate・Hunyuan-MT-7BともにLLMアーキテクチャ |
| 画像生成 | **不可** | REST APIに image generation/diffusion の記載なし |
| TTS | **不可** | REST APIに tts/text-to-speech の記載なし |
| 小型補完/分類 | **可**（テキストLLMとして） | Qwen3-0.6B・gemma-3-270mはLLMアーキテクチャ |

---

## 比較表（総合、代表的なもの抜粋）

| ソース種別 | 用途 | モデル/ツール | 結果・数値 | コスト数値 | 既知の失敗モード |
|---|---|---|---|---|---|
| ベンダー[直接] | Hemmingway-1識別 | Altworld/Hemmingway-1 | 27B, CC BY-NC 4.0, 262,144トークン文脈 | API $0.24/$0.024/$0.90 per 1M tok（labmemo経由、要約経由） | 英語ファーストと自己申告、日本語未保証 |
| 実践者[要約経由] | STT日本語比較 | kotoba-whisper vs turbo | turboがRTF 0.123 vs kotoba 0.273（2倍以上速い） | — | kotoba-whisperは合成音声で繰り返しループ・タイムスタンプ逆行 |
| 実践者[要約経由] | VLM日本語OCR | Qwen3-VL-30B-A3B | M2 Ultra 128GBで「わりと遅い」、日本語読み取り良好 | — | 生成が無限に続く既知不具合、96GB以上必要 |
| 実態[直接] | 画像生成OSS維持状況 | mflux vs DiffusionKit | mflux最終push当日、DiffusionKit 2025-04で停止 | — | DiffusionKitは事実上放棄 |
| 実態[直接] | OCR採用規模 | dots.ocr | HFダウンロード104万件 | — | GitHub本体は半年更新なし、公式MLXなし |
| 測定[直接] | Hemmingway-1公開ベンチ | EQ-Bench 4 | 1330点、3位（ベンダー自己実行） | — | 第三者再現なし |
| HN Algolia[直接] | Hemmingway-1話題性 | HN投稿1件 | 3 points, 0 comments | — | 公開10日で議論起きず |

---

## 判定（Q2）

**支持されること:**

1. LM Studio（Mac）がJITロードで直接面倒を見られるのはLLM・VLM・埋め込みの3種のみで、ASR・TTS・画像生成は一次資料（REST APIドキュメント）で確認する限り対象外——これらは`mlx-audio`（TTS/STT）、`mflux`/Draw Things（画像生成）といった**別のMLXネイティブランタイムを個別に立てる**必要がある。
2. 「日本語特化モデルの方が日本語に強い」という前提は、STT（kotoba-whisper vs whisper-large-v3-turbo）で実践者の直接比較により裏切られた——汎用の大規模モデルが日本語でも上回る例が実在する。この否定的証拠は、Q1のHemmingway-1（英語特化でも日本語がある程度動くかもしれない、しかし未検証）と対で読むと、「特化と汎用のどちらが日本語に強いかは、用途ごとに実測するまで分からない」という一般的な教訓を支持する。
3. 埋め込み・翻訳・小型補完は、汎用の大規模採用モデル（Qwen3-Embedding-0.6B、Qwen3-0.6B）の方がダウンロード数・MLX変換の厚みで日本語特化モデル（ruri-v3、plamo-2-translate）を上回る——ただし日本語品質そのものの独立比較は今回到達できていない。
4. 画像生成・TTSのOSSエコシステムは活発なものとほぼ放棄されたものが同じ「MLXネイティブ」という括りの中に混在する（mflux/mlx-audioは当日pushの活発さ、DiffusionKitは1年半停止）——ツール選定は「MLX対応」だけでなく直近のpush日付を必ず確認する必要がある。

**支持されないこと:**

- 日本語のOCR・埋め込み・TTS・翻訳それぞれについての、このMac機（M4 Pro 64GB）実機での定量比較——今回集められた実践者記録はいずれも別機種（M2 Ultra 128GB、WebGPUブラウザ、iPhone）でのものであり、64GB Mac実機での実測は一件もない。
- リランキングのMLX対応の実用性——配布数が数十件規模と薄く、実際に運用している例は見つからなかった。
- dots.ocrの公式MLX対応——存在しない。GitHub issueで要求はあったが、公式解決はされていない。

**足りないもの（このレポートだけでは埋まらない）:**

- このMac(M4 Pro, 64GB)実機での、各用途モデルのtok/s・メモリ使用量の実測。
- 日本語埋め込み(ruri-v3)・日本語OCR(dots.ocr, PaddleOCR-VL)・日本語TTS(Kokoro-82M)の、独立した定量的な日本語品質評価。
- Hunyuan-MT-7BのMLX配布の有無（見つからず、存在しない可能性が高いが確証はない）。
- MTEB/JMTEBリーダーボードの実際のスコア（JSレンダリングで到達不能、生データファイルの場所も今回は特定できず）。

---

## 「前例が見つからなかった」一覧

- 「ハミングウェイが日本語の自然な文章に強い」という主張の裏付け（ベンダー・独立評価・実践者いずれにも見つからず、むしろ逆の一次資料が見つかった）。
- Hemmingway-1の日本語圏での実践者による使用記録（公開10日のため時期尚早）。
- Qwen3-VL-30B-A3B・dots.ocr・PaddleOCR-VLいずれについても、64GB Mac実機でのOCR実測（tok/s・メモリ・精度）。
- dots.ocrの公式MLX変換（bitsandbytes 4bit量子化のみで、MLXではない）。
- ruri-v3・Qwen3-Reranker系のMLXリランキングを実運用している公開実装（個人配布の変換自体は存在するが利用実績が薄い）。
- Hunyuan-MT-7BのMLX変換。
- Kokoro-82M（mlx-audio）の日本語音声品質を検証した実践者記録。
- MTEB/JMTEBの実際のスコア表（JSレンダリングで到達不能）。

---

## 出典一覧（本文で直接取得と明記したものの代表URL）

- [huggingface.co/api/models/Altworld/Hemmingway-1](https://huggingface.co/api/models/Altworld/Hemmingway-1)
- [huggingface.co/Altworld/Hemmingway-1/raw/main/README.md](https://huggingface.co/Altworld/Hemmingway-1/raw/main/README.md)
- [github.com/lukeckprobierts/Hemmingway-1](https://github.com/lukeckprobierts/Hemmingway-1)
- [labmemo.com/hemmingway-1-27b-open-weights-human-likeness-writing](https://labmemo.com/hemmingway-1-27b-open-weights-human-likeness-writing/)
- [hn.algolia.com（Hemmingway-1）](https://hn.algolia.com/api/v1/items/49787449)
- [lmstudio.ai/docs/developer/rest](https://lmstudio.ai/docs/developer/rest)
- [huggingface.co/dots-studio/dots.ocr/raw/main/README.md](https://huggingface.co/dots-studio/dots.ocr/raw/main/README.md)
- [github.com/studio-dots-ai/dots.ocr](https://github.com/studio-dots-ai/dots.ocr)
- [github.com/Blaizzy/mlx-audio](https://github.com/Blaizzy/mlx-audio) / [README](https://raw.githubusercontent.com/Blaizzy/mlx-audio/main/README.md)
- [github.com/mflux-community/mflux](https://github.com/mflux-community/mflux)
- [github.com/argmaxinc/DiffusionKit](https://github.com/argmaxinc/DiffusionKit)
- [github.com/drawthingsai/draw-things-community](https://github.com/drawthingsai/draw-things-community)
- [zenn.dev/jir0/articles/92342b0ea7466f](https://zenn.dev/jir0/articles/92342b0ea7466f)（kotoba-whisper vs turbo実測比較）
- [zenn.dev/robustonian/articles/local_qwen3_vl](https://zenn.dev/robustonian/articles/local_qwen3_vl)（Qwen3-VL-30B-A3B実測）
- [zenn.dev/ikora（ruri-v3 × Faiss）](https://zenn.dev)（Zenn検索API経由で確認）
- [huggingface.co/pfnet/plamo-2-translate](https://huggingface.co/pfnet/plamo-2-translate)
- [huggingface.co/tencent/Hunyuan-MT-7B](https://huggingface.co/tencent/Hunyuan-MT-7B)
- [raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/model.yml](https://raw.githubusercontent.com/swallow-llm/leaderboard/main/_data/model.yml)
