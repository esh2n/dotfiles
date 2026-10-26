# Claude CodeのMCPサーバーはjigが ~/.claude.jsonのmcpServersに直接書く

Status: accepted — 持ち主の裁定（2026-09-25）。jigのソースにあった「jigは`~/.claude.json`を読みも書きもせず、claude CLIも呼ばない（呼んでよいかは未決）」という制約を置き換える。この制約は持ち主の決定ではなく、実装側が置いたものだった

rule: jig delivers Claude Code's user-scope MCP servers by writing the `mcpServers` key of `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when set) directly, changing that key only and carrying every other key through as read; it records the server names it wrote and removes only those, never a server it did not write, and a same-named server it did not write stops the write as a conflict. Do not deliver MCP servers by printing `claude mcp add` lines, running them through a shell, or keeping a Claude-only registration step outside jig.
scope: repo

## Problem

Claude Codeはユーザー単位のMCPサーバーを`~/.claude.json`の`mcpServers`から読み、`~/.claude/settings.json`からは読まない。jigはこれまで`claude mcp add`の行を表示するだけにしており、その行をdotctl（以前はdev-setup）が読み取って`bash -c`で実行していた。表示用の文字列を解釈し直してシェルに渡す作りで、Claudeだけハーネスごとの変換がjigの外にあった。

## Decision

- jig（`jig apply --target claude --write`）が`~/.claude.json`の`mcpServers`を直接書く（`domain/claude/claude-json.ts`）。ほかのキーは読んだまま残し、一時ファイルに書いてから置き換える。
- jigが書いたサーバーの名前をmanifestに残し、`mcp/servers.json`から消えたものだけを消す。jigが書いていないサーバーは残して報告する。同じ名前でjigが書いていないものがあれば、書かずに衝突として止める。
- dotctlの`setup claude-mcp`は消す。

## Alternatives considered

- **`claude mcp add`の行を表示し、別の手順がシェルで実行する（従来）**: 表示用の文字列をシェルに渡す作りで、Claudeだけ変換がjigの外に出る。却下。
- **jigが`claude mcp add-json`を引数の形で呼ぶ**: シェルは通らないが、サーバーの数だけCLIを起動し、消す・変えるもCLIの組み合わせになる。ファイルを書けば済むことを遠回りする。却下。
- **プロジェクトごとの`.mcp.json`**: ユーザー単位（全プロジェクト）にならない。却下。

## Consequences

- Claude Codeを動かしたまま`make up`しても、書き換わるのは`mcpServers`だけ。Claude Code自身の書き込みと重なる可能性は残るが、次の`make up`で揃う。
- `jig apply --target claude`の表示は、`mcpServers`に足す・変える・消す・触らないサーバーの一覧になる。

## Sources

- `harness/jig/src/domain/claude/claude-json.ts`
- 置き換えた実装: `domain/mcp/claude-mcp-add.ts`、`pkgs/dotctl/internal/setup/steps.go`の`claudeMCP`
