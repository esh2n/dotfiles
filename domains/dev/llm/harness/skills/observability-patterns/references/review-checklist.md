# observability-patterns — review checklist

Derived from ../SKILL.md. Consumed by the `review` (defects), `design-review` (silences + trade-offs) and `grilling` (trade-offs) workflows. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: observability:unbounded-label
  rule: No metric label carries a per-request or per-user unique value (exemplars excepted).
  check: label keys/values built from user ID, request ID, session ID, trace ID, order/job ID, raw URL path with IDs interpolated, email; any label whose value comes from a request field rather than a fixed enum. An exemplar (trace ID attached to a sample, not to the series identity) is not a finding.
  section: "## Cardinality discipline"

- id: observability:no-series-budget
  rule: Every label has a stated value ceiling (~100 values) and every metric a stated series budget.
  check: new or changed metric definitions with no enumerable value set for a label, or a label whose values cannot be listed at review time; multiply label cardinalities × instance count and compare against a stated budget — absent budget on a new metric is the finding.
  section: "## Cardinality discipline"

- id: observability:averaged-quantile
  rule: Precomputed quantiles are never averaged; aggregate the histogram instead.
  check: grep alert/dashboard/recording-rule expressions for `avg(`, `sum(`/count division, or `mean` applied to a series carrying `quantile=` / `p95` / `p99`; correct form is `histogram_quantile(..., sum(rate(x_bucket[...])) by (le))`. Also flag classic-histogram bucket sets unrelated to the SLO threshold.
  section: "## Cardinality discipline"

- id: observability:cause-based-sli
  rule: SLIs are user-visible symptoms, not internal causes.
  check: SLO/SLI definitions and their queries — CPU utilization, memory, queue depth, GC time, pod restarts named as the SLI rather than as an investigation signal.
  section: "## SLO design judgment"

- id: observability:cause-paged
  rule: Pages fire on symptoms; causes are tickets unless expressed as a short time-to-exhaustion.
  check: alert rules with `severity: page`/pager routing whose expression is a resource level (disk %, memory %, CPU, replica count) with no rate-of-exhaustion term; a page keyed on "full in < N hours" is fine, a page on "> 70%" is a finding.
  section: "## Alert design"

- id: observability:static-threshold-alert
  rule: SLO alerting uses multiwindow multi-burn-rate, not a static error-rate threshold.
  check: alert expressions comparing an error ratio to a fixed constant (`> 0.01`) with a single `for:` window; correct form pairs a long window with a short one at 14.4x/1h+5m, 6x/6h+30m (page) and 1x/3d+6h (ticket), both windows required to fire.
  section: "## Alert design"

- id: observability:printf-debug-merged
  rule: Ad-hoc printf-style debug lines are removed before merge; structured DEBUG-level events through the logger may stay.
  check: added `log.Printf`/`println`/`console.log`/`fmt.Println`, dumped structs, and bare unlabelled values in the diff. A `logger.Debug(...)` call carrying named fields is not a finding.
  section: "## Structured logging judgment"

- id: observability:unstructured-or-mislevelled-log
  rule: Log lines are queryable events with fields, and log levels follow the stated house convention.
  check: added log calls whose payload is an interpolated human sentence with no fields; expected/routine conditions (validation rejection, 404, retry that succeeded) emitted at ERROR; the repo has no written level convention to check against.
  section: "## Structured logging judgment"

- id: observability:pii-in-telemetry
  rule: No raw PII in logs or span attributes; identifier-bearing stores have a declared retention and erasure path.
  check: log fields or span attributes named email, phone, address, name, token, password, card, or whole request/response bodies; a pseudonymous user ID is acceptable only where the store's retention and delete-by-subject path is stated.
  section: "## Structured logging judgment"

- id: observability:per-service-sampling
  rule: The sampling decision is made at the root and propagated, never re-decided per service.
  check: SDK/collector config using a bare `TraceIDRatioBased`/probabilistic sampler as the service sampler, or code ignoring the incoming sampled flag; expected form is `ParentBased(root=TraceIDRatioBased(p))`.
  section: "## Trace sampling judgment"

- id: observability:context-not-propagated-over-queue
  rule: Trace context crosses a queue via W3C traceparent/tracestate in message headers, with link vs parent chosen deliberately.
  check: publish/consume code that omits inject/extract on the message header or attribute map, or stuffs trace IDs into the payload body; batch or long-delay consumers parenting to the producer span instead of adding a span link.
  section: "## Trace sampling judgment"

- id: observability:kitchen-sink-dashboard
  rule: One dashboard answers one named question; panels stay in single digits.
  check: dashboard JSON/definition with a generic title ("Service overview", "All metrics"), a panel count past ~12, or panels nobody would read while answering the title's question.
  section: "## Dashboard discipline"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: observability:async-sli-unstated
  rule: An async pipeline design names freshness, lag/backlog age, and completeness SLIs — not just processing success.
  check: for consumer/batch/stream components, look for an end-to-end freshness percentile and an oldest-unprocessed-message age; flag when only a success rate or a message count is defined — the pipeline can be hours behind and still green.
  section: "## SLO design judgment"

- id: observability:error-budget-policy-unstated
  rule: The design states what happens when the error budget is exhausted, who declares it, and when it resets.
  check: look for a written error budget policy alongside the SLO (feature freeze, reliability work priority, named override); flag an SLO with a target and burn alerts but no exhaustion consequence.
  section: "## SLO design judgment"

- id: observability:dependency-math-unstated
  rule: The design shows how its availability target survives its critical-path dependencies, and names which dependencies are cached/optional/redundant.
  check: compare the stated target against the product of every dependency hit on every request; flag a target equal to or better than a critical-path upstream with no fallback, cache, or degradation named.
  section: "## SLO design judgment"

- id: observability:page-action-unstated
  rule: Every page names its action or runbook at the time it is written.
  check: new alert rules routed to a pager with no runbook link, annotation, or described response; also flag an existing page with a known history of no-action responses left in place.
  section: "## Alert design"

- id: observability:saturation-signal-unstated
  rule: The design names the saturation signal — which resource fills first — alongside RED.
  check: dashboards or monitoring plans covering rate/errors/duration only; flag when no thread pool, connection pool, queue depth, memory headroom or DB connection limit is named as the thing that fills.
  section: "## Dashboard discipline"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: observability:aggregate-at-ingest-or-query
  rule: Pre-aggregate at ingest vs derive from wide events at query time.
  options: recording rules / direct metrics at ingest (cheap repeated reads, fixed dimensions decided up front) | event-native query-time aggregation (arbitrary post-hoc dimensions, cost scales with query volume) | both (metrics for alerting, raw events retained for investigation)
  section: "## The three signals judgment"

- id: observability:per-tenant-breakdown
  rule: How to get a per-tenant view without a tenant label.
  options: bounded top-N tenant label with an `other` bucket (per-tenant alerting works, membership needs recomputing, tail tenants invisible) | route the tenant dimension to a columnar event store or trace attribute (any tenant investigable, no per-tenant alerting) | decide by whether alerting or only investigation is required
  section: "## Cardinality discipline"

- id: observability:head-or-tail-sampling
  rule: Head (parent-based) vs tail sampling.
  options: parent-based head (stateless, cheap, misses rare failures; right when uniform statistical visibility is the goal) | tail (keeps errors and outliers, needs a trace-ID-load-balanced two-tier stateful collector sized for total span throughput) | hybrid low-rate head baseline plus tail-sampled errors/outliers, once that tier exists
  section: "## Trace sampling judgment"
