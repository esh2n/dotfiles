import { homedir } from "node:os";
import { join } from "node:path";
import { type LoadedPolicy, policyHash, runHook } from "../../app/hooks/run-hook";
import type { HookProfile, ToolCall } from "../../domain/hooks/decision";
import { parsePolicy } from "../../domain/policy/parse";
import type { Principal } from "../../domain/policy/request";
import type { Ports } from "../../domain/ports";

interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
}

/** What the adapter knows about who is calling that the payload does not say. */
export interface PreToolUseOptions {
  /**
   * The harness name stamped on every judgment (`claude`, `dsh`, …). No
   * harness sends it, and DSH's bridge speaks Claude Code's payload format,
   * so the registration passes it (`--harness dsh`); `JIG_HARNESS` is the
   * environment form. Defaults to `claude`, the format's native speaker.
   */
  readonly harness?: string;
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
  | { readonly kind: "ok"; readonly loaded: LoadedPolicy }
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
    result = {
      kind: "ok",
      loaded: { policy: parsePolicy(JSON.parse(text)), hash: policyHash(text) },
    };
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
 *
 * When the policy loads fine and simply has no matching rule, this returns
 * the empty string — NOT an explicit `permissionDecision: "allow"`. In
 * Claude Code's PreToolUse contract an explicit "allow" skips the default
 * permission PROMPT for the call (settings.json deny/ask permission RULES
 * are still evaluated, and a blocking hook still beats an allow rule) —
 * so "allow" would silence the prompt the user relies on for calls no rule
 * covers. Staying silent means "no opinion" and lets the permission system
 * run exactly as it would with no hook at all: its rules AND its prompt.
 * Same precedent as
 * domains/dev/config/claude-profiles/personal/hooks/git-guard.sh (see its
 * comment near the "Release WITHOUT a permissionDecision" note).
 */
export async function preToolUse(
  stdin: string,
  ports: Pick<Ports, "logger" | "fs" | "clock"> & { readonly audit?: Ports["audit"] },
  options: PreToolUseOptions = {},
): Promise<string> {
  const profile = resolveProfile(process.env);
  const policyPath = resolvePolicyPath(process.env);
  const harness = options.harness ?? process.env.JIG_HARNESS ?? "claude";

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
  const principal: Principal = {
    harness,
    profile,
    ...(typeof payload.session_id === "string" ? { sessionId: payload.session_id } : {}),
    ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}),
    ...(typeof payload.permission_mode === "string"
      ? { permissionMode: payload.permission_mode }
      : {}),
  };
  const decision = await runHook(call, principal, loaded.loaded, {
    logger: ports.logger,
    clock: ports.clock,
    ...(ports.audit === undefined ? {} : { audit: ports.audit }),
  });

  // No matching rule: stay silent toward the permission system rather than
  // emitting an explicit "allow" (see the doc comment above).
  if (decision.kind === "allow") return "";

  return hookOutput({ kind: decision.kind, reason: decision.reason });
}
