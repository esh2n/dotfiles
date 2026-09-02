#!/usr/bin/env node
/**
 * PostToolUse Hook: format/lint after editing a TS/JS file.
 *
 * Profile: standard (registered "standard,strict" — does not run at "minimal").
 *
 * Scope is the edited file only — never the whole project. Tool selection
 * follows the project's own configuration, most specific first (owner
 * ruling, task T10):
 *
 *   1. `biome.json` / `biome.jsonc` / `.biomerc` found  -> `biome check --write <file>`
 *   2. else an eslint and/or prettier config found      -> that project's own
 *      tool(s): `prettier --write <file>` then `eslint --fix <file>`
 *   3. else (no config at all) but a `biome` binary resolves -> `biome check
 *      --write <file>` anyway (biome ships sane defaults with no config)
 *   4. else if an `oxlint` binary resolves               -> `oxlint <file>`
 *      (lint only — oxlint has no safe default write mode here)
 *   5. else                                               -> nothing to run
 *
 * Latency budget: every tool invocation gets a 1000ms timeout. A timeout, a
 * missing binary, or a non-matching file are all silent, exit-0, fail-open —
 * no marker files, no hint lines (deliberately simpler than go-guard's /
 * web-guard's one-time hints: this hook only ever prints when a tool
 * actually ran and produced output that mentions the edited file).
 *
 * Threat model — why this hook may execute project-local tools while the
 * review workflow's lanes must not: it fires on a file the agent just
 * edited in the user's OWN working tree — a project the user chose to open
 * and whose toolchain they already run — whereas a review lane runs against
 * a branch diff the user did NOT write, where a package.json script or a
 * config-file import is attacker-controlled input. Same commands, different
 * provenance. Two consequences worth stating: (1) codex/omp targets
 * warn-skip this hook at translation time (its registration is not a
 * run-with-flags.js/run-bash-hook.js form — lib/targets/codex-hooks-merge.js
 * / omp-hooks.js), so there is no post-edit lint parity there; (2) unlike
 * the web pack's "project config or nothing" rule
 * (web-css-lint-post-edit.js), tiers 3-4 deliberately fall back to
 * biome/oxlint with no project config — owner-adjudicated divergence: a
 * formatter's defaults are safe to apply on the user's own edit where a
 * linter's imposed rule set is not.
 *
 * Registration note: this hook does NOT go through run-with-flags.js — see
 * packs/go/hooks/go-guard-post-edit.js and packs/go/rules/golang/hooks.md
 * ("Why these hooks don't go through run-with-flags.js") for why: pack-owned
 * hooks live in packs/<name>/hooks/ and are merged (symlinked) into
 * ~/.claude/hooks/ by yoki-switch's MERGE_DIRS, a location outside
 * runtime/yoki that run-with-flags.js's CLAUDE_PLUGIN_ROOT path-traversal
 * guard can never resolve into. Instead this hook is registered as a direct
 * `node ...` command in packs/typescript/settings.layer.json and performs
 * its own profile gating below by requiring the same
 * runtime/yoki/scripts/lib/hook-flags.js the runner itself uses.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const TIMEOUT_MS = 1000;
const HOOK_ID = 'post:ts-guard:post-edit';
const PROFILES = 'standard,strict';
const MAX_WALK = 50;

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

const BIOME_CONFIG_FILES = ['biome.json', 'biome.jsonc', '.biomerc'];
const ESLINT_CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts'
];
const PRETTIER_CONFIG_FILES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs'
];

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
 * Walk up from `startDir` looking for one of `configFiles`, or (if
 * `pkgKey` is set) a `package.json` carrying that top-level key. Returns
 * the directory containing the first match, or null.
 */
function findConfigDir(startDir, configFiles, pkgKey) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK; i++) {
    for (const cfg of configFiles) {
      if (fs.existsSync(path.join(dir, cfg))) return dir;
    }
    if (pkgKey) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg && Object.prototype.hasOwnProperty.call(pkg, pkgKey)) {
            return dir;
          }
        } catch {
          // malformed package.json — keep walking, it's not a config hit
        }
      }
    }
    // Stop at the repo boundary (checking the boundary dir itself first): a
    // walk that escaped the nearest .git could adopt an unrelated outer
    // checkout's config.
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Walk up from `startDir` looking for `node_modules/.bin/<binName>`, so a
 * hoisted-workspace layout still resolves. Returns the resolved path, or
 * null if nothing local is found (caller falls back to the bare name on
 * PATH).
 */
