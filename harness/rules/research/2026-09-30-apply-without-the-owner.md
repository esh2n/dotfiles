# 持ち主が`make up`/`git pull`を手でやらずに済ませる業界実態調査

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）

- `harness/rules/decisions/2026-09-24-dotfiles-nix-only-roles-symlink.md`: 毎日編集する設定は repo への `mkOutOfStoreSymlink`、`make up` が install/update 共通の唯一の入口（冪等）。
- `harness/rules/decisions/2026-09-22-box-shape.md`: 日常は host モード（ハーネス自前のサンドボックス + jig のガード）。容れ物は無人・並列時のみ。
- `harness/rules/decisions/2026-09-24-main-push-allowed-repos-in-owner-policy.md`: main への push は既定 forbid、持ち主が `~/.config/jig/policy/main-push-allowed` に列挙したリポジトリだけ免除。
- `harness/rules/decisions/2026-09-27-one-worktree-layout.md`: 隔離が要るときは全ハーネス共通で `.claude/worktrees/<名前>` にブランチ付き worktree。合流(`git merge --no-ff`)は持ち主が決めたときだけ、自動マージはしない。
- コード読み取りで確定した事実（本調査の対象コードそのものであり「証拠」としては扱わないが、質問の前提を絞るために記録する）:
  - `pkgs/dotctl/internal/up/up.go` の `switchDarwin`: `nix build`（無権限）の後、root が要るのは `sudo -H nix-env -p /nix/var/nix/profiles/system --set <path>` と `sudo -H <path>/activate` の2回だけ。Homebrew・tap信頼・`/etc/bashrc`退避（初回のみ）は無権限または一度きり。
  - Linux（Omarchy, standalone home-manager）側の `home-manager switch` 自体は sudo 不要。GPUドライバ設定・ufw穴あけ・dockerグループ加入は sudo が要るが、マーカーファイルで一度だけに絞られ、dockerグループは自動加入せず案内するだけ。
  - `harness/policy/sandbox.json` / `harness/jig/src/domain/claude/sandbox.ts`: host モードの Claude Code サンドボックスは `failIfUnavailable: true`、`allowUnsandboxedCommands: false` — エージェントは失敗したコマンドをサンドボックス外で再試行できない。
- `harness/rules/research/INDEX.md` と `harness/rules/knowledge/INDEX.md` を確認したが、この質問（自動適用・GitOps・sudoers 委譲・worktree symlink 鮮度）に直接該当する既存の調査・knowledge はなかった。

