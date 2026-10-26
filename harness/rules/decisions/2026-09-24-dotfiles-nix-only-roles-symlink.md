# dotfilesはNix一本で組み直す: OSは自動判定、役割は機械ローカル、編集する設定はrepoへのsymlink、入口は一つ

Status: accepted — 持ち主の裁定（2026-09-24）。要件: 機械の名前やユーザー名に依存せずOSと役割で決まる、installとupdateが一つ、管理の道具を二つ並べない。二つの擁護側調査を並べて比べた後に決めた。ディレクトリとアーキテクチャの詳細は別途（設計の調査と提案の後に別の決定メモ）

rule: Manage the dotfiles with Nix alone (nix-darwin on macOS, standalone home-manager on Linux) — never add chezmoi or another dotfiles manager beside it. The platform is detected, never keyed by hostname or username; a machine's roles live in an untracked machine-local file the flake reads at build time, and only what each role means is committed. Configs edited daily are symlinks into the repository (`mkOutOfStoreSymlink`), never store copies. `make up` is the one idempotent entry for both install and update. The OS's own package manager (Homebrew casks through nix-darwin, pacman on Omarchy) installs GUI apps only; mise keeps language runtimes; jig keeps owning the coding-agent directories.
scope: repo

## Problem

今のdotfilesはMac専用で、入口が二つ（`make install` / `make update`）あり、パッケージの入れ方が五通り、リンク管理は655行のbashにツール名ごとの特別扱いが10個、役割（家のLLMのhubかどうか）は「LM Studio.appがあるか」で二か所で判定している。Omarchy機を足すにあたり、機械の名前やユーザー名に依存せず、OSと役割で何を入れるかが決まる形にしたい。

## Decision

- 道具はNix一本。chezmoiなど別のdotfiles管理を並べない。
- OSは自動判定。役割（desktop・dev・llm-hub・gpuなど）は機械ローカルの追跡しないファイルに書き、flakeが読む。repoには役割の中身だけ。
- 毎日編集する設定はrepoへのsymlink（`mkOutOfStoreSymlink`）。ストアのコピーにしない。
- 入口は`make up`一本、何度走らせても同じ結果。
- GUIアプリだけOSのパッケージ管理（Macはnix-darwin経由のHomebrew cask、Omarchyはpacman）。実行環境はmise。coding agentのディレクトリはjig。
- 作り直しではなく段階的に組み替える。

## Alternatives considered

- **chezmoi一本**: Mac + Linuxの同形の実例（skenmy/dotfiles）はある。だがコピーのずれが実害として繰り返し起きる（stanfish06/my-configs #140、二か月に4回）、OS間の版固定がない（laurigates/dotfiles #418で二週間CI破損）、ロールバックなし、コンテナへの焼き込みが後退、今のNix資産と9/22の裁定を捨てる。却下。
- **chezmoi（ファイル）+ Nix（パッケージ）**: 管理の道具を二つ並べることになる。境界の人力維持の手間が実践者から報告されている（Ben Mezger）。
- **一から作り直す**: 根拠なし（五回乗り換えても「一番ましな悪」）。却下。

## Consequences

- 引き受けるリスク: `mkOutOfStoreSymlink`のmulti-user権限不具合（home-manager #4692、一年半放置）→ Omarchyで最初に試し、当たればその部分だけ小さな自前リンクへ。macOSの大型更新でのnix-darwinの破損（#1866、2026-09-15）→ `flake.lock`とロールバックで戻す。`launchd.agents` / `systemd.user.services`は個人dotfilesでの実例ゼロ → 一サービスで試してから広げる。
- `plans/2026-09-24-omarchy-support.md`はこの決定とアーキテクチャの決定に合わせて書き直す。
- `2026-09-22-tools-nix-list-box-subset.md`（CLIはNix、実行環境はmise、箱はNixの一覧から焼く）は変わらない。

## Sources

- chezmoi実践者の同規模実装（macOS/Linux/Windows統一）: https://github.com/skenmy/dotfiles
- chezmoi運用でのドリフト再発（4回未満2か月）: https://github.com/stanfish06/my-configs/issues/140
- Homebrew経由のバージョン未固定によるコスト事故: https://github.com/laurigates/dotfiles/issues/418
- `mkOutOfStoreSymlink`のマルチユーザー権限不具合: https://github.com/nix-community/home-manager/issues/4692
- nix-darwinの大型macOS更新での破損: https://github.com/nix-darwin/nix-darwin/issues/1866
