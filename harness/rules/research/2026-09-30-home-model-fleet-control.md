# Mac(LM Studio)と Linux(llama-server)を横断して「何が載っているか見る・切り替える」ための一つの操作口は何が業界標準か

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）

- `2026-09-30-one-gpu-llm-and-3d-generation.md`: llama-server router mode の `GET /models`・`POST /models/unload`、llama-swap の groups/exclusive/ComfyUI 統合、`--sleep-idle-seconds` の VRAM 残留バグ（#19379）は確立済み。本調査では引用のみ。
- `2026-09-30-home-llm-control-page.md`: LiteLLM Admin UI は DB 必須・チーム別集計のみ Enterprise、tailscale serve はバックエンド loopback が前提、「利用料+GPU切替を1画面にした公開例はゼロ」は確立済み。本調査は「その画面が何を叩くべきか」を Mac/Linux 双方の一次ソースまで掘り下げる続き。
- `harness/rules/decisions/2026-09-25-roles-named-as-people.md`: model-provider ロールは Mac が LM Studio、Linux+NVIDIA が llama-server と確定済み。本調査はこの二つを置き換える提案をしない。
- `harness/rules/decisions/2026-09-27-deterministic-falls-back-to-the-mac.md`: LiteLLM の `deterministic` tier は同一モデル名の中で `order: 1` が Omarchy 機の llama-server、`order: 2` が Mac の LM Studio、というフォールバック構成が確定済み。
- `harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`: LM Studio だけを `tailscale serve --bg --tcp 1234 127.0.0.1:1234` で tailnet に出し、LiteLLM は各機 loopback のまま、という境界線が確定済み。
- 持ち主の裁定: 操作口が Linux 機だけにあってはならない。「Mac のモデルを切り替えたい時はどうするの？ adhoc では？」という却下理由がある。

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl` でベンダーの生ドキュメント HTML/README/Issue を取得し、HTML タグ除去後 grep で原文引用した |
| [要約経由] | `WebFetch`（AI による要約）を通した。原文全体は見ていない |
| [到達不能] | 試みたが到達できなかった、または結果が内部矛盾していて信頼できなかった |
| [測定なし] | ソース自体に数値が無い |

**重大な制約（このセッションでも継続）**: WebSearch はセッション開始時点で既に予算（200/200）を使い切っていた（`WebSearch was not performed: this session has used its web search budget`）。本調査は一度も Google 的な横断検索ができておらず、既知の URL への直接アクセス（`curl`/`WebFetch`）と `api.github.com` 検索のみで構成されている。

`gh` コマンドは `api.github.com` への TLS 検証がこのサンドボックスで失敗する（`gh api repos/gpustack/gpustack` → `tls: failed to verify certificate: x509: OSStatus -26276`）ため、`curl` + `allowed_domains` で代替した。`curl` 経由の `api.github.com` も本調査中に繰り返し `API rate limit exceeded for 113.144.25.139`（未認証・IP 単位 60 回/時）を返したため、一部の数値（正確な star 数・release 日付）は `WebFetch` で github.com の HTML ページを読んだ値に頼っている。これらは [要約経由] と明記し、可能な範囲で `curl` の raw 取得と突き合わせて検証した。一件、`WebFetch` が GPUStack v2.0.0 のリリース日について内部矛盾する回答（"November 23, 2024" と "v2.3.0rc1 - September 1, 2024" が両立しない）を返したため、その日付自体は不採用とし [到達不能] とした。一方、同じ `WebFetch` が出した「`lms load`/`lms unload` は `--host` フラグを持つ」という要約は、`curl` で該当ページの生 HTML を取得しタグ除去して確認したところ原文と一致した——**要約経由の主張は言葉どおりには信用せず、可能な限り生ソースで裏取りした**。`gh`/GitHub の認証トークンを読み出す操作は行っていない。

---

## 2. ベンダー（vendors）

### 2.1 GPUStack — v2.0.0 で macOS ワーカー対応を打ち切っている

一次ソース: [直接] `https://raw.githubusercontent.com/gpustack/gpustack/main/README.md`、[直接] `https://docs.gpustack.ai/latest/migration/`（`curl` で取得しタグ除去後 grep）。

- README（Quick Start、Prerequisites 4項目）:
  > "4. Only Linux is supported for GPUStack worker nodes. If you use Windows, consider using WSL2 and avoid using Docker Desktop. macOS is not supported for GPUStack worker nodes."
