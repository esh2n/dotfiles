# macOS専用のHomebrewツール（herdr/wtp/thefuck/omp/codex/mo）をLinux側でどう届けるか

確認日: 2026-09-26

## 答え

6ツールの現状は、当初の想定より大幅に「Nixで足りている」側に寄っている。herdrはOmarchy自身がベースパッケージとして`/usr/bin/herdr`にインストールする（`omarchy-pkg-add herdr`）ため何も作る必要が無く、nixpkgsにもupstream最新版（0.9.1）が既に存在する。wtp（satococoa/wtp）はnixpkgsにupstream最新版（2.10.3）が既にあり、何も作る必要が無い。thefuckはnixpkgsから意図的に削除済み（upstreamがPythonの`imp`モジュール撤去に追従できず開発停止のため）で、Nixで追いかける理由はない。Linuxで使いたいならArch `extra`（独自パッチで生存）の`pacman -S thefuck`が現実的な唯一の経路。

omp（can1357/oh-my-pi、Homebrewタップの奥にある本体）は急成長中（星3万超、ほぼ日次リリース）で、①upstream自身のNix flake（home-managerモジュールまで提供）、②nixpkgsの同名パッケージ（数日〜1本遅れる）、③Homebrewタップと同型の`fetchurl`自前導出、の3経路が実在する。codex（openai/codex）は「nixpkgsには古いバージョンしかない」という前提が既に古く、このリポジトリが実際に固定するnixpkgs pinは要求バージョンを大幅に超えている。

mo（k1LoW/mo、Markdownビューア）だけが素直なNix導出を要する。upstreamは活発だが、nixpkgsの`pkgs.mo`は無関係な別ツール（`tests-always-included/mo`、Bash用Moustacheテンプレートエンジン）に既に占有されており、名前衝突がある。goreleaser製のLinux tarball + checksumsはそのまま`fetchurl`型の自作導出に使えるが、パッケージ名は`pkgs.mo`を避けて別名にする必要がある。

## 根拠

- Omarchyがherdrをベースパッケージとしてインストールする記述 — `install/omarchy-base.packages`、migration `migrations/1786273938.sh`（`raw.githubusercontent.com/omacom/omarchy`）
- nixpkgsの`herdr`（0.9.1）・`wtp`（2.10.3）がupstream最新と一致 — `pkgs/by-name/he/herdr/package.nix`、`pkgs/by-name/wt/wtp/package.nix`
- nixpkgsからthefuckを削除したPRとその理由 — https://github.com/NixOS/nixpkgs/pull/412191（"The author is unresponsive and has been inactive since january 2024"）
- Arch `extra`のthefuckが独自パッチ（pkgrel 13）で生存 — `archlinux.org/packages/search/json/?name=thefuck`
- omp本体（can1357/oh-my-pi）がupstream自身のNix flakeを提供する記述 — omp READMEのInstall節
- codexのnixpkgs pinが要求バージョンを超えていること — このリポジトリの`flake.lock`が固定するnixpkgsコミット上の`codex` package.nix
- `pkgs.mo`がBash用テンプレートエンジンと名前衝突していること — `pkgs/by-name/mo/mo/package.nix`（`tests-always-included/mo`）

## 注意点

- nixpkgsの各パッケージが実際にビルドに成功するかは、サンドボックスのnix daemon接続不可のためソース確認のみで検証していない。
- ompのnixpkgs版にLinux固有の依存（pipewireSupport、autoPatchelfHook）が実運用で問題なく動くかは未検証。
- miseのaqua-registry経由（`aqua:satococoa/wtp`、`aqua:k1LoW/mo`）が実際にインストールできるかは未実行。
- codexのビルド時間（rusty_v8のベンダリング込み）は未計測。
- Homebrew on Linux（Linuxbrew）がOmarchyで実際に動くかは未検証。
