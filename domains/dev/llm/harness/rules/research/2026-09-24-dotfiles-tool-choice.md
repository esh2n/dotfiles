# dotfiles 管理ツール選定調査: macOS(nix-darwin) + x86_64 Omarchy(Arch) の2機で、この所有者の形にどの方式が合うか

調査日: 2026-09-24。既存4本を前提として再調査しない: `2026-09-24-role-based-dotfiles.md`（role抽象化・home-manager launchd/systemd option・mkOutOfStoreSymlinkの既知バグ・digga廃止）、`2026-09-24-chezmoi-topic-and-dotfiles-rewrite.md`（chezmoiの日本語圏話題化・dotfiles bankruptcy語彙・jonathanbartlett.co.ukの5回乗り換え・jade.fyiのNix反対論）、`2026-09-24-dotfiles-on-omarchy.md`（Omarchy公式の`~/.config`所有境界・stow推奨とcp -f実装の矛盾・open issue #5013/#9326/#10413/#11096・home-manager standalone on Arch issue #4405）、`2026-09-23-multi-system-flake-layout.md`（mkSystem共有関数・hostnameキー・home-manager launchd.agents/systemd.user.servicesのソース直読・sanketsudake/dotfilesが唯一の完全一致precedent）。これらは番号なしで本文に埋め込み引用し、再取得はしない。

## 方法・検証凡例

- `[直接]` — `curl`（`api.github.com`は`Authorization: Bearer $(gh auth token)`使用。`gh auth status`はkeyringの再ログインエラーを報告するが、このトークン自体はAPI呼び出しに有効だった）または`raw.githubusercontent.com`で本文そのものを取得し、正規表現/pythonでテキスト抽出したもの。
- `[要約経由]` — WebFetch/WebSearchの要約を経由したもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの（本文中に明記）。
- GitHub code/repository/topic 検索はサンプリングインデックスであり網羅的ではない。件数は「採用規模のおおまかな比較」としてのみ扱う。

---

## 問い

所有者の形（固定事実、証拠ではない）: macOS(Apple Silicon) + x86_64 Omarchy(Arch+Hyprland、更新スクリプトがsymlinkをコピーで上書きする既知バグ持ち)の2機、将来増える可能性。CLI/LSPは両機、GUIアプリ(Homebrew cask)はmacOSのみ+一部Linux。nvim/zsh/tmux/terminal/gitは毎日編集。5つのコーディングエージェントハーネス向け設定は所有者自身のTypeScript生成器が`~/.claude`等に書き出し、ツール選定に関わらず存在し続ける。常駐サービス(LiteLLM/判断サービス/LM Studio keep-awake/将来llama-server)はmacOS=launchd、Linux=systemd --user。シークレットは1Password CLI(`op`)、現状macOS Keychainも併用。ロールはリポジトリ外で選ぶ。ホスト名/ユーザー名はリポジトリに出さない。install/updateは単一の冪等コマンド。現行スタックはnix-darwin+home-manager(パッケージのみ)+Homebrew via nix-darwin+brew-nix+mise+655行bashリンカ+ドメイン別install.sh。

この形に対し、A(Nix中心)・B(chezmoi中心)・C(ハイブリッド)・D(その他)を9観点で比較する。

---

## 各レンズの所見

### 1. ベンダー

#### 1.1 home-manager: launchd.agents/systemd.user.servicesは実在する対称オプション(既出、再掲のみ)

flake-layout記録がソース直読済み: `launchd.enable`は`pkgs.stdenv.hostPlatform.isDarwin`をデフォルトに取り、`systemd.nix`側は`lib.hm.assertions.assertPlatform`で`isLinux`を強制する。誤ったOSに書けば評価時にハードアサーション失敗する設計。これがAの土台。

#### 1.2 chezmoiの`onepasswordRead`はサービスアカウント不要、対話的`op`セッションで動く一次関数（新規直接取得）

`https://www.chezmoi.io/reference/templates/1password-functions/onepasswordRead/` `[直接]`:

> "onepasswordRead ... url is passed to the `op read --no-newline` command. If account is specified, the extra arguments `--account $ACCOUNT` are passed to op." / "If there is no valid session in the environment, by default you will be interactively prompted to sign in." / "When using 1Password secrets automation, the account parameter is not allowed."

これは所有者が既に持っている「1Password CLI (`op`)、対話ログイン」という前提とそのまま一致する。Nix側の対応物である`opnix`（後述1.4）は逆にサービスアカウントトークンを要求し、この点で要件との一致度が異なる。

#### 1.3 chezmoiの`run_onchange_`スクリプトはbrew bundle/pacman双方の公式サンプルを持つ（新規直接取得）

`https://www.chezmoi.io/user-guide/advanced/install-packages-declaratively/` `[直接]`。`.chezmoidata/packages.yaml`にOS別パッケージリストを書き、`run_onchange_darwin-install-packages.sh.tmpl`が:

