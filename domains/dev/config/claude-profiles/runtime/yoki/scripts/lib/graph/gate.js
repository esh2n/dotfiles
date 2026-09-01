'use strict';

/**
 * `agent(prompt, { gate: 'npm test' })` — a mechanical pass/fail check run
 * AFTER the agent call returns, against the tree that agent actually wrote.
 *
 * Why this exists at all: a workflow's "Gate" phase asks a model to run the
 * build and report whether it passed, and the model is the one deciding what
 * "passed" means. A command's exit code is not a judgment — it is the same
 * answer every time, for free, and it cannot be talked out of a failure by a
 * persuasive diff. The model stays for the half that needs reasoning (which
 * failures matter, what the diff really did); the gate owns the half that is
 * a number.
 *
 * TRUST BOUNDARY — read before adding a caller. The command string is
 * WORKFLOW-AUTHORED and is executed with the operator's own privileges. It
 * may come from a workflow script (`core/workflows`, a pack's `workflows`
 * directory, `~/.claude/workflows`) and from the `args` an operator typed at
 * launch.
 * It must NEVER be built from model output, from a file the run read, from a
 * diff hunk, from a fetched page, or from anything else the run does not
 * already trust to run as a shell command. `agent()` does not sanitize it and
 * cannot: a gate is by definition an arbitrary project command.
 *
 * Execution shape: the command is split into an argv and spawned directly
 * when it is a plain `cmd arg arg` line, so no shell is involved for the
 * common case (`npm test`, `go vet ./...`, `cargo build --locked`). Only a
 * command that genuinely needs shell semantics — `&&`, a pipe, a redirect, a
 * glob, a variable — falls back to `sh -c`. Both routes run the same command
 * with the same privileges; the split is about predictability (no surprise
 * word-splitting or glob expansion), not about containment.
 */

const { spawnCollect } = require('./backends/common');

/**
 * Fallback ceiling for one gate command. Ten minutes is the prior art's
 * number and the right order of magnitude here too: a full `go test ./...`
 * or `pnpm test` on a real repo can legitimately take minutes, and a gate
 * that fires early reports a failure the code does not have.
 */
const DEFAULT_GATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Characters whose presence means the caller wanted a SHELL, not a bare
 *  argv: operators, redirects, substitution, globs, expansions, comments.
 *  Anything here outside quotes routes the command through `sh -c`. */
const SHELL_METACHARS = new Set([
  '|', '&', ';', '<', '>', '(', ')', '$', '`', '\\', '*', '?',
  '[', ']', '{', '}', '~', '!', '#', '\n', '\r',
]);

const SHELL = ['sh', '-c'];

/**
 * Split `command` into an argv, or return null when it needs a real shell.
 *
 * Handles the one piece of quoting a plain command line needs — `'...'` and
 * `"..."` around an argument with spaces — and bails out (null) on anything
 * else, rather than half-emulating a shell. Bailing out is not a failure: it
 * is the `sh -c` branch, which is what the author meant by writing `&&`.
 */
function splitArgv(command) {
  const tokens = [];
  let current = '';
  let started = false; // distinguishes an empty quoted arg ('') from no arg
  let quote = null;
  for (const ch of String(command)) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (ch === ' ' || ch === '\t') {
      if (started) { tokens.push(current); current = ''; started = false; }
      continue;
    }
    if (SHELL_METACHARS.has(ch)) return null;
    current += ch;
    started = true;
  }
  if (quote) return null; // unbalanced quote — let sh report it, not us
  if (started) tokens.push(current);
  return tokens.length ? tokens : null;
}

/**
 * The `[cmd, argv]` a gate command is spawned as.
 * @returns {{cmd: string, argv: string[], shell: boolean}}
 */
function resolveCommand(command) {
  const argv = splitArgv(command);
  if (argv) return { cmd: argv[0], argv: argv.slice(1), shell: false };
  return { cmd: SHELL[0], argv: [SHELL[1], String(command)], shell: true };
}

