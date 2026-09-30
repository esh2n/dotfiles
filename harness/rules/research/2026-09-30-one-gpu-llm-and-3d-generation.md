# 一枚のGPU（RTX 3090 Ti 24GB）でLLMと3Dモデル生成AIを切り替える方式 調査記録

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）
- llama-server は router mode（`--models-dir`、リクエストの `model` 名でオンデマンド読み込み）、`--ctx-size 65536 --parallel 1`、systemd --user サービス、127.0.0.1:8080、外部公開は `tailscale serve --tcp 8080` のみ。
- LiteLLM（Mac/Linux各機に一つ）の `deterministic` tier は order 1 が Linux の llama-server、order 2 が Mac の LM Studio。ヘルスチェック60秒毎、`cooldown_time` 90。
- 持ち主は Mac で開発、Linux の GPU を使う。操作は Mac から。
- LLM サーバーと LiteLLM は tailnet だけに出す。

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl`/`gh api` で一次ソース（GitHub raw ファイル、GitHub REST API、Hugging Face raw ファイル）を直接取得し、grep・行番号で原文引用した |
| [要約経由] | `WebFetch` ツール（AIによる要約）を通した。原文全体は見ていない。可能な範囲で直接取得に差し替えたが、一部は要約のみ |
| [到達不能] | 試みたが到達できなかった（gh の TLS 検証エラー、Reddit の 403/ブロック、404 など） |
| [測定なし] | ソース自体に数値が無い |

`gh` コマンドはこのサンドボックスでは `https://api.github.com` への TLS 証明書検証が失敗した（`tls: failed to verify certificate: x509: OSStatus -26276`）ため、以降は `curl` + `api.github.com` を allowed_domains に指定して直接叩いた。`gh` の認証トークンを読み出す操作は行っていない。

WebSearch はこのセッションの予算（200/200）を使い切っており、本調査ではは以降利用できなかった。そのため Google 的な横断検索ができず、Reddit（`www.reddit.com` は WebFetch でも `curl` でも到達不能）や Hacker News（Algolia 検索 API 経由、`hn.algolia.com`）など到達可能な経路のみで補った。

---

## 2. ベンダー（vendors）

### 2.1 llama.cpp / llama-server の router mode

一次ソース: `tools/server/README.md`（[直接] `https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md`、2026-09-30時点のmasterブランチ、2165行）

- フラグ一覧（README:227-230）:
  > `--models-dir PATH` | directory containing models for the router server (default: disabled)
  > `--models-preset PATH` | path to INI file containing model presets for the router server (default: disabled)
  > `--models-max N` | for router server, maximum number of models to load simultaneously (default: 4, 0 = unlimited)
  > `--models-autoload, --no-models-autoload` | for router server, whether to automatically load models (default: enabled)
- 起動方法（README:1678, 1690-1704）: モデルを指定せずに起動すると router mode になり、`--models-dir` で指定したディレクトリの GGUF を検出、リクエストの `model` フィールド/クエリパラメータでルーティングする。
- アンロード用 API（README:1931-1949）: `POST /models/unload` に `{"model": "<id>"}` を送るとそのモデルをアンロードできる。
- アイドル時自動スリープ（README:2096-2109, `--sleep-idle-seconds SECONDS`、README:244「default: -1; -1 = disabled」）:
  > "When the server enters sleep mode, the model and its associated memory (including the KV cache) are unloaded from RAM to conserve resources."
  > 除外されるエンドポイント（アイドルタイマーをリセットしない）: `GET /health`, `GET /props`, `GET /models`, `GET /metrics`
  - この機能は PR #18228（`https://github.com/ggml-org/llama.cpp/pull/18228`、README中でリンクされている）で導入された。
- プリセットファイルの追加オプション（README:1793-1796）: `load-on-startup`、`stop-timeout`（アンロード要求後、強制終了までの待機秒数、デフォルト10秒）、`dedup-cache-models`。

**重要な留保（VRAMが本当に解放されるか）**: README本文の「unloaded from RAM」という表現とは裏腹に、Issueレベルでは子プロセス自体がGPU上に残留する不具合が実測・継続報告されている（§4.1参照）。README自体はこの残留問題に触れていない。

### 2.2 llama-swap（mostlygeek/llama-swap）

一次ソース: README（[直接] `https://raw.githubusercontent.com/mostlygeek/llama-swap/main/README.md`）、`docs/kb/guides/`配下の各ガイド（[直接] GitHub Contents API 経由で個別ファイルを取得）。

