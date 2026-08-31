'use strict';

/**
 * Builds the `mcpServers` object for `~/.omp/agent/mcp.json` from the
 * canonical mcp.json inventory (task T13). omp's native mcp.json loader
 * (`discovery/builtin.ts`, spike S4-S5 (a)) accepts `{"mcpServers": {
 * "<name>": {"type": "stdio"|"streamable-http"|"sse", command, args, env,
 * cwd, url, headers, ...}}}` with no `$schema` requirement — note the
 * canonical schema's `transport: "http"` maps to omp's `"streamable-http"`,
 * not `"http"`.
 *
 * Consumed by `lib/targets/omp-mcp.js`'s `buildMcpJson`, which layers this
 * writer's output on top of whatever `~/.omp/agent/mcp.json` already has —
 * a hand-added third server is preserved untouched (only the servers this
 * writer emits are overwritten).
 */

/** Applies this server's 'omp' targetOverrides, if any. */
function applyOmpOverride(server) {
  const override = server.targetOverrides && server.targetOverrides.omp;
  return override ? { ...server, ...override } : server;
}

/** @param {object} server a resolved server (after 'omp' targetOverrides) */
function toOmpEntry(server) {
  const env = server.env && Object.keys(server.env).length ? server.env : null;

  if (server.transport === 'http') {
    const entry = { type: 'streamable-http', url: server.url };
    if (env) entry.env = env;
    return entry;
  }

  const entry = { type: 'stdio', command: server.command };
  if (server.args && server.args.length) entry.args = server.args;
  if (env) entry.env = env;
  return entry;
}

/**
 * @param {Array<object>} mergedServers canonical, already core→packs→personal
 *   merged + `{{HOME}}`-resolved servers (lib/mcp-inventory/source.js
 *   loadAndMerge + resolveHome)
 * @returns {Record<string, object>}
 */
function buildOmpMcpServers(mergedServers) {
  const result = {};
  for (const server of mergedServers) {
    if (!server.targets || server.targets.omp !== true) continue;
    const effective = applyOmpOverride(server);
    result[effective.name] = toOmpEntry(effective);
  }
  return result;
}

module.exports = { toOmpEntry, applyOmpOverride, buildOmpMcpServers };
