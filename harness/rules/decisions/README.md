# 決定メモ

このディレクトリは、jig とハーネス設定に関する決定の記録です。「何を決め、何を捨て、なぜか」を残します。

全部の決定を書くのではありません。次の三つを全部満たすときだけ書きます。

- 将来の設計や行動を縛る
- 却下した案があり、書かなければまた提案される
- コード、テスト、既存の文書からは読み取れない

書かないもの: 実装の細部、ガードのルール一本一本(`guard-rules.json` 自体が記録)、一回きりの作業の結果(その場のコメントやコミットに書く)、手順。

## 形式

ファイル名は `YYYY-MM-DD-topic.md`。日付は最初に決めた日。索引ファイルは作りません(このディレクトリの一覧が索引です)。

各メモは次の見出しを持ちます。

```
# <題名>

Status: accepted | rejected | superseded by <file> — <一言>

rule: <人が書く英語の一行。生成器がそのまま AGENTS.md に写す>
scope: repo   ← この dotfiles の作り方だけを決めるメモのときだけ書く

## Problem
## Decision
## Alternatives considered
## Consequences
## Sources
```

`## Alternatives considered` は必須です。却下した案を書かない決定は、後で蒸し返されます。

AGENTS.md に描かれるのは `Status: accepted` で `rule:` 行を持つメモだけです(`harness/jig/src/domain/claude/agents-md.ts`)。実装が済んでも Status は `accepted` のままにします。`implemented` など別の語に変えると、その決定は黙って AGENTS.md から消えます。

## 運用

- 行動を縛る決定は、`rule:` 行が生成される AGENTS.md に `- <rule> (<ファイル名>)` の一行として入ります(太字にしない。メモの置き場所は節の頭で一度だけ書く)。`scope: repo` のメモは、この dotfiles のチェックアウトの追跡されない AGENTS.md にだけ入ります(`2026-10-18-decision-scope.md`)。全ハーネスが起動時に読むのは AGENTS.md の連鎖だけです。
- 機械で検査できる決定(禁止コマンド、禁止パス、禁止依存)は、同じコミットで `../../policy/guard-rules.json` か lint に変換し、その検査の文言からこのメモへリンクします。散文だけのルールは守られたり守られなかったりします。
- 採択後は「決定」を書き換えません。覆すときは新しいメモを書き、古いメモの Status を `superseded by` にします。「事実」(パス、名前)は最新に保ちます。
- HTML のページ(writeup、Artifact)は人間向けの投影であって、元ではありません。エージェントは読みません。

この形式自体の根拠は `2026-09-22-decision-records.md` にあります。
