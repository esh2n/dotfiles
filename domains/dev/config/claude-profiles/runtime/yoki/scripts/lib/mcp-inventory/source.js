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
  for (const server of servers) assertNoLiteralSecrets(server, filePath);

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
  assertNoLiteralSecrets,
  loadLayer,
  mergeLayers,
  loadAndMerge,
  substituteHomeInValue,
  substituteHomeInServer,
  resolveHome,
};