---

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl`でベンダーの生ドキュメント/README/Issue/PRを取得し原文を引用した |
| [要約経由] | `WebFetch`（AIによる要約）を通した。原文全体は見ていない |
| [到達不能] | 試みたが到達できなかった |
| [測定なし] | ソース自体に数値が無い |

**制約**: このセッションはタスク開始時点で既に WebSearch 予算を使い切っていた（200/200、前のセッションから持ち越し）。そのため本調査は横断検索エンジンを一度も使えず、以下で代替した:
- `curl` + `allowed_domains` 経由の `api.github.com`（リポジトリ検索・issue/PR検索・生ファイル取得）。`gh` CLI はこの環境でキーチェーンのトークンが無効化されており使用不能（`gh auth status` で確認、認証情報の読み出し操作はしていない）。
- HN Algolia API（`hn.algolia.com`）。
- Zenn の `/api/articles` は `q` パラメータを無視して最新記事を返すのみで、全文検索としては機能しなかった（`/api/search-articles` は JS 描画のシェルを返すのみ）[到達不能]。
- `sourcegraph.com` の検索結果ページは JS 描画で `WebFetch` では内容を取得できなかった[到達不能]。
- `grep.app` の API は Vercel の bot チャレンジ（HTTP 429 + `x-vercel-mitigated: challenge`）で拒否された[到達不能]。
- DuckDuckGo HTML版は CAPTCHA（アヒル選択式）を返し検索結果に到達できなかった[到達不能]。

結果として、実践者の声は「GitHub上で見つかる個人リポジトリ・issue・PR」に限定されている。ブログ記事・Reddit・Discourse等への到達はできていない。

---

## 2. ベンダー（vendors）

### 2.1 nix-darwin: `darwin-rebuild switch` の sudo 要件は変わっていない

一次ソース: [直接] `github.com/nix-darwin/nix-darwin` issue #165「Avoid typing password on `darwin-rebuild switch`」（2019-10-03開設、2023-07-15クローズ、コメントは2025-03-11まで続く）。

- issueのタイトルと全コメントの前提が「`sudo darwin-rebuild switch` は現状の標準操作である」ことを裏付けている。この issue 自体が「sudo入力を避けたい」という要望であり、2025年時点のコメント（askielboe, 2025-03-11）まで途切れずに続いていることから、2025年になっても解決されていない恒常的な性質の要件だと確認できる。
- 2026年時点の一次ドキュメント（`nix-darwin.github.io/nix-darwin/manual`）は `WebFetch` の要約経由でしか読めず、home直下のインストール手順ページ自体には到達できなかった[到達不能]。ただし options リファレンスページの要約に「activation "runs under sudo"」という記述があった[要約経由]。

### 2.2 nix-darwin に `system.autoUpgrade` 相当が存在しない

一次ソース: [直接] `github.com/nix-darwin/nix-darwin` issue #1665「Automated updates similar to `system.autoUpgrade`」、PR #1682「feat(autoUpgrade): add system.autoUpgrade in nix-darwin」。

- issue #1665（2025-12-22開設、open）本文:
  > "To keep the nixos/infra macs in sync with the repo it would be great to have a module like `system.autoUpgrade`... that can update regularly by rebuilding nix-darwin against config originating from a flake ref."
  - コメント（booxter, 2026-01-21）: "This launchd snippet seems to do what is needed here... Not sure we could keep the same interface for nixos and darwin because the former is using systemd specific dates." — 自分の個人リポジトリのPRを解決策として提示している（§3.1で詳述）。
- PR #1682（2026-01-26開設、`mergeable_state: unstable`、直近更新は2026-02-04）は **調査時点(2026-09-30)でまだopenかつマージされておらず、約8ヶ月間停滞している**。
- 結論: nix-darwin には NixOS の `system.autoUpgrade`（vendor: `search.nixos.org/options?query=system.autoUpgrade`）に相当する一次機能が存在しない。欲しい人はDIYのlaunchdタイマーを自分で書くのが現状の実態。

### 2.3 home-manager standalone: sudo は不要

一次ソース: [直接] `raw.githubusercontent.com/nix-community/home-manager/master/docs/manual/installation/standalone.md`。

> "Make sure that your user is able to build and install Nix packages. For example, you should be able to successfully run a command like `nix-instantiate '<nixpkgs>' -A hello` without having to switch to the root user."

standalone home-manager（このリポジトリのOmarchy/Linux側）は`allowed-users`等のユーザーレベル設定さえ整っていれば、`home-manager switch` 自体にsudoは要らない。これは§0で確認した本リポジトリの実測（`switchDarwin`にだけ`sudo`が2回あり、Linux側の`home-manager switch`には無い）と整合する、独立したベンダー確認である。

### 2.4 comin — GitOps pull型デプロイ、NixOS+nix-darwinはカバー、standalone home-managerは未カバー

一次ソース: [直接] `github.com/nlewo/comin`（readme.md、docs/howtos.md、docs/features.md、docs/release-notes.md、flake.nixをcurlで直接取得）。GitHub API: `api.github.com/repos/nlewo/comin`（stars 1041、forks 66、open issues 46、pushed_at 2026-09-28T12:46:53Z、created 2022-12-10、archived: false）。

- 本質: readme.md
  > "**comin** is a NixOS deployment tool operating in pull mode. Running as a systemd service on NixOS machines, it periodically pulls the Git repository containing the NixOS configuration associated to the machine."
  > "This enables a systemd service, which periodically pulls the `main` branch of the repository and deploys the NixOS configuration corresponding to the machine hostname" — デフォルト60秒ポーリング。
- **nix-darwinサポートは実装済み**（flake.nix）:
  > `darwinModules.comin = nixpkgs.lib.modules.importApply ./nix/darwin-module.nix { inherit self; };`
  docs/howtos.md:
  > "When comin is running on a Darwin system, it automatically builds and deploys a configuration found in the flake output `darwinConfigurations.hostname`. So, you only need to set this flake output and run comin on the target machine."
- **standalone home-managerサポートは未実装、issue #11が2024-03-08開設のままopen**（最新コメント2025-07-13）。メンテナ本人(nlewo)のコメント:
  > "I think we should consider adding configuration to allow comin running a Home Manager switch to configuration instead of NixOS switch to configuration. This implies a comin instance would not be able to support both NixOS and Home manager simultaneously."
  最新コメント(nlewo, 2025-07-13):
  > "Note the nix-darwin support has been implemented in #89. This could be a good start for a home-manager implementation." — 「まだ着手されていない」ことを示唆する言い方で止まっている。
  - **結論: comin は本リポジトリのOmarchy(standalone home-manager)側の要件をカバーできない。** macOS側だけをカバーする部分解になる。
- 安全機構（docs/howtos.md）: GPG/SSH commit署名検証（
  > "If `services.comin.gpgPublicKeyPaths != []`... comin only evaluates commits signed by a configured commit-signing trust source."）、`testing-<hostname>`ブランチでの事前検証、`machineId`によるマシン取り違え防止。
- **fast-forward-onlyの設計がコミット選択アルゴリズムに組み込まれている**（docs/design.md）:
  > "The comin goal is to refuse commits push-forced to `main` branches / only allow `testing` branches on top of `main` branches / prefer commits from `testing` branches"
  - これは§3.3で見つけた実践者(gapuchi)が独自に後付けした「fast-forward-only」ガードと**同じ設計判断に収束している**点が重要（vendorと実践者の二方向からの一致）。
- darwin対応の成熟度に関する負の証拠: closed issue #125「bug on darwin: "transport: Error while dialing: dial unix /var/lib/comin/grpc.sock: connect: connection refused"」、closed PR #121「Fix darwin daemon startup order on macOS restart」、closed PR #100「darwin: Ensure comin service is running after activation」— nix-darwin対応は後発で、再起動順序やソケット接続といった実運用上のバグが複数報告・修正された経緯がある。

### 2.5 deploy-rs / colmena — push型フリートデプロイ、darwin対応は非対称

一次ソース: [直接] `api.github.com/repos/serokell/deploy-rs`（stars 2345、pushed 2026-09-28、open issues 134、archived: false）、`api.github.com/repos/nix-community/colmena`（stars 2375、pushed 2026-09-29、archived: false、maintainers=@stepbrobd, @NickCao, @zhaofengli）、READMEをraw取得。

- deploy-rs README:
  > "`activate.darwin <darwinConfiguration>` — activate a nix-darwin system." — nix-darwinアクティベーションを明示サポート。
  - ただし**darwin対応は未成熟**な兆候: issue #259「darwin -> darwin doesn't invoke user activation script」(open)、issue #167「Support deploying from macOS without configuring remote builders」(open)、issue #216「deploy from darwin to nixos and vice versa」(open) — いずれも未解決のdarwin関連issue。
  - **push型の本質的な限界**: deploy-rsもcolmenaも「制御用マシンから対象マシンへSSHで`deploy`/`colmena apply`を実行する」モデルであり、「誰か（人間 or CI）がコマンドを叩く」という一手間は消えない。GitOpsのpull型（comin）とは根本的に別のモデルで、push型単体では「持ち主が何もしなくて良い」を満たさない。CIから起動する構成にすれば満たせるが、それは§2.6のリスクを引き受けることになる。
- colmena README（raw取得）には`darwin`/`macos`の言及がゼロ[測定なし] — NixOS専用である可能性が高いが、READMEの沈黙のみからの推測であり明示の非対応表明は見つけられなかった[unverified]。

### 2.6 GitHub self-hosted runner — vendor自身の警告

一次ソース: [要約経由] `docs.github.com/en/actions/security-guides/security-hardening-for-github-actions`。

> "Self-hosted runners should almost never be used for public repositories on GitHub, because any user can open pull requests against the repository and compromise the environment."
> "Be cautious when using self-hosted runners on private or internal repositories, as anyone who can fork the repository and open a pull request (generally those with read access to the repository) are able to compromise the self-hosted runner environment, including gaining access to secrets and the GITHUB_TOKEN."

「持ち主のMac上にself-hosted runnerを常駐させ、mainへのpushをトリガに`make up`を実行させる」という設計を検討する場合、この警告がそのまま当てはまる——リポジトリへの書き込み権限を持つ主体（このリポジトリではAIエージェントも該当する）が、事実上runner環境（=持ち主のMac、sudoまで含む）を制御できることになる。

---

## 3. 実践者（practitioners）

### 3.1 booxter — 個人nix-darwin設定、launchd LaunchDaemonで週次自動適用

一次ソース: [直接] `github.com/booxter/nix` PR #90「darwin: add autoUpgrade-like launchd service」のdiff（`github.com/booxter/nix/pull/90.diff`）。nix-darwin issue #1665へのコメントとして自ら提示。

diffの中身（`darwin/default.nix`への追加）:
```nix
# To trigger manually,
# sudo launchctl kickstart -k system/org.nixos.nix-auto-upgrade
launchd.daemons.nix-auto-upgrade = {
  serviceConfig = {
    ProgramArguments = [
      "${pkgs.nix}/bin/nix" "run" "nix-darwin" "--" "switch"
      "--flake" "github:booxter/nix#${hostname}" "-L" "--show-trace"
    ];
    StartCalendarInterval = { Weekday = 6; Hour = 3; Minute = 0; }; # 毎週土曜3時
    StandardOutPath = "/var/log/nix-auto-upgrade.log";
    StandardErrorPath = "/var/log/nix-auto-upgrade.log";
  };
};
```
- `launchd.daemons.*`（nix-darwinの用語でLaunchDaemon、root権限で動作）として登録するため、実行時に別途sudoを要求しない——**LaunchDaemon自体はインストール時（nix-darwin activation、一度きり）にrootへ昇格し、以降は最初からroot権限のシステムサービスとして動く**という形で、「ユーザーセッションにNOPASSWD sudoを渡す」問題を回避している。
- 一方で `--flake github:booxter/nix#${hostname}` は**ローカルのgit checkoutではなくGitHub上のflake参照を直接fetchする**設計で、署名検証・レビューゲート・fast-forward確認は一切ない。mainブランチに何を push しても、土曜3時に無条件でroot権限で適用される。
- この人物（booxter, 実名ではないがGitHubの実アカウント、コミット履歴からIhar Hrachyshka名義であることが確認できるプロフィール記載あり[unverified、プロフィール自己申告の域]）は、OpenStack等のクラウドインフラ分野で継続的にコミットしているアカウントである。

