#!/usr/bin/env node
/**
 * SessionStart / UserPromptSubmit hook — surfaces unread yoki-artifact
 * comments as additional context.
 *
 * `yoki-artifact watch` (a cron job, or a long-running poll) appends every
 * agent-addressed comment it sees to `~/.local/state/yoki/artifact/inbox.jsonl`.
 * That file is the *only* thing this hook reads: it never opens a socket,
 * never spawns the CLI, and never mutates server state — marking a comment
 * handled is the explicit `yoki-artifact seen` command the agent runs once it
 * has actually answered the thread.
 *
 * Delivery is tracked in a cursor file next to the log
 * (`inbox.cursor.json`), holding the number of inbox lines already handed to
 * a session. A line count is a valid cursor because the log is append-only;
 * if the file is ever shorter than the cursor (rotated, truncated by hand)
 * the cursor resets to 0 rather than silently skipping everything, since
 * re-reporting a comment is recoverable and losing one is not.
 *
 * The context lists the newest few comments and always advances the cursor
 * past *all* of them, so the same comment is announced once per machine, not
 * once per prompt.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);
/** How many of the unread comments are quoted; the count in the header is the real total. */
const MAX_SHOWN = 5;
/** A comment body is a teaser here — the full thread is one `yoki-artifact comments` away. */
const MAX_BODY_CHARS = 200;
const INBOX_RELATIVE = path.join('yoki', 'artifact', 'inbox.jsonl');
const CURSOR_RELATIVE = path.join('yoki', 'artifact', 'inbox.cursor.json');

let raw = '';

/** Honours XDG_STATE_HOME, defaulting to ~/.local/state — the same resolution
 * the CLI's own inbox.mjs does, so both agree on where the log lives. */
function stateDir(env) {
  const xdg = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : '';
  return xdg || path.join(env.HOME || os.homedir() || '', '.local', 'state');
}

function inboxPaths(env) {
  const base = stateDir(env);
  return { inbox: path.join(base, INBOX_RELATIVE), cursor: path.join(base, CURSOR_RELATIVE) };
}

/** @returns {string[]} the log's non-empty lines; `[]` when there is no log yet. */
function readInboxLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return text.split('\n').filter(line => line.trim() !== '');
}

/** @returns {number} lines already delivered; 0 for a missing, malformed or
 * out-of-range cursor (see the module docblock on why 0 is the safe default). */
function readCursor(file, totalLines) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  const delivered = parsed && Number(parsed.delivered);
  if (!Number.isInteger(delivered) || delivered < 0) return 0;
  return delivered > totalLines ? 0 : delivered;
}

function writeCursor(file, delivered) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ delivered, updated_at: new Date().toISOString() })}\n`, 'utf8');
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
      // A truncated final line (an append interrupted mid-write) must not
      // cost the caller the entries that parsed fine.
    }
  }
  return entries;
}

function shorten(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_BODY_CHARS ? `${flat.slice(0, MAX_BODY_CHARS - 1)}…` : flat;
}

function uniqueChannels(entries) {
  const seen = [];
  for (const entry of entries) {
    const channel = String(entry.channel || 'unknown');
    if (!seen.includes(channel)) seen.push(channel);
  }
  return seen;
}

/**
 * The additionalContext text for a batch of unread entries: a header naming
 * the count and the channels, the newest few comments one per line, and the
 * two commands that actually resolve them.
 * @returns {string} empty when there is nothing to report.
 */
function formatContext(entries) {
  if (entries.length === 0) return '';
  const newest = entries.slice(-MAX_SHOWN).reverse();
  const plural = entries.length === 1 ? 'comment' : 'comments';
  const lines = [`yoki-artifact: ${entries.length} unread ${plural} on ${uniqueChannels(entries).join(', ')}`];
  for (const entry of newest) {
    const comment = entry.comment || {};
    lines.push(`  ${String(comment.author || 'unknown')}: ${shorten(comment.body)} (id ${String(comment.id || '?')})`);
  }
  if (entries.length > newest.length) {
    lines.push(`  … ${entries.length - newest.length} older, read them with \`yoki-artifact comments <channel> --to-agent\``);
  }
  lines.push('reply with `yoki-artifact reply <channel> <id> "<text>"`, mark with `yoki-artifact seen <channel> <id>`');
  return lines.join('\n');
}

function buildOutput(event, additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } });
}

/** "Nothing to say." Deliberately an empty stdout rather than an echo of the
 * incoming payload: on SessionStart and UserPromptSubmit a hook's stdout is
 * *added to the model's context*, so echoing the event JSON back (the
 * pass-through convention of the PreToolUse hooks) would inject the raw
 * payload into the session. Empty stdout + exit 0 is "no opinion". */
const SILENT = Object.freeze({ stdout: '', exitCode: 0 });

function run(rawInput) {
  let event = '';
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    event = String((input && input.hook_event_name) || '');
  } catch {
    return SILENT;
  }
  if (!EVENTS.has(event)) return SILENT;

  const { inbox, cursor: cursorFile } = inboxPaths(process.env);

  let lines;
  try {
    lines = readInboxLines(inbox);
  } catch (err) {
    // An unreadable inbox is worth saying out loud once — it means the watch
    // is writing somewhere this hook cannot follow — but it must never keep
    // the session from starting.
    return { stdout: '', exitCode: 0, stderr: `[Hook] artifact-comments: cannot read ${inbox}: ${err.message}` };
  }

  const delivered = readCursor(cursorFile, lines.length);
  const entries = parseEntries(lines.slice(delivered));
  const additionalContext = formatContext(entries);
  if (!additionalContext) return SILENT;

  let stderr = '';
  try {
    writeCursor(cursorFile, lines.length);
  } catch (err) {
    // Report rather than swallow: the comments are still delivered, they will
    // just be delivered again next time.
    stderr = `[Hook] artifact-comments: could not advance ${cursorFile}: ${err.message}`;
  }

  return { stdout: buildOutput(event, additionalContext), exitCode: 0, stderr };
}

if (require.main === module) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      raw += chunk.substring(0, MAX_STDIN - raw.length);
    }
  });

  process.stdin.on('end', () => {
    const result = run(raw);
    if (result && typeof result === 'object') {
      if (result.stderr) process.stderr.write(`${result.stderr}\n`);
      process.stdout.write(String(result.stdout || ''));
      process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 0;
      return;
    }
    process.stdout.write(String(result));
  });
}

module.exports = { run, formatContext, inboxPaths, readCursor, MAX_SHOWN, MAX_BODY_CHARS };
