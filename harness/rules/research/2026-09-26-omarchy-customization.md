# Omarchy (v4 Quattro) のカスタマイズ面 — バー位置・全カスタマイズ面・テーマ・キーバインド・実践者の型

調査日: 2026-09-26。前提（再調査しない、[2026-09-24-dotfiles-on-omarchy.md](2026-09-24-dotfiles-on-omarchy.md) から引き継ぐ）: Omarchy は現行 **v4.0.4 "Quattro"**（リポジトリ `omacom/omarchy`、ブランチ `quattro`）。waybar/mako/walker は廃止され、単一プロセスの Quickshell `omarchy-shell` に統合済み。Hyprland 設定は `.conf` ではなく **Lua**（`hyprland.lua` 他）。実践者は「Hyprland は `dofile()` で override を足すだけ、端末/エディタ/プロンプトは丸ごと置き換え」の二層に収束（typecraft-dev/omarchy-supplement）。この記録はその上に、(1) バー移動の具体手順、(2) カスタマイズ面の全体像、(3) テーマ機構、(4) キーバインド上書き構文、(5) 実践者の symlink 運用と既知の破壊事故、を追加する。

## 方法・検証凡例

- 直接取得（`curl` で生 HTML/生ソースを取得しテキスト抽出、または `raw.githubusercontent.com`/`api.github.com` を直叩き）: 明記なき引用はすべてこれ。
- `omarchy.org/manual` は Astro (SSR) サイトで、`<article>` 内にページ本文が生 HTML として届く。`learn.omacom.io` は別ドメイン（Basecamp Writebook 製のアプリで、ログイン UI のみを返しコンテンツ本文は確認できなかった — 未到達、詳細は「確認できなかったこと」）。**旧 v3 マニュアルとの重複はない**: `omarchy.org/manual` 自体が現行 Quattro 版を指しており、日付固定の別ドメインではなかった。
- リポジトリのブランチは `quattro`（デフォルトブランチ相当として2026-09-24調査記録が既に確認済み）。

---

## 問い1: 現行 Omarchy (v4 Quattro) のトップバー — 名前・リポジトリ・設定ファイルと書式、下へ移動する方法、モジュール/フォント/色の変え方

**バーの正体。** `omarchy.org/manual/the-top-bar/` を直接取得・逐語引用:

> "The strip along the top of your screen is the Omarchy bar. It's not a bolted-on status bar but part of the Omarchy shell, the single long-running Quickshell process that also draws the menu, the notifications, the OSD popups, and the lock screen."

**バーの構成（左/中央/右の3セクション、既定ウィジェット）**は同ページに逐語で列挙されている（左: メニュー起動+ワークスペース、中央: 時計/キーボードレイアウト/天気/更新バッジ、右: トレイ/agents/bluetooth/network/audio/display/power）。

**下へ移動する方法は3通り、すべてベンダー一次情報で確認済み:**

1. マウスドラッグ:
   > "Grab an empty patch of the bar around the center and drag it toward another screen edge, and the bar moves there - left, right, top, or bottom all work, and every widget adapts (vertical bars fall back to compact icon-only forms)."
2. メニュー: "Style → Menu Bar has both position and transparency."
3. **CLI（dotfiles 運用に向く経路）**:
   > "The same things have commands, which is what you want for a dotfiles setup:
   > `omarchy bar position bottom`
   > `omarchy bar transparent toggle`
   > `omarchy bar move omarchy.clock --section center --index 0`
   > `omarchy bar set omarchy.clock format "HH:mm"`
   > `omarchy bar defaults          # back to the shipped layout`"

`bin/omarchy-bar`（直接取得、リポジトリソース）の `cmd_position()` を確認すると、実装は単に `~/.config/omarchy/shell.json` の `bar.position` キーを `top|bottom|left|right` の正規表現でバリデートして `jq` で書き換えているだけの薄いラッパーである:

```bash
cmd_position() {
  local position="${1:-}"
  [[ $position =~ ^(top|bottom|left|right)$ ]] || fail "position must be top, bottom, left, or right"
  commit "$NORMALIZE | .bar.position = \$position" --arg position "$position"
  echo "Bar position set to $position"
}
```

**モジュール（ウィジェット）の追加・削除・並べ替え:**

> "To add or remove a widget entirely, use the plugin commands. `omarchy plugin list` prints every widget the shell knows about with its id, and then:
> `omarchy plugin enable omarchy.media --section center`
> `omarchy plugin disable omarchy.weather`"

