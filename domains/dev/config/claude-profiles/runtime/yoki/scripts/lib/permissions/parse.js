'use strict';

/**
 * Tiny hand-written parser for the permissions.yaml subset used by
 * core/personal/packs/<name>/permissions.yaml — no YAML dependency.
 *
 * Supported shape only (anything else is a parse error):
 *
 *   allow:
 *     - pattern: "Bash(git status *)"
 *       reason: "optional text"
 *     - pattern: "Read(**)"
 *   deny:
 *     - pattern: "Bash(rm -rf /*)"
 *       reason: "optional text"
 *       enforce: [hook]
 *   defaultMode: auto
 *
 * `allow`/`deny` may also be the empty-list form (`allow: []`). Blank lines
 * and full-line `#` comments are ignored; there is no inline-comment or
 * multi-line-string support because the files this parses never need it.
 */

const fs = require('fs');

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(value) {
  const v = value.trim();
  if (v === '[]') return [];
  const m = /^\[(.*)\]$/.exec(v);
  if (!m) {
    throw new Error(`permissions.yaml: expected an inline array, got: ${value}`);
  }
  return m[1]
    .split(',')
    .map(part => stripQuotes(part))
    .filter(part => part.length > 0);
}

/**
 * @param {string} text raw file content
 * @returns {{allow: Array<{pattern:string, reason?:string, enforce?:string[]}>,
 *            deny: Array<{pattern:string, reason?:string, enforce?:string[]}>,
 *            defaultMode?: string}}
 */
function parseYamlPermissions(text) {
  const result = { allow: [], deny: [], defaultMode: undefined };
  let currentKey = null; // 'allow' | 'deny' | null
  let currentEntry = null;

  const lines = String(text ?? '').split(/\r?\n/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Top-level key (no leading whitespace): "allow:", "deny:", "defaultMode: auto"
    const topMatch = /^(\w+):\s*(.*)$/.exec(rawLine);
    if (topMatch && rawLine[0] !== ' ' && rawLine[0] !== '-') {
      const [, key, rest] = topMatch;
      currentEntry = null;

      if (key === 'allow' || key === 'deny') {
        currentKey = key;
        if (rest.trim() === '[]') {
          result[key] = [];
          currentKey = null; // inline empty list closes the block immediately
        }
        continue;
      }

      if (key === 'defaultMode') {
        result.defaultMode = stripQuotes(rest);
        currentKey = null;
        continue;
      }

      throw new Error(`permissions.yaml:${lineNo + 1}: unsupported top-level key "${key}"`);
    }

    // List item start: "  - pattern: ..."
    const itemMatch = /^\s*-\s*pattern:\s*(.+)$/.exec(rawLine);
    if (itemMatch) {
      if (!currentKey) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "- pattern:" outside an allow/deny block`);
      }
      currentEntry = { pattern: stripQuotes(itemMatch[1]) };
      result[currentKey].push(currentEntry);
      continue;
    }

    // Nested field on the current entry: "    reason: ..." / "    enforce: [...]"
    const reasonMatch = /^\s*reason:\s*(.+)$/.exec(rawLine);
    if (reasonMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "reason:" outside a list entry`);
      }
      currentEntry.reason = stripQuotes(reasonMatch[1]);
      continue;
    }

    const enforceMatch = /^\s*enforce:\s*(.+)$/.exec(rawLine);
    if (enforceMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "enforce:" outside a list entry`);
      }
      currentEntry.enforce = parseInlineArray(enforceMatch[1]);
      continue;
    }

    throw new Error(`permissions.yaml:${lineNo + 1}: unrecognized line: ${rawLine}`);
  }

  return result;
}

/**
 * Loads and parses one permissions.yaml layer. A missing file is treated as
 * an empty layer (packs are optional; not every pack ships one).
 */
function loadLayer(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { allow: [], deny: [], defaultMode: undefined };
    }
    throw err;
  }
  return parseYamlPermissions(text);
}

/**
 * Unions a list of same-key entries (allow or deny) across layers, deduping
 * by pattern text. First occurrence wins position; a later layer's `reason`
 * fills a gap but never overwrites an earlier one, and `enforce` arrays are
 * unioned so a pack/personal layer can add hook-enforcement to a pattern
 * core already declared without needing to repeat it.
 */
function dedupeEntries(entries) {
  const order = [];
  const byPattern = new Map();

  for (const entry of entries) {
    const existing = byPattern.get(entry.pattern);
    if (!existing) {
      const copy = { pattern: entry.pattern };
      if (entry.reason) copy.reason = entry.reason;
      if (entry.enforce && entry.enforce.length) copy.enforce = [...entry.enforce];
      byPattern.set(entry.pattern, copy);
      order.push(entry.pattern);
      continue;
    }

    if (!existing.reason && entry.reason) {
      existing.reason = entry.reason;
    }
    if (entry.enforce && entry.enforce.length) {
      const merged = new Set([...(existing.enforce || []), ...entry.enforce]);
      existing.enforce = [...merged];
    }
  }

  return order.map(pattern => byPattern.get(pattern));
}

/**
 * Merges permission layers in priority order (core, then packs, then
 * personal — same precedence as yoki-switch's settings merge). allow/deny
 * are unions (dedupe by pattern); the last layer that sets defaultMode wins.
 *
 * @param {Array<{allow:Array, deny:Array, defaultMode?:string}>} layers
 */
function mergeLayers(layers) {
  const allow = dedupeEntries(layers.flatMap(l => l.allow || []));
  const deny = dedupeEntries(layers.flatMap(l => l.deny || []));

  let defaultMode;
  for (const layer of layers) {
    if (layer.defaultMode) defaultMode = layer.defaultMode;
  }

  return { allow, deny, defaultMode: defaultMode || 'auto' };
}

/** Convenience: load + merge a list of permissions.yaml file paths in order. */
function loadAndMerge(filePaths) {
  return mergeLayers(filePaths.map(loadLayer));
}

module.exports = {
  parseYamlPermissions,
  loadLayer,
  dedupeEntries,
  mergeLayers,
  loadAndMerge,
};
