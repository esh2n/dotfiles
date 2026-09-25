/**
 * What jig remembers about a harness session, and the only thing it currently
 * needs to remember: which model the session runs on.
 *
 * Why a record at all — the model is not on the call that needs it. Claude
 * Code's hook documentation (https://code.claude.com/docs/en/hooks.md,
 * "Common input fields") is explicit:
 *
 *   "Only `SessionStart` hooks can receive a `model` field, and Claude Code
 *    doesn't always include it. `PreModelSwitch` and `PostModelSwitch` hooks
 *    receive `from_model` and `to_model` instead […] There is no
 *    `$CLAUDE_MODEL` environment variable."
 *
 * and under "SessionStart input":
 *
 *   "`model` — The active model identifier. It can be omitted, for example
 *    after `/clear` or when a session is restored through conversation
 *    recovery, so check for the field before reading it."
 *
 * So a `PreToolUse` hook cannot ask what model it is serving. It can only look
 * up what the session said about itself when it started, keyed by `session_id`
 * — the one field both events carry. That lookup is what this record exists
 * for, and `model` is optional because the harness genuinely omits it.
 *
 * The keys are the harness's own spelling (`session_id`, `model`, `source`)
 * rather than the repo's camelCase, because this file is the on-disk form of a
 * payload jig did not design: a line can be read back against the harness's
 * documentation without a translation table in between.
 */

/** One line of `sessions.jsonl`: a session, as it announced itself at start. */
export interface SessionRecord {
  readonly session_id: string;
  /** Absent when the harness omitted it (`/clear`, conversation recovery). */
  readonly model?: string;
  /** Which harness the session belongs to, stamped by the adapter. */
  readonly harness: string;
  /** ISO-8601, from the clock port. */
  readonly recorded_at: string;
  /** How the session started: `startup`, `resume`, `clear`, `compact`, `fork`. */
  readonly source?: string;
}

/**
 * The model last recorded for a session, or `undefined` when the log has
 * nothing to say about it. Pure: the caller supplies the text.
 *
 * Scanned backwards and last-write-wins, because one session id gets more than
 * one line: `SessionStart` fires again on `/clear`, on compaction and on
 * resume (the doc's `source` matcher table), and a compaction under a switched
 * model is exactly the case where the newest line is the true one. A line that
 * records no model does NOT shadow an earlier one that did — an omitted
 * `model` is the harness declining to say, not a statement that the session
 * has none, so the last line that actually names a model wins.
 *
 * Unparseable lines are skipped rather than failing the read: this log informs
 * a hook that must not block, and a truncated final line (a crash mid-append)
 * must not hide every session before it.
 */
export function latestModel(text: string, sessionId: string): string | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line === undefined || line === "") continue;
    let entry: Partial<SessionRecord>;
    try {
      entry = JSON.parse(line) as Partial<SessionRecord>;
    } catch {
      continue;
    }
    if (entry.session_id !== sessionId) continue;
    if (typeof entry.model === "string" && entry.model !== "") return entry.model;
  }
  return undefined;
}