順序変更は `omarchy bar move <id> [--section] [--index] [--before] [--after]`、既存ウィジェットの設定変更は `omarchy bar set <id> <key> <value> [--json]`（例: `omarchy bar set omarchy.clock format HH:mm`）。`bin/omarchy-bar` のソースには `put`（既存ウィジェットは動かさず新規だけ挿入）と `move`（section 間の移動）を明確に区別する実装があり、`move`/`set` は `omarchy-shell shell moveBarWidget`/`setBarWidget` という稼働中シェルへの IPC 呼び出しで、`shell.json` 直接編集ではなく実行中プロセスの状態を先に変える設計になっている。

**フォント**: バー専用のフォント設定は存在しない。フォントはシステム全体の等幅フォント設定と共有。`omarchy.org/manual/fonts/` を逐語引用:

> "Omarchy uses JetBrainsMono Nerd Font as both the terminal and system font by default. You can change this through the Style > Font menu in the Omarchy menu (Super + Space). That sets the monospace font everywhere: the terminal, the bar, and anything else that asks for it."

CLI 相当は `omarchy font set "<name>"`（`bin/omarchy-font-set`、`fc-list` でフォント存在確認後、Alacritty 設定などに `sed` で反映。バー自体のフォント適用はシェルプロセス側が同じシステムフォント設定を読む実装と推測されるが、`omarchy-font-set` のソース中にバー固有の反映処理は確認できず — [unverified]）。

**色**: バー専用の色設定キーは `shell.json` に存在しない。色は「テーマ」が一括で決める（問い3参照）。`omarchy.org/manual/themes/` 逐語引用:

> "Each theme styles the desktop, terminal, neovim, activity screen (btop), Chromium, and the entire Omarchy shell: top bar, menu, notifications, OSD, and the lock screen."

**設定ファイルそのもの**（`~/.config/omarchy/shell.json`、JSON）。同ページが「トリムした例」として掲載する構造を逐語引用:

```json
{
  "version": 1,
  "bar": {
    "position": "top",
    "transparent": false,
    "centerAnchor": "omarchy.clock",
    "layout": {
      "left": [{ "id": "omarchy.menu" }, { "id": "omarchy.workspaces" }],
      "center": [{ "id": "omarchy.clock", "format": "HH:mm" }],
      "right": [{ "id": "omarchy.audio" }, { "id": "omarchy.power" }]
    }
  }
}
```

同ページは「一度でも `shell.json` を持てばそれが正本になり、以後は deep merge されない」ことも明言している:

> "One rule worth internalizing: once you have your own shell.json, it's canonical. Until you customize anything, the shell reads Omarchy's default file. The moment you drag a widget, run `omarchy bar`, or edit the file yourself, you own it - there's no deep merge, so new default widgets in future Omarchy releases won't appear on your bar automatically. `omarchy bar defaults` puts the shipped layout back whenever you want a clean slate."

**この「deep merge しない」という説明には反例が確認できた（否定側の証拠として後述）**: migration `1790042972.sh`（"Install Elsewhen, the world clock plugin"）は `omarchy update` の一部として自動実行され、`omarchy-bar put omacom.elsewhen --before omarchy.clock` を無条件で呼び出す。`omarchy-bar put` は稼働中シェルの IPC 経由で `shell.json` にウィジェットを挿入する実装であり、これは「アップデートで新しいデフォルトウィジェットが勝手にバーへ現れることはない」というマニュアルの言明と矛盾する具体的な1件（詳細は「否定側の証拠」節）。

---

## 問い2: ユーザー向けカスタマイズ面の全体像 — どのファイルが「あなたのもの」か、Omarchy はどれを上書きしないと約束しているか、`omarchy-refresh-*`/update コマンドはどれをどう置き換えるか

**Manual `/manual/dotfiles/` の表**（2026-09-24記録で既に取得済みの表と一致、再掲しない）に加え、今回 `config/hypr/hyprland.lua` の実ファイル（直接取得）から override の配線を確認した:

```lua
-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")
```

この6ファイル（`hyprland.lua`, `monitors.lua`, `input.lua`, `bindings.lua`, `looknfeel.lua`, `autostart.lua`、加えて `.luarc.json`）が Hyprland 側のユーザー面。`~/.config/omarchy/shell.json` がバー/idle/lock を含むシェル側のユーザー面（前述）。

**「上書きしない」と明示的に約束されているのは `~/.bashrc` だけ**（2026-09-24記録で既に確認済みの逐語 "This file will not be overwritten on updates." を再確認）。それ以外（hypr の6ファイル、`shell.json`）は「あなたのファイル」ではあるが、上書きされない保証はない — 実装レベルでは以下の通り区別が要る:

