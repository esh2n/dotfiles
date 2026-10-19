# Evaluation plan

Goal: find out whether this skill makes Japanese text easier for the owner to read than the alternatives, judged by the owner, blind. Model judges are recorded beside the owner's verdict but never replace it: the published evaluations of writing skills use the same model as writer and judge with the skill's own rules as criteria, so they measure rule-following, not readability.

## Items

18 items under `evals/items/`, one Markdown file each. The front matter holds the reader, the writing task, `traps` (in-house words the writer is likely to leak) and `must_keep` (technical terms that must survive). The body is a numbered fact list: the only facts the output may contain.

| Category | Count | Items |
|---|---|---|
| Japanese technical documents (`ja-doc`) | 6 | 01 review redesign, 02 pstack precedence, 03 model assignment, 04 swarm, 05 records flow and stock, 06 hooks |
| Japanese chat replies (`ja-chat`) | 6 | 07 LiteLLM effort, 08 re-asking the yomiyasu question, 09 work report, 10 OpenCode, 11 executor fallback, 12 worktree layout |
| Japanese research memos (`ja-memo`) | 3 | 13 writing-skill comparison, 14 plain-language guidelines, 15 UI review capture |
| English (`en`) | 3 | 16 PR description, 17 design note, 18 chat reply |

The facts come from this repository's decision notes and research of 2026-10-19. When a decision changes, update the item's facts, not the outputs.

## Conditions

Each item is written once per condition, by the same model at the same effort, from the same prompt: the item's `task`, `reader` and fact list, and nothing else.

| Condition | Japanese items | English items |
|---|---|---|
| no skill | yes | yes |
| natural-japanese (upstream v1.6.0 procedure) | yes | no |
| yomiyasu, run on the no-skill output | yes | no |
| plain-japanese (this skill, which runs natural-japanese too) | yes | yes |
| pstack `unslop` + `technical-writing` | no | yes |

## Blind A/B by the owner

1. For each item, pair plain-japanese with each other condition. Shuffle the pair order and strip any marks that reveal the condition (file names, check logs).
2. Show the owner the fact list and the two outputs side by side. The owner picks A, B or tie on each of the seven criteria, then overall.
3. Re-show a random half of the pairs a week later, in a new order, to measure how often the owner gives the same verdict (self-agreement). Report it next to the results.
4. Run one model judge on the same pairs with the same criteria and report its agreement with the owner. Do not use its verdicts in the result.

Criteria (in the owner's language):

1. 用語が使う場所で説明されているか（専門用語は残っているか）
2. たとえ話・比喩・擬人化が無いか
3. 内輪の呼び名が無いか、あれば初出で説明されているか
4. 冒頭に前提や用語集の山が無く、結論が先にあるか
5. 不足も冗長も無いか（事実の一覧のすべてが入り、同じことを二度言っていないか）
6. 図があるとき、流れや構造をまとめるのに役立っているか（題・凡例・線のラベルがあるか）
7. 易しくしすぎず、自然な日本語か（英語の項目では自然な英語か）

## Machine measures

Recorded for every output, reported beside the owner's verdicts:

- `check_terms.py`: replace and avoid hits; keep+gloss terms without a gloss; the item's `traps` that appear.
- `check_metaphor.py` and `check_compression.py` counts.
- `diff_content.py` between the fact list and the output: words, numbers and qualifiers that the facts do not contain (added facts), and facts whose numbers are missing (dropped facts).
- Sentence length distribution (mean, standard deviation) and bold count. A known trap: removing vocabulary habits can increase rhythm habits (blader/humanizer issue 229), so watch the distribution, not only the hit counts.

## Decision rule

Adopt plain-japanese as the default for Japanese writing if it wins or ties overall on at least 12 of the 15 Japanese items against each Japanese condition, with no loss on criterion 5 (no missing or added facts) attributable to the skill. If the owner's self-agreement is below 70%, report the result as inconclusive and re-run with clearer criteria first.

## Running it

- Outputs go under `evals/runs/<date>/` (not committed unless the owner asks), named by an opaque id; the id-to-condition map is kept in a separate file the owner does not open until the verdicts are in.
- Delete runs that are not kept. Keep the fact lists and this plan as the stable part.
