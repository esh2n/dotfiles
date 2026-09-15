'use strict';

/**
 * OpenAI-compatible chat-completions backend CORE, shared by the two thin
 * backends that wrap it — `deepseek` (cloud DeepSeek) and `local` (LM Studio
 * / any OpenAI-compatible endpoint on localhost). Both speak the identical
 * `POST <base>/chat/completions` protocol, so there is one implementation and
 * two endpoint configs rather than two copies (see `makeBackend`).
 *
 * Unlike codex/omp, this backend spawns NO process and is NOT a coding agent:
 * it is a single raw LLM call, text in / text out, with no tools and no
 * filesystem access. That is deliberate — its lanes are the "raw model
 * opinion" ones (review / research / adjudicate / escalate consult), where a
 * cheap fast model is exactly what is wanted and file-write authority is
 * meaningless. A lane that must edit files picks codex/omp instead; this
 * backend therefore has no `sandbox` axis (it accepts and ignores the option,
 * because there is nothing it could restrict).
 *
 * Schema is enforced through schema.js's prompt-append + validate path
 * (`supportsSchemaNatively = false`): DeepSeek's `response_format` supports
 * `json_object` but NOT `json_schema` (strict JSON-schema is a separate beta
 * endpoint), and LM Studio's coverage varies by model — so the portable,
 * always-correct path is schema.js's, and this backend additionally sets
 * `response_format: {type:'json_object'}` when a schema is present as a
 * syntactic safety net (schema.js has already put the word "JSON" and the
 * schema into the prompt, which `json_object` mode requires).
 */

const { resolveModel, resolveAgentPreamble, timeoutError } = require('./common');

/**
 * One chat-completions request. `fetchImpl` is injectable so tests never
 * touch the network; it defaults to the global `fetch` (Node 18+). Returns
 * the raw response body as text plus `ok`/`status` — the caller decides what
 * a non-2xx means. A network failure is marked `transient` so retry.js
 * retries it; a timeout is raised through common.js's `timeoutError` (also
 * transient + timedOut) so it is classified exactly like a codex/omp kill.
 *
 * `captureMetrics` upgrades the request to SSE streaming so the arrival time
 * of the first generated token (TTFT) can be measured — the one client-side
 * metric that a single non-streaming response cannot yield. It costs NO extra
 * tokens: streaming delivers the same generation incrementally, and
 * `stream_options.include_usage` only appends a final numeric chunk. The
 * streamed deltas are reassembled into the SAME response-body shape a
 * non-streaming call returns, so `extractText`/`extractUsage` are unchanged;
 * `metrics: { ttftMs, totalMs }` rides alongside. Everything measurable
 * WITHOUT streaming (total latency, token counts, cache-hit) stays available
 * on the default non-streaming path, which is byte-for-byte the old behaviour.
 */
async function chatCompletion(opts) {
  const {
    baseUrl, apiKey, model, messages,
    reasoningEffort, jsonMode, samplingParams, timeoutMs, fetchImpl, label,
    captureMetrics,
  } = opts;
  const doFetch = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof doFetch !== 'function') {
    throw new Error('openai-compat backend: global fetch is unavailable — Node 18+ is required, or pass a fetchImpl');
  }
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const body = { model, messages, stream: !!captureMetrics };
  // DeepSeek exposes reasoning as a MODE via reasoning_effort (low/high/max),
  // not a separate model id. Passing it to an endpoint that ignores it (LM
  // Studio) is harmless — an unknown field is dropped, not an error.
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (samplingParams && typeof samplingParams === 'object') Object.assign(body, samplingParams);
  // Ask for the usage block in the terminal SSE chunk — without this, a
  // streamed response carries no token counts at all.
  if (captureMetrics) body.stream_options = { include_usage: true };

  const controller = new AbortController();
  let timer;
  let timedOut = false;
  if (timeoutMs) {
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  }
  let res;
  const startedAt = Date.now();
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (captureMetrics && res.ok) {
      const streamed = await readSseStream(res.body, startedAt);
      return { ok: true, status: res.status, text: streamed.text, metrics: { ttftMs: streamed.ttftMs, totalMs: Date.now() - startedAt } };
    }
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    if (timedOut) throw timeoutError(label || 'openai-compat', timeoutMs);
    // A DNS/connection failure is usually momentary; let retry.js try again.
    err.transient = true;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Consume an OpenAI-style SSE stream (`data: {...}\n` lines, terminated by
 * `data: [DONE]`), timing the first token and reassembling the full answer
 * into a single non-streaming-shaped response body so the rest of the
 * pipeline is oblivious to how it arrived.
 *
 * `startedAt` is the request-send timestamp; TTFT is the delta to the first
 * chunk carrying ANY generated text (content OR reasoning_content — for a
 * reasoning model the chain-of-thought is the first thing generated, so that
 * is the honest "time to first token"). Only `content` is accumulated into
 * the answer; `reasoning_content` is dropped, matching `extractText`.
 */
