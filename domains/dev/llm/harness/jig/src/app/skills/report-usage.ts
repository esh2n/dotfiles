/**
 * Application use-case for the skill-usage report: read the session transcripts, turn
 * them into turns, and fold them into the numbers.
 *
 * The format knowledge stays outside (the caller passes `parse`), because which fields a
 * harness writes is an infrastructure fact and this use-case is the same one either way.
 * Nothing here writes, injects or judges: it answers "what happened" from a record the
 * fronts already keep, so running it can never change what is being measured.
 */

import type { SkillTurn, SkillUsageReport } from "../../domain/skills/usage";
import { summarizeSkillUsage } from "../../domain/skills/usage";

export interface SkillUsageDeps {
  /** Session files to read, in any order; the summary sorts nothing by file. */
  readonly files: readonly string[];
  /** One session file's contents into turns. Where a front's field names are known. */
  readonly parse: (text: string, session: string) => readonly SkillTurn[];
  readonly read: (path: string) => Promise<string>;
}

export interface SkillUsageOutput {
  readonly report: SkillUsageReport;
  /** Files that could not be read. A deleted session is not a reason to fail a report. */
  readonly unread: readonly string[];
}

export async function reportSkillUsage(deps: SkillUsageDeps): Promise<SkillUsageOutput> {
  const turns: SkillTurn[] = [];
  const unread: string[] = [];
  let sessions = 0;

  for (const file of deps.files) {
    let text: string;
    try {
      text = await deps.read(file);
    } catch {
      unread.push(file);
      continue;
    }
    sessions += 1;
    turns.push(...deps.parse(text, file));
  }

  return { report: { sessions, ...summarizeSkillUsage(turns) }, unread };
}
