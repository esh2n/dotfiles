/**
 * `jig report skills` — text formatting for the skill-usage summary.
 *
 * Thin on purpose, like the other CLI modules: argv parsing and layout here, the reading
 * and folding in `app/skills/report-usage.ts`, and the paths and the transcript walk in
 * the composition root (`./jig.ts`). This module never touches the environment or the
 * filesystem, so any report can be rendered in a test.
 */

import type { Harness, SkillUsageReport, UsageTotals } from "../domain/skills/usage";

export interface ReportArgs {
  /** How far back to read. Session trees hold years of files; the default is recent. */
  readonly days: number;
  readonly json: boolean;
}

export const DEFAULT_REPORT_DAYS = 14;

export function parseReportArgs(args: readonly string[]): ReportArgs | { readonly error: string } {
  let days = DEFAULT_REPORT_DAYS;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--days") {
      index += 1;
      const value = Number.parseInt(args[index] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) return { error: "--days needs a positive number" };
      days = value;
      continue;
    }
    return { error: `unknown option: ${arg ?? ""}` };
  }

  return { days, json };
}

const LABELS: ReadonlyMap<keyof UsageTotals, string> = new Map([
  ["turns", "turns"],
  ["followed", "followed an injection"],
  ["partial", "followed only some of it"],
  ["ignored", "ignored the injection"],
  ["substituted", "opened another skill"],
  ["unrouted", "opened one unscouted"],
  ["silent", "no skill involved"],
]);

/** `null` prints as `-`: a rate whose denominator is zero is not a zero, it is unasked. */
function percent(part: number, whole: number): string {
  if (whole === 0) return "-";
  return `${((part / whole) * 100).toFixed(0)}%`;
}

function timing(report: SkillUsageReport): string {
  if (report.from === "" || report.to === "") return "";
  return ` (spanning ${report.from.slice(0, 16).replace("T", " ")} → ${report.to.slice(0, 16).replace("T", " ")})`;
}

function renderTotals(totals: UsageTotals, indent: string): string[] {
  return [...LABELS].map(
    ([key, label]) =>
      `${indent}${label.padEnd(22)}${String(totals[key]).padStart(6)}  ${percent(totals[key], totals.turns).padStart(4)}`,
  );
}

function renderHarnesses(report: SkillUsageReport): string[] {
  const harnesses: readonly Harness[] = ["pi", "claude", "unknown"];
  const present = harnesses.filter((harness) => report.byHarness.has(harness));
  if (present.length === 0) return [];

  const lines = [
    "",
    "by harness",
    `  ${"harness".padEnd(10)}${"turns".padStart(6)}${"followed".padStart(10)}${"partial".padStart(9)}${"ignored".padStart(9)}${"other".padStart(7)}${"unscouted".padStart(11)}`,
  ];
  for (const harness of present) {
    const totals = report.byHarness.get(harness);
    if (totals === undefined) continue;
    lines.push(
      `  ${harness.padEnd(10)}${String(totals.turns).padStart(6)}${String(totals.followed).padStart(10)}${String(totals.partial).padStart(9)}${String(totals.ignored).padStart(9)}${String(totals.substituted).padStart(7)}${String(totals.unrouted).padStart(11)}`,
    );
  }
  return lines;
}

function renderSkills(report: SkillUsageReport): string[] {
  const rows = report.skills.filter((row) => row.injected > 0 || row.opened > 0);
  if (rows.length === 0) return ["", "no skill was injected or opened in this window"];

  const lines = [
    "",
    `skills (${rows.length})`,
    `  ${"skill".padEnd(34)}${"injected".padStart(9)}${"opened".padStart(8)}${"followed".padStart(10)}${"unscouted".padStart(11)}`,
  ];
  for (const row of rows) {
    lines.push(
      `  ${row.skill.padEnd(34)}${String(row.injected).padStart(9)}${String(row.opened).padStart(8)}${String(row.followed).padStart(10)}${String(row.unrouted).padStart(11)}`,
    );
  }
  return lines;
}

/** The report as an operator reads it. `files` is the number of sessions considered. */
export function renderSkillUsage(report: SkillUsageReport, args: ReportArgs): string {
  if (args.json)
    return `${JSON.stringify({ ...report, byHarness: Object.fromEntries(report.byHarness) })}\n`;

  const lines = [
    `jig skill usage — ${report.sessions} session files touched in the last ${args.days} days`,
    `turns read: ${report.totals.turns}${timing(report)}`,
    "",
    ...renderTotals(report.totals, "  "),
    ...renderHarnesses(report),
    ...renderSkills(report),
    "",
    "every prompt in the window counts, including automated sessions;",
    "narrow with JIG_PI_SESSIONS / JIG_CLAUDE_PROJECTS (colon-separated) or JIG_SESSION_ROOTS.",
    "reads through a shell (cat/sed/grep) are not tool calls and are not counted;",
    "a request the router declined leaves no trace, so `opened one unscouted` is an upper bound on misses.",
    "",
  ];
  return lines.join("\n");
}
