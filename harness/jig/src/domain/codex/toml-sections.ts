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
 * the lines before the first header are the preamble. Array-of-tables
 * headers (`[[x]]`) are sections too, and jig never owns one.
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
  const segments: string[] = [];
  let rest = key.trim();
  while (rest !== "") {
    let match: RegExpExecArray | null;
    if ((match = /^"((?:[^"\\]|\\.)*)"/.exec(rest)) !== null) {
      segments.push(match[1]?.replace(/\\(.)/g, "$1") ?? "");
    } else if ((match = /^'([^']*)'/.exec(rest)) !== null) {
      segments.push(match[1] ?? "");
    } else if ((match = /^[A-Za-z0-9_-]+/.exec(rest)) !== null) {
      segments.push(match[0]);
    } else {
      return undefined;
    }
    rest = rest.slice(match[0].length).trim();
    if (rest === "") break;
    if (!rest.startsWith(".")) return undefined;
    rest = rest.slice(1).trim();
  }
  return segments;
}

export function parseSections(text: string): readonly Section[] {
  const sections: { path?: readonly string[]; lines: string[] }[] = [{ lines: [] }];
  for (const line of text.split("\n")) {
    const array = ARRAY_HEADER_RE.exec(line);
    const header = array === null ? HEADER_RE.exec(line) : null;
    const key = array?.[1] ?? header?.[1];
    const path = key === undefined ? undefined : keyPath(key);
    if (path !== undefined) {
      sections.push({ path: array === null ? path : ["[[array]]", ...path], lines: [line] });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }
  return sections;
}

export function joinSections(sections: readonly Section[]): string {
  return sections
    .filter((section) => section.lines.length > 0)
    .map((section) => section.lines.join("\n"))
    .join("\n");
}

/** Does the section declare any key, beyond its header, blank lines and comments? */
export function hasKeys(section: Section): boolean {
  return section.lines.slice(section.path === undefined ? 0 : 1).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

/** Is `path` equal to `prefix`, or a sub-table of it? */
export function under(path: readonly string[] | undefined, prefix: readonly string[]): boolean {
  return (
    path !== undefined &&
    path.length >= prefix.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

/** A section's text without its trailing blank lines, ending in one newline. */
export function sectionText(section: Section): string {
  const lines = [...section.lines];
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

/** The text without the given comment lines, wherever they are. */
export function withoutLines(text: string, exact: readonly string[]): string {
  const drop = new Set(exact);
  return text
    .split("\n")
    .filter((line) => !drop.has(line.trim()))
    .join("\n");
}

/** Text with runs of blank lines collapsed to one and no trailing whitespace. */
export function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}
