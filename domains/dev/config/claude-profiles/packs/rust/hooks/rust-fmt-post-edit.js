#!/usr/bin/env node
/**
 * PostToolUse Hook: rustfmt after editing a Rust file.
 *
 * Profile: standard (registered "standard,strict" — does not run at "minimal").
 *
 * Runs `rustfmt <file>` only, scoped to the edited file. Deliberately does
 * NOT run `cargo check` or `cargo clippy` here: both build the crate graph
 * (compile, run build scripts) rather than touch just the edited file, so
 * they belong to a session-level gate (e.g. a Stop hook), not a per-edit
 * one — the same file-vs-project boundary go-guard-post-edit.js draws
 * between `go vet ./` (this package only) and `go test -race` (Stop hook).
 * `rustfmt` alone reformats a single file with no compilation involved, so
 * it is the only tool this hook runs.
 *
 * rustfmt reads the nearest `rustfmt.toml` / `.rustfmt.toml` on its own by
 * walking up from its working directory, so this hook sets `cwd` to the
 * edited file's directory and does no config discovery of its own — same
 * reasoning as ruff in py-lint-post-edit.js.
 *
 * Latency budget: the invocation gets a 1000ms timeout. A timeout, `rustfmt`
 * missing from PATH, or a non-`.rs` file are all silent, exit-0, fail-open —
 * no marker files, no hint lines. Output is filtered to lines that mention
 * the edited file, capped at 10 lines, and printed to stderr with a
 * `[rust-guard]` prefix only when there is something to report.
 *
 * Registration note: this hook does NOT go through run-with-flags.js — see
 * packs/go/hooks/go-guard-post-edit.js and packs/go/rules/golang/hooks.md
 * ("Why these hooks don't go through run-with-flags.js") for why: pack-owned
 * hooks live in packs/<name>/hooks/ and are merged (symlinked) into
 * ~/.claude/hooks/ by yoki-switch's MERGE_DIRS, a location outside
 * runtime/yoki that run-with-flags.js's CLAUDE_PLUGIN_ROOT path-traversal
 * guard can never resolve into. Instead this hook is registered as a direct
 * `node ...` command in packs/rust/settings.layer.json and performs its own
 * profile gating below by requiring the same
 * runtime/yoki/scripts/lib/hook-flags.js the runner itself uses.
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const TIMEOUT_MS = 1000;
const HOOK_ID = 'post:rust-guard:post-edit';
const PROFILES = 'standard,strict';

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
function checkRustFile(filePath, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const hookFlags = opts.hookFlags || loadHookFlags();

  const ext = filePath ? path.extname(filePath).toLowerCase() : '';
  if (!filePath || ext !== '.rs') return [];

  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const dir = path.dirname(path.resolve(filePath));
  const result = runTool(execFn, 'rustfmt', [filePath], dir, TIMEOUT_MS);
  if (result.missing || result.timedOut) return [];

  return filterRelevantLines(result.output, filePath, dir);
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
  const lines = checkRustFile(filePath);
  if (lines.length > 0) {
    process.stderr.write(`[rust-guard] findings in ${path.basename(filePath)}:\n`);
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
  checkRustFile,
  extractFilePath,
  filterRelevantLines,
  appendCapped,
  main,
  HOOK_ID,
  PROFILES
};
