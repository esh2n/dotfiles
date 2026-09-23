/**
 * Ports the `applyTiers` use-case needs from the outside world: reading a
 * destination file, writing one atomically, hashing, the hand-edit-detection
 * manifest, the provenance sidecar, and the clock. Kept separate from
 * `domain/ports.ts`'s `FileSystem` (no rename/mkdir there) rather than
 * widening that interface for every other use-case that doesn't need them.
 */

import type { PathState } from "../../domain/claude/links";

export interface ProvenanceInfo {
  readonly sourceFile: string;
  readonly sourceSha256: string;
  readonly generatedAt: string;
  readonly jigVersion: string;
}

export interface ApplyPorts {
  /** `undefined` when the path doesn't exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Stage-then-rename atomic write (`<path>.jig-stage` -> `path`). */
  writeAtomic(path: string, content: string): Promise<void>;
  sha256(content: string): string;
  readManifest(): Promise<Readonly<Record<string, string>>>;
  writeManifest(manifest: Readonly<Record<string, string>>): Promise<void>;
  /** Writes `.jig-provenance.json` into `destDir`. */
  writeProvenance(destDir: string, info: ProvenanceInfo): Promise<void>;
  now(): Date;
  readonly jigVersion: string;
}

/**
 * What the Claude Code target needs on top of `ApplyPorts`: directory
 * listings (the set of decision notes, rule directories and common rules is
 * whatever is on disk — not a list anyone maintains by hand), and the handful
 * of filesystem verbs that deliver `~/.claude/{skills,agents,rules,CLAUDE.md}`
 * as symlinks. Each mutating verb is only ever called on a path the domain
 * has already classified (`domain/claude/links.ts` and friends); the adapter
 * does not decide anything.
 */
export interface ClaudeApplyPorts extends ApplyPorts {
  /** File names only, unsorted. A missing or unreadable directory is `[]`, not a throw. */
  listDir(path: string): Promise<readonly string[]>;
  /** `lstat`-based: a symlink is reported as one, with `readlink`'s answer verbatim, never followed. */
  inspect(path: string): Promise<PathState>;
  /** `symlink(2)`: `target` is stored as given (relative stays relative). The path must not exist. */
  symlink(target: string, path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** A symlink (the link itself, never what it points at) or a directory tree. */
  remove(path: string): Promise<void>;
  /** Creates parents as needed; an existing directory is fine. */
  mkdir(path: string): Promise<void>;
}

/**
 * The Codex target delivers the same kinds of things (generated files,
 * directories of links) and needs the same verbs. One interface, two names,
 * so a use-case says which harness it is about.
 */
export type CodexApplyPorts = ClaudeApplyPorts;

/** The omp target: generated files, one link, one directory of links. The same verbs again. */
export type OmpApplyPorts = ClaudeApplyPorts;
