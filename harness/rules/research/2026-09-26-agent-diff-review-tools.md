---
question: "2026年、コーディングエージェント(Claude Code/Codex等)が加えた変更をターミナル/ローカルでレビューするのに実践者は何を使っているか。hunk(hunk.dev、Homebrew formula `hunk`)とcrit(持ち主が実際に使用、dotfilesのflake input)を比較し、他の候補(tuicr、difftastic/delta+lazygit/gitui系、diffnav、Graphite/GitHub系ローカルレビュー、Claude Code自身のレビュー機能)も含め、それぞれの機能・メンテナンス状況・macOS/Linuxインストール経路・named practitioner・既知の問題を調べ、持ち主にとってのaccepted practiceとhunkがcritに対して何を加えるかを結論する"
date: 2026-09-26
verdict: "持ち主が実際に使っているcrit(tomasz-tomczyk/crit、★1,125、ソロ開発、ブラウザUI)は同カテゴリで最大の競合plannotator(backnotprop/plannotator、★8,950、created 2025-12)とほぼ同じ守備範囲(plan/diff/HTML review、GitHub/GitLab同期、agentへのフィードバック送信)を持つが、pnpmでなくbrew/Go/Nixで配布されflake inputとして既にdotfilesに固定されている。hunk(modem-dev/hunk、★9,401、VC系企業'Modem'運営、83 contributors)はcritと同じ問題を解いていない——crit/plannotatorが『ブラウザで開いてコメントし、エージェントに戻す』プラットフォームであるのに対し、hunkは純粋なターミナルdiffビューア(watch mode、jj/sl対応、agent向けinlineノート)であり、PR/MR同期・plan review・live app reviewを持たない。hunkのREADMEの比較表自体もdelta/difftastic/diff-so-fancy/diffとしか比較しておらず、crit/plannotatorとは棲み分け(hunk.devの外部レビュー記事はhunkを『ターミナル側』、crit.mdを『ブラウザ側』の補完ペアと位置づける)。tuicr(agavra/tuicr、★3,216、Rust、6フォージへのレビュー投稿)は最もコミュニティ主導で個人実践者(Jamie Tanna)の実運用ブログが存在する唯一のツール。diffnav/delta/difftasticはdiff表示の高度化(構文diff、file tree)止まりでagentへのフィードバック送信機能を持たない。lazygit/gituiは汎用Git TUIで、diffペインにdelta/difftasticを差し込む使い方が実践者の定石(Lorenzo Bettiniの設定例)。Claude Code自体もネイティブに`/code-review`(並列レビューエージェントでbug/security/style検出)と`/diff`(ターン単位のdiff閲覧)を持つが、いずれもコミットではなくレビュー表示止まりで、crit/hunk/tuicr/plannotatorのような別プロセスのレビューUIではない。結論: 持ち主の用途(コミット前にエージェントの差分をレビューする)におけるaccepted practiceは既に導入済みのcrit(ブラウザUI＋GitHub/GitLab同期＋Claude Codeスキル`/crit`・`/crit-story`配線済み)であり、hunkはこの用途に対して機能的な上乗せを持たない——唯一の付加価値は『ブラウザを開かず純粋にターミナル内で完結する』点と『jj/Sapling読み取り専用history browser』だが、どちらもcritが解いている問題(agentへコメントを戻す)を解決しない別の道具である。"
unverified:
  - "hunkの★9,401という急成長(2026-03作成から半年)が実質的なオーガニックユーザー数を反映しているか、trendshift.ioの『#1 Repository of the Day』表示以上の裏取り(スター購入等の懸念)は見つからなかった——ただしorgがVC系スタートアップ(modem.dev、Canada、83 contributors)であることは確認済みで、疑義を示す一次情報も見つかっていない"
  - "GitHubのSearch APIによるissueソートは全文検索インデックスの反映ラグがあるため、各リポジトリの『最もコメントの多いissue』一覧が完全に最新である保証はない"
  - "modem-dev/hunkのPR #1088(『docs(release): gate Homebrew availability claims』)の本文——Search APIが該当PRを検索結果に返さず、コミットメッセージの一行のみで内容を推測している"
  - "plannotatorのnpm/インストーラの正確なパッケージ名と、Herdr Annotate以外のterminal-nativeな経路の実際の安定度"
  - "『2026年のエージェント作成PRの6割超がレビューされない』という統計はdev.to記事が404で原典に到達できず、本記録には採用していない"
