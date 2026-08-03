---
name: resilience-patterns
description: Use when setting timeouts or retry policy for a network call, adding a circuit breaker, deciding queue or buffer sizing, placing a rate limiter, designing fallback and degraded behavior, isolating thread or connection pools, or writing liveness and readiness checks — and when diagnosing cascading failure, retry storms, thundering herds, latency collapse under load, OOM from an unbounded queue, or pods restarting because a dependency is down.
---

# Resilience Patterns

Judgment criteria for surviving partial failure. Overload and dependency
failure are operating conditions, not incidents — the design question is
always *how* the system fails, never whether.

## Timeout hierarchy

**Every network call needs an explicit timeout.** Missing does not mean "no
limit"; it means whatever the OS, client library, or load balancer decides,
usually minutes — long enough to exhaust every thread holding a request open.

**The caller's timeout must exceed the callee's total retry budget.**
Otherwise the caller gives up while the callee is still usefully retrying: the
work completes, the result is discarded, and the caller retries the whole
chain from the top. Over three hops, one slow leaf produces exponential
duplicate load. Build the budget from the leaf outward — leaf timeout ×
attempts + backoff ≤ the timeout of the layer above.

**Propagate deadlines, do not re-declare them.** Each hop passes the remaining
time (gRPC deadline, `context.Context`, a deadline header) and clamps its own
timeout to what is left. Without propagation a service keeps working for 25
seconds after the client that requested it hung up — a queue of work nobody is
waiting for, consuming exactly the capacity live traffic needs. Near-zero
remaining time should fail immediately, not start work that cannot finish.

Timeouts belong to the *operation*, not the client object: a health probe and
a bulk export through the same client need different limits.

## Retry judgment

**Retry only what a later attempt could plausibly fix.**

| Retry | Do not retry |
|---|---|
| Connection refused/reset, connect timeout | 4xx validation, auth, not-found — deterministic |
| 429, 502, 503 — transient unavailability | 400/422 — the payload is the problem |
| Idempotent operations, or any call with an idempotency key | Non-idempotent writes with no dedup key |

A *response* timeout is ambiguous — the work may have committed. Retrying it
is safe only if the operation is idempotent, which makes an idempotency key a
prerequisite for retrying writes, not an enhancement.

- **Budget the retry, don't count it.** "3 attempts" says nothing about how
  long a request may occupy a caller; a total elapsed budget does, and it
  composes with the timeout hierarchy. Cap total time first, let attempts fall
  out of it.
- **Jitter is mandatory, not a refinement.** Without it every client that
  failed at the same instant retries at the same instant, and the recovering
  dependency dies to a synchronized wave — the usual reason a service comes
  back and immediately falls over. Full jitter beats a small random offset.
- **Retries multiply load exactly when the system is weakest.** Retry at one
  layer only: a client-library retry inside an application retry inside a
  gateway retry is 27 requests per user action, and each layer's authors
  believed theirs was the only one. Audit for stacking before adding.
- **Cap retries globally.** A retry budget (retries as a share of total
  requests — abandon beyond ~10%) stops a broad outage turning every client
  into a load generator; per-call limits cannot do this.

## Circuit breaker

A breaker converts slow failure into fast failure. It earns its complexity
only when failures are *slow* (timeouts, not instant refusals), the caller has
something better to do than wait, and failures cluster rather than being
isolated. If failures return instantly and there is no fallback, a breaker
adds state and a new failure mode while changing nothing observable.

- **Trip on failure rate within a window over a volume threshold, never a raw
  count.** Five failures out of five at 3am is noise; five out of ten thousand
  is nothing. Count-based breakers trip on low-traffic false positives and
  miss real degradation under load.
- **Half-open must admit a strictly limited number of probes** — one, or a
  few — while everyone else keeps failing fast. Reopening the floodgates
  re-kills the recovering dependency and the breaker oscillates, turning an
  outage into a periodic one instead of resolving it.
- **Scope per dependency, not per process.** One breaker for "the database"
  trips on a single slow analytical query and takes every healthy operation
  with it.
- A breaker with no fallback only converts timeouts into errors sooner — real
  value when it protects the caller's capacity, but say so rather than
  assuming the breaker "handles" the failure.

## Backpressure vs buffering

