# terraform-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer`, `security-reviewer` and `rollout-reviewer` through the `change-review` skill when a diff touches `*.tf`, `*.tofu`, `*.tfvars`, `.terraform.lock.hcl` or Terraform/OpenTofu module code (defects; silences and trade-offs in a design or spec review), and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Read tool output first (`terraform validate`, `tflint`, Trivy, Checkov, the plan) and pass it on; see SKILL.md "## Tool coverage".

## defects
Objectively checkable in a diff, config or plan. A match is a finding.

- id: terraform:stateful-replace-unexplained
  rule: A replace or destroy on a stateful resource is a finding until the PR explains it.
  check: Plan shows `-/+`, `+/-`, `-` or `# forces replacement` on a database, disk, bucket, queue, KMS key or DNS zone, and the PR text does not state why and how data survives.
  section: "## Plan review: destroy and replace"

- id: terraform:plan-creates-existing
  rule: A plan that creates resources that already exist means state is missing or wrong.
  check: Plan proposes creating objects that exist in the account (mass `+` on an established configuration, new backend, changed backend key); stop before any apply or destroy.
  section: "## Plan review: destroy and replace"

- id: terraform:taint-instead-of-replace
  rule: Forced replacement goes through `plan -replace=ADDRESS`, not `terraform taint`.
  check: Scripts, CI or runbooks calling `terraform taint`.
  section: "## Plan review: destroy and replace"

- id: terraform:stateful-no-deletion-protection
  rule: Stateful resources carry deletion protection.
  check: Database or other stateful resource with no `lifecycle { prevent_destroy = true }` and the provider's `deletion_protection` (or equivalent) absent or false.
  section: "## Lifecycle meta-arguments"

- id: terraform:prevent-destroy-block-removed
  rule: Removing a resource block also removes its `prevent_destroy` and destroys the object.
  check: Diff deletes a resource block or module call that had `prevent_destroy = true` without a `removed` block with `destroy = false`.
  section: "## Lifecycle meta-arguments"

- id: terraform:cbd-unique-name
  rule: `create_before_destroy` needs a name that can exist twice.
  check: `create_before_destroy = true` on a resource with a fixed, account-unique `name`/identifier (no `name_prefix` or random suffix); also destroy-time provisioners on it.
  section: "## Lifecycle meta-arguments"

- id: terraform:ignore-changes-all
  rule: `ignore_changes = all` is not used; specific attributes name the outside actor.
  check: `ignore_changes = all`, or an attribute list with no comment saying who changes each attribute.
  section: "## Lifecycle meta-arguments"

- id: terraform:replace-triggered-by-non-resource
  rule: `replace_triggered_by` references managed resources only.
  check: `replace_triggered_by` pointing at a variable, local or data source instead of a resource or `terraform_data`.
  section: "## Lifecycle meta-arguments"

- id: terraform:state-mv-instead-of-moved
  rule: Renames and moves use a `moved` block.
  check: Resource or module address changed with no `moved` block (plan shows destroy plus create of the same object), or `terraform state mv` in scripts, CI or the PR's instructions.
  section: "## Refactoring without state surgery"

- id: terraform:moved-block-removed
  rule: Historical `moved` blocks stay in shared modules.
  check: Diff deletes a `moved` block from a module that has callers outside this change.
  section: "## Refactoring without state surgery"

- id: terraform:count-to-for-each-without-moved
  rule: Switching `count` to `for_each` needs one `moved` block per index-to-key pair.
  check: Existing resource changed from `count` to `for_each` without `moved` blocks; plan replaces every instance.
  section: "## Refactoring without state surgery"

- id: terraform:import-cli-instead-of-block
  rule: Adopting an existing object uses an `import` block, approved as an exception.
  check: `terraform import` CLI in scripts or instructions on Terraform 1.5+; an import with no stated approval.
  section: "## Refactoring without state surgery"

- id: terraform:state-rm-instead-of-removed
  rule: Handing an object elsewhere uses `removed` with `destroy = false`, not `terraform state rm`; state is never edited by hand.
  check: `terraform state rm`, hand-edited state, or a `removed` block meant to keep the object but lacking `lifecycle { destroy = false }`.
  section: "## Refactoring without state surgery"