### 3.2 edrobertsrayne — 実測インシデント: `system.autoUpgrade`のOOM Kill

一次ソース: [直接] `github.com/edrobertsrayne/nix-config` issue #218「thor: nightly auto-upgrade OOM-killed, nix-daemon left failed」（2026-09-21開設、open——本調査の9日前）。

> "At 04:43–04:48 UTC on 2026-09-21, thor's nightly `nixos-upgrade.service` run (`system.autoUpgrade`, `modules/nix.nix`) was OOM-killed, which took `nix-daemon.service` down with it (signal KILL). Both units are left in `failed` state"
> `journalctl` からの引用: "Mem peak: 14.9G (swap: 686.1M) ... nixos-upgrade.service: The kernel OOM killer killed some processes in this unit."
> "The auto-upgrade is silent-failure-prone: nothing currently alerts on `nixos-upgrade.service` failing specifically"
> "`nix-daemon.service` staying `failed` after the OOM means any interactive `nix` commands from a logged-in session may fail until the socket-activated respawn kicks in or someone runs `systemctl reset-failed nix-daemon`."

このケースは「たまたまflake.lockの更新だけで実害が軽かった」("low stakes this time, but won't always be" と本人が明記)が、**自動適用が失敗したことに気づく仕組みが無かった**ことをそのまま認めている点が重要。これはNixOSの`system.autoUpgrade`（vendor機能）の実例であり、nix-darwinにこの機能が無いこと(§2.2)とは別に、「機能があっても無監視で運用すると壊れる」という独立した負の証拠になる。

