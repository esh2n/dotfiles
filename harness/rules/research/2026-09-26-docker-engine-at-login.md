---
question: "Nix dotfiles(macOS: nix-darwin+home-manager、Omarchy: standalone home-manager)でDockerエンジンに依存する常駐サービス(LiteLLM proxyのlaunchd/systemd --userエージェント、Prometheus/Grafana/Open WebUIのdocker compose)がある。macOSのDockerエンジンはOrbStack(手動インストール、dotfiles未管理)で、今日起動しておらず全体が無言で止まった。(1)OrbStackの「start at login」はアプリ設定かログイン項目かCLIか、正確なキー名と非対話設定可否、Homebrew cask名と自己更新との整合性 (2)比較用にDocker Desktop/colimaのstart-at-login機構 (3)Omarchyはデフォルトでdockerを入れるか、どのスクリプトが何をするか(有効化・グループ・DNS/ログ設定) (4)systemd --userユニットがシステムのdocker.serviceを待つ受け入れられた方法 (5)launchdエージェントがDockerエンジンを待つ受け入れられた方法"
date: 2026-09-26
verdict: "(1) 「start at login」はGUIのチェックボックスであると同時に、CLIキー`app.start_at_login`としても存在する——ただし後者は2024-12-05にメンテナがGitHub issueのコメントで実装を認めた未公開機能で、公式ドキュメント(docs.orbstack.dev/settings、v1.9.0リリースノート)のどちらにも載っていない[要注意]。`orb config set app.start_at_login true`が正しいキー(issueで提案された`orbctl config set start_at_login`ではない)。非対話設定は`orb config set`で可能——ただし変更の反映には`orb stop && orb start`相当の再起動が要るとされる(二次情報)。Homebrewカスクは`orbstack`(`brew install --cask orbstack`)、`auto_updates: true`で自己更新はSparkle相当がHomebrewの外で行う。config値がDockerアプリ本体ではなく`~/.orbstack/`配下の設定ストアに永続化される構造上、自己更新後も設定が消えないと推測できるが、これを直接確認した一次報告はない[unverified]。**より重要な負の証拠**: OrbStackは「ログインなし/GUIセッションなしでの起動」を明示的にサポートしない。メンテナkdrag0nはissue #1767で「This is not supported. See #1444」、issue #1444で「Daemons run as root, and there are no plans to support running OrbStack as root... I'd recommend somehow starting a user session so that you can use a launchd agent instead」と明言している——LaunchDaemonとして動かす試みは`OrbStack cannot run as root—it requires a user context`という制約で失敗する。(2) Docker Desktopの同等GUI設定「Start Docker Desktop when you log in」は実装は昔からあるが繰り返し壊れる(#7052: 4.24.2〜4.25.2で壊れ4.26.0で修正、公式が「escalated internally」と認めた実例)。colimaはネイティブのstart-at-login機構を持たず`brew services start colima`(Homebrewが`~/Library/LaunchAgents/homebrew.mxcl.colima.plist`を設置)に頼るが、これもOrbStack同様「ログインセッションが要るLaunchAgent」でしかなく、`--user`のuser contextに縛られる点は同じ制約クラス。かつ実装自体に苦労の跡が生々しい(colima issue #96: `keep_alive`をfalseにする必要、`launch_only_once`が要る、環境変数PATH/HOMEを明示的に渡す必要；issue #960は今もOPENで「brew services startは動くと言うが実際には動かない」という報告が続く)。(3) Omarchy(repo: omacom/omarchy)はデフォルトで`docker`・`docker-buildx`・`docker-compose`・`lazydocker`・`ufw-docker`を`install/omarchy-base.packages`でインストール済み——オプトインではなく全員に入る。`install/config/enable-services.sh`は`systemctl enable docker.socket`(**docker.serviceではなくsocket**、verbatim確認)。`install/config/docker.sh`はOmarchy 4.x以降ユーザーをdockerグループに追加しない設計を明記(「the docker group is equivalent to passwordless root」)、有効化は`omarchy-setup-security-sudoless-docker`。`install/config/firewall.sh`はDocker内蔵DNS用のUFW allowルールと、Dockerがiptablesを直接書き換えUFWをバイパスする既知の問題への対策として`ufw-docker install`をISOビルド時に注入する。ログ上限(log-driver/max-size)の設定は調べた範囲では見つからなかった[gap、網羅調査ではない]。(4) systemd --userユニットはシステムスコープのユニット(docker.serviceを含む)に`After=`/`Requires=`で依存できない——systemd/systemd#26305(2024, closed as NOT_PLANNED、#3312の重複)で報告者が「my user scoped units cannot depend on units that are inherently system level」「I received NO warning whatsoever」(サイレントに無視される)と明記、systemdリード開発者poetteringはnetwork-online専用の狭い代替(`systemd-networkd-wait-online`はuser環境から直接呼べる)しか認めず、docker.serviceの汎用的な等価物は無い。同じスレッドで実践者dustymabe(Podman/RH)が一般解として「there's no way I see other than adding a 'sleep' to workaround the issue」と明言——待ちループが受け入れられた回避策であることの一次証拠。(5) launchdにはそもそも`After=`/`Requires=`に相当する依存順序キーが存在しない(公式`launchd.plist(5)`man pageに確認、KeepAlive/ThrottleInterval/WatchPaths/StartIntervalのみ)。実践者(alexwlchan.net)の待ちループパターンは`docker info`相当のチェックを`for i in $(seq 60); do ...; sleep 1; done`で回し、失敗時は`open /Applications/Docker.app`する形——今回のdotfilesの`until docker info; do sleep 3; done`と同型。KeepAlive+ThrottleIntervalは「即座に失敗を返すジョブがクラッシュループするのを防ぐ」ためのガードであり、依存関係の代替ではない。"
unverified:
  - "OrbStackの`orb config set app.start_at_login true`がSparkle相当の自己更新(auto_updates: true)を跨いで維持されることを直接検証した一次報告 — 設定ストアの永続化構造からの推測に留まる"
  - "`app.start_at_login`設定の反映に`orb stop && orb start`が必須かどうかの一次(vendor)確認 — WebSearchの要約に基づく二次情報で、issueやdocsのverbatimでは未確認"
  - "OrbStackのOmarchy側相当物(Omarchy自体がDocker daemonの自動起動を保証する`docker.socket`のsocket activationが、実際にlaunchd/systemd待ちループの`docker info`呼び出しで即座にdockerdをspawnし切るまでの実測レイテンシ) — 挙動としては妥当だが実測報告は見つからず"
  - "bastos/skills(サードパーティのCLIリファレンス)の`app.start_at_login`記載はコミュニティ制作物であり、OrbStack社自身のドキュメントでの確認ではない——2024-12のissueコメント(一次)と2026-06のこのファイル(二次、コミュニティ)の間で挙動が変わっていないことまでは確認できていない"
  - "Omarchyのdocker関連スクリプトにログドライバ上限(log-driver/max-size)設定が本当に一切無いか — install/config配下とomarchy-*.packagesのみ確認し、他のプロビジョニング経路までは網羅していない"
