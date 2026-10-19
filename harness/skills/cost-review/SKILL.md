---
name: cost-review
description: Use when a change alters what something costs to run — cloud resources, instance sizes, autoscaling limits, serverless triggers and concurrency, storage classes, retention and lifecycle rules, data transfer paths (cross-zone, cross-region, NAT, internet egress), logging and metrics volume, queries billed by bytes scanned, third-party API or LLM usage, CI minutes — and when judging unit cost per request or user, the worst-case bill (retry storms, recursive triggers, runaway scaling, denial of wallet), idle resources and right-sizing, commitments versus on-demand, budgets that do not cap spend, cost-allocation tags, or a claimed energy or carbon saving.
metadata:
  namespaces: [platform/infra]
---

# Cost Review

Judgment criteria for the money a change spends while it runs. The question
is not "is it cheap" but "does the design say what one unit of work costs,
what the worst case costs, and what stops the worst case". Sources opened
2026-10-19.

Each rule is tagged: **[defect]** is checkable in a diff or config and a match
is a finding; **[silence]** is something a design or PR must state, and its
absence with a concrete consequence is the finding; **[trade-off]** is
defensible either way and is a question for the owner, never a finding.

What this skill does not own, and where it lives instead:

- Budget, spend alert and anomaly alert on new infrastructure —
  `ops-readiness` (`ops:cost-guardrail-missing`). This skill adds only why a
  budget is not a limit.
- Metric label cardinality, series budgets, log levels, trace sampling cost —
  `observability-patterns`.
- LLM output caps, per-user token quotas, prompt caching, the LLM cost
  envelope — `ai-feature-review` (`## Cost and latency controls`).
- Retry budgets, jitter, retries stacked across layers, rate limiters —
  `resilience-patterns`.
- GCP egress, `_Default` sink exclusions, idle GKE node pools —
  `gcp-patterns` (`## Cost traps`).
- Durable Object duration billing, R2 egress — `cloudflare-patterns`.
- `resources.requests` from measured usage, finalizers that leave billed
  resources behind — `k8s-patterns`.
- Job `timeout-minutes`, runner multipliers, trigger scoping —
  `github-actions-patterns` (`## Cost and speed`).
- Loops and queries whose cost grows with input size —
  `algorithmic-complexity`, `sql-tuning`.

## Unit cost

