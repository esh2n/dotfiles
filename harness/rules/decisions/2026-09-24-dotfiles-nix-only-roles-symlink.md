# dotfiles は Nix 一本で組み直す: OS は自動判定、役割は機械ローカル、編集する設定は repo への symlink、入口は一つ

Status: accepted — 持ち主の裁定（2026-09-24、「では、ニックスでいきましょう」）。経緯: Omarchy 対応の計画から「hostname やユーザー名に依存してはいけない、OS と役割で決める ACL のようなモデル」→「install と update は一つであるべき」→「chezmoi と Nix の両方を入れるのは一番ない」→「どちらにも偏らずフラットに」の二つの擁護側調査を並べた比較の後。ディレクトリとアーキテクチャの詳細は別途（設計の調査と提案の後に別の決定メモ）

rule: Manage the dotfiles with Nix alone (nix-darwin on macOS, standalone home-manager on Linux) — never add chezmoi or another dotfiles manager beside it. The platform is detected, never keyed by hostname or username; a machine's roles live in an untracked machine-local file the flake reads at build time, and only what each role means is committed. Configs edited daily are symlinks into the repository (`mkOutOfStoreSymlink`), never store copies. `make up` is the one idempotent entry for both install and update. The OS's own package manager (Homebrew casks through nix-darwin, pacman on Omarchy) installs GUI apps only; mise keeps language runtimes; jig keeps owning the coding-agent directories.

## Problem

今の dotfiles は Mac 専用で、入口が二つ（`make install` / `make update`）あり、パッケージの入れ方が五通り、リンク管理は 655 行の bash にツール名ごとの特別扱いが 10 個、役割（家の LLM の hub かどうか）は「LM Studio.app があるか」で二か所で判定している。Omarchy 機を足すにあたり、機械の名前やユーザー名に依存せず、OS と役割で何を入れるかが決まる形にしたい。

## Decision

- 道具は Nix 一本。chezmoi など別の dotfiles 管理を並べない。
- OS は自動判定。役割（desktop・dev・llm-hub・gpu など）は機械ローカルの追跡しないファイルに書き、flake が読む。repo には役割の中身だけ。
- 毎日編集する設定は repo への symlink（`mkOutOfStoreSymlink`）。ストアのコピーにしない。
- 入口は `make up` 一本、何度走らせても同じ結果。
- GUI アプリだけ OS のパッケージ管理（Mac は nix-darwin 経由の Homebrew cask、Omarchy は pacman）。実行環境は mise。coding agent のディレクトリは jig。
- 作り直しではなく段階的に組み替える。

## Alternatives considered

- **chezmoi 一本**: Mac + Linux の同形の実例（skenmy/dotfiles）はある。だがコピーのずれが実害として繰り返し起きる（stanfish06/my-configs #140、二か月に 4 回）、OS 間の版固定がない（laurigates/dotfiles #418 で二週間 CI 破損）、ロールバックなし、コンテナへの焼き込みが後退、今の Nix 資産と 9/22 の裁定を捨てる。却下。
- **chezmoi（ファイル）+ Nix（パッケージ）**: 持ち主が「一番ない」と却下。境界の人力維持の手間が実践者から報告されている（Ben Mezger）。
- **一から作り直す**: 根拠なし（五回乗り換えても「一番ましな悪」）。却下。

## Consequences

- 引き受けるリスク: `mkOutOfStoreSymlink` の multi-user 権限不具合（home-manager #4692、一年半放置）→ Omarchy で最初に試し、当たればその部分だけ小さな自前リンクへ。macOS の大型更新での nix-darwin の破損（#1866、2026-09-15）→ `flake.lock` とロールバックで戻す。`launchd.agents` / `systemd.user.services` は個人 dotfiles での実例ゼロ → 一サービスで試してから広げる。
- `plans/2026-09-24-omarchy-support.md` はこの決定とアーキテクチャの決定に合わせて書き直す。
- `2026-09-22-tools-nix-list-box-subset.md`（CLI は Nix、実行環境は mise、箱は Nix の一覧から焼く）は変わらない。

## Sources

- `rules/research/2026-09-24-steelman-nix.md`、`2026-09-24-steelman-chezmoi.md`
- `rules/research/2026-09-24-chezmoi-copy-vs-symlink.md`、`2026-09-24-dotfiles-tool-choice.md`、`2026-09-24-role-based-dotfiles.md`、`2026-09-24-dotfiles-architecture.md`、`2026-09-24-dotfiles-on-omarchy.md`