sources_note: "gh CLI自体はサンドボックス内でTLS検証に失敗するため使わず、`gh auth token`で取得したトークンを`Authorization: Bearer`ヘッダに載せてapi.github.com/formulae.brew.sh/aur.archlinux.org/archlinux.org/raw.githubusercontent.comへcurlで直接あたった(allowed_domainsで都度許可)。`nix eval --inputs-from`はサンドボックスがNixデーモンソケットへの接続を`Operation not permitted`で拒否したため実行不能——nixpkgsのバージョンはNixOS/nixpkgsリポジトリの`pkgs/by-name/**/package.nix`をGitHub API/raw経由で直接読んで代替した(pinされたnixpkgs revではなくnixpkgs masterの現在値である点に注意、flakeのピン先そのものの評価はできていない)。WebSearch/WebFetchの結果は小型モデルによる要約であり逐語引用ではないため、本文中「[WebFetch要約]」と明記した箇所は要約経由と分かるようにしている。raw.githubusercontent.com/api.github.com/formulae.brew.sh/aur.archlinux.org/archlinux.orgから直接取得したテキストは一次情報として逐語引用している。"
---

# コーディングエージェントの差分をターミナル/ローカルでレビューする2026年のツール — hunk vs crit、他の候補

**調査日**: 2026-09-26。持ち主のdotfiles(`<checkout>`)は`flake.nix`で`crit = { url = "github:tomasz-tomczyk/crit"; inputs.nixpkgs.follows = "nixpkgs"; }`をinputに持ち、`lib/overlays.nix`が`crit = inputs.crit.packages.${system}.default`としてoverlayに載せ、`lib/mk-darwin.nix`と`lib/mk-linux.nix`の両方が`../home/shared/crit`をimportして`home/shared/packages/dev.nix`の`home.packages`に加えている。`home/shared/crit/crit.config.json`は`{"base_branch": "main", "notify_on_round_ready": true, "no_update_check": true}`で、`agent_cmd`は設定されていない——つまり持ち主はcritの「Send to agent」自動応答機能(`claude --dangerously-skip-permissions -p`等)は使わず、レビューUI+コメント+Claude Code側の`/crit`・`/crit-story`スキル(このセッションのskill一覧にも`crit:crit-cli`・`crit:crit-story`として実在)経由の手動往復にとどめている。本記録はここにhunkが加える価値があるかを問う。

## 方法と検証凡例

- 一次情報: `raw.githubusercontent.com`から取得した各リポジトリのREADME全文、`api.github.com`(REST/Search API、`Authorization: Bearer $(gh auth token)`)から取得した構造化データ(repo/releases/issues/commits/contributors)、`formulae.brew.sh`・`aur.archlinux.org`・`archlinux.org`のパッケージAPI。
- WebSearch/WebFetchは小型モデルによる要約であり逐語引用ではない。本文中「[WebFetch要約]」と明記した箇所がそれにあたる。
- 到達不能・未検証は「[unverified]」と明記。

---

## 1. crit(持ち主が実際に使っているツール)

出典: https://raw.githubusercontent.com/tomasz-tomczyk/crit/main/README.md [raw取得、逐語引用]

> "Review and comment on plans, code diffs, frontend elements and send feedback directly to your agent."

> "`crit plan.md` renders a markdown file with proper formatting and review UI / `crit` auto-detects git changes and shows syntax-highlighted diffs for local review. / `crit http://localhost:3000` proxies your running app and adds a review interface to it / `crit landing.html` renders a static HTML artifact to review"

