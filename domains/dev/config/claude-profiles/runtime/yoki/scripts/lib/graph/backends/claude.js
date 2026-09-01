'use strict';

/**
 * `claude -p` backend: `claude -p <prompt> --output-format json --model <m>`,
 * plus `--json-schema <schema>` (confirmed present in `claude --help` on
 * this machine — a real structured-output flag, so schema is enforced
 * natively rather than via schema.js's prompt-append fallback) and
 * `--agent <type>` when opts.agentType/subagent_type names a real subagent
 * (also confirmed present in `claude --help`) instead of a preamble.
 */

const { resolveModel, resolveAgentPreamble, spawnCollect } = require('./common');

const name = 'claude';
const supportsSchemaNatively = true;

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * The graph runner's own default (see backends/codex.js's DEFAULT_SANDBOX
 * and API.md): review/research/code-study prompts are assembled from
 * untrusted material, so nothing gets write capability unless the workflow
 * script asks for it per call.
 */
const DEFAULT_SANDBOX = 'read-only';

/**
 * claude has no `-s`-style sandbox flag, but `claude --help` on this machine
 * does have `--disallowedTools, --disallowed-tools <tools...>` ("Comma or
 * space-separated list of tool names to deny"). Denying every filesystem-
 * mutating tool — `Bash` included, since a shell is a write tool — is how
 * `read-only` is enforced here. `opts.sandbox` used to be accepted and
 * discarded by this backend, which made the codex backend's read-only
 * default a property of one harness rather than of the graph API.
 */
const READ_ONLY_DENIED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];

function resolveSandbox(sandbox) {
  if (sandbox === undefined || sandbox === null || sandbox === '') return DEFAULT_SANDBOX;
  const mode = String(sandbox);
  if (!SANDBOX_MODES.includes(mode)) {
    throw new Error(`claude backend: unknown sandbox "${mode}" (expected one of ${SANDBOX_MODES.join(', ')})`);
  }
  return mode;
}

/** Pure argv builder — no process spawned, so this is unit-testable on its
 *  own (see test/backends.test.js). */
function buildArgv({ prompt, model, effort, schema, agentType, cwd, sandbox }) {
  const resolvedModel = resolveModel('claude', model);
  const args = ['-p', prompt, '--output-format', 'json'];
  if (resolvedModel) args.push('--model', resolvedModel);
  if (effort) args.push('--effort', effort);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  // workspace-write / danger-full-access add no flag: claude has nothing
  // wider than its own default capability to grant.
  if (resolveSandbox(sandbox) === 'read-only') {
    args.push('--disallowedTools', READ_ONLY_DENIED_TOOLS.join(','));
  }
  let finalPrompt = prompt;
  if (agentType) {
    // claude has a real --agent flag — use it instead of a text preamble,
    // per the task's own instruction to prefer a structured-output/agent
    // flag "when present" over folding it into the prompt.
    args.push('--agent', agentType);
  }
  return { cmd: 'claude', args, cwd, prompt: finalPrompt };
}

/**
 * `claude -p --output-format json` prints a single JSON object to stdout
 * whose `result` field (or, with --json-schema, `structured_output` when
 * present) holds the response text/object. We hand back the raw stdout
 * unmodified — schema.js's extractFirstJSONObject finds the right object
 * either way (the outer envelope IS a JSON object, and when the model's
 * answer is itself JSON embedded in `result` as a string, the outer parse
 * still satisfies "a JSON object was found"; callers needing the inner
 * value re-scan `result` — see agent-runtime in api.js).
 */
async function run({ prompt, model, effort, schema, agentType, cwd, timeoutMs, sandbox }) {
  const { args } = buildArgv({ prompt, model, effort, schema, agentType, cwd, sandbox });
  const started = Date.now();
  const { stdout, stderr, code } = await spawnCollect('claude', args, { cwd, timeoutMs });
  const durationMs = Date.now() - started;
  if (code !== 0 && !stdout.trim()) {
    throw new Error(`claude -p exited ${code}: ${stderr.trim().slice(0, 2000)}`);
  }
  return { raw: stdout, stderr, durationMs, exitCode: code };
}

/** Pull the human-readable/inner text out of claude's --output-format json
 *  envelope (`{"type":"result","result":"...", ...}`), falling back to the
 *  raw string when it isn't that shape. */
function extractText(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.result === 'string') return obj.result;
    if (obj && typeof obj.structured_output !== 'undefined') return JSON.stringify(obj.structured_output);
  } catch {
    // not the envelope shape — return raw as-is
  }
  return raw;
}

module.exports = {
  name,
  supportsSchemaNatively,
  buildArgv,
  run,
  extractText,
  resolveAgentPreamble,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
  READ_ONLY_DENIED_TOOLS,
};
