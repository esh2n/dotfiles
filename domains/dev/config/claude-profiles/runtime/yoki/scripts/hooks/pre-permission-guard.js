'use strict';

/**
 * PreToolUse(Bash|Write|Edit|MultiEdit): denies the deny-list entries that
 * are marked `enforce: [hook]` in permissions.yaml (T8) — patterns the S3
 * spike found a declarative permission match alone cannot be trusted for
 * everywhere yoki runs (shell redirection, wildcard rm targets, the write
 * side of in-workspace secret-file globs). Runs in Claude Code too, as
 * defense in depth on top of Claude's own permission match.
 *
 * Reads `<CLAUDE_DIR>/.yoki/permissions.json` — written by
 * `lib/permissions/to-claude.js`'s hookEnforcedDeny() output at
 * `yoki-switch apply` time, as `{"deny": [{"pattern": "...", "reason": "..."}]}`.
 * A missing or unreadable file fails open (exitCode 0): a guard that itself
 * crashes must never become the reason the harness blocks every tool call.
 *
 * Profile: always on (registered "minimal,standard,strict" — see
 * core/settings.layer.json).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveClaudeDir() {
  return process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

/** Loads the hook-enforced deny list. Any error (missing file, bad JSON,
 * wrong shape) yields an empty list — fail open. */
function loadDenyPatterns(claudeDir) {
  const file = path.join(claudeDir, '.yoki', 'permissions.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.deny)) return [];
    return parsed.deny.filter(e => e && typeof e.pattern === 'string');
  } catch {
    return [];
  }
}

/** Splits a Claude permission pattern like "Bash(rm -rf /*)" into its tool
 * name and the text inside the parens ("rm -rf /*"). A bare tool name with
 * no parens (e.g. "WebSearch") has no matcher here and is ignored. */
function classifyPattern(pattern) {
  const m = /^([A-Za-z]+)\((.*)\)$/.exec(pattern);
  if (!m) return null;
  return { tool: m[1], inner: m[2] };
}

/**
 * Claude's Bash pattern matching, as used by this repo's permission lists:
 * a pattern ending in " *" (space then star) is a prefix — the command must
 * equal the text before it, or start with that text plus a space. Anything
 * else (no trailing " *", or a bare trailing "*" glued to the last token
 * like "rm -rf /*") is an exact match of the whole command text — Claude
 * does no shell expansion when comparing.
 */
function matchBash(pattern, command) {
  const cmd = String(command || '').trim();
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  return cmd === pattern;
}

/**
 * Minimal glob → RegExp for the path patterns this permission set actually
 * uses: a bare double-star (any path depth) or double-star-slash (same,
 * optionally zero directories), `*` (one segment,
 * no `/`), `?` (one char, no `/`), a literal leading `~/` expanded against
 * the guard's own home dir. Everything else is escaped as a literal.
 */
function globToRegExp(glob) {
  let expanded = glob;
  if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }

  let re = '';
  for (let i = 0; i < expanded.length; ) {
    if (expanded.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (expanded.startsWith('**', i)) {
      re += '.*';
      i += 2;
      continue;
    }
    const c = expanded[i];
    if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$()[]{}|\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

function matchPath(pattern, filePath) {
  if (typeof filePath !== 'string' || filePath === '') return false;
  const re = globToRegExp(pattern);
  return re.test(filePath) || re.test(path.basename(filePath));
}

function parseInput(rawInput) {
  if (typeof rawInput !== 'string') return rawInput && typeof rawInput === 'object' ? rawInput : null;
  if (!rawInput.trim()) return null;
  try {
    return JSON.parse(rawInput);
  } catch {
    return null;
  }
}

function denyResult(pattern) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `yoki permission-guard: ${pattern}`,
      },
    }),
  };
}

function passthrough(rawInput) {
  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

/**
 * @param {string} rawInput the raw PreToolUse JSON payload
 */
function run(rawInput) {
  const input = parseInput(rawInput);
  if (!input) return passthrough(rawInput);

  const toolName = String(input.tool_name || input.tool || '');
  if (!/^(Bash|Write|Edit|MultiEdit)$/.test(toolName)) {
    return passthrough(rawInput);
  }

  let denyEntries;
  try {
    denyEntries = loadDenyPatterns(resolveClaudeDir());
  } catch {
    return passthrough(rawInput);
  }
  if (denyEntries.length === 0) return passthrough(rawInput);

  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  for (const entry of denyEntries) {
    const classified = classifyPattern(entry.pattern);
    if (!classified) continue;

    if (toolName === 'Bash' && classified.tool === 'Bash') {
      if (matchBash(classified.inner, toolInput.command)) {
        return denyResult(entry.pattern);
      }
      continue;
    }

    if (toolName !== 'Bash' && classified.tool === 'Edit') {
      const filePath = toolInput.file_path || toolInput.path || '';
      if (matchPath(classified.inner, filePath)) {
        return denyResult(entry.pattern);
      }
    }
  }

  return passthrough(rawInput);
}

module.exports = { run, matchBash, matchPath, globToRegExp, classifyPattern, loadDenyPatterns };
