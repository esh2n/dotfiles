import {
  type DecisionContext,
  type DecisionProvider,
  type Gated,
  gate,
} from "../../domain/decision/provider";
import { boundedMaterial } from "../decision/material";

/**
 * A skill the router may pick, as the list the harness shows would describe it.
 * `path` is carried because the caller hands the model a place to read rather than
 * the body itself: injecting the body would put back most of the list tokens the
 * router exists to remove.
 */
export interface SkillCandidate {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

/** The label the judgment answers when the request matches no skill. */
export const NO_SKILL = "none";

export interface SelectSkillOptions {
  readonly threshold?: number;
}

/**
 * Skill router use-case: ask the decision provider which skill (if any) fits this
 * request, gated by confidence.
 *
 * Measured against the live model over the 53 skills this machine lists — 18 requests,
 * one run each. 7/7 on requests phrased with the description's own vocabulary, where
 * Claude's own selection over the same list answered 6/7; 5/5 on paraphrases that avoid
 * that vocabulary; `none` on 6/6 requests matching no skill. Confidence was 0.93-1.00 on
 * the picks and 0.57-0.99 on the `none`s, so the default threshold of 0.8 accepts every
 * measured pick and rejects a `none` that was already uncertain. Feeding the judgment
 * the body's first 200 characters as well changed nothing at this scale (7/7 either
 * way), so descriptions alone are enough here — unlike the 80k-skill registry where
 * hiding the body is reported to cost 37-44 points of routing accuracy.
 *
 * The question's wording is the wording that was measured, verbatim. A judgment this
 * small is sensitive to phrasing, so changing it means re-running the measurement.
 *
 * `undefined` is the fallback, not a "closest" pick: injecting nothing leaves the
 * request exactly as it would have been with no router at all, which is the only safe
 * direction when the judgment is about instructions the model is then told to follow.
 */
export async function selectSkill(
  request: string,
  candidates: readonly SkillCandidate[],
  provider: DecisionProvider,
  context: DecisionContext = {},
  options: SelectSkillOptions = {},
): Promise<Gated<SkillCandidate | undefined>> {
  const threshold = options.threshold ?? 0.8;
  if (candidates.length === 0) return { value: undefined, confidence: 0, source: "fallback" };

  const decided = await provider.choice<string>(
    {
      prompt: `次の依頼に最も適したスキルを1つ選べ。適切なものが無ければ none を選べ。\n依頼: ${boundedMaterial(request)}`,
      options: [...candidates.map((candidate) => candidate.name), NO_SKILL],
      criteria: {
        ...Object.fromEntries(
          candidates.map((candidate) => [candidate.name, candidate.description]),
        ),
        [NO_SKILL]: "どのスキルも当てはまらない",
      },
    },
    context,
  );

  const gated = gate(decided, threshold, NO_SKILL);
  return {
    value: candidates.find((candidate) => candidate.name === gated.value),
    confidence: gated.confidence,
    source: gated.source,
  };
}
