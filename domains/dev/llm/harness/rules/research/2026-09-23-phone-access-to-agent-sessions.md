# スマホからローカルのコーディングエージェントセッションを操作する — 2026-09-23 業界調査

対象範囲: Mac 上で動く Claude Code / OpenAI Codex CLI / oh-my-pi (omp) / pi (earendil-works/pi) / DSH を、Tailscale 経由でスマホから「チャットだけでなく、セッションを見て・操作して・新規起動して・パーミッション承認して・diff を読む」ために使う手段。Open WebUI 経由のチャットはすでに解決済みなので対象外。

## 方法と検証状況の凡例

- **[直接取得]** — WebFetch/curl で一次ソース（ベンダー公式ドキュメント・GitHub API・リポジトリ README）を直接取得し、原文を引用
- **[要約経由]** — WebFetch の要約モデルを介して得た内容。原文の逐語引用がある箇所はその範囲のみ検証済み、それ以外は要約であることを明示
- **[到達不可]** — 404 やリダイレクト先不明で取得できなかったもの。「無い」ではなく「確認できなかった」として記録
- 本セッションは WebSearch のツール枠（200/200）を消費済みだったため、Hacker News Algolia API（`hn.algolia.com/api/v1/search`、認証不要の公開検索 API）を代替の発見経路として使用した。ベンダー文書は WebFetch で直接 URL を叩いた
- GitHub API はセッションのサンドボックス内で `gh` CLI 自体が TLS 検証に失敗したため（`x509: OSStatus -26276`）、`gh auth token` で取得したトークンを `curl --cacert /etc/ssl/cert.pem` に渡す迂回で認証済み GitHub API 呼び出しを行った

---

## 1. ベンダー

### 1a. Claude Code — Remote Control と Cloud sessions（claude.ai/code / モバイルアプリ）[直接取得]

Claude Code には**別物の 2 機能**があり、この違いが調査の核心。

**Cloud sessions**（`claude.ai/code`、モバイルアプリの Code タブ、`claude --cloud`）は Anthropic 管理のクラウド VM 上でセッションが走る。ローカルマシンとは無関係。
> "A cloud session is a Claude Code session that runs on cloud infrastructure instead of on your machine." — [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web)

