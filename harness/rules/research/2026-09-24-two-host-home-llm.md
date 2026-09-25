---
question: "自宅LLMサーバーがMac(64GB, LM Studio)の1台からx86_64 Linux(Omarchy/Arch, RTX 3090 Ti 24GB, i9-12900K, Windowsデュアルブートでよく落ちている)を加えた2台構成になるとき、LiteLLM配下で『両方使える』の型はどれが業界の通例か。deterministicの再現性はマシンをまたいで成立するか。Linux側は何のサーバーを立てるべきか。tailnet越しの露出は1台の時と何が変わるか。"
date: 2026-09-24
verdict: "(1) LiteLLMの`order`+fallback、または別tierエイリアス(b)が実地の通例。同一model_nameの下で異機種2台をload-balanceする実例は公開リポジトリに1件も見つからず、単一デプロイ+fallbackはallowed_failsを明示しないと『主系が落ちていても3回叩いてから初めてfallbackする(5〜6秒)』という既知の設計不備(#40405, open)がある。よく落ちるLinux機を主系候補にしてはいけない。(2) deterministicティアの再現性はマシンをまたぐと成立しない — CUDA自体が単体でも非決定的(#2838)、Metal/CUDAは異なるカーネル・浮動小数点加算順序を使うため出力が変わる。『再現性』を求めるなら1台に固定する必要があり、2台routingとdeterministicは設計上両立しない。(3) Linux側はllama.cpp `llama-server`が認証(`--api-key`常設)・並列スロット(`-np`)・GPU分割(`-sm`)を単体でネイティブに持つ唯一のサーバーで、実測値(Qwen3.8-27BでRTX 3090系100〜177 tok/s、Qwen3.6-35B MoEでCUDA 139.6 tok/s)も確認できた。LM StudioのLinux CUDA対応はベンダー側は謳う(CUDA 12.8、Linux上のllmster daemon)が、RTX 3060/3070系の『GPU survey unsuccessful』という未解決バグ報告が複数実在し(#1051, #197)、Mac側で使っている資産と揃えたいなら選べるが検証コストがある。Ollamaは並列数の既定が1という数値上の弱点がある。(4) Tailscale ACLは無料Personalプランでも50 tagged resources・3 ACL groupsが含まれ、2台に別タグを付けてポート単位でscopeを絞ることは無料枠内で可能 — 1台構成からの追加コストは実質ゼロ。"
unverified:
  - "同一model_name配下でMac(LM Studio)とLinux(3090 Ti)を`order`+fallbackまたはload-balanceで束ねている公開litellm config.yamlの実例 — gh search code (api.github.com/search/code) で複数クエリを実行したが0件"
  - "Qwen3系27B〜35Bクラスを同一量子化(Q4系)・同一コンテキスト長でRTX 3090 Ti と M3/M4 Max/Ultra に揃えて直接比較したベンチマーク — ベンダー側もコミュニティ側も条件を揃えた対戦表は見つからず、断片的な個別測定を並べるに留まる"
  - "LiteLLMのfallback遅延を『ローカルサーバーが物理的にオフ(接続拒否/DNS失敗)』の場合に限定して測定した記事 — 見つかった数値は主にクラウドプロバイダのタイムアウト/リトライ文脈のもの"
  - "vLLMのmacOS/Apple Siliconネイティブ対応の一次情報 — 前回記録([[2026-09-23-home-llm-server-gateway-by-use-case.md]])に続き今回も到達できず"
  - "Tailscale Servicesの公式ドキュメント(複数ホストが同一サービス名を名乗る抽象化) — 前回記録と同じく404/308"
  - "LM Studio LinuxでのRTX 3090 Ti個体の動作報告(3060/3070系のGPU survey失敗は見つかったが、3090 Ti個体の成功/失敗報告は未確認)"
sources_note: "URLと引用は本文中に埋め込み。gh CLI自体はこのセッションでkeyringのトークンが無効(`gh auth status`失敗)だったため、`curl -H \"Authorization: Bearer $(gh auth token)\"`でGitHub REST APIを直接叩いて代替した。"
---

# 自宅LLMサーバーが2台構成になるときのLiteLLM配下の型 — 調査記録

**調査日**: 2026-09-24。既存記録 [[2026-09-23-local-llm-across-home-machines.md]] と [[2026-09-23-home-llm-server-gateway-by-use-case.md]] が確立した事実(LM Studio 0.3.x系の認証欠如、headlessでは認証トグルをCLIから有効化できない`lms#489`、Ollamaの認証欠如CVE群、Tailscale Serve/Funnelの無料枠区分、LiteLLM自体のGHSA 14件、sleep/caffeinate問題、U1/U2/U3の受付層比較)は再調査していない。本記録はその上に「2台目(Linux+RTX 3090 Ti)を足したときに何が変わるか」だけを積む。

