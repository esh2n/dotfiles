---
name: supply-chain-review
description: Use when a change adds, removes or upgrades a dependency, changes a lock file (package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, uv.lock, poetry.lock, Gemfile.lock, composer.lock, flake.lock), a Dockerfile base image, a vendored copy, an install or build script, or a licence file — and when judging whether a new dependency is needed, typosquatting and dependency confusion, install-time scripts (npm lifecycle scripts, pnpm allowBuilds, Python build backends, Cargo build.rs), version ranges versus pins, which vulnerability scanner to trust first, provenance and signatures (npm trusted publishing, Sigstore, SLSA), SBOMs, or licence obligations (GPL, AGPL, LGPL, MPL, BSL, SSPL).
metadata:
  namespaces: [practice]
---

# Supply Chain Review

Judgment criteria for changes to what a project pulls in from outside. A
dependency is code that runs with the project's privileges at install, build
or run time, published by people the project does not employ; every review
starts from what new code now runs, from where, and who could change it.
Sources checked 2026-10-19.

`security-reviewer` owns the attack framing (attacker, capability, path,
impact) and its Execution Policy: no tool that resolves or runs project code
is run without `JIG_REVIEW_EXEC=1`. `code-reviewer` reads the need, pinning,
lock-file and licence sections. Action pinning in workflows belongs to
`github-actions-patterns` ("## Third-party actions"); this skill does not
repeat it.

## Run the tools first

The `change-review` skill runs `osv-scanner scan source -r .` when installed
and passes its output on. Read that output before reading the diff by hand;
an item whose `tools:` line names a tool that ran is reported by that tool,
not again. A tool that did not run is named as not run.

Order, from least to most execution:

