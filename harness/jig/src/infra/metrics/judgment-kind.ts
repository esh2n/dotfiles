/**
 * Which endpoint a judgment belongs to, available to code that runs *inside* a
 * request but was built before it.
 *
 * The provider is composed once per process, and its `onUsage` hook is the only
 * place the model's token counts surface — but the hook cannot know whether the
 * tokens it is reporting were spent on a tier question, a compaction question or
 * a caller's own question. Token counts without that label answer "how much did
 * the service cost", not "what did it cost *for*", which is the question that
 * decides whether routing or compaction judgment is worth keeping on.
 *
 * `AsyncLocalStorage` is the mechanism, not a hand-rolled module variable: two
 * harnesses can call the service at the same time, and a variable holding "the
 * current kind" would attribute one request's tokens to the other's endpoint.
 * The store follows the async call chain, so the hook reads the kind of the
 * request that actually caused the call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type JudgmentKind = "decide" | "tier" | "compact" | "skill";

const storage = new AsyncLocalStorage<JudgmentKind>();

/** Run `work` with every judgment it makes attributed to `kind`. */
export function runWithJudgmentKind<T>(kind: JudgmentKind, work: () => Promise<T>): Promise<T> {
  return storage.run(kind, work);
}

/**
 * The kind of the judgment being made right now, or `undefined` when the call did
 * not come from a request (the CLI's own path) — the caller decides what to label
 * that, rather than this module inventing a name for it.
 */
export function currentJudgmentKind(): JudgmentKind | undefined {
  return storage.getStore();
}
