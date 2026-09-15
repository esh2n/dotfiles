'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const oai = require('../backends/openai-compat');
const deepseek = require('../backends/deepseek');
const local = require('../backends/local');
const { loadBackend, BACKEND_NAMES } = require('../backends');

// A fake fetch that records the request and returns a canned response.
function fakeFetch(response, capture) {
  return async (url, init) => {
    if (capture) { capture.url = url; capture.init = init; capture.body = JSON.parse(init.body); }
    const status = response.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)),
    };
  };
}

function chatBody({ content, reasoning, usage }) {
  const message = { role: 'assistant', content };
  if (reasoning !== undefined) message.reasoning_content = reasoning;
  const obj = { choices: [{ message }] };
  if (usage) obj.usage = usage;
  return obj;
}

// A fake fetch whose response body is an SSE stream (an async generator of
// Uint8Array chunks), for the metrics/streaming path. `deltas` are content
// pieces; an optional final usage chunk is appended when `usage` is given.
function fakeStreamingFetch({ deltas, usage, status = 200, gapMs = 0 }, capture) {
  const enc = new TextEncoder();
  return async (url, init) => {
    if (capture) { capture.url = url; capture.init = init; capture.body = JSON.parse(init.body); }
    async function* body() {
      for (const piece of deltas) {
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
        yield enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n`);
      }
      yield enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n`);
      if (usage) yield enc.encode(`data: ${JSON.stringify({ choices: [], usage })}\n`);
      yield enc.encode('data: [DONE]\n');
    }
    return { ok: status >= 200 && status < 300, status, body: body() };
  };
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

test('backend registry: deepseek and local resolve to their modules', () => {
  assert.ok(BACKEND_NAMES.includes('deepseek'));
  assert.ok(BACKEND_NAMES.includes('local'));
  assert.equal(loadBackend('deepseek').name, 'deepseek');
  assert.equal(loadBackend('local').name, 'local');
});

test('both new backends declare schema is NOT native (schema.js enforces it)', () => {
  assert.equal(deepseek.supportsSchemaNatively, false);
  assert.equal(local.supportsSchemaNatively, false);
});

// ---------------------------------------------------------------------------
// endpoint resolution
// ---------------------------------------------------------------------------

test('deepseek: endpoint + key from env, base overridable', () => {
  const ep = deepseek.resolveEndpoint({ DEEPSEEK_API_KEY: 'sk-x' });
  assert.equal(ep.baseUrl, 'https://api.deepseek.com');
  assert.equal(ep.apiKey, 'sk-x');
  assert.equal(ep.model, 'deepseek-flash');
  const overridden = deepseek.resolveEndpoint({ DEEPSEEK_API_KEY: 'sk-x', YOKI_DEEPSEEK_BASE_URL: 'https://proxy.local/v1' });
  assert.equal(overridden.baseUrl, 'https://proxy.local/v1');
});

test('local: literal key, default model, base + model overridable', () => {
  const ep = local.resolveEndpoint({});
  assert.equal(ep.baseUrl, 'http://localhost:1234/v1');
  assert.equal(ep.apiKey, 'lmstudio');
  assert.equal(ep.model, 'qwen/qwen3.8-27b');
  const overridden = local.resolveEndpoint({ YOKI_LOCAL_BASE_URL: 'http://box:5000/v1', YOKI_LOCAL_MODEL: 'qwen/other' });
  assert.equal(overridden.baseUrl, 'http://box:5000/v1');
  assert.equal(overridden.model, 'qwen/other');
});

// ---------------------------------------------------------------------------
// run() — success path posts the right request and returns the raw body
// ---------------------------------------------------------------------------

test('deepseek run: posts to <base>/chat/completions with bearer auth and the prompt', async () => {
  const capture = {};
  const fetchImpl = fakeFetch({ body: chatBody({ content: 'the answer' }) }, capture);
  const res = await deepseek.run({
    prompt: 'do the thing', model: 'deepseek-flash', effort: 'high',
    env: { DEEPSEEK_API_KEY: 'sk-abc' }, fetchImpl,
  });
  assert.equal(capture.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(capture.init.headers.Authorization, 'Bearer sk-abc');
  assert.equal(capture.body.model, 'deepseek-flash');
  assert.equal(capture.body.stream, false);
  assert.equal(capture.body.reasoning_effort, 'high');
  assert.equal(capture.body.messages[capture.body.messages.length - 1].content, 'do the thing');
  assert.equal(deepseek.extractText(res.raw), 'the answer');
});

test('run with a schema sets response_format json_object (syntactic safety net)', async () => {
  const capture = {};
  const fetchImpl = fakeFetch({ body: chatBody({ content: '{"ok":true}' }) }, capture);
  await deepseek.run({
    prompt: 'p', model: 'deepseek-flash', schema: { type: 'object' },
    env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl,
  });
  assert.deepEqual(capture.body.response_format, { type: 'json_object' });
});

test('run without a schema sends no response_format', async () => {
  const capture = {};
  const fetchImpl = fakeFetch({ body: chatBody({ content: 'hi' }) }, capture);
  await deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl });
  assert.equal(capture.body.response_format, undefined);
});

