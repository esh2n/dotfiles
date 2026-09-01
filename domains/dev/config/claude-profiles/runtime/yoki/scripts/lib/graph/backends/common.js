'use strict';

/**
 * Shared helpers for the four backends: model-tier resolution through
 * core/harness-models.json, subagent_type/agentType preamble resolution
 * from an agent definition file, and a small spawn-and-collect-stdout
 * wrapper used by the three real backends.
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
 * Resolve `opts.model` for a given backend, through the shared reader in
 * lib/harness-models.js. `claude` speaks the tier vocabulary natively
 * (haiku/sonnet/opus are valid `--model` aliases), so it is returned
 * unchanged; `codex`/`omp` look the value up in that file's per-backend map,
 * and anything absent from the map passes through untouched (already a
 * concrete model id, or the caller's problem to resolve).
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
 * Spawn `cmd argv` with `input` written to stdin (then stdin closed — see
 * the codex backend's own note on why closing stdin matters) and collect
 * stdout/stderr as strings. Resolves `{ stdout, stderr, code }` even on a
 * non-zero exit (callers decide what a failure means); rejects only if the
 * process itself could not be spawned.
 */
function spawnCollect(cmd, argv, { cwd, input, env, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, env: env || process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
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
  loadHarnessModels,
  harnessModelsPath,
  findRepoRootFrom,
};
