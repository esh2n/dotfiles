/**
 * jig's omp (oh-my-pi) extension: the five hooks
 * `rules/decisions/2026-09-22-hooks-five-events.md` allows, one per event.
 *
 *   tool_call          → the guard (`guard.ts`), the enforcement point
 *   session_start      → the session's model, recorded (`session.ts`)
 *   before_agent_start → the tier judgment: which LiteLLM tier this prompt
 *                        needs, and the model switch (`tier.ts`) — omp's
 *                        prompt-submit event; the same judgment pi runs
 *   tool_result        → format the edited file, silently (`format.ts`)
 *   session_stop       → typecheck/lint once, capped (`gate.ts`)
 *
 * Skill selection at prompt submit stays Claude Code's (the decision names
 * it there); the prompt-submit slot here carries the tier router instead.
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
import { createTierRouter } from "./tier";

export { guardToolCall } from "./guard";
export { activeSelector, askTier, createTierRouter, onProxyTier, readDecision, routeTo } from "./tier";
export { formatOnResult, formatPlanFor, formatterFor, projectRoot } from "./format";
export {
  MAX_CONTINUATIONS,
  gateCommandFor,
  gateOnStop,
  gatePlanFor,
  resetGate,
  tail,
} from "./gate";
export { canonicalMcpName, editedPaths, hashlineOperations, mapToolCall } from "./map";
export { recordSession, sessionRecordOf } from "./session";

export default function (pi: OmpExtensionApi): void {
  const tier = createTierRouter();
  pi.on("session_start", async (_event, ctx) => {
    await recordSession(ctx);
    try {
      await tier.onSessionStart(ctx);
    } catch (error) {
      console.error(`tier-router: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      await tier.onPrompt(event, ctx);
    } catch (error) {
      // Routing that fails keeps the current model; it never touches the turn.
      console.error(`tier-router: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  });
  pi.registerCommand?.("tier", {
    description: "Model routing: /tier [auto|off|main|complex|deterministic]",
    handler: (args, ctx) => tier.onCommand(args, ctx),
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
