'use strict';

/**
 * Per-harness headless command construction for yoki-loop:
 *
 *   codex:  codex exec --skip-git-repo-check -C <cwd> -s <sandbox>
 *           --json [-m m] [resume <id>] -        (prompt on stdin, stdin closed —
 *           the S1 spike found `codex exec` hangs without EOF on stdin)
 *   omp:    omp -p --mode json [--model m] --no-extensions
 *           -e ~/.omp/agent/extensions/yoki-bridge.ts <prompt>
 *
 * `claude` was a third harness here and is deliberately gone: Claude Code
 * has its own `/loop` and scheduled routines, so driving it through a
 * headless `claude -p` was a second, unsupported path to the same thing —
 * one that may move to metered billing. `--harness claude` is refused by
 * name (see CLAUDE_HARNESS_REFUSAL) rather than reported as an unknown
 * value, so an existing launchd plist is told what to use instead.
 *
 * `buildCommand` returns `{cmd, args, stdin}` — `stdin` is the string to
 * write to the child's stdin (then close it) or `null` when the prompt goes
 * on argv instead. The spec's omp line is written `command omp ...`; that
 * `command` token is a shell builtin whose only job (see the interactive
 * `omp()` wrapper in domains/dev/shell/zsh/functions.zsh) is bypassing that
 * same wrapper function from an interactive shell. This runner spawns `omp`
 * directly via child_process (no shell), which already never goes through a
 * shell function — so the token is dropped rather than reproduced as a
 * meaningless first argv element. The guard the wrapper injects is kept:
 * `--no-extensions -e <yoki-bridge.ts>` is always added.
 */

const os = require('os');
const path = require('path');

const YOKI_BRIDGE_RELATIVE = path.join('.omp', 'agent', 'extensions', 'yoki-bridge.ts');

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * A loop's whole point is standing work in a repo — "run the morning triage
 * every hour" — so unlike a graph agent() call, workspace-write stays the
 * default here. It is a default rather than a hardcoded flag because the
 * riskiest loop of all is `--prompt-from-artifact-inbox`, whose prompt is
 * written by artifact viewers: pairing that with `--sandbox read-only` gives
 * an unattended launchd job that can read and report but not edit, and there
 * was previously no way to ask for it.
 *
 * That promise only holds if every harness honours the flag. codex has a
 * native `-s`; omp does not, so read-only is expressed there through its own
 * tool-restriction flag (see the build functions below). The flag is never
 * accepted-and-discarded on any harness — a silently-full-write job is the
 * one outcome this option exists to prevent.
 */
const DEFAULT_SANDBOX = 'workspace-write';

/** @throws when `sandbox` is not one of `codex exec -s`'s accepted values. */
function resolveSandbox(sandbox) {
  if (sandbox === undefined || sandbox === null || sandbox === '') return DEFAULT_SANDBOX;
  const mode = String(sandbox);
  if (!SANDBOX_MODES.includes(mode)) {
    throw new Error(`yoki-loop: unknown --sandbox "${mode}" (expected one of ${SANDBOX_MODES.join(', ')})`);
  }
  return mode;
}

function ompGuardPath(homeDir) {
  return path.join(homeDir || os.homedir(), YOKI_BRIDGE_RELATIVE);
}

/**
 * The refusal `--harness claude` gets. Named rather than folded into the
 * unknown-harness message: a user reaching for it has a working intent
 * (run this prompt on a schedule against Claude) that Claude Code answers
 * natively, so the error points at that instead of just rejecting a value.
 */
const CLAUDE_HARNESS_REFUSAL = 'yoki-loop: the claude harness was removed — Claude Code has native /loop and scheduled routines; yoki-loop harnesses are codex and omp';

/**
 * omp's tool-restriction flag is `--tools=<value>` ("Comma-separated list of
 * tools to enable (default: all)", `command omp --help`, omp 18.0.4) — an
 * allow-list, so a read-only run enables only the tools that read. Names are
 * omp's own builtin tool ids (see lib/targets/omp-tool-names.js, derived
 * from the binary's BUILTIN_TOOLS registry). `task` is deliberately absent:
 * a subagent would not inherit this restriction.
 */
const OMP_READ_ONLY_TOOLS = ['read', 'grep', 'glob', 'web_search'];

function buildCodexCommand({ prompt, cwd, model, resumeSessionId, sandbox }) {
  const args = ['exec', '--skip-git-repo-check', '-C', cwd, '-s', resolveSandbox(sandbox), '--json'];
  if (model) args.push('-m', model);
  if (resumeSessionId) args.push('resume', resumeSessionId);
  args.push('-');
  return { cmd: 'codex', args, stdin: prompt };
}

function buildOmpCommand({ prompt, model, homeDir, sandbox }) {
  const args = ['-p', '--mode', 'json'];
  if (model) args.push('--model', model);
  const mode = resolveSandbox(sandbox);
  if (mode === 'read-only') args.push('--tools', OMP_READ_ONLY_TOOLS.join(','));
  args.push('--no-extensions', '-e', ompGuardPath(homeDir), prompt);
  return { cmd: 'omp', args, stdin: null };
}

/**
 * @param {object} opts
 * @param {'codex'|'omp'} opts.harness
 * @param {string} opts.prompt
 * @param {string} opts.cwd
 * @param {string} [opts.model] already-resolved model id (see models.js);
 *   omitted entirely when falsy
 * @param {string} [opts.resumeSessionId] omitted entirely when falsy
 * @param {string} [opts.homeDir] override for `os.homedir()` (tests)
 * @param {'read-only'|'workspace-write'|'danger-full-access'} [opts.sandbox]
 *   defaults to `workspace-write` — see DEFAULT_SANDBOX. Both harnesses
 *   honour it; neither ignores it silently:
 *     codex  `-s <mode>` (native)
 *     omp    `--tools <read tools>` on read-only
 *   `workspace-write` and `danger-full-access` add no flag on omp: it has no
 *   capability wider than its own default to grant.
 * @returns {{cmd: string, args: string[], stdin: string|null}}
 */
function buildCommand(opts) {
  const { harness } = opts;
  if (harness === 'claude') throw new Error(CLAUDE_HARNESS_REFUSAL);
  if (harness === 'codex') return buildCodexCommand(opts);
  if (harness === 'omp') return buildOmpCommand(opts);
  throw new Error(`yoki-loop: unknown harness "${harness}" (expected codex or omp)`);
}

module.exports = {
  buildCommand,
  ompGuardPath,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
  CLAUDE_HARNESS_REFUSAL,
  OMP_READ_ONLY_TOOLS,
};
