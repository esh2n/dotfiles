'use strict';

/**
 * Cost guardrail for CLI-launched graph runs — the exact counter file and
 * cap semantics of
 * personal/hooks/workflow-guard.sh (the PreToolUse guard for the Workflow
 * tool inside Claude Code), so a Claude Code launch and a `yoki-graph run`
 * launch on the same day count against the SAME daily total.
 *
 * Deliberately NOT reproduced here: workflow-guard.sh's "first launch of a
 * given workflow per session is denied once" turn — that exists because a
 * Claude Code session can look at the denial reason and retry in the same
 * turn. A CLI process has no such retry-after-reading-the-reason loop, so
 * enforcing it here would just make every single run fail once with no
 * recourse. The daily cap (the actual runaway-loop backstop) is reproduced
 * exactly, including the file path, so it is shared.
 *
 * Cap resolution order (same as the hook): .yoki.json "workflowDailyCap"
 * (searched from `cwd` upward) -> YOKI_WORKFLOW_DAILY_CAP -> 5.
 * Escape hatch: WORKFLOW_GUARD_DISABLED=1 (same env var the hook honors).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CAP = 5;

function stateDir() {
  // YOKI_GRAPH_GUARD_STATE_DIR exists ONLY so tests never touch the real
  // shared counter file (the whole point of this module is sharing state
  // with workflow-guard.sh's real launches — a test must not perturb that).
  // Production code paths never set this env var.
  return process.env.YOKI_GRAPH_GUARD_STATE_DIR || path.join(os.homedir(), '.claude', '.cache', 'workflow-guard');
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function findYokiConfig(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, '.yoki.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        return null; // malformed .yoki.json: same fail-open posture as the hook
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveCap(cwd) {
  const cfg = findYokiConfig(cwd || process.cwd());
  if (cfg && cfg.disabledHooks && Array.isArray(cfg.disabledHooks) && cfg.disabledHooks.includes('workflow-guard')) {
    return { disabled: true, cap: Infinity };
  }
  if (cfg && typeof cfg.workflowDailyCap !== 'undefined') {
    const n = Number(cfg.workflowDailyCap);
    if (Number.isFinite(n) && n >= 0) return { disabled: false, cap: n };
  }
  const envCap = Number(process.env.YOKI_WORKFLOW_DAILY_CAP);
  if (Number.isFinite(envCap) && envCap >= 0) return { disabled: false, cap: envCap };
  return { disabled: false, cap: DEFAULT_CAP };
}

function countFile(day) {
  return path.join(stateDir(), `count-${day || today()}`);
}

function readCount(day) {
  const file = countFile(day);
  if (!fs.existsSync(file)) return 0;
  const raw = fs.readFileSync(file, 'utf8').replace(/[^0-9]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** The exact denial text workflow-guard.sh prints at the cap, so scripts and
 *  operators grepping for it see one consistent message across both entry
 *  points. */
function capMessage(count, cap) {
  return `Workflow daily cap reached (${count}/${cap}). Workflows are expensive (recent runs: 0.6-1.5M tokens each). If more runs today are intentional, ask the user to raise the cap: set workflowDailyCap to N in the project's .yoki.json (takes effect immediately), or YOKI_WORKFLOW_DAILY_CAP at session start.`;
}

/**
 * Check the daily cap and, if under it, record this launch. Returns
 * `{ allowed: true, count, cap }` or `{ allowed: false, count, cap, message }`.
 * Never throws — a broken state dir fails OPEN (allowed: true), matching the
 * hook's "fails open on any internal error" contract.
 */
function checkAndRecord(cwd) {
  if (process.env.WORKFLOW_GUARD_DISABLED === '1') {
    return { allowed: true, disabled: true, count: 0, cap: Infinity };
  }
  try {
    const { disabled, cap } = resolveCap(cwd);
    if (disabled) return { allowed: true, disabled: true, count: 0, cap: Infinity };
    const day = today();
    const count = readCount(day);
    if (count >= cap) {
      return { allowed: false, count, cap, message: capMessage(count, cap) };
    }
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(countFile(day), String(count + 1));
    return { allowed: true, count: count + 1, cap };
  } catch {
    return { allowed: true, count: 0, cap: DEFAULT_CAP, failedOpen: true };
  }
}

module.exports = {
  checkAndRecord, resolveCap, readCount, countFile, capMessage, stateDir, today,
  // Shared with budget.js so the per-run execution caps read the SAME
  // `.yoki.json` (same upward search, same malformed-file posture) the daily
  // cap does, rather than growing a second config reader beside it.
  findYokiConfig,
};