- Migration ドキュメント（"Migrating from v0.7 and Earlier Versions to v2" の Note）:
  > "Since v2.0.0, GPUStack Worker officially supports only Linux. If you are using Windows or macOS, please move your data directory to a Linux system to perform the migration. On Windows and macOS, GPUStack Server (without the embedded worker) can still be run using Docker Desktop."
- **v1 では macOS ワーカーが存在していた**ことは、[要約経由]（`WebFetch` で GitHub issue 検索結果を読んだ）で裏付けられる: `#2451`「Partial offloading in GGUF fit selector does not handle UMA(macOS worker) correctly」（closed 2025-07-14）、`#2805`「Vox-box crashed in MacOS with error 137」（closed 2025-08-27）。つまり GPUStack は元々 macOS ワーカー（Apple Silicon の統合メモリ = UMA を扱うコード分岐まで持っていた）を持っていたが、v2 で明示的に切り捨てた。
- サーバー（管理側、ワーカーではない）は Windows/macOS でも Docker Desktop 経由で動かせるが、これは「GPU を貸すワーカー」ではなく「管理 UI を動かす CPU ノード」の話であり、本調査の要件（Mac の GPU/モデルを切り替える）には無関係。
- 対応バックエンド（README）: vLLM, SGLang, TensorRT-LLM、カスタムエンジン。llama-box（v1 で使われていた llama.cpp フォーク、Metal 対応の要）や MLX への言及は現行 README に無い。
- ライセンス: Apache-2.0（[要約経由] github.com ページ、`curl` の API 呼び出しはレート制限で取得できず）。star 数 5.8k（[要約経由]、同上の制約）。

**結論**: GPUStack は現行版（v2 系、2024 年後半以降）では Mac をワーカーにできない、と一次ドキュメントが明言している。本調査の要件（Mac と Linux 両方を一つの操作口で切り替える）を GPUStack 単体では満たせない。

### 2.2 llama-swap — 機械ごとのプロセス管理であり、複数機械をまたぐ機能は無い

一次ソース: [直接] `https://raw.githubusercontent.com/mostlygeek/llama-swap/main/README.md`（既存調査 `2026-09-30-one-gpu-llm-and-3d-generation.md` §2.2 と同一ソース、本調査では配布形態とマルチマシン機能の有無だけを追加確認）。

- macOS でも動く（README:99-100）: "2. Homebrew (macOS and Linux)"、"3. MacPorts (macOS)"。リリースバイナリも "Linux, Mac, Windows and FreeBSD" 向けにある（README:284）。
- README 全文（412行相当）を `remote`／`multi.machine`／`multiple host`／`cluster`／`distributed` で grep したところ、ヒットしたのは `/logs` エンドポイントの説明の中の「remote log monitoring」という一語のみ（README:52）——これは同一インスタンスのログを遠隔から見る機能で、複数機械を束ねる機能ではない。
- llama-swap は `cmd`/`cmdStop` で**自分が起動した**子プロセスしか管理できない（既存調査で確認済みの ComfyUI 統合と同じ形）。LM Studio のように既に常駐しているデーモンを外部から `lms load`/`unload` で操作する、という使い方は README 中に例が無い。技術的には `cmd: lms load ...`、`cmdStop: lms unload ...` と書けば動きそうに見えるが、これは推測であり [unverified]、公開された設定例は見つからなかった。

**結論**: llama-swap は「1 機械の中でモデルを切り替える」道具としては両プラットフォームで動くが、「複数機械を横断して見る・切り替える」機能そのものは持たない。Mac と Linux にそれぞれ 1 個ずつ立てても、それを束ねる第三の層が別途要る——これは `2026-09-30-home-llm-control-page.md` の「利用料+GPU切替を1画面にした公開例はゼロ」という結論と整合する。

### 2.3 LM Studio 自身の遠隔操作口 — `lms --host` と LM Link

一次ソース: [直接] `https://lmstudio.ai/docs/developer/rest`、[直接] `https://lmstudio.ai/docs/cli/local-models/load`、[直接] `https://lmstudio.ai/docs/cli/local-models/ps`、[直接] `https://lmstudio.ai/docs/cli/serve/server-start`、[直接] `https://lmstudio.ai/docs/cli/link/link-status`、[直接] `https://lmstudio.ai/docs/cli/link/link-enable`（すべて `curl` で HTML 取得、`<script>` 除去、タグ除去、grep）。[要約経由] `https://lmstudio.ai/docs/lmlink`（Overview ページ）。

