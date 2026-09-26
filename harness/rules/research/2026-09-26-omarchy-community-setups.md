# Omarchy (v4 Quattro) のコミュニティ設定・キュレーションリスト — 何を見せびらかしているか

調査日: 2026-09-26。前提（再調査しない、[2026-09-24-dotfiles-on-omarchy.md](2026-09-24-dotfiles-on-omarchy.md) と [2026-09-26-omarchy-customization.md](2026-09-26-omarchy-customization.md) から引き継ぐ）: Omarchy は現行 **v4.0.4 "Quattro"**（リポジトリ `omacom/omarchy`、旧 `basecamp/omarchy` は API 上 301 で恒久転送済み）。waybar/mako/walker は廃止され Quickshell 統合の `omarchy-shell` に一本化、Hyprland 設定は `.conf` ではなく **Lua**。バーは `omarchy bar position bottom` で下に移せる（薄い `jq` ラッパー、`~/.config/omarchy/shell.json` の `bar.position` を書き換えるだけ）。テーマは `~/.config/omarchy/themes/<name>/colors.toml`（base16 寄りの26キー TOML）が一次ファイル。dotfiles 側の13パレット中8件（catppuccin/catppuccin-latte/everforest/gruvbox/kanagawa/nord/rosepine/tokyonight）が Omarchy の22既定テーマと名前ベースで重複。

## 方法・検証凡例

- 直接取得（`curl` で生ソース/API レスポンスを取得）: 明記なき引用はすべてこれ。GitHub API は `gh auth token` を `Authorization: Bearer` ヘッダに使い `api.github.com`/`raw.githubusercontent.com` へ直接 `curl`（`gh` CLI 自体はこのサンドボックスで TLS が失敗するため不使用）。GraphQL は Discussions 検索に使用。
- **Reddit は到達不能。** `www.reddit.com` はブラウザ User-Agent を付けても常に `403`。`old.reddit.com/r/omarchy/.json` は1回だけ `200` を返したが中身はログイン壁の HTML で、以後の再試行（`/top/.json?t=year` 等）はすべて `403`/`404`/ログイン壁 HTML に戻った。`r/unixporn` の検索も `403`/`404`。よって **r/omarchy・r/unixporn の投稿一覧・スコア・コメントは本記録では一切取得できていない**（[未到達]、以後この節の言及はすべて GitHub 側の代替情報源による）。
- Discord は招待プレビュー API（認証不要、`discord.com/api/v9/invites/<code>`）でギルドのメタデータ（会員数など）だけは取得できたが、チャンネル一覧・メッセージ内容はメンバーシップ/Bot トークンが必要で未到達。

---

## 1. キュレーションリスト・ショーケース

### awesome-omarchy 系リスト（GitHub 検索 `awesome-omarchy`、`api.github.com/search/repositories`、2026-09-26 時点）

