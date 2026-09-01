'use strict';

/**
 * `.yoki.json` lookup for yoki-loop (task T19), and the `loopDailyCap`
 * precedence it feeds.
 *
 * Same upward-search shape as `hook-flags.js`'s `getProjectConfig()`, but
 * parameterized on an explicit `cwd` instead of `process.cwd()` — `yoki-loop
 * run` always takes an explicit `--cwd <dir>` (the target repo, not
 * wherever launchd happened to start the process), so the lookup must start
 * there instead of the runner's own working directory.
 */

const fs = require('fs');
const path = require('path');

const MAX_UPWARD_HOPS = 20;
const DEFAULT_DAILY_CAP = 24;

/**
 * @param {string} cwd directory to start the upward search from
 * @returns {object} the parsed `.yoki.json`, or `{}` when none is found or
 *   it fails to parse (a broken project file must never crash the loop).
 */
function findYokiConfig(cwd) {
  let dir = path.resolve(cwd || '.');
  for (let i = 0; i < MAX_UPWARD_HOPS; i++) {
    const candidate = path.join(dir, '.yoki.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

/**
 * Resolves the daily run cap for a loop, in the same "project config wins"
 * gradient `workflow-guard.sh` uses for `workflowDailyCap`:
 *   .yoki.json `loopDailyCap` > `--max-runs` CLI flag > DEFAULT_DAILY_CAP (24)
 *
 * A project's own file always wins because a runaway loop cannot edit it;
 * `--max-runs` is the session-local override (an install's own CLI flags),
 * one rung below.
 *
 * @param {string} cwd
 * @param {number|undefined} maxRunsFlag parsed `--max-runs` value, if given
 * @returns {number} a positive integer cap
 */
function resolveDailyCap(cwd, maxRunsFlag) {
  const config = findYokiConfig(cwd);
  const fromConfig = Number(config.loopDailyCap);
  if (Number.isInteger(fromConfig) && fromConfig > 0) return fromConfig;

  const fromFlag = Number(maxRunsFlag);
  if (Number.isInteger(fromFlag) && fromFlag > 0) return fromFlag;

  return DEFAULT_DAILY_CAP;
}

module.exports = { findYokiConfig, resolveDailyCap, DEFAULT_DAILY_CAP };
