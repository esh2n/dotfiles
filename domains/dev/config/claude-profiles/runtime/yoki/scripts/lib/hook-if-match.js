'use strict';

/**
 * Matches a Claude-style `if:` hook-config pattern (e.g. `Bash(git push*)`,
 * `Bash(gh pr create*)`) against a Claude-shaped hook payload.
 *
 * Claude Code itself evaluates a hook entry's `if:` field before ever
 * invoking the command, so the pattern never reaches run-with-flags.js on
 * that harness. Codex's hooks.json has no equivalent per-handler condition
 * (spike S1/S2), so the generated Codex hook command carries the same
 * pattern as a `--if "<pattern>"` CLI argument and run-with-flags.js
 * evaluates it itself — see lib/targets/codex.js.
 */

const IF_PATTERN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/;

/**
 * @param {string} pattern e.g. "Bash(git push*)"
 * @returns {{tool: string, prefix: string, hasWildcard: boolean} | null}
 */
function parseIfPattern(pattern) {
  const m = IF_PATTERN_RE.exec(String(pattern || '').trim());
  if (!m) return null;
  const [, tool, inner] = m;
  const hasWildcard = inner.endsWith('*');
  const prefix = (hasWildcard ? inner.slice(0, -1) : inner).trim();
  return { tool, prefix, hasWildcard };
}

/**
 * @param {string} pattern
 * @param {object} payload a Claude-shaped hook payload (tool_name, tool_input)
 * @returns {boolean} true when the hook should run. An unparseable pattern
 *   fails open (runs the hook) rather than silently disabling it.
 */
function matchesIf(pattern, payload) {
  const parsed = parseIfPattern(pattern);
  if (!parsed) return true;

  const toolName = payload && typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (toolName !== parsed.tool) return false;

  if (!parsed.prefix) return true;

  const input = payload && typeof payload.tool_input === 'object' && payload.tool_input ? payload.tool_input : {};
  const command = typeof input.command === 'string' ? input.command : '';
  return parsed.hasWildcard ? command.startsWith(parsed.prefix) : command === parsed.prefix;
}

module.exports = { parseIfPattern, matchesIf };
