'use strict';

/**
 * Converts a merged permission layer set (see parse.js) into the shape
 * Claude Code's settings.json expects, plus the hook-enforced deny subset
 * that pre-permission-guard.js reads from <CLAUDE_DIR>/.yoki/permissions.json.
 *
 * toClaudeSettings() output is byte-for-byte the same permission strings
 * that used to live in core/settings.layer.json permissions.allow and
 * personal/settings.personal.json permissions.deny (see
 * lib/permissions/test/to-claude.test.js for the regression that pins this
 * against the pre-migration git content), plus the two Edit(.env-glob) deny
 * entries T8 introduced (see personal/permissions.yaml for their exact
 * patterns).
 */

const { loadAndMerge } = require('./parse');

/**
 * @param {{allow: Array<{pattern:string}>, deny: Array<{pattern:string}>, defaultMode?: string}} merged
 * @returns {{allow: string[], deny: string[], defaultMode: string}}
 */
function toClaudeSettings(merged) {
  return {
    allow: merged.allow.map(entry => entry.pattern),
    deny: merged.deny.map(entry => entry.pattern),
    defaultMode: merged.defaultMode || 'auto',
  };
}

/**
 * The deny entries marked `enforce: [hook]` — these need a PreToolUse hook
 * in every harness (including Claude Code itself, as defense in depth)
 * because they cannot be fully expressed as a declarative permission rule
 * everywhere they run. Written to <CLAUDE_DIR>/.yoki/permissions.json by
 * yoki-switch at apply time.
 *
 * @param {{deny: Array<{pattern:string, reason?:string, enforce?:string[]}>}} merged
 * @returns {Array<{pattern:string, reason:string}>}
 */
function hookEnforcedDeny(merged) {
  return merged.deny
    .filter(entry => Array.isArray(entry.enforce) && entry.enforce.includes('hook'))
    .map(entry => ({ pattern: entry.pattern, reason: entry.reason || '' }));
}

/**
 * Loads + merges the given permissions.yaml files and returns both the
 * Claude settings shape and the hook-enforced deny list in one call — this
 * is what the `--sources` CLI entry point below uses.
 */
function convert(filePaths) {
  const merged = loadAndMerge(filePaths);
  return {
    settings: toClaudeSettings(merged),
    hookEnforced: hookEnforcedDeny(merged),
  };
}

module.exports = { toClaudeSettings, hookEnforcedDeny, convert };

// -----------------------------------------------------------------------------
// CLI: node to-claude.js --sources <core.yaml> [<pack.yaml>...] <personal.yaml>
// Prints {settings, hookEnforced} as JSON on stdout — yoki-switch's
// merge_settings() shells out to this instead of reading permissions
// straight from the JSON settings layers.
// -----------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const sourcesFlagIndex = args.indexOf('--sources');
  if (sourcesFlagIndex === -1) {
    process.stderr.write('Usage: node to-claude.js --sources <layer.yaml>...\n');
    process.exit(1);
  }
  const filePaths = args.slice(sourcesFlagIndex + 1);
  if (filePaths.length === 0) {
    process.stderr.write('Usage: node to-claude.js --sources <layer.yaml>...\n');
    process.exit(1);
  }

  try {
    const result = convert(filePaths);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`to-claude.js: ${err.message}\n`);
    process.exit(1);
  }
}
