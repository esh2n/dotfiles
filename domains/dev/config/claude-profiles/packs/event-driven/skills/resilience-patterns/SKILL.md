---
name: resilience-patterns
description: Use when setting timeouts or retry policy for a network call, adding a circuit breaker, deciding queue or buffer sizing, placing a rate limiter, designing fallback and degraded behavior, isolating thread or connection pools, or writing liveness and readiness checks — and when diagnosing cascading failure, retry storms, thundering herds, latency collapse under load, OOM from an unbounded queue, or pods restarting because a dependency is down.
---

# Resilience Patterns

Judgment criteria for surviving partial failure. Overload and dependency
failure are operating conditions, not incidents — the design question is
always *how* the system fails, never whether.

## Timeout hierarchy

**[defect] Every network call needs an explicit timeout.** Missing does not
mean "no limit"; it means whatever the OS, client library, or load balancer
decides, which runs from tens of seconds to never — Go's zero-value
`http.Client` and a default JDBC socket read never give up on their own — long
enough to exhaust every thread holding a request open.

**[silence] Pick the number from the dependency's latency distribution, not a
round figure.** Decide the false-timeout rate you can accept — 0.1% of calls,
say — then set the timeout at the matching percentile of the downstream's
observed latency (p99.9 for 0.1%). Two caveats: across the internet the tail is
fatter than any percentile measured internally, so pad it; and when p99.9 sits
close to p50 the distribution is too tight to leave headroom, so pad there too
rather than trusting the measurement
(https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter).

**[defect] The caller's timeout must exceed the callee's total retry budget.**
Otherwise the caller gives up while the callee is still usefully retrying: the
work completes, the result is discarded, and the caller retries the whole
chain from the top. Over three hops, one slow leaf produces exponential
duplicate load. Build the budget from the leaf outward — leaf timeout ×
attempts + backoff ≤ the timeout of the layer above.

**[defect] Propagate deadlines, do not re-declare them.** Each hop passes the
remaining time (gRPC deadline, `context.Context`, a deadline header) and
clamps its own timeout to what is left. Without propagation a service keeps
working for 25 seconds after the client that requested it hung up — a queue of
work nobody is waiting for, consuming exactly the capacity live traffic needs.
Remaining time below this call's own p50 should fail immediately, not start
work that cannot finish.

Sizing and enforcement are two separate passes, and that is what resolves the
apparent conflict between building outward and clamping inward: size the
budgets from the leaf outward at design time, then let the propagated deadline
win at runtime — no hop may extend its budget beyond the remaining time it was
handed. A three-hop example. The edge gives the user 3s and does not retry; it
calls service B with a 2.8s deadline. B is the one retrying layer: leaf C's p99
is 200ms, so B uses a 400ms per-attempt timeout and a 1.2s total retry budget —
three attempts with jitter between them — which fits inside the 2.8s it was
handed with room for its own work. C retries nothing and clamps each attempt to
whatever is left of B's deadline. Edge and C are timeout-only, B owns the
retries, every deadline is derived from the one above it, and the leaf-outward
arithmetic is what proves B's 1.2s fits.

Timeouts belong to the *operation*, not the client object: a health probe and
a bulk export through the same client need different limits.

## Retry judgment

**[defect] Retry only what a later attempt could plausibly fix.**

| Retry | Do not retry |
|---|---|
| Connection refused/reset, connect timeout | 4xx except 408 and 429 — validation, auth, not-found; deterministic |
| 429, 502, 503 — transient unavailability | 400/422 — the payload is the problem |
| Idempotent operations, or any call with an idempotency key | Non-idempotent writes with no dedup key |

The 4xx/5xx line is not a reliable retry boundary on its own: 408 and 429 are
explicitly repeatable (RFC 9110 §15.5.9, RFC 6585 §4), and under eventual
consistency a dependency can return not-found or a validation error for a write
that will be visible a moment later.

A *response* timeout is ambiguous — the work may have committed. Retrying it
is safe only if the operation is idempotent, which makes an idempotency key a
prerequisite for retrying writes, not an enhancement.

- **[defect] Budget the retry, don't count it.** "3 attempts" says nothing
  about how long a request may occupy a caller; a total elapsed budget does,
  and it composes with the timeout hierarchy. Cap total time first, let
  attempts fall out of it.
