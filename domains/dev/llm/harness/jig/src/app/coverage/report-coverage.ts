/**
 * Application use-case: build the guard-coverage report. Reconciles what the
 * reconcilable harnesses recorded against what jig audited, and names the
 * harnesses left out and why, so a hole in coverage is never hidden behind a
 * clean-looking number.
 */

import {
  type AuditedCall,
  type CoverageReport,
  type RecordedCall,
  reconcileCoverage,
} from "../../domain/coverage/reconcile";

export interface CoverageSources {
  readAudit(): Promise<AuditedCall[]>;
  /** Only the harnesses whose transcript call id is confirmed to match the audit's. */
  readRecorded(): Promise<RecordedCall[]>;
}

export interface CoverageResult {
  readonly report: CoverageReport;
  /** Harnesses present in the audit but not reconciled, with why. */
  readonly unreconciled: readonly {
    readonly harness: string;
    readonly reason: string;
    readonly audited: number;
  }[];
  /** Per reconciled harness, the counts, so a single bad harness is visible. */
  readonly byHarness: readonly {
    readonly harness: string;
    readonly recorded: number;
    readonly covered: number;
    readonly gaps: number;
  }[];
}

const UNRECONCILED_REASONS: Readonly<Record<string, string>> = {
  pi: "transcript call id is a composite; its match to the guard's toolCallId is unconfirmed",
  dsh: "transcripts are zstd-compressed and not yet read",
};

export async function reportCoverage(sources: CoverageSources): Promise<CoverageResult> {
  const [audited, recorded] = await Promise.all([sources.readAudit(), sources.readRecorded()]);
  const reconciledHarnesses = new Set(recorded.map((call) => call.harness));
  const reconciledAudit = audited.filter((line) => reconciledHarnesses.has(line.harness));
  const report = reconcileCoverage(recorded, reconciledAudit);

  const auditedByHarness = new Map<string, number>();
  for (const line of audited)
    auditedByHarness.set(line.harness, (auditedByHarness.get(line.harness) ?? 0) + 1);

  const unreconciled = [...auditedByHarness.entries()]
    .filter(([harness]) => !reconciledHarnesses.has(harness))
    .map(([harness, count]) => ({
      harness,
      reason: UNRECONCILED_REASONS[harness] ?? "no transcript reader",
      audited: count,
    }))
    .sort((a, b) => a.harness.localeCompare(b.harness));

  const byHarness = [...reconciledHarnesses]
    .map((harness) => {
      const rec = recorded.filter((call) => call.harness === harness);
      const gaps = report.gaps.filter((gap) => gap.harness === harness);
      return {
        harness,
        recorded: rec.length,
        covered: rec.length - gaps.length,
        gaps: gaps.length,
      };
    })
    .sort((a, b) => a.harness.localeCompare(b.harness));

  return { report, unreconciled, byHarness };
}
