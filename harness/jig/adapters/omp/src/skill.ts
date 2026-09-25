/**
 * Skill selection for omp: on `before_agent_start`, ask jig's judgment
 * service which skill the prompt matches and return the reminder as a message
 * for the turn — what Claude Code's UserPromptSubmit hook, pi's extension and
 * DSH's plugin do, against the same `/skill` endpoint.
 *
 * The message is appended to the turn, never written into the system prompt:
 * the system prompt is the cached prefix, and rewriting it every turn turns
 * every later token into a cache write. Failure is silence (service down,
 * slow, malformed, nothing matched); `OMP_SKILL_ROUTER=off` turns it off.
 */

import { jig } from "./jig";
import type { OmpBeforeAgentStartEvent, OmpBeforeAgentStartResult, OmpContext } from "./omp";

export interface SkillDeps {
  /** The client, injectable for tests; defaults to jig's `infra/decision/skill-client`. */
  readonly client?: Pick<
    Awaited<ReturnType<typeof jig>>["skill"],
    "askSkill" | "routable" | "skillReminder"
  >;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The result for one prompt, or `undefined` to leave the turn as it is. Never throws. */
export async function routeSkill(
  event: OmpBeforeAgentStartEvent,
  ctx: OmpContext,
  deps: SkillDeps = {},
): Promise<OmpBeforeAgentStartResult | undefined> {
  const env = deps.env ?? process.env;
  if (env.OMP_SKILL_ROUTER === "off") return undefined;
  try {
    const client = deps.client ?? (await jig()).skill;
    const prompt = event.prompt ?? "";
    if (!client.routable(prompt)) return undefined;
    const decision = await client.askSkill("omp", prompt, { env });
    const reminder = client.skillReminder(decision, "omp");
    if (reminder === undefined) return undefined;
    ctx.ui?.setStatus?.(`skill: ${decision.skills.map((pick) => pick.name).join(", ")}`);
    return { message: { customType: "jig-skill-router", content: reminder, display: false } };
  } catch {
    return undefined;
  }
}