### 3.3 gapuchi — AIエージェント(Cursor)自身が書いたPRで fast-forward-only ガードを追加

一次ソース: [直接] `github.com/gapuchi/nix` PR #13「Guard calculus auto-deploy to fast-forward only」（open）。PR本文に`<!-- CURSOR_AGENT_PR_BODY_BEGIN -->`マーカーがあり、Cursorのコーディングエージェントが生成したPRであることが本文構造から確認できる。

> "Auto-deploy on `calculus` used `system.autoUpgrade`, which switches to whatever the floating `calculus` tag points at every 5 minutes. A local `nixos-rebuild switch` while testing gets overwritten on the next tick. That's why `calculusDeploy` was commented out on the host."
> 修正: "Keep `system.autoUpgrade`... The fast-forward rule is not an auto-upgrade option, so it is an `ExecCondition` on `nixos-upgrade`: Exit 0 only when the running revision is a strict ancestor of the `calculus` tag... Exit 1 when the running build is local/dirty... Exit 255 if fetching the tag fails."

これは本調査のlens 4（「AIエージェント実践者がこの問題をどう扱っているか」）に対して見つかった**唯一の直接的な一次資料**である。ブログ記事のような一人称の語りではなく、AIエージェント自身が生成したPRという形だが、次の点で強い関連性がある:
- 「自動適用が持ち主の意図しないタイミングで既存の作業を上書きする」という失敗モードは、まさに本調査の質問（持ち主が手でpull/applyしなくて良いようにする）の裏返しのリスクである。
- 解決の型（fast-forward-onlyガード、systemdのExecConditionで終了コードによりskip/failを区別）が、**comin自身のコミット選択アルゴリズム(§2.4)が最初から組み込んでいる設計と独立に一致**している——vendorと実践例（しかもAIエージェント生成コード）の二方向から同じ結論に収束している点は、単一の逸話ではなく重み付けできる証拠である。