1. **osv-scanner** reads lock files statically, covering package-lock.json,
   pnpm-lock.yaml, yarn.lock, bun.lock, go.mod, Cargo.lock, uv.lock,
   poetry.lock, pylock.toml, Gemfile.lock and composer.lock, among others; it
   does not list flake.lock
   (https://google.github.io/osv-scanner/supported-languages-and-lockfiles/).
   With `--licenses=<SPDX ids>` it also flags licences outside an allowlist,
   using deps.dev data (https://google.github.io/osv-scanner/usage/license-scanning/).
2. **govulncheck** (Go) in source mode reports only vulnerabilities whose
   functions the code can reach, with call stacks; binary mode has no call
   graph and over-reports; calls through `reflect` are invisible, so a "not
   reachable" result is not proof
   (https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck,
   https://go.dev/doc/security/vuln/). Prefer its verdict over a version-range
   match for Go modules.
3. **cargo audit** reads Cargo.lock against the RustSec database, which is also
   exported to OSV; `cargo deny` adds licence, source and duplicate-version
   checks (https://rustsec.org/).
4. **npm audit** sends package names and versions to the registry, needs a lock
   file, and matches by version range with no reachability
   (https://docs.npmjs.com/cli/v11/commands/npm-audit). `npm audit fix` runs a
   full install. Run only under the Execution Policy.
5. **pip-audit -r** is functionally a `pip install` of the requirements; its
   own README says not to audit what you would not install, and that it does
   not detect malicious packages (https://github.com/pypa/pip-audit). Under
   the Execution Policy only; prefer osv-scanner on uv.lock or poetry.lock.

No scanner here finds a malicious package published minutes ago: advisories
lag publication. That gap is what release-age delays (below) and
install-script gating cover.

## Need

**[silence] A new direct dependency states why existing code, the standard
library or an existing dependency does not cover it.** Each dependency adds
attack surface; the OpenSSF guide opens by asking whether it is needed at all
(https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software).
Go's own guidance prefers a little copying to a little dependency
(https://go.dev/blog/supply-chain).

**[trade-off] Maintenance signals versus fit.** The OpenSSF guide asks for
activity in the past 12 months, more than one maintainer, a non-0.x stable
version, a security policy and tests in CI, and says a good project can still
fail some of these (https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software).
Scorecard measures them: Maintained (at least one commit a week over 90 days
for full score), Contributors (contributors from at least three companies in
the last 30 commits), Code-Review, Security-Policy, Signed-Releases,
Vulnerabilities (via OSV), License
(https://github.com/ossf/scorecard/blob/main/docs/checks.md). A low score is a
question for the owner, not a defect; a single maintainer is a bus-factor risk
the owner accepts or avoids.

**[silence] The new dependency's own transitive tree is named when it is
large.** The guide asks whether a package pulls in unnecessary indirect
dependencies, especially development ones in production
(https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software).
Read the lock-file diff for the count of new entries.

## Name and origin

**[defect] The added name is the intended package.** Check the name against
the project the author meant: a near-identical name, a more popular similarly
named package, a recent creation date, or a repository link that does not
match are typosquatting signals
(https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software,
https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md).

**[defect] Internal package names cannot resolve from a public registry.**
Dependency confusion: an attacker publishes the internal name publicly with a
higher version. Defences per ecosystem:

| Ecosystem | Defence |
| --- | --- |
| npm, pnpm, yarn | Scoped names (`@org/x`), the scope registered on the public registry, the scope mapped to the internal registry in a committed `.npmrc` with no credentials, no registry that merges public manifests, no fallback to public when a private package disappears (https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md) |
| uv | Default `index-strategy` `first-index` stops at the first index that has the name; `explicit = true` indexes serve only packages pinned to them in `tool.uv.sources` (https://docs.astral.sh/uv/concepts/indexes/) |
| pip | Hash-checking mode (`--require-hashes`) pins every artifact (https://pip.pypa.io/en/stable/topics/secure-installs/); `--extra-index-url` merges indexes [unverified: no primary source opened in this run states the merge risk] |
| Go | `GOPRIVATE` patterns skip the public proxy and checksum database for private paths (https://go.dev/ref/mod) |

A 404 from the registry during install is a signal to fix, not to suppress
(https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md).

**[defect] A transitive dependency from git or a tarball URL is a finding.**
pnpm's `blockExoticSubdeps` (default `true`) allows such sources only for
direct dependencies (https://pnpm.io/settings/dependency-resolution); in other
ecosystems read `resolved` URLs in the lock-file diff.

## Install-time code

What runs when the dependency is installed or built, before any test:

| Ecosystem | Runs at install or build | Gate |
| --- | --- | --- |
| npm | `preinstall`, `install`, `postinstall`, `prepare` of packages; `node-gyp rebuild` when `binding.gyp` exists and no install script is set (https://docs.npmjs.com/cli/v11/using-npm/scripts) | `ignore-scripts` (default `false`); explicit `npm run` still works (https://docs.npmjs.com/cli/v11/using-npm/config) |
| pnpm | Dependency build scripts only when approved | `allowBuilds` (v10.26+) map; unlisted packages are unreviewed and skipped; `strictDepBuilds` (default `true`) fails the install on unreviewed builds; `dangerouslyAllowAllBuilds` (default `false`) approves everything; `onlyBuiltDependencies`/`neverBuiltDependencies` removed in v11; `pnpm approve-builds` writes approvals (https://pnpm.io/settings/build) |
| Python | The build backend of an sdist runs to make a wheel; a wheel installs without a build (https://packaging.python.org/en/latest/discussions/package-formats/) | `--only-binary :all:` refuses sdists (https://pip.pypa.io/en/stable/topics/secure-installs/) |
| Cargo | `build.rs` of each package (and its `build-dependencies`) compiles and runs on the build host before the package compiles (https://doc.rust-lang.org/cargo/reference/build-scripts.html); proc macros run inside the compiler [unverified: not stated on the page opened] | none in Cargo |
| Go | Neither fetch nor build runs dependency code; `init` functions run at program start (https://go.dev/blog/supply-chain) | — |
| Composer | Only the root package's scripts (https://getcomposer.org/doc/articles/scripts.md); plugins run code and load only if listed in `allow-plugins`, default `{}` since 2.2 (https://getcomposer.org/doc/06-config.md) | `allow-plugins` |
| RubyGems | A gem with a native extension builds it at install (`extconf.rb`) (https://guides.rubygems.org/gems-with-extensions/) | precompiled gems |

**[defect] A new install-time script is read before it is approved.** A diff
that adds a package to pnpm `allowBuilds` with `true`, adds a Composer plugin
to `allow-plugins`, sets `dangerouslyAllowAllBuilds: true`,
`strictDepBuilds: false` or `allow-plugins: true`, or adds a dependency whose
manifest has an install script, names what the script does. The Shai-Hulud
worm spread through injected post-install scripts
(https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/).
The OpenSSF guide asks for installation scripts to be checked for obfuscated
code (https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software).

**[defect] An approval is scoped to the package, not a wildcard.** For git or
tarball dependencies pnpm needs the exact resolved path or repository URL; a
bare name does not approve them (https://pnpm.io/settings/build).

**[trade-off] Release-age delay.** pnpm `minimumReleaseAge` (default 1440
minutes since v11, 0 before; transitive too) and npm `min-release-age` (days,
default off) refuse versions younger than the window
(https://pnpm.io/settings/dependency-resolution,
https://docs.npmjs.com/cli/v11/using-npm/config). Gains: most compromised
versions are pulled within hours — debug and chalk in September 2025 were
reverted in about two hours [unverified: secondary report, see Incidents].
Costs: a security fix also waits; npm keeps the vulnerable version and exits
non-zero when the window blocks `npm audit fix`. Exclusions
(`minimumReleaseAgeExclude`, `min-release-age-exclude`) exist for internal
scopes.

**[trade-off] pnpm `trustPolicy: no-downgrade`.** It fails the install when a
package's trust evidence drops below earlier releases (trusted publisher to
provenance only, or to none); default `off`
(https://pnpm.io/settings/dependency-resolution). Gains: catches a release
published from a stolen token. Costs: false failures when a maintainer
changes CI; needs `trustPolicyExclude`.

## Lock files

**[defect] An application or service commits its lock file, and the lock file
changes with the manifest.** npm: commit a lock file for all projects; its
`integrity` hashes let the client verify packages without trusting the
registry; CI uses `npm ci`, which treats it as read-only
(https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md).
Go: `go.sum` hashes are checked on every download and a mismatch is a security
error; the checksum database makes a version's content immutable
(https://go.dev/ref/mod). Cargo: committing Cargo.lock is the suggested
starting point for libraries too since 2023
(https://blog.rust-lang.org/2023/08/29/committing-lockfiles/). Nix:
flake.lock records each input's `rev` and `narHash`
(https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake).

**[defect] A lock-only diff that changes a `resolved` URL, a registry host, an
`integrity`/`checksum`/`h1:`/`narHash` value for the same version, or a source
from registry to git or tarball is a finding until explained.** The same
version with a new hash means different bytes. npm's `resolved` is where the
tarball came from and `integrity` is its SRI hash
(https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json). Lock
files are long and rarely read, which is why the change hides there.

**[silence] A lock-only diff states what produced it** (updater bot, `update`
command, merge resolution) and which direct dependency moved.

## Version ranges and pins

**[trade-off] Range or exact pin, by ecosystem convention.**

| Ecosystem | Convention |
| --- | --- |
| npm | Libraries use ranges; applications rely on the lock file's hash pin (https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md); `save-exact` default `false` (https://docs.npmjs.com/cli/v11/using-npm/config) |
| Go | `go.mod` versions are minimums; minimal version selection picks the highest required, never newer than required (https://go.dev/ref/mod) |
| Cargo | Libraries state the range they work with; crates.io rejects `*` (https://doc.rust-lang.org/cargo/faq.html) |

**[defect] No wildcard or unbounded range** (`*`, `latest`, `>=x` with no
upper bound) in a published library or a build tool config
(https://doc.rust-lang.org/cargo/faq.html).

**[silence] A dependency updater exists** for manifests and base images, so
pins do not go stale; Scorecard checks for Dependabot or Renovate
(https://github.com/ossf/scorecard/blob/main/docs/checks.md). For workflow
actions see `github-actions-patterns`.

## Known vulnerabilities

**[defect] The change does not add or keep a version with a known
vulnerability that the scanner output reports for the changed package**, unless
the diff or PR states why it does not apply (unreachable per govulncheck, not
in the shipped artifact). Order of trust is the order in "## Run the tools
first": a govulncheck "not called" outranks a version match; a range match
from npm audit or osv-scanner without reachability is a finding with the
reachability question attached.

**[silence] A deliberate ignore entry (osv-scanner config, `cargo deny`
advisory ignore, audit allowlist) names the advisory id, the reason and an
expiry.**

## Provenance and signatures

**[trade-off] Requiring provenance.** npm provenance links a package to its
source and build instructions; it does not prove the package is free of
malicious code; `npm audit signatures` verifies registry signatures and
attestations (https://docs.npmjs.com/generating-provenance-statements).
Trusted publishing (OIDC, no long-lived token; GitHub Actions, GitLab CI/CD,
CircleCI; npm CLI 11.5.1+) generates provenance automatically for public
packages from public repositories on GitHub and GitLab
(https://docs.npmjs.com/trusted-publishers). PyPI trusted publishing issues
upload tokens that expire after 15 minutes (https://docs.pypi.org/trusted-publishers/);
PEP 740 attestations bind a file's digest to the identity that published it
(https://docs.pypi.org/attestations/).

**[defect] A signature check verifies the expected identity, not only a valid
signature.** Sigstore verification checks the signature, that the
certificate's identity matches the one expected, the chain to Sigstore's root,
and inclusion in the Rekor log (https://docs.sigstore.dev/about/overview/). A
`cosign verify` with no identity constraint accepts anyone's signature.

**[silence] The project's own publish workflow uses trusted publishing, or
states why a token is used.** After Shai-Hulud, npm moved to trusted
publishing, seven-day granular tokens and 2FA for local publishing, and to
disallowing tokens by default
(https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/).

SLSA levels, stated as slsa.dev v1.2 defines them
(https://slsa.dev/spec/v1.2/build-track-basics, https://slsa.dev/spec/v1.2/source-requirements):

| Track and level | Meaning |
| --- | --- |
| Build L0 | No guarantees |
| Build L1 | Provenance exists; easy to forge; guards against release mistakes |
| Build L2 | Hosted platform generates and signs provenance; guards against tampering after the build |
| Build L3 | Hardened platform; runs isolated, signing secret out of reach of build steps; guards against tampering during the build |
| Source L1–L4 | Version controlled; continuous immutable history with provenance; enforced technical controls on named refs; two-party review |

**[defect] A claim of "SLSA L3" or similar names the track and the platform
that meets it.** The Build track stops at L3 in both v1.1 and v1.2; v1.1
describes only the Build track, and the Source track arrives in v1.2
(https://slsa.dev/spec/v1.1/levels, https://slsa.dev/spec/v1.2/).

## Container base images

**[defect] A `FROM` line in a production Dockerfile pins by digest**
(`image:tag@sha256:...`), with an updater. Tags are mutable and a rebuild can
pull a different image; a digest fixes it, at the cost of not receiving fixes
until updated; Dependabot's `docker` ecosystem updates tags and digests
(https://docs.docker.com/build/building/best-practices/); Docker Scout's "No
outdated base images" policy reports a pinned digest that has fallen behind
(same page). Scorecard
Pinned-Dependencies checks the same
(https://github.com/ossf/scorecard/blob/main/docs/checks.md). Images in
workflow `container:`/`services:` are covered by `github-actions-patterns`.

## Vendored copies

**[defect] Vendored or copied code keeps its licence notice and records where
it came from** (upstream URL and commit). MIT, Apache-2.0, GPL, LGPL and MPL
all require the licence and copyright notice to be kept
(https://choosealicense.com/licenses/).

**[defect] Reference material is cited, not copied.** The house rule: shared
repos, URLs and docs are reference; extract what applies, adapt it into the
project's own design, and cite it (`harness/rules/common/60-delegation.md`).
A diff that pastes a file or long block from a reference into the project with
no adaptation is a finding.

**[silence] A vendored copy states how it is updated**, since scanners that
read lock files do not see it. The npm guide discourages vendoring without
supporting tooling
(https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md).

## SBOM

**[trade-off] Generating an SBOM.** CISA describes an SBOM as an inventory of
components used for supply-chain risk management, with author, consumer and
distributor roles, and points to minimum-element guidance
(https://www.cisa.gov/sbom). Scorecard awards a point for one
(https://github.com/ossf/scorecard/blob/main/docs/checks.md). Gains: a
customer, regulator or vulnerability pipeline can query it. Costs: an SBOM
nobody reads is build time and an artifact to keep accurate. Ask who consumes
it; with no consumer, do not require it.

## Licences

**[defect] Licences are stated as SPDX identifiers**, and the GNU ones as the
explicit `-only` or `-or-later` form; bare `GPL-3.0` is deprecated
(https://spdx.org/licenses/).

**[defect] A new or upgraded dependency's licence is checked against the
project's policy**, and a licence change in an upgrade is called out. Recent
moves away from open-source licences: HashiCorp moved future releases from
MPL-2.0 to BSL 1.1 on 10 August 2023, restricting competitive offerings
(https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license);
OSI states SSPL is not an open-source licence
(https://opensource.org/blog/the-sspl-is-not-an-open-source-license). The SPDX
list does not mark BUSL-1.1, SSPL-1.0 or Elastic-2.0 as OSI-approved or FSF
libre (https://spdx.org/licenses/).

Copyleft obligations (summaries from choosealicense.com and the licence
stewards; not legal advice):

| Licence | Scope of copyleft | Triggered by | Proprietary code may link or combine? |
| --- | --- | --- | --- |
| GPL-3.0 | The whole work that includes it | Conveying copies (distribution); network use or private use is not conveying (https://choosealicense.com/licenses/gpl-3.0/) | No, when combined into one program and conveyed; separate programs in an aggregate are not covered (https://choosealicense.com/licenses/gpl-3.0/) |
| AGPL-3.0 | The whole work | Conveying, and also offering a modified version to users over a network, who must be offered its source (section 13) (https://choosealicense.com/licenses/agpl-3.0/, https://opensource.org/license/agpl-v3) | No; running an unmodified copy as a service does not by itself trigger disclosure (https://choosealicense.com/licenses/agpl-3.0/) |
| LGPL-3.0 | The library and its modifications | Conveying | Yes, through the library's interfaces, provided users can relink with a modified library (shared library or relinkable objects) (https://choosealicense.com/licenses/lgpl-3.0/) |
| MPL-2.0 | Each modified MPL file | Distributing the modified files | Yes, new files are not covered, even when statically linked; GPL-compatible unless marked Incompatible With Secondary Licenses (https://www.mozilla.org/en-US/MPL/2.0/FAQ/) |

The FSF's GPL FAQ (https://www.gnu.org/licenses/gpl-faq.html) is the primary
source for GPL linking questions [unverified: the site did not respond in this
run].

**[trade-off] Accepting a copyleft dependency.** Whether the project conveys
the binary, runs it as a network service, or only uses it internally decides
which obligations apply (table above); that is a question for the owner, and
legal applicability is never a finding.

## Incidents

- xz-utils, March 2024, CVE-2024-3094: a malicious `m4/build-to-host.m4`
  present only in the 5.6.0 and 5.6.1 release tarballs, not in upstream git,
  extracted a payload hidden in test files during the build; found by Andres
  Freund through sshd CPU use and valgrind errors
  (https://www.openwall.com/lists/oss-security/2024/03/29/4). Lesson: the
  release artifact can differ from the reviewed source; provenance and
  building from source tags matter. The NVD entry
  (https://nvd.nist.gov/vuln/detail/CVE-2024-3094) [unverified: page did not
  render].
- event-stream, November 2018: the maintainer handed publish rights to a
  volunteer who added `flatmap-stream`, whose encrypted payload targeted a
  Copay wallet build; `event-stream@3.3.6` affected
  (https://github.com/dominictarr/event-stream/issues/116). Lesson: a
  maintainer change is a supply-chain event.
- ua-parser-js, October 2021: the maintainer's npm account was hijacked and
  0.7.29, 0.8.0 and 1.0.0 shipped scripts that downloaded and ran a miner and
  a password stealer (https://github.com/advisories/GHSA-pjwm-rvh2-c87w,
  https://github.com/faisalman/ua-parser-js/issues/536).
- debug, chalk and others, 8 September 2025: the maintainer was phished by a
  fake 2FA-reset mail from `npmjs.help`; debug 4.4.2, chalk 5.6.1 and others
  carried browser-side code that swapped cryptocurrency addresses
  (https://www.stepsecurity.io/blog/20-popular-npm-packages-compromised-chalk-debug-strip-ansi-color-convert-wrap-ansi,
  https://github.com/debug-js/debug/issues/1005). The two-hour revert time
  is from a secondary report [unverified].
- Shai-Hulud, September 2025: a self-replicating worm stole npm and cloud
  credentials, published them to public GitHub repositories, and used the
  stolen npm tokens to publish infected versions of other packages; over 500
  packages; CISA advised pinning to releases before 16 September 2025,
  rotating credentials and phishing-resistant MFA
  (https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem,
  https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/).

## Related

- `security-reviewer` (agent) — attack framing, Execution Policy, calibration.
- `github-actions-patterns` — action SHA pinning, workflow images, updaters for
  actions.
- `terraform-patterns` — `.terraform.lock.hcl` and provider pinning.
- `k8s-patterns` — image pinning in manifests.
- `change-review` — runs osv-scanner and passes its output on.
