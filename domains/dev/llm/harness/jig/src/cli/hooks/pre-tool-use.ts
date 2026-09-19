import { homedir } from "node:os";
import { join } from "node:path";
import { runHook } from "../../app/hooks/run-hook";
import type { HookProfile, ToolCall } from "../../domain/hooks/decision";
import { parsePolicy } from "../../domain/policy/parse";
import type { GuardPolicy } from "../../domain/policy/types";
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

function defaultPolicyPath(): string {
  return join(homedir(), ".config", "jig", "policy", "guard-rules.json");
}

/** Where the shared guard policy is read from: JIG_POLICY_FILE, else the machine-linked default. */
function resolvePolicyPath(env: NodeJS.ProcessEnv): string {
  return env.JIG_POLICY_FILE ?? defaultPolicyPath();
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

type PolicyLoad =
  | { readonly kind: "ok"; readonly policy: GuardPolicy }
  | { readonly kind: "error"; readonly message: string };

// Cached by resolved path: the normal CLI invocation is one hook call per
// process, so this reads and parses the file exactly once; a test (or any
// caller) that changes JIG_POLICY_FILE between calls still gets a fresh
// load, because the cache key includes the path.
let cache: { readonly path: string; readonly result: PolicyLoad } | undefined;

async function loadPolicy(path: string, fs: Ports["fs"]): Promise<PolicyLoad> {
  if (cache !== undefined && cache.path === path) return cache.result;

  let result: PolicyLoad;
  try {
    const text = await fs.read(path);
    result = { kind: "ok", policy: parsePolicy(JSON.parse(text)) };
  } catch (error) {
    result = { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }

  cache = { path, result };
  return result;
}

/**
 * Claude Code `PreToolUse` hook entrypoint. Reads the hook JSON, loads the
 * shared guard policy, applies the use-case, and returns the hook's decision
 * JSON. This is the composition root for the policy file: the path
 * (`JIG_POLICY_FILE`, else `~/.config/jig/policy/guard-rules.json`) is
 * resolved and the file loaded here, not deeper in the call graph.
 *
 * Two independent guard rails fail closed, never allow:
 *  - input this entrypoint cannot understand (unparseable JSON, no
 *    tool_name) becomes "ask" — the human sees the call instead of it
 *    slipping through — and never "deny", so a harness-side format change
 *    degrades to prompting rather than bricking every tool call.
 *  - a policy file that is missing or fails to parse ALSO becomes "ask",
 *    naming the path and the error, for the same reason: a broken policy
 *    link must never silently become "allow everything".
 */
export async function preToolUse(
  stdin: string,
  ports: Pick<Ports, "logger" | "fs">,
): Promise<string> {
  const profile = resolveProfile(process.env);
  const policyPath = resolvePolicyPath(process.env);

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

  const loaded = await loadPolicy(policyPath, ports.fs);
  if (loaded.kind === "error") {
    return hookOutput({
      kind: "ask",
      reason: `jig: guard policy unreadable at ${policyPath} (${loaded.message}), failing closed`,
    });
  }

  const call: ToolCall = { tool: payload.tool_name, input: payload.tool_input ?? {} };
  const decision = runHook(call, profile, loaded.policy, { logger: ports.logger });

  return hookOutput(
    decision.kind === "allow"
      ? { kind: "allow" }
      : { kind: decision.kind, reason: decision.reason },
  );
}
