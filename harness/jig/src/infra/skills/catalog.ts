import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillCandidate } from "../../domain/skills/candidate";

/**
 * Read a skills directory (the flat farm a harness lists) into router candidates.
 *
 * The router has to offer exactly what the harness would list, so a skill carrying
 * `disable-model-invocation: true` is skipped here too: offering a skill the model
 * cannot invoke would have the router inject instructions the harness then refuses to
 * load, and the user would see a skill fire that the list says is unavailable.
 *
 * `includeHidden` is the one arrangement where that reasoning inverts, and it exists for
 * arm B' of the skill-selection experiment. There, `jig skills hide` sets the field on EVERY
 * routable skill precisely so the harness stops listing them, and the router's injection
 * becomes the only path a skill has to the model. Reading the farm the default way in that
 * arm returns an empty catalog — the router would have nothing to choose from and the arm
 * would measure nothing. The injection still works there because it names the body's path
 * as well as the tool: see the `disable-model-invocation` note in
 * `cli/hooks/user-prompt-submit.ts`, which is the other half of the same arrangement.
 *
 * It is not its own knob: the hook turns it on with the fallback and only with it, so the
 * three parts of arm B' cannot be set to a combination that is none of the arms.
 *
 * Entries are read through, not stat'ed: the farm is symlinks, and a symlink to a
 * directory is neither `isDirectory()` nor absent, so the only honest test of "is
 * there a skill here" is whether its SKILL.md reads.
 */
export interface SkillCatalogOptions {
  /**
   * Offer skills the harness has been told not to list. Only arm B' wants this, and it
   * arrives there from the fallback switch rather than from a flag of its own.
   */
  readonly includeHidden?: boolean;
}

export function parseSkillFile(
  text: string,
  path: string,
  options: SkillCatalogOptions = {},
): SkillCandidate | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return undefined;
  const front = match[1] ?? "";
  if (options.includeHidden !== true && /^disable-model-invocation:\s*true\s*$/m.test(front)) {
    return undefined;
  }

  const fields = parseFrontmatterFields(front);
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || description === undefined || description === "") return undefined;
  const paths = parsePathsField(front);
  return { name, description, path, ...(paths === undefined ? {} : { paths }) };
}

/**
 * The `paths:` globs, in the shapes Claude Code accepts: "a comma-separated string or a YAML
 * list" (https://code.claude.com/docs/en/skills.md, frontmatter reference), plus the flow
 * sequence (`[a, b]`) a YAML list may also be written as.
 *
 * Read off the raw frontmatter rather than from `parseFrontmatterFields`, for two reasons a
 * description does not have: a YAML list leaves the key's own value empty and puts the items
 * on the indented lines after it (which the scalar parser correctly ignores — they are not
 * `key: value`), and a comma-separated value whose first and last characters are quotes is
 * several quoted globs rather than one quoted string, which the scalar unwrapping would
 * mangle into one glob with quotes inside it.
 *
 * Absent and empty are kept distinct on purpose: a skill with no `paths:` applies anywhere,
 * so returning `[]` for it would exclude it from every repository instead of from none.
 */
export function parsePathsField(front: string): readonly string[] | undefined {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((line) => /^paths:/.test(line));
  if (at === -1) return undefined;

  const raw = (/^paths:\s*(.*)$/.exec(lines[at] ?? "")?.[1] ?? "").trim();
  if (raw !== "") {
    const flow = /^\[(.*)\]$/.exec(raw)?.[1];
    return nonEmpty((flow ?? raw).split(",").map((glob) => unquote(glob.trim())));
  }

  const items: string[] = [];
  for (let index = at + 1; index < lines.length; index += 1) {
    const item = /^\s+-\s*(.*)$/.exec(lines[index] ?? "");
    if (item === null) break;
    items.push(unquote((item[1] ?? "").trim()));
  }
  return nonEmpty(items);
}

function nonEmpty(globs: readonly string[]): readonly string[] | undefined {
  const kept = globs.filter((glob) => glob !== "");
  return kept.length === 0 ? undefined : kept;
}

function unquote(value: string): string {
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  return value;
}

/**
 * The frontmatter fields the router needs, in the three shapes a skill description
 * actually takes in this repo: a quoted single line (JSON-escaped when long), an
 * unquoted single line, and a `|` or `>` block. A description that arrives truncated
 * mid-quote would make the router judge a skill by half a sentence, so the shapes are
 * read rather than approximated by splitting on the first colon.
 */
function parseFrontmatterFields(front: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = front.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (entry === null) continue;
    const key = entry[1] ?? "";
    let value = (entry[2] ?? "").trim();

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? "")) {
        index += 1;
        block.push((lines[index] ?? "").trim());
      }
      value = block.join(" ").trim();
    } else if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    }

    fields.set(key, value);
  }

  return fields;
}

/** Every skill the harness would list under `root`, in name order. */
export async function readSkillCatalog(
  root: string,
  options: SkillCatalogOptions = {},
): Promise<readonly SkillCandidate[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry, "SKILL.md");
      try {
        return parseSkillFile(await readFile(path, "utf8"), path, options);
      } catch {
        return undefined;
      }
    }),
  );

  return candidates
    .filter((candidate): candidate is SkillCandidate => candidate !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}