1. **`omarchy update` の本体は `omarchy-refresh-*` を呼ばない。** `bin/omarchy-update`（直接取得、フル本文確認）の主な処理列は `omarchy-update-system-pkgs` → `omarchy-migrate` → `omarchy-update-aur-pkgs` → hooks → `omarchy-update-mise` であり、`omarchy-refresh-config`/`omarchy-refresh-hyprland`/`omarchy-refresh-shell` の呼び出しはこの本体スクリプトには一つも現れない。つまり **`omarchy update` 単体を実行しただけでは、ユーザーの hypr Lua ファイルや `shell.json` が自動で上書きされることはない**(この点は2026-09-24記録の「アップデートが『ときどき』既存設定をデフォルトへ戻す」という common-tweaks の言明を、実装レベルで裏取りし、経路を特定したことになる)。
2. **実際の書き換え経路は `migrations/*.sh`（124個超、番号は Unix タイムスタンプ）が個別に持つ。** `omarchy-migrate` が `omarchy update` の一部として毎回全件を順次実行する。今回サンプルとして直接取得した3件（`1790282866.sh`, `1790042972.sh`, `1790017600.sh`）のうち `1790042972.sh`（"Install Elsewhen, the world clock plugin"）は `omarchy-bar put omacom.elsewhen --before omarchy.clock` を条件なしに実行しており、**`shell.json` を自動更新する具体例が実際に本流のマイグレーションとして存在する**ことを確認した。他方、この3件には hypr Lua ファイルや `shell.json` 全体を `omarchy-refresh-config` で丸ごと上書きするものはなかった(GitHub Code Search API はレート制限/未認証で全 migrations を横断検索できず — `migrations/` 全件を対象に `omarchy-refresh-config` 呼び出しを網羅確認することはできなかった。[unverified: サンプル3件超の悉皆確認])。
3. **`omarchy-refresh-*` はユーザー起動（CLI/メニュー）のコマンド。** 一覧（`bin/` ディレクトリ直接確認）: `omarchy-refresh-applications`, `omarchy-refresh-chromium`, `omarchy-refresh-config`（汎用、引数にパス）, `omarchy-refresh-herdr`, `omarchy-refresh-hyprland`, `omarchy-refresh-hyprsunset`, `omarchy-refresh-limine`, `omarchy-refresh-pacman`, `omarchy-refresh-plymouth`, `omarchy-refresh-sddm`, `omarchy-refresh-shell`, `omarchy-refresh-tmux`。**foot/alacritty/ghostty/kitty/btop/git/starship.toml 専用の `omarchy-refresh-*` は存在しない** — これらは汎用 `omarchy-refresh-config <path>` でしか個別リセットできない。

`bin/omarchy-refresh-config`（フル本文、直接取得）の中核ロジック:

```bash
if [[ -f $user_config_file ]]; then
  cp -f "$user_config_file" "$backup_config_file"
  cp -f "$default_config_file" "$user_config_file"
  ...
else
  cp -f "$default_config_file" "$user_config_file"
fi
```

`.bak.$(date +%s)` へのバックアップは行うが、**`cp -f` はシンボリックリンクの中身を上書きする**（後述、issue #5013/#11096 の直接原因）。

`bin/omarchy-refresh-hyprland`（フル本文）は Lua 6ファイル+`.luarc.json` を**個別に** `omarchy-refresh-config` へ渡して全部リセットする:

```bash
omarchy-refresh-config hypr/.luarc.json
omarchy-refresh-config hypr/autostart.lua
omarchy-refresh-config hypr/bindings.lua
omarchy-refresh-config hypr/input.lua
omarchy-refresh-config hypr/looknfeel.lua
omarchy-refresh-config hypr/hyprland.lua
omarchy-refresh-config hypr/monitors.lua
```

**これは「Hyprland を Refresh」を一度実行すると、`dofile()`/`require()` で足しただけの override ファイル（`bindings.lua` 等）まで含めて全部空のテンプレートへ戻る、という pitfall である** — typecraft-dev/omarchy-supplement 方式（Hyprland は base を残して override を足すだけ）が安全なのは「アップデート自体」に対してだけで、「ユーザー自身が `omarchy refresh hyprland`（または menu の Update > Config → Hyprland）を叩く」操作に対しては無防備（4問目のピットフォールとしても再掲）。

`bin/omarchy-refresh-shell`（フル本文）:

```bash
omarchy-refresh-config omarchy/shell.json
omarchy-bar defaults
omarchy-restart-shell
```

こちらも `shell.json` を丸ごとデフォルトへ戻す。

---

## 問い3: テーマ機構 — ディレクトリ構造、`omarchy-theme-set`、テーマが覆う範囲、カスタムテーマの追加、dotfiles の13テーマは Omarchy テーマとして表現できるか

