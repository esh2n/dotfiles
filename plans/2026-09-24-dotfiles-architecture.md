# SPEC: dotfiles のアーキテクチャ（Nix 一本、OS × 役割）

状態: 草案（2026-09-24）。未決事項を持ち主と一つずつ詰めてから確定し、段階ごとに実装する。実装が終わったら結論を決定メモに残し、このファイルは消す。`plans/2026-09-24-omarchy-support.md` はこの SPEC に吸収した（Omarchy 対応は M2 以降）。

裁定: `rules/decisions/2026-09-24-dotfiles-nix-only-roles-symlink.md`（Nix 一本、OS 自動判定、役割は機械ローカル、編集する設定は repo への symlink、`make up` 一本）。根拠: `rules/research/2026-09-24-{nix-config-architecture,personal-tooling-language,steelman-nix,role-based-dotfiles,dotfiles-architecture,dotfiles-on-omarchy,chezmoi-copy-vs-symlink}.md`、`2026-09-23-multi-system-flake-layout.md`。

## 1. 原則

1. **モジュールシステムを DI として使う。** options が型付きのインターフェース、config が実装。値の注入は上書きできる `_module.args`、`specialArgs` は import の解決に要る最小限（`inputs` と OS の種別）だけ（NixOS マニュアル・flake-parts が明記）。独自の汎用 DI 名前空間は作らない（提案者自身が使っていない）。
2. **薄く保つ。** 規約ベースの枠組み（snowfall-lib、std、ez-configs、digga）は四つとも停滞か撤退。flake-parts 程度の薄い合成までにとどめる。
3. **選択は外、意味は中。** どの役割かは機械ローカルの追跡しないファイル、役割が何を意味するかだけを commit する（yadm・chezmoi・Ansible が収束した形）。hostname とユーザー名はキーにも条件にも使わない。
4. **一つの機能は一つのディレクトリに。** 配線の `default.nix` と中身のファイルを同居させ、`.nix` でない中身は評価から外れる（britter.dev）。配線と中身を別の木に分けると、一つのアプリの変更が二か所に散る。
5. **編集する設定は repo への symlink。** `mkOutOfStoreSymlink`。multi-user Nix での不具合（home-manager #4692）は Omarchy で最初に確かめる。
6. **vendor の仕組みを自作より優先する。** 常駐サービスは home-manager の `launchd.agents` / `systemd.user.services`、パッケージは nixpkgs、整形は treefmt-nix。
7. **言語は閾値で選ぶ。** 100 行か素直でない制御フローを超える shell は構造化された言語へ（Google Shell Style Guide）。WASM は単独 CLI の前例がないので使わない。

## 2. 層と依存の向き

```
flake.nix                    入口（composition root）。lib の組み立て関数を呼ぶだけ
  └─ lib/                    組み立て関数と、唯一の不純な読み取り facts.nix
       └─ roles/             役割 = どの機能を有効にするか（options.dotfiles.roles.<name>.enable）
            ├─ system/darwin/        OS 層のモジュール（nix-darwin。Linux は Omarchy が OS 層を持つので無い）
            └─ home/{shared,darwin,linux}/<機能>/   ユーザー層のモジュール（home-manager）と、その中身
                 └─ pkgs/, overlays/, harness/      自分で作るもの（モジュールから参照される）
```

- 上から下へだけ参照する。機能モジュールは role を知らない。role 同士も参照しない。
- 評価の文脈ごとに置き場を分ける: nix-darwin のモジュールは `system/`、home-manager のモジュールは `home/`。同じファイルに混ぜない（ryan4yin の `home/` と `modules/` の分け方、dustinlyons の `modules/{shared,darwin,nixos}`）。
- OS の分岐はディレクトリ（`shared` / `darwin` / `linux`）で表し、ファイルの中の条件分岐は最小限にする。条件が要るときは `pkgs.stdenv.hostPlatform.isDarwin` / `isLinux` だけ。`osConfig` は参照しない（standalone home-manager では空になる）。CI で機械的に検査する。
- `imports` を `config` に依存させない（無限再帰）。
- flake の出力名は OS だけ: `darwinConfigurations.mac`、`homeConfigurations.linux`。hostname とユーザー名はキーにも条件にも使わない。

## 3. ディレクトリ

一つの機能は一つのディレクトリにまとまる（配線の `default.nix` と、中身のファイルが同居する。britter.dev の「`.nix` でないファイルはモジュールの隣に置き、評価から外れる」形）。中身だけを別の木に分けると、一つのアプリの変更が二か所に散るため。

