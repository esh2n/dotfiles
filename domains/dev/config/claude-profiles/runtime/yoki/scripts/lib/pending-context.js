'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Cross-harness "say this to the model next turn" mailbox (T18).
 *
 * Some hooks learn something worth telling the model at a point in the
 * harness lifecycle that has no direct context-injection channel — Codex's
 * PreCompact fires but cannot inject additionalContext (see
 * ../hooks/pre-compact.js and lib/targets/codex-hooks-merge.js's
 * KNOWN_EVENTS comment), and a SessionStart/UserPromptSubmit hook that wants
 * to report something asynchronous (an unread comment batch — see
 * ../hooks/artifact-comments.js) shouldn't have to be the one that also
 * formats and emits it. Queuing the text here and draining it on the next
 * UserPromptSubmit (../hooks/prompt-pending-context.js) decouples "detect
 * something worth saying" from "have a channel to say it right now", and
 * works identically on every harness since the queue is a plain JSONL file,
 * never a harness API.
 *
 * One file per (harness, session):
 * `${XDG_STATE_HOME:-~/.local/state}/yoki/pending-context/<harness>-<sessionId>.jsonl`.
 * Each line is `{source, text, queued_at, expires_at?}`. `drain()` reads
 * every line, drops anything already expired, deletes the file, and returns
 * the surviving text — an item is delivered at most once, the same
 * at-most-once contract artifact-comments.js's own inbox cursor keeps.
 */

const QUEUE_RELATIVE_DIR = path.join('yoki', 'pending-context');

/** Honours XDG_STATE_HOME, defaulting to ~/.local/state — same resolution
 * hooks/artifact-comments.js uses, so both agree on the state root. */
function stateDir(env) {
  const environment = env && typeof env === 'object' ? env : process.env;
  const xdg = typeof environment.XDG_STATE_HOME === 'string' ? environment.XDG_STATE_HOME.trim() : '';
  return xdg || path.join(environment.HOME || os.homedir() || '', '.local', 'state');
}

// Both segments land in a filename built from caller-supplied strings (a
// harness name, a session id) — neither is trusted to already be a safe path
// component, so anything outside a conservative allowlist is replaced.
function sanitizeSegment(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  const safe = text.replace(/[^A-Za-z0-9_.-]/g, '_');
  return safe || fallback;
}

function queueDir(env) {
  return path.join(stateDir(env), QUEUE_RELATIVE_DIR);
}

/**
 * @param {{harness?: string, sessionId?: string}} session
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute path to that session's queue file
 */
function queuePath(session, env) {
  const s = session && typeof session === 'object' ? session : {};
  const harness = sanitizeSegment(s.harness, 'claude');
  const sessionId = sanitizeSegment(s.sessionId, 'unknown');
  return path.join(queueDir(env), `${harness}-${sessionId}.jsonl`);
}

function nowEpochSeconds() {
  return Date.now() / 1000;
}

/**
 * Appends one context item to `session`'s queue. An empty/whitespace-only
 * `text` is silently dropped — there is nothing worth queuing. `ttlSec`,
 * when a positive finite number, makes the item expire; `drain()` skips a
 * line whose `expires_at` has already passed. Omitted/non-positive means
 * the item never expires on its own — it lives until drained.
 *
 * @param {{harness?: string, sessionId?: string}} session
 * @param {{source?: string, text: string, ttlSec?: number}} entry
 * @param {NodeJS.ProcessEnv} [env]
 */
function enqueue(session, entry, env) {
  const opts = entry && typeof entry === 'object' ? entry : {};
  const text = typeof opts.text === 'string' ? opts.text.trim() : '';
  if (!text) return;

  const file = queuePath(session, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const record = {
    source: typeof opts.source === 'string' && opts.source.trim() ? opts.source.trim() : 'unknown',
    text,
    queued_at: new Date().toISOString(),
  };
  const ttlSec = Number(opts.ttlSec);
  if (Number.isFinite(ttlSec) && ttlSec > 0) {
    record.expires_at = nowEpochSeconds() + ttlSec;
  }

  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Reads and clears `session`'s queue, returning the surviving items' text in
 * enqueue order. A malformed line (a write interrupted mid-append) is
 * skipped rather than costing the entries that parsed fine; an expired item
 * is dropped silently. A missing queue file means nothing was ever queued:
 * `[]`, not an error.
 *
 * @param {{harness?: string, sessionId?: string}} session
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function drain(session, env) {
  const file = queuePath(session, env);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const now = nowEpochSeconds();
  const texts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record.text !== 'string' || !record.text) continue;
    if (Number.isFinite(record.expires_at) && record.expires_at < now) continue; // dropped: expired
    texts.push(record.text);
  }

  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }

  return texts;
}

module.exports = { enqueue, drain, queuePath, queueDir, stateDir };
