/**
 * What `jig retire yoki` needs from the outside world: the read-only verbs
 * the apply targets have (`inspect`, `listDir`, `readFile`), the atomic
 * write and rename for the two rewritten files, and three removal verbs
 * kept apart on purpose — each refuses anything but the kind of path it is
 * named for, so a classification mistake in the use-case cannot turn into
 * the wrong kind of deletion in the adapter.
 */

import type { PathState } from "../../domain/claude/links";

export interface RetirePorts {
  /** `undefined` when the path doesn't exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Stage-then-rename atomic write. */
  writeAtomic(path: string, content: string): Promise<void>;
  /** File names only, unsorted. A missing or unreadable directory is `[]`. */
  listDir(path: string): Promise<readonly string[]>;
  /** `lstat`-based: a symlink is reported as one, never followed. */
  inspect(path: string): Promise<PathState>;
  rename(from: string, to: string): Promise<void>;
  /** `unlink` a symlink — the link itself. Refuses a regular file or a directory. */
  removeLink(path: string): Promise<void>;
  /** `unlink` a regular file. Refuses a symlink or a directory. */
  removeFile(path: string): Promise<void>;
  /**
   * Remove a directory tree. Refuses one that holds a regular file anywhere
   * inside, unless that file is under a `.yoki/` directory — the one tree
   * whose regular files (yoki's manifests and permission sets) are its own.
   * Symlinks inside are unlinked, never followed.
   */
  removeTree(path: string): Promise<void>;
  now(): Date;
}
