import { describe, expect, test } from "bun:test";
import {
  type Workers,
  enqueue,
  markFinished,
  markStarted,
  recordProgress,
} from "../../../src/domain/swarm/state";
import {
  MAX_LINES,
  bar,
  cellWidth,
  cost,
  duration,
  progress,
  renderTable,
  summary,
  tokens,
} from "../../../src/domain/swarm/table";
import type { WorkerSpec } from "../../../src/domain/swarm/types";

function spec(name: string, extra: Partial<WorkerSpec> = {}): WorkerSpec {
  return { name, task: "t", tier: "main", files: [`${name}/**`], isolated: false, ...extra };
}

function running(names: readonly string[], at = 0): Workers {
  let w = enqueue(
    [],
    names.map((n) => spec(n)),
    1,
    at,
  );
  for (const n of names) w = markStarted(w, n, at);
  return w;
}

describe("formatting", () => {
  test("durations, tokens and cost read at a glance", () => {
    expect(duration(4_200)).toBe("4s");
    expect(duration(125_000)).toBe("2m");
    expect(duration(3_900_000)).toBe("1h05");
    expect(tokens(950)).toBe("950");
    expect(tokens(4_520)).toBe("4.5k");
    expect(tokens(45_200)).toBe("45k");
    expect(tokens(2_300_000)).toBe("2.3M");
    expect(cost(undefined)).toBe("—");
    expect(cost(0.0042)).toBe("$0.0042");
    expect(cost(1.5)).toBe("$1.50");
  });

  test("a bar is ten cells; unknown progress is a moving pulse", () => {
    expect(bar(0.5, 0)).toBe("▬▬▬▬▬·····");
    expect(bar(1, 0)).toBe("▬".repeat(10));
    expect(bar(undefined, 0)).not.toBe(bar(undefined, 500));
    expect([...bar(undefined, 0)]).toHaveLength(10);
  });

  test("wide characters take two cells", () => {
    expect(cellWidth("合流待ち")).toBe(8);
    expect(cellWidth("abc")).toBe(3);
  });
});

describe("progress", () => {
  test("measured against the batch's finished workers, never done before it is", () => {
    let w = running(["a", "b"], 0);
    w = markFinished(w, "a", { result: "x" }, 10_000);
    const b = w[1];
    expect(b && progress(b, w, 5_000)).toBe(0.5);
    expect(b && progress(b, w, 50_000)).toBe(0.95);
  });

  test("unknown until a batch-mate has finished", () => {
    const w = running(["a"]);
    const a = w[0];
    expect(a && progress(a, w, 1_000)).toBeUndefined();
  });
});

describe("the table", () => {
  test("header, one row per worker, and the summary", () => {
    let w = running(["port-layout", "port-state"], 0);
    w = recordProgress(
      w,
      "port-layout",
      {
        model: "deepseek-flash",
        usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, cost: 0.002 },
      },
      1_000,
    );
    const lines = renderTable(w, 200, 15_000);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(
      /^NAME\s+MODEL\s+EFFORT\s+STATUS\s+PROGRESS\s+IDLE\s+AGE\s+NOTE\s+COST\s+TOKENS$/,
    );
    expect(lines[1]).toContain("port-layout");
    expect(lines[1]).toContain("deepseek-flash");
    expect(lines[1]).toContain("Working");
    expect(lines[1]).toContain("direct");
    expect(lines[3]).toBe("Swarm · Working · 2 working · 0 queued · 0 unread · $0.0020 · 1.2k tok");
  });

  test("never more than ten lines; the rest is counted", () => {
    const w = running(Array.from({ length: 18 }, (_, i) => `w${i}`));
    const lines = renderTable(w, 200, 0);
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines[MAX_LINES - 2]).toContain("ほか 11 件");
  });

  test("rows needing attention come first", () => {
    let w = running(["a", "b"]);
    w = markFinished(w, "a", { error: "x" }, 1);
    w = enqueue(w, [spec("c")], 2, 2);
    const names = renderTable(w, 200, 3)
      .slice(1, 4)
      .map((l) => l.split(/\s+/)[0]);
    expect(names).toEqual(["b", "c", "a"]);
  });

  test("no line is wider than the terminal, notes and names give way first", () => {
    let w = running(["a-rather-long-worker-name"]);
    w = markFinished(
      w,
      "a-rather-long-worker-name",
      { error: "the process exited with status 1 after a long while" },
      1,
    );
    for (const line of renderTable(w, 80, 2)) expect(cellWidth(line)).toBeLessThanOrEqual(80);
  });

  test("columns stay aligned with wide notes", () => {
    let w = running(["a", "b"]);
    w = enqueue(w, [spec("c", { isolated: true })], 2, 0);
    w = markStarted(w, "c", 0);
    w = markFinished(w, "c", { result: "x" }, 1);
    const lines = renderTable(w, 200, 2).slice(0, 4);
    // where the last column (TOKENS) starts, in terminal cells
    const lastColumn = (l: string) => cellWidth(l.slice(0, l.lastIndexOf(" ") + 1));
    expect(lines.some((l) => l.includes("合流待ち"))).toBe(true);
    expect(new Set(lines.map(lastColumn)).size).toBe(1);
  });

  test("no workers, no table", () => {
    expect(renderTable([], 80, 0)).toEqual([]);
  });

  test("the summary says when cost is unknown instead of showing zero", () => {
    expect(summary(running(["a"]))).toContain("cost —");
  });
});
