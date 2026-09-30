import { describe, expect, test } from "bun:test";
import {
  SPEND_SETTLE_MS,
  costPending,
  spendTag,
  withSpendTag,
} from "../../../src/domain/swarm/spend";
import { enqueue, markFinished, markStarted, recordCost } from "../../../src/domain/swarm/state";
import type { WorkerSpec } from "../../../src/domain/swarm/types";

const spec = (name: string): WorkerSpec => ({
  name,
  task: "t",
  tier: "main",
  files: [],
  isolated: false,
});

describe("the worker's tag on a request", () => {
  test("is unique per session and worker", () => {
    expect(spendTag("s1", "a")).toBe("jig-swarm:s1:a");
    expect(spendTag("s1", "a")).not.toBe(spendTag("s2", "a"));
  });

  test("is added to metadata.tags, keeping what was there", () => {
    const body = { model: "main", metadata: { trace: "x", tags: ["keep"] }, messages: [] };
    expect(withSpendTag(body, "t")).toEqual({
      model: "main",
      metadata: { trace: "x", tags: ["keep", "t"] },
      messages: [],
    });
    expect(body.metadata.tags).toEqual(["keep"]);
  });

  test("creates metadata when there is none, and is not added twice", () => {
    const once = withSpendTag({ model: "main" }, "t");
    expect(once).toEqual({ model: "main", metadata: { tags: ["t"] } });
    expect(withSpendTag(once, "t")).toBe(once);
  });

  test("leaves anything that is not an object alone", () => {
    expect(withSpendTag("raw", "t")).toBe("raw");
    expect(withSpendTag(null, "t")).toBeNull();
    expect(withSpendTag([1], "t")).toEqual([1]);
  });
});

describe("which costs are still read", () => {
  test("started workers, until SPEND_SETTLE_MS after they end", () => {
    let w = enqueue([], [spec("queued"), spec("running"), spec("ended")], 1, 0);
    w = markStarted(w, "running", 1);
    w = markStarted(w, "ended", 1);
    w = markFinished(w, "ended", { result: "ok" }, 10);
    expect(costPending(w, 20)).toEqual(["running", "ended"]);
    expect(costPending(w, 10 + SPEND_SETTLE_MS)).toEqual(["running"]);
  });
});

describe("recording costs", () => {
  test("sets the named workers' cost and leaves the rest unknown", () => {
    const w = recordCost(enqueue([], [spec("a"), spec("b")], 1, 0), new Map([["a", 0.5]]));
    expect(w.map((x) => x.cost)).toEqual([0.5, undefined]);
  });
});
