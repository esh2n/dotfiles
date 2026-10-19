# 日本語の文章は常時の決まりで書き、plain-japanese は頼まれたときだけ使う

Status: accepted — 持ち主の裁定（2026-10-19）。2026-10-19-plain-japanese-writing.md のうち「日本語の文書と返答は plain-japanese を natural-japanese の上に載せて書く」部分を置き換える。用語は残して初出で説明する、比喩と内輪の呼び名を使わない、などの書き方の決まり、`terms.tsv`、検査をフックから回さないことは引き継ぐ

rule: Write Japanese documents and chat replies under the always-on writing rules (`rules/common/90-writing.md`): keep technical terms and explain each at its first use in the same or the next sentence, never in a glossary or prerequisites block; no analogies, metaphors or personification; no names coined in the conversation or repository and no ordinary words with an in-house meaning (`terms.tsv`, plus a project's `.plain-japanese/terms.tsv`); no verbless fragments or symbol-speak; conclusion first; when asking again, restate the background, options and recommendation. Use the `plain-japanese` skill (and `natural-japanese`) only when the owner asks for it or complains about a text, not as the default procedure. A rewrite adds no facts, rankings, numbers or certainty. The checks list suspects for the writer to judge and are never run from a hook.

## Problem

2026-10-19-plain-japanese-writing.md は、日本語の文書と返答を plain-japanese の手順（natural-japanese の上に載せる）で書くと決め、効き目を持ち主の盲検の A/B で確かめるとした。2026-10-19 に 15 組を持ち主が判定した（日本語の 15 題から 1 題 1 組、比べる相手は skill なし・natural-japanese・yomiyasu を 5 組ずつ）。

| 比べた相手 | plain-japanese の勝ち | 同じくらい | 負け |
|---|---|---|---|
| natural-japanese | 4 | 0 | 1 |
| skill なし | 0 | 1 | 4 |
| yomiyasu | 0 | 1 | 4 |

採用の基準（15 組のうち 12 組以上で勝つか同じくらい）に対して 6 組で、届かなかった。持ち主のメモでは、plain-japanese の文章に出た「答える」「配る」が AI くさいと指摘された。モデルの判定は 51 組のうち 47 組で plain-japanese を選び、持ち主との一致は 15 組のうち 5 組だった。規則を守っているかを見ていて、読みやすさを見ていない。

## Decision

1. **常時の決まりで書く。** `rules/common/90-writing.md` の決まりは、どの文章にも効く。「skill なし」の書き手もこの決まりを読んでいて、持ち主の判定で健闘した。
2. **plain-japanese は頼まれたときだけ使う。** 既定の手順にしない。持ち主が「もっと平易に」「内輪の言葉をやめて」などと頼んだとき、または文章に不満を言ったときに使う。natural-japanese も同じ。
3. **持ち主が AI くさいと指摘した言葉を `terms.tsv` に足す。** 「答える」（サーバーやモデルが応答を返す意味）、「配る」（設定を書き出す意味）、「道具」（ツールの意味）。`check_terms.py` が拾う。
4. **1 週間後にもう一度判定する。** 評価の手順どおり、15 組のうち半分を順番を変えて持ち主がもう一度判定し、同じ判定になる割合を見る。割合が 70% を下回れば、この結論は保留にして観点を見直す。

## Alternatives considered

- **plain-japanese を既定のまま残し、言い換えだけ足す**: 判定で skill なしと yomiyasu に負けた手順を、既定として使い続けることになる。却下。
- **yomiyasu を既定にする**: 5 組のうち 4 組で plain-japanese に勝ったが、組の数が少なく、yomiyasu は skill なしの出力を直す手順で、単独の比較をしていない。持ち主の 1 週間後の判定を待たずに決めない。
- **評価をやり直してから決める**: 15 組は少ないが、差は一方向に大きい（skill なし・yomiyasu との 10 組で勝ちが 0）。既定から外すのは戻せる変更なので、先に外し、1 週間後の判定で確かめる。

## Consequences

- 日本語の返答は、常時の決まりと `terms.tsv` の検査で書く。plain-japanese の検査スクリプト（`scripts/check.py` など）は、頼まれたときと書き直すときに使える。
- 「skill なし」も常時の決まりを読んでいたので、今回わかったのは「常時の決まりに plain-japanese の手順を足しても良くならなかった」ことである。常時の決まりそのものの効き目は測っていない。
- 判定したのは一人、15 組で、自己一致の確認はまだ。1 週間後の判定で結論が揺らげば、この記録を見直す。

## Sources

- 評価の手順: `harness/skills/plain-japanese/references/evaluation-plan.md`
- 判定の集計（2026-10-19、持ち主 15 組、モデル 51 組）: `harness/skills/plain-japanese/evals/runs/2026-10-19/`（リポジトリに入れない）
- 2026-10-19-plain-japanese-writing.md
