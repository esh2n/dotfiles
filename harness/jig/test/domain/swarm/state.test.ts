import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type SwarmConfig } from "../../../src/domain/swarm/config";
import {
  type Workers,
  dueForDelivery,
  enqueue,
  markCancelled,
  markDelivered,
  markFinished,
  markStarted,
  nextHideAt,
  openCount,
  recordProgress,
  runnable,
  shownInTable,
} from "../../../src/domain/swarm/state";
import { HIDE_AFTER_READ_MS } from "../../../src/domain/swarm/state";
import type { Tier, WorkerSpec } from "../../../src/domain/swarm/types";

function spec(name: string, extra: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    name,
    task: `do ${name}`,
    tier: "main",
    files: [`${name}/**`],
    isolated: false,
    ...extra,
  };
}

function config(caps: Partial<Record<Tier, number>>): SwarmConfig {
  return { ...DEFAULT_CONFIG, maxConcurrent: { ...DEFAULT_CONFIG.maxConcurrent, ...caps } };
}

function status(workers: Workers): Record<string, string> {
  return Object.fromEntries(workers.map((w) => [w.spec.name, w.status]));
}

describe("who may start", () => {
  test("disjoint workers start together, up to the tier's limit, in queue order", () => {
    const w = enqueue([], [spec("a"), spec("b"), spec("c")], 1, 0);
    expect(runnable(w, config({ main: 2 }))).toEqual(["a", "b"]);
  });

  test("deterministic runs one at a time by default", () => {
    const w = enqueue(
      [],
      [spec("a", { tier: "deterministic" }), spec("b", { tier: "deterministic" })],
      1,
      0,
    );
    expect(runnable(w, DEFAULT_CONFIG)).toEqual(["a"]);
  });

  test("a running worker holds its files; a queued one sharing them waits", () => {
    let w = enqueue([], [spec("a", { files: ["src/**"] })], 1, 0);
    w = markStarted(w, "a", 1);
    w = enqueue(w, [spec("b", { files: ["src/x.ts"] }), spec("c", { files: ["docs/**"] })], 2, 2);
    expect(runnable(w, DEFAULT_CONFIG)).toEqual(["c"]);
  });

  test("a later worker does not jump into a scope an earlier one waits for", () => {
    const w = enqueue(
      [],
      [
        spec("a", { tier: "deterministic", files: ["src/**"] }),
        spec("b", { tier: "deterministic" }),
        spec("c", { files: ["src/y.ts"] }),
      ],
      1,
      0,
    );
    // a starts; b waits on the tier; c shares a's files and waits too
    expect(runnable(w, DEFAULT_CONFIG)).toEqual(["a"]);
  });

  test("a worker with no files is the whole checkout and waits for everyone writing", () => {
    let w = enqueue([], [spec("a")], 1, 0);
    w = markStarted(w, "a", 1);
    w = enqueue(w, [spec("b", { files: [] })], 2, 2);
    expect(runnable(w, DEFAULT_CONFIG)).toEqual([]);
  });

  test("isolated workers never hold or wait on the shared checkout", () => {
    let w = enqueue([], [spec("a", { files: [] })], 1, 0);
    w = markStarted(w, "a", 1);
    w = enqueue(w, [spec("b", { files: [], isolated: true })], 2, 2);
    expect(runnable(w, DEFAULT_CONFIG)).toEqual(["b"]);
  });
});

describe("a worker's life", () => {
  test("progress adds each call's usage and keeps the latest text", () => {
    let w = markStarted(enqueue([], [spec("a")], 1, 0), "a", 1);
    w = recordProgress(w, "a", { turn: true, model: "deepseek-flash" }, 2);
    w = recordProgress(
      w,
      "a",
      { toolCall: true, usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } },
      3,
    );
    w = recordProgress(
      w,
      "a",
      {
        toolCall: true,
        text: "done",
        usage: { input: 5, output: 1, cacheRead: 3, cacheWrite: 0 },
      },
      4,
    );
    const [a] = w;
    expect(a?.usage).toEqual({ input: 15, output: 3, cacheRead: 3, cacheWrite: 0 });
    expect(a).toMatchObject({
      turns: 1,
      toolCalls: 2,
      model: "deepseek-flash",
      result: "done",
      lastEventAt: 4,
    });
  });

  test("success is unread; an isolated success waits for a merge; an error is a failure", () => {
    let w = enqueue([], [spec("a"), spec("b", { isolated: true }), spec("c")], 1, 0);
    for (const n of ["a", "b", "c"]) w = markStarted(w, n, 1);
    w = markFinished(w, "a", { result: "ok" }, 5);
    w = markFinished(w, "b", { result: "ok" }, 5);
    w = markFinished(w, "c", { error: "exit 1" }, 5);
    expect(status(w)).toEqual({ a: "unread", b: "held", c: "failed" });
    expect(w[1]?.note).toBe("合流待ち");
    expect(w[2]?.note).toBe("exit 1");
  });

  test("finishing a worker that is not running changes nothing", () => {
    const w = enqueue([], [spec("a")], 1, 0);
    expect(markFinished(w, "a", { result: "x" }, 1)).toEqual(w);
  });

  test("cancel stops queued and working workers, never finished ones", () => {
    let w = enqueue([], [spec("a"), spec("b"), spec("c")], 1, 0);
    w = markStarted(w, "a", 1);
    w = markStarted(w, "c", 1);
    w = markFinished(w, "c", { result: "ok" }, 2);
    w = markCancelled(w, "all", 3);
    expect(status(w)).toEqual({ a: "cancelled", b: "cancelled", c: "unread" });
  });
});

