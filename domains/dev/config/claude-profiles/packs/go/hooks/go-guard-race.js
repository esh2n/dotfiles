#!/usr/bin/env node
/**
 * Stop Hook: go test -race for every package touched this session
 *
 * Profile: strict only.
 *
 * go-guard-post-edit.js (PostToolUse) records the package directory of every
 * .go file edited this session to a per-session marker file in
 * os.tmpdir(). On Stop, this hook reads that marker, runs
 * `go test -race -count=1 ./...` in each touched package directory (120s
 * total budget, split across the touched packages), prints at most the
 * first 10 lines of failures to stderr with a `[go-guard -race]` prefix,
 * and always clears the marker afterward so a later session doesn't inherit
 * a stale package list. Exits 0 unconditionally — this hook only reports,
 * it never blocks Stop.
 *
 * Same registration note as go-guard-post-edit.js: this can't go through
 * run-with-flags.js because that runner only loads scripts physically under
 * CLAUDE_PLUGIN_ROOT (runtime/yoki), and packs/go/hooks/ is merged into
 * ~/.claude/hooks/ instead. Profile gating is done here directly via
 * runtime/yoki/scripts/lib/hook-flags.js, the same module run-with-flags.js
 * itself uses.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const HOOK_ID = 'stop:go-guard:race';
const PROFILES = 'strict';
const TOTAL_TIMEOUT_MS = 120000;

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, opts);
}

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

function sanitizeSessionId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function markerPathFor(sessionId) {
  const safe = sanitizeSessionId(sessionId);
  const name = safe ? `yoki-go-guard-touched-${safe}.txt` : 'yoki-go-guard-touched.txt';
  return path.join(os.tmpdir(), name);
}

function readTouchedPackages(markerPath) {
  try {
    if (!fs.existsSync(markerPath)) return [];
    const raw = fs.readFileSync(markerPath, 'utf8');
    const dirs = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    return [...new Set(dirs)];
  } catch {
    return [];
  }
}

function clearMarker(markerPath) {
  try {
    fs.rmSync(markerPath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Runs `go test -race -count=1 ./...` in each package dir, splitting the
 * total time budget evenly across them. Returns at most MAX_LINES failure
 * lines. Returns [] (silent) if `go` itself is missing.
 *
 * @param {string[]} pkgDirs
 * @param {object} [opts]
 * @param {Function} [opts.execFn]
 * @param {number} [opts.totalTimeoutMs]
 */
function runRaceTests(pkgDirs, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const totalTimeoutMs = opts.totalTimeoutMs || TOTAL_TIMEOUT_MS;
  if (pkgDirs.length === 0) return [];

  const perPkgTimeout = Math.max(1000, Math.floor(totalTimeoutMs / pkgDirs.length));
  const lines = [];

  for (const dir of pkgDirs) {
    if (lines.length >= MAX_LINES) break;
    try {
      execFn('go', ['test', '-race', '-count=1', './...'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: perPkgTimeout
      });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // go missing entirely — nothing to report, nothing more to try
        return [];
      }
      const output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
      const failLines = output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      for (const line of failLines) {
        if (lines.length >= MAX_LINES) break;
        lines.push(line);
      }
    }
  }

  return lines.slice(0, MAX_LINES);
}

/**
 * Core check, independent of stdin/JSON — the seam used by tests via DI.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {Function} [opts.execFn]
 * @param {{isHookEnabled: Function}} [opts.hookFlags]
 * @param {string} [opts.markerPath] - override for tests
 * @param {boolean} [opts.keepMarker] - skip clearing (tests)
 * @returns {string[]}
 */
function checkRace(sessionId, opts = {}) {
  const hookFlags = opts.hookFlags || loadHookFlags();
  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const markerPath = opts.markerPath || markerPathFor(sessionId);
  const pkgDirs = readTouchedPackages(markerPath);
  if (pkgDirs.length === 0) {
    return [];
  }

  const lines = runRaceTests(pkgDirs, opts);
  if (!opts.keepMarker) {
    clearMarker(markerPath);
  }
  return lines;
}

function extractSessionId(raw) {
  try {
    return String(JSON.parse(raw).session_id || '');
  } catch {
    return '';
  }
}

function main(raw) {
  const sessionId = extractSessionId(raw);
  const lines = checkRace(sessionId);
  if (lines.length > 0) {
    process.stderr.write('[go-guard -race] failures:\n');
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
      // never block Stop over a hook bug
    }
    process.stdout.write(data);
    process.exit(0);
  });
}

module.exports = {
  checkRace,
  runRaceTests,
  readTouchedPackages,
  markerPathFor,
  clearMarker,
  extractSessionId,
  main,
  HOOK_ID,
  PROFILES
};
