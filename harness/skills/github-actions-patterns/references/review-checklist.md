# github-actions-patterns — review checklist

Derived from ../SKILL.md. Read by `security-reviewer` (security items) and `code-reviewer` (conditions, jobs, concurrency, cost, reuse) through the `change-review` skill when a diff touches `.github/workflows/*.yml`, `action.yml`, or a reusable workflow, and by `grilling` (trade-offs). Read zizmor and actionlint output first: an item whose `tools:` line names a tool that ran is reported by that tool, not again by hand. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: gha:privileged-trigger-runs-pr-code
  rule: Never run pull request code under `pull_request_target` or `workflow_run`.
  check: Workflow on `pull_request_target` or `workflow_run` with `actions/checkout` `ref:` set to `github.event.pull_request.head.sha`/`.head.ref`, `github.head_ref`, `github.event.workflow_run.head_sha`, or `refs/pull/*/merge`, followed by any step that executes repository content (build, install, test, `make`, `uses: ./`).
  tools: zizmor dangerous-triggers flags the trigger only; Scorecard Dangerous-Workflow. Trace the checkout by hand.
  section: "## Privileged triggers"

- id: gha:privileged-artifact-trusted
  rule: Artifacts from an unprivileged run are untrusted input.
  check: Privileged workflow downloads an artifact and executes it, extracts it into the workspace, or uses a value from it (PR number, path, text) without validation.
  tools: none.
  section: "## Privileged triggers"

- id: gha:expression-injection
  rule: Never expand attacker-controlled `${{ }}` inside `run:`, `actions/github-script` `script:`, or a composite action's `run:`.
  check: `${{ github.event.issue.*|pull_request.title|body|head.ref|head.label|comment.body|review.body|commits.*|head_commit.* }}`, `${{ github.head_ref }}`, or a composite action `${{ inputs.* }}` fed from those, inside script text; fix is `env:` plus quoted `"$VAR"`.
  tools: zizmor template-injection; actionlint script injection; Scorecard Dangerous-Workflow. zizmor did not cover composite actions in late 2024; read `action.yml` by hand unless output shows it was scanned.
  section: "## Untrusted input and expression injection"

- id: gha:github-env-untrusted
  rule: Never write untrusted data to `GITHUB_ENV` or `GITHUB_PATH` in a privileged workflow; multiline `name<<DELIM` writes never wrap attacker text in a fixed delimiter.
  check: `>> "$GITHUB_ENV"` or `>> "$GITHUB_PATH"` with a value derived from event data or an artifact in a `pull_request_target`/`workflow_run` workflow; a heredoc-style write to `GITHUB_ENV`/`GITHUB_OUTPUT` with a constant delimiter around untrusted content.
  tools: zizmor github-env (ENV and PATH only; delimiter by hand).
  section: "## Untrusted input and expression injection"

- id: gha:bot-actor-gate
  rule: Never gate a privileged step on `github.actor` being a bot.
  check: `if:` comparing `github.actor` to `dependabot[bot]`, `renovate[bot]` or another bot name before a step with secrets or write access.
  tools: zizmor bot-conditions.
  section: "## Untrusted input and expression injection"

- id: gha:permissions-not-least
  rule: Top-level `permissions:` is present and read-only; writes and `id-token: write` sit on the job that needs them; never `write-all`.
  check: Workflow with no top-level `permissions:`; `write-all`; any `: write` scope at workflow level when not every job needs it.
  tools: zizmor excessive-permissions; Scorecard Token-Permissions.
  section: "## Token permissions"

- id: gha:checkout-persists-credentials
  rule: `actions/checkout` sets `persist-credentials: false` unless a later step runs `git` with the token.
  check: `actions/checkout` without `persist-credentials: false` in a job that uploads an artifact from the workspace, runs untrusted code, or has no later authenticated `git` step.
  tools: zizmor artipacked.
  section: "## Token permissions"

- id: gha:action-not-sha-pinned
  rule: Every action from outside the repository is pinned to a full 40-character commit SHA of its own repository, with a version comment.
  check: `uses: owner/repo@<tag|branch>`; a short SHA; a SHA that exists only in a fork; a SHA pin with no `# vX.Y.Z` comment.
  tools: zizmor unpinned-uses, impostor-commit (online), ref-version-mismatch; Scorecard Pinned-Dependencies.
  section: "## Third-party actions"

- id: gha:image-not-digest-pinned
  rule: Container images in `container:` and `services:` are pinned by digest.
  check: `image:` with a tag or `latest` and no `@sha256:` digest.
  tools: zizmor unpinned-images (non-latest tags pedantic only); Scorecard Pinned-Dependencies.
  section: "## Third-party actions"

