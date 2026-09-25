/**
 * omp's connection to the shared guard.
 *
 * This file decides nothing. It reads omp's tool call, translates it into
 * jig's vocabulary (`map.ts`), stamps who is asking, hands each resulting
 * call to jig's one evaluator (`runHook` → `judge`), and translates the
 * verdict into what omp understands.
 *
 * What omp understands is narrow. A `tool_call` handler returns
 * `{block, reason, input}` — there is no "ask" (`ToolCallEventResult` in
 * `extensibility/shared-events.ts`). But `ExtensionContext.ui.confirm(title,
 * message)` does exist in interactive, RPC and ACP modes
 * (`ExtensionUIContext` in `extensibility/extensions/types.ts`), so an `ask`
 * is resolved the way pi's guard resolves it: a confirm dialog when there is
 * a screen, a block with the reason when there is not. An ask NEVER becomes
 * a silent allow.
 *
 * omp has no OS sandbox and no trust gate of its own ("This pattern policy …
 * is not process or filesystem containment"; "Extensions are not sandboxed
 * (same process/runtime)"), and its `bash.patterns` list covers the `bash`
 * tool alone. So this handler is the only thing between the model and the
 * machine, which fixes three properties:
 *
 *  - it never throws out of the handler (omp fails a thrown `tool_call`
 *    handler closed, but reports a stack trace as the reason); every failure
 *    becomes a block whose reason says what to fix;
 *  - it never returns an explicit allow — silence is "no opinion", the same
 *    contract every other jig adapter keeps;
 *  - it keeps its own time budget, because omp imposes none on an in-process
 *    handler; a guard that hangs would hang the session.
 */

import { readFileSync } from "node:fs";
import type { LoadedPolicy } from "../../../src/app/hooks/run-hook";
import type { Decision, ToolCall } from "../../../src/domain/hooks/decision";
import type { Principal } from "../../../src/domain/policy/request";
import type { AuditLog, Logger } from "../../../src/domain/ports";
import { jig } from "./jig";
import { mapToolCall } from "./map";
import { type OmpContext, type OmpToolCallEvent, type OmpToolCallResult, modelIdOf } from "./omp";

/** Above this the guard gives up and blocks, rather than hanging omp. */
const TIME_BUDGET_MS = 5_000;

const STAND_DOWN =
  "Do not retry this command or work around the block with a variant. " +
  "Explain to the user what you wanted to do and why, and let them decide.";

/** omp's TUI owns the terminal; the guard has nowhere to print, so it stays quiet. */
const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const clock = { now: () => new Date() };

type Loaded = LoadedPolicy | { readonly error: string };

// Only a SUCCESSFUL load is cached, and only for as long as the path holds:
// a transient read failure (the policy symlink briefly gone during
// `manager.sh link`) must retry on the next call rather than hard-block
// every tool call until omp restarts.
let cache: { readonly path: string; readonly loaded: LoadedPolicy } | undefined;

export async function loadPolicy(path: string): Promise<Loaded> {
  if (cache !== undefined && cache.path === path) return cache.loaded;
  try {
    const { load } = await jig();
    const loaded = await load.loadGuardPolicy(path, async (p) => readFileSync(p, "utf8"));
    cache = { path, loaded };
    return loaded;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

let auditLog: AuditLog | undefined;
async function defaultAudit(env: NodeJS.ProcessEnv): Promise<AuditLog> {
  const { audit, env: environment } = await jig();
  auditLog ??= new audit.JsonlAuditLog(environment.resolveAuditPath(env));
  return auditLog;
}

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

const RANK: Readonly<Record<Decision["kind"], number>> = { allow: 0, ask: 1, deny: 2 };

/** What a tool call turns into for the confirm dialog. */
function summary(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const value = input as Record<string, unknown>;
  for (const key of ["command", "code", "path", "file_path", "url", "input"]) {
    const field = value[key];
    if (typeof field === "string") return field;
    if (Array.isArray(field)) return field.join(" ");
  }
  return "";
}

export interface GuardDeps {
  readonly audit?: AuditLog;
  readonly budgetMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Sanitized MCP server names, for splitting `mcp__<server>_<tool>`. */
  readonly mcpServers?: readonly string[];
}

function block(reason: string): OmpToolCallResult {
  return { block: true, reason };
}

/**
 * One omp tool call, judged. Exported so it can be exercised without omp:
 * `index.ts` only subscribes it.
 */
export async function guardToolCall(
  event: OmpToolCallEvent,
  ctx: OmpContext,
  deps: GuardDeps = {},
): Promise<OmpToolCallResult | undefined> {
  const env = deps.env ?? process.env;
  const mapping = mapToolCall(event.toolName, event.input, {
    ...(deps.mcpServers === undefined ? {} : { mcpServers: deps.mcpServers }),
  });
  if (mapping.kind === "out-of-scope") return undefined;
  if (mapping.kind === "unreadable") {
    return block(
      `Blocked: ${event.toolName} could not be read by the jig guard (${mapping.reason}); ` +
        `blocking to stay safe. ${STAND_DOWN}`,
    );
  }

  let core: Awaited<ReturnType<typeof jig>>;
  try {
    core = await jig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return block(
      `Blocked: the jig guard could not be loaded (${message}); nothing runs until it is fixed. ${STAND_DOWN}`,
    );
  }

  const path = core.env.resolvePolicyPath(env);
  const loaded = await loadPolicy(path);
  if ("error" in loaded) {
    return block(
      `Blocked: jig guard policy unreadable at ${path} (${loaded.error}) — fix the link ` +
        `(manager.sh link_jig_policy) or set JIG_POLICY_FILE. ${STAND_DOWN}`,
    );
  }

  const model = modelIdOf(ctx.model);
  const principal: Principal = {
    harness: "omp",
    profile: core.env.resolveProfile(env),
    cwd: ctx.cwd,
    ...(ctx.sessionManager === undefined ? {} : { sessionId: ctx.sessionManager.getSessionId() }),
    ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
    ...(model === undefined ? {} : { model }),
  };

  let worst: Decision = { kind: "allow" };
  try {
    const audit = deps.audit ?? (await defaultAudit(env));
    // Every call is judged, not just up to the first deny: an edit that
    // touches four files should leave four audit lines saying so.
    for (const call of mapping.calls as readonly ToolCall[]) {
      const decision = await withBudget(
        core.hook.runHook(call, principal, loaded, { logger: silentLogger, clock, audit }),
        deps.budgetMs ?? TIME_BUDGET_MS,
      );
      if (RANK[decision.kind] > RANK[worst.kind]) worst = decision;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return block(`Blocked: jig guard failed (${message}); blocking to stay safe. ${STAND_DOWN}`);
  }

  switch (worst.kind) {
    case "allow":
      return undefined;
    case "deny":
      return block(`Blocked: ${worst.reason}. This is a hard rule — ${STAND_DOWN}`);
    case "ask": {
      const confirm = ctx.ui?.confirm;
      if (!ctx.hasUI || confirm === undefined) {
        return block(
          `Blocked: ${worst.reason} (needs confirmation, and there is no screen to ask on). ${STAND_DOWN}`,
        );
      }
      let ok = false;
      try {
        ok = await confirm.call(
          ctx.ui,
          `Guarded call (${worst.reason})`,
          summary(event.input).slice(0, 300),
        );
      } catch {
        ok = false;
      }
      // The user approved this one call; approval is not blanket.
      return ok ? undefined : block(`Blocked: ${worst.reason}. ${STAND_DOWN}`);
    }
  }
}
