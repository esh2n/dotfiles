/**
 * Application use-case for the compaction endpoint.
 *
 * Which items of a context are worth keeping is a judgment, and a judgment is
 * jig's job: a harness posts the items it is about to summarize and gets back a
 * decision per item. The pinning rules, the batch question, and the confidence
 * threshold stay in `app/compaction/compact.ts` — nothing about "how cautious to
 * be" is a caller's parameter, so two harnesses cannot end up with two different
 * policies for the same question.
 *
 * The safe fallback is *keep*: a weak judgment never drops context.
 */

import type { DecisionProvider } from "../../domain/decision/provider";
import type { Clock, Logger } from "../../domain/ports";
import { type CompactOptions, type CompactionResult, type Item, compact } from "./compact";

export type AnswerCompactionResult =
  | { readonly ok: true; readonly result: CompactionResult }
  | {
      readonly ok: false;
      readonly kind: "bad-request" | "provider-error";
      readonly message: string;
    };

function readItem(value: unknown, index: number): Item {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`items[${index}] must be an object`);
  }
  const record = value as { id?: unknown; summary?: unknown; pinned?: unknown };
  if (typeof record.id !== "string" || record.id.trim() === "") {
    throw new Error(`items[${index}].id must be a non-empty string`);
  }
  if (typeof record.summary !== "string") {
    throw new Error(`items[${index}].summary must be a string`);
  }
  if (record.pinned !== undefined && typeof record.pinned !== "boolean") {
    throw new Error(`items[${index}].pinned must be a boolean when present`);
  }
  return {
    id: record.id,
    summary: record.summary,
    ...(record.pinned === undefined ? {} : { pinned: record.pinned }),
  };
}

function itemsOf(body: unknown): readonly Item[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("body must be an object with an `items` array");
  }
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("`items` must be an array");
  if (items.length === 0) throw new Error("`items` is empty — there is nothing to judge");
  return items.map(readItem);
}

export interface AnswerCompactionDeps {
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly options?: CompactOptions;
}

/** Answer "which of these items does a compaction keep?" without throwing. */
export async function answerCompaction(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerCompactionDeps = {},
): Promise<AnswerCompactionResult> {
  let items: readonly Item[];
  try {
    items = itemsOf(body);
  } catch (error) {
    return {
      ok: false,
      kind: "bad-request",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = deps.clock?.now().getTime();
  try {
    const result = await compact(items, provider, deps.options ?? {});
    const endedAt = deps.clock?.now().getTime();
    const kept = result.decisions.filter((decision) => decision.kept).length;
    deps.logger?.debug("compaction.decided", {
      items: result.decisions.length,
      kept,
      dropped: result.decisions.length - kept,
      ...(startedAt === undefined || endedAt === undefined
        ? {}
        : { durationMs: endedAt - startedAt }),
    });
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("compaction.failed", { reason: message });
    return { ok: false, kind: "provider-error", message };
  }
}
