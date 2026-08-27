#!/usr/bin/env node
/**
 * SessionStart Hook: warn (at most once a week) when a newer Go release is
 * out than what's installed.
 *
 * Cross-platform, node builtins only (https, fs, child_process, path, os).
 * Cache: ~/.claude/.cache/go-version-check.json — a fresh cache (<7 days
 * old) short-circuits the whole check with no network call.
 *
 * Contract: read stdin JSON, pass it through to stdout unchanged, write at
 * most one line to stderr, always exit 0. Never blocks a session — every
 * failure mode (no network, no `go`, malformed cache, malformed dl.go.dev
 * response) is silent and still counts as "checked" so a broken network
 * doesn't turn into a retry storm on every session start.
 */

'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE_PATH = path.join(os.homedir(), '.claude', '.cache', 'go-version-check.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 3000;
const DL_URL = 'https://go.dev/dl/?mode=json';

// ---- pure helpers (exported for tests) ------------------------------------

/** "go1.27.1" -> "1.27.1"; "go1.27" -> "1.27"; anything else -> null. */
function extractGoVersion(raw) {
  const m = /^go(\d+\.\d+(?:\.\d+)?)\s*$/.exec(String(raw || '').trim());
  return m ? m[1] : null;
}

/** [major, minor] from a "X.Y" or "X.Y.Z" string, or null. */
function parseMajorMinor(v) {
  const m = /^(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function isNewerMajorMinor(latest, installed) {
  const l = parseMajorMinor(latest);
  const i = parseMajorMinor(installed);
  if (!l || !i) return false;
  if (l[0] !== i[0]) return l[0] > i[0];
  return l[1] > i[1];
}

/** Parse the go.dev/dl/?mode=json body; return the first stable version, or null. */
function extractLatestStable(body) {
  try {
    const releases = JSON.parse(body);
    if (!Array.isArray(releases)) return null;
    const first = releases.find((r) => r && r.stable === true);
    return first ? extractGoVersion(first.version) : null;
  } catch {
    return null;
  }
}

function isFresh(cache, now, ttlMs) {
  return !!cache && Number.isFinite(cache.checkedAt) && now - cache.checkedAt < ttlMs;
}

function formatWarning(latest, installed) {
  const lm = parseMajorMinor(latest);
  const shortLatest = lm ? `${lm[0]}.${lm[1]}` : latest;
  return `[go-version-check] Go ${shortLatest} is out (installed ${installed}). Run the go-version-scout agent to draft go-modern updates.\n`;
}

// ---- real-world I/O (kept thin so tests can inject fakes) -----------------

function readCacheFile(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCacheFile(cachePath, entry) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entry), 'utf8');
  } catch {
    // best-effort — a cache-write failure must never surface to the user
  }
}

function getInstalledGoVersionReal() {
  try {
    const out = execFileSync('go', ['env', 'GOVERSION'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return extractGoVersion(out);
  } catch {
    return null; // go missing / not on PATH — skip silently
  }
}

function fetchLatestStableReal() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = https.get(DL_URL, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => finish(extractLatestStable(body)));
        res.on('error', () => finish(null));
      });
    } catch {
      finish(null);
      return;
    }

    req.on('error', () => finish(null));
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
  });
}

// ---- orchestration (testable: every I/O dependency is injectable) ---------

/**
 * Run one check cycle. Returns { stderrLine } (stderrLine is '' when there's
 * nothing to say). Never throws — every internal failure is swallowed.
 *
 * opts:
 *   cachePath, ttlMs, now,
 *   readCache, writeCache, getInstalledVersion, fetchLatestStable
 */
async function checkOnce(opts) {
  const {
    cachePath,
    ttlMs,
    now,
    readCache,
    writeCache,
    getInstalledVersion,
    fetchLatestStable,
  } = opts;

  try {
    const cache = readCache(cachePath);
    if (isFresh(cache, now, ttlMs)) {
      return { stderrLine: '' };
    }

    const installed = getInstalledVersion();
    if (!installed) {
      writeCache(cachePath, { checkedAt: now });
      return { stderrLine: '' };
    }

    const latest = await fetchLatestStable();
    writeCache(cachePath, { checkedAt: now, installed, latest });

    if (latest && isNewerMajorMinor(latest, installed)) {
      return { stderrLine: formatWarning(latest, installed) };
    }
    return { stderrLine: '' };
  } catch {
    return { stderrLine: '' };
  }
}

module.exports = {
  extractGoVersion,
  parseMajorMinor,
  isNewerMajorMinor,
  extractLatestStable,
  isFresh,
  formatWarning,
  checkOnce,
};

// ---- CLI entry point --------------------------------------------------

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const stdin = await readStdin();

  try {
    const { stderrLine } = await checkOnce({
      cachePath: CACHE_PATH,
      ttlMs: CACHE_TTL_MS,
      now: Date.now(),
      readCache: readCacheFile,
      writeCache: writeCacheFile,
      getInstalledVersion: getInstalledGoVersionReal,
      fetchLatestStable: fetchLatestStableReal,
    });
    if (stderrLine) {
      process.stderr.write(stderrLine);
    }
  } catch {
    // never block a session over this check
  }

  if (stdin) {
    process.stdout.write(stdin, () => process.exit(0));
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}