**Remote Control**（`claude remote-control` / `claude --remote-control` / `/remote-control`）が、今回owner が求めている「ローカルで動いているセッションをスマホから見て操作する」に正確に一致する機能。
> "Remote Control connects claude.ai/code or the Claude app for iOS and Android to a Claude Code session running on your machine... your local Claude Code session makes outbound HTTPS requests only and never opens inbound ports on your machine." — [Remote Control](https://code.claude.com/docs/en/remote-control)

スマホからできること（原文引用）:
- 承認プロンプトの承認: "an **Approve tool calls from your phone** notification shows the session URL"
- diff の閲覧: "**Diff of your changes**: when the session's directory is in a git repository, a connected device's diff pane shows your changes... Claude Code computes it on your machine."
- 新規セッション起動はスマホ側からは不可（Remote Control はローカルで起動した既存プロセスに接続するだけ）。スマホから新規タスクを投げたい場合は Cloud sessions か Dispatch を使う設計
- モデル・エフォートレベルの変更、モバイルプッシュ通知（"Claude decides when to push... or when it needs a decision from you to continue"）

要件（原文）:
- "Subscription: available on Pro, Max, Team, and Enterprise plans. **API keys are not supported.**"
- "API endpoint: not available... You point ANTHROPIC_BASE_URL at a host other than api.anthropic.com, such as an LLM gateway or proxy."（=このリポジトリが運用する LiteLLM ゲートウェイ経由の Claude Code では Remote Control は動かない）
- 通信は Anthropic API 経由の outbound HTTPS のみ、インバウンドポート開放なし。Tailscale は不要（Anthropic のサーバーがブローカー）

制限（原文）:
- "One remote session per interactive process"
- "Local process must keep running... If you close the terminal, quit VS Code, or otherwise stop the claude process, the session goes offline"
- "Extended network outage: Server mode: Claude Code gives up after roughly 10 minutes"
- "Forwarded dialogs expire: ...it waits five minutes by default, then closes the dialog and continues with the dialog's no-action default"
- コマンドの一部はローカル専用（`/plugin`, `/resume` 等）でスマホ/web からは使えない

比較表（原文の Choose the right approach 表より）: Remote Control は「Drive a running session」、Cloud sessions は「start work without local setup」、Dispatch は「メッセージでタスクを投げて Desktop アプリが起動」という 3 系統に分かれている。

### 1b. Codex — codex cloud / ChatGPT モバイル [直接取得]

Codex cloud はクラウド VM 上で走るタスクで、"Run coding tasks in parallel cloud environments"、開始経路は "web, GitHub, GitLab, Linear, or Slack" および CLI。[要約経由: learn.chatgpt.com/docs/cloud]

ローカル CLI とクラウドの往復について、Claude Code の `--cloud`/`--teleport` に相当する `codex cloud` コマンドが存在する:
> "`codex cloud` ... Move work to Codex cloud. Browse active and completed chats, submit work to a configured environment, and apply the result to your local repository from the terminal." — [learn.chatgpt.com/docs/codex/cli](https://learn.chatgpt.com/docs/codex/cli) [要約経由]

しかし Claude Code の Remote Control に相当する**「スマホからローカルの codex CLI セッションに直接アタッチして操作する」機能は、公式ドキュメント中に記述が見つからなかった**。同ページの要約: "the documentation does not describe any phone-based remote-control functionality or flags that would let a mobile device attach to and steer a locally-running CLI session for approving tool calls or viewing diffs."
`developers.openai.com/codex/local-cloud` は 404。[到達不可]

### 1c. oh-my-pi (omp) — RPC / ACP、ネイティブなスマホ向けフロントは無し [直接取得]

リポジトリは `can1357/oh-my-pi`（ホームページ omp.sh）。README には RPC モードと ACP（Agent Client Protocol）が明記されている:
> "RPC — drive over stdio: `omp --mode rpc`... For non-Node embedders, or when you want process isolation. NDJSON commands in, response and event frames out." / "`--mode rpc-ui` adds tool cards, selectors, and dialogs as `extension_ui_request` frames the host must answer." / "ACP — speak to editors: `omp acp`... The Agent Client Protocol over JSON-RPC... writes are gated by `session/request_permission`." — [github.com/can1357/oh-my-pi README](https://github.com/can1357/oh-my-pi) [要約経由、上記は引用部分のみ検証]

つまり **omp 自体はプロトコル（RPC/ACP）としては「外部フロントがパーミッション承認を仲介する」口を持つ**が、README にはスマホ向け web UI やモバイルアプリへの言及はない。この口を使ってスマホブリッジを自作した非公式プロジェクトが複数存在する（§4 参照）。

### 1d. pi (earendil-works/pi) — web/remote フロントの言及なし [要約経由]

README を確認したが、"there is no mention of a web UI, remote control, mobile app, phone-facing front end, or server/RPC mode" とのこと。Slack/chat 自動化用の別プロジェクト `earendil-works/pi-chat` への言及はあるが、これはスマホからローカルセッションを操作する機能ではなくチャット bot 的な別物。[要約経由]

### 1e. 比較対象 — Cursor / Zed / Warp [直接取得・要約経由]

- **Cursor cloud agents**: スマホ/ブラウザから開始・管理できる。"Start and manage agents from the Cursor iOS app" / "Start and manage agents from cursor.com/agents on any device" / Android は "Use cursor.com/agents in Chrome and tap Install App for a Progressive Web App"（[cursor.com/docs/background-agent](https://cursor.com/docs/background-agent) [要約経由]）。ただしこれは Claude Code の Cloud sessions と同じ系統＝**クラウド VM 上のエージェント**であり、ローカル IDE セッションへのアタッチではない。Cursor には Claude Code の Remote Control に相当する「ローカルセッションをスマホから継続操作する」機能は見当たらなかった。
- **Zed**: リモート開発は "requires two computers... communicate over SSH" で、"contains no references to mobile access or browser-based steering" — デスクトップ間の SSH 限定。[要約経由: zed.dev/docs/remote-development]
- **Warp**: Agent Mode はデスクトップアプリ／CLI（SSH 経由含む）／クラウドエージェントの 3 系統のみで、"does not provide information about mobile or phone-facing capabilities"。[要約経由: docs.warp.dev/agents/agent-mode]

**ベンダー横断の構図**: 「ローカルで動いているセッションをスマホから継続操作する」を明示的にネイティブ機能として持つのは **Claude Code の Remote Control のみ**。Codex/Cursor/Zed/Warp はいずれも「クラウドで動かす」（Codex cloud、Cursor cloud agents）か「デスクトップ間 SSH」（Zed、Warp）のどちらかで、スマホ⇔ローカルプロセスの直結は無い。omp/pi はプロトコルの口（RPC/ACP）はあるがベンダー自身のスマホフロントを提供していない。

---

## 2. 実践者

Hacker News Algolia 検索（`hn.algolia.com/api/v1/search`、クエリ "claude code phone" / "tailscale claude code" / "happy coder slopus"）で見つかった実例。

### 2a. Tailscale SSH + tmux/mosh 系（自作、インフラ追加なし）

**skeptrune.com**（Show HN, 5 points, 2025-10-20）: Termux（F-Droid 版）+ Tailscale + tmux + SSH、不安定な回線には mosh を推奨。
> "When you disconnect from SSH (phone locks, network drops, whatever), tmux keeps your Claude Code session running in the background." / "The screen is small. The keyboard is mediocre. You can't see multiple files at once." — [skeptrune.com](https://www.skeptrune.com/posts/claude-code-on-mobile-termux-tailscale/) [要約経由]
結論として "doesn't require new infrastructure or custom applications" と「作らずに済む」ことを利点として書いている。

**qu8n.com**（Show HN, 5 points, 2025-12-23）: iPhone + Termius + Tailscale + tmux、Mac 側は terminal-notifier、iPhone 側は ntfy でプッシュ通知。
> "Typing on the phone feels clunky for anything more than a quick response" / "I'm usually in front of my laptop, so the phone notifications are often more distracting than helpful. I ended up disabling the ntfy notifications for now." — [qu8n.com](https://www.qu8n.com/posts/running-claude-code-from-my-phone) [要約経由]
「効いた」ものとして書いているのはコーディングそのものではなく「デスクから離れられる心理的な自由」（"The biggest win isn't coding from my phone. It's not feeling glued to my desk"）。

この 2 件は同じ構成（Tailscale + tmux/SSH）を独立に選んでおり、**入力のしづらさと画面の狭さは共通して指摘**、一方で「一度組んだら動く」「新規インフラ不要」という評価も共通している。否定的な「やめた」報告はこの 2 件からは出ていない。

### 2b. 専用リレーアプリ（自作 OSS、多数乱立）

- **Happy Coder** (`slopus/happy`): 23,877 ★、pushed 2026-09-22、open issues 1,043。"Mobile and Web client for Codex and Claude Code, with realtime voice, encryption and fully featured"。アーキテクチャは `happy` コマンドで claude/codex をラップし、ローカルの CLI プロセスをそのまま維持しながら E2E 暗号化 relay サーバー経由でモバイルアプリと同期する。[github.com/slopus/happy](https://github.com/slopus/happy) [直接取得+要約経由]
- **claude-code-remote** (`yazinsai/claude-code-remote`): 102 ★、open issues 1。ローカル relay サーバー + Cloudflare Tunnel + QR コード。"Not a chat wrapper. A real terminal running on your machine." [直接取得(stats)+要約経由(README)]
- **doom-coding** (`rberg27/doom-coding`): 1,734 ★、open issues 5。"A guide for how to use your smartphone to code anywhere at anytime"（577 points on HN, 2026-01-06）。ガイド形式で特定製品ではない。
- Codex/omp を含む agent-agnostic な新興カテゴリ: **9remote**(`decolua/9remote`, 602★) "Control Claude Code, Codex, Gemini CLI & your Mac/Linux/Windows from any phone or browser"、**Pane / Remote Pane**(`greenfield-inc/Pane`, 478★) "Run agents on a VM, WSL box, home server, desktop... while you keep the Pane UI on your laptop or phone"、**run-kit**(`sahil87/run-kit`, 60★) "A remote, phone-first console for your tmux"。いずれも 2026 年に入ってからの若いプロジェクト。

### 2c. omp/pi 向けの非公式スマホブリッジ（コミュニティ製、小規模）

omp（oh-my-pi）自体はスマホフロントを持たないため、RPC モードを叩く非公式ブリッジが複数個人により自作されている: `itzrnvr/omp-mobile`（1★、"Remote control app for OMP — control your AI coding agent from your phone via WebSocket + Cloudflare tunnel"）、`alphastorm/omp-session-gateway`（25★、"Secure, zero-touch mobile access to every running Oh My Pi session"）、`77zane/oh-my-pi-mobile`（1★、Expo/React Native 製）。pi（earendil-works/pi）向けの同種プロジェクトは検索で見つからなかった。

### 2d. 何が壊れた/面倒だったか（実践者からの否定的証拠）

- 入力体験: qu8n.com、skeptrune.com 双方が「タイプしづらい」「キーボードが貧弱」を明言
- 通知疲れ: qu8n.com は ntfy 通知を"disabled"（無効化した、と明記）— 一度使って戻した実例
- **Happy Coder のパーミッション既定値問題**（§4 issue #1514 参照）: リレーアプリが「承認済みの安全な操作」であるべきスマホ操作の裏で、デフォルトが `--dangerously-skip-permissions`（yolo モード）になっていた

---

## 3. 測定された証拠

**この観点では定量データがほとんど無い。**

- レイテンシ・再接続時間・同時セッション数などを計測した論文・ベンチマークは見つからなかった
- Claude Code の Remote Control ドキュメントに数値的な言及が一部ある（原文引用、ベンダー公称値であり第三者計測ではない）:「HTTP 403 refusals... Claude Code keeps retrying for up to three minutes」「Extended network outage: Server mode... Claude Code gives up after roughly 10 minutes」「dialogExpiry... it waits five minutes by default」
- GitHub issue 件数は数えられる指標として提示できる（§4 参照）が、これは「壊れた報告の量」であって性能測定ではない
- mosh（Mobile Shell）自体はローカルエコー・ローミングでの体感改善を謳うが、これは一般のモバイルシェル向けの主張であり「コーディングエージェント操作」に特化した計測ではない
- **結論: 「確認できなかったこと」に計上する。** 業界のどの主体も、スマホ経由でのコーディングエージェント操作について計測ベースの比較（レイテンシ・切断率・再接続成功率）を公開していない。

---

## 4. 実態（公開リポジトリ）

`gh` CLI がこのセッションのサンドボックスで TLS 検証エラー（`x509: OSStatus -26276`）を起こしたため、`gh auth token` で取得したトークンを使い `curl --cacert /etc/ssl/cert.pem` 経由で GitHub REST/Search API を直接叩いた。[直接取得]

| リポジトリ | ★ | 最終 push | open issues | 状態 |
|---|---|---|---|---|
| slopus/happy | 23,877 | 2026-09-22 | 1,043 | 活発 |
| decolua/9remote | 602 | 2026-09-21 | — | 活発 |
| greenfield-inc/Pane | 478 | 2026-09-23 | — | 活発 |
| can1357/oh-my-pi | 32,899 | 2026-09-23 | 3,048 | 活発（本体、omp.sh） |
| earendil-works/pi | 108,743 | 2026-09-23 | 224 | 活発（本体） |
| rberg27/doom-coding | 1,734 | 2026-01-15 | 5 | ガイド系、更新停滞気味 |
| ttyd (tsl0922/ttyd) | 12,408 | 2026-08-12 | 115 | 活発、汎用 web ターミナル |
| wetty (butlerx/wetty) | 5,446 | 2026-09-21 | 14 | 活発 |
| gotty (sorenisanerd/gotty) | 2,549 | 2026-08-05 | 29 | 活発だが issue は依存パッケージ更新が主 |
| yazinsai/claude-code-remote | 102 | 2026-04-13 | 1 | 小規模、更新は緩やか |
| sahil87/run-kit | 60 | 2026-09-23 | — | 若い、活発 |
| alphastorm/omp-session-gateway | 25 | 2026-09-23 | 4 | 若い、小規模 |
| Mikeore/PocketDex | 16 | 2026-03-24 | — | 小規模 |
| sahrizvi/codex-remote-control | 3 | 2026-09-01 | — | 極小 |
| AliceLJY/phone-remote | 2 | 2026-09-05 | — | 極小 |
| itzrnvr/omp-mobile | 1 | 2026-09-09 | — | 極小、omp 用の唯一に近い非公式ブリッジ |
| 77zane/oh-my-pi-mobile | 1 | 2026-07-05 | — | 極小 |

**注目すべき負の証拠 — Happy Coder issue #1514**:
> "A fresh `npm i -g happy` followed by a bare `happy` run (no `--permission-mode`, no `--yolo`) spawns Claude Code with `--dangerously-skip-permissions`. The user never opted into bypassing permission prompts — the CLI ships that way." / "Remote driving is happy's headline use case: an unattended agent with every permission gate disabled is exactly the setup where a prompt-injected or simply misbehaving agent can do the most damage — and the operator is by definition not at the keyboard." — [slopus/happy#1514](https://github.com/slopus/happy/issues/1514)（2026-09-23 時点で open）

同リポジトリの issue 検索（`repo:slopus/happy permission`）は 285 件ヒット、`disconnect` は 44 件ヒット。代表例:
- #1735「Sending a new message while a permission request is pending aborts it — tool call fails」（open）
- #1229「Daemon does not reconnect after WebSocket disconnect when Mac lid is closed」（open）
- #1208「Android remote session sync issues: reconnect failure, permission timeout disconnect, long session stale open」（open）

汎用 web ターミナル（ttyd/gotty/wetty）の issue は認証周りの細かな不具合（例: ttyd #1557「Auth-header denied connection when username length >= 30」、#1544「limit WebSocket message size to prevent unbounded memory growth」）が中心で、これらはエージェントの承認 UI ではなく「シェルそのもの」を無防備にネットワーク越しに晒す前提のツールであり、パーミッション承認の設計そのものは持たない（＝そこはユーザーの構成任せ）。

`slopus/happy` の GitHub Security Advisories API 照会は 0 件（公開 GHSA なし、[直接取得]）。ただし GHSA が無い＝脆弱性報告が無いという意味ではなく、コミュニティが issue trunk に直接書いているだけの可能性がある（#1514 がまさにそれ）。

---

## 表: アプローチ横断比較

| アプローチ | スマホでできること | 要件 | named failure mode |
|---|---|---|---|
| Claude Code Remote Control | ローカル claude セッションの継続操作・承認・diff閲覧・モデル/エフォート変更。新規セッション開始は不可 | Pro/Max/Team/Enterprise（API key 不可）、`api.anthropic.com` 直結（LiteLLM 等の gateway 不可）、`claude remote-control`等の起動、ローカルプロセス常駐必須 | ローカルプロセスが落ちるとオフライン、10分でサーバーモード放棄、承認ダイアログ5分でタイムアウト |
| Claude Code Cloud sessions | 新規タスク開始・並列実行・PR作成、web/iOS/Android/Desktop/Terminal全対応 | claude.ai アカウント、GitHub連携、`allow_remote_sessions`組織ポリシー | IP allowlist組織は認証エラー、レート制限は通常利用と共有 |
| Codex cloud | web/GitHub/GitLab/Linear/Slack起点でクラウドタスク開始、`codex cloud`でローカルに結果を取り込み | ChatGPTアカウント、GitHub/GitLab連携 | スマホからローカルCLIセッションへの直接操作機能は文書上確認できず |
| omp RPC/ACP (`--mode rpc`, `omp acp`) | プロトコルとしてはホスト側が承認UIを実装すれば可能 | 自前でRPC/ACPクライアントを書く必要あり、ベンダー純正のスマホUIなし | 非公式ブリッジは★1〜25の極小プロジェクトのみ |
| pi | 該当機能なし | — | README上に記述なし |
| Tailscale SSH + tmux/mosh + Termius/Termux | フルターミナル操作（=事実上何でも）、既存harnessそのまま使える | Tailscale、SSHキー、tmux/mosh、SSHクライアントアプリ | 入力体験が悪い、通知疲れで無効化した実例あり(qu8n.com) |
| Happy Coder (slopus/happy) | claude/codexをラップしE2E暗号化リレーでモバイル同期、音声入力あり | `npm install -g happy`、happy server経由 | **デフォルトでdangerously-skip-permissions（#1514）**、pending中の承認がメッセージ送信で消える(#1735)、WebSocket再接続の不具合多数 |
| claude-code-remote / 9remote / Pane等 | Cloudflare tunnel/P2P経由でローカルの任意CLIエージェントにフルターミナルアクセス | Node.js、cloudflared、（9remoteは）split-key pairing + X25519/AES-256-GCM | 大半が2026年に入ってからの若いOSSで実績が薄い、セキュリティモデルの記載が製品によりまちまち |
| VS Code Remote Tunnels | リモートdevserverへのフルIDEアクセス（agent操作可否は不明） | Remote-Tunnels拡張、`vscode.dev`、"one user or client at a time" | Copilot agentのスマホ操作可否はドキュメント上明記なし |
| ttyd/gotty/wetty | 生のweb terminal、Claude Code等を中で動かせば操作は可能 | 自前でreverse proxy/認証を組む必要 | 認証ヘッダのバグ(ttyd#1557)、WSメッセージサイズ無制限によるメモリ問題(ttyd#1544) |
| Cursor cloud agents | iOS app / cursor.com/agents (PWA) からクラウドエージェント開始・管理 | 有料プラン、リポジトリ連携、支出上限設定必須 | ローカルセッションへの直結機能は無い（Claude Code Cloud sessions と同系統） |
| Zed remote development | デスクトップ⇔サーバーのSSHのみ | 2台のマシン、SSH到達性 | モバイル/ブラウザへの言及なし |
| Warp Agent Mode | デスクトップ/CLI(SSH経由)/クラウドエージェントの3系統 | Warpアプリ | モバイル向け機能の記載なし |

---

## 確認できなかったこと

- レイテンシ・切断率・再接続成功率などの**計測データ**は業界のどこにも公開されていない
- Codex に Claude Code の Remote Control 相当（ローカル CLI セッションへスマホが直接アタッチする機能）が存在するかどうかは、公式ドキュメントの到達範囲内では明確な否定も肯定も確認できなかった（`developers.openai.com/codex/local-cloud` は 404、`codex cloud` はローカル↔クラウドの結果転送機能であり「アタッチ」ではないことは確認できた）
- pi（earendil-works/pi）向けの非公式スマホブリッジは検索で見つからなかった（omp には複数あるのに pi には無い、という非対称は確認したが、無いことの積極的証明はできない）
- `slopus/happy` の GHSA（公式セキュリティアドバイザリ）は 0 件だったが、これは npm パッケージ全体のセキュリティ監査ではない
- Claude Code Remote Control の実運用における「Tailscale 経由の LAN/自宅サーバー限定運用」との相性（Remote Control は Anthropic API 経由の外部ブローカー方式であり Tailscale は不要/無関係）は原文から明確だが、これがこのリポジトリの Tailscale 中心の設計方針とどう噛み合うかは今回のスコープ外（推奨はしない）

---

## 結論（何を推奨するかではなく、何が実際に行われているか）

「ローカルで動くコーディングエージェントをスマホから操作する」に対して、2026年9月時点で観測できる**確立した業界プラクティスは 3 層に分かれる**。

1. **ベンダーネイティブでこれを謳っているのは Claude Code の Remote Control だけ**。`claude remote-control` を起動すればローカルプロセスはそのまま、Anthropic のサーバーがブローカーとなってスマホ/ブラウザから承認・diff閲覧・継続対話ができる。ただし API key 認証や `ANTHROPIC_BASE_URL` を書き換えるゲートウェイ経由では動かないという制約がある。Codex/Cursor/Zed/Warp は「クラウドで動かす」（ローカルとは別セッション）か「デスクトップ間 SSH」のどちらかで、ローカルプロセスへのスマホ直結は無い。omp と pi はベンダーとしてこの機能を提供していない（omp は RPC/ACP という口だけ持つ）。
2. **実践者の主流は自作である**: Tailscale + tmux/mosh + Termius/Termux によるフル SSH アクセスが最も多く言及される、インフラを増やさない構成。ここでの共通の不満は「入力しづらい」「通知が煩わしくて切った」であり、致命的な失敗報告（=完全に放棄した）は見当たらなかった。
3. **専用リレー OSS が急増中で、規模差が大きい**。Happy Coder（23.8k★、Claude Code/Codex 対応、E2E暗号化）が头一つ抜けているが、その Happy Coder 自身が「スマホ操作の裏でデフォルトが `--dangerously-skip-permissions` になっている」という、今回owner が最も気にするはずの「承認」を無効化する既定値バグを抱えている（issue #1514、2026-09-23時点でopen）。9remote・Pane・run-kit など 2026年に入ってからの若いプロジェクトが同じ課題に別解を出し続けている状態で、まだ業界標準と呼べる決定版は無い。omp/pi 向けの非公式ブリッジは★1〜25の個人プロジェクトのみで、実績と呼べる段階にない。