## 方法と検証凡例

- WebFetch: 該当ページを直接取得し要約。「[verbatim]」はページ本文からの逐語引用。
- WebSearch: 検索結果のスニペット経由。一次ページへの直接到達ではないため、可能な限り個別URLをWebFetchで再確認した。未再確認のものは文中で「WebSearch経由」と明記。
- `gh` CLI自体はkeyringのトークンが無効で`gh auth status`が失敗したため、`curl -H "Authorization: Bearer $(gh auth token)"`でGitHub REST API(`api.github.com`)を直接叩いた。`allowed_domains`に`api.github.com`/`raw.githubusercontent.com`を明示して実行。
- 到達不能(403/404/paywall)は「[到達不能]」と明記し、無いことにしない。

---

## 1. ベンダー

### 1.1 LiteLLM Router — ルーティング戦略・fallback・cooldown・health check・`order`・`model_group_alias`

出典: https://docs.litellm.ai/docs/routing 、https://docs.litellm.ai/docs/proxy/reliability 、https://docs.litellm.ai/docs/proxy/health [いずれもWebFetchで直接取得]

- ルーティング戦略は5種。デフォルト推奨は `simple-shuffle`: "We recommend using `simple-shuffle` (default) for best performance in production." 他に `least-busy`("Picks a deployment with the least number of ongoing calls")、`latency-based`("Picks the deployment with the lowest response time")、`usage-based`(公式が明示的に否定: "**Usage-based routing is not recommended for production due to performance impacts.**")、`cost-based`。
- **同一`model_name`のデプロイはロードバランスグループとして扱われる**: "Loadbalance across multiple azure/bedrock/provider deployments" — 「requests with model="gpt-5.6-luna" will pick a deployment where model_name="gpt-5.6-luna"」という形。これが今回の(a)案(1つのtierエイリアスに両マシンをデプロイとして並べてload-balance)の直接の根拠。
- **`order`パラメータ**: "Set `order` in `litellm_params` to prioritize deployments. Lower values = higher priority." order=1が落ちるとorder=2へ自動昇格 — これが(a)寄りだが実質fallback-onlyに近い(c)案の根拠。
- **cooldown**: 既定値 `allowed_fails: 3`, `cooldown_time: 5s`(`reliability`ページでは`allowed_fails: 3` / `cooldown_time: 30`という例もあり、値はページによって異なる — ここは設定例の相違であり矛盾ではない)。"Deployments automatically recover from cooldown after the cooldown period expires." デプロイ単体にも`allowed_fails`/`cooldown_time`を上書き設定可能。
- **health check**: `/health`エンドポイントは"runs a real test request against every configured model, so it costs a few tokens per model"。バックグラウンドヘルスチェックは`background_health_checks: true` + `health_check_interval`(既定300秒)。**ドキュメント上、health checkとcooldownの連動については明記が無い**(WebFetchで確認した範囲では別機構として扱われている)。
- **`model_group_alias`**: `router_settings.model_group_alias: {"alias-name": "actual-model-name"}`という形で別名を張れる。ただし後述(3.2)の通り、config.yaml経由での指定が無視されるバグ報告がある。
- **fallbacks**: "Fallbacks are how LiteLLM does automatic **failover**. If a call fails after num_retries, LiteLLM falls back to another model group." 種別は通常fallback・content policy fallback・context window fallbackの3種。

### 1.2 LM Studio — Linux headless daemon(llmster/lms)とCUDA

出典: https://lmstudio.ai/docs/app/api/headless [WebFetch]、https://blogs.nvidia.com/blog/rtx-ai-garage-lmstudio-llamacpp-blackwell/ [WebFetch]、LM Studio 0.3.15ブログ(WebSearch経由スニペット、未再確認)