- 位置づけ（README:48-49, 62, 67）: `POST /api/models/unload`（全モデル手動アンロード）、`POST /api/models/unload/:model_id`（個別）、`/metrics`（GPUメトリクスをPrometheus形式で公開）、`ttl`（タイムアウトでの自動アンロード）。
- `任意のOpenAI/Anthropic互換サーバー`をラップできる（README要約より、README中に"vllm, stable-diffusion.cpp, audio.cpp, ComfyUI, etc."と明記）[要約経由の確認だが、後述のComfyUI専用ガイドで直接裏付けられる]。
- **groupsとmatrixルーター**（[直接] `docs/kb/guides/routing/groups-and-matrix.md`、`updated: 2026-09-14`）:
  - デフォルトの `group` ルーターでは、グループごとに `swap`（グループ内で同時に1つだけ動かす、デフォルト`true`）、`exclusive`（このグループのメンバーが動くと他の全グループをアンロードする、デフォルト`true`）、`persistent`（他のグループから絶対にアンロードされない、デフォルト`false`）の3フラグを設定する。
  - 例（本ファイルの `main` グループ）:
    ```yaml
    main:
      swap: true
      exclusive: true
      members: [llama, qwen]
    ```
  - より複雑な `matrix` ルーターは、同時実行を許す組み合わせ集合を `sets` として式で書き、要求されたモデルを含む最安コストの集合へ収束させる（`evict_costs`でコールドスタートの痛いバックエンドを優先保持できる）。
- **ComfyUI専用の公式サポート**（[直接] `docs/kb/guides/upstreams/comfyui.md`、`updated: 2026-09-21`）:
  - ComfyUIはOpenAI互換サーバーではなくWebアプリで、ブラウザがWebSocketを開きっぱなしにするため通常のエンドポイントではスワップされない、という問題をllama-swapは把握している。
  - `comfyui_auto` という予約モデルIDに対する専用パススルー `/comfyui/` を提供し、以下を自動で強制する:
    > `compat.ignoreWebsockets` | forced to `true` | a websocket connection does not start or queue the model, and does not count toward concurrency, in-flight requests, TTL activity, or swap decisions
    > `concurrencyLimit` | raised to at least `999` | the per-model default is 10; one open ComfyUI tab makes many parallel asset and API requests
  - Docker起動例が示されており、`cmdStop: docker stop comfyui-auto` と `unloadTimeout: 30`（`docker stop`は遅いため）、`ttl: 600` が推奨されている。`cmdStop`を設定しないと「llama-swapはローカルのdocker runクライアントを止めるだけでコンテナはGPUを握ったままになる」と明記。
  - 既知の落とし穴として文書化されている項目（原文要約せず該当節をそのまま踏襲）:
    - WebSocketトラフィックはTTLタイマーをリセットしないため、「長いレンダリングをWebSocket越しに見ているだけ」でもアイドルと判定されモデルがアンロードされうる。
    - `checkEndpoint`のデフォルトは`/health`だがComfyUIはこれを提供しないため`checkEndpoint: /`への変更が必要。
- **GPU排他をGPU単位でスコープする機能は現状ドキュメント上に存在しない**。`pool`というグループ排他をGPU単位に限定する提案（Issue #632、後述）はクローズ済みだが、2026-09-30時点で取得した `groups-and-matrix.md` と `README.md` のいずれにも `pool` という語は出現しない（`grep -n -i "pool"` で0件）。つまり現行ドキュメント上、`exclusive: true` はインスタンス全体に対してグローバルに効く。単一GPU構成ではこれはちょうど求める挙動（LLMか3D生成のどちらか一方のみ）と一致するが、将来GPUが増えた場合はスコープできない。

### 2.3 ComfyUI（Comfy-Org/ComfyUI、旧 comfyanonymous/ComfyUI）

一次ソース: `server.py`, `main.py`（[直接] `https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/{server.py,main.py}`、リポジトリ自体は `Comfy-Org/ComfyUI` にリネーム済みだが `comfyanonymous/ComfyUI` はリダイレクトされ同じ内容を返す）。

- VRAM解放用API: `server.py:1200-1208`
  ```python
  @routes.post("/free")
  ...
  unload_models = json_data.get("unload_models", False)
  free_memory = json_data.get("free_memory", False)
  if unload_models:
      self.prompt_queue.set_flag("unload_models", unload_models)
  if free_memory:
      self.prompt_queue.set_flag("free_memory", free_memory)
  ```
- 実際の解放処理: `main.py:389-399`
  ```python
  flags = q.get_flags()
  free_memory = flags.get("free_memory", False)
  if flags.get("unload_models", free_memory):
      comfy.model_management.unload_all_models()
      need_gc = True
      last_gc_collect = 0
  if free_memory:
      e.reset()
      need_gc = True
  ```
  `POST /free` に `{"unload_models": true, "free_memory": true}` を送ると `comfy.model_management.unload_all_models()` が呼ばれることをソースコードで確認した。これは「一次情報で確認済み」のAPIであり、llama-server側の`/models/unload`と対になる操作をComfyUI側に用意できる。
