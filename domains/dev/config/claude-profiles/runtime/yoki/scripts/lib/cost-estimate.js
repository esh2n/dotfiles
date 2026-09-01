'use strict';

/**
 * Shared cost estimation for ECC hooks.
 *
 * Approximate per-1M-token blended rates (conservative defaults).
 */

const RATE_TABLE = {
  haiku: { in: 0.8, out: 4.0 },
  sonnet: { in: 3.0, out: 15.0 },
  opus: { in: 15.0, out: 75.0 }
};

/**
 * Estimate USD cost from token counts.
 * @param {string} model - Model name (may contain "haiku", "sonnet", or "opus")
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Estimated cost in USD (rounded to 6 decimal places)
 */
function estimateCost(model, inputTokens, outputTokens) {
  const normalized = String(model || '').toLowerCase();
  let rates = RATE_TABLE.sonnet;
  if (normalized.includes('haiku')) rates = RATE_TABLE.haiku;
  if (normalized.includes('opus')) rates = RATE_TABLE.opus;

  const cost = (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Per-1M-token rates for non-Claude harnesses' own model ids
 * (`core/harness-models.json`), keyed by the exact model id rather than the
 * fuzzy tier-name substring `estimateCost` uses above. Codex ids
 * ("gpt-5.1-codex-max") and most omp ids never contain "haiku"/"sonnet"/
 * "opus" text, so that substring match can't classify them — and silently
 * guessing "sonnet" for an unrecognized id would misprice it rather than
 * admit the price is unknown.
 *
 * omp's `haiku`/`sonnet`/`opus` tiers are literally Anthropic models
 * (`anthropic/claude-<tier>-5`), so they reuse the known RATE_TABLE values
 * above; `review`/`scout` are omp modelRoles that alias the same ids
 * (core/harness-models.json), so no separate entry is needed for them.
 * Codex's own per-token pricing is not established anywhere in this repo —
 * `null` here means "intentionally unpriced", not "forgot to fill in".
 */
const HARNESS_MODEL_RATES = {
  codex: {
    'gpt-5.1-codex-mini': null,
    'gpt-5.1-codex': null,
    'gpt-5.1-codex-max': null
  },
  omp: {
    'anthropic/claude-haiku-5': RATE_TABLE.haiku,
    'anthropic/claude-sonnet-5': RATE_TABLE.sonnet,
    'anthropic/claude-fable-5': RATE_TABLE.opus
  }
};

/**
 * Estimate USD cost from token counts for a non-Claude harness's own model id.
 * Returns `null` — never `NaN` or a guessed number — when `harness` is
 * unrecognized, `model` has no entry in `HARNESS_MODEL_RATES`, or the entry's
 * price is `null` (known model, unknown price).
 * @param {string} harness - 'codex' | 'omp'
 * @param {string} model - exact model id as it appears on the harness's own payload
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number|null}
 */
function estimateHarnessCost(harness, model, inputTokens, outputTokens) {
  const table = HARNESS_MODEL_RATES[harness];
  if (!table || !Object.prototype.hasOwnProperty.call(table, model)) return null;

  const rates = table[model];
  if (!rates) return null;

  const cost = (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = { estimateCost, RATE_TABLE, HARNESS_MODEL_RATES, estimateHarnessCost };