```
dotfiles/
├── flake.nix, flake.lock     # 出力: darwinConfigurations.mac、homeConfigurations.linux、packages、checks、formatter
├── Makefile                  # up / check / fmt
├── bootstrap.sh              # Nix が無ければ入れて `nix run .#dotctl -- up`（Nix より前に動くので shell）
├── roles.example.json        # 役割ファイルの形の例（実体は ~/.config/dotfiles/roles.json、追跡しない）
│
├── lib/                      # 組み立ての部品（ロジックはここに集める）
│   ├── facts.nix             #   唯一の不純な読み取り: $USER、$HOME、役割ファイル（形を assertions で検査）
│   ├── mk-darwin.nix         #   nix-darwin + home-manager を組み立てる
│   ├── mk-home.nix           #   standalone home-manager を組み立てる
│   └── mk-service.nix        #   一つの宣言から launchd / systemd --user を出す
│
├── roles/                    # 役割 = どの機能を有効にするか（中身は持たない）
│   ├── options.nix           #   options.dotfiles.roles.<name>.enable（一つの名前空間）
│   └── base.nix, dev.nix, desktop.nix, llm-hub.nix, gpu.nix
│
├── system/                   # OS 層（nix-darwin だけ。Omarchy の OS 層は Omarchy のもの）
│   └── darwin/               #   defaults.nix（Dock・キーボード）、homebrew.nix（cask・formula・App Store）、nix.nix
│
├── home/                     # ユーザー層（home-manager）。一機能一ディレクトリ、中身は同居
│   ├── shared/               #   両 OS
│   │   ├── zsh/              #     default.nix、zshenv、zshrc、functions/（シェルでしかできない関数）
│   │   ├── nvim/             #     default.nix、lazyvim/、nvchad/、astronvim/、custom/
│   │   ├── git/ tmux/ zellij/ ghostty/ wezterm/ starship/ mise/ jj/ herdr/ serena/ …
│   │   ├── packages/         #     cli.nix、lsp.nix
│   │   ├── services/         #     litellm/、jig-decision/、observability/（それぞれ default.nix と設定・compose・起動スクリプト）
│   │   ├── secrets/          #     起動時の op run、トークンの置き場
│   │   ├── theme/            #     default.nix（仕組み）と palettes/<name>/（テーマの断片）
│   │   └── harness/          #     default.nix: harness/ を ~/.claude などへ jig で届ける配線
│   ├── darwin/               #   Mac だけ: aerospace/、sketchybar/、borders/、hammerspoon/、lmstudio-awake/、vscode/ …
│   └── linux/                #   Omarchy だけ: omarchy/（触らない領域の宣言）、pacman/、llama-server/
│
├── pkgs/                     # 自分でビルドするもの（ryan4yin・Misterio77 の pkgs/）
│   ├── dotctl/               #   自作 CLI（一つのバイナリにサブコマンド）と default.nix
│   ├── scripts/              #   100 行未満の shell（writeShellApplication）と lib/（共通関数）
│   └── spanner-cli/ …        #   今 overlays.nix で作っているもの
├── overlays/                 # 上流パッケージの差し替え（gh の版固定、gotools の調整）
│
├── harness/                  # coding agent のハーネス（jig、rules、skills、agents、policy、mcp）。独立したアプリ
├── projects/                 # dotfiles ではない同居アプリ（writeup-kit、artifact-worker、dopa-shorts）
│
├── tests/                    # bats、dotctl の統合テスト（Nix の検査は flake の checks）
├── docs/                     # 使い方のサイト
└── .github/workflows/
```

- `domains/` は無くなる。生活領域での分け方は前例がなく、境界も崩れていた。
- `harness/` を一番上に出すのは、それ自体がテストと CI を持つ一つのアプリだから。`2026-09-22-config-layout-no-personal-layer.md`（harness は `domains/dev/llm/harness` に置く）を置き換える決定が要る。
- `projects/` は、dotfiles の外へ出すかどうかを別に決める（出すなら不要）。

## 4. `make up` の流れ

1. `bootstrap.sh`: Nix が無ければ入れる（Mac は Determinate の installer、Omarchy は公式 installer の `--daemon`）。
2. `nix run .#dotctl -- up`（dotctl 自身も flake で固定される）。
3. dotctl が OS を判定し、`darwin-rebuild switch --flake .#mac --impure` か `home-manager switch --flake .#linux --impure`（home-manager 自体も flake で固定）。`--impure` は facts.nix の読み取りのためだけ。
4. Linux は pacman の一覧を入れる（無いものだけ）。両方で `mise install`。
5. activation の最後に jig apply。最後に健康確認（`dotctl status`）。

何度走らせても同じ結果になる。install と update の区別はない。

## 5. 常駐サービス

- `lib/mk-service.nix` が「コマンド・引数・秘密情報の参照・ログ・自動起動」の小さな宣言を受け取り、Mac は `launchd.agents`、Linux は `systemd.user.services` を出す。
- 秘密情報は起動時に `op run --env-file=<参照ファイル> -- <コマンド>`。人のいない起動なので、1Password のサービスアカウントのトークンを OS の保管場所（Mac は Keychain、Linux は libsecret）から読む。
- 有効化は役割で: `llm-hub` で LiteLLM・observability・Open WebUI、`gpu` で llama-server、Mac の `llm-hub` で LM Studio の keep-awake。
- 個人 dotfiles での実例がないので、jig-decision（今は誰も起動していない）で最初に試し、llama-server は最後。

