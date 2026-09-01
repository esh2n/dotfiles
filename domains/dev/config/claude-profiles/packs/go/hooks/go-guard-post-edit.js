#!/usr/bin/env node
/**
 * PostToolUse Hook: go vet + staticcheck after editing a .go file
 *
 * Profile: standard (registered "standard,strict" — does not run at "minimal").
 *
 * Runs `go vet ./` (and `staticcheck ./` when it's on PATH) scoped to the
 * package directory of the edited file only — never the whole module — so
 * an edit stays cheap regardless of module size. Output is filtered to lines
 * that mention the edited file (same technique as post-edit-typecheck.js),
 * capped at 10 lines, and printed to stderr with a `[go-guard]` prefix only
 * when there is something to report (0 findings = 0 token stderr).
 *
 * If `go` is missing from PATH, this prints one warning line at most (marker
 * file in os.tmpdir()) and exits 0 — it never blocks the edit.
 *
 * Registration note: this hook does NOT go through run-with-flags.js. That
 * runner resolves scripts relative to CLAUDE_PLUGIN_ROOT (always
 * runtime/yoki on this machine — baked into settings.json's global `env`),
 * and rejects anything outside that directory as a path-traversal attempt.
 * Pack-owned hooks like this one live in packs/go/hooks/ and are merged
 * (symlinked) into ~/.claude/hooks/ by yoki-switch's MERGE_DIRS, which is
 * outside runtime/yoki — so run-with-flags.js can never load it directly
 * (verified empirically; see packs/go/rules/golang/hooks.md). Instead this
 * hook is registered as a direct `node ...` command in
 * packs/go/settings.layer.json and performs its own profile gating below by
 * calling the same runtime/yoki/scripts/lib/hook-flags.js the runner itself
 * uses, so profile-gating semantics stay identical.
 *
 * Also appends the touched package directory to a per-session marker file
 * that the Stop hook (go-guard-race.js) reads to decide which packages need
 * `go test -race`.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const HOOK_ID = 'post:go-guard:post-edit';
const PROFILES = 'standard,strict';
const NO_GO_MARKER = path.join(os.tmpdir(), 'yoki-go-guard-no-go-warned');

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, opts);
}

// Loads the shared profile-gating module from the runtime/yoki checkout this
// machine has configured (YOKI_ROOT / CLAUDE_PLUGIN_ROOT are always set by
// settings.json's global `env` block). Fails open (hook enabled) if it can't
// be found, so a misconfigured machine never silently loses go vet coverage.
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

function warnNoGoOnce(marker = NO_GO_MARKER) {
  try {
    if (fs.existsSync(marker)) return;
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    // best-effort marker; still show the warning once for this invocation
  }
  process.stderr.write('[go-guard] `go` not found on PATH; skipping go vet / staticcheck\n');
}

function runTool(execFn, cmd, args, cwd, timeoutMs) {
  try {
    const out = execFn(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
    return { output: String(out || ''), missing: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { output: '', missing: true };
    }
    const output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
    return { output, missing: false };
  }
}

function filterRelevantLines(output, filePath, pkgDir) {
  if (!output) return [];
  const abs = path.resolve(filePath);
  const rel = path.relative(pkgDir, abs);
  const base = path.basename(filePath);
  const candidates = [abs, rel, base, filePath].filter(Boolean);

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => candidates.some(c => line.includes(c)))
    .slice(0, MAX_LINES);
}

function appendTouchedPackage(pkgDir, markerPath) {
  if (!markerPath) return;
  try {
    fs.appendFileSync(markerPath, `${pkgDir}\n`);
  } catch {
    // best-effort signal for the Stop hook; never block the edit over it
  }
}

/**
 * Core check, independent of stdin/JSON — the seam used by tests via DI.
 *
 * @param {string} filePath - edited file path (absolute or relative)
 * @param {object} [opts]
 * @param {Function} [opts.execFn] - execFileSync-compatible (cmd, args, options) => stdout
 * @param {{isHookEnabled: Function}} [opts.hookFlags]
 * @param {Function} [opts.warnOnce]
 * @param {string} [opts.markerPath] - where to record the touched package dir
 * @returns {string[]} lines to print to stderr ([] = nothing to report)
 */
function checkGoFile(filePath, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const hookFlags = opts.hookFlags || loadHookFlags();
  const warnOnce = opts.warnOnce || warnNoGoOnce;

  if (!filePath || !/\.go$/.test(filePath)) {
    return [];
  }

  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const abs = path.resolve(filePath);
  const pkgDir = path.dirname(abs);

  // go vet is the gate: if `go` itself is missing there is nothing to run.
  const vet = runTool(execFn, 'go', ['vet', './'], pkgDir, 15000);
  if (vet.missing) {
    warnOnce();
    return [];
  }

  appendTouchedPackage(pkgDir, opts.markerPath);

  let combined = vet.output;

  // staticcheck is optional — ENOENT means "not installed", not a finding.
  const sc = runTool(execFn, 'staticcheck', ['./'], pkgDir, 20000);
  if (!sc.missing && sc.output) {
    combined += (combined ? '\n' : '') + sc.output;
  }

  return filterRelevantLines(combined, filePath, pkgDir);
}

function extractFilePath(raw) {
  try {
    const input = JSON.parse(raw);
    return String((input.tool_input && input.tool_input.file_path) || '');
  } catch {
    return '';
  }
}

function markerPathForSession(raw) {
  let sessionId = '';
  try {
    sessionId = String(JSON.parse(raw).session_id || '');
  } catch {
    // no session id available — fall back to a shared marker below
  }
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const name = safe ? `yoki-go-guard-touched-${safe}.txt` : 'yoki-go-guard-touched.txt';
  return path.join(os.tmpdir(), name);
}

function main(raw) {
  const filePath = extractFilePath(raw);
  const lines = checkGoFile(filePath, { markerPath: markerPathForSession(raw) });
  if (lines.length > 0) {
    process.stderr.write(`[go-guard] go vet/staticcheck findings in ${path.basename(filePath)}:\n`);
    for (const line of lines) process.stderr.write(`${line}\n`);
  }
}

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      data += chunk.substring(0, MAX_STDIN - data.length);
    }
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
  checkGoFile,
  extractFilePath,
  markerPathForSession,
  filterRelevantLines,
  main,
  HOOK_ID,
  PROFILES
};
