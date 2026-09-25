/**
 * Harness-side adapter: a `DecisionProvider` whose judgments come from the
 * always-on judgment service over the local loopback.
 *
 * Why this exists as an adapter and not as the service itself: the harness must
 * NOT hold the key that speaks to the judgment model. The process that holds the
 * key is the service (started once at login, key read once with `op read`); the
 * harness gets this provider injected by the composition root and never sees a
 * credential, a base URL of the model vendor, or the SDK.
 *
 * The transport is injected (`client`) for the same reason `JevProvider` injects
 * its `SystemOneClient`: this file stays offline-testable and knows nothing about
 * HTTP. It validates the reply against the operation that was asked — a reply for
 * another operation is not a judgment about this question, so it throws instead
 * of being read as one.
 */

import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
  ScoreQuery,
} from "../../domain/decision/provider";
import {
  RemoteDecisionProtocolError,
  type RemoteDecisionRequest,
  type RemoteDecisionResponse,
  optionalProbabilities,
  readErrorResponse,
  requireDecidedBoolean,
  requireProbability,
} from "../../domain/decision/remote";

/** The judgment service refused or failed to answer with a judgment. */
export class RemoteDecisionError extends Error {}

/** Sends one request and returns the parsed JSON reply, whatever it is. */
export type RemoteDecisionClient = (request: RemoteDecisionRequest) => Promise<unknown>;

export interface RemoteDecisionProviderOptions {
  readonly client: RemoteDecisionClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turn any non-judgment reply into a thrown error, so it can never be read as an answer. */
function asResponse(value: unknown, op: RemoteDecisionRequest["op"]): RemoteDecisionResponse {
  const failure = readErrorResponse(value);
  if (failure !== undefined) throw new RemoteDecisionError(`${failure.kind}: ${failure.message}`);
  if (!isRecord(value))
    throw new RemoteDecisionProtocolError(`reply for "${op}" must be an object`);
  if (value.op !== op) {
    throw new RemoteDecisionProtocolError(`reply is for "${String(value.op)}", asked "${op}"`);
  }
  return value as RemoteDecisionResponse;
}

function requireConfidence(record: Record<string, unknown>): number {
  return requireProbability(record.confidence, "confidence");
}

/**
 * DecisionProvider backed by the local judgment service. Mirrors the port one to
 * one; a service that answers per operation keeps the two sides symmetrical.
 */
export class RemoteDecisionProvider implements DecisionProvider {
  readonly name = "remote";

  constructor(private readonly options: RemoteDecisionProviderOptions) {}

  async choice<T extends string>(
    query: ChoiceQuery<T>,
    context: DecisionContext,
  ): Promise<Decided<T>> {
    const reply = asResponse(await this.options.client({ op: "choice", query, context }), "choice");
    if (reply.op !== "choice") throw new RemoteDecisionProtocolError("unreachable: op checked");
    if (!query.options.includes(reply.value as T)) {
      throw new RemoteDecisionProtocolError(
        `choice "${reply.value}" is not one of [${query.options.join(", ")}]`,
      );
    }
    // Optional on the wire in both directions: a service that predates the field
    // sends nothing and this stays the `Decided` it has always returned, with no
    // `probabilities` key at all. Present, it is validated against the options
    // that were asked — these numbers get ranked and gated by the caller, so a
    // label from another question would turn into a pick.
    const probabilities = optionalProbabilities(
      reply.probabilities,
      "choice.probabilities",
      query.options,
    );
    return {
      value: reply.value as T,
      confidence: requireConfidence(reply),
      ...(probabilities === undefined ? {} : { probabilities }),
    };
  }

  async bool(query: BoolQuery, context: DecisionContext): Promise<Decided<boolean>> {
    const reply = asResponse(await this.options.client({ op: "bool", query, context }), "bool");
    if (reply.op !== "bool") throw new RemoteDecisionProtocolError("unreachable: op checked");
    if (typeof reply.value !== "boolean") {
      throw new RemoteDecisionProtocolError("bool.value must be a boolean");
    }
    return { value: reply.value, confidence: requireConfidence(reply) };
  }

  async boolBatch(
    query: BoolBatchQuery,
    context: DecisionContext,
  ): Promise<readonly Decided<boolean>[]> {
    // Nothing to ask means no request at all — the port's contract, and the
    // service would answer the same way, so do not spend a round trip on it.
    if (query.prompts.length === 0) return [];

    const reply = asResponse(
      await this.options.client({ op: "boolBatch", query, context }),
      "boolBatch",
    );
    if (reply.op !== "boolBatch") throw new RemoteDecisionProtocolError("unreachable: op checked");
    if (!Array.isArray(reply.values)) {
      throw new RemoteDecisionProtocolError("boolBatch.values must be an array");
    }
    if (reply.values.length !== query.prompts.length) {
      throw new RemoteDecisionProtocolError(
        `boolBatch answered ${reply.values.length} questions, asked ${query.prompts.length}`,
      );
    }
    return reply.values.map((value, index) => requireDecidedBoolean(value, `values[${index}]`));
  }

  async score(query: ScoreQuery, context: DecisionContext): Promise<Decided<number>> {
    const reply = asResponse(await this.options.client({ op: "score", query, context }), "score");
    if (reply.op !== "score") throw new RemoteDecisionProtocolError("unreachable: op checked");
    if (typeof reply.value !== "number" || !Number.isFinite(reply.value)) {
      throw new RemoteDecisionProtocolError("score.value must be a finite number");
    }
    const levels = query.criteria;
    if (levels !== undefined && (reply.value < 0 || reply.value > levels.length - 1)) {
      throw new RemoteDecisionProtocolError(
        `score ${reply.value} is outside 0..${levels.length - 1}`,
      );
    }
    return { value: reply.value, confidence: requireConfidence(reply) };
  }
}
