# macOS（nix-darwin）と非 NixOS Linux（Arch 系）を一つの Nix flake で構成するとき、業界標準はどの形か

確認日: 2026-09-23

## 答え

ホスト名をキーにした共有関数（1機=1エントリ、bool フラグ等で darwinSystem/nixosSystem・home-manager の darwinModules/nixosModules を分岐）へ移すのが業界標準に近い。Linux 側が NixOS ではなく既存の Arch 系ディストリビューションのままである場合は、nix-darwin 相当の「システム全体を Nix が管理する」層は導入せず、standalone の `homeConfigurations`（`home-manager.lib.homeManagerConfiguration`）をその上に薄く足す構成が唯一の完全一致する実例で裏付けられる。`forAllSystems`/`genAttrs` のようなシステム文字列を総なめにするヘルパーは、`packages`/`devShells`/`formatter` など「システムごとに存在する出力」にのみ使うべきで、`darwinConfigurations`/`nixosConfigurations`/`homeConfigurations` のようなホスト単位の出力をそれで生成することは vendor（flake-utils）自身が明示的に避けるべきだとしている書き方であり、1アーキテクチャ=1台という制約のもとでしか安全に機能しない。ユーザー名を `builtins.getEnv` で環境から読む書き方は、調査した実践者例のどれにも見当たらず、全員が固定文字列を使っている。

## 根拠

- `mitchellh/nixos-config`（★3,109、直接取得）: `lib/mksystem.nix` が一つの関数で `darwin` という bool フラグを受け取り、`darwinSystem`/`nixosSystem` と `home-manager.darwinModules`/`.nixosModules` を切り替え、同じ home-manager 設定ファイルを両OSに適用している。呼び出しは `darwinConfigurations.macbook-pro-m1 = mkSystem "macbook-pro-m1" { system = "aarch64-darwin"; user = "mitchellh"; darwin = true; };` という形でホスト名をキーにする。
- `sanketsudake/dotfiles` PR #88（マージ済み 2026-09-21、直接取得）: macOS は nix-darwin + home-manager（darwin module）、実機の Arch 系 Linux（Omarchy）は `homeConfigurations` による standalone home-manager という組み合わせの唯一の完全一致例。`packages.x86_64-linux.home-manager` を flake 自身に持たせ、home-manager CLI 自体のインストールも flake.lock に固定している。ただし「Omarchy 自身が管理するパス（`~/.config/hypr` 等）は対象外」と明記——home-manager は CLI パッケージなど部分的にしか適用していない。
- `numtide/flake-utils` の README（直接取得）: `eachSystemPassThrough`/`eachDefaultSystemPassThrough` が `homeConfigurations`/`nixosConfigurations` 専用に別建てされているのは、これらがシステム文字列ではなくホスト名/ユーザー名でキーされるべきだからだと明記。
- `Misterio77/nix-starter-configs`（★3,837、home-manager の共同メンテナが関与、直接取得）: `forAllSystems` は `packages`/`formatter` にのみ使い、`nixosConfigurations`/`homeConfigurations` は「your-hostname」「your-username@your-hostname」という人が書き換える前提のプレースホルダでキーしている。
- `dustinlyons/nixos-config`（★3,626）はシステム文字列で `darwinConfigurations` を `genAttrs` 生成する対抗例だが、これは「1アーキテクチャ=1台」という制約に依存しており、2台目の同アーキテクチャ機を追加すると壊れる。
- home-manager 本体（`modules/launchd/default.nix`, `modules/systemd.nix`、直接取得）: `launchd.agents`/`systemd.user.services` はそれぞれ `pkgs.stdenv.hostPlatform.isDarwin`/`isLinux` から `enable` の既定値を自動判定し、Darwin 以外で launchd を有効化しようとすると eval がアサーションで即座に失敗する（サイレントな無視ではない）。
- Nix の pure-eval 設計（`nix.dev` マニュアル、直接取得）: 「フレークの評価結果は明示的に宣言された入力だけで決まり、外部状態に影響されない」ため `builtins.getEnv "USER"` は `--impure` を要求する既知の弱点であり、調査した4つの実践者リポジトリはすべてユーザー名を固定文字列にしていた。

## 注意点

- 同じ持ち主が macOS + 実機 Linux の単一 flake を1年以上運用し続けている実例は見つからなかった（唯一の完全一致例は調査時点で2日前にマージされたばかり）。
- 「一度この組み合わせを採用してからやめた」という否定的な一次情報は、意図的に探したが見つからなかった。
- home-manager の `launchd.agents`/`systemd.user.services` ネイティブオプションを実際に採用している個人 dotfiles の実例は見つからなかった。
- 実機 Linux 側のアーキテクチャ（x86_64）向けの cache.nixos.org ヒット率やインストール時間は実測されていない。
- Omarchy（Arch 系）を NixOS に置き換えて見た目だけ再現する方向のプロジェクトは複数存在するが、いずれも vendor 非公認で、片方は10ヶ月以上更新が止まっている。