sources_note: "WebFetch/WebSearchを併用。GitHub issueはWebFetchの要約が本文・状態を落とすことが多かったため、`curl -A 'Mozilla/5.0'`でHTML全体を取得しPython正規表現でReact/Relayの埋め込みJSON(body/state/stateReason/login/authorAssociation)を直接抽出する方式に切り替えて検証した(github.comは許可ドメインに追加、api.github.comは一部コマンドでTLS証明書エラーが出たため使わずgithub.com側のJSONを使用)。OrbStackの設定ページ(docs.orbstack.dev/settings)はVitePressのSSR済みHTMLをcurlで取得し、`vp-doc`クラスの中身を直接grep/sedで抽出した(JSクライアントレンダリング分は空)。Omarchyのインストールスクリプトはraw.githubusercontent.com経由でファイル全文を取得した一次情報。前提記録(2026-09-24-dotfiles-on-omarchy.md)が確立済みの事実(現行repoはomacom/omarchy、v4 Quattro、`~/.config`の所有境界)は再確認せず引用のみ。"
---

# Dockerエンジンをログイン時に自動起動する — OrbStack/Docker Desktop/colima(macOS)とOmarchy(Arch)、systemd --user/launchdの待ち方 調査記録

**調査日**: 2026-09-26。今日、macOSでOrbStack(手動インストール、dotfiles未管理)が起動しておらず、LiteLLM proxyのlaunchdエージェント(`until docker info; do sleep 3; done`で待つ設計)とdocker composeのPrometheus/Grafana/Open WebUIが無言で止まった。この記録は再発防止の設計判断のための一次情報を集める。前提記録[[2026-09-24-dotfiles-on-omarchy.md]]が確立済みの事実(現行Omarchy repoはomacom/omarchy、v4 Quattro)は再調査しない。

## 方法と検証凡例

