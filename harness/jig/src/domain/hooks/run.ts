/**
 * The shape of "run one external command" that the formatter and the gate
 * depend on — a port, not an implementation.
 *
 * It is separate from `domain/ports.ts`'s `ProcessRunner` for one reason that
 * matters to both callers: `missing`. A formatter that is not installed and a
 * formatter that rejected the file are different events — the first is a skip,
 * the second could be worth reporting — and a bare exit code cannot tell them
 * apart. Same for the gate: a repository whose `tsc` is not installed must
 * still be able to finish a turn.
 *
 * The adapter is `infra/proc/exec-file.ts`.
 */

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The binary was not on PATH — "not installed", not "failed". */
  readonly missing: boolean;
}

export type Runner = (
  bin: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    /** Variables removed from the inherited environment for this one command. */
    readonly unsetEnv?: readonly string[];
  },
) => Promise<RunResult>;
