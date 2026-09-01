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

const { resolveModel, resolveAgentPreamble, spawnCollect } = require('./common');

const name = 'omp';
const supportsSchemaNatively = false;

const BRIDGE_EXTENSION = '~/.omp/agent/extensions/yoki-bridge.ts';

function expandHome(p) {
  const os = require('os');
  return p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p;
}

/** Pure argv builder — `prompt` here is whatever schema.js has already
 *  decided the final prompt text should be (schema instruction/retry
 *  folded in upstream); this backend never appends its own schema text. */
function buildArgv({ prompt, model, agentType }) {
  const resolvedModel = resolveModel('omp', model);
  const preamble = agentType ? resolveAgentPreamble(agentType) : '';
  const finalPrompt = preamble ? `${preamble}\n\n${prompt}` : prompt;
  const args = ['-p', '--mode', 'json'];
  if (resolvedModel) args.push('--model', resolvedModel);
  args.push('--no-extensions', '-e', expandHome(BRIDGE_EXTENSION), finalPrompt);
  return { cmd: 'omp', args };
}

async function run({ prompt, model, effort, agentType, cwd, timeoutMs }) {
  // effort: omp has --thinking=<level> (off/minimal/low/medium/high/xhigh/max/auto)
  // per `omp --help` — map our tiers straight through, they share the vocabulary.
  const { args } = buildArgv({ prompt, model, agentType });
  if (effort) args.push('--thinking', effort);
  const started = Date.now();
  const { stdout, stderr, code } = await spawnCollect('omp', args, { cwd, timeoutMs });
  const durationMs = Date.now() - started;
  if (code !== 0 && !stdout.trim()) {
    throw new Error(`omp exited ${code}: ${stderr.trim().slice(0, 2000)}`);
  }
  return { raw: stdout, stderr, durationMs, exitCode: code };
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

module.exports = { name, supportsSchemaNatively, buildArgv, run, extractText };
