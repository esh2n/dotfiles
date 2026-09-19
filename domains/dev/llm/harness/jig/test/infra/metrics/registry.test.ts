import { describe, expect, test } from "bun:test";
import { MetricsRegistry } from "../../../src/infra/metrics/registry";

describe("MetricsRegistry", () => {
  test("renders an empty registry as empty text", () => {
    expect(new MetricsRegistry().render()).toBe("");
  });

  test("a counter renders with its HELP and TYPE, and counts up", () => {
    const metrics = new MetricsRegistry();
    metrics.describe("jig_requests_total", "Judgment requests, by endpoint and outcome.");
    metrics.increment("jig_requests_total", { kind: "tier", outcome: "ok" });
    metrics.increment("jig_requests_total", { kind: "tier", outcome: "ok" });
    metrics.increment("jig_requests_total", { kind: "tier", outcome: "error" });

    expect(metrics.render()).toBe(
      [
        "# HELP jig_requests_total Judgment requests, by endpoint and outcome.",
        "# TYPE jig_requests_total counter",
        'jig_requests_total{kind="tier",outcome="error"} 1',
        'jig_requests_total{kind="tier",outcome="ok"} 2',
        "",
      ].join("\n"),
    );
  });

  test("label values escape backslash, quote and newline", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("m", { a: 'back\\slash "quoted"\nnewline' });

    expect(metrics.render()).toContain('m{a="back\\\\slash \\"quoted\\"\\nnewline"} 1');
  });

  test("HELP escapes backslash and newline, and is declared once", () => {
    const metrics = new MetricsRegistry();
    metrics.describe("m", "line one\nline two \\ end");
    metrics.describe("m", "a second description is ignored");
    metrics.increment("m");

    expect(metrics.render()).toBe(
      ["# HELP m line one\\nline two \\\\ end", "# TYPE m counter", "m 1", ""].join("\n"),
    );
  });

  test("a histogram renders cumulative buckets in order, +Inf equal to count", () => {
    const metrics = new MetricsRegistry();
    metrics.describe("jig_judgment_seconds", "How long a judgment takes.");
    metrics.observe("jig_judgment_seconds", 0.05, { kind: "tier" });
    metrics.observe("jig_judgment_seconds", 0.4, { kind: "tier" });
    metrics.observe("jig_judgment_seconds", 9, { kind: "tier" });

    const rendered = metrics.render();
    expect(rendered).toContain("# TYPE jig_judgment_seconds histogram");
    // 0.05 <= 0.1 → 1; 0.4 <= 0.5 → 2; 9 <= 10 → 3; the rest stay at 3.
    expect(rendered).toContain('jig_judgment_seconds_bucket{kind="tier",le="0.1"} 1');
    expect(rendered).toContain('jig_judgment_seconds_bucket{kind="tier",le="0.5"} 2');
    expect(rendered).toContain('jig_judgment_seconds_bucket{kind="tier",le="10"} 3');
    expect(rendered).toContain('jig_judgment_seconds_bucket{kind="tier",le="30"} 3');
    expect(rendered).toContain('jig_judgment_seconds_bucket{kind="tier",le="+Inf"} 3');
    expect(rendered).toContain('jig_judgment_seconds_count{kind="tier"} 3');
    // Buckets appear in increasing order of `le`.
    const order = [...rendered.matchAll(/_bucket\{[^}]*le="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["0.1", "0.25", "0.5", "1", "2", "5", "10", "30", "+Inf"]);
  });

  test("token usage is counted per model and direction", () => {
    const metrics = new MetricsRegistry();
    metrics.describe("jig_judgment_tokens_total", "Tokens the judgment model reported.");
    metrics.countTokens("jev-1.13.0", "input", 407);
    metrics.countTokens("jev-1.13.0", "input", 100);
    metrics.countTokens("jev-1.13.0", "output", 41);

    const rendered = metrics.render();
    expect(rendered).toContain(
      'jig_judgment_tokens_total{direction="input",model="jev-1.13.0"} 507',
    );
    expect(rendered).toContain(
      'jig_judgment_tokens_total{direction="output",model="jev-1.13.0"} 41',
    );
  });

  test("a metric's samples stay in one group, under their own TYPE line", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("a_total");
    metrics.observe("b_seconds", 0.2);
    metrics.increment("c_total");

    // Every sample line must sit between its own `# TYPE` line and the next comment.
    const groups = new Map<string, string[]>();
    let current: string | undefined;
    for (const line of metrics.render().split("\n")) {
      if (line.startsWith("# TYPE ")) {
        current = line.split(" ")[2] ?? "";
        groups.set(current, []);
        continue;
      }
      if (line === "" || current === undefined) continue;
      groups.get(current)?.push(line);
    }

    // Counters are rendered before histograms; the order between metrics is free,
    // what matters is that each name keeps its own group.
    expect([...groups.keys()].sort()).toEqual(["a_total", "b_seconds", "c_total"]);
    for (const [name, samples] of groups) {
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every((sample) => sample.startsWith(name))).toBe(true);
    }
  });
});
