/**
 * The Swarm in omp: the `swarm` tool, the table below the editor, delivery of
 * finished batches, and stopping every worker when the session ends. All the
 * work is jig's shared Swarm (`src/app/swarm/`), reached through `jig.ts`'s
 * runtime import like the rest of this adapter; this file is only omp's
 * registration calls (rules/decisions/2026-09-27-swarm-extension.md).
 *
 * The tool's description and schema must be known when omp loads the
 * extension, before the runtime import has run, so they are copied here
 * from `src/app/swarm/tool.ts`; `test/adapters/omp/swarm.test.ts` fails when
 * the copy and the original differ.
 *
 * Not registered inside a worker (`JIG_SWARM_WORKER`), so a worker never
 * starts workers of its own. A worker instead adds its tag
 * (`JIG_SWARM_TAG`) to every proxy request, so the parent can read the
 * worker's cost from LiteLLM's spend log (src/domain/swarm/spend.ts).
 */

import type { Swarm } from "../../../src/app/swarm/swarm";
import { jig } from "./jig";
import { type OmpContext, type OmpExtensionApi, modelIdOf } from "./omp";

const WIDGET_KEY = "jig-swarm";
export const WORKER_ENV = "JIG_SWARM_WORKER";
/** Copy of `SPEND_TAG_ENV` (src/domain/swarm/spend.ts). */
export const SPEND_TAG_ENV = "JIG_SWARM_TAG";

/** `proxy` requests only: the tag is LiteLLM's field and means nothing to another provider. */
function onProxy(model: OmpContext["model"]): boolean {
  return typeof model === "object" && model !== null && model.provider === "proxy";
}

/** In a worker: tag every proxy request with the worker's own tag. */
function tagRequests(pi: OmpExtensionApi, tag: string): void {
  pi.on("before_provider_request", async (event, ctx) => {
    if (!onProxy(ctx.model)) return undefined;
    const core = await jig();
    return core.swarmSession.withSpendTag(event.payload, tag);
  });
}

/** Copy of `SWARM_TOOL_DESCRIPTION` (src/app/swarm/tool.ts). */
export const DESCRIPTION = [
  "When to use: two or more independent pieces of work that can run side by side (a worker each). For a single piece of work, use the harness's own subagent tool if it has one (omp: task); where it has none, a batch of one worker is fine.",
  "It runs the workers in the background and you keep talking with the user meanwhile.",
  "action=start: give `items`, each {name, task, tier?, effort?, files?, isolated?}. It returns at once; the results of one start arrive together as one message when all of them have finished (at once if one fails).",
  "Give each worker a self-contained task (it sees nothing of this conversation) and the `files` it may write (paths or globs). Workers whose files overlap never run at the same time; a worker with no `files` is treated as touching everything, so it runs alone among writers.",
  "tier: main (everyday, default: this session's tier), complex (harder reasoning), deterministic (carrying out a plan already designed; one at a time).",
  "isolated=true puts the worker in its own git worktree (.claude/worktrees/<name>, branch <name>); it commits there and the owner decides whether to merge. Use it only when workers must change the same files.",
  "action=status: see every worker. action=results: read finished workers' answers. action=cancel: stop workers by `names` (all when omitted).",
].join(" ");

/** Copy of `SWARM_TOOL_PARAMETERS` (src/app/swarm/tool.ts); omp takes plain JSON Schema. */
export const PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["start", "status", "results", "cancel"] },
    items: {
      type: "array",
      description: "For start: the workers to run.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "lowercase-hyphen name, unique in this session" },
          task: {
            type: "string",
            description: "the complete, self-contained instruction for the worker",
          },
          tier: { type: "string", enum: ["main", "complex", "deterministic"] },
          effort: {
            type: "string",
            enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "paths or globs the worker may write",
          },
          isolated: { type: "boolean" },
        },
        required: ["name", "task"],
      },
    },
    names: {
      type: "array",
      items: { type: "string" },
      description: "For results and cancel: which workers.",
    },
  },
  required: ["action"],
} as const;

export function registerSwarm(pi: OmpExtensionApi, env: NodeJS.ProcessEnv = process.env): void {
  if (env[WORKER_ENV] === "1") {
    const tag = env[SPEND_TAG_ENV];
    if (tag !== undefined && tag !== "") tagRequests(pi, tag);
    return;
  }
  if (pi.registerTool === undefined) return;
  let swarm: Swarm | undefined;
  let widgetShown = false;

  const ensure = async (ctx: OmpContext): Promise<Swarm> => {
    if (swarm !== undefined) return swarm;
    const core = await jig();
    swarm = await core.swarmSession.createSwarmSession({
      harness: "omp",
      cwd: ctx.cwd,
      sessionId: ctx.sessionManager?.getSessionId() ?? `omp-${process.pid}`,
      env,
      onChange: () => {},
      onDeliver: (message) =>
        pi.sendMessage?.(
          { customType: "swarm", content: message, display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
    });
    await swarm.removeMergedWorktrees().catch(() => []);
    return swarm;
  };

  pi.registerTool({
    name: "swarm",
    label: "Swarm",
    description: DESCRIPTION,
    parameters: PARAMETERS,
    loadMode: "essential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const core = await jig();
        const live = await ensure(ctx);
        const tier = core.swarmTool.sessionTier(env.OMP_TIER, modelIdOf(ctx.model));
        const result = core.swarmTool.runSwarmTool(live, params, tier);
        if (!widgetShown && ctx.hasUI && ctx.ui?.setWidget !== undefined) {
          ctx.ui.setWidget(
            WIDGET_KEY,
            core.swarmWidget.swarmWidget(() => live.current),
            { placement: "belowEditor" },
          );
          widgetShown = true;
        }
        return { content: [{ type: "text", text: result.text }], isError: !result.ok };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `swarm failed: ${message}` }], isError: true };
      }
    },
  });

  pi.on("session_shutdown", () => {
    swarm?.shutdown();
  });
}
