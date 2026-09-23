// toml-lite.mjs — zero-dependency TOML SUBSET parser for `.writeup.toml`.
//
// Supports exactly what the store config needs and nothing more:
//   - `[table]` headers
//   - `[[array.of.tables]]` headers
//   - `key = value` pairs where value is a double- or single-quoted string,
//     a bracketed array of such values (may span multiple lines), a
//     boolean (`true`/`false`), or a bare integer
//   - `#` line comments (only when not inside a string)
//
// NOT supported (throws): inline tables (`{ a = 1 }`), dotted keys,
// multi-line strings (`"""..."""`), floats, dates. Nothing in the writeup
// contract's config shape needs them; a config file that does gets a clear
// parse error rather than being silently misread.

class TomlParseError extends Error {}

function stripComment(line) {
  // Remove a trailing `# ...` comment, but not one embedded inside a quoted
  // string on the same line.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseQuotedString(raw) {
  const quote = raw[0];
  if (raw.length < 2 || raw[raw.length - 1] !== quote) {
    throw new TomlParseError(`unterminated string: ${raw}`);
  }
  const inner = raw.slice(1, -1);
  if (quote === "'") return inner; // TOML literal string: no escapes
  // Double-quoted: minimal escape handling.
  return inner.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return c;
    }
  });
}

/** Splits `content` (the inside of an array's brackets) on top-level commas,
 * i.e. commas that are not inside a nested string or array. */
function splitTopLevel(content) {
  const parts = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = "";
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return parseQuotedString(s);
  }
  throw new TomlParseError(`unsupported value: ${raw}`);
}

function parseArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new TomlParseError(`malformed array: ${raw}`);
  }
  const inner = trimmed.slice(1, -1);
  if (inner.trim() === "") return [];
  return splitTopLevel(inner).map((part) => parseValue(part.trim()));
}

function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith("[")) return parseArray(s);
  if (s.startsWith("{")) throw new TomlParseError(`inline tables are not supported: ${raw}`);
  return parseScalar(s);
}

/** Parses `text` and returns a plain object. Table sections (`[x]`) become
 * nested objects; array-of-table sections (`[[x]]`) become arrays of
 * objects appended to on each occurrence. Throws TomlParseError on any
 * unsupported construct. */
export function parseToml(text) {
  const root = {};
  let current = root;

  const rawLines = text.split("\n");
  let i = 0;
  while (i < rawLines.length) {
    let line = stripComment(rawLines[i]).trim();
    if (line === "") {
      i++;
      continue;
    }

    const arrayTableMatch = line.match(/^\[\[\s*([A-Za-z0-9_.\-]+)\s*\]\]$/);
    const tableMatch = !arrayTableMatch && line.match(/^\[\s*([A-Za-z0-9_.\-]+)\s*\]$/);

    if (arrayTableMatch) {
      const name = arrayTableMatch[1];
      if (!Array.isArray(root[name])) root[name] = [];
      const entry = {};
      root[name].push(entry);
      current = entry;
      i++;
      continue;
    }
    if (tableMatch) {
      const name = tableMatch[1];
      if (typeof root[name] !== "object" || Array.isArray(root[name])) root[name] = {};
      current = root[name];
      i++;
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      throw new TomlParseError(`cannot parse line: ${rawLines[i]}`);
    }
    const key = kvMatch[1];
    let valueText = kvMatch[2];

    // Multi-line array: accumulate lines until brackets balance.
    if (valueText.trim().startsWith("[")) {
      let depth = 0;
      for (const ch of valueText) {
        if (ch === "[") depth++;
        if (ch === "]") depth--;
      }
      while (depth > 0) {
        i++;
        if (i >= rawLines.length) throw new TomlParseError(`unterminated array starting at: ${line}`);
        const nextLine = stripComment(rawLines[i]);
        valueText += "\n" + nextLine;
        for (const ch of nextLine) {
          if (ch === "[") depth++;
          if (ch === "]") depth--;
        }
      }
    }

    current[key] = parseValue(valueText);
    i++;
  }

  return root;
}

export { TomlParseError };
