"""Shared sample texts: (a) a reply readers found hard, (b) metaphors, (c) a good technical paragraph."""

SAMPLE_A = """家・エージェント／レビュアー／考え方の型ごとに 6 本。言語ごとのレビュアーは置かない。

一般原則：principle-* を参照する。家では書き直さない。

知識はコードを書くモデルも読むので、書くときとレビューのときで同じ基準が使われます。
"""

SAMPLE_B = "この変更は静かに壊れる箇所を潰していく。地味に効くが、放っておくと時間を溶かす。重心を移すのが大事だ。\n"

SAMPLE_C = (
    "`NOT IN` の右辺に NULL が一つでも含まれると、その条件はどの行に対しても真にならない。"
    "SQL は条件の評価に三値論理（真・偽・不明の三つの値で条件を評価する方式）を使い、"
    "NULL との比較 `x <> NULL` は真でも偽でもなく「不明」になる。"
    "`x NOT IN (1, 2, NULL)` は `x <> 1 AND x <> 2 AND x <> NULL` と同じ意味なので、"
    "最後の項が不明である以上、全体も真にはならず、`WHERE` 句はその行を返さない。"
    "これを避けるには、`NOT EXISTS` を使うか、サブクエリに `WHERE customer_id IS NOT NULL` を足す。"
    "`NOT EXISTS` は相関サブクエリ（外側の行ごとに評価し直されるサブクエリ）が一行でも返すかどうかだけを見るので、"
    "NULL の影響を受けない。\n"
)
