#!/usr/bin/env node
'use strict';

/**
 * yoki-agent — ONE graph backend call from the command line.
 *
 *   yoki-agent --backend codex|omp|mock [--model <tier|id>]
 *       [--schema <file.json>] [--sandbox read-only|workspace-write|danger-full-access]
 *       [--cwd <dir>] [--effort low|medium|high|xhigh|max] [--agent-type <name>]
 *       [--timeout <ms>] [--retries N] [--model-map <tier>=<id>,...]
 *       [--label <text>] [--mock <file>] [--run-id <id>] [--dry-run]
 *       --prompt-file <file> [--json]
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
 * Exit codes (the contract MP3's proxy agent branches on):
 *   0  ok — the JSON/text result was printed on stdout
 *   1  usage error — bad or missing flags, unreadable prompt/schema file,
 *      unknown backend or model tier
 *   2  backend error — the call failed (spawn failure, non-zero exit,
 *      timeout after retries), or a per-run budget cap was already spent
 *   3  schema validation failed after the one retry api.js allows
 *
 * `--json` prints ONLY the result on stdout (the footer goes to stderr), so
 * a caller can pipe it straight into a JSON parser — or, as MP3's proxy
 * does, hand it back verbatim without paraphrasing it.
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

const USAGE = `usage: yoki-agent --backend codex|omp|mock --prompt-file <file> [options]

  --backend <name>       codex | omp | mock                     (required)
  --prompt-file <file>   the prompt, read verbatim              (required)
  --model <tier|id>      haiku|sonnet|opus|<backend model id>
  --schema <file.json>   JSON Schema; the result is validated against it
  --sandbox <mode>       read-only (default) | workspace-write | danger-full-access
  --cwd <dir>            working directory for the call         (default: cwd)
  --effort <level>       low | medium | high | xhigh | max
  --agent-type <name>    agent definition whose preamble is prepended
  --timeout <ms>         per-call wall clock ceiling
  --retries <n>          transient-failure retries
  --model-map <t>=<id>,… tier overrides for this call
  --label <text>         journal/progress label (default: yoki-agent)
  --mock <file>          fixture file for --backend mock
  --run-id <id>          journal this call under an existing run id
  --dry-run              resolve everything, spawn nothing
  --json                 print only the result on stdout; footer to stderr

exit: 0 ok, 1 usage, 2 backend error, 3 schema failure after retry
`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['json', 'dry-run']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { out[key] = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

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

function numberFlag(value) {
  if (value === undefined || value === true) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readTextFile(file, what) {
  try {
    return fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${what} ${file}: ${err.message}`);
  }
}

function readSchemaFile(file) {
  const text = readTextFile(file, 'schema file');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('not a JSON object');
    return parsed;
  } catch (err) {
    throw new UsageError(`--schema ${file} is not a JSON Schema object: ${err.message}`);
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

  const journal = new Journal(plan.runId);
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

  const entry = lastOkEntry(journal);
  if (result === null || result === undefined) {
    const failure = lastErrorEntry(journal);
    stderr.write(`yoki-agent: backend call failed${failure && failure.error ? `: ${failure.error}` : ''}\n`);
    exitCode = 2;
  }

  if (exitCode === 0) {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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

/** Resolve every flag into the concrete plan for one call, refusing bad
 *  input BEFORE anything is journaled or spawned. */
function buildPlan(flags, env) {
  const requestedBackend = requiredString(flags, 'backend');
  const promptFile = requiredString(flags, 'prompt-file');
  const prompt = readTextFile(promptFile, 'prompt file');
  if (!prompt.trim()) throw new UsageError(`--prompt-file ${promptFile} is empty`);

  // YOKI_AGENT_MOCK reroutes any backend to the mock one with that fixture.
  // It is how the workflow tests exercise a provider lane end to end without
  // a codex/omp binary on the machine — and how a human can dry-run a lane's
  // wiring. The footer still reports which backend was ASKED for, so a mock
  // run is never mistaken for a real one.
  const mockOverride = typeof env.YOKI_AGENT_MOCK === 'string' && env.YOKI_AGENT_MOCK.trim()
    ? env.YOKI_AGENT_MOCK.trim() : '';
  const backendName = mockOverride ? 'mock' : requestedBackend;
  const backend = backends.loadBackend(backendName);

  const cwd = flags.cwd ? path.resolve(String(flags.cwd)) : process.cwd();
  const modelMap = models.parseModelMap(optionalString(flags, 'model-map') || '');
  const model = optionalString(flags, 'model');
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
    backend,
    cwd,
    prompt,
    schema: flags.schema ? readSchemaFile(String(flags.schema)) : undefined,
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

function lastOkEntry(journal) {
  const entries = journal.readAll().filter((e) => e.status === 'ok');
  return entries.length ? entries[entries.length - 1] : null;
}

function lastErrorEntry(journal) {
  const entries = journal.readAll().filter((e) => e.status === 'error');
  return entries.length ? entries[entries.length - 1] : null;
}

async function main(argv = process.argv.slice(2)) {
  const code = await run(argv);
  process.exitCode = code;
  return code;
}

if (require.main === module) {
  main();
}

module.exports = { main, run, parseArgs, buildPlan, formatFooter, USAGE, UsageError };
