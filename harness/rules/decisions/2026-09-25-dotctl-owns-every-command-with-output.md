# 出力を持つ自作コマンドは全部dotctlにし、シェルは薄い入口だけにする

Status: accepted — 持ち主の裁定（2026-09-25）。出力の共通処理をGoとシェルの二か所で持たないための提案を採った。`2026-09-25-dotctl-in-go.md`の「100行未満はシェルに残す」と、dotfilesの設計計画にあった`pkgs/scripts/lib/`を置き換える

rule: Every personal command that prints to the user, logs or reports errors is a dotctl subcommand, sharing pkgs/dotctl/internal/ — including the setup steps (dotctl setup), the home-LLM setup and check (dotctl llm), gh-switch, wallpaper, install-extensions and setup-neovim-distros — whatever its length. Shell stays only for thin entry points that hand off to another program with no output helpers of their own (codebase-memory-mcp-managed, jig, git-credential-gh-owner) and for zsh functions that must change the calling shell's state; there is no shared shell helper library.
scope: repo

## Problem

`2026-09-25-dotctl-in-go.md`は「100行を超えるものはGo、100行未満はシェル（共通関数は`pkgs/scripts/lib/`）」とした。これでは標準出力やログの共通関数をGoとシェルの二か所で持つことになる。実際には、残ったシェルは計画の`pkgs/scripts/lib/`ではなく旧配置の`core/utils/common.sh`を読み、nextの`dev-setup`（215行）と`home-llm-setup`（183行）はそれぞれ自前の`warn`を持っていた。

## Decision

- 出力・ログ・エラー報告を持つ自作コマンドは、長さに関係なくdotctlのサブコマンドにする。共通部品は`pkgs/dotctl/internal/`の一か所。
  - `dev-setup` → `dotctl setup <step>`
  - `home-llm-setup`と`litellm/check.sh` → `dotctl llm`、`dotctl llm check`
  - `gh-switch`、`wallpaper`、`install-extensions`、`setup-neovim-distros`、`gh-pr-graph-update`
- シェルに残すのは、別のプログラムに処理を渡すだけの薄い入口（`codebase-memory-mcp-managed`、`jig`、`git-credential-gh-owner`）と、呼び出し元のシェルの状態を変えるzsh関数だけ。どちらも共通関数を持たない。シェルの共通関数ライブラリは作らない。
- `artifact`はハーネスのskillの一部なので、M6でハーネスと一緒に動かす。
- 旧名は、dotctlが今と同じく古いコマンド名でも呼べるようにする。

## Alternatives considered

- **100行で分ける（`2026-09-25-dotctl-in-go.md`のまま）**: 共通関数が二か所になり、表示やエラーの形が揃わない。却下。
- **全部シェルに戻し、共通関数を`pkgs/scripts/lib/`に一つ**: テストと型の支えが無いまま大きいスクリプトが残る。dotctlをGoにした理由と逆。却下。

## Consequences

- `core/utils/*.sh`を読むコマンドが無くなり、`core/`を消せる。
- dotctlの配布物にsetupとllmが加わる。activationの各手順は`dotctl setup <step>`を呼ぶ。
- `2026-09-25-dotctl-in-go.md`のStatusに、この部分の置き換えを書き足す。

## Sources

- `2026-09-25-dotctl-in-go.md`
