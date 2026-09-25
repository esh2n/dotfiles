/**
 * The session model record, omp's half.
 *
 * jig writes one line per session start to `sessions.jsonl` so that a later
 * judgment can say which model asked (`domain/hooks/session.ts`). On Claude
 * Code that line comes from `jig hooks session-start`, a separate process
 * reading a `SessionStart` payload; omp carries the same facts on the
 * extension context instead (`ctx.sessionManager.getSessionId()`,
 * `ctx.model`) because `SessionStartEvent` itself is `{type}` and nothing
 * else (`extensibility/shared-events.ts`).
 *
 * The record shape is the one the CLI hook writes, field for field, so the
 * lookup by session id works for omp sessions without knowing they are omp
 * sessions. `source` is `"startup"`: omp fires `session_start` "on initial
 * session load" and reports a resume or a fork through `session_switch`
 * instead, so this event is always a start.
 *
 * It never fails loudly. A session must start whether or not jig managed to
 * note it down; the cost of a lost line is a judgment that does not know the
 * model, which is the state everything was in before the record existed.
 */

import type { SessionRecord } from "../../../src/domain/hooks/session";
import { jig } from "./jig";
import { type OmpContext, modelIdOf } from "./omp";

export interface SessionDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  /** Where the line goes; the real sessions.jsonl appender by default. */
  readonly record?: (entry: SessionRecord) => Promise<void>;
}

/** The record this session would write, or `undefined` when it cannot say who it is. */
export function sessionRecordOf(ctx: OmpContext, now: Date): SessionRecord | undefined {
  const sessionId = ctx.sessionManager?.getSessionId();
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  const model = modelIdOf(ctx.model);
  return {
    session_id: sessionId,
    // Absent, not empty: a line with no `model` key is a session that
    // declined to say, which is what `latestModel` skips over.
    ...(model === undefined ? {} : { model }),
    harness: "omp",
    recorded_at: now.toISOString(),
    source: "startup",
  };
}

/** Note this session's model down. Returns what was written, for tests. */
export async function recordSession(
  ctx: OmpContext,
  deps: SessionDeps = {},
): Promise<SessionRecord | undefined> {
  const entry = sessionRecordOf(ctx, (deps.now ?? (() => new Date()))());
  if (entry === undefined) return undefined;
  try {
    if (deps.record !== undefined) {
      await deps.record(entry);
      return entry;
    }
    const core = await jig();
    const env = deps.env ?? process.env;
    await core.sessions.appendSessionLog(core.env.resolveSessionsPath(env), entry);
    return entry;
  } catch {
    return undefined;
  }
}
