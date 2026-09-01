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
 *   guardFloor:
 *     - hook: git-guard.sh
 *       event: PreToolUse
 *       matcher: Bash
 *   defaultMode: auto
 *
 * `guardFloor` is the set of hooks that must be registered on EVERY harness,
 * declared here in the same layered source as the permissions rather than
 * hardcoded in each target's generator (the omp bridge used to carry the two
 * filenames as a literal). A layer may only ADD to the floor: it is unioned
 * across layers, never subtracted, so a pack or the personal layer can raise
 * the bar and none of them can quietly lower it.
 *
 * `allow`/`deny`/`guardFloor` may also be the empty-list form (`allow: []`).
 * Blank lines
 * and full-line `#` comments are ignored; there is no inline-comment or
 * multi-line-string support because the files this parses never need it.
 */

const fs = require('fs');
const path = require('path');

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

const LIST_KEYS = new Set(['allow', 'deny', 'guardFloor']);

/**
 * @param {string} text raw file content
 * @returns {{allow: Array<{pattern:string, reason?:string, enforce?:string[]}>,
 *            deny: Array<{pattern:string, reason?:string, enforce?:string[]}>,
 *            guardFloor: Array<{hook:string, event?:string, matcher?:string, reason?:string}>,
 *            defaultMode?: string}}
 */
function parseYamlPermissions(text) {
  const result = { allow: [], deny: [], guardFloor: [], defaultMode: undefined };
  let currentKey = null; // 'allow' | 'deny' | 'guardFloor' | null
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

      if (LIST_KEYS.has(key)) {
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
      if (currentKey !== 'allow' && currentKey !== 'deny') {
        throw new Error(`permissions.yaml:${lineNo + 1}: "- pattern:" outside an allow/deny block`);
      }
      currentEntry = { pattern: stripQuotes(itemMatch[1]) };
      result[currentKey].push(currentEntry);
      continue;
    }

    // guardFloor item start: "  - hook: git-guard.sh"
    const hookMatch = /^\s*-\s*hook:\s*(.+)$/.exec(rawLine);
    if (hookMatch) {
      if (currentKey !== 'guardFloor') {
        throw new Error(`permissions.yaml:${lineNo + 1}: "- hook:" outside a guardFloor block`);
      }
      currentEntry = { hook: stripQuotes(hookMatch[1]) };
      result[currentKey].push(currentEntry);
      continue;
    }

    // Nested guardFloor fields: "    event: PreToolUse" / "    matcher: Bash"
    const eventMatch = /^\s*event:\s*(.+)$/.exec(rawLine);
    if (eventMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "event:" outside a list entry`);
      }
      currentEntry.event = stripQuotes(eventMatch[1]);
      continue;
    }

    const matcherMatch = /^\s*matcher:\s*(.+)$/.exec(rawLine);
    if (matcherMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "matcher:" outside a list entry`);
      }
      currentEntry.matcher = stripQuotes(matcherMatch[1]);
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
      return { allow: [], deny: [], guardFloor: [], defaultMode: undefined };
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
 * Unions guardFloor entries across layers, deduping on the whole triple
 * (hook + event + matcher) rather than on the hook name alone: the same
 * script legitimately appears twice when a layer wants it on a second event
 * or a wider matcher. There is deliberately no removal path — a later layer
 * can only add — which is what makes "the floor" a floor.
 */
function dedupeGuardFloor(entries) {
  const seen = new Set();
  const out = [];

  for (const entry of entries) {
    if (!entry || !entry.hook) continue;
    const key = `${entry.hook}\u0000${entry.event || ''}\u0000${entry.matcher || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const copy = { hook: entry.hook };
    if (entry.event) copy.event = entry.event;
    if (entry.matcher) copy.matcher = entry.matcher;
    if (entry.reason) copy.reason = entry.reason;
    out.push(copy);
  }

  return out;
}

/**
 * Merges permission layers in priority order (core, then packs, then
 * personal — same precedence as yoki-switch's settings merge). allow/deny
 * and guardFloor are unions (dedupe by pattern / by hook+event+matcher); the
 * last layer that sets defaultMode wins.
 *
 * @param {Array<{allow:Array, deny:Array, guardFloor?:Array, defaultMode?:string}>} layers
 */
function mergeLayers(layers) {
  const allow = dedupeEntries(layers.flatMap(l => l.allow || []));
  const deny = dedupeEntries(layers.flatMap(l => l.deny || []));
  const guardFloor = dedupeGuardFloor(layers.flatMap(l => l.guardFloor || []));

  let defaultMode;
  for (const layer of layers) {
    if (layer.defaultMode) defaultMode = layer.defaultMode;
  }

  return { allow, deny, guardFloor, defaultMode: defaultMode || 'auto' };
}

/** Convenience: load + merge a list of permissions.yaml file paths in order. */
function loadAndMerge(filePaths) {
  return mergeLayers(filePaths.map(loadLayer));
}

/**
 * The declared guard floor for a set of layers, as absolute paths to the
 * installed hook scripts. Every target resolves the floor the same way —
 * `<home>/.claude/hooks/<hook>` is where yoki-switch installs (symlinks)
 * them on every machine — so a target never has to know which scripts the
 * floor names.
 *
 * @param {string[]} filePaths permissions.yaml paths, layer order
 * @param {string} home
 * @returns {Array<{hook:string, event?:string, matcher?:string, scriptPath:string}>}
 */
function resolveGuardFloor(filePaths, home) {
  const { guardFloor } = loadAndMerge(filePaths);
  return guardFloor.map(entry => ({
    ...entry,
    scriptPath: path.join(home, '.claude', 'hooks', entry.hook),
  }));
}

module.exports = {
  parseYamlPermissions,
  loadLayer,
  dedupeEntries,
  dedupeGuardFloor,
  mergeLayers,
  loadAndMerge,
  resolveGuardFloor,
};
