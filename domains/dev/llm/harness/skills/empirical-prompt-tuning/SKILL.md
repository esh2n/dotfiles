---
name: empirical-prompt-tuning
description: A method for iterating on agent-facing text instructions (a skill / slash command / task prompt / CLAUDE.md section / code-generation prompt) by having an unbiased executor run them and evaluating from both sides (executor self-report + instruction-side metrics). Loop until improvement plateaus. Use right after creating or heavily revising a prompt or skill, or when you suspect ambiguity on the instruction side is why an agent misbehaves. Requires an environment where the Task tool can spawn subagents.
metadata:
  namespaces: [agent]
---

# Empirical Prompt Tuning

The author cannot judge a prompt's quality. The clearer the writer thinks it is, the more another agent gets stuck reading it. The core of this skill: **have an unbiased executor actually run it, evaluate from both sides, and iterate.** Do not stop until improvement plateaus.

## When to use

- Right after creating or heavily revising a skill / slash command / task prompt
- When an agent misbehaves and you want to trace the cause to ambiguity on the instruction side
- When hardening a high-importance instruction (a frequently used skill, a core automation prompt)

Do not use for:
- A one-off throwaway prompt (evaluation cost is not worth it)
- When the goal is not a higher success rate but merely reflecting the author's subjective taste

## Workflow

0. **Iteration 0 — description/body consistency check** (static, no dispatch)
   - Read the triggers / purpose the frontmatter `description` claims
   - Read the scope the body covers
   - On a mismatch, align the description or the body before moving to iter 1
   - Example: the description says "navigation / form filling / data extraction" but the body is only a CLI reference for `npx playwright test`
   - Skipping this lets the subagent "reinterpret" the body to fit the description, so accuracy looks fine while the skill does not actually meet its requirements (false positive)

1. **Prepare the baseline**: fix the target prompt and prepare the following two.
   - **Evaluation scenarios**, 2–3 (1 median + 1–2 edge). Realistic tasks in which the target prompt would actually be applied.
   - **Requirement checklist** (for computing accuracy). Per scenario, list 3–7 "requirements the deliverable must meet". Accuracy % = items met / all items. Fix it in advance (never move it afterwards).
