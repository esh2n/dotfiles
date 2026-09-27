/**
 * What the Swarm needs from the outside: a way to start a worker process and
 * read its output line by line, a place to keep logs, and a clock. The
 * implementations are in `infra/swarm/`; tests pass fakes.
 */

import type { DecodedEvent } from "../../domain/swarm/decode";

/** A running worker process. */
export interface WorkerProcess {
  /** Stop it (SIGTERM, then SIGKILL after a grace period). Idempotent. */
  kill(): void;
}

export interface SpawnOptions {
  readonly cwd: string;
  /** Added to this process's environment. */
  readonly env: Readonly<Record<string, string>>;
  /** Each complete stdout line, in order. */
  readonly onLine: (line: string) => void;
  /** Once, when the process has exited: its code (null when killed) and the tail of stderr. */
  readonly onExit: (code: number | null, stderrTail: string) => void;
}

export type Spawn = (bin: string, args: readonly string[], options: SpawnOptions) => WorkerProcess;

/** One line of a worker's event stream, decoded (`domain/swarm/decode.ts`). */
export type WorkerEvent = DecodedEvent;

/** How to read one stdout line; pi and omp share `decodeWorkerLine`, tests pass their own. */
export type Decode = (line: string) => readonly WorkerEvent[];

/** Append-only logs under the session's state directory. */
export interface SwarmLog {
  /** One line of a worker's raw stream. */
  raw(name: string, line: string): void;
  /** The worker's final answer in full; returns where it was written. */
  result(name: string, text: string): string;
  /** A state change, for the record. */
  event(entry: Readonly<Record<string, unknown>>): void;
}

/** How to run one worker on this harness. */
export interface HarnessCommand {
  readonly bin: string;
  args(input: {
    readonly task: string;
    readonly tier: string;
    readonly effort?: string;
  }): readonly string[];
  /** Extra environment for a worker of `tier` (the tier holder, the recursion guard). */
  env(tier: string): Readonly<Record<string, string>>;
}