- CLIのVRAM管理フラグ（[要約経由] `cli_args.py`のWebFetch要約。生ファイルは直接grepしていない）: `--gpu-only`（全てGPU常駐）、`--highvram`（デフォルトでは使用後にCPUメモリへアンロードされるところ、GPUに残す）、`--lowvram`／`--novram`（VRAM逼迫時向け、ただし「Dynamic VRAM有効時は`--lowvram`は何もしない」との記述あり）、`--reserve-vram`、`--vram-headroom`（他アプリのVRAM使用分もカウントして空きを確保する新しめの"Dynamic VRAM"機能）。これらは全て要約経由であり、原文の正確な文言は未確認 [要約経由]。

### 2.4 3Dモデル生成AI各種

#### Hunyuan3D-2.1（Tencent-Hunyuan/Hunyuan3D-2.1）
- VRAM要件（[直接] README.md:81、raw取得）:
  > "It takes 10 GB VRAM for shape generation, 21GB for texture generation and 29GB for shape and texture generation in total."
  - shape+texture合計29GBは24GBカード（RTX 3090 Ti）には**収まらない**。`--low_vram_mode`フラグ（README:142、`gradio_app.py`の起動例に含まれる）があるが、これがどこまで下げられるかの具体的な数値はREADMEに記載がない[測定なし]。
- ライセンス（[直接] `https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE`、原文全文取得）: "TENCENT HUNYUAN 3D 2.1 COMMUNITY LICENSE AGREEMENT"。
  - 地理的除外（冒頭）: "THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA AND IS EXPRESSLY LIMITED TO THE TERRITORY"
  - 商用利用の閾値（Section 4）: "If, on the Tencent Hunyuan 3D 2.1 version release date, the monthly active users of all products or services made available by or for Licensee is greater than 1 million monthly active users in the preceding calendar month, You must request a license from Tencent"
  - 出力（生成物）自体への権利主張なし（Section 6.d）: "Tencent claims no rights in Outputs You generate. You and Your users are solely responsible for Outputs and their subsequent uses."
  - 個人のゲーム素材制作用途で月間アクティブユーザーが100万人を超えない限り、追加ライセンス申請なしで利用できると読める。日本およびTerritory定義（EU/UK/韓国を除く全世界）に含まれる。
- メンテナンス状態（[直接] GitHub API `repos/Tencent-Hunyuan/Hunyuan3D-2.1`）: stars 4,097、`pushed_at: 2025-10-17T10:10:07Z` — 調査日（2026-09-30）から約11.5ヶ月更新なし。前身の`Hunyuan3D-2`はstars 14,994・`pushed_at: 2025-10-28`で同様に停滞。一方、同じTencent-Hunyuan組織の`Hunyuan3D-WorldClaw`（2026-08-13push）や`Hunyuan3D-Buffalo1.0`（2026-08-10push）は直近まで更新されており、Tencentの3D生成の開発リソースは2.1系列から別の後継プロジェクトへ移った可能性がある[推測、未確認]。3.0という名称のリポジトリはTencent-Hunyuan組織検索では見つからなかった（`Hunyuan3D-2`, `2.1`, `1`, `WorldClaw`, `Part`, `Omni`, `Buffalo1.0`のみ確認、[直接] GitHub Search API）。

#### TRELLIS / TRELLIS.2（microsoft）
- TRELLIS（[要約経由] WebFetch on README、原文は「An NVIDIA GPU with at least 16GB of memory is necessary」「The CUDA Toolkit is needed... tested with CUDA versions 11.8 and 12.2」「The code is currently tested only on Linux」とWebFetchが報告。ライセンスはMIT。stars 13,733、`pushed_at: 2026-06-26`（約3ヶ月前）[直接、API]。
- TRELLIS.2（[要約経由] WebFetch on README）: 「An NVIDIA GPU with at least 24GB of memory is necessary」——RTX 3090 Ti 24GBの**全量**に等しい。ライセンスはMIT（`nvdiffrast`, `nvdiffrec`サブモジュールは別ライセンス）。CUDA必須、Linuxのみテスト済み、MPS/Apple Silicon記述なし。stars 11,403、`pushed_at: 2026-07-10`（約3ヶ月前）[直接、API]。
  - 24GB要求は、LLM（Qwen3.8-27B Q4、17.4GB）とTRELLIS.2が**同時に**GPU上に存在することは物理的に不可能であることを意味する（切り替え運用が必須という前提を裏付ける数値）。単体で起動してもVRAMに余裕はほぼ無い。

