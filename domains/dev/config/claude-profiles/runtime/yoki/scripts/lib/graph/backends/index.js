'use strict';

/**
 * Backend registry — the one place a backend NAME becomes a backend module.
 *
 * It lives here rather than in runner.js because two callers need it and
 * neither may require the other: runner.js (the run-level `--backend`) and
 * api.js (a per-call `agent(prompt, {backend})` override, MP1). api.js
 * requiring runner.js would be a cycle, since runner.js requires api.js.
 *
 * `claude` is deliberately absent. yoki-graph exists to run these scripts
 * from harnesses that have no Workflow tool; inside Claude Code the native
 * Workflow tool is the supported path, and shelling out to `claude -p` is a
 * second, unsupported one — which may move to metered billing. The refusal
 * names the alternative rather than reporting an unknown-backend error, so
 * a stale `--backend claude` invocation is told what to do instead.
 */

const CLAUDE_BACKEND_REFUSAL = 'the claude backend was removed — inside Claude Code use the native Workflow tool; yoki-graph backends are codex, omp, mock';

const BACKEND_NAMES = ['codex', 'omp', 'mock'];

/**
 * A backend name that cannot be resolved is a SCRIPT bug, not a lane
 * failure: `agent()`'s contract turns a backend failure into `null`, and a
 * typo'd `agent(p, {backend: 'codexx'})` silently returning null in every
 * lane would look exactly like "the provider found nothing". Marked
 * `fatal` so parallel()/pipeline() re-raise it the way they re-raise a
 * budget breach, instead of swallowing it.
 */
class UnknownBackendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnknownBackendError';
    this.fatal = true;
    this.transient = false;
  }
}

function loadBackend(name) {
  switch (name) {
    case 'claude': throw new UnknownBackendError(CLAUDE_BACKEND_REFUSAL);
    case 'codex': return require('./codex');
    case 'omp': return require('./omp');
    case 'mock': return require('./mock');
    default: throw new UnknownBackendError(`unknown backend "${name}" (expected ${BACKEND_NAMES.join('|')})`);
  }
}

module.exports = { loadBackend, CLAUDE_BACKEND_REFUSAL, BACKEND_NAMES, UnknownBackendError };
