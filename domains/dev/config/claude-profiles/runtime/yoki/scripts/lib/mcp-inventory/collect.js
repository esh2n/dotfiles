'use strict';

const { normalizeServerEntry, buildInventory } = require('./canonical-mcp');
const { readClaudeCodeMcp, HARNESS_ID: CLAUDE_CODE_HARNESS_ID } = require('./readers/claude-code');
const { readCodexMcp } = require('./readers/codex');
const { readOpencodeMcp } = require('./readers/opencode');

// Keyed by harness id — the same ids the writers/ use. Claude Code is spelled
// `claude-code` here and `targets.claude` in the mcp.json layers; source.js's
// TARGET_KEY_TO_HARNESS_ID is the only place those two spellings are joined.
const DEFAULT_READERS = Object.freeze({
  [CLAUDE_CODE_HARNESS_ID]: readClaudeCodeMcp,
  codex: readCodexMcp,
  opencode: readOpencodeMcp
});

// Collect MCP server configs from every harness reader, normalize each raw
// entry to ecc.mcp.v1, then merge into a single deduplicated inventory with a
// fragmentation report. Secrets are stripped during normalization (only env
// key names survive), so the returned inventory is safe to print or persist.
function collectMcpInventory(options = {}) {
  const readers = options.readers || DEFAULT_READERS;
  const readerOptions = options.readerOptions || {};

  const rawRecords = [];
  for (const [harness, reader] of Object.entries(readers)) {
    if (typeof reader !== 'function') {
      continue;
    }

    let entries;
    try {
      entries = reader(readerOptions[harness] || readerOptions.shared || {});
    } catch {
      entries = [];
    }

    if (Array.isArray(entries)) {
      rawRecords.push(...entries);
    }
  }

  const normalized = rawRecords.map(normalizeServerEntry);
  return buildInventory(normalized);
}

module.exports = {
  collectMcpInventory,
  DEFAULT_READERS
};
