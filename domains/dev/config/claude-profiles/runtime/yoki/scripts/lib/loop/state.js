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

const fs = require('fs');
const path = require('path');

/** @returns {string} `~/.local/state` (or `$XDG_STATE_HOME`) */
function stateHome(env = process.env) {
  const xdg = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : '';
  return xdg || path.join(env.HOME || '', '.local', 'state');
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
 *   (ts, harness, cmd, exit, durationMs, sessionId)
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
  loopDir,
  runsPath,
  readRuns,
  appendRun,
  lastSessionId,
  countRunsToday,
  checkDailyCap,
  dayKey,
};
