#!/usr/bin/env node
'use strict';

/**
 * yoki-agent — ONE graph backend call from the command line.
 *
 *   yoki-agent --backend codex|omp|mock [--model <tier|id>]
 *       [--schema <file.json> | --schema-base64 <b64>]
 *       [--sandbox read-only|workspace-write|danger-full-access]
 *       [--cwd <dir>] [--effort low|medium|high|xhigh|max] [--agent-type <name>]
 *       [--timeout <ms>] [--retries N] [--model-map <tier>=<id>,...]
 *       [--label <text>] [--mock <file>] [--allow-mock] [--run-id <id>]
 *       [--dry-run] (--prompt-file <file> | --prompt-base64 <b64>) [--json]
 *
 * This is NOT a second implementation of `agent()`. It builds the same run
 * context runner.js builds and calls api.js's `agent()` exactly once, so a
 * call made here and a call made inside a workflow are the same call: same
 * model resolution (tier -> id, misspelled tier refused), same schema
 * pipeline (native flag or prompt-append, extract, validate, retry once,
 * hard-fail), same transient retry/timeout policy, same journal line, same
 * per-run budget caps, same usage accounting. That identity is the point:
 * MP3's provider lanes reach codex/omp THROUGH this CLI from inside Claude
 * Code, and a lane must not behave differently from the same lane run under
 * `yoki-graph run`.
 *
 * `--prompt-base64` / `--schema-base64` are what a provider lane actually
 * uses. The lane's payload is untrusted text (a diff, a design document, a
 * fetched page) and the caller is a haiku-tier transport subagent, so the
 * payload must never occupy a position where it could read as an instruction
 * or as shell syntax: base64 in argv is decoded here, after argv is fixed,
 * and it needs no scratch file — which is what lets the transport run with
 * no write authority at all. See core/workflows/lib/lanes.js.
 *
 * Exit codes (the contract MP3's proxy agent branches on):
 *   0  ok — the JSON/text result was printed on stdout
 *   1  usage error — bad, unknown or missing flags, unreadable/undecodable
 *      prompt or schema, unknown backend, unknown model tier, a model or
 *      backend name outside the allowed alphabet
 *   2  backend error — the call failed (spawn failure, non-zero exit,
 *      timeout after retries), or a per-run budget cap was already spent
 *   3  schema validation failed after the one retry api.js allows
 *
 * `--json` prints ONLY the result on stdout (the footer goes to stderr), so
 * a caller can pipe it straight into a JSON parser — or, as MP3's proxy
 * does, hand it back verbatim without paraphrasing it.
 *
 * MOCKING IS EXPLICIT. `YOKI_AGENT_MOCK=<fixture>` alone does nothing: it
 * takes effect only together with `--allow-mock`, and a run that ignored it
 * says so on stderr. An environment variable must never be able to
 * substitute one provider's answer for a fixture — a `.envrc` in a
 * repository under review, or a stale export from testing, would otherwise
 * turn a second-provider security review into attacker-chosen findings, and
 * "codex found nothing" is exactly what an empty fixture looks like. When a
 * substitution IS authorized, the result printed on stdout carries
 * `"_mock": true`, on the same channel as the result itself, because the
 * honest footer goes to stderr and a caller under `--json` reads stdout only.
 *
 * The daily WORKFLOW cap (guard.js / workflow-guard.sh) is deliberately not
 * charged here: one review with six codex lanes is one workflow launch, not
 * seven, and bumping the launch counter per lane would exhaust a five-launch
 * day inside a single run. What IS charged is the per-run agent-call/token/
 * wall budget (budget.js), through the same `assertWithinCaps` every
 * workflow call goes through.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createApi } = require('./api');
const { Journal } = require('./journal');
const { SchemaValidationError } = require('./schema');
const backends = require('./backends');
const budgetLib = require('./budget');
const models = require('./models');
const progress = require('./progress');
const { findRepoRootFrom } = require('./backends/common');
const { parseArgs: parseArgv, numberFlag } = require('./args');

const USAGE = `usage: yoki-agent --backend codex|omp|mock (--prompt-file <f> | --prompt-base64 <b64>) [options]

  --backend <name>       codex | omp | mock                     (required)
  --prompt-file <file>   the prompt, read verbatim     (required, or -base64)
  --prompt-base64 <b64>  the prompt, base64-encoded    (required, or -file)
  --model <tier|id>      haiku|sonnet|opus|<backend model id>
  --schema <file.json>   JSON Schema; the result is validated against it
  --schema-base64 <b64>  the same schema, base64-encoded
  --sandbox <mode>       read-only (default) | workspace-write | danger-full-access
  --cwd <dir>            working directory for the call         (default: cwd)
  --effort <level>       low | medium | high | xhigh | max
  --agent-type <name>    agent definition whose preamble is prepended
  --timeout <ms>         per-call wall clock ceiling
  --retries <n>          transient-failure retries
  --model-map <t>=<id>,… tier overrides for this call
  --label <text>         journal/progress label (default: yoki-agent)
  --mock <file>          fixture file for --backend mock
  --allow-mock           let YOKI_AGENT_MOCK reroute this call to a fixture
  --run-id <id>          journal this call under an existing run id
  --dry-run              resolve everything, spawn nothing
  --json                 print only the result on stdout; footer to stderr

exit: 0 ok, 1 usage, 2 backend error, 3 schema failure after retry
`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = ['json', 'dry-run', 'allow-mock'];

/**
 * Every flag this CLI understands. An unrecognized one is a usage error
 * rather than something quietly ignored: `--jsonn` used to run the call
 * WITHOUT `--json`, printing the footer into the caller's stdout, and
 * `--model-mpa` used to run it with the tier map the caller thought they had
 * overridden. Both look like a normal run.
 */
