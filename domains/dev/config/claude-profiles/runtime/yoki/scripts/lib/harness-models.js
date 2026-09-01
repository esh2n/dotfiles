'use strict';

/**
 * One reader for `core/harness-models.json` — the Claude-tier → per-harness
 * model-id map — shared by `lib/graph/backends/common.js` and
 * `lib/loop/models.js`.
 *
 * Both grew their own copy in the same change, and the copies did not agree:
 * graph gated the lookup on a hardcoded `TIERS = {haiku, sonnet, opus}` set
 * and loop did not, so `omp.review`/`omp.scout` — real keys in that file,
 * documented there as this setup's own model roles — resolved under
 * yoki-loop and silently passed through unresolved under yoki-graph, as did
 * any tier spelled `Sonnet`. The map file itself is the list of valid keys;
 * there is no second list to keep in sync with it.
 *
 * Reading goes through `targets/layers.js`'s `readJsonIfExists`, the helper
 * `targets/codex.js` and `targets/omp.js` already use for this same file.
 * Its throw-on-malformed behavior is caught here: a broken map must degrade
 * to "resolve nothing", never crash a run mid-flight.
 */

const path = require('path');
const { readJsonIfExists } = require('./targets/layers');

const RELATIVE_PATH = path.join(
  'domains', 'dev', 'config', 'claude-profiles', 'core', 'harness-models.json'
);

/** Harnesses whose own `--model` already speaks the tier vocabulary, so a
 *  value is passed through without a lookup. `mock` has no models at all. */
const PASSTHROUGH_HARNESSES = new Set(['claude', 'mock']);

const cache = new Map(); // resolved file path -> parsed object | null

/**
 * @param {string} dotfilesRoot repo root
 * @returns {string|null} absolute path to the map file, or null without a root
 */
function harnessModelsPath(dotfilesRoot) {
  return dotfilesRoot ? path.join(dotfilesRoot, RELATIVE_PATH) : null;
}

/**
 * @param {string} dotfilesRoot repo root
 * @returns {object|null} the parsed map, or null when it is missing,
 *   unreadable or malformed — every one of which means "pass through".
 */
function loadHarnessModels(dotfilesRoot) {
  const file = harnessModelsPath(dotfilesRoot);
  if (!file) return null;
  if (cache.has(file)) return cache.get(file);
  let parsed = null;
  try {
    const raw = readJsonIfExists(file);
    parsed = raw && typeof raw === 'object' ? raw : null;
  } catch {
    parsed = null; // malformed file -> pass through, never crash a run
  }
  cache.set(file, parsed);
  return parsed;
}

/** Drop the memoized parse — for tests that rewrite the map file. */
function clearCache() {
  cache.clear();
}

/**
 * @param {'claude'|'codex'|'omp'|'mock'} harness
 * @param {string} model a tier (haiku/sonnet/opus, or a harness-specific
 *   role key like omp's review/scout) or an already-concrete model id
 * @param {object|null} harnessModels result of `loadHarnessModels`
 * @returns {string} the mapped id, or `model` untouched when the harness has
 *   no map, the key is absent, or the harness speaks tiers natively
 */
function resolveModel(harness, model, harnessModels) {
  if (!model) return typeof model === 'string' ? model : '';
  const raw = String(model).trim();
  if (!raw) return '';
  if (PASSTHROUGH_HARNESSES.has(harness)) return raw;
  const map = harnessModels && typeof harnessModels === 'object' ? harnessModels[harness] : null;
  const mapped = map && typeof map === 'object' ? map[raw.toLowerCase()] : undefined;
  return typeof mapped === 'string' && mapped ? mapped : raw;
}

module.exports = { harnessModelsPath, loadHarnessModels, resolveModel, clearCache, RELATIVE_PATH };
