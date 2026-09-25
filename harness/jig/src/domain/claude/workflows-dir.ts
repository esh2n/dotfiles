/**
 * `~/.claude/workflows/`: a managed directory of links (`managed-dir.ts`),
 * one per workflow script of `llm/harness/workflows/` —
 * `~/.claude/workflows/<name>.js` → `<harness>/workflows/<name>.js` — plus
 * one for `lib/` when the source tree has it.
 *
 * Milestone 4. Claude Code's Workflow tool reads `~/.claude/workflows/*.js`
 * (the scripts of `rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`,
 * Consequences: review, research, code-study, stocktake and design-review
 * survive as scripts; preflight and the yoki-graph engine go). Same shape as
 * `agents/`: a real directory, one link per entry, anything that is not
 * jig's reported and left alone.
 *
 * Why `lib/` gets a link: the scripts and their helpers sit side by side in
 * the source tree — `lib/lanes.js` is the canonical copy of the provider-lane
 * helpers. As of 2026-09-23 no script imports it: `review.js`, `research.js`
 * and `design-review.js` each carry the helpers INLINE (review.js:75, "provider-lane
 * helpers (canonical copy: core/workflows/lib/lanes.js)"), and none of the
 * scripts in `claude-profiles/core/workflows/` has an `import` or `require`
 * at all. The link is kept so that a script that does grow a relative
 * `./lib/...` import resolves the same way whether the runner loads the
 * file through the link or through its real path.
 *
 * Pure. The caller lists the source directory and hands over what it found;
 * a source directory that does not exist yet is the caller's report, not a
 * selection.
 */

import type { PathState } from "./links";
import type { ManagedSelection } from "./managed-dir";

/** The helper directory beside the scripts. */
export const WORKFLOWS_LIB_DIR = "lib";

/** One entry of `<harness>/workflows/`, as `lstat` sees it. */
export interface WorkflowCandidate {
  readonly name: string;
  readonly state: PathState;
}

/** Which entries of `workflows/` get a link: the regular `*.js` files, and `lib` when it is a directory. */
export function selectWorkflowEntries(candidates: readonly WorkflowCandidate[]): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => compare(a.name, b.name))) {
    const reason = skipReason(candidate);
    if (reason === undefined) linked.push(candidate.name);
    else excluded.push({ name: candidate.name, reason });
  }
  return { linked, excluded };
}

function skipReason(candidate: WorkflowCandidate): string | undefined {
  if (candidate.name === WORKFLOWS_LIB_DIR) {
    return candidate.state.kind === "dir"
      ? undefined
      : `\`${WORKFLOWS_LIB_DIR}\` is not a directory here`;
  }
  if (!candidate.name.endsWith(".js")) return "not a *.js workflow script";
  switch (candidate.state.kind) {
    case "file":
      return undefined;
    case "dir":
      return "a directory, not a *.js script";
    case "symlink":
      return "a symlink, not a regular *.js file";
    case "missing":
      return "vanished between listing and inspection";
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
