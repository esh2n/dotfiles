import { runHook } from "../../app/hooks/run-hook";
import type { HookProfile, ToolCall } from "../../domain/hooks/decision";
import type { Ports } from "../../domain/ports";

interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/**
 * Claude Code `PreToolUse` hook entrypoint. Reads the hook JSON, applies the
 * use-case, and returns the hook's decision JSON. Glue only — the composition
 * root passes in the ports, so this stays trivially testable.
 */
export function preToolUse(stdin: string, ports: Ports): string {
  const profile = (process.env.YOKI_HOOK_PROFILE as HookProfile | undefined) ?? "standard";

  let payload: PreToolUsePayload;
  try {
    payload = JSON.parse(stdin) as PreToolUsePayload;
  } catch {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  }

  const call: ToolCall = { tool: payload.tool_name ?? "", input: payload.tool_input ?? {} };
  const decision = runHook(call, profile, { logger: ports.logger });

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.kind,
      ...(decision.kind === "allow" ? {} : { permissionDecisionReason: decision.reason }),
    },
  });
}
