/**
 * Ports the `applyTiers` use-case needs from the outside world: reading a
 * destination file, writing one atomically, hashing, the hand-edit-detection
 * manifest, the provenance sidecar, and the clock. Kept separate from
 * `domain/ports.ts`'s `FileSystem` (no rename/mkdir there) rather than
 * widening that interface for every other use-case that doesn't need them.
 */

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
 * What the Claude Code target needs on top of `ApplyPorts`: it renders one
 * line per accepted decision note, and the set of notes is whatever is in the
 * directory — not a list anyone maintains by hand.
 */
export interface ClaudeApplyPorts extends ApplyPorts {
  /** File names only, unsorted. A missing or unreadable directory is `[]`, not a throw. */
  listDir(path: string): Promise<readonly string[]>;
}
