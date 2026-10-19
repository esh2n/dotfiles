# k8s-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review), by `security-reviewer` for the items from "## Security review lane", by `rollout-reviewer` for the items from "## Rollout judgment", and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

Apply these only to a file with top-level `apiVersion:` and `kind:`; other YAML is not a manifest ("## Is it a manifest?").

## defects
Objectively checkable in a diff or manifest. A match is a finding.

- id: k8s:resources-missing
  rule: Every container sets resource requests, and a memory limit, sized from measured usage.
  check: Container in a Pod template (Deployment, StatefulSet, DaemonSet, Job, CronJob, Pod) with no `resources.requests`, or no `resources.limits.memory`.
  section: "## Manifest review judgment"

- id: k8s:probes-missing
  rule: A serving container has a readiness probe and a liveness probe.
  check: Container exposing a port behind a Service with no `readinessProbe`, or no `livenessProbe`.
  section: "## Manifest review judgment"

- id: k8s:liveness-checks-dependency
  rule: Liveness checks only that the process is alive; dependency checks go in readiness.
  check: `livenessProbe` whose `httpGet` path, `exec` command or handler touches a database, cache, or another service; the same endpoint used for both liveness and readiness when that endpoint checks dependencies.
  section: "## Manifest review judgment"

- id: k8s:pdb-missing
  rule: A workload serving traffic with more than one replica has a PodDisruptionBudget.
  check: Deployment or StatefulSet with `replicas` > 1 behind a Service and no PodDisruptionBudget whose `selector` matches its Pod labels.
  section: "## Manifest review judgment"

- id: k8s:image-floating-tag
  rule: Images are pinned by tag at minimum, and by digest for security-sensitive workloads.
  check: `image:` with `:latest` or no tag; an image without `@sha256:` on a workload the change marks security-sensitive.
  section: "## Manifest review judgment"

- id: k8s:zero-unavailable-without-surge
  rule: `maxUnavailable: 0` needs `maxSurge` of at least 1.
  check: RollingUpdate strategy with `maxUnavailable: 0` and `maxSurge: 0` (or `0%`).
  section: "## Rollout judgment"

- id: k8s:runs-as-root
  rule: A network-exposed workload sets `runAsNonRoot: true` and never `privileged: true`.
  check: Pod or container `securityContext` with `privileged: true`; a workload behind a Service, Ingress or Gateway with `runAsNonRoot` unset at both Pod and container level.
  section: "## Security review lane"

- id: k8s:credential-in-env
  rule: Credentials reach the container as a mounted Secret volume, not env vars.
  check: `env[].valueFrom.secretKeyRef` or `envFrom.secretRef` carrying a password, token or key; any credential written as a literal `env[].value`.
  section: "## Security review lane"

- id: k8s:networkpolicy-missing
  rule: A namespace handling sensitive data has a default-deny NetworkPolicy.
  check: Namespace (new or touched) holding workloads that process sensitive data with no NetworkPolicy that selects all Pods (`podSelector: {}`) and lists the policy types without allow rules.
  section: "## Security review lane"

- id: k8s:gitops-imperative-edit
  rule: Change a GitOps-managed resource through its source manifest, never `kubectl edit`.
  check: Script, runbook or CI step running `kubectl edit`, `kubectl patch`, `kubectl set` or `kubectl scale` against a resource owned by Argo CD or Flux.
  section: "## What NOT to do"

- id: k8s:finalizer-force-removed
  rule: Never force-remove a finalizer without knowing why it is stuck and doing its cleanup another way.
  check: `kubectl patch ... finalizers` setting `[]` or `null`, `metadata.finalizers` emptied in a script or manifest, a namespace `finalize` API call used to unstick termination.
  section: "## What NOT to do"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: k8s:requests-basis-unstated
  rule: Resource requests come from measured steady-state usage.
  check: Request and limit values given with no stated measurement, or padded far above measured usage "to be safe".
  section: "## Manifest review judgment"

- id: k8s:rollout-headroom-unstated
  rule: A zero-unavailability rollout names the capacity for surge Pods and who acts on a stalled rollout.
  check: Design with `maxUnavailable: 0` that does not state cluster headroom for `maxSurge` Pods or what happens at `ProgressDeadlineExceeded` (Kubernetes does not roll back on its own).
  section: "## Rollout judgment"

- id: k8s:networkpolicy-enforcement-unstated
  rule: A design relying on NetworkPolicy names a network plugin that enforces it.
  check: Isolation claimed through NetworkPolicy with no statement that the cluster's network plugin implements NetworkPolicy.
  section: "## Security review lane"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: k8s:rollback-or-fix-forward
  rule: Roll back vs fix forward on a bad rollout.
  options: `kubectl rollout undo` (stops impact while root cause is unknown, redoes the rollout later) | fix forward (no repeat rollout when the fix is known and trivial, keeps impact running until it ships; required when rollback reintroduces another known issue)
  section: "## Rollout judgment"

- id: k8s:tag-or-digest
  rule: Tag pin vs digest pin.
  options: tag (readable, can be moved under the same name) | digest (exact image, unreadable and needs tooling to update)
  section: "## Manifest review judgment"
