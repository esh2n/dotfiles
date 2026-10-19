---
name: plain-japanese
description: "Rules and checks for plain, precise Japanese, layered on natural-japanese. Use whenever you write or revise Japanese — documents, research memos, decision notes, PR text, and chat replies — and when a reader complains about internal jargon, metaphors or compressed text: 「内輪の言葉」「家って何」「比喩をやめて」「たとえ話はいらない」「省略しすぎ」「記号で書かないで」「前の話を見てない人にも分かるように」「用語を説明して」. Keeps technical terms and explains each at first use, removes in-house coined names, analogies and symbol-speak, and checks a rewrite for added content."
license: MIT
metadata:
  namespaces: [doc]
---

# plain-japanese

Write Japanese that a reader understands on the first read without having seen the earlier conversation. This skill adds rules and four checks on top of `natural-japanese`; it does not replace it. Instructions are in English; examples and data are Japanese. Detailed rules with before/after examples: `references/rules.md`.

```bash
PJ="$HOME/.claude/skills/plain-japanese"
[ -d "$PJ/scripts" ] || PJ="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/skills/plain-japanese"
NJ="$(dirname "$PJ")/natural-japanese"
```

## Rules

| When | Do |
|---|---|
| A technical term appears for the first time | Keep the term. Explain what it does in the same or the next sentence, e.g. 三値論理（真・偽・不明の三つで条件を評価する方式）. Never a glossary block or a prerequisites section at the top. |
| A paraphrase would change the meaning | Keep the term and split the sentence instead of swapping words. Never dumb down. |
| You reach for an analogy, metaphor or personification to explain | Write the mechanism literally: who does what to what. No 「〜のようなもの」「例えると」「いわば」「コードが語る」. |
| You use a name only this repository or conversation uses (家, 床, レーン, 拘束決定, 考え方の型) or an ordinary word with an in-house meaning | Use the real name (file, command, tool) or what it refers to. If a new name is unavoidable, say what it means at first use. `terms.tsv` lists known ones. |
| A sentence has no predicate, or uses ／ → ＝, or opens with 「ラベル：」 | Write a whole sentence with subject and verb. 「6 本。」→「レビュアーは全部で 6 体にする。」 |
| A pronoun or omitted subject could point at two things | Name the subject. When revising, do not guess it: ask. |
| Writing any document or reply | Conclusion first, then reasons, then details. Nothing the reader needs is missing, nothing is said twice. |
| A flow, structure or dependency takes three sentences to describe | Draw a figure and pair it with one concrete example that runs through it; move between the two in prose. Never label sections 「抽象」「具体」. |
| Drawing a figure | Pick the type with writeup-kit's rules (`references/writing.md` §3-4 of `writeup-kit`). Every figure has a title, a legend, and a label on every edge; explain abbreviations inside the figure. |
| Re-asking a question in chat, or replying after several turns | Restate the background, the options and your recommendation so the reply stands alone. |
| Rewriting someone else's text | Add no facts, rankings, numbers or certainty that the source lacks. Run the diff check. |

## Procedure

1. Write under the rules above.
2. Run natural-japanese's procedure on the draft: its lint (`uv run "$NJ/scripts/lint.py" FILE`) and, when revising, its paragraph-by-paragraph write-out (「段落ごとの確かめ」). Follow its top rule (add nothing that is not in the original).
3. Run this skill's checks. Chat replies too: write the draft to stdin.
   ```bash
   uv run "$PJ/scripts/check.py" FILE          # terms + metaphor + compression
   printf '%s\n' "$DRAFT" | uv run "$PJ/scripts/check.py"
   ```
4. Fix each finding or keep it with a reason. The checks list suspects; you decide. A metaphor that is not in the vocabulary is not found, so read each paragraph for one.
5. When the task was a rewrite, compare the result with the source and resolve every added or removed item:
   ```bash
   uv run "$PJ/scripts/diff_content.py" ORIGINAL REWRITE
   ```

For a short chat reply, steps 1 and 3 are the minimum. Skip step 2's lint only when `uv` is unavailable, and say so.

## Scripts

All are Python stdlib only, take a file or stdin (`-`), print findings, and exit 0 (3 with `--strict` when something is listed, 1 on an input error, 2 on a usage error). `--json` gives machine-readable output.

| Script | Lists |
|---|---|
| `check_terms.py` | `replace` and `avoid` terms from `terms.tsv`; `keep+gloss` terms whose first use has no explanation nearby |
| `check_metaphor.py` | metaphor verbs, figure words, personification, engineer slang, explanation analogies (`data/metaphors.tsv`) |
| `check_compression.py` | verbless fragments in prose, ／ → ＝ in prose and lists, label-colon openings, mid-sentence colons |
| `diff_content.py ORIG NEW` | content words, numbers, negations, certainty/ranking/scope words and adverbial phrases (一つずつ) added or removed |
| `check.py` | the first three together |

## Terms table

`terms.tsv` columns: `term`, `refers_to`, `class`, `use_instead`, `gloss`, `source`, optional `pattern` (a regular expression for terms that are also ordinary words). `class` follows the four treatments of 文化庁「公用文作成の考え方」: `keep` (standard; never paraphrase), `keep+gloss` (keep and explain at first use), `replace` (write `use_instead`), `avoid` (do not use; name the thing).

- Project rows: `.plain-japanese/terms.tsv` at the project root (found from the current directory upward), then `PLAIN_JAPANESE_TERMS`, then `--terms PATH`. A later row replaces an earlier row of the same term; class `off` disables a default row. `.plain-japanese/metaphors.tsv` adds metaphor patterns the same way.
- When you notice a new in-house word leaking into replies, propose a row for this table in your reply. Do not edit `terms.tsv` unasked.

## Relation to other skills

- `natural-japanese` owns naturalness, AI-like phrasing and its lint; this skill never restates its rules. If the two disagree on a point, this skill's rules on terms, analogies and compression win for technical text.
- `writeup-kit` owns page structure and figure types; it also explains terms inline and warns on a terms block (writing.md §5).
- English text: the same rules apply (pstack `unslop` 26, 27, 32, 33 and `technical-writing` cover them); the scripts are for Japanese.

Evaluation plan and fixtures: `references/evaluation-plan.md`, `evals/`.
