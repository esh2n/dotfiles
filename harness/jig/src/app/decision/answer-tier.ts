/**
 * Application use-case for routing a request to a tier.
 *
 * The tier question, its per-option criteria, and the confidence threshold live
 * in ONE place (`app/routing/select-tier.ts`), which is why this endpoint exists
 * instead of every harness repeating the prompt: a harness asks "which tier is
 * this?", not "here is a choice question I wrote". Two harnesses asking the same
 * question with two slightly different wordings would be two different judgments.
 *
 * A weak judgment never switches anything loudly: the gate returns the safe
 * fallback (`main`) with `source: "fallback"`, so the caller can see that the
 * model was chosen by default rather than by judgment.
 */

import type { DecisionProvider } from "../../domain/decision/provider";
import type { Clock, Logger } from "../../domain/ports";
import { type SelectTierOptions, type Tier, selectTier } from "../routing/select-tier";

export interface TierDecision {
  readonly tier: Tier;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
  /** The tier the judgment preferred, which differs from `tier` on a fallback. */
  readonly chosen: Tier;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly durationMs?: number;
}

export type AnswerTierResult =
  | { readonly ok: true; readonly decision: TierDecision }
  | {
      readonly ok: false;
      readonly kind: "bad-request" | "provider-error";
      readonly message: string;
    };

/** The tier question is asked about ONE string: the request (a user prompt, a task). */
function requestTextOf(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("body must be an object with a `request` string");
  }
  const request = (body as { request?: unknown }).request;
  if (typeof request !== "string") throw new Error("`request` must be a string");
  if (request.trim() === "") throw new Error("`request` is empty — there is nothing to route");
  return request;
}

export interface AnswerTierDeps {
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly options?: SelectTierOptions;
}

/** Answer "which tier fits this request?" without throwing: a failure is a value. */
export async function answerTier(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerTierDeps = {},
): Promise<AnswerTierResult> {
  let request: string;
  try {
    request = requestTextOf(body);
  } catch (error) {
    return {
      ok: false,
      kind: "bad-request",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = deps.clock?.now().getTime();
  try {
    const gated = await selectTier(request, provider, {}, deps.options ?? {});
    const endedAt = deps.clock?.now().getTime();
    deps.logger?.debug("tier.decided", {
      tier: gated.value,
      confidence: gated.confidence,
      source: gated.source,
      ...(startedAt === undefined || endedAt === undefined
        ? {}
        : { durationMs: endedAt - startedAt }),
    });
    return {
      ok: true,
      decision: {
        tier: gated.value,
        confidence: gated.confidence,
        source: gated.source,
        chosen: gated.chosen,
        ...(gated.probabilities === undefined ? {} : { probabilities: gated.probabilities }),
        ...(startedAt === undefined || endedAt === undefined
          ? {}
          : { durationMs: endedAt - startedAt }),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("tier.failed", { reason: message });
    return { ok: false, kind: "provider-error", message };
  }
}
