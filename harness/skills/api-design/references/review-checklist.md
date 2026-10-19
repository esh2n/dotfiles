# api-design — review checklist

Derived from ../SKILL.md. Read by `code-reviewer`, `spec-reviewer` and `rollout-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review; compatibility items for `rollout-reviewer`) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff, schema or spec. A match is a finding.

- id: api:schema-differs-across-methods
  rule: A resource has one schema across every method that returns it.
  check: Get, List item, Create/Update/PATCH response for the same resource return different field sets or shapes (a list DTO missing fields the Get has, a create response with a different envelope).
  section: "## Resources and methods"

- id: api:method-semantics
  rule: Method semantics match HTTP — GET/HEAD safe, PUT/DELETE idempotent.
  check: GET handler that writes state; PUT that appends or increments; DELETE whose repeat has a different effect than the first call.
  section: "## Resources and methods"

- id: api:update-side-effect
  rule: An update method does not trigger side effects; state transitions are custom methods and state fields are not writable through update.
  check: PATCH/Update handler that sends email, charges, enqueues work, or accepts a `state`/`status` field that drives a workflow transition.
  section: "## Resources and methods"

- id: api:bare-array-response
  rule: A collection is returned as an object with an array field, never a bare top-level array.
  check: Response schema or handler whose top-level JSON is an array.
  section: "## Resources and methods"

- id: api:inconsistent-naming
  rule: One name and one casing per concept across the whole API.
  check: The same concept under two names (`customerId` vs `clientId`) or two casings (`customer_id` vs `customerId`) in the diff or against existing endpoints.
  section: "## Resources and methods" ("### Naming")

- id: api:naming-form
  rule: Repeated fields plural, scalars singular, booleans without `is`, fields are nouns; collection path segments are plural nouns.
  check: `book: [...]`, `isActive`, a field named for an action (`sendEmail`), a singular collection path (`/user/{id}`).
  section: "## Resources and methods" ("### Naming")

- id: api:unit-missing-from-name
  rule: Units live in the field name when the type does not carry them.
  check: Integer or number fields for duration, size or rate with no unit suffix (`timeout`, `ttl`, `size`) and no typed duration.
  section: "## Resources and methods" ("### Naming")

- id: api:error-envelope-inconsistent
  rule: Errors use one documented, machine-readable envelope on every endpoint, with a stable identifier separate from the human message.
  check: An endpoint returning a plain string, a framework default error page, or a different JSON shape from the rest; clients or tests branching on message text.
  section: "## Error model"

- id: api:error-identifier-changed
  rule: The error identifier is part of the contract; a condition keeps the identifier it had.
  check: Diff changes which code/reason/type a given failure returns, renames an error code, or reuses one code for a logically different error.
  section: "## Error model"

- id: api:error-status-mismatch
  rule: The status in the error body equals the HTTP response status.
  check: Problem details `status` or `error.code` set independently of the response status (e.g. body 404, response 200 or 500).
  section: "## Error model"

- id: api:error-leaks-internals
  rule: No stack traces, SQL, internal hostnames or class names in an error body.
  check: Exception message, `err.Error()` of a driver error, or a stack trace serialized into the response.
  section: "## Error model"

- id: api:existence-before-authz
  rule: Authorization is checked before existence.
  check: Handler loads the resource and returns 404 before checking permission, so an unauthorized caller can distinguish existing from missing IDs.
  section: "## Error model"

- id: api:errors-one-at-a-time
  rule: Several occurrences of one problem are returned together.
  check: Validation that returns on the first invalid field when the request can have several.
  section: "## Error model"

- id: api:list-unpaginated
  rule: Every list that can grow is paginated from its first release, with a finite default page size.
  check: New list endpoint/RPC with no page size and token/cursor, or a default page size of "unlimited"; pagination added to an existing unpaginated list (breaking).
  section: "## Collections: pagination, ordering, filtering"

- id: api:page-token-transparent
  rule: Page tokens are opaque to the client.
  check: Token is a raw offset, a raw ID, or base64 of either; docs or tests construct tokens client-side.
  section: "## Collections: pagination, ordering, filtering"

- id: api:page-token-authorizes
  rule: A page token grants no authorization; each page re-checks access.
  check: Handler skips the permission check when a token is present, or the token embeds tenant/user scope that is trusted on return.
  section: "## Collections: pagination, ordering, filtering"

- id: api:end-of-list-ambiguous
  rule: End of collection is signalled one way only, and a short page is not the end.
  check: `nextLink: null` instead of absent; client code or docs treating `len(items) < page_size` as the last page.
  section: "## Collections: pagination, ordering, filtering"

- id: api:token-query-not-fixed
  rule: Filter and order are fixed for the life of a page token.
  check: A request with a token and a different filter/order_by is accepted and served instead of rejected.
  section: "## Collections: pagination, ordering, filtering"

- id: api:ordering-not-total
  rule: The sort key ends in a unique tie-breaker.
  check: Paginated query ordered by a non-unique column (created_at, name) with no ID tie-breaker.
  section: "## Collections: pagination, ordering, filtering"

- id: api:unknown-filter-ignored
  rule: Filterable and orderable fields are documented, and an unknown field is rejected.
  check: Filter/order_by parser that drops unknown fields or operators instead of returning 400/INVALID_ARGUMENT.
  section: "## Collections: pagination, ordering, filtering"

- id: api:unsafe-create-no-dedup
  rule: A non-idempotent call that clients retry has a deduplication mechanism.
  check: POST create or other non-idempotent write with no client-chosen ID, idempotency key header, or request_id field, on a path that clients or SDKs retry.
  section: "## Idempotency of unsafe methods"

- id: api:idempotency-payload-mismatch
  rule: A reused key with a different payload is rejected, not served the first response.
  check: Idempotency lookup keyed on the key alone with no request fingerprint comparison.
  section: "## Idempotency of unsafe methods"

- id: api:idempotency-concurrent
  rule: A concurrent request with an in-flight key is rejected, not executed twice.
  check: No in-progress marker or lock on the key; two simultaneous requests with one key both reach the side effect.
  section: "## Idempotency of unsafe methods"

- id: api:idempotency-not-atomic
  rule: The key store and the side effect commit together.
  check: Key recorded before the write, or after it in a separate transaction or a different store with no atomicity.
  section: "## Idempotency of unsafe methods"

- id: api:idempotency-key-unscoped
  rule: Keys are scoped to the caller and validated before lookup.
  check: Key cache shared across tenants/API keys, or keys accepted without a format/entropy check.
  section: "## Idempotency of unsafe methods"

- id: api:patch-semantics-undefined
  rule: PATCH semantics are named by media type or field mask, one per endpoint.
  check: PATCH accepting `application/json` with ad-hoc "send what changed" semantics; protobuf update with no `update_mask`.
  section: "## Partial updates"

- id: api:merge-patch-null-or-array
  rule: Merge Patch cannot set a value to null or edit part of an array.
  check: Merge Patch endpoint on a resource where null is a meaningful value or where clients need to change array elements.
  section: "## Partial updates"

- id: api:omitted-mask-full-replace
  rule: An omitted field mask means the fields that are set, never all fields.
  check: Update implementation that treats an absent update_mask as "overwrite everything".
  section: "## Partial updates"

- id: api:put-erases-unknown-fields
  rule: Full replacement erases fields the client does not know about.
  check: PUT or mask `*` used as the update path on a resource expected to gain fields, with no documented reset behavior.
  section: "## Partial updates"

- id: api:no-precondition
  rule: A read-modify-write update has a precondition (ETag, etag field, resourceVersion).
  check: Update/delete of a resource edited concurrently with no ETag/If-Match or version check.
  section: "## Concurrency control"

- id: api:if-match-weak
  rule: If-Match uses strong comparison.
  check: Weak ETags (`W/`) accepted as matching in If-Match, or If-Match compared after normalizing the W/ prefix away.
  section: "## Concurrency control"

- id: api:version-token-parsed
  rule: The version token is opaque and compared exactly.
  check: Client or server code comparing resourceVersion/ETag numerically or by ordering.
  section: "## Concurrency control"

- id: api:lro-holds-connection
  rule: Work that outlives a request returns a pollable operation handle.
  check: Handler that blocks on long work until completion with no operation resource, or an operation with no done/error/result fields.
  section: "## Long-running operations"

- id: api:lro-late-validation
  rule: Validation happens before the operation starts.
  check: Request validation done inside the background job, so malformed input surfaces only through polling.
  section: "## Long-running operations"

- id: api:lro-type-changed
  rule: LRO response and metadata types are fixed.
  check: Diff changes an operation's response_type or metadata_type; new LRO uses google.protobuf.Empty where data may be added.
  section: "## Long-running operations"

- id: api:breaking-removal-or-rename
  rule: Removing or renaming a field, method, enum value, endpoint or parameter is breaking.
  check: Any removal or rename in the public schema within the same major version.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:breaking-required-or-stricter
  rule: Adding a required request field, making an optional field required, or tightening validation is breaking.
  check: New required field on an existing request; stricter regex, length, range or enum on an existing input.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:breaking-type-or-format
  rule: Changing a field's type, format or construction rule is breaking, including output-only fields.
  check: Type change, format change (date string to epoch, IPv4 to IPv6), or a different algorithm for a derived value.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:breaking-default
  rule: Changing a default value or whether a default-valued field is serialized is breaking.
  check: Diff changes a documented default, or starts/stops emitting fields at their default value.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:breaking-id-format
  rule: The set of valid resource names or IDs does not change in either direction.
  check: ID length, charset or pattern widened or narrowed.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:breaking-closed-enum-extended
  rule: Adding a value to an enum clients receive is breaking unless the enum was documented as open.
  check: New value on a response enum declared as a closed `enum` with no extensible/open documentation.
  section: "## Compatibility and versioning" ("### Breaking in any API")

- id: api:proto-field-number-reused
  rule: A field number is never reused or changed; deleted fields and enum values are reserved.
  check: Field number reassigned or renumbered; field or enum value deleted without `reserved` for its number (and name).
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:proto-type-changed
  rule: No field type changes, even wire-compatible ones.
  check: Any proto field type change (int32 to int64, string to bytes, enum to int32).
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:proto-oneof-or-cardinality
  rule: Fields are not moved into or out of an existing oneof, and repeated never becomes scalar.
  check: Existing field moved into/out of a oneof; `repeated` removed from a field.
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:proto-json-name-changed
  rule: A field rename or json_name change breaks JSON and text-format clients.
  check: Field renamed or `json_name` changed in a proto served over ProtoJSON (gRPC-Gateway, Connect, gRPC JSON).
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:proto-enum-zero-meaningful
  rule: Every enum's zero value is `*_UNSPECIFIED`; a concept that may grow is an enum, not a bool.
  check: New enum whose 0 value is a real state; new bool for a status-like concept.
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:proto-storage-reuse
  rule: API messages are not storage messages.
  check: The same proto message persisted to a database or used as the ORM model and exposed in an RPC.
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:graphql-removed-not-deprecated
  rule: GraphQL fields are retired with @deprecated and kept, not removed or versioned.
  check: Field, argument, input field or enum value removed from the schema without a prior @deprecated period; a `v2` schema or field suffix.
  section: "## Compatibility and versioning" ("### GraphQL")

- id: api:graphql-deprecated-required
  rule: A required argument or input field carries no @deprecated.
  check: `@deprecated` on a non-null argument or input field with no default.
  section: "## Compatibility and versioning" ("### GraphQL")

- id: api:graphql-nullability-changed
  rule: Changing an output field's nullability or null meaning is a contract change.
  check: Nullable output field made non-null (or vice versa) without a deprecation path.
  section: "## Compatibility and versioning" ("### GraphQL")

- id: api:graphql-error-toplevel-keys
  rule: Application error codes go in errors[].extensions.
  check: Custom keys (`code`, `status`) added at the top level of a GraphQL error object.
  section: "## Compatibility and versioning" ("### GraphQL")

- id: api:deprecation-not-in-contract
  rule: Deprecation is in the contract first, with the replacement named.
  check: Element announced as deprecated (changelog, header) with no `deprecated: true`, `option deprecated`, or `@deprecated` in the schema, or no replacement named.
  section: "## Deprecation and sunset"

- id: api:deprecation-header-format
  rule: Deprecation is an RFC 9651 Date; Sunset is an HTTP-date no earlier than Deprecation.
  check: `Deprecation: true`, an HTTP-date in Deprecation, an epoch in Sunset, or a Sunset date before the Deprecation date.
  section: "## Deprecation and sunset"

- id: api:ships-deprecated
  rule: Functionality does not ship already deprecated.
  check: Element marked deprecated in the same change that promotes it to a more stable channel.
  section: "## Deprecation and sunset"

- id: api:webhook-unsigned
  rule: Every delivery is signed over the raw body plus an ID and timestamp; the receiver verifies raw bytes with constant-time compare and a timestamp tolerance.
  check: Outbound webhook with no signature; receiver verifying a re-serialized body, using `==`, or with tolerance 0 / no timestamp check.
  section: "## Webhooks"

- id: api:webhook-no-event-id
  rule: Each event has a stable ID across retries, and the receiver dedupes on it.
  check: Event ID regenerated per attempt; receiver with no processed-ID store.
  section: "## Webhooks"

- id: api:webhook-order-dependent
  rule: Consumers do not depend on delivery order.
  check: Receiver applying events in arrival order or by `created` timestamp to mutate state, with no refetch or version check.
  section: "## Webhooks"

- id: api:webhook-slow-ack
  rule: The receiver acknowledges with 2xx before slow work.
  check: Webhook handler doing external calls or long processing before responding.
  section: "## Webhooks"

- id: api:webhook-shared-secret
  rule: Signing secrets are per endpoint and rotatable with overlap.
  check: One signing secret for all endpoints/customers, or rotation that invalidates the old secret immediately.
  section: "## Webhooks"

- id: api:throttle-no-signal
  rule: A throttled request gets 429 with Retry-After or quota headers.
  check: Rate limiter that drops, hangs, or returns 503/500 without Retry-After.
  section: "## Rate-limit signalling"

- id: api:ratelimit-reset-unit
  rule: Reset values state their unit.
  check: `X-RateLimit-Reset` (or similar) with no documented unit, or mixed relative/epoch semantics across endpoints.
  section: "## Rate-limit signalling"

- id: api:timestamp-format
  rule: Timestamps are RFC 3339 strings with Z or an offset; unitless epoch integers are not used.
  check: Local time without offset, a custom date format, or an epoch integer with no unit in its name.
  section: "## Time, money, numbers, IDs"

- id: api:date-instant-confused
  rule: Calendar dates, wall-clock times and instants are distinct types.
  check: Birthday or due date stored/serialized as a timestamp at midnight UTC.
  section: "## Time, money, numbers, IDs"

- id: api:duration-unit
  rule: Durations carry their unit.
  check: Duration field as a bare number with no unit suffix and no typed duration.
  section: "## Time, money, numbers, IDs"

- id: api:money-float
  rule: Money is never a binary float and always travels with an ISO 4217 currency code.
  check: `float`/`double`/JSON number parsed as float for an amount; amount field with no sibling currency code.
  section: "## Time, money, numbers, IDs"

- id: api:int64-json-number
  rule: Integers beyond ±2^53 are strings in JSON.
  check: int64/uint64 IDs, counters or minor-unit amounts emitted as JSON numbers when values can exceed 2^53.
  section: "## Time, money, numbers, IDs"

- id: api:numeric-id
  rule: IDs are opaque strings to clients, compared case-sensitively.
  check: ID typed as integer in the public schema; client code doing arithmetic or case-folding on IDs.
  section: "## Time, money, numbers, IDs"

- id: api:nonstandard-codes
  rule: Country, language and currency use standard codes, stated in the contract.
  check: Free-text country or language names, or no stated code standard.
  section: "## Time, money, numbers, IDs"

- id: api:spec-not-updated
  rule: The machine-readable contract changes in the same diff as the code.
  check: Handler, request or response type changes with no matching OpenAPI, .proto or SDL change (or the reverse).
  section: "## Contract and documentation"

- id: api:responses-undocumented
  rule: Every response a client must handle is in the contract.
  check: New error identifiers, 429, or the error schema missing from the spec for a changed operation.
  section: "## Contract and documentation"

- id: api:cli-machine-output-changed
  rule: Machine-readable CLI output is a contract; human output is not.
  check: Field removed/renamed/retyped in `--json` or `--plain` output, or scripts pointed at human-readable output.
  section: "## Contract and documentation" ("### Library, SDK and CLI surfaces")

- id: api:cli-stdout-stderr
  rule: Primary output to stdout, diagnostics to stderr.
  check: Logs, progress or errors written to stdout by a command whose stdout is data.
  section: "## Contract and documentation" ("### Library, SDK and CLI surfaces")

- id: api:cli-future-lock
  rule: No catch-all default subcommand or arbitrary prefix abbreviations; flag changes are additive with a warning before removal.
  check: Default subcommand that can be omitted; prefix matching of subcommands; flag removed or repurposed with no deprecation warning.
  section: "## Contract and documentation" ("### Library, SDK and CLI surfaces")

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: api:pagination-contract-unstated
  rule: The design states page-size default and maximum, token lifetime, whether the total is exact or estimated, and the ordering guarantee.
  check: List endpoint in the design with any of these missing.
  section: "## Collections: pagination, ordering, filtering"

- id: api:idempotency-policy-unstated
  rule: The design states key retention, what is replayed, and which operations require a key.
  check: Idempotency mentioned with no retention window, no statement on replaying errors, or no list of operations that require it.
  section: "## Idempotency of unsafe methods"

- id: api:precondition-policy-unstated
  rule: The design states whether a write without a precondition is accepted.
  check: ETag/version supported but no statement on unconditional writes.
  section: "## Concurrency control"

- id: api:lro-lifecycle-unstated
  rule: The design states operation retention, parallel-operation behavior, and the resource's state while the operation runs.
  check: LRO introduced with any of the three missing.
  section: "## Long-running operations"

- id: api:breaking-check-missing
  rule: The repository runs a breaking-change check against the last released schema in CI and states its category.
  check: Proto/OpenAPI/SDL repository with no buf breaking (or equivalent) step, or no stated category.
  section: "## Compatibility and versioning" ("### Protocol Buffers")

- id: api:compatibility-promise-unstated
  rule: The design states who the clients are, how long old versions or deprecated elements are served, and how breaking change is delivered.
  check: New public API or breaking change with no stated client set, support window or delivery mechanism.
  section: "## Compatibility and versioning" ("### Versioning")

- id: api:deprecation-usage-unmeasured
  rule: The design states how usage of a deprecated element is measured before removal.
  check: Removal or sunset plan with no usage metric or consumer list.
  section: "## Deprecation and sunset"

- id: api:webhook-delivery-policy-unstated
  rule: The provider states the retry schedule and duration, which responses stop retries, and how consumers replay missed events.
  check: Webhook feature with any of these missing.
  section: "## Webhooks"

- id: api:webhook-payload-versioning-unstated
  rule: The event payload is versioned or thin.
  check: Full-payload webhook with no stated version pinning per endpoint.
  section: "## Webhooks"

- id: api:constraints-unstated
  rule: String lengths and charsets, numeric ranges, array maximums and ID formats are stated.
  check: Input fields in the contract with no maxLength, pattern, range or maxItems where the server enforces one.
  section: "## Contract and documentation"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: api:json-casing
  rule: JSON field casing.
  options: snake_case (Zalando) | camelCase (Azure, Kubernetes) | lowerCamelCase emitted with both accepted (ProtoJSON) — any one, applied uniformly
  section: "## Resources and methods" ("### Naming")

- id: api:error-envelope-shape
  rule: Which error envelope.
  options: RFC 9457 problem+json (standard media type, extensible, no built-in machine reason field beyond `type`) | google.rpc.Status + ErrorInfo (one model for gRPC and HTTP, reason/domain/metadata required) | Azure error object + x-ms-error-code header (code readable without parsing the body, Azure-specific)
  section: "## Error model"

- id: api:cursor-or-offset
  rule: Cursor/token vs offset pagination.
  options: cursor/token (stable under inserts, cheap at depth, no page jumps) | offset skip/top (familiar, page jumps, duplicates/skips under writes, slow at depth) | token plus optional skip (AIP-158; jumps from a position, still opaque)
  section: "## Collections: pagination, ordering, filtering"

- id: api:total-count
  rule: Whether to return a total count.
  options: none (Zalando, Azure — cheap, nothing to remove later) | exact (useful for UI, full index scan, hard to remove) | estimated and documented as such (AIP-158)
  section: "## Collections: pagination, ordering, filtering"

- id: api:idempotency-mechanism
  rule: Which deduplication mechanism for unsafe methods.
  options: Idempotency-Key header (widely recognised, IETF draft expired, not a standard) | Repeatability-Request-ID/First-Sent (OASIS, Azure, window ≥ 5 min) | request_id request field (works over gRPC, AIP-155) | client-chosen resource ID with PUT/create (no extra store, needs a meaningful ID)
  section: "## Idempotency of unsafe methods"

- id: api:unknown-write-fields
  rule: Reject or ignore unknown fields in a write.
  options: reject with 400 (Azure, Zalando; catches typos, older servers refuse newer clients) | ignore (newer clients work against older servers, typos pass silently, PUT round-trip breaks) — Zalando requires documenting the choice
  section: "## Partial updates"

- id: api:precondition-mismatch-status
  rule: Status for an ETag/version mismatch.
  options: 412 Precondition Failed (RFC 9110, Azure) | ABORTED / 409 (Google AIP-154) | 409 Conflict (Kubernetes)
  section: "## Concurrency control"

- id: api:lro-threshold
  rule: When an operation becomes long-running, and whether update may be an LRO.
  options: ~10 s rule of thumb, LRO update allowed (Google AIP-151, AIP-134) | p99 > 1 s, PATCH never an LRO, use an action (Azure)
  section: "## Long-running operations"

- id: api:version-location
  rule: Where the API version lives.
  options: major version in path and proto package (Google AIP-185) | required date-valued api-version query parameter (Azure) | media-type versioning, URL versioning forbidden (Zalando) | date version pinned per account, header override, monthly non-breaking + twice-yearly breaking releases (Stripe) | no versions, additive evolution with @deprecated (GraphQL)
  section: "## Compatibility and versioning" ("### Versioning")

- id: api:webhook-signature-scheme
  rule: Symmetric vs asymmetric webhook signatures.
  options: HMAC-SHA256 (Stripe, Standard Webhooks v1; fast, ubiquitous, consumer holds a signing-capable secret) | ed25519 (Standard Webhooks v1a, preferred there; public-key verification, more CPU, key distribution to design)
  section: "## Webhooks"

- id: api:ratelimit-headers
  rule: Which rate-limit headers.
  options: X-RateLimit-* (de facto, semantics differ by vendor) | IETF RateLimit + RateLimit-Policy (structured, active draft, not an RFC) | Retry-After only on 429 (no per-client state needed)
  section: "## Rate-limit signalling"

- id: api:money-shape
  rule: How to represent an amount of money.
  options: integer minor units + currency (Stripe; exact, breaks when a currency's exponent changes, special cases) | units + nanos (google.type.Money) | decimal number + currency object (Zalando; readable, every client must parse as decimal)
  section: "## Time, money, numbers, IDs"

- id: api:id-format
  rule: UUID vs user-chosen IDs.
  options: UUID (no coordination; long, unordered, hard to communicate — Zalando uses them only when needed) | user-chosen ID (idempotent create, needs a documented format, RFC 1034 style per AIP-122)
  section: "## Time, money, numbers, IDs"
