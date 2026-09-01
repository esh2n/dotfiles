'use strict';

/**
 * Shared helpers for the three backends: model-tier resolution through
 * core/harness-models.json, subagent_type/agentType preamble resolution
 * from an agent definition file, and a spawn-and-collect-stdout wrapper —
 * with live line-splitting for progress — used by the two real backends.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const sharedModels = require('../../harness-models');

function findRepoRootFrom(startDir) {
  let dir = startDir;
  for (let i = 0; i < 25; i += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * The dotfiles checkout this file is running from. Unlike the loop layer —
 * whose CLI is handed a `dotfilesRoot` — a graph backend has no caller that
 * knows it, so it is discovered from `__dirname`. `agentDirs()` below needs
 * the same answer, which is why the walk stays here rather than moving into
 * the shared model reader.
 */
function repoRoot() {
  return findRepoRootFrom(__dirname);
}

/** Absolute path to core/harness-models.json in this dotfiles checkout, or
 *  null if this file isn't running from inside that checkout (e.g. some
 *  future standalone install) — callers must treat that as "pass through". */
function harnessModelsPath() {
  return sharedModels.harnessModelsPath(repoRoot());
}

function loadHarnessModels() {
  return sharedModels.loadHarnessModels(repoRoot());
}

/**
 * Resolve `opts.model` through the shared reader in lib/harness-models.js:
 * `codex`/`omp` look the value up in that file's per-backend map, and
 * anything absent passes through untouched.
 *
 * In a real run api.js has ALREADY resolved the tier (see lib/graph/models.js,
 * which additionally rejects a misspelled tier instead of passing it
 * through) and hands the backend a concrete id, so this call is a
 * pass-through there. It stays because each backend's `buildArgv` is also
 * called directly — by its own unit tests and by the argv-shape assertions
 * in test/scripts.test.js — with a bare tier name.
 */
function resolveModel(backendName, model) {
  return sharedModels.resolveModel(backendName, model, loadHarnessModels());
}

const BUILTIN_PREAMBLES = {
  Explore: 'You are in read-only exploration mode: investigate and report findings; do not modify any files.',
  'general-purpose': 'You are a general-purpose agent capable of research, code, and file operations for complex, multi-step tasks.',
  Plan: 'You are in planning mode: produce a plan without making any changes.',
};

function stripFrontmatter(body) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  return match ? body.slice(match[0].length) : body;
}

/**
 * Candidate agent-definition directories, personal-first (this repo's own
 * "personal always wins on name conflicts" layering rule) then core then
 * every enabled pack, plus the fully-layered `~/.claude/agents` output
 * first of all (the harness's own merged view, when this is run from an
 * installed harness rather than a bare checkout).
 */
function agentDirs(env = process.env) {
  // YOKI_AGENT_DIRS (a PATH-style list) replaces the discovered layers
  // outright — the injection seam that makes the file-lookup branch of
  // resolveAgentPreamble testable without depending on which agents happen
  // to be installed on the machine running the tests.
  const override = typeof env.YOKI_AGENT_DIRS === 'string' ? env.YOKI_AGENT_DIRS.trim() : '';
  if (override) return override.split(path.delimiter).filter(Boolean);
  const dirs = [path.join(os.homedir(), '.claude', 'agents')];
  const root = repoRoot();
  if (root) {
    const profiles = path.join(root, 'domains', 'dev', 'config', 'claude-profiles');
    dirs.push(path.join(profiles, 'personal', 'agents'));
    dirs.push(path.join(profiles, 'core', 'agents'));
    const packsDir = path.join(profiles, 'packs');
    try {
      for (const pack of fs.readdirSync(packsDir)) {
        dirs.push(path.join(packsDir, pack, 'agents'));
      }
    } catch {
      // no packs dir — fine, core/personal/global are enough
    }
  }
  return dirs;
}

/**
 * Resolve a preamble string for `opts.agentType`/`opts.subagent_type`:
 * built-in names (Explore/general-purpose/Plan) get a short canned
 * preamble; anything else is looked up as `<dir>/<type>.md` across the
 * layered agent directories (personal wins), with its frontmatter stripped.
 * Returns '' when nothing is found (the caller logs that as a fallback).
 */
function resolveAgentPreamble(agentType, env = process.env) {
  if (!agentType) return '';
  if (BUILTIN_PREAMBLES[agentType]) return BUILTIN_PREAMBLES[agentType];
  for (const dir of agentDirs(env)) {
    const file = path.join(dir, `${agentType}.md`);
    if (fs.existsSync(file)) {
      try {
        return stripFrontmatter(fs.readFileSync(file, 'utf8')).trim();
      } catch {
        // unreadable file — keep looking in other layers
      }
    }
  }
  return '';
}

/**
 * The error a backend raises when its child was killed for running past the
 * per-agent timeout. Marked `transient` so retry.js retries it (a model that
 * wedged once often does not wedge again) and `timedOut` so api.js can
 * journal the distinction between "took too long" and "failed".
 */
function timeoutError(what, timeoutMs) {
  const err = new Error(`${what} timed out after ${timeoutMs}ms and was killed`);
  err.code = 'ETIMEDOUT';
  err.transient = true;
  err.timedOut = true;
  return err;
}

/**
 * Feed complete stdout LINES to `onLine` as they arrive, buffering the
 * partial tail. Both real backends stream newline-delimited JSON events, and
 * a chunk boundary lands mid-line often enough that parsing chunks directly
 * would drop events at random. Returns a `push(chunk)` function.
 */
function makeLineSplitter(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onLine(line);
      nl = buffer.indexOf('\n');
    }
  };
}

/**
 * Spawn `cmd argv` with `input` written to stdin (then stdin closed — see
 * the codex backend's own note on why closing stdin matters) and collect
 * stdout/stderr as strings. Resolves `{ stdout, stderr, code, timedOut }`
 * even on a non-zero exit (callers decide what a failure means); rejects
 * only if the process itself could not be spawned.
 *
 * `timedOut` is the flag that makes a killed child distinguishable from a
 * child that chose to exit non-zero: without it, a SIGKILL at the timeout
 * looked to the caller exactly like an ordinary crash with no stdout, so it
 * was reported as a generic failure and never classified as retryable.
 */
function spawnCollect(cmd, argv, { cwd, input, env, timeoutMs, onData } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, env: env || process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => {
      const text = d.toString('utf8');
      stdout += text;
      // Live progress must never be able to fail the call: a bad counter in
      // a backend would otherwise take down the agent it was reporting on.
      if (onData) { try { onData(text); } catch { /* progress is advisory */ } }
    });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    // stdin gets its own error listener BEFORE anything is written to it. A
    // Writable with zero 'error' listeners turns an EPIPE/ENOENT into an
    // uncaught exception that kills the whole node process — which would
    // break every other concurrently-running agent() call, and would break
    // this function's own contract ("rejects only if the process itself
    // could not be spawned"). The spawn failure is already reported through
    // child.on('error'); the stdin error is that same failure seen from the
    // other end, so it is swallowed here rather than reported twice.
    child.stdin.on('error', () => { /* see child.on('error') above */ });
    if (typeof input === 'string') {
      child.stdin.write(input);
    }
    child.stdin.end(); // MUST close stdin even with no input — codex exec hangs otherwise
  });
}

module.exports = {
  resolveModel,
  resolveAgentPreamble,
  agentDirs,
  stripFrontmatter,
  BUILTIN_PREAMBLES,
  spawnCollect,
  makeLineSplitter,
  timeoutError,
  loadHarnessModels,
  harnessModelsPath,
  findRepoRootFrom,
};
