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
 * Claude has no entry in that file — its own `--model` already accepts the
 * tier names (haiku/sonnet/opus) or a full model id, so a `claude` harness
 * always passes the given value straight through.
 */

const { loadHarnessModels, resolveModel, clearCache } = require('../harness-models');

module.exports = { loadHarnessModels, resolveModel, clearCache };
