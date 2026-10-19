/**
 * The precedence check's lines under a pack in the apply report
 * (`app/apply/precedence-check.ts`): a quiet ok when every quote is found
 * and the checkout is where the quotes were verified, otherwise WARNING
 * lines naming the row id, the file and the quote, or the rows whose quoted
 * files changed since `verifiedAt`. Warnings, never a failed apply.
 */

import type { PackDrift, PrecedenceCheck } from "../app/apply/precedence-check";

const ROWS_DOC = "rules/common/80-pstack.md";

function short(commit: string): string {
  return commit.slice(0, 12);
}

function driftLines(drift: PackDrift, checkout: string, indent: string): readonly string[] {
  const head = `${indent}WARNING: the pack is at ${short(drift.head)}; its precedence quotes were verified at ${short(drift.verifiedAt)}`;
  if (drift.kind === "unknown") {
    return [
      head,
      `${indent}${short(drift.verifiedAt)} is not in the checkout (dotctl setup plugins fetches depth 1), so which rows changed is unknown.`,
      `${indent}To list them: git -C ${checkout} fetch --depth 1 origin ${drift.verifiedAt}, then run jig apply again.`,
      `${indent}Or re-read every row of ${ROWS_DOC} against the pack and set verifiedAt to ${drift.head}.`,
    ];
  }
  if (drift.rows.length === 0) {
    return [head, `${indent}no quoted file changed since; bump verifiedAt to ${drift.head}`];
  }
  const rows = drift.rows.map((row) => `${row.id} (${row.files.join(", ")})`).join(", ");
  return [
    head,
    `${indent}${drift.rows.length} row(s) quote files changed since: ${rows}`,
    `${indent}re-read those rows of ${ROWS_DOC} against the pack, then set verifiedAt to ${drift.head}`,
  ];
}

export function precedenceLines(
  name: string,
  checkout: string,
  check: PrecedenceCheck | undefined,
  indent: string,
): readonly string[] {
  if (check === undefined) return [];
  const table = `harness/plugins/${name}/precedence.json`;
  if (check.invalid !== undefined) {
    return [
      `${indent}WARNING: precedence check could not run (${check.invalid}); ${table}'s quotes were not checked`,
    ];
  }
  const lines: string[] = [];
  if (check.missing.length > 0) {
    lines.push(
      `${indent}WARNING: ${check.missing.length} precedence quote(s) no longer in the pack (${table}):`,
      ...check.missing.map(
        (quote) =>
          `${indent}  ${quote.id}  ${quote.file}${quote.fileMissing ? " (file gone)" : ""}  ${JSON.stringify(quote.text)}`,
      ),
      `${indent}re-read those rows of ${ROWS_DOC} against the pack, then update the quotes`,
    );
  }
  if (check.drift !== undefined) lines.push(...driftLines(check.drift, checkout, indent));
  return lines.length > 0 ? lines : [`${indent}precedence quotes: all found in the pack`];
}
