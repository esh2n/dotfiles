'use strict';

/**
 * A deliberately small, line-based reader for the two structural facts
 * `codex-config-toml.js` needs about `~/.codex/config.toml`:
 *
 *   1. which `[table]` headers the file already declares, and
 *   2. which keys sit inside each of them.
 *
 * Why line-based rather than a real TOML parser: the managed block is
 * defined as a *text* section that preserves everything outside it
 * byte-for-byte (see managed-block.js). Parsing to a value tree and
 * re-serializing would reformat the foreign half of the user's file — the
 * one thing this target promises never to do. So the block merge, and the
 * pre-write validation that guards it, both work on lines.
 *
 * Why validation exists at all: Codex refuses to start on a config.toml
 * with a duplicated table header —
 *
 *     Error: failed to load bootstrap configuration
 *     Caused by: config.toml:4:2: duplicate key
 *
 * — which is exactly what a managed block emitting `[features]` produced on
 * a machine whose file already declared `[features] hooks = true` outside
 * the block. `validateStructure` is the detector that turns that from "codex
 * is unusable until someone edits the file by hand" into "yoki refuses to
 * write and says which table".
 *
 * Known limits, all deliberate (this is a duplicate DETECTOR, not a TOML
 * validator): multi-line basic/literal strings (`"""` / `'''`) are not
 * tracked, and a dotted key (`a.b = 1`) is recorded under its full dotted
 * spelling rather than resolved into the table it implies. Both only ever
 * cause a duplicate to be MISSED, never a false one to be reported — the
 * failure direction that keeps `apply` from being blocked by a file it
 * merely failed to understand.
 */

/** `[table]` — but not `[[array-of-tables]]`, which may legally repeat. */
const TABLE_HEADER_RE = /^\s*\[([^[\]]+)\]\s*$/;
const ARRAY_TABLE_HEADER_RE = /^\s*\[\[[^[\]]+\]\]\s*$/;

/** One dotted segment of a key or header: a bare key, a basic string, or a
 * literal string. */
const SEGMENT_SOURCE = '(?:"(?:[^"\\\\]|\\\\.)*"|\'[^\']*\'|[A-Za-z0-9_-]+)';
const DOTTED_SOURCE = `${SEGMENT_SOURCE}(?:\\s*\\.\\s*${SEGMENT_SOURCE})*`;
const KEY_LINE_RE = new RegExp(`^\\s*(${DOTTED_SOURCE})\\s*=`);
const SEGMENT_RE = new RegExp(SEGMENT_SOURCE, 'g');

/** The separator used to join key path segments into a comparable name.
 * A NUL can appear in neither a bare key nor (meaningfully) a quoted one, so
 * `["a.b"]` and `[a.b]` never collide by accident. */
const NAME_SEPARATOR = '\u0000';

/** Strips the quotes off one dotted segment. A basic string goes through
 * JSON.parse so `"a\"b"` compares equal to the same key written elsewhere;
 * a literal string is taken as-is. */
function unquoteSegment(segment) {
  const text = String(segment).trim();
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'")) return text.slice(1, -1);
  return text;
}

/** @returns {string[]} the dotted path split into unquoted segments. */
function splitDottedKey(text) {
  const segments = String(text).match(SEGMENT_RE) || [];
  return segments.map(unquoteSegment);
}

/** A comparable name for a dotted path — `nameOf(['features'])` is what
 * `[features]` and `[ "features" ]` both reduce to. */
function nameOf(parts) {
  return parts.join(NAME_SEPARATOR);
}

/**
 * @param {string} line
 * @returns {{parts: string[], name: string, display: string}|null} null when
 *   the line is not a plain `[table]` header.
 */
function parseTableHeader(line) {
  const m = TABLE_HEADER_RE.exec(line);
  if (!m) return null;
  const parts = splitDottedKey(m[1]);
  if (parts.length === 0) return null;
  return { parts, name: nameOf(parts), display: line.trim() };
}

/**
 * @param {string} line
 * @returns {string|null} the comparable name of the key this line assigns,
 *   or null when the line is not a `key = …` assignment.
 */
function parseKeyLine(line) {
  const m = KEY_LINE_RE.exec(line);
  if (!m) return null;
  return nameOf(splitDottedKey(m[1]));
}

/** Blanks out quoted strings and drops a trailing comment, so bracket
 * counting never trips over a `#` or a `[` that lives inside a string. */