```
{{ if eq .chezmoi.os "darwin" -}}
#!/bin/bash

brew bundle --file=/dev/stdin <<EOF
{{ range .packages.darwin.brews -}}
brew {{ . | quote }}
{{ end -}}
```

`https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/` `[直接]`:

> "Scripts are any file in the source directory with the prefix `run_`, and they are executed in alphabetical order." / "`run_` scripts: These scripts are executed every time you run `chezmoi apply`." / "`run_onchange_` scripts: These scripts are only executed if their content has changed since the last time they were run successfully." / "Scripts break chezmoi's declarative approach and should be used sparingly. All scripts should be idempotent, including `run_onchange_` and `run_once_` scripts."

Arch(pacman)側の対応は実践者実装（後述2.1、jpoissonnet/dotfiles）で直接確認できる — vendorの公式サンプルはdarwin/brewのみだが、同じ`run_onchange_`機構をpacmanに転用するのは実装上自明で、実践者が実際にやっている。

#### 1.4 Nix + 1Password: 一次「解」だったmrjones2014/opnixはハッカソン産で既にarchived、後継brizzbuzz/opnixが現役（新規直接取得）

`https://github.com/mrjones2014/opnix` `[要約経由]`: "This repository was archived by the owner on February 10, 2025 and is now read-only." 本文に "This project was built for a hackathon. brizzbuzz/opnix is probably a better solution for most users." という後継案内あり。

後継 `https://raw.githubusercontent.com/brizzbuzz/opnix/main/README.md` `[直接]`（188★、`pushed_at: 2026-08-18`、`archived: false`、open issue 1件、`[直接]` api.github.com/repos/brizzbuzz/opnix）:

> "Secure 1Password secrets integration for NixOS, nix-darwin, and Home Manager." / "**Service Integration**: Automatic systemd/launchd service restarts on secret changes" / "**Multi-Platform**: Full support for NixOS, nix-darwin, and Home Manager"

```
# nix-darwin
darwinConfigurations.yourhostname = nix-darwin.lib.darwinSystem {
  modules = [ opnix.darwinModules.default ./configuration.nix ];
};
# Home Manager
homeConfigurations.yourusername = home-manager.lib.homeManagerConfiguration {
  modules = [ opnix.homeManagerModules.default ./home.nix ];
};
```

これはA(Nix)側でも1Password+launchd/systemdの束を一次機能として満たせることの実在証拠だが、①一度ハッカソン産のarchived版を経由している（成熟の浅さ）、②サービスアカウントトークン運用が前提（対話的`op`ログインではない、1.2との対比）、③188★・open issue 1件と規模が小さい、という留保付き。

#### 1.5 chezmoiのデフォルトは「コピー」であり「symlink」ではない（新規直接取得、Omarchy共存の評価を左右する重要な事実）

`https://www.chezmoi.io/reference/target-types/` 周辺のWebSearch要約と、design/target-typesページの内容を突き合わせた結果 `[要約経由・複数ソース照合]`:

> "By default, chezmoi copies files to their destinations, meaning the target files are ordinary files that work with any tool." / "Unlike simpler symlink-based tools ... chezmoi copies files from a source directory to their correct locations" / "Symlinks are first class citizens in chezmoi ... If you want chezmoi to use symlinks by default, setting `mode = "symlink"` will make chezmoi behave more like a dotfile manager that uses symlinks by default"

**この一点が、既出のOmarchy調査記録（`omarchy-refresh-config`が`cp -f`/`mv`でsymlinkを検知せず破壊する #5013/#9326/#10413/#11096）との相性を判定する分岐点になる**: chezmoiのデフォルト（copy）モードでは、そもそも管理対象ファイルがsymlinkではない通常ファイルなので、Omarchyのバグが直撃する「symlinkの中身を検知せず上書きする」「`mv`でリンクそのものを消す」という失敗モードは構造的に発生しない。ただし「最後に書いた方が勝つ」競合は残る: `chezmoi apply`と`omarchy update`のどちらを後から実行したかでファイルの中身が決まり、どちらも検知せずに上書きする。stow/yadmや`mode = "symlink"`を選んだchezmoiでは、既出のOmarchyバグがそのまま当てはまる。

#### 1.6 GNU Stow: Omarchy公式マニュアルが名指しで推薦しながら、Omarchy自身の実装が壊す（既出記録の再掲、新規事実なし）

dotfiles-on-omarchy記録から再掲: Manual自身が"Stow is a great way to do that"と推薦しつつ、`omarchy-refresh-config`/`omarchy-shell-config`はsymlinkを検知しない`cp -f`/`mv`実装で、PR #5013(stowユーザーの報告)・#11096(shell.jsonがstowで管理されていたのに検知なく上書き)・#9326(chezmoi/yadmのようにmodeを記録するツールに実害)・#10413(パストラバーサル)がいずれも2026-09-24時点でopenのまま未マージ。**推奨と実装が矛盾したまま放置されている唯一の具体例**。

