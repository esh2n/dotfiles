---
name: observability-patterns
description: Use when instrumenting a service with logs/metrics/traces, designing SLOs and alerts, reviewing metric label cardinality, choosing a trace sampling strategy, or building a dashboard — deciding what to page on vs ticket, which signal answers a given debugging question, or why a metrics/logging bill spiked.
---

# Observability Patterns

Judgment criteria for logs, metrics, traces, SLOs, alerts, and dashboards —
not a "how to install an agent" tutorial.

## The three signals judgment

Each signal answers a different question; picking the wrong one to answer a
question is the recurring mistake, not lacking instrumentation.

| Question | Signal | Why |
|---|---|---|
| "What exactly happened on this one request?" | Logs | Per-event structured detail for debugging one incident — the highest-fidelity signal, though logs are routinely sampled or rate-limited at volume, so "full fidelity" is a configuration choice, not a property. |
| "Is the system healthy right now / should I alert?" | Metrics | Cheap aggregates over time, built for dashboards and alert thresholds. |
| "Where in this request's call graph did the time go or the failure happen?" | Traces | Causality across services — logs and metrics can't show a request's path through five hops. |

**[trade-off] Pre-aggregate at ingest (recording rules), not at query time — and
keep the raw events.** Running a log-aggregation query to compute a
rate/percentile that's needed repeatedly (every dashboard refresh, every alert
eval) re-scans raw log volume each time. Emit a metric directly at the point the
event happens, or precompute it with a recording rule, and let the raw events
stay for investigation. The opposing position — keep wide structured events and
derive every aggregate at query time — is a real one and is what event-native
backends are built around
(https://www.honeycomb.io/blog/observability-a-manifesto); the part that is not
defensible either way is re-scanning raw logs on every alert evaluation.

## Cardinality discipline

Label/attribute cardinality is usually the dominant term in metrics cost — more
so than request volume. Cost is roughly series × samples per series, so scrape
interval, retention, and query range matter too; what makes cardinality dominant
is that a bad label multiplies the series count without any bound, while the
other terms are fixed by configuration.

- **[defect] Never put user ID, request ID, session ID, or any per-request
  unique value in a metric label.** Each unique label combination creates a new
  time series; a user-id label turns one metric into millions of series,
  which is what actually causes "the metrics backend is slow/expensive" —
  not the request volume itself. The one sanctioned exception is an
  **exemplar**: a trace ID (plus a small set of attributes) attached to a
  single metric sample. An exemplar is stored outside the series identity, so
  it links a metric to one request without creating a series
  (https://prometheus.io/docs/practices/naming/,
  https://prometheus.io/docs/specs/om/open_metrics_spec/).
- High-cardinality identifiers belong in traces (as span attributes) or logs
  (as structured fields), where per-event storage is the model, not
  per-series aggregation. Route the identifier to the signal built for it —
  don't force it into a metric label because "it'd be convenient to filter
  by it on the dashboard."
- Bounded, low-cardinality dimensions (HTTP method, status-code class, route
  *template* — not the raw path with IDs interpolated, region, service name)
  are what metric labels are for. **[defect] Give every label a value ceiling
  and every metric a series budget**: roughly ≤ 100 distinct values per label,
  and a stated total series budget per metric (the product of all its label
  cardinalities, times the number of instances scraped) that a reviewer can
  check against. A label whose value set is not enumerable at review time has
  no ceiling and does not belong on a metric.
- **[trade-off] A per-tenant breakdown is a real need, and the answer is not
  "a tenant label".** Two workable shapes: keep a bounded *top-N* label — the
  N largest tenants by name, everything else bucketed as `other`, with the
  membership recomputed on a schedule — or route the per-tenant dimension to a
  columnar event store (wide events, or traces with a tenant attribute) and
  query it there, keeping the metric itself tenant-free. Choose by whether
  per-tenant *alerting* is required (top-N) or only per-tenant *investigation*
  (event store).

When the metrics or logging bill spikes, diagnose in this order rather than
guessing: (1) series growth — which metric's active series count moved, and
which label on it; (2) scrape interval and retention — a halved interval or
doubled retention doubles cost with no new series; (3) log volume by logger or
service — a single loop logging at INFO usually dominates; (4) trace sampling
rate — a raised sampling percentage or a newly instrumented high-QPS service.
The first two explain most metrics spikes, the last two most log/trace spikes.

**[defect] Never average precomputed quantiles.** `avg(http_latency{quantile="0.95"})`
across instances is arithmetically meaningless — a p95 of p95s is not a p95.
Aggregate the histogram instead (`histogram_quantile(0.95, sum(rate(..._bucket[5m])) by (le))`)
(https://prometheus.io/docs/practices/histograms/). Bucket choice is the other
half of this: classic histogram buckets multiply series by the number of `le`
values, so choose buckets around the SLO threshold rather than a generic decade
spread, and prefer native/exponential histograms where the backend supports them
— they give fine resolution at a fraction of the series count.

## SLO design judgment

- **[defect] SLI selection: user-visible symptoms, not internal causes.**
  "Request latency and success rate as observed by the client" is an SLI; "CPU
  usage" or "queue depth" is not — those are causes to investigate *after* an
  SLI burns budget, not things users experience directly.
- **[silence] Async pipelines need their own SLIs — freshness, lag, and queue
  age — because request latency does not exist there.** For a consumer or
  batch pipeline the user-visible symptom is "how stale is what I'm looking
  at": end-to-end freshness (event time to visible time) at a percentile,
  consumer lag or backlog age (age of the oldest unprocessed message, not the
  message count), and completeness (fraction of events processed within the
  freshness target). A pipeline with a 99.9% processing-success SLO and no
  freshness SLI can be six hours behind and still report green.
- **[silence] Error budget is an alerting and prioritization tool, not a
  scoreboard.** Its job is to answer two questions: should we page right now
  (burn rate), and should the team prioritize reliability work over features
  this cycle (budget remaining). An SLO nobody looks at until the postmortem
  isn't doing either job. That second question needs a written *error budget
  policy* — decided before the budget runs out, not during the argument: what
  happens at exhaustion (feature freeze, reliability work takes priority, a
  named person can override), who declares it, and when the budget resets
  (https://sre.google/workbook/error-budget-policy/). An SLO with no policy
  attached is a dashboard, not a control.
- **[silence] Availability targets compose multiplicatively across a
  dependency chain — for dependencies on the critical path of every request.**
  A service depending on three such upstreams each at 99.9% cannot itself
  promise 99.9% without isolating failures (fallbacks, caching, graceful
  degradation) — treat a downstream SLO as an input to the calculation, not
  something you can ignore by declaring your own target independently.
  Dependencies that are cached, optional, redundant, or hit in parallel with a
  fallback don't multiply in — but the design has to say which ones those are,
  and what happens when they're down.

## Alert design

- **[defect] Page on symptoms, ticket on causes.** "Error rate exceeded SLO
  burn threshold" pages someone now; "disk usage trending up" is a ticket for
  business hours. The exception is stated as time-to-exhaustion, not as
  judgment: "disk full in under 4 hours at the current rate" is a page,
  "disk 70% and rising" is a ticket. Conflating the two either wakes someone
  for something that can wait, or buries something urgent in a ticket queue.
- **[silence] Every page must be actionable.** If the on-call response to an
  alert is always "look at it, nothing to do, go back to sleep," that alert is
  a design defect, not a vigilance test — alert fatigue from non-actionable
  pages is what causes real pages to get ignored. Each page needs a named
  action or runbook link at the time it is written; treat a repeated no-action
  page as a bug to fix, not a fact of life.
- **[defect] Burn-rate alerts over static thresholds.** A static "error rate >
  1%" threshold either fires on noise at low traffic or misses a slow, real
  budget-burning trend. Use *multiwindow, multi-burn-rate* alerts: each long
  window paired with a short one, so the alert stops firing once the burn
  actually recovers instead of hanging on for the length of the long window
  (https://sre.google/workbook/alerting-on-slos/). The Workbook's parameters,
  for a 30-day budget:

  | Burn rate | Long window | Short window | Budget consumed | Response |
  |---|---|---|---|---|
  | 14.4x | 1h | 5m | 2% | page |
  | 6x | 6h | 30m | 5% | page |
  | 1x | 3d | 6h | 10% | ticket |

  Both windows must be over threshold for the alert to fire.

## Structured logging judgment

- **[defect] One structured event per request phase, not printf debugging left
  on.** A log line should be a queryable event with fields (`request_id`,
  `duration_ms`, `outcome`), not a human sentence. Two distinct things get
  called "debug logging" and they have opposite verdicts: ad-hoc printf-style
  lines added while chasing a bug (`log.Printf("here")`, dumped structs, bare
  values with no field names) are removed before merge — they add volume
  without adding a queryable field; structured DEBUG-*level* events emitted
  through the logger with proper fields are legitimate, stay in the merged
  code, and are turned off in production by level configuration rather than by
  deletion.
- **[defect] Log levels are a contract, not decoration.** The exact meanings
  are a house convention and vary between organisations — write yours down.
  The one used here: ERROR means "someone should look at this," WARN means
  "notable but not actionable alone," INFO is the normal operational trail,
  DEBUG is off in production by default. Whatever the convention, logging
  routine, expected conditions at ERROR trains on-call to ignore ERROR — the
  same alert-fatigue failure mode as a non-actionable page.
- **[defect] Identifiers routed into logs and traces are personal data, and
  they inherit that store's retention.** Never log raw email addresses, phone
  numbers, addresses, tokens, or whole request/response bodies; a pseudonymous
  user ID is usually acceptable, but it makes the log and trace stores subject
  to erasure requests, and a 400-day log retention or a trace backend with no
  delete-by-subject turns each request into manual work. Decide the retention
  window and the erasure path for every store that holds an identifier before
  routing identifiers there.

## Trace sampling judgment

Head sampling (decide to keep/drop at the start of a trace, before the
outcome is known) is cheap and simple but discards rare errors and slow
outliers at the same rate as everything else — a 1% head sample means 99% of
the interesting failures aren't in the sample. Tail sampling (decide after
the trace completes, based on outcome — errors, high latency) keeps the
traces worth looking at, but costs more than head sampling at an equivalent
retained-trace count: every span must cross the network and be buffered until
its trace completes, so the collector tier scales with *total* span throughput,
not with the sampled fraction — at 10k spans/s a 1% head sample ships 100
spans/s to the backend while tail sampling ships all 10k into the collector
tier first.

**[trade-off] Default to parent-based head sampling; escalate to tail sampling
only once a trace-ID-load-balanced collector tier is affordable — and say so in
the design.** Tail sampling requires every span of a trace to reach the *same*
collector instance, which in practice means a two-tier deployment: a first tier
of collectors routing by trace ID through a load-balancing exporter into a
second, stateful tail-sampling tier, sized for the buffered span volume. OTel
positions tail sampling for larger systems for exactly this reason
(https://opentelemetry.io/docs/concepts/sampling/,
https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md).
Until that tier exists, tail sampling is not an option you have; a hybrid — a
low-rate head sample for baseline plus tail-sampled errors and outliers — is the
usual destination once it does. Pure head sampling is also the right answer, not
a compromise, when uniform statistical visibility is the actual goal (capacity
planning, not debugging).

**[defect] The sampling decision is made once, at the root, and propagated —
never re-decided per service.** If each service runs its own independent
probability sampler and ignores the incoming sampled flag, a trace is kept by
some hops and dropped by others, and what arrives at the backend is a scatter of
disconnected fragments; with a 10% sampler at each of five hops, the odds of a
complete trace are 0.1^5. Configure `ParentBased(root=TraceIDRatioBased(p))` so
a service honours the parent's sampled flag and only the root span's service
decides (https://opentelemetry.io/docs/specs/otel/trace/sdk/#parentbased).

**[defect] Trace context crosses a queue in the message headers, not the
payload.** Inject the W3C `traceparent`/`tracestate` into the message's header
or attribute map on publish and extract it on consume
(https://www.w3.org/TR/trace-context/,
https://opentelemetry.io/docs/specs/semconv/messaging/) — context stuffed into
the message body couples the trace to the payload schema and is lost the moment
a consumer deserializes into a different type. Choose parent vs *link*
deliberately: a consumer whose work is a continuation of one producer request
can parent to the producer span, but a batch consumer draining messages from
many producers has no single parent and should attach each producer span as a
link, and any consumer that may sit in a queue for minutes should link rather
than parent so queue delay doesn't inflate the producer trace's duration.

## Dashboard discipline

**[defect] A dashboard answers one question.** A dashboard trying to be a
general "everything about this service" view ends up answering none well —
someone mid-incident has to hunt through panels irrelevant to the question they
actually have ("why is checkout failing right now"). Build per-question
dashboards instead: one for "is this service healthy," another for "why is
this specific flow slow." The checkable proxy: the title states the question,
every panel on the dashboard is one someone reads *while answering that
question*, and the panel count stays in single digits — past roughly a dozen,
nobody is reading them mid-incident.

Default panel layout to **RED** (request-driven services: Rate, Errors,
Duration) or **USE** (resources: Utilization, Saturation, Errors) rather than
inventing a bespoke panel set per service — consistency across services
means an on-call engineer unfamiliar with a given service can still read its
dashboard.

**[silence] Name the saturation signal explicitly — RED has no saturation
term.** The four golden signals are latency, traffic, errors, and *saturation*
(https://sre.google/sre-book/monitoring-distributed-systems/); RED covers the
first three for request-driven services and silently drops the fourth, which is
the one that predicts the outage rather than reporting it. Say which resource
fills first — thread pool, connection pool, queue depth, memory headroom, DB
connections — and put it on the dashboard next to RED, or the dashboard reads
healthy right up until the service stops.

## Related

- `resilience-patterns` (packs/event-driven) — the failure modes these alerts
  fire on: timeouts, retry storms, circuit breakers, and the fallbacks the SLO
  dependency math assumes exist.
- `event-driven-patterns` (packs/event-driven) — the async side of the
  freshness/lag SLIs above, and where trace context has to survive a broker,
  a retry, and a DLQ.