function stripStringsAndComments(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '#') break;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < line.length) {
        if (quote === '"' && line[i] === '\\') { i += 2; continue; }
        if (line[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Net bracket/brace depth change contributed by one line — non-zero only
 * for a value that continues onto the next line (a multi-line array or
 * inline table), whose contents must NOT be read as headers or keys. */
function depthDelta(line) {
  const code = stripStringsAndComments(line);
  let delta = 0;
  for (const ch of code) {
    if (ch === '[' || ch === '{') delta += 1;
    else if (ch === ']' || ch === '}') delta -= 1;
  }
  return delta;
}

/**
 * Splits `text` into the preamble (everything before the first header) plus
 * one entry per `[table]` header. Round-trips exactly:
 * `joinSections(splitSections(t)) === t`.
 *
 * @param {string} text
 * @returns {Array<{header: string|null, parts: string[]|null, name: string|null,
 *   display: string|null, lines: string[]}>} `lines` are the section's body
 *   lines, header excluded, trailing blank separator included.
 */
function splitSections(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const sections = [];
  let current = { header: null, parts: null, name: null, display: null, lines: [] };
  let depth = 0;

  for (const line of lines) {
    const header = depth === 0 ? parseTableHeader(line) : null;
    if (header) {
      sections.push(current);
      current = { header: line, parts: header.parts, name: header.name, display: header.display, lines: [] };
    } else {
      current.lines.push(line);
    }
    depth = Math.max(0, depth + depthDelta(line));
  }
  sections.push(current);
  return sections;
}

/** The inverse of splitSections. */
function joinSections(sections) {
  const out = [];
  for (const section of sections) {
    if (section.header !== null) out.push(section.header);
    out.push(...section.lines);
  }
  return out.join('\n');
}

/**
 * Every table in `text`, in file order, each with the keys it assigns.
 * The first entry is always the top level (`name: ''`, `parts: []`).
 *
 * An `[[array-of-tables]]` header opens a fresh, deliberately unnamed bucket:
 * repeats of it are legal TOML, so its occurrences are never compared
 * against each other or against a `[table]` of the same name.
 *
 * @param {string} text
 * @returns {Array<{name: string, parts: string[], display: string, line: number,
 *   arrayOfTables: boolean, keys: Map<string, number>}>}
 */
function readTables(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const newTable = (fields) => ({ arrayOfTables: false, keys: new Map(), duplicateKeys: [], ...fields });
  const top = newTable({ name: '', parts: [], display: '(top level)', line: 0 });
  const tables = [top];
  let current = top;
  let depth = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (depth === 0) {
      if (ARRAY_TABLE_HEADER_RE.test(line)) {
        current = newTable({
          name: null,
          parts: splitDottedKey(line.trim().slice(2, -2)),
          display: line.trim(),
          line: lineNumber,
          arrayOfTables: true,
        });
        tables.push(current);
      } else {
        const header = parseTableHeader(line);
        if (header) {
          current = newTable({ ...header, line: lineNumber });
          tables.push(current);
        } else {
          const key = parseKeyLine(line);
          if (key !== null) {
            if (current.keys.has(key)) current.duplicateKeys.push({ key, line: lineNumber });
            else current.keys.set(key, lineNumber);
          }
        }
      }
    }
    depth = Math.max(0, depth + depthDelta(line));
  });

  return tables;
}

/** Human-readable form of a comparable name (NUL-joined) for an error
 * message: `features\u0000hooks` -> `features.hooks`. */
function displayName(name) {
  return String(name).split(NAME_SEPARATOR).join('.');
}

/**
 * The duplicate detector Codex's own loader would otherwise report as an
 * unhelpful `config.toml:<line>:<col>: duplicate key`.
 *
 * @param {string} text
 * @returns {string[]} one message per problem; empty when the structure is sound
 */
function validateStructure(text) {
  const errors = [];
  const seenTables = new Map();
  const lines = String(text == null ? '' : text).split('\n');

  for (const table of readTables(text)) {
    if (!table.arrayOfTables && table.name) {
      if (seenTables.has(table.name)) {
        errors.push(
          `duplicate table header ${table.display} at line ${table.line} — already declared at line ${seenTables.get(table.name)}`
        );
      } else {
        seenTables.set(table.name, table.line);
      }
    }

    const where = table.name === '' ? 'at the top level' : `in ${table.display}`;
    for (const { key, line } of table.duplicateKeys) {
      errors.push(`duplicate key "${displayName(key)}" ${where} at line ${line} — already assigned at line ${table.keys.get(key)}`);
    }
  }

  // Cheap sanity check on the whole-file shape: an unclosed multi-line value
  // silently swallows every following header, so the tables above would be
  // read wrong rather than reported wrong.
  let depth = 0;
  for (const line of lines) depth += depthDelta(line);
  if (depth !== 0) {
    errors.push(`unbalanced brackets/braces across the file (net ${depth > 0 ? '+' : ''}${depth}) — an array or inline table is left open`);
  }

  return errors;
}

module.exports = {
  NAME_SEPARATOR,
  nameOf,
  splitDottedKey,
  parseTableHeader,
  parseKeyLine,
  splitSections,
  joinSections,
  readTables,
  validateStructure,
  displayName,
};