- ブラウザベースのローカルサーバー(`127.0.0.1`既定、`--allow-unauthenticated-network`なしでは非loopback bind不可)。diff/plan/live app/静的HTMLの4種類のレビューUIを持つ唯一のツール。
- GitHub PR・GitLab MRとの双方向同期(`crit pull`/`crit push`、`gh`/`glab`のCLI認証を利用)、story mode(`crit story`、大きな差分をLLMでチャプター化——README曰く「complex PRs (~20–50 files, ~2k–5k lines) land around $1–$1.40 with Claude Opus 5」という自己申告のコスト目安つき)。
- `crit comment src/auth.go:42 'Missing null check'`のようにagentがブラウザを開かずコメントを追加できるプログラム的インターフェースを持つ——これはこのセッションで読み込まれた`crit:crit-cli`スキルが使う経路そのもの。
- メンテナンス: 出典 https://api.github.com/repos/tomasz-tomczyk/crit [API直接取得] — `stargazers_count: 1125`、`pushed_at: "2026-09-25T21:31:05Z"`(前日)、`open_issues_count: 12`、`license: MIT`、`created_at: "2026-02-16"`。最新リリース`v0.20.3`(2026-09-24公開)。contributors 47人中`tomasz-tomczyk`が800コミットでほぼソロ運営(`dependabot[bot]`42、`hermes-tomczyk`8が続く)。
- インストール: macOS/Linuxとも`brew install crit`(formulae.brew.sh確認済み、`versions: {'stable': '0.20.3', ...}`)、Go(`go install github.com/tomasz-tomczyk/crit/cmd/crit@latest`)、Nix(`nix profile install github:tomasz-tomczyk/crit`、持ち主のflakeもこれと同じ`packages.default`を叩いている)。**nixpkgs本体には存在しない**(`pkgs/by-name/cr/crit/package.nix`をAPIで問い合わせ`Not Found`)——これが持ち主がnixpkgsでなくflake inputでcritを引いている理由と整合する。AURにも存在しない(`crit-bin`という名前衝突パッケージはあるが「Rust cross-compiler」という無関係なツール)。
- 既知の問題(負の証拠): 出典 https://api.github.com/search/issues?q=repo:tomasz-tomczyk/crit [API直接取得]
  - issue #899(open, 11 comments)「when reviewing an MR, hitting "finish review" instructs the agent to make the changes」— MRレビュー中に意図しない動作をagentに指示してしまう未解決バグ。
  - issue #953(open, 10 comments)「Feature: quick annotation actions for text selections」— 選択範囲への定型アクションが未実装という要望。
  - `agent_cmd`をFinish時に自動でagentへ送る「Send to agent」機能はグローバル設定でしか有効化できない(READMEが明記: "Project-level `.crit.config.json` files cannot set it. This prevents a malicious repository from executing arbitrary commands")——裏を返せば`claude --dangerously-skip-permissions -p`を使うと悪意あるコメント文字列がagentへの実質的なプロンプトインジェクション経路になり得る、という設計上のトレードオフをREADME自身が認めている。持ち主の`crit.config.json`はこの機能自体を使っていないため実害範囲外。

## 2. hunk(質問が名指しした比較対象)

出典: https://raw.githubusercontent.com/modem-dev/hunk/main/README.md [raw取得、逐語引用]

> "Hunk is a review-first terminal diff viewer for agent-authored changesets, built on OpenTUI and Pierre diffs."

> "multi-file review stream with sidebar navigation / inline AI and agent annotations beside the code / split, unified, and responsive auto layouts / watch mode for auto-reloading file and Git-backed reviews / keyboard, mouse, pager, and Git difftool support"

