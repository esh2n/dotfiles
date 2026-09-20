import { createHash } from "node:crypto";
import { type Decision, type ToolCall, judge } from "../../domain/hooks/decision";
import { auditEntryFor } from "../../domain/policy/audit";
import type { Principal } from "../../domain/policy/request";
import type { Policy } from "../../domain/policy/types";
import type { AuditLog, Clock, Logger } from "../../domain/ports";

export interface RunHookDeps {
  readonly logger: Logger;
  readonly clock: Clock;
  /** Optional so a caller with nowhere to write (tests, dry runs) still gets a decision. */
  readonly audit?: AuditLog;
}

/** The policy as loaded, with the hash of the text it was parsed from. */
export interface LoadedPolicy {
  readonly policy: Policy;
  readonly hash: string;
}

/** sha256 of the policy text, twelve hex characters: enough to tell versions apart in a log. */
export function policyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Application use-case: apply the shared guard policy to a tool call and
 * record the outcome. Depends only on ports and pure domain logic — no IO
 * of its own — so it is tested with fakes and plain values.
 *
 * The audit append is awaited but never allowed to change the decision: a
 * log that cannot be written is logged as an error and the decision stands.
 * The record is evidence, not a gate.
 */
export async function runHook(
  call: ToolCall,
  principal: Principal,
  loaded: LoadedPolicy,
  deps: RunHookDeps,
): Promise<Decision> {
  const judgment = judge(call, principal, loaded.policy);
  deps.logger.debug("hook.decision", {
    tool: call.tool,
    profile: principal.profile,
    harness: principal.harness,
    decision: judgment.decision.kind,
    source: judgment.source,
    ...(judgment.ruleId === undefined ? {} : { rule: judgment.ruleId }),
  });
  if (deps.audit !== undefined) {
    const entry = auditEntryFor(judgment, {
      ts: deps.clock.now().toISOString(),
      principal,
      tool: call.tool,
      policy: { version: loaded.policy.version, hash: loaded.hash },
    });
    try {
      await deps.audit.append(entry);
    } catch (error) {
      deps.logger.error("hook.audit.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return judgment.decision;
}
