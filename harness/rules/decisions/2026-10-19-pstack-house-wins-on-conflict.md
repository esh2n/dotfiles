# pstack と家の規則が食い違ったら、いつも家が勝つ

Status: accepted — 持ち主の裁定（2026-10-19）。2026-10-19-pstack-precedence-table.md の優先順位（「表の行だけ家が勝ち、表に無い点は pstack の手順が家に代わる」）と、2026-10-18-pstack-shared-skills.md の決定 6（住み分け）を置き換える。表、引用の見張り、guard への写し、重なる原則の扱いは変えない

rule: In a pstack task, the house rules win wherever they and pstack disagree; pstack adds only what the house lacks — its playbooks, principles and commands. `rules/common/80-pstack.md` lists the known conflicts and `pstack-adapter`'s Overrides says what to do for each; a conflict not listed there is still settled for the house. Each table row quotes pstack's text, recorded with its file in `harness/plugins/pstack/precedence.json` so an upgrade that drops the quote is detected; a machine-checkable row also becomes a guard rule, and a principle both sides share is referenced by name, never rewritten in the house. Reviews go through the `change-review` skill in a pstack task too, with pstack's `interrogate` as its heavy second review.

## Problem

2026-10-19-pstack-precedence-table.md は「表の行だけ家が勝ち、表に無い点は pstack の作業なら pstack の手順が家の規則に代わる」と書いた。持ち主が承認した案は「食い違う点を表にして、家の決定が勝つと書く」で、表に無い点を pstack に譲る一文は案に無かった。承認された 8 点のうち「計画を信じない」の行も、確かめずに外していた。2026-10-18 の決定 6（TDD・レビュー係・grilling・委譲は pstack の手順が代わる）も、持ち主が直接答えた点ではなかった。

持ち主の要件は、`/poteto-mode` などの pstack のコマンドを使っても、いつもの進め方から外れないことである。外れる点があると、使う側が中身を知らないまま違う手順で動き、事故や見知らぬ workflow につながる。pstack と家の設定を突き合わせると、表に無い食い違いが少なくとも 10 点あり、どれも表に無いという理由で pstack 側になっていた（実装の委譲、計画の立て方、設計の根拠、人に聞く条件、バグ修正で止まる点、テストを先に書く範囲、コードの書き方、既定で worktree を切るか、無人の実行、調査の答えの形）。

## Decision

1. **食い違ったら家が勝つ。** pstack の作業でも、家の規則（`rules/common`、採択済みの決定メモ、家の skill）と pstack の文面が食い違えば家に従う。pstack は、家に無い手順書、原則、コマンドを足す役になる。
2. **既知の食い違いは書き出す。** `80-pstack.md` の表に、承認された行と「計画を信じない」の行を置く。表に載せない細かい食い違いは、`pstack-adapter` の Overrides に「pstack の手順のこの段では、家のこれをする」の形で書く。書き出していない食い違いが見つかっても、家が勝つ。
3. **レビューの入口は一つ。** pstack の作業でも `change-review` を使い、`interrogate` はその厚いレビューの 2 つ目として動く。手順書が「interrogate する」「audit lanes を回す」と言う段では `change-review` を回す。
4. **表、引用の見張り、guard、重なる原則は 2026-10-19-pstack-precedence-table.md のまま。** 新しい行の引用も `precedence.json` に記録する。

## Alternatives considered

- **表の行だけ家が勝つ（前の決定のまま）**: 表に無い食い違いが黙って pstack 側になり、持ち主の要件（いつもの進め方から外れない）を満たさない。pstack は本家の最新を追うので、更新で新しい食い違いが入るたびに同じことが起きる。却下。
- **レビューだけ家にする**: 計画、委譲、無人の実行など、レビュー以外の食い違いが残る。却下。
- **pstack を作者の意図どおりに動かすため、委譲などを pstack 側に残す**: 持ち主が過去に決めた規則（実装の委譲の範囲、計画の立て方、調査を先にすること）を、承認なしに覆すことになる。却下。家の規則を変えたいときは、その規則の決定メモを持ち主が置き換える。

## Consequences

- `/poteto-mode` の手順書のうち、家と食い違う段は家の手順に読み替えて動く。作者の意図どおりの動きではなくなる（たとえば Feature の「実装はサブエージェントに必ず渡す」は、家の委譲の規則に従う）。
- pstack の更新で新しい食い違いが入っても、家が勝つ。引用の見張りは、表の行が古くなったことを知らせる。
- 危ない操作のうち guard が止めないもの（コミットしていない変更を捨てる `git checkout .` など、シミュレータやキャッシュの削除、ガードを通らない GitHub の書き込み）は、規則の文面だけでは止まらない。guard の規則は持ち主が書く。

## Sources

- 2026-10-19-pstack-precedence-table.md
- 2026-10-18-pstack-shared-skills.md の決定 6
- 2026-10-19-review-redesign.md（レビューの入口は一つ）
- pstack の README の計画についての一文（`pstack/README.md`）
