---
question: "自宅の1台にあるローカルLLMサーバー(LM Studio/Ollama/llama.cpp)を、他のマシンやスマホから安全に使えるようにする2026年の作り方はどれで、この持ち主にはどの形が合うか"
date: 2026-09-23
verdict: "LM StudioをLANに直接bindする形(a)は0.3.x系がサーバー認証を一切持たず、インストール済み0.4.24でもヘッドレスでは認証トグルをCLIから有効化できない未解決バグがあり、かつmacOSのApplication FirewallはLAN/WANを区別しないため推奨しない。この持ち主には(c) LiteLLM proxyだけをtailnet越しに公開しLM Studioはloopbackのまま・鍵はop管理、が最も筋が良い — 既にop管理のmaster_keyとPrometheus計測を持つ境界を1箇所拡張するだけで済み、ネットワーク層(Tailscale ID)とアプリ層(LiteLLM bearer key)の二重認証になる。単独導入コストを最小にしたいなら(b) LM StudioをloopbackのままTailscale Serveで公開が次点。(d) Cloudflare Tunnel+Accessは動くが独自ドメイン管理とサードパーティ経路が増え、ローカルLLMを選んだ動機(プライベート性)と噛み合わない。sleep/caffeinate問題はどの形でも共通に残る。"
unverified:
  - "Ollama公式の「サーバーをインターネットに公開するな」という明示的なセキュリティ告知ページ(FAQ/APIドキュメント/ブログ索引を検索したが見つからず)"
  - "Cisco Talos/Censys/Shodanによる過去(2024年)の『数千台のOllama/LM Studioサーバーが公開されている』という一次調査レポート(検索エンジンが軒並みブロックされ到達できず。代わりに2026-09-23時点のShodanスナップショットのみ確認、後述)"
  - "tailnet経由 vs 生LANでのレイテンシ比較の実測値(Tailscaleの throughput ドキュメントに tailscale ping の個別例(3ms〜282ms)はあるが、LAN対比のベンチマーク表は見つからず)"
  - "LiteLLM proxyがbind先インターフェース(--host)を明示的に文書化しているページ(deploy/configsの2ページを確認したがプロセス側のbindアドレス制御についての記述は見当たらず、Docker側のポートマッピングで代替確認)"
  - "LiteLLM proxy自体のCVE/セキュリティ実績(このリサーチのスコープ外で未調査)"
  - "MLXサーバー(mlx-lm)のhost/認証オプションの詳細(SERVER.mdに記載なし、\"not recommended for production\"とだけ明記)"
  - "LiteLLM+LM Studio+tailnet IPを組み合わせた公開リポジトリの実例(gh search code で探索したが1件も見つからず — 不在そのものを所見として記録)"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 自宅ローカルLLMサーバーを他マシン/スマホから安全に使う2026年の作り方

**問い**: LM Studio(または Ollama / llama.cpp)を自宅の1台(この持ち主の場合 Mac)で動かし、他の自分のマシンやスマホから安全に使えるようにする2026年の実務はどう分布しているか。この持ち主の現状の構成(op = 単一鍵源、LiteLLM proxy = 計測付きHTTP境界という既存方針)に対して、どの形が最も筋が良いか。

調査日: 2026-09-23。WebSearchは利用不可(セッション予算切れ、実測済み)。WebFetch・curl・認証済み`gh`・NVD/HN Algolia APIで代替。ベンダー / 実践者+測定 / 実地(in the wild) の3レーンを並列サブエージェントで走らせ、本記録はその統合。各レーンは自分でWebFetch/curl/ghを直接叩いており、以下の引用のうち「[verbatim]」はレーン自身が直接fetchで確認したもの、「[gap]」はレーンが複数のURLを試したが到達できなかったもの。

## 方法と検証凡例

- ローカル事実は本セッションが `lms`/`docker`/`lsof`/`defaults`/設定ファイルを直接読んで確認(read-only、鍵は非表示)。
- ベンダーlens・実践者/測定lens・in-the-wild(gh search)lensの3体を並列サブエージェントとして起動し、それぞれ独立にWebFetch/curl/ghを実行させた。統合時に数値・引用を書き換えず、各レーンの報告をそのまま採用。
- WebSearchは3レーンとも試みて使用不能を確認済み(検索エンジンは軒並み403/JSチャレンジでブロック)。代替として直接URL・GitHub API・HN Algolia API・NVD APIを使用。

