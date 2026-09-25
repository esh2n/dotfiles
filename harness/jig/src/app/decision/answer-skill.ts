/**
 * Application use-case for the skill endpoint: "which skills does this request need?".
 *
 * The question, its per-candidate wording and the confidence threshold live in ONE place
 * (`app/routing/select-skills.ts`), which is why this endpoint exists instead of each
 * harness carrying its own wording: two harnesses asking the same question with two
 * slightly different phrasings would be two different judgments.
 *
 * The catalog is a dependency rather than something this use-case reads, because
 * whether the farm is read per call or cached is a deployment decision: the service
 * is long-lived, so it can hold the list, while a one-shot hook process cannot.
 *
 * An empty list is a real answer, not an error: no skill fits, or the judgment was too weak
 * to act on. The caller's job in both cases is to leave the request as it was. `passed` and
 * `source` are returned so a caller can tell "the judgment said nothing applies" from "the
 * judgment did not clear the gate", and so a batch that answers `true` to everything is
 * visible instead of reading as a confident pick.
 */

import type { DecisionProvider } from "../../domain/decision/provider";
import type { Clock, Logger } from "../../domain/ports";
import type { SkillCandidate } from "../../domain/skills/candidate";
import { type SelectSkillsOptions, selectSkills } from "../routing/select-skills";

/** One skill to inject, with where its body is and how strong the judgment was. */
export interface SkillPickDecision {
  readonly name: string;
  readonly path: string;
  readonly confidence: number;
}

export interface SkillDecision {
  /** The skills to inject, strongest first. Empty when nothing should be injected. */
  readonly skills: readonly SkillPickDecision[];
  /** How many candidates cleared the gate, before the cap. */
  readonly passed: number;
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
  readonly options?: SelectSkillsOptions;
}

/** Answer "which skills does this request need?" without throwing: a failure is a value. */
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
    const judged = await selectSkills(prompt, candidates, provider, {}, deps.options ?? {});
    const endedAt = deps.clock?.now().getTime();
    deps.logger?.debug("skill.decided", {
      skills: judged.picks.map((pick) => pick.candidate.name).join(", "),
      candidates: candidates.length,
      passed: judged.passed,
      confidence: judged.picks[0]?.confidence ?? null,
      source: judged.source,
      ...(startedAt === undefined || endedAt === undefined
        ? {}
        : { durationMs: endedAt - startedAt }),
    });
    return {
      ok: true,
      decision: {
        skills: judged.picks.map((pick) => ({
          name: pick.candidate.name,
          path: pick.candidate.path,
          confidence: pick.confidence,
        })),
        passed: judged.passed,
        source: judged.source,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("skill.failed", { reason: message });
    return { ok: false, kind: "provider-error", message };
  }
}
