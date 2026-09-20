import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LoadedPolicy } from "../../../llm/harness/jig/src/app/hooks/run-hook";
import type { Decision, ToolCall } from "../../../llm/harness/jig/src/domain/hooks/decision";
import type { Principal } from "../../../llm/harness/jig/src/domain/policy/request";
import type { AuditLog, Logger } from "../../../llm/harness/jig/src/domain/ports";

// pi's connection to the shared guard.
//
// This file decides nothing. It reads pi's tool call, stamps who is asking,
// hands the call to jig's one evaluator (`runHook` → `judge`), and
// translates the decision into what pi understands: `{ block, reason }`
// for a deny, a `ctx.ui.confirm` dialog for an ask (a block when there is
// no screen), silence for an allow. The rules live in
// `domains/dev/llm/harness/policy/guard-rules.json`; the reading of a
// command (what actually runs, wrappers peeled, `$()` looked into) lives
// in jig's `domain/subject`. Both are imported here, not copied.
//
// How the import works: pi loads `~/.pi/agent/extensions/guard.ts`, a
// symlink into this repo, through jiti — which resolves relative imports
// against the symlink's directory, not the real one. So the jig tree is
// located from this file's real path at runtime and loaded with a dynamic
// import (jiti handles the TypeScript; `unbash` resolves from jig's own
// node_modules, so the main checkout needs `bun install` there). The
// static imports above are types only and vanish at load.
//
// pi has no permission layer of its own, so this extension is the only
// thing between the model and the shell. Three consequences:
//  - it never throws out of the handler (pi would still block, but with a
//    stack trace instead of a reason); every failure becomes a block with
//    a reason that says what to fix;
//  - it never returns an explicit allow — silence is "no opinion", the
//    same contract as the CLI hook Claude Code and DSH run;
//  - it keeps its own time budget, because pi has none: a guard that
//    hangs would hang the session.

type Environment = typeof import("../../../llm/harness/jig/src/app/hooks/environment");
type RunHook = typeof import("../../../llm/harness/jig/src/app/hooks/run-hook");
type Parse = typeof import("../../../llm/harness/jig/src/domain/policy/parse");
type Audit = typeof import("../../../llm/harness/jig/src/infra/audit/jsonl-audit");

interface Jig {
  readonly env: Environment;
  readonly hook: RunHook;
  readonly parse: Parse;
  readonly audit: Audit;
}

/** jig's source tree, found from where this file really lives. */
const JIG_SRC = join(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "..",
  "..",
  "..",
  "llm",
  "harness",
  "jig",
  "src",
);

let jigModules: Promise<Jig> | undefined;
function jig(): Promise<Jig> {
  jigModules ??= (async () => ({
    env: (await import(join(JIG_SRC, "app", "hooks", "environment.ts"))) as Environment,
    hook: (await import(join(JIG_SRC, "app", "hooks", "run-hook.ts"))) as RunHook,
    parse: (await import(join(JIG_SRC, "domain", "policy", "parse.ts"))) as Parse,
    audit: (await import(join(JIG_SRC, "infra", "audit", "jsonl-audit.ts"))) as Audit,
  }))();
  return jigModules;
}

/** Above this the guard gives up and blocks, rather than hanging pi. */
const TIME_BUDGET_MS = 5_000;

type Loaded = LoadedPolicy | { readonly error: string };

// Read once, at the first tool_call (not at module load — the env may not be
// settled yet). Only a SUCCESSFUL load is cached, for the rest of the
// process: a transient read/parse failure (the shared policy symlink
// briefly unreadable mid `manager.sh link`, say) must retry on the NEXT
// call rather than hard-blocking every bash call for the rest of the pi
// session — a cached error here would need a full pi restart to clear, a
// materially worse failure mode than the file being permanently missing.
let cache: { readonly path: string; readonly loaded: LoadedPolicy } | undefined;

