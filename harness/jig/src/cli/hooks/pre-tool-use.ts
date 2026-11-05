import { createHash } from "node:crypto";
import {
  resolvePolicyPath,
  resolveProfile,
  resolveSessionsPath,
} from "../../app/hooks/environment";
import { loadGuardPolicy } from "../../app/hooks/load-policy";
import { type LoadedPolicy, runHook } from "../../app/hooks/run-hook";
import { sessionModel } from "../../app/hooks/session-model";
import type { ToolCall } from "../../domain/hooks/decision";
import {
  judgeReplyLanguage,
  replyLanguageRule,
  toolCallLanguageReason,
} from "../../domain/hooks/reply-language";
import { passageBeforeToolCall } from "../../domain/hooks/turn-texts";
import type { Principal } from "../../domain/policy/request";
import type { Ports } from "../../domain/ports";

interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
  /** Claude Code and codex both name the per-call id `tool_use_id`. */
  tool_use_id?: string;
  transcript_path?: unknown;
  /** Set when the call comes from a subagent (https://code.claude.com/docs/en/hooks, common input fields). */
  agent_id?: unknown;
}

/** Harnesses whose hook protocol carries an `ask`; every other one gets a deny instead. */
const CAN_ASK: ReadonlySet<string> = new Set(["claude", "dsh"]);

/** What the adapter knows about who is calling that the payload does not say. */
export interface PreToolUseOptions {
  /**
   * The harness name stamped on every judgment (`claude`, `dsh`, …). No
   * harness sends it, and DSH's bridge speaks Claude Code's payload format,
   * so the registration passes it (`--harness dsh`); `JIG_HARNESS` is the
   * environment form. Defaults to `claude`, the format's native speaker.
   */
  readonly harness?: string;
  /** The reply-language check (`2026-11-05-reply-language-check-on-pre-tool-use.md`); absent, it does not run. */
  readonly replyLanguage?: ToolCallLanguageDeps;
}

export interface ToolCallLanguageDeps {
  /** Claude Code's `language` setting; absent or unsupported, the check does not run. */
  readonly setting: () => Promise<unknown>;
  /** The transcript's last bytes: the check only needs what follows the last tool result. */
  readonly readTranscriptTail: (path: string) => Promise<string>;
  /** Records a denied passage's key and answers whether it was new, so each passage is denied once. */
  readonly claimDenial: (key: string) => Promise<boolean>;
}

/**
 * The reason to deny this call because the passage written just before it is off-language,
 * or `undefined`. A subagent's call is never judged: its text is not shown to the owner, and
 * `transcript_path` names the parent session's transcript.
 */
async function replyLanguageDenial(
  payload: PreToolUsePayload,
  deps: ToolCallLanguageDeps,
): Promise<string | undefined> {
  if (payload.agent_id !== undefined) return undefined;
  const path = payload.transcript_path;
  if (typeof path !== "string" || path === "") return undefined;
  const rule = replyLanguageRule(await deps.setting());
  if (rule === undefined) return undefined;
  const passage = passageBeforeToolCall(await deps.readTranscriptTail(path));
  if (passage === undefined || judgeReplyLanguage(passage, rule) !== "off-language") {
    return undefined;
  }
  const key = createHash("sha256")
    .update(`${payload.session_id ?? ""}\n${passage.trim()}`)
    .digest("hex")
    .slice(0, 32);
  return (await deps.claimDenial(key)) ? toolCallLanguageReason(rule, passage) : undefined;
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
    result = { kind: "ok", loaded: await loadGuardPolicy(path, (p) => fs.read(p)) };
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
 *
 * `rules/decisions/2026-11-05-reply-language-check-on-pre-tool-use.md` adds one check
 * after the guard: a call the guard lets through is denied, once per passage, when the
 * text the model wrote since its last tool result is mostly not in the language Claude
 * Code's `language` setting asks for.
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
  // The session's model is not on this payload and cannot be: Claude Code
  // sends `model` only with `SessionStart` (see the doc quote in
  // `domain/hooks/session.ts`). `jig hooks session-start` wrote it down; this
  // looks it up by session id. The lookup cannot fail loudly — an absent or
  // unreadable log just leaves the model unknown, exactly as before it existed.
  const model =
    typeof payload.session_id === "string"
      ? await sessionModel(payload.session_id, {
          fs: ports.fs,
          path: resolveSessionsPath(process.env),
        })
      : undefined;
  const principal: Principal = {
    harness,
    profile,
    ...(typeof payload.session_id === "string" ? { sessionId: payload.session_id } : {}),
    ...(model === undefined ? {} : { model }),
    ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}),
    ...(typeof payload.permission_mode === "string"
      ? { permissionMode: payload.permission_mode }
      : {}),
    ...(typeof payload.tool_use_id === "string" ? { callId: payload.tool_use_id } : {}),
  };
  const decision = await runHook(call, principal, loaded.loaded, {
    logger: ports.logger,
    clock: ports.clock,
    ...(ports.audit === undefined ? {} : { audit: ports.audit }),
  });

  // No matching rule: stay silent toward the permission system rather than
  // emitting an explicit "allow" (see the doc comment above). Only a call the
  // guard lets through is checked for the passage before it, so the guard's own
  // deny and ask always stand; a failure of the check lets the call through.
  if (decision.kind === "allow") {
    if (options.replyLanguage === undefined) return "";
    let reason: string | undefined;
    try {
      reason = await replyLanguageDenial(payload, options.replyLanguage);
    } catch (error) {
      ports.logger.debug("guard.reply-language-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return reason === undefined ? "" : hookOutput({ kind: "deny", reason });
  }

  // codex has no "ask": its dispatcher rejects the value and, worse, treats
  // the rejection as a hook failure and lets the call through. A question
  // it cannot ask becomes a refusal it can act on — never an allow.
  if (decision.kind === "ask" && !CAN_ASK.has(harness)) {
    return hookOutput({
      kind: "deny",
      reason: `${decision.reason} (needs confirmation, which ${harness} cannot ask for)`,
    });
  }

  return hookOutput({ kind: decision.kind, reason: decision.reason });
}
