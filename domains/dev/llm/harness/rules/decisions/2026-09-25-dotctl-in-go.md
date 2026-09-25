# dotctl は Go で書く

Status: accepted — 持ち主の裁定（2026-09-25、dotctl の言語の問いに「Go (推奨)」）。`plans/2026-09-24-dotfiles-architecture.md` §11 の未決 1 を閉じる

rule: Write dotctl, the dotfiles' own CLI, in Go as one binary with subcommands, built by Nix with buildGoModule from pkgs/dotctl/; shared pieces (logging, errors, config, secrets) live in pkgs/dotctl/internal/. Keep shell only for scripts under 100 lines and for what must change the calling shell's state (cd, environment, prompt hooks); never write dotctl in Rust or as a Bun single binary.

## Problem

theme-switch、mado、nvim-switch、code-graph-cache-gc、家の LLM の確認、zsh 関数のうち状態を変えないものは、shell のまま大きくなり、テストもしにくい。これらを引き取る自作 CLI（dotctl）の言語を決める必要があった。候補は Go と、jig と揃う TypeScript（Bun）。

## Decision

- dotctl は Go。一つのバイナリにサブコマンドを並べる。
- `pkgs/dotctl/` に置き、Nix の `buildGoModule` でビルドする。flake が版を固定する。
- ログ・エラー・設定・秘密情報の読み方は `pkgs/dotctl/internal/` の共通部品にする。
- shell に残すのは 100 行未満の素直なものと、呼び出し元のシェルの状態を変えるもの（`cd`、環境変数、プロンプトのフック、fzf のウィジェット）だけ。

## Alternatives considered

- **TypeScript（Bun）**: jig と言語が揃う。だが単一バイナリは約 60MiB、再現性の不具合（#14676・#24470）がある。却下。
- **Rust**: 個人 dotfiles の CLI で同じ形の実例がほぼ無く（5 件、最大 3★）、ビルドも遅い。却下。
- **shell のまま**: 大きいスクリプトにテストと共通部品を持たせにくい。却下。

## Consequences

- M5（dotctl を作り、theme-switch と大きい shell を移す）に着手できる。テーマの仕組みの入れ替え（include と `~/.config/theme/current` の張り替え）は dotctl の `theme` サブコマンドとして作る。
- `bootstrap.sh` は、dotctl ができたら Nix を入れて dotctl を呼ぶだけにする。
- CI に go test を足す。

## Sources

- `rules/research/2026-09-24-personal-tooling-language.md`（chezmoi が Go、起動 9ms・2.1MiB、ビルド 1.85 秒、Bun 単一バイナリの不具合）
- `plans/2026-09-24-dotfiles-architecture.md` §6