- 純粋にターミナル内で完結するdiffビューア。plan/HTML/live app reviewは持たない。PR/MRへのコメント投稿や同期機能も持たない——READMEの比較表自体が対象をdelta/difftastic/diff-so-fancy/diff/lumenに限定しており、ブラウザ型のcrit/plannotatorとは比較していない。
- agent連携は「`hunk skill path`で得たskillファイルをagentに読ませ、別ターミナルで開いているhunkのライブセッションに対してagentがコメントを書き込む」という間接的な仕組み(`--agent-context`)であり、crit/tuicr/plannotatorのようにレビュー結果をエクスポートしてagentに送り返す一次機能ではない。
- Jujutsu(jj)とSapling(sl)を自動検出し、それらのネイティブrevsetで`hunk diff`/`hunk show`が動く点、および`hunk log`という読み取り専用のgit/jj history browserを持つ点はcrit/tuicr/plannotatorのどれにもない差別化点。
- vendorの自己ポジショニング: 出典 https://www.hunk.dev/compare [WebFetch要約] — 「Hunk vs Plannotator」という比較ページが存在し「Both exist because agents write more code than you can read」という文言のみで直接の優劣は主張していない。crit/tuicr/diffnav/lazygit/gituiとの比較ページはvendor自身のcompareページに存在しない。別の第三者記事(braindetox.kr、[WebFetch要約])は「Hunkはターミナル側、Crit.mdはブラウザ側」で補完関係にあると位置づけている。
- メンテナンス: 出典 https://api.github.com/repos/modem-dev/hunk [API直接取得] — `stargazers_count: 9401`、`pushed_at: "2026-09-24T20:53:50Z"`、`open_issues_count: 172`、`license: MIT`、`created_at: "2026-03-17"`(半年強で★9,401)。最新リリース`v0.22.0`(2026-09-10)。contributors 83人。運営元は個人ではなくorg `modem-dev`で、出典 https://api.github.com/orgs/modem-dev [API直接取得]の`description`は"Your dev team's auto-triage Product Manager"、`blog`は"https://modem.dev"——VC系スタートアップ("Modem"、拠点Canada)がhunkを開発している。trendshift.io([WebFetch要約])は「8,989 stars, gaining 265 stars per week」「trending #1 Repository of the Day for TypeScript」と報告——急成長の裏取りとしてはオーガニックなトレンド表示だが、スター数の質(bot/購入)自体を検証した一次情報は見つからなかった[unverified]。
- インストール: macOS/Linux両方で`brew install hunk`(formulae.brew.sh確認、`versions: {'stable': '0.22.0', ...}`、コアtap)。ただしREADME自身が"If you previously installed hunk via `modem-dev/tap`, be sure to uninstall it first"と注記しており、コアtapへの昇格前は独自tap配布だった過去がある(コミット履歴に"docs(release): gate Homebrew availability claims (#1088)"という直近コミットがあり、Homebrewでの利用可否表記を厳格化した形跡——ただしPR本文自体はSearch APIで見つからず[unverified])。nixpkgsには`pkgs/by-name/hu/hunk/package.nix`として存在(`version = "0.21.1"`、2026-09-26時点のnixpkgs masterで確認——持ち主のflakeがpinしている正確なrevでの値ではない点に注意)。AURには`hunk`(source, `0.22.0-1`)と`hunk-bin`(`0.22.0-1`)の両方が存在。npm(`npm i -g hunkdiff`)、mise、Omarchyのデフォルトツールとしても配布(README: "Hunk also ships as a default tool in Omarchy, installed through mise.")——Arch系デスクトップ環境への統合はhunk固有の強みでcrit/tuicr/diffnavにはない。
- 既知の問題(負の証拠): 出典 https://api.github.com/search/issues?q=repo:modem-dev/hunk [API直接取得]
  - issue #579(closed, 11 comments)「Scroll wheel use freezes screen」
  - issue #543(closed, 10 comments)「Watch mode is very slow」
  - issue #413(closed, 8 comments)「Performance problems on large diffs」
  - issue #454(closed, 6 comments)「Linux x64 prebuilt binary SIGILLs on non-AVX/Haswell CPU; Bun fallback works」— これが現行READMEの"On x86-64, a CPU with SSE4.2 (Intel Nehalem 2008+, AMD Bulldozer 2011+)"という要件明記につながったと見られる。
  - いずれも解決済み(closed)で、活発な修正サイクルの証拠でもある。

## 3. tuicr

出典: https://raw.githubusercontent.com/agavra/tuicr/main/README.md [raw取得、逐語引用]

> "A code review TUI with vim keybindings. Export to GitHub, GitLab, Gitea, Bitbucket, Azure DevOps, Gerrit, or clipboard."

