/**
 * Read back what the session said about itself at start: which model it runs
 * on. The other half of `jig hooks session-start`.
 *
 * This runs inside `PreToolUse`, on every tool call, so it is deliberately
 * dumb: one read through the `FileSystem` port, one backwards scan, no cache,
 * no lock. It never throws — a missing log, an unreadable one, or a session
 * that was never recorded all mean the same thing to the caller ("no model
 * known"), and none of them may stop a tool call from being judged.
 */

import { latestModel } from "../../domain/hooks/session";
import type { FileSystem } from "../../domain/ports";

/**
 * How much of the log the scan looks at, counted from the end: 1 MiB.
 *
 * The read itself is a whole-file read, because `FileSystem.read` is the only
 * read capability the core has and a tail port would exist for this one caller
 * alone. The cap bounds the parsing rather than the IO: a line is ~150 bytes,
 * so 1 MiB is roughly 7,000 session starts — more than a machine produces
 * between the log being pruned, and far past the point where a session id from
 * the older part could still be making tool calls. Nothing rotates this file
 * today; if it ever grows past a few MiB the fix is rotation in the writer,
 * not a bigger number here.
 */
const MAX_SCAN_BYTES = 1024 * 1024;

export interface SessionModelDeps {
  readonly fs: Pick<FileSystem, "read">;
  /** Where `jig hooks session-start` appends; `resolveSessionsPath` supplies it. */
  readonly path: string;
}

/** The model last recorded for this session, or `undefined` if none is known. */
export async function sessionModel(
  sessionId: string,
  deps: SessionModelDeps,
): Promise<string | undefined> {
  if (sessionId === "") return undefined;
  let text: string;
  try {
    text = await deps.fs.read(deps.path);
  } catch {
    return undefined;
  }
  const tail = text.length > MAX_SCAN_BYTES ? text.slice(-MAX_SCAN_BYTES) : text;
  return latestModel(tail, sessionId);
}