- **v1 REST API（LM Studio 0.4.0 以降）**（`developer/rest`）:
  > "Previously, there was a v0 REST API. With LM Studio 0.4.0, we have officially released our native v1 REST API at /api/v1/* endpoints and recommend using it. The v1 REST API includes enhanced features such as: MCP via API, Stateful chats, Authentication configuration with API tokens, Model download, load and unload endpoints"
  - エンドポイント表: `/api/v1/chat` POST、`/api/v1/models` GET、`/api/v1/models/load` POST、`/api/v1/models/unload` POST、`/api/v1/models/download` POST、`/api/v1/models/download/status` GET。これは既存決定（tailscale serve で 1234 番を tailnet に出す）の上にそのまま乗る HTTP API であり、Linux 機からも Mac の tailnet 名に `curl` すれば load/unload/一覧が取れる。
- **`lms` CLI の `--host` フラグ**（`cli/local-models/load`）:
  > "Operate on a remote LM Studio instance — lms load supports the --host flag to connect to a remote LM Studio instance. `lms load <model_key> --host <host>` For this to work, the remote LM Studio instance must be running and accessible from your local machine, e.g. be accessible on the same subnet."
  - 同じ文言が `lms unload`（`--host`）と `lms ps`（`cli/local-models/ps`）にもある:
    > "lms ps supports the --host flag to connect to a remote LM Studio instance: lms ps --host <host>"
  - **「同一サブネットに見える」という条件がそのまま Tailscale の tailnet に当てはまるかはベンダー文書には明記が無い**——Tailscale はオーバーレイ IP/MagicDNS 名を張るので技術的には満たせるはずだが、公式が Tailscale を名指しでこの `--host` フラグの動作確認先として挙げてはいない [unverified]。
- **`lms server start` のバインド先**（`cli/serve/server-start`）:
  > "--bind (optional) : string — Network address to bind the server to. Use \"0.0.0.0\" to listen on all IPv4 interfaces, or \"127.0.0.1\" (default) for localhost only. Can also be set via the LMS_SERVER_HOST environment variable."
  - 既存決定どおり `127.0.0.1` のまま `tailscale serve` に任せれば、この `--bind` 自体は変更不要。
- **LM Link（ベンダー公式のマルチデバイス機能、Tailscale と提携）**（[要約経由] Overview ページ）:
  > LM Link is "a new feature in LM Studio that provides a way to access local models across devices, wherever you are." "made possible in partnership with Tailscale" と説明されている、と `WebFetch` が要約。
  - CLI 側の実体は `lms link enable`/`disable`/`status`/`set-device-name`/`set-preferred-device`（[直接] 各ページ確認済み）。
  - `lms link enable`（[直接]）:
    > "The lms link enable command enables LM Link on this device, allowing it to connect with other devices on the same link. Info: LM Link requires an LM Studio account. Run lms login first if you haven't already."
  - `lms link status`（[直接]）:
    > "The lms link status command shows whether LM Link is enabled on this device, and lists connected peers and their loaded models."
  - **LM Link は LM Studio アカウントへのログインが前提**——`--host` フラグ（アカウント不要、素の IP/ホスト名指定）とは別の経路であり、「アカウントに紐づく自社サービス経由の便利機能」と「アカウント不要の生の REST/CLI」の二本立てになっている。

**結論**: LM Studio 自身が、Mac 側の遠隔操作口を公式にもっとも厚く用意している——REST API（`/api/v1/models/{load,unload}`）と CLI（`lms {load,unload,ps} --host`）の**二重**。しかも `--host` 系はアカウント不要でそのまま Tailscale の到達性に乗せられる（未検証だが構造上矛盾しない）。一方 LM Link はアカウント必須の別機能で、Tailscale との提携を謳うが本調査ではその中身（P2P か中継か）を一次資料で確認できなかった。

### 2.4 llama-server（Linux 側）— HTTP のみ、ベンダー製のマルチホスト CLI は無い

既存調査（`2026-09-30-one-gpu-llm-and-3d-generation.md` §2.1）から引用のみ: `GET /models`、`POST /models/unload {"model": "<id>"}`。llama.cpp 自体は `lms` に相当する遠隔操作 CLI を配布していない。ユーザーは `curl` か llama-swap を使うしかない。

