'use strict';

/**
 * Reader + merger for the `ecc.mcp.v1` canonical MCP source-of-truth layers
 * (core/mcp.json, packs/<name>/mcp.json, personal/mcp.json) — task T13's
 * equivalent of `lib/permissions/parse.js` for permissions.yaml. A missing
 * file is treated as an empty layer (a pack need not ship mcp.json).
 *
 * Schema per server entry: `{name, transport: "stdio"|"http", command?,
 * args?, url?, env, targets: {claude, codex, omp}, targetOverrides?}`. See
 * core/mcp.json's own top-level `_comment` for what `targets.<harness>`
 * means (it drives whether a *writer* emits the server, not merely whether
 * it happens to run under that harness elsewhere).
 *
 * TWO SPELLINGS, ONE HARNESS — reconciled here and nowhere else:
 * core/mcp.json spells the Claude Code flag `targets.claude` (the
 * user-facing key, which stays as it is), while inside this subsystem the
 * harness id is `claude-code` — what readers/claude-code.js stamps into
 * `source.harness` and what collect.js's DEFAULT_READERS keys on. The
 * TARGET_KEY_TO_HARNESS_ID / HARNESS_ID_TO_TARGET_KEY tables below are the
 * ONLY place the two spellings meet; readers, writers and any other consumer
 * must go through them (or through `isTargetedAt` / `applyTargetOverride`)
 * instead of hardcoding either literal.
 *
 * `env` values must be `${ENV_VAR}` references, never literal secrets —
 * `loadLayer` throws on a literal that either looks like a real secret value
 * (canonical-mcp.js's `looksLikeSecretValue`, e.g. an `sk-...` key) or sits
 * under a secret-shaped key name (`SECRET_KEY_PATTERN`, e.g. `*_API_KEY`)
 * without being a `${VAR}` reference.
 */

const fs = require('fs');
const { MCP_SCHEMA_VERSION, SECRET_KEY_PATTERN, looksLikeSecretValue } = require('./canonical-mcp');

const ENV_REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * The user-facing `targets.<key>` / `targetOverrides.<key>` spelling used in
 * the mcp.json layers → the harness id used inside this subsystem (readers'
 * `source.harness`, collect.js's DEFAULT_READERS keys, each writer's
 * `HARNESS_ID`). Claude Code is the one place the two differ: `claude` in the
 * data, `claude-code` as the id. Keep this table the single point of
 * reconciliation — see the file header.
 */
const TARGET_KEY_TO_HARNESS_ID = Object.freeze({
  claude: 'claude-code',
  codex: 'codex',
  omp: 'omp',
});

/** The inverse of TARGET_KEY_TO_HARNESS_ID (harness id → mcp.json key). */
const HARNESS_ID_TO_TARGET_KEY = Object.freeze(Object.fromEntries(
  Object.entries(TARGET_KEY_TO_HARNESS_ID).map(([targetKey, harnessId]) => [harnessId, targetKey])
));

const TARGET_KEYS = Object.freeze(Object.keys(TARGET_KEY_TO_HARNESS_ID));
const HARNESS_IDS = Object.freeze(Object.keys(HARNESS_ID_TO_TARGET_KEY));

/**
 * @param {string} targetKey an mcp.json `targets.<key>` spelling
 * @returns {string} the internal harness id
 * @throws on an unknown key — a typo must be loud, never a silent "not emitted"
 */
function harnessIdForTargetKey(targetKey) {
  if (typeof targetKey === 'string' && Object.hasOwn(TARGET_KEY_TO_HARNESS_ID, targetKey)) {
    return TARGET_KEY_TO_HARNESS_ID[targetKey];
  }
  throw new Error(
    `unknown mcp.json target key "${targetKey}" — known keys: ${TARGET_KEYS.join(', ')}`
  );
}

/**
 * @param {string} harnessId an internal harness id (e.g. "claude-code")
 * @returns {string} the mcp.json `targets.<key>` spelling
 * @throws on an unknown id
 */
function targetKeyForHarnessId(harnessId) {
  if (typeof harnessId === 'string' && Object.hasOwn(HARNESS_ID_TO_TARGET_KEY, harnessId)) {
    return HARNESS_ID_TO_TARGET_KEY[harnessId];
  }
  throw new Error(
    `unknown mcp harness id "${harnessId}" — known ids: ${HARNESS_IDS.join(', ')}`
  );
}

/**
 * Does this server opt into the given harness? The only supported way for a
 * writer to ask — never `server.targets.claude` directly.
 *
 * @param {object} server a canonical merged server
 * @param {string} harnessId e.g. "claude-code"
 */
function isTargetedAt(server, harnessId) {
  const targetKey = targetKeyForHarnessId(harnessId);
  return Boolean(server && server.targets && server.targets[targetKey] === true);
}

/**
 * Applies this server's `targetOverrides` for the given harness, if any.
 *
 * @param {object} server a canonical merged server
 * @param {string} harnessId e.g. "claude-code"
 * @returns {object} the server, or a shallow copy with the override applied
 */
function applyTargetOverride(server, harnessId) {
  const targetKey = targetKeyForHarnessId(harnessId);
  const override = server && server.targetOverrides && server.targetOverrides[targetKey];
  return override ? { ...server, ...override } : server;
}

