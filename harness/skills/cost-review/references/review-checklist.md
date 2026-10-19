# cost-review — review checklist

Derived from ../SKILL.md. Read by `workload-reviewer` and `rollout-reviewer` through the `change-review` skill when a diff changes something that costs money to run — cloud resources, instance sizes, autoscaling, serverless triggers, storage classes and retention, data transfer paths, logging and metrics volume, queries billed by scan, third-party API and LLM usage, CI minutes (defects; silences and trade-offs in a design, spec or launch review) — and by `grilling` (trade-offs). Worst-case, fan-out, transfer, query and unit-cost items go to `workload-reviewer`; scaling limits, retention, lifecycle, tags, commitments and budget items to `rollout-reviewer`. Budget existence is `ops:cost-guardrail-missing`, telemetry cardinality `observability-patterns`, LLM quotas and caps `ai-feature-review`, CI runner cost `github-actions-patterns`; report their ids, not a `cost:` duplicate. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: cost:scaling-cap-default
  rule: Every autoscaled or serverless resource has an explicit upper bound chosen for cost.
  check: Cloud Run, Cloud Functions, Lambda, App Service, HPA, ASG, KEDA or similar scaling config whose maximum (max instances, max replicas, max capacity, reserved concurrency) is absent or left at the platform default with no stated reason.
  section: "## Worst case and denial of wallet"

- id: cost:self-triggering-function
  rule: A function never writes to the resource that triggers it, unless the loop is bounded in code.
  check: Function whose output bucket, prefix, queue, topic or streamed table equals or overlaps its trigger source; the same variable or config value used for event source and target; no prefix split and no hop counter.
  section: "## Worst case and denial of wallet"

- id: cost:event-retry-unbounded
  rule: Event-driven retries on a billed path have an age or attempt bound.
  check: Function or consumer with retry-on-failure enabled and no check that discards events past an age or attempt count, and no shortened retry window.
  section: "## Worst case and denial of wallet"

- id: cost:billed-fan-out-unbounded
  rule: One request or event does not trigger an input-sized number of paid calls without a cap.
  check: Loop over a request- or event-supplied list that calls a paid third-party API, an LLM or a function invocation per item, with no limit on list size or calls per request. LLM per-user quotas are `ai:no-per-user-quota`.
  section: "## Worst case and denial of wallet"

- id: cost:nat-for-same-region-service
  rule: Same-region traffic to S3 or DynamoDB uses a gateway VPC endpoint rather than a NAT gateway.
  check: Private subnets routed through a NAT gateway, workloads using S3 or DynamoDB in the same region, and no gateway VPC endpoint for that service.
  section: "## Data transfer"

- id: cost:log-retention-missing
  rule: Every new log store sets a retention period.
  check: `aws_cloudwatch_log_group` or equivalent without `retention_in_days`; a log bucket, sink or index with no retention or lifecycle rule.
  section: "## Logs, metrics and query scans"

- id: cost:scan-query-unbounded
  rule: Queries billed by bytes scanned are bounded.
  check: Scheduled, user-triggered or per-request query on a large BigQuery (or similar scan-billed) table with no partition filter, no `maximum_bytes_billed` and no custom quota; `LIMIT` relied on to reduce cost on a non-clustered table.
  section: "## Logs, metrics and query scans"

- id: cost:required-tags-missing
  rule: New resources carry the project's required cost-allocation tags or labels.
  check: Only where the project defines a schema (provider `default_tags`, tag policy, labels module, documented list): a new billed resource that bypasses or omits it.
  section: "## Cost attribution"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: cost:unit-cost-unstated
  rule: A design adding or changing a billed path states its unit cost at expected volume and how it moves as volume grows.
  check: Design with no cost per request, user, tenant, job or GB; or one that counts compute only and omits store requests, bytes scanned, transfer, log ingest or third-party calls.
  section: "## Unit cost"

- id: cost:billing-increment-unstated
  rule: The increment of the largest meter is named when the unit of work is much smaller than it.
  check: Short or small work units on a meter billed per hour, per request or with a minimum charge, with no statement of the rounding.
  section: "## Unit cost"

- id: cost:worst-case-unstated
  rule: The design states the worst-case cost and the bound that stops it.
  check: No arithmetic for at least one failure mode (loop, retry storm, crawler, runaway scaling) and no named bound (max instances × price, quota, byte limit, rate limit); "monitoring will catch it" given as the bound.
  section: "## Worst case and denial of wallet"

