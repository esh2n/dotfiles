---
question: "自宅の Mac（M-series, 64GB）で動かすローカル LLM を、三つのユースケース — U1: その Mac 上で使う、U2: ローカル LLM を持たない別の PC で jig ハーネス（判断サービス・モデル tier 振り分け・LiteLLM 計測）を使い、モデルだけ自宅 Mac のものを使う、U3: スマホから（自宅外含む）使う — に同時に応えるとき、2026 年の業界はサーバー（LM Studio / Ollama / llama.cpp server / mlx-lm / その他）、受付層（LiteLLM のような gateway を置くか、置かないか、置くなら何か）、到達経路（Tailscale 等）をどう組んでいるか。LM Studio と LiteLLM という現行の選択は正しいか。"
date: 2026-09-23
verdict: "U1(Mac本体)はLM Studio維持で妥当 — headless daemon(`lms daemon up`)・tool calling・structured output(GGUFはgrammar制約、MLXはOutlines)を公式ドキュメントが裏付け、乗り換える証拠がない。U2(別マシンのjigハーネス)は前回記録の(c) LiteLLM proxyをtailnet越しに公開・LM StudioはloopbackのままをNEUTRALに支持継続 — ただしLiteLLM自体にGitHub Security Advisories 14件(critical 4件、うち2件は無認証で悪用可能)が見つかり『CVE実績は未調査』だった前回の空白を埋めた。この持ち主の現在のpin(1.103.0系)は全件のpatchより新しいため実害は無いが、Tailscale IDに重ねる二重認証という設計そのものに公開実地の前例は依然ゼロ — 実地で見つかった別マシン到達の実例(ncaq, kuznero, norllama)は全てTailscaleの身元だけを境界にしアプリ層キーを重ねない設計だった。U3(スマホ)はOpen WebUI(PWA)がほぼ唯一の実務解 — Ollama公式モバイルアプリは確認できず、LM StudioのUIはデスクトップのみ。受付層の選定自体は割れている: LiteLLM(59.4k★, cloud-provider統合が主眼)を自宅ラボ勢はほぼ使わず、Olla(304★, 50MB未満)や自作の最小ゲートウェイ(smol-llm-proxy, norllama)に寄る例が実地で複数見つかった一方、TensorZeroは2026-06-11にarchived済み。"
unverified:
  - "LiteLLM + LM Studio + tailnet の組み合わせを実際に運用している公開リポジトリ(gh search codeで前回・今回とも0件、前回記録と同じ結果)"
  - "MLX vs GGUF の直接ヘッドトゥヘッド throughput 数値比較(ベンダー側は双方とも数値を公開せず、HN上の1個人の非対称条件の実験のみ)"
  - "Tailscale Services(ncaq実装が使う、複数ホストが同一名を名乗るマルチホスト抽象化)の公式ドキュメントページ(複数URLを試したが404/308連発で到達不能)"
  - "mlx-lm server のデフォルト並行リクエスト処理(バッチング)挙動 — SERVER.mdはKV量子化時のみ逐次処理と明記するが、非量子化時の並行数は未記載"
  - "TensorZeroがarchivedになった理由(買収/事業終了/方針転換のいずれか、GitHub API自体はarchived=trueとpushed_at=2026-06-11しか返さない)"
  - "Open WebUIをこの持ち主と同型のLiteLLM bearer key構成に繋いだ公開実装例"
  - "『dumped ollama』というHNコメントが指す具体的な事案の中身(信頼性懸念の詳細までは追っていない)"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 自宅ローカルLLMサーバーを3ユースケース(自機/別マシンのjig/スマホ)に同時に応えさせる2026年の構成

**問い**: frontmatterの`question`参照。

**調査日**: 2026-09-23。セッションのWebSearch予算は本調査の冒頭で枯渇(200/200、既存セッションの他作業分含む)。WebFetch・認証済みcurl(`gh auth token`をBearerとしてGitHub REST APIに直接渡す形で`gh` CLI自体のTLS不具合を回避)・HN Algolia APIで代替した。`gh` CLI自体は本セッションのサンドボックスTLS設定と衝突し`x509: OSStatus -26276`で全滅したため、`curl -H "Authorization: Bearer $(gh auth token)"`でGitHub REST APIを直接叩く形に切り替えている。

