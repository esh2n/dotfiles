# SPEC: この dotfiles を Omarchy 機でも使えるようにする

状態: 草案（2026-09-24）。未決事項（末尾）を持ち主と一つずつ詰めてから確定する。確定後に段階ごとに実装し、終わったら結論だけ決定メモに残してこのファイルは消す（`rules/decisions/2026-09-23-plan-by-size-grill-default.md`）。

根拠の記録:

- `rules/research/2026-09-23-multi-system-flake-layout.md` — flake の分け方
- `rules/research/2026-09-24-dotfiles-on-omarchy.md` — Omarchy が持つ設定と外部管理の境界
- `rules/research/2026-09-24-two-host-home-llm.md`、`2026-09-24-vllm-vs-llama-server.md` — 家の LLM の二台目
- 棚卸し（2026-09-24、Mac 固有箇所の一覧）— 下の「触るファイル」に行番号付きで反映

## 1. 目的と前提

- **目的**: 一つのリポジトリで、今の Mac（`aarch64-darwin`、nix-darwin）と Omarchy 機（`x86_64-linux`、Omarchy v4 Quattro = Arch + Hyprland、RTX 3090 Ti、Windows とデュアルブート）の両方を `make install` / `make update` で整える。
- **Mac の挙動は変えない。** 各段階の終わりに Mac で `make update` が今と同じ結果になることを確かめる。
- **Omarchy は土台のまま使う。** NixOS に作り替えない（omarchy-nix は止まっている）。Omarchy 機には公式インストーラ（`--daemon`）で Nix を入れ、その上に standalone の home-manager を足す。
- **ツールの分担は既存の裁定どおり**: CLI と LSP は Nix の flake、言語の実行環境は mise（`2026-09-22-tools-nix-list-box-subset.md`）。Omarchy 機の mise 本体は Omarchy が入れて `omarchy update` で更新するので、Nix では入れない。設定（`~/.config/mise/config.toml`）は今までどおりリポジトリが持つ。

## 2. 境界: Omarchy が持つもの、リポジトリが持つもの

Omarchy の更新・リフレッシュ（`omarchy-refresh-config`、`omarchy-shell-config`、migrations）は、symlink を検出せず `cp -f` / `mv` で実体に置き換える（#5013・#11096、未修正）。なので Linux では次の区別で扱う。

| 区分 | 対象 | Linux での扱い |
|---|---|---|
| Omarchy が配って上書きし得る | `~/.config/hypr/*`、`~/.config/omarchy/shell.json`、端末（foot・alacritty・ghostty・kitty）、`btop`、`~/.config/starship.toml`、`~/.config/git/config`、`tmux`、`herdr` | 既定ではリンクしない。持ち込むものは未決事項で一つずつ決める |
| Omarchy が触らない（リポジトリが持つ） | `~/.zshrc` などホーム直下、`~/.gitconfig`（XDG の git 設定より優先される）、`~/.config/starship/`（zsh からだけ読む）、`~/.config/mise/config.toml`、nvim 以外のエディタ設定、`~/.claude`・`~/.codex`・`~/.pi`・`~/.omp`・`~/.dsh`・`~/.config/jig` | 今までどおりリンクする |
| Omarchy のもの（触らない） | `/usr/share/omarchy`、`~/.bashrc`（更新で消えない） | 触らない |
| Mac 専用（Linux では入れない） | workspace ドメインの aerospace・borders・hammerspoon・mado・omniwm・paneru・sketchybar、Warp、Homebrew の cask 一式、`system.defaults` | Linux ではリンクもインストールもしない |

リンク管理（`core/config/manager.sh` の `link_file`）は、既にある実ファイルをバックアップしてから消す作りなので、Linux では上の一行目の場所に対してはリンクを張らない分岐を入れる。

## 3. 段階と触るファイル

各段階は前の段階が Omarchy 機で通ってから始める。

### 段階 0: 土台（flake と入口）

- `core/nix/flake.nix`: 出力を一つの `darwinConfigurations` から、hostname をキーにした共有関数（Mac 用と Linux 用）に分ける。Mac のエントリ名と中身は変えない。Linux に `homeConfigurations."<user>@<host>"` と `packages.x86_64-linux.home-manager` を足す。`system = "aarch64-darwin"` の直書き（:44）と `/Users/` 固定（`core/nix/home.nix:4`）を機械ごとの値に。
- `domains/*/packages/home.nix`: `pkgs.brewCasks`・`mas`・`nowplaying-cli`・`cocoapods` を `isDarwin` の下へ。Linux で共通に入れる CLI と LSP はそのまま。
- `core/nix/overlays.nix:81-109`: `codebase-memory-mcp` は Mac 用バイナリしかない。Linux 用の入手元を確かめて足すか、Linux では入れない。
- `core/nix/update.sh:115-153,253`: OS で分岐する。Linux は `home-manager switch --flake`、Mac は今のまま。
- `core/install/installer.sh`: Homebrew の探索（:37-62）と nix-darwin の構築（:124-157）、`/etc` の退避（:130-135）を Mac だけに。Linux は Nix の導入（`--daemon`、既存 :78-89）→ home-manager → リンク → 各ドメインの install。
- `core/validation/validator.sh`: `pre`（:21-33）と `post`（:101）の Mac 前提を外す。
- `.github/workflows/`: Linux のジョブを足す（`homeConfigurations` の評価、jig の `bun test`、`validator.sh`）。
- 確かめ方: Omarchy 機で `make install` と `make update` が止まらずに最後まで走る。Mac で `make update` が今と同じ。

