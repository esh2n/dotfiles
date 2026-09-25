/**
 * `jig retire yoki [--write]` — the yoki artifacts jig knows, per harness,
 * each with what it is, the evidence, and what `--write` does. Thin: argv
 * and formatting; the work is in `app/retire/retire-yoki.ts`.
 */

import type { RetirePorts } from "../app/retire/ports";
import {
  type RetireGroup,
  type RetireOptions,
  type RetirePaths,
  type RetireReport,
  retireYoki,
} from "../app/retire/retire-yoki";
import { type RetireItem, describeAction } from "../domain/retire/items";

export interface RetireCliResult {
  readonly stdout: string;
  readonly code: number;
}

const USAGE = "usage: jig retire yoki [--write]\n";

function formatItem(item: RetireItem, width: number): readonly string[] {
  const lines = [`  ${describeAction(item.action).padEnd(12)}${item.path.padEnd(width)}`];
  lines.push(`    what:     ${item.what}`);
  lines.push(`    evidence: ${item.evidence}`);
  switch (item.action.kind) {
    case "skip":
      lines.push(`    skipped:  ${item.action.reason}`);
      break;
    case "rewrite":
      lines.push(`    backup:   ${item.action.backup}`);
      for (const removed of item.action.removed) lines.push(`    - ${removed}`);
      for (const carried of item.action.carried) lines.push(`    + ${carried}`);
      break;
    default:
      break;
  }
  return lines;
}

function formatGroup(group: RetireGroup): readonly string[] {
  const shown = group.items.filter((item) => item.action.kind !== "absent");
  const absent = group.items.length - shown.length;
  const width = Math.max(1, ...shown.map((item) => item.path.length + 2));
  const lines = [
    `${group.title} (${shown.length} found${absent === 0 ? "" : `, ${absent} absent`}):`,
  ];
  if (shown.length === 0) lines.push("  (nothing of yoki's found)");
  for (const item of shown) lines.push(...formatItem(item, width));
  for (const note of group.notes) lines.push(`  ${note}`);
  return lines;
}

export function formatRetire(report: RetireReport): string {
  const lines: string[] = [
    "== retire yoki ==",
    `mode: ${report.write ? (report.wrote ? "write" : "write (nothing to remove)") : "dry-run"}`,
    `removals: ${report.counts.removals}  skipped: ${report.counts.skipped}  absent: ${report.counts.absent}`,
    "",
  ];
  for (const group of report.groups) lines.push(...formatGroup(group), "");
  if (report.failures.length > 0) {
    lines.push(`FAILED (${report.failures.length}):`);
    for (const failure of report.failures) lines.push(`  ${failure.path}: ${failure.error}`);
    lines.push("");
  }
  lines.push(
    "never touched: ~/.claude.json, ~/.claude/settings.json, ~/.claude/{scripts,workflows} (jig apply --target",
    "claude's), ~/.codex/skills/.system, omp's config.yml, and the repository trees the removed links point into.",
    "Order on --write: files and links, then config.toml/hooks.json (each kept as .pre-retire.<stamp>), directories last.",
  );
  if (!report.write && report.counts.removals > 0) {
    lines.push("dry run: nothing removed. Re-run with --write to remove what is listed above.");
  }
  return `${lines.join("\n")}\n`;
}

export async function retireCli(
  args: readonly string[],
  ports: RetirePorts,
  paths: RetirePaths,
  options?: RetireOptions,
): Promise<RetireCliResult> {
  const [subject, ...rest] = args;
  if (subject !== "yoki") return { stdout: USAGE, code: 2 };
  let write = false;
  for (const arg of rest) {
    if (arg === "--write") write = true;
    else
      return { stdout: `jig retire: unknown argument ${JSON.stringify(arg)}\n${USAGE}`, code: 2 };
  }
  const report = await retireYoki(
    { paths, write, ...(options === undefined ? {} : { options }) },
    ports,
  );
  return { stdout: formatRetire(report), code: report.failures.length > 0 ? 1 : 0 };
}