- WebFetch: ページを取得し要約。GitHub issueは要約モデルが本文・状態(open/closed)・コメント者を落とすことが多かったため、途中から次の方式に切り替えた。
- `curl -A 'Mozilla/5.0' <github issue url>`でHTML全体を取得し、Reactの埋め込みJSON(`"state":`, `"stateReason":`, `"body":`, `"login":`, `"authorAssociation":`)をPython正規表現で直接抽出——GitHub issueページはこのJSONをSSRで埋め込んでいるため、これは一次情報そのもの。
- `docs.orbstack.dev`はVitePressのSSR済みHTMLをcurlで取得(JSチャンクはクライアント側フェッチに依存し空だったため、初回HTMLの`vp-doc`要素を直接使用)。
- raw.githubusercontent.comでOmarchyのシェルスクリプト全文を取得。
- 「[到達不能]」「[unverified]」は明記。

---

## 1. ベンダー(一次情報)

### 1.1 OrbStack — Settingsページの現行キー一覧(一次、docs.orbstack.dev/settings、curlでSSR HTML取得)

出典: https://docs.orbstack.dev/settings [curl、2026-09-26]

- [verbatim] 「All settings can be changed from both the command line (`orb config`) and the app (in Settings).」
- 文書化されているキーは以下のみ: `rosetta`, `memory_mib`, `cpu`, `mount_hide_shared`(System)、`network_bridge`, `network_proxy`(Network)、`ssh.expose_port`, `docker.node_name`(Advanced、「Hidden settings that can only be changed on the command line」)。
- **`app.start_at_login`はこのページに一切登場しない** — 公式Settingsドキュメントには載っていないキー。

### 1.2 OrbStack — issue #1581「Support setting "Start at login" from the CLI」(一次、GitHub埋め込みJSON直接抽出)

出典: https://github.com/orbstack/orbstack/issues/1581 [state: CLOSED, stateReason: COMPLETED, milestone: v1.9.0]

- 報告者rouge8(2024-11-14)[verbatim]: 「We want to configure OrbStack in our setup scripts to start at login without requiring developers to open the UI and check the box.」提案: `orbctl config set start_at_login true`。
- メンテナkdrag0n(Danny Lin、authorAssociation: MEMBER、2024-12-05)[verbatim]: 「Added for the next version as `orb config set app.start_at_login true`.」「What other options are missing from the CLI?」
- rouge8の返信(2024-12-05、追加要望)[verbatim]: 「Ones that I'd like to set: - Automatically download updates - (Maybe) Hide OrbStack volume. It'd also be nice if there were a way from the CLI to trigger the helper installation("Use admin privileges for enhanced features")」
- **実際に実装されたキーは`app.start_at_login`であり、issue提案時の`start_at_login`(トップレベル)ではなく`app.`名前空間に入っている**点に注意。

### 1.3 OrbStack — v1.9.0リリースノート(一次、docs.orbstack.dev/release-notes)に`app.start_at_login`の記載なし

出典: https://docs.orbstack.dev/release-notes [curl]

- v1.9.0 (December 9, 2024)の変更点一覧に、Debug Shell/証明書/SCTP/Kubernetes IPv6等は列挙されているが、**CLI設定の追加(`app.start_at_login`)は一切言及されていない** — issueコメントでの実装確認と、リリースノート・Settingsドキュメントの両方への不掲載が食い違う。**実装されたが公式ドキュメント化されなかった機能**という扱いになる。
- 参考: 過去のリリースノートにGUI版「Start on login」自体は明確に登場する。v1.7.5 (October 4, 2024)[verbatim]: 「UI: "Start on login" no longer opens a window」。より古いバージョン(バージョン番号は本文中で特定できず[gap])[verbatim]: 「Fixed service sometimes not auto-starting on login」——**GUIの「Start on login」チェックボックス自体はCLIキューの実装(2024-12)より前から存在する枯れた機能**。

### 1.4 OrbStack — issue #1767「headless Mac miniでのDocker自動起動」/ #1444「launchdでの起動」(一次、メンテナの明確な不可回答)

出典: https://github.com/orbstack/orbstack/issues/1767 [state: CLOSED, stateReason: COMPLETED]

- 報告者tao-shen(2025-02-05)[verbatim]: 「Recently, I've been using a Mac mini as a headless home server without a desktop GUI. However, every time I reboot, I have to manually start Orb Docker.」「I tried adding `orbstack.plist` to `/Library/LaunchDaemons/`, but it failed because OrbStack cannot run as root—it requires a user context.」「How can I make Docker start automatically without a desktop environment or user login?」
- kdrag0nの回答(全文)[verbatim]: 「This is not supported. See #1444」