- id: gha:structured-secret
  rule: One secret per value; never a JSON, YAML or XML blob.
  check: `fromJSON(secrets.X)`, `secrets.X` piped to `jq`, or a secret documented as holding several fields.
  tools: zizmor unredacted-secrets.
  section: "## Secrets"

- id: gha:derived-secret-unmasked
  rule: Register derived values with `::add-mask::` before printing them.
  check: A step encodes, signs or transforms a secret (base64, URL-encode, JWT) and the result is echoed, written to an output, or passed to a tool that logs it, with no `::add-mask::` first.
  tools: none.
  section: "## Secrets"

- id: gha:secrets-overprovisioned
  rule: Pass each callee only the secrets it uses.
  check: `secrets: inherit` in a reusable-workflow call; `toJSON(secrets)` or the whole `secrets` context passed anywhere.
  tools: zizmor secrets-inherit, overprovisioned-secrets.
  section: "## Secrets"

- id: gha:secret-in-job-output
  rule: A secret never flows into a job output.
  check: `jobs.<id>.outputs` value that is, or is derived from, a secret or a masked value.
  tools: none.
  section: "## Secrets"

- id: gha:long-lived-cloud-key
  rule: Use OIDC (or Trusted Publishing) instead of a stored long-lived key where the provider supports it.
  check: New secrets such as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, a GCP service-account JSON key, an Azure client secret, or a PyPI/npm API token used for cloud auth or publishing.
  tools: zizmor use-trusted-publishing (publishing only).
  section: "## Cloud credentials"

- id: gha:oidc-trust-unscoped
  rule: The cloud trust policy pins the `sub` claim.
  check: OIDC trust policy (IaC in the diff) with no `sub` condition, or a wildcard such as `repo:org/repo:*` on a role that deploys or writes.
  tools: none (not in workflow YAML).
  section: "## Cloud credentials"

- id: gha:cache-in-release
  rule: Release and publish workflows restore no cache.
  check: Workflow triggered by tags, `release`, or a publish/deploy job using `actions/cache` or a setup action with caching on (`cache:` input on setup-node/setup-python/setup-go, `enable-cache: true`).
  tools: zizmor cache-poisoning.
  section: "## Caches and artifacts"

- id: gha:privileged-cache-write
  rule: Do not write caches from `pull_request_target` or `workflow_run` runs that touch untrusted data.
  check: Cache-saving step in a `pull_request_target`/`workflow_run` job that also checks out or processes PR content.
  tools: zizmor cache-poisoning.
  section: "## Caches and artifacts"

- id: gha:self-hosted-public
  rule: No self-hosted runner on a public repository for any workflow a pull request can trigger.
  check: `runs-on: self-hosted` (or a self-hosted label/group) in a workflow with `pull_request`, `pull_request_target`, `issue_comment` or `workflow_run` in a public repository; for private repos, runners that are not ephemeral.
  tools: zizmor self-hosted-runner (pedantic only).
  section: "## Runners"

- id: gha:failure-step-without-status-function
  rule: A step meant to run after a failure includes `failure()` or `!cancelled()`.
  check: Notification, cleanup, log-upload or teardown step whose `if:` has no status function.
  tools: none.
  section: "## Conditions"

- id: gha:always-on-critical-step
  rule: Use `!cancelled()` instead of `always()` for steps that must not run after cancellation.
  check: `if: always()` on a deploy, publish, release, upload or source-fetch step.
  tools: none.
  section: "## Conditions"

- id: gha:output-as-boolean
  rule: Never use a step output directly as a boolean or a number.
  check: `if: steps.x.outputs.flag` or `needs.x.outputs.flag` with no comparison; numeric `<`/`>` on an output without `fromJSON()`.
  tools: actionlint strict comparison checks cover some typed cases; by hand otherwise.
  section: "## Conditions"

- id: gha:if-block-scalar
  rule: No `if: |` or `if: >` block scalar around `${{ }}`.
  check: `if:` followed by a YAML block scalar containing a `${{ }}` expression.
  tools: zizmor unsound-condition; actionlint constant conditions (unverified detail).
  section: "## Conditions"

- id: gha:contains-on-string
  rule: `contains()` takes a list, not a comma-joined string.
  check: `contains('a,b,c', <expr>)` or `contains(<string literal>, github.ref)`.
  tools: zizmor unsound-contains.
  section: "## Conditions"

- id: gha:falsy-ternary
  rule: A `cond && X || Y` pseudo-ternary never has a falsy `X`.
  check: `&& ''`, `&& 0`, `&& false` or `&& null` followed by `||`.
  tools: zizmor unsound-ternary.
  section: "## Conditions"

