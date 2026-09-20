import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillCandidate } from "../../app/routing/select-skill";

/**
 * Read a skills directory (the flat farm a harness lists) into router candidates.
 *
 * The router has to offer exactly what the harness would list, so a skill carrying
 * `disable-model-invocation: true` is skipped here too: offering a skill the model
 * cannot invoke would have the router inject instructions the harness then refuses to
 * load, and the user would see a skill fire that the list says is unavailable.
 *
 * Entries are read through, not stat'ed: the farm is symlinks, and a symlink to a
 * directory is neither `isDirectory()` nor absent, so the only honest test of "is
 * there a skill here" is whether its SKILL.md reads.
 */
export function parseSkillFile(text: string, path: string): SkillCandidate | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return undefined;
  const front = match[1] ?? "";
  if (/^disable-model-invocation:\s*true\s*$/m.test(front)) return undefined;

  const fields = parseFrontmatterFields(front);
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || description === undefined || description === "") return undefined;
  return { name, description, path };
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
export async function readSkillCatalog(root: string): Promise<readonly SkillCandidate[]> {
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
        return parseSkillFile(await readFile(path, "utf8"), path);
      } catch {
        return undefined;
      }
    }),
  );

  return candidates
    .filter((candidate): candidate is SkillCandidate => candidate !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}
