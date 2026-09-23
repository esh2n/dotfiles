/**
 * `~/.claude/agents/`: a managed directory of links (`managed-dir.ts`), one
 * per agent definition of `llm/harness/agents/` —
 * `~/.claude/agents/<name>.md` → `<harness>/agents/<name>.md`.
 *
 * Same shape as `skills/`, for the same reason and for symmetry: the
 * destination directory stays a real directory the harness or the user may
 * put their own entries in, and those entries are reported and left alone
 * rather than routed into git sources through one symlink to the tree.
 *
 * An agent definition is a regular `*.md` file. Anything else at the top of
 * the tree gets no link.
 *
 * Pure. The caller lists the source directory and hands over what it found.
 */

import type { PathState } from "./links";
import type { ManagedSelection } from "./managed-dir";

/** One entry of `<harness>/agents/`, as `lstat` sees it. */
export interface AgentCandidate {
  readonly name: string;
  readonly state: PathState;
}

/** Which entries of `agents/` get a link: the regular `*.md` files. */
export function selectAgentFiles(candidates: readonly AgentCandidate[]): ManagedSelection {
  const linked: string[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => compare(a.name, b.name))) {
    const reason = skipReason(candidate);
    if (reason === undefined) linked.push(candidate.name);
    else excluded.push({ name: candidate.name, reason });
  }
  return { linked, excluded };
}

function skipReason(candidate: AgentCandidate): string | undefined {
  if (!candidate.name.endsWith(".md")) return "not a *.md file";
  switch (candidate.state.kind) {
    case "file":
      return undefined;
    case "dir":
      return "a directory, not a *.md agent definition";
    case "symlink":
      return "a symlink, not a regular *.md file";
    case "missing":
      return "vanished between listing and inspection";
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
