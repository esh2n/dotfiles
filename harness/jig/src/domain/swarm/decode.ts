/**
 * Reading a worker's `--mode json` stream. pi (v0.87.1) and omp (v18.3.4)
 * write the same event names for what the Swarm needs, so one decoder serves
 * both (sources: pi docs/json.md, `ai/src/types.ts`; omp
 * `modes/print-mode.ts`, `catalog/src/types.ts`):
 *
 *   turn_start                   a model turn began
 *   tool_execution_start         a tool call (`toolName`)
 *   message_end{message}         a finished message; for the assistant it
 *                                carries `usage` (tokens and `cost.total`),
 *                                `stopReason` and `errorMessage`, and its
 *                                text content blocks
 *
 * Usage is taken only from `message_end`: pi also repeats a running `usage`
 * on every `message_update`, and counting both would double it.
 *
 * Each assistant `message_end` also says how the run stands: an `error` or
 * `aborted` stop is a failure, anything else clears an earlier one (a retry
 * that succeeded). The Swarm keeps the last such verdict; pi exits 0 even
 * after a model error in JSON mode, so the verdict, not the exit code, is
 * what tells.
 */

import type { WorkerProgress } from "./state";
import type { Usage } from "./types";

export type DecodedEvent =
  | { readonly kind: "progress"; readonly progress: WorkerProgress }
  | { readonly kind: "end"; readonly error?: string; readonly text?: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageOf(value: unknown): Usage | undefined {
  const u = record(value);
  if (u === undefined) return undefined;
  const cost = record(u.cost);
  const total = cost === undefined ? undefined : cost.total;
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: typeof total === "number" && Number.isFinite(total) ? total : undefined,
  };
}

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((block) => record(block))
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b?.text as string);
  return parts.length === 0 ? undefined : parts.join("");
}

function assistantEnd(message: Record<string, unknown>): DecodedEvent[] {
  const usage = usageOf(message.usage);
  const text = textOf(message.content);
  const out: DecodedEvent[] = [];
  const progress: WorkerProgress = {
    ...(usage === undefined ? {} : { usage }),
    ...(text === undefined || text === "" ? {} : { text }),
  };
  if (Object.keys(progress).length > 0) out.push({ kind: "progress", progress });
  const stop = message.stopReason;
  if (stop === "error" || stop === "aborted") {
    const why =
      typeof message.errorMessage === "string" && message.errorMessage !== ""
        ? message.errorMessage
        : `model stopped: ${stop}`;
    out.push({ kind: "end", error: why });
  } else if (stop !== "toolUse") {
    out.push({ kind: "end", ...(text === undefined || text === "" ? {} : { text }) });
  }
  return out;
}

/** One stdout line → what it changes. Anything else, or a line that is not JSON, changes nothing. */
export function decodeWorkerLine(line: string): readonly DecodedEvent[] {
  let event: Record<string, unknown> | undefined;
  try {
    event = record(JSON.parse(line));
  } catch {
    return [];
  }
  if (event === undefined) return [];
  switch (event.type) {
    case "turn_start":
      return [{ kind: "progress", progress: { turn: true } }];
    case "tool_execution_start":
      return [{ kind: "progress", progress: { toolCall: true } }];
    case "message_end": {
      const message = record(event.message);
      return message?.role === "assistant" ? assistantEnd(message) : [];
    }
    case "auto_retry_end":
      return event.success === false
        ? [
            {
              kind: "end",
              error: typeof event.finalError === "string" ? event.finalError : "retries exhausted",
            },
          ]
        : [];
    default:
      return [];
  }
}
