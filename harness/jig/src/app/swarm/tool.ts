/**
 * The `swarm` tool the parent model calls — its description, its parameter
 * schema (plain JSON Schema, which omp takes as is and pi wraps in TypeBox),
 * and what each action does. Both adapters register exactly this; only the
 * registration call differs.
 *
 * Model-facing text is English (rules/decisions/2026-09-23-model-facing-english.md).
 */

import { TIERS, type Tier } from "../../domain/swarm/types";
import type { Swarm } from "./swarm";

export const SWARM_TOOL_NAME = "swarm";

export const SWARM_TOOL_DESCRIPTION = [
  "When to use: two or more independent pieces of work that can run side by side (a worker each). For a single piece of work, use the harness's own subagent tool if it has one (omp: task); where it has none, a batch of one worker is fine.",
  "It runs the workers in the background and you keep talking with the user meanwhile.",
  "action=start: give `items`, each {name, task, tier?, effort?, files?, isolated?}. It returns at once; the results of one start arrive together as one message when all of them have finished (at once if one fails).",
  "Give each worker a self-contained task (it sees nothing of this conversation) and the `files` it may write (paths or globs). Workers whose files overlap never run at the same time; a worker with no `files` is treated as touching everything, so it runs alone among writers.",
  "tier: main (everyday, default: this session's tier), complex (harder reasoning), deterministic (carrying out a plan already designed; one at a time).",
  "isolated=true puts the worker in its own git worktree (.claude/worktrees/<name>, branch <name>); it commits there and the owner decides whether to merge. Use it only when workers must change the same files.",
  "action=status: see every worker. action=results: read finished workers' answers. action=cancel: stop workers by `names` (all when omitted).",
].join(" ");

export const SWARM_TOOL_PARAMETERS = {
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
          tier: { type: "string", enum: [...TIERS] },
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

export interface SwarmToolParams {
  readonly action?: unknown;
  readonly items?: unknown;
  readonly names?: unknown;
}

function names(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
}

/** Runs one call; `ok: false` is a refusal the model can correct. */
export function runSwarmTool(
  swarm: Swarm,
  params: SwarmToolParams,
  sessionTier: Tier,
): { readonly ok: boolean; readonly text: string } {
  switch (params.action) {
    case "start": {
      const r = swarm.start(params.items, sessionTier);
      return r.ok
        ? { ok: true, text: r.text }
        : { ok: false, text: `swarm start refused: ${r.error}` };
    }
    case "status":
      return { ok: true, text: swarm.status() };
    case "results":
      return { ok: true, text: swarm.results(names(params.names)) };
    case "cancel":
      return { ok: true, text: swarm.cancel(names(params.names)) };
    default:
      return { ok: false, text: 'action must be one of "start", "status", "results", "cancel"' };
  }
}

/** The session's tier from the tier router's variable or the active proxy model. */
export function sessionTier(envTier: string | undefined, modelId: string | undefined): Tier {
  if (envTier !== undefined && (TIERS as readonly string[]).includes(envTier))
    return envTier as Tier;
  if (modelId !== undefined && (TIERS as readonly string[]).includes(modelId))
    return modelId as Tier;
  return "main";
}
