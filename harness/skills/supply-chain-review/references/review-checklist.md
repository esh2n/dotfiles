# supply-chain-review — review checklist

Derived from ../SKILL.md. Read by `security-reviewer` (name and origin, install-time code, lock-file integrity, vulnerabilities, provenance, base images) and `code-reviewer` (need, pins, lock-file hygiene, vendoring, licences) through the `change-review` skill when a diff adds, removes or upgrades a dependency, changes a lock file (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, uv.lock, poetry.lock, Gemfile.lock, composer.lock, flake.lock), a Dockerfile base image, a vendored copy, an install script or a licence file (defects; silences and trade-offs in a design or spec review), and by `grilling` (trade-offs). Read osv-scanner output first, and govulncheck, cargo audit or npm audit output when the brief carries it: an item whose `tools:` line names a tool that ran is reported by that tool, not again by hand. No tool that resolves or runs project code is run without `JIG_REVIEW_EXEC=1` (`security-reviewer` Execution Policy). Action pinning is in `github-actions-patterns/references/review-checklist.md`. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: supply:name-not-intended
  rule: The added name is the intended package.
  check: New dependency whose name is one edit away from a popular package, has a more popular similarly named package, was created recently, or whose repository link does not match the project the PR describes.
  tools: none (Scorecard and deps.dev give context, not a verdict).
  section: "## Name and origin"

- id: supply:dependency-confusion
  rule: Internal package names cannot resolve from a public registry.
  check: Unscoped npm name for an internal package; no committed `.npmrc` mapping the scope; a registry that merges public manifests or falls back to public; uv `index-strategy` changed from `first-index` or an internal index not `explicit` with `tool.uv.sources`; pip `--extra-index-url` for an internal index without hashes; Go private module path not in `GOPRIVATE`.
  tools: none.
  section: "## Name and origin"

- id: supply:exotic-transitive-source
  rule: A transitive dependency from git or a tarball URL is a finding.
  check: Lock-file entry for a non-direct dependency whose `resolved`/source is a git URL or tarball URL; pnpm `blockExoticSubdeps: false`.
  tools: pnpm blocks it by default (`blockExoticSubdeps`); otherwise none.
  section: "## Name and origin"

- id: supply:install-script-unreviewed
  rule: A new install-time script is read before it is approved.
  check: pnpm `allowBuilds` entry set to `true`; `dangerouslyAllowAllBuilds: true`; `strictDepBuilds: false`; Composer `allow-plugins` entry `true` or the whole key `true`; a new dependency with `preinstall`/`install`/`postinstall`, `binding.gyp`, `build.rs`, an sdist-only Python package, or a native-extension gem — with no note of what the script does.
  tools: pnpm `strictDepBuilds` fails the install on unreviewed builds; Composer prompts for unlisted plugins; otherwise none.
  section: "## Install-time code"

- id: supply:build-approval-wildcard
  rule: An approval is scoped to the package, not a wildcard.
  check: `allowBuilds` or `allow-plugins` pattern broader than one package (`*`, `@scope/*` for third-party scopes); a git or tarball dependency approved by bare name.
  tools: none.
  section: "## Install-time code"

- id: supply:lockfile-missing-or-unsynced
  rule: An application or service commits its lock file, and the lock file changes with the manifest.
  check: Manifest change (package.json, go.mod, Cargo.toml, pyproject.toml, Gemfile, composer.json, flake.nix) with no lock-file change; lock file in `.gitignore` for an application; CI using `npm install` instead of `npm ci`.
  tools: `npm ci` fails on a mismatched lock; `go` refuses an incomplete go.mod/go.sum; otherwise none.
  section: "## Lock files"

- id: supply:lockfile-integrity-change
  rule: A lock-only change to a resolved URL, registry host, hash for the same version, or source kind is a finding until explained.
  check: Same package and version with a changed `integrity`, `checksum`, `h1:` or `narHash`; `resolved` moved to another host; registry source replaced by git or tarball.
  tools: none (scanners match versions, not hashes).
  section: "## Lock files"

- id: supply:unbounded-range
  rule: No wildcard or unbounded range in a published library or build tool config.
  check: `*`, `latest`, `x`, or `>=` with no upper bound in a dependency declaration.
  tools: crates.io rejects `*` at publish; otherwise none.
  section: "## Version ranges and pins"

- id: supply:known-vulnerable-version
  rule: The change does not add or keep a version with a known vulnerability reported for the changed package, unless the reason it does not apply is stated.
  check: Scanner output lists an advisory for a package the diff adds or moves; no stated reason (unreachable per govulncheck, not shipped).
  tools: osv-scanner; govulncheck (Go, reachability); cargo audit (Rust); npm audit and pip-audit only under the Execution Policy.
  section: "## Known vulnerabilities"

- id: supply:signature-identity-unchecked
  rule: A signature check verifies the expected identity, not only a valid signature.
  check: `cosign verify` or an equivalent step with no expected signer identity configured; a verification step that only checks that a signature is valid.
  tools: none.
  section: "## Provenance and signatures"

- id: supply:slsa-claim-vague
  rule: A SLSA claim names the track and the platform that meets it.
  check: README, PR or policy claiming "SLSA L3" (or L4) without Build/Source track and builder named; any Build L4 claim.
  tools: none.
  section: "## Provenance and signatures"