#### Stable Fast 3D（Stability-AI/stable-fast-3d）
- VRAM（[直接] README.md:80、raw取得）: "The default options takes about **6GB VRAM** for a single image input." — 他の2モデルより大幅に軽量。
- CUDA/MPS（[直接] README.md:31, 48-60）:
  > "Optional: CUDA or MPS has to be available"
  > "Stable Fast 3D can also run on Macs via the MPS backend... Note that support is **experimental** and not guaranteed to give the same performance and/or quality as the CUDA backend."
  > "MPS currently consumes more memory compared to the CUDA PyTorch backend. We recommend running the CPU version if your system has less than 32GB of unified memory."
  - Mac上での実行実績はM1 Max 64GBでのみ確認されている（README:56）とのことで、本件の32GB Macであれば著者の推奨ラインを下回る可能性がある[未確認、本調査のMac側スペックは対象外]。
- ライセンス（[直接] GitHub Contents API `LICENSE.md`）: "STABILITY AI COMMUNITY LICENSE AGREEMENT"。
  > "this Agreement preserves free access to the Models for people or organizations generating annual revenue of less than US $1,000,000"
  年間売上100万ドル未満なら商用含め無料。ゲーム制作が個人/小規模であれば問題にならない条件。
- メンテナンス状態（[直接] API）: stars 1,835、`pushed_at: 2025-01-22T14:55:42Z` — 調査日から約20ヶ月更新なし。3モデル中もっとも停滞している。

#### TripoSR（VAST-AI-Research/TripoSR、Stability AI / Tripo AI 共同）
- ライセンス（[直接] `LICENSE`ファイルraw取得）: MITライセンス全文確認（"Copyright (c) 2024 Tripo AI & Stability AI"）。制限なしの商用利用可。
- VRAM要件: 本調査では具体的なGB数を一次ソースから確認できなかった[測定なし]。2024年発表の feed-forward 単一画像→メッシュ手法で、他の拡散ベース手法（Hunyuan3D, TRELLIS系）より軽量・高速だが再構成品質は一般に劣るとされる（この品質比較はソース未確認のため記載しない）。
- メンテナンス状態: stars 6,998、`pushed_at: 2026-06-04`（約4ヶ月前）[直接、API]。

### 2.5 Tailscale SSH / tailscale serve（Mac→Linuxの制御経路）

一次ソース: [要約経由] `https://tailscale.com/kb/1193/tailscale-ssh`、`https://tailscale.com/kb/1312/serve`（WebFetch要約、原文全体は未確認）。

- Tailscale SSH: Tailscaleのノード鍵とWireGuardでSSH認証・暗号化を代替する。ACLの`grants`（到達可否）と`ssh`（誰がどこへ、どのOSユーザーで）の2種類の設定が必要。
  - 留保: 「クライアント側の任意のOSユーザーがTailscale越しにSSHサーバーへ接続できてしまう」（マルチユーザー機では要注意、個人機なら影響小）。`tailscaled`再起動でセッションが切断される。ポート22固定。
- tailscale serve: ローカルサービスをtailnet内のみに公開。IDヘッダ（`Tailscale-User-Login`等）を自動付与。
  - ベストプラクティス（原文要約）: 「IDヘッダで認証するバックエンドはlocalhostのみでリッスンさせるべき」——直接外部から叩かれてServeの認証をバイパスされるのを防ぐため。HTTPS必須。

---

## 3. 実践者（practitioners）

WebSearchの予算切れによりGoogle横断検索ができず、Redditは`www.reddit.com`が本セッションのサンドボックスから到達不能（WebFetchは "unable to fetch"、`curl`はJSON APIが空応答）だったため、GitHub上で実名の個人が書いた実践記録と、Hacker News（Algolia検索API経由）に限定して調査した。

### 3.1 Varun Vasudeva（`varunvasudeva1/llm-server-docs`）

[直接] GitHub Contents API経由でREADME.md全文（79,825文字）を取得し、行番号でgrep。

- 自己申告（README冒頭）: "No part of this guide was written using AI - any hallucinations are the good old human kind." — AIを使わず書いたと明記する、実在の個人による実践記録。stars 838、`pushed_at: 2026-06-30`（[直接、API]、比較的最近まで更新）。
- ハードウェア構成（README:120-125）:
  > CPU: Intel Core i5-12600KF / Memory: 96GB / Storage: 1TB NVMe / **GPU: 2x Nvidia RTX 3090 (24GB)**
  - **単一GPUではなく2枚構成**（合計48GB）。本調査が対象とする「1枚のGPUで切り替える」ケースそのものは扱っていない。
- llama.cppネイティブのモデル切り替えとllama-swapの比較（README:863）:
  > "llama.cpp can now natively allow for model-switching via its `--models-preset` flag. Compared to llama-swap, llama.cpp's in-built switcher naturally has less overhead because it's bundled with the binary but it also doesn't come with a UI... llama.cpp and llama-swap are functionally equivalent with respect to model-switching."
