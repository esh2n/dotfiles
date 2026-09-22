# 決定はリポジトリ内の Markdown に記録し、AGENTS.md の一行で縛り、検査できるものは検査に変換する

Status: accepted — 記録はリポジトリ内の Markdown、拘束は AGENTS.md の一行と機械の検査に分ける（2026-09-22）

## Problem

grill で決まったことが、セッションの記憶ファイル(Claude Code 専用、機械ローカル、エージェントの行動を縛らない)にしか残らない。次のセッションや別のハーネスで同じ議論が蒸し返される。「恒久ルールにする方法が確立されているべき」。

## Decision

- 決定メモは `domains/dev/llm/harness/rules/decisions/YYYY-MM-DD-topic.md`。`Status` と `## Problem / ## Decision / ## Alternatives considered / ## Consequences` を必須とする。索引は作らない。
- 行動を縛る決定は、生成される AGENTS.md に太字一行とメモへのリンクとして入れる。
- 機械で検査できる決定は同じコミットで `guard-rules.json` か lint に変換し、検査の文言からメモへリンクする。
- 採択後は決定を書き換えず、新しいメモで上書きする。事実(パス・名前)は最新に保つ。
- HTML(writeup、Artifact)は人間向けの投影。元ではない。

## Alternatives considered

- **HTML の決定記録を別の store に置く(writeup)**: エージェントが読む前例が一つもない。log4brains や Backstage もリポジトリの Markdown が元で HTML は投影。却下。
- **Claude Code の auto memory / `.claude/rules/`**: Claude 専用で機械ローカル。Codex・pi・DSH は読まない。補助にとどめる。
- **同期ツール(ruler、rulesync)で各ハーネスに配る**: 四ハーネス全部が AGENTS.md を読むので、symlink と生成で足り、追加の価値がない。
- **issue tracker を記憶にする(Beads)**: 自動で読まれず、批判が多い。却下。
- **散文のルールだけで縛る**: Anthropic 自身が「context であって強制ではない」と三度書き、保守者は「決定的に効かせるなら hook」。ETH の測定では指示は守られるが成功率は上がらずコストは 20% 増、指示が増えるほど遵守は落ちる。散文は記録用、縛るのは検査。

## Consequences

- 全ハーネスに効くのは AGENTS.md の連鎖だけなので、AGENTS.md の分量は Codex の上限 32KiB(超過分は静かに切り捨て)を意識する。
- 決定のたびにメモとルールと検査の三点を同じコミットに入れる手間が増える。その代わり蒸し返しが減る。
- 前例は DSH の Agent Notes(約 1,100 件、形式は CI で検査、規約だけでは守られなかった記録あり)。

## Sources

- 調査全文: `rules/research/2026-09-22-decision-records-for-agents.md`
- Anthropic memory 文書: https://code.claude.com/docs/en/memory
- 保守者の回答: https://github.com/anthropics/claude-code/issues/5055
- Codex の 32KiB: https://github.com/openai/codex/issues/7138
- DSH Agent Notes: https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/README.md
- ETH の測定: https://arxiv.org/abs/2602.11988
