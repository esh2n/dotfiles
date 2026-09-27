/**
 * One session's Swarm: it holds the workers, starts whoever may run, reads
 * their streams, and hands finished batches to the parent — the one
 * execution engine rules/decisions/2026-09-27-swarm-extension.md allows.
 *
 * Harness-independent: the adapters (pi, omp) give it how to run a worker
 * (`HarnessCommand`), how to read its stream (`Decode`), and two callbacks —
 * `onChange` to redraw the table and `onDeliver` to put a message in front of
 * the parent. Everything that decides is in `domain/swarm/`; this file only
 * sequences it.
 */

import type { SwarmConfig } from "../../domain/swarm/config";
import { inScope } from "../../domain/swarm/scope";
import { parseSpecs } from "../../domain/swarm/spec";
import {
  type Workers,
  dueForDelivery,
  enqueue,
  markCancelled,
  markDelivered,
  markFinished,
  markStarted,
  recordProgress,
  runnable,
} from "../../domain/swarm/state";
import type { Tier, Worker } from "../../domain/swarm/types";
import type { Decode, HarnessCommand, Spawn, SwarmLog, WorkerProcess } from "./ports";
import { type WorktreeDeps, changedFiles, createWorktree, removeMerged } from "./worktree";

export interface SwarmDeps {
  readonly config: SwarmConfig;
  readonly harness: HarnessCommand;
  readonly decode: Decode;
  readonly spawn: Spawn;
  readonly worktree: WorktreeDeps;
  readonly log: SwarmLog;
  readonly now: () => number;
  /** The checkout's top directory: workers run here unless isolated. */
  readonly root: string;
  /** Names of worktrees earlier sessions' Swarms created here (for cleanup). */
  readonly ownWorktrees?: readonly string[];
  /** What to call a tier's model in the table (the catalog id it points at). */
  readonly modelLabel?: (tier: Tier) => string | undefined;
  readonly onChange: (workers: Workers) => void;
  /** The Swarm's own worktree names changed: keep them for a later session's cleanup. */
  readonly onWorktrees?: (names: readonly string[]) => void;
  readonly onDeliver: (message: string, workers: readonly Worker[]) => void;
}

export type StartResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/** The parent reads English (rules/decisions/2026-09-23-model-facing-english.md). */
function describe(w: Worker, resultChars: number, resultPath?: string): string {
  const head = `- ${w.spec.name} [${w.status}] tier=${w.spec.tier}${w.model === undefined ? "" : ` model=${w.model}`}`;
  const lines = [head];
  if (w.note !== undefined && w.status === "failed") lines.push(`  error: ${w.note}`);
  if (w.status === "held") {
    lines.push(
      `  isolated on branch ${w.spec.name} (.claude/worktrees/${w.spec.name}); the owner decides whether to merge it (git merge --no-ff ${w.spec.name})`,
    );
    if (w.note !== undefined && w.note !== "合流待ち") lines.push(`  note: ${w.note}`);
  }
  if (w.result !== undefined && w.result !== "") {
    const text =
      w.result.length > resultChars
        ? `${w.result.slice(0, resultChars)}\n  …(truncated)`
        : w.result;
    lines.push(`  result:\n${text.replace(/^/gm, "    ")}`);
  }
  if (resultPath !== undefined) lines.push(`  full output: ${resultPath}`);
  return lines.join("\n");
}

export class Swarm {
  private workers: Workers = [];
  private batch = 0;
  private readonly procs = new Map<string, WorkerProcess>();
  private readonly resultPaths = new Map<string, string>();
  private readonly worktrees: string[] = [];
  private closed = false;

  constructor(private readonly deps: SwarmDeps) {
    this.worktrees.push(...(deps.ownWorktrees ?? []));
  }

  get current(): Workers {
    return this.workers;
  }

  /** Worktree names this Swarm created, for the next session's cleanup. */
  get createdWorktrees(): readonly string[] {
    return this.worktrees;
  }

  private set(next: Workers): void {
    this.workers = next;
    this.deps.onChange(next);
  }

