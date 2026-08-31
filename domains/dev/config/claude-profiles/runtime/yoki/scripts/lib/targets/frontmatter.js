'use strict';

/**
 * Tiny frontmatter parser for the `---\nkey: value\n---\n<body>` shape used
 * by every agent, command and SKILL.md file in this repo — no YAML
 * dependency, same spirit as lib/permissions/parse.js.
 *
 * Supports scalar `key: value` lines and one array shape, `key: ["a", "b"]`
 * (the only frontmatter array these files use — `tools:`), plus a fallback
 * first-`#`-heading extraction for files whose frontmatter omits
 * `description`.
 */

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not a JSON array literal — e.g. `argument-hint: [csv]`, where the
      // brackets are literal hint text, not YAML/JSON array syntax. Fall
      // through and keep the whole value as a string.
    }
  }
  return stripQuotes(v);
}

/**
 * @param {string} text raw markdown file content
 * @returns {{frontmatter: Record<string, string|string[]>, body: string}}
 *   `frontmatter` is `{}` when the file has no `---` delimited block.
 */
function parseFrontmatter(text) {
  const source = String(text ?? '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) {
    return { frontmatter: {}, body: source };
  }

  const [, block, body] = match;
  const frontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    frontmatter[kv[1]] = parseValue(kv[2]);
  }

  return { frontmatter, body };
}

/** First `#`/`##` heading text in `body`, used as a description fallback
 * when frontmatter has none (commands→skills generation). */
function firstHeading(body) {
  const m = /^#{1,6}\s+(.+)$/m.exec(String(body ?? ''));
  return m ? m[1].trim() : '';
}

module.exports = { parseFrontmatter, firstHeading };