---

### 2. 実践者

#### 2.1 jpoissonnet/dotfiles — macOS+Arch両機をchezmoi単一リポジトリで運用する、この形にほぼ完全一致する実例（新規直接取得）

`https://raw.githubusercontent.com/jpoissonnet/dotfiles/main/README.md` `[直接]`（`pushed_at: 2026-09-08`、star 0だが直近運用中）:

> "chezmoi source for macOS and Arch Linux." / "Only git, and chezmoi itself. Everything else is installed by `chezmoi apply`." / "On Arch, bootstrap the handful of packages needed to run chezmoi at all: `sudo pacman -S --needed git openssh chezmoi zsh`" / "`init` asks for a git name, a git email, and whether this is a work machine. It asks once per machine and caches the answers in `~/.config/chezmoi/chezmoi.toml`, which is never committed." / "`apply` installs packages with pacman or brew, then fills the gaps those cannot: deno and bun on Arch, where there is no aarch64 package, plus a Rust toolchain, a Node version via fnm, and pnpm via corepack." / "**Not copied by design: `~/.ssh`, Cursor MCP and oauth config, `~/.claude.json`.**" / "What this repo owns: zsh under `$ZDOTDIR`, antidote, p10k, nvim/LazyVim, kitty, git and delta, Cursor user settings, the package lists, and aerospace on macOS only."

この最後の一文（`~/.claude.json`を意図的に管理外にしている）は、**所有者の自前TypeScript生成器が`~/.claude`等に書き出す構造と、他人のdotfilesリポジトリで既に実践されている、極めて直接的な先例**。ロール選択（work機かどうか）も、role-based記録が確認した`promptBoolOnce`+`chezmoi.toml`の型そのままで実装されている。

#### 2.2 alfonsofortunato.com — chezmoiをオーケストレーション層、パッケージはOS別に分ける、という別のハイブリッド実例（新規、要約経由）

`https://alfonsofortunato.com/blog/dotfile/` `[要約経由]`:

> "designed to work across both macOS and Linux distros, leveraging modern tools like Chezmoi and Nix to streamline terminal configuration and package management." / "Replaced Stow in my setup, allowing me to create symlinks for my dotfiles and manage them seamlessly with Git." （※実際はchezmoiのデフォルトはcopyであり、著者のこの表現はsymlinkモードを使っている可能性、または不正確な自己記述の可能性——本記録では要約経由の弱い証拠として扱う） / "**Homebrew**: For macOS." / "**Nix**: For Linux." / "In `run_onchange_install-packages.sh.tmpl` I use Chezmoi's template engine to manage package installation differently for macOS." / "I use Bitwarden to store my GPG private key" / "I haven't found a perfect solution for securely handling SSH keys so far."

シークレットは1PasswordではなくBitwarden——「1Password」要件そのものへの直接一致ではないが、chezmoiのテンプレート層がパスワードマネージャーを選ばず同じ構造で使えることの傍証にはなる。SSH鍵の扱いは本人が「まだ完璧な解を見つけていない」と明言する未解決の弱点。

#### 2.3 Ben Mezger (seds.nl) — Bash→Ansible→Stow→Make→chezmoi→NixOS+home-managerという5段階の乗り換え史、最終形はハイブリッド（新規、要約経由）

`https://seds.nl/notes/my-journey-in-managing-dotfiles/` `[要約経由]`。乗り換え理由を時系列で:

- Bash scripts: "as my configuration and requirements grew, it became more difficult to maintain everything"
- Ansible: "it was overkill for such a requirement"、secret管理とLinux/macOS間の差分処理が困難と明記
- GNU Stow: symlink管理は改善したが「configuration secrets」問題は残存
- GNU Make: "didn't like this approach after using it a few times"、"still required constant maintenance"
- chezmoi: "Chezmoi can extract passwords from my password manager and automatically apply them"、"maintain a single configuration file for multiple hosts" — ここまでは好意的だが、ホストごとに複数スクリプトが必要な点は未解決のまま
- NixOS + home-manager（最終形）: "declaratively build my system"、"I am sure once I have to do a reinstall, things will work exactly" という再現性への期待から採用。ただし**完全移行ではなくハイブリッド**: "Kept Chezmoi for application config, uses Nix for system management"。さらに**macOSでは純粋なNixを断念**: "macOS presented obstacles with Nix" の一文の後、"Homebrew manually installed" と明記——著者自身、macOS側ではNixを断念してHomebrewの手動運用+chezmoiに戻っている。

**この1人が、Nixに最も期待した末に、2機（Linux=NixOS、macOS=Homebrew手動）でツールを使い分ける結論に達した唯一の詳細な一次資料** — 「Nixで完全統一」という道が本人にとってすら最終解にならなかった、という否定側の証拠でもある。

