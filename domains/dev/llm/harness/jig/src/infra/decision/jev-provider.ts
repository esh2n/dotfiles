import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
  ScoreQuery,
} from "../../domain/decision/provider";

/**
 * TypeSafe (Jev) adapter for the DecisionProvider port.
 *
 * Wire contract verified 2026-08-24 from real code, not from notes:
 *  - request shape: `pi-typesafe@0.6.0` dist/schema.js — the TypeBox schema it
 *    validates against (choice needs a `criteria` record of label -> entry,
 *    score needs a 2-32 entry array, noul takes an optional true/false record,
 *    1-32 questions per request, `additionalProperties: false`)
 *  - response shape: `pi-typesafe@0.6.0` dist/client.js `validResult` — every
 *    answer carries `type`; choice returns `choice`/`probabilities`/`confidence`,
 *    score returns `score`/`probabilities`/`confidence`/`legend`, noul returns
 *    only `noul`.
 *  - host `https://api.typesafe.ai`, key env `TYPESAFE_API_KEY`, official client
 *    `@typesafe-ai/sdk` (0.6.0). The transport is injected here so this file
 *    stays offline-testable and the SDK/key never leak into the adapter.
 *
 * Corrected by the first live call (2026-08-24): `model` is REQUIRED. Omitting it
 * is HTTP 422 `Field required` — so `DEFAULT_MODEL` is always sent. That same call
 * also settled the credential question: the key resolved from 1Password
 * (`op://llm-automation/typesafe/credential`) authenticates, because the answer
 * was a schema error and not a 401.
 *
 * Batching: the wire evaluates up to 32 questions against one state in a single
 * request, so `boolBatch` sends one request per 32 questions over one shared
 * material instead of one request per question.
 *
 * What this adapter deliberately does NOT do:
 *  - Retry, spend caps, byte budget. The port has no place for them: the caller
 *    owns those, and `onUsage` is the seam reporting the token counts a caller
 *    needs to enforce a budget.
 */

/** A TypeSafe "entry": any JSON value the docs accept for instructions/criteria. */
export type SystemOneEntry = string | null | readonly unknown[] | Readonly<Record<string, unknown>>;

export type SystemOneQuestion =
  | {
      readonly type: "choice";
      readonly instructions?: SystemOneEntry;
      readonly criteria: Readonly<Record<string, SystemOneEntry>>;
    }
  | {
      readonly type: "score";
      readonly instructions?: SystemOneEntry;
      readonly criteria: readonly SystemOneEntry[];
    }
  | {
      readonly type: "noul";
      readonly instructions?: SystemOneEntry;
      readonly criteria?: Readonly<Record<string, SystemOneEntry>>;
    };

/**
 * The model id sent on every call. The live API requires `model` — omitting it is
 * a 422 `Field required`, found by calling the real endpoint — and TypeSafe's own
 * SDKs default to `jev-latest`, so that is the default here too.
 */
export const DEFAULT_MODEL = "jev-latest";

export interface SystemOneRequest {
  readonly state: SystemOneEntry;
  readonly questions: Readonly<Record<string, SystemOneQuestion>>;
  /** Required by the API; `JevProvider` fills in `DEFAULT_MODEL` when the caller says nothing. */
  readonly model?: string;
}

export type SystemOneAnswer =
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | {
      readonly type: "score";
      readonly score: number;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
      readonly legend: readonly string[];
    }
  | { readonly type: "noul"; readonly noul: number };

export interface SystemOneResult {
  readonly model: string;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly answers: Readonly<Record<string, SystemOneAnswer>>;
}

/** The seam the real client (SDK over HTTP) and the tests both implement. */
export type SystemOneClient = (request: SystemOneRequest) => Promise<SystemOneResult>;

/** The caller asked for something TypeSafe cannot accept — a bug here, not a model failure. */
export class JevRequestError extends Error {}

/**
 * The model's answer does not match the question that was asked. A judgment that
 * fails validation must never be read as a judgment, so this throws instead of
 * degrading into a guess; callers take their fallback path.
 */
export class JevResponseError extends Error {}

/** TypeSafe evaluates at most 32 questions in one request (verified in the API schema). */
const MAX_QUESTIONS_PER_REQUEST = 32;

/** Choice options and their descriptions; falls back to the label as its own description. */
function criteriaOf<T extends string>(query: ChoiceQuery<T>): Record<T, string> {
  const criteria: Record<string, string> =
    query.criteria === undefined
      ? Object.fromEntries(query.options.map((option) => [option, option]))
      : { ...query.criteria };

  const missing = query.options.filter((option) => {
    const description = criteria[option];
    return description === undefined || description.trim() === "";
  });
  if (missing.length > 0) {
    throw new JevRequestError(
      `choice query has no description for: ${missing.join(", ")} — TypeSafe accepts a blank criterion, but a blank one silently degrades the judgment`,
    );
  }
  return criteria as Record<T, string>;
}

function assertProbability(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new JevResponseError(`${what} is not a probability in [0, 1]`);
  }
  return value;
}

function assertKeysMatch(
  probabilities: Readonly<Record<string, number>>,
  expected: readonly string[],
  what: string,
): void {
  const actual = Object.keys(probabilities);
  const same = actual.length === expected.length && expected.every((key) => actual.includes(key));
  if (!same) {
    throw new JevResponseError(
      `${what} covers [${actual.join(", ")}], expected [${expected.join(", ")}]`,
    );
  }
  for (const [key, value] of Object.entries(probabilities))
    assertProbability(value, `${what}.${key}`);
}

