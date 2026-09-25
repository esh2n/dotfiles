/**
 * The user message a plugin hands DSH — to `agent.steer` (the gate) or into a
 * step's admitted messages (the skill router). Built structurally, the same
 * fields `createUserMessage` in @deepseek-ai/dsh-llm produces, because the
 * plugin bundles jig's core and does not import DSH's packages.
 */

import { randomUUID } from "node:crypto";

export interface DshTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface DshUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly DshTextBlock[];
  readonly source: { readonly kind: "plugin"; readonly plugin: string };
}

/** The plugin id DSH shows as the source of what jig adds. */
export const PLUGIN_ID = "jig-guard";

export function pluginMessage(text: string): DshUserMessage {
  const message: DshUserMessage = {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: PLUGIN_ID },
  };
  return Object.freeze(message);
}
