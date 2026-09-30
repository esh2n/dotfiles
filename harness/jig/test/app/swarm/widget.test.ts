import { afterEach, describe, expect, test } from "bun:test";
import { swarmWidget } from "../../../src/app/swarm/widget";
import {
  HIDE_AFTER_READ_MS,
  type Workers,
  enqueue,
  markDelivered,
  markFinished,
  markStarted,
} from "../../../src/domain/swarm/state";

const plain = { fg: (_colour: string, text: string) => text };
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
});

/** Counts timers the widget starts and stops, without running them. */
function countTimers() {
  const counts = { started: 0, cleared: 0 };
  globalThis.setInterval = (() => {
    counts.started += 1;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {
    counts.cleared += 1;
  }) as typeof clearInterval;
  return counts;
}

function readRow(readAt: number): Workers {
  const spec = { name: "a", task: "t", tier: "main" as const, files: [], isolated: false };
  const w = markFinished(markStarted(enqueue([], [spec], 1, 0), "a", 1), "a", { result: "A" }, 2);
  return markDelivered(w, ["a"], readAt);
}

describe("the table's redraw timer", () => {
  test("keeps ticking while a read row waits to leave, then stops once it has left", () => {
    const counts = countTimers();
    let now = 10;
    const workers = readRow(10);
    const widget = swarmWidget(
      () => workers,
      () => now,
    )({ requestRender() {} }, plain);

    expect(widget.render(200)[1]).toContain("a ");
    expect(counts).toEqual({ started: 1, cleared: 0 });

    now = 10 + HIDE_AFTER_READ_MS;
    expect(widget.render(200)).toHaveLength(1);
    expect(counts).toEqual({ started: 1, cleared: 1 });
  });

  test("starts no timer when nothing runs and nothing is waiting to leave", () => {
    const counts = countTimers();
    const workers = readRow(0);
    const widget = swarmWidget(
      () => workers,
      () => HIDE_AFTER_READ_MS * 2,
    )({ requestRender() {} }, plain);
    widget.render(200);
    expect(counts.started).toBe(0);
  });
});
