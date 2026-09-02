#!/usr/bin/env node
/**
 * PostToolUse Hook: ruff format + ruff check after editing a Python file.
 *
 * Profile: standard (registered "standard,strict" — does not run at "minimal").
 *
 * Runs, scoped to the edited file only (never the project):
 *
 *   1. `ruff format <file>` — writes the formatted file in place
 *   2. `ruff check <file>`  — lint only, no `--fix` (this hook never rewrites
 *      code beyond formatting)
 *
 * Both commands are ruff's own subcommands, so `pyproject.toml` /
 * `ruff.toml` / `.ruff.toml` settings are respected automatically by ruff
 * itself (it walks up from the target file looking for them) — this hook
 * does no config discovery of its own, unlike ts-lint-post-edit.js's
 * biome/eslint/prettier tier selection, because there is only one tool here.
 *
 * Latency budget: every invocation gets a 1000ms timeout. A timeout, `ruff`
 * missing from PATH, or a non-`.py`/`.pyi` file are all silent, exit-0,
 * fail-open — no marker files, no hint lines. Output (from `ruff check`) is
 * filtered to lines that mention the edited file, capped at 10 lines, and
 * printed to stderr with a `[py-guard]` prefix only when there is something
 * to report.
 *
 * Threat model — why this hook may run a tool against the edited file while
 * the review workflow's lanes must not: it fires on a file the agent just
 * edited in the user's OWN working tree — a project the user chose to open
 * and whose pyproject/ruff config they already own — whereas a review lane
 * runs against a branch diff the user did NOT write, where project config
 * and scripts are attacker-controlled input. Same command, different
 * provenance. Two consequences worth stating: (1) codex/omp targets
 * warn-skip this hook at translation time (its registration is not a
 * run-with-flags.js/run-bash-hook.js form — lib/targets/codex-hooks-merge.js
 * / omp-hooks.js), so there is no post-edit lint parity there; (2) unlike
 * the web pack's "project config or nothing" rule
 * (web-css-lint-post-edit.js), ruff format/check run even with no project
 * config — owner-adjudicated divergence: a formatter's defaults are safe to
 * apply on the user's own edit where a linter's imposed rule set is not.
 *
 * Registration note: this hook does NOT go through run-with-flags.js — see
 * packs/go/hooks/go-guard-post-edit.js and packs/go/rules/golang/hooks.md
 * ("Why these hooks don't go through run-with-flags.js") for why: pack-owned
 * hooks live in packs/<name>/hooks/ and are merged (symlinked) into
 * ~/.claude/hooks/ by yoki-switch's MERGE_DIRS, a location outside
 * runtime/yoki that run-with-flags.js's CLAUDE_PLUGIN_ROOT path-traversal
 * guard can never resolve into. Instead this hook is registered as a direct
 * `node ...` command in packs/python/settings.layer.json and performs its
 * own profile gating below by requiring the same
 * runtime/yoki/scripts/lib/hook-flags.js the runner itself uses.
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const TIMEOUT_MS = 1000;
const HOOK_ID = 'post:py-guard:post-edit';
const PROFILES = 'standard,strict';

const PY_EXTS = new Set(['.py', '.pyi']);

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, opts);
}

// Loads the shared profile-gating module from the runtime/yoki checkout this
// machine has configured (YOKI_ROOT / CLAUDE_PLUGIN_ROOT are always set by
// settings.json's global `env` block). Fails open (hook enabled) if it
// can't be found, so a misconfigured machine never silently loses coverage.
function loadHookFlags() {
  try {
    const root = process.env.YOKI_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (root) {
      return require(path.join(root, 'scripts', 'lib', 'hook-flags.js'));
    }
  } catch {
    // fall through to fail-open stub below
  }
  return { isHookEnabled: () => true };
}

/**
 * @returns {{output: string, missing: boolean, timedOut: boolean}}
 * `missing` = ENOENT (binary not found). `timedOut` = killed by the
 * `timeoutMs` budget. Both are fail-open: never reported to the user.
 */
function runTool(execFn, cmd, args, cwd, timeoutMs) {
  try {
    const out = execFn(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
    return { output: String(out || ''), missing: false, timedOut: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { output: '', missing: true, timedOut: false };
    }
    if (err && (err.killed || err.signal)) {
      return { output: '', missing: false, timedOut: true };
    }
    const output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
    return { output, missing: false, timedOut: false };
  }
}

function filterRelevantLines(output, filePath, cwd) {
  if (!output) return [];
  const abs = path.resolve(filePath);
  const rel = path.relative(cwd, abs);
  const base = path.basename(filePath);
  const candidates = [abs, rel, base, filePath].filter(Boolean);

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => candidates.some(c => line.includes(c)))
    .slice(0, MAX_LINES);
}

/**
 * Core check, independent of stdin/JSON — the seam used by tests via DI.
 *
 * @param {string} filePath - edited file path (absolute or relative)
 * @param {object} [opts]
 * @param {Function} [opts.execFn] - execFileSync-compatible (cmd, args, options) => stdout
 * @param {{isHookEnabled: Function}} [opts.hookFlags]
 * @returns {string[]} lines to print to stderr ([] = nothing to report)
 */
function checkPyFile(filePath, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const hookFlags = opts.hookFlags || loadHookFlags();

  const ext = filePath ? path.extname(filePath).toLowerCase() : '';
  if (!filePath || !PY_EXTS.has(ext)) return [];

  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const dir = path.dirname(path.resolve(filePath));

  const fmt = runTool(execFn, 'ruff', ['format', filePath], dir, TIMEOUT_MS);
  if (fmt.missing) return []; // ruff itself absent — nothing else to run either

  let lines = fmt.timedOut ? [] : filterRelevantLines(fmt.output, filePath, dir);

  const chk = runTool(execFn, 'ruff', ['check', filePath], dir, TIMEOUT_MS);
  if (!chk.missing && !chk.timedOut) {
    lines = lines.concat(filterRelevantLines(chk.output, filePath, dir));
  }

  return lines.slice(0, MAX_LINES);
}

function extractFilePath(raw) {
  try {
    const input = JSON.parse(raw);
    return String((input.tool_input && input.tool_input.file_path) || '');
  } catch {
    return '';
  }
}

function appendCapped(current, chunk, max) {
  if (current.length >= max) return current;
  return current + String(chunk).substring(0, max - current.length);
}

function main(raw) {
  const filePath = extractFilePath(raw);
  const lines = checkPyFile(filePath);
  if (lines.length > 0) {
    process.stderr.write(`[py-guard] findings in ${path.basename(filePath)}:\n`);
    for (const line of lines) process.stderr.write(`${line}\n`);
  }
}

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    data = appendCapped(data, chunk, MAX_STDIN);
  });
  process.stdin.on('end', () => {
    try {
      main(data);
    } catch {
      // never block the tool call over a hook bug
    }
    process.stdout.write(data);
    process.exit(0);
  });
}

module.exports = {
  checkPyFile,
  extractFilePath,
  filterRelevantLines,
  appendCapped,
  main,
  HOOK_ID,
  PROFILES
};