出典: https://github.com/orbstack/orbstack/issues/1444 [state: CLOSED, stateReason: COMPLETED]

- 報告者Tazintosh(2024-09-11)[verbatim、要約]: Mac mini M1をサーバー運用、電源障害後の再起動でログイン無しにコンテナを動かしたいが、セキュリティ上autologinはしたくない。LaunchDaemonを試すと「timed out waiting for services to start」、LaunchAgentにすると「It's a User Agent, so won't work upon restart until I'm login-in」かつ起動後にターミナルからデタッチして停止できなくなる。
- kdrag0nの回答[verbatim]: 「We do plan to support launchd agents in the future, but not daemons. Daemons run as root, and there are no plans to support running OrbStack as root for security and compatibility reasons. Many modern macOS APIs are not designed to work this way.」「I'd recommend somehow starting a user session so that you can use a launchd agent instead. I believe it's possible to have agents that start in SSH sessions.」「OrbStack is designed to be used as developer tool, i.e. a standard user-level app, so this is a very rare use case for companies.」
- 反論jacopo-j[verbatim]: 「LaunchDaemons don't necessarily run as root. In fact, in OP's example, the following key causes OrbStack to run as the `company` user. `<key>UserName</key><string>company</string>`」「I would also love to see support for launching OrbStack before login.」— **この反論以降、メンテナからの追加回答は無く、「ログイン前起動」自体は未解決のまま**(issueのstateReasonはCOMPLETEDだが、これはおそらく別issue由来のクローズであり、ログイン前起動という核心の要望には応えていない)。
- **結論: OrbStackは公式に「ユーザーのログインセッションが無い状態(GUIログインなし/LaunchDaemonとしてroot実行)でのDocker自動起動」を明示的にサポートしないと表明している。** 今回のdotfilesが直面した「OrbStackが起動していない」状況は、単なる設定漏れではなく、OrbStack自体の設計上の制約(ユーザーセッションが要る)とも接続し得る。

### 1.5 Homebrewカスク(一次、formulae.brew.sh)

出典: https://formulae.brew.sh/cask/orbstack [WebFetch]

- カスクトークン: `orbstack`。インストールコマンド: `brew install --cask orbstack`。
- `auto_updates`フィールドが立っており、Homebrewの一般的な扱いでは「self-updating app」として`brew upgrade`の対象から通常スキップされる(`--greedy`または`HOMEBREW_NO_UPGRADE_AUTO_UPDATES_CASKS`関連の挙動、WebSearch要約)。
- caveats: 「Open the OrbStack app to finish setup.」(初回セットアップにGUIが要る)。
- **`orb config set app.start_at_login true`で設定した値がSparkle相当の自己更新を跨いで保持されるかどうかを直接確認した一次報告は無い**[unverified] — ただし他の`orb config`キー(`rosetta`, `memory_mib`等)も同じ設定ストアに永続化される設計であり、アプリ本体の置き換えだけでは消えないと推測するのが自然な読み筋ではある。

### 1.6 Omarchy — Docker関連インストールスクリプト(一次、raw.githubusercontent.com/omacom/omarchy)

出典: https://raw.githubusercontent.com/omacom/omarchy/master/install/omarchy-base.packages

- [verbatim、grep結果] `docker` `docker-buildx` `docker-compose` `lazydocker` `ufw-docker` — **全てbaseパッケージリストに入っている。オプトインの development パックではなく、全インストールに標準で入る**。

出典: https://raw.githubusercontent.com/omacom/omarchy/master/install/config/enable-services.sh

- [verbatim、全文の該当箇所] `systemctl enable docker.socket` — **`docker.service`ではなく`docker.socket`を有効化している**(Dockerの上流ユニットはsocket activation構成を持ち、`docker.socket`のみ有効化するとdockerdは最初のソケット接続時に起動する遅延起動になる)。
- ファイル冒頭のコメント[verbatim]: 「Enable services only. Installs are followed by reboot, so don't start/reload daemons mid-install. UFW and hardware-gated services stay in their own scripts.」

出典: https://raw.githubusercontent.com/omacom/omarchy/master/install/config/docker.sh

