/**
 * Planning one symlink destination under `~/.claude` (milestone 2 of the
 * generator): `CLAUDE.md`, and each entry of the managed `skills/`, `agents/`
 * and `rules/` directories. What is at the path decides what `--write` does
 * to it, and the dry-run prints exactly that.
 *
 * The one rule with teeth: user content is never deleted. A regular file or
 * a real directory where a link should go is renamed aside, not removed, and
 * the new name carries a timestamp so two applies never collide. A symlink is
 * replaced — it is a pointer, and the thing it pointed at is untouched
 * (today's `~/.claude/{skills,rules,agents}` point at yoki-switch's
 * `.<x>-merged` staging directories, which stay where they are).
 *
 * Pure. The caller inspects the path and hands over what it found.
 */

/** What `lstat` says is at a path. `target` is `readlink`'s answer, verbatim. */
export type PathState =
  | { readonly kind: "missing" }
  | { readonly kind: "file" }
  | { readonly kind: "dir" }
  | { readonly kind: "symlink"; readonly target: string };

/**
 * - `ok`: already a symlink to exactly the planned target (string equality —
 *   `AGENTS.md` and `./AGENTS.md` are different links).
 * - `create`: nothing there.
 * - `replace`: a symlink elsewhere; unlink, then link.
 * - `backup-then-create`: a file or a real directory; rename to
 *   `<path>.pre-jig.<stamp>`, then link.
 */
export type LinkState = "ok" | "create" | "replace" | "backup-then-create";

export interface LinkPlan {
  readonly path: string;
  readonly target: string;
  readonly state: LinkState;
  /** For `replace`: where the existing link pointed. */
  readonly previousTarget?: string;
}

export function planLink(path: string, target: string, current: PathState): LinkPlan {
  switch (current.kind) {
    case "missing":
      return { path, target, state: "create" };
    case "symlink":
      return current.target === target
        ? { path, target, state: "ok" }
        : { path, target, state: "replace", previousTarget: current.target };
    case "file":
    case "dir":
      return { path, target, state: "backup-then-create" };
  }
}

/**
 * The managed directories themselves (`skills/`, `agents/`, `rules/`) must be
 * real directories: `create` when missing, `ok` when it is one, `replace`
 * when a symlink stands in (the link goes, the target stays),
 * `backup-then-create` when a file does.
 */
export function planDirectory(path: string, current: PathState): LinkPlan {
  switch (current.kind) {
    case "dir":
      return { path, target: "(directory)", state: "ok" };
    case "missing":
      return { path, target: "(directory)", state: "create" };
    case "symlink":
      return { path, target: "(directory)", state: "replace", previousTarget: current.target };
    case "file":
      return { path, target: "(directory)", state: "backup-then-create" };
  }
}

/**
 * `<path>.pre-jig.<YYYYMMDD-HHMMSS>`, in UTC so the name means the same thing
 * on every machine that reads the directory. The clock comes from the ports.
 */
export function backupPath(path: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${path}.pre-jig.${date}-${time}`;
}