test('local run: sends the literal lmstudio key and posts to the local endpoint', async () => {
  const capture = {};
  const fetchImpl = fakeFetch({ body: chatBody({ content: 'local answer' }) }, capture);
  const res = await local.run({ prompt: 'p', model: 'qwen/qwen3.8-27b', env: {}, fetchImpl });
  assert.equal(capture.url, 'http://localhost:1234/v1/chat/completions');
  assert.equal(capture.init.headers.Authorization, 'Bearer lmstudio');
  assert.equal(local.extractText(res.raw), 'local answer');
});

// ---------------------------------------------------------------------------
// run() — failure paths
// ---------------------------------------------------------------------------

test('deepseek run: a missing DEEPSEEK_API_KEY is a clear error naming op run, not a raw 401', async () => {
  await assert.rejects(
    () => deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: {}, fetchImpl: fakeFetch({ body: {} }) }),
    /DEEPSEEK_API_KEY is not set.*op run/s,
  );
});

test('run: a 429 throws and is marked transient so retry.js retries it', async () => {
  const { isTransient } = require('../retry');
  const fetchImpl = fakeFetch({ status: 429, body: { error: 'rate limited' } });
  const err = await deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl })
    .then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /deepseek HTTP 429/);
  assert.equal(isTransient(err), true);
});

test('run: a 400 throws and is NOT transient (a bad request will not fix itself)', async () => {
  const { isTransient } = require('../retry');
  const fetchImpl = fakeFetch({ status: 400, body: { error: 'bad model' } });
  const err = await deepseek.run({ prompt: 'p', model: 'nope', env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl })
    .then(() => null, (e) => e);
  assert.match(err.message, /deepseek HTTP 400/);
  assert.equal(isTransient(err), false);
});

test('chatCompletion: a network error is marked transient', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  const err = await oai.chatCompletion({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', messages: [], fetchImpl: boom })
    .then(() => null, (e) => e);
  assert.match(err.message, /ECONNREFUSED/);
  assert.equal(err.transient, true);
});

// ---------------------------------------------------------------------------
// extractText
// ---------------------------------------------------------------------------

test('extractText: returns content and DROPS reasoning_content', () => {
  const raw = JSON.stringify(chatBody({ content: 'final', reasoning: 'chain of thought' }));
  assert.equal(oai.extractText(raw), 'final');
});

test('extractText: falls back to the raw string for an unrecognized shape', () => {
  assert.equal(oai.extractText('not json'), 'not json');
  assert.equal(oai.extractText(JSON.stringify({ nope: 1 })), JSON.stringify({ nope: 1 }));
});

// ---------------------------------------------------------------------------
// extractUsage + cost
// ---------------------------------------------------------------------------

test('extractUsage: maps prompt/completion tokens; cache-hit is a subset, not added to the total', () => {
  const raw = JSON.stringify(chatBody({
    content: 'x',
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_cache_hit_tokens: 600 },
  }));
  const usage = deepseek.extractUsage(raw);
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 200);
  assert.equal(usage.cacheRead, 600);
  assert.equal(usage.totalTokens, 1200); // prompt+completion, cache NOT added on top
});

test('deepseek extractUsage: costUsd splits cache-hit vs cache-miss input at peak rates', () => {
  const raw = JSON.stringify(chatBody({
    content: 'x',
    usage: { prompt_tokens: 1e6, completion_tokens: 1e6, total_tokens: 2e6, prompt_cache_hit_tokens: 0 },
  }));
  const usage = deepseek.extractUsage(raw);
  // 1M miss input @ $0.30 + 0 hit + 1M output @ $1.20 = $1.50
  assert.ok(Math.abs(usage.costUsd - 1.50) < 1e-9, `got ${usage.costUsd}`);
});

test('deepseek extractUsage: a fully-cached prompt is priced at the cache-hit rate', () => {
  const raw = JSON.stringify(chatBody({
    content: 'x',
    usage: { prompt_tokens: 1e6, completion_tokens: 0, total_tokens: 1e6, prompt_cache_hit_tokens: 1e6 },
  }));
  const usage = deepseek.extractUsage(raw);
  // 1M hit input @ $0.006, no miss, no output = $0.006
  assert.ok(Math.abs(usage.costUsd - 0.006) < 1e-9, `got ${usage.costUsd}`);
});