function resolveLocalBin(startDir, binName) {
  const exe = process.platform === 'win32' ? `${binName}.cmd` : binName;
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK; i++) {
    const candidate = path.join(dir, 'node_modules', '.bin', exe);
    if (fs.existsSync(candidate)) return candidate;
    // Same repo-boundary stop as findConfigDir: never resolve a binary out
    // of a different checkout above this one.
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
function checkTsFile(filePath, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const hookFlags = opts.hookFlags || loadHookFlags();

  const ext = filePath ? path.extname(filePath).toLowerCase() : '';
  if (!filePath || !JS_TS_EXTS.has(ext)) return [];

  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const dir = path.dirname(path.resolve(filePath));

  // Tier 1: biome config present -> that's the project's chosen tool. If
  // its binary is missing, fail open — no fallback to a tool the project
  // didn't ask for.
  const biomeDir = findConfigDir(dir, BIOME_CONFIG_FILES, null);
  if (biomeDir) {
    const cmd = resolveLocalBin(biomeDir, 'biome') || 'biome';
    const result = runTool(execFn, cmd, ['check', '--write', filePath], biomeDir, TIMEOUT_MS);
    if (result.missing || result.timedOut) return [];
    return filterRelevantLines(result.output, filePath, biomeDir);
  }

  // Tier 2: eslint and/or prettier config present -> run the project's own
  // tool(s) for whichever it configured. Format first, then lint-fix.
  const prettierDir = findConfigDir(dir, PRETTIER_CONFIG_FILES, 'prettier');
  const eslintDir = findConfigDir(dir, ESLINT_CONFIG_FILES, 'eslintConfig');
  if (prettierDir || eslintDir) {
    let lines = [];
    if (prettierDir) {
      const cmd = resolveLocalBin(prettierDir, 'prettier') || 'prettier';
      const result = runTool(execFn, cmd, ['--write', filePath], prettierDir, TIMEOUT_MS);
      if (!result.missing && !result.timedOut) {
        lines = lines.concat(filterRelevantLines(result.output, filePath, prettierDir));
      }
    }
    if (eslintDir) {
      const cmd = resolveLocalBin(eslintDir, 'eslint') || 'eslint';
      const result = runTool(execFn, cmd, ['--fix', filePath], eslintDir, TIMEOUT_MS);
      if (!result.missing && !result.timedOut) {
        lines = lines.concat(filterRelevantLines(result.output, filePath, eslintDir));
      }
    }
    return lines.slice(0, MAX_LINES);
  }

  // Tier 3: no project config at all -> biome only if its binary resolves
  // (biome ships usable defaults; this never imposes a config file).
  const biomeCmd = resolveLocalBin(dir, 'biome') || 'biome';
  const biomeResult = runTool(execFn, biomeCmd, ['check', '--write', filePath], dir, TIMEOUT_MS);
  if (!biomeResult.missing && !biomeResult.timedOut) {
    return filterRelevantLines(biomeResult.output, filePath, dir);
  }

  // Tier 4: last resort, lint-only (no safe default write behavior to lean on).
  const oxlintCmd = resolveLocalBin(dir, 'oxlint') || 'oxlint';
  const oxlintResult = runTool(execFn, oxlintCmd, [filePath], dir, TIMEOUT_MS);
  if (!oxlintResult.missing && !oxlintResult.timedOut) {
    return filterRelevantLines(oxlintResult.output, filePath, dir);
  }

  return [];
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
  const lines = checkTsFile(filePath);
  if (lines.length > 0) {
    process.stderr.write(`[ts-guard] findings in ${path.basename(filePath)}:\n`);
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
  checkTsFile,
  extractFilePath,
  filterRelevantLines,
  findConfigDir,
  resolveLocalBin,
  appendCapped,
  main,
  HOOK_ID,
  PROFILES
};
