---
name: k8s-patterns
description: Use when writing or reviewing Kubernetes manifests, debugging pod failures (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending), triaging a rollout, or reviewing manifests for missing resource limits, probes, PodDisruptionBudget, image pinning, or security context.
---

# Kubernetes Patterns

Judgment criteria for debugging and reviewing Kubernetes workloads — not a
kubectl tutorial.

## Debugging order discipline

Follow this order; skipping ahead to `exec` wastes time when the answer is
already in `describe`/events:

1. `kubectl describe pod <pod>` — status, conditions, and recent events in
   one place.
2. `kubectl get events --sort-by=.lastTimestamp -n <ns>` — broader namespace
   context (scheduler decisions, evictions).
3. `kubectl logs <pod> --previous` — required for CrashLoopBackOff. Without
   `--previous` you read the freshly-restarted container's boot log, not the
   log from the crash that's actually being investigated.
4. `kubectl exec` — last resort; only once describe/events/logs didn't answer
   the question.

**Events are namespace-scoped and expire** (roughly 1h by default). If a
transient failure happened a while ago, its events may already be gone —
don't waste time re-running `describe` expecting them to reappear; check
monitoring/alerting history instead.

## CrashLoopBackOff / OOMKilled / ImagePullBackOff / Pending triage

| Symptom | Most likely cause | First command |
|---|---|---|
| CrashLoopBackOff | App exits non-zero on startup: bad config, missing env var, failed dependency check | `kubectl logs <pod> --previous` |
| OOMKilled (Last State reason) | Memory limit set below actual usage, or a real leak | `kubectl describe pod` — compare limit to Last State; check historical RSS |
| ImagePullBackOff | Wrong tag/registry, missing `imagePullSecret`, expired private-registry auth | `kubectl describe pod` — Events show the exact pull error |
| Pending (unschedulable) | Insufficient node resources, taint/toleration mismatch, unbound PVC | `kubectl describe pod` — Events show the scheduler's reason |

## Manifest review judgment

- **Missing `resources.requests`/`limits`** is not "fine for now" — it's what
  lets one pod starve a node or throttle noisy neighbors, and it's the root
  cause behind most surprise OOMKilled/eviction incidents. Requests should
  reflect measured steady-state usage; padding 3-5x "to be safe" just wastes
  cluster bin-packing headroom for everyone else.
- **Missing or misused probes.** No `livenessProbe`/`readinessProbe` at all
  is an obvious gap. The subtler mistake: putting a slow external-dependency
  check (a DB ping) in `livenessProbe` instead of `readinessProbe` — liveness
  failure kills and restarts the container, so a downstream outage now causes
  a restart storm across every pod that depends on it. Dependency checks
  belong in readiness only; liveness should check "is this process alive,"
  nothing external.
- **No PodDisruptionBudget** on anything serving traffic with >1 replica —
  without one, a voluntary disruption (node drain, cluster upgrade) can take
  every replica down at once.
- **`image: foo:latest` or no digest pin.** Untagged/floating tags make
  "which image is actually running" unanswerable during an incident. Tag
  pinning is the floor; digest pinning is warranted for anything
  security-sensitive.

## Rollout judgment

- `kubectl rollout undo` when the new version is causing incident-level
  impact and root cause isn't understood yet — stop the bleeding, investigate
  the failure in a non-prod copy afterward.
- Fix-forward when a rollback would reintroduce a different known issue, or
  the fix is already identified and trivial — rolling back would just mean
  redoing the same rollout minutes later. This is a severity/cost trade-off
  each time, not a blanket preference for either direction.
- `maxUnavailable: 0` guarantees no capacity loss during a rollout, but only
  works if `maxSurge >= 1` and the cluster has headroom to schedule the extra
  pods — otherwise the rollout stalls silently, waiting on the scheduler.

## Security review lane

- `runAsNonRoot: true` and no `privileged: true` — flag any manifest missing
  this on a workload with network exposure.
- Secret handling: env-var-injected secrets show up in `kubectl describe
  pod`, process-env dumps, and crash logs; prefer volume-mounted secrets for
  credentials. Env vars are fine for non-sensitive config, not for anything
  that grants access.
- **NetworkPolicy default-deny.** Without one, every pod in the namespace can
  reach every other pod by default. Flag its absence on any namespace
  handling sensitive data — don't wait for it to be requested.

## What NOT to do

- **`kubectl edit` on a GitOps-managed resource** (Argo/Flux-owned). The edit
  gets silently reverted on the next sync, or worse, drifts and confuses
  whoever looks at it next. Edit the source manifest and let GitOps reconcile.
- **Force-removing finalizers to unstick a stuck-terminating namespace or
  resource without knowing why the finalizer is stuck.** The finalizer
  usually exists to clean up an external resource (a load balancer, a PVC, a
  cloud resource); force-removing it abandons that cleanup and leaves the
  external resource orphaned — still running, still billing. Find and fix
  the controller that owns the finalizer first.

## Manifest-glob note

For the accompanying rule that scopes this skill to actual Kubernetes YAML
(the `**/*.yaml` glob also matches Helm values, CI configs, and other
non-Kubernetes YAML), see `packs/k8s/rules/k8s/manifests.md`.
