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
}

export interface DecisionContext {
  readonly [key: string]: unknown;
}

export interface ChoiceQuery<T extends string> {
  readonly prompt: string;
  readonly options: readonly T[];
}

export interface BoolQuery {
  readonly prompt: string;
}

export interface ScoreQuery {
  readonly prompt: string;
}

export interface DecisionProvider {
  readonly name: string;
  choice<T extends string>(query: ChoiceQuery<T>, context: DecisionContext): Promise<Decided<T>>;
  bool(query: BoolQuery, context: DecisionContext): Promise<Decided<boolean>>;
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
