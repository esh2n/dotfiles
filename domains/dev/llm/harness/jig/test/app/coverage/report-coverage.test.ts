import { describe, expect, test } from "bun:test";
import { reportCoverage } from "../../../src/app/coverage/report-coverage";
import type { AuditedCall, RecordedCall } from "../../../src/domain/coverage/reconcile";

const rec = (h: string, s: string, c: string): RecordedCall => ({
  harness: h,
  sessionId: s,
  callId: c,
  tool: "Bash",
  at: "2026-09-21T00:00:00Z",
});
const aud = (h: string, s: string, c?: string): AuditedCall => ({
  harness: h,
  sessionId: s,
  callId: c,
  tool: "Bash",
  decision: "allow",
  at: "2026-09-21T00:00:00Z",
});

describe("reportCoverage", () => {
  test("reconciles claude/codex and lists pi/dsh as unreconciled with a reason", async () => {
    const result = await reportCoverage({
      readAudit: async () => [
        aud("claude", "s1", "t1"),
        aud("codex", "s2", "c1"),
        aud("pi", "s3", "p1"),
        aud("dsh", "s4", "d1"),
      ],
      readRecorded: async () => [
        rec("claude", "s1", "t1"),
        rec("codex", "s2", "c1"),
        rec("codex", "s2", "c2"),
      ],
    });
    expect(result.report.covered).toBe(2);
    expect(result.report.gaps).toHaveLength(1);
    expect(result.byHarness).toEqual([
      { harness: "claude", recorded: 1, covered: 1, gaps: 0 },
      { harness: "codex", recorded: 2, covered: 1, gaps: 1 },
    ]);
    expect(result.unreconciled.map((u) => u.harness)).toEqual(["dsh", "pi"]);
    expect(result.unreconciled[1]?.reason).toContain("composite");
  });

  test("unreconciled harnesses' audit lines never inflate coverage", async () => {
    const result = await reportCoverage({
      readAudit: async () => [aud("pi", "s3", "p1")],
      readRecorded: async () => [],
    });
    expect(result.report.recorded).toBe(0);
    expect(result.report.audited).toBe(0);
    expect(result.unreconciled).toHaveLength(1);
  });
});
