---
question: "自宅1台(x86_64 Omarchy/Arch, RTX 3090 Ti 24GB単体, i9-12900K, Windowsデュアルブートで頻繁に落ちる)でLiteLLM配下にOpenAI互換ローカル推論サーバーを立てるとき、vLLMとllama.cpp `llama-server`のどちらが『日本語散文が得意なモデルと軽量4bit量子化モデルを複数、同時ではなく交互に切り替えて1ユーザーで使う』という形に対して業界の通例か。SGLang/TabbyAPI(ExLlamaV2)/Ollamaはこの形で選ばれているか。"
date: 2026-09-24
verdict: "この形(単一24GB・単一ユーザー・交互切替)には llama-server が業界の通例に近い。理由は4点。(1) 複数モデルの交互切替: llama-server は2025年12月に『router mode』をネイティブ搭載し(`--models-dir`/`--models-max`既定4/`--models-preset`)、VRAM逼迫時はLRUで自動アンロードする——vLLMにも同等機能(sleep mode, 2025-10-26公開)があるが公式ドキュメントが自ら『開発者プレビュー』『`VLLM_SERVER_DEV_MODE=1`が要りユーザーに晒すべきでない』と明記しており、単一ユーザーの個人サーバーでもハック的な位置づけが残る。(2) 量子化: 3090 Ti(Ampere, compute capability 8.6)はvLLMのFP8(`llm-compressor FP8 (W8A8)`)が要求する『Ada or Hopper』を満たさず対象外——4bit量子化(AWQ/GPTQ)はvLLM側もAmpereに対応するが、vLLM公式ドキュメントはGGUFを『highly experimental and under-optimized』と明記している。日本語モデル(rinna Qwen2.5 Bakeneko等)はAWQ/GPTQ/GGUFいずれの形式でも配布例が実在し、形式起因の制約は無い。(3) 単一リクエスト(batch=1)の速度はほぼ互角——RTX 4090単体の実測でllama.cppはvLLM比93.6〜100.2%の所要時間(ggml-org Discussion #15180)——vLLMの優位は並行ユーザー数が増えたときに限る(Red Hat実測: 64同時ユーザーでvLLMがllama.cppの約44倍のスループット、TTFT P99はllama.cppが3分超に対しvLLMは低位安定)。この持ち主の用途(1ユーザー・交互切替)はvLLMの優位が効かない領域。(4) 運用面はllama-serverが単体で認証(`--api-key`常設)・Prometheus互換メトリクス(`--metrics`)を備え、vLLMは`--api-key`が`/v1`/`/v2`/`/inference`だけを保護し他エンドポイントは無防備と公式docsが明記、GPUメモリは`--gpu-memory-utilization`で指定した割合を起動時に静的確保する設計でアイドル時に自動解放されない(dynamic release要望 #15287はclosed as not planned)。それでも実地の反証がある: `syv-ai/HyperQwen`(★1680, 2026-09-23push)はまさに『単一24GB・Qwen3.8-27B・vLLM』の構成で127 tok/s(single-user)を実測公開しており、vLLMがこの形で動かないわけではない——router modeが2025年12月と新しいため『枯れた前例の蓄積』ではllama-serverが優勢という評価にとどまる。SGLangは『LLM愛好家が自宅で動かすために作られていない』とコミュニティ記事が明言し対象外、TabbyAPI/ExLlamaV2は単一ユーザー4bitでllama.cpp・vLLM双方より20〜40%速いという報告があるが本調査の主対象(vLLM/llama-server)の外側の傍証にとどまる。Ollamaは並列数既定1という前回記録の弱点がそのまま残る。"
unverified:
  - "3090 Ti個体でvLLM router mode/sleep modeまたはllama-server router modeを実際に運用した個人ブログ——router mode/sleep modeともに2025年10〜12月と新しく、個人の運用報告(特に3090 Ti個体)は今回見つからなかった"
  - "vLLMコールドスタート論文(arXiv:2606.07362, Breaking the Ice: Analyzing Cold Start Latency in vLLM)の具体的な秒数——PDFの生テキスト抽出に失敗し、タイトル・著者(Huzaifa Shaaban Kabakibo, Animesh Trivedi, Lin Wang)以外の数値は確認できなかった"
  - "llama-server router modeがVRAM逼迫時に『どのモデルを主/従とみなすか』の判定基準の一次ドキュメント全文——Hugging Faceブログ(二次情報、要約)止まりで`ggml-org/llama.cpp`のrouter mode専用READMEセクションの原文は個別確認していない"
  - "日本語散文特化モデル(rinna以外、例えばSwallow系やCA-based Qarasu等)のAWQ/GPTQ配布状況の網羅的な一次確認——rinna Bakenekoの1例で形式の存在は確認したが『日本語モデル全般でAWQ/GPTQがGGUFと同等に揃っている』とまでは検証していない"
  - "TabbyAPI/ExLlamaV2をこの持ち主と同型(単一24GB・日本語散文・交互切替)で使っている名前付き実践者の一次ブログ——二次要約記事(gigagpu.com, localaimaster.com)経由の数値のみで、個人の運用記録には到達していない"
