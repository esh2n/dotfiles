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
 *
 * NAMING — a writer selects servers by HARNESS_ID (the id this subsystem's
 * readers/ also use), not by naming an mcp.json `targets.<key>` directly:
 * the two spellings coincide for omp but not for Claude Code (`claude` in
 * the data, `claude-code` as the id), and lib/mcp-inventory/source.js's
 * TARGET_KEY_TO_HARNESS_ID is the only place they are reconciled.
 */

const { isTargetedAt, applyTargetOverride } = require('../source');

/** This writer's harness id. */
const HARNESS_ID = 'omp';

/** Applies this server's omp targetOverrides, if any. */
function applyOmpOverride(server) {
  return applyTargetOverride(server, HARNESS_ID);
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
    if (!isTargetedAt(server, HARNESS_ID)) continue;
    const effective = applyOmpOverride(server);
    result[effective.name] = toOmpEntry(effective);
  }
  return result;
}

module.exports = { HARNESS_ID, toOmpEntry, applyOmpOverride, buildOmpMcpServers };