**テーマ数と対象範囲。** `omarchy.org/manual/themes/` 逐語:

> "Omarchy comes with twenty-two beautiful themes. ... Each theme styles the desktop, terminal, neovim, activity screen (btop), Chromium, and the entire Omarchy shell: top bar, menu, notifications, OSD, and the lock screen. (For Obsidian, you must manually select the Omarchy theme via Appearance > Themes inside the app)."

リポジトリ `themes/` 直下（直接取得、`ref=quattro`）の実ディレクトリ名22件: `catppuccin`, `catppuccin-latte`, `ethereal`, `everforest`, `flexoki-light`, `gruvbox`, `hackerman`, `kanagawa`, `last-horizon`, `lumon`, `lupine`, `matte-black`, `miasma`, `nord`, `osaka-jade`, `retro-82`, `ristretto`, `rose-pine`, `solitude`, `tokyo-night`, `vantablack`, `white`。(マニュアル本文の表示リストは19件しかテキスト抽出できなかった — `last-horizon`/`lupine`/`solitude` は恐らく画像 alt テキストが今回の抽出で欠落したもので、リポジトリの実ディレクトリの方が正の情報源。)

**ディレクトリ構造とテーマ本体。** `omarchy.org/manual/making-your-own-theme/` 逐語:

> "You can add your own themes to `~/.config/omarchy/themes`. Just copy one of the existing ones as a base (look in `/usr/share/omarchy/themes`), then tweak to your delight. As long as your theme is inside that folder, it'll be included in the theme selection menu. The main file you have to tweak is `colors.toml`."

`themes/nord/colors.toml`（フル本文、直接取得）— これが「一つの色定義ファイルから全アプリを生成する」中心ファイルの実物:

```toml
mode = "dark"
accent = "#81a1c1"
selection = "#434c5e"
muted = "#4c566a"
background = "#2e3440"
dark_background = "#222730"
darker_background = "#191c23"
lighter_background = "#3b4252"
foreground = "#d8dee9"
dark_foreground = "#667080"
light_foreground = "#adb5c4"
bright_foreground = "#d8dee9"
red = "#bf616a"
yellow = "#ebcb8b"
orange = "#d5967a"
green = "#a3be8c"
cyan = "#88c0d0"
blue = "#81a1c1"
magenta = "#b48ead"
brown = "#6a4b3d"
bright_red = "#bf616a"
bright_yellow = "#ebcb8b"
bright_green = "#a3be8c"
bright_cyan = "#8fbcbb"
bright_blue = "#81a1c1"
bright_magenta = "#b48ead"
```

**`omarchy-theme-set`（フル本文、直接取得）の実装が明かす仕組み**:
- テーマ切替は `~/.local/state/omarchy/current/next-theme` という一時ステージングディレクトリを作り、`$OMARCHY_PATH/themes/<name>/*` をコピーし、その上にユーザーの `~/.config/omarchy/themes/<name>/*` を重ねてから、atomically `mv` で `current` に差し替える（`rm -rf "$CURRENT_THEME_PATH"; mv "$NEXT_THEME_PATH" "$CURRENT_THEME_PATH"`）。
- 適用後に並列実行される post-hook 群（`post_theme_commands`）が実際の反映先を示している: `omarchy-restart-terminal`, `omarchy-restart-hyprctl`, `omarchy-restart-btop`, `omarchy-restart-opencode`, `omarchy-restart-helix`, `omarchy-theme-set-foot`, `omarchy-theme-set-tmux`, `omarchy-theme-set-gnome`, `omarchy-theme-set-pi`, `omarchy-theme-set-claude`, `omarchy-theme-set-hermes`, `omarchy-theme-set-t3code`, `omarchy-theme-set-browser`, `omarchy-theme-set-vscode`, `omarchy-theme-set-obsidian`, `omarchy-theme-set-keyboard`。これはマニュアルの「terminal, neovim, btop, Chromium, shell」という説明より実際は広く、pi・Claude・opencode・Helix・VSCode・GNOME・キーボードまで踏み込んでいることを実装から確認できた。

**外部リポジトリから `omarchy theme install` したテーマは、コードを実行しうるファイルを剥奪される。** `making-your-own-theme` 逐語:

> "A theme you install from someone else's repo with `omarchy theme install` keeps everything that's colour, and loses the handful of files that would run code on your machine: any `.lua` file, the terminal configs (`alacritty.toml`, `foot.ini`, `ghostty.conf`, `kitty.conf`), and `vscode.json`. ... Omarchy tells the two apart by whether the theme has its own git repo inside it, which is what `omarchy theme install` leaves behind when it clones. So a theme you wrote stays yours, and one you pulled off the internet stays colours."

