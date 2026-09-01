'use strict';

/**
 * Model resolution for one run, with the answer made visible.
 *
 * Two things the shared reader (`lib/harness-models.js`) deliberately does
 * not do, because yoki-loop depends on it not doing them:
 *
 * 1. **A misspelled tier is an error, not a pass-through.** The shared
 *    reader hands any unmapped value back untouched, on the assumption that
 *    it is already a concrete model id. That is right for an id and wrong
 *    for `--model sonnett`, which then reaches `codex -m sonnett` and fails
 *    somewhere far from the typo. Here a value that is SHAPED like a tier —
 *    bare lowercase letters, no digit, no `/`, no `-` — must exist in the
 *    backend's map; anything else (`gpt-5.5`, `anthropic/claude-sonnet-5`)
 *    is taken as a concrete id and passed through. A backend with no map at
 *    all (mock) passes everything through: there is nothing to validate
 *    against.
 * 2. **`--model-map` overrides for one run.** `haiku=gpt-5.4-mini,sonnet=x`
 *    layers on top of the file's map so a single run can pin different ids
 *    without editing core/harness-models.json.
 *
 * `resolve` returns the id AND how it was reached, so the CLI, the events
 * and the journal can all show the resolved id rather than the tier name the
 * script happened to type.
 */

const sharedModels = require('../harness-models');

/** Keys in harness-models.json that are documentation, not tiers. */
function isTierKey(key) {
  return typeof key === 'string' && key.length > 0 && !key.startsWith('_');
}

/**
 * Is this value being used as a TIER NAME rather than as a model id? Tier
 * names in this repo are bare lowercase words (`haiku`, `sonnet`, `opus`,
 * omp's `review`/`scout`); every real model id carries a digit, a dash or a
 * provider prefix. Getting this wrong in the safe direction just means an
 * unknown id passes through to the backend, which reports it.
 */
function looksLikeTier(value) {
  return /^[a-z][a-z_]*$/.test(value);
}

/** `haiku=gpt-5.4-mini,sonnet=gpt-5.5` -> `{haiku: 'gpt-5.4-mini', ...}`. */
function parseModelMap(spec) {
  if (!spec || typeof spec !== 'string') return {};
  const out = {};
  for (const pair of spec.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0 || eq === trimmed.length - 1) {
      throw new Error(`--model-map: "${trimmed}" is not <tier>=<model-id> (example: --model-map haiku=gpt-5.4-mini,sonnet=gpt-5.5)`);
    }
    out[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * The tier -> id map in force for `backendName` this run: the file's map for
 * that backend, with `--model-map` entries layered on top. `null` when the
 * backend has no map at all (mock, or a checkout with no
 * core/harness-models.json).
 */
function mapFor(backendName, overrides = {}, harnessModels) {
  const fileMap = harnessModels && typeof harnessModels === 'object' ? harnessModels[backendName] : null;
  const hasOverrides = Object.keys(overrides).length > 0;
  if (!fileMap && !hasOverrides) return null;
  const merged = {};
  for (const [key, value] of Object.entries(fileMap || {})) {
    if (isTierKey(key) && typeof value === 'string') merged[key] = value;
  }
  Object.assign(merged, overrides);
  return merged;
}

function tierList(map) {
  return Object.keys(map || {}).sort().join(', ');
}

/**
 * @param {string} backendName
 * @param {string|undefined} model tier name or concrete id
 * @param {object} [options]
 * @param {object} [options.overrides] parsed `--model-map`
 * @param {object|null} [options.harnessModels] parsed core/harness-models.json
 * @returns {{id: string, tier: string|null, source: 'tier'|'model-map'|'literal'|'default'}}
 * @throws when `model` is shaped like a tier and the backend's map has no
 *   such key — the message lists the tiers that ARE valid.
 */
function resolve(backendName, model, options = {}) {
  const raw = typeof model === 'string' ? model.trim() : '';
  if (!raw) return { id: '', tier: null, source: 'default' };

  const overrides = options.overrides || {};
  const map = mapFor(backendName, overrides, options.harnessModels);
  const key = raw.toLowerCase();

  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    return {
      id: map[key],
      tier: key,
      source: Object.prototype.hasOwnProperty.call(overrides, key) ? 'model-map' : 'tier',
    };
  }
  if (map && looksLikeTier(key)) {
    throw new Error(
      `unknown model tier "${raw}" for backend ${backendName} — valid tiers: ${tierList(map)}. `
      + 'Pass a concrete model id instead, or add the tier with --model-map <tier>=<id>.'
    );
  }
  // Not tier-shaped (or the backend has no map): a concrete id, as given.
  return { id: raw, tier: null, source: 'literal' };
}

function loadHarnessModels(repoRoot) {
  return sharedModels.loadHarnessModels(repoRoot);
}

module.exports = { resolve, parseModelMap, mapFor, looksLikeTier, tierList, loadHarnessModels, isTierKey };
