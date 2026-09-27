/**
 * The Swarm's state as a list of workers, and every change to it as a pure
 * function returning a new list (AGENTS.md: immutable updates). The app layer
 * holds the one current list and swaps it; nothing here runs a process or
 * reads a clock — `now` is always passed in.
 */

import type { SwarmConfig } from "./config";
import { scopesOverlap } from "./scope";
import {
  NO_USAGE,
  type Status,
  type Tier,
  type Usage,
  type Worker,
  type WorkerSpec,
  isFinished,
} from "./types";

export type Workers = readonly Worker[];

function update(workers: Workers, name: string, change: (w: Worker) => Worker): Workers {
  return workers.map((w) => (w.spec.name === name ? change(w) : w));
}

/** New workers of one `start` call, all queued. */
export function enqueue(
  workers: Workers,
  specs: readonly WorkerSpec[],
  batch: number,
  now: number,
): Workers {
  return [
    ...workers,
    ...specs.map(
      (spec): Worker => ({
        spec,
        batch,
        status: "queued",
        queuedAt: now,
        turns: 0,
        toolCalls: 0,
        usage: NO_USAGE,
        delivered: false,
      }),
    ),
  ];
}

/** A worker writing into the shared checkout (an isolated one has its own). */
function writesShared(w: Worker): boolean {
  return !w.spec.isolated;
}

/**
 * The queued workers that may start now, in queue order. A worker waits
 * while its tier is at its limit, or while a running or earlier-queued
 * worker shares its files (earlier ones keep their place: a later worker
 * never jumps into a scope someone is already waiting for).
 */
export function runnable(workers: Workers, config: SwarmConfig): readonly string[] {
  const running: Record<Tier, number> = { main: 0, complex: 0, deterministic: 0 };
  const holders: Worker[] = [];
  for (const w of workers) {
    if (w.status === "working") {
      running[w.spec.tier] += 1;
      if (writesShared(w)) holders.push(w);
    }
  }
  const start: string[] = [];
  const waiting: Worker[] = [];
  for (const w of workers) {
    if (w.status !== "queued") continue;
    const blockedByScope =
      writesShared(w) &&
      [...holders, ...waiting].some(
        (other) => writesShared(other) && scopesOverlap(w.spec.files, other.spec.files),
      );
    if (running[w.spec.tier] < config.maxConcurrent[w.spec.tier] && !blockedByScope) {
      start.push(w.spec.name);
      running[w.spec.tier] += 1;
      if (writesShared(w)) holders.push(w);
    } else {
      waiting.push(w);
    }
  }
  return start;
}

export function markStarted(workers: Workers, name: string, now: number): Workers {
  return update(workers, name, (w) => ({
    ...w,
    status: "working",
    startedAt: now,
    lastEventAt: now,
  }));
}

/** What one decoded event from a worker's stream changes. */
export interface WorkerProgress {
  readonly model?: string;
  readonly turn?: boolean;
  readonly toolCall?: boolean;
  /** Totals so far (the harnesses report running totals, not deltas). */
  readonly usage?: Usage;
  readonly text?: string;
}

export function recordProgress(
  workers: Workers,
  name: string,
  progress: WorkerProgress,
  now: number,
): Workers {
  return update(workers, name, (w) => ({
    ...w,
    lastEventAt: now,
    ...(progress.model === undefined ? {} : { model: progress.model }),
    turns: w.turns + (progress.turn === true ? 1 : 0),
    toolCalls: w.toolCalls + (progress.toolCall === true ? 1 : 0),
    ...(progress.usage === undefined ? {} : { usage: progress.usage }),
    ...(progress.text === undefined ? {} : { result: progress.text }),
  }));
}

/** The process ended. `error` set: it failed. An isolated worker that succeeded waits for a merge. */
export function markFinished(
  workers: Workers,
  name: string,
  outcome: { readonly error?: string; readonly result?: string },
  now: number,
): Workers {
  return update(workers, name, (w) => {
    if (w.status !== "working") return w;
    const failed = outcome.error !== undefined;
    const status: Status = failed ? "failed" : w.spec.isolated ? "held" : "unread";
    return {
      ...w,
      status,
      endedAt: now,
      lastEventAt: now,
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      ...(failed ? { note: outcome.error } : w.spec.isolated ? { note: "合流待ち" } : {}),
    };
  });
}

/** `cancel`: a queued worker never starts; a working one is marked, its process is the app's to stop. */
export function markCancelled(
  workers: Workers,
  names: readonly string[] | "all",
  now: number,
): Workers {
  return workers.map((w) =>
    (names === "all" || names.includes(w.spec.name)) && !isFinished(w.status)
      ? { ...w, status: "cancelled", endedAt: now, note: "止めた" }
      : w,
  );
}

/**
 * The workers whose outcome should reach the parent now, or none. A batch is
 * delivered once, when all of it has finished — or at once when one of it
 * failed, so a failure is never left waiting behind slow siblings. One
 * message per batch keeps the parent from being woken once per worker
 * (omp #13096).
 */
export function dueForDelivery(workers: Workers): readonly Worker[] {
  const batches = new Set(
    workers.filter((w) => !w.delivered && isFinished(w.status)).map((w) => w.batch),
  );
  const due: Worker[] = [];
  for (const batch of batches) {
    const members = workers.filter((w) => w.batch === batch);
    const allFinished = members.every((w) => isFinished(w.status));
    const failedNow = members.some((w) => w.status === "failed" && !w.delivered);
    if (allFinished || failedNow) {
      due.push(...members.filter((w) => isFinished(w.status) && !w.delivered));
    }
  }
  return due;
}

/** After delivery: the result is read (`unread` → `done`); `held` and `failed` keep saying so. */
export function markDelivered(workers: Workers, names: readonly string[]): Workers {
  return workers.map((w) =>
    names.includes(w.spec.name)
      ? { ...w, delivered: true, ...(w.status === "unread" ? { status: "done" as const } : {}) }
      : w,
  );
}

/** `results`: the parent read these; unread ones become done. */
export function markRead(workers: Workers, names: readonly string[]): Workers {
  return markDelivered(workers, names);
}
