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
 *
 * ## The second shape: one `choice` over the whole catalog
 *
 * `JIG_SKILL_ROUTER_QUESTION=choice` asks ONE question listing every candidate plus an
 * explicit `none`, instead of 54 independent yes/no questions. It is arm C of the
 * skill-selection experiment (`rules/knowledge/skill-selection-router-experiment.md`),
 * and the wording is frozen at the `choice-en` cell recorded there.
 *
 * It is NOT the default and must not become one by accident: the offline run
 * could not evaluate the choice wording against the promotion rule at
 * all, because the wire dropped the distribution and top-3 was therefore unobtainable.
 * That gap is what the `probabilities` field on the `choice` reply closes; this mode is
 * what spends it. The default stays `bool` until the owner flips the variable.
 *
 * What the two shapes cost differently is worth stating plainly, because it is not the
 * saving the router was originally built for: a batch of 54 short questions is 2 jev
 * requests over one material, a choice is 1 request carrying the whole catalog as options.
 * Fewer requests, not fewer tokens.
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
   *
   * In `choice` mode the same sentence holds with "said yes to" read as "ranked above
   * `none`": it is the strongest option probability, and it is absent exactly when the
   * judgment chose `none`. Keeping the two modes' meaning identical is what lets a
   * threshold sweep over the router log compare them.
   */
  readonly confidence: number | undefined;
  /**
   * `decided` = the judgment answered (including "nothing applies"); `fallback` = it said
   * yes to something but not confidently enough to act on.
   */
  readonly source: "decided" | "fallback";
}

/**
 * Which shape the one question takes. `bool` is production and stays the default until
 * the owner flips it; `choice` is arm C of the skill-selection experiment.
 */
export type SkillQuestionMode = "bool" | "choice";

export const DEFAULT_SKILL_QUESTION: SkillQuestionMode = "bool";

/**
 * Read the question mode out of an environment record (`JIG_SKILL_ROUTER_QUESTION`).
 *
 * A pure parse rather than an environment read, so both composition roots — the hook in
 * `cli/jig.ts` and the service in `cli/serve.ts` — resolve it the same way and neither
 * invents its own spelling. Anything unrecognised is the default: a typo in a shell
 * profile must not silently change which question the machine is asking.
 */
export function skillQuestionMode(env: Record<string, string | undefined>): SkillQuestionMode {
  return (env.JIG_SKILL_ROUTER_QUESTION ?? "").trim().toLowerCase() === "choice"
    ? "choice"
    : DEFAULT_SKILL_QUESTION;
}

export interface SelectSkillsOptions {
  /** Below this, a `true` (or an option's probability) is not acted on. */
  readonly threshold?: number;
  /** How many picks the caller wants at most. */
  readonly max?: number;
  /** Which question to ask. Default `bool` — see `SkillQuestionMode`. */
  readonly question?: SkillQuestionMode;
}

/** The question asked about ONE candidate. The candidate's own description is its context. */
export function skillQuestion(candidate: SkillCandidate): string {
  return `この依頼は「${candidate.name}」スキルの手順を必要とするか。（${candidate.name}: ${candidate.description}）`;
}

/**
 * The abstain option. TypeSafe's own `primitives/choice.md` asks for an explicit
 * "none of the above" whenever the list might not cover every input, and 63.5% of the
 * frozen prompt set is labelled `none` — without it the question has no way to decline.
 */
export const SKILL_CHOICE_NONE = "none";

/**
 * The choice wording, frozen at PROTOCOL.md §3b variant `choice-en` and reproduced here
 * character for character: a live arm that asked a differently-worded question would not
 * be the variant the offline run measured, and `kamo-shika/jev-bench` puts the accuracy
 * swing from wording alone at 8-16 points.
 *
 * English per `rules/decisions/2026-09-23-model-facing-english.md` (the judgment question's
 * framing is something the model reads).
 */
export const SKILL_CHOICE_QUESTION =
  'Which skill\'s instructions should be read before doing this request? Choose "none" if none of them applies.';

/** The `none` option's description, also frozen at PROTOCOL.md §3b. */
export const SKILL_CHOICE_NONE_DESCRIPTION =
  "a request that needs none of these skills' procedures";

