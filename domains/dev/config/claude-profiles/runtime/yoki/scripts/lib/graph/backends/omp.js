'use strict';

/**
 * `omp` backend:
 *   command omp -p --mode json --model <m> --no-extensions
 *     -e ~/.omp/agent/extensions/yoki-bridge.ts <prompt>
 *
 * `command` bypasses the shell function this dotfiles setup defines for
 * `omp` (which injects yoki-guard.ts and refuses `--no-extensions`
 * overrides) — the graph runner talks to the omp *binary* directly and
 * loads its own bridge extension instead, so it is spawned via
 * `spawnCollect('omp', ...)` (argv-based, no shell), which already bypasses
 * shell functions entirely; `command` only matters for a literal shell
 * invocation and is kept in the documented argv shape for parity with the
 * spec's example, in case a caller shells out to this backend's printed
 * command line directly.
 *
 * ## Output format: v3 NDJSON event stream, with old-format fallback
 *
 * omp 18.0.4's `--mode json` does NOT print a single JSON result object —
 * it prints one JSON event per line, opened by a `{"type":"session",
 * "version":3,...}` header and followed by agent_start / turn_start /
 * message_start / message_update (text_start, text_delta, text_end,
 * toolcall_start, toolcall_delta, toolcall_end) / message_end /
 * tool_execution_start / tool_execution_end / turn_end / agent_end
 * (fixtures: test/fixtures/omp-v3-{simple,tool}.ndjson, captured live from
 * omp 18.0.4). The pre-v3 assumption ("single JSON result object") made
 * extractText hand back the FIRST parseable thing on stdout — the session
 * header — as the lane's answer, which then sailed through any schema whose
 * `required` list is empty and degraded whole graph runs silently
 * ("planning failed / no angles" with every lane nominally ok).
 *
 * Both formats are still accepted on purpose: the first non-empty stdout
 * line deciding v3 vs old keeps this backend working if the machine's omp
 * is ever rolled back to a pre-stream release — the old single-object and
 * session-JSONL readers below are unchanged, only gated behind "not a v3
 * stream".
 *
 * Junk defense: in v3 mode extractText returns null (never the raw stream)
 * when no assistant text was found, and run() refuses to treat a
 * header-only stream as success on a non-zero exit — so an omp that dies
 * after printing the session header (auth failure does exactly this)
 * surfaces as a backend error (agent() resolves null, journal gets an
 * `error` line) instead of a session header masquerading as an answer.
 * There is structurally no path that returns the header as a result.
 *
 * `omp --help` on this machine has no schema/structured-output flag, so
 * schema is ALWAYS enforced via schema.js's prompt-embedded fallback
 * (supportsSchemaNatively = false) — the prompt gets the "respond ONLY
 * with JSON matching this schema" instruction appended by schema.js, not
 * by this file.
 */

const { resolveModel, resolveAgentPreamble, spawnCollect, timeoutError, makeLineSplitter } = require('./common');

const name = 'omp';
const supportsSchemaNatively = false;

const BRIDGE_EXTENSION = '~/.omp/agent/extensions/yoki-bridge.ts';

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/** Same default as the codex backend — see backends/codex.js and API.md. */
const DEFAULT_SANDBOX = 'read-only';

/**
 * omp's tool-restriction flag is `--tools=<value>` ("Comma-separated list of
 * tools to enable (default: all)", `command omp --help`, omp 18.0.4) — an
 * allow-list, so read-only enables only the reading tools. Ids are omp's own
 * builtin tool names (lib/targets/omp-tool-names.js, derived from the
 * binary's BUILTIN_TOOLS registry). `task` is excluded on purpose: a
 * subagent would not inherit the restriction.
 */
const READ_ONLY_TOOLS = ['read', 'grep', 'glob', 'web_search'];

function expandHome(p) {
  const os = require('os');
  return p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p;
}

function resolveSandbox(sandbox) {
  if (sandbox === undefined || sandbox === null || sandbox === '') return DEFAULT_SANDBOX;
  const mode = String(sandbox);
  if (!SANDBOX_MODES.includes(mode)) {
    throw new Error(`omp backend: unknown sandbox "${mode}" (expected one of ${SANDBOX_MODES.join(', ')})`);
  }
  return mode;
}

/** Pure argv builder — `prompt` here is whatever schema.js has already
 *  decided the final prompt text should be (schema instruction/retry
 *  folded in upstream); this backend never appends its own schema text. */