### 3.4 nix-darwin issue #165 コメント欄 — sudoers委譲への否定的実践者証言

一次ソース: [直接] 前掲issue #165のコメント（§2.1参照）。

- lilyball（2021-04-29、メンテナ寄りの立場からの技術的批判）:
  > "This seems like a fantastic way to hand root access to every process running on your user account."
  > "You don't require a password already to edit the darwin config file (at least not in the default setup)... so no password required to do `sudo darwin-rebuild` would allow any process running as your user to stuff bad stuff into the darwin config and then apply it to the system, which means they can just run arbitrary stuff as root."
  > "`sudo ln` not requiring a password means they can e.g. symlink a system LaunchDaemon to point at whatever they want. And `sudo launchctl` is literally just handing over complete control... If you're going to remove password requirements for any of these commands, you may as well just remove the password requirement entirely for the user."
- andreykaipov（同issue、2021-04-29、自らNOPASSWD設定を提案した後に前言撤回）:
  > "For what it's worth, I've since moved away from nix-darwin, and now run a non-daemon install of Nix, only really using Nix as just a package manager for myself."
  — 「試して、やめた」の一人称証言。
- 収束した代替解（友好度は高いが別解）: Touch ID経由のsudo認証。XA21X（2022-09-24）とaskielboe（2025-03-11、2025年時点での最新コメント）:
  > "pam_tid.so is available as a nix-darwin config" → `security.pam.services.sudo_local.touchIdAuth`（2025年にオプション名がリネームされたことまで追跡されている）。
  - ただしTouch IDは**人間が物理的にその場にいてセンサーに触れる必要がある**ため、パスワード入力の手間は消すが「持ち主が何もしなくて良い」は満たさない——無人自動適用の代替にはならない。

---

## 4. 測定された証拠（measured evidence）

この主題（個人インフラのGitOps適用パターン）はベンチマーク・論文の対象になるタスク種別ではなく、査読済み研究や標準化されたベンチマークは**見つからなかった**[測定なし]。ここでの「測定された証拠」は、issue/PRに現れた実測の数値・日付のみである。

