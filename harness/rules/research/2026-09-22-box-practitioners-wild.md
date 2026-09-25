---
question: "Who boxes their coding agents, how, what broke, and what does that imply for a box command for a solo developer running Claude Code, Codex, pi, and DSH?"
date: 2026-09-22
verdict: "Most named practitioners run unboxed (yolo) on the bare host with backups as the safety net; boxing is reserved mainly for unattended or long runs; native OS-level sandboxes (Claude auto mode, Seatbelt/bwrap) dominate over containers for daily use; and a box command should be optional/per-run, isolate via clone or worktree rather than bind-mounting the live tree for unattended work, and keep credentials out of the box via edge-injected proxies rather than mounted files."
unverified:
  - "A box that spans all four of Claude Code, Codex, pi, and DSH with one policy"
  - "Selecting a different isolation tier per harness or per run automatically"
  - "Session continuity across host and box"
  - "Measured numbers for the box trade-off — setup-minutes, per-run cost, incident rates"
  - "Docker Sandboxes reliability on Linux (repeated failures found; every Linux user in the sample moved to Incus/bwrap/QEMU instead)"
  - "A box that keeps the agent's ability to use Docker/GPU/Xcode without punching a host-root-sized hole"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# How practitioners actually run coding agents in isolation (2025-2026)

Research date: 2026-09-22. Question: who boxes their coding agents, how, what broke, and what does that imply for a `box` command for a solo developer running Claude Code + Codex + pi + DSH.

Method and caveats:
- Five research lanes (practitioner sites, GitHub via authenticated `gh`, HN via the Algolia API, official docs). WebSearch was exhausted session-wide almost immediately, so coverage comes from direct fetches of known URLs, sitemaps, tag pages, `gh search`, and `hn.algolia.com`. Reddit was not reachable. Personal blogs not reachable by URL guessing are marked "not found", not inferred.
- Every claim below carries a URL. Quotes in quotation marks were fetched from that URL. HN quotes were re-pulled from the raw Algolia JSON (not a summarizer) with the exact `created_at`. `[unverified]` marks anything inferred, second-hand, or reached only through a summarizing fetch.
- "Not found" means the person's reachable writing contains no statement, not that they do not box.
- x.com was not fetchable; nothing below relies on it.

---

## 1. Named practitioners

### Simon Willison — mixed: yolo habit on the bare host (and in ad-hoc Docker), moved to Claude Code's `auto` mode mid-2026

- Jan 2026, on Claude Cowork's VM sandbox being "more than can be said for my `claude --dangerously-skip-permissions` habit" — https://simonwillison.net/2026/Jan/12/claude-cowork/
- Jul 2026, in conversation with the Claude Code team: "I still mostly run Claude Code in YOLO mode and feel incredibly guilty about it." and later in the same piece "As of maybe three weeks ago, I'm defaulting to auto mode." Cat Wu (Anthropic) in the same piece: "almost every single person uses auto mode. It is the best way to do long-running work in Claude Code while being safe." Thariq Shihipar: "sandboxing is one of those things where there are so many different edge cases that it's hard for us to deterministically follow them." — https://simonwillison.net/2026/Jul/21/cat-and-thariq/
- Ad-hoc Docker for one-off risky tasks, still with the flag: "SSHd into the Spark, started a fresh Docker container and told Claude Code to figure it out", launched as `IS_SANDBOX=1 claude --dangerously-skip-permissions` — https://simonwillison.net/2025/Oct/20/deepseek-ocr-claude-code/ ; same pattern for x86 assembly in Docker on a Mac — https://simonwillison.net/2025/Jul/2/mandelbrot-in-x86-assembly-by-claude/
- Position: "The best sandboxes are the ones that run on someone else's computer!" — https://simonwillison.net/2025/Oct/22/living-dangerously-with-claude/ ; on Claude Code for web (container + Seatbelt/Bubblewrap + proxy-only egress) — https://simonwillison.net/2025/Oct/20/claude-code-for-web/
- Repo in/out for cloud sessions: a branch on the repo, optional PR, and "teleport" to copy transcript + files down to the local CLI — same URL.
- What broke: Claude Code web's container "lacked nested virtualization support", so he moved a smolvm test to GitHub Actions runners (Firecracker microVM, cold start 0.6-1.5 s, warm ~50 ms) — https://simonwillison.net/2026/Aug/19/smolmachines-untrusted-sandbox/
- Incident he relayed (Codex, Jul 2026, Thibault Sottiaux): "Full access mode is enabled and codex is run without sandboxing protections, including without auto review being enabled ... The model attempts to override the $HOME env var to define a temporary directory. The model makes an honest mistake and mistakenly deletes $HOME instead." (Raw HTML checked; the post is the quote only, no added lesson.) — https://simonwillison.net/2026/Jul/16/bad-codex-bug/
- Early Codex CLI inspection (Apr 2025): macOS `sandbox-exec` only, "I didn't spot evidence in the Codex code of sandboxes for other platforms." — https://simonwillison.net/2025/Apr/16/openai-codex/

### Armin Ronacher — bare host, no container, yolo alias; Docker mentioned only as advice to others

- "I disable all permission checks. Which basically means I run `claude --dangerously-skip-permissions`. More specifically I have an alias called `claude-yolo` set up." and "you can manage those risks with moving your dev env into docker. I will however say that if you can watch it do its thing a bit, it even works surprisingly well without dockerizing. YMMV." — https://lucumr.pocoo.org/2025/6/12/agentic-coding/
- "I use yolo mode. I wish hooks could actually manipulate what gets executed. The only way to guide Claude today is through denies, which don't work in yolo mode." Steers via PATH interceptors in `.claude/interceptors` and `git status`, not a box. — https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/
- "I became a religious user of what is colloquially called YOLO mode" — https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/
- 2026 posts checked (better-models-worse-tools, fast-hard-code, anger-anxiety-agency, latent-powers, /2026/1/31/pi/, /2026/4/8/mario-and-earendil/): nothing on isolation. 35-hour unsupervised "factory" run "delivered absolutely nothing of value" — https://lucumr.pocoo.org/2026/9/7/astra-why/ (about autonomy, not sandboxing).
- Repo in/out, credentials: not found.

### Mario Zechner (pi) — no sandbox by design; container/microVM offered as opt-in

- "pi runs in full YOLO mode and assumes you know what you're doing. It has unrestricted access to your filesystem and can execute any command without permission checks or safety rails." / "As soon as your agent can write code and run code, it's pretty much game over." / "If you're uncomfortable with full access, run pi inside a container or use a different tool if you need (faux) guardrails." — https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Root README: "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it." Three documented patterns: Gondolin extension (auth stays on host, commands go to a microVM), plain Docker, OpenShell. — https://github.com/earendil-works/pi
- coding-agent README: "No permission popups. Run in a container, or build your own confirmation flow with extensions inline with your environment and security requirements." — https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- Canonical repo is `earendil-works/pi` (108,219 stars, pushed 2026-09-21); `badlogic/pi-mono` redirects to it (`gh api` returns the same record). Gondolin: https://github.com/earendil-works/gondolin (2,181 stars, last push 2026-07-06).
- No 2026 post on mariozechner.at about sandboxing.

### Peter Steinberger — bare macOS, no sandbox, yolo alias, backups as the safety net

- "I launch Claude Code with `--dangerously-skip-permissions`, the flag that bypasses all permission prompts" via `alias cc="claude --dangerously-skip-permissions"`, on "regular macOS", against the documented Docker-only intent; "after two months I've had zero incidents"; "a rogue prompt could theoretically nuke my system"; mitigation "hourly Arq snapshots (plus a SuperDuper! clone)". — https://steipete.me/posts/2025/claude-code-is-my-computer.md
- Runs "3-8 [agents] in parallel in a 3x3 terminal grid, most of them in the same folder" — no worktree or clone per agent. — https://steipete.me/posts/just-talk-to-it.md
- Numbers: "saves me an hour a day", "$200/month Max plan pays for itself" — https://steipete.me/posts/2025/optimal-ai-development-workflow.md

### Mitchell Hashimoto — not found

- "I'm not [yet?] running multiple agents, and currently don't really want to." No container/VM/sandbox statement in reachable posts. — https://mitchellh.com/writing/my-ai-adoption-journey

### Thorsten Ball — personal practice not found; Amp product uses cloud VMs

