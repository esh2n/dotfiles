// inbox.mjs — the append-only log `watch` writes agent-addressed comments to.
//
// One JSON object per line, so a hook or a cron job can `tail -n1` it without
// a parser. `watch --once` is expected to run repeatedly (cron), so the writer
// de-duplicates against the ids already in the file: polling must not turn one
// comment into twenty entries, and marking a comment seen server-side is the
// separate, explicit `seen` command.

import fs from "node:fs";
import path from "node:path";

export const INBOX_RELATIVE = path.join("yoki", "artifact", "inbox.jsonl");

/** Honours XDG_STATE_HOME; defaults to ~/.local/state per the XDG base dirs. */
export function inboxPath(env = process.env) {
  const base = env.XDG_STATE_HOME?.trim()
    ? env.XDG_STATE_HOME
    : path.join(env.HOME ?? "", ".local", "state");
  return path.join(base, INBOX_RELATIVE);
}

/** @returns {Set<string>} comment ids already recorded; empty when there is no log yet. */
export function readInboxIds(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (cause) {
    if (cause?.code === "ENOENT") return new Set();
    throw cause;
  }
  const ids = new Set();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.comment?.id === "string") ids.add(parsed.comment.id);
    } catch {
      // A truncated final line (an interrupted append) must not stop the poll.
    }
  }
  return ids;
}

export function appendInboxEntry(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function inboxEntry({ channel, comment, viewerUrl, now = new Date() }) {
  return Object.freeze({
    recorded_at: now.toISOString(),
    channel,
    url: viewerUrl,
    comment,
  });
}
