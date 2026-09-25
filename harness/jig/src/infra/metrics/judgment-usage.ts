/**
 * What one request spent, available to the code that answers it.
 *
 * Same problem and same mechanism as `judgment-kind.ts`: the provider is composed once per
 * process and its `onUsage` hook is the only place the model's token counts surface, but the
 * code that writes a request's log line runs in the request and cannot reach a callback
 * built before the request existed. A module variable would attribute one harness's tokens
 * to another's line whenever two calls overlap, so the store follows the async call chain
 * instead.
 *
 * This is the only path by which a router log line can carry cost: the harness-side hook
 * decides through `/decide`, whose wire contract returns a `Decided` and no usage, so a
 * `usage` field exists on `/skill` lines and nowhere else.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { JevUsage } from "../decision/jev-provider";

const storage = new AsyncLocalStorage<JevUsage[]>();

/**
 * Run `work` collecting every usage report the judgments inside it produce.
 *
 * Summed rather than kept apart: one request is one log line, and a provider that had to
 * split a batch across calls still spent those tokens on this one judgment. The model name
 * is the first one reported — a request is answered by one model, and a differing second
 * would be a provider bug this function is not the place to hide.
 */
export async function collectJudgmentUsage<T>(
  work: () => Promise<T>,
): Promise<{ readonly result: T; readonly usage: JevUsage | undefined }> {
  const collected: JevUsage[] = [];
  const result = await storage.run(collected, work);
  const first = collected[0];
  if (first === undefined) return { result, usage: undefined };
  return {
    result,
    usage: {
      model: first.model,
      input_tokens: collected.reduce((total, one) => total + one.input_tokens, 0),
      output_tokens: collected.reduce((total, one) => total + one.output_tokens, 0),
    },
  };
}

/**
 * Report one judgment's usage to whichever request is in flight. A call made outside a
 * request (the CLI's own path) is dropped: there is no line for it to land on.
 */
export function recordJudgmentUsage(usage: JevUsage): void {
  storage.getStore()?.push(usage);
}
