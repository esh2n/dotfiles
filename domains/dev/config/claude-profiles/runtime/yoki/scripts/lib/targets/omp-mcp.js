'use strict';

/**
 * Builds `~/.omp/agent/mcp.json`. omp's native mcp.json loader (`discovery/
 * builtin.ts`, spike S4-S5 (a)) accepts `{"mcpServers": {"<name>": {"type":
 * "stdio"|"streamable-http"|"sse", command, args, env, cwd, url, headers,
 * ...}}}` with no `$schema` requirement (that check exists only for
 * agent-plugins-packaged mcp.json manifests — a different loader entirely;
 * verified against the field lists both loaders build in the 18.0.4 binary
 * strings dump).
 *
 * Servers now come from the canonical mcp.json source of truth (task T13,
 * `lib/mcp-inventory/source.js` + `lib/mcp-inventory/writers/omp.js`) instead
 * of the hardcoded pair this file used to carry directly — see
 * core/mcp.json's `serena` entry for the `--context codex` reasoning
 * (omp has no context of its own in the serena-agent package; `codex` is the
 * closest fit, both being headless, tool-calling coding-agent CLIs).
 *
 * Existing entries other than the ones this call's `mergedServers` provides
 * are preserved untouched — a hand-added third server must not be clobbered
 * by regeneration.
 */

const { buildOmpMcpServers } = require('../mcp-inventory/writers/omp');

/**
 * @param {object|null} existing parsed existing `mcp.json` (or null/absent)
 * @param {Array<object>} mergedServers canonical, already core→packs→personal
 *   merged + `{{HOME}}`-resolved servers (lib/mcp-inventory/source.js
 *   loadAndMerge + resolveHome), filtered to `targets.omp === true` by
 *   buildOmpMcpServers below.
 * @returns {object} the full `mcp.json` content (mcpServers only — no
 *   `$schema`, matching the native loader's own shape)
 */
function buildMcpJson(existing, mergedServers) {
  const existingServers = (existing && typeof existing.mcpServers === 'object' && existing.mcpServers) || {};
  return { mcpServers: { ...existingServers, ...buildOmpMcpServers(mergedServers) } };
}

module.exports = { buildMcpJson };