**結論**: Mac 側は「ベンダー製の `--host` 付き CLI」という完成品があるのに対し、Linux 側は「HTTP エンドポイントが公開されているだけ」で対称ではない。一つの操作口を作るなら、Mac 向けには `lms ... --host` をそのまま呼び、Linux 向けには `curl` で llama-server の HTTP API を直接叩く——**薄いラッパーを自分で書く以外の道は見つからなかった**（これは llama-swap の節、および `2026-09-30-home-llm-control-page.md` の結論と一致する）。

### 2.5 exo（exo-explore/exo）— 異種クラスタを謳うが Linux は CPU のみ

一次ソース: [直接] `https://raw.githubusercontent.com/exo-explore/exo/main/README.md`（`curl` で取得、grep）。

- README:201（Linux セットアップ手順の直後）:
  > "**Important note for Linux users:** Currently, exo runs on CPU on Linux. GPU support for Linux platforms is under development. If you'd like to see support for your specific Linux hardware, please [search for existing feature requests] or create a new one."
- README:588（FAQ 相当の節）:
  > "On macOS, exo uses the GPU. On Linux, exo currently runs on CPU. We are working on extending hardware accelerator support."
  - 同じ趣旨の警告が README 内に 2 箇所独立して書かれており、書き漏れではなく明確な既知の制約として扱われている。
- star 数 47,697（[直接] `github.com/exo-explore/exo` の HTML から `aria-label="47697 users starred"` を正規表現で抽出）、ライセンス Apache-2.0（[要約経由]）。

**結論**: exo は「Mac と NVIDIA Linux を一つのクラスタにする」という触れ込みそのものは本件の理想形に近いが、**Linux 側で GPU を使えない**（CPU のみ）という一次ソースの明記により、RTX 3090 Ti を使う本件の要件を満たせない。star 数が最大級（47.7k）であるにもかかわらず、この一点で不採用になる——人気度と要件適合は別軸である好例。

### 2.6 Olla（thushan/olla）— 複数バックエンドの統合「一覧」はあるが load/unload は無い

一次ソース: [直接] `https://raw.githubusercontent.com/thushan/olla/main/readme.md`（`curl` で取得、grep）。

- 自己紹介（README:34）:
  > "Olla is a high-performance, low-overhead, low-latency proxy and load balancer for managing LLM infrastructure. It intelligently routes LLM requests across self-hosted inference nodes with a wide variety of natively supported endpoints... Olla provides model discovery and unified model catalogues within each provider, enabling seamless routing to available models on compatible endpoints."
- 既存の道具との関係（README:36）:
  > "Olla works alongside API gateways like LiteLLM or orchestration platforms like GPUStack, focusing on making your **existing** LLM infrastructure reliable through intelligent routing and failover."
- LM Studio・llama.cpp をネイティブ対応（README:85, 88）:
  > "| LM Studio | Integration | ⚡ Passthrough (v0.4.1+) |"
  > "| llama.cpp | Integration | ⚡ Passthrough (b4847+) |"
- 対応プラットフォーム（README:106-113）: Linux（AMD64/ARM64、Raspberry Pi 4+ 含む）、macOS（Intel/Apple Silicon M1〜M4）、Windows、Docker——すべて✅。
- **`unload` という語は README 全文に一度も出現しない**（[直接] grep で 0 件）。ComfyUI・画像生成・3D 生成への言及も無い。
- README:256:
  > "Complete setup with OpenWebUI + Olla load balancing multiple Ollama instances or unify all OpenAI compatible models."

**結論**: Olla は「Mac の LM Studio と Linux の llama-server を一つのカタログとして見る」ところまでは公式にネイティブ対応しているが、モデルの load/unload・GPU 用途切替という**書き込み系の操作**は提供しない、ルーティング/フェイルオーバー専用の道具。「見る」の半分（どのバックエンドにどのモデルがあるか）は埋まるが、「切り替える」は埋まらない。star 数 311（[直接] `api.github.com` search API のレスポンス、2026-09-30 時点）、最終 push 2026-09-27（研究日の 3 日前、活発）。

### 2.7 LocalAI — P2P/Distributed モードはあるが、LM Studio/llama-server を置き換える設計

一次ソース: [直接] `https://raw.githubusercontent.com/mudler/LocalAI/master/README.md`、[直接] `https://localai.io/docs/features/distributed-mode/`、[直接] `https://localai.io/docs/features/distribute/`（`curl` で取得、タグ除去、grep）。

