/**
 * A skill's findings rule, read from `<root>/<name>/SKILL.md` — the directory Claude Code
 * itself loads skills from, so the rule checked is the rule of the skill that ran.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FindingsRule, findingsRuleOf } from "../../domain/hooks/findings-check";

/** A plain skill name; a plugin's `pack:name` or anything with a path in it has no file here. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** The rule, or `undefined` for a skill that declares none or has no SKILL.md under `root`. */
export function findingsRuleFor(root: string, name: string): FindingsRule | undefined {
  if (!NAME.test(name)) return undefined;
  let text: string;
  try {
    text = readFileSync(join(root, name, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  return front === undefined ? undefined : findingsRuleOf(front);
}
