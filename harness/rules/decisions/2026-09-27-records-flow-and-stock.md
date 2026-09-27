# 記録はフローとストックに分ける。フローは 14 日で昇格するか消える

Status: accepted — 持ち主の裁定（2026-09-27）。

rule: Research records (`harness/rules/research/`) and plans (`plans/`) are flow: each lives 14 days from the date in its name (else its first commit), then its lasting facts are promoted into stock — `harness/rules/knowledge/` for reference facts, a decision note for a ruling — and the flow document is deleted with `dotctl records prune --yes`. Write a research record only when it feeds a decision or answers a question that will come back; answer a one-off lookup in the conversation. Promotion keeps the conclusion, its source URLs and its caveats, never the investigation's narrative. make up lists what is past its 14 days; the `records-triage` skill does the promoting.

## Problem

調査記録は 7 日で 101 本、約 2 万 8 千行に増え、目次（`research/INDEX.md`）だけで 107 行になった。エージェントは調べる前に目次を読むので、増えるほど毎回読む量が増える。記録には結論のほかに、途中経過・古くなった事実・同じ問いの重複が混ざり、どれを信じてよいかが目次からは分からない。計画（`plans/`）も作業が終わった後に残る。文書には、その時点の作業のための「フロー」と、長く参照して手入れを続ける「ストック」があるのに、ここでは全部がストックのように溜まっていた。

## Decision

- **フロー**: `harness/rules/research/` と `plans/`。名前の日付（無ければ git に最初に入った日）から 14 日が期限。
- **ストック**: `harness/rules/decisions/`（決まったこと）と、新しく作る `harness/rules/knowledge/`（決定ではないが長く使う事実。調べ直しを防ぐ役目は目次からここへ移る）。
- 調査記録を書くのは、決定の根拠になるときか、同じ問いがまた来るときだけ。一度きりの調べものは会話で答えて終える。
- 期限までに、フローは次のどちらかにする:
  - **昇格**: 結論・根拠の URL・注意点だけを knowledge か決定記録に書き直す。調査の経緯は持ち込まない。書き直しは `2026-09-27-records-describe-work-not-owner.md` に従う。
  - **削除**: 役目を終えたもの、決定につながらなかったもの。
- 仕組み:
  - `make up` の setup `records-ttl` が期限切れを警告で知らせる（止めない）。
  - `dotctl records check` で一覧、`dotctl records prune --yes` で削除し、目次の該当行も消す。ストックには触れない。
  - 昇格の判断は、持ち主が呼んだときだけ動くスキル `records-triage` が行う。

## Alternatives considered

- **調査記録を git から外し、手元にだけ置く**: 他の機械のエージェントに届かず、同じ問いを調べ直すことになる。書く量を絞り、期限で整理しても増えるなら、その時に検討する。
- **期限切れで自動削除する**: 昇格すべき事実が判断なしに消える。削除は `--yes` を付けたときだけにした。
- **期限切れで CI を失敗させる**: 関係のない作業まで止まる。まず `make up` での知らせにした。

## Consequences

- 既存の調査記録は、この決定に合わせて `records-triage` で仕分け、昇格しないものは消す。
- AGENTS.md の「調べる前に読む」案内に `knowledge/INDEX.md` を加える（jig の生成）。
