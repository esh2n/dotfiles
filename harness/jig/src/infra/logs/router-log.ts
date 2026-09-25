/**
 * The router's decision log: one line per judgment, whatever the answer was.
 *
 * Why a file and not the service's stdout: this log is read back by `jig report skills`
 * and joined to what the model actually opened, and a launchd log rotates away while a
 * JSONL append does not. Why one line per judgment including the declines: the case that
 * matters most (the router said "nothing applies" and the model then picked a skill
 * anyway) is invisible in every other record, because a decline injects nothing and so
 * leaves no trace in the transcript.
 *
 * Two writers, one per decision path, and that is deliberate: the Claude Code hook runs
 * the router client-side (it asks the service's generic `/decide` endpoint, which cannot
 * know the question was about skills), while a harness that calls `/skill` has the
 * service decide. Splitting the log by who decided is what keeps exactly one line per
 * prompt instead of two. `harness` says which path it was.
 */

import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RouterLogEntry } from "../../domain/skills/router-log";

/**
 * Identity of the prompt exactly as it arrived. `promptChars` alone cannot tell two
 * prompts apart: a batch of same-length but different requests reads as one prompt whose
 * confidence wandered, and a repeatability claim made on lengths cannot be checked
 * afterwards. Twelve hex characters of SHA-256 are enough to group repeats.
 *
 * Both writers hash with this function, so a line from either path joins to the same
 * turn. Two hash functions would make the join silently impossible.
 */
export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/** Append one decision line, creating the log's directory on first use. */
export async function appendRouterLog(path: string, entry: RouterLogEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}
