# macOS 専用の Homebrew ツール（herdr/wtp/thefuck/omp/codex/mo）を Linux 側でどう届けるか

確認日: 2026-09-26

## 答え

6ツールの現状は、当初の想定より大幅に「Nix で足りている」側に寄っている。herdr は Omarchy 自身がベースパッケージとして `/usr/bin/herdr` にインストールする（`omarchy-pkg-add herdr`）ため何も作る必要が無く、nixpkgs にも upstream 最新版（0.9.1）が既に存在する。wtp（satococoa/wtp）は nixpkgs に upstream 最新版（2.10.3）が既にあり、何も作る必要が無い。thefuck は nixpkgs から意図的に削除済み（upstream が Python の `imp` モジュール撤去に追従できず開発停止のため）で、Nix で追いかける理由はない。Linux で使いたいなら Arch `extra`（独自パッチで生存）の `pacman -S thefuck` が現実的な唯一の経路。

omp（can1357/oh-my-pi、Homebrew タップの奥にある本体）は急成長中（星3万超、ほぼ日次リリース）で、①upstream 自身の Nix flake（home-manager モジュールまで提供）、②nixpkgs の同名パッケージ（数日〜1本遅れる）、③Homebrew タップと同型の `fetchurl` 自前導出、の3経路が実在する。codex（openai/codex）は「nixpkgs には古いバージョンしかない」という前提が既に古く、このリポジトリが実際に固定する nixpkgs pin は要求バージョンを大幅に超えている。

mo（k1LoW/mo、Markdown ビューア）だけが素直な Nix 導出を要する。upstream は活発だが、nixpkgs の `pkgs.mo` は無関係な別ツール（`tests-always-included/mo`、Bash 用 Moustache テンプレートエンジン）に既に占有されており、名前衝突がある。goreleaser 製の Linux tarball + checksums はそのまま `fetchurl` 型の自作導出に使えるが、パッケージ名は `pkgs.mo` を避けて別名にする必要がある。

## 根拠

- Omarchy が herdr をベースパッケージとしてインストールする記述 — `install/omarchy-base.packages`、migration `migrations/1786273938.sh`（`raw.githubusercontent.com/omacom/omarchy`）
- nixpkgs の `herdr`（0.9.1）・`wtp`（2.10.3）が upstream 最新と一致 — `pkgs/by-name/he/herdr/package.nix`、`pkgs/by-name/wt/wtp/package.nix`
- nixpkgs から thefuck を削除した PR とその理由 — https://github.com/NixOS/nixpkgs/pull/412191（"The author is unresponsive and has been inactive since january 2024"）
- Arch `extra` の thefuck が独自パッチ（pkgrel 13）で生存 — `archlinux.org/packages/search/json/?name=thefuck`
- omp 本体（can1357/oh-my-pi）が upstream 自身の Nix flake を提供する記述 — omp README の Install 節
- codex の nixpkgs pin が要求バージョンを超えていること — このリポジトリの `flake.lock` が固定する nixpkgs コミット上の `codex` package.nix
- `pkgs.mo` が Bash 用テンプレートエンジンと名前衝突していること — `pkgs/by-name/mo/mo/package.nix`（`tests-always-included/mo`）

## 注意点

- nixpkgs の各パッケージが実際にビルドに成功するかは、サンドボックスの nix daemon 接続不可のためソース確認のみで検証していない。
- omp の nixpkgs 版に Linux 固有の依存（pipewireSupport、autoPatchelfHook）が実運用で問題なく動くかは未検証。
- mise の aqua-registry 経由（`aqua:satococoa/wtp`、`aqua:k1LoW/mo`）が実際にインストールできるかは未実行。
- codex のビルド時間（rusty_v8 のベンダリング込み）は未計測。
- Homebrew on Linux（Linuxbrew）が Omarchy で実際に動くかは未検証。
