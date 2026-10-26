# 決定はリポジトリ内のMarkdownに記録し、AGENTS.mdの一行で縛り、検査できるものは検査に変換する

Status: accepted — 記録はリポジトリ内のMarkdown、拘束はAGENTS.mdの一行と機械の検査に分ける（2026-09-22）

rule: Write binding decisions as harness/rules/decisions/YYYY-MM-DD-topic.md with Status, Problem, Decision, Alternatives considered and Consequences; convert machine-checkable decisions into guard-rules.json or lint in the same commit. Never edit an accepted Decision section — supersede it with a new note instead.
scope: repo

## Problem

grillで決まったことが、セッションの記憶ファイル(Claude Code専用、機械ローカル、エージェントの行動を縛らない)にしか残らない。次のセッションや別のハーネスで同じ議論が蒸し返される。決まったことを恒久ルールにする方法が要る。

## Decision

- 決定メモは`harness/rules/decisions/YYYY-MM-DD-topic.md`。`Status`と`## Problem / ## Decision / ## Alternatives considered / ## Consequences`を必須とする。索引は作らない。
- 行動を縛る決定は、生成されるAGENTS.mdに太字一行とメモへのリンクとして入れる。
- 機械で検査できる決定は同じコミットで`guard-rules.json`かlintに変換し、検査の文言からメモへリンクする。
- 採択後は決定を書き換えず、新しいメモで上書きする。事実(パス・名前)は最新に保つ。
- HTML(writeup、Artifact)は人間向けの投影。元ではない。

## Alternatives considered

- **HTMLの決定記録を別のstoreに置く(writeup)**: エージェントが読む前例が一つもない。log4brainsやBackstageもリポジトリのMarkdownが元でHTMLは投影。却下。
- **Claude Codeのauto memory / `.claude/rules/`**: Claude専用で機械ローカル。Codex・pi・DSHは読まない。補助にとどめる。
- **同期ツール(ruler、rulesync)で各ハーネスに配る**: 四ハーネス全部がAGENTS.mdを読むので、symlinkと生成で足り、追加の価値がない。
- **issue trackerを記憶にする(Beads)**: 自動で読まれず、批判が多い。却下。
- **散文のルールだけで縛る**: Anthropic自身が「contextであって強制ではない」と三度書き、保守者は「決定的に効かせるならhook」。ETHの測定では指示は守られるが成功率は上がらずコストは20% 増、指示が増えるほど遵守は落ちる。散文は記録用、縛るのは検査。

## Consequences

- 全ハーネスに効くのはAGENTS.mdの連鎖だけなので、AGENTS.mdの分量はCodexの上限32KiB(超過分は静かに切り捨て)を意識する。
- 決定のたびにメモとルールと検査の三点を同じコミットに入れる手間が増える。その代わり蒸し返しが減る。
- 前例はDSHのAgent Notes(約1,100件、形式はCIで検査、規約だけでは守られなかった記録あり)。

## Sources

- Anthropic memory文書: https://code.claude.com/docs/en/memory
- 保守者の回答: https://github.com/anthropics/claude-code/issues/5055
- Codexの32KiB: https://github.com/openai/codex/issues/7138
- DSH Agent Notes: https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/README.md
- ETHの測定: https://arxiv.org/abs/2602.11988
- HTMLは投影・Markdownが元という同型の前例: log4brains https://github.com/thomvaill/log4brains 、BackstageのADRプラグイン https://github.com/backstage/community-plugins/blob/main/workspaces/adr/plugins/adr/README.md
- 同期ツール（symlinkと生成で足りるとして退けた対象）: ruler https://github.com/intellectronica/ruler 、rulesync https://github.com/dyoshikawa/rulesync
- issue trackerを記憶にする案（Beads）: https://github.com/gastownhall/beads