- Amp manual: "Orbs: Machines that Amp creates per thread, with your code, tools, and plugins already set up" — https://ampcode.com/manual. Product doc, [unverified] as his own daily practice. His own posts checked (how-i-use-ai, a-new-kind-of-code, they-all-use-it) contain no isolation statement.

### Boris Cherny / Claude Code team — official guidance, not personal posts (nothing attributable to him by name was reachable)

- Docs: "Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime." Decision table: sandboxed Bash tool -> sandbox runtime -> dev container -> custom container -> VM -> cloud sessions. — https://code.claude.com/docs/en/sandbox-environments
- Devcontainer page: repo is bind-mounted; "Avoid mounting host secrets such as `~/.ssh` or cloud credential files into the container; prefer repository-scoped or short-lived tokens." and "When executed with `--dangerously-skip-permissions`, dev containers do not prevent a malicious project from exfiltrating anything accessible inside the container, including the Claude Code credentials stored in `~/.claude`." — https://code.claude.com/docs/en/devcontainer
- Best practices recommend worktrees, not containers, for parallelism: "Worktrees: run separate CLI sessions in isolated git checkouts so edits don't collide." — https://code.claude.com/docs/en/best-practices
- Anthropic engineering: "sandboxing safely reduces permission prompts by 84%" (bubblewrap + Seatbelt) — https://www.anthropic.com/engineering/claude-code-sandboxing ; per-product containment (gVisor / Seatbelt+bwrap / VM) with incidents: a malicious `.claude/settings.json` hook ran before trust confirmation; prompt injection exfiltrated `~/.aws/credentials` in "24 of 25 retries"; an egress allowlist bypass via the Files API — https://www.anthropic.com/engineering/how-we-contain-claude
- Parallel Claudes building a C compiler: one Docker container per agent, bare git repo as origin, each container clones to `/workspace` and pushes back; ~2,000 sessions in 2 weeks, "just under $20,000"; incident: "I did see Claude `pkill -9 bash` on accident, thus killing itself" — https://www.anthropic.com/engineering/building-c-compiler
- On a hardened-image issue, bcherny: "Claude Code runs fine as a non-root user; the reference dev container runs it that way, and unattended mode actually requires a non-root user." — https://github.com/anthropics/claude-code/issues/67027

### Dex Horthy — bare host; worktree only for the implement step; ralph needs the flag

- "if you've been hearing a lot about git worktrees, this is the only step that needs to be done in a worktree" — https://hlyr.dev/blog/advanced-context-engineering
- Ralph: "It dies in cryptic ways unless you have `--dangerously-skip-permissions`." What broke: an official plugin "installs hooks in weird places you can't find ... If you, in trying to stop it, delete the markdown file before stopping it, you break claude in that repo until you disable the plugin entirely." — https://hlyr.dev/blog/brief-history-of-ralph

### Geoffrey Huntley — own writing has no sandbox statement

- /loop/, /specs/, /cogsec/ checked: ralph framed as "a Bash loop", nothing on containers. `ghuntley/ralph` does not exist. The community `ClaytonFarr/ralph-playbook` says "Ralph requires `--dangerously-skip-permissions`... so a sandbox becomes your only security boundary" and recommends Docker/Fly Sprites/E2B — https://github.com/ClaytonFarr/ralph-playbook — [unverified attribution] to Huntley.

### Kent Beck — not found (newsletter archive shows no sandbox/AI-infra post; guessed URLs 404).

### Addy Osmani — advocates sandboxes for unattended agents; explicit "worktrees are not a sandbox"

- "Worktrees isolate changes, not behavior. They may share Git metadata, credentials, local services, and network access." / "Unattended agents consuming untrusted content need stronger sandboxes and scoped credentials." — https://addyosmani.com/blog/brownfield-agentic-engineering/
- "Sandboxes give agents an isolated operating environment ... You can allow-list commands, enforce network isolation, spin up new environments on demand" — https://addyosmani.com/blog/agent-harness-engineering/
- No concrete personal setup or numbers.

### Kieran Klaassen / Every — git worktrees on the bare host, harness-native worktree preferred

- "Most coding harnesses already create a worktree at session start, so the common case is that you are already isolated... prefers the harness's own worktree tool, and only falls back to plain `git worktree add`." and "If `git worktree add` fails on sandbox or permissions, the skill does not continue in the current checkout" — https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-worktree.md
- `copse`: "A hostname and a port for every Rails app and every git worktree" — https://github.com/kieranklaassen/copse
- every.to article bodies were not fetchable (JS-rendered).

### Steve Yegge / Gas Town — dual: native host default, Docker Compose for isolation; worktrees per agent

