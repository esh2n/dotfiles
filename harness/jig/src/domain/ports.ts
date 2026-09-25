/**
 * Ports — the capabilities the core (domain / app) needs from the outside world.
 * Interfaces only. Implemented in `infra/`, injected at the composition root
 * (`cli/`). The core depends on these abstractions; nothing here imports infra.
 */

import type { JsonObject } from "./compose/merge";
import type { DecisionProvider } from "./decision/provider";
import type { AuditEntry } from "./policy/audit";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface Clock {
  now(): Date;
}

/** Where guard judgments are recorded, one entry per judgment, append-only. */
export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
}

export interface FileSystem {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string },
  ): Promise<CommandResult>;
}

/** The composed output of one profile, handed to each target for writing. */
export interface ComposedProfile {
  readonly settings: JsonObject;
}

/**
 * A target tool that the composed profile is written for (claude / codex / pi /
 * omp …). One port, one adapter per tool — this is where the old install's
 * 4-way sprawl collapses.
 */
export interface TargetWriter {
  readonly target: string;
  write(profile: ComposedProfile): Promise<void>;
}

/** The full set of ports, assembled once at the composition root. */
export interface Ports {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly fs: FileSystem;
  readonly proc: ProcessRunner;
  /**
   * Where judgments come from. In a harness this is the loopback client of the
   * judgment service; in tests it is a deterministic provider. The core only
   * ever sees this interface, never the model vendor or a credential.
   */
  readonly decision: DecisionProvider;
  /** Where guard judgments are recorded. */
  readonly audit: AuditLog;
}
