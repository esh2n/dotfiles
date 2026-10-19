# docker-patterns — review checklist

Derived from ../SKILL.md. Read by `security-reviewer` (secrets, user, socket, port, bind-mount and Compose secrets items), `code-reviewer` (context, stages, cache, packages, COPY/ADD, reproducibility, process model) and `workload-reviewer` (Compose start order, restart, HEALTHCHECK) through the `change-review` skill when a diff touches a `Dockerfile`, `Containerfile`, `*.Dockerfile`, `.dockerignore`, `docker-compose*.yml`, `compose*.yaml`, or container build config (`docker-bake.hcl`, build workflow inputs), and by `grilling` (trade-offs). Read hadolint, `docker build --check`, `trivy config` and image-scanner output first: an item whose `tools:` line names a tool that ran is reported by that tool, not again by hand. Base-image digest pins are `supply:base-image-not-digest`; Pod-spec items are `k8s:*`. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: docker:dockerignore-missing
  rule: A `.dockerignore` at the context root excludes VCS data, dependency directories, build output and local secret files.
  check: Context with no `.dockerignore` and a `COPY . .` or `ADD . .`; a `.dockerignore` that does not exclude `.git`, `.env*`, `node_modules` (or the language equivalent) or credential files; a later `!` pattern that re-includes one of them.
  tools: none (Docker Scout or `trivy image --scanners secret` find a leaked secret only after the build).
  section: "## Build context and .dockerignore"

- id: docker:per-dockerfile-ignore-shadowed
  rule: An exclusion applies to every build that needs it, including one with its own `<name>.Dockerfile.dockerignore`.
  check: Exclusion added only to the root `.dockerignore` while the affected build uses a `*.Dockerfile` that has its own ignore file beside it.
  tools: none.
  section: "## Build context and .dockerignore"

- id: docker:single-stage-toolchain
  rule: Compilers, package caches and test tooling do not reach the final stage.
  check: Compiled-language or bundled-frontend image with one `FROM`; final stage that installs build-only packages (`build-essential`, `gcc`, `-dev` packages, SDK images) or copies the whole build stage.
  tools: none.
  section: "## Multi-stage builds and image size"

- id: docker:stage-unnamed
  rule: Stages are named with `AS` and referenced by name.
  check: `COPY --from=<number>`; `COPY --from` naming an undefined or its own alias; duplicate stage names.
  tools: hadolint DL3022, DL3023, DL3024; build check DuplicateStageName.
  section: "## Multi-stage builds and image size"

- id: docker:source-before-deps
  rule: Dependency manifests are copied and installed before the source tree.
  check: `COPY . .` (or a source directory) before the dependency install step (`npm ci`, `pnpm install`, `pip install -r`, `uv sync`, `go mod download`, `cargo fetch`, `bundle install`).
  tools: none.
  section: "## Layer order and cache"

- id: docker:secret-in-arg-env
  rule: No credential is passed through `ARG` or `ENV`.
  check: `ARG` or `ENV` named like a token, password, key or secret; `--build-arg` carrying a credential in CI or Compose `build.args`; fix is `RUN --mount=type=secret` or `--mount=type=ssh`.
  tools: build check SecretsUsedInArgOrEnv (name heuristics only); trivy config. CIS 4.10.
  section: "## Secrets in the build"

- id: docker:secret-copied-then-deleted
  rule: A secret file is never copied into a layer and removed later.
  check: `COPY` of `.npmrc`, `.netrc`, `.pypirc`, `id_*`, `*.pem`, `credentials*` or a `.env` followed by a later `RUN rm` of it, or no removal at all.
  tools: `trivy image --scanners secret` after the build.
  section: "## Secrets in the build"

- id: docker:secret-rotation-cached
  rule: A step whose output depends on a rotated secret changes its cache key.
  check: `RUN --mount=type=secret` producing an artifact that embeds or depends on the token, with no build arg that changes when the secret does.
  tools: none.
  section: "## Secrets in the build"

- id: docker:apt-update-split
  rule: `apt-get update` and `apt-get install` share one `RUN`, which ends with `rm -rf /var/lib/apt/lists/*`.
  check: `RUN apt-get update` alone; install without list cleanup in the same `RUN`; `apt` instead of `apt-get`; install without `--no-install-recommends`.
  tools: hadolint DL3009, DL3015, DL3027; CIS 4.7 (Docker Bench, manual).
  section: "## Package installs"

- id: docker:package-cache-kept
  rule: Package-manager caches are not left in a layer.
  check: `apk add` without `--no-cache`; `pip install` without `--no-cache-dir`; `yarn install` with no `yarn cache clean`; yum, dnf or zypper with no clean in the same `RUN` (a cache mount in place of each is fine).
  tools: hadolint DL3019, DL3042, DL3060, DL3032, DL3040, DL3036.
  section: "## Package installs"

