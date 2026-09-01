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
 * A tool call in omp's `--mode json` event stream. Two carriers, because a
 * headless run emits assistant/tool records rather than a dedicated
 * lifecycle event: a record whose own `type` names a tool call, and an
 * assistant message whose content blocks include a `tool_use`. Ends
 * (`toolResult`) are not counted, so the number stays a count of calls.
 */
function countToolCalls(evt) {
  if (!evt || typeof evt !== 'object') return 0;
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
  if (code !== 0 && !stdout.trim()) {
    throw new Error(`omp exited ${code}: ${stderr.trim().slice(0, 2000)}`);
  }
  return { raw: stdout, stderr, durationMs, exitCode: code };
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
 * Two carriers are accepted because `omp -p --mode json`'s single result
 * object and the session JSONL it writes are not the same envelope, and only
 * the session-file shape is spike-verified:
 * - a `usage` block on the result object (or nested under `message`), and
 * - a JSONL stream of `{"type":"message","message":{"role":"assistant",
 *   "usage":{...}}}` records, whose usages are summed.
 * Anything else returns null, which api.js reports as an explicit estimate
 * rather than a silent zero.
 */
function extractUsage(raw) {
  const text = String(raw);
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
    summed = summed ? {
      inputTokens: summed.inputTokens + one.inputTokens,
      outputTokens: summed.outputTokens + one.outputTokens,
      cacheRead: summed.cacheRead + one.cacheRead,
      cacheWrite: summed.cacheWrite + one.cacheWrite,
      totalTokens: summed.totalTokens + one.totalTokens,
      ...(one.costUsd === undefined && summed.costUsd === undefined
        ? {}
        : { costUsd: (summed.costUsd || 0) + (one.costUsd || 0) }),
    } : one;
  }
  return summed;
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

/** `omp -p --mode json` prints a single JSON result object; pull its text
 *  field, falling back to the raw string for any other shape. */
function extractText(raw) {
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
  countToolCalls,
  makeProgressCounter,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
  READ_ONLY_TOOLS,
};
