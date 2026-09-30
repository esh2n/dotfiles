import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// swarm — run worker agents in the background and show them below the editor.
//
// Ruling: rules/decisions/2026-09-27-swarm-extension.md (the one exception to
// "no custom execution engine"). All of the work is jig's shared Swarm
// (`harness/jig/src/app/swarm/`), the same
// code omp's adapter runs; this file is pi's registration and nothing else.
//
// jig is loaded the way guard.ts loads it: pi reads this file through a
// symlink and jiti resolves relative imports against the link's directory,
// so the jig tree is found from this file's real path and imported
// dynamically. The static imports above are pi's own (aliased by its loader).
//
// A worker is a pi of its own (`pi --mode json`) and loads these extensions
// too; `JIG_SWARM_WORKER=1` in its environment keeps it from registering
// `swarm`, so workers never start workers. A worker instead adds its tag
// (`JIG_SWARM_TAG`) to every proxy request, so the parent can read the
// worker's cost from LiteLLM's spend log (harness/jig/src/domain/swarm/spend.ts).

type Session = typeof import("../../../../../harness/jig/src/infra/swarm/session");
type Tool = typeof import("../../../../../harness/jig/src/app/swarm/tool");
type Widget = typeof import("../../../../../harness/jig/src/app/swarm/widget");
type SwarmType = import("../../../../../harness/jig/src/app/swarm/swarm").Swarm;

const JIG_SRC = join(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "..",
  "..",
  "..",
  "..",
  "..",
  "harness",
  "jig",
  "src",
);

interface Jig {
  readonly session: Session;
  readonly tool: Tool;
  readonly widget: Widget;
}

let jigModules: Promise<Jig> | undefined;
function jig(): Promise<Jig> {
  jigModules ??= (async () => ({
    session: (await import(join(JIG_SRC, "infra", "swarm", "session.ts"))) as Session,
    tool: (await import(join(JIG_SRC, "app", "swarm", "tool.ts"))) as Tool,
    widget: (await import(join(JIG_SRC, "app", "swarm", "widget.ts"))) as Widget,
  }))();
  return jigModules;
}

const WIDGET_KEY = "jig-swarm";

/** The `swarm` tool's parameters — the same schema as jig's `SWARM_TOOL_PARAMETERS`, in pi's TypeBox. */
const PARAMETERS = Type.Object({
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("status"),
    Type.Literal("results"),
    Type.Literal("cancel"),
  ]),
  items: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "lowercase-hyphen name, unique in this session" }),
        task: Type.String({
          description: "the complete, self-contained instruction for the worker",
        }),
        tier: Type.Optional(
          Type.Union([
            Type.Literal("main"),
            Type.Literal("complex"),
            Type.Literal("deterministic"),
          ]),
        ),
        effort: Type.Optional(
          Type.Union(
            ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) =>
              Type.Literal(level),
            ),
          ),
        ),
        files: Type.Optional(
          Type.Array(Type.String(), { description: "paths or globs the worker may write" }),
        ),
        isolated: Type.Optional(Type.Boolean()),
      }),
      { description: "For start: the workers to run." },
    ),
  ),
  names: Type.Optional(
    Type.Array(Type.String(), { description: "For results and cancel: which workers." }),
  ),
});

export default function (pi: ExtensionAPI) {
  if (process.env.JIG_SWARM_WORKER === "1") {
    const tag = process.env.JIG_SWARM_TAG;
    if (tag === undefined || tag === "") return;
    // proxy requests only: the tag is LiteLLM's field and means nothing to another provider
    pi.on("before_provider_request", async (event, ctx) => {
      if (ctx.model?.provider !== "proxy") return undefined;
      const { session } = await jig();
      return session.withSpendTag(event.payload, tag);
    });
    return;
  }
  let swarm: SwarmType | undefined;
  let widgetShown = false;

  async function ensure(ctx: ExtensionContext): Promise<SwarmType> {
    if (swarm !== undefined) return swarm;
    const { session } = await jig();
    swarm = await session.createSwarmSession({
      harness: "pi",
      cwd: ctx.cwd,
      sessionId: ctx.sessionManager.getSessionId(),
      env: process.env,
      onChange: () => {},
      onDeliver: (message) =>
        pi.sendMessage(
          { customType: "swarm", content: message, display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
    });
    await swarm.removeMergedWorktrees().catch(() => []);
    return swarm;
  }

  async function showTable(ctx: ExtensionContext, live: SwarmType): Promise<void> {
    if (widgetShown || !ctx.hasUI || ctx.mode !== "tui") return;
    const { widget } = await jig();
    ctx.ui.setWidget(
      WIDGET_KEY,
      widget.swarmWidget(() => live.current),
      { placement: "belowEditor" },
    );
    widgetShown = true;
  }

  pi.registerTool({
    name: "swarm",
    label: "Swarm",
    // jig's SWARM_TOOL_DESCRIPTION cannot be imported statically here (see
    // above); this is the same text, and harness/jig/test/adapters/omp/swarm.test.ts
    // fails when the two differ.
    description: [
      "When to use: two or more independent pieces of work that can run side by side (a worker each). For a single piece of work, use the harness's own subagent tool if it has one (omp: task); where it has none, a batch of one worker is fine.",
      "It runs the workers in the background and you keep talking with the user meanwhile.",
      "action=start: give `items`, each {name, task, tier?, effort?, files?, isolated?}. It returns at once; the results of one start arrive together as one message when all of them have finished (at once if one fails).",
      "Give each worker a self-contained task (it sees nothing of this conversation) and the `files` it may write (paths or globs). Workers whose files overlap never run at the same time; a worker with no `files` is treated as touching everything, so it runs alone among writers.",
      "tier: main (everyday, default: this session's tier), complex (harder reasoning), deterministic (carrying out a plan already designed; one at a time).",
      "isolated=true puts the worker in its own git worktree (.claude/worktrees/<name>, branch <name>); it commits there and the owner decides whether to merge. Use it only when workers must change the same files.",
      "action=status: see every worker. action=results: read finished workers' answers. action=cancel: stop workers by `names` (all when omitted).",
    ].join(" "),
    parameters: PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { tool } = await jig();
      const live = await ensure(ctx);
      const tier = tool.sessionTier(
        process.env.PI_TIER,
        ctx.model?.provider === "proxy" ? ctx.model.id : undefined,
      );
      const result = tool.runSwarmTool(live, params, tier);
      await showTable(ctx, live);
      // pi marks a failed tool call by a throw, not a flag
      if (!result.ok) throw new Error(result.text);
      return { content: [{ type: "text", text: result.text }], details: undefined };
    },
  });

  pi.on("session_shutdown", () => {
    swarm?.shutdown();
  });
}
