# resilience-patterns — review checklist

Derived from ../SKILL.md. Consumed by the `review` (defects), `design-review` (silences + trade-offs) and `grilling` (trade-offs) workflows. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: resilience:timeout-missing
  rule: Every network call carries an explicit timeout.
  check: HTTP/gRPC/DB/queue client constructed or called without a timeout/deadline (e.g. Go http.Client zero value, context.Background() passed to an outbound call, JDBC socket read with no timeout).
  section: "## Timeout hierarchy"

- id: resilience:caller-timeout-under-callee-budget
  rule: The caller's timeout exceeds the callee's total retry budget.
  check: For each hop, compare the caller's configured timeout against the callee's per-attempt timeout × max attempts + backoff; flag any caller timeout that is not strictly larger.
  section: "## Timeout hierarchy"

- id: resilience:deadline-not-propagated
  rule: Each hop propagates the remaining deadline and clamps to it instead of re-declaring a fresh timeout.
  check: Handler creates a new timeout from a fresh/background context rather than deriving from the inbound context, gRPC deadline, or deadline header; also flag work started when remaining time is below that call's own p50.
  section: "## Timeout hierarchy"

- id: resilience:retry-non-retryable
  rule: Retry only what a later attempt could plausibly fix.
  check: Retry predicate that retries 400/422, auth, or validation errors; a predicate that excludes 408 or 429; a retry on a non-idempotent write with no idempotency key.
  section: "## Retry judgment"

- id: resilience:retry-count-without-budget
  rule: Budget the retry, don't count it — cap total elapsed time first.
  check: Retry config exposing maxAttempts/maxRetries with no total elapsed or deadline budget bounding the whole call.
  section: "## Retry judgment"

- id: resilience:retry-without-jitter
  rule: Jitter is mandatory on every backoff.
  check: Backoff computed as a pure exponential or fixed sleep with no randomization (no rand/jitter term in the delay calculation, jitter disabled in library config).
  section: "## Retry judgment"

- id: resilience:backoff-cap-without-attempt-limit
  rule: Cap the backoff delay, then cap the attempts.
  check: A max-interval/cap is configured but retries are unlimited or bounded only by a time budget far above the cap — every client then retries forever at the capped interval.
  section: "## Retry judgment"

- id: resilience:retry-stacked-layers
  rule: Retry at one layer only.
  check: Retries enabled at more than one layer of the same path — SDK/client-library defaults plus an application retry wrapper plus a gateway/service-mesh retry policy. Check library defaults, not just explicit code.
  section: "## Retry judgment"

- id: resilience:no-retry-budget
  rule: Cap retries globally with a retry budget, not only per call.
  check: No client-wide budget (retry share of total requests, or a token bucket) anywhere on the path; only per-call attempt limits.
  section: "## Retry judgment"

- id: resilience:breaker-count-trip
  rule: Breakers trip on failure rate in a bounded window with a minimum-call floor, never a bare lifetime counter.
  check: Breaker configured with a raw failure count and no window, or a rate with no minimum-call/volume threshold before the rate is evaluated.
  section: "## Circuit breaker"

- id: resilience:half-open-unbounded
  rule: Half-open admits a strictly limited number of probes.
  check: Half-open state that admits all traffic — no permitted-calls-in-half-open setting, or a probe limit equal to normal concurrency.
  section: "## Circuit breaker"

- id: resilience:breaker-shared-scope
  rule: Scope a breaker per dependency, not per process.
  check: One breaker instance shared across every operation of a process, or one breaker for a whole datastore covering unrelated query classes.
  section: "## Circuit breaker"

- id: resilience:unbounded-queue
  rule: An unbounded queue converts sustained overload into memory exhaustion.
  check: Unbounded channel/queue/executor queue on a path fed asynchronously — Go `make(chan T)` with an unbounded producer, `LinkedBlockingQueue` with no capacity, slice/list append in a worker loop.
  section: "## Backpressure vs buffering"

- id: resilience:queue-bound-policy-unstated
  rule: Every queue, channel, pool and buffer has an explicit bound and a stated policy at that bound.
  check: Bounded structure with no defined behavior at the bound — a blocking send with no documented backpressure intent, a dropped item with no drop-oldest/drop-newest choice, or an ignored send error.
  section: "## Backpressure vs buffering"

- id: resilience:queue-depth-not-latency-bound
  rule: Bound queues by latency, not memory.
  check: Capacity picked from a memory figure or a round number; recompute depth ÷ service rate and flag when it exceeds the caller's timeout.
  section: "## Backpressure vs buffering"