### 段階 1: シェルと CLI

- `core/install/installer.sh:160-163`: zsh への `chsh`（未決事項 3）。
- `domains/dev/home/.zshenv:95-107`: Linux の PATH に mise の shim と `~/.bun/bin` を足す。`.zshrc:61` の無条件 `source` にガードを付ける。
- `domains/dev/shell/zsh/options.zsh:27-31,73-83`: zsh のプラグインを Nix のプロファイルと `/usr/share/zsh/plugins` からも探す。
- クリップボード: `tmux/tmux.conf:68,156`、`zellij/config.kdl.template:10` の `pbcopy` を OS で切り替える（Linux は `wl-copy`）。
- BSD 固有の `sed -i ''`: `domains/dev/install.sh:103`、`domains/workspace/install.sh:91`、`domains/system/bin/theme-switch:307`。
- `core/config/manager.sh`: 2 節の区別で Linux の分岐。`link_launch_agents`（:450-461）は Mac だけ。VS Code / Cursor の設定（:540-560）は Linux では `~/.config/{Code,Cursor}/User` にリンクする。
- `domains/workspace/install.sh` とシェルの `brew services` 系は Mac だけで走らせる。
- 確かめ方: Omarchy 機の zsh で、プロンプト・補完・mise・bun・tmux のコピーが動く。Omarchy の `omarchy update` を一度走らせても、リンクが外れない。

### 段階 2: ハーネス（jig と各エージェント）

- `jig/src/infra/decision/token-file.ts:18` ほか 4 か所: 判定サービスのトークンの既定の場所を、Linux では XDG に。
- `jig/src/domain/claude/sandbox.ts:96-98`: Claude Code のサンドボックスは Linux では bubblewrap などが要る。入れるか、Linux では設定を変えるか（未決事項 5）。
- 判定サービス（`config/jig/`）: launchd の plist と `jig-decision-up.sh` の Keychain・bun の固定パス（:31,37,60）を、Linux では systemd の user サービスと 1Password CLI + libsecret に（未決事項 4）。
- `harness/scripts/statusline.sh:159,228`、`dev/bin/code-graph-cache-gc:70`: GNU の `stat` と `date` に対応。
- 確かめ方: Omarchy 機で Claude Code・Codex・pi・omp・DSH を起動して、guard が効き（main への push が止まる）、整形と型検査が走る。jig のテストが Linux の CI で通る。

### 段階 3: 家の LLM

決定メモ `2026-09-24-home-llm-second-host-omarchy-llama-server.md` のとおり。

- LiteLLM（`config/litellm/`）を Linux でも常駐させる（systemd の user サービス）。Keychain（`litellm-up.sh:57`、`proxy-key.sh:13-15`）→ 1Password CLI + libsecret、OrbStack 前提（:60）→ Docker、`host.docker.internal` に `--add-host host.docker.internal:host-gateway` を足す（:100-111）。
- Omarchy 機で `llama-server`（router mode）を systemd の user サービスで常駐させ、`tailscale serve` でポートを一つ出す。各機械の LiteLLM に用途別の名前を足す。
- `domains/dev/install.sh:258-425` の Linux 分岐（今は :299-302 で何もせず戻る）を埋める。`litellm/check.sh` の hub 判定（:36）を「LM Studio.app があるか」から機械の役割に。
- 確かめ方: Mac と Omarchy の両方から、deterministic と Omarchy のモデルに `check.sh` が通る。Omarchy 機を止めたとき、その名前が約 1 秒で「使えない」を返す。

### 段階 4: デスクトップ

- Hyprland は Omarchy の設定を残し、override ファイルを `dofile()` で足す形（実践者の型）。端末・テーマ・壁紙（`theme-switch`、`creative/bin/wallpaper`）をどこまで持ち込むかは、未決事項 2 で決めてから書く。

## 4. 範囲外

- Mac 専用のウィンドウ管理とバー（aerospace・sketchybar など）の Linux 版を作ること。Omarchy の Hyprland と omarchy-shell がその役。
- Omarchy を NixOS に作り替えること。Omarchy 公式の `omarchy dots`（未出荷）を待つこと。
- Windows 側の設定。
- Linux の GUI アプリ一覧を Nix で管理すること（Omarchy のパッケージ管理に任せる。持ち込む一覧が要るかは段階 4 で決める）。
- `sbx`（Docker Sandboxes）を Linux で動かすこと。Linux 版の有無を確かめてから別の計画にする。

## 5. 未決事項（持ち主が決めること、一つずつ聞く）

1. Omarchy 機の hostname とユーザー名（flake のキー）。
2. 端末・tmux・herdr・starship を Omarchy 機でも自分のもので置き換えるか、Omarchy の既定を使うか。置き換える場合、更新で実体に戻されたときの扱い。
3. Omarchy 機のログインシェルを zsh にするか（Omarchy の既定は bash。実践者は zsh に切り替える例が多い）。
4. Linux の常駐サービスの作り方: home-manager の `systemd.user.services` で宣言するか、今の plist と同じくリポジトリに unit ファイルを置いてリンクするか。調べた範囲では、どちらも個人の dotfiles での実例は見つかっていない。
5. Claude Code のサンドボックスを Linux でも有効にするか（bubblewrap などを入れる）。
