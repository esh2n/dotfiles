'use strict';

/**
 * Narrow, scoped text-block helpers for reading specific known keys out of
 * omp's `config.yml` (a bounded shape: top-level scalars/maps/lists, at most
 * one level of nesting) — NOT a general YAML parser, same "tiny hand-written
 * parser for the subset used" spirit as ../permissions/parse.js and
 * ./frontmatter.js. omp.js only ever needs to read a handful of known keys
 * back out of the template and the machine's existing config.yml (to carry
 * runtime-owned state forward and to merge `tools.approval` defaults); the
 * rendered output itself is built as plain strings in omp-config-yml.js, so
 * no serializer is needed here.
 */

function stripInlineComment(value) {
  // Only strips a trailing ` #...` when it isn't inside a quoted string —
  // approximated by requiring an even number of `"` before the `#`, which
  // is all this repo's own config.yml ever needs.
  let cut = -1;
  let quotes = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') quotes++;
    if (value[i] === '#' && quotes % 2 === 0 && (i === 0 || /\s/.test(value[i - 1]))) {
      cut = i;
      break;
    }
  }
  return (cut === -1 ? value : value.slice(0, cut)).trim();
}

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function indentOf(line) {
  return line.length - line.replace(/^ */, '').length;
}

/**
 * Raw text of the block starting at `key:` found at exactly `indent`
 * leading spaces — the key's own line plus every following line that is
 * blank or indented deeper than `indent` — or `null` when no such key line
 * exists. Case: passing a block already extracted at indent N back in with
 * indent N+2 finds a *nested* key inside it (used for `tools.approval`
 * inside the `tools:` block).
 */
function extractBlockAtIndent(text, key, indent) {
  const lines = String(text || '').split(/\r?\n/);
  const pad = ' '.repeat(indent);
  const startRe = new RegExp(`^${pad}${key}:`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue; // a blank line never ends a block by itself
    if (indentOf(lines[i]) <= indent) {
      end = i;
      break;
    }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/** Top-level (column 0) variant of extractBlockAtIndent — the common case. */
function extractTopLevelBlock(text, key) {
  return extractBlockAtIndent(text, key, 0);
}

/**
 * A single-line scalar value for `key:` found at exactly `indent` leading
 * spaces (not a block) — quotes stripped, trailing inline comment removed.
 * `null` when absent. Matches the FIRST occurrence at that indent in `text`,
 * which is only safe when `text` is already narrowed to one block (see
 * extractScalar below) or the key is known to appear once overall.
 */
function extractScalarAtIndent(text, key, indent) {
  const pad = ' '.repeat(indent);
  const re = new RegExp(`^${pad}${key}:[ \\t]*(.*)$`, 'm');
  const m = re.exec(String(text || ''));
  if (!m) return null;
  const value = stripQuotes(stripInlineComment(m[1]));
  return value.length > 0 ? value : null;
}

/**
 * Immediate scalar children of a block at `childIndent` (the block's own
 * first line is skipped) — lines shaped like nested blocks (a bare `key:`
 * with nothing after it) are not scalars and are omitted.
 */
function extractChildScalars(blockText, childIndent) {
  const out = {};
  if (!blockText) return out;
  const pad = ' '.repeat(childIndent);
  const re = new RegExp(`^${pad}([A-Za-z_][\\w.-]*):[ \\t]*(.+)$`);
  for (const line of String(blockText).split(/\r?\n/).slice(1)) {
    const m = re.exec(line);
    if (!m) continue;
    out[m[1]] = stripQuotes(stripInlineComment(m[2]));
  }
  return out;
}

/** Dotted-path scalar lookup (e.g. `['modelRoles', 'default']` or
 * `['tools', 'approvalMode']`) — one or two levels deep, all this file's
 * known shape ever needs. */
function extractScalar(text, path) {
  if (path.length === 1) return extractScalarAtIndent(text, path[0], 0);
  const block = extractTopLevelBlock(text, path[0]);
  if (!block) return null;
  return extractScalarAtIndent(block, path[1], 2);
}

module.exports = {
  extractBlockAtIndent,
  extractTopLevelBlock,
  extractScalarAtIndent,
  extractChildScalars,
  extractScalar,
};