`omarchy-theme-set` のソースコード内コメントがこの判定ロジックの根拠を明記している:

```bash
# What a theme installed from a git repo may not ship, because these run code.
# Hyprland requires a theme's hyprland.lua and gum_env.lua at login and Neovim
# loads its neovim.lua at startup, so no .lua from such a theme is staged at all.
INSTALLED_THEME_DENIED=(alacritty.toml foot.ini ghostty.conf kitty.conf vscode.json)
```

`theme_came_from_a_repo()`:

```bash
theme_came_from_a_repo() {
  local source="$1"
  [[ ! -L $source && -d $source/.git ]]
}
```

つまり **`~/.config/omarchy/themes/<name>/` に `.git` が無ければ「自作」扱いで何でも許され、`.git` があれば（クローンされたリポジトリなら）コード実行系ファイルが剥奪される**。ライトモードは `colors.toml` の `mode = "light"` で、アイコンは `icons.theme`、他アプリ用は `~/.config/omarchy/themed/*.tpl`（プレースホルダ `{{ background }}` 等）で対応するテンプレート機構も同ページに記載。

**dotfiles 側の13テーマとの適合性。** `home/shared/theme/default.nix`（本 worktree、直接確認）が管理する13パレット: `catppuccin`, `catppuccin-latte`, `dracula`, `everforest`, `everforest-light`, `gruvbox`, `kanagawa`, `nord`, `onedark`, `rosepine`, `solarized`, `tokyonight`, `tokyonight-day`。名前ベースで Omarchy の22テーマと重なるのは `catppuccin`/`catppuccin-latte`/`everforest`/`gruvbox`/`kanagawa`/`nord`/`rosepine`(→`rose-pine`)/`tokyonight`(→`tokyo-night`) の **8件**。`dracula`/`onedark`/`solarized`/`everforest-light`/`tokyonight-day` の5件は Omarchy 側に対応物がない。

パレットのスキーマは別物: dotfiles 側（`home/shared/theme/themes/nord.lua`、直接確認）は Catppuccin 由来の24キー構成（`rosewater`/`flamingo`/`pink`/`mauve`/`surface0-2`/`base`/`mantle`/`crust`…、`0xAARRGGBB` の Lua テーブル）で、Omarchy 側（`colors.toml`）は `background`/`foreground`/`accent`/`red`/`yellow`/`green`/`cyan`/`blue`/`magenta`/`orange`/`brown`/`bright_*`/`dark_*`/`light_*` という base16 寄りのフラットな TOML キー。**両者は直接ファイル互換ではないが、キー変換（rosewater→accent寄りの色、base→background、surface0→lighter_background 等)を書けば移植できる構造的類似性がある** — というのも、dotfiles 自身の設計（`default.nix` 冒頭コメント "One palette per theme ... linking the checkout's theme files" — 1つのソースから各アプリ設定を生成する設計）と Omarchy の `colors.toml`→全アプリ生成という設計は同じ思想であり、**Omarchy への統合は「13個の `colors.toml` を書く変換スクリプトを足す」問題に還元できる**、というのがこの調査から言える具体的な結論。ただし実際に変換して見た目が破綻しないかまでは検証していない（[unverified: 色変換の忠実度は未検証]）。

---

## 問い4: キーバインド — 上書き/unbind の安全な方法(ファイル・構文)と既知の落とし穴

**構文は `config/hypr/bindings.lua` のユーザースケルトン自体に例示コメントとして書かれている**(フル本文、直接取得):

```lua
-- Keep only your personal keybinding overrides here. Add new bindings with
-- o.bind or replace defaults with o.rebind.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding. o.rebind takes the same arguments as o.bind.
-- This example replaces the default file manager with Flea.
-- o.rebind("SUPER + SHIFT + F", "File manager", { launch = "flea" })

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")
```

つまり3つのプリミティブ:
- **`o.bind(keys, description, command_or_table)`** — 新規バインド追加。
- **`o.rebind(keys, description, command_or_table)`** — 既定バインドの置き換え（引数は `o.bind` と同一シグネチャ）。
- **`hl.unbind(keys)`** — 既定バインドを何にも割り当てずに無効化するだけ。

これは全て `~/.config/hypr/bindings.lua`（ユーザーの override ファイル）に書く。`hyprland.lua` 側にはグローバルフラグが2つ:
- `omarchy_default_bindings = false` — Omarchy の既定バインドを全部無効化（`require("default.hypr.omarchy")` の**前**に置く必要がある、という順序制約がコメントに明記）。
- `omarchy_preinstalled_bindings = false` — プレインストールアプリ/Webアプリのバインドだけ無効化し、コアな WM バインドは残す。