- **単一24GBカードでのVRAM競合を明示的に認めている**（README:1421、Open WebUI + ComfyUI + FLUX.1の節）:
  > "You'll either need more than 24GB of VRAM or to use a small language model mostly on CPU to use Open WebUI with FLUX.1 [dev]. FLUX.1 [schnell] and a small language model, however, should fit cleanly in 24GB of VRAM, making for a faster experience if you intend to regularly use both text and image generation together."
  - ただし、この記述は「両方を**同時に**VRAMへ収める」場合の話であり、動的なロード/アンロードによる「切り替え」運用の設定例（llama-swapのgroups/ttl設定など）はこのガイド内に見当たらない。つまり、この実践者は「切り替えて使う」構成そのものは書いていない——**厚みのある実践ガイドでも、単一24GBカードでの動的切り替えは手つかずの領域として残っている**、という否定側の証拠として読める。

### 3.2 ai-joe-git（`ai-joe-git/comfyui_llama_swap`）

[要約経由] WebFetch。llama-swapをComfyUIのノードとして統合するカスタムノード。MITライセンス、コミット数8、stars 16（[直接、API、`gh search repos`結果より]）。「auto-unload toggle」が生成後に自動で`/unload`を呼ぶ、"great for VRAM-constrained setups"と記述。個人開発、小規模（stars 16）で採用は限定的。

### 3.3 RealFireAU（`RealFireAU/dgx-spark-unified-stack`）

[要約経由] WebFetch。「llama-swap (load/evict/GPU-sharing) と LiteLLM」の組み合わせでllama.cpp・vLLM・ComfyUI/stable-diffusion.cppをNVIDIA DGX Spark上でオーケストレーションすると記述。ただし対象ハードウェアはDGX Spark（統合メモリ、離散24GB GPUとはメモリアーキテクチャが異なる）。stars 0（[直接、API]）——採用実績なし、単著プロジェクトで失敗事例の記述も薄い。

### 3.4 その他の小規模採用例（[直接] `gh api search/repositories?q=llama-swap+comfyui`、計9件ヒット）

| リポジトリ | stars | 最終push | 説明 |
|---|---|---|---|
| ai-joe-git/comfyui_llama_swap | 16 | 2026-03-09 | ComfyUIノード |
| varunvasudeva1/llm-server-docs | 838 | 2026-06-30 | 実践ガイド（3.1で詳述） |
| jiafeimao1990/llama-swap-windows-cn | 2 | 2026-08-30 | 中国語非公式Windowsフロントエンド、"ComfyUI 显存释放"(VRAM解放)を謳う |
| mayerwin/open-webui-llamaswap-image-models | 5 | 2026-09-22 | Open WebUIへllama-swap経由の画像生成モデルを追加 |
| hauke-cloud/llama-swap-comfyui | 0 | 2026-09-08 | llama-swap公式イメージにComfyUIを同梱しただけのミラー |
| ICTylor/comfy_vllm_llamacpp_openwebui | 2 | 2025-09-05 | Dockerfile一式 |
| Sephrael/comfyui-localLLM_vkm | 0 | 2026-09-01 | ComfyUIノード |
| RealFireAU/dgx-spark-unified-stack | 0 | 2026-08-21 | 3.3参照 |
| HawgAuto/minimax-h3-three-worker-pipeline | 0 | 2026-08-04 | 動画生成向け、24GB GPU向けと明記 |

星数最大は838（Varun Vasudeva、ただし2GPU構成）で、残りは20未満、多くは0〜2。**「1枚のGPUでLLMとComfyUI/3D生成を切り替える」というパターン自体は複数の個人が試みているが、いずれも小規模・低採用**。

### 3.5 見つからなかったもの

- ブログ記事形式（GitHubリポジトリのREADME以外）で、名前のある実践者が「試して、うまくいかず元に戻した」という体験談は見つからなかった。Redditへの到達が本セッションでは不可能だったため、r/LocalLLaMA上の議論を検索できていない[到達不能]。
- Hacker News（Algolia検索API、[直接]）でも関連する投稿は見つからなかった:
  - "GPU sharing LLM image generation" → 0件
  - "single GPU LLM diffusion switch" → 0件
  - "RTX 3090 LLM 3D generation" → 0件
  - "llama.cpp router mode" → 関連性の低い5件のみ（router mode自体への言及なし）
  - "ComfyUI VRAM unload" → 無関係な1件のみ
  - "llama-swap"単体では1件ヒット（"Llama-swap: Reliable model swapping"、2026-03-12、**2ポイント**——ほぼ無反応）

---

## 4. 測定された証拠（measured evidence）— issue tracker中心、否定的証拠を含む

課題追跡（issue tracker）は否定的な報告に偏る、という性質を踏まえて読むこと。ベンチマーク論文やリーダーボードのような独立した数値比較は、3Dモデル生成AI・GPU切り替えツールいずれについても本調査では発見できなかった[測定なし]。

### 4.1 llama.cpp: router mode の VRAM 残留問題（Issue #19379、closed）

[直接] `https://api.github.com/repos/ggml-org/llama.cpp/issues/19379` およびそのコメント一覧を取得。

