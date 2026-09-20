import { type SkillCandidate, selectSkill } from "../../app/routing/select-skill";
import type { DecisionProvider } from "../../domain/decision/provider";
import type { Logger } from "../../domain/ports";
import type { RouterLogEntry } from "../../domain/skills/router-log";
import { promptHash } from "../../infra/logs/router-log";

interface UserPromptSubmitPayload {
  readonly prompt?: unknown;
}

export interface SkillRouterDeps {
  readonly provider: DecisionProvider;
  readonly catalog: () => Promise<readonly SkillCandidate[]>;
  /**
   * One line per prompt, whether or not anything was injected. Without it the only
   * visible effect of a router is a reminder appearing in the transcript — and the
   * failure that matters (a request that matched nothing, or a judgment below the
   * gate) looks exactly like a router that was never consulted.
   */
  readonly record: (entry: RouterLogEntry) => Promise<void>;
  readonly logger?: Logger;
  readonly env?: Record<string, string | undefined>;
}

export interface SkillRouterOptions {
  readonly threshold?: number;
}

/**
 * The reminder the model receives. It names the skill, says why it appeared, and points
 * at the body rather than carrying it: the body is 1-15k characters, and injecting it
 * would hand back most of the list tokens this router exists to save. The
 * `disable-model-invocation` refusal message in Claude Code tells a model to ask the
 * user to run the skill by name; this reminder is the other half of that arrangement —
 * the model still gets the instructions, without the skill being listed.
 */
function reminder(candidate: SkillCandidate, confidence: number): string {
  const rounded = confidence.toFixed(2);
  return [
    `jig skill router: this request matches the "${candidate.name}" skill (judgment confidence ${rounded}).`,
    `Read ${candidate.path} and follow it before doing the work.`,
  ].join("\n");
}

function isDisabled(env: Record<string, string | undefined>): boolean {
  const value = (env.JIG_SKILL_ROUTER ?? "on").toLowerCase();
  return value === "off" || value === "false" || value === "0";
}

/**
 * Which harness this hook is running inside, from the wrapper that invoked it.
 *
 * The hook cannot discover it: by the time it runs, all it has is a prompt on stdin, and
 * the same binary is wired into more than one harness. The wrapper knows, so the wrapper
 * says (`JIG_HARNESS=claude`). `unknown` is the honest default — attributing an unlabelled
 * invocation to a harness would put a harness's numbers in another's.
 */
function harnessOf(env: Record<string, string | undefined>): string {
  const harness = env.JIG_HARNESS?.trim();
  return harness === undefined || harness === "" ? "unknown" : harness;
}

/**
 * Identity of the prompt exactly as it arrived. `promptChars` alone cannot tell two
 * prompts apart: a batch of same-length but different requests reads as one prompt
 * whose confidence wandered, and a repeatability claim made on lengths cannot be
 * checked afterwards. Twelve hex characters of SHA-256 are enough to group repeats.
 *
 * The hash and the writer live in `infra/log/router-log.ts`, because the judgment service
 * writes to the same log for the harnesses that call `/skill`; two copies of this function
 * would make those lines impossible to join to this one's.
 */
/**
 * Claude Code `UserPromptSubmit` hook entrypoint: pick the skill this prompt matches and
 * put it back into the request as context.
 *
 * This exists because a harness builds its skill list before the model sees a request,
 * and no hook can remove what is already in the prompt. So the list is a fixed cost on
 * every turn, and the harness's own selection starts losing accuracy as that list grows
 * (Anthropic's own tool-search documentation puts the degradation past 30-50 candidates;
 * this machine lists 55). Routing outside the prompt pays for the catalog in the
 * judgment model's context instead of the coding model's, and it decides per request
 * rather than per installed skill.
 *
 * Every failure returns the empty string, which is what a hook with no opinion returns:
 * a missing service, an unreadable catalog, a malformed payload and a low-confidence
 * judgment all leave the prompt exactly as it was. The router is an addition to the
 * request, never a gate on it.
 */
export async function userPromptSubmit(
  stdin: string,
  deps: SkillRouterDeps,
  options: SkillRouterOptions = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  if (isDisabled(env)) return "";

  let payload: UserPromptSubmitPayload;
  try {
    payload = JSON.parse(stdin) as UserPromptSubmitPayload;
  } catch {
    deps.logger?.warn("skill-router.unparseable-input");
    return "";
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (prompt.trim() === "") return "";

  try {
    const candidates = await deps.catalog();
    const decided = await selectSkill(prompt, candidates, deps.provider, {}, options);
    await deps.record({
      at: new Date().toISOString(),
      harness: harnessOf(env),
      promptHash: promptHash(prompt),
      promptChars: prompt.length,
      candidates: candidates.length,
      skill: decided.value?.name ?? null,
      confidence: decided.confidence,
      source: decided.source,
    });
    if (decided.value === undefined) return "";
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: reminder(decided.value, decided.confidence),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("skill-router.failed", { reason: message });
    await deps
      .record({
        at: new Date().toISOString(),
        harness: harnessOf(env),
        promptHash: promptHash(prompt),
        promptChars: prompt.length,
        error: message,
      })
      .catch(() => undefined);
    return "";
  }
}