- id: terraform:backend-no-lock
  rule: Shared configurations use a remote backend that locks.
  check: No `backend` block in a shared root module; S3 backend with neither `use_lockfile = true` nor `dynamodb_table`; a backend type with no locking.
  section: "## State"

- id: terraform:state-bucket-no-versioning
  rule: The state bucket has versioning on.
  check: Bucket that holds state defined with versioning disabled or absent.
  section: "## State"

- id: terraform:backend-credentials
  rule: No credentials in the `backend` block or `-backend-config` key-value pairs.
  check: `access_key`, `secret_key`, `token`, `credentials` or similar literal in a `backend` block, or `-backend-config="key=secret"` in CI.
  section: "## State"

- id: terraform:state-not-treated-as-secret
  rule: State and saved plan files are secrets.
  check: `*.tfstate`, `*.tfstate.backup`, `.terraform/` or plan files not git-ignored or committed; backend without encryption at rest (S3 `encrypt`, GCS CMEK); broad read access on the state bucket.
  section: "## State"

- id: terraform:secret-not-write-only
  rule: Keep secrets out of state where the tool allows it.
  check: New password or key passed as an ordinary argument where the provider offers a write-only argument or an ephemeral resource (Terraform 1.10+/1.11+).
  section: "## State"

- id: terraform:env-shared-state
  rule: Each environment has its own state, and production's state has its own access.
  check: Production selected by `terraform.workspace` in the same backend and credentials as development; one directory and state for several environments.
  section: "## State"

- id: terraform:shared-state-key
  rule: Two configurations never write the same state key.
  check: Same backend `bucket` + `key` (or prefix) in two root modules or across workspaces.
  section: "## State"

- id: terraform:module-unpinned
  rule: Every external module is pinned.
  check: Registry module with no `version`; git source with no `?ref=` or a branch name as `ref`; third-party module with a range instead of an exact version (tflint `terraform_module_pinned_source`, `terraform_module_version`).
  section: "## Modules and versions"

- id: terraform:provider-constraints-wrong-shape
  rule: Root modules use `~>` for providers and set `required_version`; reusable modules set only `>=`.
  check: Root module provider with no constraint or no upper bound, missing `required_version`; reusable module with `~>`, `<` or exact provider/Terraform versions (tflint `terraform_required_providers`, `terraform_required_version`).
  section: "## Modules and versions"

- id: terraform:lock-file-missing
  rule: `.terraform.lock.hcl` is committed and its changes are reviewed.
  check: Lock file git-ignored or absent in a root module; lock file change with no matching constraint change or stated intent; CI on another platform with hashes for one platform only.
  section: "## Modules and versions"

- id: terraform:sensitive-as-protection
  rule: `sensitive = true` hides output only; it does not protect state.
  check: Password or key variable/output not marked `sensitive`; PR or comment claiming `sensitive` keeps a value out of state; `terraform output -json`/`-raw` of secrets into CI logs.
  section: "## Variables, outputs and credentials"

- id: terraform:hardcoded-credentials
  rule: No credentials in `.tf`, `.tfvars` or provider blocks.
  check: Literal keys, tokens or passwords in provider blocks, resources or committed `.tfvars`; static long-lived cloud keys where OIDC, assumed roles or dynamic credentials apply.
  section: "## Variables, outputs and credentials"

- id: terraform:variable-untyped
  rule: Every variable has a `type` and `description`; restrictive values have `validation`.
  check: Variable without `type` or `description` (tflint `terraform_typed_variables`, `terraform_documented_variables`); environment name, CIDR or length-limited name accepted with no `validation`.
  section: "## Variables, outputs and credentials"

- id: terraform:env-specific-default
  rule: No default for environment-specific values.
  check: `default` set on a project ID, account ID, environment or region variable that differs per environment.
  section: "## Variables, outputs and credentials"

- id: terraform:count-over-changing-collection
  rule: `for_each`, not `count`, for a collection whose members can change.
  check: `count = length(var.list)` with `var.list[count.index]` over items that can be added or removed; plan shows updates to later indices after a removal.
  section: "## Correctness"

- id: terraform:unknown-or-sensitive-keys
  rule: `for_each` keys and `count` are known at plan time and not sensitive.
  check: Keys or count from apply-time attributes, `uuid()`, `timestamp()`, or sensitive values; `-target` used to work around the resulting error.
  section: "## Correctness"