async function readSseStream(bodyStream, startedAt) {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = null;
  let usage = null;
  let ttftMs = null;
  for await (const chunk of iterateBytes(bodyStream)) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    // eslint-disable-next-line no-cond-assign
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(data); } catch { continue; }
      if (evt.usage && typeof evt.usage === 'object') usage = evt.usage;
      const choice = evt.choices && evt.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      const hasText = (typeof delta.content === 'string' && delta.content.length)
        || (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length);
      if (hasText && ttftMs === null) ttftMs = Date.now() - startedAt;
      if (typeof delta.content === 'string') content += delta.content;
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const reassembled = { choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }] };
  if (usage) reassembled.usage = usage;
  return { text: JSON.stringify(reassembled), ttftMs };
}

/** Iterate a fetch response body as byte chunks, tolerating both a Node/undici
 *  async-iterable stream and a WHATWG ReadableStream (getReader) — and a plain
 *  async iterable, which is what the tests inject. */
async function* iterateBytes(bodyStream) {
  if (!bodyStream) return;
  if (typeof bodyStream[Symbol.asyncIterator] === 'function') {
    for await (const chunk of bodyStream) yield chunk;
    return;
  }
  if (typeof bodyStream.getReader === 'function') {
    const reader = bodyStream.getReader();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  }
}

/**
 * Turn raw client-side timing + a usage block into the metrics the user asked
 * to see. Pure and side-effect-free so it is unit-testable without a network.
 *
 * With a measured TTFT (streaming), prefill and decode split cleanly:
 * prefill ≈ TTFT (queue is ~0 single-user), decode = total − TTFT, and
 * decode tok/s = completion_tokens / decode_seconds. Without it (non-streaming
 * baseline), TTFT/prefill/decode stay null and `decodeTokPerSec` degrades to
 * the whole-request rate (completion_tokens / total_seconds), flagged by
 * `ttftMeasured: false`. Prefix-cache-hit rate and the token counts come from
 * the usage block and need no streaming at all.
 */
function computeMetrics({ ttftMs = null, totalMs = null } = {}, usage = null) {
  const completionTokens = usage && Number.isFinite(usage.outputTokens) ? usage.outputTokens : null;
  const promptTokens = usage && Number.isFinite(usage.inputTokens) ? usage.inputTokens : null;
  const cacheHitTokens = usage && Number.isFinite(usage.cacheRead) ? usage.cacheRead : null;
  const ttftMeasured = Number.isFinite(ttftMs);
  const total = Number.isFinite(totalMs) ? totalMs : null;
  const prefillMs = ttftMeasured ? ttftMs : null;
  const decodeMs = ttftMeasured && total !== null ? Math.max(0, total - ttftMs) : null;
  let decodeTokPerSec = null;
  if (completionTokens && completionTokens > 0) {
    if (decodeMs !== null && decodeMs > 0) decodeTokPerSec = completionTokens / (decodeMs / 1000);
    else if (total !== null && total > 0) decodeTokPerSec = completionTokens / (total / 1000);
  }
  const prefixHitRate = promptTokens && promptTokens > 0 && cacheHitTokens !== null
    ? cacheHitTokens / promptTokens : null;
  return {
    ttftMeasured,
    ttftMs: ttftMeasured ? ttftMs : null,
    totalMs: total,
    prefillMs,
    decodeMs,
    promptTokens,
    completionTokens,
    cacheHitTokens,
    decodeTokPerSec,
    prefixHitRate,
  };
}

