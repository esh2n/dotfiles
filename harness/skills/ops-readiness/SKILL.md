---
name: ops-readiness
description: Use when a change adds a new service, endpoint, job, queue consumer, scheduled task, data migration or feature flag, or changes deployment, scaling, configuration rollout or on-call-relevant behaviour — reviewing a launch or production-readiness plan for ownership and paging, runbooks, capacity and load testing, dependency inventory, failure-mode analysis, a tested rollback, backfill throttling, flag debt, cron overlap and time zones, staged config pushes, secret rotation, cost budgets, RPO/RTO with restore tests, and decommissioning.
metadata:
  namespaces: [platform/infra]
---

# Ops Readiness

Judgment criteria for a production-readiness or launch review: what has to be
true before a new thing takes production traffic, and what a design or PR must
state so that someone other than its author can operate it. Sources opened
2026-10-19.

Most items here are silences — a design or PR that leaves them out is the
finding. Defects are reserved for what a diff itself shows.

What this skill does not own, and where it lives instead:

- SLIs, SLOs, alert design, burn rates, dashboards, telemetry cost —
  `observability-patterns`.
- Timeouts, retries, circuit breakers, load shedding, health checks, fail-open
  versus fail-closed — `resilience-patterns`.
- Mixed-version compatibility, deploy order, expand/migrate/contract, backfill
  idempotency and verification, flag defaults, kill switch behaviour and
  per-environment config defaults — `rollout-reviewer`
  (harness/agents/rollout-reviewer.md).
- Kubernetes probes, PodDisruptionBudget, `rollout undo` versus fix-forward —
  `k8s-patterns`.

## Launch review as a gate