/**
 * A `targets` / `targetOverrides` key outside the mapping table is a typo,
 * and a typo that merely disabled a server everywhere would be invisible —
 * so loading fails loudly instead.
 *
 * @param {{name:string, targets?: object, targetOverrides?: object}} server
 * @param {string} filePath used only for the error message
 */
function assertKnownTargetKeys(server, filePath) {
  for (const field of ['targets', 'targetOverrides']) {
    const block = server[field];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;

    for (const key of Object.keys(block)) {
      if (key.startsWith('_')) continue; // `_comment` and friends
      if (Object.hasOwn(TARGET_KEY_TO_HARNESS_ID, key)) continue;
      throw new Error(
        `${filePath}: server "${server.name}" ${field}.${key} is not a known target key ` +
        `(known keys: ${TARGET_KEYS.join(', ')}) — see TARGET_KEY_TO_HARNESS_ID in lib/mcp-inventory/source.js`
      );
    }
  }
}

/**
 * @param {{name:string, env?: Record<string,string>}} server
 * @param {string} filePath used only for the error message
 */
function assertNoLiteralSecrets(server, filePath) {
  const env = server.env || {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || ENV_REF_RE.test(value)) continue; // a `${VAR}` reference is always fine

    if (looksLikeSecretValue(value) || SECRET_KEY_PATTERN.test(key)) {
      throw new Error(
        `${filePath}: server "${server.name}" env.${key} looks like a literal secret — ` +
        `use "\${${key}}" (an env-var reference) instead of a literal value`
      );
    }
  }
}

/**
 * @param {string} filePath
 * @returns {{schemaVersion: string, servers: Array<object>}}
 */
function loadLayer(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { schemaVersion: MCP_SCHEMA_VERSION, servers: [] };
    }
    throw err;
  }

  const json = JSON.parse(text);
  if (json.schemaVersion !== MCP_SCHEMA_VERSION) {
    throw new Error(`${filePath}: unsupported schemaVersion "${json.schemaVersion}" (expected "${MCP_SCHEMA_VERSION}")`);
  }

  const servers = Array.isArray(json.servers) ? json.servers : [];
  for (const server of servers) {
    assertNoLiteralSecrets(server, filePath);
    assertKnownTargetKeys(server, filePath);
  }

  return { schemaVersion: MCP_SCHEMA_VERSION, servers };
}

/**
 * Merges mcp.json layers in priority order (core, then packs, then personal
 * — same precedence as every other layer in this repo). A server named in a
 * later layer entirely REPLACES an earlier layer's server of the same name
 * (personal always wins, per core/rules/README.md) rather than being
 * field-merged with it.
 *
 * @param {Array<{servers: Array<object>}>} layers
 * @returns {Array<object>} order = first-seen name, using each name's LAST layer's entry
 */
function mergeLayers(layers) {
  const order = [];
  const byName = new Map();

  for (const layer of layers) {
    for (const server of layer.servers) {
      if (!byName.has(server.name)) order.push(server.name);
      byName.set(server.name, server);
    }
  }

  return order.map(name => byName.get(name));
}

/** Convenience: load + merge a list of mcp.json file paths in order. */
function loadAndMerge(filePaths) {
  return mergeLayers(filePaths.map(loadLayer));
}

function substituteHomeInValue(value, home) {
  if (typeof value !== 'string' || !home) return value;
  return value.split('{{HOME}}').join(home);
}

/** Recursively substitutes the `{{HOME}}` placeholder (the same convention
 * settings.layer.json/settings.personal.json already use) in command/args/
 * url/env/targetOverrides — for the codex/omp generators, which have no
 * subsequent shell `sed` pass to do this for them (unlike yoki-switch's
 * merge_settings(), which sed-substitutes the whole settings.json output
 * after the claude writer runs, so writers/claude.js deliberately leaves
 * `{{HOME}}` untouched). */
function substituteHomeInServer(server, home) {
  const result = { ...server };
  if (typeof result.command === 'string') result.command = substituteHomeInValue(result.command, home);
  if (Array.isArray(result.args)) result.args = result.args.map(a => substituteHomeInValue(a, home));
  if (typeof result.url === 'string') result.url = substituteHomeInValue(result.url, home);
  if (result.env) {
    result.env = Object.fromEntries(
      Object.entries(result.env).map(([key, value]) => [key, substituteHomeInValue(value, home)])
    );
  }
  if (result.targetOverrides) {
    result.targetOverrides = Object.fromEntries(
      Object.entries(result.targetOverrides).map(([target, override]) => [target, substituteHomeInServer(override, home)])
    );
  }
  return result;
}

/** @param {Array<object>} mergedServers @param {string} home */
function resolveHome(mergedServers, home) {
  return mergedServers.map(server => substituteHomeInServer(server, home));
}

module.exports = {
  ENV_REF_RE,
  TARGET_KEY_TO_HARNESS_ID,
  HARNESS_ID_TO_TARGET_KEY,
  TARGET_KEYS,
  HARNESS_IDS,
  harnessIdForTargetKey,
  targetKeyForHarnessId,
  isTargetedAt,
  applyTargetOverride,
  assertKnownTargetKeys,
  assertNoLiteralSecrets,
  loadLayer,
  mergeLayers,
  loadAndMerge,
  substituteHomeInValue,
  substituteHomeInServer,
  resolveHome,
};
