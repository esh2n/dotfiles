# 調査記録

このディレクトリは harness / jig の設計判断を支える調査記録を置く。決定そのものではない — 決定は `../decisions/` にあり、そこだけが「何を決め、何を捨て、なぜか」を持つ。ここにあるのは調査の生データと結論で、フローとして扱う。名前の日付から 14 日のうちに、長く使う事実は `../knowledge/` へ、決定の根拠は決定記録へ移し（スキル `records-triage`）、残りは `dotctl records prune --yes` で消す（`../decisions/2026-09-27-records-flow-and-stock.md`）。AGENTS.md からは、`rules/knowledge/INDEX.md` と `rules/research/INDEX.md` の二つを調べる前に読めと指される。

## 記録とは何か

`agents/research.md`（four lenses: vendors / practitioners / measured evidence / in the wild）に従って行った一回の調査の出力。一つのファイルが一つの問いに答える。URL と原文の引用は本文の中にある — INDEX からは番号 ID ではなくパスで参照する。

## Frontmatter contract

各記録は次の YAML frontmatter を先頭に持ち、本文はそれ以外バイト単位で変更しない。

```yaml
---
question: "一文の問い(記録自身の題名・問いの行から取る)"
date: YYYY-MM-DD
verdict: "一行の結論(記録自身の結論/結論一行から。捏造しない)"
unverified:
  - "検証できなかった項目1"
  - "検証できなかった項目2"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---
```

- `date` は記録内に明記された調査日があればそれを優先し、無ければファイルの mtime 日付を使う。
- `verdict` は記録自身の「結論」「Verdict」節から取るか、それに準じて圧縮する。新しい主張を作らない。
- `unverified` は記録自身の「未検証」「検証できなかったこと」「no precedent found」節から一行ずつ圧縮する。該当節が無ければ空リスト(`unverified: []`)。

## 索引が入口

`INDEX.md` が一行一記録の索引で、200 行を超えたらトピック別の `INDEX-<topic>.md` に分割し `INDEX.md` は索引の索引になる。調査の前に必ずここを読み、同じ問いをもう一度調べない。記録が古い、または結論が疑わしいときは `date` と `unverified` を見て、そこだけ差分調査する。

## 記録 ≠ 決定

ここは調査の記録であって、決定ではない。将来の設計や行動を縛る決定、却下した代替案、コードや文書から読み取れない判断は `../decisions/` に書く。調査記録は決定の `## Sources` からパスで参照される側であり、それ自体が「何を決めたか」を宣言することはない。
