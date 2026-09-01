'use strict';

/**
 * Per-loop run history: `~/.local/state/yoki/loop/<name>/runs.jsonl`, one
 * JSON row per run (task T19 spec). Honours `XDG_STATE_HOME` the same way
 * `yoki-artifact`'s `inbox.mjs` does, so both tools agree on where state
 * lives when it's overridden; unset, it resolves to the literal path the
 * spec names.
 *
 * The daily cap is enforced by counting today's rows for `<name>` in this
 * same file rather than a separate counter — the log is already the single
 * source of truth for "how many times has this loop run today", and a
 * second counter file could drift from it.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { stateHome } = require('../state-home');

/**
 * A loop's prompt is the one field in a run row that is neither metadata nor
 * ours to keep: `--prompt-from-artifact-inbox` prompts are written by
 * artifact viewers, and hand-written ones routinely name repos, people and
 * in-flight work. `runs.jsonl` is a plaintext append-only log under
 * `~/.local/state`, read back by `yoki-loop status` and swept up by any
 * backup or sync that watches that directory — so the prompt is recorded as
 * a fingerprint instead of as text.
 *
 * The placeholder is `<prompt sha256:<first 12 hex> len:<n>>`: enough to
 * tell two runs apart, to confirm a loop is still firing the prompt it was
 * installed with, and to match a row against a prompt you still hold — and
 * not enough to reconstruct one. `len` counts JS string units (characters
 * for the BMP), which is what makes an unchanged prompt recognisable at a
 * glance without revealing it.
 *
 * @param {string} prompt
 * @returns {string} the placeholder — stable for a given prompt.
 */
function promptPlaceholder(prompt) {
  const text = String(prompt ?? '');
  const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
  return `<prompt sha256:${digest} len:${text.length}>`;
}

/**
 * Replaces exactly the argv elements that ARE the prompt with
 * `promptPlaceholder(prompt)`, leaving every other token verbatim — the
 * recorded `cmd` stays a faithful record of how the harness was invoked
 * (flags, model, sandbox, resume id) minus the one secret in it.
 *
 * Matching is by whole-token equality, not substring: claude and omp both
 * pass the prompt as its own argv element (`-p <prompt>` / the trailing
 * positional), and a flag that merely happens to contain the prompt's text
 * is not the prompt. codex puts the prompt on stdin, so its argv has
 * nothing to redact — the row's `prompt` field carries the placeholder for
 * that case (and, harmlessly, for the other two).
 *
 * @param {string[]} argv
 * @param {string} prompt
 * @returns {string[]} a new array; the input is not mutated.
 */
function redactPromptArgv(argv, prompt) {
  const text = String(prompt ?? '');
  const tokens = Array.isArray(argv) ? argv.map((token) => String(token)) : [];
  if (!text) return tokens;
  const placeholder = promptPlaceholder(text);
  return tokens.map((token) => (token === text ? placeholder : token));
}

function loopDir(name, env = process.env) {
  return path.join(stateHome(env), 'yoki', 'loop', name);
}

function runsPath(name, env = process.env) {
  return path.join(loopDir(name, env), 'runs.jsonl');
}

/**
 * @returns {object[]} parsed rows, oldest first; `[]` when there is no log
 *   yet or every line fails to parse.
 */
function readRuns(name, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(runsPath(name, env), 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return [];
    throw cause;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A truncated final line (an interrupted append) must not lose the
      // rows that parsed fine.
    }
  }
  return rows;
}

/**
 * @param {string} name
 * @param {object} row must already carry every field yoki-loop records
 *   (ts, harness, cmd, prompt, exit, durationMs, sessionId). `cmd` and
 *   `prompt` must already be redacted — see `redactPromptArgv`; this
 *   function writes what it is given, so the redaction belongs upstream in
 *   runner.js where the prompt is still in hand.
 */
function appendRun(name, row, env = process.env) {
  const file = runsPath(name, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

/** @returns {string|null} the most recent non-empty `sessionId` recorded for
 *   this loop, newest row first — what `--resume` passes to the harness. */
function lastSessionId(runs) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const id = runs[i]?.sessionId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** @returns {string} the run's local calendar day, `YYYY-MM-DD` — matches
 *   what `ts` (an ISO timestamp) starts with, so day-bucketing by string
 *   prefix and by this function agree. */
function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

/** @returns {number} how many rows for `name` already ran today (UTC day of
 *   each row's `ts`), as of `now`. */
function countRunsToday(runs, now = new Date()) {
  const today = dayKey(now);
  return runs.filter((row) => typeof row?.ts === 'string' && row.ts.startsWith(today)).length;
}

/**
 * @returns {{overCap: boolean, count: number, cap: number}} whether `name`
 *   has already used up today's `cap` runs.
 */
function checkDailyCap(runs, cap, now = new Date()) {
  const count = countRunsToday(runs, now);
  return { overCap: count >= cap, count, cap };
}

module.exports = {
  stateHome,
  promptPlaceholder,
  redactPromptArgv,
  loopDir,
  runsPath,
  readRuns,
  appendRun,
  lastSessionId,
  countRunsToday,
  checkDailyCap,
  dayKey,
};
