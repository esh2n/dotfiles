---
name: gcp-patterns
description: Use when designing or reviewing GCP infrastructure — IAM role/service-account grants, Pub/Sub topics and subscriptions, Cloud Run vs GKE deployment choices, Terraform-managed GCP resources, gcloud scripts, or debugging quota errors, retry storms, or an unexpectedly large GCP bill.
---

# GCP Patterns

Judgment criteria for GCP infrastructure decisions. Assumes GKE/Cloud Run,
Pub/Sub, Cloud SQL/Spanner, IAM, and Terraform-managed resources.

## IAM judgment

- **Grant the narrowest predefined role that covers the need.** Never grant
  primitive roles (`roles/owner`, `roles/editor`) to a workload or human "to
  unblock" — this is the single most common finding in IAM reviews and it
  never gets revisited once the blocker is gone. Reach for a custom role only
  when no predefined role fits; don't build one preemptively.
- **Service account per workload, not shared, by default.** Share an SA only
  across components that are deployed and rotated together as one unit.
  Rationale: a shared SA means one compromised workload's blast radius is
  every workload behind that identity, and audit logs can't tell which
  component actually made a call.
- **Workload Identity (GKE) / Workload Identity Federation (external) over
  service account key files — keys are an anti-pattern, not a fallback.**
  A JSON key never expires on its own, is trivially exfiltrated, and often
  ends up committed to a repo. Treat any `google_service_account_key`
  Terraform resource, any `gcloud iam service-accounts keys create`, or any
  downloaded `.json` key in a script as a red flag: ask why WIF/ADC doesn't
  work here before accepting the key as necessary.
- **Bind at the narrowest resource that works** — a bucket, topic, or dataset
  binding beats a project-level binding when the workload only touches that
  one resource. Project-level IAM grants are easy to over-scope silently.
- Use IAM Conditions for time-bound or resource-bound grants (e.g. break-glass
  access) instead of a permanent broad binding that outlives the reason for it.

## Pub/Sub pitfalls

- **Delivery is at-least-once, never exactly-once by default.** A consumer
  that isn't idempotent will double-process on redelivery — this is not an
  edge case, it is the normal operating mode. Dedup by message ID (or a
  domain idempotency key) before applying side effects, even if the exactly-
  once delivery feature is enabled (it still allows duplicates once messages
  age past its dedup window).
- **Ack deadline vs. actual processing time.** The default ack deadline (10s)
  is almost never right — if handler processing can exceed it, either extend
  the deadline (`modifyAckDeadline`) or the message redelivers *while still
  being processed*, causing a duplicate side effect mid-flight. Set the
  deadline deliberately from measured p99 processing time, don't leave the
  default.
- **DLQ max-delivery-attempts is a judgment call, not a default to accept.**
  Too low and transient failures (a brief downstream outage) dead-letter and
  are lost; too high and a poison message retries for days, consuming
  subscriber throughput. Whatever value you pick, pair it with an alert and a
  replay path — a DLQ nobody monitors is data loss with a delay, not a safety
  net.
- Ordering keys serialize delivery for that key to one consumer at a time —
  only add an ordering key when a real ordering requirement exists; adding it
  by default silently creates a throughput bottleneck.

## Cloud Run vs GKE

Default to Cloud Run. Move to GKE only when a concrete requirement forces it:

| Signal | Choice |
|---|---|
| Stateless request/response or event-driven, scale-to-zero acceptable | Cloud Run |
| No need to own cluster/node-pool lifecycle | Cloud Run |
| Needs persistent volumes / stateful workload | GKE |
| Needs a service mesh, custom CNI, or fine-grained bin-packing control | GKE |
| Team already owns k8s tooling/on-call for other workloads | GKE (marginal cost is lower) |

GKE brings ongoing node-pool sizing, upgrade, and patching cost that is easy
to underestimate at design time — don't choose it for "future flexibility"
without a current requirement.

## Quota and retry judgment

- Exponential backoff **with jitter** is required for any custom retry loop —
  without jitter, every client backs off in lockstep and re-hammers the API
  at the same instant, which is what actually trips a quota a second time.
  Client libraries (google-cloud-*) already do this; don't wrap them in a
  second, un-jittered retry loop.
- Retry judgment by error class: retry `429`/`RESOURCE_EXHAUSTED` and
  `503`/`UNAVAILABLE`. Do **not** retry `400`/`INVALID_ARGUMENT`,
  `403`/`PERMISSION_DENIED`, or `404`/`NOT_FOUND` — these are deterministic
  and retrying only burns quota and delays surfacing the real bug.
- If load is predictable (a launch, a migration, a backfill), file the quota
  increase days ahead — quota increases are not instant, and hitting the
  ceiling mid-launch is a self-inflicted incident.

## Cost traps

- **Egress is the line item nobody budgeted for.** Cross-region and
  internet-bound egress adds up fast; keep data movement within a region and
  prefer Private Google Access / Private Service Connect over public IPs for
  service-to-service traffic.
- **Logging sink explosion.** A default log sink captures everything,
  including high-volume health-check and DEBUG-level noise; Cloud Logging
  cost scales with request volume. Add exclusion filters for low-value,
  high-cardinality logs at write time — don't wait for the bill to reveal it.
- **Idle GKE nodepools bill 24/7 regardless of traffic.** A nodepool with
  `min-node-count` set above actual baseline load (or a leftover pool from a
  past experiment) is a standing cost with no corresponding value — audit
  min-node-count against real baseline periodically, not just at setup.

## gcloud CLI judgment

Always pass `--project` explicitly in scripts and CI. Never rely on
`gcloud config set project` ambient state — a different operator or CI runner
without that local config silently targets the wrong project, or fails with a
confusing "resource not found" instead of a clear project mismatch. The same
applies to Terraform: pin `project` in the provider block rather than
inheriting an ambient default.

## Terraform

For the accompanying rule (never hardcode project IDs or secrets in `.tf`),
see `packs/gcp/rules/gcp/terraform-gcp.md`.
