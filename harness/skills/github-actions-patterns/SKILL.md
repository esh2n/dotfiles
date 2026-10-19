---
name: github-actions-patterns
description: Use when writing or reviewing GitHub Actions — `.github/workflows/*.yml`, composite actions (`action.yml`), or reusable workflows — and when judging privileged triggers (`pull_request_target`, `workflow_run`), `${{ }}` expansion in `run:`, `permissions:`, action pinning, secrets, OIDC, caches and artifacts, self-hosted runners, `concurrency`, `if:` conditions, matrix, `needs` and outputs, path filters against required checks, `timeout-minutes`, runner cost, or Dependabot/Renovate for actions.
metadata:
  namespaces: [platform/infra]
---

# GitHub Actions Patterns

Judgment criteria for workflow files. A workflow is code that runs with the
repository's token and secrets, triggered by people who may not be trusted;
every review starts from who can trigger it and what it can reach.

`security-reviewer` owns the attack framing (attacker, capability, path,
impact) and carries a one-line summary of the workflow checks; this skill
holds the detailed criteria it points to. `code-reviewer` reads the
correctness, cost and maintainability sections.

## Run the tools first

`change-review` runs `zizmor .github/workflows` when installed. Run
`actionlint` too when installed. Read their output before reading the diff by
hand and do not re-report what they already reported; review by hand only
what no tool covers, and name a tool that did not run as not run.