**既存記録との関係**: [`2026-09-23-local-llm-across-home-machines.md`](./2026-09-23-local-llm-across-home-machines.md)(以下「前回記録」)が確立した事実(LM Studioの0.3.x系は認証機能なし・0.4.24でもheadlessでは認証トグルをCLIから有効化できない未解決バグ`lms#489`、Ollamaの認証欠如CVE群、`tailscale serve --tcp`の罠、Tailscale Funnelは有償枠のみ、sleep/caffeinate問題、ローカル事実確認)は再調査していない。本記録はその上に「サーバー種の比較」「受付層の選定」「U2/U3固有の実地パターン」という前回スコープ外だった3点を積む。

---

## 0. jigが受け口に要求するもの(read-only確認、ローカル事実)

- `domains/dev/config/litellm/config.yaml`: `model_list`の`deterministic`は`lm_studio/qwen/qwen3.8-27b`。LiteLLMの`prometheus`コールバックのみ有効、`require_auth_for_metrics_endpoint: false`(loopback前提)、`master_key`は`os.environ/LITELLM_MASTER_KEY`でop経由の実秘密。**Postgres/Redisの設定は無い** — LiteLLMの「フル機能(仮想キーのDB永続化・予算のRedis集計)」は使っておらず、`model_list`ルーティングと`master_key`単体認証という最も軽いモードで動いている。
- `domains/dev/llm/harness/policy/tiers.json`: `connections.proxy.baseUrl` = `http://localhost:4000/v1`、`api: "openai-completions"`。`deterministic`ティアの`backend`は`{"provider": "lm_studio", "model": "qwen/qwen3.8-27b"}`で`apiKeyEnv`が無い(キー不要のバックエンドとして明示的に許容されている — `types.ts`のコメント: "Absent for keyless backends (local LM Studio)")。
- `jig/src/domain/tiers/write-litellm.ts`: litellm向けの書き出しは今のフェーズでは dry-run 専用("the measurement plane is deliberately not auto-written")。jigはLiteLLMという特定の受け口を前提にコード生成している — 受け口を丸ごと別物(Olla等)に替えるなら、この生成器も書き換えが要る。**現行のLiteLLM選択は「まっさらな選択」ではなく「jigの生成パイプラインがすでに1つを狙って作られている」という既成事実込みの選択である**。

---

## 1. ベンダー

### 1.1 サーバー比較

| サーバー | tool calling | structured output | headless/daemon | 認証 |
|---|---|---|---|---|
| **LM Studio** | ✅公式 | ✅公式 | ✅ `lms daemon up`(llmster) | 0.4.0+のみ、headlessではCLIからトグル不可(前回記録`lms#489`) |
| **Ollama** | ✅公式 | ✅公式(2024-12-06〜) | 通常のOS常駐 | なし(前回記録のCVE群) |
| **llama.cpp `llama-server`** | ✅公式 | ✅公式(grammar制約) | Docker/環境変数向け設定あり | `--api-key`が常設で使える唯一のサーバー(前回記録で確認済み) |
| **mlx-lm server** | ドキュメントに記載なし | ドキュメントに記載なし | CLI起動のみ、daemon化の記述なし | なし、"not recommended for production" |
| **Exo** | README上OpenAI Chat Completions/Claude Messages/Responses/Ollama API互換を謳う | 明記なし | — | 明記なし |
| **vLLM** | (該当なし) | (該当なし) | Apple Silicon/macOS対応の一次情報は今回到達できず[gap] | — |

