/**
 * Decision port — typed judgments with a calibrated confidence, mirroring jev's
 * `ask.choice / if / score`. Every place jig makes a judgment (model selection,
 * skill selection, orchestration delegation, compaction scoring) depends on this
 * port, never on jev directly. jev is one adapter; a deterministic rule provider,
 * a local model, or an upstream model are others.
 *
 * The guard rail deliberately does NOT route through this port: allow/deny must
 * stay deterministic, fast, offline, and auditable (see domain/hooks/decision.ts).
 */

export interface Decided<T> {
  readonly value: T;
  readonly confidence: number;
  /**
   * The full distribution over the options, when the provider has one (a
   * choice answered by jev). `value` and `confidence` remain the provider's own
   * answer — the argmax and how sure it is — and a caller that only wants an
   * answer reads those two and nothing else.
   *
   * A caller that wants a RANKING rather than an answer reads this: the skill
   * router's choice mode ranks the options by their probability and gates each
   * one, which is how a single Choice yields more than one pick (see
   * `app/routing/select-skills.ts`). It is therefore load-bearing where it is
   * present, and absent from every provider that has no distribution to give —
   * so a caller must have a defined behaviour for `undefined`, never assume it.
   */
  readonly probabilities?: Readonly<Record<string, number>>;
}

export interface DecisionContext {
  readonly [key: string]: unknown;
}

export interface ChoiceQuery<T extends string> {
  readonly prompt: string;
  readonly options: readonly T[];
  /**
   * Optional description per option. Kept separate from `options` because
   * TypeSafe's Choice REQUIRES a `criteria` record (label -> description) and a
   * bare label rarely carries the meaning the judgment needs: "complex" says
   * nothing, "hard design or debugging, one model is not enough" does. A
   * provider that cannot use descriptions (a rule provider) may ignore this; a
   * provider that requires them must fail loudly when an option has none.
   */
  readonly criteria?: Readonly<Record<T, string>>;
}

export interface BoolQuery {
  /** The question. For a single yes/no this is also the material judged, since there is nothing else. */
  readonly prompt: string;
}

/**
 * Many yes/no questions about ONE body of material.
 *
 * Exists because the judgment models jig talks to evaluate a set of questions
 * against a shared state in a single round trip (TypeSafe: up to 32 questions,
 * answered in parallel, and the docs state adding questions barely changes
 * latency). Asking per item costs one round trip per item for the same answer.
 */
export interface BoolBatchQuery {
  /** The material every question is judged against. Sent once, not per item. */
  readonly material: string;
  /** One question per item, in order. Judgments come back in the same order. */
  readonly prompts: readonly string[];
}

export interface ScoreQuery {
  readonly prompt: string;
  /** Optional rubric, ordered worst -> best. TypeSafe's Score requires 2-32 levels. */
  readonly criteria?: readonly string[];
}

export interface DecisionProvider {
  readonly name: string;
  choice<T extends string>(query: ChoiceQuery<T>, context: DecisionContext): Promise<Decided<T>>;
  bool(query: BoolQuery, context: DecisionContext): Promise<Decided<boolean>>;
  /**
   * The same yes/no judgment for many items at once, against one material. A
   * provider that cannot batch answers them one by one and returns the same
   * array, so callers do not branch on the capability.
   */
  boolBatch(query: BoolBatchQuery, context: DecisionContext): Promise<readonly Decided<boolean>[]>;
  score(query: ScoreQuery, context: DecisionContext): Promise<Decided<number>>;
}

export interface Gated<T> {
  readonly value: T;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
}

/**
 * Confidence gate: accept the decided value when confidence meets the threshold,
 * otherwise take the safe fallback. The original confidence is always carried
 * through so callers can log or escalate a low-confidence decision.
 */
export function gate<T>(decided: Decided<T>, threshold: number, fallback: T): Gated<T> {
  if (decided.confidence >= threshold) {
    return { value: decided.value, confidence: decided.confidence, source: "decided" };
  }
  return { value: fallback, confidence: decided.confidence, source: "fallback" };
}
