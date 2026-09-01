'use strict';

/**
 * `codex exec` backend:
 *   codex exec --skip-git-repo-check -C <cwd> -s <sandbox> --json
 *     -m <m> [--output-schema <tmpfile>] -
 * with the prompt written to stdin and stdin CLOSED — S1 spike: `codex exec`
 * hangs forever waiting for more stdin if it isn't. `spawnCollect` in
 * backends/common.js always closes stdin after writing, which is why this
 * backend (and omp, which takes the prompt as an argv value instead) both
 * go through it uniformly.
 *
 * `--output-schema <FILE>` is a real structured-output flag (confirmed via
 * `codex exec --help`), so schema is enforced natively via a temp schema
 * file rather than schema.js's prompt-append fallback.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resolveModel, resolveAgentPreamble, spawnCollect, timeoutError, makeLineSplitter } = require('./common');
const { toStrictJsonSchema } = require('../schema');

const name = 'codex';
const supportsSchemaNatively = true;

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * `codex exec`'s own default is read-only, and this backend used to widen
 * every call to workspace-write unconditionally — so review, research,
 * code-study, stocktake and design-review, whose prompts are assembled from
 * untrusted material (diff hunks, fetched pages, artifact comments), ran in
 * the user's real checkout with the filesystem write capability only
 * implement/preflight/go-optimize actually need. The default here is now
 * codex's own; a workflow script that writes says so per call
 * (`agent(prompt, { sandbox: 'workspace-write' })`).
 */
const DEFAULT_SANDBOX = 'read-only';

function resolveSandbox(sandbox) {
  if (sandbox === undefined || sandbox === null || sandbox === '') return DEFAULT_SANDBOX;
  const mode = String(sandbox);
  if (!SANDBOX_MODES.includes(mode)) {
    throw new Error(`codex backend: unknown sandbox "${mode}" (expected one of ${SANDBOX_MODES.join(', ')})`);
  }
  return mode;
}

/**
 * Pure argv builder. `schemaFilePath` is passed in (rather than written
 * here) so tests can assert the argv shape without touching the
 * filesystem; `run()` below is what actually writes the schema file.
 */
function buildArgv({ model, cwd, schema, schemaFilePath, agentType, sandbox }) {
  const resolvedModel = resolveModel('codex', model);
  const args = ['exec', '--skip-git-repo-check', '-C', cwd, '-s', resolveSandbox(sandbox), '--json'];
  if (resolvedModel) args.push('-m', resolvedModel);
  if (schema && schemaFilePath) args.push('--output-schema', schemaFilePath);
  args.push('-'); // read the prompt from stdin
  return { cmd: 'codex', args };
}

function buildPrompt(prompt, agentType) {
  const preamble = agentType ? resolveAgentPreamble(agentType) : '';
  return preamble ? `${preamble}\n\n${prompt}` : prompt;
}

/**
 * Does this `codex exec --json` event represent the agent STARTING a tool
 * call? Counting begins-only (never the matching end) keeps the number a
 * count of tool calls rather than of events, and covers both event
 * vocabularies the stream uses: the newer `item.started` items whose type
 * names a command/tool/patch, and the older `msg.type` `*_begin` names.
 */
function isToolCallEvent(evt) {
  if (!evt || typeof evt !== 'object') return false;
  const msgType = evt.msg && typeof evt.msg.type === 'string' ? evt.msg.type : '';
  if (/^(exec_command|mcp_tool_call|patch_apply|web_search)_begin$/.test(msgType)) return true;
  if (evt.type === 'item.started' && evt.item && typeof evt.item.type === 'string') {
    return /command|tool|file_change|patch|web_search/.test(evt.item.type);
  }
  return false;
}

/** Count tool-call starts as the stream arrives; report each increment. */
function makeProgressCounter(onProgress) {
  if (typeof onProgress !== 'function') return undefined;
  let toolCalls = 0;
  return makeLineSplitter((line) => {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    if (!isToolCallEvent(evt)) return;
    toolCalls += 1;
    onProgress({ toolCalls });
  });
}

async function run({ prompt, model, effort, schema, agentType, cwd, timeoutMs, sandbox, onProgress }) {
  let schemaFilePath = null;
  if (schema) {
    schemaFilePath = path.join(os.tmpdir(), `yoki-graph-codex-schema-${crypto.randomBytes(6).toString('hex')}.json`);
    // STRICT copy on the wire, loose schema for validation: OpenAI-style
    // structured output requires additionalProperties:false and every key in
    // `required`, and the workflow scripts in this repo all declare loose
    // schemas with genuinely optional properties. Writing those out verbatim
    // meant codex either rejected the schema or ignored the optionality —
    // see schema.js's toStrictJsonSchema. What the script gets back is still
    // checked against the schema the script itself wrote.
    fs.writeFileSync(schemaFilePath, JSON.stringify(toStrictJsonSchema(schema)));
  }
  try {
    const { args } = buildArgv({ model, cwd, schema, schemaFilePath, agentType, sandbox });
    // effort: codex exec has no documented --effort/reasoning flag as of
    // this writing (checked `codex exec --help`) — folded into the prompt
    // instead of guessed at via an unverified `-c` config key.
    const promptText = buildPrompt(
      effort ? `${prompt}\n\n(Reasoning effort requested: ${effort})` : prompt,
      agentType,
    );
    const started = Date.now();
    const { stdout, stderr, code, timedOut } = await spawnCollect('codex', args, {
      cwd, input: promptText, timeoutMs, onData: makeProgressCounter(onProgress),
    });
    const durationMs = Date.now() - started;
    if (timedOut) throw timeoutError('codex exec', timeoutMs);
    if (code !== 0 && !stdout.trim()) {
      throw new Error(`codex exec exited ${code}: ${stderr.trim().slice(0, 2000)}`);
    }
    return { raw: stdout, stderr, durationMs, exitCode: code };
  } finally {
    if (schemaFilePath) { try { fs.unlinkSync(schemaFilePath); } catch { /* best-effort cleanup */ } }
  }
}