現在のバインド一覧・説明の確認コマンドも判明: `omarchy menu keybindings --print`。

**既知の落とし穴（実装から確認できたもの）:**

1. **`omarchy refresh hyprland`（または Update > Config → Hyprland 相当）は `bindings.lua` を含む override ファイル6本を無条件で初期テンプレートへ戻す**（問い2で確認した `omarchy-refresh-hyprland` の実装、`omarchy-refresh-config hypr/bindings.lua` を個別に呼ぶ）。`dofile()`/`require()` パターンで安全にしていたつもりの override が、アップデートそのものではなく「Hyprland 設定をリフレッシュする」という別の操作一発で失われる。`.bak.<timestamp>` に退避はされるが、無警告で気づかれにくい。
2. **`omarchy_default_bindings = false` の設置順序を間違えると効かない** — コメントが "before `require("default.hypr.omarchy")`" と明記しているのは、Lua ファイルは上から順に実行されるため、フラグを読む前に既定バインドが `require` で読み込まれてしまうと手遅れになる、という Lua の実行順制約に起因する落とし穴。
3. 2026-09-24記録の #9326（`mktemp`+`mv` によるファイルモード 0600 化、`config-rewriting migrations` 全般が対象）は `bindings.lua` を含む hypr Lua 群にも構造的に当てはまりうる（migrations が `omarchy-refresh-config` 相当の `mktemp`+`mv` パターンを使う場合、chezmoi/yadm のような「ファイルモードを記録する」ツールでの追跡に影響）— 個別の bindings.lua 事故は確認できていない(過去記録の一般論の延長、[unverified: bindings.lua 固有の報告なし])。

---

## 問い5: 実践者の管理方法（symlink vs copy、`cp -f`/`mv` を踏まえて）と、既知の破壊インシデント

**2026-09-24記録で既に確認済みの4件を再確認（すべて2026-09-26時点でも `state: open` のまま、`updated_at` を今回改めて直接取得）:**

| Issue/PR | タイトル | state | 直近更新 |
|---|---|---|---|
| #5013 | omarchy-refresh-config shouldn't override symlinked file content | open | 2026-03-14 |
| #11096 | Prevent shell.json edits from replacing symlinked configs | open | 2026-09-10 |
| #9326 | Config-rewriting migrations reset file mode to 0600 via `mktemp` + `mv` | open | 2026-09-02 |
| #10413 | Harden omarchy-refresh-config against path traversal | open | 2026-09-23 |

2週間経過してもすべて未マージのまま — vendor 側の対処優先度が低い、または実装の見直しが必要な範囲が広い、のどちらかを示唆する(理由の一次資料は無い、[unverified])。

**今回新たに実装から確認した、上記4件を裏付ける直接の原因コード。** `bin/omarchy-refresh-config` の中核部分（フル本文、既出）が使う `cp -f` は、ターゲットが symlink であってもリンク先の実体ファイルを上書きする（symlink 自体を差し替えず、指し先の中身を書き換える）。一方 `omarchy-shell-config`（`bin/omarchy-bar` 等が `source` する共有ヘルパー、フル本文取得済み）の `commit()` 関数は:

```bash
commit() {
  local program="$1"
  shift
  mkdir -p "$(dirname "$CONFIG_FILE")"
  _SHELL_CONFIG_TMP=$(mktemp)
  jq -S -e "$@" "$program" "$(source_file)" >"$_SHELL_CONFIG_TMP" || fail "could not update shell config"
  mv "$_SHELL_CONFIG_TMP" "$CONFIG_FILE"
  ...
}
```

ここでの `mv "$_SHELL_CONFIG_TMP" "$CONFIG_FILE"` は #11096 が報告する「`mv` onto a symlink replaces the link itself」の直接の実装原因そのもの — `omarchy bar position bottom` のような**問い1で紹介した「dotfiles 向け」の推奨コマンド自体が、`~/.config/omarchy/shell.json` を symlink 管理している場合にそのリンクを消して実体ファイルに置き換えてしまう**、という構造的な矛盾がここで確認できた。つまり **Q1 の推奨コマンド (`omarchy bar ...`) と Q5 の「dotfiles で symlink 管理」は、`shell.json` を symlink にしている限り両立しない**、という具体的で否定的な結論になる。