- [verbatim、全文] 「The Docker daemon runs as root and its socket is root-owned, so membership in the docker group is equivalent to passwordless root: any process in it can `docker run -v /:/host` and rewrite the host as root. We therefore do NOT add the install user to the docker group by default, so a single rogue process running as the user cannot silently escalate to root.」「The daemon is still enabled (docker.socket, in enable-services.sh) for system use. The Docker TUI (Super + Shift + D) and the Windows VM reach it through a polkit prompt, and the plain `docker` CLI runs under sudo. Users who want the convenience back can opt in, behind a warning, with: `omarchy-setup-security-sudoless-docker` (Setup > Security > Sudoless Docker)」

出典: https://raw.githubusercontent.com/omacom/omarchy/master/install/config/firewall.sh

- [verbatim、抜粋] 「# Allow Docker containers to use DNS on host.」直後に`ufw allow in proto udp from 172.16.0.0/12 to 172.17.0.1 port 53 comment 'allow-docker-dns'`と`192.168.0.0/16`版。
- [verbatim] 「Turn on Docker protections. ufw-docker refuses to install its after.rules block unless UFW is already active, but during ISO finalization the target chroot shares the live installer's kernel firewall.」——ISOビルド時に一時的なshim(`ufw status`をactiveと偽装する)を使って`ufw-docker install`を強制実行する仕組み。Dockerが直接iptablesを書き換えてUFWをバイパスする既知の問題への対策。
- **ログドライバの上限設定(log-driver/max-size)は`install/config`配下に見つからなかった**[gap、網羅調査ではない]。

出典: https://gist.github.com/peterberkenbosch/a5e24e2951c03a0810b1eb34cdaddb5c/ [WebFetch、二次だが一次スクリプトの内容と整合]

- 「Omarchy used to add the install user to the `docker` group. As of 4.x it does not, and an update migration removes the group from existing installs.」——**既存インストールからも自動でグループが剥奪される移行措置がある**。
- 復元コマンド: `omarchy setup security sudoless docker`(内部で`usermod -aG docker $USER`を実行、反映に再起動が要る)。

出典: https://omarchy.org/manual/development-tools/ [WebFetch、公式マニュアル]

- 「Docker installs everything needed to run it well, including Docker itself and Docker Compose.」
- 「By default your user is not in the docker group.」→ `sudo docker ps`等が必要、GUI/TUI(lazydocker、Windows VM)はpolkitプロンプト経由。

**結論(Omarchyのdockerデフォルト起動)**: パッケージは標準導入、`docker.socket`は有効化されるため次回ブート後は(socket activation経由で)実質的に自動で使えるようになる。ただし直接`docker.service`を有効化していない点と、rootless CLIアクセスがデフォルトで塞がれている点(sudoかpolkit)は、他ディストリのDocker公式手順(`systemctl enable --now docker`、`usermod -aG docker $USER`)と明確に異なるOmarchy固有の設計。

### 1.7 systemd — user unitはsystem unitに`After=`/`Requires=`できない(一次、systemd/systemd issue、メンテナ発言)

出典: https://github.com/systemd/systemd/issues/26305 [state: CLOSED, stateReason: NOT_PLANNED, #3312の重複としてクローズ]

- 報告者mrmeszaros[verbatim]: 「I have a user level timer unit that triggers a service that needs network to be online. Problem is, the `network-online.target` is a system level unit. So, now my user scoped units cannot depend on units that are inherently system level. MOREOVER, when I added `Requires=network-online.target` to the user scoped timer, and did a daemon-reload, I received NO warning whatsoever, and wondered why the timer does not activate.」——**クロススコープの依存指定はサイレントに無視される(エラーも警告も出ない)**。
- dtardon[verbatim]: 「A duplicate of #3312.」

出典: https://github.com/systemd/systemd/issues/3312 [state: OPEN、10年近く未解決]

- systemdリード開発者poettering[verbatim]: 「Note that you can invoke systemd-networks-wait-online just fine from user environment too, hence I'd recommend just invoking that」——**認めているのは`network-online`専用の狭い代替のみ**。他の投稿者adrelanos(Qubes OS)も同種の要望(`qubes-gui-agent.service`というsystem unitへの依存)を挙げているが、汎用的な解決策は提示されていない。
- 実践者dustymabe(Podman/Red Hat)[verbatim]: 「I basically would like to run podman rootless containers via the systemd --user session and have them start on bootup (by enabling linger). Some of them require network, for example doing a container build before starting the long running container on the very first boot. Currently there's no way I see other than adding a "sleep" to workaround the issue of the build systemd unit starting before networking is ready.」——**「システムスコープの準備完了を待つ必要があるuser unit」という同型の問題に対する実践者の結論が、待ちループ(sleep)の追加**。これは`docker.service`固有の議論ではないが、構造上完全に同じクラスの問題(system-scope依存をuser unitから表現できない)であり、そこでの回避策の一次証拠として扱える。

