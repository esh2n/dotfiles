# gcp-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review), by `security-reviewer` for the items from "## IAM judgment" and "## Terraform", and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff, Terraform or script. A match is a finding.

- id: gcp:basic-role-grant
  rule: Grant the narrowest predefined role; never a basic role.
  check: IAM binding or member resource (`google_*_iam_binding`, `google_*_iam_member`, `gcloud ... add-iam-policy-binding`) granting `roles/owner` or `roles/editor` to a service account, user or group.
  section: "## IAM judgment"

- id: gcp:service-account-key
  rule: Use Workload Identity Federation or an attached service account, not a key file.
  check: `google_service_account_key` resource, `gcloud iam service-accounts keys create`, a downloaded service account `.json` key read by a script or CI step, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file.
  section: "## IAM judgment"

- id: gcp:shared-service-account
  rule: One service account per workload unless the components deploy and rotate together.
  check: The same service account email attached to two or more independently deployed services, jobs or node pools.
  section: "## IAM judgment"

- id: gcp:project-level-binding
  rule: Bind at the narrowest resource the workload touches.
  check: `google_project_iam_*` or project-level `add-iam-policy-binding` for a role whose permissions the workload uses on one bucket, topic, subscription or dataset that has its own IAM resource.
  section: "## IAM judgment"

- id: gcp:temporary-grant-without-condition
  rule: Time-bound or break-glass access uses an IAM Condition, not a permanent binding.
  check: Binding described as temporary, break-glass or for a migration with no `condition` block (e.g. no `request.time` expiry).
  section: "## IAM judgment"

- id: gcp:consumer-not-idempotent
  rule: A Pub/Sub consumer deduplicates before side effects, even with exactly-once delivery.
  check: Subscriber handler that writes, charges, sends or calls out with no dedup on message ID or an idempotency key; `enable_exactly_once_delivery` cited as the reason dedup is absent.
  section: "## Pub/Sub pitfalls"

- id: gcp:ack-extension-below-processing
  rule: The ack deadline or maximum lease extension exceeds processing time.
  check: Raw-API pull (no high-level client library) left at the 10s default ack deadline; a client library flow-control `max_lease_duration`/`MaxExtension` lower than the handler's measured or stated processing time.
  section: "## Pub/Sub pitfalls"

- id: gcp:dlq-unmonitored
  rule: A dead-letter topic has an alert and a replay path.
  check: `dead_letter_policy` added with no alert on the dead-letter topic or subscription and no replay procedure in the change.
  section: "## Pub/Sub pitfalls"

- id: gcp:retry-without-jitter
  rule: Every custom retry loop uses exponential backoff with jitter.
  check: Hand-written retry around a GCP call with fixed sleeps or pure exponential delay and no random term.
  section: "## Quota and retry judgment"

- id: gcp:retry-stacked-on-client-library
  rule: Don't wrap a google-cloud client library in a second retry loop.
  check: Application retry wrapper around a google-cloud-* client call that already retries idempotent calls by default.
  section: "## Quota and retry judgment"

- id: gcp:retry-deterministic-error
  rule: Retry `UNAVAILABLE` (HTTP 503; and 408, 429, other 5xx on HTTP APIs); never `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `NOT_FOUND`; `RESOURCE_EXHAUSTED` only with backoff where the API documents it as transient.
  check: Retry predicate including 400, 403, 404 or those gRPC codes; `RESOURCE_EXHAUSTED` retried immediately or without backoff.
  section: "## Quota and retry judgment"

- id: gcp:log-exclusion-missing
  rule: Exclude low-value, high-volume logs from the `_Default` sink at write time.
  check: Change that enables DEBUG-level logging or request logging of health checks in production with no exclusion filter on the `_Default` sink for it.
  section: "## Cost traps"

- id: gcp:gcloud-without-project
  rule: Scripts and CI pass `--project` explicitly.
  check: `gcloud` command in a script, Makefile or CI job without `--project`, or relying on a prior `gcloud config set project`.
  section: "## gcloud CLI judgment"

- id: gcp:terraform-provider-without-project
  rule: Pin `project` in the Terraform provider block.
  check: `provider "google"` or `provider "google-beta"` block with no `project` argument and resources that set none.
  section: "## gcloud CLI judgment"

- id: gcp:hardcoded-project-or-secret
  rule: No literal project ID, service account email or secret value in `.tf`/`.tfvars`.
  check: Quoted project ID, `*.iam.gserviceaccount.com` email, or secret value as a literal in `.tf`; a committed `.tfvars` with real values.
  section: "## Terraform"

- id: gcp:secret-in-state
  rule: Read secrets through the ephemeral `google_secret_manager_secret_version` into a write-only argument where supported.
  check: `data "google_secret_manager_secret_version"` whose `secret_data` feeds an argument that has a write-only (`*_wo`) counterpart.
  section: "## Terraform"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: gcp:dlq-attempts-unjustified
  rule: The max-delivery-attempts value is chosen, not left at the default.
  check: Dead-letter policy with the default 5 or any value and no stated reasoning about transient outages versus poison messages.
  section: "## Pub/Sub pitfalls"

- id: gcp:ordering-requirement-unstated
  rule: An ordering key is added only for a stated ordering requirement.
  check: `enable_message_ordering` or ordering keys with no stated requirement, or no statement of the per-key throughput (1 MBps publish, one outstanding batch) it accepts.
  section: "## Pub/Sub pitfalls"

- id: gcp:gke-requirement-unstated
  rule: GKE is chosen only for a concrete requirement Cloud Run cannot meet.
  check: Design choosing GKE with no named signal (stateful disk, mesh/CNI, bin-packing control, existing k8s ownership), or "future flexibility" as the reason.
  section: "## Cloud Run vs GKE"

- id: gcp:quota-plan-unstated
  rule: Predictable load spikes have a quota increase filed ahead.
  check: Launch, migration or backfill plan with no statement of the quotas it hits and when the increase is requested.
  section: "## Quota and retry judgment"

- id: gcp:egress-path-unstated
  rule: Data moving across regions or to the internet is named with its egress cost.
  check: Design with services, buckets or databases in different regions, or bulk internet-bound transfer, and no egress estimate.
  section: "## Cost traps"

- id: gcp:nodepool-baseline-unstated
  rule: Node pool minimums are set from real baseline load.
  check: GKE Standard node pool `min_node_count` (or fixed size) with no stated baseline load behind it.
  section: "## Cost traps"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: gcp:dedicated-or-shared-service-account
  rule: Dedicated service account vs one shared by components deployed together.
  options: dedicated (smallest blast radius, audit logs attribute each call; more accounts and bindings) | shared across one deploy unit (fewer identities to rotate; one compromise reaches every component, calls not attributable)
  section: "## IAM judgment"

- id: gcp:predefined-or-custom-role
  rule: Predefined role vs custom role.
  options: predefined (maintained by Google; may carry permissions the workload never uses) | custom (exact permissions; yours to maintain as services change)
  section: "## IAM judgment"

- id: gcp:dlq-attempts-low-or-high
  rule: Low vs high max delivery attempts.
  options: low (poison messages leave fast; a brief outage dead-letters good messages) | high (rides out outages; a poison message consumes throughput for a long time)
  section: "## Pub/Sub pitfalls"

- id: gcp:cloud-run-or-gke
  rule: Cloud Run vs GKE.
  options: Cloud Run (no cluster lifecycle, scale to zero; no stateful disks, less control) | GKE (stateful workloads, mesh, bin-packing; ongoing node-pool, upgrade and patching cost)
  section: "## Cloud Run vs GKE"