- id: resilience:shed-after-expensive-work
  rule: Shed at the edge, where a request is cheapest to reject.
  check: Load shedding or 503 emitted after authentication, database reads, or business logic — a shedding middleware registered late in the chain, or a limiter inside a service handler rather than at the gateway.
  section: "## Backpressure vs buffering"

- id: resilience:health-check-shed
  rule: Never shed health-check traffic.
  check: Shedding, rate-limiting, or concurrency-limiting filter with no exemption for the probe and load-balancer health endpoints.
  section: "## Backpressure vs buffering"

- id: resilience:egress-limit-missing
  rule: Ingress limits protect you from clients; egress limits protect dependencies from you — have both.
  check: Outbound callers (third-party APIs, backfills, batch/export jobs) with no client-side rate limit while ingress limiting exists.
  section: "## Rate limiting placement"

- id: resilience:global-rate-limit
  rule: Limit per tenant, key, or user — not globally.
  check: Limiter keyed on nothing (a single global bucket) rather than tenant/API key/user; also flag a per-instance in-process limiter presented as a system-wide ceiling.
  section: "## Rate limiting placement"

- id: resilience:liveness-checks-dependency
  rule: Liveness should not depend on downstream dependencies.
  check: Liveness/healthz handler or probe command that touches a database, cache, or another service; readiness logic reused as the liveness handler.
  section: "## Health checks"

- id: resilience:no-sigterm-drain
  rule: Drain on SIGTERM, do not exit on it.
  check: SIGTERM handler that exits immediately (os.Exit, no server.Shutdown/graceful stop), no readiness flip before draining, or a termination grace period shorter than the drain time.
  section: "## Health checks"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: resilience:failure-behavior-unstated
  rule: For each external dependency the design states timeout, retry policy and behavior on failure.
  check: List every external dependency the design introduces or touches; flag each with no stated failure behavior.
  section: "## Timeout hierarchy", "## Retry judgment"

- id: resilience:timeout-value-unjustified
  rule: Each timeout value comes from an accepted false-timeout rate and the dependency's matching latency percentile.
  check: Timeout numbers given with no stated basis — flag round figures (30s, 5s, 1s) where the design names no percentile, no accepted false-timeout rate, and no padding for internet paths or a tight p50–p99.9 spread.
  section: "## Timeout hierarchy"

- id: resilience:shed-priority-unstated
  rule: The design names the shed classes and which shed point applies each — edge-cheap signals at the edge, caller-identity priority only after auth.
  check: Shedding described without a priority order, or with an identity-based order (anonymous before authenticated, free before paid) placed at the edge where auth has not happened yet.
  section: "## Backpressure vs buffering"

- id: resilience:fail-open-or-closed-unstated
  rule: Every dependency in the request path is marked fail-open or fail-closed.
  check: Walk the dependencies the design names (authz, rate limiter, feature flags, cache, enrichment) and flag each with no stated direction — especially a blanket "serve cached data" that would also cover authorization.
  section: "## Graceful degradation"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: resilience:breaker-or-failfast
  rule: Circuit breaker vs fail-fast / token-bucket retry limiting.
  options: breaker (fast recovery signal, modal behavior hard to test) | token bucket (no modes, slower to stop hammering) | plain timeout + no retry (simplest, no protection for the dependency)
  section: "## Circuit breaker", "## Retry judgment"

- id: resilience:reject-fast-or-wait
  rule: Rejecting fast vs letting the caller wait out the timeout.
  options: 503 + Retry-After immediately (caller decides, capacity freed on both sides, some requests rejected that would have succeeded) | queue and let it time out (no premature rejection, burns capacity on both sides and returns nothing) | queue with a latency-bounded depth (middle ground, needs a service-rate estimate to size)
  section: "## Backpressure vs buffering"

- id: resilience:jitter-full-or-decorrelated
  rule: Full jitter vs decorrelated jitter for backoff.
  options: full jitter (maximum spread, longest expected total delay) | decorrelated jitter (recovers faster, AWS's comparison against full jitter is not clear-cut) | small random offset (barely spreads a synchronized wave — not a real option)
  section: "## Retry judgment"

- id: resilience:bulkhead-isolation-vs-utilization
  rule: Per-dependency isolation vs pool utilization.
  options: separate pools per dependency and per criticality (one slow dependency cannot take the process down, idle capacity in every pool) | one shared pool (best utilization, a single slow dependency starves unrelated requests) | shared pool with per-dependency concurrency permits (cheaper isolation, permits still need Little's-law sizing)
  section: "## Bulkheads"
