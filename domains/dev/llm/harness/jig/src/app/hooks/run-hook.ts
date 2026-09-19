import {
  type Decision,
  type HookProfile,
  type ToolCall,
  decide,
} from "../../domain/hooks/decision";
import type { GuardPolicy } from "../../domain/policy/types";
import type { Logger } from "../../domain/ports";

export interface RunHookDeps {
  readonly logger: Logger;
}

/**
 * Application use-case: apply the shared guard policy to a tool call and
 * record the outcome. Depends only on the `Logger` port and pure domain
 * logic — no IO of its own — so it is tested with a fake logger and plain
 * values.
 */
export function runHook(
  call: ToolCall,
  profile: HookProfile,
  policy: GuardPolicy,
  deps: RunHookDeps,
): Decision {
  const decision = decide(call, profile, policy);
  deps.logger.debug("hook.decision", {
    tool: call.tool,
    profile,
    decision: decision.kind,
  });
  return decision;
}
