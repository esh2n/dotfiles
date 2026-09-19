import { runHook } from "../../app/hooks/run-hook";
import type { HookProfile, ToolCall } from "../../domain/hooks/decision";
import type { Ports } from "../../domain/ports";

interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

const PROFILES: readonly HookProfile[] = ["minimal", "standard", "strict"];

/**
 * JIG_HOOK_PROFILE is the name going forward; YOKI_HOOK_PROFILE is honored
 * while machines still export it. An unrecognized value falls back to
 * "standard" — never to a narrower profile.
 */
function resolveProfile(env: NodeJS.ProcessEnv): HookProfile {
  const raw = env.JIG_HOOK_PROFILE ?? env.YOKI_HOOK_PROFILE;
  return PROFILES.includes(raw as HookProfile) ? (raw as HookProfile) : "standard";
}

function hookOutput(decision: { kind: string; reason?: string }): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.kind,
      ...(decision.reason === undefined ? {} : { permissionDecisionReason: decision.reason }),
    },
  });
}

/**
 * Claude Code `PreToolUse` hook entrypoint. Reads the hook JSON, applies the
 * use-case, and returns the hook's decision JSON. Glue only — the composition
 * root passes in the ports, so this stays trivially testable.
 *
 * A guard rail fails closed: input this entrypoint cannot understand becomes
 * "ask", never "allow" — the human sees the call instead of it slipping
 * through — and never "deny", so a harness-side format change degrades to
 * prompting rather than bricking every tool call.
 */
export function preToolUse(stdin: string, ports: Pick<Ports, "logger">): string {
  const profile = resolveProfile(process.env);

  let payload: PreToolUsePayload;
  try {
    payload = JSON.parse(stdin) as PreToolUsePayload;
  } catch {
    return hookOutput({
      kind: "ask",
      reason: "jig: unparseable PreToolUse input, failing closed",
    });
  }

  if (typeof payload.tool_name !== "string" || payload.tool_name === "") {
    return hookOutput({
      kind: "ask",
      reason: "jig: PreToolUse input carries no tool_name, failing closed",
    });
  }

  const call: ToolCall = { tool: payload.tool_name, input: payload.tool_input ?? {} };
  const decision = runHook(call, profile, { logger: ports.logger });

  return hookOutput(
    decision.kind === "allow"
      ? { kind: "allow" }
      : { kind: decision.kind, reason: decision.reason },
  );
}
