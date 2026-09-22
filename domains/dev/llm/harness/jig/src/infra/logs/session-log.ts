/**
 * The session log as a jsonl file: one line per `SessionStart`, appended.
 *
 * Same technique as the router and audit logs — `appendFile` is atomic for
 * lines this size and the directory is created on first use — and the same
 * reason for a file rather than process output: this log is read back by a
 * later process (the `PreToolUse` hook, a different invocation entirely), so
 * it has to outlive the session that wrote it.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionRecord } from "../../domain/hooks/session";

/** Append one session line, creating the log's directory on first use. */
export async function appendSessionLog(path: string, entry: SessionRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}
