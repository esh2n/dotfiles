'use strict';

/**
 * Recognizes the ONE non-runner hook command shape this repo's settings
 * layers actually use — the personal layer's bash wrapper around a
 * `~/.claude/hooks/<name>.sh` guard (see personal/settings.personal.json):
 *
 *   bash -c 'h=~/.claude/hooks/git-guard.sh; if bash -n "$h" 2>/dev/null;
 *            then exec bash "$h" [args…]; fi;
 *            echo "[hook] syntax check failed: … - failing open" >&2'
 *
 * These are the security-relevant guards (git-guard, unattended-guard,
 * workflow-guard, audit-log, mcp-audit, …). Before this module existed both
 * the Codex and omp generators dropped every one of them with a warning,
 * because neither goes through run-with-flags.js / run-bash-hook.js — which
 * silently downgraded protection on both foreign harnesses relative to
 * Claude Code (review finding: "personal bash guards dropped on omp/codex").
 *
 * The wrapper is pure boilerplate: `bash -n` gate then `exec bash "$h"`,
 * failing open on a syntax error. `hooks/run-bash-hook.js` performs exactly
 * that same sequence (its own header says so) plus the payload/response
 * translation the foreign harnesses need — so the correct translation is
 * "run this .sh through run-bash-hook.js", not "drop it".
 *
 * Deliberately strict: only this exact shape is recognized. Anything else
 * (the `osascript` notification hooks, a future ad-hoc one-liner) still
 * comes back null so the caller reports it as `skipped` with a reason,
 * rather than being guessed at and shipped broken.
 */

const os = require('os');
const path = require('path');

/** `h=<path>;` — the wrapper's first statement. */
const HOOK_ASSIGN_RE = /(?:^|')h=([^;'\s]+)\s*;/;
/** `exec bash "$h" [args…];` — the wrapper's actual invocation. */
const EXEC_RE = /exec\s+bash\s+"\$h"([^;']*)[;']/;

function looksLikeBashWrapper(command) {
  return typeof command === 'string' && /^bash\s+-c\s+'/.test(command) && EXEC_RE.test(command);
}

/** `~/x` -> `<home>/x`; anything else is returned unchanged (already
 * absolute, or relative — run-bash-hook.js resolves a relative path against
 * ~/.claude itself). */
function expandHome(rawPath, home) {
  if (rawPath === '~') return home;
  if (rawPath.startsWith('~/')) return path.join(home, rawPath.slice(2));
  return rawPath;
}

/**
 * @param {string} command a settings-layer hook `command` string
 * @param {{home?: string}} [options]
 * @returns {{script: string, args: string[], name: string}|null} null when
 *   `command` is not the recognized `bash -c '…exec bash "$h"…'` wrapper.
 *   `script` is absolute whenever the wrapper used `~/…` (it always does).
 */
function parseBashWrapperCommand(command, options = {}) {
  if (!looksLikeBashWrapper(command)) return null;

  const assign = HOOK_ASSIGN_RE.exec(command);
  if (!assign) return null;
  const rawPath = assign[1];
  if (!/\.sh$/.test(rawPath)) return null;

  const exec = EXEC_RE.exec(command);
  if (!exec) return null;
  const args = String(exec[1] || '')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  // A wrapper that reaches for a shell metacharacter in its args is outside
  // the shape this translation is safe for — report it as unrecognized.
  if (args.some(a => /["'$`\\<>|&]/.test(a))) return null;

  const home = options.home || os.homedir();
  const script = expandHome(rawPath, home);

  return { script, args, name: path.basename(script).replace(/\.sh$/, '') };
}

module.exports = { parseBashWrapperCommand, looksLikeBashWrapper };
