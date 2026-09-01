'use strict';

/**
 * Builds the `[mcp_servers.<name>]` TOML tables appended into Codex's
 * `config.toml` managed block (task T13, consumed by
 * `lib/targets/codex-config-toml.js` via T9's `toml-block` op — see
 * `buildRulesAndConfigOperations` in `lib/targets/codex.js` for the wiring).
 *
 * TRANSPORT IS INFERRED FROM THE KEYS, NOT DECLARED. Codex decides how to
 * launch a server by what its table contains: a `command` means stdio, a
 * `url` means http. There is no `type` key. So the two key sets are
 * mutually exclusive and this writer emits one or the other:
 *
 *   http  -> url (+ bearer_token_env_var / http_headers / the timeout and
 *            enablement keys, when the source declares them)
 *   stdio -> command, args (+ [mcp_servers.<name>.env] when non-empty)
 *
 * Mixing them is not merely redundant, it is fatal: a table carrying
 * `command = ""` + `type = "http"` + `url` (the shape this file emitted
 * before, copied from an old hand-written config.toml.template) makes Codex
 * refuse to start the whole CLI —
 *
 *     Error: failed to load bootstrap configuration
 *     Caused by: url is not supported for stdio
 *                in `mcp_servers.notion-mcp`
 *
 * — because the empty `command` alone is enough to select stdio. Verified
 * against codex-cli 0.152.0, as is the converse (`url` only: loads).
 * `lib/targets/codex-config-toml.js`'s validateMcpServerTables re-checks the
 * url-XOR-command invariant over the assembled file before it is written.
 *
 * A same-named `[mcp_servers.<name>]` table already declared OUTSIDE the
 * managed block (a hand-added server, or a pre-T13 `codex mcp add` entry)
 * is left alone rather than overwritten — the caller surfaces the resulting
 * warning through gen.js's `plan().warnings`, same as every other codex.js
 * warning.
 *
 * NAMING — a writer selects servers by HARNESS_ID (the id this subsystem's
 * readers/ also use), not by naming an mcp.json `targets.<key>` directly:
 * the two spellings coincide for codex but not for Claude Code (`claude` in
 * the data, `claude-code` as the id), and lib/mcp-inventory/source.js's
 * TARGET_KEY_TO_HARNESS_ID is the only place they are reconciled.
 */

const { isTargetedAt, applyTargetOverride } = require('../source');

/** This writer's harness id — the same id readers/codex.js stamps. */
const HARNESS_ID = 'codex';

function tomlString(value) {
  return JSON.stringify(String(value));
}

/** Applies this server's Codex targetOverrides, if any. */
function applyCodexOverride(server) {
  return applyTargetOverride(server, HARNESS_ID);
}

/** Optional Codex keys an http server may carry, emitted verbatim (and only
 * when the source declares them) rather than defaulted — a value Codex would
 * choose itself is better left unwritten than guessed at here. */
const HTTP_STRING_KEYS = ['bearer_token_env_var'];
const NUMERIC_KEYS = ['startup_timeout_sec', 'tool_timeout_sec'];
const BOOLEAN_KEYS = ['enabled'];
const STRING_LIST_KEYS = ['enabled_tools', 'disabled_tools'];

function tomlStringList(values) {
  return `[${values.map(tomlString).join(', ')}]`;
}

/** The keys shared by both transports, appended after the transport's own. */
function optionalLines(server) {
  const lines = [];
  for (const key of NUMERIC_KEYS) {
    if (typeof server[key] === 'number' && Number.isFinite(server[key])) lines.push(`${key} = ${server[key]}`);
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof server[key] === 'boolean') lines.push(`${key} = ${server[key]}`);
  }
  for (const key of STRING_LIST_KEYS) {
    if (Array.isArray(server[key])) lines.push(`${key} = ${tomlStringList(server[key])}`);
  }
  return lines;
}

/** @param {object} server a resolved server (after 'codex' targetOverrides) */
function toTomlTable(server) {
  const lines = [`[mcp_servers.${server.name}]`];
  const subTables = [];

  if (server.transport === 'http') {
    // url ONLY — see the file header: a `command` key of any value, empty
    // included, makes Codex read the table as stdio and reject the url.
    lines.push(`url = ${tomlString(server.url)}`);
    for (const key of HTTP_STRING_KEYS) {
      if (typeof server[key] === 'string' && server[key]) lines.push(`${key} = ${tomlString(server[key])}`);
    }
    lines.push(...optionalLines(server));

    const headerEntries = Object.entries(server.http_headers || {});
    if (headerEntries.length) {
      subTables.push(`[mcp_servers.${server.name}.http_headers]`);
      for (const [key, value] of headerEntries) subTables.push(`${key} = ${tomlString(value)}`);
    }
  } else {
    lines.push(`command = ${tomlString(server.command)}`);
    lines.push(`args = [${(server.args || []).map(tomlString).join(', ')}]`);
    lines.push(...optionalLines(server));

    const envEntries = Object.entries(server.env || {});
    if (envEntries.length) {
      subTables.push(`[mcp_servers.${server.name}.env]`);
      for (const [key, value] of envEntries) subTables.push(`${key} = ${tomlString(value)}`);
    }
  }

  return [...lines, ...subTables].join('\n');
}

const MCP_TABLE_HEADER_RE = /^\[mcp_servers\.([^\].\s]+)\]/gm;

/** Names of every `[mcp_servers.<name>]` table appearing in `text` (used
 * only against the config.toml content OUTSIDE our managed block). */
function findServerNamesInText(text) {
  const names = new Set();
  const re = new RegExp(MCP_TABLE_HEADER_RE);
  let match;
  while ((match = re.exec(String(text || '')))) names.add(match[1]);
  return names;
}

/**
 * @param {Array<object>} mergedServers canonical, already core→packs→personal
 *   merged + `{{HOME}}`-resolved servers (lib/mcp-inventory/source.js
 *   loadAndMerge + resolveHome)
 * @param {string} existingOutsideBlock the config.toml content OUTSIDE our
 *   managed block (`lib/targets/managed-block.js` extractBlock's `after`)
 * @returns {{toml: string, warnings: string[]}}
 */
function buildMcpServersToml(mergedServers, existingOutsideBlock) {
  const conflicting = findServerNamesInText(existingOutsideBlock);
  const warnings = [];
  const tables = [];

  for (const server of mergedServers) {
    if (!isTargetedAt(server, HARNESS_ID)) continue;

    if (conflicting.has(server.name)) {
      warnings.push(
        `codex: [mcp_servers.${server.name}] is already declared outside the managed block — left alone, not regenerated by yoki`
      );
      continue;
    }

    tables.push(toTomlTable(applyCodexOverride(server)));
  }

  return { toml: tables.join('\n\n'), warnings };
}

module.exports = { HARNESS_ID, toTomlTable, applyCodexOverride, findServerNamesInText, buildMcpServersToml };
