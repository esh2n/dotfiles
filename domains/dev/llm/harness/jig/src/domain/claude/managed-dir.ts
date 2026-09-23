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
 * Two widenings of "what jig made", both opt-in by the caller: a link under a
 * *former* source tree (`formerSourceDirs` — the `claude-profiles/` tree
 * yoki-switch linked from, which the same delivery replaces) and a link the
 * caller found dangling (`ManagedDirEntry.dangling`) are stale too. Both are
 * what the Codex destinations (`~/.agents/skills`, `~/.codex/skills`) hold
 * today; the Claude destinations pass neither and keep the narrow rule.
 *
 * Pure. The caller lists both directories and hands over what it found; the
 * per-destination selection (which source entries get a link, and why the
 * rest do not) lives beside it in `rules-dir.ts`, `skills-dir.ts`,
 * `agents-dir.ts` and `../codex/skills.ts`.
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
  /**
   * For a symlink: true when the caller followed it and found nothing. Left
   * unset by callers that did not look, and then a dangling link is judged
   * by its target alone.
   */
  readonly dangling?: boolean;
}

/** Why a link that is no longer planned is jig's to remove. */
export type StaleReason = "unplanned" | "former-tree" | "dangling";

export type ManagedEntryAction =
  /** A planned link, with what `--write` does to the path. */
  | { readonly kind: "link"; readonly name: string; readonly plan: LinkPlan }
  /** A link jig (or the generator it replaces) made earlier and no longer plans: removed. */
  | {
      readonly kind: "stale";
      readonly name: string;
      readonly path: string;
      readonly target: string;
      readonly reason: StaleReason;
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
  /** Entry names to link: `<dir>/<name>` → `targetOf(name)`, by default `<sourceDir>/<name>`. */
  readonly planned: readonly string[];
  /**
   * Where a planned entry's link points, when not `<sourceDir>/<name>`. The
   * Codex ports link `<name>` → `<sourceDir>/<name>/codex`; the target still
   * lies under the source directory, so the stale rule holds unchanged.
   */
  readonly targetOf?: (name: string) => string;
  /**
   * Trees the previous generator linked from (`claude-profiles/`): a link
   * under one of them is stale, not foreign. Absent means none.
   */
  readonly formerSourceDirs?: readonly string[];
  /** The destination's current entries; `[]` when it does not exist yet. */
  readonly entries: readonly ManagedDirEntry[];
}

/** Planned links first (in plan order), then stale links, then foreign entries, each group sorted by name. */
export function reconcileManagedDir(
  input: ReconcileManagedDirInput,
): readonly ManagedEntryAction[] {
  const byName = new Map(input.entries.map((entry) => [entry.name, entry.state]));
  const targetOf = input.targetOf ?? ((name: string) => `${input.sourceDir}/${name}`);
  const actions: ManagedEntryAction[] = [];

  for (const name of input.planned) {
    const path = `${input.dir}/${name}`;
    actions.push({
      kind: "link",
      name,
      plan: planLink(path, targetOf(name), byName.get(name) ?? { kind: "missing" }),
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
    const reason =
      entry.state.kind === "symlink"
        ? staleReason(entry.state.target, entry.dangling === true, input)
        : undefined;
    if (entry.state.kind === "symlink" && reason !== undefined) {
      stale.push({ kind: "stale", name: entry.name, path, target: entry.state.target, reason });
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

/** The prefix test is the whole test: under the source tree, under a former tree, or leading nowhere. */
function staleReason(
  target: string,
  dangling: boolean,
  input: ReconcileManagedDirInput,
): StaleReason | undefined {
  if (target.startsWith(`${input.sourceDir}/`)) return "unplanned";
  if ((input.formerSourceDirs ?? []).some((dir) => target.startsWith(`${dir}/`))) {
    return "former-tree";
  }
  if (dangling) return "dangling";
  return undefined;
}

/** The dry-run's words for a stale link's reason. */
export function describeStaleReason(reason: StaleReason): string {
  switch (reason) {
    case "unplanned":
      return "stale jig link";
    case "former-tree":
      return "link into the retired tree";
    case "dangling":
      return "dangling link";
  }
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
