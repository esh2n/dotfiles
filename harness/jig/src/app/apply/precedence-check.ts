/**
 * The precedence check at apply time: read `harness/plugins/<name>/precedence.json`
 * when the pack has one, and look for every quoted sentence in the fetched
 * checkout (`rules/decisions/2026-10-19-pstack-precedence-table.md`). When
 * the checkout is a git checkout that has moved past `verifiedAt`, also name
 * the rows whose quoted files changed in between.
 *
 * Nothing here fails the apply: the pack keeps being linked, and the report
 * names what needs a fresh look. A broken precedence.json is named the same
 * way. Missing git, a non-git checkout, or a `verifiedAt` commit a shallow
 * checkout does not hold only skips the commit comparison.
 */

import {
  type MissingQuote,
  type Precedence,
  type TouchedRow,
  missingQuotes,
  parsePrecedence,
  precedenceFiles,
  rowsTouchedBy,
} from "../../domain/plugins/precedence";
import type { ClaudeApplyPorts } from "./ports";

/** The checkout is not at `verifiedAt`. `unknown`: the diff could not be had. */
export type PackDrift =
  | {
      readonly kind: "moved";
      readonly head: string;
      readonly verifiedAt: string;
      readonly rows: readonly TouchedRow[];
    }
  | {
      readonly kind: "unknown";
      readonly head: string;
      readonly verifiedAt: string;
    };

export interface PrecedenceCheck {
  /** Why the check could not run (the table, a quoted file or git failed); nothing was checked. */
  readonly invalid?: string;
  readonly missing: readonly MissingQuote[];
  /** Absent when the checkout is at `verifiedAt`, or no commits could be compared. */
  readonly drift?: PackDrift;
}

async function driftOf(
  ports: ClaudeApplyPorts,
  checkout: string,
  precedence: Precedence,
): Promise<PackDrift | undefined> {
  const { verifiedAt } = precedence;
  const history = ports.packHistory;
  if (verifiedAt === undefined || history === undefined) return undefined;
  const head = await history.head(checkout);
  if (head === undefined || head === verifiedAt) return undefined;
  const changed = await history.changedFiles(checkout, verifiedAt, head);
  if (changed === undefined) return { kind: "unknown", head, verifiedAt };
  return { kind: "moved", head, verifiedAt, rows: rowsTouchedBy(precedence, changed) };
}

function failed(error: unknown): PrecedenceCheck {
  return { invalid: error instanceof Error ? error.message : String(error), missing: [] };
}

/**
 * The check for one fetched pack; `undefined` when the repository keeps no
 * precedence.json for it. Any error on the way (a table that does not parse,
 * a quoted path that is a directory, a link loop, an unreadable file, git
 * failing oddly) comes back as `invalid`, so the apply goes on.
 */
export async function checkPrecedence(
  ports: ClaudeApplyPorts,
  tablePath: string,
  name: string,
  checkout: string,
): Promise<PrecedenceCheck | undefined> {
  try {
    const text = await ports.readFile(tablePath);
    if (text === undefined) return undefined;
    return await checkTable(ports, parsePrecedence(name, text), checkout);
  } catch (error) {
    return failed(error);
  }
}

async function checkTable(
  ports: ClaudeApplyPorts,
  precedence: Precedence,
  checkout: string,
): Promise<PrecedenceCheck> {
  const contents = new Map<string, string | undefined>();
  for (const file of precedenceFiles(precedence)) {
    const path = `${checkout}/${file}`;
    const isFile = (await ports.inspect(path)).kind === "file";
    contents.set(file, isFile ? await ports.readFile(path) : undefined);
  }
  const drift = await driftOf(ports, checkout, precedence);
  return {
    missing: missingQuotes(precedence, contents),
    ...(drift === undefined ? {} : { drift }),
  };
}
