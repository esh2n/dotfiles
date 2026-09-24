# Omarchy 上で個人 dotfiles を重ねる方法 — 4レンズ調査

調査日: 2026-09-24。前提（再調査しない）: flake の形は hostname キー付き共有関数、macOS は nix-darwin+home-manager、Linux (Omarchy) は plain Nix 上の standalone `homeConfigurations."<user>@<host>"`、henrysipp/omarchy-nix は却下済み。

対象バージョン: Omarchy は現在 **v4.0.4 "Quattro"**（リポジトリは `basecamp/omarchy` から **`omacom/omarchy`** に移動済み。star 42,928、`pushed_at: 2026-09-24T04:45:27Z` — ほぼ常時活発）。Quattro は Waybar/Mako/Walker を捨てて Quickshell 製の単一プロセス `omarchy-shell` に置き換え、Hyprland 設定も `.conf` から **Lua**（`hyprland.lua` 他）に移行済み。設問が前提にしていた「`~/.config/hypr/*.conf`」「waybar/walker/mako」は v1〜v3 世代の話で、v4 (Quattro) では成立しない。この版ズレ自体が最初の発見。

## 方法・検証凡例

- 直接取得（curl で生 HTML/生ソースを取得しテキスト抽出、または `api.github.com`/`raw.githubusercontent.com` を直接叩いた）: 明記なき引用はすべてこれ。
- 要約経由（WebFetch の要約モデルを通した）: 該当箇所に「〔要約経由〕」と明記。
- 未到達: 該当箇所に明記。今回は主要ソースはすべて直接取得できた。
- `gh` CLI 認証は壊れていたため（`gh auth status` が invalid token を報告）、`api.github.com` への `curl` 直叩き（認証なし、レート制限内）で代替した。

---

## 問い

1. Omarchy は「アップデートで上書きされない」個人カスタマイズをどう想定しているか。どの設定（hypr/waybar/walker/mako/terminal/btop/starship/mise/fonts/git/shell）を Omarchy が所有し書き換えるか、どれが外部 dotfiles マネージャに任せて安全か。
2. Omarchy に自分の dotfiles を持ち込む人は実際に何を使っているか（stow/chezmoi/home-manager standalone/yadm/生シンボリックリンク）。
3. 既知の失敗事例（`omarchy-update`/`omarchy-refresh-*` によるシンボリックリンク破壊、stow との衝突、Arch 上の home-manager 問題、mise と Nix のツールチェーン衝突）。
4. macOS 固有部分の Linux 対応物（launchd→systemd --user、Keychain→libsecret/`secret-tool`/`op`、`pbcopy`→`wl-copy`、Homebrew casks→pacman/AUR/Nix、LM Studio の Linux ビルドと `lms`/`llmster` CLI の状況）。

---

## 各レンズの所見

### 1. ベンダー（omarchy.org/manual, omarchy.org/news, github.com/omacom/omarchy）