2. **Unbiased reading**: have a "blank-slate" executor read the instruction. **Dispatch a new subagent** with the Task tool. Do not substitute self-rereading (objectively viewing text you just wrote is structurally impossible). To run several scenarios in parallel, place multiple Agent calls in a single message. For environments where dispatch is impossible, see "Environment constraints".
3. **Execute**: pass the subagent a prompt that follows the **subagent launch contract** below and have it run the scenario. The executor produces the implementation or output and returns a self-report at the end.
4. **Two-sided evaluation**: record the following from the returned result.
   - **Executor self-report** (extracted from the subagent's report body): unclear points / discretionary fill-ins / where a template application got stuck
   - **Instruction-side measurement** (the judgment rules are defined once here; other sections refer to this one):
     - Success/failure: success (○) only when **every** requirement tagged `[critical]` is ○. If even one is × or partial, failure (×). Labels are binary ○ / ×.
     - Accuracy (achievement rate of the requirement checklist, %. ○ = full, × = 0, partial = 0.5, summed and divided by the item count)
     - Step count (use `tool_uses` from the usage metadata attached to the Task tool's return value, as-is. Include Read / Grep, do not exclude them)
     - Duration (`duration_ms` from the Task tool's usage metadata)
     - Retry count (how many times the subagent redid the same decision. Extracted from the subagent's self-report; not measurable from the instruction side)
     - **On failure, add one line "which [critical] item fell" to the "Unclear points" section of the presentation format** (for cause tracing)
   - The requirement checklist must contain **at least one** `[critical]`-tagged item (with 0, the success judgment is vacuous). Do not add or remove [critical] after the fact.
5. **Apply a diff**: put the minimal fix that removes the unclear points into the prompt. One theme per iteration (several related fixes are OK; unrelated fixes go to the next round).
   - **Before fixing, state "which requirement checklist item / judgment wording this fix satisfies"** (fixes guessed from an axis name often miss; see "Fix propagation patterns" below).
6. **Re-evaluate**: run 2 → 5 again with a new subagent (never reuse the same agent: it has learned the previous improvement). Increase parallelism when improvement fails to plateau as iterations proceed.
7. **Convergence**: stop at the guideline "2 consecutive iterations with zero new unclear points and metric improvement below the thresholds (below)". For high-importance prompts, make it 3 consecutive.

## Evaluation axes

| Axis | How measured | Meaning |
|---|---|---|
| Success/failure | Did the executor produce the intended deliverable (binary) | The floor |
| Accuracy | What % of requirements the deliverable met | Degree of partial success |
| Step count | Tool calls / decision steps the executor used | Indicator of instruction waste |
| Duration | The executor's duration_ms | Proxy for cognitive load |
| Retry count | How many times the same decision was redone | Signal of instruction ambiguity |
| Unclear points (self-report) | Listed by the executor as bullets | Qualitative material for improvement |
| Discretionary fill-ins (self-report) | Decisions the instruction left open | Surfaces implicit specs |

**Weighting**: qualitative (unclear points, discretionary fill-ins) is primary; quantitative (time, step count) is auxiliary. Chasing time alone makes the prompt too thin.

### Qualitative reading of `tool_uses`

Accuracy alone hides skill problems. Using `tool_uses` as a **relative value across scenarios** exposes structural defects:

- When one scenario is **3–5x or more** of the others, the skill leans toward a **decision-tree index with low self-containment**. The executor is being forced into a references descent
- Typical case: every scenario has `tool_uses` 1–3 but one has 15+ → there is no recipe for that scenario inside the skill, and it is traversing references/
- Fix: in iter 2, add a "minimal complete example inline" or "guidance on when to read references" at the top of SKILL.md; `tool_uses` drops sharply

Even at 100% accuracy, skewed `tool_uses` justifies triggering iter 2. "Stopping on accuracy alone" tends to miss structural defects.

### Fix propagation patterns (conservative / overshoot / zero)

Fix → effect is not linear. An advance estimate can land in any of three patterns:

- **Conservative** (estimate > measured): one fix aimed at several axes but moved only one. "Multi-axis aims tend to miss"
- **Overshoot** (estimate < measured): one piece of structural information (e.g. command + config + expected output together) satisfied the judgment wording of several axes at once. "Combined information structurally hits many axes"
- **Zero** (estimate > 0, measured = 0): a fix guessed from the axis name reached none of the judgment wordings. "Axis name and judgment wording are different things"

To stabilize this, **before applying the diff, have the subagent articulate "which judgment wording this fix satisfies"**. Without tying it at the threshold-wording level, estimates stay inaccurate. When adding an evaluation axis, also concretize each point's criterion down to threshold wording (granular enough that the subagent can decide what earns 2 points, e.g. "everything stated explicitly", "the full text of a minimal working setup").

## Subagent launch contract

The prompt handed to the executor takes this structure. This is the input contract of the "two-sided evaluation".

```
You are a blank-slate executor reading <target prompt name>.

## Target prompt
<Paste the full text if the target prompt is under ~3000 tokens. Otherwise instruct "Read <path> before starting" (the subagent shares the file system)>

## Scenario
<one paragraph setting up the scenario>

## Requirement checklist (items the deliverable must meet)
1. [critical] <item that belongs to the floor>
2. <regular item>
3. <regular item>
...
(Judgment rules are defined once in "Workflow 4. Two-sided evaluation / Instruction-side measurement". At least one [critical] is required.)

## Task
1. Follow the target prompt to run the scenario and produce the deliverable.
2. On completion, reply in the report structure below.

## Report structure
- Deliverable: <output or summary of the execution result>
- Requirements met: ○ / × / partial for each item (with reasons)
- Unclear points: where you got stuck in the target prompt, wording you hesitated over (bullets)
- Discretionary fill-ins: decisions the instruction left open that you filled by your own judgment (bullets)
- Retries: how many times you redid the same decision, and why
```

The caller extracts the self-report parts from the report, takes `tool_uses` / `duration_ms` from the Agent tool's usage metadata, and fills the evaluation-axis table.

## Environment constraints

In an environment that cannot dispatch a new subagent (already running as a subagent, Task tool disabled, etc.), **do not apply** this skill.
- Alternative 1: ask the parent session's user to start another Claude Code session and request it there
- Alternative 2: give up the evaluation and report explicitly to the user: "empirical evaluation skipped: dispatch unavailable"
- **Not allowed**: substituting self-rereading (bias enters; the evaluation result must not be trusted)

**Structural review mode**: when you want to check only the **consistency and clarity of the text** of a skill / prompt rather than an empirical evaluation, separate it explicitly as structural review mode. State in the subagent's request prompt: "This is structural review mode: a text consistency check, not execution". The subagent then does not hit the skip behavior of the environment-constraints section and can return a static review. Structural review supplements empirical evaluation; it does not replace it (it cannot count toward the consecutive-clear judgment).

## Stopping criteria for iteration

- **Converged (stop)**: **all** of the following hold 2 times in a row:
  - New unclear points: 0
  - Accuracy improvement vs previous: +3 points or less (saturation like 5% → 8%)
  - Step count change vs previous: within ±10%
  - Duration change vs previous: within ±15%
  - **Overfitting check**: at convergence, add 1 hold-out scenario not used so far and evaluate. If accuracy drops 15 points or more from the recent average, it is overfitted. Go back to baseline scenario design and add edges.
- **Diverging (question the design)**: new unclear points do not decrease after 3 or more iterations → the prompt's design approach itself may be wrong. Stop patching; rewrite the structure
- **Resource cutoff**: stop when importance and improvement cost no longer balance (the "ship at 80 points" call)

## Presentation format

Record and present to the user in this form each iteration:

```
## Iteration N

### Changes (diff from previous)
- <fix, 1 line>

### Results (per scenario)
| Scenario | Success/failure | Accuracy | steps | duration | retries |
|---|---|---|---|---|---|
| A | ○ | 90% | 4 | 20s | 0 |
| B | × | 60% | 9 | 41s | 2 |

### Unclear points (new this round)
- <Scenario B>: [critical] item N is × — <why it fell, 1 line>   # always add on failure
- <Scenario B>: <other finding, 1 line>
- <Scenario A>: (none new)

### Discretionary fill-ins (new this round)
- <Scenario B>: <what was filled in>

### Next fix
- <minimal fix, 1 line>

(Convergence: X consecutive clears / Y more until the stop condition)
```

## Red flags (watch for rationalizations)

| Rationalization | Reality |
|---|---|
| "Rereading it myself has the same effect" | You cannot "objectively view" text you just wrote. Always dispatch a new subagent. |
| "One scenario is enough" | One scenario overfits. Minimum 2, preferably 3. |
| "Zero unclear points came up once, so we're done" | It can be chance. Confirm with 2 in a row. |
| "Let's kill several unclear points at once" | You lose track of what worked. One theme per iteration. |
| "Let's split related micro-fixes into strictly one per iter" | The opposite trap. "One theme" is a unit of meaning. 2–3 related micro-fixes may share one iter. Over-splitting explodes the iteration count. |
| "Metrics are good, so ignore qualitative feedback" | Faster time can also signal over-thinning. Qualitative first. |
| "Rewriting is faster" | Correct when unclear points have not decreased for 3+ rounds. Before that, it is an escape. |
| "Let's reuse the same subagent" | It has learned the previous improvement. Dispatch fresh every time. |

## Common mistakes

- **Scenarios too easy / too hard**: neither produces a signal. One median real-use scenario plus one edge
- **Looking only at metrics**: chasing only time cuts important explanations and makes the prompt brittle
- **Too many changes per iteration**: you can no longer trace "which of those fixes worked". One fix per iteration
- **Tuning the scenario to the fix**: making the scenario easier so unclear points appear resolved → defeats the purpose

## Guide to pass thresholds (pass@k)

Guidelines for deciding when to stop improving based on multiple trials:

| Metric | Meaning | Recommended threshold |
|------|------|---------|
| pass@1 | First-try success rate (raw reliability) | For trend observation |
| pass@3 | Succeeds at least once within 3 tries (practical reliability incl. retries) | New features / capability work ≥ 0.90 |
| pass^3 | All 3 tries succeed in a row (stability) | Regression / release-critical work = 1.00 |

Note: overfitting the prompt to known scenarios, measuring only the happy path, and chasing pass rate while ignoring worse cost/latency are all invalid passes.

## Related

- `writing-skills` — the TDD approach to writing skills. Essentially the same as this skill's "subagent baseline → fix → re-run"
- `retrospective-codify` — pinning learnings after a task. This skill is for prompt development; retrospective-codify is for after the task ends
- Run multiple scenarios in parallel by launching Agents concurrently (several Task calls in one message)