- comin: stars 1041、forks 66、open issues 46、直近push 2026-09-28（調査時点の2日前）。
- deploy-rs: stars 2345、open issues 134、直近push 2026-09-28。
- colmena: stars 2375、直近push 2026-09-29。
- nix-darwin PR #1682（autoUpgrade追加）: 開設2026-01-26、最終更新2026-02-04、調査時点(2026-09-30)で**約8ヶ月マージされず停滞**。
- edrobertsrayne #218のOOM実測値: メモリピーク14.9G（swap 686.1M）、障害発生04:43–04:48 UTC。
- HN Algolia検索「comin nixos gitops」: ヒットは1件のみ、"Comin: GitOps for NixOS Machines" (2024-11-05投稿)、**points=2** — starの多さに比べてHN上の可視性・議論は非常に薄い[unverified、推測に留める。starの大半がNixOSコミュニティ内部の共有経由である可能性が高いが未確認]。

---

## 5. 実態（in the wild）— 公開リポジトリの採用状況

[直接] すべて`curl` + `api.github.com`。

| 検索クエリ | ヒット数 | 特記事項 |
|---|---|---|
| `nix-darwin/nix-darwin` issue検索 `sudo auto` | 11件 | #603, #1625等ヒットしたが直接関連は少ない |
| `nix-darwin/nix-darwin` issue検索 `NOPASSWD` | 3件 | #165が本題そのもの |
| `nix-darwin/nix-darwin` issue検索 `autoUpgrade` | 3件 | #1665(open)、PR #1682(open、停滞)、無関係1件 |
| `nlewo/comin` issue検索 `darwin` | 11件 | #11(Home Manager未対応、open)、#89/#100/#116/#118/#121/#125(darwin対応関連、大半closed) |
| `nlewo/comin` issue検索 `broke\|bricked\|lockout\|locked out` | 18件 | 直接のロックアウト報告はヒットせず、関連issueが雑多にヒットしただけ |
| リポジトリ横断 `nixos system.autoUpgrade broke\|bricked` | 241件 | edrobertsrayne/nix-config#218、gapuchi/nix#13等の実例を含む |
| `deploy-rs/deploy-rs` issue検索 `darwin` | 29件 | #259/#167/#216など darwin固有の未解決issueが複数 |
| リポジトリ検索 `nix-darwin self-hosted runner` | 2件 | juspay/github-nix-ci（109 stars、CIランナー用途でapply用途ではない） |
| リポジトリ検索 `dotfiles auto-update service nix` | 0件 | ヒットなし |
| リポジトリ検索 `nix-darwin watch auto-apply/auto-switch` | 0件 | ヒットなし |
| リポジトリ検索 `nix-darwin post-merge hook dotfiles` | 0件 | ヒットなし |
| リポジトリ検索 `comin nixos gitops`（stars順） | 2件 | nlewo/comin本体のみが実質的な結果 |

**この検索結果全体から言えること**: 「pushだけで持ち主のMac/Linux機に自動適用される」を単体で満たす個人向けオープンソース実装は、GitHub検索で見つかった範囲では comin 一択に近く、その comin もLinux(standalone home-manager)側は未対応。DIY launchd タイマー（booxter）や DIY systemd ExecCondition ガード（gapuchi、AIエージェント生成）は個人リポジトリの中に埋め込まれた一点物で、汎用ツールとして公開・共有されているものは見つからなかった。

---

## 6. 比較表

