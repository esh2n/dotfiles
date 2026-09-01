'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stateHome } = require('./state-home');

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
 * Each line is `{source, text, queued_at, expires_at?}`. `drain()` claims
 * the file with an atomic rename, reads every line, drops anything already
 * expired, and returns the surviving text — an item is delivered at most
 * once, the same at-most-once contract artifact-comments.js's own inbox
 * cursor keeps, and (see `drain()`) at least once even under a concurrent
 * enqueue.
 */

const QUEUE_RELATIVE_DIR = path.join('yoki', 'pending-context');

/** Honours XDG_STATE_HOME, defaulting to ~/.local/state — the one shared
 * resolver in lib/state-home.js, so every module that writes under the
 * state root agrees on where it is. */
function stateDir(env) {
  return stateHome(env);
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
 * CLAIMING IS ATOMIC. The queue file is `rename()`d to a unique sibling
 * first, and only that claimed copy is read and deleted. `rename(2)` is
 * atomic on POSIX, so exactly one concurrent drain can win the file, and —
 * the reason this matters — a concurrent `enqueue()` racing this call either
 * lands in the claimed file before the rename (and is returned here) or
 * `appendFileSync`-creates a fresh queue file after it, which this call
 * never touches and the next drain delivers. The previous read-then-unlink
 * shape lost any line appended between the two syscalls: it was written to
 * the file this call then deleted whole. That loss was permanent, since
 * hooks/artifact-comments.js advances its inbox cursor as soon as enqueue()
 * returns and never re-enqueues a delivered batch. Both hooks are
 * registered on the same UserPromptSubmit event in core/settings.layer.json
 * and Claude Code runs one event's hooks as concurrent processes, so the
 * window was reachable in normal operation.
 *
 * The trade-off, stated plainly: a hard crash (SIGKILL) in the microseconds
 * between the rename and the unlink leaves an orphan `<queue>.draining-*`
 * file that no later drain reads, so its items are lost — where the old
 * shape would have left the original file and redelivered them. That is a
 * far narrower and far less likely window than the concurrent-hook race it
 * replaces, and the orphan is named for what it is, so an operator looking
 * at the queue directory can see and read it.
 *
 * @param {{harness?: string, sessionId?: string}} session
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function drain(session, env) {
  const file = queuePath(session, env);
  const claimed = `${file}.draining-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  try {
    fs.renameSync(file, claimed);
  } catch (err) {
    if (err && err.code === 'ENOENT') return []; // nothing queued, or another drain won it
    throw err;
  }

  let raw;
  try {
    raw = fs.readFileSync(claimed, 'utf8');
  } finally {
    // The claimed copy is this call's alone — deleting it can never take a
    // line that arrived after the rename, because those go to a new file.
    try {
      fs.unlinkSync(claimed);
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }
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

  return texts;
}

module.exports = { enqueue, drain, queuePath, queueDir, stateDir };
