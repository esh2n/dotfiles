'use strict';

/**
 * Model-tier resolution for yoki-loop (task T19 spec: "Model tiers resolve
 * through core/harness-models.json when present, else pass through").
 *
 * The reader itself is `lib/harness-models.js`, shared with
 * `lib/graph/backends/common.js` and reading the same file
 * `lib/targets/codex.js`/`omp.js` do — this module is the loop-facing name
 * for it, kept so callers (runner.js, its tests) need not know where the
 * shared reader lives.
 *
 * A tier with no entry for the harness passes straight through, on the
 * assumption that it is already a concrete model id.
 */

const { loadHarnessModels, resolveModel, clearCache } = require('../harness-models');

module.exports = { loadHarnessModels, resolveModel, clearCache };