- タイトル: "server: router mode subprocess still occupies GPU after sleep-idle-seconds"
- 報告本文:
  > "In router mode, when `--sleep-idle-seconds` triggers, the child subprocess unloads the model from VRAM but the process remains alive and attached to the GPU, consuming ~600MiB per idle subprocess"
- コメント履歴（複数のNVIDIA/AMDユーザーが再現、2026-02〜2026-08の間で継続報告）:
  - leonardcser（RTX PRO, CUDA13）: "Currently we 'unload' the vram but we still have a dormant process attached."
  - apunkt: ビルドによって挙動が変わる（"b8215... no GPU processes remained" / "b8261... GPU processes remain"）——リグレッションを繰り返している。
  - **anagnorisis2peripeteia（2026-07-22、最新かつ最も詳細なコメント）**:
    > "Still the case on current master: `sleep-idle-seconds` only destroys the model/context inside the child (`handle_sleeping_state` → `destroy()`); the child process itself stays alive, and no `--stop-idle-seconds`-style option exists in `common/arg.cpp`. So the ~600 MiB backend-context residual per sleeping child reported above remains by-design."
    > "A use case where this hurts more than on datacenter cards: shared consumer GPUs. Our RTX 5070 (12 GB) is a gaming card that also serves a 35B MoE via router mode — a dormant sleeping child permanently holds ~600 MiB of VRAM that games would otherwise use, which on a 12 GB card is often the difference between fitting VRAM budget or not."
    > "Workaround that works today (verified on `version: 9760 (6ee0f6579)`): an external watchdog that polls `GET /v1/models`... and POSTs `/models/unload {"model": "..."}` for anything reporting `sleeping` longer than a threshold. The unload path fully terminates the child: status returns to `unloaded`, the process exits, and all VRAM and host RSS are released."
  - この issue は2026-06-25に「14日間無反応でstale」として自動クローズされているが、直後の7月・8月にも再現コメントが続いている——**未解決のまま放置された**、と読める。
- 含意: **`--sleep-idle-seconds`だけに頼ると、VRAMは完全には解放されない**（プロセス自体は残り、~600MiB前後が恒久的に占有される）。完全解放には `POST /models/unload` を明示的に呼ぶ外部ウォッチドッグが必要、というのが2026-07時点でコミュニティが確認した唯一の回避策。

### 4.2 llama.cpp: `--models-max 1` のデッドロック（Issue #28829、open）

[直接] issue一覧のタイトルのみ確認、本文は未取得。
> "Misc. bug: router (--models-max 1) hard-deadlocks on a request for a non-resident preset - 500 'resource deadlock would occur' until restart"

`--models-max 1`は本件のような「1スロットだけ・切り替えて使う」構成でまさに使う設定値であり、2026-09-30時点でopenのままの信頼性上の懸念として記録しておく。本文詳細は未確認[要フォローアップ]。

### 4.3 llama.cpp: `/metrics`スクレイピングがスリープを妨げる（Issue #23096、closed）

> "GET /metrics in router mode triggers autoload and prevents model sleep"
クローズ済みだが、これは現行READMEの「`GET /metrics`はアイドルタイマーをリセットしない」という記述（README:2104-2108）が後から修正として反映された経緯を示唆する。Prometheus等で`/metrics`を定期スクレイプする構成では、修正前バージョンだと永久にスリープしなかった、という過去の失敗を裏付ける。

### 4.4 llama-swap: GPU単位でのグループ排他スコープ要求（Issue #632、closed）

[直接] 本文取得済み（§2.2で要約）。「exclusive」が現状インスタンス全体に対してグローバルに効くため、複数GPUや同一GPU上の可変VRAM配分を表現できない、という設計上の限界の指摘。提案された`pool`フィールドは現行ドキュメントには存在しない（§2.2参照）。**単一GPU構成では影響なし**（望む挙動と一致するため）。

### 4.5 llama-swap: ComfyUI統合の初期の摩擦（Issue #1188、closed 2026-09-29）

[直接] 本文取得済み。
> "I'm trying to setup the comfyui_auto model and when initially starting the model and trying to access the web app I couldn't make it past the splash screen... setting concurrencyLimit to 100 does load the interface but shows an error message 'can't show subgraph blueprints', 150 seems to load the full interface properly."

この報告を受けてPR #1189でデフォルトの`concurrencyLimit`が50→999に引き上げられ、現行ドキュメント（§2.2）にはこの値が既に反映されている。**「動くまでに実際に詰まった」実例**として記録するが、直近の対応で解消済み。

---

## 5. 実態（in the wild）— 公開リポジトリの採用・保守状況

[直接] すべて `curl` + `api.github.com`（GitHub REST API）で取得。