**[silence] A design that adds or changes a billed path states its unit cost
at expected volume.** The unit is whatever the business counts — per
request, per active user, per tenant, per job, per GB stored — and the
statement is the cost of one unit and how it moves as volume grows. The
FinOps Foundation defines unit cost as total cost divided by units, gives
cost per API call as the example, and says a unit trend shows whether growth
in spend is economies of scale or a runaway driver
(https://www.finops.org/framework/capabilities/unit-economics/). Google's
framework asks for unit costing against customers or transactions
(https://docs.cloud.google.com/architecture/framework/cost-optimization/align-cloud-spending-business-value),
Azure asks for cost metrics such as cost per transaction when comparing
scaling options
(https://learn.microsoft.com/en-us/azure/well-architected/cost-optimization/optimize-scaling-costs),
and AWS asks for costs modelled at several usage levels, up and down
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_data_transfer_modeling.html).

Count every meter the unit touches, not only compute: requests to a managed
store, bytes scanned, bytes transferred, log bytes ingested, third-party API
calls and tokens. The Milkie Way incident in 2020 was mostly database reads,
about 116 billion Firestore reads, not Cloud Run compute
(https://www.theregister.com/2020/12/10/google_cloud_over_run/).

**[silence] Align usage to the billing increment.** A meter billed per hour, per
request or with a minimum charge rounds small work up — AWS on-demand
capacity bills by the hour or by the second with a 60-second minimum,
depending on the instance
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_pricing_model_analysis.html).
Azure lists understanding meters and aligning usage to them as its own
checklist item, with a proof of concept to validate the major cost drivers
(https://learn.microsoft.com/en-us/azure/well-architected/cost-optimization/checklist,
CO:06). The design names the increment of its largest meter when the unit of
work is much smaller than it.

## Worst case and denial of wallet

The bill that matters in review is the one produced when something goes
wrong: a loop, a retry storm, a crawler, a scaling rule with no ceiling.
Usage-billed services scale the bill with the failure.

**[defect] Every autoscaled or serverless resource has an explicit upper
bound chosen for cost.** Cloud Run's default is 100 instances per revision,
and Google calls max instances a cost-safety limit, suggesting a low starting
value (https://docs.cloud.google.com/run/docs/configuring/max-instances). In
2020 the defaults then in force (1,000 instances, concurrency 80) let a
recursive crawler run up about $72,000 in roughly two hours
(https://www.theregister.com/2020/12/10/google_cloud_over_run/). Azure's
scaling guidance names capping supply as the cost control, with the trade
that a strict cap may refuse real demand
(https://learn.microsoft.com/en-us/azure/well-architected/cost-optimization/optimize-scaling-costs).
The finding is a scaling setting left at the platform default or set with no
stated reason, not a cap that someone chose.

**[defect] A function never writes to the resource that triggers it, unless
the loop is bounded in code.** A function that writes to the queue, topic or
bucket that invokes it re-invokes itself. AWS says such loops cause
unexpected charges and can use all of the account's concurrency; Lambda stops
a chain after about 16 invocations, but only for loops through SQS, S3, SNS
and EventBridge custom buses with a supported SDK, not through DynamoDB or
other services (https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html).
The same doc names using one variable for both event source and target as a
common cause. Check: the function's output destination (bucket, prefix,
queue, topic, table with a stream) equals or overlaps its trigger, with no
prefix split and no hop counter. Reported cases include an S3 bucket used as
both source and destination and a runaway Azure Functions `runOnStartup`
(https://www.infoq.com/news/2022/08/recursive-serverless-functions/).

**[defect] Event-driven retries have an end condition.** Google's retry docs
say a function set to retry on failure retries until it succeeds, within a
Pub/Sub retry window of 7 days by default, and recommend discarding events
older than a threshold
(https://docs.cloud.google.com/functions/docs/bestpractices/retries). A
deterministic failure with retries on bills every attempt for a week. The
retry policy itself is `resilience-patterns`'s; the finding here is the
missing age or attempt bound on a billed path.

**[silence] The design states the worst-case cost and what stops it.** Name
the bound (max instances × instance price, quota, `maximum_bytes_billed`,
per-tenant rate limit) and the cost reached before the bound or a person
acts. The arithmetic for one failure mode — a loop, a retry storm, a crawler
— is enough; "monitoring will catch it" is not, for the reason in the next
section.

**[defect] Unbounded fan-out to a billed call.** One inbound request or event
that triggers one paid call per item of an input-sized list — a third-party
API per row, an LLM call per document, a function invocation per object —
has a cap on the list size or on the calls per request. Without it the cost
of one request is set by its input. Per-user quotas for LLM calls are
`ai-feature-review`'s (`ai:no-per-user-quota`); this item
covers the same shape for any paid API.

**[trade-off] Who pays for unauthenticated traffic.** A billed endpoint or
bucket that answers anonymous requests turns traffic someone else sends into
your bill. AWS changed S3 in May 2024 so bucket owners are not charged for
403 responses to requests from outside their account or organization
(https://aws.amazon.com/about-aws/whats-new/2024/05/amazon-s3-no-charge-http-error-codes/);
the trigger was a public report of an empty private bucket billed for
unauthorized requests (https://medium.com/@maciej.pocwierz/how-an-empty-s3-bucket-can-make-your-aws-bill-explode-934a383cb8b1,
unverified: returned 403). Other services and providers may still bill
rejected requests. Options: authenticate before the billed hop (no
anonymous cost, more friction) | edge rate limit or WAF in front (cheap
requests stay cheap, rule upkeep) | accept it with an anomaly alert (simplest,
cost exposure until someone responds).

## Budgets are a silence, not a limit

**[silence] A budget or spend alert is never presented as the cap.** AWS
Budgets data updates up to three times a day, typically 8–12 hours apart, and
AWS warns that costs can pass the threshold before the notification arrives
(https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).
Google says an alerts-only budget does not cap usage or spending and that
cost reporting lags usage
(https://docs.cloud.google.com/billing/docs/how-to/budgets). The Milkie Way
team had a $7 budget and billing data that lagged about a day
(https://www.theregister.com/2020/12/10/google_cloud_over_run/). So a design
whose only protection against the worst case is a budget alert has no
protection for the hours before the alert. The hard stop comes from a quota,
a max-instance setting, a per-query byte limit, a budget action that applies
a deny policy (AWS) or disables billing (Google), or a provider spend cap —
and the design names which one. Whether a budget and alerts exist at all is
`ops:cost-guardrail-missing`.

**[trade-off] Automatic stop at the budget.** Budget actions can deny new
provisioning (AWS) or disable billing on a project (Google, per the pages
above). Options: automatic stop (bounded bill; a production outage when it
fires) | alert only (no self-inflicted outage; unbounded cost until a person
acts) | automatic stop for non-production and sandboxes, alert only for
production.

## Data transfer

**[silence] Every new data path that crosses a zone, region, NAT or the
internet is named with its volume.** AWS says transfer fees are usually
neglected in design and are set by source, destination and volume; it asks
for a transfer model per component and for each transfer cost to be linked to
the outcome it buys, such as cross-zone replication for resilience
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_data_transfer_modeling.html).
On AWS, transfer between Availability Zones is charged for both inbound and
outbound on each metered resource, and inter-region transfer is charged on
the source side
(https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html).
A chatty service placed in another zone or region from its database pays on
every call; a replica in another region pays on every write. GCP specifics
are `gcp:egress-path-unstated`.

**[defect] Same-region traffic to S3 or DynamoDB does not go through a NAT
gateway when a gateway endpoint would carry it.** AWS charges NAT gateway
data processing per GB for traffic to same-region AWS services, while gateway
endpoints for S3 and DynamoDB carry it without transfer charges
(https://aws.amazon.com/blogs/architecture/overview-of-data-transfer-costs-for-common-architectures/).
Check: private subnets with a route to a NAT gateway, workloads reading or
writing S3 or DynamoDB in the same region, and no gateway VPC endpoint.

**[trade-off] Redundancy against transfer cost.** Multi-zone and
multi-region placement buys availability and pays transfer on every
replicated byte. Options: single zone (no cross-zone transfer; one zone
outage takes it down) | multi-zone (survives a zone; cross-zone transfer on
replication and on calls that cross) | zone-aware routing that keeps calls in
the caller's zone (less transfer; uneven load when a zone is short of
capacity).

## Logs, metrics and query scans

**[defect] Every new log store sets a retention period.** CloudWatch Logs
keeps log data indefinitely by default
(https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html),
so a log group created without one grows its storage bill forever. Check:
`aws_cloudwatch_log_group` or equivalent with no `retention_in_days`; a log
bucket or sink with no retention or lifecycle rule. Log volume from DEBUG or
health-check logging on GCP is `gcp:log-exclusion-missing`; label
cardinality is `observability:unbounded-label`.

**[silence] A change that adds high-volume telemetry states its ingest
volume.** A new access log, audit trail, span per message or metric per
entity has a cost of bytes or series per unit of work, which belongs in the
unit cost above. Observability spend can reach the size of a product line:
Coinbase's 2021 Datadog bill was about $65M
(https://blog.pragmaticengineer.com/datadog-65m-year-customer-mystery/).
The diagnosis order for a telemetry bill spike is
`observability-patterns`'s.

**[defect] Queries billed by bytes scanned are bounded.** BigQuery on-demand
bills per TiB read; `LIMIT` does not reduce bytes read on a non-clustered
table; `maximum_bytes_billed` makes an over-limit query fail without charge;
custom daily quotas cap data processed per project or user
(https://docs.cloud.google.com/bigquery/docs/best-practices-costs). Check: a
scheduled, user-triggered or per-request query against a large table with no
partition filter, no byte limit and no quota, or one that relies on `LIMIT`
to keep cost down.

## Storage lifecycle and retention

**[silence] Every new bucket, table or backup set states its retention and
tier transitions.** Azure lists tiering and retention as the first data cost
lever, with storage, transaction and latency as the three cost components
(https://learn.microsoft.com/en-us/azure/well-architected/cost-optimization/optimize-data-costs);
Google points to Object Lifecycle Management and Autoclass
(https://docs.cloud.google.com/architecture/framework/cost-optimization/optimize-resource-usage).
The statement names how long data stays hot, when it moves colder, when it is
deleted, and which legal or business rule sets those numbers. Retention of
personal data is `privacy-review`'s; this item is the cost side.

**[trade-off] Colder tiers against retrieval and early-deletion charges.**
Azure notes that automated tiering can be offset by retrieval, transaction or
early-deletion costs, and recommends a mock run before a large lifecycle
change (same Azure page). Options: hot only (no retrieval cost, highest
storage price) | lifecycle to cold or archive (lower storage price; retrieval
fees, minimum durations, slower reads) | intelligent or auto tiering (no rule
upkeep; per-object monitoring fees on some providers).

## Idle resources and right-sizing

**[silence] Each new resource has an owner and an end.** AWS asks for
resources tracked over their lifetime with tags naming the workload or a
decommission date (`TTL`-style tags), and for an alarm when a workload's
requests or outputs drop to zero
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_decomissioning_resources_track.html).
A test environment, a one-off migration cluster or a load-test fleet with no
stated end date is a standing cost.

**[silence] Instance sizes come from measured utilization.** AWS's rightsizing
example flags instances whose maximum CPU and memory stay below 40% over four
weeks
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_type_size_number_resources_metrics.html).
A size or tier change states the utilization it was chosen from; a size
"picked to be safe" is the finding. Kubernetes requests are
`k8s:requests-basis-unstated`.

**[trade-off] Non-production schedules.** AWS reports that stopping
instances outside working hours and at weekends can cut their cost by 70% or
more, with storage still billed
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_pricing_model_analysis.html).
Options: always on (no wait, full cost) | scheduled stop (most compute cost
gone; first use each morning waits, jobs outside hours fail) | scale to zero
on demand (no idle cost; cold start on every first request).

## Commitments against on-demand

**[trade-off] Commit for steady load, stay on-demand or spot for the rest.**
AWS frames the choice by component: long-running resources for commitment
discounts, dynamic and short-running ones for on-demand or spot, and notes
that capacity reservations are not a discount
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_pricing_model_analysis.html).
The FinOps Foundation's risks: an unused commitment is still paid, rightsizing
after buying can strand it, and staggered purchases keep some commitments
expiring for re-evaluation; it suggests a break-even within about nine months
(https://www.finops.org/framework/capabilities/rate-optimization/). Options:
commitment (largest discount; paid whether used or not) | on-demand (no
lock-in; highest rate) | spot or preemptible (deepest discount; interruption
handling required).

**[silence] A change under an existing commitment says what happens to it.**
Resizing, moving region or changing instance family on resources a
reservation, savings plan or committed use discount covers can leave the
commitment paid and unused — the stranding risk the FinOps page names.

## Cost attribution

**[defect] New resources carry the project's required cost-allocation tags or
labels.** AWS asks for a tagging schema with mandatory tags, automated at
creation, and reports on untagged spend
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_monitor_usage_org_information.html);
Google asks for a labelling policy enforced through automation such as
Terraform
(https://docs.cloud.google.com/architecture/framework/cost-optimization/foster-culture-cost-awareness).
Check this only where the project defines the schema — a provider
`default_tags` block, a tag policy, a labels module, a documented list — and
flag a new resource that bypasses it. Where the project defines none, it is
the silence below.

**[silence] A project that creates billed resources says how cost is
attributed.** AWS rates the absence of cost attribution categories high risk
and ties them to accountability for spend
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_monitor_usage_define_attribution.html).
Without attribution, the unit cost above cannot be measured after launch.

## Energy and carbon

Raise this only when a change or design claims an energy or carbon effect, or
when region choice is already open for other reasons.

**[silence] A claimed emissions reduction names which term of the SCI it
moves.** The Green Software Foundation's Software Carbon Intensity is
((E × I) + M) per R: energy used, carbon intensity of that energy by region
and time, embodied hardware emissions, per functional unit; the score falls
only through energy efficiency, carbon awareness (running where or when I is
lower) or hardware efficiency, and offsets do not count
(https://sci.greensoftware.foundation/). A claim that does not name E, I or M
and the unit R is not measurable. Usually the cost levers above (less
compute, fewer idle resources, less transfer and storage) move E and M at the
same time.

## Related

- `ops-readiness` — budgets, spend and anomaly alerts, capacity plans,
  decommissioning.
- `observability-patterns` — telemetry cost and cardinality.
- `ai-feature-review` — LLM cost envelope, quotas, caching.
- `resilience-patterns` — retry budgets and rate limiting that bound the
  worst case.
- `gcp-patterns`, `cloudflare-patterns`, `k8s-patterns`,
  `terraform-patterns`, `github-actions-patterns` — provider-specific cost
  traps.
