'use strict';

/**
 * Role → agent routing — the omp `modelRoles` equivalent for yoki-graph.
 *
 * A role names WHICH backend and WHICH model tier a lane runs on, one level
 * above the tier→id map in core/harness-models.json:
 *
 *   agent(prompt, { role: 'consult' })   // -> codex backend, opus tier, high effort
 *
 * The table lives in core/harness-roles.json ({backend, model, effort?} per
 * role). This is the single definition; a workflow that says `role: 'main'`
 * follows whatever `main` currently points at (deepseek/flash today), so the
 * frontier consult target can be swapped in ONE place without touching any
 * script. `agent()`'s own explicit `backend`/`model`/`effort` always win over
 * the role's defaults (see api.js) — the role only fills in what the call did
 * not pin.
 *
 * Resolution is intentionally strict: a role name that is not in the table is
 * a FATAL error (like an unknown backend), never a silent fall-through to the
 * run default — a typo'd `role: 'consutl'` routing every hard question to the
 * cheap main model would be an expensive, invisible mistake.
 */

const path = require('path');
const { readJsonIfExists } = require('../targets/layers');

const RELATIVE_PATH = path.join(
  'domains', 'dev', 'config', 'claude-profiles', 'core', 'harness-roles.json',
);

const cache = new Map(); // resolved file path -> parsed object | null

class UnknownRoleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnknownRoleError';
    this.fatal = true;
    this.transient = false;
  }
}

function harnessRolesPath(dotfilesRoot) {
  return dotfilesRoot ? path.join(dotfilesRoot, RELATIVE_PATH) : null;
}

/**
 * @param {string} dotfilesRoot repo root
 * @returns {object|null} parsed role table, or null when missing/unreadable/
 *   malformed (all of which mean "no roles defined" — `resolve` then treats
 *   any role name as unknown).
 */
function loadHarnessRoles(dotfilesRoot) {
  const file = harnessRolesPath(dotfilesRoot);
  if (!file) return null;
  if (cache.has(file)) return cache.get(file);
  let parsed = null;
  try {
    const raw = readJsonIfExists(file);
    parsed = raw && typeof raw === 'object' ? raw : null;
  } catch {
    parsed = null; // malformed file -> no roles, never crash a run
  }
  cache.set(file, parsed);
  return parsed;
}

function clearCache() {
  cache.clear();
}

/** Role keys in the table, excluding documentation keys (leading `_`). */
function roleList(table) {
  if (!table || typeof table !== 'object') return '';
  return Object.keys(table).filter((k) => !k.startsWith('_')).sort().join(', ');
}

/**
 * Resolve a role name to `{backend, model, effort}`.
 * @param {string|undefined|null} roleName
 * @param {object|null} harnessRoles parsed core/harness-roles.json
 * @returns {{backend: string|undefined, model: string|undefined, effort: string|undefined}|null}
 *   null when no role was requested; throws UnknownRoleError when a role was
 *   requested but is absent from the table.
 */
function resolve(roleName, harnessRoles) {
  const raw = typeof roleName === 'string' ? roleName.trim() : '';
  if (!raw) return null;
  const table = harnessRoles && typeof harnessRoles === 'object' ? harnessRoles : null;
  const entry = table && !raw.startsWith('_') ? table[raw] : null;
  if (!entry || typeof entry !== 'object') {
    throw new UnknownRoleError(
      `unknown role "${raw}"${table ? ` — valid roles: ${roleList(table)}` : ' — no core/harness-roles.json found'}. `
      + 'Define it in core/harness-roles.json ({backend, model, effort?}).',
    );
  }
  return {
    backend: typeof entry.backend === 'string' ? entry.backend : undefined,
    model: typeof entry.model === 'string' ? entry.model : undefined,
    effort: typeof entry.effort === 'string' ? entry.effort : undefined,
  };
}

module.exports = {
  resolve,
  loadHarnessRoles,
  harnessRolesPath,
  clearCache,
  roleList,
  UnknownRoleError,
  RELATIVE_PATH,
};
