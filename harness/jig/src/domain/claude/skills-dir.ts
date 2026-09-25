/**
 * `~/.claude/skills/`: a managed directory of links (`managed-dir.ts`), one
 * per skill directory of `llm/harness/skills/` —
 * `~/.claude/skills/<name>` → `<harness>/skills/<name>`.
 *
 * Why a directory of links and not one link to the tree: Claude Code writes
 * into `~/.claude/skills/` itself. It keeps `synced/<bucket-id>/…` there —
 * skills synced from the claude.ai account — with a `.bucket-<id>` marker
 * file beside it, and updates that tree on its own schedule. One symlink from
 * `~/.claude/skills` into the harness would land those writes in git sources.
 * With one link per skill, `synced/` and the marker are entries that are not
 * jig's: reported, left alone.
 *
 * A skill is a directory holding a `SKILL.md`. `README.md` at the top of the
 * tree, or any directory without one, is not a skill and gets no link.
 *
 * Pure. The caller lists the source directory, checks each entry for its
 * `SKILL.md`, and hands over what it found.
 */

import type { PathState } from "./links";
import type { ManagedSelection } from "./managed-dir";

/** One entry of `<harness>/skills/`, with whether `<entry>/SKILL.md` is a regular file. */
export interface SkillCandidate {
  readonly name: string;
  readonly state: PathState;
  readonly hasSkillMd: boolean;
}

/** Which entries of `skills/` get a link: those that are a directory (or a link to one) with a `SKILL.md` inside. */
export function selectSkillDirs(candidates: readonly SkillCandidate[]): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => compare(a.name, b.name))) {
    const reason = skipReason(candidate);
    if (reason === undefined) linked.push(candidate.name);
    else excluded.push({ name: candidate.name, reason });
  }
  return { linked, excluded };
}

function skipReason(candidate: SkillCandidate): string | undefined {
  switch (candidate.state.kind) {
    case "file":
      return "a file, not a skill directory";
    case "missing":
      return "vanished between listing and inspection";
    case "dir":
    case "symlink":
      return candidate.hasSkillMd ? undefined : "no SKILL.md inside, so not a skill";
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