function buildArgv({ prompt, model, agentType, sandbox }) {
  const resolvedModel = resolveModel('omp', model);
  const preamble = agentType ? resolveAgentPreamble(agentType) : '';
  const finalPrompt = preamble ? `${preamble}\n\n${prompt}` : prompt;
  const args = ['-p', '--mode', 'json'];
  if (resolvedModel) args.push('--model', resolvedModel);
  // workspace-write / danger-full-access add no flag: omp's default is
  // already its full builtin tool set, and there is nothing wider to grant.
  if (resolveSandbox(sandbox) === 'read-only') args.push('--tools', READ_ONLY_TOOLS.join(','));
  args.push('--no-extensions', '-e', expandHome(BRIDGE_EXTENSION), finalPrompt);
  return { cmd: 'omp', args };
}

/**
 * A tool call in omp's `--mode json` event stream, counted begins-only so
 * the number stays a count of calls, not of events.
 *
 * v3 (omp 18.0.4): exactly one `tool_execution_start` per call. It is the
 * ONLY v3 shape counted — the same call also appears as an assistant
 * message whose content block has type `toolCall` (in message_start AND
 * message_end) and as toolcall_start/toolcall_end message_updates, so
 * counting any of those too would book one call several times. v3's block
 * type is `toolCall` (camelCase), which the old `tool_use` block filter
 * below deliberately does not match — that filter stays as-is for the
 * pre-stream format, where an assistant record's `tool_use` blocks were
 * the only carrier.
 */
function countToolCalls(evt) {
  if (!evt || typeof evt !== 'object') return 0;
  if (evt.type === 'tool_execution_start') return 1;
  if (typeof evt.type === 'string' && /^tool_(call|use)$/.test(evt.type)) return 1;
  const message = evt.message;
  if (message && Array.isArray(message.content)) {
    return message.content.filter((block) => block && block.type === 'tool_use').length;
  }
  return 0;
}

/** Count tool calls as the stream arrives; report each increment. */
function makeProgressCounter(onProgress) {
  if (typeof onProgress !== 'function') return undefined;
  let toolCalls = 0;
  return makeLineSplitter((line) => {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    const found = countToolCalls(evt);
    if (!found) return;
    toolCalls += found;
    onProgress({ toolCalls });
  });
}

async function run({ prompt, model, effort, agentType, cwd, timeoutMs, sandbox, onProgress }) {
  // effort: omp has --thinking=<level> (off/minimal/low/medium/high/xhigh/max/auto)
  // per `omp --help` — map our tiers straight through, they share the vocabulary.
  const { args } = buildArgv({ prompt, model, agentType, sandbox });
  if (effort) args.push('--thinking', effort);
  const started = Date.now();
  const { stdout, stderr, code, timedOut } = await spawnCollect('omp', args, {
    cwd, timeoutMs, onData: makeProgressCounter(onProgress),
  });
  const durationMs = Date.now() - started;
  if (timedOut) throw timeoutError('omp', timeoutMs);
  // On a non-zero exit, stdout only counts as a salvageable result if it
  // actually contains an answer. omp prints the v3 session header BEFORE it
  // authenticates, so a run that dies at auth exits 1 with one header line
  // on stdout — under the old `!stdout.trim()` test that line suppressed
  // the error and the header itself became the lane's "answer". A v3
  // stream must carry at least one assistant message to stand in for the
  // exit code; anything else propagates the failure.
  if (code !== 0 && (!stdout.trim() || (isV3Stream(stdout) && !hasAssistantText(stdout)))) {
    throw new Error(`omp exited ${code}: ${stderr.trim().slice(0, 2000)}`);
  }
  return { raw: stdout, stderr, durationMs, exitCode: code };
}

/**
 * The stream-format switch: omp 18.0.4's `--mode json` opens with a
 * `{"type":"session","version":3,...}` line; the pre-stream format never
 * printed such a header. Decided from the first non-empty line only, so a
 * rollback to an old omp keeps taking the old readers below.
 */
function isV3Stream(raw) {
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const evt = safeParse(trimmed);
    return !!evt && evt.type === 'session';
  }
  return false;
}

/**
 * Walk a v3 stream's assistant `message_end` events. Only message_end:
 * the same assistant message also rides in message_start (with a zeroed
 * usage block), turn_end and agent_end — folding any of those in would
 * double- or triple-count both text and tokens. Yields the parsed event's
 * `message` object per assistant message_end, in stream order.
 */
function* assistantMessageEnds(raw) {
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const evt = safeParse(trimmed);
    if (!evt || evt.type !== 'message_end') continue;
    const message = evt.message;
    if (message && message.role === 'assistant') yield message;
  }
}

/** Concatenated text blocks of one message, or null when it has none
 *  (a toolCall-only assistant message has no text block at all). */
function messageText(message) {
  if (!Array.isArray(message.content)) return null;
  const parts = message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
  return parts.length ? parts.join('\n') : null;
}

function hasAssistantText(raw) {
  for (const message of assistantMessageEnds(raw)) {
    if (messageText(message) !== null) return true;
  }
  return false;
}

