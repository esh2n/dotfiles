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