**[silence] A new workload gets an operational readiness review before general
availability, and again periodically.** AWS lists launching a workload without
knowing whether the team can operate it, and never re-evaluating it, as
anti-patterns; the checklist grows from the team's own post-incident findings
(https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_const_orr.html).
Google's launch checklist covers the same ground — architecture and
dependencies, capacity, failure modes, client behaviour, manual procedures,
external dependencies, rollout plan
(https://sre.google/sre-book/reliable-product-launches/). This skill is that
checklist reduced to what a reviewer can check from a design or PR.

## Ownership and on-call

**[silence] Name the owning team and the pager rotation for every new
service, job or consumer.** "Who gets paged" must have an answer before
launch, with an acknowledgement target and an escalation path. Google's
guidance sets response targets in minutes for user-facing services and limits
a shift to about two incidents, so a launch that adds pages to a rotation
already at that load needs the rotation's agreement
(https://sre.google/sre-book/being-on-call/). Clear ownership and escalation
per alert is AWS's remedy for alerts handled inconsistently
(https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_event_response_process_per_alert.html).

**[silence] Every new alert links a runbook that someone other than its
author has run.** A runbook names the outcome, the tools and permissions it
needs, error handling and escalation, and an owner; AWS's validation step is
handing it to another team member, and drift from the system is a named
anti-pattern
(https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_use_runbooks.html).
Whether the alert should page at all is `observability-patterns` ("Alert
design"); this item asks only that the response exists before launch.

**[silence] Incident roles are known before the first incident.** The plan
names who commands, who changes the system and who communicates, and how
command is handed over
(https://sre.google/sre-book/managing-incidents/,
https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/incident-response).
A new service owned by a team with no incident process inherits that gap.

## Capacity and load

**[silence] State expected peak demand, including the launch spike, and the
lead time to add capacity.** Google separates organic growth from inorganic
demand (a launch, a campaign) and requires the forecast to reach past the
capacity lead time; launch traffic can exceed estimates by a wide margin
(https://sre.google/sre-book/introduction/,
https://sre.google/sre-book/reliable-product-launches/). Include redundancy:
the plan sizes for peak with one zone or region out, not for peak alone.

**[silence] Load-test before launch, and say what the test showed.** Services
degrade non-linearly near capacity and the failure point is hard to predict
from first principles, so Google treats load testing as required for most
launches; regular load tests are what convert raw resources into service
capacity (https://sre.google/sre-book/reliable-product-launches/,
https://sre.google/sre-book/introduction/). A plan with a capacity number and
no test behind it is an estimate. What saturates first under that load is
`workload-reviewer`'s depth.

## Dependencies and failure modes

**[silence] Inventory every dependency, internal and external, with its
availability commitment and whether it is strong or weak.** A strong
dependency is one the flow cannot run without; its availability and recovery
targets must be at least as good as the workload's own
(https://learn.microsoft.com/en-us/azure/well-architected/reliability/failure-mode-analysis).
The same applies to recovery objectives: a workload's RTO/RPO must be
achievable given its downstream dependencies' objectives, and upstream callers
may demand tighter ones
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_objective_defined_recovery.html).
Third-party services and vendor deadlines belong in the same list
(https://sre.google/sre-book/reliable-product-launches/). How availability
composes across the chain is `observability-patterns` ("SLO design
judgment"); how each call behaves on failure is `resilience-patterns`.

**[silence] A failure-mode analysis per critical flow: each component, its
failure modes, likelihood, effect on the user, detection and mitigation.**
Include misconfiguration, operator error, planned maintenance and overload,
not only hardware and zone loss; treat reads and writes separately
(https://learn.microsoft.com/en-us/azure/well-architected/reliability/failure-mode-analysis).
Google's June 2025 outage is the case for listing "bad data reaches a new code
path": a policy record with blank fields replicated to every region within
seconds and crashed a new check that had no error handling and no flag, so the
staged binary rollout never exercised it
(https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW).

**[trade-off] How deep to mitigate rare failure modes.** Azure's guidance is
that mitigation beyond redundancy for very unlikely modes (multi-region loss)
is often not worth the cost; the analysis still records the mode and the
accepted effect so the decision is visible
(https://learn.microsoft.com/en-us/azure/well-architected/reliability/failure-mode-analysis).

## Rollback plan

**[silence] Write the rollback or fix-forward plan before the deploy, and test
it.** AWS requires a documented plan, a policy for when fixing forward is
allowed, and measuring how long failed changes stay broken
(https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_mit_deploy_risks_plan_for_unsucessful_changes.html).
The test that settles it: in a production-like environment, deploy to part of
the fleet, complete the deploy, roll back, and confirm the old version runs
clean against what the new one wrote
(https://builder.aws.com/content/3F04j2yRAAMBuPSPs50xwXZqg01/ensuring-rollback-safety-during-deployments).
Whether the two versions are compatible is `rollout-reviewer`'s depth; this
item asks whether the rollback has been rehearsed and who triggers it.

**[silence] State when deploys may run and what blocks them.** Amazon's
pipelines avoid nights, weekends and holidays so responders are available,
pause while an alarm is firing, and roll back automatically on alarms scoped
down to the first single host
(https://builder.aws.com/content/3ErTKQOTKc5NIw031UePBPxTQ6I/automating-safe-hands-off-deployments).
An emergency path must also be written down: which gates may be shortened,
who approves that, and that skipped gates still run afterwards
(https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments).

## Configuration, flag and content pushes are deploys

Google reports that a majority of its incidents start with a binary or
configuration push, and roughly 70% of outages with a change to a live system
(https://sre.google/workbook/canarying-releases/,
https://sre.google/sre-book/introduction/).

**[defect] A config, feature-flag, policy or content change that reaches every
target in one step.** Runtime settings and flags need the same staged path as
code — one box, then waves with bake time and health gates
(https://builder.aws.com/content/3ErTKQOTKc5NIw031UePBPxTQ6I/automating-safe-hands-off-deployments,
https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments).
Two postmortems show the cost: Google's globally replicated policy data
(https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW), and
CrowdStrike's July 2024 channel file, configuration content that was not
deployed in stages and that the content validator passed despite a logic bug
(https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/).
Both committed to staged rollout of data and content afterwards.

**[silence] Config is versioned, owned, and validated for meaning at commit
time.** Syntax checks miss a nonexistent path or a wrong unit; catch those
before rollout, log who changed what, and keep configs hermetic so rollback
restores the old state (https://sre.google/workbook/configuration-design/).
Defaults per environment are `rollout-reviewer`'s.

**[silence] A new path in a critical serving component says how it is turned
off without a deploy.** Google's remediation after June 2025 requires new
features in critical binaries to sit behind flags that start disabled
(https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW). The flag's
default and kill-switch behaviour are then `rollout-reviewer`'s checks.

**[trade-off] Propagation speed of global config.** Fast global push fixes a
security or abuse problem in seconds and spreads a bad value just as fast;
staged push limits the blast radius and delays the fix. Options: staged always
with an emergency override that someone must approve
(https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments),
or a separate fast channel restricted to a validated subset of keys.

## Feature flag hygiene

Default value, kill switch, owner, removal date and all-on tests are
`rollout-reviewer`'s checks. This section adds lifetime and debt.

**[silence] Name each flag's category, because the category sets its expected
lifetime.** Release toggles live days to weeks; experiment toggles live as
long as the experiment needs; ops toggles are mostly short but kill switches
may stay for years by design; permissioning toggles can be permanent. Long-
lived and per-request toggles need a sturdier implementation than an inline
`if` (https://martinfowler.com/articles/feature-toggles.html). A flag with no
category gets judged as a release toggle and its age as debt.

**[trade-off] How flag debt is controlled.** Fowler and Hodgson list three
controls (https://martinfowler.com/articles/feature-toggles.html):
a removal task filed when the flag is created (cheap, decays when ignored),
an expiry date enforced by a test or startup check that fails after it (cannot
be ignored, can fail a build at a bad time), and a cap on the number of live
flags (forces removal, blocks an urgent new flag).

## Data migration safety

Order, expand/contract, idempotency, verification and reversibility of each
step are `rollout-reviewer`'s. This section covers load on production and
irreversible data loss.

**[defect] A backfill or bulk update that walks a whole table with no batch
limit and no throttle.** gh-ost pauses its copy when replica lag passes a
threshold or a load metric passes a limit, and resumes from where it stopped
(https://github.com/github/gh-ost/blob/master/doc/throttle.md). A backfill
without a batch size, a pause between batches, and a signal that stops it
competes with live traffic for the primary and the replicas.

**[silence] Before a destructive step, state the backup taken and that a
restore from it was tested.** Preserve state before removal and tag it with a
review date
(https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments).

**[defect] A bulk hard delete of customer or tenant data with no soft-delete
stage.** Atlassian's April 2022 outage deleted 883 sites because a script
passed site IDs to an API that accepted either ID type and deleted at once;
the last sites came back 13 days later because restoring many sites at once was not automated. Its
first lesson was soft delete with retention for all customer data
(https://www.atlassian.com/blog/atlassian-engineering/post-incident-review-april-2022-outage).
A dry run that prints the count and identifiers before deleting is the
cheapest check alongside it.

## Scheduled job safety

**[defect] A Kubernetes CronJob without an explicit `concurrencyPolicy`.** The
default is `Allow`, so a run that outlasts its interval overlaps the next one
(https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/). For a
non-idempotent job, `Forbid` or a lock is required; other schedulers need the
equivalent stated.

**[defect] A schedule with no time zone, or one that fires inside a DST
transition.** Without `timeZone` a CronJob uses the controller manager's local
zone, and runs near a DST change can be skipped or happen twice
(https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/).
Schedule in UTC, or move local-time jobs out of the transition hour.

**[silence] State whether the job is safe to run twice and what happens to a
missed run.** A job can run more than once for one scheduled time, so it must
be idempotent
(https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/).
Google keys each launch by its scheduled time so a new leader can see what
already ran (https://sre.google/sre-book/distributed-periodic-scheduling/).
`startingDeadlineSeconds` bounds how late a missed run may start; unset, there
is no bound.

**[silence] Spread start times of jobs that need no exact time.** Many jobs at
midnight produce a load spike across shared infrastructure; Google lets jobs
mark a field as flexible and hashes the job's config into the allowed range
(https://sre.google/sre-book/distributed-periodic-scheduling/).

**[trade-off] Skip a missed run or catch up.** Google prefers skipping, since
a missed run is easier to recover from than a duplicate that cannot be undone
(https://sre.google/sre-book/distributed-periodic-scheduling/). Catch-up suits
jobs that must run for every period (billing, payroll) and only works when
each run is idempotent and keyed by period.

## Secrets

Hardcoded or leaked secrets are `security-reviewer`'s. Readiness asks about
the lifecycle.

**[silence] Each new secret has a rotation plan: interval, automation, the
overlap window, and revocation.** OWASP recommends automated rotation, short
lifetimes or dynamic secrets where possible, expiry, and a staged rotation
that writes with the new key while still reading with the old; rotating an
encryption key may mean re-encrypting data
(https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).

## Cost guardrails

**[silence] New infrastructure or a new usage-billed dependency comes with a
budget, an alert on spend and an anomaly alert, sent to a team list.** AWS
starts with notifications on spend outside policy and anomaly detection, sends
them to a distribution list rather than one person, and then enforces limits
through quotas and policies
(https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/cost_govern_usage_controls.html).
Telemetry cost is `observability-patterns`'s.

## Disaster recovery

**[silence] State RTO and RPO for the workload, derived from business
impact.** No objectives, arbitrary ones, zero-loss promises the design cannot
meet, and objectives incompatible with a dependency's are all AWS
anti-patterns
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_objective_defined_recovery.html).

**[silence] Backups are restored on a schedule, the restored data is checked,
and restore time is measured against the RTO.** Assuming a backup exists, or
restoring without querying the result, are named anti-patterns
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_periodic_recovery_testing_data.html).
GitLab's January 2017 outage is the negative case: the daily dump had been
failing on a client version mismatch, its failure emails were rejected, and
the recovery came from a snapshot made for staging, losing about six hours of
data. Its lessons were tested restores, an owner per backup, and alerts that
reach people
(https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/).

**[silence] Failover to the recovery site is exercised regularly.** AWS's
experience is that only a frequently tested recovery path works
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_dr_tested.html).

**[trade-off] Recovery objectives against cost.** Objectives stricter than the
business needs force a costlier, more complex recovery design; looser ones
leave the business exposed. Tiering workloads by impact and assigning RTO/RPO
per tier is AWS's way to choose
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_objective_defined_recovery.html).

## Deprecation and decommissioning

**[silence] A removal plan proves inactivity over a full business cycle,
preserves state, disables before deleting, and watches through peak usage.**
Azure treats every deletion as irreversible: confirm no requests, queue
movement, flag evaluations or DNS queries; snapshot; disable; watch; then
clean up references
(https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments).

**[defect] A diff that deletes a stateful resource (database, table, bucket,
queue) with no preceding disabled period or snapshot.** Same source; the
Atlassian deletion above shows the restore cost when the delete is immediate.

## Related

- `observability-patterns` — SLOs, alerts, dashboards, telemetry cost.
- `resilience-patterns` — failure behaviour per call, health checks, fail-open
  or fail-closed.
- `rollout-reviewer` (harness/agents/rollout-reviewer.md) — compatibility
  during the deploy window, migration order, flag defaults and kill switches.
- `k8s-patterns` — probes, PodDisruptionBudget, rollback versus fix-forward on
  Kubernetes.
- `event-driven-patterns` — consumer idempotency, DLQ, ordering.
