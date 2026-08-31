'use strict';

/**
 * Builds the `mcpServers` object for Claude Code's settings.json from the
 * canonical mcp.json inventory (task T13) — supersedes reading `mcpServers`
 * directly off core/settings.layer.json (see lib/permissions/to-claude.js
 * for the analogous permissions migration this mirrors).
 *
 * Only `targets.claude === true` servers are emitted — see core/mcp.json's
 * top-level `_comment` for why codebase-memory-mcp/serena keep that false
 * (they stay registered via install.sh's `claude mcp add` into
 * ~/.claude.json, a separate mechanism this writer must not duplicate).
 *
 * `{{HOME}}` is left untouched here (unlike writers/codex.js and
 * writers/omp.js): yoki-switch's merge_settings() sed-substitutes the whole
 * settings.json output — including whatever this writer emits — in one
 * pass after the jq merge, the same way it already does for every other
 * `{{HOME}}`-bearing value in the settings layers.
 */

const { loadAndMerge } = require('../source');

/**
 * @param {object} server a resolved server (after any 'claude' targetOverrides)
 * @returns {object} the shape Claude's settings.json mcpServers expects
 */
function toClaudeEntry(server) {
  const env = server.env && Object.keys(server.env).length ? server.env : null;

  if (server.transport === 'http') {
    const entry = { url: server.url, type: 'http' };
    if (env) entry.env = env;
    return entry;
  }

  const entry = { command: server.command, args: server.args || [], type: 'stdio' };
  if (env) entry.env = env;
  return entry;
}

/** Applies this server's 'claude' targetOverrides, if any. */
function applyClaudeOverride(server) {
  const override = server.targetOverrides && server.targetOverrides.claude;
  return override ? { ...server, ...override } : server;
}

/**
 * @param {Array<object>} mergedServers canonical, already core→packs→personal
 *   merged servers (lib/mcp-inventory/source.js loadAndMerge)
 * @returns {Record<string, object>}
 */
function buildMcpServers(mergedServers) {
  const result = {};
  for (const server of mergedServers) {
    if (!server.targets || server.targets.claude !== true) continue;
    const effective = applyClaudeOverride(server);
    result[effective.name] = toClaudeEntry(effective);
  }
  return result;
}

/** Loads + merges the given mcp.json files and returns the settings.json
 * mcpServers shape — what the `--sources` CLI entry point below prints. */
function convert(filePaths) {
  return buildMcpServers(loadAndMerge(filePaths));
}

module.exports = { toClaudeEntry, applyClaudeOverride, buildMcpServers, convert };

// -----------------------------------------------------------------------------
// CLI: node claude.js --sources <core.json> [<pack.json>...] <personal.json>
// Prints the mcpServers object as JSON on stdout — yoki-switch's
// merge_settings() shells out to this instead of reading mcpServers straight
// off the JSON settings layers.
// -----------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const sourcesFlagIndex = args.indexOf('--sources');
  const filePaths = sourcesFlagIndex === -1 ? [] : args.slice(sourcesFlagIndex + 1);

  if (filePaths.length === 0) {
    process.stderr.write('Usage: node claude.js --sources <mcp.json>...\n');
    process.exit(1);
  }

  try {
    process.stdout.write(JSON.stringify(convert(filePaths)));
  } catch (err) {
    process.stderr.write(`claude.js: ${err.message}\n`);
    process.exit(1);
  }
}