- Distributed Mode（本文冒頭）:
  > "Distributed mode enables horizontal scaling of LocalAI across multiple machines using PostgreSQL for state and node registry, and NATS for real-time coordination. Unlike the P2P/federation approach, distributed mode is designed for production deployments and Kubernetes environments where you need centralized management, health monitoring, and deterministic routing."
  > "Note: Distributed mode requires authentication enabled with a PostgreSQL database - SQLite is not supported."
  - ナビゲーション上で "Distributed Mode (experimental)" と明記（[直接] ページ内テキスト）。
- P2P/Federated Inference（比較表の冒頭）:
  > "P2P / Federated inference — Ad-hoc clusters, community sharing, quick experimentation. Nodes discover each other via a shared libp2p token, with no central server."
  > "Starting LocalAI with --p2p generates a shared token for connecting multiple instances... This feature, while still experimental, offers a tech preview quality experience."
  - **どちらのモードも「複数の LocalAI インスタンス」を束ねる機能であり、既存の LM Studio や llama-server のプロセスを外部から操作する機能ではない**。採用するには Mac・Linux 双方の推論エンジンを LocalAI 自身に置き換える必要がある。
- LocalAI 自体はハードウェアとして Apple Silicon（Metal・MLX・macOS ネイティブランチャー）と NVIDIA（CUDA 12/13）の両方を公式に謳う（README: "Any hardware: NVIDIA, AMD, Intel, Apple Silicon, Vulkan, or CPU-only"）ので、技術的な異種対応力自体は exo や GPUStack より高い。
- star 数 49.3k、ライセンス MIT（[要約経由] github.com ページ）。

**結論**: LocalAI は技術的には最も「異種プラットフォームを一つのクラスタにする」力を持つが、それは**既存の LM Studio・llama-server を LocalAI 自身に置き換えること**を意味し、`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`・`2026-09-25-roles-named-as-people.md` で確定済みの「サーバーは LM Studio/llama-server を維持する」という決定と衝突する。加えてベンダー自身が本番/Kubernetes 向けと明言する Distributed Mode は Postgres+NATS という自宅には重いインフラを要求し、より軽量な P2P モードは公式に "still experimental" と明記されている。本調査ではこの二点（決定との衝突・重さ/実験的の両方）を理由に、置き換え候補としては不採用、参考情報としてのみ記録する。

---

## 3. 実践者（practitioners）

WebSearch 予算切れのため、本調査でも GitHub 検索と HN Algolia に限定される。`2026-09-30-home-llm-control-page.md` §3 で確認済みの実践者は再確認せず引用のみ行う。

### 3.1 既存調査からの引用（再確認なし）

- **NicolasPogorzelski/homelab-server-architecture**（star 1）: 「サービスは loopback だけで待ち、Tailscale Serve がリバースプロキシになる」という ADR を持つ実践者。GPU 切替や LM Studio 遠隔操作そのものの記録は無いが、tailnet 内操作口の置き方の実測記録として引用済み。
- **wenrui0128/tailquota-limit**（star 0）: LiteLLM 利用料を tailnet 内だけに見せる読み取り専用ダッシュボード。「操作」ではなく「閲覧」のみ。
- **AdamFerguson/spark-lab**（star 0）: モデル切替を Web ボタンではなく CLI（`model up`/`down`）の宣言的 converge 操作で行う設計。「GPU/モデル切替は CLI で行い、Web ボタンでは行わない」という設計判断の実例として引用済み。

### 3.2 LM Studio の CLI 開発コミュニティ自身が「まだ足りない」と言っている

一次ソース: [直接] `https://api.github.com/search/issues?q=repo:lmstudio-ai/lms+--host`（`curl`、JSON 直接取得）、各 Issue/PR の個別ページ（[直接]/[要約経由] 混在、後述）。

- **PR #280**「Environment support for multiple hosts or ports - Redo」（Draft、作成日 2025-07-29、研究日時点で 14 ヶ月以上 open のまま）。[要約経由]（`WebFetch` で PR 本文とレビューコメントを要約、原文全体は未確認）:
  > Docker の context 機構を模した `lms env add/remove/ls/use/current/inspect` を提案。毎回 `--host`/`--port` を打たなくて済むようにする機能。レビュワーのコメント: "restore PR description from reverted PR" "add tests for existing functionality before merging this"
  - タイトルに "Redo" とあることから、一度 revert された経緯があることが読み取れる（本文の詳細は未確認 [要フォローアップ]）。
  - **つまり `--host` フラグ自体は動くが、「名前で複数の遠隔ホストを覚えておく」という運用上自然な機能は、14 ヶ月以上 unmerged の draft のまま**——本調査の「Mac と Linux を同じように呼び出す」という要件に対して、公式 CLI はまだ最後の一歩を作っていない。