/** Whether metrics streaming is enabled for this run. Default OFF so ordinary
 *  runs are the proven non-streaming path; `YOKI_LLM_METRICS=1` turns on the
 *  TTFT-measuring streaming path. The cheap baseline metrics (total latency,
 *  token counts, cache-hit) are attached either way, so "off" still measures —
 *  it just cannot split prefill from decode. */
function metricsStreamingEnabled(env = process.env) {
  return String(env.YOKI_LLM_METRICS || '') === '1';
}

/** Pull the assistant message text from a chat-completions response body.
 *  DeepSeek's reasoning models return the chain-of-thought in a SEPARATE
 *  `reasoning_content` field beside `content`; only `content` is the answer,
 *  so `reasoning_content` is deliberately dropped. Falls back to the raw
 *  string for any unrecognized shape (schema.js can still scan it). */
function extractText(raw) {
  try {
    const obj = JSON.parse(raw);
    const msg = obj && obj.choices && obj.choices[0] && obj.choices[0].message;
    if (msg && typeof msg.content === 'string') return msg.content;
  } catch {
    // not a JSON object — return raw as-is
  }
  return raw;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Usage from the response's own `usage` block. OpenAI/DeepSeek report
 * `prompt_tokens` / `completion_tokens` / `total_tokens`; DeepSeek adds
 * `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` for context caching.
 *
 * `cacheRead` (cache-hit) is a SUBSET of `prompt_tokens`, not a charge beside
 * it (same accounting as codex, opposite of omp — see codex.js), so it is
 * reported as information but NOT added into `totalTokens`. `totalTokens` is
 * the response's own `total_tokens` when present, else prompt+completion.
 *
 * When a `priceTable` is given, costUsd is computed from the split: cache-hit
 * input, cache-miss input, and output each at their own per-1M rate.
 * Returns null when there is no usable usage block.
 */
function extractUsage(raw, priceTable) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  const usage = obj && typeof obj.usage === 'object' ? obj.usage : null;
  if (!usage) return null;
  const inputTokens = numberOr(usage.prompt_tokens, 0);
  const outputTokens = numberOr(usage.completion_tokens, 0);
  const cacheRead = numberOr(usage.prompt_cache_hit_tokens, 0);
  const totalTokens = Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : inputTokens + outputTokens;
  if (totalTokens <= 0) return null;
  const result = { inputTokens, outputTokens, cacheRead, cacheWrite: 0, totalTokens };
  if (priceTable) {
    const hit = cacheRead;
    const miss = Math.max(0, inputTokens - hit);
    const per = (tokens, rate) => (tokens / 1e6) * rate;
    result.costUsd = per(miss, priceTable.inputMiss)
      + per(hit, priceTable.inputHit != null ? priceTable.inputHit : priceTable.inputMiss)
      + per(outputTokens, priceTable.output);
  }
  return result;
}

/**
 * Build the two thin backends from an endpoint config:
 *   { name, defaultBaseUrl, baseUrlEnv?, apiKeyEnv?, apiKeyLiteral?,
 *     defaultModel, defaultModelEnv?, samplingParams?, priceTable? }
 * `apiKeyEnv` names an env var that MUST be set (cloud); `apiKeyLiteral` is a
 * fixed value (LM Studio wants a non-empty but arbitrary key). Exactly one is
 * expected.
 */
