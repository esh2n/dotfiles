/**
 * One audit line per judgment. Append-only jsonl, one object per line, so
 * that "what stopped this, under which rules?" can be answered afterwards
 * from the record instead of reconstructed from memory.
 *
 * Distinct from `/metrics` on purpose: metrics aggregate (how many denies
 * this hour), the audit log is the evidence (this call, this rule, this
 * policy hash). The policy hash is the sha256 of the file as loaded, so a
 * past judgment can be re-run against the exact rules that produced it
 * even after the file has changed.
 */

import type { Judgment } from "./judgment";
import type { Principal } from "./request";

export interface AuditEntry {
  /** ISO-8601, from the clock port. */
  readonly ts: string;
  readonly principal: Principal;
  /** The harness's tool name as received. */
  readonly tool: string;
  readonly action?: string;
  readonly subject?: readonly string[];
  readonly decision: "allow" | "deny" | "ask";
  readonly reason?: string;
  readonly rule?: string;
  readonly source: Judgment["source"];
  readonly policy: { readonly version: 1 | 2; readonly hash: string };
  readonly extraction?: { readonly kind: string; readonly detail?: string };
}

export interface AuditContext {
  readonly ts: string;
  readonly principal: Principal;
  readonly tool: string;
  readonly policy: { readonly version: 1 | 2; readonly hash: string };
}

/** Build the line for one judgment. Pure. */
export function auditEntryFor(judgment: Judgment, context: AuditContext): AuditEntry {
  const { decision } = judgment;
  return {
    ts: context.ts,
    principal: context.principal,
    tool: context.tool,
    ...(judgment.action === undefined ? {} : { action: judgment.action }),
    ...(judgment.subject === undefined ? {} : { subject: judgment.subject }),
    decision: decision.kind,
    ...(decision.kind === "allow" ? {} : { reason: decision.reason }),
    ...(judgment.ruleId === undefined ? {} : { rule: judgment.ruleId }),
    source: judgment.source,
    policy: context.policy,
    ...(judgment.extraction === undefined ? {} : { extraction: judgment.extraction }),
  };
}
