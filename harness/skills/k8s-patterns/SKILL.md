---
name: k8s-patterns
description: Use when writing or reviewing Kubernetes manifests, debugging pod failures (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending), triaging a rollout, or reviewing manifests for missing resource limits, probes, PodDisruptionBudget, image pinning, or security context.
metadata:
  namespaces: [platform/infra]
---

# Kubernetes Patterns

Judgment criteria for debugging and reviewing Kubernetes workloads — not a
kubectl tutorial. Sources checked against Kubernetes v1.37, 2026-10-19.

## Debugging order discipline

Follow this order; skipping ahead to `exec` wastes time when the answer is
already in `describe`/events:

1. `kubectl describe pod <pod>` — status, conditions, and recent events in
   one place.
2. `kubectl get events --sort-by=.lastTimestamp -n <ns>` — broader namespace
   context (scheduler decisions, evictions).
3. `kubectl logs <pod> --previous` — required for CrashLoopBackOff. Without
   `--previous` you read the freshly-restarted container's boot log, not the
   log from the crash that's actually being investigated
   (https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#examine-pod-logs).
4. `kubectl exec` — last resort; only once describe/events/logs didn't answer
   the question.

**Events are namespaced objects and expire** — the API server keeps them for
`--event-ttl`, 1h by default, and a cluster operator can change it
(https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/).
If a transient failure happened a while ago, its events may already be gone —
don't waste time re-running `describe` expecting them to reappear; check
monitoring/alerting history instead.

## CrashLoopBackOff / OOMKilled / ImagePullBackOff / Pending triage

| Symptom | Most likely cause | First command |
|---|---|---|
| CrashLoopBackOff | App exits non-zero on startup: bad config, missing env var, failed dependency check | `kubectl logs <pod> --previous` |
| OOMKilled (Last State reason, exit code 137) | Container tried to use more memory than its limit, or a real leak | `kubectl describe pod` — compare limit to Last State; check historical RSS |
| ImagePullBackOff | Invalid image name/tag, or a private registry without an `imagePullSecret`; the kubelet retries with a back-off capped at 300s | `kubectl describe pod` — Events show the exact pull error |
| Pending (unschedulable) | Insufficient node resources, taint/toleration mismatch, a PVC with no matching volume | `kubectl describe pod` — Events show the scheduler's reason (`FailedScheduling`) |

Sources: OOMKilled
(https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#my-container-is-terminated),
FailedScheduling
(https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#my-pods-are-pending-with-event-message-failedscheduling),
ImagePullBackOff (https://kubernetes.io/docs/concepts/containers/images/#imagepullbackoff),
unbound claims (https://kubernetes.io/docs/concepts/storage/persistent-volumes/#binding).

## Manifest review judgment

- **Missing `resources.requests`/`limits`** is not "fine for now." The
  scheduler places pods by their requests and the kubelet reserves the
  request; memory limits are enforced by OOM kill
  (https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
  A container with no requests has nothing reserved, and under node pressure
  the kubelet evicts pods whose usage exceeds their requests first, so a pod
  with no requests is always in that first group
  (https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/#pod-selection-for-kubelet-eviction).
  Requests should reflect measured steady-state usage; padding well above it
  "to be safe" reserves capacity no one uses and wastes bin-packing headroom.
- **Missing or misused probes.** No `livenessProbe`/`readinessProbe` at all
  is an obvious gap. The subtler mistake: putting a slow external-dependency
  check (a DB ping) in `livenessProbe` instead of `readinessProbe` — liveness
  failure restarts the container, readiness failure only takes the pod out of
  Service traffic, and the docs warn that a liveness probe should signal an
  unrecoverable failure such as a deadlock because a wrong one causes
  cascading failures
  (https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).
  A downstream outage then becomes a restart storm across every pod that
  depends on it. Dependency checks belong in readiness only; liveness should
  check "is this process alive," nothing external.
- **Slow starters get a `startupProbe`, not a stretched liveness probe.**
  While a startup probe is configured, the kubelet runs no liveness or
  readiness probe until it succeeds
  (https://kubernetes.io/docs/concepts/workloads/pods/probes/). Give it the
  same check as liveness with `failureThreshold * periodSeconds` covering the
  worst-case startup time, so liveness keeps its fast reaction to deadlocks
  (https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-startup-probes).
  A long `initialDelaySeconds` or high liveness `failureThreshold` used to
  survive startup slows deadlock detection for the container's whole life.
- **No PodDisruptionBudget** on anything serving traffic with >1 replica —
  a PDB is what limits how many replicas a voluntary disruption (node drain
  through the Eviction API, cluster upgrade) may take down at once
  (https://kubernetes.io/docs/concepts/workloads/pods/disruptions/#pod-disruption-budgets).
  It does not cover everything voluntary: deleting Pods or their Deployment
  directly bypasses it, and a Deployment or StatefulSet rolling update is not
  limited by it — rollout safety comes from the workload's own strategy
  fields (same source).
- **`image: foo:latest` or no digest pin.** The docs advise against `:latest`
  in production because it hides which version runs and makes rollback
  harder; a digest never changes while a tag can move; an omitted pull policy
  becomes `Always` for `:latest` or no tag
  (https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy).
  Tag pinning is the floor; digest pinning is warranted for anything
  security-sensitive.

## Rollout judgment

- `kubectl rollout undo` when the new version is causing incident-level
  impact and root cause isn't understood yet — stop the bleeding, investigate
  the failure in a non-prod copy afterward
  (https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-to-a-previous-revision).
- Fix-forward when a rollback would reintroduce a different known issue, or
  the fix is already identified and trivial — rolling back would just mean
  redoing the same rollout minutes later. This is a severity/cost trade-off
  each time, not a blanket preference for either direction.
- `maxUnavailable: 0` guarantees no capacity loss during a rollout, but needs
  `maxSurge >= 1` (the API rejects both at 0) and room in the cluster to
  schedule the extra pods. Without headroom the surge pods stay Pending and
  the rollout stalls; after `progressDeadlineSeconds` (600 by default) the
  Deployment reports `Progressing=False` with reason
  `ProgressDeadlineExceeded`, and Kubernetes takes no further action — it does
  not roll back
  (https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment).

## Security review lane

- `runAsNonRoot: true` and no `privileged: true` — the Baseline Pod Security
  Standard forbids privileged containers and Restricted requires
  `runAsNonRoot`
  (https://kubernetes.io/docs/concepts/security/pod-security-standards/).
  Flag any manifest missing this on a workload with network exposure.
- **Enforce a Pod Security Standard per namespace.** Pod Security Admission
  (stable since v1.25; PodSecurityPolicy was removed in v1.25) reads namespace
  labels `pod-security.kubernetes.io/<mode>: <level>`: `enforce` rejects
  violating Pods, `audit` and `warn` only record or warn, and the optional
  `<mode>-version` label pins the policy version
  (https://kubernetes.io/docs/concepts/security/pod-security-admission/).
  `enforce` checks Pod objects only, so a Deployment that violates it is
  accepted and its Pods are then rejected; `warn` and `audit` also check
  workload resources. A namespace running application workloads with no
  `enforce` label at `baseline` or `restricted` relies on every manifest
  getting `securityContext` right by hand.
- Secret handling: the Kubernetes docs allow a Secret as env vars or as a
  volume and state no preference
  (https://kubernetes.io/docs/concepts/security/secrets-good-practices/). A
  volume-mounted Secret is updated in place when the Secret changes (not
  with `subPath`); env vars are read at container start
  (https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets-as-files-from-a-pod).
  An env var also reaches anything that dumps the process environment, such
  as crash reporters and debug endpoints. Prefer volume-mounted secrets for
  credentials; env vars are fine for non-sensitive config.
- **NetworkPolicy default-deny.** Without one, every pod is non-isolated and
  accepts traffic from any source; a policy only takes effect when the
  cluster's network plugin enforces NetworkPolicy
  (https://kubernetes.io/docs/concepts/services-networking/network-policies/).
  Flag its absence on any namespace handling sensitive data — don't wait for
  it to be requested. A default-deny for ingress (`podSelector: {}`,
  `policyTypes: [Ingress]`) leaves egress open; egress needs its own policy
  with `Egress` in `policyTypes`. A default-deny egress also blocks DNS, so
  it needs a separate policy allowing egress to the cluster DNS service
  (https://kubernetes.io/docs/concepts/services-networking/network-policies/#default-deny-all-egress-traffic).

## What NOT to do

- **`kubectl edit` on a GitOps-managed resource** (Argo/Flux-owned). Flux
  reverts it on the next reconcile
  (https://fluxcd.io/flux/components/kustomize/kustomizations/#controlling-the-apply-behavior-of-resources);
  Argo CD reverts it only with self-heal enabled, and otherwise leaves it as
  drift that confuses whoever looks next
  (https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/#automatic-self-healing).
  Edit the source manifest and let GitOps reconcile.
- **Force-removing finalizers to unstick a stuck-terminating namespace or
  resource without knowing why the finalizer is stuck.** The docs advise
  against it unless the finalizer's purpose is understood and done another
  way (https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/).
  The finalizer usually exists to clean up an external resource (a load
  balancer, a PVC, a cloud resource); force-removing it skips that cleanup
  and can leave the external resource running and billing. Find and fix the
  controller that owns the finalizer first.

## Is it a manifest?

A `.yaml`/`.yml` file is not necessarily a Kubernetes manifest — the same
extension carries Helm values, CI configs and plenty else. Before applying
anything above, confirm the file has `apiVersion:` and `kind:` at the top
level (https://kubernetes.io/docs/concepts/overview/working-with-objects/#required-fields);
only then run the review lanes (resource requests/limits, probes,
PodDisruptionBudget, image pinning, security context, Pod Security
Admission labels, NetworkPolicy).
(Folded from `rules/k8s/manifests.md`, 2026-09-23.)