const KNOWN_FLAGS = new Set([
  'backend', 'prompt-file', 'prompt-base64', 'model', 'schema', 'schema-base64',
  'sandbox', 'cwd', 'effort', 'agent-type', 'timeout', 'retries', 'model-map',
  'label', 'mock', 'allow-mock', 'run-id', 'dry-run', 'json', 'help', 'h',
]);

/**
 * The shape a backend name or a model id may take before it is used to build
 * a command line. Model ids are deliberately free-form (models.js passes
 * anything that is not a known tier straight through to the backend), but
 * "free-form" must still mean an identifier: this is the same alphabet the
 * lane helper enforces on `providers[].model`, checked again here because
 * yoki-agent is reachable from a shell, not only from a lane.
 */
const NAME_RE = /^[A-Za-z0-9._:\/-]{1,64}$/;

const parseArgs = (argv) => parseArgv(argv, BOOLEAN_FLAGS);

function requiredString(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UsageError(`--${name} is required`);
  }
  return value.trim();
}

function optionalString(flags, name) {
  const value = flags[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A flag whose value goes on to be part of a command line. */
function nameFlag(flags, name) {
  const value = optionalString(flags, name);
  if (value !== undefined && !NAME_RE.test(value)) {
    throw new UsageError(`--${name} ${JSON.stringify(value)} is not a valid name — must match ${String(NAME_RE)}`);
  }
  return value;
}

function readTextFile(file, what) {
  try {
    return fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${what} ${file}: ${err.message}`);
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a base64 flag, refusing anything that is not exactly base64.
 * `Buffer.from(x, 'base64')` silently discards characters outside the
 * alphabet, so a mangled argument would decode to plausible-looking garbage
 * instead of failing; the round-trip check makes that impossible.
 */
function decodeBase64(value, what) {
  const text = String(value).trim();
  if (!text || text.length % 4 !== 0 || !BASE64_RE.test(text)) {
    throw new UsageError(`--${what} is not valid base64`);
  }
  const decoded = Buffer.from(text, 'base64');
  if (decoded.toString('base64') !== text) {
    throw new UsageError(`--${what} is not valid base64`);
  }
  return decoded.toString('utf8');
}

function parseSchema(text, what) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('not a JSON object');
    return parsed;
  } catch (err) {
    throw new UsageError(`${what} is not a JSON Schema object: ${err.message}`);
  }
}

function generateRunId() {
  return `agent-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * The one-line footer: what actually ran, and what it cost. Printed on
 * stderr under `--json` so stdout stays a clean JSON document.
 */
function formatFooter({ backendName, requestedBackend, model, tier, entry, exitCode }) {
  const parts = [`backend=${backendName}`];
  if (requestedBackend && requestedBackend !== backendName) parts.push(`(requested ${requestedBackend})`);
  parts.push(`model=${model || '(backend default)'}`);
  if (tier) parts.push(`tier=${tier}`);
  if (entry) {
    parts.push(`tokens=${entry.tokens || 0}${entry.tokensSource ? ` (${entry.tokensSource})` : ''}`);
    const cached = entry.usage && entry.usage.cacheRead;
    if (cached) parts.push(`cached=${cached}`);
    if (typeof entry.durationMs === 'number') parts.push(`took=${progress.formatElapsed(entry.durationMs)}`);
  }
  parts.push(`exit=${exitCode}`);
  return `yoki-agent: ${parts.join(' ')}\n`;
}

/**
 * @param {string[]} argv
 * @param {object} [deps] injected in tests: `stdout`, `stderr`, `env`
 * @returns {Promise<number>} the process exit code
 */
async function run(argv, deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const env = deps.env || process.env;
  const flags = parseArgs(argv);

  if (flags.help || flags.h || argv.length === 0) {
    stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  let plan;
  try {
    plan = buildPlan(flags, env);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`yoki-agent: ${err.message}\n\n${USAGE}`);
      return 1;
    }
    // An unknown backend or a misspelled model tier is caught here too:
    // both are the caller's mistake, not a backend failure.
    stderr.write(`yoki-agent: ${err.message}\n`);
    return 1;
  }
  for (const warning of plan.warnings) stderr.write(`yoki-agent: ${warning}\n`);

  const journal = new Journal(plan.runId);
  // Where THIS invocation's entries start, in both senses. `startIndex`
  // continues the run's arrival-order sequence instead of restarting at 0
  // (createApi always began a fresh context at 0, so a second call under a
  // reused `--run-id` collided with the first one's entry rather than
  // following it). `entriesBefore` is the file position everything below
  // reads from, so the footer can only ever describe the call just made.
  const entriesBefore = journal.readAll();
  const ctx = {
    runId: plan.runId,
    journal,
    backend: plan.backend,
    cwd: plan.cwd,
    model: plan.model,
    effort: plan.effort,
    mockFile: plan.mockFile,
    dryRun: plan.dryRun,
    resume: false,
    concurrency: 1,
    emit: () => {}, // a single call has no progress tree worth drawing
    timeoutMs: plan.timeoutMs,
    retries: plan.retries,
    caps: budgetLib.resolveCaps(plan.cwd),
    startedAt: Date.now(),
    startIndex: nextCallIndex(entriesBefore),
    modelMap: plan.modelMap,
    harnessModels: models.loadHarnessModels(findRepoRootFrom(__dirname)),
  };
  const api = createApi(ctx);

  let result;
  let exitCode = 0;
  try {
    result = await api.agent(plan.prompt, {
      label: plan.label,
      schema: plan.schema,
      sandbox: plan.sandbox,
      ...(plan.agentType ? { agentType: plan.agentType } : {}),
    });
  } catch (err) {
    // agent() rejects for exactly two reasons: a schema that would not
    // validate even after its retry, and a budget cap breach. Everything
    // else it turns into `null` (API.md).
    if (err instanceof SchemaValidationError) {
      stderr.write(`yoki-agent: schema validation failed after retry: ${err.message}\n`);
      if (err.raw) stderr.write(`${String(err.raw).slice(0, 2000)}\n`);
      return 3;
    }
    stderr.write(`yoki-agent: ${err.message}\n`);
    return 2;
  }

  // ONLY the entries this invocation appended. Scanning the whole journal
  // made a failure under a reused `--run-id` print an EARLIER, successful
  // call's model, tokens and duration beside `exit=2` — accounting for a
  // call that never ran, taken from one that did.
  const own = journal.readAll().slice(entriesBefore.length);
  const okEntry = lastWithStatus(own, 'ok');
  const errorEntry = lastWithStatus(own, 'error');
  if (result === null || result === undefined) {
    stderr.write(`yoki-agent: backend call failed${errorEntry && errorEntry.error ? `: ${errorEntry.error}` : ''}\n`);
    exitCode = 2;
  }
  const entry = okEntry || errorEntry || null;

  if (exitCode === 0) {
    const payload = stampMock(result, plan, stderr);
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    stdout.write(`${text}\n`);
  }
  const footer = formatFooter({
    backendName: plan.backendName,
    requestedBackend: plan.requestedBackend,
    model: entry ? entry.model : plan.resolvedModel.id,
    tier: plan.resolvedModel.tier,
    entry,
    exitCode,
  });
  (flags.json ? stderr : stdout).write(footer);
  return exitCode;
}

/**
 * Mark a fixture-served result as one, INSIDE the payload. The footer's
 * `backend=mock (requested codex)` goes to stderr, which a `--json` caller
 * discards — and a lane's transport agent is told to return stdout and
 * nothing else, so without this stamp the workflow reads canned findings as
 * the provider's own opinion. A non-object result has nowhere to carry the
 * stamp; that gets a loud stderr line instead.
 */
function stampMock(result, plan, stderr) {
  if (!plan.mockSubstituted) return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, _mock: true };
  }
  stderr.write('yoki-agent: WARNING this result came from a mock fixture, not from '
    + `${plan.requestedBackend}, and is not an object — it carries no "_mock" marker\n`);
  return result;
}

/** Resolve every flag into the concrete plan for one call, refusing bad
 *  input BEFORE anything is journaled or spawned. */
function buildPlan(flags, env) {
  const unknown = Object.keys(flags).filter((k) => k !== '_' && !KNOWN_FLAGS.has(k));
  if (unknown.length) {
    throw new UsageError(`unknown flag${unknown.length > 1 ? 's' : ''}: ${unknown.map((k) => `--${k}`).join(', ')}`);
  }
  if (flags._.length) {
    throw new UsageError(`unexpected argument${flags._.length > 1 ? 's' : ''}: ${flags._.join(', ')}`);
  }

  const requestedBackend = requiredString(flags, 'backend');
  if (!NAME_RE.test(requestedBackend)) {
    throw new UsageError(`--backend ${JSON.stringify(requestedBackend)} is not a valid name — must match ${String(NAME_RE)}`);
  }

  const promptFile = optionalString(flags, 'prompt-file');
  const promptB64 = optionalString(flags, 'prompt-base64');
  if (promptFile && promptB64) {
    throw new UsageError('--prompt-file and --prompt-base64 are mutually exclusive');
  }
  if (!promptFile && !promptB64) {
    throw new UsageError('--prompt-file is required (or --prompt-base64)');
  }
  const prompt = promptB64
    ? decodeBase64(promptB64, 'prompt-base64')
    : readTextFile(promptFile, 'prompt file');
  if (!prompt.trim()) {
    throw new UsageError(promptB64 ? '--prompt-base64 decoded to an empty prompt' : `--prompt-file ${promptFile} is empty`);
  }

  const schemaFile = optionalString(flags, 'schema');
  const schemaB64 = optionalString(flags, 'schema-base64');
  if (schemaFile && schemaB64) {
    throw new UsageError('--schema and --schema-base64 are mutually exclusive');
  }
  let schema;
  if (schemaB64) schema = parseSchema(decodeBase64(schemaB64, 'schema-base64'), '--schema-base64');
  else if (schemaFile) schema = parseSchema(readTextFile(schemaFile, 'schema file'), `--schema ${schemaFile}`);

  // YOKI_AGENT_MOCK reroutes any backend to the mock one with that fixture —
  // how the workflow tests exercise a provider lane end to end without a
  // codex/omp binary, and how a human dry-runs a lane's wiring. It requires
  // --allow-mock: see this file's header for why the environment alone must
  // never be able to substitute a result.
  const warnings = [];
  const mockEnv = typeof env.YOKI_AGENT_MOCK === 'string' && env.YOKI_AGENT_MOCK.trim()
    ? env.YOKI_AGENT_MOCK.trim() : '';
  const allowMock = !!flags['allow-mock'];
  if (mockEnv && !allowMock) {
    warnings.push('YOKI_AGENT_MOCK is set but --allow-mock was not passed — IGNORING it and calling '
      + `${requestedBackend} for real. An environment variable must never substitute a provider's answer.`);
  }
  const mockOverride = allowMock ? mockEnv : '';
  const backendName = mockOverride ? 'mock' : requestedBackend;
  const backend = backends.loadBackend(backendName);

  const cwd = flags.cwd ? path.resolve(String(flags.cwd)) : process.cwd();
  const modelMap = models.parseModelMap(optionalString(flags, 'model-map') || '');
  const model = nameFlag(flags, 'model');
  // Resolved here as well as inside agent() so a misspelled tier is a usage
  // error (exit 1) rather than a run that starts and then fails.
  const resolvedModel = models.resolve(backendName, model, {
    overrides: modelMap,
    harnessModels: models.loadHarnessModels(findRepoRootFrom(__dirname)),
  });

  const sandbox = optionalString(flags, 'sandbox');
  if (sandbox && typeof backend.resolveSandbox === 'function') {
    backend.resolveSandbox(sandbox); // throws with the valid modes listed
  }

  return {
    runId: optionalString(flags, 'run-id') || generateRunId(),
    requestedBackend,
    backendName,
    // True only when a backend the caller did NOT ask for is answering.
    // `--backend mock` is an honest request for the mock backend and needs
    // no stamp; `--backend codex` answered by a fixture does.
    mockSubstituted: backendName === 'mock' && requestedBackend !== 'mock',
    backend,
    warnings,
    cwd,
    prompt,
    schema,
    sandbox,
    model,
    resolvedModel,
    modelMap,
    effort: optionalString(flags, 'effort'),
    agentType: optionalString(flags, 'agent-type'),
    label: optionalString(flags, 'label') || 'yoki-agent',
    timeoutMs: numberFlag(flags.timeout),
    retries: numberFlag(flags.retries),
    mockFile: mockOverride || (flags.mock ? path.resolve(String(flags.mock)) : undefined),
    dryRun: !!flags['dry-run'],
  };
}

/**
 * The arrival-order position this invocation's call takes: one past the
 * highest already journaled under this run id. A fresh run id has none and
 * starts at 0, exactly as before; `--run-id <existing>` continues the
 * sequence, so two calls under one run id are entries 0 and 1 rather than
 * two entries both claiming index 0.
 */
function nextCallIndex(entries) {
  let highest = -1;
  for (const entry of entries) {
    if (entry && Number.isInteger(entry.index) && entry.index > highest) highest = entry.index;
  }
  return highest + 1;
}

function lastWithStatus(entries, status) {
  const matching = entries.filter((e) => e && e.status === status);
  return matching.length ? matching[matching.length - 1] : null;
}

async function main(argv = process.argv.slice(2)) {
  const code = await run(argv);
  process.exitCode = code;
  return code;
}

if (require.main === module) {
  main();
}

module.exports = {
  main, run, parseArgs, buildPlan, formatFooter, nextCallIndex, decodeBase64,
  USAGE, UsageError, KNOWN_FLAGS, NAME_RE,
};
