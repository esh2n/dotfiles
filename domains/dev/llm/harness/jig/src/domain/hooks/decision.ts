/**
 * Pure guard rules for a tool call. No IO — takes a call and a profile, returns
 * a decision. This is the kind of logic that lives in `domain`: deterministic,
 * dependency-free, and trivially testable with plain values.
 */

export type HookProfile = "minimal" | "standard" | "strict";

export type Decision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason: string };

export interface ToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const ALLOW: Decision = { kind: "allow" };

function bashCommand(call: ToolCall): string | undefined {
  if (call.tool !== "Bash") return undefined;
  const command = call.input.command;
  return typeof command === "string" ? command : undefined;
}

/**
 * Decide whether a tool call may proceed. Rules escalate with the profile:
 * - always: block force-push (never cleanly recoverable),
 * - standard and above: ask before `rm -rf`,
 * - strict: ask before `sudo`.
 *
 * A deliberately small ruleset — the point of the skeleton is the shape, not
 * the full policy. New rules stay pure functions here.
 */
export function decide(call: ToolCall, profile: HookProfile): Decision {
  const command = bashCommand(call);
  if (command === undefined) return ALLOW;

  if (/\bgit\s+push\b/.test(command) && /(--force|\s-f\b)/.test(command)) {
    return { kind: "deny", reason: "force push is never allowed" };
  }

  if (profile !== "minimal" && /\brm\s+-rf\b/.test(command)) {
    return { kind: "ask", reason: "rm -rf requires confirmation" };
  }

  if (profile === "strict" && /\bsudo\b/.test(command)) {
    return { kind: "ask", reason: "sudo under strict profile requires confirmation" };
  }

  return ALLOW;
}