| Concern | zizmor audit (https://docs.zizmor.sh/audits/) | actionlint check (https://github.com/rhysd/actionlint/blob/main/docs/checks.md) | OpenSSF Scorecard (https://github.com/ossf/scorecard/blob/main/docs/checks.md) |
| --- | --- | --- | --- |
| privileged trigger + untrusted checkout | `dangerous-triggers` (flags the trigger, not the checkout path) | — | Dangerous-Workflow |
| `${{ }}` injection in `run:` | `template-injection` | script injection by untrusted inputs | Dangerous-Workflow |
| token permissions | `excessive-permissions`, `undocumented-permissions` (pedantic) | permissions keys (validation only) | Token-Permissions |
| unpinned `uses:` | `unpinned-uses` (hash-pin for all actions by default since v1.20.0), `impostor-commit`, `ref-confusion`, `ref-version-mismatch` | action format only | Pinned-Dependencies |
| unpinned container images | `unpinned-images` | — | Pinned-Dependencies |
| known-vulnerable or archived actions | `known-vulnerable-actions`, `archived-uses` | outdated popular actions (runtime only) | — |
| secrets exposure | `secrets-inherit`, `overprovisioned-secrets`, `unredacted-secrets`, `secrets-outside-env` (auditor persona) | hardcoded credentials | — |
| persisted checkout token | `artipacked` | — | — |
| cache poisoning | `cache-poisoning` | — | — |
| `GITHUB_ENV` / `GITHUB_PATH` writes | `github-env` | — | — |
| self-hosted runners | `self-hosted-runner` (pedantic) | runner labels (validity only) | — |
| spoofable bot checks | `bot-conditions` | — | — |
| `if:` always true, unsound `contains`, falsy ternary | `unsound-condition`, `unsound-contains`, `unsound-ternary` | constant conditions at `if:` (heading only, unverified detail) | — |
| expression types, `needs`/`steps`/`matrix` references, cycles | — | type checks, contextual typing, job dependency validation, matrix values | — |
| `concurrency` absent | `concurrency-limits` (pedantic) | — | — |
| `run:` script bugs | — | shellcheck and pyflakes integration | — |
| long-lived publish tokens | `use-trusted-publishing` | — | — |

zizmor did not audit composite actions at the time of the Ultralytics
compromise, which is how the injection there went unflagged
(https://blog.yossarian.net/2024/12/06/zizmor-ultralytics-injection); read
`action.yml` `run:` steps by hand unless the tool output shows they were
covered.

## Privileged triggers

**[defect] Never run pull request code under `pull_request_target` or
`workflow_run`.** Both run with secrets and a write-capable token even when the
pull request comes from a fork; `pull_request_target` runs the base branch's
workflow, so the workflow file is trusted but anything it checks out from the
head is not (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows,
https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).
"Running code" includes build scripts and `package.json` install hooks
(https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/);
a Makefile, a test suite, and a local action at `./` from the checked-out head
are the same case.
Look for `actions/checkout` with `ref:` set to
`github.event.pull_request.head.sha`, `.head.ref`, `github.head_ref`,
`github.event.workflow_run.head_sha`, or a `refs/pull/*/merge` ref, followed by any step that executes repository content.

The accepted shape is a split: an unprivileged `pull_request` workflow runs the
untrusted code and uploads results as an artifact; a `workflow_run` workflow
with write access downloads the artifact and acts on it
(https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

**[defect] Artifacts from an unprivileged run are untrusted input.** In the
privileged consumer: validate every value read from them (a PR number is an
integer), never execute their contents, and extract outside the workspace so
they cannot overwrite scripts later steps run
(https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/;
GitHub's own guidance says the same for `workflow_run`:
https://docs.github.com/en/actions/reference/security/secure-use).

**[trade-off] Label gating is a stopgap.** A "safe to test" label limits who
triggers the run, but an attacker can push a new commit between approval and
the run, and the gate depends on a human reading every diff
(https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

A fix to a privileged workflow does not reach pull requests opened before it;
those keep the old workflow version until closed or rebased
(https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

**[silence] Each use of `pull_request_target` or `workflow_run` states why
`pull_request` is not enough and which untrusted data crosses into it.** GitHub
advises avoiding `pull_request_target` unless necessary
(https://docs.github.com/en/actions/reference/security/secure-use).

## Untrusted input and expression injection

**[defect] Never expand attacker-controlled `${{ }}` inside `run:`.** The
runner substitutes the expression into the script text before the shell
parses it, so a value containing a quote and a command runs that command
(https://securitylab.github.com/resources/github-actions-untrusted-input/).
Attacker-controlled fields include issue and PR title and body, comment and
review body, commit messages and author names and emails, `head_commit.*`,
`pull_request.head.ref`, `.head.label`, `.head.repo.default_branch`, page
names, and `github.head_ref` (same source). The fix is to pass the value
through `env:` and reference `"$VAR"` quoted in the script, or to hand it to a
JavaScript action as an input
(https://docs.github.com/en/actions/reference/security/secure-use). The same
applies to the `script:` of `actions/github-script` and to `run:` steps inside
composite actions, where inputs are expanded the same way; the Ultralytics
entry point was `github.head_ref` expanded into a `git pull` line in a
composite action (https://blog.yossarian.net/2024/12/06/zizmor-ultralytics-injection).

**[defect] Never write untrusted data to `GITHUB_ENV` or `GITHUB_PATH` in a
privileged workflow.** Control of `GITHUB_ENV` sets variables such as
`LD_PRELOAD` for every later step; control of `GITHUB_PATH` shadows binaries
such as `ssh`; pass step state through `GITHUB_OUTPUT` instead
(https://docs.zizmor.sh/audits/#github-env). For multiline values written to
`GITHUB_ENV` or `GITHUB_OUTPUT` with the `name<<DELIM` form, the delimiter must
not appear on its own line in the value; an arbitrary value goes to a file
instead (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands).
A fixed delimiter around attacker text lets the attacker close it and add
variables.

**[defect] Never gate a privileged step on `github.actor` being a bot.**
Checks like `github.actor == 'dependabot[bot]'` are spoofable
(https://docs.zizmor.sh/audits/#bot-conditions).

## Token permissions

**[defect] Declare `permissions:` at the top of every workflow, read-only, and
raise scopes per job.** Without the key the workflow inherits the repository
or organisation default, which may be read/write; setting any scope sets every
unlisted scope to `none`, and `permissions: {}` drops all
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
Scorecard's best score requires read-only at the top level and writes only at
job level, and treats `contents`, `packages` and `actions` writes as sensitive
(https://github.com/ossf/scorecard/blob/main/docs/checks.md#token-permissions).
Never `write-all`. `id-token: write` belongs only on the job that requests an
OIDC token.

A token is reachable by any action through `github.token` even when it is not
passed explicitly
(https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token),
so third-party actions in a job inherit that job's scopes.

**[defect] `actions/checkout` sets `persist-credentials: false` unless a later
step runs `git` with the token.** The default is `true`; the credential is
written to disk (`.git/config` before v6, a file under `$RUNNER_TEMP` from v6)
and can be read by any later step or swept into an uploaded artifact
(https://github.com/actions/checkout, https://docs.zizmor.sh/audits/#artipacked).

## Third-party actions

**[defect] Pin every action outside the repository to a full 40-character
commit SHA.** A tag can be moved or deleted
(https://docs.github.com/en/actions/reference/security/secure-use). In March
2025 the attacker behind CVE-2025-30066 repointed every tag of
`tj-actions/changed-files` to a commit that dumped runner memory, printing
secrets into public workflow logs; workflows pinned to a full SHA were not
affected (https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066).
zizmor's default policy since v1.20.0 hash-pins first-party `actions/*` too
(https://docs.zizmor.sh/audits/#unpinned-uses); Scorecard asks for SHA pins on
all actions (https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies).
Check that the SHA belongs to the action's own repository, not a fork
(https://docs.github.com/en/actions/reference/security/secure-use; zizmor
`impostor-commit`), and keep a `# vX.Y.Z` comment after the SHA so updaters can
move it: Renovate leaves bare-SHA pins without a version comment alone by
default (https://docs.renovatebot.com/modules/manager/github-actions/). GitHub
now names a workflow dependency lockfile as stronger than SHA pinning where it
is adopted (https://docs.github.com/en/actions/reference/security/secure-use).

Pin container images in `container:` and `services:` by digest
(https://docs.zizmor.sh/audits/#unpinned-images,
https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies).

**[trade-off] SHA pins for first-party `actions/*` too, or tags for them.**
GitHub's guide allows a tag when the creator is trusted
(https://docs.github.com/en/actions/reference/security/secure-use); zizmor and
Scorecard default to pinning everything.

**[silence] An updater for action pins exists.** SHA pins without Dependabot or
Renovate go stale and miss security fixes. Dependabot needs
`package-ecosystem: "github-actions"` with `directory: "/"`
(https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot),
and does not raise alerts for SHA-pinned actions
(https://docs.github.com/en/actions/reference/security/secure-use). Renovate
pins and updates digests with `helpers:pinGitHubActionDigests`
(https://docs.renovatebot.com/modules/manager/github-actions/).

**[silence] `.github/workflows` has a CODEOWNERS entry** so workflow changes
need a named reviewer (https://docs.github.com/en/actions/reference/security/secure-use).

## Secrets

**[defect] One secret per value; never a JSON, YAML or XML blob.** Redaction
matches the whole stored value, so fields of a structured secret can print in
clear (https://docs.github.com/en/actions/reference/security/secure-use,
https://docs.zizmor.sh/audits/#unredacted-secrets).

**[defect] Register derived values with `::add-mask::` before printing them.**
A Base64 or URL-encoded form, or a JWT signed with a secret, is not the
registered value and is not redacted
(https://docs.github.com/en/actions/reference/security/secure-use,
https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands).

**[defect] Pass each callee only the secrets it uses.** `secrets: inherit` in a
reusable-workflow call and `toJSON(secrets)` hand over every secret
(https://docs.zizmor.sh/audits/#secrets-inherit,
https://docs.zizmor.sh/audits/#overprovisioned-secrets).

**[defect] A secret never flows into a job output.** Outputs containing secrets
are redacted on the runner and not sent, so the downstream job receives
nothing (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Fork pull requests get no secrets other than a read-only `GITHUB_TOKEN`
(https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows);
a design that needs secrets on fork PRs is a privileged-trigger design and
falls under that section. A secret that appears unredacted in a log means
deleting the log and rotating the secret
(https://docs.github.com/en/actions/reference/security/secure-use).

**[trade-off] Deployment secrets behind an environment with required
reviewers.** A job cannot read environment secrets until a reviewer approves
(https://docs.github.com/en/actions/reference/security/secure-use); the cost is
a human in every deploy.

## Cloud credentials

**[defect] Use OIDC, not a stored long-lived key, for a cloud provider that
supports it.** The provider issues a token valid for one job, and no cloud
credential lives in GitHub secrets
(https://docs.github.com/en/actions/concepts/security/openid-connect,
https://docs.github.com/en/actions/reference/security/secure-use). Package
registries that support Trusted Publishing are the same case; the Ultralytics
second-round releases used a PyPI API token left over after Trusted Publishing
was adopted (https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/,
https://docs.zizmor.sh/audits/#use-trusted-publishing).

**[defect] The cloud trust policy pins the `sub` claim.** At least one
condition is required; AWS recommends evaluating `sub`; a wildcard such as
`repo:org/repo:*` lets every branch, PR merge ref and environment assume the
role (https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
Scope `sub` to an environment or a protected branch for roles that deploy.

## Caches and artifacts

**[defect] Release and publish workflows restore no cache.** A cache entry is
an archive extracted without checking its paths; anyone who can run code in a
default-branch workflow can write entries that later privileged runs restore,
and a poisoned release build keeps valid-looking provenance
(https://adnanthekhan.com/2024/05/06/the-monsters-in-your-build-cache-github-actions-cache-poisoning/).
Caches from the default branch are readable from every branch
(https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching),
and privileged triggers share the main-branch cache
(https://docs.github.com/en/actions/reference/security/secure-use). PyPI's
Ultralytics analysis names the build-phase Actions cache as the target and
tells publishers to remove shared caches from build and release
(https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/). Disable
caching in setup actions there (`package-manager-cache: false`,
`enable-cache: false`) or tie it to a non-release ref
(https://docs.zizmor.sh/audits/#cache-poisoning).

**[defect] Do not write caches from `pull_request_target` or `workflow_run`
runs that touch untrusted data** — they write into the default branch's scope
(https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows,
https://docs.zizmor.sh/audits/#cache-poisoning).

## Runners

**[defect] No self-hosted runner on a public repository for any workflow a
pull request can trigger.** Anyone can open a pull request and run code on the
machine (https://docs.github.com/en/actions/reference/security/secure-use).
Where self-hosted runners are used, they are ephemeral (just-in-time), start
clean, sit in a scoped runner group, and have limited network and data access
(same source).

## Conditions

**[defect] A step meant to run after a failure includes `failure()` or
`!cancelled()`.** An `if:` with no status function gets `success()` added, so
`if: env.NOTIFY == 'true'` never runs after a failed step
(https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).

**[defect] Use `!cancelled()` instead of `always()` for steps that must not run
after cancellation.** `always()` also runs on cancel; GitHub advises against it
for steps that can fail critically
(https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).

**[defect] Never use a step output directly as a boolean.** Outputs are
strings; only `''`, `0`, `-0`, `false` and `null` are falsy, so an output of
`"false"` is truthy; compare against the string or use `fromJSON()`, which is
also required for numeric comparison
(https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).
String comparison and `contains`/`startsWith` ignore case (same source).

**[defect] No `if: |` or `if: >` block scalar around `${{ }}`.** The block
scalar adds a trailing newline, the result is a non-empty string, and the
condition is always true (https://docs.zizmor.sh/audits/#unsound-condition).
An `if:` starting with `!` needs `${{ }}` or quoting
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

**[defect] `contains()` takes a list, not a comma-joined string.** A string
argument matches substrings and can be satisfied by a crafted ref
(https://docs.zizmor.sh/audits/#unsound-contains). **[defect]** A
`cond && X || Y` pseudo-ternary with a falsy `X` always yields `Y`
(https://docs.zizmor.sh/audits/#unsound-ternary).

## Jobs, needs and outputs

**[defect] A gate job that aggregates others uses `if: always()` (or
`!cancelled()`) and checks `needs.<job>.result`.** A failed or skipped job
skips every dependent unless a condition lets it run
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
and a skipped dependent may not block merging, so GitHub recommends `always()`
with `needs` for required checks
(https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).
A job skipped by its own `if:` reports success (same source).

**[defect] Never make a workflow with `paths`, `paths-ignore` or `branches`
filters a required check.** When the filter skips it, its checks stay Pending
and the pull request cannot merge
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax,
https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).
Filter inside the workflow instead (a changes job feeding job-level `if:`,
which reports success when skipped) and require the gate job. Path filters
also do not apply to tag pushes, and a diff over 3,000 files can skip the run
(workflow syntax, same URL).

## Concurrency, matrix and timeouts

**[defect] A concurrency group includes `github.workflow`.** A group of only
`${{ github.ref }}` cancels or queues runs of other workflows
(https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
**[defect]** `github.head_ref` is empty outside `pull_request` events; use
`github.head_ref || github.run_id` so push runs do not share one group (same
source). At most one run is running and one pending per group; a new pending
run replaces the old one even without `cancel-in-progress`
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

**[trade-off] `cancel-in-progress` on deploys.** `true` cancels the running
deploy when a newer commit arrives; `queue: max` runs them one at a time, and
the two cannot be combined
(https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
For pull request CI, cancelling superseded runs is the cheap default;
`cancel-in-progress` accepts an expression, so main or release refs can be
exempted (same source).

**[defect] Every job sets `timeout-minutes`.** The default is 360
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax);
a hung step bills six hours per job, rounded up per job to the minute
(https://docs.github.com/en/billing/reference/actions-minute-multipliers).
Set it from the job's observed duration with headroom.

**[trade-off] `fail-fast`.** It defaults to `true` and cancels the rest of the
matrix when one leg fails
(https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax):
cheaper, but a compatibility matrix then reports one failure and hides which
other legs also fail. `continue-on-error` lets the run pass with a failed job
(same source), so it hides failures from required checks.

## Cost and speed

**[defect] A cache key includes the hash of the lockfile it caches.** Caches are
immutable, so a static key keeps restoring the first saved contents forever;
`hashFiles('<lockfile>')` creates a new entry when dependencies change.
`restore-keys` are tried in order as prefixes; order them most to least
specific (https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
Entries unused for 7 days are evicted, with a 10 GB default per repository
(same source).

**[silence] Expensive runners are justified per trigger.** A macOS 3–4 core
minute costs about ten times a 2-core Linux minute, Windows about 1.7 times
(rates on https://docs.github.com/en/billing/reference/actions-minute-multipliers);
a macOS job on every pull request states why Linux does not cover it.

**[silence] Triggers are scoped.** An unfiltered `push` runs on any push to any
branch and tag, and `pull_request` runs on `opened`, `synchronize` and
`reopened` by default
(https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows);
both unfiltered means every pull request commit runs the workflow twice.
`schedule` runs on the default branch and is disabled after 60 days without
activity in public repositories (same source).

## Reuse

**[trade-off] Reusable workflow or composite action.**

| | Reusable workflow | Composite action |
| --- | --- | --- |
| Contains | jobs, each with its own runner | steps, on the caller's runner |
| Secrets | can use them | cannot |
| Logs | per job and step | one step in the caller |
| Placement | a whole job; nothing follows it in that job | a step; steps can run before and after |
| Nesting | up to 10 levels | up to 10 composite actions per workflow |

(https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations)
Choose a reusable workflow for multiple jobs, secrets or a different runner;
a composite action to bundle steps inside a job (same source). Either way,
inputs expanded into `run:` follow the injection rule above.

## Incidents

- tj-actions/changed-files, March 2025, CVE-2025-30066: tags repointed after a
  bot's personal access token was compromised; secrets printed to public logs;
  SHA pins safe; `reviewdog/action-setup` also compromised
  (https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066).
- Ultralytics, December 2024: `pull_request_target` workflow, branch name
  expanded into a shell in a composite action, likely cache poisoning into the
  release build, then a leftover PyPI token; versions 8.3.41, 8.3.42, 8.3.45,
  8.3.46 removed (https://blog.yossarian.net/2024/12/06/zizmor-ultralytics-injection,
  https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/). The
  cache step is the author's inference, not confirmed.

## Related

- `security-reviewer` (agent) — attack framing and calibration for the
  security items here.
- `shell-patterns` — the scripts inside `run:`.
- `change-review` — runs zizmor and passes its output on.