**実践者の型は2026-09-24記録の内容から変わっていない**（再調査せず要点のみ引用）: typecraft-dev/omarchy-supplement が「Hyprland は `dofile()` で override を足すだけ、端末/エディタ/プロンプトは `rm -rf` してから stow で丸ごと置き換え」という二層、sspaeti/dotfiles が macOS+Omarchy を1つの stow リポジトリで共有する実例、公式 Discussion #3796 では chezmoi が定性的優勢。今回の追加調査で分かったのは、**この「二層」の安全性は Hyprland 側にしか及ばない** ということ — `shell.json`（バーの位置・レイアウト）を symlink 管理下に置くこと自体は manual が明示的に "the manual recommends (Stow)" と #11096 の報告者が書いている通り勧められているにもかかわらず、`omarchy bar` コマンド群も `omarchy-refresh-shell` も内部で `mv`/`cp -f` を使うため、symlink 管理が最も脆いのは実は Hyprland の Lua ファイル群ではなく **`shell.json`** だと言える。

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **「アップデートで新しいデフォルトウィジェットが勝手に出ることはない」という manual の言明に対する具体的な反例**: `migrations/1790042972.sh`("Install Elsewhen, the world clock plugin")が `omarchy update` の一部として無条件に `omarchy-bar put omacom.elsewhen --before omarchy.clock` を実行し、稼働中シェルの IPC 経由で `shell.json` にウィジェットを追加する。manual `/manual/the-top-bar/` の "there's no deep merge, so new default widgets in future Omarchy releases won't appear on your bar automatically" という説明は、この1件に関しては成り立たない。
- **Q1 の推奨コマンド自体が Q5 の symlink 運用を壊す**: `omarchy bar position bottom` 等の内部実装（`omarchy-shell-config` の `commit()`）は `mktemp`+`mv` で `shell.json` を書き換えるため、#11096 と同一の原因で symlink を破壊する。「dotfiles 運用にはこのコマンドを使え」という manual の推奨文言と、「stow で symlink 管理せよ」という同じ manual の別ページの推奨文言が、実装レベルで両立しない。
- **`omarchy refresh hyprland` は override ファイルそのものを消す**: `dofile()`/`require()` パターンで「Hyprland のベースは壊さず override だけ足す」という2026-09-24記録の安全策は、アップデート自体に対しては有効でも、`omarchy-refresh-hyprland`(`bindings.lua` を含む6ファイルを個別に `omarchy-refresh-config` で全部リセットする実装)というユーザー起動コマンド一発に対しては無防備。
- **#5013/#11096/#9326/#10413 は2026-09-24から2日経っても未変化**(全部 open のまま) — vendor 側の対応が進んでいる形跡は今回の再確認では見られなかった。
- **`omarchy dots`(bare-git によるユーザー設定の一次差分管理機能)は今回も bin/ に実体が見当たらず**、2026-09-24記録の「plan 段階で未出荷」という結論から変化なし。

---

## 確認できなかったこと

- **`learn.omacom.io` の本文コンテンツ** — Basecamp Writebook 製のアプリで、直接取得した HTML はログイン/セッション UI のアセット一覧のみで本文テキストが確認できなかった。タスクが指定した「learn.omacom.io current edition」の内容そのものは未到達。代わりに `omarchy.org/manual`(Astro SSR、ログイン不要、本文が直接取得できた)を一次資料として使った — この2つが同一内容の別ドメインなのか、`learn.omacom.io` が非公開/別コンテンツなのかは未確認。
- **`migrations/*.sh` 124件超の悉皆確認** — GitHub Code Search API がレート制限/未認証で使えず、サンプル3件のみ直接取得した。`omarchy-refresh-config`/`omarchy-bar put` 相当の自動書き換えを行う migration が他に何件あるかは未確認。
- **`omarchy-font-set` がバー自体のフォント表示にどう反映されるか** — ソース冒頭(Alacritty 設定への `sed` 反映)は確認したが、Quickshell 側(バー)への反映経路の実装は未確認。
- **manual `/manual/themes/` の画像専用テーマ3件**(`last-horizon`/`lupine`/`solitude`)の説明文 — リポジトリのディレクトリ名としては確認できたが、alt テキストがテキスト抽出に乗らず、マニュアル本文としての紹介文は未取得。
- **dotfiles 側13パレットを実際に `colors.toml` へ変換した場合の見た目の忠実度** — キー変換の対応関係(rosewater→accent 寄り、base→background 等)は構造的に立てられるが、実際に変換して Omarchy 上でレンダリングして比較する検証は行っていない。
- **`bindings.lua` 固有の破壊事故報告** — #9326(ファイルモード 0600 化)は hypr Lua 群一般への構造的リスクとして書かれているが、`bindings.lua` を名指しした個別のインシデント報告は見つからなかった。