- **LM Studio tool use** [verbatim, https://lmstudio.ai/docs/developer/openai-compat/tools]: "Tool use enables LLMs to request calls to external functions and APIs through the `/v1/chat/completions` and `v1/responses` endpoints." ネイティブ対応は "Qwen2.5, Llama-3.1/3.2, and Mistral models"、それ以外は "a custom system prompt and a default tool call format" にフォールバック。"Smaller models and models that were not trained for tool use may output improperly formatted tool calls, resulting in LM Studio being unable to parse them into the `tool_calls` field." という限界も明記。
- **LM Studio structured output** [verbatim, https://lmstudio.ai/docs/developer/openai-compat/structured-output]: "You can enforce a particular response format from an LLM by providing a JSON schema to the `/v1/chat/completions` endpoint." 実装は"For `GGUF` models: utilize `llama.cpp`'s grammar-based sampling APIs" / MLXモデルはOutlinesライブラリ。"Not all models are capable of structured output, particularly LLMs below 7B parameters." という下限の明記あり(この持ち主のQwen3.8-27Bは十分上)。
- **LM Studio headless/daemon** [verbatim, https://lmstudio.ai/docs/app/api/headless]: "llmster is the core of the LM Studio desktop app, packaged to be server-native, without reliance on the GUI." `lms daemon up`で起動可能。ただし同ページは並行リクエスト処理(`--parallel`相当の記述)には一切触れていない[gap] — この持ち主のローカル実測(`lms ps` → parallel 4、前回記録0節)が唯一の並行数の根拠。
- **Ollama structured outputs** [verbatim, https://ollama.com/blog/structured-outputs](2024-12-06付): "Ollama now supports structured outputs making it possible to constrain a model's output to a specific format defined by a JSON schema." tool callingはこの投稿では触れられておらず、別ページ[verbatim, https://docs.ollama.com/capabilities/tool-calling]で "only recommended for models which only return a single tool call" という単発呼び出し限定の注意書きあり(並行tool callingにも対応するとは書くが、この注意は残る)。
- **Ollama並行数** [verbatim, https://docs.ollama.com/faq]: "The maximum number of parallel requests each model will process at the same time, default **1**." — **Ollamaは既定で1リクエストずつしか処理しない**。U2(別マシンのjigハーネス)とU1(自宅利用者)が同時に叩く構成では、既定のままだと後着が直列で待たされる。`OLLAMA_NUM_PARALLEL`で上げられるが、LM Studioの実測parallel=4はこの点で既定のまま優位。
- **llama-server** [verbatim, https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md]: "`-np, --parallel N` number of server slots (default: -1, -1 = auto)"、"Function calling / tool use for ~any model"、"Schema-constrained JSON response format"。3者の中で認証・tool calling・structured output・並行スロットの4点を単体でネイティブに備える唯一のサーバー。ただしGUIも既ダウンロード資産(この持ち主のQwen3.6/3.8のMLX量子化)も無いため、乗り換えは新規のGGUF調達コストを伴う。
- **mlx-lm server** [verbatim, https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md]: "The MLX LM server is not recommended for production as it only implements basic security checks." tool calling/structured outputについての記述は無し[gap]。KV量子化時は"processes requests one at a time"と明記(非量子化時の並行挙動は不明[gap])。
- **Exo** [verbatim, https://github.com/exo-explore/exo]: "Run frontier AI locally"、"connects all your devices into an AI cluster"。MLXバックエンド、"RDMA over Thunderbolt 5"(macOS 26.2+)、"Compatible with OpenAI Chat Completions API, Claude Messages API, OpenAI Responses API, and Ollama API"。47.6k★、2,354コミット、issue 205件オープンで活発。ただし**複数デバイスに分散させる**ためのツールであり、この持ち主の要件(単一Mac上で完結、他マシンからは受け口経由でアクセス)とは設計動機が異なる — 「1台のMacの中でもっと速くしたい」ではなく「1台に収まらない大モデルを複数台に割る」ためのツール。

### 1.2 受付層(gateway)比較

| 受付層 | ★数(2026-09-23時点) | 最終push | archived | ポジショニング | 数値 |
|---|---|---|---|---|---|
| **LiteLLM** (`BerriAI/litellm`) | 59,426 | 2026-09-23(当日) | false | 100+クラウドプロバイダの統合が主眼、仮想キー/予算/DB永続化はオプション機能 | GitHub Security Advisories **14件**(後述)。公式ベンチマークはmedian 2ms/p99 13ms(4インスタンス、132ワーカー・528GiB規模の**エンタープライズ集約構成**、単体Mac常駐の実測ではない) [verbatim, https://docs.litellm.ai/docs/benchmarks] |
| **Bifrost** (`maximhq/bifrost`) | 8,247 | 2026-09-22 | false | "the fastest way to build AI applications that never go down"、23+プロバイダ | 自社測定で "Less than 15 µs additional latency per request"(t3.xlarge)、5,000 RPSで "100% request success rate" [verbatim, https://github.com/maximhq/bifrost] — LiteLLMとの直接比較は自社ベンチマークのみで独立検証は見つからず[gap] |
| **Olla** (`thushan/olla`) | 304 | 2026-09-22 | false | ホームラボ/オンプレのOllama・LM Studio・llama.cppを束ねるロードバランサ。"LiteLLM is the recommended bridge when you need Olla to reach hosted cloud APIs" と両立を明言 | "very lightweight & efficient, runs on less than 50Mb RAM" [verbatim] |
| **smol-llm-proxy** (`robolamp/smol-llm-proxy`) | 2 | 不明 | false | 複数llama-serverインスタンス・複数ユーザー・ユーザー単位トークン集計に特化した最小実装 | "~1100 lines of code, ~53 MB RAM"。README自身の比較: "LiteLLM handles 100+ cloud providers with virtual keys and budgets—far broader scope requiring Postgres + Redis" [要旨、著者の言明] |
| **TensorZero** (`tensorzero/tensorzero`) | 11,721 | 2026-06-11 | **true(archived)** | "used by companies ranging from frontier AI startups to the Fortune 10"、DBとDocker前提のプロダクション向け | 理由不明のままarchived — 有力ゲートウェイでも消える例が実在する[gap: 理由] |
| **Portkey** (`portkey-ai/gateway`) | 13,065 | 2026-05-25 | false | エンタープライズAIゲートウェイ | 2026-09-23時点で最終pushから約4ヶ月 — LiteLLM/Bifrost/Ollaほどの最新性は無い |
| **Helicone** | — | — | — | "Helicone's AI Gateway is an OpenAI-compatible, unified API"、**クラウドホスト型**(`https://ai-gateway.helicone.ai`)で "maintains the keys for you" [verbatim, https://docs.helicone.ai/getting-started/quick-start] — ローカルLLMの動機(プライバシー)と逆行するため自宅ラボには不向き |

**LiteLLM のセキュリティ実績(前回記録で「本調査のスコープ外で未調査」だった空白を埋める)**:
GitHub Security Advisories APIから直接取得 [verbatim, `https://api.github.com/repos/BerriAI/litellm/security-advisories`]、**14件**。severity別: critical 4、high 3、medium 5、low 2。代表例:
- `GHSA-r75f-5x8p-qvmc`(CVE-2026-42208, **critical, CVSS v4 9.3**): "A database query used during proxy API key checks mixed the caller-supplied key value into the query text instead of passing it as a separate parameter." **無認証**でAuthorizationヘッダー経由のSQLi。影響範囲 1.81.16〜1.83.6、修正版1.83.7。
- `GHSA-jjhc-v7c2-5hh6`(CVE-2026-35030, **critical, CVSS v4 9.4**): "The OIDC userinfo cache uses `token[:20]` as the cache key." によるOIDC認証バイパス。影響 <1.83.0、修正1.83.0。"This configuration is not enabled by default"(OIDC/JWT認証を有効にした構成のみ影響 — この持ち主はmaster_key単体でOIDC未使用のため非該当)。
- `GHSA-4xpc-pv4p-pm3w`(CVE-2026-49468, **critical**): "Authentication Bypass via Host Header Injection"。
- `GHSA-3cv6-jpf6-8222`(CVE-2026-84377, medium, CVSS 5.3, 2026-08-26付, **今回見つかった中で最新**): "Any authenticated LiteLLM proxy user could redirect an outbound provider call to a destination they control and cause the proxy to send its own configured provider credentials to that destination." 影響 <1.94.0、修正 v1.96.2(1.88.x以降へバックポート済み)。悪用には "a valid virtual key" が要る(=master_keyを知らない外部者には無関係)。
- この持ち主の`litellm-up.sh`がpinするDockerダイジェストは "reports as **1.103.0**"(コメントより)— 上記いずれの修正版(最新でも1.96.2)よりも新しく、**現行の運用は開示済みCVEの影響範囲外**。ただし14件という件数自体、"single-user local proxy"という前提でmaster_key認証だけに頼るこの持ち主の設計が今後もこのペースで穴を踏み続ける可能性は残る、という定量的な事実として記録する。

---

## 2. 実践者

前回記録のSimon Willison(Ollama + Tailscale、認証機能には頼らずtailnetのメッシュだけで境界を作る)は再掲しない。今回新たに見つかった、U2/U3に踏み込んだ個人の実例:

- **ncaq**(実名のdotfilesリポジトリ、GitHub) [verbatim, https://github.com/ncaq/dotfiles home/core/opencode.nix]: OpenCode(コーディングハーネス)から自宅の別ホスト("bullet"、CUDA)のOllamaへ**Tailscale Service**(`tailscale serve`とは異なる、複数ホストが同一サービス名を名乗れる新しめの抽象化 — 本人のコメント "Tailscale ServiceのURLを使うことでbullet以外のクライアントからも同じ設定で使えます" 以外の一次ドキュメントには今回到達できず[gap])経由で接続。**本人の日本語コメントが直接的**: "他のホストのOllamaはコーディングに使える速度が出ない" — つまり**コーディング用途では推論速度がホスト選定の第一制約**であり、遅いノードは除外している。加えて重要な負の実例: OpenCodeの`model`設定は実際には`github-copilot/gpt-5.6-sol`(クラウドモデル)であり、**自宅Ollamaはproviderとして登録されているだけでメインの駆動には使われていない**。ローカルモデルを「メイン」に使うのではなく「選べる選択肢の一つ」に留める実例。
- **kuznero**(実名dotfiles) [verbatim, https://github.com/kuznero/dotfiles home/scripts/configure-ollama-tailscale]: Arch Linux上でOllama(127.0.0.1)→Caddy(127.0.0.1:18080、リバースプロキシのみ、TLS終端が目的)→`tailscale serve`という三層構成。スクリプトのコメント: "Ollama: http://127.0.0.1:11434 / Caddy: http://127.0.0.1:18080 -> http://127.0.0.1:11434 / Tailscale https://<current-host>.<tailnet>.ts.net -> Caddy -> Ollama"。**アプリ層の認証キーは追加せず、Tailscaleの身元だけが境界**。既定モデルは`qwen3-coder-next:latest`(この持ち主のjig tiersと近い系統のモデル)。
- **hendrikmi**(実名dotfiles) [verbatim, https://github.com/hendrikmi/dotfiles codex/ollama.config.toml]: Codex CLIの設定で、自宅サーバーを露出させる代わりに**Ollama公式のクラウド版**(`base_url = "https://ollama.com/v1"`、`model_provider = "ollama_cloud"`)を使う設定例。"Ollama Cloud. Use: codex -p ollama (needs OLLAMA_API_KEY)"。**自宅露出そのものを避け、ベンダー提供のホスト型サービスに切り替えるという第三の道**が実地に存在する。
- **KristopherKubicki**(`OperatorKubicki`名義のリポジトリ内、"norllama"という自作Pythonゲートウェイ) [verbatim, https://github.com/KristopherKubicki/norman scripts/render_mac_mini_llm_launchd.py]: Ollamaは`127.0.0.1:11434`のまま、自作の最小ゲートウェイ(`norllama_gateway.py`)が`0.0.0.0`にbindしてポート18151で外部に応答、Caddyでtailnet越しに終端。LiteLLMではなく**自作の最小プロキシ**を選んでいる実例。
- **"mac-mini-llm-lab" SKILL.md**(複数のAIエージェント向けskillカタログに転載、`sickn33/agentic-awesome-skills`, `BagelHole/DevOps-Security-Agent-Skills`等) [verbatim確認、https://raw.githubusercontent.com/sickn33/agentic-awesome-skills/main/skills/mac-mini-llm-lab/SKILL.md]: **注意 — これは"source_type: community"の集約ドキュメントで、個人の運用報告ではなくAI生成ベストプラクティス文書の可能性が高い([unverified]として扱う)**。それでも記載パターンとして: Ollama + MLX両方インストール、launchd常駐(`OLLAMA_NUM_PARALLEL=4`)、`pmset -a disablesleep 1`でスリープ防止(前回記録の`caffeinate`と並ぶ別の手段)、Caddyでリバースプロキシ+TLS終端、**Open WebUI(Docker、`WEBUI_AUTH=true`)**でモバイル/Web両対応、Prometheus/node_exporterで監視。単一文書に「サーバー+受付層+到達経路+Web UI」の全部が並んでいる点で、業界の"素朴な収束形"を示す資料としては使えるが、実運用者の一次報告としては採用しない。
- **練習実例の不在** [verbatim, gist https://gist.github.com/greenstevester/fc49b4e60a4fef9effc79066c1033ae5、2026-04付]: "TLDR Setup for Ollama and Gemma 4 26B on a Mac mini" は "Use it with coding agents" とコーディングエージェント連携に触れるが、**リモートアクセス・受付層・モバイルのいずれにも触れていない** — Mac1台で完結する構成に留まる。公開されているOllama+コーディングエージェントの実例の多くはこの粒度(単一マシン)で止まっており、U2/U3まで踏み込む例は少数派(ncaq/kuznero/norllamaのような自作勢に限られる)、というのが実地の分布として観察できる。

---

## 3. 測定

- **LiteLLM公式ベンチマーク** [verbatim, https://docs.litellm.ai/docs/benchmarks]: 4インスタンス構成で "LiteLLM Overhead Duration (ms)" median 2ms、95%ile 8ms、99%ile 13ms。同構成の "Current RPS 1170"。高スループットプロファイルでは "3.00K Requests/sec"。ただし "both deployments ran 132 total gateway workers and requested 528 GiB of memory" という**エンタープライズ集約規模**の数値であり、この持ち主のようなDocker 1コンテナ・単体Mac常駐構成のオーバーヘッドを直接示すものではない[gap: 単体インスタンスでの実測]。
- **Bifrostの自社数値** [verbatim, https://github.com/maximhq/bifrost]: t3.xlargeで"Less than 15 µs"、5,000 RPSで"11 µs"、"100% request success rate"。LiteLLMとの直接対戦ベンチマークはBifrost側の主張のみで独立検証は見つからず[gap]。
- **Ollama並行数の既定** [verbatim, https://docs.ollama.com/faq]: "default **1**"。この持ち主が採用していないが、比較対象として重要な数値。
- **llama.cppのApple Silicon実測**(コミュニティ維持の長期スレッド) [verbatim, https://github.com/ggml-org/llama.cpp/discussions/4167]: M1 Max(64GB) F16生成 23.03 t/s、M2 Max(96GB) F16生成 24.54 t/s、M2 Ultra F16生成 41.02 t/s / Q4_0生成 94.27 t/s。2023-11〜2026-03(M5+対応更新は2026-08-25)まで継続更新。**GGUF側の数値はあるが、同一条件でのMLX側との対比は無い**[no numbers, gap]。
- **MLX vs LM Studio内部比較(GGUF Metal backend vs MLX backend)、HN個人コメント**(2026-05-18付) [verbatim, HN item, comment text via Algolia API]: "Configuration: Gemma 4 31B Instruct Q6K / Context size 40960 / LM Studio 0.4.13+1 / Metal llama.cpp v2.14.0 / LM Studio MLX (Apple M5) v1.6.0" とした上で "prompt eval time = 32545.36 ms / 5625 tokens (5.79 ms per token, 172.84 tokens per second)" "eval time = 20227.99 ms / 310 tokens (65.25 ms per token, 15.33 tokens per second)"。同一投稿者はさらに "Gemma 4 26B A4B (Q6K)" (MoE)では "much much faster (~1,200 tokens/second)" と併記。**これは個人のアドホックな1回実験であり、どちら(Metal/MLX)の数値かの帰属がコメント文面だけでは曖昧**[unverified: バックエンド帰属]。それでも「dense 31Bで生成15 t/s前後、MoEで1200 t/s級」という桁のオーダーは、この持ち主のQwen3.8-27B(dense)運用の期待値のアタリを付ける材料にはなる。
- **GitHub上の維持状況(★・push日・archived)**: 上記1.2のサマリー表に集約。LiteLLM 59,426★/当日push、Bifrost 8,247★/前日push、Olla 304★/前日push、TensorZero 11,721★/**archived**(2026-06-11最終push)、Portkey 13,065★/2026-05-25最終push(約4ヶ月停滞)。

---

## 4. 実地(in the wild — `gh search`相当、認証curlで代替、9クエリ超実行)

- **codexのollama向け設定ファイル** [gh code search "codex base_url ollama"相当、total 141件]: `hendrikmi/dotfiles`, `mattsaccount364/FractalShark`, `Karen86Tonoyan/codex-ollama-assist`, `bbarker/local_ai`, `chase-irql/ai-workstation`など**多数の個人が`.codex/`配下にollama向け設定を持つ** — Codex CLI + ローカル/自宅Ollamaの組み合わせ自体は一定数存在することを裏付ける定量値(141件、うち上位はほぼ個人dotfiles)。
- **opencode + リモートローカルモデル** [total 110件]: `ncaq/dotfiles`, `kuznero/dotfiles`, `gridctl/gridctl pkg/modelsync/render_opencode.go`, `spigwitmer/mobile-approve docs/tailscale.md`など。`gridctl`はGo製の設定レンダラでOpenCode向けにモデル同期を扱うツール(個別に深掘りはしていない[gap])。
- **LiteLLM + LM Studio + tailnet IPの組み合わせ**: 前回記録と同じく**今回も0件**(gh search codeで再確認)。この特定の組み合わせは公開コード上に前例が無いという所見は変わらず。
- **TensorZeroのarchived化**: GitHub REST APIで直接確認、`archived: true`、`pushed_at: 2026-06-11T01:48:44Z`。11.7k★・エンタープライズ導入実績を自称するゲートウェイでも1年未満で消える例が実在する — 受付層選定は「大きいから安全」ではないことを示す定量的事実。
- **Ollamaに対する信頼低下の言及**(HN comment, 2026-07-20付) [verbatim]: "I dumped ollama yesterday after reading a similar thread. I definitely don't condone what ollama has done but yes, definitely their UX is far better - as an end user." — 具体的にOllamaが何をしたかは本調査では深掘りしていない[unverified]が、UXの良さとガバナンスへの不信が併存する、という定性的な負の言及として記録する。
- **単一マシン止まりの実例が多数派**: `greenstevester`のgist(上記2節)のように、Ollama+コーディングエージェントの公開実例の多くはリモート/モバイルに踏み込まず、U1相当で止まっている。U2/U3まで作り込む例(ncaq, kuznero, norllama)は同じ`gh search`のヒット数(141件・110件)の中でも少数派で、しかも**アプリ層ゲートウェイキーを重ねる例は皆無** — 全員がTailscaleの身元(WireGuard ACL)そのものを境界にしている。

---

## サマリー表

| 観点 | 選択肢 | task/用途 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|---|
| サーバー: 認証 | llama-server | 自宅サーバー全般 | `--api-key`常設 | ダウンロード済みMLX資産と非互換(GGUF調達が要る) |
| サーバー: headless | LM Studio | U1 | `lms daemon up`(llmster) | headlessでは認証トグルをCLIから有効化できない(前回記録`lms#489`, open) |
| サーバー: 並行数既定 | Ollama | U2(複数クライアント) | `OLLAMA_NUM_PARALLEL`既定**1** | 明示的に上げないと後着直列化 |
| サーバー: 並行数実測 | LM Studio | U1/U2 | `lms ps`実測 parallel **4** | ドキュメント上の裏付けはなし(headlessページはconcurrency非記載) |
| 受付層: セキュリティ実績 | LiteLLM | U2 | GitHub Security Advisories **14件**(critical 4件、うち1件は無認証SQLi CVSS 9.3) | 全件1.96.2以前で修正済み、この持ち主のpin(1.103.0系)は影響範囲外 |
| 受付層: 軽量代替 | Olla | U2(検討対象) | 304★、**<50MB RAM**、前日push | 単体では2026-09-23時点でLiteLLMをクラウド接続用に併用推奨(置き換え専用ではない) |
| 受付層: 軽量自作 | smol-llm-proxy | U2(参考) | 2★、~53MB RAM、~1100行 | 採用実績は事実上ゼロ(★2) |
| 受付層: 大手の消滅例 | TensorZero | (負の証拠) | 11.7k★、**archived 2026-06-11** | 理由不明[gap] |
| U2実地パターン | ncaq/kuznero/norllama | U2 | gh search: opencode+remote 110件, codex+ollama 141件 | **全員がTailscale身元のみを境界にし、アプリ層キーを重ねる例は皆無**。LiteLLM+LM Studio+tailnetの組み合わせは今回も0件 |
| U2の代替: ベンダーCloud | Ollama Cloud | U2(第三の道) | hendrikmi実例 | 自宅露出を避けられるがローカル実行の動機(プライバシー/無料)と一部矛盾 |
| U3 | Open WebUI | U3 | PWA、iPhone "Share → Add to Home Screen" | Ollama公式モバイルアプリは確認できず[gap]。LM Studio自身はデスクトップのみ |
| 測定: GGUF throughput | llama.cpp community table | 参考 | M2 Ultra F16生成 41.02 t/s / Q4_0 94.27 t/s | MLXとの直接対比数値は無し[no numbers] |
| 測定: LM Studio実測1件 | HNコメント(2026-05-18) | 参考 | Gemma4 31B Q6K 生成15.33 t/s、MoE 26B ~1,200 t/s | 個人のアドホック実験、バックエンド帰属が曖昧[unverified] |

---

## 結論(平易な言葉で)

**U1(自分のMac上で使う)**: 今のLM Studioのままでよい。乗り換える証拠がない。ヘッドレスdaemon(`lms daemon up`)、tool calling、structured outputのいずれも公式ドキュメントで裏付けが取れ、すでにモデルもダウンロード済みで、`lms ps`実測で並行数4が確認できている。llama-serverの方が認証機能は素で強いが、それは「もし外部公開するなら」の話であり、U1単体(ローカルのみ)では意味を持たない差分。

**U2(別マシンのjigハーネスが自宅Macのモデルを使う)**: 前回記録の結論(LiteLLM proxyだけをtailnet越しに公開し、LM Studio自体はloopbackに留める)を維持してよいが、根拠の中身は今回で変わった。プラス材料: LiteLLMの現行pin(1.103.0系)は開示済みCVE14件のいずれの影響範囲より新しく、実害は無い。マイナス材料: (1) LiteLLM自体に無認証で突けるcritical脆弱性(SQLi CVSS 9.3)が過去に実在した事実は消えない — パッチ済みだからと言って「この種のコードにはこの種のバグが起きる」という傾向自体は消せない。(2) 実地で見つかった別マシン到達の実例(ncaq, kuznero, norllama)は全員、Tailscaleの身元(WireGuard ACL)だけを境界にし、その上にLiteLLMのようなアプリ層キーを**重ねていない**。前回記録が推した「ネットワーク層(Tailscale ID)とアプリ層(LiteLLM bearer key)の二重認証」という設計は、今回もなお公開実地に前例が無い自作である。(3) この持ち主のjigはすでにLiteLLM向けの生成器(`write-litellm.ts`)を持っており、乗り換えはOlla/自作ミニゲートウェイへの書き換えコストを伴う — 「軽い代替がある」ことは事実だが「乗り換えるべき」ことの証拠ではない。**総合すると、現行方針は妥当だが「唯一の正解」ではなく、実地の主流(Tailscale身元のみで足りるとする設計)より一段重い、意図的な選択として自覚しておくべき**。加えてOllamaの並行数既定1(LM Studioは実測4)は、U2(別マシン)とU1(自宅の自分)が同時に叩く場面で地味に効いてくる数値であり、LM Studioを維持する追加の理由になる。

**U3(スマホから)**: Open WebUI(PWA)を自宅Mac上にDocker常駐させ、Tailscale越しに開くのが実務上の収束形。Ollama公式のモバイルアプリは存在が確認できず、LM Studio自身のUIもデスクトップ限定なので、Web UIを挟む以外の実務的な選択肢は見つからなかった。ただしこの持ち主のLiteLLM(bearer key形式)をOpen WebUIのバックエンドに直結した公開実装例は見つかっておらず、その配線は前回記録の(c)案同様、自作の領域になる。

**結合アーキテクチャの一番強い新知見**: 3ユースケースを同時に満たそうとした自宅ラボの実地は「ローカル推論(loopback)+ Tailscale(身元認証)+ 任意でCaddy(TLS終端のみ、認証なし)+ Open WebUI(PWA)」という形にほぼ収束しており、**「LiteLLMのような重い受付層をTailscaleの上にさらに重ねる」設計は実地にほぼ前例がない**。これは「間違っている」ことの証拠ではなく「誰もまだやっていない」ことの証拠であり、この持ち主が選ぶなら自覚的な先行例のない選択として選ぶ必要がある。

---

## 前例なし・未検証(明示リスト)

- LiteLLM + LM Studio + tailnet を組み合わせて運用している公開リポジトリ — gh search codeで前回・今回とも0件
- MLX vs GGUFの直接ヘッドトゥヘッド throughput 数値比較 — ベンダー側(mlx-lm README/SERVER.md、llama.cpp README)はどちらも数値を出さず、HN上の1個人の非対称条件の実験(バックエンド帰属も曖昧)のみ
- Tailscale Services(ncaqが使うマルチホスト抽象化)の公式ドキュメント — `https://tailscale.com/kb/1543/services`等複数URLを試したが404/308連発、`https://tailscale.com/kb`索引ページにもリンクなし
- mlx-lm serverのデフォルト(非KV量子化時)の並行リクエスト処理挙動 — SERVER.mdに記載なし
- TensorZeroがarchivedになった理由 — GitHub APIは`archived: true`と日付のみ返す、買収/終了/方針転換のいずれかは不明
- Open WebUIをLiteLLM(この持ち主と同型のbearer key構成)に繋いだ公開実装例 — 未確認
- 「dumped ollama」というHNコメントが指す具体的な信頼性事案の中身 — 深掘りしていない
- vLLMのApple Silicon/macOS対応状況の一次情報 — 到達できず
- LiteLLM proxy単体(1コンテナ、単体Mac常駐)でのレイテンシ/メモリ実測 — 公式ベンチマークはエンタープライズ集約規模のみでこの持ち主の運用形態と規模が違う
