/**
 * Pure guard rules for a tool call. No IO — takes a call, a profile and the
 * parsed shared guard policy, returns a decision. This is the kind of logic
 * that lives in `domain`: deterministic, dependency-free, and trivially
 * testable with plain values.
 *
 * The rules themselves are no longer embedded here: they live in the data
 * file `domains/dev/llm/harness/policy/guard-rules.json`, parsed by
 * `domain/policy/parse.ts` and matched by `domain/policy/evaluate.ts`. This
 * module stays the stable import surface (`HookProfile`, `Decision`,
 * `ToolCall`, `decide`) that the rest of the app/cli layers depend on.
 */

import { evaluate } from "../policy/evaluate";
import type { GuardPolicy } from "../policy/types";

export type HookProfile = "minimal" | "standard" | "strict";

export type Decision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason: string };

export interface ToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Decide whether a tool call may proceed, per the shared guard policy. */
export function decide(call: ToolCall, profile: HookProfile, policy: GuardPolicy): Decision {
  return evaluate(policy.rules, call, profile);
}
