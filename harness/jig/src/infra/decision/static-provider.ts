import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
  ScoreQuery,
} from "../../domain/decision/provider";

export interface StaticAnswers {
  readonly choice?: {
    readonly value: string;
    readonly confidence: number;
    /**
     * Optional, exactly as on the port: a rule provider has no distribution, and
     * a caller that ranks options must work when there is none. Configured here
     * so both sides of that branch are reachable offline.
     */
    readonly probabilities?: Readonly<Record<string, number>>;
  };
  readonly bool?: Decided<boolean>;
  /**
   * Answers for `boolBatch`, in the order asked. When absent, the single `bool`
   * answer is reused for every question — that is what a rule provider does.
   */
  readonly bools?: readonly Decided<boolean>[];
  readonly score?: Decided<number>;
}

/**
 * A deterministic DecisionProvider that returns preconfigured answers. Serves as
 * a test double and as an offline / fallback provider — no cloud, no model.
 */
export class StaticProvider implements DecisionProvider {
  readonly name = "static";

  constructor(private readonly answers: StaticAnswers) {}

  async choice<T extends string>(
    query: ChoiceQuery<T>,
    _context: DecisionContext,
  ): Promise<Decided<T>> {
    const answer = this.answers.choice;
    if (answer === undefined) throw new Error("static provider: no choice answer configured");
    if (!query.options.includes(answer.value as T)) {
      throw new Error(`static provider: answer ${answer.value} not in options`);
    }
    return {
      value: answer.value as T,
      confidence: answer.confidence,
      ...(answer.probabilities === undefined ? {} : { probabilities: answer.probabilities }),
    };
  }

  async bool(_query: BoolQuery, _context: DecisionContext): Promise<Decided<boolean>> {
    if (this.answers.bool === undefined)
      throw new Error("static provider: no bool answer configured");
    return this.answers.bool;
  }

  async boolBatch(
    query: BoolBatchQuery,
    _context: DecisionContext,
  ): Promise<readonly Decided<boolean>[]> {
    const answers = this.answers.bools;
    if (answers !== undefined) {
      if (answers.length !== query.prompts.length) {
        throw new Error(
          `static provider: ${answers.length} batch answers for ${query.prompts.length} prompts`,
        );
      }
      return answers;
    }
    const single = await this.bool({ prompt: "" }, {});
    return query.prompts.map(() => single);
  }

  async score(_query: ScoreQuery, _context: DecisionContext): Promise<Decided<number>> {
    if (this.answers.score === undefined)
      throw new Error("static provider: no score answer configured");
    return this.answers.score;
  }
}
