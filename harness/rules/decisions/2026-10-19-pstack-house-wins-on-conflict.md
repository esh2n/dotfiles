# pstack と家の規則は両方に従い、本当に逆を言うときだけ家が勝つ

Status: accepted — 持ち主の裁定（2026-10-19、同日に「片方に寄せず両方に従う」形へ書き直した）。2026-10-19-pstack-precedence-table.md の優先順位（「表の行だけ家が勝ち、表に無い点は pstack の手順が家に代わる」）と、2026-10-18-pstack-shared-skills.md の決定 6（住み分け）を置き換える。表、引用の見張り、guard への写し、重なる原則の扱いは変えない

rule: In a pstack task, follow both pstack and the house rules wherever both can hold — pstack's playbooks, principles and commands add to the house's own steps, and two rules that check the same thing from different angles are both done. Only where they truly contradict (one requires what the other forbids) does the house win. `rules/common/80-pstack.md` lists the contradictions and `pstack-adapter`'s Overrides says how each combined step runs. Each table row quotes pstack's text, recorded with its file in `harness/plugins/pstack/precedence.json` so an upgrade that drops the quote is detected; a machine-checkable row also becomes a guard rule, and a principle both sides share is referenced by name, never rewritten in the house. Both review entries stay usable: `change-review` for every review, with `interrogate` as its heavy second review, and `/interrogate` on its own for a contested design.

## Problem

2026-10-19-pstack-precedence-table.md は「表の行だけ家が勝ち、表に無い点は pstack の作業なら pstack の手順が家の規則に代わる」と書いた。持ち主が承認した案は「食い違う点を表にして、家の決定が勝つと書く」で、表に無い点を pstack に譲る一文は案に無かった。承認された 8 点のうち「計画を信じない」の行も、確かめずに外していた。2026-10-18 の決定 6（TDD・レビュー係・grilling・委譲は pstack の手順が代わる）も、持ち主が直接答えた点ではなかった。

持ち主の要件は、`/poteto-mode` などの pstack のコマンドを使っても、いつもの進め方から外れないことである。外れる点があると、使う側が中身を知らないまま違う手順で動き、事故や見知らぬ workflow につながる。pstack と家の設定を突き合わせると、表に無い食い違いが少なくとも 10 点あり、どれも表に無いという理由で pstack 側になっていた（実装の委譲、計画の立て方、設計の根拠、人に聞く条件、バグ修正で止まる点、テストを先に書く範囲、コードの書き方、既定で worktree を切るか、無人の実行、調査の答えの形）。

## Decision

1. **両方に従う。** pstack の作業でも、pstack と家の規則（`rules/common`、採択済みの決定メモ、家の skill）が両立するなら両方に従う。同じことを別の角度から言う二つ（試作で確かめることと、先に調べて根拠を付けること）は両方行う。違う場面の話（行き詰まるまで追うことと、3 回失敗したら相談すること）は、それぞれの場面で効く。
2. **本当に逆を言うときだけ家が勝つ。** 片方が求めることを片方が禁じる点だけ、家に従う。PR を draft にするか、他人が見る書き込みの前に聞くか、マージ、force push、落ちるテストを含むコミット、同時に動かすワーカーの数などである。`80-pstack.md` の表にその点を置く。
3. **組み合わせ方を書く。** 両方に従うときの手順（たとえば、親が設計を決めて範囲と確かめ方を名指しし、その実装をサブエージェントに渡し、親が差分を見る）は `pstack-adapter` の Overrides に書く。
4. **レビューは両方使える。** すべてのレビューは `change-review` を入口にし、`interrogate` はその厚いレビューの 2 つ目として動く。設計で意見が割れたときは `/interrogate` を単独でも使う。
5. **表、引用の見張り、guard、重なる原則は 2026-10-19-pstack-precedence-table.md のまま。**

## Alternatives considered

- **食い違ったらいつも家が勝つ（この記録の最初の版）**: 両立する二つまで片方に寄せ、pstack を入れた意味をなくす。却下。
- **表の行だけ家が勝つ（前の決定のまま）**: 表に無い食い違いが黙って pstack 側になり、持ち主の要件（いつもの進め方から外れない）を満たさない。pstack は本家の最新を追うので、更新で新しい食い違いが入るたびに同じことが起きる。却下。
- **pstack を作者の意図どおりに動かすため、委譲などを pstack 側に残す**: 持ち主が過去に決めた規則（実装の委譲の範囲、計画の立て方、調査を先にすること）を、承認なしに覆すことになる。却下。家の規則を変えたいときは、その規則の決定メモを持ち主が置き換える。

## Consequences

- `/poteto-mode` の手順書は、ほとんどの段がそのまま動く。家と両立する段は両方の確かめを足して動き、逆を言う少数の段だけ家の手順になる。
- pstack の更新で新しい食い違いが入っても、家が勝つ。引用の見張りは、表の行が古くなったことを知らせる。
- 危ない操作のうち guard が止めないもの（コミットしていない変更を捨てる `git checkout .` など、シミュレータやキャッシュの削除、ガードを通らない GitHub の書き込み）は、規則の文面だけでは止まらない。guard の規則は持ち主が書く。

## Sources

- 2026-10-19-pstack-precedence-table.md
- 2026-10-18-pstack-shared-skills.md の決定 6
- 2026-10-19-review-redesign.md（レビューの入口は一つ）
- pstack の README の計画についての一文（`pstack/README.md`）