describe("delivery to the parent", () => {
  test("a batch is delivered once, when all of it has finished", () => {
    let w = enqueue([], [spec("a"), spec("b")], 1, 0);
    w = markStarted(markStarted(w, "a", 1), "b", 1);
    w = markFinished(w, "a", { result: "A" }, 2);
    expect(dueForDelivery(w)).toEqual([]);
    w = markFinished(w, "b", { result: "B" }, 3);
    const due = dueForDelivery(w).map((x) => x.spec.name);
    expect(due).toEqual(["a", "b"]);
    w = markDelivered(w, due, 4);
    expect(status(w)).toEqual({ a: "done", b: "done" });
    expect(dueForDelivery(w)).toEqual([]);
  });

  test("a failure is delivered at once, without waiting for its batch", () => {
    let w = enqueue([], [spec("a"), spec("b")], 1, 0);
    w = markStarted(markStarted(w, "a", 1), "b", 1);
    w = markFinished(w, "a", { error: "boom" }, 2);
    expect(dueForDelivery(w).map((x) => x.spec.name)).toEqual(["a"]);
  });

  test("batches are delivered separately", () => {
    let w = enqueue([], [spec("a")], 1, 0);
    w = enqueue(w, [spec("b")], 2, 0);
    w = markStarted(markStarted(w, "a", 1), "b", 1);
    w = markFinished(w, "b", { result: "B" }, 2);
    expect(dueForDelivery(w).map((x) => x.spec.name)).toEqual(["b"]);
  });

  test("delivery reads unread results but leaves held and failed saying so", () => {
    let w = enqueue([], [spec("a", { isolated: true }), spec("b")], 1, 0);
    w = markStarted(markStarted(w, "a", 1), "b", 1);
    w = markFinished(w, "a", { result: "A" }, 2);
    w = markFinished(w, "b", { error: "x" }, 2);
    w = markDelivered(w, ["a", "b"], 3);
    expect(status(w)).toEqual({ a: "held", b: "failed" });
  });
});

describe("rows leaving the table (owner's ruling 2026-09-30)", () => {
  const byName = (w: ReturnType<typeof enqueue>, name: string) => {
    const found = w.find((x) => x.spec.name === name);
    if (found === undefined) throw new Error(name);
    return found;
  };

  test("a read row goes 30 s after the parent read it", () => {
    let w = markFinished(
      markStarted(enqueue([], [spec("a")], 1, 0), "a", 1),
      "a",
      { result: "A" },
      2,
    );
    expect(shownInTable(byName(w, "a"), 1_000_000)).toBe(true);
    w = markDelivered(w, ["a"], 10);
    expect(shownInTable(byName(w, "a"), 10 + HIDE_AFTER_READ_MS - 1)).toBe(true);
    expect(shownInTable(byName(w, "a"), 10 + HIDE_AFTER_READ_MS)).toBe(false);
    expect(nextHideAt(w, 20)).toBe(10 + HIDE_AFTER_READ_MS);
  });

  test("a failed row stays until read, then goes like the rest", () => {
    let w = markFinished(
      markStarted(enqueue([], [spec("a")], 1, 0), "a", 1),
      "a",
      { error: "x" },
      2,
    );
    expect(shownInTable(byName(w, "a"), 1_000_000)).toBe(true);
    w = markDelivered(w, ["a"], 10);
    expect(shownInTable(byName(w, "a"), 10 + HIDE_AFTER_READ_MS)).toBe(false);
  });

  test("a held row stays: its branch still waits for the owner", () => {
    let w = enqueue([], [spec("a", { isolated: true })], 1, 0);
    w = markFinished(markStarted(w, "a", 1), "a", { result: "A" }, 2);
    w = markDelivered(w, ["a"], 10);
    expect(shownInTable(byName(w, "a"), 10 + 10 * HIDE_AFTER_READ_MS)).toBe(true);
    expect(nextHideAt(w, 20)).toBeUndefined();
  });

  test("a second delivery does not restart the clock", () => {
    let w = markFinished(
      markStarted(enqueue([], [spec("a")], 1, 0), "a", 1),
      "a",
      { result: "A" },
      2,
    );
    w = markDelivered(markDelivered(w, ["a"], 10), ["a"], 500);
    expect(byName(w, "a").readAt).toBe(10);
  });

  test("read, settled workers stop counting toward maxWorkers", () => {
    let w = enqueue([], [spec("a"), spec("b"), spec("c")], 1, 0);
    w = markFinished(markStarted(w, "a", 1), "a", { result: "A" }, 2);
    expect(openCount(w)).toBe(3);
    w = markDelivered(w, ["a"], 3);
    expect(openCount(w)).toBe(2);
  });
});