- id: docker:pipe-without-pipefail
  rule: A `RUN` with a pipe sets `-o pipefail`.
  check: `RUN` containing `|` with no `SHELL [..., "-o", "pipefail", ...]` earlier and no `set -o pipefail` in the command.
  tools: hadolint DL4006.
  section: "## Package installs"

- id: docker:add-for-local-or-unverified
  rule: `COPY` for local files; `ADD` only for a remote artifact with `--checksum`.
  check: `ADD` of a local file or directory that is not a tar archive meant to be extracted; `ADD https://…` or `ADD git@…` with no `--checksum`.
  tools: hadolint DL3020 (local files only; checksum by hand); CIS 4.9.
  section: "## COPY versus ADD"

- id: docker:unpinned-download
  rule: Tools downloaded in a `RUN` are pinned by version and verified by checksum.
  check: `curl`/`wget` of a `latest` URL or an unversioned path; `curl … | sh`; a download with no `sha256sum -c` (or equivalent) before use.
  tools: none.
  section: "## Reproducibility"

- id: docker:runs-as-root
  rule: The final stage sets a non-root `USER` with an explicit numeric UID and GID.
  check: Final stage with no `USER`, `USER root` last, or a user created with no fixed UID/GID (`useradd` without `-u`, `adduser` without `-u`), unless the base image's default user is non-root (distroless `:nonroot`).
  tools: hadolint DL3002 (last user root only); trivy config; CIS 4.1.
  section: "## User and privileges"

- id: docker:app-owns-its-code
  rule: Files the process must not change are owned by root.
  check: `COPY --chown=<runtime user>` or `chown -R` on application code or config rather than only on the paths it writes; `COPY --link --chown` with names instead of numeric ids.
  tools: none.
  section: "## User and privileges"

- id: docker:sudo-in-image
  rule: No `sudo` in the image.
  check: `sudo` installed or invoked in `RUN` or an entrypoint.
  tools: hadolint DL3004.
  section: "## User and privileges"

- id: docker:shell-form-entrypoint
  rule: `ENTRYPOINT` and `CMD` use exec (JSON) form.
  check: `ENTRYPOINT` or `CMD` written as a plain string.
  tools: hadolint DL3025; build check JSONArgsRecommended.
  section: "## Process model: ENTRYPOINT, CMD, PID 1, signals"

- id: docker:wrapper-without-exec
  rule: A wrapper script ends with `exec "$@"` or `exec`s the binary.
  check: Entrypoint script whose last line starts the application without `exec`.
  tools: none.
  section: "## Process model: ENTRYPOINT, CMD, PID 1, signals"

- id: docker:pid1-no-init
  rule: PID 1 either handles `SIGTERM` or runs under an init.
  check: Application or script as PID 1 with no signal handler in its code, and no `tini`/`dumb-init` entrypoint, no Compose `init: true`, no `docker run --init`; also a process that spawns children with none of these.
  tools: none.
  section: "## Process model: ENTRYPOINT, CMD, PID 1, signals"

- id: docker:healthcheck-malformed
  rule: A `HEALTHCHECK` exits 0 or 1 only, sets a timeout below its interval, and does no I/O beyond the process.
  check: Check command that can exit 2 or another code (e.g. `curl -f … || exit 2`); no `--timeout` with a slow command; more than one `HEALTHCHECK`; a check that calls a database or another service.
  tools: hadolint DL3012 (multiple only).
  section: "## HEALTHCHECK"

- id: docker:healthcheck-no-start-period
  rule: A slow starter sets `--start-period`.
  check: `HEALTHCHECK` (or Compose `healthcheck:`) on a service whose boot exceeds interval × retries, with no `start_period`/`--start-period`.
  tools: none.
  section: "## HEALTHCHECK"

- id: docker:depends-on-not-ready
  rule: `depends_on` that needs the dependency ready uses `condition: service_healthy` on a dependency with a `healthcheck`.
  check: Short-syntax `depends_on` (or `condition: service_started`) on a database, broker or API the dependent connects to at startup; `service_healthy` on a service with no `healthcheck` in Compose or the image.
  tools: none.
  section: "## Compose"

- id: docker:restart-missing
  rule: A long-running service sets `restart:`.
  check: Compose service that runs a server or worker with no `restart:` key.
  tools: none.
  section: "## Compose"

- id: docker:port-all-interfaces
  rule: A published port names its host IP, `127.0.0.1` or the tailnet address.
  check: Compose `ports:` entry `"8080:80"` or long syntax with no `host_ip`; `docker run -p 8080:80`; `0.0.0.0:` written explicitly.
  tools: CIS 5.14 (Docker Bench, running containers only).
  section: "## Compose"

