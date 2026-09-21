/**
 * `jig report guard-coverage` — text/JSON for the coverage report. Thin:
 * argv and layout here, the reconciliation in `app/coverage`, the reads and
 * paths in the composition root (`./jig.ts`).
 */

import type { CoverageResult } from "../app/coverage/report-coverage";

export interface CoverageArgs {
  readonly days: number;
  readonly json: boolean;
}

export const DEFAULT_COVERAGE_DAYS = 7;

export function parseCoverageArgs(
  args: readonly string[],
): CoverageArgs | { readonly error: string } {
  let days = DEFAULT_COVERAGE_DAYS;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--days") {
      i += 1;
      const value = Number.parseInt(args[i] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) return { error: "--days needs a positive number" };
      days = value;
    } else {
      return { error: `unknown option: ${arg ?? ""}` };
    }
  }
  return { days, json };
}

export function renderCoverage(result: CoverageResult, args: CoverageArgs): string {
  if (args.json) return `${JSON.stringify(result)}\n`;

  const { report, byHarness, unreconciled } = result;
  const rate =
    report.recorded === 0 ? "-" : `${((report.covered / report.recorded) * 100).toFixed(1)}%`;
  const lines = [
    `jig guard coverage — last ${args.days} days`,
    `reconciled ${report.recorded} recorded tool calls against ${report.audited} audited judgments`,
    `covered ${report.covered}/${report.recorded} (${rate}); ${report.gaps.length} gap(s); ${report.unmatchable} audit line(s) too old to match`,
    "",
    `  ${"harness".padEnd(10)}${"recorded".padStart(9)}${"covered".padStart(9)}${"gaps".padStart(6)}`,
  ];
  for (const h of byHarness) {
    lines.push(
      `  ${h.harness.padEnd(10)}${String(h.recorded).padStart(9)}${String(h.covered).padStart(9)}${String(h.gaps).padStart(6)}`,
    );
  }

  if (report.gaps.length > 0) {
    lines.push("", "gaps (a recorded tool call with no audit line):");
    for (const gap of report.gaps.slice(0, 50)) {
      const why =
        gap.kind === "session-uncovered"
          ? "guard not wired for this session"
          : "call slipped the guard";
      lines.push(
        `  ${gap.at.slice(0, 19)}  ${gap.harness.padEnd(7)} ${gap.tool.padEnd(16)} ${gap.callId}  — ${why}`,
      );
    }
    if (report.gaps.length > 50) lines.push(`  … and ${report.gaps.length - 50} more`);
  } else {
    lines.push("", "no gaps: every recorded call in a reconciled harness has an audit line");
  }

  if (unreconciled.length > 0) {
    lines.push("", "not reconciled (audited but no confirmed transcript id):");
    for (const u of unreconciled) {
      lines.push(`  ${u.harness.padEnd(7)} ${String(u.audited).padStart(5)} audited — ${u.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