- **Issue #637 / #638**（重複、両方 open、作成日 2026-09-16、研究日の 2 週間前）「feat(cli): add `lms top` dashboard for real-time system, VRAM, and throughput monitoring」——[直接] タイトルのみ確認。**「VRAM・スループットのリアルタイム監視ダッシュボード」は 2026-09-30 時点でまだ存在せず、要望として出されたばかり**。`lms ps --host` は「今何が読み込まれているか」の一覧は返すが、VRAM 使用量やスループットの実測値までは返さない、という現状の裏付けになる。
- **Issue #486**「How to use lm studio link with mobile device like iPhone and Android?」（open、作成日 2026-02-26、研究日時点で 7 ヶ月以上未解決）——[直接] タイトルのみ確認。LM Link のモバイル連携が、少なくともこの質問者にとっては 7 ヶ月経っても自明でなかったことを示す。

### 3.3 見つからなかったもの

- 「Mac の LM Studio と Linux の llama-server/llama-swap を `lms ... --host` や自作スクリプトで一つの CLI/画面にまとめた」という、個人名つきのブログ記事・Reddit 投稿・実装リポジトリは、本調査で到達できた範囲（GitHub 検索、HN Algolia）では見つからなかった。
- GPUStack の macOS ワーカー廃止（v2.0.0）について、実際に困って移行した/他ツールに移った、という一人称の体験談も見つからなかった。

---

## 4. 測定された証拠（measured evidence）

課題追跡は否定的な報告に偏るという性質を踏まえて読むこと。本主題（家庭内フリート操作口）についての独立ベンチマークや論文は、前回調査（`2026-09-30-home-llm-control-page.md` §4）と同様、本調査でも一件も見つからなかった [測定なし]。

### 4.1 HN Algolia: LM Link への反応はほぼゼロ

[直接] `https://hn.algolia.com/api/v1/search?query=LM%20Link%20LM%20Studio&tags=story`。ヒット 6 件中、LM Link に直接言及するもの 4 件:

| 投稿日 | points | comments | タイトル |
|---|---|---|---|
| 2026-02-25 | 3 | 0 | "LM Studio: LM Link" |
| 2026-02-26 | 1 | 0 | "LMStudio LM Link: Use your local models, remotely" |
| 2026-05-09 | 2 | 0 | "LM Link: Use your local models, remotely" |
| 2026-06-04 | 3 | 0 | "Run (your largest) local models from your iPhone – LM Studio Blog" |

すべて 1 桁 points・コメント 0 件。ベンダーが「Tailscale と提携」と謳う目玉機能にしては、Hacker News 上での反応は 2026-02（発表直後と見られる）から 2026-06 まで一貫して低調——議論そのものが起きていない。これは「悪い」という証拠ではなく「まだコミュニティに評価されるほど使われていない」ことの数値的な裏付けとして読む。

### 4.2 GPUStack: macOS 関連 Issue は 203 件ヒットするが v2 以降の「戻せ」要求は見当たらない

[直接] `https://api.github.com/search/issues?q=repo:gpustack/gpustack+macos+in:title,body` — `total_count: 203`。全件は精査していないが、[要約経由] で得た上位ヒットの内訳は v1 時代の macOS ワーカーのバグ報告（#2451, #2805 など）が中心で、v2 リリース後に「macOS ワーカーを復活させてくれ」という明示的な要求 Issue は、本調査で確認した範囲（検索結果の上位・"v2" を含む絞り込み検索 25 件）では見当たらなかった。これは「誰も困っていない」のか「困った人はもう GPUStack を離れた」のか、この調査だけでは判別できない [unverified]。

### 4.3 lmstudio-ai/lms: `--host` 関連の Issue/PR は 51 件ヒット、うち fleet 管理に直接関係するのは 3〜4 件

[直接] `https://api.github.com/search/issues?q=repo:lmstudio-ai/lms+--host` — `total_count: 51`。§3.2 で個別に引用した #280・#637・#638・#486 以外は `--host` という語がたまたま本文に含まれるだけの無関係な Issue が大半だった（個別精査はしていない）。

---

## 5. 実態（in the wild）— 公開リポジトリの状態