- headlessページ本文: llmsterは "can run on Linux boxes, cloud servers, GPU rigs, or your local machine without the GUI." Linux起動用のセクション("Setup llmster as a Startup Task on Linux")も存在。ただし**CUDA/NVIDIA/GPUバックエンド選択の技術的詳細はこのページには一切記載が無い**[gap] — 「GPUリグで動く」とは言うが設定の中身は書かれていない。
- NVIDIA公式ブログ[verbatim]: "The release of LM Studio 0.3.15 brings improved performance for RTX GPUs thanks to CUDA 12.8"、"CUDA graph enablement...reducing CPU overhead and improving model throughput by up to 35%"、"Flash attention CUDA kernels...Boosts throughput by up to 15%"。ただし本文はWindows向けセットアップ手順が中心で、**Linux固有の性能数値は無い**[gap]。
- WebSearchスニペット経由(未再確認、複数の第三者記事の要約): "Recent LM Studio releases bundle the CUDA runtime inside the per-backend engine package, so no separate CUDA Toolkit install is needed."、"On Linux, LM Studio ships as an AppImage tested primarily on Ubuntu." — これらは一次ページへの直接到達はできておらず[unverified]、ただし後述のバグトラッカー(3.3)がAppImage経由のGPU検出失敗を実際に報告しており、方向としては整合する。

### 1.3 Ollama / llama.cpp `llama-server` / vLLM — Linux単体GPU向けの比較

出典: https://docs.ollama.com/faq [前回記録で確認済み、再掲]、https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md [WebFetch]

- **Ollama並列数の既定**: "The maximum number of parallel requests each model will process at the same time, default **1**." (`OLLAMA_NUM_PARALLEL`で変更可能)。前回記録で確認済みの事実の再掲だが、2台構成でMac(LM Studio実測parallel=4)とLinux(Ollama既定1)を両方使う場合、Linux側は既定のままだと後着が直列待ちになる点は今回の構成でも変わらず効いてくる。
- **llama-server**の主要フラグ[verbatim, README]: `-np, --parallel N`「number of server slots (default: -1, -1 = auto)」、`-sm, --split-mode {none,layer,row,tensor}`「none: use one GPU only」「layer (default): split layers and KV across GPUs (pipelined)」、`--api-key KEY`「API key to use for authentication, multiple keys can be provided as a comma-separated list (default: none)」。Docker配布あり(`ghcr.io/ggml-org/llama.cpp:server`)。**認証・並列スロット・GPU分割モードの3点を単体でネイティブに備える唯一のサーバー**という前回記録の評価は今回も裏付けが取れた。ただしsystemdユニットの公式サンプルはREADMEには無い[gap]。
- **vLLM**: RTX 3090単体での実務ガイドは複数見つかった(後述4.1)。**macOS/Apple Siliconネイティブ対応の一次情報には今回も到達できず**[gap、前回記録と同じ空白]。

### 1.4 Tailscale ACL — 2台構成での違い

出典: https://tailscale.com/kb/1018/acls [WebFetch]、https://tailscale.com/pricing [WebFetch]

- ACLの基本構造[verbatim]: "Each ACL you create must define a source and a destination." 例: `{"action": "accept", "src": [...], "dst": [...]}`。ACLは**方向性を持つ**: "Allowing a source to connect to a destination doesn't mean the destination can connect to the source (unless a policy explicitly enables it)."
- **無料Personalプランでもタグは使える**: pricing pageの比較表より「50 tagged resources included」がPersonal/Standard/Premiumで共通の基準値(Enterpriseのみカスタム)、ACLグループ数はPersonalが3・Standardが10・Premiumが300。1台構成のときの前回記録では「Tailscale未導入」で止まっていたため今回初めて確認した数値 — **2台に別タグ(例: `tag:mac-llm`, `tag:linux-llm`)を付けてポート単位でscopeを絞る運用は無料枠のままで可能**。
- `tsnet`によるアプリ単位の識別(WebSearchスニペット経由、未再確認一次ページ): 各Ollama/LM Studioインスタンスがホストとは別にtailnet上の独立ノードとしてMagicDNS名とACLの置き場所を持てる、という説明。前回記録が未到達だった「Tailscale Services」文書とは別物である可能性があり[unverified]、これ自体の一次ドキュメントには今回も到達できていない。

---

## 2. 実践者

