---
name: cloudflare-patterns
description: Use when building or reviewing Cloudflare Workers projects — choosing between KV, D1, Durable Objects, R2, or Queues for storage, designing a cache strategy, debugging CPU-time-limit errors or a package that breaks at deploy, deciding Workers vs Pages Functions, or diagnosing wrangler dev vs production divergence.
metadata:
  namespaces: [platform/infra]
---

# Cloudflare Patterns

Judgment criteria for Cloudflare Workers architecture — not a wrangler
tutorial. Sources checked 2026-10-19.

## Workers runtime judgment

- Workers run on V8 isolates, not Node.js
  (https://developers.cloudflare.com/workers/reference/how-workers-works/).
  `nodejs_compat` adds a Node-compatible API layer; it is on by default for
  compatibility dates on or after 2026-08-04 and must be listed explicitly
  for earlier dates (https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
  The layer is partial: `node:fs` (default from 2025-09-15) and outbound
  `node:net` sockets (built on `connect()`) work, but `net.Server`/`listen()`
  does not and `node:tls` is partial
  (https://developers.cloudflare.com/workers/runtime-apis/nodejs/). Native
  addons (anything with a `.node` file or `node-gyp` build step) have no
  place to run. Packages that listen on a port, use unsupported TLS options
  or ship native code break — check the package against that list before
  adopting it, don't discover it at deploy time.
- **CPU time, not wall-clock, is the limited resource.** Time spent waiting
  on `fetch()`, KV or a database does not count. What burns the limit —
  10 ms on Free; 30 s by default on Paid, raisable to 5 min with
  `limits.cpu_ms` — is actual computation: parsing a huge JSON payload,
  crypto, image processing, tight loops
  (https://developers.cloudflare.com/workers/platform/limits/#cpu-time). The
  Bundled and Unbound usage models are deprecated. Optimize for CPU-bound
  work, not for "the request feels slow."
- **No long-lived in-memory state across requests, with one caveat.**
  Module-scope variables can survive between requests on the same isolate as
  a best-effort cache (fine for stateless memoization), but the isolate can
  be evicted at any time and requests may reach different instances
  (https://developers.cloudflare.com/workers/reference/how-workers-works/) —
  never rely on it for correctness (counters, sessions, locks). Durable
  Objects are the actual mechanism for request-to-request state that must be
  correct.
- **`fetch()` to the Worker's own zone skips the zone's protections unless
  `global_fetch_strictly_public` is set.** Without the flag, such a request
  goes straight to the zone's origin server, ignoring Workers on that URL and
  bypassing Cloudflare security settings; with it, the request enters through
  Cloudflare's front door like Internet traffic and can loop back to the same
  Worker. The flag has no default-on compatibility date, so it must be listed
  (https://developers.cloudflare.com/workers/configuration/compatibility-flags/).

## Secrets and configuration

Never put credentials in `vars` in the Wrangler configuration file; `vars`
are plaintext. Use per-Worker secrets (`wrangler secret put`, or
`wrangler versions secret put` with gradual deployments) or an account-level
Secrets Store binding (`secrets_store_secrets`, read with
`await env.<BINDING>.get()`); local values go in `.dev.vars` or `.env`, which
must stay out of git
(https://developers.cloudflare.com/workers/configuration/secrets/,
https://developers.cloudflare.com/secrets-store/integrations/workers/).

## Storage decision table

| Need | Choice | Why |
|---|---|---|
| Read-heavy config/cache, eventual consistency acceptable | KV | Fast global reads; other locations may take up to 60 s or more to see a write — **1 write/sec per key** is a hard ceiling, and writes over it fail with 429. A hot counter or session-per-key pattern hits it fast. |
| Relational data, need SQL, roughly single-region access | D1 | One primary database: every write goes to the primary, and reads reach replicas only through the Sessions API. The primary sits near the creating request unless a location hint places it (best effort, fixed after creation). Placement is a judgment call, not an afterthought. |
| Strong consistency, serialized access to one logical entity (a room, a cart, a counter) | Durable Objects | Each object is single-threaded with strongly consistent transactional storage; input and output gates stop other events from interleaving with its storage operations, so read-modify-write races that need a transaction elsewhere are correct by construction here. Don't reach for a DO for read-heavy shared data with no per-entity write pattern — one single-threaded object becomes the bottleneck for a KV/D1 job. |
| Large binary objects, files, ML artifacts | R2 | **No egress fee is the deciding factor** — if the access pattern reads a lot from outside Cloudflare's network, R2 wins on cost before the S3-compatible API (which has gaps) even matters. |
| Async fan-out, decoupling a spike from a downstream limit | Queues | The judgment call is backpressure: a Queue (batching, retries, a dead-letter queue, consumer concurrency up to a cap) smooths a traffic spike into a downstream system with a lower throughput ceiling. Don't reach for one just to "feel async" if the consumer could handle the load synchronously — that's added latency and a new failure mode for no benefit. |

Sources: KV (https://developers.cloudflare.com/kv/concepts/how-kv-works/,
https://developers.cloudflare.com/kv/api/write-key-value-pairs/), D1
(https://developers.cloudflare.com/d1/best-practices/read-replication/,
https://developers.cloudflare.com/d1/configuration/data-location/), Durable
Objects (https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/),
R2 (https://developers.cloudflare.com/r2/pricing/,
https://developers.cloudflare.com/r2/api/s3/api/), Queues
(https://developers.cloudflare.com/queues/configuration/batching-retries/).

## Cache judgment

- **Cache API vs CDN cache vs KV** are three tools that overlap in purpose.
  Cache API (`caches.default`) stores per data center with no replication to
  other locations, keyed by request
  (https://developers.cloudflare.com/workers/runtime-apis/cache/) — good for
  compute-derived responses a single edge location can regenerate cheaply.
  CDN cache (cache-control headers, Cloudflare's own edge cache) is the right
  default for static/semi-static assets — Cloudflare already does this
  without custom Worker code. KV is global and durable but eventually
  consistent — use it when the same value must be readable from any
  location, not as a faster Cache API.
- **Where the Cache API does nothing.** Cache API calls work on custom
  domains and in Pages Functions, have no effect in the dashboard editor and
  Playground previews, and are not available for Workers behind Cloudflare
  Access (https://developers.cloudflare.com/workers/runtime-apis/cache/) — a
  cache that "never hits" in those contexts is not a key-design bug, and a
  design that depends on the Cache API behind Access needs another store.
- **Cache key design determines the hit rate.** The default key includes the
  full URL with its query string; adding headers or cookies to the key, or
  keeping query params that don't change the response, fragments the cache
  into near-unique keys per request
  (https://developers.cloudflare.com/cache/how-to/cache-keys/) — measure
  actual hit rate per route, don't assume the default key is right.
- **stale-while-revalidate** when the data is expensive to regenerate and a
  slightly-stale response is an acceptable latency trade — serve the cached
  value immediately, refresh in the background. The CDN cache honours it;
  the Workers Cache API (`cache.match`/`cache.put`) does not
  (https://developers.cloudflare.com/cache/concepts/cache-control/). Wrong
  for anything where staleness is a correctness bug (pricing, auth state);
  right for content that's expensive and tolerant of being a few seconds old.

## Workers vs Pages Functions placement

Default to Workers for anything beyond a static site with light dynamic
routes. Pages Functions compile to a single Worker, constrained to a
file-based routing convention tied to a Pages project, and Workers has
features Pages lacks (Cron Triggers, Workers Logs, Tail Workers); Cloudflare
publishes a guide for moving Pages projects to Workers with static assets
(https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).
Reach for Pages Functions only when the project already is a Pages static
site and needs a few dynamic routes bolted on. A standalone API, a
cron-triggered job, or anything using Durable Objects/Queues belongs in a
plain Worker; fighting Pages' routing convention for a non-trivial backend is
wasted effort.

## Placement

A Worker runs in the data center nearest the request by default. When it
makes several round trips to one back end (a database, an API in one cloud
region), running it near the back end cuts total request time. Smart
Placement (`placement.mode = "smart"`) picks the location from observed
request durations and suits several or unknown back-end locations; a
`region`, `host` or `hostname` hint pins it near a known back end. Smart
Placement only moves `fetch` handlers — not RPC methods or named
entrypoints — and only to locations where the Worker already runs
(https://developers.cloudflare.com/workers/configuration/placement/). A
Worker that calls one distant back end several times per request with no
placement setting pays that round-trip latency each time.

## Cold start reality

Isolates start far faster than a process in a container or VM — but "fast"
isn't "free." Global-scope code runs on every isolate start, and it must
parse and execute within 1 second or the deploy fails (error 10021)
(https://developers.cloudflare.com/workers/platform/limits/#startup-time). A
Worker with heavy top-level imports or eager module-scope initialization pays
that cost on every isolate spin-up, not once — keep module-scope work minimal
and defer anything expensive into the request handler.

## Cost model traps

- **Durable Object billing is duration-based, not only request-based.** An
  object is billed for wall-clock duration while active or held in memory;
  one that accepts a WebSocket without the Hibernation API bills for the
  whole time the socket is connected, while a hibernating one stops accruing
  duration once its handlers finish
  (https://developers.cloudflare.com/durable-objects/platform/pricing/). A
  chatty long-lived DO can cost far more than the request count suggests —
  measure DO wall-clock duration, not just invocation count.
- **KV's 1 write/sec-per-key limit is a design constraint, not a cost line
  item.** A naive "increment a KV counter per request" pattern doesn't just
  get expensive, it starts failing writes with 429 under load. Route
  high-frequency counters through a Durable Object instead
  (https://developers.cloudflare.com/kv/api/write-key-value-pairs/).

## Local dev honesty

`wrangler dev` does not perfectly replicate production
(https://developers.cloudflare.com/workers/development-testing/):

- By default the Worker and its bindings run locally under Miniflare, with
  simulated bindings that start empty; a binding marked `remote: true` uses
  the deployed resource while the code still runs locally (`wrangler dev
  --remote` is the legacy whole-Worker mode). Testing only against local
  simulations can hide eventual-consistency bugs (KV propagation) that only
  appear against real resources.
- Durable Objects always run locally, even with remote bindings. In a
  deployment an object is created near its first `get()` and never moves,
  with `locationHint` honoured only then and best effort
  (https://developers.cloudflare.com/durable-objects/reference/data-location/)
  — validate DO placement/latency assumptions against a real deployment, not
  local dev.
