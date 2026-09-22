/**
 * `~/.claude/commands` is retired: commands are skills
 * (`rules/decisions/2026-09-22-commands-are-skills.md` — 「`commands/` は
 * 作らない。元は `skills/` 一本」). What is at the path decides whether jig
 * may remove it:
 *
 * - a symlink (today: → yoki-switch's `.commands-merged`), or a directory
 *   whose entries are all symlinks (the staging directory's own shape) —
 *   pointers only, nothing of the user's: removed on `--write`;
 * - a directory holding any regular file or subdirectory — content that may
 *   be the user's own: left alone and reported as a conflict, because a
 *   command the user wrote by hand is theirs to move into `skills/`.
 *
 * Pure. The caller inspects the path (and its entries when it is a
 * directory) and hands over what it found.
 */

import type { PathState } from "./links";

export type CommandsAction =
  | { readonly kind: "absent" }
  | { readonly kind: "remove"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string };

export function classifyCommands(
  state: PathState,
  entries: readonly { readonly name: string; readonly state: PathState }[],
): CommandsAction {
  switch (state.kind) {
    case "missing":
      return { kind: "absent" };
    case "symlink":
      return { kind: "remove", reason: `a symlink → ${state.target}` };
    case "file":
      return { kind: "conflict", reason: "a regular file, not a directory of commands" };
    case "dir": {
      const kept = entries.filter((entry) => entry.state.kind !== "symlink").map((e) => e.name);
      if (kept.length > 0) {
        return {
          kind: "conflict",
          reason: `a directory with ${kept.length} non-symlink entr${kept.length === 1 ? "y" : "ies"} (${kept.sort().join(", ")}) — move them into skills/ by hand`,
        };
      }
      return {
        kind: "remove",
        reason: `a directory of ${entries.length} symlink${entries.length === 1 ? "" : "s"} and nothing else`,
      };
    }
  }
}