| リポジトリ | stars | 最終 push / 確認日 | ライセンス | 状態 |
|---|---|---|---|---|
| gpustack/gpustack | 5.8k [要約経由] | 活発（正確な日付は内部矛盾のため不採用、[到達不能]） | Apache-2.0 | 活発だが v2.0.0 で macOS/Windows ワーカーを明示的に廃止 |
| mostlygeek/llama-swap | 5,786（前回調査で確認済み） | 2026-09-29 | MIT（前回調査で確認済み） | 活発、複数機械をまたぐ機能は無い |
| exo-explore/exo | 47,697 [直接] | 不明（API レート制限で未取得） | Apache-2.0 [要約経由] | 非常に活発、ただし Linux は CPU のみで GPU 未対応 |
| thushan/olla | 311 [直接] | 2026-09-27 [直接] | Apache-2.0 | 活発だが若い（LM Studio/llama.cpp 対応のルーター、load/unload 機能なし） |
| mudler/LocalAI | 49.3k [要約経由] | 活発（README の変更履歴が 2026-06 まで継続） | MIT [要約経由] | 非常に活発。Distributed Mode は自称 "(experimental)"・本番/K8s 向け |
| lmstudio-ai/lms | 5.3k [要約経由] | 活発（#637/#638 が 2026-09-16 に開かれている） | MIT [要約経由] | 活発。`--host` は実装済みだが複数ホスト管理・監視ダッシュボードは未完成 |

補足: GitHub API のレート制限（未認証・IP 単位 60 回/時）に本調査全体で繰り返し当たったため、一部の star 数・push 日付は `WebFetch` 経由（github.com の HTML ページを要約）に頼らざるを得なかった。これらは表中に [要約経由] と明記した。

---

## 6. 比較表

| ソース | 種別 | 対象 | 結果・数値 | コスト数値 | 既知の失敗モード |
|---|---|---|---|---|---|
| GPUStack README/migration docs [直接] | ベンダー | worker platform | "macOS is not supported for GPUStack worker nodes"（v2.0.0以降） | Enterprise は別課金（Cluster Topology view） | v1→v2 で macOS/Windows ワーカーを打ち切り、移行はLinuxへの手動データ移動が必要 |
| llama-swap README [直接] | ベンダー | 配布形態 | macOS/Linux/Windows/FreeBSD で動くが、複数機械をまたぐ機能はREADME中に0件 | — | 多機体をまとめる機能自体が存在しない |
| LM Studio REST v1 / lms CLI [直接] | ベンダー | 遠隔 load/unload | `/api/v1/models/{load,unload}`、`lms {load,unload,ps} --host <host>` | — | "same subnet" 前提の記述のみでTailscale越しの動作は未確認[unverified] |
| LM Link docs [要約経由] | ベンダー | マルチデバイス | Tailscale提携、要アカウント・`lms login` | 要アカウント（無料枠等は未確認） | モバイル連携のQ&Aが7ヶ月未解決（#486） |
| llama-server README（既存調査引用） | ベンダー | HTTP API | `GET /models`、`POST /models/unload` | — | ベンダー製の遠隔CLIが無く、curlか自作ラッパーが必須 |
| exo README [直接] | ベンダー | 異種クラスタ | "Linux runs on CPU... GPU support under development" | — | Linux上でGPUが使えず本件要件を満たさない |
| Olla README [直接] | ベンダー | 統合discovery/routing | LM Studio・llama.cpp双方にネイティブ対応、Linux/macOS/Windows全対応 | — | "unload"の語が0件、load/unload制御機能なし |
| LocalAI docs [直接] | ベンダー | P2P/Distributed | Distributed=Postgres+NATS必須・"(experimental)"、P2P="still experimental" | 自宅にはPostgres+NATSが重い | 既存のLM Studio/llama-serverを置き換える設計、既存決定と衝突 |
| HN Algolia (LM Link) [直接] | 実態/測定 | コミュニティ反応 | 4投稿すべて1桁points、コメント0件 | — | 発表から半年近く議論が起きていない |
| lmstudio-ai/lms PR #280 [要約経由] | 実践者/測定 | 複数ホスト管理UX | Draft、14ヶ月以上open、"Redo"（一度revertされた経緯） | — | 名前付き複数ホスト管理はまだ製品に無い |
| lmstudio-ai/lms #637/#638 [直接] | 測定 | 監視ダッシュボード要望 | 2026-09-16に開かれ両方open | — | VRAM/スループットの横断監視は現状存在しない |
| NicolasPogorzelski/homelab-server-architecture（既存調査引用） | 実践者 | tailscale serve パターン | loopback+tailscale serveのADR、star 1 | — | ブート順序レース(KE-12)実測あり |

---

