/**
 * The findings check's record: which skills a session used, which subagents finished in it
 * with their `Findings` line, what the gate already did for each use, when the
 * typecheck gate stopped a turn, and when the owner was told the settings are stale
 * (`rules/decisions/2026-10-23-findings-verification-check.md`).
 *
 * One jsonl file per UTC day under the directory, appended like the session and router
 * logs. A file per day, not one file, so that keeping 14 days is deleting whole files:
 * rewriting one shared file to drop old lines would race the hooks that append to it, and
 * a lost line here is a wrong stop.
 */

import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GateOutcome, SkillRunEvent } from "../../domain/hooks/findings-check";

export const KEEP_DAYS = 14;

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const OUTCOMES: ReadonlySet<string> = new Set<GateOutcome>([
  "blocked",
  "unverified",
  "not-checked",
]);

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/** One parsed line, or `undefined` for a line that is not a record this writer makes. */
export function parseSkillRun(line: string): SkillRunEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!text(r.at) || !text(r.session) || !text(r.harness)) return undefined;
  const base = { at: r.at, session: r.session, harness: r.harness };
  if (r.kind === "skill" && text(r.name)) return { ...base, kind: "skill", name: r.name };
  if (r.kind === "subagent" && text(r.agentType)) {
    return {
      ...base,
      kind: "subagent",
      agentType: r.agentType,
      ...(text(r.agentId) ? { agentId: r.agentId } : {}),
      ...(Number.isInteger(r.findings) && (r.findings as number) >= 0
        ? { findings: r.findings as number }
        : {}),
    };
  }
  if (r.kind === "gate" && text(r.skill) && text(r.useAt) && OUTCOMES.has(r.outcome as string)) {
    return {
      ...base,
      kind: "gate",
      skill: r.skill,
      useAt: r.useAt,
      outcome: r.outcome as GateOutcome,
    };
  }
  if (r.kind === "typecheck") return { ...base, kind: "typecheck" };
  if (r.kind === "stale-settings") return { ...base, kind: "stale-settings" };
  return undefined;
}

/** Append one record to its day's file, creating the directory on first use. */
export async function appendSkillRun(dir: string, event: SkillRunEvent): Promise<void> {
  await mkdir(dir, { recursive: true });
  await appendFile(
    join(dir, `${event.at.slice(0, 10)}.jsonl`),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

/**
 * The records of the last `KEEP_DAYS` days, deleting the day files older than that. A
 * missing directory is no records; any other failure throws, because the gate must tell
 * "nothing recorded" from "could not read".
 */
export async function readSkillRuns(dir: string, now: Date): Promise<readonly SkillRunEvent[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const oldest = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const events: SkillRunEvent[] = [];
  for (const name of names.sort()) {
    const day = DAY_FILE.exec(name)?.[1];
    if (day === undefined) continue;
    if (day < oldest) {
      await rm(join(dir, name), { force: true });
      continue;
    }
    const body = await readFile(join(dir, name), "utf8");
    for (const line of body.split("\n")) {
      const event = line === "" ? undefined : parseSkillRun(line);
      if (event !== undefined) events.push(event);
    }
  }
  return events;
}