---

## 0. ローカル事実(read-only確認)

- **LM Studio**: バージョン **0.4.24+1**(`mdls`/`Info.plist`で確認)。CLI `lms`は `~/.lmstudio/bin/lms` にあり(PATHには入っていない)。`lms server status` → "The server is running on port 1234."。`lms ps` → `qwen/qwen3.8-27b` が loaded, 16.08GB, context 208384, parallel 4, IDLE。
- **待受アドレス(実測)**: `~/.lmstudio/.internal/http-server-config.json` に `"networkInterface": "127.0.0.1"`, `"cors": false`, `"autoStartOnLaunch": false`, `"port": 1234`。`lsof -iTCP:1234 -sTCP:LISTEN` も `127.0.0.1:1234` のみを確認 — LANやtailnetには一切出ていない。
- **ダウンロード済みモデル**(名前・サイズのみ): `Qwen3.6-35B-A3B-MLX-8bit`(35G)、`Qwen3.8-27B-MLX-4bit`(15G)、`Qwen3.8-27B-MLX-8bit`(28G)、`Ternary-Bonsai-27B-mlx-2bit`(7.9G)。記憶ノート([[local-llm-64gb-research]])の「Qwen3.6-35B-A3B級」に加え、8bit/4bitのQwen3.8-27Bも実在。
- **LiteLLM proxy** (`domains/dev/config/litellm/config.yaml`): `model_list` に `deterministic` = `lm_studio/qwen/qwen3.8-27b` があり、LM StudioがLiteLLM経由の実バックエンドであることを確認。`master_key: os.environ/LITELLM_MASTER_KEY` は config.yaml 自身のコメントで「2026-09-20以降は実秘密(op経由)」と明記 — 以前の記憶ノート([[litellm-proxy-live-stack]])にある「秘密にせず sk-local-proxy」という記述はこの時点で上書き済み。
- **launchdプリスト**: `~/Library/LaunchAgents/com.esh2n.litellm-proxy.plist`(`grep -rl litellm`で発見)。`RunAtLoad`+`KeepAlive`+`ThrottleInterval 120`。起動スクリプト `~/.config/litellm/litellm-up.sh` を読むと、Dockerコンテナは `-p 127.0.0.1:4000:4000` で起動——**LiteLLM proxyも現状はloopback限定**。`docker inspect litellm-proxy` の `NetworkSettings.Ports` も `{"4000/tcp":[{"HostIp":"127.0.0.1","HostPort":"4000"}]}` で一致。LM StudioへはDocker内から `http://host.docker.internal:1234/v1` で到達(コンテナ視点でのlocalhost越え)。
- **Tailscale**: `which tailscale` → 見つからず。**未導入**。
- **macOSファイアウォール**: `socketfilterfw --getglobalstate` → "Firewall is disabled. (State = 0)"。ただし現状どちらのサービスも0.0.0.0にbindしていないため、ファイアウォール状態は今は実害を生んでいない。

**結論**: 現状のスタックは全レイヤーがloopback限定(127.0.0.1)で、他マシン/スマホからは一切到達不能。今回の問いは「これをどう安全に拡張するか」という設計問題であり、既存の露出事故を塞ぐ話ではない。

---

## 1. ベンダー