## 6. 自作ツール

- **shell に残す**: 100 行未満で素直なもの（gh 拡張の更新、壁紙取得など）。`writeShellApplication` で包み（shellcheck が自動で走り、依存コマンドを固定）、共通関数は `pkgs/scripts/lib/` の一か所。テストは bats。
- **シェルでしかできないもの**: `cd`、環境変数、プロンプトのフック、fzf のウィジェットは zsh 関数として `home/shared/zsh/functions/` に残す（mise・starship も `eval` させる一行が要る）。
- **dotctl に移す**: theme-switch、mado、nvim-switch、code-graph-cache-gc、家の LLM の確認、zsh 関数のうちシェルの状態を変えない部分。一つのバイナリのサブコマンドにし、ログ・エラー・設定・秘密情報を `pkgs/dotctl/internal/` の共通部品にする。
- **言語**: 証拠は Go を支持（個人 dotfiles の CLI の実例 chezmoi、起動 9ms・2.1MiB、ビルド 1.85 秒、`buildGoModule`）。Rust は同じ形の実例がほぼなく（5 件、最大 3★）ビルドも遅い。Bun の単一バイナリには再現バグ（#14676・#24470）と 60MiB。
- **WASM は使わない。** 単独 CLI の前例がなく、ファイルやネットワークの権限モデルがこのツール群の仕事と衝突する。

## 7. テーマ切り替え

- アプリの設定本体は `home/<os>/<app>/`、テーマの断片だけ `home/shared/theme/palettes/<name>/<app>.*`。本体は include で `~/.config/theme/current/<app>.*` を読む。
- 切り替えは `dotctl theme <名前>` が `~/.config/theme/current` の symlink を一本張り替え、アプリごとの再読み込み（tmux の source-file など）を送るだけ。20 ファイルを書き換えない。
- include できないアプリだけ、コピーと再読み込みの表で扱う。Nix は仕組みだけを持ち、どのテーマかは持たない（切り替えにビルドを挟まない）。

## 8. テストと CI

- 整形と lint: treefmt-nix（nixfmt・statix・deadnix・shfmt・shellcheck・gofmt）。
- `nix flake check` は darwin の設定を検査しないので、`checks.<system>.build-mac` と `build-linux` を自分で配線する。
- macOS のランナーで Mac の設定、Linux のランナーで Linux の設定と dotctl。`osConfig` 参照の禁止を検査。bats と go test。
- NixOS の VM テスト、モジュール単体テスト（nix-unit）は今は入れない。

## 9. 進める順番（どの段階でも Mac は壊さない）

- **M0**: 使われていないもの（node2nix、対話ユーティリティ、未使用の関数）を消す。今の仕組みのまま入口を `make up` 一本にする。CI に Linux と shell の検査を足し始める。
- **M1**: `facts.nix`・`mk-darwin.nix`・役割の options を入れ、Mac の出力が一バイトも変わらないことを確かめる（役割ファイルは空で）。
- **M2**: `homeConfigurations.linux` を足し、Omarchy で `make up` を通す。最初に #4692（multi-user Nix での symlink）を確かめる。
- **M3**: アプリの設定を `home/<os>/<app>/` へ一つずつ移し（配線と中身を同居）、`manager.sh` を消す。役割の中身をここで埋める。
- **M4**: 常駐サービスを `mk-service` に（jig-decision → LiteLLM → observability → llama-server）。
- **M5**: dotctl を作り、theme-switch と大きい shell を移す。テーマの仕組みを入れ替える。
- **M6**: ハーネスを `harness/` へ、同居アプリを `projects/` か repo の外へ移す（どちらも別の決定）。

## 10. やらないこと

snowfall-lib・std・ez-configs・digga のような枠組み、dendritic を背骨にすること（本家に darwin の実例なし）、独自の DI 名前空間、NixOS の VM テスト、WASM、chezmoi、Ansible、自作 CLI の Rust 化と Bun の単一バイナリ化。

## 11. 未決事項（持ち主が決める）

1. dotctl の言語: 証拠の上では Go。ハーネスと揃えて TypeScript（Bun）にしたいかは持ち主の判断。
2. 役割ファイルの場所と形（案: `~/.config/dotfiles/roles.json`、`{"roles": [...]}`）と役割の一覧（案: base・dev・desktop・llm-hub・gpu）。
3. ハーネスを `harness/` に移すこと（`2026-09-22-config-layout-no-personal-layer.md` の置き換え）と、writeup-kit・artifact-worker・dopa-shorts を `projects/` に置くか repo の外へ出すか。
4. テーマを include で読めないアプリの一覧（実装時に棚卸し）。
5. モジュール単体テストをいつ入れるか。