- id: cost:budget-as-cap
  rule: A budget or spend alert is never presented as the cap; the hard stop is named.
  check: Design or PR citing a budget or alert as protection against runaway cost with no quota, max-instance setting, byte limit, budget action or provider spend cap.
  section: "## Budgets are a silence, not a limit"

- id: cost:transfer-path-unstated
  rule: Every new data path crossing a zone, region, NAT or the internet is named with its volume and the outcome it buys.
  check: Components placed in different zones or regions, a new cross-region replica, or bulk internet egress with no transfer estimate. GCP specifics are `gcp:egress-path-unstated`.
  section: "## Data transfer"

- id: cost:telemetry-volume-unstated
  rule: A change adding high-volume telemetry states its ingest volume per unit of work.
  check: New access log, audit trail, per-message span or per-entity metric with no bytes or series estimate.
  section: "## Logs, metrics and query scans"

- id: cost:storage-lifecycle-unstated
  rule: Every new bucket, table or backup set states its retention, tier transitions and the rule behind them.
  check: New data store with no retention period, no lifecycle or tiering rule, or numbers with no legal or business basis.
  section: "## Storage lifecycle and retention"

- id: cost:resource-end-unstated
  rule: Each new resource has an owner and an end.
  check: Test environment, migration cluster or load-test fleet with no owner, decommission date or TTL tag, and no zero-traffic alarm.
  section: "## Idle resources and right-sizing"

- id: cost:size-basis-unstated
  rule: Instance sizes and tiers come from measured utilization.
  check: Size or tier change with no utilization figure behind it, or one picked "to be safe". Kubernetes requests are `k8s:requests-basis-unstated`.
  section: "## Idle resources and right-sizing"

- id: cost:commitment-impact-unstated
  rule: A change that resizes, moves region or changes instance family under an existing commitment states what happens to the commitment.
  check: Instance family, size or region change on resources covered by reservations, savings plans or committed use discounts with no mention of the commitment.
  section: "## Commitments against on-demand"

- id: cost:attribution-unstated
  rule: A project that creates billed resources says how cost is attributed.
  check: Project creating billed resources with no tag or label schema, cost category or account split.
  section: "## Cost attribution"

- id: cost:carbon-claim-unmeasured
  rule: A claimed emissions reduction names which SCI term (E, I or M) it moves and the functional unit R.
  check: Design or PR claiming lower energy or carbon with no named term or unit, or counting offsets.
  section: "## Energy and carbon"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: cost:unauthenticated-billed-traffic
  rule: Who pays for anonymous traffic to a billed endpoint or bucket.
  options: authenticate before the billed hop (no anonymous cost, more friction) | edge rate limit or WAF in front (cheap requests stay cheap, rule upkeep) | accept with an anomaly alert (simplest, exposure until someone responds)
  section: "## Worst case and denial of wallet"

- id: cost:auto-stop-at-budget
  rule: Automatic stop at the budget vs alert only.
  options: automatic stop (bounded bill, production outage when it fires) | alert only (no self-inflicted outage, unbounded cost until a person acts) | stop for non-production, alert for production
  section: "## Budgets are a silence, not a limit"

- id: cost:redundancy-vs-transfer
  rule: Redundancy against transfer cost.
  options: single zone (no cross-zone transfer, one zone outage takes it down) | multi-zone (survives a zone, transfer on replication and crossing calls) | zone-aware routing (less transfer, uneven load when a zone is short)
  section: "## Data transfer"

- id: cost:cold-tier-vs-retrieval
  rule: Colder storage tiers against retrieval and early-deletion charges.
  options: hot only (no retrieval cost, highest storage price) | lifecycle to cold or archive (lower storage price, retrieval fees, minimum durations, slower reads) | auto tiering (no rule upkeep, monitoring fees on some providers)
  section: "## Storage lifecycle and retention"

- id: cost:non-prod-schedule
  rule: Non-production always on vs scheduled vs scale to zero.
  options: always on (no wait, full cost) | scheduled stop (most compute cost gone, morning wait, off-hours jobs fail) | scale to zero (no idle cost, cold start on first request)
  section: "## Idle resources and right-sizing"

- id: cost:commit-or-on-demand
  rule: Commitment vs on-demand vs spot for a component.
  options: commitment (largest discount, paid whether used or not) | on-demand (no lock-in, highest rate) | spot or preemptible (deepest discount, interruption handling required)
  section: "## Commitments against on-demand"