/**
 * The error a failed gate becomes, so `agent()` can route it through exactly
 * the same failure handling as a backend failure: journaled `status: 'error'`,
 * emitted as a failing `agent-end`, and `agent()` resolving to `null`.
 *
 * `transient: false` is deliberate and load-bearing. A gate TIMEOUT produces
 * the message "...timed out after 600000ms", and retry.js's transient
 * patterns match `/\btimed out\b/` — so without this flag a hung test suite
 * would be classified retryable and re-run, costing another ten minutes to
 * learn the same thing. A gate is a verdict on work already done; re-running
 * the identical command against the identical tree cannot change it.
 */
class GateFailureError extends Error {
  constructor(message, outcome) {
    super(message);
    this.name = 'GateFailureError';
    this.gate = outcome;
    this.transient = false;
    this.timedOut = !!(outcome && outcome.killed);
  }
}

/**
 * Run one gate command and report what happened. Never throws for a failing
 * command — a non-zero exit is an ANSWER, not an error; only a command that
 * could not be spawned at all rejects, and even that is folded into a
 * failing outcome so the caller has one shape to handle.
 *
 * @param {string} command workflow-authored (see the trust boundary above)
 * @param {object} [options]
 * @param {string} [options.cwd] the agent's worktree when it had one — that
 *   is the whole point of running this here rather than in the run's cwd.
 * @param {number} [options.timeoutMs]
 * @param {object} [options.env]
 * @param {() => number} [options.now] injectable clock (tests)
 * @returns {Promise<{command:string, ok:boolean, exitCode:number|null,
 *   ms:number, killed:boolean, output:string, cwd?:string}>}
 */
async function run(command, options = {}) {
  const now = options.now || Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : (options.timeoutMs === undefined ? DEFAULT_GATE_TIMEOUT_MS : undefined);
  const { cmd, argv } = resolveCommand(command);
  const startedAt = now();
  let res;
  try {
    res = await spawnCollect(cmd, argv, { cwd: options.cwd, env: options.env, timeoutMs });
  } catch (err) {
    // The command does not exist, or the OS refused to start it. That is a
    // gate failure, not a runner crash: a workflow naming a command this
    // machine does not have has not verified anything.
    return {
      command: String(command),
      ok: false,
      exitCode: null,
      ms: Math.max(0, now() - startedAt),
      killed: false,
      output: `gate command could not be started: ${err.message}`,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    };
  }
  const output = [res.stdout, res.stderr]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n');
  // A SIGKILLed child reports no exit code of its own, so `killed` — not the
  // code — is what separates "ran out of time" from "chose to exit 0".
  const killed = !!res.timedOut;
  const exitCode = typeof res.code === 'number' ? res.code : null;
  return {
    command: String(command),
    ok: !killed && exitCode === 0,
    exitCode,
    ms: Math.max(0, now() - startedAt),
    killed,
    output,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  };
}

/** The journal/event record for a gate run: the four fields API.md promises,
 *  without the (possibly enormous) command output. */
function toRecord(outcome) {
  return {
    command: outcome.command,
    exitCode: outcome.exitCode,
    ms: outcome.ms,
    killed: outcome.killed,
  };
}

/** One-line reason for a failed gate, used as the agent's `error`. Prefers
 *  the command's own tail — that is what tells an operator what broke — and
 *  falls back to naming the command when it printed nothing. */
function failureMessage(outcome, { maxOutput = 2000 } = {}) {
  if (outcome.killed) {
    return `gate timed out and was killed: ${outcome.command}`;
  }
  const tail = String(outcome.output || '').trim();
  if (!tail) return `gate failed (exit ${outcome.exitCode}): ${outcome.command}`;
  const clipped = tail.length > maxOutput ? `…${tail.slice(-maxOutput)}` : tail;
  return `gate failed (exit ${outcome.exitCode}): ${outcome.command}\n${clipped}`;
}

module.exports = {
  run,
  toRecord,
  failureMessage,
  splitArgv,
  resolveCommand,
  GateFailureError,
  DEFAULT_GATE_TIMEOUT_MS,
  SHELL_METACHARS,
};