/**
 * Token usage from omp's own records.
 *
 * The field names are omp's, pinned by spike S4-S5-omp.md (omp 18.0.4) and
 * already read the same way by `lib/harness/session.js`: an assistant turn
 * carries `message.usage.{input, output, cacheRead, cacheWrite,
 * totalTokens, reasoningTokens, cost}` — camelCase, unlike claude's and
 * codex's snake_case, so this cannot share their reader.
 *
 * v3 stream: usage is summed over assistant `message_end` events. Each one
 * carries that API call's own disjoint usage (a tool-using run's read turn
 * showed input 29081, its answer turn input 1161 + cacheRead 28160 — not
 * cumulative), so the sum is the run's true total, while the copies of the
 * same message in message_start (zeroed), turn_end and agent_end are
 * skipped to avoid double counting.
 *
 * Addition rule (opposite of codex — see backends/codex.js
 * normalizeCodexUsage and API.md): omp's cacheRead/cacheWrite are DISJOINT
 * from input, and its own totalTokens = input + output + cacheRead +
 * cacheWrite, so cached counts DO belong in the total here.
 *
 * The two pre-stream carriers are kept for the old-format fallback:
 * - a `usage` block on the single result object (or under `message`), and
 * - a JSONL stream of `{"type":"message","message":{"role":"assistant",
 *   "usage":{...}}}` records, whose usages are summed.
 * Anything else returns null, which api.js reports as an explicit estimate
 * rather than a silent zero.
 */
function extractUsage(raw) {
  const text = String(raw);
  if (isV3Stream(text)) {
    let summed = null;
    for (const message of assistantMessageEnds(text)) {
      const one = usageFromObject({ usage: message.usage });
      if (!one) continue;
      summed = summed ? addUsage(summed, one) : one;
    }
    return summed;
  }
  const direct = usageFromObject(safeParse(text));
  if (direct) return direct;

  let summed = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = safeParse(trimmed);
    if (!record || record.type !== 'message') continue;
    const one = usageFromObject(record);
    if (!one) continue;
    summed = summed ? addUsage(summed, one) : one;
  }
  return summed;
}

/** Merge two already-normalized usage objects (see usageFromObject). */
function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    ...(a.costUsd === undefined && b.costUsd === undefined
      ? {}
      : { costUsd: (a.costUsd || 0) + (b.costUsd || 0) }),
  };
}

function safeParse(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function usageFromObject(obj) {
  if (!obj) return null;
  const usage = (obj.usage && typeof obj.usage === 'object' && obj.usage)
    || (obj.message && obj.message.usage && typeof obj.message.usage === 'object' && obj.message.usage);
  if (!usage) return null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const inputTokens = num(usage.input);
  const outputTokens = num(usage.output);
  const cacheRead = num(usage.cacheRead);
  const cacheWrite = num(usage.cacheWrite);
  const totalTokens = Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : inputTokens + outputTokens + cacheRead + cacheWrite;
  if (totalTokens <= 0) return null;
  const cost = usage.cost;
  const costUsd = typeof cost === 'number' ? cost : (cost && typeof cost.total === 'number' ? cost.total : undefined);
  return { inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens, ...(costUsd === undefined ? {} : { costUsd }) };
}

/**
 * The final answer out of omp's stdout.
 *
 * v3 stream: the concatenated `content[].type === "text"` blocks of the
 * LAST assistant `message_end` that has any (a run that ends on a tool
 * call leaves a trailing text-less assistant message; the last message
 * WITH text is the answer). Returns null — never the raw stream — when no
 * assistant text exists at all: the raw fallback is exactly what used to
 * hand the session header (or a headers-only aborted stream) downstream as
 * a lane's "answer", so in v3 mode the junk path is closed structurally
 * and a null lands in agent()'s normal no-result error handling.
 *
 * Old format (pre-stream omp, kept for rollback): a single JSON result
 * object whose text/result/message field is the answer, with the raw
 * string as the fallback for any other shape — unchanged, because that
 * format had no header line to leak.
 */
function extractText(raw) {
  if (isV3Stream(raw)) {
    let last = null;
    for (const message of assistantMessageEnds(raw)) {
      const text = messageText(message);
      if (text !== null) last = text;
    }
    return last;
  }
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.text === 'string') return obj.text;
    if (obj && typeof obj.result === 'string') return obj.result;
    if (obj && typeof obj.message === 'string') return obj.message;
  } catch {
    // not a bare JSON object — return raw as-is
  }
  return raw;
}

module.exports = {
  name,
  supportsSchemaNatively,
  buildArgv,
  run,
  extractText,
  extractUsage,
  isV3Stream,
  countToolCalls,
  makeProgressCounter,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
  READ_ONLY_TOOLS,
};
