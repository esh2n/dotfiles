/**
 * Pure guard rules for a tool call. No IO — takes a call, who is asking and
 * the parsed shared guard policy, returns a judgment. This is the kind of
 * logic that lives in `domain`: deterministic, dependency-free, and
 * trivially testable with plain values.
 *
 * This is the one evaluator. Every harness adapter (pi's `guard.ts`, DSH's
 * hook bridge, Claude Code's PreToolUse hook, codex's hooks) translates its
 * own tool names and payloads into a `ToolCall`, calls `judge`, and
 * translates the decision back. None of them decides anything itself, so a
 * change to how a command is read — say, peeling `sudo` — is one edit here,
 * not four that drift.
 *
 * The rules themselves live in the data file
 * `domains/dev/llm/harness/policy/guard-rules.json`, parsed by
 * `domain/policy/parse.ts`. A v1 document is matched by
 * `domain/policy/evaluate.ts` (regex over the raw string); a v2 document by
 * `domain/policy/v2/evaluate.ts` (structured subject, floor, mode).
 */

import { evaluate } from "../policy/evaluate";
import type { Judgment } from "../policy/judgment";
import { type Principal, requestFor } from "../policy/request";
import type { Policy } from "../policy/types";
import { judgeV2 } from "../policy/v2/evaluate";

export type HookProfile = "minimal" | "standard" | "strict";

export type Decision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason: string };

export interface ToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Judge a tool call: the decision, and how it was reached. */
export function judge(call: ToolCall, principal: Principal, policy: Policy): Judgment {
  if (policy.version === 1) {
    const decision = evaluate(policy.rules, call, principal.profile);
    return { decision, source: decision.kind === "allow" ? "none" : "rule" };
  }
  const request = requestFor(call);
  if (request === undefined) return { decision: { kind: "allow" }, source: "out-of-scope" };
  return judgeV2(policy, request, principal);
}

/** Decide whether a tool call may proceed, per the shared guard policy. */
export function decide(call: ToolCall, profile: HookProfile, policy: Policy): Decision {
  return judge(call, { harness: "unknown", profile }, policy).decision;
}
