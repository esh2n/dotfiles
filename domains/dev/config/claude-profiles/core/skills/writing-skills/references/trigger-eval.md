# Trigger evaluation

Tests whether a skill's frontmatter `description` alone — the only part
of a skill loaded into every conversation as a search key — correctly
decides fire/skip on a set of example inputs. This is a narrower,
faster check than the RED/GREEN pressure-scenario testing in
`SKILL.md`: it only tests discovery (does the description get the
skill picked when it should, and not when it shouldn't), not whether
the skill's body then produces correct behavior.

`scripts/trigger-eval.mjs` is zero-dependency Node. It never calls an
LLM itself — it only prepares a judging prompt and scores a judge's
answers. You (or a subagent) supply the judgment.

## Case file format

`<skill-dir>/evals/trigger-cases.json`:

```json
{
  "cases": [
    { "input": "決定記録を残して", "expect": true, "note": "durable doc, positive" },
    { "input": "この設計、見せて", "expect": false, "note": "belongs to show-me, not writeup" }
  ]
}
```

`expect: true` means the skill should fire; `false` means it should
skip. Include hard negatives — inputs that resemble a neighbouring
skill's trigger phrasing — not just obviously unrelated inputs, since
those are the cases descriptions actually fail on.

## Commands

```bash
# 1. Prepare a judging prompt from the skill's description + cases
node trigger-eval.mjs prepare <skill-dir> [--out prompt.md]

# 2. Get judgments (see "Running the judge" below), save as answers.json:
#    {"answers": [true, false, ...]}   — same order as cases

# 3. Score
node trigger-eval.mjs score <skill-dir> answers.json
```

`score` prints TP/FP/FN/TN, precision, recall, accuracy, and lists
every miss with its case's `note`, as JSON on stdout (human summary on
stderr). It exits 1 if accuracy is below 0.9, so it can gate a loop or
a CI-less check without extra parsing.

## Running the judge

`prepare` reads only the frontmatter `description` — never the skill
body — because that mirrors what actually decides discovery in a real
conversation. The judge must be a fresh context with no memory of the
skill's implementation, or it will "know" the right answer instead of
inferring it from the description text.

From the main session, launch a plain sonnet subagent (not a fork —
a fork inherits your context, which defeats the point) and hand it the
prepared prompt plus one line: "answer with the JSON only." Save its
reply to a file and run `score` against it.

Do this once per skill you are testing, and once per round of edits —
a single description edit can flip several cases, so re-run the full
case set rather than just the cases you were trying to fix.

## The loop

1. Write cases: roughly half positive, half hard negatives against
   neighbouring skills that could plausibly claim the same input.
2. Split into train (visible while iterating) and holdout (only run
   at the end) if you have enough cases to spare — otherwise iterate
   on the full set honestly and don't retrofit the description to a
   single run's misses.
3. `prepare` → judge → `score`. Read every miss's `note` — it tells
   you whether the description under- or over-specifies.
4. Edit the description (never the cases, to fit a bad answer).
5. Repeat until 100% on train cases and ≥90% on holdout.
6. Stop editing once you hit that bar. A description tuned past this
   point to the exact wording of your cases will overfit and drift
   from real conversation phrasing.

## What a miss tells you

- **FN (should fire, judge said skip)**: the description is missing a
  trigger phrase or symptom the case exercises. Add it — literally, in
  the words a user would use, not a paraphrase.
- **FP (should skip, judge said fire)**: the description is too broad
  and overlaps a neighbour's territory. Add an explicit "Not for X —
  use Y" exclusion, or narrow the trigger condition.

Never delete or reword a case to make a miss go away — that erases the
signal. Fix the description, or if the case itself was actually
wrong (mislabeled expectation), say so explicitly when reporting
results rather than silently editing it.
