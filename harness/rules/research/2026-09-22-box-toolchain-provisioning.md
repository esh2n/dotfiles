---
question: "How do vendors and practitioners in 2026 define, once, the set of language toolchains, LSP servers, linters/formatters, and CLI tools a coding agent needs, for both a developer's host and an isolated agent box, without maintaining two lists?"
date: 2026-09-22
verdict: "No vendor and no practitioner source defines toolchains, LSP, and tools once for both host and box — every vendor keeps two lists by design; mise (mise.toml copied into the agent Dockerfile) is the closest practitioner pattern with real multi-repo precedent (metabase, cosai ADR, cmux), while LSP remains the weakest link everywhere — absent from cloud images, not started in Claude Code cloud sessions, and unsupported natively by Codex, pi, and DSH's box tooling."
unverified:
  - "Devin blueprint-reference.md; Claude Code /docs/en/routines page; codex-universal Dockerfile apt list; E2B e2b.toml reference; Kiro/Antigravity environment docs — not fetched"
  - "Mario Zechner / Mitchell Hashimoto / Geoffrey Huntley / Boris Cherny explicit positions on agent environment setup or LSP — none found"
  - "Nix macOS cost reports (eval time, closure size) and any Linuxbrew-in-box measurements"
  - "Whether sbx launches the agent entrypoint with a login shell, which affects mise shim PATH activation"
  - "Pi third-party LSP extensions' maturity (samfoy/pi-lsp-extension, code-yeongyu/pi-lsp-client) not inspected"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# One toolchain definition for host and box: how vendors and practitioners do it (2026-09-22)

Question: how do vendors and practitioners in 2026 define, ONCE, the set of language toolchains, language servers (LSP), linters/formatters and CLI tools a coding agent needs, and get the same set onto (a) the developer's host and (b) an isolated agent environment (container / microVM / cloud sandbox), without maintaining two lists?

Method: primary docs and GitHub sources fetched 2026-09-22 (WebFetch, `gh api`, `gh search`; x.com not fetchable; WebSearch quota was exhausted early, so HN Algolia and GitHub code search substituted). Every claim has a URL. Quotes are verbatim. `[unverified]` marks inference. `[local]` marks facts measured on this machine, cited by repo path. A companion file, `box-vendors-tools.md` in this directory, covers the *mechanics* of getting repo/config/credentials into and work out of a box; this file covers only *toolchain/LSP/tool provisioning*.

Short answer up front: **no vendor and no practitioner source found defines toolchains + LSP + tools once for both host and box.** Every vendor keeps two lists by design (a cloud "setup script" or Dockerfile for the box, and whatever the developer does on the host). The closest things to "define once" are (1) OpenAI's `codex-universal` image, runnable locally with the same env-var version pins as the cloud; (2) the practitioner pattern of copying the project's `mise.toml` into the agent Dockerfile and running `mise install`; (3) Nix-family tools (devbox, devenv, flox) that build a shell and an OCI image from one file. LSP is the weakest link everywhere: Claude Code's LSP plugins expect binaries on PATH and are not started in cloud sessions at all; Codex CLI and pi have no LSP; DSH has LSP but explicitly does not install or sandbox the servers.

---

## 1. Vendor environment specs

### 1.1 Anthropic Claude Code — devcontainer reference

Source: https://code.claude.com/docs/en/devcontainer ; Dockerfile https://raw.githubusercontent.com/anthropics/claude-code/main/.devcontainer/Dockerfile ; devcontainer.json https://raw.githubusercontent.com/anthropics/claude-code/main/.devcontainer/devcontainer.json