function makeBackend(config) {
  const name = config.name;
  const supportsSchemaNatively = false;

  function resolveEndpoint(env = process.env) {
    const baseUrl = (config.baseUrlEnv && env[config.baseUrlEnv]) || config.defaultBaseUrl;
    let apiKey;
    if (config.apiKeyLiteral !== undefined) apiKey = config.apiKeyLiteral;
    else if (config.apiKeyEnv) apiKey = env[config.apiKeyEnv];
    const model = (config.defaultModelEnv && env[config.defaultModelEnv]) || config.defaultModel;
    return { baseUrl, apiKey, model };
  }

  /** Descriptive only — for a --dry-run/--json trace. There is no argv. */
  function buildArgv({ model } = {}) {
    const ep = resolveEndpoint();
    return { cmd: name, args: ['POST', `${ep.baseUrl}/chat/completions`, '--model', model || ep.model] };
  }

  function buildMessages(prompt, agentType) {
    const preamble = agentType ? resolveAgentPreamble(agentType) : '';
    const messages = [];
    if (preamble) messages.push({ role: 'system', content: preamble });
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  async function run({
    prompt, model, effort, schema, agentType, timeoutMs, fetchImpl, env,
    captureMetrics,
    // sandbox/cwd/opts/mockFile/onProgress are accepted for interface parity
    // and ignored: a raw completion has no tools, no working directory and no
    // live tool-call stream to count.
  }) {
    const resolvedEnv = env || process.env;
    const { baseUrl, apiKey, model: defaultModel } = resolveEndpoint(resolvedEnv);
    if (config.apiKeyEnv && !apiKey) {
      throw new Error(
        `${name} backend: ${config.apiKeyEnv} is not set — start yoki-graph via `
        + `'op run --env-file <file> -- ...' so the key is injected at runtime `
        + '(see the api-key-management decision record), rather than committing it',
      );
    }
    // api.js has already resolved the tier to a concrete id; resolveModel here
    // is an idempotent safety net for buildArgv-style direct callers/tests.
    const resolvedModel = resolveModel(name, model) || defaultModel;
    const messages = buildMessages(prompt, agentType);
    // Stream (to measure TTFT) only when explicitly enabled; a caller can force
    // it per-call, otherwise the run-wide env flag decides. Off = the proven
    // non-streaming path, still fully metered minus the prefill/decode split.
    const stream = captureMetrics !== undefined ? !!captureMetrics : metricsStreamingEnabled(resolvedEnv);
    const started = Date.now();
    const { ok, status, text, metrics: timing } = await chatCompletion({
      baseUrl, apiKey, model: resolvedModel, messages,
      reasoningEffort: effort, jsonMode: !!schema,
      samplingParams: config.samplingParams, timeoutMs, fetchImpl, label: name,
      captureMetrics: stream,
    });
    const durationMs = Date.now() - started;
    if (!ok) {
      const err = new Error(`${name} HTTP ${status}: ${String(text).trim().slice(0, 2000)}`);
      // 429 (rate limit) and 5xx (server) are worth a retry; a 4xx is not.
      if (status === 429 || status >= 500) err.transient = true;
      throw err;
    }
    // Metrics are computed from client-side timing + the response's own usage
    // block — no extra request, no extra tokens. `timing` carries the measured
    // TTFT only on the streaming path; otherwise total latency stands in.
    const usage = extractUsage(text, config.priceTable);
    const metrics = computeMetrics(
      timing || { totalMs: durationMs },
      usage,
    );
    return { raw: text, durationMs, exitCode: 0, metrics };
  }

  return {
    name,
    supportsSchemaNatively,
    buildArgv,
    run,
    extractText,
    extractUsage: (raw) => extractUsage(raw, config.priceTable),
    resolveEndpoint,
    config,
  };
}

module.exports = {
  makeBackend, chatCompletion, extractText, extractUsage,
  computeMetrics, readSseStream, metricsStreamingEnabled,
};