/**
 * `codex exec --json` prints one JSON event per line (agent_message,
 * task_complete, ...). Pull the last `agent_message`/`item.completed`
 * text-bearing event's text; fall back to the raw stream when nothing
 * recognizable is found (schema.js's extractor will then scan the whole
 * stream for a balanced JSON object, which still works for a JSON answer
 * embedded in one of those lines).
 */
function extractText(raw) {
  const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      const text = evt && (evt.msg && evt.msg.message) || (evt.item && evt.item.text) || evt.text;
      if (typeof text === 'string') lastText = text;
    } catch {
      // not a JSON line — ignore
    }
  }
  return lastText !== null ? lastText : raw;
}

/**
 * Token usage from `codex exec --json`'s own event stream — the primary
 * source, not a guess from the answer's length.
 *
 * Two shapes, both real:
 * - `{"type":"turn.completed","usage":{"input_tokens","cached_input_tokens",
 *   "output_tokens"}}` — the exec stream's per-turn total. Summed across
 *   turns, because one `codex exec` can take several.
 * - `{"type":"event_msg","payload":{"type":"token_count","info":{
 *   "total_token_usage":{...}}}}` — the rollout-file record shape (the same
 *   keys lib/harness/session.js reads, pinned there to spike S1-S2). Used
 *   only when no `turn.completed` arrived, and read as an absolute session
 *   total rather than summed.
 *
 * Returns null when neither is present; api.js then falls back to an
 * explicitly-labelled estimate rather than silently reporting zero.
 */
function extractUsage(raw) {
  let summed = null;
  let lastTotal = null;
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; }
    if (!evt || typeof evt !== 'object') continue;

    if (evt.type === 'turn.completed' && evt.usage && typeof evt.usage === 'object') {
      summed = addUsage(summed, evt.usage);
      continue;
    }
    const payload = evt.payload;
    if (payload && payload.type === 'token_count' && payload.info) {
      const info = payload.info.total_token_usage || payload.info.last_token_usage;
      if (info && typeof info === 'object') lastTotal = normalizeCodexUsage(info);
    }
  }
  return summed || lastTotal;
}

/**
 * One codex usage block -> this repo's common usage shape.
 *
 * `totalTokens` is `input_tokens + output_tokens` and deliberately does NOT
 * add the cached counts. In OpenAI/codex accounting `cached_input_tokens`
 * (and `cache_write_input_tokens`) are a SUBSET of `input_tokens` — the part
 * of the same prompt that was served from cache — not a separate charge on
 * top of it. Adding them double-counted every cached prefix: a real review
 * run reported 7.46M tokens where the true figure was ~4.1M, because e.g.
 * `{input 77961, output 884, cacheRead 57856}` was booked as 136701 instead
 * of 78845.
 *
 * `cacheRead`/`cacheWrite` are still returned, as INFORMATION: how much of
 * the input was cached is worth seeing (the per-model table prints it in its
 * own "cached" column), it just is not extra spend.
 *
 * omp is the opposite case and stays as it is — see backends/omp.js: there
 * `input` is ~2 tokens next to a 50k `cacheRead`, and the record's own
 * `totalTokens` equals `input+output+cacheRead+cacheWrite`, so omp's cached
 * counts are disjoint from its input and DO belong in the total. API.md
 * records the difference.
 */
function normalizeCodexUsage(usage) {
  const inputTokens = numberOr(usage.input_tokens, 0);
  const cacheRead = numberOr(usage.cached_input_tokens, 0);
  const cacheWrite = numberOr(usage.cache_write_input_tokens, 0);
  const outputTokens = numberOr(usage.output_tokens, 0);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens <= 0) return null;
  return { inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens };
}

function addUsage(acc, usage) {
  const next = normalizeCodexUsage(usage);
  if (!next) return acc;
  if (!acc) return next;
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    cacheRead: acc.cacheRead + next.cacheRead,
    cacheWrite: acc.cacheWrite + next.cacheWrite,
    totalTokens: acc.totalTokens + next.totalTokens,
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  name,
  supportsSchemaNatively,
  buildArgv,
  run,
  extractText,
  extractUsage,
  isToolCallEvent,
  makeProgressCounter,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
};
