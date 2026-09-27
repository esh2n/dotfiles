import { describe, expect, mock, test } from "bun:test";

// pi's loader provides @earendil-works/pi-tui at load time; plain stand-ins are enough here.
mock.module("@earendil-works/pi-tui", () => ({
  truncateToWidth: (text: string, width: number) => text.slice(0, width),
  visibleWidth: (text: string) => text.length,
}));
const { contextBar, duration, footerLines, sessionCost } = await import("../footer");

const base = {
  model: "main",
  thinking: "high",
  cwd: "/Users/me/go/github.com/esh2n/dotfiles",
  branch: "main",
  statuses: ["tier: main"],
  contextPercent: 31,
  contextWindow: 200_000,
  costUsd: 0.1234,
  startedAt: 0,
  now: 12 * 60_000,
};

describe("pi's footer", () => {
  test("the same two lines Claude Code's status line shows", () => {
    expect(footerLines(base)).toEqual([
      "main:high  📁 dotfiles  🔀 main  tier: main",
      "▰▰▰▱▱▱▱▱▱▱ 31% of 200k | ⏱ 12m | 💰$0.12",
    ]);
  });

  test("leaves out what pi does not know", () => {
    const [first, second] = footerLines({
      ...base,
      model: undefined,
      branch: null,
      statuses: [],
      contextPercent: null,
      costUsd: 0.004,
      now: 30_000,
    });
    expect(first).toBe("no model  📁 dotfiles");
    expect(second).toBe("⏱ <1m | 💰$0.0040");
  });

  test("thinking off is not shown", () => {
    expect(footerLines({ ...base, thinking: "off" })[0]).toStartWith("main  ");
  });

  test("bars, durations and cost", () => {
    expect(contextBar(0)).toBe("▱".repeat(10));
    expect(contextBar(100)).toBe("▰".repeat(10));
    expect(duration(3_600_000)).toBe("1h");
    expect(duration(3_900_000)).toBe("1h5m");
    expect(
      sessionCost([
        { type: "message", message: { role: "assistant", usage: { cost: { total: 0.1 } } } },
        { type: "message", message: { role: "user" } },
        { type: "message", message: { role: "assistant", usage: { cost: { total: 0.02 } } } },
        { type: "compaction" },
      ]),
    ).toBeCloseTo(0.12);
  });
});