### 1.8 launchd — 依存順序キー自体が存在しない(一次、Apple公式man page)

出典: https://www.manpagez.com/man/5/launchd.plist/ [WebFetch、Apple公式man pageのミラー]

- ThrottleInterval[verbatim]: 「This key lets one override the default throttling policy imposed on jobs by launchd. The value is in seconds, and by default, jobs will not be spawned more than once every 10 seconds.」
- KeepAlive[verbatim]: 「This optional key is used to control whether your job is to be kept continuously running or to let demand and conditions control the invocation. The default is false and therefore only demand will start the job.」
- **launchd.plistのキー一覧に`After=`/`Requires=`に相当するもの(他ジョブの起動順序を宣言する仕組み)は存在しない**——KeepAlive、WatchPaths、StartInterval、StartCalendarInterval、Socketsのような「条件」はあるが、「別のlaunchdジョブの完了・準備完了を待つ」ための宣言的な口が無い、という構造そのものがベンダー文書から確認できる。

---

## 2. 実践者

### 2.1 Docker Desktopの「Start Docker Desktop when you log in」も繰り返し壊れる(一次、docker/for-mac issue)

出典: https://github.com/docker/for-mac/issues/7052 [state: OPEN]

- snowbrdngtrix[verbatim]: 「Had to downgrade back down to version 4.24.2 to resolve issue. I believe it to be the same scenario that was fixed in a prior release... Here is a snippet from the 4.17.0 release notes: > Fixed a bug that caused the Start Docker Desktop when you log in setting not to work. Fixes docker/for-mac#6723.」
- rfay[verbatim]: 「Yes, this feature no longer works after years of working. Same on arm64 and amd64. I did a factory reset and then set it to auto start, same problem.」
- jirsbek[verbatim]: 「Just updated to 4.25.1 and unfortunately this issue persists.」→ rfay「Still broken in 4.25.2」
- Docker社のcontributor bsousaa(authorAssociation: CONTRIBUTOR)[verbatim]: 「Thanks, we escalated internally and will be fixed in 4.26」→ trensen「I can confirm that updating to 4.26.0 fixes the issue for me」
- **同じクラスの不具合が4.17.0でも一度修正され(#6723)、その後4.24.2〜4.25.2で再発し4.26.0で再修正された** — GUIチェックボックスの「start at login」自体が、ベンダーが公式サポートしていてもバージョンをまたいで繰り返し壊れる負の証拠。

### 2.2 colima — start-at-loginはネイティブ機能ではなくbrew servicesのLaunchAgentに依存し、実装に苦労した経緯がある(一次、abiosoft/colima issue)

出典: https://github.com/abiosoft/colima/issues/96 [state: CLOSED, stateReason: COMPLETED]

- rfay(要望者)[verbatim]: 「People are used to Docker Desktop coming up at login. Can we add the same option with Colima? I experimented a bit with adding a service using homebrew, but wasn't successful. I think it's probably because colima is already setting up its own launchctl.」
- NickHackman[verbatim]: 「@abiosoft I have a Homebrew service that works on my machine, https://github.com/Homebrew/homebrew-core/pull/94189」→ マージ後「EDIT: it was merged, hopefully it works for everyone.」
- colima作者abiosoft(authorAssociation: OWNER)[verbatim]: 「I would say that `keep_alive` should be set to false. Colima does not stay in foreground and it can be checked with `colima status`.」
- carlocab[verbatim]: 「I think we need a way to specify `LaunchOnlyOnce` in the `service` block」引用のlaunchd man page[verbatim]: 「A daemon or agent launched by launchd MUST NOT do the following in the process directly launched by launchd: Call daemon(3). Do the moral equivalent of daemon(3) by calling fork(2) and have the parent process exit(3) or _exit」
- 最終的なHomebrew serviceブロック(NickHackman提示、verbatim):
  ```ruby
  service do
    run [opt_bin/"colima", "start"]
    run_type :immediate
    keep_alive false
    launch_only_once true
    environment_variables HOME: ENV["HOME"], PATH: std_service_path_env
    error_log_path var/"log/colima.log"
    log_path var/"log/colima.log"
    working_dir ENV["HOME"]
  end
  ```
- **`brew services start colima`は結局`~/Library/LaunchAgents/homebrew.mxcl.colima.plist`を設置するLaunchAgentであり、OrbStackと同じ「ユーザーのログインセッションが要る」制約クラスに属する**——system daemonとしての無ログイン起動ではない。

出典: https://github.com/abiosoft/colima/issues/960 [state: OPEN、未解決のまま継続]

- lfuelling[verbatim]: 「The output of `brew install colima` outputs the following: To start colima now and restart at login: brew services start colima. Because of this, I'd expect that `brew services start colima` would start colima, but it doesn't seem to do so.」
- francois-beauchemin[verbatim]: 「Check the logs at /opt/homebrew/var/log/colima.log My error was that it did not found docker For some reason i needed to run `brew link docker` then the brew services worked」
- sxalexander[verbatim、plist抜粋]: 「`# ~/Library/LaunchAgents/homebrew.mxcl.colima.plis` ... `<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>` ... Oh! So, I edited the plist to add `/usr/local/bin`」
- cal-smith[verbatim]: 「Error: Failure while executing; `/bin/launchctl bootstrap gui/501 /Users/cal/Library/LaunchAgents/homebrew.mxcl.colima.plist` exited with 5.」→ `launchctl bootout`してからの再試行で解決。
- **`brew services start colima`という「1コマンドで自動起動」は、実運用では(a)PATHにdocker CLIが無いと失敗、(b)launchctlの残留状態でbootstrap自体が失敗、(c)コンテキスト切り替えのタイミング競合、という複数の失敗モードを抱えたまま2026年現在もOPENの不具合として残っている**。

### 2.3 launchdでDockerエンジンを待つ実践者パターン(一次、alexwlchan.net)

出典: https://alexwlchan.net/2023/docker-on-demand/ [WebFetch]

- パターン: `docker info`相当のチェック関数`is_docker_running`を用意 → 動いていなければ`open /Applications/Docker.app`でGUIアプリを起動 → `for i in $(seq 60); do if is_docker_running; then break; fi; sleep 1; done`という待ちループ → 元のコマンドを`"$@"`でDocker CLIに引き渡す。
- **今回のdotfilesの`until docker info; do sleep 3; done`と完全に同型のパターン**——launchdに依存順序の宣言的な口が無い(1.8節)ため、実践者は一貫してポーリングループに収束している。

---

## 3. 測定/実地(in the wild)

### 3.1 OrbStackの`app.start_at_login`は現在も存在する未公開キー(コミュニティ作成物、二次だが検証価値あり)

出典: https://raw.githubusercontent.com/bastos/skills/main/orbstack-cli/references/config.md [curl、最終コミット2026-06-18、api.github.com経由で確認]

- 「App / behavior」セクションの表[verbatim]: 「`app.start_at_login` | Launch OrbStack at login」——他に`setup.use_admin`「Allow admin/sudo prompts during setup (set false for headless/CI)」、`app.wait_for_container_stop`、`power.pause_in_sleep`、`data_allow_backup`等、**docs.orbstack.dev/settingsには一切載っていないキー群が多数実在する**ことが確認できる。
- **含意**: OrbStackの`orb config show`が返す実際のキー空間は公式Settingsドキュメントより大幅に広く、`app.start_at_login`は2024-12の実装から少なくとも2026-06時点まで存在し続けている——ただしこれはコミュニティ制作物であり、OrbStack社自身が現在も文書化していない事実(1.1節、1.3節)と合わせて「動くが公式には保証されていない設定」という位置づけになる。

### 3.2 Homebrew casks — `auto_updates: true`と`brew upgrade`の関係(二次情報、WebSearch要約)

- 「Casks for self-updating apps declare auto_updates true, and the default `brew upgrade` includes the cask when the installed app appears older and skips it when the installed app appears to be the same version or newer.」——OrbStackのカスクは自己更新(Sparkle相当)を前提にHomebrew側が二重更新を避ける設計になっている、という一般論。OrbStack固有の実測(config永続化の検証)には未到達[unverified、frontmatter既出]。

---

## 否定側の証拠(明示)

- **OrbStackは「ログインセッション無し(GUIログインなし)でのDocker自動起動」を公式に非サポートと表明している**(kdrag0n、issue #1767「This is not supported」、issue #1444「there are no plans to support running OrbStack as root」)——今回起きた「OrbStackが起動しておらず全部止まった」という事故は、単なる設定漏れの再発防止では完全には潰せない構造的リスクである可能性がある。
- **`app.start_at_login`は実装されているが公式ドキュメント(Settings、v1.9.0リリースノート)のどちらにも記載が無い**——2026年現在もこの状態が続いている(コミュニティ作成の3.1節資料が唯一の現行キー一覧)。
- **Docker Desktopのネイティブ「start at login」チェックボックスも、ベンダー実装であるにも関わらず複数バージョンにわたって繰り返し壊れている**(#6723→4.17.0で修正→4.24.2〜4.25.2で再発→4.26.0で再修正)。
- **colimaの`brew services start colima`は「1コマンドで自動起動」という触れ込みに反し、PATH/launchctl残留状態/コンテキスト切り替えタイミングの3系統の失敗モードを抱えたまま2026年現在もOPENのissueとして残る**(#960)。
- **systemd --userユニットは他のsystemユニットへの依存をサイレントに無視する**(エラーも警告も出ずタイマーが発火しないだけ)——systemdリード開発者poetteringは汎用解決を明確に却下し、network専用の狭い代替のみ認めている(2016年のissue #3312が2026年現在もOPENのまま)。
- **launchdには依存順序を宣言する仕組み自体が存在しない**(Apple公式man page確認)——「別のジョブの完了を待つ」機能はKeepAlive/ThrottleIntervalを含めどのキーにも無く、実践者は例外なくポーリングループに頼っている。

---

## 確認できなかったこと(前例なし・未検証)

- `orb config set app.start_at_login true`がOrbStackの自己更新(Sparkle相当、Homebrewの外)を跨いで維持されることを直接検証した一次報告
- `app.start_at_login`の変更が`orb stop && orb start`無しに即座に反映されるかどうかの一次(vendor)確認
- Omarchyの`docker.socket`のみ有効化(`docker.service`は有効化しない)という構成で、初回`docker info`呼び出しからdockerdが完全に応答可能になるまでの実測レイテンシ
- Omarchyのdocker関連スクリプトにログドライバ上限(log-driver/max-size)設定が本当に一切無いか(網羅調査ではない)
- OrbStackのコミュニティ製CLIリファレンス(bastos/skills)記載のキー空間が、OrbStack社自身によって現在(2026-09)も同じ挙動で維持されていることの一次確認

---

## 結論(平易な言葉で)

**問い1(OrbStackのstart at login)**: GUIのチェックボックスは2024年より前からある枯れた機能だが、CLIから触れる`orb config set app.start_at_login true`は2024年12月にメンテナが「次のバージョンで追加した」と明言した機能で、**公式ドキュメントのどこにも載っていない**——動くが「隠れた」設定という扱いになる。Homebrewカスク(`brew install --cask orbstack`)自体は素直だが、OrbStackはアプリの自己更新を独自に行うため、Homebrewの通常の`brew upgrade`はデフォルトで手を出さない設計になっている。**それよりも重い事実は、OrbStackが「ログインしていない状態(LaunchDaemonとしてroot実行、あるいはGUIログイン無しのヘッドレスMac)での自動起動」を明確に非サポートだと公言していること**——今回のdotfilesが求める「Docker常駐サービスが常に動いている」という前提と、OrbStackの設計そのものの間に緊張関係がある。

**問い2(比較対象)**: Docker Desktopのネイティブなstart-at-login機能も、colimaの`brew services`頼みの自動起動も、どちらも「ベンダー/コミュニティが提供する自動起動手段自体が壊れたり複雑な失敗モードを抱えたりする」という同じ弱点を持つ。OrbStackだけが特別に脆いわけではなく、macOS上でDockerエンジンをログイン時に確実に立ち上げるという課題自体が業界的に枯れていない。

**問い3(Omarchy)**: DockerはOmarchyの標準パッケージセットに最初から入っており、`docker.socket`の有効化によって次回ブート後は使える状態になる。ただし4.x以降はセキュリティ上の理由でユーザーをdockerグループに入れない設計に変わっており(オプトインスクリプトあり)、これを知らずに`docker`コマンドを直接叩くと権限エラーに驚くことになる。ログ上限などの追加設定は見つからなかった。

**問い4・5(systemd --user / launchdの待ち方)**: 両OSとも、依存対象(Dockerエンジン)の準備完了をユニット/ジョブの宣言だけで待つ仕組みは存在しない——systemdはスコープをまたぐ依存をサイレントに無視し、launchdにはそもそも依存順序のキー自体が無い。両陣営の実践者が独立に同じ結論(ポーリングの待ちループを自分で書く)に達しており、今回のdotfilesの`until docker info; do sleep 3; done`は、業界の標準的な回避策と型が一致している——この部分の設計は間違っていない。問題は「待つ相手(Dockerエンジン)がそもそも自動で起動しない」という上流側にある。
