/**
 * Skill selection for DSH: when a human's message enters a step, ask jig's
 * judgment service which skill it matches and add the reminder as one more
 * admitted message — what Claude Code's UserPromptSubmit hook, pi's
 * `before_agent_start` extension and omp's do.
 *
 * DSH's `agent/pre-step` is a waterfall over the messages entering a step.
 * Only messages whose source is the user are judged: the gate's steering and
 * other plugins' context are not requests. A subagent's step is not routed —
 * its prompt is the parent model's, not the owner's. Failure (service down,
 * slow, malformed, nothing matched) adds nothing and never rejects a step.
 * `DSH_SKILL_ROUTER=off` turns it off.
 */

import { askSkill, routable, skillReminder } from "../../../src/infra/decision/skill-client";
import { type DshTextBlock, type DshUserMessage, pluginMessage } from "./message";

/** A message as it enters a step; only the fields read here. */
export interface DshStepMessage {
  readonly source?: { readonly kind?: string };
  readonly content: readonly (DshTextBlock | { readonly type: string })[];
}

/** DSH's `PreStepDecision`. */
export type DshPreStepDecision =
  | { readonly kind: "reject" }
  | {
      readonly kind: "enter";
      readonly messages: readonly unknown[];
      readonly startsRequestSeries?: true;
    };

export interface DshStepAgent {
  readonly session: { readonly header: { readonly origin?: "subagent" } };
}

/** The text the human typed into this step, joined; empty when no user message entered. */
export function humanText(messages: readonly DshStepMessage[]): string {
  return messages
    .filter((message) => message.source?.kind === "user")
    .flatMap((message) => message.content)
    .filter((block): block is DshTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export interface SkillDeps {
  readonly ask?: typeof askSkill;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The reminder message for this step, or `undefined`. Never throws. */
export async function skillMessage(
  agent: DshStepAgent,
  messages: readonly DshStepMessage[],
  deps: SkillDeps = {},
): Promise<DshUserMessage | undefined> {
  const env = deps.env ?? process.env;
  if (env.DSH_SKILL_ROUTER === "off") return undefined;
  if (agent.session.header.origin === "subagent") return undefined;
  const prompt = humanText(messages);
  if (!routable(prompt)) return undefined;
  try {
    const decision = await (deps.ask ?? askSkill)("dsh", prompt, { env });
    const reminder = skillReminder(decision, "dsh");
    return reminder === undefined ? undefined : pluginMessage(reminder);
  } catch {
    return undefined;
  }
}

/** The `agent/pre-step` listener: downstream first, then the reminder appended. */
export async function routeStep(
  payload: { readonly agent: DshStepAgent; readonly messages: readonly DshStepMessage[] },
  next: () => Promise<DshPreStepDecision>,
  deps: SkillDeps = {},
): Promise<DshPreStepDecision> {
  const downstream = await next();
  if (downstream.kind !== "enter" || payload.messages.length === 0) return downstream;
  const reminder = await skillMessage(payload.agent, payload.messages, deps);
  if (reminder === undefined) return downstream;
  return { ...downstream, messages: [...downstream.messages, reminder] };
}
