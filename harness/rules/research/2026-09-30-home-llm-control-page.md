# 「家のLLM利用料 + GPU用途切替」画面・操作口の業界実態調査

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）

- `2026-09-30-one-gpu-llm-and-3d-generation.md`（同日付の既存調査）で確立済み: llama-server router mode の `/models/unload`、llama-swap の groups/exclusive/ComfyUI統合、`--sleep-idle-seconds`のVRAM残留バグ(#19379)、3Dモデル生成AI各種のVRAM要件。本調査ではこれらを再調査せず引用のみ行う。
- `harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`、`2026-09-25-llm-cost-ledger-local-first.md` に既存の構成決定がある（LiteLLM/LM StudioはLAN・インターネットに出さない、tailnetのみ、Mac Postgresが費用台帳）。これらは調査対象ではなく前提として扱う。
- `harness/rules/knowledge/INDEX.md` を確認したが、この画面・操作口の話題（LiteLLM Admin UI、Grafana×tailscale serve、ダッシュボード、GPU切替HTTP API）に直接該当する既存knowledgeはなかった。

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl`でベンダーの生ドキュメントHTML/README/Issueを取得し、HTMLタグ除去後grepで原文引用した |
| [要約経由] | `WebFetch`（AIによる要約）を通した。原文全体は見ていない |
| [到達不能] | 試みたが到達できなかった |
| [測定なし] | ソース自体に数値が無い |

**重大な制約**: このセッションはWebSearchの予算(200/200)を**開始直後に使い切っていた**（前の調査記録から持ち越し）。そのため本調査は一度もGoogle的な横断検索ができておらず、既知のURLへの直接アクセス（WebFetch/curl）と `api.github.com` 検索のみで構成されている。Redditやブログ記事など、検索でしか辿り着けない情報源には到達できていない。`gh`コマンドは `api.github.com` へのTLS検証がこのサンドボックスで失敗する（`gh api user` → "Forbidden" + sandbox violation）ため、`curl` + `allowed_domains` で代替した。**gh/GitHubの認証トークンを読み出す操作は行っていない。**

---

## 2. ベンダー（vendors）

### 2.1 LiteLLM Admin UI（`/ui`）

一次ソース: [直接] `https://docs.litellm.ai/docs/proxy/ui`（Quick Start）、`https://docs.litellm.ai/docs/proxy/cost_tracking`、`https://docs.litellm.ai/docs/proxy/ui_logs`（HTMLをcurlで取得しタグ除去後grep）。

- **DB必須**（Quick Startページ本文）:
  > "Requires proxy master key to be set" / "Requires db connected"
- **ログイン方式**（同ページ）:
  > "UI_USERNAME (default admin) and the password is UI_PASSWORD" — 環境変数 `UI_USERNAME`/`UI_PASSWORD` でユーザー名/パスワードのログインを設定できる。SSOを設定すると:
  > "you can now remove UI_USERNAME and UI_PASSWORD from your environment... only database users (and SSO, if configured) can sign in."
  - SSO自体の設定方法は `docs/proxy/admin_ui_sso` に別ページであるが、本調査ではOSS版で使えるSSO方式（Okta/Google/Microsoft Entra ID等）の詳細までは検証していない[要フォローアップ]。
- **Usage Logsページ（`/spend/logs`相当のUI）は無印**（Enterpriseタグなし）:
  > "Getting Started with UI Logs — View Spend, Token Usage, Key, Team Name for Each Request to LiteLLM"
  - デフォルトでSuccess/Errorログは記録、リクエスト/レスポンス内容は既定オフ（`store_prompts_in_spend_logs`でオプトイン）。
  - 保持期間の自動削除も無印機能として文書化: `general_settings.maximum_spend_logs_retention_period`。
- **チーム/顧客別の集計レポートは明示的にEnterprise限定**（`cost_tracking`ページ本文、✨マーク付きの節見出し）:
  > "✨ (Enterprise) Generate Spend Reports" ... "Use the /global/spend/report endpoint to get spend reports"
  > "spend endpoints info Schedule a meeting with us to get your Enterprise License"
  - 一方、モデル別・プロバイダ別・キー別の**日次**利用量は無印のAPIとして文書化されている:
    > "Retrieve granular daily usage data for a user (by model, provider, and API key) with a single endpoint." （`/user/daily/activity`）
  - 個別トランザクションログのページネーションAPI（`/spend/logs/v2`）も無印:
    > "Use /spend/logs/v2 for programmatic access to individual spend logs with page-based pagination... total count is capped at 10,000"
  - **ページ末尾に毎回同じ宣伝文が付いている**（全ドキュメントページ共通のフッター、機能ごとの✨タグとは別物）:
    > "🚅 LiteLLM Enterprise: SSO/SAML, audit logs, spend tracking, multi-team management, and guardrails — built for production."
    - このフッターだけを読むと「spend trackingはEnterprise限定」に見えるが、同じドキュメント内の本文レベルの記述（Usage Logs、`/user/daily/activity`、`/spend/logs/v2`）には✨タグが付いておらず、無印機能として説明されている。**フッターの宣伝文と本文の機能タグが矛盾して見える**——これは判断を避け、両方をそのまま引用するに留める。
- **複数インスタンス/複数DBを一つのUIで集約して見られるか**: `cost_tracking`・`ui`・`ui_logs`いずれのページにも、複数のLiteLLMプロキシインスタンスや複数DBを横断集計する記述は見当たらなかった[測定なし]。UIは設定されたDB1つに対してクエリを投げる構造であることは読み取れるが、「同じテーブルスキーマの共有DBに複数機械がログを書けば、UIが機械の区別なく合算して見せるか」を明示したベンダー記述は見つからなかった。これは本リポジトリの `LiteLLM_SpendLogs` を中央台帳に集約する構成（既存決定）から**推測すればおそらく可能**[unverified、ベンダーの明示なし]だが、確認はできていない。

### 2.2 Tailscale Serve — identity headers とバックエンドの置き場所

一次ソース: [直接] `https://tailscale.com/kb/1312/serve`（curlでHTML取得、WebFetch要約でも同内容を確認）。

- 基本動作:
  > "tailscale serve 3000" — `http://127.0.0.1:3000` で動くサービスをtailnet内に公開する。
- **バックエンドはループバックだけで待つべき、という明示の注意**:
  > "it's best practice to only have the service listen on localhost. Otherwise, any user that can call your service directly (rather than with the Serve URL) could trivially provide their own values for these HTTP headers."
- **identity headers**（3種類）:
  > "Tailscale-User-Login" — 例: `alice@example.com`
  > "Tailscale-User-Name" — 例: `Alice Architect`
  > "Tailscale-User-Profile-Pic" — IDプロバイダ提供時のみ
  > "These identity headers are not populated for traffic originating from tagged devices."
- **ヘッダー偽装対策**:
  > "If Serve finds the following headers on an incoming request, it will remove them for security reasons, to avoid header spoofing." — 着信リクエストに既にこれらのヘッダーが付いていれば、Serveがそれを除去してから自前のヘッダーを付け直す。
- `tsnet`や`whois` APIを使ったより低レベルな実装例、Funnelとの違いの詳細は本調査では未確認[要フォローアップ、WebSearch予算切れで横断的な実装例探索ができなかった]。

### 2.3 Grafana — auth.proxy（ヘッダーベース認証）

一次ソース: [直接] `https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/auth-proxy/`（WebFetch要約、curlでの直接grepは未実施）。

- 有効化: `[auth.proxy]` セクションの `enabled` を `true` に（デフォルト `false`）。
- ユーザー名/メールを渡すヘッダー名は `header_name`（デフォルト `X-WEBAUTH-USER`）で指定。
- **ヘッダー偽装への警告**:
  > "This can be used to prevent users spoofing the X-WEBAUTH-USER header" — `whitelist`パラメータで信頼できるプロキシのIPを限定することが前提とされている。
- **OSS版で使える**: auth.proxy自体はOSS版で利用可能。例外は「Team Sync」機能のみで、これは明示的に:
  > "Available in [Grafana Enterprise]" とEnterprise限定と記載されている。
- Tailscale serveの`Tailscale-User-Login`ヘッダーをGrafanaの`auth.proxy`の`header_name`にそのまま流用する設定例（公式ブログや公式ドキュメントでの明示的な組み合わせ）は、本調査では見つけられなかった[要フォローアップ、WebSearch予算切れ]。`tailscale.com/blog/grafana-tailscale-serve`のようなURLは404で存在しなかった。

### 2.4 Homepage / Home Assistant ダッシュボードの「操作」機能

一次ソース: [直接/要約混在] `https://gethomepage.dev/`、`https://gethomepage.dev/widgets/services/homeassistant/`（WebFetch要約）。

- Homepageは「100以上のサービスと統合」する死活監視・状態表示ダッシュボードと自称:
  > "A modern, fully static, fast, secure fully proxied, highly customizable application dashboard with integrations for over 100 services"
- Home Assistantウィジェットについては、確認できたドキュメント範囲では**状態の監視・表示のみ**:
  > "Allowed fields: [\"people_home\", \"lights_on\", \"switches_on\"]"（在宅人数やON状態の数を表示するだけ）
  - ボタンでシーン実行やスイッチをON/OFFする「サービス呼び出し」機能の記載は、確認したページの範囲では見当たらなかった[測定なし、widgets配下の全ページは網羅していない]。
- Dockerウィジェットページ（`/widgets/services/docker/`）は404で該当URLに到達できず、start/stop操作の有無を直接確認できなかった[到達不能]。
- 結論として、「ボタンで任意コマンドを実行できる家庭内ダッシュボード」の代表格として名前が挙がるHomepage/Homarr/Dashyについて、**本調査で直接確認できたのは死活監視・状態表示の範囲まで**で、コマンド実行機能の有無・危険性についての公式な明記は見つけられなかった[要フォローアップ]。

### 2.5 GPU用途切替をHTTPで受ける小さなサービスの実例（既存調査からの引用のみ）

既存調査記録（`2026-09-30-one-gpu-llm-and-3d-generation.md`）から再確認なしで引用:
- llama-server router mode: `POST /models/unload {"model": "<id>"}` でモデルをアンロード。
- llama-swap: `POST /api/models/unload`（全モデル）、`POST /api/models/unload/:model_id`（個別）、`groups`の`exclusive: true`で他グループを全アンロード、ComfyUI専用パススルー`/comfyui/`あり。
- ComfyUI: `POST /free {"unload_models": true, "free_memory": true}` → `comfy.model_management.unload_all_models()`（server.py/main.pyでソースレベル確認済み）。
- **llama-swapの認証**: [直接] README(`raw.githubusercontent.com/mostlygeek/llama-swap/main/README.md`)に
  > "✅ API Key support - define keys to restrict access to API endpoints"
  とあるが、これが`/ui`（Web UI）や`/api/models/unload`のような管理系エンドポイントまで対象に含むのか、`/v1/chat/completions`のような推論エンドポイントだけなのかは、README本文からは判別できなかった[測定なし、docs/kb配下にauth専用ガイドは見当たらなかった]。

---

## 3. 実践者（practitioners）

WebSearch予算切れのため、Reddit・個人ブログへの横断検索ができず、`api.github.com`のリポジトリ検索でGitHub上の実名個人の実践記録に限定した。ヒット数自体が非常に少ない（後述の§5参照）。

### 3.1 NicolasPogorzelski/homelab-server-architecture

[直接] READMEおよび`docs/decisions/loopback-tailscale-serve.md`、`docs/decisions/pveproxy-tailscale-boot-ordering.md`を`api.github.com`のContents APIで生取得。stars 1、pushed 2026-09-29（前日）、個人アカウント（学業と並行運用中の自宅Proxmoxラボと自己申告）。

- **「Loopback + Tailscale Serve」を明示のADR（設計裁定記録）として書いている**、まさに本調査の質問と同型の構成:
  > "Every service binds exclusively to 127.0.0.1 (loopback) on its configured port. Tailscale Serve acts as the reverse proxy: it terminates TLS on the Tailscale interface and forwards traffic to the local loopback port via HTTP."
  - Grafanaの実例が明記されている:
    ```
    ports:
      - "127.0.0.1:3000:3000"
    tailscale serve --bg --https=443 http://127.0.0.1:3000
    ```
  - 検討して**却下した代替案**: Nginx/Caddy/Traefikによる伝統的リバースプロキシ（TLS証明書管理・ポート開放維持の運用負荷が単独運用者には過大と判断）、Tailscale IPへの直接バインド（TLS終端が自前になる、IP変更リスク、`tailscale serve status`によるアクセスログの一元管理を失う）。
  - **既知の落とし穴として明記**:
    > "Second service on the same Tailscale Serve port overwrites the first... Tailscale Serve does not support subpath routing (`/grafana` -> Service A, `/prometheus` -> Service B does not work)." — サブパスルーティング不可、サービスごとにポートを分ける必要がある。
    > "Serve configurations have remained persistent across individual LXC/VM reboots. A full Proxmox host reboot (all nodes simultaneously) has not yet been performed." — 個別ノード再起動では設定が残ることは確認済みだが、**全ホスト同時再起動での永続性は未検証と自己申告**している。
  - **ベンダーロックインを明示的に懸念事項として記録**:
    > "Changes to the free tier could restrict features" / "No trivial fallback to an alternative VPN without architectural changes"
- **否定側の実測インシデント（KE-12: pveproxy起動レース）**: Proxmoxの管理UI（`pveproxy`）をTailscale IPだけにバインドする構成で、起動時に`tailscaled`がまだIPを割り当てていないため`pveproxy`が`Cannot assign requested address`で起動失敗し、**手動SSH介入が必要になった**という実測インシデント:
  > "pveproxy does not fall back to a partial bind - it exits non-zero and stays dead until a manual `systemctl restart pveproxy`. The web UI is then unreachable after every boot until someone intervenes (and they can only intervene over SSH, which is the failure this hardening was meant to avoid)."
  - 修正は`systemd`の`ExecStartPre`でTailscale IPの出現を最大30秒ポーリングして待つdrop-inを追加。**「コールドブート（全体同時再起動）での検証はまだ未実施」**と正直に記録されている:
    > "Cold-boot verification is still pending - the fix was validated only by a warm restart so far; the next reboot ... is the real test."
  - PostgreSQLでも同種のブートレース(`postgresql-tailscale-boot-ordering.md`、本調査では本文未取得)が記録されているとの言及あり。
- **この実践者の位置づけ**: starは1、著者は学生を自称する個人（"alongside full-time studies"）で、業界的な権威や広い採用実績はない。ただし、tailscale serveでGrafana等を公開する構成とその落とし穴（サブパス不可、ブート順序レース）を実測ベースで記録している点は、本調査で見つかった中で最も直接的に関連する一次資料である。

### 3.2 wenrui0128/tailquota-limit

[直接] README（`api.github.com`のContents API、raw）。stars 0、pushed 2026-09-19、個人アカウント。

- **LiteLLM利用料をTailscaleのプライベートネットワーク上でだけ見せる「額度統計看板」**——本調査の質問とほぼ同一のユースケース。README本文は中国語。
- **明示的に読み取り専用と自己申告**（README冒頭）:
  > 「這是精簡源码版：Docker Compose 配置與命令 + Limit 前後端 + 額度估計。預算結果是建議，不會自動寫入 LiteLLM，也不會清零或同步重置 Key。」（大意: 予算の推奨値はあくまで提案であり、LiteLLMへ自動的に書き戻すことはせず、キーのリセットや同期もしない）
  > 「所有請求均為只讀操作」（すべてのリクエストは読み取り専用操作）
- **バインド方法はtailscale serveではなく、Tailscale IPへの直接バインド**:
  > 「使用這台主機的 Tailscale IP 和端口 18765。不要將綁定地址改為 0.0.0.0。」（このホストのTailscale IPとポート18765を使う。バインドアドレスを0.0.0.0に変えてはいけない）
  - §2.1のNicolasPogorzelski ADRが「却下した代替案」として挙げていた「Tailscale IP直接バインド」を、こちらの実践者は逆に採用している——**同じ選択肢について実践者の間でも判断が割れている**という対比になる。
- **この実践者の位置づけ**: star 0、単著、作成から10日程度(2026-09-19作成)のデモ用途と自己申告のリポジトリ。ケーススタディとしては極めて小規模。

### 3.3 AdamFerguson/spark-lab

[直接] README（Contents API、raw）。stars 0、pushed 2026-09-07。

- LiteLLM + Prometheus + Grafana + Tailscale構成のインフラ管理CLIツール（`spark-lab`）。
- **モデルの切り替えはWebのボタンではなくCLIコマンド**で行う:
  > "Switch or drop a model → the old workload is stopped (gated) and the new one started"
  > "Scale a model across hosts with `model up` / `model down`... stopping just the model without changing config: `model stop --yes`"
  - `apply`は宣言的・冪等（"apply is idempotent and convergent"）。config.yamlを書き換えて`apply`を再実行するパターンで、Web UIのボタン一つでGPU用途を切り替えるという設計にはなっていない。
- Grafanaを含む監視スタックはあるが、tailscale serveでの公開方法や認証の詳細はREADMEに記載がなかった[測定なし]。
- **この実践者の位置づけ**: star 0、単著。ただし「GPU/モデル切り替えはCLIのconverge操作で行い、Webボタンでは行わない」という設計判断は、本調査で見つかった数少ない類似ユースケースの実例として記録に値する。

### 3.4 見つからなかったもの

- 「利用料ダッシュボード + GPU切り替えボタン」を1つの画面に統合した実践報告は、GitHub検索の範囲では見つからなかった。
- Redditやブログでの「自作の家庭内操作パネルを作って、うまくいかず/危険で元に戻した」という一人称の体験談は、WebSearchが使えなかったため探索できていない[到達不能]。

---

## 4. 測定された証拠（measured evidence）

この調査対象（家庭内ダッシュボード・tailnet内操作口の設計パターン）は、そもそもベンチマークや論文の対象になるような研究タスクではなく、**測定された証拠（数値付きの独立した比較）は本調査の範囲では一件も見つからなかった**[測定なし]。

唯一の数値的な「測定」は、既存調査記録から引用するllama.cpp Issue #19379のVRAM残留量（~600MiB）だが、これはGPU切替そのもの（今回の主題）に関する数値であり、ダッシュボード/操作口の設計についての測定ではない。

課題追跡（issue tracker）は否定的な報告に偏るという性質を踏まえて`gh`/`api.github.com`のissue検索を試みたが（"homarr security"、"dashy exec"、"tailscale serve unauthenticated exposed"）、ヒットした上位結果はいずれも本調査の主題（利用料+GPU切替の統合操作パネル）に直接関連するものではなく、依存パッケージの脆弱性パッチ(Dependabot系PR)や無関係なissueが大半だった。GitHub検索APIの一般的な全文検索の限界（キーワードマッチの精度）もあり、的を絞った否定的事例は本調査では十分に拾えなかった[測定なし]。

---

## 5. 実態（in the wild）— 公開リポジトリの採用状況

[直接] すべて`curl`+`api.github.com`（GitHub REST API検索）。

| 検索クエリ | ヒット数 | 上位の内容 |
|---|---|---|
| `tailscale serve grafana` | 2件 | 両方star 1、うち1件が§3.1のhomelab-server-architecture |
| `litellm tailscale` | 13件 | 最大star 15（Sunwood-ai-labs/cloudflare-os-home）、残りはstar 0〜2。§3.2/3.3を含む。最新pushは2026-09-26 |
| `repo:gethomepage/homepage security` | 1,292件（大半がdependabot系のバージョンアップPR） | ダッシュボードの「操作」機能に関するセキュリティ議論は上位に見当たらず |
| `repo:homarr-labs/homarr security` | 1,292件（同上） | 同上 |
| `repo:Lissy93/dashy exec` | 40件（バグ報告中心、execと無関係な内容が大半） | コマンド実行機能に特化した議論は見当たらず |
| `tailscale serve unauthenticated exposed` | 563件（全文検索、キーワードマッチが緩い） | 本調査の主題に直接該当する事例は上位10件に見当たらず |

**この検索結果全体から言えること**: 「利用料ダッシュボード + GPU切替をtailnet内で操作できる画面」というこの構成そのものにピンポイントで一致する公開実装は、GitHub検索で見つかった範囲では**最大でもstar 15、大半がstar 0〜2、かつ作成日が2026年8〜9月と非常に新しい個人プロジェクト**にとどまる。広く踏み固められたコミュニティの定番実装は確認できなかった。

---

## 6. 比較表

| ソース | 種別 | 対象 | 結果・数値 | コスト数値 | 既知の失敗モード |
|---|---|---|---|---|---|
| LiteLLM docs `proxy/ui` [直接] | ベンダー | Admin UIログイン | `UI_USERNAME`/`UI_PASSWORD`環境変数、DB接続必須 | — | DB未接続だとUI自体が動作しない（"Requires db connected"） |
| LiteLLM docs `proxy/cost_tracking` [直接] | ベンダー | 支出集計API | `/user/daily/activity`(モデル/プロバイダ/キー別日次、無印)、`/spend/logs/v2`(件数上限1万、無印)、`/global/spend/report`(チーム/顧客別、明示的にEnterprise) | Enterprise版は個別見積り（"Schedule a meeting"） | フッターの宣伝文("spend tracking"がEnterprise扱い)と本文の機能タグが食い違って見える |
| Tailscale `kb/1312/serve` [直接] | ベンダー | identity headers | `Tailscale-User-Login`等3種、タグ付きデバイスには付与されない、偽装ヘッダーは自動除去 | — | バックエンドをlocalhost以外で待たせるとヘッダー偽装が可能になる、と明記 |
| Grafana `auth-proxy` docs [要約経由] | ベンダー | ヘッダー認証 | `[auth.proxy]`、`header_name`デフォルト`X-WEBAUTH-USER`、OSS版で利用可（Team SyncのみEnterprise） | — | `whitelist`未設定だとヘッダー偽装のリスク、と明記 |
| Homepage公式サイト/widgets [直接/要約] | ベンダー | ダッシュボード機能 | 100+サービス統合、死活監視中心 | — | ボタンでのコマンド実行機能の明記は確認範囲内では見つからず |
| llama-swap README [直接、既存調査引用] | ベンダー | GPU切替API | `POST /api/models/unload`等、`exclusive: true`でグループ排他 | — | API Keyが管理系エンドポイントまで保護するか本文から不明 |
| NicolasPogorzelski/homelab-server-architecture [直接] | 実践者 | Loopback+Tailscale Serve ADR | Grafanaを127.0.0.1:3000→`tailscale serve --https=443`で公開 | — | KE-12: pveproxyがTailscale IP未割当時に起動失敗、手動SSH復旧が必要だった実測インシデント。サブパスルーティング不可も実測 |
| wenrui0128/tailquota-limit [直接] | 実践者 | 利用料ダッシュボード | Tailscale IP直接バインド採用（tailscale serveではない）、書き込みは一切なし(読み取り専用) | — | star 0、デモ用途、本番運用実績なし |
| AdamFerguson/spark-lab [直接] | 実践者 | LiteLLM+Grafana+Tailscaleスタック | モデル切替はCLI(`model up`/`down`)、Web操作ボタンではない | — | star 0、単著 |
| GitHub検索(`tailscale serve grafana`等) [直接] | 実態 | 採用状況 | 最大star 15、大半star 0〜2、直近1〜2ヶ月作成の個人プロジェクトのみ | — | 広く踏み固められた定番実装は確認できず |
| — | 測定 | — | 本主題に対する独立ベンチマーク・論文は0件[測定なし] | — | — |

---

## 7. 何が言えて、何が言えないか

**言えること（証拠のある事実）:**
- 「サービスを127.0.0.1だけにバインドし、`tailscale serve --bg --https=<port> http://127.0.0.1:<port>`で公開する」という構成パターンは、Tailscale自身のベストプラクティス記述（バックエンドはlocalhostのみで待て、というセキュリティ注意）と、実際にGrafanaをこの形で運用している実践者の記録（NicolasPogorzelski）の**両方で一致**している。
- Tailscale serveは`Tailscale-User-Login`等の識別ヘッダーを自動付与し、偽装ヘッダーを除去する仕組みを持つ——これはバックエンド側で「誰がアクセスしているか」を認証に使える設計だが、**バックエンド自身がこのヘッダーを実際に検査して認可判断に使うかどうかは、バックエンド実装側の責任**であり、tailscale serve自体がそれを強制するわけではない。
- LiteLLMのAdmin UIはDB接続必須、ユーザー名/パスワードまたはSSOでログイン可能。モデル別・キー別の日次利用量や個別トランザクションログは無印（OSS）機能として文書化されている一方、チーム/顧客別の`/global/spend/report`は明示的にEnterprise限定。
- 「利用料を見るだけの画面」と「GPUの用途を切り替える操作口」を一つの構成として扱った実践者は、本調査で見つかった範囲では2件（tailquota-limit＝利用料のみ・読み取り専用、spark-lab＝GPU/モデル切替のみ・CLI経由）に分かれており、**両方を1つのWeb画面に統合した公開実践例は見つからなかった**。
- Tailscale serveでの公開において、サービス起動順序（Tailscale IPがまだ割り当てられていない状態でバックエンドが先に起動を試みる）が実測の障害を引き起こした事例(KE-12)が1件、具体的なエラーメッセージと復旧手順つきで記録されている。

**言えないこと・裏付けが弱いこと:**
- LiteLLMのAdmin UIが、複数機械のLiteLLMインスタンスが書き込んだ共有DBを一つのUIインスタンスで正しく合算表示できるか、という本構成の核心的な問いに対する**ベンダーの明示的な記述は見つからなかった**。
- 「ボタンを押すとtailnet内の別機械でGPUの用途を切り替えるコマンドが走る」という具体的な小規模HTTPサービスの公開実践例は見つからなかった。既存調査（GPU切替そのもの）でも同様の「前例なし」の結論が出ており、本調査でもそれを覆す新しい前例は見つからなかった。
- Homepage/Homarr/Dashyのようなダッシュボード製品が「ボタンから任意コマンドを実行する」機能を実際に持つかどうか、公式ドキュメントで確認できた範囲は死活監視・状態表示にとどまり、確定的な結論は出せなかった[要フォローアップ]。
- tailnet内でも認証なしの操作口が事故になった、という具体的な公開インシデント報告は、本調査のGitHub issue検索の範囲では見つからなかった（見つからなかったこと自体が、探索範囲の狭さによるものか、実際に少ないからかは判別できない）。

**欠けているもの（WebSearch予算切れによる制約が大きい）:**
- Reddit（r/selfhosted, r/homelab, r/Tailscale等）、Hacker News、個人ブログでの実践者の声——横断検索ができなかったため、GitHub上で見つかる範囲に限定されている。
- Grafanaのモバイル画面での使いやすさに関する公式・実践者双方の評価。
- Portainer・Home Assistant Dashboard等、「ボタンで操作するホームダッシュボード」の既存の定番ツールについての横断比較（時間の都合で個別調査を打ち切った）。
- LiteLLM Admin UIとGrafanaを同じtailnet上でSSO/IDヘッダーを共有して運用している実例の有無。

---

## 8. 「前例なし」リスト（no precedent found）

- 「利用料表示 + GPU用途切替ボタン」を一つのtailnet内Web画面に統合した公開実装（複数の断片的な実践例(§3.2, 3.3)はあるが、統合例はゼロ）。
- LiteLLMの複数インスタンス・複数機械分の`LiteLLM_SpendLogs`を1つの共有DBに集約したとき、Admin UIがそれを機械横断で正しく合算表示することを明示したベンダー資料・実践報告。
- Tailscale serveの`Tailscale-User-Login`識別ヘッダーを使って、GPU切替のような書き込み系操作を認可する具体的な実装例（読み取り専用の実践例(tailquota-limit)はあるが、書き込み系の実例はゼロ）。
- 家庭内ダッシュボード製品（Homepage/Homarr/Dashy等）のボタンから任意コマンドを実行する機能について、公式ドキュメントで確認できる明記、およびその危険性についてのコミュニティ議論（本調査の到達範囲では見つからず）。
- tailnet内で認証なしの操作口を公開して事故になった、という具体的な一次インシデント報告（検索範囲の制約により、存在しないのか見つからなかっただけなのか判別不能）。