- id: terraform:depends-on-overuse
  rule: `depends_on` only for a dependency no reference can express, with a comment.
  check: `depends_on` where a reference to an output attribute would order the same; module-level `depends_on`; `depends_on` with no comment.
  section: "## Correctness"

- id: terraform:data-source-deferred
  rule: A data source reading something this plan changes is read at apply time.
  check: Data block with `depends_on` or arguments from a resource changing in this plan, whose unknown result feeds a replacement in the plan.
  section: "## Correctness"

- id: terraform:provisioner-first
  rule: Provisioners and `null_resource` are a last resort.
  check: `provisioner` blocks or `null_resource` where a provider feature, image or configuration management exists; new `null_resource` instead of `terraform_data`.
  section: "## Correctness"

- id: terraform:public-or-wildcard
  rule: Public buckets, open ingress, IAM wildcards and unencrypted storage are findings for `security-reviewer`.
  check: Public bucket ACL/policy or missing public access block; ingress `0.0.0.0/0` or `::/0` beyond a public load balancer port; IAM `Action = "*"` or `service:*`; storage without encryption at rest. Map to the Trivy/Checkov ids in SKILL.md.
  section: "## Security misconfiguration"

- id: terraform:scanner-suppression-no-reason
  rule: A scanner suppression carries a reason.
  check: `#trivy:ignore:`, `#tfsec:ignore:` or `#checkov:skip=` with no reason text.
  section: "## Security misconfiguration"

- id: terraform:apply-without-saved-plan
  rule: Production applies run in CI from a saved, reviewed plan.
  check: Production pipeline running `apply -auto-approve` without a plan file; apply from a workstation; plan and apply on different Terraform or provider versions.
  section: "## Rollout and drift"

- id: terraform:plan-artifact-unprotected
  rule: The plan artifact is stored as a secret.
  check: Plan file uploaded as a public or broadly readable CI artifact, or printed in full to logs.
  section: "## Rollout and drift"

- id: terraform:target-routine
  rule: `-target` is an exception, never a pipeline step.
  check: `-target` in CI, Makefiles or routine runbooks.
  section: "## Rollout and drift"

## silences
A design document or PR must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: terraform:plan-output-missing
  rule: An infrastructure change comes with its plan output per affected state.
  check: PR changes `.tf`/`.tfvars`/lock file and no plan is attached or linked; report under missing context.
  section: "## Plan review: destroy and replace"

- id: terraform:blast-radius-unstated
  rule: A new root module states what it groups and why those resources change together.
  check: New root module or state with no stated grouping, or one above about 100 resources.
  section: "## State"

- id: terraform:community-module-provenance
  rule: A community module's publisher and transitive dependencies are named.
  check: New third-party module with no statement of publisher, required providers, nested modules or external data sources.
  section: "## Modules and versions"

- id: terraform:drift-unstated
  rule: The rollout states how drift is detected and who may change production outside Terraform.
  check: Design or runbook with no scheduled plan, audit, or unlock alerting, and no stated break-glass path.
  section: "## Rollout and drift"

- id: terraform:backups-tied-to-resource
  rule: Backups do not depend on the resource Terraform may delete.
  check: Stateful resource whose only backups are its own automated snapshots, with no independent backup or restore test stated.
  section: "## Rollout and drift"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: terraform:ignore-changes-or-own
  rule: `ignore_changes` on specific attributes vs Terraform owning them.
  options: ignore (outside actor works undisturbed, drift on those attributes disappears from every plan) | own (plan shows all drift, plan fights the outside actor on every run) | move the attribute out of Terraform entirely (clear ownership, two tools to read)
  section: "## Lifecycle meta-arguments"

- id: terraform:remote-state-or-data-source
  rule: Cross-state data via `terraform_remote_state` vs provider data sources or `tfe_outputs`.
  options: remote state (direct root outputs, reader needs read access to the whole state including its secrets) | provider data source (reads the live object, no state access, needs a lookup key) | `tfe_outputs` (outputs only, HCP Terraform only)
  section: "## State"

- id: terraform:thin-wrapper-module
  rule: A module that wraps a single resource.
  options: wrapper (enforces organisation defaults in one place, one more layer and version to track) | resource directly (readable, defaults repeated or enforced by policy tools instead)
  section: "## Modules and versions"
