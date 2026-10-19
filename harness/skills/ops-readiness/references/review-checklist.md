# ops-readiness — review checklist

Derived from ../SKILL.md. Read by `rollout-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design, spec or launch review, and for a PR that adds a service, endpoint, job, consumer, scheduled task, migration or flag) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Compatibility and deploy order stay with `rollout-reviewer`'s own checks, alert design with `observability-patterns`, per-call failure behaviour with `resilience-patterns`.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: ops:config-push-unstaged
  rule: A config, feature-flag, policy or content change reaches targets in stages with bake time and a health gate, not all at once.
  check: Pipeline, flag-service or config-push definition in the diff that applies the change to every region, cluster or fleet in one step, with no one-box or canary stage, no bake time and no health or alarm gate between waves; also a data or policy write that replicates globally on commit with no staged propagation.
  section: "## Configuration, flag and content pushes are deploys"

- id: ops:backfill-unthrottled
  rule: A backfill or bulk update runs in bounded batches with a pause and a signal that stops it.
  check: Migration, script or job that updates or copies rows across a whole table in one statement or an unbounded loop, with no batch size, no sleep between batches and no check of replica lag or database load.
  section: "## Data migration safety"

- id: ops:bulk-hard-delete
  rule: Bulk deletion of customer or tenant data goes through a soft-delete stage with retention.
  check: Script, job or API path in the diff that hard-deletes many customer or tenant records or whole tenants at once, with no soft-delete flag or retention period, and no dry run printing the count and identifiers first.
  section: "## Data migration safety"

- id: ops:cron-overlap-default
  rule: A scheduled job states its overlap policy.
  check: Kubernetes CronJob with no `concurrencyPolicy` (defaults to `Allow`) whose job is not shown to be idempotent; for other schedulers, a recurring job with no lock or overlap setting.
  section: "## Scheduled job safety"

- id: ops:cron-timezone-dst
  rule: A schedule names its time zone and does not fire inside a DST transition.
  check: CronJob with no `timeZone` (falls back to the controller manager's local zone); or a schedule in a zone with daylight saving that fires in the hour the clocks change.
  section: "## Scheduled job safety"

- id: ops:stateful-delete-without-disable
  rule: A stateful resource is disabled and snapshotted before it is deleted.
  check: Diff that removes a database, table, bucket, queue or volume (IaC resource removal, `DROP`, delete call) with no earlier disabled period and no snapshot or export referenced in the PR.
  section: "## Deprecation and decommissioning"

## silences
A design, launch plan or PR description must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: ops:readiness-review-missing
  rule: A new workload has an operational readiness review before general availability and a periodic re-review.
  check: A new service or major launch with no readiness review referenced and no date for the next one.
  section: "## Launch review as a gate"

- id: ops:owner-oncall-unstated
  rule: Every new service, job or consumer names its owning team, pager rotation, acknowledgement target and escalation path.
  check: New deployable unit, scheduled job or consumer in the change with no owner or rotation named in the design, PR or the project's ownership file (CODEOWNERS, service catalog).
  section: "## Ownership and on-call"

- id: ops:runbook-missing
  rule: Every new alert links a runbook with outcome, tools, permissions, error handling, escalation and owner, run once by someone other than its author.
  check: Alert rule added with no runbook link, or a linked runbook with no owner or no escalation.
  section: "## Ownership and on-call"

- id: ops:incident-roles-unstated
  rule: The owning team has incident roles (command, operations, communications) and a handover rule.
  check: A launch by a team whose design or docs name no incident process or roles.
  section: "## Ownership and on-call"

- id: ops:capacity-plan-missing
  rule: The plan states expected peak including the launch spike, the capacity lead time, and headroom with one zone or region out.
  check: New endpoint, service or job with no peak estimate, or an estimate with no lead time or no redundancy allowance.
  section: "## Capacity and load"

- id: ops:load-test-missing
  rule: A load test ran before launch and its result is stated.
  check: Capacity number given with no load test behind it, or a load test named with no result (throughput reached, what saturated).
  section: "## Capacity and load"

- id: ops:dependency-inventory-missing
  rule: Every dependency is listed with its availability commitment, strong or weak, and its recovery objectives compared to the workload's.
  check: Design that introduces a dependency (internal service, third party, managed service) without its SLA, strength, or recovery objectives; a strong dependency whose commitment is weaker than the workload's target.
  section: "## Dependencies and failure modes"

- id: ops:failure-mode-analysis-missing
  rule: Each critical flow has a failure-mode analysis: component, failure mode, likelihood, user effect, detection, mitigation.
  check: Design with no failure-mode table, or one covering only hardware and zone loss and omitting misconfiguration, operator error, bad data, maintenance and overload.
  section: "## Dependencies and failure modes"

- id: ops:rollback-untested
  rule: A rollback or fix-forward plan is written before the deploy and rehearsed (partial deploy, full deploy, rollback, old version healthy).
  check: Risky deploy with no rollback plan, no named trigger or owner, or a plan never exercised in a production-like environment.
  section: "## Rollback plan"

- id: ops:deploy-window-unstated
  rule: The plan states when deploys may run, what blocks them, and the emergency path with its approver.
  check: Pipeline or launch plan with no deploy window, no block on firing alarms, or no written emergency override and approver.
  section: "## Rollback plan"

- id: ops:config-unvalidated
  rule: Config is versioned, owned, and validated for meaning at commit time.
  check: New config surface edited outside version control (UI, API) with no change log, or with only syntax validation where a semantic check (path exists, unit, range) is possible.
  section: "## Configuration, flag and content pushes are deploys"

- id: ops:critical-path-no-off-switch
  rule: A new path in a critical serving component states how it is turned off without a deploy.
  check: New check, handler or code path on an authorization, quota, routing or other every-request component with no flag or other runtime off switch named.
  section: "## Configuration, flag and content pushes are deploys"

- id: ops:flag-category-unstated
  rule: Each flag names its category (release, experiment, ops, permissioning), which sets its expected lifetime.
  check: New flag with no category; a kill switch or permissioning flag implemented as a short-lived inline check; a release flag with no expected removal.
  section: "## Feature flag hygiene"

- id: ops:destructive-step-no-restore
  rule: Before a destructive data step, the backup taken and a tested restore from it are stated.
  check: Contract step, drop or bulk delete in the plan with no named backup or no restore test.
  section: "## Data migration safety"

- id: ops:job-rerun-missed-unstated
  rule: A scheduled job states whether it is safe to run twice and what happens to a missed run, with a bound on late starts.
  check: New scheduled job with no idempotency statement, no run key tied to the scheduled time, or no `startingDeadlineSeconds` (or equivalent) where late runs matter.
  section: "## Scheduled job safety"

- id: ops:job-start-unspread
  rule: Jobs that need no exact time have spread start times.
  check: Several new or existing jobs scheduled at the same round time (00:00, top of the hour) on shared infrastructure with no stated reason for the exact time.
  section: "## Scheduled job safety"

- id: ops:secret-rotation-unstated
  rule: Each new secret has a rotation interval, automation, an overlap window and a revocation path.
  check: New credential, key or token introduced with no rotation plan, or a rotation that swaps the value in one step with no period where old and new are both accepted.
  section: "## Secrets"

- id: ops:cost-guardrail-missing
  rule: New infrastructure or a usage-billed dependency comes with a budget, a spend alert and an anomaly alert to a team list.
  check: New resources or third-party usage with no budget or alert named, or alerts routed to one person.
  section: "## Cost guardrails"

- id: ops:rpo-rto-unstated
  rule: The workload states RTO and RPO derived from business impact and compatible with its dependencies.
  check: New stateful workload with no RTO/RPO, a zero-loss or zero-downtime objective the design cannot meet, or objectives tighter than a strong dependency's.
  section: "## Disaster recovery"

- id: ops:backup-restore-untested
  rule: Backups are restored on a schedule, the restored data is checked, restore time is measured against the RTO, and backup failures alert a person.
  check: New data store with backups configured but no restore test, no validation of restored data, no measured restore time, or failure notifications that go nowhere monitored.
  section: "## Disaster recovery"

- id: ops:failover-unexercised
  rule: Failover to the recovery site is exercised regularly.
  check: Design that relies on a standby or secondary region with no failover drill scheduled.
  section: "## Disaster recovery"

- id: ops:decommission-plan-missing
  rule: A removal plan proves inactivity over a full business cycle, preserves state, disables before deleting and watches through peak usage.
  check: Deprecation or removal of an endpoint, service, flag or resource with no inactivity evidence, no snapshot, no disabled period or no watch window.
  section: "## Deprecation and decommissioning"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: ops:rare-failure-mitigation
  rule: How far to mitigate very unlikely failure modes.
  options: mitigate (survives the rare event, costs redundancy and complexity) | record and accept (cheaper, the effect is written down and owned)
  section: "## Dependencies and failure modes"

- id: ops:config-propagation-speed
  rule: How fast global config propagates.
  options: staged always with an approved emergency override (limits blast radius, slower fixes) | separate fast channel for a validated subset of keys (fast security fixes, a second path to keep safe) | fast global push (fixes in seconds, a bad value spreads in seconds)
  section: "## Configuration, flag and content pushes are deploys"

- id: ops:flag-debt-control
  rule: How flag debt is controlled.
  options: removal task filed at creation (cheap, decays when ignored) | expiry enforced by a failing test or startup check (cannot be ignored, can break a build at a bad time) | cap on live flags (forces removal, blocks an urgent new flag)
  section: "## Feature flag hygiene"

- id: ops:missed-run-policy
  rule: Skip a missed scheduled run or catch up.
  options: skip (no duplicates, a period goes unprocessed) | catch up (every period processed, needs idempotent runs keyed by period)
  section: "## Scheduled job safety"

- id: ops:recovery-objective-cost
  rule: How strict the RTO and RPO are.
  options: strict (less downtime and loss, costlier and more complex recovery) | business-matched per impact tier (cost follows impact, needs the impact analysis) | lenient (cheap, exposes the business)
  section: "## Disaster recovery"