#### 2.4 htdocs.dev / jade.fyi（既出記録の再掲のみ、新規事実なし）

chezmoi-topic記録から再掲: htdocs.devはNix→Homebrew+chezmoiの移行だが理由の記述なし（弱い証拠）。jade.fyiはNixによる全面書き直しに明確に反対し、19行のbash+symlinkを対案とする。「Nixで統一する」路線に、独立した2つの否定的資料が既に存在する。

#### 2.5 sspaeti/dotfiles（既出記録の再掲のみ）— macOS+Omarchy両機をGNU Stowで運用

dotfiles-on-omarchy記録から再掲: 244★、`make mac`/`make linux`でStowを使い分ける実例。ただし著者自身のバックアップスクリプトはQuattro(v4)以前のOmarchy（waybar/walker/mako時代）を参照しており、現行版への追従は未確認。

#### 2.6 sanketsudake/dotfiles（既出記録の再掲のみ）— macOS(nix-darwin)+実機Omarchy(standalone home-manager)の唯一の完全一致Nix例

flake-layout記録から再掲: 唯一のA型完全一致precedentだが、**「Omarchy-owned paths (`~/.config/hypr`, `~/.config/git/config`, `btop.conf`) are not managed.」**と明記——Omarchyが所有する領域は最初からhome-managerの管理外に置いている。4★、PRは2026-09-21マージ（本記録時点で2週間程度の運用実績のみ）。

---

### 3. 測定・実態（数値付き）

| 対象 | 数値 | 出典 |
|---|---|---|
| `topic:dotfiles topic:chezmoi` | 1,030 | `[直接]` api.github.com/search/repositories |
| `topic:dotfiles topic:home-manager` | 512 | 同上 |
| `topic:dotfiles topic:stow` | 418 | 同上 |
| `topic:dotfiles topic:ansible` | 413 | 同上 |
| `topic:dotfiles topic:yadm` | 228 | 同上 |
| `topic:dotfiles topic:nix-darwin` | 202 | 同上 |
| twpayne/chezmoi star / push / archived | 21,702 / 2026-09-20 / false | `[直接]` api.github.com/repos/twpayne/chezmoi |
| SuperCuber/dotter star / push / archived | 2,012 / 2026-07-13 / false | `[直接]` api.github.com/repos/SuperCuber/dotter |
| thoughtbot/rcm star / push / archived | 3,261 / **2025-05-23** / false | `[直接]` api.github.com/repos/thoughtbot/rcm — 本記録時点(2026-09-24)で約16ヶ月停止 |
| feel-co/hjem star / push / archived | 648 / 2026-09-22 / false | `[直接]` api.github.com/repos/feel-co/hjem |
| viperML/nix-maid star / push / archived | 196 / 2026-09-02 / false | `[直接]` api.github.com/repos/viperML/nix-maid |
| brizzbuzz/opnix star / push / archived / open issues | 188 / 2026-08-18 / false / 1 | `[直接]` api.github.com/repos/brizzbuzz/opnix |
| mrjones2014/opnix archived | true（2025-02-10、ハッカソン産と自認） | `[要約経由]` github.com/mrjones2014/opnix |
| jpoissonnet/dotfiles push | 2026-09-08（macOS+Arch完全一致のchezmoi実例） | `[直接]` api.github.com/repos/jpoissonnet/dotfiles |

---

### 4. 実態（否定側含む、上記3節の数値表と各所見内に統合済み。追加の否定側は次節で独立して集約）

---

## 比較表（A〜D × 1〜9）

### 主表: A / B / C

