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
 * `domain/policy/parse.ts` and matched by `domain/policy/evaluate.ts`
 * (structured subject, floor, mode).
 */

import { applyPatchText, fanOut } from "../policy/apply-patch";
import { evaluatePolicy } from "../policy/evaluate";
import type { Judgment } from "../policy/judgment";
import { type Principal, requestFor } from "../policy/request";
import type { Policy } from "../policy/types";

export type HookProfile = "minimal" | "standard" | "strict";

export type Decision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason: string };

export interface ToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const RANK: Readonly<Record<Decision["kind"], number>> = { allow: 0, ask: 1, deny: 2 };

function judgeOne(call: ToolCall, principal: Principal, policy: Policy): Judgment {
  const request = requestFor(call);
  if (request === undefined) return { decision: { kind: "allow" }, source: "out-of-scope" };
  return evaluatePolicy(policy, request, principal);
}

/**
 * Judge a tool call: the decision, and how it was reached. codex's
 * `apply_patch` is judged per file it touches (see `../policy/apply-patch`),
 * the strictest verdict winning; a patch that names no file is left alone.
 */
export function judge(call: ToolCall, principal: Principal, policy: Policy): Judgment {
  const patch = applyPatchText(call);
  if (patch === undefined) return judgeOne(call, principal, policy);

  const calls = fanOut(patch);
  if (calls.length === 0) return { decision: { kind: "allow" }, source: "out-of-scope" };
  let worst: Judgment | undefined;
  const touched: string[] = [];
  for (const part of calls) {
    const judgment = judgeOne(part, principal, policy);
    touched.push(...(judgment.subject ?? []));
    if (worst === undefined || RANK[judgment.decision.kind] > RANK[worst.decision.kind]) {
      worst = judgment;
    }
  }
  return worst === undefined
    ? { decision: { kind: "allow" }, source: "out-of-scope" }
    : { ...worst, action: "fs.write", subject: [...new Set(touched)] };
}

/** Decide whether a tool call may proceed, per the shared guard policy. */
export function decide(call: ToolCall, profile: HookProfile, policy: Policy): Decision {
  return judge(call, { harness: "unknown", profile }, policy).decision;
}