- **[defect] Jitter is mandatory, not a refinement.** Without it every client
  that failed at the same instant retries at the same instant, and the
  recovering dependency dies to a synchronized wave — the usual reason a
  service comes back and immediately falls over. Full jitter beats a small
  random offset; between full and decorrelated jitter AWS's own measurements
  are less clear-cut, so treat that as a choice rather than a settled default
  (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
- **[defect] Cap the backoff delay, then cap the attempts.** Uncapped
  exponential growth eventually produces delays no caller will wait for, so
  every implementation caps the maximum delay — but once every client has
  reached that cap they are all retrying at the same steady interval, a
  constant load floor on a dependency that is still down. The cap needs an
  attempt or elapsed-time limit behind it, which is the same discipline as
  budgeting the retry rather than counting it
  (https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter).
- **[defect] Retries multiply load exactly when the system is weakest.** Retry
  at one layer only: three layers each making 3 attempts — a client library
  inside an application inside a gateway — is 27 requests per user action, and
  each layer's authors believed theirs was the only one. Audit for stacking
  before adding.
- **[defect] Cap retries globally.** A retry budget (retries as a share of
  total requests — abandon beyond ~10%, the figure from the Google SRE Book's
  "Handling Overload", https://sre.google/sre-book/handling-overload/) stops a
  broad outage turning every client into a load generator; per-call limits
  cannot do this. Treat the 10% as that book's number rather than a universal
  default: Envoy's retry budget defaults to 20% and is concurrency-based, and
  gRPC (gRFC A6) uses a token bucket that stops retrying at half its maximum
  tokens.

## Circuit breaker

A breaker converts slow failure into fast failure. It earns its complexity
only when failures are *slow* (timeouts, not instant refusals), the caller has
something better to do than wait, and failures cluster rather than being
isolated — the observable is the dependency's error rate over a rolling
window, and if it never sustains something like 20% over a minute there is
nothing for a breaker to latch onto. If failures return instantly and there is
no fallback, a breaker adds state and a new failure mode while changing
nothing observable.

- **[defect] Trip on failure rate within a bounded window, with a minimum-call
  floor before the rate counts.** What is wrong is the bare lifetime counter:
  five failures out of five at 3am is noise; five out of ten thousand is
  nothing. Count-based breakers trip on low-traffic false positives and
  miss real degradation under load.
- **[defect] Half-open must admit a strictly limited number of probes** — one,
  or a few — while everyone else keeps failing fast. Reopening the floodgates
  re-kills the recovering dependency and the breaker oscillates, turning an
  outage into a periodic one instead of resolving it.
- **[defect] Scope per dependency, not per process.** One breaker for "the
  database" trips on a single slow analytical query and takes every healthy
  operation with it.
- A breaker with no fallback only converts timeouts into errors sooner — real
  value when it protects the caller's capacity, but say so rather than
  assuming the breaker "handles" the failure.

## Backpressure vs buffering

**[defect] An unbounded queue does not absorb sustained overload — it converts
overload into memory exhaustion plus unbounded latency.** Arrival above
service rate grows depth without limit; callers time out and retry; the queue
fills with work whose requesters have already left; the process OOMs, losing
the whole buffer, having served no one. Bounded queues fail earlier, cheaper,
comprehensibly.

- **[defect] Every queue, channel, pool, and buffer needs an explicit bound**
  and a stated policy at that bound: block the producer (backpressure), drop
  oldest, drop newest, or reject with a retryable error.
- **[defect] Bound by latency, not memory.** Depth ÷ service rate is the wait
  an item will experience; keep it under the caller's timeout. Anything deeper
  is guaranteed-stale work.
- **[defect] Shed at the edge**, where a request is cheapest to reject and the
  client can be told to back off. Shedding after auth, database reads, and half
  the business logic means paying nearly full cost for every request you
  discard.
- **[silence] Shed by priority, and protect in layers.** At the edge only
  edge-cheap signals are available — route, API key, tenant header, a
  retry marker — so that is where bulk, batch, and retry traffic is dropped
  ahead of interactive requests. Priority that depends on who the caller is
  (anonymous before authenticated, free tier before paid) can only be applied
  at a second, deeper shed point after authentication. Uniform shedding
  degrades everything equally, which is rarely what anyone wants.
- **[defect] Never shed health-check traffic.** The most important request to
  keep serving in a brownout is the load balancer's ping: shed it and the
  instance is pulled from the pool, its load moves to the survivors, and the
  fleet shrinks at exactly the moment you need it whole
  (https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/).
- Prefer **[trade-off] rejecting fast over timing out slow** — a 503 with
  `Retry-After` lets a client decide; a 30-second timeout burns capacity on
  both sides.

## Rate limiting placement

- **[defect] Ingress limits protect you from clients; egress limits protect
  dependencies from you.** Most systems have the first and forget the second,
  then discover a backfill saturating a third-party API.
- **[defect] Limit per tenant, key, or user — not globally.** One global limit
  lets a heavy client starve everyone, and a ceiling generous enough for
  legitimate aggregate traffic never triggers on the abusive caller.
- A per-instance in-process limiter is a per-instance limit: with N replicas
  the real ceiling is N×, and it moves whenever you scale. Use a shared
  counter when the number has to mean something.
- Return `429`, and include `Retry-After`. A limiter that silently drops or
  hangs teaches clients to retry harder.

## Graceful degradation

Decide what to shed **before** the incident; under load nobody redesigns.
Preference order:

1. **Precomputed or cached data**, even stale — marked stale in the response.
2. **Reduced result**: fewer items, no personalization or enrichment.
3. **Static fallback**: default ranking, generic content.
4. **Explicit error** — last resort, still better than hanging.

A stale price, balance, permission, or safety flag can be worse than an error.
Classify each read as "stale acceptable" or "must be fresh" at design time —
that classification *is* the degradation plan.

**[silence] Name fail-open or fail-closed per dependency.** The preference
order above assumes stale beats nothing, which is exactly wrong for
authorization: an authz service that is unreachable must fail closed and deny,
because serving cached permissions is how a revoked user keeps their access. A
rate limiter or a feature-flag service usually fails open — admit the request
and log that the limit or flag was not evaluated — since failing closed there
turns one dependency's outage into a full one. There is no default that covers
both, so the decision is recorded per dependency or it is not made at all.

Degraded mode must be exercised in normal conditions (a flag, a periodic
drill). A fallback that only runs during an incident is untested code running
at the worst possible moment, and is frequently the actual cause of the outage.

## Bulkheads

Isolate resources so one failing dependency cannot consume all of them. The
classic failure: a slow dependency occupies every thread or connection in a
shared pool, and requests that never touch it start failing too.

- Separate pools (threads, connections, concurrency permits) per downstream
  dependency, sized by Little's law — arrival rate × p99 latency — and capped
  by the dependency's published limit.
- Isolate by **criticality** too: background, batch, and export work must not
  draw from the pool serving interactive traffic.
- Bulkheads trade utilization for containment. Idle capacity in isolated pools
  is the price of not letting one dependency take down everything — name the
  trade rather than tuning it away.

## Health checks

**[defect] Liveness should not depend on downstream dependencies.** Kubernetes
documents this as a pattern rather than a prohibition, so treat it as a strong
default with a reason: a liveness probe that checks the database goes
unhealthy during a database outage, the orchestrator restarts every replica,
warm caches and in-memory state are lost, and the restarts hammer the
recovering database — a total outage manufactured from a partial one. Liveness
answers one question: *is this process wedged such that only a restart can fix
it?*

| Check | Asks | Depends on | On failure |
|---|---|---|---|
| Liveness | Is the process unrecoverable? | Nothing external | Restart |
| Readiness | Can it serve traffic now? | Own capacity; hard deps only | Remove from LB |
| Startup | Has initialization finished? | Warm-up work | Delay other probes |

- Readiness may reflect a **hard** dependency but never a soft one — going
  unready because an optional recommendation service is down removes healthy
  capacity and turns a degraded feature into a full outage.
- Gate readiness on a hard dependency only when replicas can fail on it
  independently. When every replica shares it, readiness makes every replica
  unready at once — serve degraded responses instead.
- Health endpoints need their own timeouts and must do no I/O beyond
  in-process state, completing within the probe timeout at p99 under peak load;
  a probe that does real work fails first under load, exactly when you need the
  instance.

**[defect] Drain on `SIGTERM`, do not exit on it.** Shutdown is the readiness
signal run in reverse: on `SIGTERM` the process fails its readiness probe
first, keeps serving in-flight work while the load balancer and service
discovery notice and stop routing to it, drains, and only then exits. Exiting
on the signal drops every request still in flight, and the termination grace
period has to be longer than the drain or the runtime kills the process
mid-drain
(https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination).

## Related

- `event-driven-patterns` (same pack) — retry, DLQ, and idempotency on the
  asynchronous path.
- `k8s-patterns` (packs/k8s) — probes, resource limits, PodDisruptionBudget.
- `gcp-patterns` (packs/gcp) — quota-specific retry and backoff judgment.
- `observability-patterns` (packs/observability) — the error-rate windows,
  SLOs, and alerts these thresholds are read from.