---

## 結論

**問い1(バー)**: 現行の「トップバー」は Quickshell 統合の `omarchy-shell` プロセスの一部で、専用の名前を持つ独立コンポーネントではない。設定ファイルは `~/.config/omarchy/shell.json`(JSON、`bar.position`/`bar.layout.{left,center,right}`/`bar.transparent`/`bar.centerAnchor` 等)。下へ移す最も dotfiles 向きの方法は `omarchy bar position bottom`(内部は `jq` で `shell.json` を書き換えるだけの薄いラッパー)。モジュールは `omarchy plugin enable/disable`、`omarchy bar move/put/set`。フォントと色はバー個別ではなく「システムフォント」(`omarchy font set`)と「テーマ」(`omarchy theme set`)がバーを含む全体に一括反映する仕組みで、バー単体の色設定キーは存在しない。

**問い2(全体像)**: 「あなたのファイル」として manual が明示するのは hypr の6 Lua ファイル+`.luarc.json`、`~/.config/omarchy/shell.json`、terminal 設定、`~/.bashrc`、`~/.XCompose`。**上書きしないと明示的に約束されているのは `~/.bashrc` だけ**。`omarchy update` 本体(`bin/omarchy-update`)は `omarchy-refresh-*` を呼ばず、実際の自動書き換え経路は `omarchy-migrate` が回す `migrations/*.sh` 個々のスクリプト(1件は `shell.json` へのウィジェット自動追加を確認)。`omarchy-refresh-hyprland`/`omarchy-refresh-shell`/汎用 `omarchy-refresh-config <path>` はユーザーが CLI/メニューから明示的に叩くコマンドで、いずれも `cp -f`/`mv` ベースの実装のため symlink を破壊する。

**問い3(テーマ)**: `~/.config/omarchy/themes/<name>/colors.toml` が中心ファイルで、`mode`/`accent`/`background`系/`red`〜`brown`系/`bright_*` という base16 寄りのフラットな TOML キー。`omarchy-theme-set` はステージングディレクトリでの atomic swap を行い、pi・Claude・opencode・Helix・VSCode・GNOME・キーボードまで含む広範な post-hook でテーマを反映する。git clone されたテーマ(`.git` の有無で判定)は `.lua`/端末設定/`vscode.json` を自動的に剥奪され「色だけ」になる、というコード実行防止の仕組みがある。dotfiles の13テーマ中8件(catppuccin/catppuccin-latte/everforest/gruvbox/kanagawa/nord/rosepine/tokyonight)は名前ベースで Omarchy の22テーマと重複し、両者とも「1つの色定義ファイルから全アプリの設定を生成する」という同じ設計思想を持つため、**キー変換スクリプトを書けば Omarchy テーマとして表現するのは構造的に無理がない**(ファイル形式・キー名は別物なので変換は必須、忠実度は未検証)。

**問い4(キーバインド)**: `~/.config/hypr/bindings.lua` に `o.bind()`(新規)、`o.rebind()`(置換)、`hl.unbind()`(無効化のみ)を書く。全既定バインドの一括無効化は `hyprland.lua` で `require("default.hypr.omarchy")` より**前**に `omarchy_default_bindings = false` を置く(順序を間違えると効かない)。最大の落とし穴は `omarchy refresh hyprland` が `bindings.lua` を含む override ファイル全部を無条件でテンプレートへ戻すこと — アップデートそのものではなく、ユーザー自身がこのコマンドを叩く操作に対して無防備。

**問い5(実践者と事故)**: 2026-09-24記録の実践者の型(typecraft-dev の二層、sspaeti の共有 stow リポジトリ、公式 Discussion での chezmoi 優勢)、および4件のオープンな issue(#5013/#11096/#9326/#10413、2026-09-26時点で全て未マージのまま)は変化なし。今回新たに実装コードで裏取りできたのは、**Q1 で紹介されている「dotfiles 向け」の `omarchy bar` コマンド群自体が、`shell.json` を symlink 管理している場合にそのリンクを破壊する**という具体的な矛盾で、これは manual の「Stow を勧める」ページと「dotfiles 向けにこのコマンドを使え」というページが、実装レベルでは両立しないことを意味する。dotfiles マネージャ(home-manager 含む)が Omarchy 上のこれらファイルを symlink で管理する設計を取るなら、**`shell.json` とバー設定は「symlink で管理しつつ `omarchy bar`/`omarchy plugin` コマンドは使わない」か「コマンドで運用しつつ symlink を諦める(copy + 差分検知)」のどちらかを選ぶ必要がある**、という設計上のトレードオフとして扱うべきである。