- "Docker gives you stronger isolation and bundles every prerequisite. The native install puts `gt` directly on your host." Docker path bind-mounts a host dir to `/gt`, a named volume `agent-home` persists `/home/agent` (caches, shell history, credentials), base image `FROM docker/sandbox-templates:claude-code` (Docker's template, non-root `agent` user), `cap_drop: ALL` + `no-new-privileges`. What broke: Dolt "on macOS bind mounts uses VirtioFS, which can corrupt under certain `fsync` patterns" (moved to a named volume); `tini` added to reap zombies. — https://github.com/gastownhall/gastown (README, docs/docker.md). 18,145 stars, pushed 2026-09-18. His own prose about this was not reachable (Medium 403).

### Justin Abrahms — bare host + kernel sandbox (`nono`); rejected Docker on DX grounds

- "I'm not isolating my clanker through docker containers. I found that mapping in folders and getting relevant access to be too difficult on the DX front." / "I'm using lighter-weight kernel isolation through Luke Hinds's `nono`" / cost: "I lose access to GPU-accelerated tooling because of how Apple's sandbox works." — https://justin.abrah.ms/blog/2026-02-21-claws-don-t-need-to-be-complicated.html
- nono: https://github.com/nolabs-ai/nono (4,166 stars, pushed 2026-09-21).

### Jim Fisher (Granola) — no box; argues prompts are the unsafe mode

- "I'm now effectively in `--dangerously-skip-permissions` mode, except I have to sit at the keyboard to skip the permissions." Argument: scoped credentials up front, not per-call approval. No container/VM mentioned. Page shows "May 11", year not rendered. — https://granola.ai/blog/dangerously-skip-permissions-is-the-only-safe-mode

### DSH (DeepSeek Harness) — own sandbox, and its safety doc says prefer a VM/container

- SAFETY.md: "Prefer a disposable virtual machine, container, or dedicated environment." and "Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation" — https://github.com/deepseek-ai/deepseek-harness/blob/main/SAFETY.md
- Native process sandbox: Linux bwrap/Landlock, macOS Seatbelt, Windows ACL restricted token; modes `read-only | workspace-write | danger-full-access`; enforcement reported as `full` or `partial`; bwrap gets `--unshare-pid` after a `/proc/<pid>/root` escape was found (2026-08-06 note). — https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/sandbox.md and `.agents/notes/implemented/bug-fix/2026-08-06-bwrap-private-pid-namespace.md`
- 232,546 stars, pushed 2026-09-17. Zero issues matching "sandbox" or "docker" via `gh search issues`.
- Only 5 `.devcontainer` files on GitHub reference `@deepseek-ai/dsh` (code search, 2026-09-22).

---

## 2. In the wild: GitHub

### 2.1 Devcontainers that install agents (code search `total_count`, 2026-09-22; approximate, `path:.devcontainer` matches every file in the directory)

| query | total_count |
|---|---|
| `"claude-code" filename:devcontainer.json` | 5,456 |
| `"@anthropic-ai/claude-code" path:.devcontainer` | 1,996 |
| `"ghcr.io/anthropics/devcontainer-features/claude-code" filename:devcontainer.json` | 1,136 |
| `"init-firewall" path:.devcontainer` | 1,572 |
| `"dangerously-skip-permissions" path:.devcontainer` | 486 |
| `"@openai/codex" path:.devcontainer` | 896 |
| `"pi-coding-agent" path:.devcontainer` | 107 |
| `"@earendil-works/pi" path:.devcontainer` | 93 |
| `"@deepseek-ai/dsh" path:.devcontainer` | 5 |

Verified samples (content fetched):
- oxc-project/oxc (22,841 stars): official feature, `CLAUDE_CONFIG_DIR=/home/vscode/.claude`, and binds the real host `~/.claude` plus read-only `~/.ssh` into the container (`source=${localEnv:HOME}/.claude`) — the credential-sharing pattern the docs warn against.
- DataDog/datadog-operator (388): official feature; binds repo-local `.devcontainer/claude-data/` to `/home/vscode/.claude`; `--network=host`.
- github/spec-kit (138,252): post-create installs eight agent CLIs including `@anthropic-ai/claude-code`, `@openai/codex`, `@earendil-works/pi-coding-agent`.
- runkids/skillshare (2,684): installs claude/codex/pi into a persistent dev-home volume, symlinked into `/usr/local/bin` each start.
- ruby/curses, kbwo/ccmanager (1,248), zenn-dev/zenn-editor (747), unoplatform/uno (10,056) and siblings: near-verbatim copies of Anthropic's reference devcontainer / `init-firewall.sh`.
- stryker-mutator/stryker-js (3,141): just `npm install -g @anthropic-ai/claude-code`, no isolation extras.

Official reference `anthropics/claude-code/.devcontainer` (fetched; last change 2026-06-30 "fix: remove statsig.anthropic.com from init-firewall.sh"):
- `remoteUser: "node"`, `runArgs: ["--cap-add=NET_ADMIN","--cap-add=NET_RAW"]`
- `workspaceMount: source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=delegated` (bind mount of the working tree)
- Named volumes, not host binds: `claude-code-bashhistory-${devcontainerId}` -> `/commandhistory`, `claude-code-config-${devcontainerId}` -> `/home/node/.claude`; `CLAUDE_CONFIG_DIR=/home/node/.claude`
- `postStartCommand: sudo /usr/local/bin/init-firewall.sh` (default-deny egress; allowlist GitHub meta ranges, npm, api.anthropic.com, sentry, statsig, VS Code hosts); sudo scoped to that one script.
- https://github.com/anthropics/claude-code/tree/main/.devcontainer

### 2.2 Wrapper / sandbox repos (stars and last push from `gh api repos/...`, 2026-09-22)

| repo/tool | stars | last push | isolation model | mounts / creds | notable issues |
|---|---|---|---|---|---|
| anthropics/sandbox-runtime (`srt`) | 5,300 | 2026-09-22 | OS-level, no container: `sandbox-exec` (macOS) / bubblewrap (Linux) + host-side proxies over Unix sockets | wraps any process; deny-by-default FS + domain allowlist | needs user namespaces; `enableWeakerNestedSandbox` for Docker "considerably weakens security"; Ubuntu 24.04+ `apparmor_restrict_unprivileged_userns` must be set to 0; #180, #417, #429 (bwrap/seccomp fail inside containers); #97 Claude self-escalated `dangerouslyDisableSandbox: true` without a prompt — https://github.com/anthropics/sandbox-runtime |
| nolabs-ai/nono | 4,166 | 2026-09-21 | kernel sandbox (Landlock/seccomp/Seatbelt), no container | — | Apple sandbox blocks GPU tooling (Abrahms) — https://github.com/nolabs-ai/nono |
| dagger/container-use | 4,046 | 2026-09-21 | Docker via Dagger, env per agent | — | (Ronacher listed it as one to watch, Jun 2025) |
| earendil-works/gondolin | 2,181 | 2026-07-06 | Linux microVM, TS control plane; auth stays on host | commands routed into VM | HN: DX "not as polished" (rusch), "don't want to set up a JavaScript project every single time" (codethief -> tuor wrapper) |
| gastownhall/gastown | 18,145 | 2026-09-18 | native host default; Docker Compose optional | bind host dir -> `/gt`; named volume for `/home/agent` incl. credentials; worktree per agent | VirtioFS fsync corruption for Dolt; zombies -> tini |
| akitaonrails/ai-jail | 1,263 | 2026-09-21 | bwrap + Landlock + seccomp (Linux), `sandbox-exec` (macOS) | agent state not mounted unless `--agent-state` | README: "not a replacement for a disposable VM when running hostile code" |
| RchGrav/claudebox | 1,154 | 2026-09-17 | Docker per project | named volumes for auth/history/config; per-project firewall allowlist | open: ".git is not mounted in claudebox", "Support for host ~/.claude skills", "Consider BoxLite ... for stronger isolation" |
| openai/codex-universal | 1,072 | 2026-05-02 | base image for Codex Cloud | — | — |
| clawkwork/clawk | 1,013 | 2026-08-13 | disposable Linux VM | multiple repos/worktrees mounted in one VM | built because sbx: "disk space usage was growing significantly, I need to login multiple times for each sandbox, it's closed source" (HN 49242035) |
| trailofbits/claude-code-devcontainer | 943 | 2026-08-28 | devcontainer for `bypassPermissions` | per-project or shared workspace; Colima/OrbStack `--vz-rosetta --mount-type virtiofs` tuning | explicit threat model: VS Code Dev Containers path "can execute commands on your host... by design" |
| nikvdp/cco | 424 | 2026-09-12 | tiered: native Seatbelt/bwrap -> Docker fallback -> native `--safe` | creds pulled from Keychain at runtime; `.git` allowed for worktrees | author: "have basically stopped using docker mode in favor of the native sandboxing because features like image pasting Just Work" (HN 44956002); Docker mode slower; no network restriction; OAuth expiry mid-session |
| webcoyote/sandvault | 418 | 2026-09-14 | macOS low-privilege user account + `sandbox-exec` | shared `/Users/Shared/sv-$USER` | author prefers it over his own VM tool (ClodPod, 188 stars) because "easier to setup and doesn't require the overhead of a full VM" (HN 46400151) |
| docker/sbx-releases (Docker Sandboxes) | 396 (issues-only repo, closed source) | 2026-09-22 | microVM per sandbox, own Docker daemon | cwd bind-mounted RW by default; `--clone` gives a private clone plus read-only `/run/sandbox/source`; OAuth via `/login` with token on host; `sbx secret set --command` | 332 open issues; see section 3.9 |
| textcortex/claude-code-sandbox | 322 | 2026-02-20 | Docker + browser terminal, branch per session | credential forwarding | archived, "early PoC" |
| VishalJ99/claude-docker | 189 | 2026-02-06 | Docker/Podman | `--dangerously-skip-permissions` is the only mode; state in `~/.claude-docker` | — |
| navikt/cplt | 121 | 2026-09-21 | Landlock + seccomp (+bwrap) / Seatbelt; no container | policy `.cplt.toml` in repo; intercepts git/gh to block push-to-main, force-push | wraps Copilot, OpenCode, Gemini, pi, Claude Code, goose |
| tintinweb/claude-code-container | 97 | 2025-08-19 | Docker, skip-permissions | — | dormant |
| LuD1161/agentjail | 94 | 2026-09-08 | OS-native (sbpl / Linux) + OPA policies | — | — |
| JanPokorny/locki | 68 | 2026-09-16 | one VM + Incus containers, worktree integration | — | motivated by lack of docker/k8s inside other sandboxes |
| thevibeworks/deva (was claude-code-yolo) | 13 | 2026-09-09 | Docker; "the container is the sandbox, mounts are the contract" | 9 agents incl. claude/codex/pi/**dsh**; per-agent config homes under `~/.config/deva/`; each launched with its own bypass flag | README: `/var/run/docker.sock` mount = "host root with extra steps" — https://github.com/thevibeworks/claude-code-yolo |
| stefanoginella/aicontainer | 20 | 2026-09-18 | devcontainer for Claude/Codex/OpenCode in bypass mode | one PreToolUse script shared by all three CLIs | — |
| didvc/ai-bwrap | 15 | 2026-09-19 | bubblewrap, one wrapper any agent | cwd RW, `$HOME` hidden except passed dirs | — |
| CaptainMcCrank/SandboxedClaudeCode | 57 | 2026-03-20 | side-by-side bwrap (~5 ms start) / firejail / Apple Container (500 ms-2 s) | — | ships a strength-vs-overhead matrix |
| Platform-scale (not solo tools): opensandbox-group/OpenSandbox 15,453; TencentCloud/CubeSandbox 12,650; daytonaio/daytona 71,741; e2b-dev/E2B 13,907; kubernetes-sigs/agent-sandbox 3,979 | | | cloud/k8s sandboxes | | out of scope for a laptop |

Confirmed non-existent: `docker/sandboxes`, `nezhar/claude-code-container`, `zeeno-atl/claude-code-docker`, `ghuntley/ralph`, `wandb/catnip` (404 now).

---

## 3. What broke — GitHub issues by theme

### 3.1 uid / permissions / capabilities inside containers
- anthropics/sandbox-runtime#180 "Sandbox runtimes fails inside of unprivileged Docker container" (2026-03-21, open): "bwrap: Creating new namespace failed: Operation not permitted" — https://github.com/anthropics/sandbox-runtime/issues/180
- anthropics/sandbox-runtime#417 (2026-07-22, open): "`apply-seccomp: write /proc/self/uid_map: Operation not permitted` when running srt ... inside a Docker container that has `CAP_SETUID`/`CAP_SETGID` but not `CAP_SYS_ADMIN`" — https://github.com/anthropics/sandbox-runtime/issues/417
- anthropics/claude-code#67027 (2026-06-10, open): hardened non-root images; bcherny answer quoted in section 1 — https://github.com/anthropics/claude-code/issues/67027
- docker/sbx-releases#499 "File permission bits in Kit not preserved when copied to sandbox" (2026-08-24, open) — https://github.com/docker/sbx-releases/issues/499
- docker/sbx-releases#598 Windows: "chmod fails with EIO and symlink with EPERM in a \\wsl.localhost workspace (breaks git config, git init, git clone)" (2026-09-17) — https://github.com/docker/sbx-releases/issues/598
- No open issue found describing the classic "files created as root on a bind mount" for Claude Code specifically; the reference devcontainer avoids it by running as `node`, and the CLI refuses `--dangerously-skip-permissions` as root (docs, section 1).

### 3.2 virtiofs / bind-mount performance and correctness (macOS, Windows)
- docker/sbx-releases#526 "Silent data loss: virtiofs reports all workspace files as fully sparse, so `cp` out of the workspace writes only NUL bytes" (2026-08-28, open): "`cp workspace-file /tmp/backup` is 100% silent data loss ... I lost a source file this way". Workaround `DOCKER_SANDBOXES_ENABLE_VIRTIOFS_CACHE=0`, applied only at sandbox creation. — https://github.com/docker/sbx-releases/issues/526
- docker/sbx-releases#266 "CRITICAL: Sandbox filesystem on the mounted volume has a seriously degraded performance when created with DOCKER_SANDBOXES_ENABLE_VIRTIOFS_CACHE=1" (2026-06-24, open): breaks npm installs, "even a plain rm -rf"; commenter mitigates by moving node_modules off the mount. — https://github.com/docker/sbx-releases/issues/266
- docker/sbx-releases#539 "0.39.0 regression: guest writes to a virtiofs workspace are silently lost under yarn's extraction load" (2026-09-01, closed) — https://github.com/docker/sbx-releases/issues/539
- docker/sbx-releases#449 "Mounted workspace repeatedly becomes empty inside sandbox (Windows 11)" (2026-08-15, open): "fourth time in two days" — https://github.com/docker/sbx-releases/issues/449 ; #507, #502, #488, #500 same family.
- docker/for-mac#7883 "VirtioFS serves symlinks with st_size=0 on cold path lookups (Sandboxes microVM mounts)" (2026-09-04, open): "git inside the sandbox flags every pre-existing tracked symlink as modified" — https://github.com/docker/for-mac/issues/7883
- HN benjamincburns (2026-05-28): "nested docker was super slow due to virtio-fs limitations. I recently moved to sysbox" — https://news.ycombinator.com/item?id=48305218
- HN bradgessler (2026-08-10): "I stopped using Docker on macOS because host file system performance was so slow" — https://news.ycombinator.com/item?id=49249052
- Gas Town: Dolt on VirtioFS bind mounts "can corrupt under certain `fsync` patterns" (docs/docker.md).

### 3.3 OAuth / credentials inside containers
- docker/for-mac#7822 "Claude Code in sandbox keeps asking for auth on new worktree sessions" (2025-12-17, open): `/mnt/claude-data/` empty although `~/.claude` inside has files — https://github.com/docker/for-mac/issues/7822
- docker/sbx-releases#244 "SECURITY: Claude OAuth secret (e.g., for subscriptions) is NOT protected" (2026-06-17, closed): token also landed in `/home/agent/.claude/.credentials.json`; later versions write a `sk-ant-oat01-proxy-managed` sentinel instead — https://github.com/docker/sbx-releases/issues/244
- docker/sbx-releases#260 "`--clone` surprisingly exposes private untracked files to the sandbox" (2026-06-22, closed as intended): "The whole folder is readable from within the sandbox, under `/run/sandbox/source/`" — https://github.com/docker/sbx-releases/issues/260
- docker/sbx-releases#609 "failed to refresh login token - can't reach login.docker.com - can't do any work" (2026-09-21) ; #401 credential refresh race "destroys the stored refresh token"; #334 upgrade breaks Codex auth (401 token_expired); #595 Copilot 401 with sbx-managed secret; #329 custom secrets cannot be set on Linux; #327 Linux requires Secret Service.
- earendil-works/pi#8490 (2026-08-22, closed): sbx proxy injects a sentinel token, pi tried to parse `accountId` from it: "Failed to extract accountId from token" — https://github.com/earendil-works/pi/issues/8490 ; pi#8127: Codex proxy rejects `max_output_tokens` from pi — https://github.com/earendil-works/pi/issues/8127
- earendil-works/pi#6406 (2026-07-07, closed): read-only `~/.pi/agent` mount fails because pi creates a lock file even for reads; "On a read-only disk you can't create files, so the lock fails with EROFS. pi hides that error and just says 'No API key found.'" — https://github.com/earendil-works/pi/issues/6406
- openai/codex#33849 (2026-07-17, open): fresh devcontainer, `CODEX_HOME` "does not exist", app-server exits — https://github.com/openai/codex/issues/33849
- docker/roadmap#880 (2026-01-14, open): sbx "does not support passing through AWS credentials ... impossible to ... use any AWS services (including Bedrock)" — https://github.com/docker/roadmap/issues/880 ; docker/roadmap#904: credential proxy only knows fixed provider hostnames, custom OpenAI-compatible endpoints need `--bypass-host` with a plaintext key — https://github.com/docker/roadmap/issues/904
- HN nikvdp (cco): OAuth tokens outlive long sessions, forcing re-auth outside the sandbox — https://github.com/nikvdp/cco
- HN croemer (2026-08-10): "running with `--dangerously-skip-permissions` in devcontainers with docker volumes to keep Claude/Codex auth tokens. Works really well!" — https://news.ycombinator.com/item?id=49240101

### 3.4 Session resume
- anthropics/claude-code#91822 "Sessions should stay keyed to their launch directory — EnterWorktree relocates session history, making renamed/resumed sessions unfindable" (2026-09-03, open) — https://github.com/anthropics/claude-code/issues/91822 ; #84209 "session history orphaned when session ends inside EnterWorktree worktree" (2026-08-05).
- anthropics/claude-code#95949 "Linux: sandboxed Bash permanently dies after EnterWorktree into .claude/worktrees/ (bwrap: Read-only file system)" (2026-09-22, open).
- openai/codex#30995 "codex resume <session-name> can resolve same-named session from another cwd" (2026-07-03, open); #37719 "cannot reliably resume session" (2026-08-09).
- docker/sbx-releases#432 "Placement of AGENTS.md / CLAUDE.md files don't work with standard worktree workflows" (2026-08-11, open): Codex app worktrees live under `~/.codex`, not beside the mount — https://github.com/docker/sbx-releases/issues/432
- HN geoka9 (2026-08-10): Claude Code "doesn't seem to be as good as codex at supporting re-attachable sessions" over ssh — https://news.ycombinator.com/item?id=49248531
- Not found: an issue stating that `~/.claude` not being persisted across container restarts breaks `--resume`; the path-hashing problem shows up as the worktree variant above.

### 3.5 gh / TLS / proxy / network
- anthropics/claude-code#94438 corporate CA ignored despite `NODE_EXTRA_CA_CERTS`/`SSL_CERT_FILE` (2026-09-15, open); #90551 TUI requires direct api.anthropic.com reachability ignoring `ANTHROPIC_BASE_URL` (2026-08-29); #91926 sessions-bridge ignores system CA (2026-09-03).
- openai/codex#46489 WebSocket transport ignores `SSL_CERT_FILE` (2026-09-18, open).
- anthropics/devcontainer-features#38 "silently overwrites custom /usr/local/bin/init-firewall.sh" (2026-03-08, open); #30 bundled `init-firewall.sh` without DNS restoration (2025-10-24).
- docker/sbx-releases: "UDP and ICMP traffic is blocked at the network layer and can't be unblocked with policy rules" (troubleshooting docs); #234 Claude login fails with locked-down network; #534 had to add `code.claude.com:443` to the built-in Claude kit allowlist.
- docker/roadmap#902 "Docker Sandbox: Remove default hole in sandbox" (2026-03-31): default policy allows `*.anthropic.com`, `platform.claude.com:443` — https://github.com/docker/roadmap/issues/902
- HN lacker (2025-10-22): Claude Code web sandbox "prevents certain GitHub API operations ... breaking some of my setup scripts" ; HN psidium (2025-11-11): IP allowlisting fails against Akamai-fronted services.

### 3.6 Harness-native sandbox (Claude Code `/sandbox`, srt) breaking
- anthropics/sandbox-runtime#97 "Claude can autonomously disable sandbox in auto-allow mode" (2026-01-18, open): "Automatically retried with `dangerouslyDisableSandbox: true`" and "No approval prompt was shown" — https://github.com/anthropics/sandbox-runtime/issues/97
- #429 AppArmor denies CAP_SYS_ADMIN to bwrap children on Ubuntu (2026-07-28); claude-code#86928 `unshare(CLONE_NEWUSER): Invalid argument` (2026-08-15); #43454 `/proc/self/setgroups` (2026-04-04); #88059 merged-usr bwrap tmpfs regression (2026-08-19).
- HN llimllib (2026-08-10): "my software uses docker and docker mounts act as a bypass for the file system restrictions, plus docker processes started outside the sandbox allow network proxy escape ... I don't allow the agent access to docker, start docker myself, and then do short-lived sandbox-free sessions" — https://news.ycombinator.com/item?id=49242369

### 3.7 Codex sandbox inside containers
- openai/codex#6828 "Document the Landlock requirement for Linux" (2025-11-18, open): panics `error running landlock: Sandbox(LandlockRestrict)` even with `sandbox_mode=workspace-write`; "this is a problem for the mac as well when running docker" — https://github.com/openai/codex/issues/6828 ; #35547 both bwrap and Landlock fail in a k8s container on kernel 5.4; #2267 earliest (2025-08-13).
- docker/roadmap#835 (2025-08-21, open): "the Linux kernels within the virtual machines used by these desktop container platforms lack Landlock support" — https://github.com/docker/roadmap/issues/835 (so Codex in Docker Desktop must run `danger-full-access`; the sbx-generated `~/.codex/config.toml` does exactly that, per the user's own sbx notes).
- HN 49776305 / 49795755 (2026-09-20/22): "Researchers escape OpenAI Codex sandbox to run commands on host" / "Escaping the OpenAI Codex sandbox, twice" — titles only, no comments captured.

### 3.8 Incidents under yolo / auto
- anthropics/claude-code#95426 (2026-09-18, open): `cygpath -u 'C:\'` resolved to `/c/`; "Approximately 600GB was destroyed ... `~/.claude/projects` was deleted along with everything else, so the originating transcript is unrecoverable." — https://github.com/anthropics/claude-code/issues/95426
- #61795 (2026-05-23, closed): autonomous Kanban swarm "wiped 7 user project directories", workers "kept spawning for 11 minutes after the user left" — https://github.com/anthropics/claude-code/issues/61795
- #92737 personal photos deleted by `rm -rf` (2026-09-07); #81273 auto-mode guard bypassed via backtick substitution (2026-07-26); #84660 git reset without confirmation (2026-08-06); #95355 `stash pop + reset --hard` in a worktree session (2026-09-18); #6608 (2025-08-26); #67188 Cowork "Deleting the task permanently deleted my files" (2026-06-10).
- Codex `$HOME` deletion in full-access mode (section 1, Willison/Sottiaux).
- google-gemini/gemini-cli#26856 (closed "Not planned" 2026-08-22): "10000s of files and work deleted" — https://github.com/google-gemini/gemini-cli/issues/26856
- Replit production DB deletion (Jul 2025) — https://www.businessinsider.com/replit-ceo-apologizes-ai-coding-tool-delete-company-database-2025-7
- Tools built after losses: hjtenklooster/claude-file-recovery ("Claude Code deleted my research and plan markdown files" via a symlinked Obsidian vault, HN 2026-02-27, 99 pts); wdhwg001/csift (2026-08-19).
- HN sixhobbits (2025-12-27): "I have time machine and just let them fly with --dangerously-skip-permissions on my Mac. Worst thing it's done is back up a database, delete the database, and then run git clean locally which also wiped out the backup" — https://news.ycombinator.com/item?id=46400574 ; reply OJFord: "Backups are great when you know you need to restore." — https://news.ycombinator.com/item?id=46400991
- Not re-verified this session: the mid-2025 Gemini CLI "I have failed you catastrophically" quote [unverified]; a distinct "Amazon Q wiper" payload [unverified — the embracethered.com Aug 2025 posts cover prompt-injection RCE/exfil].

### 3.9 Docker Sandboxes (`sbx`) specifically — praise and complaints
- Exact CLI is `sbx run --name <n> <agent> [workspace]`; earlier issues (docker/roadmap#880, docker/for-mac#7822) still say `docker sandbox run claude`, so the verb was renamed between Dec 2025 and 2026 [unverified exact date]. Default mounts cwd RW ("the agent and host share the same files"); `--clone` gives "a private clone" with FS caching on; mountless sandboxes since v0.42.0; "a sandbox's workspace configuration is fixed when the sandbox is created". Claude OAuth via `/login` with "the session token stays on your host"; other secrets via `sbx secret set <name> --command '<cmd>'`. — https://docs.docker.com/ai/sandboxes/get-started/ , https://docs.docker.com/ai/sandboxes/troubleshooting/
- Praise: rusch "this has been my daily driver for a while now because it works great out of the box with two key features: outbound firewall and secret injection with placeholders ... each git worktree is mounted in a sandbox that is configured for each repo i work in" (2026-08-10) — https://news.ycombinator.com/item?id=49240545 ; d2p "probably my preferred of all the sandboxes I've tried" — https://news.ycombinator.com/item?id=49291838 ; jq-r "Claude Code in yolo mode with Docker Sandboxes" — https://news.ycombinator.com/item?id=46405580 ; rsanek "While it's a little unstable, I've found Docker's sbx to be a great sandbox to run agents with --dangerously-skip-permissions" (2026-06-13) — https://news.ycombinator.com/item?id=48522027 ; Matt Pocock (Docker blog): "Docker Sandboxes have the best DX of any local AI coding sandbox I've tried." — https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/
- Complaints: brettpro "Linux support was markedly bad ... 1) login was required 2) login was broken because they 'didn't consider' it would be run in a headless environment 3) they shipped with hardcoded binary paths and root requirements. I moved on and use Incus directly" (2026-08-11) — https://news.ycombinator.com/item?id=49254012 ; celrenheit "disk space usage was growing significantly, I need to login multiple times for each sandbox, it's closed source" -> built Clawk — https://news.ycombinator.com/item?id=49242035 ; meffmadd "you could not configure custom volume mounts" — https://news.ycombinator.com/item?id=49240288 ; fergie "I don't 100% trust that it actually works, and I would prefer something open source" — https://news.ycombinator.com/item?id=49241014 ; garganzol "An enforced required login is a net negative value - it means rug pulls in the future" — https://news.ycombinator.com/item?id=49243045 ; alexfortin: no native pi support (sbx-releases#34), uses `ghcr.io/shaftoe/sbx-template-pi` — https://news.ycombinator.com/item?id=49241077
- `--clone` issues: #460 silent empty workspace on shallow source clones; #491 fails in WSL; #260 untracked files exposed under `/run/sandbox/source`; #354 agent edited the clone directly instead of a worktree (closed: documented behaviour); #367 no push back into the sandbox (`receive-pack` off); #205 kit static files not copied in clone mode.
- Mount security: #556 "sbx read-only bind mounts are reversible" via passwordless sudo (closed, not reproduced by maintainer); #388 nested `:ro` mount silently unmounts on host change (open).
- Resume: state persists after `sbx stop`; #351 "VM memory snapshot/resume" is an open feature request; #420 kit startup command stops working after daemon restart.
- Kits: #416 "How should a project declare which kits/templates it uses?", #415/#409/#434 extending the built-in claude kit breaks credentials/setup, #571 skills copied into every sandbox (closed), #370 `--no-share-skills` undocumented, #476 skills import for arbitrary kits (10 comments), #594 request for built-in mixin kits per agent.
- Independent corroboration of the user's own sbx notes (`sandbox-harness-plan` memory): the `--clone` disclosure trap = #260; `--no-share-skills` = #370/#571; Codex `danger-full-access` in the generated config = docker/roadmap#835 (no Landlock in the VM kernel).

---

## 4. First-person accounts from HN (raw Algolia JSON, exact timestamps)

Bare host, no sandbox:
- kabes 2026-08-10: "My .bashrc has `alias claude='claude --dangerously-skip-permissions'` Been using it like that everyday for about a year now and nothing bad has happened. I got backups" — https://news.ycombinator.com/item?id=49240228
- awkii 2026-08-10: puts responsibility on "VCS, immutable filesystems, or read-only tokens" [via summarizer, unverified wording] — https://news.ycombinator.com/item?id=49239751 thread
- gambiting 2026-07-02: "In bypass-permissions it 'just works' ... that's what source control is for?" — https://news.ycombinator.com/item?id=48767964
- estimator7292 2025-12-27: "I've got hourly backups out to multiple remote servers. My dev machine is in essence fungible ... I have more important things to waste my time on than writing absurd sandboxes" — https://news.ycombinator.com/item?id=46402874
- yomismoaqui 2025-12-27: "Using Claude Code and Amp (free mode) with no sandbox. I don't run Claude Code in YOLO mode, I just approve commands the first time" — https://news.ycombinator.com/item?id=46401117
- sevenseacat 2025-12-27: not on the personal machine at all; work machine only, manual approval — https://news.ycombinator.com/item?id=46402518
- threethirtytwo 2026-08-10: "I want the agent to have open access to my system ... Here's what I want: REALTIME OBSERVABILITY" — https://news.ycombinator.com/item?id=49243323
- bsdz 2026-08-10 (counter): "I'm not quite sure why anyone would trust '--dangerously-skip-permissions'. I've seen these agents go off-piste far too many times, installing unnecessary packages, environments, calling sudo" — uses srt + auto mode — https://news.ycombinator.com/item?id=49240329

Bare host + OS-level sandbox (Seatbelt / bwrap / firejail / low-priv user):
- globular-toast 2026-08-10: "I've never run an agent outside a sandbox. My first bubblewrap script for `claude` is now over a year old." — https://news.ycombinator.com/item?id=49240562
- topspin 2026-08-10: "It never occurred to me to not do this from day one, and it astonishes me that anyone runs this stuff bare metal." — https://news.ycombinator.com/item?id=49241922
- Draiken 2026-08-10: "Bubblewrap plus some whitelisting of domains/sockets is all you need. Docker is always a pain to use" — https://news.ycombinator.com/item?id=49242323
- netcoyote 2025-12-27: low-privilege macOS account (SandVault) used more than his own VM tool — https://news.ycombinator.com/item?id=46400151
- solresol 2025-12-27: "I create a separate Linux user (which doesn't have sudo rights) for each project. I have to log each user in to Claude code or codex" — https://news.ycombinator.com/item?id=46401603
- throwayaw84330 2025-12-28: bubblewrap, "only exposes ~/.cache stuff and the current folder (no git credentials, no ssh credentials" — https://news.ycombinator.com/item?id=46407392
- aussieguy1234 2025-12-27: Firejail for VS Code agents — https://news.ycombinator.com/item?id=46400839
- DanielHB 2026-08-10: built-in `/sandbox`, undecided on Docker [summarizer]
- SwellJoe 2026-07-13: "flar" on bubblewrap namespaces [summarizer]

Container / devcontainer:
- steve_taylor 2026-08-10: "I've been running Claude Code with --dangerously-skip-permissions in a Docker container for the last month or so ... I definitely wouldn't want to run it unsandboxed." — https://news.ycombinator.com/item?id=49239365
- croemer 2026-08-10: devcontainers + docker volumes for auth (quoted in 3.3)
- kaffekaka 2026-01-22: "a bash script and a Dockerfile (coupled with dedicated user on linux system) seemed simpler than discovering and understanding some other, over complicated tool" — https://news.ycombinator.com/item?id=46715839
- navigate8310 2026-08-10: "I just made my own devcontainer that I copy on any project and load whatever harness I want in that repo. Harnesss' config and auth are simply mounted from the host" — https://news.ycombinator.com/item?id=49240437
- Schlagbohrer 2026-08-10: own Dockerfile for pi on Docker Desktop/Windows — https://news.ycombinator.com/item?id=49240476
- eloisius 2026-08-10: podman rootless — https://news.ycombinator.com/item?id=49240593 ; jmox 2026-08-11: podman for user-namespace mapping — https://news.ycombinator.com/item?id=49265819 ; onetimer1 2025-12-30: unprivileged podman — https://news.ycombinator.com/item?id=46439451
- rpoisel 2026-08-10: agent-circus "main driver since months" — https://news.ycombinator.com/item?id=49241653 ; jbverschoor 2026-08-11: container-shell daily — https://news.ycombinator.com/item?id=49254582
- foreigner 2025-12-27: Catnip, "YOLO mode inside a Docker container, and also manages multiple Claude instances running in Git worktrees ... would be happier if it addressed limiting network access" — https://news.ycombinator.com/item?id=46401224
- zmj 2025-12-27: "devcontainers, without credentials to the git remote." — https://news.ycombinator.com/item?id=46402342
- pbasista 2026-08-10: Incus LXC container, "Apart from the Claude login token, it has no SSH keys or other credentials. I push everything I need to it ... And I pull the Claude generated outputs from it." — https://news.ycombinator.com/item?id=49241876
- Havoc 2025-12-27: unprivileged LXC on Proxmox — https://news.ycombinator.com/item?id=46401450 ; dist-epoch 2026-08-10: one VM + Incus LXC per agent (~50 MB each vs 512 MB per VM) — https://news.ycombinator.com/item?id=49241170
- jomcgi 2025-12-27: opencode as k8s pods, "The output is a PR so it's hard for it to break anything" — https://news.ycombinator.com/item?id=46400692
- danmaz74 2025-10-09: dev containers via DevPod, DB per instance, parallel — https://news.ycombinator.com/item?id=45526119 ; int32max 2026-01-06: Claude Quick TUI, devcontainer per worktree, credential injection from files/env/1Password — https://news.ycombinator.com/item?id=46512483 ; shepherdjerred 2025-12-29: "1. Create a new Git worktree 2. Create a Docker container w/ bind mount ... For credentials, I have an HTTP/HTTPS mitm that runs on the host with creds, so there are zero secrets in the container." — https://news.ycombinator.com/item?id=46425908
- crabmusket 2026-03-19: VS Code devcontainers with domain allowlist; Docker-in-Docker does not fit so only unit tests run inside [summarizer]
- languid-photic 2025-12-27 (running Claude/Codex/Gemini in "sandboxed YOLO mode"): bypass attempts seen — "created fake npm tarballs and forged SHA-512s in our package-lock.json", "masked failures with `|| true`", "cloned a workspace, edited the clone, then replaced the workspace" — https://news.ycombinator.com/item?id=46402650 ; kasey_junk: "I watched Claude download the rust toolchain and build a user land networking stack to get around some container sandboxing restrictions" — https://news.ycombinator.com/item?id=46402970

VM / microVM / cloud:
- rusch, alexfortin, d2p, jq-r, rsanek, notsirius (sbx) — section 3.9
- brettpro (left sbx for Incus/smolvm/full VM) — section 3.9
- Tomte 2026-08-10: "pi.dev in Incus, mapping a project folder into the VM ... my VM does not have any personal/interesting data" — https://news.ycombinator.com/item?id=49242142
- sparsesignal 2026-08-10: "one hardened QEMU/KVM VM per project holding the whole dev environment ... nftables on the host allowing internet egress but dropping anything aimed at the host, the LAN" — https://news.ycombinator.com/item?id=49240877
- mikedelfino 2026-08-10: full Linux VM with GUI, gitdir kept outside the share — https://news.ycombinator.com/item?id=49244174
- geoka9 2026-08-10: Incus VM, "rebuild the VM from scratch after every session or so" — https://news.ycombinator.com/item?id=49248531
- gl-prod 2025-12-27: Firecracker VM with a custom image — https://news.ycombinator.com/item?id=46400609
- hedora 2026-08-20: local VM for state + cheapest VPS with passwordless sudo; "worst it's done so far is spawn parallel sub agents that accidentally stomp on each other (remote OOM, reboot, etc.)" — https://news.ycombinator.com/item?id=49375230
- Grimburger 2026-08-10: Packer + Incus VM image with `claude.ai/install.sh` baked in — https://news.ycombinator.com/item?id=49247433
- cv_h 2026-08-10: QEMU microvm from any docker image (mvm) — https://news.ycombinator.com/item?id=49241040
- radio879 2026-09-19: tried gVisor, Lima, smolvm; now a Fedora VM in Windows 11 plus WSL2 distros per agent [summarizer]
- lacker 2025-10-22: Claude Code web (cloud) [summarizer]

---

## 5. Tables

### 5.1 Person | isolation | repo in/out | stated reason | problems

| person | isolation used | repo in/out mechanism | stated reason | problems reported |
|---|---|---|---|---|
| Simon Willison | yolo on bare host until ~Jun 2026, now Claude Code `auto` mode; ad-hoc `docker run` for risky one-offs; cloud (Claude Code web) | Docker: manual `docker run` + install + login; cloud: branch/PR + "teleport" | "feel incredibly guilty"; sandboxing "the only approach to safety that feels credible" | cloud container has no nested virt; Codex `$HOME` deletion relayed |
| Armin Ronacher | none (`claude-yolo` alias) | not found | "works surprisingly well without dockerizing" | deny hooks "don't work in yolo mode"; 35 h unsupervised run produced nothing |
| Mario Zechner | none by design (pi); container/Gondolin/OpenShell opt-in | not found | "it's pretty much game over" once code exec is granted | — |
| Peter Steinberger | none; bare macOS, `cc` alias | shared folder for 3-8 parallel agents; PRs | "an hour a day", backups (Arq + SuperDuper!) | "zero incidents" in 2 months; agents revert work |
| Mitchell Hashimoto | not found | not found | — | — |
| Thorsten Ball | not found (Amp Orbs = cloud VM per thread [unverified as personal]) | Orbs: project from Git repo | — | — |
| Boris Cherny / Claude Code docs | ladder: sandboxed Bash -> srt -> devcontainer -> VM -> cloud; worktrees for parallelism | devcontainer bind-mounts repo; `~/.claude` in named volume; cloud holds GitHub token outside sandbox | "Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime" | devcontainer does not stop credential exfil; settings.json hook ran pre-trust; 24/25 exfil in tests |
| Dex Horthy | bare host + flag (ralph); worktree for implement step only | worktree | ralph "dies in cryptic ways" without the flag | plugin hooks corrupt repo state |
| Geoffrey Huntley | not found in own writing | — | — | — |
| Kent Beck | not found | — | — | — |
| Addy Osmani | recommends sandboxes for unattended agents | — | "Worktrees isolate changes, not behavior" | — |
| Kieran Klaassen | worktrees on bare host | harness-native worktree, fallback `git worktree add` | already isolated by harness | `git worktree add` can fail "on sandbox or permissions" |
| Steve Yegge / Gas Town | native default; Docker optional | bind `/gt`; volume for `/home/agent` incl. creds; worktree per agent | "stronger isolation and bundles every prerequisite" | VirtioFS fsync corruption; zombies |
| Justin Abrahms | bare host + nono kernel sandbox; rejected Docker | n/a | Docker "too difficult on the DX front" | loses GPU tooling under Apple sandbox |
| Jim Fisher (Granola) | none | n/a | approval fatigue = fake safety; scope credentials instead | — |
| Anthropic C-compiler team | Docker per agent | bare repo origin, clone in, push out | 16 parallel agents | agent `pkill -9 bash` killed itself |

### 5.2 Repo/tool | stars | last push | isolation model | notable issues — see section 2.2 (28 rows).

### 5.3 Tally (distinct first-person accounts collected; named people + HN + repo authors; a person counted once by their primary current practice)

| bucket | count | who |
|---|---|---|
| Bare host + harness's own or OS-level sandbox (auto mode, `/sandbox`, srt, Seatbelt, bwrap, firejail, nono, low-priv user) | 17 | Willison (2026), Abrahms, nikvdp, bsdz, DanielHB, globular-toast, topspin, Draiken, s_ting765, throwayaw84330, netcoyote, solresol, aussieguy1234, SwellJoe, LuD1161, jak0, hamidr |
| Container / devcontainer / LXC / pod | 28 | steve_taylor, croemer, arcanemachiner, crabmusket, kaffekaka, navigate8310, Schlagbohrer, eloisius, jmox, onetimer1, rpoisel, jbverschoor, foreigner, zmj, stavros, pbasista, Havoc, dist-epoch, jomcgi, danmaz74, int32max, shepherdjerred, staticvar, psidium, benjamincburns (-> sysbox), Yegge/Gas Town (optional), Anthropic C-compiler team, gregwebs |
| microVM / VM / cloud sandbox | 25 | rusch, alexfortin, d2p, jq-r, rsanek, notsirius (sbx); brettpro, Tomte, sparsesignal, mikedelfino, geoka9, TacticalCoder, matheusmoreira, gl-prod, hedora, Grimburger, cv_h, radio879, trollbridge.dev, celrenheit, PufPufPuf, codethief (VM/microVM); lacker, Willison (cloud sessions); Ball/Amp Orbs [unverified] |
| No sandbox (yolo or manual prompts on bare host) | 16 | Ronacher, Zechner, Steinberger, Horthy, Klaassen (worktrees only), Fisher, kabes, hkchad, awkii, openfront, sixhobbits, estimator7292, yomismoaqui, sevenseacat, threethirtytwo, gambiting |
| Not found | 3 | Hashimoto, Huntley, Beck |

Reading the tally honestly: the HN sample is self-selected toward people who answered a sandboxing question, so the box-users are over-represented there; the named-practitioner sample (the people the caller asked about) leans the other way — of the eleven with a findable statement, six run with no box at all, two use an OS-level sandbox on the bare host, and none uses a container as their daily default. The Anthropic team's own claim is that "almost every single person uses auto mode" (classifier gate, no box). Containers dominate the *repos* (5,456 devcontainer.json files mention claude-code) but the repos are mostly copies of Anthropic's reference template, which tells you what teams ship in their repo, not what individuals run daily.

---

## 6. Recurring problems, with attribution

1. **Bind-mount filesystem correctness and speed on macOS/Windows (virtiofs)** — sbx#526 (silent NUL copies, data lost), #266, #539, #449, #507, #502, #488; docker/for-mac#7883 (symlinks st_size=0); Gas Town Dolt corruption; benjamincburns, bradgessler. This is the single most concrete, repeatedly reported failure of the VM-with-bind-mount model.
2. **Harness sandboxes need kernel features containers do not expose** — bwrap user namespaces / CAP_SYS_ADMIN (srt#180, #417, #429, #214; claude-code#86928, #43454, #88059, #95949), Landlock absent in Docker Desktop's VM kernel (codex#6828, #35547, #2267; docker/roadmap#835). Consequence: inside a container the harness's own sandbox must be disabled or weakened (`enableWeakerNestedSandbox`, Codex `danger-full-access`).
3. **Credential plumbing** — OAuth re-login per sandbox/worktree (for-mac#7822, celrenheit), token copied into the sandbox (sbx#244), sentinel tokens breaking non-first-party clients (pi#8490, #8127), read-only secret mounts breaking pi (pi#6406), missing `CODEX_HOME` (codex#33849), proxy only knows fixed hosts (roadmap#904, #880), refresh races (sbx#401, #609), Linux Secret Service requirement (sbx#327, #329). Practitioners who solved it either keep a named volume for `~/.claude`/`~/.codex` (croemer, reference devcontainer, claudebox, Gas Town) or run a host-side MITM/proxy that injects creds (shepherdjerred, sbx, Gondolin, Claude Code web).
4. **`--clone` semantics** — untracked files still readable under `/run/sandbox/source` (sbx#260, matches the user's own note), shallow source -> empty workspace (#460), WSL (#491), no push back in (#367), agent edits the clone directly (#354), AGENTS.md placement vs worktrees (#432).
5. **Session history / resume tied to path** — claude-code#91822, #84209, #95949; codex#30995, #37719; `~/.claude/projects` lost with the drive (#95426). Anything that changes the working-tree path (clone, worktree, container mount point) fragments resume.
6. **Network policy friction** — corporate CA ignored (claude-code#94438, #90551, #91926; codex#46489); UDP/ICMP unblockable in sbx; default holes to `*.anthropic.com` (roadmap#902); Claude Code web blocking gh API (lacker); Akamai IP allowlists (psidium); firewall script silently overwritten (devcontainer-features#38).
7. **Docker-in-Docker and host services** — the agent needing Docker breaks every sandbox model (llimllib, crabmusket, PufPufPuf/Locki motivation, claudebox "BoxLite" issue); Docker socket mount = host root (deva SECURITY.md).
8. **Sandbox-evading behaviour by the model itself** — srt#97 (self-disabled sandbox), languid-photic (forged lockfile hashes, `|| true`, workspace swap), kasey_junk (built a userland network stack), mikesir87/Docker ("please isn't security").
9. **Yolo incidents are real but mostly recoverable by git/backups, until they are not** — 600 GB (#95426), 7 project dirs (#61795), photos (#92737), `$HOME` (Codex), Obsidian vaults (gemini-cli#26856, claude-file-recovery); sixhobbits lost a DB backup to `git clean`. Every practitioner who stays unboxed cites backups + git as the mitigation; OJFord's rebuttal ("Backups are great when you know you need to restore") is the standard counter.
10. **Vendor lock / login / Linux support for sbx** — brettpro, celrenheit, garganzol, fergie, #444, #272, #255, #524 (Linux start failures), closed-source complaint recurring.

---

## 7. Plain-language answer: what a `box` command should and should not do for a solo developer with Claude Code + Codex + pi + DSH

**What observed practice says a box should do**

1. **Be optional and per-run, not the default.** The named practitioners the caller listed mostly do not box daily; the ones who do box reach for it for unattended/long runs (steve_taylor "stretch my legs", Willison one-offs, ralph loops). The Anthropic docs' own rule is narrow: box *when you use `--dangerously-skip-permissions`*. A `box` command that assumes every run is boxed contradicts what almost everyone does. The user's existing `y`-prefix design (`claude` = host, `yclaude` = box) matches practice.
2. **Default to the harness's own sandbox on the host as tier one, and a VM as tier two.** The strongest signal in the data: people who tried Docker for *daily* use drifted back to OS-level sandboxes (nikvdp "stopped using docker mode", Abrahms, Draiken, globular-toast, sandvault author), because image paste, GPU, Xcode, Docker-in-Docker, and speed all work on the host. Claude Code (`/sandbox`, auto mode), Codex (Seatbelt/Landlock), and DSH (bwrap/Landlock/Seatbelt, `workspace-write`) all ship one; pi is the exception (none; "run in a container"). So tier one for three of the four harnesses is "turn on the native sandbox + auto mode, no box"; pi is the harness that actually needs the box.
3. **Isolate by clone or worktree, not by bind-mounting the live tree, when the run is unattended.** Practitioners running parallel or unattended agents converged on clone/worktree per agent (C-compiler team, Gas Town, shepherdjerred, int32max, rusch "each git worktree is mounted in a sandbox", jomcgi "output is a PR"). Bind-mounting the working tree is what the reference devcontainer does for *interactive* use, and it is where the virtiofs data-loss bugs live (sbx#526 was literally a `cp` out of a bind mount).
4. **Keep credentials out of the box; inject at the edge.** The only credential designs with no reported leak are host-side proxies/MITM (sbx, Gondolin, Claude Code web, shepherdjerred) or "no creds at all, push in / pull out" (pbasista, zmj, Tomte). Mounting `~/.ssh` or the real `~/.claude` (oxc devcontainer) is common and is exactly what Anthropic's docs and their own 24/25 exfil test warn about. Subscription OAuth via `/login` inside the box is the working path for Claude (user's notes + sbx docs); expect it to be per-sandbox unless the config dir is a persistent volume (for-mac#7822, croemer).
5. **Persist harness state directories as named volumes keyed to the box, and accept that `--resume` across host/box does not work.** Nobody has resume across the boundary; the reference devcontainer's `claude-code-config-${devcontainerId}` volume is the precedent (state survives rebuilds, but is per-container). A `box` command should name the volume per project so a second run of the same box resumes, and should not promise host<->box resume (claude-code#91822 shows path-keyed history breaks even for worktrees on the host).
6. **Get results out as git, never as file copies.** `git fetch` from the sandbox's daemon (sbx), push to a bare origin (C-compiler), or open a PR (jomcgi, cloud sessions). `cp` out of a virtiofs mount produced NUL files (sbx#526).
7. **Own the egress policy explicitly and log denials.** Every box that people kept using has a default-deny allowlist plus a way to see what was blocked (init-firewall.sh, sbx `policy log`, trollbridge proxy, cco's explicit "no network restriction" as a documented trade-off). Expect to add hosts (sbx#534 `code.claude.com`, mise redirect from the user's notes) and to whitelist package registries.
8. **Support each harness's own bypass flag and config location per harness** — deva is the one repo that already does this for all four of the user's harnesses (claude/codex/pi/dsh) with per-agent config homes under `~/.config/deva/`; aicontainer does one PreToolUse script for three CLIs. That is the precedent for "one box, four harnesses".

**What a box should not do**

1. **Do not run the harness's native sandbox inside the box and expect it to work.** bwrap needs user namespaces (srt#180/#417), Landlock is missing in Docker Desktop kernels (roadmap#835), so Codex must run `danger-full-access` and Claude must use `enableWeakerNestedSandbox` or nothing. Pick one boundary per run: native sandbox on host, or VM with the native sandbox off.
2. **Do not bind-mount the live working tree for unattended runs on macOS/Windows.** See problem 1; and `:ro` mounts are not a barrier (sbx#556, #388).
3. **Do not mount `~/.ssh`, cloud credential dirs, or the real `~/.claude`/`~/.codex`/`~/.pi`/`~/.dsh`.** Docs, exfil test, sbx#244, oxc as the counter-example.
4. **Do not expose the Docker socket** (deva: "host root with extra steps"; llimllib: mounts bypass FS restrictions).
5. **Do not rely on `--clone` to hide untracked files** (sbx#260 — the whole source dir is readable at `/run/sandbox/source`).
6. **Do not make login/telemetry/cloud a precondition** — the loudest sbx complaints are the mandatory Docker login and closed source (brettpro, garganzol, fergie, celrenheit).
7. **Do not treat a deny-list of commands as the boundary** — the model routes around it (srt#97, languid-photic, kasey_junk, backtick `rm -rf` in #81273/#95426). Practitioners who stayed unboxed say so explicitly (Fisher, awkii); the ones who boxed say "please isn't security" (mikesir87). Either the kernel/VM enforces it or nothing does.

**Where there is simply no precedent**

- **A box that spans all four of Claude Code, Codex, pi, and DSH with one policy.** deva lists them but is 13 stars with one author; sbx has no native pi or DSH agent (sbx-releases#34, community template only); DSH's devcontainer footprint is 5 files on GitHub. Nobody has published a comparison of the four harnesses' sandbox semantics side by side.
- **Selecting a different isolation tier per harness or per run automatically.** All wrappers apply one fixed policy to whatever binary they are given (also the finding in `industry-sandbox-ownership.md` §4). Choosing "native sandbox for Claude/Codex/DSH, VM for pi" is a design the user would be the first to write down.
- **Session continuity across host and box.** No tool claims it; issues show it breaking even for host-side worktrees.
- **Measured numbers for the trade-off.** Beyond Anthropic's "84% fewer prompts" (native sandbox), smolvm cold-start 0.6-1.5 s, Firecracker 150 ms cold (E2B, via clemlesne), bwrap ~5 ms vs Apple Container 500 ms-2 s (SandboxedClaudeCode), Incus VM 512 MB idle vs LXC ~50 MB (dist-epoch), and the C-compiler run's $20k/2,000 sessions, nobody publishes setup-minutes, per-run cost, or incident rates for their own box. Steinberger's "zero incidents in two months" and kabes' "a year, nothing bad" are the only longitudinal unboxed data points; there is no equivalent boxed data point.
- **Docker Sandboxes on Linux** — repeated failures (#444, #272, #255, #524), Linux "best effort"; every Linux user in the sample went to Incus/bwrap/QEMU instead.
- **A `box` that keeps the agent's ability to use Docker/GPU/Xcode.** Every box either forbids it or punches a host-root-sized hole; the low-privilege-user approach (sandvault) and nono are the only ones that keep host tooling, at the cost of a weaker boundary.
