import { describe, expect, test } from "bun:test";
import {
  type AuditedCall,
  type RecordedCall,
  reconcileCoverage,
} from "../../../src/domain/coverage/reconcile";

const rec = (harness: string, sessionId: string, callId: string, tool = "Bash"): RecordedCall => ({
  harness,
  sessionId,
  callId,
  tool,
  at: "2026-09-21T00:00:00Z",
});
const aud = (
  harness: string,
  sessionId: string,
  callId: string | undefined,
  decision: AuditedCall["decision"] = "allow",
): AuditedCall => ({
  harness,
  sessionId,
  callId,
  tool: "Bash",
  decision,
  at: "2026-09-21T00:00:00Z",
});

describe("reconcileCoverage", () => {
  test("a call with a matching audit line is covered", () => {
    const r = reconcileCoverage([rec("claude", "s1", "t1")], [aud("claude", "s1", "t1")]);
    expect(r).toMatchObject({ recorded: 1, audited: 1, covered: 1, unmatchable: 0 });
    expect(r.gaps).toEqual([]);
  });

  test("a call with no audit line, in an otherwise-audited session, is a call-uncovered gap", () => {
    const r = reconcileCoverage(
      [rec("claude", "s1", "t1"), rec("claude", "s1", "t2")],
      [aud("claude", "s1", "t1")],
    );
    expect(r.covered).toBe(1);
    expect(r.gaps).toEqual([
      {
        harness: "claude",
        sessionId: "s1",
        callId: "t2",
        tool: "Bash",
        at: "2026-09-21T00:00:00Z",
        kind: "call-uncovered",
      },
    ]);
  });

  test("a session with tool calls but no audit line at all is session-uncovered", () => {
    const r = reconcileCoverage(
      [rec("codex", "s9", "c1"), rec("codex", "s9", "c2")],
      [aud("claude", "s1", "t1")],
    );
    expect(r.covered).toBe(0);
    expect(r.gaps.map((g) => g.kind)).toEqual(["session-uncovered", "session-uncovered"]);
  });

  test("id matching is scoped by harness and session, never crosses them", () => {
    const r = reconcileCoverage(
      [rec("claude", "s1", "shared"), rec("pi", "s1", "shared")],
      [aud("claude", "s1", "shared")],
    );
    // pi's call shares the raw id but not the harness, so it is not covered.
    expect(r.covered).toBe(1);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]?.harness).toBe("pi");
  });

  test("audit lines with no callId are unmatchable, not false coverage", () => {
    const r = reconcileCoverage([rec("claude", "s1", "t1")], [aud("claude", "s1", undefined)]);
    expect(r.unmatchable).toBe(1);
    expect(r.covered).toBe(0);
    // A session known only through id-less lines does not suppress the gap.
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]?.kind).toBe("session-uncovered");
  });

  test("empty inputs are a clean, empty report", () => {
    expect(reconcileCoverage([], [])).toEqual({
      recorded: 0,
      audited: 0,
      covered: 0,
      gaps: [],
      unmatchable: 0,
    });
  });
});
