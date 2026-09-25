/**
 * A tiny Prometheus exposition for the judgment service.
 *
 * Hand-written rather than `prom-client` on purpose: this service has four metric
 * families and no event loop to watch, and prom-client's Node/V8 defaults
 * (`monitorEventLoopDelay`, `PerformanceObserver`) are exactly what breaks on Bun.
 * The format is small and fully specified — the rules implemented here are the
 * ones in https://prometheus.io/docs/instrumenting/exposition_formats/:
 *
 *  - `# HELP` / `# TYPE` once per metric, before its samples, one group per metric
 *  - label values escape `\`, `"` and newline; HELP escapes `\` and newline
 *  - histograms expose cumulative `_bucket{le=…}` in increasing order, and the
 *    `le="+Inf"` bucket must equal `_count`
 *  - the reply must announce `text/plain; version=0.0.4`, because a scrape with a
 *    missing or unparsable Content-Type fails outright since Prometheus 3.0
 *
 * Counters are monotonic here because they live for the life of the process; what
 * makes them a time series is Prometheus storing them (see the observability stack).
 */

/** Buckets for judgment latency. The wire answers in ~0.6s; the tail is what matters. */
const JUDGMENT_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30] as const;

export type Labels = Readonly<Record<string, string>>;

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeHelp(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** `{a="1",b="2"}`, labels sorted so the same labels always render the same way. */
function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const pairs = keys.map((key) => `${key}="${escapeLabelValue(labels[key] ?? "")}"`);
  return `{${pairs.join(",")}}`;
}

/** Go's ParseFloat accepts both plain and exponent notation, so String() is enough. */
function formatValue(value: number): string {
  return String(value);
}

interface Histogram {
  readonly bucketBounds: readonly number[];
  /** Per-bucket counts, cumulative on render. */
  readonly counts: number[];
  sum: number;
  count: number;
}

/**
 * Counters and histograms. Not thread-safe by design: Bun runs one event loop and
 * the only mutation points are awaited-away callbacks, so a mutex would be a lie
 * about what protects what.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly help = new Map<string, string>();
  private readonly histograms = new Map<
    string,
    { name: string; labels: Labels; histogram: Histogram }
  >();

  /** Declare a metric's help text; the first declaration wins. */
  describe(name: string, text: string): void {
    if (!this.help.has(name)) this.help.set(name, text);
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}${formatLabels(labels)}`;
    const existing = this.counters.get(key);
    if (existing === undefined) this.counters.set(key, { name, labels, value: by });
    else existing.value += by;
  }

  observe(name: string, seconds: number, labels: Labels = {}): void {
    const key = `${name}${formatLabels(labels)}`;
    let entry = this.histograms.get(key);
    if (entry === undefined) {
      entry = {
        name,
        labels,
        histogram: {
          bucketBounds: JUDGMENT_BUCKETS,
          counts: JUDGMENT_BUCKETS.map(() => 0),
          sum: 0,
          count: 0,
        },
      };
      this.histograms.set(key, entry);
    }
    const histogram = entry.histogram;
    // One increment per observation, into the first bucket that covers it. The
    // cumulative running total belongs in the exposition, not in the storage.
    for (let index = 0; index < histogram.bucketBounds.length; index++) {
      const bound = histogram.bucketBounds[index];
      if (bound !== undefined && seconds <= bound) {
        histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
        break;
      }
    }
    histogram.sum += seconds;
    histogram.count += 1;
  }

  /**
   * Token usage as reported by the provider: the number that is money. Labelled by
   * the endpoint that spent it (`kind`) so a cost question can be answered per
   * decision type — a per-prompt tier judgment and a per-compaction judgment are
   * paid for by different things and have to be justified separately.
   */
  countTokens(
    model: string,
    direction: "input" | "output",
    tokens: number,
    kind = "unknown",
  ): void {
    this.increment("jig_judgment_tokens_total", { model, direction, kind }, tokens);
  }

  render(): string {
    const lines: string[] = [];

    const byName = new Map<string, { name: string; labels: Labels; value: number }[]>();
    for (const entry of this.counters.values()) {
      const list = byName.get(entry.name) ?? [];
      list.push(entry);
      byName.set(entry.name, list);
    }

    for (const name of [...byName.keys()].sort()) {
      const help = this.help.get(name);
      if (help !== undefined) lines.push(`# HELP ${name} ${escapeHelp(help)}`);
      lines.push(`# TYPE ${name} counter`);
      for (const entry of (byName.get(name) ?? []).sort((a, b) =>
        formatLabels(a.labels).localeCompare(formatLabels(b.labels)),
      )) {
        lines.push(`${name}${formatLabels(entry.labels)} ${formatValue(entry.value)}`);
      }
    }

    for (const name of [
      ...new Set([...this.histograms.values()].map((entry) => entry.name)),
    ].sort()) {
      const help = this.help.get(name);
      if (help !== undefined) lines.push(`# HELP ${name} ${escapeHelp(help)}`);
      lines.push(`# TYPE ${name} histogram`);
      const entries = [...this.histograms.values()]
        .filter((entry) => entry.name === name)
        .sort((a, b) => formatLabels(a.labels).localeCompare(formatLabels(b.labels)));
      for (const entry of entries) {
        const histogram = entry.histogram;
        let cumulative = 0;
        for (let index = 0; index < histogram.bucketBounds.length; index++) {
          cumulative += histogram.counts[index] ?? 0;
          const bound = histogram.bucketBounds[index];
          const labels = formatLabels({ ...entry.labels, le: formatValue(bound ?? 0) });
          lines.push(`${name}_bucket${labels} ${formatValue(cumulative)}`);
        }
        const infLabels = formatLabels({ ...entry.labels, le: "+Inf" });
        lines.push(`${name}_bucket${infLabels} ${formatValue(histogram.count)}`);
        lines.push(`${name}_sum${formatLabels(entry.labels)} ${formatValue(histogram.sum)}`);
        lines.push(`${name}_count${formatLabels(entry.labels)} ${formatValue(histogram.count)}`);
      }
    }

    // The last line must end with a line feed.
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }
}

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
