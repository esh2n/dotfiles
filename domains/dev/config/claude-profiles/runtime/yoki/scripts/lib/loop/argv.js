'use strict';

/**
 * Per-harness headless command construction for yoki-loop (task T19 spec):
 *
 *   claude: claude -p <prompt> --output-format json [--model m] [--resume <id>]
 *   codex:  codex exec --skip-git-repo-check -C <cwd> -s <sandbox>
 *           --json [-m m] [resume <id>] -        (prompt on stdin, stdin closed —
 *           the S1 spike found `codex exec` hangs without EOF on stdin)
 *   omp:    omp -p --mode json [--model m] --no-extensions
 *           -e ~/.omp/agent/extensions/yoki-bridge.ts <prompt>
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
 * native `-s`; claude and omp do not, so read-only is expressed there
 * through each CLI's own tool-restriction flag (see the two build functions
 * below). The flag is never accepted-and-discarded on any harness — a
 * silently-full-write job is the one outcome this option exists to prevent.
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
 * Claude Code has no `-s`-style sandbox flag, but it does have
 * `--disallowedTools` (confirmed in `claude --help` on this machine:
 * "`--disallowedTools, --disallowed-tools <tools...>` Comma or
 * space-separated list of tool names to deny"). Denying every tool that can
 * change the filesystem is the closest thing it has to codex's `read-only`,
 * and it is a real restriction rather than a note in a doc comment.
 *
 * `Bash` is on the list because a shell is a write tool: leaving it enabled
 * would make the whole restriction cosmetic. `Task` is on it for the same
 * reason at one remove — a subagent does not inherit this argv, so a
 * read-only run that can still spawn one has an unrestricted write path.
 * (This mirrors omp's allow-list, which deliberately omits `task`.)
 */
const CLAUDE_READ_ONLY_DENIED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task'];

/**
 * omp's tool-restriction flag is `--tools=<value>` ("Comma-separated list of
 * tools to enable (default: all)", `command omp --help`, omp 18.0.4) — an
 * allow-list, so a read-only run enables only the tools that read. Names are
 * omp's own builtin tool ids (see lib/targets/omp-tool-names.js, derived
 * from the binary's BUILTIN_TOOLS registry). `task` is deliberately absent:
 * a subagent would not inherit this restriction.
 */
const OMP_READ_ONLY_TOOLS = ['read', 'grep', 'glob', 'web_search'];

function buildClaudeCommand({ prompt, model, resumeSessionId, sandbox }) {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  const mode = resolveSandbox(sandbox);
  // workspace-write and danger-full-access both mean "the harness's own
  // default capability" here — claude has nothing narrower than read-only to
  // express, and nothing wider than its own default to grant.
  if (mode === 'read-only') args.push('--disallowedTools', CLAUDE_READ_ONLY_DENIED_TOOLS.join(','));
  return { cmd: 'claude', args, stdin: null };
}

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
 * @param {'claude'|'codex'|'omp'} opts.harness
 * @param {string} opts.prompt
 * @param {string} opts.cwd
 * @param {string} [opts.model] already-resolved model id (see models.js);
 *   omitted entirely when falsy
 * @param {string} [opts.resumeSessionId] omitted entirely when falsy
 * @param {string} [opts.homeDir] override for `os.homedir()` (tests)
 * @param {'read-only'|'workspace-write'|'danger-full-access'} [opts.sandbox]
 *   defaults to `workspace-write` — see DEFAULT_SANDBOX. Every harness
 *   honours it; none of them ignores it silently:
 *     codex  `-s <mode>` (native)
 *     claude `--disallowedTools <write tools>` on read-only
 *     omp    `--tools <read tools>` on read-only
 *   `workspace-write` and `danger-full-access` add no flag on claude/omp:
 *   neither CLI has a capability wider than its own default to grant.
 * @returns {{cmd: string, args: string[], stdin: string|null}}
 */
function buildCommand(opts) {
  const { harness } = opts;
  if (harness === 'claude') return buildClaudeCommand(opts);
  if (harness === 'codex') return buildCodexCommand(opts);
  if (harness === 'omp') return buildOmpCommand(opts);
  throw new Error(`yoki-loop: unknown harness "${harness}" (expected claude, codex, or omp)`);
}

module.exports = {
  buildCommand,
  ompGuardPath,
  resolveSandbox,
  SANDBOX_MODES,
  DEFAULT_SANDBOX,
  CLAUDE_READ_ONLY_DENIED_TOOLS,
  OMP_READ_ONLY_TOOLS,
};
