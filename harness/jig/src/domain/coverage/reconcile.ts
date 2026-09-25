/**
 * Coverage reconciliation: which tool calls a harness recorded that jig's
 * guard never judged.
 *
 * jig is the harnesses' guard, so a tool call that ran without a matching
 * audit line is a call the guard did not see — a hole, whether from a hook
 * that was never registered, one that timed out (Claude Code and codex let a
 * failed hook pass), or a call routed around the guard. This module compares
 * two lists that name the same calls by the harness's own id and reports the
 * calls present in the harness's record but absent from the audit.
 *
 * Pure: two lists in, a report out. The lists are gathered in infra (the
 * transcript walk and the audit-log read); nothing here touches IO, so the
 * matching rule is tested with plain values.
 */

/** A tool call as the harness recorded it in its own transcript. */
export interface RecordedCall {
  readonly harness: string;
  readonly sessionId: string;
  readonly callId: string;
  readonly tool: string;
  readonly at: string;
}

/** A judgment jig wrote to the audit log. */
export interface AuditedCall {
  readonly harness: string;
  readonly sessionId: string;
  /** The harness's call id, when the adapter stamped one. Older lines have none. */
  readonly callId?: string;
  readonly tool: string;
  readonly decision: "allow" | "deny" | "ask";
  readonly at: string;
}

export interface CoverageGap {
  readonly harness: string;
  readonly sessionId: string;
  readonly callId: string;
  readonly tool: string;
  readonly at: string;
  /**
   * `session-uncovered`: the whole session has audit lines for no call, yet
   * the transcript has tool calls — the guard was not wired for it (a codex
   * trust-hash miss, an unregistered hook). `call-uncovered`: the session is
   * otherwise audited but this one call has no line — a per-call bypass or a
   * timed-out hook.
   */
  readonly kind: "session-uncovered" | "call-uncovered";
}

export interface CoverageReport {
  readonly recorded: number;
  readonly audited: number;
  /** Recorded calls whose id matched an audit line. */
  readonly covered: number;
  /**
   * Recorded calls with no id-matched audit line, split by kind. Sessions
   * whose audit lines carry no id at all are not counted as gaps — see
   * `unmatchable`.
   */
  readonly gaps: readonly CoverageGap[];
  /**
   * Audit lines that could not participate in matching because they predate
   * id stamping (no `callId`). Reported as a number, not as false coverage:
   * a call cannot be called covered by a line that names no call.
   */
  readonly unmatchable: number;
}

function key(harness: string, sessionId: string, callId: string): string {
  return `${harness}\u0000${sessionId}\u0000${callId}`;
}

/**
 * Compare what the harnesses recorded against what jig audited. A call is
 * covered when an audit line shares its (harness, session, call id). A
 * recorded call with no such line is a gap; if its whole session produced no
 * id-matched audit line at all, the gap is `session-uncovered` (the guard
 * was not wired), otherwise `call-uncovered` (one call slipped).
 */
export function reconcileCoverage(
  recorded: readonly RecordedCall[],
  audited: readonly AuditedCall[],
): CoverageReport {
  const auditedIds = new Set<string>();
  const auditedSessions = new Set<string>();
  let unmatchable = 0;
  for (const line of audited) {
    if (line.callId === undefined) {
      unmatchable += 1;
      continue;
    }
    auditedIds.add(key(line.harness, line.sessionId, line.callId));
    auditedSessions.add(`${line.harness}\u0000${line.sessionId}`);
  }

  let covered = 0;
  const gaps: CoverageGap[] = [];
  for (const call of recorded) {
    if (auditedIds.has(key(call.harness, call.sessionId, call.callId))) {
      covered += 1;
      continue;
    }
    const sessionAudited = auditedSessions.has(`${call.harness}\u0000${call.sessionId}`);
    gaps.push({
      harness: call.harness,
      sessionId: call.sessionId,
      callId: call.callId,
      tool: call.tool,
      at: call.at,
      kind: sessionAudited ? "call-uncovered" : "session-uncovered",
    });
  }

  return { recorded: recorded.length, audited: audited.length, covered, gaps, unmatchable };
}