- id: docker:socket-or-host-mounted
  rule: The Docker socket, sensitive host directories and privileged mode are never given to a service.
  check: Volume source `/var/run/docker.sock`, `/`, `/etc`, `/proc`, `/sys`, `/boot`, `/dev` or `/var/lib/docker`; `privileged: true`.
  tools: CIS 5.32, 5.6, 5.5 (Docker Bench, running containers only).
  section: "## Compose"

- id: docker:bind-mount-writable
  rule: Bind mounts the container only reads are `:ro`.
  check: Bind mount of config, source or certificates with no `:ro` / `read_only: true`; short-syntax bind whose host path may not exist (it is created as a directory).
  tools: none.
  section: "## Compose"

- id: docker:compose-secret-in-env
  rule: Credentials reach services through `secrets:`, not literal `environment:` values in the committed file.
  check: Literal token, password or key under `environment:` in a committed Compose file; `secrets:` long syntax with `uid`/`gid`/`mode` on a `file` source (ignored).
  tools: none.
  section: "## Compose"

## silences
A design document, PR description or the file itself must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: docker:copy-from-image-unpinned
  rule: A `COPY --from=<external image>` pins the image like a `FROM`.
  check: `COPY --from=` naming a registry image by tag or `latest` with no `@sha256:` digest.
  section: "## Multi-stage builds and image size"

- id: docker:large-input-copied
  rule: Large inputs needed by one `RUN` use a bind mount, not `COPY`.
  check: `COPY` of a large source tree or archive used by a single following `RUN` and never needed in the image.
  section: "## Layer order and cache"

- id: docker:reproducible-epoch-unstated
  rule: A build that needs byte-identical images states that it sets `SOURCE_DATE_EPOCH`.
  check: Claim of reproducible or deterministic images with no `SOURCE_DATE_EPOCH` in the build.
  section: "## Reproducibility"

- id: docker:setuid-unjustified
  rule: setuid and setgid bits are removed or justified.
  check: Final image keeping setuid/setgid binaries with no stated need (CIS 4.8).
  section: "## User and privileges"

- id: docker:stopsignal-unstated
  rule: A non-default `STOPSIGNAL` is stated when the application shuts down gracefully on something other than `SIGTERM`.
  check: Application documented to drain on `SIGINT`/`SIGQUIT` with no `STOPSIGNAL` or Compose `stop_signal`.
  section: "## Process model: ENTRYPOINT, CMD, PID 1, signals"

- id: docker:bind-mount-ownership-unstated
  rule: Bind-mount ownership is stated when the image runs as a non-root UID.
  check: Writable bind mount for a non-root image with no `user:` matching the host owner and no note on host ownership; a fix by `chmod 777` or switching to root.
  section: "## Compose"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: docker:cache-mount-or-clean-layer
  rule: Package-manager cache mounts versus cleanup in the layer.
  options: cache mount (fast local rebuilds, nothing in the image, no gain on fresh CI runners, apt needs `sharing=locked`) | clean in the same `RUN` (works everywhere, every rebuild downloads again)
  section: "## Layer order and cache"

- id: docker:os-package-pins
  rule: Pin OS package versions or not.
  options: exact pin (same package each build, breaks when the mirror drops the version) | wildcard minor pin (tolerates patch updates) | no pin plus a digest-pinned base with an updater (fewest breaks, package set moves with the base)
  section: "## Package installs"

- id: docker:distroless-or-shell
  rule: Distroless or minimal base versus one with a shell.
  options: distroless (smallest, fewest CVEs, no shell for health checks, scripts or `exec` debugging; `:debug` tags exist) | slim distribution base (shell and package manager available, more to patch)
  section: "## Base image: distroless or a shell"

- id: docker:entrypoint-or-cmd
  rule: `ENTRYPOINT` plus `CMD` arguments, or `CMD` alone.
  options: `ENTRYPOINT` + `CMD` (fixed executable, overridable arguments, users must know how they combine) | `CMD` only (whole command overridable, simplest to read)
  section: "## Process model: ENTRYPOINT, CMD, PID 1, signals"

- id: docker:healthcheck-or-probes
  rule: Image `HEALTHCHECK` versus relying on orchestrator probes.
  options: image `HEALTHCHECK` (Compose readiness and `docker ps` status, needs a health binary on distroless, may disagree with Kubernetes probes) | probes only (one definition in the Pod spec, no status under plain Docker or Compose)
  section: "## HEALTHCHECK"

- id: docker:restart-limit
  rule: Restart policy with or without a limit.
  options: `on-failure:5` (a crash loop stops and is noticed; a long dependency outage leaves the service down) | `unless-stopped`/`always` (recovers from any outage, a broken release restarts forever)
  section: "## Compose"

- id: docker:runtime-hardening
  rule: `read_only`, `cap_drop: [ALL]` and `no-new-privileges` on Compose services.
  options: harden (a compromised process cannot write the image or gain privileges; needs `tmpfs` or volumes for writable paths) | defaults (no setup work; acceptable for a local development file by the owner's choice)
  section: "## Compose"
