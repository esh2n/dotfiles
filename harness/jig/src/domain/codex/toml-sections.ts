/**
 * `~/.codex/config.toml` as a list of sections, so jig can find the tables
 * it owns by name instead of by comment markers.
 *
 * Codex rewrites this file itself (trusting a project or a hook, counting a
 * model notice, `codex mcp add`) and regroups tables by their parent key on
 * every write: `[tui]` moves beside `[tui.model_availability_nux]`, every
 * `[mcp_servers.*]` gathers in one place. Comments stay where they were, so
 * a `# jig:begin` … `# jig:end` pair stops enclosing what jig wrote
 * (reproduced with codex-cli 0.160.0, 2026-10-18). A table's name survives
 * that; its position does not.
 *
 * A section is a table header line and every line up to the next header;
 * the lines before the first header are the preamble. A line only counts as
 * a header outside a multi-line value: inside a `"""` or `'''` string, or an
 * array or inline table still open from an earlier line, `[x]` is data.
 * Array-of-tables headers (`[[x]]`) are sections too, and jig never owns one.
 *
 * Pure. No IO.
 */

export interface Section {
  /** The table's dotted key, one element per segment, quotes removed; absent for the preamble. */
  readonly path?: readonly string[];
  readonly lines: readonly string[];
}

const HEADER_RE = /^\s*\[(?!\[)(.+?)\]\s*(?:#.*)?$/;
const ARRAY_HEADER_RE = /^\s*\[\[(.+?)\]\]\s*(?:#.*)?$/;

/** A dotted key's segments: bare, "basic" or 'literal', whitespace around dots allowed. */
export function keyPath(key: string): readonly string[] | undefined {
  const forms: readonly { readonly re: RegExp; readonly value: (m: RegExpExecArray) => string }[] =
    [
      { re: /^"((?:[^"\\]|\\.)*)"/, value: (m) => m[1]?.replace(/\\(.)/g, "$1") ?? "" },
      { re: /^'([^']*)'/, value: (m) => m[1] ?? "" },
      { re: /^[A-Za-z0-9_-]+/, value: (m) => m[0] },
    ];
  const segments: string[] = [];
  let rest = key.trim();
  while (rest !== "") {
    const hit = forms
      .map((form) => ({ form, match: form.re.exec(rest) }))
      .find((candidate) => candidate.match !== null);
    if (hit === undefined || hit.match === null) return undefined;
    segments.push(hit.form.value(hit.match));
    rest = rest.slice(hit.match[0].length).trim();
    if (rest === "") break;
    if (!rest.startsWith(".")) return undefined;
    rest = rest.slice(1).trim();
  }
  return segments;
}

/** Where a scan stands at the end of a line: inside a multi-line string, and how deep in brackets. */
export interface ScanState {
  readonly string?: '"""' | "'''";
  readonly depth: number;
}

export const CLEAN: ScanState = { depth: 0 };

/**
 * Advance the scan over one line of key/value text: strings (basic with
 * escapes, literal, and both multi-line forms), comments, and the brackets
 * of arrays and inline tables. Enough to know whether the next line starts
 * a new statement; it is not a validator.
 */