| # | 観点 | A. Nix中心（darwin+home-manager: パッケージ+ファイル+サービス、Arch=standalone home-manager） | B. chezmoi中心 | C. ハイブリッド（Nix/brew/pacman=パッケージ、chezmoi=ファイル層、ネイティブサービスマネージャ） |
|---|---|---|---|---|
| 1 | 複数OS(Arch込み) | vendorのnix-darwin READMEは単一ホスト例のみ（flake-layout記録§1.1）。Arch側はstandalone home-manager、完全一致precedentは唯一sanketsudake（2週間運用）で**Omarchy所有領域は意図的に管理外**。 | `.chezmoi.os`/`.chezmoi.hostname`がvendor組み込み変数(role-based記録§1.3)、同一バイナリ・同一リポジトリでDarwin/Linux/Windowsを区別なく扱う設計。jpoissonnet/dotfilesが"chezmoi source for macOS and Arch Linux"として1年未満だが現役運用中。 | jpoissonnet(pacman/brew+chezmoi)、alfonsofortunato(Homebrew mac+Nix linux+chezmoi orchestration)、Ben Mezger最終形(NixOS+home-manager linux + Homebrew手動 mac + chezmoi app config)の3実例あり、いずれもファイル層はchezmoi。 |
| 2 | 編集可能設定の日次ループ | Nixストアは基本immutable、`mkOutOfStoreSymlink`で編集ループを確保するが、ayats.org(2024-09-10)が名指しで"I hate it. It should not exist."と拒否、jade.fyiは評価/ビルドがイテレーションループに挟まる摩擦を名指し(chezmoi-topic記録既出)。 | デフォルトcopyモードでは対象ファイルは「ordinary files that work with any tool」（新規直接取得、§1.5）——ビルド評価なしで直接編集・`chezmoi re-add`という短いループ。jonathanbartlett.co.ukは外部編集との整合が「a little abstract」になったと指摘済み(chezmoi-topic記録)。 | ファイル層がchezmoiである3例はすべてBと同じ短いループを継承。パッケージ層（Nix/brew/pacman）は別コマンドで、Ben Mezgerの"macOS presented obstacles with Nix"のように統一しきれない摩擦が残る。 |
| 3 | ロールのリポジトリ外選択 | vendorに一次語彙なし(role-based記録§1.1)。CLI引数`--flake .#user@host`が唯一の慣習、digga(Profiles/Suites)はメンテナ自身が撤回済み(role-based記録§1.2)。 | `promptBoolOnce`が未追跡`~/.config/chezmoi/chezmoi.toml`に一度だけ質問しキャッシュ(role-based記録§1.3、vendor一次機能)。jpoissonnet/dotfilesが"work"フラグでこの型をそのまま実装(新規、§2.1)。 | Bのchezmoi機構をそのまま継承。 |
| 4 | launchd/systemd両対応サービス | `launchd.agents`/`systemd.user.services`はvendorの対称オプション、`isDarwin`/`isLinux`でデフォルト判定・誤用は評価時アサーション失敗(flake-layout記録§1.2、直読済み)。ただし採用している個人dotfilesの実例は今回・前回とも0件(flake-layout記録「前例なし」)。 | vendor一次のサービス宣言機構なし。`run_onchange_`/`run_once_`スクリプトでunitファイルを配置し`launchctl`/`systemctl --user`を叩く、という間接パターンが実在（skenmy/dotfilesの自己更新タイマー例、要約経由）。 | Bと同じ間接パターンを継承。ネイティブサービスマネージャを直接叩く点はAより素朴だが、実際に動いている例（chezmoi自己更新）はAの「前例なし」より一歩実在に近い。 |
| 5 | 1Password経由のシークレット | 一次解はopnix。現行のbrizzbuzz/opnixはnix-darwin+Home Manager+systemd/launchd再起動まで対応(新規、§1.4)だが**サービスアカウントトークン前提**（対話ログインと別方式）、188★、前身mrjones2014/opnixは「ハッカソン産」でarchived済み。 | `onepasswordRead`がvendor一次のテンプレート関数、**対話的`op`セッションで動く**（新規直接取得、§1.2）——所有者の現行`op`利用形態と直接一致。日本語圏の実践者(ryo_kawamata、chezmoi-topic記録)も同じ組み合わせを報告済み。 | ファイル層がchezmoiの3例のうち、1Password利用を明記したのはjpoissonnet系の`op`前提コマンド列のみ；alfonsofortunatoはBitwarden採用でSSH鍵の扱いを「未解決」と自認(§2.2)——1Password固有のハイブリッド実例は見つからず。 |
| 6 | 単一冪等install/update | vendorがdarwin+standalone home-managerを1コマンドで統一するレシピを示した例は見つからず(flake-layout記録「前例なし」)。実際には`darwin-rebuild switch --flake .#mac`と`home-manager switch --flake .#user@arch`の2系統。 | `chezmoi init <repo> && chezmoi apply`がvendor文書のまま単一の冪等コマンド連鎖、`run_onchange_`がパッケージインストールまで同じ`apply`に含める(新規直接取得、§1.3)。jpoissonnet: "Only git, and chezmoi itself. Everything else is installed by `chezmoi apply`."（新規、§2.1）。 | Bの単一`apply`をそのまま継承（`run_onchange_`がpacman/brew/Nixいずれかを呼ぶ）。ただしBen Mezgerの例はNixOS側とmacOS側で運用そのものが分かれており(§2.3)、統一しきれていない反例も同時に存在。 |
| 7 | Omarchy(ファイル書き換えベンダー)との共存 | `legacyLink`は`-L`検査でsymlinkと実ファイルを区別し、実ファイルには`backupFileExtension`/スキップという丁寧な扱い(role-based記録§1.6、直読済み)——Omarchyの`cp -f`より一段丁寧。ただし既存symlinkは検知なく黙って張り替える同種の穴を持つ。 | **デフォルトcopyモードではOmarchyのsymlink破壊バグ群(#5013/#9326/#10413/#11096)が構造的に非該当**（新規、§1.5）——管理対象がそもそもsymlinkでないため。ただし「最後に`apply`/`update`した方が勝つ」競合は残り、検知は無い。`mode = "symlink"`を選べばStowと同じ危険が戻る。 | ファイル層がchezmoiであれば同上（B）；ただしsspaeti(§2.5)のようにStowを選ぶハイブリッドは既出記録のバグ4件がそのまま当てはまる。 |
| 8 | 外部生成器が所有するディレクトリとの共存 | `home.file`/`xdg.configFile`に宣言しない限り触れない、という構造上の安全（今回・前回とも直接のテスト事例は見つからず、**[unverified]**な推論）。 | 追加(`chezmoi add`)しないディレクトリは単に無視される。jpoissonnet/dotfilesが名指しで実証: **"Not copied by design: ... `~/.claude.json`."**（新規、§2.1）——コーディングエージェント設定ファイルを意図的に管理外にする、この所有者の状況と直接一致する先例。 | Bの性質を継承、同じ先例が適用できる。 |
| 9 | 学習/保守コストと失敗モード | 最も高い: Nix言語自体、digga「保守が年々難しくなった」撤回(role-based記録§1.2)、`mkOutOfStoreSymlink`未解決バグ2件(#4692/#7187)、Arch上のhome-manager crash(#4405、上流Nixバグに起因、Arch側での解消は未確認)、ayats.orgのhome-manager完全離脱。opnix前身のハッカソン産archived履歴も同系統。 | Wantedlyの1年運用報告(chezmoi-topic記録既出)が実数を出す唯一の例: 「セットアップにかかる時間は…数十分で完了」と成果を明記する一方、「`chezmoi apply`を実行しないままになってしまう」を名指しの失敗モードとして報告（CI上のテンプレ構文チェックで緩和）。karlmdavis/dotfiles issue #27(chezmoi-topic記録)はファイル名エンコード方式を「every rename a two-step affair」と批判。jonathanbartlett.co.ukは5回の乗り換えを経てなお「lesser of many evils」で満足しきっていない。 | Ben Mezgerが最も高コストな体験談の持ち主: 5段階の乗り換えを経てなお最終形が完全統一に至らず、macOSでは"obstacles with Nix"によりNixそのものを断念してHomebrew手動運用に後退(§2.3)——「2つのツールを併用する」という設計そのものが持つ調整コスト(パッケージの二重管理・境界線の手動維持)が、この1件の一次資料からはっきり読み取れる。 |

### 補助表: D（yadm/Stow/Ansible/dotter/rcm/hjem/nix-maid/mise tasks）— 差の大きい観点のみ

| ツール | 1. 複数OS/Arch | 4. サービス | 5. 1Password | 7. Omarchy共存 | 9. コスト・失敗モード |
|---|---|---|---|---|---|
| yadm | `class`（`local.class`、role-based記録§1.5でvendor一次確認済み）がホスト非依存のロール機構として最も直接的。topic件数228でchezmoi(1,030)より小規模。 | ネイティブ機構なし、外部スクリプト前提（未調査、推論） | ネイティブ機構なし（未調査、推論） | symlinkベース、Omarchyの4件のバグが直撃する構造は同型（Stowと同じ危険性、直接テストなし） | 前回記録以降の追加調査なし |
| GNU Stow | Manual公式推薦(§1.6/既出)だがOmarchy自身のバグと矛盾。topic件数418。 | ネイティブ機構なし | ネイティブ機構なし | **既出記録の#5013/#9326/#10413/#11096が直撃、2026-09-24時点で全て未修正のままopen** | vendor推薦と実装の矛盾という具体的な負の証拠が最も濃い |
| Ansible | roleはhostname非依存、inventory groupがホスト↔role対応を担う(role-based記録§1.4、vendor一次確認済み)だが多数ホスト運用が前提の設計。topic件数413。 | 別のAnsible機構(handlers/systemd module)で可能なはずだが未調査 | 未調査 | 未調査 | Ben Mezgerが実際に採用し離脱: "it was overkill for such a requirement"、secret/クロスプラットフォームが名指しの離脱理由（新規、§2.3） |
| dotter (SuperCuber/dotter) | Homebrew/AUR配布、`local.toml`でマシン別選択（新規直接取得、README）。2,012★、pushed 2026-07-13で現役。 | ネイティブ機構なし、`pre_deploy`/`post_deploy`フックのみ | **READMEにネイティブ1Password/secrets機構の記載なし**（新規直接取得）——`op run`相当を自前で書く必要、chezmoiの`onepasswordRead`に対する明確な見劣り | symlinkベースの推定（templating+symlinkと自称、Stow同様のリスクを負う可能性、未直接テスト） | 1Password統合がない、という具体的なギャップが新規に判明 |
| rcm (thoughtbot) | 3,261★だが**pushed 2025-05-23、本記録時点で約16ヶ月停止**（新規直接取得） | 未調査 | 未調査 | 未調査 | smasato(chezmoi-topic記録既出)が2021年にrcmからchezmoiへ乗り換え済み、かつ現在も停滞中——負の実例が二重に存在 |
| hjem (feel-co/hjem) | Nixベース、**standalone CLIを"non-NixOS and mixed setups"向けに提供**（新規直接取得README）——standalone home-managerの直接競合。648★、pushed 2026-09-22で活発。 | Nix自体のサービス層(NixOS/nix-darwin)に依存する設計、hjem固有のlaunchd/systemd抽象は確認できず | 未調査（Nixエコシステムなのでopnix等と組み合わせ可能と推定、未確認） | Nixの`home.file`同様の構造的安全性（推定） | Nix言語・評価ループというAと同じコストを継承。"We have learned from the mistakes made in the ecosystem"と自称するが実運用の第三者報告は見つからず |
| nix-maid (viperML/nix-maid) | Nixベース。`mkOutOfStoreSymlink`回避・atomic directory swapを明示的な設計目標とする(要約経由)。196★、pushed 2026-09-02で活発。 | activation hookを避け"systemd units that run concurrently"（要約経由）——**Darwin/launchdへの言及はどのソースにも見当たらず**、Linux/systemd志向の可能性が高いが未確認 | 未調査 | 未調査 | Darwin対応の有無が確認できていない、という具体的な空白。README本文の直接取得は今回失敗（`[未到達]`、代わりにWebSearch要約のみ） |
| mise tasks | mise自体はランタイム管理ツールでdotfiles全体のinstall/updateエントリポイントとして使われている一次・実践者資料は今回見つからず | — | — | — | 前例なしとして扱う（次節） |

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **Aへの否定**: ayats.org(2024-09-10)のhome-manager完全離脱、`mkOutOfStoreSymlink`未解決バグ2件、Arch上のhome-manager install crash(#4405)、digga「Profiles/Suites」の撤回、opnix前身のハッカソン産archived履歴——いずれも既出記録＋本記録の新規直接取得（§1.4）で裏取り済み。**唯一の完全一致precedent(sanketsudake)自体がOmarchy所有領域を意図的に管理外にしている**——「Aで全部やる」ことへの一次資料からの反例。
- **Bへの否定**: chezmoiの「apply忘れ」(Wantedly、chezmoi-topic記録既出)、ファイル名エンコードの摩擦(karlmdavis #27、既出)、jonathanbartlett.co.ukの「lesser of many evils」評価（5回乗り換えても満足しきっていない）。サービス管理の一次機構が無く、間接パターン（unitファイルを普通のdotfileとして置き、`run_onchange_`で有効化）に頼らざるを得ない点も、Aの`launchd.agents`/`systemd.user.services`という宣言的オプションと比べれば見劣りする。
- **Cへの否定**: Ben Mezger自身の結論——「Nixで統一したい」という動機から出発しながら、macOSでは"obstacles with Nix"によりNixを断念してHomebrew手動運用+chezmoiに後退(§2.3)。この1件の一次資料は、ハイブリッドが「良いとこ取り」ではなく「境界線を人力で維持し続けるコスト」を生むことを具体的に示している。alfonsofortunatoもSSH鍵の扱いを「まだ完璧な解を見つけていない」と自認(§2.2)——ハイブリッド2例とも、何らかの未解決の縫い目を抱えたまま公開されている。
- **Dへの否定**: GNU StowはOmarchy公式マニュアルの推薦と実装が矛盾したまま4件のバグがopen(既出記録、本記録§1.6で再確認)。rcmは約16ヶ月停止し、実践者1名(smasato)が既に離脱済み。dotterには1Password相当のネイティブ機構が無い(新規判明、補助表)。AnsibleはBen Mezger自身が「overkill」と述べて離脱(§2.3)。nix-maidのDarwin対応は確認できず、空白のまま。

---

## 確認できなかったこと

- Nix(A)側で「darwin+standalone home-managerを1つの冪等コマンドで統一する」vendorレシピ——flake-layout記録が既に「前例なし」と結論済みで、本記録でも新規の反証は見つからなかった。
- Aで1Password統合(opnix)を実際に日々使っている個人の実践者ブログ・体験談——brizzbuzz/opnixはvendor一次資料(README)のみで、運用報告を書いた第三者の一次資料は見つからなかった。
- nix-maidのDarwin/launchd対応の有無——README本文の直接取得に失敗(`[未到達]`、`raw.githubusercontent.com/viperML/nix-maid/{main,master}/README.md`いずれも404)、WebSearch要約はsystemd/Linux志向を示唆するのみで断定できない。
- dotter・yadm・Ansibleのlaunchd/systemd連携の一次資料——今回の時間配分では1Password(5)とOmarchy共存(7)を優先し、これらツールのサービス管理は個別に検証していない。
- mise自体のtaskランナーをdotfiles全体のinstall/updateエントリポイントとして使っている実践者の一次資料——検索した範囲では見つからず、「前例なし」として扱う。
- 「一度Cのようなハイブリッドを採用してから、AまたはBの単一ツールに一本化した」という、Cから離脱した側の一次資料——今回は見つからなかった（Ben Mezgerの journey はB→A志向→Cで着地しており、Cから離脱した例ではない）。
- alfonsofortunatoの"Replaced Stow ... allowing me to create symlinks"という記述とchezmoiのデフォルトcopyモードとの整合——著者がsymlinkモードを明示的に有効化しているのか、単なる不正確な自己記述なのか、原文の追加箇所（要約経由のみ取得）では確認できなかった。

---

## 結論

**この形（macOS + 実機x86_64 Omarchy/Arch、日次編集の設定、外部生成器が触るディレクトリ、1Password CLI、launchd/systemd常駐サービス、単一冪等コマンド）に対して、証拠が最もよく支持するのはBまたはC——chezmoiをファイル層に据える形であり、「Aだけで全部やる」方向には強い反証が集まっている。**

平易に言うと: macOSとArchの両方を実際に運用している名前つきの実践者を今回5人・5リポジトリぶん読んだ（jpoissonnet=B、alfonsofortunato=C、Ben Mezger=C、sspaeti=D/Stow、sanketsudake=A）。**Aを完全な形で、両機とも不足なく使っている例は1つもなかった**——唯一のAの完全一致precedentであるsanketsudakeでさえ、Omarchyが所有する領域（Hyprland・git・btop）を最初からhome-managerの管理外に置いている。Nixに最も期待し、最終的にNixOS+home-managerへ移行したBen Mezgerでさえ、macOS側では「Nixに壁を感じた」と述べてHomebrewの手動運用に後退し、結局chezmoiをアプリ設定層として残した。

**Bの技術的な強みは3点、いずれも今回新規に一次資料で確認できた**: (1) デフォルトのcopyモードは、Omarchyの更新スクリプトが持つ「symlinkを検知せず`cp -f`/`mv`で壊す」というバグ群（#5013/#9326/#10413/#11096、既出記録）が構造的に当てはまらない——対象がそもそもsymlinkではないため。(2) `onepasswordRead`は所有者が既に使っている対話的`op`CLIセッションでそのまま動く一次テンプレート関数で、Nix側の対応物である`opnix`がサービスアカウントトークンを要求し、しかも前身がハッカソン産のarchivedプロジェクトだったのと比べ、要件との摩擦が小さい。(3) `run_onchange_`スクリプトによる`brew bundle`/`pacman`呼び出しがvendorの公式サンプルとして存在し、jpoissonnet/dotfilesという直接一致するprecedentが「`chezmoi apply`だけで全部入る」ことを実証している。さらに同じリポジトリは、この所有者とまったく同型の問題（コーディングエージェントが書き出す`~/.claude.json`をどう扱うか）に対し、「Not copied by design」という最も単純な答え——管理対象に加えないだけ——を既に実践で示している。

**Bの弱みも同じ重さで存在する**: サービス管理（launchd/systemd）に一次の宣言的オプションが無く、Aの`launchd.agents`/`systemd.user.services`（vendorソース直読で確認済みの対称設計）に比べると間接的（unitファイルを普通のdotfileとして置き、`run_onchange_`で有効化するしかない）。「apply忘れ」という運用上の実害も、1年運用した実践者（Wantedly）の一次報告として存在する。

**Cについては、証拠は「動く」ことは示すが「単純である」ことは示さない。** 3つの実例（jpoissonnet寄りの構成、alfonsofortunato、Ben Mezger）はいずれもパッケージ管理を2系統（例: Homebrew+Nix、pacman+Nixの補完）に分けており、Ben Mezgerの一次資料はその境界線を人力で維持し続けるコストと、macOSでのNix断念という具体的な後退を記録している。所有者の現行スタック（Homebrew via nix-darwin + brew-nix + mise）は既にこのハイブリッドの性質を一部持っており、Cを選ぶことは「今の複雑さを別の複雑さに置き換える」側面がある、とだけ言える。

**Dについては、GNU StowはOmarchy自身の推薦と実装の矛盾という最も濃い負の証拠を持ち、rcmは16ヶ月停止し離脱例もあり、dotterには1Password相当のネイティブ機構が無く、hjem/nix-maidはNix系の代替として実在し活発だが個人の複数OS運用実績を示す一次資料が見つからなかった——**いずれも今回の形に対して、AやB/Cを上回る根拠は見つからなかった。**

**支持されない主張**: 「Nix(home-manager)だけで両機を隙間なく統一する」——完全一致precedentが自ら除外している。「chezmoiにすればサービス管理までAと同等に宣言的になる」——一次のサービス機構は存在せず間接パターンのみ。「ハイブリッドにすれば両方のいいとこ取りができる」——最も詳細な一次資料（Ben Mezger）はむしろ後退と未解決の縫い目を報告している。
