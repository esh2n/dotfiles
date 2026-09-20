/**
 * Skill router use-case, multi-pick: ask the decision provider which skills this request
 * needs, up to a small number.
 *
 * Why this exists as jig's one skill question, and not beside a single-answer one: this
 * replaced a question that could only name one skill, which returned `none` (0.78, under the
 * gate) to a review request naming three axes. That question had been measured thin — 18
 * requests, 7/7 with the description's vocabulary, 5/5 paraphrased, 6/6 `none`s, confidence
 * 0.93-1.00 on picks — and those numbers travel with it into git history rather than into a
 * second live question nothing asks.
 *
 * The shape is a batch of yes/no questions rather than a repeated choice: the provider
 * evaluates a batch against one material with the questions judged independently, so the
 * per-candidate cost is a short question instead of the whole candidate list again. All
 * the candidates are asked about — there is no shortlist, because building one would mean
 * deciding relevance with a mechanism that is not the judgment being measured.
 *
 * An over-eager batch is the failure mode: a judgment that answers `true` with confidence
 * 1 to many candidates would make the cap pick by catalog order rather than by fit, which
 * is why `passed` (how many cleared the gate before the cap) is returned and recorded. If
 * `passed` is routinely far above the cap, this question is the wrong one and the number
 * says so.
 *
 * The cap is 3: the axes a request is reviewed on in practice are 2-4, and injecting more
 * than a few sets of instructions dilutes all of them.
 *
 * Measured (2026-09-20) against the live judgment model over the 54 skills this machine
 * lists, six requests, one run each:
 *
 * - A review request naming three axes (DDD, layering, Go performance) is the case this
 *   question exists for: the batch picked code-review-discipline (0.94) and
 *   golang-patterns (0.81), while the single-pick question answered `none` at 0.78 —
 *   under the 0.8 gate, so it injected nothing at all and the request was reviewed on
 *   whatever the model would have done anyway.
 * - A bug-fix request: code-review-discipline (0.90) + systematic-debugging (0.87); the
 *   single question picked systematic-debugging (0.85) alone.
 * - Single-axis requests were not over-picked: a screenshot request got only ui-capture
 *   (0.96) and a write-this-up request only writeup (0.96), the same picks the single
 *   question made.
 * - Two requests matching nothing got no picks (the single question said `none` at 0.89
 *   and 0.99).
 *
 * The batch is not over-eager at this scale: it answered `true` to 3-5 of 54 candidates,
 * with the intended ones at 0.82-0.94 and the rest at 0.51-0.61 — the 0.8 gate is what
 * separates them, and `passed` never came close to the cap. Latency was 230-560ms per
 * judgment against 220-350ms for the single question.
 *
 * Not yet measured: whether the model then reads what it was told to read, and whether the
 * extra picks crowd each other out. Answering that needs the report to tell "read one of
 * the two" from "read both" — a class it does not have yet, because until now a turn could
 * only be given one skill.
 */

import type { DecisionContext, DecisionProvider } from "../../domain/decision/provider";
import type { SkillCandidate } from "../../domain/skills/candidate";
import { boundedMaterial } from "../decision/material";

/** One skill the judgment picked, with the confidence it was picked at. */
export interface SkillPick {
  readonly candidate: SkillCandidate;
  readonly confidence: number;
}

export interface SelectSkillsResult {
  readonly picks: readonly SkillPick[];
  /** How many candidates cleared the gate, before the cap — a saturating batch shows up here. */
  readonly passed: number;
  /**
   * The strongest confidence among the candidates the judgment said yes to, whether or not
   * it cleared the gate. `undefined` when it said yes to none of them.
   */
  readonly confidence: number | undefined;
  /**
   * `decided` = the judgment answered (including "nothing applies"); `fallback` = it said
   * yes to something but not confidently enough to act on.
   */
  readonly source: "decided" | "fallback";
}

export interface SelectSkillsOptions {
  /** Below this, a `true` is not acted on. */
  readonly threshold?: number;
  /** How many picks the caller wants at most. */
  readonly max?: number;
}

/** The question asked about ONE candidate. The candidate's own description is its context. */
export function skillQuestion(candidate: SkillCandidate): string {
  return `この依頼は「${candidate.name}」スキルの手順を必要とするか。（${candidate.name}: ${candidate.description}）`;
}

/**
 * Ask about every candidate and keep the ones that cleared the gate, strongest first.
 *
 * Ordering matters when more candidates pass than the cap allows: the strongest
 * confidences are kept, and equal confidences keep the catalog's order, so the result is
 * reproducible for a given answer rather than depending on how a map iterated.
 */
export async function selectSkills(
  request: string,
  candidates: readonly SkillCandidate[],
  provider: DecisionProvider,
  context: DecisionContext = {},
  options: SelectSkillsOptions = {},
): Promise<SelectSkillsResult> {
  const threshold = options.threshold ?? 0.8;
  const max = options.max ?? 3;
  if (candidates.length === 0) {
    // Nothing was asked, so there is no answer to call an answer: `fallback` is the honest
    // label for "did not act", and it keeps "decided" meaning a judgment was consulted.
    return { picks: [], passed: 0, confidence: undefined, source: "fallback" };
  }

  const decided = await provider.boolBatch(
    {
      material: `依頼: ${boundedMaterial(request)}`,
      prompts: candidates.map(skillQuestion),
    },
    context,
  );

  const yes: SkillPick[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const judgment = decided[index];
    if (candidate === undefined || judgment === undefined) continue;
    if (judgment.value !== true) continue;
    yes.push({ candidate, confidence: judgment.confidence });
  }
  yes.sort((left, right) => right.confidence - left.confidence);

  const passed = yes.filter((pick) => pick.confidence >= threshold);
  const picks = passed.slice(0, max);

  // "Nothing applies" is an answer, not a failure to answer: a batch that said yes to no
  // candidate decided. Only "yes, but weakly" is a fallback — the distinction is what lets
  // a report tell a router that declined from one that could not decide.
  return {
    picks,
    passed: passed.length,
    confidence: yes[0]?.confidence,
    source: picks.length > 0 || yes.length === 0 ? "decided" : "fallback",
  };
}
