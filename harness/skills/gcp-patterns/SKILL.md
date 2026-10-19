---
name: gcp-patterns
description: Use when designing or reviewing GCP infrastructure — IAM role/service-account grants, Pub/Sub topics and subscriptions, Cloud Run vs GKE deployment choices, Terraform-managed GCP resources, gcloud scripts, or debugging quota errors, retry storms, or an unexpectedly large GCP bill.
metadata:
  namespaces: [platform/infra]
---

# GCP Patterns

Judgment criteria for GCP infrastructure decisions. Assumes GKE/Cloud Run,
Pub/Sub, Cloud SQL/Spanner, IAM, and Terraform-managed resources. Sources
checked 2026-10-19; Google's docs now live under docs.cloud.google.com and
the cloud.google.com links below redirect there.

## IAM judgment

- **Grant the narrowest predefined role that covers the need.** Do not grant
  the basic roles (`roles/owner`, `roles/editor`; formerly "primitive roles")
  to a workload or human "to unblock" — Google advises against basic roles in
  production unless there is no alternative, and the grant never gets
  revisited once the blocker is gone
  (https://cloud.google.com/iam/docs/using-iam-securely#least-privilege).
  Reach for a custom role only when no predefined role is narrow enough;
  don't build one preemptively.
- **Service account per workload, not shared, by default.** Share an SA only
  across components that are deployed and rotated together as one unit.
  Rationale: a shared SA means one compromised workload's blast radius is
  every workload behind that identity, and audit logs record the service
  account, not which component behind it made the call
  (https://cloud.google.com/iam/docs/best-practices-service-accounts).
- **Workload Identity Federation for GKE / Workload Identity Federation
  (external) / attached service accounts over service account key files —
  keys are an anti-pattern, not a fallback.** A user-managed key has no
  expiry by default and stays valid until deleted, is trivially exfiltrated,
  and often ends up committed to a repo
  (https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
  Organizations created on or after 2024-05-03 enforce the "disable service
  account key creation" constraint by default. Treat any
  `google_service_account_key` Terraform resource, any
  `gcloud iam service-accounts keys create`, or any downloaded `.json` key in
  a script as a red flag: ask why WIF/ADC doesn't work here before accepting
  the key as necessary.
- **Bind at the narrowest resource that works** — a bucket, topic, or dataset
  binding beats a project-level binding when the workload only touches that
  one resource (Google's own example is Publisher on one topic). Project-level
  IAM grants are easy to over-scope silently
  (https://cloud.google.com/iam/docs/using-iam-securely#least-privilege).
- Use IAM Conditions for time-bound or resource-bound grants (e.g. break-glass
  access) instead of a permanent broad binding that outlives the reason for it
  (same source).
- **Grant impersonation on the service account, never on the project or
  folder.** `roles/iam.serviceAccountTokenCreator` at project level lets the
  holder impersonate every service account in the project and reach whatever
  those accounts can reach, including resources outside it
  (https://cloud.google.com/iam/docs/best-practices-service-accounts).
  `roles/iam.serviceAccountUser` lets a principal attach a service account to
  a resource and run code as it; it does not grant short-lived tokens or
  `--impersonate-service-account`, which need Token Creator
  (https://cloud.google.com/iam/docs/service-account-permissions). Bind
  either role on the individual service account resource
  (`google_service_account_iam_member`).
- **Enforce guardrails with Organization Policy constraints, not review
  alone.** Google's security baseline, enforced by default for organizations
  created on or after 2024-05-03, includes
  `iam.managed.disableServiceAccountKeyCreation`,
  `iam.disableServiceAccountKeyUpload` and `iam.allowedPolicyMemberDomains`
  (https://cloud.google.com/resource-manager/docs/secure-by-default-organizations).
  Domain-restricted sharing limits IAM grants to identities of your
  organization or Google Workspace customer ID: through the managed
  `iam.managed.allowedPolicyMembers` constraint, a custom policy on
  `iam.googleapis.com/AllowPolicy`, or the legacy
  `iam.allowedPolicyMemberDomains`, whose allowed values must include your
  own organization or nothing in it can be granted
  (https://cloud.google.com/resource-manager/docs/organization-policy/restricting-domains).
  The legacy `iam.disableServiceAccountKeyCreation` and
  `iam.serviceAccountKeyExpiryHours` are also in the constraint list
  (https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints).
  Overriding or disabling one of these at project or folder level is a
  security decision, not a fix for a failing deploy.
- **VPC Service Controls for data exfiltration.** A service perimeter around
  projects stops data protected services (Cloud Storage, BigQuery and others)
  from being copied to resources outside it, even when IAM is misconfigured;
  dry run mode logs what a perimeter would block without blocking it
  (https://cloud.google.com/vpc-service-controls/docs/overview). Projects
  holding sensitive data with no perimeter rely on IAM alone, and a new
  perimeter goes through dry run before enforcement.

## Pub/Sub pitfalls

- **Delivery is at-least-once by default.** A consumer that isn't idempotent
  will double-process on redelivery — this is not an edge case, it is the
  normal operating mode. Dedup by message ID (or a domain idempotency key)
  before applying side effects, even with exactly-once delivery enabled: it
  covers pull subscriptions only, holds only for subscribers in the same
  region, and a publisher retry creates a copy with a new message ID that it
  cannot recognize as a duplicate
  (https://cloud.google.com/pubsub/docs/exactly-once-delivery).
- **Ack deadline vs. actual processing time.** The subscription default is
  10s (range 10–600s). The high-level client libraries extend it
  automatically with `modifyAckDeadline` — by default for up to one hour per
  message — so with them the setting that matters is the maximum lease
  extension: if handler processing can exceed it, the message redelivers
  *while still being processed*, causing a duplicate side effect mid-flight
  (https://cloud.google.com/pubsub/docs/lease-management). Code that pulls
  through the raw API, or that sets its own extension limits, must set the
  deadline deliberately from measured p99 processing time
  (https://cloud.google.com/pubsub/docs/subscription-properties).
- **DLQ max-delivery-attempts is a judgment call, not a default to accept**
  (allowed 5–100, default 5;
  https://cloud.google.com/pubsub/docs/handling-failures).
  Too low and transient failures (a brief downstream outage) dead-letter and
  are lost; too high and a poison message retries for days, consuming
  subscriber throughput. Whatever value you pick, pair it with an alert and a
  replay path — a DLQ nobody monitors is data loss with a delay, not a safety
  net.
- Ordering keys keep one batch (pull) or one message (push) outstanding per
  key, cap publishing at 1 MBps per key, and redeliver every later message of
  a key when one is redelivered
  (https://cloud.google.com/pubsub/docs/ordering) — only add an ordering key
  when a real ordering requirement exists; adding it by default silently
  creates a throughput bottleneck.

## Cloud Run vs GKE

Default to Cloud Run. Move to GKE only when a concrete requirement forces it
(Google's comparison: https://cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run):

| Signal | Choice |
|---|---|
| Stateless request/response or event-driven, scale-to-zero acceptable | Cloud Run |
| No need to own cluster/node-pool lifecycle | Cloud Run |
| Needs persistent block volumes / stateful workload | GKE |
| Needs a service mesh, custom CNI, or fine-grained bin-packing control | GKE |
| Team already owns k8s tooling/on-call for other workloads | GKE (marginal cost is lower) |

Cloud Run can mount a Cloud Storage bucket as a volume, but without file
locking or full POSIX semantics, so it is not a substitute for a stateful
disk (https://cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts).
GKE brings ongoing node-pool sizing, upgrade, and patching cost that is easy
to underestimate at design time — don't choose it for "future flexibility"
without a current requirement.

## Quota and retry judgment

- Exponential backoff **with jitter** is required for any custom retry loop
  (https://cloud.google.com/storage/docs/retry-strategy) — without jitter,
  every client backs off in lockstep and re-hammers the API at the same
  instant, which is what actually trips a quota a second time. Most
  google-cloud-* client libraries already retry idempotent calls this way;
  don't wrap them in a second, un-jittered retry loop.
- Retry judgment by error class (https://google.aip.dev/194): retry
  `UNAVAILABLE` (HTTP `503`), and for HTTP APIs such as Cloud Storage also
  `408`, `429` and other `5xx`. `RESOURCE_EXHAUSTED` is not retried
  automatically because it may mean an exhausted quota — retry it only with
  backoff and only where the API's docs say it is transient. Do **not** retry
  `400`/`INVALID_ARGUMENT`, `403`/`PERMISSION_DENIED`, or `404`/`NOT_FOUND`
  — these are deterministic and retrying only burns quota and delays
  surfacing the real bug.
- If load is predictable (a launch, a migration, a backfill), file the quota
  increase days ahead — increase requests go through review and are approved
  or denied by email, not applied instantly
  (https://cloud.google.com/docs/quotas/help/request_increase); hitting the
  ceiling mid-launch is a self-inflicted incident.

## Cost traps

- **Egress is the line item nobody budgeted for.** Inter-region and
  intercontinental data transfer and internet-bound egress are charged per
  GiB (https://cloud.google.com/vpc/network-pricing); keep data movement
  within a region.
- **Logging sink explosion.** The `_Default` sink routes every log except
  the audit logs that `_Required` keeps
  (https://cloud.google.com/logging/docs/routing/overview), including
  high-volume health-check and DEBUG-level noise, and Logging charges by the
  volume streamed into `_Default` and user-defined buckets
  (https://cloud.google.com/stackdriver/pricing). Add exclusion filters to
  the `_Default` sink for low-value, high-volume logs — don't wait for the
  bill to reveal it. Exclusion filters do not reduce `entries.write` API
  quota use.
- **Idle GKE Standard nodepools bill 24/7 regardless of traffic** — nodes are
  billed as Compute Engine VMs whether pods use them or not; Autopilot bills
  pod requests instead
  (https://cloud.google.com/kubernetes-engine/pricing). A nodepool with
  `min-node-count` set above actual baseline load (or a leftover pool from a
  past experiment) is a standing cost with no corresponding value — audit
  min-node-count against real baseline periodically, not just at setup.

## gcloud CLI judgment

Always pass `--project` explicitly in scripts and CI. Never rely on
`gcloud config set project` ambient state — the flag overrides the
`core/project` property, which is the fallback when it is omitted
(https://cloud.google.com/sdk/gcloud/reference); a different operator or CI
runner without that local config silently targets the wrong project, or
fails with a confusing "resource not found" instead of a clear project
mismatch. The same applies to Terraform: pin `project` in the provider block
rather than inheriting an ambient default.

## Terraform

Never hardcode a project ID, service account email, or secret value in
`.tf`/`.tfvars`. Use an input variable for project IDs, and read secrets from
Secret Manager — never a literal string, and never a `.tfvars` file with real
values committed to git. Prefer the ephemeral
`google_secret_manager_secret_version` passed to a write-only argument,
which Terraform keeps out of state and plan files; the data source of the
same name works but its value is stored in state
(https://developer.hashicorp.com/terraform/language/manage-sensitive-data,
https://registry.terraform.io/providers/hashicorp/google/latest/docs/ephemeral-resources/secret_manager_secret_version).
(Folded from `rules/gcp/terraform-gcp.md`, 2026-09-23.)
