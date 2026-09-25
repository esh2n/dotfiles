# 出力を持つ自作コマンドは全部 dotctl にし、シェルは薄い入口だけにする

Status: accepted — 持ち主の裁定（2026-09-25、「一部を Go、一部を sh にしたのは保守しにくくない？標準出力の helper を二か所で管理することにならない？」への提案に「ok」）。`2026-09-25-dotctl-in-go.md` の「100 行未満はシェルに残す」と `plans/2026-09-24-dotfiles-architecture.md` §6 の `pkgs/scripts/lib/` を置き換える

rule: Every personal command that prints to the user, logs or reports errors is a dotctl subcommand, sharing pkgs/dotctl/internal/ — including the setup steps (dotctl setup), the home-LLM setup and check (dotctl llm), gh-switch, wallpaper, install-extensions and setup-neovim-distros — whatever its length. Shell stays only for thin entry points that hand off to another program with no output helpers of their own (codebase-memory-mcp-managed, jig, git-credential-gh-owner) and for zsh functions that must change the calling shell's state; there is no shared shell helper library.

## Problem

`2026-09-25-dotctl-in-go.md` は「100 行を超えるものは Go、100 行未満はシェル（共通関数は `pkgs/scripts/lib/`）」とした。これでは標準出力やログの共通関数を Go とシェルの二か所で持つことになる。実際には、残ったシェルは計画の `pkgs/scripts/lib/` ではなく旧配置の `core/utils/common.sh` を読み、next の `dev-setup`（215 行）と `home-llm-setup`（183 行）はそれぞれ自前の `warn` を持っていた。

## Decision

- 出力・ログ・エラー報告を持つ自作コマンドは、長さに関係なく dotctl のサブコマンドにする。共通部品は `pkgs/dotctl/internal/` の一か所。
  - `dev-setup` → `dotctl setup <step>`
  - `home-llm-setup` と `litellm/check.sh` → `dotctl llm`、`dotctl llm check`
  - `gh-switch`、`wallpaper`、`install-extensions`、`setup-neovim-distros`、`gh-pr-graph-update`
- シェルに残すのは、別のプログラムに処理を渡すだけの薄い入口（`codebase-memory-mcp-managed`、`jig`、`git-credential-gh-owner`）と、呼び出し元のシェルの状態を変える zsh 関数だけ。どちらも共通関数を持たない。シェルの共通関数ライブラリは作らない。
- `artifact` はハーネスの skill の一部なので、M6 でハーネスと一緒に動かす。
- 旧名は、dotctl が今と同じく古いコマンド名でも呼べるようにする。

## Alternatives considered

- **100 行で分ける（`2026-09-25-dotctl-in-go.md` のまま）**: 共通関数が二か所になり、表示やエラーの形が揃わない。却下。
- **全部シェルに戻し、共通関数を `pkgs/scripts/lib/` に一つ**: テストと型の支えが無いまま大きいスクリプトが残る。dotctl を Go にした理由と逆。却下。

## Consequences

- `core/utils/*.sh` を読むコマンドが無くなり、`core/` を消せる。
- dotctl の配布物に setup と llm が加わる。activation の各手順は `dotctl setup <step>` を呼ぶ。
- `2026-09-25-dotctl-in-go.md` の Status に、この部分の置き換えを書き足す。

## Sources

- `2026-09-25-dotctl-in-go.md`
- `plans/2026-09-24-dotfiles-architecture.md` §6
