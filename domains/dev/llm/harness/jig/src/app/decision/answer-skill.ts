/**
 * Application use-case for the skill endpoint: "which skill fits this request?".
 *
 * The skill question, its per-option criteria and the confidence threshold live in
 * ONE place (`app/routing/select-skill.ts`), which is why this endpoint exists
 * instead of each harness carrying its own wording: two harnesses asking the same
 * question with two slightly different phrasings would be two different judgments.
 *
 * The catalog is a dependency rather than something this use-case reads, because
 * whether the farm is read per call or cached is a deployment decision: the service
 * is long-lived, so it can hold the list, while a one-shot hook process cannot.
 *
 * `null` is a real answer, not an error: no skill fits, or the judgment was too weak
 * to act on. The caller's job in both cases is to leave the request as it was. The
 * confidence and `source` are returned so a caller can tell "the judgment said
 * nothing applies" from "the judgment did not clear the gate".
 */

import type { DecisionProvider } from "../../domain/decision/provider";
import type { Clock, Logger } from "../../domain/ports";
import { type SelectSkillOptions, type SkillCandidate, selectSkill } from "../routing/select-skill";

export interface SkillDecision {
  /** The chosen skill's name, or `null` when nothing should be injected. */
  readonly skill: string | null;
  /** Where the chosen skill's body is, so a caller can point the model at it. */
  readonly path: string | null;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
}

export type AnswerSkillResult =
  | { readonly ok: true; readonly decision: SkillDecision }
  | {
      readonly ok: false;
      readonly kind: "bad-request" | "provider-error";
      readonly message: string;
    };

/**
 * The skill question is asked about ONE string: the request. The field is named
 * `prompt` to match the key a harness hook already receives on stdin, so a hook can
 * post its payload unchanged rather than translating it first.
 */
function promptOf(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("body must be an object with a `prompt` string");
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string") throw new Error("`prompt` must be a string");
  if (prompt.trim() === "") throw new Error("`prompt` is empty — there is nothing to route");
  return prompt;
}

export interface AnswerSkillDeps {
  readonly catalog: () => Promise<readonly SkillCandidate[]>;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly options?: SelectSkillOptions;
}

/** Answer "which skill fits this request?" without throwing: a failure is a value. */
export async function answerSkill(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerSkillDeps,
): Promise<AnswerSkillResult> {
  let prompt: string;
  try {
    prompt = promptOf(body);
  } catch (error) {
    return {
      ok: false,
      kind: "bad-request",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = deps.clock?.now().getTime();
  try {
    const candidates = await deps.catalog();
    const gated = await selectSkill(prompt, candidates, provider, {}, deps.options ?? {});
    const endedAt = deps.clock?.now().getTime();
    deps.logger?.debug("skill.decided", {
      skill: gated.value?.name ?? null,
      candidates: candidates.length,
      confidence: gated.confidence,
      source: gated.source,
      ...(startedAt === undefined || endedAt === undefined
        ? {}
        : { durationMs: endedAt - startedAt }),
    });
    return {
      ok: true,
      decision: {
        skill: gated.value?.name ?? null,
        path: gated.value?.path ?? null,
        confidence: gated.confidence,
        source: gated.source,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("skill.failed", { reason: message });
    return { ok: false, kind: "provider-error", message };
  }
}