| リポジトリ | stars | 最終push | 状態 |
|---|---|---|---|
| ggml-org/llama.cpp | 129,922 | 2026-09-30（当日） | 非常に活発 |
| mostlygeek/llama-swap | 5,786 | 2026-09-29（前日）、open issues 96 | 活発、非archived |
| lordmathis/llamactl（代替ツール） | 154 | 2026-09-30（当日） | 活発だが小規模。README: "Smart Resource Management: Automatic idle timeout, LRU eviction, instance groups with per-group limits"（llama-swapのgroupsに類似する機能を持つ）、llama.cpp/MLX/vLLM対応を謳うが、grep範囲内でComfyUIへの言及は見当たらない |
| Comfy-Org/ComfyUI（旧comfyanonymous/ComfyUI） | 135,551 | 2026-09-30（当日） | 非常に活発。リポジトリ自体が組織移管されている |
| Tencent-Hunyuan/Hunyuan3D-2.1 | 4,097 | 2025-10-17（約11.5ヶ月前） | 停滞 |
| Tencent-Hunyuan/Hunyuan3D-2 | 14,994 | 2025-10-28（約11ヶ月前） | 停滞（starsは最大だが更新は止まっている） |
| microsoft/TRELLIS | 13,733 | 2026-06-26（約3ヶ月前） | 更新は継続しているが最近は緩やか |
| microsoft/TRELLIS.2 | 11,403 | 2026-07-10（約3ヶ月前） | 同上 |
| Stability-AI/stable-fast-3d | 1,835 | 2025-01-22（約20ヶ月前） | 事実上停止 |
| VAST-AI-Research/TripoSR | 6,998 | 2026-06-04（約4ヶ月前） | 緩やかに継続 |

補足: 同じTencent-Hunyuan組織内では`Hunyuan3D-WorldClaw`（2026-08-13push）、`Hunyuan3D-Buffalo1.0`（2026-08-10push）が直近まで更新されている一方、2.1自体は約1年近く放置されている。開発リソースが別プロジェクトに移った可能性を示唆するが、公式な移行アナウンスは本調査では確認できていない[未確認]。

llama-swap+ComfyUI/3D生成の組み合わせを扱う下流リポジトリは9件ヒットしたが（§3.4）、最大でも838 stars（かつ2GPU構成）、それ以外は20未満——**「1枚のGPUで切り替える」という具体的なパターンについて、広く踏み固められたコミュニティの前例は確認できなかった**。

---

## 6. 比較表

| ソース | 種別 | タスク/対象 | 結果・数値 | コスト数値 | 既知の失敗モード |
|---|---|---|---|---|---|
| llama.cpp README（PR #18228） | ベンダー[直接] | router mode idle sleep | `--sleep-idle-seconds`でモデルをRAM/VRAMからアンロード | — | Issue #19379: 子プロセスが~600MiB VRAMを保持したまま残留 |
| llama.cpp Issue #19379 | 測定/実測[直接] | 複数GPU（RTX PRO, RTX 5070 12GB, RTX 4060 Ti 16GB）で再現 | sleepさせても~600MiB残留、`/models/unload`なら完全解放 | 600MiB残留（複数報告で一致） | ビルドによって挙動が変わる、6ヶ月以上未修正のまま放置 |
| llama.cpp Issue #28829 | 測定[直接、タイトルのみ] | `--models-max 1` | 500エラーでデッドロック、再起動必要 | — | open（未解決） |
| llama-swap README/docs | ベンダー[直接] | groups/matrix/ComfyUI統合 | `exclusive: true`で他グループを全アンロード、ComfyUI専用エンドポイントあり | — | Issue #1188: 初期設定でconcurrencyLimit不足によりUI固まる（修正済み） |
| Hunyuan3D-2.1 README/LICENSE | ベンダー[直接] | 画像→3D（形状+PBRテクスチャ） | 10GB(形状)/21GB(テクスチャ)/29GB(合計) | 100万MAU超で要ライセンス申請、EU/UK/韓国除外 | リポジトリ11.5ヶ月未更新 |
| TRELLIS.2 README | ベンダー[要約経由] | 画像→3D | 24GB以上必須 | MITライセンス、商用制限なし | Linuxのみ、MPS非対応 |
| Stable Fast 3D README/LICENSE | ベンダー[直接] | 画像→3D | 6GB VRAM（デフォルト） | 年商100万ドル未満なら無料 | リポジトリ約20ヶ月未更新、MPSは実験的かつ高メモリ消費 |
| TripoSR LICENSE | ベンダー[直接] | 画像→3D | 測定なし | MIT、商用制限なし | VRAM数値未確認 |
| ComfyUI server.py/main.py | ベンダー[直接] | VRAM解放API | `POST /free`→`unload_all_models()`実装確認 | — | — |
| Varun Vasudeva (llm-server-docs) | 実践者[直接] | 2xRTX3090(48GB)でLLM+ComfyUI/FLUX | 24GB単一カードでの同時利用はVRAM逼迫を明言、切り替え設定例なし | — | 単一GPU動的切り替えの実例は書かれていない |
| ai-joe-git/comfyui_llama_swap | 実践者[要約経由] | ComfyUIノード | auto-unloadトグルあり | — | stars 16、採用小規模 |
| RealFireAU/dgx-spark-unified-stack | 実践者[要約経由] | DGX Spark、LLM+vLLM+ComfyUI | llama-swapでGPU共有 | — | stars 0、失敗事例の記述薄い |
| GitHub search (llama-swap+comfyui) | 実態[直接] | 採用状況 | 9リポジトリ、最大838 stars（2GPU構成） | — | ほとんどが低採用（0〜20 stars） |
| HN Algolia検索 | 実態[直接] | コミュニティ議論 | 関連投稿ほぼ0件、"llama-swap"単体で1件・2ポイント | — | 議論自体が薄い |

