# 決定メモ

このディレクトリは、jig とハーネス設定に関する決定の記録です。「何を決め、何を捨て、なぜか」を残します。コードや既存の文書で説明できることは書きません。

## 形式

ファイル名は `YYYY-MM-DD-topic.md`。日付は最初に決めた日。索引ファイルは作りません(このディレクトリの一覧が索引です)。

各メモは次の見出しを持ちます。

```
# <題名>

Status: accepted | implemented | rejected | superseded by <file> — <一言>

## Problem
## Decision
## Alternatives considered
## Consequences
## Sources
```

`## Alternatives considered` は必須です。却下した案を書かない決定は、後で蒸し返されます。

## 運用

- 行動を縛る決定は、生成される AGENTS.md に太字一行と、このメモへのリンクとして入ります。全ハーネスが起動時に読むのは AGENTS.md の連鎖だけです。
- 機械で検査できる決定(禁止コマンド、禁止パス、禁止依存)は、同じコミットで `../../policy/guard-rules.json` か lint に変換し、その検査の文言からこのメモへリンクします。散文だけのルールは守られたり守られなかったりします。
- 採択後は「決定」を書き換えません。覆すときは新しいメモを書き、古いメモの Status を `superseded by` にします。「事実」(パス、名前)は最新に保ちます。
- HTML のページ(writeup、Artifact)は人間向けの投影であって、元ではありません。エージェントは読みません。

この形式自体の根拠は `2026-09-22-decision-records.md` にあります。
