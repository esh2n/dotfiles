---
name: terraform-patterns
description: Use when writing or reviewing Terraform or OpenTofu code — `*.tf`, `*.tofu`, `*.tfvars`, `.terraform.lock.hcl`, module code, backend and provider blocks — or reading a plan with destroy or replace actions (`-/+`, `forces replacement`), refactoring resource addresses (`moved`, `import`, `removed`), choosing state layout per environment, pinning module and provider versions, handling secrets in state, or choosing between `count` and `for_each`.
metadata:
  namespaces: [platform/infra]
---

# Terraform Patterns

Judgment criteria for reviewing Terraform and OpenTofu changes and their
plans — not an HCL tutorial. Cloud-specific rules live in the cloud's own
skill: `gcp-patterns` (section "## Terraform": no hardcoded project IDs,
service-account emails or secrets in `.tf`/`.tfvars`, secrets from Secret
Manager through the ephemeral resource; section "## gcloud CLI
judgment": pin `project` in the provider block). `k8s-patterns` and
`cloudflare-patterns` carry no Terraform rules. Read them for the resources
the diff creates; this skill covers the tool itself.

Each rule is tagged: **[defect]** is checkable in a diff or plan and a match is
a finding; **[silence]** is something a design or PR must state; **[trade-off]**
is defensible either way and goes to the owner as a question.

## Plan review: destroy and replace

**[silence] The plan output.** The diff of `.tf` files does not show what
will happen; the plan does. A review of an infrastructure change without the
plan output, per affected state, is missing context, and the reviewer says so.

**[defect] A replace (`-/+` or `+/-`) or destroy (`-`) on a stateful resource
is a finding until the PR explains it.** Stateful means the object holds data
that a fresh copy does not: databases, disks, buckets, queues with retained
messages, KMS keys, DNS zones. The trigger is often an attribute that looks
harmless: a production database was deleted and recreated because a
credential rotation changed an argument wired to the database resource, and
deletion protection was off
(https://handbook.polar.sh/engineering/tech-notes/postmortems/2026-06-12).
Look for `# forces replacement` next to the changed attribute in the plan.

**[defect] A plan that proposes to create resources that already exist means
the state is missing or wrong, not that the infrastructure is gone.** In one
incident, state lived on one laptop; on a new machine the plan proposed
creating everything, and a later `terraform destroy` run against an older
unpacked state file removed the production database, network and cluster,
including the automated snapshots
(https://aishippingblog.com/p/how-i-dropped-our-production-database).
Stop and find the real state before applying anything.

**[defect] `-replace=ADDRESS` replaces exactly the named instance and is the
supported form of `terraform taint`** (Terraform 0.15.2 and later); a PR that
taints in a script instead of planning with `-replace` hides the replacement
from plan review
(https://developer.hashicorp.com/terraform/cli/commands/plan).

## Lifecycle meta-arguments

Source for this section unless noted:
https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle.

**[defect] Stateful resources carry deletion protection.** Google's style
guide asks for deletion protection on stateful resources such as databases and
shows `prevent_destroy = true`
(https://docs.cloud.google.com/docs/terraform/best-practices/general-style-structure).
Prefer the provider's own flag as well where it exists (for example
`deletion_protection` on database resources): it is enforced by the cloud API,
so it also stops deletion from outside Terraform.

**[defect] `prevent_destroy` does not protect against deleting the resource
block.** Lifecycle settings are not stored in state, so removing the block
(or the module call that contains it) together with its `prevent_destroy`
destroys the object without any error. A diff that removes a block that had
`prevent_destroy` is a finding unless it uses a `removed` block with
`destroy = false`. HashiCorp also asks that `prevent_destroy` be used
sparingly, because it blocks `terraform destroy` for that object.

**[defect] `create_before_destroy` on a resource with a unique name or
identifier fails at apply**, because the old and new objects exist at the same
time. Check that the name is generated (`name_prefix`, a random suffix) or not
unique per account. The setting also propagates to everything the resource
depends on and cannot be turned off there, and it stops destroy-time
provisioners from running.

**[defect] `ignore_changes = all` turns the resource into create-and-forget.**
Terraform never proposes an update for it again, so every later configuration
change to that resource is silently a no-op. A list of specific attributes is
the reviewable form; each entry should say which outside actor changes it
(an autoscaler, a tag policy, a deploy tool).

**[trade-off] `ignore_changes` on specific attributes vs letting Terraform
own them.** Ignoring hides drift on those attributes from every future plan;
owning them makes the plan fight the outside actor on every run.

**[defect] `replace_triggered_by` takes only managed-resource references**;
use `terraform_data` to replace on a plain value change.

## Refactoring without state surgery

**[defect] Renames and moves use a `moved` block, not `terraform state mv`.**
Without either, an address change is planned as destroy plus create. A
`moved` block makes the rename visible in the diff and the plan and applies to
every caller of a module; `state mv` is invisible to review and to other
workspaces. Terraform 1.1+
(https://developer.hashicorp.com/terraform/language/modules/develop/refactoring,
https://developer.hashicorp.com/terraform/cli/state/move).

**[defect] Removing a `moved` block from a shared module is a breaking
change.** A caller still on the old address then plans a delete instead of a
move. Keep historical `moved` blocks; chain them when an object moves twice.
Removal is safe only for a private module whose every caller has applied
(https://developer.hashicorp.com/terraform/language/modules/develop/refactoring).

**[defect] Switching an existing resource from `count` to `for_each` needs
one `moved` block per index-to-key pair** (`aws_instance.c[0]` to
`aws_instance.c["small"]`); without them every instance is replaced. Adding
`count` to a single resource moves the old object to index 0 implicitly; an
explicit block is still clearer (same source).

**[defect] Adopting an existing object uses an `import` block**, which shows
the import in the plan; `-generate-config-out=PATH` drafts the resource block.
`import` blocks arrived in Terraform 1.5, `for_each` on them in 1.7
(https://github.com/hashicorp/terraform/blob/v1.5/CHANGELOG.md,
https://github.com/hashicorp/terraform/blob/v1.7/CHANGELOG.md,
https://developer.hashicorp.com/terraform/language/import).
Google asks that import be the exception, approved explicitly, and that an
imported resource then be managed only by Terraform
(https://docs.cloud.google.com/docs/terraform/best-practices/operations).

**[defect] Handing an object to another tool or state uses a `removed` block
with `lifecycle { destroy = false }`, not `terraform state rm`.** Without
`destroy = false`, a `removed` block destroys the object. Terraform 1.7+,
OpenTofu 1.7+
(https://developer.hashicorp.com/terraform/language/block/removed,
https://github.com/hashicorp/terraform/blob/v1.7/CHANGELOG.md,
https://opentofu.org/blog/opentofu-1-7-0/).

Google's operations guide also forbids editing state by hand; state changes go
through `terraform state` commands, because a corrupted state file breaks
infrastructure management
(https://docs.cloud.google.com/docs/terraform/best-practices/operations).

## State

**[defect] Shared configurations use a remote backend that locks.** With no
`backend` block, Terraform uses the `local` backend, a file on one disk; not
every backend locks, so check the backend's own page
(https://developer.hashicorp.com/terraform/language/backend). On S3,
`use_lockfile = true` enables S3-native locking (added in 1.10, generally
available in 1.11), and the DynamoDB arguments are deprecated
(https://developer.hashicorp.com/terraform/language/backend/s3,
https://github.com/hashicorp/terraform/blob/v1.11/CHANGELOG.md). An S3 backend
with neither `use_lockfile` nor `dynamodb_table` has no lock.

**[defect] The state bucket has versioning on.** HashiCorp's S3 page and AWS's
guidance both recommend bucket versioning so a deleted or corrupted state can
be restored
(https://developer.hashicorp.com/terraform/language/backend/s3,
https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html).

**[defect] No credentials in the `backend` block or in `-backend-config`
key-value pairs.** Values given there are written into `.terraform/` and into
plan files, and command-line pairs stay in shell history; use the
environment or the cloud's credential files
(https://developer.hashicorp.com/terraform/language/backend).

**[defect] Treat state and saved plan files as secrets.** Any value written to
a managed resource is stored in state and in plan files in plain text, whether
or not it is marked `sensitive`; local state is plain text on disk
(https://developer.hashicorp.com/terraform/language/state/sensitive-data,
https://developer.hashicorp.com/terraform/cli/commands/plan). Check that
`*.tfstate`, `*.tfstate.backup`, `.terraform/` and plan files are ignored by
git, that the backend encrypts at rest (S3 `encrypt`, GCS customer-managed
keys), and that read access to the state bucket is limited to the pipeline
and a few administrators
(https://docs.cloud.google.com/docs/terraform/best-practices/security). Some
resources always put secrets into state — Google names
`tls_private_key`, `google_service_account_key`, `vault_generic_secret` and
`google_client_config` (same source).

**[defect] Keep secrets out of state where the tool allows it.** Terraform
1.10 added ephemeral values and ephemeral resources, which are not written to
state or plan; 1.11 added write-only arguments on managed resources
(https://developer.hashicorp.com/terraform/language/state/sensitive-data,
https://github.com/hashicorp/terraform/blob/v1.10/CHANGELOG.md,
https://github.com/hashicorp/terraform/blob/v1.11/CHANGELOG.md). A new
password or key passed as an ordinary argument where the provider offers a
write-only form is a finding.

**[defect] Each environment has its own state, and production's state has its
own access.** HashiCorp: without HCP Terraform, one directory per environment
with its own state
(https://developer.hashicorp.com/terraform/language/style). CLI workspaces
share one backend and one set of credentials and are not suitable where
deployments need separate credentials or access control
(https://developer.hashicorp.com/terraform/language/state/workspaces). Google
uses only the default workspace, one environment per directory
(https://docs.cloud.google.com/docs/terraform/best-practices/root-modules);
AWS recommends a separate backend per environment, production writable only
by the pipeline and break-glass roles
(https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html).
A production environment selected by `terraform.workspace` in the same backend
as development is a finding.

**[defect] Two configurations never write the same state key.** A shared key
across workspaces or directories lets one apply destroy the other's resources;
it appears in a forum report of a lost production database (unverified
community post:
https://www.repost.aws/questions/QU5HJ7WlNBQ6yJb-DHod2r7Q/accidentally-destroyed-prod-rds-via-mis-configured-terraform-any-chance-of-recovery).

**[silence] State size and blast radius.** Google: no more than 100 resources
in one state, ideally a few dozen, because every run refreshes all of them
(https://docs.cloud.google.com/docs/terraform/best-practices/root-modules).
A design that adds a root module states what it groups and why those
resources must change together.

**[trade-off] Cross-state data: `terraform_remote_state` vs provider data
sources or `tfe_outputs`.** Remote state reads the other state's root outputs
but requires read access to that whole state; HashiCorp's style guide prefers
not sharing full state files
(https://developer.hashicorp.com/terraform/language/style).

## Modules and versions

**[defect] Every external module is pinned.** Registry sources take
`version`; git sources take `?ref=` with a tag or a commit SHA — without `ref`
Terraform follows the default branch
(https://developer.hashicorp.com/terraform/language/modules/sources).
HashiCorp: pin third-party modules to specific versions; ranges are acceptable
only for your own modules with disciplined releases
(https://developer.hashicorp.com/terraform/language/expressions/version-constraints).
The lock file does not record module versions, so the pin in `source`/
`version` is the only pin
(https://developer.hashicorp.com/terraform/language/files/dependency-lock).

**[defect] Root modules constrain providers with `~>` and set
`required_version`; reusable modules set only minimum versions (`>=`).**
An upper bound inside a reusable module blocks every caller's upgrade
(https://developer.hashicorp.com/terraform/language/expressions/version-constraints,
https://developer.hashicorp.com/terraform/language/style).

**[defect] `.terraform.lock.hcl` is committed, and changes to it are
reviewed.** It pins provider versions and package hashes; `init` reuses it,
and `init -upgrade` moves to the newest allowed version. When CI and
developers run different OS or CPU platforms, run
`terraform providers lock -platform=...` for each, or `init` on another
platform finds no matching hash
(https://developer.hashicorp.com/terraform/language/files/dependency-lock).
A lock file change with no matching constraint or intent in the PR is a
supply-chain question for `security-reviewer`.

**[silence] Community modules: the PR names the publisher and what the
module pulls in.** AWS asks to use modules from verified publishers and to
read the module's required providers, nested modules and external data
sources before use
(https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/community.html).

**[trade-off] A module that wraps a single resource.** HashiCorp advises
against thin wrappers and deep nesting; a wrapper earns its place only when
it fixes defaults the organisation must enforce
(https://developer.hashicorp.com/terraform/language/modules/develop).

## Variables, outputs and credentials

**[defect] `sensitive = true` hides a value from CLI and UI output only.**
The value is still in state and plan files, and `terraform output -json` or
`-raw` prints it in plain text
(https://developer.hashicorp.com/terraform/language/values/outputs,
https://developer.hashicorp.com/terraform/language/values/variables). Mark
passwords and keys `sensitive` (style guide), and do not treat the mark as
protection of the state.

**[defect] No credentials in `.tf`, `.tfvars` or provider blocks.** Provider
credentials come from the environment, a secret manager, or short-lived
federation (OIDC from CI, assumed roles, dynamic credentials); never a
committed static key
(https://developer.hashicorp.com/terraform/language/style,
https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/security.html,
https://docs.cloud.google.com/docs/terraform/best-practices/operations).
GCP specifics: `gcp-patterns`, section "## Terraform".

**[defect] Every variable has a `type` and a `description`; `validation`
blocks guard values with real restrictions** (allowed environments, CIDR
shape, name length). The style guide reserves `validation` for variables with
uniquely restrictive requirements
(https://developer.hashicorp.com/terraform/language/style). Since 1.9 a
validation rule can refer to other variables and objects in the module
(https://github.com/hashicorp/terraform/blob/v1.9/CHANGELOG.md).

**[defect] No default for environment-specific values** such as a project
or account ID; a default there lets the wrong environment apply silently
(https://docs.cloud.google.com/docs/terraform/best-practices/general-style-structure).

## Correctness

**[defect] `for_each`, not `count`, for a collection whose members can
change.** `count` instances are addressed by index and `for_each` instances
by key
(https://developer.hashicorp.com/terraform/language/meta-arguments/count,
https://developer.hashicorp.com/terraform/language/meta-arguments/for_each).
Removing an item from the middle of a list used with `count` therefore shifts
every later index: those instances are updated or replaced to match their new
item and the last one is destroyed. `count` stays right for
nearly identical instances and for `count = var.enable_x ? 1 : 0`.

**[defect] `for_each` keys and `count` must be known at plan time and must
not be sensitive.** Keys derived from apply-time IDs or impure functions
(`uuid`, `timestamp`) fail; the error suggests `-target`, which is not the
fix (same sources). Google adds: avoid user-supplied variables that set
`count` from values unknown until apply; use a separate boolean
(https://docs.cloud.google.com/docs/terraform/best-practices/general-style-structure).

**[defect] `depends_on` only for a dependency that no reference can
express, with a comment saying why.** It makes plans more conservative:
more values become `(known after apply)` and more resources can be planned for
replacement than necessary, especially on module-level `depends_on`
(https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on,
https://docs.cloud.google.com/docs/terraform/best-practices/dependency-management).
Reference an output attribute (`id`), not an input argument (`name`), to get
ordering from the reference itself.

**[defect] A data source that reads something this plan changes is read at
apply time.** Data sources are read during plan unless an argument refers to
a value unknown until apply, a managed resource changing in this plan, or the
data block has `depends_on`; then the read is deferred and everything that
uses it shows as unknown in the plan
(https://developer.hashicorp.com/terraform/language/data-sources). A plan
whose replacements trace back to a deferred data source is a finding against
the data source wiring, not a reason to approve.

**[defect] Provisioners and `null_resource` are a last resort.** Terraform
cannot model what a provisioner does; use the provider's own feature, machine
images or configuration management first, and attach unavoidable
provisioners to `terraform_data`
(https://developer.hashicorp.com/terraform/language/resources/provisioners/syntax).

## Security misconfiguration

Detection belongs to scanners; the reviewer checks that one ran and reads its
output. The rule ids below were opened on the scanners' indexes.

| Misconfiguration | Trivy (tfsec checks moved here) | Checkov |
|---|---|---|
| S3 bucket public via ACL or policy | AWS-0086, AWS-0087, AWS-0091, AWS-0092, AWS-0093, AWS-0094 | CKV_AWS_20, CKV_AWS_53, CKV_AWS_54, CKV_AWS_55, CKV_AWS_56 |
| S3 encryption at rest | AWS-0088, AWS-0132 | CKV_AWS_19, CKV_AWS_145 |
| Security group ingress from 0.0.0.0/0 | AWS-0107 | CKV_AWS_24 (port 22), CKV_AWS_25 (port 3389) |
| IAM wildcard actions or admin policy | AWS-0057 | CKV_AWS_1, CKV_AWS_62, CKV_AWS_63 |
| EBS / RDS encryption | AWS-0026 | CKV_AWS_3, CKV_AWS_16 |
| RDS cluster deletion protection | — | CKV_AWS_139 |
| GCS bucket public | GCP-0001 | (not verified) |
| GCP firewall ingress from 0.0.0.0/0 | GCP-0027, GCP-0070, GCP-0071 | (not verified) |

Sources: https://avd.aquasec.com/misconfig/aws/s3/,
https://avd.aquasec.com/misconfig/aws/ec2/,
https://avd.aquasec.com/misconfig/aws/iam/,
https://avd.aquasec.com/misconfig/google/storage/,
https://avd.aquasec.com/misconfig/google/compute/,
https://www.checkov.io/5.Policy%20Index/terraform.html. tfsec's README says
it is now part of Trivy and asks users to move
(https://github.com/aquasecurity/tfsec).

**[defect] Public buckets, ingress from `0.0.0.0/0` or `::/0` to anything but
a public load balancer port, IAM statements with `Action = "*"` or
`service:*`, and storage without encryption at rest are findings** for
`security-reviewer`, whether or not a scanner ran. AWS asks for least
privilege at the action level on specific resources
(https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/security.html).
GCP IAM grant rules: `gcp-patterns`, section "## IAM judgment".

**[defect] A scanner suppression (`#trivy:ignore:`, `#tfsec:ignore:`, `#checkov:skip=`)
carries a reason** in the same comment.

## Rollout and drift

**[defect] Production applies run in CI from a saved, reviewed plan.**
`terraform plan -out=FILE` then `terraform apply FILE` applies exactly what
was reviewed; the plan must be applied with the same Terraform and provider
versions, on the same platform, from the same absolute path, and only one plan
should be outstanding per state
(https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform).
Google: save the plan and have an owner approve it before apply
(https://docs.cloud.google.com/docs/terraform/best-practices/operations).
`apply -auto-approve` without a saved plan against production is a finding;
the database-loss incident above ran auto-approve from an agent
(https://aishippingblog.com/p/how-i-dropped-our-production-database).

**[defect] The plan artifact is stored as a secret**, because it contains the
configuration, the prior state and the input variables in plain text (same
source).

**[defect] `-target` is an exception, never a pipeline step.** HashiCorp
limits it to recovering from mistakes or working around Terraform
limitations; routine use hides drift. Split the configuration instead
(https://developer.hashicorp.com/terraform/cli/commands/plan).

**[silence] Drift.** A rollout plan states how drift is detected (scheduled
plan, cloud audit tools) and who may change production outside Terraform.
Google asks for continuous audits after apply
(https://docs.cloud.google.com/docs/terraform/best-practices/security); AWS
asks for alerts on state unlocks from workstations
(https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/backend.html).

**[silence] Backups that do not depend on the resource Terraform may delete.**
In the incident above, automated snapshots were deleted with the database;
the author's fix was backups not managed by that Terraform and a nightly
restore test
(https://aishippingblog.com/p/how-i-dropped-our-production-database).

## Terraform and OpenTofu

Facts for reading a codebase; not advice to switch.

- HashiCorp moved future releases of its products from MPL 2.0 to the
  Business Source License 1.1 on 2023-08-10; the restriction is on offering a
  service that competes with HashiCorp
  (https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license).
  Terraform v1.5.7 is MPL 2.0 and v1.6.0 is BSL 1.1, converting to MPL 2.0
  four years after each release
  (https://github.com/hashicorp/terraform/blob/v1.5.7/LICENSE,
  https://github.com/hashicorp/terraform/blob/v1.6.0/LICENSE).
- OpenTofu is the Linux Foundation fork of the MPL-licensed code
  (https://opentofu.org/manifesto/).
- OpenTofu-only features a reviewer will meet: client-side state and plan
  encryption (1.7; losing the key makes state unrecoverable; `enforced = true`
  refuses to write plaintext) (https://opentofu.org/blog/opentofu-1-7-0/,
  https://opentofu.org/docs/language/state/encryption/); variables and
  locals in backend blocks and module sources (1.8); `.tofu` files that
  override a same-named `.tf` file (1.8)
  (https://opentofu.org/blog/opentofu-1-8-0/,
  https://opentofu.org/docs/language/files/); `for_each` on provider blocks
  and the `-exclude` flag (1.9) (https://opentofu.org/blog/opentofu-1-9-0/).
  Code using these does not run on Terraform; a `.tofu` file next to a `.tf`
  of the same name means the two tools read different code.
- In this repository, terraform was dropped from the container tool list
  because the BSL build is not in the Nix binary cache and rebuilds every time;
  the note names OpenTofu as the option when needed
  (`harness/rules/decisions/2026-09-22-tools-nix-list-box-subset.md`).

## Tool coverage

Run these before review and pass their output on; a rule a tool covers is
read from the tool's output, not re-derived by hand.

| Tool | Covers here |
|---|---|
| `terraform fmt -check`, `terraform validate` | formatting; type and reference errors |
| `tflint` (terraform ruleset, `recommended` preset) | `terraform_module_pinned_source`, `terraform_module_version`, `terraform_required_providers`, `terraform_required_version`, `terraform_typed_variables`, `terraform_unused_declarations`; `terraform_documented_variables` is outside the preset (https://github.com/terraform-linters/tflint-ruleset-terraform/blob/main/docs/rules/README.md) |
| Trivy `config`, Checkov | the security table above |
| `terraform plan` output | replace and destroy actions, deferred data sources |
| none (reviewer) | stateful replace without reason, removed `prevent_destroy` block, `ignore_changes = all`, `count` over a changing list, workspace-per-environment, `-target` in CI, missing saved plan |

## Related

- `gcp-patterns` — GCP IAM, project pinning, Secret Manager secrets through
  the ephemeral resource and write-only arguments
  (`gcp-patterns/references/review-checklist.md` has the `gcp:terraform-*` items).
- `k8s-patterns` — manifests a Terraform `kubernetes`/`helm` provider applies.
- `cloudflare-patterns` — Workers resources.
- `resilience-patterns`, `observability-patterns` — what the provisioned
  services must do at run time.
