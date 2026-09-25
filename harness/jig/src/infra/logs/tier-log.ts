/**
 * The tier router's decision log: one jsonl line per `/tier` judgment. Same
 * technique and reasons as the skill router's log next door.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TierLogEntry } from "../../domain/routing/tier-log";

export async function appendTierLog(path: string, entry: TierLogEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}