- id: gha:gate-job-skips
  rule: A gate job that aggregates others uses `if: always()` (or `!cancelled()`) and checks `needs.<job>.result`.
  check: Job named or used as a required check with `needs:` and no status function, or one that does not fail when a needed job's `result` is `failure` or `cancelled`.
  tools: none.
  section: "## Jobs, needs and outputs"

- id: gha:filtered-required-check
  rule: Never make a workflow with `paths`, `paths-ignore` or `branches` filters a required check.
  check: Workflow with trigger-level filters whose job names appear in branch protection or rulesets as required. Needs the ruleset; if unknown, put it under missing context.
  tools: none.
  section: "## Jobs, needs and outputs"

- id: gha:concurrency-group-unscoped
  rule: A concurrency group includes `github.workflow`, and `github.head_ref` has a fallback.
  check: `concurrency.group` without `github.workflow` (e.g. only `${{ github.ref }}`); `github.head_ref` used without `|| github.run_id` in a workflow with non-`pull_request` triggers.
  tools: zizmor concurrency-limits covers absence only (pedantic).
  section: "## Concurrency, matrix and timeouts"

- id: gha:timeout-missing
  rule: Every job sets `timeout-minutes`.
  check: Job without `timeout-minutes` (default 360).
  tools: none.
  section: "## Concurrency, matrix and timeouts"

- id: gha:cache-key-static
  rule: A cache key includes the hash of the lockfile it caches.
  check: `actions/cache` `key:` with no `hashFiles(...)` of the lockfile; `restore-keys` ordered from least to most specific.
  tools: none.
  section: "## Cost and speed"

## silences
A design document or PR description must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: gha:privileged-trigger-unjustified
  rule: Each use of `pull_request_target` or `workflow_run` states why `pull_request` is not enough and which untrusted data crosses into it.
  check: New or changed privileged trigger with no stated reason and no list of the event fields or artifacts it reads.
  section: "## Privileged triggers"

- id: gha:no-action-updater
  rule: An updater for action pins exists.
  check: Repository with SHA-pinned actions and no `dependabot.yml` `github-actions` entry and no Renovate config that manages them (with `helpers:pinGitHubActionDigests` for digests).
  section: "## Third-party actions"

- id: gha:no-codeowners-workflows
  rule: `.github/workflows` has a CODEOWNERS entry.
  check: No CODEOWNERS file, or one with no pattern covering `.github/workflows`.
  section: "## Third-party actions"

- id: gha:expensive-runner-unjustified
  rule: Expensive runners are justified per trigger.
  check: macOS or Windows job on every `pull_request` or `push` with no stated reason Linux does not cover it.
  section: "## Cost and speed"

- id: gha:triggers-unscoped
  rule: Triggers are scoped.
  check: Unfiltered `push` together with `pull_request` (double runs per PR commit).
  section: "## Cost and speed"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: gha:label-gate-or-split
  rule: Label-gated `pull_request_target` vs the `pull_request` + `workflow_run` split.
  options: label gate (quick to add, race between approval and a new push, depends on a human reading every diff) | split workflows (no PR code with secrets, two files and an artifact contract to validate)
  section: "## Privileged triggers"

- id: gha:pin-first-party
  rule: SHA pins for first-party `actions/*` too, or tags for them.
  options: hash-pin everything (immune to retagging, matches zizmor and Scorecard defaults, needs an updater) | tags for `actions/*` (less churn, trusts GitHub's own tags, zizmor needs config to allow it)
  section: "## Third-party actions"

- id: gha:environment-reviewers
  rule: Deployment secrets behind an environment with required reviewers.
  options: required reviewers (secrets unreachable until approval, a human in every deploy) | no reviewers (fully automated, a compromised workflow reaches deploy secrets directly)
  section: "## Secrets"

- id: gha:deploy-cancel-or-queue
  rule: `cancel-in-progress` on deploys.
  options: cancel-in-progress (latest commit wins quickly, a deploy can stop part-way) | `queue: max` (every deploy completes in order, slower to reach the latest) | conditional expression (cancel on PR refs, queue on main/release)
  section: "## Concurrency, matrix and timeouts"

- id: gha:fail-fast
  rule: Matrix `fail-fast` default vs `false`.
  options: fail-fast true (stops spending minutes at the first failure, hides which other legs fail) | fail-fast false (full compatibility picture, pays for every leg)
  section: "## Concurrency, matrix and timeouts"

- id: gha:reusable-or-composite
  rule: Reusable workflow vs composite action.
  options: reusable workflow (multiple jobs, own runners, can use secrets, per-job logs, must be a whole job) | composite action (steps inside the caller's job, steps before and after, one log step, cannot use secrets)
  section: "## Reuse"