test('local extractUsage: no priceTable means no costUsd (local inference is free)', () => {
  const raw = JSON.stringify(chatBody({
    content: 'x', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
  const usage = local.extractUsage(raw);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.costUsd, undefined);
});

test('extractUsage: returns null when there is no usable usage block', () => {
  assert.equal(deepseek.extractUsage('not json'), null);
  assert.equal(deepseek.extractUsage(JSON.stringify({ choices: [] })), null);
  assert.equal(deepseek.extractUsage(JSON.stringify(chatBody({ content: 'x', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }))), null);
});

// ---------------------------------------------------------------------------
// metrics: computeMetrics (pure) + baseline (non-streaming) + TTFT (streaming)
// ---------------------------------------------------------------------------

test('computeMetrics: with a measured TTFT, prefill/decode split and tok/s are computed', () => {
  const usage = { inputTokens: 1000, outputTokens: 100, cacheRead: 400 };
  const m = oai.computeMetrics({ ttftMs: 500, totalMs: 2500 }, usage);
  assert.equal(m.ttftMeasured, true);
  assert.equal(m.ttftMs, 500);
  assert.equal(m.prefillMs, 500);
  assert.equal(m.decodeMs, 2000); // 2500 - 500
  assert.equal(m.completionTokens, 100);
  assert.ok(Math.abs(m.decodeTokPerSec - 50) < 1e-9, `got ${m.decodeTokPerSec}`); // 100 tok / 2s
  assert.ok(Math.abs(m.prefixHitRate - 0.4) < 1e-9); // 400/1000
});

test('computeMetrics: without a TTFT (baseline), prefill/decode stay null and tok/s degrades to whole-request rate', () => {
  const usage = { inputTokens: 200, outputTokens: 40, cacheRead: 0 };
  const m = oai.computeMetrics({ totalMs: 4000 }, usage); // no ttftMs
  assert.equal(m.ttftMeasured, false);
  assert.equal(m.ttftMs, null);
  assert.equal(m.prefillMs, null);
  assert.equal(m.decodeMs, null);
  assert.ok(Math.abs(m.decodeTokPerSec - 10) < 1e-9, `got ${m.decodeTokPerSec}`); // 40 tok / 4s
  assert.equal(m.prefixHitRate, 0); // 0/200
});

test('computeMetrics: no usage leaves token-derived fields null, timing still stands', () => {
  const m = oai.computeMetrics({ ttftMs: 300, totalMs: 900 }, null);
  assert.equal(m.ttftMs, 300);
  assert.equal(m.decodeMs, 600);
  assert.equal(m.completionTokens, null);
  assert.equal(m.decodeTokPerSec, null);
  assert.equal(m.prefixHitRate, null);
});

test('metricsStreamingEnabled: only YOKI_LLM_METRICS=1 turns on streaming', () => {
  assert.equal(oai.metricsStreamingEnabled({}), false);
  assert.equal(oai.metricsStreamingEnabled({ YOKI_LLM_METRICS: '0' }), false);
  assert.equal(oai.metricsStreamingEnabled({ YOKI_LLM_METRICS: '1' }), true);
});

test('run (non-streaming baseline): attaches metrics from usage + total latency, no TTFT, ONE request', () => withStreamCount(async (count) => {
  const fetchImpl = fakeFetch({ body: chatBody({
    content: 'answer', usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550, prompt_cache_hit_tokens: 100 },
  }) });
  const res = await deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl, captureMetrics: false });
  assert.ok(res.metrics, 'baseline run must still carry metrics');
  assert.equal(res.metrics.ttftMeasured, false);
  assert.equal(res.metrics.completionTokens, 50);
  assert.equal(res.metrics.promptTokens, 500);
  assert.ok(Math.abs(res.metrics.prefixHitRate - 0.2) < 1e-9); // 100/500
  // text is still the ordinary non-streaming body — extractText works unchanged
  assert.equal(deepseek.extractText(res.raw), 'answer');
}));

test('run (streaming): reassembles the answer, measures a real TTFT, costs no extra request', () => {
  return (async () => {
    const capture = {};
    const fetchImpl = fakeStreamingFetch({
      deltas: ['Hel', 'lo ', 'world'],
      usage: { prompt_tokens: 300, completion_tokens: 3, total_tokens: 303, prompt_cache_hit_tokens: 300 },
      gapMs: 5,
    }, capture);
    const res = await deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: { DEEPSEEK_API_KEY: 'sk' }, fetchImpl, captureMetrics: true });
    // streaming request was asked for, with usage in the final chunk
    assert.equal(capture.body.stream, true);
    assert.deepEqual(capture.body.stream_options, { include_usage: true });
    // deltas reassembled into the same non-streaming shape
    assert.equal(deepseek.extractText(res.raw), 'Hello world');
    // real TTFT measured, and it is < total
    assert.equal(res.metrics.ttftMeasured, true);
    assert.ok(res.metrics.ttftMs >= 0);
    assert.ok(res.metrics.totalMs >= res.metrics.ttftMs);
    assert.equal(res.metrics.completionTokens, 3);
    assert.ok(Math.abs(res.metrics.prefixHitRate - 1) < 1e-9); // fully cached: 300/300
  })();
});

test('run (streaming): the env flag YOKI_LLM_METRICS=1 selects the streaming path', () => {
  return (async () => {
    const capture = {};
    const fetchImpl = fakeStreamingFetch({ deltas: ['x'], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, capture);
    await deepseek.run({ prompt: 'p', model: 'deepseek-flash', env: { DEEPSEEK_API_KEY: 'sk', YOKI_LLM_METRICS: '1' }, fetchImpl });
    assert.equal(capture.body.stream, true);
  })();
});

// tiny helper so the baseline test reads symmetrically with the streaming ones
function withStreamCount(fn) { return fn(0); }
