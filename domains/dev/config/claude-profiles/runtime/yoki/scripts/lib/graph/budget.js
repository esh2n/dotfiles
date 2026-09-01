'use strict';

/**
 * Per-run execution caps — the runaway-loop backstop guard.js's DAILY cap
 * cannot provide.
 *
 * guard.js stops the Nth *launch* of the day; nothing stopped a single
 * launch from spinning `while (budget.remaining() > 0) await agent(...)`
 * forever, which is exactly the loop `budget.remaining()` used to invite by
 * always answering `Infinity`. These caps are checked inside `agent()`
 * itself, before anything is spawned, and a breach is a HARD failure (a
 * thrown `BudgetExceededError` that `parallel()`/`pipeline()` re-raise
 * instead of swallowing into `null`) — a cap that degrades to `null` is a
 * cap the runaway loop keeps running past.
 *
 * Resolution order for each cap: explicit run option (CLI flag) ->
 * `.yoki.json` (searched from `cwd` upward, same file guard.js reads) ->
 * environment variable -> built-in default. A value of 0 or below means
 * "no cap" (Infinity), so a project can opt out per cap without deleting
 * the key.
 */

const { findYokiConfig } = require('./guard');

/** Matches both prior-art runners' agent ceiling. High enough that no real
 *  workflow in this repo comes close (the biggest fans out ~25 calls), low
 *  enough that an unbounded loop dies in minutes instead of hours. */
const DEFAULT_MAX_AGENT_CALLS = 1000;

const CAP_KEYS = [
  { name: 'maxAgentCalls', configKey: 'graphMaxAgentCalls', envKey: 'YOKI_GRAPH_MAX_AGENT_CALLS', fallback: DEFAULT_MAX_AGENT_CALLS },
  { name: 'maxTokens', configKey: 'graphMaxTokens', envKey: 'YOKI_GRAPH_MAX_TOKENS', fallback: Infinity },
  { name: 'maxWallMs', configKey: 'graphMaxWallMs', envKey: 'YOKI_GRAPH_MAX_WALL_MS', fallback: Infinity },
  // Run-level idle watchdog ceiling (ms): terminate the worker after this long
  // with no agent() activity. Off by default (Infinity). Resolved through the
  // same four-source order as its siblings, so it can be set via .yoki.json
  // (`graphIdleTimeoutMs`), not only the run option / env var.
  { name: 'idleTimeoutMs', configKey: 'graphIdleTimeoutMs', envKey: 'YOKI_GRAPH_IDLE_MS', fallback: Infinity },
];

class BudgetExceededError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'BudgetExceededError';
    // Never retried: retrying a cap breach just breaches it again.
    this.transient = false;
    this.kind = detail.kind;
    this.limit = detail.limit;
    this.used = detail.used;
  }
}

/** A number, Infinity for "no cap", or undefined when the source said nothing. */
function normalizeCap(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n <= 0 ? Infinity : n;
}

/**
 * @param {string} [cwd] directory the `.yoki.json` search starts from
 * @param {object} [overrides] run options: `{maxAgentCalls, maxTokens, maxWallMs}`
 * @param {object} [env]
 * @returns {{maxAgentCalls:number, maxTokens:number, maxWallMs:number, sources:object}}
 */
function resolveCaps(cwd, overrides = {}, env = process.env) {
  const config = findYokiConfig(cwd || process.cwd()) || {};
  const caps = {};
  const sources = {};
  for (const { name, configKey, envKey, fallback } of CAP_KEYS) {
    const fromOption = normalizeCap(overrides[name]);
    const fromConfig = normalizeCap(config[configKey]);
    const fromEnv = normalizeCap(env[envKey]);
    if (fromOption !== undefined) { caps[name] = fromOption; sources[name] = 'option'; }
    else if (fromConfig !== undefined) { caps[name] = fromConfig; sources[name] = '.yoki.json'; }
    else if (fromEnv !== undefined) { caps[name] = fromEnv; sources[name] = 'env'; }
    else { caps[name] = fallback; sources[name] = 'default'; }
  }
  caps.sources = sources;
  return caps;
}

/**
 * Throw if this run has already reached any cap. Called by `agent()` before
 * the call is dispatched (and before the dry-run short-circuit — a dry run
 * with a runaway loop still needs to stop).
 */
function assertWithinCaps(caps, { callsMade = 0, tokensSpent = 0, elapsedMs = 0 } = {}) {
  if (callsMade >= caps.maxAgentCalls) {
    throw new BudgetExceededError(
      `graph budget: agent() call cap reached (${callsMade}/${caps.maxAgentCalls}) — raise graphMaxAgentCalls in .yoki.json or pass --max-agent-calls`,
      { kind: 'agentCalls', limit: caps.maxAgentCalls, used: callsMade },
    );
  }
  if (tokensSpent >= caps.maxTokens) {
    throw new BudgetExceededError(
      `graph budget: token cap reached (${tokensSpent}/${caps.maxTokens}) — raise graphMaxTokens in .yoki.json or pass --max-tokens`,
      { kind: 'tokens', limit: caps.maxTokens, used: tokensSpent },
    );
  }
  if (elapsedMs >= caps.maxWallMs) {
    throw new BudgetExceededError(
      `graph budget: wall-clock cap reached (${Math.round(elapsedMs)}ms/${caps.maxWallMs}ms) — raise graphMaxWallMs in .yoki.json or pass --max-wall-ms`,
      { kind: 'wallMs', limit: caps.maxWallMs, used: Math.round(elapsedMs) },
    );
  }
}

/**
 * The script-facing `budget` global. Unlike the old always-`Infinity`
 * placeholder, `remaining()` is the real headroom under `graphMaxTokens`
 * whenever a token cap exists, and `total` reports that cap.
 */
function createBudget(caps, journal) {
  return {
    get total() { return Number.isFinite(caps.maxTokens) ? caps.maxTokens : null; },
    spent() { return journal.tokensSpent(); },
    remaining() {
      if (!Number.isFinite(caps.maxTokens)) return Infinity;
      return Math.max(0, caps.maxTokens - journal.tokensSpent());
    },
  };
}

module.exports = {
  BudgetExceededError,
  resolveCaps,
  assertWithinCaps,
  createBudget,
  normalizeCap,
  DEFAULT_MAX_AGENT_CALLS,
  CAP_KEYS,
};
