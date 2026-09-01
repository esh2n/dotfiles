'use strict';

/**
 * `yoki-loop run <name>` — the whole per-run flow (task T19):
 *   1. daily-cap check (.yoki.json loopDailyCap, unless --dry-run)
 *   2. resolve --model through core/harness-models.json
 *   3. resolve --resume against the last stored sessionId for this loop
 *   4. build the harness argv (argv.js)
 *   5. --dry-run: print the argv, run nothing, append nothing
 *      otherwise: spawn it, parse the sessionId out of stdout, append the
 *      runs.jsonl row
 *
 * The child process is never spawned through a shell — `spawnSync(cmd,
 * args)` with an argv array, so a prompt containing quotes/spaces/newlines
 * needs no escaping to reach the harness intact.
 */

const { spawnSync } = require('child_process');

const config = require('./config');
const models = require('./models');
const { buildCommand } = require('./argv');
const { extractSessionId } = require('./session-id');
const state = require('./state');

class DailyCapError extends Error {}

/** Shell-quotes one argv token for the human-readable `--dry-run` line —
 *  cosmetic only; the real run never goes through a shell. */
function shellQuote(token) {
  const text = String(token);
  if (text !== '' && /^[A-Za-z0-9_.\-/:=@,]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function formatArgvLine(cmd, args) {
  return [cmd, ...args].map(shellQuote).join(' ');
}

/**
 * @param {object} options
 * @param {string} options.name loop name (state directory / plist label)
 * @param {'claude'|'codex'|'omp'} options.harness
 * @param {string} options.cwd
 * @param {string} options.prompt
 * @param {string} [options.model] a tier or a concrete model id
 * @param {'read-only'|'workspace-write'|'danger-full-access'} [options.sandbox]
 *   `--sandbox`; codex only, defaults to workspace-write (see argv.js)
 * @param {boolean} [options.resume] resume the last stored session for this loop
 * @param {number} [options.maxRuns] `--max-runs`, the CLI-level cap override
 * @param {boolean} [options.dryRun]
 * @param {string} options.dotfilesRoot repo root, for harness-models.json
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {() => Date} [options.now] injectable clock (tests)
 * @param {object} [deps] injectable collaborators (tests) — `spawn`,
 *   `writeOut`
 * @returns {object} `{dryRun: true, cmd, args, line}` for a dry run, or
 *   `{dryRun: false, row, stdout, stderr}` for a real one
 */
function run(options, deps = {}) {
  const {
    name,
    harness,
    cwd,
    prompt,
    model,
    sandbox,
    resume = false,
    maxRuns,
    dryRun = false,
    dotfilesRoot,
    env = process.env,
    now = () => new Date(),
  } = options;

  const spawn = deps.spawn || spawnSync;
  const writeOut = deps.writeOut || ((text) => process.stdout.write(text));

  const runs = state.readRuns(name, env);

  if (!dryRun) {
    const cap = config.resolveDailyCap(cwd, maxRuns);
    const { overCap, count } = state.checkDailyCap(runs, cap, now());
    if (overCap) {
      throw new DailyCapError(
        `yoki-loop: daily cap reached for "${name}" (${count}/${cap}). ` +
          'Raise loopDailyCap in .yoki.json, or pass a higher --max-runs.'
      );
    }
  }

  const harnessModels = models.loadHarnessModels(dotfilesRoot);
  const resolvedModel = model ? models.resolveModel(harness, model, harnessModels) : '';
  const resumeSessionId = resume ? state.lastSessionId(runs) : null;

  const { cmd, args, stdin } = buildCommand({
    harness,
    prompt,
    cwd,
    model: resolvedModel,
    resumeSessionId,
    sandbox,
  });

  if (dryRun) {
    const line = formatArgvLine(cmd, args);
    writeOut(`${line}\n`);
    return { dryRun: true, cmd, args, line };
  }

  const startedAt = Date.now();
  const result = spawn(cmd, args, {
    cwd,
    input: stdin != null ? stdin : undefined,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exit = typeof result.status === 'number' ? result.status : result.signal ? -1 : 1;
  const sessionId = extractSessionId(harness, stdout);

  const row = {
    ts: now().toISOString(),
    harness,
    cmd: [cmd, ...args],
    exit,
    durationMs,
    sessionId,
  };
  state.appendRun(name, row, env);

  return { dryRun: false, row, stdout, stderr };
}

module.exports = { run, DailyCapError, formatArgvLine, shellQuote };
