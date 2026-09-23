/**
 * `jig skills hide|show` — flip `disable-model-invocation` across a whole skill root.
 *
 * Dry run by default, and the default is the safety mechanism rather than politeness: the
 * root this points at by default is `~/.claude/skills`, whose entries are symlinks into
 * the harness's `skills/` tree, so a write here edits checked-in files. The
 * list printed by a dry run is the review step — see `domain/skills/invocation.ts` for why
 * `show` in particular cannot tell what it is about to unhide.
 *
 * The edit itself is pure text (that same module); this use-case is the walk, the plan and
 * the write, and it reads every file before writing any of them so that a refusal is
 * reported for the whole root rather than discovered halfway through.
 */

import {
  type InvocationEdit,
  type RefusalReason,
  hideFromModel,
  showToModel,
} from "../../domain/skills/invocation";

export type InvocationMode = "hide" | "show";

export interface SkillRootPorts {
  /** Entry names directly under the root, in any order; `[]` when it cannot be read. */
  listEntries(root: string): Promise<readonly string[]>;
  /** `undefined` when the path does not exist or cannot be read. */
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, text: string): Promise<void>;
  /** `join`, injected so the use-case does not import a platform's path rules. */
  join(...parts: readonly string[]): string;
}

export interface SkillPlanEntry {
  readonly name: string;
  readonly path: string;
}

export interface RefusedSkill extends SkillPlanEntry {
  readonly why: RefusalReason;
}

export interface TogglePlan {
  readonly mode: InvocationMode;
  readonly root: string;
  /** The skills whose SKILL.md would change, in name order. */
  readonly changing: readonly SkillPlanEntry[];
  /** Already in the wanted state. */
  readonly unchanged: readonly SkillPlanEntry[];
  /** Left alone, with the reason — never edited, in a dry run or a write. */
  readonly refused: readonly RefusedSkill[];
  /** True when the files were actually written. */
  readonly written: boolean;
}

export interface ToggleOptions {
  readonly write?: boolean;
}

export async function toggleSkillInvocation(
  root: string,
  mode: InvocationMode,
  ports: SkillRootPorts,
  options: ToggleOptions = {},
): Promise<TogglePlan> {
  const edit = mode === "hide" ? hideFromModel : showToModel;
  const entries = [...(await ports.listEntries(root))].sort((left, right) =>
    left.localeCompare(right),
  );

  const changing: (SkillPlanEntry & { readonly text: string })[] = [];
  const unchanged: SkillPlanEntry[] = [];
  const refused: RefusedSkill[] = [];

  for (const name of entries) {
    const path = ports.join(root, name, "SKILL.md");
    // A missing SKILL.md is not a skill and not a failure: the root holds whatever the
    // harness put there, and `readSkillCatalog` reads it the same forgiving way.
    const text = await ports.readFile(path);
    if (text === undefined) continue;

    const result: InvocationEdit = edit(text);
    if (result.kind === "refused") refused.push({ name, path, why: result.why });
    else if (result.kind === "unchanged") unchanged.push({ name, path });
    else changing.push({ name, path, text: result.text });
  }

  const write = options.write === true;
  if (write) {
    for (const entry of changing) await ports.writeFile(entry.path, entry.text);
  }

  return {
    mode,
    root,
    changing: changing.map(({ name, path }) => ({ name, path })),
    unchanged,
    refused,
    written: write && changing.length > 0,
  };
}