function answerFor(
  result: SystemOneResult,
  id: string,
  expectedType: SystemOneQuestion["type"],
): SystemOneAnswer {
  const answer = result.answers[id];
  if (answer === undefined) throw new JevResponseError(`no answer for question "${id}"`);
  if (answer.type !== expectedType) {
    throw new JevResponseError(
      `answer for "${id}" is type "${answer.type}", question asked "${expectedType}"`,
    );
  }
  return answer;
}

/**
 * Noul answers carry NO `confidence` field — they carry the probability that the
 * statement is true. The mapping used everywhere in this file is therefore:
 *   value      = noul >= 0.5
 *   confidence = max(noul, 1 - noul)   // how sure we are of the side we picked
 * so `gate()` keeps working unchanged: a threshold T turns into the dead band
 * `1-T < noul < T`, and a judgment inside that band falls back to the safe side.
 * Note the consequence: with the port's default threshold of 0.5 that band is
 * empty, so a caller that wants "uncertain -> keep" must ask for a higher one.
 */
function noulToBool(answer: SystemOneAnswer, id: string): Decided<boolean> {
  if (answer.type !== "noul") {
    throw new JevResponseError(
      `answer for "${id}" is type "${answer.type}", question asked "noul"`,
    );
  }
  const noul = assertProbability(answer.noul, "noul");
  return { value: noul >= 0.5, confidence: Math.max(noul, 1 - noul) };
}

/** The vendor's own token counts for one request. */
export interface JevUsage {
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface JevProviderOptions {
  readonly client: SystemOneClient;
  /** Sent as `model`; defaults to `DEFAULT_MODEL` (`jev-latest`), which the API requires. */
  readonly model?: string;
  /**
   * Called once per request with the vendor's own token counts. The port has no
   * place for cost, so this is the metering seam: log it, count it, price it —
   * without this adapter knowing what a cent is. One call per request, so a
   * 32-question batch reports one usage for 32 judgments.
   */
  readonly onUsage?: (usage: JevUsage) => void;
}

/**
 * DecisionProvider backed by TypeSafe's System One API. A single-question call
 * sends one question in one request; `boolBatch` sends up to 32 questions against
 * one material in a single request. `noul` maps to `bool` via `noulToBool()`.
 */
export class JevProvider implements DecisionProvider {
  readonly name = "jev";

  constructor(private readonly options: JevProviderOptions) {}

  private async send(
    state: string,
    questions: Readonly<Record<string, SystemOneQuestion>>,
  ): Promise<SystemOneResult> {
    const result = await this.options.client({
      state,
      questions,
      model: this.options.model ?? DEFAULT_MODEL,
    });
    this.options.onUsage?.({
      model: result.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
    });
    return result;
  }

  private async ask(question: SystemOneQuestion, state: string): Promise<SystemOneAnswer> {
    const result = await this.send(state, { q: question });
    return answerFor(result, "q", question.type);
  }

  async choice<T extends string>(
    query: ChoiceQuery<T>,
    _context: DecisionContext,
  ): Promise<Decided<T>> {
    const criteria = criteriaOf(query);
    const answer = await this.ask(
      { type: "choice", instructions: query.prompt, criteria },
      query.prompt,
    );
    if (answer.type !== "choice")
      throw new JevResponseError("unreachable: answer type checked in ask()");

    assertKeysMatch(answer.probabilities, Object.keys(criteria), "choice probabilities");
    if (!(answer.choice in criteria)) {
      throw new JevResponseError(`choice "${answer.choice}" is not one of the options asked`);
    }
    return {
      value: answer.choice as T,
      confidence: assertProbability(answer.confidence, "confidence"),
    };
  }

  /** A yes/no judgment, asked as a Noul ("is this statement true?"). See noulToBool for the mapping. */
  async bool(query: BoolQuery, _context: DecisionContext): Promise<Decided<boolean>> {
    const answer = await this.ask({ type: "noul", instructions: query.prompt }, query.prompt);
    return noulToBool(answer, "q");
  }

  /**
   * Many noul questions against ONE material. Requests are chunked to the wire
   * limit (32 questions per request); the judgments returned keep the order of
   * `prompts` across chunk boundaries. Nothing to ask = no request at all.
   */
  async boolBatch(
    query: BoolBatchQuery,
    _context: DecisionContext,
  ): Promise<readonly Decided<boolean>[]> {
    const decided: Decided<boolean>[] = [];
    for (let start = 0; start < query.prompts.length; start += MAX_QUESTIONS_PER_REQUEST) {
      const chunk = query.prompts.slice(start, start + MAX_QUESTIONS_PER_REQUEST);
      const questions: Record<string, SystemOneQuestion> = {};
      for (let index = 0; index < chunk.length; index++) {
        questions[`q${index}`] = { type: "noul", instructions: chunk[index] };
      }
      const result = await this.send(query.material, questions);
      for (let index = 0; index < chunk.length; index++) {
        decided.push(noulToBool(answerFor(result, `q${index}`, "noul"), `q${index}`));
      }
    }
    return decided;
  }

  async score(query: ScoreQuery, _context: DecisionContext): Promise<Decided<number>> {
    const criteria = query.criteria ?? [];
    if (criteria.length < 2 || criteria.length > 32) {
      throw new JevRequestError(`score query needs 2-32 rubric levels, got ${criteria.length}`);
    }
    const answer = await this.ask(
      { type: "score", instructions: query.prompt, criteria },
      query.prompt,
    );
    if (answer.type !== "score")
      throw new JevResponseError("unreachable: answer type checked in ask()");

    assertKeysMatch(
      answer.probabilities,
      criteria.map((_, index) => String(index)),
      "score probabilities",
    );
    if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > criteria.length - 1) {
      throw new JevResponseError(`score ${answer.score} is outside 0..${criteria.length - 1}`);
    }
    return { value: answer.score, confidence: assertProbability(answer.confidence, "confidence") };
  }
}