- id: supply:base-image-not-digest
  rule: A production Dockerfile `FROM` pins by digest, with an updater.
  check: `FROM image:tag` or `FROM image` with no `@sha256:`; a digest pin with no Dependabot `docker` entry or Renovate config.
  tools: Scorecard Pinned-Dependencies; Docker Scout "No outdated base images" policy.
  section: "## Container base images"

- id: supply:vendored-notice-missing
  rule: Vendored or copied code keeps its licence notice and records its origin.
  check: New `vendor/`, `third_party/` or copied file with no LICENSE/NOTICE or header, or no upstream URL and commit.
  tools: none.
  section: "## Vendored copies"

- id: supply:reference-copied
  rule: Reference material is cited, not copied.
  check: A file or long block pasted from a shared reference repo, URL or doc with no adaptation and no citation.
  tools: none.
  section: "## Vendored copies"

- id: supply:licence-not-spdx
  rule: Licences are stated as SPDX identifiers, GNU ones as `-only` or `-or-later`.
  check: `license` field with free text, or a bare GNU id such as `GPL-3.0` or `GPL-3.0+` instead of the `-only`/`-or-later` form.
  tools: none.
  section: "## Licences"

- id: supply:licence-change-unflagged
  rule: A new or upgraded dependency's licence is checked against policy, and a licence change in an upgrade is called out.
  check: Upgrade crossing a release where the licence moved (for example MPL-2.0 to BUSL-1.1, or to SSPL-1.0 or Elastic-2.0); new dependency under AGPL/GPL/SSPL/BUSL in a project whose policy does not allow it; no mention in the PR.
  tools: osv-scanner `--licenses=<allowlist>`; cargo deny licences.
  section: "## Licences"

## silences
A design document or PR description must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: supply:need-unstated
  rule: A new direct dependency states why existing code, the standard library or an existing dependency does not cover it.
  check: New direct dependency with no reason in the PR.
  tools: none.
  section: "## Need"

- id: supply:transitive-tree-unstated
  rule: A large transitive tree from a new dependency is named.
  check: Lock-file diff adds many new entries for one new direct dependency, or dev dependencies in production scope, with no mention.
  tools: none.
  section: "## Need"

- id: supply:lock-only-origin-unstated
  rule: A lock-only diff states what produced it and which direct dependency moved.
  check: Lock file changed with no manifest change and no bot author or stated command.
  tools: none.
  section: "## Lock files"

- id: supply:no-dependency-updater
  rule: A dependency updater exists for manifests and base images.
  check: Repository with lock files or digest-pinned images and no Dependabot or Renovate config covering them.
  tools: Scorecard Dependency-Update-Tool.
  section: "## Version ranges and pins"

- id: supply:ignore-entry-unexplained
  rule: An advisory ignore names the advisory id, the reason and an expiry.
  check: New osv-scanner ignore, `cargo deny` advisory ignore, or audit allowlist entry missing any of the three.
  tools: none.
  section: "## Known vulnerabilities"

- id: supply:publish-token-unexplained
  rule: The project's publish workflow uses trusted publishing, or states why a token is used.
  check: Publish job using `NPM_TOKEN`, `PYPI_TOKEN` or similar long-lived secret where npm or PyPI trusted publishing is available.
  tools: none.
  section: "## Provenance and signatures"

- id: supply:vendored-update-path-unstated
  rule: A vendored copy states how it is updated.
  check: New vendored code with no update procedure or tool.
  tools: none (lock-file scanners do not see vendored code).
  section: "## Vendored copies"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: supply:maintenance-vs-fit
  rule: Maintenance signals versus fit for a new dependency.
  options: take it despite low Scorecard or one maintainer (solves the problem now, bus-factor and takeover risk accepted) | choose a better-maintained alternative (lower risk, may fit worse) | write or copy the small part needed (no new supplier, code to maintain)
  section: "## Need"

- id: supply:release-age-delay
  rule: Enable a release-age delay (pnpm `minimumReleaseAge`, npm `min-release-age`).
  options: delay on (most hijacked versions are removed before they install, security fixes also wait) | delay off (fixes immediately, exposed to minutes-old malicious releases) | delay with exclusions for internal scopes (balance, list to maintain)
  section: "## Install-time code"

- id: supply:trust-policy
  rule: pnpm `trustPolicy: no-downgrade`.
  options: on (catches a release published from a stolen token, fails when a maintainer changes CI) | off (no false failures, no trust-downgrade signal)
  section: "## Install-time code"

- id: supply:range-or-pin
  rule: Range or exact pin, by ecosystem convention.
  options: ranges in libraries with the lock file pinning applications (consumers dedupe, lock carries the hash pin) | exact pins everywhere (explicit, more update churn, duplicate versions for consumers)
  section: "## Version ranges and pins"

- id: supply:require-provenance
  rule: Require provenance or attestations for dependencies.
  options: require (ties packages to source and build, excludes packages without it, does not prove absence of malice) | record only (`npm audit signatures` as information) | ignore
  section: "## Provenance and signatures"

- id: supply:sbom
  rule: Generate an SBOM.
  options: generate (a named consumer — customer, regulator, vulnerability pipeline — can query it) | skip (no build time or artifact to keep accurate when nobody reads it)
  section: "## SBOM"

- id: supply:copyleft-dependency
  rule: Accept a copyleft dependency.
  options: accept (obligations depend on conveying, network service or internal use; owner and legal decide) | replace with a permissive alternative (no obligations, may cost features) | isolate as a separate program (aggregate rather than combined work)
  section: "## Licences"
