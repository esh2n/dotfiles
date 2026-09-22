import type { SessionRecord } from "../../domain/hooks/session";
import type { Clock, Logger } from "../../domain/ports";

/**
 * The SessionStart payload, as far as this hook reads it. Every field is
 * `unknown` and checked: the shape is the harness's, not jig's, and a hook
 * that must never block a session cannot afford to trust it.
 */
interface SessionStartPayload {
  readonly session_id?: unknown;
  readonly model?: unknown;
  readonly source?: unknown;
  readonly cwd?: unknown;
}

export interface SessionStartDeps {
  readonly record: (entry: SessionRecord) => Promise<void>;
  readonly clock: Clock;
  readonly logger?: Logger;
  /**
   * Who is calling, from the wrapper that invoked the hook (`--harness claude`,
   * else `JIG_HARNESS`). Defaults to `claude`, the format's native speaker —
   * the same default and the same reasoning as the `PreToolUse` adapter.
   */
  readonly harness?: string;
  readonly env?: Record<string, string | undefined>;
}

/**
 * Claude Code `SessionStart` hook entrypoint: write down which model this
 * session runs on, so that a later `PreToolUse` call can find out.
 *
 * Why this hook has to exist at all — per
 * https://code.claude.com/docs/en/hooks.md ("Common input fields"): "Only
 * `SessionStart` hooks can receive a `model` field, and Claude Code doesn't
 * always include it." No other event carries it and there is no
 * `$CLAUDE_MODEL`, so the model reaches a tool-call judgment only by being
 * recorded here under `session_id` and looked up there. The fields read are
 * the ones the doc's "SessionStart input" table lists: `source` ("startup",
 * "resume", "clear", "compact", "fork") and the optional `model` ("It can be
 * omitted, for example after `/clear` or when a session is restored through
 * conversation recovery, so check for the field before reading it"), plus the
 * common `session_id` and `cwd`.
 *
 * It returns the empty string, always, and the caller writes nothing. That is
 * not a style choice: the doc lists `SessionStart` among the events where
 * "Claude Code adds plain-text stdout as context that Claude can see and act
 * on", so anything printed here would be injected into the model's context on
 * every single session. This hook has nothing to say to the model.
 *
 * It also never fails. Unparseable input, a missing `session_id`, a log that
 * cannot be written — each is logged at debug and swallowed. A session must
 * start whether or not jig managed to note it down; the consequence of a lost
 * line is a `PreToolUse` that does not know the model, which is exactly the
 * state everything was in before this hook existed.
 */
export async function sessionStart(stdin: string, deps: SessionStartDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const harness = deps.harness ?? env.JIG_HARNESS ?? "claude";

  let payload: SessionStartPayload;
  try {
    payload = JSON.parse(stdin) as SessionStartPayload;
  } catch {
    deps.logger?.debug("session-start.unparseable-input", { chars: stdin.length });
    return "";
  }

  if (typeof payload.session_id !== "string" || payload.session_id === "") {
    deps.logger?.debug("session-start.no-session-id");
    return "";
  }

  const entry: SessionRecord = {
    session_id: payload.session_id,
    // Absent, not null: a line with no `model` key is a session that declined
    // to say, which is what `latestModel` skips over rather than believes.
    ...(typeof payload.model === "string" && payload.model !== "" ? { model: payload.model } : {}),
    harness,
    recorded_at: deps.clock.now().toISOString(),
    ...(typeof payload.source === "string" && payload.source !== ""
      ? { source: payload.source }
      : {}),
  };

  try {
    await deps.record(entry);
  } catch (error) {
    deps.logger?.debug("session-start.record-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }

  // `cwd` is not part of the record — the lookup key is the session id and
  // nothing reads a directory back — but it is what makes a debug line
  // identifiable when two sessions start at once.
  deps.logger?.debug("session-start.recorded", {
    session: entry.session_id,
    harness,
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.source === undefined ? {} : { source: entry.source }),
    ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}),
  });
  return "";
}
