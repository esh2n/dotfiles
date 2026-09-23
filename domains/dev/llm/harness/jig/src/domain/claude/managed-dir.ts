/**
 * A directory jig manages as a set of links: a real directory at the
 * destination, one symlink per planned entry, each pointing at
 * `<sourceDir>/<name>`. Three destinations under `~/.claude` have this shape —
 * `skills/`, `agents/` and `rules/` — and they share it for one reason: the
 * destination directory is not jig's alone. Claude Code writes its own
 * entries into `~/.claude/skills/` (the `synced/` tree of skills from the
 * claude.ai account, with a `.bucket-<id>` marker beside it), a user drops a
 * rule file into `rules/`, and a single symlink from the directory into the
 * harness would send all of that into git sources. A directory of links
 * keeps jig's entries and everyone else's side by side.
 *
 * Reconciliation is Stow-like and stays inside what jig made: a link that is
 * no longer planned is removed only when it points under the source
 * directory; anything else — a user's own file, a link elsewhere, a real
 * directory the harness keeps — is reported and left alone.
 *
 * Pure. The caller lists both directories and hands over what it found; the
 * per-destination selection (which source entries get a link, and why the
 * rest do not) lives beside it in `rules-dir.ts`, `skills-dir.ts` and
 * `agents-dir.ts`.
 */

import { type LinkPlan, type PathState, planLink } from "./links";

/** Which source entries get a link, and the ones that do not, each with its reason — so the dry-run can say so. */
export interface ManagedSelection {
  /** Entry names to link, sorted. */
  readonly linked: readonly string[];
  readonly excluded: readonly { readonly name: string; readonly reason: string }[];
}

/** One entry of the destination directory, as `lstat` sees it. */
export interface ManagedDirEntry {
  readonly name: string;
  readonly state: PathState;
}

export type ManagedEntryAction =
  /** A planned link, with what `--write` does to the path. */
  | { readonly kind: "link"; readonly name: string; readonly plan: LinkPlan }
  /** A link jig made earlier that points under the source directory but is no longer planned: removed. */
  | {
      readonly kind: "stale";
      readonly name: string;
      readonly path: string;
      readonly target: string;
    }
  /** Anything else: not jig's, left alone, reported. */
  | {
      readonly kind: "foreign";
      readonly name: string;
      readonly path: string;
      readonly what: string;
    };

export interface ReconcileManagedDirInput {
  /** Destination directory, e.g. `~/.claude/skills`. */
  readonly dir: string;
  /** Source directory, e.g. `<harness>/skills`. Links point under it; a stale link is one that does. */
  readonly sourceDir: string;
  /** Entry names to link: `<dir>/<name>` → `<sourceDir>/<name>`. */
  readonly planned: readonly string[];
  /** The destination's current entries; `[]` when it does not exist yet. */
  readonly entries: readonly ManagedDirEntry[];
}

/** Planned links first (in plan order), then stale links, then foreign entries, each group sorted by name. */
export function reconcileManagedDir(
  input: ReconcileManagedDirInput,
): readonly ManagedEntryAction[] {
  const byName = new Map(input.entries.map((entry) => [entry.name, entry.state]));
  const actions: ManagedEntryAction[] = [];

  for (const name of input.planned) {
    const path = `${input.dir}/${name}`;
    const target = `${input.sourceDir}/${name}`;
    actions.push({
      kind: "link",
      name,
      plan: planLink(path, target, byName.get(name) ?? { kind: "missing" }),
    });
  }

  const plannedSet = new Set(input.planned);
  const rest = [...input.entries]
    .filter((entry) => !plannedSet.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stale: ManagedEntryAction[] = [];
  const foreign: ManagedEntryAction[] = [];
  for (const entry of rest) {
    const path = `${input.dir}/${entry.name}`;
    if (entry.state.kind === "symlink" && entry.state.target.startsWith(`${input.sourceDir}/`)) {
      stale.push({ kind: "stale", name: entry.name, path, target: entry.state.target });
    } else {
      foreign.push({
        kind: "foreign",
        name: entry.name,
        path,
        what: describePathState(entry.state),
      });
    }
  }
  return [...actions, ...stale, ...foreign];
}

/** What stands at a path, in the words the dry-run uses. */
export function describePathState(state: PathState): string {
  switch (state.kind) {
    case "symlink":
      return `a symlink → ${state.target}`;
    case "dir":
      return "a directory";
    case "file":
      return "a regular file";
    case "missing":
      return "missing";
  }
}
