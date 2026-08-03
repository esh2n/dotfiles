---
name: cloudflare-patterns
description: Use when building or reviewing Cloudflare Workers projects — choosing between KV, D1, Durable Objects, R2, or Queues for storage, designing a cache strategy, debugging CPU-time-limit errors or a package that breaks at deploy, deciding Workers vs Pages Functions, or diagnosing wrangler dev vs production divergence.
---

# Cloudflare Patterns

Judgment criteria for Cloudflare Workers architecture — not a wrangler
tutorial.

## Workers runtime judgment

- Workers run on V8 isolates, not Node.js — the runtime looks like Node (via
  `nodejs_compat`) but isn't one. No `fs`, no raw TCP sockets outside
  `connect()`, no native addons (anything with a `.node` file or `node-gyp`
  build step fails outright). Packages built on Node's `net`/`tls`
  primitives (many DB drivers, some ORMs) break unless they ship a
  fetch-based/edge build — check for that before adopting a package, don't
  discover it at deploy time.
- **CPU time, not wall-clock, is the billed/limited resource.** A Worker can
  `await` a slow upstream fetch for seconds without spending CPU time —
  that's free. What burns the limit (default 30s on Bundled, configurable
  higher on Unbound) is actual computation: parsing a huge JSON payload,
  crypto, image processing, tight loops. Optimize for CPU-bound work, not
  for "the request feels slow."
- **No long-lived in-memory state across requests, with one caveat.**
  Module-scope variables can survive between requests on the same isolate as
  a best-effort cache (fine for stateless memoization), but the isolate can
  be evicted at any time — never rely on it for correctness (counters,
  sessions, locks). Durable Objects are the actual mechanism for
  request-to-request state that must be correct.

## Storage decision table

| Need | Choice | Why |
|---|---|---|
| Read-heavy config/cache, eventual consistency acceptable | KV | Fast global reads; writes propagate in seconds, not instantly — **1 write/sec per key** is a hard ceiling, not a soft guideline. A hot counter or session-per-key pattern hits it fast. |
| Relational data, need SQL, roughly single-region access | D1 | SQLite semantics (single-writer, page-level locking) — not a distributed DB. D1 has a primary region: reads elsewhere are fine, writes from the far side pay real cross-region latency. Placement is a judgment call, not an afterthought. |
| Strong consistency, serialized access to one logical entity (a room, a cart, a counter) | Durable Objects | The concurrency model IS the feature — one DO instance handles one entity's requests serially, so read-modify-write races that need a transaction elsewhere are correct by construction here. Don't reach for a DO for read-heavy shared data with no per-entity write pattern — that's a KV/D1 job with an unnecessary bottleneck. |
| Large binary objects, files, ML artifacts | R2 | **No egress fee is the deciding factor** — if the access pattern reads a lot from outside Cloudflare's network, R2 wins on cost before the S3-compatible API even matters. |
| Async fan-out, decoupling a spike from a downstream limit | Queues | The judgment call is backpressure: a Queue smooths a traffic spike into a downstream system with a lower throughput ceiling. Don't reach for one just to "feel async" if the consumer could handle the load synchronously — that's added latency and a new failure mode for no benefit. |

## Cache judgment

- **Cache API vs CDN cache vs KV** are three tools that overlap in purpose.
  Cache API (`caches.default`) caches per-datacenter with no cross-colo
  sharing, keyed by request — good for compute-derived responses a single
  edge location can regenerate cheaply. CDN cache (cache-control headers,
  Cloudflare's own edge cache) is the right default for static/semi-static
  assets — Cloudflare already does this without custom Worker code. KV is
  global and durable but eventually consistent — use it when the same value
  must be readable from any colo, not as a faster Cache API.
- **Cache key design determines the hit rate.** Including query params,
  headers (`Vary`), or cookies in the key that don't actually change the
  response fragments the cache into near-unique keys per request — measure
  actual hit rate per route, don't assume the default key is right.
- **stale-while-revalidate** when the data is expensive to regenerate and a
  slightly-stale response is an acceptable latency trade — serve the cached
  value immediately, refresh in the background. Wrong for anything where
  staleness is a correctness bug (pricing, auth state); right for content
  that's expensive and tolerant of being a few seconds old.

## Workers vs Pages Functions placement

Default to Workers for anything beyond a static site with light dynamic
routes. Pages Functions are Workers underneath, constrained to a file-based
routing convention tied to a Pages project — reach for them only when the
project already is a Pages static site and needs a few dynamic routes bolted
on. A standalone API, a cron-triggered job, or anything using Durable
Objects/Queues belongs in a plain Worker; fighting Pages' routing convention
for a non-trivial backend is wasted effort.

## Cold start reality

Isolate cold starts are fast (single-digit ms) next to container cold
starts — but "fast" isn't "free." Binding initialization (D1 connections, DO
stubs, KV namespace setup) and any top-level module code still run on every
cold start. A Worker with heavy top-level imports or eager module-scope
initialization pays that cost on every isolate spin-up, not once — keep
module-scope work minimal and defer anything expensive into the request
handler.

## Cost model traps

- **Durable Object billing is duration-based, not request-based.** A DO
  holding a WebSocket open or doing long polling bills for the whole time
  it's alive, not per message. A chatty long-lived DO can cost far more than
  the request count suggests — measure DO wall-clock duration, not just
  invocation count.
- **KV's 1 write/sec-per-key limit is a design constraint, not a cost line
  item.** A naive "increment a KV counter per request" pattern doesn't just
  get expensive, it starts failing writes under load. Route high-frequency
  counters through a Durable Object instead.

## Local dev honesty

`wrangler dev` does not perfectly replicate production:

- KV/D1/R2 bindings in local dev use local emulation (miniflare) or can
  point at real remote resources with `--remote` — the two modes have
  different consistency behavior, and testing only in local-emulated mode
  can hide eventual-consistency bugs that only appear in production.
- CPU time limits aren't enforced identically locally — code that runs fine
  under `wrangler dev` can hit the CPU limit only once deployed. Don't treat
  local dev as a CPU-limit test.
- Durable Object multi-colo behavior (a DO accessed from a different region
  than it was created in) isn't observable locally at all — validate DO
  placement/latency assumptions against a real deployment, not local dev.
