/**
 * Ports — the capabilities the core (domain / app) needs from the outside world.
 * Interfaces only. Implemented in `infra/`, injected at the composition root
 * (`cli/`). The core depends on these abstractions; nothing here imports infra.
 */

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface Clock {
  now(): Date;
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

/** The full set of ports, assembled once at the composition root. */
export interface Ports {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly fs: FileSystem;
  readonly proc: ProcessRunner;
}
