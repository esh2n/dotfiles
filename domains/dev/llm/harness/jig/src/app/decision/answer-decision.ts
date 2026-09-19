/**
 * Application use-case for the judgment service: answer one request off the
 * wire by asking the injected provider, and classify the failure if it fails.
 *
 * No HTTP here on purpose — status codes are the transport's business. This
 * returns a discriminated result so the caller maps `bad-request` /
 * `provider-error` to 400 / 502 and the dispatch logic stays testable with a
 * fake provider and plain values.
 *
 * Every judgment is logged with its op, outcome and duration: the service is the
 * single place all harnesses' judgments pass through, which is exactly where a
 * confidence distribution, a fallback rate, or a latency baseline has to be
 * measured to decide anything later.
 */

import type { DecisionProvider } from "../../domain/decision/provider";
import {
  RemoteDecisionProtocolError,
  type RemoteDecisionRequest,
  type RemoteDecisionResponse,
  parseRemoteDecisionRequest,
} from "../../domain/decision/remote";
import type { Clock, Logger } from "../../domain/ports";

export type AnswerDecisionResult =
  | { readonly ok: true; readonly response: RemoteDecisionResponse }
  | {
      readonly ok: false;
      readonly kind: "bad-request" | "provider-error";
      readonly message: string;
    };

export interface AnswerDecisionDeps {
  readonly logger?: Logger;
  readonly clock?: Clock;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ask the provider for the answer to one parsed request. A `boolBatch` with no
 * questions is answered without calling the provider at all: the port's contract
 * is that nothing to ask means no request.
 */
export async function dispatchDecision(
  request: RemoteDecisionRequest,
  provider: DecisionProvider,
): Promise<RemoteDecisionResponse> {
  switch (request.op) {
    case "choice": {
      const decided = await provider.choice(request.query, request.context);
      return { op: "choice", value: decided.value, confidence: decided.confidence };
    }
    case "bool": {
      const decided = await provider.bool(request.query, request.context);
      return { op: "bool", value: decided.value, confidence: decided.confidence };
    }
    case "boolBatch": {
      if (request.query.prompts.length === 0) return { op: "boolBatch", values: [] };
      const decided = await provider.boolBatch(request.query, request.context);
      return { op: "boolBatch", values: decided };
    }
    case "score": {
      const decided = await provider.score(request.query, request.context);
      return { op: "score", value: decided.value, confidence: decided.confidence };
    }
  }
}

/** Parse, dispatch, and classify. Never throws: a failure is a value here. */
export async function answerDecision(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerDecisionDeps = {},
): Promise<AnswerDecisionResult> {
  let request: RemoteDecisionRequest;
  try {
    request = parseRemoteDecisionRequest(body);
  } catch (error) {
    const kind = error instanceof RemoteDecisionProtocolError ? "bad-request" : "provider-error";
    return { ok: false, kind, message: messageOf(error) };
  }

  const startedAt = deps.clock?.now().getTime();
  try {
    const response = await dispatchDecision(request, provider);
    const endedAt = deps.clock?.now().getTime();
    const durationMs =
      startedAt === undefined || endedAt === undefined ? undefined : endedAt - startedAt;
    deps.logger?.debug("decision.answer", {
      op: response.op,
      ...(durationMs === undefined ? {} : { durationMs }),
      source: provider.name,
    });
    return { ok: true, response };
  } catch (error) {
    const kind = error instanceof RemoteDecisionProtocolError ? "bad-request" : "provider-error";
    deps.logger?.warn("decision.failed", { op: request.op, kind, reason: messageOf(error) });
    return { ok: false, kind, message: messageOf(error) };
  }
}