export function scanLine(line: string, state: ScanState): ScanState {
  let string = state.string;
  let depth = state.depth;
  let i = 0;
  while (i < line.length) {
    if (string !== undefined) {
      const close = line.indexOf(string, i);
      if (string === '"""') {
        // an escaped quote does not close a basic multi-line string
        let at = close;
        while (at > 0 && line[at - 1] === "\\") at = line.indexOf(string, at + 1);
        if (at === -1) return { string, depth };
        i = at + 3;
      } else {
        if (close === -1) return { string, depth };
        i = close + 3;
      }
      string = undefined;
      continue;
    }
    const rest = line.slice(i);
    if (rest.startsWith('"""') || rest.startsWith("'''")) {
      string = rest.slice(0, 3) as '"""' | "'''";
      i += 3;
      continue;
    }
    const char = line[i];
    if (char === "#") break;
    if (char === '"') {
      i += 1;
      while (i < line.length && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (char === "'") {
      const close = line.indexOf("'", i + 1);
      i = close === -1 ? line.length : close + 1;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth = Math.max(0, depth - 1);
    i += 1;
  }
  return string === undefined ? { depth } : { string, depth };
}

function isClean(state: ScanState): boolean {
  return state.string === undefined && state.depth === 0;
}

export function parseSections(text: string): readonly Section[] {
  const sections: { path?: readonly string[]; lines: string[] }[] = [{ lines: [] }];
  let state = CLEAN;
  for (const line of text.split("\n")) {
    if (isClean(state)) {
      const array = ARRAY_HEADER_RE.exec(line);
      const header = array === null ? HEADER_RE.exec(line) : null;
      const key = array?.[1] ?? header?.[1];
      const path = key === undefined ? undefined : keyPath(key);
      if (path !== undefined) {
        sections.push({ path: array === null ? path : ["[[array]]", ...path], lines: [line] });
        continue;
      }
    }
    sections[sections.length - 1]?.lines.push(line);
    state = scanLine(line, state);
  }
  return sections;
}

export function joinSections(sections: readonly Section[]): string {
  return sections
    .filter((section) => section.lines.length > 0)
    .map((section) => section.lines.join("\n"))
    .join("\n");
}

/**
 * A section's lines without the comments and blank lines that trail it.
 * Those belong to whatever follows: a comment written above a table stays
 * with that table when the section before it is removed.
 */
export function trailingNotes(section: Section): readonly string[] {
  const lines = section.lines;
  let end = lines.length;
  while (end > (section.path === undefined ? 0 : 1)) {
    const trimmed = (lines[end - 1] ?? "").trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
    end -= 1;
  }
  return lines.slice(end);
}

/**
 * The sections with `drop` removed. A removed section's trailing comments
 * and blank lines are kept, attached to the section before it, so the note
 * above the next table survives.
 */
export function removeSections(
  sections: readonly Section[],
  drop: (section: Section) => boolean,
): readonly Section[] {
  const out: { path?: readonly string[]; lines: string[] }[] = [];
  for (const section of sections) {
    if (!drop(section)) {
      out.push({ ...section, lines: [...section.lines] });
      continue;
    }
    const notes = trailingNotes(section);
    const previous = out[out.length - 1];
    if (previous === undefined) out.push({ lines: [...notes] });
    else previous.lines.push(...notes);
  }
  return out;
}

function keyRe(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
}

/**
 * Split a section's lines into one key's statement (however many lines its
 * value spans) and everything else. `key` is matched at the start of a
 * statement, outside any multi-line value.
 */
function splitKey(
  section: Section,
  key: string,
): { readonly rest: readonly string[]; readonly statement: readonly string[] } {
  const re = keyRe(key);
  const rest: string[] = [];
  const statement: string[] = [];
  let state = CLEAN;
  let inside = false;
  section.lines.forEach((line, index) => {
    const header = index === 0 && section.path !== undefined;
    if (!header && isClean(state) && re.test(line)) inside = true;
    const next = header ? state : scanLine(line, state);
    (inside ? statement : rest).push(line);
    if (inside && isClean(next)) inside = false;
    state = next;
  });
  return { rest, statement };
}

/** A section without one key's statement, whatever lines its value spans. */
export function withoutKey(section: Section, key: string): Section {
  return { ...section, lines: [...splitKey(section, key).rest] };
}

/** One key's whole statement in a section; nothing if absent. */
export function keyStatement(section: Section, key: string): string | undefined {
  const { statement } = splitKey(section, key);
  return statement.length === 0 ? undefined : statement.join("\n");
}

/** Does the section declare any key, beyond its header, blank lines and comments? */
export function hasKeys(section: Section): boolean {
  return section.lines.slice(section.path === undefined ? 0 : 1).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

/** The keys a section assigns at its top level: the first segment of each statement's key. */
export function topKeys(section: Section): readonly string[] {
  const keys: string[] = [];
  let state = CLEAN;
  section.lines.forEach((line, index) => {
    if (index === 0 && section.path !== undefined) return;
    if (isClean(state)) {
      const match = /^\s*((?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+))\s*[.=]/.exec(line);
      const first = match === null ? undefined : keyPath(match[1] ?? "")?.[0];
      if (first !== undefined) keys.push(first);
    }
    state = scanLine(line, state);
  });
  return keys;
}

/** Is `path` equal to `prefix`, or a sub-table of it? */
export function under(path: readonly string[] | undefined, prefix: readonly string[]): boolean {
  return (
    path !== undefined &&
    path.length >= prefix.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

/** Is `path` exactly `target`? */
export function isPath(path: readonly string[] | undefined, target: readonly string[]): boolean {
  return path?.length === target.length && under(path, target);
}

/** A section's text without its trailing blank lines, ending in one newline. */
export function sectionText(section: Section): string {
  const lines = [...section.lines];
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

/**
 * The text without the given marker comment lines. Only whole lines outside
 * a multi-line value are markers; the same text inside a string is data.
 */
export function withoutLines(text: string, exact: readonly string[]): string {
  const drop = new Set(exact);
  const out: string[] = [];
  let state = CLEAN;
  for (const line of text.split("\n")) {
    if (!(isClean(state) && drop.has(line.trim()))) out.push(line);
    state = scanLine(line, state);
  }
  return out.join("\n");
}

/** Text with no trailing whitespace. Blank lines inside the file are the file's own. */
export function tidy(text: string): string {
  return text.replace(/\s+$/, "");
}
