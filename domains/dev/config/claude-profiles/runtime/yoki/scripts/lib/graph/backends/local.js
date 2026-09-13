'use strict';

/**
 * `local` backend — a local OpenAI-compatible server (LM Studio by default)
 * for the deterministic/offline tier (Qwen3.8-27B). A thin config over
 * backends/openai-compat.js, identical protocol to `deepseek`; the only
 * differences are the endpoint and that there is no cost and no real key.
 *
 * Endpoint: http://localhost:1234/v1 (LM Studio's default; override with
 * YOKI_LOCAL_BASE_URL). LM Studio requires a non-empty but otherwise
 * arbitrary key, so a literal "lmstudio" is sent rather than reading an env
 * var. Model defaults to qwen/qwen3.8-27b (override with YOKI_LOCAL_MODEL);
 * the tier map lives in core/harness-models.json under "local" ({qwen}).
 *
 * No priceTable: local inference is free, so api.js reports its usage with a
 * zero cost rather than a fabricated dollar figure.
 */

const { makeBackend } = require('./openai-compat');

module.exports = makeBackend({
  name: 'local',
  defaultBaseUrl: 'http://localhost:1234/v1',
  baseUrlEnv: 'YOKI_LOCAL_BASE_URL',
  apiKeyLiteral: 'lmstudio',
  defaultModel: 'qwen/qwen3.8-27b',
  defaultModelEnv: 'YOKI_LOCAL_MODEL',
});
