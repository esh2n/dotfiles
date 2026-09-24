# SPEC: dotfiles のアーキテクチャ（Nix 一本、OS × 役割）

状態: 草案（2026-09-24）。未決事項を持ち主と一つずつ詰めてから確定し、段階ごとに実装する。実装が終わったら結論を決定メモに残し、このファイルは消す。`plans/2026-09-24-omarchy-support.md` はこの SPEC に吸収した（Omarchy 対応は M2 以降）。

裁定: `rules/decisions/2026-09-24-dotfiles-nix-only-roles-symlink.md`（Nix 一本、OS 自動判定、役割は機械ローカル、編集する設定は repo への symlink、`make up` 一本）。根拠: `rules/research/2026-09-24-{nix-config-architecture,personal-tooling-language,steelman-nix,role-based-dotfiles,dotfiles-architecture,dotfiles-on-omarchy,chezmoi-copy-vs-symlink}.md`、`2026-09-23-multi-system-flake-layout.md`。

## 1. 原則

1. **モジュールシステムを DI として使う。** options が型付きのインターフェース、config が実装。値の注入は上書きできる `_module.args`、`specialArgs` は import の解決に要る最小限（`inputs` と OS の種別）だけ（NixOS マニュアル・flake-parts が明記）。独自の汎用 DI 名前空間は作らない（提案者自身が使っていない）。
2. **薄く保つ。** 規約ベースの枠組み（snowfall-lib、std、ez-configs、digga）は四つとも停滞か撤退。flake-parts 程度の薄い合成までにとどめる。
3. **選択は外、意味は中。** どの役割かは機械ローカルの追跡しないファイル、役割が何を意味するかだけを commit する（yadm・chezmoi・Ansible が収束した形）。hostname とユーザー名はキーにも条件にも使わない。
4. **中身と配線を分ける。** `payload/` には `.nix` を一つも置かない。Nix は「どこへ置くか」だけを持つ。
5. **編集する設定は repo への symlink。** `mkOutOfStoreSymlink`。multi-user Nix での不具合（home-manager #4692）は Omarchy で最初に確かめる。
6. **vendor の仕組みを自作より優先する。** 常駐サービスは home-manager の `launchd.agents` / `systemd.user.services`、パッケージは nixpkgs、整形は treefmt-nix。
7. **言語は閾値で選ぶ。** 100 行か素直でない制御フローを超える shell は構造化された言語へ（Google Shell Style Guide）。WASM は単独 CLI の前例がないので使わない。

## 2. 層と依存の向き

```
flake.nix                      入口。組み立て関数を呼ぶだけ
  └─ nix/lib/mk-darwin.nix / mk-home.nix     OS ごとの組み立て
       ├─ nix/lib/facts.nix                  唯一の不純な読み取り（$USER、$HOME、役割ファイル）
       ├─ nix/platforms/{darwin,linux}.nix   OS 固有（system.defaults、Homebrew cask、Omarchy の境界）
       └─ nix/roles/*.nix                    役割 = options.dotfiles.roles.<name>.enable
            └─ nix/modules/**                機能（パッケージ、アプリ、サービス、秘密情報、テーマ、ハーネス）
                 └─ payload/**               中身（.nix なし）
```

- 上から下へだけ参照する。module は role を知らない。role 同士も参照しない。
- OS の分岐は `pkgs.stdenv.hostPlatform.isDarwin` / `isLinux` だけ。`osConfig` は参照しない（standalone home-manager では空になる）。CI で機械的に検査する。
- `imports` を `config` に依存させない（無限再帰）。
- flake の出力名は OS だけ: `darwinConfigurations.mac`、`homeConfigurations.linux`。

## 3. ディレクトリ

```
dotfiles/
├── bootstrap.sh              # Nix が無ければ入れて `nix run .#dotctl -- up`（Nix より前に動くので shell、100 行未満）
├── Makefile                  # up / check / fmt（中身は bootstrap.sh と dotctl を呼ぶだけ）
├── flake.nix, flake.lock     # darwinConfigurations.mac、homeConfigurations.linux、packages.*.dotctl、checks.*、formatter
├── roles.example.json        # 役割ファイルの形の例。実体は ~/.config/dotfiles/roles.json（追跡しない）
├── nix/
│   ├── lib/
│   │   ├── facts.nix         # $USER・$HOME・役割ファイルを読み、形を assertions で検査
│   │   ├── mk-darwin.nix     # nix-darwin + home-manager（darwin モジュール）
│   │   └── mk-home.nix       # standalone home-manager
│   ├── platforms/
│   │   ├── darwin.nix        # system.defaults、Homebrew cask・formula、Mac App Store
│   │   └── linux.nix         # Omarchy が持つ領域を触らない宣言、pacman の一覧
│   ├── roles/
│   │   ├── options.nix       # options.dotfiles.roles.<name>.enable（一つの名前空間）
│   │   └── base.nix, dev.nix, desktop.nix, llm-hub.nix, gpu.nix
│   └── modules/
│       ├── packages/         # cli.nix、lsp.nix、box.nix（箱に焼く Linux 用の一覧）
│       ├── programs/<app>.nix     # アプリごと: payload のどのファイルを ~/ のどこへ symlink するか
│       ├── services/
│       │   ├── mk-service.nix     # 一つの宣言から launchd か systemd --user を出す（home-manager の options の薄い包み）
│       │   └── litellm.nix, jig-decision.nix, lmstudio-awake.nix, observability.nix, llama-server.nix
│       ├── secrets.nix       # サービス起動時の `op run`、トークンの置き場（Mac は Keychain、Linux は libsecret）
│       ├── theme.nix         # テーマの仕組みだけ（選択は持たない）
│       └── harness.nix       # activation の最後に jig apply
├── payload/                  # 中身だけ。.nix は置かない
│   ├── home/<app>/           # zsh、nvim-*、tmux、zellij、ghostty、wezterm、git、starship、mise、jj、herdr、serena、aerospace、sketchybar …
│   ├── services/<name>/      # litellm の config.yaml・compose・起動スクリプト など
│   └── themes/<name>/<app>.* # テーマの断片（アプリの include 先）
├── tools/
│   ├── dotctl/               # 自作 CLI（一つのバイナリにサブコマンド）: cmd/、internal/{log,errors,config,secrets,theme,up,status}
│   └── scripts/              # 100 行未満の shell（writeShellApplication で包む）と lib/（log・error の共通関数）
├── domains/dev/llm/harness/  # jig と agent の元。移すかは別の決定（→ harness/）
├── tests/                    # shell（bats）、dotctl（go test）。Nix の検査は flake の checks
└── docs/
```

生活領域（creative・dev・infra・system・workspace）の分け方はやめる。前例がなく、中身の境界も崩れていた。

## 4. `make up` の流れ

1. `bootstrap.sh`: Nix が無ければ入れる（Mac は Determinate の installer、Omarchy は公式 installer の `--daemon`）。
2. `nix run .#dotctl -- up`（dotctl 自身も flake で固定される）。
3. dotctl が OS を判定し、`darwin-rebuild switch --flake .#mac --impure` か `home-manager switch --flake .#linux --impure`（home-manager 自体も flake で固定）。`--impure` は facts.nix の読み取りのためだけ。
4. Linux は pacman の一覧を入れる（無いものだけ）。両方で `mise install`。
5. activation の最後に jig apply。最後に健康確認（`dotctl status`）。

