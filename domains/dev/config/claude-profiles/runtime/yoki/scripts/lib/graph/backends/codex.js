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
const { resolveModel, resolveAgentPreamble, spawnCollect } = require('./common');

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

async function run({ prompt, model, effort, schema, agentType, cwd, timeoutMs, sandbox }) {
  let schemaFilePath = null;
  if (schema) {
    schemaFilePath = path.join(os.tmpdir(), `yoki-graph-codex-schema-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(schemaFilePath, JSON.stringify(schema));
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
    const { stdout, stderr, code } = await spawnCollect('codex', args, { cwd, input: promptText, timeoutMs });
    const durationMs = Date.now() - started;
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

module.exports = {
  name,
  supportsSchemaNatively,
  buildArgv,
  run,
  extractText,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
};
