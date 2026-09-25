/**
 * What `jig retire yoki` decides about one path: what it is, why it is
 * yoki's, and what `--write` does to it. Milestone 4 of the generator that
 * retires `yoki-switch`.
 *
 * The rule with teeth: nothing is removed that does not match its evidence.
 * A regular file where a link was expected, a directory of links that has
 * grown a real file, a block whose end marker is missing — each is a
 * `skip` with the reason, never forced. Everything is classified before
 * anything is removed, so a mismatch anywhere is visible in the dry-run and
 * does not stop the rest.
 *
 * Pure types and the small helpers every classifier shares. The
 * classifiers themselves are in `./classify.ts` (files, links, directories)
 * and `./codex-config.ts` (the two text rewrites).
 */

import type { PathState } from "../claude/links";

export type RetireHarness = "claude" | "codex" | "omp" | "cursor";

export type RetireAction =
  /** `unlink` a symlink — the link itself, never what it points at. */
  | { readonly kind: "remove-link" }
  /** `unlink` a regular file. */
  | { readonly kind: "remove-file" }
  /** Remove a directory tree. The adapter refuses one holding a regular file outside `.yoki/`. */
  | { readonly kind: "remove-tree" }
  /** Rewrite a file atomically after renaming the current one to `backup`. */
  | {
      readonly kind: "rewrite";
      readonly backup: string;
      readonly content: string;
      /** What the rewrite takes out, one line each, for the dry-run. */
      readonly removed: readonly string[];
      /** What the rewrite carries through that a reader might expect to go. */
      readonly carried: readonly string[];
    }
  /** Found, but not as the evidence expects: reported, left alone. */
  | { readonly kind: "skip"; readonly reason: string }
  /** Nothing at the path. */
  | { readonly kind: "absent" };

export interface RetireItem {
  readonly harness: RetireHarness;
  readonly path: string;
  /** What it is, in the dry-run's words. */
  readonly what: string;
  /** Why it is yoki's to remove — the test the path passed, or failed. */
  readonly evidence: string;
  readonly action: RetireAction;
}

/** `<path>.pre-retire.<YYYYMMDD-HHMMSS>`, UTC, as the apply targets' `.pre-jig.` names are. */
export function retireBackupPath(path: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${path}.pre-retire.${date}-${time}`;
}

/** True when `--write` would touch the path. */
export function isRemoval(action: RetireAction): boolean {
  return action.kind !== "skip" && action.kind !== "absent";
}

/** The dry-run's word for an action. */
export function describeAction(action: RetireAction): string {
  switch (action.kind) {
    case "remove-link":
      return "remove link";
    case "remove-file":
      return "remove file";
    case "remove-tree":
      return "remove dir";
    case "rewrite":
      return "rewrite";
    case "skip":
      return "SKIP";
    case "absent":
      return "absent";
  }
}

/** What stands at a path, in the words the dry-run uses. */
export function describeFound(state: PathState): string {
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

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** True when `target` (a `readlink` answer) lies under one of `roots`. A relative target is resolved against `dir`. */
export function linksUnder(target: string, dir: string, roots: readonly string[]): boolean {
  const absolute = target.startsWith("/") ? target : `${dir}/${target}`;
  return roots.some((root) => absolute === root || absolute.startsWith(`${root}/`));
}
