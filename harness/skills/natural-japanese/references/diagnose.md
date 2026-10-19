# Diagnosis mode (score): return the AI smell as a score and reasons, without rewriting

Diagnosis mode never rewrites the document; it returns only three things: the score, its grounds, and what to fix first if fixing. It answers requests such as 「この文章、AIっぽい？」「どれくらいAI臭いか採点して」. If a rewrite is asked for, switch to the normal process (SKILL.md §1–7).

## Three depths

quick / full / exp in diagnosis specify how deep to look. Since there is no rewriting step, their content differs from SKILL.md's execution modes. Where they conflict, follow this section.

- quick (default): one run of `lint.py --json` (with `--genre` if the genre is known) and a glance at the headings and the first sentence of each paragraph. No subagents. About 30 seconds
- full: in addition to quick, run `outline.py` and `terms.py`, and factor in the results of the structure check, the readability check and the doctype check (SKILL.md §5). Subagents may be used only when splitting the reading of a long document makes it faster. Diagnosis does not check convergence; finish with a single evaluation. A few minutes
- exp: in addition to full, run `semantic.py --json` (an experimental detector; it downloads a model of about 1GB on first run, so on the first run tell the user before starting). It looks as far as the flatness of topic that remains even after the wording is tidied

## Computing the score: a machine base and a judgment adjustment, in two layers

The score is a naturalness value from 0 to 100; higher is more natural (less AI smell). When returning it to the user, state the direction in a word too. Build it in two layers and always disclose the breakdown.

Machine base (deterministic): from 100, deduct lint findings normalized by document length.

```
減点 = (critical×8 + warn×4 + info×0.5) × (1000 / max(文書の文字数, 1000))
機械ベース = max(100 − 減点, 20)
```

文書の文字数 (document length) is the character count of the whole body; a plain len including line breaks and Markdown notation is fine (it is a rough normalization, so precision is not needed). The shorter the document, the more one finding weighs; long documents are penalized by density rather than count. The coefficients are a rough setting so that one critical finding equals 2 warn or 16 info findings. The floor of 20 keeps the score from dropping near 0 on machine findings alone. If exp produces semantic_topic_flatness (warn), include it in the same formula. If the body is empty or effectively empty (under 100 characters), do not produce a score; return 「診断対象として短すぎる」.

Judgment adjustment (within ±15 points): in full / exp, adjust with the problems found in the structure and readability checks. Deduct for structural habits lint cannot detect (every section built the same way, bullet lists without grounds or relations, degrees of certainty not differentiated, a report that does not say what to do next, ranking items that are inherently parallel), and restore the deduction for findings where lint looks like a false positive and you judged the text natural in context. quick makes no adjustment and uses the machine base as is (and says explicitly that "quick's precision is coarse"). Clamp the final adjusted score to 0–100 (min(max(score, 0), 100); a machine base of 100 plus a positive adjustment does not exceed 100).

The score is a rough guide that includes judgment, and the same document can swing by a few points. It is not a number for a CI gate. Add this caveat to the result in a word.

## Bands and how to phrase them

| Score | Band | Example phrasing |
|---|---|---|
| 90–100 | Natural (自然) | Almost no AI smell. Any findings are a matter of taste |
| 70–89 | Minor (軽微) | A few habits remain, but readers are unlikely to feel it is "AI-like" |
| 50–69 | Needs fixing (要修正) | Clear AI smell in either the surface or the structure. Worth fixing |
| 0–49 | Heavy (濃厚) | Strongly detected in several categories. Rewrite recommended |

## Output format

1. Score and band (with the breakdown of machine base and judgment adjustment)
2. 3–5 main reasons: write them by content, not by category name — like 「『〜ではなく』の対比が全文の4%で機械的なリズムになっている（L12ほか）」, with the line numbers of representative spots and a word on why it reads as AI smell
3. What to fix first, if fixing: 2–3 items, in order of impact. But do not fix in diagnosis mode. End by adding 「リライトしますか（quick/full）」

Do not transcribe lint's detail as the reasons; restate them in terms of the document's context. Even when there are many findings, do not list them all; narrow down to those that moved the score most.
