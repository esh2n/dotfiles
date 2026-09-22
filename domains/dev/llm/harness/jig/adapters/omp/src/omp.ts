/**
 * The slice of omp's (oh-my-pi's) extension contract this adapter touches,
 * declared structurally rather than imported.
 *
 * Pinned to `@oh-my-pi/pi-coding-agent` 18.2.8 (upstream `main` as of
 * 2026-09-22; the machine this was written on runs the 18.0.4 Homebrew
 * build). Every field below was read off omp's own sources, not inferred:
 *
 *  - `packages/coding-agent/src/extensibility/extensions/types.ts`
 *    (`ExtensionContext`, `ExtensionUIContext.confirm`, the `ToolCallEvent`
 *     / `ToolResultEvent` unions, the `ExtensionAPI.on(...)` overloads)
 *  - `packages/coding-agent/src/extensibility/shared-events.ts`
 *    (`SessionStartEvent`, `SessionStopEvent`, `ToolCallEventResult`,
 *     `ToolResultEventResult`, `SessionStopEventResult`)
 *
 * Structural, like the DSH adapter's copy of dsh's `ToolExecution`: omp is
 * installed as a compiled binary here, there is no npm package on the box to
 * typecheck against, and a structural declaration keeps `bunx tsc --noEmit`
 * honest about exactly which fields are load-bearing. `package.json` carries
 * the real package as a peer dependency for anyone who does have it.
 */

/** `ExtensionUIContext`, the two members used. `confirm` exists in interactive
 *  and RPC modes and is a no-op-free round trip in both; under ACP it is
 *  bridged to an elicitation. In a headless run there is no UI at all, which
 *  is what `hasUI` reports. */
export interface OmpUi {
  confirm?(title: string, message: string): Promise<boolean>;
  notify?(message: string, level?: string): void;
}

/** `ReadonlySessionManager`, the one method read. */
export interface OmpSessionManager {
  getSessionId(): string;
  getSessionFile?(): string | undefined;
}

/** `ExtensionContext`. `model` is omp's `Model` object (`{id, provider, …}`);
 *  older builds and some bridges hand over a bare string, so both are
 *  accepted and unwrapped. */
export interface OmpContext {
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly ui?: OmpUi;
  readonly sessionManager?: OmpSessionManager;
  readonly model?: string | { readonly id?: string } | undefined;
}

/** `ToolCallEvent`: `{type, toolCallId, toolName, input}`. */
export interface OmpToolCallEvent {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
}

/** `ToolResultEvent`: the call's input plus its outcome. */
export interface OmpToolResultEvent {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly content?: unknown;
  readonly details?: unknown;
  readonly isError?: boolean;
}

/** `SessionStopEvent`. `stop_hook_active` is omp's own continuation flag; the
 *  gate keeps its own counter anyway (see `gate.ts`). */
export interface OmpSessionStopEvent {
  readonly session_id?: string;
  readonly session_file?: string;
  readonly turn_id?: number;
  readonly stop_hook_active?: boolean;
}

/**
 * `ToolCallEventResult`. There is no "ask" member: a handler either blocks
 * with a reason or stays silent. That is why `guard.ts` resolves an `ask`
 * through `ctx.ui.confirm` and blocks when there is no screen.
 */
export interface OmpToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
  readonly input?: Record<string, unknown>;
}

/** `ToolResultEventResult`. The formatter returns nothing — it stays silent. */
export interface OmpToolResultResult {
  readonly content?: unknown;
  readonly details?: unknown;
  readonly isError?: boolean;
}

/**
 * `SessionStopEventResult`. `{continue: true, additionalContext}` is the
 * advisory continuation (omp caps those at 8; this adapter stops at 2);
 * `{decision: "block", reason}` is the hard form, which does not consume
 * omp's budget and keeps blocking until a handler relents. The gate uses the
 * advisory form only — a lint failure is not a reason to make a session
 * un-endable.
 */
export interface OmpSessionStopResult {
  readonly continue?: boolean;
  readonly additionalContext?: string;
  readonly decision?: "block";
  readonly reason?: string;
}

type Handler<E, R> = (event: E, ctx: OmpContext) => Promise<R | undefined> | R | undefined;

/** `ExtensionAPI`, the four subscriptions this extension makes. */
export interface OmpExtensionApi {
  on(event: "session_start", handler: Handler<{ readonly type?: string }, void>): void;
  on(event: "tool_call", handler: Handler<OmpToolCallEvent, OmpToolCallResult>): void;
  on(event: "tool_result", handler: Handler<OmpToolResultEvent, OmpToolResultResult>): void;
  on(event: "session_stop", handler: Handler<OmpSessionStopEvent, OmpSessionStopResult>): void;
}

/** omp's `Model | string` unwrapped to the id jig records and audits. */
export function modelIdOf(model: OmpContext["model"]): string | undefined {
  if (typeof model === "string") return model === "" ? undefined : model;
  if (
    model !== null &&
    typeof model === "object" &&
    typeof model.id === "string" &&
    model.id !== ""
  ) {
    return model.id;
  }
  return undefined;
}