sources_note: "WebFetch/WebSearchを併用。gh CLI自体はkeyringトークンが無効(gh auth status失敗)のため、api.github.comはcurl + Authorization headerで直接叩いた(allowed_domainsにapi.github.comを明示)。前提記録(2026-09-24-two-host-home-llm.md)で確立済みの事実(llama-serverの--api-key/-np/-sm、LM Studio Linux CUDA検出バグ、Ollama parallel既定1、CUDA非決定性)は再確認せず引用のみに留めた。"
---

# vLLM vs llama.cpp `llama-server` — 単一24GB GPUで複数モデルを交互に使う形の調査記録

**調査日**: 2026-09-24。前提記録 [[2026-09-24-two-host-home-llm.md]] がLinux側サーバー選定を「llama-serverが認証・並列・GPU分割を単体で持つ唯一のサーバー」と結論づけていたが、vLLMは薄い扱いのままだった。本記録はその空白を埋め、vLLM単体の評価を四方向で深掘りする。SGLang/TabbyAPI/Ollamaは証拠が「この形で選ばれている」と示す場合のみ言及する。

## 方法と検証凡例

- WebFetch: 該当ページを直接取得し要約。「verbatim」「[verbatim]」はページ本文からの逐語引用。
- WebSearch: 検索結果のスニペット経由。可能な限り個別URLをWebFetchで再確認した。未再確認のものは「WebSearch経由」と明記。
- `gh auth status`は失敗(keyringトークン無効)のため、`curl -H "Authorization: Bearer $(gh auth token)"`でGitHub REST API(`api.github.com`)を直接叩いた。
- 到達不能(404/PDF抽出失敗等)は「[到達不能]」と明記。

---

## 問い

家庭用1台(RTX 3090 Ti 24GB単体)で、日本語散文が得意なモデルと軽量4bit量子化モデルを「同時に大量並行ではなく、交互に切り替えて1ユーザーで使う」とき、vLLMとllama.cpp `llama-server`のどちらが業界の通例か。4項目(複数モデル切替/量子化形式/単一ユーザー速度/運用面)で検証する。

---

## 各レンズの所見

### 1. ベンダー