export async function loadPolicy(path: string): Promise<Loaded> {
  if (cache !== undefined && cache.path === path) return cache.loaded;

  try {
    const { parse, hook } = await jig();
    const text = readFileSync(path, "utf8");
    const loaded: LoadedPolicy = {
      policy: parse.parsePolicy(JSON.parse(text)),
      hash: hook.policyHash(text),
    };
    cache = { path, loaded };
    return loaded;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** pi's TUI owns the terminal; the guard has nowhere to print, so it stays quiet. */
const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const clock = { now: () => new Date() };

let audit: AuditLog | undefined;
async function auditLog(): Promise<AuditLog> {
  const { audit: infra, env } = await jig();
  audit ??= new infra.JsonlAuditLog(env.resolveAuditPath(process.env));
  return audit;
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

const STAND_DOWN =
  "Do not retry this command or work around the block with a variant. " +
  "Explain to the user what you wanted to do and why, and let them decide.";

/** The subset of pi's extension context the guard reads; narrow so tests can fake it. */
export interface GuardContext {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly ui: { confirm(title: string, message: string): Promise<boolean> };
  readonly sessionManager?: { getSessionId(): string };
}

export interface GuardEvent {
  readonly toolName: string;
  readonly input: unknown;
}

export type GuardOutcome = { readonly block: true; readonly reason: string } | undefined;

/** What a tool call turns into for the audit line and the confirm dialog. */
function summary(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const record = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "url"]) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.join(" ");
  }
  return "";
}

/**
 * The whole adapter, as a function so it can be exercised without pi:
 * translate the call, ask jig, translate the answer.
 */
export interface GuardDeps {
  readonly audit?: AuditLog;
  readonly budgetMs?: number;
}

export async function guardToolCall(
  event: GuardEvent,
  ctx: GuardContext,
  deps: GuardDeps = {},
): Promise<GuardOutcome> {
  const { env, hook } = await jig();
  const path = env.resolvePolicyPath(process.env);
  const loaded = await loadPolicy(path);
  if ("error" in loaded) {
    return {
      block: true,
      reason:
        `jig guard policy unreadable at ${path} (${loaded.error}) — fix the link ` +
        "(manager.sh link_jig_policy) or set JIG_POLICY_FILE",
    };
  }

  const call: ToolCall = {
    tool: event.toolName,
    input:
      typeof event.input === "object" && event.input !== null
        ? (event.input as Record<string, unknown>)
        : {},
  };
  const principal: Principal = {
    harness: "pi",
    profile: env.resolveProfile(process.env),
    cwd: ctx.cwd,
    ...(ctx.sessionManager === undefined ? {} : { sessionId: ctx.sessionManager.getSessionId() }),
  };

  let decision: Decision;
  try {
    const audit = deps.audit ?? (await auditLog());
    decision = await withBudget(
      hook.runHook(call, principal, loaded, { logger: silentLogger, clock, audit }),
      deps.budgetMs ?? TIME_BUDGET_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      block: true,
      reason: `jig guard failed (${message}); blocking to stay safe. ${STAND_DOWN}`,
    };
  }

  switch (decision.kind) {
    case "allow":
      return undefined;
    case "deny":
      return {
        block: true,
        reason: `Blocked: ${decision.reason}. This is a hard rule — ${STAND_DOWN}`,
      };
    case "ask": {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `Blocked: ${decision.reason} (needs confirmation, and there is no screen to ask on). ${STAND_DOWN}`,
        };
      }
      let ok = false;
      try {
        ok = await ctx.ui.confirm(
          `Guarded command (${decision.reason})`,
          summary(event.input).slice(0, 300),
        );
      } catch {
        ok = false;
      }
      if (!ok) return { block: true, reason: `Blocked: ${decision.reason}. ${STAND_DOWN}` };
      return undefined; // user approved this one call — approval is not blanket
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    try {
      return await guardToolCall(
        { toolName: event.toolName, input: event.input },
        {
          hasUI: ctx.hasUI,
          cwd: ctx.cwd,
          ui: ctx.ui,
          sessionManager: ctx.sessionManager,
        },
      );
    } catch (err) {
      // Nothing above should throw; if something does, say so rather than
      // letting pi report a stack trace as the reason.
      const message = err instanceof Error ? err.message : String(err);
      return { block: true, reason: `jig guard crashed (${message}); blocking to stay safe.` };
    }
  });
}
