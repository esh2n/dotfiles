/**
 * Ports the box use-cases need. Two things separate them from the rest of
 * jig's ports: `sbx.attach` hands the terminal over (so it returns an exit
 * code and nothing else), and `kit.write` materializes a directory that only
 * exists for one launch. Kept out of `domain/ports.ts` because no other
 * use-case has any business spawning sbx.
 */

import type { CommandResult } from "../../domain/ports";

export interface SbxRunner {
  /** Captured: stdout/stderr come back, the terminal is untouched. */
  run(args: readonly string[]): Promise<CommandResult>;
  /** Interactive: stdio is inherited and the caller gets only the exit code. */
  attach(args: readonly string[]): Promise<number>;
}

/** jig's own source and config, as it will be laid down inside the box. */
export interface JigSource {
  /** Relative path -> content: `package.json`, `bun.lock`, `tsconfig.json`, `src/**`. */
  readonly files: Readonly<Record<string, string>>;
  /** The guard policy JSON, verbatim. */
  readonly guardRules: string;
  /** What the agent is told about working inside a box. */
  readonly instructions: string;
}

export interface SourceReader {
  read(): Promise<JigSource>;
}

export interface KitWriter {
  /** Writes the rendered kit and returns the directory sbx should be pointed at. */
  write(name: string, files: Readonly<Record<string, string>>): Promise<string>;
}

export interface GitRunner {
  /** Repository root containing `cwd`, or `undefined` when it is not a repository. */
  toplevel(cwd: string): Promise<string | undefined>;
  branch(cwd: string): Promise<string>;
  run(args: readonly string[], cwd: string): Promise<CommandResult>;
}

export interface BoxPorts {
  readonly sbx: SbxRunner;
  readonly kit: KitWriter;
  readonly source: SourceReader;
  readonly git: GitRunner;
}

/** What every box use-case returns: lines to print, and the process exit code. */
export interface BoxResult {
  readonly lines: readonly string[];
  readonly code: number;
}
