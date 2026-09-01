'use strict';

/**
 * Per-harness headless command construction for yoki-loop (task T19 spec):
 *
 *   claude: claude -p <prompt> --output-format json [--model m] [--resume <id>]
 *   codex:  codex exec --skip-git-repo-check -C <cwd> -s workspace-write
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

function ompGuardPath(homeDir) {
  return path.join(homeDir || os.homedir(), YOKI_BRIDGE_RELATIVE);
}

function buildClaudeCommand({ prompt, model, resumeSessionId }) {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  return { cmd: 'claude', args, stdin: null };
}

function buildCodexCommand({ prompt, cwd, model, resumeSessionId }) {
  const args = ['exec', '--skip-git-repo-check', '-C', cwd, '-s', 'workspace-write', '--json'];
  if (model) args.push('-m', model);
  if (resumeSessionId) args.push('resume', resumeSessionId);
  args.push('-');
  return { cmd: 'codex', args, stdin: prompt };
}

function buildOmpCommand({ prompt, model, homeDir }) {
  const args = ['-p', '--mode', 'json'];
  if (model) args.push('--model', model);
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
 * @returns {{cmd: string, args: string[], stdin: string|null}}
 */
function buildCommand(opts) {
  const { harness } = opts;
  if (harness === 'claude') return buildClaudeCommand(opts);
  if (harness === 'codex') return buildCodexCommand(opts);
  if (harness === 'omp') return buildOmpCommand(opts);
  throw new Error(`yoki-loop: unknown harness "${harness}" (expected claude, codex, or omp)`);
}

module.exports = { buildCommand, ompGuardPath };
