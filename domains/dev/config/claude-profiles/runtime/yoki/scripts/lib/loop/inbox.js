'use strict';

/**
 * `--prompt-from-artifact-inbox`: render a prompt out of unread
 * `yoki-artifact` comments and mark them consumed (task T19 spec).
 *
 * Reads the same append-only log the `artifact-comments.js` SessionStart/
 * UserPromptSubmit hook does — `~/.local/state/yoki/artifact/inbox.jsonl`
 * (see `yoki-artifact/bin/lib/inbox.mjs`) — but tracks its own delivery
 * cursor (`yoki/loop/inbox.cursor.json`) rather than sharing that hook's
 * cursor: the hook and this loop are two independent readers of the same
 * log, and one marking a line "delivered" must not hide it from the other.
 * "Marks them consumed" is exactly that cursor advance; the source log
 * itself, and the `yoki-artifact seen` server-side state, are untouched.
 */

const fs = require('fs');
const path = require('path');

const ARTIFACT_INBOX_RELATIVE = path.join('yoki', 'artifact', 'inbox.jsonl');
const LOOP_CURSOR_RELATIVE = path.join('yoki', 'loop', 'inbox.cursor.json');

function stateHome(env = process.env) {
  const xdg = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : '';
  return xdg || path.join(env.HOME || '', '.local', 'state');
}

function inboxPath(env = process.env) {
  return path.join(stateHome(env), ARTIFACT_INBOX_RELATIVE);
}

function cursorPath(env = process.env) {
  return path.join(stateHome(env), LOOP_CURSOR_RELATIVE);
}

function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return [];
    throw cause;
  }
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** @returns {number} lines already delivered to this loop; 0 for a missing,
 *   malformed, or out-of-range cursor (matches `artifact-comments.js`'s
 *   reasoning: re-showing a comment is recoverable, silently skipping one
 *   forever is not). */
function readCursor(file, totalLines) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  const delivered = Number(parsed?.delivered);
  if (!Number.isInteger(delivered) || delivered < 0) return 0;
  return delivered > totalLines ? 0 : delivered;
}

function writeCursor(file, delivered, now = new Date()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ delivered, updated_at: now.toISOString() })}\n`, 'utf8');
}

function parseEntries(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && entry.comment && typeof entry.comment === 'object') {
        entries.push(entry);
      }
    } catch {
      // A truncated final line must not cost the entries that parsed fine.
    }
  }
  return entries;
}

/** @returns {{entries: object[], totalLines: number}} unread entries, without
 *   mutating the cursor — split out so tests (and dry-run) can inspect what
 *   would be consumed before it actually is. */
function readUnread(env = process.env) {
  const lines = readLines(inboxPath(env));
  const delivered = readCursor(cursorPath(env), lines.length);
  return { entries: parseEntries(lines.slice(delivered)), totalLines: lines.length };
}

/** Advances the cursor past every currently-unread line — the "marks them
 *   consumed" half of `--prompt-from-artifact-inbox`. */
function markConsumed(totalLines, env = process.env, now = new Date()) {
  writeCursor(cursorPath(env), totalLines, now);
}

function renderPrompt(entries) {
  const items = entries.map((entry) => {
    const comment = entry.comment || {};
    const author = comment.author ? `${comment.author}: ` : '';
    return `- [${entry.channel || 'unknown'}] ${author}${String(comment.body || '').trim()}`;
  });
  return `Address these artifact comments:\n${items.join('\n')}`;
}

/**
 * Reads unread inbox lines, renders them into the prompt string, and
 * advances the cursor so the next call sees only what arrived after this
 * one — the whole `--prompt-from-artifact-inbox` behavior in one call.
 * @returns {string|null} the rendered prompt, or `null` when there is
 *   nothing unread (the caller must not run the harness with an empty ask).
 */
function consumeArtifactInboxPrompt(env = process.env, now = new Date()) {
  const { entries, totalLines } = readUnread(env);
  if (entries.length === 0) return null;
  markConsumed(totalLines, env, now);
  return renderPrompt(entries);
}

module.exports = {
  inboxPath,
  cursorPath,
  readUnread,
  markConsumed,
  renderPrompt,
  consumeArtifactInboxPrompt,
};