- Anthropic ships Claude Code as a Dev Container **Feature** you add to your own image: `"ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}` on a base like `mcr.microsoft.com/devcontainers/base:ubuntu`. "The version tag at the end, such as `:1.0`, pins the feature's install script, not the Claude Code release. The feature installs the latest Claude Code, and Claude Code auto-updates itself inside the container by default." "The Claude Code feature installs Node.js itself when the base image doesn't provide it."
- The reference `.devcontainer/` is "provided as a working example rather than a maintained base image." Its Dockerfile is `FROM node:20`, apt-installs `less git procps sudo fzf zsh man-db unzip gnupg2 gh iptables ipset iproute2 dnsutils aggregate jq nano vim`, pins `git-delta` 0.18.2, installs `@anthropic-ai/claude-code` via npm, and sets up a default-deny iptables firewall. **No language toolchain beyond Node 20; no mise, no LSP, no linters.**
- The feature's own README (https://github.com/anthropics/devcontainer-features/blob/main/src/claude-code/README.md): "This feature requires Node.js and npm to be available in the container … For most setups, we recommend explicitly adding both features: `ghcr.io/devcontainers/features/node:1` and `ghcr.io/anthropics/devcontainer-features/claude-code:1`". It installs only the CLI; toolchains are the consuming repo's job.
- Customization guidance is Dockerfile-shaped: "Install any binaries that local stdio servers depend on in your Dockerfile, and add remote server domains to your network allowlist." Nothing on reusing this definition on the host.
- The sandbox comparison page (https://code.claude.com/docs/en/sandbox-environments) ranks dev container as "Full development environment | Requires Docker: Yes | Setup effort: Medium", custom container "Medium to high", VM "High", cloud sessions "None". It notes: "Built-in file tools, MCP servers, and hooks still run directly on your host. Every other approach in the table puts the whole Claude Code process inside the isolation boundary."

### 1.2 Anthropic Claude Code — cloud environments and Routines

Source: https://code.claude.com/docs/en/cloud-environments ; https://code.claude.com/docs/en/claude-code-on-the-web

- Preinstalled ("Installed tools" table): Python 3.x "with pip, poetry, uv, black, mypy, pytest, ruff"; Node "20, 21, and 22, with npm, yarn, pnpm, bun, eslint, prettier, chromedriver"; Ruby 3.1–3.3; PHP 8.3; OpenJDK 21 + Maven/Gradle; "Go with module support"; "rustc and cargo"; GCC/Clang/cmake/ninja/conan; docker; PostgreSQL 16, Redis 7; "git, gh, jq, yq, ripgrep, tmux, vim, nano". VM is "Ubuntu 24.04 on x86_64, regardless of your own operating system and CPU architecture." "Toolchains outside this list, such as the .NET SDK, aren't pre-installed … Install them with a setup script." **No language servers in the list.**
- Customization is a Bash **setup script** run as root: "Exit zero", "Finish within five minutes: keep the script's total runtime under roughly five minutes so the environment cache can build", "Network access for installs".
- Caching: "The setup script runs the first time you start a session in an environment. After it completes, Anthropic snapshots the filesystem and reuses that snapshot as the starting point for later sessions." Rebuild "when you change the environment's setup script or allowed network hosts, and when the cache reaches its expiry after roughly seven days."
- **Two lists, by design.** The doc separates setup scripts (cloud-only, provision the VM) from `SessionStart` hooks (in `.claude/settings.json`, run "in both local and cloud sessions"): "Use a setup script to provision the VM itself: toolchains and CLI tools that aren't pre-installed. Use a SessionStart hook for project setup that should run everywhere, cloud and local, like `npm install`." The worked example branches on `CLAUDE_CODE_REMOTE`.
- "Replacing the base image entirely isn't supported yet."
- Routines use the same mechanism: "Routines: scheduled and triggered runs each run as a cloud session."
- Local-only config does not travel: `~/.claude/CLAUDE.md`, `~/.claude/skills|agents|commands`, and user-scoped plugins are marked "Lives on your machine, not in the repo" (not available in cloud sessions).

### 1.3 Anthropic Claude Code — LSP ("code intelligence") plugins

Sources: https://code.claude.com/docs/en/plugins-reference ; https://code.claude.com/docs/en/discover-plugins ; https://code.claude.com/docs/en/costs ; https://github.com/anthropics/claude-plugins-official

- Schema: a plugin declares `lspServers` (or `.lsp.json`) with `command` ("The LSP binary to execute (must be in PATH)"), `args`, `extensionToLanguage`, optional `transport`, `env`, `initializationOptions`, `settings`, `startupTimeout`, `restartOnCrash`, `diagnostics` (push diagnostics into context after edits, default true).
- **Binary is not bundled.** "You must install the language server binary separately. LSP plugins configure how Claude Code connects to a language server, but they don't include the server itself. If you see `Executable not found in $PATH` in the `/plugin` Errors tab, install the required binary for your language." Official plugin dirs contain only `LICENSE` and `README.md` (checked via `gh api`).
- Official plugins and required binaries (discover-plugins table): `clangd-lsp`→`clangd`, `csharp-lsp`→`csharp-ls`, `gopls-lsp`→`gopls`, `jdtls-lsp`→`jdtls`, `kotlin-lsp`→`kotlin-language-server`, `lua-lsp`→`lua-language-server`, `php-lsp`→`intelephense`, `pyright-lsp`→`pyright-langserver`, `rust-analyzer-lsp`→`rust-analyzer`, `swift-lsp`→`sourcekit-lsp`, `typescript-lsp`→`typescript-language-server`. Plugin READMEs give plain install commands, e.g. typescript-lsp: `npm install -g typescript-language-server typescript` (https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/typescript-lsp/README.md); gopls-lsp: `go install golang.org/x/tools/gopls@latest` plus "Make sure `$GOPATH/bin` (or `$HOME/go/bin`) is in your PATH."
- **Not in cloud sessions:** "In cloud sessions, Claude Code doesn't start plugin language servers, so Claude doesn't get the LSP tool there." (discover-plugins)
- No statement anywhere in the plugin docs about devcontainers/Docker. The `${CLAUDE_PLUGIN_ROOT}/servers/pylsp` example in https://code.claude.com/docs/en/plugin-marketplaces shows a plugin *could* vendor a binary, but no official plugin does [inference from the two READMEs read plus the directory listing].
- Value claim is qualitative: "A single 'go to definition' call replaces what might otherwise be a grep followed by reading multiple candidate files. Installed language servers also report type errors automatically after edits" (costs doc). Cost caveat: "language servers like `rust-analyzer` and `pyright` can consume significant memory on large projects. If you experience memory issues, disable the plugin … and rely on Claude's built-in search tools instead." (discover-plugins)

### 1.4 OpenAI Codex — cloud environments and `codex-universal`

Sources: https://developers.openai.com/codex/cloud/environments (308 → https://learn.chatgpt.com/docs/environments/cloud-environment) ; https://github.com/openai/codex-universal (README raw fetched)

- "The default container image is called `universal` and comes pre-installed with common languages, packages, and tools." Versions pinned in the environment UI via `CODEX_ENV_*` variables.
- **The one explicit "same image locally" claim found:** the README says "`codex-universal` is a reference Docker image mirroring OpenAI's Codex base environment, designed to help developers customize and debug locally," and gives `docker run --rm -it -e CODEX_ENV_PYTHON_VERSION=3.12 -e CODEX_ENV_NODE_VERSION=20 -e CODEX_ENV_RUST_VERSION=1.87.0 -e CODEX_ENV_GO_VERSION=1.23.8 … ghcr.io/openai/codex-universal:latest`. Supported: Python 3.10–3.14, Node 18/20/22, Rust 1.83–1.95, Go 1.22–1.25, Swift 5.10–6.2, Ruby 3.2–3.4, PHP 8.2–8.4, Java 11–25, plus Bun, Bazelisk, Erlang, Elixir. Exact apt contents of the Dockerfile not fetched [unverified].
- Cloud model: setup script (network on) → optional maintenance script "when cached containers resume" → agent phase (internet off by default; allowlist configurable, https://learn.chatgpt.com/docs/cloud/internet-access). "Setup scripts run in a separate Bash session from the agent, so commands like `export` do not persist into the agent phase." "Caches persist up to 12 hours."
- A separate "local environments" feature for the ChatGPT desktop app stores config in a `.codex` folder; nothing found that ties it to the `universal` image (https://learn.chatgpt.com/docs/environments/local-environment). So OpenAI has three environment surfaces, unified only between cloud and `codex-universal`.
- Note: `codex-universal` mirrors the *cloud* box; it is a Linux image, not a definition you can apply to a macOS host. It solves "same box locally", not "same list on host and box".

### 1.5 OpenAI Codex CLI (local)

Sources: https://learn.chatgpt.com/docs/config-file/config-reference ; https://github.com/openai/codex issues

- `config.toml` keys are sandbox/permission only (`sandbox_mode`, `approval_policy`, `sandbox_workspace_write.writable_roots|network_access`, `projects.<path>.trust_level`, `default_permissions`). **No toolchain-provisioning keys; no LSP.**
- LSP is a standing open request: #8633 "Language Server Protocol support" (https://github.com/openai/codex/issues/8633), #8745 "LSP integration (auto-detect + auto-install) for Codex CLI" (https://github.com/openai/codex/issues/8745), #31504 "LSP support would improve cross-file project understanding" (https://github.com/openai/codex/issues/31504: "It has no integration with Language Server Protocol (LSP) servers, so it cannot query symbol definitions, find all references, resolve types"). No maintainer commitment found [unverified whether OpenAI has replied].
- Sandbox vs LSP friction: #37430 "macOS seatbelt sandbox appears to break sourcekitd/sourcekit-lsp" (https://github.com/openai/codex/issues/37430). Users route around missing LSP via Serena MCP (#13025, https://github.com/openai/codex/issues/13025).

### 1.6 Google Jules

Source: https://jules.google/docs/environment/

- Preinstalled: Node.js, Bun, Python, Go, Java, Rust, C/C++, Docker, git/curl/jq; pinned versions on the page include "Python 3.12.11", "node: v22.16.0", "eslint: v9.29.0", "prettier: 3.5.3", "ruff: 0.12.0". Linters/formatters yes; **no LSP mentioned**.
- Setup script optional; then "a snapshot of your environment is taken. This snapshot will be used for future Jules tasks started from this repository." No expiry documented, no local-reuse claim, no first-run cost figure [gap].

### 1.7 Cognition Devin

Sources: https://docs.devin.ai/onboard-devin/environment.md ; https://docs.devin.ai/onboard-devin/environment/blueprints.md

- "A **Blueprint** is a YAML configuration that describes what to install and how to set up Devin's environment." Cognition's own analogy: Blueprint ≈ Dockerfile, Build ≈ `docker build`, Snapshot ≈ image. "Each organization has one active snapshot. Every session boots a fresh copy."
- Three setup methods: assisted (Devin "figures out which tools, runtimes, and dependencies are needed, and generates the blueprint for you"), declarative YAML, manual.
- No devcontainer support, no host-reuse, no LSP found in pages fetched. `blueprint-reference.md` not fetched [gap].

### 1.8 Cursor cloud agents

Source: https://cursor.com/docs/cloud-agent/setup

- `.cursor/environment.json` with `install` ("must be idempotent. It runs for every Build"), `start`, `terminals`, `build.dockerfile` + `context`, or a dashboard `snapshot` ID. "Create a Dockerfile to install system-level dependencies, use specific compiler versions, install debuggers, or switch the base OS image."
- No host-reuse statement; cloud-only definition [unverified whether Cursor intends any host path]. No LSP/linter docs on the page.

### 1.9 Docker Sandboxes (`sbx`) — templates and kits

Sources (docs source in github.com/docker/docs, fetched via `gh api`): https://docs.docker.com/ai/sandboxes/customize/templates/ ; https://docs.docker.com/ai/sandboxes/customize/kits/ ; https://docs.docker.com/ai/sandboxes/customize/kit-reference/ ; v2 grammar https://github.com/docker/sbx-kits-contrib/blob/main/spec/SPEC-v2.md

- **Base image per agent.** "All sandbox templates are published as `docker/sandbox-templates:<variant>`. They are based on Ubuntu and run as a non-root `agent` user with sudo access. Most variants include Git, Docker CLI, and common development tools like Node.js, Python, Go, and Java." Variants: `claude-code`, `claude-code-minimal` ("no Node.js, Python, Go, or Java"), `codex`, `copilot`, `cursor-agent`, `devin`, `docker-agent`, `droid`, `gemini`, `kiro`, `opencode`, `shell`; each with a `-docker` variant (default). Measured on this machine 2026-08-15 [local, `domains/dev/config/sbx/kits/agents/claude/spec.yaml.in`]: Ubuntu 26.04, node v22.22.1, git, jq, python3, rg, npm/npx, uv, gh, curl present; zsh, mise, fd missing.
- **Templates = bake once (Dockerfile or save a sandbox).** "Custom templates are reusable sandbox images that extend one of the built-in agent environments with additional tools and configuration baked in." Example: `FROM docker/sandbox-templates:claude-code` + `apt-get install -y protobuf-compiler` as root + `rustup` as `agent`. "Tools that install into the home directory, such as `rustup`, `nvm`, or `pyenv`, must run as `agent` — otherwise they install under `/root/`." Templates are tied to one agent: "The agent you specify must match the base image variant your template extends." Also `sbx template save <sandbox> <name:tag>` snapshots a running sandbox. Caching: "Cached images persist across sandbox creation and deletion, and are cleared when you run `sbx reset`."
- **Kits = declarative runtime layering, experimental.** "Kits are experimental. The kit file format, CLI commands, and experience … are subject to change." `spec.yaml` declares tools to install, env, credentials, network rules, files, startup commands, agent memory. "**Install commands** run once at creation; **startup commands** run each time the sandbox starts." Install commands go "via `apt`, `pip`, `npm`, `curl | bash`, or whatever fits". Mixins (`kind: mixin`) "extend an existing agent … Stack several on the same sandbox"; sandbox kits (`kind: sandbox`) define a whole agent. `requires: agent: claude` "takes one base-agent name … enforced during composition." Schema: "Starting with Docker Sandboxes version 0.36, two schema versions are supported. Use `schemaVersion: "2"` for new kits."
- **Cross-agent sharing is possible when the base images agree.** The `ruff-lint` kit in https://github.com/dvdksn/kits-cookbook (`uv tool install ruff@latest`) says: "The built-in `claude`, `codex`, and `gemini` agent templates already include `uv`, so the install command works without bootstrapping it." A kit without `requires.agent` is loaded against any agent via `--kit`.
- **No cross-sandbox cache for kit installs**: kit install commands re-run on every creation; the only cache is a baked template. Kit signatures cover `spec.yaml` and `files/` but "not mutable dependencies such as image tags or content downloaded by install and startup commands."
- LSP: one community kit wires an LSP-like server: https://github.com/shelajev/ij-lsp-sbx-kit (3 stars) — "On first creation, the kit downloads and checksum-verifies the approximately 1 GB platform-specific IntelliJ server". No official LSP kit.
- Ecosystem: https://github.com/ajeetraina/awesome-docker-sbx , https://github.com/maxkrivich/sbx-toolkit (`templates/mise/Dockerfile`, "docker build --build-arg AGENT=claude-code"), https://github.com/erkannt/sbx-templates (`Dockerfile.claude-code-mise-puppeteer` layering mise on `docker/sandbox-templates:claude-code-docker`).

### 1.10 Dagger container-use

Source: https://container-use.com/environment-configuration.md ; https://github.com/dagger/container-use

- `.container-use/environment.json`, committed to share with the team; default base "Ubuntu 24.04 with standard tools (git, curl, bash, apt)"; `container-use config base-image set python:3.11`; setup commands (before code copy) vs install commands (after). Agent changes are "ephemeral until you import them with `container-use config import`." Works "with any agent, model, or infrastructure." No LSP mention. Box-only definition.

### 1.11 E2B / Daytona / Modal

- E2B (https://docs.e2b.dev/template/quickstart): "Template — Defines what environment a sandbox starts with." `.fromBaseImage()`, `.fromTemplate()` to reuse layers, start command pre-warm. `e2b.toml` field list not fetched [unverified].
- Daytona (https://www.daytona.io/docs/en/snapshots ; https://www.daytona.io/docs/en/declarative-builder): snapshots "including the filesystem, installed packages, dependencies, and settings"; default snapshots ship `@anthropic-ai/claude-code`, `anthropic`, `claude-agent-sdk` preinstalled; declarative builder `Image.base()/pip_install()/run_commands()/from_dockerfile()`; "Declarative images are cached for 24 hours". Custom images need an explicit tag/digest. No devcontainer.json support found in current docs.
- Modal (https://modal.com/docs/guide/images ; https://modal.com/docs/guide/sandbox-snapshots): Python-defined `Image.debian_slim().uv_pip_install(...).apt_install(...)`, "Images are cached per layer (i.e., per `Image` method call)"; filesystem snapshots (diff-based, 30-day TTL) and experimental memory snapshots (7-day TTL, "Snapshotting a Sandbox will currently cause it to terminate").
- None of the three mention LSP. All are box-only definitions.

### 1.12 Coder

Sources: https://coder.com/docs/ai-coder ; https://github.com/coder/envbuilder ; https://coder.com/docs/user-guides/workspace-dotfiles

- Agents are Terraform modules in the workspace template: `module "claude-code" { source = "registry.coder.com/coder/claude-code/coder" … }`.
- Envbuilder "Supports `devcontainer.json` and `Dockerfile`" and "Cache image layers with registries for speedy builds" — but "`envbuilder` is in maintenance mode and no new features are planned."
- `coder dotfiles <repo>` applies personal dotfiles (auto-runs `install.sh`, `bootstrap.sh`, `setup.sh` …) — personalization, separate from template toolchain provisioning.

### 1.13 GitHub Copilot coding agent

Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment

- `.github/workflows/copilot-setup-steps.yml`: "looks like a normal GitHub Actions workflow file, but must contain a single `copilot-setup-steps` job"; `timeout-minutes` max 59; only from the default branch. Rationale: "Copilot can discover and install these dependencies itself via a process of trial and error, but this can be slow and unreliable." No devcontainer.json involvement. Box-only.

---

## 2. Cross-tool specs

### 2.1 Dev Containers spec + Features

Sources: https://containers.dev/ ; https://containers.dev/implementors/features/ ; https://containers.dev/features ; https://github.com/devcontainers-extra/features/tree/main/src/mise

- Container-only by construction: a feature's `install.sh` "should be executed as `root` during a container image build." Nothing in the spec applies to the host.
- Catalog has language features (`ghcr.io/devcontainers/features/{go,rust,python,node,java,dotnet,ruby,php}`), a `nix` feature, two community `mise` features (`ghcr.io/devcontainers-extra/features/mise:1`, `ghcr.io/jsburckhardt/devcontainer-features/mise:1`), an `asdf-package` feature, a `ruff` feature. **No dedicated gopls / rust-analyzer / typescript-language-server / biome feature found** [catalog search via fetch summary, not exhaustive].
- In practice the convention is `"postCreateCommand": "mise trust && mise install"` — `gh search code "mise install" filename:devcontainer.json` returns 30 hits (rubytoolbox, pulumi/pulumi-yaml, hyperledger-indy/indy-vdr, …).
- Pain: "Building and starting our dev container could take several minutes if we busted Docker's layer cache" (https://news.ycombinator.com/item?id=38996021). devcontainers/features issues: #1730 "use mise for java feature installation or make sdkman configurable" (https://github.com/devcontainers/features/issues/1730), #1742 Go feature installs unpinned editor tools, #1726 version resolution fails hard, Nix-feature bugs #1505/#1727 (closed 2026-09-16).

### 2.2 mise

Sources: https://mise.jdx.dev/configuration.html ; https://mise.jdx.dev/dev-tools/ ; https://mise.jdx.dev/dev-tools/backends/ ; https://mise.jdx.dev/mise-cookbook/docker.html ; https://mise.jdx.dev/dev-tools/mise-lock.html ; https://mise.jdx.dev/configuration/environments ; registry source https://github.com/jdx/mise/tree/main/registry

- Hierarchy: project `mise.toml` (+ `mise.local.toml`) → `~/.config/mise/config.toml` → `/etc/mise/config.toml`; "what is defined there overrides anything set in `~/src/work/mise.toml` or `~/.config/mise.toml`."
- **One file, both OSes.** Per-tool `os` (docs/dev-tools "OS-Specific Tools", verbatim from the repo source of https://mise.jdx.dev/dev-tools/): `ripgrep = { version = "latest", os = ["linux", "macos"] }`, `hk = { version = "latest", os = ["linux", "macos/arm64"] }`. Platform config files `mise.macos-arm64.toml`, `mise.unix.toml` via `auto_env` ("currently **disabled by default**. Starting with mise `2027.6.0`, it will be enabled by default"). Env files `mise.<env>.toml` via `MISE_ENV`.
- **Lockfile is per-platform**: `[tools.node."platforms.macos-arm64"] checksum = "sha256:…" url = "https://nodejs.org/dist/v26.8.1/node-v26.8.1-darwin-arm64.tar.gz"`; `mise lock --platform linux-x64,macos-arm64` pre-populates entries. URL checks "skip backends that cannot record a download URL: `asdf`, `cargo`, `gem`, `go`, `npm`, `pypi`/`pipx`, `ubi`, `core:dotnet`, `core:rust`, `core:swift`, and vfox".
- **Docker path is documented**: images `ghcr.io/jdx/mise` (scratch) and `ghcr.io/jdx/mise:<ver>-debian`, amd64/arm64. Cookbook Dockerfile: `FROM ghcr.io/jdx/mise:2026.9.11-debian` / `COPY mise.toml ./` / `RUN mise trust && mise install` / `COPY . .` — "also copy `mise.lock` if the project has one", and copy config before source to keep the install layer cached. The doc does not say "same file as the host", but the pattern is literally copying the same file.
- Backends: core, asdf, aqua, ubi, npm, cargo, pipx, go, github, gitlab, forgejo, http, s3, vfox, dotnet, gem, spm (one fetch also returned "packslip"/"conda" — treat as hallucinated, not confirmed).
- **LSP/linter coverage, checked against the registry directory (1,004 entries) on 2026-09-22:** present as short names: `rust-analyzer` (`aqua:rust-lang/rust-analyzer`), `lua-language-server`, `terraform-lsp`, `ruff`, `biome` ("usable via CLI and LSP"), `golangci-lint`, `shellcheck`, `shfmt`, `ripgrep`, `fd`, `jq`, `delta`, `taplo`, `prettier`, `oxlint`, `ty`, `black`, `github-cli` (alias `gh`), `clang`, `clang-format`. **Absent as short names**: `gopls`, `typescript-language-server`, `pyright`, `basedpyright`, `bash-language-server`, `yaml-language-server`, `vscode-langservers-extracted`, `clangd`, `eslint`, `mypy`. Those are still installable through generic backends without a registry entry: `go:golang.org/x/tools/gopls` (go backend "builds Go command-line packages with `go install`", https://mise.jdx.dev/dev-tools/backends/go.html), `npm:typescript-language-server`, `npm:pyright`, `pipx:mypy` (npm backend example: `mise use node@24 npm:prettier`, https://mise.jdx.dev/dev-tools/backends/npm.html). So mise can express every LSP in Claude Code's official table, but roughly half need backend-prefixed names, and npm/go/pipx-backed entries are not URL-locked in `mise.lock`.
- Practitioner reports specific to agent sandboxes: see §4 (metabase, cosai ADR, cmux, kuberpult, sailing). No blog post or HN thread specifically on "mise for agent boxes" was found; the evidence is in repos.
- Known host-side hazard for agents: Claude Code #89422 "Retry/refresh the shell snapshot when a Bash tool command fails with 'command not found' for a binary that exists on PATH in an interactive shell (nvm/fnm/asdf-style version managers)" (https://github.com/anthropics/claude-code/issues/89422) — shim/PATH staleness applies to mise too [inference].

### 2.3 asdf / `.tool-versions`

Source: https://asdf-vm.com/ ; https://mise.jdx.dev/dev-tools/backends/

- ".tool-versions to manage all your tools, runtimes and their versions in a single, sharable place." mise reads `.tool-versions` and uses asdf plugins as a backend described as "Legacy plugin system for tool management." Cross-OS in principle; no agent-specific reports found.

### 2.4 Nix / devenv / flox / devbox / Nixcage

Sources: https://devenv.sh/ ; https://flox.dev/docs ; https://www.jetify.com/devbox/docs/ ; devbox CLI source https://github.com/jetify-com/devbox (internal/boxcli/generate.go) ; https://github.com/hamidr/nixcage ; https://github.com/nix-community/home-manager

- devenv: `devenv.nix` with `languages.*`; "Build OCI containers from your dev environment. Same packages, same versions, same behavior." (exact `devenv container` invocation not quoted [gap]).
- flox: "Use the same setup across macOS and Linux, on both x86 and Arm"; "use Flox `containerize` to package your environments as OCI images—fully pinned and runnable anywhere."
- devbox: "declare your environment exactly once, and use that single definition in several different ways, including: A local shell created through `devbox shell` / A devcontainer you can use with VSCode / A Dockerfile so you can build a production image with the exact same tools you used for development." Subcommands from source: `devbox generate devcontainer` ("Generate Dockerfile and devcontainer.json files under .devcontainer/ directory"), `devbox generate dockerfile` ("Generate a Dockerfile that replicates devbox shell"), `devbox generate direnv`.
- home-manager has `programs.claude-code` with an `lspServers` option (example `go = { command = "gopls"; args = [ "serve" ]; extensionToLanguage = { ".go" = "go"; }; }`, https://github.com/nix-community/home-manager/blob/master/modules/programs/claude-code/options.nix). https://github.com/wimpysworld/nix-config (718 stars) sets `claude-code.lspServers` per language module (e.g. `nix = { command = lib.getExe pkgs.nixd; … }`), so LSP binary and Claude Code wiring come from one Nix expression. **No example found of the same Nix definition also building a Linux sandbox image** [unverified for wimpysworld; none found elsewhere].
- Nixcage (19 stars, https://github.com/hamidr/nixcage, HN https://news.ycombinator.com/item?id=47365963): "per-project sandboxes that activate automatically when you cd into a directory (via direnv). It uses bubblewrap on Linux and sandbox-exec on macOS — no VMs, no Docker"; `nixcage init --preset claude-code && direnv allow`. Nix-based and agent-specific, but host-process sandboxing, not a box.
- Costs: the one written rejection found is the cosai ADR (§4): "Both are technically stronger than `mise` for pinning, but team familiarity is low and the learning curve … is non-trivial … Nix inside Codespaces is workable but idiosyncratic." Eval time / closure size / macOS dylib complaints not independently sourced this session [gap].

### 2.5 Homebrew Brewfile

Source: https://docs.brew.sh/Brew-Bundle-and-Brewfile

- "Homebrew supports macOS, Linux and WSL, so one command can set up project dependencies across these environments and in continuous-integration services such as GitHub Actions." Brewfile now also covers "Go packages, Cargo packages, npm packages, uv tools" etc. No Linuxbrew-in-agent-sandbox report found; no first-run figures [gap]. Note the sbx base image is Ubuntu with `agent` user + sudo, so Linuxbrew is installable but adds a second package universe on top of apt [inference].

### 2.6 Dockerfile per project (baseline)

- Every vendor's box path bottoms out in a Dockerfile or shell script (§1). Keystone (https://github.com/imbue-ai/keystone, 76 stars) generates `.devcontainer/devcontainer.json` + Dockerfile per repo and runs it in a Modal sandbox: "we've observed Claude attempting potentially dangerous changes to the host system — clearing Docker configuration, changing kernel settings"; "Keystone builds on the existing dev container standard". It avoids the two-list problem by not supporting a native host toolchain at all.
- Vagrant counter-example (https://blog.emilburzo.com/2026/01/running-claude-code-dangerously-safely/): "First boot takes a few minutes to provision everything … after that, `vagrant up` is quite fast." Guest-only definition.

### 2.7 pkgx / proto / aqua / vfox / hermit (brief)

- pkgx (https://pkgx.dev/): ephemeral runner, macOS + Linux, official Docker image; no persistent manifest model.
- proto (https://moonrepo.dev/proto): ".prototools" per dir/project/user, "800+ asdf plugins"; cross-OS.
- aqua (https://aquaproj.github.io/): "Declarative CLI Version Manager … Unify tool versions in teams, projects, and CI"; single binary; checksum + signature verification; is a mise backend.
- vfox (https://vfox.dev/): `.vfox.toml`; is a mise backend.
- Hermit (https://cashapp.github.io/hermit/): repo-embedded shims; "available on any future machine, Linux or Mac, by simply cloning the repository."
- None pitched for agent environments (no statement found).

---

## 3. LSP for agents

| Agent | Consumes LSP? | How binaries are provisioned | Runs inside the box? | Source |
|---|---|---|---|---|
| Claude Code | Yes, via `lspServers` plugins; diagnostics after edits + navigation | User installs binary on PATH; plugin never bundles it | Runs as child process next to `claude`; **not started in cloud sessions**; nothing documented for containers | https://code.claude.com/docs/en/discover-plugins |
| Codex CLI | No (open requests #8633/#8745/#31504) | n/a | n/a | https://github.com/openai/codex/issues/8745 |
| pi | No — `gh api search/code?q=lsp+repo:badlogic/pi-mono` = 0 results (2026-09-22). Third-party: https://github.com/samfoy/pi-lsp-extension (31 stars), https://github.com/code-yeongyu/pi-lsp-client (16 stars) | n/a in core | n/a | https://pi.dev/docs/latest |
| DSH (`@deepseek-ai/dsh`, https://github.com/deepseek-ai/deepseek-harness) | Yes — `packages/lsp/tool-lsp`: `goToDefinition`, `findReferences`, `goToImplementation`, `hover` (read-only) | Not installed by DSH: "The package does not install servers or provide a sandbox: deployments supply commands, mappings, and any required confinement" (`packages/lsp/lsp-stdio/README.md`) | Spawned lazily via `ctx.subprocess`; "the server receives the filesystem and process authority of the mounted execution world" | same repo |
| Serena MCP (29,686 stars) | Yes, 40+ languages | Auto-downloads per-platform, sha256-pinned from GitHub Releases ("rather than relying on the `shellcheck` npm wrapper (which lazily downloads on first invocation and turned the bash LS install into a fragile, network-dependent step)", `src/solidlsp/language_servers/bash_language_server.py`) | Wherever the MCP server runs; ships a Dockerfile | https://github.com/oraios/serena |
| OpenCode | Yes, 30+ built-in servers | Mixed: some auto-install, some require tool on PATH, some require a project dependency | Managed by OpenCode process | https://opencode.ai/docs/lsp/ |
| Aider | No — tree-sitter repo map ("We remove the requirement for users to manually install universal-ctags") | n/a | n/a | https://aider.chat/2023/10/22/repomap.html |

Evidence that LSP helps agents: **no controlled measurement found** for any agent (no SWE-bench-style A/B). Only qualitative vendor claims (Anthropic costs doc; Serena testimonials). Cost evidence is concrete: Anthropic's own fallback is to disable the plugin under memory pressure; CHANGELOG shows fixes for "several memory leaks … LSP documents staying open indefinitely (now LRU with 50-doc cap)" and "a per-turn slowdown when a language server publishes project-wide diagnostics for thousands of files" (https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md); OpenCode: "Language servers can get out of sync, use significant memory, vary by version or project, and slow down agent workflows." Open Claude Code issues: #93474 official plugins "install without their lspServers config", #82592, #91916, #90114 (plugin present, server never registers), #93321 diagnostics race, #84125/#80733 LSP tool stripped from subagents, #89472 "Project-scoped LSP configuration" (feature request, open) — https://github.com/anthropics/claude-code/issues/89472. Serena: #664 "Add CLI command to download language server dependencies" (open, https://github.com/oraios/serena/issues/664), #2045 Dart LS "burns ~1 CPU core continuously at idle", #2008 Kotlin LSP build expired with nothing to pin.

---

## 4. Practitioners and the wild

### 4.1 Repos (via `gh search code` / `gh api`, 2026-09-22)

- **metabase/metabase** (49,367 stars) `dev/docker/claude-code/Dockerfile` (https://github.com/metabase/metabase/blob/master/dev/docker/claude-code/Dockerfile): `RUN curl https://mise.run | sh` / `# Copy project mise.toml to install the same tool versions` / `COPY --chown=claude:claude mise.toml /home/claude/.config/mise/config.toml` / `RUN mise trust …` / `RUN mise install` / `ENV PATH="/home/claude/.local/share/mise/shims:$PATH"` / `ENV MISE_YES=1`; also `# Create non-root user (--dangerously-skip-permissions refuses to run as root)`. This is the clearest "same file on host and box" instance found.
- **cosai-oasis/secure-ai-tooling** (97 stars) ADR-003, Accepted 2026-04-20 (https://github.com/cosai-oasis/secure-ai-tooling/blob/main/docs/adr/003-devcontainer-mise-architecture.md): "Tool versions declared in `.mise.toml` at the repo root … This file is the single source of truth: the Dockerfile, `install-deps.sh`, and `verify-deps.sh` all derive versions from it rather than hardcoding." Rejected Nix/devbox (quoted §2.4), apt ("Ubuntu package versions lag upstream"), and nvm+asdf+Pipenv ("multiplies the number of config files"). Failure modes: "VS Code Server does not source `~/.bashrc`. Tools installed into a user-level shim directory … are invisible to VS Code extensions unless the shim directory is injected into the Server process's `PATH`"; "`curl | sh` installers, `pip install`, `npm install`, `sudo`, and `mise trust` all have interactive modes that hang when stdin is not a terminal"; "a fully offline build is not currently supported."
- **manaflow-ai/cmux** (27,309 stars) `web/services/vms/images/devbox/Dockerfile`: `mise reshim` then `claude --version && codex --version && opencode --version && pi --version` as a build smoke test — all agent CLIs mise-managed (https://github.com/manaflow-ai/cmux).
- **buildkite/cleanroom** `images/Dockerfile.base-image-agents`: `/usr/local/bin/{codex,claude,gemini,pi}` symlinked to `/root/.local/share/mise/shims/*` (https://github.com/buildkite/cleanroom).
- **freiheit-com/kuberpult** `.devcontainer/Dockerfile`: "Claude Code can also be managed by 'mise', and if your setup uses 'mise' it is arguably better if you also use 'mise' to manage claude." (https://github.com/freiheit-com/kuberpult)
- **bmwinstead/sailing** `docker/claude-code/Dockerfile`: "Pin versions to match the cluster (kubectl) and this repo's toolchain (mise.toml) so `just` targets behave the same in here" (https://github.com/bmwinstead/sailing).
- **czottmann/macos-agent-ballpits**: `mise use --global claude@latest` (https://github.com/czottmann/macos-agent-ballpits).
- **trailofbits/claude-code-devcontainer** (943 stars): "Sandboxed devcontainer for running Claude Code in bypass mode safely." (https://github.com/trailofbits/claude-code-devcontainer)
- Multi-agent images: `nizos/probity` devcontainer.json `npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest @github/copilot@latest @google/gemini-cli@latest`; `centminmod/claude-code-devcontainers`; lsst-sqre org-wide shared `.devcontainer/stoker/` template.
- Nix side: home-manager `programs.claude-code.lspServers` used by wimpysworld/nix-config, plus `maxhbr/myconfig`, `EdenEast/nyx`, `pinpox/nixos`, `astratagem/dotfield`, `johnae/world` … (host config; no box build found).

### 4.2 Named practitioners

- **Armin Ronacher**, "Agentic Coding Recommendations" (https://lucumr.pocoo.org/2025/6/12/agentic-coding/): "I disable all permission checks. Which basically means I run `claude --dangerously-skip-permissions`… you can manage those risks with moving your dev env into docker." "one of the tools to watch is container-use. It's an MCP server that instructs Claude or other agents to run their experiments entirely in Docker." "Tools need to be **fast**." "I place critical tools into a `Makefile`. A `make dev` command starts my services via a process manager." No LSP or version-manager statement.
- **Mario Zechner**, pi post (https://mariozechner.at/posts/2025-11-30-pi-coding-agent/): "These four tools are all you need for an effective coding agent." "pi runs in full YOLO mode and assumes you know what you're doing." "If you're uncomfortable with full access, run pi inside a container or use a different tool if you need (faux) guardrails." No LSP statement found; "pi avoids LSP" is an inference from the zero code-search hits [unverified as an authorial position].
- **Peter Steinberger**, "Claude Code is My Computer" (https://steipete.me/posts/2025/claude-code-is-my-computer.md): runs `alias cc="claude --dangerously-skip-permissions"` on his host Mac, no container, acknowledging Anthropic's docs say the flag is for "Docker containers with no internet". Negative precedent for boxing.
- **Simon Willison**: "We constrain where and how an agent can act with process sandboxes, VMs, filesystem boundaries, and egress controls." (https://simonwillison.net/2026/May/30/how-we-contain-claude/); on Sprites.dev (https://simonwillison.net/2026/Jan/9/sprites-dev/): "They don't want containers. They don't want 'sandboxes'. They want computers." and "Claude Code and Codex and Gemini CLI and Python 3.13 and Node.js 22.20 and a bunch of other tools are already installed." and "ephemeral sandboxes are obsolete. Stop killing your sandboxes every time you use them." — an argument for persistent boxes (no re-provisioning) rather than for a shared definition.
- **Mitchell Hashimoto**: "My AI Adoption Journey" (https://mitchellh.com/writing/my-ai-adoption-journey) — nothing on environments/VMs/Nix. `mitchellh/nixos-config` README not read [gap]. **No statement found.**
- **Boris Cherny / Anthropic**: best-practices doc (https://code.claude.com/docs/en/best-practices) has no devcontainer/toolchain section; it says "If you use GitHub, install the `gh` CLI" and treats sandboxing as a permissions feature. No personal statement found.
- **Geoffrey Huntley**: https://ghuntley.com/loop/ — nothing on environments; `/stdlib/` serves a different post. **No statement found.**

### 4.3 Complaints in the wild

- Missing toolchain / PATH: Claude Code #92420 "basic binaries missing (ssh, ls, which)" (area:sandbox), #89422 version-manager shim staleness, #3172 Homebrew vs npm-global symlink, #93197 concurrent auto-updates delete the package (https://github.com/anthropics/claude-code/issues/92420 etc.). Copilot doc: trial-and-error install "can be slow and unreliable."
- Slow first run / cache misses: Codex #32209 "Cloud tasks stall at 'Running setup scripts'" (https://github.com/openai/codex/issues/32209), #25086 "does not reuse cached environment and runs full setup on every new message/session" (https://github.com/openai/codex/issues/25086), #23648/#36028/#16859 worktree/remote paths skip the setup script; Claude Code cloud caps setup at ~5 min; sbx kit installs re-run on every creation (§1.9); ij-lsp kit ~1 GB first download.
- Version drift host↔box: Claude Code cloud is x86_64 Ubuntu 24.04 "regardless of your own operating system and CPU architecture"; Codex cloud pins by env var, host by whatever you have; metabase/cosai answer is copying `mise.toml`; devcontainers/features #1742/#1719 show feature version-string regressions.
- arm64/x86: Claude Code #88864 QEMU x86+KVM hangs (https://github.com/anthropics/claude-code/issues/88864), #80574 "unsupported platform: linux-arm64" (https://github.com/anthropics/claude-code/issues/80574); sbx base image is arm64 on Apple Silicon and apt resolves to ports.ubuntu.com [local, `spec.yaml.in`].
- LSP in containers/cloud: no container-specific LSP issue surfaced; the cloud case is by design (no LSP there). Codex #37430 shows a macOS seatbelt sandbox crashing sourcekit-lsp.

---

## 5. Summary table

| Approach | One definition for host + box? | Languages / LSP coverage | First-run cost | Who uses it | Reported problems |
|---|---|---|---|---|---|
| Claude Code cloud setup script + snapshot | No — setup script is cloud-only; `SessionStart` hook shared but only for `npm install`-class steps | 9 language stacks preinstalled, linters yes, **LSP absent by design** | One script ≤ ~5 min, then snapshot ~7 days | Claude Code web / Routines users | Setup must exit 0 in 5 min; x86_64 only; local `~/.claude` config doesn't travel |
| Claude Code devcontainer feature / example | No — container only | Node 20 only in example; LSP not addressed | Docker image build (minutes on cache bust) | Home Assistant, DataDog, Microsoft TypeAgent, trailofbits (943★) | Feature installs only the CLI; toolchain left to repo |
| Claude Code LSP plugins | No — binary must be on host PATH; plugin config travels via marketplace, binary doesn't | 11 languages; navigation + diagnostics | npm/go/rustup install per binary | Anyone with the marketplace | Not in cloud sessions; plugins load with no `lspServers` (#93474 etc.); memory; subagents lose the tool |
| Codex cloud + `codex-universal` | Partial — same *image* runnable locally (`docker run … -e CODEX_ENV_*`); does not define the macOS host | 8 language stacks; no LSP | Setup script per env; cache ≤ 12 h | Codex cloud users | #25086 cache not reused; #32209 stalls; setup env doesn't persist to agent phase |
| Codex CLI local | n/a — no provisioning surface; permission config only | No LSP (open requests) | n/a | — | seatbelt breaks sourcekit-lsp (#37430) |
| Jules / Devin / Cursor / Copilot / container-use / E2B / Daytona / Modal | No — each has its own box-only definition (setup script, Blueprint YAML, environment.json, Actions job, environment.json, template, snapshot/SDK image, Python Image) | Languages via preinstall or Dockerfile; **no LSP story anywhere** | Setup + snapshot; Modal/Daytona layer caches | Their respective customers | Cursor `install` re-runs every Build; Daytona no devcontainer; envbuilder maintenance mode |
| Docker Sandboxes templates + kits | No — Dockerfile/kit describes the box; base image per agent | Base: Node/Python/Go/Java; tools via apt/pip/npm/`curl\|sh`; LSP only via community kit | Kit installs re-run per creation; template = build once; ~seconds–minutes | <user> (yoki-box), dvdksn cookbook, maxkrivich/sbx-toolkit, erkannt (mise on sbx) | Kits "experimental", schema v1→v2 churn; no cross-sandbox install cache; agent config files recreated each create |
| devcontainer.json + Features | No — container only; `devcontainer up` on host still builds a container | Language features yes; LSP features essentially none; `mise` feature exists | Image build; feature installs at build | Very wide (Codespaces, VS Code, Coder envbuilder) | Layer-cache busts "several minutes"; feature version regressions; Nix feature bugs |
| **mise (`mise.toml` + `mise.lock`, copied into Dockerfile)** | **Yes for toolchains + CLIs + most LSPs/linters** — same file on macOS and in `RUN mise install`; per-tool `os = [...]`; per-platform lockfile | Runtimes core; `rust-analyzer`, `ruff`, `biome`, `golangci-lint`, `shellcheck`, `shfmt`, `lua-language-server` as short names; `gopls`, `typescript-language-server`, `pyright` via `go:`/`npm:` prefixes (not URL-locked) | `mise install` per platform (downloads; no cross-OS binary cache); Docker layer cache; `mise.run` installer needs network | metabase (49k★), cmux (27k★), cosai ADR, kuberpult, sailing, buildkite/cleanroom, 30+ devcontainer.json | Shim/PATH invisibility to editor servers; `mise trust` prompts hang unattended builds; installer endpoints must be allow-listed (`mise.run`→`mise.jdx.dev` [local]) |
| Nix family: devbox / devenv / flox | **Yes** — one file → shell on macOS + Linux and an OCI image (`devbox generate dockerfile`, `devenv container`, `flox containerize`) | nixpkgs-wide (all LSPs, linters); home-manager `programs.claude-code.lspServers` wires LSP config | Nix install + evaluation; store downloads; image build | wimpysworld (718★) and other nix-config authors (host only); Nixcage (19★) for agent sandboxing on host; **no box-image-from-same-flake example found** | "team familiarity is low … learning curve" (cosai ADR); Nix-in-devcontainer feature bugs; no cost data sourced this session |
| Homebrew Brewfile | Yes in principle ("macOS, Linux and WSL") | Formulae for most LSPs/linters | Linuxbrew bootstrap in the box (not measured) | No agent-box precedent found | Second package universe beside apt [inference] |
| Hermit / proto / aqua / vfox / pkgx | Yes for CLIs (cross-OS single manifest) | CLI-centric; aqua/vfox are mise backends | Per-tool download | No agent precedent found | — |
| Dockerfile / Vagrantfile only | No — box only | Whatever you script | Minutes on first build/boot | Keystone (76★), emilburzo Vagrant, every vendor internally | Second list for the host is implicit |

---

## 6. Which approaches dominate, which are rare

Dominant for agent boxes (by vendor count and repo volume):
1. **Box-only imperative definition** — a setup script or Dockerfile per box (Claude Code cloud, Codex cloud, Jules, Cursor, Copilot, Docker Sandboxes templates/kits, container-use, E2B, Daytona, Modal). Every vendor does this; none reuses it for the host. Snapshots/caches (7 d / 12 h / 24 h / per-layer) are the universal mitigation for first-run cost.
2. **Preinstalled polyglot base images** (Claude Code cloud, Codex `universal`, Jules, Docker `sandbox-templates`, Daytona defaults) — vendors bet on "most things you need are already there", and pushed linters (ruff/eslint/prettier) but **not language servers** into those images.
3. **mise as the practitioner glue** — the recurring wild pattern is `COPY mise.toml` + `mise install` in the agent Dockerfile, and increasingly `mise` installing the agent CLIs themselves (cmux, cleanroom, kuberpult, ballpits). It is the only "define once" approach with multiple high-star real-world instances and a written ADR.

Rare:
- **Nix-family single-source (devbox/devenv/flox) for agent boxes** — documented capability, no agent-box precedent found; used on hosts by nix-config authors, with LSP wiring via home-manager.
- **Vendor-provided local mirror of the cloud box** — only `codex-universal`.
- **LSP inside the box** — one community sbx kit (IntelliJ), Serena's auto-download, OpenCode's mixed model. No vendor ships LSP in its cloud image; Anthropic disables LSP in cloud sessions outright.
- **Not boxing at all** — Steinberger and Zechner run YOLO on the host; Willison argues for persistent "computers" over ephemeral sandboxes.

---

## 7. Constraints and options for a solo developer (macOS host; Claude Code + Codex + pi + DSH; wants one definition for host and box)

Plain-language constraints, each with the source it comes from:

1. **The box is Linux, the host is macOS, so "one definition" can only mean one *spec* that is re-resolved per platform, never one set of binaries.** mise (`os = [...]`, per-platform lockfile), Nix (per-`system` outputs), Brewfile (Linuxbrew) all work this way; Dockerfiles and devcontainer.json cannot describe the host at all (§2.1, §2.2, §2.4). Docker Sandboxes on Apple Silicon is arm64 Ubuntu; Claude Code cloud is x86_64 — so the lockfile needs `linux-arm64` and `macos-arm64` entries at least (`mise lock --platform`), and `linux-x64` if cloud sessions are ever used.
2. **The four agents have four different LSP postures, so LSP cannot be provisioned "for the agents" as one thing.** Claude Code needs the binaries on PATH plus its marketplace plugins (and gets no LSP in cloud sessions); Codex and pi have none in core; DSH needs binaries on the child PATH and explicitly leaves confinement to the deployment (§3). Any shared list can only guarantee "the binaries exist on PATH in both places"; the per-agent wiring (Claude plugin, DSH profile config, pi extension if any) stays per-agent. Precedent for putting the binary list and the Claude wiring in one file: home-manager `programs.claude-code.lspServers` (wimpysworld) — host only. No precedent found for host + box.
3. **Every box re-runs install on creation unless you bake an image.** sbx kit install commands "run once at creation" per sandbox; Claude Code cloud snapshots after the first run; Codex caches ≤ 12 h. For sbx, the choice is: kit-time install (simple, slow every create, needs `mise.run`/GitHub allow-listed [local]) vs a custom template `FROM docker/sandbox-templates:claude-code` with `mise install` baked (fast, but one template per agent base image because "The agent you specify must match the base image variant your template extends"). Precedent for the template route with mise: erkannt/sbx-templates, maxkrivich/sbx-toolkit (`--build-arg AGENT=…` parameterizes the base image from one Dockerfile).
4. **A mise-based single list covers toolchains, CLIs, linters and all eleven Claude Code LSP binaries, but ~half of the LSPs go through `npm:`/`go:`/`pipx:` backends that `mise.lock` does not URL-lock** (§2.2). The box will resolve `npm:typescript-language-server` fresh each build unless the template bakes it. Precedent: metabase, cosai ADR (Python 3.14 + Node 22 only — no LSP in their list).
5. **Version-manager shims are invisible to processes that don't source the shell** (cosai ADR: VS Code Server; Claude Code #89422: stale shell snapshot). In a box, agents are launched by the sandbox entrypoint, not by an interactive zsh, so `PATH` must include `~/.local/share/mise/shims` at the image/kit level (metabase does `ENV PATH=…/mise/shims:$PATH`; the local claude/codex/omp kits currently install only the mise *binary* (`curl -fsSL https://mise.run | sh`) — no `mise.toml` is copied, `mise install` is never run, and no shim PATH is set, per `grep -n mise domains/dev/config/sbx/kits/agents/*/spec.yaml.in` [local] — [unverified whether sbx launches the agent through a login shell that would activate mise]).
6. **Unattended installs must never prompt**: `mise trust`, `curl | sh`, `sudo`, `npm install` (cosai ADR); metabase sets `MISE_YES=1`.
7. **The host already has two definition layers** [local]: nix-darwin + home-manager + brew-nix in `core/nix/flake.nix` for system packages, and `~/.config/mise/config.toml` for runtimes (python/ruby/node/go/rust/bun/deno/lua). Whatever is chosen should collapse toward one of those rather than add a third.

Options with precedent status:

- **Option A — mise as the single list, host and box.** Move LSP/linter/CLI entries into a mise config that both the host and the box read (global `~/.config/mise/config.toml` copied into the image as metabase does, or a repo-level `mise.toml` for project tools). Box: kit install `curl https://mise.run | sh` + `mise install` (already in the claude kit) or a baked template. Add `mise.lock` with `--platform linux-arm64,macos-arm64`. Per-agent LSP wiring stays separate (Claude plugins, DSH profile). Precedent: metabase, cosai ADR, cmux, cleanroom, sbx-toolkit. Coverage gap: `gopls`/`typescript-language-server`/`pyright` need backend prefixes and are not URL-locked. Cost: mise install per box creation unless templated.
- **Option B — Nix as the single list (devbox/devenv/flox or the existing flake).** Host via home-manager (already present); box via `devbox generate dockerfile` / `flox containerize` / `dockerTools`, or the `ghcr.io/devcontainers/features/nix` feature. Strongest pinning and the only approach that can also carry `programs.claude-code.lspServers` in the same language. Precedent: **none found for an agent box built from the same Nix definition** — hosts only (wimpysworld etc.), and one explicit team rejection on learning-curve grounds (cosai). Extra cost: Nix inside an sbx microVM (store download per create, or a large baked template) — unmeasured.
- **Option C — Brewfile in both places.** One Brewfile, `brew bundle` on macOS and Linuxbrew in the box. Precedent for agent boxes: none found. Not recommended on evidence alone; listed because it is the only other cross-OS manifest the host already speaks (brew-nix).
- **Option D — accept two lists but generate one from the other.** Keep host as-is; derive the box Dockerfile/kit from `mise.toml` + a small LSP list (what cosai's `install-deps.sh`/`verify-deps.sh` do). Precedent: cosai ADR; every vendor implicitly.
- **Option E — don't box LSP at all.** Provide toolchains + linters in the box (what every vendor does) and leave LSP host-only, matching Anthropic's own cloud stance ("Claude Code doesn't start plugin language servers" in cloud) and the absence of any measurement that LSP improves agent outcomes (§3). Precedent: all vendors' cloud images.

Where the evidence is silent ("no precedent found"): a single definition that (a) drives a macOS host, (b) drives a Docker Sandboxes template *and* kit, (c) includes LSP binaries, and (d) is consumed by four different agents' LSP configs. Each pair has precedent (mise host+box: metabase; Nix host+LSP wiring: wimpysworld; sbx kit shared across agents: dvdksn ruff-lint); the full combination does not.

---

## Gaps not closed this session

- Devin `blueprint-reference.md`; Claude Code `/docs/en/routines` page; `codex-universal` Dockerfile apt list; E2B `e2b.toml` reference; Kiro/Antigravity environment docs.
- Mario Zechner / Mitchell Hashimoto / Geoffrey Huntley / Boris Cherny explicit positions on agent environment setup or LSP (none found; not proof of absence).
- Nix macOS cost reports (eval time, closure size) and any Linuxbrew-in-box measurements.
- Whether sbx launches the agent entrypoint with a login shell (affects mise shim PATH) — check with `sbx exec … env` [local].
- Pi third-party LSP extensions' maturity (samfoy/pi-lsp-extension 31★, code-yeongyu/pi-lsp-client 16★) not inspected.