- hunkと同じくターミナル完結型だが、6種類のフォージへレビューをpushする機能(`:submit`)を持つ点でcrit寄り。plan/HTML/live app reviewは持たない。
- 比較表(README内、hunk/lumen/`gh pr review`/`git diff`との対比)は"Push inline review to GitHub/GitLab/Gitea/Bitbucket/Azure DevOps/Gerrit"の全列でtuicrのみ✅、hunkは全て❌——フォージ連携の広さがtuicrの差別化軸であることをvendor自身が明言。
- メンテナンス: 出典 https://api.github.com/repos/agavra/tuicr [API直接取得] — `stargazers_count: 3216`、`pushed_at: "2026-09-23T19:04:40Z"`、`open_issues_count: 130`、`license: MIT`、`created_at: "2026-01-08"`。最新リリース`v0.27.0`(2026-09-23、当日)。contributors 100人中`agavra`138コミット、`github-actions[bot]`36、`martintrojer`18——crit(ソロ80%以上)より明確にコミュニティ主導。
- インストール: macOS/Linuxとも`brew install tuicr`(formulae.brew.sh確認、`0.27.0`)、Arch公式`sudo pacman -S tuicr`は誤り(実際はAURで`tuicr-git`のみ、出典 https://aur.archlinux.org/rpc/v5/search/tuicr [API直接取得]、`0.10.0.r5.g206eb96-1`——READMEの`pacman -S tuicr`という記載はAURヘルパー経由を指すか、公式extraリポジトリにまだ入っていない可能性が高い[unverified])。cargo(`cargo install tuicr`)、mise、`nix run github:agavra/tuicr`。nixpkgsにも存在(`pkgs/by-name/tu/tuicr/package.nix`、`version = "0.27.0"`——hunkと違いnixpkgs側もvendorの最新リリースに追従できている)。
- named practitioner: Jamie Tanna(jvt.me、ソフトウェアエンジニアの個人ブログ、実名で継続的に技術記事を書く実践者)。出典 https://www.jvt.me/posts/2026/08/25/tuicr/ [WebFetch要約] — 「未pushのブランチをcommit単位でローカルレビューし、GitHub/GitLabの既存PRにもコメントを投稿する」実運用を報告し、限界として「複数コミットのコミットメッセージをdiffと一緒にバッチレビューできない」「`$EDITOR`で長いコメントを書けない」「レビューUIから直接コミットをamendできない」「既存コメントへの返信ができない(open issue)」の4点を明記——ポジティブな採用例と同時に具体的な未解決の不満を持つ稀有な一次証言。
- 既知の問題: 出典 https://api.github.com/search/issues?q=repo:agavra/tuicr [API直接取得]
  - issue #455(open, 9 comments)「Pull Requests in a self hosted GitLab repo doesn't seem to work」
  - issue #498(open, 9 comments)「[Feature Request] Bitbucket Integration」(README上は既にBitbucket対応と書かれているため、issueとREADMEの間にタイムラグがある可能性[unverified])

## 4. plannotator — crit/hunkと同時に見つかった最大級の隣接候補

質問には無かったが、hunk自身のvendor compareページ(`hunk.dev/compare`)が「Hunk vs Plannotator」という専用比較ページを持っていたため発見。crit・hunkと同時に検討すべき規模の競合。

出典: https://raw.githubusercontent.com/backnotprop/plannotator/main/README.md [raw取得、逐語引用]

> "Plannotator is a local, browser-based review surface for AI coding agents: Claude Code, Codex, Copilot CLI, Gemini CLI, OpenCode, Kiro, Droid, Amp, and Pi. **It plugs directly into your agent** through its hooks and commands. When the agent proposes a plan, html, or finishes writing code, the work opens in your browser and you mark it up, comment, and send feedback directly to the agent for it to act on it."

> "Code Review: Review local changes or remote PRs. Comment on diffs, suggest code. Your comments go back to the agent. Works with Git, GitButler, Jujutsu (`jj`), Perforce (`p4`), GitHub, and GitLab."

- critとほぼ同じ守備範囲(plan/diff/HTML review、GitHub/GitLab連携、agentへのフィードバック送信)を持つが、対応VCSがcritより広い(GitButler、Perforce)。plan modeは「各harnessのhookに直接配線され、agentがplanを作るたびに自動でレビュー画面が開く」点がcritより自動化されている。
- ターミナル補完として`Herdr Annotate`(`herdr plugin install plannotator/herdr-annotate`、Herdr上で動く)と、Herdr非依存のスタンドアロン`plannotator-tui`(`brew install plannotator/tap/plannotator-tui`)の両方を持つ——ただしどちらも別リポジトリの周辺プロジェクトで、本体`plannotator`はブラウザUIのまま。
- メンテナンス: 出典 https://api.github.com/repos/backnotprop/plannotator [API直接取得] — `stargazers_count: 8950`、`pushed_at: "2026-09-25T17:46:34Z"`(前日)、`open_issues_count: 131`、`license: Apache-2.0`、`created_at: "2025-12-28"`。最新リリース`v0.27.20`(2026-09-24)——hunkに匹敵する規模とベロシティ。
- インストール成熟度はcrit/hunk/tuicrより低い: 本体はHomebrew formula自体を持たない(`formulae.brew.sh/api/formula/plannotator.json`は404、casksも404)、nixpkgsにも存在せず(`pkgs/by-name/pl/plannotator`は404)、AURにも無い。インストールは`curl -fsSL https://plannotator.ai/install.sh | bash`のインストーラスクリプト一本のみで、周辺のterminal companion(`plannotator-tui`)だけが独自tapでHomebrew配布されている——パッケージマネージャ経由のバージョン管理という点ではcrit/hunk/tuicrに劣る。
- privacyに関する自己申告: README曰く"Plannotator does not collect usage telemetry or analytics"だが「Each plan review, ... checks GitHub for the latest Plannotator release when it loads」「Local Git code review can also query the configured `origin` with `git ls-remote`」という常時の外部通信がある(オプトアウトフラグ`--no-git-remote-check`あり)——critの「no analytics, checks once per session for updates」より通信頻度が高い設計。

## 5. diffnav / delta / difftastic — pagerの高度化系(review-firstではない)

出典: https://raw.githubusercontent.com/dlvhdr/diffnav/main/README.md [raw取得、逐語引用]

> "A git diff pager based on delta but with a file tree, à la GitHub."

- diffnavはdelta出力にfile treeを足した「pager」であり、コメント機能・agentへのフィードバック送信機能を持たない。`git config --global pager.diff diffnav`で差し込む使い方が主。作者dlvhdr(gh-dashの作者としても知られる実名の実践者)。
- メンテナンス: 出典 https://api.github.com/repos/dlvhdr/diffnav [API直接取得] — `stargazers_count: 1573`、`pushed_at: "2026-09-22T13:05:37Z"`、`open_issues_count: 29`、contributors 12人(`dlvhdr`107、`pablospe`26)。最新リリース`v0.12.0`(2026-07-24、約2か月前——crit/hunk/tuicrより更新頻度が低い)。
- インストール: `brew install diffnav`(formulae.brew.sh確認、`0.12.0`)、`go install`。nixpkgsに存在(`pkgs/by-name/di/diffnav/package.nix`、`version = "0.12.0"`)。**AURには存在しない**(`diffnav`/`diffnav-bin`とも検索0件)。
- difftastic(Wilfred/difftastic、★25,933、出典 https://api.github.com/repos/Wilfred/difftastic [API直接取得])とdelta(dandavison/delta、★32,348)はどちらも構文diff/シンタックスハイライトの老舗ツールで、agent-diff review用に設計されたものではないが、hunk自身のcompareページが名指しで比較対象にするほど広く使われている基盤ツール。両方ともnixpkgs(`di/difftastic` version 0.71.0、`de/delta` version 0.19.2)とArch公式extra(`difftastic 0.71.0`、`git-delta 0.19.2`、出典 https://archlinux.org/packages/search/json/?name=difftastic 等 [API直接取得])に安定して存在する——crit/hunk/tuicr/plannotatorのどれよりディストリビューション公式リポジトリでの成熟度が高い。

## 6. lazygit / gitui — 汎用Git TUI(diffペインへの差し込み先)

- lazygit(jesseduffield、★82,681、`pushed_at: "2026-09-25T10:14:37Z"`)とgitui(gitui-org、★22,523、`pushed_at: "2026-08-04T08:27:21Z"`)はagent-diff専用ではないが、実践者はこれらのdiffペインをdelta/difftasticに差し替えて使うのが定石。
- named practitioner: Lorenzo Bettini(ソフトウェアエンジニア、Eclipse Xtext等への貢献で知られる実名ブロガー)。出典 https://www.lorenzobettini.it/2025/06/better-diffs-in-lazygit-with-delta/ [WebFetch要約] — `~/.config/lazygit/config.yml`に`git: paging: colorArg: always / pager: delta --paging=never`を設定する具体的な手順を公開。ただしこの記事はエージェント差分に限定した内容ではなく、一般的なgit diffの読みやすさ向上が主題。
- 両方ともnixpkgs(`la/lazygit` 0.65.1、`gi/gitui` 0.28.1)とArch公式extra(`lazygit 0.65.1`、`gitui 0.28.1`)に存在。

## 7. Claude Code自身のレビュー機能、および軽量ブラウザ系の周辺候補

- Claude Codeはネイティブに`/code-review`(このセッションのskill一覧にも実在)を持つ。[WebSearch要約、code.claude.com/docs/en/code-reviewを含む複数の二次情報から合成] — 「現在のdiffをベースブランチと比較し、並列レビューエージェントがbug/security/style違反をfile:line付きで検出、重複排除して重要度順に提示」「`/code-review low`は確信度の高い指摘のみ、`high`はより広く拾う」という段階制御を持つ。別に`/diff`コマンドも存在し、「ターン単位でClaudeが触った変更を、離席せずにインタラクティブUIで確認」できる([WebSearch要約]、一次のcode.claude.com該当ページは個別URL到達未確認[unverified])。
- どちらもレビュー結果の**表示**に留まり、crit/hunk/tuicr/plannotatorのような「別プロセスでコメントを蓄積し、フォージへpushしたり、agentへ構造化フィードバックとして送り返す」機能ではない——Claude Code自身のレビューは同一セッション内で完結し、外部レビューUIを置き換えるものではない。
- 軽量な周辺候補として、DiffHub(`npx diffhub@latest`、[WebFetch要約]「ブラウザでdiffを表示しコメント、コピーしてagentに貼り戻す」、GitHubリポジトリ自体は特定できず配布はnpxのみ)、Diffity(nilbuild/diffity、★776、`pushed_at: "2026-07-06"`、出典 https://api.github.com/repos/nilbuild/diffity [API直接取得]、"GitHub-style diff viewer ... Works with Claude Code, Cursor and other AI tools")がcritの縮小版として存在するが、いずれもcrit/plannotatorほどの機能(plan review、フォージ同期)もメンテナンス頻度も持たない。

## 8. Graphite / GitHub PR的ローカルレビュー(範囲外の確認)

- Graphite(`gt` CLI)はstacked diffのブランチ管理・PR分割が主眼であり([WebSearch要約]、graphite.com/guides系の複数記事)、コーディングエージェントの単一チェンジセットをコミット前にローカルでレビューするという持ち主の用途とは主眼が異なる(レビューはGitHub上で行う前提のツール)。`gh pr diff`/`gh pr review`はtuicrの比較表内で「review-level commentのみ、inline commentはできない」("`gh pr review` posts approve/comment/request-changes at the review level only. No inline line comments.")と評価されている——tuicr README自身の逐語引用。

---

## 9. 結論

**accepted practiceはcrit**: 持ち主がすでにflake inputとして固定し、Claude Codeの`crit:crit-cli`/`crit:crit-story`スキルまで配線済みのcritは、この用途(コミット前にagentの差分をレビューする)で要求される機能——diff/plan/live app/HTML review、GitHub/GitLab同期、agentへの構造化フィードバック送信——をすでに満たしている。同カテゴリで最大の対抗馬はhunkではなくplannotator(★8,950、crit相当の機能+GitButler/Perforce対応+harness hookへの自動配線)だが、乗り換えても持ち主の用途に対して機能的な純増はない(パッケージ配布の成熟度はplannotatorの方がむしろ低い——Homebrew formula・nixpkgs・AURいずれも無く、インストーラスクリプト一本のみ)。

**hunkがcritに対して加えるものは無い**: hunkは同じ問題(agent差分のレビュー)に対する別解ではなく、そもそも別の層の道具である。hunkはブラウザを介さないターミナル完結のdiffビューア+jj/Sapling対応のhistory browserであり、PR/MR同期・plan review・live app reviewを持たない。vendor自身の比較ページもdelta/difftastic/diff-so-fancyとしか比較しておらず、crit/plannotatorとは「hunkはターミナル、critはブラウザ」という補完関係として第三者記事に位置づけられている([WebFetch要約]braindetox.kr)。critが既に持つ機能(GitHub/GitLab同期、plan/live app review、agentへの構造化コメント返送)をhunkは提供しない。唯一hunkが持ちcritに無い能力は、(a) ブラウザを一切開かずSSH越しのターミナルだけで完結できる点、(b) Jujutsu/Sapling環境での読み取り専用history browsing、(c) Omarchy(持ち主の第二Linux機)へmise経由でデフォルト同梱される点だが、いずれも持ち主が今問うている「コミット前のagent差分レビュー」という一次要求そのものを解決する機能ではない。