**「`~/.config` はユーザーのもの」という公式方針。**
Manual `/manual/dotfiles` (https://omarchy.org/manual/dotfiles) より、直接取得の生テキストから逐語引用:

> "Omarchy is primarily configured through the so-called dotfiles that live in `~/.config`. Those are considered your files for your changes. The files that live in `/usr/share/omarchy` belong to Omarchy itself, and you shouldn't be messing with those. If you need to change anything in `/usr/share/omarchy`, you should be overwriting the value in `~/.config` instead."

同ページが挙げる「ユーザーが触ってよい主要ファイル」表（逐語）:

| File | Purpose |
|---|---|
| `~/.config/hypr/hyprland.lua` | The main Hyprland config. Loads the Omarchy defaults plus your override files below. |
| `~/.config/hypr/bindings.lua` | Your own keybindings and overrides of the defaults. |
| `~/.config/hypr/monitors.lua` | Controls your monitors, resolution, and position. |
| `~/.config/hypr/input.lua` | Controls your keyboard layout, mouse, and trackpad settings. |
| `~/.config/hypr/looknfeel.lua` | Controls gaps, borders, animations, and the rest of the look. |
| `~/.config/hypr/autostart.lua` | Controls extra processes started with the session. |
| `~/.config/omarchy/shell.json` | Controls the Omarchy shell: bar position, layout, and widgets, plus screensaver, lock, and idle timings. |
| `~/.config/foot/foot.ini` | Controls your terminal (foot is the default). |
| `~/.XCompose` | emoji/name/email autocomplete; requires `omarchy-restart-xcompose` after edits. |

同ページはさらに、この表の直後に stow を名指しで推している:

> "If you end up making a lot of changes to tweak your own setup, it's a good idea to backup all these dotfiles. [Stow is a great way to do that](https://www.gnu.org/software/stow/)."

シェル拡張の公式回答（bash 前提）:

> "You should add both aliases, functions, and exports in `~/.bashrc`. This file will not be overwritten on updates. If you want to change any of the Omarchy defaults, you can also safely add them here."

一方で内部ファイルへの手出しは明確に非推奨:

> "I would advise against making changes to the files in `/usr/share/omarchy` directly. They belong to the Omarchy pacman package, so your changes will simply be overwritten on the next update."

**リセット手段は3段階。** `omarchy reinstall configs`（個別ファイル1つをデフォルトへ戻す。Update > Config メニュー相当）と `omarchy-reinstall`（全設定を破壊的にリセット）が別物であることは Manual `/manual/updates` (https://omarchy.org/manual/updates) にも明記:

> "If somehow your configuration files have been corrupted, you can also perform an Omarchy reinstall using `omarchy reinstall` in the terminal. ... Note that all your user config changes to the Omarchy defaults will be overwritten doing this!"

`/manual/common-tweaks` (https://omarchy.org/manual/common-tweaks) は、アップデートが「ときどき」既存設定をデフォルトへ戻す可能性があることも明言し、その際は `.bak` に退避されるとしている:

> "Know that it might occasionally be necessary for system updates to restore certain configs to their original condition. If this happens, your changes won't be lost, but put in a `.bak` file in the same directory."

**リポジトリ実装で裏取りした所有範囲。** `config/` ディレクトリ（`omarchy-refresh-config` のコピー元、`$OMARCHY_PATH/config/<path>` → `~/.config/<path>`）の中身を直接確認（https://api.github.com/repos/omacom/omarchy/contents/config?ref=quattro）:

```
alacritty, autostart, btop, chromium(-flags.conf), fcitx5, foot, ghostty,
git, herdr, hypr, hyprland-preview-share-picker, imv, kitty, lazygit,
obsidian, omarchy, opencode, starship.toml, tmux, wireplumber, xournalpp
```

つまり Omarchy が「配布・上書き対象として把握している」ユーザー設定は **hypr / foot・alacritty・ghostty・kitty(=terminal 全般) / btop / git(`~/.config/git/config`) / starship.toml / tmux / herdr** まで及ぶ。**waybar・mako・walker はこのリストに存在しない**（Quattro で廃止されたため）。`install/omarchy-base.packages` にも waybar/mako/walker/wofi/rofi の記載はなく、`power-profiles-daemon` のみが近い語でヒットした（https://raw.githubusercontent.com/omacom/omarchy/quattro/install/omarchy-base.packages）。

`config/git/config` の中身を直接取得（https://raw.githubusercontent.com/omacom/omarchy/quattro/config/git/config）すると、alias・rebase・autoSetupRemote 等の一般的な既定値が並ぶだけで、これは `~/.config/git/config`（XDG パス）に配置される。Git は `~/.gitconfig` が存在すればそちらを優先して `~/.config/git/config` を読まない（git-config(1) の一般的な挙動）ため、**ユーザーが `~/.gitconfig` を own すれば Omarchy の git 既定値は自動的に無効化できる** — git は外部マネージャに安全に譲れる領域。

mise は Omarchy が自分で導入・自分で更新する。`bin/omarchy-update-mise` を直接取得（https://raw.githubusercontent.com/omacom/omarchy/quattro/bin/omarchy-update-mise）:

> "# mise withholds releases younger than its cooldown, so tools stay behind for days after they ship. Running omarchy update is the user asking for current versions now ... MISE_MINIMUM_RELEASE_AGE=0 mise up"

`install/omarchy-other.packages` に `mise-bin` パッケージが含まれることも確認済み。つまり mise は Omarchy 自身のツールチェーン管理の一部であり、`omarchy update` の一部として `mise up` が自動実行される。

**「migrations」機構の実体。** リポジトリ直下 `migrations/` は124個のタイムスタンプ付き `*.sh` からなる（https://api.github.com/repos/omacom/omarchy/contents/migrations?ref=quattro）。`bin/omarchy-migrate` が `omarchy update` の一部として順次実行する。Manual `/manual/updates` の該当記述:

> "an update installs the latest Omarchy release, runs any pending migrations to get your system in sync with the latest"

**`omarchy-refresh-config` の実装**（直接取得、https://raw.githubusercontent.com/omacom/omarchy/quattro/bin/omarchy-refresh-config）は、ユーザーファイルを `.bak.$(date +%s)` にコピーしてから `$OMARCHY_PATH/config/<path>` を `~/.config/<path>` に `cp -f` で上書きする、という設計だった（後述、これがシンボリックリンクを壊すバグの原因）。

**`omarchy-reinstall-configs` の実装**（https://raw.githubusercontent.com/omacom/omarchy/quattro/bin/omarchy-reinstall-configs）はさらに破壊的で `/etc/skel` を `$HOME` へ丸ごと再コピーする:

> "cp -af /etc/skel/. ~/" — コメントいわく "/etc/skel is the same tree useradd -m copies to seed a fresh user's $HOME. Replaying it over an existing user resyncs every package-shipped user default in one pass: .bashrc, .config/**, .local/share/applications, ..."

これは `.bashrc` を含む全既定ファイルを再展開する、明確に破壊的な操作（スクリプト冒頭コメントに "(destructive)" と明記）。

**ベンダー自身が「不十分」と認めている。** リポジトリの `plans/dots.md`（https://raw.githubusercontent.com/omacom/omarchy/quattro/plans/dots.md、rev.3、未出荷の設計文書）が現状の弱点を率直に書いている:

> "Omarchy declares `~/.config` 'your files' but does little to preserve them: `omarchy-refresh-config` litters `*.bak.<timestamp>` files next to originals. `omarchy-reinstall-configs` clobbers everything back to `/etc/skel` defaults. ... The manual punts to a YouTube video about Stow."

同文書は Stow / chezmoi / yadm を将来の一次機能としては明示的に不採用としつつ、外部マネージャの共存には配慮する設計を選んでいる:

> "**Stow**: inverted model requiring file migration; organization, not history." / "**chezmoi / yadm**: third-party DSLs we'd be wrapping; overkill."

> "### Dotfile-manager detection: stand down, don't fight — `manual/31-dotfiles.md` sends users to Stow today, and migrations deliberately write *through* symlinks. ... At seed time and before each snapshot: if manifest paths are symlinks or a known manager (yadm, chezmoi, existing bare-repo alias, `~/.git`) is detected, mark the repo dormant and say so in `omarchy dots status`."

これは vendor が将来実装する `omarchy dots`（`$HOME` 上の bare git リポジトリによる差分履歴＋複数マシン同期機能）の設計であり、**2026-09-24 時点で未出荷（plan 段階）**。現行版で「アップデートで消えない個人設定」を実現する一次機能は無く、`.bak` retention と `Update > Config` の個別リストアだけが公式に用意されている。

### 2. 実践者（GitHub 上の omarchy 系 dotfiles リポジトリ、omarchy 公式 Discussion）

**GitHub 検索件数（2026-09-24 時点、`api.github.com/search/repositories`）:**

| クエリ | ヒット数 | 最多star |
|---|---|---|
| `omarchy dotfiles` | 703 | henrysipp/omarchy-nix (804, ただし既に却下済みの対象) |
| `omarchy stow` | 35 | tomhayes/omadot (61) |
| `omarchy chezmoi` | 26 | bandoyer/dotfiles (1) |
| `omarchy home-manager` | 9 | henrysipp/omarchy-nix (804, NixOS路線で対象外) |

**GNU Stow が最も星を稼ぐ専用ツール。** tomhayes/omadot（stow のラッパー CLI、61 star）の README を直接取得（https://raw.githubusercontent.com/tomhayes/omadot/main/README.MD）:

> "This tool was originally designed for use with [Omarchy](https://omarchy.org/), but it should work well on any Linux distribution or macOS." / "Omadot applies Omarchy's opinionated methodology to your dotfiles. It manages them from a `~/.dotfiles` directory ... managing configuration discretely for each package"

パッケージ単位で `~/.config` と `~`（home 直下ファイル）を両方扱える設計。マルチOS（macOS込み）共有は「できるはず」という自己申告レベルで、実績としての検証は書かれていない。

**個別パッケージ単位で「これは Omarchy に任せ、これは自分で置き換える」を使い分ける実例。** typecraft-dev/omarchy-supplement（89 star、"additional packages, dotfiles, and overrides. to be used AFTER installing omarchy"）を直接取得すると:

- `install-dotfiles.sh`（https://raw.githubusercontent.com/typecraft-dev/omarchy-supplement/main/install-dotfiles.sh）は `stow zshrc / ghostty / tmux / nvim / starship` を実行する前に `rm -rf ~/.config/tmux/tmux.conf ~/.config/nvim ~/.config/starship.toml ...` で Omarchy 既定を破壊的に除去 — **端末/エディタ/プロンプトは丸ごと置き換える**方針。
- `install-hyprland-overrides.sh`（同リポジトリ）は逆に hyprland.lua 自体を上書きせず、末尾に `dofile("<overrides.lua>")` を1行追記するだけ — **Hyprland は Omarchy 自身の base を残したまま override ファイルを足す**方針。スクリプト内には「pre-Lua」(`hyprland.conf`/`source =`) からの移行コードも同梱されており、Quattro の `.conf`→`.lua` 移行を実際に追跡し続けている生きたリポジトリだと確認できた。
- `set-shell.sh` で `chsh -s $(which zsh)` を実行 — zsh への切り替えも定型パターン。

**Simon Späti（データエンジニアリング分野で知られるブロガー、ssp.sh）の実例。** sspaeti/dotfiles（244 star、2026-09-23 push）README（https://raw.githubusercontent.com/sspaeti/dotfiles/master/README.md）:

> "**OS** Linux with [Omarchy](https://omarchy.org) (since July 2025, before macOS)" / "I use [Stow](https://www.gnu.org/software/stow/) to manage my dotfiles. I created a [Makefile](Makefile) to stow them for Mac and Linux respectively." / "My setup is I clone this dotfiles repo in `~/git/general/dotfiles` and in `~/.stowrc` I set the target stow directory"

**macOS と Omarchy を1つのリポジトリで stow により共有**しており、`make mac` / `make linux` で OS ごとに共通＋固有パッケージを stow する構成。zsh は oh-my-zsh を別途導入（README 内 "Oh-my-zsh" セクション）— **Omarchy の bash 既定を明示的に zsh へ切り替えている**実例。stow で管理しないファイルは「reference として手動同期」と明言:

> "There are some root files not handled with Stow. These are just keep in my dots as reference and are manually kept up to date."

ただし `backup_dotfiles_arch.sh`（同リポジトリ、直接取得）は `~/.config/waybar/`・`~/.config/walker/`・`~/.config/mako/`・`~/.local/share/omarchy/default/hypr/*` を参照しており、**これは Quattro 以前（waybar/walker/mako 時代、`~/.local/share/omarchy` パス時代）の Omarchy に対する記述** — このリポジトリのこの部分は現行 Quattro には当てはまらない、という否定的知見でもある（README 本文の "since July 2025" 時点の版に基づく）。

**本人のブログ記事**（https://www.ssp.sh/blog/macbook-to-arch-linux-omarchy/、〔要約経由〕WebFetch）は、5年落ちの M1 Max MacBook Pro から Omarchy 搭載 Lenovo ThinkBook への移行理由を「Yabai が最新アップデートで動かなくなった」「アップデートのたびに確認ダイアログが煩わしい」からと説明。Stow やシェルの詳細には触れておらず、「Omarchy がアップデートで設定を壊した」という直接の訴えは記事中に確認できなかった（=この記事単体では該当する否定的事例は見つからず）。`/etc/sudoers` を誤編集して sudo を失った、という自己責任の事故が1件記録されている。

**公式 Discussion スレッドでの合意形成（chezmoi 優勢）。** `omacom/omarchy` Discussion #3796「What tools do you use for Omarchy dotfile management and configuration?」（https://github.com/omacom/omarchy/discussions/3796）のコメントを直接取得すると:

- knothhe: "I use [chezmoi](https://github.com/twpayne/chezmoi) for both macOS and omarchy, it's great."
- EFrMG: "after quite some time of use and looking around for real alternatives myself, that nothing quite surpasses Chezmoi."
- farangkao: "chezmoi is great. i use it daily ... Especially useful to setup multiple machines with the same configs." / "chezmoi supports ignore files, so you can specify in the root folder which folders or file types it shouldn't track."
- iop098321qwe: "I use Chezmoi pretty regularly as well, and I think @dhh could work some real magic by integrating something like it directly into Omarchy. ... having a built-in way to sync our preferred settings, dotfiles, and configuration changes across systems would be incredibly useful."
- ghrubi: GNU Stow を使う YouTuber Typecraft の動画を紹介（"He uses GNU Stow."）。

このスレッドでは chezmoi が最有力の推薦、Stow が次点というのが実践者の生の声。GitHub 検索の星数（stow系35件/chezmoi系26件、最多star は stow 系 tomhayes/omadot が上）と、Discussion の定性的な支持（chezmoi推し）はやや矛盾する — **量（リポジトリ数・star）では stow、質的合意（公式スレッドでの推薦の強さ）では chezmoi**、という食い違いがあることをそのまま記録する。

**home-manager standalone をコミュニティが独自にガイド化した例。** `omacom/omarchy` Discussion #987「Omarchy + Nix Home Manager Integration」（https://github.com/omacom/omarchy/discussions/987、投稿者 mwaltzer）を直接取得。要点:

> "Works on Omarchy v3.1.7" — 更新履歴に "2025-09-04: Updated for Omarchy v2.1.x shell behavior — Removed references to ~/.bashrc.omarchy and ~/.zshrc.omarchy. Bash now sources $HOME/.local/share/omarchy/default/bash/rc if present. Noted that Omarchy does not ship a zsh rc in v2.1.x; keep zsh init in HM."

インストール手順は **公式 Nix installer を `--daemon`（multi-user）モードで**使う:

> "sh <(curl -L https://nixos.org/nix/install) --daemon" — 理由として "Why daemon mode? ... Provides better build isolation and security through dedicated build users / Prevents privilege escalation attacks"

コメント欄で careb0t が「v3.1.x や v3.0.x でも動くか」と質問し、mwaltzer が "Yup, still works as-is! No changes needed." と回答（2025-11-17）。**ただし Quattro (v4.x) でこのガイドが動作するかの確認コメントは無い** — Quattro の Quickshell/Lua 移行を踏まえた更新履歴が存在しないため、現行版での有効性は未検証のまま。

### 3. 測定・インシデント（Issue/PR ベース、番号・日付・状態つき）

`api.github.com/search/issues` を直接叩いて `repo:omacom/omarchy` を対象に検索。

**シンボリックリンクをアップデート機構が壊す、という設問通りの不具合が複数、すべて "open"（2026-09-24 時点で未解決）:**

- **PR #5013**「omarchy-refresh-config shouldn't override symlinked file content」(open, 2026-03-14) — 報告者は stow ユーザー。逐語:
  > "Some of my `.config` files are symlinks (managed by gnu stow). ... When the default config is copied over, it override the file pointed by the symlink and not the actual symlink file"
- **Issue/PR #11096**「Prevent shell.json edits from replacing symlinked configs」(open, 2026-09-10) — Manual が Stow を推奨していることへの直接の反例:
  > "I keep `~/.config/omarchy/shell.json` symlinked into my dotfiles repo, which the manual recommends (Stow). After `omarchy refresh shell` the widgets I had re-added in the repo never showed up: the link had been silently replaced by a detached 0600 copy." / "`mv` onto a symlink replaces the link itself."
- **Issue #9326**「Config-rewriting migrations reset file mode to 0600 via `mktemp` + `mv`」(open, 2026-08-31) — chezmoi/yadm のようにファイルモードを記録するツールに影響すると明記:
  > "the change can only ever be more restrictive. It surfaces when a dotfile manager that records file modes (chezmoi, yadm, etc.) picks up" 〔本文はここで切れている〕。影響を受ける migrations は7件列挙されている。
- **PR #10413**「Harden omarchy-refresh-config against path traversal」(open, 2026-09-06〜2026-09-23更新) — `..` を含むパスでホームディレクトリ外に書き込める脆弱性で、しかも `AGENTS.md even documented this as known behavior` （既知の挙動として文書化されていた、というのが興味深い）。

これらはいずれも **PR は投稿済みだが未マージ（open）** — つまり「この失敗モードは vendor 側に認識・提案済みだが、2026-09-24 時点でまだ修正されて出荷されていない」。issue tracker はバグ報告に偏るチャンネルという性質上、「Stow ユーザーの多くがこれで困っている」という頻度は分からないが、少なくとも3件以上が独立に同じ根本原因（`cp -f`/`mv` がシンボリックリンクそのものを消す）を報告している。

**mise と OS ネイティブパッケージマネージャの衝突（issue #3637、closed as duplicate）。** タイトル「autostarting mise breaks arch (python) packages」(closed, created 2025-11-26, 直近コメント 2026-09-21):

> "When I install a python package through Arch Repo, I am not able to run it in my terminal because mise 'hijacks' the global python binary, as I have installed python through mise." — 再現: `khal` (pacman 版) が `ModuleNotFoundError` で落ちる。

コメント欄でメンテナ側と思われる Michallote が設計上の悩みとして書いている:

> "Should we have mise activated all the time? Or would it suffice to only have it running in the `~/Work` directory ... I was thinking to simply remove mise python install from the menu altogether as any combination of flags still caused problems."

回避策 `mise use -g python@system` が有効という報告あり。最終コメント（bjarneo, 2026-09-21）:

> "this issue looks similar to #2728, which covers the same mise Python shadows system Python. I keep that one open and close this one to keep the discussion in one place."

これは **mise vs Arch ネイティブパッケージ**の衝突であり、設問にあった「mise vs Nix」の直接証拠ではない — が、原因（mise の shim が PATH 上で他のインストール経路より優先される）は Nix profile との衝突にも同型で当てはまりうる構造的な問題。**mise vs Nix の直接の衝突報告は omarchy 側にも home-manager 側にも見つからなかった**（no precedent, 後述）。

**home-manager on Arch (`nix-community/home-manager/issues/4405`)。** 〔要約経由〕WebFetch によれば、Arch の pacman 版 `nix` 2.17.0-3 を使って standalone home-manager をインストールしようとした際に libstdc++ の `Assertion '__pos < this->_M_len' failed` で `nix-build` がクラッシュ。ステータスは "status: stale" ラベルで closed（未解決のまま放置）。この issue はチャンネル題材の性質上（stale ラベル＝メンテナが再現・修正しないまま自然消滅）明確な原因究明・修正には至っていない。**注目点**: Discussion #987 のコミュニティガイドは pacman 版 `nix` ではなく **公式 installer（`--daemon`）** を使っており、この issue は pacman パッケージ由来の不具合の可能性がある — インストーラの選び方（公式 installer vs ディストリパッケージ）で結果が変わりうる、という切り分けが必要な論点として記録する。

### 4. 実態・macOS 固有機能の Linux 対応物（ベンダー一次情報＋数字）

- **クリップボード**: Omarchy 自身が内部で `wl-copy`（`wl-clipboard` パッケージ）を使用していることを `bin/omarchy-clipboard-paste-text` の実装（直接取得）で確認: `printf '%s' "$text" | wl-copy`。`wl-clipboard` は `install/omarchy-base.packages` に含まれる。pbcopy 相当として wl-copy が Omarchy 上で一次採用されている実例。
- **シークレットストア**: `install/omarchy-base.packages` に `gnome-keyring` と `libsecret` が含まれることを直接確認（grep 一致）。Keychain 相当のバックエンドとして libsecret（`secret-tool` 経由）が標準搭載。
- **1Password CLI (`op`)**: 公式ドキュメント（https://www.1password.dev/cli/get-started/、〔要約経由〕リダイレクト後に WebFetch）は Linux を明示的にサポートし、APT/YUM/Alpine/NixOS/手動インストールの5経路を列挙。Arch/AUR は公式ドキュメントには記載なし。AUR 側の `1password-cli` パッケージ（https://aur.archlinux.org/rpc/v5/info?arg[]=1password-cli、直接 API 取得）は **NumVotes: 58、Popularity: 1.66、Version: 2.39.0-1、LastModified が2026年の直近**で、能動的にメンテされている。ただし前述 issue #87（closed）は「1password-beta is not available for 'aarch64' arch」— aarch64 固有の欠落であり、x86_64（対象マシン）には該当しない。
- **LM Studio の Linux 対応**: 公式ダウンロードページ（https://lmstudio.ai/download、直接取得）は GUI 版 "LM Studio Bionic" を Windows 向けに強調表示する一方、ヘッドレスデーモン **"llmster"** を "Mac / Linux" 向けに `curl -fsSL https://lmstudio.ai/install.sh | bash` で配布している（バージョン表記は `0.4.25`）。ヘッドレス専用ページ（https://lmstudio.ai/docs/developer/core/headless、〔要約経由〕）も "LM Studio can be run as a background service without the GUI" とし、`lms daemon up` / `lms server start` を挙げ、Linux 向けにスタートアップタスク設定の別ページを案内している。**GUI の AppImage が現在も主要配布形態として一次に挙げられているかは、このダウンロードページの構成からは確認できなかった**（Windows が前面に出ており、Linux 向けは headless daemon のインストールスクリプトのみが明示されていた — AppImage への直接リンクは今回取得したページ本文には見当たらない。旧知識としての「AppImage 配布」は WebSearch 結果の他サイト言及にとどまり、公式一次ページでの現況としては未確認）。
- **systemd --user**: Arch Wiki (https://wiki.archlinux.org/title/Systemd/User) の目次を直接取得。Arch における per-user バックグラウンドサービスの標準機構であることは章立て（"systemd user instance" 節）から確認できるが、本文の逐語引用取得までは今回行っていない（目次のみ確認、内容は Arch エコシステムで広く前提とされる一般知識との整合を確認したのみ）。Omarchy 側は `default/systemd/user/`・`default/systemd/user@.service.d/` をリポジトリに同梱しており（直接確認）、launchd の `~/Library/LaunchAgents` に相当する自前サービスの置き場として systemd --user を実際に使っている。

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **vendor 自身が「不十分」と認めている**: `plans/dots.md` の "Omarchy declares `~/.config` 'your files' but does little to preserve them" は、設問1の答えが現状「弱い」ことをベンダー自身が認めた一次資料。
- **Stow 推奨とアップデート機構が食い違う実装**: Manual が "Stow is a great way to do that" と名指しで推薦していながら、`omarchy-refresh-config`／`omarchy-shell-config` の `mv`/`cp -f` 実装がシンボリックリンクを検出せず壊す（#5013, #11096）。**推奨と実装が矛盾している状態が2026-09-24時点で未修正のまま存在する。**
- **バージョン間の非互換**: Quattro (v4.x) で waybar/mako/walker が全廃、`hyprland.conf`→`hyprland.lua` に破壊的変更。sspaeti/dotfiles のバックアップスクリプトや discussion #987 のガイドなど、v2〜v3世代を前提にした実践者資産は現行版にそのまま当てはまらない。プラットフォームとしての設定ファイル形式・所在自体が安定していない。
- **mise の shim が他パッケージマネージャの実行ファイルを覆い隠す**: #3637（Arch pacman 版 python の隠蔽）。メンテナ自身が "mise is not up to date with package manager practices" 相当の疑義を discussion 内で表明し、メニューからの mise python インストール自体を撤去するかを検討していた。
- **home-manager standalone のインストールが Arch 上でクラッシュした報告**が closed/stale のまま残っている（#4405、要約経由）。原因究明未了。
- **ファイルモード破壊**: #9326 は chezmoi/yadm のようにモードを記録するツールに実害が及ぶことをタイトルから明記。
- **パストラバーサル**: #10413 は `omarchy-refresh-config` が `..` を検証しておらず任意ファイル上書きに使える状態だったこと、しかもそれが `AGENTS.md` に「既知の挙動」として書かれていたことを報告（2026-09-06〜09-23の間、まだ open）。

---

## 確認できなかったこと

- **mise と Nix（home-manager/standalone Nix profile）の直接の衝突報告** — omarchy リポジトリの issue 検索、home-manager issue、web 検索のいずれからも、mise の shim と Nix が管理する同名バイナリが PATH 上で衝突した一次報告は見つからなかった。#3637 は mise vs pacman-native の衝突であり、構造は類似するが対象が違う。「no precedent found」として扱う。
- **Quattro (v4.x) での home-manager standalone 導入の検証報告** — Discussion #987 は v3.1.x までの確認コメントしかなく、Quickshell/Lua 化後の Quattro で同じ手順が通るかの一次報告は見つからなかった。
- **systemd --user ページ本文の逐語引用** — 目次は直接取得したが、本文セクションの逐語引用までは時間の制約で取得していない。
- **LM Studio Linux 版の AppImage 配布の現況一次確認** — 公式ダウンロードページ本文に AppImage への直接リンクは見当たらず、GUI 版 Linux 配布形態の現状は headless (`llmster`) ほど明確に確認できなかった。
- **stow と chezmoi のどちらが「実践者の多数派」かの定量的決着** — GitHub 検索のリポジトリ数・star 数では stow がわずかに優勢（tomhayes/omadot 61 star が最多）だが、公式 Discussion #3796 の質的なコメント量・熱量では chezmoi が優勢。両者は測定軸が異なり、単純に一本化できなかった。
- **Homebrew casks → pacman/AUR/Nix の対応表そのものの一次資料** — 今回は時間配分上、Omarchy 側のパッケージ管理体系（`omarchy-pkg-add`、AUR 経由の yay）の存在確認にとどまり、macOS cask 一覧との網羅的な突き合わせは行っていない。

---

## 結論

**Omarchy が公式に定義している境界線ははっきりしている**: `~/.config` はユーザーの領域、`/usr/share/omarchy`（旧版では `~/.local/share/omarchy`）は Omarchy パッケージの領域。ユーザー領域の中でも、Manual が明示的に「ここを編集してよい」と列挙しているのは hypr の `.lua` 群（hyprland/bindings/monitors/input/looknfeel/autostart）、`omarchy/shell.json`、terminal（foot 既定、alacritty/ghostty/kitty も選択可）、`~/.bashrc`、`~/.XCompose` に限られる。リポジトリの `config/` ディレクトリを直接確認すると、実際に Omarchy が「配布・上書き管理」している範囲はこれに **btop・starship.toml・git（`~/.config/git/config` という XDG パスのみ、`~/.gitconfig` を置けば無効化できる）・tmux・herdr** も加わる。**waybar・mako・walker はQuattro (v4) では実在しない**（Quickshell 統合の `omarchy-shell` に吸収された）ので、これらを個別に dotfiles 管理する設計は現行版に対しては的外れになる。mise は Omarchy 自身が導入・更新する自前のツールチェーンマネージャであり、外部の Nix ベース管理と競合しうる構造的リスクがある（ただし直接の衝突報告は未確認、pacman-native との衝突報告 #3637 のみ確認）。

**実践者の答えは「Omarchy 自身の拡張点を使い、それ以外は好きなツールで stow するか chezmoi する」の二層構成で概ね一致している。** typecraft-dev/omarchy-supplement は好例で、Hyprland は `dofile()` で override ファイルを追記するだけに留め（Omarchy のベースを壊さない）、端末・エディタ・プロンプトは `rm -rf` してから丸ごと stow で置き換える、という使い分けを実装している。sspaeti/dotfiles は macOS と Omarchy を1つの stow リポジトリで共有する実例を提供しており、目的（複数 OS で1リポジトリ）そのものはこの調査対象の要件と一致する。ツール選択については、GitHub 上のリポジトリ数・star 数では GNU Stow がわずかに優勢（tomhayes/omadot 61 star）だが、Omarchy 公式 Discussion #3796 の会話の熱量では chezmoi が優勢という食い違いがあり、「業界の統一見解」と言えるほど一本化されてはいない。

**ベンダーの推奨（Stow）と実装（アップデートスクリプトの `cp -f`/`mv`）は矛盾しており、この矛盾は2026-09-24時点で複数の open な issue/PR として残ったまま未修正。** `omarchy-refresh-config` や `omarchy-shell-config` の内部実装は、symlink 化された設定ファイルを「検出」せずに `cp -f`/`mv` で置き換えてしまうため、Stow でリンクしたファイルが `omarchy update` や `omarchy refresh <group>` のタイミングでサイレントに実体コピーへ置き換えられる（#5013, #11096）。修正 PR は出ているが、いずれもマージされていない。これは vendor 文書の推薦を鵜呑みにしてよい根拠にはならない、という否定的で具体的な結論になる。ベンダー自身もこの弱さを `plans/dots.md` で認め、将来的に bare-git ベースの一次機能（`omarchy dots`）を計画しているが、これは stow/chezmoi/yadm のいずれも一次機能としては採用せず、「検出したら大人しく手を引く（stand down, don't fight）」という設計であり、2026-09-24時点では未出荷（plan 段階）。

**macOS 固有機能の対応物は素直に埋まる**: launchd → systemd --user（Omarchy 自身が `default/systemd/user/` を同梱、Arch の標準機構）、Keychain → libsecret/`secret-tool`（`gnome-keyring`+`libsecret` が Omarchy base package）、`pbcopy` → `wl-copy`（Omarchy 自身が内部で使用）、1Password CLI は Linux 公式サポートあり（AUR `1password-cli` も 58 vote で活発）。LM Studio は Linux 向けヘッドレスデーモン "llmster" を公式に配布しているが、GUI 版 (AppImage) の現況は今回の一次情報だけでは確証できなかった。

**総括すると、この調査から支持できるのは**: (a) Omarchy の拡張点（override ファイル・hooks・`~/.bashrc`・extensions/omarchy-menu.jsonc）を使う限りは安全、(b) それ以外の任意の設定ファイルを stow/chezmoi で管理すること自体は実践者に広く行われている、(c) しかし Omarchy のアップデート/リフレッシュ系コマンドが symlink を壊すバグは現時点で複数未修正のまま残っており、「stow で `~/.config/omarchy/shell.json` 等をリンクしても安全」という保証は vendor の推薦文言だけでは得られない、という三点である。**支持されないのは**「chezmoi か stow かの一方が業界標準として確定している」という主張、および「Quattro (v4) で home-manager standalone や v2〜v3世代の実践者ガイドがそのまま通用する」という前提。
