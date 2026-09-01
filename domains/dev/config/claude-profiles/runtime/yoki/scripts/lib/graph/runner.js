'use strict';

/**
 * Core execution engine: compiles a Workflow-tool-shaped script (see
 * API.md — `export const meta = {...}` + a body using `return`/`await` at
 * "top level") into a callable async function, wires up the injected
 * globals via api.js, and runs it end to end — journaling every agent()
 * call, checking the daily-cap guard once per top-level run, and reporting
 * progress through an emitter shared by the human/NDJSON printers in
 * cli.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { createApi } = require('./api');
const { Journal, runDir } = require('./journal');
const guard = require('./guard');

function workflowsDir() {
  return path.join(os.homedir(), '.claude', 'workflows');
}

/**
 * Scan `source` starting at `start` (which must point at a `{`) for its
 * matching `}`, tracking string/template-literal state and line/block
 * comments so a stray brace inside a string or comment never miscounts.
 * Used for `export const meta = { ... }` — a JS object literal, not JSON,
 * so a JSON-only balanced scanner (schema.js's) isn't reused here.
 */
function scanBalancedBraces(source, start) {
  let depth = 0;
  let i = start;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i += 1; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i += 1;
  }
  return null;
}

/** Extract and evaluate just `meta` — cheap enough to use for `list`
 *  without compiling/running the rest of the script. */
function extractMeta(source) {
  const declMatch = /export\s+const\s+meta\s*=\s*/.exec(source);
  if (!declMatch) throw new Error('script has no `export const meta = {...}` declaration');
  const braceStart = source.indexOf('{', declMatch.index);
  if (braceStart === -1) throw new Error('`export const meta =` is not followed by an object literal');
  const literal = scanBalancedBraces(source, braceStart);
  if (!literal) throw new Error('meta object literal has unbalanced braces');
  // eslint-disable-next-line no-new-func
  const meta = new Function(`'use strict'; return (${literal});`)();
  return { meta, metaEnd: braceStart + literal.length };
}

const BODY_PARAM_NAMES = ['args', 'phase', 'log', 'agent', 'parallel', 'pipeline', 'budget', 'workflow', 'Date', 'Math'];

/**
 * Compile a script's source into `{ meta, run(apiGlobals) }`. See API.md
 * "Execution mechanism" for why this is an AsyncFunction built from named
 * parameters rather than an ESM `import()`.
 */
function compileScript(source) {
  const { meta, metaEnd } = extractMeta(source);
  let bodyStart = metaEnd;
  while (bodyStart < source.length && (source[bodyStart] === ';' || /\s/.test(source[bodyStart]))) bodyStart += 1;
  const body = source.slice(bodyStart);

  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  let fn;
  try {
    fn = new AsyncFunction(...BODY_PARAM_NAMES, body);
  } catch (err) {
    throw new Error(`script body failed to compile: ${err.message}`);
  }

  return {
    meta,
    async run(apiGlobals) {
      return fn(
        apiGlobals.args, apiGlobals.phase, apiGlobals.log, apiGlobals.agent,
        apiGlobals.parallel, apiGlobals.pipeline, apiGlobals.budget, apiGlobals.workflow,
        apiGlobals.Date, apiGlobals.Math,
      );
    },
  };
}

function loadBackend(name) {
  switch (name) {
    case 'claude': return require('./backends/claude');
    case 'codex': return require('./backends/codex');
    case 'omp': return require('./backends/omp');
    case 'mock': return require('./backends/mock');
    default: throw new Error(`unknown backend "${name}" (expected claude|codex|omp|mock)`);
  }
}

/** `run <name|path>` resolution: an explicit path (contains a path
 *  separator, or resolves to an existing file as given) wins; otherwise
 *  treat it as a saved workflow's name under ~/.claude/workflows. */
function resolveScriptPath(nameOrPath, cwd) {
  if (typeof nameOrPath === 'object' && nameOrPath && nameOrPath.scriptPath) {
    return path.resolve(nameOrPath.scriptPath);
  }
  const asGiven = path.resolve(cwd || process.cwd(), String(nameOrPath));
  if (String(nameOrPath).includes(path.sep) || String(nameOrPath).endsWith('.js')) {
    if (fs.existsSync(asGiven)) return asGiven;
  }
  const named = path.join(workflowsDir(), `${nameOrPath}.js`);
  if (fs.existsSync(named)) return named;
  if (fs.existsSync(asGiven)) return asGiven;
  throw new Error(`workflow "${nameOrPath}" not found (looked for ${named} and ${asGiven})`);
}