何度走らせても同じ結果になる。install と update の区別はない。

## 5. 常駐サービス

- `mk-service.nix` が「コマンド・引数・秘密情報の参照・ログ・自動起動」の小さな宣言を受け取り、Mac は `launchd.agents`、Linux は `systemd.user.services` を出す。
- 秘密情報は起動時に `op run --env-file=<参照ファイル> -- <コマンド>`。人のいない起動なので、1Password のサービスアカウントのトークンを OS の保管場所（Mac は Keychain、Linux は libsecret）から読む。
- 有効化は役割で: `llm-hub` で LiteLLM・observability・Open WebUI、`gpu` で llama-server、Mac の `llm-hub` で LM Studio の keep-awake。
- 個人 dotfiles での実例がないので、jig-decision（今は誰も起動していない）で最初に試し、llama-server は最後。

## 6. 自作ツール

- **shell に残す**: 100 行未満で素直なもの（gh 拡張の更新、壁紙取得など）。`writeShellApplication` で包み（shellcheck が自動で走り、依存コマンドを固定）、共通関数は `tools/scripts/lib/` の一か所。テストは bats。
- **シェルでしかできないもの**: `cd`、環境変数、プロンプトのフック、fzf のウィジェットは zsh 関数として `payload/home/zsh/` に残す（mise・starship も `eval` させる一行が要る）。
- **dotctl に移す**: theme-switch、mado、nvim-switch、code-graph-cache-gc、家の LLM の確認、zsh 関数のうちシェルの状態を変えない部分。一つのバイナリのサブコマンドにし、ログ・エラー・設定・秘密情報を `internal/` の共通部品にする。
- **言語**: 証拠は Go を支持（個人 dotfiles の CLI の実例 chezmoi、起動 9ms・2.1MiB、ビルド 1.85 秒、`buildGoModule`）。Rust は同じ形の実例がほぼなく（5 件、最大 3★）ビルドも遅い。Bun の単一バイナリには再現バグ（#14676・#24470）と 60MiB。
- **WASM は使わない。** 単独 CLI の前例がなく、ファイルやネットワークの権限モデルがこのツール群の仕事と衝突する。

## 7. テーマ切り替え

- アプリの設定本体は `payload/home/<app>/`、テーマの断片だけ `payload/themes/<name>/<app>.*`。本体は include で `~/.config/theme/current/<app>.*` を読む。
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
- **M3**: アプリの設定を `payload/home/<app>/` と `programs/<app>.nix` へ一つずつ移し、`manager.sh` を消す。役割の中身をここで埋める。
- **M4**: 常駐サービスを `mk-service` に（jig-decision → LiteLLM → observability → llama-server）。
- **M5**: dotctl を作り、theme-switch と大きい shell を移す。テーマの仕組みを入れ替える。
- **M6**: ハーネスの置き場所を決め直す（別の決定）。

## 10. やらないこと

snowfall-lib・std・ez-configs・digga のような枠組み、dendritic を背骨にすること（本家に darwin の実例なし）、独自の DI 名前空間、NixOS の VM テスト、WASM、chezmoi、Ansible、自作 CLI の Rust 化と Bun の単一バイナリ化。

## 11. 未決事項（持ち主が決める）

1. dotctl の言語: 証拠の上では Go。ハーネスと揃えて TypeScript（Bun）にしたいかは持ち主の判断。
2. 役割ファイルの場所と形（案: `~/.config/dotfiles/roles.json`、`{"roles": [...]}`）と役割の一覧（案: base・dev・desktop・llm-hub・gpu）。
3. ハーネスを `harness/` に移すか（`2026-09-22-config-layout-no-personal-layer.md` の置き換えになる）。
4. テーマを include で読めないアプリの一覧（実装時に棚卸し）。
5. モジュール単体テストをいつ入れるか。