| ソース | 種別 | 対象タスク | 結果・数値 | コスト数値 | 既知の失敗モード |
|---|---|---|---|---|---|
| nix-darwin issue #165 [直接] | ベンダー(issue) | sudo要件 | `sudo darwin-rebuild switch`が現状の標準、2019年開設〜2025年まで未解決の要望として継続 | — | NOPASSWD化は事実上のroot付与（lilyball指摘） |
| nix-darwin issue #1665 / PR #1682 [直接] | ベンダー | autoUpgrade同等機能 | issue open(2025-12-22〜)、PR open(2026-01-26〜、8ヶ月停滞) | — | 未実装のため誰もが独自DIYを書いている |
| home-manager standalone docs [直接] | ベンダー | sudo要件 | "without having to switch to the root user" | — | — |
| comin readme/howtos/flake.nix [直接] | ベンダー | pull型GitOps | darwin対応あり(`darwinModules.comin`)、60秒ポーリング、GPG/SSH署名検証、fast-forward-only設計 | — | standalone home-manager未対応(#11, 2024-03-08〜open)。darwin対応初期は再起動順序等の実バグ(#121, #125) |
| deploy-rs README/issues [直接] | ベンダー | push型デプロイ | `activate.darwin`明記、star 2345 | — | darwin固有の未解決issue複数(#259, #167, #216) |
| colmena README [直接] | ベンダー | push型デプロイ | darwin言及ゼロ | — | macOS対応不明[測定なし] |
| GitHub Actions security docs [要約経由] | ベンダー | self-hosted runner | — | — | 「フォークしてPRを開けるユーザーはrunner環境を乗っ取れる」と明記 |
| booxter/nix PR #90 diff [直接] | 実践者 | launchd自動適用 | 毎週土曜3時、GitHubのflake refを直接fetch | — | 署名検証・レビューゲート皆無、mainへの何でも1週間以内に無条件root適用 |
| edrobertsrayne/nix-config #218 [直接] | 実践者 | system.autoUpgrade実測障害 | メモリピーク14.9G、2026-09-21 04:43-04:48 UTC | — | OOM Killでnix-daemon道連れ、無アラート（silent-failure-prone） |
| gapuchi/nix PR #13 [直接] | 実践者(AIエージェント生成) | fast-forward-onlyガード追加 | ExecConditionの終了コード0/1/255で分岐 | — | 5分毎の自動適用が持ち主のローカル未pushの変更を毎回上書きしていた |
| nix-darwin issue #165 (andreykaipov) [直接] | 実践者 | NOPASSWD撤回 | — | — | 「nix-darwinをやめ、単なるパッケージマネージャとしてのみNixを使うことにした」 |
| HN Algolia「comin」検索 [直接] | 実態 | 可視性 | ヒット1件、points=2 | — | starの多さに反してHN上の議論は薄い |
| 各種GitHubリポジトリ/issue検索(§5表) | 実態 | 採用状況 | comin以外の汎用ツールはほぼヒットなし | — | DIY実装は個人リポジトリに埋め込まれ共有されていない |

---

## 7. 何が言えて、何が言えないか

**1. 特権分割（macOSとLinuxで問題の大きさが違う）**

Linux(standalone home-manager)側は、home-manager自身のベンダー文書が「`home-manager switch`にsudoは要らない」と明記しており（§2.3）、本リポジトリの実測（`switchDarwin`にだけ2回のsudoがあり、Linux側の`home-manager switch`には無い、§0）と一致する。つまりLinux側で「持ち主が手でやらなければならない」の正体は純粋に「誰が`git pull && home-manager switch`を叩くか」というトリガーの問題であり、権限の壁は（GPU/ufw/dockerグループという一度きりの例外を除けば）最初から存在しない。

macOS側は逆で、`darwin-rebuild switch`のroot昇格はnix-darwinというツール自体の設計であり（issue #165の存在そのものがそれを裏付ける、2019年から未解決）、このリポジトリのスクリプトがどう書かれていても消せない制約である。nix-darwinには`system.autoUpgrade`のようなvendor製の自動適用機能も無い（§2.2、PRが8ヶ月停滞）。つまりmacOS側では「トリガー」と「root権限の付与」という二つの壁を両方解決する必要がある。

**2. 自動適用の仕組みは存在するが、この2プラットフォーム構成には丸ごとは当てはまらない**

comin（pull型GitOps、★1041、活発にメンテナンスされている、直近pushは2日前）は最も近い既製品だが、standalone home-managerを1年半以上未対応のまま放置している（issue #11、メンテナ自身が「darwin対応が土台になるかもしれない」とコメントしたのが最後で、それ以上進んでいない）。つまりcominを採用してもmacOS側しかカバーできず、Linux(Omarchy)側は別解が要る。

自動適用そのものが無事故ではないことも実測されている。NixOSの`system.autoUpgrade`（nix-darwinには無い機能だが、最も近い実例）で、OOM Killによりnix-daemonごと落ちてサイレントに失敗した実例（edrobertsrayne、9日前、14.9Gのメモリピーク）と、5分毎の適用が持ち主の未push作業を無条件に上書きし続けていた実例（gapuchi、AIエージェントが自ら気づいて修正）の二つが見つかった。どちらも「タイマーを仕掛けただけでは終わらない」ことを示す一次資料であり、fast-forward-onlyガードやアラートといった追加の安全策が要ることを、comin自身の設計（fast-forward-only、署名検証がデフォルトで組み込み済み）とは対照的に、DIY実装では自分で用意しなければならないことを示している。

**3. 狭いsudo委譲は「狭く」ない**

nix-darwinコミュニティ自身の議論（issue #165）が、`darwin-rebuild`/`ln`/`launchctl`だけを対象にしたNOPASSWDエントリが事実上フルのroot付与と変わらないと結論づけている。理由は二つ: (a) darwin設定ファイル自体が既定でパスワード無しに書き換えられること、(b) `launchctl`単体で任意のLaunchDaemonを仕込んで即座にrootとして実行できること。この結論を受けて実践者(andreykaipov)がnix-darwin自体をやめた一人称証言もある。コミュニティが収束した代替(Touch ID sudo)は入力の手間を消すだけで、人間がその場にいる必要は残る——「持ち主が何もしなくて良い」問題の解決にはならない。

**4. AIエージェント実践者の一人称の記録は見つからなかったが、隣接する直接証拠が一件ある**

「自分のAIコーディングエージェントがdotfiles変更をpushしたが自分では適用できないので、こうした」という一人称のブログ的記録は、本調査の到達範囲（WebSearch予算切れ、GitHub検索のみ）では見つからなかった。唯一かつ最も直接的に関連するのは、gapuchi/nix#13——AIエージェント(Cursor)自身が生成したPRで、既存の自動適用が意図しない上書きを起こしていたバグを、fast-forward-onlyガードで修正したもの。これは「一人称の語り」ではないが、AIエージェントが実際にこの種の問題（自動適用の暴走）に関与し、しかもcominのvendor設計と独立に同じ答え（fast-forward-only）にたどり着いている点で、単なる推測より重い一件の証拠である。ただし一件しかなく、「一つの逸話は一つの逸話で覆る」の原則どおり、これだけで一般化はできない。

**5. worktree/symlink鮮度問題そのものの前例は見つからなかった**

「AIエージェントがworktreeで作業し、ハーネス拡張が本チェックアウトへのsymlink経由でコードを読むため、pullするまで古いまま」という構成そのものにピンポイントで一致する外部の前例は、本調査の到達範囲では見つからなかった。最も近い、業界で確立された一般パターンはCapistranoの`releases/<timestamp>`ディレクトリ＋`current`symlinkのatomicな切り替えである——「更新中の実体を直接書き換えるのではなく、完成した新しい実体を作ってから、symlinkの向き先だけを一瞬で切り替える」という設計原則で、これは本調査で見つけた唯一の直接の技術的先例だが、あくまで一般的なデプロイパターンであり、AIエージェント・worktree・ハーネス拡張という具体的な組み合わせでの実例ではない。

---

## 8. 「前例なし」リスト（no precedent found）

- 「AIエージェントが自分のdotfiles/インフラ変更をpushしたが自分では適用できないので、こう解決した」という一人称の実践者ブログ・記事（GitHub上のAIエージェント生成PR一件(§3.3)はあるが、語りとしての記録は無い）。
- standalone home-manager（NixOSではない、macOSでもない、素のLinux上のhome-manager）向けの汎用GitOps自動適用ツール（comin issue #11が1年半以上openのまま、着手すらされていない）。
- nix-darwin自身が提供する`system.autoUpgrade`相当の一次機能（PR #1682が8ヶ月未マージ）。
- 「AIコーディングエージェントのworktree + ハーネス拡張のsymlink鮮度」という具体的な組み合わせに対する外部の設計前例。
- launchd DIYタイマー方式（booxter型）の採用実績・事故率の集計——見つかったのは実質1リポジトリの1コミットのみで、複数事例からの横断比較はできなかった。
- comin darwinModuleを実運用で使い続けている個人ユーザーの継続利用実績（GitHub検索では初期実装期のバグ報告が中心で、長期の安定運用を報告する記録は見つからなかった）。
