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
| "What exactly happened on this one request?" | Logs | Full-fidelity events, structured, for debugging one incident. |
| "Is the system healthy right now / should I alert?" | Metrics | Cheap aggregates over time, built for dashboards and alert thresholds. |
| "Where in this request's call graph did the time go or the failure happen?" | Traces | Causality across services — logs and metrics can't show a request's path through five hops. |

**Deriving metrics from logs at query time is a cost trap at scale.** Running
a log-aggregation query to compute a rate/percentile that's needed
repeatedly (every dashboard refresh, every alert eval) re-scans raw log
volume each time. Emit a metric directly at the point the event happens
instead — log-derived metrics belong to occasional investigation, not
recurring alerting or dashboards.

## Cardinality discipline

Label/attribute cardinality — not event volume — is what determines metrics
query performance and cost.

- **Never put user ID, request ID, session ID, or any per-request unique
  value in a metric label.** Each unique label combination creates a new
  time series; a user-id label turns one metric into millions of series,
  which is what actually causes "the metrics backend is slow/expensive" —
  not the request volume itself.
- High-cardinality identifiers belong in traces (as span attributes) or logs
  (as structured fields), where per-event storage is the model, not
  per-series aggregation. Route the identifier to the signal built for it —
  don't force it into a metric label because "it'd be convenient to filter
  by it on the dashboard."
- Bounded, low-cardinality dimensions (HTTP method, status-code class, route
  *template* — not the raw path with IDs interpolated, region, service name)
  are what metric labels are for.

## SLO design judgment

- **SLI selection: user-visible symptoms, not internal causes.** "Request
  latency and success rate as observed by the client" is an SLI; "CPU usage"
  or "queue depth" is not — those are causes to investigate *after* an SLI
  burns budget, not things users experience directly.
- **Error budget is an alerting and prioritization tool, not a scoreboard.**
  Its job is to answer two questions: should we page right now (burn rate),
  and should the team prioritize reliability work over features this cycle
  (budget remaining). An SLO nobody looks at until the postmortem isn't
  doing either job.
- **Availability targets compose multiplicatively across a dependency
  chain.** A service depending on three upstreams each at 99.9% cannot
  itself promise 99.9% without isolating failures (fallbacks, caching,
  graceful degradation) — treat a downstream SLO as an input to the
  calculation, not something you can ignore by declaring your own target
  independently.

## Alert design

- **Page on symptoms, ticket on causes.** "Error rate exceeded SLO burn
  threshold" pages someone now; "disk usage trending up" is a ticket for
  business hours unless it's about to cause an outage. Conflating the two
  either wakes someone for something that can wait, or buries something
  urgent in a ticket queue.
- **Every page must be actionable.** If the on-call response to an alert is
  always "look at it, nothing to do, go back to sleep," that alert is a
  design defect, not a vigilance test — alert fatigue from non-actionable
  pages is what causes real pages to get ignored. Treat a repeated no-action
  page as a bug to fix, not a fact of life.
- **Burn-rate alerts over static thresholds.** A static "error rate > 1%"
  threshold either fires on noise at low traffic or misses a slow, real
  budget-burning trend. A burn-rate alert (a fast window for acute pages, a
  slower window for ticket-level warnings) catches both without a
  hair-trigger.

## Structured logging judgment

- **One structured event per request phase, not printf debugging left on.**
  A log line should be a queryable event with fields (`request_id`,
  `duration_ms`, `outcome`), not a human sentence. Debug-level logging
  scattered through business logic during development is a smell if it
  survives into merged code — it adds volume without adding a queryable
  field.
- **Log levels are a contract, not decoration.** ERROR means "someone should
  look at this," WARN means "notable but not actionable alone," INFO is the
  normal operational trail, DEBUG is off in production by default. Logging
  routine, expected conditions at ERROR trains on-call to ignore ERROR —
  the same alert-fatigue failure mode as a non-actionable page.

## Trace sampling judgment

Head sampling (decide to keep/drop at the start of a trace, before the
outcome is known) is cheap and simple but discards rare errors and slow
outliers at the same rate as everything else — a 1% head sample means 99% of
the interesting failures aren't in the sample. Tail sampling (decide after
the trace completes, based on outcome — errors, high latency) keeps the
traces worth looking at, but costs more (must buffer the full trace before
deciding) and needs collector support. Default to tail sampling — or a
hybrid: a low-rate head sample for baseline plus tail-sampled errors/
outliers — for anything where the failure cases are the reason tracing
exists at all. Pure head sampling is only fine when uniform statistical
visibility is the actual goal (capacity planning, not debugging).

## Dashboard discipline

**A dashboard answers one question.** A dashboard trying to be a general
"everything about this service" view ends up answering none well — someone
mid-incident has to hunt through panels irrelevant to the question they
actually have ("why is checkout failing right now"). Build per-question
dashboards instead: one for "is this service healthy," another for "why is
this specific flow slow."

Default panel layout to **RED** (request-driven services: Rate, Errors,
Duration) or **USE** (resources: Utilization, Saturation, Errors) rather than
inventing a bespoke panel set per service — consistency across services
means an on-call engineer unfamiliar with a given service can still read its
dashboard.
