/**
 * `~/.claude/scripts/`: a managed directory of links (`managed-dir.ts`), one
 * per regular file of `llm/harness/scripts/` —
 * `~/.claude/scripts/<name>` → `<harness>/scripts/<name>`.
 *
 * Milestone 4. The directory holds the scripts `settings.json` names by
 * path — today `statusLine.command: "~/.claude/scripts/statusline.sh"` — so
 * the destination path is fixed by that reference and the link keeps it
 * valid while the source moves from yoki's `personal/scripts/` into the
 * flat tree. Same shape as `agents/`: a real directory, one link per entry,
 * anything that is not jig's reported and left alone.
 *
 * A script is a regular file. The directory's own `README.md`, a
 * subdirectory, or a symlink at the top of the tree gets no link.
 *
 * Pure. The caller lists the source directory and hands over what it found;
 * a source directory that does not exist yet is the caller's report, not a
 * selection.
 */

import type { PathState } from "./links";
import type { ManagedSelection } from "./managed-dir";

/** One entry of `<harness>/scripts/`, as `lstat` sees it. */
export interface ScriptCandidate {
  readonly name: string;
  readonly state: PathState;
}

/** Which entries of `scripts/` get a link: the regular files, README excluded. */
export function selectScriptFiles(candidates: readonly ScriptCandidate[]): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => compare(a.name, b.name))) {
    const reason = skipReason(candidate);
    if (reason === undefined) linked.push(candidate.name);
    else excluded.push({ name: candidate.name, reason });
  }
  return { linked, excluded };
}

const README_RE = /^readme\.md$/i;

function skipReason(candidate: ScriptCandidate): string | undefined {
  if (README_RE.test(candidate.name)) return "the directory's README, not a script";
  switch (candidate.state.kind) {
    case "file":
      return undefined;
    case "dir":
      return "a directory, not a script file";
    case "symlink":
      return "a symlink, not a regular file";
    case "missing":
      return "vanished between listing and inspection";
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
