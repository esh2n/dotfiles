import {
  type DecisionContext,
  type DecisionProvider,
  type Gated,
  gate,
} from "../../domain/decision/provider";
import { boundedMaterial } from "../decision/material";

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
 * The gated answer plus what the model actually said: on a fallback `value`
 * is the safe tier while `chosen` is the tier the judgment preferred. The log
 * needs both, or "why was this never routed to deterministic?" has no data.
 */
export interface TierChoice extends Gated<Tier> {
  readonly chosen: Tier;
  readonly probabilities?: Readonly<Record<string, number>>;
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
): Promise<TierChoice> {
  const threshold = options.threshold ?? 0.6;
  const fallback = options.fallback ?? "main";
  const decided = await provider.choice<Tier>(
    {
      prompt: `Which tier fits this request?\n${boundedMaterial(request)}`,
      options: TIERS,
      criteria: TIER_CRITERIA,
    },
    context,
  );
  return {
    ...gate(decided, threshold, fallback),
    chosen: decided.value,
    ...(decided.probabilities === undefined ? {} : { probabilities: decided.probabilities }),
  };
}