| リポジトリ | star | 最終 push | 備考 |
|---|---|---|---|
| [aorumbayev/awesome-omarchy](https://github.com/aorumbayev/awesome-omarchy) | **577** | 2026-09-25 | CC0-1.0、作成 2025-08-16、現行の事実上の一次キュレーションリスト |
| [Wheel-Smith/awesome-omarchy](https://github.com/Wheel-Smith/awesome-omarchy) | 128 | **2025-11-24**（Quattro 以前で停止） | テーマのスクリーンショット特化リスト |
| [aorumbayev/awesome-omarchy-tui](https://github.com/aorumbayev/awesome-omarchy-tui) | 26 | 2026-08-24 | 上記リストを閲覧する TUI |
| [AIowa-LLC/awesome-omarchy-themes](https://github.com/AIowa-LLC/awesome-omarchy-themes) | 15 | 2026-09-10 | テーマ専用の別リスト |
| [minimallyexceptional/awesome-omarchy](https://github.com/minimallyexceptional/awesome-omarchy) | 8 | 2025-10-23 | 小規模、内容の現行性は未確認 [unverified] |
| [mirarr-app/awesome-omarchy](https://github.com/mirarr-app/awesome-omarchy) | 5 | 2026-09-15 | 小規模、内容未精読 [unverified] |

**aorumbayev/awesome-omarchy（README 直接取得、273行）が最も実用的で網羅的。** 構成は Official Resources / Alternative Implementations / **Plugins**（Quattro 専用プラグイン40件超を列挙）/ Development Tools / Related Projects / Alternative Curated Lists / Community Resources / Articles and Tutorials / **Themes**（90件超）。README 冒頭の逐語:

> "A curated list of Omarchy plugins, themes, resources, and tools."

**Alternative Curated Lists 節が公式に言及する2件目のリスト**:

> "[omarchy-plugin-marketplace](https://github.com/HANCORE-linux/omarchy-plugin-marketplace) - Community registry of Omarchy Quattro plugins, published at omarchyplugins.com." / "[Wheel-Smith/awesome-omarchy] - Alternative curated list of Omarchy resources with explicit focus on theme resources with screenshot previews."

**Wheel-Smith/awesome-omarchy は内容が Quattro 以前のまま停止している（否定側の証拠、後述）。** README 直接取得の逐語:

> "Omarchy ships with **nine beautiful, secure, and customizable themes** that style your desktop environment, terminal, Neovim, btop, notifications (**mako**), top bar (**Waybar**), application launcher (**Walker**), and lock screen (Hyprlock)."

waybar/mako/walker は2026-09-24記録で確認済みの通り Quattro で全廃されており、この128 star のリストは現行アーキテクチャを反映していない。issue/PR一覧（20件取得）はテーマ追加 PR が大半で、Quattro 移行への言及は無く、放置されたテーマ追加 PR が溜まっている状態（例: #34〜#42 が open のまま）。

### 公式プラグインマーケットプレイス（`omarchyplugins.com` → `plugins.omarchy.org`、直接取得で200確認）

omarchy.org のニュース記事（直接取得、2026-08-19付「The first plugin competition」）逐語:

> "The Omarchy Plugin Marketplace is already home to over 500 plugins and growing very fast."

### 公式コミュニティチャンネル

- **GitHub Discussions**（`omacom/omarchy/discussions`）: カテゴリは General / Ideas / Manual / Polls / Q&A / **Show and tell** / Suggestions / Support（GraphQL で直接取得）。「Show and tell」は134件あるが、upvote 上位20件でも最大 **5** — GitHub 公式ディスカッションの「見せびらかし」文化は薄く、内容もスクリーンショット披露より tmux-resurrect 連携・secureboot 自動化・waybar ウィジェット追加などの技術 Tips/プラグイン告知が主体。上位項目の作成日は2026-01〜03月が多く（例: 「Workspace Icons in **Waybar**」2026-03-03）、**Quattro 以前の waybar 時代の投稿が上位を占めている** — Quattro 後の「show and tell」文化がまだ厚みを持っていないことを示唆する。
- **Discord「Omacom」**: `omarchy.org` トップページに埋め込まれた招待コード `discord.gg/tXFUdasqhY` を直接取得。招待プレビュー API（認証不要）を直叩きした結果:

  ```json
  "approximate_member_count": 45481, "approximate_presence_count": 5637,
  "guild": {"name": "Omacom", "description": "Beautiful, Fun & Agentic Linux by DHH"}
  ```

  会員 45,481人・オンライン 5,637人という規模は確認できたが、チャンネル一覧・「show your setup」的チャンネルの中身はメンバーシップ/Bot トークンが要るため**未到達**。

- **Reddit r/omarchy・r/unixporn**: 前述の通りブロックされ、投稿内容は一切取得できていない。

---

## 2. 最も支持されているコミュニティ設定・テーマ・シェル

GitHub 検索 `omarchy dotfiles`（`sort=stars`、総件数712、2026-09-26時点、直接取得）の上位から Omarchy 本体でないもの（omarchy-nix は2026-09-24記録で却下済み）を除いて拾うと:

| リポジトリ | star | 最終 push | 何をしているか |
|---|---|---|---|
| [sspaeti/dotfiles](https://github.com/sspaeti/dotfiles) | 244 | 2026-09-23 | macOS+Omarchy を1つの stow リポジトリで共有（2026-09-24記録で既出、再掲しない） |
| [j5onrf/dots](https://github.com/j5onrf/dots) | 118 | 2026-08-25 | Quickshell/Noctalia-Shell 実験ログ、DankMaterialShell 比較 |
| [typecraft-dev/omarchy-supplement](https://github.com/typecraft-dev/omarchy-supplement) | 89 | 2026-08-17 | Hyprland は override 追記のみ、端末/エディタ/プロンプトは丸ごと置換（2026-09-24記録で既出） |
| [IroncladDev/dotfiles](https://github.com/IroncladDev/dotfiles) | 35 | 2026-09-25 | kanata でmacOS風 Cmd+C/V/X 相当をSUPERに割当 |

### バー・シェルの代替候補として名前が挙がるもの

**[HANCORE-linux/Shibumi-Shell](https://github.com/HANCORE-linux/Shibumi-Shell)（197 star、2026-09-25 push）** — README 直接取得。Omarchy 純正シェルに24個のプラグイン付き独自レイアウト（"QS Rise V1/V2"）を追加する native bar/plugin suite:

> "Shibumi brings the approved QS Rise V1 and V2 layouts, controls, widgets, panels, and interaction model into Omarchy's existing shell process."

スクリーンショットはリポジトリ同梱（リンクのみ）: [desktop artwork](https://github.com/HANCORE-linux/Shibumi-Shell/blob/main/docs/screenshots/shibumi-hikiryo-landing.png)、[Quick controls](https://github.com/HANCORE-linux/Shibumi-Shell/blob/main/docs/screenshots/shibumi-quick.png)、[Configure 画面](https://github.com/HANCORE-linux/Shibumi-Shell/blob/main/docs/screenshots/shibumi-configure.png)、[Bars 設定](https://github.com/HANCORE-linux/Shibumi-Shell/blob/main/docs/screenshots/shibumi-bars.png)、[プラグインカタログ](https://github.com/HANCORE-linux/Shibumi-Shell/blob/main/docs/screenshots/shibumi-plugins.png)。credit として [Lacuna Shell](https://github.com/OldJobobo/lacuna-shell)（同種のシェル拡張、27 star）を挙げている。**ただし極めて脆い構成であることを自己申告**（否定側の証拠で後述）。

**Omarchy 非依存の汎用 Quickshell シェルを移植する動き**: j5onrf/dots の README（直接取得、539行）内で著者は waybar から乗り換えた体験を書いている:

> "After switching to **Noctalia-Shell**, I've realized I can't go back. ... If you are currently on Waybar, do yourself a favor: **Try Noctalia.**"

[noctalia-dev/noctalia](https://github.com/noctalia-dev/noctalia)（**10,872 star**）と[AvengeMedia/DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell)（**8,215 star**、pushed 2026-09-26）はどちらも Omarchy 専用ではなく niri/Hyprland/sway/MangoWC/labwc/MiracleWM 対応の汎用 Quickshell デスクトップシェルで、Omarchy の上に載せ替える形で使われている（[swrneko/dots-next](https://github.com/swrneko/dots-next)、[anIcedAntFA/dotfiles](https://github.com/anIcedAntFA/dotfiles) 等、いずれも小規模でniri前提のものも混在）。**この2つは `omarchy-theme-set` の `colors.toml` 自動反映の対象に入っていない**（2026-09-26記録の post-hook リストに noctalia/DankMaterialShell は無い) — 載せ替えると Omarchy のワンショットテーマ切替の恩恵を失う可能性が高い、という構造的トレードオフがある[unverified: 具体的な非対応の一次報告は今回未確認、post-hookリストからの推論]。

### 最も人気の高い個別テーマ・最も多作なテーマ作者

awesome-omarchy のテーマ節（90件超）とその作者の GitHub アカウントを直接調べた結果、突出して多作な3アカウントが判明:

- **[OldJobobo](https://github.com/OldJobobo)** — 90超のリポジトリの大半が Omarchy テーマ/プラグイン。最多star: [omarchy-lumon-theme](https://github.com/OldJobobo/omarchy-lumon-theme)（**171 star**、Apple TV+ドラマ「Severance / セヴェランス」のLumon Industries風、コミュニティで最も star を集めた単体テーマ）、[omarchy-miasma-theme](https://github.com/OldJobobo/omarchy-miasma-theme)（122 star）、[theme-manager-plus](https://github.com/OldJobobo/theme-manager-plus)（42 star、"Alternative Theme Manager for Omarchy"）、[lacuna-shell](https://github.com/OldJobobo/lacuna-shell)（27 star、Shibumi-Shell の元ネタ）。
- **[bjarneo](https://github.com/bjarneo)** — awesome-omarchy に aura/ash/elysian/fireside/firesky/frost/gtk/monokai/nes/pulsar/sakura/serenity/snow など10件超のテーマで登場。加えて [aether](https://github.com/bjarneo/aether)（テーマ生成ツールキット）・[tema](https://github.com/bjarneo/tema)（ライブプレビュー付きテーマUI）も自作しており、テーマ量産のツールチェーンごと持っている。確認した4件は同一日（2026-08-30）に一括 push — アップデート作業がツール経由でバッチ化されている様子がうかがえる[unverified: aether経由の一括生成である直接証拠は未確認]。
- **[HANCORE-linux](https://github.com/HANCORE-linux)** — Shibumi-Shell に加え13件超のテーマ（batou/blackgold/blackmoney/harbor/harbordark/inkypinky/mechanoonna/sapphire/shadesofjade/thegreek/velvetnight/whitegold 等）、waybar-themes、plugin-registry を保有。

---

## 3. macOS + AeroSpace からの移行者に直接関連するもの

**最重要の発見: [paulsp94/omacosy](https://github.com/paulsp94/omacosy)（**662 star**、pushed 2026-09-26＝調査当日）。** これは逆方向（macOS に Omarchy 風の体験を持ち込む）だが、GitHub トピックに `aerospace`・`omarchy`・`macos`・`status-bar`・`tiling-window-manager` が付いており、Omarchy のキーバインド哲学を **AeroSpace の `aerospace.toml` へそのまま翻訳した一次資料**になっている。README 直接取得（644行）より:

> "Pre-1.0. An omarchy-style desktop environment for macOS: tiling with a real Super key, dwindle layout, a themed status bar written for it, focus-follows-mouse, trackpad workspace swipes and a live workspace overview"

**キーバインド表がそのまま Omarchy→AeroSpace 対応表として使える**（README "## Keybindings — Super = hold Caps Lock" 節、逐語）:

| キー | 動作 |
|---|---|
| `Super+1..9` | このディスプレイのワークスペース N へ切替 |
| `Super+tab` / `Super+shift+tab` | 次/前のワークスペース |
| `Super+b` | 直前2つのワークスペースを往復 |
| `Super+arrows` | その方向のウィンドウへフォーカス |
| `Super+shift+arrows` | AeroSpace: ウィンドウ移動 / OmniWM: タイル入替 |
| `Super+shift+1..9` | ウィンドウをワークスペース N へ移動して追従 |
| `Super+w` / `Super+t` / `Super+j` | 閉じる / floating切替 / split方向切替 |
| `Super+f` | フルスクリーン（ノッチ機はカメラ帯を隠して真のフルスクリーンに見せる） |
| `Super+space` | ランチャー（Raycast） |
| `Super+shift+t` | 次のテーマへ |
| `Super+k` | キーバインドのチートシート（設定から自動生成） |

チートシートのスクリーンショット（リンクのみ）: [cheatsheet.jpg](https://github.com/paulsp94/omacosy/blob/main/docs/screenshots/cheatsheet.jpg)（キャプション曰く "every binding, parsed from aerospace.toml"）、[desktop.jpg](https://github.com/paulsp94/omacosy/blob/main/docs/screenshots/desktop.jpg)。README は Karabiner-Elements で Caps Lock を Super 化する権限要求も詳細に文書化しており、Accessibility/Input Monitoring/Screen Recording など各権限が何のために要るかを明記している。

**IroncladDev/dotfiles（35 star）は逆に、Omarchy 本体の中で macOS 風のショートカットを再現する具体例。** `kanata/`（`combos.kbd`, `tap-hold.kbd` 等、キーボードリマップツール kanata の設定）と `hypr/bindings.lua` を直接取得すると:

```lua
hl.bind("SUPER + C", send_shortcut_once("CTRL", "Insert"))
hl.bind("SUPER + V", send_shortcut_once("SHIFT", "Insert"))
hl.bind("SUPER + X", send_shortcut_once("CTRL", "X"))
```

これは Hyprland の `send_shortcut` が状態を引きずるバグ（[hyprwm/Hyprland#14099](https://github.com/hyprwm/Hyprland/discussions/14099)）を回避しつつ **`SUPER+C/V/X` を macOS の `Cmd+C/V/X` と同じ位置に割り当てる**実装。`omarchy/` ディレクトリに独自の `workspaces.lua`・`hypr/shaders/` も持ち、Omarchy の既定を土台にしつつ広く手を入れている構成。

**バーを下に置く実践例は、今回の検索では専用のショーケース記事や dotfiles READMEでの明示的な「私は下にしている」という一次証言までは見つからなかった**（[unverified: `omarchy bar position bottom` を使った実例のスクリーンショット付き報告は本調査の到達範囲では確認できず]）。手段そのもの（CLI一発）は2026-09-26記録で確定済み。

---

## 4. 否定側の証拠 — Quattro 移行で壊れたテーマ・放置されたリポジトリ

GitHub 検索 API（`search/issues`）で `quattro theme broken`・`waybar quattro` を直接検索し、ヒットした個別 issue/PR を直接取得して裏取りした。

**個別テーマが壊れた一次報告:**

- **[abhijeet-swami/omarchy-ayaka-theme#12](https://github.com/abhijeet-swami/omarchy-ayaka-theme/issues/12)**「Theme broken in OMARCHY Quattro」(open, 2026-08-20) — 逐語:
  > "Migrating to OMARCHY Quattro has broken my theme, I don't know, is it just for me or everyone else too? ... I tried to do some fixes my own with Claude Sonnet 5, didn't work out well..."
- **[imbypass/omarchy-theme-hook#55](https://github.com/imbypass/omarchy-theme-hook/issues/55)**「Broken on Omarchy 4 (Quattro): hooklettes run twice, and colors.toml path moved so all colours are empty」(open, 作成2026-08-21・更新2026-09-22＝約1ヶ月未解決) — 逐語:
  > "1. Every hooklette runs **twice**, and the second run has no helper functions ... 2. `theme-set` reads `colors.toml` from a path Omarchy 4 no longer uses, so **every colour variable is empty**. Hooklettes then write themes built from empty values while printing `[SUCCESS]`."

  「成功と表示されながら実際は空の色で書き込む」という **静かな失敗（silent failure）**が、個別プラグインだけでなく Omarchy 本体側にも存在する:
- **[omacom/omarchy#10720](https://github.com/omacom/omarchy/issues/10720)**「omarchy theme set reports success when post-theme hooks fail (run_parallel discards wait status)」(open)。
- **[omacom/omarchy#8262](https://github.com/omacom/omarchy/issues/8262)**「Theme switcher and background keybindings broken: menu never renders, theme set silently fails from menu action」(open)。

**公式に近い著名テーマですら Quattro 対応が完了していない:**

- **[dracula/omarchy#5](https://github.com/dracula/omarchy/pulls/5)**「Update theme for Omarchy 4 (Quattro)」(open, 作成2026-09-02) — awesome-omarchy の Themes 節が「公式 Dracula テーマ」として挙げているリポジトリ本体で、Quattro 対応 PR がまだマージされていない状態が今回の取得時点で確認された。

**移行そのものが無警告でユーザー設定を破壊した例（Omarchy 本体 issue）:**

- **[omacom/omarchy#6911](https://github.com/omacom/omarchy/issues/6911)**「Quattro upgrade replaces customized monitors.conf with default monitors.lua (auto layout, GDK_SCALE=2) without porting or warning」(open, 2026-08-15) — 逐語:
  > "Unlike the other configs the upgrade touches (waybar, mako, hyprsunset, brave-flags — all parked as `*.omarchy-upgrade-to-quattro.<ts>.ba[k]`..." （monitors.conf だけは退避すらされず消える、という趣旨）
- **[omacom/omarchy#7135](https://github.com/omacom/omarchy/issues/7135)**「Quattro removes playerctl while default Voxtype config requires it」(open, 2026-08-16) — パッケージ依存関係の見落としによる機能破壊。

**テーマ移植 PR が開いたまま放置されている例（複数リポジトリ横断、いずれも `state: open`）:**

[OldJobobo/omarchy-flat-dracula-theme#4](https://github.com/OldJobobo/omarchy-flat-dracula-theme/pull/4)、[abhijeet-swami/omarchy-forest-green-theme#2](https://github.com/abhijeet-swami/omarchy-forest-green-theme/issues/2)、[ahmed-z0/omarchy-sakurazuki-theme#2](https://github.com/ahmed-z0/omarchy-sakurazuki-theme/pull/2)、[stannorbvb-cmd/cpunk#1](https://github.com/stannorbvb-cmd/cpunk/pull/1) — いずれも「Convert theme to Omarchy Quattro (standards)」という同じ趣旨のPRが開いたまま。OldJobobo自身のPR本文（直接取得）が示す変換の実質量:

> "`colors.toml`: rewritten to the exact 26-key Quattro palette set ... `hyprland.lua`: borders + group borders + flat rounding + purple shadow only, matching default themes; drops the personal opacity/dim windowrules"

**キュレーションリスト自体が古いアーキテクチャを記述したまま止まっている:**

- Wheel-Smith/awesome-omarchy（128 star）は前述の通り Waybar/Walker/Mako を前提にした記述のまま 2025-11-24 で更新停止。**star数と内容の現行性は無関係**、という具体的な反例。

**Shibumi-Shell（197 star）自身がベータの脆さを率直に文書化している** — README 直接取得の逐語:

> "The published `0.1.1-beta.15.3` prerelease was validated on a single-output Omarchy 4.0.4 host ... Multi-output acceptance was not run." / "Do not install or update from `main`. If you previously installed from `main`, run `./scripts/shibumi-suite uninstall --keep-settings --yes` from that exact checkout before switching to a tag."

特定の Omarchy/Quickshell リビジョン（`v4.0.4`, revision `c668141e`, Quickshell `0.3.1-1`）に強くピン留めされており、AUR パッケージも「公開延期」中——**Omarchy のマイナーアップデート1回で壊れる可能性を作者自身が前提にしている**設計。

---

## 確認できなかったこと

- **Reddit（r/omarchy, r/unixporn）の投稿内容・スコア・コメント全般** — サンドボックスから到達不能（403/ログイン壁、ブラウザUAでも再現）。「Omarchy 系の r/unixporn 投稿がどれだけ人気か」は本記録では判断材料がない。
- **Discord「Omacom」サーバーのチャンネル構成・「show your setup」的チャンネルの実在と内容** — 招待プレビュー API で会員数（45,481人）は取れたが、チャンネル一覧・メッセージはメンバーシップ/Botトークンが必要で未到達。
- **`omarchy bar position bottom` を実際に使っている dotfiles/スクリーンショット付き一次報告** — 手段自体は2026-09-26記録で確定済みだが、「これを使って下に置いている」という実践者の作例は今回の検索範囲では見つからなかった。
- **Noctalia-Shell / DankMaterialShell が Omarchy の `colors.toml` テーマ切替と統合するかどうかの一次資料** — post-hook リスト（2026-09-26記録）に両者の名が無いことからの推論に留まり、直接の非対応表明や逆に対応したという報告のどちらも確認できていない。
- **`plugins.omarchy.org` の実際のプラグイン一覧・カテゴリ内訳** — トップページの到達確認のみ行い、500件超のプラグインをカテゴリ別に精査してはいない。
- **minimallyexceptional/awesome-omarchy・mirarr-app/awesome-omarchy の内容の現行性** — star数のみ確認、README精読はしていない。
- **bjarneo のテーマが同日一括 push された理由（aether経由のバッチ生成か手動更新か）** — 状況証拠（同一タイムスタンプ）のみで一次資料の確認はしていない。

---

## 結論

**キュレーションリストは1本に収束していない。** aorumbayev/awesome-omarchy（577★、2026-09-25 push）が最も網羅的かつ現行だが、Wheel-Smith/awesome-omarchy（128★）のような相応に有名なリストが Quattro 以前のアーキテクチャ（Waybar/Mako/Walker）を記述したまま2025-11-24で止まっている、という「star数は現行性を保証しない」具体例が確認できた。公式コミュニティチャンネル（GitHub Discussions の Show-and-tell、Discord）は存在し規模もある（Discord 4.5万人）が、「見せびらかし」文化としての厚みは Discussions 上では薄く（最大upvote 5）、実質的なショーケースの場は **個別テーマ/プラグインリポジトリの README とそのスクリーンショット**、および awesome-omarchy のようなキュレーションリストに分散している。

**最も admired なのは「個別テーマ」より「量産する作者」と「プラグインエコシステム」。** OldJobobo・bjarneo・HANCORE-linux の3アカウントだけで awesome-omarchy のテーマ節の3割近くを占め、最多star単体テーマは OldJobobo の omarchy-lumon-theme（171★、Severance 題材）。バー刷新の最有力は HANCORE-linux/Shibumi-Shell（197★、24プラグイン、Lacuna Shell の後継的立ち位置）だが、これはベータで特定ビルドにピン留めされた脆い構成であることを作者自身が明記している。より汎用的な選択肢として Noctalia（10,872★）・DankMaterialShell（8,215★）という Omarchy 非依存の巨大 Quickshell シェルへ乗り換える動きもコミュニティ内にあるが、Omarchy 純正のワンショットテーマ切替との統合は未確認。

**macOS + AeroSpace からの移行者にとって最も直接的な参照は paulsp94/omacosy。** 方向は逆（Omarchy の哲学を macOS に持ち込む）だが、Omarchy のキーバインド体系（`Super+数字`＝ワークスペース、`Super+shift+矢印`＝ウィンドウ移動、`Super+f`＝フルスクリーン等）を `aerospace.toml` に一対一で翻訳した一次資料であり、Omarchy 側に移るときのキーバインド設計をそのまま逆読みできる。IroncladDev/dotfiles は同じ発想を Omarchy 本体側で実践しており、kanata + Hyprland Lua の `send_shortcut` ワークアラウンドで `Super+C/V/X` を macOS の `Cmd+C/V/X` と同じ位置に割り当てている——これは sketchybar/aerospace 育ちのユーザーがまず欲しくなる具体的な一手として再現性が高い。

**Quattro 移行はコミュニティ資産に実害を出しており、今も進行中。** 個別テーマの破損報告（ayaka-theme, omarchy-theme-hook）、公式に近いテーマ（dracula/omarchy）ですら Quattro 対応PRが未マージ、Omarchy 本体側のマイグレーションが警告なくユーザー設定を破壊した報告（monitors.conf, playrctl依存）、「成功と表示しながら実際は失敗する」テーマ適用の静かな失敗（#8262, #10720）——これらはいずれも2026-09-26時点で **open のまま**。dotfiles/テーマを移植・参考にする際は、対象リポジトリの最終pushと open issue に「quattro」を含む破損報告が無いかを必ず確認すべき、という具体的な運用上の教訓になる。

---

## 取り入れ候補

1. **バーを下に移す**: `omarchy bar position bottom`（CLI一発、内部は `shell.json` の `bar.position` を書き換えるだけ）。出典: 2026-09-26記録・omarchy.org/manual/the-top-bar。ただし `shell.json` を symlink 管理すると同じ記録が指摘する `mv` ベースの破壊(#11096系)に巻き込まれる点に注意。
2. **`Super+C/V/X` を macOS の `Cmd+C/V/X` と同じ位置に割り当てる**: kanata でCaps Lockや任意キーをSuperにし、Hyprland Lua側は `hl.dispatch(hl.dsp.send_key_state(...))` で `CTRL+Insert`/`SHIFT+Insert`/`CTRL+X` に変換する実装。出典: [IroncladDev/dotfiles](https://github.com/IroncladDev/dotfiles)（`kanata/`, `hypr/bindings.lua`）。
3. **キーバインド設計の参照表として paulsp94/omacosy を使う**: 逆方向の実装だが `Super+数字`＝ワークスペース、`Super+b`＝直前ワークスペース往復、`Super+shift+;`＝サービスモード等、Omarchy のキーバインド哲学を1枚のチートシートに翻訳済み。出典: [paulsp94/omacosy README](https://github.com/paulsp94/omacosy)（[cheatsheet.jpg](https://github.com/paulsp94/omacosy/blob/main/docs/screenshots/cheatsheet.jpg)）。
4. **プラグインは自作より marketplace を先に見る**: `plugins.omarchy.org`（500件超）と awesome-omarchy の Plugins 節（Activity Monitor, GitHub inbox, Dock, Calendar 等40件超）を先に確認してから sketchybar 風のウィジェットを自作するか決める。出典: [aorumbayev/awesome-omarchy](https://github.com/aorumbayev/awesome-omarchy)、omarchy.org news「The first plugin competition」。
5. **バーを刷新したくなったら Shibumi-Shell を検討、ただしベータと割り切る**: 24プラグイン付きの native bar suite。出典: [HANCORE-linux/Shibumi-Shell](https://github.com/HANCORE-linux/Shibumi-Shell)（197★）。ピン留めされたビルド前提・AUR未公開・multi-output未検証である点は導入前に必読。
6. **テーマを流用するなら「最終pushの日付」より先に「open issueにquattroの破損報告が無いか」を見る**: dracula/omarchy 本家ですら Quattro 対応PRが未マージだった実例（否定側の証拠節）を踏まえ、awesome-omarchy 経由でテーマを拾う際のチェック項目として運用する。
7. **awesome-omarchy（aorumbayev版）をブックマークし、Wheel-Smith版は現行性を疑ってかかる**: 前者は2026-09-25も更新継続・CC0、後者はWaybar/Walker/Mako前提のまま2025-11-24で停止。同じ「awesome-omarchy」でも中身の鮮度が全く違う。