  /** `swarm start`: validate, queue, start whoever may run, return at once. */
  start(items: unknown, defaultTier: Tier): StartResult {
    if (this.closed) return { ok: false, error: "the session is ending" };
    const taken = new Set(this.workers.map((w) => w.spec.name));
    const parsed = parseSpecs(
      items,
      defaultTier,
      taken,
      this.deps.config.maxWorkers - this.workers.length,
    );
    if (!parsed.ok) return parsed;
    this.batch += 1;
    this.set(enqueue(this.workers, parsed.specs, this.batch, this.deps.now()));
    this.deps.log.event({
      at: this.deps.now(),
      batch: this.batch,
      started: parsed.specs.map((s) => s.name),
    });
    void this.pump();
    const names = parsed.specs.map((s) => s.name).join(", ");
    return {
      ok: true,
      text: `Started batch ${this.batch}: ${names}. They run in the background; their results arrive as one message when the batch has finished (at once if one fails). Use action "status" to look, "cancel" to stop.`,
    };
  }

  /** Start every queued worker that may run now. */
  private async pump(): Promise<void> {
    for (const name of runnable(this.workers, this.deps.config)) {
      const w = this.workers.find((x) => x.spec.name === name);
      // another pump() may have started it while this one awaited a worktree
      if (w === undefined || w.status !== "queued") continue;
      this.set(
        markStarted(this.workers, name, this.deps.now(), this.deps.modelLabel?.(w.spec.tier)),
      );
      try {
        const cwd = w.spec.isolated ? await this.isolate(name) : this.deps.root;
        if (this.closed || this.workers.find((x) => x.spec.name === name)?.status !== "working")
          continue;
        this.launch(w, cwd);
      } catch (error) {
        this.finish(name, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async isolate(name: string): Promise<string> {
    const dir = await createWorktree(this.deps.worktree, this.deps.root, name);
    this.worktrees.push(name);
    this.deps.onWorktrees?.(this.worktrees);
    return dir;
  }

  private launch(w: Worker, cwd: string): void {
    const { harness } = this.deps;
    const name = w.spec.name;
    let ended: { error?: string; text?: string } | undefined;
    const proc = this.deps.spawn(
      harness.bin,
      harness.args({
        task: w.spec.task,
        tier: w.spec.tier,
        ...(w.spec.effort === undefined ? {} : { effort: w.spec.effort }),
      }),
      {
        cwd,
        env: harness.env(w.spec.tier),
        onLine: (line) => {
          this.deps.log.raw(name, line);
          for (const event of this.deps.decode(line)) {
            if (event.kind === "progress") {
              this.set(recordProgress(this.workers, name, event.progress, this.deps.now()));
            } else {
              ended = {
                ...(event.error === undefined ? {} : { error: event.error }),
                ...(event.text === undefined ? {} : { text: event.text }),
              };
            }
          }
        },
        onExit: (code, stderrTail) => {
          this.procs.delete(name);
          const current = this.workers.find((x) => x.spec.name === name);
          const text = ended?.text ?? current?.result;
          const exitError =
            code === 0
              ? undefined
              : `exited with ${code === null ? "a signal" : `status ${code}`}${stderrTail === "" ? "" : `: ${stderrTail}`}`;
          // a clean exit with no verdict and no answer means the stream was not
          // understood (a changed output format), not an empty success
          const silent =
            code === 0 && ended === undefined && (text === undefined || text === "")
              ? "the worker exited without an answer the Swarm could read (its output format may have changed)"
              : undefined;
          const error = ended?.error ?? exitError ?? silent;
          this.afterExit(name, {
            ...(error === undefined ? {} : { error }),
            ...(text === undefined ? {} : { result: text }),
          }).catch((failure: unknown) => {
            // A log that cannot be written must not take the session down.
            console.error(
              `swarm: after ${name} exited: ${failure instanceof Error ? failure.message : String(failure)}`,
            );
          });
        },
      },
    );
    this.procs.set(name, proc);
  }

  private async afterExit(
    name: string,
    outcome: { error?: string; result?: string },
  ): Promise<void> {
    const w = this.workers.find((x) => x.spec.name === name);
    if (w?.spec.isolated === true && outcome.error === undefined) {
      try {
        const outside = (await changedFiles(this.deps.worktree, this.deps.root, name)).filter(
          (f) => !inScope(f, w.spec.files),
        );
        if (outside.length > 0) {
          this.finish(name, outcome);
          this.set(
            this.workers.map((x) =>
              x.spec.name === name
                ? { ...x, note: `範囲外 ${outside.length} 件: ${outside.slice(0, 3).join(", ")}` }
                : x,
            ),
          );
          this.deliver();
          void this.pump();
          return;
        }
      } catch {
        // No branch to compare yet (the worker made no commit): nothing is outside.
      }
    }
    this.finish(name, outcome);
    this.deliver();
    void this.pump();
  }

  private finish(name: string, outcome: { error?: string; result?: string }): void {
    if (outcome.result !== undefined && outcome.result !== "") {
      this.resultPaths.set(name, this.deps.log.result(name, outcome.result));
    }
    this.set(markFinished(this.workers, name, outcome, this.deps.now()));
    const w = this.workers.find((x) => x.spec.name === name);
    this.deps.log.event({ at: this.deps.now(), worker: name, status: w?.status, note: w?.note });
  }

  private deliver(): void {
    if (this.closed) return;
    const due = dueForDelivery(this.workers);
    if (due.length === 0) return;
    const body = due
      .map((w) => describe(w, this.deps.config.resultChars, this.resultPaths.get(w.spec.name)))
      .join("\n");
    const message = `Swarm results (${due.length} worker${due.length === 1 ? "" : "s"}):\n${body}`;
    this.set(
      markDelivered(
        this.workers,
        due.map((w) => w.spec.name),
      ),
    );
    this.deps.onDeliver(message, due);
  }

  /** `swarm status`: the table's content as text. */
  status(): string {
    if (this.workers.length === 0) return "No workers in this session.";
    return this.workers.map((w) => describe({ ...w, result: undefined }, 0)).join("\n");
  }

  /** `swarm results`: every finished worker's answer; unread ones become read. */
  results(names?: readonly string[]): string {
    const chosen = this.workers.filter(
      (w) =>
        (names === undefined || names.includes(w.spec.name)) &&
        w.status !== "queued" &&
        w.status !== "working",
    );
    if (chosen.length === 0) return "No finished workers to report.";
    this.set(
      markDelivered(
        this.workers,
        chosen.map((w) => w.spec.name),
      ),
    );
    return chosen
      .map((w) => describe(w, this.deps.config.resultChars, this.resultPaths.get(w.spec.name)))
      .join("\n");
  }

  /** `swarm cancel`: queued ones never start, running ones are stopped. */
  cancel(names?: readonly string[]): string {
    const targets = names ?? "all";
    const stopping = this.workers.filter(
      (w) =>
        (targets === "all" || targets.includes(w.spec.name)) &&
        (w.status === "working" || w.status === "queued"),
    );
    // the parent asked for it, so there is nothing to tell it later
    this.set(
      markDelivered(
        markCancelled(this.workers, targets, this.deps.now()),
        stopping.map((w) => w.spec.name),
      ),
    );
    for (const w of stopping) this.procs.get(w.spec.name)?.kill();
    return stopping.length === 0
      ? "Nothing to cancel."
      : `Cancelled: ${stopping.map((w) => w.spec.name).join(", ")}.`;
  }

  /** Cleanup at session start: the Swarm's own merged worktrees go. */
  async removeMergedWorktrees(): Promise<readonly string[]> {
    const removed = await removeMerged(this.deps.worktree, this.deps.root, this.worktrees);
    for (const name of removed) this.worktrees.splice(this.worktrees.indexOf(name), 1);
    if (removed.length > 0) this.deps.onWorktrees?.(this.worktrees);
    return removed;
  }

  /** The parent session is ending: stop every worker, leave no orphans. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
  }
}
