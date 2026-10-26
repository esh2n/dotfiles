# dotctlはGoで書く

Status: accepted — 持ち主の裁定（2026-09-25）。dotfilesの設計計画の未決1（dotctlの言語）を閉じる。どれをシェルに残すかはsuperseded by `2026-09-25-dotctl-owns-every-command-with-output.md`（rule行からもシェルの部分を外し、そちらのrule行だけが効くようにした）

rule: Write dotctl, the dotfiles' own CLI, in Go as one binary with subcommands, built by Nix with buildGoModule from pkgs/dotctl/; shared pieces (logging, errors, config, secrets) live in pkgs/dotctl/internal/. Never write dotctl in Rust or as a Bun single binary.
scope: repo

## Problem

theme-switch、mado、nvim-switch、code-graph-cache-gc、家のLLMの確認、zsh関数のうち状態を変えないものは、shellのまま大きくなり、テストもしにくい。これらを引き取る自作CLI（dotctl）の言語を決める必要があった。候補はGoと、jigと揃うTypeScript（Bun）。

## Decision

- dotctlはGo。一つのバイナリにサブコマンドを並べる。
- `pkgs/dotctl/`に置き、Nixの`buildGoModule`でビルドする。flakeが版を固定する。
- ログ・エラー・設定・秘密情報の読み方は`pkgs/dotctl/internal/`の共通部品にする。
- shellに残すのは100行未満の素直なものと、呼び出し元のシェルの状態を変えるもの（`cd`、環境変数、プロンプトのフック、fzfのウィジェット）だけ。

## Alternatives considered

- **TypeScript（Bun）**: jigと言語が揃う。だが単一バイナリは約60MiB、再現性の不具合（#14676・#24470）がある。却下。
- **Rust**: 個人dotfilesのCLIで同じ形の実例がほぼ無く（5件、最大3★）、ビルドも遅い。却下。
- **shellのまま**: 大きいスクリプトにテストと共通部品を持たせにくい。却下。

## Consequences

- M5（dotctlを作り、theme-switchと大きいshellを移す）に着手できる。テーマの仕組みの入れ替え（includeと`~/.config/theme/current`の張り替え）はdotctlの`theme`サブコマンドとして作る。
- `bootstrap.sh`は、dotctlができたらNixを入れてdotctlを呼ぶだけにする。
- CIにgo testを足す。

## Sources

- 起動時間・ビルド時間の実測比較（cli-lang-bench、chezmoiがGo製の事実上の標準）: https://github.com/ngs/cli-lang-bench
- Bun単一バイナリの不具合（`bun build --compile`が外部ファイルに依存／実行環境依存のバイナリを生成）: https://github.com/oven-sh/bun/issues/14676 、https://github.com/oven-sh/bun/issues/24470
- `rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md`
