'use strict';

/**
 * `deepseek` backend — cloud DeepSeek over its OpenAI-compatible endpoint.
 * A thin config over backends/openai-compat.js.
 *
 * Endpoint: https://api.deepseek.com (override with YOKI_DEEPSEEK_BASE_URL).
 * Key: DEEPSEEK_API_KEY, injected at runtime via `op run --env-file` — never
 * committed (see the api-key-management decision record). A missing key is a
 * clear error telling you to launch under `op run`, not a raw 401.
 *
 * Models (2026-09 current docs): `deepseek-flash` (cheap/fast, the default and
 * the `main`/`deterministic`-cloud tier) and `deepseek-v4-pro` (higher
 * capability). Reasoning is a MODE toggled by `reasoning_effort`, not a
 * separate model id — the tier map lives in core/harness-models.json under
 * "deepseek" ({flash, pro}).
 *
 * priceTable is DeepSeek's PEAK per-1M pricing (2026-09): off-peak is half,
 * but cost is booked at peak so the budget never under-reports. cache-hit
 * input is a subset of prompt_tokens (openai-compat.js does not double-count
 * it into totalTokens); it is still priced at its own cheaper rate.
 */

const { makeBackend } = require('./openai-compat');

const PRICE_TABLE = {
  // USD per 1,000,000 tokens, deepseek-flash, peak rate (2026-09).
  inputMiss: 0.30,
  inputHit: 0.006,
  output: 1.20,
};

module.exports = makeBackend({
  name: 'deepseek',
  defaultBaseUrl: 'https://api.deepseek.com',
  baseUrlEnv: 'YOKI_DEEPSEEK_BASE_URL',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-flash',
  priceTable: PRICE_TABLE,
});
