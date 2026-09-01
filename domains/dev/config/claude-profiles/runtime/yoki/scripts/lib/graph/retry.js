'use strict';

/**
 * Backend-failure retry policy for `agent()`.
 *
 * This layer is about the PROCESS failing — a rate limit, a 5xx from the
 * provider behind the CLI, a killed-on-timeout child, a broken pipe. It is
 * deliberately separate from schema.js's retry, which is about the MODEL's
 * output violating the requested shape: one is "try the same call again",
 * the other is "ask again, differently". Both can fire for the same
 * `agent()` call (schema.js calls the backend, this wraps each of those
 * calls), and neither knows about the other.
 *
 * Only a *transient* failure is retried; anything else fails fast, because
 * retrying `codex: command not found` three times just costs wall time. The
 * classification is deliberately conservative and explicit: an error may opt
 * in or out by setting `err.transient`, otherwise a known errno or a known
 * message shape decides.
 */

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;

/** Node/libuv errnos that mean "the pipe or socket died", not "the request
 *  was wrong". EPIPE is the one this codebase has actually seen: a backend
 *  CLI exiting while the prompt is still being written to its stdin. */
const TRANSIENT_CODES = new Set([
  'EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETDOWN',
  'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EBUSY',
]);

/**
 * Message shapes that mean "come back later". The HTTP statuses are listed
 * literally rather than matched as `5\d\d` so an unrelated number in a
 * stderr dump cannot be read as a server error; exit codes never reach 429
 * or 503, so a bare number in a `... exited N: <stderr>` message can only
 * have come from the stderr half.
 */
const TRANSIENT_PATTERNS = [
  /\b429\b/,
  /\b(500|502|503|504|507|508|509|520|521|522|523|524|529|598|599)\b/,
  /rate[ _-]?limit/i,
  /too many requests/i,
  /overloaded/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway time-?out/i,
  /temporarily unavailable/i,
  /\btimed out\b/i,
  /\btimeout\b/i,
  /connection reset/i,
  /broken pipe/i,
  /socket hang up/i,
  // A child process's own error text often carries the errno as text rather
  // than as `err.code` (`write EPIPE` from a stdin write, for example).
  /\b(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b/,
];

/**
 * @param {unknown} err
 * @returns {boolean} whether retrying the identical call could plausibly
 *   succeed. An explicit `err.transient` boolean always wins — that is how
 *   the backends mark their own timeout kills (see backends/common.js).
 */
function isTransient(err) {
  if (!err) return false;
  if (typeof err.transient === 'boolean') return err.transient;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  const message = String(err.message || err);
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** Exponential backoff, capped: 500ms, 1s, 2s, ... up to maxDelayMs. */
function delayFor(attempt, { baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS } = {}) {
  return Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
}

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Run `fn(attempt)` and retry it on transient failures.
 *
 * @param {(attempt: number) => Promise<any>} fn
 * @param {object} [opts]
 * @param {number} [opts.retries=2] retries AFTER the first attempt, so the
 *   default is up to 3 total invocations.
 * @param {number} [opts.baseDelayMs=500]
 * @param {number} [opts.maxDelayMs=5000]
 * @param {(ms: number) => Promise<void>} [opts.sleep] injectable so tests
 *   never actually wait.
 * @param {(info: {attempt:number, retries:number, delayMs:number, error:Error}) => void} [opts.onRetry]
 *   called once per retry, BEFORE the wait — api.js uses it to journal and
 *   emit the retry so a resumed/inspected run shows the attempts, not just
 *   the final outcome.
 */
async function withRetry(fn, opts = {}) {
  const retries = Number.isFinite(opts.retries) && opts.retries >= 0 ? Math.floor(opts.retries) : DEFAULT_RETRIES;
  const sleep = opts.sleep || defaultSleep;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isTransient(err)) throw err;
      const delayMs = delayFor(attempt, opts);
      if (opts.onRetry) opts.onRetry({ attempt: attempt + 1, retries, delayMs, error: err });
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }
  throw lastError; // unreachable: the loop either returns or throws
}

module.exports = {
  isTransient,
  delayFor,
  withRetry,
  DEFAULT_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  TRANSIENT_CODES,
  TRANSIENT_PATTERNS,
};
