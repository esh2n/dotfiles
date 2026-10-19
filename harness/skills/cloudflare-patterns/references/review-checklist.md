# cloudflare-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or `wrangler.toml`/`wrangler.jsonc`. A match is a finding.

- id: cloudflare:unsupported-node-api
  rule: Use only the Node APIs the Workers runtime provides.
  check: Dependency with a native addon (`.node` file, `node-gyp`, `binding.gyp`); `net.createServer`, `server.listen` or other inbound sockets; unsupported `node:tls` options; `node:` imports with a `compatibility_date` before 2026-08-04 and no `nodejs_compat` flag.
  section: "## Workers runtime judgment"

- id: cloudflare:cpu-bound-over-limit
  rule: CPU-bound work fits the account's CPU limit.
  check: Large JSON parsing, crypto, image processing or tight loops in a request handler on the Free plan (10 ms), or beyond 30 s on Paid with no `limits.cpu_ms`; `usage_model` set to the deprecated `bundled` or `unbound`.
  section: "## Workers runtime judgment"

- id: cloudflare:global-state-for-correctness
  rule: Module-scope state is only a best-effort cache; correctness-bearing state lives in a Durable Object.
  check: Module-scope `let`/`Map`/object used as a counter, session store, lock or rate limiter.
  section: "## Workers runtime judgment"

- id: cloudflare:kv-hot-key-write
  rule: Never write one KV key more than once per second.
  check: `KV.put` on a fixed or per-user key inside a request path (counter increment, session update per request).
  section: "## Storage decision table", "## Cost model traps"

- id: cloudflare:do-for-read-heavy-shared-data
  rule: Use a Durable Object for per-entity serialized writes, not read-heavy shared data.
  check: A single Durable Object (fixed `idFromName`) serving reads of shared config or catalog data for all requests with no per-entity writes.
  section: "## Storage decision table"

- id: cloudflare:swr-on-cache-api
  rule: stale-while-revalidate works in the CDN cache, not the Workers Cache API.
  check: `Cache-Control: stale-while-revalidate` set on a response passed to `cache.put`, or code expecting `cache.match` to serve stale and refresh.
  section: "## Cache judgment"

- id: cloudflare:cache-key-fragmentation
  rule: Keep only inputs that change the response in the cache key.
  check: Custom cache key (Cache Rule, or the `Request` passed to `cache.put`) including headers, cookies or query params the response does not depend on.
  section: "## Cache judgment"

- id: cloudflare:stale-for-correctness-data
  rule: Never serve stale data where staleness is a correctness bug.
  check: Caching or stale-while-revalidate on responses carrying pricing, auth or session state.
  section: "## Cache judgment"

- id: cloudflare:heavy-global-scope
  rule: Keep module-scope work minimal; defer expensive setup into the handler.
  check: Top-level code that parses large data, builds large objects, or makes eager initialisation calls outside the `fetch`/`scheduled`/`queue` handler.
  section: "## Cold start reality"

- id: cloudflare:do-websocket-without-hibernation
  rule: A Durable Object holding WebSockets uses the Hibernation API.
  check: `ws.accept()` on a WebSocket inside a Durable Object instead of `this.ctx.acceptWebSocket()` with `webSocketMessage` handlers.
  section: "## Cost model traps"

- id: cloudflare:pages-for-backend
  rule: A standalone API, cron job, or Durable Object/Queues user is a Worker, not Pages Functions.
  check: New Pages Functions project (`functions/` directory) for a backend with cron, Durable Objects or Queues, or with no static site.
  section: "## Workers vs Pages Functions placement"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: cloudflare:consistency-need-unstated
  rule: Each store is chosen from its stated consistency and access need.
  check: Design picking KV, D1, Durable Objects, R2 or Queues with no stated consistency requirement and access pattern (read/write ratio, per-entity writes, where reads come from).
  section: "## Storage decision table"

- id: cloudflare:d1-primary-placement-unstated
  rule: D1 primary placement is decided.
  check: D1 design with writers outside one region and no location hint or stated primary region; reads expected from replicas with no Sessions API use.
  section: "## Storage decision table"

- id: cloudflare:queue-downstream-limit-unstated
  rule: A Queue is justified by a downstream throughput limit.
  check: Queue added with no named downstream ceiling it smooths load into.
  section: "## Storage decision table"

- id: cloudflare:do-duration-cost-unstated
  rule: Long-lived Durable Objects state their duration cost.
  check: Design with WebSockets or long polling on Durable Objects and no duration (GB-s) estimate or hibernation plan.
  section: "## Cost model traps"

- id: cloudflare:remote-validation-unstated
  rule: Behaviour local dev cannot show is validated against real resources.
  check: Test plan relying only on `wrangler dev` local simulation for KV consistency, or for Durable Object placement and latency.
  section: "## Local dev honesty"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: cloudflare:cache-api-cdn-or-kv
  rule: Cache API vs CDN cache vs KV.
  options: Cache API (per data center, keyed by request, Worker code needed) | CDN cache (no code, for static/semi-static assets) | KV (global and durable, eventually consistent, write rate per key limited)
  section: "## Cache judgment"

- id: cloudflare:swr-or-fresh
  rule: stale-while-revalidate vs always fresh.
  options: SWR (immediate response, background refresh; serves stale for a window) | fresh (always current; pays regeneration latency)
  section: "## Cache judgment"

- id: cloudflare:queue-or-synchronous
  rule: Queue vs synchronous call.
  options: Queue (absorbs spikes for a lower-ceiling downstream; added latency and a new failure mode) | synchronous (simpler, immediate; spike reaches the downstream)
  section: "## Storage decision table"

- id: cloudflare:workers-or-pages-functions
  rule: Worker vs Pages Functions.
  options: Worker (full feature set, any routing) | Pages Functions (fits a Pages static site with a few dynamic routes; file-based routing, fewer features)
  section: "## Workers vs Pages Functions placement"
