'use strict';

/**
 * Model-tier resolution for yoki-loop, sharing `core/harness-models.json`
 * with `lib/targets/codex-agents.js` / `lib/targets/omp-agents.js` (task T19
 * spec: "Model tiers resolve through core/harness-models.json when present,
 * else pass through").
 *
 * Claude has no entry in that file — its own `--model` already accepts the
 * tier names (haiku/sonnet/opus) or a full model id, so a `claude` harness
 * always passes the given value straight through.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} dotfilesRoot repo root (see `resolveDotfilesRoot` in
 *   `domains/dev/bin/yoki-loop`)
 * @returns {object|null} the parsed file, or null when missing/unreadable —
 *   a missing file is "pass through everything", not an error.
 */
function loadHarnessModels(dotfilesRoot) {
  const filePath = path.join(
    dotfilesRoot,
    'domains',
    'dev',
    'config',
    'claude-profiles',
    'core',
    'harness-models.json'
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {'claude'|'codex'|'omp'} harness
 * @param {string} tier a Claude-style tier (haiku/sonnet/opus/review/scout)
 *   or already a concrete model id
 * @param {object|null} harnessModels result of `loadHarnessModels`
 * @returns {string} the resolved model id — the tier itself, unchanged,
 *   when the harness has no map or the tier is not a key in it
 */
function resolveModel(harness, tier, harnessModels) {
  const raw = typeof tier === 'string' ? tier.trim() : '';
  if (!raw) return raw;
  if (harness === 'claude') return raw;

  const map = harnessModels && typeof harnessModels === 'object' ? harnessModels[harness] : null;
  const mapped = map && typeof map === 'object' ? map[raw.toLowerCase()] : undefined;
  return typeof mapped === 'string' && mapped ? mapped : raw;
}

module.exports = { loadHarnessModels, resolveModel };