## 7. 何が言えて、何が言えないか

**言えること（証拠のある事実）:**

- 「Mac と Linux を横断する一つの操作口」を名乗るオーケストレーション製品（GPUStack, exo, LocalAI の Distributed/P2P モード）は、いずれも本件の具体的な組み合わせ（LM Studio on Mac + llama-server on Linux、両方を維持したまま）を素直には満たせない。GPUStack は v2.0.0 で macOS ワーカーを一次ドキュメントで明示的に打ち切っており（"macOS is not supported"）、exo は Linux で GPU が使えず（"Currently, exo runs on CPU on Linux"）、LocalAI の分散モードは既存の LM Studio/llama-server を LocalAI 自身に置き換えることを前提にしている。
- 一方、**LM Studio 自身の一次ソースには、遠隔からの load/unload/一覧のための公式な口が既に二つある**——REST API（`/api/v1/models/{load,unload}`、v0.4.0以降）と CLI（`lms {load,unload,ps} --host <host>`）。これは既存決定（LM Studio を tailnet に出す、Linux は llama-server の HTTP API をそのまま使う）とそのまま組み合わせられる。
- Olla（thushan/olla）は LM Studio・llama.cpp 双方にネイティブ対応した「どのバックエンドに何が載っているか」の統合カタログをクロスプラットフォームで提供する数少ない実物だが、load/unload という書き込み系の操作は提供しない——「見る」の一部は埋まるが「切り替える」は埋まらない。
- LM Studio の CLI コミュニティ自身が、複数の名前付き遠隔ホストを扱う機能（PR #280）や横断監視ダッシュボード（#637/#638）をまだ持っていないと認識しており、前者は14ヶ月以上 unmerged の draft のままである。

**言えないこと・裏付けが弱いこと:**

- `lms {load,unload,ps} --host <host>` が Tailscale の tailnet 越し（MagicDNS 名や 100.x IP）で実際に動くという一次資料での確認は取れなかった。ベンダー文書は「同一サブネットに見えること」としか書いておらず、Tailscale を名指ししていない [unverified]。
- LM Link がどのような経路（P2P か LM Studio 自身の中継サーバーか）でトラフィックを流すのかは、要約経由の情報しか得られず一次資料で確認できなかった。
- 「Mac の LM Studio と Linux の llama-server/llama-swap を、`lms ... --host` と llama-server の HTTP API を薄いラッパーで束ねて一つの CLI/ページにした」という具体的な公開実装は、本調査の到達範囲（GitHub検索、HN Algolia、WebSearch予算切れのため個人ブログ・Redditは探索不能）では一件も見つからなかった——前回調査（`2026-09-30-home-llm-control-page.md`）の「利用料+GPU切替を1画面にした公開例はゼロ」という結論と同じ形の空白が、今回の「Mac/Linuxをまたぐload/unload」でも繰り返されている。
- GPUStackのmacOSワーカー廃止に実際に困って移行した、という一人称の体験談は見つからなかった（存在しないのか、検索範囲の制約か判別不能）。

**欠けているもの（WebSearch予算切れによる制約が大きい）:**

- Reddit（r/LocalLLaMA, r/selfhosted）・個人ブログでの、この具体的な組み合わせ（Mac LM Studio + Linux NVIDIA llama-server、両プラットフォームを一つの操作口で）についての実践談。
- `lms --host` の実測レイテンシ・信頼性（タイムアウト、ネットワーク切断時の挙動）についての独立した報告。
- Olla を実際に LiteLLM と併用して「見る」層として使っている家庭内セットアップの実例。

---

## 8. 「前例なし」リスト（no precedent found）

- Mac の LM Studio（`lms --host` または REST `/api/v1/models`）と Linux の llama-server（HTTP `/models`）を、一つの CLI サブコマンド体系または一つの Web ページで束ねて「見る・切り替える」ことを実装した公開リポジトリ・ブログ記事。
- `lms {load,unload,ps} --host` が Tailscale の tailnet 越しに動作することを確認した一次資料または実践報告（技術的に矛盾しないが、確認例が無い）。
- GPUStack・exo・LocalAI のいずれかを、既存の LM Studio/llama-server を置き換えずに「上に薄く被せる操作口」として使っている実例（見つかった実例はすべて、これらの製品自身が推論エンジンを兼ねる前提だった）。
- Olla のような統合カタログ層に、モデルの load/unload や GPU 用途切替（LLM ⇔ ComfyUI）を書き込み操作として追加した公開実装。
