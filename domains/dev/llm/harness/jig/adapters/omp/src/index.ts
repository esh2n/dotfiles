/**
 * jig's omp (oh-my-pi) extension: four of the five hooks
 * `rules/decisions/2026-09-22-hooks-five-events.md` allows, one per event.
 *
 *   tool_call     → the guard (`guard.ts`), the enforcement point
 *   session_start → the session's model, recorded (`session.ts`)
 *   tool_result   → format the edited file, silently (`format.ts`)
 *   session_stop  → typecheck/lint once, capped (`gate.ts`)
 *
 * The fifth, skill selection at prompt submit, is not omp's to run from here:
 * omp has no UserPromptSubmit-shaped event that jig's router is wired to, and
 * the decision names Claude Code for it. No router lives here either — the
 * same decision retired it.
 *
 * Every handler swallows its own failures. Extensions run in omp's own
 * process with no isolation, and a throw out of a `tool_call` handler blocks
 * the call with a stack trace as its reason; a throw out of the others is
 * caught by the runner but still noise. So the guard turns a crash into a
 * block whose reason says what broke, and the other three turn a crash into
 * silence.
 */

import { formatOnResult } from "./format";
import { gateOnStop } from "./gate";
import { type GuardDeps, guardToolCall } from "./guard";
import { resolveMcpServers } from "./mcp-servers";
import type { OmpExtensionApi } from "./omp";
import { recordSession } from "./session";

export { guardToolCall } from "./guard";
export { formatOnResult, formatterFor, projectRoot } from "./format";
export { MAX_CONTINUATIONS, gateCommandFor, gateOnStop, resetGate, tail } from "./gate";
export { canonicalMcpName, editedPaths, hashlineOperations, mapToolCall } from "./map";
export { recordSession, sessionRecordOf } from "./session";

export default function (pi: OmpExtensionApi): void {
  pi.on("session_start", async (_event, ctx) => {
    await recordSession(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    try {
      const deps: GuardDeps = { mcpServers: resolveMcpServers(process.env, ctx.cwd) };
      return await guardToolCall(event, ctx, deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { block: true, reason: `jig guard crashed (${message}); blocking to stay safe.` };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      await formatOnResult(event, ctx.cwd);
    } catch {
      // A formatter is never a reason to interrupt anyone.
    }
    return undefined;
  });

  pi.on("session_stop", async (event, ctx) => {
    try {
      return await gateOnStop(event, ctx);
    } catch {
      // A gate that cannot run lets the session settle.
      return undefined;
    }
  });
}
