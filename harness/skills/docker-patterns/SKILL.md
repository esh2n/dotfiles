---
name: docker-patterns
description: Use when writing or reviewing a Dockerfile, Containerfile, .dockerignore, docker-compose.yml / compose.yaml, or container build configuration — and when judging multi-stage builds and final image size, layer order and build cache, build context leaks, secrets in build args, ENV or layers (BuildKit secret mounts), running as non-root, distroless versus shell-bearing bases, HEALTHCHECK versus orchestrator probes, PID 1 and signal handling, ENTRYPOINT versus CMD, apt/apk cache cleanup and package pins, COPY versus ADD, reproducible builds, Compose depends_on readiness, restart policies, bind-mount permissions, published ports binding to 0.0.0.0, or which image linter or scanner (hadolint, docker build --check, trivy, docker scout) to run first.
metadata:
  namespaces: [platform/infra]
---

# Docker Patterns

Judgment criteria for container build files and Compose files. An image is
whatever the build context and every layer left behind, and it runs with
whatever user, signals and ports the file declares; every review starts from
what ends up in the final image and what the running container can reach.
Sources checked 2026-10-19.

Ownership. `supply-chain-review` owns base-image digest pinning, its updater,
and provenance and signatures ("## Container base images", "## Provenance and
signatures"); this skill does not repeat them. `k8s-patterns` owns runtime
manifests: probes, `securityContext`, resources and image pull policy in a Pod
spec. `resilience-patterns` owns what a health check should depend on and the
drain on `SIGTERM` ("## Health checks"). `security-reviewer` reads the secrets,
user, socket and port items; `code-reviewer` the build, cache and process
items; `workload-reviewer` the Compose start order, restart and health items.

## Run the tools first

Run what is installed, from least to most execution, and read the output
before reading the diff by hand. An item whose `tools:` line names a tool
that ran is reported by that tool, not again; a tool that did not run is
named as not run and never supports "no issues".

1. **hadolint** parses the Dockerfile without building and lints `RUN` shell
   through ShellCheck (`SC` rules); rule ids are `DL3000`–`DL4006`
   (https://github.com/hadolint/hadolint).
2. **`docker build --check .`** runs BuildKit's build checks and stops before
   executing any build step; a normal build runs the same checks and prints
   violations as warnings, and `# check=error=true` makes them fail the build;
   needs Dockerfile syntax 1.8 and Buildx 0.15.0
   (https://docs.docker.com/build/checks/). The checks include
   `SecretsUsedInArgOrEnv`, `JSONArgsRecommended`, `CopyIgnoredFile`,
   `UndefinedVar` and `ExposeInvalidFormat`
   (https://docs.docker.com/reference/build-checks/).
3. **`trivy config <dir>`** (or `trivy fs --scanners misconfig`) checks
   Dockerfiles, Kubernetes and Helm for misconfiguration statically
   (https://trivy.dev/latest/docs/scanner/misconfiguration/). Compose files
   are not listed on that page.
4. **Image scanners**, after a build: `trivy image` (vulnerabilities and
   secrets; misconfiguration only with `--scanners`, same page) and
   `docker scout cves` / `docker scout recommendations` (CVEs from the image
   SBOM, base-image updates) (https://docs.docker.com/reference/cli/docker/scout/,
   https://docs.docker.com/scout/). Whether Scout needs a Docker account or
   uploads the SBOM is [unverified: neither page opened states it].

The `change-review` skill does not run any of these today; run hadolint and
`docker build --check` yourself when installed. CIS Docker Benchmark items
below are cited by number from Docker Bench for Security, which implements
benchmark v1.6.0 (https://github.com/docker/docker-bench-security,
https://raw.githubusercontent.com/docker/docker-bench-security/master/tests/4_container_images.sh,
https://raw.githubusercontent.com/docker/docker-bench-security/master/tests/5_container_runtime.sh);
the CIS landing page lists v1.9.0 as current and holds the text behind a
download (https://www.cisecurity.org/benchmark/docker).

## Build context and .dockerignore

**[defect] A `.dockerignore` exists at the context root and excludes VCS
data, dependency directories, build output and local secret files.** The
client sends everything not excluded to the builder; excluding it speeds the
build and keeps it out of reach of `COPY . .`
(https://docs.docker.com/build/concepts/context/). A `COPY . .` with no
`.dockerignore` copies `.env`, `.git` and credentials files into a layer.
Patterns follow Go `filepath.Match`, `!` re-includes, and the last matching
line wins, so a late `!` can undo an earlier exclusion (same page).

**[defect] A per-Dockerfile ignore file is read in place of the root one.**
`build.Dockerfile.dockerignore` beside `build.Dockerfile` takes precedence
over the root `.dockerignore` (same page); an exclusion added only to the root
file does not apply to that build.

`CopyIgnoredFile` reports a `COPY` of a path the ignore file excludes
(https://docs.docker.com/reference/build-checks/).

## Multi-stage builds and image size

**[defect] Compilers, package caches and test tooling do not reach the
final stage.** Each `FROM` starts a stage, and `COPY --from=<stage>` carries
only the named artifacts into the last one
(https://docs.docker.com/build/building/multi-stage/). A single-stage image
that builds and runs ships the toolchain and its CVEs.

**[defect] Stages are named with `AS` and referenced by name**, so reordering
does not silently point `COPY --from=0` at another stage (same page).
hadolint `DL3022`–`DL3024` check references and uniqueness.

**[silence] A `COPY --from=<external image>` pins the image** like a `FROM`;
the multi-stage page shows `COPY --from=nginx:latest` as valid syntax, which
is the same mutable-tag problem `supply-chain-review` covers for `FROM`.

BuildKit builds only the stages the target depends on; the legacy builder
builds every stage up to the target (same page). `--target` selects a debug
or test stage without shipping it.

## Layer order and cache

**[defect] Dependency manifests are copied and installed before the source
tree.** Once one instruction misses the cache every later one rebuilds; order
from least to most frequently changed
(https://docs.docker.com/build/cache/invalidation/). Copy `package.json` and
the lock file, install, then copy the project
(https://docs.docker.com/build/cache/optimize/). `COPY . .` before
`npm ci` reinstalls on every source edit.

**[trade-off] Cache mounts versus clean layers.** `RUN
--mount=type=cache,target=...` keeps package-manager caches across builds
without putting them in a layer; apt needs `sharing=locked`; cache mounts are
not exported by `--cache-to` (https://docs.docker.com/build/cache/optimize/,
https://docs.docker.com/reference/dockerfile/). Gains: fast rebuilds and no
cache in the image. Costs: CI runners with fresh state get no benefit, and the
build must still succeed with an empty cache.

**[silence] Large inputs needed by one `RUN` use a bind mount, not `COPY`.**
`RUN --mount=type=bind` files are read-only by default and stay out of the
image and the cache (https://docs.docker.com/build/cache/optimize/).

## Secrets in the build

**[defect] No credential is passed through `ARG` or `ENV`.** Docker states
build args and environment variables are inappropriate for secrets
(https://docs.docker.com/build/building/secrets/); `ARG` values appear in
`docker history` and in `max`-mode provenance, and `ENV` values persist in the
image and show in `docker inspect`
(https://docs.docker.com/reference/dockerfile/). Use `RUN
--mount=type=secret,id=<id>` (file at `/run/secrets/<id>`, or `env=` to expose
it as a variable for that step) and `--mount=type=ssh` for git over SSH
(https://docs.docker.com/build/building/secrets/). Build check
`SecretsUsedInArgOrEnv` flags names that look sensitive; CIS 4.10.

**[defect] A secret file is never `COPY`'d in and deleted later.** Each
instruction is its own layer: an `ENV` stays in the image even if unset in a
later instruction (https://docs.docker.com/build/building/best-practices/),
and the same holds for a file removed in a later `RUN`, which is why cleanup
must happen in the same `RUN` (same page, apt section). A `.npmrc`, `.netrc`
or key copied, used and `rm`'d in a later step is still in the earlier layer.

**[defect] Changing a secret does not bust the cache on its own.** Secret
contents do not affect cache keys; only its id or path does
(https://docs.docker.com/build/cache/invalidation/). A step whose output
depends on a rotated token needs a build arg that changes with it.

## Package installs

**[defect] `apt-get update` and `apt-get install` share one `RUN`, which
ends with `rm -rf /var/lib/apt/lists/*`.** A cached `update` layer serves a
stale index to a later install, because `RUN` cache matches the command text
only (https://docs.docker.com/build/cache/invalidation/,
https://docs.docker.com/build/building/best-practices/). Use
`--no-install-recommends` (same page). hadolint `DL3009`, `DL3015`, `DL3027`
(`apt` instead of `apt-get`); CIS 4.7.

**[defect] apk uses `--no-cache`** rather than `--update` plus a later
cleanup (hadolint `DL3019`, https://github.com/hadolint/hadolint). pip uses
`--no-cache-dir` (`DL3042`), yarn runs `yarn cache clean` (`DL3060`), and
yum, dnf and zypper clean in the same step (`DL3032`, `DL3040`, `DL3036`).

**[trade-off] Pin OS package versions or not.** Docker pins when needed,
e.g. `package-foo=1.3.*` (https://docs.docker.com/build/building/best-practices/);
hadolint warns on unpinned apt, apk, pip, npm and gem (`DL3008`, `DL3018`,
`DL3013`, `DL3016`, `DL3028`). Gains: the same package on each build. Costs:
distributions remove old versions from their mirrors, so an exact pin breaks
the build when the base image moves; a wildcard minor pin or a digest-pinned
base with an updater is the usual middle.

**[defect] A `RUN` with a pipe sets `-o pipefail`.** The shell checks only
the last command's exit status, so a failed download piped elsewhere passes;
use `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` or `set -o pipefail &&`,
which `dash` may not support
(https://docs.docker.com/build/building/best-practices/). hadolint `DL4006`.

## COPY versus ADD

**[defect] `COPY` for local files; `ADD` only for a remote artifact with
`--checksum`.** `ADD` also fetches URLs and git repositories and extracts
local tar archives by content, not name, so a renamed archive unpacks
unexpectedly (https://docs.docker.com/reference/dockerfile/,
https://docs.docker.com/build/building/best-practices/). A remote `ADD` with
no `--checksum` (`sha256:` for HTTP, a commit for git) trusts the server on
every build. hadolint `DL3020`; CIS 4.9.

## Reproducibility

**[defect] Tools downloaded in a `RUN` are pinned by version and verified
by checksum.** `curl … | sh` or a `latest` release URL changes the image with
no Dockerfile change; `RUN` cache keys on the command text, so a cached build
hides the drift until the cache is pruned
(https://docs.docker.com/build/cache/invalidation/). Put versions in `ARG`
or `ENV` so a bump is one reviewed line
(https://docs.docker.com/build/building/best-practices/).

**[silence] `SOURCE_DATE_EPOCH` is set when byte-identical images are
required.** Changing it invalidates `WORKDIR` and every later instruction
(https://docs.docker.com/build/cache/invalidation/); a build that wants
identical digests across rebuilds states that it uses it.

## User and privileges

**[defect] The final stage sets a non-root `USER` with an explicit numeric
UID and GID.** Docker advises a dedicated user for services that do not need
root and an explicit UID/GID because automatic assignment is not deterministic
(https://docs.docker.com/build/building/best-practices/). hadolint `DL3002`
(last user root); CIS 4.1. `k8s-patterns` checks `runAsNonRoot` in the Pod
spec; the image should not depend on it.

**[defect] Files the process must not change are owned by root.** `COPY`
without `--chown` gives UID and GID 0
(https://docs.docker.com/reference/dockerfile/), which suits code and config;
`--chown` to the runtime user only on paths it writes. `COPY --link` with
`--chown` needs numeric ids (same page).

**[defect] No `sudo` in the image**; use `gosu` to drop from root in an
entrypoint (https://docs.docker.com/build/building/best-practices/, hadolint
`DL3004`).

**[silence] setuid and setgid bits are removed or justified** (CIS 4.8).

## Base image: distroless or a shell

**[trade-off] Distroless or minimal base versus one with a shell.**
Distroless images hold the application and its runtime dependencies only, no
shell or package manager, which improves scanner signal and shrinks the
provenance to establish; `static-debian13` is about 2 MiB against 5 MiB for
Alpine and 124 MiB for Debian; `:nonroot` and `:debug` (busybox shell) tags
exist (https://github.com/GoogleContainerTools/distroless). Gains: fewer
packages to patch (CIS 4.3), nothing for an attacker to `exec` into. Costs:
no shell for `HEALTHCHECK CMD curl`, entrypoint scripts or `docker exec`
debugging; shell-form `ENTRYPOINT` does not run (same README). A distroless
switch is checked against every `RUN`, `CMD` and health check that assumed
`/bin/sh`.

## Process model: ENTRYPOINT, CMD, PID 1, signals

**[defect] `ENTRYPOINT` and `CMD` use exec (JSON) form.** Shell form runs
under `/bin/sh -c`, so the application is not PID 1 and does not receive
`SIGTERM` from `docker stop`; shell form also ignores `CMD` and `docker run`
arguments (https://docs.docker.com/reference/dockerfile/). hadolint
`DL3025`; build check `JSONArgsRecommended`.

**[defect] A wrapper script ends with `exec "$@"`** (or `exec` the binary),
so the application replaces the shell as PID 1
(https://docs.docker.com/build/building/best-practices/).

**[defect] PID 1 either handles `SIGTERM` or runs under an init.** A
process running as PID 1 ignores signals whose default action is terminate
unless it installs a handler; `docker run --init` and Compose `init: true` run
a tini-based init that forwards signals and reaps zombies
(https://docs.docker.com/reference/cli/docker/container/run/,
https://docs.docker.com/reference/compose-file/services/). Without either,
`docker stop` waits out its timeout and kills the process. What to do on the
signal (fail readiness, drain, exit) is `resilience-patterns`.

**[silence] A non-default `STOPSIGNAL` is stated** when the application
shuts down gracefully on something other than `SIGTERM`, the default
(https://docs.docker.com/reference/dockerfile/).

**[trade-off] `ENTRYPOINT` plus `CMD` arguments, or `CMD` alone.**
`ENTRYPOINT` fixes the executable and `CMD` supplies overridable defaults;
Docker discourages `CMD`-as-parameters unless users know how the two combine
(https://docs.docker.com/build/building/best-practices/), and a base image's
`CMD` is reset when the child sets `ENTRYPOINT`
(https://docs.docker.com/reference/dockerfile/).

## HEALTHCHECK

**[defect] A `HEALTHCHECK` command exits 0 or 1 only, carries a timeout
below its interval, and does no I/O beyond the process.** Exit 2 is reserved;
defaults are interval 30s, timeout 30s, start period 0s, retries 3; a timed-out
check is killed and counts as a failure; only the last `HEALTHCHECK` applies
(https://docs.docker.com/reference/dockerfile/). hadolint `DL3012`
(multiple). Dependency rules for the check are in `resilience-patterns`.

**[defect] A slow starter sets `--start-period`.** Failures inside it do not
count toward retries until the first success (same page); with the 0s default
a slow boot is marked `unhealthy`.

**[trade-off] Image `HEALTHCHECK` versus orchestrator probes.** Docker
Engine, Compose `depends_on: condition: service_healthy` and Compose's
`healthcheck:` override use it
(https://docs.docker.com/reference/compose-file/services/). Kubernetes probes
are defined in the Pod spec and run by the kubelet
(https://kubernetes.io/docs/concepts/workloads/pods/probes/); that the kubelet
ignores the image `HEALTHCHECK` is [unverified: no Kubernetes page opened
states it; a .NET image maintainer calls it a Compose need,
https://github.com/dotnet/dotnet-docker/issues/4300]. Gains of adding one:
Compose readiness and `docker ps` status (CIS 4.6, hadolint `DL3057` off by
default). Costs: a distroless image needs a health binary of its own, and a
check that differs from the Kubernetes probes reports a different answer.

## Compose

**[defect] `depends_on` that needs the dependency ready uses `condition:
service_healthy` and the dependency has a `healthcheck`.** Compose starts
services in dependency order but waits only until a container is running,
not ready (https://docs.docker.com/compose/how-tos/startup-order/); the short
syntax equals `service_started`
(https://docs.docker.com/reference/compose-file/services/). Use
`service_completed_successfully` for a migration job.

**[defect] A long-running service sets `restart:`.** The default is `no`
(https://docs.docker.com/reference/compose-file/services/).

**[trade-off] Restart policy with or without a limit.** `always` and
`unless-stopped` restart whatever the exit code;
`on-failure[:max-retries]` stops after a limit, and CIS 5.15 asks for
`on-failure:5` so a crash loop does not run forever (same pages). Gains of a
limit: a broken release stops and is noticed. Costs: a transient dependency
outage longer than the retries leaves the service down.

**[defect] A published port names its host IP: `127.0.0.1` or the tailnet
address, never the default.** A `ports:` entry with no host IP binds every
interface (`0.0.0.0`) and the Compose reference warns it bypasses host
firewall rules (https://docs.docker.com/reference/compose-file/services/);
Docker's published ports are routed before ufw's rules apply
(https://docs.docker.com/engine/network/packet-filtering-firewalls/). The
house exposes services on loopback or the tailnet only
(`harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`
for the model servers). CIS 5.14; `docker run -p` follows the same rule.
`EXPOSE` documents a port and publishes nothing; build check
`ExposeInvalidFormat` rejects IPs in it.

**[defect] The Docker socket is never mounted into a service** (CIS 5.32):
`/var/run/docker.sock` gives the container control of the daemon, which is
root on the host unless the daemon runs rootless
(https://docs.docker.com/engine/security/rootless/). Same for sensitive host
directories (CIS 5.6) and `privileged: true` (CIS 5.5).

**[defect] Bind mounts that the container only reads are `:ro`.** Bind
mounts give the container write access to host files by default; a mount
over a non-empty directory hides its contents; short syntax creates a missing
host path as a directory, long syntax with `create_host_path: false` fails
instead (https://docs.docker.com/engine/storage/bind-mounts/,
https://docs.docker.com/reference/compose-file/services/).

**[silence] Bind-mount ownership is stated when the image runs as a
non-root UID.** The process writes with its numeric UID, so a host directory
owned by another UID fails with permission denied, and `user:` in Compose
overrides the image `USER` (https://docs.docker.com/reference/compose-file/services/;
the numeric-UID permission behaviour is [unverified: no page opened states
it]). The fix is a matching `user:` or ownership set on the host, not
`chmod 777` or running as root.

**[defect] Credentials reach services through `secrets:`, not literal
`environment:` values in the committed file.** Short syntax mounts
`/run/secrets/<name>` read-only; `uid`, `gid` and `mode` are silently ignored
for `file` sources (same page). The env-versus-file choice for a running
workload is the same one `k8s-patterns` describes.

**[trade-off] Runtime hardening keys.** `read_only: true`, `cap_drop: [ALL]`
with explicit `cap_add`, and `security_opt: [no-new-privileges]`
(https://docs.docker.com/reference/compose-file/services/) match CIS 5.13,
5.4 and 5.26. Gains: a compromised process cannot write the image or gain
privileges. Costs: applications that write to their own filesystem need
`tmpfs` or volumes listed first; for a local development Compose file the
owner may skip them.

## Related

- `supply-chain-review` — `FROM` digest pins, updaters, provenance, vulnerability
  scanner order for lock files.
- `k8s-patterns` — probes, `securityContext`, resources and pull policy in Pod
  specs.
- `resilience-patterns` — what a health check may depend on, drain on
  `SIGTERM`.
- `github-actions-patterns` — `container:` and `services:` images in workflows.
- `shell-patterns` — the shell inside `RUN` and entrypoint scripts.
