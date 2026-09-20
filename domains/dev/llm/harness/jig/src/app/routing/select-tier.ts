import {
  type DecisionContext,
  type DecisionProvider,
  type Gated,
  gate,
} from "../../domain/decision/provider";

export type Tier = "main" | "complex" | "deterministic";

export const TIERS: readonly Tier[] = ["main", "complex", "deterministic"];

/**
 * What each tier is for, in the words the decision model judges by. A bare tier
 * name carries no meaning for the judgment ("complex" could be anything), and
 * TypeSafe's Choice requires a description per option anyway — so these
 * descriptions are the input to the decision, not decoration.
 */
export const TIER_CRITERIA: Readonly<Record<Tier, string>> = {
  main: "routine work: ordinary edits, searches, explanations, small fixes",
  complex: "hard work: design, architecture, subtle debugging, long-horizon planning",
  deterministic:
    "mechanical work: formatting, renames, boilerplate, restating what is already known",
};

export interface SelectTierOptions {
  readonly threshold?: number;
  readonly fallback?: Tier;
}

/**
 * How much of the request becomes the judgment's material. Measured against the
 * live model on an 89k-character prompt (a task statement, a 1,400-line file, and
 * the ask at the end):
 *
 *  - sent whole, the call FAILS (`HTTP 400 max_tokens_exceeded`, served as 502), so
 *    a long prompt gets no routing at all and silently keeps the current model
 *  - head + tail (4k/4k, 1.5k/1.5k) decides `complex` with confidence 1.00 in 0.2s
 *  - the tail alone collapses to `main` with confidence 0.04: an ask without the
 *    context it refers to is not routable, and the gate throws the call away
 *
 * The middle is the pasted body, which is what a router needs least; both ends are
 * what it needs. 2k each keeps the call well inside the provider's limit and inside
 * the size that was measured to answer confidently.
 */
const MATERIAL_HEAD_CHARS = 2_000;
const MATERIAL_TAIL_CHARS = 2_000;

/**
 * The head and the tail, with the middle elided. The elision is announced instead
 * of hidden: a judgment that is told it sees an excerpt of a longer request can
 * report that the excerpt does not settle the tier, and the confidence gate then
 * keeps the current model rather than guessing from a truncated view.
 */
export function tierMaterial(request: string): string {
  if (request.length <= MATERIAL_HEAD_CHARS + MATERIAL_TAIL_CHARS) return request;
  const elided = request.length - MATERIAL_HEAD_CHARS - MATERIAL_TAIL_CHARS;
  return [
    request.slice(0, MATERIAL_HEAD_CHARS),
    `… [${elided} characters elided from the middle of a ${request.length}-character request] …`,
    request.slice(-MATERIAL_TAIL_CHARS),
  ].join("\n\n");
}

/**
 * Model selector use-case: ask the decision provider which tier fits the request,
 * gated by confidence. A low-confidence answer falls back to `main` (cheap and
 * safe) rather than betting an expensive tier on a weak judgment. Depends only on
 * the DecisionProvider port, so jev / a local model / a rule provider all slot in.
 */
export async function selectTier(
  request: string,
  provider: DecisionProvider,
  context: DecisionContext = {},
  options: SelectTierOptions = {},
): Promise<Gated<Tier>> {
  const threshold = options.threshold ?? 0.6;
  const fallback = options.fallback ?? "main";
  const decided = await provider.choice<Tier>(
    {
      prompt: `Which tier fits this request?\n${tierMaterial(request)}`,
      options: TIERS,
      criteria: TIER_CRITERIA,
    },
    context,
  );
  return gate(decided, threshold, fallback);
}
