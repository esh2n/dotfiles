---
paths:
  - "**/*.yaml"
  - "**/*.yml"
---
# Kubernetes Manifests

> This file extends [common/coding-style.md](../common/coding-style.md) with Kubernetes manifest specific content.

This glob also matches Helm values, CI configs, and other non-Kubernetes
YAML — before applying anything below, confirm the file actually has
`apiVersion:` and `kind:` at the top level.

When it is a Kubernetes manifest, apply the review lanes in skill:
`k8s-patterns` (resource requests/limits, probes, PodDisruptionBudget, image
pinning, security context, NetworkPolicy).
