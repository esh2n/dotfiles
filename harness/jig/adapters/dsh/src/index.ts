/**
 * DeepSeek Harness (dsh) connection to jig's guard, as a native cordis
 * plugin.
 *
 * dsh runs every tool call — bash, write, edit, str_replace_editor and every
 * MCP tool — through one waterfall, `tools/pre-execute`. This plugin sits on
 * that waterfall and does what every other jig adapter does: translate the
 * call into jig's vocabulary, stamp who is asking, hand it to the one
 * evaluator (`runHook`), and translate the answer back into dsh's typed
 * decision. It decides nothing itself.
 *
 * Why a plugin and not the `dsh-hooks-claude-code` bridge: the bridge
 * treats a crashed or slow hook as "no opinion" and lets the call through,
 * which contradicts jig's standing as infrastructure (no guard, no tool
 * call); it also strips the caller's identity and never sees MCP calls.
 * Here a thrown error becomes a failed tool call at dsh's own boundary
 * (dsh-tools wraps the waterfall in a catch that returns an error result),
 * and this plugin additionally converts every failure and timeout into an
 * explicit deny with a reason, because dsh has no timeout of its own.
 *
 * `ask` is returned as dsh's `ask`: dsh's approval service (composed by
 * dsh-base, `policy: ask` unless DSH_PERMISSION_MODE=danger-full-access)
 * prompts the user, and denies when nothing can prompt. Never an allow.
 *
 * The same plugin also routes skills (`agent/pre-step`, `./skill.ts`),
 * formats each written file (`tools/post-execute`, `./format.ts`) and gates
 * the end of a turn (`agent/turn-stopping`, `./gate.ts`), so DSH gets what
 * Claude Code, pi and omp get.
 *
 * Built with `bun build --target node` into `lib/index.js` (dsh loads plain
 * JS); jig's core and unbash are bundled in.
 */

import { readFile } from "node:fs/promises";
import {
  resolveAuditPath,
  resolvePolicyPath,
  resolveProfile,
} from "../../../src/app/hooks/environment";
import { loadGuardPolicy } from "../../../src/app/hooks/load-policy";
import { type LoadedPolicy, runHook } from "../../../src/app/hooks/run-hook";
import type { Decision, ToolCall } from "../../../src/domain/hooks/decision";
import type { Principal } from "../../../src/domain/policy/request";
import type { AuditLog, Logger } from "../../../src/domain/ports";
import { JsonlAuditLog } from "../../../src/infra/audit/jsonl-audit";
import { formatAfterExecute } from "./format";
import { type DshStoppingAgent, gateOnTurnStopping } from "./gate";
import {
  type DshPreStepDecision,
  type DshStepAgent,
  type DshStepMessage,
  routeStep,
} from "./skill";

// --- the slice of dsh's contract this plugin touches (structural, version 0.1.5-rc.2) ---

/** `ToolExecution` from @deepseek-ai/dsh-tools, the fields read here. */
export interface DshToolExecution {
  /** dsh's per-call id (ToolExecution.callId); stamped on the audit line. */
  readonly callId?: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: {
    readonly session: { readonly header: { readonly id: string; readonly cwd?: string } };
    readonly meta?: { readonly origin?: "subagent"; readonly parentSession?: string };
  };
  readonly signal?: AbortSignal;
}

/** `PreToolDecision` from @deepseek-ai/dsh-tools. */
export type DshPreToolDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason?: string };

/** `ToolExecutionResult` from @deepseek-ai/dsh-tools, the field read here. */
export interface DshToolExecutionResult {
  readonly isError: boolean;
}

/** `PostToolDecision` from @deepseek-ai/dsh-tools; passed through untouched. */
export type DshPostToolDecision = unknown;

/** The cordis context surface used: four event subscriptions. */
export interface DshContext {
  on(
    event: "tools/pre-execute",
    listener: (
      exec: DshToolExecution,
      next: () => Promise<DshPreToolDecision>,
    ) => Promise<DshPreToolDecision>,
  ): unknown;
  on(
    event: "tools/post-execute",
    listener: (
      exec: DshToolExecution,
      result: DshToolExecutionResult,
      next: () => Promise<DshPostToolDecision>,
    ) => Promise<DshPostToolDecision>,
  ): unknown;
  on(
    event: "agent/pre-step",
    listener: (
      payload: { readonly agent: DshStepAgent; readonly messages: readonly DshStepMessage[] },
      next: () => Promise<DshPreStepDecision>,
    ) => Promise<DshPreStepDecision>,
  ): unknown;
  on(
    event: "agent/turn-stopping",
    listener: (payload: { readonly agent: DshStoppingAgent }) => Promise<void>,
  ): unknown;
}