### LM Studio
- `lms server start` の `--bind` フラグ [verbatim, https://lmstudio.ai/docs/cli/serve/server-start]: "Network address to bind the server to. Use "0.0.0.0" to listen on all IPv4 interfaces, or "127.0.0.1" (default) for localhost only." bind先を広げる場合は認証を有効にすることをドキュメント自身が推奨。
- `--cors` はデフォルト無効、有効化はセキュリティリスクと明記。
- **サーバー認証**: https://lmstudio.ai/docs/developer/core/authentication [verbatim] — "LM Studio supports API Tokens for authentication... **Requires LM Studio 0.4.0 or newer.**" つまり **0.3.x系にはサーバー認証機能が一切存在しない**。0.4.0のリリースは2026年1月28日ごろで、この持ち主の0.4.24は認証機能自体は持つバージョン。
- ただし **ヘッドレスでは認証を有効化できない未解決バグ**: `lmstudio-ai/lms#489`(open)[verbatim] — "There is no way to enable the 'Require Authentication' server setting via the CLI... when running LM Studio headless... the API server is exposed without any authentication, unless the user has previously toggled the setting in the GUI." さらに `lmstudio-ai/lmstudio-bug-tracker#2292`(open)は「トークンを作成しても認証強制とは別動作で、トークンがあっても未認証リクエストを受け続けることがある」と指摘 — GUIでトグルを1回押しておく必要があり、CLIだけの運用(headless Linux/リモートMacなど)では詰む。

### Ollama
- `OLLAMA_HOST`環境変数でbindアドレスを変更(既定は127.0.0.1:11434)、`OLLAMA_ORIGINS`でCORS制御 [verbatim, raw.githubusercontent.com/ollama/ollama/main/docs/faq.mdx]。
- API文書(`docs/api.md`)全体を確認したが **認証ヘッダー・APIキー・トークンの類は一切記述なし**。
- 公式の「インターネットに公開するな」という明示セキュリティ告知ページは見つからず [gap]。

### llama.cpp server
- `--api-key` / `--api-key-file` フラグが存在し、常時利用可能な CLI ネイティブAPIキー機構を持つ [verbatim, https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md] — LM Studio/Ollamaと違い、**この3者の中で唯一「常に使える」組み込み認証を持つ**。

### MLX server (mlx-lm)
- https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md [verbatim]: "The MLX LM server is not recommended for production as it only implements basic security checks." 認証オプションなし。

### Tailscale
- `tailscale serve`: tailnet内のデバイスから自機のローカルサービスへHTTPS経由でルーティング、HTTPS証明書の有効化が前提 [verbatim, https://tailscale.com/kb/1312/serve]。ユーザー識別ヘッダー(`Tailscale-User-Login`等)が自動付与される。
- `tailscale funnel`: 公開インターネットへの露出。servew/funnelは同一ポートで併用不可、直近に設定したコマンドが勝つ [verbatim, https://tailscale.com/kb/1223/funnel]。
- **無料Personalプランの制限**: https://tailscale.com/pricing [verbatim] — "$0 Free forever"、"Unlimited user devices"、だが **"Funnel Availability: Not available on the Personal plan."** つまり`serve`(tailnet内限定)は無料で使えるが、`funnel`(公開)は有償プラン必須。この持ち主の用途(自分の他マシン/スマホから)は`serve`だけで足り、無料プランで完結する。

### Cloudflare Tunnel + Access
- `cloudflared`はアウトバウンドのみの接続を作り、受信側ファイアウォールは「Cloudflare以外全遮断」にできる [verbatim, developers.cloudflare.com/cloudflare-one/connections/connect-networks/]。
- Cloudflare Accessはメール/IdP/デバイス姿勢などのポリシーでdeny-by-defaultのゼロトラスト認証をトンネルの前段に敷く [verbatim, developers.cloudflare.com/cloudflare-one/policies/access/]。

### LiteLLM proxy
- 仮想キー/`master_key`: https://docs.litellm.ai/docs/proxy/virtual_keys [verbatim] — "Set a `master_key`, this is your Proxy Admin key"。クライアント認証はBearerトークン(`Authorization: Bearer <key>`)。この持ち主の構成はまさにこの`master_key`パターンを既に使用中(op管理・2026-09-20以降は実秘密化)。
- bindアドレス(--host)についての明示ドキュメントは`deploy`/`configs`の2ページでは見つからず [gap] — 実際の露出制御はDocker側のポートマッピング(`-p 127.0.0.1:4000:4000`)で行っているのが、この持ち主の現構成でもあり、業界的にも自然な代替手段と見られる。

---

## 2. 実践者

- **Simon Willison**([[verify-dont-parrot]]の対象として本人サイトを直接確認): "Using Codex CLI with gpt-oss:120b on an NVIDIA DGX Spark via Tailscale" (2025-11-07, https://til.simonwillison.net/llms/codex-spark-gpt-oss) [verbatim] — "the default settings bind it to localhost only. I wanted to access it from other machines, so I did the following" → systemdユニットで`OLLAMA_HOST=0.0.0.0:11434`、Mac側からは`OLLAMA_HOST=<tailscale IP>:11434 ollama ls`で疎通確認。**Ollama自体の認証機能には頼らず、Tailscaleのメッシュ/ACLだけをアクセス境界にしている** — これは今回のベンダーlensで確認した「Ollamaに認証機能が無い」という事実と整合。
- 同じくWillison、"NVIDIA DGX Spark" (2025-10-14) — Tailscaleでサインイン後、スマホからは **Open WebUI**(モバイル対応Web UI)や **Termius**(iOS SSHクライアント)経由でアクセス。
- "Gemma 3 QAT Models" (2025-04-19) [verbatim] — "putting it through its paces via Open WebUI and Tailscale to access my laptop from my phone" — スマホ利用の実例。
- 小規模実践: `TeamDzX/myllm-connect`(HN Show, 2026-06-16) — iOSアプリ「MyLLM」+ macOS/Windowsコンパニオンが QRペアリングでTailscale越しにOllamaへ接続。README[verbatim]: "privately, over your own Tailscale mesh, with a valid certificate. No port-forwarding, no self-signed-cert warnings." — ポート開放や自己署名証明書の警告を避けたいという動機がTailscale採用の理由として明記されている数少ない一次資料。
- Willison以外の個人ブログでのこの組み合わせの深掘り記事は複数の検索経路を試したが見つからなかった [gap]。

---

## 3. 測定

- **CVE(NVD APIで直接確認)**: LM Studioは **NVDに0件**。Ollamaは関連含め38件、うち露出に直結するもの:
  - `CVE-2024-28224`(CVSS 6.6 MEDIUM): "DNS rebinding vulnerability that can inadvertently allow remote access to the full API" — **「127.0.0.1にbindしているから安全」という前提そのものを崩す脆弱性**。ブラウザ経由のDNSリバインディングでloopbackバインドを迂回されうる。
  - `CVE-2024-37032`「Probllama」(CVSS 8.8 HIGH): パストラバーサル経由のRCE。
  - `CVE-2025-63389`(CVSS **9.8 CRITICAL**, 2025-12-18): "The platform exposes multiple API endpoints without requiring authentication, enabling remote attackers to perform unauthorized model management operations." — **Ollamaの「認証機能がない」という設計そのものが独立したCVEとして記録されている**(v0.12.3以前)。
  - `CVE-2026-5757`(CVSS 7.5, 2026-06-26): 量子化エンジン経由の未認証ヒープメモリ読み取り。
  - `ollama/ollama` の GitHub Security Advisoriesは0件 — NVDが一次チャンネル。
- **露出台数**: Cisco Talos/Censys由来の過去レポート(2024年の「数千台露出」)には到達できなかった [gap]。代替として2026-09-23時点のShodanスナップショット(curl直接確認)を取得: キーワード`ollama`で**1,243件**、上位国は米国241・インド84・日本83。ただしトップポートは9306/5984/8500等でOllama既定の11434ではなく、**文字列一致による誤検出が多い**ことが判明(ポート絞り込みクエリはレート制限でブロックされ確認不能)。これは「今日この瞬間の粗い桁数」であり、過去の権威あるインシデント数値としては扱えない。
- **tailnet vs LAN レイテンシ**: Tailscale公式ドキュメント(https://tailscale.com/kb/1257/tailscale-throughput)は定性的な記述のみ("direct connections usually provide the lowest latency")、`tailscale ping`の個別例が3ms〜282msの幅で載っているだけで、LAN対比のベンチマーク表は存在しない [gap, no numbers]。

---

## 4. 実地(in the wild — gh search、9クエリ実行)

- **Ollama + `tailscale serve`**: 強い収束が見られる。`agent-squid/squid`(18★, 2026-09-16 push)は `tailscale serve --bg --https=11434 127.0.0.1:11434` を明記し、`--http`だとHostヘッダー不一致でTailscale自身の404になる罠を解説(`--tcp`が必要)。`rahulmranga/knowledge-worker`(14★)は「tailnet ACLのみ、アプリ層の秘密なし」という認証モデルを明言。
- **LM Studio + Tailscale**: 存在はするが、**単独の「LM Studio + Tailscale」テンプレリポジトリは0件**(Ollamaは7件見つかった対比)。すべて個人の大きめのdotfiles/インフラリポジトリに埋め込まれた形。`cjus/solrac`(5★)は`getUserMedia`(マイク入力)がHTTPS必須であることを理由にTailscale Serveを推奨——具体的な技術的理由がある稀な例。`yutakobayashidev/rensheng`(2026-09-22 push、今日)は逆に**`tailscale serve`を使わず、LM Studioを生のtailnet IPへ直接bindする設計を明言**("独自backend、reverse proxy、Tailscale Serve、server crateは置かない") — serve層を挟まない選択肢も実在する。
- **LiteLLM + LM Studio + tailnet IP の組み合わせ**: 検索したが**1件も見つからず**。LiteLLM+LM Studioの公開例はほぼ全てBerriAI公式docsの丸写し(モデル名一般形のみ)。この特定の三点セット(LiteLLM・LM Studio・明示的なtailnet IP)は公開コード上に前例が無いというのがそれ自体の所見。
- **`OLLAMA_HOST=0.0.0.0`**: 15以上の無関係なリポジトリで見られる、ほぼデフォルトの第一歩。複数のリポジトリが「これ単体は公衆Wi-Fi上で危険」と明記した上でTailscale等を重ねている。
- **negative evidence(Tailscale側の既知の制限)**: `tailscale/tailscale#18916`(open, 2026-09-22更新)は`tailscale serve`のHTTPS終端で **約220ms×2のTLSハンドシェイク遅延**がgVisor netstackのNagle+遅延ACKにより発生すると報告 — servewパスの具体的なレイテンシコスト。`#11849`は"Funnel works only within tailnet"という設定ミスを示す既知issue。
- **sleep/caffeinate問題**: `ollama/ollama#4072`(open, 2026-06-03)「Ollamaはスリープを防ぐべき」というfeature requestが未解決のまま存在——**アプリ自身はスリープを防がない**。複数リポジトリ(`snedea/ccr-lm-studio-setup`など)がLM Studioの`lms get`ダウンロードがApp Nap下でWebSocket切断することを報告し`caffeinate -s`を推奨。この問題は**選ぶ公開方式(a〜d)に関係なく、Macがホストである限り共通に残る**。

---

## サマリー表

| 観点 | ソース種別 | 結果 | 数値 | 既知の失敗モード |
|---|---|---|---|---|
| LM Studio server認証 | ベンダーdocs | 0.3.x系は認証機能なし、0.4.0+でGUIのみトグル可能 | — | headlessではCLIから有効化不能(lms#489, open) |
| Ollama server認証 | ベンダーdocs+NVD | 組み込み認証なし、これ自体がCVE-2025-63389(9.8 CRITICAL)として記録 | CVSS 9.8 | DNS rebindingでloopback bindも迂回されうる(CVE-2024-28224) |
| llama.cpp server認証 | ベンダーdocs | `--api-key`が常時利用可能 | — | — |
| Tailscale Serve(無料枠) | ベンダーdocs | tailnet内限定なら無料で利用可、Funnelのみ有償 | $0 | HTTPS終端で~220ms×2遅延(#18916) |
| Cloudflare Tunnel+Access | ベンダーdocs | アウトバウンドのみ接続+ゼロトラストポリシー | — | 独自ドメイン管理が前提 |
| 実践者(Willison) | 個人ブログ | Ollamaを0.0.0.0 bind+Tailscaleメッシュのみで運用、認証機能には頼らない | — | — |
| 露出インシデント | Shodanスナップショット(今日) | keyword"ollama"で1,243件、うちOllama標準ポート一致は未確認 | 1,243(粗い) | ポート絞り込みはレート制限でブロック |
| Mac sleepとの相性 | gh issues+in-the-wild | Ollama側に未解決のsleep防止要望(#4072)、LM Studioはapp napでWS切断報告 | — | caffeinate運用が事実上必須 |
| LiteLLM+LM Studio+tailnet | gh search code | 公開リポジトリで前例0件 | 0件 | — |

---

## 結論(平易な言葉で)

現状この持ち主のスタックは、LM Studio(127.0.0.1:1234)もLiteLLM proxy(127.0.0.1:4000のDockerコンテナ)も**完全にloopback限定**で、他マシン/スマホからは何も見えない。ここから4形を測る:

- **(a) LM StudioをLANにbind + ファイアウォール**: 非推奨。証拠は明確に否定的——LM Studio 0.3.x系にはサーバー認証が一切なく、この持ち主が使っている0.4.24でも「ヘッドレスでは認証トグルをCLIから有効化できない」という未解決バグ(lms#489)がある。さらにmacOSのApplication Firewallは「アプリが着信を受け付けるか否か」のオン/オフであり、LANとWANを区別しない・送信元による絞り込みもしない——「LAN限定」を実際に強制する機構ではない。加えてOllama側では「loopback bindなら安全」という前提自体がDNS rebinding(CVE-2024-28224)で崩れた前例があり、同種のリスクは構造的にありうる。スマホ利用は自宅Wi-Fi内限定というメリットしかなく、コストの低さだけが取り柄。
- **(b) LM Studioはloopbackのまま + Tailscale Serve**: 次点。LM Studio自体は一切外に出ず、到達経路はTailscaleのメッシュ(ID認証+WireGuard)だけになるため、LANが乗っ取られてもLM Studioには届かない。無料Personalプランで`serve`(tailnet内限定)は完結し、`funnel`(公開)の有償縛りは関係ない。スマホもTailscaleアプリを入れれば自宅外からも使える。実地では`agent-squid/squid`などOllamaでの実装例は豊富だが、LM Studio単独のテンプレリポジトリは無く(Ollamaは7件、LM Studioは0件)、"Host"ヘッダー系の落とし穴(`--tcp`必須)を踏んだ実例がある。
- **(c) LiteLLM proxyだけをtailnet越しに公開、LM Studioはloopback、鍵はop管理**: この持ち主に最も筋が良い。理由は証拠でなく設計整合——この持ち主は既に「op = 単一鍵源」「LiteLLM = 計測付きHTTP境界」という方針を自分のスタックに実装済み(master_keyは2026-09-20から実秘密化・Prometheus計測も稼働中)。(c)は既存のこの境界を1箇所(:4000)だけ拡張すればよく、LM Studio自体の未成熟な認証story(0.4.24でもheadlessでは有効化できない)に依存しない。ネットワーク層(Tailscale ID)とアプリ層(LiteLLM bearer key)の二重認証になり、(b)より一段強い。ただし公開実例ゼロ(gh searchで確認)という点で「前例のない自作」になる——設計は健全だが検証済みパターンではない。
- **(d) Cloudflare Tunnel + Access**: 動作するが、この持ち主には過剰。独自ドメイン・Cloudflareアカウント・Accessポリシーの管理が追加で必要になり、Tailscaleの無料枠で完結する用途(自分のマシン間)にはオーバースペック。加えてプロンプト/応答がCloudflareのネットワークを経由する——ローカルLLMを選んだ動機(プライバシー)とやや矛盾する。スマホ側にVPNアプリが要らない分の手軽さはあるが、この持ち主は既にTailscaleを検討対象にしている時点でその利点は薄い。

**どの形を選んでも残る問題**: Macのスリープ。Ollamaには「スリープを防ぐべき」という未解決の公式issue(#4072)があり、LM Studioもapp nap下でWebSocket接続が切れる報告が複数ある。公開方式に関わらず`caffeinate`(またはPower NapオフやAmphetamine系ツール)の運用が事実上必須という点は、実地調査で一貫して確認された。

## 前例なし・未検証(明示リスト)

- Ollama公式の「インターネットに公開するな」という明示的セキュリティ告知ページ — 見つからず
- Talos/Censys由来の2024年時点の「数千台露出」という歴史的一次レポート — 検索エンジンが軒並みブロックされ到達不能、今日時点のShodan粗スナップショット(1,243件、ポート未確認)で代替
- tailnet vs LAN の定量的レイテンシ比較 — 数値なし、Tailscale公式も定性的記述のみ
- LiteLLM proxyの`--host`/bindアドレスの明示ドキュメント — 2ページ確認したが見当たらず
- LiteLLM proxy自体のCVE・セキュリティ実績 — 本調査のスコープ外
- MLXサーバー(mlx-lm)のhost/認証オプション詳細 — SERVER.mdに記載なし
- LiteLLM+LM Studio+tailnet IPを組み合わせた公開実装 — gh search code で0件、不在自体が所見