---

## 7. 何が言えて、何が言えないか

**言えること（証拠のある事実）:**
- llama.cpp本体・llama-swapともに「1つのGPU上でLLMを動的にロード/アンロードする」機構は存在し、活発に開発されている（llama.cppは本日push、llama-swapは前日push）。llama-swapはComfyUIとの組み合わせを名指しで想定した公式ガイドを持ち、これは2026-09-21更新と最近である。
- ComfyUI側にも`POST /free`によるVRAM解放APIがソースコードレベルで実在する。
- 3Dモデル生成AI側では、TRELLIS.2は24GBというRTX 3090 Tiの全容量に達する要求があり、Hunyuan3D-2.1はテクスチャ込みで29GB（24GBを超過）、Stable Fast 3Dは6GBで最も軽いがリポジトリは約20ヶ月停滞、Hunyuan3D-2.1自体も約11.5ヶ月停滞している。
- llama.cppのrouter mode単体の`--sleep-idle-seconds`は、複数の独立した報告（RTX PRO、RTX 5070、RTX 4060 Ti）で「VRAMを完全には解放しない」ことが確認されている。完全解放には明示的な`/models/unload`呼び出しが必要、というのが2026-07時点の最新コメントの結論。

**言えないこと・裏付けが弱いこと:**
- 「1枚の24GBカードでLLMと3D生成AIを実際に切り替えて安定運用している」という、Reddit/ブログ級の一人称の実践報告は、本調査では到達できたソースの範囲内で見つからなかった。GitHub上で最も星の多い関連実践ガイド（Varun Vasudeva、838 stars）は2GPU構成であり、単一GPUでの動的切り替えという核心部分は書かれていない。
- llama-swapの`groups`機能が、ComfyUIのような「websocketを握りっぱなしにするアプリ」と「router modeのllama-server」を同一の`exclusive`グループに混在させたときにどう振る舞うか（両者のcmd定義を1つのgroupにまとめて排他制御する具体例）は、公式ドキュメント中に直接の設定例が見当たらなかった——ComfyUI統合ガイドと groups/matrix ガイドはそれぞれ独立した文書として書かれており、両者を組み合わせた設定例は確認できていない。
- 3Dモデル生成AIのVRAM数値はすべて各ベンダー自身の自己申告であり、第三者ベンチマークによる独立検証は見つからなかった。

**欠けているもの:**
- 独立した第三者による3Dモデル生成AIのVRAMベンチマーク・品質比較（リーダーボード等）。
- 「LLMサーバーと3D/画像生成を1枚のGPUで切り替えて、うまくいかず元に戻した」という否定的な一人称の実践談（Redditに到達できなかったため）。
- llama.cpp Issue #28829（`--models-max 1`のデッドロック）の本文詳細。

---

## 8. 「前例なし」リスト（no precedent found）

- 24GBクラスの単一の民生GPUで、llama-serverのrouter modeとHunyuan3D-2.1/TRELLIS.2のような重量級3D生成モデルを、llama-swapのgroups機能で排他制御しながら安定運用している実例（設定ファイル込みの公開事例）。
- Tailscale SSH / tailscale serveだけを使ってMacからLinuxのGPU切り替え（モデルロード/アンロードのトリガー）を行っている公開実例。本調査では「できる」という技術的裏付け（ACLの仕組み、localhost限定のベストプラクティス）は得たが、それを実際にGPU切り替えの制御チャネルとして使った公開の実践報告は見つからなかった。
- 3Dモデル生成AI（Hunyuan3D/TRELLIS/Stable Fast 3D/TripoSR）どうしの、VRAM・生成品質・速度を横並びで比較した第三者ベンチマークやリーダーボード。
- Reddit r/LocalLLaMA等における、このものずばりの構成（1枚のGPU、LLM切り替え、3Dゲーム素材生成）についての議論（本セッションではReddit自体に到達不能だったため、存在するかどうか自体が未確認）。