function listWorkflows() {
  const dir = workflowsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const { meta } = extractMeta(fs.readFileSync(file, 'utf8'));
        return { name: meta.name || path.basename(f, '.js'), description: meta.description || '', file };
      } catch (err) {
        return { name: path.basename(f, '.js'), description: `(unparseable: ${err.message})`, file, error: true };
      }
    });
}

function generateRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function writeRunMeta(runId, meta) {
  const dir = runDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));
}

function readRunMeta(runId) {
  const file = path.join(runDir(runId), 'run.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Execute one script end to end.
 *
 * @param {object} options
 * @param {string} options.scriptPath resolved absolute path
 * @param {any} options.args parsed args value for the script
 * @param {string} options.backendName claude|codex|omp|mock
 * @param {string} [options.cwd]
 * @param {string} [options.runId] resume an existing run (replays cached
 *   agent() calls from its journal); a fresh id is generated when omitted
 * @param {boolean} [options.dryRun]
 * @param {(event: object) => void} [options.emit] progress sink (defaults
 *   to a no-op — cli.js supplies the human/NDJSON printer)
 * @param {number} [options.concurrency]
 * @param {string} [options.model]
 * @param {string} [options.effort]
 * @param {string} [options.mockFile]
 * @param {number} [options.timeoutMs]
 * @param {string} [options._parentRunId] internal: set when this call is a
 *   `workflow()` nested invocation, to (a) skip the guard cap (it already
 *   ran for the top-level launch) and (b) refuse a further nested call.
 */
async function executeScript(options) {
  const {
    scriptPath, args, backendName, cwd = process.cwd(), dryRun = false,
    emit = () => {}, concurrency, model, effort, mockFile, timeoutMs, _parentRunId,
  } = options;
  const runId = options.runId || generateRunId();
  const isResume = !!options.runId;

  const source = fs.readFileSync(scriptPath, 'utf8');
  const compiled = compileScript(source);
  const journal = new Journal(runId);
  const backend = loadBackend(backendName);

  if (!_parentRunId && !dryRun) {
    const decision = guard.checkAndRecord(cwd);
    if (!decision.allowed) {
      emit({ type: 'guard-denied', runId, message: decision.message, ts: new Date().toISOString() });
      return { runId, meta: compiled.meta, status: 'denied', error: decision.message };
    }
  }

  const ctx = {
    runId, journal, backend, cwd, model, effort, mockFile, dryRun,
    resume: isResume, concurrency, emit, timeoutMs,
    args,
    runChildWorkflow: _parentRunId
      ? undefined
      : async (nameOrRef, childArgs) => {
        const childPath = resolveScriptPath(nameOrRef, cwd);
        const childResult = await executeScript({
          scriptPath: childPath, args: childArgs, backendName, cwd, dryRun, emit,
          concurrency, model, effort, mockFile, timeoutMs, _parentRunId: runId,
        });
        if (childResult.status === 'error') throw new Error(childResult.error || 'child workflow failed');
        return childResult.result;
      },
  };
  const apiGlobals = createApi(ctx);

  writeRunMeta(runId, {
    name: compiled.meta.name, scriptPath, backend: backendName, args, cwd,
    startedAt: new Date().toISOString(), status: 'running',
  });
  emit({ type: 'run-start', runId, name: compiled.meta.name, backend: backendName, ts: new Date().toISOString() });

  let status = 'ok';
  let error;
  let result;
  try {
    result = await compiled.run(apiGlobals);
  } catch (err) {
    status = 'error';
    error = err.message;
  }

  writeRunMeta(runId, {
    name: compiled.meta.name, scriptPath, backend: backendName, args, cwd,
    startedAt: readRunMeta(runId)?.startedAt, finishedAt: new Date().toISOString(), status, error,
  });
  emit({ type: 'run-end', runId, status, error, result, ts: new Date().toISOString() });

  return { runId, meta: compiled.meta, status, result, error };
}

module.exports = {
  compileScript,
  extractMeta,
  scanBalancedBraces,
  loadBackend,
  resolveScriptPath,
  listWorkflows,
  executeScript,
  generateRunId,
  writeRunMeta,
  readRunMeta,
  workflowsDir,
};
