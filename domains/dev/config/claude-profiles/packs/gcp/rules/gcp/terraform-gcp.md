---
paths:
  - "**/*.tf"
  - "**/*.tfvars"
---
# Terraform GCP

> This file extends [common/security.md](../common/security.md) with GCP Terraform specific content.

For IAM design judgment (least privilege, service-account-per-workload vs
shared, workload identity over key files), see skill: `gcp-patterns`.

## Rule

Never hardcode a project ID, service account email, or secret value in
`.tf`/`.tfvars`. Use an input variable for project IDs and a
`google_secret_manager_secret_version` data source for secrets — never a
literal string, and never a `.tfvars` file with real values committed to git.