export interface GuardConfig {
  /** Above this the guard gives up and denies, rather than hanging dsh. */
  readonly timeoutMs?: number;
}

export const name = "jig-guard";
export const inject = ["tools"];

const DEFAULT_TIMEOUT_MS = 10_000;

// --- policy loading: cache only a successful load, so a transient failure retries ---

type Loaded = LoadedPolicy | { readonly error: string };
let cache: { readonly path: string; readonly loaded: LoadedPolicy } | undefined;

export async function loadPolicy(path: string): Promise<Loaded> {
  if (cache !== undefined && cache.path === path) return cache.loaded;
  try {
    const loaded = await loadGuardPolicy(path, (p) => readFile(p, "utf8"));
    cache = { path, loaded };
    return loaded;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const clock = { now: () => new Date() };

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`guard exceeded ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toolCallOf(exec: DshToolExecution): ToolCall {
  const input =
    typeof exec.arguments === "object" && exec.arguments !== null && !Array.isArray(exec.arguments)
      ? (exec.arguments as Record<string, unknown>)
      : {};
  return { tool: exec.name, input };
}

function principalOf(exec: DshToolExecution, env: NodeJS.ProcessEnv): Principal {
  const header = exec.agent?.session.header;
  const meta = exec.agent?.meta;
  return {
    harness: "dsh",
    profile: resolveProfile(env),
    ...(exec.callId === undefined ? {} : { callId: exec.callId }),
    ...(header?.id === undefined ? {} : { sessionId: header.id }),
    ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(meta?.origin === "subagent" && meta.parentSession !== undefined
      ? { parentSessionId: meta.parentSession }
      : {}),
    ...(env.DSH_PERMISSION_MODE === undefined ? {} : { permissionMode: env.DSH_PERMISSION_MODE }),
  };
}

export interface GuardDeps {
  readonly audit: AuditLog;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

/**
 * One tool call, judged. Exported so it can be exercised without dsh: the
 * cordis `apply` below only subscribes it.
 */
export async function guardExecution(
  exec: DshToolExecution,
  next: () => Promise<DshPreToolDecision>,
  deps: GuardDeps,
): Promise<DshPreToolDecision> {
  const env = deps.env ?? process.env;
  const path = resolvePolicyPath(env);
  const loaded = await loadPolicy(path);
  if ("error" in loaded) {
    return {
      kind: "deny",
      reason: `jig guard policy unreadable at ${path} (${loaded.error}); nothing runs until it is fixed`,
    };
  }

  let decision: Decision;
  try {
    decision = await withBudget(
      runHook(toolCallOf(exec), principalOf(exec, env), loaded, {
        logger: silentLogger,
        clock,
        audit: deps.audit,
      }),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "deny", reason: `jig guard failed (${message}); denying to stay safe` };
  }

  switch (decision.kind) {
    case "allow":
      return next();
    case "deny":
      return { kind: "deny", reason: decision.reason };
    case "ask":
      return { kind: "ask", reason: decision.reason };
  }
}

/**
 * cordis entry point: the skill router when a human's message enters a step,
 * the guard before every tool call, the formatter after every successful
 * write, and the typecheck/lint gate when a turn is about to close (`rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`). The
 * formatter and the gate never throw into DSH: a failure there is a skip.
 */
export function apply(ctx: DshContext, config: GuardConfig = {}): void {
  const audit = new JsonlAuditLog(resolveAuditPath(process.env));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  ctx.on("tools/pre-execute", (exec, next) => guardExecution(exec, next, { audit, timeoutMs }));
  ctx.on("tools/post-execute", async (exec, result, next) => {
    const cwd = exec.agent?.session.header.cwd ?? process.cwd();
    await formatAfterExecute(exec.name, exec.arguments, result.isError, cwd).catch(() => undefined);
    return next();
  });
  ctx.on("agent/pre-step", (payload, next) => routeStep(payload, next));
  ctx.on("agent/turn-stopping", async ({ agent }) => {
    await gateOnTurnStopping(agent).catch(() => undefined);
  });
}