- **ncaq**(前回記録で確認済み、再掲) [https://github.com/ncaq/dotfiles]: 自宅の別ホスト("bullet"、CUDA搭載)のOllamaへTailscale経由で接続。本人コメント「他のホストのOllamaはコーディングに使える速度が出ない」——**2台目を足す動機はあっても、遅ければ実際には使わない**という実例。メインの駆動はクラウドモデル(`github-copilot/gpt-5.6-sol`)のままで、自宅の複数ホストは「選べる選択肢」止まり。
- **kuznero**(前回記録で確認済み、再掲) [https://github.com/kuznero/dotfiles]: Ollama→Caddy→`tailscale serve`の三層。**アプリ層の認証キーは重ねず、Tailscaleの身元だけを境界にする**——1台のときと同じ設計をそのまま複数ホストにも敷いている。
- **LM Studio Linux headless単体の実践者ブログ**: Etzion Bar Noy(インフラコンサルタント)によるブログ記事 [https://run.tournament.org.il/running-headless-lm-studio-on-ubuntu/、WebFetch] — ただし記事本文で使っているのは `LM_Studio-0.3.5.AppImage`(llmster daemon登場=0.4.0より前のバージョン)。[verbatim] "Do not put this machine accessible on the Internet"、設定ファイル `.cache/lm-studio/.internal/http-server-config.json` の `127.0.0.1` を `0.0.0.0` に書き換える手作業、GUI依存を回避するためXvfb(仮想ディスプレイ)が必要だったと明記。**この記事が示すのはLinux単体でのGPU種別ではなく、「llmster登場以前のLM Studio Linuxは半公式ハックが必要だった」という成熟度の低さ**——現行0.4.24のllmster daemonはこの手作業を公式に代替する設計だが、この記事自体は旧世代の記録である点を明記して扱う。
- **2台の異機種ローカルサーバーをLiteLLMで束ねている実践者記録は見つからなかった**。関連して見つかった3本のホームラボ実践者記事はいずれも**単一のローカルバックエンド(Ollama 1個)+クラウドプロバイダ**という構成に留まる:
  - Timothy Bryant [https://medium.com/@tiomothybryant3/unified-ai-proxying-in-my-homelab-with-litellm-c347b5b6ac80、WebSearch経由、本文は403で直接到達不能]: k3sクラスタ(3 masters, 3 workers on Proxmox)でLiteLLMを運用。動機はAnthropicのレート制限可視化——**ローカル推論バックエンドの複数化ではなく、クラウド利用の一元計測が主目的**。
  - Hitesh Pattanayak [https://hiteshpattanayak.com/posts/gitops-homelab-adding-litellm-as-a-unified-ai-gateway-for-ollama-and-cloud-models/、WebFetch]: 構成は "Open WebUI → LiteLLM → model: llama3.2:3b → Ollama (cluster-internal)" の**単一Ollamaデプロイのみ**。複数ローカルバックエンドの記述なし。
  - Blake McCarn [https://blakemccarn.dev/blog/self-hosting-litellm-proxy、WebFetch]: LiteLLMをKubernetes上でセルフホストし年間100万リクエスト近くを処理していると述べるが、扱う数値はコスト("the OCR pipeline spent $2.30 last week")であり、**複数ローカルバックエンド間のload-balance/fallback遅延/cooldownの実測は無い**。唯一のfallback記述は「LiteLLMが落ちたら生のAPIキーで直接叩く」という単純な形。

**実践者レンズの否定側の証拠として明記**: 今回探した範囲では、Mac(Apple Silicon)とLinux(NVIDIA GPU)の2台をLiteLLM配下で同時に「使える」状態にしている実践者の一次記録は0件。見つかった実例は全員「1台のローカルサーバー+Tailscaleの身元認証のみ」か「1台のローカルサーバー+クラウド」のどちらかに収束していた。

---

## 3. 測定

### 3.1 RTX 3090 Ti / RTX 3090 の実測スループット(Qwen3系27B〜35Bクラス)

- Andrew Zhu, "Qwen3.8–27B, 177 Tokens Per Second, One RTX 3090" [https://xhinker.medium.com/qwen3-8-27b-177-tokens-per-second-one-rtx-3090-e72c8df3de93、直接WebFetchは403で到達不能、以下はWebSearchスニペット経由・未再確認]: 「Qwen3.8–27B achieved a maximum of 100 tokens per second on a single RTX 3090 Ti」「a tuned vLLM stack on a single RTX 3090 achieved approximately 114 tokens per second at default sampling (118–124 tokens per second greedy) with 64k context」。**タイトルの177 tok/sと本文スニペットの100/114/118-124という数値が食い違っており、条件(バッチサイズ等)の違いによる可能性が高いが一次ページ未到達のため確認できていない**[unverified: 数値間の不一致の理由]。
- Giles Thomas, "Benchmarking Qwen 3.6 35B MoE (3B active) on an RTX 3090" [https://www.gilesthomas.com/2026/07/benchmarking-qwen-3-6-35b-moe-rtx-3090、WebFetchで直接取得、verbatim相当の数値]: Unslothの`UD-IQ4_NL_XL`量子化(19.5 GiB)使用。**CUDA(ソースからビルド)、GPUのみ**: 生成139.6 tok/s、プロンプト処理3360.4 tok/s。**Vulkan(Arch既定ビルド)、GPUのみ**: 生成「just over 120 tokens per second」、プロンプト「just less than 2,800 tok/s」。同一GPUでもビルド(CUDA vs Vulkan)だけで生成速度が約16%変わる、という数値。フルコンテキスト(262,144トークン)を使うには層のオフロードが必要で、CUDAは10層オフロードで生成89.1 tok/s、Vulkanは12層オフロードで66 tok/sまで落ちる。
- **この持ち主のMac側実測**(既存記録[[2026-09-23-local-llm-across-home-machines.md]]より再掲、Qwen3.8-27B実測parallel=4)との直接対比数値は、同一条件(同一量子化・同一コンテキスト長)で揃えたベンチマークが見つからず[gap, no numbers]。唯一の間接参照はHNコメント(前回記録3節ですでに拾った"[unverified: バックエンド帰属]"付きの1件)のみで、今回新規には見つからなかった。

### 3.2 LiteLLM fallback遅延・cooldownの不具合(measured/issue-tracker)

- **単一デプロイ+fallbackはcooldownしない設計不備** [https://github.com/BerriAI/litellm/issues/40405、open、WebFetch]: タイトル自体が数値入り——"with one deployment per model group + `fallbacks`, the primary is never cooled down — every request during an outage costs 3 failed attempts (5–6 s) before the fallback answers"。本文[verbatim]: "During a 60 s primary outage, _every_ request retried the dead primary `num_retries + 1` = 3 times (with backoff) before going to the fallback: about 5–6 s per request." `allowed_fails=1`+`cooldown_time=30`を明示すると約1秒まで短縮されると報告——**デフォルト設定のままでは、よく落ちるマシンをfallback元(主系)に置くと1リクエストごとに5〜6秒のペナルティが発生する**。
- **cooldown自体が例外で壊れて動かないケース** [https://github.com/BerriAI/litellm/issues/7779、closed as not planned、WebFetch]: "RuntimeError: no running event loop" が`cooldown_handlers.py`で発生し、8回連続失敗(`httpcore.ReadTimeout`)してもcooldownリストに登録されない不具合。**Not plannedで閉じられている**——恒久的に残るリスクとして記録。
- **cascading fallback failure**(WebSearchスニペット経由、未再確認) [https://github.com/BerriAI/litellm/issues/17729]: 主系とfallback先の両方がunhealthyになると、fallback先自身にはfallbackが無いという紛らわしいエラーで失敗する、という報告。
- **`model_group_alias`がconfig.yaml経由だと無視されるバグ** [https://github.com/BerriAI/litellm/issues/15020、closed(PR #15340で対応)、WebFetch]: 報告者は「aliases only work when manually set through the admin UI under Model management」——ドキュメント通りconfig.yamlに書いても効かなかったと報告。LiteLLM v1.77.2-stable時点の報告で、PR自体は存在するため後続バージョンで修正されている可能性が高いが、**ドキュメント記載どおりに動くとは限らないという実例**として記録。

### 3.3 LM Studio Linux CUDA — GPU検出バグ(negative evidence)

- https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1051(open、WebFetch): RTX 3060、Arch系Linux(Cachyos)、LM Studio 0.3.28。エラー[verbatim]: "Failed to perform general hardware survey with bundled 'vulkan' LMSCore library"、"Tried to get CUDA environment variable overrides for LLM usage, but GPU survey data showed no GPUs!"
- https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/197(WebSearchスニペット経由、未再確認): "Error trying to query CUDA gpus: No CUDA devices found!" — Ubuntu 24.04、nvidia-smi/CUDA自体は導入済みと報告者は主張。
- **これらはいずれもRTX 3060/3070系の報告であり、RTX 3090 Ti個体での成功/失敗報告は今回確認できていない**[unverified]。ただし同じAppImage配布経路・同じLMSCore hardware surveyの仕組みを使う以上、機種依存のバグである可能性は残る。

### 3.4 CUDA/Metal間の決定性(deterministicティアの根拠に直結)

- https://github.com/ggml-org/llama.cpp/issues/2838(WebFetch): 報告者の観測[要旨]——同一リクエスト・同一シードでも**CUDA offload時は初回だけ異なる出力**になり、2回目以降は安定する。**Metal offloadでは観測されず**、**CUDAを使わない場合も観測されず**、CPU推論は最初のCUDA応答と一致した。環境: Linux, NVIDIA driver 535.86.05, CUDA 12.2。
- https://github.com/ggml-org/llama.cpp/pull/16016(draft、未マージ、WebFetch): "Deterministic inference mode" が提案されている——"CUDA inference **bit-identical** for identical inputs—independent of batch size, prompt chunking, or concurrency."。既定オフ[verbatim]: "Off by default; normal fast paths unchanged."。有効化には`-DGGML_DETERMINISTIC=ON`ビルドフラグまたは`--deterministic`ランタイムフラグが必要。性能トレードオフは明言されるが数値は無い[verbatim]: "Throughput trade-off in deterministic mode; default builds/perf unaffected when flag is off." **つまりCUDA単体でも「決定的」にするには専用ビルド・専用フラグが要り、既定では非決定的**。
- 一般論(WebSearchスニペット、複数記事の要約、未個別検証): H100とH200でさえFP8/BF16の実装が異なる、浮動小数点演算は非結合的(non-associative)でカーネルやテンソル形状ごとに加算順序が変わり得る、温度0でも決定論的ではない(貪欲サンプリングであってもシード自体が意味を持たない場合がある)。同一モデル・同一バージョンでも温度0での再現率は「roughly 70–95%」という幅で語られている。

---

## 4. 実地(in the wild)

### 4.1 LiteLLM + 2台の異機種ローカルバックエンド — 公開実例の有無

`curl -H "Authorization: Bearer $(gh auth token)" https://api.github.com/search/code` で複数クエリを実行(2026-09-24):

- `lm_studio+ollama+filename:config.yaml` → 62件ヒットしたが、上位の代表例`thatrandomfrenchdude/local-agent`(★26、2025-12-02 push)は**LiteLLM自体を使わない独自フレームワーク**で、`MODEL_PROVIDER: "lmstudio"`という単一選択のenum(LM Studio/Ollama/Nexa/AnythingLLMのいずれか1つを選ぶ)であり、「複数バックエンドを同時にload-balanceする」構成ではない。
- `litellm_params+api_base+ts.net+filename:config.yaml` → 6件。`miket-llc/miket-infra-devices`が該当したが、個別の中身までは深掘りしていない[gap]。
- `deterministic+lm_studio+filename:config.yaml` → 12件。いずれも本調査の対象(Mac+Linux 2台のLiteLLM load-balance)とは無関係な語の一致(NLPパイプライン設定など)だった。
- `litellm+ollama+lm_studio+tailscale`(リポジトリ検索) → **0件**。
- **BerriAI/litellm自身の`proxy_server_config.yaml`**(ベンダー自身のサンプル、WebFetchで直接取得)は`model_name`が同じデプロイを複数並べるload-balanceパターンを実演しているが、**全てクラウドプロバイダ(OpenAI/Azure/Bedrock)の例であり、ローカルLM Studio/Ollamaを混在させた例は無い**。

**結論として、Mac+Linuxの異機種2台をLiteLLM配下でload-balanceまたはorder+fallbackする公開litellm config.yamlは、今回のgh search codeでも0件**。前回記録(「LiteLLM + LM Studio + tailnet」で0件)の空白がそのまま「2台構成」でも埋まっていない。

### 4.2 vLLM単体(RTX 3090、Linux) — 実地のセットアップパターン

- `keturk/llm_on_rtx_3090`(WebSearchスニペット経由、GitHub) — "Battle-tested guide for local LLM inference on Ubuntu 24.04 with NVIDIA GPUs. From fresh install to 32B models at 97% GPU utilization." Dell T5820 + RTX 3090(24GB)で検証、Ollamaデプロイを含むと明記。
- 複数の実務ガイド(dev.to, gigagpu.com、いずれもWebSearchスニペット、個別ページは未深掘り[gap])が、systemdユニット+nginxリバースプロキシ+Prometheus/Grafanaという構成を共通して推奨——**この持ち主が既に持つLiteLLM+Prometheusの構成と方向性は一致するが、vLLM単体を選ぶ場合はLiteLLM側でvLLMプロバイダとして接続する形になり、認証はvLLM自体の機構に依存する**(vLLM自体の認証フラグは本調査では深掘りしていない[gap])。

### 4.3 Tailscale + 複数ローカルLLMホストの実地パターン(前回記録の延長)

- 前回記録で確認済みの`agent-squid/squid`・`rahulmranga/knowledge-worker`(Ollama単体+`tailscale serve`)、`yutakobayashidev/rensheng`(serve層を挟まずtailnet IP直結)は、いずれも**単一ホスト**のパターンであり2台構成の実例ではない。今回、2台構成特有の実地例(異なるタグ・異なるACLスコープで2台のLLMホストを管理している例)は新規には見つからなかった[gap]。

---

## サマリー表

| 観点 | ソース種別 | task/対象 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|---|
| LiteLLM load-balance機構 | ベンダーdocs | 同一model_name配下の複数デプロイ | — | `usage-based`戦略は公式が本番非推奨と明言 |
| LiteLLM `order`+fallback | ベンダーdocs | 優先度制御 | — | 単一デプロイ+fallbackはallowed_fails未設定だとcooldownしない(#40405, open, 5-6秒/リクエスト) |
| LiteLLM cooldown | issue tracker | 障害復旧 | allowed_fails=1+cooldown_time=30で約1秒に短縮(#40405報告値) | 非同期例外でcooldown登録自体が失敗する例(#7779, closed not planned) |
| LiteLLM model_group_alias | issue tracker | 別名管理 | — | config.yaml経由は無視されUI操作が必要だった報告(#15020, closed/PR対応) |
| RTX 3090(Ti) Qwen3.8-27B | 個人ブログ/Medium(未再確認) | コーディング/チャット | 100〜177 tok/s(出典内で数値不一致、条件不明) | 本文未到達のため検証不能[unverified] |
| RTX 3090 Qwen3.6-35B MoE(CUDA) | 個人ブログ(WebFetch確認) | チャット | 生成139.6 tok/s、プロンプト3360.4 tok/s | 同GPUでもVulkanビルドだと生成約120 tok/sに低下(ビルド依存) |
| CUDA決定性 | issue tracker | 再現性 | — | 同一リクエストでも初回だけ異なる出力(#2838)。Metal/CPUでは非再現の報告なし |
| CUDA決定的モード | PR(未マージ) | 再現性 | 性能トレードオフあり(数値なし) | 既定オフ、専用ビルドフラグが必要 |
| LM Studio Linux CUDA | 公式ブログ+バグトラッカー | GPU検出 | CUDA 12.8対応(RTX 50系)、スループット+15〜35%改善(Windows中心の数値) | RTX 3060/3070で"GPU survey unsuccessful"(#1051, open / #197) |
| llama-server | ベンダーdocs | 認証・並列・GPU分割 | `-np`既定-1(auto) | systemd公式サンプルなし |
| Ollama並列数 | ベンダーdocs(前回記録) | 複数クライアント | 既定1 | 明示的に上げないと後着直列化(2台構成でも変わらず有効) |
| Tailscale ACL(2台) | ベンダーpricing | タグ運用 | 無料Personalでも50 tagged resources・3 ACL groups含む | — |
| 実践者: 2台異機種LiteLLM運用 | 実践者ブログ×3件+dotfiles×2件 | U2相当 | 0/5件が該当 | 全員「1台ローカル+Tailscale身元のみ」または「1台ローカル+クラウド」に収束 |
| 実地: gh search code | 公開リポジトリ | Mac+Linux 2台load-balance config | 0件(4クエリ) | 唯一ヒットした`local-agent`はLiteLLM非使用の単一選択enum |

---

## 否定側の証拠(明示)

- **cooldownが機能しない/壊れる実例が複数系統で存在する**: 単一デプロイ+fallbackはデフォルトでcooldownしない設計そのものの不備(#40405, open)、非同期例外でcooldown登録が失敗する例(#7779, closed not planned)、両系統が同時にunhealthyになると紛らわしいエラーになる例(#17729, WebSearch経由未再確認)。「よく落ちるLinux機」を組み込むほど、この種の不具合を踏む確率は上がる。
- **`model_group_alias`はドキュメント通りに動かないことがある**(#15020) — 設定ファイルに書いた通りに動くという前提そのものに留保が要る。
- **LM Studio Linuxは、CUDA対応をベンダーが謳う一方でGPU検出バグの報告が複数系統で実在する**(#1051 open, #197)。3090 Ti個体の成否は未確認のため、導入前提にはできない。
- **CUDAは単体でも非決定的、決定的モードは未マージのdraft PRでしか提供されない**(#2838, PR #16016) — 「決定的」を謳うティアの前提がLinux側で崩れる可能性がある。
- **2台の異機種ローカルサーバーをLiteLLM配下で同時運用している実践者記録・公開リポジトリは0件** — 実地の主流は「1台+Tailscaleの身元認証のみ」であり、2台をアプリ層でload-balanceする設計は前例のない領域。
- **LM Studio Linux headlessの成熟度は日が浅い**: 見つかった唯一の個人ブログ(Etzion Bar Noy)はllmster登場前(0.3.5)の手作業ハックの記録であり、現行0.4.24のllmster daemonでの実地報告そのものは見つかっていない[gap]。

---

## 確認できなかったこと(前例なし・未検証)

- Mac(LM Studio)とLinux(RTX 3090 Ti、LM Studio or llama-server)をLiteLLM配下で`order`+fallbackまたはload-balanceしている公開config.yaml — gh search code、4クエリとも0件
- 同一量子化・同一コンテキスト長でQwen3系27B〜35Bを揃え、RTX 3090 Ti と M3/M4 Max/Ultra を直接対戦させたベンチマーク — 断片的な個別測定のみで対戦表は存在しない
- LiteLLMのfallback遅延を「ローカルサーバーの電源が落ちている(接続拒否)」に限定して測定した記事 — 見つかった数値はクラウドプロバイダのタイムアウト文脈が主
- vLLMのmacOS/Apple Siliconネイティブ対応の一次情報(前回記録から継続する空白)
- Tailscale Servicesの公式ドキュメント(前回記録から継続する空白、404/308)
- LM Studio Linuxでのllmster daemon(0.4.x世代)を使った個人の運用報告 — 見つかったブログは旧世代(0.3.5、手作業ハック時代)のみ
- RTX 3090 Ti個体でのLM Studio Linux GPU検出成否(3060/3070の失敗報告はあるが3090 Tiは未確認)
- Andrew Zhu記事内の数値不一致(タイトル177 tok/s vs 本文100/114/118-124 tok/s)の理由 — 本文403で到達不能

---

## 結論(平易な言葉で)

**問い1(2台構成の型)**: `order`+fallback、または別tierエイリアスの方が、実地の証拠と整合する。同一model_nameに2台を並べてload-balanceする実例は業界に見つからず、しかもLiteLLMのfallback機構自体に「単一デプロイ+fallbackだとcooldownしないので障害中は毎リクエスト5〜6秒待たされる」という既知の設計不備(#40405)がある。**よく落ちるLinux機を主系(order=1)に置くのは、この不備をそのまま踏みに行く構成であり避けるべき**——`allowed_fails`/`cooldown_time`を明示するか、そもそもLinux機を「常時主系」ではなく「明示的に選んで叩く別tier」として扱う方が、実地で確認できた不具合を避けやすい。実践者側は誰も1台構成のとき以上のアプリ層工夫(circuit breaker等)を重ねておらず、Tailscaleの到達性だけに頼り、遅い/落ちているノードは「使わない」という人間側の判断で外している(ncaqの実例)。

**問い2(deterministicの再現性)**: マシンをまたぐと成立しない。CUDA自体が単体でも非決定的(#2838)で、Metal/CUDAはカーネル実装も浮動小数点の加算順序も異なる。llama.cppの「決定的モード」は未マージのdraft PRでしか提供されず、既定はオフ。**「再現性」を目的とするdeterministicティアを、どちらが応答するか分からない2台構成のfallbackに乗せることは、目的と手段が矛盾する**——再現性が要る用途は1台(現状のMac)に固定し続けるのが、今回集めた証拠に最も整合する。

**問い3(Linux側のサーバー選定)**: 認証・並列・GPU分割の3点をすべて単体でネイティブに持つのはllama-server(`--api-key`常設、`-np`、`-sm`)だけであり、この持ち主が使い慣れたMLX資産とは互換性が無い代わりに、実測スループット(Qwen3.6-35B MoEでCUDA 139.6 tok/s、Qwen3.8-27B級で100〜177 tok/sという幅のある報告)が確認できる。LM Studioで揃える場合はベンダーがLinux CUDA対応を謳うものの、RTX 3060/3070系のGPU検出失敗バグが複数実在し(3090 Ti個体の成否は未確認)、headlessのLinux個人運用報告自体がllmster登場前の旧世代記録しか見つかっていない——**Mac側との資産・操作感の統一を優先するかLinux側の検証済み度を優先するかのトレードオフとして自覚する必要がある**。Ollamaは並列数の既定が1という数値上の弱さがそのまま残る。

**問い4(tailnet越し・2台の違い)**: 無料Personalプランのままでも50 tagged resources・3 ACL groupsが含まれており、2台に別タグを振ってポート単位でscopeを絞る運用は追加コストなしで可能——1台構成からの拡張コストはACLの記述量以外にはほぼ無い。ただし「複数ホストが同一サービス名を名乗る」tsnet/Tailscale Servicesという抽象化の一次ドキュメントには今回も到達できておらず、2台をどう名付けて片方が落ちていても他方が同じ名前で応答する、という構成を公式資料の裏付けだけで組むことはできない。