/**
 * Material and question in ONE string, because the port's `ChoiceQuery` has no material
 * field: `JevProvider.choice()` sends `query.prompt` as the System One state, so there is
 * nowhere else to put the request. RESULTS-OFFLINE.md §1.3 item 1 recorded this as a
 * fidelity cost of the offline run; the same concatenation is used here on purpose, so the
 * live arm asks what was measured rather than something adjacent to it.
 */
export function skillChoicePrompt(request: string): string {
  return `Request: ${boundedMaterial(request)}\n\n${SKILL_CHOICE_QUESTION}`;
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

  if ((options.question ?? DEFAULT_SKILL_QUESTION) === "choice") {
    return await selectByChoice(request, candidates, provider, context, threshold, max);
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

/**
 * The same selection from ONE `choice` question over the whole catalog plus `none`,
 * instead of one yes/no question per candidate.
 *
 * Why this can produce more than one pick from a question that returns one answer: the
 * provider also returns the distribution over the options it was given, and a ranking is
 * what the cap and the gate operate on. So `value` (the argmax) decides *whether the
 * judgment declined*, and `probabilities` decides *what gets injected* — the same two
 * roles `value` and `confidence` play per candidate in the bool path.
 *
 * The rules, chosen to mirror the bool path one for one so a threshold sweep over the
 * router log means the same thing in either mode:
 *
 *  - a candidate's score is its own probability; `none`'s probability is not a pick and
 *    never injected, it only tells us the judgment declined;
 *  - the gate is applied to that probability, strongest first, catalog order breaking
 *    ties, capped at `max` — `passed` counts what cleared the gate BEFORE the cap;
 *  - `confidence` is the strongest non-`none` probability, gate or not, and is absent
 *    when the judgment answered `none`, exactly as the bool path omits it when nothing
 *    was answered `true`;
 *  - answering `none` is deciding, not falling back. Only "a skill won, but too weakly to
 *    act on" is a fallback.
 *
 * When the answering side sends no distribution (a service older than the
 * `probabilities` field, or a provider that has none), the answer degrades to its top-1:
 * the winning option at the confidence given. That is exactly the offline run's rule for
 * `choice` (RESULTS-OFFLINE.md §1.4) and it is the honest floor — top-3 is not obtainable
 * from an answer that only names one option, so it is not simulated.
 */
async function selectByChoice(
  request: string,
  candidates: readonly SkillCandidate[],
  provider: DecisionProvider,
  context: DecisionContext,
  threshold: number,
  max: number,
): Promise<SelectSkillsResult> {
  // A skill literally called `none` cannot be told from the abstain option once both are
  // labels in the same question, so it is left out of this mode rather than silently
  // turning every abstention into a pick. No skill is named that today; if one ever is,
  // it is invisible here and visible in the catalog, which is the safe way round.
  const routable = candidates.filter((candidate) => candidate.name !== SKILL_CHOICE_NONE);
  if (routable.length === 0) {
    return { picks: [], passed: 0, confidence: undefined, source: "fallback" };
  }

  const criteria: Record<string, string> = {
    [SKILL_CHOICE_NONE]: SKILL_CHOICE_NONE_DESCRIPTION,
  };
  for (const candidate of routable) {
    // A blank description would be rejected by the jev adapter and take the whole
    // judgment with it; the name is a poor description but it is the one the harness's
    // own listing falls back to as well.
    criteria[candidate.name] =
      candidate.description.trim() === "" ? candidate.name : candidate.description;
  }

  const decided = await provider.choice(
    {
      prompt: skillChoicePrompt(request),
      options: [...routable.map((candidate) => candidate.name), SKILL_CHOICE_NONE],
      criteria,
    },
    context,
  );

  // No distribution: all that is known is the one option that won and how sure of it the
  // provider was. Reading that as a one-entry distribution keeps the rules below unchanged.
  const probabilities =
    decided.probabilities ?? ({ [decided.value]: decided.confidence } as Record<string, number>);

  const ranked: SkillPick[] = [];
  for (const candidate of routable) {
    const probability = probabilities[candidate.name];
    if (probability === undefined) continue;
    ranked.push({ candidate, confidence: probability });
  }
  ranked.sort((left, right) => right.confidence - left.confidence);

  const passed = ranked.filter((pick) => pick.confidence >= threshold);
  const picks = passed.slice(0, max);
  const declined = decided.value === SKILL_CHOICE_NONE;

  return {
    picks,
    passed: passed.length,
    confidence: declined ? undefined : ranked[0]?.confidence,
    source: picks.length > 0 || declined ? "decided" : "fallback",
  };
}
