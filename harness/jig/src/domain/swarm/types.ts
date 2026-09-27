/**
 * The Swarm's vocabulary: what the parent asks for (a `WorkerSpec`) and what
 * the extension knows about each worker it runs (a `Worker`).
 *
 * rules/decisions/2026-09-27-swarm-extension.md; plans/2026-09-27-swarm-spec.md.
 * Everything here is data — no clock, no processes, no IO.
 */

export const TIERS = ["main", "complex", "deterministic"] as const;
export type Tier = (typeof TIERS)[number];

/** `--thinking` levels pi and omp both accept. */
export const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * - `queued`: waiting for a free slot of its tier, or for a worker whose
 *   files it shares to finish
 * - `working`: its process runs
 * - `unread`: finished; the parent has not read the result yet
 * - `held`: an isolated worker finished; its branch waits for the owner to merge
 * - `done`: finished and read
 * - `failed`: the process failed or reported an error
 * - `cancelled`: stopped by `cancel` or by the parent session ending
 */
export const STATUSES = [
  "queued",
  "working",
  "unread",
  "held",
  "done",
  "failed",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses a worker never leaves. `unread` and `held` still move on to `done`. */
export function isSettled(status: Status): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/** Finished work: the process is gone, whatever the parent has read. */
export function isFinished(status: Status): boolean {
  return status !== "queued" && status !== "working";
}

/** One item of `swarm start`, validated. */
export interface WorkerSpec {
  /** Unique within the session; also the worktree and branch name when isolated. */
  readonly name: string;
  /** The prompt the worker runs. */
  readonly task: string;
  readonly tier: Tier;
  /** Absent: the tier's own default. */
  readonly effort?: Effort;
  /** Paths or globs the worker may write. Empty: the whole checkout. */
  readonly files: readonly string[];
  readonly isolated: boolean;
}

/** Token and cost totals as the worker's harness reports them. */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** USD; `undefined` while the harness has reported no cost at all. */
  readonly cost: number | undefined;
}

export const NO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: undefined,
};

/** What the extension knows about one worker. Timestamps are epoch ms. */
export interface Worker {
  readonly spec: WorkerSpec;
  /** Which `start` call brought it: results are delivered per batch. */
  readonly batch: number;
  readonly status: Status;
  /** The model the worker's harness reports, once it has said. */
  readonly model?: string;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  /** Last event of any kind from the worker. */
  readonly lastEventAt?: number;
  readonly turns: number;
  readonly toolCalls: number;
  readonly usage: Usage;
  /** The final assistant text, once finished. */
  readonly result?: string;
  /** Why it failed, or why it waits. */
  readonly note?: string;
  /** Its outcome has been sent to the parent (once per worker). */
  readonly delivered: boolean;
}
