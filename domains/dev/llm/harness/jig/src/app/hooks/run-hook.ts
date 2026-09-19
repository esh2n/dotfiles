import {
  type Decision,
  decide,
  type HookProfile,
  type ToolCall,
} from "../../domain/hooks/decision";
import type { Logger } from "../../domain/ports";

export interface RunHookDeps {
  readonly logger: Logger;
}

/**
 * Application use-case: apply the guard rules to a tool call and record the
 * outcome. Depends only on the `Logger` port and pure domain logic — no IO of
 * its own — so it is tested with a fake logger and plain values.
 */
export function runHook(call: ToolCall, profile: HookProfile, deps: RunHookDeps): Decision {
  const decision = decide(call, profile);
  deps.logger.debug("hook.decision", {
    tool: call.tool,
    profile,
    decision: decision.kind,
  });
  return decision;
}
