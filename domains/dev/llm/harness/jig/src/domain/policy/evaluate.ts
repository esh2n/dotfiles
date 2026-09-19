/**
 * Data-driven evaluation of the shared guard policy against one tool call.
 * Pure — no IO, dependency-free — same shape discipline as
 * `domain/hooks/decision.ts`, which now delegates here instead of embedding
 * its own rule list.
 */

import type { Decision, HookProfile, ToolCall } from "../hooks/decision";
import type { GuardRule, GuardTool } from "./types";

/**
 * Harness tool name -> abstract vocabulary a rule's `tools` field is written
 * against. Only the names jig's own hook and the rest of the harness family
 * actually produce are listed; anything else evaluates to "allow" (a rule
 * can only ever narrow what is allowed, never broaden it by omission).
 */
const TOOL_ALIASES: Readonly<Record<string, GuardTool>> = {
  Bash: "shell",
  bash: "shell",
  bash_background: "shell",
  Write: "write",
  write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  edit: "edit",
};

function abstractTool(toolName: string): GuardTool | undefined {
  return TOOL_ALIASES[toolName];
}

/**
 * The string a rule's `match` regex runs against: `input.command` for shell
 * rules, `input.file_path` for write/edit rules. Anything else (a wrong or
 * missing field) has nothing to match against, so it can only allow.
 */
function subjectFor(tool: GuardTool, input: Readonly<Record<string, unknown>>): string | undefined {
  const field = tool === "shell" ? input.command : input.file_path;
  return typeof field === "string" ? field : undefined;
}

/**
 * Evaluate a compiled rule set against one call under one profile. deny
 * always outranks confirm when both match (a rule can only make a call
 * stricter, never override a stricter sibling rule to be more permissive).
 */
export function evaluate(
  rules: readonly GuardRule[],
  call: ToolCall,
  profile: HookProfile,
): Decision {
  const tool = abstractTool(call.tool);
  if (tool === undefined) return { kind: "allow" };

  const subject = subjectFor(tool, call.input);
  if (subject === undefined) return { kind: "allow" };

  const matching = rules.filter(
    (rule) =>
      rule.tools.includes(tool) && rule.profiles.includes(profile) && rule.match.test(subject),
  );

  const deny = matching.find((rule) => rule.tier === "deny");
  if (deny !== undefined) return { kind: "deny", reason: deny.why };

  const confirm = matching.find((rule) => rule.tier === "confirm");
  if (confirm !== undefined) return { kind: "ask", reason: confirm.why };

  return { kind: "allow" };
}