**vLLM量子化サポート** [https://docs.vllm.ai/en/latest/features/quantization/index.html、WebFetch]
- AWQ: "Works on Turing and newer NVIDIA architectures (Turing, Ampere, Ada, Hopper)" — 3090 Ti(Ampere)は対応。
- GPTQ: "compatible with Volta through Hopper" — 3090 Tiは対応。
- FP8: "`llm-compressor FP8 (W8A8)`: Requires Ada or Hopper GPUs, plus AMD GPUs. Not supported on earlier architectures." — **3090 Ti(Ampere, compute capability 8.6)はFP8テンソルコアを持たず対象外**。この持ち主の3090 TiでvLLMのFP8高速化は使えない。
- GGUF [https://docs.vllm.ai/en/latest/features/quantization/gguf.html、WebFetch]: "GGUF support in vLLM is highly experimental and under-optimized at the moment"、"might be incompatible with other features"。トークナイザ変換も "time-consuming and unstable, especially for some models with large vocab size" と明記——**vLLM経由でGGUFを使う選択自体がベンダー公式に非推奨寄り**。

**vLLM sleep mode(複数モデル切替の根拠)** [https://docs.vllm.ai/en/latest/features/sleep_mode/、https://vllm-project.github.io/2025/10/26/sleep-mode.html、WebFetch]
- 定義[verbatim]: "vLLM's Sleep Mode allows you to temporarily release most GPU memory used by a model, including model weights and KV cache, without stopping the server or unloading the Docker container."
- L1/L2の2段階。L1はCPU RAMへの重みオフロード+KVキャッシュ破棄、L2は重みも破棄(復帰はディスクから再ロード)。
- **本番運用への留保**[verbatim相当]: `/sleep`/`/wake_up`等のHTTPエンドポイントは`VLLM_SERVER_DEV_MODE=1`が必須で、"should not be exposed to users"——ドキュメントが自ら「trusted networks向け」「閉じた学習クラスタやバックエンド用途向け」と位置づけている。
- 公開ブログの数値: vLLM 0.11.0(2025-10-26公開)で「18–200× faster switches」「61–88% faster first inference vs cold starts」。**ただし24GB単体GPUでの数値ではなくA100等での測定であり[gap]、この持ち主の3090 Ti環境の数値ではない**。

**vLLM `--gpu-memory-utilization`の静的確保** [WebSearch経由の複数記事要約、個別ページ未全確認]
- "vLLM avoids dynamic runtime memory allocation by design. At engine initialization, it profiles the GPU, loads the model weights, measures intermediate activation requirements, captures CUDA graphs, and then aggressively allocates all remaining available VRAM into a static pool"。つまり起動時に指定割合を静的に確保し、**アイドル時も自動では解放しない**。
- Issue [https://github.com/vllm-project/vllm/issues/15287、WebFetch、closed as not planned]: タイトル通り"Dynamic Memory Release for GPU after idle time"という機能要望が**却下(not planned)**——sleep modeという別機構でしか実現しない設計判断。

**llama-server router mode(複数モデル切替のネイティブ対応)** [https://huggingface.co/blog/ggml-org/model-management-in-llamacpp、WebFetch、二次情報(公式ブログだがHugging Face上の要約記事)]
- "Router mode" は "dynamically load, unload, and switch between multiple models without restarting" を実現。マルチプロセス設計で各モデルが独立プロセス——1モデルがクラッシュしても他に影響しない。
- **LRU自動アンロード**: 既定で同時最大4モデル(`--models-max`)、上限到達時は最も使われていないモデルを自動アンロード。ユーザーコメント引用: "unload[s] the current model if VRAM is full, to allow swapping to a new model"。
- フラグ: `--models-dir PATH`、`--models-max N`(既定4)、`--no-models-autoload`、`--models-preset config.ini`(モデルごとの個別設定)。
- **公開日は2025年12月11日**——vLLMのsleep mode(2025-10-26)と2ヶ月しか離れておらず、どちらも「新しい機能」という点では同格。

**llama-server 運用フラグ再掲**(前提記録で確認済み) [https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md、WebFetch]
- `--metrics`[verbatim]: "enable prometheus compatible metrics endpoint (default: disabled)"
- `--api-key KEY`[verbatim]: "API key to use for authentication, multiple keys can be provided as a comma-separated list (default: none)" — **全エンドポイントに一律適用される設計**(vLLMのような対象パス限定の記載は無い)。
- `-np, --parallel N`(既定-1=auto)、`-sm, --split-mode {none,layer,row,tensor}`。

**vLLM `--api-key`の保護範囲の限定** [https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html、WebFetch]
- [verbatim]: "The `--api-key` option (or `VLLM_API_KEY` environment variable) only authenticates requests to endpoints under the `/v1`, `/v2`, and `/inference` path prefixes." — `/invocations`等の他エンドポイントは無防備とドキュメントが自ら警告。**llama-serverの`--api-key`が全エンドポイント一律なのと対照的**。

**vLLM `/metrics`** [WebSearch経由、docs.vllm.ai/en/stable/design/metrics/系のスニペット]
- Prometheus互換形式でCounter/Gauge/Histogramの3種を公開、`vllm:e2e_request_latency_seconds_bucket`等。llama-serverの`--metrics`と同格の機能を持つ。

### 2. 実践者

- **syv-ai/HyperQwen**(★1680, 2026-09-23 push、[https://github.com/syv-ai/HyperQwen、WebFetch]): README[verbatim]「"Qwen3.8-27B on a single 24 GB consumer GPU with vLLM — 150k token context and an OpenAI-compatible API."」。**単一24GB GPU・vLLMという本調査の対象そのものの実践例**。実測: single-user 127 tok/s、64並行で集計~1,035 tok/s、prefill ~1,440–1,940 tok/s。Docker Compose前提の配布で、WSL2固有の既知問題(`VLLM_WSL2_ENABLE_PIN_MEMORY=1`)も記載——**vLLMがこの形で「動かない」わけではないという直接反証**。ただしrouter mode/sleep modeのような複数モデル切替機構は使わず、単一モデル固定での最適化に主眼がある。
- **Jason Brown(Loktar)** [https://somethinghitme.com/2026/01/20/vllm-tuning-for-low-memory/、WebFetch]: 実機はデュアル5090・デュアル3090+NVLink(合計112GB)。30B BF16モデルで「roughly 30GB VRAM, leaving only 2GB for KV cache」となり「at the end of the day I did get it to work with a context size of 8000 but it wasn't pretty」——**VRAMが逼迫するとvLLMの体験が悪化する一次報告**。NVFP4量子化版への切替で解決。本人比較[要旨]: vLLMはマルチユーザー推論で強いがGPU間VRAMプーリングを持たない一方、llama.cppは(性能を犠牲に)112GB全体をプールできる。
- **Giles Thomas**(前提記録で確認済み、再掲) [https://www.gilesthomas.com/2026/07/benchmarking-qwen-3-6-35b-moe-rtx-3090]: RTX 3090・llama.cpp・Qwen3.6-35B MoE・CUDAビルドで生成139.6 tok/s——llama-server側の実測値として再掲。
- **markaicode.com(SGLang vs llama.cpp、24GB GPU向け)** [https://markaicode.com/vs/sglang-vs-llamacpp/、WebFetch]: [verbatim]「"Pick llama.cpp if you want a single dependency-free binary that runs on CPU, GPU, or a hybrid split, loads quantized GGUF files, and gets a working endpoint up in minutes without a Python environment."」——**home/solo用途での推奨はllama.cpp、vLLMはこの記事では比較対象にすら入らない**。
- **同メディアの別記事(WebSearchスニペット経由、未個別再確認)**: 「If you are on a CPU, Apple Silicon, or a small consumer GPU, vLLM is not the right starting point.」「SGLang was not created for LLM enthusiasts to run models on their home rigs.」——**SGLangは自宅用途で明確に対象外と評価されている**。
- **Red Hat Developer**(vLLM/llama.cppいずれのベンダーでもない第三者、2026-06-15公開・2026-07-13更新) [https://developers.redhat.com/articles/2026/06/15/llamacpp-vs-vllm-choosing-right-local-llm-inference-engine、WebFetch]: [verbatim]「"Choose llama.cpp...when you are prototyping on your laptop or workstation, have a consumer-grade or no GPU...and need offline inference."」「"Choose vLLM when you need to serve multiple concurrent users, have access to data center GPUs...and need to meet specific latency service-level agreements (SLAs)."」——**この持ち主の用途(1ユーザー・コンシューマGPU)は明確にllama.cpp側の推奨条件に一致**。
- **TabbyAPI/ExLlamaV2の位置づけ**(WebSearchスニペット経由、複数記事要約、個別一次ブログ未到達[gap]): 「Together they are the right answer when you have one good NVIDIA GPU, run one user at a time, and want maximum tokens per second.」「ExLlamaV2 generates tokens 20-40% faster than vLLM for single-user quantized inference on consumer GPUs.」——**単一ユーザー・単一GPUという条件だけならTabbyAPIが最速という評価が複数の二次記事で一致**。ただし本調査は個人の一次ブログには到達できておらず、数値は二次情報止まり[unverified]。

### 3. 測定

**単一リクエスト(batch=1)速度の直接比較** [https://github.com/ggml-org/llama.cpp/discussions/15180、WebFetch]
- ハードウェア: "single RTX 4090s frequency limited to 1350 MHz"。モデル: Qwen 2.5 Instruct 3B(vLLM=BF16、llama.cpp=FP16)。
- 単一並行リクエスト: 「llama.cpp needed 93.6-100.2% of the time to finish a request that vllm did」——**batch=1ではほぼ互角、llama.cppがわずかに遅いかvLLMと同等**。
- 16並行リクエスト: 「llama.cpp needed 99.2-125.6% of the time」——並行数が増えるとllama.cppが劣化し始める。

**高並行時のスループット/TTFT** [https://developers.redhat.com/articles/2026/06/15/llamacpp-vs-vllm-choosing-right-local-llm-inference-engine、WebFetch、H200での「production-serving comparison」と明記]
- [verbatim]「"At 64 simultaneous users, it generated roughly 44 times more tokens per second than llama.cpp."」(vLLM側)
- [verbatim相当]「"At 64 concurrent users, it takes more than three minutes before receiving the first token"」(llama.cpp側のTTFT P99)、vLLM側は "remains low and stable across all concurrency levels"。
- **記事自身の注記**: これはH200でのproduction-serving比較であり、llama.cppの典型的な用途(ローカル・単一ユーザー)を反映したものではないと明記——**この持ち主の用途には直接あてはまらない数値**であることをRed Hat自身が留保している。

**RTX 3090単体・vLLMの実測**(syv-ai/HyperQwen、実践者レンズと重複掲載): single-user 127 tok/s、prefill 1,440–1,940 tok/s、64並行で集計~1,035 tok/s。

**コールドスタート/モデルロード時間**
- WebSearchスニペット要約(個別ページ未全確認): 「vLLM is compute-bound; llama.cpp is pull-bound」——vLLMはPython/CUDAのJITコンパイル過多、llama.cppは最小限のC++ランタイムで起動が速いという定性評価。
- arXiv論文 "Breaking the Ice: Analyzing Cold Start Latency in vLLM" [https://arxiv.org/pdf/2606.07362、WebFetch試行]: **PDFのテキスト抽出に失敗し、タイトル・著者(Huzaifa Shaaban Kabakibo, Animesh Trivedi, Lin Wang)以外の具体的な秒数は確認できなかった**[到達不能]。vLLMのコールドスタートが独立した論文の主題になるほど問題視されている、という事実自体は確認できる。

**GGUF/AWQ/GPTQの日本語モデル配布実例** [https://huggingface.co/rinna/qwen2.5-bakeneko-32b-instruct-awq、WebFetch]
- rinna(日本のAI企業)による「rinna/qwen2.5-bakeneko-32b-instruct」の4bit AWQ版。モデルカード[verbatim]「"This model is a 4-bit quantized model for rinna/qwen2.5-bakeneko-32b-instruct using AutoAWQ."」。継続事前学習を日本語コーパスで実施——**日本語散文モデルがAWQ(vLLM向け)で配布されている実例**。同ファミリはAWQ/GGUF/GPTQ int8/int4の複数形式が揃っている(WebSearchスニペットより、個別GGUFページは未確認[gap])。

### 4. 実地(in the wild)

`curl -H "Authorization: Bearer $(gh auth token)" https://api.github.com/repos/...` で直接取得(2026-09-24):

| リポジトリ | ★ | 直近push | 備考 |
|---|---|---|---|
| syv-ai/HyperQwen | 1,680 | 2026-09-23 | 単一24GB GPU+vLLM、open issues 21 |
| mostlygeek/llama-swap | 5,742 | 2026-09-24(当日) | llama-server/vLLM両対応プロキシ、open issues 97 |
| shuricksumy/llama-service | 1 | 2026-09-03 | systemd管理のllama-server自作ラッパー、採用の広がりなし |
| vllm-project/vllm | 92,593 | 2026-09-24(当日) | — |
| ggml-org/llama.cpp | 129,384 | 2026-09-24(当日) | — |

- **llama-swap**(★5,742、mostlygeek): llama-server/vLLM双方をバックエンドとして受け付ける実地の定番プロキシ。README[verbatim]「For Python servers like vLLM, "it is recommended to run them via podman or docker. This provides clean environment isolation as well as responding correctly to SIGTERM signals for proper shutdown."」——**vLLMをllama-swap配下で使う場合、Docker/Podman経由が事実上前提とされている**(llama-serverはバイナリ直起動で済む)。
- **llama-swap側のvLLM関連issue**(closed) [https://github.com/mostlygeek/llama-swap/issues/1090、WebFetch]: タイトル「vllm-wrapper: hardcoded 300s ResponseHeaderTimeout 502s long generations, with no way to raise it」——**vLLMラッパー特有の実装上の制約が実際に報告されている**(llama-server側では同種の報告は今回見つからなかった)。
- **shuricksumy/llama-service**(★1): systemdでllama-serverを管理する自作ラッパー。★1・最終push 2026-09-03という数字自体が「llama-serverのsystemd化は各自が薄く自作する」という状態を示す——**公式サンプルの不在(前提記録で確認済み)を裏付ける実地の弱いエビデンス**。
- vLLM/llama.cpp本体はいずれも★9万超・当日pushで開発は極めて活発——**プロジェクトの持続性そのものには両者とも問題がない**。

---

## サマリー表

| 出典 | task/対象 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|
| vLLM quantization docs | FP8対応GPU | Ada/Hopperのみ(Ampere=3090Ti対象外) | GGUFは"highly experimental and under-optimized" |
| vLLM sleep mode docs/blog | モデル切替 | 18–200×高速化、61–88%初回推論短縮(0.11.0, A100等) | dev mode必須、"should not be exposed to users" |
| vLLM idle memory issue #15287 | アイドル時解放 | — | closed as not planned |
| vLLM --api-key docs | 認証範囲 | — | `/v1`/`/v2`/`/inference`のみ保護、`/invocations`無防備 |
| llama-server router mode (HF blog) | モデル切替 | 既定同時4モデル、LRU自動アンロード | 2025年12月公開、個別一次README未全確認 |
| llama-server --metrics/--api-key | 運用 | Prometheus互換、全エンドポイント一律認証 | systemd公式サンプル無し |
| ggml-org Discussion #15180 | RTX 4090・Qwen2.5-3B・batch=1 | llama.cpp 93.6–100.2%(vLLM比) | 16並行で99.2–125.6%(劣化) |
| Red Hat Developer(H200) | 64同時ユーザー | vLLMがllama.cpp比約44倍スループット、TTFT P99 3分超 vs 安定 | 記事自身が「local単一ユーザーの典型用途ではない」と留保 |
| syv-ai/HyperQwen | RTX 3090系・Qwen3.8-27B・vLLM | single-user 127 tok/s、64並行~1,035 tok/s | ★1,680、2026-09-23push、WSL2固有バグ報告あり |
| Giles Thomas(前提記録) | RTX 3090・Qwen3.6-35B MoE・llama.cpp | CUDA 139.6 tok/s、Vulkan ~120 tok/s | ビルド依存で速度変動 |
| markaicode / Red Hat(実践者評価) | home/solo用途の推奨 | — | vLLMは複数記事で「small consumer GPUには不向き」「開始点として不適」と明言 |
| llama-swap README | vLLMバックエンド運用 | — | Docker/Podman経由が事実上前提、SIGTERM対応のため |
| llama-swap issue #1090 | vLLMラッパー | — | 300秒ResponseHeaderTimeoutがハードコードで延長不可(closed) |
| shuricksumy/llama-service | systemd化 | ★1 | 公式サンプル不在を裏付ける弱い実地証拠 |
| arXiv:2606.07362 | vLLMコールドスタート分析 | 数値未確認[到達不能] | 論文の主題になるほど問題視されている事実のみ確認 |
| rinna/qwen2.5-bakeneko-32b-instruct-awq | 日本語モデル×AWQ | — | 4bit AWQ配布実例、GGUF/GPTQも同ファミリで存在(WebSearch経由) |

---

## 否定側の証拠

- **vLLM側**:
  - GGUFサポートは公式が自ら「highly experimental and under-optimized」「might be incompatible with other features」と明記——本命の量子化形式ではない。
  - `--api-key`の保護範囲が`/v1`/`/v2`/`/inference`に限定され、他エンドポイント(`/invocations`等)は無防備とドキュメントが自ら警告。
  - GPUメモリはアイドル時も静的確保のままで自動解放されず、解放を求めた機能要望はclosed as not planned(#15287)。
  - sleep modeは公式ドキュメントが「開発者プレビュー」「ユーザーに晒すべきでない」と位置づけ、個人の単一ユーザーサーバーでの「素のまま使える」機能ではない。
  - 複数の第三者記事(markaicode、Red Hat)が「small consumer GPU/laptop/workstationにはvLLMは不向き」「開始点として不適」と明言。
  - コールドスタート遅延が独立した査読前論文の主題になるほど問題視されている(arXiv:2606.07362、数値は到達不能)。
  - llama-swap配下でのvLLM運用はDocker/Podman前提となり、実装依存の制約(300秒タイムアウトのハードコード、#1090)が実際に報告されている。

- **llama-server側**:
  - router modeは2025年12月公開と新しく、個別の一次README全文・3090 Ti個体での運用報告のいずれにも今回到達できなかった。
  - systemd公式サンプルが無く、実地の自作ラッパー(shuricksumy/llama-service)は★1と採用が広がっていない。
  - 16並行リクエストで所要時間がvLLM比99.2–125.6%まで劣化(#15180)——並行数が増えるほど不利になる傾向はllama-server側にもある。

- **両者共通の否定材料**: 単一ユーザー・単一24GBという条件で両者を直接対戦させた「決定版ベンチマーク」は見つからなかった。ggml-org #15180はRTX 4090・3Bモデルでの参考値にとどまり、Red Hatの44倍/3分超という数値はH200・64同時ユーザーというこの持ち主の用途と乖離した条件での測定であることを記事自身が認めている。

---

## 確認できなかったこと(前例なし・未検証)

- 3090 Ti個体でvLLM sleep mode / llama-server router modeを実際に運用した個人ブログ・issue報告——両機能とも2025年10〜12月公開と新しく、個人の運用報告の蓄積そのものがまだ薄い。
- arXiv:2606.07362の具体的なコールドスタート秒数——PDFテキスト抽出に失敗。
- llama-server router modeの一次README全文(ggml-org/llama.cpp内、`--models-preset`の詳細仕様含む)——Hugging Faceブログという二次情報止まり。
- 日本語散文特化モデル(rinna以外、Swallow系等)のAWQ/GPTQ配布状況の網羅調査——rinna Bakenekoの1例のみ確認、全体傾向は未検証。
- TabbyAPI/ExLlamaV2を本調査と同型の用途で使っている名前付き個人の一次ブログ——二次要約記事の数値のみ。
- 単一24GB GPU・単一ユーザーという条件だけでvLLMとllama-serverを直接対戦させた決定版ベンチマーク——見つかった数値はRTX 4090・3Bモデル(batch=1限定)かH200・64同時ユーザー(高並行限定)のいずれかで、この持ち主の条件(RTX 3090 Ti・8B〜35B級・batch=1・交互切替)をそのまま満たす測定は無い。

---

## 結論(平易な言葉で)

**問い1(複数モデルの交互切替)**: llama-serverのrouter modeとvLLMのsleep modeは、どちらも2025年後半に出たばかりの新機能で、機能そのものは同格(自動アンロード/オフロードで24GBに複数モデルを収める)。ただしvLLM公式ドキュメントは自らsleep modeを「開発者プレビュー」「ユーザーに晒すべきでない」と位置づけており、個人の単一ユーザーサーバーでそのまま常用する機能としては素性が弱い。llama-serverのrouter modeにはその種の留保が公式ドキュメント(二次情報経由だが)に見当たらない。**この項目だけならllama-serverがわずかに優勢**——ただし両方とも「枯れた実績」と呼べる段階にはまだ無い。

**問い2(量子化形式)**: 3090 Ti(Ampere)はvLLMのFP8高速化の対象外(Ada/Hopper限定)。4bit(AWQ/GPTQ)はvLLM・llama.cpp(GGUF)双方が対応するが、vLLM公式がGGUFを「highly experimental」と位置づけているため、**vLLMを選ぶならAWQ/GPTQ、llama-serverを選ぶならGGUFという住み分けが実質的な結論**。日本語モデルは少なくともrinna Bakenekoでどちらの形式でも配布例が実在し、形式起因でどちらかが使えないという制約は無い。

**問い3(単一ユーザー速度)**: batch=1ではllama.cppとvLLMはほぼ互角(RTX 4090実測でllama.cppがvLLM比93.6〜100.2%)。vLLMの優位は並行ユーザー数が増えたときに限られ(Red Hat実測: 64同時でvLLMがllama.cpp比約44倍)、**この持ち主の用途(1ユーザー・交互切替)ではvLLMの本来の強みが活きない**。逆にsyv-ai/HyperQwenの実測(127 tok/s single-user)はvLLMが遅すぎるわけでもないことを示しており、「llama-serverでなければ実用にならない」とまでは言えない。

**問い4(運用面)**: llama-serverは`--api-key`が全エンドポイントを一律保護し`--metrics`もPrometheus互換で単体完結。vLLMは`--api-key`の保護範囲が限定的(`/v1`/`/v2`/`/inference`のみ)とドキュメントが自ら警告し、GPUメモリはアイドル時も静的確保されたままで自動解放されない(#15287 closed as not planned)。**この項目はllama-serverが明確に優勢**。

**総合**: この持ち主の形(単一24GB・単一ユーザー・日本語散文モデルと軽量4bitモデルを交互切替)に対しては、業界の通例としてllama-serverの方が根拠が厚い——運用面(認証・メモリ挙動)で明確な差があり、単一ユーザー速度は互角、複数モデル切替はどちらも新しいがvLLM側に「本番で晒すな」という公式の留保がある。ただし`syv-ai/HyperQwen`という直接の反例(★1,680、単一24GB・vLLM・実測127 tok/s)が存在する以上、「vLLMはこの形に向かない」と言い切ることはできない——**vLLMでも動くが、llama-serverの方が同じ結果によりシンプルな運用で到達できる、という比較優位の結論**にとどまる。SGLangは自宅個人用途では明確に対象外(コミュニティ評価: "not created for LLM enthusiasts to run models on their home rigs")、TabbyAPI/ExLlamaV2は単一ユーザー速度で両者を上回るという二次情報の評価はあるが一次の個人ブログに到達できておらず参考評価にとどまる。Ollamaは前提記録の並列既定1という弱点がそのまま残り、この用途でも積極的に選ぶ理由は見当たらない。
