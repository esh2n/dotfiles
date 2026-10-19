---
name: api-design
description: Use when designing or reviewing an API surface — an HTTP/REST endpoint, a gRPC/protobuf service or message, a GraphQL schema, a public library or SDK signature, a webhook, or CLI flags and machine-readable output that scripts depend on — and when judging whether a change is breaking, choosing pagination, error shape, idempotency, partial-update, concurrency-control, long-running-operation, versioning or deprecation behavior, or representing time, money and IDs.
metadata:
  namespaces: [arch/patterns]
---

# API Design

Judgment criteria for an interface other code depends on. The consumer is
deployed on its own schedule and cannot be updated with the server, so every
rule below comes back to one question: *what does a client written against
yesterday's contract do with today's server?*

Retry, timeout, backoff and 429 handling on the calling side belong to
`resilience-patterns`; consumer idempotency and event schema evolution on the
asynchronous path belong to `event-driven-patterns`; keyset query shape belongs
to `sql-tuning`. This skill owns the contract those rely on.

Tags: **[defect]** is checkable in a diff or spec; **[silence]** is something a
design must state; **[trade-off]** is defensible either way and is a question,
never a finding. Where the published guidelines disagree, the disagreement is
recorded as a trade-off, not resolved here.

## Resources and methods

- **[defect] A resource has one schema across every method that returns it.**
  Get, List items, the Create/Update response and the PATCH response carry the
  same shape; Google requires it for resource-oriented APIs
  (https://google.aip.dev/121) and Azure requires the same JSON schema for PUT,
  PATCH, GET and POST on one path
  (https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md).
  A list item that silently omits fields the Get returns makes clients issue N
  follow-up Gets.
- **[defect] Method semantics match HTTP.** GET and HEAD are safe; PUT and
  DELETE are idempotent; POST and PATCH are neither unless the API makes them
  so (RFC 9110 §9.2.2, https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2;
  RFC 5789 §2, https://www.rfc-editor.org/rfc/rfc5789.html). A GET that
  mutates state is retried, prefetched and cached by intermediaries.
- **[defect] An update method does not trigger side effects.** State
  transitions (approve, cancel, archive) are custom methods — `POST
  .../books/1:archive` in AIP-136 style — and state fields are not writable
  through update (https://google.aip.dev/134, https://google.aip.dev/136).
  Folding an action into PATCH means a client replaying a stale resource
  replays the action too.
- **[defect] A collection is returned as an object with an array field, never
  a bare top-level array.** A bare array cannot gain a `next_page_token`,
  `nextLink` or any metadata later without breaking every client
  (https://opensource.zalando.com/restful-api-guidelines/ "always return JSON
  objects as top-level data structures"; Azure "Collections").

### Naming

- **[defect] One name per concept across the whole API.** The same idea uses
  the same field name and the same casing everywhere
  (https://google.aip.dev/140). A `customerId` in one response and
  `customer_id` or `clientId` in another is two concepts to every generated
  client.
- **[defect] Repeated fields are plural, scalar fields singular; booleans
  drop the `is` prefix; field names are nouns, not verbs or intents**
  (https://google.aip.dev/140). Collection path segments are plural nouns
  (https://google.aip.dev/122).
- **[defect] Units live in the field name when the type does not carry them** —
  `timeoutSeconds`, `ttl_seconds`, `size_bytes`
  (Kubernetes API conventions,
  https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md;
  Azure "JSON"). A bare `timeout: 30` is read as seconds by one client and
  milliseconds by the next.
- **[trade-off] JSON field casing.** Zalando mandates `snake_case`; Azure and
  Kubernetes mandate `camelCase`; ProtoJSON emits lowerCamelCase and accepts
  both (https://protobuf.dev/programming-guides/json/). None is wrong; mixing
  them inside one API is the defect above.

## Error model

- **[defect] Errors use one documented, machine-readable envelope on every
  endpoint**, with a stable machine identifier separate from the human
  message. Clients branch on the identifier; parsing `detail` or `message` is
  what a stable identifier prevents. RFC 9457 says consumers should not parse
  `detail` (https://www.rfc-editor.org/rfc/rfc9457.html); AIP-193 requires
  every dynamic part of the message to also appear in `ErrorInfo.metadata`
  (https://google.aip.dev/193).
- **[defect] The error identifier is part of the contract.** Changing which
  identifier a given condition produces is a breaking change; Azure treats a
  different top-level code for the same condition as breaking (Azure
  "Handling Errors"), and AIP-193 forbids reusing one (reason, domain) pair for
  logically different errors or changing the message of a brownfield error
  that has no machine identifier.
- **[defect] HTTP status in the body matches the response status.** RFC 9457's
  `status` member is advisory and must equal the real status code.
- **[defect] No stack traces, SQL, internal hostnames or class names in an
  error body** (RFC 9457 §5; Zalando "must not expose stack traces").
- **[defect] Authorization is checked before existence.** A caller without
  permission gets `PERMISSION_DENIED`/403 whether or not the resource exists;
  only an authorized caller can learn `NOT_FOUND` (https://google.aip.dev/193).
  The reverse order lets anyone enumerate IDs.
- **[defect] Several occurrences of one problem are returned together** — an
  array of field violations in one response (RFC 9457 §3 extension member;
  AIP-193 `BadRequest` details), not one round trip per invalid field.
- Map domain errors to transport codes at the handler boundary, not in the
  domain layer — `ddd-modeling-review`, section 12.
- **[trade-off] Envelope shape.** RFC 9457 `application/problem+json`
  (Zalando makes it a MUST); Google's `google.rpc.Status` with `ErrorInfo`,
  rendered over HTTP as `{"error": {code, message, status, details}}`; Azure's
  `{"error": {code, message, target, details, innererror}}` plus an
  `x-ms-error-code` header. They are not interchangeable; pick one per API and
  write it down.

## Collections: pagination, ordering, filtering

- **[defect] Every list that can grow is paginated from its first release.**
  Adding pagination later is behaviorally breaking: a client that read the
  whole collection now silently reads only the first page
  (https://google.aip.dev/158 "Backwards compatibility";
  https://google.aip.dev/180). The page size must have a finite default.
- **[defect] Page tokens are opaque to the client** — not a parseable offset,
  not a base64 of one (AIP-158 says base64 alone is not obfuscation); Zalando
  says a cursor must never be inspected or constructed by clients
  (https://opensource.zalando.com/restful-api-guidelines/ "pagination").
  A parseable token freezes the implementation into the contract.
- **[defect] A page token grants no authorization.** Each page re-checks
  access as if the token were absent (AIP-158).
- **[defect] End of collection is signalled one way only** — an empty/absent
  `next_page_token` (AIP-158) or an absent `nextLink`, never `null` (Azure).
  A page with fewer items than requested is not the end: AIP-158 and Azure's
  `maxpagesize` both allow short pages mid-collection.
- **[defect] The query is fixed for the life of a token.** Filter and order
  must match the request that issued it; AIP-158 returns `INVALID_ARGUMENT`
  when they differ, Azure requires the same filter and sort on every page, and
  Zalando's cursor carries the filters (or a hash of them).
- **[defect] Ordering is total.** The sort key ends in a unique tie-breaker
  (usually the ID), or pages skip and repeat rows when values tie — the same
  reason keyset pagination needs one (`sql-tuning`, "N+1 and pagination").
  Azure requires documenting that items may be skipped or duplicated across
  pages unless the service prevents it.
- **[silence] The design states page-size default and maximum, token
  lifetime, whether `total_size` is exact or estimated, and the ordering
  guarantee.** AIP-158 allows token expiry (about three days as a rule of
  thumb) and an estimated total if documented.
- **[defect] A filter or `order_by` field set is documented, and an unknown
  field is rejected** with `INVALID_ARGUMENT`/400 rather than ignored
  (https://google.aip.dev/160, https://google.aip.dev/132). Ignoring it returns
  an unfiltered result the client believes is filtered.
- Add ordering only on demonstrated need: adding it later is compatible,
  removing it is breaking (AIP-132).
- **[trade-off] Cursor vs offset.** Cursor/token (Google, Zalando preferred,
  GraphQL connections, https://graphql.org/learn/pagination/) is stable under
  inserts and cheap at depth but cannot jump to page 51. Offset (`skip`/`top`,
  Azure; `skip` as an optional extra in AIP-158) is familiar and allows jumps
  but duplicates or skips rows under concurrent writes and degrades with depth.
- **[trade-off] Total count.** Zalando and Azure advise against a total count
  (costly, and hard to remove once clients use it); AIP-158 and the GraphQL
  connection example allow `totalCount`/`total_size`, possibly estimated.

## Idempotency of unsafe methods

- **[defect] A create or other non-idempotent call that clients retry has a
  deduplication mechanism.** A response timeout is ambiguous — the work may
  have committed — so without one, a retried POST creates a second order
  (RFC 9110 §9.2.2; `resilience-patterns`, "Retry judgment").
  Mechanisms: a client-chosen resource ID with PUT/create (Azure prefers PUT
  or PATCH for create; AIP-133 `book_id`), an idempotency key header, or a
  request ID field (https://google.aip.dev/155).
- **[defect] A reused key with a different payload is rejected, not served
  the first response.** The IETF draft returns 422; Stripe compares parameters
  and errors (https://docs.stripe.com/api/idempotent_requests); Zalando
  recommends 400. Serving the cached response hides a client bug.
- **[defect] A concurrent request with an in-flight key is rejected** (409 in
  the IETF draft), not executed twice.
- **[defect] The key store and the side effect commit together.** Zalando
  warns that the resource and the key cache need transactional updates; a key
  recorded before the write, or after it in a separate transaction, loses or
  duplicates work on a crash.
- **[defect] Keys are scoped to the caller and validated before lookup.** The
  IETF draft recommends high-entropy keys (UUIDs) and a composite cache key
  with server-side attributes; a global keyspace lets one tenant read another's
  cached response.
- **[silence] The design states key retention, what is replayed (success only,
  or errors too) and which operations require a key.** Stripe v1 keeps keys at
  least 24 hours and replays the saved status and body including 500s, but
  saves nothing when validation fails or a concurrent request conflicts; AIP-155
  lets the API choose any reasonable window.
- **[trade-off] Which mechanism.** `Idempotency-Key` header
  (draft-ietf-httpapi-idempotency-key-header-07 — **expired** Internet-Draft,
  last revised 2025-10-15, no RFC,
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/;
  used by Stripe, a MAY in Zalando) vs Azure's `Repeatability-Request-ID` /
  `Repeatability-First-Sent` (OASIS Repeatable Requests, window at least 5
  minutes) vs Google's `request_id` request field. The header is widely
  recognised but not a standard; the field works for gRPC too.

## Partial updates

- **[defect] PATCH semantics are named by media type or field mask, one per
  endpoint.** JSON Merge Patch (RFC 7396) or JSON Patch (RFC 6902) over HTTP
  (Zalando, Azure); `google.protobuf.FieldMask update_mask` in protobuf APIs
  (https://google.aip.dev/134, https://google.aip.dev/161). An undocumented
  "send what changed" body leaves `null`, absent and empty ambiguous.
- **[defect] Merge Patch cannot set a value to `null` or edit part of an
  array** — `null` means delete and arrays are replaced whole
  (https://www.rfc-editor.org/rfc/rfc7396.html). A resource with meaningful
  nulls or large arrays needs JSON Patch or a field mask.
- **[defect] An omitted field mask means "the fields that are set", never
  "all fields".** AIP-134 requires this; treating omission as full replacement
  wipes every field the client did not send.
- **[defect] Full replacement (PUT, or mask `*`) erases fields the client does
  not know about.** AIP-134 discourages PUT for exactly this reason: a v1
  client PUTting a resource clears the field v2 added. Azure accepts the
  consequence and documents that such fields reset to defaults.
- **[trade-off] Unknown fields in a write.** Azure and Zalando reject unknown
  request fields with 400 (Zalando calls this a deliberate deviation from
  Postel's law and requires documenting any other choice); ProtoJSON parsers
  reject unknown fields by default but may ignore them. Rejecting catches
  typos; ignoring lets newer clients talk to older servers.

## Concurrency control

- **[defect] A read-modify-write update has a precondition.** Return an ETag
  (or `etag` field, or Kubernetes `resourceVersion`) and accept it back on
  update and delete; without it two writers lose each other's changes
  (RFC 9110 §13.1.1, https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1;
  https://google.aip.dev/154).
- **[defect] `If-Match` uses strong comparison.** A weak ETag (`W/"…"`) never
  matches for `If-Match` (RFC 9110 §13.1.1); AIP-154 requires documenting
  whether ETags are strong or weak.
- **[defect] The version token is opaque and compared exactly.** Kubernetes
  requires clients to pass `resourceVersion` back unmodified; a client that
  compares versions numerically breaks when the server changes the scheme.
- **[silence] The design states whether a write without a precondition is
  accepted.** AIP-154 permits it by default and lets strongly consistent
  services require one, rejecting with `INVALID_ARGUMENT`.
- **[trade-off] Mismatch status.** RFC 9110 and Azure: 412 Precondition
  Failed. Google AIP-154: `ABORTED`, which maps to 409 (changed from
  `FAILED_PRECONDITION` in 2021). Kubernetes: 409 Conflict. Pick one and
  document it; clients key their reload-and-retry on it.

## Long-running operations

- **[defect] Work that outlives a request returns an operation handle, not a
  held-open connection.** The handle is pollable by ID, carries `done`, the
  result or a `google.rpc.Status`-style error, and metadata for progress
  (https://google.aip.dev/151; Azure `operation-location` status monitor).
- **[defect] Validation happens before the operation starts.** Errors that
  prevent starting are returned synchronously (AIP-151; Azure "perform as much
  validation as practical"); a client should not poll for ten seconds to learn
  its request was malformed.
- **[defect] Response and metadata types are fixed.** Changing an LRO's
  `response_type` or `metadata_type` is breaking (AIP-151); AIP-151 advises an
  empty message over `google.protobuf.Empty` when data may be added later.
- **[silence] The design states the operation's retention, whether parallel
  operations on one resource queue or are rejected, and what the resource
  looks like while the operation runs.** AIP-151: about 30 days retention as a
  rule of thumb; reject parallel operations with `ABORTED` or queue them; a
  resource being created shows in Get/List with a state field.
- **[trade-off] When to go async.** AIP-151 suggests about 10 seconds; Azure
  requires an LRO when p99 exceeds 1 second. Azure also forbids PATCH as an LRO
  (use an action), while AIP-134 allows a long-running update.

## Compatibility and versioning

Three axes, from AIP-180 (https://google.aip.dev/180): **source** (client code
still compiles), **wire** (old clients still parse), **semantic** (old clients
still get what they reasonably expect). A change can pass the wire check and
still break the other two.

### Breaking in any API

- **[defect]** Removing or renaming a field, method, enum value, endpoint or
  query parameter (rename = remove + add).
- **[defect]** Adding a required request field or making an optional request
  field required; tightening validation of an existing input (Zalando "prefer
  compatible extensions"; AIP-180).
- **[defect]** Changing a field's type, format or construction rule — even
  for output-only fields (AIP-180: IPv4 to IPv6 in `ip_address` is breaking).
- **[defect]** Changing a default value, or whether a default-valued field is
  serialized or omitted (AIP-180 "Default values must not change",
  "Serializing defaults").
- **[defect]** Changing the set of valid resource names or IDs, in either
  direction (AIP-180 "Changing resource names").
- **[defect]** Adding pagination to an unpaginated list (above).
- **[defect]** Adding a value to an enum that clients receive, unless the
  enum was documented as open from the start. Zalando lists output enum
  extension as incompatible and asks for open-ended value lists (`examples`
  rather than `enum`); Azure asks for "extensible enums" documented as such;
  AIP-180 says response enums expecting growth should document it.
- **[defect]** Changing which error identifier a condition produces
  (Error model, above).

### Protocol Buffers

- **[defect] A field number is never reused and never changed.** Deleting a
  field reserves its number (and name); deleting an enum value reserves its
  number (https://protobuf.dev/best-practices/dos-donts/;
  https://protobuf.dev/programming-guides/editions/#updating).
- **[defect] No field type changes, even "wire-compatible" ones.** int32 to
  int64 decodes on the wire but truncates and changes generated code; AIP-180
  forbids type changes for that reason.
- **[defect] Fields are not moved into or out of an existing `oneof`**
  (AIP-180; protobuf "Updating A Message Type"); repeated is never changed to
  scalar (silent data loss; dos-donts).
- **[defect] A field rename or `json_name` change breaks JSON and text-format
  clients** even though binary wire format is unaffected; ProtoJSON writes
  field names into the payload. buf's `WIRE_JSON` category catches this; buf
  calls it the recommended minimum (https://buf.build/docs/breaking/rules/).
- **[defect] Every enum's zero value is `*_UNSPECIFIED` with no business
  meaning** (dos-donts), and a two-state concept that may grow is an enum, not
  a `bool`.
- **[defect] API messages are not storage messages.** Reusing one message for
  both ties the wire contract to schema migrations (dos-donts "Do Use
  Different Messages For RPC APIs and Storage").
- **[silence] The repository runs a breaking-change check (`buf breaking` or
  equivalent) against the last released schema in CI**, and states which
  category it enforces.

### GraphQL

- **[defect] Fields are retired with `@deprecated(reason: …)` and kept, not
  removed or versioned.** graphql.org recommends a versionless schema evolved
  by additive change (https://graphql.org/learn/schema-design/); the September
  2025 spec defines `@deprecated` on fields, arguments, input fields and enum
  values (https://spec.graphql.org/September2025/#sec--deprecated).
- **[defect] A required (non-null, no default) argument or input field
  carries no `@deprecated`.** The spec forbids it; make it optional first.
- **[defect] Making a nullable output field non-null, or a field's null
  meaning change, is a contract change.** Fields are nullable by default so one
  failing field nulls itself rather than its parent; a non-null field that
  errors nulls the nearest nullable parent (schema-design).
- **[defect] Application error codes go in `errors[].extensions`, not new
  top-level keys on the error object** (spec §7.1.6 "Errors"; Counter Example
  212).

### Versioning

- **[silence] The design states its compatibility promise**: who the clients
  are, how long an old version or deprecated element is served, and how
  breaking change is delivered. AIP-180 notes that an API with one controlled
  client may set looser rules — say so explicitly.
- **[trade-off] Where the version lives.** Major version in the URL path and
  proto package, no minor versions exposed (Google AIP-185); a required
  date-valued `api-version` query parameter, never a path segment (Azure);
  media-type versioning only, URL versioning forbidden, and "avoid versioning"
  as the default (Zalando); a date-named version pinned per account and
  overridable per request with `Stripe-Version`, monthly non-breaking releases
  and two breaking major releases a year (Stripe,
  https://docs.stripe.com/api/versioning); no versions at all (GraphQL).

## Deprecation and sunset

- **[defect] Deprecation is in the contract first** — `deprecated: true` on
  the OpenAPI operation, parameter or schema (OpenAPI 3.2,
  https://spec.openapis.org/oas/latest.html), `option deprecated = true` in
  proto (AIP-185), `@deprecated` in GraphQL — with the replacement named.
  Zalando makes this a MUST and adds the migration path and sunset date.
- **[defect] Runtime headers use the standard formats.** `Deprecation` is an
  RFC 9651 Date (`@<epoch>`), Standards Track since March 2025
  (https://www.rfc-editor.org/rfc/rfc9745.html); `Sunset` is an HTTP-date
  (RFC 8594, Informational, https://www.rfc-editor.org/rfc/rfc8594.html). The
  Sunset date must not be earlier than the Deprecation date. Zalando still
  documents a `true` value for `Deprecation`, which RFC 9745 does not allow.
- **[defect] Functionality does not ship already deprecated** (AIP-185: a
  deprecated element must not graduate from alpha to beta or beta to stable).
- **[silence] The design states how usage of a deprecated element is
  measured before removal** (Zalando "monitor usage of deprecated API").
  Removal without usage data is a guess about who breaks.

## Webhooks

The provider side of an outbound HTTP callback. Receiving-side SSRF and
signature verification code are also on `security-reviewer`'s list.

- **[defect] Every delivery is signed over the raw body plus an ID and a
  timestamp,** and the receiver verifies against the raw bytes with a
  constant-time compare and a timestamp tolerance. Stripe: HMAC-SHA256 over
  `timestamp.body`, 5-minute default tolerance, tolerance 0 disables the check
  (https://docs.stripe.com/webhooks); Standard Webhooks: sign
  `msg_id.timestamp.payload` (https://www.standardwebhooks.com/, spec on
  GitHub). Verifying a re-serialized body fails; skipping the timestamp allows
  replay.
- **[defect] Each event has a stable ID across retries, and the receiver
  dedupes on it.** Both Stripe and Standard Webhooks deliver at least once;
  `event-driven-patterns` covers consumer idempotency.
- **[defect] Consumers must not depend on delivery order.** Stripe does not
  guarantee order and warns against ordering by `created` (one-second
  resolution); fetch current state by ID instead.
- **[defect] The receiver acknowledges with 2xx before slow work** and queues
  the rest; senders time out (Standard Webhooks suggests 15–30 s) and retry,
  which multiplies work that was already running.
- **[defect] Signing secrets are per endpoint and rotatable with overlap**
  (Stripe allows the old secret to stay valid up to 24 hours; Standard Webhooks
  requires unique keys per endpoint).
- **[silence] The provider states the retry schedule and total duration,
  which response codes stop retries (Standard Webhooks: 410 disables the
  endpoint), and how a consumer replays missed events.** Stripe retries with
  exponential backoff for up to three days in live mode.
- **[silence] The event payload is versioned or thin.** A full ("snapshot")
  payload is rendered at an API version; Stripe pins it per endpoint. A thin
  payload carries IDs and the consumer fetches current state.
- **[trade-off] Symmetric vs asymmetric signatures.** HMAC (Stripe; Standard
  Webhooks `v1`) is fast and ubiquitous but the consumer holds a secret that
  can sign; ed25519 (Standard Webhooks `v1a`, which it prefers) lets consumers
  verify with a public key.

## Rate-limit signalling

Client-side reaction to 429 and `Retry-After` is `resilience-patterns`.

- **[defect] A throttled request gets 429 with `Retry-After` or quota
  headers,** never a silent drop or a 503 without a hint (Zalando "use code 429
  with headers for rate limits", citing RFC 6585).
- **[defect] Reset values state their unit.** Zalando's `X-RateLimit-Reset`
  is relative seconds and warns that GitHub's and Twitter's same-named header
  is epoch seconds; a client written for one misreads the other by decades.
- **[trade-off] Which headers.** `X-RateLimit-*` (de facto, inconsistent
  between vendors) vs the IETF `RateLimit` and `RateLimit-Policy` structured
  fields (draft-ietf-httpapi-ratelimit-headers-11 — **active** Internet-Draft,
  expires 2026-11-24, no RFC,
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/). The
  draft gives `Retry-After` precedence when both are present.

## Time, money, numbers, IDs

- **[defect] Timestamps are RFC 3339 strings in UTC with an explicit `Z` or
  offset**; a local date-time without offset is a separate, named type
  (Zalando "use standard formats for date and time properties", uppercase `T`
  and `Z`; Azure; Kubernetes; ProtoJSON `Timestamp`). Epoch integers without a
  stated unit are seconds to one client and milliseconds to another.
- **[defect] Calendar dates, wall-clock times and instants are distinct
  types** — `google.type.Date`/`_date`, `TimeOfDay`, `Timestamp`/`_time`
  (https://google.aip.dev/142). A birthday serialized as midnight UTC moves a
  day in the client's time zone.
- **[defect] Durations carry their unit**: a `*Seconds` integer (Kubernetes,
  Azure) or a typed duration (`google.protobuf.Duration`, ISO 8601 when a
  calendar period such as `P1M` is meant).
- **[defect] Money is never a binary float, and always travels with an ISO
  4217 currency code** (https://google.aip.dev/143 requires `currency_code`;
  AIP-143 points to `google.type.Money`).
- **[defect] Integers beyond ±2^53 are strings in JSON.** JavaScript parses
  JSON numbers as float64; ProtoJSON emits int64 as decimal strings, and
  Kubernetes bounds JSON integers to ±2^53 and avoids floats in spec.
- **[defect] IDs are opaque strings to clients**, compared case-sensitively
  (Azure "JSON"); AIP-122 makes all ID fields strings. A numeric ID in JSON
  hits the 2^53 limit and invites arithmetic.
- **[defect] Country, language and currency use the standard codes** —
  Unicode CLDR `region_code` (AIP-143) or ISO 3166-1 alpha-2 (Zalando), BCP 47,
  ISO 4217 — one of them, stated in the contract.
- **[trade-off] Money shape.** Integer minor units (Stripe: `1000` = 10.00
  USD, `10` = 10 JPY, with special cases such as ISK,
  https://docs.stripe.com/currencies); `google.type.Money` units + nanos
  (AIP-143); Zalando's `{amount: decimal number, currency}` object. Minor units
  break for currencies whose exponent changes; a decimal JSON number needs
  every client to parse it as decimal.
- **[trade-off] ID format.** UUIDs need no coordination; Zalando advises
  them only when needed (long, unordered, hard to communicate). User-chosen IDs
  give idempotent create (AIP-122/133, Azure PUT); AIP-122 asks for RFC 1034
  style user IDs.

## Contract and documentation

- **[defect] The machine-readable contract (OpenAPI, `.proto`, GraphQL SDL)
  is the source of truth and changes in the same diff as the code.** Zalando
  requires API-first with OpenAPI; a handler change with no spec change is
  either undocumented behavior or a spec that lies.
- **[defect] Every response a client must handle is in the contract** —
  success, documented error identifiers, 429, and the error envelope schema
  (Zalando "specify success and error responses"; Azure "document the
  service's top-level error code strings").
- **[silence] Constraints are stated** — string length and character set,
  numeric ranges, array maximums, ID formats (Azure "establish a well-defined
  contract for the format of strings"; AIP-180: raising a string's upper bound
  is treated as incompatible).

### Library, SDK and CLI surfaces

The same rules apply to a public function signature or a command line:
removing, renaming or retyping a public symbol, flag or JSON output field is
breaking for source-compatible callers (AIP-180's source axis).

- **[defect] Machine-readable CLI output (`--json`, `--plain`) is a contract;
  human output is not.** Scripts depend on the former; changing it is breaking,
  while changing prose output is usually fine
  (https://clig.dev/ "Future-proofing").
- **[defect] Primary output to stdout, diagnostics to stderr** (clig.dev),
  or a pipe consumer parses log lines as data.
- **[defect] No catch-all default subcommand and no arbitrary prefix
  abbreviations** — both lock future names out (clig.dev). Changes to flags
  are additive; a flag being removed warns first.

## Related

- `resilience-patterns` (same pack) — client retries, timeouts, backoff, 429
  handling and rate-limiter placement.
- `event-driven-patterns` (same pack) — consumer idempotency, event schema
  evolution, ordering on the asynchronous path.
- `ddd-modeling-review` (same pack) — section 12, error taxonomy and where
  transport mapping happens.
- `sql-tuning` — keyset pagination at the query level and the page-token
  contract from the database side.
- `security-reviewer` agent — authentication, authorization, SSRF from
  webhook URLs, signature-verification code.

## Sources

All opened 2026-10-19. Cited and paraphrased, never copied.

| Source | Version / freshness | Licence |
|---|---|---|
| Google AIPs 121, 122, 132–136, 140, 142, 143, 151, 154, 155, 158, 160, 161, 180, 185, 193 — https://google.aip.dev | repo `aip-dev/google.aip.dev` master, pushed 2026-10-15; AIP-158 last changed 2025-07-08 | CC BY 4.0 (text), Apache 2.0 (code) |
| Azure REST API Guidelines — https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md | history to 2025-03-28; repo pushed 2026-08-05. The original Microsoft REST API Guidelines are marked deprecated in favor of the Azure and Graph documents | CC BY 4.0 |
| Zalando RESTful API Guidelines — https://opensource.zalando.com/restful-api-guidelines/ | repo `zalando/restful-api-guidelines` main, pushed 2026-09-29 | CC BY 4.0 |
| RFC 9110 (HTTP Semantics), RFC 5789 (PATCH), RFC 7396 (Merge Patch), RFC 9457 (Problem Details, obsoletes 7807), RFC 8594 (Sunset, Informational), RFC 9745 (Deprecation, Standards Track, 2025-03) | published RFCs | IETF Trust |
| draft-ietf-httpapi-idempotency-key-header-07 | expired; last revision 2025-10-15 | IETF Trust |
| draft-ietf-httpapi-ratelimit-headers-11 | active; expires 2026-11-24 | IETF Trust |
| Protocol Buffers: Proto Best Practices, Updating A Message Type (editions guide), ProtoJSON — https://protobuf.dev | live docs | not checked |
| buf breaking rules — https://buf.build/docs/breaking/rules/ | live docs | not checked |
| GraphQL spec September 2025 — https://spec.graphql.org/September2025/ ; graphql.org Schema Design and Pagination | spec released 2025-09-03; working draft 2026-09-28 exists | spec not checked; graphql.org site MIT |
| Stripe docs: idempotent requests, versioning, webhooks, upgrades, currencies — https://docs.stripe.com | live; current API version 2026-09-30.endive | proprietary; paraphrased only |
| Standard Webhooks spec — https://github.com/standard-webhooks/standard-webhooks | repo pushed 2026-10-15 | Apache 2.0 |
| Kubernetes API conventions — https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md | master | Apache 2.0 |
| OpenAPI Specification — https://spec.openapis.org/oas/latest.html | v3.2.1, 2026-09-10 | not checked |
| Command Line Interface Guidelines — https://clig.dev | repo pushed 2026-05-16 | CC BY-SA 4.0 |

RFC 6585 (429) and RFC 6902 (JSON Patch) are cited through the
guidelines that reference them and were not opened in this run.