**An unbounded queue does not absorb overload — it converts overload into
memory exhaustion plus unbounded latency.** Arrival above service rate grows
depth without limit; callers time out and retry; the queue fills with work
whose requesters have already left; the process OOMs, losing the whole buffer,
having served no one. Bounded queues fail earlier, cheaper, comprehensibly.

- **Every queue, channel, pool, and buffer needs an explicit bound** and a
  stated policy at that bound: block the producer (backpressure), drop oldest,
  drop newest, or reject with a retryable error.
- **Bound by latency, not memory.** Depth ÷ service rate is the wait an item
  will experience; keep it under the caller's timeout. Anything deeper is
  guaranteed-stale work.
- **Shed at the edge**, where a request is cheapest to reject and the client
  can be told to back off. Shedding after auth, database reads, and half the
  business logic means paying nearly full cost for every request you discard.
- **Shed by priority:** bulk, batch, and retry traffic before interactive
  requests; anonymous before authenticated. Uniform shedding degrades
  everything equally, which is rarely what anyone wants.
- Prefer **rejecting fast over timing out slow** — a 503 with `Retry-After`
  lets a client decide; a 30-second timeout burns capacity on both sides.

## Rate limiting placement

- **Ingress limits protect you from clients; egress limits protect
  dependencies from you.** Most systems have the first and forget the second,
  then discover a backfill saturating a third-party API.
- **Limit per tenant, key, or user — not globally.** One global limit lets a
  heavy client starve everyone, and a ceiling generous enough for legitimate
  aggregate traffic never triggers on the abusive caller.
- A per-instance in-process limiter is a per-instance limit: with N replicas
  the real ceiling is N×, and it moves whenever you scale. Use a shared
  counter when the number has to mean something.
- Return `429` with `Retry-After`. A limiter that silently drops or hangs
  teaches clients to retry harder.

## Graceful degradation

Decide what to shed **before** the incident; under load nobody redesigns.
Preference order:

1. **Precomputed or cached data**, even stale — marked stale in the response.
2. **Reduced result**: fewer items, no personalization or enrichment.
3. **Static fallback**: default ranking, generic content.
4. **Explicit error** — last resort, still better than hanging.

Stale usually beats nothing, but not always: a stale price, balance,
permission, or safety flag can be worse than an error. Classify each read as
"stale acceptable" or "must be fresh" at design time — that classification
*is* the degradation plan.

Degraded mode must be exercised in normal conditions (a flag, a periodic
drill). A fallback that only runs during an incident is untested code running
at the worst possible moment, and is frequently the actual cause of the outage.

## Bulkheads

Isolate resources so one failing dependency cannot consume all of them. The
classic failure: a slow dependency occupies every thread or connection in a
shared pool, and requests that never touch it start failing too.

- Separate pools (threads, connections, concurrency permits) per downstream
  dependency, sized to that dependency's capacity.
- Isolate by **criticality** too: background, batch, and export work must not
  draw from the pool serving interactive traffic.
- Bulkheads trade utilization for containment. Idle capacity in isolated pools
  is the price of not letting one dependency take down everything — name the
  trade rather than tuning it away.

## Health checks

**Liveness must not depend on downstream dependencies.** A liveness probe that
checks the database goes unhealthy during a database outage, the orchestrator
restarts every replica, warm caches and in-memory state are lost, and the
restarts hammer the recovering database — a total outage manufactured from a
partial one. Liveness answers one question: *is this process wedged such that
only a restart can fix it?*

| Check | Asks | Depends on | On failure |
|---|---|---|---|
| Liveness | Is the process unrecoverable? | Nothing external | Restart |
| Readiness | Can it serve traffic now? | Own capacity; hard deps only | Remove from LB |
| Startup | Has initialization finished? | Warm-up work | Delay other probes |

- Readiness may reflect a **hard** dependency but never a soft one — going
  unready because an optional recommendation service is down removes healthy
  capacity and turns a degraded feature into a full outage.
- When every replica shares a dependency, readiness on it makes every replica
  unready at once. Prefer serving degraded responses over going unready.
- Health endpoints need their own timeouts and must stay cheap; a probe that
  does real work fails first under load, exactly when you need the instance.

## Related

- `event-driven-patterns` (same pack) — retry, DLQ, and idempotency on the
  asynchronous path.
- `k8s-patterns` (packs/k8s) — probes, resource limits, PodDisruptionBudget.
- `gcp-patterns` (packs/gcp) — quota-specific retry and backoff judgment.
